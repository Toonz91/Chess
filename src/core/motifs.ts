// Tactical motif detection for a single move in a concrete position.
import { Chess, type Color, type Square } from 'chess.js';
import {
  PIECE_NAME,
  PIECE_VALUE,
  attacksFrom,
  coords,
  describePiece,
  hangingPieces,
  isSlider,
  opposite,
  pieces,
  see,
  sliderDirs,
  sq,
  uciToMove,
  withTurn,
} from './board';

export type MotifKind =
  | 'mate'
  | 'back-rank-mate'
  | 'fork'
  | 'double-attack'
  | 'pin'
  | 'skewer'
  | 'discovered-attack'
  | 'discovered-check'
  | 'capture-hanging'
  | 'winning-capture'
  | 'removal-of-defender'
  | 'promotion'
  | 'check'
  | 'castle'
  | 'development';

export interface Motif {
  kind: MotifKind;
  /** Short human text, e.g. "forks your king and rook". Written relative to the victim ("your" = opponent of mover). */
  text: string;
  squares: Square[];
  /** Material value at stake. */
  value: number;
}

function targetLabel(chess: Chess, s: Square, owner: string): string {
  const p = chess.get(s)!;
  return p.type === 'k' ? `${owner} king` : `${owner} ${PIECE_NAME[p.type]} on ${s}`;
}

function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
}

/** Is the checkmate a back-rank mate (king on its first rank boxed in by its own pawns)? */
export function isBackRankMate(chess: Chess): boolean {
  if (!chess.isCheckmate()) return false;
  const color = chess.turn();
  const k = pieces(chess, color).find((p) => p.type === 'k');
  if (!k) return false;
  const [, r] = coords(k.square);
  const home = color === 'w' ? 0 : 7;
  if (r !== home) return false;
  const [f] = coords(k.square);
  const dir = color === 'w' ? 1 : -1;
  let blockers = 0;
  for (let df = -1; df <= 1; df++) {
    const s = sq(f + df, r + dir);
    const p = s && chess.get(s);
    if (p && p.color === color) blockers++;
  }
  return blockers >= 2;
}

/**
 * Detect the tactical motifs created by playing `uci` in `fen`.
 * `owner` is the possessive used for the victim's pieces ("the", "your", "Black's").
 */
