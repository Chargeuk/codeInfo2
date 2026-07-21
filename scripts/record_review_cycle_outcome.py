#!/usr/bin/env python3
"""Record an agent-decided outcome for the active final review cycle."""

from __future__ import annotations

import argparse
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from flow_state_utils import ScopeResolutionError, load_json_file, load_plan_scope


ACTIVE_REVIEW_CYCLE_SCHEMA_VERSION = "codeinfo-active-review-cycle/v2"
ACTIVE_REVIEW_CYCLE_PATH = Path(
    "codeInfoStatus/flow-state/active-review-cycle.json"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Record completed or incomplete control state for the active final "
            "review cycle without inspecting review output."
        )
    )
    parser.add_argument("--status", choices=("completed", "incomplete"), required=True)
    parser.add_argument("--reason", help="Honest explanation for an incomplete outcome.")
    parser.add_argument(
        "--cycle-id",
        help="Expected active review cycle ID; rejects a stale settlement attempt.",
    )
    parser.add_argument(
        "--repo-root",
        default=".",
        help="Repository containing codeInfoStatus (default: current directory).",
    )
    return parser.parse_args()


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary:
            temporary_name = temporary.name
            json.dump(payload, temporary, indent=2)
            temporary.write("\n")
            temporary.flush()
            os.fsync(temporary.fileno())
        os.replace(temporary_name, path)
    finally:
        if temporary_name is not None:
            Path(temporary_name).unlink(missing_ok=True)


def record_review_cycle_outcome(
    *,
    repo_root: str | Path,
    status: str,
    reason: str | None = None,
    expected_cycle_id: str | None = None,
    completed_at: datetime | None = None,
) -> dict[str, Any]:
    root = Path(repo_root).resolve()
    scope = load_plan_scope(repo_root=root)
    active_path = root / ACTIVE_REVIEW_CYCLE_PATH
    active = load_json_file(active_path)

    required_values = {
        "schema_version": ACTIVE_REVIEW_CYCLE_SCHEMA_VERSION,
        "review_mode": "final",
        "story_id": scope.get("story_id"),
        "plan_path": scope["plan_path_raw"],
    }
    for field, expected in required_values.items():
        if active.get(field) != expected:
            raise ScopeResolutionError(
                f"active review cycle {field} did not match current scope"
            )

    cycle_id = active.get("review_cycle_id")
    if not isinstance(cycle_id, str) or not cycle_id.strip():
        raise ScopeResolutionError("active review cycle lacked a usable review_cycle_id")
    if expected_cycle_id is not None and cycle_id != expected_cycle_id:
        raise ScopeResolutionError(
            "active review cycle changed before the outcome could be recorded"
        )
    if status == "incomplete" and not (reason or "").strip():
        raise ScopeResolutionError("an incomplete review outcome requires --reason")

    recorded_at = completed_at or datetime.now(timezone.utc)
    updated = dict(active)
    updated["status"] = status
    updated["completed_at"] = recorded_at.isoformat().replace("+00:00", "Z")
    if status == "incomplete":
        updated["incomplete_reason"] = (reason or "").strip()
    else:
        updated.pop("incomplete_reason", None)
    _atomic_write_json(active_path, updated)
    return updated


def main() -> int:
    args = parse_args()
    try:
        result = record_review_cycle_outcome(
            repo_root=args.repo_root,
            status=args.status,
            reason=args.reason,
            expected_cycle_id=args.cycle_id,
        )
    except ScopeResolutionError as exc:
        json.dump({"ok": False, "error": str(exc)}, __import__("sys").stdout)
        __import__("sys").stdout.write("\n")
        return 2
    json.dump(
        {
            "ok": True,
            "review_cycle_id": result["review_cycle_id"],
            "status": result["status"],
            "completed_at": result["completed_at"],
            **(
                {"incomplete_reason": result["incomplete_reason"]}
                if "incomplete_reason" in result
                else {}
            ),
        },
        __import__("sys").stdout,
    )
    __import__("sys").stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
