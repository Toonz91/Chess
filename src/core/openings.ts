// A compact opening table (SAN sequences). Used to name the opening and to mark
// well-known theory moves as "book" so the tutor stays quiet about them.

const OPENINGS: [string, string][] = [
  ['e4', "King's Pawn Opening"],
  ['e4 e5', 'Open Game'],
  ['e4 e5 Nf3', "King's Knight Opening"],
  ['e4 e5 Nf3 Nc6', "King's Knight Opening: Normal Variation"],
  ['e4 e5 Nf3 Nc6 Bb5', 'Ruy Lopez'],
  ['e4 e5 Nf3 Nc6 Bb5 a6', 'Ruy Lopez: Morphy Defence'],
  ['e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6', 'Ruy Lopez: Morphy Defence'],
  ['e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7', 'Ruy Lopez: Closed'],
  ['e4 e5 Nf3 Nc6 Bb5 Nf6', 'Ruy Lopez: Berlin Defence'],
  ['e4 e5 Nf3 Nc6 Bc4', 'Italian Game'],
  ['e4 e5 Nf3 Nc6 Bc4 Bc5', 'Italian Game: Giuoco Piano'],
  ['e4 e5 Nf3 Nc6 Bc4 Bc5 c3', 'Italian Game: Giuoco Piano, Main Line'],
  ['e4 e5 Nf3 Nc6 Bc4 Bc5 b4', 'Italian Game: Evans Gambit'],
  ['e4 e5 Nf3 Nc6 Bc4 Nf6', 'Italian Game: Two Knights Defence'],
  ['e4 e5 Nf3 Nc6 d4', 'Scotch Game'],
  ['e4 e5 Nf3 Nc6 d4 exd4 Nxd4', 'Scotch Game'],
  ['e4 e5 Nf3 Nc6 Nc3 Nf6', 'Four Knights Game'],
  ['e4 e5 Nf3 Nf6', 'Petrov Defence'],
  ['e4 e5 Nf3 d6', 'Philidor Defence'],
  ['e4 e5 f4', "King's Gambit"],
  ['e4 e5 Nc3', 'Vienna Game'],
  ['e4 e5 Bc4', "Bishop's Opening"],
  ['e4 c5', 'Sicilian Defence'],
  ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3', 'Sicilian Defence: Open'],
  ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6', 'Sicilian Defence: Najdorf'],
  ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6', 'Sicilian Defence: Dragon'],
  ['e4 c5 Nf3 Nc6', 'Sicilian Defence: Old Sicilian'],
  ['e4 c5 Nf3 e6', 'Sicilian Defence: French Variation'],
  ['e4 c5 c3', 'Sicilian Defence: Alapin'],
  ['e4 c5 Nc3', 'Sicilian Defence: Closed'],
  ['e4 e6', 'French Defence'],
  ['e4 e6 d4 d5', 'French Defence'],
  ['e4 e6 d4 d5 e5', 'French Defence: Advance'],
  ['e4 e6 d4 d5 Nc3', 'French Defence: Paulsen'],
  ['e4 e6 d4 d5 Nd2', 'French Defence: Tarrasch'],
  ['e4 e6 d4 d5 exd5 exd5', 'French Defence: Exchange'],
  ['e4 c6', 'Caro-Kann Defence'],
  ['e4 c6 d4 d5', 'Caro-Kann Defence'],
  ['e4 c6 d4 d5 e5', 'Caro-Kann Defence: Advance'],
  ['e4 c6 d4 d5 Nc3 dxe4 Nxe4', 'Caro-Kann Defence: Main Line'],
  ['e4 d5', 'Scandinavian Defence'],
  ['e4 d5 exd5 Qxd5', 'Scandinavian Defence: Main Line'],
  ['e4 d6', 'Pirc Defence'],
  ['e4 g6', 'Modern Defence'],
  ['e4 Nf6', "Alekhine's Defence"],
  ['d4', "Queen's Pawn Opening"],
  ['d4 d5', "Queen's Pawn Game"],
  ['d4 d5 c4', "Queen's Gambit"],
  ['d4 d5 c4 e6', "Queen's Gambit Declined"],
  ['d4 d5 c4 e6 Nc3 Nf6', "Queen's Gambit Declined"],
  ['d4 d5 c4 dxc4', "Queen's Gambit Accepted"],
  ['d4 d5 c4 c6', 'Slav Defence'],
  ['d4 d5 c4 c6 Nf3 Nf6 Nc3', 'Slav Defence: Main Line'],
  ['d4 d5 Nf3 Nf6 Bf4', 'London System'],
  ['d4 d5 Bf4', 'London System'],
  ['d4 Nf6 Bf4', 'London System'],
  ['d4 Nf6', 'Indian Defence'],
  ['d4 Nf6 c4', 'Indian Defence'],
  ['d4 Nf6 c4 g6', "King's Indian Defence"],
  ['d4 Nf6 c4 g6 Nc3 Bg7 e4 d6', "King's Indian Defence: Main Line"],
  ['d4 Nf6 c4 g6 Nc3 d5', 'Grünfeld Defence'],
  ['d4 Nf6 c4 e6', 'Indian Game: East Indian'],
  ['d4 Nf6 c4 e6 Nc3 Bb4', 'Nimzo-Indian Defence'],
  ['d4 Nf6 c4 e6 Nf3 b6', "Queen's Indian Defence"],
  ['d4 Nf6 c4 c5', 'Benoni Defence'],
  ['d4 f5', 'Dutch Defence'],
  ['c4', 'English Opening'],
  ['c4 e5', 'English Opening: Reversed Sicilian'],
  ['c4 Nf6', 'English Opening: Anglo-Indian'],
  ['Nf3', 'Réti Opening'],
  ['Nf3 d5 c4', 'Réti Opening'],
  ['g3', "King's Fianchetto Opening"],
  ['b3', 'Nimzo-Larsen Attack'],
  ['f4', "Bird's Opening"],
];

const TABLE = OPENINGS.map(([seq, name]) => ({ moves: seq.split(' '), name }));

/** Longest matching opening name for a SAN move list. */
export function openingName(sans: string[]): string | null {
  let best: { len: number; name: string } | null = null;
  for (const o of TABLE) {
    if (o.moves.length > sans.length) continue;
    if (o.moves.every((m, i) => m === sans[i]) && (!best || o.moves.length > best.len)) best = { len: o.moves.length, name: o.name };
  }
  return best?.name ?? null;
}

/** Is the move sequence (ending with the move in question) still inside known theory? */
export function isBookSequence(sans: string[]): boolean {
  if (sans.length === 0) return false;
  return TABLE.some((o) => o.moves.length >= sans.length && sans.every((m, i) => m === o.moves[i]));
}
