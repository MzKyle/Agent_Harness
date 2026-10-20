import { z } from 'zod';
import { entityId, projectId, sha } from './contracts.js';
import { engineeringFile } from './files.js';
export const changeSchema = z.object({
  path: z.string().refine(engineeringFile), beforeHash: sha.nullable(), before: z.string().max(65536).nullable(), after: z.string().max(65536),
  reason: z.string().max(1000), benefit: z.string().max(1000), risk: z.string().max(1000),
}).strict();
export type EngineeringChange = z.infer<typeof changeSchema>;
export const onboardingSchema = z.object({
  schemaVersion: z.literal(1), id: entityId('onboard'), projectId, legacyProjectId: projectId,
  sourceRevision: z.string().regex(/^[a-f0-9]{40,64}$/), sourceDigest: sha, sourceBranch: z.string().max(200),
  createdAt: z.string().datetime(), state: z.enum(['proposed', 'approved', 'applied', 'verified', 'rejected', 'failed']),
  changes: z.array(changeSchema).max(6), blocked: z.array(z.string().max(1000)).max(20), reused: z.array(z.string().max(240)).max(40),
  unifiedDiff: z.string().max(512000), diffHash: sha,
  application: z.object({ target: z.enum(['workspace', 'project']), workspaceId: entityId('workspace').nullable(), root: z.string(), at: z.string().datetime() }).strict().nullable(),
}).strict();
export type OnboardingPlan = z.infer<typeof onboardingSchema>;
export const provisioningGrantSchema = z.object({
  id: entityId('grant'), planId: entityId('onboard'), projectId, legacyProjectId: projectId, revision: z.string(),
  diffHash: sha, files: z.array(z.object({ path: z.string().refine(engineeringFile), beforeHash: sha.nullable(), afterHash: sha }).strict()).max(6),
  target: z.enum(['workspace', 'project']), branch: z.string(), root: z.string(), approvedBy: z.literal('human-cli'),
  approvedAt: z.string().datetime(), expiresAt: z.string().datetime(), usedAt: z.string().datetime().nullable(),
}).strict();
export type ProvisioningGrant = z.infer<typeof provisioningGrantSchema>;
export function unifiedDiff(file: string, before: string | null, after: string) {
  if (before === after) return '';
  const lines = (value: string) => value ? value.replace(/\n$/, '').split('\n').map((text, index, all) => ({ text, newline: index < all.length - 1 || value.endsWith('\n') })) : [];
  const same = (left: { text: string; newline: boolean }, right: { text: string; newline: boolean }) => left.text === right.text && left.newline === right.newline;
  const old = lines(before ?? ''); const next = lines(after); let prefix = 0; let suffix = 0;
  while (prefix < old.length && prefix < next.length && same(old[prefix]!, next[prefix]!)) prefix++;
  while (suffix < old.length - prefix && suffix < next.length - prefix && same(old[old.length - 1 - suffix]!, next[next.length - 1 - suffix]!)) suffix++;
  const contextBefore = Math.min(prefix, 3); const contextAfter = Math.min(suffix, 3);
  const start = prefix - contextBefore;
  const oldEnd = old.length - suffix; const nextEnd = next.length - suffix;
  const render = (prefix: string) => (line: { text: string; newline: boolean }) => [`${prefix}${line.text}`, ...line.newline ? [] : ['\\ No newline at end of file']];
  const body = [...old.slice(start, prefix).flatMap(render(' ')), ...old.slice(prefix, oldEnd).flatMap(render('-')),
    ...next.slice(prefix, nextEnd).flatMap(render('+')), ...old.slice(oldEnd, oldEnd + contextAfter).flatMap(render(' '))];
  return `diff --git a/${file} b/${file}\n--- ${before === null ? '/dev/null' : `a/${file}`}\n+++ b/${file}\n@@ -${old.length ? start + 1 : 0},${oldEnd - start + contextAfter} +${next.length ? start + 1 : 0},${nextEnd - start + contextAfter} @@\n${body.join('\n')}\n`;
}
