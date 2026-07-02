import { describe, it, expect } from 'vitest';
import { normalizeSessionDocument, flatSessionForStorage } from './sessionNormalize.js';

describe('normalizeSessionDocument', () => {
  it('returns null for non-objects', () => {
    expect(normalizeSessionDocument(null)).toBeNull();
    expect(normalizeSessionDocument(undefined)).toBeNull();
    expect(normalizeSessionDocument('nope')).toBeNull();
    expect(normalizeSessionDocument(42)).toBeNull();
  });

  it('lifts legacy sessionInfo fields to the top level as strings', () => {
    const raw = {
      sessionInfo: {
        id: 42,
        condition: 'C1',
        date: '2020-01-01',
        colorA: '#ff0000',
        colorB: '#0000ff',
      },
      moves: [],
    };
    const n = normalizeSessionDocument(raw);
    expect(n.sessionGameId).toBe('42');
    expect(n.subjectId).toBe('42');
    expect(n.condition).toBe('C1');
    expect(n.date).toBe('2020-01-01');
    expect(n.colorA).toBe('#ff0000');
    expect(n.colorB).toBe('#0000ff');
  });

  it('prefers explicit sessionGameId/subjectId over the shared id', () => {
    const raw = { sessionInfo: { id: 1, sessionGameId: 7, subjectId: 9 }, moves: [] };
    const n = normalizeSessionDocument(raw);
    expect(n.sessionGameId).toBe('7');
    expect(n.subjectId).toBe('9');
  });

  it('backfills moveId from _id on legacy moves', () => {
    const raw = {
      sessionInfo: { id: 1 },
      moves: [{ _id: 'abc' }, { moveId: 'keep' }, { _id: 123 }],
    };
    const n = normalizeSessionDocument(raw);
    expect(n.moves[0].moveId).toBe('abc');
    expect(n.moves[1].moveId).toBe('keep');
    expect(n.moves[2].moveId).toBe('123'); // numeric _id stringified
  });

  it('passes through already-flat documents and normalises their moves', () => {
    const raw = { sessionGameId: 'S1', subjectId: 'U1', moves: [{ _id: 5, player: 'Player A' }] };
    const n = normalizeSessionDocument(raw);
    expect(n.sessionGameId).toBe('S1');
    expect(n.moves[0].moveId).toBe('5');
    expect(n.moves[0].player).toBe('Player A');
  });

  it('tolerates a missing/invalid moves array on flat docs', () => {
    expect(normalizeSessionDocument({ sessionGameId: 'S1' }).moves).toBeUndefined();
    expect(normalizeSessionDocument({ sessionInfo: { id: 1 } }).moves).toEqual([]);
  });
});

describe('flatSessionForStorage', () => {
  it('returns null when there is no resolvable sessionGameId', () => {
    expect(flatSessionForStorage({ moves: [] })).toBeNull();
    expect(flatSessionForStorage(null)).toBeNull();
  });

  it('strips the legacy envelope but keeps core fields and moves', () => {
    const raw = {
      sessionInfo: { id: 5, condition: 'B' },
      startTime: 't0',
      endTime: 't1',
      duration: 100,
      summary: { foo: 1 },
      braceletHistory: [1, 2, 3],
      moves: [{ _id: 'm1' }],
    };
    const out = flatSessionForStorage(raw);
    expect(out.sessionGameId).toBe('5');
    expect(out.condition).toBe('B');
    expect(out.moves).toHaveLength(1);
    expect(out.moves[0].moveId).toBe('m1');
    // Envelope fields removed.
    expect(out.sessionInfo).toBeUndefined();
    expect(out.startTime).toBeUndefined();
    expect(out.endTime).toBeUndefined();
    expect(out.duration).toBeUndefined();
    expect(out.summary).toBeUndefined();
    expect(out.braceletHistory).toBeUndefined();
  });

  it('always yields an array of moves even when the source omits them', () => {
    const out = flatSessionForStorage({ sessionGameId: 'S9' });
    expect(Array.isArray(out.moves)).toBe(true);
    expect(out.moves).toHaveLength(0);
  });
});
