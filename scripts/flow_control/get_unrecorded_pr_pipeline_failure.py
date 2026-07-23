#!/usr/bin/env python3
"""Print the current unrecorded PR pipeline failure as bounded JSON."""

from __future__ import annotations

import json

from _bootstrap import ensure_scripts_on_path

ensure_scripts_on_path()

from flow_control.pr_pipelines import (
    get_unrecorded_pr_pipeline_failure_payload,
)


if __name__ == "__main__":
    print(
        json.dumps(
            get_unrecorded_pr_pipeline_failure_payload(),
            ensure_ascii=False,
            separators=(",", ":"),
        )
    )