export function detectMotifs(fen: string, uci: string, owner = 'the'): Motif[] {
  const before = new Chess(fen);
  const after = new Chess(fen);
  const m = uciToMove(after, uci);
  if (!m) return [];
  const me: Color = m.color;
  const them = opposite(me);
  const out: Motif[] = [];
  const movedValue = PIECE_VALUE[m.promotion ?? m.piece];

  if (after.isCheckmate()) {
    out.push(
      isBackRankMate(after)
        ? { kind: 'back-rank-mate', text: 'delivers a back-rank checkmate', squares: [m.to], value: 100 }
        : { kind: 'mate', text: 'delivers checkmate', squares: [m.to], value: 100 },
    );
    return out;
  }

  if (m.isKingsideCastle() || m.isQueensideCastle()) {
    out.push({ kind: 'castle', text: 'castles, tucking the king away and connecting the rooks', squares: [m.to], value: 0 });
  }

  if (m.promotion) {
    out.push({ kind: 'promotion', text: `promotes the pawn to a ${PIECE_NAME[m.promotion]}`, squares: [m.to], value: PIECE_VALUE[m.promotion] - 1 });
  }

  // Captures: of a hanging piece, or a favourable trade.
  if (m.captured) {
    const capturedValue = PIECE_VALUE[m.captured];
    const defended = before.attackers(m.to, them).length > 0;
    const gain = see(before, m.to, me);
    if (!defended) {
      out.push({ kind: 'capture-hanging', text: `captures ${owner} undefended ${PIECE_NAME[m.captured]} on ${m.to}`, squares: [m.to], value: capturedValue });
    } else if (gain > 0 && capturedValue > PIECE_VALUE[m.piece]) {
      const exch = capturedValue === 5 && PIECE_VALUE[m.piece] === 3 ? 'wins the exchange' : `wins material (${PIECE_NAME[m.piece]} for ${PIECE_NAME[m.captured]})`;
      out.push({ kind: 'winning-capture', text: `${exch} on ${m.to}`, squares: [m.to], value: capturedValue - PIECE_VALUE[m.piece] });
    }
    // Removal of the defender: capturing a piece that was protecting something else.
    const hangBefore = new Set(hangingPieces(before, them).map((h) => h.square));
    const newlyHanging = hangingPieces(after, them).filter((h) => !hangBefore.has(h.square) && h.square !== m.to);
    if (newlyHanging.length && gain >= 0) {
      out.push({
        kind: 'removal-of-defender',
        text: `removes the defender of ${owner} ${listJoin(newlyHanging.map((h) => describePiece(after, h.square)))}`,
        squares: newlyHanging.map((h) => h.square),
        value: newlyHanging[0].gain,
      });
    }
  }

  // Is the moved piece itself safe after the move?
  const movedLoss = see(after, m.to, them);

  // Forks / double attacks by the moved piece.
  const targets = attacksFrom(after, m.to).filter((s) => {
    const p = after.get(s);
    if (!p || p.color !== them) return false;
    if (p.type === 'k') return true;
    if (PIECE_VALUE[p.type] > movedValue) return true;
    return see(after, s, me) > 0;
  });
  if (targets.length >= 2 && movedLoss < Math.max(...targets.map((t) => PIECE_VALUE[after.get(t)!.type] === 100 ? 0 : PIECE_VALUE[after.get(t)!.type]))) {
    const labels = targets.map((t) => targetLabel(after, t, owner));
    const kind = m.piece === 'q' ? 'double-attack' : 'fork';
    const value = Math.min(...targets.map((t) => (after.get(t)!.type === 'k' ? 100 : PIECE_VALUE[after.get(t)!.type])));
    out.push({
      kind,
      text: kind === 'fork' ? `forks ${listJoin(labels)} with the ${PIECE_NAME[m.piece]}` : `attacks ${listJoin(labels)} at the same time`,
      squares: targets,
      value: value === 100 ? 5 : value,
    });
  }

  // Pins and skewers created by a sliding piece.
  const moverType = m.promotion ?? m.piece;
  if (isSlider(moverType)) {
    const [f, r] = coords(m.to);
    for (const [df, dr] of sliderDirs(moverType)) {
      let first: Square | null = null;
      let nf = f + df;
      let nr = r + dr;
      for (let s = sq(nf, nr); s; nf += df, nr += dr, s = sq(nf, nr)) {
        const p = after.get(s);
        if (!p) continue;
        if (!first) {
          if (p.color !== them) break;
          first = s;
          continue;
        }
        if (p.color !== them) break;
        const a = after.get(first)!;
        const aVal = PIECE_VALUE[a.type];
        const bVal = PIECE_VALUE[p.type];
        // Only instructive pins: to the king, or of a piece to a much more valuable rook/queen.
        if (a.type !== 'k' && (p.type === 'k' || (bVal >= 5 && bVal > aVal && aVal >= 3)) && aVal < movedValue + 3) {
          out.push({
            kind: 'pin',
            text: `pins ${targetLabel(after, first, owner)} to ${targetLabel(after, s, owner)}`,
            squares: [first, s],
            value: p.type === 'k' ? aVal : Math.min(aVal, bVal),
          });
        } else if ((a.type === 'k' || aVal > bVal) && bVal >= 3) {
          out.push({
            kind: 'skewer',
            text: `skewers ${targetLabel(after, first, owner)}, winning ${targetLabel(after, s, owner)} behind it`,
            squares: [first, s],
            value: bVal,
          });
        }
        break;
      }
    }
  }

  // Discovered attacks: another friendly slider gains a new target.
  for (const p of pieces(after, me)) {
    if (p.square === m.to || !isSlider(p.type)) continue;
    const beforeSet = new Set(before.get(p.square) ? attacksFrom(before, p.square) : []);
    const newTargets = attacksFrom(after, p.square).filter((s) => {
      if (beforeSet.has(s)) return false;
      const t = after.get(s);
      if (!t || t.color !== them) return false;
      return t.type === 'k' || PIECE_VALUE[t.type] > PIECE_VALUE[p.type] || see(after, s, me) > 0;
    });
    for (const t of newTargets) {
      const tp = after.get(t)!;
      out.push(
        tp.type === 'k'
          ? { kind: 'discovered-check', text: `unleashes a discovered check from the ${PIECE_NAME[p.type]} on ${p.square}`, squares: [p.square, t], value: 3 }
          : {
              kind: 'discovered-attack',
              text: `uncovers an attack by the ${PIECE_NAME[p.type]} on ${p.square} against ${targetLabel(after, t, owner)}`,
              squares: [p.square, t],
              value: PIECE_VALUE[tp.type],
            },
      );
    }
  }

  if (after.inCheck() && !out.some((o) => o.kind === 'discovered-check' || o.kind === 'fork')) {
    out.push({ kind: 'check', text: 'gives check', squares: [m.to], value: 0 });
  }

  // Development (opening): a minor piece leaves its home rank.
  const homeRank = me === 'w' ? '1' : '8';
  if ((m.piece === 'n' || m.piece === 'b') && m.from[1] === homeRank && !m.captured) {
    out.push({ kind: 'development', text: `develops the ${PIECE_NAME[m.piece]} to an active square`, squares: [m.to], value: 0 });
  }

  const order: MotifKind[] = [
    'mate', 'back-rank-mate', 'fork', 'double-attack', 'discovered-check', 'discovered-attack', 'skewer', 'pin',
    'removal-of-defender', 'capture-hanging', 'winning-capture', 'promotion', 'check', 'castle', 'development',
  ];
  return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}

export interface Threats {
  /** Opponent can mate in one if it were their move. */
  mateInOne: string | null;
  hanging: { square: Square; type: string; gain: number; undefended: boolean }[];
}

/** What `attacker` threatens if it were their turn to move in `fen`. */
export function threatsBy(fen: string, attacker: Color): Threats {
  const c = withTurn(fen, attacker);
  let mateInOne: string | null = null;
  for (const mv of c.moves({ verbose: true })) {
    c.move(mv);
    const mate = c.isCheckmate();
    c.undo();
    if (mate) {
      mateInOne = mv.san;
      break;
    }
  }
  const hanging = hangingPieces(new Chess(fen), opposite(attacker));
  return { mateInOne, hanging };
}
