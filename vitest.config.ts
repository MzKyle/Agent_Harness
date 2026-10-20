import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['evals/**/*.test.ts'], exclude: ['evals/**/*.integration.test.ts'], testTimeout: 15000 } });
