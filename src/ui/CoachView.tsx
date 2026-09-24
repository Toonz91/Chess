import { useCallback, useMemo, useState } from 'react';
import { Chess, type Square } from 'chess.js';
import type { GameRecord, Side } from '../core/types';
import { buildCoachingProfile, type Exercise } from '../core/stats';
import { judgeAttempt, VERDICT_LABEL, type AttemptResult } from '../core/training';
import { Board } from './Board';
import { ClassBadge } from './TutorPanel';
import { useServices } from './services';

function ExerciseTrainer({ exercises, depth, onExit }: { exercises: Exercise[]; depth: number; onExit: () => void }) {
  const { service } = useServices();
  const [idx, setIdx] = useState(0);
  const [attempts, setAttempts] = useState<AttemptResult[]>([]);
  const [checking, setChecking] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState({ solved: 0, total: 0 });
  const ex = exercises[idx];
  const side: Side = ex ? (ex.fen.split(' ')[1] as Side) : 'w';
  const solved = attempts.some((a) => a.verdict === 'correct');
  const done = solved || revealed;

  const legal = useCallback(
    (sq: string) => {
      if (!ex || done || checking) return [];
      return new Chess(ex.fen).moves({ square: sq as Square, verbose: true }).map((m) => ({ to: m.to, promotion: m.promotion, captured: m.captured }));
    },
    [ex, done, checking],
  );

  if (!ex) {
    return (
      <div className="card">
        <div>No exercises available for this theme yet.</div>
        <button className="btn" onClick={onExit}>
          Back
        </button>
      </div>
    );
  }

  const onMove = async (from: string, to: string, promotion?: string) => {
    const c = new Chess(ex.fen);
    let uci: string;
    try {
      const m = c.move({ from, to, promotion: promotion ?? 'q' });
      uci = m.from + m.to + (m.promotion ?? '');
    } catch {
      return;
    }
    setChecking(true);
    const res = await judgeAttempt(service, ex.fen, uci, { depth, solutionUci: ex.solutionUci });
    setChecking(false);
    if (!res) return;
    setAttempts((a) => [...a, res]);
    if (res.verdict === 'correct' && attempts.length === 0) setScore((s) => ({ ...s, solved: s.solved + 1 }));
  };

  const next = () => {
    setScore((s) => ({ ...s, total: s.total + 1 }));
    setAttempts([]);
    setRevealed(false);
    setIdx((i) => (i + 1) % exercises.length);
  };

  const last = attempts[attempts.length - 1];
  const arrows = [
    ...(last ? [{ from: last.uci.slice(0, 2), to: last.uci.slice(2, 4), kind: last.verdict === 'correct' ? ('best' as const) : ('played' as const) }] : []),
    ...(revealed && !solved ? [{ from: ex.solutionUci.slice(0, 2), to: ex.solutionUci.slice(2, 4), kind: 'best' as const }] : []),
  ];

  return (
    <div className="trainer">
      <div className="trainer-board">
        <Board fen={ex.fen} orientation={side} interactiveColor={done || checking ? null : side} legalMoves={legal} onMove={onMove} arrows={arrows} />
      </div>
      <div className="trainer-side">
        <div className="eyebrow">
          Exercise {idx + 1} of {exercises.length} · first-try score {score.solved}/{score.total}
        </div>
        <h3>{ex.prompt}</h3>
        <div className="muted">
          {side === 'w' ? 'White' : 'Black'} to move · from one of your games <ClassBadge c={ex.classification} small />
        </div>
        {checking && (
          <div className="tutor-status">
            <span className="spinner" /> Checking…
          </div>
        )}
        <ul className="attempts">
          {attempts.map((a, i) => (
            <li key={i} className={`attempt v-${a.verdict}`}>
              <strong>{VERDICT_LABEL[a.verdict]}</strong> — {a.text}
            </li>
          ))}
        </ul>
        {done && (
          <div className="learning-answer">
            <div className="compare-move">Solution: {ex.solutionSan}</div>
            <div className="small">{ex.headline}</div>
          </div>
        )}
        <div className="button-row">
          {!done && (
            <button className="btn" onClick={() => setRevealed(true)}>
              Show solution
            </button>
          )}
          <button className="btn primary" onClick={next}>
            Next exercise
          </button>
          <button className="btn ghost" onClick={onExit}>
            Back to coach
          </button>
        </div>
      </div>
    </div>
  );
}

