import { parseArgs } from 'node:util';
import path from 'node:path';
import console from 'node:console';
import { engineeringSystem } from '../../packages/adapters/dist/index.js';
import { CodexNativeIntegration, runNativeWork } from '../../packages/codex-integration/dist/index.js';
import { staticPlan } from '../../packages/core/dist/index.js';
const { values } = parseArgs({ options: { home: { type: 'string' }, 'accept-change': { type: 'boolean' }, 'with-pending': { type: 'boolean' } } });
if (!values.home) throw new Error('Explicit fixture state required');
const s = await engineeringSystem(path.resolve(values.home)); const previous = await s.store.get('reports/native-workflow-latest.json');
let pendingStage = null;
const pending = 'Repeat independent runtime regression in the next Codex session';
if (values['with-pending']) {
  await s.work.resume(previous.native.workId, Boolean(values['accept-change'])); const stage = await s.work.get(previous.native.workId);
  await s.work.progress(stage.id, ['preserve public API'], [pending]);
  const plan = await staticPlan(s.tasks, s.code, stage.projectId, 'Preserve the verified fix and explicitly retain a next-session revalidation item', ['startRuntime']);
  await s.tasks.submitPlan(stage.taskId, plan.plan);
  for (const command of ['independent-runtime', 'internal-runtime']) if ((await s.tasks.runApproved(stage.taskId, command)).status !== 'passed') throw new Error('Pending stage needs real final-version passing evidence');
  await s.work.checkpoint(stage.id, true); const ready = await s.work.get(stage.id);
  pendingStage = { workId: ready.id, engineeringOutcome: ready.engineeringOutcome, evidenceStatus: ready.evidenceStatus, lastVerifiedRevision: ready.lastVerifiedRevision, outstanding: ready.outstanding };
  if (ready.evidenceStatus !== 'valid' || ready.engineeringOutcome !== 'incomplete' || !ready.outstanding.includes(pending)) throw new Error('Must retain verified code evidence and unfinished work separately');
}
const resumed = await s.work.resume(previous.native.workId, Boolean(values['accept-change']));
if (resumed.status === 'review-required') { console.log(JSON.stringify(resumed)); process.exitCode = 2; }
else {
  const native = new CodexNativeIntegration(s.store, s.registry, s.identities, s.workspaces, s.tasks);
  const result = await runNativeWork(native, s.work, previous.native.attachmentId, `Continue the previously completed runtime fix using recorded Work context. Inspect current source and evidence, submit a fresh plan and revalidate both approved commands for this resumed Task. Resolve exact outstanding items using record_work_progress resolved after both pass. ${values['with-pending'] ? `Selected pending item: ${pending}.` : ''} Do not edit already-correct code or repeat unrelated work. Report evidence/version disagreement. Preserve other outstanding findings unless source or test evidence resolves them; valid code evidence does not make unresolved engineering work complete.`, { coding: true, workId: previous.native.workId });
  const final = await s.work.get(result.workId); const selectedPendingResolved = !final.outstanding.includes(pending);
  const stateAccurate = final.outstanding.length ? final.engineeringOutcome === 'incomplete' : final.engineeringOutcome === 'verified';
  const continuationPassed = result.nativeExitCode === 0 && result.completedTurns > 0 && result.sourceUnchanged && result.validation?.status === 'passed' && result.evidenceStatus === 'valid' && !result.modelEdited && (!values['with-pending'] || selectedPendingResolved) && stateAccurate;
  const report = { ...result, nativeWorkStatus: result.status, status: continuationPassed ? 'passed' : 'failed', protocolVersion: 2, pendingStage, selectedPendingResolved, remainingOutstanding: final.outstanding, stateAccurate, unnecessaryEditsObserved: result.modelEdited, resultMeaning: 'Continuation contract: current code revalidated, selected pending resolved, new findings retained honestly; not a claim that all engineering work is complete' };
  await s.store.put(`reports/native-continuation-${result.taskId}.json`, report); await s.store.put('reports/native-continuation-latest.json', report); console.log(JSON.stringify(report, null, 2)); process.exitCode = continuationPassed ? 0 : 2;
}
