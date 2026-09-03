#!/usr/bin/env python3
"""Streaming Scryfall bulk-data importer for ProsshTCG.

It stores metadata and provider image links only; it never downloads card art.

The schema carries three groups of fields:
  * presentation  - names, type line, image links, prices;
  * rules         - power/toughness/loyalty, produced mana, per-face data, so the
                    engine can actually play the card;
  * printing      - promo/variation/frame/finish/set-type flags plus a computed
                    `printing_rank`, so a search can show the one printing a
                    player expects instead of forty reprints and foils.

Run: python tools/card_catalog/sync_scryfall.py --dataset default_cards --output data/catalog/prossh.sqlite
"""
from __future__ import annotations

import argparse
import gzip
import io
import json
import sqlite3
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

API = "https://api.scryfall.com/bulk-data"

COLUMNS = (
    "id", "oracle_id", "name", "normalized_name", "mana_cost", "cmc", "type_line", "oracle_text",
    "colors_json", "color_identity_json", "keywords_json", "produced_mana_json", "card_faces_json",
    "power", "toughness", "loyalty", "defense",
    "set_code", "set_name", "set_type", "collector_number", "released_at", "layout", "rarity",
    "border_color", "frame", "frame_effects_json", "finishes_json", "promo", "variation",
    "full_art", "textless", "digital", "reprint", "games_json", "lang",
    "legalities_json", "prices_json",
    "image_small", "image_normal", "image_large", "image_art_crop", "scryfall_uri", "printing_rank",
)

# Set types whose printings are not the version a player thinks of as "the card".
SPECIAL_SET_TYPES = {
    "promo", "token", "memorabilia", "funny", "minigame", "vanguard", "planechase",
    "archenemy", "treasure_chest", "spellbook", "alchemy",
}
# Frame effects that mark an alternate treatment rather than the regular printing.
SPECIAL_FRAME_EFFECTS = {
    "showcase", "extendedart", "etched", "inverted", "companion", "shatteredglass",
    "borderless", "spree", "fandfc",
}


def request(url: str, contact: str) -> Any:
    headers = {"Accept": "application/json;q=0.9,*/*;q=0.8", "User-Agent": f"ProsshTCG/0.1 ({contact})"}
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60) as response:
        return json.load(response)


def card_terms(card: dict[str, Any]) -> Iterable[tuple[str, str]]:
    import re
    for term in re.findall(r"[A-Za-z0-9'-]+", card.get("type_line", "")):
        yield (term.lower(), "type")
    for keyword in card.get("keywords", []):
        yield (str(keyword).lower(), "keyword")
    for color in card.get("color_identity", []):
        yield (str(color).lower(), "color")


def image_values(card: dict[str, Any]) -> dict[str, str]:
    images = card.get("image_uris") or ((card.get("card_faces") or [{}])[0].get("image_uris") or {})
    return {key: str(images.get(key, "")) for key in ("small", "normal", "large", "art_crop")}


def face_values(card: dict[str, Any]) -> str | None:
    faces = card.get("card_faces")
    if not faces:
        return None
    keep = ("name", "mana_cost", "type_line", "oracle_text", "power", "toughness", "loyalty", "colors")
    return json.dumps([{key: face.get(key) for key in keep if face.get(key) is not None} for face in faces])


def printing_rank(card: dict[str, Any]) -> int:
    """Lower is closer to the plain, current, paper printing a player expects.

    The rank is stored so a name search can order by it and show one row per
    card without re-deriving the heuristics on every query.
    """
    penalty = 0
    if card.get("lang") != "en":
        penalty += 400
    if card.get("digital"):
        penalty += 200
    if "paper" not in (card.get("games") or []):
        penalty += 200
    if card.get("set_type") in SPECIAL_SET_TYPES:
        penalty += 120
    if card.get("promo"):
        penalty += 80
    if card.get("variation"):
        penalty += 60
    if card.get("border_color") not in ("black", "white"):
        penalty += 50
    if card.get("full_art") or card.get("textless"):
        penalty += 40
    if set(card.get("frame_effects") or []) & SPECIAL_FRAME_EFFECTS:
        penalty += 40
    if card.get("frame") not in ("2015", "2003", "1997", "1993"):
        penalty += 20
    if "nonfoil" not in (card.get("finishes") or ["nonfoil"]):
        penalty += 30  # A foil-only printing is not the default version.
    number = str(card.get("collector_number") or "")
    if not number.isdigit():
        penalty += 25  # Star, s/p/z suffixes mark alternate printings.
    if card.get("oversized"):
        penalty += 150
    return penalty


