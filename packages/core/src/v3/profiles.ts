import { CodeIntelligence } from '../v2/code.js';
import { ExternalRegistry } from '../v2/registry.js';
import { fingerprint, revision } from '../v2/git.js';
import { projectRules } from '../v2/rules.js';
import { newId, digest } from '../v2/store.js';
import { HarnessError, type Task } from '../v2/contracts.js';
import { WorkspaceManager } from '../v2/workspace.js';
import { EvidenceStore } from '../v2/evidence.js';
import { IntelligenceData, now, canonical } from './data.js';
import { ProjectIdentities } from './identity.js';
import { factSchema, projectProfileSchema, taskSummarySchema, memorySchema, type ProjectFact } from './contracts.js';
import { readEngineering } from './files.js';
import { readdir } from 'node:fs/promises';
import { unlink } from 'node:fs/promises';
import { z } from 'zod';
const deletedHistorySchema = z.object({ taskId: z.string(), projectId: z.string(), at: z.string().datetime(), scope: z.literal('deleted-work-summary; execution audit retained') }).strict();

export class ProjectProfiles {
  constructor(readonly data: IntelligenceData, readonly identities: ProjectIdentities, readonly registry: ExternalRegistry, readonly code: CodeIntelligence) {}
  async refresh(id: string) {
    const identity = await this.identities.resolve(id); const stable = identity.stableProjectId;
    const record = await this.registry.rescan(stable); const snapshot = await fingerprint(record.root);
    const architecture = await this.code.architecture(stable); const timestamp = now(); const facts: ProjectFact[] = [];
    const fact = (key: string, statement: string, status: ProjectFact['status'], references: ProjectFact['references']) => facts.push(factSchema.parse({ key, statement: statement.slice(0, 2000), status, references, collectedAt: timestamp }));
    fact('revision', `Current Git commit: ${snapshot.head}`, 'source-confirmed', [{ kind: 'git', ref: 'HEAD', revision: snapshot.head }]);
    for (const component of record.config.components) {
      fact(`stack:${component.path}`, `${component.name}: languages=${component.languages.join(', ') || 'unknown'}; frameworks=${component.frameworks.join(', ') || 'unknown'}; build=${component.buildSystems.join(', ') || 'unknown'}; tests=${component.testFrameworks.join(', ') || 'unknown'}`, 'configuration-declared', component.sources.slice(0, 10).map(source => ({ kind: 'file', ref: 'manifest declaration', path: source.path, revision: snapshot.head })));
    }
    for (const module of architecture.modules) fact(`module:${module.layer}`, `Candidate ${module.layer} layer; directory names and static evidence do not prove runtime boundaries`, 'inferred', module.evidence.slice(0, 6).map(file => ({ kind: 'file', ref: 'bounded architecture scan', path: file, line: 1, revision: snapshot.head })));
    for (const [kind, files] of [['entrypoint', architecture.entrypoints], ['test', architecture.tests.slice(0, 15)]] as const) {
      for (const file of files.slice(0, 15)) fact(`${kind}:${file}`, `${kind === 'test' ? 'Existing test source (not executed)' : 'Candidate source entrypoint'}: ${file}`, 'source-confirmed', [{ kind: 'file', ref: 'source structure', path: file, line: 1, revision: snapshot.head }]);
    }
    const uncertainty = [...architecture.limitations, 'No live worker, UI, database or hardware behavior is inferred from static imports'];
    try {
      const readme = await readEngineering(record.root, 'README.md');
      const lines = readme.raw.split(/\r?\n/); const index = lines.findIndex(line => line.trim() && !line.startsWith('#') && !/^\s*[`|<!]/.test(line));
      if (index >= 0) fact('purpose', lines[index]!.slice(0, 500), 'configuration-declared', [{ kind: 'file', ref: 'README declared purpose', path: 'README.md', line: index + 1, revision: snapshot.head }]);
    } catch { uncertainty.push('README purpose unavailable or refused by sensitive-content policy'); }
    if (record.rulesAllowed) {
      const rules = await projectRules(this.registry, stable);
      for (const rule of rules.rules) fact(`rules:${rule.path}`, `Authorized untrusted engineering rules; scope=${rule.scope}; hash=${rule.hash}; sensitive fields filtered`, 'configuration-declared', [{ kind: 'file', ref: 'project rules, not permission authority', path: rule.path, line: 1, revision: snapshot.head }]);
      if (rules.rules.some(rule => rule.warnings.length)) uncertainty.push('Project rules contain untrusted instruction patterns; they never grant permissions');
    } else uncertainty.push('Project rules were not authorized; use a separate rules read grant');
    if (!facts.some(item => item.key === 'purpose')) fact('purpose', 'Project positioning is unknown; ask the user or review an authorized README', 'unknown', []);
    return this.data.edit(async data => {
      const previous = data.profiles[stable];
      const differences = previous ? facts.filter(item => !previous.facts.some(old => old.key === item.key && old.statement === item.statement && old.status === item.status && canonical(old.references) === canonical(item.references))) : facts;
      if (previous && previous.revision === snapshot.head && previous.sourceDigest === snapshot.sourceHash && previous.facts.length === facts.length && !differences.length && canonical(previous.stack) === canonical(record.config) && canonical(previous.uncertainty) === canonical(uncertainty.slice(0, 30))) return { profile: previous, differences: [], historicalFactsAdded: 0, archiveArtifact: null, sourceWritten: false };
      const oldFacts = previous?.facts.filter(item => !facts.some(current => current.key === item.key && current.statement === item.statement && canonical(current.references) === canonical(item.references))).map(item => ({ ...item, status: 'stale' as const })) ?? [];
      const history = [...(previous?.history ?? []), ...oldFacts]; let archiveArtifact: string | null = null;
      if (history.length > 500) {
        const archived = history.splice(0, history.length - 500);
        archiveArtifact = `profile-history/${stable}/${digest(canonical(archived))}.json`;
        await this.data.writeSigned(archiveArtifact, { projectId: stable, facts: archived, at: timestamp, trust: 'historical-stale-context-not-authority' });
      }
      const profile = projectProfileSchema.parse({ schemaVersion: 3, projectId: stable, revision: snapshot.head, sourceDigest: snapshot.sourceHash,
        generatedAt: timestamp, generation: (previous?.generation ?? 0) + 1, facts, history, stack: record.config, uncertainty: uncertainty.slice(0, 30) });
      data.profiles[stable] = profile;
      const target = data.identities[stable]!;
      if (!target.observedCommits.includes(snapshot.head)) target.observedCommits = [...target.observedCommits, snapshot.head].slice(-100);
      for (const memory of Object.values(data.memories)) if (memory.projectId === stable && memory.references.some(ref => ref.revision && ref.revision !== snapshot.head && ['file', 'git', 'evidence'].includes(ref.kind))) memory.freshness = 'stale';
      return { profile, differences, historicalFactsAdded: oldFacts.length, archiveArtifact, sourceWritten: false };
    });
  }
  async get(id: string) {
    const identity = await this.identities.resolve(id); let profile = (await this.data.read()).profiles[identity.stableProjectId];
    if (!profile) profile = (await this.refresh(id)).profile;
    let currentRevision: string | null = null; let stale = true; let binding = 'relink-required';
    try { const root = (await this.registry.get(identity.stableProjectId)).root; const current = await fingerprint(root); currentRevision = revision(root); stale = currentRevision !== profile.revision || current.sourceHash !== profile.sourceDigest || profile.facts.some(item => item.status === 'stale'); binding = 'bound'; } catch { /* Portable historical profile is still readable. */ }
    return { identity, profile, currentRevision, stale, binding, permissionAuthority: 'none' };
  }
}
export class TaskHistory {
  workOutstanding?: (taskId: string) => Promise<string[]>;
  constructor(readonly data: IntelligenceData, readonly identities: ProjectIdentities, readonly workspaces: WorkspaceManager, readonly evidence: EvidenceStore) {}
  private async hidden(taskId: string) {
    try { await this.data.signed(`deleted-work-history/${taskId}.json`, deletedHistorySchema); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  }
  async deleteWorkSummary(taskId: string, projectId: string) {
    await this.data.writeSigned(`deleted-work-history/${taskId}.json`, { taskId, projectId, at: now(), scope: 'deleted-work-summary; execution audit retained' });
    try { await unlink(this.data.store.resolve(`task-history/${projectId}/${taskId.slice(-2)}/${taskId}.json`)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  async record(task: Task, observation?: { modified: string[]; sourceRevision: string; outstanding?: string[] }) {
    const identity = await this.identities.resolve(task.projectId); const stable = identity.stableProjectId;
    const results = await this.evidence.list(task.id); let workspaceRevision: string | null = null; let sourceRevision: string | null = null; let modified: string[] = [];
    if (task.workspaceId) try {
      workspaceRevision = await this.workspaces.workingRevision(task.workspaceId); sourceRevision = (await this.workspaces.get(task.workspaceId)).sourceRevision;
      modified = (await this.workspaces.diff(task.workspaceId)).changedFiles;
    } catch { /* Failure to inspect cannot produce verified work. */ }
    const verified: string[] = [];
    if (workspaceRevision) for (const item of results) if (await this.evidence.isVerified(item.id, workspaceRevision)) verified.push(item.commandId);
    if (observation && !task.workspaceId) { modified = observation.modified; sourceRevision = observation.sourceRevision; }
    const outstanding = observation?.outstanding ?? await this.workOutstanding?.(task.id) ?? [];
    const summary = taskSummarySchema.parse({ taskId: task.id, projectId: stable, requirement: task.prompt.slice(0, 2000), at: task.finishedAt ?? now(), state: task.state,
      modified: modified.slice(0, 100), tested: results.filter(item => item.exitCode !== null).map(item => item.commandId), verified,
      failed: results.filter(item => ['failed', 'timeout', 'cancelled', 'stale'].includes(item.status)).map(item => item.commandId),
      blocked: [...(task.state === 'blocked' && task.reason ? [task.reason] : []), ...results.filter(item => item.status === 'blocked').map(item => item.reason ?? 'blocked')],
      incomplete: [...new Set([...(task.state === 'succeeded' && verified.length ? [] : [task.reason ?? (task.mode === 'analysis' ? 'Analysis only; no implemented feature verified' : 'No final-revision verification')]), ...outstanding])].map(item => item.slice(0, 200)).slice(-20),
      evidenceIds: results.map(item => item.id), evidenceTrust: verified.length ? 'local-verified' : 'local-unverified', sourceRevision, workspaceRevision, modelCalls: task.modelCalls });
    if (await this.hidden(task.id)) return summary;
    await this.data.writeSigned(`task-history/${stable}/${task.id.slice(-2)}/${task.id}.json`, summary);
    try { await this.data.edit(data => {
      data.summaries[task.id] = summary;
      // Summary candidates are evidence-linked observations, not automatic long-term conclusions.
      const linked = Object.values(data.memories).filter(item => item.type === 'task-summary' && item.projectId === stable && item.references.some(ref => ref.kind === 'task' && ref.ref === task.id));
      const content = `state=${summary.state}; changed=${modified.length}; tested=${summary.tested.length}; failed=${summary.failed.length}; final-version verified=${verified.length}; incomplete=${summary.incomplete.join(', ') || 'none'}`;
      if (!linked.some(item => item.content === content && item.trust === 'local')) {
        const previous = linked.find(item => item.confirmation === 'candidate' && item.trust === 'local'); const id = previous?.id ?? newId('memory');
        data.memories[id] = memorySchema.parse({ id, domain: 'project', projectId: stable, type: 'task-summary', topic: `Harness task ${task.id}`,
          content,
          tags: ['task-history'], source: verified.length ? 'verified' : 'observed', confirmation: 'candidate', freshness: 'current', trust: 'local',
          references: [{ kind: 'task', ref: task.id }, ...results.slice(0, 5).map(item => ({ kind: 'evidence' as const, ref: item.id, ...(sourceRevision ? { revision: sourceRevision } : {}) }))],
          createdAt: previous?.createdAt ?? now(), updatedAt: now(), deprecated: false, version: (previous?.version ?? 0) + 1,
          history: previous ? [...previous.history, { version: previous.version, content: previous.content, confirmation: previous.confirmation, at: now(), action: 'updated-harness-task-report' }].slice(-50) : [] });
      }
    }); } catch (error) {
      if (!(error instanceof HarnessError) || error.code !== 'INTELLIGENCE_RETENTION_LIMIT') throw error;
      await this.data.writeSigned(`retention-notices/${task.id}.json`, { taskId: task.id, reason: error.code, at: now(), retained: 'Signed local task history; portable index needs operator archive review', evidenceDeleted: false });
    }
    return summary;
  }
  async recent(id: string, limit = 10) {
    const stable = (await this.identities.resolve(id)).stableProjectId;
    const records = new Map(Object.values((await this.data.read()).summaries).filter(item => item.projectId === stable).map(item => [item.taskId, item]));
    const base = `task-history/${stable}`; const folder = await this.data.store.directory(base);
    for (const prefix of await readdir(folder)) {
      if (!/^[a-f0-9]{2}$/.test(prefix)) throw new HarnessError('TASK_HISTORY_ARCHIVE_PATH_DENIED');
      for (const entry of await this.data.store.list<{ payload: { taskId: string } }>(`${base}/${prefix}`)) {
        const summary = await this.data.signed(`${base}/${prefix}/${entry.payload.taskId}.json`, taskSummarySchema);
        if (summary.projectId !== stable) throw new HarnessError('TASK_HISTORY_SCOPE_DENIED'); records.set(summary.taskId, summary);
      }
    }
    const visible = []; for (const summary of records.values()) if (!await this.hidden(summary.taskId)) visible.push(summary);
    return visible.sort((a, b) => b.at.localeCompare(a.at)).slice(0, Math.min(20, limit));
  }
}
