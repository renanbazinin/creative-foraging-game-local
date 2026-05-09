/**
 * Game Tracker Utility
 * Tracks game moves with bracelet detection to determine which player made each move
 * Persists sessions and moves to the user-chosen local folder (File System Access API).
 */

import {
  getActiveDataRoot,
  upsertSession,
  appendMove
} from '../services/localSessionStore.js';

const GRID_UNIT = 0.035; // Half-step of GRID_STEP (0.07) to represent the playable lattice

class GameTracker {
  constructor() {
    this.startTime = Date.now();
    this.moves = [];
    this.braceletHistory = []; // Store bracelet detection status over time
    this.isTracking = false;
    this.trackingWindow = 1000; // 1 second window for lost tracking
    this.lastKnownPlayer = null; // Track last known player (A or B) for fallback
    this.sessionInfo = null;
    this.sessionInitialized = false;
    
    // Listen to bracelet detection status from localStorage or events
    this.setupBraceletListener();
  }

  /**
   * Setup listener for bracelet detection status changes
   * The BraceletDetector component updates status, we'll poll or listen to it
   */
  setupBraceletListener() {
    // Poll bracelet detection status every 100ms
    this.braceletInterval = setInterval(() => {
      this.recordBraceletStatus();
    }, 100);
  }

  /**
   * Record current bracelet detection status
   */
  recordBraceletStatus() {
    if (!this.isTracking) return;
    
    const timestamp = Date.now();
    const elapsed = (timestamp - this.startTime) / 1000;
    
    // Get current status from BraceletDetector component
    const status = this.getCurrentBraceletStatus();
    
    // Update last known player if we have a valid status
    if (status === 'Player A' || status === 'Player B') {
      this.lastKnownPlayer = status;
      // Also update the most recent history entry if it exists and was 'None' or 'Unknown'
      if (this.braceletHistory.length > 0) {
        const lastEntry = this.braceletHistory[this.braceletHistory.length - 1];
        // If last entry was very recent (within 200ms) and was 'None' or 'Unknown', update it
        if (timestamp - lastEntry.timestamp < 200 && (lastEntry.status === 'None' || lastEntry.status === 'Unknown')) {
          lastEntry.status = status;
          lastEntry.timestamp = timestamp;
          return; // Don't add duplicate entry
        }
      }
    }
    
    this.braceletHistory.push({
      timestamp,
      elapsed,
      status
    });
    
    // Keep only last 10 seconds of history (to save memory)
    const tenSecondsAgo = timestamp - 10000;
    this.braceletHistory = this.braceletHistory.filter(h => h.timestamp >= tenSecondsAgo);
  }

  /**
   * Get current bracelet status
   * This will be updated by the BraceletDetector component
   */
  getCurrentBraceletStatus() {
    // Check if there's a custom event or storage mechanism
    // For now, we'll use a custom event system
    if (window.currentBraceletStatus) {
      return window.currentBraceletStatus;
    }
    return 'None';
  }

  /**
   * Set session info and initialize session in local folder
   */
  async setSessionInfo(info = {}) {
    // Get calibration colors
    const { colorA, colorB } = this.getCalibrationColors();
    
    this.sessionInfo = {
      ...info,
      colorA: colorA,
      colorB: colorB,
      startedAt: this.sessionInfo?.startedAt || new Date(this.startTime).toISOString()
    };
    
    console.log('[GameTracker] Session info set with colors:', { colorA, colorB });
    
    await this.initializeSession();
  }

  /**
   * Convert HSV calibration to hex color
   * @param {Object} calib - {h, s, v} where h is 0-180, s and v are 0-255
   * @returns {string} Hex color like "#FF0000"
   */
  hsvToHex(calib) {
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
  }

  /**
   * Get calibration colors from localStorage
   * @returns {Object} {colorA: string, colorB: string} or {colorA: null, colorB: null}
   */
  getCalibrationColors() {
    try {
      const calibA = JSON.parse(localStorage.getItem('calibrationA') || 'null');
      const calibB = JSON.parse(localStorage.getItem('calibrationB') || 'null');
      
      return {
        colorA: this.hsvToHex(calibA),
        colorB: this.hsvToHex(calibB)
      };
    } catch (error) {
      console.warn('[GameTracker] Error reading calibration colors:', error);
      return { colorA: null, colorB: null };
    }
  }

