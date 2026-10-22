import path from 'node:path';
import { lstat, readFile } from 'node:fs/promises';
import { digest, HarnessError, type StateStore, type WorkspaceManager } from '@devagent/core';
export const nativeSkillRelative = '.agents/skills/devagent-native-bridge/SKILL.md';
// Provision an existing public Skill into the managed snapshot. Discovery/injection remain Codex-native.
// No business source or authentication HOME is modified; preserve pre-existing divergent files.
export async function provisionNativeSkill(store: StateStore, workspaces: WorkspaceManager, workspaceId: string, content: string) {
  const cwd = await workspaces.root(workspaceId); const file = path.join(cwd, nativeSkillRelative);
  try {
    const stat = await lstat(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) throw new HarnessError('NATIVE_SKILL_PATH_DENIED');
    if (digest(await readFile(file)) !== digest(content)) throw new HarnessError('NATIVE_SKILL_CONFIG_CONFLICT');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await store.put(`workspaces/${workspaceId}/code/${nativeSkillRelative}`, content);
  }
  const payload = { workspaceId, path: nativeSkillRelative, hash: digest(content), source: 'Harness public reusable Skill; provisioning, not model code edits', at: new Date().toISOString() };
  await workspaces.markProvisionedContext(workspaceId, nativeSkillRelative, payload.hash);
  await store.put(`runtime/codex-skill-provisioning/${workspaceId}.json`, { ...payload, signature: await store.sign(payload) });
  return { path: file, hash: payload.hash };
}
