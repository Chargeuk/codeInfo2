#!/usr/bin/env python3
"""Choose a story number while sharing plan IDs across branch namespaces.

Remote branches reserve numbers only for peers under the selected Git prefix.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path


PLAN_NAME = re.compile(r"^(\d{7})-.+\.md$")
BRANCH_NAME = re.compile(r"^(\d{7})(?:-|$)")


def git(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args], text=True, capture_output=True, check=check, timeout=30
    )


def branch_number(branch: str, namespace: str) -> int | None:
    if not branch.startswith(namespace):
        return None
    match = BRANCH_NAME.match(branch[len(namespace) :])
    return int(match.group(1)) if match else None


def select_number(owned_plan: Path | None = None) -> dict[str, object]:
    branch = git("branch", "--show-current").stdout.strip()
    if not branch:
        raise ValueError("A checked-out branch is required")
    namespace = branch.rpartition("/")[0]
    namespace = f"{namespace}/" if namespace else "feature/"
    planning = Path.cwd() / "planning"
    if owned_plan is not None:
        owned_plan = owned_plan.resolve()
        if (
            owned_plan.parent != planning.resolve()
            or not PLAN_NAME.match(owned_plan.name)
            or not owned_plan.is_file()
        ):
            raise ValueError("--owned-plan must name an existing numbered file in planning/")

    plan_numbers = {
        int(match.group(1))
        for path in planning.glob("*.md")
        if path.resolve() != owned_plan
        if (match := PLAN_NAME.match(path.name))
    }
    local = git("for-each-ref", "--format=%(refname:short)", "refs/heads").stdout.splitlines()
    remote = git("ls-remote", "--heads", "origin", check=False)
    warnings: list[str] = []
    remote_verified = remote.returncode == 0
    if remote_verified:
        remote_branches = [
            line.split("\t", 1)[1].removeprefix("refs/heads/")
            for line in remote.stdout.splitlines()
            if "\trefs/heads/" in line
        ]
    else:
        warnings.append(
            "Live origin heads unavailable; using cached origin refs. "
            "The selected number may collide with a remote branch."
        )
        remote_branches = [
            name.removeprefix("origin/")
            for name in git(
                "for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"
            ).stdout.splitlines()
        ]

    # The current branch is our own claim; another name with that number is a collision.
    occupied_branches = {
        number
        for name in (*local, *remote_branches)
        if name != branch
        if (number := branch_number(name, namespace)) is not None
    }
    current_number = branch_number(branch, namespace)
    reuse = (
        current_number is not None
        and current_number not in plan_numbers
        and current_number not in occupied_branches
    )
    if reuse:
        number = current_number
    else:
        all_numbers = plan_numbers | occupied_branches
        if current_number is not None:
            all_numbers.add(current_number)
        number = max(all_numbers, default=0) + 1
    if number > 9_999_999:
        raise ValueError("No seven-digit story number is available")
    return {
        "current_branch": branch,
        "namespace": namespace,
        "number": f"{number:07d}",
        "reuse_current_branch": reuse,
        "remote_verified": remote_verified,
        "warnings": warnings,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--owned-plan", type=Path, help="Existing plan created by this flow; exclude it"
    )
    args = parser.parse_args()
    try:
        print(json.dumps(select_number(args.owned_plan), separators=(",", ":")))
    except (ValueError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        parser.exit(1, f"Story number selection failed: {error}\n")


if __name__ == "__main__":
    main()
