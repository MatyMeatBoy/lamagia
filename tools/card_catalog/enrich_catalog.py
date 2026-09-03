#!/usr/bin/env python3
"""Backfill rules-relevant card characteristics into an existing local catalog.

The original catalog schema stored presentation metadata only. A real rules engine
also needs power/toughness/loyalty, the mana a permanent can produce, and the
per-face breakdown of modal/double-faced cards.

Re-downloading the whole Scryfall bulk file to add four columns is wasteful, so
this tool adds the columns in place and backfills exactly the printings that the
imported decks reference, batched through the documented `/cards/collection`
endpoint (75 identifiers per request, rate limited).

Run: python tools/card_catalog/enrich_catalog.py --catalog data/catalog/prossh.sqlite \
       --ids-from data/decks/cedh-pod.json --ids-from data/decks/commander-precons.json
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Iterable, Sequence

COLLECTION_URL = "https://api.scryfall.com/cards/collection"
BATCH = 75
NEW_COLUMNS = {
    "power": "TEXT",
    "toughness": "TEXT",
    "loyalty": "TEXT",
    "defense": "TEXT",
    "produced_mana_json": "TEXT",
    "card_faces_json": "TEXT",
    "enriched_at": "TEXT",
}


def ensure_columns(database: sqlite3.Connection) -> None:
    existing = {row[1] for row in database.execute("PRAGMA table_info(cards)")}
    for column, kind in NEW_COLUMNS.items():
        if column not in existing:
            database.execute(f"ALTER TABLE cards ADD COLUMN {column} {kind}")
    database.commit()


def deck_ids(paths: Sequence[Path]) -> list[str]:
    ids: dict[str, None] = {}
    for path in paths:
        payload = json.loads(path.read_text(encoding="utf-8"))
        for deck in payload.get("decks", []):
            for card in deck.get("cards", []):
                identifier = card.get("scryfall_id")
                if identifier:
                    ids.setdefault(str(identifier), None)
    return list(ids)


def pending_ids(database: sqlite3.Connection, candidates: Iterable[str]) -> list[str]:
    done = {row[0] for row in database.execute("SELECT id FROM cards WHERE enriched_at IS NOT NULL")}
    return [identifier for identifier in candidates if identifier not in done]


def post_collection(identifiers: Sequence[str], contact: str) -> list[dict[str, Any]]:
    body = json.dumps({"identifiers": [{"id": identifier} for identifier in identifiers]}).encode("utf-8")
    request = urllib.request.Request(
        COLLECTION_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json;q=0.9,*/*;q=0.8",
            "User-Agent": f"ProsshTCG/0.1 ({contact})",
        },
    )
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                return json.load(response).get("data", [])
        except (urllib.error.URLError, TimeoutError) as error:
            if attempt == 3:
                raise
            print(f"  retrying batch after {error}", file=sys.stderr)
            time.sleep(1.5 * (attempt + 1))
    return []


def face_values(card: dict[str, Any]) -> str | None:
    faces = card.get("card_faces")
    if not faces:
        return None
    keep = ("name", "mana_cost", "type_line", "oracle_text", "power", "toughness", "loyalty", "colors")
    return json.dumps([{key: face.get(key) for key in keep if face.get(key) is not None} for face in faces])


def enrich(catalog: Path, sources: Sequence[Path], contact: str, limit: int | None) -> tuple[int, int]:
    database = sqlite3.connect(catalog)
    ensure_columns(database)
    candidates = deck_ids(sources)
    known = {row[0] for row in database.execute("SELECT id FROM cards")}
    wanted = [identifier for identifier in candidates if identifier in known]
    todo = pending_ids(database, wanted)
    if limit is not None:
        todo = todo[:limit]
    stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    updated = 0
    for start in range(0, len(todo), BATCH):
        chunk = todo[start : start + BATCH]
        for card in post_collection(chunk, contact):
            database.execute(
                """UPDATE cards SET power = ?, toughness = ?, loyalty = ?, defense = ?,
                       produced_mana_json = ?, card_faces_json = ?, enriched_at = ?,
                       colors_json = COALESCE(?, colors_json), keywords_json = COALESCE(?, keywords_json)
                   WHERE id = ?""",
                (
                    card.get("power"),
                    card.get("toughness"),
                    card.get("loyalty"),
                    card.get("defense"),
                    json.dumps(card.get("produced_mana", [])),
                    face_values(card),
                    stamp,
                    json.dumps(card["colors"]) if "colors" in card else None,
                    json.dumps(card["keywords"]) if "keywords" in card else None,
                    card["id"],
                ),
            )
            updated += 1
        database.commit()
        print(f"  enriched {min(start + BATCH, len(todo)):,}/{len(todo):,}", file=sys.stderr)
        time.sleep(0.12)
    database.close()
    return len(wanted), updated


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backfill rules characteristics for locally referenced printings.")
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--ids-from", type=Path, action="append", required=True, dest="sources")
    parser.add_argument("--contact", default="contact@example.com")
    parser.add_argument("--limit", type=int, default=None)
    arguments = parser.parse_args()
    if not arguments.catalog.exists():
        raise SystemExit("Run npm run catalog:sync before enriching the catalog.")
    missing = [str(path) for path in arguments.sources if not path.exists()]
    if missing:
        raise SystemExit(f"Missing deck sources: {', '.join(missing)}")
    requested, changed = enrich(arguments.catalog, arguments.sources, arguments.contact, arguments.limit)
    print(f"Enriched {changed:,} of {requested:,} referenced printings in {arguments.catalog}")
