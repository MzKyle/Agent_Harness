import { HarnessError, selectEngineeringMode, type EngineeringMode, type WorkSessions } from '@devagent/core';
import type { CodexNativeIntegration } from './index.js';
import { inspectWorkHooks, disableWorkHooks, installWorkHooks } from './hooks.js';

export async function useCodex(native: CodexNativeIntegration, work: WorkSessions, project: string, options: { mode?: string; authFrom?: string; includePreferences?: boolean } = {}) {
  const stable = (await native.identities.resolve(project)).stableProjectId; const selection = selectEngineeringMode(options.mode);
  let created = false;
  let attachment: Awaited<ReturnType<CodexNativeIntegration['get']>>;
  try { attachment = await native.latest(stable); }
  catch (error) { if (!(error instanceof HarnessError) || error.code !== 'CODEX_ATTACH_REQUIRED') throw error; attachment = await native.attach(stable, { ...(options.authFrom ? { authFrom: options.authFrom } : {}), includePreferences: Boolean(options.includePreferences) }); created = true; }
  const record = await native.registry.get(stable);
  if (!created && (options.authFrom || options.includePreferences && !attachment.personalContext || !attachment.skillPath && record.kind === 'fixture' && record.sourceSharing === 'fixture-only')) attachment = await native.attach(stable, { workspaceId: attachment.workspaceId, authFrom: options.authFrom ?? attachment.id, includePreferences: Boolean(options.includePreferences || attachment.personalContext) });
  const payload = { projectId: stable, attachmentId: attachment.id, requestedMode: selection.requested, at: new Date().toISOString() };
  await native.store.put(`runtime/daily-bindings/${stable}.json`, { ...payload, signature: await native.store.sign(payload) });
  const inspected = await native.inspect(attachment.id); const latest = (await work.list(stable))[0];
  return { projectId: stable, attachmentId: attachment.id, selection, authentication: inspected.authentication,
    work: latest ? work.public(latest) : null, recording: 'Explicit managed runs only; ordinary IDE sessions need opt-in and supported client hooks',
    next: `codex run --project ${stable} --goal <task> --mode ${selection.requested}`, permissionsChanged: false, globalConfigurationChanged: false };
}
export async function dailyMode(native: CodexNativeIntegration, project: string): Promise<EngineeringMode> {
  const stable = (await native.identities.resolve(project)).stableProjectId;
  try {
    const { signature, ...payload } = await native.store.get<{ signature: string; projectId: string; attachmentId: string; requestedMode: string; at: string }>(`runtime/daily-bindings/${stable}.json`);
    if (!await native.store.verify(payload, signature) || payload.projectId !== stable || (await native.get(payload.attachmentId)).projectId !== stable) throw new HarnessError('DAILY_BINDING_INTEGRITY_FAILED');
    selectEngineeringMode(payload.requestedMode); return payload.requestedMode as EngineeringMode;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'auto'; throw error; }
}
export async function dailyStatus(native: CodexNativeIntegration, work: WorkSessions, project: string) {
  const attachment = await native.latest(project); const inspected = await native.inspect(attachment.id); const records = await work.list(project);
  return { attachmentId: attachment.id, requestedMode: await dailyMode(native, project), inspected, work: records[0] ? work.public(records[0]) : null, permissionsChanged: false };
}
export async function hookAction(native: CodexNativeIntegration, work: WorkSessions, attachmentId: string, action: string, workId?: string, client = 'cli') {
  if (client !== 'cli') return { status: 'blocked', reason: 'This release validates only official CLI 0.157.1. IDE lifecycle support is not established; use explicit work start/checkpoint/finalize.', client, globalConfigurationChanged: false };
  if (action === 'disable') return disableWorkHooks(native, attachmentId);
  if (action === 'enable') {
    if (!workId) throw new HarnessError('MISSING_WORK'); return installWorkHooks(native, work, attachmentId, workId, true);
  }
  if (action === 'inspect' || action === 'health') return inspectWorkHooks(native, work, attachmentId);
  throw new HarnessError('HOOK_ACTION_DENIED');
}
