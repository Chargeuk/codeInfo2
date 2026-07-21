#!/usr/bin/env python3
"""Contract tests preventing unbounded plan reads in implementation flows."""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
FLOW_ROOT = REPO_ROOT / "flows"
MARKDOWN_ROOT = REPO_ROOT / "codeinfo_markdown"
AGENT_ROOT = REPO_ROOT / "codeinfo_agents"
MARKDOWN_REFERENCE_RE = re.compile(
    r"(?:\$CODEINFO_ROOT/)?codeinfo_markdown/([A-Za-z0-9_./-]+\.md)"
)
FORBIDDEN_PLAN_READS = (
    re.compile(
        r"\b(?:open|read|scan|parse|load|re-?open|re-?read)\s+"
        r"(?:(?:the|that)\s+)?"
        r"(?:(?:exact|canonical|active|selected|referenced|whole|entire|full|complete|latest|relative)\s+)*"
        r"(?:`plan_path`|(?<![-/])plan(?:ning)?(?:\s+(?:markdown|file))?)\b",
        re.IGNORECASE,
    ),
    re.compile(r"\bread\s+the\s+(?:whole|entire|full)\s+plan\b", re.IGNORECASE),
    re.compile(r"\bread\s+the\s+end\s+of\s+the\s+plan\b", re.IGNORECASE),
    re.compile(
        r"\b(?:open|read|scan|parse|load|re-?open|re-?read)\b[^\n]{0,100}"
        r"(?<![-/])\bplan(?:ning)?(?:\s+(?:markdown|file))?\b[^\n]{0,80}\bfrom\s+disk\b",
        re.IGNORECASE,
    ),
)
FORBIDDEN_DOCUMENT_PLAN_READS = (
    re.compile(
        r"read all of the following from disk:[\s\S]{0,400}(?:canonical|active) plan",
        re.IGNORECASE,
    ),
)
NEGATION_GOVERNS_READ_RE = re.compile(
    r"\b(?:do not|must not|never|without)\b"
    r"(?:(?![.;:]|\bbut\b|\bhowever\b|\bthen\b).){0,100}$",
    re.IGNORECASE,
)
HELPER_INTERNAL_READ_RE = re.compile(
    r"\bhelper\s+may\b.*\binternally\b", re.IGNORECASE
)


def has_unnegated_forbidden_plan_read(line: str) -> bool:
    if HELPER_INTERNAL_READ_RE.search(line):
        return False
    for pattern in FORBIDDEN_PLAN_READS:
        for match in pattern.finditer(line):
            if NEGATION_GOVERNS_READ_RE.search(line[: match.start()]):
                continue
            return True
    return False


