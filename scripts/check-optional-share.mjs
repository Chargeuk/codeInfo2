import { execFileSync } from 'node:child_process';
import { opendirSync } from 'node:fs';
import { isAbsolute } from 'node:path';

const sharePath = process.argv[2];
const decode = (value) =>
  value.replace(/\\x([0-9a-f]{2})/gi, (_, hex) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );

try {
  if (!sharePath || !isAbsolute(sharePath) || process.platform !== 'linux')
    process.exit(1);

  // Reading one entry triggers WSL autofs and proves access even for an empty share.
  const directory = opendirSync(sharePath);
  try {
    directory.readSync();
  } finally {
    directory.closeSync();
  }

  const output = execFileSync(
    'findmnt',
    ['-J', '-l', '-M', sharePath, '-o', 'SOURCE,FSTYPE,OPTIONS'],
    {
      encoding: 'utf8',
    },
  );
  const mounts = JSON.parse(output).filesystems ?? [];
  const available = mounts.some((mount) => {
    const source = decode(mount.source);
    const options = decode(mount.options).split(',');
    if (['nfs', 'nfs4', 'cifs'].includes(mount.fstype)) return true;
    if (
      mount.fstype !== '9p' ||
      !source.startsWith('\\\\') ||
      !options.includes('ro')
    )
      return false;

    // WSL reports UNC drvfs mounts as 9p above an autofs mount at the same path.
    const aname = `aname=drvfs;path=UNC${source.slice(1)}`;
    return options.some(
      (option) => option === aname || option.startsWith(`${aname};`),
    );
  });
  if (!available) process.exitCode = 1;
} catch {
  process.exitCode = 1;
}
