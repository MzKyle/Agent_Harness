import { lstat, realpath, open, opendir } from 'node:fs/promises';
import path from 'node:path';

export class ProjectError extends Error {
  constructor(public readonly code: 'ACCESS_DENIED' | 'INVALID_CONFIG' | 'CONFIG_EXISTS' | 'NOT_INITIALIZED' | 'SCAN_FAILED' | 'INVALID_ARGUMENT') {
    super(code);
  }
}
export function isWithin(root: string, target: string, flavor: 'win32' | 'posix' = process.platform === 'win32' ? 'win32' : 'posix'): boolean {
  const api = path[flavor];
  if (!api.isAbsolute(root) || !api.isAbsolute(target)) return false;
  const relative = api.relative(api.normalize(root), api.normalize(target));
  return relative === '' || (!api.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${api.sep}`));
}
export async function canonicalRoot(root: string): Promise<string> {
  if (!path.isAbsolute(root) || root.includes('\0')) throw new ProjectError('ACCESS_DENIED');
  try {
    const resolved = await realpath(root);
    if (!(await lstat(resolved)).isDirectory()) throw new ProjectError('ACCESS_DENIED');
    // Do not grant an entire volume implicitly.
    if (path.parse(resolved).root === resolved) throw new ProjectError('ACCESS_DENIED');
    return resolved;
  } catch { throw new ProjectError('ACCESS_DENIED'); }
}
export async function checkedPath(root: string, relative: string): Promise<string> {
  root = await canonicalRoot(root);
  const target = path.resolve(root, relative);
  if (!isWithin(root, target) || relative.includes('\0')) throw new ProjectError('ACCESS_DENIED');
  let cursor = root;
  for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    const info = await lstat(cursor);
    if (info.isSymbolicLink()) throw new ProjectError('ACCESS_DENIED');
  }
  const resolved = await realpath(target);
  if (!isWithin(root, resolved)) throw new ProjectError('ACCESS_DENIED');
  return resolved;
}
export async function readBounded(root: string, relative: string, maxBytes = 128 * 1024): Promise<string> {
  const target = await checkedPath(root, relative);
  const handle = await open(target, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new ProjectError('SCAN_FAILED');
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxBytes) throw new ProjectError('SCAN_FAILED');
    await checkedPath(root, relative);
    return buffer.subarray(0, bytesRead).toString('utf8').replace(/^\uFEFF/, '');
  } finally { await handle.close(); }
}
export const excludedNames = new Set([
  '.git', '.devagent', '.dsh', '.agents', '.codex', '.ssh', '.aws', '.azure', '.venv', 'venv',
  'node_modules', 'dist', 'build', 'bin', 'obj', 'coverage', '__pycache__', '.pytest_cache',
  'data', 'datasets', 'weights', 'models', 'logs', 'secrets', 'credentials', 'cache', 'artifacts',
  'fixtures', '__fixtures__', 'testdata',
]);
export function isSensitiveName(name: string): boolean {
  return excludedNames.has(name.toLowerCase()) || name.startsWith('.') || /(?:secret|credential|password|token|private[-_]?key)/i.test(name);
}
export function safeText(value: string): string {
  return value.replace(/(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|Bearer\s+\S+|(?:password|token|api[-_]?key|secret)\s*[:=]\s*\S+)/gi, '[redacted]')
    // Deliberately strip control characters from untrusted metadata.
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, '').slice(0, 240);
}

export interface Inventory { files: string[]; directories: string[]; warnings: ('scan-limit' | 'unreadable-entry' | 'skipped-link')[] }
export async function inventory(root: string, limits = { depth: 4, entries: 1500, manifests: 100 }): Promise<Inventory> {
  const result: Inventory = { files: [], directories: [], warnings: [] };
  let count = 0;
  const walk = async (relative: string, depth: number): Promise<void> => {
    if (count >= limits.entries) return;
    try {
      const directory = await checkedPath(root, relative);
      const entries = [];
      for await (const entry of await opendir(directory)) {
        if (entries.length >= limits.entries - count) { result.warnings.push('scan-limit'); break; }
        entries.push(entry);
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (++count > limits.entries) { result.warnings.push('scan-limit'); break; }
        if (isSensitiveName(entry.name)) continue;
        const child = relative === '.' ? entry.name : `${relative}/${entry.name}`;
        if (entry.isSymbolicLink()) { result.warnings.push('skipped-link'); continue; }
        if (entry.isDirectory()) {
          if (result.directories.length < 200) result.directories.push(child);
          if (depth < limits.depth) await walk(child, depth + 1);
          else result.warnings.push('scan-limit');
        } else if (entry.isFile() && /^(package\.json|pyproject\.toml|requirements(?:-dev)?\.txt|pytest\.ini|tsconfig\.json|pnpm-lock\.yaml|yarn\.lock|package-lock\.json)$|\.(?:csproj|sln|slnx)$/i.test(entry.name)) {
          if (result.files.length >= limits.manifests) { result.warnings.push('scan-limit'); continue; }
          result.files.push(child);
        }
      }
    } catch (error) {
      result.warnings.push(error instanceof ProjectError && error.code === 'ACCESS_DENIED' ? 'skipped-link' : 'unreadable-entry');
    }
  };
  await walk('.', 0);
  result.warnings = [...new Set(result.warnings)];
  return result;
}