export function CoachView({ games, depth }: { games: GameRecord[]; depth: number }) {
  // Mistakes corrected in learning mode still reveal patterns — include them.
  const withTraining = useMemo(
    () => games.map((g) => ({ ...g, analyses: [...g.analyses, ...(g.trainingMistakes ?? []).map((m) => ({ ...m, ply: m.ply + 10000 }))] })),
    [games],
  );
  const profile = useMemo(() => buildCoachingProfile(withTraining), [withTraining]);
  const [training, setTraining] = useState<string | null>(null);

  if (training) {
    const list = training === 'all' ? profile.exercises : profile.exercises.filter((e) => e.themeId === training);
    return <ExerciseTrainer exercises={list} depth={Math.min(depth, 14)} onExit={() => setTraining(null)} />;
  }

  return (
    <div className="coach">
      <div className="report-head">
        <div>
          <div className="eyebrow">Adaptive coaching</div>
          <h2>Your training plan</h2>
          <div className="muted">Built from the mistakes in your last {profile.gamesAnalysed || 0} analysed games.</div>
        </div>
      </div>
      {profile.gamesAnalysed === 0 ? (
        <div className="card muted">Finish a game to start building your personal coaching profile.</div>
      ) : (
        <>
          <div className="stat-grid">
            <div className="stat big">
              <div className="stat-value">{profile.averageAccuracy !== null ? Math.round(profile.averageAccuracy) + '%' : '—'}</div>
              <div className="stat-label">Average accuracy</div>
            </div>
            <div className="stat">
              <div className="stat-value">{profile.recentAccuracy !== null ? Math.round(profile.recentAccuracy) + '%' : '—'}</div>
              <div className="stat-label">Last game</div>
            </div>
            <div className="stat">
              <div className="stat-value">{profile.gamesAnalysed}</div>
              <div className="stat-label">Games analysed</div>
            </div>
            <div className="stat">
              <div className="stat-value">{profile.exercises.length}</div>
              <div className="stat-label">Exercises from your games</div>
            </div>
          </div>

          <div className="card">
            <div className="block-title">Recommendations</div>
            <ul className="why">
              {profile.recommendations.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
            {profile.exercises.length > 0 && (
              <button className="btn primary" onClick={() => setTraining('all')}>
                Train on all my mistakes ({profile.exercises.length})
              </button>
            )}
          </div>

          <div className="card">
            <div className="block-title">Recurring patterns</div>
            {profile.themes.length === 0 && <div className="muted">No recurring problems detected.</div>}
            {profile.themes.map((t) => {
              const n = profile.exercises.filter((e) => e.themeId === t.theme.id).length;
              const max = profile.themes[0].count;
              return (
                <div className="theme-row" key={t.theme.id}>
                  <div className="theme-top">
                    <strong>{t.theme.name}</strong>
                    <span className="muted small">
                      {t.count} time{t.count > 1 ? 's' : ''} in {t.gamesAffected} game{t.gamesAffected > 1 ? 's' : ''} ·{' '}
                      <span className={`trend ${t.trend}`}>{t.trend}</span>
                    </span>
                  </div>
                  <div className="theme-bar">
                    <div style={{ width: `${(t.count / max) * 100}%` }} />
                  </div>
                  <div className="small">{t.theme.advice}</div>
                  {n > 0 && (
                    <button className="btn small" onClick={() => setTraining(t.theme.id)}>
                      Practise ({n} position{n > 1 ? 's' : ''})
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
