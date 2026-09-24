import { useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Chess, type Square } from 'chess.js';
import type { Arrow, SquareMark, Side } from '../core/types';

const GLYPH: Record<string, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const FILES = 'abcdefgh';

export interface BoardProps {
  fen: string;
  orientation: Side;
  /** Enable interaction for this color (null = view only). */
  interactiveColor: Side | null;
  legalMoves: (square: string) => { to: string; promotion?: string; captured?: string }[];
  onMove: (from: string, to: string, promotion?: string) => void;
  lastMove?: { from: string; to: string } | null;
  arrows?: Arrow[];
  marks?: SquareMark[];
  className?: string;
}

function squareAt(file: number, rank: number): string {
  return FILES[file] + (rank + 1);
}

/** Pixel-free square -> board-relative coordinates in 0..8 units. */
function sqToXY(s: string, orientation: Side): [number, number] {
  const f = s.charCodeAt(0) - 97;
  const r = parseInt(s[1], 10) - 1;
  return orientation === 'w' ? [f + 0.5, 7 - r + 0.5] : [7 - f + 0.5, r + 0.5];
}

const ARROW_COLOR: Record<Arrow['kind'], string> = {
  best: 'var(--arrow-best)',
  played: 'var(--arrow-played)',
  threat: 'var(--arrow-threat)',
  variation: 'var(--arrow-variation)',
  hint: 'var(--arrow-hint)',
};

