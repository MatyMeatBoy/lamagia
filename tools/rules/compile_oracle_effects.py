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
import hashlib
import json
import re
import sqlite3
from math import ceil
from collections import Counter
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


DEFAULT_COMMIT_CARD_LIMIT = 20
ORACLE_IR_PARSER_VERSION = "v3"


VERB_PATTERNS: tuple[tuple[str, str], ...] = (
    ("search-library", r"\bsearch (?:your|a) library\b"),
    ("draw", r"\bdraw(?:s|ing)?\b"),
    ("discard", r"\bdiscard(?:s|ed)?\b"),
    ("mill", r"\bmill(?:s|ed)?\b|put the top .* into .*graveyard"),
    ("damage", r"\bdeal(?:s|t)?\b.*\bdamage\b|\bdamage\b"),
    ("gain-life", r"\bgain(?:s|ed)?\b.*\blife\b"),
    ("lose-life", r"\blose(?:s|st)?\b.*\blife\b"),
    ("destroy", r"\bdestroy(?:s|ed)?\b"),
    ("exile", r"\bexile(?:s|d)?\b"),
    ("return", r"\breturn(?:s|ed)?\b"),
    ("sacrifice", r"\bsacrific(?:e|es|ed)\b"),
    ("create-token", r"\bcreate(?:s|d)?\b.*\btoken\b"),
    ("counter", r"\bcounter(?:s|ed)?\b|\bproliferate(?:s)?\b"),
    ("modify-stats", r"\bgets?\b.*[+-]\d+|[+-]\d+\/+[+-]\d+"),
)

FAMILY_ORDER = ("search-library", "create-token", "damage", "counter", "modify-stats", "draw", "discard", "mill", "gain-life", "lose-life", "destroy", "exile", "return", "sacrifice")

TRIGGER_RE = re.compile(r"\b(?:when(?:ever)?|at the beginning of|at the end of)\b", re.I)
ACTIVATED_RE = re.compile(r"^[^:\n]{1,160}:\s*", re.I)
TARGET_RE = re.compile(r"\btarget\s+([^.;]+)", re.I)
MANA_ABILITY_RE = re.compile(r"^(?P<cost>[^:\n]{1,160}):\s*(?P<effect>add\b.+)$", re.I)
SEARCH_RE = re.compile(r"\bsearch your library for (?:an? |up to (?:one|two|three|five) )?(.+?\bcard(?:s)?(?:\s+with\b[^.;]+)?)", re.I)
NUMBER_RE = re.compile(r"\b(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b", re.I)
WORD_NUMBERS = {
    "a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4,
    "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
}
CARD_TYPES = {"land", "creature", "artifact", "enchantment", "instant", "sorcery", "planeswalker", "battle", "kindred"}
CRITERION_NOISE = {"basic", "card", "permanent", "spell", "with", "that", "whose", "where", "named", "converted", "mana", "power", "toughness"}
SUPPORTED_KEYWORDS = ("flying", "reach", "first strike", "double strike", "deathtouch", "trample", "vigilance", "lifelink", "menace", "defender", "haste", "indestructible", "hexproof", "shroud", "flash")
KEYWORD_ONLY_RE = re.compile(r"^(?:" + "|".join(re.escape(keyword) for keyword in SUPPORTED_KEYWORDS) + r")(?:\s*,\s*(?:" + "|".join(re.escape(keyword) for keyword in SUPPORTED_KEYWORDS) + r"))*\.?$", re.I)
ZONE_PATTERNS: tuple[tuple[str, str], ...] = (
    ("library", r"\blibrar(?:y|ies)\b"),
    ("hand", r"\bhand\b"),
    ("battlefield", r"\bbattlefield\b"),
    ("graveyard", r"\bgraveyard\b"),
    # The verb "Exile target ..." is an action, not a zone reference.
    ("exile", r"\bexiled\b|\b(?:from|in|to|into|the)\s+(?:the\s+)?exile\b"),
    ("stack", r"\bstack\b"),
    ("command", r"\bcommand zone\b"),
)


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


