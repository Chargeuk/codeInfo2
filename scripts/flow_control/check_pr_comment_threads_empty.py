#!/usr/bin/env python3
"""Return yes when no eligible pull-request comment leaves remain."""

from __future__ import annotations

from _bootstrap import ensure_scripts_on_path

ensure_scripts_on_path()

from flow_control.decision import run
from flow_control.pr_comments import evaluate_pr_comment_leaves


if __name__ == "__main__":
    raise SystemExit(run(__file__, evaluate_pr_comment_leaves))
