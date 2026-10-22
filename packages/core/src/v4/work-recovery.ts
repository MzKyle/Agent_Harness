import { z } from 'zod';
import { unlink } from 'node:fs/promises';
import { HarnessError } from '../v2/contracts.js';
import { IntelligenceData, now, canonical } from '../v3/data.js';
import { workId, type WorkSession } from './work-contracts.js';

const journalSchema = z.object({
  workId, taskId: z.string(), operation: z.enum(['checkpoint', 'finalize', 'progress']),
  decisions: z.array(z.string()).default([]), outstanding: z.array(z.string()).default([]), resolved: z.array(z.string()).default([]),
  interrupted: z.boolean().default(false),
  at: z.string().datetime(), state: z.enum(['pending', 'completed']),
}).strict();
export class WorkRecovery {
  constructor(readonly data: IntelligenceData) {}
  async pending(id: string) {
    workId.parse(id);
    try { const journal = await this.data.signed(`work-journals/${id}.json`, journalSchema); return journal.state === 'pending' ? journal : null; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  async begin(work: WorkSession, operation: 'checkpoint' | 'finalize' | 'progress', progress: { decisions?: string[]; outstanding?: string[]; resolved?: string[]; interrupted?: boolean } = {}) {
    const previous = await this.pending(work.id);
    if (previous && (previous.taskId !== work.taskId || previous.operation !== operation)) throw new HarnessError('WORK_RECOVERY_REQUIRED', 'Replay the pending journal before another operation');
    const record = journalSchema.parse({ workId: work.id, taskId: work.taskId, operation, ...progress, at: now(), state: 'pending' });
    record.interrupted ||= Boolean(previous?.interrupted);
    if (previous && canonical([previous.decisions, previous.outstanding, previous.resolved]) !== canonical([record.decisions, record.outstanding, record.resolved])) throw new HarnessError('WORK_RECOVERY_REQUIRED');
    await this.data.writeSigned(`work-journals/${work.id}.json`, record);
  }
  async complete(id: string) {
    const record = await this.pending(id); if (record) await this.data.writeSigned(`work-journals/${id}.json`, { ...record, state: 'completed' });
  }
  // Only a dead, identified local process lock can be recovered. Old empty locks need manual review.
  async inspectLock(id: string, recover = false) {
    workId.parse(id); const file = `locks/work-session-${id}.lock`;
    let owner: { pid?: number; startedAt?: string };
    try { owner = JSON.parse(await this.data.store.text(file)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'unlocked' }; return { status: 'review-required', reason: 'Legacy or unreadable lock; no automatic deletion' }; }
    if (!Number.isSafeInteger(owner.pid) || !owner.pid || owner.pid <= 0 || !owner.startedAt) return { status: 'review-required', reason: 'Unknown owner' };
    try { process.kill(owner.pid, 0); return { status: 'active', pid: owner.pid }; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return { status: 'review-required', reason: 'Cannot prove process exit' };
    }
    if (recover) await unlink(this.data.store.resolve(file));
    return { status: recover ? 'recovered' : 'orphaned', permissionsRestored: false };
  }
}
