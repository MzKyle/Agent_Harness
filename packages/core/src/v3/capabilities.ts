import { ExternalRegistry } from '../v2/registry.js';
import { CodeIntelligence } from '../v2/code.js';
import { Diagnostics } from '../v2/diagnostics.js';
import { EvidenceStore } from '../v2/evidence.js';
import { WorkspaceManager } from '../v2/workspace.js';
import { isolationCheck } from '../v2/isolation.js';
import { revision } from '../v2/git.js';
import { IntelligenceData, now } from './data.js';
import { ProjectIdentities } from './identity.js';
import { contractSchema, type ProjectContract } from './contracts.js';

export class ProjectCapabilities {
  runtimeStatus?: (id: string) => Promise<{ status: 'configured' | 'verified' | 'unavailable'; detail: string }>;
  constructor(readonly data: IntelligenceData, readonly identities: ProjectIdentities, readonly registry: ExternalRegistry, readonly code: CodeIntelligence, readonly diagnostics: Diagnostics, readonly evidence: EvidenceStore, readonly workspaces: WorkspaceManager) {}
  async assess(id: string, probeExecution = false): Promise<ProjectContract> {
    const identity = await this.identities.resolve(id); const stable = identity.stableProjectId; const record = await this.registry.get(stable);
    const architecture = await this.code.architecture(stable); const head = revision(record.root);
    const entries: ProjectContract['entries'] = [];
    const add = (id: string, status: ProjectContract['entries'][number]['status'], detail: string, references: ProjectContract['entries'][number]['references'] = []) => entries.push({ id, status, detail, references, workspaceId: null, workspaceRevision: null });
    add('source-search', architecture.truncated ? 'configured' : 'verified', 'Bounded source/architecture query actually executed; no semantic runtime graph is claimed', architecture.entrypoints.slice(0, 3).map(file => ({ kind: 'file', ref: 'bounded source query', path: file, line: 1, revision: head })));
    add('project-rules', record.rulesAllowed ? 'configured' : 'unavailable', record.rulesAllowed ? 'Explicit local rules read grant exists; instructions cannot grant permissions' : 'Engineering rules require a separate read grant');
    const imported = await this.diagnostics.query({ projectId: stable, limit: 1 });
    add('logs', imported.events.length ? 'verified' : record.config.observability.logs.length ? 'discovered' : 'unavailable', imported.events.length ? 'An explicitly imported sanitized project event was queried' : 'No authorized live log adapter is established');
    const runtime = this.runtimeStatus ? await this.runtimeStatus(stable) : { status: 'unavailable' as const, detail: 'Framework dependencies do not prove access to a live worker or service' };
    add('runtime-state', runtime.status, runtime.detail);
    add('ui', 'unsupported', 'No verified safe Windows desktop UI runner is installed');
    add('hardware', 'forbidden', 'MockHardware discovery never authorizes production hardware');
    add('source-write', 'forbidden', 'Current registry grant is read-only; onboarding needs independent file/diff/revision/branch approval');
    add('production-execution', 'forbidden', 'Production processes, databases and hardware are outside this grant');
    let configured = false; try { configured = Boolean((await this.data.store.get<{ image: string }>('isolation.json')).image); } catch { /* No configured runner. */ }
    if (probeExecution) { const isolation = await isolationCheck(this.data.store); add('isolated-execution', isolation.verified ? 'verified' : 'unavailable', `${isolation.reason}; actual execution still requires human command approval`); }
    else add('isolated-execution', configured ? 'configured' : 'unavailable', 'Local image configuration is not evidence that this project can build or test');
    for (const command of record.config.commands.slice(0, 40)) add(`command-${command.id}`.replace(/[^a-z0-9-]/gi, '-').toLowerCase().slice(0, 80), 'discovered', `Declared ${command.purpose} command from ${command.source}; not approved or verified`, [{ kind: 'file', ref: 'manifest declaration only', path: command.source, revision: head }]);
    for (const proposal of Object.values((await this.data.read()).proposals).filter(item => item.projectId === stable && item.state === 'adopted')) {
      let verified = false;
      if (proposal.workspaceId && proposal.workspaceRevision && proposal.evidenceId) try {
        verified = proposal.workspaceRevision === await this.workspaces.workingRevision(proposal.workspaceId) && await this.evidence.isVerified(proposal.evidenceId, proposal.workspaceRevision);
      } catch { /* Lost or changed workspaces cannot preserve verification. */ }
      entries.push({ id: `extension-${proposal.id.slice(-16)}`, status: verified ? 'verified' : 'unavailable', detail: verified ? 'Reviewed workspace capability; separate approved command invocation is still required' : 'Adopted extension requires local final-revision verification', references: proposal.evidenceId ? [{ kind: 'evidence', ref: proposal.evidenceId }] : [], workspaceId: proposal.workspaceId, workspaceRevision: proposal.workspaceRevision });
    }
    const contract = contractSchema.parse({ schemaVersion: 1, projectId: stable, assessedAt: now(), sourceRevision: head, entries,
      requiredChecks: record.config.commands.filter(command => ['test', 'build', 'typecheck'].includes(command.purpose)).map(command => command.id).slice(0, 50), evidencePolicy: 'final-revision', sourceIntegrityCheck: true, permissionAuthority: 'none', memoryReviewRequired: true });
    return this.data.edit(data => {
      const previous = data.contracts[stable];
      if (previous && JSON.stringify({ ...previous, assessedAt: '' }) === JSON.stringify({ ...contract, assessedAt: '' })) return previous;
      data.contracts[stable] = contract; return contract;
    });
  }
  async get(id: string) {
    const stable = (await this.identities.resolve(id)).stableProjectId;
    const saved = (await this.data.read()).contracts[stable];
    if (!saved) return this.assess(stable);
    const current = revision((await this.registry.get(stable)).root);
    // Recheck adopted workspace extensions; a changed workspace invalidates old evidence.
    const runtime = this.runtimeStatus ? await this.runtimeStatus(stable) : null;
    const previousRuntime = saved.entries.find(entry => entry.id === 'runtime-state');
    const runtimeChanged = runtime && (previousRuntime?.status !== runtime.status || previousRuntime.detail !== runtime.detail);
    const checked = runtimeChanged || saved.entries.some(entry => entry.id.startsWith('extension-')) ? await this.assess(stable) : saved;
    return { ...checked, stale: current !== checked.sourceRevision, permissionAuthority: 'none' as const };
  }
}
