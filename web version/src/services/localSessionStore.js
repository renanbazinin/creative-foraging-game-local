/**
 * Client-only session persistence via File System Access API.
 * Layout: <chosen-dir>/sessions/<sanitizedSessionId>/session.json + session.csv
 * Legacy: <chosen-dir>/sessions/<sanitizedSessionId>.json (read + migrate on write)
 */

import { sessionDocumentToMovesCsv } from '../utils/sessionCsv.js';

const IDB_NAME = 'cfg-local-session-store';
const IDB_STORE = 'handles';
const IDB_KEY = 'dataRoot';
const SESSIONS_DIR = 'sessions';
const SESSION_JSON = 'session.json';
const SESSION_CSV = 'session.csv';

const writeQueues = new Map();

/** In-memory active directory (set after user picks folder or restored from IDB). */
let activeRootHandle = null;

export function setActiveDataRoot(handle) {
  activeRootHandle = handle || null;
}

export function getActiveDataRoot() {
  return activeRootHandle;
}

/**
 * Restore handle from IndexedDB and re-request permission if needed.
 * @returns {Promise<FileSystemDirectoryHandle|null>}
 */
export async function restoreDataRootFromStorage() {
  const h = await loadDirectoryHandle();
  if (!h) return null;
  const ok = await ensureDirectoryPermission(h);
  if (!ok) {
    return null;
  }
  setActiveDataRoot(h);
  return h;
}

function runQueued(sessionGameId, task) {
  const prev = writeQueues.get(sessionGameId) || Promise.resolve();
  const next = prev.then(() => task()).finally(() => {
    if (writeQueues.get(sessionGameId) === next) {
      writeQueues.delete(sessionGameId);
    }
  });
  writeQueues.set(sessionGameId, next);
  return next;
}

function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

export function isFileSystemAccessSupported() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export async function saveDirectoryHandle(handle) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
  });
}

export async function loadDirectoryHandle() {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function clearStoredDirectoryHandle() {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(IDB_STORE).delete(IDB_KEY);
  });
}

/**
 * Ensure readwrite permission on the root directory handle.
 */
export async function ensureDirectoryPermission(handle) {
  if (!handle) return false;
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') {
    return true;
  }
  return (await handle.requestPermission(opts)) === 'granted';
}

export async function pickDataDirectory() {
  if (!isFileSystemAccessSupported()) {
    throw new Error('This browser does not support choosing a folder. Use Chrome or Edge.');
  }
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await saveDirectoryHandle(handle);
  return handle;
}

async function getSessionsDirectory(rootHandle) {
  return rootHandle.getDirectoryHandle(SESSIONS_DIR, { create: true });
}

