import tseslint from 'typescript-eslint';
import pluginImport from 'eslint-plugin-import';

export default [
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: {
      import: pluginImport,
    },
    rules: {
      'import/order': [
        'warn',
        {
          alphabetize: { order: 'asc' },
        },
      ],
    },
  },
];
