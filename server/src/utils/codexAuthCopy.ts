import fs from 'fs';
import path from 'path';
import type { Logger } from 'pino';

type Params = {
  containerHome: string;
  hostHome: string;
  logger: Logger;
};

/**
 * Best-effort seed runtime auth from the host mount when needed.
 * Local and main compose may wire Codex homes differently, so startup stays permissive.
 */
export function ensureCodexAuthFromHost({
  containerHome,
  hostHome,
  logger,
}: Params): void {
  const containerAuthPath = path.join(containerHome, 'auth.json');
  const hostAuthPath = path.join(hostHome, 'auth.json');
  const containerAuthExists = fs.existsSync(containerAuthPath);
  const hostMountExists = fs.existsSync(hostHome);
  const hostAuthExists = fs.existsSync(hostAuthPath);
  const sharedHome = path.resolve(containerHome) === path.resolve(hostHome);

  if (sharedHome) {
    if (containerAuthExists) {
      logger?.info(
        { containerAuthPath },
        'Codex auth authority uses the shared runtime home',
      );
      return;
    }

    logger?.warn(
      { containerAuthPath },
      'Shared Codex runtime home is missing auth.json; reauthenticate the mounted host home',
    );
    return;
  }

  if (!hostMountExists) {
    if (containerAuthExists) {
      logger?.info(
        { containerAuthPath },
        'Codex auth already present in runtime home; no host auth mount configured',
      );
      return;
    }

    logger?.info(
      { hostHome, containerAuthPath },
      'No Codex auth mount configured; runtime remains unavailable until auth.json exists in the mounted Codex home',
    );
    return;
  }

  if (!hostAuthExists && !containerAuthExists) {
    logger?.info(
      { hostAuthPath, containerAuthPath },
      'No Codex auth found in either split home; runtime remains unavailable until the mounted host home is reauthenticated',
    );
    return;
  }

  if (containerAuthExists) {
    logger?.info(
      {
        containerAuthPath,
        hostAuthPath,
        hostAuthExists,
      },
      'Codex auth already present in runtime home; startup will use the runtime auth file',
    );
    return;
  }

  if (!hostAuthExists) {
    logger?.info(
      { hostAuthPath, containerAuthPath },
      'Split Codex home is configured but the mounted host home has no auth.json; runtime remains unavailable until Codex is authenticated',
    );
    return;
  }

  fs.mkdirSync(containerHome, { recursive: true });
  fs.copyFileSync(hostAuthPath, containerAuthPath);
  logger?.info(
    { hostAuthPath, containerAuthPath },
    'Seeded runtime Codex auth from the mounted host home',
  );
}
