import { describe, it, expect } from 'vitest';
import {
  createInitialBlocks,
  round3,
  getAllowedPositions,
  snapToAllowed,
  updateNeighbors,
  isContiguous,
  prepareMatrix,
  updateCanMove,
  resetPositions,
  type Position,
} from './gameLogic';

describe('round3', () => {
  it('rounds to three decimal places', () => {
    expect(round3(0.1234)).toBe(0.123);
    expect(round3(0.1236)).toBe(0.124);
    expect(round3(1 / 3)).toBe(0.333);
    expect(round3(-0.035)).toBe(-0.035);
  });
});

describe('createInitialBlocks', () => {
  it('creates a symmetric horizontal row of ten blocks', () => {
    const blocks = createInitialBlocks();
    expect(blocks).toHaveLength(10);
    expect(blocks.map((b) => b.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(blocks.every((b) => b.position[1] === 0)).toBe(true);
    expect(blocks.every((b) => b.neighbors.length === 0 && b.canMove === false)).toBe(true);
    // Symmetric about the origin.
    expect(blocks[0].position[0]).toBeCloseTo(-blocks[9].position[0], 6);
  });

  it('returns independent position arrays (no shared references)', () => {
    const blocks = createInitialBlocks();
    blocks[0].position[0] = 99;
    expect(createInitialBlocks()[0].position[0]).not.toBe(99);
  });
});

describe('getAllowedPositions', () => {
  const blocks = createInitialBlocks();

  it('returns non-empty allowed positions for the initial row', () => {
    const allowed = getAllowedPositions(blocks, 0);
    expect(allowed.length).toBeGreaterThan(0);
  });

  it('includes the free cells just past each end of the row', () => {
    // Use a middle target so both endpoints still contribute their neighbour cells
    // (a block never generates positions around itself when it is the target).
    const allowed = getAllowedPositions(blocks, 5);
    expect(allowed).toContainEqual([-0.385, 0]);
    expect(allowed).toContainEqual([0.385, 0]);
    // Cells directly above/below a block are also free.
    expect(allowed).toContainEqual([-0.315, 0.07]);
  });

  it('never returns a cell already occupied by a block', () => {
    const allowed = getAllowedPositions(blocks, 0);
    const occupied = new Set(blocks.map((b) => `${b.position[0]},${b.position[1]}`));
    allowed.forEach((p) => expect(occupied.has(`${p[0]},${p[1]}`)).toBe(false));
  });

  it('keeps every allowed cell inside the playfield bounds', () => {
    const allowed = getAllowedPositions(blocks, 3);
    allowed.forEach(([x, y]) => {
      expect(x).toBeLessThan(0.735);
      expect(x).toBeGreaterThan(-0.735);
      expect(y).toBeLessThan(0.42);
      expect(y).toBeGreaterThan(-0.49);
    });
  });
});

describe('snapToAllowed', () => {
  const allowed: Position[] = [
    [0, 0],
    [1, 0],
    [0, 1],
  ];

  it('snaps to the nearest allowed position', () => {
    expect(snapToAllowed(allowed, [0.9, 0.1])).toEqual([1, 0]);
    expect(snapToAllowed(allowed, [0.1, 0.9])).toEqual([0, 1]);
    expect(snapToAllowed(allowed, [0.05, 0.05])).toEqual([0, 0]);
  });

  it('returns the current position when there are no allowed positions', () => {
    expect(snapToAllowed([], [0.42, -0.13])).toEqual([0.42, -0.13]);
  });
});

describe('updateNeighbors', () => {
  it('links each block to its horizontal neighbours', () => {
    const blocks = updateNeighbors(createInitialBlocks());
    // Ends have one neighbour, interior blocks have two.
    expect(blocks[0].neighbors).toHaveLength(1);
    expect(blocks[9].neighbors).toHaveLength(1);
    expect(blocks[5].neighbors).toHaveLength(2);
    // A block is never its own neighbour.
    blocks.forEach((b) => {
      b.neighbors.forEach((n) => expect(n).not.toEqual(b.position));
    });
  });
});

describe('isContiguous', () => {
  it('treats an empty grid as contiguous', () => {
    expect(isContiguous([])).toBe(true);
    expect(isContiguous([[false, false], [false, false]])).toBe(true);
  });

  it('accepts a single filled cell', () => {
    expect(isContiguous([[true, false], [false, false]])).toBe(true);
  });

  it('accepts a connected L-shape', () => {
    // filled: (0,0) (0,1) (1,1)
    expect(isContiguous([[true, true], [false, true]])).toBe(true);
  });

  it('rejects diagonally-disconnected cells', () => {
    // filled: (0,0) (1,1) — not 4-connected
    expect(isContiguous([[true, false], [false, true]])).toBe(false);
  });
});

describe('prepareMatrix / updateCanMove', () => {
  it('only the two end blocks of a straight row are movable', () => {
    const positions = createInitialBlocks().map((b) => b.position);
    // Removing an end keeps the rest connected; removing the middle splits it.
    expect(prepareMatrix(positions, 0)).toBe(true);
    expect(prepareMatrix(positions, 9)).toBe(true);
    expect(prepareMatrix(positions, 5)).toBe(false);
  });

  it('updateCanMove marks exactly the endpoints and colours them in practice', () => {
    const blocks = updateCanMove(createInitialBlocks(), true);
    const movableIds = blocks.filter((b) => b.canMove).map((b) => b.id).sort((a, b) => a - b);
    expect(movableIds).toEqual([0, 9]);
    expect(blocks[0].color).toBe('blue');
    expect(blocks[5].color).toBe('green');
  });

  it('updateCanMove colours everything green outside practice mode', () => {
    const blocks = updateCanMove(createInitialBlocks(), false);
    expect(blocks.every((b) => b.color === 'green')).toBe(true);
    // canMove is still computed the same way regardless of colouring.
    expect(blocks.filter((b) => b.canMove).map((b) => b.id).sort((a, b) => a - b)).toEqual([0, 9]);
  });
});

describe('resetPositions', () => {
  it('returns null for an empty list', () => {
    expect(resetPositions([])).toBeNull();
  });

  it('recentres the shape on its closest-to-centroid node and sorts it', () => {
    const positions = createInitialBlocks().map((b) => b.position);
    const reset = resetPositions(positions)!;
    expect(reset).toHaveLength(10);
    // Sorted ascending by x then y.
    for (let i = 1; i < reset.length; i++) {
      expect(reset[i][0] >= reset[i - 1][0]).toBe(true);
    }
    // The node nearest the centroid lands on the origin.
    expect(reset).toContainEqual([0, 0]);
    expect(reset[0][0]).toBeCloseTo(-0.28, 6);
    expect(reset[9][0]).toBeCloseTo(0.35, 6);
  });

  it('is idempotent-ish: re-centring an already-centred shape is stable', () => {
    const once = resetPositions(createInitialBlocks().map((b) => b.position))!;
    const twice = resetPositions(once)!;
    expect(twice).toEqual(once);
  });
});
