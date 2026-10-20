import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HarnessError, filterContent, digest, workSnapshot, WorkflowValidator, type WorkSessions } from '@devagent/core';
import { type CodexNativeIntegration, nativeEnvironment } from './index.js';
import { nativeExec } from './events.js';
import { installWorkHooks } from './hooks.js';
const root = fileURLToPath(new URL('../../../', import.meta.url));
interface Receipt { tool: string; status: string; taskId: string; projectId: string; signature: string; at: string }

// Launch the official Codex runtime once. Harness does not implement a model/agent loop.
export async function runNativeWork(native: CodexNativeIntegration, work: WorkSessions, attachmentId: string, goal: string, options: { coding?: boolean; workId?: string; timeoutMs?: number; baseline?: boolean; answerOracle?: (answer: string) => boolean } = {}) {
  const { store, registry, tasks } = native; const attachment = await native.get(attachmentId); const record = await registry.get(attachment.projectId);
  if (record.kind !== 'fixture' || record.sourceSharing !== 'fixture-only') throw new HarnessError('blocked_by_source_consent');
  if (!goal.trim() || goal.length > 12000 || filterContent(goal).redactions) throw new HarnessError('NATIVE_GOAL_DENIED');
  return store.locked(`native-${digest(attachment.home)}`, async () => {
    const inspection = await native.inspect(attachmentId); if (inspection.authentication !== 'authenticated') throw new HarnessError('blocked_by_auth');
    const before = await workSnapshot(record.root);
    const active = options.workId ? await work.get(options.workId) : null;
    if (active && (active.projectId !== attachment.projectId || active.workspaceId !== attachment.workspaceId || active.state === 'completed')) throw new HarnessError('NATIVE_WORK_SCOPE_DENIED');
    const task = active ? await tasks.get(active.taskId) : await tasks.create(attachment.projectId, goal, options.coding ? 'isolated' : 'analysis', attachment.workspaceId);
    if (options.coding && task.mode !== 'isolated') throw new HarnessError('NATIVE_CODING_SCOPE_DENIED');
    const started = active ?? await work.get((await work.start(attachment.projectId, goal.slice(0, 1000), { taskId: task.id, workspaceId: attachment.workspaceId })).id);
    const validator = new WorkflowValidator(work.data, tasks, registry, native.workspaces); await validator.begin(task.id);
    if (!options.baseline) await installWorkHooks(native, work, attachmentId, started.id);
    const basicTools = ['search_code', 'read_code_slice', 'get_task_failures', ...(options.coding ? ['submit_plan', 'write_workspace_code', 'run_approved_command', 'get_workspace_diff', 'summarize_test_results'] : [])];
    const tools = options.baseline ? basicTools : [...basicTools, 'get_context_brief', 'get_project_profile', 'get_recent_work', 'find_symbol', 'get_module_dependencies', 'get_project_rules', 'get_project_capabilities', 'search_project_memory', 'query_diagnostics', 'get_work_sessions', 'get_work_status', 'get_runtime_diagnostics', 'get_error_timeline', 'get_state_consistency', 'get_regression_context', 'record_work_progress', ...(options.coding ? ['record_capability_gap', 'run_project_capability'] : [])];
    if (!options.baseline && attachment.personalContext) tools.push('get_developer_profile', 'get_relevant_preferences');
    const args = [path.join(root, 'packages/diagnostics-mcp/dist/main.js'), '--home', store.root, '--project', attachment.projectId, '--task', task.id, ...(attachment.personalContext ? ['--personal-context'] : [])];
    const approvals = (await store.list<{ workspaceId: string; id: string }>('approvals')).filter(item => item.workspaceId === attachment.workspaceId).map(item => item.id);
    const prompt = `${options.baseline ? 'Use the available scoped I/O tools to solve the task.' : 'Use $devagent-project-engineering and Harness MCP; start with get_context_brief.'} Project=${attachment.projectId}; task=${task.id}. Only MCP can query/edit the bound workspace and run approved commands. Do not use host tools or access other paths. ${options.coding ? `Submit a structured plan, inspect the failure, implement the fix using write_workspace_code, then run each approved command at the final revision: ${approvals.join(',')}. Keep public APIs. Tests/graders must not be weakened.` : 'Read-only diagnosis; no edits or execution.'} ${options.baseline ? '' : 'Record decisions and outstanding verification with record_work_progress; resolve completed items explicitly.'} Goal: ${goal}`;
    const at = Date.now();
    const baselineFlags = options.baseline ? ['-c', 'features.hooks=false', '-c', `skills.config=[${['skills/devagent-project-engineering', '.agents/skills/devagent-project-engineering'].map(file => `{path=${JSON.stringify(path.join(attachment.home, file))},enabled=false}`).join(',')}]`] : [];
    const result = await nativeExec(attachment.executable, ['exec', '--ephemeral', '--json', '--sandbox', 'read-only', '-C', attachment.cwd, ...(inspection.defaultModel ? ['--model', inspection.defaultModel] : []), '-c', 'model_reasoning_effort="low"', ...baselineFlags,
      '-c', `mcp_servers.devagent.args=${JSON.stringify(args)}`, '-c', `mcp_servers.devagent.enabled_tools=${JSON.stringify(tools)}`, prompt], attachment.cwd, nativeEnvironment(attachment.home), options.timeoutMs);
    const latest = await tasks.get(task.id); latest.modelCalls = result.completedTurns; await tasks.save(latest);
    for (const event of result.metadata.filter(item => item.type === 'thread.started')) await work.event(started.id, started.leaseId, { hook_event_name: 'SessionStart', session_id: event.id, event_id: event.hash }, 'native-event');
    await work.event(started.id, started.leaseId, { hook_event_name: result.timedOut ? 'Interrupt' : 'Stop', event_id: digest(JSON.stringify(result.metadata)) }, 'native-event');
    if (result.code !== 0 || result.timedOut || !result.completedTurns) { const failed = await tasks.get(task.id); failed.state = 'failed'; failed.reason = result.timedOut ? 'NATIVE_TIMEOUT' : 'NATIVE_TURN_FAILED'; await tasks.save(failed); }
    const finalized = await work.checkpoint(started.id, true); const after = await workSnapshot(record.root);
    const raw = await store.list<Receipt>(`artifacts/${task.id}/mcp-receipts`).catch(() => []); const receipts: Receipt[] = [];
    for (const receipt of raw) { const { signature, ...payload } = receipt; if (receipt.taskId === task.id && receipt.projectId === attachment.projectId && await store.verify(payload, signature)) receipts.push(receipt); }
    receipts.sort((a, b) => a.at.localeCompare(b.at));
    const modelEdited = receipts.some(item => item.tool === 'write_workspace_code' && item.status === 'completed');
    const sourceUnchanged = before.complete && after.complete && before.sourceDigest === after.sourceDigest && before.statusHash === after.statusHash && before.revision === after.revision;
    const validation = options.coding ? await validator.validate(task.id) : null;
    const answerCorrect = options.answerOracle ? options.answerOracle(result.finalText) : null;
    const passed = result.code === 0 && result.completedTurns > 0 && sourceUnchanged && (options.baseline || receipts.some(item => item.tool === 'get_context_brief')) && answerCorrect !== false && (!options.coding || (modelEdited || Boolean(options.workId && finalized.outcome.changed.length)) && validation?.status === 'passed' && (await tasks.get(task.id)).state === 'succeeded');
    const observedHooks = [...new Set((await work.events(started.id)).filter(item => item.source === 'hook').map(item => item.name))];
    const report = { status: passed ? 'passed' : 'failed', workId: started.id, taskId: task.id, attachmentId, mode: options.coding ? 'autonomous-coding' : 'diagnosis', modelEdited, sourceUnchanged, elapsedMs: Date.now() - at, nativeExitCode: result.code, timedOut: result.timedOut, completedTurns: result.completedTurns, usage: result.usage, toolCalls: receipts.length, tools: receipts.map(item => item.tool), observedHooks, outcome: finalized.outcome, capturePolicy: 'metadata-only', nativeReadIsolation: 'Not a full host filesystem read isolation claim; fixture only' };
    const detail = { ...report, validation, answerCorrect, model: inspection.defaultModel, reasoningEffort: 'low', variant: options.baseline ? 'native-with-scoped-io-only' : 'harness-enhanced', humanInterventionsDuringRun: 0, harnessContextCalls: receipts.filter(item => !basicTools.includes(item.tool)).length };
    await store.put(`artifacts/${task.id}/native-events.json`, result.metadata); await store.put(`reports/${task.id}.native-work.json`, detail); return detail;
  });
}
