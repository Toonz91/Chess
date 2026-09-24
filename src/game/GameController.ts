// Game state controller: owns the authoritative chess position (FEN), clocks,
// the AI opponent loop and asynchronous tutor analysis. React subscribes to
// immutable snapshots. Every async continuation is guarded by a generation
// token + position check so stale engine output is never applied.
import { Chess, type PieceSymbol, type Square } from 'chess.js';
import type { AnalysisService } from '../core/engine/AnalysisService';
import { opponentLevel } from '../core/engine/AnalysisService';
import type { GameHistory } from '../core/history';
import type { Classification, GameRecord, MoveAnalysis, Score, Settings, Side } from '../core/types';
import { analyzeUserMove, buildMoveAnalysis } from '../core/tutor';
import { timeControl } from '../core/settings';
import { openingName } from '../core/openings';
import { uciToMove } from '../core/board';
import { winChance } from '../core/evaluation';
import { judgeAttempt, type LearnVerdict } from '../core/training';

export interface PlayedMove {
  san: string;
  uci: string;
  from: string;
  to: string;
  color: Side;
  piece: string;
  fenBefore: string;
  fenAfter: string;
  thinkMs?: number;
}

export type { LearnVerdict };

export interface LearningAttempt {
  uci: string;
  san: string;
  verdict: LearnVerdict;
  classification: Classification;
  text: string;
}

export interface LearningState {
  ply: number;
  fen: string;
  original: MoveAnalysis;
  attempts: LearningAttempt[];
  status: 'trying' | 'checking' | 'solved' | 'revealed';
}

export interface BlunderPrompt {
  uci: string;
  san: string;
  message: string;
  hint?: string;
}

export interface LiveEval {
  fen: string;
  score: Score;
  depth: number;
  pv: string[];
}

export interface GameSnapshot {
  id: string;
  startFen: string;
  fen: string;
  moves: PlayedMove[];
  playerSide: Side;
  turn: Side;
  inCheck: boolean;
  status: 'playing' | 'over';
  result: GameRecord['result'];
  termination: string;
  aiThinking: boolean;
  analyses: Record<number, MoveAnalysis>;
  pending: number[];
  liveEval: LiveEval | null;
  clocks: { w: number; b: number };
  clockSide: Side | null;
  clockStartedAt: number | null;
  timed: boolean;
  /** Ply whose tutor alert is open (unacknowledged). */
  alertPly: number | null;
  learning: LearningState | null;
  blunderPrompt: BlunderPrompt | null;
  checkingMove: boolean;
  warning: string | null;
  awaitingTutor: boolean;
  settings: Settings;
  startedAt: number;
  trainingMistakes: MoveAnalysis[];
  branched: boolean;
  savedToHistory: boolean;
}

const SEVERITY: Record<string, number> = { inaccuracy: 1, miss: 2, mistake: 2, blunder: 3 };

