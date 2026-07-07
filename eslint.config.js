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
  {
    files: [
      'server/src/test/**/*.{ts,tsx,mjs,js}',
      'client/src/test/**/*.{ts,tsx,mjs,js}',
    ],
    ignores: [
      'server/src/test/support/processEnvIsolation.ts',
      'client/src/test/support/processEnvIsolation.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "AssignmentExpression[left.type='MemberExpression'][left.object.type='MemberExpression'][left.object.object.name='process'][left.object.property.name='env']",
          message:
            'Use scoped test env helpers instead of writing process.env directly in tests.',
        },
        {
          selector:
            "AssignmentExpression[left.type='MemberExpression'][left.object.name='process'][left.property.name='env']",
          message:
            'Use replaceScopedTestProcessEnv instead of replacing process.env directly in tests.',
        },
        {
          selector:
            "UnaryExpression[operator='delete'][argument.type='MemberExpression'][argument.object.type='MemberExpression'][argument.object.object.name='process'][argument.object.property.name='env']",
          message:
            'Use clearScopedTestEnvValue instead of deleting process.env keys directly in tests.',
        },
      ],
    },
  },
]);
