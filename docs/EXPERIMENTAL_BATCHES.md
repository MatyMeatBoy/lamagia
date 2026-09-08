# Experimental card batches

`experimental` is an internal export tag only. It never hides Oracle text,
changes `fullyImplemented`, or changes the card's appearance in the game.

A card receives the tag only when its current engine profile is already fully
implemented and it matches a registered shared primitive in
`tools/rules/experimental_card_batches.json`.

The `double-audit-2026-09` batch passed two gates:

1. Static gate: TypeScript build/check, full rules tests, and the engine profile
   export completed without regressions.
2. Scenario gate: focused rule scenarios exercised Convoke, Improvise, target
   controller life loss, fight, exile-until-source-leaves, dependent `Untap
   it`, and attacking-creature static bonuses.

Large batches are allowed only after both gates pass. The tag identifies cards
that should receive a later targeted regression pass; it is not a claim that
the card is incomplete. Generated `data/` exports remain local and are never
committed as source code.
