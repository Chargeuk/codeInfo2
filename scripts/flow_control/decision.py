"""Common result handling for deterministic flow-control wrappers."""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable, Literal


Answer = Literal["yes", "no"]


@dataclass(frozen=True)
class DecisionOutcome:
    answer: Answer
    reason_code: str
    details: dict[str, Any] = field(default_factory=dict)


def yes(reason_code: str, **details: Any) -> DecisionOutcome:
    return DecisionOutcome(answer="yes", reason_code=reason_code, details=details)


def no(reason_code: str, **details: Any) -> DecisionOutcome:
    return DecisionOutcome(answer="no", reason_code=reason_code, details=details)


def _write_debug_sidecar(script_path: str, outcome: DecisionOutcome) -> None:
    debug_dir = os.environ.get("CODEINFO_FLOW_CONTROL_DEBUG_DIR")
    if not debug_dir:
        return

    target_dir = Path(debug_dir).expanduser()
    target_dir.mkdir(parents=True, exist_ok=True)
    sidecar_path = target_dir / f"{Path(script_path).stem}.json"
    sidecar_path.write_text(
        json.dumps(
            {
                "script": script_path,
                "evaluated_at_utc": datetime.now(UTC).isoformat(),
                "answer": outcome.answer,
                "reason_code": outcome.reason_code,
                "details": outcome.details,
            },
            indent=2,
        )
        + "\n"
    )


def emit(script_path: str, outcome: DecisionOutcome) -> int:
    _write_debug_sidecar(script_path, outcome)
    json.dump({"answer": outcome.answer}, fp=sys.stdout, separators=(",", ":"))
    sys.stdout.write("\n")
    return 0


def run(script_path: str, evaluator: Callable[[], DecisionOutcome]) -> int:
    return emit(script_path, evaluator())
