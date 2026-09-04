"""Build a code-grounded dictionary of reusable card-text primitives.

The dictionary is deliberately an index, not a second rules engine.  It links
common Oracle words to the parser fields and engine handlers already present in
the repository, then appends a mass-produced C13 queue for cards whose export
has exactly one unmatched line.  This keeps contributors from reimplementing
the same verb with a card-name regex.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

try:
    from plan_primitive_roadmap import template_of
except ModuleNotFoundError:  # Direct import from the repository root in tests/tools.
    from tools.rules.plan_primitive_roadmap import template_of


WORD_GROUPS: tuple[dict[str, Any], ...] = (
    {
        "word": "sacrifice",
        "meaning": "Move a permanent from the battlefield to its controller's graveyard as a cost or effect.",
        "parser": ["sacrificesSelf", "sacrificesCreature", "sacrificesCreatures", "sacrificesCreatureSubtype", "sacrificesPermanent", "sacrificesArtifact", "sacrificesLand"],
        "helpers": ["matchesSacrificeCreatureCost", "matchesSacrificeType", "combinations", "activatableAbility", "applyActivate"],
        "effects": ["sacrifice-source", "each-opponent-sacrifice-creature", "sacrifice-own-creature-then-draw", "target-player-sacrifice-attacking-creature"],
        "patterns": ["Sacrifice ~", "Sacrifice a/an creature or permanent", "Sacrifice N creatures", "Each opponent sacrifices...", "Sacrifice as an additional cost"],
        "notes": "Keep cost and effect separate. A typed cost filters candidates; an effect resolves through the stack. N-creature costs require distinct candidates and atomic validation.",
    },
    {
        "word": "search / library",
        "meaning": "Inspect a library and optionally move matching cards to a destination, then shuffle when the effect requires it.",
        "parser": ["cyclingSearches", "search-library", "search-library-multi"],
        "helpers": ["legalTargets", "applyChooseLibraryCard", "applyChooseMultiLibraryCard", "applyFinishLibrarySearch", "shuffle"],
        "effects": ["search-library", "search-library-basic-land", "search-library-land-types", "search-library-creature"],
        "patterns": ["Search your library for a card", "Search your library for a basic land", "Landcycling", "Fetch-land activation"],
        "notes": "Preserve type, subtype, color and destination criteria. Never expose another player's library in a projection.",
    },
    {
        "word": "exile",
        "meaning": "Move a card or permanent to the exile zone, with the source zone and return permission kept explicit.",
        "parser": ["exilesGraveyardCard", "exileSourceAfterResolution", "returnExiledAtNextEndStep"],
        "helpers": ["movePermanentToZone", "applyEffect", "pendingChoice"],
        "effects": ["exile-target-permanent", "exile-all-attacking-creatures", "exile-source", "exile-graveyard-card"],
        "patterns": ["Exile target...", "Exile a card from your graveyard", "Exile another permanent then return it", "Exile source after resolution"],
        "notes": "Exile is a zone change, not merely a flag. Track owner/controller and delayed return conditions separately.",
    },
    {
        "word": "return / graveyard",
        "meaning": "Move a card from a graveyard or exile to a specified destination with type and controller restrictions.",
        "parser": ["return-to-hand", "return-to-battlefield", "returnExiledAtNextEndStep"],
        "helpers": ["moveCardToZone", "movePermanentToZone", "legalTargets"],
        "effects": ["return-card-to-hand", "return-creature-card-to-battlefield", "return-target-permanent"],
        "patterns": ["Return target card from your graveyard", "Return that card to the battlefield", "Return to its owner's hand"],
        "notes": "The destination, owner/controller, target zone and timing are independent operands; do not collapse them into a generic return.",
    },
    {
        "word": "draw / discard",
        "meaning": "Change hand contents while preserving the acting player and event metadata.",
        "parser": ["discardsCard", "draw", "draw-if-life-more-than-opponent"],
        "helpers": ["drawCards", "raiseEvent", "applyEffect"],
        "effects": ["draw", "draw-active-player", "draw-if-life-more-than-opponent", "discard-card", "discard-random"],
        "patterns": ["Draw N cards", "That player draws", "Discard a card as a cost", "Discard at random"],
        "notes": "'Discard' can be a cost or an effect. Keep the selected card ID in the intent and resolve the discard on the server.",
    },
    {
        "word": "counter",
        "meaning": "Add, remove or inspect public counters, including counters used as costs.",
        "parser": ["removeCounters", "entersWithCounters", "counterModification"],
        "helpers": ["withPlayer", "applyEffect", "stateBasedActions"],
        "effects": ["add-counter-source", "remove-counter-from-source", "proliferate", "destroy-countered-permanent"],
        "patterns": ["Put a +1/+1 counter", "Remove a counter from ~", "Proliferate", "Enters with counters"],
        "notes": "Normalize counter names, validate availability before payment, and keep counter changes separate from P/T layer calculation.",
    },
    {
        "word": "damage / life",
        "meaning": "Apply damage or life changes and raise the corresponding events for replacement and triggered abilities.",
        "parser": ["preventsLifeGain", "additionalLifeCost", "damage-prevention"],
        "helpers": ["dealDamage", "gainLife", "loseLife", "raiseEvent"],
        "effects": ["damage-any-target", "damage-event-player", "gain-life", "gain-life-equal-target-power", "lose-life", "lose-life-event-player"],
        "patterns": ["Deal N damage", "Gain N life", "Lose N life", "Gain life equal to power", "That player loses life"],
        "notes": "Resolve the event's player separately from the ability controller; this matters for 'that player' wording.",
    },
    {
        "word": "create / token",
        "meaning": "Create a token with explicit name, colors, types, stats and keywords.",
        "parser": ["create-token", "token"],
        "helpers": ["createToken", "applyEffect", "stateBasedActions"],
        "effects": ["create-token", "create-token-per-creature", "create-token-per-land"],
        "patterns": ["Create a N/N token", "Create tokens equal to...", "Token enters with..."],
        "notes": "Tokens need stable instance IDs and visible names in the client; their rules identity is their generated characteristics, not a card name lookup.",
    },
    {
        "word": "trigger / ETB",
        "meaning": "Queue a triggered ability from an event, then choose targets and optional choices at the correct time.",
        "parser": ["triggers", "targetKind", "optional", "condition"],
        "helpers": ["raiseEvent", "putNextTriggerOnStack", "openMultiTriggerTargetChoice", "applyFinishTriggerTargets"],
        "effects": ["compound", "modify-source-creature", "gain-life-equal-target-power", "destroy-target-permanent"],
        "patterns": ["When ~ enters", "Whenever a creature dies", "At the beginning of your end step", "You may..."],
        "notes": "ETB is not an automatic side effect. It is an event, an APNAP-ordered trigger, a target choice and a stack object.",
    },
    {
        "word": "activated ability / mana",
        "meaning": "Pay a structured cost, announce targets and put a non-mana ability on the stack; mana abilities resolve immediately.",
        "parser": ["manaAbilities", "activatedAbilities", "manaCost", "requiresTap", "lifeCost"],
        "helpers": ["activatableAbility", "legalActions", "applyActivate", "applyActivateMana", "planManaPayment"],
        "effects": ["attach-equipment", "untap-source", "modify-source-creature", "search-library"],
        "patterns": ["{cost}: effect", "{T}: Add mana", "Pay life: effect", "Sacrifice a...: effect"],
        "notes": "Use the same legality function for offered actions and forged intents. A cost is paid before the ability resolves and cannot leak hidden choices.",
    },
)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8") if path.exists() else ""


def symbols(text: str, pattern: str) -> set[str]:
    return set(re.findall(pattern, text))


def code_snapshot(characteristics: str, engine: str) -> dict[str, set[str]]:
    return {
        "fields": symbols(characteristics, r"readonly\s+([A-Za-z][A-Za-z0-9]*)[?:]"),
        "effects": symbols(characteristics, r"kind:\s*\"([^\"]+)\"") | symbols(engine, r"case\s*\"([^\"]+)\""),
        "helpers": symbols(characteristics, r"function\s+([A-Za-z][A-Za-z0-9_]*)(?:<[^>]+>)?\s*\(") | symbols(engine, r"function\s+([A-Za-z][A-Za-z0-9_]*)(?:<[^>]+>)?\s*\("),
    }


def set_identities(path: Path, set_code: str) -> set[str]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    identities: set[str] = set()
    for deck in payload.get("decks", []):
        if str(deck.get("set_code", "")).casefold() != set_code.casefold():
            continue
        identities.update(str(card.get("oracle_id") or card.get("scryfall_id")) for card in deck.get("cards", []) if card.get("oracle_id") or card.get("scryfall_id"))
    return identities


def select_profiles(profiles: list[dict[str, Any]], identities: set[str] | None) -> list[dict[str, Any]]:
    if identities is None:
        return profiles
    return [profile for profile in profiles if str(profile.get("oracle_id") or profile.get("scryfall_id")) in identities]


def roadmap_claims(path: Path | None) -> dict[str, str]:
    if path is None or not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    return {str(entry.get("template", "")): str(entry.get("claim_key", "")) for entry in payload.get("roadmap", [])}


def render_one_line_queue(profiles: list[dict[str, Any]], claims: dict[str, str], scope: str) -> list[str]:
    one_line = [profile for profile in profiles if not profile.get("fullyImplemented") and len(profile.get("unimplementedText") or []) == 1]
    grouped: dict[tuple[str, str], list[str]] = defaultdict(list)
    for profile in one_line:
        line = str(profile["unimplementedText"][0])
        template = template_of(line)
        claim = claims.get(template, "unclaimed")
        grouped[(template, claim)].append(str(profile.get("name", "(unnamed)")))
    lines = [
        f"## Mass review: {scope} one-line queue",
        "",
        f"The engine export currently marks **{len([p for p in profiles if p.get('fullyImplemented')])}/{len(profiles)}** profiles complete; **{len(one_line)}** unfinished cards have exactly one unmatched line.",
        "These are generated candidates, not automatic approvals: claim the suggested cluster, inspect the exact Oracle text, add a scenario, then regenerate the export.",
        "",
        "| Suggested claim | Cards | Remaining line template |",
        "| --- | ---: | --- |",
    ]
    for (template, claim), names in sorted(grouped.items(), key=lambda item: (item[0][1], item[0][0])):
        suggested = f"{scope.casefold()}-{claim}" if claim != "unclaimed" and not claim.startswith(f"{scope.casefold()}-") else claim
        safe_template = template.replace("|", "\\|")
        lines.append(f"| `{suggested}` | {len(names)} | {safe_template} — {', '.join(sorted(names))} |")
    if not one_line:
        lines.append("| — | 0 | No one-line candidates in this scope. |")
    lines.extend(["", "The highest-value fix is the shared template, not the first card name. A new primitive should parameterize type, zone, target, quantity and optionality so reprints and other sets inherit it.", ""])
    return lines


def render_markdown(
    snapshot: dict[str, set[str]],
    profiles: list[dict[str, Any]],
    claims: dict[str, str],
    scope: str,
    *,
    include_one_line: bool = False,
) -> str:
    lines = [
        "# Primitive dictionary",
        "",
        "Generated from the current `packages/rules` parser/engine. This is a contributor index: it links common Oracle words to reusable code surfaces and does not replace the authoritative rules engine.",
        "",
        f"- Generated: `{datetime.now(UTC).isoformat()}`",
        f"- Scope: **{scope}**",
        f"- Exported profiles in scope: **{len(profiles)}**; fully implemented: **{sum(1 for p in profiles if p.get('fullyImplemented'))}**",
        "- Source of truth: `packages/rules/src/characteristics.ts`, `packages/rules/src/engine.ts`, and the engine export.",
        "",
        "## Workflow",
        "",
        "1. Search this dictionary by the common verb before adding a regex or card-name branch.",
        "2. Reuse an existing field/handler and add structured operands for the new type, zone, target, quantity or choice.",
        "3. Add a scenario test with the applicable Comprehensive Rules citation.",
        "4. Regenerate the engine export and take the next unclaimed generated cluster.",
        "",
        "## Code-grounded support",
        "",
    ]
    for group in WORD_GROUPS:
        lines += [f"### {group['word']}", "", group["meaning"], "", "**Parser / IR fields**"]
        lines += [f"- {'✅' if field in snapshot['fields'] else '⚠️'} `{field}`" for field in group["parser"]]
        lines.append("**Reusable engine helpers**")
        lines += [f"- {'✅' if helper in snapshot['helpers'] else '⚠️'} `{helper}`" for helper in group["helpers"]]
        existing_effects = [effect for effect in group["effects"] if effect in snapshot["effects"]]
        lines.append("**Existing effect handlers**")
        lines += [f"- ✅ `{effect}`" for effect in existing_effects] or ["- ⚠️ No exact handler name found; treat as a review item."]
        lines.append("**Wording families**")
        lines += [f"- {pattern}" for pattern in group["patterns"]]
        lines += [f"**Rule-engine note:** {group['notes']}", ""]
    if include_one_line:
        lines += render_one_line_queue(profiles, claims, scope)
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profiles", default="data/rules/engine-card-profiles.json")
    parser.add_argument("--characteristics", default="packages/rules/src/characteristics.ts")
    parser.add_argument("--engine", default="packages/rules/src/engine.ts")
    parser.add_argument("--decks")
    parser.add_argument("--set-code", default="")
    parser.add_argument("--roadmap")
    parser.add_argument("--include-one-line", action="store_true", help="Append the mass one-line queue; intended for a bounded set scope.")
    parser.add_argument("--output", default="docs/PRIMITIVE_DICTIONARY.md")
    args = parser.parse_args()

    payload = json.loads(Path(args.profiles).read_text(encoding="utf-8"))
    profiles = list(payload.get("profiles", []))
    if args.set_code:
        if not args.decks:
            raise SystemExit("--decks is required with --set-code")
        profiles = select_profiles(profiles, set_identities(Path(args.decks), args.set_code))
    scope = args.set_code.upper() or "catalog"
    snapshot = code_snapshot(read_text(Path(args.characteristics)), read_text(Path(args.engine)))
    markdown = render_markdown(
        snapshot,
        profiles,
        roadmap_claims(Path(args.roadmap) if args.roadmap else None),
        scope,
        include_one_line=args.include_one_line or bool(args.set_code),
    )
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(markdown + "\n", encoding="utf-8")
    print(f"Primitive dictionary written: {output} ({len(profiles)} profiles; {sum(1 for p in profiles if p.get('fullyImplemented'))} complete)")


if __name__ == "__main__":
    main()
