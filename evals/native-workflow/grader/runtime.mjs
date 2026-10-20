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
