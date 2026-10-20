import { StateStore, ExternalRegistry, CodeIntelligence, WorkspaceManager, ExecutionEngine, Diagnostics, TaskService } from '@devagent/core';
import { EngineeringDetector } from './index.js';
export async function engineeringSystem(home: string) {
  const store = await StateStore.open(home);
  const registry = new ExternalRegistry(store, new EngineeringDetector());
  const code = new CodeIntelligence(registry); const workspaces = new WorkspaceManager(store, registry);
  const execution = new ExecutionEngine(store, workspaces);
  const diagnostics = new Diagnostics(store, execution.evidence, code);
  const tasks = new TaskService(store, registry, workspaces, execution, code);
  return { store, registry, code, workspaces, execution, diagnostics, tasks };
}
export type EngineeringSystem = Awaited<ReturnType<typeof engineeringSystem>>;
