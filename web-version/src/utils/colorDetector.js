import { SelfieSegmentation } from '@mediapipe/selfie_segmentation';
import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';
// Import the local model file URL (Vite syntax)
import multiclassModelUrl from './selfie_multiclass_256x256.tflite?url';

const DEFAULT_SEGMENTATION_MODEL = 1;
// Use the local model if available, otherwise fall back to CDN (though we expect local to work)
const MULTICLASS_MODEL_URL = multiclassModelUrl || 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';

// Normalize a color input (hex string or HSV-like object) into RGB
const normalizeColorToRGB = (input) => {
  if (!input) return null;

  if (typeof input === 'string') {
    let hex = input.trim();
    if (!hex.startsWith('#')) return null;
    hex = hex.slice(1);
    if (hex.length === 3) {
      hex = hex.split('').map((c) => c + c).join('');
    }
    if (hex.length !== 6) return null;
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    if ([r, g, b].some((v) => Number.isNaN(v))) return null;
    return { r, g, b };
  }

  // Accept HSV calibration objects similar to calibrationA/B
  if (typeof input === 'object' && input !== null && typeof input.h !== 'undefined') {
    const h = (input.h || 0) * 2; // 0-360
    const s = (input.s || 0) / 255;
    const v = (input.v || 0) / 255;

    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;

    let r1 = 0;
    let g1 = 0;
    let b1 = 0;
    if (h >= 0 && h < 60) { r1 = c; g1 = x; b1 = 0; }
    else if (h < 120) { r1 = x; g1 = c; b1 = 0; }
    else if (h < 180) { r1 = 0; g1 = c; b1 = x; }
    else if (h < 240) { r1 = 0; g1 = x; b1 = c; }
    else if (h < 300) { r1 = x; g1 = 0; b1 = c; }
    else { r1 = c; g1 = 0; b1 = x; }

    const to255 = (val) => Math.max(0, Math.min(255, Math.round((val + m) * 255)));
    return {
      r: to255(r1),
      g: to255(g1),
      b: to255(b1)
    };
  }

  return null;
};

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

const rgbDistanceSq = (a, b) => (
  (a.r - b.r) * (a.r - b.r) +
  (a.g - b.g) * (a.g - b.g) +
  (a.b - b.b) * (a.b - b.b)
);