def has_card_type(text: str, card_type: str) -> bool:
    """Match singular and plural type words without matching unrelated words."""
    return bool(re.search(rf"\b{re.escape(card_type)}(?:s|es)?\b", text, re.I))


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
    # The marker is grammar, not part of the requested type/subtype. Keep any
    # trailing `with ...` filter so it can contribute operands as well.
    criterion = re.sub(r"\s+cards?\b", "", criterion, count=1, flags=re.I).strip()
    types = sorted({word.lower() for word in CARD_TYPES if has_card_type(criterion, word)})
    subtypes: list[str] = ["Basic"] if re.search(r"\bbasic\b", criterion, re.I) else []
    for part in re.split(r"\s+(?:or|and)\s+", criterion, flags=re.I):
        candidate = re.sub(r"\b(?:basic|land|creature|artifact|enchantment|instant|sorcery|planeswalker|battle|kindred)\b", "", part, flags=re.I).strip()
        if (re.fullmatch(r"[A-Za-z][A-Za-z'’/-]*", candidate)
                and candidate.lower() not in CRITERION_NOISE
                and candidate.casefold() not in {value.casefold() for value in subtypes}):
            subtypes.append(candidate)
    return {"types": types, "subtypes": subtypes}


def operand_hints(clause: str, target_text: str | None, search_criterion: dict[str, list[str]] | None) -> dict[str, list[str]]:
    """Preserve reusable nouns/locations so later workers do not re-parse text.

    This is intentionally an inventory, not a legality decision. ``Equipment``
    remains a subtype while ``artifact`` remains a card type; a future closed
    TypeScript primitive decides what those operands permit in a given effect.
    """
    zones = [name for name, pattern in ZONE_PATTERNS if re.search(pattern, clause, re.I)]
    card_types = sorted({word.title() for word in CARD_TYPES if has_card_type(clause, word)})
    subtypes = list((search_criterion or {}).get("subtypes", []))
    if target_text:
        target_operand = re.sub(r"\s+(?:from|on|in)\s+(?:the\s+)?(?:battlefield|graveyard|hand|exile|library|stack)\b.*$", "", target_text, flags=re.I).strip()
        if (re.fullmatch(r"[A-Za-z][A-Za-z'’/-]*", target_operand)
                and target_operand.lower() not in CARD_TYPES
                and target_operand.lower() not in {value.casefold() for value in subtypes}):
            subtypes.append(target_operand)
    return {"actions": [name for name, _ in VERB_PATTERNS if re.search(_, clause, re.I)],
            "zones": zones, "card_types": card_types, "subtypes": sorted(subtypes, key=str.casefold)}


