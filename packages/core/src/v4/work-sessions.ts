import { TaskService } from '../v2/tasks.js';
import { unlink, readdir } from 'node:fs/promises';
import { WorkspaceManager } from '../v2/workspace.js';
import { ExternalRegistry } from '../v2/registry.js';
import { HarnessError } from '../v2/contracts.js';
import { filterContent } from '../v2/content.js';
import { digest, newId } from '../v2/store.js';
import { IntelligenceData, canonical, now } from '../v3/data.js';
import { ProjectIdentities } from '../v3/identity.js';
import { EngineeringMemory, relevance } from '../v3/memory.js';
import { TaskHistory } from '../v3/profiles.js';
import { changedFiles, workSnapshot } from './work-capture.js';
import { revision } from '../v2/git.js';
import { workId, workSchema, workEventSchema, leaseSchema, lifecycleNames, type WorkSession, type WorkEvent } from './work-contracts.js';
import { WorkRecovery } from './work-recovery.js';

export class WorkSessions {
  constructor(readonly data: IntelligenceData, readonly identities: ProjectIdentities, readonly registry: ExternalRegistry, readonly tasks: TaskService,
    readonly workspaces: WorkspaceManager, readonly memory: EngineeringMemory, readonly history: TaskHistory) {}
  private async stored(id: string) {
    workId.parse(id);
    try { return await this.data.signed(`work-sessions/${id}.json`, workSchema); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return this.data.signed(`work-archive/${id.slice(-2)}/${id}.json`, workSchema); }
  }
  async get(id: string) {
    const work = await this.stored(id);
    if (work.outcome.verified.length || work.engineeringOutcome === 'verified') {
      try {
        const record = await this.registry.get(work.projectId); const task = await this.tasks.get(work.taskId);
        if (!work.workspaceId || record.id !== work.bindingId || record.root !== work.sourceRoot || task.state !== 'succeeded' || task.mode !== 'isolated') throw new HarnessError('WORK_STALE');
        const workspace = await this.workspaces.get(work.workspaceId);
        if (revision(record.root) !== workspace.sourceRevision) throw new HarnessError('WORK_SOURCE_REVISION_DRIFT');
        if (work.sourceBaseline) {
          const source = await workSnapshot(record.root);
          if (!source.complete || source.sourceDigest !== work.sourceBaseline.sourceDigest || source.statusHash !== work.sourceBaseline.statusHash) throw new HarnessError('WORK_SOURCE_REVISION_DRIFT');
        }
        const workingRevision = await this.workspaces.workingRevision(work.workspaceId);
        if (work.lastVerifiedRevision && work.lastVerifiedRevision !== workingRevision) throw new HarnessError('WORK_STALE');
        await this.tasks.verifyCompletion(task);
        work.engineeringOutcome = work.outstanding.length ? 'incomplete' : 'verified'; work.evidenceStatus = 'valid'; work.lastVerifiedRevision = workingRevision;
      } catch (error) {
        work.outcome.verified = []; work.engineeringOutcome = 'incomplete';
        work.evidenceStatus = error instanceof HarnessError && /INTEGRITY/.test(error.code) ? 'invalid' : 'stale';
        work.outcome.incomplete = [...new Set([...work.outcome.incomplete, 'Historical verification does not match current revision or task'])].slice(-20);
      }
    }
    return work;
  }
  private async save(work: WorkSession) { work.updatedAt = now(); await this.data.writeSigned(`work-sessions/${work.id}.json`, workSchema.parse(work)); }
  async list(project: string) {
    const stable = (await this.identities.resolve(project)).stableProjectId; await this.data.store.directory('work-sessions');
    const envelopes = await this.data.store.list<{ payload: WorkSession }>('work-sessions');
    const stored = await Promise.all(envelopes.map(item => this.stored(item.payload.id)));
    const records = await Promise.all(stored.filter(item => item.projectId === stable).map(item => this.get(item.id)));
    return records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }
  async forTask(taskId: string) {
    const task = await this.tasks.get(taskId); return (await this.list(task.projectId)).find(item => item.taskId === taskId && item.state !== 'completed' && !item.finalizedAt) ?? null;
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
      before: snapshot, current: snapshot, sourceBaseline: task.workspaceId ? await workSnapshot(record.root) : null, threadIds: [], turnIds: [], eventIds: [], leaseId, candidateIds: [], decisions: [], outstanding: [],
      outcome: { changed: [], tested: [], verified: [], failed: [], blocked: [], incomplete: ['No checkpoint or final verification yet'], evidenceIds: [] }, capturePolicy: 'explicit-project-session-metadata-only', authority: 'none' });
    await this.data.writeSigned(`work-leases/${leaseId}.json`, { id: leaseId, workId: id, projectId: stable, taskId: task.id, createdAt: at, revoked: false });
    task = await this.tasks.get(task.id); task.state = 'running'; await this.tasks.save(task); await this.save(work); return this.public(work);
  }
  public(work: WorkSession) {
    const { sourceRoot: _sourceRoot, leaseId: _leaseId, before, current, sourceBaseline, ...safe } = work;
    return { ...safe, before: { ...before, files: undefined }, current: { ...current, files: undefined }, sourceBaseline: sourceBaseline ? { ...sourceBaseline, files: undefined } : null, localLeaseRequired: Boolean(_leaseId), sourcePathStoredLocally: Boolean(_sourceRoot) };
  }
  async events(id: string) {
    await this.get(id); await this.data.store.directory(`work-events/${id}`);
    const envelopes = await this.data.store.list<{ payload: WorkEvent }>(`work-events/${id}`);
    const active = await Promise.all(envelopes.map(item => this.data.signed(`work-events/${id}/${item.payload.id}.json`, workEventSchema)));
    const archive = await this.data.store.directory(`work-event-archive/${id}`);
    for (const prefix of await readdir(archive)) {
      if (!/^[a-f0-9]{2}$/.test(prefix)) throw new HarnessError('WORK_ARCHIVE_PATH_DENIED');
      const folder = `work-event-archive/${id}/${prefix}`; const records = await this.data.store.list<{ payload: WorkEvent }>(folder);
      active.push(...await Promise.all(records.map(item => this.data.signed(`${folder}/${item.payload.id}.json`, workEventSchema))));
    }
    return active.sort((a, b) => a.at.localeCompare(b.at));
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
      const executionSessionId = source === 'hook' && typeof input.harness_execution_session_id === 'string' && /^native-session-[a-f0-9]{32}$/.test(input.harness_execution_session_id) ? input.harness_execution_session_id : null;
      const executionBinding = executionSessionId ? { executionSessionId } : {};
      const callId = metadata(input.event_id ?? input.tool_use_id); const status = input.status === 'failed' ? 'failed' : name === 'Interrupt' ? 'interrupted' : input.status === 'completed' ? 'completed' : 'observed';
      const key = digest(canonical({ workId: id, taskId: work.taskId, name, source, threadId, turnId, tool, status, callId, ...executionBinding }));
      const event = workEventSchema.parse({ id: key, workId: id, taskId: work.taskId, projectId: work.projectId, name, source, threadId, turnId, tool, status, ...executionBinding, at: now(), dedupe: callId ? 'exact' : 'coarse', authority: 'observation-only' });
      if (work.eventIds.includes(key)) return { workId: id, duplicate: true, eventId: key };
      if (work.state === 'completed') throw new HarnessError('WORK_EVENT_CLOSED_OR_LIMIT');
      await this.root(work);
      // Deterministic file key is the event journal. Replaying after an interrupted index save is safe.
      const bucket = work.eventIds.length >= 500 ? `work-event-archive/${id}/${key.slice(0, 2)}` : `work-events/${id}`;
      let recorded = false;
      for (const existing of [`work-events/${id}/${key}.json`, `work-event-archive/${id}/${key.slice(0, 2)}/${key}.json`]) {
        try { await this.data.signed(existing, workEventSchema); recorded = true; break; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
      if (!recorded) await this.data.writeSigned(`${bucket}/${key}.json`, event); work.eventIds = [...work.eventIds, key].slice(-500);
      if (threadId && !work.threadIds.includes(threadId)) work.threadIds = [...work.threadIds, threadId].slice(-30);
      if (turnId && !work.turnIds.includes(turnId)) work.turnIds = [...work.turnIds, turnId].slice(-100);
      if (name === 'Interrupt' || name === 'SessionEnd') work.state = 'interrupted';
      else if (work.state !== 'interrupted') work.state = 'active';
      await this.save(work);
      return { workId: id, duplicate: recorded, eventId: key, savedRawPrompt: false, savedToolInputOrOutput: false };
    });
    const name = (raw as Record<string, unknown>).hook_event_name;
    if (!captured.duplicate && ['Stop', 'SessionEnd', 'Interrupt'].includes(String(name))) await this.checkpoint(id);
    return captured;
  }
  async progress(id: string, decisions: string[] = [], outstanding: string[] = [], resolved: string[] = []) {
    if (decisions.length > 20 || outstanding.length > 20 || resolved.length > 20 || [...decisions, ...outstanding, ...resolved].some(value => !value.trim() || value.length > 1000 || filterContent(value).redactions)) throw new HarnessError('WORK_PROGRESS_DENIED');
    return this.data.store.locked(`work-session-${id}`, async () => {
      const work = await this.get(id); if (work.state === 'completed' || work.finalizedAt) throw new HarnessError('WORK_COMPLETED');
      const nextDecisions = [...new Set([...work.decisions, ...decisions])];
      const nextOutstanding = [...new Set([...work.outstanding, ...outstanding])].filter(value => !resolved.includes(value));
      if (nextDecisions.length > 20 || nextOutstanding.length > 20) throw new HarnessError('WORK_PROGRESS_CAPACITY_REVIEW_REQUIRED', 'This Work retains at most 20 decisions and 20 unresolved items. Resolve items explicitly or start a new Work. No previous progress was removed; other tasks remain available.');
      const recovery = new WorkRecovery(this.data); await recovery.begin(work, 'progress', { decisions, outstanding, resolved });
      let candidateRetentionDeferred = false;
      for (const [type, contents] of [['decision', decisions], ['issue', outstanding]] as const) for (const content of contents) {
        if (work.candidateIds.length >= 100) { candidateRetentionDeferred = true; continue; }
        let proposed;
        try { proposed = await this.memory.propose({ domain: 'project', projectId: work.projectId, type, topic: `Work ${type} ${id} ${digest(content).slice(0, 8)}`, content }); }
        catch (error) { if (!(error instanceof HarnessError) || error.code !== 'INTELLIGENCE_RETENTION_LIMIT') throw error; candidateRetentionDeferred = true; continue; }
        if (!work.candidateIds.includes(proposed.record.id)) work.candidateIds.push(proposed.record.id);
      }
      work.decisions = nextDecisions; work.outstanding = nextOutstanding; await this.save(work); await recovery.complete(id);
      if (candidateRetentionDeferred) await this.data.writeSigned(`retention-notices/${id}.json`, { workId: id, at: now(), reason: 'Candidate retention deferred; Work progress retained locally; review archives', auditDeleted: false });
      return { ...this.public(work), candidateRetentionDeferred };
    });
  }
  async checkpoint(id: string, finalize = false, options: { interrupted?: boolean } = {}) {
    return this.data.store.locked(`work-session-${id}`, async () => {
      const work = await this.get(id); const recovery = new WorkRecovery(this.data);
      if (work.state === 'completed' || work.finalizedAt) { await recovery.complete(id); return { ...this.public(work), idempotent: true }; }
      await recovery.begin(work, finalize ? 'finalize' : 'checkpoint', { interrupted: Boolean(options.interrupted) });
      const root = await this.root(work); const current = await workSnapshot(root); const changed = changedFiles(work.before.files, current.files);
      const task = await this.tasks.get(work.taskId); const snapshotComplete = work.before.complete && current.complete;
      // Execution Evidence is committed before the Task index. Reconcile only signed same-task records.
      const evidence = await this.tasks.execution.evidence.list(task.id);
      const ids = evidence.filter(item => item.workspaceId === task.workspaceId).map(item => item.id);
      if (ids.some(id => !task.evidenceIds.includes(id))) { task.evidenceIds = [...new Set([...task.evidenceIds, ...ids])]; await this.tasks.save(task); }
      if (finalize && work.workspaceId && task.state === 'running') {
        try { await this.tasks.complete(task.id); } catch (error) { task.state = 'failed'; task.reason = error instanceof HarnessError ? error.code : 'WORK_VERIFICATION_FAILED'; task.finishedAt = now(); await this.tasks.save(task); }
      } else if (finalize && !work.workspaceId && task.state === 'running') { task.state = 'succeeded'; task.reason = null; task.finishedAt = now(); await this.tasks.save(task); }
      await this.tasks.report(task.id);
      const summary = await this.history.record(await this.tasks.get(task.id), { modified: changed, sourceRevision: current.revision, outstanding: work.outstanding });
      const history = await this.data.read(); const related = work.taskIds.flatMap(taskId => history.summaries[taskId] ? [history.summaries[taskId]!] : []);
      work.current = current; work.checkpointAt = now(); work.outcome = { changed, tested: [...new Set([...related.flatMap(item => item.tested), ...summary.tested])].slice(-20), verified: snapshotComplete ? summary.verified : [], failed: [...new Set([...work.outcome.failed, ...related.flatMap(item => item.failed), ...summary.failed])].slice(-20), blocked: summary.blocked,
        incomplete: [...new Set([...summary.incomplete, ...work.outstanding, ...(!snapshotComplete ? ['Source snapshot incomplete; no complete verification claim'] : []), ...(!work.workspaceId && changed.length ? ['External changes have no matching isolated verification evidence'] : [])])].map(value => value.slice(0, 200)).slice(0, 20), evidenceIds: [...new Set(related.flatMap(item => item.evidenceIds))].slice(-20) };
      const latestTask = await this.tasks.get(task.id); let finalVerified = false;
      if (snapshotComplete && work.workspaceId && latestTask.mode === 'isolated' && latestTask.state === 'succeeded') try { await this.tasks.verifyCompletion(latestTask); finalVerified = true; } catch { /* Individual passes never imply complete verification. */ }
      if (finalVerified && work.sourceBaseline) {
        const source = await workSnapshot((await this.registry.get(work.projectId)).root);
        if (!source.complete || !work.sourceBaseline.complete || source.revision !== work.sourceBaseline.revision || source.sourceDigest !== work.sourceBaseline.sourceDigest || source.statusHash !== work.sourceBaseline.statusHash) {
          finalVerified = false; work.outcome.incomplete = [...work.outcome.incomplete, 'Original source changed during managed work; review a fresh snapshot'].slice(-20);
        }
      }
      const currentPasses = summary.verified.length;
      work.evidenceStatus = finalVerified ? 'valid' : evidence.length ? currentPasses ? 'pending' : evidence.some(item => item.status === 'passed') ? 'stale' : 'pending' : 'none';
      work.engineeringOutcome = finalVerified ? work.outstanding.length ? 'incomplete' : 'verified' : latestTask.state === 'blocked' ? 'blocked'
        : latestTask.state === 'failed' && latestTask.reason !== 'MISSING_FINAL_VERIFICATION' ? 'failed' : currentPasses ? 'tested'
        : changed.length || work.outstanding.length || !snapshotComplete || latestTask.mode === 'isolated' && summary.incomplete.length ? 'incomplete' : 'no-change';
      if (finalVerified) work.lastVerifiedRevision = await this.workspaces.workingRevision(work.workspaceId!);
      if (!finalVerified) work.outcome.verified = [];
      if (finalize) { work.state = options.interrupted ? 'interrupted' : 'completed'; work.finalizedAt = now(); const lease = await this.data.signed(`work-leases/${work.leaseId}.json`, leaseSchema); lease.revoked = true; await this.data.writeSigned(`work-leases/${work.leaseId}.json`, lease); }
      await this.save(work); await recovery.complete(id); return this.public(work);
    });
  }
  async resume(id: string, acceptChange = false) {
    return this.data.store.locked(`work-session-${id}`, async () => {
    const work = await this.get(id); const record = await this.registry.get(work.projectId);
    if (await new WorkRecovery(this.data).pending(id)) throw new HarnessError('WORK_RECOVERY_REQUIRED');
    const root = work.workspaceId ? await this.workspaces.root(work.workspaceId) : record.root; const current = await workSnapshot(root);
    const sourceChanged = Boolean(work.workspaceId && revision(record.root) !== (await this.workspaces.get(work.workspaceId)).sourceRevision);
    const drift = sourceChanged || current.sourceDigest !== work.current.sourceDigest || current.revision !== work.current.revision || record.root !== work.sourceRoot;
    if (drift && !acceptChange) return { workId: id, status: 'review-required', reason: 'Git revision, content or project binding changed', permissionsRestored: false };
    if (sourceChanged) return { workId: id, status: 'review-required', reason: 'Original source revision changed. Create a fresh filtered workspace/attachment and a new Work; old workspace evidence remains historical.', permissionsRestored: false };
    if (work.workspaceId) {
      try { await this.data.store.text('locks/execution.lock'); return { workId: id, status: 'review-required', reason: 'An isolated execution lock exists; finish or review the owned command before resuming', permissionsRestored: false }; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    if (work.taskIds.length >= 30) throw new HarnessError('WORK_RESUME_LIMIT');
    const previousTask = await this.tasks.get(work.taskId);
    if (['created', 'ready', 'running'].includes(previousTask.state)) { previousTask.state = 'cancelled'; previousTask.reason = 'WORK_SUPERSEDED_BY_RESUME'; previousTask.finishedAt = now(); await this.tasks.save(previousTask); }
    const task = await this.tasks.create(work.projectId, work.goal, previousTask.mode === 'isolated' ? 'isolated' : 'analysis', work.workspaceId); task.state = 'running'; await this.tasks.save(task);
    work.taskId = task.id; work.taskIds.push(task.id); work.state = 'active'; work.finalizedAt = null; work.sourceRoot = record.root; work.bindingId = record.id;
    const oldLease = await this.data.signed(`work-leases/${work.leaseId}.json`, leaseSchema); oldLease.revoked = true; await this.data.writeSigned(`work-leases/${work.leaseId}.json`, oldLease);
    work.leaseId = newId('lease'); await this.data.writeSigned(`work-leases/${work.leaseId}.json`, { id: work.leaseId, workId: id, projectId: work.projectId, taskId: task.id, createdAt: now(), revoked: false });
    work.current = current; work.engineeringOutcome = 'incomplete'; work.evidenceStatus = task.mode === 'isolated' ? 'pending' : 'none'; work.outcome.verified = []; work.outcome.incomplete = [task.mode === 'isolated' ? 'Resumed task needs its own final-revision evidence and a fresh plan' : 'Resumed analysis does not verify implementation or authorize coding']; await this.save(work);
    return { ...this.public(work), driftReviewed: drift, modelHiddenStateRestored: false, permissionsRestored: false };
    });
  }
  async recover(id: string) {
    const recovery = new WorkRecovery(this.data);
    const lock = await this.data.store.locked(`work-recovery-${id}`, () => recovery.inspectLock(id, true));
    if (['active', 'review-required'].includes(lock.status)) return { workId: id, status: 'blocked', lock, permissionsRestored: false };
    const work = await this.get(id); const journal = await recovery.pending(id);
    if (journal && journal.taskId !== work.taskId) throw new HarnessError('WORK_RECOVERY_TASK_MISMATCH');
    if (journal?.operation === 'progress') await this.progress(id, journal.decisions, journal.outstanding, journal.resolved);
    else await this.checkpoint(id, journal?.operation === 'finalize', { interrupted: Boolean(journal?.interrupted) });
    return { work: this.public(await this.get(id)), status: 'recovered', replayed: journal?.operation ?? 'checkpoint', permissionsRestored: false };
  }
  async archive(id: string) {
    return this.data.store.locked(`work-session-${id}`, async () => {
      const work = await this.get(id); if (work.state !== 'completed' || await new WorkRecovery(this.data).pending(id)) throw new HarnessError('WORK_ARCHIVE_ACTIVE_DENIED');
      await this.data.writeSigned(`work-archive/${id.slice(-2)}/${id}.json`, work);
      try { await unlink(this.data.store.resolve(`work-sessions/${id}.json`)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      return { id, status: 'archived', metadataAndEventsRetained: true, originalEvidenceRetained: true, permissionsRestored: false };
    });
  }
  async forgetCandidate(memoryId: string) {
    await this.data.store.directory('work-sessions');
    const locations = ['work-sessions']; const archived = await this.data.store.directory('work-archive');
    for (const prefix of await readdir(archived)) { if (!/^[a-f0-9]{2}$/.test(prefix)) throw new HarnessError('WORK_ARCHIVE_PATH_DENIED'); locations.push(`work-archive/${prefix}`); }
    for (const location of locations) for (const entry of await this.data.store.list<{ payload: WorkSession }>(location)) if (entry.payload.candidateIds.includes(memoryId)) await this.data.store.locked(`work-session-${entry.payload.id}`, async () => {
      const work = await this.get(entry.payload.id); work.candidateIds = work.candidateIds.filter(id => id !== memoryId); work.updatedAt = now();
      await this.data.writeSigned(`${location}/${work.id}.json`, workSchema.parse(work));
    });
  }
  async delete(id: string) {
    return this.data.store.locked(`work-session-${id}`, async () => {
      const work = await this.get(id); const events = await this.events(id);
      // Revoke first. A crash leaves a closed local lease, never restored authority.
      const lease = await this.data.signed(`work-leases/${work.leaseId}.json`, leaseSchema); lease.revoked = true; await this.data.writeSigned(`work-leases/${work.leaseId}.json`, lease);
      for (const taskId of work.taskIds) await this.history.deleteWorkSummary(taskId, work.projectId);
      await this.data.edit(data => { for (const taskId of work.taskIds) delete data.summaries[taskId];
        for (const memory of Object.values(data.memories)) if (work.candidateIds.includes(memory.id) || memory.type === 'task-summary' && memory.references.some(ref => ref.kind === 'task' && work.taskIds.includes(ref.ref))) delete data.memories[memory.id]; });
      for (const event of events) for (const file of [`work-events/${id}/${event.id}.json`, `work-event-archive/${id}/${event.id.slice(0, 2)}/${event.id}.json`]) try { await unlink(this.data.store.resolve(file)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      try { await unlink(this.data.store.resolve(`work-journals/${id}.json`)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      for (const file of [`work-sessions/${id}.json`, `work-archive/${id.slice(-2)}/${id}.json`]) try { await unlink(this.data.store.resolve(file)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      return { id, deleted: true, scope: 'Work metadata, events, linked summaries and memory candidates', retained: 'Tasks, execution evidence, patches, backups and exports have separate retention; no global Codex history was collected' };
    });
  }
  async context(project: string, query = '') {
    const continuation = /continu|previous|resume|接续|继续|历史/iu.test(query);
    const records = (await this.list(project)).filter(work => !query || continuation || relevance(query, `${work.goal} ${work.decisions.join(' ')} ${work.outstanding.join(' ')}`) > 0).sort((a, b) => (continuation ? Number(Boolean(b.outstanding.length)) - Number(Boolean(a.outstanding.length)) : 0)
      || relevance(query, `${b.goal} ${b.decisions.join(' ')} ${b.outstanding.join(' ')}`) - relevance(query, `${a.goal} ${a.decisions.join(' ')} ${a.outstanding.join(' ')}`)
      || b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3); if (!records.length) return [];
    const lines: string[] = [];
    for (const work of records) {
      lines.push(`Work ${work.id}: session=${work.state}; engineering=${work.engineeringOutcome}; evidence=${work.evidenceStatus}; goal=${work.goal.slice(0, 200)}; changed=${work.outcome.changed.length}; verified=${work.outcome.verified.join(',') || 'none'}; lastVerifiedRevision=${work.lastVerifiedRevision ?? 'none'}`);
      lines.push(...work.outcome.incomplete.slice(0, 2).map(value => `Pending verification/outstanding: ${value}`));
      lines.push(...work.decisions.slice(-2).map(value => `Recent decision candidate (unreviewed): ${value}`));
      try { const current = await workSnapshot(await this.root(work)); lines.push(`Current Git: revision=${current.revision}; clean=${current.clean}; contentChangedSinceCheckpoint=${current.sourceDigest !== work.current.sourceDigest}`); }
      catch { lines.push('Work binding unavailable; relink/review before resuming. Historical evidence is not current permission.'); }
    }
    return lines;
  }
}
