import { Before } from '@cucumber/cucumber';

import {
  beginScopedTestEnvIsolation,
  installScopedProcessEnvProxy,
  installScopedTestEnvGlobals,
} from './processEnvIsolation.js';

installScopedProcessEnvProxy();
installScopedTestEnvGlobals();

Before(() => {
  beginScopedTestEnvIsolation();
});
