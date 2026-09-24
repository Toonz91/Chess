import { useEffect, useRef, useState } from 'react';
import type { MoveAnalysis, Side } from '../core/types';
import { CLASS_LABEL, CLASS_SYMBOL } from './TutorPanel';

export interface MoveListProps {
  sans: string[];
  analyses: Record<number, MoveAnalysis>;
  pending?: number[];
  selectedPly: number | null; // null = live position
  onSelect: (ply: number | null) => void;
  startsWith?: Side;
}

export function MoveList({ sans, analyses, pending = [], selectedPly, onSelect }: MoveListProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selectedPly === null && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [sans.length, selectedPly]);
  const rows = [];
  for (let i = 0; i < sans.length; i += 2) {
    rows.push(
      <div className="ml-row" key={i}>
        <span className="ml-num">{i / 2 + 1}.</span>
        {[i, i + 1].map((ply) =>
          ply < sans.length ? (
            <button
              key={ply}
              className={`ml-move ${selectedPly === ply || (selectedPly === null && ply === sans.length - 1) ? 'current' : ''} ${analyses[ply] ? `cls-text-${analyses[ply].classification}` : ''}`}
              onClick={() => onSelect(ply === sans.length - 1 ? null : ply)}
              title={analyses[ply] ? CLASS_LABEL[analyses[ply].classification] : undefined}
            >
              {analyses[ply] && <span className={`dot cls-bg-${analyses[ply].classification}`} />}
              {pending.includes(ply) && <span className="dot pending" />}
              {sans[ply]}
              {analyses[ply] ? CLASS_SYMBOL[analyses[ply].classification] : ''}
            </button>
          ) : (
            <span key={ply} className="ml-move empty" />
          ),
        )}
      </div>,
    );
  }
  return (
    <div className="movelist" ref={ref}>
      {sans.length === 0 ? <div className="muted pad">No moves yet.</div> : rows}
    </div>
  );
}

export function useNow(active: boolean, interval = 200): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(t);
  }, [active, interval]);
  return now;
}

export function formatClock(ms: number): string {
  if (ms < 10_000) return (Math.max(0, ms) / 1000).toFixed(1);
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
