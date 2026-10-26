#!/usr/bin/env python3
"""Return yes for a coherent incomplete story blocked after bounded repair."""

from __future__ import annotations

from _bootstrap import ensure_scripts_on_path

ensure_scripts_on_path()

from flow_control.decision import run
from flow_control.story import check_story_has_durable_blocker


if __name__ == "__main__":
    raise SystemExit(run(__file__, check_story_has_durable_blocker))
