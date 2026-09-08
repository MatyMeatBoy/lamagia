"""Plan deterministic 500-card experimental candidate batches.

This creates work manifests only. It never changes ``fullyImplemented`` and
never treats a heuristic reusable-primitive hint as a rules implementation.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any


def identity(card: dict[str, Any]) -> str:
    return str(card.get("oracle_id") or card.get("scryfall_id"))


def load_reusable(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    cards = [card for card in payload.get("cards", []) if card.get("priority") == "reuse-existing"]
    cluster_counts = Counter(str(card.get("missing_line", "")) for card in cards)
    # Repeated exact Oracle lines are deliberately front-loaded: one tested
    # parser extension can close a whole cluster before unique wording is
    # attempted.
    return sorted(cards, key=lambda card: (
        -cluster_counts[str(card.get("missing_line", ""))],
        str(card.get("family", "")),
        str(card.get("missing_line", "")),
        str(card.get("name", "")).casefold(),
        identity(card),
    ))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=Path("data/rules/near-complete-cards.json"))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--batch-index", type=int, required=True)
    args = parser.parse_args()
    if args.batch_size <= 0 or args.batch_index <= 0:
        raise SystemExit("--batch-size and --batch-index must be positive")

    cards = load_reusable(args.input)
    start = (args.batch_index - 1) * args.batch_size
    selected = cards[start:start + args.batch_size]
    if not selected:
        raise SystemExit(f"No reusable candidates in batch {args.batch_index}")

    output = {
        "format": "prossh-experimental-candidate-batch/v1",
        "status": "candidate-only",
        "batch_index": args.batch_index,
        "batch_size": args.batch_size,
        "source_count": len(cards),
        "selected_count": len(selected),
        "cards": [
            {
                "name": card.get("name"),
                "oracle_id": card.get("oracle_id"),
                "scryfall_id": card.get("scryfall_id"),
                "family": card.get("family"),
                "missing_line": card.get("missing_line"),
                "reusable_primitives": card.get("reusable_primitives", []),
            }
            for card in selected
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Candidate batch {args.batch_index}: {len(selected)} cards from {len(cards)} reusable candidates -> {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
