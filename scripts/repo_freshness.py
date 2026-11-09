#!/usr/bin/env python3
"""Report recorded ingest metadata and eligible local file mtimes, read-only."""

from __future__ import annotations

import argparse
import http.client
import json
import os
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone


# Keep these and the discovery rules aligned with server/src/ingest/{config,discovery}.ts.
DEFAULT_INCLUDES = (
    "ts tsx js jsx mjs cjs json jsonc md mdx txt py java kt kts go rs rb php cs "
    "cpp cc c h hpp swift scala clj cljs edn sh bash zsh ps1 yaml yml toml ini "
    "cfg env sql"
).split()
DEFAULT_EXCLUDES = ["node_modules", ".git", "dist", "build", "coverage", "logs", "vendor"]


def matches_exclude(relative_path: str, excludes: list[str]) -> bool:
    segments = relative_path.split(os.sep)
    base = segments[-1]
    for pattern in excludes:
        if not pattern:
            continue
        if "*" in pattern:
            # The server strips only a leading '*'; this is not glob matching.
            if base.endswith(pattern[1:] if pattern.startswith("*") else pattern):
                return True
        elif pattern in segments:
            return True
    return False


def git(root: str, *args: str) -> bytes:
    return subprocess.run(
        ["git", "-C", root, *args],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=15,
    ).stdout


def walk_files(root: str, excludes: list[str], errors: list[str]):
    # Only literal segment exclusions can prune directories: suffix patterns
    # apply to the final file basename, not ancestor directory names.
    excluded_directories = {pattern for pattern in excludes if pattern and "*" not in pattern}
    pending = [root]
    while pending:
        current = pending.pop()
        try:
            with os.scandir(current) as entries:
                for entry in entries:
                    try:
                        if entry.is_dir(follow_symlinks=False):
                            if entry.name not in excluded_directories:
                                pending.append(entry.path)
                        elif entry.is_file(follow_symlinks=False):
                            yield os.path.relpath(entry.path, root)
                    except OSError as exc:
                        errors.append(f"Cannot inspect {entry.path}: {exc}")
        except OSError as exc:
            errors.append(f"Cannot list {current}: {exc}")


def scan(root: str, includes: list[str], excludes: list[str], errors: list[str]):
    warnings = []
    try:
        git_root = os.fsdecode(git(root, "rev-parse", "--show-toplevel")).strip()
        repo_root = os.path.abspath(git_root) if git_root else root
    except (OSError, subprocess.SubprocessError) as exc:
        repo_root = root
        warnings.append(f"git rev-parse failed; using requested root: {exc}")
    try:
        os.stat(os.path.join(repo_root, ".git"))
        has_git = True
    except FileNotFoundError:
        has_git = False
    root = repo_root if has_git else root
    method = "walk"
    if has_git:
        try:
            paths = [os.fsdecode(p) for p in git(root, "ls-files", "-z").split(b"\0") if p]
            method = "git ls-files -z"
        except (OSError, subprocess.SubprocessError) as exc:
            warnings.append(f"git ls-files failed; falling back to directory walk: {exc}")
            paths = walk_files(root, excludes, errors)
    else:
        paths = walk_files(root, excludes, errors)

    result = {
        "scannedRoot": root,
        "discoveryMethod": method,
        "complete": False,
        "eligibleFilesCount": 0,
        "latestEligibleFile": None,
        "warnings": warnings,
    }
    latest_ns = None
    allowed = set(includes)
    for relative_path in paths:
        relative_path = relative_path.replace("/", os.sep)
        if matches_exclude(relative_path, excludes):
            continue
        # Node path.extname treats '.env' as extensionless and '..foo' as '.foo'.
        base = os.path.basename(relative_path)
        dot = base.rfind(".")
        extension = base[dot + 1:].lower() if dot > 0 and base != ".." else ""
        if extension not in allowed:
            continue
        path = os.path.join(root, relative_path)
        try:
            info = os.stat(path)
            if not stat.S_ISREG(info.st_mode):
                continue
            with open(path, "rb") as source:
                if b"\0" in source.read(2048):
                    continue
            result["eligibleFilesCount"] += 1
            if latest_ns is None or info.st_mtime_ns > latest_ns:
                latest_ns = info.st_mtime_ns
                result["latestEligibleFile"] = {
                    "path": path,
                    "relativePath": relative_path,
                    "mtimeUtc": datetime.fromtimestamp(
                        info.st_mtime, timezone.utc
                    ).isoformat(timespec="microseconds").replace("+00:00", "Z"),
                }
        except FileNotFoundError:
            continue
        except (OSError, ValueError, OverflowError) as exc:
            errors.append(f"Cannot inspect eligible candidate {path}: {exc}")
    result["complete"] = not errors
    return result


