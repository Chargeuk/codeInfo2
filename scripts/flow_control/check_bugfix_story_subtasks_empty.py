#!/usr/bin/env python3
"""Return yes when the bugfix-story flow has no safely workable subtask."""

from __future__ import annotations

from _bootstrap import ensure_scripts_on_path

ensure_scripts_on_path()

from flow_control.bugfix_story import evaluate_bugfix_story_subtasks_empty
from flow_control.decision import run


if __name__ == "__main__":
    raise SystemExit(
        run(__file__, evaluate_bugfix_story_subtasks_empty)
    )
