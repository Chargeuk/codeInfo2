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

let environment: StartedDockerComposeEnvironment | null = null;
let envPromise: Promise<StartedDockerComposeEnvironment> | null = null;
let stopping = false;

setDefaultTimeout(120_000);

async function ensureContainer() {
  console.log(
    `[chroma-compose] ensureContainer invoked pid=${process.pid} env=${
      environment ? 'set' : 'null'
    } envPromise=${envPromise ? 'set' : 'null'}`,
  );
  console.log(
    `[chroma-compose] current CHROMA_URL=${process.env.CHROMA_URL ?? 'unset'}`,
  );
  if (environment) return environment;
  if (envPromise) return envPromise;

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
      .withWaitStrategy('chroma', Wait.forHealthCheck())
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

    // Set CHROMA_URL directly to the mapped host:port (compose binds 8100->8000)
    process.env.CHROMA_URL = 'http://host.docker.internal:8100';
    console.log(`[chroma-compose] CHROMA_URL set to ${process.env.CHROMA_URL}`);

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

Before(async () => {
  await ensureContainer();
  await clearVectorsCollection();
  await clearRootsCollection();
});

AfterAll(async () => {
  if (stopping) return;
  stopping = true;
  if (!environment) return;
  console.log('[chroma-compose] AfterAll stopping environment');
  await environment.down();
  console.log('[chroma-compose] AfterAll environment stopped');
  environment = null;
  envPromise = null;
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
  }
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
