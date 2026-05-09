// Game logic ported from Python CreativeForaging_Source.py

const GRID_STEP = 0.07; // Grid spacing

export type Position = [number, number];

export interface Block {
  id: number;
  position: Position;
  neighbors: Position[];
  canMove: boolean;
  color?: string;
}

export const createInitialBlocks = (): Block[] => {
  const positions: Position[] = [
    [-0.315, 0.0],
    [-0.245, 0.0],
    [-0.175, 0.0],
    [-0.105, 0.0],
    [-0.035, 0.0],
    [0.035, 0.0],
    [0.105, 0.0],
    [0.175, 0.0],
    [0.245, 0.0],
    [0.315, 0.0],
  ];

  return positions.map((pos, index) => ({
    id: index,
    position: [...pos] as Position,
    neighbors: [],
    canMove: false,
  }));
};

export const round3 = (num: number): number => Math.round(num * 1000) / 1000;

export const getAllowedPositions = (blocks: Block[], targetId: number): Position[] => {
  let allowed: Position[] = [];

  // Get positions around each block (except the target)
  blocks.forEach((block) => {
    if (block.id !== targetId) {
      const positions: Position[] = [
        [round3(block.position[0] - GRID_STEP), round3(block.position[1])],
        [round3(block.position[0] + GRID_STEP), round3(block.position[1])],
        [round3(block.position[0]), round3(block.position[1] - GRID_STEP)],
        [round3(block.position[0]), round3(block.position[1] + GRID_STEP)],
      ];
      allowed.push(...positions);
    }
  });

  // Remove duplicates
  const uniqueSet = new Set(allowed.map((p) => `${p[0]},${p[1]}`));
  allowed = Array.from(uniqueSet).map((s) => s.split(',').map(Number) as Position);

  // Remove existing block positions
  const existingPositions = blocks.map((b) => `${b.position[0]},${b.position[1]}`);
  allowed = allowed.filter((pos) => !existingPositions.includes(`${pos[0]},${pos[1]}`));

  // Remove out of bounds positions
  // Bottom margin: reduce y-axis upper bound to prevent blocks in gallery area
  // With 120px bottom margin, we need to reduce the playable area proportionally
  // Assuming typical canvas height ~800px, 120px is ~15% of height, so reduce upper bound by ~0.15
  // Original: 0.49, reduced to ~0.42 to account for bottom margin
  allowed = allowed.filter(
    (pos) =>
      pos[0] < 0.735 &&
      pos[0] > -0.735 &&
      pos[1] < 0.42 &&
      pos[1] > -0.49, // Reduced upper bound to prevent blocks in gallery area
  );

  return allowed;
};

export const snapToAllowed = (allowedPositions: Position[], currentPos: Position): Position => {
  if (allowedPositions.length === 0) return currentPos;

  // Find closest allowed position using KD-tree logic (simplified)
  let minDist = Infinity;
  let closestPos = allowedPositions[0];

  allowedPositions.forEach((pos) => {
    const dist = Math.sqrt(
      Math.pow(pos[0] - currentPos[0], 2) + Math.pow(pos[1] - currentPos[1], 2),
    );
    if (dist < minDist) {
      minDist = dist;
      closestPos = pos;
    }
  });

  return closestPos;
};

export const updateNeighbors = (blocks: Block[]): Block[] => {
  return blocks.map((block) => {
    const neighbors: Position[] = [];
    const adjacentPositions: Position[] = [
      [round3(block.position[0] - GRID_STEP), round3(block.position[1])],
      [round3(block.position[0] + GRID_STEP), round3(block.position[1])],
      [round3(block.position[0]), round3(block.position[1] - GRID_STEP)],
      [round3(block.position[0]), round3(block.position[1] + GRID_STEP)],
    ];

    blocks.forEach((otherBlock) => {
      adjacentPositions.forEach((adjPos) => {
        if (
          round3(otherBlock.position[0]) === adjPos[0] &&
          round3(otherBlock.position[1]) === adjPos[1]
        ) {
          neighbors.push(otherBlock.position);
        }
      });
    });

    return { ...block, neighbors };
  });
};

