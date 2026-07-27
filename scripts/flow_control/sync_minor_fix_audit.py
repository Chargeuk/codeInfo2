#!/usr/bin/env python3
"""Synchronize one terminal minor-fix result into durable per-pass audit state."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from minor_fix_audit import sync_minor_fix_audit, validate_minor_fix_audits, write_json_atomic


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--working-folder", default=".")
    parser.add_argument(
        "--state",
        default="codeInfoStatus/flow-state/review-disposition-state.json",
    )
    parser.add_argument(
        "--result",
        default="codeInfoStatus/flow-state/minor-review-fix-result.json",
    )
    args = parser.parse_args()
    root = Path(args.working_folder).resolve()
    state_path = (root / args.state).resolve()
    result_path = (root / args.result).resolve()
    state = json.loads(state_path.read_text(encoding="utf-8"))
    result = json.loads(result_path.read_text(encoding="utf-8"))
    updated = sync_minor_fix_audit(state, result)
    valid, reason = validate_minor_fix_audits(updated)
    if not valid:
        raise ValueError(reason)
    write_json_atomic(state_path, updated)
    print(
        json.dumps(
            {
                "status": "synchronized",
                "review_cycle_id": updated["review_cycle_id"],
                "review_pass_id": updated["review_pass_id"],
                "audit_count": len(updated["minor_fix_pass_audits"]),
                "validation": reason,
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
