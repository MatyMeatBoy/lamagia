# Experimental card batches

`experimental` is an internal export tag only. It never hides Oracle text,
changes `fullyImplemented`, or changes the card's appearance in the game.

A card receives the `experimental` tag only when its current engine profile is
already fully implemented and it matches a registered shared primitive in
`tools/rules/experimental_card_batches.json`.

The separate `experimentalCandidate` tag is an internal work queue. It marks
near-complete cards whose Python report says an existing primitive is likely
reusable (`reuse-existing`). This tag does **not** set `fullyImplemented` and
does not make an incomplete card appear playable; it exists so workers can
process the queue without confusing a heuristic with a rules result.

The `double-audit-2026-09` batch passed two gates:

1. Static gate: TypeScript build/check, full rules tests, and the engine profile
   export completed without regressions.
2. Scenario gate: focused rule scenarios exercised Convoke, Improvise, target
   controller life loss, fight, exile-until-source-leaves, dependent `Untap
   it`, and attacking-creature static bonuses.

Large batches are allowed only after both gates pass. Regenerate the candidate
queue first, then export profiles:

```text
npm run rules:near-complete
npm run rules:engine:export
```

To create a deterministic work block without claiming implementation:

```text
python tools/rules/plan_experimental_candidate_batch.py --batch-index 1 --batch-size 500 --output data/rules/experimental-candidate-batch-001.json
```

Each block must be implemented by shared primitive/cluster, then audited with
scenario tests before its cards can receive the functional `experimental` tag.

Generated `data/` exports remain local and are never committed as source code.
