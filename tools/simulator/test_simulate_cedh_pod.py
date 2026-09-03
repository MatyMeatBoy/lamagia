#!/usr/bin/env python3
"""Regression tests for the metadata-only cEDH simulator."""
from __future__ import annotations
import importlib.util
import sys
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("simulate_cedh_pod.py")
SPEC = importlib.util.spec_from_file_location("cedh_simulator", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)

def card(name: str, type_line: str, cmc: int = 0) -> dict:
    return {"name": name, "type_line": type_line, "cmc": cmc, "oracle_text": ""}

def deck(name: str) -> dict:
    return {
        "name": name,
        "commanders": [f"{name} Commander"],
        "cards": [card(f"{name} Commander", "Legendary Creature", 3)]
        + [card(f"{name} Land {index}", "Basic Land") for index in range(50)]
        + [card(f"{name} Spell {index}", "Instant", 1) for index in range(49)],
    }

class SimulatorTests(unittest.TestCase):
    def test_commanders_are_in_command_zone_and_cards_are_conserved(self) -> None:
        output = MODULE.run([deck("A"), deck("B")], seed=9, max_turns=4)
        for player in output["players"]:
            zones = player["zones"]
            self.assertEqual(zones["command_zone"], 1)
            self.assertEqual(sum(zones.values()), 100)

    def test_same_seed_replays_identically(self) -> None:
        first = MODULE.run([deck("A"), deck("B")], seed=11, max_turns=8)
        second = MODULE.run([deck("A"), deck("B")], seed=11, max_turns=8)
        self.assertEqual(first, second)

if __name__ == "__main__":
    unittest.main()
