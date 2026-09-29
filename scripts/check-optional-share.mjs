import { execFileSync } from 'node:child_process';
import { opendirSync } from 'node:fs';
import { isAbsolute } from 'node:path';

const sharePath = process.argv[2];
const decode = (value) =>
  value.replace(/\\x([0-9a-f]{2})/gi, (_, hex) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );

try {
  if (
    !sharePath ||
    !isAbsolute(sharePath) ||
    !['linux', 'darwin'].includes(process.platform)
  )
    process.exit(1);

  // Reading one entry triggers WSL autofs and proves access even for an empty share.
  const directory = opendirSync(sharePath);
  try {
    directory.readSync();
  } finally {
    directory.closeSync();
  }

  let available;
  if (process.platform === 'darwin') {
    const output = execFileSync('mount', { encoding: 'utf8' });
    available = output.split('\n').some((line) => {
      const mount = line.match(/ \((smbfs|nfs)(?:,[^)]*)?\)$/);
      if (!mount) return false;
      // Match the literal path at the end; " on " can also occur in source or target names.
      // macOS mount output may escape spaces in mountpoint names as octal bytes.
      const mountRecord = line.slice(0, mount.index).replace(/\\([0-7]{3})/g, (_, octal) =>
        String.fromCharCode(Number.parseInt(octal, 8)),
      );
      return mountRecord.endsWith(` on ${sharePath}`);
    });
  } else {
    const output = execFileSync(
      'findmnt',
      ['-J', '-l', '-M', sharePath, '-o', 'SOURCE,FSTYPE,OPTIONS'],
      { encoding: 'utf8' },
    );
    const mounts = JSON.parse(output).filesystems ?? [];
    available = mounts.some((mount) => {
      const source = decode(mount.source);
      const options = decode(mount.options).split(',');
      if (['nfs', 'nfs4', 'cifs'].includes(mount.fstype)) return true;
      // Compose makes the container bind read-only regardless of the host mount mode.
      if (mount.fstype !== '9p' || !source.startsWith('\\\\')) return false;

      // WSL reports UNC drvfs mounts as 9p above an autofs mount at the same path.
      const aname = `aname=drvfs;path=UNC${source.slice(1)}`;
      return options.some(
        (option) => option === aname || option.startsWith(`${aname};`),
      );
    });
  }
  if (!available) process.exitCode = 1;
} catch {
  process.exitCode = 1;
}
