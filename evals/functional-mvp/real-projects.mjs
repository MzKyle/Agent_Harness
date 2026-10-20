import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fingerprint, projectRules, sourceFiles, filterContent, digest } from '../../packages/core/dist/index.js';

// All inputs are explicitly selected read-only sources. No source command, model,
// build, graph refresh, database, or hardware operation is invoked by this suite.
export async function validateRealProjects(system, inputs) {
  const results = [];
  for (const [name, root] of [['ALS', inputs.als], ['Pollen', inputs.pollen]]) {
    if (!root) { results.push({ name, status: 'blocked', reason: 'Explicit read-only source path required' }); continue; }
    const before = await fingerprint(root);
    const project = await system.registry.add(path.resolve(root), { rules: true });
    const rules = await projectRules(system.registry, project.id);
    const architecture = await system.code.architecture(project.id);
    const checks = name === 'ALS' ? [
      ['frontend', 'CurrentTaskCard', 'desktop/renderer/src/pages/project/components/CurrentTaskCard.tsx'],
      ['api-call', '/api/projects/', 'desktop/renderer/src/pages/ProjectPage.tsx'],
      ['route', '/api/projects/{project_id}', 'src/auto_label_studio/web/app.py'],
      ['application', 'ProductTrainingService', 'src/auto_label_studio/application/product_workflow_handlers.py'],
      ['worker', 'WorkflowEngine', 'src/auto_label_studio/application/product_worker.py'],
      ['persistence', 'list_workflows', 'src/auto_label_studio/infrastructure/product_store.py'],
    ] : [
      ['presentation', 'RoleChanged', 'Bescient.PollenInstrument.Presentation/Manager/TabPermissionManager.cs'],
      ['application', 'class PermissionService', 'Bescient.PollenInstrument.Application/Services/PermissionService.cs'],
      ['domain', 'namespace', 'Bescient.PollenInstrument.Domain'],
      ['infrastructure', 'namespace', 'Bescient.PollenInstrument.Infrastructure'],
      ['mock-hardware', 'class', 'Bescient.PollenInstrument.MockHardware'],
      ['tests', 'TabPermissionManager', 'Bescient.PollenInstrument.Tests/TabPermissionManagerTests.cs'],
    ];
    const findings = [];
    for (const [layer, query, module] of checks) {
      const result = await system.code.search(project.id, query, { module, limit: 4 });
      findings.push({ layer, ...result });
    }
    const requirement = name === 'ALS' ? '训练任务状态展示：确认 React、API、Application、Worker 与持久化状态；只制定隔离开发计划' : '权限切换 UI 诊断：检查角色变化订阅、UI 线程更新、权限恢复与退订；严禁真实硬件和 Full 模式';
    const task = await system.tasks.create(project.id, requirement, 'analysis');
    const draft = {
      requirement,
      facts: findings.flatMap(item => item.matches.map(match => ({ source: `${match.path}:${match.line}`, finding: match.snippet }))),
      assumptions: ['Static declarations/imports do not establish live control flow or dependency injection', 'Changes require a filtered workspace, human-approved checks and an appropriate isolated runner'],
      affectedModules: [...new Set(findings.flatMap(item => item.matches.map(match => match.path)))],
      steps: name === 'ALS' ? [
        { change: 'Confirm ProjectPage polling, project-stage workflow mapping and CurrentTaskCard progress against the project API response', verification: 'Read current API/types; add independent simulated queued/running/failure/cancel/recovery state cases in a future workspace' },
        { change: 'Trace ProductTrainingService handlers through ProductWorker/WorkflowEngine to ProductStore workflows and persisted progress', verification: 'List unresolved persistence/transaction edges; use approved store/API tests with mock training, never real GPU/CVAT' },
        { change: 'Propose only missing transition/error evidence and stale-state recovery', verification: 'Bind task/workflow/trace IDs and final-revision independent regression evidence' },
      ] : [
        { change: 'Inspect PermissionService role assignment, expiry/activity transitions and RoleChanged delivery', verification: 'Use fake role/clock unit cases; confirm event order from current declarations, without hardware' },
        { change: 'Trace TabPermissionManager/MainView subscriptions, UI-thread dispatch, control re-evaluation and disposal unsubscription', verification: 'Review subscribe/unsubscribe pairs; propose restricted-to-elevated-to-expired UI state cases without relaxing hardware policy' },
        { change: 'Plan independent permission display/activity and tab-access regressions', verification: 'Use existing PermissionRoleDisplayAndActivityTests/TabPermissionManagerTests; live Forms UI remains blocked until a safe Windows runner exists' },
      ],
      acceptance: ['Original source and Git state remain unchanged', 'Facts have source path/line evidence and unresolved edges are explicit', name === 'ALS' ? 'Displayed task state agrees with persisted workflow and correctly recovers after polling failure/cancellation' : 'UI access follows current role across switching/expiry/disposal, without enabling production hardware'],
      observability: {
        states: name === 'ALS' ? ['loading', 'workflow-state-from-current-contract', 'poll-failed', 'cancel-requested', 'recovered'] : ['role-unchanged', 'role-changed', 'elevation-expired', 'view-disposed'],
        logs: name === 'ALS' ? ['Reuse workflow transition and API failure events; no per-image logging'] : ['Reuse role/activity transitions; add UI re-evaluation failure only when existing evidence cannot diagnose it'],
        correlationIds: name === 'ALS' ? ['workflow_id', 'task_id', 'trace_id'] : ['operation_id', 'view_instance_id'],
        errorCodes: ['Reuse stable existing codes; propose additional codes only for uncovered failure modes'],
        recovery: name === 'ALS' ? 'Re-fetch after transient failure; prevent stale results overwriting newer workflow state; make cancellation/retry explicit' : 'Re-evaluate controls on role change/expiry; detach handlers on disposal; never auto-escalate role',
        testEntry: name === 'ALS' ? 'training-recovery.test.tsx, test_product_training.py, mock workflow/store/API integration' : 'PermissionRoleDisplayAndActivityTests.cs, TabPermissionManagerTests.cs; isolated UI runner pending',
        regressionRisks: name === 'ALS' ? ['Polling race', 'Progress denominator', 'Worker persistence timing'] : ['Cross-thread event delivery', 'Stale controls after expiry', 'Leaked subscriptions'],
        diagnosticTools: ['search_code', 'read_code_slice', 'get_module_dependencies', 'query_diagnostics', 'get_task_failures'],
        sensitiveData: 'No credentials, raw business records, device identifiers or unapproved logs', overhead: 'Aggregate state transitions and bounded failure events, no hot-loop per-item logging',
      },
    };
    await system.tasks.submitPlan(task.id, draft);
    await system.tasks.gap(task.id, { gap: name === 'ALS' ? 'Runtime workflow/persistence sequence not proven statically' : 'No safely isolated Windows Forms UI runner', why: 'Static evidence cannot validate live timing or UI dispatch', existingAlternative: 'Bounded source analysis and independent mocks in an approved isolated workspace', crossProject: true, needsAdapter: true, suggestion: 'Add the specific runner/trace adapter only when needed and separately authorized', risks: ['Do not execute production training or hardware', 'Keep real source local-only'], requiresApproval: true });
    const record = await system.tasks.get(task.id); record.state = 'succeeded'; record.finishedAt = new Date().toISOString(); await system.tasks.save(record); await system.tasks.report(record.id);
    const plan = { taskId: task.id, origin: 'deterministic-static-planning-assistance', modelCalls: 0, plan: draft };
    await system.store.put(`reports/${plan.taskId}.real-plan.json`, { ...plan, unresolved: [
      'Static declarations/imports do not prove live dependency injection, polling timing or persistence commit behavior',
      'Real training, GPU, CVAT, databases and hardware were not executed',
    ] });
    const files = await sourceFiles(root);
    let actualUi = null;
    if (name === 'Pollen') {
      const main = 'Bescient.PollenInstrument.Presentation';
      const entry = await system.code.search(project.id, 'Application.Run', { module: main, limit: 4 });
      const framework = filterContent(await readFile(path.join(root, main, `${main}.csproj`), 'utf8')).content;
      actualUi = { kind: entry.matches.length && /System.Windows.Forms/.test(framework) ? 'Windows Forms (.NET Framework 4.8)' : 'unconfirmed', entry: entry.matches,
        wpfClaim: 'Not assumed: current source uses Forms; no WPF execution is claimed',
        solution: files.files.filter(file => /\.slnx?$/.test(file)), projects: files.files.filter(file => /\.csproj$/.test(file)) };
    }
    // A real filtered source snapshot proves commit materialization, without executing it.
    let snapshot;
    try { const w = await system.workspaces.create(project.id, before.head); snapshot = { status: 'passed', workspaceId: w.id, sourceRevision: w.sourceRevision, included: w.included, excluded: w.excluded.length }; }
    catch (error) { snapshot = { status: 'blocked', reason: error.code ?? 'SNAPSHOT_FAILED' }; }
    const after = await fingerprint(root);
    const invariant = before.complete && after.complete && digest(JSON.stringify(before)) === digest(JSON.stringify(after));
    const passed = invariant && rules.rules.length > 0 && findings.every(item => item.matches.length > 0) && !architecture.truncated;
    const result = { name, status: passed ? 'passed' : 'failed', projectId: project.id, root, revision: before.head,
      sourceConsent: 'local-only', modelCalls: 0, rules: rules.rules.map(rule => ({ path: rule.path, hash: rule.hash, priority: rule.priority })),
      architecture, findings, planTaskId: plan.taskId, planArtifact: `reports/${plan.taskId}.real-plan.json`, actualUi, snapshot,
      invariant: { status: invariant ? 'passed' : 'failed', before, after, coverage: before.coverage,
        limitation: 'Content hashes cover bounded permitted source files; excluded data/cache directories have opaque metadata, not recursive byte hashing' } };
    await system.store.put(`reports/real-${name.toLowerCase()}.json`, result); results.push(result);
  }
  assert(results.every(item => ['passed', 'blocked', 'failed'].includes(item.status)));
  return { level: 5, status: results.every(item => item.status === 'passed') ? 'passed' : results.some(item => item.status === 'failed') ? 'failed' : 'blocked', results };
}
