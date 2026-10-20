import { afterEach, expect, it } from 'vitest';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createCipheriv, scryptSync, randomBytes } from 'node:crypto';
import path from 'node:path';
import { engineeringSystem } from '../../packages/adapters/src/index.js';
import { canonical, digest, git, migratePortable } from '../../packages/core/src/index.js';
import { checkNativeAnswer } from '../../packages/codex-integration/src/index.js';
import { intelligenceFixture } from './helpers.js';
const cleanups: (() => Promise<void>)[] = [];
const passphrase = 'synthetic-fixture-backup-passphrase';
afterEach(async () => { await Promise.all(cleanups.splice(0).map(run => run())); });

it('restores portable intelligence on device B without paths, authentication, approvals or verification authority, and explicitly relinks a moved clone', async () => {
  const f = await intelligenceFixture(); cleanups.push(f.cleanup); const id = f.identity.stableProjectId;
  const { record: preference } = await f.system.memory.set({ domain: 'developer', type: 'engineering-preference', topic: 'Workflow', content: 'Prefer explicit test evidence.' });
  await f.system.store.put('runtime/private-auth-fixture.json', { secret: 'local fixture canary' });
  await f.system.store.put('approvals/canary.json', { command: 'never portable' });
  const backup = await f.system.portability.create(passphrase); const raw = await readFile(backup.file, 'utf8');
  expect(raw).not.toContain(preference.content); expect(raw).not.toContain(f.source); expect(raw).not.toContain('local fixture canary');
  const b = await engineeringSystem(path.join(f.parent, 'state-b'));
  const preview = await b.portability.inspect(backup.file, passphrase); expect(preview.requiresRelink).toEqual([id]);
  expect(Object.keys((await b.intelligence.read()).identities)).toEqual([]);
  await b.portability.restore(backup.file, passphrase, preview.review.id);
  expect((await b.memory.get(preference.id)).trust).toBe('imported');
  expect((await b.profiles.get(id)).binding).toBe('relink-required');
  expect((await b.intelligence.bindings()).active).toEqual({}); expect(await b.store.list('approvals')).toEqual([]);
  expect((await b.intelligence.read()).contracts[id]!.entries.find(item => item.id === 'hardware')?.status).toBe('forbidden');
  const clone = path.join(f.parent, 'device-b-clone'); await cp(f.source, clone, { recursive: true });
  const relink = await b.identities.relink(id, clone); expect(relink.permissionsRestored).toBe(false);
  expect((await b.registry.get(id)).root).toBe(clone); expect((await b.registry.get(f.record.id)).root).toBe(clone);
  expect((await b.registry.get(id)).sourceSharing).toBe('local-only'); expect((await b.registry.get(id)).rulesAllowed).toBe(false);
  const refreshed = await b.profiles.refresh(id); expect(refreshed.profile.facts.some(item => item.status === 'source-confirmed')).toBe(true);
  expect((await b.identities.resolve(id)).stableProjectId).toBe(id);
  await f.system.identities.relink(id, clone);
  expect((await f.system.registry.get(f.record.id)).root).toBe(clone);
  expect((await f.system.registry.get(f.record.id)).sourceSharing).toBe('local-only');
  expect((await f.system.registry.list()).some(item => item.root === f.source)).toBe(false);
  await expect(b.portability.restore(backup.file, passphrase, preview.review.id)).rejects.toThrow('RESTORE_REVIEW_EXPIRED_OR_MISMATCH');
});

it('rejects wrong passwords, tampered encrypted data and manifest, unsafe paths, stale previews and malformed imported identities without changing state', async () => {
  const f = await intelligenceFixture(); cleanups.push(f.cleanup); const backup = await f.system.portability.create(passphrase);
  const b = await engineeringSystem(path.join(f.parent, 'state-b')); const before = canonical(await b.intelligence.read());
  await expect(b.portability.inspect(backup.file, 'wrong-fixture-passphrase')).rejects.toThrow('BACKUP_AUTHENTICATION_OR_SCHEMA_FAILED');
  const original = JSON.parse(await readFile(backup.file, 'utf8'));
  const tampered = path.join(f.parent, 'tampered.devagent-backup.json');
  await writeFile(tampered, JSON.stringify({ ...original, manifest: { ...original.manifest, payloadHash: '0'.repeat(64) } }));
  await expect(b.portability.inspect(tampered, passphrase)).rejects.toThrow('BACKUP_AUTHENTICATION_OR_SCHEMA_FAILED');
  const bad = structuredClone(await f.system.intelligence.read()); bad.identities[f.identity.stableProjectId]!.stableProjectId = 'project-0000000000000000';
  const plain = Buffer.from(canonical(bad)); const salt = randomBytes(16); const iv = randomBytes(12); const manifest = { ...original.manifest, payloadHash: digest(plain) };
  const cipher = createCipheriv('aes-256-gcm', scryptSync(passphrase, salt, 32), iv); cipher.setAAD(Buffer.from(canonical(manifest)));
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  await writeFile(tampered, JSON.stringify({ ...original, manifest, salt: salt.toString('hex'), iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), ciphertext: encrypted.toString('base64') }));
  await expect(b.portability.inspect(tampered, passphrase)).rejects.toThrow('BACKUP_AUTHENTICATION_OR_SCHEMA_FAILED');
  await expect(b.portability.inspect('../outside.devagent-backup.json', passphrase)).rejects.toThrow('BACKUP_FILE_DENIED');
  expect(canonical(await b.intelligence.read())).toBe(before);
  const preview = await b.portability.inspect(backup.file, passphrase);
  await b.memory.set({ domain: 'developer', type: 'engineering-preference', topic: 'Concurrent edit', content: 'Retain the existing edit.' });
  await expect(b.portability.restore(backup.file, passphrase, preview.review.id)).rejects.toThrow('RESTORE_STATE_CHANGED');
  expect((await b.memory.search({ domain: 'developer' })).records).toHaveLength(1);
});

