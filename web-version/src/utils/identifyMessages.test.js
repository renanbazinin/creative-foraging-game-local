import { describe, it, expect } from 'vitest';
import {
  MIN_SCAN_DIMENSION_PX,
  describeTooSmallScanArea,
  friendlyIdentifyError,
} from './identifyMessages.js';

describe('describeTooSmallScanArea', () => {
  it('returns null when there are no bounds', () => {
    expect(describeTooSmallScanArea(null)).toBeNull();
    expect(describeTooSmallScanArea(undefined)).toBeNull();
    expect(describeTooSmallScanArea('nope')).toBeNull();
  });

  it('flags a zero-area selection (saved without dragging)', () => {
    const msg = describeTooSmallScanArea({ topY: 0, bottomY: 0, leftX: 0, rightX: 0 });
    expect(msg).toMatch(/too small/i);
    expect(msg).toContain('0×0px');
  });

  it('flags a selection thinner than the minimum in either dimension', () => {
    expect(describeTooSmallScanArea({ topY: 0, bottomY: 10, leftX: 0, rightX: 500 })).toMatch(/too small/i);
    expect(describeTooSmallScanArea({ topY: 0, bottomY: 500, leftX: 100, rightX: 110 })).toMatch(/too small/i);
  });

  it('accepts an area at or above the minimum in both dimensions', () => {
    expect(describeTooSmallScanArea({ topY: 0, bottomY: 200, leftX: 0, rightX: 200 })).toBeNull();
    expect(describeTooSmallScanArea({
      topY: 0, bottomY: MIN_SCAN_DIMENSION_PX, leftX: 0, rightX: MIN_SCAN_DIMENSION_PX,
    })).toBeNull();
  });

  it('only validates constrained dimensions (missing X ⇒ full-width, never too small)', () => {
    // Legacy bounds with only a Y band and a healthy height.
    expect(describeTooSmallScanArea({ topY: 0, bottomY: 300 })).toBeNull();
    // Y band present but too thin ⇒ still flagged even without X.
    expect(describeTooSmallScanArea({ topY: 0, bottomY: 5 })).toMatch(/too small/i);
  });

  it('honours a custom minimum dimension', () => {
    expect(describeTooSmallScanArea({ topY: 0, bottomY: 30, leftX: 0, rightX: 30 }, 50)).toMatch(/too small/i);
    expect(describeTooSmallScanArea({ topY: 0, bottomY: 60, leftX: 0, rightX: 60 }, 50)).toBeNull();
  });
});

describe('friendlyIdentifyError', () => {
  it('maps the WASM abort / noExitRuntime error to a reload hint', () => {
    const err = new Error('Aborted(Module.noExitRuntime has been replaced with plain noExitRuntime ...)');
    const msg = friendlyIdentifyError(err);
    expect(msg).toMatch(/reload/i);
    expect(msg).not.toMatch(/noExitRuntime/);
  });

  it('maps the not-enough-pixels error, tailored to manual vs automatic', () => {
    const err = new Error('Not enough frames with detectable pixels (need at least 2)');
    expect(friendlyIdentifyError(err, { manual: true })).toMatch(/manual scan area/i);
    expect(friendlyIdentifyError(err, { manual: false })).toMatch(/background\s+sensitivity/i);
  });

  it('falls back to the raw message for unknown errors', () => {
    expect(friendlyIdentifyError(new Error('boom'))).toBe('All-All identification failed: boom');
  });

  it('tolerates non-Error inputs', () => {
    expect(friendlyIdentifyError('plain string')).toContain('plain string');
  });
});
