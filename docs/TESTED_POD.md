# Tested pod

The Home **tested** mode uses four Commander decks whose commanders and cards
are marked `fullyImplemented` in `data/rules/engine-card-profiles.json`.

It preserves each deck's commander and implemented cards, then fills missing
slots with singleton cards from the imported cEDH pool when they are:

- already fully implemented by the rules engine;
- legal for the commander's color identity; and
- not a duplicate by `oracle_id`.

The pool is ranked deterministically toward interaction, tutoring, card draw,
mana acceleration, and low-cost spells. Basic lands are still the final
fallback, so the result remains exactly 100 cards and never introduces an
unsupported card merely to increase power.

Run the server tests after changing this selection logic:

```bash
npm run test --workspace=@prossh/rules
npm run check --workspace=@prossh/match-server
npm run test --workspace=@prossh/match-server
```
