import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { officialPackage } from '../packages/dsh-bridge/src/index.js';
import { repo } from './helpers.js';

async function official(name: string) {
  const require = createRequire(officialPackage(name));
  return import(pathToFileURL(require.resolve(name)).href);
}
it('validates MCP, skill and Codex configurations with published official schemas', async () => {
  const mcp = await official('@deepseek-ai/dsh-mcp-client');
  const skill = await official('@deepseek-ai/dsh-skill-filesystem');
  const codex = await official('@deepseek-ai/dsh-subagent-codex');
  expect(mcp.Config({ serverName: 'devagent', transport: 'stdio', command: process.execPath }).serverName).toBe('devagent');
  expect(() => mcp.Config({ transport: 'invented', serverName: 'devagent' })).toThrow();
  expect(skill.Config({ includeDefaultRoots: false, customSkillDirs: [path.join(repo, 'skills')], watch: false }).includeDefaultRoots).toBe(false);
  const template = parse(await readFile(path.join(repo, 'templates/codex.patch.example.yml'), 'utf8'));
  expect(codex.Config(template[0].insert[0].config).permissionMode).toBe('never');
  const requireCodex = createRequire(officialPackage('@deepseek-ai/dsh-subagent-codex'));
  const tool = await import(pathToFileURL(requireCodex.resolve('@deepseek-ai/dsh-tool-subagent')).href);
  expect(tool.Config(template[0].insert[1].config).provider).toBe('codex');
  expect(() => codex.Config({ permissionMode: 'read-only' })).toThrow();
});
it('discovers and reads all three skills through the official filesystem provider', async () => {
  const require = createRequire(officialPackage('@deepseek-ai/dsh-skill-filesystem'));
  const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href);
  const { FileSystemSkillProvider } = await official('@deepseek-ai/dsh-skill-filesystem');
  const ctx = new Context(); const controller = new AbortController();
  const provider = new FileSystemSkillProvider(ctx, { signal: controller.signal, invalidate() {} }, {
    includeDefaultRoots: false, customSkillDirs: [path.join(repo, 'skills')], watch: false,
  });
  try {
    const discovered = await provider.list({ cwd: repo });
    const candidates = Array.isArray(discovered) ? discovered : discovered.candidates;
    expect(candidates.map((item: { name: string }) => item.name).sort()).toEqual(['devagent-project-engineering', 'feature-planning', 'observability-design', 'project-onboarding']);
    for (const item of candidates) {
      const loaded = await provider.get(item, { cwd: repo });
      expect(loaded).toBeDefined();
      expect(JSON.stringify(loaded).length).toBeGreaterThan(300);
    }
    const schema = JSON.parse(await readFile(path.join(repo, 'skills/feature-planning/references/plan.schema.json'), 'utf8'));
    expect(schema.required).toContain('observability'); expect(schema.required).toContain('capabilityGaps');
  } finally { controller.abort(); await provider.dispose(); }
});
