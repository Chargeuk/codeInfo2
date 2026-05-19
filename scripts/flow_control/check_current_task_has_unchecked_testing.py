#!/usr/bin/env python3
"""Return yes when the bound current task still has unchecked testing only."""

from __future__ import annotations

from _bootstrap import ensure_scripts_on_path

ensure_scripts_on_path()

from flow_control.current_task import check_current_task_has_unchecked_testing
from flow_control.decision import run


if __name__ == "__main__":
    raise SystemExit(run(__file__, check_current_task_has_unchecked_testing))
