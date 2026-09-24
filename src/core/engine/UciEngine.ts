import type { Analysis, PvLine } from '../types';
import { infoToPvLine, parseBestMove, parseInfo } from './uci';

/** Minimal line-based transport so the engine can run in a Web Worker or a Node child process. */
export interface EngineTransport {
  send(cmd: string): void;
  onLine(cb: (line: string) => void): void;
  terminate(): void;
}

export interface SearchOptions {
  depth?: number;
  movetime?: number;
  multiPV?: number;
  /** Playing-strength limits (opponent only). */
  skillLevel?: number;
  elo?: number;
}

export interface SearchRequest {
  fen: string;
  options: SearchOptions;
  /**
   * Jobs on the same channel supersede each other: queued jobs are dropped and a
   * running job is stopped. Used to cancel outdated analysis.
   */
  channel?: string;
  onUpdate?: (a: Analysis) => void;
}

interface Job extends SearchRequest {
  id: number;
  sideToMove: 'w' | 'b';
  lines: Map<number, PvLine>;
  cancelled: boolean;
  resolve: (a: Analysis | null) => void;
}

/**
 * Serialises searches on a single UCI engine. Every result is tagged with the FEN
 * it was computed for, so callers can never apply analysis to the wrong position.
 * Cancelled/superseded searches resolve with `null`.
 */
export class UciEngine {
  private queue: Job[] = [];
  private current: Job | null = null;
  private nextId = 1;
  private ready: Promise<void>;
  private readyResolve!: () => void;
  private isReady = false;
  private optionState = new Map<string, string>();
  private readyWaiters: (() => void)[] = [];
  private lastUpdate = 0;
  onLog?: (line: string) => void;

  constructor(private transport: EngineTransport, private hashMb = 32) {
    this.ready = new Promise((r) => (this.readyResolve = r));
    transport.onLine((line) => this.handleLine(line));
    transport.send('uci');
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  get busy(): boolean {
    return this.current !== null || this.queue.length > 0;
  }

  search(req: SearchRequest): Promise<Analysis | null> {
    if (req.channel) this.cancelChannel(req.channel);
    const sideToMove = (req.fen.split(' ')[1] as 'w' | 'b') ?? 'w';
    return new Promise((resolve) => {
      const job: Job = { ...req, id: this.nextId++, sideToMove, lines: new Map(), cancelled: false, resolve };
      this.queue.push(job);
      this.pump();
    });
  }

  cancelChannel(channel: string): void {
    this.queue = this.queue.filter((j) => {
      if (j.channel === channel) {
        j.resolve(null);
        return false;
      }
      return true;
    });
    if (this.current && this.current.channel === channel && !this.current.cancelled) {
      this.current.cancelled = true;
      this.transport.send('stop');
    }
  }

  cancelAll(): void {
    for (const j of this.queue) j.resolve(null);
    this.queue = [];
    if (this.current && !this.current.cancelled) {
      this.current.cancelled = true;
      this.transport.send('stop');
    }
  }

  /** Reset engine state between games. */
  async newGame(): Promise<void> {
    this.cancelAll();
    await this.ready;
    await this.idle();
    this.transport.send('ucinewgame');
    await this.sync();
  }

  terminate(): void {
    this.cancelAll();
    this.transport.terminate();
  }

  private idle(): Promise<void> {
    if (!this.current) return Promise.resolve();
    return new Promise((r) => {
      const check = () => (this.current ? setTimeout(check, 10) : r());
      check();
    });
  }

  private sync(): Promise<void> {
    return new Promise((r) => {
      this.readyWaiters.push(r);
      this.transport.send('isready');
    });
  }

  private setOption(name: string, value: string | number): void {
    const v = String(value);
    if (this.optionState.get(name) === v) return;
    this.optionState.set(name, v);
    this.transport.send(`setoption name ${name} value ${v}`);
  }

  private pump(): void {
    if (!this.isReady || this.current || this.queue.length === 0) return;
    const job = this.queue.shift()!;
    this.current = job;
    const o = job.options;
    this.setOption('MultiPV', o.multiPV ?? 1);
    if (o.elo !== undefined) {
      this.setOption('Skill Level', 20);
      this.setOption('UCI_LimitStrength', 'true');
      this.setOption('UCI_Elo', o.elo);
    } else {
      this.setOption('UCI_LimitStrength', 'false');
      this.setOption('Skill Level', o.skillLevel ?? 20);
    }
    this.transport.send(`position fen ${job.fen}`);
    const parts = ['go'];
    if (o.depth) parts.push('depth', String(o.depth));
    if (o.movetime) parts.push('movetime', String(o.movetime));
    if (!o.depth && !o.movetime) parts.push('depth', '12');
    this.transport.send(parts.join(' '));
  }

  private snapshot(job: Job, bestMove: string | null, partial: boolean): Analysis {
    const lines = [...job.lines.values()].sort((a, b) => a.rank - b.rank);
    const depth = lines.length ? Math.min(...lines.map((l) => l.depth)) : 0;
    return { fen: job.fen, depth, lines, bestMove: bestMove ?? lines[0]?.pv[0] ?? null, partial };
  }

  private handleLine(line: string): void {
    this.onLog?.(line);
    if (line === 'uciok') {
      this.setOption('Hash', this.hashMb);
      this.sync().then(() => {
        this.isReady = true;
        this.readyResolve();
        this.pump();
      });
      return;
    }
    if (line === 'readyok') {
      const w = this.readyWaiters.shift();
      w?.();
      return;
    }
    const job = this.current;
    if (!job) return;
    const info = parseInfo(line);
    if (info) {
      if (info.bound) return; // ignore fail-high/low bounds
      const pvLine = infoToPvLine(info, job.sideToMove);
      const prev = job.lines.get(pvLine.rank);
      if (!prev || pvLine.depth >= prev.depth) job.lines.set(pvLine.rank, pvLine);
      if (job.onUpdate && !job.cancelled && pvLine.rank === 1) {
        const now = Date.now();
        if (now - this.lastUpdate > 120) {
          this.lastUpdate = now;
          job.onUpdate(this.snapshot(job, null, true));
        }
      }
      return;
    }
    const best = parseBestMove(line);
    if (best !== undefined) {
      this.current = null;
      if (job.cancelled) job.resolve(null);
      else job.resolve(this.snapshot(job, best, false));
      this.pump();
    }
  }
}

/** Browser transport backed by a Web Worker running stockfish.js. */
export function createWorkerTransport(url: string): EngineTransport {
  const worker = new Worker(url);
  let listener: (l: string) => void = () => {};
  worker.onmessage = (e: MessageEvent) => {
    const data = typeof e.data === 'string' ? e.data : String(e.data);
    for (const l of data.split('\n')) if (l.trim()) listener(l.trim());
  };
  return {
    send: (cmd) => worker.postMessage(cmd),
    onLine: (cb) => (listener = cb),
    terminate: () => worker.terminate(),
  };
}
