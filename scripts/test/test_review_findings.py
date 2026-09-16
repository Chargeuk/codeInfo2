#!/usr/bin/env python3
"""History extraction must retain evidence without merging reused identities."""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import review_findings


def finding(batch="old", repository="primary", finding_id="R1", description="Preserve the created PR URL."):
    return f"""## Code Review Findings
- Review batch: `{batch}`
### Accepted
#### 1. Lookup failure loses successful creation
- Finding ID: `{finding_id}`
- Repository: `{repository}`
- Simple description: {description}
- Example: Creation succeeds but metadata lookup fails.
- Why accepted: The current contract preserves the created PR identity.
### Ignored for This Story
#### 2. Unrelated hardening
- Finding ID: `ignored`
- Simple description: Never promote this into history matching.
"""


class ReviewFindingTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.plan = self.root / "plan.md"

    def query(self, text, mode="list", reference=None, exclude="current"):
        self.plan.write_text(text)
        return review_findings.query(self.plan, mode, exclude, reference)

    def test_excludes_current_and_ignored_without_merging_reused_ids(self):
        text = finding() + finding("other", "secondary") + finding("current")
        result = self.query(text)
        self.assertEqual(result["coverage"], "complete")
        self.assertEqual([r["review_id"] for r in result["findings"]], ["old", "other"])
        self.assertEqual([r["finding_id"] for r in result["findings"]], ["R1", "R1"])
        self.assertEqual([r["repositories"] for r in result["findings"]], [["primary"], ["secondary"]])
        self.assertNotEqual(*[r["reference"] for r in result["findings"]])
        self.assertNotIn("markdown", result["findings"][0]["source"])

    def test_expansion_keeps_full_block_and_only_batch_linked_task_evidence(self):
        text = finding() + """
### Task 1. Repair old
- Review Batch: `old`
#### Addresses Findings
- Finding `1` in primary: retain the created PR.
#### Subtasks
- Some unrelated implementation checklist.
#### Implementation Notes
- Commit abc123 fixed it; final validation later revised it.
### Task 2. Repair other
- Review Batch: `other`
#### Addresses Findings
- `R1` in secondary.
#### Implementation Notes
- Must not associate this reused ID with old.
"""
        reference = self.query(text)["findings"][0]["reference"]
        result = self.query(text, "expand", reference)
        self.assertIn("Why accepted:", result["finding"]["source"]["markdown"])
        self.assertNotIn("Ignored for This Story", result["finding"]["source"]["markdown"])
        self.assertEqual([t["task_number"] for t in result["repair_evidence"]], [1])
        packet = json.dumps(result["repair_evidence"])
        self.assertIn("abc123", packet)
        self.assertIn("Finding `1`", packet)
        self.assertNotIn("unrelated implementation checklist", packet)
        self.assertIn("semantic inspection", result["warnings"][0])

    def test_missing_fields_are_retained_as_partial_evidence(self):
        text = finding().replace("- Finding ID: `R1`\n", "").replace("- Repository: `primary`\n", "").replace("- Simple description: Preserve the created PR URL.\n", "")
        result = self.query(text)
        self.assertEqual(result["coverage"], "partial")
        self.assertEqual(len(result["findings"]), 1)
        self.assertEqual(len(result["findings"][0]["limitations"]), 3)

    def test_unstructured_and_empty_sections_do_not_claim_clean_history(self):
        text = "## Code Review Findings\n### Accepted\nUnformatted previous issue.\n### Ignored for This Story\nIgnored.\n"
        result = self.query(text)
        self.assertEqual(result["coverage"], "partial")
        self.assertEqual(result["findings"][0]["title"], "Unformatted previous issue.")
        result = self.query("## Code Review Findings\n### Accepted\n")
        self.assertEqual(result["coverage"], "partial")
        self.assertTrue(result["warnings"])

    def test_empty_category_none_is_complete_but_legacy_missing_category_warns(self):
        self.assertEqual(self.query("## Code Review Findings\n### Accepted\n- None.\n")["coverage"], "complete")
        result = self.query("## Code Review Findings\n### Review Pass `legacy`\nUnstructured accepted repairs.\n")
        self.assertEqual(result["coverage"], "partial")
        self.assertIn("legacy", result["warnings"][0]["reason"])

    def test_legacy_pass_and_wrapped_bold_fields_are_preserved(self):
        text = finding().replace("- Review batch: `old`", "### Review Pass `legacy-pass`")
        text = text.replace("- Simple description: Preserve the created PR URL.", "- **Simple description:** Preserve the URL\n  when lookup fails.")
        result = self.query(text)
        self.assertEqual(result["findings"][0]["review_id"], "legacy-pass")
        self.assertEqual(result["findings"][0]["simple_description"], "Preserve the URL when lookup fails.")
        self.assertEqual(self.query(text, exclude="legacy-pass")["findings"], [])

    def test_multiple_legacy_passes_have_distinct_identity(self):
        section = finding().split("### Accepted", 1)[1]
        text = "## Code Review Findings\n### Review Pass `first`\n### Accepted" + section + "\n### Review Pass `second`\n### Accepted" + section
        result = self.query(text, exclude="second")
        self.assertEqual([r["review_id"] for r in result["findings"]], ["first"])

    def test_repository_provenance_comes_from_explicit_job_target(self):
        text = finding().replace("- Repository: `primary`", "- Review harnesses:\n  - Codex (`codex_review`, job `target_reviews:secondary:codex_review`)")
        self.assertEqual(self.query(text)["findings"][0]["repositories"], ["secondary"])

    def test_finding_id_qualifier_keeps_text_without_unmatched_markdown(self):
        text = finding().replace("- Finding ID: `R1`", "- Finding ID: `7` (accepted core only)")
        self.assertEqual(self.query(text)["findings"][0]["finding_id"], "7 (accepted core only)")

    def test_stale_reference_is_unavailable_instead_of_wrong_finding(self):
        reference = self.query(finding())["findings"][0]["reference"]
        result = self.query(finding(description="Different issue now."), "expand", reference)
        self.assertEqual(result["coverage"], "unavailable")
        self.assertEqual(result["findings"], [])

    def test_review_prefix_does_not_link_unrelated_task(self):
        text = finding() + "### Task 1. Different\n- Review Batch: `old-extra`\n#### Addresses Findings\n- R1\n"
        reference = self.query(text)["findings"][0]["reference"]
        result = self.query(text, "expand", reference)
        self.assertEqual(result["repair_evidence"], [])
        self.assertEqual(result["coverage"], "partial")

    def test_cli_default_handoff_and_unavailable_input_are_read_only(self):
        self.plan.write_text(finding())
        state = self.root / "codeInfoStatus" / "flow-state"
        state.mkdir(parents=True)
        handoff = state / "current-plan.json"
        handoff.write_text(json.dumps({"plan_path": "plan.md"}))
        command = [sys.executable, str(ROOT / "scripts/review_findings.py"), "list", "--exclude-batch", "current"]
        before = self.plan.read_bytes()
        result = subprocess.run(command, cwd=self.root, capture_output=True, text=True, check=True)
        self.assertEqual(len(json.loads(result.stdout)["findings"]), 1)
        self.assertEqual(before, self.plan.read_bytes())
        handoff.write_text("invalid")
        result = subprocess.run(command, cwd=self.root, capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(result.stdout)["coverage"], "unavailable")

    def test_cli_requires_explicit_current_batch(self):
        result = subprocess.run([sys.executable, str(ROOT / "scripts/review_findings.py"), "list"], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--exclude-batch", result.stderr)


if __name__ == "__main__":
    unittest.main()
