// Official DSH runtime + official Codex provider. No custom model client or agent loop.
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, copyFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, URL } from 'node:url';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
const require = createRequire('/opt/devagent/package.json');
const codexRequire = createRequire(require.resolve('@deepseek-ai/dsh-subagent-codex/package.json'));
const codexPackage = codexRequire.resolve('@openai/codex/package.json');
const codexManifest = JSON.parse(await readFile(codexPackage, 'utf8'));
const codexBin = new URL(codexManifest.bin.codex, pathToFileURL(codexPackage)).pathname;
const nativeConfig = 'sandbox_mode="workspace-write"\napproval_policy="never"\nweb_search="disabled"\ncli_auth_credentials_store="file"\n[features]\nshell_tool=false\nunified_exec=false\ncode_mode=false\ncode_mode_host=false\nbrowser_use=false\ncomputer_use=false\napps=false\nplugins=false\nmulti_agent=false\n[sandbox_workspace_write]\nnetwork_access=false\n';
const action = process.argv[2] ?? 'status';
if (action === 'login') {
  await writeFile('/auth/config.toml', nativeConfig);
  const result = spawnSync(process.execPath, [codexBin, 'login', '--device-auth'], { stdio: 'inherit', env: { ...process.env, CODEX_HOME: '/auth' } });
  process.exitCode = result.status ?? 1;
} else {
  await mkdir('/tmp/codex', { recursive: true });
  try { await access('/auth/auth.json'); await copyFile('/auth/auth.json', '/tmp/codex/auth.json'); } catch { /* Explicit isolated auth may not yet exist. */ }
  await writeFile('/tmp/codex/config.toml', nativeConfig); process.env.CODEX_HOME = '/tmp/codex';
  const native = spawnSync(process.execPath, [codexBin, 'login', 'status'], { encoding: 'utf8', env: process.env });
  if (action === 'status' || native.status !== 0) {
    process.stdout.write(JSON.stringify({ status: native.status === 0 ? 'authenticated' : 'blocked_by_auth', provider: '@deepseek-ai/dsh-subagent-codex', payloadVersion: codexManifest.version, hostCredentialsImported: false })+'\n');
  } else {
    let input = ''; for await (const chunk of process.stdin) input += chunk;
    const request = JSON.parse(input); if (typeof request.prompt !== 'string' || request.prompt.length > 90000) throw new Error('PROMPT_LIMIT');
    const dshRequire = createRequire(require.resolve('@deepseek-ai/dsh/package.json'));
    const { runProfile } = await import(pathToFileURL(dshRequire.resolve('@deepseek-ai/dsh/profile-boot')).href);
    const { createLaunchEnvironmentSnapshot } = await import(pathToFileURL(dshRequire.resolve('@deepseek-ai/dsh-launch-environment')).href);
    const { parse, stringify } = require('yaml');
    const base = parse(await readFile(dshRequire.resolve('@deepseek-ai/dsh-base/cordis.patch.yml'), 'utf8'), { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => value }] });
    const disable = base.flatMap(item => item.insert ?? []).filter(row => row.id && (row.name?.includes('/dsh-tool-') || ['hmr', 'plugin-manager', 'settings', 'config-editor', 'agent-instructions', 'session-title-llm', 'ptc-runtime', 'workflow-ptc', 'subagent-spawn-in-process', 'subagent-fork-in-process', 'web-search-deepseek', 'web-deepseek-api', 'web-fetch-http', 'session-telemetry-otel'].includes(row.id))).map(row => ({ id: row.id, disabled: true }));
    process.env.DSH_HOME = '/tmp/dsh'; process.env.DSH_TELEMETRY_DISABLED = '1';
    await mkdir('/tmp/dsh/profiles/delegate', { recursive: true });
    await writeFile('/tmp/dsh/profiles/delegate/package.json', JSON.stringify({ name: 'isolated-codex-delegation', dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }));
    await writeFile('/tmp/dsh/profiles/delegate/cordis.patch.yml', stringify([...disable, { insert: [{ id: 'isolated-codex', name: require.resolve('@deepseek-ai/dsh-subagent-codex'), config: { permissionMode: 'never', env: { CODEX_HOME: '/tmp/codex' } } }] }]));
    const { ctx, shutdown } = await runProfile({ profile: 'delegate', patchFiles: [], args: [], environment: createLaunchEnvironmentSnapshot([{ source: 'process', values: { DSH_HOME: '/tmp/dsh', DSH_TELEMETRY_DISABLED: '1', CODEX_HOME: '/tmp/codex' } }]) });
    let parent; let activation;
    try {
      parent = await ctx.agents.create({ sessionId: `parent-${randomUUID()}`, meta: { cwd: '/workspace' } });
      activation = await ctx.subagents.startActivation({ provider: 'codex', label: request.taskId ?? 'fixture-delegation', request: { parent: parent.agent, cwd: '/workspace', prompt: [{ type: 'text', text: request.prompt }] }, signal: new globalThis.AbortController().signal, delivery: 'caller' });
      const result = await activation.result;
      process.stdout.write(JSON.stringify({ status: 'delegated', taskId: request.taskId, childId: activation.childId, result })+'\n');
    } finally { await activation?.dispose(); await parent?.dispose(); await shutdown.shutdown(0); }
  }
}
