import React, { useEffect, useRef, useState } from 'react';
import { Hands } from '@mediapipe/hands/hands';
import { Camera } from '@mediapipe/camera_utils/camera_utils';
import './BraceletDetector.css';

// BraceletDetector2: two-camera support
// Assumptions: the two cameras are mounted near each other and see approximately the same scene.
// Goal: Classify Player A vs Player B by distance to the screen using vertical position in the frame.
// We assume "nearer to the screen" corresponds to the TOP of the image (smaller y) by default.
//
// ===================== IMPORTANT MAPPING NOTE =====================
// Player selection uses TOP vs BOTTOM of the image:
// - DEFAULT (toggle = true): Player A = top-most hand (smallest y), Player B = bottom-most hand (largest y)
// - Toggle off (useTopCriterion = false): Player A = bottom-most hand (largest y)
//   See the section marked with:  >>> TOP/BOTTOM SELECTION LOGIC <<<
// =================================================================

const DEBUG = true;
const dbg = (...args) => { if (DEBUG) console.log('[Detector2]', ...args); };

// LocalStorage keys for detector tuning
const LS_KEYS = {
  roiSize: 'detectorRoiSize',
  hueWeight: 'detectorHueWeight',
  satWeight: 'detectorSatWeight',
  valWeight: 'detectorValWeight',
  sensitivity: 'detectorSensitivity',
};

