// Tutor explanation engine: turns the concrete position + engine lines into
// human-readable reasons, prioritised by chess importance.
import { Chess, type Color, type Square } from 'chess.js';
import type { Arrow, Classification, Explanation, MistakeKind, Phase, Score, SquareMark, Tag } from './types';
import {
  PIECE_NAME,
  PIECE_VALUE,
  colorName,
  coords,
  describePiece,
  formatLine,
  hangingPieces,
  kingShield,
  kingSquare,
  mobility,
  opposite,
  passedPawns,
  pawnWeaknesses,
  see,
  uciToMove,
} from './board';
import { detectMotifs, threatsBy, type Motif } from './motifs';
import { describeMaterialSwing, type LineOutcome } from './lines';
import { formatScore, verdict, verdictText, winChance } from './evaluation';

export interface ExplainInput {
  side: Color;
  fenBefore: string;
  playedUci: string;
  bestUci: string | null;
  classification: Classification;
  missedOpportunity: boolean;
  bestScore: Score;
  playedScore: Score;
  winLoss: number;
  playedOutcome: LineOutcome;
  bestOutcome: LineOutcome;
  phase: Phase;
  /** SAN history of the game before this move (for opening principles). */
  history: { san: string; from: string; to: string; piece: string; color: Color }[];
}

export interface ExplainResult {
  explanation: Explanation;
  tags: Tag[];
  mistakeKind: MistakeKind;
  bestIsHard: boolean;
}

interface Reason {
  priority: number; // lower = more important (spec §14 order)
  text: string;
  tags: Tag[];
}

const P = {
  mate: 1,
  forcedTactic: 2,
  material: 3,
  exchange: 4,
  kingSafety: 5,
  tacticalOpportunity: 6,
  positional: 7,
  minor: 8,
} as const;

const MOTIF_TAG: Partial<Record<Motif['kind'], Tag>> = {
  fork: 'fork',
  'double-attack': 'double-attack',
  pin: 'pin',
  skewer: 'skewer',
  'discovered-attack': 'discovered-attack',
  'discovered-check': 'discovered-attack',
  'removal-of-defender': 'removal-of-defender',
  'back-rank-mate': 'back-rank',
};

const MISSED_TAG: Partial<Record<Motif['kind'], Tag>> = {
  fork: 'missed-fork',
  'double-attack': 'missed-fork',
  pin: 'missed-pin',
  skewer: 'missed-skewer',
  'discovered-attack': 'missed-discovered-attack',
  'discovered-check': 'missed-discovered-attack',
  mate: 'missed-mate',
  'back-rank-mate': 'missed-mate',
  promotion: 'missed-promotion',
};

const TACTICAL_MOTIFS: Motif['kind'][] = ['fork', 'double-attack', 'pin', 'skewer', 'discovered-attack', 'discovered-check', 'removal-of-defender'];

