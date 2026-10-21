import { parseArgs } from 'node:util';
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import console from 'node:console';
import { engineeringSystem } from '../../packages/adapters/dist/index.js';
import { CodexNativeIntegration, runNativeWork, installWorkHooks, inspectWorkHooks } from '../../packages/codex-integration/dist/index.js';
import { git, revision } from '../../packages/core/dist/index.js';
const repo = fileURLToPath(new URL('../../', import.meta.url));
const { values } = parseArgs({ options: { home: { type: 'string' }, 'auth-attachment': { type: 'string' }, id: { type: 'string' }, work: { type: 'string' } } });
if (!values.home || !values.id && !values['auth-attachment'] || values.id && !values.work) throw new Error('Explicit authorized fixture state and authentication reference, or existing fixture attachment and Work required');
const s = await engineeringSystem(path.resolve(values.home)); const native = new CodexNativeIntegration(s.store, s.registry, s.identities, s.workspaces, s.tasks);
const run = `hooks-v041-${Date.now()}`;
let attachment; let work;
if (values.id) {
  attachment = await native.get(values.id); const record = await s.registry.get(attachment.projectId);
  if (record.kind !== 'fixture' || record.sourceSharing !== 'fixture-only') throw new Error('Fixture-only consent required');
  work = await s.work.get(values.work);
  if (work.projectId !== attachment.projectId || work.workspaceId !== attachment.workspaceId) throw new Error('Explicit Work scope mismatch');
  if (work.state === 'completed' || work.finalizedAt) { await s.work.resume(work.id); work = await s.work.get(work.id); }
} else {
const source = path.join(repo, '.devagent-evals', run, 'source'); await mkdir(source, { recursive: true });
await cp(path.join(repo, 'fixtures/personal-engineering/fresh'), source, { recursive: true });
git(source, ['init', '-b', 'fixture/dev']); git(source, ['config', 'user.name', 'Fixture']); git(source, ['config', 'user.email', 'fixture@localhost.invalid']); git(source, ['add', '--all']); git(source, ['commit', '-m', 'Explicit hook diagnostic fixture']);
const record = await s.registry.add(source, { fixture: true, shareFixture: true, rules: true });
attachment = await native.attach(record.id, { authFrom: values['auth-attachment'] });
work = await s.work.start(record.id, 'Official native hook lifecycle diagnostic', { taskId: attachment.taskId, workspaceId: attachment.workspaceId });
}
await installWorkHooks(native, s.work, attachment.id, work.id, true);
const discovery = await inspectWorkHooks(native, s.work, attachment.id);
const result = discovery.isolation.status === 'blocked' ? { status: 'blocked', reason: 'HOOK_AUTH_CONTEXT_ISOLATION_BLOCKED', nativeSessionAttempted: false, executionSessionId: null } : await runNativeWork(native, s.work, attachment.id, 'Use the scoped source query to inspect src/service.ts; do not edit or execute. Finish with a brief diagnosis.', { workId: work.id, hooks: true });
if (result.status === 'blocked') { const task = await s.tasks.get(work.taskId); task.state = 'blocked'; task.reason = result.reason; task.finishedAt = new Date().toISOString(); await s.tasks.save(task); await s.work.checkpoint(work.id, true); }
const events = (await s.work.events(work.id)).filter(event => event.source === 'hook' && event.executionSessionId === result.executionSessionId);
const report = { run, harnessRevision: revision(repo), attachmentId: attachment.id, workId: work.id, native: result, discovery,
  lifecycle: ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'SessionEnd', 'Interrupt'].map(name => ({ event: name, status: events.some(event => event.name === name) ? 'passed' : discovery.isolation.status === 'blocked' || discovery.configured.some(hook => hook.event === name && ['untrusted', 'modified'].includes(hook.trustStatus)) ? 'blocked' : 'unobserved', supportedBy: 'CLI 0.157.1 official hook discovery', callbacks: events.filter(event => event.name === name).map(event => ({ id: event.id, threadId: event.threadId, turnId: event.turnId, source: event.source, at: event.at })), reason: discovery.isolation.reason ?? 'Trust review required when untrusted; Interrupt requires an interrupted turn; SessionEnd depends on actual close lifecycle' })),
  dangerousTrustBypassUsed: false, rawChatSaved: false };
await s.store.put(`reports/${run}.json`, report); await s.store.put('reports/hooks-v041-latest.json', report);
console.log(JSON.stringify({ run, attachmentId: attachment.id, workId: work.id, lifecycle: report.lifecycle.map(item => ({ event: item.event, status: item.status })), discovery: discovery.status }));
