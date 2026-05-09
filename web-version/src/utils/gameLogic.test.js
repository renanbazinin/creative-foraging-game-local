import { describe, it, expect } from 'vitest';
import { createInitialBlocks, updateNeighbors, updateCanMove } from './gameLogic.js';

describe('gameLogic', () => {
  it('creates ten blocks in a row', () => {
    const blocks = createInitialBlocks();
    expect(blocks).toHaveLength(10);
    expect(blocks[0].canMove).toBe(false);
  });

  it('computes movable blocks in practice mode', () => {
    let blocks = createInitialBlocks();
    blocks = updateNeighbors(blocks);
    blocks = updateCanMove(blocks, true);
    const movable = blocks.filter((b) => b.canMove);
    expect(movable.length).toBeGreaterThan(0);
    expect(movable.every((b) => !b.canMove || b.color === 'blue')).toBe(true);
  });
});
