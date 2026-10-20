import path from 'node:path';
import { lstat } from 'node:fs/promises';
import { parse as parseToml } from 'smol-toml';
import { canonicalRoot, checkedPath, inventory, readBounded, projectSchema,
  type ProjectConfig, type Component, type Command, type Inventory, type ProjectDetector } from '@devagent/core';

type Manifest = Record<string, unknown>;
function record(value: unknown): Manifest {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Manifest : {};
}
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }
function component(root: string, file: string): Component {
  const directory = path.posix.dirname(file);
  const name = (directory === '.' ? path.basename(root) : path.posix.basename(directory)).replace(/[^\p{L}\p{N}_. -]/gu, '-').slice(0, 96) || 'project';
  return { name, path: directory, languages: [], frameworks: [], buildSystems: [], testFrameworks: [], sources: [{ path: file, kind: 'manifest' }] };
}
function addCommand(commands: Command[], item: Component, purpose: Command['purpose'], executable: Command['executable'], args: string[], source: string) {
  commands.push({ id: `${item.name}-${purpose}`.slice(0, 96), component: item.path, purpose, executable, args, status: 'pending', source });
}

export interface ProjectAdapter {
  readonly name: string;
  detect(root: string, files: Inventory): Promise<{ components: Component[]; commands: Command[]; invalid: boolean }>;
}
export class NodeAdapter implements ProjectAdapter {
  readonly name = 'node';
  async detect(root: string, files: Inventory) {
    const components: Component[] = []; const commands: Command[] = []; let invalid = false;
    for (const file of files.files.filter((file) => path.posix.basename(file) === 'package.json')) {
      try {
        const manifest = record(JSON.parse(await readBounded(root, file)));
        const item = component(root, file);
        const dependencies = { ...record(manifest.dependencies), ...record(manifest.devDependencies) };
        const has = (name: string) => Object.hasOwn(dependencies, name);
        const localFile = (name: string) => files.files.includes(item.path === '.' ? name : `${item.path}/${name}`);
        item.languages.push(has('typescript') || localFile('tsconfig.json') ? 'TypeScript' : 'JavaScript');
        for (const [dependency, framework] of [['react', 'React'], ['electron', 'Electron']] as const) if (has(dependency)) item.frameworks.push(framework);
        let manager: 'npm' | 'pnpm' | 'yarn' = 'npm';
        if (localFile('pnpm-lock.yaml') || typeof manifest.packageManager === 'string' && manifest.packageManager.startsWith('pnpm@')) manager = 'pnpm';
        else if (localFile('yarn.lock') || typeof manifest.packageManager === 'string' && manifest.packageManager.startsWith('yarn@')) manager = 'yarn';
        item.buildSystems.push(manager);
        if (has('vite')) item.buildSystems.push('vite');
        if (has('typescript')) item.buildSystems.push('tsc');
        for (const framework of ['vitest', 'jest', 'playwright'] as const) if (has(framework) || has(`@${framework}/test`)) item.testFrameworks.push(framework);
        const scripts = record(manifest.scripts);
        for (const purpose of ['build', 'test', 'typecheck', 'lint'] as const) {
          if (typeof scripts[purpose] === 'string' && scripts[purpose].trim()) addCommand(commands, item, purpose, manager, ['run', purpose], file);
        }
        components.push(item);
      } catch { invalid = true; }
    }
    return { components, commands, invalid };
  }
}
export class PythonAdapter implements ProjectAdapter {
  readonly name = 'python';
  async detect(root: string, files: Inventory) {
    const components: Component[] = []; const commands: Command[] = []; let invalid = false;
    const sources = files.files.filter((file) => /(?:^|\/)(?:pyproject\.toml|requirements\.txt)$/.test(file));
    const seen = new Set<string>();
    for (const file of sources.sort((a, b) => (a.endsWith('.toml') ? -1 : 1) - (b.endsWith('.toml') ? -1 : 1))) {
      const item = component(root, file);
      if (seen.has(item.path)) continue;
      try {
        const text = await readBounded(root, file);
        const manifest = file.endsWith('.toml') ? record(parseToml(text)) : {};
        const project = record(manifest.project); const tool = record(manifest.tool);
        const dependencies = [...strings(project.dependencies), ...Object.values(record(project['optional-dependencies'])).flatMap(strings),
          ...Object.values(record(manifest['dependency-groups'])).flatMap(strings), ...Object.keys(record(record(tool.poetry).dependencies))];
        if (file.endsWith('.txt')) dependencies.push(...text.split(/\r?\n/).filter((line) => /^[A-Za-z]/.test(line)));
        const has = (dependency: string) => dependencies.some((value) => new RegExp(`^${dependency}(?:[\\s[<>=!~;]|$)`, 'i').test(value));
        item.languages.push('Python');
        if (has('fastapi')) item.frameworks.push('FastAPI');
        const backend = record(manifest['build-system'])['build-backend'];
        for (const name of ['setuptools', 'hatchling', 'poetry'] as const) if (typeof backend === 'string' && backend.startsWith(name)) item.buildSystems.push(name);
        if (Object.hasOwn(tool, 'uv')) item.buildSystems.push('uv');
        if (has('pytest') || Object.hasOwn(tool, 'pytest') || files.files.includes(item.path === '.' ? 'pytest.ini' : `${item.path}/pytest.ini`)) {
          item.testFrameworks.push('pytest'); addCommand(commands, item, 'test', 'python', ['-m', 'pytest'], file);
        }
        components.push(item); seen.add(item.path);
      } catch { invalid = true; }
    }
    return { components, commands, invalid };
  }
}
export class DotnetAdapter implements ProjectAdapter {
  readonly name = 'dotnet';
  async detect(root: string, files: Inventory) {
    const components: Component[] = []; const commands: Command[] = []; let invalid = false;
    for (const file of files.files.filter((file) => file.endsWith('.csproj'))) {
      try {
        const text = await readBounded(root, file);
        if (!/<Project(?:\s|>)/.test(text) || /<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Invalid project');
        const item = component(root, file);
        item.name = path.posix.basename(file, '.csproj').replace(/[^\p{L}\p{N}_. -]/gu, '-').slice(0, 96) || 'dotnet';
        item.languages.push('C#'); item.frameworks.push('.NET'); item.buildSystems.push('MSBuild');
        if (/<UseWPF>\s*true\s*<\/UseWPF>/i.test(text)) item.frameworks.push('WPF');
        for (const [dependency, framework] of [['xunit', 'xunit'], ['NUnit', 'nunit'], ['MSTest.TestFramework', 'mstest']] as const) {
          if (text.toLowerCase().includes(`include="${dependency.toLowerCase()}"`)) item.testFrameworks.push(framework);
        }
        const project = path.posix.basename(file);
        addCommand(commands, item, 'build', 'dotnet', ['build', project], file);
        if (item.testFrameworks.length) addCommand(commands, item, 'test', 'dotnet', ['test', project], file);
        components.push(item);
      } catch { invalid = true; }
    }
    return { components, commands, invalid };
  }
}

export class EngineeringDetector implements ProjectDetector {
  constructor(private readonly adapters: ProjectAdapter[] = [new NodeAdapter(), new PythonAdapter(), new DotnetAdapter()]) {}
  async detect(input: string): Promise<ProjectConfig> {
    const root = await canonicalRoot(input); const files = await inventory(root);
    const detected = await Promise.all(this.adapters.map((adapter) => adapter.detect(root, files)));
    const components = detected.flatMap((result) => result.components);
    const warnings: ProjectConfig['detection']['warnings'] = [...files.warnings];
    if (detected.some((result) => result.invalid)) warnings.push('invalid-manifest');
    if (!components.length) warnings.push('unknown-stack');
    const logs: ProjectConfig['observability']['logs'] = [];
    try { if ((await lstat(await checkedPath(root, 'logs'))).isDirectory()) logs.push({ path: 'logs', status: 'pending', contentAccess: false }); } catch { /* Logs are optional metadata. */ }
    return projectSchema.parse({
      schemaVersion: 1, name: path.basename(root).replace(/[^\p{L}\p{N}_. -]/gu, '-').slice(0, 96) || 'project',
      components, mainDirectories: files.directories, commands: detected.flatMap((result) => result.commands),
      observability: { logs, uiTesting: components.some((item) => item.testFrameworks.includes('playwright')) ? 'pending' : 'unavailable', deviceAdapter: 'unsupported' },
      permissions: { read: 'metadata-only', executeCommands: false, hardware: false, network: false, remoteBusinessData: false },
      detection: { status: warnings.length ? 'partial' : 'complete', warnings: [...new Set(warnings)] },
    });
  }
}
