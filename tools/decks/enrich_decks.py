#!/usr/bin/env python3
"""Upgrade already-imported deck JSONs with the characteristics the rules engine needs.

The first importers only stored presentation metadata, so the engine could not
know a creature's power, a land's colors, or which permanents tap for mana.
This tool re-reads the local catalog (after `enrich_catalog.py` has run) and
rewrites each deck card with the structured fields, without re-downloading the
upstream deck sources.

Run: python tools/decks/enrich_decks.py --catalog data/catalog/prossh.sqlite \
       --deck data/decks/cedh-pod.json --deck data/decks/commander-precons.json
"""
from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path
from typing import Any

COLUMNS = (
    "power", "toughness", "loyalty", "produced_mana_json",
    "colors_json", "color_identity_json", "keywords_json", "card_faces_json",
)


def load_characteristics(catalog: Path, identifiers: set[str]) -> dict[str, dict[str, Any]]:
    connection = sqlite3.connect(f"file:{catalog}?mode=ro", uri=True)
    available = {row[1] for row in connection.execute("PRAGMA table_info(cards)")}
    columns = [column for column in COLUMNS if column in available]
    if not columns:
        raise SystemExit("The catalog has no enriched columns. Run npm run catalog:enrich first.")
    rows = connection.execute(f"SELECT id, {', '.join(columns)} FROM cards").fetchall()
    connection.close()
    result: dict[str, dict[str, Any]] = {}
    for row in rows:
        identifier = row[0]
        if identifier not in identifiers:
            continue
        record = dict(zip(columns, row[1:]))
        result[identifier] = {
            "power": record.get("power"),
            "toughness": record.get("toughness"),
            "loyalty": record.get("loyalty"),
            "produced_mana": json.loads(record.get("produced_mana_json") or "[]"),
            "colors": json.loads(record.get("colors_json") or "[]"),
            "color_identity": json.loads(record.get("color_identity_json") or "[]"),
            "keywords": json.loads(record.get("keywords_json") or "[]"),
            "card_faces": json.loads(record["card_faces_json"]) if record.get("card_faces_json") else None,
        }
    return result


def enrich_deck_file(path: Path, characteristics: dict[str, dict[str, Any]]) -> tuple[int, int]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    total = 0
    matched = 0
    for deck in payload.get("decks", []):
        for card in deck.get("cards", []):
            total += 1
            extra = characteristics.get(str(card.get("scryfall_id")))
            if not extra:
                continue
            matched += 1
            for key, value in extra.items():
                if value in (None, []) and key in ("power", "toughness", "loyalty", "card_faces"):
                    card.pop(key, None)
                else:
                    card[key] = value
    compact = path.name == "commander-precons.json"
    path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) if compact
        else json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return total, matched


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Add rules characteristics to imported deck JSONs.")
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--deck", type=Path, action="append", required=True, dest="decks")
    arguments = parser.parse_args()
    if not arguments.catalog.exists():
        raise SystemExit("Run npm run catalog:sync before enriching decks.")
    present = [path for path in arguments.decks if path.exists()]
    if not present:
        raise SystemExit("No deck file to enrich; run the deck importers first.")
    wanted: set[str] = set()
    for path in present:
        data = json.loads(path.read_text(encoding="utf-8"))
        for deck in data.get("decks", []):
            for card in deck.get("cards", []):
                wanted.add(str(card.get("scryfall_id")))
    characteristics = load_characteristics(arguments.catalog, wanted)
    for path in present:
        total, matched = enrich_deck_file(path, characteristics)
        print(f"{path}: enriched {matched:,}/{total:,} card entries")
