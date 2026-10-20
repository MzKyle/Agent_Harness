import { test } from 'node:test';
import assert from 'node:assert/strict';
import { correlate } from '/workspace/src/trace-diagnostic.ts';

test('independent diagnostic cases include unrelated errors, success, missing traces, duplicates and bounds', () => {
  const events = [
    { trace_id: 't', component: 'api', severity: 'info' },
    { trace_id: 'other', component: 'hardware', severity: 'error' },
    { trace_id: 't', component: 'worker', severity: 'error' },
    { trace_id: 't', component: 'ui', severity: 'warning' },
    { trace_id: 't', component: 'worker', severity: 'fatal' },
  ];
  assert.deepEqual(correlate(events, 't'), { traceId: 't', components: ['api', 'worker', 'ui'], failureStage: 'worker' });
  assert.deepEqual(correlate(events, 'missing'), { traceId: 'missing', components: [], failureStage: null });
  assert.equal(correlate([{ trace_id: 'ok', component: 'api', severity: 'info' }], 'ok').failureStage, null);
  assert.throws(() => correlate(events, '../invalid'));
  assert.throws(() => correlate(new Array(1001).fill(events[0]), 't'));
});
