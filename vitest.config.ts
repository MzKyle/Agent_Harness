import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({ resolve: { alias: { '@devagent/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)), '@devagent/adapters': fileURLToPath(new URL('./packages/adapters/src/index.ts', import.meta.url)) } }, test: { include: ['evals/**/*.test.ts'], exclude: ['evals/**/*.integration.test.ts'], testTimeout: 15000 } });
