#!/usr/bin/env python3
"""Bind the next eligible Jira bugfix-story subtask and print it as JSON."""

from __future__ import annotations

import json

from _bootstrap import ensure_scripts_on_path

ensure_scripts_on_path()

from flow_control.bugfix_story import bind_next_bugfix_subtask_payload


if __name__ == "__main__":
    print(
        json.dumps(
            bind_next_bugfix_subtask_payload(),
            ensure_ascii=False,
            separators=(",", ":"),
        )
    )
