import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';
// Import the local model file URL (Vite syntax)
import multiclassModelUrl from './selfie_multiclass_256x256.tflite?url';
import {
    runKMeans, // re-exported for consumers/tests that import from here
    rgbToHex,
    sampleForegroundPixels,
    buildFrameResult,
    clusterAndLabel,
} from './colorPipeline';

// Use the local model if available, otherwise fall back to CDN
const MULTICLASS_MODEL_URL = multiclassModelUrl || 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';

// MediaPipe WASM runtime sources, tried in order. The pinned version matches
// the bundled @mediapipe/tasks-vision package (glue JS ↔ .wasm must agree, or
// Emscripten throws "Failed to fetch" / "Module.noExitRuntime has been
// replaced ..."). `@latest` is kept only as a last-resort fallback.
export const WASM_SOURCES = [
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm',
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm',
];

// ===== HELPER FUNCTIONS =====

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

let imageSegmenterInstance = null;

/**
 * Lazily create (and cache) the MediaPipe image segmenter, trying each WASM
 * source in turn so a single flaky/mismatched CDN entry does not break
 * identification.
 */
const getImageSegmenter = async () => {
    if (typeof window === 'undefined') {
        throw new Error('Image segmenter is only available in the browser');
    }
    if (imageSegmenterInstance) {
        return imageSegmenterInstance;
    }

    let lastError = null;
    for (const wasmBase of WASM_SOURCES) {
        try {
            const vision = await FilesetResolver.forVisionTasks(wasmBase);
            imageSegmenterInstance = await ImageSegmenter.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: MULTICLASS_MODEL_URL,
                    delegate: 'GPU'
                },
                outputCategoryMask: false,
                outputConfidenceMasks: true,
                runningMode: 'IMAGE'
            });
            console.log(`[ColorDetectorGeneral] ✅ MediaPipe WASM initialized from ${wasmBase}`);
            return imageSegmenterInstance;
        } catch (err) {
            console.warn(`[ColorDetectorGeneral] ⚠️ WASM init failed for ${wasmBase}:`, err);
            lastError = err;
            imageSegmenterInstance = null;
        }
    }

    throw new Error(
        `Failed to initialize MediaPipe segmenter from all sources (${WASM_SOURCES.join(', ')}): ${lastError?.message || lastError}`
    );
};

// ===== MAIN FUNCTION: identifyPlayersByAllAll =====

/**
 * Identify players by analyzing all pixels (excluding background class 0).
 * If manualBounds is provided, only sample pixels within that region.
 *
 * @param {Array} frames - Array of frame objects: [{ moveId, frameDataUrl, existingPlayer }]
 * @param {Object} options - Configuration options
 * @param {Object} options.manualBounds - Optional { topY, bottomY, leftX, rightX, rotation } to restrict sampling
 * @param {Number} options.maxFrames - Maximum number of frames to process
 * @param {Number} options.stride - Pixel stride for sampling (default: 2)
 * @param {Number} options.minPixels - Minimum pixels required per frame (default: 5)
 * @param {Number} options.sensitivity - Background confidence threshold (default: 0.85)
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
    const minPixels = options.minPixels || 5;
    const manualBounds = options.manualBounds || null;
    const playerColors = options.playerColors || null;
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

            // Index 0 is always Background in this model
            if (!segmentation.confidenceMasks || !segmentation.confidenceMasks[0]) {
                console.error('[ColorDetectorGeneral] No confidence masks available!', segmentation);
                skippedFrames += 1;
                continue;
            }

            const bgMask = segmentation.confidenceMasks[0].getAsFloat32Array();
            const maskWidth = segmentation.confidenceMasks[0].width;
            const maskHeight = segmentation.confidenceMasks[0].height;

            const videoCanvas = document.createElement('canvas');
            videoCanvas.width = width;
            videoCanvas.height = height;
            const videoCtx = videoCanvas.getContext('2d');
            videoCtx.drawImage(imageElement, 0, 0, width, height);
            const pixels = videoCtx.getImageData(0, 0, width, height).data;

            // Delegate the pixel sampling math to the pure pipeline module.
            const sample = sampleForegroundPixels({
                pixels,
                width,
                height,
                bgMask,
                maskWidth,
                maskHeight,
                backgroundThreshold,
                stride,
                bounds: manualBounds,
            });

            if (sample.pixelCount < minPixels) {
                skippedFrames += 1;
                continue;
            }

            // Generate a debug preview showing what MediaPipe captured.
            let debugPreview = null;
            try {
                debugPreview = buildDebugPreview({
                    imageElement,
                    width,
                    height,
                    bgMask,
                    maskWidth,
                    maskHeight,
                    backgroundThreshold,
                    manualBounds,
                    pixelCount: sample.pixelCount,
                    minPixels,
                    meanHex: rgbToHex(sample.meanColor.r, sample.meanColor.g, sample.meanColor.b),
                });
            } catch (previewErr) {
                console.warn('[ColorDetectorGeneral] Failed to generate debug preview:', previewErr);
            }

            results.push(buildFrameResult(frame.moveId, sample, frame.existingPlayer, debugPreview));
        } catch (err) {
            console.warn('[ColorDetectorGeneral] Analysis failed for frame', frame.moveId, err);
            skippedFrames += 1;
        }
    }

    const output = clusterAndLabel(results, { playerColors, verbose: true });
    output.analytics.totalFrames = framesToProcess.length;
    output.analytics.usedFrames = results.length;
    output.analytics.skippedFrames = skippedFrames;
    return output;
};

/**
 * Render a debug preview canvas highlighting the foreground pixels MediaPipe
 * captured (and the manual scan bounds when present). Browser-only.
 */
