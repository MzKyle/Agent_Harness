import { afterEach, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fixture, repo } from './helpers.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map((cleanup) => cleanup())); });
const bin = path.join(repo, 'apps/cli/dist/main.js');
it('runs the built CLI through onboarding, inspect, and non-overwrite failure', async () => {
  const { root, cleanup } = await fixture('als-like'); cleanups.push(cleanup);
  const run = (...args: string[]) => JSON.parse(execFileSync(process.execPath, [bin, ...args], { encoding: 'utf8' }));
  expect(run('init', '--path', root, '--dry-run').status).toBe('dry-run');
  expect(run('init', '--path', root).status).toBe('created');
  expect(run('inspect', '--path', root).projectId).toMatch(/^project-/);
  const duplicate = spawnSync(process.execPath, [bin, 'init', '--path', root], { encoding: 'utf8' });
  expect(duplicate.status).toBe(1); expect(JSON.parse(duplicate.stderr).code).toBe('CONFIG_EXISTS');
});
it('returns safe structured CLI errors and does not execute arbitrary input', () => {
  const result = spawnSync(process.execPath, [bin, 'exec', '--task', 'echo TOKEN=secret'], { encoding: 'utf8' });
  expect(result.status).toBe(1); expect(result.stderr).not.toContain('TOKEN');
});
it('doctor detects Node, npm, Git, and the pinned DSH without reading credentials', () => {
  const output = JSON.parse(execFileSync(process.execPath, [bin, 'doctor'], { encoding: 'utf8' }));
  for (const name of ['node', 'npm', 'git', 'dsh']) {
    expect(output.tools.find((tool: { tool: string }) => tool.tool === name).status).toBe('available');
  }
  expect(output.integrations.modelCall).toBe('not-verified');
});
