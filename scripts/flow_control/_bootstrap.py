"""Bootstrap imports so flow-control entrypoints can import sibling scripts."""

from __future__ import annotations

import sys
from pathlib import Path


def ensure_scripts_on_path() -> None:
    scripts_dir = Path(__file__).resolve().parent.parent
    scripts_path = str(scripts_dir)
    if scripts_path not in sys.path:
        sys.path.insert(0, scripts_path)