const rgbToHex = (r, g, b) => {
  const toHex = (val) => {
    const hex = Math.max(0, Math.min(255, Math.round(val))).toString(16);
    return hex.length === 1 ? `0${hex}` : hex;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const createOverlayFromMask = (baseImage, width, height, mask, maskThreshold, highlights = []) => {
  const overlayCanvas = document.createElement('canvas');
  overlayCanvas.width = width;
  overlayCanvas.height = height;
  const overlayCtx = overlayCanvas.getContext('2d');
  overlayCtx.drawImage(baseImage, 0, 0, width, height);

  const overlayImageData = overlayCtx.getImageData(0, 0, width, height);
  const overlayData = overlayImageData.data;
  const tintColor = { r: 20, g: 180, b: 255 };

  for (let i = 0; i < width * height; i += 1) {
    if (mask[i * 4] >= maskThreshold) {
      const idx = i * 4;
      overlayData[idx] = Math.round(overlayData[idx] * 0.35 + tintColor.r * 0.65);
      overlayData[idx + 1] = Math.round(overlayData[idx + 1] * 0.35 + tintColor.g * 0.65);
      overlayData[idx + 2] = Math.round(overlayData[idx + 2] * 0.35 + tintColor.b * 0.65);
      overlayData[idx + 3] = 255;
    }
  }

  overlayCtx.putImageData(overlayImageData, 0, 0);

  highlights.forEach((point) => {
    if (!point) return;
    overlayCtx.beginPath();
    overlayCtx.arc(point.x, point.y, 6, 0, Math.PI * 2);
    overlayCtx.fillStyle = point.fill || 'rgba(0, 230, 118, 0.35)';
    overlayCtx.strokeStyle = point.stroke || '#00E676';
    overlayCtx.lineWidth = 2;
    overlayCtx.fill();
    overlayCtx.stroke();
  });

  return overlayCanvas.toDataURL('image/png');
};

const extractCategoryMaskData = (categoryMask, fallbackWidth, fallbackHeight) => {
  if (!categoryMask) {
    return {
      maskData: null,
      maskWidth: fallbackWidth,
      maskHeight: fallbackHeight,
      isRGBA: false
    };
  }

  let maskData = null;
  let maskWidth = fallbackWidth;
  let maskHeight = fallbackHeight;
  let isRGBA = false;

  try {
    if (typeof categoryMask.getAsUint8Array === 'function') {
      maskData = categoryMask.getAsUint8Array();
      maskWidth = categoryMask.width || fallbackWidth;
      maskHeight = categoryMask.height || fallbackHeight;
      return { maskData, maskWidth, maskHeight, isRGBA: false };
    }

    if (categoryMask instanceof Uint8Array || categoryMask instanceof Uint8ClampedArray) {
      maskData = categoryMask;
      return { maskData, maskWidth, maskHeight, isRGBA: false };
    }

    if (categoryMask.canvas) {
      const canvas = categoryMask.canvas;
      maskWidth = canvas.width;
      maskHeight = canvas.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const imageData = ctx.getImageData(0, 0, maskWidth, maskHeight);
      maskData = imageData.data;
      isRGBA = true;
      return { maskData, maskWidth, maskHeight, isRGBA };
    }

    if (categoryMask instanceof ImageData) {
      maskData = categoryMask.data;
      maskWidth = categoryMask.width || fallbackWidth;
      maskHeight = categoryMask.height || fallbackHeight;
      isRGBA = true;
      return { maskData, maskWidth, maskHeight, isRGBA };
    }

    if (categoryMask.data) {
      maskData = categoryMask.data;
      maskWidth = categoryMask.width || fallbackWidth;
      maskHeight = categoryMask.height || fallbackHeight;
      isRGBA = maskData.length >= maskWidth * maskHeight * 4;
      return { maskData, maskWidth, maskHeight, isRGBA };
    }
  } catch (err) {
    console.warn('[ColorDetector] Failed to extract category mask data:', err);
  }

  return {
    maskData: null,
    maskWidth: fallbackWidth,
    maskHeight: fallbackHeight,
    isRGBA: false
  };
};

let selfieSegmentationInstance = null;

const getSelfieSegmentation = () => {
  if (typeof window === 'undefined') {
    throw new Error('Selfie segmentation is only available in the browser');
  }
  if (!selfieSegmentationInstance) {
    selfieSegmentationInstance = new SelfieSegmentation({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`
    });
    selfieSegmentationInstance.setOptions({
      modelSelection: DEFAULT_SEGMENTATION_MODEL,
      selfieMode: false
    });
  }
  return selfieSegmentationInstance;
};

const runSegmentation = (imageSource, options = {}) => {
  const instance = getSelfieSegmentation();
  if (typeof options.modelSelection === 'number') {
    instance.setOptions({
      modelSelection: options.modelSelection,
      selfieMode: false
    });
  }
  return new Promise((resolve, reject) => {
    instance.onResults((results) => resolve(results));
    instance.send({ image: imageSource }).catch(reject);
  });
};

/**
 * Color-band based detector. Looks for two bracelet colors and decides
 * which band is closer to the chosen edge (bottom/top).
 */
const identifyPlayerByColor = (
  frameDataUrl,
  colorAConfig,
  colorBConfig,
  options = {}
) => new Promise((resolve) => {
  if (!frameDataUrl) {
    resolve({ suggestion: 'None', stats: { mode: 'colorMask' } });
    return;
  }

  const rgbA = normalizeColorToRGB(colorAConfig);
  const rgbB = normalizeColorToRGB(colorBConfig);
  if (!rgbA || !rgbB) {
    console.warn('[ColorDetector] Invalid color configs, returning None');
    resolve({ suggestion: 'None', stats: { mode: 'colorMask' } });
    return;
  }

  const {
    anchor = 'bottom',
    maxWidth = 320,
    colorThreshold = 80,
    minPixels = 50,
    minGapRatio = 0.05
  } = options;

  const img = new Image();
  img.crossOrigin = 'anonymous';

  img.onload = () => {
    try {
      const scale = img.width > maxWidth ? maxWidth / img.width : 1;
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve({ suggestion: 'None', stats: { mode: 'colorMask' } });
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);
      const { data } = imageData;

      const sqThresh = colorThreshold * colorThreshold;

      const statsA = { minY: height, maxY: -1, pixels: 0 };
      const statsB = { minY: height, maxY: -1, pixels: 0 };
      const mask = new Uint8Array(width * height); // 0 = none, 1 = A, 2 = B

      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const idx = (y * width + x) * 4;
          const maskIdx = y * width + x;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];

          const dA =
            (r - rgbA.r) * (r - rgbA.r) +
            (g - rgbA.g) * (g - rgbA.g) +
            (b - rgbA.b) * (b - rgbA.b);
          const dB =
            (r - rgbB.r) * (r - rgbB.r) +
            (g - rgbB.g) * (g - rgbB.g) +
            (b - rgbB.b) * (b - rgbB.b);

          if (dA < sqThresh && dA < dB) {
            statsA.pixels += 1;
            if (y < statsA.minY) statsA.minY = y;
            if (y > statsA.maxY) statsA.maxY = y;
            mask[maskIdx] = 1;
          } else if (dB < sqThresh && dB < dA) {
            statsB.pixels += 1;
            if (y < statsB.minY) statsB.minY = y;
            if (y > statsB.maxY) statsB.maxY = y;
            mask[maskIdx] = 2;
          }
        }
      }

      const resultStats = {
        mode: 'colorMask',
        pixelsA: statsA.pixels,
        pixelsB: statsB.pixels,
        minYA: statsA.pixels > 0 ? statsA.minY : null,
        maxYA: statsA.pixels > 0 ? statsA.maxY : null,
        minYB: statsB.pixels > 0 ? statsB.minY : null,
        maxYB: statsB.pixels > 0 ? statsB.maxY : null,
        width,
        height
      };

      const hasA = statsA.pixels >= minPixels;
      const hasB = statsB.pixels >= minPixels;

      let suggestion = 'None';

      if (hasA && !hasB) {
        suggestion = 'A';
      } else if (!hasA && hasB) {
        suggestion = 'B';
      } else if (hasA && hasB) {
        let anchorPosA;
        let anchorPosB;
        if (anchor === 'top') {
          anchorPosA = statsA.minY;
          anchorPosB = statsB.minY;
        } else {
          anchorPosA = statsA.maxY;
          anchorPosB = statsB.maxY;
        }

        const gap = Math.abs(anchorPosA - anchorPosB);
        const minGap = height * minGapRatio;
        if (gap >= minGap) {
          suggestion = anchor === 'top'
            ? (anchorPosA < anchorPosB ? 'A' : 'B')
            : (anchorPosA > anchorPosB ? 'A' : 'B');
        }
      }

      let preview = null;
      try {
        const overlayCanvas = document.createElement('canvas');
        overlayCanvas.width = width;
        overlayCanvas.height = height;
        const overlayCtx = overlayCanvas.getContext('2d');
        overlayCtx.drawImage(img, 0, 0, width, height);
        const overlayImageData = overlayCtx.getImageData(0, 0, width, height);
        const overlayData = overlayImageData.data;

        const tintPixel = (idx, color) => {
          overlayData[idx] = Math.round(overlayData[idx] * 0.3 + color.r * 0.7);
          overlayData[idx + 1] = Math.round(overlayData[idx + 1] * 0.3 + color.g * 0.7);
          overlayData[idx + 2] = Math.round(overlayData[idx + 2] * 0.3 + color.b * 0.7);
          overlayData[idx + 3] = 255;
        };

        const tintA = { r: 255, g: 82, b: 97 };
        const tintB = { r: 80, g: 170, b: 255 };

        for (let i = 0; i < mask.length; i += 1) {
          if (mask[i] === 1) {
            tintPixel(i * 4, tintA);
          } else if (mask[i] === 2) {
            tintPixel(i * 4, tintB);
          }
        }

        overlayCtx.putImageData(overlayImageData, 0, 0);
        preview = overlayCanvas.toDataURL('image/png');
      } catch (previewError) {
        console.warn('[ColorDetector] Failed generating preview', previewError);
      }

      resolve({ suggestion, stats: resultStats, preview });
    } catch (err) {
      console.error('[ColorDetector] Error processing frame:', err);
      resolve({ suggestion: 'None', stats: { mode: 'colorMask' } });
    }
  };

  img.onerror = (e) => {
    console.error('[ColorDetector] Failed to load frame image', e);
    resolve({ suggestion: 'None', stats: { mode: 'colorMask' } });
  };

  if (typeof frameDataUrl === 'string' && frameDataUrl.startsWith('data:image')) {
    img.src = frameDataUrl;
  } else if (typeof frameDataUrl === 'string') {
    img.src = `data:image/jpeg;base64,${frameDataUrl}`;
  } else {
    resolve({ suggestion: 'None', stats: { mode: 'colorMask' } });
  }
});

// Helper: Finds connected blobs and filters by relative size (compared to largest blob)
const countMassiveBlobs = (points, width, height, stride, minBlobRatio = 0.1) => {
  if (points.length === 0) {
    return { count: 0, pixels: [], largestBlobSize: 0 };
  }

  // 1. Create a temporary grid to track visited pixels
  // 0 = empty, 1 = has pixel, 2 = visited
  const grid = new Int32Array(width * height);

  // Populate grid with our matching points
  for (const p of points) {
    const idx = p.y * width + p.x;
    if (idx >= 0 && idx < grid.length) {
      grid[idx] = 1;
    }
  }

  const allBlobs = [];
  const neighborOffsets = [
    { dx: stride, dy: 0 },   // Right
    { dx: -stride, dy: 0 },  // Left
    { dx: 0, dy: stride },   // Down
    { dx: 0, dy: -stride }   // Up
  ];

  // 2. Find all blobs using Flood Fill (BFS)
  for (const p of points) {
    const idx = p.y * width + p.x;

    // If this pixel is not marked as '1' (it's either 0 or already visited 2), skip
    if (idx < 0 || idx >= grid.length || grid[idx] !== 1) continue;

    // Start Flood Fill for this new blob
    let currentBlobSize = 0;
    const queue = [{ x: p.x, y: p.y }];
    grid[idx] = 2; // Mark as visited immediately

    const currentBlobPixels = [];

    let head = 0;
    while (head < queue.length) {
      const { x, y } = queue[head++];
      currentBlobSize++;
      currentBlobPixels.push({ x, y });

      // Check neighbors
      for (const offset of neighborOffsets) {
        const nx = x + offset.dx;
        const ny = y + offset.dy;

        // Boundary checks
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const nIdx = ny * width + nx;
          if (nIdx >= 0 && nIdx < grid.length && grid[nIdx] === 1) {
            grid[nIdx] = 2; // Mark visited
            queue.push({ x: nx, y: ny });
          }
        }
      }
    }

    allBlobs.push({
      size: currentBlobSize,
      pixels: currentBlobPixels
    });
  }

  if (allBlobs.length === 0) {
    return { count: 0, pixels: [], largestBlobSize: 0 };
  }

  // 3. Find the largest blob
  const largestBlob = allBlobs.reduce((max, blob) =>
    blob.size > max.size ? blob : max
  );
  const largestBlobSize = largestBlob.size;

  // 4. Calculate minimum blob size as percentage of largest blob
  const minBlobSize = Math.max(1, Math.floor(largestBlobSize * minBlobRatio));

  // 5. Filter: Keep only blobs that are at least minBlobRatio of the largest blob
  let totalSignificantPixels = 0;
  const acceptedBlobs = [];

  for (const blob of allBlobs) {
    if (blob.size >= minBlobSize) {
      totalSignificantPixels += blob.size;
      acceptedBlobs.push(...blob.pixels);
    }
  }

  return {
    count: totalSignificantPixels,
    pixels: acceptedBlobs,
    largestBlobSize,
    minBlobSize,
    totalBlobs: allBlobs.length,
    filteredBlobs: allBlobs.filter(b => b.size >= minBlobSize).length
  };
};

const identifyPlayerBySegmentation = async (
  frameDataUrl,
  colorAConfig,
  colorBConfig,
  options = {}
) => {
  if (!frameDataUrl) {
    return { suggestion: 'None', stats: { mode: 'segmentation' } };
  }

  const rgbA = normalizeColorToRGB(colorAConfig);
  const rgbB = normalizeColorToRGB(colorBConfig);
  if (!rgbA || !rgbB) {
    console.warn('[ColorDetector] Invalid color configs');
    return { suggestion: 'None', stats: { mode: 'segmentation' } };
  }

  try {
    // 1. Setup Images
    const imageElement = await loadImageElement(frameDataUrl);
    const width = imageElement.naturalWidth || imageElement.width;
    const height = imageElement.naturalHeight || imageElement.height;

    // Use Multiclass Segmenter (gives access to clothing/person classes)
    const segmenter = await getImageSegmenter();
    const results = segmenter.segment(imageElement);
    const {
      maskData: categoryMaskData,
      maskWidth,
      maskHeight,
      isRGBA: isCategoryMaskRGBA
    } = extractCategoryMaskData(results.categoryMask, width, height);

    if (!categoryMaskData) {
      throw new Error('Failed to extract segmentation mask data');
    }

    const maskData = new Uint8ClampedArray(width * height * 4);
    const scaleX = width / maskWidth;
    const scaleY = height / maskHeight;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const mx = Math.min(maskWidth - 1, Math.floor(x / scaleX));
        const my = Math.min(maskHeight - 1, Math.floor(y / scaleY));
        const midx = (my * maskWidth + mx) * (isCategoryMaskRGBA ? 4 : 1);

        let category = 0;
        if (categoryMaskData && midx < categoryMaskData.length) {
          category = categoryMaskData[midx];
        }

        // Keep everything except background (0) and body skin (2)
        const val = (category !== 0 && category !== 2) ? 255 : 0;
        const idx = (y * width + x) * 4;
        maskData[idx] = val;
        maskData[idx + 1] = val;
        maskData[idx + 2] = val;
        maskData[idx + 3] = 255;
      }
    }

    /* 
    // OLD: Binary Segmentation
    const results = await runSegmentation(imageElement, {
      modelSelection: options.modelSelection ?? DEFAULT_SEGMENTATION_MODEL
    });

    // Draw Mask
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = width;
    maskCanvas.height = height;
    const maskCtx = maskCanvas.getContext('2d');
    maskCtx.drawImage(results.segmentationMask, 0, 0, width, height);
    const maskData = maskCtx.getImageData(0, 0, width, height).data;
    */

    // Draw Video

    // Draw Video
    const videoCanvas = document.createElement('canvas');
    videoCanvas.width = width;
    videoCanvas.height = height;
    const videoCtx = videoCanvas.getContext('2d');
    videoCtx.drawImage(imageElement, 0, 0, width, height);
    const videoData = videoCtx.getImageData(0, 0, width, height).data;

    // 2. Configuration
    const maskThreshold = options.maskThreshold || 100;
    const colorThreshold = options.colorThreshold ?? 95;
    const anchor = options.anchor || 'top'; // 'top' or 'bottom'
    const sqThresh = colorThreshold * colorThreshold;

    // NEW: Scan Depth - How far from the "tip" do we look? 
    // 0.20 means we only check the first 20% of the arm (the wrist/hand).
    const scanDepthRatio = options.scanDepth ?? 1.0; // Default to 100% (full scan)
    const stride = options.stride || 2; // Optimization: skip pixels

    // 3. Find the "Tip" (The point closest to the anchor)
    let tipY = (anchor === 'top') ? height : 0;
    let foundPerson = false;

    // We scan to find the first Y coordinate that has person pixels
    if (anchor === 'top') {
      for (let y = 0; y < height; y += stride) {
        for (let x = 0; x < width; x += stride) {
          if (maskData[(y * width + x) * 4] >= maskThreshold) {
            tipY = y;
            foundPerson = true;
            break;
          }
        }
        if (foundPerson) break;
      }
    } else { // Bottom anchor
      for (let y = height - 1; y >= 0; y -= stride) {
        for (let x = 0; x < width; x += stride) {
          if (maskData[(y * width + x) * 4] >= maskThreshold) {
            tipY = y;
            foundPerson = true;
            break;
          }
        }
        if (foundPerson) break;
      }
    }

    // 4. Define the "Wrist Zone" (ROI)
    // Check if manual bounds are provided
    let startY, endY;
    let pixelDepth;

    if (options.manualBounds && anchor === 'manually') {
      // Use manual bounds directly
      startY = options.manualBounds.topY;
      endY = options.manualBounds.bottomY;
      pixelDepth = endY - startY;
      // For manual mode, we still need tipY for display, use startY
      if (!foundPerson) {
        tipY = startY; // Fallback if no person found
      }
    } else {
      // Use automatic calculation
      if (!foundPerson) {
        return {
          suggestion: 'None',
          stats: {
            mode: 'segmentation',
            reason: 'no_person'
          },
          preview: null,
          maskPreview: null
        };
      }

      pixelDepth = scanDepthRatio ? Math.floor(height * scanDepthRatio) : height;

      if (anchor === 'top') {
        startY = tipY;
        endY = Math.min(height, tipY + pixelDepth);
      } else {
        startY = Math.max(0, tipY - pixelDepth);
        endY = tipY;
      }
    }

    // 5. Collect ALL raw candidate pixels first (before blob filtering)
    const candidatesA = [];
    const candidatesB = [];

    for (let y = startY; y < endY; y += stride) {
      for (let x = 0; x < width; x += stride) {
        const idx = (y * width + x) * 4;

        // Skip non-person pixels (background)
        if (maskData[idx] < maskThreshold) continue;

        const r = videoData[idx];
        const g = videoData[idx + 1];
        const b = videoData[idx + 2];

        const dA = rgbDistanceSq({ r, g, b }, rgbA);
        const dB = rgbDistanceSq({ r, g, b }, rgbB);

        // Strict matching: Must be closer to one color AND within threshold
        if (dA < sqThresh && dA < dB) {
          candidatesA.push({ x, y });
        } else if (dB < sqThresh && dB < dA) {
          candidatesB.push({ x, y });
        }
      }
    }

    // 6. Apply Blob Filtering (removes noise - small scattered pixels)
    // minBlobRatio: Keep only blobs that are at least X% of the largest blob (default 10%)
    const minBlobRatio = options.minBlobRatio ?? 0.1; // 10% of largest blob

    const blobResultA = countMassiveBlobs(candidatesA, width, height, stride, minBlobRatio);
    const blobResultB = countMassiveBlobs(candidatesB, width, height, stride, minBlobRatio);

    const pixelsA = blobResultA.count;
    const pixelsB = blobResultB.count;
    const armPixelsA = blobResultA.pixels.map(p => ({ ...p, idx: (p.y * width + p.x) * 4 }));
    const armPixelsB = blobResultB.pixels.map(p => ({ ...p, idx: (p.y * width + p.x) * 4 }));

    // 7. Decision Logic
    // We need a minimum number of pixels to be confident (ignoring noise)
    const MIN_PIXELS = 50;
    let suggestion = 'None';
    let bestArm = null;

    if (pixelsA > MIN_PIXELS && pixelsA > pixelsB) {
      suggestion = 'A';
      bestArm = {
        color: 'A',
        pixelCount: pixelsA,
        minY: startY,
        maxY: endY,
        anchorY: tipY,
        rawPixels: candidatesA.length,
        largestBlobSize: blobResultA.largestBlobSize,
        minBlobSize: blobResultA.minBlobSize
      };
    } else if (pixelsB > MIN_PIXELS && pixelsB > pixelsA) {
      suggestion = 'B';
      bestArm = {
        color: 'B',
        pixelCount: pixelsB,
        minY: startY,
        maxY: endY,
        anchorY: tipY,
        rawPixels: candidatesB.length,
        largestBlobSize: blobResultB.largestBlobSize,
        minBlobSize: blobResultB.minBlobSize
      };
    }

    // 7. Generate Debug Preview (Shows the Scan Zone)
    let preview = null;
    let maskPreview = null;
    try {
      const previewCanvas = document.createElement('canvas');
      previewCanvas.width = width;
      previewCanvas.height = height;
      const ctx = previewCanvas.getContext('2d');

      // Draw dimmed original
      ctx.drawImage(imageElement, 0, 0, width, height);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, width, height);

      // Highlight the Scan Zone (The area we actually looked at)
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,1)';
      ctx.fillRect(0, startY, width, (endY - startY));

      // Draw the original image back into the cleared scan zone
      ctx.globalCompositeOperation = 'destination-over';
      ctx.drawImage(imageElement, 0, 0, width, height);

      // Overlay MediaPipe segmentation mask (show which pixels were counted as "person")
      ctx.globalCompositeOperation = 'source-over';

      // Draw person mask outline in cyan (only in scan zone for clarity)
      const overlayImageData = ctx.createImageData(width, height);
      const overlayPixels = overlayImageData.data;

      for (let y = startY; y < endY; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const idx = (y * width + x) * 4;
          const isPerson = maskData[idx] >= maskThreshold;

          if (isPerson) {
            // Cyan overlay for person pixels in scan zone (more visible)
            overlayPixels[idx] = 0;       // R
            overlayPixels[idx + 1] = 255; // G (cyan)
            overlayPixels[idx + 2] = 255; // B (cyan)
            overlayPixels[idx + 3] = 90;  // A (35% opacity - more visible)
          }
        }
      }
      ctx.putImageData(overlayImageData, 0, 0);

      // Highlight ONLY filtered blob pixels (noise removed - only large connected blobs)
      const colorOverlayImageData = ctx.createImageData(width, height);
      const colorOverlayPixels = colorOverlayImageData.data;

      // Mark filtered color A pixels in bright red (only large blobs, noise filtered out)
      for (const pixel of armPixelsA) {
        const idx = pixel.idx;
        if (idx >= 0 && idx < colorOverlayPixels.length - 3) {
          colorOverlayPixels[idx] = 255;     // R (red)
          colorOverlayPixels[idx + 1] = 0;   // G
          colorOverlayPixels[idx + 2] = 0;   // B
          colorOverlayPixels[idx + 3] = 180; // A (70% opacity - very visible)
        }
      }

      // Mark filtered color B pixels in bright blue (only large blobs, noise filtered out)
      for (const pixel of armPixelsB) {
        const idx = pixel.idx;
        if (idx >= 0 && idx < colorOverlayPixels.length - 3) {
          colorOverlayPixels[idx] = 0;       // R
          colorOverlayPixels[idx + 1] = 100; // G
          colorOverlayPixels[idx + 2] = 255; // B (blue)
          colorOverlayPixels[idx + 3] = 180; // A (70% opacity - very visible)
        }
      }

      ctx.putImageData(colorOverlayImageData, 0, 0);

      // Draw Scan Area Boundary Lines (Top and Bottom of scan zone)
      ctx.globalCompositeOperation = 'source-over';

      // Top boundary line (start of scan area)
      ctx.strokeStyle = '#00FF00'; // Green = Top boundary
      ctx.lineWidth = 3;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(0, startY);
      ctx.lineTo(width, startY);
      ctx.stroke();

      // Bottom boundary line (end of scan area)
      ctx.strokeStyle = '#FFFF00'; // Yellow = Bottom boundary
      ctx.lineWidth = 3;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(0, endY);
      ctx.lineTo(width, endY);
      ctx.stroke();

      // Optional: Draw tip line in a different color/style if it's different from startY
      if (tipY !== startY && tipY !== endY) {
        ctx.strokeStyle = '#FF00FF'; // Magenta = Tip (where person was first detected)
        ctx.lineWidth = 2;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(0, tipY);
        ctx.lineTo(width, tipY);
        ctx.stroke();
      }

      preview = previewCanvas.toDataURL('image/png');

      // Mask preview: Raw segmentation (white = person, black = background)
      const maskPreviewCanvas = document.createElement('canvas');
      maskPreviewCanvas.width = width;
      maskPreviewCanvas.height = height;
      const maskPreviewCtx = maskPreviewCanvas.getContext('2d');
      const maskPreviewImageData = maskPreviewCtx.createImageData(width, height);
      const maskPreviewPixels = maskPreviewImageData.data;

      for (let i = 0; i < width * height; i += 1) {
        const idx = i * 4;
        const isPerson = maskData[i * 4] >= maskThreshold;
        const value = isPerson ? 255 : 0;
        maskPreviewPixels[idx] = value;     // R
        maskPreviewPixels[idx + 1] = value; // G
        maskPreviewPixels[idx + 2] = value; // B
        maskPreviewPixels[idx + 3] = 255;   // A
      }

      maskPreviewCtx.putImageData(maskPreviewImageData, 0, 0);
      maskPreview = maskPreviewCanvas.toDataURL('image/png');
    } catch (e) {
      console.warn('[ColorDetector] Failed generating preview', e);
    }

    const stats = {
      mode: 'segmentation',
      width,
      height,
      pixelsA,
      pixelsB,
      rawPixelsA: candidatesA.length,
      rawPixelsB: candidatesB.length,
      tipY,
      scanDepth: pixelDepth,
      scanDepthRatio,
      anchor,
      bestArm,
      blobInfoA: {
        largestBlobSize: blobResultA.largestBlobSize,
        minBlobSize: blobResultA.minBlobSize,
        totalBlobs: blobResultA.totalBlobs,
        filteredBlobs: blobResultA.filteredBlobs,
        droppedPixels: candidatesA.length - pixelsA
      },
      blobInfoB: {
        largestBlobSize: blobResultB.largestBlobSize,
        minBlobSize: blobResultB.minBlobSize,
        totalBlobs: blobResultB.totalBlobs,
        filteredBlobs: blobResultB.filteredBlobs,
        droppedPixels: candidatesB.length - pixelsB
      },
      minBlobRatio
    };

    return {
      suggestion,
      stats,
      preview,
      maskPreview
    };

  } catch (error) {
    console.error('[ColorDetector] Segmentation failed:', error);
    return { suggestion: 'None' };
  }
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

const identifyPlayersByCloth = async (frames = [], options = {}) => {
  if (!Array.isArray(frames) || frames.length === 0) {
    throw new Error('No frames provided for cloth analysis');
  }

  const segmenter = await getImageSegmenter();
  const maxFrames = options.maxFrames || frames.length;
  const stride = options.stride || 2;
  const minClothPixels = options.minClothPixels || 80;
  const manualBounds = options.manualBounds || null; // { topY, bottomY }

  const framesToProcess = frames.slice(0, maxFrames);
  const results = [];
  let skippedFrames = 0;

  for (const frame of framesToProcess) {
    try {
      const imageElement = await loadImageElement(frame.frameDataUrl);
      const width = imageElement.naturalWidth || imageElement.width;
      const height = imageElement.naturalHeight || imageElement.height;

      const segmentation = segmenter.segment(imageElement);
      const {
        maskData: categoryMaskData,
        maskWidth,
        maskHeight,
        isRGBA: isCategoryMaskRGBA
      } = extractCategoryMaskData(segmentation.categoryMask, width, height);

      if (!categoryMaskData) {
        skippedFrames += 1;
        continue;
      }

      const videoCanvas = document.createElement('canvas');
      videoCanvas.width = width;
      videoCanvas.height = height;
      const videoCtx = videoCanvas.getContext('2d');
      videoCtx.drawImage(imageElement, 0, 0, width, height);
      const videoData = videoCtx.getImageData(0, 0, width, height).data;

      const scaleX = width / maskWidth;
      const scaleY = height / maskHeight;

      // Calculate scan area for percentage-based threshold
      let scanAreaHeight;
      let rotation = 0;
      let cosRot = 1;
      let sinRot = 0;
      let cx = width / 2;
      let cy = height / 2;

      if (manualBounds) {
        scanAreaHeight = manualBounds.bottomY - manualBounds.topY;
        rotation = manualBounds.rotation || 0;
        if (rotation !== 0) {
          const rad = (-rotation * Math.PI) / 180;
          cosRot = Math.cos(rad);
          sinRot = Math.sin(rad);
        }
      } else {
        scanAreaHeight = height;
      }

      // Calculate how many pixels we're actually sampling (considering stride)
      const sampledRows = Math.floor(scanAreaHeight / stride);
      const sampledCols = Math.floor(width / stride);
      const totalSampledPixels = sampledRows * sampledCols;

      // Use percentage-based threshold: at least 0.5% of sampled pixels should be cloth
      // This adapts to scan area size (small manual bounds vs full image)
      const minClothPixelsPercentage = 0.005; // 0.5%
      const adaptiveMinClothPixels = Math.max(
        Math.floor(totalSampledPixels * minClothPixelsPercentage),
        20 // Absolute minimum of 20 pixels to avoid noise
      );

      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let sumX = 0;
      let sumY = 0;
      let pixelCount = 0;

      for (let y = 0; y < height; y += stride) {
        // Skip pixels outside manual bounds if provided (only if not rotated)
        if (manualBounds && rotation === 0 && (y < manualBounds.topY || y > manualBounds.bottomY)) {
          continue;
        }

        const maskY = Math.min(maskHeight - 1, Math.floor(y / scaleY));
        for (let x = 0; x < width; x += stride) {

          // Check rotated bounds
          if (manualBounds && rotation !== 0) {
            const dx = x - cx;
            const dy = y - cy;
            const ry = dx * sinRot + dy * cosRot + cy;

            if (ry < manualBounds.topY || ry > manualBounds.bottomY) {
              continue;
            }
          }

          const maskX = Math.min(maskWidth - 1, Math.floor(x / scaleX));
          const maskIdx = (maskY * maskWidth + maskX) * (isCategoryMaskRGBA ? 4 : 1);
          const category = categoryMaskData[maskIdx];

          if (category === 4) {
            const idx = (y * width + x) * 4;
            const r = videoData[idx];
            const g = videoData[idx + 1];
            const b = videoData[idx + 2];
            sumR += r;
            sumG += g;
            sumB += b;
            sumX += x;
            sumY += y;
            pixelCount += 1;
          }
        }
      }

      // Use adaptive threshold instead of fixed minClothPixels
      if (pixelCount < adaptiveMinClothPixels) {
        console.log(`[Cloth] Frame ${frame.moveId} SKIPPED - cloth pixels: ${pixelCount}, threshold: ${adaptiveMinClothPixels}, scan area: ${scanAreaHeight}px, manual bounds: ${manualBounds ? 'YES' : 'NO'}`);
        skippedFrames += 1;
        continue;
      }

      console.log(`[Cloth] Frame ${frame.moveId} ACCEPTED - cloth pixels: ${pixelCount}, threshold: ${adaptiveMinClothPixels}, scan area: ${scanAreaHeight}px, manual bounds: ${manualBounds ? `Y:${manualBounds.topY}-${manualBounds.bottomY}` : 'NO'}`);

      const meanColor = {
        r: sumR / pixelCount,
        g: sumG / pixelCount,
        b: sumB / pixelCount
      };

      // Generate debug preview showing what MediaPipe sees
      let debugPreview = null;
      try {
        const debugCanvas = document.createElement('canvas');
        debugCanvas.width = width;
        debugCanvas.height = height;
        const debugCtx = debugCanvas.getContext('2d');

        // Draw original image
        debugCtx.drawImage(imageElement, 0, 0, width, height);

        // Overlay cloth pixels in green with transparency
        const debugImageData = debugCtx.getImageData(0, 0, width, height);
        const debugPixels = debugImageData.data;

        for (let y = 0; y < height; y += 1) {
          const maskY = Math.min(maskHeight - 1, Math.floor(y / scaleY));
          for (let x = 0; x < width; x += 1) {
            const maskX = Math.min(maskWidth - 1, Math.floor(x / scaleX));
            const maskIdx = (maskY * maskWidth + maskX) * (isCategoryMaskRGBA ? 4 : 1);
            const category = categoryMaskData[maskIdx];

            if (category === 4) { // Cloth pixels
              const idx = (y * width + x) * 4;
              // Green tint for cloth
              debugPixels[idx] = Math.round(debugPixels[idx] * 0.5 + 50); // R
              debugPixels[idx + 1] = Math.round(debugPixels[idx + 1] * 0.5 + 255 * 0.5); // G
              debugPixels[idx + 2] = Math.round(debugPixels[idx + 2] * 0.5 + 50); // B
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

          // Dim area outside bounds (approximate for rotation or just draw lines)
          // For rotation, filling the outside is harder, let's just draw the box and lines

          // Draw boundary lines
          debugCtx.strokeStyle = '#00FF00'; // Green = Top
          debugCtx.lineWidth = 3;
          debugCtx.setLineDash([]);
          debugCtx.beginPath();
          debugCtx.moveTo(-width, manualBounds.topY);
          debugCtx.lineTo(width * 2, manualBounds.topY);
          debugCtx.stroke();

          debugCtx.strokeStyle = '#FFFF00'; // Yellow = Bottom
          debugCtx.lineWidth = 3;
          debugCtx.setLineDash([5, 5]);
          debugCtx.beginPath();
          debugCtx.moveTo(-width, manualBounds.bottomY);
          debugCtx.lineTo(width * 2, manualBounds.bottomY);
          debugCtx.stroke();

          // Draw scan area highlight
          debugCtx.fillStyle = 'rgba(0, 255, 0, 0.2)';
          debugCtx.fillRect(-width, manualBounds.topY, width * 3, manualBounds.bottomY - manualBounds.topY);

          // Add label
          debugCtx.fillStyle = '#00FF00';
          debugCtx.font = 'bold 16px Arial';
          debugCtx.fillText(`Manual Scan Area (${scanAreaHeight}px)`, 10, manualBounds.topY - 10);

          debugCtx.restore();
        }

        // Add info text
        debugCtx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        debugCtx.fillRect(10, 10, 300, 80);
        debugCtx.fillStyle = '#FFFFFF';
        debugCtx.font = 'bold 14px Arial';
        debugCtx.fillText(`Cloth Pixels: ${pixelCount}`, 20, 30);
        debugCtx.fillText(`Threshold: ${adaptiveMinClothPixels}`, 20, 50);
        debugCtx.fillText(`Mean Color: ${rgbToHex(meanColor.r, meanColor.g, meanColor.b)}`, 20, 70);

        debugPreview = debugCanvas.toDataURL('image/png');
      } catch (previewErr) {
        console.warn('[ColorDetector] Failed to generate debug preview:', previewErr);
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
      console.warn('[ColorDetector] Cloth analysis failed for frame', frame.moveId, err);
      skippedFrames += 1;
    }
  }

  if (results.length < 2) {
    throw new Error('Not enough frames with detectable clothing');
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
  clusterStats.forEach((stats, idx) => {
    const a = stats.labelCounts['Player A'];
    const b = stats.labelCounts['Player B'];
    if (a > b) clusterPlayerMap[idx] = 'Player A';
    else if (b > a) clusterPlayerMap[idx] = 'Player B';
  });

  // Assign remaining clusters deterministically by hue order
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

    assignmentsMap[result.moveId] = {
      player,
      clusterId: clusterIndex,
      styleLabel: `Style ${clusterIndex + 1}`,
      confidence,
      stats: {
        meanColor: result.meanColor,
        pixelCount: result.pixelCount,
        debugPreview: result.debugPreview // Include debug preview
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
      outputCategoryMask: true,
      outputConfidenceMasks: true,
      runningMode: 'IMAGE'
    });
  }
  return imageSegmenterInstance;
};

/**
 * Detect arms using Image Segmentation and check for color A/B in each arm
 */
const identifyPlayerByArmSegmentation = async (
  frameDataUrl,
  colorAConfig,
  colorBConfig,
  options = {}
) => {
  if (!frameDataUrl) {
    return { suggestion: 'None', stats: { mode: 'arm-segmentation' } };
  }

  const rgbA = normalizeColorToRGB(colorAConfig);
  const rgbB = normalizeColorToRGB(colorBConfig);
  if (!rgbA || !rgbB) {
    console.warn('[ColorDetector] Invalid color configs, returning None');
    return { suggestion: 'None', stats: { mode: 'arm-segmentation' } };
  }

  try {
    const imageElement = await loadImageElement(frameDataUrl);
    const width = imageElement.naturalWidth || imageElement.width;
    const height = imageElement.naturalHeight || imageElement.height;

    const segmenter = await getImageSegmenter();
    const results = segmenter.segment(imageElement);

    if (!results.categoryMask) {
      return {
        suggestion: 'None',
        stats: {
          mode: 'arm-segmentation',
          width,
          height,
          reason: 'no_segmentation_mask'
        }
      };
    }

    // Get the category mask data
    // MediaPipe returns categoryMask as ImageData or similar format
    let maskData;
    let maskWidth = width;
    let maskHeight = height;

    try {
      // MediaPipe returns categoryMask as an object with a canvas property (OffscreenCanvas)
      // We need to read ImageData from that canvas
      if (results.categoryMask && results.categoryMask.canvas) {
        // It has a canvas property - read from it
        const maskCanvas = results.categoryMask.canvas;
        try {
          const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
          if (!maskCtx) {
            throw new Error('Could not get 2d context from canvas');
          }
          const imageData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
          maskData = imageData.data;
          maskWidth = maskCanvas.width;
          maskHeight = maskCanvas.height;
          console.log('[ColorDetector] Using canvas property, dimensions:', maskWidth, 'x', maskHeight, 'data length:', maskData.length);
        } catch (ctxErr) {
          // If we can't read from OffscreenCanvas directly, try to transfer it
          console.warn('[ColorDetector] Failed to read from canvas directly, trying transfer:', ctxErr);
          if (maskCanvas.transferToImageBitmap) {
            const bitmap = maskCanvas.transferToImageBitmap();
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = bitmap.width;
            tempCanvas.height = bitmap.height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(bitmap, 0, 0);
            const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
            maskData = imageData.data;
            maskWidth = tempCanvas.width;
            maskHeight = tempCanvas.height;
            console.log('[ColorDetector] Using transferred bitmap, dimensions:', maskWidth, 'x', maskHeight);
          } else {
            throw ctxErr;
          }
        }
      } else if (results.categoryMask instanceof ImageData) {
        maskData = results.categoryMask.data;
        maskWidth = results.categoryMask.width;
        maskHeight = results.categoryMask.height;
        console.log('[ColorDetector] Using ImageData format, dimensions:', maskWidth, 'x', maskHeight, 'data length:', maskData.length);
      } else if (results.categoryMask && results.categoryMask.data) {
        // If it has a data property (might be ImageData-like)
        maskData = results.categoryMask.data;
        if (results.categoryMask.width) maskWidth = results.categoryMask.width;
        if (results.categoryMask.height) maskHeight = results.categoryMask.height;
        console.log('[ColorDetector] Using data property, dimensions:', maskWidth, 'x', maskHeight, 'data length:', maskData.length);
      } else if (results.categoryMask instanceof Uint8ClampedArray ||
        results.categoryMask instanceof Uint8Array) {
        // Direct array
        maskData = results.categoryMask;
        console.log('[ColorDetector] Using direct array, length:', maskData.length);
      } else if (results.categoryMask instanceof HTMLCanvasElement ||
        results.categoryMask instanceof OffscreenCanvas) {
        // Direct canvas
        const maskCtx = results.categoryMask.getContext('2d');
        const imageData = maskCtx.getImageData(0, 0, results.categoryMask.width, results.categoryMask.height);
        maskData = imageData.data;
        maskWidth = results.categoryMask.width;
        maskHeight = results.categoryMask.height;
        console.log('[ColorDetector] Using direct canvas, dimensions:', maskWidth, 'x', maskHeight, 'data length:', maskData.length);
      } else {
        // Try to create ImageData from the mask
        // MediaPipe might return it as a canvas or need conversion
        console.warn('[ColorDetector] Unexpected categoryMask type:', typeof results.categoryMask,
          'constructor:', results.categoryMask?.constructor?.name,
          'has canvas:', !!results.categoryMask?.canvas,
          'value:', results.categoryMask);
        throw new Error('Unsupported categoryMask format');
      }
    } catch (err) {
      console.error('[ColorDetector] Error accessing categoryMask:', err);
      return {
        suggestion: 'None',
        stats: {
          mode: 'arm-segmentation',
          width,
          height,
          reason: 'category_mask_access_error',
          error: err.message
        }
      };
    }

    // Get original image data for color checking
    const videoCanvas = document.createElement('canvas');
    videoCanvas.width = width;
    videoCanvas.height = height;
    const videoCtx = videoCanvas.getContext('2d');
    videoCtx.drawImage(imageElement, 0, 0, width, height);
    const videoData = videoCtx.getImageData(0, 0, width, height).data;

    // Categories: 0=background, 1=hair, 2=body-skin, 3=face-skin, 4=clothes, 5=others
    // We'll look for body-skin (2) and clothes (4) as potential arms
    const ARM_CATEGORIES = [2, 4]; // body-skin and clothes

    const {
      anchor = 'bottom',
      colorThreshold = 95,
      minArmPixels = 100
    } = options;

    // Determine if mask is RGBA (4 bytes per pixel) or single channel (1 byte per pixel)
    const maskPixelCount = maskWidth * maskHeight;
    const isRGBA = maskData.length >= maskPixelCount * 4;
    const bytesPerPixel = isRGBA ? 4 : 1;

    // Scale factors if mask dimensions differ from image dimensions
    const scaleX = width / maskWidth;
    const scaleY = height / maskHeight;

    // Find arm regions
    const armRegions = [];
    const armPixels = new Map(); // category -> Set of pixel indices

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        // Map image coordinates to mask coordinates
        const maskX = Math.floor(x / scaleX);
        const maskY = Math.floor(y / scaleY);
        const maskIdx = (maskY * maskWidth + maskX) * bytesPerPixel;

        if (maskIdx >= 0 && maskIdx < maskData.length) {
          // Category is in the R channel (index 0) for RGBA, or directly for single channel
          const category = maskData[maskIdx];
          if (ARM_CATEGORIES.includes(category)) {
            if (!armPixels.has(category)) {
              armPixels.set(category, new Set());
            }
            armPixels.get(category).add(y * width + x);
          }
        }
      }
    }

    // Analyze each arm category for color matches
    for (const [category, pixelSet] of armPixels.entries()) {
      if (pixelSet.size < minArmPixels) continue;

      // Check colors in this arm region
      let pixelsA = 0;
      let pixelsB = 0;
      let minY = height;
      let maxY = -1;

      const sqThresh = colorThreshold * colorThreshold;

      for (const pixelIdx of pixelSet) {
        const y = Math.floor(pixelIdx / width);
        const x = pixelIdx % width;
        const vidIdx = (y * width + x) * 4;

        const r = videoData[vidIdx];
        const g = videoData[vidIdx + 1];
        const b = videoData[vidIdx + 2];

        const dA = rgbDistanceSq({ r, g, b }, rgbA);
        const dB = rgbDistanceSq({ r, g, b }, rgbB);

        if (dA < sqThresh && dA < dB) {
          pixelsA += 1;
        } else if (dB < sqThresh && dB < dA) {
          pixelsB += 1;
        }

        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }

      // Determine which color is dominant in this arm
      const totalColored = pixelsA + pixelsB;
      if (totalColored > 0) {
        const dominantColor = pixelsA > pixelsB ? 'A' : 'B';
        const anchorY = anchor === 'top' ? minY : maxY;

        armRegions.push({
          category,
          pixelsA,
          pixelsB,
          totalColored,
          dominantColor,
          minY,
          maxY,
          anchorY,
          pixelCount: pixelSet.size
        });
      }
    }

    if (armRegions.length === 0) {
      return {
        suggestion: 'None',
        stats: {
          mode: 'arm-segmentation',
          width,
          height,
          reason: 'no_arms_with_matching_colors'
        }
      };
    }

    // Find the arm closest to the anchor with a matching color
    let bestArm = null;
    let bestDistance = Infinity;

    for (const arm of armRegions) {
      const distance = anchor === 'top' ? arm.anchorY : height - arm.anchorY;
      if (distance < bestDistance && arm.dominantColor) {
        bestDistance = distance;
        bestArm = arm;
      }
    }

    const suggestion = bestArm?.dominantColor || 'None';

    // Create preview showing only arms
    let preview = null;
    let maskPreview = null;
    try {
      const previewCanvas = document.createElement('canvas');
      previewCanvas.width = width;
      previewCanvas.height = height;
      const previewCtx = previewCanvas.getContext('2d');

      // Draw original image
      previewCtx.drawImage(imageElement, 0, 0, width, height);

      // Apply color mask overlay only on arm regions
      const imageData = previewCtx.getImageData(0, 0, width, height);
      const pixels = imageData.data;

      const tintA = { r: 255, g: 82, b: 97 };
      const tintB = { r: 80, g: 170, b: 255 };

      for (const [category, pixelSet] of armPixels.entries()) {
        for (const pixelIdx of pixelSet) {
          const y = Math.floor(pixelIdx / width);
          const x = pixelIdx % width;
          const vidIdx = (y * width + x) * 4;
          const idx = vidIdx;

          const r = videoData[vidIdx];
          const g = videoData[vidIdx + 1];
          const b = videoData[vidIdx + 2];

          const dA = rgbDistanceSq({ r, g, b }, rgbA);
          const dB = rgbDistanceSq({ r, g, b }, rgbB);
          const sqThresh = colorThreshold * colorThreshold;

          if (dA < sqThresh && dA < dB) {
            pixels[idx] = Math.round(pixels[idx] * 0.3 + tintA.r * 0.7);
            pixels[idx + 1] = Math.round(pixels[idx + 1] * 0.3 + tintA.g * 0.7);
            pixels[idx + 2] = Math.round(pixels[idx + 2] * 0.3 + tintA.b * 0.7);
          } else if (dB < sqThresh && dB < dA) {
            pixels[idx] = Math.round(pixels[idx] * 0.3 + tintB.r * 0.7);
            pixels[idx + 1] = Math.round(pixels[idx + 1] * 0.3 + tintB.g * 0.7);
            pixels[idx + 2] = Math.round(pixels[idx + 2] * 0.3 + tintB.b * 0.7);
          }
        }
      }

      previewCtx.putImageData(imageData, 0, 0);
      preview = previewCanvas.toDataURL('image/png');

      // Create mask preview showing only arms (white = arm, black = background)
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = width;
      maskCanvas.height = height;
      const maskCtx = maskCanvas.getContext('2d');
      const maskImageData = maskCtx.createImageData(width, height);
      const maskPixels = maskImageData.data;

      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const imgIdx = (y * width + x) * 4;
          // Map image coordinates to mask coordinates
          const maskX = Math.floor(x / scaleX);
          const maskY = Math.floor(y / scaleY);
          const maskIdx = (maskY * maskWidth + maskX) * bytesPerPixel;

          let isArm = false;
          if (maskIdx >= 0 && maskIdx < maskData.length) {
            const category = maskData[maskIdx];
            isArm = ARM_CATEGORIES.includes(category);
          }

          const value = isArm ? 255 : 0;
          maskPixels[imgIdx] = value;
          maskPixels[imgIdx + 1] = value;
          maskPixels[imgIdx + 2] = value;
          maskPixels[imgIdx + 3] = 255;
        }
      }

      maskCtx.putImageData(maskImageData, 0, 0);
      maskPreview = maskCanvas.toDataURL('image/png');
    } catch (previewError) {
      console.warn('[ColorDetector] Failed generating arm preview', previewError);
    }

    const stats = {
      mode: 'arm-segmentation',
      width,
      height,
      colorThreshold,
      anchor,
      armRegions: armRegions.map(arm => ({
        category: arm.category,
        categoryName: arm.category === 2 ? 'body-skin' : 'clothes',
        pixelsA: arm.pixelsA,
        pixelsB: arm.pixelsB,
        dominantColor: arm.dominantColor,
        minY: arm.minY,
        maxY: arm.maxY,
        anchorY: arm.anchorY,
        pixelCount: arm.pixelCount
      })),
      bestArm: bestArm ? {
        category: bestArm.category,
        categoryName: bestArm.category === 2 ? 'body-skin' : 'clothes',
        dominantColor: bestArm.dominantColor,
        anchorY: bestArm.anchorY
      } : null
    };

    return { suggestion, stats, preview, maskPreview };
  } catch (error) {
    console.error('[ColorDetector] Arm segmentation failed:', error);
    throw error;
  }
};

/**
 * Run multiclass segmentation and return visualization for all 6 classes
 * For Class 0 (Background), uses confidence threshold (same as identifyPlayersByAllAll)
 */
const getMulticlassSegmentation = async (imageSource, options = {}) => {
  try {
    const imageElement = await loadImageElement(imageSource);
    const width = imageElement.naturalWidth || imageElement.width;
    const height = imageElement.naturalHeight || imageElement.height;

    // Use the same segmenter instance/config
    const segmenter = await getImageSegmenter();
    const results = segmenter.segment(imageElement);

    if (!results.categoryMask) {
      throw new Error('No category mask returned');
    }

    // Background confidence threshold (same as identifyPlayersByAllAll)
    // 0.8 = if model is less than 80% sure it's background, we consider it foreground
    const backgroundThreshold = options.sensitivity || 0.85;

    // Get background confidence mask for Class 0
    let bgConfidenceMask = null;
    let bgMaskWidth = width;
    let bgMaskHeight = height;
    if (results.confidenceMasks && results.confidenceMasks[0]) {
      bgConfidenceMask = results.confidenceMasks[0].getAsFloat32Array();
      bgMaskWidth = results.confidenceMasks[0].width;
      bgMaskHeight = results.confidenceMasks[0].height;
    }

    // Classes defined by the model
    const classes = [
      { id: 0, name: 'Background', desc: 'Walls, ceiling, screen', color: [0, 0, 0] },
      { id: 1, name: 'Hair', desc: 'Hair', color: [255, 140, 0] }, // Dark Orange
      { id: 2, name: 'Body Skin', desc: 'Arms, neck (Your "Arm" layer)', color: [255, 0, 0] }, // Red
      { id: 3, name: 'Face Skin', desc: 'Face skin', color: [255, 200, 100] }, // Skin tone
      { id: 4, name: 'Clothes', desc: 'T-shirt, etc.', color: [0, 100, 255] }, // Blue
      { id: 5, name: 'Others', desc: 'Accessories (Watch, wristband)', color: [255, 255, 0] } // Yellow
    ];

    // Extract category mask data (for classes 1-5)
    let maskData;
    if (results.categoryMask.getAsUint8Array) {
      maskData = results.categoryMask.getAsUint8Array();
    } else if (results.categoryMask.canvas) {
      // Fallback if getAsUint8Array is missing (e.g. older version or different mode)
      const ctx = results.categoryMask.canvas.getContext('2d');
      maskData = ctx.getImageData(0, 0, width, height).data;
      // If data is RGBA, we need to extract one channel or assume grayscale
      if (maskData.length === width * height * 4) {
        const temp = new Uint8Array(width * height);
        for (let i = 0; i < width * height; i++) temp[i] = maskData[i * 4];
        maskData = temp;
      }
    } else if (results.categoryMask instanceof Uint8Array) {
      maskData = results.categoryMask;
    } else {
      // Attempt generic extraction (ImageData-like)
      const d = results.categoryMask.data || results.categoryMask;
      if (d.length === width * height * 4) {
        const temp = new Uint8Array(width * height);
        for (let i = 0; i < width * height; i++) temp[i] = d[i * 4];
        maskData = temp;
      } else {
        maskData = d;
      }
    }

    // Calculate scale factors for confidence mask (may be different size than image)
    const scaleX = bgMaskWidth / width;
    const scaleY = bgMaskHeight / height;

    // Generate preview for each class
    const classResults = await Promise.all(classes.map(async (cls) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      // Draw original image
      ctx.drawImage(imageElement, 0, 0, width, height);

      // Overlay mask
      const imageData = ctx.getImageData(0, 0, width, height);
      const data = imageData.data;
      let pixelCount = 0;

      if (cls.id === 0 && bgConfidenceMask) {
        // For Background class: use confidence threshold logic
        // "Background" = pixels where model is >= backgroundThreshold confident it's background
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const i = y * width + x;

            // Map to confidence mask coordinates
            const maskX = Math.min(bgMaskWidth - 1, Math.floor(x * scaleX));
            const maskY = Math.min(bgMaskHeight - 1, Math.floor(y * scaleY));
            const maskIdx = maskY * bgMaskWidth + maskX;
            const bgConfidence = bgConfidenceMask[maskIdx];

            // If bgConfidence >= threshold, it's background (darken it)
            // This matches identifyPlayersByAllAll where bgConfidence < threshold = foreground
            if (bgConfidence >= backgroundThreshold) {
              pixelCount++;
              const idx = i * 4;
              // Darken background pixels significantly (keep 25% brightness)
              data[idx] = data[idx] * 0.25;
              data[idx + 1] = data[idx + 1] * 0.25;
              data[idx + 2] = data[idx + 2] * 0.25;
            }
          }
        }
      } else {
        // For other classes: use category mask
        for (let i = 0; i < maskData.length; i++) {
          if (maskData[i] === cls.id) {
            pixelCount++;
            const idx = i * 4;
            // Standard 50/50 blend for other classes
            data[idx] = (data[idx] + cls.color[0]) / 2;
            data[idx + 1] = (data[idx + 1] + cls.color[1]) / 2;
            data[idx + 2] = (data[idx + 2] + cls.color[2]) / 2;
          }
        }
      }

      ctx.putImageData(imageData, 0, 0);

      // Add threshold info label for Background class
      if (cls.id === 0) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(10, 10, 200, 30);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 12px Arial';
        ctx.fillText(`Threshold: ${backgroundThreshold}`, 20, 30);
      }

      return {
        ...cls,
        pixelCount,
        preview: canvas.toDataURL('image/png')
      };
    }));

    return classResults;

  } catch (err) {
    console.error('[ColorDetector] Multiclass segmentation failed:', err);
    return null;
  }
};

export {
  identifyPlayerByColor,
  identifyPlayerBySegmentation,
  identifyPlayerByArmSegmentation,
  identifyPlayersByCloth,
  normalizeColorToRGB,
  getMulticlassSegmentation,
  loadImageElement // Export needed for modal if it calls it directly, though here we wrap it
};

