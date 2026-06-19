import http from 'http';
import { CODEINFO_WEB_MCP_PORT } from '../config.js';
import { append } from '../logStore.js';
import { handleWebRpc } from './router.js';

let server: http.Server | undefined;
let stopPromise: Promise<void> | null = null;

export function startWebMcpServer() {
  if (server) {
    return server;
  }
  const nextServer = http.createServer(handleWebRpc);
  const handleStartupError = (error: Error) => {
    append({
      level: 'error',
      source: 'server',
      timestamp: new Date().toISOString(),
      message: 'web_mcp_start_error',
      context: {
        error: error.stack ?? error.message,
        port: CODEINFO_WEB_MCP_PORT,
      },
    });
    if (server === nextServer) {
      server = undefined;
    }
    stopPromise = null;
  };

  server = nextServer;
  nextServer.once('error', handleStartupError);
  nextServer.once('listening', () => {
    nextServer.off('error', handleStartupError);
  });
  nextServer.on('close', () => {
    if (stopPromise) {
      stopPromise = null;
    }
    server = undefined;
  });
  try {
    nextServer.listen(CODEINFO_WEB_MCP_PORT);
  } catch (error) {
    handleStartupError(
      error instanceof Error ? error : new Error(String(error)),
    );
    throw error;
  }
  return nextServer;
}

export function stopWebMcpServer() {
  if (!server) {
    return stopPromise ?? Promise.resolve();
  }
  if (stopPromise) {
    return stopPromise;
  }

  const activeServer = server;
  stopPromise = new Promise<void>((resolve) => {
    activeServer.close(() => {
      if (server === activeServer) {
        server = undefined;
      }
      stopPromise = null;
      resolve();
    });
  });
  return stopPromise;
}
