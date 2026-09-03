"""Small regression suite for the reusable Oracle-to-IR vocabulary."""

import unittest

from compile_oracle_effects import classify, cluster_text, effective_worker_count, mana_ability_hint, operand_hints, search_criterion_hint
from export_set_coverage import product_group


class OracleCompilerTests(unittest.TestCase):
    def test_preserves_open_subtype_for_steelshapers_gift(self) -> None:
        self.assertEqual(
            search_criterion_hint(
                "Search your library for an Equipment card, reveal it, then shuffle."
            ),
            {"types": [], "subtypes": ["Equipment"]},
        )

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

    def test_groups_supplemental_products_by_name_and_type(self) -> None:
        self.assertEqual(product_group("draft_innovation", "Jumpstart 2022", "2022-12-02"), "jumpstart")
        self.assertEqual(product_group("duel_deck", "Duel Decks: Elves vs. Goblins", "2007-11-16"), "duel-decks")
        self.assertEqual(product_group("promo", "Friday Night Magic 2013", "2013-01-01"), "promos")


if __name__ == "__main__":
    unittest.main()
