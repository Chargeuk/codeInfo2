import { execSync } from 'child_process';
import path from 'path';
import { AfterAll, Before, setDefaultTimeout } from '@cucumber/cucumber';
import {
  DockerComposeEnvironment,
  StartedDockerComposeEnvironment,
  Wait,
} from 'testcontainers';
import {
  clearRootsCollection,
  clearVectorsCollection,
} from '../../ingest/chromaClient.js';
import {
  clearBootstrapTestEnvValue,
  setBootstrapTestEnvValue,
} from './processEnvIsolation.js';

let environment: StartedDockerComposeEnvironment | null = null;
let envPromise: Promise<StartedDockerComposeEnvironment | null> | null = null;
let activeChromaUrl: string | null = null;
let stopping = false;

if (process.env.TESTCONTAINERS_RYUK_DISABLED === undefined) {
  setBootstrapTestEnvValue('TESTCONTAINERS_RYUK_DISABLED', 'true');
}
if (process.env.TESTCONTAINERS_HOST_OVERRIDE === undefined) {
  setBootstrapTestEnvValue(
    'TESTCONTAINERS_HOST_OVERRIDE',
    'host.docker.internal',
  );
}

setDefaultTimeout(120_000);

async function hasReachableExternalChroma(baseUrl: string) {
  try {
    const response = await fetch(
      `${baseUrl.replace(/\/+$/, '')}/api/v2/heartbeat`,
    );
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureContainer() {
  const managedChromaUrl = 'http://host.docker.internal:8100';
  console.log(
    `[chroma-compose] ensureContainer invoked pid=${process.pid} env=${
      environment ? 'set' : 'null'
    } envPromise=${envPromise ? 'set' : 'null'}`,
  );
  console.log(
    `[chroma-compose] current CODEINFO_CHROMA_URL=${process.env.CODEINFO_CHROMA_URL ?? 'unset'}`,
  );
  if (environment && activeChromaUrl) {
    setBootstrapTestEnvValue('CODEINFO_CHROMA_URL', activeChromaUrl);
    return environment;
  }
  if (envPromise) {
    const env = await envPromise;
    if (activeChromaUrl) {
      setBootstrapTestEnvValue('CODEINFO_CHROMA_URL', activeChromaUrl);
    }
    return env;
  }

  const configuredChromaUrl = process.env.CODEINFO_CHROMA_URL?.trim();
  if (
    configuredChromaUrl &&
    (await hasReachableExternalChroma(configuredChromaUrl))
  ) {
    console.log(
      `[chroma-compose] using reachable preconfigured CODEINFO_CHROMA_URL=${configuredChromaUrl}`,
    );
    activeChromaUrl = configuredChromaUrl;
    setBootstrapTestEnvValue('CODEINFO_CHROMA_URL', configuredChromaUrl);
    envPromise = Promise.resolve(null);
    return envPromise;
  }

  const composeFile = 'docker-compose.chroma.yml';
  const composePath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '../compose',
  );

  const start = async () => {
    const startedAt = Date.now();
    console.log(
      `[chroma-compose] compose up starting (project will be auto-named) composeFile=${composeFile} cwd=${composePath}`,
    );

    const env = await new DockerComposeEnvironment(composePath, composeFile)
      // The Chroma image used in tests does not ship with curl/wget, so a
      // container-level healthcheck can be unreliable. Wait on the HTTP
      // heartbeat endpoint instead.
      .withWaitStrategy(
        'chroma-cucumber',
        Wait.forHttp('/api/v2/heartbeat', 8000).forStatusCode(200),
      )
      .withStartupTimeout(120_000)
      .up();

    console.log(
      `[chroma-compose] compose up resolved in ${Date.now() - startedAt}ms`,
    );

    try {
      const ps = execSync(
        "docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | head",
        { stdio: 'pipe' },
      )
        .toString()
        .trim();
      console.log('[chroma-compose] docker ps after up:\n' + ps);
    } catch (err) {
      console.error('[chroma-compose] docker ps after up failed', err);
    }

    // Set CODEINFO_CHROMA_URL directly to the mapped host:port (compose binds 8100->8000)
    activeChromaUrl = managedChromaUrl;
    setBootstrapTestEnvValue('CODEINFO_CHROMA_URL', managedChromaUrl);
    console.log(
      `[chroma-compose] CODEINFO_CHROMA_URL set to ${process.env.CODEINFO_CHROMA_URL}`,
    );

    environment = env;
    return env;
  };

  envPromise = start()
    .then((env) => {
      console.log('[chroma-compose] envPromise fulfilled');
      return env;
    })
    .catch((err) => {
      console.error('[chroma-compose] compose start failed', err);
      envPromise = null;
      throw err;
    });

  envPromise
    .then(() =>
      console.log('[chroma-compose] compose start promise resolved (cached)'),
    )
    .catch(() => {
      /* already logged above */
    });

  return envPromise;
}

Before({ timeout: 120_000 }, async () => {
  await ensureContainer();
  await clearVectorsCollection();
  await clearRootsCollection();
});

AfterAll({ timeout: 120_000 }, async () => {
  console.log(
    `[chroma-compose] AfterAll invoked pid=${process.pid} stopping=${stopping} env=${environment ? 'set' : 'null'}`,
  );
  if (stopping) return;
  stopping = true;
  if (!environment) return;
  console.log('[chroma-compose] AfterAll stopping environment');
  await environment.down();
  console.log('[chroma-compose] AfterAll environment stopped');
  environment = null;
  envPromise = null;
  activeChromaUrl = null;
  clearBootstrapTestEnvValue('CODEINFO_CHROMA_URL');
});

// Failsafe: ensure container stops even if Cucumber bails early
const gracefulShutdown = async () => {
  console.log(
    `[chroma-compose] gracefulShutdown invoked pid=${process.pid} stopping=${stopping} env=${environment ? 'set' : 'null'}`,
  );
  if (stopping) return;
  stopping = true;
  if (environment) {
    try {
      await environment.down();
    } catch (err) {
      console.warn('[chroma-compose] stop on exit failed', err);
    }
    environment = null;
    activeChromaUrl = null;
  }
  clearBootstrapTestEnvValue('CODEINFO_CHROMA_URL');
};

process.once('beforeExit', gracefulShutdown);
process.once('SIGINT', async () => {
  await gracefulShutdown();
  process.exit(130);
});
process.once('SIGTERM', async () => {
  await gracefulShutdown();
  process.exit(143);
});
process.once('uncaughtException', async (err) => {
  console.error(err);
  await gracefulShutdown();
  process.exit(1);
});
