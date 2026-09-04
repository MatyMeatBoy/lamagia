"""Audit Comprehensive Rules keyword headings against the reusable engine.

This is deliberately a report generator, not a rules interpreter. Scryfall's
keyword field is compared with the closed set of keyword mechanics the engine
currently exposes; printed wording still needs scenario tests before a row is
marked implemented.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
from collections import Counter
from pathlib import Path


# Keep this list conservative: a keyword is implemented only when the engine
# has a reusable model for its rules, not merely because it appears in text.
IMPLEMENTED = {
    "deathtouch": "combat damage / lethal assignment",
    "defender": "attack legality",
    "double strike": "first- and double-strike combat steps",
    "equip": "activated equipment attachment",
    "first strike": "first- and double-strike combat steps",
    "flash": "instant-speed casting",
    "flying": "evasion and blocking",
    "haste": "summoning-sickness exemption",
    "hexproof": "target legality",
    "indestructible": "destruction replacement",
    "landwalk": "combat evasion by land subtype",
    "lifelink": "combat damage life gain",
    "menace": "blocking restriction",
    "reach": "flying blocking",
    "shroud": "target legality",
    "trample": "combat damage assignment",
    "vigilance": "attack does not tap",
    "cycling": "cycling action and optional search variants",
    "kicker": "alternative/additional cast cost",
    "evoke": "alternative cast cost and sacrifice trigger",
    "extort": "optional spell-cast drain trigger",
    "level up": "activated level counters and level layers",
}

PARTIAL = {
    "protection": "not yet a complete source/quality prevention layer",
    "ward": "not yet a complete payment/counter layer",
}

ALIASES = {
    "cycling": {"cycling", "landcycling", "typecycling", "basic landcycling"},
    "kicker": {"kicker", "multikicker"},
}


def norm(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().casefold())


def keyword_headings(path: Path) -> list[tuple[int, str]]:
    lines = path.read_text(encoding="utf-8").splitlines()
    headings: list[tuple[int, str]] = []
    for index, line in enumerate(lines):
        match = re.fullmatch(r"### 702\.(\d+)", line.strip())
        if not match:
            continue
        if int(match.group(1)) == 1:
            continue
        title = next((candidate.strip() for candidate in lines[index + 1 :] if candidate.strip()), "")
        if title and not title.startswith("#"):
            headings.append((int(match.group(1)), title))
    return headings


def catalog_keyword_counts(path: Path) -> Counter[str]:
    counts: Counter[str] = Counter()
    with sqlite3.connect(path) as database:
        for (raw,) in database.execute("SELECT keywords_json FROM cards WHERE keywords_json IS NOT NULL"):
            for keyword in json.loads(raw or "[]"):
                counts[norm(keyword)] += 1
    return counts


def occurrences(counts: Counter[str], name: str) -> int:
    aliases = ALIASES.get(norm(name), {norm(name)})
    return sum(counts[alias] for alias in aliases)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, default=Path("data/catalog/prossh.sqlite"))
    parser.add_argument("--rules", type=Path, default=Path("docs/COMPREHENSIVE_RULES.md"))
    parser.add_argument("--output", type=Path, default=Path("KEYWORD_COVERAGE.md"))
    args = parser.parse_args()

    counts = catalog_keyword_counts(args.catalog)
    rows: list[str] = []
    implemented = partial = backlog = 0
    for number, title in keyword_headings(args.rules):
        key = norm(title)
        if key in IMPLEMENTED:
            status = "implemented"
            detail = IMPLEMENTED[key]
            implemented += 1
        elif key in PARTIAL:
            status = "partial"
            detail = PARTIAL[key]
            partial += 1
        else:
            status = "backlog"
            detail = "Needs a dedicated rules primitive and scenario tests"
            backlog += 1
        rows.append(f"| 702.{number} | {title} | {status} | {occurrences(counts, title)} | {detail} |")

    args.output.write_text(
        "# Keyword coverage\n\n"
        "Generated from the local Comprehensive Rules snapshot and the normalized "
        "catalog. The report distinguishes keyword abilities from keyword actions "
        "and ability words; a high catalog count is a prioritization signal, not "
        "proof that all variants share one implementation.\n\n"
        f"**Summary:** {implemented} implemented · {partial} partial · {backlog} backlog\n\n"
        "`catalog occurrences` counts Scryfall keyword metadata and is used to "
        "prioritize reusable primitives. Every implementation still requires a "
        "scenario test and a Comprehensive Rules citation.\n\n"
        "Source: [Keyword ability](https://mtg.fandom.com/wiki/Keyword_ability) "
        "and the checked-in [Comprehensive Rules](docs/COMPREHENSIVE_RULES.md).\n\n"
        "| CR | Keyword | Status | Catalog occurrences | Engine contract |\n"
        "|---|---|---|---:|---|\n"
        + "\n".join(rows)
        + "\n",
        encoding="utf-8",
    )
    print(f"Keyword report written: {len(rows)} headings -> {args.output}")
    print(f"Summary: implemented={implemented}, partial={partial}, backlog={backlog}")


if __name__ == "__main__":
    main()
