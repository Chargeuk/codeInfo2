import http from 'http';
import { CODEINFO_WEB_MCP_PORT } from '../config.js';
import { append } from '../logStore.js';
import { handleWebRpc } from './router.js';

let server: http.Server | undefined;
let stopPromise: Promise<void> | null = null;
const WEB_MCP_HOST = '127.0.0.1';

export function startWebMcpServer() {
  if (server) {
    return server;
  }
  const nextServer = http.createServer(handleWebRpc);
  let listening = false;
  const handleServerError = (error: Error) => {
    append({
      level: 'error',
      source: 'server',
      timestamp: new Date().toISOString(),
      message: listening ? 'web_mcp_runtime_error' : 'web_mcp_start_error',
      context: {
        error: error.stack ?? error.message,
        port: CODEINFO_WEB_MCP_PORT,
        host: WEB_MCP_HOST,
      },
    });
    if (!listening && server === nextServer) {
      server = undefined;
      stopPromise = null;
    }
  };

  server = nextServer;
  nextServer.on('error', handleServerError);
  nextServer.once('listening', () => {
    listening = true;
  });
  nextServer.on('close', () => {
    listening = false;
    if (stopPromise) {
      stopPromise = null;
    }
    server = undefined;
  });
  try {
    nextServer.listen(CODEINFO_WEB_MCP_PORT, WEB_MCP_HOST);
  } catch (error) {
    handleServerError(
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
