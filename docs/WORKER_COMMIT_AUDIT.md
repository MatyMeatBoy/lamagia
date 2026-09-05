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

## 2026-09-05 integration pass

Accepted and pushed executable batches: `b679a8a`, `37eb112`, `00b4cc6`,
`bd2a775`, `6268464`, `b55de91`, `f6476d0`, `cc1bd83`, and the generalized
cycling grammar in `3bceac3`, plus the Phyrexian Delver variant in `b0b7f51`.
Rules validation reached 561 passing tests and the export reached 9,289 fully
implemented profiles.

Audited but skipped as duplicates or stale replays: `ac41278`, `527e77e`,
`25d160b`, `5296336`, `b501d9e`, `0aaba1c`, and `8c34a4a`. These commits may
remain useful as provenance, but their executable behavior already exists in
the published tree; reapplying them would reintroduce conflicts or duplicate
branches.
Accepted afterward: `58fd65f` adds the reusable active-turn keyword primitive
(`keywordsDuringYourTurn`) with a scenario for Razorkin Needlehead; it raised
the global export to 9,289 profiles without changing C13.

The origin audit then reviewed `origin/c14-batch2-clean` as a branch, not as
an unchecked bulk merge. Its executable delta was salvaged in `dd6c117` with
the authoritative `card-drawn` event preserved, duplicate Siege/choice cases
removed, and the C14 status map retained for provenance. Validation: 562 rules
tests, `npm run check`, 9,290 global profiles, C13 249/341. Conflicting or
stale worker history remains excluded until it supplies a focused scenario and
exact oracle mapping.

Follow-up executable cards were added with focused scenarios: Forecast hand
activation (`638e6e8`), Terra Ravager defending-land scaling (`08a4d51`), and
Inferno Titan divided damage (`25e456a`). The Vizkopa Guildmage worker change
(`1ab35c4`) was also salvaged and validated in the current tree. Validation is
now 565 rules tests, 9,294 global profiles, and C13 252/341.
