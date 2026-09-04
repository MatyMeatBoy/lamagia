#!/usr/bin/env python3
"""Generate deterministic Commander deck proposals from local sources.

The generator is deliberately a library first.  It never fabricates a card or
assumes that a name is a stable identity: every selected card must resolve to a
catalog record with an ``oracle_id``.  Network access is opt-in and only loads
an explicitly supplied, documented/public JSON export; the normal path is a
local SQLite catalog plus cached/source-imported JSON files.
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from collections import Counter, OrderedDict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Mapping, Protocol, Sequence
from urllib.request import Request, urlopen

COLORS = frozenset("WUBRGC")
KNOWN_CATEGORIES = ("lands", "ramp", "draw", "removal", "protection", "tutors", "threats", "synergy", "flex")
DEFAULT_QUOTAS = {"ramp": 10, "draw": 10, "removal": 8, "protection": 5}


def normalize_name(value: str) -> str:
    return " ".join(value.casefold().replace("’", "'").split())


def parse_colors(value: str | Iterable[str] | None) -> frozenset[str] | None:
    if value is None:
        return None
    if isinstance(value, str):
        cleaned = value.strip().casefold()
        if cleaned in ("c", "colorless"):
            return frozenset()
        raw = re.findall(r"[WUBRG]", value.upper())
        remainder = re.sub(r"[WUBRG\s,]+", "", value.upper())
        if remainder:
            raise ValueError(f"invalid color(s): {remainder}")
    else:
        raw = value
    result = frozenset(str(item).upper() for item in raw if str(item).upper() != "C")
    invalid = result - COLORS
    if invalid:
        raise ValueError(f"invalid color(s): {', '.join(sorted(invalid))}")
    return result


def _json_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return []
        return parsed if isinstance(parsed, list) else []
    return []


def _json_object(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _legal_commander(value: Any) -> bool | None:
    """Return True/False when Scryfall legality is known, otherwise None."""
    if not isinstance(value, Mapping) or "commander" not in value:
        return None
    return str(value["commander"]).casefold() == "legal"


@dataclass(frozen=True)
class Card:
    scryfall_id: str
    oracle_id: str
    name: str
    type_line: str = ""
    oracle_text: str = ""
    mana_cost: str | None = None
    cmc: float | None = None
    color_identity: frozenset[str] = frozenset()
    legalities: Mapping[str, Any] = field(default_factory=dict)
    printing_rank: int = 0
    released_at: str = ""

    @property
    def is_basic_land(self) -> bool:
        line = self.type_line.casefold()
        return "basic" in line and "land" in line

    @property
    def is_land(self) -> bool:
        return "land" in self.type_line.casefold()

    def normalized(self, category: str | None = None, provenance: Sequence[Mapping[str, Any]] = ()) -> dict[str, Any]:
        result: dict[str, Any] = {
            "scryfall_id": self.scryfall_id,
            "oracle_id": self.oracle_id,
            "name": self.name,
            "type_line": self.type_line,
            "oracle_text": self.oracle_text,
            "color_identity": sorted(self.color_identity),
        }
        if self.mana_cost is not None:
            result["mana_cost"] = self.mana_cost
        if self.cmc is not None:
            result["cmc"] = self.cmc
        if category:
            result["category"] = category
        if provenance:
            result["provenance"] = [dict(item) for item in provenance]
        return result


class Catalog(Protocol):
    def resolve(self, *, name: str | None = None, oracle_id: str | None = None, scryfall_id: str | None = None) -> Card | None: ...

    def cards(self) -> Iterable[Card]: ...


def _card_from_mapping(value: Mapping[str, Any]) -> Card | None:
    oracle_id = str(value.get("oracle_id") or value.get("oracleId") or "")
    scryfall_id = str(value.get("scryfall_id") or value.get("scryfallId") or value.get("id") or "")
    name = str(value.get("name") or "")
    if not oracle_id or not scryfall_id or not name:
        return None
    identity = parse_colors(_json_list(value.get("color_identity") or value.get("colorIdentity"))) or frozenset()
    return Card(
        scryfall_id=scryfall_id,
        oracle_id=oracle_id,
        name=name,
        type_line=str(value.get("type_line") or value.get("typeLine") or ""),
        oracle_text=str(value.get("oracle_text") or value.get("oracleText") or ""),
        mana_cost=value.get("mana_cost"),
        cmc=float(value["cmc"]) if value.get("cmc") is not None else None,
        color_identity=identity,
        legalities=_json_object(value.get("legalities")),
        printing_rank=int(value.get("printing_rank") or 0),
        released_at=str(value.get("released_at") or ""),
    )


class MemoryCatalog:
    """Small catalog implementation useful for callers and network-free tests."""

    def __init__(self, cards: Iterable[Mapping[str, Any] | Card]):
        self._by_oracle: dict[str, Card] = {}
        self._by_name: dict[str, Card] = {}
        self._by_scryfall: dict[str, Card] = {}
        for item in cards:
            card = item if isinstance(item, Card) else _card_from_mapping(item)
            if card is None:
                continue
            old = self._by_oracle.get(card.oracle_id)
            if old is None or (card.printing_rank, card.released_at, card.scryfall_id) > (old.printing_rank, old.released_at, old.scryfall_id):
                self._by_oracle[card.oracle_id] = card
            self._by_scryfall[card.scryfall_id] = card
            name_key = normalize_name(card.name)
            old_name = self._by_name.get(name_key)
            if old_name is None or (card.printing_rank, card.released_at, card.scryfall_id) > (old_name.printing_rank, old_name.released_at, old_name.scryfall_id):
                self._by_name[name_key] = card

    def resolve(self, *, name: str | None = None, oracle_id: str | None = None, scryfall_id: str | None = None) -> Card | None:
        if oracle_id and oracle_id in self._by_oracle:
            return self._by_oracle[oracle_id]
        if scryfall_id and scryfall_id in self._by_scryfall:
            return self._by_scryfall[scryfall_id]
        return self._by_name.get(normalize_name(name)) if name else None

    def cards(self) -> Iterable[Card]:
        return self._by_oracle.values()


class SQLiteCatalog(MemoryCatalog):
    """Read the repository's Scryfall SQLite catalog without modifying it."""

    def __init__(self, path: Path):
        connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        columns = {row[1] for row in connection.execute("PRAGMA table_info(cards)")}
        wanted = ["id", "oracle_id", "name", "type_line", "oracle_text", "mana_cost", "cmc", "color_identity_json", "legalities_json", "printing_rank", "released_at"]
        wanted = [column for column in wanted if column in columns]
        rows = connection.execute(f"SELECT {', '.join(wanted)} FROM cards").fetchall()
        connection.close()
        records: list[dict[str, Any]] = []
        for row in rows:
            record = dict(zip(wanted, row))
            record["color_identity"] = _json_list(record.pop("color_identity_json", []))
            record["legalities"] = _json_object(record.pop("legalities_json", {}))
            records.append(record)
        super().__init__(records)


