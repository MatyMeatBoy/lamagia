"""Build edition-level implementation coverage from the catalog and profiles.

Printings are presentation data. Coverage is calculated by oracle_id, so a
reprint inherits the implementation of the same card while each edition keeps
its own pending list for contributors.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


PLAYABLE_ONLY = "layout NOT IN ('token','double_faced_token','emblem','art_series','scheme','planar','vanguard','reversible_card') AND (set_type IS NULL OR set_type NOT IN ('token','memorabilia','minigame','vanguard'))"


def category(set_type: str, set_name: str) -> str:
    value = set_type.casefold()
    if "secret lair" in set_name.casefold():
        return "secret-lair"
    if value in {"core", "expansion"}:
        return "main"
    if value == "commander":
        return "commander"
    if value == "secret_lair":
        return "secret-lair"
    return "other"


def load_profiles(path: Path) -> dict[str, dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    profiles: dict[str, dict[str, Any]] = {}
    for profile in payload["profiles"]:
        profiles[str(profile["scryfall_id"])] = profile
        if profile.get("oracle_id"):
            profiles.setdefault(str(profile["oracle_id"]), profile)
    return profiles


def build(catalog: Path, profiles_path: Path) -> dict[str, Any]:
    profiles = load_profiles(profiles_path)
    database = sqlite3.connect(f"file:{catalog}?mode=ro", uri=True)
    database.row_factory = sqlite3.Row
    try:
        rows = database.execute(
            f"SELECT id, oracle_id, name, set_code, set_name, set_type, released_at FROM cards WHERE {PLAYABLE_ONLY} ORDER BY released_at ASC, id ASC"
        )
        grouped: dict[str, dict[str, Any]] = {}
        cards_by_set: dict[str, dict[str, sqlite3.Row]] = defaultdict(dict)
        for row in rows:
            code = str(row["set_code"] or "").lower()
            if not code:
                continue
            identity = str(row["oracle_id"] or row["id"])
            cards_by_set[code].setdefault(identity, row)
            grouped.setdefault(code, {
                "code": code,
                "name": str(row["set_name"] or code.upper()),
                "setType": str(row["set_type"] or "unknown"),
                "releasedAt": str(row["released_at"] or ""),
            })
    finally:
        database.close()

    sets: list[dict[str, Any]] = []
    for code, meta in grouped.items():
        entries = []
        for identity, row in cards_by_set[code].items():
            profile = profiles.get(identity) or profiles.get(str(row["id"]), {})
            entries.append({
                "oracleId": identity,
                "scryfallId": str(row["id"]),
                "name": str(row["name"]),
                "implemented": bool(profile.get("fullyImplemented")),
            })
        entries.sort(key=lambda entry: (not entry["implemented"], entry["name"].casefold(), entry["oracleId"]))
        implemented = sum(bool(entry["implemented"]) for entry in entries)
        sets.append({
            **meta,
            "category": category(meta["setType"], meta["name"]),
            "uniqueCards": len(entries),
            "implemented": implemented,
            "pending": len(entries) - implemented,
            "percentage": round((implemented / len(entries)) * 100, 1) if entries else 100.0,
            "pendingCards": [entry for entry in entries if not entry["implemented"]],
        })
    sets.sort(key=lambda entry: (entry["releasedAt"] or "9999-99-99", entry["name"].casefold(), entry["code"]))
    total_cards = sum(entry["uniqueCards"] for entry in sets)
    total_implemented = sum(entry["implemented"] for entry in sets)
    return {
        "format": "prossh-set-coverage/v1",
        "source": "local normalized catalog joined to ProsshTCG engine profiles by oracle_id",
        "generatedAt": datetime.now(UTC).isoformat(),
        "setCount": len(sets),
        "membershipCount": total_cards,
        "implementedMembershipCount": total_implemented,
        "percentage": round((total_implemented / total_cards) * 100, 1) if total_cards else 100.0,
        "sets": sets,
    }


def markdown(payload: dict[str, Any]) -> str:
    lines = [
        "# Cobertura de implementación por edición",
        "",
        "> Generado por `tools/rules/export_set_coverage.py`. La cobertura se calcula por `oracle_id`: las reimpresiones comparten lógica, pero cada edición conserva su lista de pendientes.",
        "> Un porcentaje de 100% significa que todas las cartas jugables únicas de esa edición tienen un perfil completamente ejecutable; no es una afirmación de que todas las reglas de Magic estén modeladas.",
        "",
        f"Ediciones: **{payload['setCount']:,}** · pertenencias únicas: **{payload['membershipCount']:,}** · implementadas: **{payload['implementedMembershipCount']:,}** · cobertura: **{payload['percentage']}%**",
        "",
        "## Resumen cronológico",
        "",
        "| Fecha | Edición | Categoría | Cartas únicas | Implementadas | Pendientes | % |",
        "|---|---|---|---:|---:|---:|---:|",
    ]
    for entry in payload["sets"]:
        lines.append(f"| {entry['releasedAt'] or '—'} | {entry['name']} (`{entry['code'].upper()}`) | {entry['category']} | {entry['uniqueCards']} | {entry['implemented']} | {entry['pending']} | {entry['percentage']}% |")
    lines.extend(["", "## Pendientes por edición", ""])
    for entry in payload["sets"]:
        if not entry["pendingCards"]:
            continue
        lines.extend([f"### {entry['name']} (`{entry['code'].upper()}`)", ""])
        for card in entry["pendingCards"]:
            lines.append(f"- [ ] {card['name']} — `{card['oracleId']}`")
        lines.append("")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=Path("data/catalog/prossh.sqlite"))
    parser.add_argument("--profiles", type=Path, default=Path("data/rules/engine-card-profiles.json"))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--markdown", type=Path, required=True)
    args = parser.parse_args()
    if not args.catalog.exists() or not args.profiles.exists():
        raise SystemExit("Ejecuta primero npm run catalog:sync y npm run rules:engine:export.")
    payload = build(args.catalog, args.profiles)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    args.markdown.parent.mkdir(parents=True, exist_ok=True)
    args.markdown.write_text(markdown(payload), encoding="utf-8")
    print(f"Set coverage written: {payload['setCount']:,} editions; {payload['percentage']}% -> {args.output}")


if __name__ == "__main__":
    main()
