// Low-level board geometry and static tactical helpers built on chess.js.
import { Chess, type Color, type PieceSymbol, type Square, type Move } from 'chess.js';

export const PIECE_VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

export const PIECE_NAME: Record<PieceSymbol, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

export const FILES = 'abcdefgh';

export function sq(file: number, rank: number): Square | null {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return (FILES[file] + (rank + 1)) as Square;
}

export function coords(s: Square): [number, number] {
  return [s.charCodeAt(0) - 97, parseInt(s[1], 10) - 1];
}

export const opposite = (c: Color): Color => (c === 'w' ? 'b' : 'w');
export const colorName = (c: Color): string => (c === 'w' ? 'White' : 'Black');

export function describePiece(chess: Chess, s: Square): string {
  const p = chess.get(s);
  return p ? `${PIECE_NAME[p.type]} on ${s}` : s;
}

const KNIGHT_D = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING_D = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
export const ROOK_D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const BISHOP_D = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

export function isSlider(t: PieceSymbol): boolean {
  return t === 'b' || t === 'r' || t === 'q';
}

export function sliderDirs(t: PieceSymbol): number[][] {
  if (t === 'b') return BISHOP_D;
  if (t === 'r') return ROOK_D;
  if (t === 'q') return [...ROOK_D, ...BISHOP_D];
  return [];
}

/** Squares attacked by the piece on `from` (pseudo-attacks, blockers respected). */
export function attacksFrom(chess: Chess, from: Square): Square[] {
  const p = chess.get(from);
  if (!p) return [];
  const [f, r] = coords(from);
  const out: Square[] = [];
  const push = (s: Square | null) => s && out.push(s);
  switch (p.type) {
    case 'p': {
      const dr = p.color === 'w' ? 1 : -1;
      push(sq(f - 1, r + dr));
      push(sq(f + 1, r + dr));
      break;
    }
    case 'n':
      KNIGHT_D.forEach(([df, dr]) => push(sq(f + df, r + dr)));
      break;
    case 'k':
      KING_D.forEach(([df, dr]) => push(sq(f + df, r + dr)));
      break;
    default:
      for (const [df, dr] of sliderDirs(p.type)) {
        let nf = f + df;
        let nr = r + dr;
        let s = sq(nf, nr);
        while (s) {
          out.push(s);
          if (chess.get(s)) break;
          nf += df;
          nr += dr;
          s = sq(nf, nr);
        }
      }
  }
  return out;
}

export interface PieceAt {
  square: Square;
  type: PieceSymbol;
  color: Color;
}

export function pieces(chess: Chess, color?: Color): PieceAt[] {
  const out: PieceAt[] = [];
  chess.board().forEach((row) =>
    row.forEach((p) => {
      if (p && (!color || p.color === color)) out.push({ square: p.square, type: p.type, color: p.color });
    }),
  );
  return out;
}

export function material(chess: Chess, color: Color): number {
  return pieces(chess, color)
    .filter((p) => p.type !== 'k')
    .reduce((a, p) => a + PIECE_VALUE[p.type], 0);
}

/** Material balance from `color`'s point of view. */
export function materialBalance(chess: Chess, color: Color): number {
  return material(chess, color) - material(chess, opposite(color));
}

/** Non-pawn material of both sides (used for phase detection). */
export function nonPawnMaterial(chess: Chess): number {
  return pieces(chess)
    .filter((p) => p.type !== 'k' && p.type !== 'p')
    .reduce((a, p) => a + PIECE_VALUE[p.type], 0);
}

/**
 * Static exchange evaluation: expected material gain for `by` when initiating
 * captures on `target` (0 if not profitable). Ignores x-rays and pins — a heuristic.
 */
export function see(chess: Chess, target: Square, by: Color): number {
  const victim = chess.get(target);
  if (!victim || victim.color === by) return 0;
  const vals = (c: Color) =>
    chess
      .attackers(target, c)
      .map((s) => PIECE_VALUE[chess.get(s)!.type])
      .sort((a, b) => a - b);
  const atk = vals(by);
  const def = vals(victim.color);
  if (atk.length === 0) return 0;
  const gains: number[] = [PIECE_VALUE[victim.type]];
  let onSquare = atk.shift()!;
  let side: 'atk' | 'def' = 'def';
  for (;;) {
    const list = side === 'def' ? def : atk;
    if (list.length === 0) break;
    gains.push(onSquare - gains[gains.length - 1]);
    onSquare = list.shift()!;
    side = side === 'def' ? 'atk' : 'def';
  }
  for (let i = gains.length - 1; i > 0; i--) gains[i - 1] = -Math.max(-gains[i - 1], gains[i]);
  return Math.max(0, gains[0]);
}

/** Pieces of `color` that the opponent can win by capture right now (SEE > 0). */
export function hangingPieces(chess: Chess, color: Color): { square: Square; type: PieceSymbol; gain: number; undefended: boolean }[] {
  const out: { square: Square; type: PieceSymbol; gain: number; undefended: boolean }[] = [];
  for (const p of pieces(chess, color)) {
    if (p.type === 'k') continue;
    const gain = see(chess, p.square, opposite(color));
    if (gain > 0) out.push({ square: p.square, type: p.type, gain, undefended: chess.attackers(p.square, color).length === 0 });
  }
  return out.sort((a, b) => b.gain - a.gain);
}

