import { AfterAll } from '@cucumber/cucumber';

import {
  beginScopedTestEnvIsolation,
  endScopedTestEnvIsolation,
  installScopedProcessEnvProxy,
  installScopedTestEnvGlobals,
} from './processEnvIsolation.js';

installScopedProcessEnvProxy();
installScopedTestEnvGlobals();
beginScopedTestEnvIsolation();

AfterAll(() => {
  endScopedTestEnvIsolation();
});
