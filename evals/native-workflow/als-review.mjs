import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import path from 'node:path';
import console from 'node:console';
import assert from 'node:assert/strict';
import { engineeringSystem } from '../../packages/adapters/dist/index.js';
import { fingerprint, git, digest, revision } from '../../packages/core/dist/index.js';
const repo = fileURLToPath(new URL('../../', import.meta.url));
const { values } = parseArgs({ options: { home: { type: 'string' }, 'als-path': { type: 'string' } } });
if (!values.home || !values['als-path']) throw new Error('Explicit local-only authorized ALS path required');
const s = await engineeringSystem(path.resolve(values.home)); const source = path.resolve(values['als-path']); const before = await fingerprint(source);
const record = await s.registry.add(source, { rules: true }); const identity = await s.identities.resolve(record.id); const workspace = await s.workspaces.create(identity.stableProjectId);
const root = await s.workspaces.root(workspace.id); const patch = path.join(repo, 'docs/proposals/als-workflow-observability.patch');
let patchStatus = 'passed'; try { git(root, ['apply', '--check', patch]); } catch { patchStatus = 'conflict-review-required'; }
const findings = [];
for (const [file, patterns] of [
  ['src/auto_label_studio/application/workflow_engine.py', ['class WorkflowEngine', 'heartbeat', 'except Exception']],
  ['src/auto_label_studio/application/product_worker.py', ['class ProductWorker', 'WorkflowEngine', 'run_once']],
  ['src/auto_label_studio/infrastructure/product_store.py', ['heartbeat', 'claim', 'recover']],
]) {
  const text = await readFile(path.join(root, file), 'utf8'); findings.push({ path: file, hash: digest(text), anchors: patterns.map(anchor => ({ anchor, present: text.includes(anchor) })) });
}
const after = await fingerprint(source); assert.deepEqual(after, before);
const report = { run: `als-review-v041-${Date.now()}`, harnessRevision: revision(repo), sourceRevision: before.head, baselineChanged: before.head !== 'c2b759cdb20e0bffb5b72ce74d9cf2940fdb19ab', workspaceId: workspace.id, patchStatus, patchHash: digest(await readFile(patch)), patchApplied: false, businessTestsExecuted: 0, businessBuildsExecuted: 0, originalSourceWrites: 0, originalGitWrites: 0, sourceSharedWithModels: false, findings, before, after, pythonEnvironment: 'Separate Harness-only synthetic smoke, not ALS business verification' };
await s.store.put(`reports/${report.run}.json`, report); await s.store.put('reports/als-review-v041-latest.json', report); console.log(JSON.stringify({ run: report.run, sourceRevision: report.sourceRevision, baselineChanged: report.baselineChanged, patchStatus, sourceUnchanged: true }));
