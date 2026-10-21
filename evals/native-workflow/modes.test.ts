import { afterEach, expect, it } from 'vitest';
import { intelligenceFixture } from '../personal-engineering/helpers.js';
import { selectEngineeringMode, modeTools, analyzeRuntime, runtimeSnapshotSchema } from '../../packages/core/src/index.js';
import { alsRuntimeAdapter } from '../../packages/adapters/src/als-runtime.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
it('uses deterministic task features and does not expand authority with a mode change', () => {
  expect(selectEngineeringMode('auto', 'Fix src/value.ts rounding').mode).toBe('fast');
  expect(selectEngineeringMode('auto', 'Continue previous multi-module work').mode).toBe('engineering');
  expect(selectEngineeringMode('auto', 'Continue selected previous work; independent runtime regression remains pending').mode).toBe('engineering');
  expect(selectEngineeringMode('auto', 'Fix synchronization', { componentCount: 3 }).mode).toBe('engineering');
  expect(selectEngineeringMode('auto', 'Fix rounding', { componentCount: 3 }).mode).toBe('fast');
  expect(selectEngineeringMode('auto', 'Diagnose worker SQLite state race').mode).toBe('deep');
  expect(selectEngineeringMode('fast', 'Complex runtime diagnosis')).toMatchObject({ mode: 'fast', classifierModelRequests: 0, permissionAuthority: 'none' });
  expect(() => selectEngineeringMode('unrestricted')).toThrow('ENGINEERING_MODE_DENIED');
  const fast = modeTools('fast', true); expect(fast).not.toContain('record_capability_gap'); expect(fast).not.toContain('get_runtime_diagnostics');
  for (const mode of ['fast', 'engineering', 'deep'] as const) {
    expect(modeTools(mode, true)).toContain('run_approved_command'); expect(modeTools(mode, true)).not.toContain('approve_command');
  }
});
it('uses a small UTF-8 context budget and keeps safety in Fast without loading the profile', async () => {
  const f = await intelligenceFixture(); cleanups.push(f.cleanup);
  f.system.profiles.get = async () => { throw new Error('Fast must defer full profile'); };
  const brief = await f.system.context.brief(f.record.id, '修复一个简单问题', 1024, false, 'fast');
  expect(brief.bytes).toBeLessThanOrEqual(1024); expect(brief.text).toContain('never authority'); expect(brief.text).toContain('currentRevision=');
});
it('keeps selected unfinished work ahead of recent completed analysis noise during continuation', async () => {
  const f = await intelligenceFixture(); cleanups.push(f.cleanup); const s = f.system;
  const selected = await s.work.start(f.record.id, 'Previous engineering work'); await s.work.progress(selected.id, ['preserve public API'], ['independent runtime regression']); await s.work.checkpoint(selected.id, true);
  for (let i = 0; i < 4; i++) { const recent = await s.work.start(f.record.id, 'Continue selected previous project work'); await s.work.checkpoint(recent.id, true); }
  const lines = await s.work.context(f.record.id, 'Continue selected previous project work'); expect(lines[0]).toContain(selected.id);
  const brief = await s.context.brief(f.record.id, 'Continue selected previous project work', 3600, false, 'engineering');
  expect(brief.text).toContain('independent runtime regression'); expect(brief.text).toContain('preserve public API');
});
it('distinguishes transient propagation, persistent mismatch, stale samples and missing clocks', () => {
  const at = '2026-10-20T10:00:00.000Z';
  const sample = (state: 'running' | 'failed', updatedAt: string, source: string) => ({ workflowId: 'job', state, step: 'handler', updatedAt, observedAt: at, source, clockDomain: 'fixture' });
  const base = runtimeSnapshotSchema.parse({ schemaVersion: 1, adapter: alsRuntimeAdapter.id, capturedAt: at, serviceVersion: 'test', timeoutMs: 60000,
    clock: { domain: 'fixture', trusted: true, maxSkewMs: 5 }, consistencyPolicy: { propagationDelayMs: 1000, persistentAfterMs: 3000, observationMaxAgeMs: 5000 },
    api: [sample('running', '2026-10-20T09:59:59.800Z', 'api')], worker: [sample('failed', '2026-10-20T09:59:59.900Z', 'worker')], sqlite: [], ui: [], events: [] });
  expect(analyzeRuntime(base, alsRuntimeAdapter).map(item => item.code)).toEqual(['transient-inconsistency']);
  const persistent = { ...base, mismatchWindows: [{ workflowId: 'job', firstObservedAt: '2026-10-20T09:59:55.000Z', lastObservedAt: at, samples: 2 }] };
  expect(analyzeRuntime(persistent, alsRuntimeAdapter).map(item => item.code)).toContain('persistent-mismatch');
  expect(analyzeRuntime({ ...base, clock: { ...base.clock!, trusted: false } }, alsRuntimeAdapter).map(item => item.code)).toEqual(['insufficient-evidence']);
  expect(analyzeRuntime({ ...base, api: [{ ...base.api[0]!, observedAt: '2026-10-20T09:59:40.000Z', updatedAt: '2026-10-20T09:59:39.000Z' }] }, alsRuntimeAdapter).map(item => item.code)).toEqual(['stale-observation']);
  const missing = { ...base, api: [{ ...base.api[0]!, updatedAt: null }] };
  expect(analyzeRuntime(missing, alsRuntimeAdapter).map(item => item.code)).toEqual(['insufficient-evidence']);
  const future = { ...base, api: [{ ...base.api[0]!, updatedAt: '2026-10-20T10:00:30.000Z' }] };
  expect(analyzeRuntime(future, alsRuntimeAdapter).map(item => item.code)).toEqual(['insufficient-evidence']);
});
