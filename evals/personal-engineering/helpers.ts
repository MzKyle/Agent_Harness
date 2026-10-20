import { mkdir, mkdtemp, cp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { engineeringSystem } from '../../packages/adapters/src/index.js';
import { git, isWithin } from '../../packages/core/src/index.js';
import { repo } from '../helpers.js';

export async function intelligenceFixture(existing = false) {
  const base = path.join(repo, '.devagent-evals'); await mkdir(base, { recursive: true });
  const parent = await mkdtemp(path.join(base, 'intelligence-')); const source = path.join(parent, 'source');
  await cp(path.join(repo, 'fixtures/personal-engineering/fresh'), source, { recursive: true });
  if (existing) {
    await writeFile(path.join(source, 'AGENTS.md'), '# Existing project rules\n\nPreserve public APIs and retain this rule.\n');
    const skills = path.join(source, '.agents/skills/custom-debugging'); await mkdir(skills, { recursive: true });
    await writeFile(path.join(skills, 'SKILL.md'), '---\nname: custom-debugging\ndescription: Diagnose the fixture service using its existing tests.\n---\n\nUse the existing fixture checks and preserve the public API.\n');
  }
  git(source, ['init', '-b', 'fixture/dev']); git(source, ['config', 'user.name', 'Fixture']); git(source, ['config', 'user.email', 'fixture@localhost.invalid']);
  git(source, ['remote', 'add', 'origin', `https://example.invalid/${path.basename(parent)}.git`]); git(source, ['add', '--all', '--force']); git(source, ['commit', '-m', 'Isolated personal engineering fixture']);
  const system = await engineeringSystem(path.join(parent, 'state-a')); const record = await system.registry.add(source, { rules: true, fixture: true, shareFixture: true });
  const identity = await system.identities.resolve(record.id);
  return { parent, source, system, record, identity,
    cleanup: async () => { if (!isWithin(base, parent)) throw new Error('CLEANUP_SCOPE_DENIED'); await rm(parent, { recursive: true, force: true }); } };
}
