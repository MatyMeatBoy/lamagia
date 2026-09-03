#!/usr/bin/env python3
"""Import Scryfall's rulings bulk dataset into the local catalog.

Rulings are the clarifications Wizards publishes for a card (the same body of
text Gatherer shows). They are keyed by `oracle_id`, so one row set covers every
printing of a card and survives a catalog re-sync of the `cards` table.

This is a separate tool from `sync_scryfall.py` because the rulings dataset is
its own bulk file and changes on a different cadence; re-running it does not
touch card rows.

Run: python tools/card_catalog/sync_rulings.py --catalog data/catalog/prossh.sqlite
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
from typing import Any

API = "https://api.scryfall.com/bulk-data"


def request(url: str, contact: str) -> Any:
    headers = {"Accept": "application/json;q=0.9,*/*;q=0.8", "User-Agent": f"ProsshTCG/0.1 ({contact})"}
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60) as response:
        return json.load(response)


def setup(database: sqlite3.Connection) -> None:
    database.executescript("""
      CREATE TABLE IF NOT EXISTS card_rulings (
        oracle_id TEXT NOT NULL,
        published_at TEXT,
        source TEXT,
        comment TEXT NOT NULL,
        PRIMARY KEY (oracle_id, published_at, comment)
      );
      CREATE INDEX IF NOT EXISTS card_rulings_oracle_idx ON card_rulings(oracle_id);
    """)


def import_rulings(catalog: Path, contact: str) -> int:
    bulk = request(API, contact)
    record = next((item for item in bulk["data"] if item["type"] == "rulings"), None)
    if not record:
        raise SystemExit("Scryfall did not advertise a rulings bulk dataset.")
    uri = record.get("jsonl_download_uri") or record.get("download_uri")
    if not uri:
        raise SystemExit("The rulings bulk record has no download URI.")

    database = sqlite3.connect(catalog)
    setup(database)
    database.execute("DELETE FROM card_rulings")
    insert = "INSERT OR IGNORE INTO card_rulings VALUES (?,?,?,?)"
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
            ruling = json.loads(line)
            oracle_id = ruling.get("oracle_id")
            comment = ruling.get("comment")
            if not oracle_id or not comment:
                continue
            database.execute(insert, (oracle_id, ruling.get("published_at"), ruling.get("source"), comment))
            count += 1
            if count % 20000 == 0:
                database.commit()
                print(f"Indexed {count:,} rulings", file=sys.stderr)
    database.execute("INSERT OR REPLACE INTO catalog_meta VALUES (?,?)",
                     ("rulings_synced_at", datetime.now(timezone.utc).isoformat()))
    database.execute("INSERT OR REPLACE INTO catalog_meta VALUES (?,?)", ("rulings_count", str(count)))
    database.commit()
    database.close()
    return count


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Index Scryfall card rulings into the local catalog.")
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--contact", default="contact@example.com")
    arguments = parser.parse_args()
    if not arguments.catalog.exists():
        raise SystemExit("Run npm run catalog:sync before importing rulings.")
    total = import_rulings(arguments.catalog, arguments.contact)
    print(f"Indexed {total:,} rulings into {arguments.catalog}")
