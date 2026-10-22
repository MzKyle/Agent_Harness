import { HarnessError, filterContent, digest, workSnapshot, WorkflowValidator, selectEngineeringMode, modeTools, toolCategory, readMcpReceipts, type EngineeringMode, type WorkSessions } from '@devagent/core';
import { type CodexNativeIntegration, nativeEnvironment } from './index.js';
import { authenticationHome, authenticationLock } from './runtime.js';
import { nativeExec } from './events.js';
import { installWorkHooks, workHookConfiguration, bindWorkHookExecution } from './hooks.js';
interface Receipt { tool: string; status: string; taskId: string; projectId: string; signature: string; at: string; queryHash?: string; cacheHit?: boolean; contextBytes?: number; resultBytes?: number }

// Launch the official Codex runtime once. Harness does not implement a model/agent loop.
export async function runNativeWork(native: CodexNativeIntegration, work: WorkSessions, attachmentId: string, goal: string, options: { coding?: boolean; workId?: string; timeoutMs?: number; baseline?: boolean; hooks?: boolean; mode?: EngineeringMode; answerOracle?: (answer: string) => boolean | { passed: boolean; checks: Record<string, boolean> } } = {}) {
  const totalStartedAt = Date.now();
  const { store, registry, tasks } = native; const attachment = await native.get(attachmentId); const record = await registry.get(attachment.projectId);
  const selection = selectEngineeringMode(options.mode, goal, { componentCount: record.config.components.length, continuation: Boolean(options.workId) });
  if (record.kind !== 'fixture' || record.sourceSharing !== 'fixture-only') throw new HarnessError('blocked_by_source_consent');
  if (!goal.trim() || goal.length > 12000 || filterContent(goal).redactions) throw new HarnessError('NATIVE_GOAL_DENIED');
  if (options.hooks && !options.baseline && (await native.hookIsolation(attachmentId)).status !== 'passed') throw new HarnessError('HOOK_AUTH_CONTEXT_ISOLATION_BLOCKED', 'Use a fresh dedicated managed login for Hooks, or continue without --hooks');
  return store.locked(authenticationLock(attachment), async () => {
    const inspection = await native.inspect(attachmentId); if (inspection.authentication !== 'authenticated') throw new HarnessError('blocked_by_auth');
    const before = await workSnapshot(record.root);
    const active = options.workId ? await work.get(options.workId) : null;
    if (active && (active.projectId !== attachment.projectId || active.workspaceId !== attachment.workspaceId || active.state === 'completed' || active.finalizedAt)) throw new HarnessError('NATIVE_WORK_SCOPE_DENIED');
    const task = active ? await tasks.get(active.taskId) : await tasks.create(attachment.projectId, goal, options.coding ? 'isolated' : 'analysis', attachment.workspaceId);
    if (options.coding && task.mode !== 'isolated') throw new HarnessError('NATIVE_CODING_SCOPE_DENIED');
    const started = active ?? await work.get((await work.start(attachment.projectId, goal.slice(0, 1000), { taskId: task.id, workspaceId: attachment.workspaceId })).id);
    const validator = new WorkflowValidator(work.data, tasks, registry, native.workspaces); await validator.begin(task.id);
    if (options.hooks && !options.baseline) await installWorkHooks(native, work, attachmentId, started.id, true);
    const basicTools = modeTools('fast', Boolean(options.coding), false, true);
    const tools = modeTools(selection.mode, Boolean(options.coding), attachment.personalContext, options.baseline);
    const approvals = (await store.list<{ workspaceId: string; id: string }>('approvals')).filter(item => item.workspaceId === attachment.workspaceId).map(item => item.id);
    const enhanced = !options.baseline && selection.mode !== 'fast';
    const useSkill = enhanced && inspection.skillDiscovered;
    const prompt = `${enhanced ? `${useSkill ? 'Use $devagent-project-engineering.' : 'Use scoped Harness MCP; the native Skill is not discovered.'} Load only relevant context once; query history/diagnostics when needed.` : 'Solve the task using scoped I/O; compact context is optional if available.'} Project=${attachment.projectId}; task=${task.id}; mode=${selection.mode}. Only MCP may query/edit the bound workspace or run approved commands. No host tools or other paths. ${options.coding ? `Submit a structured plan; preserve public APIs and tests. This Task has ${task.maxAttempts - task.attempts} execution attempts remaining. Finish every code/test edit before final passing runs; do not edit after verification. Run every approved command at the final revision: ${approvals.join(',')}.` : 'Read-only diagnosis; no edits or execution.'} ${enhanced ? 'Record material decisions and outstanding items, resolve completed items explicitly.' : ''} Goal: ${goal}`;
    const at = Date.now();
    const hooks = options.hooks && !options.baseline ? await workHookConfiguration(native, attachmentId, started.id) : null;
    const execution = await native.executionConfiguration(attachmentId, task.id, tools, { skill: useSkill, mode: selection.mode, contextBudget: selection.contextBudget, ...(hooks ? { hooks } : {}) });
    if (hooks) await bindWorkHookExecution(native, work, attachmentId, started.id, execution.sessionId);
    const result = await nativeExec(attachment.executable, ['exec', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--json', '--sandbox', 'read-only', '-C', attachment.cwd, ...(inspection.defaultModel ? ['--model', inspection.defaultModel] : []), '-c', 'model_reasoning_effort="low"', ...execution.args, prompt], attachment.cwd, { ...nativeEnvironment(authenticationHome(attachment), attachment.home), DEVAGENT_NATIVE_SESSION: execution.sessionId }, options.timeoutMs, native.processJournal(execution.sessionId)).catch(error => ({ code: null, timedOut: false, limited: false, metadata: [], finalText: '', completedTurns: 0, usage: {}, failures: [], launchError: error instanceof HarnessError ? error.code : 'NATIVE_LAUNCH_FAILED' }));
    const latest = await tasks.get(task.id); latest.modelCalls = result.completedTurns; await tasks.save(latest);
    for (const event of result.metadata.filter(item => item.type === 'thread.started')) await work.event(started.id, started.leaseId, { hook_event_name: 'SessionStart', session_id: event.id, event_id: event.hash }, 'native-event');
    const interrupted = result.code !== 0 || result.timedOut || !result.completedTurns;
    await work.event(started.id, started.leaseId, { hook_event_name: interrupted ? 'Interrupt' : 'Stop', event_id: digest(JSON.stringify(result.metadata)) }, 'native-event');
    if (result.code !== 0 || result.timedOut || !result.completedTurns) { const failed = await tasks.get(task.id); failed.state = 'failed'; failed.reason = result.timedOut ? 'NATIVE_TIMEOUT' : 'NATIVE_TURN_FAILED'; await tasks.save(failed); }
    const finalized = await work.checkpoint(started.id, true, { interrupted }); const after = await workSnapshot(record.root);
    const raw = await readMcpReceipts<Receipt>(store, task.id, true); const receipts: Receipt[] = [];
    for (const receipt of raw) { const { signature, ...payload } = receipt; if (receipt.taskId === task.id && receipt.projectId === attachment.projectId && await store.verify(payload, signature)) receipts.push(receipt); }
    receipts.sort((a, b) => a.at.localeCompare(b.at));
    const modelEdited = receipts.some(item => item.tool === 'write_workspace_code' && item.status === 'completed');
    const sourceUnchanged = before.complete && after.complete && before.sourceDigest === after.sourceDigest && before.statusHash === after.statusHash && before.revision === after.revision;
    const validation = options.coding ? await validator.validate(task.id) : null;
    const oracle = options.answerOracle ? options.answerOracle(result.finalText) : null;
    const answerCorrect = oracle && typeof oracle === 'object' ? oracle.passed : oracle;
    const answerChecks = oracle && typeof oracle === 'object' ? Object.fromEntries(Object.entries(oracle.checks).filter(([key, value]) => /^[a-zA-Z0-9_]{1,60}$/.test(key) && typeof value === 'boolean').slice(0, 20)) : null;
    const passed = result.code === 0 && result.completedTurns > 0 && sourceUnchanged && answerCorrect !== false && (!options.coding || validation?.status === 'passed' && finalized.engineeringOutcome === 'verified' && (await tasks.get(task.id)).state === 'succeeded');
    const observedHooks = [...new Set((await work.events(started.id)).filter(item => item.source === 'hook' && item.executionSessionId === execution.sessionId).map(item => item.name))];
    const report = { status: passed ? 'passed' : 'failed', workId: started.id, taskId: task.id, attachmentId, mode: options.coding ? 'autonomous-coding' : 'diagnosis', modelEdited, sourceUnchanged, elapsedMs: Date.now() - at, nativeExitCode: result.code, timedOut: result.timedOut, completedTurns: result.completedTurns, usage: result.usage, toolCalls: receipts.length, tools: receipts.map(item => item.tool), observedHooks, outcome: finalized.outcome, capturePolicy: 'metadata-only', nativeReadIsolation: 'Not a full host filesystem read isolation claim; fixture only' };
    const categories = Object.fromEntries([...new Set(receipts.map(item => toolCategory(item.tool)))].map(category => [category, receipts.filter(item => toolCategory(item.tool) === category).length]));
    const actualExecutions = (await tasks.execution.evidence.list(task.id)).filter(item => item.exitCode !== null && item.isolation === 'verified-isolated');
    const detail = { ...report, elapsedMs: Date.now() - totalStartedAt, nativeExecutionMs: Date.now() - at, selection, exposedTools: tools, exposedToolCount: tools.length, promptBytes: Buffer.byteLength(prompt), contextBytes: receipts.reduce((sum, item) => sum + (item.contextBytes ?? 0), 0), duplicateQueries: receipts.length - new Set(receipts.map((item, index) => item.queryHash ?? `legacy-${index}`)).size, cacheHits: receipts.filter(item => item.cacheHit).length, toolCategories: categories, testExecutions: receipts.filter(item => item.tool === 'run_approved_command').length, engineeringOutcome: finalized.engineeringOutcome, evidenceStatus: finalized.evidenceStatus, executionSessionId: execution.sessionId, configurationHash: execution.configurationHash, validation, answerCorrect, model: inspection.defaultModel, nativeVersion: inspection.nativeVersion, reasoningEffort: 'low', variant: options.baseline ? 'native-with-scoped-io-only' : `harness-${selection.mode}`, humanInterventionsDuringRun: 0, harnessContextCalls: receipts.filter(item => !basicTools.includes(item.tool)).length, usageMetric: 'Official CLI usage; not billed tokens or an exact request count', modelRequests: null };
    const checked = { ...detail, answerChecks, nativeFailureMetadata: result.failures, nativeSkillConfigured: useSkill, harnessProvisionedContext: attachment.skillPath ? ['.agents/skills/devagent-native-bridge/SKILL.md'] : [], testExecutions: actualExecutions.length, testCommandAttempts: receipts.filter(item => item.tool === 'run_approved_command').length, contextToolResultBytes: receipts.filter(item => toolCategory(item.tool) === 'context').reduce((sum, item) => sum + (item.resultBytes ?? 0), 0), contextMetric: 'contextBytes is brief text UTF-8 bytes; contextToolResultBytes counts all scoped context results; total model context is not exposed', lastVerifiedRevision: finalized.lastVerifiedRevision, toolCallMetric: 'Signed scoped MCP completion/denial receipts; upstream schema rejections are not exposed here' };
    await store.put(`artifacts/${task.id}/native-events.json`, result.metadata); await store.put(`reports/${task.id}.native-work.json`, checked); return checked;
  });
}
