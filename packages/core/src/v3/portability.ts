import { randomBytes, scrypt, createCipheriv, createDecipheriv } from 'node:crypto';
import { writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { checkedPath, readBounded } from '../safety.js';
import { HarnessError } from '../v2/contracts.js';
import { newId, digest } from '../v2/store.js';
import { filterContent } from '../v2/content.js';
import { portableSchema, sha, type PortableData } from './contracts.js';
import { IntelligenceData, canonical, now } from './data.js';
import { explicitRoot } from './files.js';

const categories = ['identities', 'memories', 'profiles', 'contracts', 'summaries', 'proposals', 'skillPreferences'] as const;
const manifestSchema = z.object({ schemaVersion: z.literal(1), dataSchemaVersion: z.union([z.literal(2), z.literal(3)]), createdAt: z.string().datetime(),
  categories: z.array(z.enum(categories)).length(7), counts: z.record(z.string(), z.number().int().nonnegative()), payloadHash: sha,
  excludes: z.array(z.string()).max(20) }).strict();
const envelopeSchema = z.object({ format: z.literal('devagent-backup'), schemaVersion: z.literal(1), cipher: z.literal('aes-256-gcm'),
  kdf: z.literal('scrypt-N16384-r8-p1'), salt: z.string().regex(/^[a-f0-9]{32}$/), iv: z.string().regex(/^[a-f0-9]{24}$/),
  tag: z.string().regex(/^[a-f0-9]{32}$/), ciphertext: z.string().max(6 * 1024 * 1024).regex(/^[A-Za-z0-9+/]*={0,2}$/), manifest: manifestSchema }).strict();
const reviewSchema = z.object({ id: z.string().regex(/^restore-[a-f0-9]{32}$/), backupHash: sha, baselineHash: sha, createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(), conflicts: z.array(z.string()).max(2000), mode: z.literal('preserve-existing'), usedAt: z.string().datetime().nullable() }).strict();

export function migratePortable(input: unknown): PortableData {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HarnessError('BACKUP_SCHEMA_INVALID');
  const value = input as Record<string, unknown>;
  if (value.schemaVersion === 2) return portableSchema.parse({ ...value, schemaVersion: 3, skillPreferences: value.skillPreferences ?? {} });
  return portableSchema.parse(input);
}
function downgrade(data: PortableData): PortableData {
  const result = structuredClone(data);
  const check = (text: string) => { if (filterContent(text).redactions) throw new HarnessError('BACKUP_SENSITIVE_CONTENT_REFUSED'); };
  for (const record of Object.values(result.memories)) check([record.topic, record.content, ...record.history.map(item => item.content), ...record.references.map(ref => ref.ref)].join('\n'));
  for (const profile of Object.values(result.profiles)) for (const fact of [...profile.facts, ...profile.history]) check([fact.statement, ...fact.references.map(ref => ref.ref)].join('\n'));
  for (const summary of Object.values(result.summaries)) check([summary.requirement, ...summary.blocked, ...summary.incomplete].join('\n'));
  for (const proposal of Object.values(result.proposals)) check([proposal.title, proposal.why, proposal.alternative, proposal.suggestion, ...proposal.risks].join('\n'));
  for (const contract of Object.values(result.contracts)) check([...contract.requiredChecks, ...contract.entries.flatMap(entry => [entry.detail, ...entry.references.map(ref => ref.ref)])].join('\n'));
  for (const profile of Object.values(result.profiles)) profile.facts.forEach(fact => { fact.status = 'stale'; });
  for (const record of Object.values(result.memories)) {
    record.trust = 'imported';
    if (record.source === 'verified' || record.references.some(ref => ['file', 'git', 'evidence', 'task'].includes(ref.kind))) record.freshness = 'stale';
  }
  for (const summary of Object.values(result.summaries)) { summary.evidenceTrust = 'historical-unverified'; summary.verified = []; summary.incomplete = [...new Set([...summary.incomplete, 'Restored history is not local verification evidence'])].slice(0, 20); }
  for (const contract of Object.values(result.contracts)) contract.entries.forEach(entry => {
    if (['hardware', 'production-execution', 'source-write'].includes(entry.id)) entry.status = 'forbidden';
    else if (['verified', 'configured'].includes(entry.status)) entry.status = 'unavailable';
    entry.workspaceId = null; entry.workspaceRevision = null;
  });
  for (const proposal of Object.values(result.proposals)) {
    if (['implemented', 'verified', 'adopted'].includes(proposal.state)) { proposal.state = 'proposed'; proposal.history.push({ state: 'restored-proposal-requires-local-adaptation', actor: 'tool', at: now() }); proposal.history = proposal.history.slice(-30); }
    proposal.workspaceId = null; proposal.workspaceRevision = null; proposal.evidenceId = null; proposal.invocationCommandId = null;
  }
  return result;
}
function conflictsFor(current: PortableData, imported: PortableData) {
  const conflicts: string[] = [];
  for (const identity of Object.values(imported.identities)) {
    const existing = current.identities[identity.stableProjectId];
    if (existing && existing.repositoryIdentity !== identity.repositoryIdentity) throw new HarnessError('RESTORE_PROJECT_IDENTITY_CONFLICT');
    for (const other of Object.values(current.identities)) if (other.stableProjectId !== identity.stableProjectId && other.aliases.some(alias => identity.aliases.includes(alias))) throw new HarnessError('RESTORE_LEGACY_ID_CONFLICT');
  }
  for (const category of categories) for (const key of Object.keys(imported[category])) if (key in current[category] && canonical(current[category][key as never]) !== canonical(imported[category][key as never])) conflicts.push(`${category}/${key}`);
  for (const record of Object.values(imported.memories)) if (Object.values(current.memories).some(existing => existing.id !== record.id && existing.domain === record.domain && existing.projectId === record.projectId && existing.topic.toLocaleLowerCase() === record.topic.toLocaleLowerCase() && existing.type === record.type && existing.confirmation === 'confirmed' && !existing.deprecated && existing.content !== record.content)) conflicts.push(`memories/${record.id}:topic-conflict`);
  return conflicts;
}
export class PortableState {
  constructor(readonly data: IntelligenceData) {}
  private async key(password: string, salt: Buffer) {
    if (password.length < 12 || password.length > 1024) throw new HarnessError('BACKUP_PASSPHRASE_REQUIRED', 'Supply a strong passphrase through a dedicated process environment variable; never command arguments or chat');
    return await new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
  }
  async create(password: string) {
    const payload = await this.data.read(); const plain = Buffer.from(canonical(payload));
    const manifest = manifestSchema.parse({ schemaVersion: 1, dataSchemaVersion: 3, createdAt: now(), categories: [...categories], counts: Object.fromEntries(categories.map(category => [category, Object.keys(payload[category]).length])),
      payloadHash: digest(plain), excludes: ['project-path-bindings', 'command-and-write-approvals', 'authentication', 'workspaces', 'business-source-and-datasets', 'evidence-signing-keys', 'raw-execution-evidence', 'docker-and-device-access'] });
    const salt = randomBytes(16); const iv = randomBytes(12); const key = await this.key(password, salt);
    try {
      const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(Buffer.from(canonical(manifest)));
      const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
      const envelope = envelopeSchema.parse({ format: 'devagent-backup', schemaVersion: 1, cipher: 'aes-256-gcm', kdf: 'scrypt-N16384-r8-p1', salt: salt.toString('hex'), iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), ciphertext: ciphertext.toString('base64'), manifest });
      const artifact = `artifacts/backups/${newId('backup')}.devagent-backup.json`;
      await this.data.store.put(artifact, envelope); return { artifact, file: this.data.store.resolve(artifact), manifest, encrypted: true };
    } finally { key.fill(0); plain.fill(0); }
  }
  private async decrypt(file: string, password: string) {
    if (!path.isAbsolute(file) || !file.endsWith('.devagent-backup.json')) throw new HarnessError('BACKUP_FILE_DENIED');
    const parent = await explicitRoot(path.dirname(file)); const actual = await checkedPath(parent, path.basename(file));
    if ((await lstat(actual)).size > 8 * 1024 * 1024) throw new HarnessError('BACKUP_SIZE_LIMIT');
    const envelope = envelopeSchema.parse(JSON.parse(await readBounded(parent, path.basename(file), 8 * 1024 * 1024)));
    const key = await this.key(password, Buffer.from(envelope.salt, 'hex')); let plain: Buffer | undefined;
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'hex')); decipher.setAAD(Buffer.from(canonical(envelope.manifest))); decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));
      plain = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]);
      if (plain.length > 3 * 1024 * 1024 || digest(plain) !== envelope.manifest.payloadHash) throw new HarnessError('BACKUP_INTEGRITY_FAILED');
      const payload = migratePortable(JSON.parse(plain.toString('utf8')));
      for (const category of categories) if (envelope.manifest.counts[category] !== Object.keys(payload[category]).length) throw new HarnessError('BACKUP_MANIFEST_MISMATCH');
      return { manifest: envelope.manifest, payload, backupHash: digest(canonical(envelope)) };
    } catch (error) { if (error instanceof HarnessError) throw error; throw new HarnessError('BACKUP_AUTHENTICATION_OR_SCHEMA_FAILED'); }
    finally { key.fill(0); plain?.fill(0); }
  }
  async inspect(file: string, password: string) {
    const backup = await this.decrypt(file, password); const current = await this.data.read(); const incoming = downgrade(backup.payload); const conflicts = conflictsFor(current, incoming);
    const review = reviewSchema.parse({ id: newId('restore'), backupHash: backup.backupHash, baselineHash: digest(canonical(current)), createdAt: now(), expiresAt: new Date(Date.now() + 3600000).toISOString(), conflicts, mode: 'preserve-existing', usedAt: null });
    await this.data.writeSigned(`restore-reviews/${review.id}.json`, review);
    return { manifest: backup.manifest, review, requiresRelink: Object.keys(incoming.identities), permissionsImported: false, authenticationImported: false, evidenceTrust: 'historical-unverified' };
  }
  async restore(file: string, password: string, reviewId: string) {
    if (!/^restore-[a-f0-9]{32}$/.test(reviewId)) throw new HarnessError('RESTORE_PREVIEW_REQUIRED');
    const backup = await this.decrypt(file, password); const review = await this.data.signed(`restore-reviews/${reviewId}.json`, reviewSchema);
    if (review.usedAt || Date.parse(review.expiresAt) <= Date.now() || review.backupHash !== backup.backupHash) throw new HarnessError('RESTORE_REVIEW_EXPIRED_OR_MISMATCH');
    const incoming = downgrade(backup.payload);
    const result = await this.data.edit(current => {
      if (digest(canonical(current)) !== review.baselineHash) throw new HarnessError('RESTORE_STATE_CHANGED');
      const conflicts = conflictsFor(current, incoming); if (canonical(conflicts) !== canonical(review.conflicts)) throw new HarnessError('RESTORE_CONFLICTS_CHANGED');
      for (const record of Object.values(incoming.memories)) if (conflicts.includes(`memories/${record.id}:topic-conflict`)) { record.confirmation = 'candidate'; record.freshness = 'conflicted'; }
      const imported: Record<string, number> = {};
      for (const category of categories) {
        imported[category] = 0;
        for (const [key, value] of Object.entries(incoming[category])) {
          if (!(key in current[category])) { (current[category] as Record<string, unknown>)[key] = value; imported[category]!++; }
        }
      }
      return { imported, preservedConflicts: conflicts, localBindingsRestored: false, permissionsRestored: false, authenticationRestored: false, evidenceTrust: 'historical-unverified' };
    });
    review.usedAt = now(); await this.data.writeSigned(`restore-reviews/${review.id}.json`, review); return result;
  }
  async exportProfile(file: string, projectId?: string) {
    // Explicit plaintext export is confined to the managed state directory and never automatic.
    const payload = await this.data.read(); const selected = Object.values(payload.memories).filter(record => record.projectId === (projectId ?? null));
    const target = this.data.store.resolve(file); await this.data.store.directory(path.posix.dirname(file));
    await writeFile(target, JSON.stringify(selected, null, 2), { flag: 'wx', mode: 0o600 }); return { artifact: file, records: selected.length, sensitiveLocalExport: true };
  }
}
