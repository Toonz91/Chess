import { describe, expect, it } from 'vitest';
import { parseInfo, toWhitePerspective } from '../engine/uci';
import { classifyMove } from '../classify';
import { playLine } from '../lines';
import { formatScore, winChance } from '../evaluation';
import { detectMotifs } from '../motifs';
import { buildReport } from '../report';
import { buildCoachingProfile } from '../stats';
import { openingName, isBookSequence } from '../openings';
import { playVariationMove, variationFromPosition, fenAtCursor, stepTo } from '../variation';
import type { Analysis, GameRecord, MoveAnalysis } from '../types';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('uci parsing', () => {
  it('parses multipv info lines', () => {
    const i = parseInfo('info depth 12 seldepth 19 multipv 2 score cp -31 nodes 70353 pv e7e5 g1f3');
    expect(i).toMatchObject({ depth: 12, multipv: 2, score: { cp: -31 }, pv: ['e7e5', 'g1f3'] });
    expect(parseInfo('info depth 5 score mate -3 pv a1a2')!.score).toEqual({ mate: -3 });
    expect(parseInfo('info depth 5 score cp 20 lowerbound pv a1a2')!.bound).toBe('lower');
    expect(parseInfo('info string hello')).toBeNull();
  });
  it('converts to white perspective', () => {
    expect(toWhitePerspective({ cp: 50 }, 'b')).toEqual({ cp: -50 });
    expect(toWhitePerspective({ mate: 2 }, 'b')).toEqual({ mate: -2 });
  });
});

describe('evaluation helpers', () => {
  it('computes win chances and formats scores', () => {
    expect(winChance({ cp: 0 }, 'w')).toBeCloseTo(50);
    expect(winChance({ mate: 3 }, 'b')).toBe(0);
    expect(formatScore({ cp: 123 })).toBe('+1.23');
    expect(formatScore({ mate: -4 })).toBe('#-4');
  });
});

function analysis(fen: string, lines: [string, number][]): Analysis {
  return { fen, depth: 16, bestMove: lines[0][0], lines: lines.map(([m, cp], i) => ({ rank: i + 1, depth: 16, pv: [m], score: { cp } })) };
}

describe('classification', () => {
  const flat = (fen: string, ucis: string[]) => playLine(fen, ucis, 'w');
  it('treats near-equal MultiPV alternatives as good moves (spec example)', () => {
    const before = analysis(START, [['g1f3', 60], ['d2d4', 50], ['c2c4', 50]]);
    const r = classifyMove({
      side: 'w', playedUci: 'd2d4', before, afterScore: { cp: 48 },
      playedOutcome: flat(START, ['d2d4']), bestOutcome: flat(START, ['g1f3']), legalMoveCount: 20,
    });
    expect(['best', 'excellent', 'good']).toContain(r.classification);
  });
  it('uses win-chance loss rather than raw centipawns', () => {
    // Losing 150cp when already +15 is irrelevant; losing 150cp at 0.00 is a mistake.
    const winning = analysis(START, [['g1f3', 1500]]);
    const a = classifyMove({ side: 'w', playedUci: 'a2a3', before: winning, afterScore: { cp: 1350 }, playedOutcome: flat(START, ['a2a3']), bestOutcome: flat(START, ['g1f3']), legalMoveCount: 20 });
    expect(['good', 'excellent', 'best']).toContain(a.classification);
    const equal = analysis(START, [['g1f3', 0]]);
    const b = classifyMove({ side: 'w', playedUci: 'a2a3', before: equal, afterScore: { cp: -150 }, playedOutcome: flat(START, ['a2a3']), bestOutcome: flat(START, ['g1f3']), legalMoveCount: 20 });
    expect(['mistake', 'blunder']).toContain(b.classification);
  });
  it('marks the only legal move as forced', () => {
    const r = classifyMove({ side: 'w', playedUci: 'g1f3', before: analysis(START, [['g1f3', 0]]), afterScore: { cp: 0 }, playedOutcome: flat(START, ['g1f3']), bestOutcome: flat(START, ['g1f3']), legalMoveCount: 1 });
    expect(r.classification).toBe('forced');
  });
  it('flags allowing a forced mate as a blunder', () => {
    const before = analysis(START, [['g1f3', 20]]);
    const r = classifyMove({ side: 'w', playedUci: 'f2f3', before, afterScore: { mate: -2 }, playedOutcome: flat(START, ['f2f3']), bestOutcome: flat(START, ['g1f3']), legalMoveCount: 20 });
    expect(r.classification).toBe('blunder');
  });
});

