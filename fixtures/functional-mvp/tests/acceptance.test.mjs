import { test } from 'node:test';
import assert from 'node:assert/strict';
import { progress } from '../src/backend.ts';
import { statusLabel } from '../src/status.ts';
test('backend percentage handles ordinary and empty workloads', () => {
  assert.equal(progress(1, 4), 25); assert.equal(progress(0, 0), 0);
});
test('frontend state mapping preserves actual task state', () => {
  assert.equal(statusLabel('running'), 'Running');
  assert.equal(statusLabel('succeeded'), 'Completed');
  assert.equal(statusLabel('queued'), 'Waiting');
});
