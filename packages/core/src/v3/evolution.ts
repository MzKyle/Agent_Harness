import { TaskService } from '../v2/tasks.js';
import { WorkspaceManager } from '../v2/workspace.js';
import { EvidenceStore } from '../v2/evidence.js';
import { gapSchema, HarnessError, type Task } from '../v2/contracts.js';
import { digest, newId } from '../v2/store.js';
import { IntelligenceData, now } from './data.js';
import { ProjectIdentities } from './identity.js';
import { type CapabilityProposal } from './contracts.js';

export class CapabilityEvolution {
  constructor(readonly data: IntelligenceData, readonly identities: ProjectIdentities, readonly tasks: TaskService, readonly workspaces: WorkspaceManager, readonly evidence: EvidenceStore) {}
  async capture(task: Task, gapId: string, input: unknown) {
    const gap = gapSchema.parse(input); const stable = (await this.identities.resolve(task.projectId)).stableProjectId;
    const category: CapabilityProposal['category'] = /log|trace|diagnos|日志|诊断/i.test(gap.gap) ? 'diagnostics' : /test|verif|验证|测试/i.test(gap.gap) ? 'verification' : /adapter|适配/i.test(gap.gap) ? 'adapter' : 'perception';
    const fingerprint = digest(`${stable}:${category}:${gap.gap.trim().toLocaleLowerCase().replace(/\s+/g, ' ')}`);
    return this.data.edit(data => {
      const existing = Object.values(data.proposals).find(item => item.fingerprint === fingerprint);
      if (existing) {
        if (!existing.gapIds.includes(gapId)) existing.gapIds = [...existing.gapIds, gapId].slice(-100);
        if (!existing.taskIds.includes(task.id)) existing.taskIds = [...existing.taskIds, task.id].slice(-100);
        existing.updatedAt = now(); return existing;
      }
      const item: CapabilityProposal = { id: newId('proposal'), projectId: stable, fingerprint, category, gapIds: [gapId], taskIds: [task.id],
        title: gap.gap.slice(0, 200), why: gap.why, alternative: gap.existingAlternative, suggestion: gap.suggestion, risks: gap.risks,
        crossProject: gap.crossProject, state: 'proposed', createdAt: now(), updatedAt: now(), workspaceId: null, workspaceRevision: null, evidenceId: null, invocationCommandId: null,
        history: [{ state: 'proposed', at: now(), actor: 'tool' }] };
      data.proposals[item.id] = item; return item;
    });
  }
  async list(project: string) { const stable = (await this.identities.resolve(project)).stableProjectId; return Object.values((await this.data.read()).proposals).filter(item => item.projectId === stable); }
  async get(id: string) { const item = (await this.data.read()).proposals[id]; if (!item) throw new HarnessError('PROPOSAL_NOT_FOUND'); return item; }
  async approve(id: string) { return this.transition(id, 'proposed', 'approved', 'human-cli'); }
  private async transition(id: string, from: CapabilityProposal['state'], to: CapabilityProposal['state'], actor: 'tool' | 'human-cli') {
    return this.data.edit(data => {
      const proposal = data.proposals[id]; if (!proposal || proposal.state !== from) throw new HarnessError('PROPOSAL_STATE_CONFLICT');
      proposal.state = to; proposal.updatedAt = now(); proposal.history.push({ state: to, at: now(), actor }); return proposal;
    });
  }
  async implemented(id: string, workspaceId: string, taskId: string, invocationCommandId: string) {
    const proposal = await this.get(id); const workspace = await this.workspaces.get(workspaceId); const task = await this.tasks.get(taskId);
    if (proposal.state !== 'approved' || task.workspaceId !== workspaceId || (await this.identities.resolve(workspace.projectId)).stableProjectId !== proposal.projectId) throw new HarnessError('PROPOSAL_IMPLEMENTATION_SCOPE_DENIED');
    await this.tasks.execution.approved(workspaceId, invocationCommandId);
    const revision = await this.workspaces.workingRevision(workspaceId);
    return this.data.edit(data => {
      const current = data.proposals[id]!; if (current.state !== 'approved') throw new HarnessError('PROPOSAL_STATE_CONFLICT');
      current.workspaceId = workspaceId; current.workspaceRevision = revision; current.invocationCommandId = invocationCommandId;
      if (!current.taskIds.includes(taskId)) current.taskIds.push(taskId);
      current.state = 'implemented'; current.updatedAt = now(); current.history.push({ state: 'implemented', at: now(), actor: 'tool' }); return current;
    });
  }
  async verify(id: string, evidenceId: string) {
    const proposal = await this.get(id); if (proposal.state !== 'implemented' || !proposal.workspaceId || !proposal.workspaceRevision) throw new HarnessError('PROPOSAL_STATE_CONFLICT');
    const evidence = await this.evidence.get(evidenceId); const revision = await this.workspaces.workingRevision(proposal.workspaceId);
    if (revision !== proposal.workspaceRevision || evidence.workspaceId !== proposal.workspaceId || !proposal.taskIds.includes(evidence.taskId) || !await this.evidence.isVerified(evidenceId, revision)) throw new HarnessError('PROPOSAL_FINAL_VERIFICATION_REQUIRED');
    return this.data.edit(data => { const item = data.proposals[id]!; if (item.state !== 'implemented') throw new HarnessError('PROPOSAL_STATE_CONFLICT'); item.state = 'verified'; item.evidenceId = evidenceId; item.updatedAt = now(); item.history.push({ state: 'verified', at: now(), actor: 'tool' }); return item; });
  }
  async adopt(id: string) {
    const proposal = await this.get(id);
    if (proposal.state !== 'verified' || !proposal.evidenceId || !proposal.workspaceId || !proposal.workspaceRevision || !await this.evidence.isVerified(proposal.evidenceId, await this.workspaces.workingRevision(proposal.workspaceId))) throw new HarnessError('PROPOSAL_VERIFICATION_STALE');
    return this.data.edit(data => {
      const current = data.proposals[id]!; if (current.state !== 'verified') throw new HarnessError('PROPOSAL_STATE_CONFLICT');
      current.state = 'adopted'; current.updatedAt = now(); current.history.push({ state: 'adopted', at: now(), actor: 'human-cli' });
      const contract = data.contracts[current.projectId];
      if (contract) contract.entries.push({ id: `extension-${current.id.slice(-16)}`, status: 'verified', detail: 'Reviewed workspace capability; invoking still requires the approved container command. Other projects require separate adaptation/verification.',
        references: [{ kind: 'evidence', ref: current.evidenceId! }], workspaceId: current.workspaceId, workspaceRevision: current.workspaceRevision });
      return current;
    });
  }
  async invoke(id: string, taskId: string, signal?: AbortSignal) {
    const proposal = await this.get(id); const task = await this.tasks.get(taskId);
    if (proposal.state !== 'adopted' || !proposal.workspaceId || !proposal.workspaceRevision || !proposal.invocationCommandId || task.workspaceId !== proposal.workspaceId || (await this.identities.resolve(task.projectId)).stableProjectId !== proposal.projectId) throw new HarnessError('CAPABILITY_INVOCATION_DENIED');
    const revision = await this.workspaces.workingRevision(proposal.workspaceId);
    if (revision !== proposal.workspaceRevision || !proposal.evidenceId || !await this.evidence.isVerified(proposal.evidenceId, revision)) throw new HarnessError('CAPABILITY_REVISION_STALE');
    const evidence = await this.tasks.runApproved(taskId, proposal.invocationCommandId, signal);
    return { proposalId: id, evidence, stdout: (await this.data.store.text(evidence.stdoutArtifact)).slice(0, 16000), hostPluginLoaded: false };
  }
  async deprecate(id: string) { const item = await this.get(id); return this.transition(id, item.state, 'deprecated', 'human-cli'); }
}
