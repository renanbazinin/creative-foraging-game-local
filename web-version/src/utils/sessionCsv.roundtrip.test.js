import { describe, it, expect } from 'vitest';
import {
  sessionDocumentToMovesCsv,
  parseCsvRows,
  legacyMovesCsvToSessionDocument,
} from './sessionCsv.js';

describe('sessionDocumentToMovesCsv', () => {
  it('returns an empty string when there are no moves', () => {
    expect(sessionDocumentToMovesCsv({})).toBe('');
    expect(sessionDocumentToMovesCsv({ moves: [] })).toBe('');
    expect(sessionDocumentToMovesCsv(null)).toBe('');
  });

  it('excludes camera_frame and __v from the output', () => {
    const csv = sessionDocumentToMovesCsv({
      moves: [{ player: 'Player A', blockId: 1, camera_frame: 'HUGE_BASE64', __v: 0 }],
    });
    const header = csv.split('\n')[0];
    expect(header).not.toContain('camera_frame');
    expect(header).not.toContain('__v');
    expect(csv).not.toContain('HUGE_BASE64');
  });

  it('serialises array/object cells as quoted JSON', () => {
    const csv = sessionDocumentToMovesCsv({
      moves: [{ player: 'Player A', position: [0.1, 0.2] }],
    });
    expect(csv).toContain('"[0.1,0.2]"');
  });

  it('emits the legacy _id column (mirroring moveId) so importers can recover the id', () => {
    const csv = sessionDocumentToMovesCsv({
      moves: [{ player: 'Player A', moveId: 'm2' }],
    });
    const header = csv.split('\n')[0].split(',');
    // Both the moveId column and its legacy _id mirror are present.
    expect(header).toContain('_id');
    expect(header).toContain('moveId');
    // The _id cell is populated from moveId when no explicit _id exists.
    expect(csv.split('\n')[1]).toContain('m2');
  });
});

describe('parseCsvRows', () => {
  it('parses a simple grid', () => {
    expect(parseCsvRows('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('honours quoted fields containing commas and newlines', () => {
    expect(parseCsvRows('"x,y",z')).toEqual([['x,y', 'z']]);
    expect(parseCsvRows('"line1\nline2",z')).toEqual([['line1\nline2', 'z']]);
  });

  it('unescapes doubled quotes', () => {
    expect(parseCsvRows('"a""b",c')).toEqual([['a"b', 'c']]);
  });

  it('strips a leading BOM and trailing blank rows', () => {
    expect(parseCsvRows('﻿a,b\n1,2\n\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsvRows('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('legacyMovesCsvToSessionDocument', () => {
  it('returns null for empty or header-only input', () => {
    expect(legacyMovesCsvToSessionDocument('')).toBeNull();
    expect(legacyMovesCsvToSessionDocument('  ')).toBeNull();
    expect(legacyMovesCsvToSessionDocument('sessionGameId,player')).toBeNull();
  });

  it('returns null when the first move lacks a sessionGameId', () => {
    const csv = 'player,blockId\nPlayer A,1';
    expect(legacyMovesCsvToSessionDocument(csv)).toBeNull();
  });

  it('coerces numeric, boolean and JSON cells', () => {
    const csv = [
      'sessionGameId,subjectId,blockId,flag,position',
      'S1,U1,3,true,"[0.1,0.2]"',
    ].join('\n');
    const doc = legacyMovesCsvToSessionDocument(csv);
    expect(doc.sessionGameId).toBe('S1');
    expect(doc.subjectId).toBe('U1');
    expect(doc.moves).toHaveLength(1);
    expect(doc.moves[0].blockId).toBe(3);
    expect(doc.moves[0].flag).toBe(true);
    expect(doc.moves[0].position).toEqual([0.1, 0.2]);
  });

  it('falls back to sessionGameId for a missing subjectId', () => {
    const doc = legacyMovesCsvToSessionDocument('sessionGameId,player\nS7,Player A');
    expect(doc.subjectId).toBe('S7');
  });
});

describe('CSV round-trip (document → csv → document)', () => {
  it('preserves core fields, drops camera frames, and restores types', () => {
    const doc = {
      sessionGameId: 'S1',
      moves: [
        {
          sessionGameId: 'S1',
          subjectId: 'U1',
          condition: 'A',
          player: 'Player A',
          blockId: 3,
          position: [0.1, 0.2],
          camera_frame: 'SHOULD_BE_DROPPED',
        },
        {
          sessionGameId: 'S1',
          subjectId: 'U1',
          condition: 'A',
          player: 'Player B',
          blockId: 4,
          position: [0.3, 0.4],
          moveId: 'm2',
        },
      ],
    };

    const csv = sessionDocumentToMovesCsv(doc);
    const back = legacyMovesCsvToSessionDocument(csv);

    expect(back.sessionGameId).toBe('S1');
    expect(back.subjectId).toBe('U1');
    expect(back.condition).toBe('A');
    expect(back.moves).toHaveLength(2);

    expect(back.moves[0].player).toBe('Player A');
    expect(back.moves[0].blockId).toBe(3);
    expect(back.moves[0].position).toEqual([0.1, 0.2]);
    expect(back.moves[0].camera_frame).toBeUndefined();

    // moveId survives via the legacy _id column.
    expect(back.moves[1].moveId).toBe('m2');
  });
});
