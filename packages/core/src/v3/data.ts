import type { z } from 'zod';
import { StateStore, newId, digest } from '../v2/store.js';
import { HarnessError } from '../v2/contracts.js';
import { portableSchema, bindingsSchema, type PortableData, type LocalBindings } from './contracts.js';

export const canonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) =>
  item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
export const now = () => new Date().toISOString();
export class IntelligenceData {
  constructor(readonly store: StateStore) {}
  async signed<T>(file: string, schema: z.ZodType<T>): Promise<T> {
    const envelope = await this.store.get<{ payload: unknown; signature: string }>(file);
    if (!await this.store.verify(canonical(envelope.payload), envelope.signature)) throw new HarnessError('INTELLIGENCE_INTEGRITY_FAILED');
    return schema.parse(envelope.payload);
  }
  async writeSigned<T>(file: string, value: T) {
    await this.store.put(file, { payload: value, signature: await this.store.sign(canonical(value)) });
  }
  async initialize() {
    await this.store.directory('intelligence');
    await this.store.locked('intelligence', async () => {
      try { await this.read(); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        await this.writeSigned('intelligence/portable.json', portableSchema.parse({ schemaVersion: 3, revision: 0, identities: {}, memories: {}, profiles: {}, contracts: {}, summaries: {}, proposals: {}, skillPreferences: {} }));
      }
      try { await this.bindings(); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        await this.writeSigned('intelligence/local.json', { schemaVersion: 3, machineId: newId('machine'), active: {} });
      }
    });
  }
  async read(): Promise<PortableData> { return this.signed('intelligence/portable.json', portableSchema); }
  async bindings(): Promise<LocalBindings> { return this.signed('intelligence/local.json', bindingsSchema); }
  async edit<T>(action: (data: PortableData) => T | Promise<T>): Promise<T> {
    return this.store.locked('intelligence', async () => {
      const data = await this.read(); const before = canonical(data); const result = await action(data);
      if (canonical(data) === before) return result;
      data.revision++;
      const validated = portableSchema.parse(data);
      if (Buffer.byteLength(canonical(validated)) > 3 * 1024 * 1024 || Object.keys(validated.memories).length > 1500 || Object.keys(validated.summaries).length > 500) throw new HarnessError('INTELLIGENCE_RETENTION_LIMIT');
      await this.writeSigned('intelligence/portable.json', validated); return result;
    });
  }
  async bind(projectId: string, value: LocalBindings['active'][string]) {
    return this.store.locked('intelligence-bindings', async () => {
      const bindings = await this.bindings(); bindings.active[projectId] = value;
      await this.writeSigned('intelligence/local.json', bindingsSchema.parse(bindings));
    });
  }
  async hash() { return digest(canonical(await this.read())); }
}
