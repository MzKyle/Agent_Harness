import { createServer } from 'node:http';
import { Worker } from 'node:worker_threads';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStore } from './store.ts';

export async function startRuntime() {
  const directory = await mkdtemp(path.join(tmpdir(), 'als-runtime-'));
  const store = createStore(path.join(directory, 'workflow.sqlite'));
  const events = []; const workers = new Set(); const observed = new Map(); let sequence = 0;
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
        if (state === 'completed') store.update(id, state, 'seal_result');
        void worker.terminate().then(() => { workers.delete(worker); resolve(); });
      };
      const timer = setTimeout(() => finish('failed', 'handler_timeout', 'Synthetic handler timeout'), 350);
      worker.once('message', () => finish('completed', 'handler_completed', 'Synthetic output sealed'));
      worker.once('error', () => finish('failed', 'handler_exception', 'Synthetic worker handler exception'));
    });
    return id;
  }
  function snapshot() {
    const ids = [...observed.keys()]; const sqlite = ids.map(id => store.read(id));
    return { schemaVersion: 1, adapter: 'als-workflow-v1', capturedAt: new Date().toISOString(), serviceVersion: 'fixture-0.4', timeoutMs: 300,
      api: sqlite.map(item => ({ ...item })), sqlite, worker: ids.map(id => observed.get(id)), ui: sqlite.map(item => ({ ...item })), events: [...events] };
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
