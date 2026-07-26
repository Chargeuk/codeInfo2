import fs from 'node:fs/promises';
import path from 'node:path';

async function restoreWritablePermissions(targetPath: string): Promise<void> {
  const stat = await fs.lstat(targetPath).catch(() => null);
  if (!stat) return;
  if (stat.isSymbolicLink()) return;
  if (!stat.isDirectory()) {
    await fs.chmod(targetPath, 0o644).catch(() => undefined);
    return;
  }

  await fs.chmod(targetPath, 0o755).catch(() => undefined);
  const entries = await fs
    .readdir(targetPath, { withFileTypes: true })
    .catch(() => []);
  await Promise.all(
    entries.map((entry) =>
      restoreWritablePermissions(path.join(targetPath, entry.name)),
    ),
  );
}

export async function removeWritableTree(targetPath: string): Promise<void> {
  await restoreWritablePermissions(targetPath);
  await fs.rm(targetPath, { recursive: true, force: true });
}
