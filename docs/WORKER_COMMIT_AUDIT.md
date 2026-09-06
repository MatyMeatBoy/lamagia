# Worker commit audit

Run the read-only gate from the repository root:

```text
python tools/rules/audit_worker_commit.py --base <published-sha> --commit <worker-sha> --report docs/worker-audit/<worker-sha>.md
```

`REJECT` means the worker must resubmit a focused commit. In particular, a
large deletion count or more than 20 stable `oracle_id` values usually means
the branch was based on stale/re-written history; rescue a small diff instead
of cherry-picking it. A rejected audit is evidence for the integrator, not a
rules implementation.

Current intake gate: `audit_worker_commit.py` rejects more than 600 total
deletions or 300 deletions under `packages/rules`. This protects the published
gameplay tree from stale worker rebases; a passing rules scenario alone does
not authorize a broad rewrite. Resubmit focused source/test hunks from the
current integration SHA.

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

## 2026-09-05 — Azorius Herald payment-gate primitive

Accepted as focused commit `c11cd0f`:

- Azorius Herald | `a0476da9-51b1-4cd3-90c4-ad01d0e4c3d6`

The engine stores colors spent on a spell and carries that context to the
permanent, enabling the reusable “sacrifice unless {color} was spent to cast
it” trigger shape (CR 603.4). Validation: 572 rules tests and `npm run check`.

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

Worker commit `18e5928` from `origin/worker-05` was audited and selectively
integrated as `c531f66`. It adds the reusable CR 603.3f trigger-doubler
primitive, with a parser, executor, and scenario test. Accepted card mappings:

- Harmonic Prodigy | `2e2ace5b-4018-43af-8e72-ebafec1a7739`
- Katara, the Fearless | `0972d46e-423b-454e-87c7-a2d40fb6fb6d`

Wizard's Staff | `30c3c700-46f4-4a77-8c45-5c7e3a21bd62` uses the same
doubler scope, but remains pending because its typed Equip Wizard cost is a
separate missing primitive. Validation: 568 tests, 9,299 global profiles,
C13 254/341. The worker's generated status pages were discarded as stale and
regenerated from the published tree.

