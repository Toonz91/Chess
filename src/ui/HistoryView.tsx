import { useState } from 'react';
import type { GameRecord } from '../core/types';
import { buildReport } from '../core/report';
import { ReportView } from './ReportView';

export function HistoryView({ games, onDelete, onClear }: { games: GameRecord[]; onDelete: (id: string) => void; onClear: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const game = games.find((g) => g.id === open);
  if (game) return <ReportView game={game} onBack={() => setOpen(null)} />;
  return (
    <div className="history">
      <div className="report-head">
        <div>
          <div className="eyebrow">Game history</div>
          <h2>Your games</h2>
          <div className="muted">Stored locally in this browser. Open a game to replay it and review its mistakes.</div>
        </div>
        {games.length > 0 && (
          <button className="btn ghost" onClick={() => confirm('Delete all saved games?') && onClear()}>
            Clear history
          </button>
        )}
      </div>
      {games.length === 0 && <div className="card muted">No finished games yet. Play a game and it will appear here.</div>}
      <div className="history-list">
        {games.map((g) => {
          const r = buildReport(g);
          const won = g.result !== '*' && g.result !== '1/2-1/2' && (g.result === '1-0') === (g.playerSide === 'w');
          const outcome = g.result === '*' ? 'Unfinished' : g.result === '1/2-1/2' ? 'Draw' : won ? 'Win' : 'Loss';
          return (
            <div key={g.id} className="history-item card" onClick={() => setOpen(g.id)}>
              <div className={`outcome ${outcome.toLowerCase()}`}>{outcome}</div>
              <div className="history-main">
                <div>
                  <strong>{r.opening ?? 'Game'}</strong> · {g.moves.length} plies · {g.playerSide === 'w' ? 'White' : 'Black'} vs level {g.aiLevel}
                </div>
                <div className="muted small">
                  {new Date(g.startedAt).toLocaleString()} · {g.termination || g.result}
                </div>
              </div>
              <div className="history-stats">
                <span title="Accuracy">{Math.round(r.accuracy)}%</span>
                <span className="cls-text-inaccuracy" title="Inaccuracies">{r.counts.inaccuracy}?!</span>
                <span className="cls-text-mistake" title="Mistakes">{r.counts.mistake}?</span>
                <span className="cls-text-blunder" title="Blunders">{r.counts.blunder}??</span>
                <span className="cls-text-miss" title="Missed opportunities">{r.missedOpportunities}×</span>
              </div>
              <button
                className="btn small ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm('Delete this game?')) onDelete(g.id);
                }}
                aria-label="Delete game"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
