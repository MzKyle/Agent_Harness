import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'fixtures/**', '.dsh-local/**', '.devagent-state/**', '.devagent-evals/**'] },
  js.configs.recommended, ...tseslint.configs.recommended,
  { files: ['evals/**/*.mjs'], languageOptions: { globals: { process: 'readonly', AbortController: 'readonly' } } },
  { files: ['**/*.ts'], rules: { '@typescript-eslint/no-explicit-any': 'error' } }
);
