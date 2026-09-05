"""Find cards whose engine profile has exactly one unresolved Oracle line.

This is a triage/reuse index, not a rules engine.  It deliberately points a
worker at an existing primitive family before suggesting a new one, while
keeping the raw Oracle line and stable IDs as the source of truth.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterable

try:
    from build_primitive_dictionary import WORD_GROUPS, code_snapshot
    from plan_primitive_roadmap import family_of, semantic_template_of
except ModuleNotFoundError:
    from tools.rules.build_primitive_dictionary import WORD_GROUPS, code_snapshot
    from tools.rules.plan_primitive_roadmap import family_of, semantic_template_of


FORMAT = "prossh-near-complete-cards/v1"


def select_profiles(profiles: Iterable[dict[str, Any]], identities: set[str] | None) -> list[dict[str, Any]]:
    rows = list(profiles)
    if identities is None:
        return rows
    return [
        row for row in rows
        if {str(row.get("oracle_id") or ""), str(row.get("scryfall_id") or "")} & identities
    ]


def deck_identities(path: Path, set_code: str) -> set[str]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    identities: set[str] = set()
    for deck in payload.get("decks", []):
        if str(deck.get("set_code", "")).casefold() != set_code.casefold():
            continue
        identities.update(
            str(card.get("oracle_id") or card.get("scryfall_id"))
            for card in deck.get("cards", [])
            if card.get("oracle_id") or card.get("scryfall_id")
        )
    return identities


def _word_tokens(text: str) -> set[str]:
    return set(re.findall(r"[a-z][a-z'-]+", text.casefold()))


def _group_match(line: str, group: dict[str, Any]) -> bool:
    text = line.casefold()
    word = str(group["word"]).casefold()
    # Prefer the actual operation words over broad template matching.  This is
    # only a navigation hint; exact operands stay in the unresolved line.
    if any(token in text for token in word.replace("/", " ").split()):
        return True
    hints = {
        "search / library": ("library", "search", "landcycling"),
        "return / graveyard": ("return", "graveyard"),
        "draw / discard": ("draw", "discard"),
        "damage / life": ("damage", "life"),
        "create / token": ("token", "create"),
        "trigger / ETB": ("enters", "whenever", "beginning"),
        "activated ability / mana": ("{t}:", "{q}:", "add "),
        "static / continuous": ("base power", "base toughness", "lose all abilities", "gains ", "has indestructible", "enchanted "),
    }
    return any(token in text for token in hints.get(group["word"], ()))


def reuse_hints(line: str, snapshot: dict[str, set[str]]) -> list[dict[str, Any]]:
    matches: list[dict[str, Any]] = []
    for group in WORD_GROUPS:
        if not _group_match(line, group):
            continue
        fields = sorted(set(group["parser"]) & snapshot["fields"])
        effects = sorted(set(group["effects"]) & snapshot["effects"])
        helpers = sorted(set(group["helpers"]) & snapshot["helpers"])
        score = len(effects) * 3 + len(fields) * 2 + len(helpers)
        matches.append(
            {
                "primitive": group["word"],
                "score": score,
                "existing_fields": fields,
                "existing_effects": effects,
                "existing_helpers": helpers,
                "action": "extend-existing-primitive" if score else "review-new-primitive",
            }
        )
    return sorted(matches, key=lambda item: (-item["score"], item["primitive"]))


def build_index(
    profiles: Iterable[dict[str, Any]],
    *,
    snapshot: dict[str, set[str]],
    top_per_template: int = 0,
) -> dict[str, Any]:
    cards: list[dict[str, Any]] = []
    for profile in profiles:
        if profile.get("fullyImplemented"):
            continue
        lines = [str(line).strip() for line in (profile.get("unimplementedText") or []) if str(line).strip()]
        if len(lines) != 1:
            continue
        line = lines[0]
        hints = reuse_hints(line, snapshot)
        template = semantic_template_of(line)
        family = family_of(template)
        if hints and hints[0]["primitive"] == "static / continuous":
            family = "static-continuous"
        cards.append(
            {
                "name": profile.get("name"),
                "oracle_id": profile.get("oracle_id"),
                "scryfall_id": profile.get("scryfall_id"),
                "types": profile.get("types", []),
                "oracle_text": profile.get("oracle_text", ""),
                "missing_line": line,
                "template": template,
                "family": family,
                "reusable_primitives": hints,
                "priority": "reuse-existing" if hints and hints[0]["score"] else "needs-new-primitive",
            }
        )

    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for card in cards:
        grouped[card["template"]].append(card)
    for values in grouped.values():
        values.sort(key=lambda card: (str(card.get("name") or "").casefold(), str(card.get("oracle_id") or "")))
    if top_per_template:
        # Keep the complete card list, but expose a bounded review queue for
        # workers so a huge catalog does not flood every prompt.
        review_cards = [card for template in sorted(grouped) for card in grouped[template][:top_per_template]]
    else:
        review_cards = cards
    reuse_count = sum(1 for card in cards if card["priority"] == "reuse-existing")
    return {
        "format": FORMAT,
        "generated_at": datetime.now(UTC).isoformat(),
        "card_count": len(cards),
        "reusable_count": reuse_count,
        "new_primitive_count": len(cards) - reuse_count,
        "template_count": len(grouped),
        "family_counts": dict(Counter(card["family"] for card in cards).most_common()),
        "cards": cards,
        "review_queue": review_cards,
    }


def render_markdown(payload: dict[str, Any], scope: str, *, max_cards: int = 500) -> str:
    cards = payload["cards"]
    shown = cards[:max_cards] if max_cards > 0 else cards
    lines = [
        "# Near-complete card queue",
        "",
        "Generated by `tools/rules/identify_near_complete_cards.py`. This is a triage index, not an approval list.",
        "The engine profile is authoritative: a card belongs here only when exactly one Oracle line remains unmatched.",
        "Before editing, claim the shared template, reuse the listed fields/handlers, add a scenario with the Comprehensive Rules citation, and regenerate the export.",
        "",
        f"- Scope: **{scope}**",
        f"- One-line cards: **{payload['card_count']:,}**",
        f"- Cards with a reusable existing primitive hint: **{payload['reusable_count']:,}**",
        f"- Cards needing new primitive review: **{payload['new_primitive_count']:,}**",
        f"- Templates: **{payload['template_count']:,}**",
        "",
        "## Worker rule",
        "",
        "Fix the shared primitive, not the first card name. Preserve type, zone, target, quantity, cost, and optionality as structured operands. Do not report a card complete until the next engine export says `fullyImplemented: true`.",
        "",
        f"## Queue (first {len(shown)} cards; full machine-readable list is generated JSON)",
        "",
        "| Priority | Card | Oracle ID | Family | Reuse hint | Missing line |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for card in shown:
        hints = card.get("reusable_primitives") or []
        hint = hints[0]["primitive"] if hints else "new primitive review"
        line = str(card["missing_line"]).replace("|", "\\|").replace("\n", " ")
        lines.append(
            f"| {card['priority']} | {card.get('name', '?')} | `{card.get('oracle_id', '?')}` | {card['family']} | {hint} | {line} |"
        )
    if len(shown) < len(cards):
        lines += ["", f"The JSON contains the remaining {len(cards) - len(shown):,} cards. Regenerate with `--markdown-max-cards 0` for a full Markdown listing."]
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profiles", type=Path, default=Path("data/rules/engine-card-profiles.json"))
    parser.add_argument("--characteristics", type=Path, default=Path("packages/rules/src/characteristics.ts"))
    parser.add_argument("--engine", type=Path, default=Path("packages/rules/src/engine.ts"))
    parser.add_argument("--decks", type=Path, default=None)
    parser.add_argument("--set-code", default=None)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--markdown-output", type=Path, default=None)
    parser.add_argument("--markdown-max-cards", type=int, default=500)
    parser.add_argument("--top-per-template", type=int, default=0)
    args = parser.parse_args()

    payload = json.loads(args.profiles.read_text(encoding="utf-8"))
    identities = None
    if args.set_code:
        if not args.decks:
            raise SystemExit("--decks is required with --set-code")
        identities = deck_identities(args.decks, args.set_code)
    profiles = select_profiles(payload.get("profiles", []), identities)
    snapshot = code_snapshot(args.characteristics.read_text(encoding="utf-8"), args.engine.read_text(encoding="utf-8"))
    result = build_index(profiles, snapshot=snapshot, top_per_template=args.top_per_template)
    result.update({"source": str(args.profiles), "scope": args.set_code or "catalog"})
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.markdown_output:
        args.markdown_output.parent.mkdir(parents=True, exist_ok=True)
        args.markdown_output.write_text(render_markdown(result, args.set_code or "catalog", max_cards=args.markdown_max_cards), encoding="utf-8")
    print(f"Near-complete queue: {result['card_count']} cards; {result['reusable_count']} reusable -> {args.output}")


if __name__ == "__main__":
    main()
