#!/usr/bin/env python3
"""Return yes only when the selected bugfix needs no screenshot proof."""

from __future__ import annotations

from _bootstrap import ensure_scripts_on_path

ensure_scripts_on_path()

from flow_control.bugfix_story import (
    evaluate_bugfix_screenshot_proof_unneeded,
)
from flow_control.decision import run


if __name__ == "__main__":
    raise SystemExit(
        run(__file__, evaluate_bugfix_screenshot_proof_unneeded)
    )
