import { StateStore, newId } from './store.js';
import { EvidenceStore } from './evidence.js';
import { filterContent, permittedFile } from './content.js';
import { checkedPath } from '../safety.js';
import { HarnessError, taskSchema } from './contracts.js';
import { CodeIntelligence } from './code.js';

interface Event { timestamp: string | null; severity: string; message: string; trace_id: string | null; operation_id: string | null; component: string | null; line: number }
interface Diagnostic { id: string; source: string; importedAt: string; events: Event[]; truncated: boolean; projectId?: string | null; taskId?: string | null }
const scrub = (value: unknown) => { try { return filterContent(String(value ?? ''), 'log').content.slice(0, 1200); } catch { return '[REFUSED]'; } };
export class Diagnostics {
  constructor(readonly store: StateStore, readonly evidence: EvidenceStore, readonly code: CodeIntelligence) {}
  async import(text: string, source: string, scope: { projectId?: string; taskId?: string } = {}) {
    if (Buffer.byteLength(text) > 1024 * 1024) throw new HarnessError('DIAGNOSTIC_SIZE_LIMIT');
    if ((await this.store.list('diagnostics')).length >= 200) throw new HarnessError('DIAGNOSTIC_RETENTION_LIMIT');
    let projectId = scope.projectId ?? null;
    if (projectId) await this.code.registry.get(projectId);
    if (scope.taskId) {
      if (!/^task-[a-f0-9]{32}$/.test(scope.taskId)) throw new HarnessError('TASK_ID_DENIED');
      const task = taskSchema.parse(await this.store.get(`tasks/${scope.taskId}.json`));
      if (projectId && task.projectId !== projectId) throw new HarnessError('DIAGNOSTIC_PROJECT_MISMATCH'); projectId = task.projectId;
    }
    const events: Event[] = []; let truncated = false;
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]!; if (!line.trim()) continue;
      if (events.length >= 2000) { truncated = true; break; }
      let record: Record<string, unknown> = {};
      try { const parsed: unknown = JSON.parse(line); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) record = parsed as Record<string, unknown>; } catch { /* Plain logs are supported. */ }
      const severity = String(record.severity ?? record.level ?? (/error|exception|failed/i.test(line) ? 'error' : 'info')).toLowerCase();
      events.push({ timestamp: typeof record.timestamp === 'string' && Number.isFinite(Date.parse(record.timestamp)) ? record.timestamp : null,
        severity: ['debug', 'info', 'warning', 'warn', 'error', 'fatal'].includes(severity) ? severity : 'info',
        message: scrub(record.message ?? record.event ?? line), trace_id: record.trace_id ? scrub(record.trace_id) : null,
        operation_id: record.operation_id ? scrub(record.operation_id) : null, component: record.component ? scrub(record.component) : null, line: index + 1 });
    }
    const diagnostic: Diagnostic = { id: newId('diagnostic'), source: scrub(source), importedAt: new Date().toISOString(), events, truncated, projectId, taskId: scope.taskId ?? null };
    await this.store.put(`diagnostics/${diagnostic.id}.json`, diagnostic); return { id: diagnostic.id, events: events.length, truncated };
  }
  async query(options: { diagnosticId?: string; traceId?: string; operationId?: string; severity?: string; from?: string; to?: string; limit?: number; projectId?: string; taskId?: string }) {
    if (options.diagnosticId && !/^diagnostic-[a-f0-9]{32}$/.test(options.diagnosticId)) throw new HarnessError('DIAGNOSTIC_ID_DENIED');
    for (const date of [options.from, options.to]) if (date && !Number.isFinite(Date.parse(date))) throw new HarnessError('INVALID_TIME_RANGE');
    const candidates = options.diagnosticId ? [await this.store.get<Diagnostic>(`diagnostics/${options.diagnosticId}.json`)] : await this.store.list<Diagnostic>('diagnostics');
    const records = candidates.filter(record => (!options.projectId || record.projectId === options.projectId) && (!options.taskId || !record.taskId || record.taskId === options.taskId));
    if (options.diagnosticId && !records.length) throw new HarnessError('DIAGNOSTIC_SCOPE_DENIED');
    const events = []; let truncated = records.some((record) => record.truncated); let bytes = 0;
    for (const record of records) for (const event of record.events) {
      if (options.traceId && event.trace_id !== options.traceId || options.operationId && event.operation_id !== options.operationId || options.severity && event.severity !== options.severity) continue;
      if (options.from && (!event.timestamp || Date.parse(event.timestamp) < Date.parse(options.from)) || options.to && (!event.timestamp || Date.parse(event.timestamp) > Date.parse(options.to))) continue;
      bytes += Buffer.byteLength(JSON.stringify(event));
      if (events.length >= Math.min(100, options.limit ?? 50) || bytes > 32768) { truncated = true; continue; }
      events.push({ ...event, source: record.source, diagnosticId: record.id });
    }
    return { events, truncated, source: 'authorized-sanitized-diagnostic-store', trust: 'untrusted-diagnostic-context' };
  }
  async failures(taskId: string) {
    const records = await this.evidence.list(taskId);
    return { taskId, failures: await Promise.all(records.filter((item) => item.status !== 'passed').map(async (record) => ({
      evidenceId: record.id, workspaceRevision: record.workspaceRevision, status: record.status, reason: record.reason,
      stdout: (await this.store.text(record.stdoutArtifact)).slice(0, 8000), stderr: (await this.store.text(record.stderrArtifact)).slice(0, 8000),
    }))), source: 'signed-execution-evidence' };
  }
  async diagnose(projectId: string, taskId: string) {
    if (!/^task-[a-f0-9]{32}$/.test(taskId)) throw new HarnessError('TASK_ID_DENIED');
    const task = taskSchema.parse(await this.store.get(`tasks/${taskId}.json`));
    if (task.projectId !== projectId) throw new HarnessError('TASK_PROJECT_MISMATCH');
    const failures = await this.failures(taskId);
    const queries = [...new Set(failures.failures.flatMap((failure) => `${failure.stdout}\n${failure.stderr}`.match(/\b(?:AssertionError|TypeError|ReferenceError|timeout|failed|exception)\b/gi) ?? []))].slice(0, 3);
    const relatedCode = await Promise.all(queries.map((query) => this.code.search(projectId, query, { limit: 5 })));
    const root = task.workspaceId ? await checkedPath(this.store.root, `workspaces/${task.workspaceId}/code`) : undefined;
    const relatedSource = [];
    for (const file of (task.plan?.affectedModules ?? []).filter(file => permittedFile(file, true)).slice(0, 3)) {
      try { relatedSource.push(await this.code.read(projectId, file, 1, 30, root)); } catch { /* A missing/filtered module is not fabricated evidence. */ }
    }
    const report = { projectId, taskId, workspaceId: task.workspaceId, failures, errorTypes: queries, relatedCode, relatedSource,
      sourceSelection: 'Task-planned modules are inspection candidates, not proof that they caused the failure',
      nextAction: failures.failures.some((item) => item.status === 'blocked') ? 'Resolve the recorded approval/auth/isolation blocker; do not widen permissions automatically' : 'Inspect failure evidence and related source; create a scoped plan and validate a workspace fix',
      claim: 'deterministic evidence correlation, not a proven root cause' };
    await this.store.put(`reports/${taskId}.diagnosis.json`, report); return report;
  }
}
