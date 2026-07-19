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
import { buildCopilotClientOptions } from './config/copilotConfig.js';
import { getFlowAndCommandRetries } from './config/flowAndCommandRetries.js';
import { resolveCodeinfoMcpEndpointContract } from './config/mcpEndpoints.js';
import {
  ensureAllProviderChatConfigsBootstrapped,
  resolveLmStudioChatDefaultsHome,
} from './config/runtimeConfig.js';
import { resolveServerPort } from './config/serverPort.js';
import {
  ensureStartupEnvLoaded,
  resolveAgentProviderFallbackOrder,
  resolveCodeinfoEnvResolutions,
  resolveOpenAiEmbeddingCapabilityState,
} from './config/startupEnv.js';
import { createFakeCopilotRuntimeSeamFromEnv } from './copilot/fake/runtimeSeam.js';
import './flows/flowSchema.js';
import { reconcileInterruptedFlowRunsForStartup } from './flows/service.js';
import './ingest/index.js';
import { setIngestDeps } from './ingest/ingestJob.js';
import './mongo/astCoverage.js';
import { closeAll, getClient } from './lmstudio/clientPool.js';
import { append } from './logStore.js';
import { baseLogger, createRequestLogger } from './logger.js';
import { createMcpRouter } from './mcp/server.js';
import { startMcp2Server, stopMcp2Server } from './mcp2/server.js';
import {
  startAgentsMcpServer,
  stopAgentsMcpServer,
} from './mcpAgents/server.js';
import { startWebMcpServer, stopWebMcpServer } from './mcpWeb/server.js';
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
import { createCopilotDeviceAuthRouter } from './routes/copilotDeviceAuth.js';
import { createFlowsRouter } from './routes/flows.js';
import { createFlowsRunRouter } from './routes/flowsRun.js';
import { createIngestCancelRouter } from './routes/ingestCancel.js';
import { createIngestDirsRouter } from './routes/ingestDirs.js';
import { createIngestE2eCleanupRouter } from './routes/ingestE2eCleanup.js';
import { createIngestModelsRouter } from './routes/ingestModels.js';
import { createIngestReembedRouter } from './routes/ingestReembed.js';
import { createIngestRemoveRouter } from './routes/ingestRemove.js';
import { createIngestRootsRouter } from './routes/ingestRoots.js';
import { createIngestStartRouter } from './routes/ingestStart.js';
import { createLmStudioRouter } from './routes/lmstudio.js';
import { toWebSocketUrl } from './routes/lmstudioUrl.js';
import { createLogsRouter } from './routes/logs.js';
import { createOpenAiCompatProxyRouter } from './routes/openaiCompatProxy.js';
import { createToolsAstCallGraphRouter } from './routes/toolsAstCallGraph.js';
import { createToolsAstFindDefinitionRouter } from './routes/toolsAstFindDefinition.js';
import { createToolsAstFindReferencesRouter } from './routes/toolsAstFindReferences.js';
import { createToolsAstListSymbolsRouter } from './routes/toolsAstListSymbols.js';
import { createToolsAstModuleImportsRouter } from './routes/toolsAstModuleImports.js';
import { createToolsIngestedReposRouter } from './routes/toolsIngestedRepos.js';
import { createToolsVectorSearchRouter } from './routes/toolsVectorSearch.js';
import {
  recoverIngestQueueForStartup,
  recordIngestQueueStartupMongoUnavailable,
} from './startup/ingestQueueStartup.js';
import { ensureCodexAuthFromHost } from './utils/codexAuthCopy.js';
import { attachWs, type WsServerHandle } from './ws/server.js';

