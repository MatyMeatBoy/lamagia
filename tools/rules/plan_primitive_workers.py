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
DEFAULT_INTEGRATION_COMMIT_THRESHOLD = 11


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
    """Read active claim keys from the exact Markdown status column."""
    if path is None or not path.exists():
        return set()
    claimed: set[str] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.lstrip().startswith("|"):
            continue
        columns = [column.strip() for column in line.strip().strip("|").split("|")]
        if len(columns) < 4 or not columns[0].startswith("`") or not columns[0].endswith("`"):
            continue
        status = columns[3].strip("`").casefold()
        if status in ACTIVE_STATUSES:
            claimed.add(columns[0][1:-1])
    return claimed


def _entry_key(entry: dict[str, Any], prefix: str) -> str:
    # `oracle-clusters.json` uses `cluster`; roadmap JSON uses `claim_key`.
    # Accept both so the generated C13 plan never collapses every job into the
    # misleading fallback key `primitive`.
    key = str(entry.get("claim_key") or entry.get("cluster") or entry.get("template") or "primitive")
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
    min_integration_commits: int = DEFAULT_INTEGRATION_COMMIT_THRESHOLD,
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
    if min_integration_commits <= 0:
        raise ValueError("min_integration_commits debe ser positivo.")
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
        cluster = str(entry.get("cluster") or entry.get("template") or "")
        family = str(entry.get("family") or cluster.split("|", 1)[0] or "other")
        jobs.append(
            {
                "claim_key": key,
                "template": str(entry.get("template") or cluster),
                "family": family,
                "unlocks": int(entry.get("unlocks") or len(cards)),
                "blocks": int(entry.get("blocks") or 0),
                "quick_win_count": int(entry.get("quick_win_count") or sum(
                    1 for card in entry.get("cards", [])
                    if isinstance(card, dict) and card.get("completion_hint") == "quick-win"
                )),
                "priority": str(entry.get("priority") or ("high" if entry.get("quick_win_count") else "normal")),
                "oracle_ids": cards,
                "batches": batches,
            }
        )

    # A card with multiple unresolved clauses can occur in several primitive
    # jobs. Co-locate every connected group of overlapping oracle_ids before
    # balancing; otherwise two workers can edit the same card concurrently.
    parent = list(range(len(jobs)))

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(left: int, right: int) -> None:
        left_root, right_root = find(left), find(right)
        if left_root != right_root:
            parent[right_root] = left_root

    oracle_owner: dict[str, int] = {}
    for index, job in enumerate(jobs):
        for oracle_id in job["oracle_ids"]:
            previous = oracle_owner.get(oracle_id)
            if previous is not None:
                union(index, previous)
            else:
                oracle_owner[oracle_id] = index

    components: dict[int, list[dict[str, Any]]] = {}
    for index, job in enumerate(jobs):
        components.setdefault(find(index), []).append(job)
    work_units = []
    for component_jobs in components.values():
        oracle_ids = {oracle_id for job in component_jobs for oracle_id in job["oracle_ids"]}
        work_units.append(
            {
                "jobs": sorted(component_jobs, key=lambda job: job["claim_key"]),
                "oracle_ids": oracle_ids,
                "quick_win_count": sum(job["quick_win_count"] for job in component_jobs),
                "unlocks": sum(job["unlocks"] for job in component_jobs),
                "claim_key": min(job["claim_key"] for job in component_jobs),
            }
        )
    # Roadmap rank is already the ROI ordering. Assigning the largest
    # connected units first makes the result balanced while claim keys remain
    # deterministic.
    work_units.sort(key=lambda unit: (-unit["quick_win_count"], -len(unit["oracle_ids"]), -unit["unlocks"], unit["claim_key"]))
    assigned: list[list[dict[str, Any]]] = [[] for _ in range(worker_count)]
    load = [0] * worker_count
    for unit in work_units:
        index = min(range(worker_count), key=lambda candidate: (load[candidate], candidate))
        assigned[index].extend(unit["jobs"])
        load[index] += max(1, len(unit["oracle_ids"]))

    worker_payload = []
    for index, worker_jobs in enumerate(assigned, start=1):
        worker_payload.append(
            {
                "worker": index,
                "estimated_cards": len({oracle_id for job in worker_jobs for oracle_id in job["oracle_ids"]}),
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
        "min_integration_commits": min_integration_commits,
        "skipped_claims": sorted(skipped),
        "workers": worker_payload,
    }


def render_document(plan: dict[str, Any]) -> str:
    lines = [
        "# Primitive worker plan",
        "",
        "Generated by `tools/rules/plan_primitive_workers.py`; regenerate after each accepted batch.",
        "Each primitive is assigned to exactly one worker; jobs sharing an oracle_id are co-located, so parallel work cannot duplicate a card.",
        "",
        f"- Workers: **{plan['worker_count']}** (requested {plan['requested_workers']})",
        f"- Memory budget: **{plan['memory_budget_gb']:g} GB** ({plan['estimated_worker_mb']} MB reserved per worker)",
        f"- Maximum cards per commit batch: **{plan['max_cards_per_commit']}**",
        f"- Integrate fork commits only after **{plan['min_integration_commits']}** are available (unless explicitly overridden)",
        "",
    ]
    for worker in plan["workers"]:
        lines += [f"## Worker {worker['worker']}", "", f"{worker['primitive_count']} primitives / {worker['estimated_cards']} unique cards", ""]
        if not worker["jobs"]:
            lines.append("Idle — no unclaimed work in this queue.")
            lines.append("")
            continue
        lines += ["| Priority | Claim | Family | Cards | Quick wins | Unlocks | Batches |", "| --- | --- | --- | ---: | ---: | ---: | ---: |"]
        for job in worker["jobs"]:
            lines.append(
                f"| {job['priority']} | `{job['claim_key']}` | {job['family']} | {len(job['oracle_ids'])} |"
                f" {job['quick_win_count']} | {job['unlocks']} | {len(job['batches'])} |"
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
    parser.add_argument("--min-integration-commits", type=int, default=DEFAULT_INTEGRATION_COMMIT_THRESHOLD)
    parser.add_argument("--claim-prefix", default="", help="Prefix for generated claim keys, e.g. c13.")
    args = parser.parse_args()
    payload = json.loads(args.roadmap.read_text(encoding="utf-8"))
    plan = build_worker_plan(
        payload.get("roadmap") or payload.get("clusters") or [],
        workers=args.workers,
        memory_budget_gb=args.memory_budget_gb,
        estimated_worker_mb=args.estimated_worker_mb,
        max_cards_per_commit=args.max_cards_per_commit,
        min_integration_commits=args.min_integration_commits,
        claim_prefix=args.claim_prefix or str(payload.get("claim_prefix") or ""),
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
