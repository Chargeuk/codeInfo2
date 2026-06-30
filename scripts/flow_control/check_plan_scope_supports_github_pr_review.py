#!/usr/bin/env python3
"""Return yes when the active branch upstream is hosted on GitHub."""

from __future__ import annotations

from _bootstrap import ensure_scripts_on_path

ensure_scripts_on_path()

from flow_control.decision import run
from flow_control.plan_scope import check_plan_scope_supports_github_pr_review


if __name__ == "__main__":
    raise SystemExit(run(__file__, check_plan_scope_supports_github_pr_review))
