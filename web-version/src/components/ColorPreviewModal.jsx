import React, { useState } from 'react';
import './MoveHistoryEditor.css';
import { getMulticlassSegmentation } from '../utils/colorDetector';

const formatNumber = (value, decimals = 2) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '—';
  }
  return value.toFixed(decimals);
};

const formatCoverage = (count, total) => {
  if (!total || !count) return '0%';
  return `${((count / total) * 100).toFixed(1)}%`;
};

const formatCoverageLabel = (pixels) => {
  if (typeof pixels !== 'number') return '—';
  return `${pixels.toLocaleString()} pixels`;
};

const formatDiffValue = (value) => {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') {
    return value.toFixed(1);
  }
  return String(value);
};

function ColorPreviewModal({ colorPreview, onClose }) {
  const [activeTab, setActiveTab] = useState('overview'); // 'overview' or 'multiclass'
  const [multiclassData, setMulticlassData] = useState(null);
  const [loadingMulticlass, setLoadingMulticlass] = useState(false);

  const handleRunMulticlass = async () => {
    if (!colorPreview?.original) return;
    setLoadingMulticlass(true);
    try {
      const sensitivity = colorPreview.backgroundSensitivity || 0.85;
      const data = await getMulticlassSegmentation(colorPreview.original, { sensitivity });
      setMulticlassData(data);
    } catch (err) {
      console.error('Failed to run multiclass segmentation:', err);
    } finally {
      setLoadingMulticlass(false);
    }
  };

  if (!colorPreview) return null;

  const colorPreviewStats = colorPreview?.stats;
  const colorPreviewTotalPixels =
    colorPreviewStats?.width && colorPreviewStats?.height
      ? colorPreviewStats.width * colorPreviewStats.height
      : 0;
  const colorPreviewAnchorLabel = colorPreview?.anchor
    ? colorPreview.anchor === 'top'
      ? 'Top edge (closest to ceiling camera)'
      : 'Bottom edge (closest to screen base)'
    : '—';
  const colorPreviewMethodLabel = colorPreviewStats?.mode === 'arm-segmentation'
    ? 'Arm Segmentation (MediaPipe Image Segmenter)'
    : colorPreviewStats?.mode === 'segmentation'
      ? 'Segmentation (MediaPipe Selfie)'
      : 'Color band mask';

  return (
    <div className="image-modal" onClick={onClose}>
      <div className="image-modal-content color-preview-modal" onClick={(e) => e.stopPropagation()}>
        <button className="close-modal" onClick={onClose}>✕</button>

        <div className="color-preview-tabs">
          <button
            className={`color-preview-tab ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            Overview
          </button>
          <button
            className={`color-preview-tab ${activeTab === 'multiclass' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('multiclass');
              if (!multiclassData && !loadingMulticlass) {
                handleRunMulticlass();
              }
            }}
          >
            MediaPipe Classes (6)
          </button>
        </div>

        {activeTab === 'overview' ? (
          <>
            <div className="color-preview-grid">
              <div className="color-preview-panel">
                <h3>Original Frame</h3>
                <img src={colorPreview.original} alt="Original frame" />
              </div>
              <div className="color-preview-panel">
                <h3>Mask View</h3>
                {colorPreview.preview ? (
                  <>
                    <p className="mask-label">
                      {colorPreview.stats?.mode === 'segmentation'
                        ? 'Overlay: Cyan = MediaPipe Person | Red/Blue = Filtered Blobs Only (Noise Removed) | Green Line = Top Boundary | Yellow Dashed = Bottom Boundary | Magenta = Tip (if different)'
                        : colorPreview.stats?.mode === 'arm-segmentation'
                          ? 'Arms Only - Color Detection (Red = Player A, Blue = Player B)'
                          : 'Color Overlay'}
                    </p>
                    <img src={colorPreview.preview} alt="Mask preview" />
                  </>
                ) : colorPreview.maskPreview ? (
                  <>
                    <p className="mask-label">
                      {colorPreview.stats?.mode === 'arm-segmentation'
                        ? 'Arms Only Mask (White = Arms, Black = Background)'
                        : 'MediaPipe Segmentation (White = Person, Black = Background)'}
                    </p>
                    <img src={colorPreview.maskPreview} alt="MediaPipe mask" />
                  </>
                ) : (
                  <p>No mask preview available</p>
                )}
              </div>
            </div>
            {colorPreview.stats && (
              <div className="color-preview-stats">
                {/* ... rest of stats ... */}
                <div className="color-preview-meta">
                  <div>
                    <strong>Frame:</strong>{' '}
                    {colorPreview.stats.width && colorPreview.stats.height
                      ? `${colorPreview.stats.width} × ${colorPreview.stats.height} (${colorPreviewTotalPixels.toLocaleString()} px)`
                      : '—'}
                  </div>
                  <div>
                    <strong>Method:</strong> {colorPreviewMethodLabel}
                  </div>
                  <div>
                    <strong>Anchor:</strong> {colorPreviewAnchorLabel}
                  </div>
                  <div>
                    <strong>Suggestion:</strong>{' '}
                    {colorPreview.suggestion === 'A'
                      ? 'Player A'
                      : colorPreview.suggestion === 'B'
                        ? 'Player B'
                        : 'None'}
                  </div>
                  {colorPreview.stats.detectionPoint && (
                    <div>
                      <strong>Detected point:</strong>{' '}
                      {colorPreview.stats.detectionPoint.label} (
                      {colorPreview.stats.detectionPoint.x},{' '}
                      {colorPreview.stats.detectionPoint.y})
                    </div>
                  )}
                  {colorPreview.stats.mode === 'segmentation' &&
                    typeof colorPreview.stats.personPixels === 'number' && (
                      <div>
                        <strong>Person coverage:</strong>{' '}
                        {formatCoverageLabel(colorPreview.stats.personPixels)}
                      </div>
                    )}
                  {colorPreview.stats.reason && (
                    <div>
                      <strong>Note:</strong> {colorPreview.stats.reason}
                    </div>
                  )}
                </div>
                <div className="color-preview-calibration">
                  <div className="calibration-card">
                    <div className="calibration-header">
                      <span className="player-label">Player A color</span>
                      <div className="color-chip" style={{ backgroundColor: colorPreview.colorA }} />
                    </div>
                    <code>{colorPreview.colorA || '—'}</code>
                    {colorPreview.calibrationA && (
                      <div className="calibration-hsv">
                        HSV: h={colorPreview.calibrationA.h ?? '—'} / s={colorPreview.calibrationA.s ?? '—'} / v={colorPreview.calibrationA.v ?? '—'}
                      </div>
                    )}
                  </div>
                  <div className="calibration-card">
                    <div className="calibration-header">
                      <span className="player-label">Player B color</span>
                      <div className="color-chip" style={{ backgroundColor: colorPreview.colorB }} />
                    </div>
                    <code>{colorPreview.colorB || '—'}</code>
                    {colorPreview.calibrationB && (
                      <div className="calibration-hsv">
                        HSV: h={colorPreview.calibrationB.h ?? '—'} / s={colorPreview.calibrationB.s ?? '—'} / v={colorPreview.calibrationB.v ?? '—'}
                      </div>
                    )}
                  </div>
                </div>
                {colorPreview.stats.mode === 'segmentation' ? (
                  <div className="segmentation-breakdown">
                    <h3 style={{ marginBottom: '1rem', fontSize: '1.1rem', color: '#4CAF50' }}>
                      Detection Results
                    </h3>
                    <div className="segmentation-card">
                      <h4>Scan Zone</h4>
                      <p><strong>Tip Y:</strong> {colorPreview.stats.tipY ?? '—'}</p>
                      <p><strong>Scan Depth:</strong> {colorPreview.stats.scanDepth?.toLocaleString() || 0} pixels ({colorPreview.stats.scanDepthRatio ? `${(colorPreview.stats.scanDepthRatio * 100).toFixed(0)}%` : '—'})</p>
                      <p><strong>Anchor:</strong> {colorPreview.stats.anchor === 'top' ? 'Top' : colorPreview.stats.anchor === 'manually' ? 'Manual' : 'Bottom'}</p>
                      {colorPreview.stats.minBlobRatio !== undefined && (
                        <p><strong>Blob filter:</strong> Keep blobs ≥ {((colorPreview.stats.minBlobRatio || 0.1) * 100).toFixed(0)}% of largest</p>
                      )}
                    </div>
                    <div className="segmentation-card">
                      <h4>Color A Pixels</h4>
                      <p><strong>Filtered:</strong> {colorPreview.stats.pixelsA?.toLocaleString() || 0} pixels</p>
                      {colorPreview.stats.rawPixelsA !== undefined && (
                        <p><strong>Raw (before blob filter):</strong> {colorPreview.stats.rawPixelsA?.toLocaleString() || 0} pixels</p>
                      )}
                      {colorPreview.stats.blobInfoA && (
                        <>
                          <p><strong>Largest blob:</strong> {colorPreview.stats.blobInfoA.largestBlobSize?.toLocaleString() || 0} px</p>
                          <p><strong>Min blob size:</strong> {colorPreview.stats.blobInfoA.minBlobSize?.toLocaleString() || 0} px</p>
                          <p><strong>Blobs:</strong> {colorPreview.stats.blobInfoA.filteredBlobs || 0} / {colorPreview.stats.blobInfoA.totalBlobs || 0} kept</p>
                        </>
                      )}
                    </div>
                    <div className="segmentation-card">
                      <h4>Color B Pixels</h4>
                      <p><strong>Filtered:</strong> {colorPreview.stats.pixelsB?.toLocaleString() || 0} pixels</p>
                      {colorPreview.stats.rawPixelsB !== undefined && (
                        <p><strong>Raw (before blob filter):</strong> {colorPreview.stats.rawPixelsB?.toLocaleString() || 0} pixels</p>
                      )}
                      {colorPreview.stats.blobInfoB && (
                        <>
                          <p><strong>Largest blob:</strong> {colorPreview.stats.blobInfoB.largestBlobSize?.toLocaleString() || 0} px</p>
                          <p><strong>Min blob size:</strong> {colorPreview.stats.blobInfoB.minBlobSize?.toLocaleString() || 0} px</p>
                          <p><strong>Blobs:</strong> {colorPreview.stats.blobInfoB.filteredBlobs || 0} / {colorPreview.stats.blobInfoB.totalBlobs || 0} kept</p>
                        </>
                      )}
                    </div>
                    {colorPreview.stats.bestArm && (
                      <div className="segmentation-card" style={{ border: '2px solid #4CAF50', backgroundColor: 'rgba(76, 175, 80, 0.1)' }}>
                        <h4>
                          Best Match: Player {colorPreview.stats.bestArm.color}
                          <span style={{ color: '#4CAF50', marginLeft: '0.5rem' }}>★</span>
                        </h4>
                        <p><strong>Pixel Count:</strong> {colorPreview.stats.bestArm.pixelCount?.toLocaleString() || 0}</p>
                        <p><strong>Scan Zone:</strong> Y={colorPreview.stats.bestArm.minY} → {colorPreview.stats.bestArm.maxY}</p>
                        <p><strong>Tip Y:</strong> {colorPreview.stats.bestArm.anchorY}</p>
                      </div>
                    )}
                  </div>
                ) : colorPreview.stats.mode === 'arm-segmentation' ? (
                  <div className="segmentation-breakdown">
                    <h3 style={{ marginBottom: '1rem', fontSize: '1.1rem', color: '#4CAF50' }}>
                      Detected Arms ({colorPreview.stats.armRegions?.length || 0})
                    </h3>
                    {colorPreview.stats.armRegions && colorPreview.stats.armRegions.length > 0 ? (
                      colorPreview.stats.armRegions.map((arm, idx) => {
                        const isBest = colorPreview.stats.bestArm &&
                          arm.category === colorPreview.stats.bestArm.category &&
                          arm.dominantColor === colorPreview.stats.bestArm.dominantColor;
                        return (
                          <div
                            key={idx}
                            className="segmentation-card"
                            style={{
                              border: isBest ? '2px solid #4CAF50' : '1px solid #2a2a2a',
                              backgroundColor: isBest ? 'rgba(76, 175, 80, 0.1)' : '#0f0f0f'
                            }}
                          >
                            <h4>
                              Arm {idx + 1}: {arm.categoryName}
                              {isBest && <span style={{ color: '#4CAF50', marginLeft: '0.5rem' }}>★ Best Match</span>}
                            </h4>
                            <p>
                              <strong>Dominant Color:</strong>{' '}
                              <span style={{ color: arm.dominantColor === 'A' ? '#FF5252' : '#2196F3', fontWeight: 'bold' }}>
                                Player {arm.dominantColor}
                              </span>
                            </p>
                            <p>
                              <strong>Pixels A:</strong> {arm.pixelsA || 0} | <strong>Pixels B:</strong> {arm.pixelsB || 0}
                            </p>
                            <p>
                              <strong>Total arm pixels:</strong> {arm.pixelCount || 0}
                            </p>
                            <p>
                              <strong>Vertical span:</strong> Y={arm.minY} → {arm.maxY} (Anchor Y: {arm.anchorY})
                            </p>
                          </div>
                        );
                      })
                    ) : (
                      <p>No arms detected with matching colors</p>
                    )}
                  </div>
                ) : (
                  <div className="color-preview-breakdown">
                    <div className="breakdown-card">
                      <h4>Player A band</h4>
                      <p>
                        <strong>Pixels:</strong> {colorPreview.stats.pixelsA || 0}{' '}
                        ({formatCoverage(colorPreview.stats.pixelsA, colorPreviewTotalPixels)})
                      </p>
                      <p>
                        <strong>Vertical span:</strong>{' '}
                        {colorPreview.stats.minYA ?? '—'} → {colorPreview.stats.maxYA ?? '—'}
                      </p>
                    </div>
                    <div className="breakdown-card">
                      <h4>Player B band</h4>
                      <p>
                        <strong>Pixels:</strong> {colorPreview.stats.pixelsB || 0}{' '}
                        ({formatCoverage(colorPreview.stats.pixelsB, colorPreviewTotalPixels)})
                      </p>
                      <p>
                        <strong>Vertical span:</strong>{' '}
                        {colorPreview.stats.minYB ?? '—'} → {colorPreview.stats.maxYB ?? '—'}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="multiclass-view">
            <div className="multiclass-header">
              <h2>MediaPipe Multiclass Segmentation (6 Classes)</h2>
              <p>Verifying layer detection quality. The model identifies these specific regions:</p>
            </div>

            {loadingMulticlass && (
              <div className="loading-indicator">
                <div className="spinner"></div>
                <p>Running segmentation model...</p>
              </div>
            )}

            {!loadingMulticlass && multiclassData && (
              <div className="multiclass-grid">
                {multiclassData.map((cls) => (
                  <div key={cls.id} className="multiclass-card">
                    <div className="multiclass-card-header" style={{ borderLeft: `5px solid rgb(${cls.color.join(',')})` }}>
                      <h4>{cls.id}. {cls.name}</h4>
                      <span className="multiclass-badge">{formatCoverage(cls.pixelCount, colorPreviewTotalPixels)}</span>
                    </div>
                    <p className="multiclass-desc">{cls.desc}</p>
                    <div className="multiclass-preview-container">
                      <img src={cls.preview} alt={cls.name} />
                    </div>
                    <div className="multiclass-footer">
                      {cls.pixelCount.toLocaleString()} pixels
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!loadingMulticlass && !multiclassData && (
              <div className="error-message">
                <p>Failed to load segmentation data. Check console for details.</p>
                <button onClick={handleRunMulticlass}>Retry</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default ColorPreviewModal;

