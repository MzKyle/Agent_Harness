import { z } from 'zod';
import { relativePath, projectSchema } from '../schema.js';

export const projectId = z.string().regex(/^project-[a-f0-9]{16}$/);
export const entityId = (kind: string) => z.string().regex(new RegExp(`^${kind}-[a-f0-9]{32}$`));
export const sha = z.string().regex(/^[a-f0-9]{64}$/);
const commit = z.string().regex(/^[a-f0-9]{40,64}$/);
const text = z.string().min(1).max(2000);
const evidencePath = z.union([relativePath, z.string().regex(/^(?:\.agents\/skills\/[a-z0-9-]{1,64}\/SKILL\.md|\.codex\/config\.toml)$/)]);
export const referenceSchema = z.object({
  kind: z.enum(['user', 'file', 'git', 'task', 'evidence', 'import']),
  ref: z.string().max(240), path: evidencePath.optional(), line: z.number().int().positive().optional(),
  revision: commit.optional(),
}).strict();
export const memoryKinds = ['technical-background', 'engineering-preference', 'ai-preference', 'purpose', 'architecture', 'workflow', 'constraint', 'goal', 'issue', 'decision', 'knowledge', 'skill-preference', 'task-summary'] as const;
const memoryVersion = z.object({
  version: z.number().int().positive(), content: text,
  confirmation: z.enum(['candidate', 'confirmed', 'rejected']),
  at: z.string().datetime(), action: z.string().max(80),
}).strict();
export const memorySchema = z.object({
  id: entityId('memory'), domain: z.enum(['developer', 'project', 'knowledge', 'skills']),
  projectId: projectId.nullable(), type: z.enum(memoryKinds), topic: z.string().min(1).max(160), content: text,
  tags: z.array(z.string().min(1).max(64)).max(20),
  source: z.enum(['explicit', 'observed', 'inferred', 'verified']),
  confirmation: z.enum(['candidate', 'confirmed', 'rejected']),
  freshness: z.enum(['current', 'stale', 'conflicted']), trust: z.enum(['local', 'imported']),
  references: z.array(referenceSchema).max(20), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  deprecated: z.boolean(), version: z.number().int().positive(), history: z.array(memoryVersion).max(50),
}).strict();
export type MemoryRecord = z.infer<typeof memorySchema>;
export const identitySchema = z.object({
  stableProjectId: projectId, projectName: z.string().min(1).max(96),
  repositoryIdentity: z.string().max(400).regex(/^[a-z0-9.-]+(?::[0-9]+)?\/[A-Za-z0-9_./-]+$/i).refine(value => !value.includes('..')).nullable(), registeredAt: z.string().datetime(),
  aliases: z.array(projectId).max(100), observedCommits: z.array(commit).max(100),
  duplicateCandidates: z.array(projectId).max(30),
}).strict();
export type ProjectIdentity = z.infer<typeof identitySchema>;
export const factSchema = z.object({
  key: z.string().min(1).max(160), statement: text,
  status: z.enum(['source-confirmed', 'configuration-declared', 'task-proven', 'user-provided', 'inferred', 'unknown', 'stale', 'conflicted']),
  references: z.array(referenceSchema).max(20), collectedAt: z.string().datetime(),
}).strict();
export type ProjectFact = z.infer<typeof factSchema>;
export const projectProfileSchema = z.object({
  schemaVersion: z.literal(3), projectId, revision: commit, sourceDigest: sha, generatedAt: z.string().datetime(),
  generation: z.number().int().positive(), facts: z.array(factSchema).max(250), history: z.array(factSchema).max(500),
  stack: projectSchema, uncertainty: z.array(z.string().max(1000)).max(30),
}).strict();
export type ProjectProfile = z.infer<typeof projectProfileSchema>;
export const capabilityStatus = z.enum(['discovered', 'configured', 'verified', 'unavailable', 'unsupported', 'forbidden']);
export const contractSchema = z.object({
  schemaVersion: z.literal(1), projectId, assessedAt: z.string().datetime(), sourceRevision: commit,
  entries: z.array(z.object({ id: z.string().regex(/^[a-z0-9-]{1,80}$/), status: capabilityStatus,
    detail: z.string().max(1000), references: z.array(referenceSchema).max(20), workspaceId: entityId('workspace').nullable(), workspaceRevision: sha.nullable() }).strict()).max(100),
  requiredChecks: z.array(z.string().max(160)).max(50), evidencePolicy: z.literal('final-revision'),
  sourceIntegrityCheck: z.literal(true), permissionAuthority: z.literal('none'), memoryReviewRequired: z.literal(true),
}).strict();
export type ProjectContract = z.infer<typeof contractSchema>;
export const taskSummarySchema = z.object({
  taskId: entityId('task'), projectId, requirement: z.string().max(2000), at: z.string().datetime(),
  state: z.string().max(32), modified: z.array(evidencePath).max(100), tested: z.array(z.string().max(100)).max(20),
  verified: z.array(z.string().max(100)).max(20), failed: z.array(z.string().max(100)).max(20), blocked: z.array(z.string().max(200)).max(20),
  incomplete: z.array(z.string().max(200)).max(20), evidenceIds: z.array(entityId('execution')).max(20),
  evidenceTrust: z.enum(['local-verified', 'local-unverified', 'historical-unverified']),
  sourceRevision: commit.nullable(), workspaceRevision: sha.nullable(), modelCalls: z.number().int().nonnegative(),
}).strict();
export type TaskSummary = z.infer<typeof taskSummarySchema>;
export const proposalSchema = z.object({
  id: entityId('proposal'), projectId, fingerprint: sha, category: z.enum(['perception', 'diagnostics', 'verification', 'workflow', 'adapter']),
  gapIds: z.array(entityId('gap')).max(100), taskIds: z.array(entityId('task')).max(100),
  title: z.string().max(200), why: text, alternative: text, suggestion: text, risks: z.array(text).max(20), crossProject: z.boolean(),
  state: z.enum(['proposed', 'approved', 'implemented', 'verified', 'adopted', 'deprecated']),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  workspaceId: entityId('workspace').nullable(), workspaceRevision: sha.nullable(), evidenceId: entityId('execution').nullable(),
  invocationCommandId: z.string().regex(/^[a-zA-Z0-9_.-]{1,80}$/).nullable(),
  history: z.array(z.object({ state: z.string(), at: z.string().datetime(), actor: z.enum(['tool', 'human-cli']) }).strict()).max(30),
}).strict();
export type CapabilityProposal = z.infer<typeof proposalSchema>;
export const portableSchema = z.object({
  schemaVersion: z.literal(3), revision: z.number().int().nonnegative(),
  identities: z.record(projectId, identitySchema), memories: z.record(entityId('memory'), memorySchema),
  profiles: z.record(projectId, projectProfileSchema), contracts: z.record(projectId, contractSchema),
  summaries: z.record(entityId('task'), taskSummarySchema), proposals: z.record(entityId('proposal'), proposalSchema),
  skillPreferences: z.record(z.string().regex(/^[a-z0-9-]{1,64}$/), z.boolean()),
}).strict().superRefine((data, context) => {
  const fail = (path: string[]) => context.addIssue({ code: z.ZodIssueCode.custom, message: 'Portable identity/reference mismatch', path });
  for (const [key, value] of Object.entries(data.identities)) {
    if (key !== value.stableProjectId) fail(['identities', key]);
    if (value.aliases.some(alias => alias in data.identities && alias !== key)) fail(['identities', key, 'aliases']);
    if (Object.values(data.identities).some(other => other !== value && other.aliases.some(alias => value.aliases.includes(alias)))) fail(['identities', key, 'aliases']);
  }
  for (const category of ['profiles', 'contracts', 'memories', 'summaries', 'proposals'] as const) {
    for (const [key, value] of Object.entries(data[category])) {
      const id = 'id' in value ? value.id : 'taskId' in value ? value.taskId : value.projectId;
      if (id !== key || value.projectId !== null && !(value.projectId in data.identities)) fail([category, key]);
    }
  }
});
export type PortableData = z.infer<typeof portableSchema>;
export const bindingsSchema = z.object({
  schemaVersion: z.literal(3), machineId: entityId('machine'),
  active: z.record(projectId, z.object({ legacyId: projectId, root: z.string().max(1000), boundAt: z.string().datetime() }).strict()),
}).strict();
export type LocalBindings = z.infer<typeof bindingsSchema>;
