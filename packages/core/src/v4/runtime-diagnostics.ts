import { z } from 'zod';
import { HarnessError, taskSchema } from '../v2/contracts.js';
import { EvidenceStore } from '../v2/evidence.js';
import { filterContent } from '../v2/content.js';
import { newId } from '../v2/store.js';
import { IntelligenceData, now } from '../v3/data.js';
import { ProjectIdentities } from '../v3/identity.js';
import { entityId, projectId, sha } from '../v3/contracts.js';
import { WorkspaceManager } from '../v2/workspace.js';

const identifier = z.string().regex(/^[a-zA-Z0-9_.:-]{1,100}$/);
const state = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled', 'waiting_cvat', 'waiting_user', 'skipped']);
const observation = z.object({ workflowId: identifier, state, step: identifier, updatedAt: z.string().datetime().nullable().optional(), observedAt: z.string().datetime().optional(), source: identifier.optional(), clockDomain: identifier.optional() }).strict();
const eventSchema = z.object({ at: z.string().datetime(), workflowId: identifier, traceId: identifier, component: z.enum(['api', 'worker', 'store', 'ui']), event: identifier,
  from: state.optional(), to: state.optional(), severity: z.enum(['info', 'error', 'warning']), message: z.string().max(500) }).strict();
export const runtimeSnapshotSchema = z.object({ schemaVersion: z.literal(1), adapter: z.string().regex(/^[a-z0-9-]{1,60}$/), capturedAt: z.string().datetime(),
  serviceVersion: z.string().max(80), timeoutMs: z.number().int().min(1).max(3600000),
  clock: z.object({ domain: identifier, trusted: z.boolean(), maxSkewMs: z.number().int().min(0).max(60000) }).strict().optional(),
  consistencyPolicy: z.object({ propagationDelayMs: z.number().int().min(0).max(3600000), persistentAfterMs: z.number().int().min(1).max(3600000), observationMaxAgeMs: z.number().int().min(1).max(3600000) }).strict().optional(),
  mismatchWindows: z.array(z.object({ workflowId: identifier, firstObservedAt: z.string().datetime(), lastObservedAt: z.string().datetime(), samples: z.number().int().min(2).max(10000) }).strict()).max(100).optional(),
  api: z.array(observation).max(100), worker: z.array(observation).max(100), sqlite: z.array(observation).max(100), ui: z.array(observation).max(100), events: z.array(eventSchema).max(500) }).strict();
export type RuntimeSnapshot = z.infer<typeof runtimeSnapshotSchema>;
export interface RuntimeObservationAdapter { id: string; description: string; sourcePaths: string[]; transitions: Record<string, string[]> }
const finding = z.object({ workflowId: identifier, code: z.enum(['state-mismatch', 'stalled', 'transient-inconsistency', 'persistent-mismatch', 'stale-observation', 'illegal-transition', 'worker-error', 'insufficient-evidence']), detail: z.string().max(1000), traceIds: z.array(identifier).max(100) }).strict();
const recordSchema = z.object({ id: entityId('runtime'), projectId, taskId: entityId('task'), workspaceId: entityId('workspace'), workspaceRevision: sha,
  evidenceId: entityId('execution'), capturedAt: z.string().datetime(), importedAt: z.string().datetime(), adapter: z.string().max(60), serviceVersion: z.string().max(80),
  findings: z.array(finding).max(500), snapshot: runtimeSnapshotSchema, provenance: z.literal('signed-isolated-command-output'), authority: z.literal('diagnostic-only') }).strict();

