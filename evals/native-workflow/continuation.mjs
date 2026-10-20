import { parseArgs } from 'node:util';
import path from 'node:path';
import console from 'node:console';
import { engineeringSystem } from '../../packages/adapters/dist/index.js';
import { CodexNativeIntegration, runNativeWork } from '../../packages/codex-integration/dist/index.js';
const { values } = parseArgs({ options: { home: { type: 'string' }, 'accept-change': { type: 'boolean' } } });
if (!values.home) throw new Error('Explicit fixture state required');
const s = await engineeringSystem(path.resolve(values.home)); const previous = await s.store.get('reports/native-workflow-latest.json');
const resumed = await s.work.resume(previous.native.workId, Boolean(values['accept-change']));
if (resumed.status === 'review-required') { console.log(JSON.stringify(resumed)); process.exitCode = 2; }
else {
  const native = new CodexNativeIntegration(s.store, s.registry, s.identities, s.workspaces, s.tasks);
  const result = await runNativeWork(native, s.work, previous.native.attachmentId, 'Continue the previously completed runtime fix using recorded Work context. Inspect current source and existing evidence, submit a fresh plan and revalidate both approved commands for the resumed Task. Resolve exact outstanding verification items using record_work_progress resolved after both pass. Do not make unnecessary edits. Report any evidence/version disagreement.', { coding: true, workId: previous.native.workId });
  await s.store.put('reports/native-continuation-latest.json', result); console.log(JSON.stringify(result, null, 2)); process.exitCode = result.status === 'passed' ? 0 : 2;
}
