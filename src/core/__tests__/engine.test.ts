import { afterAll, describe, expect, it } from 'vitest';
import { AnalysisService } from '../engine/AnalysisService';
import { analyzeUserMove } from '../tutor';
import { nodeTransport } from './nodeEngine';

const service = new AnalysisService(nodeTransport);
afterAll(() => service.terminate());

describe('engine integration', () => {
  it('analyses the start position with MultiPV', async () => {
    const a = await service.analyze('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', { depth: 10, multiPV: 3 });
    expect(a).not.toBeNull();
    expect(a!.lines.length).toBe(3);
    expect(a!.bestMove).toMatch(/^[a-h][1-8][a-h][1-8]/);
  }, 30000);

  it('reports mate scores from White perspective', async () => {
    // Black to move, White threatens nothing; black mates? Use a position where Black is mated in 1 by White: White to move.
    const a = await service.analyze('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', { depth: 8 });
    expect(a!.lines[0].score.mate).toBe(1);
    const b = await service.analyze('3r2k1/5ppp/8/8/8/8/5PPP/6K1 b - - 0 1', { depth: 8 });
    expect(b!.lines[0].score.mate).toBe(-1);
  }, 30000);

  it('supersedes analysis on the same channel', async () => {
    const p1 = service.analyze('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', { depth: 30, channel: 'x' });
    const p2 = service.analyze('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', { depth: 8, channel: 'x' });
    expect(await p1).toBeNull();
    expect((await p2)!.fen).toContain('rnbqkbnr/pppp1ppp/8/4p3');
  }, 30000);

  it('classifies a queen blunder and explains it', async () => {
    // 1.e4 e5 2.Qh5 Nc6 3.Bc4 Nf6?? is fine for the tutor; test White hanging the queen: Qxf7+?? no.
    // Position after 1.e4 e5 2.Nf3 d6, White plays Qg4?? no... use: White queen moves to g4 where the c8 bishop takes.
    const fen = 'rnbqkbnr/ppp2ppp/3p4/4p3/4P3/5Q2/PPPP1PPP/RNB1KBNR w KQkq - 0 3';
    const res = await analyzeUserMove(service, { ply: 4, fenBefore: fen, playedUci: 'f3g4', history: [] }, 10);
    expect(res).not.toBeNull();
    expect(res!.classification).toBe('blunder');
    expect(res!.explanation.playedWhy.join(' ')).toMatch(/queen/);
    console.log(JSON.stringify(res!.explanation, null, 2));
  }, 30000);
});