export function analyzeRuntime(snapshot: RuntimeSnapshot, adapter: RuntimeObservationAdapter) {
  if (snapshot.adapter !== adapter.id) throw new HarnessError('RUNTIME_ADAPTER_MISMATCH');
  const findings: z.infer<typeof finding>[] = []; const captured = Date.parse(snapshot.capturedAt);
  for (const id of new Set([...snapshot.api, ...snapshot.worker, ...snapshot.sqlite, ...snapshot.ui].map(item => item.workflowId))) {
    const events = snapshot.events.filter(item => item.workflowId === id); const traceIds = [...new Set(events.map(item => item.traceId))].slice(0, 100);
    const observations = (['api', 'worker', 'sqlite', 'ui'] as const).flatMap(layer => snapshot[layer].filter(item => item.workflowId === id).map(item => ({ layer, ...item })));
    const add = (code: z.infer<typeof finding>['code'], detail: string) => findings.push({ workflowId: id, code, detail, traceIds });
    const clock = snapshot.clock; const policy = snapshot.consistencyPolicy;
    const reliable = Boolean(clock?.trusted && policy && observations.length >= 2 && observations.every(item => item.updatedAt && item.observedAt && item.source && item.clockDomain === clock.domain
      && Date.parse(item.updatedAt) <= Date.parse(item.observedAt) + clock.maxSkewMs && Date.parse(item.observedAt) <= captured + clock.maxSkewMs));
    const stale = reliable && observations.some(item => captured - Date.parse(item.observedAt!) > policy!.observationMaxAgeMs);
    const different = new Set(observations.map(item => item.state)).size > 1;
    if (!reliable) add('insufficient-evidence', 'Reliable common clock, observation/update timestamps, sources and propagation policy are required; divergence alone is not a bug');
    else if (stale) add('stale-observation', 'At least one component observation exceeds the explicit maximum age; refresh before comparing state');
    else if (different) {
      const window = snapshot.mismatchWindows?.find(item => item.workflowId === id);
      const first = window ? Date.parse(window.firstObservedAt) : NaN; const last = window ? Date.parse(window.lastObservedAt) : NaN;
      const persistent = window && first <= last && last <= captured + clock!.maxSkewMs && captured - last <= policy!.observationMaxAgeMs && last - first >= Math.max(policy!.propagationDelayMs, policy!.persistentAfterMs);
      if (persistent) { add('persistent-mismatch', `Repeated divergence beyond propagation allowance; ${observations.map(item => `${item.layer}=${item.state}`).join('; ')}; sampled persistence, not a proven cause`); add('state-mismatch', 'Compatibility alias for persistent-mismatch; does not imply all components must agree instantaneously'); }
      else if (observations.some(item => captured - Date.parse(item.updatedAt!) <= policy!.propagationDelayMs)) add('transient-inconsistency', 'State divergence is within the allowed propagation window; collect a later sample');
      else add('insufficient-evidence', 'Divergence has no valid repeated observation window; persistent failure cannot be inferred');
    }
    if (reliable && !stale) for (const item of observations) if (item.state === 'running' && captured - Date.parse(item.updatedAt!) > snapshot.timeoutMs) {
      add('stale-observation', `${item.layer} heartbeat exceeded configured ${snapshot.timeoutMs}ms; investigate rather than infer a cause`);
      add('stalled', `${item.layer} at ${item.step}: heartbeat timeout compatibility signal`);
    }
    for (const event of events) {
      if (event.from && event.to && !adapter.transitions[event.from]?.includes(event.to)) findings.push({ workflowId: id, code: 'illegal-transition', detail: `${event.component}: ${event.from} -> ${event.to}; observed event, not a proven root cause`, traceIds });
      if (event.component === 'worker' && event.severity === 'error') findings.push({ workflowId: id, code: 'worker-error', detail: `${event.event} at ${event.at}: ${event.message}`, traceIds });
    }
  }
  return findings;
}

