# Chess Tutor

A real-time chess coach in the browser. You play against Stockfish, and a tutor analyses every move you make:
it classifies the move, explains in plain language **what** went wrong and **why**, shows the better move and
what would have happened after it, and lets you explore both lines on an interactive board.

## Running

```bash
npm install      # also copies the Stockfish WASM engine into public/engine
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
npm test         # unit + engine integration tests (Stockfish runs in Node)
```

The engine is the Stockfish 19 **lite, single-threaded** WASM build from the `stockfish` npm package. It needs no
special CORS headers, so the build can be served from any static host.

## Features

**Game**: play White, Black or a random side against 12 strength levels (≈600 to full strength), untimed or with a
time control. All chess rules come from chess.js: castling, en passant, promotion, check, mate, stalemate, threefold
repetition, the fifty-move rule and insufficient material. The board highlights the last move and legal destinations.
Pieces can be dragged or clicked. You can flip the board, resign, offer a draw, rematch or copy the PGN. The game in
progress is saved locally and survives a page reload.

**Real-time tutor**: for every one of your moves the tutor compares your move, the engine's best move, and the
evaluations before your move, after your move and after the best move. It then classifies the move as *Book, Forced,
Best, Excellent, Good, Inaccuracy, Mistake, Blunder* or *Missed opportunity*. Good moves get a small indicator.
Significant mistakes open a panel with two sides: *Your move* (the evaluation change, why it's bad, and the line
if you continue) and *Best move* (why it's better, and the best continuation). The panel also gives a chess
principle to remember. The user's clock pauses while the panel is open.

**Explanations** come from the actual position and engine line, never from canned text. Examples:
"This puts your bishop on a6 where it is undefended: Black can take it with bxa6, and you lose your bishop."
"This allows a forced checkmate in 1: 1. Rd7 Re1#. Your king is trapped on the back rank by its own pawns."
"Nc7+ forks Black's king and Black's rook on a8 with the knight; after 1. Nc7+ Kd7 2. Nxa8 … you win a rook."
Reasons are ranked as the spec requires: mate threats, forced tactics, material, exchanges, king safety, tactical
opportunities, positional issues, minor inaccuracies.

**Variation board**: "Show variation" replays either line on the main board. You can step through it with the
arrow keys or buttons and see the evaluation after every move. You can also play your own moves, which creates a
branch. Arrows mark the best move, your move, the next move and an optional engine suggestion. Squares for threats,
hanging pieces and important targets are highlighted. The game stays untouched unless you choose *Continue the game
from this position*.

**Missed opportunity detection** covers missed mates, won material, forks, pins, skewers, discovered attacks,
promotions and forced defences.

**Blunder check** has four modes: Off, Warning only, Ask before blunder, and Full tutor. *Ask* shows "Are you
sure?" before a move that looks like a major blunder, without revealing the best move. *Full tutor* also adds a
hint.

**Learning mode**: after a mistake the game pauses and you are asked to find a better move. Each attempt gets one
of four verdicts: *Correct*, *Better but not best*, *Still inaccurate* or *Major mistake*. The answer appears when
you ask for it or after a set number of attempts. You then choose which move to continue with.

**Post-game report**: result, accuracy, counts per classification, missed opportunities, largest evaluation swing,
an evaluation graph, performance by phase (opening, middlegame, endgame), and material / tactical / strategic
mistake counts. It also lists the critical moments in order, with filters for *all*, *blunders only* and *missed
opportunities*. Each critical move opens in the variation board. A "Lessons from this game" section sums up the
game.

**History and adaptive coaching**: finished (and abandoned) games are stored in `localStorage` and can be replayed
and reviewed. The Coach tab collects recurring patterns across your recent games: hanging pieces, opponent
tactics, missed tactics, mating patterns, king safety, opening development, endgame technique, and time
management. It shows trends and concrete recommendations (e.g. "Your last 5 games contained 7 missed forks…"),
and turns your own mistakes into training exercises.

## Architecture

```
src/
  core/                 pure TypeScript, no React (unit-tested)
    engine/uci.ts         UCI "info"/"bestmove" parsing, White-perspective scores
    engine/UciEngine.ts   serialised search queue over a transport (Web Worker or Node child process);
                          channels supersede outdated searches; results carry their FEN
    engine/AnalysisService.ts  two engines (analysis + opponent), FEN cache, in-flight de-duplication,
                          strength ladder for the AI
    evaluation.ts         win% model, verdicts, accuracy
    board.ts              geometry, attacks, static exchange evaluation, hanging pieces, pawn structure
    motifs.ts             fork / pin / skewer / discovered attack / removal of defender / back-rank mate …
    lines.ts              plays engine lines to measure material swings, mates, promotions
    classify.ts           move classification layer (configurable thresholds)
    explain.ts            prioritised human-readable explanations + principles + tags
    tutor.ts              builds the per-move MoveAnalysis record
    training.ts           judging learning-mode / exercise attempts
    variation.ts          variation model (branching lines, cursor), independent of the game
    report.ts             post-game report
    stats.ts              adaptive coaching profile and exercises
    history.ts            localStorage persistence
    openings.ts           opening names / book moves
  game/GameController.ts  authoritative game state (FEN), clocks, AI loop, tutor alerts, blunder check,
                          learning mode; immutable snapshots for React
  ui/                     React components (board with SVG arrows, eval bar, tutor panel, variation panel,
                          report, history, coach, settings)
```

Each user move stores this record:
`{ moveNumber, fenBefore, playedMove, fenAfter, evaluationBefore, evaluationAfter, bestMove, bestEvaluation,
evaluationLoss, classification, principalVariation, explanation, … }`. See `MoveAnalysis` in `src/core/types.ts`.

### Classification

The base signal is the loss in **expected score** (win%, the logistic model Lichess uses), not raw centipawns.
The same 150 cp therefore matters a lot at 0.00 and hardly at all at +15. The result is then adjusted:

- **Equivalent moves**: a MultiPV alternative within `equivalentCp` of the best move counts as best or
  excellent. In the spec's example (Nf3 +0.6, d4 +0.5, c4 +0.5), d4 is not an inaccuracy.
- **Mates**: missing a short forced mate is a miss. Allowing a mate is a blunder. Picking a slower mate is fine.
- **Decided positions**: tiny differences in completely won or lost positions are not flagged.
- **Result changes**: a move that turns a win into a draw or loss is escalated.
- **Material**: if the refutation loses material, the move is at least a mistake.
- **Hard-to-find best moves** (sacrifices) get some leniency. **Forced** moves and **only moves** are recognised.
- **Missed opportunity**: the best line wins something concrete (mate, material, promotion) and the played move only
  failed to punish, without self-destructing.

All thresholds live in `DEFAULT_THRESHOLDS` in `src/core/classify.ts`. They can be overridden per analysis through
`MoveContext.thresholds`.

### Responsiveness and race safety

Engine work runs in Web Workers. The opponent has its own worker, so the AI never waits on tutor analysis. Every async result is
checked against a generation token and the exact position before it is applied. Stale results are discarded.
Variation analysis runs on cancellable channels. Evaluations are cached by position, and your position is analysed
while you think, so feedback usually appears instantly.

## License note

Stockfish and stockfish.js are GPLv3. The engine files are copied from the `stockfish` npm package at install time.
