"""Build a compact, loss-aware symbol table for Oracle review batches.

This is an analysis artifact, not executable rules. Repeated clause shapes are
interned once and cards refer to them by a stable symbol. Concrete operands
remain on each card program, so compression never changes targeting, zones,
types, amounts, costs, or optionality.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any, Iterable

FORMAT = "prossh-oracle-compact-ir/v1"
NUMBER_WORDS = r"a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fifteen|twenty|x"
TOKEN_RE = re.compile(r"<[^>]+>|[a-z0-9]+|\{[^}]+\}|[:|,/-]")


def shape_of(text: str) -> str:
    """Normalize only freely parameterized values for dictionary interning."""
    value = text.casefold().replace("—", "-").replace("–", "-").replace("�", "<mode>")
    value = re.sub(r"(?:\{[^}]+\})+", "{cost}", value)
    value = re.sub(rf"\b(?:{NUMBER_WORDS}|\d+)\b", "<n>", value)
    value = re.sub(r"\bcards\b", "card", value)
    value = re.sub(r"\s+", " ", value).strip().rstrip(".")
    return value


def primitive_key(clause: dict[str, Any]) -> str:
    """Keep the existing classifier boundary and add a safe semantic shape."""
    cluster = str(clause.get("primitive_cluster") or shape_of(str(clause.get("text") or "")))
    return f"{cluster}|shape:{shape_of(str(clause.get('text') or ''))}"


def operands(clause: dict[str, Any]) -> dict[str, Any]:
    """Copy only structured operands needed to reconstruct a review task."""
    fields = (
        "kind", "primary_family", "amount", "target_text", "target_subtype",
        "target_types", "target_zone", "trigger_subject", "cost_context",
        "delayed_draw", "look_top", "return_target", "top_card_reveal",
        "reveal_until_type", "mana_value_dependency", "search_criterion",
        "operands", "mana_symbols", "modal", "modal_mode", "graveyard_static",
    )
    result: dict[str, Any] = {}
    for field in fields:
        value = clause.get(field)
        if value not in (None, False, [], {}, ""):
            result[field] = value
    return result


def build_compact_ir(cards: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Intern unresolved clauses and return a deterministic compact artifact."""
    rows = list(cards)
    keys: set[str] = set()
    examples_by_key: dict[str, set[str]] = {}
    card_programs: list[dict[str, Any]] = []
    raw_bytes = 0
    for card in rows:
        program: list[dict[str, Any]] = []
        for clause in card.get("clauses", []):
            if clause.get("candidate"):
                continue
            text = str(clause.get("text") or "")
            key = primitive_key(clause)
            keys.add(key)
            examples_by_key.setdefault(key, set()).add(text)
            raw_bytes += len(text.encode("utf-8"))
            program.append({"key": key, "operands": operands(clause)})
        if program:
            card_programs.append({
                "oracle_id": str(card.get("oracle_id") or ""),
                "name": str(card.get("name") or ""),
                "status": str(card.get("status") or ""),
                "completion_hint": str(card.get("completion_hint") or ""),
                "program": program,
            })

    symbol_by_key = {key: f"p{index:04d}" for index, key in enumerate(sorted(keys), start=1)}
    token_values = sorted({token for key in keys for token in TOKEN_RE.findall(key)})
    token_by_value = {token: f"t{index:04d}" for index, token in enumerate(token_values, start=1)}
    primitives: list[dict[str, Any]] = []
    for key, symbol in symbol_by_key.items():
        examples = sorted(examples_by_key.get(key, set()), key=str.casefold)[:3]
        primitives.append({"symbol": symbol, "key": key, "tokens": [token_by_value[token] for token in TOKEN_RE.findall(key)], "examples": examples})

    compact_cards: list[dict[str, Any]] = []
    reference_count = sum(len(card["program"]) for card in card_programs)
    machine_primitives = [{"s": item["symbol"], "t": item["tokens"]} for item in primitives]
    machine_cards: list[dict[str, Any]] = []
    for card in card_programs:
        program = [{"primitive": symbol_by_key[item["key"]], "operands": item["operands"]} for item in card["program"]]
        compact = {**card, "program": program}
        compact_cards.append(compact)
        machine_cards.append({"i": card["oracle_id"], "p": [{"s": item["primitive"], "o": item["operands"]} for item in program]})
    machine_payload = {"v": {value: token_by_value[value] for value in token_values}, "p": machine_primitives, "c": machine_cards}
    compact_bytes = len(json.dumps(machine_payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    ratio = round(compact_bytes / raw_bytes, 3) if raw_bytes else 1.0
    return {
        "format": FORMAT,
        "source": "oracle-effects.json unresolved clauses; symbols are review vocabulary, not executable rules",
        "card_count": len(rows),
        "review_card_count": len(compact_cards),
        "primitive_count": len(primitives),
        "token_count": len(token_values),
        "primitive_reference_count": reference_count,
        "reused_reference_count": max(0, reference_count - len(primitives)),
        "reuse_ratio": round(max(0, reference_count - len(primitives)) / reference_count, 3) if reference_count else 0.0,
        "raw_clause_bytes": raw_bytes,
        "compact_program_bytes": compact_bytes,
        "compact_to_raw_ratio": ratio,
        "primitives": primitives,
        "cards": sorted(compact_cards, key=lambda card: (card["name"].casefold(), card["oracle_id"])),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="Oracle IR JSON from compile_oracle_effects.py")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    payload = json.loads(args.input.read_text(encoding="utf-8"))
    cards = payload.get("cards")
    if not isinstance(cards, list):
        raise SystemExit("Input does not contain a cards list.")
    result = build_compact_ir(cards)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Compact Oracle IR written: {result['card_count']:,} cards; {result['primitive_count']:,} symbols; ratio={result['compact_to_raw_ratio']}")


if __name__ == "__main__":
    main()
