import process from 'node:process';
import { parseArgs } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import assert from 'node:assert/strict';
import { engineeringSystem } from '../../packages/adapters/dist/index.js';
import { git, fingerprint, digest, configureIsolation, staticPlan } from '../../packages/core/dist/index.js';
import { CodexNativeIntegration, probeHarnessMcp } from '../../packages/codex-integration/dist/index.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { values: args } = parseArgs({ options: { home: { type: 'string' }, image: { type: 'string' }, online: { type: 'boolean' }, 'als-path': { type: 'string' }, 'pollen-path': { type: 'string' } } });
const started = Date.now(); const runId = `personal-engineering-${started}`;
await mkdir(path.join(root, '.devagent-evals'), { recursive: true });
const parent = await mkdtemp(path.join(root, '.devagent-evals/v3-run-'));
const s = await engineeringSystem(path.resolve(args.home ?? path.join(parent, 'state-a')));
const initial = await s.intelligence.read();
if (Object.keys(initial.identities).length || Object.keys(initial.memories).length) throw new Error('EVAL_REQUIRES_FRESH_STATE: choose a new --home to keep synthetic profiles separate from personal data');
const results = { unit: { status: 'skipped', reason: 'Run pnpm test separately' }, integration: { status: 'skipped', reason: 'Run pnpm test:integration separately' } };
async function phase(name, run) {
  try { results[name] = await run(); }
  catch (error) { results[name] = { status: 'failed', reason: error.code ?? error.message?.slice(0, 240) ?? 'UNEXPECTED_FAILURE' }; }
  await s.store.put(`reports/${runId}.progress.json`, { runId, results });
  process.stdout.write(JSON.stringify({ phase: name, status: results[name].status }) + '\n');
}
async function fixture(name, existing = false) {
  const source = path.join(parent, name); await cp(path.join(root, 'fixtures/personal-engineering/fresh'), source, { recursive: true });
  if (existing) {
    await writeFile(path.join(source, 'AGENTS.md'), '# Existing rules\n\nPreserve all public interfaces.\n');
    await mkdir(path.join(source, '.agents/skills/existing-debugging'), { recursive: true });
    await writeFile(path.join(source, '.agents/skills/existing-debugging/SKILL.md'), '---\nname: existing-debugging\ndescription: Diagnose this project through its existing tests.\n---\n\nRead current evidence and use approved tests.\n');
    await mkdir(path.join(source, '.codex')); await writeFile(path.join(source, '.codex/config.toml'), '# Existing native preferences\nweb_search = "disabled"\n');
  }
  git(source, ['init', '-b', 'fixture/dev']); git(source, ['config', 'user.name', 'Harness Fixture']); git(source, ['config', 'user.email', 'fixture@localhost.invalid']);
  git(source, ['remote', 'add', 'origin', `https://example.invalid/${runId}/${name}.git`]); git(source, ['add', '--all', '--force']); git(source, ['commit', '-m', 'Controlled V0.3 fixture']);
  const record = await s.registry.add(source, { fixture: true, shareFixture: true, rules: true }); const identity = await s.identities.resolve(record.id);
  return { source, record, id: identity.stableProjectId };
}
const fresh = await fixture('fresh'); const original = await fingerprint(fresh.source);
const native = new CodexNativeIntegration(s.store, s.registry, s.identities, s.workspaces, s.tasks);
s.onboarding.nativeConfigCandidate = id => native.config(id);
const isolation = await configureIsolation(s.store, args.image ?? 'node:24-bookworm-slim');
let workspace; let evolutionTask; let nextTask; let proposal;

