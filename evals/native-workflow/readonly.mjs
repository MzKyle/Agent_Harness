import { parseArgs } from 'node:util';
import { fileURLToPath, URL } from 'node:url';
import path from 'node:path';
import console from 'node:console';
import assert from 'node:assert/strict';
import { engineeringSystem } from '../../packages/adapters/dist/index.js';
import { fingerprint, revision, digest } from '../../packages/core/dist/index.js';
const repo = fileURLToPath(new URL('../../', import.meta.url));
const { values } = parseArgs({ options: { home: { type: 'string' }, 'als-path': { type: 'string' }, 'pollen-path': { type: 'string' } } });
if (!values.home || !values['als-path'] || !values['pollen-path']) throw new Error('Explicit authorized local-only paths required');
const s = await engineeringSystem(path.resolve(values.home)); const projects = [];
for (const [name, input, expected, symbol] of [
  ['ALS', values['als-path'], 'c2b759cdb20e0bffb5b72ce74d9cf2940fdb19ab', 'WorkflowEngine'],
  ['Pollen', values['pollen-path'], 'd776a95bbffa57a129a1823f61dd2a1726362d6c', 'class'],
]) {
  const source = path.resolve(input); const before = await fingerprint(source); const record = await s.registry.add(source, { rules: true });
  const identity = await s.identities.resolve(record.id); const profile = await s.profiles.refresh(identity.stableProjectId);
  const context = await s.context.brief(identity.stableProjectId, name === 'ALS' ? 'WorkflowEngine heartbeat state persistence' : 'Windows Forms role and instrument workflow', 3600, false);
  const matches = await s.code.search(identity.stableProjectId, symbol); const analysis = await s.onboarding.analyze(identity.stableProjectId); const plan = await s.onboarding.plan(identity.stableProjectId);
  assert(analysis.contract.entries.some(entry => entry.id === 'hardware' && entry.status === 'forbidden'));
  const after = await fingerprint(source); assert(before.complete && after.complete); assert.deepEqual(after, before);
  projects.push({ name, projectId: identity.stableProjectId, status: 'passed', sourceRevision: before.head, expectedBaseline: expected, baselineChanged: before.head !== expected,
    adapterReview: before.head !== expected ? 'conflict-review-required' : 'same-source-baseline', profileGeneration: profile.profile.generation, sourceQueryPaths: matches.matches.map(item => item.path), contextHash: digest(context.text), planId: plan.id, proposedFiles: plan.changes.map(item => item.path), refusedCandidates: plan.blocked, before, after, integrityCoverage: before.coverage, fullRecursiveDataHashClaimed: false, sourceSharedWithModels: false, sourceWrites: 0, businessCommandsExecuted: 0 });
}
const run = `readonly-v041-${Date.now()}`; const report = { run, harnessRevision: revision(repo), status: projects.every(item => item.status === 'passed') ? 'passed' : 'failed', projects };
await s.store.put(`reports/${run}.json`, report); await s.store.put('reports/readonly-v041-latest.json', report); console.log(JSON.stringify({ run, status: report.status, projects: projects.map(({ name, sourceRevision, baselineChanged, status }) => ({ name, sourceRevision, baselineChanged, status })) }));
