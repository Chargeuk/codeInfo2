import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [action, value, hash] = process.argv.slice(2);
async function sha256(file) {
  const digest = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}
async function stdin() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  return input;
}
try {
  if (action === 'verify-seed') {
    if (!path.isAbsolute(value) || fs.lstatSync(value).isSymbolicLink() || !fs.statSync(value).isFile()) {
      throw new Error('recovery seed must be an absolute regular file without a symlink');
    }
    if (!/^[a-f0-9]{64}$/.test(hash ?? '') || await sha256(value) !== hash) {
      throw new Error('recovery seed must match its verified SHA-256');
    }
    for (const suffix of ['-wal', '-journal']) {
      if (fs.existsSync(value + suffix) && fs.statSync(value + suffix).size) throw new Error('recovery seed must be a standalone verified SQLite backup');
    }
  } else if (action === 'describe-source') {
    // Full Compose config may contain secrets. Project only the mount identity
    // while it is still on a private pipe, before passing a descriptor onward.
    const config = JSON.parse(await stdin());
    const source = config.services?.server?.volumes?.find(v => v.target === '/app/codex');
    if (!source) throw new Error('cannot identify the existing Codex home mount');
    const sourceName = source.type === 'volume' ? config.volumes?.[source.source]?.name : source.source;
    if (!sourceName) throw new Error('cannot identify the existing Codex home source');
    process.stdout.write(JSON.stringify({ type: source.type, sourceName }));
  } else if (action === 'check-writers') {
    const { type, sourceName } = JSON.parse(value);
    const input = (await stdin()).trim();
    const containers = input.startsWith('[') ? JSON.parse(input) : input.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    for (const container of containers) {
      const sharesSource = container.Mounts?.some(m => {
        if (type === 'volume') return m.Name === sourceName;
        if (m.RW === false || (m.Type && m.Type !== 'bind')) return false;
        // A writable parent bind can reach the source too; sibling prefixes
        // cannot. path.relative keeps this check on directory boundaries.
        const relative = path.relative(path.resolve(m.Source), path.resolve(sourceName));
        return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
      });
      if (sharesSource && !container.active) {
        throw new Error(`stop the existing Codex source writer ${container.Name || container.Id} before enabling the SQLite volume`);
      }
    }
  } else throw new Error('unknown SQLite volume check');
} catch (error) {
  console.error(`CODEINFO SQLite volume: ${error.message}`);
  process.exitCode = 1;
}
