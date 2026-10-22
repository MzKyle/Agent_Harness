import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest } from '@devagent/core';

const root = fileURLToPath(new URL('../../../', import.meta.url));
export interface Attachment {
  id: string; projectId: string; workspaceId: string; taskId: string; cwd: string;
  /** Configuration belongs to the attachment. Authentication is never copied here. */
  home: string; authHome?: string; authenticationContextId?: string; executable: string;
  sourceSharingAllowed: boolean; personalContext: boolean; createdAt?: string;
  skillPath?: string; skillHash?: string;
}
export const authenticationHome = (attachment: Attachment) => attachment.authHome ?? attachment.home;
export const authenticationLock = (attachment: Attachment) => `native-${digest(authenticationHome(attachment))}`;
export const contextTools = ['get_context_brief', 'get_developer_profile', 'get_relevant_preferences', 'get_project_profile', 'get_recent_work', 'get_project_capabilities', 'get_project_rules', 'search_code', 'read_code_slice', 'find_symbol', 'get_module_dependencies', 'search_project_memory', 'query_diagnostics', 'get_task_failures'];

const features = {
  shell_tool: false, unified_exec: false, code_mode: true, code_mode_host: true,
  view_image: false, image_generation: false, skill_mcp_dependency_install: false,
  browser_use: false, computer_use: false, apps: false, plugins: false, multi_agent: false, hooks: false,
};
// TOML inline tables, not JSON objects. Spawn argv is passed directly, never through a shell.
export function toml(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(toml).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}=${toml(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function runtimeConfiguration(stateRoot: string, attachment: Attachment, taskId: string, tools: string[], options: { skill?: boolean; hooks?: unknown; mode?: string; contextBudget?: number; purpose?: 'inspection' | 'execution' } = {}) {
  const args = [path.join(root, 'packages/diagnostics-mcp/dist/main.js'), '--home', stateRoot, '--project', attachment.projectId, '--task', taskId,
    ...(attachment.personalContext ? ['--personal-context'] : []), ...(options.mode ? ['--mode', options.mode] : []), ...(options.contextBudget ? ['--context-budget', String(options.contextBudget)] : [])];
  const skillPaths = [...new Set([attachment.home, authenticationHome(attachment)])].flatMap(home => ['skills/devagent-project-engineering/SKILL.md', '.agents/skills/devagent-project-engineering/SKILL.md'].map(file => path.join(home, file)));
  skillPaths.push(path.join(attachment.cwd, '.agents/skills/devagent-native-bridge/SKILL.md'), path.join(attachment.cwd, '.agents/skills/devagent-project-engineering/SKILL.md'));
  return {
    sandbox_mode: 'read-only', approval_policy: 'never', web_search: 'disabled', cli_auth_credentials_store: 'file',
    mcp_optional_startup_grace_ms: 0, history: { persistence: 'none' }, analytics: { enabled: false },
    features: { ...features, hooks: Boolean(options.hooks) }, hooks: options.hooks ?? {},
    // Replace entire maps; never inherit a previous project's MCP args or trust scope.
    mcp_servers: { devagent: { command: process.execPath, args, enabled: attachment.sourceSharingAllowed, required: true, startup_timeout_sec: 30, tool_timeout_sec: 60, enabled_tools: tools } },
    projects: { [attachment.cwd]: { trust_level: 'trusted' } },
    skills: { config: [...new Set(skillPaths)].map(file => ({ path: file, enabled: Boolean(options.skill) && file === attachment.skillPath })) },
  };
}
export function configurationArgs(configuration: ReturnType<typeof runtimeConfiguration>) {
  return Object.entries(configuration).flatMap(([key, value]) => ['-c', `${key}=${toml(value)}`]);
}
