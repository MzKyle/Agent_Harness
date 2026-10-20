import { spawn, spawnSync } from 'node:child_process';
import { digest, HarnessError } from '@devagent/core';

// Consume official exec JSON events, never private session/history database formats.
export async function nativeExec(executable: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs = 240000) {
  const child = spawn(executable, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let buffer = ''; let bytes = 0; let timedOut = false; let limited = false;
  const metadata: { type: string; itemType: string | null; id: string | null; hash: string }[] = [];
  let finalText = ''; let completedTurns = 0; let usage: Record<string, number> = {};
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
    const code = await new Promise<number | null>((resolve, reject) => { child.once('close', resolve); child.once('error', () => reject(new HarnessError('CODEX_NATIVE_UNAVAILABLE'))); });
    return { code, timedOut, limited, metadata, finalText, completedTurns, usage };
  } finally { clearTimeout(timer); }
}
