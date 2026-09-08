"""Close safe one-line card families with the existing rules primitives.

This is deliberately deterministic: it never invents rules code and never
marks a card complete by suppressing Oracle text. It selects a shared one-line
template from the current engine export, refreshes the export after the
primitive is implemented, and exits non-zero unless every sampled card is
reported as ``fullyImplemented``.

Usage from the repository root::

    python tools/rules/auto_complete_near_complete.py --sample-size 5 --max-groups 10

The safe-family registry is intentionally conservative. Add a new entry only
when the corresponding TypeScript primitive and a scenario test already exist.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path
from typing import Any


SAFE_FAMILIES: dict[str, dict[str, str]] = {
    "Destroy target attacking creature.": {"primitive": "destroy-target-permanent", "rules": "CR 701.8"},
    "Destroy target tapped creature.": {"primitive": "tapped-creature", "rules": "CR 701.8"},
    "Destroy target artifact or land.": {"primitive": "artifact-or-land", "rules": "CR 701.8"},
    "Destroy target creature or planeswalker.": {"primitive": "destroy-target-permanent", "rules": "CR 701.8"},
    "Prevent all combat damage that would be dealt this turn.": {"primitive": "prevent-all-combat-damage-this-turn", "rules": "CR 615"},
    "Destroy all enchantments.": {"primitive": "destroy-all-enchantments", "rules": "CR 701.8"},
    "Target creature can't be blocked this turn.": {"primitive": "target-cant-be-blocked", "rules": "CR 509.1a"},
    "When ~ enters, attach it to target creature you control.": {"primitive": "attach-equipment", "rules": "CR 301.5"},
    "When ~ enters, exile target nonland permanent an opponent controls until ~ leaves the battlefield.": {
        "primitive": "exile-target-permanent-until-source-leaves", "rules": "CR 400.7, 610"
    },
    "~ can't be blocked by creatures with power 2 or less.": {"primitive": "cannotBeBlockedByPowerAtMost", "rules": "CR 509.1a"},
    "Gain control of target creature until end of turn.": {
        "primitive": "gain-control-target-until-end-of-turn",
        "rules": "CR 611.2, 701.7",
    },
    "Convoke": {"primitive": "convoke", "rules": "CR 702.51, 601.2f"},
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
        return any(key == primitive or _contains_primitive(child, primitive) for key, child in value.items())
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


def _identity(row: dict[str, Any]) -> str:
    return str(row.get("oracle_id") or row.get("scryfall_id"))


def _candidates_for_family(payload: dict[str, Any], template: str) -> list[dict[str, Any]]:
    """Return only genuinely pending one-line cards; regressions use separate tests."""
    return unresolved_candidates(payload, template)


def select_batches(
    payload: dict[str, Any], *, sample_size: int, max_groups: int, template: str | None = None
) -> list[dict[str, Any]]:
    """Select disjoint groups, never silently shrinking a requested group."""
    if sample_size <= 0:
        raise ValueError("--sample-size must be positive")
    if max_groups <= 0:
        raise ValueError("--max-groups must be positive")
    families = [template] if template else list(SAFE_FAMILIES)
    selected_ids: set[str] = set()
    groups: list[dict[str, Any]] = []
    for family in families:
        if len(groups) >= max_groups:
            break
        candidates = [row for row in _candidates_for_family(payload, family) if _identity(row) not in selected_ids]
        if len(candidates) < sample_size:
            raise RuntimeError(
                f"Only {len(candidates)} unresolved one-line cards found for {family}; need {sample_size}. "
                "Completed cards are regression samples only and cannot satisfy this gate."
            )
        cards = candidates[:sample_size]
        selected_ids.update(_identity(row) for row in cards)
        groups.append({
            "template": family,
            "primitive": SAFE_FAMILIES[family]["primitive"],
            "rules": SAFE_FAMILIES[family]["rules"],
            "cards": cards,
        })
    if not groups:
        raise RuntimeError("No safe families selected")
    return groups


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
        wanted = template or "any safe family"
        raise RuntimeError(
            f"Only {len(candidates)} unresolved one-line cards found for {wanted}; need {sample_size}. "
            "Completed cards are regression samples only and cannot satisfy this gate."
        )

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


def plan_batches(
    profiles_path: Path,
    *,
    sample_size: int,
    max_groups: int,
    template: str | None = None,
    output: Path,
) -> dict[str, Any]:
    """Persist the pre-change card set so completion is proved against exact IDs."""
    before = load_profiles(profiles_path)
    groups = select_batches(before, sample_size=sample_size, max_groups=max_groups, template=template)
    plan = {
        "format": "prossh-auto-complete-plan/v1",
        "sample_size": sample_size,
        "requested_groups": max_groups,
        "selection": "unresolved-one-line-only",
        "groups": [
            {
                "template": group["template"],
                "primitive": group["primitive"],
                "rules": group["rules"],
                "cards": [
                    {
                        "name": row.get("name"),
                        "oracle_id": row.get("oracle_id"),
                        "scryfall_id": row.get("scryfall_id"),
                        "before_fully_implemented": bool(row.get("fullyImplemented")),
                        "before_remaining_lines": row.get("unimplementedText") or [],
                    }
                    for row in group["cards"]
                ],
            }
            for group in groups
        ],
        "engine_export": str(profiles_path),
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return plan


def verify_plan(
    profiles_path: Path,
    plan_path: Path,
    *,
    refresh: bool = True,
    output: Path | None = None,
) -> dict[str, Any]:
    """Verify that every pre-change unresolved card in a saved plan is now complete."""
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    if plan.get("format") != "prossh-auto-complete-plan/v1":
        raise ValueError(f"Unsupported completion plan: {plan_path}")
    if refresh:
        refresh_export(profiles_path.parents[2])
    after = load_profiles(profiles_path)
    by_id = {_identity(row): row for row in after["profiles"]}
    groups: list[dict[str, Any]] = []
    failures: list[str] = []
    for group in plan.get("groups", []):
        cards: list[dict[str, Any]] = []
        for selected in group.get("cards", []):
            identity = str(selected.get("oracle_id") or selected.get("scryfall_id"))
            current = by_id.get(identity)
            missing = (current or {}).get("unimplementedText") or []
            baseline_valid = (
                not bool(selected.get("before_fully_implemented"))
                and selected.get("before_remaining_lines") == [group["template"]]
            )
            passed = baseline_valid and bool(current and current.get("fullyImplemented")) and not missing and _contains_primitive(
                current, str(group["primitive"])
            )
            card = {
                "name": (current or selected).get("name"),
                "oracle_id": (current or selected).get("oracle_id"),
                "scryfall_id": (current or selected).get("scryfall_id"),
                "template": group["template"],
                "primitive": group["primitive"],
                "rules": group["rules"],
                "fully_implemented": bool(current and current.get("fullyImplemented")),
                "remaining_lines": missing,
                "passed": passed,
            }
            cards.append(card)
            if not passed:
                reason = "invalid pre-change baseline" if not baseline_valid else "not fully implemented"
                failures.append(f"{card['name']} | {identity} ({reason})")
        groups.append({key: group[key] for key in ("template", "primitive", "rules")} | {"cards": cards})
    expected = sum(len(group.get("cards", [])) for group in plan.get("groups", []))
    actual = sum(len(group["cards"]) for group in groups)
    report = {
        "format": "prossh-auto-complete-plan-verification/v1",
        "sample_size": plan.get("sample_size"),
        "requested_groups": plan.get("requested_groups"),
        "verified_groups": len(groups),
        "selection": plan.get("selection"),
        "passed": not failures and actual == expected,
        "groups": groups,
        "failures": failures,
        "engine_export": str(profiles_path),
        "plan": str(plan_path),
    }
    if output:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if not report["passed"]:
        raise RuntimeError("Completion plan failed: " + "; ".join(failures or ["not all planned cards verified"]))
    return report


def complete_batches(
    profiles_path: Path,
    *,
    sample_size: int,
    max_groups: int,
    template: str | None = None,
    refresh: bool = True,
    output: Path | None = None,
) -> dict[str, Any]:
    """Verify up to ``max_groups`` disjoint groups of new one-line cards."""
    before = load_profiles(profiles_path)
    groups = select_batches(before, sample_size=sample_size, max_groups=max_groups, template=template)
    if refresh:
        refresh_export(profiles_path.parents[2])
    after = load_profiles(profiles_path)
    by_id = {_identity(row): row for row in after["profiles"]}
    reports: list[dict[str, Any]] = []
    failures: list[str] = []
    for group in groups:
        cards: list[dict[str, Any]] = []
        for selected in group["cards"]:
            identity = _identity(selected)
            current = by_id.get(identity)
            if current is None:
                failures.append(f"{group['template']}: missing {identity}")
                continue
            missing = current.get("unimplementedText") or []
            passed = bool(current.get("fullyImplemented")) and not missing and _contains_primitive(current, group["primitive"])
            card = {
                "name": current.get("name"),
                "oracle_id": current.get("oracle_id"),
                "scryfall_id": current.get("scryfall_id"),
                "template": group["template"],
                "primitive": group["primitive"],
                "rules": group["rules"],
                "fully_implemented": bool(current.get("fullyImplemented")),
                "remaining_lines": missing,
                "passed": passed,
            }
            cards.append(card)
            if not passed:
                failures.append(f"{current.get('name')} | {identity}")
        reports.append({
            "template": group["template"],
            "primitive": group["primitive"],
            "rules": group["rules"],
            "passed": len(cards) == sample_size and all(card["passed"] for card in cards),
            "cards": cards,
        })
        if failures:
            break
    report = {
        "format": "prossh-auto-complete-batches/v1",
        "sample_size": sample_size,
        "requested_groups": max_groups,
        "verified_groups": len(reports),
        "selection": "unresolved-one-line-only",
        "passed": not failures and len(reports) == min(max_groups, len(groups)),
        "groups": reports,
        "failures": failures,
        "engine_export": str(profiles_path),
    }
    if output:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if failures or not report["passed"]:
        raise RuntimeError("Batch sample failed: " + "; ".join(failures or ["not all groups verified"]))
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profiles", type=Path, default=Path("data/rules/engine-card-profiles.json"))
    parser.add_argument("--sample-size", type=int, default=5)
    parser.add_argument("--max-groups", type=int, default=10)
    parser.add_argument("--template", choices=sorted(SAFE_FAMILIES), default=None)
    parser.add_argument("--output", type=Path, default=Path("data/rules/auto-complete-pass.json"))
    parser.add_argument("--plan", type=Path, help="Save unresolved card IDs before implementation and exit")
    parser.add_argument("--verify-plan", type=Path, help="Verify a previously saved pre-change plan")
    parser.add_argument("--no-refresh", action="store_true", help="Do not regenerate the engine export before verification")
    args = parser.parse_args()
    if args.plan and args.verify_plan:
        parser.error("--plan and --verify-plan are mutually exclusive")
    if args.plan:
        report = plan_batches(
            args.profiles,
            sample_size=args.sample_size,
            max_groups=args.max_groups,
            template=args.template,
            output=args.plan,
        )
        print(f"Plan saved: {sum(len(group['cards']) for group in report['groups'])} unresolved cards")
        for group in report["groups"]:
            for card in group["cards"]:
                print(f"{card['name']} | {card['oracle_id']}")
        return
    if args.verify_plan:
        report = verify_plan(args.profiles, args.verify_plan, refresh=not args.no_refresh, output=args.output)
        print(f"Plan verification PASS: {sum(len(group['cards']) for group in report['groups'])} cards")
        return
    report = complete_batches(
        args.profiles,
        sample_size=args.sample_size,
        max_groups=args.max_groups,
        template=args.template,
        refresh=not args.no_refresh,
        output=args.output,
    )
    print(f"Auto-complete PASS: {report['verified_groups']} groups × {report['sample_size']} cards")
    for group in report["groups"]:
        print(f"GROUP PASS: {group['template']} | {group['primitive']}")
        for card in group["cards"]:
            print(f"{card['name']} | {card['oracle_id']}")


if __name__ == "__main__":
    main()
