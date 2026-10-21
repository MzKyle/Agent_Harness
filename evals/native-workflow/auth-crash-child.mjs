import process from 'node:process';
import { engineeringSystem } from '../../packages/adapters/dist/index.js';
import { CodexNativeIntegration, authenticationLock } from '../../packages/codex-integration/dist/index.js';
import { nativeExec } from '../../packages/codex-integration/dist/events.js';
const [home, id] = process.argv.slice(2); const s = await engineeringSystem(home);
const native = new CodexNativeIntegration(s.store, s.registry, s.identities, s.workspaces, s.tasks); const attachment = await native.get(id);
await s.store.locked(authenticationLock(attachment), async () => {
  const execution = await native.executionConfiguration(id, attachment.taskId, []); const journal = native.processJournal(execution.sessionId);
  // Real owned Node process stands in for a native child only in this crash-mechanics test. No model result is claimed.
  await nativeExec(process.execPath, ['-e', 'setInterval(()=>{},1000)'], attachment.cwd, { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot }, 30000, {
    started: async pid => { await journal.started(pid); process.stdout.write(`CHILD_JOURNALED ${pid}\n`); }, closed: journal.closed,
  });
});
