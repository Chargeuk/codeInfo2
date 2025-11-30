import { getAppInfo } from '@codeinfo2/common';
import cors from 'cors';
import { config } from 'dotenv';
import express from 'express';
import pkg from '../package.json' with { type: 'json' };
import { closeAll, getClient } from './lmstudio/clientPool.js';
import { createRequestLogger } from './logger.js';
import { createChatRouter } from './routes/chat.js';
import { createChatModelsRouter } from './routes/chatModels.js';
import { createIngestCancelRouter } from './routes/ingestCancel.js';
import { createIngestModelsRouter } from './routes/ingestModels.js';
import { createIngestReembedRouter } from './routes/ingestReembed.js';
import { createIngestRemoveRouter } from './routes/ingestRemove.js';
import { createIngestRootsRouter } from './routes/ingestRoots.js';
import { createIngestStartRouter } from './routes/ingestStart.js';
import { createLmStudioRouter } from './routes/lmstudio.js';
import { createLogsRouter } from './routes/logs.js';
import { createToolsIngestedReposRouter } from './routes/toolsIngestedRepos.js';
import { createToolsVectorSearchRouter } from './routes/toolsVectorSearch.js';

config();
const app = express();
app.use(cors());
app.use(express.json());
app.use(createRequestLogger());
app.use((req, res, next) => {
  const requestId = (req as unknown as { id?: string }).id;
  if (requestId) res.locals.requestId = requestId;
  next();
});
const PORT = process.env.PORT ?? '5010';
const clientFactory = (baseUrl: string) => getClient(baseUrl);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: Date.now() });
});

app.get('/version', (_req, res) => {
  res.json(getAppInfo('server', pkg.version));
});

app.get('/info', (_req, res) => {
  res.json({
    message: 'Server using common package',
    info: getAppInfo('server', pkg.version),
  });
});

app.use('/logs', createLogsRouter());
app.use('/chat', createChatRouter({ clientFactory }));
app.use('/chat', createChatModelsRouter({ clientFactory }));
app.use('/', createIngestStartRouter({ clientFactory }));
app.use('/', createIngestModelsRouter({ clientFactory }));
app.use('/', createIngestRootsRouter());
app.use('/', createIngestCancelRouter());
app.use('/', createIngestReembedRouter({ clientFactory }));
app.use('/', createIngestRemoveRouter());
app.use('/', createLmStudioRouter({ clientFactory }));
app.use('/', createToolsIngestedReposRouter());
app.use('/', createToolsVectorSearchRouter());

const server = app.listen(Number(PORT), () => console.log(`Server on ${PORT}`));

const shutdown = async (signal: NodeJS.Signals) => {
  console.log(`Received ${signal}, closing LM Studio clients...`);
  try {
    await closeAll();
  } catch (err) {
    console.error('Failed to close LM Studio clients', err);
  } finally {
    server.close(() => process.exit(0));
  }
};

const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
signals.forEach((sig) => {
  process.on(sig, () => void shutdown(sig));
});
