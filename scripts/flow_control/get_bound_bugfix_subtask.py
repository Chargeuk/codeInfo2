#!/usr/bin/env python3
"""Print the currently bound Jira bugfix-story subtask as JSON."""

from __future__ import annotations

import json

from _bootstrap import ensure_scripts_on_path

ensure_scripts_on_path()

from flow_control.bugfix_story import get_bound_bugfix_subtask_payload


if __name__ == "__main__":
    print(
        json.dumps(
            get_bound_bugfix_subtask_payload(),
            ensure_ascii=False,
            separators=(",", ":"),
        )
    )
