import { afterEach, expect, it } from 'vitest';
import { intelligenceFixture } from '../personal-engineering/helpers.js';
import { CodexNativeIntegration, useCodex, dailyMode, dailyStatus } from '../../packages/codex-integration/src/index.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
it('selects a registered project without an extra attachment, paid classification or implicit Work', async () => {
  const a = await intelligenceFixture(); const b = await intelligenceFixture(); cleanups.push(a.cleanup, b.cleanup);
  const s = a.system; const second = await s.registry.add(b.source, { fixture: true, shareFixture: true, rules: true });
  const native = new CodexNativeIntegration(s.store, s.registry, s.identities, s.workspaces, s.tasks); const auth = await native.attach(a.record.id);
  const selected = await useCodex(native, s.work, second.id, { authFrom: auth.id, mode: 'auto' });
  const attachments = await s.store.list<{ projectId: string; id: string }>('runtime/codex-native');
  expect(attachments.filter(item => item.projectId === selected.projectId)).toHaveLength(1);
  expect((await s.work.list(second.id))).toEqual([]); expect(selected.selection.classifierModelRequests).toBe(0);
  expect(selected.authentication).toBe('blocked_by_auth');
  const reused = await useCodex(native, s.work, second.id, { mode: 'fast' }); expect(reused.attachmentId).toBe(selected.attachmentId);
  expect(await dailyMode(native, second.id)).toBe('fast'); expect((await dailyStatus(native, s.work, second.id)).requestedMode).toBe('fast');
  const file = `runtime/daily-bindings/${selected.projectId}.json`; const record = await s.store.get<{ requestedMode: string }>(file); record.requestedMode = 'deep'; await s.store.put(file, record);
  await expect(dailyMode(native, second.id)).rejects.toThrow('DAILY_BINDING_INTEGRITY_FAILED');
});
