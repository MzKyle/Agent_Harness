import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isWithin, HarnessError, digest, type WorkSessions } from '@devagent/core';
import type { CodexNativeIntegration } from './index.js';
const root = fileURLToPath(new URL('../../../', import.meta.url));
export async function installWorkHooks(native: CodexNativeIntegration, work: WorkSessions, attachmentId: string, workId: string) {
  const attachment = await native.get(attachmentId); const session = await work.get(workId);
  if (session.projectId !== attachment.projectId || session.workspaceId !== attachment.workspaceId || session.state === 'completed') throw new HarnessError('HOOK_WORK_SCOPE_DENIED');
  if (!isWithin(path.join(native.store.root, 'runtime/codex-native'), attachment.home)) throw new HarnessError('HOOK_HOME_DENIED');
  const relative = path.relative(native.store.root, attachment.home).split(path.sep).join('/');
  const file = `${relative}/hooks.json`; const manifest = `runtime/hook-installs/${digest(attachment.home)}.json`;
  let existing: string | null = null;
  try { existing = await native.store.text(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (existing !== null) {
    let owned: { hash: string }; try { owned = await native.store.get(manifest); } catch { throw new HarnessError('HOOK_CONFIG_CONFLICT'); }
    if (digest(existing) !== owned.hash) throw new HarnessError('HOOK_CONFIG_CONFLICT');
  }
  const args = [process.execPath, path.join(root, 'apps/cli/dist/main.js'), 'work', 'hook', '--home', native.store.root, '--id', session.id, '--lease', session.leaseId];
  if (args.some(value => /[\r\n"'`$%&|<>]/.test(value))) throw new HarnessError('HOOK_COMMAND_PATH_DENIED');
  // Only fixed Harness argv; no repository command or event field enters shell text.
  const command = args.map(value => `"${value}"`).join(' ');
  const hooks = Object.fromEntries(['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'SessionEnd', 'Interrupt'].map(name => [name, [{ hooks: [{ type: 'command', command, commandWindows: command, timeout: ['SessionEnd', 'Interrupt'].includes(name) ? 3 : 10 }] }]]));
  const content = JSON.stringify({ description: 'Agent_Harness explicit Work metadata observations; no permission authority', hooks }, null, 2);
  await native.store.put(file, content); await native.store.put(manifest, { hash: digest(content), workId, attachmentId, at: new Date().toISOString() });
  return { workId, attachmentId, artifact: file, feature: 'hooks', installed: true, observed: false, globalConfigurationChanged: false, authority: 'none' };
}
