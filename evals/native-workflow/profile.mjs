import { parseArgs } from 'node:util';
import path from 'node:path';
import console from 'node:console';
import { engineeringSystem } from '../../packages/adapters/dist/index.js';
import { CodexNativeIntegration, runNativeWork } from '../../packages/codex-integration/dist/index.js';
const { values } = parseArgs({ options: { home: { type: 'string' }, 'auth-attachment': { type: 'string' } } });
if (!values.home || !values['auth-attachment']) throw new Error('Explicit dedicated fixture state and authentication reference required');
const s = await engineeringSystem(path.resolve(values.home)); const previous = await s.store.get('reports/native-workflow-latest.json');
const topic = 'Synthetic fixture reporting preference';
if (Object.values((await s.intelligence.read()).memories).some(item => item.domain === 'developer' && item.topic !== topic)) throw new Error('PROFILE_EVAL_REQUIRES_FIXTURE_ONLY_PROFILE_STATE');
const preference = await s.memory.set({ domain: 'developer', type: 'engineering-preference', topic, content: 'For fixture engineering reports use section identifiers machine-verification and human-review. Keep observed runtime findings separate from verified tests.' });
const native = new CodexNativeIntegration(s.store, s.registry, s.identities, s.workspaces, s.tasks);
const attachment = await native.attach(previous.projectId, { workspaceId: previous.workspaceId, authFrom: values['auth-attachment'], includePreferences: true });
const result = await runNativeWork(native, s.work, attachment.id, 'Use the relevant developer reporting preference to report the existing runtime work. Return only JSON {sections:string[],realProjectVerified:boolean}. Use the exact section identifiers from the stored preference. Do not claim real ALS verification from fixture tests. Do not edit files or execute commands.', { answerOracle: text => {
  try { const value = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')); return value.realProjectVerified === false && Array.isArray(value.sections) && value.sections.includes('machine-verification') && value.sections.includes('human-review'); } catch { return false; }
} });
await s.store.put('reports/native-profile-latest.json', { ...result, syntheticPreferenceId: preference.record.id, personalUserDataShared: false });
console.log(JSON.stringify(result, null, 2)); process.exitCode = result.status === 'passed' ? 0 : 2;
