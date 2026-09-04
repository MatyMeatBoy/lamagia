"""Small regression suite for the reusable Oracle-to-IR vocabulary."""

import unittest

from compile_oracle_effects import DEFAULT_COMMIT_CARD_LIMIT, classify, cluster_text, effective_worker_count, mana_ability_hint, operand_hints, primitive_cluster_inventory, search_criterion_hint, trigger_subject_hint
from export_set_coverage import product_group
from plan_primitive_roadmap import build_roadmap, claim_key, load_blocked_cards, template_of
from plan_primitive_workers import build_worker_plan


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

    def test_preserves_typed_sacrifice_operands_for_workers(self) -> None:
        result = classify("Sacrifice an artifact: Draw a card.")
        self.assertEqual(result["operands"]["sacrifice_types"], ["Artifact"])
        self.assertEqual(result["primitive_cluster"], "draw|activated|sacrifice-types:Artifact")

    def test_preserves_generic_permanent_trigger_subject(self) -> None:
        self.assertEqual(trigger_subject_hint("Whenever a permanent enters the battlefield under your control, draw a card."), "permanent-you-control")
        self.assertEqual(classify("Whenever a permanent enters the battlefield under your control, draw a card.")["trigger_subject"], "permanent-you-control")

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

    def test_builds_deterministic_cluster_first_queue(self) -> None:
        cards = [
            {"oracle_id": "b", "scryfall_id": "2", "name": "Beta", "primitive_clusters": ["search|subtype:Equipment"]},
            {"oracle_id": "a", "scryfall_id": "1", "name": "Alpha", "primitive_clusters": ["search|subtype:Equipment"]},
            {"oracle_id": "c", "scryfall_id": "3", "name": "Gamma", "primitive_clusters": ["destroy|target-types:Artifact"]},
        ]
        result = primitive_cluster_inventory(cards)
        self.assertEqual([item["cluster"] for item in result], ["search|subtype:Equipment", "destroy|target-types:Artifact"])
        self.assertEqual(result[0]["commit_batches"], 1)
        self.assertEqual([item["name"] for item in result[0]["cards"]], ["Alpha", "Beta"])
        self.assertEqual(DEFAULT_COMMIT_CARD_LIMIT, 20)
        self.assertEqual(
            primitive_cluster_inventory([
                {"oracle_id": str(index), "scryfall_id": str(index), "name": str(index), "primitive_clusters": ["batch"]}
                for index in range(21)
            ])[0]["commit_batches"],
            2,
        )

    def test_groups_supplemental_products_by_name_and_type(self) -> None:
        self.assertEqual(product_group("draft_innovation", "Jumpstart 2022", "2022-12-02"), "jumpstart")
        self.assertEqual(product_group("duel_deck", "Duel Decks: Elves vs. Goblins", "2007-11-16"), "duel-decks")
        self.assertEqual(product_group("promo", "Friday Night Magic 2013", "2013-01-01"), "promos")


