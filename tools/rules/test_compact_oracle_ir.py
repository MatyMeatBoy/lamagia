import unittest

from compact_oracle_ir import build_compact_ir, primitive_key


def card(oracle_id: str, name: str, text: str, *, amount: int = 1) -> dict:
    clause = {
        "text": text,
        "candidate": False,
        "primitive_cluster": "draw|static-or-spell",
        "kind": "static-or-spell",
        "primary_family": "draw",
        "amount": amount,
        "target_zone": None,
        "mana_symbols": [],
    }
    return {"oracle_id": oracle_id, "name": name, "status": "needs-review", "completion_hint": "quick-win", "clauses": [clause]}


class CompactOracleIrTests(unittest.TestCase):
    def test_parameterized_draws_share_a_symbol_but_keep_amount(self) -> None:
        first = card("a", "Draw One", "Draw a card.", amount=1)
        second = card("b", "Draw Three", "Draw three cards.", amount=3)
        result = build_compact_ir([first, second])
        self.assertEqual(result["primitive_count"], 1)
        self.assertEqual(result["reuse_ratio"], 0.5)
        self.assertEqual([entry["primitive"] for entry in result["cards"][0]["program"]], ["p0001"])
        amounts = [entry["operands"]["amount"] for entry in (result["cards"][0]["program"] + result["cards"][1]["program"])]
        self.assertEqual(sorted(amounts), [1, 3])

    def test_target_and_zone_are_not_collapsed(self) -> None:
        first = card("a", "Battlefield", "Exile target Equipment from the battlefield.")
        second = card("b", "Graveyard", "Exile target Equipment from your graveyard.")
        first["clauses"][0]["primitive_cluster"] = "exile|static-or-spell|target-subtype:Equipment|zone:battlefield"
        second["clauses"][0]["primitive_cluster"] = "exile|static-or-spell|target-subtype:Equipment|zone:graveyard"
        result = build_compact_ir([first, second])
        self.assertEqual(result["primitive_count"], 2)

    def test_solved_clauses_do_not_enter_the_dictionary(self) -> None:
        solved = card("a", "Solved", "Draw a card.")
        solved["clauses"][0]["candidate"] = True
        result = build_compact_ir([solved])
        self.assertEqual(result["primitive_count"], 0)
        self.assertEqual(result["review_card_count"], 0)
        self.assertEqual(result["cards"], [])

    def test_symbol_key_is_stable(self) -> None:
        clause = card("a", "Draw", "Draw a card.")["clauses"][0]
        self.assertEqual(primitive_key(clause), "draw|static-or-spell|shape:draw <n> card")


if __name__ == "__main__":
    unittest.main()
