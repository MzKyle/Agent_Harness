import { HarnessError } from '../v2/contracts.js';
export const engineeringModes = ['auto', 'fast', 'engineering', 'deep'] as const;
export type EngineeringMode = typeof engineeringModes[number];
export function selectEngineeringMode(requested: string = 'auto', goal = '', scope: { componentCount?: number; continuation?: boolean } = {}) {
  if (!engineeringModes.includes(requested as EngineeringMode)) throw new HarnessError('ENGINEERING_MODE_DENIED');
  const deep = /diagnos|concurren|deadlock|race condition|日志|诊断|并发|时序/iu.test(goal)
    || /runtime|worker|sqlite|database|数据库/iu.test(goal) && /failure|failed|exception|timeout|race|error|state|persist|故障|异常|超时|状态/iu.test(goal);
  const engineering = Boolean(scope.continuation) || /multi[- ](?:module|file)|api.*(?:change|compatib)|continu(?:e|ation)|history|previous|跨|多文件|业务规则|继续|历史|重构|special constraint/iu.test(goal)
    || (scope.componentCount ?? 0) > 1 && /synchron|compatib|同步|兼容/iu.test(goal);
  const mode = requested !== 'auto' ? requested as Exclude<EngineeringMode, 'auto'> : deep ? 'deep' : engineering ? 'engineering' : 'fast';
  return { requested, mode, reason: requested !== 'auto' ? 'Explicit operator selection; no permissions changed' : deep ? 'Static task features indicate runtime or asynchronous diagnosis' : engineering ? 'Static task features, registered component scope or selected continuation require engineering context' : 'No explicit need for extensive project history or runtime diagnostics', staticScope: { declaredComponents: scope.componentCount ?? null, selectedContinuation: Boolean(scope.continuation), runtimeAuthorityInferred: false }, contextBudget: mode === 'fast' ? 1800 : mode === 'engineering' ? 3600 : 6000, classifierModelRequests: 0, permissionAuthority: 'none' as const };
}
export function modeTools(mode: Exclude<EngineeringMode, 'auto'>, coding: boolean, preferences = false, baseline = false) {
  const basic = ['search_code', 'read_code_slice', 'get_task_failures', ...(coding ? ['submit_plan', 'write_workspace_code', 'run_approved_command', 'get_workspace_diff', 'summarize_test_results'] : [])];
  if (baseline) return basic;
  const context = ['get_context_brief'];
  const engineering = ['get_project_profile', 'get_recent_work', 'find_symbol', 'get_module_dependencies', 'get_project_rules', 'search_project_memory', 'get_work_sessions', 'get_work_status', 'record_work_progress', ...(preferences ? ['get_relevant_preferences'] : [])];
  const deep = ['get_project_capabilities', 'query_diagnostics', 'get_runtime_diagnostics', 'get_error_timeline', 'get_state_consistency', 'get_regression_context', ...(coding ? ['record_capability_gap', 'run_project_capability'] : [])];
  return [...basic, ...context, ...(mode !== 'fast' ? engineering : []), ...(mode === 'deep' ? deep : [])];
}
export function toolCategory(name: string) {
  return /context|profile|preferences|memory|recent|work_sessions|work_status/.test(name) ? 'context'
    : /runtime|timeline|consistency|regression|diagnostics|failures/.test(name) ? 'diagnostics'
      : /approved_command|test_results/.test(name) ? 'verification' : /workspace_code|submit_plan|workspace_diff/.test(name) ? 'coding' : /progress|gap|capability/.test(name) ? 'workflow' : 'source';
}