class PrimitiveRoadmapTests(unittest.TestCase):
    def test_folds_only_the_parameters_a_primitive_varies_by(self) -> None:
        self.assertEqual(
            template_of("{2}{G}: ~ gets +3/+3 until end of turn."),
            "{cost}: ~ gets +<n>/+<n> until end of turn",
        )
        # Two costs and two sizes are the same engine work, so they share a queue entry.
        self.assertEqual(
            template_of("{1}: ~ gets +1/+1 until end of turn."),
            template_of("{4}{B}{B}: ~ gets +7/+7 until end of turn."),
        )

    def test_keeps_different_rules_work_in_different_templates(self) -> None:
        self.assertNotEqual(
            template_of("{2}: ~ gets +1/+1 until end of turn."),
            template_of("{2}: ~ gains flying until end of turn."),
        )

    def test_ranks_by_cards_finished_not_by_how_often_a_clause_appears(self) -> None:
        # `common` appears in every card but never finishes one on its own;
        # `finisher` appears twice and completes both of those cards.
        blocked = [
            {"oracle_id": "a", "name": "A", "templates": {"common", "finisher"}, "lines": ["common", "finisher"]},
            {"oracle_id": "b", "name": "B", "templates": {"common", "finisher"}, "lines": ["common", "finisher"]},
            {"oracle_id": "c", "name": "C", "templates": {"common", "other-1"}, "lines": ["common", "other-1"]},
            {"oracle_id": "d", "name": "D", "templates": {"common", "other-2"}, "lines": ["common", "other-2"]},
        ]
        roadmap = build_roadmap(blocked, top=2)
        self.assertEqual(roadmap[0]["template"], "common")
        self.assertEqual(roadmap[0]["blocks"], 4)
        # Nothing is finished by the first pick, but it is still scheduled first
        # because retiring it is what lets the next pick finish two cards.
        self.assertEqual(roadmap[0]["unlocks"], 0)
        self.assertEqual(roadmap[1]["template"], "finisher")
        self.assertEqual(roadmap[1]["unlocks"], 2)
        self.assertEqual(roadmap[1]["cumulative_unlocks"], 2)

    def test_counts_a_card_once_even_when_a_template_repeats(self) -> None:
        blocked = [{"oracle_id": "a", "name": "A", "templates": {"only"}, "lines": ["only", "only"]}]
        roadmap = build_roadmap(blocked, top=1)
        self.assertEqual(roadmap[0]["unlocks"], 1)
        self.assertEqual(roadmap[0]["blocks"], 1)

    def test_ignores_finished_cards_and_cards_with_no_recorded_blocker(self) -> None:
        blocked = load_blocked_cards(
            [
                {"oracle_id": "done", "name": "Done", "fullyImplemented": True, "unimplementedText": []},
                {"oracle_id": "bug", "name": "Bug", "fullyImplemented": False, "unimplementedText": []},
                {"oracle_id": "real", "name": "Real", "fullyImplemented": False, "unimplementedText": ["scry 2."]},
            ]
        )
        self.assertEqual([card["name"] for card in blocked], ["Real"])
        self.assertEqual(blocked[0]["templates"], {"scry <n>"})

    def test_claim_keys_stay_unique_for_similar_templates(self) -> None:
        taken: set[str] = set()
        first = claim_key("c14", "{cost}: ~ gets +<n>/+<n> until end of turn", taken)
        second = claim_key("c14", "{cost}: ~ gets +<n>/-<n> until end of turn", taken)
        self.assertNotEqual(first, second)

    def test_assigns_disjoint_primitives_with_commit_sized_batches(self) -> None:
        roadmap = [
            {
                "claim_key": "first",
                "template": "first",
                "family": "activated",
                "unlocks": 21,
                "unlocked_cards": [{"oracle_id": str(index)} for index in range(21)],
            },
            {
                "claim_key": "second",
                "template": "second",
                "family": "triggered",
                "unlocks": 2,
                "unlocked_cards": [{"oracle_id": "x"}, {"oracle_id": "y"}],
            },
        ]
        plan = build_worker_plan(
            roadmap,
            workers=5,
            memory_budget_gb=2,
            estimated_worker_mb=256,
            max_cards_per_commit=20,
            claim_prefix="c13",
            claimed_keys={"c13-second"},
        )
        self.assertEqual(plan["worker_count"], 5)
        self.assertEqual(plan["skipped_claims"], ["c13-second"])
        jobs = [job for worker in plan["workers"] for job in worker["jobs"]]
        self.assertEqual([job["claim_key"] for job in jobs], ["c13-first"])
        self.assertEqual([len(batch) for batch in jobs[0]["batches"]], [20, 1])
        self.assertEqual(len({job["claim_key"] for job in jobs}), len(jobs))

    def test_limits_workers_to_the_memory_budget(self) -> None:
        plan = build_worker_plan([], workers=8, memory_budget_gb=1, estimated_worker_mb=256)
        self.assertEqual(plan["worker_count"], 4)

if __name__ == "__main__":
    unittest.main()
