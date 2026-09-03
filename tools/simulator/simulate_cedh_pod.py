#!/usr/bin/env python3
"""Metadata-driven cEDH pod regression run.

This is deliberately a simulator rather than a rules claim: it uses real card lists
and conserves zones while ranking actions by card metadata. The JSON output is a
repeatable smoke test for deck import and match-state plumbing.
"""
from __future__ import annotations
import argparse, json, random
from dataclasses import dataclass, field
from pathlib import Path

@dataclass
class Player:
    name: str
    library: list[dict]
    command_zone: list[dict] = field(default_factory=list)
    hand: list[dict] = field(default_factory=list)
    battlefield: list[dict] = field(default_factory=list)
    graveyard: list[dict] = field(default_factory=list)
    exile: list[dict] = field(default_factory=list)
    life: int = 40

def role(card: dict) -> str:
    text = (card.get("name", "") + " " + (card.get("oracle_text") or "")).lower()
    type_line = (card.get("type_line") or "").lower()
    if "land" in type_line: return "land"
    if any(term in text for term in ("thassa's oracle", "demonic consultation", "tainted pact", "underworld breach", "food chain")): return "wincon"
    if any(term in text for term in ("mana crypt", "mana vault", "lotus", "mox", "signet", "talisman", "bird", "hierarch", "ritual")): return "ramp"
    if "instant" in type_line or "counter" in text or "destroy target" in text: return "interaction"
    if "creature" in type_line: return "threat"
    return "engine"

def draw(player: Player) -> bool:
    if not player.library: player.life = 0; return False
    player.hand.append(player.library.pop()); return True

def total(player: Player) -> int:
    return len(player.library) + len(player.hand) + len(player.battlefield) + len(player.graveyard) + len(player.exile) + len(player.command_zone)
def mana(player: Player) -> int: return sum(role(card) in {"land", "ramp"} for card in player.battlefield)
def permanent(card: dict) -> bool:
    type_line = (card.get("type_line") or "").lower()
    return any(kind in type_line for kind in ("artifact", "creature", "enchantment", "planeswalker", "battle"))

def oracle_combo(player: Player) -> bool:
    names = {card.get("name", "").lower() for card in player.battlefield}
    return "thassa's oracle" in names and bool({"demonic consultation", "tainted pact"} & names)

def run(decks: list[dict], seed: int, max_turns: int) -> dict:
    rng = random.Random(seed)
    players = []
    for deck in decks:
        cards = list(deck["cards"])
        commander_names = set(deck.get("commanders", []))
        commander_index = next((index for index, card in enumerate(cards) if card.get("name") in commander_names), None)
        if len(cards) != 100 or commander_index is None:
            raise RuntimeError(f"{deck['name']} must provide 100 cards including a declared commander")
        commander = cards.pop(commander_index)
        rng.shuffle(cards)
        players.append(Player(deck["name"], cards, command_zone=[commander]))
    for player in players:
        for _ in range(7): draw(player)
    events: list[str] = []
    for turn in range(1, max_turns + 1):
        player = players[(turn - 1) % len(players)]
        # The starting player skips the draw in their first turn; commanders are never in the library.
        if turn != 1: draw(player)
        land = next((card for card in player.hand if role(card) == "land"), None)
        if land: player.hand.remove(land); player.battlefield.append(land); events.append(f"T{turn}: {player.name} plays {land['name']}")
        choices = [card for card in player.hand if card.get("cmc", 0) <= mana(player) and role(card) != "land"]
        if choices:
            chosen = max(choices, key=lambda card: ({"wincon": 5, "engine": 4, "threat": 3, "ramp": 2, "interaction": 1}[role(card)], card.get("cmc", 0)))
            player.hand.remove(chosen)
            destination = player.battlefield if permanent(chosen) else player.graveyard
            destination.append(chosen)
            events.append(f"T{turn}: {player.name} abstracts a cast of {chosen['name']} to {'battlefield' if permanent(chosen) else 'graveyard'}")
        if oracle_combo(player):
            for opponent in players:
                if opponent is not player: opponent.life = 0
            events.append(f"T{turn}: {player.name} wins via Thassa's Oracle consultation line")
        threats = sum(1 for card in player.battlefield if role(card) == "threat")
        target = min((candidate for candidate in players if candidate is not player and candidate.life > 0), key=lambda candidate: candidate.life, default=None)
        if target and threats:
            target.life -= threats
            events.append(f"T{turn}: {player.name} attacks {target.name} for {threats}")
        for candidate in players:
            if total(candidate) != 100: raise RuntimeError(f"Zone conservation failed for {candidate.name}")
        alive = [candidate for candidate in players if candidate.life > 0]
        if len(alive) <= 1: return result(seed, turn, alive[0].name if alive else None, events, players)
    return result(seed, max_turns, None, events, players)

def result(seed: int, turns: int, winner: str | None, events: list[str], players: list[Player]) -> dict:
    return {"seed": seed, "turns": turns, "winner": winner, "events": events, "players": [{"name": p.name, "life": p.life, "zones": {"library":len(p.library), "hand":len(p.hand), "battlefield":len(p.battlefield), "graveyard":len(p.graveyard), "exile":len(p.exile), "command_zone":len(p.command_zone)}} for p in players]}

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--pod", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=24091996)
    parser.add_argument("--max-turns", type=int, default=48)
    args = parser.parse_args()
    payload = json.loads(args.pod.read_text(encoding="utf-8"))
    result = run(payload["decks"], args.seed, args.max_turns)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Simulated {len(payload['decks'])} real-list decks for {result['turns']} turns; winner={result['winner']}")
