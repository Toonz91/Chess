import type { Classification, MoveAnalysis, Side } from '../core/types';
import { formatLine, uciLineToSan } from '../core/board';
import { formatScore } from '../core/evaluation';
import type { BlunderPrompt, LearningState } from '../game/GameController';

export const CLASS_LABEL: Record<Classification, string> = {
  book: 'Book',
  forced: 'Forced',
  best: 'Best',
  excellent: 'Excellent',
  good: 'Good',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  blunder: 'Blunder',
  miss: 'Missed opportunity',
};

export const CLASS_SYMBOL: Record<Classification, string> = {
  book: '',
  forced: '',
  best: '!',
  excellent: '',
  good: '',
  inaccuracy: '?!',
  mistake: '?',
  blunder: '??',
  miss: '?',
};

export function ClassBadge({ c, small }: { c: Classification; small?: boolean }) {
  return <span className={`badge cls-${c} ${small ? 'small' : ''}`}>{CLASS_LABEL[c]}</span>;
}

function line(fen: string, ucis: string[], max = 10): string {
  return formatLine(fen, uciLineToSan(fen, ucis, max));
}

export interface TutorPanelProps {
  analysis: MoveAnalysis | null;
  pending: boolean;
  tutorEnabled: boolean;
  isAlert: boolean;
  onShowVariation: (a: MoveAnalysis, start: 'best' | 'played') => void;
  onDismiss?: () => void;
  gameOver?: boolean;
}

