#!/usr/bin/env python3
"""Return yes when the review loop should exit back to the main loop."""

from __future__ import annotations

from _bootstrap import ensure_scripts_on_path

ensure_scripts_on_path()

from flow_control.decision import run
from flow_control.story import check_review_should_exit_to_main_loop


if __name__ == "__main__":
    raise SystemExit(run(__file__, check_review_should_exit_to_main_loop))
