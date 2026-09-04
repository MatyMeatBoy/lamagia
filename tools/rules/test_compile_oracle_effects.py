"""Small regression suite for the reusable Oracle-to-IR vocabulary."""

import json
import tempfile
import unittest
from pathlib import Path

from compile_oracle_effects import DEFAULT_COMMIT_CARD_LIMIT, ORACLE_IR_PARSER_VERSION, card_fingerprint, classify, cluster_text, delayed_draw_hint, effective_worker_count, graveyard_static_hint, load_card_cache, look_top_hint, mana_ability_hint, operand_hints, primitive_cluster_inventory, reveal_until_type_hint, save_card_cache, search_criterion_hint, top_card_reveal_hint, trigger_subject_hint
from export_set_coverage import is_ignored_edition, product_group
from check_precon_coverage import identity_of
from plan_primitive_roadmap import build_roadmap, claim_key, deck_oracle_ids, load_blocked_cards, resolve_claim_prefix, select_profiles, template_of
from plan_primitive_workers import DEFAULT_INTEGRATION_COMMIT_THRESHOLD, build_worker_plan, load_claimed_keys, plan_workers
from compile_oracle_effects import return_target_hint


class OracleCompilerTests(unittest.TestCase):
    def test_precon_identity_prefers_oracle_id_over_printing(self) -> None:
        self.assertEqual(identity_of({"oracle_id": "oracle", "scryfall_id": "printing"}), "oracle")
        self.assertEqual(identity_of({"scryfall_id": "printing"}), "printing")

    def test_reuses_top_card_reveal_and_mana_value_operands(self) -> None:
        reveal = "Whenever this creature deals combat damage to a player, reveal the top card of your library and put that card into your hand."
        result = classify(reveal)
        self.assertTrue(top_card_reveal_hint(reveal))
        self.assertTrue(result["top_card_reveal"])
        self.assertIn("reveal-top:hand", result["primitive_cluster"])
        amount = classify("You gain life equal to its mana value.")
        self.assertTrue(amount["mana_value_dependency"])
        self.assertIn("amount:mana-value", amount["primitive_cluster"])

    def test_extracts_reveal_until_type_operands(self) -> None:
        clause = "If you do, reveal cards from the top of your library until you reveal a creature card. Put that card into your hand and the rest into your graveyard."
        result = classify(clause)
        self.assertEqual(reveal_until_type_hint(clause), "Creature")
        self.assertEqual(result["reveal_until_type"], "Creature")
        self.assertIn("reveal-until:Creature:hand:graveyard", result["primitive_cluster"])

    def test_preserves_open_subtype_for_steelshapers_gift(self) -> None:
        self.assertEqual(
            search_criterion_hint(
                "Search your library for an Equipment card, reveal it, then shuffle."
            ),
            {"types": [], "subtypes": ["Equipment"]},
        )

    def test_preserves_search_filters_after_card_type(self) -> None:
        self.assertEqual(
            search_criterion_hint(
                "Search your library for a land card with a basic land type, put it onto the battlefield tapped, then shuffle."
            ),
            {"types": ["land"], "subtypes": ["Basic"]},
        )

    def test_normalizes_inflected_actions_and_plural_types(self) -> None:
        result = classify("Target player sacrifices artifacts and creatures.")
        self.assertIn("sacrifice", result["families"])
        self.assertEqual(result["target_types"], ["Artifact", "Creature"])

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
            "effect_actions": ["exile"],
        })
        self.assertEqual(
            operand_hints("Search your library for an Equipment card.", None, {"types": [], "subtypes": ["Equipment"]}),
            {"actions": ["search-library"], "zones": ["library"], "card_types": [], "subtypes": ["Equipment"], "effect_actions": ["search-library"]},
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
        self.assertEqual(result["primitive_cluster"], "draw|activated|sacrifice-types:Artifact|cost-context:activated-cost|cost-actions:sacrifice")

    def test_memoizes_repeated_clause_classification(self) -> None:
        classify.cache_clear()
        clause = "Whenever a creature enters the battlefield under your control, draw a card."
        first = classify(clause)
        second = classify(clause)
        self.assertIs(first, second)
        self.assertEqual(classify.cache_info().hits, 1)

    def test_preserves_generic_permanent_trigger_subject(self) -> None:
        self.assertEqual(trigger_subject_hint("Whenever a permanent enters the battlefield under your control, draw a card."), "permanent-you-control")
        self.assertEqual(classify("Whenever a permanent enters the battlefield under your control, draw a card.")["trigger_subject"], "permanent-you-control")

    def test_preserves_activated_cost_actions(self) -> None:
        result = classify("{T}, Discard a card: Draw a card.")
        self.assertEqual(result["operands"]["cost_actions"], ["discard"])
        self.assertEqual(result["primitive_cluster"], "draw|activated|discard-card-cost:1|cost-context:activated-cost|cost-actions:discard")
        self.assertEqual(result["operands"]["effect_actions"], ["draw"])

    def test_groups_combined_activated_costs_without_losing_type(self) -> None:
        result = classify("Sacrifice an artifact, Discard a card: Draw a card.")
        self.assertEqual(result["operands"]["cost_actions"], ["discard", "sacrifice"])
        self.assertEqual(result["operands"]["sacrifice_types"], ["Artifact"])

    def test_preserves_player_spell_trigger_subjects(self) -> None:
        self.assertEqual(trigger_subject_hint("Whenever an opponent casts a spell, draw a card."), "opponent")

    def test_preserves_delayed_draw_amount_and_optionality(self) -> None:
        self.assertEqual(
            delayed_draw_hint("Its controller may draw up to two cards at the beginning of the next turn's upkeep."),
            {"optional": True, "max_amount": 2},
        )
        result = classify("You draw a card at the beginning of the next turn's upkeep.")
        self.assertEqual(result["delayed_draw"], {"optional": False, "amount": 1})
        self.assertIn("delayed-draw:mandatory:1", result["primitive_cluster"])

    def test_preserves_look_top_amount_and_card_types(self) -> None:
        clause = "When Augur of Bolas enters the battlefield, look at the top three cards of your library. You may reveal an instant or sorcery card from among them and put it into your hand. Put the rest on the bottom of your library in any order."
        self.assertEqual(look_top_hint(clause), {
            "amount": 3,
            "types": ["instant", "sorcery"],
            "destination": "hand",
            "rest_destination": "bottom",
        })
        result = classify(clause)
        self.assertEqual(result["look_top"]["amount"], 3)
        self.assertIn("look-top:3:instant,sorcery:hand:bottom", result["primitive_cluster"])

    def test_preserves_permanent_graveyard_return_target(self) -> None:
        clause = "Return target permanent card from your graveyard to the battlefield."
        self.assertEqual(return_target_hint(clause), "permanent-card-in-your-graveyard")
        self.assertEqual(classify(clause)["return_target"], "permanent-card-in-your-graveyard")

    def test_preserves_graveyard_static_zone_and_land_subtype(self) -> None:
        clause = "As long as this card is in your graveyard and you control an Island, creatures you control have flying."
        self.assertEqual(graveyard_static_hint(clause), {
            "source_zone": "graveyard",
            "requires_controlled_land_subtype": "Island",
            "keyword": "flying",
        })
        result = classify(clause)
        self.assertTrue(result["known_static"])
        self.assertIn("source-zone:graveyard", result["primitive_cluster"])
        self.assertIn("requires-land-subtype:Island", result["primitive_cluster"])

    def test_bounds_open_cluster_shape(self) -> None:
        self.assertEqual(cluster_text("Pay {2}{G}, then do something unusual."), "pay {cost}, then do something unusual")
        self.assertEqual(cluster_text("Choose one �"), "choose <n> <mode>")

    def test_treats_supported_keyword_lines_as_known_primitives(self) -> None:
        result = classify("Flying, vigilance")
        self.assertTrue(result["keyword_only"])
        self.assertTrue(result["candidate"])

    def test_preserves_choose_one_or_both_as_a_modal_operand(self) -> None:
        result = classify("Choose one or both —")
        self.assertTrue(result["modal"])
        self.assertEqual(result["modal_mode"], "one-or-both")
        self.assertIn("modal-mode:one-or-both", result["primitive_cluster"])

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

    def test_incremental_cache_round_trips_and_invalidates_parser_version(self) -> None:
        row = {"id": "1", "oracle_id": "oracle-1", "name": "Test", "mana_cost": "{U}", "type_line": "Instant", "oracle_text": "Draw a card."}
        entry = {"fingerprint": card_fingerprint(row), "card": {"oracle_id": "oracle-1", "status": "candidate"}}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cache.json"
            save_card_cache(path, {"oracle-1": entry})
            self.assertEqual(load_card_cache(path)["oracle-1"], entry)
            path.write_text(json.dumps({"format": "prossh-oracle-card-cache/v1", "parser_version": "old", "cards": {"oracle-1": entry}}), encoding="utf-8")
            self.assertEqual(load_card_cache(path), {})
        self.assertEqual(ORACLE_IR_PARSER_VERSION, "v10")

    def test_separates_discard_activation_cost_from_discard_effect(self) -> None:
        result = classify("{T}, Discard a card: Draw a card.")
        self.assertEqual(result["operands"]["discard_card_count"], 1)
        self.assertEqual(result["primitive_cluster"], "draw|activated|discard-card-cost:1|cost-context:activated-cost|cost-actions:discard")
        self.assertEqual(classify("Target opponent discards a card.")["operands"]["effect_actions"], ["discard"])
        self.assertNotIn("discard_card_count", classify("Discard a card.")["operands"])

    def test_recognizes_discard_as_an_additional_cast_cost(self) -> None:
        result = classify("As an additional cost to cast this spell, discard a card.")
        self.assertEqual(result["operands"]["discard_card_count"], 1)
        self.assertIn("discard-card-cost:1", result["primitive_cluster"])
        self.assertNotIn("discard_card_count", classify("Target opponent discards a card.")["operands"])
        self.assertEqual(classify("As an additional cost to cast this spell, discard a card.")["operands"]["cost_actions"], ["discard"])
        self.assertNotIn("effect_actions", classify("As an additional cost to cast this spell, discard a card.")["operands"])

    def test_excludes_known_closed_static_primitives_from_review(self) -> None:
        for text in (
            "This land enters tapped.",
            "Cycling {2}",
            "Equip {3}",
            "Level up {1}{G}",
            "LEVEL 3+",
            "2/4",
            "Choose one —",
            "This creature can't be blocked.",
        ):
            result = classify(text)
            self.assertTrue(result["known_static"])
            self.assertTrue(result["candidate"])

    def test_builds_deterministic_cluster_first_queue(self) -> None:
        cards = [
            {"oracle_id": "b", "scryfall_id": "2", "name": "Beta", "primitive_clusters": ["search|subtype:Equipment"]},
            {"oracle_id": "a", "scryfall_id": "1", "name": "Alpha", "primitive_clusters": ["search|subtype:Equipment"]},
            {"oracle_id": "c", "scryfall_id": "3", "name": "Gamma", "primitive_clusters": ["destroy|target-types:Artifact"]},
        ]
        result = primitive_cluster_inventory(cards)
        self.assertEqual([item["cluster"] for item in result], ["search|subtype:Equipment", "destroy|target-types:Artifact"])
        self.assertEqual(result[0]["commit_batches"], 1)
        self.assertEqual(result[0]["examples"], [])
        self.assertEqual([item["name"] for item in result[0]["cards"]], ["Alpha", "Beta"])
        self.assertEqual(DEFAULT_COMMIT_CARD_LIMIT, 20)
        self.assertEqual(
            primitive_cluster_inventory([
                {"oracle_id": str(index), "scryfall_id": str(index), "name": str(index), "primitive_clusters": ["batch"]}
                for index in range(21)
            ])[0]["commit_batches"],
            2,
        )
        self.assertEqual(
            primitive_cluster_inventory([
                {"oracle_id": str(index), "scryfall_id": str(index), "name": str(index), "primitive_clusters": ["batch"]}
                for index in range(21)
            ], commit_card_limit=10)[0]["commit_batches"],
            3,
        )

    def test_groups_supplemental_products_by_name_and_type(self) -> None:
        self.assertEqual(product_group("draft_innovation", "Jumpstart 2022", "2022-12-02"), "jumpstart")
        self.assertEqual(product_group("duel_deck", "Duel Decks: Elves vs. Goblins", "2007-11-16"), "duel-decks")
        self.assertEqual(product_group("promo", "Friday Night Magic 2013", "2013-01-01"), "promos")

    def test_excludes_arena_only_and_un_sets_from_active_coverage(self) -> None:
        self.assertTrue(is_ignored_edition("ydsk", "alchemy", "Alchemy: Duskmourn"))
        self.assertTrue(is_ignored_edition("unf", "funny", "Unfinity"))
        self.assertFalse(is_ignored_edition("c13", "commander", "Commander 2013"))

    def test_plans_disjoint_worker_clusters(self) -> None:
        clusters = [
            {"cluster": "a", "card_count": 4, "commit_batches": 1, "examples": ["A"], "cards": []},
            {"cluster": "b", "card_count": 3, "commit_batches": 1, "examples": ["B"], "cards": []},
            {"cluster": "c", "card_count": 2, "commit_batches": 1, "examples": ["C"], "cards": []},
        ]
        plan = plan_workers(clusters, worker_count=2)
        self.assertEqual([entry["cluster"] for entry in plan], ["a", "b"])
        self.assertEqual(plan_workers(clusters, worker_count=2, offset=2)[0]["cluster"], "c")

    def test_worker_plan_carries_batch_integration_threshold(self) -> None:
        plan = build_worker_plan([], workers=5, memory_budget_gb=2)
        self.assertEqual(plan["min_integration_commits"], DEFAULT_INTEGRATION_COMMIT_THRESHOLD)
        self.assertEqual(DEFAULT_INTEGRATION_COMMIT_THRESHOLD, 11)

    def test_worker_plan_accepts_oracle_cluster_schema_without_collapsing_keys(self) -> None:
        plan = build_worker_plan([
            {"cluster": "search-library|static-or-spell|search:Equipment", "card_count": 2,
             "cards": [{"oracle_id": "a"}, {"oracle_id": "b"}]},
        ], workers=1, memory_budget_gb=2)
        job = plan["workers"][0]["jobs"][0]
        self.assertEqual(job["claim_key"], "search-library|static-or-spell|search:Equipment")
        self.assertEqual(job["family"], "search-library")
        self.assertEqual(job["oracle_ids"], ["a", "b"])

    def test_worker_plan_colocates_overlapping_oracle_ids(self) -> None:
        plan = build_worker_plan([
            {"cluster": "search-library|equipment", "cards": [{"oracle_id": "shared"}, {"oracle_id": "a"}]},
            {"cluster": "exile|equipment", "cards": [{"oracle_id": "shared"}, {"oracle_id": "b"}]},
            {"cluster": "draw", "cards": [{"oracle_id": "c"}]},
        ], workers=2, memory_budget_gb=2)
        owners = {
            oracle_id: worker["worker"]
            for worker in plan["workers"]
            for job in worker["jobs"]
            for oracle_id in job["oracle_ids"]
            if oracle_id in {"shared", "a", "b"}
        }
        self.assertEqual({owners["shared"], owners["a"], owners["b"]}, {owners["shared"]})
        self.assertEqual(sum(worker["estimated_cards"] for worker in plan["workers"]), 4)

    def test_worker_plan_uses_all_affected_cards_for_overlap_safety(self) -> None:
        plan = build_worker_plan([
            {"claim_key": "primitive-a", "affected_cards": [
                {"oracle_id": "shared", "name": "Shared"},
                {"oracle_id": "a", "name": "A"},
            ]},
            {"claim_key": "primitive-b", "affected_cards": [
                {"oracle_id": "shared", "name": "Shared"},
                {"oracle_id": "b", "name": "B"},
            ]},
        ], workers=2, memory_budget_gb=2)
        jobs = [job for worker in plan["workers"] for job in worker["jobs"]]
        self.assertEqual({job["claim_key"] for job in jobs}, {"primitive-a", "primitive-b"})
        owners = {worker["worker"] for worker in plan["workers"] for job in worker["jobs"] if "shared" in job["oracle_ids"]}
        self.assertEqual(len(owners), 1)
        self.assertEqual({"shared", "a", "b"}, {oracle_id for job in jobs for oracle_id in job["oracle_ids"]})

    def test_reads_only_exact_active_claim_statuses(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "claims.md"
            path.write_text(
                "| Claim key | Scope | Branch | Status | Since |\n"
                "| --- | --- | --- | --- | --- |\n"
                "| `free` | scope | worker | merged | today |\n"
                "| `owned` | scope | worker | active | today |\n"
                "| `reviewing` | scope | worker | review | today |\n"
                "| `inactive-word` | scope | worker | inactive | today |\n",
                encoding="utf-8",
            )
            self.assertEqual(load_claimed_keys(path), {"owned", "reviewing"})


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

    def test_roadmap_order_is_deterministic_when_scores_tie(self) -> None:
        blocked = [
            {"oracle_id": "a", "name": "A", "templates": {"zeta", "shared"}, "lines": ["zeta", "shared"]},
            {"oracle_id": "b", "name": "B", "templates": {"alpha", "shared"}, "lines": ["alpha", "shared"]},
        ]
        first = [entry["template"] for entry in build_roadmap(blocked, top=3)]
        second = [entry["template"] for entry in build_roadmap(blocked, top=3)]
        self.assertEqual(first, second)

    def test_roadmap_keeps_all_cards_affected_by_a_template(self) -> None:
        blocked = [
            {"oracle_id": "a", "name": "A", "templates": {"aaa-shared", "other-a"}, "lines": ["aaa-shared", "other-a"]},
            {"oracle_id": "b", "name": "B", "templates": {"aaa-shared", "other-b"}, "lines": ["aaa-shared", "other-b"]},
            {"oracle_id": "c", "name": "C", "templates": {"other-a", "other-b"}, "lines": ["other-a", "other-b"]},
        ]
        entry = build_roadmap(blocked, top=1)[0]
        self.assertEqual([card["oracle_id"] for card in entry["affected_cards"]], ["a", "b"])

    def test_scoped_roadmap_defaults_claim_namespace_to_set(self) -> None:
        self.assertEqual(resolve_claim_prefix(None, "c13"), "c13")
        self.assertEqual(resolve_claim_prefix("shared", "c13"), "shared")

    def test_selects_profiles_for_a_set_scope_by_oracle_or_printing_id(self) -> None:
        profiles = [
            {"oracle_id": "oracle-a", "scryfall_id": "printing-a"},
            {"oracle_id": "oracle-b", "scryfall_id": "printing-b"},
        ]
        self.assertEqual(
            [profile["oracle_id"] for profile in select_profiles(profiles, {"oracle-a", "printing-b"})],
            ["oracle-a", "oracle-b"],
        )

if __name__ == "__main__":
    unittest.main()
