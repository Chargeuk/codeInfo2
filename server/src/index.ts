import path from 'path';
import { getAppInfo } from '@codeinfo2/common';
import cors from 'cors';
import { config } from 'dotenv';
import express from 'express';
import pkg from '../package.json' with { type: 'json' };
import { ensureCodexConfigSeeded, getCodexHome } from './config/codexConfig.js';
import { closeAll, getClient } from './lmstudio/clientPool.js';
import { baseLogger, createRequestLogger } from './logger.js';
import { createMcpRouter } from './mcp/server.js';
import { startMcp2Server, stopMcp2Server } from './mcp2/server.js';
import { connectMongo, disconnectMongo } from './mongo/connection.js';
import { detectCodex } from './providers/codexDetection.js';
import { createChatRouter } from './routes/chat.js';
import { createChatModelsRouter } from './routes/chatModels.js';
import { createChatProvidersRouter } from './routes/chatProviders.js';
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
import { ensureCodexAuthFromHost } from './utils/codexAuthCopy.js';

config();
ensureCodexConfigSeeded();
ensureCodexAuthFromHost({
  containerHome: getCodexHome(),
  hostHome: path.resolve('/host/codex'),
  logger: baseLogger,
});
const codexDetection = detectCodex();
const app = express();
app.use(cors());
app.use(express.json());
app.use(createRequestLogger());
baseLogger.info({ codexDetection }, 'Codex detection summary');
const PORT = process.env.PORT ?? '5010';
const mcpHostUrl = `http://localhost:${PORT}/mcp`;
const mcpDockerUrl = `http://server:${PORT}/mcp`;
baseLogger.info({ mcpHostUrl, mcpDockerUrl }, 'MCP endpoint available');
app.use((req, res, next) => {
  const requestId = (req as unknown as { id?: string }).id;
  if (requestId) res.locals.requestId = requestId;
  next();
});
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
app.use('/chat', createChatProvidersRouter());
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
app.use('/', createMcpRouter());

let server: ReturnType<typeof app.listen> | undefined;

const start = async () => {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    baseLogger.error('MONGO_URI is required but missing');
    process.exit(1);
  }
  try {
    await connectMongo(mongoUri);
  } catch (err) {
    baseLogger.error({ err }, 'Failed to connect to Mongo');
    process.exit(1);
  }

  server = app.listen(Number(PORT), () => baseLogger.info(`Server on ${PORT}`));
  startMcp2Server();
};

void start();

const shutdown = async (signal: NodeJS.Signals) => {
  baseLogger.info({ signal }, 'Shutting down services');
  try {
    await stopMcp2Server();
  } catch (err) {
    baseLogger.error({ err }, 'Failed to close MCP v2 server');
  }
  try {
    await closeAll();
  } catch (err) {
    baseLogger.error({ err }, 'Failed to close LM Studio clients');
  }
  try {
    await disconnectMongo();
  } catch (err) {
    baseLogger.error({ err }, 'Failed to disconnect Mongo');
  } finally {
    server?.close(() => process.exit(0));
  }
};

const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
signals.forEach((sig) => {
  process.on(sig, () => void shutdown(sig));
});
