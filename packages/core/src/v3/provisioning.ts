import path from 'node:path';
import { lstat, mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { checkedPath, isWithin } from '../safety.js';
import { digest } from '../v2/store.js';
import { HarnessError } from '../v2/contracts.js';
import { engineeringFile } from './files.js';
import type { EngineeringChange } from './onboarding-contracts.js';

export async function fileHash(root: string, file: string): Promise<string | null> {
  if (!engineeringFile(file)) throw new HarnessError('PROVISIONING_PATH_DENIED');
  try {
    const full = await checkedPath(root, file); const stat = await lstat(full);
    if (!stat.isFile() || stat.nlink > 1 || stat.size > 65536) throw new HarnessError('PROVISIONING_FILE_DENIED');
    return digest(await readFile(full));
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
async function safeWrite(root: string, file: string, content: string) {
  if (!engineeringFile(file)) throw new HarnessError('PROVISIONING_PATH_DENIED');
  let directory = root;
  for (const part of path.posix.dirname(file).split('/').filter(part => part !== '.')) {
    directory = path.join(directory, part);
    try { await mkdir(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    await checkedPath(root, path.relative(root, directory));
  }
  const target = path.join(root, file); if (!isWithin(root, target)) throw new HarnessError('PROVISIONING_PATH_DENIED');
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
  try { await checkedPath(root, path.relative(root, directory)); await rename(temporary, target); }
  catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
}
export async function applyEngineeringChanges(root: string, changes: EngineeringChange[]) {
  for (const change of changes) if (await fileHash(root, change.path) !== change.beforeHash) throw new HarnessError('PROVISIONING_FILE_CONFLICT', `Review ${change.path} again`);
  const applied: EngineeringChange[] = [];
  try {
    for (const change of changes) {
      if (await fileHash(root, change.path) !== change.beforeHash) throw new HarnessError('PROVISIONING_FILE_CONFLICT');
      await safeWrite(root, change.path, change.after); applied.push(change);
    }
  } catch (error) {
    for (const change of applied.reverse()) {
      if (await fileHash(root, change.path) !== digest(change.after)) throw new HarnessError('PROVISIONING_ROLLBACK_CONFLICT', 'Concurrent changes detected; retain the audit and review the partially applied plan');
      if (change.before === null) await unlink(await checkedPath(root, change.path));
      else await safeWrite(root, change.path, change.before);
    }
    throw error;
  }
}
