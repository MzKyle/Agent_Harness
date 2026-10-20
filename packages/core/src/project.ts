import { createHash } from 'node:crypto';
import { lstat, mkdir, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { projectSchema, type ProjectConfig } from './schema.js';
import { canonicalRoot, checkedPath, inventory, ProjectError, readBounded, safeText } from './safety.js';

export interface ProjectDetector { detect(root: string): Promise<ProjectConfig> }
export const CONFIG_PATH = '.devagent/project.yaml';
export async function loadProject(root: string): Promise<ProjectConfig> {
  try { return projectSchema.parse(parse(await readBounded(root, CONFIG_PATH), { maxAliasCount: 0 })); }
  catch (error) {
    if (error instanceof ProjectError && error.code === 'ACCESS_DENIED') throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ProjectError('NOT_INITIALIZED');
    throw new ProjectError('INVALID_CONFIG');
  }
}
export async function initializeProject(rootPath: string, detector: ProjectDetector, dryRun = false) {
  const root = await canonicalRoot(rootPath);
  try { await checkedPath(root, '.devagent'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  try {
    await lstat(path.join(root, CONFIG_PATH));
    throw new ProjectError('CONFIG_EXISTS');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const config = projectSchema.parse(await detector.detect(root));
  const yaml = stringify(config);
  if (!dryRun) {
    const directory = path.join(root, '.devagent');
    await mkdir(directory, { recursive: true });
    await checkedPath(root, '.devagent');
    try { await writeFile(path.join(directory, 'project.yaml'), yaml, { flag: 'wx', mode: 0o600 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ProjectError('CONFIG_EXISTS');
      throw error;
    }
  }
  return { status: dryRun ? 'dry-run' : 'created', source: CONFIG_PATH, config };
}

export function publicConfig(config: ProjectConfig) {
  return {
    name: safeText(config.name),
    components: config.components.map((component) => ({ ...component,
      name: safeText(component.name), path: safeText(component.path),
      sources: component.sources.map((source) => ({ ...source, path: safeText(source.path) })),
    })),
    commands: config.commands.map((command) => ({ id: safeText(command.id), component: safeText(command.component),
      purpose: command.purpose, status: command.status, source: safeText(command.source),
      evidence: command.evidence ? { revision: command.evidence.revision, checkedAt: command.evidence.checkedAt } : null,
    })),
    observability: { ...config.observability,
      logs: config.observability.logs.map((log) => ({ ...log, path: safeText(log.path) })),
    }, permissions: config.permissions, detection: config.detection,
  };
}
export class ProjectRegistry {
  private readonly roots = new Map<string, string>();
  static async create(authorizedRoots: string[]): Promise<ProjectRegistry> {
    if (authorizedRoots.length === 0 || authorizedRoots.length > 20) throw new ProjectError('ACCESS_DENIED');
    const registry = new ProjectRegistry();
    for (const input of authorizedRoots) {
      const root = await canonicalRoot(input);
      const id = `project-${createHash('sha256').update(root).digest('hex').slice(0, 16)}`;
      registry.roots.set(id, root);
    }
    return registry;
  }
  list(): { projectId: string; name: string }[] {
    return [...this.roots].map(([projectId, root]) => ({ projectId, name: safeText(path.basename(root)) }));
  }
  async root(projectId: string): Promise<string> {
    const root = this.roots.get(projectId);
    if (!root) throw new ProjectError('ACCESS_DENIED');
    // Replacing a root with a link after authorization must never change the grant.
    if ((await lstat(root)).isSymbolicLink() || await realpath(root) !== root) throw new ProjectError('ACCESS_DENIED');
    return root;
  }
}

export async function getProjectContext(registry: ProjectRegistry, projectId: string) {
  const root = await registry.root(projectId);
  const config = await loadProject(root);
  const structure = await inventory(root);
  return {
    projectId, status: config.detection.status === 'partial' || structure.warnings.length ? 'partial' : 'ok',
    source: { path: CONFIG_PATH, kind: 'configuration', schemaVersion: 1 },
    project: publicConfig(config),
    structure: { directories: structure.directories.map(safeText), warnings: structure.warnings },
  };
}
export async function getProjectCapabilities(registry: ProjectRegistry, projectId: string) {
  const root = await registry.root(projectId);
  const config = await loadProject(root);
  const verified = config.commands.filter((command) => command.status === 'verified');
  return {
    projectId, status: 'ok', source: { path: CONFIG_PATH, kind: 'configuration', schemaVersion: 1 },
    capabilities: {
      logs: { status: config.observability.logs.length ? 'pending' : 'unavailable',
        sources: config.observability.logs.map((log) => safeText(log.path)), contentAccess: false },
      tests: { status: verified.some((command) => command.purpose === 'test') ? 'available' : 'pending',
        commands: publicConfig(config).commands.filter((command) => command.purpose === 'test') },
      uiTesting: { status: config.observability.uiTesting }, deviceAdapter: { status: config.observability.deviceAdapter },
      execution: { status: 'unsupported' },
    },
    gaps: ['command-execution-disabled', ...(!verified.length ? ['no-verified-commands'] : []),
      ...(config.observability.uiTesting !== 'available' ? ['ui-testing-unverified'] : []),
      ...(config.observability.deviceAdapter !== 'available' ? ['device-adapter-unavailable'] : [])],
  };
}
