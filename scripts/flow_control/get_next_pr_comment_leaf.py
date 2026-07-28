#!/usr/bin/env python3
"""Print one globally ordered pull-request comment leaf as JSON."""

from __future__ import annotations

import json
import sys

from _bootstrap import ensure_scripts_on_path

ensure_scripts_on_path()

from flow_control.pr_comments import get_next_pr_comment_leaf_payload


def warn(message: str) -> None:
    print(f"PR comment selector warning: {message}", file=sys.stderr)


if __name__ == "__main__":
    print(
        json.dumps(
            get_next_pr_comment_leaf_payload(warn=warn),
            ensure_ascii=False,
            separators=(",", ":"),
        )
    )