export const PRINCIPLES: Partial<Record<Tag, string>> = {
  'allowed-mate': 'Before every move ask: "What does my opponent threaten?" Checks, captures and threats come first.',
  'mate-threat': 'Before every move ask: "What does my opponent threaten?" Checks, captures and threats come first.',
  'back-rank': 'Give your king an escape square ("luft") or keep a defender on the back rank.',
  'missed-mate': 'Always look at every check first — forcing moves can end the game on the spot.',
  fork: 'Watch for squares where one enemy piece can attack two of yours at once, especially knight jumps onto undefended pieces and your king.',
  'double-attack': 'Loose pieces drop off: keep your pieces defended so a double attack cannot win one.',
  pin: 'A pinned piece is a poor defender. Avoid lining up your king or queen behind other pieces on open lines.',
  skewer: 'Keep your most valuable pieces off open lines that enemy rooks, bishops or queens can reach.',
  'discovered-attack': 'When a piece moves, check which lines it opens — for you and for your opponent.',
  'removal-of-defender': 'Notice which pieces are doing a defensive job; if a defender is captured or lured away, what it guarded falls.',
  'overloaded-defender': 'A piece that defends two things at once is overloaded — one of them will fall.',
  'hanging-piece': 'Blunder-check every move: which of my pieces are attacked, and are they defended enough?',
  'material-loss': 'Count attackers and defenders on every contested square before you move.',
  'losing-exchange': 'Count attackers and defenders before starting an exchange; trade only when it favours you.',
  'missed-material': 'Scan forcing moves for both sides every turn: checks, captures, threats.',
  'missed-fork': 'Look for squares from which one of your pieces attacks two targets — especially with knights and queens.',
  'missed-pin': 'Pieces lined up with their king or queen are pinning targets for your bishops, rooks and queen.',
  'missed-skewer': 'A valuable piece in front of another on an open line invites a skewer.',
  'missed-discovered-attack': 'A piece standing in front of your rook, bishop or queen can move with tempo to unleash a discovered attack.',
  'missed-promotion': 'Advanced passed pawns are worth far more than one point — push them when the path is clear.',
  'missed-defense': 'When your opponent makes a threat, deal with it before pursuing your own plans.',
  'missed-simplification': 'When you are ahead in material, trade pieces (not pawns) to reach a winning endgame.',
  'king-safety': 'Keep your king sheltered until the endgame; every open line toward it is an invitation to attack.',
  'weakening-pawn-move': 'Pawns in front of a castled king are its shield; pawn moves there create permanent holes.',
  'opening-development': 'In the opening, develop each piece once toward the centre, castle early, and fight for the centre.',
  'repeated-piece-move': 'Avoid moving the same piece twice in the opening unless it wins something — develop new pieces instead.',
  'early-queen': 'Bringing the queen out early lets your opponent gain time by attacking it while developing.',
  'passed-pawn': 'Passed pawns must be blockaded, and they grow stronger as pieces come off the board.',
  'pawn-structure': 'Pawn moves are permanent; avoid doubled or isolated pawns unless you get something concrete.',
  'piece-activity': 'Put pieces where they control many squares; a passive piece is almost like playing a piece down.',
  'king-activity': 'In the endgame the king is a strong piece — bring it toward the centre and the pawns.',
  'endgame-technique': 'In endgames, calculate pawn races precisely and activate your king.',
  promotion: 'Stop enemy passed pawns early — the closer they get, the more pieces it takes to stop them.',
  sacrifice: 'Material is not everything: a sacrifice can be correct if it forces mate or wins back more.',
};

function lineText(fen: string, sans: string[], max = 8): string {
  return formatLine(fen, sans.slice(0, max));
}

function opp(side: Color): string {
  return colorName(opposite(side));
}

/** Arrow from a UCI move. */
function arrow(uci: string | null | undefined, kind: Arrow['kind']): Arrow | null {
  if (!uci || uci.length < 4) return null;
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), kind };
}

function transitionSentence(before: Score, after: Score, side: Color): string {
  const vb = verdict(before, side);
  const va = verdict(after, side);
  const them = opp(side);
  const wA = winChance(after, side);
  const theirGain = wA <= 15 ? 'a winning advantage' : wA <= 33 ? 'a clear advantage' : 'the upper hand';
  const range = `${formatScore(before)} → ${formatScore(after)}`;
  if (vb === va) return `The evaluation slips (${range}); you are still ${verdictText(va)}, but you gave away part of your chances for nothing.`;
  if (vb === 'equal' && wA < 44) return `The position was roughly equal before this move, but afterwards ${them} gets ${theirGain} (${range}).`;
  return `You go from ${verdictText(vb)} to ${verdictText(va)} (${range}).`;
}

/** Find a user piece that could defend `target` but is pinned (so it cannot). */
function pinnedDefender(fen: string, target: Square, defender: Color): Square | null {
  const parts = fen.split(' ');
  parts[1] = defender;
  parts[3] = '-';
  let c: Chess;
  try {
    c = new Chess(parts.join(' '));
  } catch {
    return null;
  }
  const attackers = c.attackers(target, defender);
  const legalTo = new Set(c.moves({ verbose: true }).filter((m) => m.to === target).map((m) => m.from));
  // Temporarily remove the target so "capture own piece" issues don't hide defenders.
  return attackers.find((s) => !legalTo.has(s) && c.get(s)?.type !== 'k') ?? null;
}

