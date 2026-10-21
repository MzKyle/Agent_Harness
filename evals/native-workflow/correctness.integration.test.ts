import { afterEach, expect, it } from 'vitest';
import { intelligenceFixture } from '../personal-engineering/helpers.js';
import { configureIsolation, staticPlan } from '../../packages/core/src/index.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

it('retains actual failed execution, verifies the final revision, invalidates old passes and reconciles evidence after an index crash', async () => {
  const f = await intelligenceFixture(); cleanups.push(f.cleanup); const s = f.system;
  await configureIsolation(s.store, 'node:24-bookworm-slim'); const workspace = await s.workspaces.create(f.record.id);
  await s.store.put(`graders/${workspace.id}/independent.mjs`, "import assert from'node:assert/strict';import{fixed}from'/workspace/src/fix.ts';assert.equal(fixed,true);\n");
  await s.execution.approve(workspace.id, { id: 'independent', executable: 'node', args: ['--test', '/grader/independent.mjs'] });
  const work = await s.work.start(f.record.id, 'Verify current evidence and failure history', { workspaceId: workspace.id });
  const plan = await staticPlan(s.tasks, s.code, f.record.id, 'Preserve fixture public APIs and verify final change', ['total']);
  await s.tasks.submitPlan(work.taskId, plan.plan);
  expect((await s.tasks.runApproved(work.taskId, 'independent')).status).toBe('failed');
  await s.workspaces.write(workspace.id, 'src/fix.ts', 'export const fixed = true;\n');
  // Real execution succeeds but its Task evidence index write is lost, as in a process crash.
  const evidence = await s.execution.run(workspace.id, 'independent', work.taskId); expect(evidence.status).toBe('passed');
  expect((await s.tasks.get(work.taskId)).evidenceIds).not.toContain(evidence.id);
  const final = await s.work.checkpoint(work.id, true);
  expect(final.engineeringOutcome).toBe('verified'); expect(final.evidenceStatus).toBe('valid');
  expect(final.outcome.failed).toContain('independent'); expect(final.lastVerifiedRevision).toBe(evidence.workspaceRevision);
  expect((await s.tasks.get(work.taskId)).evidenceIds).toContain(evidence.id);
  expect(await s.execution.evidence.archive(work.taskId)).toHaveProperty('status', 'preview');
  expect(await s.execution.evidence.archive(work.taskId, true)).toHaveProperty('status', 'archived');
  expect((await s.execution.evidence.get(evidence.id)).status).toBe('passed'); expect((await s.work.get(work.id)).evidenceStatus).toBe('valid');
  await s.workspaces.write(workspace.id, 'src/fix.ts', 'export const fixed = false;\n');
  const stale = await s.work.get(work.id); expect(stale.evidenceStatus).toBe('stale'); expect(stale.engineeringOutcome).toBe('incomplete'); expect(stale.outcome.verified).toEqual([]);
  expect(await s.work.resume(work.id)).toHaveProperty('status', 'review-required');
  await s.work.resume(work.id, true); const resumed = await s.work.get(work.id);
  expect(resumed.engineeringOutcome).toBe('incomplete'); expect((await s.tasks.get(resumed.taskId)).evidenceIds).toEqual([]);
  await expect(s.tasks.runApproved(resumed.taskId, 'independent')).rejects.toThrow('CODING_PLAN_GATE');
});
