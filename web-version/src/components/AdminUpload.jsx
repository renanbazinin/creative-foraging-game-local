import React, { useState, useEffect } from 'react';
import {
  getActiveDataRoot,
  restoreDataRootFromStorage,
  pickDataDirectory,
  setActiveDataRoot,
  importSessionDocument,
  isFileSystemAccessSupported
} from '../services/localSessionStore';
import { flatSessionForStorage } from '../utils/sessionNormalize';
import './AdminUpload.css';

function AdminUpload() {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [dataRoot, setDataRoot] = useState(() => getActiveDataRoot());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const h = await restoreDataRootFromStorage();
      if (!cancelled && h) setDataRoot(h);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleConnectFolder = async () => {
    if (!isFileSystemAccessSupported()) {
      setError('Use Chrome or Edge on desktop to pick a data folder.');
      return;
    }
    try {
      const h = await pickDataDirectory();
      setActiveDataRoot(h);
      setDataRoot(h);
      setError(null);
    } catch (e) {
      if (e.name !== 'AbortError') {
        setError(e.message || 'Could not access folder');
      }
    }
  };

  const handleFileSelect = (e) => {
    const selectedFile = e.target.files[0];
    if (!selectedFile) return;

    if (!selectedFile.name.endsWith('.json')) {
      setError('Please select a JSON file');
      setFile(null);
      return;
    }

    setFile(selectedFile);
    setError(null);
    setMessage(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        const flat = flatSessionForStorage(data);
        const src = flat || data;
        const si = data.sessionInfo;
        setPreview({
          sessionGameId: src.sessionGameId || si?.sessionGameId || 'N/A',
          subjectId: src.subjectId || si?.subjectId || 'N/A',
          condition: src.condition || si?.condition || 'N/A',
          date: src.date || si?.date || 'N/A',
          movesCount: src.moves?.length || data.moves?.length || 0,
          hasColorA: !!(src.colorA || si?.colorA),
          hasColorB: !!(src.colorB || si?.colorB)
        });
      } catch (err) {
        setError('Invalid JSON file: ' + err.message);
        setPreview(null);
      }
    };
    reader.readAsText(selectedFile);
  };

  const handleUpload = async () => {
    if (!file) {
      setError('Please select a file first');
      return;
    }

    const root = dataRoot || getActiveDataRoot();
    if (!root) {
      setError('Choose your CFG data folder first (same folder used when starting a game).');
      return;
    }

    setUploading(true);
    setError(null);
    setMessage(null);

    try {
      const fileContent = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsText(file);
      });

      const sessionData = JSON.parse(fileContent);
      const flat = flatSessionForStorage(sessionData);
      if (!flat?.sessionGameId || !flat?.subjectId) {
        throw new Error(
          'Missing required fields: sessionGameId and subjectId (accepts flat session or legacy export JSON with sessionInfo)'
        );
      }

      await importSessionDocument(root, sessionData);

      setMessage(
        `Saved session "${flat.sessionGameId}" with ${flat.moves?.length || 0} moves into your data folder.`
      );
      setFile(null);
      setPreview(null);

      const fileInput = document.getElementById('json-file-input');
      if (fileInput) fileInput.value = '';
    } catch (err) {
      setError(err.message || 'Failed to import file');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="admin-upload-container">
      <div className="admin-upload-card">
        <h1>Import session JSON</h1>
        <p className="admin-upload-description">
          Imports into <code>sessions/&lt;session-id&gt;/session.json</code> and writes the matching{' '}
          <code>session.csv</code>. Choose the same data folder you use when saving games.
        </p>

        <div className="admin-upload-form">
          <div className="password-input-wrapper">
            <button type="button" className="upload-button" onClick={handleConnectFolder} style={{ marginBottom: 12 }}>
              {dataRoot ? 'Change data folder' : 'Choose data folder'}
            </button>
            {!dataRoot && (
              <p style={{ color: '#f44336', fontSize: 14 }}>Connect a folder before importing.</p>
            )}
          </div>

          <div className="file-input-wrapper">
            <input
              id="json-file-input"
              type="file"
              accept=".json"
              onChange={handleFileSelect}
              disabled={uploading}
            />
            <label htmlFor="json-file-input" className="file-input-label">
              {file ? file.name : 'Choose JSON File'}
            </label>
          </div>

          {preview && (
            <div className="file-preview">
              <h3>File Preview</h3>
              <div className="preview-grid">
                <div className="preview-item">
                  <strong>Session ID:</strong> {preview.sessionGameId}
                </div>
                <div className="preview-item">
                  <strong>Subject ID:</strong> {preview.subjectId}
                </div>
                <div className="preview-item">
                  <strong>Condition:</strong> {preview.condition}
                </div>
                <div className="preview-item">
                  <strong>Date:</strong> {preview.date}
                </div>
                <div className="preview-item">
                  <strong>Moves:</strong> {preview.movesCount}
                </div>
                <div className="preview-item">
                  <strong>Color A:</strong> {preview.hasColorA ? '✓' : '✗'}
                </div>
                <div className="preview-item">
                  <strong>Color B:</strong> {preview.hasColorB ? '✓' : '✗'}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="error-message">
              <strong>Error:</strong> {error}
            </div>
          )}

          {message && <div className="success-message">{message}</div>}

          <button
            className="upload-button"
            onClick={handleUpload}
            disabled={!file || !dataRoot || uploading}
          >
            {uploading ? 'Saving…' : 'Save into data folder'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AdminUpload;
