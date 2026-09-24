import { describe, expect, it } from 'vitest';
import {
  applyBackup,
  backupFileName,
  BACKUP_VERSION,
  createBackup,
  gamesToPgn,
  mergeGames,
  parseBackup,
} from '../backup';
import { CURRENT_KEY, GAMES_KEY, SETTINGS_KEY, type KeyValueStore } from '../history';
import type { GameRecord } from '../types';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

class MemStore implements KeyValueStore {
  m = new Map<string, string>();
  failOn: string | null = null;
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.failOn === k) {
      const e = new Error('QuotaExceededError');
      e.name = 'QuotaExceededError';
      throw e;
    }
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

function game(id: string, startedAt: number, over: Partial<GameRecord> = {}): GameRecord {
  return {
    id, startedAt, playerSide: 'w', aiLevel: 4, timeControlId: 'none', moves: ['e4', 'e5'], startFen: START,
    result: '1-0', termination: 'test', analyses: [], pgn: '', evalTrack: [], ...over,
  };
}

function storeWith(games: GameRecord[], settings?: object, current?: GameRecord): MemStore {
  const s = new MemStore();
  s.setItem(GAMES_KEY, JSON.stringify(games));
  if (settings) s.setItem(SETTINGS_KEY, JSON.stringify(settings));
  if (current) s.setItem(CURRENT_KEY, JSON.stringify(current));
  return s;
}

describe('backup export', () => {
  it('exports every stored key in the documented envelope', () => {
    const s = storeWith([game('a', 1)], { aiLevel: 7, bogus: 1 }, game('cur', 5, { result: '*' }));
    const b = createBackup(s, new Date('2026-09-24T10:00:00Z'));
    expect(b).toMatchObject({ app: 'chess-tutor', version: BACKUP_VERSION, exportedAt: '2026-09-24T10:00:00.000Z' });
    expect(b.data.games.map((g) => g.id)).toEqual(['a']);
    expect(b.data.currentGame?.id).toBe('cur');
    expect(b.data.settings).toEqual({ aiLevel: 7 });
    // Round trip.
    const parsed = parseBackup(JSON.stringify(b));
    expect(parsed.ok).toBe(true);
  });
  it('names the file by date', () => {
    expect(backupFileName(new Date(2026, 0, 5))).toBe('chess-tutor-backup-2026-01-05.json');
  });
});

describe('backup validation', () => {
  const valid = { app: 'chess-tutor', version: 1, exportedAt: 'x', data: { games: [game('a', 1)], currentGame: null, settings: null } };
  it('rejects invalid files with clear errors', () => {
    expect(parseBackup('not json')).toEqual({ ok: false, error: expect.stringMatching(/not valid JSON/) });
    expect(parseBackup(JSON.stringify({ ...valid, app: 'other' }))).toMatchObject({ ok: false, error: expect.stringMatching(/not a Chess Tutor/) });
    expect(parseBackup(JSON.stringify({ ...valid, version: 99 }))).toMatchObject({ ok: false, error: expect.stringMatching(/newer version/) });
    expect(parseBackup(JSON.stringify({ ...valid, version: '1' }))).toMatchObject({ ok: false });
    expect(parseBackup(JSON.stringify({ ...valid, data: { games: 'x' } }))).toMatchObject({ ok: false, error: expect.stringMatching(/list of games/) });
    expect(parseBackup(JSON.stringify({ ...valid, data: { games: [{ id: 'x' }] } }))).toMatchObject({ ok: false, error: expect.stringMatching(/Game #1/) });
  });
  it('accepts a valid file', () => {
    const r = parseBackup(JSON.stringify(valid));
    expect(r.ok && r.backup.data.games).toHaveLength(1);
  });
});

describe('merge & import', () => {
  it('de-duplicates games by id and by start time + moves, keeping the more complete copy', () => {
    const existing = [game('a', 1, { result: '*' }), game('b', 2)];
    const incoming = [game('a', 1), game('b-other-id', 2), game('c', 3)];
    const r = mergeGames(existing, incoming);
    expect(r.games.map((g) => g.id)).toEqual(['c', 'b', 'a']);
    expect(r.added).toBe(1);
    expect(r.updated).toBe(1); // 'a' finished version replaces the unfinished one
    expect(r.games.find((g) => g.id === 'a')!.result).toBe('1-0');
  });

  it('merge keeps existing settings and adds new games', () => {
    const s = storeWith([game('a', 1)], { aiLevel: 3 });
    const backup = createBackup(storeWith([game('a', 1), game('z', 9)], { aiLevel: 9 }));
    const sum = applyBackup(s, backup, 'merge');
    expect(sum).toMatchObject({ gamesAdded: 1, gamesTotal: 2, settingsApplied: false });
    expect(JSON.parse(s.getItem(SETTINGS_KEY)!)).toEqual({ aiLevel: 3 });
  });

  it('replace overwrites games, settings and the in-progress game', () => {
    const s = storeWith([game('old', 1)], { aiLevel: 3 }, game('cur-old', 4, { result: '*' }));
    const backup = createBackup(storeWith([game('new', 2)], { aiLevel: 9 }, game('cur-new', 5, { result: '*' })));
    const sum = applyBackup(s, backup, 'replace');
    expect(sum).toMatchObject({ gamesTotal: 1, settingsApplied: true, currentGameApplied: true });
    expect(JSON.parse(s.getItem(GAMES_KEY)!).map((g: GameRecord) => g.id)).toEqual(['new']);
    expect(JSON.parse(s.getItem(SETTINGS_KEY)!)).toEqual({ aiLevel: 9 });
    expect(JSON.parse(s.getItem(CURRENT_KEY)!).id).toBe('cur-new');
  });

  it('never leaves data half-written when storage fails', () => {
    const s = storeWith([game('a', 1)], { aiLevel: 3 });
    const before = new Map(s.m);
    s.failOn = SETTINGS_KEY;
    const backup = createBackup(storeWith([game('b', 2)], { aiLevel: 9 }));
    expect(() => applyBackup(s, backup, 'replace')).toThrow(/storage space/);
    expect(s.m).toEqual(before);
  });
});

describe('PGN export', () => {
  it('exports all games, rebuilding PGN when missing', () => {
    const pgn = gamesToPgn([game('b', 2, { pgn: '[Event "x"]\n\n1. d4 *' }), game('a', 1)]);
    expect(pgn).toMatch(/1\. e4 e5/);
    expect(pgn.indexOf('1. e4')).toBeLessThan(pgn.indexOf('1. d4'));
  });
});
