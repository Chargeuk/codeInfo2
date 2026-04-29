import { includeIgnoreFile } from '@eslint/compat';
import { defineConfig } from 'eslint/config';
import pluginImport from 'eslint-plugin-import';
import reactHooks from 'eslint-plugin-react-hooks';
import { fileURLToPath } from 'node:url';
import tseslint from 'typescript-eslint';

const gitignorePath = fileURLToPath(new URL('.gitignore', import.meta.url));

export default defineConfig([
  includeIgnoreFile(gitignorePath, 'Repository .gitignore patterns'),
  {
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: {
      import: pluginImport,
      'react-hooks': reactHooks,
    },
    rules: {
      'import/order': [
        'warn',
        {
          alphabetize: { order: 'asc' },
        },
      ],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);
