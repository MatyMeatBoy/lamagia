"""Compile the local card catalog into a machine-readable rules inventory.

This is a clean-room behavior compiler, not a Java-source transpiler. It never
reads Forge/XMage classes or copies their implementation. The optional reference
file contains only independently authored behavior vectors (card identity,
structured effects and scenarios), which are merged after validation.

The output is generated under ``data/`` and is intentionally not committed:

    python tools/rules/compile_card_rules.py \
      --catalog data/catalog/prossh.sqlite \
      --output data/rules/card-rules.json \
      --reference data/rules/reference-vectors.json

The inventory is useful for batch work: it tells the engine/compiler which
families occur in all Oracle texts and which cards still need a structured
definition plus a scenario test. A family label is triage metadata, never proof
that the card is implemented.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


FAMILY_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("trigger", re.compile(r"\bwhen(?:ever)?\b|\bat the beginning of\b|\bmagecraft\b|\blandfall\b", re.I)),
    ("activated", re.compile(r"^[^\n:]{1,100}:\s*", re.M)),
    ("search", re.compile(r"\bsearch your library\b|\bsearch a library\b", re.I)),
    ("draw", re.compile(r"\bdraw\b", re.I)),
    ("discard", re.compile(r"\bdiscard\b", re.I)),
    ("mill", re.compile(r"\bmill\b|put the top .* into .*graveyard", re.I)),
    ("damage", re.compile(r"\bdeals?\b .*\bdamage\b|\bcombat damage\b", re.I)),
    ("life", re.compile(r"\bgain[s]?\b .*\blife\b|\blose[s]?\b .*\blife\b", re.I)),
    ("destroy", re.compile(r"\bdestroy\b", re.I)),
    ("exile", re.compile(r"\bexile\b", re.I)),
    ("return", re.compile(r"\breturn\b .*\bhand\b|\breturn\b .*\bbattlefield\b", re.I)),
    ("sacrifice", re.compile(r"\bsacrifice\b", re.I)),
    ("tokens", re.compile(r"\bcreate\b .*\btoken", re.I)),
    ("counters", re.compile(r"\bcounter\b|\bproliferate\b", re.I)),
    ("continuous", re.compile(r"\bas long as\b|\bhave\b|\bgets?\b|\bcan't\b|\bcannot\b", re.I)),
    ("combat", re.compile(r"\battack\b|\bblock\b|\bcombat\b", re.I)),
    ("modal", re.compile(r"\bchoose one\b|\bchoose two\b|\bchoose one or more\b", re.I)),
    ("variable", re.compile(r"\{X\}|\bX\b", re.I)),
)


def normalize_name(value: str) -> str:
    return " ".join(value.casefold().replace("’", "'").split())


def families(oracle_text: str) -> list[str]:
    return [name for name, pattern in FAMILY_PATTERNS if pattern.search(oracle_text)]


def load_reference(path: Path | None) -> dict[str, dict[str, Any]]:
    if path is None:
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or not isinstance(payload.get("cards"), list):
        raise ValueError("El archivo de referencias debe tener la forma {\"cards\": [...]}." )
    result: dict[str, dict[str, Any]] = {}
    for entry in payload["cards"]:
        if not isinstance(entry, dict):
            raise ValueError("Cada referencia debe ser un objeto.")
        identity = entry.get("oracle_id") or entry.get("scryfall_id")
        if not isinstance(identity, str) or not identity:
            raise ValueError("Cada referencia necesita oracle_id o scryfall_id.")
        if "source_code" in entry or "java" in entry or "class_body" in entry:
            raise ValueError("Las referencias aceptan comportamiento estructurado, no código fuente externo.")
        effects = entry.get("effects", [])
        scenarios = entry.get("scenarios", [])
        if not isinstance(effects, list) or not isinstance(scenarios, list):
            raise ValueError(f"Referencia inválida para {identity}: effects y scenarios deben ser listas.")
        result[identity] = {"effects": effects, "scenarios": scenarios, "reference_status": "reviewed-vector"}
    return result


def compile_inventory(catalog: Path, output: Path, reference_path: Path | None) -> None:
    references = load_reference(reference_path)
    database = sqlite3.connect(f"file:{catalog}?mode=ro", uri=True)
    database.row_factory = sqlite3.Row
    rows = database.execute(
        """
        SELECT id, oracle_id, name, normalized_name, mana_cost, cmc, type_line,
               oracle_text, colors_json, color_identity_json, keywords_json,
               produced_mana_json, card_faces_json, power, toughness, loyalty,
               released_at, printing_rank
        FROM cards
        ORDER BY printing_rank DESC, released_at DESC, id
        """
    )
    cards: list[dict[str, Any]] = []
    seen: set[str] = set()
    family_counts: Counter[str] = Counter()
    for row in rows:
        identity = str(row["oracle_id"] or row["id"])
        if identity in seen:
            continue
        seen.add(identity)
        oracle_text = str(row["oracle_text"] or "")
        card_families = families(oracle_text)
        for family in card_families:
            family_counts[family] += 1
        reference = references.get(identity) or references.get(str(row["id"]))
        card: dict[str, Any] = {
            "oracle_id": row["oracle_id"],
            "scryfall_id": row["id"],
            "name": row["name"],
            "normalized_name": row["normalized_name"],
            "mana_cost": row["mana_cost"],
            "mana_value": row["cmc"],
            "type_line": row["type_line"],
            "oracle_text": oracle_text,
            "colors": json.loads(row["colors_json"] or "[]"),
            "color_identity": json.loads(row["color_identity_json"] or "[]"),
            "keywords": json.loads(row["keywords_json"] or "[]"),
            "produced_mana": json.loads(row["produced_mana_json"] or "[]"),
            "power": row["power"],
            "toughness": row["toughness"],
            "loyalty": row["loyalty"],
            "families": card_families,
            "requires_structured_spec": bool(oracle_text and reference is None),
            "reference_status": reference["reference_status"] if reference else "unmapped",
        }
        if reference:
            card["effects"] = reference["effects"]
            card["scenarios"] = reference["scenarios"]
        cards.append(card)
    output.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "format": "prossh-card-rules/v1",
        "generated_at": datetime.now(UTC).isoformat(),
        "source": "local normalized catalog",
        "reference_file": str(reference_path) if reference_path else None,
        "card_count": len(cards),
        "reference_count": sum(1 for card in cards if card["reference_status"] == "reviewed-vector"),
        "family_counts": dict(sorted(family_counts.items())),
        "cards": cards,
    }
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Rules inventory written: {len(cards)} unique cards -> {output}")
    print(f"Reference vectors merged: {payload['reference_count']}; families: {dict(family_counts)}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--reference", type=Path)
    arguments = parser.parse_args()
    if not arguments.catalog.exists():
        raise SystemExit("No existe el catálogo local; ejecuta npm run catalog:sync primero.")
    if arguments.reference and not arguments.reference.exists():
        raise SystemExit(f"No existe el archivo de referencias: {arguments.reference}")
    compile_inventory(arguments.catalog, arguments.output, arguments.reference)


if __name__ == "__main__":
    main()
