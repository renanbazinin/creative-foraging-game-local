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
import { t } from '../locales';

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
      setFolderError(t('startDialog.browserNoFolder'));
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
      setFolderError(t('startDialog.folderRequired'));
      return;
    }
    if (!id || !timeMinutes) {
      alert(t('startDialog.fillFields'));
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

  return (
    <div className="dialog-overlay">
      <div className="dialog-box dialog-box--wide">
        <header className="start-dialog-hero">
          <h1 className="start-dialog-title">{t('startDialog.title')}</h1>
          <p className="start-dialog-subtitle">{t('startDialog.subtitle')}</p>
          <div className="start-dialog-badge-row">
            <div
              className="local-data-badge start-dialog-local-badge"
              title={t('startDialog.localOnlyTitle')}
            >
              <span className="local-data-dot" aria-hidden />
              <span className="local-data-text">{t('startDialog.localOnly')}</span>
            </div>
          </div>
        </header>

        <div className="start-dialog-about">
          <button
            type="button"
            className="start-dialog-about-link"
            onClick={() => {
              window.location.hash = '#/about';
            }}
          >
            {t('startDialog.aboutLink')}
          </button>
        </div>

        <div className="folder-notice">
          <strong>{t('startDialog.folderNoticeStrong')}</strong>{' '}
          {t('startDialog.folderNoticeRest')}
        </div>

        <div className="dialog-field folder-row">
          <button
            type="button"
            className="dialog-button folder-connect"
            onClick={handleChooseFolder}
            disabled={connecting}
          >
            {folderReady ? t('startDialog.changeFolder') : t('startDialog.chooseFolder')}
          </button>
          {connecting && <span className="folder-status">{t('startDialog.checkingFolder')}</span>}
          {!connecting && folderReady && (
            <span className="folder-status folder-status--ok">{t('startDialog.folderOk')}</span>
          )}
          {!connecting && !folderReady && (
            <span className="folder-status folder-status--warn">{t('startDialog.folderWarn')}</span>
          )}
        </div>
        {folderError && <div className="folder-error">{folderError}</div>}

        <div className="dialog-field">
          <label htmlFor="cfg-participant-id">{t('startDialog.participantId')}</label>
          <input
            id="cfg-participant-id"
            type="text"
            value={id}
            onChange={(e) => setId(e.target.value)}
            disabled={!folderReady}
            autoComplete="off"
          />
        </div>

        <div className="dialog-field">
          <label htmlFor="cfg-condition">{t('startDialog.condition')}</label>
          <select id="cfg-condition" value={condition} onChange={(e) => setCondition(e.target.value)} disabled={!folderReady}>
            <option value="individual">individual</option>
            <option value="group">group</option>
          </select>
        </div>

        <div className="dialog-field">
          <label htmlFor="cfg-duration-min">{t('startDialog.timeMinutes')}</label>
          <input
            id="cfg-duration-min"
            type="number"
            value={timeMinutes}
            onChange={(e) => setTimeMinutes(e.target.value)}
            min="1"
            disabled={!folderReady}
          />
        </div>

        <div className="dialog-buttons">
          <button type="button" className="dialog-button" onClick={() => { window.location.hash = '#/calibrate'; }} disabled={!folderReady}>
            {t('startDialog.calibrate')}
          </button>
          <button type="button" className="dialog-button small-button" onClick={() => { window.location.hash = '#/admin'; }}>
            {t('startDialog.admin')}
          </button>
          <button type="button" className="dialog-button ok" onClick={handleOK} disabled={!folderReady}>
            {t('startDialog.ok')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default StartDialog;
