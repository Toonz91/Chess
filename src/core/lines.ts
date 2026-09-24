// Play out engine lines to measure concrete consequences (material, mate, promotion).
import { Chess, type Color, type PieceSymbol } from 'chess.js';
import { PIECE_NAME, PIECE_VALUE, materialBalance, uciToMove } from './board';
import { isBackRankMate } from './motifs';

export interface LineOutcome {
  /** SAN of the plies actually considered. */
  sans: string[];
  ucis: string[];
  /** Material change for `side` over the line (pawn units). */
  materialDelta: number;
  lostBySide: PieceSymbol[];
  lostByOpponent: PieceSymbol[];
  /** Checkmate reached inside the line: who delivered it. */
  mateBy: Color | null;
  backRankMate: boolean;
  promotedBy: Color[];
  finalFen: string;
  /** Index of the first capture by the opponent (ply within line) or -1. */
  firstOpponentCapture: number;
}

/**
 * Play `ucis` from `fen` and measure the material outcome for `side`.
 * The line is extended past `maxPlies` while captures are still being made so
 * that we do not stop in the middle of an exchange.
 */
export function playLine(fen: string, ucis: string[], side: Color, maxPlies = 8): LineOutcome {
  const c = new Chess(fen);
  const start = materialBalance(c, side);
  const out: LineOutcome = {
    sans: [],
    ucis: [],
    materialDelta: 0,
    lostBySide: [],
    lostByOpponent: [],
    mateBy: null,
    backRankMate: false,
    promotedBy: [],
    finalFen: fen,
    firstOpponentCapture: -1,
  };
  for (let i = 0; i < ucis.length; i++) {
    if (i >= maxPlies) {
      const lastWasCapture = out.sans[out.sans.length - 1]?.includes('x');
      const nextIsCapture = (() => {
        const probe = new Chess(c.fen());
        const m = uciToMove(probe, ucis[i]);
        return !!m?.captured;
      })();
      if (!(lastWasCapture || nextIsCapture) || i >= maxPlies + 4) break;
    }
    const m = uciToMove(c, ucis[i]);
    if (!m) break;
    out.sans.push(m.san);
    out.ucis.push(ucis[i]);
    if (m.captured) {
      if (m.color === side) out.lostByOpponent.push(m.captured);
      else {
        out.lostBySide.push(m.captured);
        if (out.firstOpponentCapture < 0) out.firstOpponentCapture = i;
      }
    }
    if (m.promotion) out.promotedBy.push(m.color);
    if (c.isCheckmate()) {
      out.mateBy = m.color;
      out.backRankMate = isBackRankMate(c);
      break;
    }
  }
  out.materialDelta = materialBalance(c, side) - start;
  out.finalFen = c.fen();
  return out;
}

function countPieces(list: PieceSymbol[], article = 'a'): string {
  const order: PieceSymbol[] = ['q', 'r', 'b', 'n', 'p'];
  const parts: string[] = [];
  for (const t of order) {
    const n = list.filter((x) => x === t).length;
    if (n === 1) parts.push(`${article} ${PIECE_NAME[t]}`);
    else if (n > 1) parts.push(`${n} ${PIECE_NAME[t]}s`);
  }
  return parts.join(' and ');
}

/** "your queen for a knight", "a pawn", etc. Returns null when nothing meaningful changes hands. */
export function describeMaterialSwing(o: LineOutcome, perspective: 'lose' | 'win'): string | null {
  // Cancel identical captures (equal trades).
  const mine = [...o.lostBySide];
  const theirs = [...o.lostByOpponent];
  for (let i = mine.length - 1; i >= 0; i--) {
    const j = theirs.indexOf(mine[i]);
    if (j >= 0) {
      theirs.splice(j, 1);
      mine.splice(i, 1);
    }
  }
  const [give, get] = perspective === 'lose' ? [mine, theirs] : [theirs, mine];
  if (give.length === 0) return null;
  const giveTxt = countPieces(give, perspective === 'lose' ? 'your' : 'a');
  const getTxt = countPieces(get);
  const giveVal = give.reduce((a, t) => a + PIECE_VALUE[t], 0);
  const getVal = get.reduce((a, t) => a + PIECE_VALUE[t], 0);
  if (giveVal - getVal <= 0) return null;
  if (give.length === 1 && give[0] === 'r' && get.length === 1 && (get[0] === 'n' || get[0] === 'b')) return 'the exchange (a rook for a minor piece)';
  return getTxt ? `${giveTxt} for ${getTxt}` : giveTxt;
}
