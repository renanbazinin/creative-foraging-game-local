// Game logic ported from Python CreativeForaging_Source.py

const BLOCK_SIZE = 0.06; // Relative to screen height
const GRID_STEP = 0.07; // Grid spacing

export const createInitialBlocks = () => {
  const positions = [
    [-0.315, 0.0], [-0.245, 0.0], [-0.175, 0.0], [-0.105, 0.0], [-0.035, 0.0],
    [0.035, 0.0], [0.105, 0.0], [0.175, 0.0], [0.245, 0.0], [0.315, 0.0]
  ];

  return positions.map((pos, index) => ({
    id: index,
    position: [...pos],
    neighbors: [],
    canMove: false
  }));
};

export const round3 = (num) => Math.round(num * 1000) / 1000;

export const getAllowedPositions = (blocks, targetId) => {
  let allowed = [];

  // Get positions around each block (except the target)
  blocks.forEach(block => {
    if (block.id !== targetId) {
      const positions = [
        [round3(block.position[0] - GRID_STEP), round3(block.position[1])],
        [round3(block.position[0] + GRID_STEP), round3(block.position[1])],
        [round3(block.position[0]), round3(block.position[1] - GRID_STEP)],
        [round3(block.position[0]), round3(block.position[1] + GRID_STEP)]
      ];
      allowed.push(...positions);
    }
  });

  // Remove duplicates
  const uniqueSet = new Set(allowed.map(p => `${p[0]},${p[1]}`));
  allowed = Array.from(uniqueSet).map(s => s.split(',').map(Number));

  // Remove existing block positions
  const existingPositions = blocks.map(b => `${b.position[0]},${b.position[1]}`);
  allowed = allowed.filter(pos => !existingPositions.includes(`${pos[0]},${pos[1]}`));

  // Remove out of bounds positions
  // Bottom margin: reduce y-axis upper bound to prevent blocks in gallery area
  // With 120px bottom margin, we need to reduce the playable area proportionally
  // Assuming typical canvas height ~800px, 120px is ~15% of height, so reduce upper bound by ~0.15
  // Original: 0.49, reduced to ~0.42 to account for bottom margin
  allowed = allowed.filter(pos => 
    pos[0] < 0.735 && pos[0] > -0.735 &&
    pos[1] < 0.42 && pos[1] > -0.49  // Reduced upper bound to prevent blocks in gallery area
  );

  return allowed;
};

export const snapToAllowed = (allowedPositions, currentPos) => {
  if (allowedPositions.length === 0) return currentPos;

  // Find closest allowed position using KD-tree logic (simplified)
  let minDist = Infinity;
  let closestPos = allowedPositions[0];

  allowedPositions.forEach(pos => {
    const dist = Math.sqrt(
      Math.pow(pos[0] - currentPos[0], 2) + 
      Math.pow(pos[1] - currentPos[1], 2)
    );
    if (dist < minDist) {
      minDist = dist;
      closestPos = pos;
    }
  });

  return closestPos;
};

export const updateNeighbors = (blocks) => {
  return blocks.map(block => {
    const neighbors = [];
    const adjacentPositions = [
      [round3(block.position[0] - GRID_STEP), round3(block.position[1])],
      [round3(block.position[0] + GRID_STEP), round3(block.position[1])],
      [round3(block.position[0]), round3(block.position[1] - GRID_STEP)],
      [round3(block.position[0]), round3(block.position[1] + GRID_STEP)]
    ];

    blocks.forEach(otherBlock => {
      adjacentPositions.forEach(adjPos => {
        if (round3(otherBlock.position[0]) === adjPos[0] && 
            round3(otherBlock.position[1]) === adjPos[1]) {
          neighbors.push(otherBlock.position);
        }
      });
    });

    return { ...block, neighbors };
  });
};

export const isContiguous = (grid) => {
  // Find all filled positions
  const items = new Set();
  grid.forEach((row, x) => {
    row.forEach((cell, y) => {
      if (cell) items.add(`${x},${y}`);
    });
  });

  if (items.size === 0) return true;

  // BFS to check if all items are connected
  const directions = [[0, 1], [1, 0], [-1, 0], [0, -1]];
  const firstItem = Array.from(items)[0].split(',').map(Number);
  const visited = new Set();
  const queue = [firstItem];

  while (queue.length > 0) {
    const [x, y] = queue.shift();
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

export const prepareMatrix = (positions, excludeIndex) => {
  // Create coordinate arrays
  const xCoords = [];
  for (let x = -0.945; x <= 1.015; x += GRID_STEP) {
    xCoords.push(round3(x));
  }
  
  const yCoords = [];
  for (let y = -0.7; y < 0; y += GRID_STEP) {
    yCoords.push(round3(y));
  }
  for (let y = 0; y <= 0.77; y += GRID_STEP) {
    yCoords.push(round3(y));
  }

  // Create grid
  const grid = Array(yCoords.length).fill(null).map(() => 
    Array(xCoords.length).fill(false)
  );

  // Fill grid with positions (excluding the target)
  positions.forEach((pos, idx) => {
    if (idx !== excludeIndex) {
      const xIdx = xCoords.findIndex(x => Math.abs(x - pos[0]) < 0.001);
      const yIdx = yCoords.findIndex(y => Math.abs(y - pos[1]) < 0.001);
      if (xIdx !== -1 && yIdx !== -1) {
        grid[yIdx][xIdx] = true;
      }
    }
  });

  return isContiguous(grid);
};

export const updateCanMove = (blocks, isPractice) => {
  const positions = blocks.map(b => b.position);
  
  return blocks.map((block, idx) => {
    const canMove = prepareMatrix(positions, idx);
    return {
      ...block,
      canMove,
      color: isPractice ? (canMove ? 'blue' : 'green') : 'green'
    };
  });
};

export const resetPositions = (positions) => {
  if (positions.length === 0) return null;

  try {
    // Calculate centroid
    const xs = positions.map(p => p[0]);
    const ys = positions.map(p => p[1]);
    const centroidX = (Math.max(...xs) + Math.min(...xs)) / 2;
    const centroidY = (Math.max(...ys) + Math.min(...ys)) / 2;

    // Find closest node to centroid
    let minDist = Infinity;
    let closestNode = positions[0];
    positions.forEach(pos => {
      const dist = Math.sqrt(
        Math.pow(pos[0] - centroidX, 2) + 
        Math.pow(pos[1] - centroidY, 2)
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
    const normalized = positions.map(pos => [
      round3(pos[0] + diffX),
      round3(pos[1] + diffY)
    ]);

    normalized.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return normalized;
  } catch (e) {
    return null;
  }
};