def setup(database: sqlite3.Connection) -> None:
    database.executescript(f"""
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=NORMAL;
      CREATE TABLE cards (
        id TEXT PRIMARY KEY, oracle_id TEXT, name TEXT NOT NULL, normalized_name TEXT NOT NULL,
        mana_cost TEXT, cmc REAL, type_line TEXT, oracle_text TEXT,
        colors_json TEXT, color_identity_json TEXT, keywords_json TEXT, produced_mana_json TEXT,
        card_faces_json TEXT, power TEXT, toughness TEXT, loyalty TEXT, defense TEXT,
        set_code TEXT, set_name TEXT, set_type TEXT, collector_number TEXT, released_at TEXT,
        layout TEXT, rarity TEXT, border_color TEXT, frame TEXT, frame_effects_json TEXT,
        finishes_json TEXT, promo INTEGER, variation INTEGER, full_art INTEGER, textless INTEGER,
        digital INTEGER, reprint INTEGER, games_json TEXT, lang TEXT,
        legalities_json TEXT, prices_json TEXT,
        image_small TEXT, image_normal TEXT, image_large TEXT, image_art_crop TEXT,
        scryfall_uri TEXT NOT NULL, printing_rank INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE card_terms (card_id TEXT NOT NULL, term TEXT NOT NULL, kind TEXT NOT NULL,
        PRIMARY KEY (card_id, term, kind), FOREIGN KEY(card_id) REFERENCES cards(id));
      CREATE INDEX cards_normalized_name_idx ON cards(normalized_name);
      CREATE INDEX card_terms_lookup_idx ON card_terms(kind, term);
      CREATE INDEX cards_oracle_pick_idx ON cards(oracle_id, printing_rank, released_at DESC);
      CREATE INDEX cards_set_idx ON cards(set_code);
    """)
    assert len(COLUMNS) == 44, "COLUMNS must match the cards table definition"


def row_values(card: dict[str, Any]) -> tuple[Any, ...]:
    images = image_values(card)
    return (
        card["id"], card.get("oracle_id"), card["name"], card["name"].lower(),
        card.get("mana_cost"), card.get("cmc"), card.get("type_line"), card.get("oracle_text"),
        json.dumps(card.get("colors", [])), json.dumps(card.get("color_identity", [])),
        json.dumps(card.get("keywords", [])), json.dumps(card.get("produced_mana", [])),
        face_values(card), card.get("power"), card.get("toughness"), card.get("loyalty"), card.get("defense"),
        card.get("set"), card.get("set_name"), card.get("set_type"), card.get("collector_number"),
        card.get("released_at"), card.get("layout"), card.get("rarity"),
        card.get("border_color"), card.get("frame"), json.dumps(card.get("frame_effects", [])),
        json.dumps(card.get("finishes", [])), int(bool(card.get("promo"))), int(bool(card.get("variation"))),
        int(bool(card.get("full_art"))), int(bool(card.get("textless"))), int(bool(card.get("digital"))),
        int(bool(card.get("reprint"))), json.dumps(card.get("games", [])), card.get("lang"),
        json.dumps(card.get("legalities", {})), json.dumps(card.get("prices", {})),
        images["small"], images["normal"], images["large"], images["art_crop"],
        card["scryfall_uri"], printing_rank(card),
    )


def import_bulk(dataset: str, output: Path, contact: str) -> int:
    bulk = request(API, contact)
    record = next((item for item in bulk["data"] if item["type"] == dataset), None)
    if not record:
        raise ValueError(f"Unknown Scryfall bulk dataset: {dataset}")
    uri = record.get("jsonl_download_uri") or record.get("download_uri")
    if not uri:
        raise ValueError("Bulk record did not include a download URI")
    output.parent.mkdir(parents=True, exist_ok=True)
    # Build beside the live file so a running server keeps serving the old catalog.
    staging = output.with_suffix(".building")
    for leftover in (staging, staging.with_name(staging.name + "-wal"), staging.with_name(staging.name + "-shm")):
        if leftover.exists():
            leftover.unlink()
    database = sqlite3.connect(staging)
    setup(database)
    insert_card = f"INSERT OR REPLACE INTO cards VALUES ({','.join('?' for _ in COLUMNS)})"
    count = 0
    headers = {"User-Agent": f"ProsshTCG/0.1 ({contact})"}
    with urllib.request.urlopen(urllib.request.Request(uri, headers=headers), timeout=600) as response:
        stream: io.TextIOBase
        stream = (io.TextIOWrapper(gzip.GzipFile(fileobj=response), encoding="utf-8")
                  if str(uri).endswith(".gz") else io.TextIOWrapper(response, encoding="utf-8"))
        for line in stream:
            line = line.strip().rstrip(",")
            if not line or line in ("[", "]"):
                continue
            card = json.loads(line)
            database.execute(insert_card, row_values(card))
            database.executemany("INSERT OR IGNORE INTO card_terms VALUES (?,?,?)",
                                 ((card["id"], term, kind) for term, kind in card_terms(card)))
            count += 1
            if count % 5000 == 0:
                database.commit()
                print(f"Indexed {count:,} cards", file=sys.stderr)
    database.execute("CREATE TABLE catalog_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    database.executemany("INSERT INTO catalog_meta VALUES (?,?)", [
        ("dataset", dataset), ("source_updated_at", record["updated_at"]),
        ("synced_at", datetime.now(timezone.utc).isoformat()), ("card_count", str(count)),
        ("schema_version", "2"),
    ])
    database.commit()
    database.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    database.close()
    for suffix in ("-wal", "-shm"):
        leftover = output.with_name(output.name + suffix)
        if leftover.exists():
            leftover.unlink()
    if output.exists():
        output.unlink()
    staging.replace(output)
    return count


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Index Scryfall bulk card data into SQLite.")
    parser.add_argument("--dataset", default="default_cards", choices=["oracle_cards", "default_cards", "all_cards"])
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--contact", default="contact@example.com")
    arguments = parser.parse_args()
    total = import_bulk(arguments.dataset, arguments.output, arguments.contact)
    print(f"Indexed {total:,} {arguments.dataset} records into {arguments.output}")
