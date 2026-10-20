import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { StateStore, ExternalRegistry, WorkspaceManager, TaskService, ProjectIdentities, HarnessError, newId, digest, revision } from '@devagent/core';
import { NativeRpc } from './rpc.js';
import { nativeExec } from './events.js';
export { runNativeWork } from './workflow.js';
export { installWorkHooks } from './hooks.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
export function nativeEnvironment(home: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: process.env.TEMP, TMP: process.env.TMP, HOME: home, USERPROFILE: home, CODEX_HOME: home, DSH_TELEMETRY_DISABLED: '1' };
  // Preserve explicit network routing/trust configuration in process memory only, never in artifacts.
  for (const name of ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'all_proxy', 'no_proxy', 'CODEX_CA_CERTIFICATE', 'SSL_CERT_FILE']) if (process.env[name]) environment[name] = process.env[name];
  return environment;
}
const safeTools = ['get_context_brief', 'get_developer_profile', 'get_relevant_preferences', 'get_project_profile', 'get_recent_work', 'get_project_capabilities', 'get_project_rules', 'search_code', 'read_code_slice', 'find_symbol', 'get_module_dependencies', 'search_project_memory', 'query_diagnostics', 'get_task_failures'];
interface Attachment { id: string; projectId: string; workspaceId: string; taskId: string; cwd: string; home: string; executable: string; sourceSharingAllowed: boolean; personalContext: boolean; createdAt?: string }
interface Receipt { tool: string; status: string; taskId: string; projectId: string; sourcePaths: string[]; recentStates: string[]; at: string; signature: string }
export function checkNativeAnswer(answer: unknown, projectId: string, currentRevision: string, receipts: Pick<Receipt, 'tool' | 'sourcePaths' | 'recentStates'>[]) {
  if (!answer || typeof answer !== 'object') return false;
  const value = answer as Record<string, unknown>;
  const recent = receipts.filter(item => item.tool === 'get_recent_work').at(-1);
  return value.projectId === projectId && value.currentRevision === currentRevision && typeof value.sourcePath === 'string'
    && receipts.some(item => item.sourcePaths.includes(value.sourcePath as string))
    && Array.isArray(value.forbiddenOperations) && ['hardware', 'production', 'source-write'].every(required => (value.forbiddenOperations as unknown[]).some(item => typeof item === 'string' && item.toLowerCase().includes(required)))
    && Boolean(recent) && JSON.stringify(value.recentWorkStates) === JSON.stringify(recent?.recentStates);
}
export class CodexNativeIntegration {
  constructor(readonly store: StateStore, readonly registry: ExternalRegistry, readonly identities: ProjectIdentities, readonly workspaces: WorkspaceManager, readonly tasks: TaskService) {}
  async config(project: string, taskId?: string, includePreferences = false) {
    const identity = await this.identities.resolve(project); const record = await this.registry.get(identity.stableProjectId);
    const args = [path.join(root, 'packages/diagnostics-mcp/dist/main.js'), '--home', this.store.root, '--project', identity.stableProjectId, ...(taskId ? ['--task', taskId] : []), ...(includePreferences ? ['--personal-context'] : [])];
    return `# Machine-local candidate. Profiles and config do not grant source sharing or execution.\n[mcp_servers.devagent]\ncommand = ${JSON.stringify(process.execPath)}\nargs = ${JSON.stringify(args)}\nenabled = ${record.kind === 'fixture' && record.sourceSharing === 'fixture-only'}\nrequired = true\nstartup_timeout_sec = 30\ntool_timeout_sec = 30\nenabled_tools = ${JSON.stringify(safeTools)}\n`;
  }
  async attach(project: string, options: { workspaceId?: string; includePreferences?: boolean; executable?: string; authFrom?: string } = {}) {
    const identity = await this.identities.resolve(project); const record = await this.registry.get(identity.stableProjectId);
    const workspace = options.workspaceId ? await this.workspaces.get(options.workspaceId) : await this.workspaces.create(identity.stableProjectId, 'HEAD', { includeEngineeringSkills: true });
    if ((await this.identities.resolve(workspace.projectId)).stableProjectId !== identity.stableProjectId) throw new HarnessError('CODEX_WORKSPACE_PROJECT_MISMATCH');
    const cwd = await this.workspaces.root(workspace.id); const task = await this.tasks.create(identity.stableProjectId, 'Codex native context bootstrap; no project execution or source writes', 'analysis', workspace.id);
    const id = newId('attachment'); const home = await this.store.directory(`runtime/codex-native/${id}/home`);
    const config = `sandbox_mode = "read-only"\napproval_policy = "never"\nweb_search = "disabled"\ncli_auth_credentials_store = "file"\nmcp_optional_startup_grace_ms = 0\n[history]\npersistence = "none"\n[features]\nshell_tool = false\nunified_exec = false\ncode_mode = true\ncode_mode_host = true\nview_image = false\nimage_generation = false\nskill_mcp_dependency_install = false\nbrowser_use = false\ncomputer_use = false\napps = false\nplugins = false\nmulti_agent = false\n[analytics]\nenabled = false\n[projects.${JSON.stringify(cwd)}]\ntrust_level = "trusted"\n${await this.config(identity.stableProjectId, task.id, Boolean(options.includePreferences))}`;
    await this.store.put(`runtime/codex-native/${id}/home/config.toml`, config);
    const content = await readFile(path.join(root, 'skills/devagent-project-engineering/SKILL.md'), 'utf8');
    await this.store.put(`runtime/codex-native/${id}/home/skills/devagent-project-engineering/SKILL.md`, content);
    await this.store.put(`runtime/codex-native/${id}/home/.agents/skills/devagent-project-engineering/SKILL.md`, content);
    const auth = options.authFrom ? await this.get(options.authFrom) : null;
    if (auth) {
      const owner = await this.registry.get(auth.projectId);
      if (record.kind !== 'fixture' || record.sourceSharing !== 'fixture-only' || owner.kind !== 'fixture' || owner.sourceSharing !== 'fixture-only') throw new HarnessError('NATIVE_AUTH_REFERENCE_SCOPE_DENIED');
    }
    const attachment: Attachment = { id, projectId: identity.stableProjectId, workspaceId: workspace.id, taskId: task.id, cwd, home: auth?.home ?? home, executable: auth?.executable ?? options.executable ?? 'codex', sourceSharingAllowed: record.kind === 'fixture' && record.sourceSharing === 'fixture-only', personalContext: Boolean(options.includePreferences), createdAt: new Date().toISOString() };
    await this.store.put(`runtime/codex-native/${id}.json`, attachment);
    return { ...attachment, globalConfigurationChanged: false, hostAuthenticationImported: false, authenticationProfileReference: options.authFrom ?? null, configArtifact: `runtime/codex-native/${id}/home/config.toml` };
  }
  private environment(home: string): NodeJS.ProcessEnv {
    return nativeEnvironment(home);
  }
  async get(id: string): Promise<Attachment> { if (!/^attachment-[a-f0-9]{32}$/.test(id)) throw new HarnessError('CODEX_ATTACHMENT_ID_DENIED'); return this.store.get(`runtime/codex-native/${id}.json`); }
  async latest(project: string) {
    const stable = (await this.identities.resolve(project)).stableProjectId; await this.store.directory('runtime/codex-native');
    const records = await this.store.list<Attachment>('runtime/codex-native');
    const latest = records.filter(item => item.projectId === stable && /^attachment-[a-f0-9]{32}$/.test(item.id)).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))[0];
    if (!latest) throw new HarnessError('CODEX_ATTACH_REQUIRED'); return this.get(latest.id);
  }
  async inspect(id: string) {
    const attachment = await this.get(id); await this.workspaces.get(attachment.workspaceId);
    const version = spawnSync(attachment.executable, ['--version'], { env: this.environment(attachment.home), cwd: attachment.cwd, encoding: 'utf8', timeout: 15000, windowsHide: true });
    if (version.status !== 0) throw new HarnessError('CODEX_NATIVE_UNAVAILABLE');
    const current = await this.registry.get(attachment.projectId);
    const mcpArgs = [path.join(root, 'packages/diagnostics-mcp/dist/main.js'), '--home', this.store.root, '--project', attachment.projectId, '--task', attachment.taskId, ...(attachment.personalContext ? ['--personal-context'] : [])];
    const rpc = new NativeRpc(attachment.executable, attachment.cwd, this.environment(attachment.home), ['-c', `mcp_servers.devagent.args=${JSON.stringify(mcpArgs)}`, '-c', `mcp_servers.devagent.enabled=${current.kind === 'fixture' && current.sourceSharing === 'fixture-only'}`]);
    try {
      await rpc.request('initialize', { clientInfo: { name: 'devagent-native-inspector', version: '0.3.0' }, capabilities: { experimentalApi: false } }); rpc.notify('initialized');
      const skills = await rpc.request<{ data?: { skills?: { name: string; enabled: boolean }[]; errors?: unknown[] }[] }>('skills/list', { cwds: [attachment.cwd], forceReload: true });
      const servers = await rpc.request<{ data?: { name: string; tools?: Record<string, unknown> }[] }>('mcpServerStatus/list', { limit: 100 });
      const account = await rpc.request<{ account?: unknown }>('account/read', { refreshToken: false });
      const models = await rpc.request<{ data?: { id: string; isDefault: boolean }[] }>('model/list', { limit: 30 });
      const names = skills.data?.flatMap(entry => entry.skills?.filter(skill => skill.enabled).map(skill => skill.name) ?? []) ?? [];
      const server = servers.data?.find(server => server.name === 'devagent'); const tools = Object.keys(server?.tools ?? {});
      const result = { attachmentId: id, nativeVersion: version.stdout.trim(), freshAppServer: true, skillDiscovered: names.includes('devagent-project-engineering'), skillNames: [...new Set(names)].slice(0, 30),
        mcpDiscovered: tools.includes('get_context_brief'), toolNames: tools, authentication: account.account ? 'authenticated' : 'blocked_by_auth',
        defaultModel: models.data?.find(item => item.isDefault)?.id ?? null, modelToolUse: 'not-proven', globalConfigurationChanged: false, hostAuthenticationImported: false };
      await this.store.put(`reports/${id}.native-inspection.json`, result); return result;
    } finally { await rpc.close(); }
  }
  async session(id: string) {
    const attachment = await this.get(id);
    return this.store.locked(`native-${digest(attachment.home)}`, () => this.contextSession(id));
  }
  private async contextSession(id: string) {
    const attachment = await this.get(id); const inspected = await this.inspect(id);
    const current = await this.registry.get(attachment.projectId); attachment.sourceSharingAllowed &&= current.kind === 'fixture' && current.sourceSharing === 'fixture-only';
    if (!attachment.sourceSharingAllowed || inspected.authentication !== 'authenticated') {
      const status = attachment.sourceSharingAllowed ? 'blocked_by_auth' : 'blocked_by_source_consent';
      const task = await this.tasks.get(attachment.taskId); task.state = 'blocked'; task.reason = status; task.finishedAt = new Date().toISOString(); await this.tasks.save(task); await this.tasks.report(task.id);
      const report = { status, attachmentId: id, taskId: task.id, modelCalls: 0, discovery: inspected }; await this.store.put(`reports/${id}.native-session.json`, report); return report;
    }
    const prompt = `Use $devagent-project-engineering. Call get_context_brief for project ${attachment.projectId}; then get_recent_work and a specific source query. Return only JSON {projectId,currentRevision,sourcePath,forbiddenOperations,recentWorkStates}. forbiddenOperations must include hardware, production, source-write. recentWorkStates must exactly list the states returned by get_recent_work in order. Use actual tool data. Do not edit files, execute commands or read other projects.`;
    const args = [path.join(root, 'packages/diagnostics-mcp/dist/main.js'), '--home', this.store.root, '--project', attachment.projectId, '--task', attachment.taskId, ...(attachment.personalContext ? ['--personal-context'] : [])];
    const result = await nativeExec(attachment.executable, ['exec', '--ephemeral', '--json', '--sandbox', 'read-only', '-C', attachment.cwd, '-c', `mcp_servers.devagent.args=${JSON.stringify(args)}`, '-c', `mcp_servers.devagent.enabled_tools=${JSON.stringify(safeTools)}`, prompt], attachment.cwd, this.environment(attachment.home));
    const completedTurns = result.completedTurns;
    const output = JSON.stringify(result.metadata);
    await this.store.put(`artifacts/${id}/native-session.jsonl`, output);
    const rawReceipts = await this.store.list<Receipt>(`artifacts/${attachment.taskId}/mcp-receipts`).catch(() => []);
    const receipts: Receipt[] = [];
    for (const receipt of rawReceipts) { const { signature, ...payload } = receipt; if (receipt.taskId === attachment.taskId && receipt.projectId === attachment.projectId && await this.store.verify(payload, signature)) receipts.push(receipt); }
    receipts.sort((left, right) => left.at.localeCompare(right.at));
    const used = receipts.some(item => item.tool === 'get_context_brief' && item.status === 'completed');
    const finalLine = result.finalText;
    let accurate = false; try {
      accurate = checkNativeAnswer(JSON.parse(finalLine ?? ''), attachment.projectId, revision(current.root), receipts);
    } catch { /* A narrative claim is not acceptance. */ }
    const status = result.code === 0 && completedTurns > 0 && used && accurate ? 'passed' : 'failed';
    const report = { status, attachmentId: id, taskId: attachment.taskId, verifiedToolUse: used, externallyCheckedAnswer: accurate, receiptCount: receipts.length, nativeExitCode: result.code, nativeSessionAttempted: true, completedNativeTurns: completedTurns, modelCallsLowerBound: completedTurns, modelCallMetric: 'Native completed turns are a lower bound; the CLI does not expose an exact backend request count', metadataHash: digest(output), capturePolicy: 'metadata-only', usage: result.usage, automaticSkillUse: 'Explicit skill invocation only; automatic invocation not established' };
    await this.store.put(`reports/${id}.native-session.json`, report);
    const task = await this.tasks.get(attachment.taskId); task.state = status === 'passed' ? 'succeeded' : 'failed'; task.reason = status === 'passed' ? null : 'NATIVE_CONTEXT_ORACLE_FAILED'; task.finishedAt = new Date().toISOString(); task.modelCalls = completedTurns; await this.tasks.save(task); await this.tasks.report(task.id); return report;
  }
  async login(id: string, method: 'device' | 'browser' = 'device') {
    const attachment = await this.get(id);
    const result = spawnSync(attachment.executable, ['login', ...(method === 'device' ? ['--device-auth'] : [])], { env: this.environment(attachment.home), cwd: attachment.cwd, stdio: 'inherit', windowsHide: true });
    return { nativeExitCode: result.status, globalConfigurationChanged: false, home: attachment.home };
  }
}
export async function probeHarnessMcp(store: StateStore, projectId: string, taskId?: string) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'packages/diagnostics-mcp/dist/main.js'), '--home', store.root, '--project', projectId, '--local-only', ...(taskId ? ['--task', taskId] : [])], stderr: 'pipe' });
  const client = new Client({ name: 'devagent-onboarding-verifier', version: '0.3.0' });
  try {
    await client.connect(transport); const catalog = await client.listTools(); const names = catalog.tools.map(tool => tool.name);
    const result = await client.callTool({ name: 'get_context_brief', arguments: { projectId, task: 'Verify onboarding context', budget: 3000 } });
    const passed = !result.isError && ['get_context_brief', 'get_project_profile', 'get_recent_work', 'search_code'].every(name => names.includes(name));
    return { status: passed ? 'passed' : 'failed', realStdioMcp: true, toolNames: names, responseHash: digest(JSON.stringify(result)), codexModelParticipated: false };
  } finally { await client.close(); }
}
