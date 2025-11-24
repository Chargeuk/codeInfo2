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
  if (environment) return environment;
  if (envPromise) return envPromise;

  const composeFile = 'docker-compose.chroma.yml';
  const composePath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '../compose',
  );

  const start = async () => {
    const env = await new DockerComposeEnvironment(composePath, composeFile)
      .withWaitStrategy('chroma', Wait.forHttp('/api/v1/heartbeat', 8000))
      .withStartupTimeout(120_000)
      .up();

    const chroma = env.getContainer('chroma');
    const host = chroma.getHost();
    const port = chroma.getMappedPort(8000) || 8100;
    process.env.CHROMA_URL = `http://${host}:${port}`;
    console.log(`[chroma-compose] started at ${process.env.CHROMA_URL}`);
    console.log('[chroma-compose] compose project up');

    environment = env;
    return env;
  };

  envPromise = start().catch((err) => {
    envPromise = null;
    throw err;
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
  await environment.down();
  environment = null;
  envPromise = null;
});

// Failsafe: ensure container stops even if Cucumber bails early
const gracefulShutdown = async () => {
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
