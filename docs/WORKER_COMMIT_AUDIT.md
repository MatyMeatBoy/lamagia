# Worker commit audit

Run the read-only gate before integrating any external worker commit:

```powershell
python tools/rules/audit_worker_commit.py --base <published-integration-sha> --commit <worker-sha>
```

`PASS` requires clean whitespace and executable evidence. A new `SpellEffect`
kind must have an engine executor path and a scenario test. A parser branch by
itself is triage, not a completed card. A type union line by itself never closes
a card. The gate also rejects duplicate union declarations and control flow
accidentally inserted into the `SpellEffect` type.

Nemotron audit, 2026-09-04: `origin/master` contained 81 commits after
`470cad0`. Seventy-nine were one-line additions to `characteristics.ts`; the
remaining two changed the same type area or added a malformed parser fragment.
They supplied no verified card mapping, no executor coverage, and the public
`master` build failed. Result: **0 accepted functional commits and 0 cards**.
The useful part was the warning pattern, now encoded in this gate and in the
contributor contract.

Instruction to the worker: keep using available compute, but spend it on
reusable executable improvements and their tests. A small correct change is
accepted; a large batch of declarations without behavior is rejected. Never
repeat the Nemotron pattern of claiming progress from type-only or malformed
patches.

Every accepted card batch must report the exact `<name> | <oracle_id>` mapping,
published base SHA, parser/profile result, executor path, scenario tests, and
limits. Reprints reuse the oracle identity; they do not justify duplicate
effect kinds.
