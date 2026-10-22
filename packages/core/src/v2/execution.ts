import { open, unlink, readFile } from 'node:fs/promises';
import path from 'node:path';
import { checkedPath } from '../safety.js';
import { StateStore, digest, newId } from './store.js';
import { WorkspaceManager } from './workspace.js';
import { approvedCommandSchema, evidenceSchema, type ApprovedCommand, type Evidence, HarnessError } from './contracts.js';
import { docker, isolationCheck, containerArgs, attachContainer, removeOwnedContainer } from './isolation.js';
import { filterContent, portableFile } from './content.js';
import { EvidenceStore } from './evidence.js';

function validateArgv(command: Pick<ApprovedCommand, 'executable' | 'args'>) {
  if (command.args.some((arg) => !arg || arg.length > 240 || /[\r\n\0;&|`<>$]/.test(arg) || arg.includes('..') || arg.startsWith('--require') || arg.startsWith('--import'))) throw new HarnessError('COMMAND_ARGUMENT_DENIED');
  const first = command.args[0];
  const allowed = command.executable === 'node' ? first === '--test'
    : ['python', 'python3'].includes(command.executable) ? first === '-m' && command.args[1] === 'unittest'
    : ['npm', 'pnpm'].includes(command.executable) ? first === 'run' && ['test', 'build', 'typecheck', 'lint'].includes(command.args[1] ?? '')
    : command.executable === 'dotnet' && ['test', 'build'].includes(first ?? '');
  if (!allowed) throw new HarnessError('COMMAND_FORM_DENIED');
}
function safeOutput(value: string) { try { return filterContent(value, 'log').content; } catch { return '[UNSAFE OUTPUT REFUSED]'; } }
export class ExecutionEngine {
  readonly evidence: EvidenceStore;
  constructor(readonly store: StateStore, readonly workspaces: WorkspaceManager) { this.evidence = new EvidenceStore(store); }
  private async definition(workspaceId: string, command: Pick<ApprovedCommand, 'executable' | 'args' | 'cwd'>) {
    const root = await this.workspaces.root(workspaceId);
    const manifests: Record<string, string> = {};
    for (const file of ['package.json', 'pyproject.toml', 'Directory.Build.props', 'Directory.Build.targets']) {
      try { manifests[file] = digest(await readFile(await checkedPath(root, path.posix.join(command.cwd, file)))); } catch { /* Optional declaration. */ }
    }
    return digest(JSON.stringify({ ...command, manifests }));
  }
  async approve(workspaceId: string, input: { id: string; executable: ApprovedCommand['executable']; args: string[]; cwd?: string; timeoutMs?: number }) {
    await this.workspaces.get(workspaceId);
    const cwd = input.cwd ?? '.'; if (cwd !== '.') portableFile(cwd);
    await checkedPath(await this.workspaces.root(workspaceId), cwd);
    validateArgv(input);
    const base = { executable: input.executable, args: input.args, cwd };
    const command = approvedCommandSchema.parse({ ...input, ...base, workspaceId, timeoutMs: input.timeoutMs ?? 30000,
      definitionHash: await this.definition(workspaceId, base), approvedBy: 'human-cli', approvedAt: new Date().toISOString() });
    await this.store.put(`approvals/${workspaceId}-${input.id}.json`, command); return command;
  }
  async approved(workspaceId: string, id: string) {
    if (!/^[a-zA-Z0-9_.-]{1,80}$/.test(id)) throw new HarnessError('COMMAND_ID_DENIED');
    const command = approvedCommandSchema.parse(await this.store.get(`approvals/${workspaceId}-${id}.json`));
    if (command.workspaceId !== workspaceId) throw new HarnessError('COMMAND_WORKSPACE_MISMATCH');
    validateArgv(command);
    const { executable, args, cwd } = command;
    if (command.definitionHash !== await this.definition(workspaceId, { executable, args, cwd })) throw new HarnessError('COMMAND_APPROVAL_STALE');
    return command;
  }
  async run(workspaceId: string, commandId: string, taskId: string, signal?: AbortSignal): Promise<Evidence> {
    if (!/^task-[a-f0-9]{32}$/.test(taskId)) throw new HarnessError('TASK_ID_DENIED');
    const workspace = await this.workspaces.get(workspaceId); const before = await this.workspaces.workingRevision(workspaceId);
    const id = newId('execution'); const startedAt = new Date().toISOString(); const capability = await isolationCheck(this.store);
    let command: ApprovedCommand | undefined; let reason: string | null = null; let exitCode: number | null = null;
    let status: Evidence['status']; let stdout = ''; let stderr = ''; let truncated = false; let locked = false;
    const name = `devagent-${id.slice(10)}`; let created = false;
    const lock = this.store.resolve('locks/execution.lock');
    try {
      if (await this.evidence.activeCount() >= 1000) throw new HarnessError('EVIDENCE_RETENTION_LIMIT', 'Review and archive terminal-task evidence before running more commands; source analysis remains available');
      command = await this.approved(workspaceId, commandId);
      if (signal?.aborted) throw new HarnessError('EXECUTION_CANCELLED');
      if (!capability.verified || capability.level !== 'full' || !capability.image) throw new HarnessError('blocked_by_isolation', capability.remedy);
      const handle = await open(lock, 'wx'); await handle.close(); locked = true;
      const root = await this.workspaces.root(workspaceId); await checkedPath(root, '.git/config');
      await this.workspaces.update(workspaceId, 'running');
      const working = command.cwd === '.' ? '/workspace' : `/workspace/${command.cwd}`;
      let grader: { source: string; target: string } | undefined;
      try { grader = { source: await checkedPath(this.store.root, `graders/${workspaceId}`), target: '/grader' }; } catch { /* Optional independent acceptance tests. */ }
      const args = containerArgs(name, capability.image, root, [command.executable, ...command.args], grader);
      const position = args.indexOf('--workdir=/workspace'); args[position] = `--workdir=${working}`;
      docker(args); created = true;
      const result = await attachContainer(name, { ...(signal ? { signal } : {}), timeoutMs: command.timeoutMs, maxBytes: 65536 });
      stdout = safeOutput(result.stdout); stderr = safeOutput(result.stderr); truncated = result.truncated;
      exitCode = Number(docker(['inspect', '--format', '{{.State.ExitCode}}', name]));
      status = result.cancelled ? 'cancelled' : result.timedOut ? 'timeout' : exitCode === 0 ? 'passed' : 'failed';
    } catch (error) {
      reason = error instanceof HarnessError ? error.code : (error as NodeJS.ErrnoException).code === 'EEXIST' ? 'CONCURRENCY_LIMIT' : 'COMMAND_NOT_APPROVED_OR_EXECUTION_FAILED';
      status = signal?.aborted ? 'cancelled' : 'blocked';
    } finally {
      if (created) removeOwnedContainer(name);
      if (locked) await unlink(lock);
    }
    const after = await this.workspaces.workingRevision(workspaceId);
    if (status === 'passed' && before !== after) { status = 'stale'; reason = 'COMMAND_CHANGED_SOURCE'; }
    const stdoutArtifact = `artifacts/${id}/stdout.txt`; const stderrArtifact = `artifacts/${id}/stderr.txt`;
    await this.store.put(stdoutArtifact, stdout); await this.store.put(stderrArtifact, stderr);
    const payload = { schemaVersion: 2 as const, id, taskId, workspaceId, projectId: workspace.projectId,
      sourceRevision: workspace.sourceRevision, workspaceRevision: before, resultingRevision: after, commandId,
      command: { executable: command?.executable ?? 'unapproved', args: command?.args ?? [], cwd: command?.cwd ?? '.' },
      startedAt, finishedAt: new Date().toISOString(), exitCode, status,
      isolation: capability.verified ? 'verified-isolated' as const : capability.level === 'partial' ? 'partial' as const : 'unavailable' as const,
      reason, image: capability.image, stdoutArtifact, stderrArtifact, stdoutHash: digest(stdout), stderrHash: digest(stderr), truncated };
    const evidence = evidenceSchema.parse({ ...payload, signature: await this.store.sign(payload) });
    await this.store.put(`evidence/${id}.json`, evidence);
    await this.workspaces.update(workspaceId, status === 'passed' ? 'succeeded' : status === 'blocked' ? 'blocked' : status === 'cancelled' ? 'cancelled' : 'failed');
    return evidence;
  }
}
