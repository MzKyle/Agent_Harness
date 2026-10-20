import { mkdir, writeFile, readFile, lstat, rm } from 'node:fs/promises';
import path from 'node:path';
import { checkedPath, isWithin } from '../safety.js';
import { ExternalRegistry } from './registry.js';
import { StateStore, newId, digest } from './store.js';
import { filterContent, permittedFile, portableFile } from './content.js';
import { git, revision, sourceFiles } from './git.js';
import { workspaceSchema, type Workspace, HarnessError } from './contracts.js';
import { engineeringFiles, engineeringSkill, inspectEngineeringContent } from '../v3/files.js';

export class WorkspaceManager {
  constructor(readonly store: StateStore, readonly registry: ExternalRegistry) {}
  async create(projectId: string, requested = 'HEAD', options: { includeEngineeringSkills?: boolean } = {}) {
    const project = await this.registry.get(projectId); const sha = revision(project.root, requested);
    const id = newId('workspace'); const directory = await this.store.directory(`workspaces/${id}/code`);
    const excluded: Workspace['excluded'] = []; const selected: { path: string; oid: string; mode: string }[] = [];
    const names = new Set<string>(); let total = 0;
    try {
      const entries = git(project.root, ['ls-tree', '-rz', '--full-tree', sha]).toString('utf8').split('\0').filter(Boolean);
      if (entries.length > 30000) throw new HarnessError('SNAPSHOT_ENTRY_LIMIT');
      for (const entry of entries) {
        const match = /^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/.exec(entry);
        if (!match) throw new HarnessError('INVALID_GIT_ENTRY');
        const mode = match[1]!; const type = match[2]!; const oid = match[3]!; const file = match[4]!;
        portableFile(file);
        if (!['100644', '100755'].includes(mode) || type !== 'blob') throw new HarnessError('UNSUPPORTED_GIT_ENTRY', 'Symlinks, submodules and special entries require a separately reviewed snapshot policy');
        const folded = file.toLowerCase(); if (names.has(folded)) throw new HarnessError('CASE_COLLISION'); names.add(folded);
        if (!permittedFile(file) && !(options.includeEngineeringSkills && engineeringSkill(file))) { excluded.push({ path: file, reason: 'snapshot-policy' }); continue; }
        if (selected.length >= 5000) throw new HarnessError('SNAPSHOT_FILE_LIMIT');
        selected.push({ path: file, oid, mode });
      }
      const output = selected.length ? git(project.root, ['cat-file', '--batch'], `${selected.map((file) => file.oid).join('\n')}\n`) : Buffer.alloc(0);
      let cursor = 0; let included = 0;
      for (const file of selected) {
        const headerEnd = output.indexOf(10, cursor); const header = output.subarray(cursor, headerEnd).toString();
        const match = /^([a-f0-9]+) blob (\d+)$/.exec(header);
        if (!match || match[1] !== file.oid) throw new HarnessError('SNAPSHOT_BLOB_MISMATCH');
        const size = Number(match[2]); const bytes = output.subarray(headerEnd + 1, headerEnd + 1 + size); cursor = headerEnd + 1 + size + 1;
        if (size > 512 * 1024) { excluded.push({ path: file.path, reason: 'file-size-limit' }); continue; }
        total += size; if (total > 48 * 1024 * 1024) throw new HarnessError('SNAPSHOT_BYTE_LIMIT');
        let materialized = bytes;
        try {
          if (file.path === 'docs/agent-capabilities.json') { inspectEngineeringContent(file.path, bytes.toString('utf8')); }
          else {
          const inspected = filterContent(bytes.toString('utf8'), file.path.endsWith('AGENTS.md') ? 'rules' : 'source');
          if (inspected.redactions) {
            if (file.path.endsWith('AGENTS.md')) { materialized = Buffer.from(inspected.content); excluded.push({ path: file.path, reason: 'rules-sanitized' }); }
            else { excluded.push({ path: file.path, reason: 'sensitive-content' }); continue; }
          }
          }
        } catch { excluded.push({ path: file.path, reason: 'unsafe-content' }); continue; }
        const full = path.join(directory, file.path); if (!isWithin(directory, full)) throw new HarnessError('SNAPSHOT_ESCAPE');
        await mkdir(path.dirname(full), { recursive: true }); await writeFile(full, materialized, { flag: 'wx', mode: file.mode === '100755' ? 0o755 : 0o644 }); included++;
      }
      git(directory, ['init', '-b', 'workspace']);
      git(directory, ['config', 'user.name', 'DevAgent Snapshot']); git(directory, ['config', 'user.email', 'snapshot@localhost.invalid']);
      git(directory, ['config', 'core.autocrlf', 'false']);
      git(directory, ['add', '--all', '--force']); git(directory, ['commit', '--allow-empty', '-m', 'Filtered source snapshot']);
      const workspace = workspaceSchema.parse({ schemaVersion: 2, id, projectId, sourceRevision: sha, baseline: revision(directory),
        createdAt: new Date().toISOString(), state: 'ready', included, excluded });
      await this.store.put(`workspaces/${id}.json`, workspace); return workspace;
    } catch (error) {
      await this.store.put(`workspaces/${id}.json`, { id, projectId, state: 'blocked', sourceRevision: sha, reason: error instanceof HarnessError ? error.code : 'SNAPSHOT_FAILED' });
      throw error;
    }
  }
  async get(id: string): Promise<Workspace> {
    if (!/^workspace-[a-f0-9]{32}$/.test(id)) throw new HarnessError('UNKNOWN_WORKSPACE');
    const record = workspaceSchema.parse(await this.store.get(`workspaces/${id}.json`));
    await this.root(id); return record;
  }
  async root(id: string): Promise<string> {
    if (!/^workspace-[a-f0-9]{32}$/.test(id)) throw new HarnessError('UNKNOWN_WORKSPACE');
    return checkedPath(this.store.root, `workspaces/${id}/code`);
  }
  async update(id: string, state: Workspace['state']) { const record = await this.get(id); record.state = state; await this.store.put(`workspaces/${id}.json`, record); }
  async workingRevision(id: string): Promise<string> {
    const root = await this.root(id); const listing = await sourceFiles(root, 15000, 12, true);
    if (listing.truncated) throw new HarnessError('WORKSPACE_SCAN_LIMIT');
    const hashes = [];
    for (const file of [...new Set([...listing.files.filter(file => permittedFile(file)), ...await engineeringFiles(root)])].sort()) {
      const full = await checkedPath(root, file); const info = await lstat(full);
      if (info.size > 512 * 1024) throw new HarnessError('WORKSPACE_FILE_LIMIT');
      hashes.push([file, digest(await readFile(full))]);
    }
    return digest(JSON.stringify(hashes));
  }
  async write(id: string, file: string, content: string) {
    portableFile(file);
    if (!permittedFile(file, true) || Buffer.byteLength(content) > 65536) throw new HarnessError('WORKSPACE_WRITE_DENIED');
    const inspected = filterContent(content); if (inspected.redactions) throw new HarnessError('SENSITIVE_WRITE_DENIED');
    const root = await this.root(id); const full = path.join(root, file);
    if (!isWithin(root, full)) throw new HarnessError('WORKSPACE_ESCAPE');
    let cursor = root;
    for (const part of path.posix.dirname(file).split('/').filter((part) => part !== '.')) {
      cursor = path.join(cursor, part); try { await mkdir(cursor); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      await checkedPath(root, path.relative(root, cursor));
    }
    try { if ((await lstat(full)).isSymbolicLink()) throw new HarnessError('WORKSPACE_LINK_DENIED'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await writeFile(full, content, { mode: 0o644 });
    return { workspaceId: id, path: file, workspaceRevision: await this.workingRevision(id) };
  }
  async diff(id: string) {
    const workspace = await this.get(id); const root = await this.root(id); const listing = await sourceFiles(root, 15000, 12, true);
    if (listing.truncated) throw new HarnessError('WORKSPACE_SCAN_LIMIT');
    const tracked = git(root, ['ls-files', '-z']).toString().split('\0').filter(Boolean);
    const files = [...new Set([...tracked, ...listing.files.filter((file) => permittedFile(file)), ...await engineeringFiles(root)])];
    for (const file of files) {
      portableFile(file);
      try {
        const info = await lstat(await checkedPath(root, file));
        if (!info.isFile() || info.size > 512 * 1024) throw new HarnessError('DIFF_FILE_DENIED');
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    if (files.length) git(root, ['add', '--all', '--force', '--', ...files]);
    const raw = git(root, ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--binary', workspace.baseline]).toString();
    if (Buffer.byteLength(raw) > 1024 * 1024) throw new HarnessError('DIFF_SIZE_LIMIT');
    const sensitiveScan = raw.split(/(?=^diff --git )/m).filter(section => {
      if (!section.startsWith('diff --git a/docs/agent-capabilities.json b/docs/agent-capabilities.json\n')) return true;
      try { inspectEngineeringContent('docs/agent-capabilities.json', git(root, ['show', ':docs/agent-capabilities.json']).toString()); }
      catch { inspectEngineeringContent('docs/agent-capabilities.json', git(root, ['show', `${workspace.baseline}:docs/agent-capabilities.json`]).toString()); }
      return false;
    }).join('');
    const filtered = filterContent(sensitiveScan);
    if (filtered.redactions) throw new HarnessError('SENSITIVE_DIFF_REFUSED');
    const changedFiles = git(root, ['diff', '--cached', '--name-only', '-z', workspace.baseline]).toString().split('\0').filter(Boolean);
    const artifact = `artifacts/${id}/changes.patch`; await this.store.put(artifact, raw);
    return { workspaceId: id, sourceRevision: workspace.sourceRevision, workspaceRevision: await this.workingRevision(id),
      changedFiles, unifiedDiff: raw, artifact, sourceModified: false, warnings: workspace.excluded.length ? ['Snapshot excluded files; validate against full project before applying'] : [] };
  }
  async cleanup(id: string) {
    const workspace = await this.get(id);
    if (workspace.state === 'running') throw new HarnessError('WORKSPACE_RUNNING');
    const root = await this.root(id);
    if (!isWithin(path.join(this.store.root, 'workspaces'), root) || path.basename(root) !== 'code') throw new HarnessError('CLEANUP_DENIED');
    await rm(root, { recursive: true });
    return { workspaceId: id, sourceDeleted: false, artifactsRetained: true };
  }
}
