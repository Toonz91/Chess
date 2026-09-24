// Variation system: explore lines from a position without touching the game state.
import { Chess } from 'chess.js';
import { uciToMove } from './board';
import type { MoveAnalysis } from './types';

export interface VariationLine {
  id: 'played' | 'best' | 'custom';
  label: string;
  moves: string[]; // UCI from baseFen
}

export interface Variation {
  baseFen: string;
  /** Game ply at which the variation starts (the move being replaced). */
  basePly: number;
  lines: VariationLine[];
  activeLine: VariationLine['id'];
  /** Number of moves of the active line that have been played on the board. */
  cursor: number;
  title: string;
}

export interface VariationStep {
  san: string;
  uci: string;
  fenAfter: string;
  moveNumberLabel: string;
}

export function steps(baseFen: string, moves: string[]): VariationStep[] {
  if (!baseFen) return [];
  const c = new Chess(baseFen);
  const out: VariationStep[] = [];
  for (const u of moves) {
    const moveNo = c.moveNumber();
    const turn = c.turn();
    const m = uciToMove(c, u);
    if (!m) break;
    out.push({ san: m.san, uci: u, fenAfter: c.fen(), moveNumberLabel: turn === 'w' ? `${moveNo}.` : `${moveNo}…` });
  }
  return out;
}

export function activeLine(v: Variation): VariationLine {
  return v.lines.find((l) => l.id === v.activeLine) ?? v.lines[0];
}

export function fenAtCursor(v: Variation): string {
  const line = activeLine(v);
  const st = steps(v.baseFen, line.moves.slice(0, v.cursor));
  return st.length ? st[st.length - 1].fenAfter : v.baseFen;
}

export function lastMoveAtCursor(v: Variation): { from: string; to: string } | null {
  if (v.cursor === 0) return null;
  const u = activeLine(v).moves[v.cursor - 1];
  return u ? { from: u.slice(0, 2), to: u.slice(2, 4) } : null;
}

export function stepTo(v: Variation, cursor: number): Variation {
  const len = steps(v.baseFen, activeLine(v).moves).length;
  return { ...v, cursor: Math.max(0, Math.min(len, cursor)) };
}

export function switchLine(v: Variation, id: VariationLine['id']): Variation {
  if (!v.lines.some((l) => l.id === id)) return v;
  return { ...v, activeLine: id, cursor: id === 'custom' ? v.cursor : 1 };
}

/**
 * Play a move on the variation board. If it matches the next move of the active
 * line we simply advance; otherwise we branch into a custom line.
 */
export function playVariationMove(v: Variation, uci: string): Variation {
  const line = activeLine(v);
  if (line.moves[v.cursor] === uci) return { ...v, cursor: v.cursor + 1 };
  const fen = fenAtCursor(v);
  const c = new Chess(fen);
  if (!uciToMove(c, uci)) return v;
  const moves = [...line.moves.slice(0, v.cursor), uci];
  const custom: VariationLine = { id: 'custom', label: 'Your line', moves };
  const lines = [...v.lines.filter((l) => l.id !== 'custom'), custom];
  return { ...v, lines, activeLine: 'custom', cursor: moves.length };
}

/** Build the "your move vs best move" variation for a tutor analysis. */
export function variationFromAnalysis(a: MoveAnalysis, start: 'best' | 'played' = 'best'): Variation {
  const lines: VariationLine[] = [];
  if (a.bestUci && a.bestUci !== a.playedUci) {
    lines.push({ id: 'best', label: `Best: ${a.bestMove}`, moves: a.bestVariation.length ? a.bestVariation : [a.bestUci] });
  }
  lines.push({ id: 'played', label: `Your move: ${a.playedMove}`, moves: [a.playedUci, ...a.principalVariation] });
  const active = lines.some((l) => l.id === start) ? start : lines[0].id;
  return {
    baseFen: a.fenBefore,
    basePly: a.ply,
    lines,
    activeLine: active,
    cursor: 1,
    title: `Move ${a.moveNumber}${a.side === 'w' ? '.' : '…'} ${a.playedMove}`,
  };
}

/** A free-exploration variation from any position. */
export function variationFromPosition(fen: string, basePly: number, title: string, moves: string[] = []): Variation {
  return { baseFen: fen, basePly, lines: [{ id: 'custom', label: 'Line', moves }], activeLine: 'custom', cursor: 0, title };
}
