/**
 * Swap Player A ↔ Player B for all moves (client-side session file).
 */

import { updateMovePlayersBatch, getMoveId } from '../services/localSessionStore.js';

const BATCH_SIZE = 600;

/**
 * @param {Object} params
 * @param {FileSystemDirectoryHandle} params.rootHandle - Data root from File System Access API
 * @param {string} params.sessionGameId
 * @param {Array} params.moves
 * @param {Function} [params.onProgress]
 */
export async function swapPlayersAB({ rootHandle, sessionGameId, moves, onProgress }) {
  if (!sessionGameId || !rootHandle) {
    throw new Error('Session ID and data folder are required');
  }

  if (!moves || !Array.isArray(moves)) {
    throw new Error('No moves available');
  }

  const movesToSwap = moves.filter(
    (move) => move.player === 'Player A' || move.player === 'Player B'
  );

  if (movesToSwap.length === 0) {
    throw new Error('No moves with Player A or Player B to swap');
  }

  const updates = movesToSwap.map((move) => ({
    moveId: getMoveId(move),
    player: move.player === 'Player A' ? 'Player B' : 'Player A'
  })).filter((u) => u.moveId);

  const totalBatches = Math.ceil(updates.length / BATCH_SIZE);

  const confirmationInfo = {
    totalFrames: updates.length,
    totalBatches,
    batchSize: BATCH_SIZE
  };

  return {
    confirmationInfo,
    execute: async () => {
      const results = {
        updatedCount: 0,
        notFoundIds: [],
        batches: [],
        updates
      };

      for (let i = 0; i < updates.length; i += BATCH_SIZE) {
        const batch = updates.slice(i, i + BATCH_SIZE);
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;

        if (onProgress) {
          onProgress(batchNumber, totalBatches);
        }

        try {
          const batchResult = await updateMovePlayersBatch(
            rootHandle,
            sessionGameId,
            batch
          );
          results.updatedCount += batchResult.updatedCount || 0;
          results.notFoundIds.push(...(batchResult.notFoundIds || []));
          results.batches.push({
            batchNumber,
            success: true,
            updatedCount: batchResult.updatedCount
          });
        } catch (err) {
          console.error(`[swapPlayersAB] Batch ${batchNumber} error:`, err);
          results.batches.push({
            batchNumber,
            success: false,
            error: err.message
          });
          throw err;
        }
      }

      return results;
    }
  };
}

export default { swapPlayersAB };
