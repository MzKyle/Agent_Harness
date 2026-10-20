import { StateStore, digest } from './store.js';
import { evidenceSchema, type Evidence, HarnessError } from './contracts.js';

export class EvidenceStore {
  constructor(readonly store: StateStore) {}
  async get(id: string): Promise<Evidence> {
    if (!/^execution-[a-f0-9]{32}$/.test(id)) throw new HarnessError('EVIDENCE_ID_DENIED');
    const evidence = evidenceSchema.parse(await this.store.get(`evidence/${id}.json`));
    const { signature, ...payload } = evidence;
    if (!await this.store.verify(payload, signature)) throw new HarnessError('EVIDENCE_INTEGRITY_FAILED');
    if (evidence.stdoutHash && digest(await this.store.text(evidence.stdoutArtifact)) !== evidence.stdoutHash
      || evidence.stderrHash && digest(await this.store.text(evidence.stderrArtifact)) !== evidence.stderrHash) throw new HarnessError('EVIDENCE_ARTIFACT_INTEGRITY_FAILED');
    return evidence;
  }
  async list(taskId?: string) {
    const records = await this.store.list<Evidence>('evidence');
    return Promise.all(records.filter((record) => !taskId || record.taskId === taskId).map((record) => this.get(record.id)));
  }
  async report(taskId: string) {
    const records = await this.list(taskId);
    const report = { taskId, results: records, passed: records.filter((item) => item.status === 'passed').length,
      failed: records.filter((item) => item.status === 'failed').length, blocked: records.filter((item) => item.status === 'blocked').length };
    const markdown = `# Verification evidence: ${taskId}\n\n${records.map((item) => `- ${item.commandId}: **${item.status}**, exit=${item.exitCode}, revision=${item.workspaceRevision}, isolation=${item.isolation}`).join('\n')}\n`;
    await this.store.put(`reports/${taskId}.evidence.json`, report); await this.store.put(`reports/${taskId}.evidence.md`, markdown);
    return { ...report, markdown };
  }
  async isVerified(id: string, workspaceRevision: string) {
    const record = await this.get(id);
    return Boolean(record.stdoutHash && record.stderrHash) && record.status === 'passed' && record.exitCode === 0 && record.isolation === 'verified-isolated'
      && record.workspaceRevision === workspaceRevision && record.resultingRevision === workspaceRevision;
  }
}
