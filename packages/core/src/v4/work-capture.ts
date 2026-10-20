import { lstat, readFile } from 'node:fs/promises';
import { checkedPath } from '../safety.js';
import { sourceFiles, revision, git } from '../v2/git.js';
import { digest } from '../v2/store.js';
import { canonical } from '../v3/data.js';
import { snapshotSchema } from './work-contracts.js';

export async function workSnapshot(root: string) {
  const listing = await sourceFiles(root); const files: Record<string, string> = {}; let complete = !listing.truncated && listing.files.length <= 2000;
  for (const file of listing.files.slice(0, 2000)) {
    const actual = await checkedPath(root, file); const stat = await lstat(actual);
    if (!stat.isFile() || stat.size > 512 * 1024 || stat.nlink > 1) { complete = false; continue; }
    files[file] = digest(await readFile(actual));
  }
  const status = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  return snapshotSchema.parse({ revision: revision(root), sourceDigest: digest(canonical(files)), statusHash: digest(status), clean: status.length === 0, complete, files });
}
export function changedFiles(before: Record<string, string>, after: Record<string, string>) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(file => before[file] !== after[file]).sort();
}
