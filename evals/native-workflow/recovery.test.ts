import { afterEach, expect, it, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { intelligenceFixture } from '../personal-engineering/helpers.js';
import { WorkRecovery } from '../../packages/core/src/index.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0)) await cleanup(); });

it('separates external session completion from untested engineering changes', async () => {
  const f = await intelligenceFixture(); cleanups.push(f.cleanup); const s = f.system;
  const work = await s.work.start(f.record.id, 'Observe selected daily development');
  await writeFile(path.join(f.source, 'src/service.ts'), 'export const untested = true;\n');
  const final = await s.work.checkpoint(work.id, true);
  expect(final.state).toBe('completed'); expect(final.engineeringOutcome).toBe('incomplete'); expect(final.evidenceStatus).toBe('none');
  expect((await s.tasks.get(work.taskId)).state).toBe('succeeded'); expect(final.outcome.verified).toEqual([]);
  expect((await s.history.recent(f.record.id))[0]!.incomplete.length).toBeGreaterThan(0);
});
it('preserves analysis authority when resuming an attachment that has a read-only workspace', async () => {
  const f = await intelligenceFixture(); cleanups.push(f.cleanup); const s = f.system;
  const workspace = await s.workspaces.create(f.record.id); const task = await s.tasks.create(f.record.id, 'Read-only workspace analysis', 'analysis', workspace.id);
  const work = await s.work.start(f.record.id, 'Read-only workspace analysis', { taskId: task.id, workspaceId: workspace.id });
  await s.work.checkpoint(work.id, true); await s.work.resume(work.id);
  const resumed = await s.work.get(work.id); expect((await s.tasks.get(resumed.taskId)).mode).toBe('analysis'); expect(resumed.evidenceStatus).toBe('none');
  await expect(s.tasks.requireCoding(resumed.taskId)).rejects.toThrow('CODING_PLAN_GATE');
});

it('replays a progress journal after candidate creation and an interrupted Work write without duplicate memory', async () => {
  const f = await intelligenceFixture(); cleanups.push(f.cleanup); const s = f.system;
  const work = await s.work.start(f.record.id, 'Journal crash injection');
  const original = s.store.put.bind(s.store); let injected = false;
  const spy = vi.spyOn(s.store, 'put').mockImplementation(async (file, value) => {
    if (file === `work-sessions/${work.id}.json` && !injected) { injected = true; throw new Error('INJECTED_WRITE_INTERRUPTION'); }
    await original(file, value);
  });
  await expect(s.work.progress(work.id, ['Preserve the public API'], ['Regression pending'])).rejects.toThrow('INJECTED_WRITE_INTERRUPTION'); spy.mockRestore();
  expect(await new WorkRecovery(s.intelligence).pending(work.id)).not.toBeNull();
  await expect(s.work.checkpoint(work.id)).rejects.toThrow('WORK_RECOVERY_REQUIRED');
  const recovered = await s.work.recover(work.id); expect(recovered.permissionsRestored).toBe(false);
  const current = await s.work.get(work.id); expect(current.candidateIds).toHaveLength(2);
  const memories = Object.values((await s.intelligence.read()).memories).filter(item => item.topic.includes(work.id)); expect(memories).toHaveLength(2);
  expect(current.engineeringOutcome).not.toBe('verified');
});

it('recovers interrupted finalize and evidence-summary writes, preserves interruption on out-of-order callbacks', async () => {
  const f = await intelligenceFixture(); cleanups.push(f.cleanup); const s = f.system;
  const work = await s.work.start(f.record.id, 'Finalize replay'); const record = await s.work.get(work.id);
  await s.work.event(work.id, record.leaseId, { hook_event_name: 'Interrupt', event_id: 'interrupt' });
  await s.work.event(work.id, record.leaseId, { hook_event_name: 'SessionStart', event_id: 'late-start' });
  expect((await s.work.get(work.id)).state).toBe('interrupted');
  const spy = vi.spyOn(s.history, 'record').mockRejectedValueOnce(new Error('INJECTED_SUMMARY_INTERRUPTION'));
  await expect(s.work.checkpoint(work.id, true)).rejects.toThrow('INJECTED_SUMMARY_INTERRUPTION'); spy.mockRestore();
  expect((await s.work.recover(work.id)).status).toBe('recovered');
  expect((await s.work.get(work.id)).state).toBe('completed'); expect((await s.work.get(work.id)).engineeringOutcome).not.toBe('verified');
  expect(await s.work.checkpoint(work.id, true)).toHaveProperty('idempotent', true);
  await expect(s.work.event(work.id, record.leaseId, { hook_event_name: 'Stop' })).rejects.toThrow('WORK_EVENT_LEASE_DENIED');
});

it('does not remove a live CLI lock or restore permissions when the source revision changes', async () => {
  const f = await intelligenceFixture(); cleanups.push(f.cleanup); const s = f.system;
  const work = await s.work.start(f.record.id, 'Recover selected work');
  await s.store.locked(`work-session-${work.id}`, async () => { expect((await s.work.recover(work.id)).status).toBe('blocked'); });
  await s.work.checkpoint(work.id, true); await writeFile(path.join(f.source, 'src/service.ts'), 'export const changedAfterCrash = true;\n');
  expect(await s.work.resume(work.id)).toHaveProperty('status', 'review-required');
  expect(await s.work.resume(work.id, true)).toHaveProperty('permissionsRestored', false);
  const task = await s.tasks.get((await s.work.get(work.id)).taskId); expect(task.plan).toBeNull(); expect(task.evidenceIds).toEqual([]);
});
