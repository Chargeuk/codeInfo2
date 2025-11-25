import crypto from 'crypto';
import fs from 'fs/promises';

export async function hashFile(absPath: string): Promise<string> {
  const data = await fs.readFile(absPath);
  const hash = crypto.createHash('sha256');
  hash.update(data);
  return hash.digest('hex');
}

export function hashChunk(
  relPath: string,
  chunkIndex: number,
  text: string,
): string {
  const hash = crypto.createHash('sha256');
  hash.update(relPath, 'utf8');
  hash.update(String(chunkIndex), 'utf8');
  hash.update(text, 'utf8');
  return hash.digest('hex');
}
