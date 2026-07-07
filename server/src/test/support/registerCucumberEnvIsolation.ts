import { Before } from '@cucumber/cucumber';

import {
  beginScopedTestEnvIsolation,
  installScopedProcessEnvProxy,
} from './processEnvIsolation.js';

installScopedProcessEnvProxy();

Before(() => {
  beginScopedTestEnvIsolation();
});
