// Independent acceptance oracle, mounted read-only outside the model workspace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { progress } from '/workspace/src/backend.ts';
import { statusLabel } from '/workspace/src/status.ts';
test('backend percentage independently handles quarters, thirds and empty input', () => {
  assert.equal(progress(1, 4), 25); assert.equal(progress(3, 4), 75);
  assert.equal(progress(1, 3), 33); assert.equal(progress(0, 0), 0);
});
test('frontend status preserves running, succeeded and fallback meanings', () => {
  assert.equal(statusLabel('running'), 'Running'); assert.equal(statusLabel('succeeded'), 'Completed');
  assert.equal(statusLabel('queued'), 'Waiting');
});
