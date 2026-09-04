"""Assign independent Oracle primitives to bounded, non-overlapping workers.

This is an orchestration helper, not part of the deterministic rules engine.
It keeps a primitive on one worker (avoiding concurrent edits to the same parser
surface), splits its cards into review/commit batches, and uses the same memory
budget as ``compile_oracle_effects.py``.  The resulting JSON is intentionally
stable so another agent can consume it without guessing what is already claimed.

Example::

    python tools/rules/plan_primitive_workers.py \
      --roadmap data/rules/primitive-roadmap-c13.json \
      --claims docs/WORK_CLAIMS.md \
      --workers 5 --memory-budget-gb 2 \
      --output data/rules/primitive-worker-plan-c13.json \
      --prompt-output docs/PRIMITIVE_WORKERS_C13.md
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterable

from compile_oracle_effects import DEFAULT_COMMIT_CARD_LIMIT, effective_worker_count

WORKER_PLAN_FORMAT = "prossh-primitive-worker-plan/v1"
ACTIVE_STATUSES = ("active", "ready", "in progress", "review")


def plan_workers(
    clusters: list[dict[str, Any]],
    worker_count: int = 5,
    offset: int = 0,
) -> list[dict[str, Any]]:
    """Backward-compatible adapter for the original cluster-plan API."""
    if worker_count <= 0:
        raise ValueError("worker_count must be positive")
    if offset < 0:
        raise ValueError("offset must be non-negative")
    selected = clusters[offset:offset + worker_count]
    return [
        {
            "worker": index + 1,
            "cluster": entry["cluster"],
            "card_count": entry.get("card_count", 0),
            "commit_batches": entry.get("commit_batches", 1),
            "examples": entry.get("examples", []),
            "cards": entry.get("cards", []),
        }
        for index, entry in enumerate(selected)
    ]


def load_claimed_keys(path: Path | None) -> set[str]:
    """Read active/ready claim keys without treating markdown descriptions as code."""
    if path is None or not path.exists():
        return set()
    claimed: set[str] = set()
    row_pattern = re.compile(r"^\|\s*`([^`]+)`\s*\|(?P<rest>.*)$")
    for line in path.read_text(encoding="utf-8").splitlines():
        match = row_pattern.match(line)
        if not match:
            continue
        rest = match.group("rest").casefold()
        if any(status in rest for status in ACTIVE_STATUSES):
            claimed.add(match.group(1))
    return claimed


def _entry_key(entry: dict[str, Any], prefix: str) -> str:
    key = str(entry.get("claim_key") or entry.get("template") or "primitive")
    if prefix and not key.startswith(f"{prefix}-"):
        return f"{prefix}-{key.lstrip('-')}"
    return key


def _card_ids(entry: dict[str, Any]) -> list[str]:
    """Extract unique Oracle IDs, retaining the roadmap's deterministic order."""
    cards = entry.get("unlocked_cards") or entry.get("cards") or []
    result: list[str] = []
    seen: set[str] = set()
    for card in cards:
        value = card.get("oracle_id") if isinstance(card, dict) else card
        if value is None:
            continue
        oracle_id = str(value)
        if oracle_id not in seen:
            seen.add(oracle_id)
            result.append(oracle_id)
    return result