export function severity(c: Classification): number {
  return SEVERITY[c] ?? 0;
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export class GameController {
  private listeners = new Set<() => void>();
  private chess = new Chess();
  private token = 0;
  private s: GameSnapshot;
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private thinkStart: number | null = null;
  private thinkAccum = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private service: AnalysisService, private history: GameHistory, settings: Settings) {
    this.s = this.freshSnapshot(settings, 'w');
    this.clockTimer = setInterval(() => this.checkFlag(), 200);
  }

  // ---------- subscription ----------
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = (): GameSnapshot => this.s;

  private set(patch: Partial<GameSnapshot>): void {
    this.s = { ...this.s, ...patch };
    this.listeners.forEach((l) => l());
    this.scheduleSave();
  }

  dispose(): void {
    if (this.clockTimer) clearInterval(this.clockTimer);
  }

  private freshSnapshot(settings: Settings, side: Side): GameSnapshot {
    const tc = timeControl(settings.timeControlId);
    return {
      id: newId(),
      startFen: START_FEN,
      fen: START_FEN,
      moves: [],
      playerSide: side,
      turn: 'w',
      inCheck: false,
      status: 'playing',
      result: '*',
      termination: '',
      aiThinking: false,
      analyses: {},
      pending: [],
      liveEval: null,
      clocks: { w: tc.initialMs, b: tc.initialMs },
      clockSide: null,
      clockStartedAt: null,
      timed: tc.initialMs > 0,
      alertPly: null,
      learning: null,
      blunderPrompt: null,
      checkingMove: false,
      warning: null,
      awaitingTutor: false,
      settings,
      startedAt: Date.now(),
      trainingMistakes: [],
      branched: false,
      savedToHistory: false,
    };
  }

  // ---------- lifecycle ----------
  newGame(settings: Settings): void {
    if (this.s.status === 'playing' && this.s.moves.length >= 4) {
      // Keep abandoned games for review and coaching statistics.
      this.history.save({ ...this.toRecord(), termination: 'Abandoned' });
    }
    this.token++;
    this.service.newGame().catch(() => {});
    const side: Side = settings.playerSide === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : settings.playerSide;
    this.chess = new Chess();
    this.thinkAccum = 0;
    this.thinkStart = null;
    this.s = this.freshSnapshot(settings, side);
    this.set({});
    this.afterPositionChange();
  }

  rematch(): void {
    const flipped: Settings = { ...this.s.settings, playerSide: this.s.playerSide === 'w' ? 'b' : 'w' };
    this.newGame(flipped);
  }

  updateSettings(settings: Settings): void {
    // Tutor/blunder/learning settings apply immediately; side/time/level on next game.
    this.set({ settings: { ...settings, playerSide: this.s.settings.playerSide, timeControlId: this.s.settings.timeControlId } });
  }

  /** Restore an unfinished game saved in localStorage. */
  resume(rec: GameRecord, settings: Settings): boolean {
    try {
      const c = new Chess(rec.startFen);
      const moves: PlayedMove[] = [];
      for (const san of rec.moves) {
        const before = c.fen();
        const m = c.move(san);
        moves.push({ san: m.san, uci: m.from + m.to + (m.promotion ?? ''), from: m.from, to: m.to, color: m.color, piece: m.piece, fenBefore: before, fenAfter: c.fen() });
      }
      this.token++;
      this.chess = c;
      const tc = timeControl(rec.timeControlId);
      const analyses: Record<number, MoveAnalysis> = {};
      rec.analyses.forEach((a) => (analyses[a.ply] = a));
      this.s = {
        ...this.freshSnapshot({ ...settings, timeControlId: rec.timeControlId, aiLevel: rec.aiLevel, playerSide: rec.playerSide }, rec.playerSide),
        id: rec.id,
        startFen: rec.startFen,
        moves,
        analyses,
        startedAt: rec.startedAt,
        clocks: rec.clocks ?? { w: tc.initialMs, b: tc.initialMs },
        trainingMistakes: rec.trainingMistakes ?? [],
        branched: !!rec.branched,
      };
      this.syncPosition();
      this.afterPositionChange();
      return true;
    } catch {
      return false;
    }
  }

  private syncPosition(): void {
    this.s = { ...this.s, fen: this.chess.fen(), turn: this.chess.turn(), inCheck: this.chess.inCheck() };
  }

  // ---------- clocks ----------
  private runClock(side: Side | null): void {
    const now = Date.now();
    const clocks = { ...this.s.clocks };
    if (this.s.clockSide && this.s.clockStartedAt !== null && this.s.timed) {
      clocks[this.s.clockSide] = Math.max(0, clocks[this.s.clockSide] - (now - this.s.clockStartedAt));
    }
    // Track user think time independent of time control.
    if (this.thinkStart !== null) {
      this.thinkAccum += now - this.thinkStart;
      this.thinkStart = null;
    }
    if (side === this.s.playerSide) this.thinkStart = now;
    this.s = { ...this.s, clocks, clockSide: side, clockStartedAt: side ? now : null };
  }

  /** Decide which clock should run given the current state. */
  private updateClock(): void {
    const s = this.s;
    let side: Side | null = null;
    if (s.status === 'playing' && !s.learning && !s.blunderPrompt && !s.awaitingTutor) {
      if (s.turn === s.playerSide) side = s.alertPly !== null ? null : s.playerSide;
      else side = s.turn;
    }
    if (side !== s.clockSide) this.runClock(side);
  }

  private checkFlag(): void {
    const s = this.s;
    if (!s.timed || s.status !== 'playing' || !s.clockSide || s.clockStartedAt === null) return;
    const left = s.clocks[s.clockSide] - (Date.now() - s.clockStartedAt);
    if (left <= 0) {
      const flagged = s.clockSide;
      const winner: Side = flagged === 'w' ? 'b' : 'w';
      const winnerHasMaterial = this.chess.board().some((row) => row.some((p) => p && p.color === winner && p.type !== 'k'));
      this.endGame(winnerHasMaterial ? (winner === 'w' ? '1-0' : '0-1') : '1/2-1/2', winnerHasMaterial ? `${flagged === 'w' ? 'White' : 'Black'} lost on time` : 'Timeout vs insufficient material');
    }
  }

  // ---------- moves ----------
  legalMoves(square: string): { to: string; promotion?: string; captured?: string }[] {
    if (this.s.status !== 'playing') return [];
    const fen = this.s.learning ? this.s.learning.fen : this.chess.fen();
    const c = new Chess(fen);
    if (c.turn() !== this.s.playerSide) return [];
    return c.moves({ square: square as Square, verbose: true }).map((m) => ({ to: m.to, promotion: m.promotion, captured: m.captured }));
  }

  canUserMove(): boolean {
    const s = this.s;
    if (s.status !== 'playing' || s.blunderPrompt || s.checkingMove) return false;
    if (s.learning) return s.learning.status === 'trying';
    return s.turn === s.playerSide && !s.awaitingTutor;
  }

  /** User attempts a move. Returns false if illegal/not allowed. */
  async userMove(from: string, to: string, promotion?: string): Promise<boolean> {
    if (!this.canUserMove()) return false;
    const s = this.s;
    const fenBefore = s.learning ? s.learning.fen : this.chess.fen();
    const probe = new Chess(fenBefore);
    let mv;
    try {
      mv = probe.move({ from, to, promotion: (promotion as PieceSymbol) ?? 'q' });
    } catch {
      return false;
    }
    const uci = mv.from + mv.to + (mv.promotion ?? '');
    if (s.learning) {
      this.learningAttempt(uci);
      return true;
    }
    if (s.settings.blunderCheck === 'ask' || s.settings.blunderCheck === 'full') {
      const ok = await this.blunderCheck(fenBefore, uci, mv.san);
      if (!ok) return true; // prompt shown (or aborted)
    }
    this.commitUserMove(uci);
    return true;
  }

  private async blunderCheck(fenBefore: string, uci: string, san: string): Promise<boolean> {
    const token = this.token;
    this.set({ checkingMove: true, alertPly: null });
    const depth = Math.min(12, this.s.settings.analysisDepth);
    const probe = new Chess(fenBefore);
    uciToMove(probe, uci);
    const [before, after] = await Promise.all([
      this.service.analyze(fenBefore, { depth, multiPV: 3, maxTimeMs: 2500 }),
      this.service.analyze(probe.fen(), { depth, multiPV: 1, maxTimeMs: 2500 }),
    ]);
    if (token !== this.token || this.chess.fen() !== fenBefore) return false;
    this.set({ checkingMove: false });
    if (!before || !after) return true;
    const a = buildMoveAnalysis({ ply: this.s.moves.length, fenBefore, playedUci: uci, history: this.historyForTutor() }, before, after);
    const major = a.classification === 'blunder' || (a.classification === 'mistake' && a.evaluationLoss >= 15);
    if (!major) return true;
    let hint: string | undefined;
    if (this.s.settings.blunderCheck === 'full') {
      const mark = a.explanation.marks.find((m) => m.kind === 'hanging') ?? a.explanation.marks[0];
      const threat = a.explanation.arrows.find((x) => x.kind === 'threat');
      if (a.tags.includes('allowed-mate')) hint = 'Look carefully at the safety of your king — what checks does your opponent have?';
      else if (mark) {
        const p = probe.get(mark.square as Square);
        hint = p && p.color === this.s.playerSide ? `Hint: think about the safety of the piece on ${mark.square}.` : `Hint: pay attention to the square ${mark.square}.`;
      } else if (threat) hint = `Hint: consider what the piece on ${threat.from} can do next.`;
      else hint = 'Hint: consider your opponent\'s most forcing reply.';
    }
    this.set({ blunderPrompt: { uci, san, message: 'Your move significantly changes the evaluation. Are you sure?', hint } });
    this.updateClock();
    return false;
  }

  confirmBlunderPrompt(play: boolean): void {
    const p = this.s.blunderPrompt;
    if (!p) return;
    this.set({ blunderPrompt: null });
    if (play) this.commitUserMove(p.uci);
    else {
      this.updateClock();
      this.set({});
    }
  }

  private historyForTutor(): MoveContextHistory {
    return this.s.moves.map((m) => ({ san: m.san, from: m.from, to: m.to, piece: m.piece, color: m.color }));
  }

  private applyMove(uci: string): PlayedMove | null {
    const before = this.chess.fen();
    const m = uciToMove(this.chess, uci);
    if (!m) return null;
    return { san: m.san, uci, from: m.from, to: m.to, color: m.color, piece: m.piece, fenBefore: before, fenAfter: this.chess.fen() };
  }

  private commitUserMove(uci: string): void {
    const s = this.s;
    const ply = s.moves.length;
    const fenBefore = this.chess.fen();
    const history = this.historyForTutor();
    // Stop the user's clock first so think-time is accurate.
    this.runClock(null);
    const thinkMs = this.thinkAccum;
    this.thinkAccum = 0;
    const clockLeftMs = s.timed ? this.s.clocks[s.playerSide] : undefined;
    const pm = this.applyMove(uci);
    if (!pm) return;
    pm.thinkMs = thinkMs;
    const tc = timeControl(s.settings.timeControlId);
    const clocks = { ...this.s.clocks };
    if (s.timed) clocks[s.playerSide] += tc.incrementMs;
    const waitTutor = s.settings.learningMode;
    this.s = { ...this.s, moves: [...s.moves, pm], clocks, alertPly: null, warning: null, pending: [...s.pending, ply], awaitingTutor: waitTutor && !this.chess.isGameOver() };
    this.syncPosition();
    this.set({});

    // Previous evaluation (before opponent's last move) for MISS detection.
    const prev = this.s.analyses[ply - 2];
    const prevScore = prev ? prev.evaluationAfter : null;
    this.runTutor(ply, { ply, fenBefore, playedUci: uci, history, prevScore, timeSpentMs: thinkMs, clockLeftMs });
    this.afterPositionChange();
  }

  private async runTutor(ply: number, ctx: Parameters<typeof analyzeUserMove>[1]): Promise<void> {
    const token = this.token;
    const res = await analyzeUserMove(this.service, ctx, this.s.settings.analysisDepth);
    if (token !== this.token) return;
    const pending = this.s.pending.filter((p) => p !== ply);
    const stillInGame = this.s.moves[ply]?.uci === ctx.playedUci && this.s.moves[ply]?.fenBefore === ctx.fenBefore;
    if (!res || !stillInGame) {
      this.set({ pending, awaitingTutor: false });
      this.updateClock();
      this.maybeAiMove();
      return;
    }
    const analyses = { ...this.s.analyses, [ply]: res };
    const st = this.s.settings;
    const minSev = st.alertLevel === 'blunder' ? 3 : st.alertLevel === 'mistake' ? 2 : 1;
    const sig = severity(res.classification) >= minSev;
    const patch: Partial<GameSnapshot> = { analyses, pending };
    const isLatestUserMove = this.s.moves.length - 1 <= ply + 1;

    if (st.learningMode && this.s.awaitingTutor && sig && this.s.status === 'playing') {
      // Retract the move and ask the user to find a better one.
      this.chess.undo();
      const moves = this.s.moves.slice(0, ply);
      const { [ply]: _omit, ...rest } = analyses;
      void _omit;
      this.s = { ...this.s, ...patch, analyses: rest, moves, awaitingTutor: false };
      this.syncPosition();
      this.set({ learning: { ply, fen: ctx.fenBefore, original: res, attempts: [], status: 'trying' }, trainingMistakes: [...this.s.trainingMistakes, res] });
      this.updateClock();
      return;
    }
    if (sig && st.tutorEnabled && isLatestUserMove && this.s.status === 'playing') patch.alertPly = ply;
    if (st.blunderCheck === 'warn' && res.classification === 'blunder' && isLatestUserMove) {
      patch.warning = 'Your move significantly changed the evaluation.';
    }
    if (this.s.moves.length - 1 === ply) {
      patch.liveEval = { fen: res.fenAfter, score: res.evaluationAfter, depth: res.depth, pv: res.principalVariation };
    }
    patch.awaitingTutor = false;
    this.set(patch);
    this.updateClock();
    this.maybeAiMove();
    if (this.s.status === 'over') this.saveFinished();
  }

  dismissAlert(): void {
    this.set({ alertPly: null, warning: null });
    this.updateClock();
    this.set({});
  }

  // ---------- learning mode ----------
  private async learningAttempt(uci: string): Promise<void> {
    const L = this.s.learning;
    if (!L) return;
    const token = this.token;
    this.set({ learning: { ...L, status: 'checking' } });
    const res = await judgeAttempt(this.service, L.fen, uci, {
      depth: this.s.settings.analysisDepth,
      solutionUci: L.original.bestUci,
      referenceLoss: L.original.evaluationLoss,
    });
    const cur = this.s.learning;
    if (token !== this.token || !cur || cur.ply !== L.ply) return;
    if (!res) {
      this.set({ learning: { ...cur, status: 'trying' } });
      return;
    }
    const attempts = [...cur.attempts, { uci, san: res.san, verdict: res.verdict, classification: res.classification, text: res.text }];
    const status: LearningState['status'] =
      res.verdict === 'correct' ? 'solved' : attempts.length >= this.s.settings.learningAttempts ? 'revealed' : 'trying';
    this.set({ learning: { ...cur, attempts, status } });
  }

  revealAnswer(): void {
    const L = this.s.learning;
    if (L) this.set({ learning: { ...L, status: 'revealed' } });
  }

  /** Leave learning mode by playing `uci` as the real game move. */
  resolveLearning(uci: string): void {
    const L = this.s.learning;
    if (!L || this.chess.fen() !== L.fen) return;
    this.s = { ...this.s, learning: null };
    this.set({});
    // Do not re-enter learning for this move.
    const learning = this.s.settings.learningMode;
    this.s = { ...this.s, settings: { ...this.s.settings, learningMode: false } };
    this.commitUserMove(uci);
    this.s = { ...this.s, settings: { ...this.s.settings, learningMode: learning } };
    this.set({});
  }

  // ---------- AI ----------
  private afterPositionChange(): void {
    if (this.checkGameOver()) return;
    this.updateClock();
    this.set({});
    if (this.s.turn === this.s.playerSide) this.preAnalyse();
    this.maybeAiMove();
  }

  /** Start analysing the user's position while they think (feeds eval bar + fast tutor). */
  private async preAnalyse(): Promise<void> {
    const token = this.token;
    const fen = this.chess.fen();
    const res = await this.service.analyze(fen, { depth: this.s.settings.analysisDepth, multiPV: 3, maxTimeMs: 1500 + this.s.settings.analysisDepth * 250 });
    if (token !== this.token || !res || res.lines.length === 0) return;
    if (this.chess.fen() === fen) this.set({ liveEval: { fen, score: res.lines[0].score, depth: res.depth, pv: res.lines[0].pv } });
  }

  private aiBusy = false;

  private async maybeAiMove(): Promise<void> {
    const s = this.s;
    if (this.aiBusy || s.status !== 'playing' || s.turn === s.playerSide || s.awaitingTutor || s.learning) return;
    this.aiBusy = true;
    const token = this.token;
    const fen = this.chess.fen();
    this.set({ aiThinking: true });
    const started = Date.now();
    const lvl = opponentLevel(s.settings.aiLevel);
    let uci: string | null = null;
    try {
      uci = await this.service.opponentMove(fen, lvl);
    } finally {
      this.aiBusy = false;
    }
    // Small natural delay so the reply is visible as a separate event.
    const elapsed = Date.now() - started;
    if (elapsed < 350) await new Promise((r) => setTimeout(r, 350 - elapsed));
    if (token !== this.token || this.chess.fen() !== fen || this.s.status !== 'playing') {
      if (token === this.token) this.set({ aiThinking: false });
      return;
    }
    if (!uci) {
      this.set({ aiThinking: false });
      return;
    }
    this.runClock(null);
    const pm = this.applyMove(uci);
    if (!pm) {
      this.set({ aiThinking: false });
      return;
    }
    const tc = timeControl(this.s.settings.timeControlId);
    const clocks = { ...this.s.clocks };
    if (this.s.timed) clocks[pm.color] += tc.incrementMs;
    this.s = { ...this.s, moves: [...this.s.moves, pm], clocks, aiThinking: false };
    this.syncPosition();
    this.set({});
    this.afterPositionChange();
  }

  // ---------- end of game ----------
  private checkGameOver(): boolean {
    const c = this.chess;
    if (!c.isGameOver()) return false;
    if (c.isCheckmate()) this.endGame(c.turn() === 'w' ? '0-1' : '1-0', `${c.turn() === 'w' ? 'Black' : 'White'} wins by checkmate`);
    else if (c.isStalemate()) this.endGame('1/2-1/2', 'Draw by stalemate');
    else if (c.isThreefoldRepetition()) this.endGame('1/2-1/2', 'Draw by threefold repetition');
    else if (c.isInsufficientMaterial()) this.endGame('1/2-1/2', 'Draw by insufficient material');
    else if (c.isDrawByFiftyMoves()) this.endGame('1/2-1/2', 'Draw by the fifty-move rule');
    else this.endGame('1/2-1/2', 'Draw');
    return true;
  }

  resign(): void {
    if (this.s.status !== 'playing') return;
    this.endGame(this.s.playerSide === 'w' ? '0-1' : '1-0', `${this.s.playerSide === 'w' ? 'White' : 'Black'} resigned`);
  }

  offerDrawAccepted(): void {
    // Simple draw offer: the engine accepts if it is not better.
    const ev = this.s.liveEval;
    if (!ev || this.s.status !== 'playing') return;
    const aiSide: Side = this.s.playerSide === 'w' ? 'b' : 'w';
    if (winChance(ev.score, aiSide) <= 55) this.endGame('1/2-1/2', 'Draw by agreement');
    else this.set({ warning: 'The engine declines the draw offer.' });
  }

  private endGame(result: GameRecord['result'], termination: string): void {
    this.runClock(null);
    this.service.opponent.cancelAll();
    this.set({ status: 'over', result, termination, aiThinking: false, awaitingTutor: false, blunderPrompt: null, learning: null, checkingMove: false });
    this.saveFinished();
  }

  private saveFinished(): void {
    if (this.s.status !== 'over') return;
    this.history.save(this.toRecord());
    this.history.saveCurrent(null);
    this.set({ savedToHistory: true });
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (this.s.status === 'playing' && this.s.moves.length > 0) this.history.saveCurrent(this.toRecord());
    }, 500);
  }

  // ---------- variations ----------
  /** Replace the game from `basePly` with the given moves ("Continue from this position"). */
  continueFrom(basePly: number, ucis: string[]): boolean {
    if (this.s.status !== 'playing') return false;
    const c = new Chess(this.s.startFen);
    const moves: PlayedMove[] = [];
    const all = [...this.s.moves.slice(0, basePly).map((m) => m.uci), ...ucis];
    for (const u of all) {
      const before = c.fen();
      const m = uciToMove(c, u);
      if (!m) return false;
      moves.push({ san: m.san, uci: u, from: m.from, to: m.to, color: m.color, piece: m.piece, fenBefore: before, fenAfter: c.fen() });
    }
    this.token++;
    this.aiBusy = false;
    this.service.opponent.cancelAll();
    this.chess = c;
    const analyses: Record<number, MoveAnalysis> = {};
    for (const [k, v] of Object.entries(this.s.analyses)) if (Number(k) < basePly) analyses[Number(k)] = v;
    this.s = { ...this.s, moves, analyses, pending: [], alertPly: null, learning: null, blunderPrompt: null, awaitingTutor: false, aiThinking: false, branched: true, liveEval: null };
    this.syncPosition();
    this.set({});
    // Analyse any user moves that came from the variation so the report stays complete.
    moves.forEach((m, i) => {
      if (i >= basePly && m.color === this.s.playerSide) {
        this.s = { ...this.s, pending: [...this.s.pending, i] };
        this.runTutor(i, { ply: i, fenBefore: m.fenBefore, playedUci: m.uci, history: moves.slice(0, i).map((x) => ({ san: x.san, from: x.from, to: x.to, piece: x.piece, color: x.color })) });
      }
    });
    this.afterPositionChange();
    return true;
  }

  // ---------- export ----------
  pgn(): string {
    const c = new Chess(this.s.startFen);
    for (const m of this.s.moves) c.move(m.san);
    const w = this.s.playerSide === 'w' ? 'You' : `Stockfish (level ${this.s.settings.aiLevel})`;
    const b = this.s.playerSide === 'b' ? 'You' : `Stockfish (level ${this.s.settings.aiLevel})`;
    c.setHeader('Event', 'Chess Tutor game');
    c.setHeader('Date', new Date(this.s.startedAt).toISOString().slice(0, 10).replace(/-/g, '.'));
    c.setHeader('White', w);
    c.setHeader('Black', b);
    c.setHeader('Result', this.s.result);
    if (this.s.termination) c.setHeader('Termination', this.s.termination);
    return c.pgn();
  }

  toRecord(): GameRecord {
    const s = this.s;
    const analyses = Object.values(s.analyses).sort((a, b) => a.ply - b.ply);
    const evalTrack: (Score | null)[] = s.moves.map((_, i) => {
      if (s.analyses[i]) return s.analyses[i].evaluationAfter;
      if (s.analyses[i + 1]) return s.analyses[i + 1].evaluationBefore;
      return null;
    });
    return {
      id: s.id,
      startedAt: s.startedAt,
      endedAt: s.status === 'over' ? Date.now() : undefined,
      playerSide: s.playerSide,
      aiLevel: s.settings.aiLevel,
      timeControlId: s.settings.timeControlId,
      moves: s.moves.map((m) => m.san),
      startFen: s.startFen,
      result: s.result,
      termination: s.termination,
      analyses,
      pgn: this.pgn(),
      opening: openingName(s.moves.map((m) => m.san)) ?? undefined,
      evalTrack,
      trainingMistakes: s.trainingMistakes,
      branched: s.branched,
      clocks: s.clocks,
    };
  }
}

type MoveContextHistory = { san: string; from: string; to: string; piece: string; color: Side }[];
