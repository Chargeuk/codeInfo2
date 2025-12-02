/** Jest config compiled to CJS to avoid ts-node loader issues in Jest 30 */
/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'jest-environment-jsdom',
  testMatch: ['**/src/test/**/*.test.(ts|tsx)'],
  setupFilesAfterEnv: ['<rootDir>/src/test/setupTests.ts'],
  moduleNameMapper: {
    '@codeinfo2/common': '<rootDir>/../common/dist/index.js',
    '@mui/icons-material/(.*)$': '<rootDir>/src/test/__mocks__/muiIconMock.tsx',
  },
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { useESM: true }],
  },
};

module.exports = config;
