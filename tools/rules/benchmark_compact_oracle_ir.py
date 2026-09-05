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


def hybrid_worker_payload(
    compact: dict[str, Any],
    rows: list[dict[str, Any]],
    *,
    min_references: int = 2,
) -> dict[str, Any]:
    """Use IR only for repeated exact shapes; keep unique clauses verbatim.

    This is the safe middle ground for small sets.  A unique or unusually
    complex clause keeps its original Oracle text, while repeated shapes such
    as ``Draw N cards`` become short symbol references with their per-card
    operands.  The raw sidecar remains authoritative for both paths.
    """
    references: dict[str, int] = {}
    key_by_symbol = {item["symbol"]: item["key"] for item in compact["primitives"]}
    for card in compact["cards"]:
        for item in card["program"]:
            key = key_by_symbol[item["primitive"]]
            references[key] = references.get(key, 0) + 1
    reusable_keys = {key for key, count in references.items() if count >= min_references}
    reusable_symbols = {
        item["symbol"]: item["key"]
        for item in compact["primitives"]
        if item["key"] in reusable_keys
    }
    text_by_card: dict[str, list[str]] = {}
    for row in rows:
        oracle_id = str(row["card"].get("oracle_id") or "")
        text_by_card.setdefault(oracle_id, []).append(str(row["clause"].get("text") or ""))

    cards: list[dict[str, Any]] = []
    for card in compact["cards"]:
        texts = text_by_card.get(card["oracle_id"], [])
        program: list[dict[str, Any]] = []
        for index, item in enumerate(card["program"]):
            key = key_by_symbol[item["primitive"]]
            if item["primitive"] in reusable_symbols:
                program.append({"s": item["primitive"], "o": item["operands"]})
            else:
                program.append({
                    "text": texts[index] if index < len(texts) else "",
                    "k": key,
                    "o": item["operands"],
                })
        cards.append({"i": card["oracle_id"], "p": program})
    return {
        "format": "prossh-oracle-hybrid-review/v1",
        "min_references": min_references,
        "reusable_primitives": sorted(reusable_symbols),
        "cards": cards,
    }


def payload_signature(
    cards: list[dict[str, Any]],
    *,
    compact: dict[str, Any],
    rows: list[dict[str, Any]],
) -> dict[str, list[tuple[str, str]]]:
    """Return a normalized exact signature for compact or hybrid programs."""
    key_by_symbol = {item["symbol"]: item["key"] for item in compact["primitives"]}
    text_by_card: dict[str, list[str]] = {}
    for row in rows:
        oracle_id = str(row["card"].get("oracle_id") or "")
        text_by_card.setdefault(oracle_id, []).append(str(row["clause"].get("text") or ""))
    result: dict[str, list[tuple[str, str]]] = {}
    for card in cards:
        oracle_id = str(card.get("i") or card.get("oracle_id") or "")
        program = card.get("p") or card.get("program") or []
        signature: list[tuple[str, str]] = []
        for index, item in enumerate(program):
            if "primitive" in item:
                key = key_by_symbol[item["primitive"]]
            elif "s" in item:
                key = key_by_symbol[item["s"]]
            elif "k" in item:
                key = str(item["k"])
            else:
                text = str(item.get("text") or "")
                key = primitive_key({"text": text})
            signature.append((key, json.dumps(item.get("operands", item.get("o", {})), ensure_ascii=False, sort_keys=True, separators=(",", ":"))))
        result[oracle_id] = signature
    return result


def compare(cards: Iterable[dict[str, Any]]) -> dict[str, Any]:
    # Materialize once: callers may provide a generator.  The old code first
    # consumed it while building the legacy payload and then benchmarked an
    # empty compact payload.
    cards = list(cards)
    rows = unresolved(cards)
    compact = build_compact_ir(card for card in cards)
    old = legacy_payload(rows)
    new = compact_worker_payload(compact)
    hybrid_candidates = [
        (threshold, hybrid_worker_payload(compact, rows, min_references=threshold))
        for threshold in (2, 3, 4, 5, 8, 12, 20)
    ]
    hybrid_threshold, hybrid = min(
        hybrid_candidates,
        key=lambda candidate: (
            len(json.dumps(candidate[1], ensure_ascii=False, separators=(",", ":")).encode("utf-8")),
            candidate[0],
        ),
    )
    old_bytes = len(json.dumps(old, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    new_bytes = len(json.dumps(new, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    hybrid_bytes = len(json.dumps(hybrid, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    reduction = round(1 - (new_bytes / old_bytes), 3) if old_bytes else 0.0
    old_ids = sorted(card["oracle_id"] for card in old["cards"])
    new_ids = sorted(card["oracle_id"] for card in compact["cards"])
    if old_ids != new_ids:
        raise AssertionError("compact review payload changed card identity")
    old_refs = sum(len(card["clauses"]) for card in old["cards"])
    new_refs = sum(len(card["program"]) for card in compact["cards"])
    if old_refs != new_refs:
        raise AssertionError("compact review payload changed clause count")

    # Counts are necessary but insufficient.  A compact transformation must
    # preserve clause order and the exact primitive identity plus every
    # structured operand (target, zone, type, amount, cost, timing, etc.).
    old_signatures = {
        card["oracle_id"]: [
            (primitive_key(row["clause"]), json.dumps(operands(row["clause"]), ensure_ascii=False, sort_keys=True, separators=(",", ":")))
            for row in rows
            if str(row["card"].get("oracle_id") or "") == card["oracle_id"]
        ]
        for card in old["cards"]
    }
    new_signatures = payload_signature(compact["cards"], compact=compact, rows=rows)
    hybrid_signatures = payload_signature(hybrid["cards"], compact=compact, rows=rows)
    if old_signatures != new_signatures:
        raise AssertionError("compact review payload changed primitive identity or operands")
    if old_signatures != hybrid_signatures:
        raise AssertionError("hybrid review payload changed primitive identity or operands")
    payload_sizes = {"legacy-payload": old_bytes, "hybrid-payload": hybrid_bytes, "compact-payload": new_bytes}
    recommendation = min(payload_sizes, key=lambda mode: (payload_sizes[mode], mode))
    reduction = round(1 - (payload_sizes[recommendation] / old_bytes), 3) if old_bytes else 0.0
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
        "hybrid_bytes": hybrid_bytes,
        "hybrid_min_references": hybrid_threshold,
        "hybrid_reusable_primitive_count": len(hybrid["reusable_primitives"]),
        "context_byte_reduction": reduction,
        "recommended_workflow": recommendation if recommendation != "legacy-payload" else "legacy-payload-with-compositional-hints",
        "exact_primitive_reuse_ratio": compact["reuse_ratio"],
        "identity_and_clause_checks": "PASS",
        "identity_and_operand_checks": "PASS",
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
