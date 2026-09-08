"""Close safe one-line card families with the existing rules primitives.

This is deliberately deterministic: it never invents rules code and never
marks a card complete by suppressing Oracle text. It selects a shared one-line
template from the current engine export, refreshes the export after the
primitive is implemented, and exits non-zero unless every sampled card is
reported as ``fullyImplemented``.

Usage from the repository root::

    python tools/rules/auto_complete_near_complete.py --sample-size 5

The first safe family is intentionally small. Add a new entry only when the
corresponding TypeScript primitive and a scenario test already exist.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path
from typing import Any


SAFE_FAMILIES: dict[str, dict[str, str]] = {
    "Gain control of target creature until end of turn.": {
        "primitive": "gain-control-target-until-end-of-turn",
        "rules": "CR 611.2, 701.7",
    },
}


def load_profiles(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or not isinstance(payload.get("profiles"), list):
        raise ValueError(f"Invalid engine profile export: {path}")
    return payload


def unresolved_candidates(payload: dict[str, Any], template: str | None = None) -> list[dict[str, Any]]:
    allowed = {template} if template else set(SAFE_FAMILIES)
    rows = [
        row for row in payload["profiles"]
        if not row.get("fullyImplemented")
        and len(row.get("unimplementedText") or []) == 1
        and row["unimplementedText"][0] in allowed
    ]
    return sorted(rows, key=lambda row: (str(row.get("name", "")).casefold(), str(row.get("oracle_id") or row.get("scryfall_id"))))


def _contains_primitive(value: Any, primitive: str) -> bool:
    if isinstance(value, dict):
        return any(_contains_primitive(child, primitive) for child in value.values())
    if isinstance(value, list):
        return any(_contains_primitive(child, primitive) for child in value)
    return value == primitive


def completed_candidates(payload: dict[str, Any], template: str | None = None) -> list[dict[str, Any]]:
    templates = [template] if template else list(SAFE_FAMILIES)
    rows: list[dict[str, Any]] = []
    for row in payload["profiles"]:
        if not row.get("fullyImplemented"):
            continue
        for candidate in templates:
            primitive = SAFE_FAMILIES[candidate]["primitive"]
            if candidate[:-1].casefold() in str(row.get("oracle_text", "")).casefold() and _contains_primitive(row, primitive):
                rows.append(row)
                break
    return sorted(rows, key=lambda row: (str(row.get("name", "")).casefold(), str(row.get("oracle_id") or row.get("scryfall_id"))))


def refresh_export(repo_root: Path) -> None:
    result = subprocess.run(
        [("npm.cmd" if os.name == "nt" else "npm"), "run", "rules:engine:export"],
        cwd=repo_root,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode:
        raise RuntimeError(result.stdout + result.stderr)


def complete_sample(
    profiles_path: Path,
    *,
    sample_size: int,
    template: str | None = None,
    refresh: bool = True,
    output: Path | None = None,
) -> dict[str, Any]:
    if sample_size <= 0:
        raise ValueError("--sample-size must be positive")
    before = load_profiles(profiles_path)
    candidates = unresolved_candidates(before, template)
    unresolved_count = len(candidates)
    if len(candidates) < sample_size:
        known = {str(row.get("oracle_id") or row.get("scryfall_id")) for row in candidates}
        candidates.extend(row for row in completed_candidates(before, template)
                          if str(row.get("oracle_id") or row.get("scryfall_id")) not in known)
    if len(candidates) < sample_size:
        wanted = template or "any safe family"
        raise RuntimeError(f"Only {len(candidates)} verifiable cards found for {wanted}; need {sample_size}.")

    selected = candidates[:sample_size]
    if refresh:
        refresh_export(profiles_path.parents[2])
    after = load_profiles(profiles_path)
    by_id = {str(row.get("oracle_id") or row.get("scryfall_id")): row for row in after["profiles"]}
    results: list[dict[str, Any]] = []
    for row in selected:
        identity = str(row.get("oracle_id") or row.get("scryfall_id"))
        current = by_id.get(identity)
        if current is None:
            raise RuntimeError(f"Selected card disappeared from refreshed export: {identity}")
        template_line = next(
            (candidate for candidate in SAFE_FAMILIES
             if candidate in (row.get("unimplementedText") or [])
             or candidate[:-1].casefold() in str(row.get("oracle_text", "")).casefold()),
            None,
        )
        if template_line is None:
            raise RuntimeError(f"Selected card no longer maps to a safe family: {identity}")
        missing = current.get("unimplementedText") or []
        results.append({
            "name": current.get("name"),
            "oracle_id": current.get("oracle_id"),
            "scryfall_id": current.get("scryfall_id"),
            "template": template_line,
            "primitive": SAFE_FAMILIES[template_line]["primitive"],
            "rules": SAFE_FAMILIES[template_line]["rules"],
            "fully_implemented": bool(current.get("fullyImplemented")),
            "remaining_lines": missing,
        })

    passed = all(item["fully_implemented"] and not item["remaining_lines"] for item in results)
    report = {
        "format": "prossh-auto-complete-pass/v1",
        "sample_size": sample_size,
        "template": template or "auto",
        "unresolved_before": unresolved_count,
        "passed": passed,
        "cards": results,
        "engine_export": str(profiles_path),
    }
    if output:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if not passed:
        failed = ", ".join(str(item["name"]) for item in results if not item["fully_implemented"])
        raise RuntimeError(f"Sample failed; unresolved cards: {failed}")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profiles", type=Path, default=Path("data/rules/engine-card-profiles.json"))
    parser.add_argument("--sample-size", type=int, default=5)
    parser.add_argument("--template", choices=sorted(SAFE_FAMILIES), default=None)
    parser.add_argument("--output", type=Path, default=Path("data/rules/auto-complete-pass.json"))
    parser.add_argument("--no-refresh", action="store_true", help="Do not regenerate the engine export before verification")
    args = parser.parse_args()
    report = complete_sample(
        args.profiles,
        sample_size=args.sample_size,
        template=args.template,
        refresh=not args.no_refresh,
        output=args.output,
    )
    print(f"Auto-complete PASS: {len(report['cards'])} cards; {report['cards'][0]['primitive']}")
    for card in report["cards"]:
        print(f"{card['name']} | {card['oracle_id']}")


if __name__ == "__main__":
    main()