export class RuntimeDiagnostics {
  constructor(readonly data: IntelligenceData, readonly identities: ProjectIdentities, readonly evidence: EvidenceStore, readonly workspaces: WorkspaceManager, readonly adapters: RuntimeObservationAdapter[]) {}
  async capture(evidenceId: string) {
    const evidence = await this.evidence.get(evidenceId);
    const task = taskSchema.parse(await this.data.store.get(`tasks/${evidence.taskId}.json`));
    if (task.workspaceId !== evidence.workspaceId || (await this.identities.resolve(task.projectId)).stableProjectId !== (await this.identities.resolve(evidence.projectId)).stableProjectId) throw new HarnessError('RUNTIME_TASK_SCOPE_DENIED');
    if (evidence.isolation !== 'verified-isolated' || evidence.truncated || !['passed', 'failed'].includes(evidence.status)) throw new HarnessError('RUNTIME_CAPTURE_EVIDENCE_REQUIRED');
    const output = await this.data.store.text(evidence.stdoutArtifact);
    const markers = output.split(/\r?\n/).flatMap(line => { const index = line.indexOf('DEVAGENT_RUNTIME_SNAPSHOT '); return index >= 0 ? [line.slice(index + 26)] : []; });
    if (markers.length !== 1) throw new HarnessError('RUNTIME_SINGLE_SNAPSHOT_REQUIRED');
    const snapshot = runtimeSnapshotSchema.parse(JSON.parse(markers[0]!));
    if (Date.parse(snapshot.capturedAt) < Date.parse(evidence.startedAt) - 1000 || Date.parse(snapshot.capturedAt) > Date.parse(evidence.finishedAt) + 1000) throw new HarnessError('RUNTIME_TIMESTAMP_OUTSIDE_EXECUTION');
    const adapter = this.adapters.find(item => item.id === snapshot.adapter); if (!adapter) throw new HarnessError('RUNTIME_ADAPTER_UNAVAILABLE');
    for (const event of snapshot.events) { const safe = filterContent(event.message, 'log'); event.message = safe.content; }
    const inspect = (value: unknown): void => {
      if (typeof value === 'string' && filterContent(value, 'log').redactions) throw new HarnessError('RUNTIME_SENSITIVE_METADATA_REFUSED');
      if (Array.isArray(value)) value.forEach(inspect); else if (value && typeof value === 'object') Object.values(value).forEach(inspect);
    }; inspect(snapshot);
    const stable = (await this.identities.resolve(evidence.projectId)).stableProjectId;
    const current = await this.list(stable); const existing = current.find(item => item.evidenceId === evidence.id); if (existing) return existing;
    if (current.length >= 100) throw new HarnessError('RUNTIME_RETENTION_LIMIT');
    const record = recordSchema.parse({ id: newId('runtime'), projectId: stable, taskId: evidence.taskId, workspaceId: evidence.workspaceId, workspaceRevision: evidence.workspaceRevision,
      evidenceId: evidence.id, capturedAt: snapshot.capturedAt, importedAt: now(), adapter: adapter.id, serviceVersion: snapshot.serviceVersion, findings: analyzeRuntime(snapshot, adapter), snapshot, provenance: 'signed-isolated-command-output', authority: 'diagnostic-only' });
    await this.data.writeSigned(`runtime-observations/${record.id}.json`, record); return record;
  }
  async get(id: string) { entityId('runtime').parse(id); return this.data.signed(`runtime-observations/${id}.json`, recordSchema); }
  async list(project: string) {
    const stable = (await this.identities.resolve(project)).stableProjectId; await this.data.store.directory('runtime-observations');
    const envelopes = await this.data.store.list<{ payload: { id: string } }>('runtime-observations');
    const records = await Promise.all(envelopes.map(item => this.get(item.payload.id))); return records.filter(item => item.projectId === stable).sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  }
  async query(project: string, id?: string, filters: { taskId?: string; workflowId?: string; traceId?: string } = {}) {
    if (filters.taskId) entityId('task').parse(filters.taskId);
    for (const value of [filters.workflowId, filters.traceId]) if (value) identifier.parse(value);
    const stable = (await this.identities.resolve(project)).stableProjectId; const record = id ? await this.get(id) : (await this.list(stable)).find(item => !filters.taskId || item.taskId === filters.taskId);
    if (!record) return { status: 'unavailable' as const, reason: 'No explicitly captured isolated runtime observation', permissionAuthority: 'none' };
    if (record.projectId !== stable) throw new HarnessError('RUNTIME_SCOPE_DENIED');
    if (filters.taskId && record.taskId !== filters.taskId) throw new HarnessError('RUNTIME_TASK_SCOPE_DENIED');
    // Verify original output and HMAC on every query. A snapshot is never live authority.
    await this.evidence.get(record.evidenceId);
    const revision = await this.workspaces.workingRevision(record.workspaceId);
    const events = record.snapshot.events.filter(event => (!filters.workflowId || event.workflowId === filters.workflowId) && (!filters.traceId || event.traceId === filters.traceId));
    const workflowIds = new Set(events.map(event => event.workflowId));
    const selected = (workflowId: string) => (!filters.workflowId || workflowId === filters.workflowId) && (!filters.traceId || workflowIds.has(workflowId));
    const snapshot = { ...record.snapshot, events, api: record.snapshot.api.filter(item => selected(item.workflowId)), worker: record.snapshot.worker.filter(item => selected(item.workflowId)), sqlite: record.snapshot.sqlite.filter(item => selected(item.workflowId)), ui: record.snapshot.ui.filter(item => selected(item.workflowId)) };
    // Recompute the current view without rewriting the signed historical interpretation.
    const adapter = this.adapters.find(item => item.id === record.adapter);
    const findings = adapter ? analyzeRuntime(snapshot, adapter) : record.findings.filter(item => selected(item.workflowId));
    return { status: 'available' as const, ...record, snapshot, findings, analysisVersion: adapter ? '0.4.1' : 'stored-unreclassified', stale: revision !== record.workspaceRevision || Date.now() - Date.parse(record.capturedAt) > 86400000, currentWorkspaceRevision: revision,
      limitation: 'Point-in-time fixture observation; no live ALS process/database access or proven root cause', sourceCandidates: adapter?.sourcePaths ?? [] };
  }
}
