import fs from 'fs';
import path from 'path';
import type { Logger } from 'pino';

type Params = {
  containerHome: string;
  hostHome: string;
  logger: Logger;
};

/**
 * Copy Codex auth.json from a mounted host path into the container Codex home
 * when the container auth is missing. Never overwrites existing container auth.
 */
export function ensureCodexAuthFromHost({
  containerHome,
  hostHome,
  logger,
}: Params): void {
  const containerAuthPath = path.join(containerHome, 'auth.json');
  const hostAuthPath = path.join(hostHome, 'auth.json');

  if (fs.existsSync(containerAuthPath)) {
    logger?.info(
      { containerAuthPath },
      'Codex auth present; skipping host copy',
    );
    return;
  }

  if (!fs.existsSync(hostAuthPath)) {
    logger?.info(
      { hostAuthPath },
      'Host Codex auth not found; nothing to copy',
    );
    return;
  }

  try {
    fs.mkdirSync(containerHome, { recursive: true });
    fs.copyFileSync(hostAuthPath, containerAuthPath);
    logger?.info(
      { hostAuthPath, containerAuthPath },
      'Copied host Codex auth into container Codex home',
    );
  } catch (err) {
    logger?.warn(
      { hostAuthPath, containerAuthPath, err },
      'Failed to copy host Codex auth into container Codex home',
    );
  }
}
