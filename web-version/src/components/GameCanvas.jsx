import React, { useState, useEffect, useRef, useCallback } from 'react';
import './GameCanvas.css';
import CSVLogger from '../utils/csvLogger';
import { getGameTracker } from '../utils/gameTracker';
import {
  createInitialBlocks,
  getAllowedPositions,
  snapToAllowed,
  updateNeighbors,
  updateCanMove,
  resetPositions
} from '../utils/gameLogic';
import { t } from '../locales';
import { ADMIN_FOCUS_SESSION_GAME_ID_KEY } from '../constants/adminNavigation';

const BLOCK_SIZE_PX = 60; // pixels
const GRID_STEP = 0.07;
const SAVE_CAMERA_FRAMES = true; // Set to true to save camera frame images (base64) in logs
const DEFAULT_BOTTOM_PADDING = 120;

function GameCanvas({ config, interfaceHidden = false }) {
  const [blocks, setBlocks] = useState(createInitialBlocks());
  const [draggedBlock, setDraggedBlock] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isPractice, setIsPractice] = useState(true);
  const [timeRemaining, setTimeRemaining] = useState(config.timeSeconds);
  const [galleryNumber, setGalleryNumber] = useState(0);
  const [galleryImage, setGalleryImage] = useState(null);
  const [showMessage, setShowMessage] = useState(true);
  const [messageText, setMessageText] = useState('');
  const [gameEnded, setGameEnded] = useState(false);
  const [showPostExperimentChoice, setShowPostExperimentChoice] = useState(false);
  const [canvasVars, setCanvasVars] = useState({
    blockSize: BLOCK_SIZE_PX,
    bottomPadding: DEFAULT_BOTTOM_PADDING
  });

  const canvasRef = useRef(null);
  const loggerRef = useRef(new CSVLogger(config));
  const gameTrackerRef = useRef(getGameTracker());
  const blockPickupTimeRef = useRef(null); // Track when block was picked up
  const startTimeRef = useRef(Date.now());
  const bottomPaddingRef = useRef(DEFAULT_BOTTOM_PADDING);

  const welcomeMessage = t('game.welcomeMessage', {
    minutes: config.timeSeconds / 60
  });

  const practiceDoneMessage = t('game.practiceDoneMessage');

  const byeMessage = t('game.byeMessage');

  const updateCanvasMetrics = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const width = canvas.offsetWidth;
    const height = canvas.offsetHeight;

    if (!width || !height) {
      return;
    }

    const currentPadding = bottomPaddingRef.current || DEFAULT_BOTTOM_PADDING;

    let playArea = Math.max(1, Math.min(width, height - currentPadding));
    let blockSizeEstimate = Math.max(38, Math.min(playArea * GRID_STEP * 0.95, playArea / 4));
    let bottomPadding = Math.max(blockSizeEstimate * 2.5, 110);

    // Recalculate once more using the refined padding value for better accuracy
    playArea = Math.max(1, Math.min(width, height - bottomPadding));
    blockSizeEstimate = Math.max(38, Math.min(playArea * GRID_STEP * 0.95, playArea / 4));
    bottomPadding = Math.max(blockSizeEstimate * 2.5, 110);

    bottomPaddingRef.current = bottomPadding;

    setCanvasVars(prev => {
      const blockDiff = Math.abs(prev.blockSize - blockSizeEstimate);
      const paddingDiff = Math.abs(prev.bottomPadding - bottomPadding);

      if (blockDiff < 0.5 && paddingDiff < 0.5) {
        return prev;
      }

      return {
        blockSize: blockSizeEstimate,
        bottomPadding
      };
    });
  }, []);

  useEffect(() => {
    setMessageText(welcomeMessage);

    // Start game tracker when component mounts
    const initializeTracker = async () => {
      try {
        gameTrackerRef.current.start();
        await gameTrackerRef.current.setSessionInfo({
          id: config.id,
          sessionGameId: config.sessionGameId,
          condition: config.condition,
          timeSeconds: config.timeSeconds,
          date: config.date
        });
        console.log('[GameCanvas] Game tracker started');
      } catch (error) {
        console.error('[GameCanvas] Failed to initialize tracker:', error);
        // Show error and redirect back to start
        setTimeout(() => {
          alert('Failed to start session. Please try again with a different Session ID.');
          window.location.reload();
        }, 100);
      }
    };

    initializeTracker();

    // Expose function to end game from outside (e.g., secEnd())
    window.endGameExperience = () => {
      setShowMessage(true);
      setMessageText(byeMessage);
      setGameEnded(true);
      gameTrackerRef.current.stop();
      console.log('[GameCanvas] Game ended via endGameExperience(). All data saved to server.');
    };

    return () => {
      if (window.endGameExperience) {
        delete window.endGameExperience;
      }
      // Stop tracker on unmount
      gameTrackerRef.current.stop();
    };
  }, []);

  useEffect(() => {
    updateCanvasMetrics();
  }, [updateCanvasMetrics, interfaceHidden]);

  useEffect(() => {
    const handleResize = () => {
      updateCanvasMetrics();
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [updateCanvasMetrics]);

  // Timer
  useEffect(() => {
    if (!isPractice && timeRemaining > 0) {
      const timer = setInterval(() => {
        setTimeRemaining(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            setShowMessage(true);
            setMessageText(byeMessage);
            setGameEnded(true);
            // Game ended - data already on server via real-time move tracking
            console.log('[GameCanvas] Game ended by timer. All data saved to server.');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(timer);
    }
  }, [isPractice, timeRemaining]);

  // Update blocks' canMove status
  useEffect(() => {
    setBlocks(prevBlocks => updateCanMove(updateNeighbors(prevBlocks), isPractice));
  }, [isPractice]);

  const getElapsedTime = () => {
    return (Date.now() - startTimeRef.current) / 1000;
  };

  const pixelToRelative = (px, dimension) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    // Use the smaller dimension to maintain square coordinate system
    // Account for bottom padding (120px) when calculating y coordinates
    const availableHeight = canvas.offsetHeight - bottomPaddingRef.current; // Subtract bottom margin
    const size = Math.min(canvas.offsetWidth, availableHeight);
    // Center the coordinate system
    const offset = dimension === 'x'
      ? (canvas.offsetWidth - size) / 2
      : (canvas.offsetHeight - bottomPaddingRef.current - size) / 2; // Account for bottom margin
    return ((px - offset) / size) - 0.5;
  };

  const relativeToPixel = (relative, dimension) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    // Use the smaller dimension to maintain square coordinate system
    // Account for bottom padding (120px) when calculating y coordinates
    const availableHeight = canvas.offsetHeight - bottomPaddingRef.current; // Subtract bottom margin
    const size = Math.min(canvas.offsetWidth, availableHeight);
    // Center the coordinate system
    const offset = dimension === 'x'
      ? (canvas.offsetWidth - size) / 2
      : (canvas.offsetHeight - bottomPaddingRef.current - size) / 2; // Account for bottom margin
    return ((relative + 0.5) * size) + offset;
  };

  const getPointerPosition = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    // Support both mouse and touch events
    const clientX = e.clientX !== undefined ? e.clientX : e.touches?.[0]?.clientX;
    const clientY = e.clientY !== undefined ? e.clientY : e.touches?.[0]?.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  };

  const handleMouseDown = (e, blockId) => {
    const block = blocks.find(b => b.id === blockId);
    if (!block || !block.canMove) return;

    e.preventDefault(); // Prevent text selection and scrolling on mobile
    const pos = getPointerPosition(e);
    const blockX = relativeToPixel(block.position[0], 'x');
    const blockY = relativeToPixel(block.position[1], 'y');

    // Record when block was picked up for hold time calculation
    blockPickupTimeRef.current = Date.now();

    setDraggedBlock(blockId);
    setDragOffset({
      x: pos.x - blockX,
      y: pos.y - blockY
    });
  };

  const handleMouseMove = (e) => {
    if (draggedBlock === null) return;

    e.preventDefault(); // Prevent scrolling while dragging on mobile
    const pos = getPointerPosition(e);

    const relX = pixelToRelative(pos.x - dragOffset.x, 'x');
    const relY = pixelToRelative(pos.y - dragOffset.y, 'y');

    setBlocks(prevBlocks =>
      prevBlocks.map(block =>
        block.id === draggedBlock
          ? { ...block, position: [relX, relY] }
          : block
      )
    );
  };

  // Capture camera frame with reduced quality (RAW VIDEO - no overlays)
  const captureCameraFrame = () => {
    // Skip capturing if disabled
    if (!SAVE_CAMERA_FRAMES) {
      return null;
    }

    try {
      // ALWAYS use raw video element (no overlays, no MediaPipe drawings)
      const detectorVideo = window.braceletDetectorVideo;

      if (!detectorVideo || !detectorVideo.videoWidth || detectorVideo.videoWidth === 0) {
        console.warn('[GameCanvas] No raw video source available for frame capture');
        return null;
      }

      // Create a temporary canvas for resizing and quality reduction
      const tempCanvas = document.createElement('canvas');
      const maxWidth = 640; // Reduce resolution to save space
      const maxHeight = 480;

      let width = detectorVideo.videoWidth;
      let height = detectorVideo.videoHeight;

      // Calculate scaled dimensions maintaining aspect ratio
      const aspectRatio = width / height;
      if (width > maxWidth) {
        width = maxWidth;
        height = width / aspectRatio;
      }
      if (height > maxHeight) {
        height = maxHeight;
        width = height * aspectRatio;
      }

      tempCanvas.width = Math.floor(width);
      tempCanvas.height = Math.floor(height);
      const tempCtx = tempCanvas.getContext('2d');

      // Draw RAW video to temp canvas (scaled down, NO overlays)
      tempCtx.drawImage(detectorVideo, 0, 0, tempCanvas.width, tempCanvas.height);

      // Convert to JPEG with reduced quality (0.6 = 60% quality)
      return tempCanvas.toDataURL('image/jpeg', 0.6);
    } catch (error) {
      console.error('[GameCanvas] Error capturing camera frame:', error);
      return null;
    }
  };

  const handleMouseUp = () => {
    if (draggedBlock === null) return;

    const block = blocks.find(b => b.id === draggedBlock);
    const allowedPos = getAllowedPositions(blocks, draggedBlock);
    const snappedPos = snapToAllowed(allowedPos, block.position);

    // Calculate hold time
    const holdTime = blockPickupTimeRef.current
      ? (Date.now() - blockPickupTimeRef.current) / 1000
      : 0;

    // Create updated blocks array with the snapped position
    const updatedBlocks = blocks.map(b =>
      b.id === draggedBlock
        ? { ...b, position: snappedPos }
        : b
    );

    // Capture camera frame for this move
    const cameraFrame = captureCameraFrame();
    const currentPlayer = window.currentBraceletStatus || 'Unknown';

    // Log the move to CSV with the final snapped position and updated all_positions
    const logEntry = {
      date: config.date,
      id: config.id,
      sessionGameId: config.sessionGameId,
      condition: config.condition,
      phase: isPractice ? 'practice' : 'experiment',
      type: 'moveblock',
      time: getElapsedTime(),
      unit: draggedBlock,
      end_position: snappedPos, // Final snapped position
      all_positions: updatedBlocks.map(b => b.position), // All positions after snap
      gallery_shape_number: null,
      gallery: null,
      gallery_normalized: null,
      camera_frame: cameraFrame, // Add camera frame image
      player: currentPlayer // Add current player
    };
    loggerRef.current.write(logEntry);

    // Also log to game tracker with player attribution and camera frame
    gameTrackerRef.current.recordMove(logEntry, holdTime, cameraFrame);

    setBlocks(prevBlocks => {
      const updated = prevBlocks.map(b =>
        b.id === draggedBlock
          ? { ...b, position: snappedPos }
          : b
      );
      return updateCanMove(updateNeighbors(updated), isPractice);
    });

    setDraggedBlock(null);
    blockPickupTimeRef.current = null;
  };

  const handleGalleryClick = () => {
    const positions = blocks.map(b => b.position);
    const normalizedPos = resetPositions(positions);
    const newGalleryNum = galleryNumber + 1;

    // Capture camera frame for this gallery save
    const cameraFrame = captureCameraFrame();
    const currentPlayer = window.currentBraceletStatus || 'Unknown';

    // Log to CSV
    const logEntry = {
      date: config.date,
      id: config.id,
      sessionGameId: config.sessionGameId,
      condition: config.condition,
      phase: isPractice ? 'practice' : 'experiment',
      type: 'added shape to gallery',
      time: getElapsedTime(),
      unit: null,
      end_position: null,
      all_positions: null,
      gallery_shape_number: newGalleryNum,
      gallery: positions,
      gallery_normalized: normalizedPos,
      camera_frame: cameraFrame, // Add camera frame image
      player: currentPlayer // Add current player
    };
    loggerRef.current.write(logEntry);

    // Also log to game tracker with camera frame
    gameTrackerRef.current.recordMove(logEntry, 0, cameraFrame);

    // Create canvas screenshot
    const screenshot = captureCanvas();
    setGalleryImage(screenshot);
    setGalleryNumber(newGalleryNum);
  };

  const captureCanvas = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 400;
    const ctx = canvas.getContext('2d');

    // Black background
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 400, 400);

    // Draw blocks centered
    const positions = blocks.map(b => b.position);
    const normalizedPos = resetPositions(positions);

    if (normalizedPos) {
      normalizedPos.forEach(pos => {
        const x = (pos[0] + 0.5) * 400;
        const y = (pos[1] + 0.5) * 400;
        ctx.fillStyle = 'green';
        ctx.fillRect(x - 15, y - 15, 30, 30);
      });
    }

    return canvas.toDataURL();
  };

  const handleKeyPress = useCallback((e) => {
    if (e.key === 'p' && isPractice) {
      setIsPractice(false);
      setShowMessage(true);
      setMessageText(practiceDoneMessage);
      startTimeRef.current = Date.now();

      // Reset blocks
      setBlocks(createInitialBlocks());
      setGalleryImage(null);
      setGalleryNumber(0);

      // Clear all collected data from practice and start fresh
      loggerRef.current = new CSVLogger(config);

      // Restart game tracker for real game
      gameTrackerRef.current.stop();
      gameTrackerRef.current = getGameTracker();
      gameTrackerRef.current.start();
      gameTrackerRef.current.setSessionInfo({
        id: config.id,
        sessionGameId: config.sessionGameId,
        condition: config.condition,
        timeSeconds: config.timeSeconds,
        date: config.date
      });
      console.log('[GameCanvas] Game tracker restarted for real game');
    } else if (e.key === 'q' && !isPractice) {
      setShowMessage(true);
      setMessageText(byeMessage);
      setGameEnded(true);
      // Game ended manually - data already on server via real-time move tracking
      console.log('[GameCanvas] Game ended manually (q key). All data saved to server.');
    }
  }, [isPractice, config.id]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [handleKeyPress]);

  const closeMessage = () => {
    // Handle game end (bye message) - show next-step choice (Admin vs new session)
    if (gameEnded && messageText === byeMessage) {
      console.log('[GameCanvas] Game ended - showing post-experiment choice');
      if (window.toggleInterface) {
        window.toggleInterface(false);
      }
      setShowMessage(false);
      setShowPostExperimentChoice(true);
      return;
    }

    // Play sound if transitioning from practice to real game
    if (!isPractice && messageText === practiceDoneMessage) {
      // Create a simple beep sound using Web Audio API
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        // Create a pleasant "start" sound: two tones
        oscillator.frequency.setValueAtTime(800, audioContext.currentTime); // First tone (high)
        oscillator.frequency.setValueAtTime(600, audioContext.currentTime + 0.15); // Second tone (lower)

        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.3);

        console.log('[GameCanvas] Playing start sound - Real experiment begins!');
      } catch (e) {
        console.error('[GameCanvas] Error playing sound:', e);
      }
    }

    setShowMessage(false);
  };

  const handleContextMenu = (e) => {
    e.preventDefault(); // Disable right-click context menu
  };

  const handlePostExperimentStartNew = () => {
    window.location.hash = '#/';
    window.location.reload();
  };

  const handlePostExperimentGoToAdmin = () => {
    try {
      if (config?.sessionGameId != null && config.sessionGameId !== '') {
        sessionStorage.setItem(ADMIN_FOCUS_SESSION_GAME_ID_KEY, String(config.sessionGameId));
      }
    } catch (e) {
      console.warn('[GameCanvas] Could not stash session for Admin:', e);
    }
    window.location.hash = '#/admin';
  };

  return (
    <div
      className="game-canvas"
      ref={canvasRef}
      style={{
        '--block-size': `${canvasVars.blockSize}px`,
        '--bottom-padding': `${canvasVars.bottomPadding}px`
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onTouchMove={handleMouseMove}
      onTouchEnd={handleMouseUp}
      onTouchCancel={handleMouseUp}
      onContextMenu={handleContextMenu}
    >
      {/* Gallery */}
      <div
        className="gallery"
        onClick={handleGalleryClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleGalleryClick();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label={t('game.galleryLabel')}
      >
        <div className="gallery-frame">
          {galleryImage ? (
            <img src={galleryImage} alt={t('game.galleryAlt')} className="gallery-image" />
          ) : (
            <div className="gallery-placeholder">{t('game.galleryPlaceholder')}</div>
          )}
        </div>
      </div>

      {/* Timer (only show in experiment phase and when interface is not hidden) */}
      {!isPractice && !interfaceHidden && (
        <div
          className="timer"
          role="timer"
          aria-live="polite"
          aria-atomic="true"
          aria-label={t('game.timerPrefix')}
        >
          {t('game.timerPrefix')}{' '}
          {Math.floor(timeRemaining / 60)}:{(timeRemaining % 60).toString().padStart(2, '0')}
        </div>
      )}

      {/* Blocks */}
      {blocks.map(block => (
        <div
          key={block.id}
          className={`block ${block.canMove ? 'movable' : ''}`}
          style={{
            left: `${relativeToPixel(block.position[0], 'x')}px`,
            top: `${relativeToPixel(block.position[1], 'y')}px`,
            backgroundColor: block.color || 'green',
            cursor: block.canMove ? 'grab' : 'default'
          }}
          onMouseDown={(e) => handleMouseDown(e, block.id)}
          onTouchStart={(e) => handleMouseDown(e, block.id)}
          aria-label={t('game.blockLabel', {
            id: block.id,
            movable: block.canMove ? t('game.movableSuffix') : ''
          })}
        />
      ))}

      {/* Message overlay */}
      {showMessage && (
        <div className="message-overlay" onClick={closeMessage}>
          <div className="message-box" role="dialog" aria-modal="true" aria-live="polite">
            {messageText}
            <div className="message-hint">{t('game.messageHint')}</div>
          </div>
        </div>
      )}

      {showPostExperimentChoice && (
        <div
          className="message-overlay post-experiment-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="post-exp-title"
        >
          <div
            className="message-box post-experiment-box"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="post-exp-title" className="post-experiment-title">
              {t('game.postExperimentTitle')}
            </h2>
            <div className="post-experiment-actions">
              <button
                type="button"
                className="post-experiment-btn post-experiment-btn-primary"
                onClick={handlePostExperimentStartNew}
              >
                {t('game.startNewExperiment')}
              </button>
              <button
                type="button"
                className="post-experiment-btn post-experiment-btn-secondary"
                onClick={handlePostExperimentGoToAdmin}
              >
                {t('game.goToAdminEditPlayers')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default GameCanvas;
