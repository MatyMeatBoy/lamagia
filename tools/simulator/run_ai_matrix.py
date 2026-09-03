#!/usr/bin/env python3
"""Run repeatable AI-style regression games against real Commander deck lists.

This harness is intentionally conservative.  The Python simulator only models
zone movement, turn rotation, basic combat pressure, and a small named combo
heuristic.  A successful run proves those plumbing invariants survived many
seeded games; it never certifies arbitrary Oracle text as rules-correct.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from collections import Counter
from pathlib import Path
from time import perf_counter


SIMULATOR_PATH = Path(__file__).with_name("simulate_cedh_pod.py")
SPEC = importlib.util.spec_from_file_location("prossh_metadata_simulator", SIMULATOR_PATH)
assert SPEC and SPEC.loader
SIMULATOR = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = SIMULATOR
SPEC.loader.exec_module(SIMULATOR)


def validate_game(result: dict) -> None:
    for player in result["players"]:
        zones = player["zones"]
        if zones["command_zone"] != 1:
            raise RuntimeError(f"{player['name']}: expected one commander in command zone")
        if sum(zones.values()) != 100:
            raise RuntimeError(f"{player['name']}: card conservation failed ({sum(zones.values())}/100)")


def run_matrix(decks: list[dict], games: int, seed: int, max_turns: int) -> dict:
    if len(decks) < 2:
        raise ValueError("The AI matrix needs at least two decks.")
    started = perf_counter()
    winners: Counter[str] = Counter()
    turns: list[int] = []
    sampled_games: list[dict] = []

    for game_index in range(games):
        # Rotate seats so a deck is not always the starting player.  The simulator
        # still uses deterministic shuffles, allowing an exact failure replay.
        rotation = game_index % len(decks)
        seated_decks = decks[rotation:] + decks[:rotation]
        game_seed = seed + game_index
        outcome = SIMULATOR.run(seated_decks, game_seed, max_turns)
        validate_game(outcome)
        if outcome["winner"]:
            winners[outcome["winner"]] += 1
        turns.append(outcome["turns"])
        if game_index < 3 or game_index == games - 1:
            sampled_games.append({
                "index": game_index,
                "seed": game_seed,
                "seat_rotation": rotation,
                "winner": outcome["winner"],
                "turns": outcome["turns"],
                "events": outcome["events"][-8:],
            })

    return {
        "kind": "ai-metadata-regression",
        "status": "passed",
        "rules_coverage": {
            "checked": [
                "100-card zone conservation",
                "one declared commander remains in the command zone",
                "deterministic seeded runs",
                "seat rotation",
                "basic draw, land, zone-movement and combat heuristics",
            ],
            "not_checked": [
                "arbitrary Oracle-text effects",
                "colored mana and payment choices",
                "priority responses and targeting",
                "replacement effects, layers, state-based actions, and full Commander rules",
            ],
        },
        "configuration": {"games": games, "seed": seed, "max_turns": max_turns, "deck_count": len(decks)},
        "summary": {
            "completed_games": games,
            "wins_by_deck": dict(sorted(winners.items())),
            "unfinished_games": games - sum(winners.values()),
            "average_turns": round(sum(turns) / len(turns), 2) if turns else 0,
            "elapsed_seconds": round(perf_counter() - started, 3),
        },
        "replay_samples": sampled_games,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run deterministic Commander AI regression games.")
    parser.add_argument("--pod", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--games", type=int, default=1000)
    parser.add_argument("--seed", type=int, default=24091996)
    parser.add_argument("--max-turns", type=int, default=80)
    args = parser.parse_args()
    if args.games < 1:
        parser.error("--games must be at least 1")
    payload = json.loads(args.pod.read_text(encoding="utf-8"))
    report = run_matrix(payload["decks"], args.games, args.seed, args.max_turns)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    summary = report["summary"]
    print(f"AI matrix passed: {summary['completed_games']} games in {summary['elapsed_seconds']}s; unfinished={summary['unfinished_games']}")
