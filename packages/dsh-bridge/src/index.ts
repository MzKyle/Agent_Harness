import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFile, mkdir, writeFile, lstat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { parse, stringify } from 'yaml';
import { canonicalRoot, loadProject, ProjectError, type RuntimeAdapter } from '@devagent/core';

export const DSH_VERSION = '0.2.1-rc.2';
export { FunctionalDshDriver } from './functional.js';
export { IsolatedCodex } from './codex-container.js';
export const harnessRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const dshBin = fileURLToPath(new URL('../node_modules/@deepseek-ai/dsh/lib/bin.js', import.meta.url));
const requireDsh = createRequire(realpathSync(dshBin));
const requireBridge = createRequire(import.meta.url);
export function officialPackage(name: string): string { return requireBridge.resolve(`${name}/package.json`); }

interface Entry { id?: string; name?: string; disabled?: boolean; config?: Record<string, unknown>; insert?: Entry[] }
export async function buildPatch(projectRoot: string) {
  const root = await canonicalRoot(projectRoot); await loadProject(root);
  const basePath = requireDsh.resolve('@deepseek-ai/dsh-base/cordis.patch.yml');
  const base = parse(await readFile(basePath, 'utf8'), {
    customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }],
  }) as Entry[];
  const rows = base.flatMap((patch) => patch.insert ?? []);
  const disable = rows.filter((row) => row.id && (
    row.name?.includes('/dsh-tool-') && row.id !== 'tool-skill'
    || ['hmr', 'plugin-manager', 'config-editor', 'settings', 'agent-instructions', 'session-title-llm', 'ptc-runtime',
      'workflow-ptc', 'session-telemetry-otel', 'subagent-spawn-in-process', 'subagent-fork-in-process',
      'web-search-deepseek', 'web-deepseek-api', 'web-fetch-http'].includes(row.id)
  )).map((row) => ({ id: row.id, disabled: true }));
  return [
    ...disable,
    { id: 'tools', config: { mode: 'native' } },
    { id: 'skill-filesystem', config: { includeDefaultRoots: false,
      customSkillDirs: [path.join(harnessRoot, 'skills')], watch: false } },
    { insert: [{ id: 'devagent-mcp', name: requireBridge.resolve('@deepseek-ai/dsh-mcp-client'), config: {
      serverName: 'devagent', transport: 'stdio', command: process.execPath,
      args: [path.join(harnessRoot, 'packages/diagnostics-mcp/dist/main.js'), '--allow-project', root],
      cwd: harnessRoot, env: {}, failOnStartupError: true, reconnect: { enabled: false },
    } }] },
  ];
}
export class DshRuntimeAdapter implements RuntimeAdapter {
  readonly name = 'deepseek-harness';
  async prepare({ projectRoot, outputDirectory }: { projectRoot: string; outputDirectory: string }) {
    const root = await canonicalRoot(projectRoot);
    const patches = await buildPatch(root);
    // The generated runtime is entirely local; it never modifies ~/.dsh or target config.
    try { await lstat(outputDirectory); throw new ProjectError('CONFIG_EXISTS'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const profileDirectory = path.join(outputDirectory, 'profiles', 'devagent');
    await mkdir(profileDirectory, { recursive: true });
    await writeFile(path.join(profileDirectory, 'package.json'), JSON.stringify({
      name: 'devagent-local-profile', private: true,
      devagent: { projectRoot: root },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'] } },
    }, null, 2), { flag: 'wx' });
    const patch = path.join(profileDirectory, 'cordis.patch.yml');
    await writeFile(patch, stringify(patches), { flag: 'wx' });
    const optional = parse(await readFile(path.join(harnessRoot, 'templates/codex.patch.example.yml'), 'utf8')) as Entry[];
    for (const row of optional.flatMap((entry) => entry.insert ?? [])) {
      if (row.name) row.name = row.id === 'subagent-codex' ? requireBridge.resolve(row.name) : requireDsh.resolve(row.name);
    }
    const codexPatch = path.join(outputDirectory, 'codex.optional.patch.yml');
    await writeFile(codexPatch, stringify(optional), { flag: 'wx' });
    return { profile: 'devagent', patch, codexPatch };
  }
}

export function launchDsh(home: string, projectRoot: string, args: string[]) {
  try {
    const manifest = JSON.parse(readFileSync(path.join(home, 'profiles/devagent/package.json'), 'utf8')) as { devagent?: { projectRoot?: string } };
    if (manifest.devagent?.projectRoot !== realpathSync(projectRoot)) throw new ProjectError('ACCESS_DENIED');
  } catch { throw new ProjectError('ACCESS_DENIED'); }
  return spawnSync(process.execPath, [dshBin, '--profile', 'devagent', ...args], {
    cwd: projectRoot, env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' },
    stdio: 'inherit', windowsHide: true,
  });
}
export async function packageVersions() {
  const names = ['@deepseek-ai/dsh', '@deepseek-ai/dsh-mcp-client', '@deepseek-ai/dsh-skill-filesystem', '@deepseek-ai/dsh-subagent-codex'];
  const values = await Promise.all(names.map(async (name) => {
    try {
      const location = name === '@deepseek-ai/dsh' ? path.join(path.dirname(dshBin), '../package.json') : officialPackage(name);
      const data = JSON.parse(await readFile(location, 'utf8')) as { version: string };
      return { name, version: data.version, status: data.version === DSH_VERSION ? 'available' : 'version-mismatch' };
    } catch { return { name, version: null, status: 'unavailable' }; }
  }));
  return values;
}
