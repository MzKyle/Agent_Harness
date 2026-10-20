import { parseArgs } from 'node:util';
import { cp, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import console from 'node:console';
import { engineeringSystem } from '../../packages/adapters/dist/index.js';
import { CodexNativeIntegration, runNativeWork } from '../../packages/codex-integration/dist/index.js';
import { configureIsolation, git, digest } from '../../packages/core/dist/index.js';
const repo = fileURLToPath(new URL('../../', import.meta.url));
const { values } = parseArgs({ options: { home: { type: 'string' }, 'auth-attachment': { type: 'string' }, image: { type: 'string', default: 'node:24-bookworm-slim' }, case: { type: 'string' } } });
if (!values.home || !values['auth-attachment']) throw new Error('Explicit isolated state and authentication attachment required');
const s = await engineeringSystem(path.resolve(values.home)); const native = new CodexNativeIntegration(s.store, s.registry, s.identities, s.workspaces, s.tasks);
await native.get(values['auth-attachment']); await configureIsolation(s.store, values.image);
const run = `comparison-${Date.now()}`; const base = path.join(repo, '.devagent-evals', run); await mkdir(base, { recursive: true });
const reports = [];
const json = text => { try { return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { return null; } };
const cases = [
  { name: 'single-module', coding: true, goal: 'Fix src/backend.ts progress to return rounded percentage, including zero total. Preserve its public API. Run the approved independent grader.',
    grader: "import{test}from'node:test';import assert from'node:assert/strict';import{progress}from'/workspace/src/backend.ts';test('percentage boundaries',()=>{assert.equal(progress(1,4),25);assert.equal(progress(3,4),75);assert.equal(progress(0,0),0);assert.equal(progress(1,3),33)})" },
  { name: 'multi-module', coding: true, goal: 'Fix percentage calculation in src/backend.ts and state labels in src/status.ts: running means Running; succeeded means Completed; unknown means Waiting. Preserve public APIs. Run the approved independent grader.',
    grader: "import{test}from'node:test';import assert from'node:assert/strict';import{progress}from'/workspace/src/backend.ts';import{statusLabel}from'/workspace/src/status.ts';test('state and progress agree',()=>{assert.equal(progress(2,5),40);assert.equal(progress(0,0),0);assert.equal(statusLabel('running'),'Running');assert.equal(statusLabel('succeeded'),'Completed');assert.equal(statusLabel('unknown'),'Waiting')})" },
  { name: 'log-diagnosis', coding: false, goal: 'Diagnose this authorized synthetic trace using source evidence. Events: [{"trace_id":"fixture-trace","component":"api","severity":"info","message":"request accepted"},{"trace_id":"fixture-trace","component":"worker","severity":"error","message":"job failed"},{"trace_id":"fixture-trace","component":"ui","severity":"warning","message":"failure displayed"}]. Return only JSON {traceId,failureStage,components,sourcePath}. Identify the observed failure stage; do not claim a proven root cause.',
    oracle: text => { const value = json(text); return value?.traceId === 'fixture-trace' && value?.failureStage === 'worker' && ['api', 'worker', 'ui'].every(item => value?.components?.includes(item)) && value?.sourcePath === 'src/service.ts'; } },
  { name: 'work-continuation', coding: false, goal: 'Continue the selected prior engineering work. src/selected-history.ts contains the operator-selected summary; current source and Harness memory may be queried where available. Return only JSON with pending:string, decision:string, verified:boolean. Report the selected pending work and decision; do not infer verification from a completed analysis task.',
    oracle: text => { const value = json(text); return typeof value?.pending === 'string' && value.pending.toLowerCase().includes('independent runtime regression') && typeof value?.decision === 'string' && value.decision.toLowerCase().includes('preserve public api') && value?.verified === false; } },
];
for (const [index, scenario] of cases.entries()) {
  if (values.case && values.case !== scenario.name) continue;
  const source = path.join(base, scenario.name); await cp(path.join(repo, scenario.coding ? 'fixtures/functional-mvp' : 'fixtures/personal-engineering/fresh'), source, { recursive: true });
  if (scenario.name === 'work-continuation') await writeFile(path.join(source, 'src/selected-history.ts'), 'export const selectedHistory = { pending: "independent runtime regression", decision: "preserve public API", verified: false };\n');
  git(source, ['init', '-b', 'fixture/dev']); git(source, ['config', 'user.name', 'Fixture']); git(source, ['config', 'user.email', 'fixture@localhost.invalid']); git(source, ['add', '--all']); git(source, ['commit', '-m', 'Paired controlled starting revision']);
  const project = await s.registry.add(source, { fixture: true, shareFixture: true, rules: true }); const identity = await s.identities.resolve(project.id);
  if (scenario.name === 'log-diagnosis') await s.diagnostics.import(await readFile(path.join(source, 'events.jsonl'), 'utf8'), 'explicit synthetic paired input', { projectId: identity.stableProjectId });
  if (scenario.name === 'work-continuation') { const work = await s.work.start(identity.stableProjectId, 'Operator-selected prior fixture work (analysis only)'); await s.work.progress(work.id, ['preserve public API'], ['independent runtime regression']); await s.work.checkpoint(work.id, true); }
  for (const baseline of index % 2 ? [false, true] : [true, false]) {
    const workspace = await s.workspaces.create(identity.stableProjectId);
    if (scenario.coding) { await s.store.put(`graders/${workspace.id}/independent.mjs`, scenario.grader); await s.execution.approve(workspace.id, { id: 'independent', executable: 'node', args: ['--test', '/grader/independent.mjs'] }); }
    const attachment = await native.attach(identity.stableProjectId, { workspaceId: workspace.id, authFrom: values['auth-attachment'] });
    let result;
    try { result = await runNativeWork(native, s.work, attachment.id, scenario.goal, { coding: scenario.coding, baseline, ...(scenario.oracle ? { answerOracle: scenario.oracle } : {}), timeoutMs: 240000 }); }
    catch (error) { result = { status: 'failed', reason: error.code ?? 'RUN_FAILED', variant: baseline ? 'native-with-scoped-io-only' : 'harness-enhanced' }; }
    reports.push({ case: scenario.name, userInputHash: digest(scenario.goal), sourceRevision: workspace.sourceRevision, resources: 'same pinned Docker image; nonroot/no-network/512MiB/1cpu; same command form and oracle', result });
    await s.store.put(`reports/${run}.json`, { run, trialsPerVariant: 1, baselineDefinition: 'Official Codex with identical gated source/edit/test MCP I/O; Harness Skill/hooks/context/memory/diagnostics disabled. This is not unrestricted host-shell Codex.', reports, limitations: ['Single ordered pair per case is not statistically significant', 'Backend caching, latency and model nondeterminism can differ', 'Preparation/command approvals are explicit operator fixture setup for both variants'] });
    console.log(JSON.stringify({ case: scenario.name, baseline, status: result.status, elapsedMs: result.elapsedMs }));
  }
}
await s.store.put('reports/comparison-latest.json', await s.store.get(`reports/${run}.json`));
console.log(JSON.stringify({ run, passed: reports.filter(item => item.result.status === 'passed').length, total: reports.length }));
