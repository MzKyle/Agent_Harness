import { z } from 'zod';
import { projectSchema, relativePath } from '../schema.js';

export const idSchema = z.string().regex(/^(project|workspace|task|execution|diagnostic|plan|gap)-[a-f0-9]{16,32}$/);
export const projectRecordSchema = z.object({
  schemaVersion: z.literal(2), id: idSchema, root: z.string(), name: z.string(),
  authorization: z.literal('read-only'), rulesAllowed: z.boolean(), sourceSharing: z.enum(['local-only', 'fixture-only']),
  kind: z.enum(['external', 'fixture']), registeredAt: z.string().datetime(), config: projectSchema,
}).strict();
export type ProjectRecord = z.infer<typeof projectRecordSchema>;
export const workspaceSchema = z.object({
  schemaVersion: z.literal(2), id: idSchema, projectId: idSchema, sourceRevision: z.string().regex(/^[a-f0-9]{40,64}$/),
  baseline: z.string(), createdAt: z.string().datetime(),
  state: z.enum(['created', 'ready', 'running', 'succeeded', 'failed', 'blocked', 'cancelled']),
  included: z.number(), excluded: z.array(z.object({ path: z.string(), reason: z.string() })),
}).strict();
export type Workspace = z.infer<typeof workspaceSchema>;
export const approvedCommandSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_.-]{1,80}$/), workspaceId: idSchema,
  executable: z.enum(['node', 'python', 'python3', 'npm', 'pnpm', 'dotnet']),
  args: z.array(z.string().max(240)).max(24), cwd: relativePath,
  definitionHash: z.string(), approvedAt: z.string().datetime(), approvedBy: z.literal('human-cli'),
  timeoutMs: z.number().int().min(100).max(300000),
}).strict();
export type ApprovedCommand = z.infer<typeof approvedCommandSchema>;
export const evidenceSchema = z.object({
  schemaVersion: z.literal(2), id: idSchema, taskId: idSchema, workspaceId: idSchema, projectId: idSchema,
  sourceRevision: z.string(), workspaceRevision: z.string(), resultingRevision: z.string(), commandId: z.string(),
  command: z.object({ executable: z.string(), args: z.array(z.string()), cwd: z.string() }),
  startedAt: z.string().datetime(), finishedAt: z.string().datetime(), exitCode: z.number().int().nullable(),
  status: z.enum(['passed', 'failed', 'timeout', 'cancelled', 'blocked', 'stale']),
  isolation: z.enum(['verified-isolated', 'partial', 'unavailable']), reason: z.string().nullable(),
  image: z.string().nullable(), stdoutArtifact: z.string(), stderrArtifact: z.string(),
  stdoutHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), stderrHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  truncated: z.boolean(), signature: z.string(),
}).strict();
export type Evidence = z.infer<typeof evidenceSchema>;
export const planSchema = z.object({
  requirement: z.string().min(1).max(4000), facts: z.array(z.object({ source: z.string(), finding: z.string() }).strict()).min(1).max(40),
  assumptions: z.array(z.string()).max(20), affectedModules: z.array(relativePath).min(1).max(40),
  steps: z.array(z.object({ change: z.string(), verification: z.string() }).strict()).min(1).max(20),
  acceptance: z.array(z.string()).min(1).max(20),
  observability: z.object({ states: z.array(z.string()), logs: z.array(z.string()), correlationIds: z.array(z.string()),
    errorCodes: z.array(z.string()), recovery: z.string(), testEntry: z.string(), regressionRisks: z.array(z.string()),
    diagnosticTools: z.array(z.string()), sensitiveData: z.string(), overhead: z.string() }).strict(),
}).strict();
export const gapSchema = z.object({ gap: z.string(), why: z.string(), existingAlternative: z.string(),
  crossProject: z.boolean(), needsAdapter: z.boolean(), suggestion: z.string(), risks: z.array(z.string()), requiresApproval: z.boolean() }).strict();
export const taskSchema = z.object({
  schemaVersion: z.literal(2), id: idSchema, projectId: idSchema, workspaceId: idSchema.nullable(),
  mode: z.enum(['analysis', 'isolated', 'online-smoke']), prompt: z.string().max(12000),
  state: z.enum(['created', 'ready', 'running', 'succeeded', 'failed', 'blocked', 'cancelled']),
  reason: z.string().nullable(), createdAt: z.string(), finishedAt: z.string().nullable(),
  plan: planSchema.nullable(), evidenceIds: z.array(idSchema), gapIds: z.array(idSchema),
  toolCalls: z.number().int(), attempts: z.number().int(), maxAttempts: z.number().int().min(1).max(3),
  model: z.string().nullable(), modelCalls: z.number().int(), humanInterventions: z.number().int(),
}).strict();
export type Task = z.infer<typeof taskSchema>;
export class HarnessError extends Error {
  constructor(public readonly code: string, public readonly remedy = '') { super(code); }
}
