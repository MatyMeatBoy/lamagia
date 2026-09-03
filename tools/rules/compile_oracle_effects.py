"""Compile every catalog Oracle text into a deterministic reviewable IR.

This is the batch bridge between card text and ``packages/rules``. It does not
invent executable rules or copy XMage/Forge code: it tokenizes Oracle text,
classifies clauses, extracts common operands, and marks anything outside the
closed parser vocabulary for AI/human review. The resulting JSON is an input
for extending the TypeScript profile parser, not a runtime rules source.

Example:
    python tools/rules/compile_oracle_effects.py \
      --catalog data/catalog/prossh.sqlite \
      --output data/rules/oracle-effects.json \
      --prompt-output data/rules/oracle-review.md
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
from collections import Counter
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


VERB_PATTERNS: tuple[tuple[str, str], ...] = (
    ("search-library", r"\bsearch (?:your|a) library\b"),
    ("draw", r"\bdraw\b"),
    ("discard", r"\bdiscard\b"),
    ("mill", r"\bmill\b|put the top .* into .*graveyard"),
    ("damage", r"\bdeal(?:s)?\b.*\bdamage\b|\bdamage\b"),
    ("gain-life", r"\bgain(?:s)?\b.*\blife\b"),
    ("lose-life", r"\blose(?:s)?\b.*\blife\b"),
    ("destroy", r"\bdestroy\b"),
    ("exile", r"\bexile\b"),
    ("return", r"\breturn\b"),
    ("sacrifice", r"\bsacrifice\b"),
    ("create-token", r"\bcreate\b.*\btoken\b"),
    ("counter", r"\bcounter\b|\bproliferate\b"),
    ("modify-stats", r"\bgets?\b.*[+-]\d+|[+-]\d+\/+[+-]\d+"),
)

FAMILY_ORDER = ("search-library", "create-token", "damage", "counter", "modify-stats", "draw", "discard", "mill", "gain-life", "lose-life", "destroy", "exile", "return", "sacrifice")

TRIGGER_RE = re.compile(r"\b(?:when(?:ever)?|at the beginning of|at the end of)\b", re.I)
ACTIVATED_RE = re.compile(r"^[^:\n]{1,160}:\s*", re.I)
TARGET_RE = re.compile(r"\btarget\s+([^.;]+)", re.I)
MANA_ABILITY_RE = re.compile(r"^(?P<cost>[^:\n]{1,160}):\s*(?P<effect>add\b.+)$", re.I)
SEARCH_RE = re.compile(r"\bsearch your library for (?:an? |up to (?:one|two|three|five) )?(.+?) card\b", re.I)
NUMBER_RE = re.compile(r"\b(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b", re.I)
WORD_NUMBERS = {
    "a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4,
    "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
}
CARD_TYPES = {"land", "creature", "artifact", "enchantment", "instant", "sorcery", "planeswalker", "battle", "kindred"}
CRITERION_NOISE = {"basic", "card", "permanent", "spell", "with", "that", "whose", "where", "named", "converted", "mana", "power", "toughness"}


def mana_ability_hint(line: str) -> dict[str, Any] | None:
    """Extract reusable mana-ability structure without declaring it executable."""
    match = MANA_ABILITY_RE.match(line.strip())
    if not match:
        return None
    effect = match.group("effect").strip()
    side_effects: list[dict[str, Any]] = []
    gain = re.search(r"\byou gain (\w+) life\b", effect, re.I)
    if gain:
        side_effects.append({"kind": "gain-life", "amount": number_hint(gain.group(1))})
    restrictions: list[dict[str, Any]] = []
    land_gate = re.search(r"\bactivate only if you control (\w+) or more lands\b", effect, re.I)
    if land_gate:
        restrictions.append({"kind": "control-lands", "minimum": number_hint(land_gate.group(1))})
    spend_limit = re.search(r"\bthis mana (?:can't|cannot) be spent ([^.]+)", effect, re.I)
    if spend_limit:
        restrictions.append({"kind": "spend-limit", "text": spend_limit.group(0).strip()})
    return {
        "text": line.strip(),
        "cost": match.group("cost").strip(),
        "produced_symbols": re.findall(r"\{([^}]+)\}", effect.split(".", 1)[0]),
        "side_effects": side_effects,
        "restrictions": restrictions,
    }


def clean_text(text: str) -> str:
    # Reminder text explains rules but is not an effect instruction.
    return re.sub(r"\([^()]*\)", " ", text).replace("\r", "").strip()


def clauses(text: str) -> list[str]:
    result: list[str] = []
    for line in clean_text(text).split("\n"):
        line = re.sub(r"\s+", " ", line).strip()
        if not line:
            continue
        # Keep an activated/triggered line together: its cost/condition is
        # useful context for the later effect compiler.
        pieces = re.split(r"(?<=[.!?])\s+", line)
        result.extend(piece.strip() for piece in pieces if piece.strip())
    return result


def number_hint(text: str) -> int | str | None:
    match = NUMBER_RE.search(text)
    if not match:
        return "X" if re.search(r"\bX\b|\{X\}", text, re.I) else None
    token = match.group(0).lower()
    return WORD_NUMBERS.get(token, int(token) if token.isdigit() else None)


def search_criterion_hint(clause: str) -> dict[str, list[str]] | None:
    """Extract type/subtype operands without pretending the search is executable.

    Oracle has an open-ended subtype vocabulary (Equipment, Aura, Goblin, ...),
    so a generic inventory must preserve the raw operand instead of treating an
    unknown word as an unrestricted search. Compound descriptions remain a
    review item for the TypeScript closed parser.
    """
    match = SEARCH_RE.search(clause)
    if not match:
        return None
    criterion = re.sub(r"\s+", " ", match.group(1).strip())
    types = sorted({word.lower() for word in CARD_TYPES if re.search(rf"\b{re.escape(word)}\b", criterion, re.I)})
    subtypes: list[str] = ["Basic"] if re.search(r"\bbasic\b", criterion, re.I) else []
    for part in re.split(r"\s+(?:or|and)\s+", criterion, flags=re.I):
        candidate = re.sub(r"\b(?:basic|land|creature|artifact|enchantment|instant|sorcery|planeswalker|battle|kindred)\b", "", part, flags=re.I).strip()
        if (re.fullmatch(r"[A-Za-z][A-Za-z'’/-]*", candidate)
                and candidate.lower() not in CRITERION_NOISE
                and candidate.casefold() not in {value.casefold() for value in subtypes}):
            subtypes.append(candidate)
    return {"types": types, "subtypes": subtypes}


def classify(clause: str) -> dict[str, Any]:
    lower = clause.lower()
    families = [name for name, pattern in VERB_PATTERNS if re.search(pattern, clause, re.I)]
    kind = "triggered" if TRIGGER_RE.search(clause) else "activated" if ACTIVATED_RE.match(clause) else "static-or-spell"
    target = TARGET_RE.search(clause)
    search_criterion = search_criterion_hint(clause)
    target_text = target.group(1).strip() if target else None
    target_operand = re.sub(r"\s+(?:from|on|in)\s+(?:the\s+)?(?:battlefield|graveyard|hand)\b.*$", "", target_text or "", flags=re.I).strip()
    target_subtype = target_operand if target_operand and re.fullmatch(r"[A-Za-z][A-Za-z'’/-]*", target_operand) and target_operand.lower() not in CARD_TYPES else None
    target_types = sorted({word.title() for word in CARD_TYPES if target_operand and re.search(rf"\b{re.escape(word)}\b", target_operand, re.I)})
    target_zone = None
    if target_text:
        target_zone = "graveyard" if re.search(r"\bgraveyard\b", target_text, re.I) else "hand" if re.search(r"\bhand\b", target_text, re.I) else "battlefield"
    return {
        "text": clause,
        "kind": kind,
        "families": families,
        "primary_family": next((family for family in FAMILY_ORDER if family in families), "other"),
        "amount": number_hint(clause),
        "target_text": target_text,
        "target_subtype": target_subtype,
        "target_types": target_types,
        "target_zone": target_zone,
        "search_criterion": search_criterion,
        "mana_symbols": re.findall(r"\{([^}]+)\}", clause),
        "modal": bool(re.search(r"\bchoose (?:one|two|three|one or more)\b", lower)),
        "conditional": bool(re.search(r"\b(?:if|unless|as long as|whenever)\b", lower)),
        "candidate": bool(families or kind != "static-or-spell"),
    }


def compile_card(row: sqlite3.Row) -> dict[str, Any]:
    text = str(row["oracle_text"] or "")
    parsed = [classify(clause) for clause in clauses(text)]
    unmatched = [entry["text"] for entry in parsed if not entry["candidate"]]
    mana_abilities = [hint for line in text.split("\n") if (hint := mana_ability_hint(line))]
    return {
        "oracle_id": row["oracle_id"],
        "scryfall_id": row["id"],
        "name": row["name"],
        "type_line": row["type_line"],
        "mana_cost": row["mana_cost"],
        "oracle_text": text,
        "clauses": parsed,
        "mana_abilities": mana_abilities,
        "unmatched": unmatched,
        "status": "candidate" if parsed and not unmatched else "needs-review" if parsed else "vanilla",
    }


def review_markdown(cards: list[dict[str, Any]]) -> str:
    pending = [card for card in cards if card["status"] == "needs-review"]
    lines = [
        "# Oracle effect review queue",
        "",
        "> Generated by `compile_oracle_effects.py`. This queue is not executable rules.",
        "> For each entry, map the clause to a closed `SpellEffect`, `ActivatedAbility`,",
        "> or `TriggerDefinition`, cite the Comprehensive Rules, and add a scenario test.",
        "",
        f"Pending cards: **{len(pending):,}** / {len(cards):,}",
        "",
    ]
    for card in pending:
        lines.extend([f"## {card['name']} ({card['scryfall_id']})", "", f"```text\n{card['oracle_text']}\n```", ""])
        for clause in card["unmatched"]:
            lines.append(f"- Unmatched clause: `{clause}`")
        lines.append("- Suggested AI task: produce a minimal structured vector; do not guess missing rules; cite the official CR and add a test.")
        lines.append("")
    return "\n".join(lines)


def effective_worker_count(workers: int, memory_budget_gb: float, estimated_worker_mb: int) -> int:
    """Return a bounded worker count for the local parser scheduler.

    This is a conservative scheduler budget, not an OS-level memory limit. A
    future model runner can replace the estimate with measured per-process
    usage or a container/Job Object hard cap.
    """
    if memory_budget_gb <= 0 or estimated_worker_mb <= 0:
        raise ValueError("El presupuesto de memoria y la estimación por worker deben ser positivos.")
    budget_workers = int((memory_budget_gb * 1024) // estimated_worker_mb)
    return max(1, min(int(workers), 8, budget_workers))


def compile_catalog(
    catalog: Path,
    workers: int = 5,
    memory_budget_gb: float = 2.0,
    estimated_worker_mb: int = 256,
    backend: str = "processes",
    batch_size: int = 256,
) -> list[dict[str, Any]]:
    database = sqlite3.connect(f"file:{catalog}?mode=ro", uri=True)
    database.row_factory = sqlite3.Row
    rows = database.execute("SELECT id, oracle_id, name, mana_cost, type_line, oracle_text FROM cards ORDER BY printing_rank DESC, released_at DESC, id")
    seen: set[str] = set()
    # Detach rows from SQLite before handing them to worker processes.
    unique_rows: list[dict[str, Any]] = []
    for row in rows:
        identity = str(row["oracle_id"] or row["id"])
        if identity in seen:
            continue
        seen.add(identity)
        unique_rows.append(dict(row))
    database.close()
    worker_count = effective_worker_count(workers, memory_budget_gb, estimated_worker_mb)
    if worker_count == 1 or len(unique_rows) < 2:
        return [compile_card(row) for row in unique_rows]
    if batch_size <= 0:
        raise ValueError("El tamaño del lote debe ser positivo.")
    executor_type = ProcessPoolExecutor if backend == "processes" else ThreadPoolExecutor
    executor_kwargs: dict[str, Any] = {"max_workers": worker_count}
    if backend == "threads": executor_kwargs["thread_name_prefix"] = "oracle"
    # Keep only one bounded batch in flight. `map` preserves catalog order, so
    # parallel classification remains deterministic for generated IR and AI
    # review queues.
    result: list[dict[str, Any]] = []
    with executor_type(**executor_kwargs) as pool:
        for start in range(0, len(unique_rows), batch_size):
            batch = unique_rows[start:start + batch_size]
            result.extend(pool.map(compile_card, batch, chunksize=32) if backend == "processes" else pool.map(compile_card, batch))
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--prompt-output", type=Path)
    parser.add_argument("--workers", type=int, default=5, help="Workers for independent card classification (1-8; default: 5).")
    parser.add_argument("--memory-budget-gb", type=float, default=2.0, help="Conservative local worker budget in GB (default: 2).")
    parser.add_argument("--estimated-worker-mb", type=int, default=256, help="Memory reserved per worker for scheduling (default: 256).")
    parser.add_argument("--backend", choices=("processes", "threads"), default="processes", help="Parallel backend; processes use CPU cores, threads share one process.")
    parser.add_argument("--batch-size", type=int, default=256, help="Cards submitted per bounded batch (default: 256).")
    args = parser.parse_args()
    if not args.catalog.exists():
        raise SystemExit("No existe el catálogo local; ejecuta npm run catalog:sync primero.")
    worker_count = effective_worker_count(args.workers, args.memory_budget_gb, args.estimated_worker_mb)
    cards = compile_catalog(args.catalog, args.workers, args.memory_budget_gb, args.estimated_worker_mb, args.backend, args.batch_size)
    counts = Counter(card["status"] for card in cards)
    payload = {
        "format": "prossh-oracle-effect-ir/v2",
        "generated_at": datetime.now(UTC).isoformat(),
        "source": "local normalized catalog; Oracle text is display data, not executable code",
        "card_count": len(cards),
        "status_counts": dict(sorted(counts.items())),
        "cards": cards,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.prompt_output:
        args.prompt_output.parent.mkdir(parents=True, exist_ok=True)
        args.prompt_output.write_text(review_markdown(cards), encoding="utf-8")
    print(f"Oracle IR written: {len(cards):,} cards -> {args.output} (workers={worker_count}, backend={args.backend}, budget={args.memory_budget_gb:g}GB)")
    print(f"Statuses: {dict(sorted(counts.items()))}")


if __name__ == "__main__":
    main()
