import unittest

from auto_complete_near_complete import completed_candidates, unresolved_candidates


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


if __name__ == "__main__":
    unittest.main()