def cluster_text(clause: str) -> str:
    """Return a bounded, name-independent-ish shape for an open clause."""
    normalized = re.sub(r"(?:\{[^}]+\})+", "{cost}", clause.lower())
    # Some local catalog rows contain a replacement character where Oracle
    # uses an em dash (typically after a lossy import). Keep the queue key
    # stable without changing the raw clause shown to a reviewer.
    normalized = normalized.replace("\ufffd", "<mode>").replace("—", "-").replace("–", "-")
    normalized = re.sub(r"\b(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|x|\d+)\b", "<n>", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip().rstrip(".")
    return normalized[:160]


def classify(clause: str) -> dict[str, Any]:
    lower = clause.lower()
    families = [name for name, pattern in VERB_PATTERNS if re.search(pattern, clause, re.I)]
    kind = "triggered" if TRIGGER_RE.search(clause) else "activated" if ACTIVATED_RE.match(clause) else "static-or-spell"
    target = TARGET_RE.search(clause)
    search_criterion = search_criterion_hint(clause)
    target_text = target.group(1).strip() if target else None
    target_operand = re.sub(r"\s+(?:from|on|in)\s+(?:the\s+)?(?:battlefield|graveyard|hand)\b.*$", "", target_text or "", flags=re.I).strip()
    target_subtype = target_operand if target_operand and re.fullmatch(r"[A-Za-z][A-Za-z'’/-]*", target_operand) and target_operand.lower() not in CARD_TYPES else None
    target_types = sorted({word.title() for word in CARD_TYPES if target_operand and has_card_type(target_operand, word)})
    target_zone = None
    if target_text:
        target_zone = "graveyard" if re.search(r"\bgraveyard\b", target_text, re.I) else "hand" if re.search(r"\bhand\b", target_text, re.I) else "battlefield"
    modal = bool(re.search(r"\bchoose (?:one|two|three|one or more)\b", lower))
    keyword_only = bool(KEYWORD_ONLY_RE.fullmatch(clause.strip()))
    operands = operand_hints(clause, target_text, search_criterion)
    cluster_parts = [next((family for family in FAMILY_ORDER if family in families), "other"), kind]
    if not families:
        cluster_parts.append("shape:" + cluster_text(clause))
    if search_criterion:
        cluster_parts.append("search:" + ",".join(search_criterion["types"] + search_criterion["subtypes"]))
    if target_subtype:
        cluster_parts.append("target-subtype:" + target_subtype)
    elif target_types:
        cluster_parts.append("target-types:" + ",".join(target_types))
    if target_zone:
        cluster_parts.append("zone:" + target_zone)
    if modal:
        cluster_parts.append("modal")
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
        "operands": operands,
        "mana_symbols": re.findall(r"\{([^}]+)\}", clause),
        "modal": modal,
        "conditional": bool(re.search(r"\b(?:if|unless|as long as|whenever)\b", lower)),
        # Stable grouping key for AI/contributor batches. It preserves the
        # reusable mechanic constraints without using card names as identity.
        "primitive_cluster": "|".join(cluster_parts),
        "keyword_only": keyword_only,
        "candidate": bool(families or kind != "static-or-spell" or keyword_only),
    }


def compile_card(row: sqlite3.Row) -> dict[str, Any]:
    text = str(row["oracle_text"] or "")
    parsed = [classify(clause) for clause in clauses(text)]
    unmatched = [entry["text"] for entry in parsed if not entry["candidate"]]
    mana_abilities = [hint for line in text.split("\n") if (hint := mana_ability_hint(line))]
    # Only unresolved clauses belong in the review queue. A supported keyword
    # on a card with another missing effect must not pollute that effect's
    # cluster or make every worker revisit a solved primitive.
    primitive_clusters = sorted({entry["primitive_cluster"] for entry in parsed if not entry["candidate"]})
    return {
        "oracle_id": row["oracle_id"],
        "scryfall_id": row["id"],
        "name": row["name"],
        "type_line": row["type_line"],
        "mana_cost": row["mana_cost"],
        "oracle_text": text,
        "clauses": parsed,
        "primitive_clusters": primitive_clusters,
        "mana_abilities": mana_abilities,
        "unmatched": unmatched,
        "status": "candidate" if parsed and not unmatched else "needs-review" if parsed else "vanilla",
    }


def card_fingerprint(row: dict[str, Any]) -> str:
    """Return a stable cache key for fields that affect the generated IR."""
    payload = "\x1f".join(str(row.get(field) or "") for field in (
        "id", "oracle_id", "name", "mana_cost", "type_line", "oracle_text",
    ))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def load_card_cache(path: Path | None) -> dict[str, dict[str, Any]]:
    """Load reusable card IR, ignoring stale or malformed cache files."""
    if path is None or not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if payload.get("format") != "prossh-oracle-card-cache/v1" or payload.get("parser_version") != ORACLE_IR_PARSER_VERSION:
        return {}
    cards = payload.get("cards")
    return cards if isinstance(cards, dict) else {}


def save_card_cache(path: Path | None, entries: dict[str, dict[str, Any]]) -> None:
    """Persist cache atomically so an interrupted run never corrupts it."""
    if path is None:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "format": "prossh-oracle-card-cache/v1",
        "parser_version": ORACLE_IR_PARSER_VERSION,
        "cards": {key: entries[key] for key in sorted(entries)},
    }
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    temporary.replace(path)


