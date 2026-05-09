import React, { useState, useEffect, useCallback, useRef } from 'react';
import './MoveHistoryEditor.css';
import {
  getActiveDataRoot,
  restoreDataRootFromStorage,
  getSessionByGameId,
  updateMovePlayer,
  updateMovePlayersBatch,
  getMoveId
} from '../services/localSessionStore';
import { identifyPlayerByColor, identifyPlayerBySegmentation, identifyPlayersByCloth } from '../utils/colorDetector';
import { identifyPlayersByAllAll } from '../utils/colorDetectorGeneral';
import { swapPlayersAB } from '../utils/swapPlayers';
import ColorPreviewModal from './ColorPreviewModal';
import ManualScanSelector from './ManualScanSelector';
import SwipeView from './SwipeView';
import ConfirmSwapModal from './ConfirmSwapModal';

const formatNumber = (value, decimals = 2) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '—';
  }
  return value.toFixed(decimals);
};

// Convert hex color to rgba for outline opacity
const hexToRgba = (hex, alpha) => {
  if (!hex || !hex.startsWith('#')) return `rgba(0, 0, 0, ${alpha})`;
  let cleanHex = hex.slice(1);
  // Handle 3-character hex codes
  if (cleanHex.length === 3) {
    cleanHex = cleanHex.split('').map(c => c + c).join('');
  }
  if (cleanHex.length !== 6) return `rgba(0, 0, 0, ${alpha})`;
  const r = parseInt(cleanHex.slice(0, 2), 16);
  const g = parseInt(cleanHex.slice(2, 4), 16);
  const b = parseInt(cleanHex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

function MoveHistoryEditor({ sessionGameId }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedMove, setSelectedMove] = useState(null);
  const [expandedImage, setExpandedImage] = useState(null);
  const [filterPhase, setFilterPhase] = useState('all');
  const [filterPlayer, setFilterPlayer] = useState('all');
  const [dataRoot, setDataRoot] = useState(() => getActiveDataRoot());

  const [colorA, setColorA] = useState('#FF0000'); // Default red
  const [colorB, setColorB] = useState('#0000FF'); // Default blue
  const [colorProcessing, setColorProcessing] = useState(false);
  const [colorSuggestions, setColorSuggestions] = useState({});
  const [colorProgress, setColorProgress] = useState({ current: 0, total: 0 });
  const [colorAnchor, setColorAnchor] = useState('bottom');
  const [colorScanPercentage, setColorScanPercentage] = useState(100);
  const [colorPreview, setColorPreview] = useState(null);
  const [manualScanBounds, setManualScanBounds] = useState(null); // { topY: number, bottomY: number }
  const [showManualSelector, setShowManualSelector] = useState(false);
  const [manualSelectorFrame, setManualSelectorFrame] = useState(null);
  const [clothProcessing, setClothProcessing] = useState(false);
  const [clothAnalytics, setClothAnalytics] = useState(null);
  const [clothDebugPreviews, setClothDebugPreviews] = useState({}); // { moveId: debugPreview }
  const [showDebugView, setShowDebugView] = useState(false); // Toggle for all moves
  const [allAllProcessing, setAllAllProcessing] = useState(false);
  const [allAllAnalytics, setAllAllAnalytics] = useState(null);
  const [analyticsSort, setAnalyticsSort] = useState('chronological');
  const [confirmThreshold, setConfirmThreshold] = useState(55); // Default 55%
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [confirmProgress, setConfirmProgress] = useState({ current: 0, total: 0 });
  const [confirmingMoveId, setConfirmingMoveId] = useState(null);
  const [showSwipeView, setShowSwipeView] = useState(false);
  const [swipeViewFrames, setSwipeViewFrames] = useState([]);
  const [swipeViewClusterColors, setSwipeViewClusterColors] = useState({});
  const [backgroundSensitivity, setBackgroundSensitivity] = useState(0.85); // Background detection threshold
  const [swappingPlayers, setSwappingPlayers] = useState(false);
  const [swapProgress, setSwapProgress] = useState({ current: 0, total: 0 });
  const [showSwapModal, setShowSwapModal] = useState(false);
  const [pendingSwapOperation, setPendingSwapOperation] = useState(null);
  const [showMoreMethods, setShowMoreMethods] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const moreMethodsDropdownRef = useRef(null);

  useEffect(() => {
    if (!showHelpModal) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setShowHelpModal(false);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [showHelpModal]);

  useEffect(() => {
    if (!showMoreMethods) return;
    const close = (e) => {
      if (moreMethodsDropdownRef.current && !moreMethodsDropdownRef.current.contains(e.target)) {
        setShowMoreMethods(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setShowMoreMethods(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [showMoreMethods]);

  const detectPlayerByColor = useCallback(
    async (frameData) => {
      if (!frameData) {
        return { suggestion: 'None', stats: null };
      }
      try {
        // Use Selfie Segmentation - finds topmost white pixel (hand tip) and checks color there
        const segmentationResult = await identifyPlayerBySegmentation(frameData, colorA, colorB, {
          anchor: colorAnchor,
          modelSelection: 1, // Landscape/High accuracy
          stride: 2, // Skip pixels for performance
          maskThreshold: 100, // Person detection threshold
          colorThreshold: 95,
          scanDepth: colorAnchor === 'manually' && manualScanBounds
            ? null // Manual bounds will be used instead
            : colorScanPercentage / 100, // Convert percentage to ratio (0.20 = 20%, 1.0 = 100%)
          manualBounds: colorAnchor === 'manually' ? manualScanBounds : null
        });
        if (segmentationResult) {
          return segmentationResult;
        }
      } catch (err) {
        console.warn('[MoveHistoryEditor] Selfie segmentation detector failed, falling back to color bands:', err);
      }
      return identifyPlayerByColor(frameData, colorA, colorB, { anchor: colorAnchor });
    },
    [colorA, colorB, colorAnchor, colorScanPercentage, manualScanBounds]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const h = await restoreDataRootFromStorage();
      if (!cancelled && h) {
        setDataRoot(h);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sessionGameId) return;
    const root = dataRoot || getActiveDataRoot();
    if (!root) {
      setLoading(false);
      setError(
        'No data folder connected. Open Admin and choose the same folder you use for saving sessions.'
      );
      return;
    }
    loadSession();
  }, [sessionGameId, dataRoot]);

  // Helper function to convert HSV to Hex
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

  const loadSession = async () => {
    const root = dataRoot || getActiveDataRoot();
    if (!root || !sessionGameId) return;

    setLoading(true);
    setError(null);
    try {
      const data = await getSessionByGameId(root, sessionGameId);
      setSession(data);

      // Try to get colors from multiple locations (priority order)
      let foundColorA = null;
      let foundColorB = null;
      let colorSource = '';

      // Priority 1: Root level (new format)
      if (data.colorA && data.colorB) {
        foundColorA = data.colorA;
        foundColorB = data.colorB;
        colorSource = 'session root';
      }
      // Priority 2: metadata.config (old format - fallback)
      else if (data.metadata?.config?.colorA && data.metadata?.config?.colorB) {
        foundColorA = data.metadata.config.colorA;
        foundColorB = data.metadata.config.colorB;
        colorSource = 'session metadata';
      }

      if (foundColorA && foundColorB) {
        setColorA(foundColorA);
        setColorB(foundColorB);
        console.log(`[MoveHistoryEditor] ✅ Loaded colors from ${colorSource}:`, foundColorA, foundColorB);
      } else {
        // Priority 3: Fall back to localStorage calibration
        try {
          const calibA = JSON.parse(localStorage.getItem('calibrationA') || 'null');
          const calibB = JSON.parse(localStorage.getItem('calibrationB') || 'null');

          if (calibA && calibB) {
            const hexA = hsvToHex(calibA);
            const hexB = hsvToHex(calibB);

            if (hexA && hexB) {
              setColorA(hexA);
              setColorB(hexB);
              console.log('[MoveHistoryEditor] ⚠️ Session has no colors, loaded from localStorage calibration:', hexA, hexB);
            } else {
              console.log('[MoveHistoryEditor] ℹ️ Using default colors (red/blue)');
            }
          } else {
            console.log('[MoveHistoryEditor] ℹ️ No calibration found, using default colors (red/blue)');
          }
        } catch (err) {
          console.warn('[MoveHistoryEditor] Error reading calibration from localStorage:', err);
          console.log('[MoveHistoryEditor] ℹ️ Using default colors (red/blue)');
        }
      }
    } catch (err) {
      console.error('[MoveHistoryEditor] Error loading session:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePlayerUpdate = async (moveId, newPlayer) => {
    const root = dataRoot || getActiveDataRoot();
    if (!sessionGameId || !moveId || !root) return;

    try {
      await updateMovePlayer(root, sessionGameId, moveId, newPlayer);

      setSession((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          moves: prev.moves.map((move) =>
            getMoveId(move) === moveId ? { ...move, player: newPlayer } : move
          )
        };
      });

      console.log('[MoveHistoryEditor] Player updated:', moveId, newPlayer);
    } catch (err) {
      console.error('[MoveHistoryEditor] Error updating player:', err);
      alert('Failed to update player: ' + err.message);
    }
  };

  const handleColorIdentifyAll = async () => {
    if (!session || !Array.isArray(session.moves)) return;

    setColorProcessing(true);
    setColorSuggestions({});

    try {
      console.log('[MoveHistoryEditor] Starting color identification for all moves...');
      console.log('[MoveHistoryEditor] 🎨 Using colors - Player A:', colorA, 'Player B:', colorB);

      const movesToProcess = filteredMoves.filter((m) => m.camera_frame);

      if (movesToProcess.length === 0) {
        alert('No moves with camera frames to process (color)');
        return;
      }

      setColorProgress({ current: 0, total: movesToProcess.length });
      let processedCount = 0;

      for (const move of movesToProcess) {
        setColorProgress({ current: processedCount + 1, total: movesToProcess.length });
        try {
          const result = await detectPlayerByColor(move.camera_frame);
          if (!result) continue;

          setColorSuggestions((prev) => ({
            ...prev,
            [getMoveId(move)]: {
              method: 'color',
              player:
                result.suggestion === 'A'
                  ? 'Player A'
                  : result.suggestion === 'B'
                    ? 'Player B'
                    : 'None',
              stats: result.stats,
              preview: result.preview
            }
          }));

          processedCount += 1;
        } catch (err) {
          console.error(`[MoveHistoryEditor] Color identify error for move ${getMoveId(move)}:`, err);
        }
      }

      console.log('[MoveHistoryEditor] Color identification complete:', processedCount, 'moves processed');
      alert(`Color-based method suggested players for ${processedCount} moves. Review and confirm suggestions below.`);
    } catch (err) {
      console.error('[MoveHistoryEditor] Error in color identification:', err);
      alert('Color-based identification failed: ' + err.message);
    } finally {
      setColorProcessing(false);
      setColorProgress({ current: 0, total: 0 });
    }
  };

  const handleColorIdentifyUnknown = async () => {
    if (!session || !Array.isArray(session.moves)) return;

    setColorProcessing(true);
    setColorSuggestions({});

    try {
      console.log('[MoveHistoryEditor] Starting color identification for unknown moves...');
      console.log('[MoveHistoryEditor] 🎨 Using colors - Player A:', colorA, 'Player B:', colorB);

      const movesToProcess = filteredMoves.filter(
        (m) =>
          m.camera_frame &&
          (!m.player || m.player === 'Unknown' || m.player === 'None')
      );

      if (movesToProcess.length === 0) {
        alert('No unknown moves with camera frames to process (color)');
        return;
      }

      setColorProgress({ current: 0, total: movesToProcess.length });
      let processedCount = 0;

      for (const move of movesToProcess) {
        setColorProgress({ current: processedCount + 1, total: movesToProcess.length });
        try {
          const result = await detectPlayerByColor(move.camera_frame);
          if (!result) continue;

          setColorSuggestions((prev) => ({
            ...prev,
            [getMoveId(move)]: {
              method: 'color',
              player:
                result.suggestion === 'A'
                  ? 'Player A'
                  : result.suggestion === 'B'
                    ? 'Player B'
                    : 'None',
              stats: result.stats,
              preview: result.preview
            }
          }));

          processedCount += 1;
        } catch (err) {
          console.error(`[MoveHistoryEditor] Color identify error for move ${getMoveId(move)}:`, err);
        }
      }

      console.log(
        '[MoveHistoryEditor] Color identification complete:',
        processedCount,
        'unknown moves processed'
      );
      alert(
        `Color-based method suggested players for ${processedCount} unknown moves. Review and confirm suggestions below.`
      );
    } catch (err) {
      console.error('[MoveHistoryEditor] Error in color identification:', err);
      alert('Color-based identification failed: ' + err.message);
    } finally {
      setColorProcessing(false);
      setColorProgress({ current: 0, total: 0 });
    }
  };

  const handleConfirmColorSuggestion = async (moveId) => {
    const suggestion = colorSuggestions[moveId];
    if (!suggestion) return;

    await handlePlayerUpdate(moveId, suggestion.player);

    setColorSuggestions((prev) => {
      const updated = { ...prev };
      delete updated[moveId];
      return updated;
    });
  };

  const handleColorIdentifySingle = async (moveId) => {
    if (!session || !Array.isArray(session.moves)) return;
    const move = session.moves.find((m) => getMoveId(m) === moveId);
    if (!move || !move.camera_frame) {
      alert('This move has no camera frame for color-based identification.');
      return;
    }

    try {
      console.log(`[MoveHistoryEditor] Color-identifying single move: ${moveId}`);
      const result = await detectPlayerByColor(move.camera_frame);
      if (!result) {
        alert('Color-based identification failed for this move.');
        return;
      }

      setColorSuggestions((prev) => ({
        ...prev,
        [moveId]: {
          method: 'color',
          player:
            result.suggestion === 'A'
              ? 'Player A'
              : result.suggestion === 'B'
                ? 'Player B'
                : 'None',
          stats: result.stats,
          preview: result.preview
        }
      }));
      let calibrationA = null;
      let calibrationB = null;
      try {
        calibrationA = JSON.parse(localStorage.getItem('calibrationA') || 'null');
      } catch (storageErr) {
        calibrationA = null;
      }
      try {
        calibrationB = JSON.parse(localStorage.getItem('calibrationB') || 'null');
      } catch (storageErr) {
        calibrationB = null;
      }

      setColorPreview({
        moveId,
        original: move.camera_frame,
        preview: result.preview,
        maskPreview: result.maskPreview,
        stats: result.stats,
        suggestion: result.suggestion,
        colorA,
        colorB,
        calibrationA,
        calibrationB,
        anchor: colorAnchor,
        backgroundSensitivity
      });
    } catch (err) {
      console.error(`[MoveHistoryEditor] Error color-identifying move:`, err);
      alert('Color-based identification failed: ' + err.message);
    }
  };

  const runClothIdentification = useCallback(
    async ({ mode }) => {
      if (!session || !Array.isArray(session.moves)) {
        alert('No session data available.');
        return;
      }

      const movesWithFrames = session.moves.filter((move) => move.camera_frame);
      if (movesWithFrames.length === 0) {
        alert('No camera frames available for cloth-based identification.');
        return;
      }

      const unknownMoveIds = new Set(
        session.moves
          .filter((move) => !move.player || move.player === 'Unknown' || move.player === 'None')
          .map((move) => getMoveId(move))
      );

      if (mode === 'unknown' && unknownMoveIds.size === 0) {
        alert('All moves already have players assigned.');
        return;
      }

      setClothProcessing(true);
      setClothAnalytics(null);

      try {
        const framesPayload = movesWithFrames.map((move) => ({
          moveId: getMoveId(move),
          frameDataUrl: move.camera_frame,
          existingPlayer: move.player && move.player !== 'Unknown' ? move.player : null
        }));

        const result = await identifyPlayersByCloth(framesPayload, {
          maxFrames: movesWithFrames.length,
          stride: 2,
          minClothPixels: 80,
          manualBounds: colorAnchor === 'manually' ? manualScanBounds : null
        });

        if (result?.analytics) {
          setClothAnalytics(result.analytics);
        }

        // Store debug previews from results
        const debugPreviews = {};
        if (result?.assignments) {
          Object.entries(result.assignments).forEach(([moveId, info]) => {
            if (info.stats?.debugPreview) {
              debugPreviews[moveId] = info.stats.debugPreview;
            }
          });
        }
        if (Object.keys(debugPreviews).length > 0) {
          setClothDebugPreviews(debugPreviews);
        }

        const newSuggestions = {};
        if (result?.assignments) {
          Object.entries(result.assignments).forEach(([moveId, info]) => {
            const shouldApply =
              mode === 'all' ? true : unknownMoveIds.has(moveId);

            if (!shouldApply) return;

            newSuggestions[moveId] = {
              method: 'cloth',
              player: info.player,
              styleLabel: info.styleLabel,
              confidence: info.confidence,
              stats: info.stats
            };
          });
        }

        const suggestionCount = Object.keys(newSuggestions).length;
        if (suggestionCount === 0) {
          const targetText = mode === 'all' ? 'moves' : 'unknown moves';
          alert(`Cloth-based method did not find suggestions for any ${targetText}.`);
        } else {
          setColorSuggestions((prev) => ({
            ...prev,
            ...newSuggestions
          }));
          const targetText = mode === 'all' ? 'moves' : 'unknown moves';
          alert(
            `Cloth-based method suggested players for ${suggestionCount} ${targetText}. Review and confirm suggestions below.`
          );
        }
      } catch (err) {
        console.error('[MoveHistoryEditor] Cloth identification failed:', err);
        alert('Cloth-based identification failed: ' + err.message);
      } finally {
        setClothProcessing(false);
      }
    },
    [session, colorAnchor, manualScanBounds]
  );

  const handleClothIdentifyAll = useCallback(() => {
    runClothIdentification({ mode: 'all' });
  }, [runClothIdentification]);

  const handleClothIdentifyUnknown = useCallback(() => {
    runClothIdentification({ mode: 'unknown' });
  }, [runClothIdentification]);

  const runAllAllIdentification = useCallback(
    async ({ mode }) => {
      if (!session || !Array.isArray(session.moves)) {
        alert('No session data available.');
        return;
      }

      const movesWithFrames = session.moves.filter((move) => move.camera_frame);
      if (movesWithFrames.length === 0) {
        alert('No camera frames available for All-All identification.');
        return;
      }

      const unknownMoveIds = new Set(
        session.moves
          .filter((move) => !move.player || move.player === 'Unknown' || move.player === 'None')
          .map((move) => getMoveId(move))
      );

      if (mode === 'unknown' && unknownMoveIds.size === 0) {
        alert('All moves already have players assigned.');
        return;
      }

      setAllAllProcessing(true);
      setAllAllAnalytics(null);

      try {
        const framesPayload = movesWithFrames.map((move) => ({
          moveId: getMoveId(move),
          frameDataUrl: move.camera_frame,
          // Always pass existing player info to help the clustering algorithm
          // even if we only want suggestions for unknown moves later
          existingPlayer: move.player && move.player !== 'Unknown' && move.player !== 'None' ? move.player : null
        }));

        const result = await identifyPlayersByAllAll(framesPayload, {
          maxFrames: movesWithFrames.length,
          stride: 2,
          minPixels: 80,
          manualBounds: colorAnchor === 'manually' ? manualScanBounds : null,
          playerColors: { 'Player A': colorA, 'Player B': colorB },
          sensitivity: backgroundSensitivity
        });

        if (result?.analytics) {
          setAllAllAnalytics(result.analytics);
        }

        // Store debug previews from results (shared with cloth debug previews)
        const debugPreviews = {};
        if (result?.assignments) {
          Object.entries(result.assignments).forEach(([moveId, info]) => {
            if (info.stats?.debugPreview) {
              debugPreviews[moveId] = info.stats.debugPreview;
            }
          });
        }
        if (Object.keys(debugPreviews).length > 0) {
          setClothDebugPreviews(prev => ({ ...prev, ...debugPreviews })); // Merge with existing previews
        }

        const newSuggestions = {};
        if (result?.assignments) {
          Object.entries(result.assignments).forEach(([moveId, info]) => {
            const shouldApply =
              mode === 'all' ? true : unknownMoveIds.has(moveId);

            if (!shouldApply) return;

            newSuggestions[moveId] = {
              method: 'allall',
              player: info.player,
              styleLabel: info.styleLabel,
              confidence: info.confidence,
              stats: info.stats
            };
          });
        }

        const suggestionCount = Object.keys(newSuggestions).length;
        if (suggestionCount === 0) {
          const targetText = mode === 'all' ? 'moves' : 'unknown moves';
          alert(`All-All method did not find suggestions for any ${targetText}.`);
        } else {
          setColorSuggestions((prev) => ({
            ...prev,
            ...newSuggestions
          }));
          const targetText = mode === 'all' ? 'moves' : 'unknown moves';
          alert(
            `All-All method suggested players for ${suggestionCount} ${targetText}. Review and confirm suggestions below.`
          );
        }
      } catch (err) {
        console.error('[MoveHistoryEditor] All-All identification failed:', err);
        alert('All-All identification failed: ' + err.message);
      } finally {
        setAllAllProcessing(false);
      }
    },
    [session, colorAnchor, manualScanBounds, backgroundSensitivity, colorA, colorB]
  );

  const handleAllAllIdentifyAll = useCallback(() => {
    runAllAllIdentification({ mode: 'all' });
  }, [runAllAllIdentification]);

  const handleAllAllIdentifyUnknown = useCallback(() => {
    runAllAllIdentification({ mode: 'unknown' });
  }, [runAllAllIdentification]);

  // Swap Player A and Player B assignments in All-All analytics
  const handleSwapPlayerAssignments = useCallback(() => {
    if (!allAllAnalytics?.clusters) return;

    // Swap the assignedPlayer in clusters
    const swappedClusters = allAllAnalytics.clusters.map(cluster => ({
      ...cluster,
      assignedPlayer: cluster.assignedPlayer === 'Player A' ? 'Player B' : 'Player A'
    }));

    setAllAllAnalytics(prev => ({
      ...prev,
      clusters: swappedClusters
    }));

    // Also swap the color suggestions
    setColorSuggestions(prev => {
      const swapped = {};
      Object.entries(prev).forEach(([moveId, suggestion]) => {
        if (suggestion?.player === 'Player A') {
          swapped[moveId] = { ...suggestion, player: 'Player B' };
        } else if (suggestion?.player === 'Player B') {
          swapped[moveId] = { ...suggestion, player: 'Player A' };
        } else {
          swapped[moveId] = suggestion;
        }
      });
      return swapped;
    });
  }, [allAllAnalytics]);

  // Swap Player A and Player B in the session file (persisted)
  const handleSwapPlayersABDatabase = useCallback(async () => {
    const root = dataRoot || getActiveDataRoot();
    if (!sessionGameId || !root || !session?.moves) return;

    try {
      const swapOperation = await swapPlayersAB({
        rootHandle: root,
        sessionGameId,
        moves: session.moves,
        onProgress: (current, total) => {
          setSwapProgress({ current, total });
        }
      });

      setPendingSwapOperation(swapOperation);
      setShowSwapModal(true);
    } catch (err) {
      console.error('[MoveHistoryEditor] Swap preparation failed:', err);
      alert('Failed to prepare swap: ' + err.message);
    }
  }, [sessionGameId, dataRoot, session?.moves]);

  // Handle swap confirmation from modal
  const handleConfirmSwap = useCallback(async () => {
    if (!pendingSwapOperation) return;

    setShowSwapModal(false);
    setSwappingPlayers(true);
    setSwapProgress({ current: 0, total: pendingSwapOperation.confirmationInfo.totalBatches });

    try {
      // Execute the swap
      const result = await pendingSwapOperation.execute();

      console.log('[MoveHistoryEditor] Swap completed:', result);

      // Update local state with swapped players
      setSession(prev => {
        if (!prev) return prev;
        const newMoves = prev.moves.map(move => {
          const update = result.updates.find(u => u.moveId === getMoveId(move));
          return update ? { ...move, player: update.player } : move;
        });
        return { ...prev, moves: newMoves };
      });

      alert(`Successfully swapped ${result.updatedCount} frames.`);

    } catch (err) {
      console.error('[MoveHistoryEditor] Swap failed:', err);
      alert('Failed to swap players: ' + err.message);
    } finally {
      setSwappingPlayers(false);
      setSwapProgress({ current: 0, total: 0 });
      setPendingSwapOperation(null);
    }
  }, [pendingSwapOperation]);

  // Handle swap cancellation from modal
  const handleCancelSwap = useCallback(() => {
    setShowSwapModal(false);
    setPendingSwapOperation(null);
  }, []);

  const filteredMoves = session?.moves?.filter(move => {
    let matchesPhase = true;
    if (filterPhase !== 'all') {
      matchesPhase = move.phase === filterPhase;
    }

    let matchesPlayer = true;
    if (filterPlayer !== 'all') {
      if (filterPlayer === 'None') {
        matchesPlayer = !move.player || move.player === 'None' || move.player === 'Unknown';
      } else {
        matchesPlayer = move.player === filterPlayer;
      }
    }

    return matchesPhase && matchesPlayer;
  }) || [];

  const getSortedMoves = () => {
    const moves = [...filteredMoves];
    if (analyticsSort === 'chronological') return moves;

    return moves.sort((a, b) => {
      const hasSuggestionA = !!colorSuggestions[getMoveId(a)];
      const hasSuggestionB = !!colorSuggestions[getMoveId(b)];

      // Always prioritize moves with suggestions
      if (hasSuggestionA && !hasSuggestionB) return -1;
      if (!hasSuggestionA && hasSuggestionB) return 1;

      // If neither has suggestion, keep original order (or sort by ID/index if needed)
      if (!hasSuggestionA && !hasSuggestionB) return 0;

      // Both have suggestions, sort by confidence
      const confA = colorSuggestions[getMoveId(a)]?.confidence || 0;
      const confB = colorSuggestions[getMoveId(b)]?.confidence || 0;

      if (analyticsSort === 'confidenceDesc') return confB - confA;
      if (analyticsSort === 'confidenceAsc') return confA - confB;
      return 0;
    });
  };

  const sortedMoves = getSortedMoves();

  const handleConfirmAllAboveThreshold = async () => {
    const root = dataRoot || getActiveDataRoot();
    if (!sessionGameId || !root) return;

    const movesToConfirm = Object.entries(colorSuggestions)
      .filter(([, suggestion]) => {
        const confidencePercent = (suggestion.confidence || 0) * 100;
        return confidencePercent >= confirmThreshold;
      })
      .map(([moveId, suggestion]) => ({
        moveId,
        player: suggestion.player
      }));

    if (movesToConfirm.length === 0) {
      alert(`No moves found with confidence above ${confirmThreshold}%`);
      return;
    }

    if (
      !window.confirm(
        `Are you sure you want to confirm ${movesToConfirm.length} moves with confidence >= ${confirmThreshold}%?`
      )
    ) {
      return;
    }

    setConfirmingAll(true);
    setConfirmProgress({ current: 0, total: movesToConfirm.length });

    try {
      await updateMovePlayersBatch(root, sessionGameId, movesToConfirm);

      setSession((prev) => {
        if (!prev) return prev;
        const newMoves = prev.moves.map((move) => {
          const update = movesToConfirm.find((u) => u.moveId === getMoveId(move));
          return update ? { ...move, player: update.player } : move;
        });
        return { ...prev, moves: newMoves };
      });

      setColorSuggestions((prev) => {
        const updated = { ...prev };
        movesToConfirm.forEach(({ moveId }) => {
          delete updated[moveId];
        });
        return updated;
      });

      alert(`Successfully confirmed ${movesToConfirm.length} moves.`);
    } catch (err) {
      console.error('Failed to confirm moves:', err);
      alert('Failed to confirm moves: ' + err.message);
    } finally {
      setConfirmingAll(false);
      setConfirmProgress({ current: 0, total: 0 });
    }
  };

  // Handler to open SwipeView with frames that need review
  const handleOpenSwipeView = () => {
    if (!session || !Array.isArray(session.moves)) return;

    // Prepare cluster colors from analytics if available
    const clusterColors = {};
    if (allAllAnalytics?.clusters) {
      allAllAnalytics.clusters.forEach(cluster => {
        if (cluster.assignedPlayer && cluster.hexColor) {
          clusterColors[cluster.assignedPlayer] = cluster.hexColor;
        }
      });
    } else if (clothAnalytics?.clusters) {
      clothAnalytics.clusters.forEach(cluster => {
        if (cluster.assignedPlayer && cluster.hexColor) {
          clusterColors[cluster.assignedPlayer] = cluster.hexColor;
        }
      });
    }
    // Fallback to configured colors
    if (!clusterColors['Player A']) clusterColors['Player A'] = colorA;
    if (!clusterColors['Player B']) clusterColors['Player B'] = colorB;

    // Get frames that need review:
    // 1. First: frames with suggestions below threshold (not yet confirmed)
    // 2. Then: frames that are unknown/none
    const movesWithFrames = session.moves.filter(m => m.camera_frame);

    // Frames with low confidence suggestions
    const lowConfidenceFrames = movesWithFrames
      .filter(m => {
        const suggestion = colorSuggestions[getMoveId(m)];
        if (!suggestion) return false;
        const confidencePercent = (suggestion.confidence || 0) * 100;
        return confidencePercent < confirmThreshold;
      })
      .map(m => {
        const suggestion = colorSuggestions[getMoveId(m)];
        return {
          id: getMoveId(m),
          frameUrl: m.camera_frame,
          player: m.player || 'Unknown',
          time: m.elapsed,
          confidence: suggestion?.confidence || null,
          styleLabel: suggestion?.styleLabel,
          type: m.type,
          phase: m.phase,
          needsReview: true
        };
      });

    // Unknown/None frames (not already in low confidence list)
    const lowConfidenceIds = new Set(lowConfidenceFrames.map(f => f.id));
    const unknownFrames = movesWithFrames
      .filter(m =>
        !lowConfidenceIds.has(getMoveId(m)) &&
        (!m.player || m.player === 'Unknown' || m.player === 'None')
      )
      .map(m => ({
        id: getMoveId(m),
        frameUrl: m.camera_frame,
        player: m.player || 'Unknown',
        time: m.elapsed,
        confidence: null,
        type: m.type,
        phase: m.phase,
        needsReview: true
      }));

    // Combine: low confidence first, then unknowns
    const framesToReview = [...lowConfidenceFrames, ...unknownFrames];

    if (framesToReview.length === 0) {
      alert('No frames need review! All frames are either confirmed or have high confidence.');
      return;
    }

    setSwipeViewFrames(framesToReview);
    setSwipeViewClusterColors(clusterColors);
    setShowSwipeView(true);
  };

  const handleCloseSwipeView = (result) => {
    setShowSwipeView(false);

    // Remove suggestions for frames that were labeled (not skipped)
    if (result?.labeledIds && result.labeledIds.length > 0) {
      setColorSuggestions((prev) => {
        const updated = { ...prev };
        result.labeledIds.forEach((id) => {
          delete updated[id];
        });
        return updated;
      });
    }

    loadSession();
  };

  if (loading) {
    return (
      <div className="move-editor-container">
        <div className="move-editor-loading">Loading session data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="move-editor-container">
        <div className="move-editor-error">
          <h2>Error Loading Session</h2>
          <p>{error}</p>
          <button onClick={() => window.location.hash = '#/admin'}>← Back to Admin</button>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="move-editor-container">
        <div className="move-editor-error">Session not found</div>
      </div>
    );
  }

  const practiceCount = session.moves?.filter(m => m.phase === 'practice').length || 0;
  const experimentCount = session.moves?.filter(m => m.phase === 'experiment').length || 0;
  const playerACount = session.moves?.filter(m => m.player === 'Player A').length || 0;
  const playerBCount = session.moves?.filter(m => m.player === 'Player B').length || 0;
  const noneCount = session.moves?.filter(m => !m.player || m.player === 'None' || m.player === 'Unknown').length || 0;
  const clothDebugPreviewCount = Object.keys(clothDebugPreviews).length;

  return (
    <div className="move-editor-container">
      <header className="move-editor-header">
        <button className="back-button" onClick={() => window.location.hash = '#/admin'}>
          ← Back to Admin
        </button>
        <div className="move-editor-title">
          <div className="move-editor-title-heading-row">
            <h1 id="move-editor-main-title">Move History Editor</h1>
            <button
              type="button"
              className="move-editor-help-btn"
              onClick={() => setShowHelpModal(true)}
              aria-haspopup="dialog"
              aria-expanded={showHelpModal}
              aria-controls="move-editor-help-dialog"
            >
              <span className="move-editor-help-btn__icon" aria-hidden="true">
                ?
              </span>
              Help
            </button>
          </div>
          <div className="session-info">
            <span className="session-id">Session: {sessionGameId}</span>
            <span className="session-meta">Participant: {session.subjectId}</span>
            <span className="session-meta">Condition: {session.condition}</span>
          </div>
          <div className="player-stats" style={{ marginTop: '5px', fontSize: '0.9em', display: 'flex', alignItems: 'center', gap: '15px' }}>
            <span style={{ color: colorA, fontWeight: 'bold' }}>Player A: {playerACount}</span>
            <span style={{ color: colorB, fontWeight: 'bold' }}>Player B: {playerBCount}</span>
            <button
              onClick={handleSwapPlayersABDatabase}
              disabled={swappingPlayers || playerACount + playerBCount === 0}
              style={{
                background: 'linear-gradient(135deg, #FF6B6B, #4ECDC4)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                padding: '6px 12px',
                cursor: swappingPlayers || playerACount + playerBCount === 0 ? 'not-allowed' : 'pointer',
                fontSize: '12px',
                fontWeight: 'bold',
                opacity: swappingPlayers || playerACount + playerBCount === 0 ? 0.6 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
              title="Swap all Player A and Player B assignments in the database"
            >
              {swappingPlayers ? (
                <>{`Swapping... (${swapProgress.current}/${swapProgress.total})`}</>
              ) : (
                <>⇄ Swap A and B</>
              )}
            </button>
          </div>

          {clothDebugPreviewCount > 0 && (
            <div className="title-toolbar-row">
              <div
                className="cloth-debug-tile"
                role="group"
                aria-label="Cloth segmentation debug previews"
              >
                <div className="cloth-debug-tile-head">
                  <span className="cloth-debug-tile-label">Cloth debug</span>
                  <span className="cloth-debug-tile-meta">
                    {clothDebugPreviewCount} preview{clothDebugPreviewCount !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="cloth-debug-tile-actions">
                  <button
                    type="button"
                    className={`cloth-debug-toggle ${showDebugView ? 'cloth-debug-toggle--on' : ''}`}
                    onClick={() => setShowDebugView(!showDebugView)}
                    aria-pressed={showDebugView}
                  >
                    <span className="cloth-debug-toggle__icon" aria-hidden="true">
                      🔬
                    </span>
                    <span className="cloth-debug-toggle__text">
                      {showDebugView ? 'Hide on cards' : 'Show on cards'}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="cloth-debug-clear"
                    onClick={() => {
                      setShowDebugView(false);
                      setClothDebugPreviews({});
                    }}
                  >
                    <span className="cloth-debug-clear__icon" aria-hidden="true">
                      🗑
                    </span>
                    <span>Clear all</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="header-center-group">
          <div className="phase-filter">
            <button
              className={`filter-btn ${filterPhase === 'all' ? 'active' : ''}`}
              onClick={() => setFilterPhase('all')}
            >
              All ({session.moves?.length || 0})
            </button>
            <button
              className={`filter-btn ${filterPhase === 'practice' ? 'active' : ''}`}
              onClick={() => setFilterPhase('practice')}
            >
              Practice ({practiceCount})
            </button>
            <button
              className={`filter-btn ${filterPhase === 'experiment' ? 'active' : ''}`}
              onClick={() => setFilterPhase('experiment')}
            >
              Experiment ({experimentCount})
            </button>
          </div>
          <div className="player-filter" style={{ marginTop: '4px' }}>
            <button
              className={`filter-btn ${filterPlayer === 'all' ? 'active' : ''}`}
              onClick={() => setFilterPlayer('all')}
            >
              All Players ({session.moves?.length || 0})
            </button>
            <button
              className={`filter-btn ${filterPlayer === 'Player A' ? 'active' : ''}`}
              onClick={() => setFilterPlayer('Player A')}
              style={{ borderColor: colorA, color: filterPlayer === 'Player A' ? 'white' : colorA, backgroundColor: filterPlayer === 'Player A' ? colorA : 'transparent' }}
            >
              Player A ({playerACount})
            </button>
            <button
              className={`filter-btn ${filterPlayer === 'Player B' ? 'active' : ''}`}
              onClick={() => setFilterPlayer('Player B')}
              style={{ borderColor: colorB, color: filterPlayer === 'Player B' ? 'white' : colorB, backgroundColor: filterPlayer === 'Player B' ? colorB : 'transparent' }}
            >
              Player B ({playerBCount})
            </button>
            <button
              className={`filter-btn ${filterPlayer === 'None' ? 'active' : ''}`}
              onClick={() => setFilterPlayer('None')}
            >
              None/Unknown ({noneCount})
            </button>
          </div>
        </div>

        <div className="header-controls-group">
          <div className="color-controls">
            <div className="identify-primary-row">
              <button
                type="button"
                className="ai-btn allall-btn identify-all-primary"
                onClick={handleAllAllIdentifyAll}
                disabled={allAllProcessing}
              >
                {allAllProcessing ? 'Identifying…' : 'Identify All'}
              </button>
              <button
                type="button"
                className="ai-btn allall-btn identify-all-secondary"
                onClick={handleAllAllIdentifyUnknown}
                disabled={allAllProcessing}
              >
                {allAllProcessing ? 'Identifying…' : 'Identify Unknown'}
              </button>
              <p className="scan-area-tip">
                Tip: set the scan area below (General / Manual and region) for better results.
              </p>
            </div>

            <div className="identify-secondary-actions">
              <div className="more-methods-dropdown" ref={moreMethodsDropdownRef}>
                <button
                  type="button"
                  className="more-methods-dropdown-trigger"
                  onClick={() => setShowMoreMethods((v) => !v)}
                  aria-expanded={showMoreMethods}
                  aria-haspopup="menu"
                  title="Cloth / Color runs and bracelet hue picks"
                >
                  <span className="more-methods-dropdown-label">More methods</span>
                  <span className={`more-methods-chevron ${showMoreMethods ? 'open' : ''}`} aria-hidden />
                </button>
                {showMoreMethods && (
                  <div className="more-methods-dropdown-panel" role="menu">
                    <div className="more-methods-bracelet-strip">
                      <span className="more-methods-label">Bracelet colors</span>
                      <p className="more-methods-bracelet-hint">
                        Used for Cloth and Color identification (defaults load from session when available).
                      </p>
                      <div className="more-methods-bracelet-inputs">
                        <div className="more-methods-color-field">
                          <label htmlFor="more-methods-color-a">Player A</label>
                          <input
                            id="more-methods-color-a"
                            type="color"
                            value={colorA}
                            onChange={(e) => setColorA(e.target.value)}
                            aria-label="Player A bracelet color"
                          />
                          <span className="more-methods-color-hex">{colorA}</span>
                        </div>
                        <div className="more-methods-color-field">
                          <label htmlFor="more-methods-color-b">Player B</label>
                          <input
                            id="more-methods-color-b"
                            type="color"
                            value={colorB}
                            onChange={(e) => setColorB(e.target.value)}
                            aria-label="Player B bracelet color"
                          />
                          <span className="more-methods-color-hex">{colorB}</span>
                        </div>
                      </div>
                    </div>
                    <span className="more-methods-label">Cloth &amp; color runs</span>
                    <div className="more-methods-buttons">
                      <button
                        type="button"
                        className="ai-btn"
                        role="menuitem"
                        onClick={handleClothIdentifyAll}
                        disabled={clothProcessing || allAllProcessing || colorProcessing}
                        title="Cloth-class segmentation: suggest players for all moves with frames"
                      >
                        {clothProcessing ? '👕 Cloth…' : '👕 Cloth (all)'}
                      </button>
                      <button
                        type="button"
                        className="ai-btn"
                        role="menuitem"
                        onClick={handleClothIdentifyUnknown}
                        disabled={clothProcessing || allAllProcessing || colorProcessing}
                        title="Cloth-class segmentation: unknown / none moves only"
                      >
                        {clothProcessing ? '👕 Cloth…' : '👕 Cloth (unknown)'}
                      </button>
                      <button
                        type="button"
                        className="ai-btn"
                        role="menuitem"
                        onClick={handleColorIdentifyAll}
                        disabled={colorProcessing || allAllProcessing || clothProcessing}
                        title="Segmentation + bracelet colors: all filtered moves with frames"
                      >
                        {colorProcessing ? '🎨 Color…' : '🎨 Color (all)'}
                      </button>
                      <button
                        type="button"
                        className="ai-btn"
                        role="menuitem"
                        onClick={handleColorIdentifyUnknown}
                        disabled={colorProcessing || allAllProcessing || clothProcessing}
                        title="Segmentation + bracelet colors: unknown moves only"
                      >
                        {colorProcessing ? '🎨 Color…' : '🎨 Color (unknown)'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button"
                className="swipe-view-toolbar-btn"
                onClick={handleOpenSwipeView}
                title="Open Swipe View to review frames"
              >
                👆 Swipe View ({(() => {
                  const unknownIds = new Set(
                    (session?.moves || [])
                      .filter(m => m.camera_frame && (!m.player || m.player === 'Unknown' || m.player === 'None'))
                      .map(m => getMoveId(m))
                  );
                  const suggestionIds = new Set(
                    Object.entries(colorSuggestions)
                      .filter(([, s]) => (s.confidence || 0) * 100 < confirmThreshold)
                      .map(([id]) => id)
                  );
                  suggestionIds.forEach(id => unknownIds.add(id));
                  return unknownIds.size;
                })()})
              </button>
            </div>
            <div className="color-anchor-toggle" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>

              <div className="scan-mode-radios" style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="scanMode"
                    checked={colorAnchor !== 'manually'}
                    onChange={() => {
                      setColorAnchor('bottom');
                      setShowManualSelector(false);
                      setManualScanBounds(null);
                      setManualSelectorFrame(null);
                    }}
                  />
                  General
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="scanMode"
                    checked={colorAnchor === 'manually'}
                    onChange={() => {
                      setColorAnchor('manually');
                      // Get a random frame to use for manual selection
                      const moves = session?.moves || [];
                      if (moves.length > 0) {
                        const randomMove = moves[Math.floor(Math.random() * moves.length)];
                        if (randomMove?.camera_frame) {
                          setManualSelectorFrame(randomMove.camera_frame);
                          setShowManualSelector(true);
                        } else {
                          alert('No frames available. Please ensure moves have camera frames.');
                          setColorAnchor('bottom'); // Reset
                        }
                      } else {
                        alert('No moves available.');
                        setColorAnchor('bottom'); // Reset
                      }
                    }}
                  />
                  Manual
                </label>
              </div>

              {colorAnchor !== 'manually' && (
                <>
                  <label>Scan area:</label>
                  <select
                    value={colorAnchor}
                    onChange={(e) => setColorAnchor(e.target.value)}
                    style={{ padding: '6px', borderRadius: '4px', background: '#222', color: '#fff', border: '1px solid #444' }}
                  >
                    <option value="bottom">Bottom</option>
                    <option value="top">Top</option>
                  </select>
                  <div className="color-scan-percentage">
                    <label>{colorScanPercentage}%</label>
                    <input
                      type="range"
                      min="20"
                      max="100"
                      step="5"
                      value={colorScanPercentage}
                      onChange={(e) => setColorScanPercentage(Number(e.target.value))}
                      style={{ width: '80px', marginLeft: '8px' }}
                    />
                  </div>
                </>
              )}

              {colorAnchor === 'manually' && (
                <div className="manual-bounds-info" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {manualScanBounds ? (
                    <span style={{ fontSize: '12px', color: '#aaa' }}>
                      Y: {Math.round(manualScanBounds.topY)}→{Math.round(manualScanBounds.bottomY)} |
                      X: {Math.round(manualScanBounds.leftX ?? 0)}→{Math.round(manualScanBounds.rightX ?? 0)}
                    </span>
                  ) : (
                    <span style={{ fontSize: '12px', color: '#f44336' }}>Not set</span>
                  )}
                  <button
                    onClick={() => {
                      // Re-open selector with same frame if possible, or new random one
                      if (manualSelectorFrame) {
                        setShowManualSelector(true);
                      } else {
                        const moves = session?.moves || [];
                        const randomMove = moves[Math.floor(Math.random() * moves.length)];
                        if (randomMove?.camera_frame) {
                          setManualSelectorFrame(randomMove.camera_frame);
                          setShowManualSelector(true);
                        }
                      }
                    }}
                    className="ai-btn"
                    style={{ padding: '4px 8px', fontSize: '12px', backgroundColor: '#2196F3' }}
                  >
                    Change scan area
                  </button>
                </div>
              )}

              {/* Background Sensitivity Slider */}
              <div className="bg-sensitivity-control" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
                <label style={{ fontSize: '12px', color: '#aaa' }}>BG Sensitivity:</label>
                <span style={{ fontSize: '12px', color: '#fff', minWidth: '35px' }}>{backgroundSensitivity.toFixed(2)}</span>
                <input
                  type="range"
                  min="0.3"
                  max="0.99"
                  step="0.01"
                  value={backgroundSensitivity}
                  onChange={(e) => setBackgroundSensitivity(Number(e.target.value))}
                  style={{ width: '100px' }}
                  title="Higher = more pixels included as foreground (less aggressive filtering)"
                />
              </div>
            </div>
          </div>
        </div>
      </header>

      {clothAnalytics && (
        <section className="cloth-analytics">
          <div className="cloth-analytics-header">
            <div>
              <h3>Cloth Styles Analytics</h3>
              <p>
                Frames analyzed: {clothAnalytics.usedFrames}/{clothAnalytics.totalFrames} · Skipped:{' '}
                {clothAnalytics.skippedFrames}
              </p>
            </div>
          </div>
          <div className="cloth-style-grid">
            {clothAnalytics.clusters?.map((cluster) => (
              <div key={cluster.id} className="cloth-style-card">
                <div className="cloth-style-card-header">
                  <span className="style-label">{cluster.styleLabel}</span>
                  <span className="player-label">{cluster.assignedPlayer}</span>
                </div>
                <div
                  className="cloth-style-color-chip"
                  style={{ backgroundColor: cluster.hexColor }}
                />
                <div className="cloth-style-stats">
                  <div>
                    <strong>Mean color:</strong> {cluster.hexColor}
                  </div>
                  <div>
                    <strong>Frames:</strong> {cluster.sampleCount}
                  </div>
                  <div>
                    <strong>Avg pixels:</strong> {formatNumber(cluster.avgPixels || 0)}
                  </div>
                  <div>
                    <strong>Avg brightness:</strong> {formatNumber(cluster.avgBrightness || 0)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )
      }

      {
        allAllAnalytics && (
          <section className="cloth-analytics">
            <div className="cloth-analytics-header">
              <div>
                <h3>🌐 All-All Styles Analytics (Background Excluded)</h3>
                <p>
                  Frames analyzed: {allAllAnalytics.usedFrames}/{allAllAnalytics.totalFrames} · Skipped:{' '}
                  {allAllAnalytics.skippedFrames}
                </p>
              </div>
              <div className="analytics-controls" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '15px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#f5f5f5', padding: '4px 8px', borderRadius: '4px' }}>
                  <label style={{ fontSize: '14px' }}>Confirm threshold: {confirmThreshold}%</label>
                  <input
                    type="range"
                    min="50"
                    max="100"
                    value={confirmThreshold}
                    onChange={(e) => setConfirmThreshold(Number(e.target.value))}
                    style={{ width: '100px' }}
                  />
                  <button
                    onClick={handleConfirmAllAboveThreshold}
                    disabled={confirmingAll}
                    style={{
                      backgroundColor: confirmingAll ? '#9E9E9E' : '#4CAF50',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      padding: '4px 8px',
                      cursor: confirmingAll ? 'not-allowed' : 'pointer',
                      fontSize: '12px',
                      fontWeight: 'bold',
                      minWidth: '140px'
                    }}
                  >
                    {confirmingAll
                      ? `Saving ${confirmProgress.current}/${confirmProgress.total}...`
                      : `Confirm All ≥ ${confirmThreshold}% (${Object.values(colorSuggestions).filter(s => (s.confidence || 0) * 100 >= confirmThreshold).length})`
                    }
                  </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <label>Sort by:</label>
                  <select
                    value={analyticsSort}
                    onChange={(e) => setAnalyticsSort(e.target.value)}
                    style={{ padding: '4px', borderRadius: '4px' }}
                  >
                    <option value="chronological">Chronological</option>
                    <option value="confidenceDesc">Confidence (High to Low)</option>
                    <option value="confidenceAsc">Confidence (Low to High)</option>
                  </select>
                </div>

                <button
                  onClick={handleOpenSwipeView}
                  style={{
                    background: 'linear-gradient(135deg, #9C27B0, #673AB7)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '8px 16px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    boxShadow: '0 2px 8px rgba(156, 39, 176, 0.3)'
                  }}
                  title="Open Swipe View to review unconfirmed frames"
                >
                  👆 Review Unconfirmed
                </button>
              </div>
            </div>
            <div className="cloth-style-grid" style={{ alignItems: 'center', gap: '10px' }}>
              {allAllAnalytics.clusters?.length >= 1 && (
                <div key={allAllAnalytics.clusters[0].id} className="cloth-style-card">
                  <div className="cloth-style-card-header">
                    <span className="style-label">{allAllAnalytics.clusters[0].styleLabel}</span>
                    <span className="player-label">{allAllAnalytics.clusters[0].assignedPlayer}</span>
                  </div>
                  <div
                    className="cloth-style-color-chip"
                    style={{ backgroundColor: allAllAnalytics.clusters[0].hexColor }}
                  />
                  <div className="cloth-style-stats">
                    <div>
                      <strong>Mean color:</strong> {allAllAnalytics.clusters[0].hexColor}
                    </div>
                    <div>
                      <strong>Frames:</strong> {allAllAnalytics.clusters[0].sampleCount}
                    </div>
                    <div>
                      <strong>Avg pixels:</strong> {formatNumber(allAllAnalytics.clusters[0].avgPixels || 0)}
                    </div>
                    <div>
                      <strong>Avg brightness:</strong> {formatNumber(allAllAnalytics.clusters[0].avgBrightness || 0)}
                    </div>
                  </div>
                </div>
              )}

              {/* Swap Button */}
              {allAllAnalytics.clusters?.length === 2 && (
                <button
                  onClick={handleSwapPlayerAssignments}
                  className="swap-players-btn"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '10px 15px',
                    backgroundColor: '#2196F3',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '20px',
                    minWidth: '60px'
                  }}
                  title="Swap Player A and Player B assignments"
                >
                  ⇄
                  <span style={{ fontSize: '10px', marginTop: '4px' }}>Swap</span>
                </button>
              )}

              {allAllAnalytics.clusters?.length >= 2 && (
                <div key={allAllAnalytics.clusters[1].id} className="cloth-style-card">
                  <div className="cloth-style-card-header">
                    <span className="style-label">{allAllAnalytics.clusters[1].styleLabel}</span>
                    <span className="player-label">{allAllAnalytics.clusters[1].assignedPlayer}</span>
                  </div>
                  <div
                    className="cloth-style-color-chip"
                    style={{ backgroundColor: allAllAnalytics.clusters[1].hexColor }}
                  />
                  <div className="cloth-style-stats">
                    <div>
                      <strong>Mean color:</strong> {allAllAnalytics.clusters[1].hexColor}
                    </div>
                    <div>
                      <strong>Frames:</strong> {allAllAnalytics.clusters[1].sampleCount}
                    </div>
                    <div>
                      <strong>Avg pixels:</strong> {formatNumber(allAllAnalytics.clusters[1].avgPixels || 0)}
                    </div>
                    <div>
                      <strong>Avg brightness:</strong> {formatNumber(allAllAnalytics.clusters[1].avgBrightness || 0)}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        )
      }

      <div className="move-editor-content">
        <div className="moves-grid">
          {sortedMoves.map((move, index) => (
            <div
              key={getMoveId(move) || index}
              className={`move-card ${getMoveId(selectedMove) === getMoveId(move) ? 'selected' : ''}`}
              onClick={() => setSelectedMove(move)}
            >
              <div className="move-card-header">
                <span className="move-number">#{index + 1}</span>
                <span className={`move-phase ${move.phase}`}>{move.phase}</span>
              </div>

              {move.camera_frame && (
                <div
                  className="move-image"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpandedImage(
                      showDebugView && clothDebugPreviews[getMoveId(move)]
                        ? clothDebugPreviews[getMoveId(move)]
                        : move.camera_frame
                    );
                  }}
                  style={{ position: 'relative' }}
                >
                  <img
                    src={
                      showDebugView && clothDebugPreviews[getMoveId(move)]
                        ? clothDebugPreviews[getMoveId(move)]
                        : move.camera_frame
                    }
                    alt={`Move ${index + 1}`}
                  />
                  <div className="image-overlay">🔍 Click to enlarge</div>
                  {showDebugView && clothDebugPreviews[getMoveId(move)] && (
                    <div style={{
                      position: 'absolute',
                      top: '10px',
                      right: '10px',
                      backgroundColor: 'rgba(76, 175, 80, 0.9)',
                      color: 'white',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: 'bold'
                    }}>
                      🔬 DEBUG
                    </div>
                  )}
                </div>
              )}

              <div className="move-card-body">
                <div className="move-info-row">
                  <span className="label">Type:</span>
                  <span className="value">{move.type}</span>
                </div>

                {colorSuggestions[getMoveId(move)] && (() => {
                  const suggestion = colorSuggestions[getMoveId(move)];
                  const suggestedPlayer = suggestion.player;
                  const isPlayerA = suggestedPlayer === 'Player A';
                  const bannerColor = isPlayerA ? colorA : colorB;
                  const method = suggestion.method || 'color';
                  const icon = method === 'cloth' ? '👕' : method === 'allall' ? '🌐' : '🎨';
                  const methodLabel =
                    method === 'cloth'
                      ? `Cloth suggests${suggestion.styleLabel ? ` (${suggestion.styleLabel})` : ''}:`
                      : method === 'allall'
                        ? `All-All suggests${suggestion.styleLabel ? ` (${suggestion.styleLabel})` : ''}:`
                        : 'Color suggests:';
                  const confidenceText =
                    typeof suggestion.confidence === 'number'
                      ? ` · ${Math.round(suggestion.confidence * 100)}% confidence`
                      : '';

                  // If we have stats from k-means (cloth/allall), use the mean color of the cluster
                  // Otherwise fall back to the player's assigned color (A/B)
                  let outlineColor = bannerColor;
                  if (suggestion.stats && suggestion.stats.meanColor) {
                    const { r, g, b } = suggestion.stats.meanColor;
                    const toHex = (c) => {
                      const hex = Math.round(c).toString(16);
                      return hex.length === 1 ? '0' + hex : hex;
                    };
                    outlineColor = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
                  }

                  return (
                    <div
                      className="ai-suggestion-banner color-suggestion-banner"
                      style={{
                        borderColor: outlineColor,
                        borderWidth: '2px',
                        outline: `4px solid ${outlineColor}`,
                        outlineOffset: '2px'
                      }}
                    >
                      <div className="ai-suggestion-content">
                        <span className="ai-icon">{icon}</span>
                        <span className="ai-text">
                          {methodLabel} <strong>{suggestion.player}</strong>
                          {confidenceText}
                        </span>
                      </div>
                      <button
                        className="ai-confirm-btn"
                        disabled={confirmingMoveId === getMoveId(move)}
                        onClick={async (e) => {
                          e.stopPropagation();
                          setConfirmingMoveId(getMoveId(move));
                          await handleConfirmColorSuggestion(getMoveId(move));
                          setConfirmingMoveId(null);
                        }}
                      >
                        {confirmingMoveId === getMoveId(move) ? '...' : '✓ Confirm'}
                      </button>
                    </div>
                  );
                })()}

                <div
                  className="move-info-row player-row"
                  style={{
                    borderColor: move.player === 'Player A' ? colorA :
                      move.player === 'Player B' ? colorB :
                        move.player === 'None' ? '#9E9E9E' : '#FFC107'
                  }}
                >
                  <span className="label">Player:</span>
                  <div style={{ display: 'flex', gap: '8px', flex: 1, alignItems: 'center' }}>
                    <select
                      className={`player-select ${move.player?.toLowerCase().replace(' ', '-')}`}
                      value={move.player || 'Unknown'}
                      onChange={(e) => handlePlayerUpdate(getMoveId(move), e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        flex: 1,
                        borderColor: move.player === 'Player A' ? colorA :
                          move.player === 'Player B' ? colorB :
                            move.player === 'None' ? '#9E9E9E' : '#FFC107'
                      }}
                    >
                      <option value="Player A">Player A</option>
                      <option value="Player B">Player B</option>
                      <option value="None">None</option>
                      <option value="Unknown">Unknown</option>
                    </select>
                    {move.camera_frame && (
                      <button
                        className="ai-single-btn color-single-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleColorIdentifySingle(getMoveId(move));
                        }}
                        title="Identify this move by color"
                      >
                        🎨
                      </button>
                    )}
                  </div>
                </div>

                {(move.blockId !== null && move.blockId !== undefined) && (
                  <div className="move-info-row">
                    <span className="label">Block:</span>
                    <span className="value">{move.blockId}</span>
                  </div>
                )}

                {Array.isArray(move.position) && move.position.length === 2 && (
                  <div className="move-info-row">
                    <span className="label">Position:</span>
                    <span className="value">({move.position[0]}, {move.position[1]})</span>
                  </div>
                )}

                <div className="move-info-row">
                  <span className="label">Time:</span>
                  <span className="value">{formatNumber(move.elapsed, 1)}s</span>
                </div>

                {Number.isFinite(move.holdTime) && move.holdTime > 0 && (
                  <div className="move-info-row">
                    <span className="label">Hold:</span>
                    <span className="value">{formatNumber(move.holdTime, 2)}s</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {filteredMoves.length === 0 && (
          <div className="no-moves">
            <p>No moves found for selected filter.</p>
          </div>
        )}
      </div>

      {
        expandedImage && (
          <div className="image-modal" onClick={() => setExpandedImage(null)}>
            <div className="image-modal-content" onClick={(e) => e.stopPropagation()}>
              <button className="close-modal" onClick={() => setExpandedImage(null)}>✕</button>
              <img src={expandedImage} alt="Expanded view" />
            </div>
          </div>
        )
      }

      <ColorPreviewModal
        colorPreview={colorPreview}
        onClose={() => setColorPreview(null)}
      />

      {
        showManualSelector && manualSelectorFrame && (
          <ManualScanSelector
            frameDataUrl={manualSelectorFrame}
            onSave={(bounds) => {
              setManualScanBounds(bounds);
              setShowManualSelector(false);
            }}
            onCancel={() => {
              setShowManualSelector(false);
              setColorAnchor('bottom'); // Reset to default
              setManualSelectorFrame(null);
            }}
          />
        )
      }

      {/* SwipeView Modal */}
      {
        showSwipeView && (
          <SwipeView
            sessionGameId={sessionGameId}
            onClose={handleCloseSwipeView}
            initialFrames={swipeViewFrames}
            clusterColors={swipeViewClusterColors}
          />
        )
      }

      {/* Confirm Swap Modal */}
      <ConfirmSwapModal
        isOpen={showSwapModal}
        onConfirm={handleConfirmSwap}
        onCancel={handleCancelSwap}
        totalFrames={pendingSwapOperation?.confirmationInfo?.totalFrames || 0}
        totalBatches={pendingSwapOperation?.confirmationInfo?.totalBatches || 1}
        batchSize={pendingSwapOperation?.confirmationInfo?.batchSize || 600}
      />

      {showHelpModal && (
        <div
          className="move-editor-help-overlay"
          role="presentation"
          onClick={() => setShowHelpModal(false)}
        >
          <div
            id="move-editor-help-dialog"
            className="move-editor-help-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="move-editor-help-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="move-editor-help-close"
              onClick={() => setShowHelpModal(false)}
              aria-label="Close help"
            >
              ✕
            </button>
            <h2 id="move-editor-help-title" className="move-editor-help-title">
              How to use this editor
            </h2>
            <p className="move-editor-help-lead">
              Use the tools below the session title to suggest or fix who moved (Player A, Player B, etc.)
              for each saved camera frame. Your filters control which moves are included when you run a batch
              job.
            </p>

            <section className="move-editor-help-section">
              <h3>Identify All &amp; Identify Unknown</h3>
              <p>
                These run the <strong>All–All</strong> pipeline: the app segments each camera frame, clusters
                visual patterns across moves, and proposes Player A / B labels. It is the recommended first pass.
              </p>
              <ul>
                <li>
                  <strong>Identify All</strong> — runs on every filtered move that has a camera frame (respects
                  Practice / Experiment and player filters).
                </li>
                <li>
                  <strong>Identify Unknown</strong> — only moves that are still unlabeled or marked Unknown /
                  None, so you can refine without overwriting confident picks.
                </li>
              </ul>
              <p>
                After a run, review suggestions on the cards (and thresholds in the analytics strip when shown).
                Confirm suggestions individually or in bulk where offered.
              </p>
            </section>

            <section className="move-editor-help-section">
              <h3>Scan area — why it matters</h3>
              <p>
                Segmentation and color checks focus on a <strong>vertical band</strong> of the image (usually where
                hands and bracelets appear). If that band misses the hands, guesses get noisy.
              </p>
              <ul>
                <li>
                  <strong>General</strong> — uses a preset band from the <strong>Bottom</strong> or{' '}
                  <strong>Top</strong> of the frame. The <strong>percentage</strong> slider controls how tall that
                  band is (deeper into the frame when higher).
                </li>
                <li>
                  <strong>Manual</strong> — draw the band on a sample frame when participants sit off-center or the
                  camera angle is unusual. Use <strong>Change scan area</strong> to adjust it later.
                </li>
              </ul>
              <p>
                Set scan options <strong>before</strong> running Identify All / Unknown or the Cloth / Color tools,
                since they all reuse this region.
              </p>
            </section>

            <section className="move-editor-help-section">
              <h3>BG sensitivity</h3>
              <p>
                Controls how aggressively the model separates people / foreground from the background.{' '}
                <strong>Higher</strong> values keep more pixels as foreground (useful if bracelets look faint);{' '}
                <strong>lower</strong> values trim more aggressively if the mask is too noisy.
              </p>
            </section>

            <section className="move-editor-help-section">
              <h3>More methods</h3>
              <p>Advanced identification paths (same scan area as above).</p>
              <ul>
                <li>
                  <strong>Bracelet colors</strong> — hex picks for Player A and B, used by Cloth and Color runs
                  (defaults may load from session metadata).
                </li>
                <li>
                  <strong>Cloth (all / unknown)</strong> — groups clothing appearance across frames to suggest
                  players.
                </li>
                <li>
                  <strong>Color (all / unknown)</strong> — compares segmented regions to the bracelet colors.
                </li>
              </ul>
            </section>

            <section className="move-editor-help-section">
              <h3>Swipe View</h3>
              <p>
                Opens a swipe-based reviewer for frames that need attention — useful for quickly confirming or
                correcting labels with gestures.
              </p>
            </section>

            <section className="move-editor-help-section">
              <h3>Filters &amp; Swap A and B</h3>
              <ul>
                <li>
                  <strong>Practice / Experiment</strong> — limits which moves batch jobs and counts apply to.
                </li>
                <li>
                  <strong>Player filters</strong> — narrow the list; combined with Identify All / Unknown as
                  described above.
                </li>
                <li>
                  <strong>⇄ Swap A and B</strong> — permanently swaps every Player A assignment with Player B in
                  storage when the two players were labeled backwards.
                </li>
              </ul>
            </section>

            <section className="move-editor-help-section">
              <h3>Move cards</h3>
              <ul>
                <li>
                  Click a card image to enlarge it.
                </li>
                <li>
                  Use the <strong>player dropdown</strong> to fix a label manually; changes save to this session.
                </li>
                <li>
                  <strong>🎨</strong> on a card runs color-based identification for that single frame.
                </li>
              </ul>
            </section>

            <section className="move-editor-help-section move-editor-help-section--muted">
              <h3>Cloth debug (when visible)</h3>
              <p>
                After some Cloth runs you may see debug previews. <strong>Show on cards</strong> overlays them on
                thumbnails; <strong>Clear all</strong> removes previews from memory.
              </p>
            </section>

            <button type="button" className="move-editor-help-done" onClick={() => setShowHelpModal(false)}>
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default MoveHistoryEditor;