/** Why is the played move bad (or fine)? */
function explainPlayed(inp: ExplainInput, marks: SquareMark[], arrows: Arrow[]): Reason[] {
  const { side, fenBefore, playedUci, playedOutcome: po, bestOutcome: bo } = inp;
  const reasons: Reason[] = [];
  const them = opp(side);
  const before = new Chess(fenBefore);
  const after = new Chess(fenBefore);
  const m = uciToMove(after, playedUci);
  if (!m) return reasons;
  const fenAfter = after.fen();
  const reply = po.ucis[1];
  const replySan = po.sans[1];
  if (reply) {
    const a = arrow(reply, 'threat');
    if (a) arrows.push(a);
  }

  // 1. Mate.
  if (po.mateBy === opposite(side) || (inp.playedScore.mate !== undefined && (side === 'w' ? inp.playedScore.mate < 0 : inp.playedScore.mate > 0))) {
    const n = inp.playedScore.mate !== undefined ? Math.abs(inp.playedScore.mate) : Math.ceil(po.sans.length / 2);
    const tags: Tag[] = ['allowed-mate'];
    let text = `This allows a forced checkmate in ${n}: ${lineText(fenBefore, po.sans, 12)}.`;
    if (po.backRankMate) {
      tags.push('back-rank');
      text += ' Your king is trapped on the back rank by its own pawns.';
    }
    reasons.push({ priority: P.mate, text, tags });
    const k = kingSquare(after, side);
    if (k) marks.push({ square: k, kind: 'threat' });
  }

  // 2. The opponent's reply is a tactic.
  if (reply) {
    const motifs = detectMotifs(fenAfter, reply, 'your').filter((x) => TACTICAL_MOTIFS.includes(x.kind));
    const mt = motifs[0];
    // If the reply simply captures the piece we just put en prise, the material reason says it better.
    const simpleCapture = reply.slice(2, 4) === m.to && see(after, m.to as Square, opposite(side)) > 0;
    if (mt && !simpleCapture && (po.materialDelta < 0 || inp.winLoss >= 10)) {
      const tag = MOTIF_TAG[mt.kind];
      const gain = describeMaterialSwing(po, 'lose');
      reasons.push({
        priority: P.forcedTactic,
        text: `${them} answers ${replySan}, which ${mt.text}${gain ? ` — you end up losing ${gain}` : ''}.`,
        tags: tag ? [tag] : [],
      });
      mt.squares.forEach((s) => marks.push({ square: s, kind: 'threat' }));
    }
  }

  // 3. Material.
  const matLoss = bo.materialDelta - po.materialDelta;
  if (po.materialDelta <= -1 && matLoss >= 1) {
    const swing = describeMaterialSwing(po, 'lose');
    const lossTxt = swing ? `you lose ${swing}` : `you lose material`;
    // a) Moved piece is en prise.
    const movedLoss = see(after, m.to as Square, opposite(side));
    const oppHangingBefore = new Set(hangingPieces(before, side).map((h) => h.square));
    const newlyHanging = hangingPieces(after, side).filter((h) => h.square !== m.to && !oppHangingBefore.has(h.square));
    const stillHanging = hangingPieces(after, side).filter((h) => oppHangingBefore.has(h.square));
    if (m.captured && movedLoss > 0 && PIECE_VALUE[m.piece] > PIECE_VALUE[m.captured]) {
      reasons.push({
        priority: P.exchange,
        text: `This capture loses material: your ${PIECE_NAME[m.piece]} takes a ${PIECE_NAME[m.captured]} but can be recaptured, and after ${lineText(fenBefore, po.sans, 6)} ${lossTxt}.`,
        tags: ['losing-exchange', 'material-loss'],
      });
    } else if (movedLoss > 0) {
      const undefended = after.attackers(m.to as Square, side).length === 0;
      reasons.push({
        priority: P.material,
        text: `This puts your ${PIECE_NAME[m.promotion ?? m.piece]} on ${m.to} where it is ${undefended ? 'undefended' : 'not defended enough'}: ${them} can take it${replySan ? ` with ${replySan}` : ''}, and ${lossTxt}.`,
        tags: ['hanging-piece', 'material-loss'],
      });
      marks.push({ square: m.to as Square, kind: 'hanging' });
    } else if (newlyHanging.length) {
      const h = newlyHanging[0];
      const wasDefender = before.attackers(h.square, side).includes(m.from as Square);
      reasons.push({
        priority: P.material,
        text: wasDefender
          ? `Your ${PIECE_NAME[m.piece]} was defending your ${describePiece(after, h.square)}. Moving it away leaves that piece ${h.undefended ? 'undefended' : 'insufficiently defended'}, and ${lossTxt}.`
          : `After this move your ${describePiece(after, h.square)} is left ${h.undefended ? 'undefended' : 'insufficiently defended'}, and ${lossTxt}.`,
        tags: wasDefender ? ['hanging-piece', 'material-loss', 'overloaded-defender'] : ['hanging-piece', 'material-loss'],
      });
      marks.push({ square: h.square, kind: 'hanging' });
    } else if (stillHanging.length) {
      const h = stillHanging[0];
      reasons.push({
        priority: P.material,
        text: `Your ${describePiece(after, h.square)} was already under attack, and this move does nothing about it — ${lossTxt}.`,
        tags: ['missed-defense', 'hanging-piece', 'material-loss'],
      });
      marks.push({ square: h.square, kind: 'hanging' });
    } else {
      // Look for a pinned defender at the first capture square.
      let pinned: Square | null = null;
      let capSq: Square | null = null;
      if (po.firstOpponentCapture >= 0) {
        const c = new Chess(fenBefore);
        for (let i = 0; i < po.firstOpponentCapture; i++) uciToMove(c, po.ucis[i]);
        capSq = po.ucis[po.firstOpponentCapture].slice(2, 4) as Square;
        pinned = pinnedDefender(c.fen(), capSq, side);
      }
      if (pinned && capSq) {
        reasons.push({
          priority: P.forcedTactic,
          text: `This loses material on ${capSq}: your ${describePiece(new Chess(fenAfter), pinned)} looks like a defender, but it is pinned and cannot recapture. After ${lineText(fenBefore, po.sans)} ${lossTxt}.`,
          tags: ['pin', 'material-loss'],
        });
        marks.push({ square: pinned, kind: 'threat' });
      } else {
        reasons.push({
          priority: P.material,
          text: `After ${lineText(fenBefore, po.sans)} ${lossTxt}.`,
          tags: ['material-loss'],
        });
      }
    }
  }

  // Opponent promotes in the line.
  if (po.promotedBy.includes(opposite(side)) && !bo.promotedBy.includes(opposite(side))) {
    reasons.push({ priority: P.material, text: `It lets ${them}'s pawn run through to promotion.`, tags: ['promotion', 'passed-pawn'] });
  }

  // 5. King safety.
  const k = kingSquare(before, side);
  if (k && inp.phase !== 'endgame') {
    const [kf] = coords(k);
    const castled = (side === 'w' ? k[1] === '1' : k[1] === '8') && (kf >= 5 || kf <= 2);
    if (m.piece === 'p' && castled) {
      const pf = coords(m.from as Square)[0];
      const nearKing = Math.abs(pf - kf) <= 1 || (kf >= 5 && pf >= 5) || (kf <= 2 && pf <= 2);
      if (nearKing && kingShield(after, side) < kingShield(before, side)) {
        reasons.push({
          priority: P.kingSafety,
          text: `Pushing the ${m.from[0]}-pawn weakens the pawn shelter in front of your king${m.from[0] === 'f' ? ' — the f-pawn was guarding the diagonal to your king' : ''}; ${them}'s pieces get new entry squares.`,
          tags: ['king-safety', 'weakening-pawn-move'],
        });
      }
    }
    if (m.piece === 'k' && !m.isKingsideCastle() && !m.isQueensideCastle() && inp.phase === 'opening') {
      const rights = fenBefore.split(' ')[2];
      const had = side === 'w' ? /[KQ]/.test(rights) : /[kq]/.test(rights);
      if (had)
        reasons.push({
          priority: P.kingSafety,
          text: 'Moving your king gives up the right to castle and leaves it stuck in the centre.',
          tags: ['king-safety'],
        });
    }
  }

  // 7. Opening principles.
  if (inp.phase === 'opening') {
    const mine = inp.history.filter((h) => h.color === side);
    const movedBefore = mine.some((h) => h.to === m.from && h.piece === m.piece && m.piece !== 'p');
    const undeveloped = ['b', 'c', 'f', 'g']
      .map((f) => f + (side === 'w' ? '1' : '8'))
      .filter((s) => {
        const p = before.get(s as Square);
        return p && p.color === side && (p.type === 'n' || p.type === 'b');
      }).length;
    if (movedBefore && undeveloped >= 2 && !m.captured) {
      reasons.push({
        priority: P.positional,
        text: `This moves your ${PIECE_NAME[m.piece]} a second time while ${undeveloped} of your minor pieces are still on their starting squares.`,
        tags: ['repeated-piece-move', 'opening-development'],
      });
    }
    if (m.piece === 'q' && m.from === (side === 'w' ? 'd1' : 'd8') && mine.length < 8 && undeveloped >= 2 && !m.captured) {
      reasons.push({
        priority: P.positional,
        text: `Bringing the queen out this early lets ${them} develop with tempo by attacking it.`,
        tags: ['early-queen', 'opening-development'],
      });
    }
  }

  // Positional comparison of where the lines end up (not for misses: the move itself was fine).
  if (reasons.length === 0 && inp.classification !== 'miss') {
    const endP = new Chess(po.finalFen);
    const endB = new Chess(bo.finalFen);
    const theirPassedP = passedPawns(endP, opposite(side)).length;
    const theirPassedB = passedPawns(endB, opposite(side)).length;
    if (theirPassedP > theirPassedB) {
      reasons.push({ priority: P.positional, text: `It gives ${them} a passed pawn, a long-term asset that will tie your pieces down.`, tags: ['passed-pawn'] });
    }
    const wP = pawnWeaknesses(endP, side);
    const wB = pawnWeaknesses(endB, side);
    if (wP.doubled + wP.isolated > wB.doubled + wB.isolated) {
      reasons.push({
        priority: P.positional,
        text: `Your pawn structure suffers: you end up with ${wP.doubled > wB.doubled ? 'doubled' : 'isolated'} pawns that are hard to defend.`,
        tags: ['pawn-structure'],
      });
    }
    const mobP = mobility(po.finalFen, side);
    const mobB = mobility(bo.finalFen, side);
    if (mobB - mobP >= 6) {
      reasons.push({
        priority: P.positional,
        text: `Your pieces become passive: in the engine's line you have ${mobP} available moves instead of ${mobB} after the best move.`,
        tags: ['piece-activity'],
      });
    }
    if (inp.phase === 'endgame') {
      const kP = kingSquare(endP, side);
      const kB = kingSquare(endB, side);
      const centreDist = (s: Square | null) => {
        if (!s) return 0;
        const [f, r] = coords(s);
        return Math.max(Math.abs(3.5 - f), Math.abs(3.5 - r));
      };
      if (centreDist(kP) - centreDist(kB) >= 1.5) {
        reasons.push({ priority: P.positional, text: 'In the endgame your king should be active; this line leaves it far from the action.', tags: ['king-activity', 'endgame-technique'] });
      } else {
        reasons.push({ priority: P.minor, text: 'Endgames are decided by precise calculation; this move makes your task harder.', tags: ['endgame-technique'] });
      }
    }
  }

  return reasons;
}

