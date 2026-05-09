/**
 * Normalize **legacy project** export JSON (nested `sessionInfo`, etc.) into the flat session
 * document shape used for local storage (sessionGameId, subjectId, moves at top level).
 * Same envelope as old Admin `transformSessionToGameData` / historical downloads—not a raw DB export.
 */

export function normalizeSessionDocument(raw) {
  if (!raw || typeof raw !== 'object') return null;

  if (raw.sessionInfo && typeof raw.sessionInfo === 'object') {
    const si = raw.sessionInfo;
    const sessionGameId = si.sessionGameId ?? si.id;
    const subjectId = si.subjectId ?? si.id;
    return {
      ...raw,
      sessionGameId: sessionGameId != null ? String(sessionGameId) : raw.sessionGameId,
      subjectId: subjectId != null ? String(subjectId) : raw.subjectId,
      condition: si.condition ?? raw.condition,
      date: si.date ?? raw.date,
      timeSeconds: si.timeSeconds ?? raw.timeSeconds,
      colorA: si.colorA ?? raw.colorA,
      colorB: si.colorB ?? raw.colorB,
      createdAt: si.createdAt ?? raw.createdAt,
      updatedAt: si.updatedAt ?? raw.updatedAt,
      moves: Array.isArray(raw.moves) ? raw.moves.map(normalizeMoveIds) : []
    };
  }

  return {
    ...raw,
    moves: Array.isArray(raw.moves) ? raw.moves.map(normalizeMoveIds) : raw.moves
  };
}

function normalizeMoveIds(move) {
  if (!move || typeof move !== 'object') return move;
  const moveId = move.moveId || move._id;
  const next = { ...move };
  if (moveId && !next.moveId) next.moveId = typeof moveId === 'string' ? moveId : String(moveId);
  return next;
}

/**
 * Strip legacy export envelope fields (startTime/summary/sessionInfo wrapper); flat doc for `session.json`.
 */
export function flatSessionForStorage(raw) {
  const n = normalizeSessionDocument(raw);
  if (!n || !n.sessionGameId) return null;
  const out = { ...n };
  delete out.startTime;
  delete out.endTime;
  delete out.duration;
  delete out.summary;
  delete out.sessionInfo;
  delete out.braceletHistory;
  out.moves = Array.isArray(n.moves) ? n.moves.map(normalizeMoveIds) : [];
  return out;
}
