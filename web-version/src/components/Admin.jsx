import React, { useState, useEffect, useCallback } from 'react';
import Summary from './Summary';
import {
  getActiveDataRoot,
  restoreDataRootFromStorage,
  pickDataDirectory,
  setActiveDataRoot,
  listSessionSummaries,
  getSessionByGameId,
  getSessionExperimentOnly,
  updateMovePlayer,
  getMoveId,
  isFileSystemAccessSupported
} from '../services/localSessionStore';
import { sessionDocumentToMovesCsv } from '../utils/sessionCsv';
import './Admin.css';

const transformSessionToGameData = (session) => {
  if (!session) return null;

  const moves = Array.isArray(session.moves) ? session.moves : [];
  const duration = moves.reduce(
    (max, move) => (typeof move.elapsed === 'number' && move.elapsed > max ? move.elapsed : max),
    0
  );

  const movesByPlayer = {};
  const movesByPhase = {};

  moves.forEach((move) => {
    const player = move?.player || 'Unknown';
    movesByPlayer[player] = (movesByPlayer[player] || 0) + 1;

    const phase = move?.phase || 'unknown';
    movesByPhase[phase] = (movesByPhase[phase] || 0) + 1;
  });

  return {
    startTime: session.sessionInfo?.startedAt || session.metadata?.config?.date || session.createdAt,
    endTime: session.sessionInfo?.endedAt || session.updatedAt,
    duration,
    sessionInfo: {
      ...(session.metadata?.config || {}),
      ...(session.sessionInfo || {}),
      sessionGameId: session.sessionGameId,
      subjectId: session.subjectId,
      condition: session.condition,
      date: session.date,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt
    },
    moves,
    braceletHistory: session.braceletHistory || [],
    summary: {
      totalMoves: moves.length,
      movesByPlayer,
      movesByPhase
    }
  };
};

const formatDate = (value) => {
  if (!value) return '—';
  try {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString();
    }
  } catch (error) {
    // ignore
  }
  return value;
};