describe('motifs', () => {
  it('detects a knight fork', () => {
    const m = detectMotifs('r3k3/8/8/1N6/8/8/5PPP/6K1 w - - 0 1', 'b5c7');
    expect(m[0].kind).toBe('fork');
  });
  it('detects instructive pins only', () => {
    const pin = detectMotifs('4k3/3n4/8/8/8/8/8/B3K3 w - - 0 1', 'a1b2');
    expect(pin.find((x) => x.kind === 'pin')).toBeUndefined();
    const real = detectMotifs('4k3/8/2n5/8/8/8/8/4KB2 w - - 0 1', 'f1b5');
    expect(real.find((x) => x.kind === 'pin')?.text).toMatch(/knight on c6 to the king/);
  });
});

describe('lines', () => {
  it('measures material swings through exchanges', () => {
    const o = playLine('rnbqkbnr/ppp2ppp/3p4/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq - 0 3', ['c4a6', 'b7a6'], 'w');
    expect(o.materialDelta).toBe(-3);
    expect(o.lostBySide).toEqual(['b']);
  });
});

describe('openings & variations', () => {
  it('names openings and recognises book moves', () => {
    expect(openingName(['e4', 'c5', 'Nf3', 'd6'])).toBe('Sicilian Defence');
    expect(isBookSequence(['e4', 'e5', 'Nf3'])).toBe(true);
    expect(isBookSequence(['e4', 'e5', 'Qh5'])).toBe(false);
  });
  it('branches variations without touching the base position', () => {
    let v = variationFromPosition(START, 0, 'test', ['e2e4', 'e7e5']);
    v = stepTo(v, 1);
    v = playVariationMove(v, 'c7c5');
    expect(v.activeLine).toBe('custom');
    expect(fenAtCursor(v)).toContain('pp1ppppp');
    expect(v.baseFen).toBe(START);
  });
});

function fakeMove(ply: number, over: Partial<MoveAnalysis>): MoveAnalysis {
  return {
    ply, moveNumber: Math.floor(ply / 2) + 1, side: 'w', fenBefore: START, playedMove: 'e4', playedUci: 'e2e4', fenAfter: START,
    evaluationBefore: { cp: 0 }, evaluationAfter: { cp: 0 }, bestMove: 'e4', bestUci: 'e2e4', bestEvaluation: { cp: 0 },
    evaluationLoss: 0, cpLoss: 0, classification: 'best', principalVariation: [], bestVariation: [],
    explanation: { headline: '', playedWhy: [], bestWhy: [], arrows: [], marks: [] }, tags: [], mistakeKind: 'none',
    missedOpportunity: false, phase: 'opening', onlyMove: false, depth: 12, ...over,
  };
}

describe('report and coaching', () => {
  const game: GameRecord = {
    id: 'g1', startedAt: 1, playerSide: 'w', aiLevel: 3, timeControlId: 'none', moves: ['e4', 'e5', 'Nf3'], startFen: START,
    result: '0-1', termination: 'Black wins', pgn: '', evalTrack: [],
    analyses: [
      fakeMove(0, {}),
      fakeMove(2, { classification: 'blunder', evaluationLoss: 40, tags: ['hanging-piece', 'material-loss'], mistakeKind: 'material', phase: 'middlegame' }),
      fakeMove(4, { classification: 'miss', evaluationLoss: 20, tags: ['missed-fork'], mistakeKind: 'tactical', missedOpportunity: true, phase: 'middlegame' }),
    ],
  };
  it('builds a post-game report', () => {
    const r = buildReport(game);
    expect(r.counts.blunder).toBe(1);
    expect(r.missedOpportunities).toBe(1);
    expect(r.critical).toHaveLength(2);
    expect(r.largestSwing?.ply).toBe(2);
    expect(r.lessons.join(' ')).toMatch(/undefended|fork/);
  });
  it('builds recommendations from recurring patterns', () => {
    const p = buildCoachingProfile([game, { ...game, id: 'g2', startedAt: 2 }]);
    expect(p.themes[0].count).toBeGreaterThan(0);
    expect(p.recommendations.join(' ')).toMatch(/Your last 2 games contained/);
    expect(p.exercises.length).toBeGreaterThan(0);
  });
});
