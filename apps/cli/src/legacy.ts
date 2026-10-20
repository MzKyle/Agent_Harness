#!/usr/bin/env node
import { parseArgs } from 'node:util';
import path from 'node:path';
import { EngineeringDetector } from '@devagent/adapters';
import { canonicalRoot, getProjectContext, initializeProject, ProjectError, ProjectRegistry, publicConfig } from '@devagent/core';
import { DshRuntimeAdapter, harnessRoot, launchDsh } from '@devagent/dsh-bridge';
import { doctor } from './doctor.js';

const help = `DevAgent-Harness M0 + M1
  devagent doctor
  devagent init --path <project> [--dry-run]
  devagent inspect --path <project>
  devagent runtime prepare --path <project> [--output <new-runtime-directory>]
  devagent runtime check --path <project> --output <runtime-directory>
  devagent runtime run --path <project> --output <runtime-directory> --task <task>
All output is JSON except this help and DSH runtime output. No discovered command is executed.
Runtime run sends your task and approved metadata to the configured provider. Codex is opt-in via template.
`;
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    path: { type: 'string' }, 'dry-run': { type: 'boolean' }, output: { type: 'string' },
    task: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
  const [command, operation] = positionals;
  const print = (value: unknown) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  if (values.help || !command) process.stdout.write(help);
  else if (command === 'doctor' && positionals.length === 1) print(await doctor());
  else if (['init', 'inspect', 'runtime'].includes(command)) {
    if (!values.path || (command !== 'init' && values['dry-run'])) throw new ProjectError('INVALID_ARGUMENT');
    const root = await canonicalRoot(path.resolve(values.path));
    if (command === 'init' && positionals.length === 1) {
      const result = await initializeProject(root, new EngineeringDetector(), values['dry-run']);
      print({ ...result, config: publicConfig(result.config) });
    } else if (command === 'inspect' && positionals.length === 1) {
      const registry = await ProjectRegistry.create([root]);
      print(await getProjectContext(registry, registry.list()[0]!.projectId));
    } else if (command === 'runtime' && positionals.length === 2) {
      const output = path.resolve(values.output ?? path.join(harnessRoot, '.dsh-local', 'runtime'));
      if (operation === 'prepare') print(await new DshRuntimeAdapter().prepare({ projectRoot: root, outputDirectory: output }));
      else if (operation === 'check' || operation === 'run') {
        if (operation === 'run' && !values.task) throw new ProjectError('INVALID_ARGUMENT');
        const result = launchDsh(output, root, operation === 'check' ? ['--dump-config'] : [values.task!]);
        process.exitCode = result.status ?? 1;
      } else throw new ProjectError('INVALID_ARGUMENT');
    } else throw new ProjectError('INVALID_ARGUMENT');
  } else throw new ProjectError('INVALID_ARGUMENT');
} catch (error) {
  process.stderr.write(`${JSON.stringify({ status: 'error', code: error instanceof ProjectError ? error.code : 'COMMAND_FAILED' })}\n`);
  process.exitCode = 1;
}
