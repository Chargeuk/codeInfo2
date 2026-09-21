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
  beginScopedTestEnvIsolation({}, { persistentAcrossAsyncBoundaries: true });
});

After(() => {
  endScopedTestEnvIsolation({ persistentAcrossAsyncBoundaries: true });
});
