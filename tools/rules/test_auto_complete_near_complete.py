import json
import tempfile
import unittest
from pathlib import Path

from auto_complete_near_complete import (
    completed_candidates,
    plan_batches,
    select_batches,
    unresolved_candidates,
    verify_plan,
)


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
            ("Destroy target attacking creature.", "destroy-target-permanent"),
            ("Destroy target tapped creature.", "tapped-creature"),
        ]):
            for index in range(5):
                payload["profiles"].append({
                    "name": f"{template}-{index}",
                    "oracle_id": f"{primitive}-{index}",
                    "oracle_text": template,
                    "fullyImplemented": False,
                    "effects": [{"kind": primitive}],
                    "unimplementedText": [template],
                })
        groups = select_batches(payload, sample_size=5, max_groups=2)
        self.assertEqual(len(groups), 2)
        self.assertTrue(all(len(group["cards"]) == 5 for group in groups))
        ids = [card["oracle_id"] for group in groups for card in group["cards"]]
        self.assertEqual(len(ids), len(set(ids)))

    def test_completed_rows_never_fill_a_new_card_batch(self) -> None:
        payload = {"profiles": [
            {
                "name": "Already Done",
                "oracle_id": "done",
                "oracle_text": "Destroy target attacking creature.",
                "fullyImplemented": True,
                "effects": [{"kind": "destroy-target-permanent"}],
                "unimplementedText": [],
            }
        ]}
        with self.assertRaisesRegex(RuntimeError, "unresolved one-line"):
            select_batches(payload, sample_size=1, max_groups=1, template="Destroy target attacking creature.")

    def test_plan_verification_uses_the_same_oracle_ids(self) -> None:
        before = {"profiles": []}
        for index in range(5):
            before["profiles"].append({
                "name": f"Target {index}",
                "oracle_id": f"target-{index}",
                "scryfall_id": f"sf-{index}",
                "oracle_text": "Destroy target attacking creature.",
                "fullyImplemented": False,
                "effects": [{"kind": "destroy-target-permanent"}],
                "unimplementedText": ["Destroy target attacking creature."],
            })
        after = json.loads(json.dumps(before))
        for row in after["profiles"]:
            row["fullyImplemented"] = True
            row["unimplementedText"] = []
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            profiles = root / "engine-card-profiles.json"
            plan_path = root / "plan.json"
            report_path = root / "verification.json"
            profiles.write_text(json.dumps(before), encoding="utf-8")
            plan = plan_batches(profiles, sample_size=5, max_groups=1, template="Destroy target attacking creature.", output=plan_path)
            self.assertEqual([card["oracle_id"] for card in plan["groups"][0]["cards"]], [f"target-{index}" for index in range(5)])
            profiles.write_text(json.dumps(after), encoding="utf-8")
            report = verify_plan(profiles, plan_path, refresh=False, output=report_path)
            self.assertTrue(report["passed"])
            self.assertEqual(sum(len(group["cards"]) for group in report["groups"]), 5)


if __name__ == "__main__":
    unittest.main()