export function Board({ fen, orientation, interactiveColor, legalMoves, onMove, lastMove, arrows = [], marks = [], className }: BoardProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [promo, setPromo] = useState<{ from: string; to: string } | null>(null);
  const [drag, setDrag] = useState<{ from: string; x: number; y: number } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const dragMoved = useRef(false);
  const justPicked = useRef<string | null>(null);

  const chess = useMemo(() => {
    try {
      return new Chess(fen);
    } catch {
      return new Chess();
    }
  }, [fen]);

  // Reset selection whenever the position changes.
  const [lastFen, setLastFen] = useState(fen);
  if (lastFen !== fen) {
    setLastFen(fen);
    setSelected(null);
    setPromo(null);
    setDrag(null);
  }

  const dests = useMemo(() => (selected ? legalMoves(selected) : []), [selected, legalMoves, fen]); // eslint-disable-line react-hooks/exhaustive-deps
  const destMap = useMemo(() => new Map(dests.map((d) => [d.to, d])), [dests]);
  const checkSquare = useMemo(() => {
    if (!chess.inCheck()) return null;
    for (const row of chess.board()) for (const p of row) if (p && p.type === 'k' && p.color === chess.turn()) return p.square;
    return null;
  }, [chess]);
  const markMap = useMemo(() => new Map(marks.map((m) => [m.square, m.kind])), [marks]);

  const canPick = (s: string) => {
    if (!interactiveColor) return false;
    const p = chess.get(s as Square);
    return !!p && p.color === interactiveColor && chess.turn() === interactiveColor;
  };

  const tryMove = (from: string, to: string) => {
    const d = legalMoves(from).filter((m) => m.to === to);
    if (d.length === 0) return false;
    if (d.some((m) => m.promotion)) {
      setPromo({ from, to });
      return true;
    }
    onMove(from, to);
    setSelected(null);
    return true;
  };

  const clickSquare = (s: string) => {
    if (promo) return;
    if (justPicked.current === s) {
      justPicked.current = null;
      return;
    }
    if (selected && selected !== s && destMap.has(s)) {
      tryMove(selected, s);
      return;
    }
    if (canPick(s)) setSelected(selected === s ? null : s);
    else setSelected(null);
  };

  const squareFromPoint = (clientX: number, clientY: number): string | null => {
    const el = boardRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const fx = Math.floor(((clientX - r.left) / r.width) * 8);
    const fy = Math.floor(((clientY - r.top) / r.height) * 8);
    if (fx < 0 || fx > 7 || fy < 0 || fy > 7) return null;
    return orientation === 'w' ? squareAt(fx, 7 - fy) : squareAt(7 - fx, fy);
  };

  const onPointerDown = (e: RPointerEvent, s: string) => {
    if (promo || !canPick(s) || e.button !== 0) return;
    dragMoved.current = false;
    justPicked.current = selected === s ? null : s;
    setSelected(s);
    setDrag({ from: s, x: e.clientX, y: e.clientY });
  };
  const onPointerMove = (e: RPointerEvent) => {
    if (!drag) return;
    if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) dragMoved.current = true;
    setDrag({ ...drag, x: e.clientX, y: e.clientY });
  };
  const onPointerUp = (e: RPointerEvent) => {
    if (!drag) return;
    const target = squareFromPoint(e.clientX, e.clientY);
    const from = drag.from;
    setDrag(null);
    if (dragMoved.current) {
      justPicked.current = null;
      if (target && target !== from && !tryMove(from, target)) setSelected(null);
    }
  };

  const rows = [];
  for (let vy = 0; vy < 8; vy++) {
    for (let vx = 0; vx < 8; vx++) {
      const file = orientation === 'w' ? vx : 7 - vx;
      const rank = orientation === 'w' ? 7 - vy : vy;
      const s = squareAt(file, rank);
      const p = chess.get(s as Square);
      const light = (file + rank) % 2 === 1;
      const d = destMap.get(s);
      const cls = [
        'sq',
        light ? 'light' : 'dark',
        lastMove && (lastMove.from === s || lastMove.to === s) ? 'last' : '',
        selected === s ? 'selected' : '',
        checkSquare === s ? 'check' : '',
        markMap.get(s) ? `mark-${markMap.get(s)}` : '',
      ].join(' ');
      const dragging = drag && drag.from === s && dragMoved.current;
      rows.push(
        <div key={s} className={cls} onClick={() => clickSquare(s)} onPointerDown={(e) => onPointerDown(e, s)} data-square={s}>
          {vx === 0 && <span className="coord rank">{rank + 1}</span>}
          {vy === 7 && <span className="coord file">{FILES[file]}</span>}
          {p && (
            <span className={`piece ${p.color === 'w' ? 'white' : 'black'} ${dragging ? 'ghost' : ''}`}>{GLYPH[p.type]}{'︎'}</span>
          )}
          {d && <span className={d.captured || (p && p.color !== chess.turn()) ? 'dest capture' : 'dest'} />}
        </div>,
      );
    }
  }

  let dragPiece = null;
  if (drag && dragMoved.current && boardRef.current) {
    const p = chess.get(drag.from as Square);
    const r = boardRef.current.getBoundingClientRect();
    if (p) {
      dragPiece = (
        <span
          className={`piece dragging ${p.color === 'w' ? 'white' : 'black'}`}
          style={{ left: drag.x - r.left, top: drag.y - r.top, width: r.width / 8, height: r.height / 8, fontSize: r.width / 8 * 0.8 }}
        >
          {GLYPH[p.type]}{'︎'}
        </span>
      );
    }
  }

  return (
    <div className={`board-wrap ${className ?? ''}`}>
      <div className="board" ref={boardRef} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => setDrag(null)} onPointerLeave={() => setDrag(null)}>
        {rows}
        <svg className="arrows" viewBox="0 0 8 8" aria-hidden>
          <defs>
            {(Object.keys(ARROW_COLOR) as Arrow['kind'][]).map((k) => (
              <marker key={k} id={`ah-${k}`} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="2.6" markerHeight="2.6" orient="auto">
                <path d="M0,0 L10,5 L0,10 z" fill={ARROW_COLOR[k]} />
              </marker>
            ))}
          </defs>
          {arrows.map((a, i) => {
            const [x1, y1] = sqToXY(a.from, orientation);
            const [x2, y2] = sqToXY(a.to, orientation);
            const len = Math.hypot(x2 - x1, y2 - y1) || 1;
            const shorten = 0.32;
            const ex = x2 - ((x2 - x1) / len) * shorten;
            const ey = y2 - ((y2 - y1) / len) * shorten;
            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={ex}
                y2={ey}
                stroke={ARROW_COLOR[a.kind]}
                strokeWidth={a.kind === 'best' ? 0.17 : 0.13}
                strokeLinecap="round"
                opacity={a.kind === 'played' ? 0.7 : 0.85}
                markerEnd={`url(#ah-${a.kind})`}
              />
            );
          })}
        </svg>
        {dragPiece}
        {promo && (
          <div className="promo-overlay" onClick={() => setPromo(null)}>
            <div className="promo" onClick={(e) => e.stopPropagation()}>
              <div className="promo-title">Promote to</div>
              {(['q', 'r', 'b', 'n'] as const).map((t) => (
                <button
                  key={t}
                  className={`promo-btn piece ${chess.turn() === 'w' ? 'white' : 'black'}`}
                  onClick={() => {
                    onMove(promo.from, promo.to, t);
                    setPromo(null);
                    setSelected(null);
                  }}
                  aria-label={`Promote to ${t}`}
                >
                  {GLYPH[t]}{'︎'}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
