import http from 'http';
import { CODEINFO_WEB_MCP_PORT } from '../config.js';
import { handleWebRpc } from './router.js';

let server: http.Server | undefined;
let stopPromise: Promise<void> | null = null;

export function startWebMcpServer() {
  if (server) {
    return server;
  }
  server = http.createServer(handleWebRpc);
  server.on('close', () => {
    if (stopPromise) {
      stopPromise = null;
    }
    server = undefined;
  });
  server.listen(CODEINFO_WEB_MCP_PORT);
  return server;
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
