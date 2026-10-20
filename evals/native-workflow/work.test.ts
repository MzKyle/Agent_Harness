import { afterEach, expect, it } from 'vitest';
import { writeFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { intelligenceFixture } from '../personal-engineering/helpers.js';
import { CodexNativeIntegration, installWorkHooks } from '../../packages/codex-integration/src/index.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

it('captures only explicitly scoped metadata, rejects forged leases/tasks and deduplicates hook replay', async () => {
  const f = await intelligenceFixture(); cleanups.push(f.cleanup); const s = f.system;
  const started = await s.work.start(f.record.id, 'Investigate worker timeout'); const work = await s.work.get(started.id);
  const raw = { hook_event_name: 'PostToolUse', session_id: 'session-fixture', turn_id: 'turn-1', tool_name: 'read_code_slice', event_id: 'call-1', prompt: 'password: synthetic-secret', tool_input: { command: 'private command' }, tool_response: 'private output' };
  await expect(s.work.event(work.id, 'forged', raw)).rejects.toThrow('WORK_EVENT_LEASE_DENIED');
  await expect(s.work.event(work.id, work.leaseId, { ...raw, task_id: 'task-forged' })).rejects.toThrow('WORK_EVENT_SCOPE_DENIED');
  expect((await s.work.event(work.id, work.leaseId, raw)).duplicate).toBe(false);
  expect((await s.work.event(work.id, work.leaseId, raw)).duplicate).toBe(true);
  const events = await s.work.events(work.id); expect(events).toHaveLength(1);
  expect(JSON.stringify(events)).not.toMatch(/synthetic-secret|private command|private output|tool_input|prompt/);
  expect(events[0]?.authority).toBe('observation-only');
  await s.work.event(work.id, work.leaseId, { hook_event_name: 'Interrupt', event_id: 'interruption-1' });
  expect((await s.work.get(work.id)).state).toBe('interrupted');
  expect((await s.work.get(work.id)).outcome.verified).toEqual([]);
});

it('checks actual Git/content, finalizes idempotently, labels candidates and resumes with no restored evidence', async () => {
  const f = await intelligenceFixture(); cleanups.push(f.cleanup); const s = f.system;
  const work = await s.work.start(f.record.id, 'Continue the runtime fix');
  await writeFile(path.join(f.source, 'src/service.ts'), 'export function total(a: number, b: number) { return a - b; }\n');
  await s.work.progress(work.id, ['Keep the public service API'], ['Independent runtime regression remains pending']);
  const result = await s.work.checkpoint(work.id, true);
  expect(result.outcome.changed).toContain('src/service.ts'); expect(result.outcome.verified).toEqual([]);
  expect(await s.work.checkpoint(work.id, true)).toHaveProperty('idempotent', true);
  const record = await s.work.get(work.id); expect((await s.memory.get(record.candidateIds[0]!)).confirmation).toBe('candidate');
  const brief = await s.context.brief(f.record.id, 'runtime', 6000);
  expect(brief.text).toContain('Independent runtime regression'); expect(brief.text).toContain('unreviewed');
  await writeFile(path.join(f.source, 'src/service.ts'), 'export const changedAgain = true;\n');
  expect((await s.work.resume(work.id)).status).toBe('review-required');
  const resumed = await s.work.resume(work.id, true); expect(resumed.permissionsRestored).toBe(false);
  expect((await s.work.get(work.id)).taskId).not.toBe(record.taskId);
  expect((await s.work.get(work.id)).outcome.verified).toEqual([]);
  await expect(s.work.event(work.id, record.leaseId, { hook_event_name: 'Stop' })).rejects.toThrow('WORK_EVENT_LEASE_DENIED');
});

it('does not promote a managed change without final evidence, and rejects forged session state', async () => {
  const f = await intelligenceFixture(); cleanups.push(f.cleanup); const s = f.system;
  const workspace = await s.workspaces.create(f.record.id);
  const work = await s.work.start(f.record.id, 'Verify a managed change', { workspaceId: workspace.id });
  const result = await s.work.checkpoint(work.id, true); expect(result.outcome.verified).toEqual([]);
  expect((await s.tasks.get(work.taskId)).state).toBe('failed');
  const envelope = await s.store.get<{ payload: { state: string }; signature: string }>(`work-sessions/${work.id}.json`);
  envelope.payload.state = 'active'; await s.store.put(`work-sessions/${work.id}.json`, envelope);
  await expect(s.work.get(work.id)).rejects.toThrow('INTELLIGENCE_INTEGRITY_FAILED');
});

it('resolves explicit pending items and deletes Work records without deleting independent execution audit', async () => {
  const f = await intelligenceFixture(); cleanups.push(f.cleanup); const s = f.system;
  const work = await s.work.start(f.record.id, 'Explicitly selected external engineering work');
  await s.work.progress(work.id, ['Preserve public API'], ['Run independent regression']);
  await s.work.progress(work.id, [], [], ['Run independent regression']);
  expect((await s.work.get(work.id)).outstanding).toEqual([]);
  await s.work.checkpoint(work.id, true); const taskId = work.taskId;
  expect((await s.work.delete(work.id)).deleted).toBe(true);
  await expect(s.work.get(work.id)).rejects.toThrow();
  expect((await s.tasks.get(taskId)).id).toBe(taskId);
  expect((await s.history.recent(f.record.id)).some(item => item.taskId === taskId)).toBe(false);
});

it('independently validates actual source integrity and rejects a forged validation baseline', async () => {
  const f = await intelligenceFixture(); cleanups.push(f.cleanup); const s = f.system;
  const work = await s.work.start(f.record.id, 'Validate source integrity'); await s.validator.begin(work.taskId);
  await writeFile(path.join(f.source, 'src/service.ts'), 'export const actualSourceChanged = true;\n');
  const report = await s.validator.validate(work.taskId); expect(report.machine.sourceUnchanged).toBe(false); expect(report.status).toBe('failed'); expect(report.machine.finalRevisionApprovedCommands).toBe(false);
  const file = `validation-baselines/${work.taskId}.json`; const baseline = await s.store.get<{ payload: { root: string } }>(file); baseline.payload.root = f.parent; await s.store.put(file, baseline);
  await expect(s.validator.validate(work.taskId)).rejects.toThrow('INTELLIGENCE_INTEGRITY_FAILED');
});

it('does not overwrite pre-existing or manually changed hooks and only installs into a matching managed Work', async () => {
  const f = await intelligenceFixture(); cleanups.push(f.cleanup); const s = f.system;
  const native = new CodexNativeIntegration(s.store, s.registry, s.identities, s.workspaces, s.tasks); const attachment = await native.attach(f.identity.stableProjectId);
  const work = await s.work.start(f.record.id, 'Explicit native hook configuration', { taskId: attachment.taskId, workspaceId: attachment.workspaceId });
  const file = path.join(attachment.home, 'hooks.json'); await writeFile(file, '{"description":"existing user hooks"}');
  await expect(installWorkHooks(native, s.work, attachment.id, work.id)).rejects.toThrow('HOOK_CONFIG_CONFLICT');
  expect(await readFile(file, 'utf8')).toContain('existing user hooks'); await unlink(file);
  expect((await installWorkHooks(native, s.work, attachment.id, work.id)).observed).toBe(false);
  await writeFile(file, '{"description":"manual modification"}');
  await expect(installWorkHooks(native, s.work, attachment.id, work.id)).rejects.toThrow('HOOK_CONFIG_CONFLICT');
});
