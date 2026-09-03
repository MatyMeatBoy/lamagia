"""Build a reproducible local card pool from EDHREC popularity data.

EDHREC is used only as a popularity signal. Rules behavior comes from the local
catalog and the ProsshTCG engine. The endpoint is an undocumented public JSON
surface, so this tool rate-limits requests, records the retrieval date and keeps
the generated result under ``data/`` (which is intentionally not committed).

Usage:
    python tools/card_catalog/build_popular_pool.py \
      --catalog data/catalog/prossh.sqlite \
      --output data/rules/popular-card-pool.json \
      --count 1500
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import time
from datetime import UTC, datetime
from pathlib import Path
from urllib.request import Request, urlopen


EDHREC_PAGE = "https://json.edhrec.com/pages/top/year-past2years-{page}.json"
USER_AGENT = "ProsshTCG-rules-research/0.1 (local development)"


def slug_key(value: str) -> str:
    return " ".join(value.casefold().replace("’", "'").split())


def fetch_page(page: int) -> list[dict[str, object]]:
    request = Request(EDHREC_PAGE.format(page=page), headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=30) as response:
        payload = json.load(response)
    cards = payload.get("cardviews", [])
    if not isinstance(cards, list):
        raise ValueError(f"EDHREC page {page} did not contain cardviews")
    return [card for card in cards if isinstance(card, dict) and isinstance(card.get("name"), str)]


def catalog_index(database: sqlite3.Connection) -> dict[str, dict[str, object]]:
    rows = database.execute(
        """
        SELECT id, oracle_id, name, normalized_name, type_line, mana_cost, oracle_text,
               power, toughness, loyalty, printing_rank
        FROM cards
        ORDER BY printing_rank DESC, released_at DESC, id
        """
    )
    index: dict[str, dict[str, object]] = {}
    for row in rows:
        item = dict(row)
        key = slug_key(str(item["normalized_name"] or item["name"]))
        index.setdefault(key, item)
    return index


def build_pool(catalog: Path, output: Path, count: int, delay: float) -> None:
    database = sqlite3.connect(catalog)
    database.row_factory = sqlite3.Row
    index = catalog_index(database)
    wanted_pages = (count + 99) // 100
    entries: list[dict[str, object]] = []
    seen: set[str] = set()
    for page in range(1, wanted_pages + 1):
        for offset, card in enumerate(fetch_page(page)):
            if len(entries) >= count:
                break
            name = str(card["name"])
            key = slug_key(name)
            if key in seen:
                continue
            seen.add(key)
            local = index.get(key)
            item: dict[str, object] = {
                "rank": len(entries) + 1,
                "name": name,
                "edhrec_slug": card.get("slug") or card.get("sanitized"),
                "num_decks": card.get("num_decks"),
                "potential_decks": card.get("potential_decks"),
                "catalog_match": local is not None,
            }
            if local:
                item.update({
                    "scryfall_id": local["id"],
                    "oracle_id": local["oracle_id"],
                    "catalog_name": local["name"],
                    "type_line": local["type_line"],
                    "mana_cost": local["mana_cost"],
                    "oracle_text": local["oracle_text"],
                    "power": local["power"],
                    "toughness": local["toughness"],
                    "loyalty": local["loyalty"],
                })
            entries.append(item)
        if page != wanted_pages:
            time.sleep(delay)

    output.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "source": "EDHREC Top Cards (Past 2 Years)",
        "source_url": "https://edhrec.com/top",
        "retrieved_at": datetime.now(UTC).isoformat(),
        "count_requested": count,
        "count_returned": len(entries),
        "catalog_matches": sum(1 for item in entries if item["catalog_match"]),
        "cards": entries,
    }
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"Popular pool written: {len(entries)} cards, "
        f"{payload['catalog_matches']} catalog matches -> {output}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--count", type=int, default=1500)
    parser.add_argument("--delay", type=float, default=0.55)
    arguments = parser.parse_args()
    if arguments.count < 1:
        raise SystemExit("--count debe ser positivo")
    if not arguments.catalog.exists():
        raise SystemExit("No existe el catálogo; ejecuta npm run catalog:sync primero.")
    build_pool(arguments.catalog, arguments.output, arguments.count, max(arguments.delay, 0.5))


if __name__ == "__main__":
    main()
