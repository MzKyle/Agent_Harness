import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import console from 'node:console';
import { engineeringSystem } from '../../packages/adapters/dist/index.js';
import { digest, filterContent } from '../../packages/core/dist/index.js';
const { values } = parseArgs({ options: { home: { type: 'string' }, 'compatibility-report': { type: 'string' } } });
if (!values.home || !values['compatibility-report']) throw new Error('Explicit result paths required');
const s = await engineeringSystem(path.resolve(values.home));
const parse = text => JSON.parse(text.replace(/^\uFEFF/, ''));
const check = parse(await s.store.text('artifacts/v04-check-result.json'));
const raw = await readFile(s.store.resolve('artifacts/v04-check.txt'));
const log = raw[0] === 255 && raw[1] === 254 ? raw.toString('utf16le') : raw.toString('utf8');
const clean = filterContent(log.replace(/^\uFEFF/, ''), 'log').content; await s.store.put('artifacts/v04-check-sanitized.txt', clean);
const counts = [...clean.matchAll(/Tests\s+(\d+) passed\s*\((\d+)\)/g)].map(match => Number(match[1]));
if (check.exitCode !== 0 || counts.length !== 2) throw new Error('A complete successful check log is required; do not manufacture test results');
const compatibility = parse(await readFile(path.resolve(values['compatibility-report']), 'utf8'));
const coding = await s.store.get('reports/native-workflow-latest.json');
const continuation = await s.store.get('reports/native-continuation-latest.json');
const profile = await s.store.get('reports/native-profile-latest.json');
const evolution = await s.store.get('reports/runtime-evolution-latest.json');
const reports = await s.store.list('reports');
const smoke = reports.find(item => item.externallyCheckedAnswer === true && item.verifiedToolUse === true);
const trials = reports.filter(item => typeof item.baselineDefinition === 'string' && Array.isArray(item.reports)).sort((a, b) => a.run.localeCompare(b.run));
const selected = new Map(); for (const trial of trials) for (const item of trial.reports) selected.set(`${item.case}:${item.result.variant}`, { ...item, report: `reports/${trial.run}.json` });
const comparisons = [...selected.values()];
const runtime = await s.runtime.list(coding.projectId); const initial = await s.runtime.get(coding.runtimeObservation);
const corrected = runtime.find(item => !item.findings.some(finding => finding.code === 'state-mismatch'));
const finalTask = await s.tasks.get(coding.native.taskId);
const evidence = await Promise.all(finalTask.evidenceIds.map(id => s.execution.evidence.get(id)));
const current = await s.workspaces.workingRevision(coding.workspaceId);
const finalChecks = await Promise.all(evidence.map(item => s.execution.evidence.isVerified(item.id, current)));
const layers = {
  unit: { status: 'passed', count: counts[0], checkHash: digest(clean) },
  mcpProtocol: { status: 'passed', integrationCount: counts[1], command: check.command, scope: 'actual stdio including Work/runtime denial tests' },
  nativeDiscovery: { status: smoke ? 'passed' : 'failed', cli: '0.157.1', skill: 'explicit invocation; automatic selection unproven' },
  onlineMcp: { status: smoke?.status ?? 'failed', taskId: smoke?.taskId, receiptCount: smoke?.receiptCount, independentAnswerOracle: smoke?.externallyCheckedAnswer },
  autonomousCoding: { status: coding.native.status === 'passed' && finalChecks.every(Boolean) ? 'passed' : 'failed', taskId: coding.native.taskId, initialFailure: coding.initialFailure, finalEvidenceIds: evidence.map(item => item.id), sourceUnchanged: coding.sourceFingerprintUnchanged },
  workMemory: { status: continuation.status, workId: continuation.workId, resumedTask: continuation.taskId, syntheticProfileOracle: profile.answerCorrect, nativeHooks: { status: 'blocked', reason: 'Configuration installed; actual callbacks unobserved' }, managedFallback: 'passed' },
  runtimeDiagnostics: { status: initial.findings.some(item => item.code === 'state-mismatch') && corrected ? 'passed' : 'failed', initialObservation: initial.id, correctedObservation: corrected?.id, injectedWorkerErrorsRemainExpected: true, liveAls: 'not-authorized-or-verified' },
  capabilityEvolution: { status: evolution.status, proposalId: evolution.proposalId, nextTaskActuallyInvoked: evolution.nextTaskActuallyInvoked, evidenceIds: evolution.evidenceIds, method: evolution.method },
  realReadOnly: compatibility.results.realProjects,
  securityRegression: { status: 'passed', basis: 'complete unit/integration check plus preserved offline security E2E', productionExecution: false, hostReadIsolation: 'not fully verified; fixture-only online' },
  comparison: { status: comparisons.length === 8 && comparisons.every(item => item.result.status === 'passed') ? 'passed' : 'failed', cases: comparisons, archivedProtocolRuns: trials.map(item => item.run), efficiencyClaim: 'none; enhanced elapsed time and reported input tokens were higher in these samples' },
};
const report = { schemaVersion: 4, at: new Date().toISOString(), layers, checks: { ...check, unitCount: counts[0], integrationCount: counts[1], sanitizedLog: 'artifacts/v04-check-sanitized.txt', hash: digest(clean) },
  offlineCompatibility: { status: compatibility.offlineFunctionalMvpPassed ? 'passed' : 'failed', report: values['compatibility-report'], nativeInFreshUnauthenticatedState: compatibility.results.codexNative.status },
  scope: 'Only Agent_Harness development branch changed; no business execution, credential copy, source sharing or push/merge', limits: ['Actual native hooks unobserved', 'Skill automatic invocation unproven', 'Runtime fixture is Node HTTP/worker/SQLite, not full ALS', 'Synthetic preference use is demonstrated; real personal data was not shared', 'No statistically significant efficiency conclusion'] };
await s.intelligence.writeSigned('reports/engineering-v04-latest.json', report);
console.log(JSON.stringify({ report: s.store.resolve('reports/engineering-v04-latest.json'), results: Object.fromEntries(Object.entries(layers).map(([name, result]) => [name, result.status])), unit: counts[0], integration: counts[1] }, null, 2));
