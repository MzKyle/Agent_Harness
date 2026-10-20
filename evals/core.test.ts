import { afterEach, describe, expect, it } from 'vitest';
import { access, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EngineeringDetector } from '../packages/adapters/src/index.js';
import { getProjectCapabilities, getProjectContext, initializeProject, isWithin, knowledgeSchema,
  loadProject, ProjectRegistry, projectSchema, readBounded } from '../packages/core/src/index.js';
import { fixture, repo } from './helpers.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map((cleanup) => cleanup())); });
async function setup(name: 'als-like' | 'pollen-like') { const item = await fixture(name); cleanups.push(item.cleanup); return item; }
const detector = new EngineeringDetector();
describe('one core across stacks', () => {
  it('recognizes ALS and WPF independently without verifying declared scripts', async () => {
    const a = await setup('als-like'); const b = await setup('pollen-like');
    const als = await initializeProject(a.root, detector); const pollen = await initializeProject(b.root, detector);
    expect(als.config.components.flatMap((item) => item.frameworks)).toEqual(expect.arrayContaining(['FastAPI', 'React', 'Electron']));
    expect(pollen.config.components.flatMap((item) => item.frameworks)).toContain('WPF');
    expect(pollen.config.components.flatMap((item) => item.testFrameworks)).toContain('xunit');
    expect(als.config.commands.every((command) => command.status === 'pending')).toBe(true);
    const registry = await ProjectRegistry.create([a.root, b.root]);
    const ids = registry.list(); expect(ids[0]!.projectId).not.toBe(ids[1]!.projectId);
    const first = await getProjectContext(registry, ids[0]!.projectId);
    const second = await getProjectContext(registry, ids[1]!.projectId);
    expect(JSON.stringify(first)).not.toContain('WPF'); expect(JSON.stringify(second)).not.toContain('FastAPI');
    expect((await getProjectCapabilities(registry, ids[0]!.projectId)).gaps).toContain('no-verified-commands');
    expect(await loadProject(a.root)).toEqual(als.config);
  });
  it('dry-run writes nothing and init never overwrites an existing configuration', async () => {
    const { root } = await setup('als-like');
    const preview = await initializeProject(root, detector, true); expect(preview.status).toBe('dry-run');
    await expect(access(path.join(root, '.devagent'))).rejects.toMatchObject({ code: 'ENOENT' });
    await initializeProject(root, detector);
    const before = await readFile(path.join(root, '.devagent/project.yaml'), 'utf8');
    await expect(initializeProject(root, detector)).rejects.toMatchObject({ code: 'CONFIG_EXISTS' });
    expect(await readFile(path.join(root, '.devagent/project.yaml'), 'utf8')).toBe(before);
  });
  it('marks malformed manifests and unknown stacks as partial', async () => {
    const { root } = await setup('als-like');
    await writeFile(path.join(root, 'desktop/package.json'), '{broken');
    expect((await detector.detect(root)).detection.warnings).toContain('invalid-manifest');
    const unknown = path.join(root, 'unknown'); await mkdir(unknown);
    expect((await detector.detect(unknown)).detection.warnings).toContain('unknown-stack');
  });
  it('requires evidence to mark any command verified', async () => {
    const { root } = await setup('als-like'); const config = await detector.detect(root);
    config.commands[0]!.status = 'verified'; expect(projectSchema.safeParse(config).success).toBe(false);
    config.commands[0]!.evidence = { revision: 'abcdef123', checkedAt: '2026-10-20T00:00:00Z', exitCode: 0, reference: 'evidence/test.md' };
    expect(projectSchema.safeParse(config).success).toBe(true);
  });
});

