import { z } from 'zod';
import { entityId, projectId, sha } from '../v3/contracts.js';
import { portableFile } from '../v2/content.js';

export const workId = entityId('work');
export const observedPath = z.string().max(240).refine(value => { try { portableFile(value); return true; } catch { return false; } });
export const snapshotSchema = z.object({ revision: z.string().regex(/^[a-f0-9]{40,64}$/), sourceDigest: sha, statusHash: sha, clean: z.boolean(), complete: z.boolean(), files: z.record(observedPath, sha) }).strict();
export const lifecycleNames = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'SessionEnd', 'Interrupt'] as const;
export const workEventSchema = z.object({ id: sha, workId, taskId: entityId('task'), projectId, name: z.enum(lifecycleNames),
  source: z.enum(['hook', 'native-event', 'operator']), threadId: z.string().max(120).nullable(), turnId: z.string().max(120).nullable(),
  executionSessionId: entityId('native-session').optional(),
  tool: z.string().max(120).nullable(), status: z.enum(['observed', 'completed', 'failed', 'interrupted']), at: z.string().datetime(),
  dedupe: z.enum(['exact', 'coarse']), authority: z.literal('observation-only') }).strict();
export type WorkEvent = z.infer<typeof workEventSchema>;
export const workSchema = z.object({ schemaVersion: z.literal(4), id: workId, projectId, taskId: entityId('task'), taskIds: z.array(entityId('task')).min(1).max(30),
  goal: z.string().min(1).max(1000), state: z.enum(['started', 'active', 'completed', 'interrupted']),
  engineeringOutcome: z.enum(['no-change', 'changed', 'tested', 'verified', 'failed', 'blocked', 'incomplete']).default('incomplete'),
  evidenceStatus: z.enum(['none', 'pending', 'valid', 'stale', 'invalid']).default('none'),
  lastVerifiedRevision: sha.nullable().default(null),
  mode: z.enum(['external-observation', 'managed-workspace']), workspaceId: entityId('workspace').nullable(), sourceRoot: z.string().max(1000), bindingId: projectId,
  startedAt: z.string().datetime(), updatedAt: z.string().datetime(), checkpointAt: z.string().datetime().nullable(), finalizedAt: z.string().datetime().nullable(),
  before: snapshotSchema, current: snapshotSchema, threadIds: z.array(z.string().max(120)).max(30), turnIds: z.array(z.string().max(120)).max(100),
  sourceBaseline: snapshotSchema.nullable().default(null),
  eventIds: z.array(sha).max(500), leaseId: entityId('lease'), candidateIds: z.array(entityId('memory')).max(100),
  decisions: z.array(z.string().max(1000)).max(20), outstanding: z.array(z.string().max(1000)).max(20),
  outcome: z.object({ changed: z.array(observedPath).max(1000), tested: z.array(z.string().max(100)).max(20), verified: z.array(z.string().max(100)).max(20),
    failed: z.array(z.string().max(100)).max(20), blocked: z.array(z.string().max(200)).max(20), incomplete: z.array(z.string().max(200)).max(20), evidenceIds: z.array(entityId('execution')).max(20) }).strict(),
  capturePolicy: z.literal('explicit-project-session-metadata-only'), authority: z.literal('none') }).strict();
export type WorkSession = z.infer<typeof workSchema>;
export const leaseSchema = z.object({ id: entityId('lease'), workId, projectId, taskId: entityId('task'), createdAt: z.string().datetime(), revoked: z.boolean() }).strict();
