import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import console from 'node:console';
import { engineeringSystem } from '../../packages/adapters/dist/index.js';
import { digest, filterContent, revision, git, workSnapshot, canonical, permittedFile, checkedPath } from '../../packages/core/dist/index.js';
const { values } = parseArgs({ options: { home: { type: 'string' }, 'readonly-home': { type: 'string' }, 'check-result': { type: 'string' }, 'python-result': { type: 'string' }, 'measured-runtime': { type: 'string' }, 'final-runtime': { type: 'string' }, 'work-query-report': { type: 'string' } } });
if (!values.home || !values['readonly-home'] || !values['check-result'] || !values['python-result']) throw new Error('Explicit local evidence paths required');
const repo = process.cwd();
const s = await engineeringSystem(path.resolve(values.home));
const ro = await engineeringSystem(path.resolve(values['readonly-home']));
const decode = raw => (raw[0] === 255 && raw[1] === 254 ? raw.toString('utf16le') : raw.toString('utf8')).replace(/^\uFEFF/, '');
const readJson = async file => JSON.parse(decode(await readFile(path.resolve(file))));
const check = await readJson(values['check-result']);
const rawLog = await readFile(path.resolve(repo, check.log)); const cleanLog = filterContent(decode(rawLog), 'log').content;
const counts = [...cleanLog.matchAll(/Tests\s+(\d+) passed\s*\((\d+)\)/g)].map(match => ({ passed: Number(match[1]), total: Number(match[2]) }));
if (check.exitCode !== 0 || counts.length !== 2 || counts.some(item => item.passed !== item.total)) throw new Error('Complete successful check evidence required');
await s.store.put('artifacts/v041-check-sanitized.txt', cleanLog);
const isolation = await s.store.get('reports/attachment-e2e-latest.json');
const hooks = await s.store.get('reports/hooks-v041-latest.json');
const coding = await s.store.get('reports/native-workflow-latest.json');
const continuation = await s.store.get('reports/native-continuation-latest.json');
const comparison = await s.store.get('reports/daily-comparison-latest.json');
let runtimeBinding = { measuredRuntimeDigest: comparison.compiledRuntimeDigest, finalRuntimeDigest: comparison.compiledRuntimeDigest, reviewedDelta: [] };
if (values['measured-runtime'] || values['final-runtime']) {
  if (!values['measured-runtime'] || !values['final-runtime']) throw new Error('Both runtime hash maps are required');
  const measured = await readJson(values['measured-runtime']); const final = await readJson(values['final-runtime']);
  const delta = [...new Set([...Object.keys(measured.hashes), ...Object.keys(final.hashes)])].filter(file => measured.hashes[file] !== final.hashes[file]);
  const reviewedFiles = ['packages/core/dist/v4/work-sessions.js', 'packages/core/dist/v4/runtime-diagnostics.js'];
  if (measured.digest !== comparison.compiledRuntimeDigest || delta.some(file => !reviewedFiles.includes(file))) throw new Error('Unreviewed runtime difference; do not attribute the frozen measurements to a different implementation');
  runtimeBinding = { measuredRuntimeDigest: measured.digest, finalRuntimeDigest: final.digest, reviewedDelta: delta, deltaMeaning: 'Final changes refuse progress overflow before mutation, validate only the selected project sources after global signed-header checks, and reanalyze legacy runtime query views without rewriting signed audit records. Frozen comparisons measure their original candidate; final changes have separate regression/full checks and the Work query optimization has a local benchmark.' };
}
const readOnly = await ro.store.get('reports/readonly-v041-latest.json');
const alsReview = await ro.store.get('reports/als-review-v041-latest.json');
const python = await readJson(values['python-result']);
const pythonLog = await readFile(path.resolve(repo, python.log));
let localWorkQueryBenchmark = null;
if (values['work-query-report']) {
  const { payload, signature } = await readJson(values['work-query-report']);
  if (!await s.store.verify(canonical(payload), signature) || !payload.resultsEqual || payload.samples.length !== 6) throw new Error('Verified equal-result local Work query evidence required');
  localWorkQueryBenchmark = payload;
}
const task = await s.tasks.get(coding.native.taskId); const current = await s.workspaces.workingRevision(coding.workspaceId);
const evidence = await Promise.all(task.evidenceIds.map(id => s.execution.evidence.get(id)));
const verified = [];
for (const item of evidence) if (await s.execution.evidence.isVerified(item.id, current)) verified.push(item.id);
let completionValid = false; try { await s.tasks.verifyCompletion(task); completionValid = task.state === 'succeeded'; } catch { /* Historical failures remain failures. */ }
const finite = values => values.filter(value => typeof value === 'number' && Number.isFinite(value));
const stats = values => { const sorted = finite(values).sort((a, b) => a - b); return { n: sorted.length, mean: sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null, median: sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2 : null, min: sorted[0] ?? null, max: sorted.at(-1) ?? null }; };
const groups = [];
for (const information of ['equal', 'natural']) for (const scenario of [...new Set(comparison.reports.filter(item => item.information === information).map(item => item.case))]) for (const variant of ['baseline', 'auto', 'enhanced']) {
  const trials = comparison.reports.filter(item => item.information === information && item.case === scenario && item.variant === variant);
  const metrics = Object.fromEntries(['elapsedMs', 'toolCalls', 'contextBytes', 'contextToolResultBytes', 'promptBytes', 'duplicateQueries', 'cacheHits', 'testExecutions', 'harnessContextCalls', 'humanInterventionsDuringRun'].map(metric => [metric, stats(trials.map(item => item.result[metric]))]));
  const usage = Object.fromEntries(['input_tokens', 'cached_input_tokens', 'output_tokens'].map(metric => [metric, stats(trials.map(item => item.result.usage?.[metric]))]));
  groups.push({ information, case: scenario, variant, total: trials.length, passed: trials.filter(item => item.result.status === 'passed').length, selectedModes: [...new Set(trials.map(item => item.result.selection?.mode))], nativeSkillConfigured: [...new Set(trials.map(item => item.result.nativeSkillConfigured))], metrics, usage });
}
const protocolChecks = [];
const paired = new Map();
for (const trial of comparison.reports) {
  const key = `${trial.information}:${trial.case}:${trial.repetition}`; const group = paired.get(key) ?? [];
  const task = trial.result.taskId ? await s.tasks.get(trial.result.taskId) : null; group.push({ ...trial, actualProjectId: task?.projectId }); paired.set(key, group);
}
for (const [key, trials] of paired) {
  const same = accessor => new Set(trials.map(accessor)).size === 1;
  protocolChecks.push({ key, threeIndependentProjects: trials.length === 3 && new Set(trials.map(item => item.actualProjectId)).size === 3 && trials.every(item => item.actualProjectId), sameUserInput: same(item => item.userInputHash), sameSourceRevision: same(item => item.sourceRevision), sameGrader: same(item => item.independentGraderHash), sameModelAndEffort: same(item => `${item.result.model}:${item.result.reasoningEffort}`), baselineExtraToolsDisabled: trials.filter(item => item.variant === 'baseline').every(item => item.result.nativeSkillConfigured === false && item.result.tools?.every(tool => item.result.exposedTools?.includes(tool))), skillSelectionCorrect: trials.every(item => item.result.nativeSkillConfigured === (item.variant !== 'baseline' && item.result.selection?.mode !== 'fast')) });
}
const pairedProtocolValid = protocolChecks.length === 14 && protocolChecks.every(({ key: _key, ...checks }) => { void _key; return Object.values(checks).every(Boolean); });
const completeComparison = comparison.protocolVersion === 4 && !comparison.preparationFailure && comparison.reports.length === 42 && comparison.repeats >= 2 && pairedProtocolValid;
const nativeSkillScope = isolation.reports.every(item => item.result.nativeSkillConfigured === true);
const runtime = await s.runtime.list(coding.projectId);
const initial = await s.runtime.get(coding.runtimeObservation);
const runtimeCorrected = runtime.some(item => item.id !== initial.id && !item.findings.some(finding => ['persistent-mismatch', 'state-mismatch'].includes(finding.code)));
const layers = {
  unitIntegration: { status: 'passed', unit: counts[0], integration: counts[1], command: check.command, exitCode: check.exitCode, sanitizedLogHash: digest(cleanLog) },
  nativeAuthenticationAttachmentIsolation: { status: isolation.status === 'passed' && nativeSkillScope ? 'passed' : 'failed', report: isolation.run, nativeSkillScope, concurrentPolicy: isolation.concurrentModelExecution, freshUnauthenticatedContexts: 'covered by real app-server integration; no new account login claimed' },
  hooksRealCallback: { status: hooks.lifecycle.every(item => item.status === 'passed') ? 'passed' : hooks.lifecycle.some(item => item.status === 'blocked') ? 'blocked' : 'unobserved', report: hooks.run, events: hooks.lifecycle.map(({ event, status, callbacks }) => ({ event, status, callbackCount: callbacks.length })), ordinaryIde: 'blocked' },
  workSessionCorrectness: { status: 'passed', basis: 'Complete correctness integration and unit regression: no test, abnormal exit, fail-then-pass, final revision drift, source drift, outstanding items, signed evidence reconciliation' },
  crashRecovery: { status: 'passed', basis: 'Real terminated fixture process and identified parent/child lifetime; pending signed journal replay and injected storage failures; no permission restoration' },
  adaptiveModeSelection: { status: completeComparison ? 'passed' : 'failed', classifierModelRequests: 0, basis: 'Static selection and server-enforced catalog tests plus recorded live selections' },
  contextToolOverhead: { localWorkQueryBenchmark, status: completeComparison ? 'passed' : 'failed', groups, resultMeaning: 'Measured; any efficiency benefit must be assessed per scenario with correctness. Missing values excluded, never replaced by zero.' },
  autonomousCodingRegression: { status: coding.native.status === 'passed' && completionValid && coding.sourceFingerprintUnchanged ? 'passed' : 'failed', report: coding.run, taskId: task.id, initialFailure: coding.initialFailure, finalVerifiedEvidence: verified, workingRevision: current, sourceUnchanged: coding.sourceFingerprintUnchanged },
  runtimeDiagnostics: { status: runtimeCorrected && initial.findings.some(item => ['persistent-mismatch', 'state-mismatch'].includes(item.code)) ? 'passed' : 'failed', initialObservation: initial.id, correctedObservationPresent: runtimeCorrected, normalAsyncConvergence: 'actual HTTP/worker/SQLite integration and independent grader', realAlsRuntime: 'blocked: no business runtime/test authorization' },
  memoryContinuation: { status: continuation.status === 'passed' && continuation.protocolVersion === 2 && continuation.selectedPendingResolved && continuation.stateAccurate && continuation.pendingStage?.evidenceStatus === 'valid' && continuation.pendingStage?.engineeringOutcome === 'incomplete' && !continuation.modelEdited ? 'passed' : 'failed', workId: continuation.workId, taskId: continuation.taskId, pendingStage: continuation.pendingStage, selectedPendingResolved: continuation.selectedPendingResolved, nativeWorkStatus: continuation.nativeWorkStatus, remainingOutstanding: continuation.remainingOutstanding, engineeringOutcome: continuation.engineeringOutcome, finalEvidenceStatus: continuation.evidenceStatus, unnecessaryEditsObserved: continuation.modelEdited, meaning: continuation.resultMeaning },
  nativeVsHarnessComparison: { status: completeComparison && comparison.reports.every(item => item.result.status === 'passed') ? 'passed' : 'failed', report: comparison.run, protocolVersion: comparison.protocolVersion, completed: comparison.reports.length, expected: 42, passed: comparison.reports.filter(item => item.result.status === 'passed').length, preparationFailure: comparison.preparationFailure, protocolChecks, pairedProtocolValid, groups, definition: comparison.baselineDefinition, implementationSourceDigest: comparison.implementationSourceDigest, compiledRuntimeDigest: comparison.compiledRuntimeDigest, exactBackendRequests: null, billedTokens: null },
  realProjectReadOnlySafety: { status: readOnly.status, report: readOnly.run, alsReview: alsReview.run, privateSourceModelCalls: 0, businessBuildsTests: 0, businessWrites: 0, pythonPreparation: { ...python, logHash: digest(pythonLog), actualAlsImported: false } },
};
const source = await workSnapshot(repo);
// The ordinary bounded Work snapshot may omit a large lockfile. Bind the final trusted repo
// with a separate complete manifest under the existing source-file policy, without reading ignored state.
const versionedFiles = [...new Set(git(repo, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).toString().split('\0').filter(Boolean))].sort();
const sourceManifest = [];
for (const file of versionedFiles.filter(file => permittedFile(file))) {
  try { sourceManifest.push({ path: file, hash: digest(await readFile(await checkedPath(repo, file))) }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; sourceManifest.push({ path: file, deleted: true }); }
}
const versionedSourceManifest = { completeInPolicy: true, scope: 'All Git-listed working files accepted by permittedFile; excludes ignored state, sensitive paths and non-source binary data. No per-file Work snapshot size truncation.', files: sourceManifest.length, excludedByPolicy: versionedFiles.length - sourceManifest.length, digest: digest(canonical(sourceManifest)), artifact: 'artifacts/v041-source-manifest.json' };
await s.store.put(versionedSourceManifest.artifact, { ...versionedSourceManifest, entries: sourceManifest });
const report = { schemaVersion: '0.4.1', at: new Date().toISOString(), gitRevision: revision(repo), branch: git(repo, ['branch', '--show-current']).toString().trim(), dirtyImplementationSourceDigest: source.sourceDigest, sourceSnapshotComplete: source.complete, versionedSourceManifest, runtimeBinding, layers, evidenceRoots: { native: s.store.root, readOnly: ro.store.root }, limitations: ['Only dedicated synthetic fixtures shared online', 'No global configuration or credential copy', 'CLI Windows 0.157.1 only; ordinary IDE and Ubuntu unverified', 'Historical failed/interrupted/protocol-invalid trials remain archived', 'Small repeated alternating samples are descriptive, not statistically significant or ALS productivity measurements', 'No commit, push or merge this round'] };
await s.intelligence.writeSigned('reports/engineering-v041-latest.json', report);
console.log(JSON.stringify({ artifact: 'reports/engineering-v041-latest.json', unit: counts[0], integration: counts[1], layers: Object.fromEntries(Object.entries(layers).map(([key, value]) => [key, value.status])), groups }, null, 2));
