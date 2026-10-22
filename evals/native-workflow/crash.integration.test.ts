import { afterEach, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { intelligenceFixture } from '../personal-engineering/helpers.js';
import { repo } from '../helpers.js';
import { nativeExec } from '../../packages/codex-integration/src/events.js';
import { CodexNativeIntegration } from '../../packages/codex-integration/src/index.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
it('recovers a real terminated CLI-side process journal and dead lock without restoring authority', async () => {
  const f = await intelligenceFixture(); cleanups.push(f.cleanup); const s = f.system;
  const work = await s.work.start(f.record.id, 'Crash a dedicated fixture observer');
  const child = spawn(process.execPath, [path.join(repo, 'evals/native-workflow/crash-child.mjs'), s.store.root, work.id], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Crash fixture did not reach journal boundary')), 10000);
      child.stdout.on('data', chunk => { if (String(chunk).includes('JOURNALED_AND_LOCKED')) { clearTimeout(timer); resolve(); } });
      child.once('error', reject);
    });
    expect((await s.work.recover(work.id)).status).toBe('blocked');
    const closed = new Promise<void>(resolve => child.once('close', () => resolve())); child.kill(); await closed;
    const result = await s.work.recover(work.id); expect(result.status).toBe('recovered'); expect(result.permissionsRestored).toBe(false);
    const record = await s.work.get(work.id); expect(record.state).toBe('completed'); expect(record.engineeringOutcome).not.toBe('verified');
  } finally { if (child.exitCode === null) child.kill(); }
});
it('records actual abnormal process exit rather than a completed model turn', async () => {
  const result = await nativeExec(process.execPath, ['-e', 'process.exit(17)'], repo, { PATH: process.env.PATH });
  expect(result.code).toBe(17); expect(result.completedTurns).toBe(0); expect(result.metadata).toEqual([]);
});
it('keeps a native authentication lock closed until both the crashed owner and known child have exited', async () => {
  const f = await intelligenceFixture(); cleanups.push(f.cleanup); const s = f.system;
  const native = new CodexNativeIntegration(s.store, s.registry, s.identities, s.workspaces, s.tasks);
  const attachment = await native.attach(f.record.id); let ownedChild = 0;
  const parent = spawn(process.execPath, [path.join(repo, 'evals/native-workflow/auth-crash-child.mjs'), s.store.root, attachment.id], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Native child journal not reached')), 10000);
      parent.stdout.on('data', chunk => { const match = /CHILD_JOURNALED (\d+)/.exec(String(chunk)); if (match) { ownedChild = Number(match[1]); clearTimeout(timer); resolve(); } }); parent.once('error', reject);
    });
    expect((await native.recoverAuthentication(attachment.id)).status).toBe('blocked');
    const childAlive = () => { try { process.kill(ownedChild, 0); return true; } catch { return false; } };
    expect(childAlive()).toBe(true);
    const closed = new Promise<void>(resolve => parent.once('close', () => resolve())); parent.kill(); await closed;
    if (childAlive()) {
      expect((await native.recoverAuthentication(attachment.id)).status).toBe('blocked');
      process.kill(ownedChild); await new Promise(resolve => setTimeout(resolve, 200));
      expect((await native.recoverAuthentication(attachment.id)).status).toBe('recovered');
    } else expect((await native.recoverAuthentication(attachment.id)).status).toBe('recovered');
    ownedChild = 0;
  } finally { if (parent.exitCode === null) parent.kill(); if (ownedChild) try { process.kill(ownedChild); } catch { /* Owned fixture child already exited. */ } }
});
