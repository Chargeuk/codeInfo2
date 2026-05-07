import fs from 'fs';
import path from 'path';
import type { Logger } from 'pino';

type Params = {
  containerHome: string;
  hostHome: string;
  logger: Logger;
};

/**
 * Enforce one supported Codex auth authority for the main stack.
 * A direct writable home mount is supported; split host/container auth homes are not.
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

  const guidance =
    'Unsupported split Codex auth authority detected. Mount CODEINFO_HOST_CODEX_HOME directly at CODEX_HOME (/app/codex), reauthenticate that host home, and restart the main stack instead of relying on copied auth.json state.';
  logger?.error(
    {
      containerHome,
      hostHome,
      containerAuthPath,
      hostAuthPath,
      containerAuthExists,
      hostAuthExists,
    },
    guidance,
  );
  throw new Error(guidance);
}
