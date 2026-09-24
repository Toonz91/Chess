import type { Score, Side } from '../core/types';
import { describeScore, formatScore, winChanceWhite } from '../core/evaluation';

export interface EvalBarProps {
  score: Score | null;
  orientation: Side;
  perspective: Side;
  /** Evaluation change caused by the user's last move (White-perspective scores). */
  delta?: { before: Score; after: Score } | null;
  analysing?: boolean;
  hidden?: boolean;
}

export function EvalBar({ score, orientation, perspective, delta, analysing, hidden }: EvalBarProps) {
  const white = score && !hidden ? winChanceWhite(score) : 50;
  const whiteBottom = orientation === 'w';
  const label = hidden ? '?' : formatScore(score);
  const leader = score && !hidden ? (winChanceWhite(score) >= 50 ? 'w' : 'b') : null;
  const title = hidden ? 'Evaluation hidden' : score ? describeScore(score, perspective) : 'Analysing…';
  let deltaTxt: string | null = null;
  if (delta && !hidden) {
    const persp = (s: Score) => (perspective === 'w' ? winChanceWhite(s) : 100 - winChanceWhite(s));
    const d = persp(delta.after) - persp(delta.before);
    if (Math.abs(d) >= 3) deltaTxt = `${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(0)}%`;
  }
  return (
    <div className="evalbar-col" title={title}>
      <div className={`evalbar ${analysing ? 'analysing' : ''}`} aria-label={title}>
        <div
          className="evalbar-white"
          style={whiteBottom ? { height: `${white}%`, bottom: 0 } : { height: `${white}%`, top: 0 }}
        />
        <span className={`evalbar-label ${leader === 'w' ? (whiteBottom ? 'bottom dark' : 'top dark') : whiteBottom ? 'top light' : 'bottom light'}`}>
          {label}
        </span>
      </div>
      {deltaTxt && <div className={`evalbar-delta ${deltaTxt.startsWith('▲') ? 'up' : 'down'}`}>{deltaTxt}</div>}
    </div>
  );
}

export function EvalSummary({ score, perspective, hidden }: { score: Score | null; perspective: Side; hidden?: boolean }) {
  if (hidden) return <div className="eval-summary muted">Evaluation hidden</div>;
  if (!score) return <div className="eval-summary muted">Analysing…</div>;
  let text: string;
  if (score.mate !== undefined) text = `M#${Math.abs(score.mate)} — ${score.mate > 0 ? 'White' : 'Black'} has mate in ${Math.abs(score.mate)}`;
  else text = `${formatScore(score)} — ${describeScore(score, perspective)}`;
  return <div className="eval-summary">{text}</div>;
}
