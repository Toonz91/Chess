// Post-game analysis report.
import type { Classification, GameRecord, MoveAnalysis, Phase, Tag } from './types';
import { gameAccuracy, moveAccuracy } from './evaluation';

export interface PhaseStats {
  phase: Phase;
  moves: number;
  accuracy: number | null;
  inaccuracies: number;
  mistakes: number;
  blunders: number;
  verdict: string;
}

export interface GameReport {
  result: string;
  termination: string;
  opening: string | null;
  accuracy: number;
  counts: Record<Classification, number>;
  missedOpportunities: number;
  largestSwing: MoveAnalysis | null;
  critical: MoveAnalysis[];
  phases: PhaseStats[];
  materialMistakes: number;
  tacticalMistakes: number;
  strategicMistakes: number;
  lessons: string[];
  tagCounts: Partial<Record<Tag, number>>;
}

const EMPTY_COUNTS: Record<Classification, number> = {
  book: 0, forced: 0, best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0, miss: 0,
};

export function isCritical(a: MoveAnalysis): boolean {
  return ['inaccuracy', 'mistake', 'blunder', 'miss'].includes(a.classification) || a.missedOpportunity;
}

function phaseVerdict(acc: number | null, blunders: number, mistakes: number): string {
  if (acc === null) return 'Not reached';
  if (blunders > 0) return acc >= 80 ? 'Solid, but with a costly blunder' : 'Shaky — decisive errors';
  if (mistakes > 1) return 'Uneven';
  if (acc >= 90) return 'Excellent';
  if (acc >= 80) return 'Good';
  if (acc >= 65) return 'Reasonable';
  return 'Needs work';
}

export function buildReport(game: GameRecord): GameReport {
  const analyses = [...game.analyses].sort((a, b) => a.ply - b.ply);
  const counts = { ...EMPTY_COUNTS };
  const tagCounts: Partial<Record<Tag, number>> = {};
  let materialMistakes = 0;
  let tacticalMistakes = 0;
  let strategicMistakes = 0;
  for (const a of analyses) {
    counts[a.classification]++;
    if (isCritical(a)) {
      for (const t of a.tags) tagCounts[t] = (tagCounts[t] ?? 0) + 1;
      if (a.mistakeKind === 'material') materialMistakes++;
      else if (a.mistakeKind === 'tactical') tacticalMistakes++;
      else if (a.mistakeKind === 'strategic') strategicMistakes++;
    }
  }
  const phases: PhaseStats[] = (['opening', 'middlegame', 'endgame'] as Phase[]).map((phase) => {
    const ms = analyses.filter((a) => a.phase === phase);
    const blunders = ms.filter((a) => a.classification === 'blunder').length;
    const mistakes = ms.filter((a) => a.classification === 'mistake' || a.classification === 'miss').length;
    const accuracy = ms.length ? gameAccuracy(ms.map((a) => a.evaluationLoss)) : null;
    return {
      phase,
      moves: ms.length,
      accuracy,
      inaccuracies: ms.filter((a) => a.classification === 'inaccuracy').length,
      mistakes,
      blunders,
      verdict: phaseVerdict(accuracy, blunders, mistakes),
    };
  });
  const largestSwing = analyses.reduce<MoveAnalysis | null>((m, a) => (!m || a.evaluationLoss > m.evaluationLoss ? a : m), null);
  return {
    result: game.result,
    termination: game.termination,
    opening: game.opening ?? null,
    accuracy: gameAccuracy(analyses.map((a) => a.evaluationLoss)),
    counts,
    missedOpportunities: analyses.filter((a) => a.missedOpportunity || a.classification === 'miss').length,
    largestSwing: largestSwing && largestSwing.evaluationLoss > 0 ? largestSwing : null,
    critical: analyses.filter(isCritical),
    phases,
    materialMistakes,
    tacticalMistakes,
    strategicMistakes,
    lessons: lessonsFromGame(analyses, tagCounts),
    tagCounts,
  };
}

export { moveAccuracy };

const LESSON_TEXT: Partial<Record<Tag, (n: number) => string>> = {
  'hanging-piece': (n) => `You left pieces undefended ${n} time${n > 1 ? 's' : ''}. Before each move, check what your opponent can capture.`,
  'material-loss': (n) => `You lost material in ${n} position${n > 1 ? 's' : ''} by not counting attackers and defenders.`,
  fork: (n) => `You walked into ${n} fork${n > 1 ? 's' : ''}. Watch for knight jumps and queen moves that hit two pieces.`,
  pin: (n) => `Pins cost you ${n} time${n > 1 ? 's' : ''}. Be careful with pieces lined up in front of your king or queen.`,
  skewer: (n) => `You were skewered ${n} time${n > 1 ? 's' : ''}. Keep valuable pieces off open lines.`,
  'discovered-attack': (n) => `Discovered attacks surprised you ${n} time${n > 1 ? 's' : ''}.`,
  'allowed-mate': () => 'You allowed a mating attack. Always check your opponent\'s forcing moves first.',
  'back-rank': () => 'Your back rank was weak. Create an escape square for your king.',
  'missed-mate': (n) => `You missed ${n} forced mate${n > 1 ? 's' : ''}. Look at all checks first.`,
  'missed-fork': (n) => `You missed ${n} fork${n > 1 ? 's' : ''}.`,
  'missed-pin': (n) => `You missed ${n} pin${n > 1 ? 's' : ''}.`,
  'missed-material': (n) => `You missed ${n} chance${n > 1 ? 's' : ''} to win material.`,
  'missed-defense': (n) => `You ignored your opponent's threats ${n} time${n > 1 ? 's' : ''}.`,
  'repeated-piece-move': (n) => `You moved the same piece multiple times in the opening (${n}×) instead of developing.`,
  'early-queen': () => 'Your queen came out too early.',
  'opening-development': () => 'Your development in the opening was slow.',
  'king-safety': (n) => `Your king safety suffered ${n} time${n > 1 ? 's' : ''}.`,
  'weakening-pawn-move': () => 'You weakened the pawns in front of your king.',
  'endgame-technique': () => 'Endgame technique needs attention.',
  'piece-activity': () => 'Some of your pieces ended up passive.',
  'pawn-structure': () => 'You created avoidable pawn weaknesses.',
  'time-trouble': (n) => `${n} mistake${n > 1 ? 's' : ''} came in time trouble. Budget your clock better.`,
  'rushed-move': (n) => `${n} serious error${n > 1 ? 's were' : ' was'} played very quickly. Take a moment on critical moves.`,
};

function lessonsFromGame(analyses: MoveAnalysis[], tagCounts: Partial<Record<Tag, number>>): string[] {
  const out: string[] = [];
  const sorted = (Object.entries(tagCounts) as [Tag, number][]).sort((a, b) => b[1] - a[1]);
  for (const [tag, n] of sorted) {
    const f = LESSON_TEXT[tag];
    if (f) out.push(f(n));
    if (out.length >= 4) break;
  }
  if (out.length === 0) {
    const bad = analyses.filter(isCritical).length;
    out.push(bad === 0 ? 'Clean game — no significant mistakes. Try a stronger opponent!' : 'Review the critical moments below to see where the evaluation changed.');
  }
  return out;
}
