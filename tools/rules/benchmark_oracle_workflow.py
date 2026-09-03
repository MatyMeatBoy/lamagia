"""Measure card-first versus cluster-first Oracle analysis throughput."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from compile_oracle_effects import compile_catalog, primitive_cluster_inventory


def measure(catalog: Path, workers: int, memory_budget_gb: float, batch_size: int) -> dict[str, object]:
    started = time.perf_counter()
    cards = compile_catalog(
        catalog,
        workers=workers,
        memory_budget_gb=memory_budget_gb,
        batch_size=batch_size,
    )
    elapsed = time.perf_counter() - started
    pending = [card for card in cards if card["status"] == "needs-review"]
    clusters = primitive_cluster_inventory(cards)
    return {
        "workers": workers,
        "seconds": round(elapsed, 2),
        "cards": len(cards),
        "pending_cards": len(pending),
        "clusters": len(clusters),
        "pending_cards_per_cluster": round(len(pending) / len(clusters), 2) if clusters else 0,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--memory-budget-gb", type=float, default=2.0)
    parser.add_argument("--batch-size", type=int, default=256)
    args = parser.parse_args()
    if not args.catalog.exists():
        raise SystemExit("No existe el catálogo local; ejecuta npm run catalog:sync primero.")
    one = measure(args.catalog, 1, args.memory_budget_gb, args.batch_size)
    five = measure(args.catalog, 5, args.memory_budget_gb, args.batch_size)
    result = {
        "format": "prossh-oracle-workflow-benchmark/v1",
        "catalog": str(args.catalog),
        "runs": [one, five],
        "parallel_speedup": round(one["seconds"] / five["seconds"], 2) if five["seconds"] else None,
        "method": "compile once, group unresolved clauses by primitive_cluster, assign disjoint clusters to workers",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Oracle workflow benchmark: 1 worker={one['seconds']}s; 5 workers={five['seconds']}s; speedup={result['parallel_speedup']}x")
    print(f"Cluster reuse: {one['pending_cards']} pending cards -> {one['clusters']} clusters ({one['pending_cards_per_cluster']} cards/cluster)")


if __name__ == "__main__":
    main()
