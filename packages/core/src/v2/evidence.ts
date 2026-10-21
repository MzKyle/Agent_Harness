import { StateStore, digest } from './store.js';
import { evidenceSchema, type Evidence, HarnessError } from './contracts.js';
import { readdir, unlink } from 'node:fs/promises';

export class EvidenceStore {
  constructor(readonly store: StateStore) {}
  async get(id: string): Promise<Evidence> {
    if (!/^execution-[a-f0-9]{32}$/.test(id)) throw new HarnessError('EVIDENCE_ID_DENIED');
    let raw: unknown;
    try { raw = await this.store.get(`evidence/${id}.json`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; raw = await this.store.get(`evidence-archive/${id.slice(-2)}/${id}.json`); }
    const evidence = evidenceSchema.parse(raw);
    const { signature, ...payload } = evidence;
    if (!await this.store.verify(payload, signature)) throw new HarnessError('EVIDENCE_INTEGRITY_FAILED');
    if (evidence.stdoutHash && digest(await this.store.text(evidence.stdoutArtifact)) !== evidence.stdoutHash
      || evidence.stderrHash && digest(await this.store.text(evidence.stderrArtifact)) !== evidence.stderrHash) throw new HarnessError('EVIDENCE_ARTIFACT_INTEGRITY_FAILED');
    return evidence;
  }
  async list(taskId?: string) {
    const records = await this.store.list<Evidence>('evidence');
    const archive = await this.store.directory('evidence-archive');
    for (const prefix of await readdir(archive)) {
      if (!/^[a-f0-9]{2}$/.test(prefix)) throw new HarnessError('EVIDENCE_ARCHIVE_PATH_DENIED');
      records.push(...await this.store.list<Evidence>(`evidence-archive/${prefix}`));
    }
    const unique = [...new Map(records.map(record => [record.id, record])).values()];
    return Promise.all(unique.filter((record) => !taskId || record.taskId === taskId).map((record) => this.get(record.id)));
  }
  async activeCount() { return (await readdir(this.store.resolve('evidence'))).filter(file => file.endsWith('.json')).length; }
  async archive(taskId: string, apply = false) {
    if (!/^task-[a-f0-9]{32}$/.test(taskId)) throw new HarnessError('TASK_ID_DENIED');
    const task = await this.store.get<{ state: string }>(`tasks/${taskId}.json`);
    if (!['succeeded', 'failed', 'blocked', 'cancelled'].includes(task.state)) throw new HarnessError('EVIDENCE_ARCHIVE_ACTIVE_TASK_DENIED');
    const records = await this.list(taskId);
    const proposal = { taskId, evidenceIds: records.map(item => item.id), retains: 'Signed records and original stdout/stderr remain locally verifiable; no backup authority is created', deletesAudit: false };
    if (!apply) return { ...proposal, status: 'preview' };
    return this.store.locked('evidence-archive', async () => {
      for (const record of records) {
        await this.store.put(`evidence-archive/${record.id.slice(-2)}/${record.id}.json`, record);
        try { await unlink(this.store.resolve(`evidence/${record.id}.json`)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
      return { ...proposal, status: 'archived' };
    });
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
    return Boolean(record.stdoutHash && record.stderrHash) && !record.truncated && record.status === 'passed' && record.exitCode === 0 && record.isolation === 'verified-isolated'
      && record.workspaceRevision === workspaceRevision && record.resultingRevision === workspaceRevision;
  }
}
