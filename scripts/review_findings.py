#!/usr/bin/env python3
"""Read compact accepted-finding history or expand one exact source record.

Run from the target repository. This helper never modifies the plan, infers a
semantic duplicate, or treats an accepted finding as a completed repair.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

from plan_status import resolve_plan_path


HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
TASK = re.compile(r"^### Task (\d+)\.\s*(.*)$")


def clean(value: str) -> str:
    return value.replace("`", "").strip().strip("*").strip()


def field(lines: list[str], name: str) -> str | None:
    """Accept plain or bold bullet labels, including wrapped descriptions."""
    pattern = re.compile(r"^\s*(?:[-*]\s+)?(?:\*\*)?" + name + r"(?:\*\*)?\s*:\s*(?:\*\*)?\s*(.*)$", re.I)
    for index, line in enumerate(lines):
        match = pattern.match(line)
        if match:
            parts = [match.group(1).strip()]
            for continuation in lines[index + 1:]:
                if not continuation.strip() or re.match(r"\s*(?:[-*]\s|#{1,6}\s)", continuation):
                    break
                parts.append(continuation.strip())
            return clean(" ".join(parts)) or None
    return None


def span(lines: list[str], start: int, end: int) -> dict:
    return {"start_line": start + 1, "end_line": end, "markdown": "\n".join(lines[start:end]).strip()}


def history(lines: list[str], exclude_batch: str | None = None) -> dict:
    records = []
    warnings = []
    headings = [(i, len(m[1]), m[2]) for i, line in enumerate(lines) if (m := HEADING.match(line))]
    # Tasks are siblings in these plans, even though their heading is level 3.
    boundaries = [i for i, level, title in headings if level <= 2 or TASK.match(lines[i])]
    for start, level, title in headings:
        if level != 2 or title.casefold() != "code review findings":
            continue
        end = next((i for i in boundaries if i > start), len(lines))
        block = lines[start:end]
        batch = field(block, r"Review batch")
        pass_id = field(block, r"Review pass(?: ID)?")
        pass_headers = [(i, clean(t[len("Review Pass"):])) for i, _, t in headings
                        if start < i < end and t.casefold().startswith("review pass ")]
        accepted_sections = [(i, depth) for i, depth, t in headings
                             if start < i < end and t.casefold() == "accepted"]
        if not accepted_sections and batch != exclude_batch:
            warnings.append({"start_line": start + 1, "end_line": end,
                             "reason": "No structured Accepted section; legacy review evidence requires bounded inspection."})
        for accepted, depth in accepted_sections:
            review = batch or next((value for i, value in reversed(pass_headers) if i < accepted), pass_id)
            if exclude_batch is not None and review == exclude_batch:
                continue
            section_end = next((i for i, d, _ in headings if accepted < i < end and d <= depth), end)
            content = "\n".join(lines[accepted + 1:section_end]).strip()
            if re.fullmatch(r"(?:[-*]\s*)?(?:None|No accepted findings)\.?", content, re.I):
                continue
            starts = [i for i, d, _ in headings if accepted < i < section_end and d == depth + 1]
            preamble = "\n".join(lines[accepted + 1:starts[0] if starts else section_end]).strip()
            if preamble:
                starts.insert(0, accepted + 1)
            if not starts:
                warnings.append({"start_line": accepted + 1, "end_line": section_end,
                                 "reason": "Empty Accepted section does not positively establish no findings."})
                continue
            for number, finding_start in enumerate(starts):
                finding_end = starts[number + 1] if number + 1 < len(starts) else section_end
                finding = lines[finding_start:finding_end]
                heading = HEADING.match(finding[0])
                title = heading[2] if heading else next((line.strip() for line in finding if line.strip()), "Untitled finding")
                finding_id = field(finding, r"Finding ID(?: or Review reference)?")
                description = field(finding, r"Simple description")
                repositories = []
                for label in (r"Repository", r"Target", r"Owning repository"):
                    value = field(finding, label)
                    if value:
                        repositories.append(value)
                # Job targets are explicit provenance, unlike a guessed plan-wide owner.
                repositories.extend(re.findall(r"\bjob\s+`[^`\s:]+:([^`\s:]+):[^`\s]+`", "\n".join(finding)))
                repositories = sorted(set(repositories))
                limitations = []
                if not heading:
                    limitations.append("Unstructured finding block; expand to inspect all preserved evidence.")
                for key, value in (("review identity", review), ("Finding ID", finding_id),
                                   ("Simple description", description), ("repository", repositories)):
                    if not value:
                        limitations.append(f"Missing {key}; expand the source before ruling out a match.")
                source = span(lines, finding_start, finding_end)
                digest = hashlib.sha256((str(review) + source["markdown"]).encode()).hexdigest()[:16]
                records.append({"reference": f"L{finding_start + 1}-{digest}",
                                "review_id": review, "repositories": repositories,
                                "finding_id": finding_id, "title": title,
                                "simple_description": description,
                                "source": source, "limitations": limitations})
    return {"coverage": "partial" if warnings or any(r["limitations"] for r in records) else "complete",
            "warnings": warnings, "findings": records}


def repair_evidence(lines: list[str], review_id: str | None) -> list[dict]:
    """Return bounded task evidence linked by review, never by a reused ID alone."""
    if not review_id:
        return []
    tasks = [(i, m[1], m[2]) for i, line in enumerate(lines) if (m := TASK.match(line))]
    results = []
    for index, number, title in tasks:
        end = next((i for i in range(index + 1, len(lines))
                    if TASK.match(lines[i]) or re.match(r"^#{1,2}\s", lines[i])), len(lines))
        task = lines[index:end]
        if not (f"`{review_id}`" in "\n".join(task) or field(task, r"Review (?:batch|pass(?: ID)?)") == review_id):
            continue
        sections = [(i, m[2]) for i in range(index + 1, end)
                    if (m := HEADING.match(lines[i])) and len(m[1]) == 4]
        packets = [span(lines, index, sections[0][0] if sections else end)]
        for section_index, (section_start, name) in enumerate(sections):
            if name.casefold() in {"addresses findings", "implementation notes", "review harnesses"}:
                section_end = sections[section_index + 1][0] if section_index + 1 < len(sections) else end
                packets.append(span(lines, section_start, section_end))
        results.append({"task_number": int(number), "title": title, "sections": packets,
                        "link_scope": "same review; inspect Addresses Findings semantically, not an inferred per-finding fix"})
    return results


def query(plan: Path, mode: str, exclude_batch: str | None, reference: str | None) -> dict:
    lines = plan.read_text().splitlines()
    result = history(lines, exclude_batch if mode == "list" else None)
    result["plan_path"] = str(plan)
    if mode == "list":
        for record in result["findings"]:
            del record["source"]["markdown"]
        return result
    matches = [r for r in result["findings"] if r["reference"] == reference]
    if not matches:
        return {"plan_path": str(plan), "coverage": "unavailable", "findings": [],
                "warnings": ["Reference not found or stale; rerun list and select its new exact reference."]}
    record = matches[0]
    evidence = repair_evidence(lines, record["review_id"])
    return {"plan_path": str(plan), "coverage": "partial" if record["limitations"] or not evidence else "complete",
            "finding": record, "repair_evidence": evidence,
            "warnings": ["Repair evidence is linked by review identity; reused or differing IDs require semantic inspection."
                         if evidence else "No related repair-task evidence found; this does not establish that the issue was never repaired."]}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("list", "expand"))
    parser.add_argument("--plan", help="Explicit target plan; defaults to the current-plan handoff.")
    parser.add_argument("--handoff", default="codeInfoStatus/flow-state/current-plan.json")
    parser.add_argument("--exclude-batch", help="Current batch/review identity; required for list.")
    parser.add_argument("--reference", help="Exact reference from list; required for expand.")
    args = parser.parse_args()
    if args.mode == "list" and not args.exclude_batch:
        parser.error("list requires --exclude-batch so the current batch cannot match itself")
    if args.mode == "expand" and not args.reference:
        parser.error("expand requires --reference")
    try:
        plan, _ = resolve_plan_path(args.plan, args.handoff)
        result = query(plan, args.mode, args.exclude_batch, args.reference)
    except (OSError, ValueError, TypeError, AttributeError, SystemExit) as exc:
        result = {"coverage": "unavailable", "findings": [], "warnings": [str(exc)]}
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()
