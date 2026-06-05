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

let container: StartedTestContainer | null = null;
let containerPromise: Promise<StartedTestContainer> | null = null;
let stopping = false;
const localMongoImage = process.env.CODEINFO_LOCAL_MONGO_IMAGE ?? 'mongo:8.2.9';

process.env.TESTCONTAINERS_RYUK_DISABLED ??= 'true';
process.env.TESTCONTAINERS_HOST_OVERRIDE ??= 'host.docker.internal';

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
  const started = await ensureMongoContainer();
  const host = started.getHost();
  const port = started.getMappedPort(27017);
  const uri = `mongodb://${host}:${port}/db?directConnection=true`;
  process.env.CODEINFO_MONGO_URI = uri;
  await connectMongo(uri);
  await IngestFileModel.deleteMany({}).exec();
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
