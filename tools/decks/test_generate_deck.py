import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).with_name("generate_deck.py")
SPEC = importlib.util.spec_from_file_location("generate_deck", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules["generate_deck"] = MODULE
SPEC.loader.exec_module(MODULE)


def card(oracle_id, name, *, type_line="Artifact", oracle_text="", identity=(), rank=1, legal="legal"):
    return {
        "id": f"sf-{oracle_id}", "oracle_id": oracle_id, "name": name,
        "type_line": type_line, "oracle_text": oracle_text,
        "color_identity": list(identity), "legalities": {"commander": legal},
        "printing_rank": rank,
    }


def fixture_cards():
    cards = [card("cmd", "Cloud, Midgar Mercenary", type_line="Legendary Creature — Human Soldier", identity=("W", "U"), oracle_text="Whenever Cloud attacks, draw a card.")]
    basics = [("plains", "Plains", "W"), ("island", "Island", "U")]
    cards.extend(card(oracle, name, type_line="Basic Land — " + name, identity=()) for oracle, name, _ in basics)
    for index in range(10):
        cards.append(card(f"ramp-{index}", f"Ramp {index}", oracle_text="Add {W}.", identity=()))
    for index in range(10):
        cards.append(card(f"draw-{index}", f"Draw {index}", oracle_text="Draw a card.", identity=()))
    for index in range(8):
        cards.append(card(f"removal-{index}", f"Removal {index}", oracle_text="Destroy target creature.", identity=()))
    for index in range(5):
        cards.append(card(f"protect-{index}", f"Protect {index}", oracle_text="Target creature gains hexproof.", identity=()))
    for index in range(65):
        cards.append(card(f"synergy-{index}", f"Synergy {index}", identity=()))
    cards.append(card("off-color", "Off Color", identity=("R",)))
    cards.append(card("banned", "Banned Card", legal="banned"))
    return cards


class GenerateDeckTests(unittest.TestCase):
    def setUp(self):
        self.catalog = MODULE.MemoryCatalog(fixture_cards())

    def test_deterministic_complete_deck_and_provenance(self):
        first = MODULE.generate_deck("Cloud, Midgar Mercenary", catalog=self.catalog, land_count=10, tier=3)
        second = MODULE.generate_deck("cmd", catalog=self.catalog, land_count=10, tier=3)
        self.assertEqual(first, second)
        self.assertEqual(first["status"], "validated")
        self.assertEqual(len(first["cards"]), 100)
        self.assertEqual(first["validation"]["land_count"]["actual"], 10)
        self.assertTrue(first["validation"]["color_identity_valid"])
        self.assertTrue(first["validation"]["singleton_valid"])
        self.assertTrue(all(item["oracle_id"] for item in first["cards"]))
        self.assertTrue(all(item["provenance"] for item in first["cards"]))

    def test_color_identity_is_rejected_without_fabricating_a_list(self):
        result = MODULE.generate_deck("cmd", catalog=self.catalog, colors="WUBRG", land_count=10)
        self.assertFalse(result["validation"]["color_identity_valid"])
        self.assertEqual(len(result["cards"]), 1)
        self.assertIn("Requested colors", result["warnings"][0])

    def test_unresolved_commander_is_reported(self):
        result = MODULE.generate_deck("A commander not in the catalog", catalog=self.catalog)
        self.assertEqual(result["cards"], [])
        self.assertFalse(result["validation"]["commander_resolved"])
        self.assertEqual(result["unresolved_candidates"][0]["reason"], "commander not found in local catalog")

    def test_local_database_filters_commander_and_tier(self):
        payload = {
            "format": "Commander", "decks": [
                {"id": "good", "name": "Cloud list", "commanders": ["cmd"], "tier": 4, "cards": [{"oracle_id": "ramp-0", "name": "Ramp 0", "count": 2}]},
                {"id": "other-format", "format": "Modern", "commanders": ["cmd"], "cards": [{"oracle_id": "draw-0", "name": "Draw 0"}]},
                {"id": "other-commander", "commanders": ["Someone Else"], "cards": [{"oracle_id": "draw-1", "name": "Draw 1"}]},
            ],
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "decks.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            adapter = MODULE.JsonDeckDatabaseAdapter(path)
            candidates = list(adapter.candidates(self.catalog.resolve(oracle_id="cmd"), constraints={}))
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0].card["oracle_id"], "ramp-0")
        self.assertEqual(candidates[0].tier, 4)
        self.assertEqual(candidates[0].score, 2)

    def test_edhrec_cache_does_not_use_network_and_preserves_rank(self):
        payload = {"cards": [{"name": "Ramp 0", "oracle_id": "ramp-0", "rank": 7, "num_decks": 42}]}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "edhrec-cache.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            adapter = MODULE.EdhrecAdapter(cache_path=path)
            with patch.object(MODULE, "urlopen", side_effect=AssertionError("network called")):
                candidates = list(adapter.candidates(self.catalog.resolve(oracle_id="cmd"), constraints={}))
        self.assertEqual(candidates[0].rank, 7)
        self.assertEqual(candidates[0].provenance["source"], str(path))

    def test_category_quota_shortfall_is_explicit(self):
        result = MODULE.generate_deck("cmd", catalog=self.catalog, land_count=10, category_quotas={"ramp": 20})
        self.assertTrue(any("Category quota ramp is short" in warning for warning in result["warnings"]))
        self.assertNotEqual(result["status"], "validated")


if __name__ == "__main__":
    unittest.main()
