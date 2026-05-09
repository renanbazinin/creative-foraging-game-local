import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Hands } from '@mediapipe/hands/hands';
import { Camera } from '@mediapipe/camera_utils/camera_utils';
import './BraceletDetector.css';

// Standalone sandbox copy of the bracelet detector for experimenting
function Tests() {
  return (
    <div style={{ padding: 12 }}>
      <h2 style={{ margin: '8px 0 12px' }}>Tests Sandbox</h2>
      <p style={{ marginTop: 0, opacity: 0.8 }}>
        This is an isolated copy of the Bracelet Detector for experimentation. Changes here will not affect the main detector.
      </p>
      <BraceletDetectorTest />
    </div>
  );
}

const ENABLE_DETECTOR = true; // Master switch for sandbox
const DEBUG = true;
const dbgGlobal = (...args) => { if (DEBUG) console.log('[Detector-Test]', ...args); };

// LocalStorage keys (reuse the same keys to compare behavior; adjust if you want isolation)
const LS_KEYS = {
  roiSize: 'detectorRoiSize',
  hueWeight: 'detectorHueWeight',
  satWeight: 'detectorSatWeight',
  valWeight: 'detectorValWeight',
  sensitivity: 'detectorSensitivity',
};

function BraceletDetectorTest() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const handsRef = useRef(null);
  const cameraRef = useRef(null);
  const [isMinimized, setIsMinimized] = useState(false);
  const [status, setStatus] = useState('None');
  const [detectionLog, setDetectionLog] = useState([]);
  const [cameraError, setCameraError] = useState(null);
  const [calibrationA, setCalibrationA] = useState(null);
  const [calibrationB, setCalibrationB] = useState(null);
  const calibrationARef = useRef(null);
  const calibrationBRef = useRef(null);

  const getLSNumber = (key, fallback) => {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const v = parseFloat(raw);
    return Number.isFinite(v) ? v : fallback;
  };

  const [detectorSettings, setDetectorSettings] = useState(() => ({
    roiSize: (() => { const v = getLSNumber(LS_KEYS.roiSize, 44); return v > 10 ? v : 44; })(),
    hueWeight: getLSNumber(LS_KEYS.hueWeight, 4.0),
    satWeight: getLSNumber(LS_KEYS.satWeight, 2.0),
    valWeight: getLSNumber(LS_KEYS.valWeight, 1.0),
    sensitivity: getLSNumber(LS_KEYS.sensitivity, 0.0),
  }));
  const detectorSettingsRef = useRef(detectorSettings);
  const debugCounterRef = useRef(0);
  // Live belief metrics for UI
  const statsRef = useRef({ percentA: 0, percentB: 0, wshareA: null, wshareB: null, considered: 0 });
  // Background model reference (full-frame capture)
  const bgRef = useRef(null);
  // Extra sandbox-only settings (static for now; could expose UI sliders later)
  const [testSettings] = useState({
    bgDiffThreshold: 30,          // Sum absolute RGB difference required to treat pixel as foreground
    minCompArea: 25,              // Minimum connected component area (pixels) after morph filtering
    maxCompArea: 2500,            // Maximum connected component area (ignore huge blobs)
    globalRoi: { x: 0.0, y: 0.0, w: 1.0, h: 1.0 }, // Fractional ROI limiting where wrist center must lie
    morphIterations: 1,           // Iterations of morphological opening
  });
  const testSettingsRef = useRef(testSettings);

  const streamRef = useRef(null);
  const isMounted = useRef(false);
  const requestIdRef = useRef(0);
  const initializedForRequestRef = useRef(null);

  const dbg = useCallback((...args) => {
    if (DEBUG) console.log('[Detector-Test]', ...args);
  }, []);

  const addVideoEventListeners = () => {};
  const removeVideoEventListeners = useCallback(() => {}, []);

  const requestCameraPermission = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    if (streamRef.current) {
      dbg('Stopping existing stream before requesting new one.');
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    addVideoEventListeners(video);
    const myRequestId = ++requestIdRef.current;
    initializedForRequestRef.current = null;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (!isMounted.current || myRequestId !== requestIdRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      streamRef.current = stream;
      video.srcObject = stream;

      await new Promise((resolve) => {
        const alreadyReady = video.readyState >= 1 && video.videoWidth > 0 && video.videoHeight > 0;
        if (alreadyReady) return resolve();
        const onLoaded = () => { video.removeEventListener('loadedmetadata', onLoaded); resolve(); };
        video.addEventListener('loadedmetadata', onLoaded, { once: true });
        setTimeout(() => { video.removeEventListener('loadedmetadata', onLoaded); resolve(); }, 1500);
      });

      if (!isMounted.current || myRequestId !== requestIdRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }

      try { await video.play(); } catch { /* ignore */ }

      if (initializedForRequestRef.current !== myRequestId) {
        initializedForRequestRef.current = myRequestId;
        initializeMediaPipe();
      }
    } catch (error) {
      console.error('[Detector-Test] Error accessing camera:', error);
      setCameraError(`MediaPipe error: ${error.message}`);
    }
  }, [dbg, removeVideoEventListeners]);

  const hsvToCssColor = (h, s, v) => {
    const H = (h || 0) * 2;
    const S = (s || 0) / 255;
    const V = (v || 0) / 255;
    const C = V * S;
    const X = C * (1 - Math.abs(((H / 60) % 2) - 1));
    const m = V - C;
    let r1 = 0, g1 = 0, b1 = 0;
    if (H >= 0 && H < 60)      { r1 = C; g1 = X; b1 = 0; }
    else if (H < 120)          { r1 = X; g1 = C; b1 = 0; }
    else if (H < 180)          { r1 = 0; g1 = C; b1 = X; }
    else if (H < 240)          { r1 = 0; g1 = X; b1 = C; }
    else if (H < 300)          { r1 = X; g1 = 0; b1 = C; }
    else                       { r1 = C; g1 = 0; b1 = X; }
    const r = Math.round((r1 + m) * 255);
    const g = Math.round((g1 + m) * 255);
    const b = Math.round((b1 + m) * 255);
    return `rgb(${r}, ${g}, ${b})`;
  };

  const calibToCss = (calib) => calib ? hsvToCssColor(calib.h, calib.s, calib.v) : '#ffffff';

  const getStatusCssColor = (st) => {
    if (st === 'Player A' && calibrationA) return calibToCss(calibrationA);
    if (st === 'Player B' && calibrationB) return calibToCss(calibrationB);
    return '#ffffff';
  };

  useEffect(() => {
    isMounted.current = true;

    const loadCalibs = () => {
      try {
        const a = JSON.parse(localStorage.getItem('calibrationA') || 'null');
        const b = JSON.parse(localStorage.getItem('calibrationB') || 'null');
        if (a) setCalibrationA({ h: a.h, s: a.s, v: a.v });
        if (b) setCalibrationB({ h: b.h, s: b.s, v: b.v });
      } catch {}
    };
    loadCalibs();

    requestCameraPermission();

    return () => {
      isMounted.current = false;
      requestIdRef.current += 1;
      if (cameraRef.current) { cameraRef.current.stop(); cameraRef.current = null; }
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
      const video = videoRef.current; if (video) { video.srcObject = null; }
      if (handsRef.current) { handsRef.current.close(); handsRef.current = null; }
    };
  }, [requestCameraPermission]);

  useEffect(() => { calibrationARef.current = calibrationA; }, [calibrationA]);
  useEffect(() => { calibrationBRef.current = calibrationB; }, [calibrationB]);
  useEffect(() => { detectorSettingsRef.current = detectorSettings; }, [detectorSettings]);
  useEffect(() => { testSettingsRef.current = testSettings; }, [testSettings]);

  const initializeMediaPipe = async () => {
    try {
      const HandsCtor = await (async () => {
        try { if (typeof Hands === 'function') return Hands; } catch {}
        if (typeof window !== 'undefined' && window.Hands && typeof window.Hands === 'function') {
          return window.Hands;
        }
        await new Promise((resolve, reject) => {
          const id = 'mp-hands-cdn-script-test';
          if (document.getElementById(id)) return resolve();
          const s = document.createElement('script');
          s.id = id;
          s.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js';
          s.async = true;
          s.onload = () => resolve();
          s.onerror = () => reject(new Error('Failed to load MediaPipe Hands'));
          document.head.appendChild(s);
        });
        if (window.Hands && typeof window.Hands === 'function') return window.Hands;
        throw new Error('MediaPipe Hands constructor not available');
      })();

      const hands = new HandsCtor({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
      });

      hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });

      hands.onResults(onResults);
      handsRef.current = hands;

      if (videoRef.current) {
        const CameraCtor = await (async () => {
          try { if (typeof Camera === 'function') return Camera; } catch {}
          if (typeof window !== 'undefined' && window.Camera && typeof window.Camera === 'function') {
            return window.Camera;
          }
          await new Promise((resolve, reject) => {
            const id = 'mp-camera-utils-cdn-script-test';
            if (document.getElementById(id)) return resolve();
            const s = document.createElement('script');
            s.id = id;
            s.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js';
            s.async = true;
            s.onload = () => resolve();
            s.onerror = () => reject(new Error('Failed to load MediaPipe Camera'));
            document.head.appendChild(s);
          });
          if (window.Camera && typeof window.Camera === 'function') return window.Camera;
          throw new Error('MediaPipe Camera constructor not available');
        })();

        const camera = new CameraCtor(videoRef.current, {
          onFrame: async () => { await hands.send({ image: videoRef.current }); },
          width: 640,
          height: 480
        });
        camera.start();
        cameraRef.current = camera;
      }
    } catch (err) {
      console.error('[Detector-Test] MediaPipe initialization error:', err);
      setCameraError(`MediaPipe error: ${err.message}`);
    }
  };

  const onResults = (results) => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
    ctx.restore();

    // Draw global ROI (if not full frame)
    const { globalRoi } = testSettingsRef.current;
    if (globalRoi.w < 0.999 || globalRoi.h < 0.999 || globalRoi.x > 0 || globalRoi.y > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,165,0,0.6)';
      ctx.setLineDash([6,4]);
      const gx = globalRoi.x * canvas.width;
      const gy = globalRoi.y * canvas.height;
      const gw = globalRoi.w * canvas.width;
      const gh = globalRoi.h * canvas.height;
      ctx.lineWidth = 2;
      ctx.strokeRect(gx, gy, gw, gh);
      ctx.restore();
    }

    let detectedStatus = 'None';

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      let highestHand = null;
      let highestY = 1;

      results.multiHandLandmarks.forEach(landmarks => {
        const wrist = landmarks[0];
        if (wrist.y < highestY) { highestY = wrist.y; highestHand = landmarks; }
      });

      results.multiHandLandmarks.forEach(landmarks => {
        drawLandmarks(ctx, landmarks, canvas.width, canvas.height);
      });

      if (highestHand) {
        const wrist = highestHand[0];
        const wristX = (1 - wrist.x) * canvas.width;
        const wristY = wrist.y * canvas.height;

        // Enforce global ROI: if wrist center outside, skip detection
        const { globalRoi } = testSettingsRef.current;
        const gx = globalRoi.x * canvas.width;
        const gy = globalRoi.y * canvas.height;
        const gw = globalRoi.w * canvas.width;
        const gh = globalRoi.h * canvas.height;
        if (!(wristX >= gx && wristX <= gx + gw && wristY >= gy && wristY <= gy + gh)) {
          setStatus('None');
          ctx.fillStyle = 'orange';
          ctx.font = '14px Arial';
          ctx.fillText('WRIST OUTSIDE ROI', 10, 68);
          return;
        }

        ctx.fillStyle = 'orange';
        ctx.beginPath(); ctx.arc(wristX, wristY, 10, 0, 2 * Math.PI); ctx.fill();
        ctx.fillStyle = 'orange'; ctx.font = '16px Arial'; ctx.fillText('SELECTED (TEST)', wristX - 70, wristY - 15);

        const roiSize = Math.max(10, Math.min(300, Math.floor(detectorSettingsRef.current?.roiSize || 60)));
        const halfSize = roiSize / 2;
        const x1 = Math.max(0, wristX - halfSize);
        const y1 = Math.max(0, wristY - halfSize);
        const x2 = Math.min(canvas.width, wristX + halfSize);
        const y2 = Math.min(canvas.height, wristY + halfSize);

        ctx.strokeStyle = 'orange'; ctx.lineWidth = 3; ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

        const roiData = ctx.getImageData(x1, y1, x2 - x1, y2 - y1);
        const calibA = calibrationARef.current;
        const calibB = calibrationBRef.current;
        detectedStatus = decideBinaryAorB(roiData, calibA, calibB, x1, y1);
      }
    }

    let color = '#ffffff';
    if (detectedStatus === 'Player A' && calibrationARef.current) {
      color = calibToCss(calibrationARef.current);
    } else if (detectedStatus === 'Player B' && calibrationBRef.current) {
      color = calibToCss(calibrationBRef.current);
    }

    ctx.fillStyle = color;
    ctx.font = 'bold 28px Arial';
    ctx.fillText(`Status (TEST): ${detectedStatus}`, 10, 40);

    setStatus(detectedStatus);
  };

  const drawLandmarks = (ctx, landmarks, width, height) => {
    ctx.strokeStyle = 'white'; ctx.lineWidth = 2;
    const connections = [
      [0,1],[1,2],[2,3],[3,4],
      [0,5],[5,6],[6,7],[7,8],
      [5,9],[9,13],[13,17],
      [0,9],[9,10],[10,11],[11,12],
      [0,13],[13,14],[14,15],[15,16],
      [0,17],[17,18],[18,19],[19,20],
    ];
    connections.forEach(([s,e]) => {
      const a = landmarks[s]; const b = landmarks[e];
      ctx.beginPath();
      ctx.moveTo((1 - a.x) * width, a.y * height);
      ctx.lineTo((1 - b.x) * width, b.y * height);
      ctx.stroke();
    });

    landmarks.forEach(landmark => {
      ctx.fillStyle = 'red';
      ctx.beginPath(); ctx.arc((1 - landmark.x) * width, landmark.y * height, 5, 0, 2 * Math.PI); ctx.fill();
    });
  };

