#!/usr/bin/env python3
"""Fetch Academy Ruins' structured Comprehensive Rules and render Markdown.

This is a reference snapshot for implementing engine effects. The authoritative
game engine remains local and deterministic; it never calls the network.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from urllib.request import Request, urlopen

API_URL = "https://api.academyruins.com/cr"


def fetch_rules() -> dict[str, dict[str, object]]:
    request = Request(API_URL, headers={"User-Agent": "ProsshTCG rules-reference-sync/1.0"})
    with urlopen(request, timeout=30) as response:
        payload = json.load(response)
    if not isinstance(payload, dict):
        raise ValueError("Academy Ruins returned an unexpected rules payload")
    return payload


def render_markdown(rules: dict[str, dict[str, object]]) -> str:
    lines = [
        "# Magic: The Gathering Comprehensive Rules (local reference)",
        "",
        "> Generated from the structured [Academy Ruins API](https://api.academyruins.com/cr).",
        "> This file is a development reference, not a replacement for the official",
        "> Wizards rules document. The engine does not perform network I/O.",
        "",
        "## Rule lookup",
        "",
        "- Structured source: https://api.academyruins.com/cr/{rule_id}",
        "- Keywords: https://api.academyruins.com/cr/keywords",
        "- Glossary: https://api.academyruins.com/cr/glossary",
        "- Official rules landing page: https://magic.wizards.com/en/rules",
        "",
    ]
    def rule_key(value: str) -> tuple[tuple[int, object], ...]:
        return tuple((0, int(part)) if part.isdigit() else (1, part) for part in value.split("."))

    for rule_id in sorted(rules, key=rule_key):
        rule = rules[rule_id]
        text = str(rule.get("ruleText", "")).replace("\n", " ").strip()
        if not text:
            continue
        lines.extend([f"### {rule_id}", "", text, ""])
        examples = rule.get("examples")
        if examples:
            lines.extend(["Examples:", "", f"{examples}", ""])
    return "\n".join(lines).rstrip() + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("docs/COMPREHENSIVE_RULES.md"))
    args = parser.parse_args()
    rules = fetch_rules()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(render_markdown(rules), encoding="utf-8")
    print(f"Wrote {len(rules):,} rules to {args.output}")


if __name__ == "__main__":
    main()
