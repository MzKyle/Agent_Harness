import { parseArgs } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { engineeringSystem } from '@devagent/adapters';
import { HarnessError, explicitRoot, readBounded, memoryInputSchema, type MemoryInput } from '@devagent/core';
import { CodexNativeIntegration, probeHarnessMcp } from '@devagent/codex-integration';

const root = fileURLToPath(new URL('../../../', import.meta.url));
export function intelligenceCommand(args: string[]) {
  return ['profile', 'memory', 'onboard', 'context', 'capability', 'backup'].includes(args[0] ?? '') ||
    args[0] === 'project' && ['identity', 'profile', 'refresh', 'relink'].includes(args[1] ?? '') ||
    args[0] === 'codex' && ['attach', 'inspect', 'session', 'login-native'].includes(args[1] ?? '') ||
    args[0] === 'eval' && args.includes('personal-engineering');
}
async function readJson(input: string) {
  const file = path.resolve(input); const parent = await explicitRoot(path.dirname(file));
  return JSON.parse(await readBounded(parent, path.basename(file), 65536)) as unknown;
}
export async function intelligenceMain(args: string[]) {
  const { values: v, positionals: p } = parseArgs({ args, allowPositionals: true, options: {
    home: { type: 'string' }, id: { type: 'string' }, project: { type: 'string' }, path: { type: 'string' }, query: { type: 'string' }, task: { type: 'string' },
    file: { type: 'string' }, topic: { type: 'string' }, content: { type: 'string' }, type: { type: 'string' }, domain: { type: 'string' },
    decision: { type: 'string' }, 'include-candidates': { type: 'boolean' }, 'include-deprecated': { type: 'boolean' }, human: { type: 'boolean' },
    plan: { type: 'string' }, target: { type: 'string' }, grant: { type: 'string' }, digest: { type: 'string' }, expires: { type: 'string' },
    workspace: { type: 'string' }, 'with-codex': { type: 'boolean' }, 'include-preferences': { type: 'boolean' }, 'commands-file': { type: 'string' },
    probe: { type: 'boolean' }, command: { type: 'string' }, evidence: { type: 'string' }, budget: { type: 'string' },
    'passphrase-env': { type: 'string' }, review: { type: 'string' }, suite: { type: 'string' }, image: { type: 'string' },
    'als-path': { type: 'string' }, 'pollen-path': { type: 'string' }, online: { type: 'boolean' },
  } });
  const system = await engineeringSystem(path.resolve(v.home ?? path.join(root, '.devagent-state')));
  const native = new CodexNativeIntegration(system.store, system.registry, system.identities, system.workspaces, system.tasks);
  system.onboarding.nativeConfigCandidate = id => native.config(id);
  const required = (value: string | undefined, key: string) => { if (!value) throw new HarnessError(`MISSING_${key.toUpperCase()}`); return value; };
  const project = () => required(v.project ?? v.id, 'project'); const id = () => required(v.id, 'id'); const plan = () => required(v.plan ?? v.id, 'plan');
  const target = () => { if (v.target && !['workspace', 'project'].includes(v.target)) throw new HarnessError('ONBOARDING_TARGET_DENIED'); return v.target === 'project' ? 'project' as const : 'workspace' as const; };
  const password = () => { const name = required(v['passphrase-env'], 'passphrase-env'); if (!/^DEVAGENT_[A-Z0-9_]{1,80}$/.test(name)) throw new HarnessError('BACKUP_ENVIRONMENT_NAME_DENIED'); return process.env[name] ?? ''; };
  const [command, operation] = p; let result: unknown;
  try {
    if (command === 'profile' || command === 'memory') {
      if (['set', 'propose'].includes(operation ?? '')) {
        const input = v.file ? await readJson(v.file) : { domain: command === 'profile' ? 'developer' : v.domain ?? (v.project ? 'project' : 'knowledge'), ...(v.project ? { projectId: v.project } : {}), type: v.type ?? (command === 'profile' ? 'engineering-preference' : 'knowledge'), topic: required(v.topic, 'topic'), content: required(v.content, 'content') };
        const parsed = memoryInputSchema.parse(input);
        if (command === 'profile' && parsed.domain !== 'developer') throw new HarnessError('PROFILE_SCOPE_DENIED');
        result = operation === 'set' ? await system.memory.set(parsed) : await system.memory.propose(parsed);
      } else if (operation === 'import-template' && command === 'profile') {
        const records = await readJson(required(v.file, 'file')); if (!Array.isArray(records) || records.length > 30) throw new HarnessError('PROFILE_TEMPLATE_INVALID');
        const inputs = records.map(record => memoryInputSchema.parse({ ...record, domain: 'developer' }) as MemoryInput);
        const imported = []; for (const input of inputs) imported.push(await system.memory.propose(input)); result = imported;
      } else if (operation === 'show' && v.id) {
        const record = await system.memory.get(v.id); if (command === 'profile' && record.domain !== 'developer') throw new HarnessError('PROFILE_SCOPE_DENIED'); result = record;
      } else if (operation === 'show' || operation === 'search' || operation === 'review' && !v.id) {
        result = await system.memory.search({ ...(command === 'profile' ? { domain: 'developer' as const } : {}), ...(v.project ? { projectId: v.project } : {}), ...(v.query ? { query: v.query } : {}), includeCandidates: Boolean(v['include-candidates'] || operation === 'review'), includeDeprecated: Boolean(v['include-deprecated']), limit: 50 });
      } else if (operation === 'history') result = await system.memory.history(id());
      else if (operation === 'review') {
        if (!['confirm', 'reject'].includes(v.decision ?? '')) throw new HarnessError('MEMORY_REVIEW_DECISION_REQUIRED');
        result = await system.memory.review(id(), v.decision as 'confirm' | 'reject');
      } else if (operation === 'delete') {
        if (command === 'profile' && (await system.memory.get(id())).domain !== 'developer') throw new HarnessError('PROFILE_SCOPE_DENIED'); result = await system.memory.delete(id());
      } else if (operation === 'export') {
        const owner = v.project ? (await system.identities.resolve(v.project)).stableProjectId : undefined;
        result = await system.portability.exportProfile(`artifacts/exports/${Date.now()}.profile.json`, owner);
      } else throw new HarnessError('UNKNOWN_MEMORY_OPERATION');
    } else if (command === 'project') {
      if (operation === 'identity') result = { identity: await system.identities.resolve(project()), machineBindings: await system.intelligence.bindings() };
      else if (operation === 'profile') result = await system.profiles.get(project());
      else if (operation === 'refresh') result = { ...await system.profiles.refresh(project()), capabilities: await system.capabilities.assess(project(), Boolean(v.probe)) };
      else if (operation === 'relink') result = await system.identities.relink(project(), required(v.path, 'path'));
      else throw new HarnessError('UNKNOWN_PROJECT_OPERATION');
    } else if (command === 'onboard') {
      if (operation === 'analyze') result = await system.onboarding.analyze(project());
      else if (operation === 'plan') result = await system.onboarding.plan(project(), Boolean(v['with-codex']));
      else if (operation === 'diff') result = await system.onboarding.get(plan());
      else if (operation === 'reject') result = await system.onboarding.reject(plan());
      else if (operation === 'approve') result = await system.onboarding.approve(plan(), target(), required(v.digest, 'digest'), Number(v.expires ?? 300) * 1000);
      else if (operation === 'apply') result = await system.onboarding.apply(plan(), required(v.grant, 'grant'), target());
      else if (operation === 'verify') {
        const commands: unknown = v['commands-file'] ? await readJson(v['commands-file']) : [];
        if (!Array.isArray(commands) || commands.length > 3 || commands.some(command => typeof command !== 'string' || !/^[a-zA-Z0-9_.-]{1,80}$/.test(command))) throw new HarnessError('ONBOARDING_COMMAND_IDS_INVALID');
        const selected = await system.onboarding.get(plan()); result = await system.onboarding.verify(plan(), commands, () => probeHarnessMcp(system.store, selected.projectId));
      } else if (operation === 'report') result = await system.store.get(`reports/${plan()}.onboarding.json`);
      else throw new HarnessError('UNKNOWN_ONBOARDING_OPERATION');
    } else if (command === 'context') {
      if (operation !== 'show') throw new HarnessError('UNKNOWN_CONTEXT_OPERATION');
      result = await system.context.brief(project(), v.task ?? v.query ?? '', Number(v.budget ?? 6000));
    } else if (command === 'capability') {
      if (operation === 'inspect') result = v.probe ? await system.capabilities.assess(project(), true) : await system.capabilities.get(project());
      else if (operation === 'proposals') result = await system.evolution.list(project());
      else if (operation === 'approve') result = await system.evolution.approve(id());
      else if (operation === 'implemented') result = await system.evolution.implemented(id(), required(v.workspace, 'workspace'), required(v.task, 'task'), required(v.command, 'command'));
      else if (operation === 'verify') result = await system.evolution.verify(id(), required(v.evidence, 'evidence'));
      else if (operation === 'adopt') result = await system.evolution.adopt(id());
      else if (operation === 'invoke') result = await system.evolution.invoke(id(), required(v.task, 'task'));
      else if (operation === 'deprecate') result = await system.evolution.deprecate(id());
      else throw new HarnessError('UNKNOWN_CAPABILITY_OPERATION');
    } else if (command === 'backup') {
      if (operation === 'create') result = await system.portability.create(password());
      else if (operation === 'inspect' || operation === 'restore' && !v.review) result = await system.portability.inspect(path.resolve(required(v.file, 'file')), password());
      else if (operation === 'restore') result = await system.portability.restore(path.resolve(required(v.file, 'file')), password(), required(v.review, 'review'));
      else throw new HarnessError('UNKNOWN_BACKUP_OPERATION');
    } else if (command === 'codex') {
      if (operation === 'attach') result = await native.attach(project(), { ...(v.workspace ? { workspaceId: v.workspace } : {}), includePreferences: Boolean(v['include-preferences']) });
      else if (operation === 'inspect') result = await native.inspect(id());
      else if (operation === 'session') result = await native.session(id());
      else if (operation === 'login-native') result = await native.login(id());
      else throw new HarnessError('UNKNOWN_NATIVE_CODEX_OPERATION');
    } else if (command === 'eval') {
      const child = spawnSync(process.execPath, [path.join(root, 'evals/personal-engineering/run.mjs'), ...(v.home ? ['--home', system.store.root] : []),
        ...(v.image ? ['--image', v.image] : []), ...(v.online ? ['--online'] : []), ...(v['als-path'] ? ['--als-path', v['als-path']] : []), ...(v['pollen-path'] ? ['--pollen-path', v['pollen-path']] : [])], { stdio: 'inherit', windowsHide: true }); process.exitCode = child.status ?? 1; return;
    } else throw new HarnessError('UNKNOWN_INTELLIGENCE_COMMAND');
    if (v.human && result && typeof result === 'object' && 'text' in result) process.stdout.write(`${result.text}\n`);
    else if (v.human && result && typeof result === 'object' && 'unifiedDiff' in result) process.stdout.write(`${result.unifiedDiff}\n`);
    else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const code = error instanceof HarnessError ? error.code : 'INTELLIGENCE_OPERATION_FAILED';
    const evidence = await system.store.denial({ code, ...(command ? { command } : {}), ...(operation ? { operation } : {}) });
    throw new HarnessError(code, `Evidence: ${evidence}`);
  }
}
