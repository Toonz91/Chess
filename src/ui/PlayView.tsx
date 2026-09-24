import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import type { GameController } from '../game/GameController';
import type { MoveAnalysis, Side } from '../core/types';
import { Board } from './Board';
import { EvalBar, EvalSummary } from './EvalBar';
import { BlunderPromptCard, LearningPanel, TutorPanel } from './TutorPanel';
import { MoveList, formatClock, useNow } from './MoveList';
import { VariationPanel } from './VariationPanel';
import { variationFromAnalysis, variationFromPosition, type Variation } from '../core/variation';
import { useVariationView } from './useVariationView';
import { formatLine, uciLineToSan } from '../core/board';
import { opponentLevel } from '../core/engine/AnalysisService';
import { timeControl } from '../core/settings';

export interface PlayViewProps {
  controller: GameController;
  onOpenReport: () => void;
  onNewGame: () => void;
  onOpenSettings: () => void;
  engineReady: boolean;
}

export function PlayView({ controller, onOpenReport, onNewGame, onOpenSettings, engineReady }: PlayViewProps) {
  const s = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [viewPly, setViewPly] = useState<number | null>(null);
  const [focusPly, setFocusPly] = useState<number | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [variation, setVariation] = useState<Variation | null>(null);
  const vv = useVariationView(variation, setVariation);
  const now = useNow(s.status === 'playing' && s.timed);

  const orientation: Side = flipped ? (s.playerSide === 'w' ? 'b' : 'w') : s.playerSide;
  const moveCount = s.moves.length;
  if (viewPly !== null && viewPly >= moveCount) setViewPly(null);

  // Which analysis does the tutor panel show?
  const userPlies = useMemo(() => s.moves.map((m, i) => (m.color === s.playerSide ? i : -1)).filter((i) => i >= 0), [s.moves, s.playerSide]);
  const lastUserPly = userPlies[userPlies.length - 1] ?? null;
  const shownPly = focusPly ?? s.alertPly ?? lastUserPly;
  const shownAnalysis: MoveAnalysis | null = shownPly !== null ? s.analyses[shownPly] ?? null : null;
  const latestPending = lastUserPly !== null && s.pending.includes(lastUserPly);
  // During the game, tutor feedback is only visible if the tutor is on (or the game is over).
  const tutorVisible = s.settings.tutorEnabled || s.status === 'over';

  const legalMoves = useCallback((sq: string) => controller.legalMoves(sq), [controller, s.fen, s.learning]); // eslint-disable-line react-hooks/exhaustive-deps

  const openVariation = (a: MoveAnalysis, start: 'best' | 'played') => {
    setViewPly(null);
    setVariation(variationFromAnalysis(a, start));
  };

  const exploreHere = () => {
    const ply = viewPly;
    const fen = ply === null ? (s.learning ? s.learning.fen : s.fen) : s.moves[ply].fenAfter;
    setVariation(variationFromPosition(fen, (ply ?? moveCount - 1) + 1, 'Free analysis from the current position'));
  };

  // Board contents depend on mode: variation > history view > live game.
  let boardFen = s.learning ? s.learning.fen : s.fen;
  let interactive: Side | null = controller.canUserMove() ? s.playerSide : null;
  let lastMove = s.moves.length ? { from: s.moves[moveCount - 1].from, to: s.moves[moveCount - 1].to } : null;
  let boardLegal = legalMoves;
  let onBoardMove = (from: string, to: string, promo?: string) => {
    setFocusPly(null);
    setViewPly(null);
    controller.userMove(from, to, promo);
  };
  let arrows = [] as MoveAnalysis['explanation']['arrows'];
  let marks = [] as MoveAnalysis['explanation']['marks'];
  let barScore = s.liveEval && s.liveEval.fen === s.fen ? s.liveEval.score : s.liveEval?.score ?? null;
  const barAnalysing = !s.liveEval || s.liveEval.fen !== s.fen;

  if (s.learning) {
    lastMove = null;
    const last = s.learning.attempts[s.learning.attempts.length - 1];
    if (last) arrows = [{ from: last.uci.slice(0, 2), to: last.uci.slice(2, 4), kind: last.verdict === 'correct' ? 'best' : 'played' }];
    if (s.learning.status === 'revealed' || s.learning.status === 'solved') {
      const b = s.learning.original.bestUci;
      if (b) arrows = [...arrows, { from: b.slice(0, 2), to: b.slice(2, 4), kind: 'best' }];
    }
  }

  if (variation && vv.fen) {
    boardFen = vv.fen;
    interactive = vv.turn;
    lastMove = vv.lastMove;
    boardLegal = vv.legalMoves;
    onBoardMove = vv.onMove;
    arrows = vv.arrows;
    marks = variation.cursor === 0 && shownAnalysis && shownAnalysis.fenBefore === variation.baseFen ? shownAnalysis.explanation.marks : [];
    barScore = vv.score;
  } else if (viewPly !== null) {
    const m = s.moves[viewPly];
    boardFen = m.fenAfter;
    interactive = null;
    lastMove = { from: m.from, to: m.to };
    const a = s.analyses[viewPly];
    barScore = a ? a.evaluationAfter : s.analyses[viewPly + 1]?.evaluationBefore ?? null;
    if (a && tutorVisible && s.settings.showBestMoveArrow) arrows = a.bestUci && a.bestUci !== a.playedUci ? [{ from: a.bestUci.slice(0, 2), to: a.bestUci.slice(2, 4), kind: 'best' }] : [];
  }

  const hideEval = s.status === 'playing' && !variation && (!s.settings.showLiveEval || !!s.learning);
  const lastUserAnalysis = lastUserPly !== null ? s.analyses[lastUserPly] : null;
  const delta = !variation && viewPly === null && lastUserAnalysis ? { before: lastUserAnalysis.evaluationBefore, after: lastUserAnalysis.evaluationAfter } : null;

  const clockFor = (side: Side) => {
    let ms = s.clocks[side];
    if (s.clockSide === side && s.clockStartedAt !== null) ms -= now - s.clockStartedAt;
    return ms;
  };

  const pvText = useMemo(() => {
    if (!s.liveEval || !s.liveEval.pv.length) return null;
    return formatLine(s.liveEval.fen, uciLineToSan(s.liveEval.fen, s.liveEval.pv, 10));
  }, [s.liveEval]);

  const level = opponentLevel(s.settings.aiLevel);
  const PlayerBar = ({ side, label }: { side: Side; label: string }) => (
    <div className={`player-bar ${s.turn === side && s.status === 'playing' ? 'to-move' : ''}`}>
      <span className={`side-dot ${side === 'w' ? 'white' : 'black'}`} />
      <span className="player-name">{label}</span>
      {side !== s.playerSide && s.aiThinking && (
        <span className="muted small">
          <span className="spinner" /> thinking…
        </span>
      )}
      {s.timed && <span className={`clock ${s.clockSide === side ? 'running' : ''} ${clockFor(side) < 20000 ? 'low' : ''}`}>{formatClock(clockFor(side))}</span>}
    </div>
  );

  const turnText =
    s.status === 'over'
      ? s.termination
      : s.learning
        ? 'Learning mode — find a better move'
        : s.blunderPrompt
          ? 'Confirm your move'
          : s.checkingMove
            ? 'Checking your move…'
            : s.awaitingTutor
              ? 'Tutor is checking your move…'
              : s.turn === s.playerSide
                ? `Your move (${s.playerSide === 'w' ? 'White' : 'Black'})${s.inCheck ? ' — you are in check!' : ''}`
                : `${s.turn === 'w' ? 'White' : 'Black'} (engine) to move`;

  return (
    <div className="play-layout">
      <div className="board-area">
        <PlayerBar side={orientation === 'w' ? 'b' : 'w'} label={(orientation === 'w' ? 'b' : 'w') === s.playerSide ? 'You' : `Stockfish · ${level.label} (~${level.approxElo})`} />
        <div className="board-row">
          <EvalBar score={barScore} orientation={orientation} perspective={s.playerSide} delta={delta} analysing={!variation && viewPly === null && barAnalysing} hidden={hideEval} />
          <div className="board-stack">
            <Board fen={boardFen} orientation={orientation} interactiveColor={interactive} legalMoves={boardLegal} onMove={onBoardMove} lastMove={lastMove} arrows={arrows} marks={marks} className={variation ? 'variation-mode' : viewPly !== null ? 'history-mode' : ''} />
            {s.blunderPrompt && <BlunderPromptCard prompt={s.blunderPrompt} onAnswer={(p) => controller.confirmBlunderPrompt(p)} />}
          </div>
        </div>
        <PlayerBar side={orientation} label={orientation === s.playerSide ? 'You' : `Stockfish · ${level.label} (~${level.approxElo})`} />
        {variation && <div className="mode-banner variation">Variation mode — the game is unchanged</div>}
        {!variation && viewPly !== null && (
          <div className="mode-banner history">
            Viewing move {Math.floor(viewPly / 2) + 1}
            {viewPly % 2 === 0 ? '.' : '…'} {s.moves[viewPly].san}
            <button className="btn small" onClick={() => setViewPly(null)}>
              Back to live position
            </button>
          </div>
        )}
      </div>

      <aside className="side-panel">
        <div className={`turn-indicator ${s.status === 'over' ? 'over' : s.turn === s.playerSide ? 'you' : 'them'}`}>{turnText}</div>
        {!engineReady && (
          <div className="tutor-status">
            <span className="spinner" /> Loading Stockfish…
          </div>
        )}
        <EvalSummary score={barScore} perspective={s.playerSide} hidden={hideEval} />
        {s.warning && (
          <div className="warning" onClick={() => controller.dismissAlert()}>
            ⚠ {s.warning}
          </div>
        )}

        {s.status === 'over' && (
          <div className="gameover">
            <div className="gameover-result">{s.result === '1/2-1/2' ? '½–½' : s.result}</div>
            <div>{s.termination}</div>
            <div className="button-row">
              <button className="btn primary" onClick={onOpenReport} disabled={s.pending.length > 0}>
                {s.pending.length > 0 ? (
                  <>
                    <span className="spinner" /> Finishing analysis ({s.pending.length})
                  </>
                ) : (
                  'View analysis report'
                )}
              </button>
              <button className="btn" onClick={() => controller.rematch()}>
                Rematch (switch sides)
              </button>
            </div>
          </div>
        )}

        {variation ? (
          <VariationPanel
            variation={variation}
            onChange={setVariation}
            onClose={() => setVariation(null)}
            onContinue={
              s.status === 'playing' && variation.basePly <= moveCount && !s.learning
                ? () => {
                    const moves = variation.lines.find((l) => l.id === variation.activeLine)?.moves.slice(0, variation.cursor) ?? [];
                    if (controller.continueFrom(variation.basePly, moves)) {
                      setVariation(null);
                      setFocusPly(null);
                    }
                  }
                : undefined
            }
            perspective={s.playerSide}
            evals={vv.evals}
            showEngineArrow={vv.engineArrow}
            onToggleEngineArrow={vv.toggleEngineArrow}
          />
        ) : s.learning ? (
          <LearningPanel learning={s.learning} maxAttempts={s.settings.learningAttempts} onReveal={() => controller.revealAnswer()} onResolve={(u) => controller.resolveLearning(u)} />
        ) : tutorVisible ? (
          <TutorPanel
            analysis={shownAnalysis}
            pending={latestPending}
            tutorEnabled={s.settings.tutorEnabled}
            isAlert={s.alertPly !== null && shownPly === s.alertPly}
            onShowVariation={openVariation}
            onDismiss={() => controller.dismissAlert()}
          />
        ) : (
          <div className="tutor-card quiet">
            <div className="tutor-status">Tutor is off — your moves are analysed silently for the post-game report.</div>
          </div>
        )}
        {focusPly !== null && !variation && (
          <button className="btn small ghost" onClick={() => setFocusPly(null)}>
            Show latest move
          </button>
        )}
      </aside>

      <section className="bottom-panel">
        <div className="bottom-block">
          <div className="block-title">Moves</div>
          <MoveList
            sans={s.moves.map((m) => m.san)}
            analyses={tutorVisible ? s.analyses : {}}
            pending={s.pending}
            selectedPly={viewPly}
            onSelect={(p) => {
              setVariation(null);
              setViewPly(p);
              const ply = p ?? moveCount - 1;
              const userPly = s.moves[ply]?.color === s.playerSide ? ply : ply - 1;
              setFocusPly(userPly >= 0 && s.analyses[userPly] ? userPly : null);
            }}
          />
        </div>
        <div className="bottom-block">
          <div className="block-title">Engine line</div>
          <div className="pv engine-pv">
            {hideEval || (!s.settings.tutorEnabled && s.status === 'playing') ? (
              <span className="muted">Hidden while playing (enable live evaluation in settings).</span>
            ) : pvText ? (
              <>
                <span className="muted">depth {s.liveEval?.depth}: </span>
                {pvText}
              </>
            ) : (
              <span className="muted">Waiting for analysis…</span>
            )}
          </div>
          <div className="block-title">Game</div>
          <div className="controls-row wrap">
            <button className="btn primary" onClick={onNewGame}>
              New game
            </button>
            {s.status === 'playing' ? (
              <>
                <button className="btn danger" onClick={() => confirm('Resign this game?') && controller.resign()} disabled={s.moves.length === 0}>
                  Resign
                </button>
                <button className="btn" onClick={() => controller.offerDrawAccepted()} disabled={s.moves.length < 10}>
                  Offer draw
                </button>
              </>
            ) : (
              <button className="btn" onClick={() => controller.rematch()}>
                Rematch
              </button>
            )}
            <button className="btn" onClick={() => setFlipped((f) => !f)}>
              Flip board
            </button>
            <button className="btn" onClick={exploreHere} disabled={!!variation}>
              Analyse position
            </button>
            <button className="btn" onClick={onOpenSettings}>
              Settings
            </button>
            <button
              className="btn"
              onClick={() => {
                navigator.clipboard?.writeText(controller.pgn()).catch(() => {});
              }}
              title="Copy PGN to clipboard"
            >
              Copy PGN
            </button>
          </div>
          <div className="muted small">
            {timeControl(s.settings.timeControlId).label} · Tutor {s.settings.tutorEnabled ? 'on' : 'off'} · Blunder check: {s.settings.blunderCheck} · Learning mode {s.settings.learningMode ? 'on' : 'off'} · Analysis depth {s.settings.analysisDepth}
          </div>
        </div>
      </section>
    </div>
  );
}
