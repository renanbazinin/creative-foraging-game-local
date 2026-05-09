import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  getActiveDataRoot,
  restoreDataRootFromStorage,
  getSessionByGameId,
  updateMovePlayersBatch,
  getMoveId
} from '../services/localSessionStore';
import './SwipeView.css';

// Helper function to convert HSV calibration to Hex color
const hsvToHex = (calib) => {
  if (!calib || typeof calib.h === 'undefined') return null;

  const h = (calib.h || 0) * 2; // Convert 0-180 to 0-360
  const s = (calib.s || 0) / 255; // Convert 0-255 to 0-1
  const v = (calib.v || 0) / 255; // Convert 0-255 to 0-1

  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  let r = 0, g = 0, b = 0;
  if (h >= 0 && h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }

  const toHex = (val) => {
    const hex = Math.round((val + m) * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
};

// Helper to darken a hex color for gradient
const darkenHex = (hex, factor = 0.3) => {
  if (!hex || !hex.startsWith('#')) return '#0f0f23';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const dr = Math.round(r * factor);
  const dg = Math.round(g * factor);
  const db = Math.round(b * factor);
  return `#${dr.toString(16).padStart(2, '0')}${dg.toString(16).padStart(2, '0')}${db.toString(16).padStart(2, '0')}`;
};

function SwipeView({ sessionGameId, onClose, initialFrames = [], clusterColors = {} }) {
  const [frames, setFrames] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dataRoot, setDataRoot] = useState(() => getActiveDataRoot());
  const [swipeDirection, setSwipeDirection] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [stats, setStats] = useState({ total: 0, labeled: 0, skipped: 0 });
  const [labeledIds, setLabeledIds] = useState([]); // Track IDs that were labeled (not skipped)
  const [skippedIds, setSkippedIds] = useState([]); // Track IDs that were skipped
  const [decisions, setDecisions] = useState([]); // Store all decisions: { moveId, player }
  const [saving, setSaving] = useState(false); // Track batch save in progress
  const [saveError, setSaveError] = useState(null); // Track batch save error
  const [calibrationColors, setCalibrationColors] = useState({ colorA: null, colorB: null });
  
  const cardRef = useRef(null);
  const startPos = useRef({ x: 0, y: 0 });
  const containerRef = useRef(null);

  // Get cluster color for a player (k-means detected colors)
  const getClusterColor = (player) => {
    if (clusterColors[player]) return clusterColors[player];
    if (player === 'Player A') return '#FF5722'; // Orange-red
    if (player === 'Player B') return '#2196F3'; // Blue
    return '#9E9E9E'; // Gray for none
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const h = await restoreDataRootFromStorage();
      if (!cancelled && h) setDataRoot(h);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Load calibration colors from localStorage (bracelet detector)
    try {
      const calibA = JSON.parse(localStorage.getItem('calibrationA') || 'null');
      const calibB = JSON.parse(localStorage.getItem('calibrationB') || 'null');
      const colorA = hsvToHex(calibA);
      const colorB = hsvToHex(calibB);
      setCalibrationColors({ colorA, colorB });
      console.log('[SwipeView] 🎨 Loaded calibration colors:', { colorA, colorB });
    } catch (err) {
      console.warn('[SwipeView] Error loading calibration colors:', err);
    }
  }, []);

  // Compute background gradient based on calibration colors
  const getBackgroundStyle = () => {
    const colorA = calibrationColors.colorA || clusterColors['Player A'] || '#FF5722';
    const colorB = calibrationColors.colorB || clusterColors['Player B'] || '#2196F3';
    const darkA = darkenHex(colorA, 0.15);
    const darkB = darkenHex(colorB, 0.15);
    const darkCenter = '#0f0f23';
    return {
      background: `linear-gradient(135deg, ${darkA} 0%, ${darkCenter} 50%, ${darkB} 100%)`
    };
  };

  // Initialize frames from props or load from API
  useEffect(() => {
    if (initialFrames && initialFrames.length > 0) {
      setFrames(initialFrames);
      setStats({ 
        total: initialFrames.length, 
        labeled: 0, 
        skipped: 0 
      });
      setLoading(false);
    } else if (sessionGameId && (dataRoot || getActiveDataRoot())) {
      loadSession();
    }
  }, [sessionGameId, dataRoot, initialFrames]);

  const loadSession = async () => {
    const root = dataRoot || getActiveDataRoot();
    if (!root) {
      setError('No data folder connected.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await getSessionByGameId(root, sessionGameId);

      const movesWithFrames = (data.moves || []).filter(m => m.camera_frame);
      const unknownMoves = movesWithFrames.filter(m => 
        !m.player || m.player === 'Unknown' || m.player === 'None'
      );
      
      const framesToReview = unknownMoves.map(m => ({
        id: getMoveId(m),
        frameUrl: m.camera_frame,
        player: m.player || 'Unknown',
        time: m.elapsed,
        confidence: null,
        type: m.type,
        phase: m.phase
      }));

      setFrames(framesToReview);
      setStats({ 
        total: framesToReview.length, 
        labeled: 0, 
        skipped: 0 
      });
    } catch (err) {
      console.error('[SwipeView] Error loading session:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePlayerUpdate = useCallback(async (moveId, newPlayer, frameIndex) => {
    if (!sessionGameId || !moveId) {
      console.error('[SwipeView] Missing sessionGameId or moveId');
      return false;
    }
    console.log(`[SwipeView] Frame #${frameIndex + 1} queued: ${moveId} → ${newPlayer}`);
    return true;
  }, [sessionGameId]);

  const saveAllDecisions = useCallback(async () => {
    if (decisions.length === 0) {
      return true;
    }

    const root = dataRoot || getActiveDataRoot();
    if (!sessionGameId || !root) {
      console.error('[SwipeView] Missing session or data folder');
      return false;
    }

    setSaving(true);
    setSaveError(null);

    try {
      const updates = decisions.map((d) => ({ moveId: d.moveId, player: d.player }));
      await updateMovePlayersBatch(root, sessionGameId, updates);
      return true;
    } catch (err) {
      console.error('[SwipeView] Batch save failed:', err.message);
      setSaveError(err.message);
      return false;
    } finally {
      setSaving(false);
    }
  }, [decisions, sessionGameId, dataRoot]);

  const handleSwipe = useCallback((direction) => {
    if (currentIndex >= frames.length) return;

    const currentFrame = frames[currentIndex];
    const frameIndex = currentIndex;
    let player;
    
    if (direction === 'left') {
      player = 'Player A';
    } else if (direction === 'right') {
      player = 'Player B';
    } else {
      player = 'None'; // Skip
    }

    // Update UI immediately
    setSwipeDirection(direction);
    setStats(prev => ({
      ...prev,
      labeled: direction !== 'skip' ? prev.labeled + 1 : prev.labeled,
      skipped: direction === 'skip' ? prev.skipped + 1 : prev.skipped
    }));
    
    // Track labeled vs skipped IDs
    if (direction === 'skip') {
      setSkippedIds(prev => [...prev, currentFrame.id]);
    } else {
      setLabeledIds(prev => [...prev, currentFrame.id]);
    }

    // Store decision locally (will be saved in batch at the end)
    setDecisions(prev => [...prev, { moveId: currentFrame.id, player, frameIndex }]);
    console.log(`[SwipeView] 📝 Frame #${frameIndex + 1}: ${currentFrame.id} → ${player}`);

    // Move to next frame after animation
    setTimeout(() => {
      setSwipeDirection(null);
      setDragOffset({ x: 0, y: 0 });
      setCurrentIndex(prev => prev + 1);
    }, 200); // Fast animation
  }, [currentIndex, frames]);

  const handleSkip = useCallback(() => {
    handleSwipe('skip');
  }, [handleSwipe]);

  // Touch/Mouse handlers for swipe gesture
  const handleDragStart = (e) => {
    setIsDragging(true);
    const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
    const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
    startPos.current = { x: clientX, y: clientY };
  };

  const handleDragMove = useCallback((e) => {
    if (!isDragging) return;
    const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
    const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
    
    const deltaX = clientX - startPos.current.x;
    const deltaY = clientY - startPos.current.y;
    
    setDragOffset({ x: deltaX, y: deltaY });
  }, [isDragging]);

  const handleDragEnd = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);
    
    const threshold = 100; // Minimum swipe distance
    
    if (dragOffset.x > threshold) {
      handleSwipe('right'); // Player B
    } else if (dragOffset.x < -threshold) {
      handleSwipe('left'); // Player A
    } else {
      // Reset position if not enough swipe
      setDragOffset({ x: 0, y: 0 });
    }
  }, [isDragging, dragOffset, handleSwipe]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (currentIndex >= frames.length) return;
      
      switch (e.key) {
        case 'ArrowLeft':
          handleSwipe('left');
          break;
        case 'ArrowRight':
          handleSwipe('right');
          break;
        case 'ArrowDown':
        case ' ':
          e.preventDefault();
          handleSkip();
          break;
        case 'Escape':
          // For escape, call onClose directly since handleClose depends on state
          if (onClose) onClose({ labeledIds, skippedIds });
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, frames.length, handleSwipe, handleSkip, onClose, labeledIds, skippedIds]);

  // Add event listeners for drag
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleDragMove);
      window.addEventListener('mouseup', handleDragEnd);
      window.addEventListener('touchmove', handleDragMove);
      window.addEventListener('touchend', handleDragEnd);
    }
    return () => {
      window.removeEventListener('mousemove', handleDragMove);
      window.removeEventListener('mouseup', handleDragEnd);
      window.removeEventListener('touchmove', handleDragMove);
      window.removeEventListener('touchend', handleDragEnd);
    };
  }, [isDragging, handleDragMove, handleDragEnd]);

  const currentFrame = frames[currentIndex];
  const progress = frames.length > 0 ? ((currentIndex) / frames.length) * 100 : 0;
  const isComplete = currentIndex >= frames.length;
  const [saved, setSaved] = useState(false);

  // Calculate rotation based on drag
  const rotation = dragOffset.x * 0.05;
  const opacity = Math.max(0.5, 1 - Math.abs(dragOffset.x) / 400);

  // Trigger batch save when complete
  useEffect(() => {
    if (isComplete && decisions.length > 0 && !saving && !saved && !saveError) {
      console.log('[SwipeView] 🏁 Completed! Triggering batch save...');
      saveAllDecisions().then(success => {
        if (success) {
          setSaved(true);
        }
      });
    }
  }, [isComplete, decisions.length, saving, saved, saveError, saveAllDecisions]);

  // Handler to close and pass back labeled IDs
  const handleClose = useCallback(() => {
    if (onClose) {
      onClose({ labeledIds, skippedIds });
    }
  }, [onClose, labeledIds, skippedIds]);

  if (loading) {
    return (
      <div className="swipe-view-container" style={getBackgroundStyle()}>
        <div className="swipe-view-loading">
          <div className="loading-spinner"></div>
          <p>Loading frames...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="swipe-view-container" style={getBackgroundStyle()}>
        <div className="swipe-view-error">
          <h2>Error</h2>
          <p>{error}</p>
          <button onClick={handleClose} className="close-btn">Close</button>
        </div>
      </div>
    );
  }

  if (frames.length === 0) {
    return (
      <div className="swipe-view-container" style={getBackgroundStyle()}>
        <div className="swipe-view-empty">
          <h2>🎉 All Done!</h2>
          <p>No frames need review.</p>
          <button onClick={handleClose} className="close-btn">Close</button>
        </div>
      </div>
    );
  }

  return (
    <div className="swipe-view-container" ref={containerRef} style={getBackgroundStyle()}>
      {/* Header */}
      <header className="swipe-view-header">
        <button className="close-btn" onClick={handleClose}>✕</button>
        <div className="swipe-view-title">
          <h1>Swipe View</h1>
          <span className="session-badge">{sessionGameId}</span>
        </div>
        <div className="progress-info">
          <span>{currentIndex} / {frames.length}</span>
        </div>
      </header>

      {/* Progress bar */}
      <div className="progress-bar-container">
        <div className="progress-bar" style={{ width: `${progress}%` }}></div>
      </div>

      {/* Main content */}
      <main className="swipe-view-main">
        {isComplete ? (
          <div className="swipe-complete">
            <div className="complete-icon">🎉</div>
            <h2>All Done!</h2>
            <div className="complete-stats">
              <div className="stat">
                <span className="stat-value">{stats.labeled}</span>
                <span className="stat-label">Labeled</span>
              </div>
              <div className="stat">
                <span className="stat-value">{stats.skipped}</span>
                <span className="stat-label">Skipped</span>
              </div>
              <div className="stat">
                <span className="stat-value">{stats.total}</span>
                <span className="stat-label">Total</span>
              </div>
            </div>
            {saving && (
              <div style={{ color: '#FFC107', marginTop: '16px', fontSize: '14px' }}>
                ⏳ Saving {decisions.length} changes...
              </div>
            )}
            {saveError && (
              <div style={{ color: '#f44336', marginTop: '8px', fontSize: '14px' }}>
                ❌ Save failed: {saveError}
                <button 
                  onClick={() => {
                    setSaveError(null);
                    saveAllDecisions().then(success => {
                      if (success) setSaved(true);
                    });
                  }}
                  style={{ marginLeft: '8px', padding: '4px 8px', cursor: 'pointer' }}
                >
                  Retry
                </button>
              </div>
            )}
            {saved && (
              <div style={{ color: '#4CAF50', marginTop: '16px', fontSize: '14px' }}>
                ✓ All {decisions.length} changes saved!
              </div>
            )}
            {!saving && !saveError && !saved && decisions.length === 0 && (
              <div style={{ color: '#4CAF50', marginTop: '16px', fontSize: '14px' }}>
                ✓ Nothing to save
              </div>
            )}
            <button 
              onClick={handleClose} 
              className="done-btn"
              disabled={saving}
              style={saving ? { opacity: 0.5, cursor: 'wait' } : {}}
            >
              {saving ? 'Saving...' : 'Done'}
            </button>
          </div>
        ) : (
          <>
            {/* Side arrows for PC */}
            <div 
              className="swipe-arrow left"
              onClick={() => handleSwipe('left')}
              style={{ 
                backgroundColor: getClusterColor('Player A'),
                border: `4px solid ${getClusterColor('Player A')}`,
                boxShadow: `0 0 0 4px rgba(0,0,0,0.3), 0 4px 20px ${getClusterColor('Player A')}66, inset 0 0 20px rgba(255,255,255,0.1)`,
                outline: `3px solid ${getClusterColor('Player A')}`,
                outlineOffset: '2px'
              }}
            >
              <span className="arrow-icon">←</span>
              <span className="arrow-label">Player A</span>
            </div>

            {/* Swipe card */}
            <div className="swipe-card-container">
              <div
                ref={cardRef}
                className={`swipe-card ${swipeDirection ? `swiping-${swipeDirection}` : ''} ${isDragging ? 'dragging' : ''}`}
                style={{
                  transform: `translateX(${dragOffset.x}px) rotate(${rotation}deg)`,
                  opacity: swipeDirection ? 0 : opacity
                }}
                onMouseDown={handleDragStart}
                onTouchStart={handleDragStart}
              >
                {/* Swipe indicators */}
                <div 
                  className="swipe-indicator left"
                  style={{ 
                    opacity: dragOffset.x < -30 ? Math.min(1, Math.abs(dragOffset.x) / 100) : 0,
                    backgroundColor: getClusterColor('Player A')
                  }}
                >
                  Player A
                </div>
                <div 
                  className="swipe-indicator right"
                  style={{ 
                    opacity: dragOffset.x > 30 ? Math.min(1, dragOffset.x / 100) : 0,
                    backgroundColor: getClusterColor('Player B')
                  }}
                >
                  Player B
                </div>

                {/* Frame image */}
                <div className="frame-image-container">
                  <img 
                    src={currentFrame.frameUrl} 
                    alt={`Frame ${currentIndex + 1}`}
                    draggable={false}
                  />
                </div>

                {/* Frame info */}
                <div className="frame-info">
                  <div className="info-row">
                    <span className="info-label">Player:</span>
                    <span className="info-value">{currentFrame.player || 'Unknown'}</span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">Time:</span>
                    <span className="info-value">{currentFrame.time?.toFixed(1) || '—'}s</span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">Confidence:</span>
                    <span className="info-value">
                      {currentFrame.confidence != null 
                        ? `${Math.round(currentFrame.confidence * 100)}%` 
                        : 'Skipped'}
                    </span>
                  </div>
                  {currentFrame.styleLabel && (
                    <div className="info-row">
                      <span className="info-label">Style:</span>
                      <span className="info-value">{currentFrame.styleLabel}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Skip button */}
              <button 
                className="skip-btn"
                onClick={handleSkip}
              >
                Skip (None)
              </button>
            </div>

            {/* Right arrow */}
            <div 
              className="swipe-arrow right"
              onClick={() => handleSwipe('right')}
              style={{ 
                backgroundColor: getClusterColor('Player B'),
                border: `4px solid ${getClusterColor('Player B')}`,
                boxShadow: `0 0 0 4px rgba(0,0,0,0.3), 0 4px 20px ${getClusterColor('Player B')}66, inset 0 0 20px rgba(255,255,255,0.1)`,
                outline: `3px solid ${getClusterColor('Player B')}`,
                outlineOffset: '2px'
              }}
            >
              <span className="arrow-icon">→</span>
              <span className="arrow-label">Player B</span>
            </div>
          </>
        )}
      </main>

      {/* Footer with keyboard hints and status */}
      <footer className="swipe-view-footer">
        <div className="keyboard-hints">
          <span>← Player A</span>
          <span>↓ or Space: Skip</span>
          <span>→ Player B</span>
          <span>Esc: Close</span>
        </div>
        {/* Show queued decisions count */}
        <div className="sync-status" style={{ marginTop: '8px', display: 'flex', justifyContent: 'center', gap: '16px' }}>
          {decisions.length > 0 && (
            <span style={{ color: '#90CAF9', fontSize: '12px' }}>
              📝 {decisions.length} queued (saves at end)
            </span>
          )}
        </div>
      </footer>
    </div>
  );
}

export default SwipeView;
