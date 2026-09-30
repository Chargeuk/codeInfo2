import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const fixture = mkdtempSync(join(tmpdir(), 'codeinfo-share-'));
const bin = join(fixture, 'bin');
const sharePath = join(fixture, 'network share');
mkdirSync(bin);
mkdirSync(sharePath);

for (const command of ['mount', 'findmnt']) {
  const path = join(bin, command);
  writeFileSync(
    path,
    '#!/bin/sh\nprintf "%s\\n" "$CODEINFO_TEST_MOUNT_OUTPUT"\n',
  );
  chmodSync(path, 0o755);
}

test.after(() => rmSync(fixture, { recursive: true, force: true }));

function check(platform, path, output) {
  // Simulate both supported hosts without changing the production platform check.
  const bootstrap = `
    Object.defineProperty(process, 'platform', { value: ${JSON.stringify(platform)} });
    process.argv[2] = process.argv[1];
    import(${JSON.stringify(new URL('../check-optional-share.mjs', import.meta.url).href)});
  `;
  return spawnSync(process.execPath, ['-e', bootstrap, path], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      CODEINFO_TEST_MOUNT_OUTPUT: output,
    },
    encoding: 'utf8',
  }).status;
}

test('Darwin accepts only exact SMB or NFS mountpoints, including escaped spaces', () => {
  for (const type of ['smbfs', 'nfs']) {
    assert.equal(
      check(
        'darwin',
        sharePath,
        `//server/share on ${sharePath} (${type}, nodev)`,
      ),
      0,
    );
  }
  const escapedPath = sharePath.replace(/ /g, '\\040');
  assert.equal(
    check(
      'darwin',
      sharePath,
      `//server/share on ${escapedPath} (smbfs, nodev)`,
    ),
    0,
  );
  assert.equal(
    check(
      'darwin',
      sharePath,
      `//server/share on ${sharePath}/child (smbfs, nodev)`,
    ),
    1,
  );
  assert.equal(
    check(
      'darwin',
      sharePath,
      `map -hosts on ${sharePath} (autofs, automounted)`,
    ),
    1,
  );
  assert.equal(
    check('darwin', sharePath, `disk on ${sharePath} (apfs, local)`),
    1,
  );
  assert.equal(
    check(
      'darwin',
      join(fixture, 'missing'),
      `//server/share on ${sharePath} (smbfs)`,
    ),
    1,
  );
});

test('Linux keeps NFS, CIFS, and matching WSL UNC 9p acceptance', () => {
  for (const fstype of ['nfs', 'nfs4', 'cifs']) {
    assert.equal(
      check(
        'linux',
        sharePath,
        JSON.stringify({
          filesystems: [{ source: 'server:/share', fstype, options: 'rw' }],
        }),
      ),
      0,
    );
  }
  const source = '\\\\server\\Share';
  const valid = {
    filesystems: [
      {
        source,
        fstype: '9p',
        options: 'rw,aname=drvfs;path=UNC\\server\\Share;uid=1000',
      },
    ],
  };
  assert.equal(check('linux', sharePath, JSON.stringify(valid)), 0);
  valid.filesystems[0].options = 'rw,aname=drvfs;path=UNC\\other\\Share';
  assert.equal(check('linux', sharePath, JSON.stringify(valid)), 1);
  assert.equal(
    check(
      'linux',
      sharePath,
      JSON.stringify({
        filesystems: [{ source: 'local', fstype: 'ext4', options: 'rw' }],
      }),
    ),
    1,
  );
});
