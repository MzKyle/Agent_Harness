import { StateStore, digest, newId } from '../v2/store.js';
import { HarnessError } from '../v2/contracts.js';
import { readdir } from 'node:fs/promises';
const taskPrefix = (taskId?: string) => taskId ? `artifacts/${taskId}` : 'artifacts/unbound-mcp';
export async function writeMcpReceipt(store: StateStore, payload: Record<string, unknown>, taskId?: string) {
  const base = taskPrefix(taskId); const denied = payload.status === 'denied'; const active = `${base}/${denied ? 'mcp-denial-receipts' : 'mcp-receipts'}`; await store.directory(active);
  const id = newId('execution'); const directory = (await readdir(store.resolve(active))).length >= 200 ? `${base}/${denied ? 'mcp-denial-archive' : 'mcp-receipt-archive'}/${digest(id).slice(0, 2)}` : active;
  await store.put(`${directory}/${id}.json`, { ...payload, signature: await store.sign(payload) }); return id;
}
export async function readMcpReceipts<T>(store: StateStore, taskId?: string, includeDenied = false): Promise<T[]> {
  const base = taskPrefix(taskId); const active = `${base}/mcp-receipts`; await store.directory(active);
  const records = await store.list<T>(active); const archive = await store.directory(`${base}/mcp-receipt-archive`);
  for (const prefix of await readdir(archive)) {
    if (!/^[a-f0-9]{2}$/.test(prefix)) throw new HarnessError('MCP_ARCHIVE_PATH_DENIED');
    records.push(...await store.list<T>(`${base}/mcp-receipt-archive/${prefix}`));
  }
  if (includeDenied) {
    const denied = `${base}/mcp-denial-receipts`; await store.directory(denied); records.push(...await store.list<T>(denied));
    const deniedArchive = await store.directory(`${base}/mcp-denial-archive`);
    for (const prefix of await readdir(deniedArchive)) {
      if (!/^[a-f0-9]{2}$/.test(prefix)) throw new HarnessError('MCP_ARCHIVE_PATH_DENIED');
      records.push(...await store.list<T>(`${base}/mcp-denial-archive/${prefix}`));
    }
  }
  return includeDenied ? records : records.filter(record => (record as { status?: string }).status !== 'denied');
}
