import { afterAll, describe, expect, it } from 'vitest';
import { AnalysisService } from '../engine/AnalysisService';
import { analyzeUserMove } from '../tutor';
import { nodeTransport } from './nodeEngine';

const service = new AnalysisService(nodeTransport);
afterAll(() => service.terminate());

const run = (fenBefore: string, playedUci: string) => analyzeUserMove(service, { ply: 10, fenBefore, playedUci, history: [] }, 12);

describe('tutor scenarios (real engine)', () => {
  it('does not punish an equivalent alternative to the engine move', async () => {
    const r = await run('r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4', 'd2d3');
    expect(['best', 'excellent', 'good', 'book']).toContain(r!.classification);
  }, 30000);

  it('detects a missed knight fork', async () => {
    const r = await run('r3k3/8/8/1N6/8/8/5PPP/6K1 w - - 0 1', 'h2h3');
    console.log(r!.classification, r!.tags, r!.explanation.headline, r!.explanation.bestWhy);
    expect(r!.missedOpportunity).toBe(true);
    expect(r!.tags).toContain('missed-fork');
    expect(r!.explanation.opportunity).toMatch(/fork/);
  }, 30000);

  it('detects a missed mate in one', async () => {
    const r = await run('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', 'h2h3');
    console.log(r!.classification, r!.tags, r!.explanation.headline);
    expect(r!.missedOpportunity).toBe(true);
    expect(r!.tags).toContain('missed-mate');
  }, 30000);

  it('flags a move that allows a back-rank mate', async () => {
    const r = await run('4r1k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', 'd1d7');
    console.log(r!.classification, r!.tags, r!.explanation.playedWhy);
    expect(r!.classification).toBe('blunder');
    expect(r!.tags).toContain('allowed-mate');
    expect(r!.tags).toContain('back-rank');
  }, 30000);

  it('explains a piece left en prise', async () => {
    // Knight to a square attacked by a pawn.
    const r = await run('rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 2', 'f3g5');
    console.log(r!.classification, r!.tags, r!.explanation.playedWhy);
    expect(['inaccuracy', 'mistake', 'blunder']).toContain(r!.classification);
  }, 30000);

  it('explains hanging a piece to a pawn', async () => {
    const r = await run('rnbqkbnr/ppp2ppp/3p4/4p3/4P3/2N5/PPPP1PPP/R1BQKBNR w KQkq - 0 3', 'c3b5');
    // Nb5 is fine; now hang the bishop: Bc4-d5?
    expect(r).not.toBeNull();
    const r2 = await run('rnbqkbnr/ppp2ppp/3p4/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq - 0 3', 'c4a6');
    console.log(r2!.classification, r2!.tags, r2!.explanation.headline, r2!.explanation.playedWhy);
    expect(r2!.tags).toContain('hanging-piece');
  }, 30000);
});
