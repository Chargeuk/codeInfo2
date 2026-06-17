import http from 'http';
import { CODEINFO_WEB_MCP_PORT } from '../config.js';
import { handleWebRpc } from './router.js';

let server: http.Server | undefined;

export function startWebMcpServer() {
  server = http.createServer(handleWebRpc);
  server.listen(CODEINFO_WEB_MCP_PORT);
  return server;
}

export function stopWebMcpServer() {
  return new Promise<void>((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}
