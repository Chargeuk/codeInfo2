import { After, Before } from '@cucumber/cucumber';

import {
  beginScopedTestEnvIsolation,
  endScopedTestEnvIsolation,
  installScopedProcessEnvProxy,
  installScopedTestEnvGlobals,
} from './processEnvIsolation.js';

installScopedProcessEnvProxy();
installScopedTestEnvGlobals();

Before(() => {
  beginScopedTestEnvIsolation();
});

After(() => {
  endScopedTestEnvIsolation();
});
