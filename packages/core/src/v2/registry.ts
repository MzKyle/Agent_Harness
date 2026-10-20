import path from 'node:path';
import { lstat, realpath, unlink } from 'node:fs/promises';
import { canonicalRoot, isWithin, type ProjectDetector, publicConfig } from '../index.js';
import { projectRecordSchema, type ProjectRecord, HarnessError } from './contracts.js';
import { StateStore, digest } from './store.js';
import { revision } from './git.js';

export class ExternalRegistry {
  constructor(readonly store: StateStore, private readonly detector: ProjectDetector) {}
  async add(input: string, options: { rules?: boolean; fixture?: boolean; shareFixture?: boolean } = {}) {
    if (!path.isAbsolute(input)) throw new HarnessError('ABSOLUTE_PROJECT_PATH_REQUIRED');
    let cursor = path.parse(input).root;
    for (const part of path.resolve(input).slice(cursor.length).split(path.sep)) {
      cursor = path.join(cursor, part);
      if ((await lstat(cursor)).isSymbolicLink()) throw new HarnessError('PROJECT_LINK_DENIED');
    }
    const root = await canonicalRoot(input);
    if (isWithin(root, this.store.root) || isWithin(this.store.root, root)) throw new HarnessError('STATE_SOURCE_OVERLAP');
    const config = await this.detector.detect(root);
    const item = projectRecordSchema.parse({ schemaVersion: 2, id: `project-${digest(root).slice(0, 16)}`, root,
      name: config.name, authorization: 'read-only', rulesAllowed: Boolean(options.rules),
      sourceSharing: options.fixture && options.shareFixture ? 'fixture-only' : 'local-only',
      kind: options.fixture ? 'fixture' : 'external', registeredAt: new Date().toISOString(), config });
    try {
      const existing = await this.get(item.id);
      if (existing.rulesAllowed !== item.rulesAllowed || existing.sourceSharing !== item.sourceSharing) throw new HarnessError('PROJECT_ALREADY_REGISTERED_DIFFERENT_GRANT');
      return existing;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await this.store.put(`projects/${item.id}.json`, item);
    return item;
  }
  async get(id: string): Promise<ProjectRecord> {
    if (!/^project-[a-f0-9]{16}$/.test(id)) throw new HarnessError('UNAUTHORIZED_PROJECT');
    const item = projectRecordSchema.parse(await this.store.get(`projects/${id}.json`));
    if ((await lstat(item.root)).isSymbolicLink() || await realpath(item.root) !== item.root) throw new HarnessError('PROJECT_ROOT_CHANGED');
    return item;
  }
  async list() {
    return (await this.store.list<ProjectRecord>('projects')).map((item) => ({ id: item.id, name: item.name, root: item.root, authorization: item.authorization, rulesAllowed: item.rulesAllowed, sourceSharing: item.sourceSharing }));
  }
  async remove(id: string) { await this.get(id); await unlink(this.store.resolve(`projects/${id}.json`)); return { id, status: 'unregistered', sourceDeleted: false }; }
  async inspect(id: string) {
    const item = await this.get(id);
    return { id, authorization: item.authorization, sourceRevision: revision(item.root), source: 'external-registry',
      rulesAllowed: item.rulesAllowed, sourceSharing: item.sourceSharing, project: publicConfig(item.config) };
  }
}
