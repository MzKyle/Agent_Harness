import { execFileSync } from 'node:child_process';
import { readFile, opendir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { checkedPath } from '../safety.js';
import { digest } from './store.js';
import { permittedFile } from './content.js';
import { HarnessError } from './contracts.js';

export function git(root: string, args: string[], input?: string): Buffer {
  return execFileSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c', 'core.hooksPath=__devagent_no_hooks__', '-C', root, ...args], {
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' },
    input, maxBuffer: 64 * 1024 * 1024, timeout: 30000, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
}
export function revision(root: string, requested = 'HEAD'): string {
  if (!/^(?:HEAD|[a-f0-9]{7,64}|refs\/heads\/[A-Za-z0-9_./-]+)$/.test(requested)) throw new HarnessError('INVALID_REVISION');
  const sha = git(root, ['rev-parse', '--verify', `${requested}^{commit}`]).toString().trim();
  if (!/^[a-f0-9]{40,64}$/.test(sha)) throw new HarnessError('INVALID_REVISION');
  return sha;
}
export async function sourceFiles(root: string, maxEntries = 15000, depthLimit = 12, rejectLinks = false) {
  const files: string[] = []; const metadata: string[] = []; let entries = 0; let truncated = false;
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > depthLimit) { truncated = true; return; }
    for await (const item of await opendir(await checkedPath(root, directory))) {
      if (++entries > maxEntries) { truncated = true; return; }
      if (item.name === '.git') continue;
      const relative = directory === '.' ? item.name : `${directory}/${item.name}`;
      if (item.isSymbolicLink()) { if (rejectLinks) throw new HarnessError('WORKSPACE_LINK_DENIED'); metadata.push(`${relative}:link`); continue; }
      const stat = await lstat(path.join(root, relative));
      const excluded = item.isDirectory() && (item.name.startsWith('.') || ['node_modules', 'venv', 'site-packages', 'vendor', 'third_party', 'data', 'datasets', 'weights', 'models', 'logs', 'cache', 'dist', 'build', 'bin', 'obj', '__pycache__'].includes(item.name.toLowerCase()));
      if (excluded) { metadata.push(`${relative}:opaque:${stat.mtimeMs}:${stat.size}`); continue; }
      if (item.isDirectory()) { metadata.push(`${relative}:directory`); await walk(relative, depth + 1); }
      else if (item.isFile()) {
        metadata.push(`${relative}:${stat.size}:${stat.mtimeMs}`);
        if (permittedFile(relative)) files.push(relative);
      }
    }
  };
  await walk('.', 0);
  return { files: files.sort(), metadata: metadata.sort(), truncated };
}
export async function fingerprint(root: string) {
  const listing = await sourceFiles(root);
  const hashes: Record<string, string> = {};
  for (const file of listing.files) {
    const full = await checkedPath(root, file); const stat = await lstat(full);
    if (stat.size <= 512 * 1024) hashes[file] = digest(await readFile(full));
  }
  const management: Record<string, string> = {};
  for (const file of ['HEAD', 'index', 'config', 'packed-refs', 'logs/HEAD']) {
    try {
      const actual = git(root, ['rev-parse', '--git-path', file]).toString().trim();
      management[file] = digest(await readFile(path.resolve(root, actual)));
    } catch { management[file] = 'absent'; }
  }
  return { head: revision(root), statusHash: digest(git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])),
    sourceHash: digest(JSON.stringify(hashes)), treeHash: digest(JSON.stringify(listing.metadata)), management,
    complete: !listing.truncated, coverage: 'bounded-source-content+tree-metadata+git-index-config-head', fileCount: listing.files.length };
}
