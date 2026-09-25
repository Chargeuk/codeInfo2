import { afterEach, beforeEach } from 'node:test';

import {
  beginScopedTestEnvIsolation,
  endScopedTestEnvIsolation,
  installScopedProcessEnvProxy,
  installScopedTestEnvGlobals,
} from './processEnvIsolation.js';

installScopedProcessEnvProxy();
installScopedTestEnvGlobals();

beforeEach(() => {
  beginScopedTestEnvIsolation({}, { persistentAcrossAsyncBoundaries: true });
});

afterEach(() => {
  endScopedTestEnvIsolation({ persistentAcrossAsyncBoundaries: true });
});
