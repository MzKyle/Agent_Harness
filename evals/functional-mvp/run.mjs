import process from 'node:process';
import { parseArgs } from 'node:util';
import { cp, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { engineeringSystem } from '../../packages/adapters/dist/index.js';
import { git, fingerprint, configureIsolation, isolationCheck, staticPlan, digest } from '../../packages/core/dist/index.js';
import { FunctionalDshDriver, IsolatedCodex } from '../../packages/dsh-bridge/dist/index.js';
import { validateRealProjects } from './real-projects.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { values: args } = parseArgs({ options: { home: { type: 'string' }, image: { type: 'string' }, online: { type: 'boolean' }, 'als-path': { type: 'string' }, 'pollen-path': { type: 'string' } } });
const system = await engineeringSystem(path.resolve(args.home ?? path.join(repo, '.devagent-state')));
if (args.image) await configureIsolation(system.store, args.image);
const started = Date.now();
const runId = `functional-${started}`;
await mkdir(path.join(repo, '.devagent-evals'), { recursive: true });
const parent = await mkdtemp(path.join(repo, '.devagent-evals', 'run-'));
const source = path.join(parent, 'source');
await cp(path.join(repo, 'fixtures/functional-mvp'), source, { recursive: true });
git(source, ['init', '-b', 'fixture']); git(source, ['config', 'user.name', 'Fixture']); git(source, ['config', 'user.email', 'fixture@localhost.invalid']);
git(source, ['add', '--all']); git(source, ['commit', '-m', 'Intentional reproducible bugs']);
const before = await fingerprint(source);
const project = await system.registry.add(source, { fixture: true, shareFixture: true, rules: true });
const workspace = await system.workspaces.create(project.id);
const grader = await readFile(path.join(repo, 'evals/functional-mvp/grader.mjs'), 'utf8');
await system.store.put(`graders/${workspace.id}/acceptance.test.mjs`, grader);
await system.execution.approve(workspace.id, { id: 'independent-acceptance', executable: 'node', args: ['--test', '/grader/acceptance.test.mjs'] });
const isolation = await isolationCheck(system.store);
let offline;
if (!isolation.verified) offline = { level: 3, status: 'blocked', reason: 'blocked_by_isolation', remedy: isolation.remedy };
else {
  const task = await system.tasks.create(project.id, 'Offline deterministic workflow: backend progress and frontend status. No model autonomy claim.', 'isolated', workspace.id);
  const plan = await staticPlan(system.tasks, system.code, project.id, 'Correct percentage and status mapping', ['progress', 'statusLabel']);
  await system.tasks.submitPlan(task.id, plan.plan); task.plan = plan.plan; task.state = 'running'; await system.tasks.save(task);
  const failing = await system.tasks.runApproved(task.id, 'independent-acceptance');
  assert.equal(failing.status, 'failed', 'Intentional bugs must genuinely fail');
  const diagnosis = await system.diagnostics.diagnose(project.id, task.id);
  assert(diagnosis.relatedSource.some(source => source.path === 'src/backend.ts'), 'Diagnosis must contain an actual bounded source candidate');
  // This is explicitly a deterministic infrastructure exercise, not an Agent repair.
  await system.workspaces.write(workspace.id, 'src/backend.ts', 'export function progress(completed: number, total: number): number { return total <= 0 ? 0 : Math.round(completed / total * 100); }\n');
  await system.workspaces.write(workspace.id, 'src/status.ts', "export function statusLabel(state:string):string { return state === 'running' ? 'Running' : state === 'succeeded' ? 'Completed' : 'Waiting'; }\n");
  const passing = await system.tasks.runApproved(task.id, 'independent-acceptance');
  assert.equal(passing.status, 'passed');
  assert(await system.execution.evidence.isVerified(passing.id, await system.workspaces.workingRevision(workspace.id)));
  const patch = await system.workspaces.diff(workspace.id); assert.equal(patch.changedFiles.length, 2);
  const record = await system.tasks.get(task.id); record.state = 'succeeded'; record.finishedAt = new Date().toISOString(); await system.tasks.save(record); await system.tasks.report(record.id);
  const imported = await system.diagnostics.import(await readFile(path.join(source, 'events.jsonl'), 'utf8'), 'explicit-fixture-trace');
  const trace = await system.diagnostics.query({ diagnosticId: imported.id, traceId: 'trace-fixture-1' });
  assert.equal(trace.events.length, 3); assert(trace.events.some(event => event.severity === 'error'));
  assert(!/mock-secret-only|mock-device|mock@example/.test(JSON.stringify(trace)));
  await system.store.put(`reports/${runId}.trace.json`, { trace, diagnosis, conclusion: 'Worker exception is the recorded failure phase; frontend/API events share the trace. Root cause requires code and test evidence.' });
  const unchanged = digest(JSON.stringify(before)) === digest(JSON.stringify(await fingerprint(source))); assert(unchanged);
  offline = { level: 3, status: 'passed', taskId: task.id, workspaceId: workspace.id, evidenceIds: [failing.id, passing.id], patch: patch.artifact,
    modelCalls: 0, autonomousRepair: false, method: 'deterministic infrastructure validation', toolCalls: record.toolCalls,
    humanInterventions: 1, independentTests: 'passed', traceEvents: trace.events.length, originalUnchanged: unchanged };
}
const native = await new IsolatedCodex(system.store, system.workspaces).status();
let online = { level: 4, status: 'blocked', dsh: process.env.DEEPSEEK_API_KEY ? 'not-run-explicit-online-required' : 'blocked_by_auth', codex: native.status,
  reason: 'DSH online deferred by user; isolated Codex needs its own native authentication', modelCalls: 0 };
if (args.online) {
  // Dedicated fresh buggy workspace: never reuse deterministic corrections above.
  const onlineSpace = await system.workspaces.create(project.id);
  await system.store.put(`graders/${onlineSpace.id}/acceptance.test.mjs`, grader);
  await system.execution.approve(onlineSpace.id, { id: 'independent-acceptance', executable: 'node', args: ['--test', '/grader/acceptance.test.mjs'] });
  const driver = new FunctionalDshDriver(system.store, system.registry, system.workspaces, system.tasks);
  const smoke = await system.tasks.run(project.id, 'Call search_code for progress, use its result and return structured JSON with source path and taskId.', 'online-smoke', driver);
  const dsh = await system.tasks.run(project.id, 'Fix progress percentages and statusLabel mappings. Approved command: independent-acceptance. Do not modify tests. Diagnose failures; final revision must pass.', 'isolated', driver, { workspaceId: onlineSpace.id });
  const codexSpace = await system.workspaces.create(project.id);
  await system.store.put(`graders/${codexSpace.id}/acceptance.test.mjs`, grader);
  await system.execution.approve(codexSpace.id, { id: 'independent-acceptance', executable: 'node', args: ['--test', '/grader/acceptance.test.mjs'] });
  const codex = await system.tasks.run(project.id, 'Fix progress percentages and statusLabel mappings; do not modify tests.', 'isolated', driver, { workspaceId: codexSpace.id, codex: true });
  online = { level: 4, status: [smoke, dsh, codex].every(task => task.state === 'succeeded') ? 'passed' : [smoke, dsh, codex].some(task => task.state === 'failed') ? 'failed' : 'blocked',
    tasks: [smoke, dsh, codex].map(task => ({ id: task.id, state: task.state, reason: task.reason, modelCalls: task.modelCalls, mutatingToolCalls: task.toolCalls, attempts: task.attempts, durationMs: Date.parse(task.finishedAt) - Date.parse(task.createdAt) })) };
}
const real = await validateRealProjects(system, { als: args['als-path'], pollen: args['pollen-path'] });
const summary = { runId, finishedAt: new Date().toISOString(), durationMs: Date.now() - started, unit: 'run pnpm test separately', integration: 'run pnpm test:integration separately',
  offline, online, real, isolation, aiFunctionalMvpComplete: online.status === 'passed' && real.status === 'passed' };
await system.store.put(`reports/${runId}.json`, summary);
await system.store.put('reports/functional-latest.json', summary);
await system.store.put('reports/functional-latest.md', `# Functional verification\n\nOffline E2E: ${offline.status}\n\nOnline Agent E2E: ${online.status}\n\nReal projects: ${real.status}\n\nAI Functional MVP complete: ${summary.aiFunctionalMvpComplete}\n\nDetails: ${runId}.json\n`);
process.stdout.write(JSON.stringify({ report: system.store.resolve('reports/functional-latest.json'), offline: offline.status, online: online.status, real: real.status, aiFunctionalMvpComplete: summary.aiFunctionalMvpComplete }, null, 2)+'\n');
if ([offline, online, real].some(item => item.status === 'failed')) process.exitCode = 1;
else if (args.online && online.status !== 'passed') process.exitCode = 2;
