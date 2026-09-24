import { useCallback, useEffect, useMemo, useState } from 'react';
import { Chess, type Square } from 'chess.js';
import type { Arrow, Score } from '../core/types';
import { activeLine, fenAtCursor, lastMoveAtCursor, playVariationMove, type Variation } from '../core/variation';
import { useLineEvals } from './VariationPanel';
import { useServices } from './services';

/** Best move for a position (for the optional engine arrow). */
export function useBestMove(fen: string | null, enabled: boolean, depth = 12): string | null {
  const { service } = useServices();
  const [best, setBest] = useState<{ fen: string; uci: string | null } | null>(null);
  useEffect(() => {
    if (!fen || !enabled) return;
    let alive = true;
    service.analyze(fen, { depth, maxTimeMs: 1200, channel: 'var-arrow' }).then((a) => {
      if (alive && a) setBest({ fen, uci: a.bestMove });
    });
    return () => {
      alive = false;
    };
  }, [fen, enabled, depth, service]);
  return best && best.fen === fen ? best.uci : null;
}

export function useVariationView(v: Variation | null, setV: (v: Variation) => void) {
  const [engineArrow, setEngineArrow] = useState(true);
  const line = v ? activeLine(v) : null;
  const moves = useMemo(() => line?.moves ?? [], [line]);
  const evals: (Score | null)[] = useLineEvals(v?.baseFen ?? '', v ? moves : []);
  const fen = v ? fenAtCursor(v) : null;
  const bestUci = useBestMove(fen, !!v && engineArrow);

  const legalMoves = useCallback(
    (square: string) => {
      if (!fen) return [];
      const c = new Chess(fen);
      return c.moves({ square: square as Square, verbose: true }).map((m) => ({ to: m.to, promotion: m.promotion, captured: m.captured }));
    },
    [fen],
  );

  const onMove = useCallback(
    (from: string, to: string, promotion?: string) => {
      if (!v || !fen) return;
      const c = new Chess(fen);
      try {
        const m = c.move({ from, to, promotion: promotion ?? 'q' });
        setV(playVariationMove(v, m.from + m.to + (m.promotion ?? '')));
      } catch {
        /* illegal */
      }
    },
    [v, fen, setV],
  );

  const arrows: Arrow[] = [];
  if (v) {
    const next = moves[v.cursor];
    if (next) arrows.push({ from: next.slice(0, 2), to: next.slice(2, 4), kind: 'variation' });
    if (v.cursor === 0) {
      for (const l of v.lines) {
        const u = l.moves[0];
        if (u && l.id !== v.activeLine) arrows.push({ from: u.slice(0, 2), to: u.slice(2, 4), kind: l.id === 'best' ? 'best' : 'played' });
      }
    }
    if (engineArrow && bestUci && bestUci !== next) arrows.push({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), kind: 'hint' });
  }

  return {
    fen,
    turn: fen ? (fen.split(' ')[1] as 'w' | 'b') : null,
    legalMoves,
    onMove,
    arrows,
    lastMove: v ? lastMoveAtCursor(v) : null,
    evals,
    score: v ? evals[v.cursor] ?? null : null,
    engineArrow,
    toggleEngineArrow: () => setEngineArrow((x) => !x),
  };
}