// Morphological helpers (3x3 structuring element)
const erode = (mask, w, h) => {
  const out = new Uint8Array(mask.length);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let keep = 1;
      const idx = y * w + x;
      if (!mask[idx]) { out[idx] = 0; continue; }
      for (let yy = -1; yy <= 1 && keep; yy++) {
        for (let xx = -1; xx <= 1; xx++) {
          if (!mask[(y + yy) * w + (x + xx)]) { keep = 0; break; }
        }
      }
      out[idx] = keep;
    }
  }
  return out;
};
const dilate = (mask, w, h) => {
  const out = new Uint8Array(mask.length);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let any = 0;
      for (let yy = -1; yy <= 1 && !any; yy++) {
        for (let xx = -1; xx <= 1; xx++) {
          if (mask[(y + yy) * w + (x + xx)]) { any = 1; break; }
        }
      }
      out[y * w + x] = any;
    }
  }
  return out;
};

// Connected components labeling (4-neighbor)
const filterComponentsByArea = (mask, w, h, minArea, maxArea) => {
  const visited = new Uint8Array(mask.length);
  const stack = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || visited[i]) continue;
    let area = 0;
    stack.push(i);
    visited[i] = 1;
    const pixels = [];
    while (stack.length) {
      const idx = stack.pop();
      pixels.push(idx);
      area++;
      const x = idx % w;
      const y = (idx - x) / w;
      // neighbors (4)
      if (x > 0) {
        const n = idx - 1; if (mask[n] && !visited[n]) { visited[n] = 1; stack.push(n); }
      }
      if (x < w - 1) {
        const n = idx + 1; if (mask[n] && !visited[n]) { visited[n] = 1; stack.push(n); }
      }
      if (y > 0) {
        const n = idx - w; if (mask[n] && !visited[n]) { visited[n] = 1; stack.push(n); }
      }
      if (y < h - 1) {
        const n = idx + w; if (mask[n] && !visited[n]) { visited[n] = 1; stack.push(n); }
      }
    }
    const keep = area >= minArea && area <= maxArea;
    if (!keep) {
      // zero out component
      for (const p of pixels) mask[p] = 0;
    }
  }
};

