import { useEffect, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import type { GameRecord, MoveAnalysis, Score, Side } from '../core/types';
import { buildReport } from '../core/report';
import { formatScore, winChanceWhite } from '../core/evaluation';
import { Board } from './Board';
import { EvalBar } from './EvalBar';
import { ClassBadge, CLASS_SYMBOL, TutorPanel } from './TutorPanel';
import { MoveList } from './MoveList';
import { VariationPanel } from './VariationPanel';
import { variationFromAnalysis, type Variation } from '../core/variation';
import { useVariationView } from './useVariationView';

type Filter = 'critical' | 'blunders' | 'missed' | 'all';

interface Ply {
  san: string;
  from: string;
  to: string;
  fenAfter: string;
}

function replay(game: GameRecord): Ply[] {
  const c = new Chess(game.startFen);
  const out: Ply[] = [];
  for (const san of game.moves) {
    try {
      const m = c.move(san);
      out.push({ san: m.san, from: m.from, to: m.to, fenAfter: c.fen() });
    } catch {
      break;
    }
  }
  return out;
}

function EvalGraph({ track, analyses, onSelect, selected }: { track: (Score | null)[]; analyses: MoveAnalysis[]; onSelect: (ply: number) => void; selected: number | null }) {
  const W = 600;
  const H = 120;
  const n = Math.max(track.length, 1);
  const pts = track.map((s, i) => [((i + 0.5) / n) * W, s ? H - (winChanceWhite(s) / 100) * H : H / 2] as const);
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = pts.length ? `M0,${H} ${pts.map((p) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')} L${W},${H} Z` : '';
  const critical = analyses.filter((a) => ['inaccuracy', 'mistake', 'blunder', 'miss'].includes(a.classification));
  return (
    <svg className="eval-graph" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Evaluation over the game (White advantage up)">
      <rect x="0" y="0" width={W} height={H} className="eg-bg" />
      <path d={area} className="eg-area" />
      <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="eg-mid" />
      <path d={path} className="eg-line" fill="none" />
      {critical.map((a) => {
        const p = pts[a.ply];
        if (!p) return null;
        return <circle key={a.ply} cx={p[0]} cy={p[1]} r={a.ply === selected ? 6 : 4} className={`eg-dot cls-fill-${a.classification}`} onClick={() => onSelect(a.ply)} />;
      })}
      {Array.from({ length: n }, (_, i) => (
        <rect key={i} x={(i / n) * W} y={0} width={W / n} height={H} fill="transparent" onClick={() => onSelect(i)} />
      ))}
      {selected !== null && pts[selected] && <line x1={pts[selected][0]} x2={pts[selected][0]} y1={0} y2={H} className="eg-cursor" />}
    </svg>
  );
}

export function ReportView({ game, onBack }: { game: GameRecord; onBack?: () => void }) {
  const report = useMemo(() => buildReport(game), [game]);
  const plies = useMemo(() => replay(game), [game]);
  const analyses = useMemo(() => {
    const m: Record<number, MoveAnalysis> = {};
    game.analyses.forEach((a) => (m[a.ply] = a));
    return m;
  }, [game]);
  const [ply, setPly] = useState<number | null>(report.critical[0]?.ply ?? null);
  const [filter, setFilter] = useState<Filter>('critical');
  const [variation, setVariation] = useState<Variation | null>(null);
  const [flipped, setFlipped] = useState(false);
  const vv = useVariationView(variation, setVariation);
  const orientation: Side = flipped ? (game.playerSide === 'w' ? 'b' : 'w') : game.playerSide;

  useEffect(() => {
    setVariation(null);
  }, [game.id]);

  useEffect(() => {
    if (variation) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setPly((p) => (p === null ? plies.length - 1 : Math.max(-1, p - 1)));
      else if (e.key === 'ArrowRight') setPly((p) => (p === null ? 0 : Math.min(plies.length - 1, p + 1)));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [variation, plies.length]);

  const list = report.critical.filter((a) =>
    filter === 'blunders' ? a.classification === 'blunder' : filter === 'missed' ? a.missedOpportunity || a.classification === 'miss' : true,
  );
  const allUser = game.analyses;
  const shownList = filter === 'all' ? allUser : list;

  const cur = ply !== null && ply >= 0 ? plies[ply] : null;
  const a = ply !== null ? analyses[ply] ?? null : null;
  let fen = cur ? cur.fenAfter : game.startFen;
  let lastMove = cur ? { from: cur.from, to: cur.to } : null;
  let score: Score | null = ply !== null && ply >= 0 ? game.evalTrack[ply] ?? null : null;
  let arrows = a && a.bestUci && a.bestUci !== a.playedUci ? [{ from: a.bestUci.slice(0, 2), to: a.bestUci.slice(2, 4), kind: 'best' as const }] : [];
  let interactive: Side | null = null;
  let legal = (_: string) => [] as { to: string }[];
  let onMove = (_f: string, _t: string, _p?: string) => {};
  if (variation && vv.fen) {
    fen = vv.fen;
    lastMove = vv.lastMove;
    score = vv.score;
    arrows = vv.arrows as typeof arrows;
    interactive = vv.turn;
    legal = vv.legalMoves;
    onMove = vv.onMove;
  }

  const acc = Math.round(report.accuracy);
  const resultText =
    game.result === '*'
      ? 'Unfinished'
      : game.result === '1/2-1/2'
        ? 'Draw'
        : (game.result === '1-0') === (game.playerSide === 'w')
          ? 'You won'
          : 'You lost';

  return (
    <div className="report">
      <div className="report-head">
        <div>
          <div className="eyebrow">Post-game analysis</div>
          <h2>
            {resultText} · {game.result} <span className="muted small">{game.termination}</span>
          </h2>
          <div className="muted">
            {new Date(game.startedAt).toLocaleString()} · You played {game.playerSide === 'w' ? 'White' : 'Black'} · Opponent level {game.aiLevel}
            {report.opening ? ` · ${report.opening}` : ''}
            {game.branched ? ' · continued from a variation' : ''}
          </div>
        </div>
        {onBack && (
          <button className="btn ghost" onClick={onBack}>
            ← Back
          </button>
        )}
      </div>

      <div className="stat-grid">
        <div className="stat big">
          <div className="stat-value">{acc}%</div>
          <div className="stat-label">Accuracy</div>
        </div>
        {(['best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'] as const).map((c) => (
          <div className="stat" key={c}>
            <div className={`stat-value cls-text-${c}`}>{report.counts[c] + (c === 'best' ? report.counts.forced : c === 'good' ? report.counts.book : 0)}</div>
            <div className="stat-label">{c === 'best' ? 'Best' : c[0].toUpperCase() + c.slice(1) + 's'}</div>
          </div>
        ))}
        <div className="stat">
          <div className="stat-value cls-text-miss">{report.missedOpportunities}</div>
          <div className="stat-label">Missed opportunities</div>
        </div>
      </div>

      <EvalGraph track={game.evalTrack} analyses={game.analyses} onSelect={(p) => { setVariation(null); setPly(p); }} selected={ply} />

      <div className="report-body">
        <div className="report-board">
          <div className="board-row">
            <EvalBar score={score} orientation={orientation} perspective={game.playerSide} />
            <Board fen={fen} orientation={orientation} interactiveColor={interactive} legalMoves={legal} onMove={onMove} lastMove={lastMove} arrows={arrows} marks={variation && variation.cursor === 0 && a ? a.explanation.marks : []} className={variation ? 'variation-mode' : ''} />
          </div>
          <div className="controls-row">
            <button className="btn" onClick={() => { setVariation(null); setPly(-1); }} aria-label="Start">⏮</button>
            <button className="btn" onClick={() => { setVariation(null); setPly((p) => Math.max(-1, (p ?? 0) - 1)); }} aria-label="Previous">◀</button>
            <button className="btn" onClick={() => { setVariation(null); setPly((p) => Math.min(plies.length - 1, (p ?? -1) + 1)); }} aria-label="Next">▶</button>
            <button className="btn" onClick={() => { setVariation(null); setPly(plies.length - 1); }} aria-label="End">⏭</button>
            <button className="btn" onClick={() => setFlipped((f) => !f)}>Flip</button>
            <span className="muted small">Score: {formatScore(score)}</span>
          </div>
          <MoveList
            sans={plies.map((p) => p.san)}
            analyses={analyses}
            selectedPly={ply}
            onSelect={(p) => {
              setVariation(null);
              setPly(p ?? plies.length - 1);
            }}
          />
        </div>

        <div className="report-side">
          {variation ? (
            <VariationPanel
              variation={variation}
              onChange={setVariation}
              onClose={() => setVariation(null)}
              perspective={game.playerSide}
              evals={vv.evals}
              showEngineArrow={vv.engineArrow}
              onToggleEngineArrow={vv.toggleEngineArrow}
            />
          ) : a ? (
            <TutorPanel analysis={a} pending={false} tutorEnabled isAlert={false} onShowVariation={(an, start) => setVariation(variationFromAnalysis(an, start))} />
          ) : (
            <div className="tutor-card quiet">
              <div className="tutor-status">Select one of your moves to see the tutor's comments.</div>
            </div>
          )}

          <div className="card">
            <div className="block-title">Lessons from this game</div>
            <ul className="why">
              {report.lessons.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </div>

          <div className="card">
            <div className="block-title">Critical moments</div>
            <div className="tabs">
              {(
                [
                  ['critical', `All critical (${report.critical.length})`],
                  ['blunders', `Blunders (${report.counts.blunder})`],
                  ['missed', `Missed (${report.missedOpportunities})`],
                  ['all', 'Every move'],
                ] as [Filter, string][]
              ).map(([f, label]) => (
                <button key={f} className={`tab ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="critical-list">
              {shownList.length === 0 && <div className="muted pad">Nothing here — well played!</div>}
              {shownList.map((m) => (
                <div key={m.ply} className={`critical ${ply === m.ply ? 'current' : ''}`} onClick={() => { setVariation(null); setPly(m.ply); }}>
                  <div className="critical-top">
                    <span className="critical-move">
                      Move {m.moveNumber}
                      {m.side === 'w' ? '.' : '…'} {m.playedMove}
                      {CLASS_SYMBOL[m.classification]}
                    </span>
                    <ClassBadge c={m.classification} small />
                  </div>
                  <div className="muted small">
                    Evaluation: {formatScore(m.evaluationBefore)} → {formatScore(m.evaluationAfter)} · best was {m.bestMove}
                  </div>
                  <div className="small">{m.explanation.headline}</div>
                  {['inaccuracy', 'mistake', 'blunder', 'miss'].includes(m.classification) && (
                    <button
                      className="btn small"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPly(m.ply);
                        setVariation(variationFromAnalysis(m, 'best'));
                      }}
                    >
                      Open variation
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="block-title">Performance by phase</div>
            <table className="phase-table">
              <thead>
                <tr>
                  <th>Phase</th>
                  <th>Moves</th>
                  <th>Accuracy</th>
                  <th>?! / ? / ??</th>
                  <th>Verdict</th>
                </tr>
              </thead>
              <tbody>
                {report.phases.map((p) => (
                  <tr key={p.phase}>
                    <td>{p.phase[0].toUpperCase() + p.phase.slice(1)}</td>
                    <td>{p.moves}</td>
                    <td>{p.accuracy === null ? '—' : `${Math.round(p.accuracy)}%`}</td>
                    <td>
                      {p.inaccuracies} / {p.mistakes} / {p.blunders}
                    </td>
                    <td>{p.verdict}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mistake-kinds">
              <span>Material mistakes: <strong>{report.materialMistakes}</strong></span>
              <span>Tactical mistakes: <strong>{report.tacticalMistakes}</strong></span>
              <span>Strategic mistakes: <strong>{report.strategicMistakes}</strong></span>
            </div>
            {report.largestSwing && (
              <div className="small">
                Largest evaluation swing: move {report.largestSwing.moveNumber}
                {report.largestSwing.side === 'w' ? '.' : '…'} {report.largestSwing.playedMove} ({formatScore(report.largestSwing.evaluationBefore)} →{' '}
                {formatScore(report.largestSwing.evaluationAfter)})
              </div>
            )}
            {game.trainingMistakes && game.trainingMistakes.length > 0 && (
              <div className="small muted">{game.trainingMistakes.length} mistake(s) were corrected in learning mode.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
