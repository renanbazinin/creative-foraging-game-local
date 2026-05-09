import { describe, it, expect } from 'vitest';
import { LEGACY_EXPORT_CSV_COLUMNS } from './sessionCsv.js';

describe('sessionCsv', () => {
  it('preserves legacy export column order', () => {
    expect(LEGACY_EXPORT_CSV_COLUMNS[0]).toBe('timestamp');
    expect(LEGACY_EXPORT_CSV_COLUMNS.at(-1)).toBe('_id');
    expect(LEGACY_EXPORT_CSV_COLUMNS).toContain('sessionGameId');
    expect(LEGACY_EXPORT_CSV_COLUMNS).toContain('moveId');
  });
});
