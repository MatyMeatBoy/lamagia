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
    args = parser.parse_args()

    files = [line for line in git("diff", "--name-only", f"{args.base}..{args.commit}").splitlines() if line]
    diff = git("diff", "--unified=0", f"{args.base}..{args.commit}", "--")
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

    status = "REJECT" if failures else "PASS"
    print(f"{status} {args.commit} files={len(files)} union_additions={len(union_additions)} engine={has_engine} scenario={has_scenario}")
    for failure in failures:
        print(f"- {failure}")
    if failures:
        print("- A type-only or parser-only patch is not a completed card; return it for correction.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
