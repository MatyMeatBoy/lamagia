import unittest

from auto_complete_near_complete import completed_candidates, select_batches, unresolved_candidates


class AutoCompleteNearCompleteTests(unittest.TestCase):
    def test_selects_only_single_line_safe_candidates(self) -> None:
        payload = {
            "profiles": [
                {
                    "name": "Act of Treason",
                    "oracle_id": "act",
                    "fullyImplemented": False,
                    "unimplementedText": ["Gain control of target creature until end of turn."],
                },
                {
                    "name": "Complex Card",
                    "oracle_id": "complex",
                    "fullyImplemented": False,
                    "unimplementedText": ["Gain control of target creature until end of turn.", "Draw a card."],
                },
            ]
        }
        self.assertEqual([row["oracle_id"] for row in unresolved_candidates(payload)], ["act"])

    def test_completed_candidates_require_the_shared_primitive(self) -> None:
        payload = {
            "profiles": [
                {
                    "name": "Act of Treason",
                    "oracle_id": "act",
                    "oracle_text": "Gain control of target creature until end of turn.",
                    "fullyImplemented": True,
                    "effects": [{"kind": "gain-control-target-until-end-of-turn"}],
                    "unimplementedText": [],
                },
                {
                    "name": "Unsafe Card",
                    "oracle_id": "unsafe",
                    "oracle_text": "Gain control of target creature until end of turn.",
                    "fullyImplemented": True,
                    "effects": [],
                    "unimplementedText": [],
                },
            ]
        }
        self.assertEqual([row["oracle_id"] for row in completed_candidates(payload)], ["act"])

    def test_batches_are_disjoint_and_keep_five_cards_per_family(self) -> None:
        payload = {"profiles": []}
        for template, primitive in list([
            ("Draw a card.", "draw"),
            ("Gain 3 life.", "gain-life"),
        ]):
            for index in range(5):
                payload["profiles"].append({
                    "name": f"{template}-{index}",
                    "oracle_id": f"{primitive}-{index}",
                    "oracle_text": template,
                    "fullyImplemented": True,
                    "effects": [{"kind": primitive}],
                    "unimplementedText": [],
                })
        groups = select_batches(payload, sample_size=5, max_groups=2)
        self.assertEqual(len(groups), 2)
        self.assertTrue(all(len(group["cards"]) == 5 for group in groups))
        ids = [card["oracle_id"] for group in groups for card in group["cards"]]
        self.assertEqual(len(ids), len(set(ids)))


if __name__ == "__main__":
    unittest.main()
