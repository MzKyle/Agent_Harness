import { parseArgs } from 'node:util';
import { cp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import console from 'node:console';
import { engineeringSystem } from '../../packages/adapters/dist/index.js';
import { CodexNativeIntegration, runNativeWork } from '../../packages/codex-integration/dist/index.js';
import { configureIsolation, git, digest, revision, workSnapshot } from '../../packages/core/dist/index.js';
const repo = fileURLToPath(new URL('../../', import.meta.url));
const { values } = parseArgs({ options: { home: { type: 'string' }, 'auth-attachment': { type: 'string' }, repeats: { type: 'string', default: '2' }, case: { type: 'string' }, information: { type: 'string', default: 'both' } } });
if (!values.home || !values['auth-attachment']) throw new Error('Explicit fixture state and authentication reference required');
const repeats = Number(values.repeats); if (!Number.isInteger(repeats) || repeats < 1 || repeats > 5) throw new Error('Bound repetitions to 1..5');
if (!['equal', 'natural', 'both'].includes(values.information)) throw new Error('Information protocol denied');
const s = await engineeringSystem(path.resolve(values.home)); const native = new CodexNativeIntegration(s.store, s.registry, s.identities, s.workspaces, s.tasks);
await native.get(values['auth-attachment']); await configureIsolation(s.store, 'node:24-bookworm-slim');
const run = `daily-comparison-${Date.now()}`; const base = path.join(repo, '.devagent-evals', run); await mkdir(base, { recursive: true });
const parse = text => { try { return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { return null; } };
const percentage = "import{test}from'node:test';import assert from'node:assert/strict';import{progress}from'/workspace/src/backend.ts';test('independent boundaries',()=>{assert.equal(progress(1,4),25);assert.equal(progress(0,0),0);assert.equal(progress(1,3),33);EXTRA})";
const scenarios = [
  { name: 'single-module', coding: true, deep: 'engineering', goal: 'Fix src/backend.ts progress to return rounded percentage, including zero total. Preserve its public API.', grader: percentage.replace('EXTRA', '') },
  { name: 'multi-module', coding: true, deep: 'engineering', goal: 'Fix multi-module behavior: percentage in src/backend.ts, and src/status.ts labels: running=Running, succeeded=Completed, unknown=Waiting. Preserve public APIs.', grader: percentage.replace("import{progress}", "import{statusLabel}from'/workspace/src/status.ts';import{progress}").replace('EXTRA', "assert.equal(statusLabel('running'),'Running');assert.equal(statusLabel('succeeded'),'Completed');assert.equal(statusLabel('unknown'),'Waiting');") },
  { name: 'log-diagnosis', coding: false, deep: 'deep', goal: 'Diagnose the synthetic API/worker/UI trace using source evidence. Read src/trace.ts. Return only JSON {traceId,failureStage,sourcePath}; distinguish observed failure from a root cause.', oracle: text => { const a = parse(text); return a?.traceId === 'fixture-trace' && a?.failureStage === 'worker' && a?.sourcePath === 'src/service.ts'; } },
  { name: 'work-continuation', coding: false, deep: 'engineering', goal: 'Continue the selected previous work for this project. Return only JSON {pending:string,decision:string,verified:boolean}; Copy the selected stored pending and decision strings verbatim, without expanding or paraphrasing them. Do not equate analysis completion with engineering verification.', equal: 'Necessary selected history is in src/archive/selected.ts: pending=independent runtime regression; decision=preserve public API; verified=false.', oracle: text => { const a = parse(text); const checks = { pending: typeof a?.pending === 'string' && a.pending.toLowerCase().includes('independent runtime regression'), decision: typeof a?.decision === 'string' && a.decision.toLowerCase().includes('preserve public api'), verification: a?.verified === false }; return { passed: Object.values(checks).every(Boolean), checks }; } },
  { name: 'project-constraint', coding: true, deep: 'engineering', goal: 'Fix src/backend.ts percentage calculation, preserve the public API and obey the project special constraint for invalid and over-complete values. Inspect the project contract if needed.', equal: 'Project contract: return 0 for total<=0, clamp rounded percentage to [0,100].', grader: percentage.replace('EXTRA', 'assert.equal(progress(1,-1),0);assert.equal(progress(-1,4),0);assert.equal(progress(5,4),100);') },
];
const reports = [];
let preparationFailure = null;
const implementation = await workSnapshot(repo);
const compiledDigest = async () => {
  const files = [];
  const collect = async folder => {
    for (const entry of await readdir(path.join(repo, folder), { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('Compiled runtime links denied');
      const file = `${folder}/${entry.name}`;
      if (entry.isDirectory()) await collect(file); else if (entry.isFile() && entry.name.endsWith('.js')) files.push(file);
    }
  };
  for (const folder of ['apps/cli/dist', ...['core', 'adapters', 'codex-integration', 'diagnostics-mcp', 'dsh-bridge'].map(name => `packages/${name}/dist`)]) await collect(folder);
  return digest((await Promise.all(files.sort().map(async file => `${file}\0${digest(await readFile(path.join(repo, file)))}`))).join('\n'));
};
const runtimeDigest = await compiledDigest();
const persist = async () => {
  const report = { run, protocolVersion: 1, harnessRevision: revision(repo), repeats, reports, baselineDefinition: 'Official Codex plus identical gated source/edit/test MCP I/O, without extra Harness context, memory, diagnostics or Skill. Not unrestricted native Codex.', informationProtocols: { equal: 'Same necessary facts are explicitly identified in identical user input; measures additional overhead.', natural: 'Same facts are discoverable in committed source archives/contracts for all variants; Harness additionally has its ordinary scoped Work/memory index. User input does not preselect the file or inject remembered facts. Measures discovery under these documented fixture conditions, not general memory superiority.' }, limitations: ['Small alternating independent trials, not statistically significant', 'Official usage is not billed token count; exact model requests unavailable', 'Preparation/approvals shared by all variants; no in-run human intervention', 'V0.4 comparison has different protocol/prompts and is descriptive only'] };
  Object.assign(report, { protocolVersion: 4, independentProjectsPerTrial: true, preparationFailure, implementationSourceDigest: implementation.sourceDigest, compiledRuntimeDigest: runtimeDigest, revisionMeaning: 'Git HEAD is the starting baseline; implementation and compiled digests bind uncommitted development code' });
  await s.store.put(`reports/${run}.json`, report); await s.store.put('reports/daily-comparison-latest.json', report);
};
try { for (const information of values.information === 'both' ? ['equal', 'natural'] : [values.information]) {
  for (const [index, scenario] of scenarios.entries()) {
    if (values.case && values.case !== scenario.name || information === 'natural' && !scenario.equal) continue;
    const source = path.join(base, information, scenario.name); await mkdir(source, { recursive: true });
    await cp(path.join(repo, scenario.coding ? 'fixtures/functional-mvp' : 'fixtures/personal-engineering/fresh'), source, { recursive: true });
    if (scenario.name === 'log-diagnosis') await writeFile(path.join(source, 'src/trace.ts'), 'export const trace = {traceId:"fixture-trace", events:[{component:"api",event:"accepted"},{component:"worker",event:"failed"},{component:"ui",event:"failure displayed"}],sourcePath:"src/service.ts"};\n');
    if (scenario.name === 'work-continuation') {
      await mkdir(path.join(source, 'src/archive'), { recursive: true });
      await writeFile(path.join(source, 'src/archive/selected.ts'), 'export const selectedHistory={pending:"independent runtime regression",decision:"preserve public API",verified:false};\n');
      for (let i = 0; i < 5; i++) await writeFile(path.join(source, `src/archive/old-${i}.ts`), `export const archived={pending:"none",decision:"historical only",selected:false}; // record ${i}\n`);
    }
    if (scenario.name === 'project-constraint') await writeFile(path.join(source, 'src/policy.ts'), 'export const projectContract="Return 0 for total<=0; clamp rounded percentage to [0,100]; preserve public API";\n');
    git(source, ['init', '-b', 'fixture/dev']); git(source, ['config', 'user.name', 'Fixture']); git(source, ['config', 'user.email', 'fixture@localhost.invalid']); git(source, ['add', '--all']); git(source, ['commit', '-m', 'Independent three-policy comparison input']);
    for (let repetition = 0; repetition < repeats; repetition++) {
      const variants = ['baseline', 'auto', 'enhanced']; const offset = (index + repetition) % variants.length; const order = [...variants.slice(offset), ...variants.slice(0, offset)];
      for (const variant of order) {
        if (await compiledDigest() !== runtimeDigest) throw new Error('Compiled comparison runtime changed; start a new protocol run');
        const trialSource = path.join(base, information, scenario.name, `trial-${repetition}-${variant}`, 'source'); await mkdir(path.dirname(trialSource), { recursive: true });
        git(repo, ['clone', '--no-hardlinks', '--', source, trialSource]);
        // Local paths are deliberately not accepted as portable repository identities.
        // Remove only this owned fixture clone's synthetic origin; the committed input stays identical.
        git(trialSource, ['remote', 'remove', 'origin']);
        const project = await s.registry.add(trialSource, { fixture: true, shareFixture: true, rules: true }); const identity = await s.identities.resolve(project.id);
        if (scenario.name === 'work-continuation') { const prior = await s.work.start(identity.stableProjectId, 'Selected previous fixture work'); await s.work.progress(prior.id, ['preserve public API'], ['independent runtime regression']); await s.work.checkpoint(prior.id, true); }
        if (scenario.name === 'project-constraint') await s.memory.set({ domain: 'project', projectId: identity.stableProjectId, type: 'constraint', topic: 'Synthetic project percentage contract', content: scenario.equal });
        const workspace = await s.workspaces.create(identity.stableProjectId); let preflight = null;
        if (scenario.coding) {
          await s.store.put(`graders/${workspace.id}/independent.mjs`, scenario.grader);
          await s.execution.approve(workspace.id, { id: 'independent', executable: 'node', args: ['--test', '/grader/independent.mjs'] });
          const probe = await s.tasks.create(identity.stableProjectId, 'Independent preflight; must fail before edits', 'isolated', workspace.id);
          preflight = await s.execution.run(workspace.id, 'independent', probe.id);
          if (preflight.status !== 'failed') throw new Error(`Independent initial failure expected, got ${preflight.status}`);
        }
        const attachment = await native.attach(identity.stableProjectId, { workspaceId: workspace.id, authFrom: values['auth-attachment'] });
        const goal = `${scenario.goal} ${information === 'equal' ? scenario.equal ?? '' : ''}`.trim();
        let result;
        try { result = await runNativeWork(native, s.work, attachment.id, goal, { coding: scenario.coding, baseline: variant === 'baseline', mode: variant === 'enhanced' ? scenario.deep : 'auto', ...(scenario.oracle ? { answerOracle: scenario.oracle } : {}), timeoutMs: 240000 }); }
        catch (error) { result = { status: 'failed', reason: error.code ?? 'RUN_FAILED' }; }
        reports.push({ case: scenario.name, information, repetition, variant, order, userInputHash: digest(goal), sourceRevision: workspace.sourceRevision, independentGraderHash: scenario.grader ? digest(scenario.grader) : null, initialFailure: preflight?.id ?? null, result });
        await persist(); console.log(JSON.stringify({ run, case: scenario.name, information, repetition, variant, status: result.status, elapsedMs: result.elapsedMs, tools: result.toolCalls, selected: result.selection?.mode }));
      }
    }
  }
} } catch (error) { preparationFailure = { code: error.code ?? 'EVALUATION_PREPARATION_FAILED', stage: 'preparation-or-protocol-integrity', modelResultClaimed: false }; }
await persist(); console.log(JSON.stringify({ run, passed: reports.filter(item => item.result.status === 'passed').length, total: reports.length }));
process.exitCode = !preparationFailure && reports.length > 0 && reports.every(item => item.result.status === 'passed') ? 0 : 2;
