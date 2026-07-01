import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';
// Import the local model file URL (Vite syntax)
import multiclassModelUrl from './selfie_multiclass_256x256.tflite?url';

// Use the local model if available, otherwise fall back to CDN
const MULTICLASS_MODEL_URL = multiclassModelUrl || 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';

// ===== HELPER FUNCTIONS (Copied from colorDetector.js) =====

const loadImageElement = (source) => new Promise((resolve, reject) => {
    if (!source || typeof source !== 'string') {
        reject(new Error('Invalid image source'));
        return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    if (source.startsWith('data:image')) {
        img.src = source;
    } else {
        img.src = `data:image/jpeg;base64,${source}`;
    }
});

const euclideanDistance = (a = [], b = []) => {
    return Math.sqrt(a.reduce((sum, val, idx) => sum + Math.pow(val - (b[idx] || 0), 2), 0));
};

const runKMeans = (points = [], k = 2, maxIterations = 25) => {
    if (!Array.isArray(points) || points.length === 0) {
        throw new Error('No points provided for k-means clustering');
    }

    const dimension = points[0].length;
    let centroids = [];

    // Initialize centroids using two farthest points for stability
    const first = points[0];
    let farthestPoint = first;
    let maxDistance = -Infinity;
    for (const point of points) {
        const dist = euclideanDistance(point, first);
        if (dist > maxDistance) {
            maxDistance = dist;
            farthestPoint = point;
        }
    }
    centroids.push(first.slice());
    if (k > 1) {
        centroids.push(farthestPoint.slice());
    }
    while (centroids.length < k) {
        centroids.push(points[Math.floor(Math.random() * points.length)].slice());
    }

    let assignments = new Array(points.length).fill(0);
    let iteration = 0;
    let changed = true;

    while (changed && iteration < maxIterations) {
        changed = false;

        // Assignment step
        for (let i = 0; i < points.length; i++) {
            let bestIdx = 0;
            let bestDist = Infinity;
            for (let c = 0; c < centroids.length; c++) {
                const dist = euclideanDistance(points[i], centroids[c]);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestIdx = c;
                }
            }
            if (assignments[i] !== bestIdx) {
                assignments[i] = bestIdx;
                changed = true;
            }
        }

        // Update centroids
        const sums = Array.from({ length: centroids.length }, () => new Array(dimension).fill(0));
        const counts = new Array(centroids.length).fill(0);

        points.forEach((point, idx) => {
            const cluster = assignments[idx];
            counts[cluster] += 1;
            for (let d = 0; d < dimension; d++) {
                sums[cluster][d] += point[d];
            }
        });

        for (let c = 0; c < centroids.length; c++) {
            if (counts[c] === 0) {
                centroids[c] = points[Math.floor(Math.random() * points.length)].slice();
            } else {
                centroids[c] = sums[c].map((val) => val / counts[c]);
            }
        }

        iteration += 1;
    }

    return { assignments, centroids };
};

const rgbToHue = (r, g, b) => {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max === min) return 0;
    let h = 0;
    if (max === r) {
        h = (g - b) / (max - min);
    } else if (max === g) {
        h = 2 + (b - r) / (max - min);
    } else {
        h = 4 + (r - g) / (max - min);
    }
    h *= 60;
    if (h < 0) h += 360;
    return h;
};

const rgbToHex = (r, g, b) => {
    const toHex = (val) => {
        const hex = Math.max(0, Math.min(255, Math.round(val))).toString(16);
        return hex.length === 1 ? `0${hex}` : hex;
    };
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
};

const hexToRgb = (hex) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
};

let imageSegmenterInstance = null;

const getImageSegmenter = async () => {
    if (typeof window === 'undefined') {
        throw new Error('Image segmenter is only available in the browser');
    }
    if (!imageSegmenterInstance) {
        const vision = await FilesetResolver.forVisionTasks(
            'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm'
        );
        imageSegmenterInstance = await ImageSegmenter.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: MULTICLASS_MODEL_URL,
                delegate: 'GPU'
            },
            outputCategoryMask: false,
            outputConfidenceMasks: true,
            runningMode: 'IMAGE'
        });
    }
    return imageSegmenterInstance;
};

