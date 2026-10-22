import { parseArgs } from 'node:util';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout, clearTimeout } from 'node:timers';
import path from 'node:path';
import console from 'node:console';
import { engineeringSystem } from '../../packages/adapters/dist/index.js';
import { CodexNativeIntegration, nativeEnvironment, authenticationHome, authenticationLock, installWorkHooks, workHookConfiguration, bindWorkHookExecution } from '../../packages/codex-integration/dist/index.js';
import { modeTools } from '../../packages/core/dist/index.js';
const { values } = parseArgs({ options: { home: { type: 'string' }, id: { type: 'string' }, work: { type: 'string' } } });
if (!values.home || !values.id || !values.work) throw new Error('Explicit fixture attachment and Work required');
const s = await engineeringSystem(path.resolve(values.home)); const native = new CodexNativeIntegration(s.store, s.registry, s.identities, s.workspaces, s.tasks);
const attachment = await native.get(values.id); const record = await s.registry.get(attachment.projectId);
if (record.kind !== 'fixture' || record.sourceSharing !== 'fixture-only') throw new Error('Fixture-only consent required');
if ((await native.hookIsolation(attachment.id)).status !== 'passed') throw new Error('HOOK_AUTH_CONTEXT_ISOLATION_BLOCKED: use a fresh dedicated managed login; legacy authentication hooks are not modified');
await s.store.locked(authenticationLock(attachment), async () => {
  let work = await s.work.get(values.work);
  if (work.projectId !== attachment.projectId || work.workspaceId !== attachment.workspaceId) throw new Error('Explicit Work scope mismatch');
  if (work.state === 'completed' || work.finalizedAt) { await s.work.resume(work.id); work = await s.work.get(work.id); }
  await installWorkHooks(native, s.work, attachment.id, work.id, true);
  const hooks = await workHookConfiguration(native, attachment.id, work.id);
  const execution = await native.executionConfiguration(attachment.id, work.taskId, modeTools('engineering', false), { hooks, skill: false });
  await bindWorkHookExecution(native, s.work, attachment.id, work.id, execution.sessionId);
  console.log('Official Codex hook trust review for the dedicated fixture. Open /hooks, inspect and trust the six Harness definitions only. No trust bypass is used. Do not submit an engineering task. Exit with /exit after review. This dedicated review window closes after 3 minutes; unanswered trust remains blocked.');
  const child = spawn(attachment.executable, ['--no-daemon', '--no-alt-screen', ...execution.args], { cwd: attachment.cwd, env: { ...nativeEnvironment(authenticationHome(attachment), attachment.home), DEVAGENT_NATIVE_SESSION: execution.sessionId }, stdio: 'inherit', windowsHide: false });
  const complete = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  const journal = native.processJournal(execution.sessionId); if (child.pid) await journal.started(child.pid);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    if (process.platform === 'win32' && child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 });
    else child.kill('SIGTERM');
  }, 180000);
  let code;
  try { code = await complete; } finally { clearTimeout(timer); }
  await journal.closed(code);
  await s.work.checkpoint(work.id);
  await s.store.put('reports/hook-trust-review-latest.json', { attachmentId: attachment.id, workId: work.id, executionSessionId: execution.sessionId, code, timedOut, trustGrantedByAutomation: false, at: new Date().toISOString() });
});
