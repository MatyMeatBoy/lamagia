# Local one-line card completion

`tools/rules/auto_complete_near_complete.py` is a deterministic batch gate for
cards whose engine export has exactly one unresolved Oracle line. It does not
invent effects or hide unresolved text: it selects a shared template, refreshes
`engine-card-profiles.json`, and passes only when every sampled card is
`fullyImplemented` with zero remaining lines.

Run from the repository root:

```text
npm run rules:auto-complete
```

The default run verifies ten disjoint groups of five cards (50 cards total).
Families are keyed by exact Oracle wording and a shared exported primitive;
the selector accepts only unresolved one-line rows. Already implemented cards
are regression samples only and can never satisfy this completion gate. It
refreshes the engine export once, then fails fast on the first missing card,
unresolved line, duplicate, or primitive mismatch. The generated report is
`data/rules/auto-complete-pass.json` and is local output, not a source-of-truth
file.

Use `--max-groups N` to run fewer groups, `--sample-size N` for a different
sample size, or `--template "..."` to isolate one family. A group is not
accepted merely because its text looks similar: its exported profile must be
fully implemented and contain the registered primitive.

To add another family, first implement one reusable primitive in
`packages/rules/src/characteristics.ts` and `engine.ts`, add a rules scenario
with the applicable Comprehensive Rules citation, then add its exact Oracle
line to `SAFE_FAMILIES`. The tool must still fail unless all selected cards in
every requested group pass the refreshed engine export. Keep families
disjoint in a run so a card cannot inflate two samples.

For a real pre/post proof, save the exact target IDs before editing:

```text
python tools/rules/auto_complete_near_complete.py --plan data/rules/auto-complete-plan.json --sample-size 5 --max-groups 10
```

After implementing the shared primitive, verify that same plan:

```text
python tools/rules/auto_complete_near_complete.py --verify-plan data/rules/auto-complete-plan.json --output data/rules/auto-complete-verification.json
```

This prevents a completed card from being counted as a new integration and
requires every planned Oracle ID to be fully implemented with the registered
primitive.

Worker rule: fix the shared wording/primitive, not individual card names. Keep
stable `oracle_id` mappings in reports and never mark a card complete by
discarding its unmatched Oracle text.
