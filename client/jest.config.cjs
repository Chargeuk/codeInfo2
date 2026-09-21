/** Jest config compiled to CJS to avoid ts-node loader issues in Jest 30 */
/** @type {import('jest').Config} */
const configuredTestTimeout = Number.parseInt(
  process.env.CODEINFO_CLIENT_TEST_TIMEOUT_MS ?? '',
  10,
);
const testTimeout =
  Number.isSafeInteger(configuredTestTimeout) && configuredTestTimeout > 0
    ? configuredTestTimeout
    : 20_000;

const config = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'jest-environment-jsdom',
  // Keep the full client suite on the stable worker shape that preserves
  // shared websocket/browser harness isolation on this repo.
  maxWorkers: 1,
  testTimeout,
  testMatch: [
    '**/src/test/**/*.test.(ts|tsx)',
    '**/src/components/**/*.test.(ts|tsx)',
  ],
  setupFilesAfterEnv: ['<rootDir>/src/test/setupTests.ts'],
  moduleNameMapper: {
    '@codeinfo2/common': '<rootDir>/../common/dist/index.js',
    '@mui/icons-material/(.*)$': '<rootDir>/src/test/__mocks__/muiIconMock.tsx',
    '\\.(svg|png|jpe?g|gif|webp)$': '<rootDir>/src/test/__mocks__/fileMock.ts',
  },
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { useESM: true }],
  },
};

module.exports = config;
