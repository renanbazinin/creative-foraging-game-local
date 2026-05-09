import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Hands } from '@mediapipe/hands';
import { Camera } from '@mediapipe/camera_utils';
import './BraceletDetector.css';

// TOP-DOWN CLASSIFIER V3 - Anti-Flicker
// Added: Deep Reach Locking and stiffer midline smoothing.

function TopDownPlayerClassifierV2() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const handsRef = useRef(null);
  const cameraRef = useRef(null);

  const [isMinimized, setIsMinimized] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [summary, setSummary] = useState({ A: 0, B: 0, hands: [] });

  const midlineRef = useRef(null);
  const widthRef = useRef(0);
  // V3 CHANGE: Slower smoothing (0.05) to stop midline from jittering during fast reaches
  const emaAlpha = 0.05;

  const isMounted = useRef(false);
  const streamRef = useRef(null);
  const requestIdRef = useRef(0);
  const initializedForRequestRef = useRef(null);

  useEffect(() => {
    isMounted.current = true;
    requestCameraPermission();
    return () => {
      isMounted.current = false;
      requestIdRef.current += 1;
      initializedForRequestRef.current = null;
      if (cameraRef.current) { cameraRef.current.stop(); cameraRef.current = null; }
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
      if (handsRef.current) { handsRef.current.close(); handsRef.current = null; }
    };
  }, []);

  const requestCameraPermission = useCallback(async () => {
    const video = videoRef.current; if (!video) return;
    if (streamRef.current) { streamRef.current.getTracks().forEach(t=>t.stop()); streamRef.current=null; }
    const myRequestId = ++requestIdRef.current;
    initializedForRequestRef.current = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (!isMounted.current || myRequestId !== requestIdRef.current) { stream.getTracks().forEach(t=>t.stop()); return; }
      streamRef.current = stream;
      video.srcObject = stream;
      await new Promise((resolve) => { video.onloadedmetadata = () => resolve(); });
      await video.play();
      if (initializedForRequestRef.current !== myRequestId) { initializedForRequestRef.current = myRequestId; initializeMediaPipe(); }
    } catch (e) { setCameraError(e.message); }
  }, []);

  const initializeMediaPipe = async () => {
      const hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
      hands.setOptions({ maxNumHands: 4, modelComplexity: 1, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
      hands.onResults(onResults);
      handsRef.current = hands;
      if (videoRef.current) {
          const camera = new Camera(videoRef.current, { onFrame: async () => { await hands.send({ image: videoRef.current }); }, width: 640, height: 480 });
          camera.start(); cameraRef.current = camera;
      }
  };

  const onResults = (results) => {
    const canvas = canvasRef.current; const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext('2d');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    widthRef.current = canvas.width;

    ctx.save(); ctx.scale(-1, 1); ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height); ctx.restore();

    const currentHands = [];
    if (results.multiHandLandmarks) {
      for (const lms of results.multiHandLandmarks) {
        const wrist = lms[0];
        const middleKnuckle = lms[9];
        const wristX = (1 - wrist.x) * canvas.width;
        const wristY = wrist.y * canvas.height;
        const knuckleX = (1 - middleKnuckle.x) * canvas.width;
        const pointVecX = knuckleX - wristX; // + = Right, - = Left
        currentHands.push({ x: wristX, y: wristY, vx: pointVecX });
      }
    }

    // --- MIDLINE LOGIC ---
    let sumX = 0, validMids = 0;
    currentHands.forEach(h => {
        const isLeft = h.x < (midlineRef.current || canvas.width/2);
        // Only use hands that are "behaving" to update the midline
        if ((isLeft && h.vx > 0) || (!isLeft && h.vx < 0)) { sumX += h.x; validMids++; }
    });
    if (validMids === 0 && currentHands.length > 0) { currentHands.forEach(h => sumX += h.x); validMids = currentHands.length; }
    if (validMids > 0) {
        const targetMid = (canvas.width * 0.5) * 0.9 + (sumX / validMids) * 0.1; // Bias heavily to center
        if (midlineRef.current == null) midlineRef.current = canvas.width * 0.5;
        midlineRef.current = midlineRef.current * (1 - emaAlpha) + targetMid * emaAlpha;
    }
    const mid = midlineRef.current || canvas.width * 0.5;

    // --- V3 SCORING LOGIC ---
    let countA = 0, countB = 0;
    const assignments = currentHands.map(h => {
        // 1. Base Score (Wrist side)
        let score = (h.x < mid) ? -1 : 1;

        // 2. Vector Score (Pointing direction) - V3: Increased to +/- 2.0
        const VEC_THRESHOLD = 15; // Lowered threshold slightly to catch softer points
        if (h.vx < -VEC_THRESHOLD) score += 2.0; // Pointing Left -> strongly likely A
        if (h.vx > VEC_THRESHOLD) score -= 2.0;  // Pointing Right -> strongly likely B

        // 3. V3: Deep Reach Lock
        // If wrist is in the far 25% of the screen, and pointing back home, LOCK IT.
        const farLeftZone = canvas.width * 0.25;
        const farRightZone = canvas.width * 0.75;

        // Player A deep reach into B's territory
        if (h.x < farLeftZone && h.vx < -VEC_THRESHOLD) {
             score += 3.0; // Massive bonus to lock it to A
        }
        // Player B deep reach into A's territory
        if (h.x > farRightZone && h.vx > VEC_THRESHOLD) {
             score -= 3.0; // Massive bonus to lock it to B
        }

        const player = score > 0 ? 'Player A' : 'Player B';
        if (player === 'Player A') countA++; else countB++;
        return { ...h, player, score };
    });

    // --- DRAWING ---
    ctx.strokeStyle = 'yellow'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(mid, 0); ctx.lineTo(mid, canvas.height); ctx.stroke();
    // Optional: Draw "Deep Reach" zones for debugging
    ctx.fillStyle = 'rgba(255,0,0,0.05)'; ctx.fillRect(0,0,canvas.width*0.25,canvas.height);
    ctx.fillStyle = 'rgba(0,255,0,0.05)'; ctx.fillRect(canvas.width*0.75,0,canvas.width*0.25,canvas.height);

    assignments.forEach(({ x, y, vx, player, score }) => {
      const isA = player === 'Player A';
      ctx.fillStyle = isA ? 'lime' : 'dodgerblue';
      ctx.strokeStyle = 'white'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // Draw pointing vector
      ctx.strokeStyle = isA ? 'lime' : 'dodgerblue'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + vx * 2.5, y); ctx.stroke();
      // Label
      ctx.font = 'bold 16px Arial'; ctx.fillStyle = 'white'; ctx.shadowColor='black'; ctx.shadowBlur=4;
      ctx.fillText(player, x + 16, y - 8);
      ctx.font = '12px monospace';
      ctx.fillText(`Sc:${score.toFixed(1)}`, x + 16, y + 8); // Debug score
    });

    setSummary({ A: countA, B: countB, hands: assignments });
  };

  return (
    <div className={`detector-window ${isMinimized ? 'minimized' : ''}`}>
      <div className="detector-header">
        <span>Top-Down V3 (Anti-Flicker)</span>
        <button onClick={() => setIsMinimized(!isMinimized)}>{isMinimized ? '▢' : '−'}</button>
      </div>
      <div className="detector-content" style={{ display: isMinimized ? 'none' : 'block' }}>
        <video ref={videoRef} autoPlay playsInline muted style={{ position:'absolute', opacity:0, width:1, height:1 }} />
        <canvas ref={canvasRef} className="output_canvas" style={{ transform:'scaleX(-1)' }} />
        <div className="detector-info">
           Hands: <strong style={{color:'lime'}}>A: {summary.A}</strong> | <strong style={{color:'dodgerblue'}}>B: {summary.B}</strong>
           {cameraError && <div style={{ color:'#f55' }}>Error: {cameraError}</div>}
        </div>
      </div>
    </div>
  );
}

export default TopDownPlayerClassifierV2;