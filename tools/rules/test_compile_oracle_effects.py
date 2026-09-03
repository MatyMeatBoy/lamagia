"""Small regression suite for the reusable Oracle-to-IR vocabulary."""

import unittest

from compile_oracle_effects import classify, search_criterion_hint


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


if __name__ == "__main__":
    unittest.main()
