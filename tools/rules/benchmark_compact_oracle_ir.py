"""Compare the legacy repeated-clause review payload with compositional IR.

This benchmark measures contributor context, not rules correctness. Both
payloads are derived from the same unresolved clauses; the compact payload
keeps exact primitive identities and per-card operands while interning reusable
semantic atoms. A reduction is useful only if the identity/operands checks pass.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Iterable

try:
    from compact_oracle_ir import build_compact_ir, operands, primitive_key
except ModuleNotFoundError:
    from tools.rules.compact_oracle_ir import build_compact_ir, operands, primitive_key


def unresolved(cards: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {"card": card, "clause": clause}
        for card in cards
        for clause in card.get("clauses", [])
        if not clause.get("candidate")
    ]


def legacy_payload(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Model the old review context: repeat the full text per card/clause."""
    cards: dict[str, dict[str, Any]] = {}
    for row in rows:
        card = row["card"]
        clause = row["clause"]
        oracle_id = str(card.get("oracle_id") or "")
        cards.setdefault(oracle_id, {"oracle_id": oracle_id, "name": str(card.get("name") or ""), "clauses": []})["clauses"].append({
            "text": str(clause.get("text") or ""),
            "primitive_cluster": str(clause.get("primitive_cluster") or ""),
            "operands": operands(clause),
        })
    return {"format": "legacy-oracle-review/v1", "cards": sorted(cards.values(), key=lambda card: card["oracle_id"])}


def compact_worker_payload(compact: dict[str, Any]) -> dict[str, Any]:
    """Strip explanatory examples while retaining the data a worker needs."""
    primitive_rows = [{
        "s": item["symbol"],
        "t": item["tokens"],
        "a": item["atoms"],
    } for item in compact["primitives"]]
    return {
        "format": "prossh-oracle-compositional-review/v1",
        # The raw Oracle IR remains the sidecar for exact text. This payload
        # intentionally contains short references and structured operands.
        "atoms": {symbol: value for value, symbol in sorted(compact["semantic_atoms"].items())},
        "primitives": primitive_rows,
        # Atom IDs are attached to the exact primitive definition, so do not
        # repeat them for every card reference.
        "cards": [{"i": card["oracle_id"], "p": [{
            "s": item["primitive"], "o": item["operands"]
        } for item in card["program"]]} for card in compact["cards"]],
    }


def compare(cards: Iterable[dict[str, Any]]) -> dict[str, Any]:
    rows = unresolved(cards)
    compact = build_compact_ir(card for card in cards)
    old = legacy_payload(rows)
    new = compact_worker_payload(compact)
    old_bytes = len(json.dumps(old, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    new_bytes = len(json.dumps(new, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    old_ids = sorted(card["oracle_id"] for card in old["cards"])
    new_ids = sorted(card["oracle_id"] for card in compact["cards"])
    if old_ids != new_ids:
        raise AssertionError("compact review payload changed card identity")
    old_refs = sum(len(card["clauses"]) for card in old["cards"])
    new_refs = sum(len(card["program"]) for card in compact["cards"])
    if old_refs != new_refs:
        raise AssertionError("compact review payload changed clause count")
    return {
        "format": "prossh-oracle-compression-benchmark/v1",
        "review_cards": len(old["cards"]),
        "clause_references": old_refs,
        "legacy_unique_shapes": len({primitive_key(row["clause"]) for row in rows}),
        "legacy_bytes": old_bytes,
        "compositional_atoms": compact["semantic_atom_count"],
        "compositional_atom_references": compact["semantic_atom_reference_count"],
        "compositional_atom_reuse_ratio": compact["semantic_atom_reuse_ratio"],
        "compositional_bytes": new_bytes,
        "context_byte_reduction": round(1 - (new_bytes / old_bytes), 3) if old_bytes else 0.0,
        "exact_primitive_reuse_ratio": compact["reuse_ratio"],
        "identity_and_clause_checks": "PASS",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    payload = json.loads(args.input.read_text(encoding="utf-8"))
    result = compare(payload.get("cards", []))
    rendered = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")


if __name__ == "__main__":
    main()
