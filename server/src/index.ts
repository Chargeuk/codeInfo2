import http from 'node:http';
import path from 'path';
import { getAppInfo } from '@codeinfo2/common';
import cors from 'cors';
import express from 'express';
import pkg from '../package.json' with { type: 'json' };
import { warmAstParserQueries } from './ast/parser.js';
import { ensureCodexConfigSeeded, getCodexHome } from './config/codexConfig.js';
import {
  DEV_0000037_T01_REQUIRED_VERSION,
  DEV_0000040_T10_CODEX_SDK_GUARD,
  validateAndLogCodexSdkUpgrade,
} from './config/codexSdkUpgrade.js';
import { getFlowAndCommandRetries } from './config/flowAndCommandRetries.js';
import { resolveServerPort } from './config/serverPort.js';
import './flows/flowSchema.js';
import './ingest/index.js';
import './mongo/astCoverage.js';
import {
  ensureStartupEnvLoaded,
  resolveOpenAiEmbeddingCapabilityState,
} from './config/startupEnv.js';
import { closeAll, getClient } from './lmstudio/clientPool.js';
import { append } from './logStore.js';
import { baseLogger, createRequestLogger } from './logger.js';
import { createMcpRouter } from './mcp/server.js';
import { startMcp2Server, stopMcp2Server } from './mcp2/server.js';
import {
  startAgentsMcpServer,
  stopAgentsMcpServer,
} from './mcpAgents/server.js';
import {
  connectMongo,
  disconnectMongo,
  isMongoConnected,
} from './mongo/connection.js';
import { detectCodex } from './providers/codexDetection.js';
import { createAgentsRouter } from './routes/agents.js';
import { createAgentsCommandsRouter } from './routes/agentsCommands.js';
import { createAgentsRunRouter } from './routes/agentsRun.js';
import { createChatRouter } from './routes/chat.js';
import { createChatModelsRouter } from './routes/chatModels.js';
import { createChatProvidersRouter } from './routes/chatProviders.js';
import { createCodexDeviceAuthRouter } from './routes/codexDeviceAuth.js';
import { createConversationsRouter } from './routes/conversations.js';
import { createFlowsRouter } from './routes/flows.js';
import { createFlowsRunRouter } from './routes/flowsRun.js';
import { createIngestCancelRouter } from './routes/ingestCancel.js';
import { createIngestDirsRouter } from './routes/ingestDirs.js';
import { createIngestModelsRouter } from './routes/ingestModels.js';
import { createIngestReembedRouter } from './routes/ingestReembed.js';
import { createIngestRemoveRouter } from './routes/ingestRemove.js';
import { createIngestRootsRouter } from './routes/ingestRoots.js';
import { createIngestStartRouter } from './routes/ingestStart.js';
import { createLmStudioRouter } from './routes/lmstudio.js';
import { createLogsRouter } from './routes/logs.js';
import { createToolsAstCallGraphRouter } from './routes/toolsAstCallGraph.js';
import { createToolsAstFindDefinitionRouter } from './routes/toolsAstFindDefinition.js';
import { createToolsAstFindReferencesRouter } from './routes/toolsAstFindReferences.js';
import { createToolsAstListSymbolsRouter } from './routes/toolsAstListSymbols.js';
import { createToolsAstModuleImportsRouter } from './routes/toolsAstModuleImports.js';
import { createToolsIngestedReposRouter } from './routes/toolsIngestedRepos.js';
import { createToolsVectorSearchRouter } from './routes/toolsVectorSearch.js';
import { ensureCodexAuthFromHost } from './utils/codexAuthCopy.js';
import { attachWs, type WsServerHandle } from './ws/server.js';

