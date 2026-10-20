import { cp, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const repo = fileURLToPath(new URL('../', import.meta.url));
export async function fixture(name: 'als-like' | 'pollen-like') {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'devagent-eval-'));
  const root = path.join(parent, name);
  await cp(path.join(repo, 'fixtures', name), root, { recursive: true });
  return { parent, root, cleanup: () => rm(parent, { recursive: true, force: true }) };
}