/** Why is the best move good? Also returns the "opportunity" description for misses. */
function explainBest(inp: ExplainInput, marks: SquareMark[], arrows: Arrow[]): { reasons: Reason[]; opportunity?: string; bestIsHard: boolean } {
  const { side, fenBefore, bestUci, bestOutcome: bo, playedOutcome: po } = inp;
  const reasons: Reason[] = [];
  if (!bestUci) return { reasons, bestIsHard: false };
  const bestSan = bo.sans[0] ?? bestUci;
  const them = opp(side);
  const theirs = side === 'w' ? "Black's" : "White's";
  const motifs = detectMotifs(fenBefore, bestUci, theirs);
  const after = new Chess(fenBefore);
  const m = uciToMove(after, bestUci);
  let opportunity: string | undefined;
  let bestIsHard = false;

  // Mate.
  const mateForMe = bo.mateBy === side || (inp.bestScore.mate !== undefined && (side === 'w' ? inp.bestScore.mate > 0 : inp.bestScore.mate < 0));
  if (mateForMe) {
    const n = inp.bestScore.mate !== undefined ? Math.abs(inp.bestScore.mate) : Math.ceil(bo.sans.length / 2);
    const text = n <= 1 ? `${bestSan} is checkmate.` : `${bestSan} starts a forced checkmate in ${n}: ${lineText(fenBefore, bo.sans, 12)}.`;
    reasons.push({ priority: P.mate, text, tags: ['missed-mate'] });
    opportunity = n <= 1 ? `You had checkmate in one with ${bestSan}.` : `You had a forced mate in ${n} starting with ${bestSan}.`;
  }

  // Tactic by the best move itself or later in the line.
  const tactical = motifs.find((x) => TACTICAL_MOTIFS.includes(x.kind) || x.kind === 'capture-hanging' || x.kind === 'winning-capture');
  let lineMotif: { motif: Motif; san: string } | null = null;
  if (!tactical) {
    // e.g. a check that sets up a fork on the next move.
    const c = new Chess(fenBefore);
    for (let i = 0; i < Math.min(bo.ucis.length, 5); i++) {
      if (i > 0 && i % 2 === 0) {
        const mm = detectMotifs(c.fen(), bo.ucis[i], theirs).find((x) => TACTICAL_MOTIFS.includes(x.kind));
        if (mm) {
          lineMotif = { motif: mm, san: bo.sans[i] };
          break;
        }
      }
      uciToMove(c, bo.ucis[i]);
    }
  }
  const gainTxt = describeMaterialSwing(bo, 'win');
  const extraMat = bo.materialDelta - po.materialDelta;
  if (!mateForMe && tactical) {
    const tag = MISSED_TAG[tactical.kind] ?? (tactical.kind === 'capture-hanging' || tactical.kind === 'winning-capture' ? 'missed-material' : undefined);
    reasons.push({
      priority: TACTICAL_MOTIFS.includes(tactical.kind) ? P.forcedTactic : P.material,
      text: `${bestSan} ${tactical.text}${gainTxt && bo.materialDelta > 0 ? `; after ${lineText(fenBefore, bo.sans, 6)} you win ${gainTxt}` : ''}.`,
      tags: tag ? [tag] : [],
    });
    tactical.squares.forEach((s) => marks.push({ square: s, kind: 'important' }));
    if (extraMat >= 2 || TACTICAL_MOTIFS.includes(tactical.kind)) opportunity = `${bestSan} ${tactical.text}.`;
  } else if (!mateForMe && lineMotif) {
    const tag = MISSED_TAG[lineMotif.motif.kind];
    reasons.push({
      priority: P.forcedTactic,
      text: `${bestSan} prepares ${lineMotif.san}, which ${lineMotif.motif.text}${gainTxt && bo.materialDelta > 0 ? ` — winning ${gainTxt}` : ''}. Line: ${lineText(fenBefore, bo.sans, 8)}.`,
      tags: tag ? [tag] : [],
    });
    opportunity = `${bestSan} sets up ${lineMotif.san}, which ${lineMotif.motif.text}.`;
  } else if (!mateForMe && bo.materialDelta >= 1 && extraMat >= 1) {
    reasons.push({
      priority: P.material,
      text: `${bestSan} wins material: after ${lineText(fenBefore, bo.sans, 8)} you are ${bo.materialDelta} point${bo.materialDelta > 1 ? 's' : ''} up${gainTxt ? ` (you win ${gainTxt})` : ''}.`,
      tags: ['missed-material'],
    });
    opportunity = `${bestSan} wins material${gainTxt ? ` (${gainTxt})` : ''}.`;
  }

  // Promotion.
  if (bo.promotedBy.includes(side) && !po.promotedBy.includes(side)) {
    reasons.push({ priority: P.material, text: `${bestSan} lets your pawn promote: ${lineText(fenBefore, bo.sans, 8)}.`, tags: ['missed-promotion'] });
    opportunity ??= `Your pawn could promote after ${bestSan}.`;
  }

  // Defence: was there a threat the best move handles?
  const threats = threatsBy(withTurnFen(fenBefore, opposite(side)), opposite(side));
  const afterPlayedFen = (() => {
    const c = new Chess(fenBefore);
    uciToMove(c, inp.playedUci);
    return c.fen();
  })();
  if (m) {
    const afterBest = after.fen();
    if (threats.mateInOne) {
      const still = threatsBy(withTurnFen(afterBest, opposite(side)), opposite(side)).mateInOne;
      const stillAfterPlayed = threatsBy(withTurnFen(afterPlayedFen, opposite(side)), opposite(side)).mateInOne;
      if (!still && stillAfterPlayed) {
        reasons.push({ priority: P.mate, text: `${them} was threatening ${threats.mateInOne} with mate; ${bestSan} stops it.`, tags: ['missed-defense', 'mate-threat'] });
      }
    }
    const h = threats.hanging[0];
    if (h && (h.square === m.from || !hangingPieces(after, side).some((x) => x.square === h.square))) {
      const afterPlayed = new Chess(afterPlayedFen);
      const stillHanging = hangingPieces(afterPlayed, side).some((x) => x.square === h.square);
      if (stillHanging && po.lostBySide.length > 0 && !reasons.some((r) => r.priority <= P.material)) {
        reasons.push({
          priority: P.material,
          text: `Your ${PIECE_NAME[h.type as keyof typeof PIECE_NAME]} on ${h.square} was under attack. ${bestSan} ${h.square === m.from ? 'moves it to safety' : 'takes care of it'}.`,
          tags: ['missed-defense'],
        });
      }
    }

    // Sacrifice: the piece can be captured but the line still works.
    const movedLoss = see(after, m.to as Square, opposite(side));
    if (movedLoss >= 2 && winChance(inp.bestScore, side) >= 50 && !m.captured) {
      bestIsHard = true;
      reasons.push({
        priority: P.tacticalOpportunity,
        text: `It's a sacrifice: the ${PIECE_NAME[m.piece]} on ${m.to} can be taken, but ${lineText(fenBefore, bo.sans, 8)} shows why that doesn't work for ${them}.`,
        tags: ['sacrifice'],
      });
    }
  }

  // Positional/quiet reasons.
  const quiet = motifs.filter((x) => x.kind === 'castle' || x.kind === 'development' || x.kind === 'check' || x.kind === 'promotion');
  if (reasons.length === 0 && quiet.length) {
    reasons.push({ priority: P.positional, text: `${bestSan} ${quiet[0].text}.`, tags: quiet[0].kind === 'castle' ? ['king-safety'] : quiet[0].kind === 'development' ? ['opening-development'] : [] });
  }
  if (reasons.length === 0 && m) {
    const endB = new Chess(bo.finalFen);
    const endP = new Chess(po.finalFen);
    if (passedPawns(endB, side).length > passedPawns(endP, side).length) {
      reasons.push({ priority: P.positional, text: `${bestSan} leads to a position where you have a dangerous passed pawn.`, tags: ['passed-pawn'] });
    } else if (m.piece === 'k' && inp.phase === 'endgame') {
      reasons.push({ priority: P.positional, text: `${bestSan} activates your king — in the endgame it is a fighting piece.`, tags: ['king-activity'] });
    } else if (m.piece === 'p' && ['d', 'e', 'c'].includes(m.to[0]) && inp.phase === 'opening') {
      reasons.push({ priority: P.positional, text: `${bestSan} claims space in the centre.`, tags: ['opening-development'] });
    } else {
      const mobAfter = mobility(bo.finalFen, side);
      const mobPlayed = mobility(po.finalFen, side);
      reasons.push({
        priority: P.minor,
        text:
          mobAfter - mobPlayed >= 5
            ? `${bestSan} keeps your pieces active (${mobAfter} available moves in the resulting position vs ${mobPlayed}).`
            : `${bestSan} keeps the position ${verdictText(verdict(inp.bestScore, side))} (${formatScore(inp.bestScore)}).`,
        tags: [],
      });
    }
  }

  const a = arrow(bestUci, 'best');
  if (a) arrows.push(a);
  return { reasons, opportunity, bestIsHard };
}

