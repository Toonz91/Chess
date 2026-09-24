import type { Score, Side } from './types';

/** Scale a mate score into a large centipawn value for arithmetic. */
export const MATE_CP = 10000;

export function scoreToCp(score: Score): number {
  if (score.mate !== undefined) {
    if (score.mate === 0) return 0;
    const sign = Math.sign(score.mate);
    // Shorter mates are "bigger".
    return sign * (MATE_CP - Math.min(Math.abs(score.mate), 100) * 10);
  }
  return score.cp ?? 0;
}

/**
 * Expected score (win chance) for White in 0..100, using the logistic model
 * popularised by Lichess. Mate scores map to 0/100.
 */
export function winChanceWhite(score: Score): number {
  if (score.mate !== undefined) {
    if (score.mate > 0) return 100;
    if (score.mate < 0) return 0;
    return 50;
  }
  if ((score.cp ?? 0) >= MATE_CP) return 100;
  if ((score.cp ?? 0) <= -MATE_CP) return 0;
  const cp = Math.max(-1500, Math.min(1500, score.cp ?? 0));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

export function winChance(score: Score, side: Side): number {
  const w = winChanceWhite(score);
  return side === 'w' ? w : 100 - w;
}

/** Centipawns from a side's perspective, clamped to ±1500 for loss arithmetic. */
export function cpFor(score: Score, side: Side): number {
  const cp = Math.max(-1500, Math.min(1500, scoreToCp(score)));
  return side === 'w' ? cp : -cp;
}

export function negate(score: Score): Score {
  if (score.mate !== undefined) return { mate: -score.mate };
  return { cp: -(score.cp ?? 0) };
}

/** "+1.25", "-0.40", "#4", "#-3". */
export function formatScore(score: Score | null | undefined): string {
  if (!score) return '…';
  if (score.mate !== undefined) {
    if (score.mate === 0) return '#';
    return score.mate > 0 ? `#${score.mate}` : `#-${Math.abs(score.mate)}`;
  }
  if (Math.abs(score.cp ?? 0) >= MATE_CP) return '#';
  const v = (score.cp ?? 0) / 100;
  return (v > 0 ? '+' : v < 0 ? '' : '') + v.toFixed(2).replace(/^-0\.00$/, '0.00');
}

export type Verdict =
  | 'winning'
  | 'clearly-better'
  | 'slightly-better'
  | 'equal'
  | 'slightly-worse'
  | 'clearly-worse'
  | 'losing';

/** Qualitative verdict of a position for `side`. */
export function verdict(score: Score, side: Side): Verdict {
  const w = winChance(score, side);
  if (w >= 85) return 'winning';
  if (w >= 67) return 'clearly-better';
  if (w >= 56) return 'slightly-better';
  if (w > 44) return 'equal';
  if (w > 33) return 'slightly-worse';
  if (w > 15) return 'clearly-worse';
  return 'losing';
}

export type ResultBand = 'win' | 'draw' | 'loss';

/** Coarse expected result, used to detect "result-changing" moves. */
export function resultBand(score: Score, side: Side): ResultBand {
  const w = winChance(score, side);
  if (w >= 75) return 'win';
  if (w <= 25) return 'loss';
  return 'draw';
}

const VERDICT_TEXT: Record<Verdict, string> = {
  winning: 'winning',
  'clearly-better': 'clearly better',
  'slightly-better': 'slightly better',
  equal: 'roughly equal',
  'slightly-worse': 'slightly worse',
  'clearly-worse': 'clearly worse',
  losing: 'losing',
};

export function verdictText(v: Verdict): string {
  return VERDICT_TEXT[v];
}

/** Human description of an evaluation for the UI, relative to `perspective`. */
export function describeScore(score: Score, perspective: Side): string {
  const name = (s: Side) => (s === 'w' ? 'White' : 'Black');
  if (score.mate !== undefined) {
    if (score.mate === 0) return 'Checkmate';
    const winner: Side = score.mate > 0 ? 'w' : 'b';
    const n = Math.abs(score.mate);
    return winner === perspective ? `You have mate in ${n}` : `${name(winner)} has mate in ${n}`;
  }
  const cp = score.cp ?? 0;
  if (Math.abs(cp) >= MATE_CP) return 'Checkmate';
  if (Math.abs(cp) < 30) return 'Equal position';
  const leader: Side = cp > 0 ? 'w' : 'b';
  const size = Math.abs(cp) >= 300 ? 'decisive' : Math.abs(cp) >= 150 ? 'clear' : Math.abs(cp) >= 70 ? 'moderate' : 'slight';
  return leader === perspective ? `You have a ${size} advantage` : `${name(leader)} has a ${size} advantage`;
}

/** Per-move accuracy from win-chance loss (Lichess formula). */
export function moveAccuracy(winLoss: number): number {
  const a = 103.1668 * Math.exp(-0.04354 * Math.max(0, winLoss)) - 3.1669;
  return Math.max(0, Math.min(100, a));
}

export function gameAccuracy(losses: number[]): number {
  if (losses.length === 0) return 100;
  const accs = losses.map(moveAccuracy);
  const mean = accs.reduce((a, b) => a + b, 0) / accs.length;
  const harmonic = accs.length / accs.reduce((a, b) => a + 1 / Math.max(b, 1), 0);
  return (mean + harmonic) / 2;
}
