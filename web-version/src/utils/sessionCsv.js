/**
 * Moves CSV — same stable column ordering as the **legacy project** (old server + Admin downloads),
 * not a raw database dump. Used for `session.csv` in each experiment folder and Admin downloads.
 * Input: object with a `moves` array (flat session doc or Summary-shaped Admin view).
 */

/** Column order compatible with legacy pipeline exports and older analysis scripts. */
export const LEGACY_EXPORT_CSV_COLUMNS = [
  'timestamp',
  'elapsed',
  'player',
  'holdTime',
  'blockId',
  'position',
  'allPositions',
  'phase',
  'type',
  'subjectId',
  'sessionGameId',
  'condition',
  'date',
  'end_position',
  'all_positions',
  'grid_end_position',
  'grid_all_positions',
  'gallery_shape_number',
  'gallery',
  'gallery_normalized',
  'grid_gallery',
  'grid_gallery_normalized',
  'moveId',
  '_id'
];

function cellForCsvColumn(move, key) {
  if (key === '_id') {
    const v = move._id ?? move.moveId;
    if (v === null || v === undefined || v === '') return '';
    return v;
  }
  return move[key];
}

export function sessionDocumentToMovesCsv(sessionData) {
  const moves = sessionData?.moves;
  if (!Array.isArray(moves) || moves.length === 0) {
    return '';
  }

  const allKeys = new Set();
  moves.forEach((move) => {
    Object.keys(move).forEach((key) => {
      if (key !== 'camera_frame' && key !== '__v') {
        allKeys.add(key);
      }
    });
  });

  const ordered = [];
  for (const col of LEGACY_EXPORT_CSV_COLUMNS) {
    if (col === '_id') {
      if (allKeys.has('_id') || allKeys.has('moveId')) ordered.push('_id');
      continue;
    }
    if (allKeys.has(col)) ordered.push(col);
  }

  const extras = [...allKeys].filter((k) => !ordered.includes(k) && k !== 'moveId').sort();

  const headers = [...ordered, ...extras];
  const rows = [headers.join(',')];

  moves.forEach((move) => {
    const row = headers.map((key) => {
      const value = cellForCsvColumn(move, key);
      if (value === null || value === undefined || value === '') {
        return '';
      }
      if (Array.isArray(value) || (typeof value === 'object' && value.constructor === Object)) {
        return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
      }
      return `"${String(value).replace(/"/g, '""')}"`;
    });
    rows.push(row.join(','));
  });

  return rows.join('\n');
}

/**
 * Parse CSV text into rows of string cells (RFC4180-style quoted fields).
 */
export function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let i = 0;
  let inQuotes = false;
  const s = String(text ?? '').replace(/^\uFEFF/, '');
  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      row.push(cell);
      cell = '';
      i += 1;
      continue;
    }
    if (c === '\r') {
      i += 1;
      continue;
    }
    if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
      continue;
    }
    cell += c;
    i += 1;
  }
  row.push(cell);
  rows.push(row);

  while (rows.length > 0) {
    const last = rows[rows.length - 1];
    if (last.length === 1 && last[0] === '') rows.pop();
    else break;
  }

  return rows;
}

function coerceCsvCell(str) {
  const t = String(str ?? '').trim();
  if (t === '') return '';
  if (t.startsWith('[') || t.startsWith('{')) {
    try {
      return JSON.parse(t);
    } catch {
      return t;
    }
  }
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t)) return Number(t);
  if (t === 'true') return true;
  if (t === 'false') return false;
  return t;
}

/**
 * Parse legacy-project moves CSV into a minimal flat session object (for import when JSON is absent).
 */
export function legacyMovesCsvToSessionDocument(csvText) {
  const trimmed = String(csvText ?? '').trim();
  if (!trimmed) return null;
  const rows = parseCsvRows(trimmed);
  if (rows.length < 2) return null;

  const headers = rows[0].map((h) => String(h).trim());
  const moves = [];
  for (let r = 1; r < rows.length; r += 1) {
    const cells = rows[r];
    const move = {};
    headers.forEach((h, idx) => {
      if (!h || h === 'camera_frame' || h === '__v') return;
      move[h] = coerceCsvCell(cells[idx] ?? '');
    });
    if (move._id && !move.moveId) move.moveId = move._id;
    moves.push(move);
  }

  const first = moves[0];
  const sessionGameId = first?.sessionGameId;
  if (sessionGameId == null || sessionGameId === '') return null;

  const subjectId =
    first.subjectId != null && first.subjectId !== '' ? first.subjectId : sessionGameId;

  return {
    sessionGameId: String(sessionGameId),
    subjectId: String(subjectId),
    condition: first.condition,
    date: first.date,
    moves
  };
}
