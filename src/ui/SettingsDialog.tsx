import { useState } from 'react';
import type { BlunderCheckMode, Settings } from '../core/types';
import { OPPONENT_LEVELS } from '../core/engine/AnalysisService';
import { ANALYSIS_STRENGTHS, TIME_CONTROLS } from '../core/settings';
import { DataManager } from './DataManager';

export interface SettingsDialogProps {
  initial: Settings;
  mode: 'new-game' | 'settings';
  onApply: (s: Settings) => void;
  onStart: (s: Settings) => void;
  onClose: () => void;
}

const BLUNDER_MODES: { id: BlunderCheckMode; label: string; help: string }[] = [
  { id: 'off', label: 'Off', help: 'No assistance before or after moves.' },
  { id: 'warn', label: 'Warning only', help: 'A subtle warning after a move that badly changes the evaluation.' },
  { id: 'ask', label: 'Ask before blunder', help: '"Are you sure?" before a move that looks like a major blunder. The best move is not revealed.' },
  { id: 'full', label: 'Full tutor', help: 'Ask before blunders and give a hint about what is wrong.' },
];

export function SettingsDialog({ initial, mode, onApply, onStart, onClose }: SettingsDialogProps) {
  const [s, setS] = useState<Settings>(initial);
  const up = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((x) => ({ ...x, [k]: v }));
  const lvl = OPPONENT_LEVELS.find((l) => l.level === s.aiLevel)!;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Game settings">
        <h2>{mode === 'new-game' ? 'New game' : 'Settings'}</h2>

        <fieldset>
          <legend>Game</legend>
          <label>
            Play as
            <div className="seg">
              {(['w', 'b', 'random'] as const).map((v) => (
                <button key={v} className={s.playerSide === v ? 'on' : ''} onClick={() => up('playerSide', v)}>
                  {v === 'w' ? 'White' : v === 'b' ? 'Black' : 'Random'}
                </button>
              ))}
            </div>
          </label>
          <label>
            Opponent strength: <strong>{lvl.label}</strong> (≈{lvl.approxElo} Elo)
            <input type="range" min={1} max={OPPONENT_LEVELS.length} value={s.aiLevel} onChange={(e) => up('aiLevel', Number(e.target.value))} />
          </label>
          <label>
            Time control
            <select value={s.timeControlId} onChange={(e) => up('timeControlId', e.target.value)}>
              {TIME_CONTROLS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          {mode === 'settings' && <div className="muted small">Side, strength and time control apply from the next game.</div>}
        </fieldset>

        <fieldset>
          <legend>Tutor</legend>
          <label className="check">
            <input type="checkbox" checked={s.tutorEnabled} onChange={(e) => up('tutorEnabled', e.target.checked)} /> Tutor mode (real-time coaching)
          </label>
          <label>
            Analysis strength
            <select value={s.analysisDepth} onChange={(e) => up('analysisDepth', Number(e.target.value))}>
              {ANALYSIS_STRENGTHS.map((a) => (
                <option key={a.depth} value={a.depth}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Show detailed feedback from
            <select value={s.alertLevel} onChange={(e) => up('alertLevel', e.target.value as Settings['alertLevel'])}>
              <option value="inaccuracy">Inaccuracies and worse</option>
              <option value="mistake">Mistakes and worse</option>
              <option value="blunder">Blunders only</option>
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={s.showLiveEval} onChange={(e) => up('showLiveEval', e.target.checked)} /> Show live evaluation bar and engine line
          </label>
          <label className="check">
            <input type="checkbox" checked={s.showBestMoveArrow} onChange={(e) => up('showBestMoveArrow', e.target.checked)} /> Show best-move arrows when reviewing moves
          </label>
        </fieldset>

        <fieldset>
          <legend>Blunder check</legend>
          <div className="radio-list">
            {BLUNDER_MODES.map((b) => (
              <label key={b.id} className="radio">
                <input type="radio" name="blunder" checked={s.blunderCheck === b.id} onChange={() => up('blunderCheck', b.id)} />
                <span>
                  <strong>{b.label}</strong> <span className="muted small">{b.help}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>Learning mode</legend>
          <label className="check">
            <input type="checkbox" checked={s.learningMode} onChange={(e) => up('learningMode', e.target.checked)} /> Pause after a mistake and let me find a better move
          </label>
          <label>
            Attempts before the answer is revealed
            <input type="number" min={1} max={10} value={s.learningAttempts} onChange={(e) => up('learningAttempts', Math.max(1, Math.min(10, Number(e.target.value) || 1)))} />
          </label>
        </fieldset>

        <DataManager />

        <div className="button-row end">
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          {mode === 'settings' && (
            <button className="btn" onClick={() => onApply(s)}>
              Apply
            </button>
          )}
          <button className="btn primary" onClick={() => onStart(s)}>
            Start new game
          </button>
        </div>
      </div>
    </div>
  );
}