@dataclass(frozen=True)
class Candidate:
    card: Mapping[str, Any]
    score: float = 0.0
    rank: int | None = None
    category: str | None = None
    tier: int | None = None
    provenance: Mapping[str, Any] = field(default_factory=dict)


class SourceAdapter(Protocol):
    name: str

    def candidates(self, commander: Card, *, constraints: Mapping[str, Any]) -> Iterable[Candidate]: ...


class JsonDeckDatabaseAdapter:
    """Popularity adapter for existing ``{"format":"Commander","decks":[]}` files."""

    def __init__(self, path: Path, *, name: str | None = None):
        self.path = path
        self.name = name or f"local-decks:{path.name}"
        self.payload = json.loads(path.read_text(encoding="utf-8"))

    @staticmethod
    def _commander_keys(deck: Mapping[str, Any]) -> set[str]:
        raw = deck.get("commanders") or deck.get("commander") or []
        if isinstance(raw, str):
            raw = [raw]
        keys: set[str] = set()
        for item in raw:
            if isinstance(item, Mapping):
                keys.add(str(item.get("oracle_id") or item.get("oracleId") or ""))
                keys.add(normalize_name(str(item.get("name") or "")))
            else:
                keys.add(normalize_name(str(item)))
        return {key for key in keys if key}

    def candidates(self, commander: Card, *, constraints: Mapping[str, Any]) -> Iterable[Candidate]:
        if str(self.payload.get("format") or "").casefold() != "commander":
            return []
        wanted_ids = {commander.oracle_id, normalize_name(commander.name)}
        include_ids = {str(item) for item in constraints.get("deck_ids", [])}
        exclude_ids = {str(item) for item in constraints.get("exclude_deck_ids", [])}
        frequency: Counter[str] = Counter()
        samples: dict[str, Mapping[str, Any]] = {}
        evidence: dict[str, list[dict[str, Any]]] = {}
        tiers: dict[str, int | None] = {}
        matched_decks = 0
        for deck in self.payload.get("decks", []):
            if not isinstance(deck, Mapping):
                continue
            deck_id = str(deck.get("id") or deck.get("name") or "")
            if include_ids and deck_id not in include_ids or deck_id in exclude_ids:
                continue
            deck_format = str(deck.get("format") or self.payload.get("format") or "").casefold()
            if deck_format != "commander" or not wanted_ids.intersection(self._commander_keys(deck)):
                continue
            matched_decks += 1
            raw_tier = deck.get("tier") or deck.get("power_level") or deck.get("powerLevel")
            try:
                deck_tier = int(raw_tier) if raw_tier is not None else None
            except (TypeError, ValueError):
                deck_tier = None
            for item in deck.get("cards", []):
                if not isinstance(item, Mapping):
                    continue
                count = int(item.get("count") or 1)
                key = str(item.get("oracle_id") or item.get("oracleId") or item.get("scryfall_id") or item.get("id") or normalize_name(str(item.get("name") or "")))
                if not key:
                    continue
                frequency[key] += max(1, count)
                samples.setdefault(key, item)
                tiers.setdefault(key, deck_tier)
                evidence.setdefault(key, []).append({"deck_id": deck_id, "deck_name": deck.get("name") or deck_id, "count": count})
        result = []
        for rank, (key, count) in enumerate(sorted(frequency.items(), key=lambda pair: (-pair[1], pair[0])), start=1):
            result.append(Candidate(
                card=samples[key], score=float(count), rank=rank, tier=tiers[key],
                provenance={"adapter": self.name, "source": str(self.path), "matched_decks": matched_decks, "frequency": count, "decks": evidence[key]},
            ))
        return result