const buildDebugPreview = ({
    imageElement,
    width,
    height,
    bgMask,
    maskWidth,
    maskHeight,
    backgroundThreshold,
    manualBounds,
    pixelCount,
    minPixels,
    meanHex,
}) => {
    const scaleX = width / maskWidth;
    const scaleY = height / maskHeight;

    const debugCanvas = document.createElement('canvas');
    debugCanvas.width = width;
    debugCanvas.height = height;
    const debugCtx = debugCanvas.getContext('2d');
    debugCtx.drawImage(imageElement, 0, 0, width, height);

    const debugImageData = debugCtx.getImageData(0, 0, width, height);
    const debugPixels = debugImageData.data;

    for (let y = 0; y < height; y += 1) {
        const maskY = Math.min(maskHeight - 1, Math.floor(y / scaleY));
        for (let x = 0; x < width; x += 1) {
            const maskX = Math.min(maskWidth - 1, Math.floor(x / scaleX));
            const bgConfidence = bgMask[maskY * maskWidth + maskX];
            if (bgConfidence < backgroundThreshold) {
                const idx = (y * width + x) * 4;
                debugPixels[idx] = Math.min(255, debugPixels[idx] + 50);
                debugPixels[idx + 1] = Math.max(0, debugPixels[idx + 1] - 20);
                debugPixels[idx + 2] = Math.max(0, debugPixels[idx + 2] - 20);
            }
        }
    }
    debugCtx.putImageData(debugImageData, 0, 0);

    if (manualBounds) {
        const rotation = manualBounds.rotation || 0;
        const cx = width / 2;
        const cy = height / 2;
        debugCtx.save();
        if (rotation !== 0) {
            debugCtx.translate(cx, cy);
            debugCtx.rotate((rotation * Math.PI) / 180);
            debugCtx.translate(-cx, -cy);
        }
        const boundsLeft = manualBounds.leftX ?? 0;
        const boundsRight = manualBounds.rightX ?? width;
        debugCtx.fillStyle = 'rgba(0, 255, 0, 0.2)';
        debugCtx.fillRect(boundsLeft, manualBounds.topY, boundsRight - boundsLeft, manualBounds.bottomY - manualBounds.topY);
        debugCtx.strokeStyle = '#00FF00';
        debugCtx.lineWidth = 3;
        debugCtx.setLineDash([]);
        debugCtx.strokeRect(boundsLeft, manualBounds.topY, boundsRight - boundsLeft, manualBounds.bottomY - manualBounds.topY);
        debugCtx.restore();
    }

    debugCtx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    debugCtx.fillRect(10, 10, 300, 80);
    debugCtx.fillStyle = '#FFFFFF';
    debugCtx.font = 'bold 14px Arial';
    debugCtx.fillText(`Non-BG Pixels: ${pixelCount}`, 20, 30);
    debugCtx.fillText(`Threshold: ${minPixels}`, 20, 50);
    debugCtx.fillText(`Mean Color: ${meanHex}`, 20, 70);

    return debugCanvas.toDataURL('image/png');
};

export { identifyPlayersByAllAll, runKMeans };
