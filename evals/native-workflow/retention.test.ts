import { afterEach, expect, it, vi } from 'vitest';
import { intelligenceFixture } from '../personal-engineering/helpers.js';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { digest, writeMcpReceipt, readMcpReceipts, HarnessError } from '../../packages/core/src/index.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0)) await cleanup(); });
it('refuses progress overflow before mutation instead of losing unresolved work, and leaves other Work usable', async () => {
  const f = await intelligenceFixture(); cleanups.push(f.cleanup); const s = f.system;
  const work = await s.work.start(f.record.id, 'Keep unresolved progress at its explicit capacity');
  const pending = Array.from({ length: 20 }, (_, i) => `Unresolved fixture item ${i}`);
  await s.work.progress(work.id, [], pending); const before = await s.work.get(work.id);
  await expect(s.work.progress(work.id, [], ['New unresolved item'])).rejects.toThrow('WORK_PROGRESS_CAPACITY_REVIEW_REQUIRED');
  const rejected = await s.work.get(work.id); expect(rejected.outstanding).toEqual(pending); expect(rejected.candidateIds).toEqual(before.candidateIds);
  await s.work.progress(work.id, [], ['New unresolved item'], [pending[0]!]);
  const replaced = await s.work.get(work.id); expect(replaced.outstanding).toHaveLength(20); expect(replaced.outstanding).toContain('New unresolved item'); expect(replaced.outstanding).not.toContain(pending[0]);
  await s.work.progress(work.id, Array.from({ length: 20 }, (_, i) => `Decision ${i}`));
  await expect(s.work.progress(work.id, ['Additional decision'])).rejects.toThrow('WORK_PROGRESS_CAPACITY_REVIEW_REQUIRED');
  const next = await s.work.start(f.record.id, 'New Work remains available after another Work reaches capacity');
  expect((await s.work.progress(next.id, ['Additional decision'])).decisions).toEqual(['Additional decision']);
}, 30000);
it('archives MCP overflow without losing signed audit records', async () => {
  const f = await intelligenceFixture(); cleanups.push(f.cleanup); const s = f.system;
  const work = await s.work.start(f.record.id, 'Bounded audit retention');
  for (let i = 0; i < 205; i++) await writeMcpReceipt(s.store, { tool: 'read_code_slice', taskId: work.taskId, projectId: f.identity.stableProjectId, queryHash: digest(String(i)), status: 'completed' }, work.taskId);
  const receipts = await readMcpReceipts<{ signature: string; taskId: string }>(s.store, work.taskId); expect(receipts).toHaveLength(205);
  for (const { signature, ...payload } of receipts) expect(await s.store.verify(payload, signature)).toBe(true);
}, 30000);
it('archives only explicitly reviewed history and removes deleted candidate references from archived Work', async () => {
  const f = await intelligenceFixture(); cleanups.push(f.cleanup); const s = f.system;
  const work = await s.work.start(f.record.id, 'Archive daily history'); await s.work.progress(work.id, ['Keep public API']);
  const id = (await s.work.get(work.id)).candidateIds[0]!; await s.work.checkpoint(work.id, true);
  await s.work.archive(work.id); expect((await s.work.list(f.record.id))).toHaveLength(0);
  await s.memory.delete(id); expect((await s.work.get(work.id)).candidateIds).not.toContain(id);
  const review = await s.intelligence.archiveHistory('2099-01-01T00:00:00Z'); expect(review.status).toBe('preview'); expect(review.counts.summaries).toBe(1);
  await expect(s.intelligence.archiveHistory('2099-01-01T00:00:00Z', 'forged')).rejects.toThrow('ARCHIVE_REVIEW_STALE');
  expect(await s.intelligence.archiveHistory('2099-01-01T00:00:00Z', review.archiveDigest)).toHaveProperty('status', 'archived');
  expect((await s.intelligence.read()).summaries).toEqual({}); expect((await s.history.recent(f.record.id))).toHaveLength(1);
  await s.work.delete(work.id); expect((await s.history.recent(f.record.id))).toHaveLength(0);
  await s.tasks.report(work.taskId); expect((await s.history.recent(f.record.id))).toHaveLength(0);
});
it('retains concurrent refusal audits without turning safe read denials into mutation conflicts', async () => {
  const f = await intelligenceFixture(); cleanups.push(f.cleanup);
  const results = await Promise.all(Array.from({ length: 8 }, () => f.system.store.denial({ code: 'UNAUTHORIZED_PROJECT', tool: 'read_code_slice' })));
  expect(new Set(results).size).toBe(8); expect((await f.system.store.list('artifacts/denials'))).toHaveLength(8);
});
it('retains real Work progress when candidate storage is full and reports deferred memory', async () => {
  const f = await intelligenceFixture(); cleanups.push(f.cleanup); const s = f.system;
  const work = await s.work.start(f.record.id, 'Continue with a full knowledge index');
  vi.spyOn(s.memory, 'propose').mockRejectedValue(new HarnessError('INTELLIGENCE_RETENTION_LIMIT'));
  const progress = await s.work.progress(work.id, ['Retain the actual public API decision']);
  expect(progress.candidateRetentionDeferred).toBe(true); expect(progress.decisions).toContain('Retain the actual public API decision');
  expect((await s.work.get(work.id)).candidateIds).toEqual([]); expect((await s.work.get(work.id)).engineeringOutcome).not.toBe('verified');
});
it('keeps signed task summaries readable when the portable index cannot accept a report', async () => {
  const f = await intelligenceFixture(); cleanups.push(f.cleanup); const s = f.system;
  const work = await s.work.start(f.record.id, 'Retain a report despite portable capacity');
  vi.spyOn(s.intelligence, 'edit').mockRejectedValue(new HarnessError('INTELLIGENCE_RETENTION_LIMIT'));
  await s.work.checkpoint(work.id, true);
  const recent = await s.history.recent(f.record.id); expect(recent[0]!.taskId).toBe(work.taskId); expect(recent[0]!.verified).toEqual([]);
});
it('preserves old profile facts in a signed local archive instead of blocking refresh at its history window', async () => {
  const f = await intelligenceFixture(); cleanups.push(f.cleanup); const s = f.system;
  await s.intelligence.edit(data => { const profile = data.profiles[f.identity.stableProjectId]!; profile.history = Array.from({ length: 500 }, () => ({ ...profile.facts[0]!, status: 'stale' as const })); });
  await writeFile(path.join(f.source, 'README.md'), '# Fixture\n\nA changed synthetic purpose for profile history retention.\n');
  const refreshed = await s.profiles.refresh(f.record.id); expect(refreshed.profile.history.length).toBeLessThanOrEqual(500);
  expect(refreshed.archiveArtifact).toMatch(/^profile-history\//);
  const archive = await s.store.get<{ payload: { projectId: string; facts: unknown[] }; signature: string }>(refreshed.archiveArtifact!);
  expect(archive.payload.projectId).toBe(f.identity.stableProjectId); expect(archive.payload.facts.length).toBeGreaterThan(0);
});
