import { test } from 'node:test';
import console from 'node:console';
const { fetch } = globalThis;
import assert from 'node:assert/strict';
import { startRuntime } from '/workspace/src/service.ts';
test('independent real HTTP/worker/SQLite failure and timeout regression', async () => {
  const runtime = await startRuntime();
  try {
    for (const scenario of ['healthy', 'exception', 'timeout']) await fetch(`${runtime.url}/run/${scenario}`, { method: 'POST' });
    const snapshot = await (await fetch(`${runtime.url}/snapshot`)).json();
    console.log(`DEVAGENT_RUNTIME_SNAPSHOT ${JSON.stringify(snapshot)}`);
    for (const [index, expected] of ['completed', 'failed', 'failed'].entries()) {
      for (const layer of ['api', 'worker', 'sqlite', 'ui']) assert.equal(snapshot[layer][index].state, expected, `${layer} workflow ${index} must agree with terminal result`);
    }
    assert.equal(snapshot.events.filter(item => item.severity === 'error').length, 2);
  } finally { await runtime.close(); }
});

test('independent delayed propagation stays transient and eventually converges', async () => {
  const runtime = await startRuntime({ propagationDelayMs: 150 });
  try {
    await fetch(`${runtime.url}/run/healthy`, { method: 'POST' });
    const immediate = await (await fetch(`${runtime.url}/snapshot`)).json();
    assert.equal(immediate.worker[0].state, 'completed');
    assert.equal(immediate.sqlite[0].state, 'running', 'Configured propagation delay must remain observable');
    await new Promise(resolve => globalThis.setTimeout(resolve, 220));
    const later = await (await fetch(`${runtime.url}/snapshot`)).json();
    assert.equal(later.sqlite[0].state, 'completed');
    assert.equal(later.worker[0].state, later.sqlite[0].state);
  } finally { await runtime.close(); }
});