def _walk_card_records(value: Any) -> Iterable[Mapping[str, Any]]:
    if isinstance(value, Mapping):
        if isinstance(value.get("name"), str) and any(key in value for key in ("oracle_id", "oracleId", "scryfall_id", "scryfallId", "rank", "num_decks", "inclusion")):
            yield value
        for child in value.values():
            yield from _walk_card_records(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk_card_records(child)


class EdhrecAdapter:
    """Load an explicit EDHREC JSON cache or explicitly supplied public JSON URL.

    No EDHREC endpoint is hard-coded.  A URL must be passed by the caller and
    network access must be explicitly enabled; tests and normal offline usage
    only read ``cache_path``.
    """

    def __init__(self, *, cache_path: Path | None = None, url: str | None = None, allow_network: bool = False):
        if not cache_path and not url:
            raise ValueError("EDHREC adapter needs cache_path or an explicit public JSON url")
        if url and not allow_network:
            raise ValueError("network is disabled; pass allow_network=True for an explicit source URL")
        self.cache_path, self.url, self.allow_network = cache_path, url, allow_network
        self.name = "edhrec-cache" if cache_path else "edhrec-url"

    def _load(self) -> Any:
        if self.cache_path:
            return json.loads(self.cache_path.read_text(encoding="utf-8"))
        request = Request(str(self.url), headers={"Accept": "application/json", "User-Agent": "ProsshTCG-deck-generator/1.0"})
        with urlopen(request, timeout=30) as response:
            return json.load(response)

    def candidates(self, commander: Card, *, constraints: Mapping[str, Any]) -> Iterable[Candidate]:
        payload = self._load()
        for key in ("commander", "commander_name", "commanderName"):
            declared = payload.get(key) if isinstance(payload, Mapping) else None
            if isinstance(declared, Mapping):
                declared = declared.get("name") or declared.get("oracle_id") or declared.get("oracleId")
            if declared and normalize_name(str(declared)) not in (normalize_name(commander.name), commander.oracle_id):
                return []
        result: list[Candidate] = []
        for index, item in enumerate(_walk_card_records(payload), start=1):
            tier_value = item.get("tier") or item.get("power_level") or item.get("powerLevel")
            try:
                tier = int(tier_value) if tier_value is not None else None
            except (TypeError, ValueError):
                tier = None
            rank_value = item.get("rank") or index
            try:
                rank = int(rank_value)
            except (TypeError, ValueError):
                rank = index
            decks = item.get("num_decks") or item.get("numDecks") or item.get("inclusion") or 0
            try:
                score = float(decks)
            except (TypeError, ValueError):
                score = float(max(0, 100000 - rank))
            result.append(Candidate(
                card=item, score=score, rank=rank, tier=tier,
                provenance={"adapter": self.name, "source": str(self.cache_path or self.url), "rank": rank, "num_decks": item.get("num_decks") or item.get("numDecks"), "scope": "explicit EDHREC JSON source"},
            ))
        return result


class CatalogFallbackAdapter:
    """Deterministic last-resort pool from cards already present in the catalog."""

    name = "local-catalog-fallback"

    def __init__(self, catalog: Catalog):
        self.catalog = catalog

    def candidates(self, commander: Card, *, constraints: Mapping[str, Any]) -> Iterable[Candidate]:
        cards = sorted(self.catalog.cards(), key=lambda card: (card.is_land is False, card.printing_rank, card.released_at, card.oracle_id))
        return [Candidate(card=card.normalized(), score=0.0, rank=index, provenance={"adapter": self.name, "source": "local catalog", "fallback": True}) for index, card in enumerate(cards, start=1)]


def classify(card: Card) -> str:
    if card.is_land:
        return "lands"
    text = f"{card.oracle_text} {card.type_line}".casefold()
    if "search your library" in text or "searches your library" in text:
        return "tutors"
    if any(term in text for term in ("draw a card", "draw cards", "draws a card", "look at the top")):
        return "draw"
    if any(term in text for term in ("add {", "add one mana", "treasure token", "search your library for a basic land")):
        return "ramp"
    if any(term in text for term in ("destroy", "exile", "counter target", "return target", "-x/-x")):
        return "removal"
    if any(term in text for term in ("hexproof", "indestructible", "protection from", "can't be countered", "cannot be countered")):
        return "protection"
    if "creature" in card.type_line.casefold() or "planeswalker" in card.type_line.casefold():
        return "threats"
    return "synergy"


def _resolve_candidate(candidate: Candidate, catalog: Catalog) -> Card | None:
    raw = candidate.card
    if isinstance(raw, Card):
        return raw
    return catalog.resolve(
        name=str(raw.get("name") or "") or None,
        oracle_id=str(raw.get("oracle_id") or raw.get("oracleId") or "") or None,
        scryfall_id=str(raw.get("scryfall_id") or raw.get("scryfallId") or raw.get("id") or "") or None,
    )


def _merge_candidates(candidates: Iterable[Candidate], catalog: Catalog) -> tuple[list[tuple[Card, Candidate, list[Mapping[str, Any]]]], list[dict[str, Any]]]:
    merged: OrderedDict[str, tuple[Card, Candidate, list[Mapping[str, Any]]]] = OrderedDict()
    unresolved: list[dict[str, Any]] = []
    for candidate in candidates:
        card = _resolve_candidate(candidate, catalog)
        if card is None:
            unresolved.append({"name": candidate.card.get("name") if isinstance(candidate.card, Mapping) else None, "reason": "not found in local catalog", "provenance": dict(candidate.provenance)})
            continue
        old = merged.get(card.oracle_id)
        provenance = dict(candidate.provenance)
        if candidate.rank is not None:
            provenance["rank"] = candidate.rank
        if candidate.tier is not None:
            provenance["tier"] = candidate.tier
        if old is None:
            merged[card.oracle_id] = (card, candidate, [provenance])
        else:
            old_card, old_candidate, old_provenance = old
            best = candidate if (candidate.score, -(candidate.rank or 10**9)) > (old_candidate.score, -(old_candidate.rank or 10**9)) else old_candidate
            old_provenance.append(provenance)
            merged[card.oracle_id] = (old_card, best, old_provenance)
    return list(merged.values()), unresolved


def _validate_quota(value: Mapping[str, int] | None, land_count: int, slots: int) -> dict[str, int]:
    quotas = dict(DEFAULT_QUOTAS if value is None else value)
    for category, count in quotas.items():
        if category not in KNOWN_CATEGORIES:
            raise ValueError(f"unknown category quota: {category}")
        if int(count) < 0:
            raise ValueError(f"negative category quota: {category}")
        quotas[category] = int(count)
    if "lands" in quotas and quotas["lands"] != land_count:
        raise ValueError("the lands quota must equal land_count")
    if sum(count for key, count in quotas.items() if key != "lands") > slots:
        raise ValueError("category quotas exceed non-land Commander slots")
    return quotas


def generate_deck(
    commander: str,
    *,
    catalog: Catalog,
    sources: Sequence[SourceAdapter] = (),
    tier: int = 3,
    colors: str | Iterable[str] | None = None,
    land_count: int = 36,
    size: int = 100,
    category_quotas: Mapping[str, int] | None = None,
    constraints: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Return an existing-format Commander proposal with validation evidence."""
    if tier not in range(1, 6):
        raise ValueError("tier must be between 1 and 5")
    if size != 100:
        raise ValueError("Commander decks must contain exactly 100 cards including commander")
    if not 0 <= land_count <= 99:
        raise ValueError("land_count must be between 0 and 99")
    requested_colors = parse_colors(colors)
    commander_card = catalog.resolve(oracle_id=commander) or catalog.resolve(name=commander)
    payload: dict[str, Any] = {
        "format": "Commander", "schema_version": 1, "source": "ProsshTCG deterministic deck generator", "status": "proposal", "requested_tier": tier,
        "commanders": [], "commander_oracle_ids": [], "cards": [], "sources": [],
        "unresolved_candidates": [], "warnings": [],
    }
    if commander_card is None:
        payload["warnings"].append("Commander was not resolved; no cards were invented.")
        payload["unresolved_candidates"].append({"name": commander, "reason": "commander not found in local catalog"})
        payload["validation"] = {"format": "Commander", "commander_resolved": False, "deck_size": {"requested": size, "actual": 0, "valid": False}}
        return payload

    command_legal = _legal_commander(commander_card.legalities)
    if command_legal is False:
        payload["warnings"].append("The selected commander is not Commander-legal in the local catalog.")
    if command_legal is None:
        payload["warnings"].append("Commander legality is unavailable in the local catalog; legality is not claimed.")
    if requested_colors is not None and requested_colors != commander_card.color_identity:
        payload["warnings"].append("Requested colors do not equal the commander's color identity; no deck was generated.")
        payload["validation"] = {"format": "Commander", "commander_resolved": True, "commander_legal": command_legal, "deck_size": {"requested": size, "actual": 1, "valid": False}, "color_identity_valid": False}
        payload["commanders"] = [commander_card.name]
        payload["commander_oracle_ids"] = [commander_card.oracle_id]
        payload["cards"] = [commander_card.normalized(category="commander", provenance=({"source": "local catalog", "role": "commander"},))]
        return payload
    allowed_colors = commander_card.color_identity
    constraints = dict(constraints or {})
    quota = _validate_quota(category_quotas, land_count, 99 - land_count)
    payload["commanders"] = [commander_card.name]
    payload["commander_oracle_ids"] = [commander_card.oracle_id]
    payload["sources"] = [{"name": getattr(source, "name", source.__class__.__name__), "kind": source.__class__.__name__} for source in sources]

    all_candidates: list[Candidate] = []
    for source in sources:
        all_candidates.extend(source.candidates(commander_card, constraints=constraints))
    # A tier-labelled source is authoritative for that filter. Unlabelled
    # candidates remain a documented fallback, rather than being misreported
    # as tier-matched.
    labelled = [candidate for candidate in all_candidates if candidate.tier is not None]
    if labelled:
        tier_candidates = [candidate for candidate in all_candidates if candidate.tier == tier or candidate.tier is None]
        if not any(candidate.tier == tier for candidate in tier_candidates):
            payload["warnings"].append(f"No source candidates are labelled tier {tier}; using unlabelled fallback candidates only.")
        all_candidates = tier_candidates
    all_candidates.extend(CatalogFallbackAdapter(catalog).candidates(commander_card, constraints=constraints))
    resolved, unresolved = _merge_candidates(all_candidates, catalog)
    payload["unresolved_candidates"] = unresolved[:100]
    unresolved_count = len(unresolved)

    def report_unresolved(item: dict[str, Any]) -> None:
        nonlocal unresolved_count
        unresolved_count += 1
        if len(payload["unresolved_candidates"]) < 100:
            payload["unresolved_candidates"].append(item)

    def is_reportable_source(provenance: Sequence[Mapping[str, Any]]) -> bool:
        # The catalog fallback intentionally contains many known cards that are
        # later rejected by color/legality filters. They are not unresolved
        # source claims; only supplied-source evidence belongs in this report.
        return any(not bool(item.get("fallback")) for item in provenance)

    eligible: list[tuple[Card, Candidate, list[Mapping[str, Any]], str]] = []
    for card, candidate, provenance in resolved:
        if card.oracle_id == commander_card.oracle_id:
            continue
        legal = _legal_commander(card.legalities)
        if legal is False:
            if is_reportable_source(provenance):
                report_unresolved({"name": card.name, "oracle_id": card.oracle_id, "reason": "not Commander-legal", "provenance": provenance})
            continue
        if legal is None:
            if is_reportable_source(provenance):
                report_unresolved({"name": card.name, "oracle_id": card.oracle_id, "reason": "missing Commander legality", "provenance": provenance})
            continue
        if not card.color_identity.issubset(allowed_colors):
            if is_reportable_source(provenance):
                report_unresolved({"name": card.name, "oracle_id": card.oracle_id, "reason": "outside commander color identity", "provenance": provenance})
            continue
        category = classify(card)
        eligible.append((card, candidate, provenance, category))
    eligible.sort(key=lambda item: (-item[1].score, item[1].rank if item[1].rank is not None else 10**9, item[0].name.casefold(), item[0].oracle_id))

    selected: list[tuple[Card, list[Mapping[str, Any]], str]] = []
    quota_shortfalls: dict[str, int] = {}
    used: set[str] = set()
    # Lands are selected once per oracle ID and basic lands are then expanded
    # to hit the exact requested land count.
    land_pool = [item for item in eligible if item[3] == "lands"]
    for card, candidate, provenance, category in land_pool:
        if len(selected) >= land_count:
            break
        if card.oracle_id in used and not card.is_basic_land:
            continue
        selected.append((card, provenance, category))
        if not card.is_basic_land:
            used.add(card.oracle_id)
    basics = [item for item in eligible if item[0].is_basic_land]
    if len(selected) < land_count and not basics:
        basics = [(card, Candidate(card=card.normalized(), provenance={"adapter": "local-catalog-basic-fallback", "source": "local catalog", "fallback": True}), [{"adapter": "local-catalog-basic-fallback", "source": "local catalog", "fallback": True}], "lands") for card in catalog.cards() if card.is_basic_land and _legal_commander(card.legalities) is True and card.color_identity.issubset(allowed_colors)]
    if basics:
        basic_index = 0
        while len(selected) < land_count:
            card, candidate, provenance, category = basics[basic_index % len(basics)]
            selected.append((card, provenance, category))
            basic_index += 1
    if len(selected) < land_count:
        payload["warnings"].append(f"Could only resolve {len(selected)}/{land_count} requested lands from the local sources.")

    used_nonlands = set(used)
    for category in (key for key in quota if key not in ("lands", "flex")):
        need = quota[category]
        for card, candidate, provenance, actual_category in eligible:
            if need <= 0:
                break
            if actual_category != category or card.is_land or card.oracle_id in used_nonlands:
                continue
            selected.append((card, provenance, category))
            used_nonlands.add(card.oracle_id)
            need -= 1
        if need:
            quota_shortfalls[category] = need
            payload["warnings"].append(f"Category quota {category} is short by {need}; no eligible local candidates were claimed.")
    remaining = 99 - len(selected)
    for card, candidate, provenance, actual_category in eligible:
        if remaining <= 0:
            break
        if card.is_land or card.oracle_id in used_nonlands:
            continue
        selected.append((card, provenance, actual_category if actual_category in KNOWN_CATEGORIES else "flex"))
        used_nonlands.add(card.oracle_id)
        remaining -= 1

    cards = [commander_card.normalized(category="commander", provenance=({"adapter": "local catalog", "source": "local catalog", "role": "commander"},))]
    cards.extend(card.normalized(category=category, provenance=provenance) for card, provenance, category in selected)
    payload["cards"] = cards
    payload["unresolved_candidate_count"] = unresolved_count
    if unresolved_count > len(payload["unresolved_candidates"]):
        payload["warnings"].append(f"{unresolved_count - len(payload['unresolved_candidates'])} additional unresolved candidates were omitted from the report.")
    category_counts = Counter(card.get("category") for card in cards)
    singleton_duplicates = sorted(name for name, count in Counter(card["oracle_id"] for card in cards if not _is_basic_card_entry(card)).items() if count > 1)
    legality_unknown = any(_legal_commander(catalog.resolve(oracle_id=card["oracle_id"]).legalities) is None for card in cards if catalog.resolve(oracle_id=card["oracle_id"]))
    payload["category_counts"] = dict(sorted(category_counts.items()))
    payload["validation"] = {
        "format": "Commander", "commander_resolved": True, "commander_legal": command_legal,
        "deck_size": {"requested": size, "actual": len(cards), "valid": len(cards) == size},
        "land_count": {"requested": land_count, "actual": sum(1 for card in cards if card.get("category") == "lands"), "valid": sum(1 for card in cards if card.get("category") == "lands") == land_count},
        "color_identity_valid": all(set(card.get("color_identity", [])).issubset(allowed_colors) for card in cards),
        "singleton_valid": not singleton_duplicates,
        "duplicate_nonbasic_oracle_ids": singleton_duplicates,
        "category_quotas": {"requested": quota, "shortfalls": quota_shortfalls, "valid": not quota_shortfalls},
        "legality": "unverified" if command_legal is None or legality_unknown else "verified",
        "tier": {"requested": tier, "source_labelled": bool(labelled), "claim": "not a legality or power guarantee"},
    }
    if command_legal is True and len(cards) == 100 and payload["validation"]["land_count"]["valid"] and payload["validation"]["color_identity_valid"] and not singleton_duplicates and not quota_shortfalls:
        payload["status"] = "validated" if payload["validation"]["legality"] == "verified" else "proposal"
    else:
        payload["warnings"].append("The proposal is incomplete or violates a requested constraint; it is not claimed legal.")
    return payload


def _is_basic_card_entry(card: Mapping[str, Any]) -> bool:
    return "basic" in str(card.get("type_line") or "").casefold() and "land" in str(card.get("type_line") or "").casefold()


def _parse_quotas(values: Sequence[str]) -> dict[str, int]:
    result: dict[str, int] = {}
    for value in values:
        if "=" not in value:
            raise ValueError(f"quota must look like category=count: {value}")
        category, count = value.split("=", 1)
        result[category.strip()] = int(count)
    return result


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate a deterministic Commander deck proposal from local catalog/source files.")
    parser.add_argument("--catalog", type=Path, default=Path("data/catalog/prossh.sqlite"))
    parser.add_argument("--commander", help="Commander display name or stable oracle_id")
    parser.add_argument("--commander-oracle-id", help="Alias for --commander when passing an oracle_id")
    parser.add_argument("--tier", type=int, choices=range(1, 6), default=3)
    parser.add_argument("--colors", help="Exact commander color identity, e.g. WBR or C")
    parser.add_argument("--land-count", "--lands", type=int, default=36, dest="land_count")
    parser.add_argument("--size", type=int, default=100)
    parser.add_argument("--source-deck", type=Path, action="append", default=[])
    parser.add_argument("--edhrec-cache", type=Path, action="append", default=[])
    parser.add_argument("--edhrec-url", action="append", default=[], help="Explicit public JSON source; requires --allow-network")
    parser.add_argument("--allow-network", action="store_true")
    parser.add_argument("--deck-id", action="append", default=[])
    parser.add_argument("--exclude-deck-id", action="append", default=[])
    parser.add_argument("--quota", action="append", default=[], help="category=count, repeatable")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    try:
        commander_key = args.commander_oracle_id or args.commander
        if not commander_key:
            raise ValueError("one of --commander or --commander-oracle-id is required")
        if not args.catalog.exists():
            raise ValueError(f"catalog does not exist: {args.catalog}")
        catalog = SQLiteCatalog(args.catalog)
        sources: list[SourceAdapter] = [JsonDeckDatabaseAdapter(path) for path in args.source_deck]
        sources.extend(EdhrecAdapter(cache_path=path) for path in args.edhrec_cache)
        sources.extend(EdhrecAdapter(url=url, allow_network=args.allow_network) for url in args.edhrec_url)
        payload = generate_deck(commander_key, catalog=catalog, sources=sources, tier=args.tier, colors=args.colors, land_count=args.land_count, size=args.size, category_quotas=_parse_quotas(args.quota) if args.quota else None, constraints={"deck_ids": args.deck_id, "exclude_deck_ids": args.exclude_deck_id})
    except (OSError, ValueError, sqlite3.Error, json.JSONDecodeError) as error:
        parser.error(str(error))
    output = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output, encoding="utf-8")
    else:
        sys.stdout.write(output)
    actual = payload.get("validation", {}).get("deck_size", {}).get("actual", 0)
    print(f"Generated {actual}-card Commander proposal ({payload['status']}).", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
