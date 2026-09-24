// Move-classification layer. Uses expected-score (win%) loss as the base signal,
// then adjusts for position context: equivalent alternatives, mates, decided
// positions, result changes, material consequences and move difficulty.
import type { Color } from 'chess.js';
import type { Analysis, Classification, Score } from './types';
import { cpFor, resultBand, winChance, type ResultBand } from './evaluation';
import type { LineOutcome } from './lines';

export interface Thresholds {
  /** MultiPV moves within this many centipawns of the best are treated as equivalent. */
  equivalentCp: number;
  /** Win% loss bands (0..100 scale). */
  bestLoss: number;
  excellentLoss: number;
  inaccuracyLoss: number;
  mistakeLoss: number;
  blunderLoss: number;
  /** Win% at/above which a position counts as "decided". */
  decidedWin: number;
  /** A best line gaining at least this much material more than the played line is an "opportunity". */
  opportunityMaterial: number;
  /** Win% gap between best and second-best line that makes the best move an "only move". */
  onlyMoveGap: number;
  /** Mate-in-N at or below which missing it counts as a missed opportunity even if still winning. */
  missedMateMax: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  equivalentCp: 20,
  bestLoss: 1,
  excellentLoss: 2.5,
  inaccuracyLoss: 6,
  mistakeLoss: 12,
  blunderLoss: 22,
  decidedWin: 96,
  opportunityMaterial: 2,
  onlyMoveGap: 20,
  missedMateMax: 3,
};

