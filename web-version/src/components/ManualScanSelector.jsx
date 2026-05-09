import React, { useState, useEffect, useRef } from 'react';
import './MoveHistoryEditor.css';

function ManualScanSelector({ frameDataUrl, onSave, onCancel }) {
  const [topY, setTopY] = useState(0);
  const [bottomY, setBottomY] = useState(0);
  const [leftX, setLeftX] = useState(0);
  const [rightX, setRightX] = useState(0);
  const [rotation, setRotation] = useState(0);
  const [isDraggingTop, setIsDraggingTop] = useState(false);
  const [isDraggingBottom, setIsDraggingBottom] = useState(false);
  const [isDraggingLeft, setIsDraggingLeft] = useState(false);
  const [isDraggingRight, setIsDraggingRight] = useState(false);
  const canvasRef = useRef(null);
  const [imageHeight, setImageHeight] = useState(0);
  const [imageWidth, setImageWidth] = useState(0);
  const imageRef = useRef(null);

  const drawLines = React.useCallback((ctx, top, bottom, left, right, rot, width, height, img) => {
    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw image (normal)
    if (img) {
      ctx.drawImage(img, 0, 0);
    }

    // Save context for rotation
    ctx.save();

    // Move to center, rotate, move back
    const cx = width / 2;
    const cy = height / 2;
    ctx.translate(cx, cy);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.translate(-cx, -cy);

    // Draw scan area highlight (rectangle)
    ctx.fillStyle = 'rgba(0, 255, 0, 0.2)';
    ctx.fillRect(left, top, right - left, bottom - top);

    // Draw top line (green)
    ctx.strokeStyle = '#00FF00';
    ctx.lineWidth = 3;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(right, top);
    ctx.stroke();

    // Draw bottom line (yellow)
    ctx.strokeStyle = '#FFFF00';
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(left, bottom);
    ctx.lineTo(right, bottom);
    ctx.stroke();

    // Draw left line (cyan)
    ctx.strokeStyle = '#00FFFF';
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(left, bottom);
    ctx.stroke();

    // Draw right line (magenta)
    ctx.strokeStyle = '#FF00FF';
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(right, top);
    ctx.lineTo(right, bottom);
    ctx.stroke();

    // Draw labels
    ctx.setLineDash([]);
    ctx.fillStyle = '#00FF00';
    ctx.font = '14px Arial';
    ctx.fillText('Top', left + 5, top - 5);
    ctx.fillStyle = '#FFFF00';
    ctx.fillText('Bottom', left + 5, bottom + 15);
    ctx.fillStyle = '#00FFFF';
    ctx.fillText('L', left - 15, (top + bottom) / 2);
    ctx.fillStyle = '#FF00FF';
    ctx.fillText('R', right + 5, (top + bottom) / 2);

    // Restore context
    ctx.restore();

  }, []);

  useEffect(() => {
    if (!frameDataUrl || !canvasRef.current) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');

      // Set canvas size to match image
      canvas.width = img.width;
      canvas.height = img.height;
      setImageWidth(img.width);
      setImageHeight(img.height);
      imageRef.current = img;

      // Initialize lines to a reasonable area
      const initialTop = Math.floor(img.height * 0.35);
      const initialBottom = Math.floor(img.height * 0.65);
      const initialLeft = Math.floor(img.width * 0.15);  // Wider default
      const initialRight = Math.floor(img.width * 0.85); // Wider default

      setTopY(initialTop);
      setBottomY(initialBottom);
      setLeftX(initialLeft);
      setRightX(initialRight);

      drawLines(ctx, initialTop, initialBottom, initialLeft, initialRight, 0, img.width, img.height, img);
    };

    if (frameDataUrl.startsWith('data:image')) {
      img.src = frameDataUrl;
    } else {
      img.src = `data:image/jpeg;base64,${frameDataUrl}`;
    }
  }, [frameDataUrl, drawLines]);

  useEffect(() => {
    if (!canvasRef.current || imageHeight === 0 || !imageRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    drawLines(ctx, topY, bottomY, leftX, rightX, rotation, imageWidth, imageHeight, imageRef.current);
  }, [topY, bottomY, leftX, rightX, rotation, imageWidth, imageHeight, drawLines]);

  const getRotatedCoords = (clientX, clientY) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const mx = (clientX - rect.left) * scaleX;
    const my = (clientY - rect.top) * scaleY;

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    // Translate to center
    const dx = mx - cx;
    const dy = my - cy;

    // Rotate by -angle (inverse)
    const rad = (-rotation * Math.PI) / 180;
    const rx = dx * Math.cos(rad) - dy * Math.sin(rad) + cx;
    const ry = dx * Math.sin(rad) + dy * Math.cos(rad) + cy;

    return { x: rx, y: ry };
  };

  const handleMouseDown = (e) => {
    const { x, y } = getRotatedCoords(e.clientX, e.clientY);
    const threshold = 15;

    // Check which line is closest
    const distTop = Math.abs(y - topY);
    const distBottom = Math.abs(y - bottomY);
    const distLeft = Math.abs(x - leftX);
    const distRight = Math.abs(x - rightX);

    // Only allow dragging if within the scan area roughly
    const inYRange = y >= topY - threshold && y <= bottomY + threshold;
    const inXRange = x >= leftX - threshold && x <= rightX + threshold;

    if (distTop < threshold && inXRange) {
      setIsDraggingTop(true);
    } else if (distBottom < threshold && inXRange) {
      setIsDraggingBottom(true);
    } else if (distLeft < threshold && inYRange) {
      setIsDraggingLeft(true);
    } else if (distRight < threshold && inYRange) {
      setIsDraggingRight(true);
    }
  };

  const handleMouseMove = (e) => {
    if (!isDraggingTop && !isDraggingBottom && !isDraggingLeft && !isDraggingRight) return;

    const { x, y } = getRotatedCoords(e.clientX, e.clientY);

    if (isDraggingTop) {
      const newTop = Math.max(0, Math.min(y, bottomY - 20));
      setTopY(newTop);
    } else if (isDraggingBottom) {
      const newBottom = Math.min(imageHeight, Math.max(y, topY + 20));
      setBottomY(newBottom);
    } else if (isDraggingLeft) {
      const newLeft = Math.max(0, Math.min(x, rightX - 20));
      setLeftX(newLeft);
    } else if (isDraggingRight) {
      const newRight = Math.min(imageWidth, Math.max(x, leftX + 20));
      setRightX(newRight);
    }
  };

  const handleMouseUp = () => {
    setIsDraggingTop(false);
    setIsDraggingBottom(false);
    setIsDraggingLeft(false);
    setIsDraggingRight(false);
  };

  const handleSave = () => {
    onSave({ topY, bottomY, leftX, rightX, rotation });
  };

  const isDragging = isDraggingTop || isDraggingBottom || isDraggingLeft || isDraggingRight;
  const getCursor = () => {
    if (isDraggingTop || isDraggingBottom) return 'ns-resize';
    if (isDraggingLeft || isDraggingRight) return 'ew-resize';
    return 'default';
  };

  return (
    <div className="image-modal" onClick={onCancel}>
      <div className="image-modal-content manual-scan-selector" onClick={(e) => e.stopPropagation()}>
        <button className="close-modal" onClick={onCancel}>✕</button>
        <h2>Set Manual Scan Area</h2>
        <p>Drag edges: <span style={{ color: '#00FF00' }}>Top</span>, <span style={{ color: '#FFFF00' }}>Bottom</span>, <span style={{ color: '#00FFFF' }}>Left</span>, <span style={{ color: '#FF00FF' }}>Right</span>. Use slider to rotate.</p>

        <div className="scan-controls" style={{ marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <label>Rotation: {rotation}°</label>
          <input
            type="range"
            min="-45"
            max="45"
            value={rotation}
            onChange={(e) => setRotation(Number(e.target.value))}
            style={{ flex: 1 }}
          />
        </div>

        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{
            cursor: getCursor(),
            maxWidth: '100%',
            height: 'auto',
            border: '2px solid #333'
          }}
        />
        <div className="manual-scan-info">
          <p>
            <strong>Y:</strong> {Math.round(topY)} → {Math.round(bottomY)} ({Math.round(bottomY - topY)}px) |
            <strong> X:</strong> {Math.round(leftX)} → {Math.round(rightX)} ({Math.round(rightX - leftX)}px)
          </p>
        </div>
        <div className="manual-scan-actions">
          <button onClick={handleSave} className="save-btn">Save Bounds</button>
          <button onClick={onCancel} className="cancel-btn">Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default ManualScanSelector;
