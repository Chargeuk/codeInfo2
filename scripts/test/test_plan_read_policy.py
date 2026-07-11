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
        r"\b(?:re-?open|re-?read)\s+(?:(?:the|that)\s+)?(?:exact\s+|canonical\s+|active\s+)?(?:relative\s+)?(?:`plan_path`|plan(?:\s+file)?)",
        re.IGNORECASE,
    ),
    re.compile(r"\bread\s+the\s+(?:whole|entire|full)\s+plan\b", re.IGNORECASE),
    re.compile(r"\bread\s+the\s+end\s+of\s+the\s+plan\b", re.IGNORECASE),
)
FORBIDDEN_DOCUMENT_PLAN_READS = (
    re.compile(
        r"read all of the following from disk:[\s\S]{0,400}(?:canonical|active) plan",
        re.IGNORECASE,
    ),
)
NEGATION_RE = re.compile(r"\b(?:do not|must not|never|without)\b", re.IGNORECASE)


def walk_steps(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for step in steps:
        output.append(step)
        nested = step.get("steps")
        if isinstance(nested, list):
            output.extend(walk_steps(nested))
    return output


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
            flow_names = step.get("flowNames")
            if isinstance(flow_names, list):
                pending.extend(item for item in flow_names if isinstance(item, str))
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
        markdown, inline_text = reachable_assets("implement_next_plan")
        failures: list[str] = []
        for path in sorted(markdown):
            text = path.read_text()
            for line_no, line in enumerate(text.splitlines(), start=1):
                if NEGATION_RE.search(line):
                    continue
                if any(pattern.search(line) for pattern in FORBIDDEN_PLAN_READS):
                    failures.append(f"{path.relative_to(REPO_ROOT)}:{line_no}: {line}")
            if any(pattern.search(text) for pattern in FORBIDDEN_DOCUMENT_PLAN_READS):
                failures.append(f"{path.relative_to(REPO_ROOT)}: document-level read")
        for index, text in enumerate(inline_text):
            for line in text.splitlines():
                if NEGATION_RE.search(line):
                    continue
                if any(pattern.search(line) for pattern in FORBIDDEN_PLAN_READS):
                    failures.append(f"inline[{index}]: {line}")
        self.assertEqual(failures, [])

    def test_every_reachable_plan_sections_call_imports_bounded_contract(self) -> None:
        markdown, inline_text = reachable_assets("implement_next_plan")
        failures: list[str] = []
        for path in sorted(markdown):
            text = path.read_text()
            if path == MARKDOWN_ROOT / "shared/bounded-plan-read.md":
                continue
            if "plan_sections.py" in text and "shared/bounded-plan-read.md" not in text:
                failures.append(str(path.relative_to(REPO_ROOT)))
        for index, text in enumerate(inline_text):
            if "plan_sections.py" in text and "shared/bounded-plan-read.md" not in text:
                failures.append(f"inline[{index}]")
        self.assertEqual(failures, [])

    def test_review_artifact_agents_remain_reachable_from_policy_walk(self) -> None:
        markdown, _ = reachable_assets("implement_next_plan")
        self.assertIn(
            MARKDOWN_ROOT / "review_visual_design_conformance.md", markdown
        )
        self.assertIn(MARKDOWN_ROOT / "review_evidence_gate/01-core.md", markdown)
        self.assertIn(MARKDOWN_ROOT / "code_review_findings/01-core.md", markdown)
        self.assertIn(MARKDOWN_ROOT / "review_findings_saturation.md", markdown)
        self.assertIn(
            MARKDOWN_ROOT / "review_blind_spot_challenge/01-core.md", markdown
        )


if __name__ == "__main__":
    unittest.main()
