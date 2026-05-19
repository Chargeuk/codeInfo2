#!/usr/bin/env python3
"""Return yes when the review minor-fix path no longer needs another pass."""

from __future__ import annotations

from _bootstrap import ensure_scripts_on_path

ensure_scripts_on_path()

from flow_control.decision import run
from flow_control.review import check_review_minor_fix_path_clear


if __name__ == "__main__":
    raise SystemExit(run(__file__, check_review_minor_fix_path_clear))
