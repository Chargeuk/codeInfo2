import {
  AfterAll,
  Before,
  BeforeAll,
  setDefaultTimeout,
} from '@cucumber/cucumber';
import { ChromaClient } from 'chromadb';
import { GenericContainer, StartedTestContainer } from 'testcontainers';

let container: StartedTestContainer | null = null;

setDefaultTimeout(60000);

BeforeAll(async () => {
  container = await new GenericContainer('chromadb/chroma:1.3.5')
    .withExposedPorts(8000)
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(8000);
  process.env.CHROMA_URL = `http://${host}:${port}`;
  process.env.CHROMA_TEST_EMBEDDINGS = 'true';
  process.env.INGEST_EMBED_MODEL =
    process.env.INGEST_EMBED_MODEL ?? 'test-embed';
  console.log(`[chroma test] started at ${process.env.CHROMA_URL}`);
});

Before(async () => {
  const chromaUrl = process.env.CHROMA_URL ?? 'http://localhost:8000';
  const client = new ChromaClient({ path: chromaUrl });
  const vectors = process.env.INGEST_COLLECTION ?? 'ingest_vectors';
  const roots = process.env.INGEST_ROOTS_COLLECTION ?? 'ingest_roots';

  try {
    await client.deleteCollection({ name: vectors });
  } catch (err) {
    console.warn(
      `[chroma test] delete vectors failed (ignored): ${String(err)}`,
    );
  }
  try {
    await client.deleteCollection({ name: roots });
  } catch (err) {
    console.warn(`[chroma test] delete roots failed (ignored): ${String(err)}`);
  }

  await client.getOrCreateCollection({ name: vectors });
  await client.getOrCreateCollection({ name: roots });
});

AfterAll(async () => {
  if (container) {
    await container.stop();
    console.log('[chroma test] container stopped');
    container = null;
  }
});
