// Shared domain types. FEN is the canonical position representation throughout.

export type Side = 'w' | 'b';

/** Engine score, always stored from White's point of view. */
export interface Score {
  /** Centipawns (White-positive). Undefined when `mate` is set. */
  cp?: number;
  /** Moves to mate. Positive: White mates. Negative: Black mates. (A delivered mate is cp ±MATE_CP.) */
  mate?: number;
}

export interface PvLine {
  /** 1-based MultiPV rank. */
  rank: number;
  score: Score;
  /** Moves in UCI long algebraic (e2e4, e7e8q). */
  pv: string[];
  depth: number;
}

export interface Analysis {
  fen: string;
  depth: number;
  lines: PvLine[];
  bestMove: string | null;
  /** True when the search was stopped early (superseded). */
  partial?: boolean;
}

export type Classification =
  | 'book'
  | 'forced'
  | 'best'
  | 'excellent'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder'
  | 'miss';

export const SIGNIFICANT: Classification[] = ['inaccuracy', 'mistake', 'blunder', 'miss'];

/** Concept tags used for explanations, statistics and adaptive coaching. */
export type Tag =
  | 'hanging-piece'
  | 'material-loss'
  | 'losing-exchange'
  | 'fork'
  | 'pin'
  | 'skewer'
  | 'discovered-attack'
  | 'double-attack'
  | 'back-rank'
  | 'mate-threat'
  | 'allowed-mate'
  | 'missed-mate'
  | 'missed-material'
  | 'missed-fork'
  | 'missed-pin'
  | 'missed-skewer'
  | 'missed-discovered-attack'
  | 'missed-promotion'
  | 'missed-defense'
  | 'missed-simplification'
  | 'king-safety'
  | 'weakening-pawn-move'
  | 'opening-development'
  | 'repeated-piece-move'
  | 'early-queen'
  | 'passed-pawn'
  | 'pawn-structure'
  | 'piece-activity'
  | 'endgame-technique'
  | 'king-activity'
  | 'promotion'
  | 'sacrifice'
  | 'time-trouble'
  | 'rushed-move'
  | 'removal-of-defender'
  | 'overloaded-defender';

export type Phase = 'opening' | 'middlegame' | 'endgame';

export type MistakeKind = 'material' | 'tactical' | 'strategic' | 'none';

export interface Arrow {
  from: string;
  to: string;
  kind: 'best' | 'played' | 'threat' | 'variation' | 'hint';
}

export interface SquareMark {
  square: string;
  kind: 'threat' | 'important' | 'hanging';
}

export interface Explanation {
  /** One-line summary shown in the tutor status. */
  headline: string;
  /** Why the played move is good/bad, grounded in the concrete line. */
  playedWhy: string[];
  /** Why the best move is better. */
  bestWhy: string[];
  /** The chess principle to learn. */
  principle?: string;
  /** For missed opportunities: what the opportunity was. */
  opportunity?: string;
  arrows: Arrow[];
  marks: SquareMark[];
}

/** Stored per user move — matches the record described in the spec. */
export interface MoveAnalysis {
  ply: number; // index in the game's move list (0-based)
  moveNumber: number;
  side: Side;
  fenBefore: string;
  playedMove: string; // SAN
  playedUci: string;
  fenAfter: string;
  evaluationBefore: Score;
  evaluationAfter: Score;
  bestMove: string | null; // SAN
  bestUci: string | null;
  bestEvaluation: Score;
  /** Loss in expected score (win%) for the mover, 0..100. */
  evaluationLoss: number;
  /** Centipawn loss (clamped), mover perspective. */
  cpLoss: number;
  classification: Classification;
  /** Continuation after the played move (UCI, starting with opponent's reply). */
  principalVariation: string[];
  /** Best line from fenBefore (UCI, starting with the best move). */
  bestVariation: string[];
  explanation: Explanation;
  tags: Tag[];
  mistakeKind: MistakeKind;
  missedOpportunity: boolean;
  phase: Phase;
  onlyMove: boolean;
  depth: number;
  timeSpentMs?: number;
  clockLeftMs?: number;
}

export interface TimeControl {
  id: string;
  label: string;
  /** Initial time in ms; 0 means untimed. */
  initialMs: number;
  incrementMs: number;
}

export type BlunderCheckMode = 'off' | 'warn' | 'ask' | 'full';

export interface Settings {
  playerSide: Side | 'random';
  aiLevel: number; // 1..12
  timeControlId: string;
  analysisDepth: number; // 8..22
  tutorEnabled: boolean;
  blunderCheck: BlunderCheckMode;
  learningMode: boolean;
  learningAttempts: number; // attempts before revealing the answer
  /** Minimum classification that triggers the tutor panel / learning mode. */
  alertLevel: 'inaccuracy' | 'mistake' | 'blunder';
  showLiveEval: boolean;
  showBestMoveArrow: boolean;
}

export interface GameRecord {
  id: string;
  startedAt: number;
  endedAt?: number;
  playerSide: Side;
  aiLevel: number;
  timeControlId: string;
  /** SAN moves of the complete game. */
  moves: string[];
  startFen: string;
  result: '1-0' | '0-1' | '1/2-1/2' | '*';
  termination: string;
  analyses: MoveAnalysis[];
  pgn: string;
  opening?: string;
  /** White-perspective evaluation after each ply (null if unknown). */
  evalTrack: (Score | null)[];
  /** Mistakes made (and retried) in learning mode; they count for coaching stats. */
  trainingMistakes?: MoveAnalysis[];
  /** True if the game was continued from an explored variation. */
  branched?: boolean;
  /** Remaining clock times when saved (ms). */
  clocks?: { w: number; b: number };
}
