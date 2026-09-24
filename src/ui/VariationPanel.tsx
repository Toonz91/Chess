import { useEffect, useMemo, useState } from 'react';
import type { Score, Side } from '../core/types';
import { activeLine, steps, stepTo, switchLine, type Variation } from '../core/variation';
import { formatScore } from '../core/evaluation';
import { useServices } from './services';

/** Evaluate every position along a line (sequentially, cancellable, cached). */
export function useLineEvals(baseFen: string, moves: string[], depth = 12): (Score | null)[] {
  const { service } = useServices();
  const st = useMemo(() => steps(baseFen, moves), [baseFen, moves]);
  const key = baseFen + '|' + moves.join(',');
  const [evals, setEvals] = useState<{ key: string; list: (Score | null)[] }>({ key, list: [] });
  useEffect(() => {
    let alive = true;
    setEvals({ key, list: [] });
    if (!baseFen) return;
    (async () => {
      const fens = [baseFen, ...st.map((s) => s.fenAfter)];
      const list: (Score | null)[] = [];
      for (const f of fens) {
        const a = await service.analyze(f, { depth, maxTimeMs: 1200, channel: 'variation' });
        if (!alive) return;
        list.push(a?.lines[0]?.score ?? null);
        setEvals({ key, list: [...list] });
      }
    })();
    return () => {
      alive = false;
      service.cancel('variation');
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return evals.key === key ? evals.list : [];
}

export interface VariationPanelProps {
  variation: Variation;
  onChange: (v: Variation) => void;
  onClose: () => void;
  onContinue?: () => void;
  perspective: Side;
  evals: (Score | null)[];
  showEngineArrow: boolean;
  onToggleEngineArrow: () => void;
}

export function VariationPanel({ variation: v, onChange, onClose, onContinue, evals, showEngineArrow, onToggleEngineArrow }: VariationPanelProps) {
  const line = activeLine(v);
  const st = useMemo(() => steps(v.baseFen, line.moves), [v.baseFen, line.moves]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
      if (e.key === 'ArrowLeft') onChange(stepTo(v, v.cursor - 1));
      else if (e.key === 'ArrowRight') onChange(stepTo(v, v.cursor + 1));
      else if (e.key === 'Home') onChange(stepTo(v, 0));
      else if (e.key === 'End') onChange(stepTo(v, st.length));
      else if (e.key === 'Escape') onClose();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [v, st.length, onChange, onClose]);

  return (
    <div className="variation-panel">
      <div className="variation-head">
        <div>
          <div className="eyebrow">Variation board</div>
          <div className="variation-title">{v.title}</div>
        </div>
        <button className="btn ghost" onClick={onClose}>
          ← Return to game
        </button>
      </div>
      <div className="variation-note">Exploring does not change your game. Play moves on the board to try your own ideas.</div>
      <div className="tabs">
        {v.lines.map((l) => (
          <button key={l.id} className={`tab ${l.id === v.activeLine ? 'active' : ''} tab-${l.id}`} onClick={() => onChange(switchLine(v, l.id))}>
            {l.label}
          </button>
        ))}
      </div>
      <div className="variation-moves">
        <button className={`vmove start ${v.cursor === 0 ? 'current' : ''}`} onClick={() => onChange(stepTo(v, 0))}>
          Start <span className="veval">{formatScore(evals[0])}</span>
        </button>
        {st.map((s, i) => (
          <button key={i} className={`vmove ${v.cursor === i + 1 ? 'current' : ''}`} onClick={() => onChange(stepTo(v, i + 1))}>
            <span className="vnum">{s.moveNumberLabel}</span> {s.san}
            <span className="veval">{evals[i + 1] !== undefined ? formatScore(evals[i + 1]) : '…'}</span>
          </button>
        ))}
      </div>
      <div className="controls-row">
        <button className="btn" onClick={() => onChange(stepTo(v, 0))} aria-label="First">⏮</button>
        <button className="btn" onClick={() => onChange(stepTo(v, v.cursor - 1))} aria-label="Back">◀</button>
        <button className="btn" onClick={() => onChange(stepTo(v, v.cursor + 1))} aria-label="Forward">▶</button>
        <button className="btn" onClick={() => onChange(stepTo(v, st.length))} aria-label="Last">⏭</button>
        <label className="check">
          <input type="checkbox" checked={showEngineArrow} onChange={onToggleEngineArrow} /> Engine arrow
        </label>
      </div>
      {onContinue && (
        <button className="btn warn full" onClick={onContinue} title="Replace the game from this point with the variation">
          Continue the game from this position
        </button>
      )}
    </div>
  );
}
