import { createHash, randomBytes, randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile, rename, readFile, readdir, lstat, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { canonicalRoot, checkedPath, isWithin, readBounded } from '../safety.js';
import { HarnessError } from './contracts.js';

export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const newId = (prefix: string) => `${prefix}-${randomUUID().replaceAll('-', '')}`;
export class StateStore {
  private constructor(readonly root: string) {}
  static async open(input: string): Promise<StateStore> {
    if (!path.isAbsolute(input)) throw new HarnessError('ABSOLUTE_STATE_PATH_REQUIRED');
    // Reject aliases, links, or junctions anywhere in an explicitly selected state path.
    let cursor = path.parse(input).root;
    for (const part of path.resolve(input).slice(cursor.length).split(path.sep)) {
      cursor = path.join(cursor, part);
      try { if ((await lstat(cursor)).isSymbolicLink()) throw new HarnessError('STATE_LINK_DENIED'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    await mkdir(input, { recursive: true });
    const store = new StateStore(await canonicalRoot(input));
    for (const dir of ['projects', 'workspaces', 'tasks', 'evidence', 'diagnostics', 'approvals', 'artifacts', 'locks', 'runtime', 'reports', 'plans', 'gaps']) await store.directory(dir);
    try { await writeFile(path.join(store.root, 'evidence.key'), randomBytes(32), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    await store.put('git-empty.config', '');
    return store;
  }
  resolve(relative: string): string {
    if (!relative || relative.includes('\\') || relative.split('/').some((item) => item === '..' || !item) || path.isAbsolute(relative)) throw new HarnessError('STATE_PATH_DENIED');
    const file = path.resolve(this.root, relative);
    if (!isWithin(this.root, file)) throw new HarnessError('STATE_PATH_DENIED');
    return file;
  }
  async directory(relative: string): Promise<string> {
    const file = this.resolve(relative);
    let cursor = this.root;
    for (const part of relative.split('/')) {
      cursor = path.join(cursor, part);
      try { await mkdir(cursor); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      await checkedPath(this.root, path.relative(this.root, cursor));
    }
    return file;
  }
  async put(relative: string, value: unknown): Promise<void> {
    const file = this.resolve(relative); const parent = path.posix.dirname(relative);
    if (parent !== '.') await this.directory(parent);
    else await checkedPath(this.root, '.');
    try { if ((await lstat(file)).isSymbolicLink()) throw new HarnessError('STATE_LINK_DENIED'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, typeof value === 'string' ? value : JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
    await rename(temporary, file);
  }
  async get<T>(relative: string): Promise<T> { return JSON.parse(await readBounded(this.root, relative, 4 * 1024 * 1024)) as T; }
  async text(relative: string): Promise<string> { return readBounded(this.root, relative, 4 * 1024 * 1024); }
  async locked<T>(id: string, action: () => Promise<T>): Promise<T> {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new HarnessError('LOCK_ID_DENIED');
    const file = this.resolve(`locks/${id}.lock`);
    let handle;
    try { handle = await open(file, 'wx'); }
    catch { throw new HarnessError('CONCURRENT_TASK_MUTATION', 'Wait for the pending operation; after a process crash, review the managed lock before removing it'); }
    try { return await action(); } finally { await handle.close(); await unlink(file); }
  }
  async denial(record: { code: string; tool?: string; command?: string; operation?: string; taskId?: string | null }) {
    return this.locked('denial-audit', async () => {
      const bucket = await this.directory('artifacts/denials');
      const entries = await readdir(bucket);
      if (entries.length >= 500) {
        const artifact = 'artifacts/denials/retention-limit.json';
        let count = 0; try { count = (await this.get<{ count: number }>(artifact)).count; } catch { /* First overflow. */ }
        await this.put(artifact, { status: 'denied', code: 'DENIAL_RETENTION_LIMIT', count: Math.min(Number.MAX_SAFE_INTEGER, count + 1), latestCode: record.code, at: new Date().toISOString(), remedy: 'Export and archive the bounded denial audit; overflow is aggregated' });
        return artifact;
      }
      const artifact = `artifacts/denials/${newId('execution')}.json`;
      await this.put(artifact, { ...record, status: 'denied', at: new Date().toISOString() }); return artifact;
    });
  }
  async list<T>(kind: string): Promise<T[]> {
    const entries = await readdir(await checkedPath(this.root, kind));
    if (entries.length > 2000) throw new HarnessError('STATE_RECORD_LIMIT');
    return Promise.all(entries.filter((file) => file.endsWith('.json')).map((file) => this.get<T>(`${kind}/${file}`)));
  }
  async sign(value: unknown): Promise<string> {
    const key = await readFile(await checkedPath(this.root, 'evidence.key'));
    return createHmac('sha256', key).update(JSON.stringify(value)).digest('hex');
  }
  async verify(value: unknown, signature: string): Promise<boolean> {
    const actual = await this.sign(value);
    return /^[a-f0-9]{64}$/.test(signature) && timingSafeEqual(Buffer.from(actual), Buffer.from(signature));
  }
}
