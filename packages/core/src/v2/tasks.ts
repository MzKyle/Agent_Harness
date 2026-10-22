import { StateStore, newId } from './store.js';
import { ExternalRegistry } from './registry.js';
import { WorkspaceManager } from './workspace.js';
import { ExecutionEngine } from './execution.js';
import { CodeIntelligence } from './code.js';
import { projectRules } from './rules.js';
import { isolationCheck } from './isolation.js';
import { taskSchema, planSchema, gapSchema, type Task, HarnessError } from './contracts.js';
import { filterContent } from './content.js';

export interface AgentDriver { run(task: Task, options: { signal?: AbortSignal; codex: boolean }): Promise<{ status: 'completed' | 'blocked' | 'failed'; reason: string | null; model: string | null; modelCalls: number }> }
export class TaskService {
  onReported?: (task: Task) => Promise<void>;
  onGap?: (task: Task, gapId: string, report: unknown) => Promise<void>;
  constructor(readonly store: StateStore, readonly registry: ExternalRegistry, readonly workspaces: WorkspaceManager, readonly execution: ExecutionEngine, readonly code: CodeIntelligence) {}
  async get(id: string) { if (!/^task-[a-f0-9]{32}$/.test(id)) throw new HarnessError('TASK_ID_DENIED'); return taskSchema.parse(await this.store.get(`tasks/${id}.json`)); }
  async create(projectId: string, prompt: string, mode: Task['mode'], workspaceId: string | null = null) {
    await this.registry.get(projectId);
    const filtered = filterContent(prompt); if (filtered.redactions) throw new HarnessError('SENSITIVE_TASK_PROMPT_DENIED');
    if (workspaceId && (await this.registry.get((await this.workspaces.get(workspaceId)).projectId)).id !== (await this.registry.get(projectId)).id) throw new HarnessError('WORKSPACE_PROJECT_MISMATCH');
    const task = taskSchema.parse({ schemaVersion: 2, id: newId('task'), projectId, workspaceId, prompt, mode, state: 'created', reason: null,
      createdAt: new Date().toISOString(), finishedAt: null, plan: null, evidenceIds: [], gapIds: [], toolCalls: 0, attempts: 0, maxAttempts: 3, model: null, modelCalls: 0, humanInterventions: 0 });
    await this.save(task); return task;
  }
  async save(task: Task) { await this.store.put(`tasks/${task.id}.json`, taskSchema.parse(task)); }
  async submitPlan(id: string, input: unknown) {
    return this.store.locked(id, async () => {
    const task = await this.get(id); task.plan = planSchema.parse(input);
    if (!['created', 'running'].includes(task.state)) throw new HarnessError('TASK_TERMINAL');
    const inspected = filterContent(JSON.stringify(task.plan), 'rules'); if (inspected.redactions || inspected.injectionWarnings.length) throw new HarnessError('UNSAFE_PLAN_REFUSED');
    await this.store.put(`plans/${id}.json`, { taskId: id, projectId: task.projectId, workspaceId: task.workspaceId, plan: task.plan }); await this.save(task); return { taskId: id, status: 'plan-accepted' };
    });
  }
  async gap(id: string, input: unknown) {
    return this.store.locked(id, async () => {
    const task = await this.get(id); const gap = gapSchema.parse(input); const gapId = newId('gap');
    if (task.gapIds.length >= 20) throw new HarnessError('TASK_GAP_LIMIT');
    const safe = filterContent(JSON.stringify(gap), 'rules'); if (safe.redactions) throw new HarnessError('SENSITIVE_GAP_REFUSED');
    await this.store.put(`gaps/${gapId}.json`, { taskId: id, projectId: task.projectId, gap }); task.gapIds.push(gapId); await this.save(task); await this.onGap?.(task, gapId, gap); return { gapId, taskId: id };
    });
  }
  private async coding(id: string) {
    const task = await this.get(id);
    if (task.mode !== 'isolated' || !task.workspaceId || task.state !== 'running' || !task.plan) throw new HarnessError('CODING_PLAN_GATE');
    if (task.toolCalls >= 60) throw new HarnessError('TASK_TOOL_BUDGET');
    task.toolCalls++; await this.save(task); return task;
  }
  async requireCoding(id: string) { return this.store.locked(id, () => this.coding(id)); }
  async runApproved(id: string, commandId: string, signal?: AbortSignal) {
    const task = await this.store.locked(id, async () => {
    const task = await this.coding(id);
    if (task.attempts >= task.maxAttempts) throw new HarnessError('TASK_ATTEMPT_LIMIT');
    task.attempts++; await this.save(task); return task;
    });
    const evidence = await this.execution.run(task.workspaceId!, commandId, id, signal);
    await this.store.locked(id, async () => { const latest = await this.get(id); latest.evidenceIds.push(evidence.id); await this.save(latest); }); return evidence;
  }
  async verifyCompletion(task: Task) {
    if (task.mode !== 'isolated') return;
    if (!task.workspaceId || !task.plan) throw new HarnessError('MISSING_FINAL_VERIFICATION');
    const revision = await this.workspaces.workingRevision(task.workspaceId);
    const commands = (await this.store.list<{ workspaceId: string; id: string }>('approvals')).filter(command => command.workspaceId === task.workspaceId);
    const definitions = new Map(await Promise.all(commands.map(async item => [item.id, await this.execution.approved(task.workspaceId!, item.id)] as const)));
    const workspace = await this.workspaces.get(task.workspaceId);
    const verified = new Set<string>();
    for (const id of task.evidenceIds) {
      const evidence = await this.execution.evidence.get(id);
      if (evidence.taskId !== task.id || evidence.workspaceId !== task.workspaceId) throw new HarnessError('TASK_EVIDENCE_SCOPE_DENIED');
      const definition = definitions.get(evidence.commandId);
      const matchesDefinition = definition && evidence.sourceRevision === workspace.sourceRevision && evidence.command.executable === definition.executable && evidence.command.cwd === definition.cwd && JSON.stringify(evidence.command.args) === JSON.stringify(definition.args);
      if (matchesDefinition && await this.execution.evidence.isVerified(id, revision)) verified.add(evidence.commandId);
    }
    if (!commands.length || !commands.every(command => verified.has(command.id))) throw new HarnessError('MISSING_FINAL_VERIFICATION');
    await this.workspaces.diff(task.workspaceId);
  }
  async complete(id: string) {
    return this.store.locked(id, async () => {
      const task = await this.get(id); if (task.state !== 'running') throw new HarnessError('TASK_NOT_RUNNING');
      await this.verifyCompletion(task); task.state = 'succeeded'; task.reason = null; task.finishedAt = new Date().toISOString(); await this.save(task); return task;
    });
  }
  async run(projectId: string, prompt: string, mode: Task['mode'], driver: AgentDriver, options: { workspaceId?: string; codex?: boolean; signal?: AbortSignal } = {}) {
    let task = await this.create(projectId, prompt, mode, options.workspaceId ?? null);
    try {
      const project = await this.registry.get(projectId);
      await projectRules(this.registry, projectId);
      if (mode === 'isolated') {
        if (!task.workspaceId) { task.workspaceId = (await this.workspaces.create(projectId)).id; await this.save(task); }
        const isolation = await isolationCheck(this.store);
        if (!isolation.verified) throw new HarnessError('blocked_by_isolation', isolation.remedy);
      }
      if (project.kind !== 'fixture' || project.sourceSharing !== 'fixture-only') throw new HarnessError('blocked_by_source_consent');
      task.state = 'running'; await this.save(task);
      const result = await driver.run(task, { ...(options.signal ? { signal: options.signal } : {}), codex: Boolean(options.codex) });
      task = await this.get(task.id); task.model = result.model; task.modelCalls = result.modelCalls;
      if (result.status === 'blocked') throw new HarnessError(result.reason ?? 'blocked_by_auth');
      if (result.status !== 'completed') throw new HarnessError(result.reason ?? 'AGENT_FAILED');
      await this.verifyCompletion(task);
      task.state = 'succeeded'; task.reason = null;
    } catch (error) {
      task = await this.get(task.id); task.reason = error instanceof HarnessError ? error.code : 'TASK_FAILED';
      task.state = task.reason.startsWith('blocked') || task.reason === 'RULES_NOT_AUTHORIZED' ? 'blocked' : options.signal?.aborted ? 'cancelled' : 'failed';
      if (task.workspaceId) { await this.workspaces.update(task.workspaceId, task.state); try { await this.workspaces.diff(task.workspaceId); } catch { /* Retain primary failure. */ } }
      await this.gap(task.id, { gap: task.reason, why: 'Task stopped at an enforced capability gate', existingAlternative: 'Use supported local analysis or configure the explicitly required isolated runtime', crossProject: true, needsAdapter: false, suggestion: 'Resolve the specific blocker and rerun; retain this task as evidence', risks: ['Do not bypass safety or copy production credentials'], requiresApproval: true });
      const latest = await this.get(task.id); task.gapIds = latest.gapIds;
    }
    task.finishedAt = new Date().toISOString(); await this.save(task); await this.report(task.id); return task;
  }
  async report(id: string) {
    const task = await this.get(id); const evidence = await this.execution.evidence.report(id);
    let diff: unknown = null; if (task.workspaceId) try { diff = await this.workspaces.diff(task.workspaceId); } catch { diff = { status: 'unavailable' }; }
    const report = { task, evidence, diff, gaps: await Promise.all(task.gapIds.map((gap) => this.store.get(`gaps/${gap}.json`))),
      risks: ['Patch is never applied to the original source', 'Online success requires actual model and final-revision verification evidence'],
      impact: task.plan?.affectedModules ?? [], summary: task.state === 'succeeded' ? task.mode === 'analysis' ? 'Analysis completed; no implemented feature verified' : 'Completed with recorded evidence' : `Not completed: ${task.reason}` };
    await this.store.put(`reports/${id}.json`, report);
    await this.store.put(`reports/${id}.md`, `# Task ${id}\n\nStatus: **${task.state}**\n\nReason: ${task.reason ?? 'none'}\n\nWorkspace: ${task.workspaceId ?? 'none'}\n\n${evidence.markdown}\n\nPatch retained for human review; original source is not modified.\n`);
    await this.onReported?.(task); return report;
  }
}
