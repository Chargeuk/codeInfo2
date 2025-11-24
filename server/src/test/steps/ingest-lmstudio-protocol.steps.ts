import type { Server } from 'http';
import {
  After,
  Before,
  Given,
  Then,
  When,
  setDefaultTimeout,
} from '@cucumber/cucumber';
import type { LMStudioClient } from '@lmstudio/sdk';
import cors from 'cors';
import express from 'express';
import { MockLMStudioClient } from '../support/mockLmStudioSdk.js';

setDefaultTimeout(10000);
// Note: other server features may start Docker/Testcontainers (Chroma); this probe itself does not.

let server: Server | null = null;
let baseUrl = '';
let response: { status: number; body: unknown } | null = null;

Before(async () => {
  const app = express();
  app.use(cors());

  app.get('/lmstudio/probe', async (_req, res) => {
    try {
      const client = new MockLMStudioClient(
        process.env.LMSTUDIO_BASE_URL,
      ) as unknown as LMStudioClient;
      const models = await client.system.listDownloadedModels();
      res.status(200).json({ status: 'ok', modelsCount: models.length });
    } catch (err) {
      res
        .status(500)
        .json({ status: 'error', message: (err as Error).message });
    }
  });

  await new Promise<void>((resolve) => {
    const listener = app.listen(0, () => {
      server = listener;
      const address = listener.address();
      if (!address || typeof address === 'string') {
        throw new Error('Unable to start test server');
      }
      baseUrl = `http://localhost:${address.port}`;
      resolve();
    });
  });
});

After(() => {
  if (server) {
    server.close();
    server = null;
  }
  response = null;
  process.env.LMSTUDIO_BASE_URL = 'ws://localhost:1234';
});

Given('LM Studio base url {string}', (url: string) => {
  process.env.LMSTUDIO_BASE_URL = url;
});

When('I call the LM Studio probe endpoint', async () => {
  const res = await fetch(`${baseUrl}/lmstudio/probe`);
  response = { status: res.status, body: await res.json() };
});

Then('the LM Studio probe status should be {int}', (status: number) => {
  if (!response) throw new Error('No response captured');
  if (response.status !== status) {
    throw new Error(
      `Expected status ${status} but got ${response.status}: ${JSON.stringify(response.body)}`,
    );
  }
});

Then('the LM Studio probe message should contain {string}', (text: string) => {
  if (!response) throw new Error('No response captured');
  const bodyStr = JSON.stringify(response.body);
  if (!bodyStr.includes(text)) {
    throw new Error(
      `Expected response message to contain "${text}", got ${bodyStr}`,
    );
  }
});
