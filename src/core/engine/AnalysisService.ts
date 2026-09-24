import { Chess } from 'chess.js';
import type { Analysis } from '../types';
import { MATE_CP } from '../evaluation';
import { UciEngine, type EngineTransport, type SearchOptions } from './UciEngine';

export interface AnalyzeOptions {
  depth: number;
  multiPV?: number;
  /** Hard time cap so deep analysis never stalls the tutor. */
  maxTimeMs?: number;
  channel?: string;
  onUpdate?: (a: Analysis) => void;
}

/** Terminal positions are evaluated without the engine. */
export function terminalAnalysis(fen: string): Analysis | null {
  const c = new Chess(fen);
  if (c.isCheckmate()) {
    // Side to move is mated.
    return { fen, depth: 99, bestMove: null, lines: [{ rank: 1, depth: 99, pv: [], score: { cp: c.turn() === 'w' ? -MATE_CP : MATE_CP } }] };
  }
  if (c.isStalemate() || c.isInsufficientMaterial() || c.isDrawByFiftyMoves()) {
    return { fen, depth: 99, bestMove: null, lines: [{ rank: 1, depth: 99, pv: [], score: { cp: 0 } }] };
  }
  return null;
}

/**
 * Engine façade used by the app. It owns two engine instances so that the AI
 * opponent never waits on (or blocks) tutor analysis, and caches evaluations
 * by FEN so repeated positions are not re-searched.
 */
export class AnalysisService {
  readonly analyzer: UciEngine;
  readonly opponent: UciEngine;
  private cache = new Map<string, Analysis>();
  /** In-flight un-channelled searches, so duplicate requests share one search. */
  private inflight = new Map<string, { depth: number; promise: Promise<Analysis | null> }>();
  private cacheLimit = 3000;

  constructor(makeTransport: () => EngineTransport) {
    this.analyzer = new UciEngine(makeTransport(), 64);
    this.opponent = new UciEngine(makeTransport(), 16);
  }

  whenReady(): Promise<void> {
    return Promise.all([this.analyzer.whenReady(), this.opponent.whenReady()]).then(() => undefined);
  }

  private key(fen: string, multiPV: number): string {
    // Ignore move counters so transpositions share cache entries.
    return fen.split(' ').slice(0, 4).join(' ') + '|' + multiPV;
  }

  getCached(fen: string, depth: number, multiPV = 1): Analysis | null {
    for (let m = multiPV; m <= 5; m++) {
      const hit = this.cache.get(this.key(fen, m));
      if (hit && hit.depth >= depth) return m === multiPV ? hit : { ...hit, lines: hit.lines.slice(0, multiPV) };
    }
    return null;
  }

  private store(a: Analysis, multiPV: number): void {
    if (a.partial || a.lines.length === 0) return;
    const k = this.key(a.fen, multiPV);
    const prev = this.cache.get(k);
    if (prev && prev.depth > a.depth) return;
    this.cache.delete(k);
    this.cache.set(k, a);
    if (this.cache.size > this.cacheLimit) {
      const first = this.cache.keys().next().value;
      if (first !== undefined) this.cache.delete(first);
    }
  }

  /** Analyse a position. Resolves null if superseded on the same channel. */
  async analyze(fen: string, opts: AnalyzeOptions): Promise<Analysis | null> {
    const terminal = terminalAnalysis(fen);
    if (terminal) return terminal;
    const multiPV = opts.multiPV ?? 1;
    const cached = this.getCached(fen, opts.depth, multiPV);
    if (cached) {
      if (opts.channel) this.analyzer.cancelChannel(opts.channel);
      return cached;
    }
    const k = this.key(fen, multiPV);
    const pending = this.inflight.get(k);
    if (!opts.channel && pending && pending.depth >= opts.depth) return pending.promise;
    const search: SearchOptions = { depth: opts.depth, multiPV, movetime: opts.maxTimeMs };
    const promise = this.analyzer.search({ fen, options: search, channel: opts.channel, onUpdate: opts.onUpdate }).then((res) => {
      if (res) this.store(res, multiPV);
      if (this.inflight.get(k)?.promise === promise) this.inflight.delete(k);
      return res;
    });
    if (!opts.channel) this.inflight.set(k, { depth: opts.depth, promise });
    return promise;
  }

  cancel(channel: string): void {
    this.analyzer.cancelChannel(channel);
  }

  /** Ask the opponent engine for a move at the requested strength. */
  async opponentMove(fen: string, strength: OpponentStrength): Promise<string | null> {
    const res = await this.opponent.search({
      fen,
      channel: 'opponent',
      options: { depth: strength.depth, movetime: strength.movetime, skillLevel: strength.skill, elo: strength.elo },
    });
    return res?.bestMove ?? null;
  }

  async newGame(): Promise<void> {
    this.inflight.clear();
    await Promise.all([this.analyzer.newGame(), this.opponent.newGame()]);
  }

  terminate(): void {
    this.analyzer.terminate();
    this.opponent.terminate();
  }
}

export interface OpponentStrength {
  level: number;
  label: string;
  approxElo: number;
  skill?: number;
  elo?: number;
  depth?: number;
  movetime: number;
}

/** Difficulty ladder. Low levels use Skill Level (supports < 1320 Elo), higher ones UCI_Elo. */
export const OPPONENT_LEVELS: OpponentStrength[] = [
  { level: 1, label: 'Beginner', approxElo: 600, skill: 0, depth: 1, movetime: 100 },
  { level: 2, label: 'Novice', approxElo: 800, skill: 1, depth: 2, movetime: 150 },
  { level: 3, label: 'Casual', approxElo: 1000, skill: 3, depth: 4, movetime: 200 },
  { level: 4, label: 'Club beginner', approxElo: 1150, skill: 5, depth: 6, movetime: 300 },
  { level: 5, label: 'Club player', approxElo: 1320, elo: 1320, movetime: 400 },
  { level: 6, label: 'Intermediate', approxElo: 1500, elo: 1500, movetime: 500 },
  { level: 7, label: 'Strong club', approxElo: 1700, elo: 1700, movetime: 600 },
  { level: 8, label: 'Advanced', approxElo: 1900, elo: 1900, movetime: 700 },
  { level: 9, label: 'Expert', approxElo: 2100, elo: 2100, movetime: 800 },
  { level: 10, label: 'Master', approxElo: 2400, elo: 2400, movetime: 1000 },
  { level: 11, label: 'Grandmaster', approxElo: 2700, elo: 2700, movetime: 1200 },
  { level: 12, label: 'Full strength', approxElo: 3000, skill: 20, movetime: 1500 },
];

export function opponentLevel(level: number): OpponentStrength {
  return OPPONENT_LEVELS.find((l) => l.level === level) ?? OPPONENT_LEVELS[4];
}
