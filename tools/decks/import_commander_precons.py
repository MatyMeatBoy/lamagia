#!/usr/bin/env python3
"""Import every MTGJSON Commander Deck product and resolve each printing locally.

MTGJSON supplies deck contents and commander/display-commander print IDs. It does
not provide a canonical product-box image URL, so `cover_art_uri` deliberately
uses the display commander's linked Scryfall art crop and records that provenance.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

API = "https://mtgjson.com/api/v5"
USER_AGENT = "ProsshTCG/0.1 (contact@example.com)"


def fetch_json(url: str) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def resolve(connection: sqlite3.Connection, scryfall_id: str, name: str) -> dict[str, Any] | None:
    row = connection.execute(
        """SELECT id, oracle_id, name, mana_cost, cmc, type_line, oracle_text,
                  image_normal, image_art_crop
           FROM cards WHERE id = ? OR normalized_name = ? ORDER BY released_at DESC LIMIT 1""",
        (scryfall_id, name.lower()),
    ).fetchone()
    if not row:
        return None
    keys = ("scryfall_id", "oracle_id", "name", "mana_cost", "cmc", "type_line", "oracle_text", "image_normal", "image_art_crop")
    return dict(zip(keys, row))


def expand_cards(items: list[dict[str, Any]], connection: sqlite3.Connection, deck_name: str) -> list[dict[str, Any]]:
    cards: list[dict[str, Any]] = []
    for item in items:
        identifiers = item.get("identifiers") or {}
        resolved = resolve(connection, identifiers.get("scryfallId", ""), item["name"])
        if not resolved:
            raise RuntimeError(f"{deck_name}: cannot resolve {item['name']} in the local catalog")
        cards.extend([resolved] * int(item.get("count", 1)))
    return cards


def import_deck(entry: dict[str, Any], catalog: Path) -> dict[str, Any]:
    remote = fetch_json(f"{API}/decks/{entry['fileName']}.json")["data"]
    connection = sqlite3.connect(catalog)
    try:
        commanders = expand_cards(remote.get("commander") or [], connection, entry["name"])
        mainboard = expand_cards(remote.get("mainBoard") or [], connection, entry["name"])
        cards = commanders + mainboard
        if len(cards) != 100 or not commanders:
            raise RuntimeError(f"{entry['name']}: expected commander plus 99 cards, got {len(cards)}")
        display = expand_cards(remote.get("displayCommander") or remote.get("commander") or [], connection, entry["name"])[0]
        return {
            "id": entry["fileName"], "name": entry["name"], "set_code": entry["code"],
            "released_at": entry.get("releaseDate"), "commanders": [card["name"] for card in commanders],
            "cards": cards, "source_url": entry.get("source"), "sealed_product_uuids": remote.get("sealedProductUuids") or [],
            "cover_art_uri": display.get("image_art_crop"), "cover_art_kind": "display_commander_art_crop",
        }
    finally:
        connection.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=4)
    arguments = parser.parse_args()
    if not arguments.catalog.exists():
        raise SystemExit("Run npm run catalog:sync before importing Commander precons.")
    index = fetch_json(f"{API}/DeckList.json")["data"]
    entries = [entry for entry in index if entry.get("type") == "Commander Deck"]
    imported: list[dict[str, Any]] = []
    failures: list[str] = []
    with ThreadPoolExecutor(max_workers=max(1, min(arguments.workers, 8))) as pool:
        futures = {pool.submit(import_deck, entry, arguments.catalog): entry["name"] for entry in entries}
        for future in as_completed(futures):
            try:
                imported.append(future.result())
            except Exception as error:  # Aggregate every broken product instead of silently dropping it.
                failures.append(f"{futures[future]}: {error}")
    if failures:
        raise SystemExit("Precon import failed:\n" + "\n".join(sorted(failures)))
    imported.sort(key=lambda deck: (deck["released_at"] or "", deck["name"]))
    payload = {
        "format": "Commander", "source": "MTGJSON DeckList / individual deck files", "source_url": "https://mtgjson.com/downloads/all-decks/",
        "license": "CC BY 4.0 (verify current upstream license before distribution)", "synced_at": datetime.now(timezone.utc).isoformat(),
        "cover_art_notice": "Linked display-commander art crop; not asserted to be official product-box art.", "decks": imported,
    }
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Validated and wrote {len(imported)} Commander precon products ({sum(len(deck['cards']) for deck in imported)} cards).")
