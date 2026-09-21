#!/usr/bin/env python3
"""Return yes only after a completed, clean GitHub review cycle."""

from __future__ import annotations

from _bootstrap import ensure_scripts_on_path

ensure_scripts_on_path()

from flow_control.decision import run
from flow_control.story import check_github_review_should_write_no_findings_closeout


if __name__ == "__main__":
    raise SystemExit(
        run(__file__, check_github_review_should_write_no_findings_closeout)
    )
