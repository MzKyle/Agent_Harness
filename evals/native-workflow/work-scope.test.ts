import { afterEach, expect, it, vi } from 'vitest';
import { intelligenceFixture } from '../personal-engineering/helpers.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0)) await cleanup(); });
it('validates signed headers globally but rechecks source and evidence only for the selected project', async () => {
  const a = await intelligenceFixture(); const b = await intelligenceFixture(); cleanups.push(a.cleanup, b.cleanup);
  const s = a.system; const projectB = await s.registry.add(b.source, { fixture: true, rules: true });
  const first = await s.work.start(a.record.id, 'Selected fixture work'); const other = await s.work.start(projectB.id, 'Unrelated fixture work');
  const reads = vi.spyOn(s.work, 'get');
  expect((await s.work.list(a.record.id)).map(item => item.id)).toEqual([first.id]);
  expect(reads.mock.calls.every(([id]) => id === first.id)).toBe(true);
  const file = `work-sessions/${other.id}.json`; const envelope = await s.store.get<{ payload: { goal: string }; signature: string }>(file);
  envelope.payload.goal = 'Tampered unrelated metadata must still be detected'; await s.store.put(file, envelope);
  await expect(s.work.list(a.record.id)).rejects.toThrow('INTELLIGENCE_INTEGRITY_FAILED');
});
