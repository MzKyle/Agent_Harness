import { spawn, spawnSync } from 'node:child_process';
import { digest, HarnessError } from '@devagent/core';

// Consume official exec JSON events, never private session/history database formats.
export async function nativeExec(executable: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs = 240000, lifecycle?: { started: (pid: number) => Promise<void>; closed: (code: number | null) => Promise<void> }) {
  const child = spawn(executable, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let launchFailed = false;
  const completion = new Promise<number | null>(resolve => { child.once('close', resolve); child.once('error', () => { launchFailed = true; resolve(null); }); });
  let buffer = ''; let bytes = 0; let timedOut = false; let limited = false;
  const metadata: { type: string; itemType: string | null; id: string | null; hash: string }[] = [];
  let finalText = ''; let completedTurns = 0; let usage: Record<string, number> = {};
  const failures: { category: string; code: string | null }[] = [];
  const kill = () => {
    if (process.platform === 'win32' && child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 });
    else child.kill('SIGTERM');
  };
  const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
  const safeId = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,120}$/.test(value) ? value : null;
  child.stdout.on('data', (chunk: Buffer) => {
    bytes += chunk.length; if (bytes > 2 * 1024 * 1024) { limited = true; kill(); return; }
    buffer += chunk.toString(); let index: number;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      try {
        const event = JSON.parse(line) as Record<string, unknown>; const item = event.item as Record<string, unknown> | undefined;
        const type = safeId(event.type); if (!type) continue;
        metadata.push({ type, itemType: safeId(item?.type), id: safeId(event.thread_id ?? item?.id), hash: digest(line) });
        if (type === 'error' || type === 'turn.failed') {
          const error = event.error && typeof event.error === 'object' ? event.error as Record<string, unknown> : {};
          const suppliedCode = error.code ?? event.code;
          const codes = ['rate_limit_exceeded', 'insufficient_quota', 'context_length_exceeded', 'invalid_request_error', 'authentication_error', 'server_error', 'mcp_tool_call_error', 'stream_disconnected', 'usage_limit_reached'];
          const code = typeof suppliedCode === 'string' && codes.includes(suppliedCode) ? suppliedCode : null;
          // Classify in memory only. Never retain provider error bodies, URLs, account details or credentials.
          const message = [code, error.message, event.message, typeof event.error === 'string' ? event.error : ''].filter(value => typeof value === 'string').join(' ');
          const category = /quota|rate.limit|usage.limit|limit.reached/i.test(message) ? 'usage-or-rate-limit' : /context.length|context.window/i.test(message) ? 'context-limit' : /authenticat|unauthori[sz]ed|invalid.api.key/i.test(message) ? 'authentication' : /disconnect|network|connection|timed.out|timeout|stream.*closed/i.test(message) ? 'transport' : /server.error|internal.server/i.test(message) ? 'provider' : 'unknown';
          if (!failures.some(item => item.category === category && item.code === code)) failures.push({ category, code });
        }
        if (type === 'turn.completed') {
          completedTurns++;
          if (event.usage && typeof event.usage === 'object') usage = Object.fromEntries(Object.entries(event.usage).filter((pair): pair is [string, number] => /^[a-z_]{1,40}$/.test(pair[0]) && typeof pair[1] === 'number' && Number.isSafeInteger(pair[1]) && pair[1] >= 0));
        }
        if (type === 'item.completed' && item?.type === 'agent_message' && typeof item.text === 'string') finalText = item.text.slice(0, 32768);
      } catch { /* Invalid records are not authority. */ }
    }
  });
  child.stderr.on('data', () => undefined);
  try {
    if (child.pid) try { await lifecycle?.started(child.pid); } catch { kill(); throw new HarnessError('NATIVE_PROCESS_JOURNAL_FAILED'); }
    const code = await completion; if (launchFailed) throw new HarnessError('CODEX_NATIVE_UNAVAILABLE');
    await lifecycle?.closed(code);
    return { code, timedOut, limited, metadata, finalText, completedTurns, usage, failures };
  } finally { clearTimeout(timer); }
}
