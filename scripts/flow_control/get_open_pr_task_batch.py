#!/usr/bin/env python3
"""Print the complete current workable pull-request task batch as JSON."""

from __future__ import annotations

import json

from _bootstrap import ensure_scripts_on_path

ensure_scripts_on_path()

from flow_control.pr_tasks import get_open_pr_task_batch_payload


if __name__ == "__main__":
    print(
        json.dumps(
            get_open_pr_task_batch_payload(),
            ensure_ascii=False,
            separators=(",", ":"),
        )
    )
