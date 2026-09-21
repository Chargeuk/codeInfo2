import type { Server } from 'node:http';

function resolvePort(server: Server): number | null {
  const address = server.address();
  return address && typeof address === 'object' ? address.port : null;
}

export async function waitForHttpServerPort(server: Server): Promise<number> {
  const currentPort = resolvePort(server);
  if (currentPort !== null) return currentPort;

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onListening = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      server.off('error', onError);
      server.off('listening', onListening);
    };

    server.once('error', onError);
    server.once('listening', onListening);

    if (resolvePort(server) !== null) {
      cleanup();
      resolve();
    }
  });

  const port = resolvePort(server);
  if (port === null) {
    throw new Error('HTTP server started without an addressable TCP port');
  }
  return port;
}

export async function closeHttpServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
