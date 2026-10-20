import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['evals/**/*.integration.test.ts'], testTimeout: 45000, hookTimeout: 45000, fileParallelism: false } });
