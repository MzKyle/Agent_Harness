import { expect, it } from 'vitest';
import { intelligenceCommand } from '../../apps/cli/src/intelligence.js';
it('preserves V0.2 codex status while routing explicit project status to the daily native entry', () => {
  expect(intelligenceCommand(['codex', 'status', '--home', 'explicit-state'])).toBe(false);
  expect(intelligenceCommand(['codex', 'status', '--project', 'project-0000000000000000'])).toBe(true);
  expect(intelligenceCommand(['codex', 'status', '--project=project-0000000000000000'])).toBe(true);
  expect(intelligenceCommand(['codex', 'use', '--project', 'project-0000000000000000'])).toBe(true);
});
