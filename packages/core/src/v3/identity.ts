import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { git, revision } from '../v2/git.js';
import { digest } from '../v2/store.js';
import { HarnessError, type ProjectRecord } from '../v2/contracts.js';
import { ExternalRegistry } from '../v2/registry.js';
import { IntelligenceData, now } from './data.js';
import { projectId, type ProjectIdentity } from './contracts.js';
import { explicitRoot } from './files.js';

export function repositoryIdentity(root: string): string | null {
  let remote: string;
  try { remote = git(root, ['remote', 'get-url', 'origin']).toString().trim(); } catch { return null; }
  if (/^git@[^:]+:/.test(remote)) remote = remote.replace(/^git@([^:]+):/, 'ssh://git@$1/');
  try {
    const url = new URL(remote);
    if (!['https:', 'ssh:', 'git:'].includes(url.protocol) || url.password || url.username && url.username !== 'git' || url.search || url.hash) throw new HarnessError('REPOSITORY_CREDENTIALS_OR_URL_DENIED');
    const name = `${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ''}/${url.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '')}`;
    if (!/^[A-Za-z0-9_./:-]{1,400}$/.test(name) || name.includes('..')) throw new HarnessError('REPOSITORY_IDENTITY_DENIED');
    return url.hostname.toLowerCase() === 'github.com' ? name.toLowerCase() : name;
  } catch (error) { if (error instanceof HarnessError) throw error; return null; }
}
export class ProjectIdentities {
  constructor(readonly data: IntelligenceData, readonly registry: ExternalRegistry) {}
  async ensure(record: ProjectRecord): Promise<ProjectIdentity> {
    const current = await this.data.read();
    const existing = Object.values(current.identities).find(item => item.aliases.includes(record.id));
    if (existing) return existing;
    const repository = repositoryIdentity(record.root); const commit = revision(record.root);
    const result = await this.data.edit(data => {
      const concurrent = Object.values(data.identities).find(item => item.aliases.includes(record.id)); if (concurrent) return concurrent;
      let id: string; do { id = `project-${randomBytes(8).toString('hex')}`; } while (data.identities[id] || id === record.id);
      const identity: ProjectIdentity = { stableProjectId: id, projectName: record.name, repositoryIdentity: repository, registeredAt: now(), aliases: [record.id], observedCommits: [commit],
        duplicateCandidates: repository ? Object.values(data.identities).filter(item => item.repositoryIdentity === repository).map(item => item.stableProjectId).slice(0, 30) : [] };
      data.identities[id] = identity; return identity;
    });
    await this.data.bind(result.stableProjectId, { legacyId: record.id, root: record.root, boundAt: now() }); return result;
  }
  async resolve(id: string): Promise<ProjectIdentity> {
    projectId.parse(id); const data = await this.data.read();
    const item = data.identities[id] ?? Object.values(data.identities).find(item => item.aliases.includes(id));
    if (item) return item;
    return this.ensure(await this.registry.get(id));
  }
  async localId(id: string): Promise<string> {
    const bindings = await this.data.bindings();
    const identities = (await this.data.read()).identities;
    const stable = identities[id]?.stableProjectId ?? Object.values(identities).find(item => item.aliases.includes(id))?.stableProjectId;
    if (!stable) return id; // A V0.2 registration may be lazily migrated by resolve/ensure.
    const binding = bindings.active[stable]; if (!binding) throw new HarnessError('PROJECT_RELINK_REQUIRED'); return binding.legacyId;
  }
  async relink(id: string, input: string) {
    const identity = await this.resolve(id); const stable = identity.stableProjectId;
    if (!path.isAbsolute(input)) throw new HarnessError('ABSOLUTE_PROJECT_PATH_REQUIRED');
    const root = await explicitRoot(input);
    const expectedLegacy = `project-${digest(root).slice(0, 16)}`;
    const data = await this.data.read();
    const owner = Object.values(data.identities).find(item => item.aliases.includes(expectedLegacy));
    if (owner && owner.stableProjectId !== stable) throw new HarnessError('PROJECT_RELINK_IDENTITY_CONFLICT');
    const repository = repositoryIdentity(root); const head = revision(root);
    if (identity.repositoryIdentity !== repository || !repository && !identity.observedCommits.includes(head)) throw new HarnessError('REPOSITORY_IDENTITY_MISMATCH');
    if (!identity.observedCommits.includes(head)) {
      let related = false;
      for (const previous of identity.observedCommits.slice(-5)) try { git(root, ['merge-base', previous, head]); related = true; break; } catch { /* Shallow/unrelated clones fail closed. */ }
      if (!related) throw new HarnessError('REPOSITORY_HISTORY_UNCONFIRMED');
    }
    const record = await this.registry.add(input, { deferIntelligence: true });
    // A relink is a new local read grant. Never copy source sharing, command or write permissions.
    const downgraded = { ...record, rulesAllowed: false, sourceSharing: 'local-only' as const, kind: 'external' as const };
    await this.data.store.put(`projects/${record.id}.json`, downgraded);
    await this.data.edit(current => {
      const target = current.identities[stable]!;
      if (!target.aliases.includes(record.id)) target.aliases.push(record.id);
      if (!target.observedCommits.includes(head)) target.observedCommits = [...target.observedCommits, head].slice(-100);
      if (current.profiles[stable]) current.profiles[stable]!.facts.forEach(fact => { fact.status = 'stale'; });
      delete current.contracts[stable];
    });
    await this.data.bind(stable, { legacyId: record.id, root: record.root, boundAt: now() });
    return { stableProjectId: stable, legacyProjectId: record.id, authorization: 'read-only', rulesAllowed: false, sourceSharing: 'local-only', permissionsRestored: false };
  }
}
