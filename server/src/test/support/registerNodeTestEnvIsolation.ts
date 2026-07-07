import { beforeEach } from 'node:test';

import {
  beginScopedTestEnvIsolation,
  installScopedProcessEnvProxy,
} from './processEnvIsolation.js';

installScopedProcessEnvProxy();

beforeEach(() => {
  beginScopedTestEnvIsolation();
});
