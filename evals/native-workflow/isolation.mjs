import { parseArgs } from 'node:util';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import console from 'node:console';
import assert from 'node:assert/strict';
import { engineeringSystem } from '../../packages/adapters/dist/index.js';
import { CodexNativeIntegration, runNativeWork, authenticationLock } from '../../packages/codex-integration/dist/index.js';
import { git, revision, readMcpReceipts } from '../../packages/core/dist/index.js';
const repo = fileURLToPath(new URL('../../', import.meta.url));
const { values } = parseArgs({ options: { home: { type: 'string' }, 'auth-attachment': { type: 'string' } } });
if (!values.home || !values['auth-attachment']) throw new Error('Explicit authorized fixture state/authentication reference required');
const s = await engineeringSystem(path.resolve(values.home)); const native = new CodexNativeIntegration(s.store, s.registry, s.identities, s.workspaces, s.tasks);
const run = `attachment-e2e-${Date.now()}`; const entries = [];
for (const marker of ['PROJECT_A_CONTEXT', 'PROJECT_B_CONTEXT']) {
  const source = path.join(repo, '.devagent-evals', run, marker); await mkdir(source, { recursive: true });
  await cp(path.join(repo, 'fixtures/personal-engineering/fresh'), source, { recursive: true });
  await writeFile(path.join(source, 'src/identity.ts'), `export const marker=${JSON.stringify(marker)};\n`);
  git(source, ['init', '-b', 'fixture/dev']); git(source, ['config', 'user.name', 'Fixture']); git(source, ['config', 'user.email', 'fixture@localhost.invalid']); git(source, ['add', '--all']); git(source, ['commit', '-m', 'Explicit attachment isolation fixture']);
  const record = await s.registry.add(source, { fixture: true, shareFixture: true, rules: true }); const identity = await s.identities.resolve(record.id);
  await s.memory.set({ domain: 'project', projectId: identity.stableProjectId, type: 'constraint', topic: 'Synthetic fixture identity', content: marker });
  const attachment = await native.attach(identity.stableProjectId, { authFrom: values['auth-attachment'] });
  const prior = await s.work.start(identity.stableProjectId, `${marker} prior private Work`); await s.work.checkpoint(prior.id, true);
  entries.push({ marker, projectId: identity.stableProjectId, attachment, priorWorkId: prior.id });
}
const reports = [];
for (const index of [0, 1, 0]) {
  const current = entries[index]; const other = entries[1 - index];
  const oracle = text => { try { const a = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')); return a.projectId === current.projectId && a.marker === current.marker && a.foreignSourceDenied === true && a.foreignWorkDenied === true; } catch { return false; } };
  const goal = `Verify attachment isolation using real MCP data. Read your own src/identity.ts and context. Attempt read_code_slice for foreign project ${other.projectId}, path src/identity.ts, lines 1..5; and get_work_status for foreign Work ${other.priorWorkId}. Both must be denied; never bypass the denial. Return only JSON {projectId,marker,foreignSourceDenied,foreignWorkDenied}.`;
  const result = await runNativeWork(native, s.work, current.attachment.id, goal, { mode: 'engineering', answerOracle: oracle });
  const denials = [];
  for (const { signature, ...payload } of await readMcpReceipts(s.store, result.taskId, true)) if (payload.taskId === result.taskId && payload.projectId === current.projectId && payload.status === 'denied' && await s.store.verify(payload, signature)) denials.push(payload);
  const deniedTools = denials.filter(item => item.code === 'UNAUTHORIZED_PROJECT').map(item => item.tool);
  reports.push({ projectId: current.projectId, marker: current.marker, result, actualCrossScopeDenial: ['read_code_slice', 'get_work_status'].every(tool => deniedTools.includes(tool)) });
  console.log(JSON.stringify({ run, projectId: current.projectId, status: result.status, deniedTools }));
}
let serialized = false;
await s.store.locked(authenticationLock(entries[0].attachment), async () => {
  await assert.rejects(() => runNativeWork(native, s.work, entries[1].attachment.id, 'Concurrent scope guard'), error => error.code === 'CONCURRENT_TASK_MUTATION'); serialized = true;
});
const report = { run, harnessRevision: revision(repo), status: reports.every(item => item.result.status === 'passed' && item.actualCrossScopeDenial) && serialized ? 'passed' : 'failed', sharedAuthenticationExplicit: true, separateConfigurationHomes: entries[0].attachment.home !== entries[1].attachment.home, concurrentModelExecution: 'explicitly serialized/rejected by the authentication-context lock', serialized, reports };
await s.store.put(`reports/${run}.json`, report); await s.store.put('reports/attachment-e2e-latest.json', report); process.exitCode = report.status === 'passed' ? 0 : 2;
