/**
 * Moves CSV export — same rules as legacy Admin "Download CSV".
 * Input: an object with a `moves` array (session document or Summary-shaped data).
 */

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

  const headers = Array.from(allKeys);
  const rows = [headers.join(',')];

  moves.forEach((move) => {
    const row = headers.map((key) => {
      const value = move[key];
      if (value === null || value === undefined || value === '') {
        return '';
      }
      if (Array.isArray(value) || typeof value === 'object') {
        return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
      }
      return `"${String(value).replace(/"/g, '""')}"`;
    });
    rows.push(row.join(','));
  });

  return rows.join('\n');
}
