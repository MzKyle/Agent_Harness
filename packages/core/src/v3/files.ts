import path from 'node:path';
import { lstat, opendir } from 'node:fs/promises';
import { canonicalRoot, checkedPath, readBounded } from '../safety.js';
import { HarnessError } from '../v2/contracts.js';
import { filterContent, portableFile } from '../v2/content.js';
import { contractSchema } from './contracts.js';

export async function explicitRoot(input: string) {
  if (!path.isAbsolute(input)) throw new HarnessError('ABSOLUTE_PROJECT_PATH_REQUIRED');
  let cursor = path.parse(input).root;
  for (const part of path.resolve(input).slice(cursor.length).split(path.sep)) {
    cursor = path.join(cursor, part); if ((await lstat(cursor)).isSymbolicLink()) throw new HarnessError('PROJECT_LINK_DENIED');
  }
  return canonicalRoot(input);
}
export const engineeringSkill = (file: string) => /^\.agents\/skills\/[a-z0-9-]{1,64}\/SKILL\.md$/.test(file);
export const engineeringFile = (file: string) => file === 'AGENTS.md' || engineeringSkill(file) || file === '.codex/config.toml' || file === 'docs/agent-capabilities.json';
export function inspectEngineeringContent(file: string, raw: string) {
  if (file === 'docs/agent-capabilities.json') {
    const contract = contractSchema.parse(JSON.parse(raw));
    // Only schema-validated hashes/IDs are exempt from the quoted-token heuristic.
    // Every free-text field still passes the normal sensitive/instruction scanner.
    const inspected = filterContent([...contract.requiredChecks, ...contract.entries.flatMap(entry => [entry.id, entry.detail, ...entry.references.flatMap(ref => [ref.ref, ref.path ?? ''])])].join('\n'), 'rules');
    if (inspected.redactions) throw new HarnessError('SENSITIVE_ENGINEERING_FILE');
    return { raw, warnings: inspected.injectionWarnings };
  }
  const filtered = filterContent(raw, 'rules');
  if (filtered.redactions) throw new HarnessError('SENSITIVE_ENGINEERING_FILE');
  return { raw, warnings: filtered.injectionWarnings };
}
export async function engineeringFiles(root: string) {
  const files: string[] = [];
  for (const file of ['AGENTS.md', '.codex/config.toml', 'docs/agent-capabilities.json']) {
    try { const target = await checkedPath(root, file); if (!(await lstat(target)).isFile()) throw new HarnessError('ENGINEERING_FILE_DENIED'); files.push(file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  try {
    const directory = await checkedPath(root, '.agents/skills'); let count = 0;
    for await (const entry of await opendir(directory)) {
      if (++count > 30) throw new HarnessError('SKILL_SCAN_LIMIT');
      if (entry.isSymbolicLink()) throw new HarnessError('ENGINEERING_LINK_DENIED');
      if (!entry.isDirectory() || !/^[a-z0-9-]{1,64}$/.test(entry.name)) continue;
      const file = `.agents/skills/${entry.name}/SKILL.md`;
      try { await checkedPath(root, file); files.push(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return files.sort();
}
export async function readEngineering(root: string, file: string) {
  portableFile(file); if (!engineeringFile(file) && !/^(?:README|readme)\.md$/.test(file)) throw new HarnessError('ENGINEERING_FILE_DENIED');
  return inspectEngineeringContent(file, await readBounded(root, file, 65536));
}