function withTurnFen(fen: string, turn: Color): string {
  const parts = fen.split(' ');
  parts[1] = turn;
  parts[3] = '-';
  return parts.join(' ');
}

const TAG_HEADLINE: Partial<Record<Tag, string>> = {
  'allowed-mate': 'this allows a forced checkmate.',
  'back-rank': 'your back rank is fatally weak.',
  fork: 'this walks into a fork.',
  'double-attack': 'this allows a double attack.',
  pin: 'a pin costs you material.',
  skewer: 'this allows a skewer.',
  'discovered-attack': 'this allows a discovered attack.',
  'removal-of-defender': 'a key defender disappears.',
  'overloaded-defender': 'you removed an important defender.',
  'hanging-piece': 'this leaves a piece hanging.',
  'losing-exchange': 'this exchange loses material.',
  'missed-defense': "you ignored your opponent's threat.",
  'material-loss': 'this loses material.',
  promotion: "this lets your opponent's pawn promote.",
  'weakening-pawn-move': "this weakens your king's pawn shield.",
  'king-safety': 'this compromises your king safety.',
  'repeated-piece-move': 'you move the same piece twice while others are undeveloped.',
  'early-queen': 'the queen comes out too early.',
  'passed-pawn': 'this gives your opponent a passed pawn.',
  'pawn-structure': 'this damages your pawn structure.',
  'piece-activity': 'your pieces become passive.',
  'king-activity': 'your king should be more active in the endgame.',
  'endgame-technique': 'imprecise endgame technique.',
};

