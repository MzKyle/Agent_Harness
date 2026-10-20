import { StateStore, ExternalRegistry, CodeIntelligence, WorkspaceManager, ExecutionEngine, Diagnostics, TaskService } from '@devagent/core';
import { IntelligenceData, ProjectIdentities, EngineeringMemory, ProjectProfiles, ProjectCapabilities, TaskHistory, ContextBootstrap, CapabilityEvolution, ProjectOnboarding, PortableState } from '@devagent/core';
import { EngineeringDetector } from './index.js';
export async function engineeringSystem(home: string) {
  const store = await StateStore.open(home);
  const registry = new ExternalRegistry(store, new EngineeringDetector());
  const code = new CodeIntelligence(registry); const workspaces = new WorkspaceManager(store, registry);
  const execution = new ExecutionEngine(store, workspaces);
  const diagnostics = new Diagnostics(store, execution.evidence, code);
  const tasks = new TaskService(store, registry, workspaces, execution, code);
  const intelligence = new IntelligenceData(store); await intelligence.initialize();
  const identities = new ProjectIdentities(intelligence, registry);
  registry.resolveLocalId = id => identities.localId(id);
  diagnostics.resolveProjectId = async id => (await identities.resolve(id)).stableProjectId;
  const memory = new EngineeringMemory(intelligence, identities);
  const profiles = new ProjectProfiles(intelligence, identities, registry, code);
  const capabilities = new ProjectCapabilities(intelligence, identities, registry, code, diagnostics, execution.evidence, workspaces);
  const history = new TaskHistory(intelligence, identities, workspaces, execution.evidence);
  const context = new ContextBootstrap(profiles, memory, history, capabilities);
  const evolution = new CapabilityEvolution(intelligence, identities, tasks, workspaces, execution.evidence);
  const onboarding = new ProjectOnboarding(intelligence, identities, registry, profiles, capabilities, workspaces, tasks);
  const portability = new PortableState(intelligence);
  registry.onRegistered = async record => {
    const identity = await identities.ensure(record);
    if (!(await intelligence.read()).profiles[identity.stableProjectId]) { await profiles.refresh(identity.stableProjectId); await capabilities.assess(identity.stableProjectId); }
  };
  tasks.onReported = task => history.record(task).then(() => undefined);
  tasks.onGap = (task, gapId, input) => evolution.capture(task, gapId, input).then(() => undefined);
  return { store, registry, code, workspaces, execution, diagnostics, tasks, intelligence, identities, memory, profiles, capabilities, history, context, evolution, onboarding, portability };
}
export type EngineeringSystem = Awaited<ReturnType<typeof engineeringSystem>>;
