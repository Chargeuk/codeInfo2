#!/usr/bin/env python3
"""Return yes when the bounded fast-review phase may advance to slow review."""

from __future__ import annotations

from _bootstrap import ensure_scripts_on_path

ensure_scripts_on_path()

from flow_control.decision import run
from flow_control.review import check_fast_review_phase_complete


if __name__ == "__main__":
    raise SystemExit(run(__file__, check_fast_review_phase_complete))
