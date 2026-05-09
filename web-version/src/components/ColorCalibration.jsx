import React, { useCallback, useEffect, useRef, useState } from 'react';
import './ColorCalibration.css';

const DEBUG = true;
const dbg = (...args) => { if (DEBUG) console.log('[Calibrate]', ...args); };

// Detector settings keys (persisted in localStorage)
const LS_KEYS = {
  roiSize: 'detectorRoiSize',
  hueWeight: 'detectorHueWeight',
  satWeight: 'detectorSatWeight',
  valWeight: 'detectorValWeight',
  sensitivity: 'detectorSensitivity',
};

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

const calibToCss = (calib) => calib ? hsvToCssColor(calib.h, calib.s, calib.v) : '#444';

function ColorCalibration() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null); // offscreen canvas for sampling
  const streamRef = useRef(null);
  const isMounted = useRef(false);
  const requestIdRef = useRef(0);

  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('');
  const [calibrationA, setCalibrationA] = useState(null);
  const [calibrationB, setCalibrationB] = useState(null);
  // Helper to safely read numbers from localStorage with proper defaults
  const getLSNumber = (key, fallback) => {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const v = parseFloat(raw);
    return Number.isFinite(v) ? v : fallback;
  };
  // Detector tuning settings (persisted)
  const [roiSize, setRoiSize] = useState(() => {
    const v = getLSNumber(LS_KEYS.roiSize, 44);
    return v > 10 ? v : 44; // default 44px
  });
  const [hueWeight, setHueWeight] = useState(() => getLSNumber(LS_KEYS.hueWeight, 4.0));
  const [satWeight, setSatWeight] = useState(() => getLSNumber(LS_KEYS.satWeight, 2.0));
  const [valWeight, setValWeight] = useState(() => getLSNumber(LS_KEYS.valWeight, 1.0));
  const [sensitivity, setSensitivity] = useState(() => getLSNumber(LS_KEYS.sensitivity, 0.0));

  // Generic Mode state
  const [genericMode, setGenericMode] = useState(false);
  const [genericPhase, setGenericPhase] = useState('idle'); // idle, playerA, switching, playerB, optimizing, complete
  const [countdown, setCountdown] = useState(5);
  const genericSamplesRef = useRef({ A: [], B: [] });

  useEffect(() => {
    isMounted.current = true;
    // preload previous calibrations
    try {
      const a = JSON.parse(localStorage.getItem('calibrationA') || 'null');
      const b = JSON.parse(localStorage.getItem('calibrationB') || 'null');
      if (a) setCalibrationA(a);
      if (b) setCalibrationB(b);
    } catch {}

    (async () => {
      await startCamera();
    })();

    return () => {
      isMounted.current = false;
      requestIdRef.current += 1; // invalidate in-flight
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      const v = videoRef.current;
      if (v) v.srcObject = null;
    };
  }, []);

  // Persist settings when they change
  useEffect(() => {
    localStorage.setItem(LS_KEYS.roiSize, String(roiSize));
  }, [roiSize]);
  useEffect(() => {
    localStorage.setItem(LS_KEYS.hueWeight, String(hueWeight));
  }, [hueWeight]);
  useEffect(() => {
    localStorage.setItem(LS_KEYS.satWeight, String(satWeight));
  }, [satWeight]);
  useEffect(() => {
    localStorage.setItem(LS_KEYS.valWeight, String(valWeight));
  }, [valWeight]);
  useEffect(() => {
    localStorage.setItem(LS_KEYS.sensitivity, String(sensitivity));
  }, [sensitivity]);

  const startCamera = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }

    const myId = ++requestIdRef.current;
    setReady(false);
    setMessage('Requesting camera...');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (!isMounted.current || myId !== requestIdRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      streamRef.current = stream;
      video.srcObject = stream;

      await new Promise((resolve) => {
        const already = video.readyState >= 1 && video.videoWidth > 0;
        if (already) return resolve();
        const onLoaded = () => { video.removeEventListener('loadedmetadata', onLoaded); resolve(); };
        video.addEventListener('loadedmetadata', onLoaded, { once: true });
        setTimeout(() => { video.removeEventListener('loadedmetadata', onLoaded); resolve(); }, 1500);
      });

      if (!isMounted.current || myId !== requestIdRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      try {
        await video.play();
        dbg('video.play resolved');
      } catch (e) {
        dbg('video.play rejected', e);
      }
      setReady(true);
      setMessage('');
    } catch (e) {
      setMessage(`Camera error: ${e?.message || e}`);
      dbg('getUserMedia error', e);
    }
  }, []);

  const rgbToHsv = (r, g, b) => {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === r) h = 60 * (((g - b) / d) % 6);
      else if (max === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
    }
    if (h < 0) h += 360;
    const s = max === 0 ? 0 : (d / max) * 255;
    const v = max * 255;
    return [h / 2, s, v]; // H in 0-180 range to match OpenCV style
  };

  const computeCenterAverageHSV = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth === 0) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, vw, vh);

    const boxSize = Math.max(10, Math.min(300, Math.floor(roiSize)));
    const x = Math.floor(vw / 2 - boxSize / 2);
    const y = Math.floor(vh / 2 - boxSize / 2);
    const roi = ctx.getImageData(x, y, boxSize, boxSize);
    const data = roi.data;

    let sumX = 0; // for Hue unit vector x
    let sumY = 0; // for Hue unit vector y
    let sumS = 0;
    let sumV = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const [h, s, v] = rgbToHsv(data[i], data[i+1], data[i+2]);
      // Convert OpenCV H (0..180) -> degrees (0..360) -> radians (0..2π)
      const hRad = (h * 2) * (Math.PI / 180);
      sumX += Math.cos(hRad);
      sumY += Math.sin(hRad);
      sumS += s;
      sumV += v;
      n++;
    }
    if (n === 0) return null;

    const avgS = sumS / n;
    const avgV = sumV / n;
    const avgX = sumX / n;
    const avgY = sumY / n;
    const avgHRad = Math.atan2(avgY, avgX);
    let avgHDeg = avgHRad * (180 / Math.PI);
    if (avgHDeg < 0) avgHDeg += 360;
    const avgH = avgHDeg / 2; // back to OpenCV 0..180 scale

    return { h: avgH, s: avgS, v: avgV };
  };

  const saveCalibration = (which) => {
    const calib = computeCenterAverageHSV();
    if (!calib) { setMessage('Could not sample video frame.'); return; }
    if (which === 'A') {
      localStorage.setItem('calibrationA', JSON.stringify(calib));
      setCalibrationA(calib);
      setMessage(`Saved Player A: h${calib.h.toFixed(0)}`);
    } else {
      localStorage.setItem('calibrationB', JSON.stringify(calib));
      setCalibrationB(calib);
      setMessage(`Saved Player B: h${calib.h.toFixed(0)}`);
    }
  };

  const clearCalibration = (which) => {
    if (which === 'A') {
      localStorage.removeItem('calibrationA');
      setCalibrationA(null);
    } else {
      localStorage.removeItem('calibrationB');
      setCalibrationB(null);
    }
    setMessage('Cleared');
  };

  // Generic Mode - Auto calibration
  const startGenericMode = () => {
    setGenericMode(true);
    setGenericPhase('playerA');
    setCountdown(5);
    genericSamplesRef.current = { A: [], B: [] };
    setMessage('Hold Player A bracelet in center square...');
  };

  // Handle countdown and phase transitions
  useEffect(() => {
    if (!genericMode || genericPhase === 'idle' || genericPhase === 'optimizing' || genericPhase === 'complete') {
      return;
    }

    if (countdown > 0) {
      const timer = setTimeout(() => {
        setCountdown(countdown - 1);
      }, 1000);
      return () => clearTimeout(timer);
    } else {
      // Countdown reached 0, transition to next phase
      if (genericPhase === 'playerA') {
        setGenericPhase('switching');
        setCountdown(3);
        setMessage('Switch to Player B... Get ready!');
      } else if (genericPhase === 'switching') {
        setGenericPhase('playerB');
        setCountdown(5);
        setMessage('Hold Player B bracelet in center square...');
      } else if (genericPhase === 'playerB') {
        setGenericPhase('optimizing');
        optimizeCalibrations();
      }
    }
  }, [genericMode, genericPhase, countdown]);

  // Sample continuously during generic mode (but NOT during switching phase)
  useEffect(() => {
    if (!genericMode || genericPhase === 'idle' || genericPhase === 'switching' || genericPhase === 'optimizing' || genericPhase === 'complete') {
      return;
    }

    const samplingInterval = setInterval(() => {
      const sample = computeCenterAverageHSV();
      if (sample) {
        if (genericPhase === 'playerA') {
          genericSamplesRef.current.A.push(sample);
        } else if (genericPhase === 'playerB') {
          genericSamplesRef.current.B.push(sample);
        }
      }
    }, 200); // Sample every 200ms

    return () => clearInterval(samplingInterval);
  }, [genericMode, genericPhase]);

  const optimizeCalibrations = () => {
    setMessage('Optimizing parameters...');
    
    const samplesA = genericSamplesRef.current.A;
    const samplesB = genericSamplesRef.current.B;

    if (samplesA.length === 0 || samplesB.length === 0) {
      setMessage('Error: Not enough samples collected!');
      setGenericMode(false);
      setGenericPhase('idle');
      return;
    }

    // Calculate median HSV for each player (more robust than average)
    const medianCalibA = calculateMedianHSV(samplesA);
    const medianCalibB = calculateMedianHSV(samplesB);

    // Calculate the HSV distance between the two players
    const hDist = Math.min(Math.abs(medianCalibA.h - medianCalibB.h), 
                           180 - Math.abs(medianCalibA.h - medianCalibB.h));
    const sDist = Math.abs(medianCalibA.s - medianCalibB.s);
    const vDist = Math.abs(medianCalibA.v - medianCalibB.v);

    // Auto-optimize weights based on which channel provides best separation
    // Normalize distances and use inverse as weights
    const hSep = hDist / 90; // max hue distance is 90 (half of 180)
    const sSep = sDist / 255;
    const vSep = vDist / 255;

    // Calculate weights inversely proportional to variance, proportional to separation
    const varianceA = calculateVariance(samplesA);
    const varianceB = calculateVariance(samplesB);
    const avgVariance = {
      h: (varianceA.h + varianceB.h) / 2,
      s: (varianceA.s + varianceB.s) / 2,
      v: (varianceA.v + varianceB.v) / 2
    };

    // Weight formula: higher separation and lower variance = higher weight
    const totalSep = hSep + sSep + vSep;
    const hWeight = totalSep > 0 ? (hSep / totalSep) * (1 / (1 + avgVariance.h / 20)) * 6 : 2.0;
    const sWeight = totalSep > 0 ? (sSep / totalSep) * (1 / (1 + avgVariance.s / 50)) * 4 : 1.0;
    const vWeight = totalSep > 0 ? (vSep / totalSep) * (1 / (1 + avgVariance.v / 50)) * 3 : 0.5;

    // Set optimized values
    setHueWeight(Math.max(0.5, Math.min(6, hWeight)));
    setSatWeight(Math.max(0.1, Math.min(4, sWeight)));
    setValWeight(Math.max(0.1, Math.min(3, vWeight)));

    // Auto-adjust sensitivity based on overlap
    const overlapScore = calculateOverlap(samplesA, samplesB, medianCalibA, medianCalibB);
    const optimalSensitivity = Math.max(0, Math.min(0.8, overlapScore * 0.5));
    setSensitivity(optimalSensitivity);

    // Save calibrations
    localStorage.setItem('calibrationA', JSON.stringify(medianCalibA));
    localStorage.setItem('calibrationB', JSON.stringify(medianCalibB));
    setCalibrationA(medianCalibA);
    setCalibrationB(medianCalibB);

    setGenericPhase('complete');
    setMessage(`✓ Auto-calibration complete! Collected ${samplesA.length + samplesB.length} samples. Optimized parameters for best separation.`);
    
    setTimeout(() => {
      setGenericMode(false);
      setGenericPhase('idle');
    }, 3000);
  };

  const calculateMedianHSV = (samples) => {
    // For hue, we need circular median
    const hValues = samples.map(s => s.h);
    const sValues = samples.map(s => s.s).sort((a, b) => a - b);
    const vValues = samples.map(s => s.v).sort((a, b) => a - b);

    // Circular mean for hue (more robust than median for angles)
    let sumX = 0, sumY = 0;
    hValues.forEach(h => {
      const rad = (h * 2) * (Math.PI / 180);
      sumX += Math.cos(rad);
      sumY += Math.sin(rad);
    });
    const avgHRad = Math.atan2(sumY / hValues.length, sumX / hValues.length);
    let avgHDeg = avgHRad * (180 / Math.PI);
    if (avgHDeg < 0) avgHDeg += 360;
    const medianH = avgHDeg / 2;

    const medianS = sValues[Math.floor(sValues.length / 2)];
    const medianV = vValues[Math.floor(vValues.length / 2)];

    return { h: medianH, s: medianS, v: medianV };
  };

  const calculateVariance = (samples) => {
    const mean = samples.reduce((acc, s) => ({
      h: acc.h + s.h,
      s: acc.s + s.s,
      v: acc.v + s.v
    }), { h: 0, s: 0, v: 0 });
    
    mean.h /= samples.length;
    mean.s /= samples.length;
    mean.v /= samples.length;

    const variance = samples.reduce((acc, s) => ({
      h: acc.h + Math.pow(s.h - mean.h, 2),
      s: acc.s + Math.pow(s.s - mean.s, 2),
      v: acc.v + Math.pow(s.v - mean.v, 2)
    }), { h: 0, s: 0, v: 0 });

    return {
      h: variance.h / samples.length,
      s: variance.s / samples.length,
      v: variance.v / samples.length
    };
  };

  const calculateOverlap = (samplesA, samplesB, calibA, calibB) => {
    // Calculate how much the two distributions overlap
    // Higher overlap = need higher sensitivity threshold
    let overlapCount = 0;
    const totalComparisons = Math.min(samplesA.length, samplesB.length) * 2;

    samplesA.forEach(sampleA => {
      const distToA = hsvDistance(sampleA, calibA);
      const distToB = hsvDistance(sampleA, calibB);
      if (distToB < distToA * 1.5) overlapCount++; // If closer to wrong calibration
    });

    samplesB.forEach(sampleB => {
      const distToA = hsvDistance(sampleB, calibA);
      const distToB = hsvDistance(sampleB, calibB);
      if (distToA < distToB * 1.5) overlapCount++;
    });

    return overlapCount / totalComparisons;
  };

  const hsvDistance = (sample, calib) => {
    const dh = Math.min(Math.abs(sample.h - calib.h), 180 - Math.abs(sample.h - calib.h));
    const ds = Math.abs(sample.s - calib.s);
    const dv = Math.abs(sample.v - calib.v);
    return Math.sqrt(dh * dh + ds * ds + dv * dv);
  };

  const cancelGenericMode = () => {
    setGenericMode(false);
    setGenericPhase('idle');
    setCountdown(5);
    setMessage('Generic mode cancelled');
  };

  return (
    <div className="calib-root">
      <div className="calib-header">
        <h2>Color Calibration</h2>
        <div className="calib-actions">
          <button onClick={() => window.location.hash = ''}>Back</button>
          <button onClick={startCamera}>Restart Camera</button>
        </div>
      </div>

      {message && <div className="calib-message">{message}</div>}

      <div className="calib-content">
        <div>
          <div className="calib-block" style={{ marginBottom: 12 }}>
            <div className="label">Live Preview</div>
            <div className="value" style={{ marginBottom: 8 }}>
              {genericMode 
                ? `Generic Mode Active: ${
                    genericPhase === 'playerA' ? 'Player A' : 
                    genericPhase === 'switching' ? 'Switching...' :
                    genericPhase === 'playerB' ? 'Player B' : 
                    'Processing...'
                  }`
                : 'Place the bracelet color inside the center square to sample accurate HSV.'}
            </div>
            <div className="calib-video-wrap">
              <video
                ref={videoRef}
                className="calib-video"
                autoPlay
                playsInline
                muted
              />
              {/* center square overlay */}
              <div 
                className="calib-center-box" 
                style={{ 
                  width: roiSize, 
                  height: roiSize,
                  borderColor: genericMode ? '#22d3ee' : '#22d3ee',
                  borderWidth: genericMode ? '4px' : '3px',
                  boxShadow: genericMode ? '0 0 20px rgba(34, 211, 238, 0.6)' : '0 0 0 2000px rgba(0,0,0,0.35)'
                }} 
              />
              {genericMode && countdown > 0 && (
                <div style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  fontSize: '72px',
                  fontWeight: 'bold',
                  color: '#22d3ee',
                  textShadow: '0 0 20px rgba(34, 211, 238, 0.8), 0 0 40px rgba(34, 211, 238, 0.5)',
                  pointerEvents: 'none',
                  zIndex: 10
                }}>
                  {countdown}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="calib-controls">
        <div className="calib-block" style={{ background: genericMode ? '#1a2332' : '#0f172a', border: genericMode ? '2px solid #22d3ee' : '1px solid #1f2937' }}>
          <div className="label">🤖 Generic Mode (Auto-Calibration)</div>
          <div className="value" style={{ fontSize: 13, marginBottom: 8 }}>
            Automatically calibrate both players with optimized parameters. Hold each bracelet in the center square for 5 seconds.
          </div>
          {!genericMode ? (
            <div className="buttons">
              <button 
                onClick={startGenericMode} 
                disabled={!ready}
                style={{ background: '#22d3ee', color: '#000', fontWeight: 'bold' }}
              >
                Start Generic Mode
              </button>
            </div>
          ) : (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 16, fontWeight: 'bold', color: '#22d3ee', marginBottom: 8 }}>
                {genericPhase === 'playerA' && `Player A: Hold bracelet steady... ${countdown}s`}
                {genericPhase === 'switching' && `Switch hands! Get Player B ready... ${countdown}s`}
                {genericPhase === 'playerB' && `Player B: Hold bracelet steady... ${countdown}s`}
                {genericPhase === 'optimizing' && 'Optimizing parameters...'}
                {genericPhase === 'complete' && '✓ Complete!'}
              </div>
              <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>
                {genericPhase === 'playerA' && `Samples collected: ${genericSamplesRef.current.A.length}`}
                {genericPhase === 'switching' && `Player A: ${genericSamplesRef.current.A.length} samples collected`}
                {genericPhase === 'playerB' && `Samples collected: ${genericSamplesRef.current.B.length}`}
              </div>
              {genericPhase !== 'complete' && (
                <button onClick={cancelGenericMode} style={{ background: '#ef4444' }}>
                  Cancel
                </button>
              )}
            </div>
          )}
        </div>
        <div className="calib-block">
          <div className="label">Detector Settings</div>
          <div className="value" style={{ display: 'grid', gap: 8 }}>
            <label style={{ display: 'grid', gridTemplateColumns: '180px 1fr 60px', alignItems: 'center', gap: 8 }}>
              <span>Detection square size</span>
              <input type="range" min="20" max="240" step="2" value={roiSize}
                onChange={(e) => setRoiSize(Number(e.target.value))} />
              <span style={{ textAlign: 'right' }}>{roiSize}px</span>
            </label>
            <label style={{ display: 'grid', gridTemplateColumns: '180px 1fr 60px', alignItems: 'center', gap: 8 }}>
              <span>Hue weight</span>
              <input type="range" min="0" max="6" step="0.1" value={hueWeight}
                onChange={(e) => setHueWeight(Number(e.target.value))} />
              <span style={{ textAlign: 'right' }}>{hueWeight.toFixed(1)}</span>
            </label>
            <label style={{ display: 'grid', gridTemplateColumns: '180px 1fr 60px', alignItems: 'center', gap: 8 }}>
              <span>Saturation weight</span>
              <input type="range" min="0" max="4" step="0.1" value={satWeight}
                onChange={(e) => setSatWeight(Number(e.target.value))} />
              <span style={{ textAlign: 'right' }}>{satWeight.toFixed(1)}</span>
            </label>
            <label style={{ display: 'grid', gridTemplateColumns: '180px 1fr 60px', alignItems: 'center', gap: 8 }}>
              <span>Value weight</span>
              <input type="range" min="0" max="3" step="0.1" value={valWeight}
                onChange={(e) => setValWeight(Number(e.target.value))} />
              <span style={{ textAlign: 'right' }}>{valWeight.toFixed(1)}</span>
            </label>
            <label style={{ display: 'grid', gridTemplateColumns: '180px 1fr 60px', alignItems: 'center', gap: 8 }}>
              <span>Sensitivity (lower = more sensitive)</span>
              <input type="range" min="0" max="1" step="0.05" value={sensitivity}
                onChange={(e) => setSensitivity(Number(e.target.value))} />
              <span style={{ textAlign: 'right' }}>{(sensitivity*100).toFixed(0)}%</span>
            </label>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              These settings are saved to local storage and used by the detector (wrist ROI, A/B decision weights, and sensitivity gate).
            </div>
          </div>
        </div>
        <div className="calib-block">
          <div className="label">Player A</div>
          <div className="value" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              title="Player A color"
              style={{ width: 16, height: 16, borderRadius: 3, border: '1px solid #666', display: 'inline-block', background: calibToCss(calibrationA) }}
            />
            <span>{calibrationA ? `h${calibrationA.h.toFixed(0)} s${calibrationA.s.toFixed(0)} v${calibrationA.v.toFixed(0)}` : '—'}</span>
          </div>
          <div className="buttons">
            <button onClick={() => saveCalibration('A')} disabled={!ready}>Save A</button>
            <button onClick={() => clearCalibration('A')}>Clear A</button>
          </div>
        </div>
        <div className="calib-block">
          <div className="label">Player B</div>
          <div className="value" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              title="Player B color"
              style={{ width: 16, height: 16, borderRadius: 3, border: '1px solid #666', display: 'inline-block', background: calibToCss(calibrationB) }}
            />
            <span>{calibrationB ? `h${calibrationB.h.toFixed(0)} s${calibrationB.s.toFixed(0)} v${calibrationB.v.toFixed(0)}` : '—'}</span>
          </div>
          <div className="buttons">
            <button onClick={() => saveCalibration('B')} disabled={!ready}>Save B</button>
            <button onClick={() => clearCalibration('B')}>Clear B</button>
          </div>
        </div>
        </div>
      </div>

      {/* offscreen canvas for sampling */}
      <canvas ref={canvasRef} className="calib-offscreen" />
    </div>
  );
}

export default ColorCalibration;
