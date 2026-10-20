import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { HarnessError } from '@devagent/core';

// Thin JSON-RPC transport for the official app-server, not a model client or Agent loop.
export class NativeRpc {
  readonly child: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  constructor(executable: string, cwd: string, environment: NodeJS.ProcessEnv, configArgs: string[] = []) {
    this.child = spawn(executable, ['app-server', '--stdio', ...configArgs], { cwd, env: environment, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '';
    this.child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      if (Buffer.byteLength(buffer) > 2 * 1024 * 1024) { buffer = ''; this.child.stdout.destroy(); this.fail(new HarnessError('CODEX_RPC_OUTPUT_LIMIT')); return; }
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let message: { id?: number; result?: unknown; error?: unknown; method?: string };
        try { message = JSON.parse(line); } catch { continue; }
        if (message.method && message.id !== undefined) { this.child.stdin.write(`${JSON.stringify({ id: message.id, error: { code: -32000, message: 'Interactive actions are not authorized by the offline inspector' } })}\n`); continue; }
        if (message.id === undefined) continue;
        const waiter = this.pending.get(message.id); if (!waiter) continue;
        clearTimeout(waiter.timer); this.pending.delete(message.id);
        if (message.error) waiter.reject(new HarnessError('CODEX_RPC_REQUEST_FAILED')); else waiter.resolve(message.result);
      }
    });
    // Never persist native stderr or account details in a protocol discovery report.
    this.child.stderr.on('data', () => undefined);
    this.child.on('error', () => this.fail(new HarnessError('CODEX_NATIVE_UNAVAILABLE')));
    this.child.on('close', () => this.fail(new HarnessError('CODEX_NATIVE_CLOSED')));
  }
  private fail(error: Error) { for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); } this.pending.clear(); }
  request<T>(method: string, params: unknown, timeoutMs = 20000): Promise<T> {
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new HarnessError('CODEX_RPC_TIMEOUT')); }, timeoutMs);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }
  notify(method: string) { this.child.stdin.write(`${JSON.stringify({ method })}\n`); }
  async close() {
    this.fail(new HarnessError('CODEX_INSPECTION_FINISHED')); this.child.stdin.end();
    if (this.child.exitCode !== null) return;
    await new Promise<void>(resolve => { const timer = setTimeout(() => {
      if (process.platform === 'win32' && this.child.pid) spawnSync('taskkill', ['/PID', String(this.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 });
      else this.child.kill();
      resolve();
    }, 2000); this.child.once('close', () => { clearTimeout(timer); resolve(); }); });
  }
}
