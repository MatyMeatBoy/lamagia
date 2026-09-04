"""Small regression suite for the reusable Oracle-to-IR vocabulary."""

import json
import tempfile
import unittest
from pathlib import Path

from compile_oracle_effects import DEFAULT_COMMIT_CARD_LIMIT, ORACLE_IR_PARSER_VERSION, card_fingerprint, classify, cluster_text, effective_worker_count, load_card_cache, mana_ability_hint, operand_hints, primitive_cluster_inventory, save_card_cache, search_criterion_hint
from export_set_coverage import product_group
from plan_primitive_workers import plan_workers


class OracleCompilerTests(unittest.TestCase):
    def test_preserves_open_subtype_for_steelshapers_gift(self) -> None:
        self.assertEqual(
            search_criterion_hint(
                "Search your library for an Equipment card, reveal it, then shuffle."
            ),
            {"types": [], "subtypes": ["Equipment"]},
        )

    def test_preserves_search_filters_after_card_type(self) -> None:
        self.assertEqual(
            search_criterion_hint(
                "Search your library for a land card with a basic land type, put it onto the battlefield tapped, then shuffle."
            ),
            {"types": ["land"], "subtypes": ["Basic"]},
        )

    def test_normalizes_inflected_actions_and_plural_types(self) -> None:
        result = classify("Target player sacrifices artifacts and creatures.")
        self.assertIn("sacrifice", result["families"])
        self.assertEqual(result["target_types"], ["Artifact", "Creature"])

    def test_separates_target_subtype_from_zone(self) -> None:
        result = classify("Exile target Equipment from the battlefield.")
        self.assertEqual(result["target_subtype"], "Equipment")
        self.assertEqual(result["target_types"], [])
        self.assertEqual(result["target_zone"], "battlefield")

    def test_reuses_action_zone_type_and_subtype_operands(self) -> None:
        result = classify("Exile target Equipment from the battlefield.")
        self.assertEqual(result["operands"], {
            "actions": ["exile"],
            "zones": ["battlefield"],
            "card_types": [],
            "subtypes": ["Equipment"],
        })
        self.assertEqual(
            operand_hints("Search your library for an Equipment card.", None, {"types": [], "subtypes": ["Equipment"]}),
            {"actions": ["search-library"], "zones": ["library"], "card_types": [], "subtypes": ["Equipment"]},
        )

    def test_keeps_multiple_target_types(self) -> None:
        result = classify("Destroy target artifact, enchantment, or land.")
        self.assertEqual(result["target_types"], ["Artifact", "Enchantment", "Land"])
        self.assertIsNone(result["target_subtype"])
        self.assertEqual(result["primitive_cluster"], "destroy|static-or-spell|target-types:Artifact,Enchantment,Land|zone:battlefield")

    def test_emits_reusable_search_cluster_for_many_cards(self) -> None:
        result = classify("Search your library for an Equipment card, reveal it, then shuffle.")
        self.assertEqual(result["primitive_cluster"], "search-library|static-or-spell|search:Equipment")

    def test_bounds_open_cluster_shape(self) -> None:
        self.assertEqual(cluster_text("Pay {2}{G}, then do something unusual."), "pay {cost}, then do something unusual")
        self.assertEqual(cluster_text("Choose one �"), "choose <n> <mode>")

    def test_treats_supported_keyword_lines_as_known_primitives(self) -> None:
        result = classify("Flying, vigilance")
        self.assertTrue(result["keyword_only"])
        self.assertTrue(result["candidate"])

    def test_reuses_mana_side_effect_and_restriction_primitives(self) -> None:
        self.assertEqual(
            mana_ability_hint("{T}: Add {C}. You gain 1 life."),
            {
                "text": "{T}: Add {C}. You gain 1 life.",
                "cost": "{T}",
                "produced_symbols": ["C"],
                "side_effects": [{"kind": "gain-life", "amount": 1}],
                "restrictions": [],
            },
        )
        result = mana_ability_hint("{T}: Add {C}{C}. Activate only if you control five or more lands.")
        self.assertEqual(result["produced_symbols"], ["C", "C"])
        self.assertEqual(result["restrictions"], [{"kind": "control-lands", "minimum": 5}])

    def test_bounds_parallel_batch_to_memory_budget(self) -> None:
        self.assertEqual(effective_worker_count(5, 2, 256), 5)
        self.assertEqual(effective_worker_count(8, 1, 256), 4)

    def test_incremental_cache_round_trips_and_invalidates_parser_version(self) -> None:
        row = {"id": "1", "oracle_id": "oracle-1", "name": "Test", "mana_cost": "{U}", "type_line": "Instant", "oracle_text": "Draw a card."}
        entry = {"fingerprint": card_fingerprint(row), "card": {"oracle_id": "oracle-1", "status": "candidate"}}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cache.json"
            save_card_cache(path, {"oracle-1": entry})
            self.assertEqual(load_card_cache(path)["oracle-1"], entry)
            path.write_text(json.dumps({"format": "prossh-oracle-card-cache/v1", "parser_version": "old", "cards": {"oracle-1": entry}}), encoding="utf-8")
            self.assertEqual(load_card_cache(path), {})
        self.assertEqual(ORACLE_IR_PARSER_VERSION, "v5")

    def test_excludes_known_closed_static_primitives_from_review(self) -> None:
        for text in (
            "This land enters tapped.",
            "Cycling {2}",
            "Equip {3}",
            "Level up {1}{G}",
            "LEVEL 3+",
            "2/4",
            "Choose one —",
        ):
            result = classify(text)
            self.assertTrue(result["known_static"])
            self.assertTrue(result["candidate"])

    def test_builds_deterministic_cluster_first_queue(self) -> None:
        cards = [
            {"oracle_id": "b", "scryfall_id": "2", "name": "Beta", "primitive_clusters": ["search|subtype:Equipment"]},
            {"oracle_id": "a", "scryfall_id": "1", "name": "Alpha", "primitive_clusters": ["search|subtype:Equipment"]},
            {"oracle_id": "c", "scryfall_id": "3", "name": "Gamma", "primitive_clusters": ["destroy|target-types:Artifact"]},
        ]
        result = primitive_cluster_inventory(cards)
        self.assertEqual([item["cluster"] for item in result], ["search|subtype:Equipment", "destroy|target-types:Artifact"])
        self.assertEqual(result[0]["commit_batches"], 1)
        self.assertEqual(result[0]["examples"], [])
        self.assertEqual([item["name"] for item in result[0]["cards"]], ["Alpha", "Beta"])
        self.assertEqual(DEFAULT_COMMIT_CARD_LIMIT, 20)
        self.assertEqual(
            primitive_cluster_inventory([
                {"oracle_id": str(index), "scryfall_id": str(index), "name": str(index), "primitive_clusters": ["batch"]}
                for index in range(21)
            ])[0]["commit_batches"],
            2,
        )
        self.assertEqual(
            primitive_cluster_inventory([
                {"oracle_id": str(index), "scryfall_id": str(index), "name": str(index), "primitive_clusters": ["batch"]}
                for index in range(21)
            ], commit_card_limit=10)[0]["commit_batches"],
            3,
        )

    def test_groups_supplemental_products_by_name_and_type(self) -> None:
        self.assertEqual(product_group("draft_innovation", "Jumpstart 2022", "2022-12-02"), "jumpstart")
        self.assertEqual(product_group("duel_deck", "Duel Decks: Elves vs. Goblins", "2007-11-16"), "duel-decks")
        self.assertEqual(product_group("promo", "Friday Night Magic 2013", "2013-01-01"), "promos")

    def test_plans_disjoint_worker_clusters(self) -> None:
        clusters = [
            {"cluster": "a", "card_count": 4, "commit_batches": 1, "examples": ["A"], "cards": []},
            {"cluster": "b", "card_count": 3, "commit_batches": 1, "examples": ["B"], "cards": []},
            {"cluster": "c", "card_count": 2, "commit_batches": 1, "examples": ["C"], "cards": []},
        ]
        plan = plan_workers(clusters, worker_count=2)
        self.assertEqual([entry["cluster"] for entry in plan], ["a", "b"])
        self.assertEqual(plan_workers(clusters, worker_count=2, offset=2)[0]["cluster"], "c")


if __name__ == "__main__":
    unittest.main()
