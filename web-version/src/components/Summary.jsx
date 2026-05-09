import React, { useState, useEffect, useRef, useCallback } from 'react';
import './Summary.css';
import './GameCanvas.css';
import {
  createInitialBlocks,
  updateNeighbors,
  updateCanMove,
  resetPositions
} from '../utils/gameLogic';
import { getMoveId } from '../services/localSessionStore';

function Summary({
  initialData = null,
  title = 'Game Summary',
  enableFileUpload = true,
  className = '',
  sessionGameId = null,
  onPlayerUpdate = null
}) {
  const [gameData, setGameData] = useState(initialData);
  const [currentMoveIndex, setCurrentMoveIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [blocks, setBlocks] = useState(createInitialBlocks());
  const [isPractice, setIsPractice] = useState(true);
  const [galleryImages, setGalleryImages] = useState([]);
  const [highlightedBlockId, setHighlightedBlockId] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const fileInputRef = useRef(null);
  const playbackIntervalRef = useRef(null);
  const canvasRef = useRef(null);
  const allowFileUpload = enableFileUpload && !initialData;
  const containerClassName = ['summary-container', className].filter(Boolean).join(' ');

  const relativeToPixel = (relative, dimension) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const height = canvas.offsetHeight;
    return (relative + 0.5) * height;
  };

  const applyMovesUpTo = useCallback((targetIndex, sourceData = null) => {
    const data = sourceData || gameData;
    if (!data) return;

    // Start from initial state
    let currentBlocks = createInitialBlocks();
    let currentIsPractice = true;
    const currentGalleryImages = [];
    let lastMovedBlock = null;

    // Apply all moves up to targetIndex
    for (let i = 0; i <= targetIndex && i < data.moves.length; i++) {
      const move = data.moves[i];

      // Update phase if needed
      if (move.phase === 'experiment' && currentIsPractice) {
        currentIsPractice = false;
        // Reset blocks when switching to experiment phase
        currentBlocks = createInitialBlocks();
      }

      // Apply the move - prefer grid positions (properly snapped) over all_positions
      // GRID_UNIT = 0.035 (grid integer coordinates * 0.035 = relative coordinates)
      // Priority: allPositions > grid_all_positions > all_positions
      const gridPositions = move.allPositions || move.grid_all_positions;
      const positionsToUse = gridPositions
        ? gridPositions.map(gridPos => [gridPos[0] * 0.035, gridPos[1] * 0.035])
        : move.all_positions;

      if (move.type === 'moveblock' && positionsToUse) {
        // Ensure we have exactly 10 blocks and positions match
        if (positionsToUse.length === 10 && currentBlocks.length === 10) {
          currentBlocks = currentBlocks.map((block, idx) => {
            const newPos = positionsToUse[idx];
            // Ensure position is valid array with 2 elements
            if (newPos && Array.isArray(newPos) && newPos.length === 2) {
              return {
                ...block,
                position: [newPos[0], newPos[1]]
              };
            }
            return block;
          });
        } else {
          // Fallback: try to match by index if counts don't match
          console.warn(`Position count mismatch: blocks=${currentBlocks.length}, positions=${positionsToUse?.length}`);
        }
        currentBlocks = updateCanMove(updateNeighbors(currentBlocks), currentIsPractice);
        // Track the last moved block for highlighting
        lastMovedBlock = move.blockId !== undefined ? move.blockId : move.unit;
      } else if (move.type === 'added shape to gallery' && move.gallery_normalized) {
        // Add to gallery
        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 400;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, 400, 400);

        move.gallery_normalized.forEach(pos => {
          const x = (pos[0] + 0.5) * 400;
          const y = (pos[1] + 0.5) * 400;
          ctx.fillStyle = 'green';
          // Smaller block size with more gaps (28px for 400px canvas)
          const blockSize = 28;
          ctx.fillRect(x - blockSize / 2, y - blockSize / 2, blockSize, blockSize);
        });

        currentGalleryImages.push({
          number: move.gallery_shape_number,
          image: canvas.toDataURL()
        });
        lastMovedBlock = null; // Reset highlight for gallery saves
      }
    }

    // Update state
    setBlocks(currentBlocks);
    setIsPractice(currentIsPractice);
    setGalleryImages(currentGalleryImages);
    setHighlightedBlockId(lastMovedBlock);
  }, [gameData]);

  const loadGameData = (data) => {
    setGameData(data);
    setCurrentMoveIndex(0);
    setIsPlaying(false);
    // Apply initial state (no moves applied yet)
    setTimeout(() => {
      applyMovesUpTo(0, data);
    }, 0);
  };

  const resetToInitialState = () => {
    setBlocks(createInitialBlocks());
    setIsPractice(true);
    setGalleryImages([]);
    setHighlightedBlockId(null);
  };

  const handleFileUpload = (e) => {
    if (!allowFileUpload) return;
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        loadGameData(data);
      } catch (error) {
        alert('Failed to parse JSON file: ' + error.message);
      }
    };
    reader.readAsText(file);
  };

  useEffect(() => {
    if (initialData) {
      loadGameData(initialData);
    }
  }, [initialData]);

  // Apply current move when gameData or currentMoveIndex changes
  useEffect(() => {
    if (gameData && currentMoveIndex >= 0) {
      applyMovesUpTo(currentMoveIndex);
    }
  }, [gameData, currentMoveIndex, applyMovesUpTo]);

  // Handle window resize to recalculate block positions
  useEffect(() => {
    const handleResize = () => {
      // Force re-render of blocks when window resizes
      if (gameData && currentMoveIndex >= 0) {
        // Small delay to ensure canvas has resized
        setTimeout(() => {
          applyMovesUpTo(currentMoveIndex);
        }, 100);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [gameData, currentMoveIndex, applyMovesUpTo]);

  const goToMove = (index) => {
    if (!gameData) return;
    if (index < 0 || index >= gameData.moves.length) return;

    applyMovesUpTo(index);
    setCurrentMoveIndex(index);
  };

  const startPlayback = () => {
    if (!gameData || isPlaying) return;

    setIsPlaying(true);
    setCurrentMoveIndex(0);
    applyMovesUpTo(0);

    let moveIndex = 0;
    playbackIntervalRef.current = setInterval(() => {
      if (moveIndex >= gameData.moves.length) {
        stopPlayback();
        return;
      }

      moveIndex++;
      applyMovesUpTo(moveIndex);
      setCurrentMoveIndex(moveIndex);
    }, 1000 / playbackSpeed);
  };

  const stopPlayback = () => {
    if (playbackIntervalRef.current) {
      clearInterval(playbackIntervalRef.current);
      playbackIntervalRef.current = null;
    }
    setIsPlaying(false);
  };

  useEffect(() => {
    return () => {
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isPlaying && playbackIntervalRef.current) {
      clearInterval(playbackIntervalRef.current);
      playbackIntervalRef.current = null;
      // Restart playback with new speed
      const currentIndex = currentMoveIndex;
      setCurrentMoveIndex(0);
      setIsPlaying(false);
      setTimeout(() => {
        setCurrentMoveIndex(currentIndex);
        startPlayback();
      }, 0);
    }
  }, [playbackSpeed]);

  if (!gameData) {
    if (allowFileUpload) {
      return (
        <div className={containerClassName}>
          <div className="summary-upload">
            <h1>{title}</h1>
            <p>Load a game session JSON file to view the replay</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
            <button onClick={() => fileInputRef.current?.click()}>
              Load JSON File
            </button>
          </div>
        </div>
      );
    }
    return null;
  }

  const currentMove = gameData.moves[currentMoveIndex];
  const totalMoves = gameData.moves.length;
  const movesByPlayer = gameData.summary?.movesByPlayer || {};

  const movesByPlayerEntries = Object.entries(movesByPlayer || {});
  const formatNumber = (value, decimals = 1) => {
    if (Number.isFinite(value)) {
      return value.toFixed(decimals);
    }
    return '—';
  };


  const sessionInfoData = gameData.sessionInfo || {};
  const participantId =
    sessionInfoData.subjectId ||
    sessionInfoData.id ||
    gameData.subjectId ||
    gameData.id ||
    null;
  const sessionId =
    sessionInfoData.sessionGameId ||
    gameData.sessionGameId ||
    participantId ||
    null;
  const condition =
    sessionInfoData.condition ||
    gameData.condition ||
    null;
  const startTimeValue =
    gameData.startTime ||
    sessionInfoData.startedAt ||
    sessionInfoData.date ||
    null;
  const endTimeValue =
    gameData.endTime ||
    sessionInfoData.endedAt ||
    null;

  const formatDateTime = (value) => {
    if (!value) return null;
    try {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        return date.toLocaleString();
      }
    } catch (error) {
      // ignore parse errors
    }
    return value;
  };

  const headerItems = [];
  if (sessionId) {
    headerItems.push({ label: 'Session ID', value: sessionId });
  }
  if (participantId && participantId !== sessionId) {
    headerItems.push({ label: 'Participant', value: participantId });
  }
  if (condition) {
    headerItems.push({ label: 'Condition', value: condition });
  }
  const formattedStart = formatDateTime(startTimeValue);
  if (formattedStart) {
    headerItems.push({ label: 'Start', value: formattedStart });
  }
  const formattedEnd = formatDateTime(endTimeValue);
  if (formattedEnd) {
    headerItems.push({ label: 'End', value: formattedEnd });
  }

  return (
    <div className={containerClassName}>
      <div className="summary-header">
        <h1>{title}</h1>
        {headerItems.length > 0 && (
          <div className="summary-session-info">
            {headerItems.map((item) => (
              <div key={`${item.label}-${item.value}`} className="summary-session-info-item">
                <span className="summary-session-info-label">{item.label}</span>
                <span className="summary-session-info-value">{item.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="summary-main">
        <div className="summary-left">
          <div className="summary-game-area">
            <div className="summary-grid-toggle">
              <label>
                <input
                  type="checkbox"
                  checked={showGrid}
                  onChange={(e) => setShowGrid(e.target.checked)}
                />
                Show Grid
              </label>
            </div>
            <div
              className="game-canvas"
              ref={canvasRef}
            >
              {/* Grid Overlay */}
              {showGrid && (() => {
                // GRID_UNIT = 0.035 (half of GRID_STEP 0.07)
                // Grid coordinates in JSON are integers: relative = gridCoord * 0.035
                // Grid range is approximately -14 to +14
                const GRID_UNIT = 0.035;
                const gridRange = [];
                for (let i = -14; i <= 14; i += 2) {
                  gridRange.push(i);
                }

                return (
                  <div className="grid-overlay">
                    {/* Horizontal lines and Y-axis labels */}
                    {gridRange.map(gridY => {
                      const relY = gridY * GRID_UNIT;
                      const topPercent = (relY + 0.5) * 100;
                      return (
                        <React.Fragment key={`h-${gridY}`}>
                          <div
                            className="grid-line grid-line-h"
                            style={{ top: `${topPercent}%` }}
                          />
                          <div
                            className="grid-label grid-label-left"
                            style={{ top: `${topPercent}%` }}
                          >
                            {gridY}
                          </div>
                        </React.Fragment>
                      );
                    })}
                    {/* Vertical lines and X-axis labels */}
                    {gridRange.map(gridX => {
                      const relX = gridX * GRID_UNIT;
                      const leftPercent = (relX + 0.5) * 100;
                      return (
                        <React.Fragment key={`v-${gridX}`}>
                          <div
                            className="grid-line grid-line-v"
                            style={{ left: `${leftPercent}%` }}
                          />
                          <div
                            className="grid-label grid-label-top"
                            style={{ left: `${leftPercent}%` }}
                          >
                            {gridX}
                          </div>
                        </React.Fragment>
                      );
                    })}
                  </div>
                );
              })()}


              {/* Gallery */}
              <div className="gallery">
                <div className="gallery-frame">
                  {galleryImages.length > 0 ? (
                    <img
                      src={galleryImages[galleryImages.length - 1].image}
                      alt="Gallery"
                      className="gallery-image"
                    />
                  ) : (
                    <div className="gallery-placeholder">Gallery</div>
                  )}
                </div>
              </div>

              {/* Blocks */}
              {blocks.map((block, idx) => {
                // Ensure position is valid
                const pos = block.position || [0, 0];
                if (!Array.isArray(pos) || pos.length !== 2 || !Number.isFinite(pos[0]) || !Number.isFinite(pos[1])) {
                  console.warn(`Invalid position for block ${block.id}:`, pos);
                  return null;
                }

                return (
                  <div
                    key={block.id}
                    className={`block ${block.canMove ? 'movable' : ''} ${block.id === highlightedBlockId ? 'highlighted' : ''}`}
                    style={{
                      left: `${relativeToPixel(pos[0], 'x')}px`,
                      top: `${relativeToPixel(pos[1], 'y')}px`,
                      backgroundColor: block.color || 'green',
                      cursor: block.canMove ? 'grab' : 'default',
                      zIndex: block.id === highlightedBlockId ? 20 : idx + 1
                    }}
                  >
                    {showGrid && (
                      <span className="block-id-label">{block.id}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="summary-progress">
            <input
              type="range"
              min="0"
              max={Math.max(0, totalMoves - 1)}
              value={currentMoveIndex}
              onChange={(e) => goToMove(parseInt(e.target.value))}
              style={{ width: '100%' }}
            />
            <div className="progress-info">
              Move {currentMoveIndex + 1} of {totalMoves}
              {currentMove && (
                <span className="move-info">
                  {' '}• Player: {currentMove.player}
                  {Array.isArray(currentMove.position) && currentMove.position.length === 2 && ` • Position: (${currentMove.position[0]}, ${currentMove.position[1]})`}
                  {Number.isFinite(currentMove.holdTime) && ` • Hold: ${formatNumber(currentMove.holdTime, 2)}s`}
                  {' '}• Time: {formatNumber(currentMove.elapsed, 1)}s
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="summary-right">
          <div className="summary-stats">
            <div className="summary-stats-row">
              <span className="summary-stats-label">Duration</span>
              <span className="summary-stats-value">
                {Math.floor(gameData.duration / 60)}:{(gameData.duration % 60).toFixed(0).padStart(2, '0')}
              </span>
            </div>
            <div className="summary-stats-row">
              <span className="summary-stats-label">Total Moves</span>
              <span className="summary-stats-value">{totalMoves}</span>
            </div>
            <div className="summary-stats-row summary-stats-column">
              <span className="summary-stats-label">Moves by Player</span>
              <div className="summary-stats-value">
                {movesByPlayerEntries.length === 0 ? (
                  <span>—</span>
                ) : (
                  movesByPlayerEntries.map(([player, count]) => (
                    <div key={player}>{player}: {count}</div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="summary-controls">
            <button onClick={() => goToMove(0)} disabled={currentMoveIndex === 0}>
              ⏮ First
            </button>
            <button onClick={() => goToMove(currentMoveIndex - 1)} disabled={currentMoveIndex === 0}>
              ⏪ Previous
            </button>
            <button onClick={isPlaying ? stopPlayback : startPlayback}>
              {isPlaying ? '⏸ Pause' : '▶ Play'}
            </button>
            <button onClick={() => goToMove(currentMoveIndex + 1)} disabled={currentMoveIndex >= totalMoves - 1}>
              ⏩ Next
            </button>
            <button onClick={() => goToMove(totalMoves - 1)} disabled={currentMoveIndex >= totalMoves - 1}>
              ⏭ Last
            </button>
            <div className="speed-control">
              <label>Speed:</label>
              <input
                type="range"
                min="0.5"
                max="5"
                step="0.5"
                value={playbackSpeed}
                onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
              />
              <span>{playbackSpeed}x</span>
            </div>
            {allowFileUpload && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleFileUpload}
                  style={{ display: 'none' }}
                />
                <button onClick={() => fileInputRef.current?.click()}>
                  📁 Load New File
                </button>
              </>
            )}
          </div>

          <div className="summary-moves-list">
            <div className="move-list-header">
              <h2>Move History</h2>
              {onPlayerUpdate && (
                <button
                  className={`edit-mode-toggle ${editMode ? 'active' : ''}`}
                  onClick={() => setEditMode(!editMode)}
                >
                  {editMode ? '✓ Done' : 'Quick Edit Players'}
                </button>
              )}
            </div>
            <div className="moves-scroll">
              {gameData.moves.map((move, index) => (
                <div
                  key={index}
                  className={`move-item ${index === currentMoveIndex ? 'active' : ''} ${editMode ? 'edit-mode' : ''}`}
                  onClick={() => !editMode && goToMove(index)}
                >
                  <div className="move-number">{index + 1}</div>
                  {move.camera_frame && (
                    <div className="move-camera-frame">
                      <img
                        src={move.camera_frame}
                        alt={`Camera frame for move ${index + 1}`}
                        className="camera-frame-thumbnail"
                      />
                    </div>
                  )}
                  <div className="move-details">
                    <div className="move-type">{move.type}</div>
                    {editMode && onPlayerUpdate ? (
                      <div className="move-player-edit">
                        <label>Player:</label>
                        <select
                          value={move.player || 'Unknown'}
                          onChange={(e) => {
                            const newPlayer = e.target.value;
                            onPlayerUpdate(getMoveId(move), newPlayer);
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <option value="Player A">Player A</option>
                          <option value="Player B">Player B</option>
                          <option value="None">None</option>
                          <option value="Unknown">Unknown</option>
                        </select>
                      </div>
                    ) : (
                      <div className="move-player">Player: {move.player}</div>
                    )}
                    {(move.blockId !== null && move.blockId !== undefined) || (move.unit !== null && move.unit !== undefined) ? (
                      <div className="move-unit">Block: {move.blockId !== undefined ? move.blockId : move.unit}</div>
                    ) : null}
                    {Array.isArray(move.position) && move.position.length === 2 && (
                      <div className="move-position">Position: ({move.position[0]}, {move.position[1]})</div>
                    )}
                    {Number.isFinite(move.holdTime) && move.holdTime > 0 && (
                      <div className="move-hold-time">Hold Time: {formatNumber(move.holdTime, 2)}s</div>
                    )}
                    <div className="move-time">Time: {formatNumber(move.elapsed, 1)}s</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Summary;

