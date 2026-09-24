// Backup / restore of all locally stored data (to move between devices), plus PGN export.
import { Chess } from 'chess.js';
import type { GameRecord, Settings } from './types';
import { CURRENT_KEY, GAMES_KEY, MAX_GAMES, SETTINGS_KEY, type KeyValueStore } from './history';
import { DEFAULT_SETTINGS } from './settings';

export const BACKUP_APP = 'chess-tutor';
export const BACKUP_VERSION = 1;

export interface BackupData {
  games: GameRecord[];
  currentGame: GameRecord | null;
  settings: Partial<Settings> | null;
}

export interface Backup {
  app: typeof BACKUP_APP;
  version: number;
  exportedAt: string;
  data: BackupData;
}

export type ParseResult = { ok: true; backup: Backup } | { ok: false; error: string };

export interface ImportSummary {
  mode: 'merge' | 'replace';
  gamesImported: number;
  gamesAdded: number;
  gamesUpdated: number;
  gamesTotal: number;
  gamesDropped: number;
  settingsApplied: boolean;
  currentGameApplied: boolean;
}

function readJson<T>(store: KeyValueStore, key: string, fallback: T): T {
  try {
    const raw = store.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Snapshot everything the app keeps in storage. */
export function createBackup(store: KeyValueStore, now = new Date()): Backup {
  const games = readJson<unknown>(store, GAMES_KEY, []);
  const current = readJson<unknown>(store, CURRENT_KEY, null);
  const settings = readJson<unknown>(store, SETTINGS_KEY, null);
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    data: {
      games: Array.isArray(games) ? games.filter(isGameRecord) : [],
      currentGame: isGameRecord(current) ? current : null,
      settings: sanitizeSettings(settings),
    },
  };
}

export function backupFileName(now = new Date(), ext = 'json', prefix = 'chess-tutor-backup'): string {
  const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `${prefix}-${d}.${ext}`;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Structural check of a stored game record (enough to be safely displayed and re-analysed). */
export function isGameRecord(v: unknown): v is GameRecord {
  if (!isObj(v)) return false;
  return (
    typeof v.id === 'string' &&
    v.id.length > 0 &&
    typeof v.startedAt === 'number' &&
    Number.isFinite(v.startedAt) &&
    (v.playerSide === 'w' || v.playerSide === 'b') &&
    typeof v.startFen === 'string' &&
    Array.isArray(v.moves) &&
    v.moves.every((m) => typeof m === 'string') &&
    Array.isArray(v.analyses) &&
    v.analyses.every((a) => isObj(a) && typeof a.ply === 'number' && typeof a.classification === 'string') &&
    typeof v.result === 'string' &&
    ['1-0', '0-1', '1/2-1/2', '*'].includes(v.result) &&
    (v.evalTrack === undefined || Array.isArray(v.evalTrack))
  );
}

/** Keep only known settings keys whose value type matches the defaults. */
export function sanitizeSettings(v: unknown): Partial<Settings> | null {
  if (!isObj(v)) return null;
  const out: Record<string, unknown> = {};
  for (const [k, def] of Object.entries(DEFAULT_SETTINGS)) {
    if (k in v && typeof v[k] === typeof def) out[k] = v[k];
  }
  return Object.keys(out).length ? (out as Partial<Settings>) : null;
}

/** Parse and validate a backup file's text. Never throws. */
export function parseBackup(text: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This file is not valid JSON.' };
  }
  if (!isObj(json) || json.app !== BACKUP_APP) return { ok: false, error: 'This is not a Chess Tutor backup file.' };
  if (typeof json.version !== 'number' || !Number.isInteger(json.version) || json.version < 1)
    return { ok: false, error: 'The backup file has no valid version number.' };
  if (json.version > BACKUP_VERSION)
    return { ok: false, error: `This backup was made by a newer version of Chess Tutor (format ${json.version}). Please update the app first.` };
  const data = json.data;
  if (!isObj(data)) return { ok: false, error: 'The backup file has no data section.' };
  if (!Array.isArray(data.games)) return { ok: false, error: 'The backup file has no list of games.' };
  const bad = data.games.findIndex((g) => !isGameRecord(g));
  if (bad >= 0) return { ok: false, error: `Game #${bad + 1} in the backup is damaged or has an unknown format.` };
  if (data.currentGame !== undefined && data.currentGame !== null && !isGameRecord(data.currentGame))
    return { ok: false, error: 'The saved in-progress game in the backup is damaged.' };
  if (data.settings !== undefined && data.settings !== null && !isObj(data.settings))
    return { ok: false, error: 'The settings in the backup are damaged.' };
  return {
    ok: true,
    backup: {
      app: BACKUP_APP,
      version: json.version,
      exportedAt: typeof json.exportedAt === 'string' ? json.exportedAt : '',
      data: {
        games: data.games as GameRecord[],
        currentGame: (data.currentGame as GameRecord | null | undefined) ?? null,
        settings: sanitizeSettings(data.settings),
      },
    },
  };
}

/** Same game if the id matches, or it started at the same time with the same moves. */
function sameGame(a: GameRecord, b: GameRecord): boolean {
  return a.id === b.id || (a.startedAt === b.startedAt && a.moves.join(' ') === b.moves.join(' '));
}

/** Prefer the more complete copy of a duplicated game. */
function better(a: GameRecord, b: GameRecord): GameRecord {
  const score = (g: GameRecord) => (g.result !== '*' ? 1e6 : 0) + g.moves.length * 1000 + g.analyses.length + (g.endedAt ? 1 : 0);
  return score(b) > score(a) ? b : a;
}

/** Merge two game lists, de-duplicating by id / start time. Newest first. */
export function mergeGames(existing: GameRecord[], incoming: GameRecord[]): { games: GameRecord[]; added: number; updated: number } {
  const out = [...existing];
  let added = 0;
  let updated = 0;
  for (const g of incoming) {
    const i = out.findIndex((e) => sameGame(e, g));
    if (i < 0) {
      out.push(g);
      added++;
    } else {
      const pick = better(out[i], g);
      if (pick !== out[i]) {
        out[i] = pick;
        updated++;
      }
    }
  }
  out.sort((a, b) => b.startedAt - a.startedAt);
  return { games: out, added, updated };
}

/**
 * Apply a validated backup. All new values are computed first; if any write
 * fails (e.g. storage quota) the previous values are restored, so existing data
 * is never left half-written.
 */
export function applyBackup(store: KeyValueStore, backup: Backup, mode: 'merge' | 'replace'): ImportSummary {
  const existingGames = readJson<unknown>(store, GAMES_KEY, []);
  const current = Array.isArray(existingGames) ? existingGames.filter(isGameRecord) : [];
  const incoming = backup.data.games;

  let games: GameRecord[];
  let added: number;
  let updated = 0;
  if (mode === 'replace') {
    games = mergeGames([], incoming).games; // also de-duplicates within the file
    added = games.length;
  } else {
    ({ games, added, updated } = mergeGames(current, incoming));
  }
  const dropped = Math.max(0, games.length - MAX_GAMES);
  games = games.slice(0, MAX_GAMES);

  const writes = new Map<string, string | null>();
  writes.set(GAMES_KEY, JSON.stringify(games));

  let settingsApplied = false;
  const existingSettings = store.getItem(SETTINGS_KEY);
  if (backup.data.settings && (mode === 'replace' || !existingSettings)) {
    writes.set(SETTINGS_KEY, JSON.stringify(backup.data.settings));
    settingsApplied = true;
  } else if (mode === 'replace' && !backup.data.settings) {
    writes.set(SETTINGS_KEY, null);
  }

  let currentGameApplied = false;
  const existingCurrent = store.getItem(CURRENT_KEY);
  const incomingCurrent = backup.data.currentGame && backup.data.currentGame.result === '*' ? backup.data.currentGame : null;
  if (mode === 'replace') {
    writes.set(CURRENT_KEY, incomingCurrent ? JSON.stringify(incomingCurrent) : null);
    currentGameApplied = !!incomingCurrent;
  } else if (incomingCurrent && !existingCurrent) {
    writes.set(CURRENT_KEY, JSON.stringify(incomingCurrent));
    currentGameApplied = true;
  }

  const previous = new Map<string, string | null>();
  for (const k of writes.keys()) previous.set(k, store.getItem(k));
  try {
    for (const [k, v] of writes) {
      if (v === null) store.removeItem(k);
      else store.setItem(k, v);
    }
  } catch (e) {
    for (const [k, v] of previous) {
      try {
        if (v === null) store.removeItem(k);
        else store.setItem(k, v);
      } catch {
        /* best effort */
      }
    }
    const quota = e instanceof Error && /quota/i.test(e.name + e.message);
    throw new Error(quota ? 'Not enough storage space on this device to import the backup. Nothing was changed.' : 'Could not save the imported data. Nothing was changed.');
  }

  return {
    mode,
    gamesImported: incoming.length,
    gamesAdded: added,
    gamesUpdated: updated,
    gamesTotal: games.length,
    gamesDropped: dropped,
    settingsApplied,
    currentGameApplied,
  };
}

/** PGN text for one stored game (uses the saved PGN, rebuilding it from SAN if missing). */
export function gameToPgn(g: GameRecord): string {
  if (g.pgn && g.pgn.trim()) return g.pgn.trim();
  const c = new Chess(g.startFen);
  for (const san of g.moves) {
    try {
      c.move(san);
    } catch {
      break;
    }
  }
  c.setHeader('Event', 'Chess Tutor game');
  c.setHeader('Date', new Date(g.startedAt).toISOString().slice(0, 10).replace(/-/g, '.'));
  c.setHeader('White', g.playerSide === 'w' ? 'You' : `Stockfish (level ${g.aiLevel})`);
  c.setHeader('Black', g.playerSide === 'b' ? 'You' : `Stockfish (level ${g.aiLevel})`);
  c.setHeader('Result', g.result);
  return c.pgn();
}

/** All games in one PGN file, oldest first. */
export function gamesToPgn(games: GameRecord[]): string {
  return [...games]
    .sort((a, b) => a.startedAt - b.startedAt)
    .map(gameToPgn)
    .join('\n\n') + '\n';
}
