import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Hands } from '@mediapipe/hands';
import { Camera } from '@mediapipe/camera_utils';
import './BraceletDetector.css';

// TOP-DOWN CLASSIFIER V2
// Improvements: Uses hand orientation (wrist to middle finger) to detect cross-overs.

const DEBUG = true;

function TopDownPlayerClassifier() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const handsRef = useRef(null);
  const cameraRef = useRef(null);

  const [isMinimized, setIsMinimized] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [summary, setSummary] = useState({ A: 0, B: 0, hands: [] });

  const midlineRef = useRef(null);
  const widthRef = useRef(0);
  const emaAlpha = 0.1; // Slower smoothing for stability

  const isMounted = useRef(false);
  // ... (Keep your existing stream/permission handling standard) ...
  // For brevity in this answer, I am focusing on the onResults logic changes below.
  // Assume standard boilerplate for initialization is here as you had it.

  useEffect(() => {
      isMounted.current = true;
      initializeMediaPipe(); // Simplified init call for this example
      return () => { isMounted.current = false; };
  }, []);

  const initializeMediaPipe = async () => {
      const hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
      hands.setOptions({ maxNumHands: 4, modelComplexity: 1, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
      hands.onResults(onResults);
      handsRef.current = hands;

      if (videoRef.current) {
          const camera = new Camera(videoRef.current, { onFrame: async () => { await hands.send({ image: videoRef.current }); }, width: 640, height: 480 });
          camera.start();
          cameraRef.current = camera;
      }
  };

  const onResults = (results) => {
    const canvas = canvasRef.current; const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext('2d');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    widthRef.current = canvas.width;

    // Draw mirrored frame
    ctx.save(); ctx.scale(-1, 1); ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height); ctx.restore();

    const currentHands = [];
    if (results.multiHandLandmarks) {
      for (const lms of results.multiHandLandmarks) {
        // 0 = Wrist, 9 = Middle Finger MCP (knuckle), 12 = Middle Finger Tip
        // Using MCP (9) instead of Tip (12) is more stable for orientation
        const wrist = lms[0];
        const middleKnuckle = lms[9];

        // Convert to mirrored screen coordinates
        const wristX = (1 - wrist.x) * canvas.width;
        const wristY = wrist.y * canvas.height;
        const knuckleX = (1 - middleKnuckle.x) * canvas.width;
        // const knuckleY = middleKnuckle.y * canvas.height;

        // CALCULATE POINTING DIRECTION (Vector X component)
        // Positive = Pointing Right. Negative = Pointing Left.
        const pointVecX = knuckleX - wristX;

        currentHands.push({
           x: wristX, y: wristY,
           vx: pointVecX // Store the vector
        });
      }
    }

    // --- UPDATED MIDLINE LOGIC ---
    // Only update midline based on hands that are "behaving" (pointing towards center)
    // This prevents a cross-over hand from dragging the midline with it.
    let sumX = 0, validMids = 0;
    currentHands.forEach(h => {
        // If it's on the left and pointing right, OR on the right and pointing left, it's "behaving"
        const isLeft = h.x < (midlineRef.current || canvas.width/2);
        if ((isLeft && h.vx > 0) || (!isLeft && h.vx < 0)) {
             sumX += h.x; validMids++;
        }
    });

    // Fallback: if everyone is crossing over, just use pure average
    if (validMids === 0 && currentHands.length > 0) {
         currentHands.forEach(h => sumX += h.x);
         validMids = currentHands.length;
    }

    if (validMids > 0) {
        const targetMid = (canvas.width * 0.5) * 0.8 + (sumX / validMids) * 0.2; // Bias heavily towards true center
        if (midlineRef.current == null) midlineRef.current = canvas.width * 0.5;
        midlineRef.current = midlineRef.current * (1 - emaAlpha) + targetMid * emaAlpha;
    }
    const mid = midlineRef.current || canvas.width * 0.5;

    // --- NEW ASSIGNMENT LOGIC (Weighted) ---
    let countA = 0, countB = 0;
    const assignments = currentHands.map(h => {
        // Score starts based on which side of midline the WRIST is on
        // < mid = Player B (Left side), > mid = Player A (Right side)
        let score = (h.x < mid) ? -1 : 1; // -1 for B, +1 for A

        // Add weight based on pointing direction (the new "arm" logic)
        // If pointing heavily LEFT (negative vx), likely Player A.
        // If pointing heavily RIGHT (positive vx), likely Player B.
        const VEC_THRESHOLD = 20; // pixels of required pointing vector length to count as strong evidence
        if (h.vx < -VEC_THRESHOLD) score += 1.5; // Strong evidence for A
        if (h.vx > VEC_THRESHOLD) score -= 1.5;  // Strong evidence for B

        // Final decision based on score
        const player = score > 0 ? 'Player A' : 'Player B';

        if (player === 'Player A') countA++; else countB++;
        return { ...h, player, score };
    });

    // --- DRAWING ---
    // (Keep your existing drawing code, maybe add vector arrows for debug)
    ctx.strokeStyle = 'yellow'; ctx.beginPath(); ctx.moveTo(mid, 0); ctx.lineTo(mid, canvas.height); ctx.stroke();

    assignments.forEach(({ x, y, vx, player, score }) => {
      ctx.fillStyle = player === 'Player A' ? 'lime' : 'dodgerblue';
      ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill();

      // DEBUG: Draw pointing vector
      ctx.strokeStyle = player === 'Player A' ? 'lime' : 'dodgerblue';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + vx * 2, y); ctx.stroke(); // *2 to exaggerate line for visibility

      ctx.font = '16px Arial'; ctx.fillStyle = 'white';
      ctx.fillText(`${player} (${Math.round(vx)})`, x + 15, y + 5);
    });

    setSummary({ A: countA, B: countB, hands: assignments });
  };

  return (
    <div className={`detector-window ${isMinimized ? 'minimized' : ''}`}>
      <div className="detector-header">
        <span>Top-Down Player Classifier</span>
        <div className="detector-controls">
          <button onClick={() => setIsMinimized(!isMinimized)}>{isMinimized ? '▢' : '−'}</button>
        </div>
      </div>
      <div className="detector-content" style={{ display: isMinimized ? 'none' : 'block' }}>
        <video ref={videoRef} autoPlay playsInline muted style={{ position:'absolute', top:'-9999px', left:'-9999px', width:1, height:1 }} />
        <canvas ref={canvasRef} className="output_canvas" style={{ transform:'scaleX(-1)' }} />
        <div className="detector-info">
          <div className="status-display">Hands → A: {summary.A} | B: {summary.B}</div>
          <div className="calib-summary" style={{ fontSize:12, opacity:0.8, marginTop:4 }}>
            Midline: {Math.round((midlineRef.current ?? (widthRef.current*0.5)))} px
          </div>
          {cameraError && <div style={{ color:'#f55' }}>Camera error: {cameraError}</div>}
        </div>
      </div>
    </div>
  );
}

export default TopDownPlayerClassifier;
