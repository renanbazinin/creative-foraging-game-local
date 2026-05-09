import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Hands } from '@mediapipe/hands/hands';
import { Camera } from '@mediapipe/camera_utils/camera_utils';
import './BraceletDetector.css';

// Tests2: branch copy of BraceletDetector for isolated experimentation
const ENABLE_DETECTOR = true;
const DEBUG = true;
const dbg = (...args) => { if (DEBUG) console.log('[Tests2]', ...args); };

// LocalStorage keys reused for consistency
const LS_KEYS = {
  roiSize: 'detectorRoiSize',
  hueWeight: 'detectorHueWeight',
  satWeight: 'detectorSatWeight',
  valWeight: 'detectorValWeight',
  sensitivity: 'detectorSensitivity',
};

function Tests2() {
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
  const [abPercents, setAbPercents] = useState({ a: null, b: null });
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

  const streamRef = useRef(null);
  const isMounted = useRef(false);
  const requestIdRef = useRef(0);
  const initializedForRequestRef = useRef(null);

  const removeVideoEventListeners = useCallback((video) => {
    dbg('Removing video event listeners (Tests2 placeholder).');
  }, []);

  const addVideoEventListeners = (video) => {
    dbg('Adding video event listeners (Tests2 placeholder).');
  };

  useEffect(() => { calibrationARef.current = calibrationA; }, [calibrationA]);
  useEffect(() => { calibrationBRef.current = calibrationB; }, [calibrationB]);
  useEffect(() => { detectorSettingsRef.current = detectorSettings; }, [detectorSettings]);

  useEffect(() => {
    isMounted.current = true;
    if (ENABLE_DETECTOR) requestCameraPermission();

    const loadCalibs = () => {
      try {
        const a = JSON.parse(localStorage.getItem('calibrationA') || 'null');
        const b = JSON.parse(localStorage.getItem('calibrationB') || 'null');
        if (a) setCalibrationA({ h: a.h, s: a.s, v: a.v });
        if (b) setCalibrationB({ h: b.h, s: b.s, v: b.v });
      } catch {}
    };
    loadCalibs();

    const onStorage = (ev) => {
      if (!ev || !ev.key) return;
      if (['calibrationA', 'calibrationB'].includes(ev.key)) loadCalibs();
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
      isMounted.current = false;
      requestIdRef.current += 1;
      initializedForRequestRef.current = null;
      if (cameraRef.current) { cameraRef.current.stop(); cameraRef.current = null; }
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
      const video = videoRef.current; if (video) { video.srcObject = null; removeVideoEventListeners(video); }
      if (handsRef.current) { handsRef.current.close(); handsRef.current = null; }
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const requestCameraPermission = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    addVideoEventListeners(video);
    const myRequestId = ++requestIdRef.current;
    initializedForRequestRef.current = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (!isMounted.current || myRequestId !== requestIdRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;
      video.srcObject = stream;
      await new Promise((resolve) => {
        const ready = video.readyState >= 1 && video.videoWidth > 0 && video.videoHeight > 0;
        if (ready) return resolve();
        const onLoaded = () => { video.removeEventListener('loadedmetadata', onLoaded); resolve(); };
        video.addEventListener('loadedmetadata', onLoaded, { once: true });
        setTimeout(() => { video.removeEventListener('loadedmetadata', onLoaded); resolve(); }, 1500);
      });
      if (!isMounted.current || myRequestId !== requestIdRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
      try { await video.play(); } catch {}
      if (initializedForRequestRef.current !== myRequestId) { initializedForRequestRef.current = myRequestId; initializeMediaPipe(); }
    } catch (err) { setCameraError(err.message); }
  }, []);

  const initializeMediaPipe = async () => {
    try {
      const HandsCtor = await (async () => {
        try { if (typeof Hands === 'function') return Hands; } catch {}
        if (typeof window !== 'undefined' && window.Hands && typeof window.Hands === 'function') return window.Hands;
        await new Promise((resolve, reject) => {
          const id = 'mp-hands-cdn-tests2';
          if (document.getElementById(id)) return resolve();
          const s = document.createElement('script');
          s.id = id; s.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js'; s.async = true;
          s.onload = () => resolve(); s.onerror = () => reject(new Error('Failed to load MediaPipe Hands'));
          document.head.appendChild(s);
        });
        if (window.Hands && typeof window.Hands === 'function') return window.Hands;
        throw new Error('Hands constructor unavailable');
      })();

      const hands = new HandsCtor({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
      hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
      hands.onResults(onResults);
      handsRef.current = hands;

      if (videoRef.current) {
        const CameraCtor = await (async () => {
          try { if (typeof Camera === 'function') return Camera; } catch {}
          if (typeof window !== 'undefined' && window.Camera && typeof window.Camera === 'function') return window.Camera;
          await new Promise((resolve, reject) => {
            const id = 'mp-camera-cdn-tests2';
            if (document.getElementById(id)) return resolve();
            const s = document.createElement('script');
            s.id = id; s.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js'; s.async = true;
            s.onload = () => resolve(); s.onerror = () => reject(new Error('Failed to load MediaPipe Camera'));
            document.head.appendChild(s);
          });
          if (window.Camera && typeof window.Camera === 'function') return window.Camera;
          throw new Error('Camera constructor unavailable');
        })();
        const camera = new CameraCtor(videoRef.current, { onFrame: async () => { await hands.send({ image: videoRef.current }); }, width: 640, height: 480 });
        camera.start();
        cameraRef.current = camera;
      }
    } catch (e) { setCameraError(e.message); }
  };

  const hsvToCssColor = (h, s, v) => {
    const H = (h || 0) * 2; const S = (s || 0) / 255; const V = (v || 0) / 255; const C = V * S; const X = C * (1 - Math.abs(((H / 60) % 2) - 1)); const m = V - C; let r1=0,g1=0,b1=0; if (H<60){r1=C;g1=X;} else if (H<120){r1=X;g1=C;} else if (H<180){g1=C;b1=X;} else if (H<240){g1=X;b1=C;} else if (H<300){r1=X;b1=C;} else {r1=C;b1=X;} const r=Math.round((r1+m)*255); const g=Math.round((g1+m)*255); const b=Math.round((b1+m)*255); return `rgb(${r}, ${g}, ${b})`; };
  const calibToCss = (calib) => calib ? hsvToCssColor(calib.h, calib.s, calib.v) : '#444';

  const onResults = (results) => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw video frame (flipped)
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
    ctx.restore();

    let detectedStatus = 'None';

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      // Find highest hand (smallest y value)
      let highestHand = null;
      let highestY = 1;

      results.multiHandLandmarks.forEach(landmarks => {
        const wrist = landmarks[0]; // WRIST landmark
        if (wrist.y < highestY) {
          highestY = wrist.y;
          highestHand = landmarks;
        }
      });

      // Draw all hands
      results.multiHandLandmarks.forEach(landmarks => {
        drawLandmarks(ctx, landmarks, canvas.width, canvas.height);
      });

      if (highestHand) {
        const wrist = highestHand[0];
        const middleMCP = highestHand[9]; // Middle finger knuckle

        const wristX = (1 - wrist.x) * canvas.width;
        const wristY = wrist.y * canvas.height;
        const mcpX = (1 - middleMCP.x) * canvas.width;
        const mcpY = middleMCP.y * canvas.height;

        // Calculate rough hand size in pixels to scale the ROI dynamically
        const dx = wristX - mcpX;
        const dy = wristY - mcpY;
        const handSizePx = Math.sqrt(dx * dx + dy * dy);

        // User slider (roiSize) as a scale multiplier around a nominal hand size
        const userScale = (detectorSettingsRef.current?.roiSize || 60) / 60;
        const dynamicSize = Math.max(20, Math.min(300, handSizePx * 1.5 * userScale));

        const halfSize = dynamicSize / 2;
        const x1 = Math.max(0, wristX - halfSize);
        const y1 = Math.max(0, wristY - halfSize);
        const x2 = Math.min(canvas.width, wristX + halfSize);
        const y2 = Math.min(canvas.height, wristY + halfSize);

        // Visual feedback for ROI
        ctx.strokeStyle = 'cyan';
        ctx.lineWidth = 2;
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

        // Get ROI pixels (safety against zero-area)
        if (x2 - x1 > 1 && y2 - y1 > 1) {
          const roiData = ctx.getImageData(x1, y1, x2 - x1, y2 - y1);
          const calibA = calibrationARef.current;
          const calibB = calibrationBRef.current;
          const decision = decideBinaryAorB(roiData, calibA, calibB);
          detectedStatus = decision.status;
          setAbPercents({ a: decision.percentA, b: decision.percentB });
        }
      }
    }

    // Draw status text tinted by current decision
    let color = '#fff';
    if (detectedStatus === 'Player A' && calibrationARef.current) {
      color = calibToCss(calibrationARef.current);
    } else if (detectedStatus === 'Player B' && calibrationBRef.current) {
      color = calibToCss(calibrationBRef.current);
    }
    ctx.fillStyle = color;
    ctx.font = 'bold 28px Arial';
    ctx.fillText(`Status (Tests2): ${detectedStatus}`, 10, 40);
    setStatus(detectedStatus);
  };

  const drawLandmarks = (ctx, landmarks, width, height) => {
    ctx.strokeStyle='white'; ctx.lineWidth=2; const connections=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,13],[13,17],[0,9],[9,10],[10,11],[11,12],[0,13],[13,14],[14,15],[15,16],[0,17],[17,18],[18,19],[19,20]];
    connections.forEach(([s,e])=>{ const a=landmarks[s]; const b=landmarks[e]; ctx.beginPath(); ctx.moveTo((1-a.x)*width,a.y*height); ctx.lineTo((1-b.x)*width,b.y*height); ctx.stroke(); });
    landmarks.forEach(lm=>{ ctx.fillStyle='red'; ctx.beginPath(); ctx.arc((1-lm.x)*width,lm.y*height,5,0,2*Math.PI); ctx.fill(); });
  };

  const detectBraceletColor = (imageData) => {
    const data = imageData.data; let redCount=0; let blueCount=0;
    for (let i=0;i<data.length;i+=4){ const r=data[i], g=data[i+1], b=data[i+2]; const hsv=rgbToHsv(r,g,b);
      if (((hsv[0]>=0 && hsv[0]<=10)||(hsv[0]>=170 && hsv[0]<=180)) && hsv[1]>=120 && hsv[2]>=70) redCount++; // simplified thresholds
      if ((hsv[0]>=100 && hsv[0]<=130) && hsv[1]>=150 && hsv[2]>=70) blueCount++; }
    return { redCount, blueCount };
  };

  const decideBinaryAorB = (imageData, calibA, calibB) => {
    const data = imageData.data;
    // Single calibration shortcuts with full confidence
    if (calibA && !calibB) return { status: 'Player A', percentA: 1.0, percentB: 0 };
    if (calibB && !calibA) return { status: 'Player B', percentA: 0, percentB: 1.0 };
    if (!calibA && !calibB) return { status: 'None', percentA: 0, percentB: 0 };

    const wH = detectorSettingsRef.current?.hueWeight ?? 4.0;
    const wS = detectorSettingsRef.current?.satWeight ?? 2.0;
    const wV = detectorSettingsRef.current?.valWeight ?? 1.0;
    const sensitivity = detectorSettingsRef.current?.sensitivity ?? 0.0;

    // Strict gate: maximum allowed weighted distance for a pixel to count
    const MAX_ALLOWED_DIST = 60 + (sensitivity * 40); // lower -> stricter, higher -> looser

    let votesA = 0;
    let votesB = 0;
    let validPixels = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const [h, s, v] = rgbToHsv(r, g, b);

      // Filter out obviously dark or washed out pixels
      if (v < 30 || s < 30) continue;

      const dhA = Math.min(Math.abs(h - calibA.h), 180 - Math.abs(h - calibA.h));
      const dhB = Math.min(Math.abs(h - calibB.h), 180 - Math.abs(h - calibB.h));
      const dsA = Math.abs(s - calibA.s);
      const dsB = Math.abs(s - calibB.s);
      const dvA = Math.abs(v - calibA.v);
      const dvB = Math.abs(v - calibB.v);

      // Weighted squared distances (Euclidean-like)
      const distA = Math.sqrt(dhA * dhA * wH + dsA * dsA * wS + dvA * dvA * wV);
      const distB = Math.sqrt(dhB * dhB * wH + dsB * dsB * wS + dvB * dvB * wV);

      // Gate: ignore pixels far from both calibrations
      if (distA > MAX_ALLOWED_DIST && distB > MAX_ALLOWED_DIST) continue;

      // Count vote for the closer calibration
      if (distA < distB) votesA++; else votesB++;
      validPixels++;
    }

    if (validPixels === 0) return { status: 'None', percentA: 0, percentB: 0 };

    const percentA = votesA / validPixels;
    const percentB = votesB / validPixels;

    // Require a minimal cluster of valid pixels (e.g., 5% of ROI)
    const minValidPixels = (imageData.width * imageData.height) * 0.05;
    if (validPixels < minValidPixels) return { status: 'None', percentA: 0, percentB: 0 };

    if (percentA > 0.6) return { status: 'Player A', percentA, percentB };
    if (percentB > 0.6) return { status: 'Player B', percentA, percentB };
    return { status: 'None', percentA, percentB };
  };

  const rgbToHsv = (r,g,b) => {
    r/=255; g/=255; b/=255; const max=Math.max(r,g,b); const min=Math.min(r,g,b); const d=max-min; let h=0;
    if (d!==0){ if (max===r) h=60*(((g-b)/d)%6); else if (max===g) h=60*((b-r)/d+2); else h=60*((r-g)/d+4); }
    if (h<0) h+=360; const s=max===0?0:(d/max)*255; const v=max*255; return [h/2,s,v];
  };

  const logDetection = (detectedStatus) => {
    const ts = new Date().toISOString(); const entry={ timestamp: ts, status: detectedStatus };
    setDetectionLog(prev=>[...prev, entry]);
    const all = JSON.parse(localStorage.getItem('braceletDetectionsTests2')||'[]'); all.push(entry); localStorage.setItem('braceletDetectionsTests2', JSON.stringify(all));
  };

  useEffect(()=>{ const interval=setInterval(()=>{ setStatus(cur=>{ logDetection(cur); return cur; }); },1000); return ()=>clearInterval(interval); },[]);

  const downloadLogs = () => {
    const logs = JSON.parse(localStorage.getItem('braceletDetectionsTests2')||'[]');
    const blob = new Blob([JSON.stringify(logs,null,2)], { type:'application/json' });
    const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='tests2_logs.json'; a.click(); URL.revokeObjectURL(url);
  };
  const clearLogs = () => { localStorage.removeItem('braceletDetectionsTests2'); setDetectionLog([]); };

  return (
    <div className={`detector-window ${isMinimized ? 'minimized' : ''}`}>
      <div className="detector-header">
        <span>Bracelet Detector (Tests2)</span>
        <div className="detector-controls">
          <button onClick={downloadLogs} title="Download Logs">📥</button>
          <button onClick={clearLogs} title="Clear Logs">🗑️</button>
          <button onClick={()=>setIsMinimized(!isMinimized)}>{isMinimized ? '▢':'−'}</button>
        </div>
      </div>
      <div className="detector-content" style={{ display: isMinimized ? 'none':'block' }}>
        <video ref={videoRef} autoPlay playsInline muted style={{ position:'absolute', top:'-9999px', left:'-9999px', width:1, height:1 }} />
        <canvas ref={canvasRef} className="output_canvas" style={{ transform:'scaleX(-1)' }} />
        <div className="detector-info">
          <div className="status-display">Status: <span style={{ color: status==='Player A'&&calibrationA?calibToCss(calibrationA): status==='Player B'&&calibrationB?calibToCss(calibrationB): '#fff', fontWeight:700 }}>{status}</span></div>
          <div className="color-swatches" style={{ display:'flex', alignItems:'center', gap:12, marginTop:4 }}>
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              <span style={{ fontSize:12, opacity:0.8 }}>A</span>
              <span title="Player A calibrated color" style={{ width:14, height:14, borderRadius:3, border:'1px solid #666', display:'inline-block', background: calibrationA?calibToCss(calibrationA):'#444' }} />
              <span style={{ fontSize:12, opacity:0.8, minWidth:36, textAlign:'right' }}>{abPercents.a==null?'—':`${Math.round(Math.max(0,Math.min(1,abPercents.a))*100)}%`}</span>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              <span style={{ fontSize:12, opacity:0.8 }}>B</span>
              <span title="Player B calibrated color" style={{ width:14, height:14, borderRadius:3, border:'1px solid #666', display:'inline-block', background: calibrationB?calibToCss(calibrationB):'#444' }} />
              <span style={{ fontSize:12, opacity:0.8, minWidth:36, textAlign:'right' }}>{abPercents.b==null?'—':`${Math.round(Math.max(0,Math.min(1,abPercents.b))*100)}%`}</span>
            </div>
          </div>
          <div className="log-count">Logs: {detectionLog.length}</div>
          <div className="calib-summary" style={{ fontSize:12, opacity:0.8, marginTop:4, lineHeight:1.4 }}>
            <div>A: {calibrationA?`h${Math.round(calibrationA.h)} s${Math.round(calibrationA.s)} v${Math.round(calibrationA.v)}`:'—'}</div>
            <div>B: {calibrationB?`h${Math.round(calibrationB.h)} s${Math.round(calibrationB.s)} v${Math.round(calibrationB.v)}`:'—'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Tests2;