  /**
   * Initialize session file on disk
   */
  async initializeSession() {
    if (this.sessionInitialized || !this.sessionInfo?.sessionGameId) {
      return;
    }

    const root = getActiveDataRoot();
    if (!root) {
      const msg = 'No data folder is connected. Go back and choose a folder in the start dialog.';
      console.error('[GameTracker]', msg);
      throw new Error(msg);
    }

    const { colorA, colorB } = this.getCalibrationColors();

    const payload = {
      sessionGameId: this.sessionInfo.sessionGameId,
      subjectId: this.sessionInfo.id,
      condition: this.sessionInfo.condition,
      date: this.sessionInfo.date,
      timeSeconds: this.sessionInfo.timeSeconds,
      colorA: colorA,
      colorB: colorB,
      metadata: {
        config: this.sessionInfo
      }
    };

    console.log('[GameTracker] Initializing local session with colors:', { colorA, colorB });

    try {
      await upsertSession(root, payload);
      this.sessionInitialized = true;
      console.log('[GameTracker] Session initialized locally:', this.sessionInfo.sessionGameId);
    } catch (error) {
      if (error.status === 409) {
        alert(
          `⚠️ Session ID Conflict\n\n${error.message}\n\nPlease choose a different Session ID.`
        );
        this.stop();
      }
      console.error('[GameTracker] Failed to initialize session:', error);
      throw error;
    }
  }

  /**
   * Start tracking
   */
  start() {
    this.isTracking = true;
    this.startTime = Date.now();
    this.moves = [];
    this.braceletHistory = [];
    if (this.sessionInfo) {
      this.sessionInfo.startedAt = new Date(this.startTime).toISOString();
    }
  }

  /**
   * Stop tracking
   */
  stop() {
    this.isTracking = false;
    if (this.braceletInterval) {
      clearInterval(this.braceletInterval);
    }
  }

  /**
   * Convert relative position to discrete grid coordinates (x, y)
   * GRID_UNIT (0.035) represents half-step increments so we capture every snap node.
   */
  relativeToGrid(relativePos) {
    if (!relativePos) return null;
    const toGrid = (value) => {
      const scaled = value / GRID_UNIT;
      const rounded = Math.round(scaled);
      return Math.max(-20, Math.min(20, rounded));
    };
    return [toGrid(relativePos[0]), toGrid(relativePos[1])];
  }

  /**
   * Record a move with player attribution and persist to server
   * @param {Object} moveData - Move information
   * @param {number} holdTime - Time in seconds the player held the block
   * @param {string|null} cameraFrame - Base64 encoded camera frame image (optional)
   */
  async recordMove(moveData, holdTime = 0, cameraFrame = null) {
    if (!this.isTracking) return;

    const timestamp = Date.now();
    const elapsed = (timestamp - this.startTime) / 1000;
    
    // Determine which player made the move (use provided player or determine from bracelet)
    const player = moveData.player || this.determinePlayer(timestamp);
    
    // Convert positions to grid coordinates, prefer precomputed grid data
    const gridPosition =
      moveData.grid_end_position ??
      (moveData.end_position ? this.relativeToGrid(moveData.end_position) : null);
    
    const allGridPositions =
      moveData.grid_all_positions ??
      (moveData.all_positions
        ? moveData.all_positions.map(pos => this.relativeToGrid(pos))
        : null);
    
    const moveId = crypto.randomUUID();

    const move = {
      moveId,
      timestamp,
      elapsed,
      player,
      holdTime, // Time player held the block before dropping
      blockId: moveData.unit,
      position: gridPosition, // Final position as (x, y) grid coordinates
      allPositions: allGridPositions, // All block positions as grid coordinates
      phase: moveData.phase,
      type: moveData.type,
      subjectId: moveData.id,
      sessionGameId: moveData.sessionGameId,
      condition: moveData.condition,
      date: moveData.date,
      // Keep original data for compatibility
      end_position: moveData.end_position,
      all_positions: moveData.all_positions,
      grid_end_position: gridPosition,
      grid_all_positions: allGridPositions
    };
    
    // Add camera frame if provided
    if (cameraFrame || moveData.camera_frame) {
      move.camera_frame = cameraFrame || moveData.camera_frame;
    }
    
    // Add gallery info if present
    if (moveData.gallery_shape_number !== undefined) {
      move.gallery_shape_number = moveData.gallery_shape_number;
      move.gallery = moveData.gallery;
      move.gallery_normalized = moveData.gallery_normalized;
      move.grid_gallery = moveData.grid_gallery ?? (moveData.gallery ? moveData.gallery.map(pos => this.relativeToGrid(pos)) : null);
      move.grid_gallery_normalized = moveData.grid_gallery_normalized ?? (moveData.gallery_normalized ? moveData.gallery_normalized.map(pos => this.relativeToGrid(pos)) : null);
    }
    
    this.moves.push(move);
    
    // Persist move to server
    this.persistMove(move).catch(error => {
      console.error('[GameTracker] Failed to persist move to server:', error);
    });
    
    // Debug log: print what was saved
    const currentStatusDebug = this.getCurrentBraceletStatus();
    const lastKnownDebug = this.lastKnownPlayer;
    console.log('[GameTracker] Move recorded:', {
      player,
      blockId: moveData.unit,
      position: gridPosition,
      holdTime: holdTime.toFixed(2) + 's',
      elapsed: elapsed.toFixed(2) + 's',
      phase: moveData.phase,
      debug: {
        currentStatus: currentStatusDebug,
        lastKnownPlayer: lastKnownDebug,
        historyLength: this.braceletHistory.length,
        recentHistory: this.braceletHistory.slice(-5).map(h => ({ status: h.status, elapsed: h.elapsed.toFixed(2) }))
      }
    });
  }

