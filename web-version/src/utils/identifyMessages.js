// User-facing message helpers for the player-identification tools.
// Kept pure (no React/DOM) so they can be unit-tested and reused across handlers.

/**
 * Minimum usable width/height for a manual scan area, in image pixels.
 * Matches the 20px minimum gap the ManualScanSelector enforces between its
 * guide handles — anything below this is effectively an empty selection.
 */
export const MIN_SCAN_DIMENSION_PX = 20;

/**
 * Return a human-readable warning when a manual scan area is too small to
 * sample any meaningful pixels, or null when the area is acceptable.
 *
 * Only dimensions that are actually constrained are checked: when leftX/rightX
 * are absent the horizontal extent falls back to the full frame width (and is
 * therefore never "too small"); likewise for topY/bottomY.
 *
 * @param {{topY?:number,bottomY?:number,leftX?:number,rightX?:number}|null} bounds
 * @param {number} [minDim=MIN_SCAN_DIMENSION_PX]
 * @returns {string|null}
 */
export function describeTooSmallScanArea(bounds, minDim = MIN_SCAN_DIMENSION_PX) {
  if (!bounds || typeof bounds !== 'object') return null;

  const hasX = Number.isFinite(bounds.leftX) && Number.isFinite(bounds.rightX);
  const hasY = Number.isFinite(bounds.topY) && Number.isFinite(bounds.bottomY);

  const width = hasX ? bounds.rightX - bounds.leftX : Infinity;
  const height = hasY ? bounds.bottomY - bounds.topY : Infinity;

  if (width >= minDim && height >= minDim) return null;

  const w = Number.isFinite(width) ? Math.round(width) : '—';
  const h = Number.isFinite(height) ? Math.round(height) : '—';
  return (
    `The manual scan area is too small (${w}×${h}px). ` +
    `Drag the guide lines to cover more of the players, or turn off manual selection, then run again.`
  );
}

/**
 * Translate a raw identification error into friendly, actionable guidance.
 *
 * @param {unknown} err
 * @param {{manual?: boolean}} [opts]
 * @returns {string}
 */
export function friendlyIdentifyError(err, { manual = false } = {}) {
  const raw = (err && err.message) ? err.message : String(err);

  // WASM/Emscripten runtime aborted (e.g. "noExitRuntime ... replaced").
  if (/noexitruntime|\baborted\b/i.test(raw)) {
    return (
      'The image detector hit an internal error and needs a fresh start. ' +
      'Please reload the page and try again — if you ran another identify method first, ' +
      'reloading clears the detector so it can re-initialize.'
    );
  }

  // Too few usable pixels to cluster (need at least 2 frames with detections).
  if (/not enough frames|need at least 2|no frames|no points/i.test(raw)) {
    return manual
      ? 'Not enough coloured pixels were found inside the manual scan area — it may be too small ' +
        'or not covering the players. Try a larger area, or turn off manual selection, then run again.'
      : 'Not enough coloured pixels were found to tell the players apart. Try lowering the background ' +
        'sensitivity, or draw a manual scan area over the players, then run again.';
  }

  return 'All-All identification failed: ' + raw;
}
