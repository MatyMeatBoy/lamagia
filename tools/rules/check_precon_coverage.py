"""Report engine coverage for a product/set of imported Commander decks.

The report is intentionally name-independent at the deck level but compares
profiles by stable Scryfall ID first. It is a gate for the long-running card
implementation effort: a deck is only complete when every unique card has a
fully implemented profile, not merely because its text was classified.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


FAMILY_PATTERNS: tuple[tuple[str, str], ...] = (
    ("tokens", r"\bcreate\b.*\btoken"),
    ("search", r"\bsearch your library\b"),
    ("combat-damage", r"\bdeal(?:s)?\b.*\bdamage\b|\bdamage\b"),
    ("counters-stats", r"\+1/\+1|counter|gets? [+-]\d"),
    ("zones", r"\b(?:exile|return|put .*graveyard|shuffle)\b"),
    ("draw-discard", r"\b(?:draw|discard)\b"),
    ("removal", r"\b(?:destroy|sacrifice)\b"),
    ("activated", r"^[^:\n]{1,160}:"),
    ("triggered", r"\b(?:when(?:ever)?|at the beginning of)\b"),
)


def load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def pending_family(card: dict[str, Any]) -> str:
    text = str(card.get("oracle_text") or "")
    for family, pattern in FAMILY_PATTERNS:
        if re.search(pattern, text, re.I):
            return family
    return "other"


def report(decks_path: Path, profiles_path: Path, set_code: str) -> str:
    decks = load(decks_path)["decks"]
    profiles = {}
    for entry in load(profiles_path)["profiles"]:
        # The engine exporter deduplicates by oracle_id, while a historical
        # precon retains its original printing scryfall_id. Match both.
        profiles[entry["scryfall_id"]] = entry
        if entry.get("oracle_id"):
            profiles.setdefault(entry["oracle_id"], entry)
    selected = [deck for deck in decks if deck.get("set_code") == set_code]
    lines = [f"# Engine coverage: {set_code}", "", f"Decks: **{len(selected)}**", ""]
    all_cards: dict[str, dict[str, Any]] = {}
    for deck in selected:
        for card in deck["cards"]:
            all_cards.setdefault(card["scryfall_id"], card)
    implemented = 0
    pending_families: dict[str, int] = {}
    for deck in selected:
        ids = {card["scryfall_id"] for card in deck["cards"]}
        done = sum(bool(profiles.get(card_id, profiles.get(next((card.get("oracle_id") for card in deck["cards"] if card["scryfall_id"] == card_id), ""), {})).get("fullyImplemented")) for card_id in ids)
        lines.append(f"- **{deck['name']}**: {done}/{len(ids)} unique cards implemented")
    for card_id, card in sorted(all_cards.items(), key=lambda item: item[1]["name"].casefold()):
        historical = all_cards[card_id]
        profile = profiles.get(card_id, profiles.get(historical.get("oracle_id", ""), {}))
        if profile.get("fullyImplemented"):
            implemented += 1
            continue
        family = pending_family(card)
        pending_families[family] = pending_families.get(family, 0) + 1
        lines.append("") if len(lines) == 3 else None
        lines.append(f"- [ ] {card['name']} — `{card_id}`")
    total = len(all_cards)
    lines[2:2] = [f"Unique cards: **{total}**; implemented: **{implemented}**; pending: **{total - implemented}**", ""]
    summary = ["", "## Pending families", ""]
    summary.extend(f"- **{family}**: {count}" for family, count in sorted(pending_families.items(), key=lambda item: (-item[1], item[0])))
    lines[5:5] = summary
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--decks", type=Path, default=Path("data/decks/commander-precons.json"))
    parser.add_argument("--profiles", type=Path, default=Path("data/rules/engine-card-profiles.json"))
    parser.add_argument("--set-code", default="C13")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(report(args.decks, args.profiles, args.set_code), encoding="utf-8")
    print(f"Coverage report written: {args.output}")


if __name__ == "__main__":
    main()
