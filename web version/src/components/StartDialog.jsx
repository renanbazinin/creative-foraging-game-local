import React, { useState, useEffect, useCallback } from 'react';
import {
  isFileSystemAccessSupported,
  pickDataDirectory,
  restoreDataRootFromStorage,
  setActiveDataRoot,
  getActiveDataRoot,
  writeFolderReadme
} from '../services/localSessionStore';
import './StartDialog.css';

function StartDialog({ onStart }) {
  const [id, setId] = useState('1');
  const [condition, setCondition] = useState('individual');
  const [timeMinutes, setTimeMinutes] = useState('15');
  const [folderReady, setFolderReady] = useState(false);
  const [folderError, setFolderError] = useState(null);
  const [connecting, setConnecting] = useState(true);

  const applyReady = useCallback((ready) => {
    setFolderReady(ready);
    setFolderError(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setConnecting(true);
      try {
        const h = await restoreDataRootFromStorage();
        if (!cancelled && h) {
          applyReady(true);
        } else if (!cancelled) {
          applyReady(false);
        }
      } catch (e) {
        console.warn('[StartDialog] Could not restore folder:', e);
        if (!cancelled) applyReady(false);
      } finally {
        if (!cancelled) setConnecting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyReady]);

  const handleChooseFolder = async () => {
    setFolderError(null);
    if (!isFileSystemAccessSupported()) {
      setFolderError(
        'Your browser cannot pick a save folder. Use Google Chrome or Microsoft Edge on desktop.'
      );
      return;
    }
    try {
      const handle = await pickDataDirectory();
      setActiveDataRoot(handle);
      await writeFolderReadme(handle);
      applyReady(true);
    } catch (e) {
      if (e.name === 'AbortError') {
        return;
      }
      console.error('[StartDialog] Folder pick failed:', e);
      setFolderError(e.message || 'Could not access the folder. Please allow permission when the browser asks.');
      applyReady(false);
    }
  };

  const handleOK = () => {
    if (!folderReady || !getActiveDataRoot()) {
      setFolderError('Choose a folder and allow the browser to save there before starting.');
      return;
    }
    if (!id || !timeMinutes) {
      alert('Please fill in all fields');
      return;
    }

    const config = {
      id,
      sessionGameId: id,
      condition,
      timeSeconds: parseInt(timeMinutes, 10) * 60,
      date: new Date().toISOString().replace('T', ' ').substring(0, 19)
    };

    onStart(config);
  };

  const handleCancel = () => {
    window.close();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog-box dialog-box--wide">
        <div className="dialog-header">
          <h2>The Creative Game</h2>
          <div className="local-data-badge" title="All session data stays on your device in the folder you choose.">
            <span className="local-data-dot" />
            <span className="local-data-text">Local only</span>
          </div>
        </div>

        <div className="folder-notice">
          <strong>Save folder required.</strong> This app runs entirely in your browser — there is no cloud server.
          When you click &quot;Choose data folder&quot;, your browser will ask permission to read and write that folder.
          You must <strong>allow</strong> access so sessions and moves can be saved. Use Chrome or Edge on desktop for
          full support.
        </div>

        <div className="dialog-field folder-row">
          <button
            type="button"
            className="dialog-button folder-connect"
            onClick={handleChooseFolder}
            disabled={connecting}
          >
            {folderReady ? 'Change data folder' : 'Choose data folder'}
          </button>
          {connecting && <span className="folder-status">Checking saved folder…</span>}
          {!connecting && folderReady && (
            <span className="folder-status folder-status--ok">Folder connected — you can start the game.</span>
          )}
          {!connecting && !folderReady && (
            <span className="folder-status folder-status--warn">No folder yet — connect to continue.</span>
          )}
        </div>
        {folderError && <div className="folder-error">{folderError}</div>}

        <div className="dialog-field">
          <label>ID:</label>
          <input
            type="text"
            value={id}
            onChange={(e) => setId(e.target.value)}
            disabled={!folderReady}
          />
        </div>

        <div className="dialog-field">
          <label>Condition:</label>
          <select value={condition} onChange={(e) => setCondition(e.target.value)} disabled={!folderReady}>
            <option value="individual">individual</option>
            <option value="group">group</option>
          </select>
        </div>

        <div className="dialog-field">
          <label>Time (in minutes):</label>
          <input
            type="number"
            value={timeMinutes}
            onChange={(e) => setTimeMinutes(e.target.value)}
            min="1"
            disabled={!folderReady}
          />
        </div>

        <div className="dialog-buttons">
          <button className="dialog-button" onClick={() => { window.location.hash = '/calibrate'; }} disabled={!folderReady}>
            Calibrate Colors
          </button>
          <button className="dialog-button small-button" onClick={() => { window.location.hash = '/admin'; }}>
            Admin
          </button>
          <button className="dialog-button ok" onClick={handleOK} disabled={!folderReady}>
            OK
          </button>
          <button className="dialog-button cancel" onClick={handleCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default StartDialog;
