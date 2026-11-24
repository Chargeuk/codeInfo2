#!/usr/bin/env python3
"""Route direct CLI calls too; config overrides outrank inherited TOML settings."""
import json
import os
from pathlib import Path
import runpy
import sys


def route_arguments(args, target):
    # Keep the enforced override global, before any subcommand or `--`. Remove
    # only caller sqlite_home overrides so their position cannot defeat routing.
    filtered = []
    index = 0
    while index < len(args):
        arg = args[index]
        if arg == '--':
            filtered.extend(args[index:])
            break
        if arg in ('-c', '--config') and index + 1 < len(args):
            if args[index + 1].split('=', 1)[0].strip() == 'sqlite_home':
                index += 2
                continue
        if arg.startswith('--config=') and arg[len('--config='):].split('=', 1)[0].strip() == 'sqlite_home':
            index += 1
            continue
        if arg.startswith('-c') and len(arg) > 2:
            # Clap accepts both attached forms, including an optional '='.
            config = arg[2:]
            if config.startswith('='):
                config = config[1:]
            if config.split('=', 1)[0].strip() == 'sqlite_home':
                index += 1
                continue
        filtered.append(arg)
        index += 1
    return ['--config', 'sqlite_home=' + json.dumps(str(target)), *filtered]


def main():
    args = sys.argv[1:]
    if os.environ.get('CODEINFO_CODEX_SQLITE_VOLUME_ACTIVE') == '1':
        module = runpy.run_path('/app/scripts/codex-sqlite-home.py')
        try:
            home = Path(os.environ.get('CODEX_HOME', '/app/codex'))
            target = module['initialize'](home, **module['runtime_replacements']())
            args = route_arguments(args, target)
        except Exception as error:
            print(f'CODEINFO SQLite CLI routing failed: {error}', file=sys.stderr)
            sys.exit(1)
    os.execv('/opt/codeinfo/bin/codex-native', ['/opt/codeinfo/bin/codex-native', *args])


if __name__ == '__main__':
    main()