The next three origin worker commits were audited as focused C13 rescues:
`8044a60` (Aethermage's Touch), `232ecd7` (Strategic Planning), and
`8818654` (Skyward Eye Prophets). Their shared stale trigger-doubler hunks
were discarded because `c531f66` already published that primitive; the
executable deltas were manually integrated and tested together as `d0a3ba7`.
Accepted mappings:

- Aethermage's Touch | `15692698-ef57-4672-bf76-5fe4a00c693a`
- Strategic Planning | `02b5acf3-47cb-4d39-9307-e02656f1879b`
- Skyward Eye Prophets | `45bef776-121b-4489-9c46-f7b4fd4c3c0d`

Validation: 571 rules tests, `npm run check`, 9,308 global profiles,
C13 257/341. This rescue also fixed the latent `enteredThisTurn` field
omission in the hand-activation source exposed by the type check.

Typed Equip worker commit `a816d01` from `origin/worker-05` was selectively
rescued as the current source change. It adds the reusable subtype-restricted
Equip cost primitive and scenario coverage; the stale generated handoff and
coverage files were not imported. The batch closes these cards:

- Wizard's Staff | `30c3c700-46f4-4a77-8c45-5c7e3a21bd62`
- Commander's Plate | `cae166de-e681-40a0-83a8-3c17cf40e2fc`
- Unstable Molecule Suit | `2bc0821a-5a8f-465d-8532-3fb5c5d11d8f`
- Dúnedain Blade | `4b418846-6426-448a-b4cb-ce631e0a99a2`
- Thinking Cap | `a54fb3de-0581-461e-be33-dc4f4d16a33e`
- Pirate Hat | `b9080653-87cb-4443-a4a3-36637d5ad165`
- Veteran's Powerblade | `da0b4e01-b312-4f37-a034-824ce58db02e`
- Ceremonial Groundbreaker | `5bb05573-7e8f-471f-908d-04bccead79e3`
- Steelclaw Lance | `bfe06fb5-83b5-4212-86f8-947dfba15b26`

Validation: 573 rules tests, `npm run check`, 9,320 global profiles, C13
258/341. The exact oracle mapping for every reprint remains in the generated
profile export; no card-name branches were added.

The remote C13 commits `9c2cbee` (Divinity of Pride) and `a8366c0` (Wight of
Precinct Six) were audited after fetch and skipped as stale duplicates: their
source behavior and scenarios already exist in the published tree. The
corresponding cards remain fully implemented in the generated export.

Hooded Horror | `8267561e-bc25-4aaa-8242-f6d7ec88143e` was implemented locally
with a reusable combat restriction rather than a card-name branch. Validation:
574 rules tests, `npm run check`, 9,321 global profiles, C13 259/341.

Prossh, Skyraider of Kher | `868882d2-ed4e-4171-a17c-478a341080fb` was closed
locally with the reusable mana-spent cast-trigger token primitive. Validation:
575 rules tests, `npm run check`, 9,324 global profiles, C13 260/341.

The latest origin audit processed the remaining executable C13 candidates:

- `e8d97ae` Dungeon Geists was selectively rescued into `0fc5e12` with a
  reusable opponent-creature target and source-controlled untap lock.
- `ffc4d51` Standstill was selectively rescued into the same integration with
  the `When` spell-cast grammar and event-caster opponent draw scope.
- `fa5b133` Phyrexian Delver was skipped as a duplicate: its generic
  reanimation-plus-mana-value-loss effect and scenario already exist locally.

Validation after the integration: 577 rules tests, `npm run check`, 9,326
global profiles, C13 261/341. No worker docs or claims were imported when they
were stale; only executable source and scenario evidence was retained.

`60cba3b` closes Contested Cliffs | `b891a683-2ebc-4e9c-b402-5dd9c1b42b69`
with a reusable multi-target activation and CR 701.12 fight executor. The
activation path validates each ordered target slot; no card-name branch was
added. Validation: 578 rules tests, `npm run check`, 9,327 global profiles,
C13 262/341. The remaining fetched branches were rechecked against the export;
their claimed cards are either already complete or stale duplicates, so no
additional source was imported.

`f3cd692` closes Witch Hunt | `e86bd38f-7804-449d-af29-21e96a56ab30` with a
reusable deterministic random-opponent control effect (CR 603.2, 110.2).
Validation: 579 rules tests, `npm run check`, 9,328 global profiles, C13
263/341.

`72c99c5` closes Naya Soulbeast | `5ea0c608-2c56-4889-a5d3-d435df515950`
with a reusable cast-trigger reveal that stores total revealed mana value as
entry counters. Validation: 580 rules tests, `npm run check`, 9,329 global
profiles, C13 264/341.

The post-checkpoint origin audit was performed with `git fetch origin --prune`
and patch-equivalence checks across all published worker heads. C13 heads had
no unrepresented patch after the selective rescues above; their remaining
differences are stale generated files, duplicate card loaders, or claims for
cards already complete in the current export. `origin/worker-05` contained one
new executable delta, `2e1de07`, which was selectively integrated as
`38846ba`: a reusable `spell-cast` trigger for each player filtered to instant
or sorcery spells, with scenario coverage. It has no card-name branch and is
available to every matching reprint. Validation: 582 rules tests,
`npm run check`, 9,330 global profiles, C13 264/341.

`b9ba689` from `origin/codex/c13-widespread-panic-f99` was selectively
integrated as `dca66ff`. It adds the reusable `library-shuffled` event and a
player-private hand-card choice after a spell or ability shuffles that
player's library, including existing search/cycle/self-shuffle paths. Accepted
card mapping:

- Widespread Panic | `853a3c2b-3d37-453a-8a77-4d90bd3a1cb7`

The stale claim line was not imported. The client trigger glyph was added as a
type-safety follow-up. Validation: 583 rules tests, `npm run check`, 9,331
global profiles, C13 265/341. The current C13 queue is 76 unfinished cards,
with 7 one-line candidates.

The divergent `origin/master` cEDH sequence was not merged wholesale: it is an
older branch with a large unrelated tree replacement and 60 incremental
activate-only-as-sorcery variants. It remains an explicitly audited follow-up
queue, not evidence to overwrite the current integration tree. The C14
branches were left intact for their own next pass; no unreviewed C13 source
was found in them.
### Origin and lost-object audit — 2026-09-05

`git fetch --all --prune` found one new executable tail on `origin/worker-05`.
The following source commits were integrated selectively, preserving rules code
and scenarios while rejecting stale generated coverage snapshots:

- `1cb1fec` + `be9c65d`: dynamic noncombat source-power amplification and
  hand-size characteristic-defining P/T.
- `80d85c5`: second-draw-this-turn — Faerie Mastermind |
  `a984db23-40ea-428d-829f-e944267280f8`.
- `e02c860`: multi-card Brainstorm top-library choice — Brainstorm |
  `36cd2364-d113-47d1-b2c4-b088d9eb88dd`.
- `a7677d8`: discard-then-draw-same-count — Forget |
  `619ef7e1-33cd-4470-a1d4-83c5f1f5c31e`.
- `6fc73df`: active-player hand-bottom/draw — Teferi's Puzzle Box |
  `37abcc92-9466-47ea-9e0b-5eda2eb62c8e`.
- `2b49fc8`: source-untapped trigger — Howling Mine |
  `d26b27db-a567-4631-b4b6-7294222fbdd1`.
- `955ac67`: independently rounded half-library/half-life — Peer into the
  Abyss | `21fa2442-6eac-4dce-a9cc-76f0053fdb8f`.
- `881a066`: end-step draw plus opponent hand threshold damage — Fevered
  Visions | `70763549-4b4e-4cb8-8c02-0639ba18bb1a`.
- `e3609ed`: discarded-card-type filtering — Waste Not |
  `00fdcc19-88ed-46c3-91f0-095806228105`.

The earlier `18e5928`, `a816d01`, `ffc4d51`, and `2e1de07` worker commits
were already represented by the published engine and were not duplicated.
Mirari (`0b92688`) was integrated as `04027be`; Eternal Dragon's graveyard
activation and real C13 `this card`/Plainscycling wording were completed as
`d379d3c` plus the current follow-up fix. Validation after this pass is **595
rules tests**, rules type-check green, **9,354/38,711** profiles, and C13
**267/341**.

No remote, ref, or fetch URL named `mtgfork` is configured in this checkout.
`git fsck --unreachable` was inspected: WIP/index states and commits already
represented by published C13/C14 work were classified as non-integrable; no
unreferenced executable commit was applied without a scenario test. The
divergent `origin/master` cEDH sequence remains quarantined because it is an
older tree replacement plus unrelated variants, not a safe integration source.

### C13 primitive follow-up — Mirror Entity — 2026-09-05

Mirror Entity (`17e905ca-c0bd-473d-95a7-e180ba5fea43`) now uses a reusable
activated-ability primitive: `{X}` sets the controller's creatures' base P/T
to X/X and grants all creature types until cleanup. The implementation keeps
this separate from additive P/T modifiers and exposes subtype targets during
the temporary effect. Scenario coverage verifies activation payment, X=2,
cleanup-scoped characteristics, and that creature subtypes do not leak into
Equipment targets. Validation: 596 rules tests and `npm run check`.

Faerie Conclave (`0c25f6b1-8fb3-4406-9605-0282d2dbbcec`) reuses the same
animation primitive with parameterized types, so its temporary characteristic
is `Land Creature` rather than the old hard-coded `Artifact Creature`.
Validation after both C13 additions: 597 rules tests, `npm run check`,
**9,356/38,711** profiles, and C13 **269/341**.

### Origin tail audit — 2026-09-05 (continued)

The fetched `origin/worker-05` tail was checked commit-by-commit before any
new work was started. The executable changes in `083ba46` and `15ae30c` were
integrated as `822e601` and `2893b82` respectively:

- Geier Reach Sanitarium | `7b9fafe7-d26a-4ed5-b4c4-ce13763770b5` —
  each-player draw, then private APNAP discard choices.
- Deadly Rollick | `0456ec64-2c81-4763-a352-8ff64a4c3d6b` — optional free
  cast while controlling a commander, alongside the normal paid action.

The remaining worker-05 commits (`18e5928`, `a816d01`, `ffc4d51`, `2e1de07`,
`1cb1fec`, `be9c65d`, `80d85c5`, `e02c860`, `a7677d8`, `6fc73df`, `2b49fc8`,
`955ac67`, `881a066`, and `e3609ed`) were compared against the current source
and existing scenario tests. Their executable primitives are already present
from earlier selective rescues; cherry-picking them would reintroduce an
older tree and remove the newer Mirror Entity/Faerie Conclave effects. Their
stale generated coverage and claim edits were not imported.

`origin/c14-batch2-clean` has no executable patch remaining relative to this
HEAD. `origin/c14-self-pump` and `origin/claude/c14-precon-clusters` contain
older divergent histories; their source deltas are either already represented
or would replace current rules code, so they remain audited—not merged
blindly. `origin/master` remains quarantined for the same reason. No
`mtgfork` remote, ref, or configured fetch URL exists in this checkout, so
there is no additional mtgfork object set to recover.

After export and full validation: **599 rules tests**, `npm run check`,
**9,361/38,711** unique profiles, edition memberships **23,743/84,990
(27.9%)**, C13 **269/341**, and C14 **199/322**. The next C13 queue remains
72 cards, with 5 one-line candidates; this audit is complete for all currently
reachable origin heads.

### MtgFork and unreachable-object audit — 2026-09-05 (continued)

The previously unconnected fork checkout was found and inspected at
`C:/Users/MP/Documents/00 Claude/MtgFork/lamagia`. Its `worker-05` worktree
tip is `1ad1325`, the same published worker history fetched as
`origin/worker-05`; its `master` is the old 60-variant cEDH tree and is not a
safe source branch. The only new executable worker tail was `f565d69`,
integrated as `8aa9490`:

- Snuff Out | `324824cb-f938-401c-b9b5-d8908b431ef0` — a reusable
  `payLifeInsteadOfManaCost` alternative cost, offered beside the normal cast
  and gated by controlling the required land subtype.

The local C13 trigger-review head had one patch-equivalent difference,
`eeac0f3` (entering-creature power damage); the current engine already carries
the same primitive through `081b81a`/`61e867d` with the broader target handling,
so it was not duplicated. Its audited history is recorded in merge `a80dfeb`.
The C13 Serene Master, Nemotron audit, C14 batch, and other worker heads have
no remaining non-equivalent patch according to `git cherry` against the
current HEAD. Backup refs that would delete newer rules code were quarantined.

`git fsck --full --no-reflogs --unreachable` found 130 unreachable commits,
69 touching executable source. They were inspected as recovery candidates;
the completed ones (Tidal Force, Mirari, static land-mana bonuses, Aerie
Mystics, Hippogriff recovery, entering-power damage, Graft, Homeward Path,
Myr Battlesphere, and related C13/C14 primitives) are already represented by
current source commits or tests. Remaining objects are WIP/index states,
stale duplicate patches, or destructive alternate trees; none was applied
without a scenario test. No additional `mtgfork` object set remains outside
the discovered checkout.

Final validation after the recovery pass: **600 rules tests**, `npm run check`,
**9,363/38,711** unique profiles, edition memberships **23,752/84,990
(27.9%)**, C13 **269/341**, and C14 **199/322**. The C13 queue remains 72
cards with 5 one-line candidates.

The audited `origin/worker-05`/MtgFork history was recorded as merge
`c8c5f51` after the executable content had already been selectively integrated;
the current source tree was deliberately preserved because the worker tree
would remove newer Mirror Entity and Faerie Conclave behavior. `git cherry`
now reports no remaining worker-05 commits. The one local trigger-review patch
that differed by patch-id (`eeac0f3`) is recorded by `a80dfeb` and is
semantically covered by the current entering-creature-power implementation
and its scenarios.

The C13 pending-card audit was also completed from the catalog: all **72
unique pending oracle IDs** were read and cross-checked against the generated
roadmap and set coverage. The five one-line candidates are War Cadence,
Propaganda, Sudden Spoiling, Serene Master, and Wash Out; the remaining 67
are grouped by their exact Oracle text templates in
`docs/PRIMITIVE_ROADMAP_C13.md` and are not being treated as generic keyword
matches.

### Newly recovered dirty worker state — 2026-09-05 (continued)

The MtgFork `worker-05` worktree contained uncommitted executable changes that
were not visible in any remote head. They were validated in that worktree
(603 rules tests, all simulator/deck/oracle checks, and `npm run check`),
published as `eaa2296`, and integrated here as `366850c`:

- Daze | `70486bee-6ee7-41ea-b834-8caf4699302b` — return-an-Island
  alternative cost, offered beside the normal cast.
- Counter-unless-pay — controller-private payment choice at resolution,
  reusing the existing optional-choice path and correct spell controller.

This recovery increased the export to **9,396/38,711** unique profiles and
edition memberships to **23,860/84,990 (28.1%)**. C13 remains **269/341**;
the recovered cards are not in C13, but the primitives are shared globally.

The follow-up worker commit `faf3ad5` contained only the worker's refreshed
handoff/coverage files for this same batch; it was pushed and recorded by
audited merge `f8601bd` while retaining the newer main-branch documentation.

### Branch quarantine — 2026-09-06

The following remote heads were inspected and are not integration queues:

- `origin` / Nemotron history: destructive alternate tree with large deletions,
  stale generated files, and no safe fast-forward path.
- `origin/c14-self-pump` and `origin/c14-selfpump-backup`: seven old rule
  commits that conflict with the current engine/documentation base.
- `origin/claude/c14-precon-clusters`: contains a broad engine-repair commit
  and unresolved historical layering; not safe to cherry-pick as a batch.
- `origin/codex-ready/c14-combat-restrictions`: conflicts across engine,
  planner, package scripts, and docs; not a focused current-base commit.
- `origin/codex/c13-equipment-cluster` and
  `origin/codex/c13-darksteel-mutation`: accumulated historical branches,
  mostly already represented by accepted commits or duplicate patches.

These branches remain as provenance and must not be reprocessed automatically.
Future workers must branch from the current published integration SHA, claim a
disjoint cluster, include executable behavior plus scenario tests, and publish
a focused commit. A branch with broad deletions, conflict markers, a stale
base, or no exact card/oracle mapping is rejected before cherry-pick. Set names
are scope labels only; integration is global and is never filtered to C13.
