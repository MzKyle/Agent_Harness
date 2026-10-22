import { engineeringSystem } from '../../packages/adapters/dist/index.js';
import { WorkRecovery } from '../../packages/core/dist/index.js';
import process from 'node:process';
import { setInterval } from 'node:timers';
const [home, workId] = process.argv.slice(2);
const s = await engineeringSystem(home);
await s.store.locked(`work-session-${workId}`, async () => {
  await new WorkRecovery(s.intelligence).begin(await s.work.get(workId), 'finalize');
  process.stdout.write('JOURNALED_AND_LOCKED\n');
  setInterval(() => undefined, 1000);
  await new Promise(() => { /* Parent terminates this owned fixture process. */ });
});
