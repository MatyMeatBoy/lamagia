#!/usr/bin/env python3
"""Import cEDH Decklist Database entries as source-attributed deck profiles.

Deck card lists remain at the creator-provided URL. This avoids scraping a third-party
deck host while still exposing maintained competitive archetypes for import by a user.
"""
from __future__ import annotations
import argparse, json, urllib.request
from datetime import datetime, timezone
from pathlib import Path

SOURCE = "https://raw.githubusercontent.com/cEDH-Decklist-Database/cEDH-Decklist-Database/master/_data/database.json"

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    request = urllib.request.Request(SOURCE, headers={"User-Agent": "ProsshTCG/0.1 (contact@example.com)"})
    with urllib.request.urlopen(request, timeout=30) as response: entries = json.load(response)
    competitive = [entry for entry in entries if entry.get("section") == "COMPETITIVE"]
    payload = {"source": "cEDH Decklist Database", "source_url": "https://github.com/cEDH-Decklist-Database/cEDH-Decklist-Database", "license": "MIT", "synced_at": datetime.now(timezone.utc).isoformat(), "deck_count": len(competitive), "decks": competitive}
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Imported {len(competitive)} competitive cEDH deck profiles into {arguments.output}")
