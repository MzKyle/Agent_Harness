import { TaskService } from '../v2/tasks.js';
import { unlink } from 'node:fs/promises';
import { WorkspaceManager } from '../v2/workspace.js';
import { ExternalRegistry } from '../v2/registry.js';
import { HarnessError } from '../v2/contracts.js';
import { filterContent } from '../v2/content.js';
import { digest, newId } from '../v2/store.js';
import { IntelligenceData, canonical, now } from '../v3/data.js';
import { ProjectIdentities } from '../v3/identity.js';
import { EngineeringMemory } from '../v3/memory.js';
import { TaskHistory } from '../v3/profiles.js';
import { changedFiles, workSnapshot } from './work-capture.js';
import { workId, workSchema, workEventSchema, leaseSchema, lifecycleNames, type WorkSession, type WorkEvent } from './work-contracts.js';

export class WorkSessions {
  constructor(readonly data: IntelligenceData, readonly identities: ProjectIdentities, readonly registry: ExternalRegistry, readonly tasks: TaskService,
    readonly workspaces: WorkspaceManager, readonly memory: EngineeringMemory, readonly history: TaskHistory) {}
  async get(id: string) { workId.parse(id); return this.data.signed(`work-sessions/${id}.json`, workSchema); }
  private async save(work: WorkSession) { work.updatedAt = now(); await this.data.writeSigned(`work-sessions/${work.id}.json`, workSchema.parse(work)); }
  async list(project: string) {
    const stable = (await this.identities.resolve(project)).stableProjectId; await this.data.store.directory('work-sessions');
    const envelopes = await this.data.store.list<{ payload: WorkSession }>('work-sessions');
    const records = await Promise.all(envelopes.map(item => this.get(item.payload.id)));
    return records.filter(item => item.projectId === stable).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }
  async forTask(taskId: string) {
    const task = await this.tasks.get(taskId); return (await this.list(task.projectId)).find(item => item.taskId === taskId && item.state !== 'completed') ?? null;
  }
  private async root(work: WorkSession) {
    const record = await this.registry.get(work.projectId);
    if (record.id !== work.bindingId || record.root !== work.sourceRoot) throw new HarnessError('WORK_PROJECT_RELINKED', 'Explicitly resume after reviewing the new project binding');
    return work.workspaceId ? this.workspaces.root(work.workspaceId) : record.root;
  }
  async start(project: string, goal: string, options: { workspaceId?: string; taskId?: string } = {}) {
    if (!goal.trim() || goal.length > 1000 || filterContent(goal).redactions) throw new HarnessError('WORK_GOAL_DENIED');
    const stable = (await this.identities.resolve(project)).stableProjectId; const record = await this.registry.get(stable);
    let task = options.taskId ? await this.tasks.get(options.taskId) : await this.tasks.create(stable, goal, options.workspaceId ? 'isolated' : 'analysis', options.workspaceId ?? null);
    if ((await this.identities.resolve(task.projectId)).stableProjectId !== stable || options.workspaceId && task.workspaceId !== options.workspaceId || !['created', 'ready', 'running'].includes(task.state)) throw new HarnessError('WORK_TASK_SCOPE_DENIED');
    const existing = await this.forTask(task.id); if (existing) return this.public(existing);
    const root = task.workspaceId ? await this.workspaces.root(task.workspaceId) : record.root; const snapshot = await workSnapshot(root);
    const id = newId('work'); const leaseId = newId('lease'); const at = now();
    const work = workSchema.parse({ schemaVersion: 4, id, projectId: stable, taskId: task.id, taskIds: [task.id], goal, state: 'started', mode: task.workspaceId ? 'managed-workspace' : 'external-observation',
      workspaceId: task.workspaceId, sourceRoot: record.root, bindingId: record.id, startedAt: at, updatedAt: at, checkpointAt: null, finalizedAt: null,
      before: snapshot, current: snapshot, threadIds: [], turnIds: [], eventIds: [], leaseId, candidateIds: [], decisions: [], outstanding: [],
      outcome: { changed: [], tested: [], verified: [], failed: [], blocked: [], incomplete: ['No checkpoint or final verification yet'], evidenceIds: [] }, capturePolicy: 'explicit-project-session-metadata-only', authority: 'none' });
    await this.data.writeSigned(`work-leases/${leaseId}.json`, { id: leaseId, workId: id, projectId: stable, taskId: task.id, createdAt: at, revoked: false });
    task = await this.tasks.get(task.id); task.state = 'running'; await this.tasks.save(task); await this.save(work); return this.public(work);
  }
  public(work: WorkSession) {
    const { sourceRoot: _sourceRoot, leaseId: _leaseId, before, current, ...safe } = work;
    return { ...safe, before: { ...before, files: undefined }, current: { ...current, files: undefined }, localLeaseRequired: Boolean(_leaseId), sourcePathStoredLocally: Boolean(_sourceRoot) };
  }
  async events(id: string) {
    await this.get(id); await this.data.store.directory(`work-events/${id}`);
    const envelopes = await this.data.store.list<{ payload: WorkEvent }>(`work-events/${id}`);
    return Promise.all(envelopes.map(item => this.data.signed(`work-events/${id}/${item.payload.id}.json`, workEventSchema)));
  }
  async event(id: string, leaseId: string, raw: unknown, source: WorkEvent['source'] = 'hook') {
    const captured = await this.data.store.locked(`work-session-${id}`, async () => {
      const work = await this.get(id); const lease = await this.data.signed(`work-leases/${work.leaseId}.json`, leaseSchema);
      if (leaseId !== work.leaseId || lease.revoked || lease.workId !== id || lease.projectId !== work.projectId || lease.taskId !== work.taskId) throw new HarnessError('WORK_EVENT_LEASE_DENIED');
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HarnessError('WORK_EVENT_INVALID');
      const input = raw as Record<string, unknown>;
      if (input.task_id !== undefined && input.task_id !== work.taskId || input.project_id !== undefined && input.project_id !== work.projectId) throw new HarnessError('WORK_EVENT_SCOPE_DENIED');
      const name = input.hook_event_name; if (!lifecycleNames.includes(name as typeof lifecycleNames[number])) throw new HarnessError('WORK_EVENT_UNSUPPORTED');
      const metadata = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9_.:/-]{1,120}$/.test(value) && !filterContent(value).redactions ? value : null;
      const threadId = metadata(input.session_id); const turnId = metadata(input.turn_id); const tool = metadata(input.tool_name);
      const callId = metadata(input.event_id ?? input.tool_use_id); const status = input.status === 'failed' ? 'failed' : name === 'Interrupt' ? 'interrupted' : input.status === 'completed' ? 'completed' : 'observed';
      const key = digest(canonical({ workId: id, taskId: work.taskId, name, threadId, turnId, tool, status, callId }));
      const event = workEventSchema.parse({ id: key, workId: id, taskId: work.taskId, projectId: work.projectId, name, source, threadId, turnId, tool, status, at: now(), dedupe: callId ? 'exact' : 'coarse', authority: 'observation-only' });
      if (work.eventIds.includes(key)) return { workId: id, duplicate: true, eventId: key };
      if (work.eventIds.length >= 500 || work.state === 'completed') throw new HarnessError('WORK_EVENT_CLOSED_OR_LIMIT');
      await this.root(work);
      await this.data.writeSigned(`work-events/${id}/${key}.json`, event); work.eventIds.push(key);
      if (threadId && !work.threadIds.includes(threadId)) work.threadIds = [...work.threadIds, threadId].slice(-30);
      if (turnId && !work.turnIds.includes(turnId)) work.turnIds = [...work.turnIds, turnId].slice(-100);
      work.state = name === 'Interrupt' || name === 'SessionEnd' ? 'interrupted' : 'active'; await this.save(work);
      return { workId: id, duplicate: false, eventId: key, savedRawPrompt: false, savedToolInputOrOutput: false };
    });
    const name = (raw as Record<string, unknown>).hook_event_name;
    if (!captured.duplicate && ['Stop', 'SessionEnd', 'Interrupt'].includes(String(name))) await this.checkpoint(id);
    return captured;
  }
  async progress(id: string, decisions: string[] = [], outstanding: string[] = [], resolved: string[] = []) {
    if (decisions.length > 20 || outstanding.length > 20 || resolved.length > 20 || [...decisions, ...outstanding, ...resolved].some(value => !value.trim() || value.length > 1000 || filterContent(value).redactions)) throw new HarnessError('WORK_PROGRESS_DENIED');
    return this.data.store.locked(`work-session-${id}`, async () => {
      const work = await this.get(id); if (work.state === 'completed') throw new HarnessError('WORK_COMPLETED');
      if (work.candidateIds.length + decisions.length + outstanding.length > 100) throw new HarnessError('WORK_CANDIDATE_LIMIT');
      for (const [type, contents] of [['decision', decisions], ['issue', outstanding]] as const) for (const content of contents) {
        const proposed = await this.memory.propose({ domain: 'project', projectId: work.projectId, type, topic: `Work ${type} ${id} ${digest(content).slice(0, 8)}`, content });
        if (!work.candidateIds.includes(proposed.record.id)) work.candidateIds.push(proposed.record.id);
      }
      work.decisions = [...new Set([...work.decisions, ...decisions])].slice(-20); work.outstanding = [...new Set([...work.outstanding, ...outstanding])].filter(value => !resolved.includes(value)).slice(-20); await this.save(work); return this.public(work);
    });
  }
  async checkpoint(id: string, finalize = false) {
    return this.data.store.locked(`work-session-${id}`, async () => {
      const work = await this.get(id); if (work.state === 'completed') return { ...this.public(work), idempotent: true };
      const root = await this.root(work); const current = await workSnapshot(root); const changed = changedFiles(work.before.files, current.files);
      const task = await this.tasks.get(work.taskId); const snapshotComplete = work.before.complete && current.complete;
      if (finalize && work.workspaceId && task.state === 'running') {
        try { await this.tasks.complete(task.id); } catch (error) { task.state = 'failed'; task.reason = error instanceof HarnessError ? error.code : 'WORK_VERIFICATION_FAILED'; task.finishedAt = now(); await this.tasks.save(task); }
      } else if (finalize && !work.workspaceId && task.state === 'running') { task.state = 'succeeded'; task.reason = null; task.finishedAt = now(); await this.tasks.save(task); }
      await this.tasks.report(task.id);
      const summary = await this.history.record(await this.tasks.get(task.id), work.workspaceId ? undefined : { modified: changed, sourceRevision: current.revision });
      const history = await this.data.read(); const related = work.taskIds.flatMap(taskId => history.summaries[taskId] ? [history.summaries[taskId]!] : []);
      work.current = current; work.checkpointAt = now(); work.outcome = { changed, tested: [...new Set(related.flatMap(item => item.tested))].slice(-20), verified: snapshotComplete ? summary.verified : [], failed: [...new Set(related.flatMap(item => item.failed))].slice(-20), blocked: summary.blocked,
        incomplete: [...new Set([...summary.incomplete, ...work.outstanding, ...(!snapshotComplete ? ['Source snapshot incomplete; no complete verification claim'] : []), ...(!work.workspaceId && changed.length ? ['External changes have no matching isolated verification evidence'] : [])])].map(value => value.slice(0, 200)).slice(0, 20), evidenceIds: [...new Set(related.flatMap(item => item.evidenceIds))].slice(-20) };
      if (finalize) { work.state = 'completed'; work.finalizedAt = now(); const lease = await this.data.signed(`work-leases/${work.leaseId}.json`, leaseSchema); lease.revoked = true; await this.data.writeSigned(`work-leases/${work.leaseId}.json`, lease); }
      await this.save(work); return this.public(work);
    });
  }
  async resume(id: string, acceptChange = false) {
    return this.data.store.locked(`work-session-${id}`, async () => {
    const work = await this.get(id); const record = await this.registry.get(work.projectId);
    const root = work.workspaceId ? await this.workspaces.root(work.workspaceId) : record.root; const current = await workSnapshot(root);
    const drift = current.sourceDigest !== work.current.sourceDigest || current.revision !== work.current.revision || record.root !== work.sourceRoot;
    if (drift && !acceptChange) return { workId: id, status: 'review-required', reason: 'Git revision, content or project binding changed', permissionsRestored: false };
    if (work.taskIds.length >= 30) throw new HarnessError('WORK_RESUME_LIMIT');
    const task = await this.tasks.create(work.projectId, work.goal, work.workspaceId ? 'isolated' : 'analysis', work.workspaceId); task.state = 'running'; await this.tasks.save(task);
    work.taskId = task.id; work.taskIds.push(task.id); work.state = 'active'; work.finalizedAt = null; work.sourceRoot = record.root; work.bindingId = record.id;
    work.leaseId = newId('lease'); await this.data.writeSigned(`work-leases/${work.leaseId}.json`, { id: work.leaseId, workId: id, projectId: work.projectId, taskId: task.id, createdAt: now(), revoked: false });
    work.current = current; work.outcome.verified = []; work.outcome.incomplete = ['Resumed task needs its own final-revision evidence and a fresh plan']; await this.save(work);
    return { ...this.public(work), driftReviewed: drift, modelHiddenStateRestored: false, permissionsRestored: false };
    });
  }
  async delete(id: string) {
    return this.data.store.locked(`work-session-${id}`, async () => {
      const work = await this.get(id); const events = await this.events(id);
      // Revoke first. A crash leaves a closed local lease, never restored authority.
      const lease = await this.data.signed(`work-leases/${work.leaseId}.json`, leaseSchema); lease.revoked = true; await this.data.writeSigned(`work-leases/${work.leaseId}.json`, lease);
      await this.data.edit(data => { for (const taskId of work.taskIds) delete data.summaries[taskId];
        for (const memory of Object.values(data.memories)) if (work.candidateIds.includes(memory.id) || memory.type === 'task-summary' && memory.references.some(ref => ref.kind === 'task' && work.taskIds.includes(ref.ref))) delete data.memories[memory.id]; });
      for (const event of events) await unlink(this.data.store.resolve(`work-events/${id}/${event.id}.json`));
      await unlink(this.data.store.resolve(`work-sessions/${id}.json`));
      return { id, deleted: true, scope: 'Work metadata, events, linked summaries and memory candidates', retained: 'Tasks, execution evidence, patches, backups and exports have separate retention; no global Codex history was collected' };
    });
  }
  async context(project: string) {
    const records = (await this.list(project)).slice(0, 3); if (!records.length) return [];
    const lines: string[] = [];
    for (const work of records) {
      lines.push(`Work ${work.id}: ${work.state}; goal=${work.goal.slice(0, 200)}; changed=${work.outcome.changed.length}; verified=${work.outcome.verified.join(',') || 'none'}`);
      lines.push(...work.outcome.incomplete.slice(0, 2).map(value => `Pending verification/outstanding: ${value}`));
      lines.push(...work.decisions.slice(-2).map(value => `Recent decision candidate (unreviewed): ${value}`));
      try { const current = await workSnapshot(await this.root(work)); lines.push(`Current Git: revision=${current.revision}; clean=${current.clean}; contentChangedSinceCheckpoint=${current.sourceDigest !== work.current.sourceDigest}`); }
      catch { lines.push('Work binding unavailable; relink/review before resuming. Historical evidence is not current permission.'); }
    }
    return lines;
  }
}
