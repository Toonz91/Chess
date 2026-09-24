// Local game history (localStorage). Storage failures never break the app.
import type { GameRecord, Settings } from './types';

const GAMES_KEY = 'chess-tutor.games.v1';
const CURRENT_KEY = 'chess-tutor.current.v1';
const SETTINGS_KEY = 'chess-tutor.settings.v1';
const MAX_GAMES = 100;

export interface KeyValueStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

function defaultStore(): KeyValueStore | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function read<T>(store: KeyValueStore | null, key: string, fallback: T): T {
  if (!store) return fallback;
  try {
    const raw = store.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(store: KeyValueStore | null, key: string, value: unknown): void {
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage disabled — ignore.
  }
}

export class GameHistory {
  constructor(private store: KeyValueStore | null = defaultStore()) {}

  list(): GameRecord[] {
    return read<GameRecord[]>(this.store, GAMES_KEY, []).sort((a, b) => b.startedAt - a.startedAt);
  }

  get(id: string): GameRecord | undefined {
    return this.list().find((g) => g.id === id);
  }

  save(game: GameRecord): void {
    const games = read<GameRecord[]>(this.store, GAMES_KEY, []).filter((g) => g.id !== game.id);
    games.push(game);
    games.sort((a, b) => b.startedAt - a.startedAt);
    write(this.store, GAMES_KEY, games.slice(0, MAX_GAMES));
  }

  remove(id: string): void {
    write(this.store, GAMES_KEY, this.list().filter((g) => g.id !== id));
  }

  clear(): void {
    this.store?.removeItem(GAMES_KEY);
  }

  saveCurrent(game: GameRecord | null): void {
    if (!game) this.store?.removeItem(CURRENT_KEY);
    else write(this.store, CURRENT_KEY, game);
  }

  loadCurrent(): GameRecord | null {
    return read<GameRecord | null>(this.store, CURRENT_KEY, null);
  }

  loadSettings(defaults: Settings): Settings {
    return { ...defaults, ...read<Partial<Settings>>(this.store, SETTINGS_KEY, {}) };
  }

  saveSettings(s: Settings): void {
    write(this.store, SETTINGS_KEY, s);
  }
}
