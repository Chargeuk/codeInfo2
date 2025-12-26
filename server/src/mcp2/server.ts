import http from 'http';
import { MCP_PORT } from '../config.js';
import { handleRpc } from './router.js';

let server: http.Server | undefined;

export function startMcp2Server() {
  server = http.createServer(handleRpc);
  server.listen(MCP_PORT);
  return server;
}

export function stopMcp2Server() {
  return new Promise<void>((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}
