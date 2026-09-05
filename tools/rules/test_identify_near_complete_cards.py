import unittest

try:
    from identify_near_complete_cards import build_index
except ModuleNotFoundError:
    from tools.rules.identify_near_complete_cards import build_index


class NearCompleteCardsTest(unittest.TestCase):
    def setUp(self):
        self.snapshot = {
            "fields": {"draw", "sacrificesSelf", "targetKind"},
            "effects": {"draw", "sacrifice-source"},
            "helpers": {"drawCards", "applyEffect"},
        }

    def test_only_exactly_one_unresolved_line_is_selected(self):
        result = build_index(
            [
                {
                    "name": "Reusable Draw",
                    "oracle_id": "draw-id",
                    "scryfall_id": "draw-print",
                    "oracle_text": "Draw a card.",
                    "fullyImplemented": False,
                    "unimplementedText": ["Draw a card."],
                },
                {
                    "name": "Two Lines",
                    "oracle_id": "two-id",
                    "oracle_text": "Draw two cards. Sacrifice a creature.",
                    "fullyImplemented": False,
                    "unimplementedText": ["Draw two cards.", "Sacrifice a creature."],
                },
                {
                    "name": "Complete",
                    "oracle_id": "complete-id",
                    "fullyImplemented": True,
                    "unimplementedText": [],
                },
            ],
            snapshot=self.snapshot,
        )
        self.assertEqual(result["card_count"], 1)
        self.assertEqual(result["cards"][0]["oracle_id"], "draw-id")
        self.assertEqual(result["cards"][0]["priority"], "reuse-existing")
        self.assertEqual(result["cards"][0]["reusable_primitives"][0]["primitive"], "draw / discard")

    def test_unmatched_operation_is_explicitly_new_review(self):
        result = build_index(
            [
                {
                    "name": "Unknown",
                    "oracle_id": "unknown-id",
                    "oracle_text": "Roll a six-sided die.",
                    "fullyImplemented": False,
                    "unimplementedText": ["Roll a six-sided die."],
                }
            ],
            snapshot=self.snapshot,
        )
        self.assertEqual(result["cards"][0]["priority"], "needs-new-primitive")
        self.assertEqual(result["new_primitive_count"], 1)


if __name__ == "__main__":
    unittest.main()
