import { z } from 'zod';

export const relativePath = z.string().min(1).max(240).refine(
  // Control characters and Windows device/stream syntax are invalid project paths.
  // eslint-disable-next-line no-control-regex
  (value) => value === '.' || (!/^[./\\]|^[A-Za-z]:|[\x00-\x1f:*?"<>|]/.test(value)
    && !value.split(/[\\/]/).some((part) => part === '..' || part === '' || part === '.')
    && !value.includes('\\')),
  'Use a portable relative path without traversal',
);
export const label = z.string().min(1).max(96).regex(/^[\p{L}\p{N}@/_. -]+$/u);
export const status = z.enum(['available', 'pending', 'unavailable', 'unsupported']);
export const sourceSchema = z.object({ path: relativePath, kind: z.enum(['manifest', 'configuration', 'structure']) }).strict();
export const commandSchema = z.object({
  id: label, component: relativePath, purpose: z.enum(['build', 'test', 'typecheck', 'lint']),
  executable: z.enum(['npm', 'pnpm', 'yarn', 'python', 'dotnet']),
  args: z.array(z.string().max(100).regex(/^[A-Za-z0-9_./:@=-]+$/)).max(12),
  status: z.enum(['pending', 'verified']), source: relativePath,
  evidence: z.object({ revision: z.string().regex(/^[a-f0-9]{7,64}$/), checkedAt: z.string().datetime(),
    exitCode: z.literal(0), reference: relativePath }).strict().optional(),
}).strict().superRefine((command, ctx) => {
  if (command.status === 'verified' && !command.evidence) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Verified commands require revision-bound evidence' });
  }
});
export const componentSchema = z.object({
  name: label, path: relativePath, languages: z.array(z.enum(['Python', 'TypeScript', 'JavaScript', 'C#'])),
  frameworks: z.array(z.enum(['FastAPI', 'React', 'Electron', 'WPF', '.NET'])),
  buildSystems: z.array(z.enum(['setuptools', 'hatchling', 'poetry', 'uv', 'npm', 'pnpm', 'yarn', 'vite', 'tsc', 'MSBuild'])),
  testFrameworks: z.array(z.enum(['pytest', 'unittest', 'vitest', 'jest', 'playwright', 'xunit', 'nunit', 'mstest'])),
  sources: z.array(sourceSchema),
}).strict();
export const projectSchema = z.object({
  schemaVersion: z.literal(1), name: label,
  components: z.array(componentSchema).max(100), mainDirectories: z.array(relativePath).max(200),
  commands: z.array(commandSchema).max(300),
  observability: z.object({
    logs: z.array(z.object({ path: relativePath, status, contentAccess: z.literal(false) }).strict()).max(20),
    uiTesting: status, deviceAdapter: status,
  }).strict(),
  permissions: z.object({ read: z.literal('metadata-only'), executeCommands: z.literal(false),
    hardware: z.literal(false), network: z.literal(false), remoteBusinessData: z.literal(false) }).strict(),
  detection: z.object({ status: z.enum(['complete', 'partial']), warnings: z.array(z.enum([
    'scan-limit', 'invalid-manifest', 'unreadable-entry', 'skipped-link', 'unknown-stack',
  ])) }).strict(),
}).strict();
export type ProjectConfig = z.infer<typeof projectSchema>;
export type Component = z.infer<typeof componentSchema>;
export type Command = z.infer<typeof commandSchema>;
export type Source = z.infer<typeof sourceSchema>;

export const knowledgeSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().regex(/^[a-z0-9-]{1,64}$/),
  scope: z.enum(['global', 'project', 'task']), projectId: z.string().optional(), taskId: z.string().optional(),
  title: label, contentRef: relativePath, references: z.array(z.object({
    knowledgeId: z.string(), revision: z.string(),
  }).strict()),
  version: z.object({ revision: z.string().min(1), repositoryCommit: z.string().regex(/^[a-f0-9]{7,64}$/).optional(),
    recordedAt: z.string().datetime(), supersedes: z.string().optional() }).strict(),
  provenance: z.enum(['human', 'tool-evidence', 'agent-proposal']),
}).strict().superRefine((record, ctx) => {
  if ((record.scope !== 'global' && !record.projectId) || (record.scope === 'task' && !record.taskId)
      || (record.scope === 'global' && (record.projectId || record.taskId)) || (record.scope === 'project' && record.taskId)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Knowledge scope requires matching ownership' });
  }
});

export interface RuntimeAdapter {
  readonly name: string;
  prepare(options: { projectRoot: string; outputDirectory: string }): Promise<{ profile: string; patch: string }>;
}