it('preserves local conflicting facts and keeps imported conflicts as review candidates; distinguishes independent clones and rejects unrelated relinks', async () => {
  const f = await intelligenceFixture(); cleanups.push(f.cleanup);
  await f.system.memory.set({ domain: 'developer', type: 'engineering-preference', topic: 'Workflow', content: 'Imported workflow.' });
  const backup = await f.system.portability.create(passphrase); const b = await engineeringSystem(path.join(f.parent, 'state-b'));
  const { record: local } = await b.memory.set({ domain: 'developer', type: 'engineering-preference', topic: 'Workflow', content: 'Existing local workflow.' });
  const preview = await b.portability.inspect(backup.file, passphrase); expect(preview.review.conflicts.some(item => item.endsWith(':topic-conflict'))).toBe(true);
  await b.portability.restore(backup.file, passphrase, preview.review.id);
  expect((await b.memory.get(local.id)).content).toBe('Existing local workflow.');
  const imported = (await b.memory.search({ domain: 'developer', includeCandidates: true })).records.find(item => item.id !== local.id)!;
  expect(imported.confirmation).toBe('candidate'); expect(imported.freshness).toBe('conflicted');
  const clone = path.join(f.parent, 'independent-clone'); await cp(f.source, clone, { recursive: true });
  const other = await f.system.registry.add(clone, { rules: true }); const identity = await f.system.identities.resolve(other.id);
  expect(identity.stableProjectId).not.toBe(f.identity.stableProjectId); expect(identity.duplicateCandidates).toContain(f.identity.stableProjectId);
  await expect(f.system.identities.relink(f.identity.stableProjectId, clone)).rejects.toThrow('PROJECT_RELINK_IDENTITY_CONFLICT');
  const unrelated = path.join(f.parent, 'unrelated'); await mkdir(unrelated); git(unrelated, ['init', '-b', 'fixture']); git(unrelated, ['config', 'user.name', 'Fixture']); git(unrelated, ['config', 'user.email', 'fixture@localhost.invalid']);
  await writeFile(path.join(unrelated, 'README.md'), 'Unrelated repository'); git(unrelated, ['add', '--all']); git(unrelated, ['commit', '-m', 'Unrelated']); git(unrelated, ['remote', 'add', 'origin', `https://${f.identity.repositoryIdentity}.git`]);
  await expect(b.identities.relink(f.identity.stableProjectId, unrelated)).rejects.toThrow('REPOSITORY_HISTORY_UNCONFIRMED');
  const v3 = await f.system.intelligence.read(); const { skillPreferences: _preferences, ...old } = v3; const v2 = { ...old, schemaVersion: 2 }; expect(_preferences).toEqual({});
  expect(migratePortable(v2).schemaVersion).toBe(3);
});

it('the native context oracle rejects fabricated revision, path, safety, and task states', () => {
  const receipts = [{ tool: 'get_context_brief', sourcePaths: [], recentStates: [] }, { tool: 'read_code_slice', sourcePaths: ['src/service.ts'], recentStates: [] }, { tool: 'get_recent_work', sourcePaths: [], recentStates: ['blocked'] }];
  const answer = { projectId: 'project-0123456789abcdef', currentRevision: 'a'.repeat(40), sourcePath: 'src/service.ts', forbiddenOperations: ['hardware', 'production', 'source-write'], recentWorkStates: ['blocked'] };
  expect(checkNativeAnswer(answer, answer.projectId, answer.currentRevision, receipts)).toBe(true);
  for (const changed of [{ currentRevision: 'fabricated' }, { sourcePath: '../../other' }, { forbiddenOperations: [] }, { recentWorkStates: ['succeeded'] }]) expect(checkNativeAnswer({ ...answer, ...changed }, answer.projectId, answer.currentRevision, receipts)).toBe(false);
});
