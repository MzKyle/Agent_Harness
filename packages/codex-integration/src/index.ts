import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, lstat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { StateStore, ExternalRegistry, WorkspaceManager, TaskService, ProjectIdentities, HarnessError, newId, digest, revision, isWithin, checkedPath, readMcpReceipts } from '@devagent/core';
import { NativeRpc } from './rpc.js';
import { nativeExec } from './events.js';
import { unlink } from 'node:fs/promises';
import { provisionNativeSkill, nativeSkillRelative } from './skill.js';
import { authenticationHome, authenticationLock, contextTools as safeTools, runtimeConfiguration, configurationArgs, toml, type Attachment } from './runtime.js';
export { authenticationHome, authenticationLock, runtimeConfiguration, configurationArgs } from './runtime.js';
export type { Attachment } from './runtime.js';
export { useCodex, dailyMode, dailyStatus, hookAction } from './daily.js';
export { runNativeWork } from './workflow.js';
export { installWorkHooks, inspectWorkHooks, disableWorkHooks, workHookConfiguration, bindWorkHookExecution, resolveWorkHookExecution } from './hooks.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
export function nativeEnvironment(home: string, userHome = home): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: process.env.TEMP, TMP: process.env.TMP, HOME: userHome, USERPROFILE: userHome, CODEX_HOME: home, DSH_TELEMETRY_DISABLED: '1' };
  // Preserve explicit network routing/trust configuration in process memory only, never in artifacts.
  for (const name of ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'all_proxy', 'no_proxy', 'CODEX_CA_CERTIFICATE', 'SSL_CERT_FILE']) if (process.env[name]) environment[name] = process.env[name];
  return environment;
}
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
    const skill = await provisionNativeSkill(this.store, this.workspaces, workspace.id, content);
    const auth = options.authFrom ? await this.get(options.authFrom) : null;
    if (auth) {
      const owner = await this.registry.get(auth.projectId);
      if (record.kind !== 'fixture' || record.sourceSharing !== 'fixture-only' || owner.kind !== 'fixture' || owner.sourceSharing !== 'fixture-only') throw new HarnessError('NATIVE_AUTH_REFERENCE_SCOPE_DENIED');
    }
    const authHome = auth ? authenticationHome(auth) : await this.store.directory(`runtime/codex-authentication/${newId('authentication')}/home`);
    if (!auth) await this.store.put(`${path.relative(this.store.root, authHome).split(path.sep).join('/')}/config.toml`, 'cli_auth_credentials_store = "file"\n[history]\npersistence = "none"\n[analytics]\nenabled = false\n[features]\nhooks = false\n');
    const attachment: Attachment = { id, projectId: identity.stableProjectId, workspaceId: workspace.id, taskId: task.id, cwd, home, authHome, skillPath: skill.path, skillHash: skill.hash, authenticationContextId: `authentication-${digest(authHome).slice(0, 32)}`, executable: auth?.executable ?? options.executable ?? 'codex', sourceSharingAllowed: record.kind === 'fixture' && record.sourceSharing === 'fixture-only', personalContext: Boolean(options.includePreferences), createdAt: new Date().toISOString() };
    await this.store.put(`runtime/codex-native/${id}.json`, attachment);
    await this.store.put(`runtime/codex-native/${id}.signature.json`, { signature: await this.store.sign(attachment) });
    await this.authenticationContext(attachment);
    return { ...attachment, globalConfigurationChanged: false, hostAuthenticationImported: false, authenticationProfileReference: options.authFrom ?? null, configArtifact: `runtime/codex-native/${id}/home/config.toml`, effectiveConfiguration: 'complete per-invocation overrides; exec ignores authentication HOME config' };
  }
  private environment(home: string, userHome = home): NodeJS.ProcessEnv {
    return nativeEnvironment(home, userHome);
  }
  async authenticationContext(attachment: Attachment) {
    const home = authenticationHome(attachment); const id = `authentication-${digest(home).slice(0, 32)}`;
    const config = `${path.relative(this.store.root, home).split(path.sep).join('/')}/config.toml`;
    const configurationText = await this.store.text(config); const configHash = digest(configurationText); const file = `runtime/authentication-contexts/${id}.json`;
    try {
      const { signature, ...payload } = await this.store.get<{ id: string; home: string; configurationHash: string; signature: string }>(file);
      if (!await this.store.verify(payload, signature) || payload.id !== id || payload.home !== home) throw new HarnessError('NATIVE_AUTH_CONTEXT_CONFIGURATION_CHANGED');
      const presentationSuffix = '\n[tui]\nscreen_reader_detection_done = true\n';
      const knownPresentationOnly = configurationText.endsWith(presentationSuffix) && digest(configurationText.slice(0, -presentationSuffix.length)) === payload.configurationHash;
      if (payload.configurationHash !== configHash && !knownPresentationOnly) throw new HarnessError('NATIVE_AUTH_CONTEXT_CONFIGURATION_CHANGED', 'Shared managed authentication HOME config changed; review it before creating a new explicit context. Credentials were not inspected.');
      if (payload.configurationHash !== configHash) {
        const observation = { id, pinnedConfigurationHash: payload.configurationHash, observedConfigurationHash: configHash, acceptedPresentationMetadata: ['tui.screen_reader_detection_done'], at: new Date().toISOString(), authenticationConfigRewritten: false };
        await this.store.put(`runtime/authentication-ui-observations/${id}.json`, { ...observation, signature: await this.store.sign(observation) });
      }
      return { id, configurationHash: payload.configurationHash, observedConfigurationHash: configHash, acceptedPresentationMetadata: payload.configurationHash !== configHash ? ['tui.screen_reader_detection_done'] : [], sharing: 'authentication only; execution config is complete per invocation' };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const payload = { id, home, configurationHash: configHash }; await this.store.put(file, { ...payload, signature: await this.store.sign(payload) });
      return { id, configurationHash: configHash, sharing: 'authentication only; execution config is complete per invocation' };
    }
  }
  async get(id: string): Promise<Attachment> {
    if (!/^attachment-[a-f0-9]{32}$/.test(id)) throw new HarnessError('CODEX_ATTACHMENT_ID_DENIED');
    const attachment = await this.store.get<Attachment>(`runtime/codex-native/${id}.json`);
    if (attachment.id !== id) throw new HarnessError('CODEX_ATTACHMENT_ID_DENIED');
    let signedAttachment: { signature: string } | null = null;
    try { signedAttachment = await this.store.get<{ signature: string }>(`runtime/codex-native/${id}.signature.json`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (attachment.authHome || signedAttachment) {
      if (!signedAttachment || !await this.store.verify(attachment, signedAttachment.signature)) throw new HarnessError('CODEX_ATTACHMENT_INTEGRITY_FAILED');
    }
    for (const home of [attachment.home, authenticationHome(attachment)]) {
      if (!isWithin(path.join(this.store.root, 'runtime/codex-native'), home) && !(home === authenticationHome(attachment) && isWithin(path.join(this.store.root, 'runtime/codex-authentication'), home))) throw new HarnessError('CODEX_AUTHENTICATION_HOME_DENIED');
      await checkedPath(this.store.root, path.relative(this.store.root, home));
    }
    const workspace = await this.workspaces.get(attachment.workspaceId);
    if ((await this.identities.resolve(workspace.projectId)).stableProjectId !== attachment.projectId || attachment.cwd !== await this.workspaces.root(workspace.id)) throw new HarnessError('CODEX_WORKSPACE_PROJECT_MISMATCH');
    if (attachment.skillPath && (attachment.skillPath !== path.join(attachment.cwd, nativeSkillRelative) || digest(await readFile(await checkedPath(this.store.root, path.relative(this.store.root, attachment.skillPath)))) !== attachment.skillHash)) throw new HarnessError('NATIVE_SKILL_INTEGRITY_FAILED');
    return attachment;
  }
  async executionConfiguration(id: string, taskId: string, tools: string[], options: Parameters<typeof runtimeConfiguration>[4] = {}) {
    const attachment = await this.get(id); const task = await this.tasks.get(taskId); const record = await this.registry.get(attachment.projectId);
    if (options.hooks && (await this.hookIsolation(id)).status !== 'passed') throw new HarnessError('HOOK_AUTH_CONTEXT_ISOLATION_BLOCKED', 'Official runtime merges authentication HOME hooks.json. Use a fresh dedicated managed login for Hooks; shared legacy files are not modified. Runs without Hooks remain available.');
    const authenticationContextConfiguration = await this.authenticationContext(attachment);
    if ((await this.identities.resolve(task.projectId)).stableProjectId !== attachment.projectId || task.workspaceId !== attachment.workspaceId) throw new HarnessError('CODEX_TASK_SCOPE_DENIED');
    const configuration = runtimeConfiguration(this.store.root, { ...attachment, sourceSharingAllowed: record.kind === 'fixture' && record.sourceSharing === 'fixture-only' }, taskId, tools, options);
    const sessionId = newId('native-session'); const artifact = `runtime/codex-executions/${sessionId}.json`;
    const payload = { sessionId, attachmentId: id, authenticationContextId: attachment.authenticationContextId ?? `authentication-${digest(authenticationHome(attachment)).slice(0, 32)}`, authenticationContextConfiguration, projectId: attachment.projectId, taskId, ownerPid: process.pid, purpose: options.purpose ?? 'execution', configuration, at: new Date().toISOString() };
    await this.store.put(artifact, { ...payload, signature: await this.store.sign(payload) });
    return { sessionId, artifact, args: configurationArgs(configuration), configurationHash: digest(toml(configuration)) };
  }
  async hookIsolation(id: string) {
    const attachment = await this.get(id);
    try {
      await lstat(path.join(authenticationHome(attachment), 'hooks.json'));
      return { status: 'blocked' as const, reason: 'Authentication HOME contains hooks.json; official runtime merges it with session definitions. A fresh dedicated managed login is required for isolated Hooks.', authenticationHooksFilePresent: true, authenticationConfigChanged: false };
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return { status: 'passed' as const, reason: null, authenticationHooksFilePresent: false, authenticationConfigChanged: false };
  }
  processJournal(sessionId: string) {
    let pid: number | null = null;
    const write = async (state: 'running' | 'closed', code: number | null = null) => {
      if (!/^native-session-[a-f0-9]{32}$/.test(sessionId)) throw new HarnessError('NATIVE_SESSION_ID_DENIED');
      const { signature, ...execution } = await this.store.get<{ authenticationContextId: string; ownerPid: number; taskId: string; signature: string }>(`runtime/codex-executions/${sessionId}.json`);
      if (!await this.store.verify(execution, signature)) throw new HarnessError('NATIVE_SESSION_INTEGRITY_FAILED');
      const payload = { sessionId, authenticationContextId: execution.authenticationContextId, ownerPid: execution.ownerPid, taskId: execution.taskId, pid, state, code, at: new Date().toISOString() };
      await this.store.put(`runtime/native-processes/${sessionId}.json`, { ...payload, signature: await this.store.sign(payload) });
    };
    return { started: async (value: number) => { pid = value; await write('running'); }, closed: async (code: number | null) => { await write('closed', code); } };
  }
  async recoverAuthentication(id: string) {
    const attachment = await this.get(id); const lockId = authenticationLock(attachment); const context = await this.authenticationContext(attachment);
    const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; } };
    return this.store.locked(`native-recovery-${digest(authenticationHome(attachment))}`, async () => {
      let owner: { pid: number; startedAt: string };
      try { owner = JSON.parse(await this.store.text(`locks/${lockId}.lock`)); }
      catch (error) { return { status: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'unlocked' : 'review-required', permissionsRestored: false }; }
      if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0 || !owner.startedAt || alive(owner.pid)) return { status: 'blocked', reason: 'Owner is alive or cannot be identified', permissionsRestored: false };
      await this.store.directory('runtime/native-processes'); const records = await this.store.list<{ sessionId: string; authenticationContextId: string; ownerPid: number; pid: number; state: string; signature: string }>('runtime/native-processes');
      const owned = records.filter(item => item.authenticationContextId === context.id && item.ownerPid === owner.pid);
      const sessions = (await this.store.list<{ sessionId: string; ownerPid: number; authenticationContextId: string; purpose?: string }>('runtime/codex-executions')).filter(item => item.ownerPid === owner.pid && item.authenticationContextId === context.id && item.purpose === 'execution');
      if (!sessions.length && !owned.length) return { status: 'review-required', reason: 'No execution/process journal identifies this dead owner; review the lock manually', permissionsRestored: false };
      if (sessions.some(item => !owned.some(record => record.sessionId === item.sessionId))) return { status: 'review-required', reason: 'An execution has no child-process journal; cannot prove it stopped', permissionsRestored: false };
      for (const record of owned) {
        const { signature, ...payload } = record;
        if (!await this.store.verify(payload, signature)) throw new HarnessError('NATIVE_PROCESS_INTEGRITY_FAILED');
        if (record.state !== 'closed' && (!Number.isSafeInteger(record.pid) || alive(record.pid))) return { status: 'blocked', reason: 'A known native child is still alive or unidentifiable; no process is killed automatically', permissionsRestored: false };
      }
      await unlink(this.store.resolve(`locks/${lockId}.lock`));
      return { status: 'recovered', permissionsRestored: false, processesKilled: 0 };
    });
  }
  async latest(project: string) {
    const stable = (await this.identities.resolve(project)).stableProjectId; await this.store.directory('runtime/codex-native');
    const records = await this.store.list<Attachment>('runtime/codex-native');
    const latest = records.filter(item => item.projectId === stable && /^attachment-[a-f0-9]{32}$/.test(item.id)).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))[0];
    if (!latest) throw new HarnessError('CODEX_ATTACH_REQUIRED'); return this.get(latest.id);
  }
  async inspect(id: string) {
    const attachment = await this.get(id); await this.workspaces.get(attachment.workspaceId);
    const version = spawnSync(attachment.executable, ['--version'], { env: this.environment(authenticationHome(attachment), attachment.home), cwd: attachment.cwd, encoding: 'utf8', timeout: 15000, windowsHide: true });
    if (version.status !== 0) throw new HarnessError('CODEX_NATIVE_UNAVAILABLE');
    const execution = await this.executionConfiguration(id, attachment.taskId, safeTools, { skill: true, purpose: 'inspection' });
    const rpc = new NativeRpc(attachment.executable, attachment.cwd, this.environment(authenticationHome(attachment), attachment.home), execution.args);
    try {
      await rpc.request('initialize', { clientInfo: { name: 'devagent-native-inspector', version: '0.3.0' }, capabilities: { experimentalApi: false } }); rpc.notify('initialized');
      const skills = await rpc.request<{ data?: { skills?: { name: string; enabled: boolean; path?: string }[]; errors?: unknown[] }[] }>('skills/list', { cwds: [attachment.cwd], forceReload: true });
      const servers = await rpc.request<{ data?: { name: string; tools?: Record<string, unknown> }[] }>('mcpServerStatus/list', { limit: 100 });
      const account = await rpc.request<{ account?: unknown }>('account/read', { refreshToken: false });
      const models = await rpc.request<{ data?: { id: string; isDefault: boolean }[] }>('model/list', { limit: 30 });
      const names = skills.data?.flatMap(entry => entry.skills?.filter(skill => skill.enabled).map(skill => skill.name) ?? []) ?? [];
      const scopedSkills = skills.data?.flatMap(entry => entry.skills?.filter(skill => skill.enabled && skill.name === 'devagent-project-engineering') ?? []) ?? [];
      if (scopedSkills.some(skill => skill.path !== attachment.skillPath)) throw new HarnessError('NATIVE_SKILL_SCOPE_DENIED');
      const server = servers.data?.find(server => server.name === 'devagent'); const tools = Object.keys(server?.tools ?? {});
      const result = { attachmentId: id, nativeVersion: version.stdout.trim(), freshAppServer: true, skillDiscovered: scopedSkills.some(skill => skill.path === attachment.skillPath), skillNames: [...new Set(names)].slice(0, 30),
        mcpDiscovered: tools.includes('get_context_brief'), toolNames: tools, authentication: account.account ? 'authenticated' : 'blocked_by_auth',
        defaultModel: models.data?.find(item => item.isDefault)?.id ?? null, modelToolUse: 'not-proven', globalConfigurationChanged: false, hostAuthenticationImported: false };
      await this.store.put(`reports/${id}.native-inspection.json`, result); return result;
    } finally { await rpc.close(); }
  }
  async session(id: string) {
    const attachment = await this.get(id);
    return this.store.locked(authenticationLock(attachment), () => this.contextSession(id));
  }
  private async contextSession(id: string) {
    const attachment = await this.get(id); const inspected = await this.inspect(id);
    const current = await this.registry.get(attachment.projectId); attachment.sourceSharingAllowed &&= current.kind === 'fixture' && current.sourceSharing === 'fixture-only';
    if (!attachment.sourceSharingAllowed || inspected.authentication !== 'authenticated') {
      const status = attachment.sourceSharingAllowed ? 'blocked_by_auth' : 'blocked_by_source_consent';
      const task = await this.tasks.get(attachment.taskId); task.state = 'blocked'; task.reason = status; task.finishedAt = new Date().toISOString(); await this.tasks.save(task); await this.tasks.report(task.id);
      const report = { status, attachmentId: id, taskId: task.id, modelCalls: 0, discovery: inspected }; await this.store.put(`reports/${id}.native-session.json`, report); return report;
    }
    const prompt = `${inspected.skillDiscovered ? 'Use $devagent-project-engineering.' : 'Use the scoped Harness MCP; no native Skill is currently discovered.'} Call get_context_brief for project ${attachment.projectId}; then get_recent_work and a specific source query. Return only JSON {projectId,currentRevision,sourcePath,forbiddenOperations,recentWorkStates}. forbiddenOperations must include hardware, production, source-write. recentWorkStates must exactly list the states returned by get_recent_work in order. Use actual tool data. Do not edit files, execute commands or read other projects.`;
    const execution = await this.executionConfiguration(id, attachment.taskId, safeTools, { skill: true });
    const result = await nativeExec(attachment.executable, ['exec', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--json', '--sandbox', 'read-only', '-C', attachment.cwd, ...execution.args, prompt], attachment.cwd, this.environment(authenticationHome(attachment), attachment.home), undefined, this.processJournal(execution.sessionId));
    const completedTurns = result.completedTurns;
    const output = JSON.stringify(result.metadata);
    await this.store.put(`artifacts/${id}/native-session.jsonl`, output);
    const rawReceipts = await readMcpReceipts<Receipt>(this.store, attachment.taskId);
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
    return this.store.locked(authenticationLock(attachment), async () => {
      const result = spawnSync(attachment.executable, ['login', ...(method === 'device' ? ['--device-auth'] : [])], { env: this.environment(authenticationHome(attachment), attachment.home), cwd: attachment.cwd, stdio: 'inherit', windowsHide: true });
      return { nativeExitCode: result.status, globalConfigurationChanged: false, home: authenticationHome(attachment) };
    });
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