def build_worker_plan(
    roadmap: Iterable[dict[str, Any]],
    *,
    workers: int = 5,
    memory_budget_gb: float = 2.0,
    estimated_worker_mb: int = 256,
    max_cards_per_commit: int = DEFAULT_COMMIT_CARD_LIMIT,
    claim_prefix: str = "",
    claimed_keys: set[str] | None = None,
) -> dict[str, Any]:
    """Build a deterministic greedy assignment of primitive work to workers.

    A primitive is indivisible at worker level, even when it spans several
    commit-sized batches. This is the important safety property: workers may
    run in parallel, but they never modify the same reusable primitive.
    """
    if max_cards_per_commit <= 0:
        raise ValueError("max_cards_per_commit debe ser positivo.")
    worker_count = effective_worker_count(workers, memory_budget_gb, estimated_worker_mb)
    claimed = claimed_keys or set()
    jobs: list[dict[str, Any]] = []
    skipped: list[str] = []
    for entry in roadmap:
        key = _entry_key(entry, claim_prefix)
        if key in claimed or key.removeprefix(f"{claim_prefix}-") in claimed:
            skipped.append(key)
            continue
        cards = _card_ids(entry)
        batches = [cards[start:start + max_cards_per_commit] for start in range(0, len(cards), max_cards_per_commit)]
        if not batches:
            batches = [[]]
        jobs.append(
            {
                "claim_key": key,
                "template": str(entry.get("template") or ""),
                "family": str(entry.get("family") or "other"),
                "unlocks": int(entry.get("unlocks") or len(cards)),
                "blocks": int(entry.get("blocks") or 0),
                "oracle_ids": cards,
                "batches": batches,
            }
        )

    # Roadmap rank is already the ROI ordering. Assigning the largest jobs
    # first makes the result balanced while claim keys remain deterministic.
    jobs.sort(key=lambda job: (-len(job["oracle_ids"]), -job["unlocks"], job["claim_key"]))
    assigned: list[list[dict[str, Any]]] = [[] for _ in range(worker_count)]
    load = [0] * worker_count
    for job in jobs:
        index = min(range(worker_count), key=lambda candidate: (load[candidate], candidate))
        assigned[index].append(job)
        load[index] += max(1, len(job["oracle_ids"]))

    worker_payload = []
    for index, worker_jobs in enumerate(assigned, start=1):
        worker_payload.append(
            {
                "worker": index,
                "estimated_cards": sum(len(job["oracle_ids"]) for job in worker_jobs),
                "primitive_count": len(worker_jobs),
                "jobs": worker_jobs,
            }
        )
    return {
        "format": WORKER_PLAN_FORMAT,
        "generated_at": datetime.now(UTC).isoformat(),
        "worker_count": worker_count,
        "requested_workers": workers,
        "memory_budget_gb": memory_budget_gb,
        "estimated_worker_mb": estimated_worker_mb,
        "max_cards_per_commit": max_cards_per_commit,
        "skipped_claims": sorted(skipped),
        "workers": worker_payload,
    }


def render_document(plan: dict[str, Any]) -> str:
    lines = [
        "# Primitive worker plan",
        "",
        "Generated by `tools/rules/plan_primitive_workers.py`; regenerate after each accepted batch.",
        "Each primitive is assigned to exactly one worker, so parallel work cannot claim the same parser surface.",
        "",
        f"- Workers: **{plan['worker_count']}** (requested {plan['requested_workers']})",
        f"- Memory budget: **{plan['memory_budget_gb']:g} GB** ({plan['estimated_worker_mb']} MB reserved per worker)",
        f"- Maximum cards per commit batch: **{plan['max_cards_per_commit']}**",
        "",
    ]
    for worker in plan["workers"]:
        lines += [f"## Worker {worker['worker']}", "", f"{worker['primitive_count']} primitives / {worker['estimated_cards']} cards", ""]
        if not worker["jobs"]:
            lines.append("Idle — no unclaimed work in this queue.")
            lines.append("")
            continue
        lines += ["| Claim | Family | Cards | Unlocks | Batches |", "| --- | --- | ---: | ---: | ---: |"]
        for job in worker["jobs"]:
            lines.append(
                f"| `{job['claim_key']}` | {job['family']} | {len(job['oracle_ids'])} |"
                f" {job['unlocks']} | {len(job['batches'])} |"
            )
        lines.append("")
    if plan["skipped_claims"]:
        lines += ["## Already claimed", "", ", ".join(f"`{key}`" for key in plan["skipped_claims"]), ""]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--roadmap", type=Path, required=True)
    parser.add_argument("--claims", type=Path, default=None)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--prompt-output", type=Path, default=None)
    parser.add_argument("--workers", type=int, default=5)
    parser.add_argument("--memory-budget-gb", type=float, default=2.0)
    parser.add_argument("--estimated-worker-mb", type=int, default=256)
    parser.add_argument("--max-cards-per-commit", type=int, default=DEFAULT_COMMIT_CARD_LIMIT)
    args = parser.parse_args()
    payload = json.loads(args.roadmap.read_text(encoding="utf-8"))
    plan = build_worker_plan(
        payload.get("roadmap") or payload.get("clusters") or [],
        workers=args.workers,
        memory_budget_gb=args.memory_budget_gb,
        estimated_worker_mb=args.estimated_worker_mb,
        max_cards_per_commit=args.max_cards_per_commit,
        claim_prefix=str(payload.get("claim_prefix") or ""),
        claimed_keys=load_claimed_keys(args.claims),
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.prompt_output:
        args.prompt_output.parent.mkdir(parents=True, exist_ok=True)
        args.prompt_output.write_text(render_document(plan), encoding="utf-8")
    print(f"Worker plan written: {plan['worker_count']} workers, {sum(item['primitive_count'] for item in plan['workers'])} primitives -> {args.output}")


if __name__ == "__main__":
    main()