export const isContiguous = (grid: boolean[][]): boolean => {
  // Find all filled positions
  const items = new Set<string>();
  grid.forEach((row, x) => {
    row.forEach((cell, y) => {
      if (cell) items.add(`${x},${y}`);
    });
  });

  if (items.size === 0) return true;

  // BFS to check if all items are connected
  const directions: [number, number][] = [
    [0, 1],
    [1, 0],
    [-1, 0],
    [0, -1],
  ];
  const firstKey = Array.from(items)[0];
  const firstItem = firstKey.split(',').map(Number) as [number, number];
  const visited = new Set<string>();
  const queue: [number, number][] = [firstItem];

  while (queue.length > 0) {
    const item = queue.shift();
    if (item === undefined) continue;
    const [x, y] = item;
    const key = `${x},${y}`;

    if (visited.has(key)) continue;
    visited.add(key);

    directions.forEach(([dx, dy]) => {
      const newKey = `${x + dx},${y + dy}`;
      if (items.has(newKey) && !visited.has(newKey)) {
        queue.push([x + dx, y + dy]);
      }
    });
  }

  return visited.size === items.size;
};

export const prepareMatrix = (positions: Position[], excludeIndex: number): boolean => {
  // Create coordinate arrays
  const xCoords: number[] = [];
  for (let x = -0.945; x <= 1.015; x += GRID_STEP) {
    xCoords.push(round3(x));
  }

  const yCoords: number[] = [];
  for (let y = -0.7; y < 0; y += GRID_STEP) {
    yCoords.push(round3(y));
  }
  for (let y = 0; y <= 0.77; y += GRID_STEP) {
    yCoords.push(round3(y));
  }

  // Create grid
  const grid = Array(yCoords.length)
    .fill(null)
    .map(() => Array(xCoords.length).fill(false) as boolean[]);

  // Fill grid with positions (excluding the target)
  positions.forEach((pos, idx) => {
    if (idx !== excludeIndex) {
      const xIdx = xCoords.findIndex((xc) => Math.abs(xc - pos[0]) < 0.001);
      const yIdx = yCoords.findIndex((yc) => Math.abs(yc - pos[1]) < 0.001);
      if (xIdx !== -1 && yIdx !== -1) {
        grid[yIdx][xIdx] = true;
      }
    }
  });

  return isContiguous(grid);
};

export const updateCanMove = (blocks: Block[], isPractice: boolean): Block[] => {
  const positions = blocks.map((b) => b.position);

  return blocks.map((block, idx) => {
    const canMove = prepareMatrix(positions, idx);
    return {
      ...block,
      canMove,
      color: isPractice ? (canMove ? 'blue' : 'green') : 'green',
    };
  });
};

export const resetPositions = (positions: Position[]): Position[] | null => {
  if (positions.length === 0) return null;

  try {
    // Calculate centroid
    const xs = positions.map((p) => p[0]);
    const ys = positions.map((p) => p[1]);
    const centroidX = (Math.max(...xs) + Math.min(...xs)) / 2;
    const centroidY = (Math.max(...ys) + Math.min(...ys)) / 2;

    // Find closest node to centroid
    let minDist = Infinity;
    let closestNode = positions[0];
    positions.forEach((pos) => {
      const dist = Math.sqrt(
        Math.pow(pos[0] - centroidX, 2) + Math.pow(pos[1] - centroidY, 2),
      );
      if (dist < minDist) {
        minDist = dist;
        closestNode = pos;
      }
    });

    // Calculate difference to center
    const diffX = -closestNode[0];
    const diffY = -closestNode[1];

    // Move all positions
    const normalized = positions.map(
      (pos) => [round3(pos[0] + diffX), round3(pos[1] + diffY)] as Position,
    );

    normalized.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return normalized;
  } catch {
    return null;
  }
};
