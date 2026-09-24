// Judging a "find the better move" attempt (learning mode and exercises).
import { Chess } from 'chess.js';
import type { AnalysisService } from './engine/AnalysisService';
import type { Classification, MoveAnalysis } from './types';
import { buildMoveAnalysis } from './tutor';
import { uciToMove } from './board';

export type LearnVerdict = 'correct' | 'better' | 'still-inaccurate' | 'major-mistake';

export interface AttemptResult {
  uci: string;
  san: string;
  verdict: LearnVerdict;
  classification: Classification;
  text: string;
  analysis: MoveAnalysis;
}

export const VERDICT_LABEL: Record<LearnVerdict, string> = {
  correct: 'Correct',
  better: 'Better, but not best',
  'still-inaccurate': 'Still inaccurate',
  'major-mistake': 'Major mistake',
};

/**
 * Evaluate an attempt from `fen`. `referenceLoss` is the win% loss of the move
 * the user originally played (so we can say "better, but not best").
 */
export async function judgeAttempt(
  service: AnalysisService,
  fen: string,
  uci: string,
  opts: { depth: number; solutionUci?: string | null; referenceLoss?: number },
): Promise<AttemptResult | null> {
  const probe = new Chess(fen);
  const m = uciToMove(probe, uci);
  if (!m) return null;
  const [before, after] = await Promise.all([
    service.analyze(fen, { depth: opts.depth, multiPV: 3 }),
    service.analyze(probe.fen(), { depth: opts.depth, multiPV: 1 }),
  ]);
  if (!before || !after) return null;
  const a = buildMoveAnalysis({ ply: 0, fenBefore: fen, playedUci: uci, history: [] }, before, after);
  const c = a.classification;
  const ref = opts.referenceLoss ?? 100;
  let verdict: LearnVerdict;
  let text: string;
  if (['best', 'excellent', 'book', 'forced'].includes(c) || uci === opts.solutionUci || uci === a.bestUci) {
    verdict = 'correct';
    text = `${m.san} is ${a.bestUci === uci || uci === opts.solutionUci ? 'the best move' : 'as good as the best move'}!`;
  } else if (c === 'good' || a.evaluationLoss < ref / 2) {
    verdict = 'better';
    text = `${m.san} is an improvement, but there is something stronger.`;
  } else if ((c === 'mistake' || c === 'blunder' || c === 'miss') && a.evaluationLoss > 15) {
    verdict = 'major-mistake';
    text = `${m.san} is a serious mistake: ${a.explanation.playedWhy[0] ?? 'it gives away a lot.'}`;
  } else {
    verdict = 'still-inaccurate';
    text = `${m.san} is still inaccurate. Try again.`;
  }
  return { uci, san: m.san, verdict, classification: c, text, analysis: a };
}