export function kingSquare(chess: Chess, color: Color): Square | null {
  return pieces(chess, color).find((p) => p.type === 'k')?.square ?? null;
}

/** Load a FEN into a new Chess instance with a side-to-move override (for "threat" checks). */
export function withTurn(fen: string, turn: Color): Chess {
  const parts = fen.split(' ');
  parts[1] = turn;
  parts[3] = '-'; // en-passant square is invalid after switching turns
  try {
    return new Chess(parts.join(' '));
  } catch {
    return new Chess(fen);
  }
}

export function uciToMove(chess: Chess, uci: string): Move | null {
  try {
    return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] as PieceSymbol | undefined });
  } catch {
    return null;
  }
}

/** Convert a UCI line to SAN, stopping at the first illegal move. */
export function uciLineToSan(fen: string, line: string[], maxPlies = 99): string[] {
  const c = new Chess(fen);
  const out: string[] = [];
  for (const u of line.slice(0, maxPlies)) {
    const m = uciToMove(c, u);
    if (!m) break;
    out.push(m.san);
  }
  return out;
}

/** "12. Nf3 Nc6 13. Bb5" or "12... Nc6 13. Bb5" depending on side to move. */
export function formatLine(fen: string, sans: string[]): string {
  const parts = fen.split(' ');
  let moveNo = parseInt(parts[5] ?? '1', 10) || 1;
  let turn = parts[1] as Color;
  const out: string[] = [];
  sans.forEach((s, i) => {
    if (turn === 'w') out.push(`${moveNo}. ${s}`);
    else out.push(i === 0 ? `${moveNo}... ${s}` : s);
    if (turn === 'b') moveNo++;
    turn = opposite(turn);
  });
  return out.join(' ');
}

export function moveUci(m: { from: string; to: string; promotion?: string }): string {
  return m.from + m.to + (m.promotion ?? '');
}

export function isPassedPawn(chess: Chess, s: Square): boolean {
  const p = chess.get(s);
  if (!p || p.type !== 'p') return false;
  const [f, r] = coords(s);
  const dir = p.color === 'w' ? 1 : -1;
  for (let df = -1; df <= 1; df++) {
    for (let nr = r + dir; nr >= 0 && nr <= 7; nr += dir) {
      const t = sq(f + df, nr);
      if (!t) continue;
      const q = chess.get(t);
      if (q && q.type === 'p' && q.color !== p.color) return false;
    }
  }
  return true;
}

export function passedPawns(chess: Chess, color: Color): Square[] {
  return pieces(chess, color)
    .filter((p) => p.type === 'p' && isPassedPawn(chess, p.square))
    .map((p) => p.square);
}

/** Count of legal moves for `color` (mobility), excluding king moves. */
export function mobility(fen: string, color: Color): number {
  const c = withTurn(fen, color);
  return c.moves({ verbose: true }).filter((m) => m.piece !== 'k').length;
}

export function pawnFiles(chess: Chess, color: Color): number[] {
  const counts = new Array(8).fill(0);
  pieces(chess, color)
    .filter((p) => p.type === 'p')
    .forEach((p) => counts[coords(p.square)[0]]++);
  return counts;
}

export function pawnWeaknesses(chess: Chess, color: Color): { doubled: number; isolated: number } {
  const files = pawnFiles(chess, color);
  let doubled = 0;
  let isolated = 0;
  files.forEach((n, f) => {
    if (n > 1) doubled += n - 1;
    if (n > 0 && (files[f - 1] ?? 0) === 0 && (files[f + 1] ?? 0) === 0) isolated += n;
  });
  return { doubled, isolated };
}

/** Squares adjacent to the king that are shielded by own pawns (rough king-safety metric). */
export function kingShield(chess: Chess, color: Color): number {
  const k = kingSquare(chess, color);
  if (!k) return 0;
  const [f, r] = coords(k);
  const dir = color === 'w' ? 1 : -1;
  let n = 0;
  for (let df = -1; df <= 1; df++) {
    for (const dr of [dir, 2 * dir]) {
      const s = sq(f + df, r + dr);
      const p = s && chess.get(s);
      if (p && p.type === 'p' && p.color === color) {
        n++;
        break;
      }
    }
  }
  return n;
}

/** Count enemy pieces attacking the king zone. */
export function kingZoneAttackers(chess: Chess, color: Color): number {
  const k = kingSquare(chess, color);
  if (!k) return 0;
  const [f, r] = coords(k);
  const zone = new Set<Square>();
  for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) {
    const s = sq(f + df, r + dr);
    if (s) zone.add(s);
  }
  let n = 0;
  for (const p of pieces(chess, opposite(color))) {
    if (p.type === 'k' || p.type === 'p') continue;
    if (attacksFrom(chess, p.square).some((s) => zone.has(s))) n++;
  }
  return n;
}
