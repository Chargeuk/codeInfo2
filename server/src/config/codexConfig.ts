import fs from 'fs';
import path from 'path';

const defaultHome = process.env.CODEINFO_CODEX_HOME ?? './codex';

export function getCodexHome(): string {
  return path.resolve(defaultHome);
}

export function ensureCodexConfigSeeded(): string {
  const home = getCodexHome();
  const target = path.join(home, 'config.toml');
  const examplePath = path.resolve('config.toml.example');

  if (!fs.existsSync(home)) {
    fs.mkdirSync(home, { recursive: true });
  }

  if (!fs.existsSync(target)) {
    if (fs.existsSync(examplePath)) {
      fs.copyFileSync(examplePath, target);
      console.log(`Seeded Codex config from example to ${target}`);
    } else {
      console.warn(
        'config.toml.example not found; Codex config was not seeded.',
      );
    }
  }

  return target;
}
