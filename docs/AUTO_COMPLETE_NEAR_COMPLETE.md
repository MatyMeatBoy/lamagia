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

The default sample is five cards from the temporary creature-control family.
The generated report is `data/rules/auto-complete-pass.json` and is local
output, not a source-of-truth file.

To add another family, first implement one reusable primitive in
`packages/rules/src/characteristics.ts` and `engine.ts`, add a rules scenario
with the applicable Comprehensive Rules citation, then add its exact unresolved
line to `SAFE_FAMILIES`. The tool must still fail unless all five selected
cards pass the refreshed engine export.

Worker rule: fix the shared wording/primitive, not individual card names. Keep
stable `oracle_id` mappings in reports and never mark a card complete by
discarding its unmatched Oracle text.
