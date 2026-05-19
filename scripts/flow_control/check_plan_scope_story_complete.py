#!/usr/bin/env python3
"""Return yes when the active plan scope reports story completion."""

from __future__ import annotations

from _bootstrap import ensure_scripts_on_path

ensure_scripts_on_path()

from flow_control.decision import run
from flow_control.plan_scope import check_plan_scope_story_complete


if __name__ == "__main__":
    raise SystemExit(run(__file__, check_plan_scope_story_complete))
