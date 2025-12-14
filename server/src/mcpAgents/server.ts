import http from 'http';
import { AGENTS_MCP_PORT } from '../config.js';
import { handleAgentsRpc } from './router.js';

let server: http.Server | undefined;

export function startAgentsMcpServer() {
  server = http.createServer(handleAgentsRpc);
  server.listen(AGENTS_MCP_PORT);
  return server;
}

export function stopAgentsMcpServer() {
  return new Promise<void>((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}
