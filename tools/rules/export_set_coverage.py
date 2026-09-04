"""Build edition-level implementation coverage from the catalog and profiles.

Printings are presentation data. Coverage is calculated by oracle_id, so a
reprint inherits the implementation of the same card while each edition keeps
its own pending list for contributors.
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


PLAYABLE_ONLY = "layout NOT IN ('token','double_faced_token','emblem','art_series','scheme','planar','vanguard','reversible_card') AND (set_type IS NULL OR set_type NOT IN ('token','memorabilia','minigame','vanguard'))"
IGNORED_SET_TYPES = frozenset({"alchemy"})
IGNORED_UN_SET_CODES = frozenset({"ugl", "unh", "ust", "und", "unf"})


def is_ignored_edition(set_code: str, set_type: str, set_name: str) -> bool:
    """Keep Arena-only Alchemy and joke Un- sets out of the active roadmap."""
    return (set_type.casefold() in IGNORED_SET_TYPES
            or "alchemy" in set_name.casefold()
            or set_code.casefold() in IGNORED_UN_SET_CODES)


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


def _release_year(set_name: str, released_at: str) -> str:
    match = re.search(r"\b(19|20)\d{2}\b", set_name)
    return match.group(0) if match else (released_at[:4] if released_at[:4].isdigit() else "undated")


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")[:48] or "other"


def product_group(set_type: str, set_name: str, released_at: str = "") -> str:
    """Choose a stable top-level product family; detail belongs in subgroup."""
    name = set_name.casefold()
    kind = set_type.casefold()

    if kind in {"core", "expansion"}:
        return kind
    if "jumpstart" in name:
        return "jumpstart"
    if "duel deck" in name or kind == "duel_deck":
        return "duel-decks"
    if "planechase" in name or kind == "planechase":
        return "planechase"
    if "masters" in name or "remastered" in name or kind == "masters":
        return "masters-remastered"
    if "conspiracy" in name:
        return "conspiracy"
    if "starter" in name or kind == "starter":
        return "starter"
    if "premium deck" in name or kind == "premium_deck":
        return "premium-decks"
    if "spellbook" in name or kind == "spellbook":
        return "spellbooks"
    if "anthology" in name:
        return "anthologies"
    if "secret lair" in name:
        return "secret-lair"
    if kind == "promo" or "promo" in name:
        promo_groups = (
            ("friday night magic", "promos-fnm"),
            ("judge gift", "promos-judge"),
            ("wizards play network", "promos-wpn"),
            ("magicfest", "promos-magicfest"),
            ("regional championship", "promos-regional"),
            ("comic-con", "promos-comic-con"),
            ("standard showdown", "promos-standard-showdown"),
            ("magic player rewards", "promos-player-rewards"),
            ("arena", "promos-arena"),
            ("love your lgs", "promos-lgs"),
            ("guru", "promos-guru"),
            ("champions and states", "promos-championship"),
            ("world championship", "promos-championship"),
            ("junior", "promos-junior"),
        )
        for token, group in promo_groups:
            if token in name:
                return "promos"
        if name.endswith(" promos") or " promos" in name:
            return "promos"
        return "promos"
    if kind == "funny" or any(token in name for token in ("un-", "unstable", "unfinity", "heroes of the realm")):
        return "funny-special"
    if "alchemy" in name or kind == "alchemy":
        return "alchemy"
    if kind == "commander" or "commander" in name:
        return "commander"
    if kind == "box" and "deck" in name:
        return "deck-products"
    if kind == "box":
        return "boxed-products"
    if kind == "draft_innovation":
        return "supplemental"
    if kind == "masterpiece":
        return "masterpieces"
    if kind == "eternal":
        return "eternal"
    return kind.replace("_", "-") or "other"


# Expansion blocks keep the historical map navigable: Ravnica, Mirrodin,
# Theros, etc. This is presentation metadata only; rules still key by oracle_id.
EXPANSION_BLOCKS = (
    ("ravnica", "Ravnica"), ("mirrodin", "Mirrodin"), ("phyrexia", "Phyrexia"),
    ("theros", "Theros"), ("zendikar", "Zendikar"), ("innistrad", "Innistrad"),
    ("dominaria", "Dominaria"), ("tarkir", "Tarkir"), ("ixalan", "Ixalan"),
    ("eldraine", "Eldraine"), ("kamigawa", "Kamigawa"), ("lorwyn", "Lorwyn"),
    ("alara", "Alara"), ("kaladesh", "Kaladesh"), ("amonkhet", "Amonkhet"),
    ("strixhaven", "Strixhaven"), ("kaldheim", "Kaldheim"), ("capenna", "Capenna"),
    ("bloomburrow", "Bloomburrow"), ("thunder junction", "Thunder Junction"),
    ("ice age", "Ice Age"), ("mirage", "Mirage"), ("tempest", "Tempest"),
    ("urza", "Urza"), ("mercadian", "Masques"), ("masques", "Masques"),
    ("invasion", "Invasion"), ("odyssey", "Odyssey"), ("onslaught", "Onslaught"),
    ("time spiral", "Time Spiral"), ("arcavios", "Strixhaven"),
    ("wilds of eldraine", "Eldraine"), ("march of the machine", "Phyrexia"),
    ("new phyrexia", "Phyrexia"), ("scars of mirrodin", "Mirrodin"),
)


def product_subgroup(set_type: str, set_name: str, released_at: str = "") -> str:
    """Return the navigable subgroup nested under product_group()."""
    name = set_name.casefold()
    kind = set_type.casefold()
    year = _release_year(set_name, released_at)
    decade = f"{year[:3]}0s" if year.isdigit() else "undated"
    if kind in {"core", "expansion"}:
        for token, block in EXPANSION_BLOCKS:
            if token in name:
                return _slug(block)
        return decade
    if kind == "commander" or "commander" in name:
        return year
    if "secret lair" in name or kind == "secret_lair":
        return _slug(set_name)
    if kind == "promo" or "promo" in name:
        promo_groups = (
            ("friday night magic", "fnm"), ("judge gift", "judge"),
            ("wizards play network", "wpn"), ("magicfest", "magicfest"),
            ("regional championship", "regional"), ("comic-con", "comic-con"),
            ("standard showdown", "standard-showdown"), ("magic player rewards", "player-rewards"),
            ("arena", "arena"), ("love your lgs", "lgs"), ("guru", "guru"),
            ("champions and states", "championship"), ("world championship", "championship"),
            ("junior", "junior"),
        )
        for token, label in promo_groups:
            if token in name:
                return f"{label}-{year}"
        if " promos" in name:
            return _slug(re.sub(r"\s+promos?", "", name).strip())
        return _slug(set_name)
    if "jumpstart" in name or "duel deck" in name or "planechase" in name:
        return _slug(set_name)
    if kind in {"box", "draft_innovation", "masters", "masterpiece", "funny", "alchemy"}:
        return _slug(set_name)
    return decade


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
    ignored: list[dict[str, str]] = []
    for code, meta in grouped.items():
        if is_ignored_edition(code, meta["setType"], meta["name"]):
            ignored.append({"code": code, "name": meta["name"], "setType": meta["setType"]})
            continue
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
            "group": product_group(meta["setType"], meta["name"], meta["releasedAt"]),
            "subgroup": product_subgroup(meta["setType"], meta["name"], meta["releasedAt"]),
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
        "excludedEditions": sorted(ignored, key=lambda entry: (entry["name"].casefold(), entry["code"])),
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
        f"> Fuera del roadmap por ahora: **{len(payload.get('excludedEditions', []))}** ediciones Alchemy (exclusivas de Arena) y Un- (sets de broma).",
        "",
        "## Resumen cronológico",
        "",
        "| Fecha | Edición | Grupo | Subgrupo | Categoría | Cartas únicas | Implementadas | Pendientes | % |",
        "|---|---|---|---|---:|---:|---:|---:|---:|",
    ]
    for entry in payload["sets"]:
        lines.append(f"| {entry['releasedAt'] or '—'} | {entry['name']} (`{entry['code'].upper()}`) | {entry['group']} | {entry['subgroup']} | {entry['category']} | {entry['uniqueCards']} | {entry['implemented']} | {entry['pending']} | {entry['percentage']}% |")
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for entry in payload["sets"]:
        grouped[(entry["group"], entry["subgroup"])].append(entry)
    lines.extend(["", "## Resumen por grupo y subgrupo", "", "| Grupo | Subgrupo | Ediciones | Cartas únicas | Implementadas | Pendientes | % |", "|---|---|---:|---:|---:|---:|---:|"])
    for (group, subgroup), entries in sorted(grouped.items()):
        unique = sum(entry["uniqueCards"] for entry in entries)
        done = sum(entry["implemented"] for entry in entries)
        lines.append(f"| {group} | {subgroup} | {len(entries)} | {unique} | {done} | {unique - done} | {round(done / unique * 100, 1) if unique else 100.0}% |")
    lines.extend(["", "## Pendientes por edición", ""])
    for entry in payload["sets"]:
        if not entry["pendingCards"]:
            continue
        lines.extend([f"### {entry['group']} / {entry['subgroup']} · {entry['name']} (`{entry['code'].upper()}`)", ""])
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
