// Tutor orchestration: builds the per-move analysis record from engine output.
import { Chess, type Color, type Square } from 'chess.js';
import type { Analysis, MoveAnalysis, Phase, Score } from './types';
import { classifyMove, DEFAULT_THRESHOLDS, type Thresholds } from './classify';
import { explainMove } from './explain';
import { playLine } from './lines';
import { nonPawnMaterial, opposite, see, uciLineToSan, uciToMove } from './board';
import type { AnalysisService } from './engine/AnalysisService';
import { isBookSequence } from './openings';

export function detectPhase(fen: string): Phase {
  const c = new Chess(fen);
  const npm = nonPawnMaterial(c);
  const hasQueens = c.board().some((row) => row.some((p) => p?.type === 'q'));
  if (npm <= 24 || (!hasQueens && npm <= 30)) return 'endgame';
  const fullmove = parseInt(fen.split(' ')[5] ?? '1', 10);
  if (fullmove <= 10 && npm >= 46) return 'opening';
  return 'middlegame';
}

/** A best move that leaves the moved piece en prise (a sacrifice) is hard to find. */
export function isHardMove(fen: string, uci: string | null): boolean {
  if (!uci) return false;
  const c = new Chess(fen);
  const m = uciToMove(c, uci);
  if (!m || m.captured) return false;
  return see(c, m.to as Square, opposite(m.color)) >= 2;
}

export interface MoveContext {
  ply: number;
  fenBefore: string;
  playedUci: string;
  /** SAN history before this move (verbose). */
  history: { san: string; from: string; to: string; piece: string; color: Color }[];
  /** Evaluation before the opponent's previous move (for MISS detection). */
  prevScore?: Score | null;
  timeSpentMs?: number;
  clockLeftMs?: number;
  thresholds?: Thresholds;
}

/** Pure: combine the before/after engine analyses into a MoveAnalysis. */
export function buildMoveAnalysis(ctx: MoveContext, before: Analysis, after: Analysis): MoveAnalysis {
  const { fenBefore, playedUci } = ctx;
  const board = new Chess(fenBefore);
  const side = board.turn();
  const legalMoveCount = board.moves().length;
  const played = uciToMove(board, playedUci);
  if (!played) throw new Error(`Illegal move ${playedUci} in ${fenBefore}`);
  const fenAfter = board.fen();

  const afterLine = after.lines[0];
  const afterScore: Score = afterLine?.score ?? { cp: 0 };
  const replyPv = afterLine?.pv ?? [];
  const best = before.lines[0];
  const bestUci = best?.pv[0] ?? null;
  const bestPv = best?.pv ?? [];

  const playedOutcome = playLine(fenBefore, [playedUci, ...replyPv], side);
  const bestOutcome = bestUci === playedUci ? playedOutcome : playLine(fenBefore, bestPv, side);

  const sansSoFar = [...ctx.history.map((h) => h.san), played.san];
  const phase = detectPhase(fenBefore);
  const cls = classifyMove({
    side,
    playedUci,
    before,
    afterScore,
    playedOutcome,
    bestOutcome,
    legalMoveCount,
    isBookMove: isBookSequence(sansSoFar),
    prevScore: ctx.prevScore,
    bestIsHard: isHardMove(fenBefore, bestUci),
    thresholds: ctx.thresholds ?? DEFAULT_THRESHOLDS,
  });

  const ex = explainMove({
    side,
    fenBefore,
    playedUci,
    bestUci,
    classification: cls.classification,
    missedOpportunity: cls.missedOpportunity,
    bestScore: cls.bestScore,
    playedScore: cls.playedScore,
    winLoss: cls.winLoss,
    playedOutcome,
    bestOutcome,
    phase,
    history: ctx.history,
  });

  const tags = [...ex.tags];
  const significant = ['inaccuracy', 'mistake', 'blunder', 'miss'].includes(cls.classification);
  if (significant && ctx.clockLeftMs !== undefined && ctx.clockLeftMs < 20000) tags.push('time-trouble');
  if (significant && ctx.timeSpentMs !== undefined && ctx.timeSpentMs < 2500 && cls.classification !== 'inaccuracy') tags.push('rushed-move');

  return {
    ply: ctx.ply,
    moveNumber: parseInt(fenBefore.split(' ')[5] ?? '1', 10),
    side,
    fenBefore,
    playedMove: played.san,
    playedUci,
    fenAfter,
    evaluationBefore: cls.bestScore,
    evaluationAfter: afterScore,
    bestMove: bestUci ? uciLineToSan(fenBefore, [bestUci])[0] ?? bestUci : null,
    bestUci,
    bestEvaluation: cls.bestScore,
    evaluationLoss: Math.round(cls.winLoss * 10) / 10,
    cpLoss: Math.round(cls.cpLoss),
    classification: cls.classification,
    principalVariation: replyPv.slice(0, 12),
    bestVariation: bestPv.slice(0, 12),
    explanation: ex.explanation,
    tags,
    mistakeKind: ex.mistakeKind,
    missedOpportunity: cls.missedOpportunity,
    phase,
    onlyMove: cls.onlyMove,
    depth: Math.min(before.depth, after.depth),
    timeSpentMs: ctx.timeSpentMs,
    clockLeftMs: ctx.clockLeftMs,
  };
}

/** Engine-backed: analyse the position before and after the user's move. */
export async function analyzeUserMove(
  service: AnalysisService,
  ctx: MoveContext,
  depth: number,
): Promise<MoveAnalysis | null> {
  const board = new Chess(ctx.fenBefore);
  if (!uciToMove(board, ctx.playedUci)) return null;
  const fenAfter = board.fen();
  const maxTimeMs = 1500 + depth * 250;
  const [before, after] = await Promise.all([
    service.analyze(ctx.fenBefore, { depth, multiPV: 3, maxTimeMs }),
    service.analyze(fenAfter, { depth, multiPV: 1, maxTimeMs }),
  ]);
  if (!before || !after) return null;
  return buildMoveAnalysis(ctx, before, after);
}
