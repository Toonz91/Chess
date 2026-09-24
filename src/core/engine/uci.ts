import type { PvLine, Score } from '../types';

export interface InfoLine {
  depth: number;
  multipv: number;
  /** Score from the side-to-move's perspective (raw UCI). */
  score: Score;
  bound?: 'lower' | 'upper';
  pv: string[];
  nodes?: number;
}

/** Parse a UCI `info` line. Returns null for lines without a score + pv. */
export function parseInfo(line: string): InfoLine | null {
  if (!line.startsWith('info ')) return null;
  const t = line.split(/\s+/);
  let depth = 0;
  let multipv = 1;
  let score: Score | null = null;
  let bound: InfoLine['bound'];
  let pv: string[] = [];
  let nodes: number | undefined;
  for (let i = 1; i < t.length; i++) {
    switch (t[i]) {
      case 'depth':
        depth = parseInt(t[++i], 10);
        break;
      case 'multipv':
        multipv = parseInt(t[++i], 10);
        break;
      case 'nodes':
        nodes = parseInt(t[++i], 10);
        break;
      case 'score': {
        const kind = t[++i];
        const val = parseInt(t[++i], 10);
        score = kind === 'mate' ? { mate: val } : { cp: val };
        if (t[i + 1] === 'lowerbound' || t[i + 1] === 'upperbound') {
          bound = t[++i] === 'lowerbound' ? 'lower' : 'upper';
        }
        break;
      }
      case 'pv':
        pv = t.slice(i + 1);
        i = t.length;
        break;
    }
  }
  if (!score || pv.length === 0) return null;
  return { depth, multipv, score, bound, pv, nodes };
}

/** Convert a side-to-move-relative score into a White-relative score. */
export function toWhitePerspective(score: Score, sideToMove: 'w' | 'b'): Score {
  if (sideToMove === 'w') return score;
  if (score.mate !== undefined) return { mate: -score.mate };
  return { cp: -(score.cp ?? 0) };
}

export function infoToPvLine(info: InfoLine, sideToMove: 'w' | 'b'): PvLine {
  return {
    rank: info.multipv,
    depth: info.depth,
    pv: info.pv,
    score: toWhitePerspective(info.score, sideToMove),
  };
}

export function parseBestMove(line: string): string | null | undefined {
  if (!line.startsWith('bestmove')) return undefined;
  const mv = line.split(/\s+/)[1];
  return !mv || mv === '(none)' ? null : mv;
}