const SEVERITY: Classification[] = ['book', 'forced', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'];
const sev = (c: Classification) => SEVERITY.indexOf(c === 'miss' ? 'mistake' : c);
const atLeast = (c: Classification, min: Classification): Classification => (sev(c) < sev(min) ? min : c);
const atMost = (c: Classification, max: Classification): Classification => (sev(c) > sev(max) ? max : c);

export interface ClassifyInput {
  side: Color;
  playedUci: string;
  /** MultiPV analysis of the position before the move. */
  before: Analysis;
  /** Evaluation of the position after the played move (White perspective). */
  afterScore: Score;
  playedOutcome: LineOutcome;
  bestOutcome: LineOutcome;
  legalMoveCount: number;
  isBookMove?: boolean;
  /** Evaluation before the opponent's previous move (to tell a "miss" from a real mistake). */
  prevScore?: Score | null;
  /** Whether the engine's best move is a sacrifice/quiet move that is hard to see. */
  bestIsHard?: boolean;
  thresholds?: Thresholds;
}

export interface ClassifyResult {
  classification: Classification;
  winLoss: number;
  cpLoss: number;
  bestScore: Score;
  playedScore: Score;
  onlyMove: boolean;
  missedOpportunity: boolean;
  missedMate: boolean;
  /** Short reasons for adjustments (debug + tutor transparency). */
  notes: string[];
}

function bandRank(b: ResultBand): number {
  return b === 'win' ? 2 : b === 'draw' ? 1 : 0;
}

export function classifyMove(input: ClassifyInput): ClassifyResult {
  const t = input.thresholds ?? DEFAULT_THRESHOLDS;
  const { side, before, playedUci } = input;
  const notes: string[] = [];
  const best = before.lines[0];
  const bestScore = best?.score ?? input.afterScore;
  const playedLine = before.lines.find((l) => l.pv[0] === playedUci);
  const isEngineBest = best?.pv[0] === playedUci;
  // Prefer the MultiPV score for consistency with the best-move score (same search).
  const playedScore = isEngineBest ? bestScore : playedLine?.score ?? input.afterScore;

  const winBest = winChance(bestScore, side);
  const winPlayed = winChance(playedScore, side);
  const winLoss = isEngineBest ? 0 : Math.max(0, winBest - winPlayed);
  const cpLoss = isEngineBest ? 0 : Math.max(0, cpFor(bestScore, side) - cpFor(playedScore, side));

  const result = (c: Classification, extra: Partial<ClassifyResult> = {}): ClassifyResult => ({
    classification: c,
    winLoss,
    cpLoss,
    bestScore,
    playedScore,
    onlyMove: false,
    missedOpportunity: false,
    missedMate: false,
    notes,
    ...extra,
  });

  if (input.legalMoveCount === 1) {
    notes.push('only legal move');
    return result('forced', { winLoss: 0, cpLoss: 0 });
  }

  // Only move: the best move is far better than every alternative.
  const second = before.lines[1];
  const onlyMove = !!second && isEngineBest && winChance(bestScore, side) - winChance(second.score, side) >= t.onlyMoveGap;

  // Base classification from expected-score loss.
  let c: Classification;
  if (isEngineBest || winLoss <= t.bestLoss) c = 'best';
  else if (winLoss <= t.excellentLoss) c = 'excellent';
  else if (winLoss < t.inaccuracyLoss) c = 'good';
  else if (winLoss < t.mistakeLoss) c = 'inaccuracy';
  else if (winLoss < t.blunderLoss) c = 'mistake';
  else c = 'blunder';

  // Equivalent alternatives: several moves with ~equal evaluations are all fine.
  if (playedLine && !isEngineBest && cpLoss <= t.equivalentCp) {
    c = cpLoss <= 8 ? 'best' : atMost(c, 'excellent');
    notes.push(`engine line #${playedLine.rank}, within ${t.equivalentCp}cp of the best`);
  }

  // Mate logic.
  const bestMateForMe = bestScore.mate !== undefined && (side === 'w' ? bestScore.mate > 0 : bestScore.mate < 0);
  const playedMateForMe = playedScore.mate !== undefined && (side === 'w' ? playedScore.mate > 0 : playedScore.mate < 0);
  const playedMateAgainst = playedScore.mate !== undefined && !playedMateForMe;
  const bestMateAgainst = bestScore.mate !== undefined && !bestMateForMe;
  let missedMate = false;

  if (bestMateForMe && playedMateForMe) {
    const diff = Math.abs(playedScore.mate!) - Math.abs(bestScore.mate!);
    c = diff <= 1 ? 'best' : diff <= 3 ? 'excellent' : 'good';
    notes.push('still mating');
  } else if (bestMateForMe && !playedMateForMe) {
    missedMate = Math.abs(bestScore.mate!) <= t.missedMateMax;
    if (winPlayed >= t.decidedWin) {
      c = missedMate ? 'miss' : 'inaccuracy';
      notes.push('missed a forced mate but still winning');
    } else {
      c = atLeast(c, 'mistake');
      notes.push('missed a forced mate');
    }
  } else if (playedMateAgainst && !bestMateAgainst) {
    c = 'blunder';
    notes.push('allows a forced mate');
  } else if (bestMateAgainst && playedMateAgainst) {
    // Getting mated anyway: prolonging resistance is what matters.
    const diff = Math.abs(bestScore.mate!) - Math.abs(playedScore.mate!);
    c = diff <= 0 ? 'best' : diff <= 2 ? 'good' : 'inaccuracy';
    notes.push('defending against mate');
  } else {
    // Decided positions: don't nag about tiny differences.
    if (winBest >= t.decidedWin && winPlayed >= t.decidedWin - 2) {
      c = atMost(c, 'good');
      notes.push('position remains completely winning');
    } else if (winBest <= 100 - t.decidedWin) {
      c = atMost(c, 'inaccuracy');
      notes.push('position was already lost');
    }

    // Moves that change the expected result are serious.
    const drop = bandRank(resultBand(bestScore, side)) - bandRank(resultBand(playedScore, side));
    if (drop >= 2) {
      c = 'blunder';
      notes.push('turns a win into a loss');
    } else if (drop === 1 && winLoss >= t.inaccuracyLoss) {
      c = atLeast(c, 'mistake');
      notes.push('changes the likely result');
    }

    // Concrete material consequences.
    const matDiff = input.bestOutcome.materialDelta - input.playedOutcome.materialDelta;
    if (matDiff >= 2 && winLoss >= t.inaccuracyLoss) {
      c = atLeast(c, 'mistake');
      notes.push('loses material');
    }

    // Hard-to-find best moves (sacrifices, quiet moves) earn some leniency.
    if (input.bestIsHard && c === 'inaccuracy' && winLoss < t.inaccuracyLoss * 1.5) {
      c = 'good';
      notes.push('the best move was hard to find');
    }
  }

  // Missed opportunity: the best line wins something concrete the played move doesn't.
  const bo = input.bestOutcome;
  const po = input.playedOutcome;
  const concreteGain =
    missedMate ||
    (bo.mateBy === side && po.mateBy !== side) ||
    (bo.materialDelta >= t.opportunityMaterial && bo.materialDelta - po.materialDelta >= t.opportunityMaterial) ||
    (bo.promotedBy.includes(side) && !po.promotedBy.includes(side) && bo.materialDelta - po.materialDelta >= 2);
  let missedOpportunity = false;
  if (concreteGain && winLoss >= t.inaccuracyLoss) {
    missedOpportunity = true;
    // A "miss" is failing to punish, not self-destruction: if the played move keeps
    // roughly the evaluation we had before the opponent's last move, call it MISS.
    const baseline = input.prevScore ? winChance(input.prevScore, side) : 45;
    const dropsToLoss = resultBand(playedScore, side) === 'loss' && resultBand(bestScore, side) !== 'loss';
    if (winPlayed >= Math.min(baseline, 60) - 5 && !dropsToLoss) c = 'miss';
    else if (c === 'inaccuracy') c = 'miss';
    notes.push('missed a concrete opportunity');
  }

  if (input.isBookMove && sev(c) <= sev('good')) c = 'book';

  return result(c, { onlyMove, missedOpportunity: missedOpportunity || missedMate, missedMate });
}
