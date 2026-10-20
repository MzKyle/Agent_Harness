import { afterEach, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { intelligenceFixture } from './helpers.js';
import { repo } from '../helpers.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
const executable = path.join(repo, 'apps/cli/dist/main.js');

it('the real CLI reviews, versions, exports and deletes profiles and requires an explicit encrypted-restore preview', async () => {
  const f = await intelligenceFixture(); cleanups.push(f.cleanup); const home = f.system.store.root;
  const cli = (args: string[], state = home) => JSON.parse(execFileSync(process.execPath, [executable, ...args, '--home', state], { cwd: repo, encoding: 'utf8', timeout: 15000, windowsHide: true, env: { ...process.env, DEVAGENT_EVAL_PASSPHRASE: 'synthetic-cli-acceptance-passphrase' } })) as Record<string, unknown>;
  const created = cli(['profile', 'propose', '--type', 'engineering-preference', '--topic', 'CLI evidence', '--content', 'Use actual verification evidence.']) as { record: { id: string; confirmation: string } };
  expect(created.record.confirmation).toBe('candidate'); expect(cli(['profile', 'show']).records).toEqual([]);
  const reviewed = cli(['profile', 'review', '--id', created.record.id, '--decision', 'confirm']); expect(reviewed.source).toBe('inferred'); expect(reviewed.confirmation).toBe('confirmed');
  const shown = cli(['profile', 'show', '--id', created.record.id]); expect(shown.id).toBe(created.record.id);
  cli(['profile', 'set', '--type', 'engineering-preference', '--topic', 'CLI evidence', '--content', 'Preserve final revision evidence.']);
  expect((cli(['profile', 'history', '--id', created.record.id]).versions as unknown[]).length).toBeGreaterThan(0);
  const exported = cli(['profile', 'export']); const records = JSON.parse(await readFile(f.system.store.resolve(String(exported.artifact)), 'utf8')) as { id: string }[]; expect(records.some(item => item.id === created.record.id)).toBe(true);
  const backup = cli(['backup', 'create', '--passphrase-env', 'DEVAGENT_EVAL_PASSPHRASE']); expect(backup.encrypted).toBe(true);
  const homeB = path.join(f.parent, 'cli-state-b'); const preview = cli(['backup', 'restore', '--file', String(backup.file), '--passphrase-env', 'DEVAGENT_EVAL_PASSPHRASE'], homeB) as { review: { id: string } };
  expect(preview.review.id).toMatch(/^restore-/); expect(cli(['profile', 'show'], homeB).records).toEqual([]);
  const restored = cli(['backup', 'restore', '--file', String(backup.file), '--passphrase-env', 'DEVAGENT_EVAL_PASSPHRASE', '--review', preview.review.id], homeB); expect(restored.permissionsRestored).toBe(false);
  expect(cli(['profile', 'show', '--id', created.record.id], homeB).trust).toBe('imported');
  cli(['profile', 'delete', '--id', created.record.id]); expect(cli(['profile', 'show']).records).toEqual([]);
});

it('refuses to put synthetic E2E preferences into an occupied personal state', async () => {
  const f = await intelligenceFixture(); cleanups.push(f.cleanup); const before = await f.system.intelligence.read();
  const result = spawnSync(process.execPath, [executable, 'eval', '--suite', 'personal-engineering', '--home', f.system.store.root], { cwd: repo, encoding: 'utf8', timeout: 15000, windowsHide: true });
  expect(result.status).toBe(1); expect(result.stderr).toContain('EVAL_REQUIRES_FRESH_STATE'); expect(await f.system.intelligence.read()).toEqual(before);
});