const startupEnvLoad = ensureStartupEnvLoaded();
const codeinfoEnvResolutions = resolveCodeinfoEnvResolutions({
  loadResult: startupEnvLoad,
});
const agentProviderFallbackOrder = resolveAgentProviderFallbackOrder();
const copilotRuntimeConfig = buildCopilotClientOptions({
  env: process.env,
});
const fakeCopilotRuntimeSeam = createFakeCopilotRuntimeSeamFromEnv(process.env);
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
const codexHostHome = path.resolve('/host/codex');
ensureCodexAuthFromHost({
  containerHome: getCodexHome(),
  hostHome: codexHostHome,
  logger: baseLogger,
});
const codexDetection = detectCodex();
const app = express();
app.use(cors());
app.use(createRequestLogger());
app.use('/', createOpenAiCompatProxyRouter());
app.use(express.json());
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
baseLogger.info(
  {
    event: 'DEV_0000048_T7_CODEINFO_ENV_RESOLVED',
    envs: codeinfoEnvResolutions,
  },
  'DEV_0000048_T7_CODEINFO_ENV_RESOLVED',
);
append({
  level: 'info',
  message: 'DEV_0000048_T7_CODEINFO_ENV_RESOLVED',
  timestamp: new Date().toISOString(),
  source: 'server',
  context: {
    envs: codeinfoEnvResolutions,
  },
});
baseLogger.info(
  {
    event: 'story.0000057.task1.agent_provider_fallback_order_loaded',
    providers: agentProviderFallbackOrder.normalizedProviders,
    usedDefault: agentProviderFallbackOrder.usedDefault,
    warningCount: agentProviderFallbackOrder.warnings.length,
  },
  'story.0000057.task1.agent_provider_fallback_order_loaded',
);
append({
  level: agentProviderFallbackOrder.warnings.length > 0 ? 'warn' : 'info',
  message: 'story.0000057.task1.agent_provider_fallback_order_loaded',
  timestamp: new Date().toISOString(),
  source: 'server',
  context: {
    providers: agentProviderFallbackOrder.normalizedProviders,
    usedDefault: agentProviderFallbackOrder.usedDefault,
    warnings: agentProviderFallbackOrder.warnings,
  },
});
baseLogger.info(
  {
    event: 'story.0000051.task14.runtime_config_loaded',
    copilotHome: copilotRuntimeConfig.copilotHome,
    cliPathOverride: copilotRuntimeConfig.cliPathOverride,
  },
  'story.0000051.task14.runtime_config_loaded',
);
append({
  level: 'info',
  message: 'story.0000051.task14.runtime_config_loaded',
  timestamp: new Date().toISOString(),
  source: 'server',
  context: {
    copilotHome: copilotRuntimeConfig.copilotHome,
    cliPathOverride: copilotRuntimeConfig.cliPathOverride,
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
const CODEINFO_SERVER_PORT = resolveServerPort();
const mcpEndpoints = resolveCodeinfoMcpEndpointContract();
baseLogger.info(
  {
    classicMcpUrl: mcpEndpoints.classicMcpUrl,
    chatMcpUrl: mcpEndpoints.chatMcpUrl,
    agentsMcpUrl: mcpEndpoints.agentsMcpUrl,
    webMcpUrl: mcpEndpoints.webMcpUrl,
    playwrightMcpUrl: mcpEndpoints.playwrightMcpUrl,
    placeholderFree: mcpEndpoints.placeholderFree,
    mcpDockerUrl: `http://server:${CODEINFO_SERVER_PORT}/mcp`,
  },
  'MCP endpoint available',
);
app.use((req, res, next) => {
  const requestId = (req as unknown as { id?: string }).id;
  if (requestId) res.locals.requestId = requestId;
  next();
});
const clientFactory = (baseUrl: string) => getClient(baseUrl);

const parseRuntimePorts = (value: string | undefined): number[] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => Number.parseInt(item, 10))
    .filter((item) => Number.isFinite(item));

const parseOptionalRuntimePort = (value: string | undefined): number | null => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseSourceBindMountCount = (value: string | undefined): number => {
  const parsed = Number.parseInt((value ?? '0').trim(), 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

const runtimeComposeFile = process.env.CODEINFO_RUNTIME_COMPOSE_FILE?.trim();
if (runtimeComposeFile) {
  const hostNetworkRuntimeReadyContext = {
    composeFile: runtimeComposeFile,
    serverPorts: parseRuntimePorts(process.env.CODEINFO_RUNTIME_SERVER_PORTS),
    playwrightPort: parseOptionalRuntimePort(
      process.env.CODEINFO_RUNTIME_PLAYWRIGHT_PORT,
    ),
    sourceBindMountCount: parseSourceBindMountCount(
      process.env.CODEINFO_RUNTIME_SOURCE_BIND_MOUNT_COUNT,
    ),
  };
  baseLogger.info(
    {
      event: 'DEV-0000050:T11:host_network_runtime_ready',
      ...hostNetworkRuntimeReadyContext,
    },
    'DEV-0000050:T11:host_network_runtime_ready',
  );
  append({
    level: 'info',
    message: 'DEV-0000050:T11:host_network_runtime_ready',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: hostNetworkRuntimeReadyContext,
  });
}

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
app.use(
  '/chat',
  createChatRouter({
    clientFactory,
    ...(fakeCopilotRuntimeSeam
      ? {
          copilotLifecycleFactory:
            fakeCopilotRuntimeSeam.createCopilotLifecycle,
        }
      : {}),
  }),
);
app.use(
  '/chat',
  createChatProvidersRouter({
    clientFactory,
    ...(fakeCopilotRuntimeSeam
      ? {
          copilotRuntimeFactory:
            fakeCopilotRuntimeSeam.createCopilotReadinessRuntime,
        }
      : {}),
  }),
);
app.use(
  '/chat',
  createChatModelsRouter({
    clientFactory,
    ...(fakeCopilotRuntimeSeam
      ? {
          copilotRuntimeFactory:
            fakeCopilotRuntimeSeam.createCopilotReadinessRuntime,
        }
      : {}),
  }),
);
app.use('/codex', createCodexDeviceAuthRouter());
app.use(
  '/copilot',
  createCopilotDeviceAuthRouter(
    fakeCopilotRuntimeSeam?.createDeviceAuthRouterDeps(),
  ),
);
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
app.use('/', createIngestE2eCleanupRouter());
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
  const mongoUri = process.env.CODEINFO_MONGO_URI;
  if (!mongoUri) {
    baseLogger.error('CODEINFO_MONGO_URI is required but missing');
    process.exit(1);
  }
  const bootstrapSnapshots = await ensureAllProviderChatConfigsBootstrapped({
    codexHome: process.env.CODEINFO_CODEX_HOME,
    copilotHome: process.env.CODEINFO_COPILOT_HOME,
    lmstudioHome: resolveLmStudioChatDefaultsHome(),
  });
  baseLogger.info(
    {
      event: 'story.0000057.task19.provider_bootstrap_complete',
      providerCount: bootstrapSnapshots.length,
    },
    'story.0000057.task19.provider_bootstrap_complete',
  );
  try {
    await connectMongo(mongoUri);
  } catch (err) {
    recordIngestQueueStartupMongoUnavailable({ error: err });
  }

  setIngestDeps({
    lmClientFactory: clientFactory,
    baseUrl: toWebSocketUrl(process.env.CODEINFO_LMSTUDIO_BASE_URL ?? ''),
  });
  if (isMongoConnected()) {
    await recoverIngestQueueForStartup();
  }

  const httpServer = http.createServer(app);
  wsServer = attachWs({ httpServer });
  server = httpServer.listen(Number(CODEINFO_SERVER_PORT), () => {
    if (isMongoConnected()) {
      void reconcileInterruptedFlowRunsForStartup()
        .then((reconciledFlowRuns) => {
          baseLogger.info(
            { reconciledFlowRuns },
            'flows startup reconciliation complete',
          );
        })
        .catch((error) => {
          baseLogger.warn(
            { error },
            'flows startup reconciliation skipped after recoverable error',
          );
        });
    }
    baseLogger.info(`Server on ${CODEINFO_SERVER_PORT}`);
    baseLogger.info(
      {
        event: 'DEV-0000032:T12:verification-ready',
        port: Number(CODEINFO_SERVER_PORT),
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
        port: Number(CODEINFO_SERVER_PORT),
      },
    });
  });
  await logTreeSitterReady();
  void warmAstParserQueries();
  startMcp2Server();
  startAgentsMcpServer();
  startWebMcpServer();
};

void start().catch((err) => {
  baseLogger.error(
    {
      err,
      error: err instanceof Error ? err.message : String(err),
    },
    'server startup failed before listen',
  );
  process.exit(1);
});

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
    await stopWebMcpServer();
  } catch (err) {
    baseLogger.error({ err }, 'Failed to close Web MCP server');
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
