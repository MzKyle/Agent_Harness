import { z } from 'zod';
import { IntelligenceData, now } from '../v3/data.js';
import { TaskService } from '../v2/tasks.js';
import { ExternalRegistry } from '../v2/registry.js';
import { WorkspaceManager } from '../v2/workspace.js';
import { HarnessError } from '../v2/contracts.js';
import { entityId } from '../v3/contracts.js';
import { snapshotSchema } from './work-contracts.js';
import { workSnapshot } from './work-capture.js';
const baselineSchema = z.object({ taskId: entityId('task'), root: z.string(), snapshot: snapshotSchema, at: z.string().datetime() }).strict();
export class WorkflowValidator {
  constructor(readonly data: IntelligenceData, readonly tasks: TaskService, readonly registry: ExternalRegistry, readonly workspaces: WorkspaceManager) {}
  async begin(taskId: string) {
    const task = await this.tasks.get(taskId); const record = await this.registry.get(task.projectId);
    const file = `validation-baselines/${taskId}.json`;
    try { return await this.data.signed(file, baselineSchema); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const baseline = { taskId, root: record.root, snapshot: await workSnapshot(record.root), at: now() };
    await this.data.writeSigned(file, baseline); return baseline;
  }
  async validate(taskId: string) {
    const task = await this.tasks.get(taskId); const record = await this.registry.get(task.projectId);
    const before = await this.data.signed(`validation-baselines/${taskId}.json`, baselineSchema); const after = await workSnapshot(record.root);
    const sourceUnchanged = before.root === record.root && before.snapshot.complete && after.complete && before.snapshot.revision === after.revision && before.snapshot.sourceDigest === after.sourceDigest && before.snapshot.statusHash === after.statusHash;
    let finalEvidence = false; let reason: string | null = null;
    try { if (task.mode !== 'isolated') throw new HarnessError('ANALYSIS_HAS_NO_IMPLEMENTATION_VERIFICATION'); await this.tasks.verifyCompletion(task); finalEvidence = true; }
    catch (error) { reason = error instanceof HarnessError ? error.code : 'FINAL_EVIDENCE_UNAVAILABLE'; }
    const diff = task.workspaceId ? await this.workspaces.diff(task.workspaceId) : null;
    const inspectedPaths = diff?.changedFiles ?? [];
    const report = { taskId, at: now(), status: sourceUnchanged && finalEvidence ? 'passed' : 'failed', machine: { sourceUnchanged, finalRevisionApprovedCommands: finalEvidence, reason },
      inspectedPaths, guidance: { changedOutsideDeclaredPlan: inspectedPaths.filter(file => !task.plan?.affectedModules.includes(file)),
        review: ['Review affected API, worker, state model, persistence and presentation using actual project source', 'Review recovery and observability; passing commands do not establish semantic coverage'],
        authority: 'advice-only; no natural-language semantic or architectural correctness claim' }, evidenceIds: task.evidenceIds };
    await this.data.writeSigned(`validation-reports/${taskId}.json`, report); return report;
  }
}