const HEADLINES: Record<Classification, string> = {
  book: 'Book move',
  forced: 'Forced move',
  best: 'Best move',
  excellent: 'Excellent move',
  good: 'Good move',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  blunder: 'Blunder',
  miss: 'Missed opportunity',
};

function firstSentence(t: string): string {
  const i = t.search(/[.!?](\s|$)/);
  return i > 0 ? t.slice(0, i + 1) : t;
}

export function explainMove(inp: ExplainInput): ExplainResult {
  const marks: SquareMark[] = [];
  const arrows: Arrow[] = [];
  const significant = ['inaccuracy', 'mistake', 'blunder', 'miss'].includes(inp.classification);
  const playedArrow = arrow(inp.playedUci, 'played');
  if (playedArrow) arrows.push(playedArrow);

  const playedReasons = significant ? explainPlayed(inp, marks, arrows) : [];
  const isBest = inp.bestUci === inp.playedUci;
  const { reasons: bestReasons, opportunity, bestIsHard } =
    significant || inp.missedOpportunity ? explainBest(inp, marks, arrows) : { reasons: [], opportunity: undefined, bestIsHard: false };

  playedReasons.sort((a, b) => a.priority - b.priority);
  bestReasons.sort((a, b) => a.priority - b.priority);

  const playedWhy = playedReasons.slice(0, 3).map((r) => r.text);
  if (significant && inp.classification !== 'miss') {
    playedWhy.push(transitionSentence(inp.bestScore, inp.playedScore, inp.side));
  }
  if (inp.classification === 'miss') {
    playedWhy.push(
      `Your move is playable (${formatScore(inp.playedScore)}), but it lets ${opp(inp.side)} off the hook — the best move gives ${formatScore(inp.bestScore)}.`,
    );
  }
  const bestWhy = bestReasons.slice(0, 3).map((r) => r.text);

  // Tags: from the most important reasons only.
  const tags = new Set<Tag>();
  if (significant) {
    playedReasons.slice(0, 2).forEach((r) => r.tags.forEach((t) => tags.add(t)));
    if (inp.missedOpportunity || inp.classification === 'miss') bestReasons.slice(0, 2).forEach((r) => r.tags.forEach((t) => tags.add(t)));
    else bestReasons.slice(0, 1).forEach((r) => r.tags.filter((t) => t === 'missed-defense' || t === 'mate-threat').forEach((t) => tags.add(t)));
    if (inp.phase === 'endgame' && tags.size === 0) tags.add('endgame-technique');
  }

  // Headline: the single most important reason, stated plainly.
  let headline = HEADLINES[inp.classification];
  if (inp.classification === 'miss' && opportunity) headline = `Missed opportunity: ${opportunity}`;
  else if (significant) {
    const top = [...playedReasons, ...(inp.missedOpportunity ? bestReasons : [])].sort((a, b) => a.priority - b.priority)[0];
    const short = top?.tags.map((t) => TAG_HEADLINE[t]).find(Boolean);
    if (short) headline = `${HEADLINES[inp.classification]}: ${short}`;
    else if (top) headline = `${HEADLINES[inp.classification]}: ${firstSentence(top.text).replace(/^This /, 'this ')}`;
    else headline = `${HEADLINES[inp.classification]}: the evaluation drops from ${formatScore(inp.bestScore)} to ${formatScore(inp.playedScore)}.`;
  } else if (isBest) {
    const motif = detectMotifs(inp.fenBefore, inp.playedUci, 'the')[0];
    if (motif && motif.kind !== 'check' && motif.kind !== 'development') headline = `${HEADLINES[inp.classification]} — it ${motif.text}.`;
  }

  const principleTag = [...tags].find((t) => PRINCIPLES[t]);
  const principle = principleTag ? PRINCIPLES[principleTag] : undefined;

  const tacticalTags: Tag[] = ['fork', 'pin', 'skewer', 'discovered-attack', 'double-attack', 'back-rank', 'allowed-mate', 'removal-of-defender', 'missed-mate', 'missed-fork', 'missed-pin', 'missed-skewer', 'missed-discovered-attack', 'missed-material', 'overloaded-defender', 'sacrifice'];
  const materialTags: Tag[] = ['hanging-piece', 'material-loss', 'losing-exchange', 'promotion'];
  let mistakeKind: MistakeKind = 'none';
  if (significant) {
    if ([...tags].some((t) => tacticalTags.includes(t))) mistakeKind = 'tactical';
    else if ([...tags].some((t) => materialTags.includes(t))) mistakeKind = 'material';
    else mistakeKind = 'strategic';
  }

  return {
    explanation: { headline, playedWhy, bestWhy, principle, opportunity, arrows, marks },
    tags: [...tags],
    mistakeKind,
    bestIsHard,
  };
}
