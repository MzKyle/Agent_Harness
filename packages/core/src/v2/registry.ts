import path from 'node:path';
import { lstat, realpath, unlink } from 'node:fs/promises';
import { canonicalRoot, isWithin, type ProjectDetector, publicConfig } from '../index.js';
import { projectRecordSchema, type ProjectRecord, HarnessError } from './contracts.js';
import { StateStore, digest } from './store.js';
import { revision } from './git.js';

export class ExternalRegistry {
  onRegistered?: (record: ProjectRecord) => Promise<void>;
  resolveLocalId?: (id: string) => Promise<string>;
  constructor(readonly store: StateStore, private readonly detector: ProjectDetector) {}
  async add(input: string, options: { rules?: boolean; fixture?: boolean; shareFixture?: boolean; deferIntelligence?: boolean } = {}) {
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
    let existing: ProjectRecord | undefined;
    try { existing = projectRecordSchema.parse(await this.store.get(`projects/${item.id}.json`)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (existing) {
      existing = await this.validate(existing);
      if (existing.rulesAllowed !== item.rulesAllowed || existing.sourceSharing !== item.sourceSharing) throw new HarnessError('PROJECT_ALREADY_REGISTERED_DIFFERENT_GRANT');
      if (!options.deferIntelligence) await this.onRegistered?.(existing); return existing;
    }
    await this.store.put(`projects/${item.id}.json`, item);
    if (!options.deferIntelligence) await this.onRegistered?.(item);
    return item;
  }
  async get(id: string): Promise<ProjectRecord> {
    if (!/^project-[a-f0-9]{16}$/.test(id)) throw new HarnessError('UNAUTHORIZED_PROJECT');
    const localId = this.resolveLocalId ? await this.resolveLocalId(id) : id;
    return this.validate(projectRecordSchema.parse(await this.store.get(`projects/${localId}.json`)));
  }
  private async validate(item: ProjectRecord) {
    if ((await lstat(item.root)).isSymbolicLink() || await realpath(item.root) !== item.root) throw new HarnessError('PROJECT_ROOT_CHANGED');
    return item;
  }
  async list() {
    const active: ProjectRecord[] = [];
    for (const item of await this.store.list<ProjectRecord>('projects')) {
      try { if (!this.resolveLocalId || await this.resolveLocalId(item.id) === item.id) active.push(item); } catch { /* Historical registrations cannot restore a missing local binding. */ }
    }
    return active.map((item) => ({ id: item.id, name: item.name, root: item.root, authorization: item.authorization, rulesAllowed: item.rulesAllowed, sourceSharing: item.sourceSharing }));
  }
  async rescan(id: string) {
    const record = await this.get(id); const config = await this.detector.detect(record.root);
    const updated = projectRecordSchema.parse({ ...record, config, name: config.name });
    await this.store.put(`projects/${record.id}.json`, updated); return updated;
  }
  async remove(id: string) { const item = await this.get(id); await unlink(this.store.resolve(`projects/${item.id}.json`)); return { id, status: 'unregistered', sourceDeleted: false }; }
  async inspect(id: string) {
    const item = await this.get(id);
    return { id, authorization: item.authorization, sourceRevision: revision(item.root), source: 'external-registry',
      rulesAllowed: item.rulesAllowed, sourceSharing: item.sourceSharing, project: publicConfig(item.config) };
  }
}
