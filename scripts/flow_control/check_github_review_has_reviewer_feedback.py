#!/usr/bin/env python3
import json
from pathlib import Path


def main() -> int:
    repo_root = Path.cwd()
    current_plan_path = repo_root / "codeInfoStatus/flow-state/current-plan.json"
    current_plan = json.loads(current_plan_path.read_text(encoding="utf-8"))
    plan_path = str(current_plan.get("plan_path", "")).strip()
    story_number = Path(plan_path).name.split("-", 1)[0]
    if not story_number:
        raise RuntimeError("current-plan handoff does not expose a story number")

    reviews_dir = repo_root / "codeInfoTmp/reviews"
    handoff_path = reviews_dir / f"{story_number}-github-review-current.json"
    if not handoff_path.exists():
        handoff_path = reviews_dir / f"{story_number}-current-review.json"
    handoff = json.loads(handoff_path.read_text(encoding="utf-8"))
    review_count = int(handoff.get("filtered_review_count", 0) or 0)
    comment_count = int(handoff.get("filtered_review_comment_count", 0) or 0)

    answer = "yes" if (review_count + comment_count) > 0 else "no"
    print(json.dumps({"answer": answer}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
