import { afterEach, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parse } from 'yaml';
import { EngineeringDetector } from '../packages/adapters/src/index.js';
import { initializeProject, ProjectRegistry } from '../packages/core/src/index.js';
import { dshBin, DshRuntimeAdapter, launchDsh, officialPackage } from '../packages/dsh-bridge/src/index.js';
import { fixture, repo } from './helpers.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map((cleanup) => cleanup())); });
it('composes an isolated official DSH profile and calls our MCP through its real client', async () => {
  const { root, parent, cleanup } = await fixture('als-like'); cleanups.push(cleanup);
  await initializeProject(root, new EngineeringDetector());
  const home = path.join(parent, 'runtime');
  const prepared = await new DshRuntimeAdapter().prepare({ projectRoot: root, outputDirectory: home });
  const optional = parse(await readFile(prepared.codexPatch, 'utf8'));
  expect(path.isAbsolute(optional[0].insert[0].name)).toBe(true);
  expect(() => launchDsh(home, parent, ['--dump-config'])).toThrow('ACCESS_DENIED');
  await expect(new DshRuntimeAdapter().prepare({ projectRoot: root, outputDirectory: home })).rejects.toMatchObject({ code: 'CONFIG_EXISTS' });
  const dump = execFileSync(process.execPath, [dshBin, '--profile', 'devagent', '--dump-config'], {
    cwd: root, env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' }, encoding: 'utf8', timeout: 30000,
  });
  const config = parse(dump, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }] });
  const rows = Array.isArray(config) ? config : config.plugins;
  expect(rows.find((row: { id: string }) => row.id === 'devagent-mcp')).toBeDefined();
  for (const id of ['tool-bash', 'tool-pwsh', 'tool-fs', 'tool-web', 'tool-working-directory', 'tool-subagent']) {
    expect(rows.find((row: { id: string }) => row.id === id).disabled).toBe(true);
  }
  const patch = path.join(parent, 'eval.patch.yml');
  await writeFile(patch, '- id: headless-startup\n  disabled: true\n- id: headless-runner\n  disabled: true\n');
  const output = path.join(parent, 'probe.json');
  const registry = await ProjectRegistry.create([root]);
  execFileSync(process.execPath, [path.join(repo, 'evals/dsh-probe.mjs'), home, patch, output, registry.list()[0]!.projectId], {
    cwd: root, env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' }, encoding: 'utf8', timeout: 40000,
  });
  const probe = JSON.parse(await readFile(output, 'utf8'));
  expect(probe.names).toContain('mcp__devagent__get_project_context');
  expect(probe.skills).toEqual(expect.arrayContaining(['feature-planning', 'observability-design', 'project-onboarding']));
  expect(JSON.stringify(probe.result)).toContain('FastAPI');
  expect(JSON.stringify(probe.result)).not.toContain('PROJECT_READ_FAILED');
  for (const forbidden of ['bash', 'pwsh', 'read', 'write', 'edit', 'run_code', 'subagent_codex']) expect(probe.names).not.toContain(forbidden);
});
it('checks the official bundled Codex payload version without authentication or a model request', async () => {
  const require = createRequire(officialPackage('@deepseek-ai/dsh-subagent-codex'));
  const packagePath = require.resolve('@openai/codex/package.json');
  const manifest = JSON.parse(await readFile(packagePath, 'utf8'));
  expect(manifest.version).toBe('0.153.4');
  const bin = path.join(path.dirname(packagePath), 'bin/codex.js');
  expect(execFileSync(process.execPath, [bin, '--version'], { encoding: 'utf8', timeout: 15000 })).toContain('0.153.4');
});