function BraceletDetector2() {
  const videoARef = useRef(null);
  const videoBRef = useRef(null);
  const canvasARef = useRef(null);
  const canvasBRef = useRef(null);

  // Use a single shared Hands instance for both cameras to avoid WASM re-init conflicts
  const handsRef = useRef(null);
  const cameraARef = useRef(null);
  const cameraBRef = useRef(null);
  const streamARef = useRef(null);
  const streamBRef = useRef(null);

  const [cameraError, setCameraError] = useState('');
  const [isMinimized, setIsMinimized] = useState(false);
  const [status, setStatus] = useState({ camA: 'None', camB: 'None', merged: 'None' });
  // Runtime toggle: true => Player A is top-most; false => Player A is bottom-most
  const [useTopCriterion, setUseTopCriterion] = useState(true);
  const [calibrationA, setCalibrationA] = useState(null);
  const [calibrationB, setCalibrationB] = useState(null);
  const calibrationARef = useRef(null);
  const calibrationBRef = useRef(null);

  // Helper to safely read numbers from localStorage with defaults
  const getLSNumber = (key, fallback) => {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const v = parseFloat(raw);
    return Number.isFinite(v) ? v : fallback;
  };

  // Detector tuning (ROI size and HSV weights)
  const [detectorSettings, setDetectorSettings] = useState(() => ({
    roiSize: (() => { const v = getLSNumber(LS_KEYS.roiSize, 44); return v > 10 ? v : 44; })(),
    hueWeight: getLSNumber(LS_KEYS.hueWeight, 4.0),
    satWeight: getLSNumber(LS_KEYS.satWeight, 2.0),
    valWeight: getLSNumber(LS_KEYS.valWeight, 1.0),
    sensitivity: getLSNumber(LS_KEYS.sensitivity, 0.0),
  }));
  const detectorSettingsRef = useRef(detectorSettings);

  // Camera device selection
  const [availableDevices, setAvailableDevices] = useState([]);
  const [selectedCamA, setSelectedCamA] = useState('');
  const [selectedCamB, setSelectedCamB] = useState('');

  // On mount: find two cameras and start them
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videos = devices.filter(d => d.kind === 'videoinput');
        if (videos.length === 0) {
          setCameraError('No cameras found');
          return;
        }
        setAvailableDevices(videos);
        const ids = videos.slice(0, 2).map(v => v.deviceId);
        setSelectedCamA(ids[0] || '');
        setSelectedCamB(ids[1] || ids[0] || '');
        await startCamera(ids[0], videoARef, streamARef);
        if (ids[1]) {
          await startCamera(ids[1], videoBRef, streamBRef);
        } else {
          // Only one camera -> duplicate stream for demo (render twice)
          await startCamera(ids[0], videoBRef, streamBRef);
        }
        await ensureSharedHands();
        await initializeMediaPipeFor('A', videoARef, cameraARef);
        await initializeMediaPipeFor('B', videoBRef, cameraBRef);
      } catch (e) {
        if (!mounted) return;
        setCameraError(e?.message || String(e));
      }
    })();

    // Load existing calibrations
    const loadCalibs = () => {
      try {
        const a = JSON.parse(localStorage.getItem('calibrationA') || 'null');
        const b = JSON.parse(localStorage.getItem('calibrationB') || 'null');
        if (a) setCalibrationA({ h: a.h, s: a.s, v: a.v });
        if (b) setCalibrationB({ h: b.h, s: b.s, v: b.v });
      } catch (e) {
        dbg('No existing calibrations');
      }
    };
    loadCalibs();

    // React to changes from calibration page (storage events fire across tabs/origin)
    const onStorage = (ev) => {
      if (!ev || !ev.key) return;
      if (['calibrationA', 'calibrationB'].includes(ev.key)) {
        loadCalibs();
      }
      if ([LS_KEYS.roiSize, LS_KEYS.hueWeight, LS_KEYS.satWeight, LS_KEYS.valWeight, LS_KEYS.sensitivity].includes(ev.key)) {
        setDetectorSettings(prev => ({
          roiSize: (() => { const v = getLSNumber(LS_KEYS.roiSize, prev?.roiSize ?? 44); return v > 10 ? v : (prev?.roiSize ?? 44); })(),
          hueWeight: getLSNumber(LS_KEYS.hueWeight, prev?.hueWeight ?? 4.0),
          satWeight: getLSNumber(LS_KEYS.satWeight, prev?.satWeight ?? 2.0),
          valWeight: getLSNumber(LS_KEYS.valWeight, prev?.valWeight ?? 1.0),
          sensitivity: getLSNumber(LS_KEYS.sensitivity, prev?.sensitivity ?? 0.0),
        }));
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      mounted = false;
      if (cameraARef.current) { cameraARef.current.stop(); cameraARef.current = null; }
      if (cameraBRef.current) { cameraBRef.current.stop(); cameraBRef.current = null; }
      if (streamARef.current) { streamARef.current.getTracks().forEach(t=>t.stop()); streamARef.current = null; }
      if (streamBRef.current) { streamBRef.current.getTracks().forEach(t=>t.stop()); streamBRef.current = null; }
  if (handsRef.current) { try { handsRef.current.close(); } catch {} handsRef.current = null; }
      const vA = videoARef.current; if (vA) vA.srcObject = null;
      const vB = videoBRef.current; if (vB) vB.srcObject = null;
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const startCamera = async (deviceId, videoRef, streamRef) => {
    const constraints = { video: { deviceId: { exact: deviceId } } };
    dbg('Starting camera with deviceId:', deviceId);
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    streamRef.current = stream;
    const v = videoRef.current;
    if (!v) {
      dbg('Video element not found!');
      return;
    }
    v.srcObject = stream;
    dbg('Stream assigned to video element, waiting for metadata...');
    await new Promise((resolve) => {
      const ready = v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0;
      if (ready) {
        dbg('Video already ready:', v.videoWidth, 'x', v.videoHeight);
        return resolve();
      }
      const onLoaded = () => { 
        dbg('loadedmetadata event fired:', v.videoWidth, 'x', v.videoHeight);
        v.removeEventListener('loadedmetadata', onLoaded); 
        resolve(); 
      };
      v.addEventListener('loadedmetadata', onLoaded, { once: true });
      setTimeout(() => { 
        dbg('Metadata timeout - proceeding anyway');
        v.removeEventListener('loadedmetadata', onLoaded); 
        resolve(); 
      }, 2000);
    });
    try { 
      await v.play(); 
      dbg('Video play() succeeded');
    } catch(e) { 
      dbg('Video play() failed:', e); 
    }
  };

  // Global/current frame routing: ensure one frame at a time
  const currentWhichRef = useRef(null);
  const pendingARef = useRef(null);
  const pendingBRef = useRef(null);
  const drainingRef = useRef(false);

  const drainQueue = async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    try {
      // Process while there is any pending frame
      while (pendingARef.current || pendingBRef.current) {
        const hands = handsRef.current;
        if (!hands) break;
        // Alternate preference: A then B if both exist
        let which = null;
        let videoEl = null;
        if (pendingARef.current) { which = 'A'; videoEl = pendingARef.current; pendingARef.current = null; }
        else if (pendingBRef.current) { which = 'B'; videoEl = pendingBRef.current; pendingBRef.current = null; }
        if (!videoEl) continue;
        currentWhichRef.current = which;
        try {
          await hands.send({ image: videoEl });
        } catch (e) {
          console.error('[Detector2] hands.send error:', e);
          // If send fails, break to avoid tight loop
          break;
        }
      }
    } finally {
      drainingRef.current = false;
    }
  };

  const enqueueFrame = (which, videoEl) => {
    if (which === 'A') pendingARef.current = videoEl; else pendingBRef.current = videoEl;
    // Kick the drain loop
    Promise.resolve().then(drainQueue);
  };

  const ensureSharedHands = async () => {
    if (handsRef.current) return handsRef.current;
    try {
      // Resolve Hands constructor in both dev and production builds
      const HandsCtor = await (async () => {
        try {
          if (typeof Hands === 'function') return Hands;
        } catch (_) { /* continue to CDN fallback */ }
        // Fallback: load from CDN (UMD) and use global window.Hands
        if (typeof window !== 'undefined' && window.Hands && typeof window.Hands === 'function') {
          return window.Hands;
        }
        // Wait for any in-progress script load
        const existingScript = document.getElementById('mp-hands-cdn-script');
        if (existingScript) {
          await new Promise((resolve) => {
            if (window.Hands && typeof window.Hands === 'function') return resolve();
            const checkInterval = setInterval(() => {
              if (window.Hands && typeof window.Hands === 'function') {
                clearInterval(checkInterval);
                resolve();
              }
            }, 50);
            setTimeout(() => { clearInterval(checkInterval); resolve(); }, 3000);
          });
          if (window.Hands && typeof window.Hands === 'function') return window.Hands;
        }
        // Only inject script if not already present
        if (!existingScript) {
          await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.id = 'mp-hands-cdn-script';
            s.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js';
            s.async = true;
            s.onload = () => resolve();
            s.onerror = (e) => reject(new Error('Failed to load MediaPipe Hands from CDN'));
            document.head.appendChild(s);
          });
        }
        if (window.Hands && typeof window.Hands === 'function') return window.Hands;
        throw new Error('MediaPipe Hands constructor not available after CDN load');
      })();

      const hands = new HandsCtor({
        locateFile: (file) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
        }
      });

      hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });

      // Single onResults routes to A or B based on the frame being processed
      hands.onResults((results) => {
        const which = currentWhichRef.current;
        if (which === 'A') onResultsA(results);
        else if (which === 'B') onResultsB(results);
      });
      handsRef.current = hands;

      return hands;
    } catch (err) {
      console.error('MediaPipe initialization error:', err);
      setCameraError(`MediaPipe error: ${err.message}`);
      return null;
    }
  };

  const initializeMediaPipeFor = async (which, videoRef, cameraRef) => {
    const hands = await ensureSharedHands();
    if (!hands) return;
    const v = videoRef.current;
    if (!v) {
      dbg(`Video ref for ${which} not found`);
      return;
    }
    dbg(`Initializing manual frame capture for camera ${which}, video dimensions:`, v.videoWidth, 'x', v.videoHeight);
    
    // Use manual requestAnimationFrame instead of MediaPipe Camera to avoid conflicts
    let animationId = null;
    const captureFrame = () => {
      const currentVideo = videoRef.current;
      if (currentVideo && currentVideo.readyState >= 2 && currentVideo.videoWidth > 0) {
        enqueueFrame(which, currentVideo);
      }
      animationId = requestAnimationFrame(captureFrame);
    };
    
    // Start capturing
    animationId = requestAnimationFrame(captureFrame);
    
    // Store cancel function in cameraRef for cleanup
    cameraRef.current = {
      stop: () => {
        if (animationId) {
          cancelAnimationFrame(animationId);
          animationId = null;
          dbg(`Stopped manual frame capture for camera ${which}`);
        }
      }
    };
    
    dbg(`Manual frame capture started for camera ${which}`);
  };

  // Latest per-camera results (now includes landmarks for color detection)
  const latestARef = useRef({ wristY: null, player: 'None', landmarks: null, wristX: null });
  const latestBRef = useRef({ wristY: null, player: 'None', landmarks: null, wristX: null });

  // Keep refs in sync with state so callbacks see latest values
  useEffect(() => { calibrationARef.current = calibrationA; }, [calibrationA]);
  useEffect(() => { calibrationBRef.current = calibrationB; }, [calibrationB]);
  useEffect(() => { detectorSettingsRef.current = detectorSettings; }, [detectorSettings]);

  const onResultsA = (results) => processResults(results, canvasARef, 'A');
  const onResultsB = (results) => processResults(results, canvasBRef, 'B');

  const processResults = (results, canvasRef, which) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const video = which === 'A' ? videoARef.current : videoBRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      if (which === 'A') latestARef.current = { wristY: null, wristX: null, landmarks: null, player: 'None' };
      else latestBRef.current = { wristY: null, wristX: null, landmarks: null, player: 'None' };
      return;
    }
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Draw camera label to verify which feed is showing
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(canvas.width - 80, 5, 75, 20);
    ctx.fillStyle = 'white';
    ctx.font = 'bold 14px Arial';
    ctx.fillText(`Camera ${which}`, canvas.width - 75, 20);

    // Collect wrist positions and find topmost hand
    let selectedY = null;
    let selectedLandmarks = null;
    let selectedWristX = null;
    let wrists = [];
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      for (const lm of results.multiHandLandmarks) {
        const wrist = lm[0];
        const wx = wrist.x * canvas.width;
        const wy = wrist.y * canvas.height;
        wrists.push({ x: wx, y: wy, landmarks: lm });
        if (selectedY === null) {
          selectedY = wy;
          selectedLandmarks = lm;
          selectedWristX = wx;
        } else {
          const shouldUpdate = useTopCriterion ? (wy < selectedY) : (wy > selectedY);
          if (shouldUpdate) {
            selectedY = wy;
            selectedLandmarks = lm;
            selectedWristX = wx;
          }
        }
      }
    }

    // Draw all hands
    wrists.forEach(({ x, y }) => {
      ctx.fillStyle = 'orange';
      ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
    });

    // Mark selected hand and extract ROI for color detection
    let detectedStatus = 'None';
    if (selectedLandmarks) {
      // Mark selected hand
      ctx.fillStyle = 'lime';
      ctx.beginPath();
      ctx.arc(selectedWristX, selectedY, 10, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = 'lime';
      ctx.font = '16px Arial';
      ctx.fillText('SELECTED', selectedWristX - 40, selectedY - 15);

      // Extract ROI for color detection
      const roiSize = Math.max(10, Math.min(300, Math.floor(detectorSettingsRef.current?.roiSize || 60)));
      const halfSize = roiSize / 2;
      const x1 = Math.max(0, selectedWristX - halfSize);
      const y1 = Math.max(0, selectedY - halfSize);
      const x2 = Math.min(canvas.width, selectedWristX + halfSize);
      const y2 = Math.min(canvas.height, selectedY + halfSize);

      const left = Math.max(0, Math.floor(x1));
      const top = Math.max(0, Math.floor(y1));
      let width = Math.floor(x2 - x1);
      let height = Math.floor(y2 - y1);
      width = Math.max(1, width);
      height = Math.max(1, height);
      width = Math.min(width, canvas.width - left);
      height = Math.min(height, canvas.height - top);

      if (width > 0 && height > 0) {
        // Draw ROI box
        ctx.strokeStyle = 'lime';
        ctx.lineWidth = 3;
        ctx.strokeRect(left, top, width, height);

        try {
          // Get ROI pixels
          const roiData = ctx.getImageData(left, top, width, height);
          const calibA = calibrationARef.current;
          const calibB = calibrationBRef.current;
          // Binary decision A vs B
          const decision = decideBinaryAorB(roiData, calibA, calibB);
          detectedStatus = decision.status;
        } catch (error) {
          console.warn('[Detector2] ROI sampling failed:', error);
          detectedStatus = 'None';
        }
      } else {
        dbg('ROI skipped due to zero width/height', { width, height, left, top });
      }
    }

    // >>> TOP/BOTTOM SELECTION LOGIC <<<
    // useTopCriterion true: A = minY, B = maxY; false: A = maxY, B = minY
    let cameraStatus = 'None';
    if (wrists.length >= 1) {
      let minY = wrists[0].y, maxY = wrists[0].y;
      wrists.forEach(r => { if (r.y < minY) minY = r.y; if (r.y > maxY) maxY = r.y; });
      cameraStatus = wrists.length >= 2 ? 'A&B' : 'A';
      ctx.strokeStyle = 'yellow'; ctx.setLineDash([6,4]);
      ctx.beginPath(); ctx.moveTo(0, (useTopCriterion ? minY : maxY)); ctx.lineTo(canvas.width, (useTopCriterion ? minY : maxY)); ctx.stroke();
      ctx.strokeStyle = 'cyan';
      ctx.beginPath(); ctx.moveTo(0, (useTopCriterion ? maxY : minY)); ctx.lineTo(canvas.width, (useTopCriterion ? maxY : minY)); ctx.stroke();
      ctx.setLineDash([]);
      const aLabel = useTopCriterion ? 'A (top)' : 'A (bottom)';
      const bLabel = useTopCriterion ? 'B (bottom)' : 'B (top)';
      ctx.fillStyle = 'lime'; ctx.font = '16px Arial'; ctx.fillText(aLabel, 6, Math.max(14, (useTopCriterion ? minY : maxY) - 6));
      ctx.fillStyle = 'dodgerblue'; ctx.fillText(bLabel, 6, Math.min(canvas.height - 6, (useTopCriterion ? maxY : minY) + 18));
    }

    const latest = { 
      wristY: selectedY, 
      wristX: selectedWristX, 
      landmarks: selectedLandmarks, 
      player: detectedStatus 
    };
    if (which === 'A') latestARef.current = latest; else latestBRef.current = latest;

    // Merge decision across cameras: choose topmost hand across both feeds
    const yA = latestARef.current.wristY; 
    const yB = latestBRef.current.wristY;
    let merged = 'None';
    if (yA != null || yB != null) {
      const reducer = useTopCriterion
        ? (acc, v) => (acc == null ? v : Math.min(acc, v))
        : (acc, v) => (acc == null ? v : Math.max(acc, v));
      const sel = [yA, yB].filter(v => v != null).reduce(reducer, null);
      // Use the color detection from whichever camera had the topmost hand
      if (sel === yA) merged = latestARef.current.player;
      else merged = latestBRef.current.player;
    }

    setStatus({ camA: latestARef.current.player, camB: latestBRef.current.player, merged });
  };

  // RGB to HSV conversion
  const rgbToHsv = (r, g, b) => {
    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;

    let h = 0;
    if (delta !== 0) {
      if (max === r) {
        h = 60 * (((g - b) / delta) % 6);
      } else if (max === g) {
        h = 60 * ((b - r) / delta + 2);
      } else {
        h = 60 * ((r - g) / delta + 4);
      }
    }
    if (h < 0) h += 360;

    const s = max === 0 ? 0 : (delta / max) * 255;
    const v = max * 255;

    return [h / 2, s, v]; // Convert to OpenCV HSV range (H: 0-180)
  };

  // Binary A vs B decision based on calibrated colors
  const decideBinaryAorB = (imageData, calibA, calibB) => {
    const data = imageData.data;
    // If only one calibration exists, choose that label immediately
    if (calibA && !calibB) return { status: 'Player A', percentA: null, percentB: null };
    if (calibB && !calibA) return { status: 'Player B', percentA: null, percentB: null };

    const wH = detectorSettingsRef.current?.hueWeight ?? 4.0;
    const wS = detectorSettingsRef.current?.satWeight ?? 2.0;
    const wV = detectorSettingsRef.current?.valWeight ?? 1.0;
    const sensitivity = detectorSettingsRef.current?.sensitivity ?? 0.0;

    if (calibA && calibB) {
      let votesA = 0;
      let votesB = 0;
      let considered = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const [h, s, v] = rgbToHsv(r, g, b);
        // Reliability weighting
        const relS = Math.min(1, Math.max(0, s / 255));
        const relV = Math.min(1, Math.max(0, v / 255));
        const reliability = Math.max(0.05, 0.5 * relS + 0.5 * relV);
        const dhA = Math.min(Math.abs(h - calibA.h), 180 - Math.abs(h - calibA.h));
        const dhB = Math.min(Math.abs(h - calibB.h), 180 - Math.abs(h - calibB.h));
        const dsA = Math.abs(s - calibA.s);
        const dsB = Math.abs(s - calibB.s);
        const dvA = Math.abs(v - calibA.v);
        const dvB = Math.abs(v - calibB.v);
        const distA = dhA * wH + dsA * wS + dvA * wV;
        const distB = dhB * wH + dsB * wS + dvB * wV;
        // Neutral zone
        const minDist = Math.min(distA, distB);
        if (minDist > 180) continue;
        if (distA <= distB) votesA += reliability; else votesB += reliability;
        considered += reliability;
      }
      if (considered === 0) return { status: 'None', percentA: 0, percentB: 0 };
      const percentA = votesA / Math.max(1e-6, considered);
      const percentB = votesB / Math.max(1e-6, considered);
      const required = 0.12 * (1 + 0.8 * Math.max(0, Math.min(1, sensitivity)));
      if (percentA >= required && percentA >= percentB) return { status: 'Player A', percentA, percentB };
      if (percentB >= required && percentB > percentA) return { status: 'Player B', percentA, percentB };
      return { status: 'None', percentA, percentB };
    }

    // No calibrations: return None
    return { status: 'None', percentA: 0, percentB: 0 };
  };

  // Helper to convert HSV to CSS color
  const hsvToCssColor = (h, s, v) => {
    const H = (h || 0) * 2; // to 0-360
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

  // Handle camera change
  const handleCameraChange = async (which, deviceId) => {
    try {
      if (which === 'A') {
        setSelectedCamA(deviceId);
        // Stop and clean up existing camera A
        if (cameraARef.current) { 
          try { cameraARef.current.stop(); } catch(e) { dbg('Stop camA error:', e); }
          cameraARef.current = null; 
        }
        if (streamARef.current) { 
          streamARef.current.getTracks().forEach(t=>t.stop()); 
          streamARef.current = null; 
        }
        // Clear video element
        const v = videoARef.current;
        if (v) v.srcObject = null;
        // Small delay to ensure cleanup
        await new Promise(resolve => setTimeout(resolve, 100));
        // Start new camera
        await startCamera(deviceId, videoARef, streamARef);
        // Small delay to ensure stream is ready
        await new Promise(resolve => setTimeout(resolve, 200));
        await ensureSharedHands();
        await initializeMediaPipeFor('A', videoARef, cameraARef);
        dbg('Camera A switched to:', deviceId);
      } else {
        setSelectedCamB(deviceId);
        // Stop and clean up existing camera B
        if (cameraBRef.current) { 
          try { cameraBRef.current.stop(); } catch(e) { dbg('Stop camB error:', e); }
          cameraBRef.current = null; 
        }
        if (streamBRef.current) { 
          streamBRef.current.getTracks().forEach(t=>t.stop()); 
          streamBRef.current = null; 
        }
        // Clear video element
        const v = videoBRef.current;
        if (v) v.srcObject = null;
        // Small delay to ensure cleanup
        await new Promise(resolve => setTimeout(resolve, 100));
        // Start new camera
        await startCamera(deviceId, videoBRef, streamBRef);
        // Small delay to ensure stream is ready
        await new Promise(resolve => setTimeout(resolve, 200));
        await ensureSharedHands();
        await initializeMediaPipeFor('B', videoBRef, cameraBRef);
        dbg('Camera B switched to:', deviceId);
      }
    } catch (e) {
      console.error('[Detector2] Camera switch error:', e);
      setCameraError(`Camera switch error: ${e.message}`);
    }
  };

  return (
    <div className={`detector-window ${isMinimized ? 'minimized' : ''}`}>
      <div className="detector-header">
        <span>Bracelet Detector 2 (Two Cameras)</span>
        <div className="detector-controls">
          <button onClick={() => setIsMinimized(!isMinimized)}>{isMinimized ? '▢' : '−'}</button>
          <button onClick={() => setUseTopCriterion(!useTopCriterion)} title="Toggle A criterion">{useTopCriterion ? 'A=Top' : 'A=Bottom'}</button>
        </div>
      </div>

      <div className="detector-content" style={{ display: isMinimized ? 'none' : 'block' }}>
        <div style={{ display:'flex', gap:8 }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:12, opacity:0.8, marginBottom:4, display:'flex', alignItems:'center', gap:4 }}>
              <span>Camera A:</span>
              <select 
                value={selectedCamA} 
                onChange={(e) => handleCameraChange('A', e.target.value)}
                style={{ fontSize:10, padding:'2px 4px', maxWidth:120 }}
              >
                {availableDevices.map(dev => (
                  <option key={dev.deviceId} value={dev.deviceId}>
                    {dev.label || `Camera ${dev.deviceId.slice(0,8)}`}
                  </option>
                ))}
              </select>
            </div>
            <video ref={videoARef} autoPlay playsInline muted style={{ position:'absolute', top:'-9999px', left:'-9999px', width:1, height:1 }} />
            <canvas ref={canvasARef} className="output_canvas" />
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:12, opacity:0.8, marginBottom:4, display:'flex', alignItems:'center', gap:4 }}>
              <span>Camera B:</span>
              <select 
                value={selectedCamB} 
                onChange={(e) => handleCameraChange('B', e.target.value)}
                style={{ fontSize:10, padding:'2px 4px', maxWidth:120 }}
              >
                {availableDevices.map(dev => (
                  <option key={dev.deviceId} value={dev.deviceId}>
                    {dev.label || `Camera ${dev.deviceId.slice(0,8)}`}
                  </option>
                ))}
              </select>
            </div>
            <video ref={videoBRef} autoPlay playsInline muted style={{ position:'absolute', top:'-9999px', left:'-9999px', width:1, height:1 }} />
            <canvas ref={canvasBRef} className="output_canvas" />
          </div>
        </div>
        <div className="detector-info" style={{ marginTop:8 }}>
          <div className="status-display">
            Merged: <strong>{status.merged}</strong>
          </div>
          <div className="color-swatches" style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, opacity: 0.8 }}>A</span>
              <span title="Player A calibrated color" style={{ width: 14, height: 14, borderRadius: 3, border: '1px solid #666', display: 'inline-block', background: calibrationA ? calibToCss(calibrationA) : '#444' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, opacity: 0.8 }}>B</span>
              <span title="Player B calibrated color" style={{ width: 14, height: 14, borderRadius: 3, border: '1px solid #666', display: 'inline-block', background: calibrationB ? calibToCss(calibrationB) : '#444' }} />
            </div>
          </div>
          <div className="calib-summary" style={{ fontSize: 12, opacity: 0.8, marginTop: 4, lineHeight: 1.4 }}>
            <div>
              A: {calibrationA ? `h${Math.round(calibrationA.h)} s${Math.round(calibrationA.s)} v${Math.round(calibrationA.v)}` : '—'}
            </div>
            <div>
              B: {calibrationB ? `h${Math.round(calibrationB.h)} s${Math.round(calibrationB.s)} v${Math.round(calibrationB.v)}` : '—'}
            </div>
          </div>
          {cameraError && <div style={{ color:'#f55', marginTop:4 }}>Camera error: {cameraError}</div>}
          <div style={{ fontSize:12, marginTop:6 }}>
            <strong>Note:</strong> Detects topmost hand across both cameras. Use A=Top/A=Bottom to switch criterion.
          </div>
        </div>
      </div>
    </div>
  );
}

export default BraceletDetector2;
