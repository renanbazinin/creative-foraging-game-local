// ============================================================================
// colorPipeline.js
// ----------------------------------------------------------------------------
// Pure, browser-independent building blocks for the "All-All" player
// identification pipeline. These functions contain NO MediaPipe / DOM / canvas
// dependencies so they can be unit-tested in a plain Node environment with
// synthetic ("fake") images and pixel data.
//
// The browser-only orchestration (loading images, running the MediaPipe
// segmenter, drawing debug previews) lives in colorDetectorGeneral.js and
// delegates the math here.
// ============================================================================

/** Euclidean distance between two equal-length numeric vectors. */
export const euclideanDistance = (a = [], b = []) => {
    return Math.sqrt(a.reduce((sum, val, idx) => sum + Math.pow(val - (b[idx] || 0), 2), 0));
};

/**
 * Simple k-means clustering.
 * Centroids are seeded with the first point and the point farthest from it for
 * stability; any remaining centroids (k > 2) are seeded randomly.
 *
 * @param {number[][]} points - array of equal-length feature vectors
 * @param {number} k - number of clusters
 * @param {number} maxIterations
 * @returns {{ assignments: number[], centroids: number[][] }}
 */
export const runKMeans = (points = [], k = 2, maxIterations = 25) => {
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

/** Convert an RGB triple (0-255) to an HSV-style hue in degrees [0, 360). */
export const rgbToHue = (r, g, b) => {
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

/** Convert an RGB triple (0-255, may be fractional) to an uppercase hex string. */
export const rgbToHex = (r, g, b) => {
    const toHex = (val) => {
        const hex = Math.max(0, Math.min(255, Math.round(val))).toString(16);
        return hex.length === 1 ? `0${hex}` : hex;
    };
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
};

/** Parse a #RRGGBB hex string into { r, g, b } or null when malformed. */
export const hexToRgb = (hex) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
};

/**
 * Sample foreground pixels from a raw RGBA buffer using a background-confidence
 * mask, returning the mean colour, normalized centroid and pixel count.
 *
 * A pixel counts as foreground when its background confidence is BELOW
 * `backgroundThreshold`. Optionally restrict sampling to a rectangular (and
 * optionally rotated) region via `bounds`.
 *
 * This mirrors the sampling loop used with MediaPipe segmentation but operates
 * on plain arrays so it can be exercised with synthetic images in tests.
 *
 * @param {Object} opts
 * @param {ArrayLike<number>} opts.pixels - RGBA buffer, length width*height*4
 * @param {number} opts.width
 * @param {number} opts.height
 * @param {ArrayLike<number>} opts.bgMask - background confidence, length maskWidth*maskHeight
 * @param {number} opts.maskWidth
 * @param {number} opts.maskHeight
 * @param {number} [opts.backgroundThreshold=0.85]
 * @param {number} [opts.stride=2]
 * @param {Object|null} [opts.bounds] - { topY, bottomY, leftX, rightX, rotation }
 * @returns {{ meanColor: {r:number,g:number,b:number}, centroidX: number, centroidY: number, pixelCount: number, scanAreaPixels: number }}
 */
export const sampleForegroundPixels = ({
    pixels,
    width,
    height,
    bgMask,
    maskWidth,
    maskHeight,
    backgroundThreshold = 0.85,
    stride = 2,
    bounds = null,
}) => {
    if (!pixels || !bgMask) {
        throw new Error('sampleForegroundPixels requires pixels and bgMask');
    }

    const scaleX = width / maskWidth;
    const scaleY = height / maskHeight;

    let startY = 0;
    let endY = height;
    let startX = 0;
    let endX = width;
    let rotation = 0;
    let cosRot = 1;
    let sinRot = 0;
    const cx = width / 2;
    const cy = height / 2;

    if (bounds) {
        rotation = bounds.rotation || 0;
        if (rotation !== 0) {
            const rad = (-rotation * Math.PI) / 180;
            cosRot = Math.cos(rad);
            sinRot = Math.sin(rad);
            startY = 0;
            endY = height;
            startX = 0;
            endX = width;
        } else {
            startY = Math.max(0, bounds.topY ?? 0);
            endY = Math.min(height, bounds.bottomY ?? height);
            startX = Math.max(0, bounds.leftX ?? 0);
            endX = Math.min(width, bounds.rightX ?? width);
        }
    }

    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let sumX = 0;
    let sumY = 0;
    let pixelCount = 0;
    let scanAreaPixels = 0;

    for (let y = startY; y < endY; y += stride) {
        const maskY = Math.min(maskHeight - 1, Math.floor(y / scaleY));
        for (let x = startX; x < endX; x += stride) {
            if (bounds && rotation !== 0) {
                const dx = x - cx;
                const dy = y - cy;
                const rx = dx * cosRot - dy * sinRot + cx;
                const ry = dx * sinRot + dy * cosRot + cy;

                if (ry < bounds.topY || ry > bounds.bottomY) continue;
                if (bounds.leftX !== undefined && bounds.rightX !== undefined) {
                    if (rx < bounds.leftX || rx > bounds.rightX) continue;
                }
            }

            const maskX = Math.min(maskWidth - 1, Math.floor(x / scaleX));
            const maskIdx = maskY * maskWidth + maskX;
            const bgConfidence = bgMask[maskIdx];

            scanAreaPixels++;

            if (bgConfidence < backgroundThreshold) {
                const intY = Math.floor(y);
                const intX = Math.floor(x);
                const idx = (intY * width + intX) * 4;
                const r = pixels[idx];
                const g = pixels[idx + 1];
                const b = pixels[idx + 2];

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

    const meanColor = pixelCount > 0
        ? { r: sumR / pixelCount, g: sumG / pixelCount, b: sumB / pixelCount }
        : { r: 0, g: 0, b: 0 };

    return {
        meanColor,
        centroidX: pixelCount > 0 ? (sumX / pixelCount) / width : 0,
        centroidY: pixelCount > 0 ? (sumY / pixelCount) / height : 0,
        pixelCount,
        scanAreaPixels,
    };
};

/**
 * Build a per-frame result object (feature vector + mean colour metadata) from
 * the output of {@link sampleForegroundPixels}. Kept separate so callers can
 * assemble results however they source their pixels.
 */
export const buildFrameResult = (moveId, sample, existingPlayer = null, debugPreview = null) => ({
    moveId,
    meanColor: sample.meanColor,
    feature: [
        sample.meanColor.r / 255,
        sample.meanColor.g / 255,
        sample.meanColor.b / 255,
    ],
    centroidX: sample.centroidX,
    centroidY: sample.centroidY,
    pixelCount: sample.pixelCount,
    existingPlayer: existingPlayer || null,
    debugPreview,
});

/**
 * Cluster per-frame results into two players and label each cluster.
 *
 * Labeling strategy priority:
 *   1. Calibration colours (options.playerColors) — nearest-colour matching.
 *   2. Existing labels — majority vote per cluster.
 *   3. Hue/brightness sort — deterministic fallback.
 *
 * @param {Array} results - array of frame results (see buildFrameResult)
 * @param {Object} [options]
 * @param {{'Player A': string, 'Player B': string}|null} [options.playerColors]
 * @param {boolean} [options.verbose=false] - emit console statistics
 * @returns {{ assignments: Object, clusters: Array, analytics: Object }}
 */
export const clusterAndLabel = (results, options = {}) => {
    const playerColors = options.playerColors || null;
    const verbose = options.verbose || false;

    if (!Array.isArray(results) || results.length < 2) {
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
        labelCounts: { 'Player A': 0, 'Player B': 0 },
    }));

    assignments.forEach((clusterIndex, idx) => {
        const result = results[idx];
        const stats = clusterStats[clusterIndex];

        stats.samples.push({
            moveId: result.moveId,
            centroidX: result.centroidX,
            centroidY: result.centroidY,
            pixelCount: result.pixelCount,
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

    // STRATEGY 1: Calibration colours (nearest-colour matching)
    if (playerColors && playerColors['Player A'] && playerColors['Player B']) {
        const colorA = hexToRgb(playerColors['Player A']);
        const colorB = hexToRgb(playerColors['Player B']);

        if (colorA && colorB) {
            const costs = clusterStats.map((stats, idx) => {
                const avgR = stats.sumR / Math.max(1, stats.samples.length);
                const avgG = stats.sumG / Math.max(1, stats.samples.length);
                const avgB = stats.sumB / Math.max(1, stats.samples.length);
                const clusterColor = [avgR, avgG, avgB];

                return {
                    idx,
                    distA: euclideanDistance(clusterColor, [colorA.r, colorA.g, colorA.b]),
                    distB: euclideanDistance(clusterColor, [colorB.r, colorB.g, colorB.b]),
                };
            });

            if (costs.length === 2) {
                const c1 = costs[0];
                const c2 = costs[1];
                const totalDist1 = c1.distA + c2.distB; // C1=A, C2=B
                const totalDist2 = c1.distB + c2.distA; // C1=B, C2=A

                if (totalDist1 < totalDist2) {
                    clusterPlayerMap[c1.idx] = 'Player A';
                    clusterPlayerMap[c2.idx] = 'Player B';
                } else {
                    clusterPlayerMap[c1.idx] = 'Player B';
                    clusterPlayerMap[c2.idx] = 'Player A';
                }
            } else {
                costs.forEach((c) => {
                    clusterPlayerMap[c.idx] = c.distA < c.distB ? 'Player A' : 'Player B';
                });
            }
        }
    }

    // STRATEGY 2: Existing labels (majority vote), only where unassigned
    clusterStats.forEach((stats, idx) => {
        if (clusterPlayerMap[idx]) return;
        const a = stats.labelCounts['Player A'];
        const b = stats.labelCounts['Player B'];
        if (a > b) clusterPlayerMap[idx] = 'Player A';
        else if (b > a) clusterPlayerMap[idx] = 'Player B';
    });

    // STRATEGY 3: Hue/brightness sort (deterministic fallback)
    const hueOrder = clusterStats
        .map((stats, idx) => {
            const avgR = stats.sumR / Math.max(1, stats.samples.length);
            const avgG = stats.sumG / Math.max(1, stats.samples.length);
            const avgB = stats.sumB / Math.max(1, stats.samples.length);
            return {
                idx,
                hue: rgbToHue(avgR, avgG, avgB),
                brightness: stats.sumBrightness / Math.max(1, stats.samples.length),
            };
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
                meanColor: { r: avgR, g: avgG, b: avgB },
                pixelCount: result.pixelCount,
                debugPreview: result.debugPreview,
            },
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
            knownAssignments: stats.labelCounts,
        };
    });

    if (verbose) {
        const assignmentCounts = { 'Player A': 0, 'Player B': 0 };
        Object.values(assignmentsMap).forEach((a) => {
            assignmentCounts[a.player] = (assignmentCounts[a.player] || 0) + 1;
        });
        console.group('[clusterAndLabel] 📊 STATISTICS');
        console.log(`   Frames clustered: ${results.length}`);
        centroids.forEach((centroid, idx) => {
            const r = Math.round(centroid[0] * 255);
            const g = Math.round(centroid[1] * 255);
            const b = Math.round(centroid[2] * 255);
            console.log(`   Centroid ${idx}: ${rgbToHex(r, g, b)} (${clusterSummaries[idx].assignedPlayer})`);
        });
        console.log(`   Player A: ${assignmentCounts['Player A']}, Player B: ${assignmentCounts['Player B']}`);
        console.groupEnd();
    }

    return {
        assignments: assignmentsMap,
        clusters: clusterSummaries,
        analytics: {
            totalFrames: results.length,
            usedFrames: results.length,
            skippedFrames: 0,
            clusters: clusterSummaries,
        },
    };
};
