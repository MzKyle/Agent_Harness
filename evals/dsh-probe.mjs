// Runs only offline official DSH lifecycle/tool integration in a disposable home.
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { dshBin } from '../packages/dsh-bridge/dist/index.js';
const require = createRequire(realpathSync(dshBin));
const { runProfile } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh/profile-boot')).href);
const { createLaunchEnvironmentSnapshot } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-launch-environment')).href);
const [home, patch, output, projectId] = process.argv.slice(2);
process.env.DSH_HOME = home; process.env.DSH_TELEMETRY_DISABLED = '1';
const environment = createLaunchEnvironmentSnapshot([{ source: 'process', values: { DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' } }]);
const { ctx, shutdown } = await runProfile({ profile: 'devagent', environment, patchFiles: [patch], args: [] });
try {
  const names = ctx.tools.schemas().map((schema) => schema.name);
  const skills = await ctx.skills.list({ cwd: process.cwd() });
  const result = await ctx.tools.execute({ callId: 'eval-call', name: 'mcp__devagent__get_project_context', arguments: { projectId }, signal: new AbortController().signal });
  await writeFile(output, JSON.stringify({ names, skills: skills.map((skill) => skill.name), result }));
} finally { await shutdown.shutdown(0); }
