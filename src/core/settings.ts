import type { Settings, TimeControl } from './types';

export const TIME_CONTROLS: TimeControl[] = [
  { id: 'none', label: 'Untimed', initialMs: 0, incrementMs: 0 },
  { id: '3+2', label: '3 min + 2 s', initialMs: 3 * 60_000, incrementMs: 2000 },
  { id: '5+3', label: '5 min + 3 s', initialMs: 5 * 60_000, incrementMs: 3000 },
  { id: '10+0', label: '10 min', initialMs: 10 * 60_000, incrementMs: 0 },
  { id: '15+10', label: '15 min + 10 s', initialMs: 15 * 60_000, incrementMs: 10_000 },
  { id: '30+0', label: '30 min', initialMs: 30 * 60_000, incrementMs: 0 },
];

export function timeControl(id: string): TimeControl {
  return TIME_CONTROLS.find((t) => t.id === id) ?? TIME_CONTROLS[0];
}

export const DEFAULT_SETTINGS: Settings = {
  playerSide: 'w',
  aiLevel: 4,
  timeControlId: 'none',
  analysisDepth: 14,
  tutorEnabled: true,
  blunderCheck: 'off',
  learningMode: false,
  learningAttempts: 3,
  alertLevel: 'inaccuracy',
  showLiveEval: true,
  showBestMoveArrow: true,
};

export const ANALYSIS_STRENGTHS = [
  { depth: 10, label: 'Fast (depth 10)' },
  { depth: 14, label: 'Balanced (depth 14)' },
  { depth: 18, label: 'Strong (depth 18)' },
  { depth: 22, label: 'Deep (depth 22)' },
];