def review_markdown(cards: list[dict[str, Any]], inventory: list[dict[str, Any]] | None = None) -> str:
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
    clusters = inventory if inventory is not None else primitive_cluster_inventory(cards)
    if clusters:
        lines.extend(["## Reusable primitive clusters", ""])
        for entry in clusters:
            names = ", ".join(card["name"] for card in entry["cards"][:5])
            lines.append(f"- **{entry['card_count']:,} cards** — `{entry['cluster']}` — {names}")
            for example in entry.get("examples", []):
                lines.append(f"  - Example: `{example}`")
        lines.append("")
    for card in pending:
        lines.extend([f"## {card['name']} ({card['scryfall_id']})", "", f"```text\n{card['oracle_text']}\n```", ""])
        for clause in card["unmatched"]:
            lines.append(f"- Unmatched clause: `{clause}`")
        lines.append("- Suggested AI task: produce a minimal structured vector; do not guess missing rules; cite the official CR and add a test.")
        lines.append("")
    return "\n".join(lines)


def primitive_cluster_inventory(
    cards: list[dict[str, Any]],
    commit_card_limit: int = DEFAULT_COMMIT_CARD_LIMIT,
) -> list[dict[str, Any]]:
    """Build a deterministic, card-name-independent work queue.

    This is the cluster-first part of the compiler: a worker receives one
    reusable rule shape plus stable card identities, instead of rediscovering
    the same nouns and zones for every card. Only unresolved clauses are
    included, so solved primitives naturally disappear from the queue.
    """
    if commit_card_limit <= 0:
        raise ValueError("El límite de cartas por commit debe ser positivo.")
    clusters: dict[str, dict[str, Any]] = {}
    for card in cards:
        for cluster in card.get("primitive_clusters", []):
            entry = clusters.setdefault(cluster, {"cards": {}, "examples": set()})
            entry["cards"][str(card["oracle_id"])] = {
                "oracle_id": str(card["oracle_id"]),
                "scryfall_id": str(card["scryfall_id"]),
                "name": str(card["name"]),
            }
            for clause in card.get("clauses", []):
                if not clause.get("candidate") and clause.get("primitive_cluster") == cluster:
                    entry["examples"].add(str(clause["text"]))
    inventory = [
        {
            "cluster": cluster,
            "card_count": len(entry["cards"]),
            "commit_batches": ceil(len(entry["cards"]) / commit_card_limit),
            "examples": sorted(entry["examples"], key=str.casefold)[:3],
            "cards": sorted(entry["cards"].values(), key=lambda item: (item["name"].casefold(), item["oracle_id"])),
        }
        for cluster, entry in clusters.items()
    ]
    return sorted(inventory, key=lambda item: (-item["card_count"], item["cluster"]))


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
    workers: int = 8,
    memory_budget_gb: float = 2.0,
    estimated_worker_mb: int = 256,
    backend: str = "processes",
    batch_size: int = 256,
    set_code: str | None = None,
    cache_output: Path | None = None,
) -> list[dict[str, Any]]:
    database = sqlite3.connect(f"file:{catalog}?mode=ro", uri=True)
    database.row_factory = sqlite3.Row
    query = "SELECT id, oracle_id, name, mana_cost, type_line, oracle_text FROM cards"
    parameters: tuple[str, ...] = ()
    if set_code:
        query += " WHERE lower(set_code) = lower(?)"
        parameters = (set_code.strip(),)
    query += " ORDER BY printing_rank DESC, released_at DESC, id"
    rows = database.execute(query, parameters)
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
    cache = load_card_cache(cache_output)
    result_by_identity: dict[str, dict[str, Any]] = {}
    missing_rows: list[dict[str, Any]] = []
    for row in unique_rows:
        identity = str(row["oracle_id"] or row["id"])
        fingerprint = card_fingerprint(row)
        cached = cache.get(identity)
        if cached and cached.get("fingerprint") == fingerprint and isinstance(cached.get("card"), dict):
            result_by_identity[identity] = cached["card"]
        else:
            missing_rows.append(row)
    worker_count = effective_worker_count(workers, memory_budget_gb, estimated_worker_mb)
    if worker_count == 1 or len(missing_rows) < 2:
        compiled = [compile_card(row) for row in missing_rows]
    elif batch_size <= 0:
        raise ValueError("El tamaño del lote debe ser positivo.")
    else:
        executor_type = ProcessPoolExecutor if backend == "processes" else ThreadPoolExecutor
        executor_kwargs: dict[str, Any] = {"max_workers": worker_count}
        if backend == "threads": executor_kwargs["thread_name_prefix"] = "oracle"
        # Keep only one bounded batch in flight. `map` preserves catalog order, so
        # parallel classification remains deterministic for generated IR and AI
        # review queues.
        compiled = []
        with executor_type(**executor_kwargs) as pool:
            for start in range(0, len(missing_rows), batch_size):
                batch = missing_rows[start:start + batch_size]
                compiled.extend(pool.map(compile_card, batch, chunksize=32) if backend == "processes" else pool.map(compile_card, batch))
    for row, card in zip(missing_rows, compiled):
        identity = str(row["oracle_id"] or row["id"])
        result_by_identity[identity] = card
        cache[identity] = {"fingerprint": card_fingerprint(row), "card": card}
    save_card_cache(cache_output, cache)
    return [result_by_identity[str(row["oracle_id"] or row["id"])] for row in unique_rows]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--set-code", help="Optional set code to compile only that edition (for example: c13).")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--prompt-output", type=Path)
    parser.add_argument("--cluster-output", type=Path, help="Optional deterministic JSON queue grouped by reusable primitive cluster.")
    parser.add_argument("--workers", type=int, default=8, help="Workers for independent card classification (1-8; default: 8).")
    parser.add_argument("--memory-budget-gb", type=float, default=2.0, help="Conservative local worker budget in GB (default: 2).")
    parser.add_argument("--estimated-worker-mb", type=int, default=256, help="Memory reserved per worker for scheduling (default: 256).")
    parser.add_argument("--backend", choices=("processes", "threads"), default="processes", help="Parallel backend; processes use CPU cores, threads share one process.")
    parser.add_argument("--batch-size", type=int, default=256, help="Cards submitted per bounded batch (default: 256).")
    parser.add_argument("--cache-output", type=Path, help="Optional incremental IR cache; unchanged oracle_id rows are reused.")
    parser.add_argument("--commit-card-limit", type=int, default=DEFAULT_COMMIT_CARD_LIMIT, help="Maximum new oracle_id values per generated commit batch (default: 20).")
    args = parser.parse_args()
    if not args.catalog.exists():
        raise SystemExit("No existe el catálogo local; ejecuta npm run catalog:sync primero.")
    worker_count = effective_worker_count(args.workers, args.memory_budget_gb, args.estimated_worker_mb)
    cards = compile_catalog(args.catalog, args.workers, args.memory_budget_gb, args.estimated_worker_mb, args.backend, args.batch_size, args.set_code, args.cache_output)
    counts = Counter(card["status"] for card in cards)
    clusters = primitive_cluster_inventory(cards, args.commit_card_limit)
    payload = {
        "format": "prossh-oracle-effect-ir/v2",
        "generated_at": datetime.now(UTC).isoformat(),
        "source": "local normalized catalog; Oracle text is display data, not executable code",
        "set_code": args.set_code,
        "card_count": len(cards),
        "status_counts": dict(sorted(counts.items())),
        "primitive_cluster_count": len(clusters),
        "cards": cards,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.prompt_output:
        args.prompt_output.parent.mkdir(parents=True, exist_ok=True)
        args.prompt_output.write_text(review_markdown(cards, clusters), encoding="utf-8")
    if args.cluster_output:
        args.cluster_output.parent.mkdir(parents=True, exist_ok=True)
        args.cluster_output.write_text(json.dumps({
            "format": "prossh-primitive-cluster-queue/v1",
            "source": "oracle-effects.json unresolved clauses",
            "cluster_count": len(clusters),
            "clusters": clusters,
        }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    cache_note = f", cache={args.cache_output}" if args.cache_output else ""
    print(f"Oracle IR written: {len(cards):,} cards -> {args.output} (workers={worker_count}, backend={args.backend}, budget={args.memory_budget_gb:g}GB{cache_note})")
    print(f"Statuses: {dict(sorted(counts.items()))}")


if __name__ == "__main__":
    main()
