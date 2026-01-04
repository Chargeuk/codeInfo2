import { AfterAll, Before } from '@cucumber/cucumber';
import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from 'testcontainers';
import { IngestFileModel } from '../../mongo/ingestFile.js';
import {
  connectMongo,
  disconnectMongo,
  isMongoConnected,
} from '../../mongo/connection.js';

let container: StartedTestContainer | null = null;
let containerPromise: Promise<StartedTestContainer> | null = null;
let stopping = false;

process.env.TESTCONTAINERS_RYUK_DISABLED ??= 'true';
process.env.TESTCONTAINERS_HOST_OVERRIDE ??= 'host.docker.internal';

async function ensureMongoContainer() {
  if (container) return container;
  if (containerPromise) return containerPromise;

  const start = async () => {
    const started = await new GenericContainer('mongo:8')
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

Before({ tags: 'not @mongo' }, async () => {
  if (!isMongoConnected()) return;
  try {
    await disconnectMongo();
  } catch {
    // ignore
  }
});

Before({ tags: '@mongo' }, async () => {
  const started = await ensureMongoContainer();
  const host = started.getHost();
  const port = started.getMappedPort(27017);
  const uri = `mongodb://${host}:${port}/db?directConnection=true`;
  process.env.MONGO_URI = uri;
  await connectMongo(uri);
  await IngestFileModel.deleteMany({}).exec();
});

AfterAll(async () => {
  if (stopping) return;
  stopping = true;

  try {
    if (isMongoConnected()) {
      await disconnectMongo();
    }
  } catch {
    // ignore
  }

  if (container) {
    await container.stop();
    container = null;
    containerPromise = null;
  }
});
