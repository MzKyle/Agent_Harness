import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isWithin, HarnessError, digest, type WorkSessions } from '@devagent/core';
import type { CodexNativeIntegration } from './index.js';
import { authenticationHome, configurationArgs, runtimeConfiguration } from './runtime.js';
import { nativeEnvironment } from './index.js';
import { NativeRpc } from './rpc.js';
const root = fileURLToPath(new URL('../../../', import.meta.url));
export async function installWorkHooks(native: CodexNativeIntegration, work: WorkSessions, attachmentId: string, workId: string, enabled = false) {
  const attachment = await native.get(attachmentId); const session = await work.get(workId);
  if (attachment.home === authenticationHome(attachment)) throw new HarnessError('HOOK_LEGACY_AUTH_HOME_REATTACH_REQUIRED', 'Create a new attachment referencing this explicitly managed authentication context; do not mutate its shared HOME');
  if (session.projectId !== attachment.projectId || session.workspaceId !== attachment.workspaceId || session.state === 'completed') throw new HarnessError('HOOK_WORK_SCOPE_DENIED');
  if (!isWithin(path.join(native.store.root, 'runtime/codex-native'), attachment.home)) throw new HarnessError('HOOK_HOME_DENIED');
  const relative = path.relative(native.store.root, attachment.home).split(path.sep).join('/');
  const file = `${relative}/hooks.json`; const manifest = `runtime/hook-installs/${digest(attachment.home)}.json`;
  let existing: string | null = null;
  try { existing = await native.store.text(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (existing !== null) {
    let owned: { hash: string }; try { owned = await native.store.get(manifest); } catch { throw new HarnessError('HOOK_CONFIG_CONFLICT'); }
    if (digest(existing) !== owned.hash) throw new HarnessError('HOOK_CONFIG_CONFLICT');
  }
  const args = [process.execPath, path.join(root, 'apps/cli/dist/main.js'), 'work', 'hook', '--home', native.store.root, '--attachment', attachmentId];
  if (args.some(value => /[\r\n"'`$%&|<>]/.test(value))) throw new HarnessError('HOOK_COMMAND_PATH_DENIED');
  // Only fixed Harness argv; no repository command or event field enters shell text.
  const command = args.map(value => `"${value}"`).join(' ');
  const hooks = Object.fromEntries(['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'SessionEnd', 'Interrupt'].map(name => [name, [{ hooks: [{ type: 'command', command, commandWindows: command, statusMessage: `Harness ${attachmentId} metadata`, timeout: ['SessionEnd', 'Interrupt'].includes(name) ? 3 : 10 }] }]]));
  const content = JSON.stringify({ description: 'Agent_Harness explicit Work metadata observations; no permission authority', hooks }, null, 2);
  const payload = { hash: digest(content), workId, attachmentId, enabled, at: new Date().toISOString() };
  await native.store.put(file, content); await native.store.put(manifest, { ...payload, signature: await native.store.sign(payload) });
  return { workId, attachmentId, artifact: file, feature: 'hooks', installed: true, enabled, trust: 'requires-official-review', observed: false, globalConfigurationChanged: false, authority: 'none' };
}
export async function workHookConfiguration(native: CodexNativeIntegration, attachmentId: string, workId?: string) {
  const attachment = await native.get(attachmentId); const manifest = `runtime/hook-installs/${digest(attachment.home)}.json`;
  let owned: { hash: string; workId: string; attachmentId: string; enabled?: boolean; signature?: string };
  try { owned = await native.store.get(manifest); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  const { signature, ...payload } = owned;
  if (!signature || !await native.store.verify(payload, signature)) throw new HarnessError('HOOK_INSTALL_INTEGRITY_FAILED');
  if (!owned.enabled) return null;
  if (owned.attachmentId !== attachmentId || workId && owned.workId !== workId) throw new HarnessError('HOOK_WORK_SCOPE_DENIED');
  const file = `${path.relative(native.store.root, attachment.home).split(path.sep).join('/')}/hooks.json`;
  const content = await native.store.text(file); if (digest(content) !== owned.hash) throw new HarnessError('HOOK_CONFIG_CONFLICT');
  return (JSON.parse(content) as { hooks: unknown }).hooks;
}
export async function disableWorkHooks(native: CodexNativeIntegration, attachmentId: string) {
  const attachment = await native.get(attachmentId); const file = `runtime/hook-installs/${digest(attachment.home)}.json`;
  await workHookConfiguration(native, attachmentId);
  const { signature: _signature, ...payload } = await native.store.get<Record<string, unknown>>(file);
  void _signature;
  const next = { ...payload, enabled: false }; await native.store.put(file, { ...next, signature: await native.store.sign(next) });
  return { attachmentId, enabled: false, configurationRetainedForReview: true, globalConfigurationChanged: false };
}
export async function bindWorkHookExecution(native: CodexNativeIntegration, work: WorkSessions, attachmentId: string, workId: string, executionSessionId: string) {
  const attachment = await native.get(attachmentId); const session = await work.get(workId);
  if (!await workHookConfiguration(native, attachmentId, workId) || session.projectId !== attachment.projectId || session.workspaceId !== attachment.workspaceId || session.finalizedAt) throw new HarnessError('HOOK_WORK_SCOPE_DENIED');
  const { signature, ...execution } = await native.store.get<{ sessionId: string; attachmentId: string; projectId: string; taskId: string; signature: string }>(`runtime/codex-executions/${executionSessionId}.json`);
  if (!await native.store.verify(execution, signature) || execution.sessionId !== executionSessionId || execution.attachmentId !== attachmentId || execution.projectId !== session.projectId || execution.taskId !== session.taskId) throw new HarnessError('HOOK_EXECUTION_SCOPE_DENIED');
  const payload = { attachmentId, workId, taskId: session.taskId, leaseId: session.leaseId, executionSessionId };
  await native.store.put(`runtime/hook-runs/${attachmentId}.json`, { ...payload, signature: await native.store.sign(payload) });
}
export async function resolveWorkHookExecution(native: CodexNativeIntegration, attachmentId: string, executionSessionId: string | undefined) {
  if (!executionSessionId || !/^native-session-[a-f0-9]{32}$/.test(executionSessionId)) throw new HarnessError('HOOK_EXECUTION_BINDING_REQUIRED');
  await native.get(attachmentId);
  const { signature, ...payload } = await native.store.get<{ attachmentId: string; workId: string; taskId: string; leaseId: string; executionSessionId: string; signature: string }>(`runtime/hook-runs/${attachmentId}.json`);
  if (!await native.store.verify(payload, signature) || payload.attachmentId !== attachmentId || payload.executionSessionId !== executionSessionId) throw new HarnessError('HOOK_EXECUTION_SCOPE_DENIED');
  return payload;
}
export async function inspectWorkHooks(native: CodexNativeIntegration, work: WorkSessions, attachmentId: string) {
  const attachment = await native.get(attachmentId); const hooks = await workHookConfiguration(native, attachmentId); const isolation = await native.hookIsolation(attachmentId);
  await native.authenticationContext(attachment);
  const configuration = runtimeConfiguration(native.store.root, attachment, attachment.taskId, [], { ...(hooks ? { hooks } : {}) });
  if (isolation.status === 'blocked') configuration.features.hooks = false;
  // Inspect effective definitions and trust in the same managed authentication context as execution.
  // No thread/turn is started; commands and private trust database contents are not copied into reports.
  const rpc = new NativeRpc(attachment.executable, attachment.cwd, nativeEnvironment(authenticationHome(attachment), attachment.home), configurationArgs(configuration));
  const definitions = hooks as Record<string, { hooks: { command: string; commandWindows?: string }[] }[]> | null;
  const expectedCommands = new Set(Object.values(definitions ?? {}).flatMap(groups => groups.flatMap(group => group.hooks.flatMap(hook => [hook.command, hook.commandWindows].filter(Boolean)))));
  try {
    await rpc.request('initialize', { clientInfo: { name: 'devagent-hook-inspector', version: '0.4.1' }, capabilities: { experimentalApi: true } }); rpc.notify('initialized');
    const response = await rpc.request<{ data: { hooks: { eventName?: string; event?: string; command?: string; source?: string; enabled: boolean; trustStatus: string; currentHash: string }[]; warnings: string[]; errors: unknown[] }[] }>('hooks/list', { cwds: [attachment.cwd] });
    const configured = response.data.flatMap(entry => entry.hooks).map(hook => { const name = hook.eventName ?? hook.event ?? 'unknown'; return { event: name[0]!.toUpperCase() + name.slice(1), enabled: hook.enabled, trustStatus: hook.trustStatus, definitionHash: hook.currentHash, source: hook.source ?? 'unknown', attachmentScoped: hook.source === 'sessionFlags' && expectedCommands.has(hook.command) }; });
    const foreignDefinitions = configured.filter(item => item.enabled && !item.attachmentScoped).length;
    const records = await work.list(attachment.projectId); const observed = (await Promise.all(records.filter(item => item.workspaceId === attachment.workspaceId).map(item => work.events(item.id)))).flat().filter(event => event.source === 'hook' && event.executionSessionId);
    const blocked = isolation.status === 'blocked' || foreignDefinitions > 0;
    return { attachmentId, enabled: Boolean(hooks), configured, isolation, foreignDefinitions, trustContext: 'explicit managed authentication HOME; same as native execution', observedEvents: [...new Set(observed.map(event => event.name))], status: blocked ? 'blocked' : observed.length ? 'passed' : configured.some(item => item.trustStatus === 'untrusted' || item.trustStatus === 'modified') ? 'blocked' : 'unobserved', reason: blocked ? isolation.reason ?? 'Foreign effective Hook definitions require review' : observed.length ? null : 'Review exact definitions in official CLI /hooks; installation is not callback evidence', warnings: response.data.reduce((count, entry) => count + entry.warnings.length, 0), errors: response.data.reduce((count, entry) => count + entry.errors.length, 0), globalConfigurationChanged: false };
  } finally { await rpc.close(); }
}
