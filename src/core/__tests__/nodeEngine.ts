// Test helper: runs the Stockfish WASM build in a Node child process.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { EngineTransport } from '../engine/UciEngine';

export function nodeTransport(): EngineTransport {
  const file = join(process.cwd(), 'node_modules/stockfish/bin/stockfish-19-lite-single.js');
  const proc = spawn(process.execPath, [file], { stdio: ['pipe', 'pipe', 'inherit'] });
  let listener: (l: string) => void = () => {};
  let buf = '';
  proc.stdout.on('data', (d: Buffer) => {
    buf += d.toString();
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const l of lines) if (l.trim()) listener(l.trim());
  });
  return {
    send: (cmd) => proc.stdin.write(cmd + '\n'),
    onLine: (cb) => (listener = cb),
    terminate: () => proc.kill(),
  };
}