await phase('onboarding', async () => {
  if (!isolation.verified) return { status: 'blocked', reason: 'blocked_by_isolation', isolation };
  const plan = await s.onboarding.plan(fresh.id, true); assert.deepEqual(plan.blocked, []);
  const grant = await s.onboarding.approve(plan.id, 'workspace', plan.diffHash);
  const applied = await s.onboarding.apply(plan.id, grant.id, 'workspace'); workspace = await s.workspaces.get(applied.plan.application.workspaceId);
  await s.execution.approve(workspace.id, { id: 'project-regression', executable: 'node', args: ['--test', 'tests/project.test.mjs'] });
  const verification = await s.onboarding.verify(plan.id, ['project-regression'], () => probeHarnessMcp(s.store, fresh.id)); assert.equal(verification.status, 'passed');
  assert.equal((await s.onboarding.apply(plan.id, grant.id, 'workspace')).idempotent, true);
  assert.deepEqual(await fingerprint(fresh.source), original);
  return { status: 'passed', projectId: fresh.id, planId: plan.id, workspaceId: workspace.id, created: plan.changes.map(change => change.path), diffArtifact: `artifacts/${plan.id}/provisioning.patch`, verification, humanApproval: 'deterministic fixture review simulation', sourceUnchanged: true };
});
await phase('existingNorms', async () => {
  const f = await fixture('existing', true); const old = await readFile(path.join(f.source, 'AGENTS.md'), 'utf8');
  const plan = await s.onboarding.plan(f.id, true); assert.equal(plan.changes.filter(change => change.path.endsWith('SKILL.md')).length, 0);
  assert(plan.reused.includes('.codex/config.toml')); assert(plan.changes.find(change => change.path === 'AGENTS.md').after.startsWith(old));
  const grant = await s.onboarding.approve(plan.id, 'project', plan.diffHash); await s.onboarding.apply(plan.id, grant.id, 'project');
  assert((await readFile(path.join(f.source, 'AGENTS.md'), 'utf8')).startsWith(old)); assert.equal((await s.onboarding.plan(f.id, true)).changes.length, 0);
  return { status: 'passed', projectId: f.id, planId: plan.id, reused: plan.reused, directWrites: 'managed fixture/dev branch only' };
});
await phase('capabilityEvolution', async () => {
  if (!workspace) return { status: 'blocked', reason: 'Onboarding workspace unavailable' };
  // Use a separate implementation snapshot so its approvals and attempt budget are explicit.
  workspace = await s.workspaces.create(fresh.id);
  const planning = await staticPlan(s.tasks, s.code, fresh.id, 'Implement a reusable sanitized trace diagnostic', ['total']);
  evolutionTask = await s.tasks.create(fresh.id, 'Deterministic diagnostic extension implementation and independent verification', 'isolated', workspace.id);
  await s.tasks.submitPlan(evolutionTask.id, planning.plan); evolutionTask.plan = planning.plan; evolutionTask.state = 'running'; await s.tasks.save(evolutionTask);
  const gap = { gap: 'Missing reusable trace diagnostic', why: 'Identify the observed error phase and shared components', existingAlternative: 'Manual project-scoped diagnostic query', crossProject: true, needsAdapter: false, suggestion: 'Pure bounded trace correlation module, independently tested and human reviewed', risks: ['No production logs, secrets or hardware'], requiresApproval: true };
  await s.tasks.gap(evolutionTask.id, gap); await s.tasks.gap(evolutionTask.id, gap); proposal = (await s.evolution.list(fresh.id)).find(item => item.title === gap.gap); assert.equal(proposal.gapIds.length, 2);
  await s.evolution.approve(proposal.id);
  await s.store.put(`graders/${workspace.id}/diagnostic.test.mjs`, await readFile(path.join(root, 'evals/personal-engineering/diagnostic-grader.mjs'), 'utf8'));
  await s.execution.approve(workspace.id, { id: 'diagnostic-oracle', executable: 'node', args: ['--test', '/grader/diagnostic.test.mjs'] });
  const failing = await s.tasks.runApproved(evolutionTask.id, 'diagnostic-oracle'); assert.equal(failing.status, 'failed');
  await s.workspaces.write(workspace.id, 'src/trace-diagnostic.ts', await readFile(path.join(root, 'fixtures/personal-engineering/extension-proposal/trace-diagnostic.ts'), 'utf8'));
  const events = (await readFile(path.join(fresh.source, 'events.jsonl'), 'utf8')).trim().split(/\r?\n/).map(line => JSON.parse(line));
  await s.diagnostics.import(JSON.stringify(events[0]) + '\n' + JSON.stringify(events[1]) + '\n' + JSON.stringify(events[2]), 'explicit sanitized fixture input', { projectId: fresh.id, taskId: evolutionTask.id });
  await s.workspaces.write(workspace.id, 'tools/diagnostic-input.ts', `export default ${JSON.stringify(events, null, 2)};\n`);
  await s.workspaces.write(workspace.id, 'tools/diagnose-trace.mjs', `import events from'./diagnostic-input.ts';import{correlate}from'../src/trace-diagnostic.ts';console.log(JSON.stringify(correlate(events,'fixture-trace')));\n`);
  await s.execution.approve(workspace.id, { id: 'diagnose-trace', executable: 'node', args: ['--test', 'tools/diagnose-trace.mjs'] });
  await s.evolution.implemented(proposal.id, workspace.id, evolutionTask.id, 'diagnose-trace');
  const passing = await s.tasks.runApproved(evolutionTask.id, 'diagnostic-oracle'); assert.equal(passing.status, 'passed');
  const invocationCheck = await s.tasks.runApproved(evolutionTask.id, 'diagnose-trace'); assert.equal(invocationCheck.status, 'passed');
  await s.evolution.verify(proposal.id, passing.id); await s.evolution.adopt(proposal.id);
  evolutionTask = await s.tasks.get(evolutionTask.id); evolutionTask.state = 'succeeded'; evolutionTask.finishedAt = new Date().toISOString(); await s.tasks.save(evolutionTask); await s.tasks.report(evolutionTask.id);
  nextTask = await s.tasks.create(fresh.id, 'Consume the reviewed diagnostic in a subsequent engineering task', 'isolated', workspace.id); await s.tasks.submitPlan(nextTask.id, planning.plan); nextTask.plan = planning.plan; nextTask.state = 'running'; await s.tasks.save(nextTask);
  const nextOracle = await s.tasks.runApproved(nextTask.id, 'diagnostic-oracle'); assert.equal(nextOracle.status, 'passed');
  const used = await s.evolution.invoke(proposal.id, nextTask.id); assert.equal(used.evidence.status, 'passed'); assert(used.stdout.includes('"failureStage":"worker"'));
  nextTask = await s.tasks.get(nextTask.id); nextTask.state = 'succeeded'; nextTask.finishedAt = new Date().toISOString(); await s.tasks.save(nextTask); await s.tasks.report(nextTask.id);
  const currentRevision = await s.workspaces.workingRevision(workspace.id);
  const approved = (await s.store.list('approvals')).filter(command => command.workspaceId === workspace.id);
  for (const taskId of [evolutionTask.id, nextTask.id]) {
    const checked = await Promise.all((await s.execution.evidence.list(taskId)).map(async item => ({ commandId: item.commandId, verified: await s.execution.evidence.isVerified(item.id, currentRevision) })));
    assert(approved.every(command => checked.some(item => item.commandId === command.id && item.verified)));
  }
  assert((await s.capabilities.assess(fresh.id)).entries.some(item => item.id.startsWith('extension-') && item.status === 'verified'));
  return { status: 'passed', proposalId: proposal.id, taskId: evolutionTask.id, nextTaskId: nextTask.id, workspaceId: workspace.id, evidenceIds: [failing.id, passing.id, invocationCheck.id, nextOracle.id, used.evidence.id], allApprovedCommandsVerifiedAtFinalRevision: true, reusedOutput: used.stdout, patch: (await s.workspaces.diff(workspace.id)).artifact, method: 'deterministic fixture implementation, independent container tests, simulated human review; no autonomous Codex claim', modelCalls: 0, globalPluginLoaded: false };
});
await phase('memory', async () => {
  if (!evolutionTask || !nextTask) return { status: 'blocked', reason: 'Evolution task evidence unavailable' };
  const candidate = await s.memory.propose({ domain: 'developer', type: 'engineering-preference', topic: 'Synthetic evidence preference', content: 'Prefer explicit test evidence for trace diagnosis.' });
  assert.equal(candidate.record.confirmation, 'candidate'); await s.memory.review(candidate.record.id, 'confirm');
  const history = await s.history.recent(fresh.id); const actual = history.find(item => item.taskId === evolutionTask.id); assert(actual.failed.includes('diagnostic-oracle')); assert(actual.verified.includes('diagnostic-oracle')); assert(actual.modified.includes('src/trace-diagnostic.ts'));
  const candidateSummary = (await s.memory.search({ projectId: fresh.id, includeCandidates: true })).records.find(item => item.type === 'task-summary'); assert.equal(candidateSummary.confirmation, 'candidate');
  const brief = await s.context.brief(fresh.id, 'trace diagnosis', 5000); assert(brief.characters <= 5000); assert(brief.text.includes('Production/hardware access is forbidden'));
  const queried = await s.diagnostics.query({ projectId: fresh.id, traceId: 'fixture-trace' }); assert.equal(queried.events.length, 3);
  return { status: 'passed', preferenceId: candidate.record.id, taskSummaries: history.length, verifiedTask: actual, summaryConfirmation: candidateSummary.confirmation, contextHash: digest(brief.text), contextCharacters: brief.characters, diagnosticEvents: queried.events.length, taskCaptureBoundary: 'Only explicit Harness Tasks/reports are captured; ordinary external Codex work is not automatically observed' };
});
await phase('portability', async () => {
  const b = await engineeringSystem(path.join(parent, 'state-b')); const password = 'synthetic-acceptance-only-passphrase'; const backup = await s.portability.create(password);
  const preview = await b.portability.inspect(backup.file, password); await b.portability.restore(backup.file, password, preview.review.id);
  assert.deepEqual((await b.intelligence.bindings()).active, {}); assert.equal((await b.profiles.get(fresh.id)).binding, 'relink-required'); assert.equal((await b.store.list('approvals')).length, 0);
  const clone = path.join(parent, 'device-b-clone'); await cp(fresh.source, clone, { recursive: true }); const linked = await b.identities.relink(fresh.id, clone); assert.equal(linked.permissionsRestored, false);
  assert.equal((await b.registry.get(fresh.id)).sourceSharing, 'local-only'); assert.equal((await b.registry.get(fresh.id)).rulesAllowed, false); await b.profiles.refresh(fresh.id);
  const restored = await b.history.recent(fresh.id); assert(restored.every(item => item.evidenceTrust === 'historical-unverified' && item.verified.length === 0));
  if (proposal) { assert.equal((await b.evolution.get(proposal.id)).state, 'proposed'); assert.equal((await b.evolution.get(proposal.id)).invocationCommandId, null); }
  return { status: 'passed', backupArtifact: backup.artifact, manifest: backup.manifest, stableProjectId: fresh.id, deviceBState: b.store.root, relink: linked, importedHistoryTrust: 'historical-unverified', approvalsRestored: false, sourceSharingRestored: false, authenticationRestored: false };
});
await phase('codexNative', async () => {
  const attachment = await native.attach(fresh.id); const discovery = await native.inspect(attachment.id); assert(discovery.skillDiscovered); assert(discovery.mcpDiscovered);
  const session = args.online ? await native.session(attachment.id) : { status: discovery.authentication === 'blocked_by_auth' ? 'blocked_by_auth' : 'skipped', reason: 'Use --online for a real fixture-only model session', modelCalls: 0 };
  return { status: session.status === 'passed' ? 'passed' : session.status === 'failed' ? 'failed' : 'blocked', discoveryStatus: 'passed', discovery, session, attachmentId: attachment.id, onlineOnlyFixtures: true, automaticSkillUse: 'not-proven; this demo explicitly invokes the reusable Skill', dsh: 'deferred by user; not a dependency' };
});
await phase('realProjects', async () => {
  const projects = [];
  for (const [name, input] of [['ALS', args['als-path']], ['Pollen', args['pollen-path']]]) {
    if (!input) { projects.push({ name, status: 'blocked', reason: 'Explicit source path required' }); continue; }
    const source = path.resolve(input); const before = await fingerprint(source); const record = await s.registry.add(source, { rules: true }); const identity = await s.identities.resolve(record.id);
    const analysis = await s.onboarding.analyze(identity.stableProjectId); const plan = await s.onboarding.plan(identity.stableProjectId); const brief = await s.context.brief(identity.stableProjectId, name === 'ALS' ? 'training workflow persistence and task status' : 'role change and Windows Forms UI state', 6000);
    assert(analysis.contract.entries.some(item => item.id === 'hardware' && item.status === 'forbidden'));
    const frameworks = analysis.profile.profile.stack.components.flatMap(item => item.frameworks);
    if (name === 'ALS') { assert(frameworks.includes('Electron')); assert(frameworks.includes('React')); }
    if (name === 'Pollen') assert(frameworks.includes('Windows Forms'));
    const after = await fingerprint(source); assert(before.complete && after.complete); assert.deepEqual(after, before);
    projects.push({ name, status: 'passed', projectId: identity.stableProjectId, sourceRevision: before.head, frameworks, profileGeneration: analysis.profile.profile.generation, planId: plan.id, proposedFiles: plan.changes.map(change => change.path), refusedCandidates: plan.blocked, applied: false, modelCalls: 0, contextHash: digest(brief.text), before, after, integrityCoverage: before.coverage, fullRecursiveDataHashClaimed: false });
  }
  return { status: projects.every(item => item.status === 'passed') ? 'passed' : projects.some(item => item.status === 'failed') ? 'failed' : 'blocked', projects, sourceWrites: 0, businessCommandsExecuted: 0, sourceSharedWithModels: false };
});
await phase('security', async () => {
  const plan = await s.onboarding.plan(fresh.id); await assert.rejects(() => s.onboarding.apply(plan.id, 'grant-00000000000000000000000000000000', 'project'));
  await assert.rejects(() => s.memory.set({ domain: 'developer', type: 'engineering-preference', topic: 'Refused', content: 'api_key=synthetic-secret-value' }));
  await assert.rejects(() => s.code.read(fresh.id, '../outside', 1, 2));
  const backup = await s.portability.create('synthetic-security-passphrase'); await assert.rejects(() => s.portability.inspect(backup.file, 'incorrect-synthetic-passphrase'));
  assert.deepEqual(await fingerprint(fresh.source), original);
  return { status: 'passed', checks: ['unapproved write refused', 'sensitive memory refused', 'path traversal refused', 'incorrect backup password refused', 'original fixture unchanged'], broaderRegression: 'Run unit/integration suites for tampering, symlink, expired grants, cross-project access and Docker containment' };
});
const summary = { runId, schemaVersion: 3, finishedAt: new Date().toISOString(), durationMs: Date.now() - started, stateRoot: s.store.root, fixtureRoot: parent, results,
  offlineFunctionalMvpPassed: ['onboarding', 'existingNorms', 'capabilityEvolution', 'memory', 'portability', 'security'].every(name => results[name].status === 'passed'),
  codexOnlineMvpPassed: results.codexNative.status === 'passed', realProjectsPassed: results.realProjects.status === 'passed' };
await s.store.put(`reports/${runId}.json`, summary); await s.store.put('reports/personal-engineering-latest.json', summary);
await s.store.put('reports/personal-engineering-latest.md', `# V0.3 verification\n\n${Object.entries(results).map(([name, result]) => `- ${name}: ${result.status}`).join('\n')}\n\nOffline functional MVP: ${summary.offlineFunctionalMvpPassed}\nCodex online acceptance: ${summary.codexOnlineMvpPassed}\n\nDetailed evidence: ${runId}.json\n`);
process.stdout.write(JSON.stringify({ report: s.store.resolve('reports/personal-engineering-latest.json'), offlineFunctionalMvpPassed: summary.offlineFunctionalMvpPassed, codexOnlineMvpPassed: summary.codexOnlineMvpPassed, realProjectsPassed: summary.realProjectsPassed }, null, 2) + '\n');
if (Object.values(results).some(result => result.status === 'failed')) process.exitCode = 1;
else if (args.online && !summary.codexOnlineMvpPassed) process.exitCode = 2;
