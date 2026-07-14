#!/usr/bin/env python3
"""Return yes when review decision recording must retry before downstream work."""

from __future__ import annotations

from _bootstrap import ensure_scripts_on_path

ensure_scripts_on_path()

from flow_control.decision import run
from flow_control.review import check_review_decisions_need_retry


if __name__ == "__main__":
    raise SystemExit(run(__file__, check_review_decisions_need_retry))
