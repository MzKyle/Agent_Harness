import { expect, it } from 'vitest';
import { nativeExec } from '../../packages/codex-integration/src/events.js';
import { repo } from '../helpers.js';
it('retains bounded official failure categories without retaining provider error bodies', async () => {
  const body = { type: 'turn.failed', error: { code: 'rate_limit_exceeded', message: 'Quota exceeded: password=private-fixture-value https://private.invalid/callback' } };
  const script = `process.stdout.write(${JSON.stringify(JSON.stringify(body) + '\n')});process.exit(1)`;
  const result = await nativeExec(process.execPath, ['-e', script], repo, { PATH: process.env.PATH });
  expect(result.code).toBe(1); expect(result.completedTurns).toBe(0);
  expect(result.failures).toEqual([{ category: 'usage-or-rate-limit', code: 'rate_limit_exceeded' }]);
  expect(JSON.stringify(result)).not.toContain('private-fixture-value'); expect(JSON.stringify(result)).not.toContain('private.invalid');
});
