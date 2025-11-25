import { execFile as execFileCb } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import { baseLogger } from '../logger.js';
import { resolveConfig } from './config.js';
import { IngestConfig, DiscoveredFile } from './types.js';

const execFile = promisify(execFileCb);

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function findRepoRoot(startPath: string): Promise<string> {
  let current = path.resolve(startPath);
  while (true) {
    const gitDir = path.join(current, '.git');
    if (await pathExists(gitDir)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startPath);
    current = parent;
  }
}

export type GitTrackedResult =
  | { ok: true; paths: string[] }
  | { ok: false; error: Error };

export async function listGitTracked(root: string): Promise<GitTrackedResult> {
  const testPaths = process.env.INGEST_TEST_GIT_PATHS;
  if (testPaths) {
    const paths = testPaths
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    return { ok: true, paths };
  }
  try {
    const { stdout } = await execFile('git', ['-C', root, 'ls-files', '-z']);
    return { ok: true, paths: stdout.split('\0').filter(Boolean) };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return { ok: false, error: err };
  }
}

function matchesExclude(relPath: string, excludes: string[]): boolean {
  const segments = relPath.split(path.sep);
  const base = segments[segments.length - 1];
  return excludes.some((pattern) => {
    if (!pattern) return false;
    if (pattern === '.git') return segments.includes('.git');
    if (pattern.includes('*')) {
      const trimmed = pattern.replace(/^\*/, '');
      return base.endsWith(trimmed.replace(/^[.]/, '.'));
    }
    return segments.includes(pattern) || base === pattern;
  });
}

function isAllowedExtension(filePath: string, includeExts: string[]): boolean {
  const ext = path.extname(filePath).replace('.', '').toLowerCase();
  return includeExts.includes(ext);
}

async function isLikelyText(filePath: string): Promise<boolean> {
  const sampleSize = 2048;
  try {
    const fd = await fs.open(filePath, 'r');
    const buffer = Buffer.alloc(sampleSize);
    const { bytesRead } = await fd.read(buffer, 0, sampleSize, 0);
    await fd.close();
    for (let i = 0; i < bytesRead; i += 1) {
      if (buffer[i] === 0) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function walkDir(root: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(current: string) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile()) {
        results.push(path.relative(root, abs));
      }
    }
  }
  await walk(root);
  return results;
}

export async function discoverFiles(
  startPath: string,
  cfg?: IngestConfig,
): Promise<{ root: string; files: DiscoveredFile[] }> {
  const config = cfg ?? resolveConfig();
  const repoRoot = await findRepoRoot(startPath);
  const hasGit = await pathExists(path.join(repoRoot, '.git'));
  const root = hasGit ? repoRoot : path.resolve(startPath);

  let relPaths: string[] = [];
  if (hasGit) {
    const gitResult = await listGitTracked(root);
    if (gitResult.ok) {
      relPaths = gitResult.paths;
    } else {
      baseLogger.info(
        {
          root,
          error: gitResult.error?.message ?? String(gitResult.error),
        },
        'git ls-files failed, falling back to walkDir',
      );
      relPaths = await walkDir(root);
    }
  } else {
    relPaths = await walkDir(root);
  }
  const files: DiscoveredFile[] = [];

  for (const relPath of relPaths) {
    const normalized = relPath.split('/').join(path.sep);
    if (matchesExclude(normalized, config.excludes)) continue;
    const absPath = path.join(root, normalized);
    const stat = await fs.stat(absPath).catch(() => null);
    if (!stat || !stat.isFile()) continue;
    if (!isAllowedExtension(normalized, config.includes)) continue;
    if (!(await isLikelyText(absPath))) continue;
    files.push({
      absPath,
      relPath: normalized,
      ext: path.extname(normalized).replace('.', '').toLowerCase(),
    });
  }

  return { root, files };
}

export function isTextFile(pathname: string, cfg?: IngestConfig): boolean {
  const config = cfg ?? resolveConfig();
  const normalized = pathname.split('/').join(path.sep);
  if (matchesExclude(normalized, config.excludes)) return false;
  return isAllowedExtension(normalized, config.includes);
}
