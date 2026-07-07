import { AfterAll, Before } from '@cucumber/cucumber';
import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from 'testcontainers';
import {
  connectMongo,
  disconnectMongo,
  isMongoConnected,
} from '../../mongo/connection.js';
import { IngestFileModel } from '../../mongo/ingestFile.js';
import {
  clearBootstrapTestEnvValue,
  setBootstrapTestEnvValue,
} from './processEnvIsolation.js';

let container: StartedTestContainer | null = null;
let containerPromise: Promise<StartedTestContainer> | null = null;
let stopping = false;
const localMongoImage = process.env.CODEINFO_LOCAL_MONGO_IMAGE ?? 'mongo:8.2.9';
const mongoBootstrapRetryDelaysMs = [0, 500, 1_000];

if (process.env.TESTCONTAINERS_RYUK_DISABLED === undefined) {
  setBootstrapTestEnvValue('TESTCONTAINERS_RYUK_DISABLED', 'true');
}
if (process.env.TESTCONTAINERS_HOST_OVERRIDE === undefined) {
  setBootstrapTestEnvValue(
    'TESTCONTAINERS_HOST_OVERRIDE',
    'host.docker.internal',
  );
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const formatErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const isRetryableMongoBootstrapError = (error: unknown) => {
  const message = formatErrorMessage(error);

  return [
    /No host port found for host IP/i,
    /ECONNREFUSED/i,
    /MongoServerSelectionError/i,
    /Server selection timed out/i,
    /timed out waiting/i,
  ].some((pattern) => pattern.test(message));
};

async function resetMongoContainerState(reason: string) {
  try {
    if (isMongoConnected()) {
      await disconnectMongo();
    }
  } catch (error) {
    console.warn(
      `[mongo-test] disconnect during reset failed reason=${reason} message="${formatErrorMessage(
        error,
      )}"`,
    );
  }

  if (container) {
    try {
      await container.stop();
    } catch (error) {
      console.warn(
        `[mongo-test] container stop during reset failed reason=${reason} message="${formatErrorMessage(
          error,
        )}"`,
      );
    }
  }

  container = null;
  containerPromise = null;
}

async function ensureMongoContainer() {
  if (container) return container;
  if (containerPromise) return containerPromise;

  const start = async () => {
    const started = await new GenericContainer(localMongoImage)
      .withExposedPorts(27017)
      .withWaitStrategy(Wait.forLogMessage(/Waiting for connections/))
      .withStartupTimeout(120_000)
      .start();
    container = started;
    return started;
  };

  containerPromise = start().catch((err) => {
    containerPromise = null;
    throw err;
  });

  return containerPromise;
}

async function connectScenarioMongo() {
  const configuredMongoUri = process.env.CODEINFO_MONGO_URI?.trim();
  if (configuredMongoUri) {
    await connectMongo(configuredMongoUri);
    await IngestFileModel.deleteMany({}).exec();
    return;
  }

  const maxAttempts = mongoBootstrapRetryDelaysMs.length;
  let lastError: unknown = null;

  for (let index = 0; index < maxAttempts; index += 1) {
    const attempt = index + 1;
    let stage = 'start_container';

    try {
      if (index > 0) {
        const delayMs = mongoBootstrapRetryDelaysMs[index];
        console.log(
          `[mongo-test] retrying local mongo bootstrap attempt=${attempt}/${maxAttempts} delay_ms=${delayMs}`,
        );
        await wait(delayMs);
      }

      const started = await ensureMongoContainer();
      stage = 'resolve_mapped_port';
      const host = started.getHost();
      const port = started.getMappedPort(27017);
      const uri = `mongodb://${host}:${port}/db?directConnection=true`;
      setBootstrapTestEnvValue('CODEINFO_MONGO_URI', uri);

      stage = 'connect';
      await connectMongo(uri);
      stage = 'cleanup_collection';
      await IngestFileModel.deleteMany({}).exec();
      return;
    } catch (error) {
      lastError = error;
      const retryable = isRetryableMongoBootstrapError(error);
      if (attempt >= maxAttempts || !retryable) {
        await resetMongoContainerState(`failed-${attempt}`);
        throw error;
      }

      console.warn(
        `[mongo-test] transient local mongo bootstrap failure attempt=${attempt}/${maxAttempts} stage=${stage} message="${formatErrorMessage(
          error,
        )}"`,
      );
      await resetMongoContainerState(`retry-${attempt}`);
    }
  }

  throw lastError;
}

Before({ tags: '@no_mongo' }, async () => {
  if (!isMongoConnected()) return;
  try {
    await disconnectMongo();
  } catch {
    // ignore
  }
});

Before({ tags: 'not @no_mongo' }, async () => {
  await connectScenarioMongo();
});

AfterAll(async () => {
  if (stopping) return;
  stopping = true;
  await resetMongoContainerState('after-all');
  clearBootstrapTestEnvValue('CODEINFO_MONGO_URI');
});
