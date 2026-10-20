import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startRuntime } from '../src/service.ts';
test('worker terminal failure is durable and visible to API consumers', async () => {
  const runtime = await startRuntime();
  try {
    await fetch(`${runtime.url}/run/exception`, { method: 'POST' });
    const snapshot = await (await fetch(`${runtime.url}/snapshot`)).json();
    assert.equal(snapshot.worker[0].state, 'failed');
    assert.equal(snapshot.sqlite[0].state, 'failed', 'worker exception must persist terminal state');
  } finally { await runtime.close(); }
});