def walk_steps(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for step in steps:
        output.append(step)
        nested = step.get("steps")
        if isinstance(nested, list):
            output.extend(walk_steps(nested))
    return output


def referenced_flow_names(value: Any) -> set[str]:
    references: set[str] = set()
    if isinstance(value, dict):
        for key, entry in value.items():
            if key == "flowName" and isinstance(entry, str):
                references.add(entry)
            elif key == "flowNames" and isinstance(entry, list):
                references.update(item for item in entry if isinstance(item, str))
            references.update(referenced_flow_names(entry))
    elif isinstance(value, list):
        for entry in value:
            references.update(referenced_flow_names(entry))
    return references


def reachable_assets(flow_name: str) -> tuple[set[Path], list[str]]:
    markdown: set[Path] = set()
    inline_text: list[str] = []
    pending = [flow_name]
    visited: set[str] = set()
    while pending:
        current = pending.pop()
        if current in visited:
            continue
        visited.add(current)
        payload = json.loads((FLOW_ROOT / f"{current}.json").read_text())
        for step in walk_steps(payload.get("steps", [])):
            markdown_file = step.get("markdownFile")
            if isinstance(markdown_file, str):
                markdown.add(MARKDOWN_ROOT / markdown_file)
            command_name = step.get("commandName")
            agent_type = step.get("agentType")
            if isinstance(command_name, str) and isinstance(agent_type, str):
                command_path = (
                    AGENT_ROOT / agent_type / "commands" / f"{command_name}.json"
                )
                command = json.loads(command_path.read_text())
                for item in command.get("items", []):
                    item_markdown = item.get("markdownFile")
                    if isinstance(item_markdown, str):
                        markdown.add(MARKDOWN_ROOT / item_markdown)
                    content = item.get("content")
                    if isinstance(content, str):
                        inline_text.append(content)
            pending.extend(referenced_flow_names(step))
            question = step.get("question")
            if isinstance(question, str):
                inline_text.append(question)
            messages = step.get("messages")
            if isinstance(messages, list):
                inline_text.append(json.dumps(messages))

    markdown_pending = list(markdown)
    while markdown_pending:
        path = markdown_pending.pop()
        text = path.read_text()
        for match in MARKDOWN_REFERENCE_RE.finditer(text):
            referenced = MARKDOWN_ROOT / match.group(1)
            if referenced not in markdown:
                markdown.add(referenced)
                markdown_pending.append(referenced)
    return markdown, inline_text


class PlanReadPolicyTests(unittest.TestCase):
    def test_reachable_prompts_forbid_unbounded_plan_reads(self) -> None:
        failures: list[str] = []
        for flow_name in ("implement_next_plan", "implement_current_plan"):
            markdown, inline_text = reachable_assets(flow_name)
            for path in sorted(markdown):
                text = path.read_text()
                for line_no, line in enumerate(text.splitlines(), start=1):
                    if has_unnegated_forbidden_plan_read(line):
                        failures.append(
                            f"{flow_name}:{path.relative_to(REPO_ROOT)}:{line_no}: {line}"
                        )
                if any(
                    pattern.search(text) for pattern in FORBIDDEN_DOCUMENT_PLAN_READS
                ):
                    failures.append(
                        f"{flow_name}:{path.relative_to(REPO_ROOT)}: document-level read"
                    )
            for index, text in enumerate(inline_text):
                for line in text.splitlines():
                    if has_unnegated_forbidden_plan_read(line):
                        failures.append(f"{flow_name}:inline[{index}]: {line}")
        self.assertEqual(failures, [])

    def test_every_reachable_plan_sections_call_imports_bounded_contract(self) -> None:
        failures: list[str] = []
        for flow_name in ("implement_next_plan", "implement_current_plan"):
            markdown, inline_text = reachable_assets(flow_name)
            for path in sorted(markdown):
                text = path.read_text()
                if path == MARKDOWN_ROOT / "shared/bounded-plan-read.md":
                    continue
                if (
                    "plan_sections.py" in text
                    and "shared/bounded-plan-read.md" not in text
                ):
                    failures.append(f"{flow_name}:{path.relative_to(REPO_ROOT)}")
            for index, text in enumerate(inline_text):
                if (
                    "plan_sections.py" in text
                    and "shared/bounded-plan-read.md" not in text
                ):
                    failures.append(f"{flow_name}:inline[{index}]")
        self.assertEqual(failures, [])

    def test_current_plan_flow_uses_only_the_current_plan_repair_prompt(self) -> None:
        markdown, _ = reachable_assets("implement_current_plan")

        self.assertIn(
            MARKDOWN_ROOT / "repair_current_plan_workflow_state.md", markdown
        )
        self.assertNotIn(MARKDOWN_ROOT / "store_current_plan_handoff.md", markdown)
        self.assertNotIn(MARKDOWN_ROOT / "repair_story_workflow_state.md", markdown)

    def test_generic_review_agents_remain_reachable_from_policy_walk(self) -> None:
        markdown, _ = reachable_assets("implement_next_plan")
        self.assertIn(
            MARKDOWN_ROOT / "run_deep_review_visual_workspace.md", markdown
        )
        self.assertIn(
            MARKDOWN_ROOT / "run_deep_review_evidence_workspace.md", markdown
        )
        self.assertIn(
            MARKDOWN_ROOT / "run_deep_review_findings_workspace.md", markdown
        )
        self.assertIn(
            MARKDOWN_ROOT / "run_deep_review_saturation_workspace.md", markdown
        )
        self.assertIn(
            MARKDOWN_ROOT / "run_deep_review_blindspot_workspace.md", markdown
        )

    def test_review_tasking_and_repair_prompts_remain_reachable(self) -> None:
        markdown, _ = reachable_assets("implement_next_plan")
        expected = (
            "settle_agent_native_review_pass.md",
            "apply_agent_native_review_settlement.md",
            "audit_agent_native_review_settlement.md",
            "repair_story_workflow_state.md",
            "promote_story_manual_proof.md",
        )
        for relative_path in expected:
            self.assertIn(MARKDOWN_ROOT / relative_path, markdown)

    def test_remaining_review_prompts_enforce_bounded_plan_access(self) -> None:
        enhancement_paths = (
            "review_task_enhancement/02b-risk-and-prerequisite-scan.md",
            "review_task_enhancement/03-finalize.md",
            "review_task_enhancement/05-compact-granularity.md",
            "review_task_enhancement/07-compact-proof-expansion.md",
            "review_task_enhancement/09-compact-proof-and-testing.md",
        )
        for relative_path in enhancement_paths:
            text = (MARKDOWN_ROOT / relative_path).read_text()
            self.assertIn('plan_sections.py" --profile review-tasking', text)
            self.assertNotIn("re-read the selected plan", text.lower())

        for relative_path in (
            "repair_story_workflow_state.md",
            "repair_review_workflow_state.md",
        ):
            text = (MARKDOWN_ROOT / relative_path).read_text()
            self.assertIn("test -f <resolved-plan-path>", text)
            self.assertIn("test -r <resolved-plan-path>", text)
            self.assertIn("git -C <repository-path> rev-parse", text)
            self.assertNotIn("re-open the referenced plan", text.lower())

        promotion = (MARKDOWN_ROOT / "promote_story_manual_proof.md").read_text()
        self.assertIn('plan_sections.py" --profile closeout', promotion)
        self.assertNotIn("reopened from disk", promotion.lower())

    def test_forbidden_patterns_cover_indirect_whole_plan_wording(self) -> None:
        unsafe_samples = (
            "Re-read the selected plan from disk before editing.",
            "Re-open the referenced plan before continuing.",
            "Read the complete planning file.",
            "Scan the entire plan Markdown from disk.",
        )
        for sample in unsafe_samples:
            self.assertTrue(
                any(pattern.search(sample) for pattern in FORBIDDEN_PLAN_READS),
                sample,
            )

    def test_negation_must_govern_the_forbidden_read(self) -> None:
        safe_samples = (
            "Do not read the entire plan Markdown file.",
            "Never re-open the selected plan.",
        )
        for sample in safe_samples:
            self.assertFalse(has_unnegated_forbidden_plan_read(sample), sample)

        unsafe = "Do not consider this safe; re-open the selected plan."
        self.assertTrue(has_unnegated_forbidden_plan_read(unsafe))

    def test_bounded_fallback_supplies_numeric_max_count(self) -> None:
        text = (MARKDOWN_ROOT / "shared/bounded-plan-read.md").read_text()
        self.assertRegex(
            text,
            r"rg -n --max-count \d+ '<heading-or-term>' <plan-path>",
        )


if __name__ == "__main__":
    unittest.main()
