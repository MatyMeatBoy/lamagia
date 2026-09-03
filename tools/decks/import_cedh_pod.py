#!/usr/bin/env python3
"""Build a locally validated four-deck cEDH pod from a MIT-licensed data source."""
from __future__ import annotations
import argparse, json, sqlite3, urllib.request
from datetime import datetime, timezone
from pathlib import Path

SOURCE = "https://raw.githubusercontent.com/KonradHoeffner/cedh/gh-pages/data/decks.json"
SELECTION = (
    "[cedh] Unifier Atraxa",
    "[CABAL] cEDH  Speed needs no translation  [PRIMER]",
    "[Mardu cEDH] Binder of the Breach",
    "Black Hole Son",
)

def resolve(connection: sqlite3.Connection, name: str) -> dict[str, str] | None:
    row = connection.execute("""SELECT id, oracle_id, name, mana_cost, cmc, type_line, oracle_text,
      image_normal, image_art_crop FROM cards WHERE normalized_name = ? ORDER BY released_at DESC LIMIT 1""", (name.lower(),)).fetchone()
    if not row: return None
    keys = ("scryfall_id", "oracle_id", "name", "mana_cost", "cmc", "type_line", "oracle_text", "image_normal", "image_art_crop")
    return dict(zip(keys, row))

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    if not arguments.catalog.exists(): raise SystemExit("Run npm run catalog:sync before importing the cEDH pod.")
    request = urllib.request.Request(SOURCE, headers={"User-Agent": "ProsshTCG/0.1 (contact@example.com)"})
    with urllib.request.urlopen(request, timeout=30) as response: source_decks = json.load(response)
    connection = sqlite3.connect(arguments.catalog)
    decks = []
    for source_name in SELECTION:
        source = source_decks[source_name]
        names = list(source["commanders"]) + list(source["mainboard"])
        resolved = [resolve(connection, name) for name in names]
        missing = [name for name, card in zip(names, resolved) if card is None]
        if len(names) != 100 or missing: raise SystemExit(f"{source_name}: expected 100 resolvable cards; missing={missing}")
        decks.append({"id": source_name, "name": source_name, "commanders": source["commanders"], "cards": resolved})
    connection.close()
    payload = {"format": "Commander", "source": "KonradHoeffner/cedh gh-pages data", "source_url": "https://github.com/KonradHoeffner/cedh", "license": "MIT", "synced_at": datetime.now(timezone.utc).isoformat(), "decks": decks}
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Validated and wrote {len(decks)} complete cEDH decks ({sum(len(deck['cards']) for deck in decks)} cards).")
