import { z } from 'zod';
import { filterContent } from '../v2/content.js';
import { newId } from '../v2/store.js';
import { HarnessError } from '../v2/contracts.js';
import { IntelligenceData, now } from './data.js';
import { ProjectIdentities } from './identity.js';
import { memoryKinds, memorySchema, type MemoryRecord } from './contracts.js';

export const memoryInputSchema = z.object({
  domain: z.enum(['developer', 'project', 'knowledge', 'skills']), projectId: z.string().optional(),
  type: z.enum(memoryKinds), topic: z.string().min(1).max(160), content: z.string().min(1).max(2000),
  tags: z.array(z.string().min(1).max(64)).max(20).default([]),
}).strict();
export type MemoryInput = z.input<typeof memoryInputSchema>;
export function relevance(query: string, value: string) {
  const normalized = query.toLocaleLowerCase(); const haystack = value.toLocaleLowerCase();
  const tokens = normalized.match(/[a-z0-9_+#.-]{2,}|[\p{Script=Han}]/gu) ?? [];
  return tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0) + (normalized && haystack.includes(normalized) ? 5 : 0);
}
export class EngineeringMemory {
  constructor(readonly data: IntelligenceData, readonly identities: ProjectIdentities) {}
  private async normalized(input: unknown) {
    const parsed = memoryInputSchema.parse(input);
    const inspected = filterContent(`${parsed.topic}\n${parsed.content}`);
    if (inspected.redactions) throw new HarnessError('SENSITIVE_MEMORY_REFUSED');
    if (parsed.domain === 'project' && !parsed.projectId || parsed.domain === 'developer' && parsed.projectId) throw new HarnessError('MEMORY_SCOPE_MISMATCH');
    const owner = parsed.projectId ? (await this.identities.resolve(parsed.projectId)).stableProjectId : null;
    return { ...parsed, projectId: owner };
  }
  async set(input: MemoryInput) { return this.write(input, 'explicit'); }
  async propose(input: MemoryInput) { return this.write(input, 'inferred'); }
  private async write(input: unknown, source: 'explicit' | 'inferred') {
    const parsed = await this.normalized(input);
    return this.data.edit(data => {
      const sameScope = Object.values(data.memories).filter(record => record.domain === parsed.domain && record.projectId === parsed.projectId && record.type === parsed.type && record.topic.toLocaleLowerCase() === parsed.topic.toLocaleLowerCase() && !record.deprecated);
      const duplicate = sameScope.find(record => record.content === parsed.content && record.confirmation !== 'rejected');
      if (duplicate && (source !== 'explicit' || duplicate.confirmation === 'confirmed')) return { record: duplicate, duplicate: true };
      const previous = source === 'explicit' ? sameScope.find(record => record.confirmation === 'confirmed') : undefined;
      const timestamp = now();
      const record = memorySchema.parse({ ...parsed, id: previous?.id ?? newId('memory'), source,
        confirmation: source === 'explicit' ? 'confirmed' : 'candidate', freshness: 'current', trust: 'local',
        references: [{ kind: 'user', ref: source === 'explicit' ? 'explicit-human-cli-setting' : 'unconfirmed-agent-proposal' }],
        createdAt: previous?.createdAt ?? timestamp, updatedAt: timestamp, deprecated: false,
        version: (previous?.version ?? 0) + 1,
        history: previous ? [...previous.history, { version: previous.version, content: previous.content, confirmation: previous.confirmation, at: timestamp, action: 'explicit-update' }].slice(-50) : [],
      });
      data.memories[record.id] = record; return { record, duplicate: false };
    });
  }
  async get(id: string) {
    const record = (await this.data.read()).memories[id]; if (!record) throw new HarnessError('MEMORY_NOT_FOUND'); return record;
  }
  async review(id: string, decision: 'confirm' | 'reject') {
    return this.data.edit(data => {
      const record = data.memories[id]; if (!record) throw new HarnessError('MEMORY_NOT_FOUND');
      if (record.confirmation !== 'candidate') throw new HarnessError('MEMORY_ALREADY_REVIEWED');
      const timestamp = now();
      record.history.push({ version: record.version, content: record.content, confirmation: record.confirmation, at: timestamp, action: `human-${decision}` });
      record.history = record.history.slice(-50); record.version++; record.updatedAt = timestamp;
      record.confirmation = decision === 'confirm' ? 'confirmed' : 'rejected';
      if (decision === 'confirm') for (const other of Object.values(data.memories)) {
        if (other.id !== id && other.domain === record.domain && other.projectId === record.projectId && other.type === record.type && other.topic.toLocaleLowerCase() === record.topic.toLocaleLowerCase() && other.confirmation === 'confirmed' && !other.deprecated) {
          other.deprecated = true; other.updatedAt = timestamp;
          other.history = [...other.history, { version: other.version, content: other.content, confirmation: other.confirmation, at: timestamp, action: `superseded-by-${id}` }].slice(-50); other.version++;
        }
      }
      // Human confirmation does not turn an inference into verified engineering evidence.
      return record;
    });
  }
  async delete(id: string) {
    return this.data.edit(data => { if (!data.memories[id]) throw new HarnessError('MEMORY_NOT_FOUND'); delete data.memories[id]; return { id, deleted: true, historyDeleted: true }; });
  }
  async search(options: { domain?: MemoryRecord['domain']; projectId?: string; query?: string; types?: MemoryRecord['type'][]; includeCandidates?: boolean; includeDeprecated?: boolean; limit?: number }) {
    const owner = options.projectId ? (await this.identities.resolve(options.projectId)).stableProjectId : null;
    const records = Object.values((await this.data.read()).memories).filter(record =>
      (!options.domain || record.domain === options.domain) && (!options.types || options.types.includes(record.type)) && record.projectId === owner &&
      (options.includeCandidates || record.confirmation === 'confirmed') && (options.includeDeprecated || !record.deprecated));
    const ranked = records.map(record => ({ record, score: relevance(options.query ?? '', `${record.topic} ${record.content} ${record.tags.join(' ')}`) }))
      .filter(item => !options.query || item.score > 0).sort((a, b) => b.score - a.score || b.record.updatedAt.localeCompare(a.record.updatedAt));
    return { records: ranked.slice(0, Math.min(50, options.limit ?? 20)).map(item => item.record), truncated: ranked.length > Math.min(50, options.limit ?? 20), scope: owner ?? 'developer/global', trust: 'reviewed-context-not-permission' };
  }
  async history(id: string) { const record = await this.get(id); return { id, source: record.source, confirmation: record.confirmation, versions: record.history, current: record }; }
}
