import { parseArgs } from 'node:util';
import { readFile, lstat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { engineeringSystem } from '@devagent/adapters';
import { HarnessError, configureIsolation, isolationCheck, fingerprint, projectRules, approvedCommandSchema, staticPlan } from '@devagent/core';
import { harnessRoot, FunctionalDshDriver, IsolatedCodex } from '@devagent/dsh-bridge';
import { doctor } from './doctor.js';

export async function functionalMain(argv: string[]) {
  const { values: v, positionals: p } = parseArgs({ args: argv, allowPositionals: true, options: {
    home: { type: 'string' }, path: { type: 'string' }, id: { type: 'string' }, project: { type: 'string' }, workspace: { type: 'string' }, task: { type: 'string' },
    'read-only': { type: 'boolean' }, rules: { type: 'boolean' }, fixture: { type: 'boolean' }, 'share-fixture': { type: 'boolean' },
    query: { type: 'string' }, file: { type: 'string' }, name: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, revision: { type: 'string' },
    executable: { type: 'string' }, 'args-file': { type: 'string' }, args: { type: 'string' }, cwd: { type: 'string' }, timeout: { type: 'string' },
    prompt: { type: 'string' }, mode: { type: 'string' }, codex: { type: 'boolean' }, image: { type: 'string' }, suite: { type: 'string' },
    trace: { type: 'string' }, severity: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, 'operation-id': { type: 'string' },
    'als-path': { type: 'string' }, 'pollen-path': { type: 'string' }, online: { type: 'boolean' },
  } });
  const home = path.resolve(v.home ?? path.join(harnessRoot, '.devagent-state'));
  const system = await engineeringSystem(home); const [command, operation] = p;
  const required = (value: string | undefined, key: string) => { if (!value) throw new HarnessError(`MISSING_${key.toUpperCase()}`); return value; };
  let result: unknown;
  const project = () => required(v.project ?? v.id, 'project');
  const workspace = () => required(v.workspace ?? v.id, 'workspace');
  const task = () => required(v.task ?? v.id, 'task');
  try {
    if (command === 'doctor') { const base = await doctor(); const isolation = await isolationCheck(system.store); result = { ...base, status: isolation.verified ? base.status : 'attention', isolation }; }
    else if (command === 'project') {
      if (operation === 'add') {
        if (!v['read-only']) throw new HarnessError('READ_ONLY_GRANT_REQUIRED');
        const record = await system.registry.add(required(v.path, 'path'), { rules: Boolean(v.rules), fixture: Boolean(v.fixture), shareFixture: Boolean(v['share-fixture']) });
        const identity = await system.identities.resolve(record.id);
        result = { id: record.id, stableProjectId: identity.stableProjectId, duplicateCandidates: identity.duplicateCandidates, root: record.root, authorization: record.authorization, rulesAllowed: record.rulesAllowed, sourceSharing: record.sourceSharing, sourceWritten: false };
      } else if (operation === 'list') result = await system.registry.list();
      else if (operation === 'inspect') result = { ...await system.registry.inspect(project()), architecture: await system.code.architecture(project()) };
      else if (operation === 'remove') result = await system.registry.remove(project());
      else if (operation === 'fingerprint') result = await fingerprint((await system.registry.get(project())).root);
      else if (operation === 'rules') result = await projectRules(system.registry, project());
      else if (operation === 'plan') result = await staticPlan(system.tasks, system.code, project(), v.prompt ?? 'Training task status display');
      else throw new HarnessError('UNKNOWN_PROJECT_OPERATION');
    } else if (command === 'code') {
      if (operation === 'search') result = await system.code.search(project(), required(v.query, 'query'));
      else if (operation === 'read') result = await system.code.read(project(), required(v.file, 'file'), Number(v.start ?? 1), Number(v.end ?? 40));
      else if (operation === 'symbol') result = await system.code.symbols(project(), required(v.name, 'name'));
      else if (operation === 'dependencies') result = await system.code.dependencies(project(), required(v.file, 'file'));
      else throw new HarnessError('UNKNOWN_CODE_OPERATION');
    } else if (command === 'workspace') {
      if (operation === 'create') result = await system.workspaces.create(project(), v.revision);
      else if (operation === 'inspect') result = { ...await system.workspaces.get(workspace()), workspaceRevision: await system.workspaces.workingRevision(workspace()) };
      else if (operation === 'diff') result = await system.workspaces.diff(workspace());
      else if (operation === 'cleanup') result = await system.workspaces.cleanup(workspace());
      else throw new HarnessError('UNKNOWN_WORKSPACE_OPERATION');
    } else if (command === 'isolation') {
      if (operation === 'configure') result = await configureIsolation(system.store, required(v.image, 'image'));
      else if (operation === 'check') result = await isolationCheck(system.store);
      else throw new HarnessError('UNKNOWN_ISOLATION_OPERATION');
    } else if (command === 'codex') {
      const native = new IsolatedCodex(system.store, system.workspaces);
      if (operation === 'configure') result = await native.configure(required(v.image, 'image'));
      else if (operation === 'status') result = await native.status();
      else if (operation === 'login') result = await native.login();
      else throw new HarnessError('UNKNOWN_CODEX_OPERATION');
    } else if (command === 'command') {
      if (operation === 'approve') {
        const raw = v['args-file'] ? await readFile(required(v['args-file'], 'args-file'), 'utf8') : required(v.args, 'args-or-args-file');
        if (raw.length > 8192) throw new HarnessError('ARGUMENT_FILE_LIMIT');
        const args: unknown = JSON.parse(raw); if (!Array.isArray(args) || !args.every((value) => typeof value === 'string')) throw new HarnessError('ARGUMENT_ARRAY_REQUIRED');
        const executable = approvedCommandSchema.shape.executable.parse(v.executable);
        result = await system.execution.approve(required(v.workspace, 'workspace'), { id: required(v.id, 'id'), executable, args, cwd: v.cwd ?? '.', timeoutMs: Number(v.timeout ?? 30000) });
      } else if (operation === 'run') {
        const space = await system.workspaces.get(required(v.workspace, 'workspace'));
        const record = await system.tasks.create(space.projectId, 'Explicit human-approved command execution', 'isolated', space.id);
        const evidence = await system.execution.run(space.id, required(v.id, 'id'), record.id);
        record.evidenceIds.push(evidence.id); record.state = evidence.status === 'passed' ? 'succeeded' : evidence.status === 'blocked' ? 'blocked' : 'failed';
        record.reason = evidence.reason; record.finishedAt = new Date().toISOString(); await system.tasks.save(record); await system.tasks.report(record.id); result = evidence;
      } else throw new HarnessError('UNKNOWN_COMMAND_OPERATION');
    } else if (command === 'evidence') {
      if (operation === 'get') result = await system.execution.evidence.get(required(v.id, 'id'));
      else if (operation === 'list') result = await system.execution.evidence.list(v.task);
      else if (operation === 'export') result = await system.execution.evidence.report(task());
      else throw new HarnessError('UNKNOWN_EVIDENCE_OPERATION');
    } else if (command === 'diagnostics') {
      if (operation === 'import') {
        const file = path.resolve(required(v.file, 'file'));
        let cursor = path.parse(file).root;
        for (const part of file.slice(cursor.length).split(path.sep)) { cursor = path.join(cursor, part); if ((await lstat(cursor)).isSymbolicLink()) throw new HarnessError('DIAGNOSTIC_FILE_DENIED'); }
        if (!/\.(?:jsonl|txt|log)$/i.test(file) || (await lstat(file)).isSymbolicLink() || (await lstat(file)).size > 1024 * 1024) throw new HarnessError('DIAGNOSTIC_FILE_DENIED');
        result = await system.diagnostics.import(await readFile(file, 'utf8'), path.basename(file), { ...(v.project ? { projectId: v.project } : {}), ...(v.task ? { taskId: v.task } : {}) });
      } else if (operation === 'query') result = await system.diagnostics.query({ ...(v.id ? { diagnosticId: v.id } : {}), ...(v.trace ? { traceId: v.trace } : {}), ...(v.severity ? { severity: v.severity } : {}), ...(v.from ? { from: v.from } : {}), ...(v.to ? { to: v.to } : {}), ...(v['operation-id'] ? { operationId: v['operation-id'] } : {}) });
        else if (operation === 'runtime') result = await system.runtime.query(project(), v.id);
        else if (operation === 'capture-runtime') result = await system.runtime.capture(required(v.id, 'id'));
        else if (operation === 'validate') result = await system.validator.validate(task());
        else if (operation === 'failures') result = await system.diagnostics.failures(task());
      else if (operation === 'diagnose') result = await system.diagnostics.diagnose(project(), task());
      else throw new HarnessError('UNKNOWN_DIAGNOSTIC_OPERATION');
    } else if (command === 'task') {
      if (operation === 'run' || operation === 'smoke') {
        if (v.mode && !['analysis', 'isolated'].includes(v.mode)) throw new HarnessError('INVALID_TASK_MODE');
        const mode = operation === 'smoke' ? 'online-smoke' : v.mode === 'isolated' || v.codex ? 'isolated' : 'analysis';
        const abort = new AbortController(); process.once('SIGINT', () => abort.abort());
        const completed = await system.tasks.run(project(), required(v.prompt, 'prompt'), mode, new FunctionalDshDriver(system.store, system.registry, system.workspaces, system.tasks), { ...(v.workspace ? { workspaceId: v.workspace } : {}), codex: Boolean(v.codex), signal: abort.signal });
        result = completed; if (completed.state !== 'succeeded') process.exitCode = completed.state === 'blocked' ? 2 : 1;
      } else if (operation === 'status') result = await system.tasks.get(task());
      else if (operation === 'report') result = await system.tasks.report(task());
      else throw new HarnessError('UNKNOWN_TASK_OPERATION');
    } else if (command === 'eval') {
      if (v.suite !== 'functional-mvp') throw new HarnessError('UNKNOWN_EVAL_SUITE');
      const extra = [...(v.online ? ['--online'] : []), ...(v.image ? ['--image', v.image] : []), ...(v['als-path'] ? ['--als-path', v['als-path']] : []), ...(v['pollen-path'] ? ['--pollen-path', v['pollen-path']] : [])];
      const run = spawnSync(process.execPath, [path.join(harnessRoot, 'evals/functional-mvp/run.mjs'), '--home', home, ...extra], { stdio: 'inherit', windowsHide: true });
      process.exitCode = run.status ?? 1; return;
    } else throw new HarnessError('UNKNOWN_COMMAND');
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const code = error instanceof HarnessError ? error.code : 'OPERATION_FAILED';
    const evidence = await system.store.denial({ code, ...(command ? { command } : {}), ...(operation ? { operation } : {}) });
    throw new HarnessError(code, `Evidence: ${evidence}`);
  }
}
