"""Plan disjoint primitive clusters for parallel card-rule workers."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def plan_workers(
    clusters: list[dict[str, Any]],
    worker_count: int = 5,
    offset: int = 0,
) -> list[dict[str, Any]]:
    """Assign one deterministic, reusable cluster to each worker slot."""
    if worker_count <= 0:
        raise ValueError("El número de workers debe ser positivo.")
    if offset < 0:
        raise ValueError("El offset debe ser positivo o cero.")
    selected = clusters[offset:offset + worker_count]
    return [
        {
            "worker": index + 1,
            "cluster": entry["cluster"],
            "card_count": entry["card_count"],
            "commit_batches": entry["commit_batches"],
            "examples": entry.get("examples", []),
            "cards": entry["cards"],
        }
        for index, entry in enumerate(selected)
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=5)
    parser.add_argument("--offset", type=int, default=0, help="Number of already-assigned clusters to skip.")
    args = parser.parse_args()
    source = json.loads(args.input.read_text(encoding="utf-8"))
    plan = plan_workers(source["clusters"], args.workers, args.offset)
    result = {
        "format": "prossh-primitive-worker-plan/v1",
        "source": str(args.input),
        "worker_count": len(plan),
        "offset": args.offset,
        "workers": plan,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Primitive worker plan written: {len(plan)} disjoint clusters -> {args.output}")


if __name__ == "__main__":
    main()