/** Safe folder / legacy filename stem for sessionGameId */
export function sanitizedExperimentFolderName(sessionGameId) {
  return String(sessionGameId).replace(/[/\\?%*:|"<>]/g, '_');
}

function legacyFlatSessionFileName(sessionGameId) {
  return `${sanitizedExperimentFolderName(sessionGameId)}.json`;
}

async function getExperimentDirectoryHandle(rootHandle, sessionGameId) {
  const sessionsDir = await getSessionsDirectory(rootHandle);
  const name = sanitizedExperimentFolderName(sessionGameId);
  return sessionsDir.getDirectoryHandle(name, { create: true });
}

async function writeTextFile(dirHandle, name, text) {
  const fh = await dirHandle.getFileHandle(name, { create: true });
  const writable = await fh.createWritable();
  await writable.write(text);
  await writable.close();
}

/**
 * Write session.json + session.csv under the experiment folder; remove legacy flat JSON if present.
 */
async function writeExperimentFiles(rootHandle, sessionGameId, data) {
  const expDir = await getExperimentDirectoryHandle(rootHandle, sessionGameId);
  await writeTextFile(expDir, SESSION_JSON, JSON.stringify(data, null, 2));
  const csvText = sessionDocumentToMovesCsv(data);
  await writeTextFile(expDir, SESSION_CSV, csvText);

  try {
    const sessionsDir = await getSessionsDirectory(rootHandle);
    await sessionsDir.removeEntry(legacyFlatSessionFileName(sessionGameId));
  } catch {
    // legacy file did not exist
  }
}

async function readJsonFromFileHandle(fileHandle) {
  const file = await fileHandle.getFile();
  const text = await file.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function readSessionFile(rootHandle, sessionGameId) {
  const sessionsDir = await getSessionsDirectory(rootHandle);
  const safe = sanitizedExperimentFolderName(sessionGameId);

  try {
    const expDir = await sessionsDir.getDirectoryHandle(safe);
    try {
      const fh = await expDir.getFileHandle(SESSION_JSON);
      const data = await readJsonFromFileHandle(fh);
      if (data) return data;
    } catch {
      /* empty */
    }
  } catch {
    /* no experiment dir */
  }

  try {
    const fh = await sessionsDir.getFileHandle(legacyFlatSessionFileName(sessionGameId));
    return readJsonFromFileHandle(fh);
  } catch {
    return null;
  }
}

/**
 * Write a full session document (e.g. import from JSON file).
 */
export async function importSessionDocument(rootHandle, sessionData) {
  if (!sessionData?.sessionGameId || !sessionData?.subjectId) {
    const err = new Error('sessionGameId and subjectId are required');
    err.status = 400;
    throw err;
  }
  if (!(await ensureDirectoryPermission(rootHandle))) {
    throw new Error('Permission denied for data folder');
  }
  const doc = {
    ...sessionData,
    createdAt: sessionData.createdAt || nowIso(),
    updatedAt: nowIso()
  };
  await writeExperimentFiles(rootHandle, sessionData.sessionGameId, doc);
  return doc;
}

function nowIso() {
  return new Date().toISOString();
}

export function getMoveId(move) {
  return move?.moveId || move?._id || null;
}

function summarizeSessionJson(data) {
  const moves = Array.isArray(data.moves) ? data.moves : [];
  return {
    sessionGameId: data.sessionGameId,
    subjectId: data.subjectId,
    condition: data.condition,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    movesCount: moves.length
  };
}

/**
 * List session summaries: experiment folders with session.json, plus legacy flat *.json in sessions/.
 */
export async function listSessionSummaries(rootHandle) {
  if (!(await ensureDirectoryPermission(rootHandle))) {
    throw new Error('Permission denied for data folder');
  }
  const dir = await getSessionsDirectory(rootHandle);
  const seenIds = new Set();
  const out = [];

  for await (const entry of dir.values()) {
    if (entry.kind === 'directory') {
      try {
        const fh = await entry.getFileHandle(SESSION_JSON);
        const file = await fh.getFile();
        const text = await file.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          continue;
        }
        const summary = summarizeSessionJson(data);
        if (summary.sessionGameId) {
          seenIds.add(summary.sessionGameId);
          out.push(summary);
        }
      } catch {
        /* no session.json */
      }
    } else if (entry.kind === 'file' && entry.name.endsWith('.json')) {
      const file = await entry.getFile();
      const text = await file.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        continue;
      }
      const summary = summarizeSessionJson(data);
      if (summary.sessionGameId && !seenIds.has(summary.sessionGameId)) {
        const hasFolder = await experimentFolderExists(dir, sanitizedExperimentFolderName(summary.sessionGameId));
        if (!hasFolder) {
          seenIds.add(summary.sessionGameId);
          out.push(summary);
        }
      }
    }
  }

  out.sort((a, b) => {
    const ta = new Date(b.updatedAt || b.createdAt || 0).getTime();
    const tb = new Date(a.updatedAt || a.createdAt || 0).getTime();
    return ta - tb;
  });
  return out.filter((s) => s.sessionGameId);
}

async function experimentFolderExists(sessionsDir, folderName) {
  try {
    await sessionsDir.getDirectoryHandle(folderName);
    return true;
  } catch {
    return false;
  }
}

export async function getSessionByGameId(rootHandle, sessionGameId) {
  if (!(await ensureDirectoryPermission(rootHandle))) {
    throw new Error('Permission denied for data folder');
  }
  const data = await readSessionFile(rootHandle, sessionGameId);
  if (!data) {
    const err = new Error('Session not found');
    err.status = 404;
    throw err;
  }
  return data;
}

export async function getSessionExperimentOnly(rootHandle, sessionGameId) {
  const session = await getSessionByGameId(rootHandle, sessionGameId);
  const experimentMoves = (session.moves || []).filter((m) => m.phase !== 'practice');
  return {
    ...session,
    moves: experimentMoves,
    originalMovesCount: session.moves?.length || 0,
    experimentMovesCount: experimentMoves.length
  };
}

/**
 * Create or update session header (same rules as former server: practice id "1" replaces; other ids conflict if moves exist).
 */
export async function upsertSession(rootHandle, payload = {}) {
  const {
    sessionGameId,
    subjectId,
    condition,
    date,
    timeSeconds,
    colorA,
    colorB,
    metadata = {}
  } = payload;

  if (!sessionGameId || !subjectId) {
    const err = new Error('sessionGameId and subjectId are required');
    err.status = 400;
    throw err;
  }

  if (!(await ensureDirectoryPermission(rootHandle))) {
    throw new Error('Permission denied for data folder');
  }

  return runQueued(sessionGameId, async () => {
    let existing = await readSessionFile(rootHandle, sessionGameId);

    if (sessionGameId === '1') {
      existing = null;
    } else if (existing && Array.isArray(existing.moves) && existing.moves.length > 0) {
      const err = new Error(
        `Session ID "${sessionGameId}" is already taken and contains ${existing.moves.length} move(s). Please use a different session ID.`
      );
      err.status = 409;
      throw err;
    }

    const createdAt = existing?.createdAt || nowIso();
    const doc = {
      sessionGameId,
      subjectId,
      condition,
      date,
      timeSeconds,
      colorA: colorA ?? existing?.colorA,
      colorB: colorB ?? existing?.colorB,
      metadata,
      moves: existing?.moves || [],
      createdAt,
      updatedAt: nowIso()
    };

    await writeExperimentFiles(rootHandle, sessionGameId, doc);
    return doc;
  });
}

/**
 * Append one move; assigns moveId if missing.
 */
export async function appendMove(rootHandle, sessionGameId, moveData = {}) {
  if (!(await ensureDirectoryPermission(rootHandle))) {
    throw new Error('Permission denied for data folder');
  }

  return runQueued(sessionGameId, async () => {
    const session = await readSessionFile(rootHandle, sessionGameId);
    if (!session) {
      const err = new Error('Session not found');
      err.status = 404;
      throw err;
    }

    const moveId = moveData.moveId || crypto.randomUUID();
    const move = { ...moveData, moveId };

    session.moves = Array.isArray(session.moves) ? session.moves : [];
    session.moves.push(move);
    session.updatedAt = nowIso();

    await writeExperimentFiles(rootHandle, sessionGameId, session);
    return move;
  });
}

export async function updateMovePlayer(rootHandle, sessionGameId, moveId, player) {
  if (!moveId) {
    const err = new Error('moveId is required');
    err.status = 400;
    throw err;
  }

  return runQueued(sessionGameId, async () => {
    const session = await readSessionFile(rootHandle, sessionGameId);
    if (!session) {
      const err = new Error('Session not found');
      err.status = 404;
      throw err;
    }
    const moves = Array.isArray(session.moves) ? session.moves : [];
    const idx = moves.findIndex((m) => getMoveId(m) === moveId);
    if (idx === -1) {
      const err = new Error('Move not found');
      err.status = 404;
      throw err;
    }
    moves[idx] = { ...moves[idx], player };
    session.moves = moves;
    session.updatedAt = nowIso();
    await writeExperimentFiles(rootHandle, sessionGameId, session);
    return moves[idx];
  });
}

export async function updateMovePlayersBatch(rootHandle, sessionGameId, updates) {
  if (!Array.isArray(updates) || updates.length === 0) {
    const err = new Error('updates array is required and must not be empty');
    err.status = 400;
    throw err;
  }

  return runQueued(sessionGameId, async () => {
    const session = await readSessionFile(rootHandle, sessionGameId);
    if (!session) {
      const err = new Error('Session not found');
      err.status = 404;
      throw err;
    }
    const moves = Array.isArray(session.moves) ? session.moves : [];
    let updatedCount = 0;
    const notFoundIds = [];

    for (const { moveId, player } of updates) {
      const idx = moves.findIndex((m) => getMoveId(m) === moveId);
      if (idx !== -1) {
        moves[idx] = { ...moves[idx], player };
        updatedCount++;
      } else {
        notFoundIds.push(moveId);
      }
    }

    if (updatedCount > 0) {
      session.moves = moves;
      session.updatedAt = nowIso();
      await writeExperimentFiles(rootHandle, sessionGameId, session);
    }

    return {
      updatedCount,
      notFoundIds,
      totalRequested: updates.length
    };
  });
}

/**
 * Optional: write a short README into the data folder.
 */
export async function writeFolderReadme(rootHandle) {
  if (!(await ensureDirectoryPermission(rootHandle))) return;
  const text =
    'Creative Foraging — local data folder\r\n' +
    '- Each experiment has its own folder under /sessions/<session-id>/\r\n' +
    '- session.json = full session data; session.csv = moves table (same format as Admin CSV export)\r\n' +
    '- Open the app from your static host or dev server and grant folder access when prompted.\r\n';
  const fh = await rootHandle.getFileHandle('CFG_DATA_README.txt', { create: true });
  const writable = await fh.createWritable();
  await writable.write(text);
  await writable.close();
}
