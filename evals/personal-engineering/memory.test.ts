import { afterEach, expect, it } from 'vitest';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { git, type MemoryInput } from '../../packages/core/src/index.js';
import { intelligenceFixture } from './helpers.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map(run => run())); });

it('persists explicit preferences, reviews candidates without inventing verification, deduplicates, versions and deletes history', async () => {
  const f = await intelligenceFixture(); cleanups.push(f.cleanup);
  const input = { domain: 'developer' as const, type: 'engineering-preference' as const, topic: 'C++ standard', content: 'Use C++17 for device code', tags: ['C++'] };
  const set = await f.system.memory.set(input); expect(set.record.source).toBe('explicit'); expect(set.record.confirmation).toBe('confirmed');
  const duplicate = await f.system.memory.set(input); expect(duplicate.duplicate).toBe(true); expect(duplicate.record.id).toBe(set.record.id);
  const candidate = await f.system.memory.propose({ ...input, content: 'Prefer C++20 for new non-device modules' });
  expect(candidate.record.confirmation).toBe('candidate'); expect((await f.system.memory.search({ domain: 'developer' })).records).toHaveLength(1);
  await f.system.memory.review(candidate.record.id, 'confirm'); const reviewed = await f.system.memory.get(candidate.record.id);
  expect(reviewed.source).toBe('inferred'); expect(reviewed.confirmation).toBe('confirmed'); expect((await f.system.memory.get(set.record.id)).deprecated).toBe(true);
  const updated = await f.system.memory.set({ ...input, content: 'Use C++17 in existing modules' }); expect(updated.record.id).toBe(candidate.record.id); expect(updated.record.history.length).toBeGreaterThan(0);
  expect((await f.system.memory.search({ domain: 'developer', query: 'C++' })).records[0]?.content).toContain('C++17');
  await f.system.memory.delete(candidate.record.id); await expect(f.system.memory.history(candidate.record.id)).rejects.toThrow('MEMORY_NOT_FOUND');
  expect((await f.system.intelligence.read()).memories[candidate.record.id]).toBeUndefined();
});

it('refuses forged provenance, sensitive memory and on-disk promotion without a valid signature', async () => {
  const f = await intelligenceFixture(); cleanups.push(f.cleanup);
  const input = { domain: 'developer', type: 'engineering-preference', topic: 'forged', content: 'Claim verified', source: 'verified', confirmation: 'confirmed' };
  await expect(f.system.memory.propose(input as unknown as MemoryInput)).rejects.toThrow();
  await expect(f.system.memory.set({ domain: 'developer', type: 'ai-preference', topic: 'unsafe', content: 'password: synthetic-must-refuse' })).rejects.toThrow('SENSITIVE_MEMORY_REFUSED');
  const record = await f.system.memory.propose({ domain: 'developer', type: 'ai-preference', topic: 'review', content: 'Ask before changing permissions' });
  const envelope = await f.system.store.get<{ payload: { memories: Record<string, { confirmation: string }> }; signature: string }>('intelligence/portable.json');
  envelope.payload.memories[record.record.id]!.confirmation = 'confirmed'; await f.system.store.put('intelligence/portable.json', envelope);
  await expect(f.system.intelligence.read()).rejects.toThrow('INTELLIGENCE_INTEGRITY_FAILED');
});

it('isolates project memory and produces a task-relevant bounded brief with safety retained', async () => {
  const f = await intelligenceFixture(); const second = await intelligenceFixture(); cleanups.push(f.cleanup, second.cleanup);
  const b = await f.system.registry.add(second.source, { rules: true, fixture: true, shareFixture: true });
  await f.system.memory.set({ domain: 'project', projectId: f.record.id, type: 'constraint', topic: 'trace evidence', content: 'Keep trace identifiers and verify service output' });
  await f.system.memory.set({ domain: 'project', projectId: f.record.id, type: 'constraint', topic: 'Compatibility', content: 'Preserve public APIs for downstream clients' });
  await f.system.memory.set({ domain: 'project', projectId: b.id, type: 'constraint', topic: 'trace private B', content: 'Private-B-scope-only' });
  await f.system.memory.propose({ domain: 'developer', type: 'ai-preference', topic: 'unreviewed autonomy', content: 'Unconfirmed candidate must stay out of the brief' });
  await f.system.memory.set({ domain: 'developer', type: 'engineering-preference', topic: 'testing', content: 'Use independent tests for trace diagnostics' });
  const brief = await f.system.context.brief(f.identity.stableProjectId, 'trace', 4000);
  expect(brief.text).toContain('Source is read-only'); expect(brief.text).toContain('Keep trace identifiers'); expect(brief.text).not.toContain('Private-B-scope-only'); expect(brief.text).not.toContain('Unconfirmed candidate');
  expect(brief.text).toContain('Preserve public APIs');
  const small = await f.system.context.brief(f.record.id, 'trace', 1024); expect(small.text.length).toBeLessThanOrEqual(1024); expect(small.text).toContain('Production/hardware access is forbidden'); expect(small.truncated).toBe(true);
});

it('refreshes actual source/config facts, marks history stale and retains explicit design decisions', async () => {
  const f = await intelligenceFixture(); cleanups.push(f.cleanup);
  const first = await f.system.profiles.get(f.record.id);
  const decision = await f.system.memory.set({ domain: 'project', projectId: f.record.id, type: 'decision', topic: 'Architecture choice', content: 'Keep application logic separate from presentation' });
  await writeFile(path.join(f.source, 'pyproject.toml'), '[project]\nname="fixture-api"\nversion="0.1.0"\ndependencies=["fastapi"]\n');
  await writeFile(path.join(f.source, 'src/new_api.py'), 'class NewApi:\n    pass\n');
  git(f.source, ['add', '--all']); git(f.source, ['commit', '-m', 'Actual fixture architecture change']);
  expect((await f.system.profiles.get(f.record.id)).stale).toBe(true);
  const refreshed = await f.system.profiles.refresh(f.record.id); expect(refreshed.profile.revision).not.toBe(first.profile.revision);
  expect(refreshed.profile.stack.components.some(component => component.frameworks.includes('FastAPI'))).toBe(true);
  expect(refreshed.profile.history.some(fact => fact.status === 'stale')).toBe(true);
  expect((await f.system.memory.get(decision.record.id)).deprecated).toBe(false);
  const repeat = await f.system.profiles.refresh(f.record.id); expect(repeat.differences).toHaveLength(0); expect(repeat.profile.generation).toBe(refreshed.profile.generation);
  expect(await readFile(path.join(f.source, 'src/service.ts'), 'utf8')).toContain('total');
});