const startupEnvLoad = ensureStartupEnvLoaded();
ensureCodexConfigSeeded();
const installedCodexSdkVersion = pkg.dependencies?.['@openai/codex-sdk'];
const codexSdkGuardAccepted = validateAndLogCodexSdkUpgrade(
  installedCodexSdkVersion,
  {
    logger: (message) => baseLogger.info(message),
    errorLogger: (message) => baseLogger.error(message),
  },
);
baseLogger.info(
  {
    event: DEV_0000040_T10_CODEX_SDK_GUARD,
    installedVersion: installedCodexSdkVersion ?? 'missing',
    requiredVersion: DEV_0000037_T01_REQUIRED_VERSION,
    decision: codexSdkGuardAccepted ? 'accepted' : 'rejected',
  },
  DEV_0000040_T10_CODEX_SDK_GUARD,
);
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
baseLogger.info(
  {
    event: 'DEV-0000036:T3:env_load_order_applied',
    orderedFiles: startupEnvLoad.orderedFiles,
    loadedFiles: startupEnvLoad.loadedFiles,
    overrideApplied: startupEnvLoad.overrideApplied,
  },
  'DEV-0000036:T3:env_load_order_applied',
);
append({
  level: 'info',
  message: 'DEV-0000036:T3:env_load_order_applied',
  timestamp: new Date().toISOString(),
  source: 'server',
  context: {
    orderedFiles: startupEnvLoad.orderedFiles,
    loadedFiles: startupEnvLoad.loadedFiles,
    overrideApplied: startupEnvLoad.overrideApplied,
  },
});
const flowAndCommandRetries = getFlowAndCommandRetries();
baseLogger.info(
  {
    event: 'DEV-0000036:T5:flow_and_command_retries_configured',
    flowAndCommandRetries,
  },
  'DEV-0000036:T5:flow_and_command_retries_configured',
);
append({
  level: 'info',
  message: 'DEV-0000036:T5:flow_and_command_retries_configured',
  timestamp: new Date().toISOString(),
  source: 'server',
  context: {
    flowAndCommandRetries,
  },
});
const openAiEmbeddingCapability = resolveOpenAiEmbeddingCapabilityState();
baseLogger.info(
  {
    event: 'DEV-0000036:T3:openai_embedding_capability_state',
    enabled: openAiEmbeddingCapability.enabled,
  },
  'DEV-0000036:T3:openai_embedding_capability_state',
);
append({
  level: 'info',
  message: 'DEV-0000036:T3:openai_embedding_capability_state',
  timestamp: new Date().toISOString(),
  source: 'server',
  context: {
    enabled: openAiEmbeddingCapability.enabled,
  },
});
const SERVER_PORT = resolveServerPort();
const mcpHostUrl = `http://localhost:${SERVER_PORT}/mcp`;
const mcpDockerUrl = `http://server:${SERVER_PORT}/mcp`;
baseLogger.info({ mcpHostUrl, mcpDockerUrl }, 'MCP endpoint available');
app.use((req, res, next) => {
  const requestId = (req as unknown as { id?: string }).id;
  if (requestId) res.locals.requestId = requestId;
  next();
});
const clientFactory = (baseUrl: string) => getClient(baseUrl);

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: Date.now(),
    mongoConnected: isMongoConnected(),
  });
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
app.use('/chat', createChatProvidersRouter({ clientFactory }));
app.use('/chat', createChatModelsRouter({ clientFactory }));
app.use('/codex', createCodexDeviceAuthRouter());
app.use('/', createAgentsRouter());
app.use('/', createAgentsRunRouter());
app.use('/agents', createAgentsCommandsRouter());
app.use('/', createFlowsRouter());
app.use('/', createFlowsRunRouter());
app.use('/', createConversationsRouter());
app.use('/', createIngestStartRouter({ clientFactory }));
app.use('/', createIngestModelsRouter({ clientFactory }));
app.use('/', createIngestRootsRouter());
app.use('/', createIngestDirsRouter());
app.use('/', createIngestCancelRouter());
app.use('/', createIngestReembedRouter({ clientFactory }));
app.use('/', createIngestRemoveRouter());
app.use('/', createLmStudioRouter({ clientFactory }));
app.use('/', createToolsIngestedReposRouter());
app.use('/', createToolsVectorSearchRouter());
app.use('/', createToolsAstListSymbolsRouter());
app.use('/', createToolsAstFindDefinitionRouter());
app.use('/', createToolsAstFindReferencesRouter());
app.use('/', createToolsAstCallGraphRouter());
app.use('/', createToolsAstModuleImportsRouter());
app.use('/', createMcpRouter());

let server: http.Server | undefined;
let wsServer: WsServerHandle | undefined;

const logTreeSitterReady = async () => {
  try {
    await import('tree-sitter');
    const timestamp = new Date().toISOString();
    append({
      level: 'info',
      message: 'DEV-0000032:T3:tree-sitter-deps-ready',
      timestamp,
      source: 'server',
      context: { dependency: 'tree-sitter' },
    });
    baseLogger.info(
      {
        event: 'DEV-0000032:T3:tree-sitter-deps-ready',
        dependency: 'tree-sitter',
      },
      'Tree-sitter dependency ready',
    );
  } catch (err) {
    baseLogger.error({ err }, 'Failed to load Tree-sitter dependency');
  }
};

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

  const httpServer = http.createServer(app);
  wsServer = attachWs({ httpServer });
  server = httpServer.listen(Number(SERVER_PORT), () => {
    baseLogger.info(`Server on ${SERVER_PORT}`);
    baseLogger.info(
      {
        event: 'DEV-0000032:T12:verification-ready',
        port: Number(SERVER_PORT),
      },
      'DEV-0000032:T12:verification-ready',
    );
    const timestamp = new Date().toISOString();
    append({
      level: 'info',
      message: 'DEV-0000032:T12:verification-ready',
      timestamp,
      source: 'server',
      context: {
        event: 'DEV-0000032:T12:verification-ready',
        port: Number(SERVER_PORT),
      },
    });
  });
  await logTreeSitterReady();
  void warmAstParserQueries();
  startMcp2Server();
  startAgentsMcpServer();
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
    await stopAgentsMcpServer();
  } catch (err) {
    baseLogger.error({ err }, 'Failed to close Agents MCP server');
  }
  try {
    await wsServer?.close();
  } catch (err) {
    baseLogger.error({ err }, 'Failed to close WS server');
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
