#!/usr/bin/env python3
"""Tests for the deterministic Commander AI regression harness."""
from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("run_ai_matrix.py")
SPEC = importlib.util.spec_from_file_location("prossh_ai_matrix", MODULE_PATH)
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


class AiMatrixTests(unittest.TestCase):
    def test_matrix_is_seeded_and_reports_its_coverage_boundary(self) -> None:
        decks = [deck("A"), deck("B"), deck("C"), deck("D")]
        first = MODULE.run_matrix(decks, games=8, seed=44, max_turns=10)
        second = MODULE.run_matrix(decks, games=8, seed=44, max_turns=10)
        self.assertEqual(first["kind"], "ai-metadata-regression")
        self.assertEqual(first["status"], "passed")
        self.assertEqual(first["summary"]["completed_games"], 8)
        self.assertEqual(first["replay_samples"], second["replay_samples"])
        self.assertIn("arbitrary Oracle-text effects", first["rules_coverage"]["not_checked"])


if __name__ == "__main__":
    unittest.main()
