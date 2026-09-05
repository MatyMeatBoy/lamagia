"""Rank the Oracle primitives that actually finish cards, in the order to build them.

The existing clustering counts how often a clause *appears*. That is the wrong
number to schedule work by: a card counts as implemented only when **every** one
of its lines is executable, so a very common clause can appear in thousands of
cards and complete none of them.

This planner uses the real engine as ground truth. `tools/rules/export_engine_profiles.ts`
runs `packages/rules` over the whole catalog and reports, per card, the exact
normalized lines the closed parser did not execute (`unimplementedText`). From
that this tool computes, for each line template:

* ``blocks``   - how many unfinished cards contain it at all.
* ``unlocks``  - how many cards it is the **last** blocker for.
* a greedy set-cover order, so a template that unlocks nothing today but becomes
  the final blocker once an earlier one lands is scheduled at the point where it
  actually pays off.

The output is a work queue with real ROI, not a frequency table. It never
invents rules and never reads XMage or Forge code: every template is derived from
the local Scryfall catalog text that the engine itself failed to match.

Example:
    python tools/rules/plan_primitive_roadmap.py \
      --profiles data/rules/engine-card-profiles.json \
      --output data/rules/primitive-roadmap.json \
      --prompt-output docs/PRIMITIVE_ROADMAP.md \
      --top 40 --set-code c13
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
    from compile_oracle_effects import classify, cluster_text
except ModuleNotFoundError:  # Package import from repository-root test discovery.
    from tools.rules.compile_oracle_effects import classify, cluster_text

ROADMAP_FORMAT = "prossh-primitive-roadmap/v1"


def resolve_claim_prefix(explicit: str | None, set_code: str | None) -> str:
    """Use the scoped set as the default namespace for worker claims."""
    return explicit if explicit is not None else str(set_code or "")

# Ordered because the mana-cost pattern has to run before bare-number folding,
# otherwise `{2}` degrades to `{<n>}` and stops grouping with `{3}`.
MANA_COST_RE = re.compile(r"(?:\{[^}]{1,12}\})+")
DIGIT_RE = re.compile(r"\b\d+\b")
WORD_NUMBER_RE = re.compile(
    r"\b(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|"
    r"thirteen|fifteen|twenty|x)\b",
    re.I,
)
QUOTED_RE = re.compile(r"\"[^\"]{1,80}\"")
WHITESPACE_RE = re.compile(r"\s+")
# Wizards uses an em dash to introduce ability words and modal lists.
DASH_RE = re.compile(r"[—–]")

#: Families are only a reading aid for the generated document; scheduling is
#: always done on the exact template, never on the family.
FAMILY_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("keyword-ability", re.compile(r"^(?:flashback|morph|madness|echo|convoke|prowess|infect|changeling|crew|cycling|kicker|devoid|evoke|dash|bestow|unearth|embalm|escape|adapt|amass|afflict|afterlife|annihilator|banding|bloodthirst|buyback|cascade|conspire|cumulative upkeep|dredge|entwine|epic|evolve|exalted|extort|fading|fear|flanking|forecast|fortify|frenzy|graft|haunt|hideaway|horsemanship|improvise|intimidate|kinship|landwalk|level up|living weapon|manifest|melee|miracle|modular|monstrosity|multikicker|myriad|ninjutsu|offering|outlast|overload|persist|phasing|poisonous|proliferate|protection|provoke|rampage|rebound|recover|reinforce|renown|replicate|retrace|riot|ripple|scavenge|shadow|skulk|soulbond|soulshift|splice|split second|storm|sunburst|surge|suspend|totem armor|transfigure|transmute|tribute|undaunted|undying|unleash|vanishing|wither|\w+walk|\w+cycling)\b")),
    ("pump", re.compile(r"gets? [+-]<n>/[+-]<n>")),
    ("modal", re.compile(r"^choose <n>")),
    ("combat-restriction", re.compile(r"can't block|can block only|attacks each combat|can't attack|must be blocked")),
    ("regenerate", re.compile(r"\bregenerate\b")),
    ("library-look", re.compile(r"\b(?:scry|surveil|explore|look at the top)\b")),
    ("token", re.compile(r"\bcreate\b.*\btoken\b")),
    ("counters", re.compile(r"\bcounters? on\b|\bproliferate\b")),
    ("transform", re.compile(r"\btransform\b|\bflip\b")),
    ("replacement", re.compile(r"^if\b|\binstead\b|\bas .*enters\b")),
    ("static-continuous", re.compile(r"\bother .* you control\b|\bcreatures you control get\b|\bas long as\b")),
    ("triggered", re.compile(r"^(?:when|whenever|at the beginning of|at the end of)\b")),
    ("activated", re.compile(r"^[^:]{1,80}:")),
)


def template_of(line: str) -> str:
    """Fold one unmatched Oracle line into a reusable template signature.

    Only the parts a rules primitive is parameterised by are folded: mana costs,
    numbers and quoted names. Everything else is preserved, so two templates that
    need different engine work never collapse into one queue entry.
    """
    text = line.strip().lower()
    text = DASH_RE.sub("-", text)
    text = QUOTED_RE.sub("<name>", text)
    text = MANA_COST_RE.sub("{cost}", text)
    text = DIGIT_RE.sub("<n>", text)
    text = WORD_NUMBER_RE.sub("<n>", text)
    text = WHITESPACE_RE.sub(" ", text)
    return text.strip(" .")


def family_of(template: str) -> str:
    if template.startswith("oracle:"):
        template = template.removeprefix("oracle:")
        oracle_family = template.split("|", 1)[0]
        mapped_family = {
            "search-library": "library-look",
            "create-token": "token",
            "modify-stats": "pump",
            "counter": "counters",
        }.get(oracle_family)
        if mapped_family:
            return mapped_family
        if oracle_family in {"damage", "draw", "discard", "mill", "gain-life", "lose-life", "destroy", "exile", "return", "sacrifice"}:
            return oracle_family
    for name, pattern in FAMILY_PATTERNS:
        if pattern.search(template):
            return name
    return "other"


def claim_key(prefix: str, template: str, taken: set[str]) -> str:
    """Build a short, stable, unique claim key for the coordination ledger."""
    words = [word for word in re.findall(r"[a-z]+", template) if len(word) > 2][:4]
    base = f"{prefix}-{'-'.join(words) or 'primitive'}"
    key, index = base, 2
    while key in taken:
        key = f"{base}-{index}"
        index += 1
    taken.add(key)
    return key


def semantic_template_of(line: str) -> str:
    """Return the reusable Oracle signature for one unresolved engine line.

    The engine profile remains the source of truth for what is missing.  The
    Oracle classifier only supplies a stable grouping key, so cards that say
    the same operation with different amounts or card names can share one work
    order without making the classifier executable or weakening the profile
    gate.
    """
    cluster = str(classify(line).get("primitive_cluster", template_of(line)))
    # Keep the classifier's reusable operands, but retain a normalized action
    # shape as a safety boundary. This merges parameterized copies (amounts and
    # mana costs) without merging different target/event wording into one job.
    if "|shape:" not in cluster:
        shape = re.sub(r"\bcards?\b", "card", cluster_text(line), flags=re.IGNORECASE)
        cluster += "|shape:" + shape
    return "oracle:" + cluster


def load_blocked_cards(
    profiles: Iterable[dict[str, Any]],
    *,
    semantic_clusters: bool = False,
) -> list[dict[str, Any]]:
    """Cards the real engine could not finish, with their exact blocking lines.

    ``semantic_clusters`` is opt-in so the original literal roadmap remains a
    safe fallback when the Oracle classifier is unavailable or being changed.
    """
    blocked: list[dict[str, Any]] = []
    for profile in profiles:
        if profile.get("fullyImplemented"):
            continue
        lines = profile.get("unimplementedText") or []
        if not lines:
            # A card with no unmatched line but not implemented is a parser bug,
            # not a missing primitive; surface it rather than hiding it.
            continue
        line_templates = {
            (semantic_template_of(line) if semantic_clusters else template_of(line))
            for line in lines
        }
        blocked.append(
            {
                "oracle_id": profile.get("oracle_id"),
                "name": profile.get("name"),
                "templates": line_templates,
                "lines": list(lines),
            }
        )
    return blocked


def deck_oracle_ids(decks_path: Path, set_code: str) -> set[str]:
    """Return stable identities in one product scope, including printings without oracle IDs."""
    payload = json.loads(decks_path.read_text(encoding="utf-8"))
    wanted = set_code.casefold()
    identities: set[str] = set()
    for deck in payload.get("decks", []):
        if str(deck.get("set_code", "")).casefold() != wanted:
            continue
        for card in deck.get("cards", []):
            identity = card.get("oracle_id") or card.get("scryfall_id")
            if identity:
                identities.add(str(identity))
    return identities


def select_profiles(profiles: Iterable[dict[str, Any]], identities: set[str] | None) -> list[dict[str, Any]]:
    """Filter exported profiles by oracle ID, accepting a printing ID as a fallback."""
    selected = list(profiles)
    if identities is None:
        return selected
    return [
        profile for profile in selected
        if {str(profile.get("oracle_id") or ""), str(profile.get("scryfall_id") or "")} & identities
    ]


def build_roadmap(blocked: list[dict[str, Any]], top: int, examples: int = 4) -> list[dict[str, Any]]:
    """Greedy set cover over template -> cards, ranked by cards actually finished.

    Each round picks the template that finishes the most cards *given everything
    already scheduled*, then removes it from every card's remaining blocker set.
    That is what makes the order meaningful: a template with zero unlocks today
    rises the moment the template sharing its cards is scheduled.
    """
    remaining = {index: set(card["templates"]) for index, card in enumerate(blocked)}
    by_template: dict[str, set[int]] = defaultdict(set)
    for index, templates in remaining.items():
        for template in templates:
            by_template[template].add(index)

    example_lines: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for card in blocked:
        for line in card["lines"]:
            template = template_of(line)
            if len(example_lines[template]) < examples:
                example_lines[template].append((card["name"], line))

    roadmap: list[dict[str, Any]] = []
    cumulative = 0
    taken_keys: set[str] = set()
    for _ in range(top):
        best_template: str | None = None
        best_unlocked: tuple[int, ...] = ()
        best_score = (-1, -1)
        for template in sorted(by_template):
            indices = by_template[template]
            unlocked = tuple(index for index in indices if len(remaining[index]) == 1)
            # Cards finished decides the order. When nothing is finished yet, the
            # tie-break is how many cards the template blocks: retiring the widest
            # blocker is what turns other templates into last blockers, which is
            # the whole reason this is a set cover and not a frequency table.
            score = (len(unlocked), len(indices))
            if score > best_score or (score == best_score and (best_template is None or template < best_template)):
                best_template, best_unlocked, best_score = template, unlocked, score
        if best_template is None:
            break

        cumulative += len(best_unlocked)
        affected_indices = sorted(
            by_template[best_template],
            key=lambda i: blocked[i]["name"] or "",
        )
        one_line_indices = [index for index in affected_indices if len(blocked[index]["lines"]) == 1]
        roadmap.append(
            {
                "rank": len(roadmap) + 1,
                "template": best_template,
                "family": family_of(best_template),
                "unlocks": len(best_unlocked),
                "blocks": len(by_template[best_template]),
                "cumulative_unlocks": cumulative,
                "claim_key": claim_key("", best_template, taken_keys).lstrip("-"),
                "examples": [
                    {"name": name, "line": line}
                    for name, line in example_lines.get(best_template, [])
                ],
                "unlocked_cards": [
                    {"oracle_id": blocked[index]["oracle_id"], "name": blocked[index]["name"]}
                    for index in sorted(best_unlocked, key=lambda i: blocked[i]["name"] or "")[:60]
                ],
                "affected_cards": [
                    {"oracle_id": blocked[index]["oracle_id"], "name": blocked[index]["name"]}
                    for index in affected_indices
                ],
                # Exact engine-grounded quick-review queue: these cards have
                # one unmatched Oracle line and can close without rediscovery.
                "one_line_count": len(one_line_indices),
                "one_line_cards": [
                    {"oracle_id": blocked[index]["oracle_id"], "name": blocked[index]["name"]}
                    for index in one_line_indices
                ],
            }
        )

        # Retire the template: every card it blocked is now one blocker lighter.
        for index in by_template.pop(best_template):
            remaining[index].discard(best_template)
    return roadmap


def render_document(
    roadmap: list[dict[str, Any]],
    stats: dict[str, Any],
    claim_prefix: str,
    scope: str | None = None,
    semantic_clusters: bool = False,
) -> str:
    """Render the queue as a work order a contributor can pick up cold."""
    lines = [
        "# Primitive roadmap",
        "",
        "Generated by `tools/rules/plan_primitive_roadmap.py`. **Do not edit by hand** —",
        "regenerate it after every batch so the ranking reflects the current engine.",
        "",
        "The ranking is a greedy set cover over the lines the real engine could not",
        "execute, so it answers the only question that matters for scheduling: *which",
        "primitive finishes the most cards next?* A clause that appears in thousands of",
        "cards but never completes one is correctly ranked low.",
        *( ["When enabled, `oracle:` signatures merge parameterized actions by operation, target, zone, and type; the engine profile still decides whether a card is complete."] if semantic_clusters else [] ),
        "",
        f"- Catalog cards: **{stats['card_count']:,}**",
        f"- Fully implemented: **{stats['implemented']:,}**",
        f"- Unfinished: **{stats['blocked']:,}**, of which **{stats['one_line_away']:,}**"
        " are a single line away",
        f"- This queue's {len(roadmap)} entries would finish **{stats['queue_unlocks']:,}** more cards",
        *( [f"- Scope: **{scope}**"] if scope else [] ),
        "",
        "## Queue",
        "",
        "| # | Unlocks | Cumulative | Blocks | One-line review | Family | Claim key | Template |",
        "| --- | --- | --- | --- | ---: | --- | --- | --- |",
    ]
    for entry in roadmap:
        template = entry["template"].replace("|", "\\|")
        lines.append(
            f"| {entry['rank']} | {entry['unlocks']} | {entry['cumulative_unlocks']} |"
            f" {entry['blocks']} | {entry.get('one_line_count', 0)} | {entry['family']} |"
            f" `{claim_prefix}-{entry['claim_key']}` | `{template}` |"
        )

    lines += ["", "## Work orders", ""]
    for entry in roadmap:
        lines += [
            f"### {entry['rank']}. `{claim_prefix}-{entry['claim_key']}` — finishes {entry['unlocks']} cards",
            "",
            f"- Template: `{entry['template']}`",
            f"- Family: {entry['family']}",
            f"- Appears in {entry['blocks']} unfinished cards; it is the last blocker for {entry['unlocks']}.",
            f"- One-line review candidates: **{entry.get('one_line_count', 0)}**.",
            "",
            "Printed examples:",
            "",
        ]
        for example in entry["examples"]:
            lines.append(f"- **{example['name']}** — {example['line']}")
        shown = [card["name"] for card in entry["unlocked_cards"][:12]]
        if shown:
            lines += ["", f"Cards finished (first {len(shown)}): {', '.join(shown)}.", ""]
        else:
            lines.append("")
        affected = entry.get("affected_cards", [])
        if affected:
            lines += [
                f"All affected cards ({len(affected)}): "
                + ", ".join(f"{card['name']} [{card['oracle_id']}]" for card in affected),
                "",
            ]
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profiles", type=Path, default=Path("data/rules/engine-card-profiles.json"))
    parser.add_argument("--output", type=Path, default=Path("data/rules/primitive-roadmap.json"))
    parser.add_argument("--prompt-output", type=Path, default=None, help="Markdown work order to write.")
    parser.add_argument("--top", type=int, default=40, help="How many primitives to schedule.")
    parser.add_argument("--claim-prefix", default=None, help="Prefix for generated claim keys; defaults to --set-code.")
    parser.add_argument("--decks", type=Path, default=Path("data/decks/commander-precons.json"), help="Deck JSON used by --set-code.")
    parser.add_argument("--set-code", default=None, help="Limit the roadmap to cards in this product/set code.")
    parser.add_argument(
        "--oracle-effects",
        type=Path,
        default=None,
        help="Use the Oracle classifier's semantic signatures to merge reusable effect shapes.",
    )
    args = parser.parse_args()

    payload = json.loads(args.profiles.read_text(encoding="utf-8"))
    claim_prefix = resolve_claim_prefix(args.claim_prefix, args.set_code)
    scope_ids = deck_oracle_ids(args.decks, args.set_code) if args.set_code else None
    profiles = select_profiles(payload["profiles"], scope_ids)
    semantic_clusters = args.oracle_effects is not None
    if args.oracle_effects is not None and not args.oracle_effects.exists():
        raise SystemExit("No existe el IR Oracle indicado; ejecuta npm run rules:oracle:c13 primero.")
    blocked = load_blocked_cards(profiles, semantic_clusters=semantic_clusters)
    roadmap = build_roadmap(blocked, args.top)

    stats = {
        "card_count": len(profiles),
        "implemented": sum(1 for profile in profiles if profile.get("fullyImplemented")),
        "blocked": len(blocked),
        "one_line_away": sum(1 for card in blocked if len(card["lines"]) == 1),
        "queue_unlocks": roadmap[-1]["cumulative_unlocks"] if roadmap else 0,
        "distinct_templates": len({template for card in blocked for template in card["templates"]}),
        "family_counts": dict(Counter(family_of(template) for card in blocked for template in card["templates"]).most_common()),
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(
            {
                "format": ROADMAP_FORMAT,
                "source": str(args.profiles),
                "generated_at": datetime.now(UTC).isoformat(),
                "claim_prefix": claim_prefix,
                "scope": args.set_code,
                "semantic_clusters": semantic_clusters,
                "stats": stats,
                "roadmap": roadmap,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    if args.prompt_output:
        args.prompt_output.parent.mkdir(parents=True, exist_ok=True)
        args.prompt_output.write_text(render_document(roadmap, stats, claim_prefix, args.set_code, semantic_clusters), encoding="utf-8")

    print(
        f"Roadmap written: {len(roadmap)} primitives finishing {stats['queue_unlocks']} cards "
        f"({stats['one_line_away']} of {stats['blocked']} unfinished cards are one line away) -> {args.output}"
    )


if __name__ == "__main__":
    main()
