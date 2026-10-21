import { readdir } from 'node:fs/promises';
import { IntelligenceData } from '../v3/data.js';
import { WorkRecovery } from './work-recovery.js';
import { workSchema } from './work-contracts.js';
export async function engineeringHealth(data: IntelligenceData) {
  const portable = await data.read(); const records = await data.store.list<{ payload: { id: string } }>('work-sessions').catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; });
  const pending = []; const interrupted = [];
  for (const entry of records) {
    const work = await data.signed(`work-sessions/${entry.payload.id}.json`, workSchema);
    if (await new WorkRecovery(data).pending(work.id)) pending.push(work.id);
    if (work.state === 'interrupted') interrupted.push(work.id);
  }
  const notices = await data.store.directory('retention-notices');
  return { status: pending.length ? 'attention' : 'ok', pendingJournalWorkIds: pending, interruptedWorkIds: interrupted,
    activeWorkRecords: records.length, portableBytes: Buffer.byteLength(JSON.stringify(portable)), portableMemoryCount: Object.keys(portable.memories).length, portableSummaryCount: Object.keys(portable.summaries).length,
    retentionNotices: (await readdir(notices)).filter(file => file.endsWith('.json')).length,
    recovery: 'work recover checks identified dead locks and replays signed journals; never restores execution or sharing grants',
    retention: 'Use reviewed memory archive-history, work archive and evidence archive; original execution audit is retained', privateHistoryScanned: false };
}