const decideBinaryAorB = (imageData, calibA, calibB, roiX, roiY) => {
    const data = imageData.data;
    // Single calibration shortcuts
    if (calibA && !calibB) return 'Player A';
    if (calibB && !calibA) return 'Player B';
    if (!calibA && !calibB) return 'None';

    // Hue-only approach: ignore saturation/value distance; keep a tiny s/v floor to avoid gray/black/white noise
    const wH = detectorSettingsRef.current?.hueWeight ?? 4.0; // not used directly but kept for future tuning
    const { bgDiffThreshold, minCompArea, maxCompArea, morphIterations } = testSettingsRef.current;
    const bg = bgRef.current;

    let votesA = 0;
    let votesB = 0;
    let considered = 0;

    const w = imageData.width;
    const h = imageData.height;
    // Classification arrays
    const cls = new Uint8Array(w * h); // 0 none, 1 A, 2 B
    let mask = new Uint8Array(w * h);  // candidate foreground mask (A or B)

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const [hue, s, v] = rgbToHsv(r, g, b);

      // Minimal check to avoid pure gray/white/black noise
      if (s < 20 || v < 20) continue;

      // Background subtraction (if model captured)
      if (bg) {
        // Map ROI pixel to full-frame index
        const pixelIndex = i / 4; // pixel number inside ROI
        const px = pixelIndex % w;
        const py = (pixelIndex - px) / w;
        if (px + roiX < bg.width && py + roiY < bg.height) {
          const bgIdx = ((py + roiY) * bg.width + (px + roiX)) * 4;
          const dr = Math.abs(r - bg.data[bgIdx]);
          const dg = Math.abs(g - bg.data[bgIdx + 1]);
            const db = Math.abs(b - bg.data[bgIdx + 2]);
          if ((dr + dg + db) < bgDiffThreshold) continue; // static background pixel
        }
      }

      // Pure hue distance (0..180 wrap)
  const dhA = Math.min(Math.abs(hue - calibA.h), 180 - Math.abs(hue - calibA.h));
  const dhB = Math.min(Math.abs(hue - calibB.h), 180 - Math.abs(hue - calibB.h));

      // Simple hue gates: within +/-20 degrees (10 units on 0..180 scale)
      const isCloseToA = dhA < 10;
      const isCloseToB = dhB < 10;

      if (isCloseToA || isCloseToB) {
        const pixelIndex = i / 4;
        mask[pixelIndex] = 1;
        if (isCloseToA && !isCloseToB) cls[pixelIndex] = 1;
        else if (isCloseToB && !isCloseToA) cls[pixelIndex] = 2;
        else { // both
          cls[pixelIndex] = dhA < dhB ? 1 : 2;
        }
      }
    }

    // Morphological opening to reduce noise
    for (let iter = 0; iter < morphIterations; iter++) {
      const er = erode(mask, w, h); // erode
      mask = dilate(er, w, h);      // dilate
    }
    // Remove components outside area range
    filterComponentsByArea(mask, w, h, minCompArea, maxCompArea);

    // Aggregate votes only for surviving mask pixels
    for (let p = 0; p < mask.length; p++) {
      if (!mask[p]) continue;
      if (cls[p] === 1) votesA++; else if (cls[p] === 2) votesB++;
      considered++;
    }

    if (considered < 10) return 'None';

    const percentA = votesA / considered;
    const percentB = votesB / considered;

    // Update UI stats (percent-based)
    statsRef.current = { percentA, percentB, wshareA: null, wshareB: null, considered };

    const margin = 0.10; // require ~10% margin over 50%
    if (percentA > 0.5 + margin) return 'Player A';
    if (percentB > 0.5 + margin) return 'Player B';
    return 'None';
  };

  const rgbToHsv = (r, g, b) => {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r,g,b); const min = Math.min(r,g,b);
    const delta = max - min; let h = 0;
    if (delta !== 0) {
      if (max === r) h = 60 * (((g - b) / delta) % 6);
      else if (max === g) h = 60 * ((b - r) / delta + 2);
      else h = 60 * ((r - g) / delta + 4);
    }
    if (h < 0) h += 360;
    const s = max === 0 ? 0 : (delta / max) * 255; const v = max * 255;
    return [h / 2, s, v];
  };

  const downloadLogs = () => {
    const logs = JSON.parse(localStorage.getItem('braceletDetectionsTest') || '[]');
    const jsonBlob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
    const jsonUrl = URL.createObjectURL(jsonBlob);
    const jsonLink = document.createElement('a');
    jsonLink.href = jsonUrl; jsonLink.download = `bracelet_detections_test_${new Date().toISOString().split('T')[0]}.json`;
    jsonLink.click();
  };

  const captureBackground = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    // Copy data buffer to detach from live canvas
    bgRef.current = { width: canvas.width, height: canvas.height, data: new Uint8ClampedArray(img.data) };
    dbg('Background captured');
  };

  const clearBackground = () => { bgRef.current = null; dbg('Background cleared'); };

  return (
    <div className={`detector-window ${isMinimized ? 'minimized' : ''}`}>
      <div className="detector-header">
        <span>Bracelet Detector (Tests)</span>
        <div className="detector-controls">
          <button onClick={downloadLogs} title="Download Logs">📥</button>
          <button onClick={captureBackground} title="Capture Background (no subjects)">🎞️BG</button>
          <button onClick={clearBackground} title="Clear Background Model">♻️BG</button>
          <button onClick={() => setIsMinimized(!isMinimized)}>
            {isMinimized ? '▢' : '−'}
          </button>
        </div>
      </div>

      <div className="detector-content" style={{ display: isMinimized ? 'none' : 'block' }}>
        <video ref={videoRef} autoPlay playsInline muted={true} style={{ position: 'absolute', top: '-9999px', left: '-9999px', width: 1, height: 1 }} />
        <canvas ref={canvasRef} className="output_canvas" style={{ transform: 'scaleX(-1)' }} />

        <div className="detector-info">
          <div className="status-display">
            Status: <span style={{ color: getStatusCssColor(status), fontWeight: 700 }}>{status}</span>
          </div>
          <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>
            BG: {bgRef.current ? '✔ captured' : '— none'} | CompArea(px): {testSettings.minCompArea}-{testSettings.maxCompArea}
          </div>
          <div className="color-swatches" style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, opacity: 0.8 }}>A</span>
              <span title="Player A calibrated color" style={{ width: 14, height: 14, borderRadius: 3, border: '1px solid #666', display: 'inline-block', background: calibrationA ? calibToCss(calibrationA) : '#444' }} />
              <span style={{ fontSize: 12, opacity: 0.9 }}>
                {(() => {
                  const { wshareA, percentA, considered } = statsRef.current || {};
                  if (!considered) return '—';
                  const p = Number.isFinite(wshareA) ? wshareA : percentA;
                  return `${Math.round(p * 100)}%`;
                })()}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, opacity: 0.8 }}>B</span>
              <span title="Player B calibrated color" style={{ width: 14, height: 14, borderRadius: 3, border: '1px solid #666', display: 'inline-block', background: calibrationB ? calibToCss(calibrationB) : '#444' }} />
              <span style={{ fontSize: 12, opacity: 0.9 }}>
                {(() => {
                  const { wshareB, percentB, considered } = statsRef.current || {};
                  if (!considered) return '—';
                  const p = Number.isFinite(wshareB) ? wshareB : percentB;
                  return `${Math.round(p * 100)}%`;
                })()}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Tests;
