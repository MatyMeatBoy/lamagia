#!/usr/bin/env python3
"""Streaming Scryfall bulk-data importer for ProsshTCG.

It stores metadata and provider image links only; it never downloads card art.
Run: python tools/card_catalog/sync_scryfall.py --dataset default_cards
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


def setup(database: sqlite3.Connection) -> None:
    database.executescript("""
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=NORMAL;
      CREATE TABLE cards (
        id TEXT PRIMARY KEY, oracle_id TEXT, name TEXT NOT NULL, normalized_name TEXT NOT NULL,
        mana_cost TEXT, cmc REAL, type_line TEXT, oracle_text TEXT, colors_json TEXT,
        color_identity_json TEXT, keywords_json TEXT, set_code TEXT, set_name TEXT,
        collector_number TEXT, released_at TEXT, layout TEXT, rarity TEXT, legalities_json TEXT,
        prices_json TEXT, image_small TEXT, image_normal TEXT, image_large TEXT, image_art_crop TEXT,
        scryfall_uri TEXT NOT NULL
      );
      CREATE TABLE card_terms (card_id TEXT NOT NULL, term TEXT NOT NULL, kind TEXT NOT NULL,
        PRIMARY KEY (card_id, term, kind), FOREIGN KEY(card_id) REFERENCES cards(id));
      CREATE INDEX cards_normalized_name_idx ON cards(normalized_name);
      CREATE INDEX card_terms_lookup_idx ON card_terms(kind, term);
    """)


def import_bulk(dataset: str, output: Path, contact: str) -> int:
    bulk = request(API, contact)
    record = next((item for item in bulk["data"] if item["type"] == dataset), None)
    if not record: raise ValueError(f"Unknown Scryfall bulk dataset: {dataset}")
    uri = record.get("jsonl_download_uri") or record.get("download_uri")
    if not uri: raise ValueError("Bulk record did not include a download URI")
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists(): output.unlink()
    database = sqlite3.connect(output)
    setup(database)
    insert_card = "INSERT INTO cards VALUES (" + ",".join("?" for _ in range(24)) + ")"
    count = 0
    headers = {"User-Agent": f"ProsshTCG/0.1 ({contact})"}
    with urllib.request.urlopen(urllib.request.Request(uri, headers=headers), timeout=300) as response:
        stream: io.TextIOBase
        stream = io.TextIOWrapper(gzip.GzipFile(fileobj=response), encoding="utf-8") if str(uri).endswith(".gz") else io.TextIOWrapper(response, encoding="utf-8")
        for line in stream:
            card = json.loads(line)
            images = image_values(card)
            values = (card["id"], card.get("oracle_id"), card["name"], card["name"].lower(), card.get("mana_cost"), card.get("cmc"), card.get("type_line"), card.get("oracle_text"), json.dumps(card.get("colors", [])), json.dumps(card.get("color_identity", [])), json.dumps(card.get("keywords", [])), card.get("set"), card.get("set_name"), card.get("collector_number"), card.get("released_at"), card.get("layout"), card.get("rarity"), json.dumps(card.get("legalities", {})), json.dumps(card.get("prices", {})), images["small"], images["normal"], images["large"], images["art_crop"], card["scryfall_uri"])
            database.execute(insert_card, values)
            database.executemany("INSERT OR IGNORE INTO card_terms VALUES (?,?,?)", ((card["id"], term, kind) for term, kind in card_terms(card)))
            count += 1
            if count % 2000 == 0:
                database.commit(); print(f"Indexed {count:,} cards", file=sys.stderr)
    database.execute("CREATE TABLE catalog_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    database.executemany("INSERT INTO catalog_meta VALUES (?,?)", [("dataset", dataset), ("source_updated_at", record["updated_at"]), ("synced_at", datetime.now(timezone.utc).isoformat()), ("card_count", str(count))])
    database.commit(); database.close()
    return count


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Index Scryfall bulk card data into SQLite.")
    parser.add_argument("--dataset", default="default_cards", choices=["oracle_cards", "default_cards", "all_cards"])
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--contact", default="contact@example.com")
    arguments = parser.parse_args()
    total = import_bulk(arguments.dataset, arguments.output, arguments.contact)
    print(f"Indexed {total:,} {arguments.dataset} records into {arguments.output}")