function Admin() {
  const [dataRoot, setDataRoot] = useState(() => getActiveDataRoot());
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState(null);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [sessionData, setSessionData] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState(null);
  const [isExperimentOnly, setIsExperimentOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const h = await restoreDataRootFromStorage();
      if (!cancelled && h) {
        setDataRoot(h);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleConnectFolder = async () => {
    if (!isFileSystemAccessSupported()) {
      setSessionsError('Use Chrome or Edge on desktop to connect a data folder.');
      return;
    }
    try {
      const h = await pickDataDirectory();
      setActiveDataRoot(h);
      setDataRoot(h);
      setSessionsError(null);
    } catch (e) {
      if (e.name !== 'AbortError') {
        setSessionsError(e.message || 'Could not access folder');
      }
    }
  };

  const fetchSessions = useCallback(async () => {
    const root = dataRoot || getActiveDataRoot();
    if (!root) {
      setSessionsError('Choose a data folder to load sessions.');
      setSessionsLoading(false);
      setSessions([]);
      return;
    }

    setSessionsLoading(true);
    setSessionsError(null);

    try {
      const sessionList = await listSessionSummaries(root);
      setSessions(sessionList);
      setSelectedSessionId((prev) => {
        if (prev && sessionList.some((session) => session.sessionGameId === prev)) {
          return prev;
        }
        return sessionList.length > 0 ? sessionList[0].sessionGameId : null;
      });
    } catch (error) {
      console.error('[Admin] Error loading sessions:', error);
      setSessionsError(error.message || 'Failed to load sessions');
      setSessions([]);
      setSelectedSessionId(null);
    } finally {
      setSessionsLoading(false);
    }
  }, [dataRoot]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  useEffect(() => {
    if (!selectedSessionId || !dataRoot) {
      setSessionData(null);
      return;
    }

    let cancelled = false;

    const fetchSessionDetail = async () => {
      setSessionLoading(true);
      setSessionError(null);
      try {
        const data = isExperimentOnly
          ? await getSessionExperimentOnly(dataRoot, selectedSessionId)
          : await getSessionByGameId(dataRoot, selectedSessionId);
        if (!cancelled) {
          setSessionData(transformSessionToGameData(data));
        }
      } catch (error) {
        console.error('[Admin] Error loading session detail:', error);
        if (!cancelled) {
          setSessionError(error.message || 'Failed to load session');
          setSessionData(null);
        }
      } finally {
        if (!cancelled) {
          setSessionLoading(false);
        }
      }
    };

    fetchSessionDetail();

    return () => {
      cancelled = true;
    };
  }, [selectedSessionId, dataRoot, isExperimentOnly]);

  const handleSelectSession = (sessionGameId) => {
    setSelectedSessionId(sessionGameId);
    setIsExperimentOnly(false);
  };

  const toggleExperimentOnly = () => {
    setIsExperimentOnly((v) => !v);
  };

  const handleEditPlayers = () => {
    if (selectedSessionId) {
      window.location.hash = `#/admin/edit-moves/${encodeURIComponent(selectedSessionId)}`;
    }
  };

  const downloadJSON = () => {
    if (!sessionData) return;

    const json = JSON.stringify(sessionData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const filename = `${selectedSessionId}_${new Date().toISOString().split('T')[0]}.json`;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    console.log('[Admin] Downloaded JSON:', filename);
  };

  const downloadCSV = () => {
    if (!sessionData || !sessionData.moves || sessionData.moves.length === 0) {
      alert('No moves to export');
      return;
    }

    const csvContent = sessionDocumentToMovesCsv(sessionData);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const filename = `${selectedSessionId}_${new Date().toISOString().split('T')[0]}.csv`;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    console.log('[Admin] Downloaded CSV:', filename);
  };

  const handlePlayerUpdate = async (moveId, newPlayer) => {
    if (!selectedSessionId || !moveId || !dataRoot) return;

    try {
      await updateMovePlayer(dataRoot, selectedSessionId, moveId, newPlayer);

      setSessionData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          moves: prev.moves.map((move) =>
            getMoveId(move) === moveId ? { ...move, player: newPlayer } : move
          )
        };
      });

      console.log('[Admin] Player updated:', moveId, newPlayer);
    } catch (error) {
      console.error('[Admin] Error updating player:', error);
      alert('Failed to update player: ' + error.message);
    }
  };

  return (
    <div className="admin-container">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-header">
          <h1>Admin</h1>
          <div className="admin-folder-row">
            <button
              type="button"
              className="admin-refresh-button"
              onClick={handleConnectFolder}
              title="Choose the folder that contains your CFG session files"
            >
              {dataRoot ? 'Change folder' : 'Connect data folder'}
            </button>
            <button
              className="admin-refresh-button"
              onClick={fetchSessions}
              disabled={sessionsLoading || !dataRoot}
            >
              {sessionsLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>
        {!dataRoot && (
          <div className="admin-error">
            Connect the same folder you use for saving games (Chrome / Edge). The browser will ask for permission.
          </div>
        )}
        {sessionsError && <div className="admin-error">{sessionsError}</div>}
        <div className="admin-session-list">
          {sessionsLoading && sessions.length === 0 && (
            <div className="admin-status">Loading sessions…</div>
          )}
          {!sessionsLoading && sessions.length === 0 && !sessionsError && dataRoot && (
            <div className="admin-status">No sessions found.</div>
          )}
          {sessions.map((session) => {
            const movesCount =
              typeof session.movesCount === 'number'
                ? session.movesCount
                : Array.isArray(session.moves)
                  ? session.moves.length
                  : 0;
            const isActive = session.sessionGameId === selectedSessionId;
            return (
              <button
                key={session.sessionGameId}
                className={`admin-session-card ${isActive ? 'active' : ''}`}
                onClick={() => handleSelectSession(session.sessionGameId)}
              >
                <div className="admin-session-id">{session.sessionGameId}</div>
                <div className="admin-session-meta">
                  <span>Participant: {session.subjectId || '—'}</span>
                  <span>Condition: {session.condition || '—'}</span>
                </div>
                <div className="admin-session-meta">
                  <span>Moves: {movesCount}</span>
                  <span>Updated: {formatDate(session.updatedAt)}</span>
                </div>
              </button>
            );
          })}
        </div>
      </aside>
      <main className="admin-content">
        {sessionLoading && (
          <div className="admin-status admin-status--content">Loading session…</div>
        )}
        {sessionError && (
          <div className="admin-error admin-error--content">{sessionError}</div>
        )}
        {!sessionLoading && !sessionError && sessionData && (
          <>
            <div className="admin-toolbar">
              <div className="admin-toolbar-group admin-toolbar-group--primary">
                <button
                  className="admin-toolbar-button back-button"
                  onClick={() => {
                    window.location.hash = '/';
                  }}
                  title="Return to start dialog"
                >
                  ← Back
                </button>
                <button
                  className={`admin-toolbar-button experiment-toggle ${isExperimentOnly ? 'active' : ''}`}
                  onClick={toggleExperimentOnly}
                  title={
                    isExperimentOnly
                      ? 'Show all moves (including practice)'
                      : 'Show only experiment phase moves'
                  }
                >
                  {isExperimentOnly ? 'Show All Moves' : 'Experiment Only'}
                </button>
                <button
                  className="admin-toolbar-button edit-players"
                  onClick={handleEditPlayers}
                  title="Open dedicated editor for player assignments"
                >
                  Edit Players
                </button>
              </div>
              <div className="admin-toolbar-group admin-toolbar-group--secondary">
                <button
                  className="admin-toolbar-button download-json"
                  onClick={downloadJSON}
                  title="Download session data as JSON"
                >
                  Download JSON
                </button>
                <button
                  className="admin-toolbar-button download-csv"
                  onClick={downloadCSV}
                  title="Download moves as CSV"
                >
                  Download CSV
                </button>
              </div>
            </div>
            <div className="admin-summary-wrapper">
              <Summary
                initialData={sessionData}
                enableFileUpload={false}
                className="embedded-summary"
                title={`Session ${sessionData.sessionInfo?.sessionGameId || selectedSessionId || ''}${isExperimentOnly ? ' (Experiment Only)' : ''}`}
                sessionGameId={selectedSessionId}
                onPlayerUpdate={handlePlayerUpdate}
              />
            </div>
          </>
        )}
        {!sessionLoading && !sessionError && !sessionData && dataRoot && (
          <div className="admin-status admin-status--content">Select a session to view its moves.</div>
        )}
      </main>
    </div>
  );
}

export default Admin;
