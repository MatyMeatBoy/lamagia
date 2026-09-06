#!/usr/bin/env python3
"""Export token printings and token-effect work clusters.

Tokens are presentation objects, not playable cards: they are kept out of the
normal set coverage denominator but remain indexed by printing/set.  The
inventory groups equivalent token faces by normalized characteristics and
marks non-trivial rules text for worker assignment.
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

FORMAT = "prossh-token-inventory/v1"
NON_TRIVIAL = re.compile(r"\b(?:when|whenever|at the beginning|[A-Za-z]+:|flying|haste|deathtouch|lifelink|trample|ward|menace|first strike|double strike|enters|dies|attacks|blocks|sacrifice|draw|add|exile|counter|explore|transform)\b", re.I)
ABILITY_CLUSTERS = (
    ("token-trigger", re.compile(r"\b(?:when|whenever|at the beginning|at the end)\b", re.I)),
    ("token-activated", re.compile(r"\{[^}]+\}|\b(?:tap|sacrifice)\b.*:", re.I)),
    ("token-keyword", re.compile(r"\b(?:flying|haste|deathtouch|lifelink|trample|ward|menace|first strike|double strike|vigilance|defender)\b", re.I)),
    ("token-zone-effect", re.compile(r"\b(?:draw|add|exile|counter|explore|transform|dies|enters)\b", re.I)),
)


def key(row: sqlite3.Row) -> str:
    fields = (row["name"], row["type_line"], row["oracle_text"], row["power"], row["toughness"], row["colors_json"])
    return "|".join(str(value or "").strip().casefold() for value in fields)


def cluster_for(text: str) -> str:
    for name, pattern in ABILITY_CLUSTERS:
        if pattern.search(text):
            return name
    return "token-rules"


def is_token_face(row: sqlite3.Row) -> bool:
    type_line = str(row["type_line"] or "")
    name = str(row["name"] or "").casefold()
    if "emblem" in type_line.casefold() or "dungeon" in type_line.casefold() or """dungeon""" in name:
        return False
    return "token" in type_line.casefold() or "token" in name


def build(catalog: Path) -> dict[str, Any]:
    db = sqlite3.connect(f"file:{catalog}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    try:
        rows = db.execute("""
          SELECT id, oracle_id, name, type_line, oracle_text, power, toughness,
                 colors_json, set_code, set_name, set_type, released_at,
                 layout, image_normal, image_art_crop
          FROM cards
          WHERE layout IN ('token','double_faced_token') OR set_type = 'token'
          ORDER BY released_at, set_code, collector_number, id
        """).fetchall()
    finally:
        db.close()
    groups: dict[str, dict[str, Any]] = {}
    for row in rows:
        if not is_token_face(row):
            continue
        group = groups.setdefault(key(row), {
            "tokenKey": key(row), "name": row["name"], "typeLine": row["type_line"] or "",
            "oracleText": row["oracle_text"] or "", "power": row["power"], "toughness": row["toughness"],
            "sets": set(), "printings": [],
        })
        group["sets"].add(str(row["set_code"] or "").lower())
        group["printings"].append({
            "scryfallId": row["id"], "oracleId": row["oracle_id"], "setCode": row["set_code"],
            "setName": row["set_name"], "releasedAt": row["released_at"],
            "imageNormal": row["image_normal"], "imageArtCrop": row["image_art_crop"],
        })
    inventories = []
    clusters: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for group in groups.values():
        group["sets"] = sorted(group["sets"])
        text = str(group["oracleText"])
        needs_work = bool(text and NON_TRIVIAL.search(text))
        group["needsRulesWork"] = needs_work
        group["cluster"] = cluster_for(text) if needs_work else "token-frame-only"
        inventories.append(group)
        if needs_work:
            clusters[group["cluster"]].append({"name": group["name"], "tokenKey": group["tokenKey"], "sets": group["sets"], "oracleText": text})
    inventories.sort(key=lambda item: (not item["needsRulesWork"], item["name"].casefold(), item["tokenKey"]))
    return {"format": FORMAT, "generatedAt": datetime.now(UTC).isoformat(), "tokenCount": len(inventories),
            "printingCount": sum(len(item["printings"]) for item in inventories), "tokens": inventories,
            "clusters": {name: sorted(items, key=lambda item: item["name"].casefold()) for name, items in clusters.items()}}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--markdown-output", type=Path)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    inventory = build(args.catalog)
    args.output.write_text(json.dumps(inventory, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.markdown_output:
        lines = ["# Generated token worker queue", "", f"Generated: `{inventory['generatedAt']}`", "",
                 f"Unique definitions: **{inventory['tokenCount']:,}** · printings: **{inventory['printingCount']:,}**", ""]
        for cluster, items in sorted(inventory["clusters"].items()):
            lines.extend([f"## `{cluster}` ({len(items)})", "", "Claim one token key or a disjoint batch before editing.", ""])
            for item in items:
                sets = ", ".join(item["sets"]) or "(set unknown)"
                lines.append(f"- `{cluster}:{item['tokenKey']}` — **{item['name']}** · sets: {sets} · `{item['oracleText']}`")
            lines.append("")
        args.markdown_output.parent.mkdir(parents=True, exist_ok=True)
        args.markdown_output.write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