describe('authorization and safe projection', () => {
  it('rejects paths, unknown IDs, traversal, and invalid configuration without echoing input', async () => {
    const { root } = await setup('als-like'); await initializeProject(root, detector);
    const registry = await ProjectRegistry.create([root]);
    await expect(registry.root('project-0000000000000000')).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    await expect(registry.root(path.dirname(root))).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    await expect(readBounded(root, '../private.txt')).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    const config = await loadProject(root); config.observability.logs = [{ path: '../private', status: 'pending', contentAccess: false }];
    expect(projectSchema.safeParse(config).success).toBe(false);
    await writeFile(path.join(root, '.devagent/project.yaml'), 'schemaVersion: 1\nsecret: sk-fixturesecret');
    await expect(loadProject(root)).rejects.toMatchObject({ code: 'INVALID_CONFIG', message: 'INVALID_CONFIG' });
  });
  it('does not read secrets, raw command strings, or logs', async () => {
    const { root } = await setup('als-like');
    await writeFile(path.join(root, '.env'), 'TOKEN=fixture-private-token');
    await writeFile(path.join(root, 'logs/private.jsonl'), 'fixture-private-log');
    const manifest = path.join(root, 'desktop/package.json');
    const pkg = JSON.parse(await readFile(manifest, 'utf8'));
    pkg.scripts.test = 'echo password=fixture-command-secret'; pkg.name = 'sk-fakesecretvalue';
    await writeFile(manifest, JSON.stringify(pkg));
    await initializeProject(root, detector);
    const registry = await ProjectRegistry.create([root]);
    const output = JSON.stringify(await getProjectContext(registry, registry.list()[0]!.projectId));
    for (const marker of ['fixture-private-token', 'fixture-private-log', 'fixture-command-secret', 'sk-fakesecretvalue']) expect(output).not.toContain(marker);
    expect(output).not.toContain('executable');
  });
  it('rejects junctions/symlinks for manifests, configuration, and root replacement', async () => {
    const a = await setup('als-like'); const b = await setup('pollen-like');
    await symlink(b.root, path.join(a.root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    const config = await detector.detect(a.root);
    expect(config.detection.warnings).toContain('skipped-link');
    expect(config.components.flatMap((component) => component.frameworks)).not.toContain('WPF');
    await symlink(b.root, path.join(a.root, '.devagent'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(initializeProject(a.root, detector)).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    await expect(loadProject(a.root)).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  });
  it('enforces file-size and scan-depth budgets', async () => {
    const { root } = await setup('als-like');
    await writeFile(path.join(root, 'package.json'), ' '.repeat(140000));
    await expect(readBounded(root, 'package.json')).rejects.toMatchObject({ code: 'SCAN_FAILED' });
    await mkdir(path.join(root, 'a/b/c/d/e/f'), { recursive: true });
    expect((await detector.detect(root)).detection.warnings).toContain('scan-limit');
  });
});

describe('portable path semantics', () => {
  it.each([
    ['win32', 'C:\\work\\app', 'C:\\work\\app\\src', true],
    ['win32', 'C:\\work\\app', 'c:\\WORK\\app\\src', true],
    ['win32', 'C:\\work\\app', 'C:\\work\\app-other', false],
    ['win32', 'C:\\work\\app', 'D:\\work\\app', false],
    ['win32', '\\\\host\\share\\app', '\\\\host\\share\\app\\src', true],
    ['win32', '\\\\host\\share\\app', '\\\\other\\share\\app', false],
    ['posix', '/work/app', '/work/app/src', true],
    ['posix', '/work/app', '/work/app/../private', false],
    ['posix', '/work/app', '/work/App/src', false],
    ['posix', '/work/app', 'relative', false],
  ] as const)('%s containment for %s -> %s', (flavor, root, target, expected) => {
    expect(isWithin(root, target, flavor)).toBe(expected);
  });
});
it('validates scoped, version-linked memory without a database', async () => {
  const example = JSON.parse(await readFile(path.join(repo, 'templates/knowledge-record.example.json'), 'utf8'));
  expect(knowledgeSchema.safeParse(example).success).toBe(true);
  delete example.projectId; expect(knowledgeSchema.safeParse(example).success).toBe(false);
});
