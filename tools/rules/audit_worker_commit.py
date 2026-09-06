"""Reject worker commits that advertise rules without executable evidence.

This is a cheap intake gate for bots. It deliberately treats a type declaration
as metadata, not as an implementation: a rules feature needs an engine path and
an executable scenario test. The command is read-only and never changes the
working tree.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

MAX_TOTAL_DELETIONS = 600
MAX_RULE_FILE_DELETIONS = 300
MAX_ORACLE_IDS = 20


def oracle_ids_from_diff(diff: str) -> set[str]:
    """Collect stable IDs from added/modified worker fixtures, not card names."""
    return set(re.findall(r"[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", diff, re.I))


def git(*args: str) -> str:
    result = subprocess.run(
        ["git", *args], check=True, capture_output=True, text=True,
        encoding="utf-8", errors="replace",
    )
    return result.stdout


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True, help="Published integration SHA")
    parser.add_argument("--commit", required=True, help="Worker commit SHA")
    parser.add_argument("--report", help="Optional Markdown path for a compact audit record")
    args = parser.parse_args()

    files = [line for line in git("diff", "--name-only", f"{args.base}..{args.commit}").splitlines() if line]
    diff = git("diff", "--unified=0", f"{args.base}..{args.commit}", "--")
    oracle_ids = oracle_ids_from_diff(diff)
    added = [line[1:] for line in diff.splitlines() if line.startswith("+") and not line.startswith("+++")]
    union_additions = [line for line in added if "| { readonly kind:" in line]
    duplicate_union_additions = []
    base_types = git("show", f"{args.base}:packages/rules/src/characteristics.ts")
    for line in union_additions:
        if line.strip() in base_types:
            duplicate_union_additions.append(line.strip())
    has_engine = any(path.startswith("packages/rules/src/engine") for path in files)
    has_scenario = any(path.endswith(".test.ts") or path.endswith(".test.tsx") for path in files)
    malformed_control_flow = any(re.match(r"\s*if\s*\(", line) for line in union_additions)
    check = subprocess.run(
        ["git", "diff", "--check", f"{args.base}..{args.commit}"],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    numstat = git("diff", "--numstat", f"{args.base}..{args.commit}").splitlines()
    total_deletions = 0
    rule_file_deletions = 0
    for row in numstat:
        fields = row.split("\t")
        if len(fields) != 3 or not fields[1].isdigit():
            continue
        deleted = int(fields[1])
        total_deletions += deleted
        if fields[2].startswith("packages/rules/"):
            rule_file_deletions += deleted

    failures: list[str] = []
    if duplicate_union_additions:
        failures.append(f"duplicate union declarations: {len(duplicate_union_additions)}")
    if union_additions and malformed_control_flow:
        failures.append("control flow was inserted into the SpellEffect union")
    if union_additions and not has_engine:
        failures.append("type declaration has no engine executor path")
    if has_engine and not has_scenario:
        failures.append("engine change has no scenario test")
    if check.returncode:
        failures.append("git diff --check failed")
    if total_deletions > MAX_TOTAL_DELETIONS:
        failures.append(f"scope gate exceeded: {total_deletions} total deletions (max {MAX_TOTAL_DELETIONS})")
    if rule_file_deletions > MAX_RULE_FILE_DELETIONS:
        failures.append(f"rules rewrite gate exceeded: {rule_file_deletions} deletions under packages/rules (max {MAX_RULE_FILE_DELETIONS})")
    if len(oracle_ids) > MAX_ORACLE_IDS:
        failures.append(f"oracle_id gate exceeded: {len(oracle_ids)} IDs (max {MAX_ORACLE_IDS})")

    status = "REJECT" if failures else "PASS"
    print(f"{status} {args.commit} files={len(files)} oracle_ids={len(oracle_ids)} union_additions={len(union_additions)} deletions={total_deletions} rule_deletions={rule_file_deletions} engine={has_engine} scenario={has_scenario}")
    for failure in failures:
        print(f"- {failure}")
    if failures:
        print("- A type-only or parser-only patch is not a completed card; return it for correction.")
    if args.report:
        report = Path(args.report)
        report.parent.mkdir(parents=True, exist_ok=True)
        outcome = "REJECT" if failures else "PASS"
        lines = [f"## {outcome} `{args.commit[:12]}`", "", f"- Base: `{args.base}`", f"- Files: {len(files)}", f"- Oracle IDs: {len(oracle_ids)} / {MAX_ORACLE_IDS}", f"- Deletions: {total_deletions} total, {rule_file_deletions} rules", f"- Engine path: `{has_engine}`", f"- Scenario test: `{has_scenario}`"]
        if failures:
            lines.extend(["", "### Reasons", "", *[f"- {failure}" for failure in failures]])
        report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
