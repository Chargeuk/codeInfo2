import { beforeEach } from 'node:test';

import {
  beginScopedTestEnvIsolation,
  installScopedProcessEnvProxy,
  installScopedTestEnvGlobals,
} from './processEnvIsolation.js';

installScopedProcessEnvProxy();
installScopedTestEnvGlobals();

beforeEach(() => {
  beginScopedTestEnvIsolation();
});
