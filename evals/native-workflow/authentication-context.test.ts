import { afterEach, expect, it } from 'vitest';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { intelligenceFixture } from '../personal-engineering/helpers.js';
import { CodexNativeIntegration, authenticationHome } from '../../packages/codex-integration/src/index.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
it('audits the exact observed CLI accessibility preference while rejecting every other authentication config delta', async () => {
  const f = await intelligenceFixture(); cleanups.push(f.cleanup); const s = f.system;
  const native = new CodexNativeIntegration(s.store, s.registry, s.identities, s.workspaces, s.tasks); const attachment = await native.attach(f.record.id);
  const file = path.join(authenticationHome(attachment), 'config.toml'); const original = await readFile(file, 'utf8');
  const baseline = await native.authenticationContext(attachment);
  const changed = original + '\n[tui]\nscreen_reader_detection_done = true\n'; await writeFile(file, changed);
  const reviewed = await native.authenticationContext(attachment); expect(reviewed.configurationHash).toBe(baseline.configurationHash);
  expect(reviewed.acceptedPresentationMetadata).toEqual(['tui.screen_reader_detection_done']);
  const observation = await s.store.get<{ signature: string; id: string }>(`runtime/authentication-ui-observations/${baseline.id}.json`);
  const { signature, ...payload } = observation; expect(await s.store.verify(payload, signature)).toBe(true);
  expect(await readFile(file, 'utf8')).toBe(changed);
  await writeFile(file, changed.replace('hooks = false', 'hooks = true'));
  await expect(native.authenticationContext(attachment)).rejects.toThrow('NATIVE_AUTH_CONTEXT_CONFIGURATION_CHANGED');
  await writeFile(file, original);
  await writeFile(path.join(authenticationHome(attachment), 'hooks.json'), '{}');
  expect((await native.hookIsolation(attachment.id)).status).toBe('blocked');
  await expect(native.executionConfiguration(attachment.id, attachment.taskId, [], { hooks: {} })).rejects.toThrow('HOOK_AUTH_CONTEXT_ISOLATION_BLOCKED');
  // The legacy context remains usable with Hooks explicitly off; no shared file is changed or removed.
  expect((await native.executionConfiguration(attachment.id, attachment.taskId, [])).sessionId).toMatch(/^native-session-/);
  await writeFile(file, original + '\n[tui]\nscreen_reader_detection_done = false\n');
  await expect(native.authenticationContext(attachment)).rejects.toThrow('NATIVE_AUTH_CONTEXT_CONFIGURATION_CHANGED');
});
