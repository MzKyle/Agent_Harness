import { createServer } from 'node:http';
import { Worker } from 'node:worker_threads';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStore } from './store.ts';

export async function startRuntime(options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'als-runtime-'));
  const store = createStore(path.join(directory, 'workflow.sqlite'));
  const events = []; const workers = new Set(); const observed = new Map(); const mismatchStarts = new Map(); let sequence = 0;
  const log = (workflowId, component, event, severity, message, from, to) => events.push({ at: new Date().toISOString(), workflowId, traceId: `trace-${workflowId}`, component, event, severity, message, ...(from ? { from } : {}), ...(to ? { to } : {}) });
  async function run(scenario) {
    const id = `workflow-${++sequence}`; store.create(id);
    log(id, 'api', 'enqueue', 'info', 'Synthetic API request accepted', undefined, 'queued');
    store.update(id, 'running', 'handler');
    log(id, 'worker', 'claim', 'info', 'Worker claimed durable workflow', 'queued', 'running');
    observed.set(id, { ...store.read(id) });
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { workerData: { scenario } }); workers.add(worker);
    await new Promise(resolve => {
      let finished = false;
      const finish = (state, event, message) => {
        if (finished) return; finished = true; clearTimeout(timer);
        observed.set(id, { workflowId: id, state, step: 'handler', updatedAt: new Date().toISOString() });
        log(id, 'worker', event, state === 'failed' ? 'error' : 'info', message, 'running', state);
        // Intentional defect: the terminal error path only updates worker memory.
        if (state === 'completed') {
          if (options.propagationDelayMs) setTimeout(() => store.update(id, state, 'seal_result'), options.propagationDelayMs);
          else store.update(id, state, 'seal_result');
        }
        if (store.read(id).state !== state) mismatchStarts.set(id, new Date().toISOString());
        void worker.terminate().then(() => { workers.delete(worker); setTimeout(resolve, 40); });
      };
      const timer = setTimeout(() => finish('failed', 'handler_timeout', 'Synthetic handler timeout'), 350);
      worker.once('message', () => finish('completed', 'handler_completed', 'Synthetic output sealed'));
      worker.once('error', () => finish('failed', 'handler_exception', 'Synthetic worker handler exception'));
    });
    return id;
  }
  function snapshot() {
    const ids = [...observed.keys()]; const sqlite = ids.map(id => store.read(id));
    const capturedAt = new Date().toISOString();
    const sample = (item, source) => ({ ...item, observedAt: capturedAt, source, clockDomain: 'fixture-host-clock' });
    return { schemaVersion: 1, adapter: 'als-workflow-v1', capturedAt, serviceVersion: 'fixture-0.4.1', timeoutMs: 300,
      clock: { domain: 'fixture-host-clock', trusted: true, maxSkewMs: 5 }, consistencyPolicy: { propagationDelayMs: options.propagationDelayMs ?? 20, persistentAfterMs: options.propagationDelayMs ? options.propagationDelayMs + 50 : 30, observationMaxAgeMs: 1000 },
      mismatchWindows: ids.filter(id => mismatchStarts.has(id) && store.read(id).state !== observed.get(id).state).map(id => ({ workflowId: id, firstObservedAt: mismatchStarts.get(id), lastObservedAt: capturedAt, samples: 2 })),
      api: sqlite.map(item => sample(item, 'api')), sqlite: sqlite.map(item => sample(item, 'store')), worker: ids.map(id => sample(observed.get(id), 'worker')), ui: sqlite.map(item => sample(item, 'ui')), events: [...events] };
  }
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'POST' && request.url?.startsWith('/run/')) {
      const scenario = request.url.slice(5);
      if (!['healthy', 'exception', 'timeout'].includes(scenario)) { response.writeHead(400).end('{}'); return; }
      const workflowId = await run(scenario); response.end(JSON.stringify({ workflowId }));
    } else if (request.url === '/snapshot') response.end(JSON.stringify(snapshot()));
    else { response.writeHead(404).end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: async () => { for (const worker of workers) await worker.terminate(); await new Promise(resolve => server.close(resolve)); store.close(); await rm(directory, { recursive: true, force: true }); } };
}
