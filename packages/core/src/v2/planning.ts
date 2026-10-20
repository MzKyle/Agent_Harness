import { CodeIntelligence } from './code.js';
import { TaskService } from './tasks.js';
import { projectRules } from './rules.js';
import { filterContent } from './content.js';
export async function staticPlan(tasks: TaskService, code: CodeIntelligence, projectId: string, requirement: string, queries = ['training', 'status']) {
  const task = await tasks.create(projectId, requirement, 'analysis');
  const architecture = await code.architecture(projectId);
  const rules = await projectRules(tasks.registry, projectId);
  const findings = await Promise.all(queries.slice(0, 4).map((query) => code.search(projectId, query, { limit: 12 })));
  const matches = findings.flatMap((result) => result.matches).filter((match) => {
    const safe = filterContent(JSON.stringify(match), 'rules'); return !safe.redactions && !safe.injectionWarnings.length;
  });
  const modules = [...new Set(matches.map((match) => match.path))].slice(0, 20);
  const plan = {
    requirement, facts: matches.slice(0, 20).map((match) => ({ source: `${match.path}:${match.line}`, finding: match.snippet })),
    assumptions: ['Static matches do not prove runtime control flow', 'Dynamic dispatch and dependency injection require further verification'],
    affectedModules: modules.length ? modules : ['.'],
    steps: [{ change: 'Confirm frontend/API/application/worker/persistence boundaries from the cited modules', verification: 'Read symbol declarations and static imports; explicitly list unresolved edges' },
      { change: 'Implement the scoped change only in a filtered committed workspace after plan review', verification: 'Run human-approved commands under verified isolation and collect final-revision evidence' }],
    acceptance: ['Source repositories remain unchanged', 'Independent acceptance checks pass at the final workspace revision', 'State transitions and failure handling are observable'],
    observability: { states: ['queued', 'running', 'succeeded', 'failed', 'cancelled'], logs: ['Reuse existing task lifecycle events; add only missing transition/error evidence'],
      correlationIds: ['task_id', 'operation_id', 'trace_id'], errorCodes: ['Use stable existing error codes where available'], recovery: 'Describe retry/cancel/restart behavior at each confirmed boundary',
      testEntry: 'Use project-declared tests only after human approval and isolated execution', regressionRisks: ['State mapping', 'Polling and stale cache', 'Persistence transitions'],
      diagnosticTools: ['search_code', 'read_code_slice', 'get_module_dependencies', 'query_diagnostics', 'get_task_failures'], sensitiveData: 'No credentials, raw business records or unapproved logs', overhead: 'Aggregate transition events; no per-item logging in hot loops' },
  };
  if (!plan.facts.length) plan.facts.push({ source: 'external-registry', finding: 'No relevant source match within bounded query limits; analysis remains incomplete' });
  await tasks.submitPlan(task.id, plan);
  await tasks.gap(task.id, { gap: 'Unconfirmed runtime call relationships', why: 'Static evidence cannot prove the complete execution chain', existingAlternative: 'Read relevant declarations/imports and run approved integration checks in a workspace', crossProject: true, needsAdapter: true, suggestion: 'Add a project-specific trace adapter only when existing tools are insufficient', risks: ['Source data may be sensitive', 'Do not run production workflows'], requiresApproval: true });
  const record = await tasks.get(task.id); record.state = 'succeeded'; record.finishedAt = new Date().toISOString(); await tasks.save(record);
  const result = { taskId: task.id, origin: 'deterministic-static-planning-assistance', modelCalls: 0, architecture, rules: { sourceRevision: rules.sourceRevision, sources: rules.rules.map((rule) => rule.path), conflicts: rules.conflicts }, plan, unresolved: plan.assumptions };
  await tasks.store.put(`reports/${task.id}.static-plan.json`, result); await tasks.report(task.id); return result;
}
