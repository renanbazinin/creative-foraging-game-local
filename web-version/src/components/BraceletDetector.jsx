import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Hands } from '@mediapipe/hands/hands';
import { Camera } from '@mediapipe/camera_utils/camera_utils';
import './BraceletDetector.css';

const ENABLE_DETECTOR = true; // Master switch

// Debug logging helper (disabled)
const DEBUG = false;
const dbg = (...args) => { if (DEBUG) console.log('[Detector]', ...args); };

// Color detection thresholds (converted from Python HSV to JS)
const COLOR_THRESHOLDS = {
  red: {
    lower1: [0, 120, 70],
    upper1: [10, 255, 255],
    lower2: [170, 120, 70],
    upper2: [180, 255, 255]
  },
  blue: {
    lower: [100, 150, 70],
    upper: [130, 255, 255]
  },
  pixelThreshold: 200
};

// LocalStorage keys for detector tuning
const LS_KEYS = {
  roiSize: 'detectorRoiSize',
  hueWeight: 'detectorHueWeight',
  satWeight: 'detectorSatWeight',
  valWeight: 'detectorValWeight',
  sensitivity: 'detectorSensitivity',
  selectedCamera: 'detectorSelectedCamera',
};

function BraceletDetector({ hidden = false }) {
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
  // Live percentages (0..1) for A/B confidence shown in UI
  const [abPercents, setAbPercents] = useState({ a: null, b: null });
  // Refs to avoid stale closures inside MediaPipe callbacks
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

  const streamRef = useRef(null);
  const isMounted = useRef(false); // Ref to track mount status
  const requestIdRef = useRef(0);   // Increment to invalidate stale in-flight camera requests
  const initializedForRequestRef = useRef(null); // Track which request id initialized MediaPipe

  // Camera device selection
  const [availableDevices, setAvailableDevices] = useState([]);
  const availableDevicesRef = useRef([]);
  const [selectedCamera, setSelectedCamera] = useState(() => {
    return localStorage.getItem(LS_KEYS.selectedCamera) || '';
  });
  const refreshCameraList = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      setAvailableDevices(videoDevices);
      availableDevicesRef.current = videoDevices;
      return videoDevices;
    } catch (e) {
      dbg('Error enumerating cameras:', e);
      return [];
    }
  }, []);

  // Removed duplicate dbg definition; using top-level dbg constant instead.

  const removeVideoEventListeners = useCallback((video) => {
    // This is a placeholder. The actual implementation was removed in a previous step.
    // We can re-add specific listener removal if needed.
    dbg('Removing video event listeners (if any were attached).');
  }, [dbg]);

  const requestCameraPermission = useCallback(async (cameraIdOverride = null) => {
    const video = videoRef.current;
    if (!video) return;

    // Stop any existing stream before starting a new one.
    if (streamRef.current) {
      dbg('Stopping existing stream before requesting new one.');
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    addVideoEventListeners(video);
    // Invalidate any previous in-flight requests and capture this request id
    const myRequestId = ++requestIdRef.current;
    initializedForRequestRef.current = null;

    const cameraId = cameraIdOverride !== null ? cameraIdOverride : selectedCamera;
    dbg('Requesting getUserMedia...');
    try {
      // Use selected camera if available, otherwise use default
      const constraints = cameraId 
        ? { video: { deviceId: { exact: cameraId } } }
        : { video: true };
      
      // Log which camera we're trying to use
      if (cameraId) {
        const selectedDevice = availableDevicesRef.current.find(d => d.deviceId === cameraId);
        console.log('[Detector] 🎥 Loading SELECTED camera:', {
          deviceId: cameraId,
          label: selectedDevice?.label || 'Unknown',
          source: 'localStorage or user selection'
        });
      } else {
        console.log('[Detector] 🎥 Loading DEFAULT camera (no selection saved)');
      }
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      // If component unmounted or a newer request started, abandon this stream
      if (!isMounted.current || myRequestId !== requestIdRef.current) {
        dbg('Stale camera request (unmounted or superseded). Stopping stream.');
        stream.getTracks().forEach(track => track.stop());
        return;
      }

      streamRef.current = stream;
      const tracks = stream.getVideoTracks();
      dbg('getUserMedia success. Tracks:', tracks);
      
      // Log the actual camera that was loaded
      if (tracks.length > 0) {
        const track = tracks[0];
        console.log('[Detector] ✅ Camera loaded successfully:', {
          label: track.label,
          deviceId: track.getSettings().deviceId,
          resolution: `${track.getSettings().width}x${track.getSettings().height}`,
          frameRate: track.getSettings().frameRate
        });
      }
      
      // Attach stream and wait for metadata to ensure dimensions are known
      video.srcObject = stream;

      await new Promise((resolve) => {
        const alreadyReady = video.readyState >= 1 && video.videoWidth > 0 && video.videoHeight > 0;
        if (alreadyReady) return resolve();
        const onLoaded = () => {
          video.removeEventListener('loadedmetadata', onLoaded);
          resolve();
        };
        video.addEventListener('loadedmetadata', onLoaded, { once: true });
        // Safety timeout in case event never fires
        setTimeout(() => {
          video.removeEventListener('loadedmetadata', onLoaded);
          resolve();
        }, 1500);
      });

      // Double-check request validity again before playing
      if (!isMounted.current || myRequestId !== requestIdRef.current) {
        dbg('Stale request before play(). Stopping stream.');
        stream.getTracks().forEach(track => track.stop());
        return;
      }

      try {
        await video.play();
        dbg('video.play() promise resolved. Video should be playing.');
      } catch (error) {
        console.error('[Detector] video.play() promise rejected:', error);
        dbg('video.play() promise rejected:', error.name, error.message);
        // If aborted due to a newer request, stop and exit
        if (myRequestId !== requestIdRef.current) {
          dbg('play() aborted due to newer request.');
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        // Otherwise, proceed; some browsers reject then auto-play later
      }

      // Initialize MediaPipe once per valid request
      if (initializedForRequestRef.current !== myRequestId) {
        initializedForRequestRef.current = myRequestId;
        dbg('Initializing MediaPipe for request id', myRequestId);
        initializeMediaPipe();
      }
      if (isMounted.current) {
        const videoDevices = await refreshCameraList();
        if (!cameraId || !cameraIdOverride) {
          const firstWithId = videoDevices.find(d => d.deviceId);
          if (firstWithId && firstWithId.deviceId && firstWithId.deviceId !== selectedCamera) {
            setSelectedCamera(firstWithId.deviceId);
            localStorage.setItem(LS_KEYS.selectedCamera, firstWithId.deviceId);
          }
        }
      }
    } catch (error) {
      console.error('[Detector] Error accessing camera:', error);
      dbg('getUserMedia error:', error.name, error.message);
    }
  }, [dbg, refreshCameraList, removeVideoEventListeners, selectedCamera]);


  // Convert OpenCV-style HSV (H:0-180, S:0-255, V:0-255) to CSS rgb()
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

  const getStatusCssColor = (st) => {
  if (st === 'Player A' && calibrationA) return calibToCss(calibrationA);
  if (st === 'Player B' && calibrationB) return calibToCss(calibrationB);
  if (st === 'Red') return '#ff0000';
  if (st === 'Blue') return '#0000ff';
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
      } catch (e) {
        dbg('No existing calibrations');
      }
    };

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

    const initializeCameras = async () => {
      const videoDevices = await refreshCameraList();
      if (!isMounted.current) return;

      const savedCamera = localStorage.getItem(LS_KEYS.selectedCamera);
      let chosenCameraId = '';

      if (savedCamera && videoDevices.some(d => d.deviceId && d.deviceId === savedCamera)) {
        const savedDevice = videoDevices.find(d => d.deviceId === savedCamera);
        chosenCameraId = savedCamera;
        console.log('[Detector] 💾 Found saved camera in localStorage:', {
          deviceId: savedCamera,
          label: savedDevice?.label || 'Unknown'
        });
        dbg('Using saved camera:', savedCamera);
      } else {
        if (savedCamera) {
          localStorage.removeItem(LS_KEYS.selectedCamera);
        }
        const firstWithId = videoDevices.find(d => d.deviceId);
        if (firstWithId && firstWithId.deviceId) {
          chosenCameraId = firstWithId.deviceId;
          localStorage.setItem(LS_KEYS.selectedCamera, firstWithId.deviceId);
          console.log('[Detector] 🔧 No saved camera found, using system default:', {
            deviceId: firstWithId.deviceId,
            label: firstWithId.label || 'Unknown',
            savedCameraWas: savedCamera || 'none'
          });
          dbg('Saved camera not found, using default camera:', firstWithId.deviceId);
        } else {
          console.log('[Detector] ⚠️ No camera identifiers available yet (likely awaiting permission).');
        }
      }

      if (chosenCameraId) {
        setSelectedCamera(prev => (prev === chosenCameraId ? prev : chosenCameraId));
      } else {
        setSelectedCamera(prev => prev || '');
      }

      loadCalibs();
    };

    initializeCameras();
    window.addEventListener('storage', onStorage);

    if (ENABLE_DETECTOR) {
      dbg('Mounting detector. UA:', navigator.userAgent, 'Platform:', navigator.platform, 'Visibility:', document.visibilityState);
    }

    return () => {
      isMounted.current = false;
      dbg('Cleanup: Component unmounting.');
      requestIdRef.current += 1;
      initializedForRequestRef.current = null;
      if (cameraRef.current) {
        dbg('Cleanup: Stopping MediaPipe camera.');
        cameraRef.current.stop();
        cameraRef.current = null;
      }
      if (streamRef.current) {
        dbg('Cleanup: Stopping camera stream.');
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      const video = videoRef.current;
      if (video) {
        video.srcObject = null;
        removeVideoEventListeners(video);
      }
      if (handsRef.current) {
        dbg('Cleanup: Closing MediaPipe hands.');
        handsRef.current.close();
        handsRef.current = null;
      }
      window.removeEventListener('storage', onStorage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep refs in sync with state so onResults sees latest values
  useEffect(() => { calibrationARef.current = calibrationA; }, [calibrationA]);
  useEffect(() => { calibrationBRef.current = calibrationB; }, [calibrationB]);
  useEffect(() => { detectorSettingsRef.current = detectorSettings; }, [detectorSettings]);

  // Request camera when selectedCamera changes (after enumeration or user selection)
  useEffect(() => {
    if (!ENABLE_DETECTOR) return;
    const label = selectedCamera ? selectedCamera : 'default system camera';
    dbg('Selected camera changed, requesting camera permission with:', label);
    requestCameraPermission(selectedCamera || null);
  }, [selectedCamera, requestCameraPermission]);

  // Log every second
  useEffect(() => {
    const logInterval = setInterval(() => {
      // Use a function with setStatus to get the latest status
      setStatus(currentStatus => {
        logDetection(currentStatus);
        return currentStatus;
      });
    }, 1000);

    return () => clearInterval(logInterval);
  }, []); // Empty dependency array means this runs once on mount

  const logDetection = (detectedStatus) => {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      status: detectedStatus
    };

    setDetectionLog(prev => [...prev, logEntry]);

    // Save to localStorage
    const allLogs = JSON.parse(localStorage.getItem('braceletDetections') || '[]');
    allLogs.push(logEntry);
    localStorage.setItem('braceletDetections', JSON.stringify(allLogs));
  };

  const initializeMediaPipe = async () => {
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
        await new Promise((resolve, reject) => {
          const id = 'mp-hands-cdn-script';
          if (document.getElementById(id)) return resolve();
          const s = document.createElement('script');
          s.id = id;
          s.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js';
          s.async = true;
          s.onload = () => resolve();
          s.onerror = (e) => reject(new Error('Failed to load MediaPipe Hands from CDN'));
          document.head.appendChild(s);
        });
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

      hands.onResults(onResults);
      handsRef.current = hands;

      // Instead of using MediaPipe Camera (which overrides our camera selection),
      // manually send frames from our already-initialized video stream
      if (videoRef.current) {
        const video = videoRef.current;
        console.log('[Detector] 🎬 Starting manual frame capture from video element');
        
        let animationFrameId;
        const sendFrame = async () => {
          if (video.readyState >= 2 && video.videoWidth > 0) {
            try {
              await hands.send({ image: video });
            } catch (e) {
              console.error('[Detector] Error sending frame to MediaPipe:', e);
            }
          }
          animationFrameId = requestAnimationFrame(sendFrame);
        };
        
        // Start the frame capture loop
        sendFrame();
        
        // Store the animation frame ID for cleanup
        cameraRef.current = {
          stop: () => {
            if (animationFrameId) {
              cancelAnimationFrame(animationFrameId);
              console.log('[Detector] 🛑 Stopped frame capture');
            }
          }
        };
      }
    } catch (err) {
      console.error('MediaPipe initialization error:', err);
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

  // Draw video frame (not flipped)
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  let detectedStatus = 'None';

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      dbg('onResults: hands=', results.multiHandLandmarks.length);
      // Find lowest hand (largest y value = closer to bottom of screen)
      let lowestHand = null;
      let lowestY = 0;

      results.multiHandLandmarks.forEach(landmarks => {
        const wrist = landmarks[0]; // WRIST landmark
        if (wrist.y > lowestY) {
          lowestY = wrist.y;
          lowestHand = landmarks;
        }
      });

      // Draw all hands
      results.multiHandLandmarks.forEach(landmarks => {
        drawLandmarks(ctx, landmarks, canvas.width, canvas.height);
      });

      if (lowestHand) {
        const wrist = lowestHand[0];
  const wristX = wrist.x * canvas.width;
        const wristY = wrist.y * canvas.height;

        // Mark selected hand
        ctx.fillStyle = 'lime';
        ctx.beginPath();
        ctx.arc(wristX, wristY, 10, 0, 2 * Math.PI);
        ctx.fill();

        ctx.fillStyle = 'lime';
        ctx.font = '16px Arial';
        ctx.fillText('SELECTED', wristX - 40, wristY - 15);

  // Extract ROI for color detection
  const roiSize = Math.max(10, Math.min(300, Math.floor(detectorSettingsRef.current?.roiSize || 60)));
        const halfSize = roiSize / 2;
        const x1 = Math.max(0, wristX - halfSize);
        const y1 = Math.max(0, wristY - halfSize);
        const x2 = Math.min(canvas.width, wristX + halfSize);
        const y2 = Math.min(canvas.height, wristY + halfSize);

        // Draw ROI box
        ctx.strokeStyle = 'lime';
        ctx.lineWidth = 3;
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

        // Get ROI pixels - with safety checks
        const roiWidth = x2 - x1;
        const roiHeight = y2 - y1;
        
        if (roiWidth > 0 && roiHeight > 0) {
          try {
            const roiData = ctx.getImageData(x1, y1, roiWidth, roiHeight);
        const calibA = calibrationARef.current;
        const calibB = calibrationBRef.current;
        // Binary decision A vs B whenever a hand is visible
        const decision = decideBinaryAorB(roiData, calibA, calibB);
        detectedStatus = decision.status;
        // Update live percentages for UI (0..1 or null)
        setAbPercents({ a: decision.percentA, b: decision.percentB });
            dbg('Detection result:', detectedStatus, { roi: { x1, y1, w: roiWidth, h: roiHeight } });
          } catch (error) {
            console.warn('[Detector] Failed to get ROI image data:', error.message);
            detectedStatus = 'None';
            setAbPercents({ a: null, b: null });
          }
        } else {
          console.warn('[Detector] Invalid ROI dimensions:', { width: roiWidth, height: roiHeight });
          detectedStatus = 'None';
          setAbPercents({ a: null, b: null });
        }
      }
    }

    // Display status with calibrated color if available
    let color = '#ffffff';
    if (detectedStatus === 'Player A' && calibrationARef.current) {
      color = calibToCss(calibrationARef.current);
    } else if (detectedStatus === 'Player B' && calibrationBRef.current) {
      color = calibToCss(calibrationBRef.current);
    }
    
    ctx.fillStyle = color;
    ctx.font = 'bold 32px Arial';
  ctx.fillText(`Status: ${detectedStatus}`, 10, 40);

    setStatus(detectedStatus);
    
    // Expose status to game tracker
    if (typeof window !== 'undefined') {
      window.currentBraceletStatus = detectedStatus;
      // Expose canvas for frame capture
      window.braceletDetectorCanvas = canvas;
      window.braceletDetectorVideo = video;
    }
  };

  const drawLandmarks = (ctx, landmarks, width, height) => {
    // Draw connections
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    const connections = [
      [0, 1], [1, 2], [2, 3], [3, 4], // Thumb
      [0, 5], [5, 6], [6, 7], [7, 8], // Index
      [5, 9], [9, 13], [13, 17], // Palm
      [0, 9], [9, 10], [10, 11], [11, 12], // Middle
      [0, 13], [13, 14], [14, 15], [15, 16], // Ring
      [0, 17], [17, 18], [18, 19], [19, 20], // Pinky
    ];

    connections.forEach(([start, end]) => {
      const startPoint = landmarks[start];
      const endPoint = landmarks[end];
      ctx.beginPath();
      ctx.moveTo(startPoint.x * width, startPoint.y * height);
      ctx.lineTo(endPoint.x * width, endPoint.y * height);
      ctx.stroke();
    });

    // Draw landmarks
    landmarks.forEach(landmark => {
      ctx.fillStyle = 'red';
      ctx.beginPath();
      ctx.arc(landmark.x * width, landmark.y * height, 5, 0, 2 * Math.PI);
      ctx.fill();
    });
  };

  const detectBraceletColor = (imageData) => {
    const data = imageData.data;
    let redCount = 0;
    let blueCount = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // Convert RGB to HSV
      const hsv = rgbToHsv(r, g, b);

      // Check for red (wraps around hue)
      if (
        ((hsv[0] >= COLOR_THRESHOLDS.red.lower1[0] && hsv[0] <= COLOR_THRESHOLDS.red.upper1[0]) ||
         (hsv[0] >= COLOR_THRESHOLDS.red.lower2[0] && hsv[0] <= COLOR_THRESHOLDS.red.upper2[0])) &&
        hsv[1] >= COLOR_THRESHOLDS.red.lower1[1] &&
        hsv[2] >= COLOR_THRESHOLDS.red.lower1[2]
      ) {
        redCount++;
      }

      // Check for blue
      if (
        hsv[0] >= COLOR_THRESHOLDS.blue.lower[0] &&
        hsv[0] <= COLOR_THRESHOLDS.blue.upper[0] &&
        hsv[1] >= COLOR_THRESHOLDS.blue.lower[1] &&
        hsv[2] >= COLOR_THRESHOLDS.blue.lower[2]
      ) {
        blueCount++;
      }
    }

    // Return raw counts for fallback decisions
    return { redCount, blueCount };
  };

  // Presence based decision: declare A or B only if enough pixels are closer to that calibration.
  // Returns { status: 'Player A'|'Player B'|'None', percentA: 0..1|null, percentB: 0..1|null }
  const decideBinaryAorB = (imageData, calibA, calibB) => {
    const data = imageData.data;
    // If only one calibration exists, choose that label immediately
    if (calibA && !calibB) return { status: 'Player A', percentA: null, percentB: null };
    if (calibB && !calibA) return { status: 'Player B', percentA: null, percentB: null };

  // Use same fallback defaults as initial detectorSettings state for consistency
  const wH = detectorSettingsRef.current?.hueWeight ?? 4.0;
  const wS = detectorSettingsRef.current?.satWeight ?? 2.0;
  const wV = detectorSettingsRef.current?.valWeight ?? 1.0;
    const sensitivity = detectorSettingsRef.current?.sensitivity ?? 0.0; // 0..1 (used to tighten threshold)

    if (calibA && calibB) {
      let votesA = 0;
      let votesB = 0;
      let considered = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
    const [h, s, v] = rgbToHsv(r, g, b);
  // Reliability weighting: instead of skipping dull/dark pixels outright,
  // give them a lower influence. Weight grows with saturation/value.
  // Scale S,V from 0..255 to 0..1, then combine.
  const relS = Math.min(1, Math.max(0, s / 255));
  const relV = Math.min(1, Math.max(0, v / 255));
  const reliability = Math.max(0.05, 0.5 * relS + 0.5 * relV); // keep a small floor so no pixel is zeroed
        const dhA = Math.min(Math.abs(h - calibA.h), 180 - Math.abs(h - calibA.h));
        const dhB = Math.min(Math.abs(h - calibB.h), 180 - Math.abs(h - calibB.h));
        const dsA = Math.abs(s - calibA.s);
        const dsB = Math.abs(s - calibB.s);
        const dvA = Math.abs(v - calibA.v);
        const dvB = Math.abs(v - calibB.v);
  const distA = dhA * wH + dsA * wS + dvA * wV;
  const distB = dhB * wH + dsB * wS + dvB * wV;
  // Neutral zone: if neither color is close enough, don't let this pixel vote
  const minDist = Math.min(distA, distB);
  if (minDist > 180) continue;
  if (distA <= distB) votesA += reliability; else votesB += reliability;
    considered += reliability;
      }
      if (considered === 0) return { status: 'None', percentA: 0, percentB: 0 };
  const percentA = votesA / Math.max(1e-6, considered);
  const percentB = votesB / Math.max(1e-6, considered);
  // Increase required percent slightly with sensitivity (0 -> 0.12, 1 -> 0.12 * 1.8)
  const required = 0.12 * (1 + 0.8 * Math.max(0, Math.min(1, sensitivity)));
      if (percentA >= required && percentA >= percentB) return { status: 'Player A', percentA, percentB };
      if (percentB >= required && percentB > percentA) return { status: 'Player B', percentA, percentB };
      return { status: 'None', percentA, percentB };
    }

    // No calibrations: fallback to raw red vs blue counts.
    const { redCount, blueCount } = detectBraceletColor(imageData);
    const total = redCount + blueCount;
    if (total === 0) return { status: 'None', percentA: 0, percentB: 0 };
    const fracRed = redCount / total;
    const fracBlue = blueCount / total;
    if (fracRed >= 0.15 && fracRed >= fracBlue) return { status: 'Player A', percentA: fracRed, percentB: fracBlue };
    if (fracBlue >= 0.15 && fracBlue > fracRed) return { status: 'Player B', percentA: fracRed, percentB: fracBlue };
    return { status: 'None', percentA: fracRed, percentB: fracBlue };
  };

  // Calibration save/clear handled on the dedicated calibration page

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

    return [h / 2, s, v];
  };

  const addVideoEventListeners = (video) => {
    // This function is a placeholder for adding video event listeners if needed in the future.
    dbg('Adding video event listeners (if needed in the future).');
  };

  const handleCameraChange = (deviceId) => {
    setSelectedCamera(deviceId);
    if (deviceId) {
      localStorage.setItem(LS_KEYS.selectedCamera, deviceId);
    } else {
      localStorage.removeItem(LS_KEYS.selectedCamera);
    }
    dbg('Camera selection saved to localStorage:', deviceId || 'default');
  };

  const downloadLogs = () => {
    const logs = JSON.parse(localStorage.getItem('braceletDetections') || '[]');
    
    // Download as JSON
    const jsonBlob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
    const jsonUrl = URL.createObjectURL(jsonBlob);
    const jsonLink = document.createElement('a');
    jsonLink.href = jsonUrl;
    jsonLink.download = `bracelet_detections_${new Date().toISOString().split('T')[0]}.json`;
    jsonLink.click();

    // Download as TXT
    const txtContent = logs.map(log => `${log.timestamp}: ${log.status}`).join('\n');
    const txtBlob = new Blob([txtContent], { type: 'text/plain' });
    const txtUrl = URL.createObjectURL(txtBlob);
    const txtLink = document.createElement('a');
    txtLink.href = txtUrl;
    txtLink.download = `bracelet_detections_${new Date().toISOString().split('T')[0]}.txt`;
    txtLink.click();
  };

  const clearLogs = () => {
    localStorage.removeItem('braceletDetections');
    setDetectionLog([]);
  };

  return (
    <>
    <div
      className={`detector-window ${isMinimized ? 'minimized' : ''}`}
      style={hidden ? { opacity: 0, pointerEvents: 'none', visibility: 'hidden' } : undefined}
    >
      <div className="detector-header">
        <span>Bracelet Detector</span>
        <div className="detector-controls">
          <button onClick={downloadLogs} title="Download Logs">📥</button>
          <button onClick={clearLogs} title="Clear Logs">🗑️</button>
          <button onClick={() => setIsMinimized(!isMinimized)}>
            {isMinimized ? '▢' : '−'}
          </button>
        </div>
      </div>
      
      <div className="detector-content" style={{ display: isMinimized ? 'none' : 'block' }}>
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>Camera:</span>
            <select 
              value={selectedCamera} 
              onChange={(e) => handleCameraChange(e.target.value)}
              style={{ fontSize: 11, padding: '3px 6px', flex: 1, maxWidth: 200 }}
            >
              <option value="">System Default</option>
              {availableDevices.map((dev, idx) => {
                const hasId = !!dev.deviceId;
                const optionValue = hasId ? dev.deviceId : '';
                const key = hasId ? dev.deviceId : `camera-${idx}`;
                const labelBase = dev.label?.trim() || `Camera ${idx + 1}`;
                const idSuffix = hasId ? ` • ${dev.deviceId.slice(0, 8)}` : ' (needs permission)';
                return (
                  <option key={key} value={optionValue} disabled={!hasId}>
                    {labelBase}{idSuffix}
                  </option>
                );
              })}
            </select>
          </div>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={true}
            style={{
              position: 'absolute',
              top: '-9999px',
              left: '-9999px',
              width: '1px',
              height: '1px',
            }}
          ></video>
          <canvas ref={canvasRef} className="output_canvas" />
          
          <div className="detector-info">
            <div className="status-display">
              Status: <span style={{ color: getStatusCssColor(status), fontWeight: 700 }}>{status}</span>
            </div>
            <div className="color-swatches" style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, opacity: 0.8 }}>A</span>
                <span title="Player A calibrated color" style={{ width: 14, height: 14, borderRadius: 3, border: '1px solid #666', display: 'inline-block', background: calibrationA ? calibToCss(calibrationA) : '#444' }} />
                <span style={{ fontSize: 12, opacity: 0.8, minWidth: 36, textAlign: 'right' }} title="A confidence">
                  {abPercents.a == null ? '—' : `${Math.round(Math.max(0, Math.min(1, abPercents.a)) * 100)}%`}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, opacity: 0.8 }}>B</span>
                <span title="Player B calibrated color" style={{ width: 14, height: 14, borderRadius: 3, border: '1px solid #666', display: 'inline-block', background: calibrationB ? calibToCss(calibrationB) : '#444' }} />
                <span style={{ fontSize: 12, opacity: 0.8, minWidth: 36, textAlign: 'right' }} title="B confidence">
                  {abPercents.b == null ? '—' : `${Math.round(Math.max(0, Math.min(1, abPercents.b)) * 100)}%`}
                </span>
              </div>
            </div>
            <div className="log-count">
              Logs: {detectionLog ? detectionLog.length : 0}
            </div>
            <div className="calib-summary" style={{ fontSize: 12, opacity: 0.8, marginTop: 4, lineHeight: 1.4 }}>
              <div>
                A: {calibrationA ? `h${Math.round(calibrationA.h)} s${Math.round(calibrationA.s)} v${Math.round(calibrationA.v)}` : '—'}
              </div>
              <div>
                B: {calibrationB ? `h${Math.round(calibrationB.h)} s${Math.round(calibrationB.s)} v${Math.round(calibrationB.v)}` : '—'}
              </div>
            </div>
          </div>
        </div>
    </div>
    </>
  );
}

export default BraceletDetector;