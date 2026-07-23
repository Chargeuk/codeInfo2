#!/usr/bin/env python3

from __future__ import annotations

import sys
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from check_review_plan_contract import inspect_plan


class ReviewPlanContractTests(unittest.TestCase):
    def test_rejects_unfinished_task_that_invokes_final_review(self) -> None:
        result = inspect_plan(
            """### Task 3. Implement

- Task Status: `__in_progress__`

#### Subtasks

1. [ ] Run `npm run review:cycle:summary -- --working-folder /repo`.
"""
        )

        self.assertFalse(result["valid"])
        self.assertEqual(result["violations"][0]["task_number"], 3)

    def test_allows_checked_historical_review_and_diagnostic_wording(self) -> None:
        result = inspect_plan(
            """### Task 3. Implement

- Task Status: `__done__`

#### Subtasks

1. [x] Run `two_phase_review_cycle` after completion.
2. [ ] Run the individual diagnostic reviewer flow.
"""
        )

        self.assertTrue(result["valid"])


if __name__ == "__main__":
    unittest.main()