  /**
   * Persist a single move to the local session file
   */
  async persistMove(move) {
    if (!this.sessionInitialized || !this.sessionInfo?.sessionGameId) {
      console.warn('[GameTracker] Cannot persist move - session not initialized');
      return;
    }

    const root = getActiveDataRoot();
    if (!root) {
      console.error('[GameTracker] No data folder — cannot persist move');
      return;
    }

    try {
      const result = await appendMove(root, this.sessionInfo.sessionGameId, move);
      console.log('[GameTracker] Move persisted locally:', result?.moveId);
      return result;
    } catch (error) {
      console.error('[GameTracker] persistMove error:', error);
      throw error;
    }
  }

  /**
   * Determine which player made a move at a given timestamp
   * Uses 1-second time window if we lost track at the exact moment
   * Falls back to last known player if tracking is lost
   */
  determinePlayer(timestamp) {
    // First, check current status directly from BraceletDetector (most recent)
    const currentStatus = this.getCurrentBraceletStatus();
    if (currentStatus === 'Player A' || currentStatus === 'Player B') {
      // If we have a valid current status, use it (it's the most recent)
      return currentStatus;
    }
    
    // Look for bracelet status at the exact timestamp in history
    let statusAtTime = this.findStatusAtTime(timestamp);
    
    // If we have a valid status at the exact time, use it
    if (statusAtTime && (statusAtTime.status === 'Player A' || statusAtTime.status === 'Player B')) {
      return statusAtTime.status;
    }
    
    // If no status found, check within 1 second window (before and after)
    const windowStart = timestamp - this.trackingWindow;
    const windowEnd = timestamp + this.trackingWindow;
    
    const statusesInWindow = this.braceletHistory.filter(
      h => h.timestamp >= windowStart && h.timestamp <= windowEnd
    );
    
    if (statusesInWindow.length > 0) {
      // Find most common status in window (excluding 'None')
      const statusCounts = {};
      statusesInWindow.forEach(h => {
        if (h.status === 'Player A' || h.status === 'Player B') {
          statusCounts[h.status] = (statusCounts[h.status] || 0) + 1;
        }
      });
      
      const mostCommon = Object.keys(statusCounts).reduce((a, b) => 
        statusCounts[a] > statusCounts[b] ? a : b, null
      );
      
      if (mostCommon) {
        return mostCommon;
      }
    }
    
    // Fallback: use last known player if we lost track
    if (this.lastKnownPlayer) {
      return this.lastKnownPlayer;
    }
    
    // Last resort: return current status even if it's 'None' (better than Unknown)
    return currentStatus !== 'None' ? currentStatus : 'Unknown';
  }

  /**
   * Find bracelet status at a specific timestamp
   */
  findStatusAtTime(timestamp) {
    if (this.braceletHistory.length === 0) return null;
    
    // Find closest status to timestamp (prefer recent entries)
    let closest = null;
    let minDiff = Infinity;
    
    for (const entry of this.braceletHistory) {
      const diff = Math.abs(entry.timestamp - timestamp);
      // Prefer entries before the timestamp (what was happening when move occurred)
      // But also accept entries slightly after (within 500ms)
      if (diff < minDiff && diff <= 1000) {
        minDiff = diff;
        closest = entry;
      }
    }
    
    return closest;
  }

  /**
   * Export game data to JSON
   */
  exportToJSON() {
    const gameData = {
      startTime: new Date(this.startTime).toISOString(),
      endTime: new Date().toISOString(),
      duration: (Date.now() - this.startTime) / 1000,
      sessionInfo: this.sessionInfo,
      moves: this.moves,
      braceletHistory: this.braceletHistory,
      summary: {
        totalMoves: this.moves.length,
        movesByPlayer: this.getMovesByPlayer(),
        movesByPhase: this.getMovesByPhase()
      }
    };
    
    return JSON.stringify(gameData, null, 2);
  }

  /**
   * Get moves grouped by player
   */
  getMovesByPlayer() {
    const counts = {};
    this.moves.forEach(move => {
      counts[move.player] = (counts[move.player] || 0) + 1;
    });
    return counts;
  }

  /**
   * Get moves grouped by phase
   */
  getMovesByPhase() {
    const counts = {};
    this.moves.forEach(move => {
      const phase = move.phase || 'unknown';
      counts[phase] = (counts[phase] || 0) + 1;
    });
    return counts;
  }



  /**
   * Load game data from JSON
   */
  static loadFromJSON(jsonString) {
    try {
      return JSON.parse(jsonString);
    } catch (e) {
      console.error('Failed to parse game JSON:', e);
      return null;
    }
  }
}

// Create singleton instance
let gameTrackerInstance = null;

export const getGameTracker = () => {
  if (!gameTrackerInstance) {
    gameTrackerInstance = new GameTracker();
  }
  return gameTrackerInstance;
};

export default GameTracker;