def fetch_repo(endpoint: str, requested_root: str) -> dict:
    try:
        with urllib.request.urlopen(endpoint, timeout=15) as response:
            payload = json.load(response)
    except (OSError, ValueError, urllib.error.URLError, http.client.HTTPException) as exc:
        raise ValueError(f"Cannot read ingested repository metadata from {endpoint}: {exc}") from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("repos"), list):
        raise ValueError("Metadata response must contain a repos array")
    matches = []
    for repo in payload["repos"]:
        if not isinstance(repo, dict):
            raise ValueError("Metadata repos array contains a non-object entry")
        if any(
            isinstance(repo.get(key), str)
            and os.path.isabs(repo[key])
            and os.path.normpath(repo[key]) == requested_root
            for key in ("id", "hostPath", "containerPath")
        ):
            matches.append(repo)
    if len(matches) != 1:
        raise ValueError(f"Expected one exact repository path match for {requested_root}; found {len(matches)}")
    repo = matches[0]
    counts = repo.get("counts")
    if not isinstance(counts, dict) or "files" not in counts:
        raise ValueError("Matched repository metadata is missing counts.files")
    if "lastIngestAt" not in repo or "status" not in repo:
        raise ValueError("Matched repository metadata is missing lastIngestAt or status")
    return {
        **{key: repo.get(key) for key in ("id", "name", "hostPath", "containerPath", "lastIngestAt", "status")},
        "lastIngestFileCount": counts["files"],
    }


def main() -> int:
    started = time.perf_counter()
    parser = argparse.ArgumentParser(
        description="Read recorded ingest metadata and find the newest eligible local file mtime.",
        epilog=(
            "Supply the server's same CODEINFO_INGEST_INCLUDE and CODEINFO_INGEST_EXCLUDE "
            "values in this process environment, and the same local file scope. No env files "
            "are loaded. Git repositories scan tracked files; failed Git discovery falls back "
            "to walking. Timestamps alone do not prove index freshness. This is a live scan, "
            "not an atomic snapshot; metadata and files can change during the request/scan."
        ),
    )
    parser.add_argument("repo_path", help="Exact local repository root matched against id/hostPath/containerPath")
    parser.add_argument("--base-url", default="http://localhost:5010", help="CodeInfo server URL (default: http://localhost:5010)")
    args = parser.parse_args()
    requested_root = os.path.abspath(os.path.expanduser(args.repo_path))
    # Match config.ts: remove empty comma entries BEFORE trimming, preserving case.
    env_includes = [part.strip() for part in os.environ.get("CODEINFO_INGEST_INCLUDE", "").split(",") if part]
    env_excludes = [part.strip() for part in os.environ.get("CODEINFO_INGEST_EXCLUDE", "").split(",") if part]
    includes = env_includes if env_includes else DEFAULT_INCLUDES
    excludes = list(dict.fromkeys(DEFAULT_EXCLUDES + env_excludes))
    report = {
        "outcome": "error",
        "requestedRoot": requested_root,
        "metadataEndpoint": args.base_url.rstrip("/") + "/tools/ingested-repos",
        "repository": None,
        "filters": {
            "source": "process environment with defaults from server/src/ingest/config.ts",
            "includesSource": "CODEINFO_INGEST_INCLUDE" if env_includes else "defaults",
            "excludesSource": "defaults + CODEINFO_INGEST_EXCLUDE" if env_excludes else "defaults",
            "includes": includes,
            "excludes": excludes,
        },
        "scan": None,
        "errors": [],
        "elapsedSeconds": {"metadata": None, "scanning": None, "total": None},
        "limitations": "Live timestamps do not prove index freshness; server filters and file scope must match.",
    }
    try:
        parsed_url = urllib.parse.urlsplit(args.base_url)
        if parsed_url.scheme not in ("http", "https") or not parsed_url.netloc or parsed_url.query or parsed_url.fragment:
            raise ValueError("--base-url must be an http(s) server URL without a query or fragment")
        if not os.path.isdir(requested_root):
            raise ValueError(f"Local repository root is not an accessible directory: {requested_root}")
        phase = time.perf_counter()
        try:
            report["repository"] = fetch_repo(report["metadataEndpoint"], requested_root)
        finally:
            report["elapsedSeconds"]["metadata"] = time.perf_counter() - phase
        phase = time.perf_counter()
        try:
            report["scan"] = scan(requested_root, includes, excludes, report["errors"])
        finally:
            report["elapsedSeconds"]["scanning"] = time.perf_counter() - phase
        report["outcome"] = "partial" if report["errors"] else "ok"
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        report["errors"].append(str(exc))
    report["elapsedSeconds"]["total"] = time.perf_counter() - started
    print(json.dumps(report, indent=2, ensure_ascii=True))
    return 0 if report["outcome"] == "ok" else 1


if __name__ == "__main__":
    sys.exit(main())