export function TutorPanel({ analysis: a, pending, tutorEnabled, isAlert, onShowVariation, onDismiss }: TutorPanelProps) {
  if (!tutorEnabled && !a) {
    return (
      <div className="tutor-card quiet">
        <div className="tutor-status">Tutor is off — your moves are still analysed for the post-game report.</div>
      </div>
    );
  }
  if (!a) {
    return (
      <div className="tutor-card quiet">
        <div className="tutor-status">{pending ? <><span className="spinner" /> Tutor is analysing your move…</> : 'Make a move — the tutor will comment on it.'}</div>
      </div>
    );
  }
  const significant = ['inaccuracy', 'mistake', 'blunder', 'miss'].includes(a.classification);
  const ex = a.explanation;
  if (!significant) {
    return (
      <div className={`tutor-card compact cls-border-${a.classification}`}>
        {pending && <div className="tutor-status"><span className="spinner" /> Analysing your latest move…</div>}
        <div className="compact-row">
          <ClassBadge c={a.classification} />
          <span className="compact-move">
            {a.moveNumber}
            {a.side === 'w' ? '.' : '…'} {a.playedMove}
            {CLASS_SYMBOL[a.classification]}
          </span>
          <span className="muted">{formatScore(a.evaluationAfter)}</span>
        </div>
        <div className="compact-text">
          {ex.headline}
          {a.onlyMove && ' Only move — everything else was clearly worse!'}
        </div>
        {a.missedOpportunity && ex.opportunity && <div className="compact-text muted">Note: {ex.opportunity}</div>}
      </div>
    );
  }

  const bestLine = line(a.fenBefore, a.bestVariation, 10);
  const playedLine = line(a.fenBefore, [a.playedUci, ...a.principalVariation], 10);

  return (
    <div className={`tutor-card alert cls-border-${a.classification} ${isAlert ? 'pulse' : ''}`}>
      {pending && <div className="tutor-status"><span className="spinner" /> Analysing your latest move…</div>}
      <div className="alert-head">
        <ClassBadge c={a.classification} />
        <div className="alert-headline">{ex.headline}</div>
      </div>

      {a.classification === 'miss' || a.missedOpportunity ? (
        <div className="missed">
          <div className="eyebrow">Missed opportunity</div>
          <div>{ex.opportunity ?? 'You had a stronger continuation available.'}</div>
        </div>
      ) : null}

      <div className="compare">
        <section className="compare-card played">
          <div className="eyebrow">Your move</div>
          <div className="compare-move">
            {a.moveNumber}
            {a.side === 'w' ? '.' : '…'} {a.playedMove}
            {CLASS_SYMBOL[a.classification]}
          </div>
          <div className="compare-eval">
            Evaluation: {formatScore(a.evaluationBefore)} → <strong>{formatScore(a.evaluationAfter)}</strong>
          </div>
          <div className="why-label">Why</div>
          <ul className="why">
            {ex.playedWhy.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
          <div className="why-label">If you continue</div>
          <div className="pv">{playedLine}</div>
          <button className="btn small" onClick={() => onShowVariation(a, 'played')}>
            Show my line on the board
          </button>
        </section>
        {a.bestMove && (
          <section className="compare-card best">
            <div className="eyebrow">Best move</div>
            <div className="compare-move">
              {a.moveNumber}
              {a.side === 'w' ? '.' : '…'} {a.bestMove}!
            </div>
            <div className="compare-eval">
              Evaluation: {formatScore(a.evaluationBefore)} → <strong>{formatScore(a.bestEvaluation)}</strong>
            </div>
            <div className="why-label">Why</div>
            <ul className="why">
              {ex.bestWhy.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
            <div className="why-label">Best continuation</div>
            <div className="pv">{bestLine}</div>
            <button className="btn small primary" onClick={() => onShowVariation(a, 'best')}>
              Show variation
            </button>
          </section>
        )}
      </div>
      {ex.principle && (
        <div className="principle">
          <span className="principle-icon" aria-hidden>
            ★
          </span>
          <div>
            <div className="eyebrow">Lesson</div>
            {ex.principle}
          </div>
        </div>
      )}
      {isAlert && onDismiss && (
        <button className="btn full" onClick={onDismiss}>
          Got it — continue playing
        </button>
      )}
    </div>
  );
}

export function LearningPanel({
  learning,
  maxAttempts,
  onReveal,
  onResolve,
}: {
  learning: LearningState;
  maxAttempts: number;
  onReveal: () => void;
  onResolve: (uci: string) => void;
}) {
  const o = learning.original;
  const done = learning.status === 'solved' || learning.status === 'revealed';
  const last = learning.attempts[learning.attempts.length - 1];
  const severityWord = o.classification === 'inaccuracy' ? 'an inaccurate' : o.classification === 'blunder' ? 'a losing' : o.classification === 'miss' ? 'a' : 'a weak';
  return (
    <div className="tutor-card learning">
      <div className="eyebrow">Learning mode</div>
      <div className="alert-headline">
        {o.classification === 'miss'
          ? `You missed something after ${o.playedMove}. Can you find the stronger move?`
          : `You played ${severityWord} move (${o.playedMove}). Can you find a better move?`}
      </div>
      <div className="muted">
        The game is paused. Make a move on the board. Attempts: {learning.attempts.length}/{maxAttempts}
      </div>
      {learning.status === 'checking' && (
        <div className="tutor-status">
          <span className="spinner" /> Checking your move…
        </div>
      )}
      <ul className="attempts">
        {learning.attempts.map((t, i) => (
          <li key={i} className={`attempt v-${t.verdict}`}>
            <strong>{t.verdict === 'correct' ? 'Correct' : t.verdict === 'better' ? 'Better, but not best' : t.verdict === 'still-inaccurate' ? 'Still inaccurate' : 'Major mistake'}</strong>
            <span> — {t.text}</span>
          </li>
        ))}
      </ul>
      {!done && (
        <button className="btn" onClick={onReveal}>
          Show me the answer
        </button>
      )}
      {done && (
        <div className="learning-answer">
          <div className="compare-move">Best move: {o.bestMove}!</div>
          <ul className="why">
            {o.explanation.bestWhy.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
          <div className="why-label">Your original move</div>
          <ul className="why">
            {o.explanation.playedWhy.slice(0, 2).map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
          {o.explanation.principle && <div className="principle-inline">★ {o.explanation.principle}</div>}
          <div className="button-col">
            {o.bestUci && (
              <button className="btn primary" onClick={() => onResolve(o.bestUci!)}>
                Continue with {o.bestMove}
              </button>
            )}
            {last && last.verdict !== 'major-mistake' && last.uci !== o.bestUci && (
              <button className="btn" onClick={() => onResolve(last.uci)}>
                Continue with my try {last.san}
              </button>
            )}
            <button className="btn ghost" onClick={() => onResolve(o.playedUci)}>
              Keep my original move {o.playedMove}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function BlunderPromptCard({ prompt, onAnswer }: { prompt: BlunderPrompt; onAnswer: (play: boolean) => void }) {
  return (
    <div className="blunder-prompt" role="alertdialog" aria-label="Are you sure?">
      <div className="blunder-title">Are you sure about {prompt.san}?</div>
      <div>{prompt.message}</div>
      {prompt.hint && <div className="muted">{prompt.hint}</div>}
      <div className="button-row">
        <button className="btn primary" onClick={() => onAnswer(false)}>
          Let me think again
        </button>
        <button className="btn ghost" onClick={() => onAnswer(true)}>
          Play {prompt.san} anyway
        </button>
      </div>
    </div>
  );
}

export function perspectiveLabel(side: Side): string {
  return side === 'w' ? 'White' : 'Black';
}
