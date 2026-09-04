import unittest

from plan_primitive_workers import build_worker_plan


class WorkerPlanReviewPriorityTests(unittest.TestCase):
    def test_needs_review_jobs_are_scheduled_before_broad_work(self) -> None:
        roadmap = [
            {
                "claim_key": "broad",
                "template": "broad clause",
                "family": "other",
                "affected_cards": [{"oracle_id": "broad-id", "name": "Broad"}],
                "unlocks": 4,
            },
            {
                "claim_key": "review",
                "template": "review clause",
                "family": "other",
                "affected_cards": [{"oracle_id": "review-id", "name": "Review"}],
                "one_line_cards": [{"oracle_id": "review-id", "name": "Review"}],
                "one_line_count": 1,
                "unlocks": 1,
            },
        ]

        plan = build_worker_plan(
            roadmap,
            workers=1,
            memory_budget_gb=1,
            estimated_worker_mb=256,
            oracle_review_ids={"review-id"},
        )

        jobs = plan["workers"][0]["jobs"]
        self.assertEqual(jobs[0]["claim_key"], "review")
        self.assertEqual(jobs[0]["priority"], "needs-review")
        self.assertEqual(jobs[0]["needs_review_count"], 1)
        self.assertEqual(jobs[0]["one_line_count"], 1)

    def test_overlapping_review_jobs_remain_one_worker_unit(self) -> None:
        roadmap = [
            {
                "claim_key": "first",
                "template": "first clause",
                "affected_cards": [{"oracle_id": "shared", "name": "Shared"}],
                "one_line_cards": [{"oracle_id": "shared", "name": "Shared"}],
                "one_line_count": 1,
            },
            {
                "claim_key": "second",
                "template": "second clause",
                "affected_cards": [{"oracle_id": "shared", "name": "Shared"}],
                "one_line_cards": [{"oracle_id": "shared", "name": "Shared"}],
                "one_line_count": 1,
            },
        ]

        plan = build_worker_plan(roadmap, workers=2, oracle_review_ids={"shared"})

        non_empty = [worker for worker in plan["workers"] if worker["jobs"]]
        self.assertEqual(len(non_empty), 1)
        self.assertEqual(len(non_empty[0]["jobs"]), 2)

    def test_compositional_atoms_annotate_without_changing_assignment(self) -> None:
        plan = build_worker_plan(
            [{
                "claim_key": "draw",
                "template": "draw clause",
                "affected_cards": [{"oracle_id": "draw-id", "name": "Draw"}],
                "unlocks": 1,
            }],
            workers=1,
            semantic_atoms_by_oracle={"draw-id": {"op:draw", "target:player", "zone:hand"}},
        )
        job = plan["workers"][0]["jobs"][0]
        self.assertEqual(job["claim_key"], "draw")
        self.assertEqual(job["semantic_atoms"], ["op:draw", "target:player", "zone:hand"])


if __name__ == "__main__":
    unittest.main()
