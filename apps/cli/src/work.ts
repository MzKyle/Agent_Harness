import path from 'node:path';
import { parseArgs } from 'node:util';
import { engineeringSystem } from '@devagent/adapters';
import { HarnessError } from '@devagent/core';
import { CodexNativeIntegration, workHookConfiguration, resolveWorkHookExecution } from '@devagent/codex-integration';

export async function workMain(args: string[]) {
  const { values: v, positionals } = parseArgs({ args, allowPositionals: true, options: {
    home: { type: 'string' }, id: { type: 'string' }, project: { type: 'string' }, goal: { type: 'string' }, workspace: { type: 'string' }, task: { type: 'string' },
    lease: { type: 'string' }, attachment: { type: 'string' }, 'accept-change': { type: 'boolean' }, decision: { type: 'string', multiple: true }, outstanding: { type: 'string', multiple: true }, resolved: { type: 'string', multiple: true },
  } });
  const s = await engineeringSystem(path.resolve(v.home ?? '.devagent-state')); const operation = positionals[1];
  const required = (value: string | undefined, name: string) => { if (!value) throw new HarnessError(`MISSING_${name.toUpperCase()}`); return value; };
  const id = async () => v.id ?? (v.project ? (await s.work.list(v.project))[0]?.id : undefined) ?? required(undefined, 'work-id-or-project');
  let result: unknown;
  if (operation === 'start') result = await s.work.start(required(v.project, 'project'), required(v.goal, 'goal'), { ...(v.workspace ? { workspaceId: v.workspace } : {}), ...(v.task ? { taskId: v.task } : {}) });
  else if (operation === 'list') result = (await s.work.list(required(v.project, 'project'))).map(work => s.work.public(work));
  else if (operation === 'status' || operation === 'latest') result = s.work.public(await s.work.get(await id()));
  else if (operation === 'recover') result = await s.work.recover(await id());
  else if (operation === 'archive') result = await s.work.archive(await id());
  else if (operation === 'checkpoint' || operation === 'finalize') result = await s.work.checkpoint(await id(), operation === 'finalize');
  else if (operation === 'resume') result = await s.work.resume(await id(), Boolean(v['accept-change']));
  else if (operation === 'progress') result = await s.work.progress(await id(), v.decision ?? [], v.outstanding ?? [], v.resolved ?? []);
  else if (operation === 'delete') result = await s.work.delete(await id());
  else if (operation === 'events') result = await s.work.events(await id());
  else if (operation === 'export') {
    const work = await s.work.get(await id()); const artifact = `artifacts/exports/${work.id}-${Date.now()}.work.json`;
    await s.store.put(artifact, { schemaVersion: 4, work: s.work.public(work), events: await s.work.events(work.id), trust: 'historical-unverified', permissions: 'none' }); result = { artifact };
  } else if (operation === 'hook') {
    // Hook failures are fail-soft observations; permission and final Evidence checks remain independent.
    try {
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of process.stdin) { const data = Buffer.from(chunk as Uint8Array); bytes += data.length; if (bytes > 1024 * 1024) throw new HarnessError('HOOK_INPUT_LIMIT'); chunks.push(data); }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      let workId: string; let lease: string; let executionSessionId: string | undefined;
      if (v.attachment) {
        const native = new CodexNativeIntegration(s.store, s.registry, s.identities, s.workspaces, s.tasks);
        const attachment = await native.get(v.attachment); if (!await workHookConfiguration(native, v.attachment)) throw new HarnessError('HOOK_DISABLED');
        const binding = await resolveWorkHookExecution(native, v.attachment, process.env.DEVAGENT_NATIVE_SESSION); const work = await s.work.get(binding.workId);
        if (work.projectId !== attachment.projectId || work.workspaceId !== attachment.workspaceId || work.taskId !== binding.taskId || work.leaseId !== binding.leaseId || work.state === 'completed' || work.finalizedAt || typeof input.cwd !== 'string' || path.resolve(input.cwd) !== attachment.cwd) throw new HarnessError('HOOK_WORK_SCOPE_DENIED');
        await workHookConfiguration(native, v.attachment, work.id); workId = work.id; lease = binding.leaseId; executionSessionId = binding.executionSessionId;
      } else { workId = await id(); lease = required(v.lease, 'lease'); }
      await s.work.event(workId, lease, { ...input, ...(executionSessionId ? { harness_execution_session_id: executionSessionId } : {}) }, 'hook');
      if (input.hook_event_name === 'SessionStart') {
        const work = await s.work.get(workId); const brief = await s.context.brief(work.projectId, work.goal, 4000, false);
        result = { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: brief.text } };
      } else result = {};
    } catch (error) {
      await s.store.denial({ code: error instanceof HarnessError ? error.code : 'HOOK_CAPTURE_FAILED', operation: 'work-hook' }).catch(() => undefined);
      result = { systemMessage: 'Harness observation unavailable; no verification or permission is inferred. Use the normal approved workflow.' };
    }
  } else throw new HarnessError('UNKNOWN_WORK_OPERATION');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