// ===== MAIN FUNCTION: identifyPlayersByAllAll =====

/**
 * Identify players by analyzing all pixels (excluding background class 0).
 * If manualBounds is provided, only sample pixels within that Y range.
 * 
 * @param {Array} frames - Array of frame objects: [{ moveId, frameDataUrl, existingPlayer }]
 * @param {Object} options - Configuration options
 * @param {Object} options.manualBounds - Optional { topY, bottomY } to restrict sampling area
 * @param {Number} options.maxFrames - Maximum number of frames to process
 * @param {Number} options.stride - Pixel stride for sampling (default: 2)
 * @param {Number} options.minPixels - Minimum pixels required per frame (default: 80)
 * @param {Object} options.playerColors - Optional { 'Player A': hex, 'Player B': hex } for calibration matching
 * @returns {Object} - { assignments, clusters, analytics }
 */
const identifyPlayersByAllAll = async (frames = [], options = {}) => {
    if (!Array.isArray(frames) || frames.length === 0) {
        throw new Error('No frames provided for analysis');
    }

    const segmenter = await getImageSegmenter();
    const maxFrames = options.maxFrames || frames.length;
    const stride = options.stride || 2;
    //const minPixels = options.minPixels || 80;
    const minPixels = options.minPixels || 5;
    const manualBounds = options.manualBounds || null;
    const playerColors = options.playerColors || null;

    // NEW: Sensitivity Threshold
    // 0.5 = Standard
    // 0.8 = Very Sensitive (Includes pixels even if model thinks they are likely background)
    // 0.95 = Extremely Sensitive (Almost everything except pure green screen is included)
    //const backgroundThreshold = options.sensitivity || 0.8;
    const backgroundThreshold = options.sensitivity || 0.85;
    const framesToProcess = frames.slice(0, maxFrames);
    const results = [];
    let skippedFrames = 0;

    for (const frame of framesToProcess) {
        try {
            const imageElement = await loadImageElement(frame.frameDataUrl);
            const width = imageElement.naturalWidth || imageElement.width;
            const height = imageElement.naturalHeight || imageElement.height;

            const segmentation = segmenter.segment(imageElement);

            // --- Handle Confidence Masks ---
            // Index 0 is always Background in this model
            if (!segmentation.confidenceMasks || !segmentation.confidenceMasks[0]) {
                console.error('[DEBUG] No confidence masks available!', segmentation);
                skippedFrames += 1;
                continue;
            }

            const bgMaskFloatArray = segmentation.confidenceMasks[0].getAsFloat32Array();

            // Confidence masks are usually the size of the model output (e.g., 256x256)
            const maskWidth = segmentation.confidenceMasks[0].width;
            const maskHeight = segmentation.confidenceMasks[0].height;

            // Debug: Check confidence mask values on first frame
            if (results.length === 0) {
                // Sample some values from the center
                const centerIdx = Math.floor(maskHeight / 2) * maskWidth + Math.floor(maskWidth / 2);
                console.log(`[DEBUG] Confidence mask stats: length=${bgMaskFloatArray.length}, maskDim=${maskWidth}x${maskHeight}`);
                console.log(`[DEBUG] Sample bgConfidence values: center=${bgMaskFloatArray[centerIdx]?.toFixed(3)}, [0]=${bgMaskFloatArray[0]?.toFixed(3)}, [100]=${bgMaskFloatArray[100]?.toFixed(3)}`);

                // Find min/max confidence
                let minConf = 1, maxConf = 0;
                for (let i = 0; i < bgMaskFloatArray.length; i += 100) {
                    if (bgMaskFloatArray[i] < minConf) minConf = bgMaskFloatArray[i];
                    if (bgMaskFloatArray[i] > maxConf) maxConf = bgMaskFloatArray[i];
                }
                console.log(`[DEBUG] BG Confidence range: min=${minConf.toFixed(3)}, max=${maxConf.toFixed(3)}, threshold=${backgroundThreshold}`);
            }
            // ------------------------------------

            const videoCanvas = document.createElement('canvas');
            videoCanvas.width = width;
            videoCanvas.height = height;
            const videoCtx = videoCanvas.getContext('2d');
            videoCtx.drawImage(imageElement, 0, 0, width, height);
            const videoData = videoCtx.getImageData(0, 0, width, height).data;

            const scaleX = width / maskWidth;
            const scaleY = height / maskHeight;

            // Determine Y range for sampling
            let startY = 0;
            let endY = height;
            let startX = 0;
            let endX = width;
            let rotation = 0;
            let cosRot = 1;
            let sinRot = 0;
            let cx = width / 2;
            let cy = height / 2;

            if (manualBounds) {
                rotation = manualBounds.rotation || 0;
                if (rotation !== 0) {
                    const rad = (-rotation * Math.PI) / 180;
                    cosRot = Math.cos(rad);
                    sinRot = Math.sin(rad);
                    // Scan whole image if rotated (optimization possible but keeping it simple for now)
                    startY = 0;
                    endY = height;
                    startX = 0;
                    endX = width;
                } else {
                    startY = Math.max(0, manualBounds.topY);
                    endY = Math.min(height, manualBounds.bottomY);
                    startX = Math.max(0, manualBounds.leftX ?? 0);
                    endX = Math.min(width, manualBounds.rightX ?? width);
                }

                // Debug bounds on first frame
                if (results.length === 0) {
                    console.log(`[DEBUG] Manual bounds: topY=${manualBounds.topY}, bottomY=${manualBounds.bottomY}, leftX=${manualBounds.leftX}, rightX=${manualBounds.rightX}`);
                    console.log(`[DEBUG] Computed scan area: X=${startX}→${endX}, Y=${startY}→${endY}, rotation=${rotation}`);
                }
            } else {
                // Debug: no manual bounds
                if (results.length === 0) {
                    console.log(`[DEBUG] No manual bounds - scanning full image: X=0→${width}, Y=0→${height}`);
                }
            }

            let sumR = 0;
            let sumG = 0;
            let sumB = 0;
            let sumX = 0;
            let sumY = 0;
            let pixelCount = 0;

            // Debug: Track confidence values within scan area
            let scanAreaPixels = 0;
            let scanAreaMinConf = 1;
            let scanAreaMaxConf = 0;

            // Sample pixels, filtering out background (class 0)
            for (let y = startY; y < endY; y += stride) {
                const maskY = Math.min(maskHeight - 1, Math.floor(y / scaleY));
                for (let x = startX; x < endX; x += stride) {

                    // Check bounds with rotation
                    if (manualBounds && rotation !== 0) {
                        const dx = x - cx;
                        const dy = y - cy;
                        const rx = dx * cosRot - dy * sinRot + cx;
                        const ry = dx * sinRot + dy * cosRot + cy;

                        // Check if rotated point is within bounds
                        if (ry < manualBounds.topY || ry > manualBounds.bottomY) {
                            continue;
                        }
                        if (manualBounds.leftX !== undefined && manualBounds.rightX !== undefined) {
                            if (rx < manualBounds.leftX || rx > manualBounds.rightX) {
                                continue;
                            }
                        }
                    }

                    const maskX = Math.min(maskWidth - 1, Math.floor(x / scaleX));

                    // --- Check Probability instead of Class Index ---
                    const maskIdx = maskY * maskWidth + maskX;
                    const bgConfidence = bgMaskFloatArray[maskIdx];

                    // Track confidence values within scan area
                    scanAreaPixels++;
                    if (bgConfidence < scanAreaMinConf) scanAreaMinConf = bgConfidence;
                    if (bgConfidence > scanAreaMaxConf) scanAreaMaxConf = bgConfidence;

                    // If the model's confidence that this is background is LOWER 
                    // than our threshold, we consider it a Player/Foreground.
                    if (bgConfidence < backgroundThreshold) {
                        // IMPORTANT: Floor y and x to get integer indices!
                        const intY = Math.floor(y);
                        const intX = Math.floor(x);
                        const idx = (intY * width + intX) * 4;
                        const r = videoData[idx];
                        const g = videoData[idx + 1];
                        const b = videoData[idx + 2];

                        // Safety check: skip if values are undefined or NaN
                        if (r === undefined || g === undefined || b === undefined ||
                            Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
                            continue;
                        }

                        sumR += r;
                        sumG += g;
                        sumB += b;
                        sumX += intX;
                        sumY += intY;
                        pixelCount += 1;
                    }
                }
            }

            // Debug: Log confidence range within scan area
            if (results.length === 0) {
                console.log(`[DEBUG] WITHIN SCAN AREA: ${scanAreaPixels} pixels sampled, bgConfidence range: ${scanAreaMinConf.toFixed(3)} → ${scanAreaMaxConf.toFixed(3)}`);
                console.log(`[DEBUG] Threshold=${backgroundThreshold} → Need bgConfidence < ${backgroundThreshold} to count as foreground`);
            }

            // Debug: Log first frame's pixel stats
            if (results.length === 0) {
                console.log(`[DEBUG] First frame: width=${width}, height=${height}, maskWidth=${maskWidth}, maskHeight=${maskHeight}`);
                console.log(`[DEBUG] First frame: pixelCount=${pixelCount}, sumR=${sumR}, sumG=${sumG}, sumB=${sumB}`);
                console.log(`[DEBUG] First frame: videoData length=${videoData.length}, expected=${width * height * 4}`);
            }

            if (pixelCount < minPixels) {
                skippedFrames += 1;
                continue;
            }

            const meanColor = {
                r: sumR / pixelCount,
                g: sumG / pixelCount,
                b: sumB / pixelCount
            };

            // Generate debug preview showing what MediaPipe sees (all non-background pixels)
            let debugPreview = null;
            try {
                const debugCanvas = document.createElement('canvas');
                debugCanvas.width = width;
                debugCanvas.height = height;
                const debugCtx = debugCanvas.getContext('2d');

                // Draw original image
                debugCtx.drawImage(imageElement, 0, 0, width, height);

                // Overlay non-background pixels in blue with transparency
                const debugImageData = debugCtx.getImageData(0, 0, width, height);
                const debugPixels = debugImageData.data;

                for (let y = 0; y < height; y += 1) {
                    const maskY = Math.min(maskHeight - 1, Math.floor(y / scaleY));
                    for (let x = 0; x < width; x += 1) {
                        const maskX = Math.min(maskWidth - 1, Math.floor(x / scaleX));
                        const maskIdx = maskY * maskWidth + maskX;

                        // Check confidence for visual debug
                        const bgConfidence = bgMaskFloatArray[maskIdx];

                        if (bgConfidence < backgroundThreshold) {
                            const idx = (y * width + x) * 4;
                            // Red tint to show what we captured
                            debugPixels[idx] = Math.min(255, debugPixels[idx] + 50);
                            debugPixels[idx + 1] = Math.max(0, debugPixels[idx + 1] - 20);
                            debugPixels[idx + 2] = Math.max(0, debugPixels[idx + 2] - 20);
                        }
                    }
                }

                debugCtx.putImageData(debugImageData, 0, 0);

                // If manual bounds, draw the scan area boundaries
                if (manualBounds) {
                    debugCtx.save();
                    if (rotation !== 0) {
                        debugCtx.translate(cx, cy);
                        debugCtx.rotate((rotation * Math.PI) / 180);
                        debugCtx.translate(-cx, -cy);
                    }

                    const boundsLeft = manualBounds.leftX ?? 0;
                    const boundsRight = manualBounds.rightX ?? width;

                    // Draw scan area highlight (rectangle)
                    debugCtx.fillStyle = 'rgba(0, 255, 0, 0.2)';
                    debugCtx.fillRect(boundsLeft, manualBounds.topY, boundsRight - boundsLeft, manualBounds.bottomY - manualBounds.topY);

                    // Draw top line (green)
                    debugCtx.strokeStyle = '#00FF00';
                    debugCtx.lineWidth = 3;
                    debugCtx.setLineDash([]);
                    debugCtx.beginPath();
                    debugCtx.moveTo(boundsLeft, manualBounds.topY);
                    debugCtx.lineTo(boundsRight, manualBounds.topY);
                    debugCtx.stroke();

                    // Draw bottom line (yellow)
                    debugCtx.strokeStyle = '#FFFF00';
                    debugCtx.setLineDash([]);
                    debugCtx.beginPath();
                    debugCtx.moveTo(boundsLeft, manualBounds.bottomY);
                    debugCtx.lineTo(boundsRight, manualBounds.bottomY);
                    debugCtx.stroke();

                    // Draw left line (cyan)
                    debugCtx.strokeStyle = '#00FFFF';
                    debugCtx.lineWidth = 2;
                    debugCtx.setLineDash([5, 5]);
                    debugCtx.beginPath();
                    debugCtx.moveTo(boundsLeft, manualBounds.topY);
                    debugCtx.lineTo(boundsLeft, manualBounds.bottomY);
                    debugCtx.stroke();

                    // Draw right line (magenta)
                    debugCtx.strokeStyle = '#FF00FF';
                    debugCtx.beginPath();
                    debugCtx.moveTo(boundsRight, manualBounds.topY);
                    debugCtx.lineTo(boundsRight, manualBounds.bottomY);
                    debugCtx.stroke();

                    // Add label
                    const scanAreaHeight = manualBounds.bottomY - manualBounds.topY;
                    const scanAreaWidth = boundsRight - boundsLeft;
                    debugCtx.setLineDash([]);
                    debugCtx.fillStyle = '#00FF00';
                    debugCtx.font = 'bold 14px Arial';
                    debugCtx.fillText(`Scan: ${Math.round(scanAreaWidth)}×${Math.round(scanAreaHeight)}px`, boundsLeft + 5, manualBounds.topY - 5);

                    debugCtx.restore();
                }

                // Add info text
                debugCtx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                debugCtx.fillRect(10, 10, 300, 80);
                debugCtx.fillStyle = '#FFFFFF';
                debugCtx.font = 'bold 14px Arial';
                debugCtx.fillText(`Non-BG Pixels: ${pixelCount}`, 20, 30);
                debugCtx.fillText(`Threshold: ${minPixels}`, 20, 50);
                debugCtx.fillText(`Mean Color: ${rgbToHex(meanColor.r, meanColor.g, meanColor.b)}`, 20, 70);

                debugPreview = debugCanvas.toDataURL('image/png');
            } catch (previewErr) {
                console.warn('[ColorDetectorGeneral] Failed to generate debug preview:', previewErr);
            }

            results.push({
                moveId: frame.moveId,
                meanColor,
                feature: [
                    meanColor.r / 255,
                    meanColor.g / 255,
                    meanColor.b / 255
                ],
                centroidX: (sumX / pixelCount) / width,
                centroidY: (sumY / pixelCount) / height,
                pixelCount,
                existingPlayer: frame.existingPlayer || null,
                debugPreview // Add debug preview to results
            });
        } catch (err) {
            console.warn('[ColorDetectorGeneral] Analysis failed for frame', frame.moveId, err);
            skippedFrames += 1;
        }
    }

    if (results.length < 2) {
        throw new Error('Not enough frames with detectable pixels (need at least 2)');
    }

    const features = results.map((r) => r.feature);
    const { assignments, centroids } = runKMeans(features, Math.min(2, results.length));

    const clusterStats = centroids.map(() => ({
        samples: [],
        sumR: 0,
        sumG: 0,
        sumB: 0,
        sumPixels: 0,
        sumBrightness: 0,
        labelCounts: {
            'Player A': 0,
            'Player B': 0
        }
    }));

    assignments.forEach((clusterIndex, idx) => {
        const result = results[idx];
        const stats = clusterStats[clusterIndex];

        stats.samples.push({
            moveId: result.moveId,
            centroidX: result.centroidX,
            centroidY: result.centroidY,
            pixelCount: result.pixelCount
        });

        stats.sumR += result.meanColor.r;
        stats.sumG += result.meanColor.g;
        stats.sumB += result.meanColor.b;
        stats.sumPixels += result.pixelCount;
        stats.sumBrightness += (result.meanColor.r + result.meanColor.g + result.meanColor.b) / 3;

        if (result.existingPlayer === 'Player A' || result.existingPlayer === 'Player B') {
            stats.labelCounts[result.existingPlayer] += 1;
        }
    });

    const clusterPlayerMap = {};

    // STRATEGY 1: Use provided player colors (Calibration)
    if (playerColors && playerColors['Player A'] && playerColors['Player B']) {
        const colorA = hexToRgb(playerColors['Player A']);
        const colorB = hexToRgb(playerColors['Player B']);

        if (colorA && colorB) {
            // Calculate distances for each cluster to each player color
            const costs = clusterStats.map((stats, idx) => {
                const avgR = stats.sumR / Math.max(1, stats.samples.length);
                const avgG = stats.sumG / Math.max(1, stats.samples.length);
                const avgB = stats.sumB / Math.max(1, stats.samples.length);
                const clusterColor = [avgR, avgG, avgB];

                return {
                    idx,
                    distA: euclideanDistance(clusterColor, [colorA.r, colorA.g, colorA.b]),
                    distB: euclideanDistance(clusterColor, [colorB.r, colorB.g, colorB.b])
                };
            });

            // If we have 2 clusters, assign optimally
            if (costs.length === 2) {
                const c1 = costs[0];
                const c2 = costs[1];

                // Option 1: C1 is A, C2 is B
                const totalDist1 = c1.distA + c2.distB;
                // Option 2: C1 is B, C2 is A
                const totalDist2 = c1.distB + c2.distA;

                if (totalDist1 < totalDist2) {
                    clusterPlayerMap[c1.idx] = 'Player A';
                    clusterPlayerMap[c2.idx] = 'Player B';
                } else {
                    clusterPlayerMap[c1.idx] = 'Player B';
                    clusterPlayerMap[c2.idx] = 'Player A';
                }
            } else {
                // If more or less than 2, just assign each to closest
                costs.forEach(c => {
                    if (c.distA < c.distB) {
                        clusterPlayerMap[c.idx] = 'Player A';
                    } else {
                        clusterPlayerMap[c.idx] = 'Player B';
                    }
                });
            }
        }
    }

    // STRATEGY 2: Use existing labels (Majority Vote)
    // Only fill in if not already assigned by Strategy 1
    clusterStats.forEach((stats, idx) => {
        if (clusterPlayerMap[idx]) return;

        const a = stats.labelCounts['Player A'];
        const b = stats.labelCounts['Player B'];
        if (a > b) clusterPlayerMap[idx] = 'Player A';
        else if (b > a) clusterPlayerMap[idx] = 'Player B';
    });

    // STRATEGY 3: Hue/Brightness Sort (Fallback)
    // Assign remaining clusters deterministically
    const hueOrder = clusterStats
        .map((stats, idx) => {
            const avgR = stats.sumR / Math.max(1, stats.samples.length);
            const avgG = stats.sumG / Math.max(1, stats.samples.length);
            const avgB = stats.sumB / Math.max(1, stats.samples.length);
            return { idx, hue: rgbToHue(avgR, avgG, avgB), brightness: stats.sumBrightness / Math.max(1, stats.samples.length) };
        })
        .sort((a, b) => a.hue - b.hue || a.brightness - b.brightness);

    const playerOrder = ['Player A', 'Player B'];
    hueOrder.forEach(({ idx }) => {
        if (!clusterPlayerMap[idx]) {
            const assignedPlayers = Object.values(clusterPlayerMap);
            const available = playerOrder.find((p) => !assignedPlayers.includes(p)) || 'Player A';
            clusterPlayerMap[idx] = available;
        }
    });

    const assignmentsMap = {};
    assignments.forEach((clusterIndex, idx) => {
        const result = results[idx];
        const player = clusterPlayerMap[clusterIndex] || (clusterIndex === 0 ? 'Player A' : 'Player B');
        const centroid = centroids[clusterIndex];
        const otherCentroid = centroids[clusterIndex === 0 ? 1 : 0];
        const distanceToOwn = euclideanDistance(result.feature, centroid);
        const distanceToOther = otherCentroid ? euclideanDistance(result.feature, otherCentroid) : distanceToOwn;
        const confidence = otherCentroid
            ? Math.max(0, 1 - distanceToOwn / (distanceToOwn + distanceToOther + 1e-6))
            : 1;

        // Calculate cluster mean color for consistent styling
        const clusterStat = clusterStats[clusterIndex];
        const avgR = clusterStat.sumR / Math.max(1, clusterStat.samples.length);
        const avgG = clusterStat.sumG / Math.max(1, clusterStat.samples.length);
        const avgB = clusterStat.sumB / Math.max(1, clusterStat.samples.length);

        assignmentsMap[result.moveId] = {
            player,
            clusterId: clusterIndex,
            styleLabel: `Style ${clusterIndex + 1}`,
            confidence,
            stats: {
                // Use the CLUSTER'S mean color, not the individual frame's mean color
                meanColor: { r: avgR, g: avgG, b: avgB },
                pixelCount: result.pixelCount,
                debugPreview: result.debugPreview
            }
        };
    });

    const clusterSummaries = clusterStats.map((stats, idx) => {
        const avgR = stats.sumR / Math.max(1, stats.samples.length);
        const avgG = stats.sumG / Math.max(1, stats.samples.length);
        const avgB = stats.sumB / Math.max(1, stats.samples.length);
        const hexColor = rgbToHex(avgR, avgG, avgB);

        return {
            id: idx,
            styleLabel: `Style ${idx + 1}`,
            assignedPlayer: clusterPlayerMap[idx] || (idx === 0 ? 'Player A' : 'Player B'),
            hexColor,
            meanColor: { r: avgR, g: avgG, b: avgB },
            sampleCount: stats.samples.length,
            avgPixels: stats.sumPixels / Math.max(1, stats.samples.length),
            avgBrightness: stats.sumBrightness / Math.max(1, stats.samples.length),
            knownAssignments: stats.labelCounts
        };
    });

    // ===== DEBUG STATISTICS =====
    console.group('[identifyPlayersByAllAll] 📊 STATISTICS');

    // Frame Processing Stats
    console.log('📋 FRAME PROCESSING:');
    console.log(`   Total frames provided: ${framesToProcess.length}`);
    console.log(`   Frames processed successfully: ${results.length}`);
    console.log(`   Frames skipped (below minPixels): ${skippedFrames}`);
    console.log(`   Success rate: ${((results.length / framesToProcess.length) * 100).toFixed(1)}%`);

    // Pixel Statistics
    const totalPixels = results.reduce((sum, r) => sum + r.pixelCount, 0);
    const avgPixelsPerFrame = totalPixels / results.length;
    const minPixelsFrame = results.reduce((min, r) => r.pixelCount < min.pixelCount ? r : min, results[0]);
    const maxPixelsFrame = results.reduce((max, r) => r.pixelCount > max.pixelCount ? r : max, results[0]);

    console.log('🔢 PIXEL STATISTICS:');
    console.log(`   Total foreground pixels detected: ${totalPixels.toLocaleString()}`);
    console.log(`   Average pixels per frame: ${avgPixelsPerFrame.toFixed(0)}`);
    console.log(`   Min pixels in a frame: ${minPixelsFrame.pixelCount} (moveId: ${minPixelsFrame.moveId})`);
    console.log(`   Max pixels in a frame: ${maxPixelsFrame.pixelCount} (moveId: ${maxPixelsFrame.moveId})`);
    console.log(`   Min pixels threshold (minPixels): ${minPixels}`);

    // Clustering Stats
    console.log('🎯 K-MEANS CLUSTERING:');
    console.log(`   Number of clusters: ${centroids.length}`);
    centroids.forEach((centroid, idx) => {
        const r = Math.round(centroid[0] * 255);
        const g = Math.round(centroid[1] * 255);
        const b = Math.round(centroid[2] * 255);
        console.log(`   Centroid ${idx}: RGB(${r}, ${g}, ${b}) = ${rgbToHex(r, g, b)}`);
    });

    // Cluster Details
    console.log('📊 CLUSTER DETAILS:');
    clusterSummaries.forEach((cluster, idx) => {
        console.log(`   Cluster ${idx} (${cluster.assignedPlayer}):`);
        console.log(`      - Samples: ${cluster.sampleCount}`);
        console.log(`      - Mean Color: ${cluster.hexColor}`);
        console.log(`      - Avg Pixels/Frame: ${cluster.avgPixels.toFixed(0)}`);
        console.log(`      - Avg Brightness: ${cluster.avgBrightness.toFixed(1)}`);
        console.log(`      - Known A labels: ${cluster.knownAssignments['Player A']}, B labels: ${cluster.knownAssignments['Player B']}`);
    });

    // Color Distribution
    console.log('🎨 COLOR DISTRIBUTION:');
    const colorStats = results.map(r => ({
        moveId: r.moveId,
        hex: rgbToHex(r.meanColor.r, r.meanColor.g, r.meanColor.b),
        brightness: (r.meanColor.r + r.meanColor.g + r.meanColor.b) / 3,
        hue: rgbToHue(r.meanColor.r, r.meanColor.g, r.meanColor.b)
    }));
    const minBrightness = Math.min(...colorStats.map(c => c.brightness));
    const maxBrightness = Math.max(...colorStats.map(c => c.brightness));
    console.log(`   Brightness range: ${minBrightness.toFixed(0)} - ${maxBrightness.toFixed(0)}`);
    console.log(`   Hue range: ${Math.min(...colorStats.map(c => c.hue)).toFixed(0)}° - ${Math.max(...colorStats.map(c => c.hue)).toFixed(0)}°`);

    // Assignment Summary
    const assignmentCounts = { 'Player A': 0, 'Player B': 0 };
    Object.values(assignmentsMap).forEach(a => {
        assignmentCounts[a.player] = (assignmentCounts[a.player] || 0) + 1;
    });
    console.log('✅ FINAL ASSIGNMENTS:');
    console.log(`   Player A: ${assignmentCounts['Player A']} frames`);
    console.log(`   Player B: ${assignmentCounts['Player B']} frames`);

    // Confidence Stats
    const confidences = Object.values(assignmentsMap).map(a => a.confidence);
    const avgConfidence = confidences.reduce((sum, c) => sum + c, 0) / confidences.length;
    const minConfidence = Math.min(...confidences);
    console.log('🔒 CONFIDENCE:');
    console.log(`   Average confidence: ${(avgConfidence * 100).toFixed(1)}%`);
    console.log(`   Min confidence: ${(minConfidence * 100).toFixed(1)}%`);
    console.log(`   High confidence (>80%): ${confidences.filter(c => c > 0.8).length} frames`);
    console.log(`   Low confidence (<60%): ${confidences.filter(c => c < 0.6).length} frames`);

    console.groupEnd();
    // ===== END DEBUG STATISTICS =====

    return {
        assignments: assignmentsMap,
        clusters: clusterSummaries,
        analytics: {
            totalFrames: framesToProcess.length,
            usedFrames: results.length,
            skippedFrames,
            clusters: clusterSummaries
        }
    };
};

export { identifyPlayersByAllAll };
