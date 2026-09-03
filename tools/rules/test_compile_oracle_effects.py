"""Small regression suite for the reusable Oracle-to-IR vocabulary."""

import unittest

from compile_oracle_effects import classify, search_criterion_hint
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

    def test_keeps_multiple_target_types(self) -> None:
        result = classify("Destroy target artifact, enchantment, or land.")
        self.assertEqual(result["target_types"], ["Artifact", "Enchantment", "Land"])
        self.assertIsNone(result["target_subtype"])

    def test_groups_supplemental_products_by_name_and_type(self) -> None:
        self.assertEqual(product_group("draft_innovation", "Jumpstart 2022"), "jumpstart")
        self.assertEqual(product_group("duel_deck", "Duel Decks: Elves vs. Goblins"), "duel-decks")
        self.assertEqual(product_group("promo", "Friday Night Magic 2013"), "promos")


if __name__ == "__main__":
    unittest.main()
