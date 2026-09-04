import unittest

from build_primitive_dictionary import code_snapshot, render_one_line_queue


class PrimitiveDictionaryTests(unittest.TestCase):
    def test_snapshot_finds_reusable_fields_and_handlers(self) -> None:
        snapshot = code_snapshot(
            'readonly sacrificesCreature?: "any" | "another"; kind: "damage-any-target";',
            'function applyEffect() {} case "damage-any-target": {}',
        )
        self.assertIn("sacrificesCreature", snapshot["fields"])
        self.assertIn("applyEffect", snapshot["helpers"])
        self.assertIn("damage-any-target", snapshot["effects"])

    def test_one_line_queue_groups_cards_by_template(self) -> None:
        profiles = [
            {"name": "A", "fullyImplemented": False, "unimplementedText": ["Draw two cards."]},
            {"name": "B", "fullyImplemented": False, "unimplementedText": ["Draw two cards."]},
            {"name": "C", "fullyImplemented": False, "unimplementedText": ["Draw two cards.", "Flying"]},
        ]
        output = "\n".join(render_one_line_queue(profiles, {"draw <n> cards": "draw-cards"}, "C13"))
        self.assertIn("2** unfinished cards", output)
        self.assertIn("A, B", output)
        self.assertIn("c13-draw-cards", output)


if __name__ == "__main__":
    unittest.main()
