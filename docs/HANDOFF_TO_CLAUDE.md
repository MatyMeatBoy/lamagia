# lamagia — implementation handoff

**Read this before changing the project.** It is an honest snapshot of the working tree as of 2026-09-05, separating what is implemented and verified from what is still product intent. Do not present anything below the "Truth boundaries" line as working.

Repository: <https://github.com/MatyMeatBoy/lamagia>.

### Gameplay hardening checkpoint — 2026-09-05

The graphical stack projects each spell, activated ability, and trigger as an
ordered, inspectable card-like item with controller, targets, rules text, and a
clear top-first resolution marker. Human priority responses remain authoritative
in `packages/rules`; the client only renders legal actions. The general
right-click or long-press card menu lists legal play/activation/yield actions and
keeps information last. Hand-only mana abilities, including Simian Spirit Guide,
are separate from casting: selecting them exiles the card as a cost and adds
mana; they are not used by automatic payment or shown as battlefield mana
sources. Optional triggers can be yielded per source, while mandatory triggers
and opponent response windows remain active. Multi-target modal actions project
every target kind required by their selected mode. Validation after this
checkpoint: **720 rules tests**, `npm run check`, all Python suites, and the
200-game engine matrix pass (163 terminal games, 37 reached the 60-turn cap).

The latest engine-profile export reports **10,066 / 38,711** fully implemented
profiles after adding reusable static mana-ability grants. The edition counts
below are from an older published coverage export and must be regenerated before
quoting new edition percentages.

Gameplay failure traces now include resolved names of stack targets in both the
server NDJSON snapshot and the bounded stabilization diagnostic, so a stuck
fetch, removal spell, or combat effect can be reconstructed without exposing
hands or libraries.

## Current published checkpoint — 2026-09-05

The latest source checkpoint includes the verified C13 Prossh cast-trigger,
Hooded Horror combat evasion, Dungeon Geists untap lock, Standstill event-player
draw scope, Contested Cliffs multi-target fight, and mana-payment gate for
Azorius Herald, trigger-doubler primitive, plus rescued C14 draw/compound-effect
and token-scaling paths; verify the Pages run before reporting a new client asset
as live.
Coverage numbers have two deliberate units:

- **Unique engine profiles:** 9,396 / 38,711 fully implemented. These are
  deduplicated by stable `oracle_id`; one implementation covers every printing.
- **Edition memberships:** 23,860 / 84,990 implemented (28.1%) across 685
  editions. This is what the public implementation-by-edition view displays,
  so it is expected to be lower than the total catalog size and to count a
  shared card once per edition.
- **Commander 2013:** 269 / 341 unique cards (78.9%), 72 pending.
- **Commander 2014:** 199 / 322 unique cards (61.8%), 123 pending.

The static P/T vocabulary now also covers source-relative conditions such as
life thresholds and opponent graveyard creature counts. These are parameterized
primitives, so reprints reuse the same profile rather than adding card-specific
branches.

### Latest integration checkpoint — 2026-09-05

Audited worker intake added executable batches for mana-entry restrictions,
noncreature-spell drain, surveil, reanimation, Hunted Troll, Grazing
Gladehart, Disciple of Griselbrand, and Springjack Pasture. The optional
cycling-target keyword grammar was generalized and tested with Dirge of Dread.
Rules suite: **603 passing tests**. The latest local source checkpoint also
adds reusable Mirror Entity and Faerie Conclave characteristic effects;
generated export: **9,396/38,711** profiles and C13 **269/341**.

The latest origin audit also salvaged the executable portion of
`origin/c14-batch2-clean` as `dd6c117`: draw triggers remain on the engine's
authoritative `card-drawn` event, and duplicate Siege/choice cases were
removed after validation. Its stale or conflicting history was not imported
wholesale; `docs/C14_STATUS_AND_COMMITS.md` remains the source map for its
reported cards.

Sek'Kuar, Slice and Dice, graveyard exile, Well of Lost Dreams, Vile Requiem,
and Flickerwisp arrivals were audited and skipped as duplicates of existing
primitives. Do not cherry-pick stale branches wholesale; compare executable
diffs and oracle IDs against the published checkpoint.

### Tested-only pod mode

The Home client and match server expose **Tested mode**. It reads the
authoritative engine profile export, keeps only cards whose stable `oracle_id`
is marked `fullyImplemented`, preserves implemented commanders, and fills a
Commander deck to 100 with legal basic lands. The server selects four suitable
imported decks and never sends incomplete cards to that pod. This mode is
covered by `services/match-server/src/tested-mode.test.ts`.

This does not mean every planned pod option is live yet: custom 2–8 seat
lobbies and the tier/EDHREC deck generator are still queued for UI/API wiring;
the deterministic simulator and offline generator already support the related
building blocks.

### Centered gameplay decisions and Proliferate

Required gameplay decisions are presented through the centered `decision-overlay`
in `apps/client/src/main.ts`; the bottom action dock remains only as a compact
fallback. This includes trigger targets/order/modes, optional triggers, reveal,
graveyard/library choices, Scry/Surveil, cast-vs-cycle, mana choices, and the
combat declarations. Do not move required choices back into the HUD dock.

The rules engine now also recognizes and executes `Proliferate.` (CR 701.27):
it offers only players/permanents that already have one or more counters, lets
the controller choose any subset, and increments every counter type on each
selected object. Player counters are public game information and are shown in
each seat panel; the authoritative state remains `PlayerState.counters`. The
scenario test covers permanent +1/+1/level counters and an opposing player
energy counter. This is a reusable primitive for poison, loyalty, charge,
experience, and future counter-based cards; do not add card-name branches.

### Historical worker intake audit — 2026-09-05

`origin/claude/c14-precon-clusters` was audited commit-by-commit. Fourteen
intermediate commits were type-only or duplicated union declarations and were
not treated as completed cards. Its final graveyard-return commit also rewrites
large portions of the current engine and conflicts with the authoritative
implementation, so it was not imported wholesale. The useful C14 shock/reveal
land parser was rescued separately as `4b4d733`, verified with the rules suite,
and raised C14 by one card. Future workers must submit the smallest executable
cluster with engine path, scenario test, CR citation, and exact `oracle_id` list.
- **Composable review vocabulary:** 47 semantic atoms cover 70,477 unresolved
  component references; 99.9% are reused across clauses. The full-catalog
  hybrid benchmark reduces worker context by 22.8% while preserving exact
  identities, clause order, primitive keys, and operands. C13 separately
  reduces context by 7.9%; repeated shapes use symbols and unique clauses
  retain raw text. This is scheduling
  compression only: it does not mark a card implemented.
- **Batch policy:** the benchmark chooses hybrid/compact/legacy per batch;
  current full-catalog and C13 runs both choose `hybrid-payload`. Compression
  never changes implementation status.

The current parser also canonicalizes historical U+FFFD separators and keeps
the subject when lowering optional `you may draw/gain/lose` clauses. This is a
reusable import-boundary fix, not a card-name exception; it closed two C13
Landfall/end-step life cards and is covered by a regression scenario.

### Worker-05 rescue — 2026-09-05

Integrated and pushed as `2eba2b7` from `origin/worker-05`. The batch added
tested reusable primitives for ETB triggers, player draw/life-loss, Blood Artist
drain, Partner/Partner with, exile-and-life-gain, shock/pain land costs, damage
amplification, and related executor coverage. The only merge conflict was the
generated coverage markdown; it was regenerated from the post-merge profiles.

The engine matrix now passes **200/200** games. Seed 34 exposed a simulator
accounting bug, not a lost card: `Eladamri's Call` was held in `pendingChoice`
while its controller was eliminated. The invariant now counts that temporary
physical card exactly once. Debug-only environment logging was removed from the
pure rules package.

### C13 quick-win — Leonin Bladetrap

The compositional damage vocabulary now recognizes an activated self-sacrifice
cost written as `Sacrifice this artifact`, and executes damage to the current
attacker set with flying filtering. The scenario covers the actual combat
state: a nonflying attacker dies, a flying attacker survives, and the source
artifact is paid into its owner's graveyard (CR 602.2b, 120.2, 506.4).

Do not report the 38,711 profile catalog as implemented cards. Recompute both
views after accepted rules commits and publish the generated `site/coverage.json`.

### Claude/fork IR audit — 2026-09-04

The old `origin/worker-05` IR benchmark was not safe enough for integration:
it checked only card IDs and clause counts, so a changed target, zone, cost, or
primitive key could still report `PASS`. It also consumed generator inputs
before building the compact payload. Commit `2bb7612` adds exact per-card
primitive/operand equivalence checks and fixes single-pass inputs. Commit
`e1c03e1` adds the measured hybrid payload: repeated exact shapes use symbols,
while unique or complex clauses retain Oracle text. Full catalog and C13 both
  currently select `hybrid-payload` (22.8% and 7.9% context reduction); the
  reuse threshold is benchmarked per batch and is currently 2.

Claude's `94aa4ca` repaired malformed `characteristics.ts` syntax and removed
unreachable, unwired `SpellEffect` union members on a stale branch. It is useful
as an audit finding, but must not be cherry-picked wholesale: the canonical
branch already compiles and has moved on. The prior 9/200 simulator failures
(duplicate card ownership and lost commander tracking) were runtime/diagnostic
issues independent of the review IR. Commit `6202997` fixes the diagnostic and
bot path: token/ability references are no longer counted as deck cards,
commanders are searched in every legal zone, and the bot rechecks a blocker
against the specific attacker. The matrix now passes **200/200** games. Keep
future engine failures as separate gameplay claims rather than attributing
them to compression.

## Product objective

ProsshTCG is a Commander simulator built for a four-player pod but architected for 2–8 seats. It targets the browser first, with Android (Capacitor) and desktop (Tauri) planned from the same client. The visual reference is a modernised MTGO: three opponents share the upper band, the local player owns the lower band, phases and priority are explicit, and public zones can be inspected without leaking hidden information.

The long-term product still needs online rooms, profiles, rewards/tournaments, deck construction, a wishlist/price gallery and far more rules coverage. **It is not complete.**

## What changed in this pass (activated abilities, general triggers, ability icons)

The edition coverage map keeps a stable top-level `group` and a navigable
`subgroup`: Commander is split by year, promos by origin/year or source set,
and regular expansions by historical block (Ravnica, Mirrodin, Theros, etc.).

The tree that this pass started from **did not compile**: `applyActivate` and
`applyActivateMana` existed but were never routed or published, so
`packages/rules` failed to build. That is fixed, and three larger pieces landed
on top of it.

### 1. Activated abilities are a real player intent

- `legalActions` now publishes one action per producible mana type of every
  `manaAbility`, and one action per legal `activatedAbility`, both keyed to
  `permanent.instance_id`.
- `applyAction` routes `activate-mana` and `activate`.
- `activatableAbility` in `packages/rules/src/engine.ts` is the single legality
  check shared by `legalActions` and `applyActivate`, so the client is never
  offered an activation the authoritative path would refuse.
- Activation costs now cover **mana** as well as `{T}`, paying life and
  sacrificing the source. `{Q}`, loyalty, energy, discard, removing counters and
  sacrificing *other* permanents still leave the ability out of the profile.
- The cost is checked against the board the payment will actually see: a land
  that taps for the ability is removed from its own mana sources first. The
  200-game matrix caught this as a real double-count (Inventors' Fair, Mount
  Doom) before it shipped.
- `hasRealChoice` deliberately ignores `activate-mana` always, and `activate`
  outside the controller's own sorcery-speed window. Both stay legal and listed;
  this only stops a seat with `autoPass` from being interrupted in every window.
- The bot activates only self-limiting abilities (`{T}` or sacrifice-self) in its
  own main phase, because it has no way to decide when to stop paying a
  repeatable cost.

### 2. Triggered abilities are event-driven

Rebuilt as an event bus rather than a hard-coded ETB hook. XMage and Forge were
used as behavioural references for the shape of the system; no code or asset from
either was copied, and the repository policy in `docs/RULES_RESEARCH.md` is
unchanged.

- `GameEvent` + `raiseEvent` in `engine.ts` raise ten event families at the
  moment the rules say they happen: `enters-battlefield`, `dies`, `attacks`,
  `blocks`, `deals-combat-damage-to-player`, `becomes-tapped`, `spell-cast`,
  `upkeep`, `draw-step`, `end-step`.
- `TriggerDefinition` now carries a `subject` (`self`,
  `another-creature-you-control`, `creature-you-control`, `another-creature`,
  `any-creature`, `you`, `each-player`, `opponent`), so
  "whenever **another** creature you control dies" no longer fires for the source
  itself (rule 109.5).
- `dies` looks back at the permanent that just left the battlefield (CR 603.6d),
  which is what makes a creature's own death trigger work.
- **APNAP ordering** (CR 603.3b): `apnapOrder` sorts the queue from the active
  player outward, and triggers are pushed in that order, so the active player's
  resolve last.
- Triggers no longer wait for an empty stack; they go on top of whatever is
  there the next time a player would receive priority (CR 603.3).
- **Trigger targets** are chosen as the ability is put on the stack (CR 603.3d):
  automatically when exactly one is legal, through the new `trigger-target`
  pending choice when several are, and by removing the ability from the stack
  when none is. A trigger's target no longer leaks into the card-level
  `targetKind`, so a creature with a targeted ETB is castable with an empty board.

### 3. Modern Oracle self-reference

`normalizedOracle` now maps "this land", "this creature", "this artifact" and the
rest of the current templating to `~` alongside the printed name. Wizards stopped
repeating card names, so the previous parser missed most reprints — including
every fetch land. `this turn` / `this way` / `this game` / `this player` are
explicitly not self references.

Ramp templates that say "onto the battlefield **tapped**" now enter tapped;
`putOntoBattlefield` takes an explicit override that can only add tapped-ness,
never remove a card's own printed one.

### 4. Two honesty corrections

- `parseAddClause` now has to consume the whole clause. "Add one mana of any
  color **that a land an opponent controls could produce**" was being read as five
  unrestricted colours. Cards like Exotic Orchard still play through the
  structured `produced_mana` fallback, but they no longer claim their text is
  executed.
- A mana ability whose printed output the parser cannot read now counts as
  uncovered, so the hand tooltip and card page stop over-claiming.

### 5. Reusable counters and temporary P/T modifiers

- Permanents carry public normalized counters and temporary layer-7c P/T
  modifiers; cleanup removes the modifiers and combat damage.
- The parser recognises entry counters and mana activation costs that remove
  counters from the source. The automatic planner can choose between multiple
  mana abilities on one permanent, enabling Vivid-style any-color payments.
- `All creatures get -N/-N until end of turn`, `Creatures you control get` and
  `Target creature gets` are structured effects. Modified toughness is used by
  state-based actions, and projections expose current P/T and counters.
- Vivid-style mana and Infest scenarios are covered. Proliferate, counter
  annihilation, replacement effects and general layer dependencies remain
  outside this cluster.

### 6. Ability iconography on the table

- `apps/client/src/abilities.ts` is an **original** SVG set: fifteen enforced
  keywords, two activation families and ten trigger events. Each glyph carries
  the printed rule *and* a statement of what this engine actually does with it.
- MTG Arena was studied only for where icons help. Its icons are Wizards of the
  Coast game assets and are not redistributable, whatever a wiki mirror implies,
  so nothing from it is used.
- The projection exposes `PermanentView.abilities`, with availability read from
  `legalActions` rather than recomputed, so an icon is never lit for something the
  server would refuse.
- Clicking a permanent with one legal activation fires it; with several it opens
  an ability menu. Clicking an icon opens its help card. Both close on Escape.
- Targetable permanents and seats also glow while a triggered ability is being
  aimed.

### Measured effect

| Metric | Before | After |
| --- | --- | --- |
| Cards with a payable, resolvable activated ability | 0 (feature did not run) | 670 |
| Cards with a recognised triggered ability | 87 | 1,185 |
| Trigger events / subjects covered | 1 / 1 | 9 raised / 7 subjects |
| Catalog cards fully implemented | 5,151 | 7,284 |
| …of those, with non-empty Oracle text | 2,090 | 2,981 |
| C13 unique cards fully implemented | — | 141 / 356 (215 pending) |
| cEDH pod (400 copies) fully implemented | 83 | 106 |

Measured with `npm run rules:engine:export` over the local 38,711-card catalog.
The "before" numbers come from the previous handoff; the increase is net of the
two honesty corrections above, which *removed* cards that were over-claiming.

### Library search UX and rules references

The active search projection now exposes the searching player’s legal candidates
and, separately, the complete remaining library. The client shows candidates in
a centered search panel with one-click selection and a `Ver todo el mazo` toggle;
the complete list is never included in an opponent’s projection. This fixes the
previous fetch-land dead end where the player had to guess a hidden card name.
`Polluted Delta` therefore lists every card whose subtype includes Island or
Swamp, including nonbasic duals such as Watery Grave.

The root-level rules toolkit now documents Wizards CR, Academy Ruins API, XMage,
French-Vanilla and the Ability Icon reference. The full structured CR snapshot
is regenerated with `npm run rules:cr:sync`; those sources are for research only,
never runtime dependencies.

`docs/RULES_SOURCES.md` records Academy Ruins as the structured CR/MTR/IPG
reference and XMage/French-Vanilla as behavioural references. Run
`npm run rules:cr:sync` to refresh the local `docs/COMPREHENSIVE_RULES.md`
snapshot. The rules engine itself never calls that API.

Edition coverage is generated with `npm run rules:set:coverage`. It deduplicates
by `oracle_id`, keeps Alpha-to-current chronology, separates main, Commander,
Secret Lair and other sets, and lists each edition’s pending cards for
contributors. The client exposes the same report as the “Cobertura” chart and
loads pending IDs only when an edition is opened.

### 7. Bounded primitive batches and reusable trigger/modal effects

- `tools/rules/compile_oracle_effects.py` splits independent card/primitives
  into deterministic bounded process batches. The review profile is 8 workers
  with a 2 GB scheduler budget; workers are capped from the requested memory
  estimate. Its ignored `oracle-card-cache*.json` reuses unchanged rows by
  `oracle_id` and field fingerprint; `ORACLE_IR_PARSER_VERSION` invalidates
  stale entries after parser changes.
- Supported `Choose one` modes become reusable `ModalChoice` entries. The
  engine publishes one legal cast action per mode, applies the selected effect
  on resolution, and filters its targets normally.
- Modal diagnostics retain every unsupported bullet branch alongside the modal
  heading. This keeps the primitive roadmap honest: a mixed/unsupported modal
  is not reduced to the generic `Choose one` label, so workers can claim the
  actual missing effect cluster.
- Added reusable exact target families for artifact, enchantment, land and
  player-or-planeswalker removal, plus the artifact/creature/enchantment board
  sweep. Crosis Charm and Dromar’s Charm are scenario-tested.
- Landfall and artifact-creature combat-damage triggers reuse the existing
  enters/deals-damage event bus; Rampaging Baloths and Grazing Gladehart are
  now covered by the same trigger subject rather than card-specific code.
- The Python IR emits stable `primitive_cluster` keys and a grouped review
  queue so contributors can implement one primitive across many cards. The
  compiler also writes `data/rules/oracle-clusters.json`; the latest full run
  produced 11,072 deterministic unresolved clusters from the 18,254 pending
  clauses.
- The reproducible full-catalog benchmark is 13.43s with one process versus
  3.75s with eight processes (3.58x); five processes took 4.43s and five
  threads 10.25s. The queue now advertises up to 20 new
  `oracle_id` values per commit; the claim ledger still prevents overlapping
  clusters between forks.
- Fork polling policy: the integrator checks the fork at most once every five
  minutes. Between checks, local work continues on an unclaimed primitive; a
  check is actionable only when the threshold is reached or the fork reports a
  blocker.
- Supported keyword-only clauses are removed from the review queue; the latest
  full IR therefore reduced actionable pending entries from 22,678 to 18,254
  without changing executable-card coverage.
- Fork integration policy: do not cherry-pick a partial stream. Accumulate more
  than ten new fork commits after the last integration, preserve their order,
  cherry-pick the complete group, then run the full gate once. Each contributor
  commit may still contain at most twenty new `oracle_id`s and must keep its
  claim disjoint from other workers.

## Batch C14 — primitive roadmap tool and combat restrictions

### Why a new planner

Card work was being scheduled from `data/rules/oracle-clusters.json`, which ranks
clauses by **how often they appear**. That is the wrong number: a card is only
implemented when *every* one of its lines is executable, so the most frequent
clause can appear in thousands of cards and finish none of them. With 11,072
clusters and a 20-card commit budget, the queue was effectively unordered.

`tools/rules/plan_primitive_roadmap.py` (`npm run rules:roadmap`) replaces that
ranking. It reads the profile export produced by the real engine — so the ground
truth is `packages/rules` itself, not a parallel Python approximation — folds
each line the engine failed to execute into a parameterised template, and then
runs a **greedy set cover**:

* `blocks`  — unfinished cards containing the template.
* `unlocks` — cards it is the **last** blocker for.
* Each round schedules the template that finishes the most cards *given what is
  already scheduled*, then retires it. A template that finishes nothing today
  rises the moment the template sharing its cards is scheduled, which is why the
  tie-break is coverage rather than an arbitrary order.

Measured on the current catalog: **15,182 of 31,895 unfinished cards are exactly
one line away**, and the top 40 templates would finish 1,329 of them. The
generated `docs/PRIMITIVE_ROADMAP.md` is a work order with claim keys, printed
examples and the exact card list per entry, so a contributor can pick one up
cold. Regenerate it after every batch; it is not hand-editable.

The tool derives every template from the local Scryfall catalog text. It does
not read or transcribe XMage or Forge code, and the repository policy in
`docs/RULES_RESEARCH.md` is unchanged.

### First batch driven by it

Claims `c14-combat-restrictions` and `c14-landwalk`, taken from the top of the
generated queue and disjoint from the C13 equipment/counters/life work.

* `packages/rules/src/characteristics.ts` — `CombatRules` plus `parseCombatRules`
  read four printed restrictions and landwalk off the Oracle body. They are
  static abilities, so they are consumed as covered text rather than resolved.
* `packages/rules/src/engine.ts`
  * `canAttack` honours a printed "can't attack" (CR 506.3a).
  * `canBlock` takes the game state and honours "can't block" (CR 509.1a),
    "can block only creatures with X", and landwalk.
  * `landwalkEvades` checks the **defending** player's lands for the named
    subtype, and the supertype list for legendary landwalk (CR 702.14a).
  * `requiredAttackers` enforces "attacks each combat if able" against the whole
    declaration, so leaving such a creature out is rejected (CR 508.1d). A
    creature that cannot legally attack does not make the declaration illegal.
* `packages/rules/src/engine.test.ts` — six scenarios: profile reading, a
  can't-block creature absent from `legalBlockers` and refused by the
  authoritative path, a flying-only blocker against both a ground creature and a
  flier, an attack requirement refusing an incomplete declaration, the same
  requirement not applying to a summoning-sick creature, and a swampwalker
  unblockable only when the defender controls a Swamp.

### Verification

```text
npm run check                    PASS (0 errors)
npm run test --workspace=@prossh/rules   197 passed
python tools/rules/test_compile_oracle_effects.py   22 tests OK
npm run simulate:engine          200 games, 0 invariant failures, 160 finished
npm run rules:engine:export      38,711 cards; 7,284 fully implemented
```

The Claude batch moved **6,500 → 6,654 (+154)** on its base, and every
combat-restriction and landwalk template dropped out of its regenerated
roadmap. After the fork batches, the current branch exports **7,284** fully
implemented profiles; C13 coverage is **141/356** and the roadmap is regenerated
from that current result.

### Limits

* Landwalk reads printed land subtypes only; an effect that changes a land's
  type at runtime is not modelled, because the engine has no layer system yet.
* "Can block only creatures with X" is limited to the enforced keyword set.
* Attack requirements are checked, but attack **restrictions** that would make a
  requirement impossible in combination (CR 508.1d's "maximum subset" rule) are
  not solved; with a single requirement family that cannot yet produce a
  contradiction.
* `blocksOnlyWithKeyword` and `cannotBlock` are read from the printed card only.
  Granting or removing them at runtime needs continuous effects.

## Current verified state

| Area | Implemented now | Evidence |
| --- | --- | --- |
| Turn structure | All twelve steps, with `untap` and `cleanup` resolving their turn-based actions automatically. A seat whose only legal move is passing is passed for it, so no window can stall. | `settle` in `packages/rules/src/engine.ts`; `engine.test.ts` → "never leaves the table without somebody able to act" |
| Priority and stack | Circular passing, resolution one object at a time, priority back to the controller after casting, no step advance while the stack is occupied. | `applyPass` / `resolveTop`; `engine.test.ts` → "holds the spell on the stack while an opponent can still respond" |
| Mana | Generic, colored, colorless, hybrid, monocolored hybrid, Phyrexian (life payment), snow-as-generic and `{X}` parsing. A backtracking solver decides which permanent and which mana ability to use; entry-counter costs are supported. | `packages/rules/src/mana.ts`, `planManaPayment`; `mana.test.ts` and `engine.test.ts` |
| Casting | Any card whose printed cost the board can pay, at sorcery or instant speed, with targeting and fizzling when targets leave. Variable `{X}` costs expose legal values and retain the selected value; Fireball is covered as its first-target/X damage behavior, while its multi-target additional-cost clause remains outside the current model. Target restrictions include creatures, permanents, nonlands, artifact/enchantment, artifact/creature/planeswalker, nonartifact creatures and reusable `subtype:<Subtype>` constraints. | `applyCast`, `legalTargets`, `planManaPayment`; `engine.test.ts` → "casting" |
| Triggered abilities | Ten event families raised where the rules say they happen (`enters-battlefield`, `dies`, `attacks`, `blocks`, `deals-combat-damage-to-player`, `becomes-tapped`, `spell-cast`, `upkeep`, `draw-step`, `end-step`), each with a subject so "another creature you control" excludes the source. Queued triggers are ordered APNAP, go on top of a non-empty stack, and choose their targets as they are put on it — auto when one is legal, as a real choice when several are, removed when none is. Optional effects still pause on a server-side yes/no choice. | `GameEvent`/`raiseEvent`/`apnapOrder`/`putNextTriggerOnStack` in `packages/rules/src/engine.ts`, `TRIGGER_TEMPLATES` in `characteristics.ts`; `engine.test.ts` → "triggered abilities" (9 cases) |
| Activated abilities | Mana abilities resolve immediately and never use the stack; non-mana activations are announced, paid and put on the stack like a spell. Costs cover mana, `{T}`, paying life, removing source counters, discarding a chosen hand card, exiling chosen cards from a graveyard, sacrificing the source or typed/another permanents, and choosing tap/sacrifice costs. A source that taps for its own ability is removed from its mana sources first. | `activatableAbility`/`applyActivate`/`applyActivateMana` in `engine.ts`, `parseActivatedAbility` in `characteristics.ts`; `engine.test.ts` → activated-ability and discard/exile-cost scenarios |
| Oracle reading | The printed name **and** the modern "this land" / "this creature" self reference both normalise to `~`, so current reprints parse. A mana clause must consume its whole sentence, so a restricted "any color that a land an opponent controls could produce" is not read as five free colours. | `normalizedOracle`, `parseAddClause`; `characteristics.test.ts` → "faces and oracle normalisation" |
| Commander | Command-zone start, `{2}` tax per previous cast, return-to-command-zone on death, 21-damage elimination tracked per commander. | `commanderTax`, `movePermanentToZone`; `engine.test.ts` → "commander rules" |
| Combat | Attack declaration with per-attacker defender choice, blocks, first/double strike sub-step, deathtouch, trample, lifelink, vigilance, menace, flying/reach restrictions, defender, haste, summoning sickness, printed attack/block restrictions, attack requirements, and basic/legendary landwalk. | `computeCombatDamage`, `CombatRules`; `engine.test.ts` → combat scenarios |
| State-based actions | Lethal damage, zero toughness, indestructible, legend rule, 0 life, empty-library draw, 21 commander damage, last player standing. | `applyStateBasedActions`; `engine.test.ts` → "state-based actions" |
| P/T and counters | Entry counters, counter costs on mana abilities, temporary creature P/T modifiers and cleanup expiration. | `CounterCost`, `powerOf`, `toughnessOf`, `applyEffect`; `engine.test.ts` → Vivid/Infest scenarios |
| Privacy | A projection contains the viewer's hand and nothing hidden from any other seat — not the cards, not their identifiers. | `packages/rules/src/projection.ts`; asserted in `engine.test.ts`, `real-decks.test.ts` and the engine matrix |
| Bot | Plays only from the same `legalActions` list a human receives: lands, castables, attack and block heuristics, target selection. | `packages/rules/src/bot.ts` |
| Server | Match registry with seat-bound secret tokens, bots driven between human decisions, per-seat projections, Socket.IO update notifications. | `services/match-server/src/matches.ts` |
| Client | Full-viewport table: three opponents share one seamless band at full width, the local player owns the lower band, and the stack, legal actions, zones and priority all live in the player dock so nothing floats over a board. Land/nonland rows are oriented per seat, the hand fans and lifts, drag-to-play gives the card a 3D-tilted ghost, a hover preview shows Oracle text plus rules coverage, the log is a toggleable drawer with per-seat colours and linked card names, mana renders as pips, and cards open an internal page. Hidden library searches use a name input rather than leaking candidate identities. Every permanent shows an original SVG icon per enforced keyword, activation family and trigger event; an icon opens a help card with the rule and what the engine enforces, and a permanent with several activations opens an ability menu. | `apps/client/src/main.ts`, `abilities.ts`, `styles.css` |
| Library search | While resolving a search, the controller sees every legal candidate as a card grid and can click one or type its name. A local toggle reveals the full own library for inspection; opponents receive `null`. | `LibrarySearchView` in `packages/rules/src/projection.ts`, `librarySearchHtml` in `apps/client/src/main.ts` |
| Edition coverage | All 708 catalog editions are ordered by release date under a stable base `group` plus navigable `subgroup`; Commander is split by year, promos by origin/year or source set, and regular expansions by historical block. The global chart is summary-only and an edition detail lists pending `oracle_id` cards. | `tools/rules/export_set_coverage.py`, `/api/rules/coverage/sets`, `openCoverage` |
| Touch layout | Landscape-first for Android and tablets: same shape, but the board shrinks and the hand grows past it, tap targets clear 34–44px and the hover preview is disabled. Portrait stacks the boards and asks the player to rotate. A topbar toggle forces it on a desktop. | `styles.css` touch section; `docs/ANDROID.md` |
| Rulings | 78,912 Wizards rulings keyed by `oracle_id`, served from the local catalog on the card page. | `tools/card_catalog/sync_rulings.py`, `/api/catalog/card/:id` |
| Card data | 117,621 printings with rules fields (power/toughness/loyalty, produced mana, faces) and printing fields (promo, frame, finishes, set type) plus a precomputed `printing_rank`. | `tools/card_catalog/sync_scryfall.py` |
| Catalog search | One row per card — the latest regular core/expansion printing by default, excluding promo/variation treatments — with a clickable gallery of all documented printings grouped into main and special/promotional sets. | `bestPrintingSelect` and `printings_list` in `services/match-server/src/index.ts`; `main.ts` gallery |
| Precons | Commander deck products grouped by set with set icons; collector-labelled deck variants are filtered from the selectable list. The two requested box-render overrides are wired for Mind Seize and Power Hungry; other products retain their documented fallback until an approved source is added. | `tools/decks/import_commander_precons.py`, `/api/decks/precons?grouped=1` |

### Last verification run

```text
npm run check           rules build + rules/client/server typecheck        PASS
npm test                Vitest 5 files / 182 tests + Python smoke tests    PASS
npm run simulate:engine 200 seeded games in 12.99s                         PASS
                        finished 160, unfinished 40, avg 51.09 turns
                        0 invariant failures, 0 projection leaks
npm run rules:cr:sync  3,162 structured CR rules -> Markdown snapshot      PASS
npm run rules:engine:export  38,711 cards; 6,816 fully implemented         PASS
npm run rules:set:coverage  708 editions; 14.4% membership coverage        PASS
```

The matrix now finishes 160 of 200 games (was 105 before activations and 100
before this pass): fetch lands, ramp and death triggers actually run, so games
reach a real result more often.

Browser smoke test at `http://localhost:5173` against the local server on
`http://localhost:8787`: a cEDH pod starts, a land is played, its mana ability
menu opens with one row per producible colour, clicking an ability icon opens the
keyword help card, and the hand honestly marks partially implemented cards.

## Truth boundaries — do not overstate these

1. **Card text is mostly not executed.** `characteristics.ts` recognises a closed set of templates: draw N, gain N life, each opponent loses N life, "~ deals N/X damage to any target", damage to each opponent, target destruction/exile/bounce restrictions, destroy all creatures, counter target spell, common library searches to top/hand/graveyard/battlefield, entry/cost counter templates and a small set of temporary P/T modifiers, plus the Frostboil-style replacement choice. The C13 report is the current queue and must be regenerated after changes. Fireball's first-target/X branch is tested, but its additional-target cost and damage distribution are not. Every other card plays as a real body with real types, power/toughness and combat keywords, and both the hand tooltip and the card page say so. Never claim "all cards work".
2. **What triggers and activations still do not cover.** Activated abilities now cover costs made of mana, `{T}`, `{Q}`, paying life, energy, removing source counters, discarding a chosen hand card, exiling chosen graveyard cards, and sacrificing the source or supported other permanents. Still unsupported activation costs are deliberately left out rather than approximated: arbitrary multi-zone/permanent costs not represented by structured fields. Triggers cover the supported event families with APNAP ordering, intervening-if checks, meaningful same-controller ordering choices, and targets; delayed triggers are implemented for the current draw/mana/return families, while general delayed/state triggers and broader zone-change templates remain pending. Proliferation is implemented as a reusable player/permanent-counter primitive; general static/continuous effects, layer dependencies, tokens with copied characteristics, and mulligans remain pending. Frostboil Snarl remains a separate entering replacement effect documented in `docs/RULES_RESEARCH.md`.
3. **The bot is a heuristic, not a strong opponent.** Its win rates are not balance data.
4. **There is no authentication, persistence, matchmaking or reconnect.** Matches live in one process's memory and are lost on restart. Seat tokens stop a client from claiming another seat; they are not a security system.
5. **Precon cover art is mixed by provenance.** Mind Seize and Power Hungry use the user-provided product-render URLs and are marked `product_box_render`; other products may still use the display commander's Scryfall art crop until an approved product image is added. Do not present the fallback as box art.
6. **Only 100-card Commander deck products are imported.** "Commander Arsenal", "Commander Anthology" and similar are MTGJSON *Box Sets* — collections of singles, not decks — so they have no deck to play and are correctly absent.
7. **Card data and images remain subject to upstream terms.** Images are linked from the provider on demand. Do not bulk download, re-encode or mirror art without a rights review.
8. **The Python simulators (`simulate_cedh_pod.py`, `run_ai_matrix.py`) are metadata heuristics, not the game engine.** `npm run simulate:engine` is the real regression matrix; prefer it. The Python ones are kept only as cheap deck-plumbing smoke tests.
9. **Ability icons are this project's own artwork.** `apps/client/src/abilities.ts` contains original SVG paths. MTG Arena was studied only as a reference for where an icon helps; its icons are Wizards of the Coast game assets, are not redistributable, and a fandom wiki hosting them does not make them free. Do not import them.
10. **Forge integration has not happened.** `docs/FORGE_INTEGRATION.md` records the GPLv3 review and the separate-component option; the local unsigned permission note is not treated as a source licence or as a reason to bypass the repository policy.
11. **The full-library search view is intentional information disclosure.** It is only projected to the player resolving their own search, and only while that pending choice exists. It must not be generalized to ordinary library viewing or opponent projections.

## Repository map

```text
apps/client/                    Vite TypeScript client
  src/main.ts                   table rendering, interaction, dialogs
  src/styles.css                full-viewport layout and card styling
  src/abilities.ts              original keyword/ability SVG set + rule help text
packages/rules/                 authoritative engine (pure, deterministic)
  src/mana.ts                   symbols, pools, payment solver
  src/characteristics.ts        card profiles + the closed Oracle template set
  src/engine.ts                 state, legal actions, stack, combat, SBAs
  src/projection.ts             the per-seat security boundary
  src/bot.ts                    bot policy over legal actions only
  src/simulator.ts              coarse metadata simulator (legacy tooling)
  src/*.test.ts                 163 Vitest specs
services/match-server/
  src/matches.ts                match registry, seat tokens, bot driving
  src/index.ts                  REST + Socket.IO, catalog and deck endpoints
tools/card_catalog/
  sync_scryfall.py              full bulk import with rules + printing fields
  enrich_catalog.py             backfill for a catalog built by the old schema
tools/decks/                    cEDH and MTGJSON Commander importers, deck enricher
tools/simulator/
  run_engine_matrix.ts          seeded regression over the real engine
  *.py                          legacy metadata smoke tests
tools/rules/
  compile_card_rules.py         local 38k-card rules inventory compiler
  export_engine_profiles.ts      actual profile export through packages/rules
  sync_comprehensive_rules.py    Academy Ruins structured CR -> local Markdown
data/                           generated, gitignored
```

## Commands

From the repository root:

```powershell
npm install
npm run dev:server        # Fastify + Socket.IO on http://localhost:8787
npm run dev               # Vite client on http://localhost:5173
npm run check             # build rules, then typecheck rules/client/server
npm test                  # rules Vitest specs + Python smoke tests
npm run simulate:engine   # 200 seeded games through the real engine
npm run rules:pool:sync   # 1,500-card EDHREC popularity pool in data/rules
npm run rules:compile     # 38k-card rules-family inventory in data/rules
npm run rules:engine:export # actual engine profile for each unique card
npm run rules:roadmap     # rank the primitives that finish the most cards next
npm run rules:roadmap:c13  # same ROI queue limited to Commander 2013
npm run rules:workers      # assign the current primitive queue to 5 bounded workers
python tools/rules/plan_primitive_workers.py --roadmap data/rules/primitive-roadmap-c13.json --claims docs/WORK_CLAIMS.md --workers 5 --memory-budget-gb 2 --max-cards-per-commit 20 --output data/rules/primitive-worker-plan-c13.json --prompt-output docs/PRIMITIVE_WORKERS_C13.md
npm run build             # production builds
```

`docs/PRIMITIVE_ROADMAP_C13.md` is the current C13 work queue. Regenerate it
after each integrated batch; contributors claim only disjoint entries and use
the listed `oracle_id`s. The public progress map is generated from the slim
`site/coverage.json` snapshot and deployed by `.github/workflows/pages.yml` on
push to `main` or `master`; refresh the snapshot after a coverage change with:

```powershell
python tools/rules/export_set_coverage.py --catalog data/catalog/prossh.sqlite --profiles data/rules/engine-card-profiles.json --output data/rules/set-coverage.json --markdown data/rules/set-coverage-current.md
python tools/rules/build_progress_site.py --input data/rules/set-coverage.json --output site/coverage.json
```

Generate data in this order (a fresh clone has none):

```powershell
npm run catalog:sync      # ~117k printings into data/catalog/prossh.sqlite
npm run decks:sync        # cEDH DDB profiles (supporting source)
npm run decks:pod:sync    # the four-deck cEDH pod
npm run precons:sync      # all 192 Commander precon products
npm run rulings:sync      # ~79k Wizards rulings, keyed by oracle_id
```

`catalog:enrich` and `decks:enrich` exist only to upgrade data produced by the pre-2026-09-03 catalog schema. After a fresh `catalog:sync` they are unnecessary — the importers read the new columns directly.

## HTTP surface

| Endpoint | Purpose | Limitation |
| --- | --- | --- |
| `GET /health` | liveness and match count | no auth |
| `GET /api/catalog/search?q=` | one row per card, best printing; `t:type` supported | local catalog only unless it is missing |
| `GET /api/catalog/card/:id` | internal card page: printings list and rulings | falls back to Scryfall on a local miss |
| `GET /api/catalog/named?name=` | one printing by exact name | provider fallback only |
| `GET /api/catalog/status` | catalog availability | exposes a local path; development only |
| `GET /api/decks/active-pod` | imported cEDH pod summary | no ownership or legality checks |
| `GET /api/decks/precons?grouped=1` | products with set icons and their decks | cover art is commander art, not box art |
| `POST /api/matches` | `{ mode: "cedh" \| "precon", deckId?, seed? }` → `{ matchId, seat, token, view }` | in-memory, unauthenticated |
| `GET /api/matches/:id?token=` | that seat's projection | wrong token → 404 |
| `POST /api/matches/:id/action` | `{ token, action }`; rejected unless that seat owes the decision | |
| `POST /api/matches/:id/settings` | `{ token, autoPass }` | |
| `GET /api/simulations/engine-matrix` | latest matrix report | must be generated locally |
| `GET /api/rules/coverage/sets` | chronological set summaries for the web chart | regenerate with `npm run rules:set:coverage` |
| `GET /api/rules/coverage/sets/:code` | one edition and its pending `oracle_id` cards | same generated report |

## How the engine is put together

`GameState` is immutable; every change goes through `applyAction(state, seat, action)`, which validates against `legalActions(state, seat)` and then calls `settle`.

`settle` is the piece that makes the table playable. It loops until a player genuinely owes a decision: it applies state-based actions, prunes combat, resolves steps that never open priority, auto-submits attack/block declarations nobody can make, and auto-passes any seat whose only legal action is to pass. That is why the deadlocks are gone and why a spell nobody can respond to resolves without asking for four empty clicks.

`planManaPayment` decides which permanents to tap. Colored requirements are satisfied first from the floating pool, then from the least flexible untapped source that can produce the colour, so a dual land stays free for the requirement only it can cover; the rest is paid by tapping further sources until `payCost` validates the whole cost. Interchangeable sources share one search branch and a node budget guarantees termination.

## Latest verified batch

### Cooperative C13 cluster: Equipment

`codex/c13-equipment-cluster` adds the reusable Equipment primitive. The
profile recognises `Equip {cost}` plus static bonuses and granted combat
keywords for Behemoth Sledge, Swiftfoot Boots and Sword of the Paruns. The
engine exposes `equip` as a targeted activated ability, pays the cost, puts it
on the stack, attaches on resolution, applies the bonus through power/
toughness and keyword calculation, and detaches it when its creature leaves or
stops being a creature. The client can select the controlled creature through
the normal target flow. Coverage counts are intentionally not regenerated in
this isolated worktree; the integrator should run the C13 coverage exporter
after merging.

Rules reference: Comprehensive Rules 301.5, 602.1, 608.2b and 704.5q;
official source: `https://magic.wizards.com/en/rules`.

Validation after integration: `npm run check` and `npm test` pass (160 rules
tests; simulator and 9 Python compiler tests pass).

The current batch adds reusable modal choices, exact artifact/enchantment/land
target restrictions, player-or-planeswalker targets, and the
artifact/creature/enchantment board sweep. `compile_oracle_effects.py` also
supports deterministic bounded card/primitives batches.
- Landcycling is now a first-class cycling variant: each printed subtype cost
  becomes its own legal action, searches only matching lands, reveals and puts
  the chosen land into hand, and correctly discards the cycling card first.
- Parallel work now has a scope protocol in `docs/WORK_CLAIMS.md`, a PR claim
  template, and a Codex read-only PR debugger in
  `.github/workflows/codex-debug.yml`; claims must be published before code so
  workers do not duplicate a primitive.
- Worker delivery is now deterministic: each fork reports its base SHA and
  exact commit SHA, stages only explicit claim files, and is integrated with
  `git cherry-pick` followed by the full check/test/simulation gate. See
  `docs/AI_CONTRIBUTOR.md` for the copy-paste worker prompt and recovery path
  for conflicts.
- `docs/COOPERATIVE_BATCH_PROMPT.md` is the short prompt for fresh workers.
  The Oracle IR now persists reusable `operands` (actions, zones, card types
  and subtypes), so Equipment, battlefield and similar nouns are not re-learned
  for every card; its Python regression suite passes 13 tests.

Validation: 182 rules tests, workspace TypeScript checks, simulator smoke tests
and 13 Python compiler regressions pass. C13 is 125/356 unique cards implemented
(35.1%); generated coverage remains in `data/rules/coverage-c13.md`.

The Oracle compiler now accepts `--workers`, `--backend`, `--batch-size`,
`--memory-budget-gb`, and `--estimated-worker-mb`. Its default five-process
batch stays below the 2 GB scheduler budget, preserves deterministic order,
and was measured at roughly 484–500 MB RSS for the full 38,711-card catalog.
Five workers are not automatically faster for the current lightweight parser;
the budget is ready for heavier primitive/review tasks without spawning an
unbounded pool.

### Reusable Scry primitive

`SpellEffect.kind === "scry"` stores the numeric amount instead of creating a
card-specific implementation. The engine peeks at `min(N, library.length)`
cards and gives only the resolving player private choices. Each choice puts one
card on top or appends it to the bottom; ordinal slots keep duplicate names
distinct. Selecting top cards prepends them so the player can determine the
final top order. Scry 1 therefore uses the same flow with one choice, while
Scry 2 and larger values expose the full arbitrary partition and ordering
allowed by the rule. Countered spells never open the choice; empty or short
libraries finish without inventing cards.

Rules reference: Comprehensive Rules 701.22a–d; official Wizards source:
`https://magic.wizards.com/en/rules`.

### Reusable top-card reveal and mana-value primitive

`reveal-top-card-to-hand-and-gain-mana-value` handles the shared shape used by
C13 Augury Adept: reveal exactly one card, move that card to its controller's
hand, then gain life equal to that card's mana value. The Python Oracle IR now
retains `reveal-top:hand` and `amount:mana-value` operands, so later cards reuse
the primitive instead of reparsing the nouns. An empty library reveals nothing;
life gain remains subject to existing prevention. Scenario coverage includes a
combat-damage trigger and a four-mana-value revealed card.

Rules reference: Comprehensive Rules 701.16, 608.2c and 119.3; official
Wizards source: `https://magic.wizards.com/en/rules`.

### Reusable reveal-until type primitive

`reveal-until-type-to-hand` models Foster's optional `{1}` death trigger with
the type preserved as an operand: reveal from the top until a Creature card,
put the hit into hand, and move only the preceding revealed cards to the
graveyard. If no matching card exists, the whole library is moved to the
graveyard. The Python IR emits `reveal-until:<Type>:hand:graveyard`, allowing
future artifact, land, or other type variants to reuse the same effect.

Rules reference: Comprehensive Rules 701.16, 701.13 and 603.2; official
Wizards source: `https://magic.wizards.com/en/rules`.

### Reusable triggered self-modifier primitive

The parser maps `~ gets +N/+N and gains <keyword> until end of turn` inside a
trigger to `modify-triggered-creature-and-grant-keyword`. Resolution targets
the triggering permanent's stable instance ID, applies the temporary Layer 7c
modifier and records the keyword in the same cleanup-expiring state used by
other temporary grants. This covers C13 Baloth Woodcrasher's Landfall without
embedding its name; other numeric bonuses and supported combat keywords reuse
the template. Reminder text is ignored by Oracle normalization.

Rules reference: Comprehensive Rules 603.2, 613.4c and 611.2a; official
Wizards source: `https://magic.wizards.com/en/rules`.

## Recommended next sequence

The bottleneck has moved. Trigger *conditions* and activation *costs* are now
general; what limits coverage is the **effect vocabulary** they resolve into.
1,185 cards have a recognised trigger and 670 a recognised activation, but only
7,284 of 38,711 cards are fully implemented, because most printed effects are
still outside `SpellEffect`.

1. **Widen `SpellEffect`, one template plus one test at a time.** The highest
   value families, in order of how often they appear in the local catalog: put a
   +1/+1 counter, create a token, target player draws/discards, mill N, tap or
   untap target permanent, return target card from a graveyard, scry N, and
   "target creature gets +N/+N until end of turn". The first three need new state
   (counters and tokens); the rest do not.
2. **Counters on permanents and tokens.** Needed by the families above, and by
   the state-based actions that check them.
3. **Trigger follow-up coverage.** Intervening-if checks and meaningful
   same-controller ordering choices now exist, including projected legal
   actions and bot behavior. The remaining trigger work is delayed/state
   triggers and additional zone-change event families.
4. **More activation costs.** The next high-value costs are `{Q}`, energy,
   loyalty and any newly discovered structured cost family. Discard, graveyard
   exile, counter removal and typed/another-permanent costs already have
   authoritative selection and regression scenarios; extend those primitives
   instead of creating card-specific branches.
5. **Continuous effects and layers.** Needed before anything that pumps, grants
   keywords, or changes types can be trusted.
6. **Persistence and identity.** Replace the in-memory registry with
   PostgreSQL/Redis, authenticated seats, event streams with versions, reconnects,
   and server-side priority timeouts.
7. **Deck construction and the collection.** Build on `oracle_id`/`scryfall_id`
   and the structured columns; wishlist pricing is a separate opt-in feature and
   must always carry a source and refresh timestamp.
8. **Precon box art.** Continue adding approved product renders with
   provenance/licence; the ChromaKey cleanup must only be applied to those
   box-render assets, never broadly to card art.
9. **Android build.** The client is landscape-ready and the touch layout is
   implemented, but no Capacitor project has been generated. `docs/ANDROID.md` has
   the setup, the orientation lock and the four things that must be settled first
   — chiefly a configurable server base URL, since a packaged app has no Vite
   proxy.

## Working style constraints

- Keep user-facing status and final replies in Spanish. English is fine inside code and docs.
- Update this file after every material functional change: source location, verified behaviour, remaining boundary, exact validation command and result.
- Generated `data/` stays out of Git. If a service cannot find data, run the sync order above instead of adding placeholders.
- Do not claim the game is "fully playable" or that "all cards work" until rules coverage and authenticated online flows actually prove it.
- Treat new card images and external data as licence and provenance decisions, not implementation conveniences.

### Current C13 primitive batch (2026-09-04)

The active C13 batch now covers typed activated costs for sacrificing artifacts,
enchantments, lands, noncreature permanents, and tokens; choosing a discard
from hand; exiling a chosen card from the controller's graveyard; generic and
`another` permanent ETB subjects; player-wide spell-cast subjects; and moving
graveyard cards to the library bottom or through a deterministic shuffle.
Explicit cost selections are validated by the authoritative engine instead of
silently falling back to another card. Python compilation preserves
`sacrifice_types`, `cost_actions`, and `trigger_subject` for reusable worker
clusters. These behaviours follow CR 117.3b, 400.7, 602.2b, and 603.2–603.3;
printed text outside the closed templates remains pending.

The next incremental extension adds `permanent-card-in-your-graveyard` and
`permanent-card-in-a-graveyard` target families. They accept only cards whose
current characteristics are permanents and put the card onto the battlefield
under the resolving effect's controller; ownership and graveyard removal stay
with the original card owner. This keeps cross-graveyard visibility explicit
and player-scoped.

Validation: `npm run check --workspace=@prossh/rules`, `npm run
test --workspace=@prossh/rules`, and `python
tools/rules/test_compile_oracle_effects.py` PASS; latest rules result 274
passed, 6 skipped, compiler result 23 passed.

### Reusable untap restriction and source-untap primitive

The profile records `doesNotUntapDuringUntap` for the static text “This
artifact doesn't untap during your untap step.” The turn engine respects it
only during the untap step, while a separate `untap-source` activated effect
resolves through the stack and can untap the controlled source normally. The
parser accepts straight and typographic apostrophes and normalizes self names,
so Basalt Monolith is a C13 application of the primitive rather than a named
exception. Its `{T}: Add {C}{C}{C}` mana ability remains the existing generic
structured-mana path.

Rules reference: Comprehensive Rules 502.2, 602.1 and 701.21; official
Wizards source: `https://magic.wizards.com/en/rules`.

### C13 reuse verification: basic effect families

Borrowing 100,000 Arrows, Blood Rites, Carnage Altar and Baleful Force now
have C13 scenarios that exercise existing primitives instead of adding named
branches: tapped-creature-count draw, typed creature sacrifice costs,
any-target damage, ordinary draw, and upkeep draw-plus-life-loss. The
“target opponent” wording is represented by a reusable opponent-only target
kind, preventing the caster from being selected. Coverage marks use each
printing's stable Scryfall ID; other printings with the same `oracle_id` reuse
the same profile.

Rules reference: Comprehensive Rules 109.5, 601.2c and 115.1; official
Wizards source: `https://magic.wizards.com/en/rules`.

## Cooperative C13 cluster: Level Up
### Cooperative C13 cluster: typed tap activation costs

The activation parser now turns `Tap an untapped [subtype] you control` into
the reusable `tapsCreature` cost descriptor. It supports both `any` and
`another`, treats subtype matching case-insensitively, and leaves the source
eligible when the text does not say `another`; Azami, Lady of Scrolls is the
C13 application. `legalActions` exposes one action per eligible permanent
with a stable `tapId`, while the authoritative apply path revalidates the
choice and taps it before putting the ability on the stack. Summoning sickness
does not block this cost because it is not a tap-symbol activation cost.

The scope is deliberately separate from `{T}` source costs, mana abilities,
crew, and multi-cost payment ordering. Future cards using the same wording
reuse this descriptor without card-name branches. This follows Comprehensive
Rules 117.3b, 601.2g, 602.2b and 701.21; official Wizards source:
`https://magic.wizards.com/en/rules`.

Validation: `npm run check --workspace=@prossh/rules` PASS and `npm test
--workspace=@prossh/rules` PASS — 362 passed, 6 skipped.

### Cooperative C13 cluster: draw spells and Flashback life payments

Brilliant Plan and Harmonize reuse the shared `draw` effect, Vision Skeins
reuses `each-player-draw`, and Deep Analysis reuses `draw-target-player` plus
the existing Flashback cast path. The Flashback parser now accepts Oracle's
typographic `Flashback—` separator and extracts an additional `Pay N life`
component instead of treating it as an invalid mana cost. The authoritative
cast path reserves and pays that life, exposes it in the action label, and
still exiles the spell after resolution. Insufficient life removes the
Flashback action; target draw remains subject to normal target legality.

Rules reference: Comprehensive Rules 601.2, 601.2f, 702.34 and 118.4;
official Wizards source: `https://magic.wizards.com/en/rules`.

Validation: `npm run check --workspace=@prossh/rules` PASS and `npm test
--workspace=@prossh/rules` PASS — 367 passed, 6 skipped.

### Cooperative C13 cluster: ETB draw and destroy-then-draw reuse

Baleful Strix now verifies the existing ETB draw trigger and flying/deathtouch
characteristics as a C13 printing. Phyrexian Gargantua generalizes the
compound `draw N and lose N life` recognizer, so its ETB uses the same ordered
draw and life-loss effects without a card-specific branch. Annihilate verifies
that typed nonblack-creature destruction and the shared draw effect resolve in
sequence, while black creatures remain illegal targets.

Rules reference: Comprehensive Rules 603.2, 608.2b, 608.2c and 700.4;
official Wizards source: `https://magic.wizards.com/en/rules`.

Validation: `npm run check --workspace=@prossh/rules` PASS and `npm test
--workspace=@prossh/rules` PASS — 373 passed, 6 skipped.

### Cooperative C13 cluster: Arcane Denial delayed draws

Arcane Denial is compiled into one parameterized counter effect with two
delayed upkeep draws: its target's controller may choose 0 through 2 cards and
the caster draws 1. The delayed entries are queued for the next turn's upkeep,
then become ordinary triggers and preserve player-private choice handling.
The `choose-draw` action clamps to the remaining library, is exposed only to
the owed player, and is supported by the deterministic bot. This keeps the
primitive reusable for future counterspells with different delayed amounts,
without a card-name branch.

Rules reference: Comprehensive Rules 603.3, 603.7, 608.2b and 121.1;
official Wizards source: `https://magic.wizards.com/en/rules`.

Validation: `npm run check --workspace=@prossh/rules` PASS; targeted Arcane
Denial tests PASS (4 tests). Full workspace tests should be rerun after
integration.

### Cooperative C13 cluster: Bane of Progress sweep

Bane of Progress reuses a parameterized ETB primitive that destroys every
artifact and enchantment permanent that is not indestructible, counts the
permanents destroyed across all players, and puts that many counters on the
triggering source. The source is resolved through its stable permanent ID, so
the effect remains correct if the source leaves before its trigger resolves;
countering the ETB prevents the sweep. The compiler's primitive inventory also
preserves delayed-draw amounts and optionality, so future counterspell variants
join the same review family instead of being rediscovered card by card.

Rules reference: Comprehensive Rules 603.2, 603.3d, 608.2b, 701.8, 122.1 and
122.6;
official Wizards source: `https://magic.wizards.com/en/rules`.

Validation: `npm run check --workspace=@prossh/rules` PASS; Bane of Progress
scenarios and the Python compiler suite PASS. Full workspace tests should be
rerun after integration.

### Cooperative C13 cluster: private top-N selection

The C13 Augur of Bolas fixture now uses a parameterized `look-top-select`
primitive. It privately exposes the top N cards to the controller, offers only
matching card types for the optional hand selection, then requires the
remaining cards to be ordered on the bottom. The primitive is deliberately
name-independent so future “look at the top N ...” cards can reuse it.

The engine keeps the viewed cards out of every other player's projection and
uses ordinal actions rather than leaking library instance IDs. The parser
extracts N and the requested card types from Oracle text. Scenarios cover
selecting an instant, declining, ordering the remainder, and opponent
privacy. This follows CR 401.1, 401.4, 401.5, 701.20e and 701.23a; verify
against the official [Wizards Comprehensive Rules](https://magic.wizards.com/en/rules).

### Cooperative C13 cluster: Act of Authority control transfer

Act of Authority now reuses the typed artifact/enchantment exile effect. Its
ETB trigger exiles the chosen permanent without transferring the source; its
upkeep trigger uses the parameterized `gainSourceControl: target-controller`
variant after a successful exile. Controller movement preserves the same
permanent instance and is applied only if the source remains on the
battlefield. Tests cover target selection, optional resolution, exile, and
upkeep transfer. The control-change behavior is grounded in CR 110.2, 110.5,
701.20 and 701.23a; confirm against the official [Wizards Comprehensive
Rules](https://magic.wizards.com/en/rules).

### Cooperative C13 cluster: Level Up

This branch adds the reusable Level Up primitive. `Level up {cost}` is exposed
as a sorcery-speed activated ability, pays through the existing mana planner,
uses the stack, and adds one public `level` counter only when it resolves.
Level bands provide current P/T and enforced keywords through the normal
state-aware characteristic functions; printed abilities inside those bands
remain explicitly pending until their own primitives land. This follows CR
702.87 and 711.2. The scenario covers payment, stack resolution, level 0/1
versus level 2 characteristics, and level-granted hexproof target restriction.

Validation for this isolated batch: `npm test --workspace=@prossh/rules --
--run packages/rules/src/engine.test.ts` — 150 passed, 6 skipped. Full checks
must be rerun after cherry-picking into the integrator branch.

### Cooperative C13 cluster: targeted Tap and Untap

The same branch adds reusable `Tap target creature` and `Untap target
permanent` effects. Both use normal target legality, stack resolution, and
the existing tap-event bus; the scope intentionally excludes mass effects,
continuous “doesn't untap” restrictions, and multi-target costs. This follows
CR 701.21 and 701.22. Scenario coverage verifies target metadata, tap
resolution, untap resolution, and reuse of the generic cast path.

Validation: `npm run check` PASS; `npm test` PASS (151 rules tests, 6 skipped,
simulator and oracle tests PASS).

### Cooperative C13 cluster: targeted Mill

The branch adds `Target player mills N cards` as a reusable zone-change
primitive. It moves only the selected player's top cards to that player's
graveyard, preserves order, and uses the existing player target and stack
resolution path. The scope excludes milling each opponent, replacement
effects, and cards that inspect the milled cards. This follows CR 701.13.
Scenario coverage verifies the target metadata, exact count, order, and that
the caster's zones are untouched.

Validation: `npm test --workspace=@prossh/rules -- --run
packages/rules/src/engine.test.ts` PASS (152 passed, 6 skipped).

### Cooperative C13 cluster: counter target restrictions

The parser and target resolver now share reusable `creature-spell` and
`noncreature-spell` families for counterspells. They filter the current stack
to cast spells (not activated or triggered abilities) and reuse the existing
`counter-target-spell` resolution. The unrestricted `spell` family remains
backward-compatible for the existing ability-counter scenario. This follows
CR 601.2c and 608.2b. Scenario coverage verifies both filters against a
creature spell and an instant on the stack.

Validation: `npm run check` PASS; `npm test --workspace=@prossh/rules -- --run
packages/rules/src/engine.test.ts` PASS (163 passed).

### Cooperative C13 cluster: counters on target creatures

The branch adds the reusable `Put N +1/+1 or -1/-1 counter(s) on target
creature` effect. It updates the existing public counter map, so the normal
P/T calculation and state-based actions immediately see the result. This
follows CR 122.1 and 701.4. Scenario coverage verifies parsing, target
resolution, and both P/T values after a resolved counter.

Validation: `npm run check` PASS; targeted engine tests PASS (163 passed).

### Cooperative C13 cluster: target-player discard

The branch adds `Target player discards a card` with a server-side pending
choice. The affected player sees only their own hand and chooses the card;
the chosen card then moves to that player's graveyard. No deterministic card
selection is hidden behind the UI. This follows CR 701.8 and 400.1. Scenario
coverage verifies the pending seat, both visible choices, selected-card
movement, and completion of the choice.

Validation: `npm run check` PASS; targeted engine tests PASS (163 passed).

### Cooperative C13 cluster: life-gained triggers

The branch adds a reusable `life-gained` event raised by explicit life-gain
effects and lifelink. It recognizes `Whenever you gain life` and resolves a
source counter effect such as `put a +1/+1 counter on ~`; the source is tracked
by permanent instance ID, not display name. This follows CR 603.2, 119.3 and
122.1. Scenario coverage verifies one event, stack ordering, and the counter
after resolution. The scope excludes replacement/prevention effects, batches
of simultaneous gains, and printed triggers with additional costs.

Validation after integration: `npm run check` PASS; `npm test` PASS (164 rules
tests, simulator and 11 Python compiler tests).

### Cooperative C13 cluster: target-player life gain

The branch adds `Target player gains N life` as a reusable targeted effect.
It uses the normal player-target legality path and raises `life-gained` for the
chosen seat, so dependent triggers observe the actual recipient rather than
the spell controller. This follows CR 119.3 and 601.2c. Scenario coverage
verifies target metadata and that only the chosen player's life changes. The
scope excludes split effects, life-total setting, and replacement/prevention
effects.

Validation after integration: `npm run check` PASS; `npm test` PASS (165 rules
tests, simulator and 11 Python compiler tests).

### Cooperative C13 cluster: each-player life gain

The branch adds `Each player gains N life` as a reusable global effect. It
skips eliminated players and raises one `life-gained` event per living
recipient, preserving the trigger bus semantics for dependent abilities. This
follows CR 119.3 and 608.2c. Scenario coverage verifies both players receive
life and the effect is recognised. The scope excludes replacement/prevention
effects and simultaneous-event batching beyond the per-recipient events.

Validation after integration: `npm run check` PASS; `npm test` PASS (166 rules
tests, simulator and 11 Python compiler tests).

### Cooperative C13 cluster: target-player life loss

The branch adds `Target player loses N life` as a reusable player-targeted
effect. It changes only the target's life total and deliberately does not use
the damage pipeline, matching CR 118.2 and 119.4. Scenario coverage verifies
target selection and distinguishes life loss from damage. The scope excludes
life-loss triggers, replacement/prevention effects, and multi-player variants.

Validation after integration: `npm run check` PASS; `npm test` PASS (168 rules
tests, simulator and 11 Python compiler tests).

### Cooperative C13 clusters: reusable life loss and zone primitives

The accumulated fork batch adds `You lose N life`, `Each player loses N life`,
and `Whenever you lose life` as reusable effects/events, with loss kept distinct
from damage. It also preserves tapped state on created tokens and supports
returning a target card of the requested type from its controller's graveyard
to hand. Scenario tests cover controller scope, living-player filtering,
life-loss event propagation, stable graveyard targets, fizzling and projection.

Integrated fork commits: `67f92db`, `6d128b6`, `3d4ab69`, `19ae957`, `ff80bd1`.
Validation after the batch: `npm run check` PASS; `npm test` PASS (173 rules
tests, simulator and 11 Python compiler tests). Limits remain replacement and
prevention effects, opponent-graveyard selection and copy/multiplier tokens.

### Batched fork integration: C13 zones, draw, mill, counters and combat

The next 11 fork commits were processed as one batch. New reusable coverage
includes graveyard card targets in the client, exiling/returning cards from a
graveyard, returning to library top, X-scaled draw and life loss, opponent draw
and mill, subtype-wide and all-creature counters, land-count token scaling, and
any-creature combat-damage triggers. The changes remain type- and
instance-aware; no card-name exceptions were added.

Integrated commits: `c518638`, `d554c36`, `00be19b`, `015e495`, `85f46f8`,
`1d6be6d`, `47e23f6`, `5311b7f`, `4b0fa92`, `fa5b4bd`, `160e3b4`.
Validation: `npm run check` PASS; `npm test` PASS (182 rules tests, simulator
and 12 Python compiler tests); `npm run simulate:engine` PASS (200 games,
160 finished, 0 invariant/projection failures). C13 is now 125/356.

### C14 race batch: Firebreathing-style self pumps

`c14-self-pump` adds the `modify-source-creature` effect. `recognizeSentence`
now reads `~ gets +N/±N until end of turn` (the effect half of a Firebreathing
activation), and `parseActivatedAbility` already supplies the mana/`{T}`/life
cost. On resolution the engine applies a layer 7c P/T modifier to the ability's
source permanent only, reusing `modifyCreatures`; cleanup expires it (CR 613.4c,
514.2). Non-mana activation still goes on the stack. Scope excludes pumps that
also grant a keyword, target another creature, or scale with X.

Files: `packages/rules/src/characteristics.ts`, `packages/rules/src/engine.ts`,
`packages/rules/src/engine.test.ts` (one scenario: profile shape, stacked
activations, cleanup expiry).

Validation: `npm run check` PASS; `npm test --workspace=@prossh/rules` PASS
(198 rules tests); `npm run simulate:engine` PASS (200 games, 160 finished,
0 invariant/projection failures). Catalog fully-implemented 6,816 -> 6,995
(+179); Commander 2014 set coverage 90/337 -> 91/337 (Nantuko Shade). The
integrator should rerun `npm run rules:engine:export` and regenerate
`docs/PRIMITIVE_ROADMAP.md` / `data/rules/coverage-c14.md` after merge.

### C14 race batch: scry and combat-restricted damage

Second `c14-self-pump` batch, three reusable primitives:

- **Scry** (`scry` effect, CR 701.17). `recognizeSentence` reads `Scry N` and
  `Scry N, then draw M cards`. Resolution opens a `scry` pending choice that
  walks the top N cards one at a time: each is kept on top or sent to the
  bottom, then the library is rebuilt `[kept…, untouched remainder, bottomed…]`
  and any trailing `then draw` runs. Kept-pile reordering is not modelled. The
  bot keeps each card unless it is land-flooded (5+ lands in play and the card
  is a land). Works as a spell effect and, through the existing trigger bus, as
  `When ~ enters the battlefield, scry N`.
- **`~ deals N damage to target attacking or blocking creature`**: new
  `attacking-or-blocking-creature` target kind, filtered from
  `state.combat.attackers`/`blockers`, reusing `damage-any-target`.

Files: `packages/rules/src/characteristics.ts`, `engine.ts`, `projection.ts`,
`bot.ts`, `engine.test.ts` (describe "scry and combat-restricted damage",
4 scenarios).

Validation: `npm run check` PASS; `npm test --workspace=@prossh/rules` PASS
(202 rules tests); `npm run rules:test:oracle` PASS (22); `npm run
simulate:engine` PASS (200 games, 160 finished, 0 invariant/projection
failures). Catalog fully-implemented 6,995 -> 7,132; Commander 2014 91 -> 92/337
(Read the Bones). The C14 set tail is now mostly one-off primitives; per-batch
catalog yield stays high (+137) but per-batch C14 yield is small.

### C14 race batch: "it deals" triggers and filtered damage sweeps

- **Trigger self-reference**: `recognizeText` now rewrites a leading
  `it deals|gets|gains|enters|fights` in a triggered-ability clause to `~`, so
  "When ~ enters the battlefield, it deals 4 damage to target creature"
  (Flametongue Kavu and the whole "it deals" family) parses through the
  existing trigger bus and trigger-target flow.
- **Filtered board damage**: `damage-all-creatures` takes an optional
  `filter` (`nonartifact`, `without-flying`); `~ deals N damage to each
  nonartifact creature` / `each creature without flying` reuse it.

Files: `characteristics.ts`, `engine.ts`, `engine.test.ts` (2 scenarios).

Validation: `npm run check` PASS; `npm test --workspace=@prossh/rules` PASS
(204 rules tests); `npm run rules:test:oracle` PASS; `npm run simulate:engine`
PASS (200 games, 160 finished, 0 failures). Catalog 7,132 -> 7,210; Commander
2014 92 -> 94/337 (Flametongue Kavu, Whipflare).

### Fork exception batch: C13 and C14 follow-ups

The integrator accepted the available fork work as one exception batch. The
reusable additions are static keyword grants to creatures you control, power-
based life gain, compound draw/life-loss resolution, damage scaled by hand
size, scry and combat-state damage targets, and `it` self-reference in triggers.
The worker planner now assigns disjoint primitives across five workers under a
2 GB budget, with at most 20 Oracle IDs per commit.

Integrated source commits: `ed5e254`, `2ae95f3`, `69499d2`, `7ce1ade`,
`6f19f20`, `86b3f9a`, `868bbcf`. Equivalent earlier implementations were kept
once; `501f5e2` was rejected because it removed a test import still required by
the current suite. The follow-up `06c888d` was already covered by the
integrator's type-narrowing fix.

Latest validation: `npm run check` PASS; `npm test` PASS (213 rules tests,
simulator and 24 Python tests); `npm run simulate:engine` PASS (200 games,
160 finished, 0 invariant/projection failures). The engine exports 7,284 fully
implemented catalog cards; C13 is 141/356 (215 pending).

### Fork integration checkpoint: 2026-09-04

The C13 fork exception batch was integrated through the latest available
commits. It adds reusable counted effects, keyword-aware target filters,
continuous static keyword/P+T layers, reach/flying-only sweeps,
planeswalker/battle counting, typed permanent sacrifice costs, and chosen
discard-card activation costs. Duplicate claims were collapsed into grouped
rows in `docs/WORK_CLAIMS.md`; commits with equivalent fixes were skipped after
review. No incoming commit identified itself as Hermes/Nemotron; the visible
author metadata was `MatyMeatBoy`.

Verified after integration: `npm run check` PASS; `npm test` PASS (286 rules
tests, simulator and Oracle compiler tests); C13 remains **150/356** in the
precon coverage report and the engine export is **7,661/38,711** fully
implemented cards. The current set map reports **19.7%** across 708 editions.
The latest fork batch also adds reusable ETB trigger subjects for artifacts and
enchantments under your control.

The primitive compiler is now parser version `v10`: it reuses its incremental
cache, preserves typed sacrifice operands, distinguishes discard activation
costs from discard effects, and records modal operands such as `one-or-both`
for the reusable modal engine. It emits a valid
one-command C13 worker plan (`npm run rules:oracle:plan:c13`): 5 disjoint
workers, a 2 GB scheduler ceiling, 20 `oracle_id`s per commit, and an
11-commit integration threshold. The latest benchmark classified 38,711 cards
in 17.00 s with one process versus 7.92 s with eight processes (2.15x); five
threads took 22.97 s, so processes remain the default.

The Pages workflow and refreshed `site/coverage.json` are committed on
`feat/activated-abilities-and-triggers`. The repository is now public and
Pages is configured to use GitHub Actions; the `github-pages` environment
allows both `master` and `feat/activated-abilities-and-triggers`. The expected
URL is `https://matymeatboy.github.io/lamagia/`; the latest workflow deploys
successfully and the public page is live there.

### Integrator checkpoint: public app and reusable cost grammar

The Oracle compiler now keeps both dimensions of a discard clause: a discard
effect (for example, Thoughtseize) remains an effect, while discard in an
activated or additional cast cost (for example, Bone Shards-style text) emits
`discard_card_count` and `cost_actions`. Combined costs preserve both fields,
so later cards reuse the primitive instead of reparsing the same meaning.

The latest accepted rules batch also covers any-player spell triggers, generic
permanent sacrifice costs, and privacy-safe permanent return/exile targets.
Validation is green: `npm run check`, `npm test` (300 rules tests plus
simulator), 35 Oracle Python tests, and `git diff --check`. The current export is
**7,678/38,711** fully
implemented catalog cards; the filtered set map is **20.1% across 685
editions**. Alchemy and Un- joke editions are excluded from active totals and
listed separately in the generated coverage report.

GitHub Pages now builds and publishes the complete client shell, not the old
standalone map. The client can consume a future public match-server origin via
`window.__PROSSH_API_BASE__`; without that backend, Pages provides the landing
screen and static grouped coverage summary while gameplay remains local-only.

The worker planner was hardened for the raw `oracle-clusters.json` schema: it
now preserves the real cluster key, derives its family, and accepts an explicit
claim prefix. The C13 plan therefore produces 118 distinct primitive jobs
across five workers instead of collapsing them under `primitive`; use
`npm run rules:oracle:plan:c13` to regenerate it after each accepted batch.
### C14 batch2 (rebased onto the integrated branch)

Re-applied after the integrator merged the first C14 batch. New reusable work:

- **Kicker / Multikicker** (CR 702.33): `Kicker {cost}` / `Multikicker {cost}`
  sets `profile.kickerCost`; `legalActions` offers a separate kicked cast whose
  cost is `base + kicker`; `applyCast` marks the `StackObject` / `Permanent`
  kicked. `If ~ was kicked, X` sentences become `profile.kickedEffects` (applied
  only on a kicked cast), and an enters trigger reading `..., if it was kicked,
  ...` carries `requiresKicked` so `raiseEvent` skips it otherwise. Multikicker
  is a boolean; per-kick scaling is not modelled.
- **`you may pay {cost}. If you do, X`** optional-cost triggers: the
  `optional-trigger` choice carries `payCost`; the accept branch is offered only
  when the mana can be planned, and `applyChooseTrigger` pays it first.
- **`draw-then-discard`**: `Draw N cards, then discard M cards` (spell or
  activated) draws, then opens the existing `discard-cards` choice for the
  controller. Bot now resolves `discard-cards` (surplus land when flooded).
- **`exile-self` / `shuffle-self-into-library`**: `Exile ~` / `Shuffle ~ into
  its owner's library` route the spell card to that zone instead of the
  graveyard.
- **Graveyard recovery accepts "another"** (`Return another target ... card from
  your graveyard`), and `Return target nonland permanent to its owner's hand`.
- **Bot fear fix**: `chooseBlockers` now respects fear (CR 702.36b), clearing a
  pre-existing 9/200 invariant failure on the integration branch.

Validation: `npm run check` PASS; `npm test --workspace=@prossh/rules` PASS
(270 rules tests); `npm run rules:test:oracle` PASS (25); `npm run
simulate:engine` PASS (200 games, 162 finished, 0 invariant/projection
failures). Engine catalog fully-implemented 7,529 -> 7,655; Commander 2014
97 -> 104/337.

### C14 batch3: plain permanent destruction + self-bounce ETB

- `Destroy target permanent` (any permanent) recognised — unblocks the sac
  activated ability on Unstable Obelisk and similar.

### Integrator checkpoint: C14 batch2 accepted

The rebased C14 fork batch was integrated as 14 commits, including kicker,
optional-pay triggers, draw-then-discard, self-zone spells, Evoke, Extort,
static land mana, planeswalker loyalty, enters-or-dies triggers, and the bot
fear blocker fix. Validation is green: **310 rules tests**, simulator tests,
and **36 Oracle Python tests**. The current export is **7,960/38,711** fully
implemented cards; C13 is **161/356**, C14 is **127/337**, and the filtered map
is **21.3% across 685 editions**.

The global Oracle queue now has a one-command planner:
`npm run rules:oracle:compile && npm run rules:oracle:plan`. It emits five
disjoint workers under a 2 GB scheduler budget, batches up to 20
`oracle_id`s, and labels a card `quick-win` when it has exactly one unresolved
clause. This is the correct signal for closing cards quickly; a primitive-only
commit may still add zero cards until all clauses of its dependants are covered.

GitHub Pages is static and cannot host the Fastify match-server. The client now
reports that limitation instead of trying to parse the Pages HTML 404 as JSON;
local AI battle is verified through `npm run dev:server` + `npm run dev`. A real
public AI battle requires deploying `services/match-server` and setting
`window.__PROSSH_API_BASE__` to that backend origin.

### Keyword audit and C13 worker queue

The checked-in Comprehensive Rules snapshot was compared with the engine's
reusable keyword contracts and catalog metadata. `KEYWORD_COVERAGE.md` now
reports **22 implemented**, **2 partial**, and **170 backlog** keyword headings;
catalog frequency is used only as a prioritization signal. Run
`npm run rules:keyword:audit` after catalog or parser changes. The regenerated
C13 queue contains **118** disjoint primitive jobs across five workers, with
**74 quick-wins** ranked first and the existing 2 GB / 20-oracle-id / 11-commit policy.

The keyword audit also closed Changeling (CR 702.73): subtype predicates now
reuse `hasSubtype`, so a changeling creature matches creature-type searches and
subtype-wide effects without duplicating logic per card.
- `Return a creature you control to its owner's hand` reuses `return-target-
  creature` with a `creature-you-control` target, so Whitemane Lion-style ETB
  self-bounce resolves.

Validation: check PASS; 271 rules tests; oracle 25 OK; simulate:engine 200
games 162 finished 0 failures. Catalog 7,655 -> 7,670; Commander 2014 104 ->
107/337.

### C14 batch4: board-scaled self cost reduction

`~ costs {N} less to cast for each creature on the battlefield` (Blasphemous
Act, CR 118.9). `planManaPayment` / `payCost` now accept a negative
`additionalGeneric` (clamped to 0 owed generic), and cast paths subtract
`costReducesPerBoardCreature * creatures`.

Validation: check PASS; 272 tests; oracle 25 OK; simulate 200 games 162 finished
0 failures. Catalog 7,670 -> 7,672; Commander 2014 107 -> 108/337.

### C14 batch5: Medallion-style static cost reduction

`<color/type> spells you cast cost {N} less to cast` (Medallion cycle, CR 118.9)
is a `spellCostReductionGrant` on the permanent; the cast paths sum grants from
the caster's battlefield that match the spell's color/type.

Validation: check PASS; 273 tests; oracle 25 OK; simulate 200 games 162
finished 0 failures. Catalog 7,672 -> 7,689; Commander 2014 108 -> 113/337
(Ruby/Sapphire/Jet/Emerald/Pearl Medallion).

### C14 batch6: graveyard self-return dies trigger + compound draw/loss

- `When ~ is put into a graveyard from the battlefield, return it to its owner's
  hand` (Fool's Demise, Spine of Ish Sah): a new `dies`/`self` trigger template
  plus a `return-source-to-hand` effect that lifts the card back out of the
  graveyard on resolution.
- `You draw N cards and you lose N life` (Promise of Power, Skeletal Scrying)
  extends the existing compound draw/life-loss recogniser to N and X.

Validation: check PASS; 274 tests; oracle 25 OK; simulate 200 games 162
finished 0 failures. Catalog 7,689 -> 7,728; Commander 2014 113 -> 115/337.

### C14 batch7: tapped-creature wipe + commander-identity mana

- `Destroy all tapped creatures` (Sunblast Angel): `destroy-all-creatures` gains
  a `tappedOnly` flag.
- `Add N mana of any color in your commander's color identity`
  (Commander's Sphere): modelled as any color (identity is a deckbuilding rule).

Validation: check PASS; 274 tests; oracle 25 OK; simulate 200 games 0 failures.
Catalog 7,728 -> 7,734; Commander 2014 115 -> 117/337.

### C14 batch8: Evoke

Evoke (CR 702.34): `Evoke {cost}` sets `profile.evokeCost` (an alternative cost
that replaces the base), a cast variant pays it, and a synthesised
enters-battlefield trigger with `requiresEvoked` sacrifices the creature
(`sacrifice-source` effect) only when it was evoked. The ETB effect still
resolves first.

Validation: check PASS; 275 tests; oracle 25 OK; simulate 200 games 0 failures.
Catalog 7,734 -> 7,744; Commander 2014 117 -> 119/337 (Mulldrifter, Shriekmaw).

### C14 batch9: Extort

Extort (CR 702.39) synthesised from the keyword: a `spell-cast` trigger with an
optional `{W/B}` payment whose `extort` effect drains each opponent for 1 and
heals the controller by that much. Reuses the optional-cost trigger flow.

Validation: check PASS; 276 tests; oracle 25 OK; simulate 200 games 0 failures.
Catalog 7,744 -> 7,751; Commander 2014 119/337 (Crypt Ghast / Pontiff still
blocked by their other static text).

### C14 batch10: static basic-land mana bonus

`<Basic type>s you control produce an additional {C}` / `Whenever you tap a
<Basic type> for mana, add an additional {C}` (Crypt Ghast, Nirkana Revenant):
parsed to `staticLandManaBonus`; `manaSources` and `applyActivateMana` add one
extra of the granted colour when a matching land is tapped.

Validation: check PASS; 276 tests; oracle 25 OK; simulate 200 games 0 failures.
Catalog 7,751 -> 7,753; Commander 2014 119 -> 120/337 (Crypt Ghast).

### Integrator checkpoint: current fork batches and public Pages

The incoming C13/C14 fork tail was reviewed and integrated without importing
the fork's stale documentation snapshots over newer local work. Reused
primitives include Chaos Warp-style shuffle/reveal, Decree of Pain's sweep and
draw, Desertion's counter-and-return, Command Tower color identity, Mirari's
Wake mana/P+T grants, Loyal Retainers restrictions, and Maelstrom Wanderer
haste reuse. Duplicate or already-equivalent patches were retained once.

Validation: `npm run check` PASS; `npm test` PASS (**324 rules tests**, simulator
and **38 Oracle Python tests**). The current export is **8,009/38,711** fully
implemented cards; the refreshed C13 precon report is **163/356** and C14 is
**128/337**. The filtered map is **21.5% (18,285/84,990 memberships) across
685 editions**.

The global queue remains incremental and reusable: five disjoint workers, a
2 GB scheduler ceiling, up to 20 `oracle_id`s per commit, and `quick-win`
priority for cards with exactly one unresolved clause.

The public client now consumes JSON safely and reports a useful backend error
instead of throwing `Unexpected token '<'` when Pages returns HTML. GitHub Pages
is static, so local AI play is verified but a public AI match still requires a
hosted `services/match-server` origin configured through
`window.__PROSSH_API_BASE__`.

### Planner optimization: overlap-aware worker assignment (2026-09-04)

`tools/rules/plan_primitive_workers.py` now builds connected components over
shared `oracle_id`s before assigning work to the five-worker/2 GB queue. A card
with several unresolved clauses therefore remains on one worker, while its
primitive jobs stay separately visible and retain their 20-card commit batches.
Worker estimates use unique cards, preventing misleading double-counting. The
behavior is covered by `test_worker_plan_colocates_overlapping_oracle_ids`.

Fork integration policy remains strict: integrate only when **more than 10**
new commits are available. The 13-commit C13 tail was integrated in full;
future work must use a fresh disjoint claim after this checkpoint.

### Integrator checkpoint: C13 batch accepted (2026-09-04)

Integrated the fork's 13-commit batch for Vela, Decree, Edric, and Mind's Eye,
including Intimidate, cycling triggers, combat-damage draw, and optional mana
payment triggers. Compatibility aliases preserve both `payCost` and
`manaCost`; Chaos Warp's shuffle/reveal dependency was completed locally after
the fork's stale base exposed it during validation. Generated coverage and the
public progress snapshot were refreshed.

Validation: `npm run check` PASS; `npm test` PASS (**324 rules tests**, simulator
tests, **38 Oracle Python tests**). C13: **163/356 implemented, 193 pending
(45.8%)**. Do not count printings as separate logic: the engine keys cards by
stable `oracle_id`.

The compiler also memoizes identical clause classification with a bounded
per-worker cache (`lru_cache(8192)`), covered by the Oracle Python tests. This
removes repeated regex and operand extraction for recurring wording without
changing the generated IR.

The accepted fork batch also adds Vela's reusable intimidate/static-grant and
leaves-battlefield trigger coverage; its detailed historical notes were
condensed here to avoid reintroducing stale handoff snapshots.

The same accepted batch adds Decree of Pain's cycling trigger, Edric's combat
damage draw trigger, and the associated scenario coverage. The remaining fork
tail is still being accumulated before the next >10-commit integration batch.

The next C13 batch is now staged for review as 11 commits from base `95fbe83`:
Duplicant imprint and Rhystic Study's caster-specific optional payment. Its
scenario tests cover accept/decline imprint, payer identity, and hiding an
unaffordable payment action. Integrate the complete batch only after validation;
do not import stale handoff snapshots or untracked user folders.

### Integrator checkpoint: C13 reprint-equivalence batch accepted (2026-09-04)

Integrated the 12-commit stable-ID reprint test batch for Army of the Damned,
Command Tower, and Decree of Pain. Command Tower now filters mana choices to
the declared commanders' color identity (CR 903.4); Army and Decree reuse the
same Oracle-driven primitives rather than name-specific implementations. The
incoming generated snapshots were regenerated locally. Validation remains
green: `npm run check`, `npm test` (**351 rules tests**, simulator, **38 Oracle
Python tests**). C13 remains **168/356 (47.2%)** and global export
**8,047/38,711**; Army is intentionally still pending because its actual
printed profile has an unresolved clause.

### Integrator checkpoint: C13 sacrifice batch accepted (2026-09-04)

Integrated the functional portion of the 11-commit Fires of Yavimaya/Goblin
Bombardment batch: typed sacrifice costs, controller-scoped haste/pump, and
player/creature damage targets, with parser and engine scenarios. Its two
incoming generated-document commits were superseded by the current local
snapshots. Validation: `npm run check` PASS; `npm test` PASS (**345 rules
tests**, simulator, **38 Oracle Python tests**). C13 remains **168/356 (47.2%)**
and global export remains **8,047/38,711**; no card is counted until all its
printed clauses are executable.

### Integrator checkpoint: C13 trigger batch accepted (2026-09-04)

Integrated the 12-commit Gahiji, Guttersnipe, and Fecundity batch. It adds
opponent-specific attack subjects, instant/sorcery spell triggers, and routes
Fecundity's optional draw to the controller of the creature that died. Coverage
was regenerated locally. Validation: `npm run check` PASS; `npm test` PASS
(**337 rules tests**, simulator, **38 Oracle Python tests**). C13 is now
**168/356 (47.2%)**, 188 pending; global export **8,047/38,711** and filtered
map **21.7%**.

### Integrator checkpoint: C13 Charm batch accepted (2026-09-04)

Integrated the 13-commit batch for Boros, Selesnya, Azorius, and Naya Charm
modal primitives. Azorius was kept as shared work because it is not a C13 card;
the generated coverage snapshot was refreshed locally. Validation: `npm run
check` PASS; `npm test` PASS (**334 rules tests**, simulator, **38 Oracle
Python tests**). C13 advanced to **165/356 (46.3%)**, with 191 pending; the
global export is **8,021/38,711** and the filtered map is **21.6%**.

### Integrator checkpoint: C13 Duplicant/Rhystic batch accepted (2026-09-04)

The full functional batch was integrated: Duplicant's nontoken-creature imprint
ETB and Rhystic Study's opponent-specific "unless that player pays" trigger.
The stale generated coverage commit was regenerated locally instead of copied.
Validation: `npm run check` PASS; `npm test` PASS (**329 rules tests**,
simulator, **38 Oracle Python tests**). C13 remains **163/356 (45.8%)** because
these cards are outside that precon's unique-card list; the global export is
**8,011/38,711** fully implemented.

This batch's implementation is validated below after the complete commit set is
processed; Rhystic Study uses the exact opponent who drew the card as payer,
and its accept action is omitted when that player cannot pay.

### Integrator checkpoint: C13 Flashback batch accepted (2026-09-04)

Integrated the 11-commit Flashback batch from `codex/c13-equipment-cluster`.
Flashback now parses as reusable card metadata, exposes legal graveyard casts,
uses the alternative mana cost, and exiles the spell after resolution or when
countered. Army of the Damned is now counted as implemented; this closes the
previous reprint-equivalence gap without a card-name-specific rule.

Validation: `npm run check` PASS; `npm test` PASS (**357 rules tests**,
simulator, **38 Oracle Python tests**). C13 is **170/356 implemented (47.8%)**;
global export is **8,114/38,711**. The fork remains on disjoint claims and must
accumulate more than 10 commits before the next integration notice.

### Integrator checkpoint: Flashback life-cost refinement (2026-09-04)

The reusable Flashback parser now handles the em-dash form and additional
life payments such as `Flashback—{1}{U}, Pay 3 life.`. Mana planning reserves
that life before selecting sources, and the legal action label exposes the
payment. Scenario coverage uses Deep Analysis and verifies the life component
is paid together with mana (CR 702.34, 118.8).

Coverage after this refinement: **170/356 C13 cards (47.8%)** and
**8,114/38,711 globally**.

### Integrator checkpoint: Hua Tuo typed graveyard-top activation (2026-09-04)

Added the reusable target restriction for `Put target creature card from your
graveyard on top of your library`, so Hua Tuo no longer treats noncreature
cards as legal targets. Its precombat-main activation timing remains enforced
by the shared activation validator (CR 602.1, 602.2b, 701.18).

Validation: `npm run check` PASS; `npm test` PASS (**372 rules tests**,
simulator, **39 Oracle Python tests**). C13 is **172/356 (48.3%)** and global
export is **8,125/38,711**.

### Integrator checkpoint: self-shuffle and life-gain batch (2026-09-04)

Integrated the functional portion of the fork's 11-commit batch: reusable
self-shuffling spell resolution for Blue Sun's Zenith, countered-spell
destination coverage, and Ajani's Pridemate life-gain/+1/+1 trigger reuse.
Snapshots were regenerated locally. Validation: `npm run check` PASS; `npm
test` PASS (**370 rules tests**, simulator, **38 Oracle Python tests**).
C13 remains **171/356 (48.0%)** because the covered reprints are shared outside
the C13 unique-card list; global export remains **8,121/38,711 (21.0%)**.

### Integrator checkpoint: C13 multi-basic search batch accepted (2026-09-04)

Integrated the fork's 11-commit functional batch for multi-card basic-land
searches. Cultivate can place one found land tapped onto the battlefield and
the other into hand; Armillary Sphere and Burnished Hart can choose multiple
basic lands, with deterministic ordering, optional early completion, private
legal-candidate projection, and client search progress. Coverage was regenerated
locally instead of importing stale snapshots.

Validation: `npm run check` PASS; `npm test` PASS (**366 rules tests**,
simulator, **38 Oracle Python tests**). C13 is **171/356 (48.0%)** and global
export is **8,121/38,711**. The fork's client glyph warning was not reproduced
on the integrator branch.

### Integrator checkpoint: Scry batch and Arcane Melee (2026-09-04)

Integrated the fork's functional Scry batch and reconciled it with the prior
choice model: one private `choose-scry` flow now handles ordered top/bottom
decisions, duplicate names, short libraries, countered spells, ETB Scry, and
`Scry N, then draw M` without dropping sibling effects (CR 701.22, 608.2c).
The bot policy was migrated to the same action shape.

Added the reusable global spell-cost reduction primitive for `Instant and
sorcery spells cost {N} less to cast`, including Arcane Melee. Unlike
controller-only Medallion grants, this applies to every player's matching
spells (CR 118.9), with an opponent-cast scenario.

Validation before the next coverage export: `npm test` PASS (**382 rules
tests**, simulator, **39 Oracle Python tests**). Coverage snapshots are
regenerated after the next accepted batch.

### Integrator checkpoint: C13 Landfall self-pump batch (2026-09-04)

Integrated the fork's second 11-commit batch. Landfall triggers now resolve
source-relative modifiers through the reusable `sourcePermanentId`, including
temporary +N/+N and keyword grants; Baloth Woodcrasher is covered without a
card-name-specific branch (CR 603.2, 613.4c, 611.2a).

The batch's stale coverage/claim snapshots were intentionally regenerated
locally. Current export: **159/341 C13 cards (46.6%)** and **8,144/38,711
cards globally (21.0%)**. Validation: `npm run check` PASS; `npm test` PASS
(**386 rules tests**, simulator, **39 Oracle Python tests**).

### Integrator checkpoint: Basalt Monolith batch and Crawlspace (2026-09-04)

Integrated the fork's third 11-commit batch. Basalt Monolith now reuses the
activated self-untap primitive and remains tapped through untap when its static
restriction says so; both straight and typographic apostrophes are accepted
(CR 502.2, 602.1, 701.21). Also added Crawlspace's defender-side attacker
limit as a reusable combat declaration rule, including bot-safe declarations
(CR 508.1d).

Current regenerated coverage: **176/356 C13 precon cards (49.4%)** and
**161/341 unique C13 set entries (47.2%)**; global export **8,154/38,711
(21.1%)**. Validation: `npm run check` PASS; `npm test` PASS (**389 rules
tests**, simulator, **39 Oracle Python tests**).

### Integrator checkpoint: C13 reusable basic-effects batch (2026-09-04)

Integrated the fork's reusable-effect tests and opponent-only target primitive.
Borrowing 100,000 Arrows now cannot target its controller; the same shared
draw, typed-sacrifice damage/draw, and upkeep compound parsing is covered for
Blood Rites, Carnage Altar, and Baleful Force (CR 603.2, 601.2c, 602.2b).

Coverage remains **176/356 C13 precon cards (49.4%)** and **161/341 unique C13
set entries (47.2%)**; global export **8,154/38,711 (21.1%)**. Validation:
`npm test` PASS (**395 rules tests**, simulator, **39 Oracle Python tests**).

### Integrator checkpoint: C13 Satchel + typed tap batch (2026-09-04)

Added Druidic Satchel's reusable conditional top-card reveal and integrated the
fork's typed-tap activation cost for Azami, including selectable `any`/`another`
subtype candidates and server-side validation (CR 602.2b, 701.19, 701.8).

Current coverage: **178/356 C13 precon cards (50.0%)** and **163/341 unique
C13 set entries (47.8%)**; global export **8,173/38,711 (21.1%)**. Validation:
`npm run check` and `npm test` PASS (**401 rules tests**, simulator, **39 Oracle
Python tests**).

### Integrator checkpoint: C13 ETB sacrifice-unless-pay (2026-09-04)

Added the reusable optional-trigger inversion for “sacrifice ~ unless you pay
{N}”, including payment/decline resolution and the two C13 lands Rupture Spire
and Transguild Promenade (CR 603.2, 603.5, 117.12).

Current coverage: **180/356 C13 precon cards (50.6%)** and **165/341 unique
C13 set entries (48.4%)**; global export **8,194/38,711 (21.2%)**. Validation:
`npm run check` and `npm test` PASS (**402 rules tests**, simulator, **39 Oracle
Python tests**).

### Integrator checkpoint: C13 draw/ETB reuse + storage mana (2026-09-04)

Integrated the fork's two incoming batches (12 and 11 commits). Draw-only
primitives now cover Brilliant Plan, Harmonize and Vision Skeins; Flashback
life costs/actions cover Deep Analysis; ETB draw/keyword reuse covers Baleful
Strix and the generalized draw/life compound covers Phyrexian Gargantua.
Annihilate now enforces nonblack-creature targeting before its draw effect.

Added the storage-counter mana primitive for Molten Slagheap and Saltcrusted
Steppe: activations pay `{1}`, remove a chosen number of storage counters and
produce every legal B/R or G/W combination. Automatic spell payment does not
mistake variable storage abilities for free mana sources (CR 106.1, 605.3a).

Current regenerated coverage: **180/356 C13 precon cards (50.6%)** and
**165/341 unique C13 set entries (48.4%)**; global export **8,197/38,711
(21.2%)**. Validation: `npm run check` and `npm test` PASS (**415 rules
tests**, simulator, **39 Oracle Python tests**).
### Integrator checkpoint: C13 additional life costs (2026-09-04)

Added a reusable cast-cost primitive for `As an additional cost to cast ~, pay
N life`, including Toxic Deluge and a scenario proving the life payment occurs
exactly once alongside normal mana payment (CR 118.8). The primitive is
independent of the spell's effect, so future cards reuse it automatically.

### Integrator checkpoint: Arcane Denial + graveyard exile batch (2026-09-04)

Integrated the fork's 11-commit batch. Arcane Denial now schedules its two
next-upkeep draws as a private 0..N choice, clamps to the available library and
uses deterministic bot selection. Angel of Finality and Bojuka Bog reuse the
exile-all-graveyards ETB path. C13 coverage is now **182/356 precon cards
(51.1%)** and **167/341 unique set entries (49.0%)**; global export is
**8,199/38,711 (21.2%)**. Validation: `npm run check` and `npm test` PASS
(**424 rules tests**, simulator, **39 Oracle Python tests**).

### Integrator checkpoint: C13 Split second (2026-09-04)

Added the reusable Split second keyword and enforced its priority restriction:
while a Split second spell is on the stack, only mana abilities remain
activatable; casts, cycling, equip and other activated abilities are hidden and
rejected by the authoritative rules engine (CR 702.61, 117.1b). This closes
the Krosan Grip primitive and is reusable by Sudden Spoiling and future cards.

Current regenerated coverage: **183/356 C13 precon cards (51.4%)** and
**168/341 unique C13 set entries (49.3%)**; global export **8,206/38,711
(21.2%)**. Validation: `npm run check` and `npm test` PASS (**425 rules
tests**, simulator, **39 Oracle Python tests**).

### C13 threshold return primitive (2026-09-04)

Stitch Together now uses one numeric threshold primitive: the targeted creature
card returns to hand normally, but returns to the battlefield instead when its
controller has at least seven cards in their graveyard at resolution. The
threshold is evaluated on resolution, after target selection, so the same
effect can serve future Threshold values without card-specific logic.

### Integrator checkpoint: stale C14 branch review (2026-09-04)

Reviewed `c14-batch2-clean`: its reported 200+ cards were already present in
our HEAD through equivalent commits, so its full historical tree is not safe
to merge. A wholesale merge reintroduced obsolete types and failed TypeScript.
The only current delta was rescued as `893730c` (Storm marker plus targeted
attacking-creature sacrifice). Check, full tests, simulator and 40 Oracle
Python tests pass. Fork protocol: update from the current integration branch,
claim one disjoint primitive, commit directly with tests and a compact
`CLAIM/BASE/COMMIT/FILES/TESTS/SCENARIOS/LIMITS` report; never accumulate or
rebase a stale full-tree branch.

The supplied worker report is valid for its own stale code: `af82c1f` exported
**241/337 C14 printing identities**. It must not be confused with the clean
integration branch, whose current export is **116/322 unique Oracle IDs**;
`SET_COVERAGE.md` uses that canonical denominator. The worker report now
provides the exact card-to-commit map needed to rescue the missing C14
functions; cherry-pick/reimplement commits case by case, never merge its
stale full tree. The clean branch currently exports **186/356 C13 printings**,
**171/341 unique C13 Oracle IDs**, and **8,228/38,711 global cards**. Commits
`5f01afc`, `6b99130`, `b8702fb`, and `e598995` (C13 worker artifacts) remain
queued for the next integration batch.
### Worker-05: reusable "any creature enters" trigger (2026-09-04)

Claim `c14-any-creature-enters-trigger`. Wizards dropped "under your control"
from some `enters-the-battlefield` triggers as a functional errata (Essence
Warden, Soul Warden, Wretched Anurid and others): the ability now watches
*every* creature entering, not only the controller's own, while CR 109.5 still
excludes the source itself. `TRIGGER_TEMPLATES` in
`packages/rules/src/characteristics.ts` already had the `another-creature`
subject (previously wired only to the `dies` event) and `engine.ts` already
resolved that subject generically for any event; the only gap was a template
line for `enters-battlefield` matching the "under your control"-less wording.
Added one new template entry (ordered after every `...under your control`
`enters-battlefield` template, so a card that does print that clause keeps
matching the narrower, existing subject first).

This single primitive line, with no other code changes, took Essence Warden
(C14) from unimplemented to fully covered, and does the same for every
Soul Warden and Wretched Anurid printing across the catalog by shared
`oracle_id`. Regenerated coverage: **117/322 C14 cards (36.3%)**, global
export **8,226/38,711**. `npm run check` and `npm test` PASS (**427 rules
tests**, up from 426; simulator smoke tests and 40 Oracle Python tests PASS).

`npm run simulate:engine` reproduces one pre-existing invariant failure (seed
92, "P1 lost track of its commander") that is unrelated to this change — it
reproduces identically on this same HEAD with this diff stashed out, so it is
not attributable to this claim and is left for a separate investigation.

### Worker-05: reusable "target player draws and loses life" compound (2026-09-04)

Claim `rules-target-player-draw-and-lose-life`. Sign in Blood's family
("Target player draws N cards and loses N life") already had both halves as
separate effect kinds (`draw-target-player`, `lose-life-target-player`); the
only gap was recognizing the combined sentence as a `compound` of the two,
which `applyEffect` already resolves against the same single stack-object
target, so no engine change was needed — only a new `recognizeSentence`
pattern in `characteristics.ts`. Because the sentence is also reached through
the existing trigger-effect path, this took effect for both spells (Sign in
Blood, Damnable Pact, Blood Pact, Painful Lesson, Harrowing Journey,
Reverent Howl, Shredder's Revenge, Vault Plunderer) and one trigger
(Bloodgift Demon's upkeep clause), fully implementing 9 cards from one
grammar line — 2 of them (Sign in Blood, Bloodgift Demon) in C14.

Regenerated coverage: **119/322 C14 cards (37.0%)**, global export
**8,235/38,711**. `npm run check` and `npm test` PASS (**434 rules tests**,
up from 433 once `data/decks/cedh-pod.json` was generated locally via
`npm run decks:pod:sync` — it is required by the simulator suite and was
missing from this fresh worktree). `npm run simulate:engine` reproduces the
same pre-existing, unrelated seed-92 invariant failure noted above.

### Worker-05: reusable Blood Artist drain, moving to Commander 2017 (2026-09-04)

Claim `rules-blood-artist-drain`. "Whenever ~ or another creature dies,
target player loses N life and you gain N life" (Blood Artist, Falkenrath
Noble) needed two independent additions: a `dies` trigger template for the
"~ or another creature" wording — CR 109.5's usual "another" exclusion is
explicitly overridden here, so the source watches its own death too, unlike
the existing `another-creature`/`another-creature-you-control` subjects — and
a `recognizeSentence` pattern combining the already-existing
`lose-life-target-player` and `gain-life` effect kinds into a `compound`
resolved against the chosen target. Deliberately numeric-only: several other
printings tie the same sentence's "X" to a sacrifice's power or to Domain,
which this primitive does not attempt to resolve, so those stay honestly
pending. Scenario coverage added the cross-controller case (an opponent's
creature dies while the drainer is controlled by someone else) and the
source's own death, confirming the triggered ability still belongs to its
last controller (not whoever caused the death).

This is also the first worker-05 claim outside Commander 2014: per the user's
steer, subsequent claims target whichever set has real, honestly-pending
coverage rather than sticking to one edition — clusters are shared by
`oracle_id` across sets regardless, so this does not change the delivery
contract. Regenerated coverage: **119/322 C14 (37.0%, unchanged — this
cluster's cards are C17, not C14)**, **104/299 C17 (34.8%, up from 102)**,
global export **8,250/38,711**. `npm run check` and `npm test` PASS (**434
rules tests**, simulator smoke tests and 40 Oracle Python tests PASS).
`npm run simulate:engine` reproduces the same pre-existing, unrelated seed-92
invariant failure.

### Worker-05: the Partner keyword and Partner with <name> (2026-09-04)

Claim `rules-partner-keyword`, requested by the user by name ("la keyword
partner y sus asociados, como los que hay en LOTR"). Two independent pieces:

1. **Partner** (CR 702.123) is purely a deck-construction legality rule.
   `createGame` already accepts an array of `commanderNames` and builds a
   multi-card command zone from it — nothing about the *card* needs new
   state, so the printed line is now just recognized and dropped, honestly
   reflecting that the engine already supports two commanders mechanically.
2. **Partner with <name>** (CR 702.124f) is a real ETB effect: the printed
   text in this catalog is (after this project's global reminder-text strip)
   exactly `Partner with <Name>`. It searches the target player's library for
   the exact named card and puts it into that player's hand, then shuffles.
   The key rules subtlety is *who* decides: targets are chosen by the
   ability's controller as it goes on the stack (CR 603.3d) as always, but
   the "may" is decided by the *targeted* player on resolution, not the
   controller. `TriggerDefinition.choiceBy` only had `"event-controller"`
   (for "that creature's controller may..."); added `"target"`, resolved in
   `engine.ts`'s optional-trigger branch from `object.targets[0]`. The actual
   move-and-shuffle is a new direct-resolution `partner-with-search` effect
   (`characteristics.ts`/`engine.ts`) — deliberately not routed through the
   existing interactive `search-library` pending-choice flow, since there is
   no candidate to pick among, only a yes/no and a name.
   Two known non-standard printings are excluded by the captured name rather
   than guessed at: The Knight of Land Drops ("Partner with Knight" — lets
   you freely choose any legendary Knight, never searches) and Mothers
   Yamazaki ("Partner with itself" — a self-referential two-copy deck this
   primitive does not model). Both stay honestly pending.

This does **not** move Commander 2017 itself — checked directly against the
local catalog: no `c17`-set card actually prints "Partner" text (the
mechanic's real timeline is Commander 2016 for bare Partner and Battlebond
for "Partner with", not C17; C17 reused the plain Partner keyword on none of
its own legends). It does move **Commander 2016 (93→96)**, **Commander
Anthology Volume II (102→103)**, **Commander Legends (140→145)**, and
**Bloomburrow Commander (88→89)** to full completion for 9 single-ability
cards (Ishai, Ravos Soultender, Tana, Rograkh, Toggo, Blaring Recruiter,
Proud Mentor, Lore Weaver, Chakram Slinger). It also strips the resolved
`Partner with` line from every Battlebond, Doctor Who, and Tales of
Middle-earth Commander printing's `unimplementedText` — including the LOTR
hobbit pairs Merry/Pippin and Frodo/Sam the user asked about by name — even
where those cards stay pending on a separate, unrelated ability.

Global export: **8,259/38,711** (+9). `npm run check` and `npm test` PASS
(**436 rules tests**, up from 434; simulator smoke tests and 40 Oracle Python
tests PASS). `npm run simulate:engine` reproduces the same pre-existing,
unrelated seed-92 invariant failure.

### Worker-05: Swords to Plowshares and Condemn, back on Commander 2017 (2026-09-04)

Claim `rules-exile-and-bottom-library-lifegain`. Two of the format's most
iconic removal spells, both a two-sentence single line: the first sentence
(exile / bottom-of-library) was already trivially resolvable, but the second
("Its controller gains life equal to its power/toughness") needs the
creature's stats read as last known information (CR 613.7a) *before* it
leaves the battlefield — the same shape already used by the existing
`destroy-target-creature-then-life-loss` special case, just exiled/library
instead of destroyed, and paid to the controller instead of taken from them.

- Added a new `attacking-creature` target kind (Condemn requires the target
  to actually be attacking; the existing `attacking-or-blocking-creature`
  kind would have wrongly allowed blockers too) — filtered from
  `state.combat.attackers` the same way the existing combined kind reads
  both lists.
- Generalized `movePermanentToZone`'s zone parameter with a `"library-bottom"`
  option alongside `"graveyard"`/`"exile"`, so Condemn's removal reuses the
  same commander-redirect (CR 903.9) and token-vanish handling those already
  get, rather than duplicating it.
- Both new effects are direct-resolution (find the permanent, capture
  power/toughness, move it, then pay life to its captured controller);
  `settle`'s existing combat-pruning removes a bottom-decked attacker from
  `state.combat.attackers` automatically, so no extra cleanup was needed —
  verified by a scenario test.

This is back on Commander 2017 itself: **106/299 C17 (35.5%, up from 104)**.
Global export: **8,261/38,711** (+2). `npm run check` and `npm test` PASS
(**438 rules tests**, up from 436; simulator smoke tests and 40 Oracle Python
tests PASS). `npm run simulate:engine` reproduces the same pre-existing,
unrelated seed-92 invariant failure.

### Worker-05: merged onto the integrator's latest batch (2026-09-04)

Fetched `origin/feat/activated-abilities-and-triggers` (now at `8c9e7fe`, far
ahead of the `8bcf441` base this branch started from) and merged it in before
continuing, per the user's instruction to re-check `AI_CONTRIBUTOR.md` and
`WORK_CLAIMS.md`. Cross-checked every worker-05 claim above against the new
HEAD: `equipped-creature triggered abilities` (commit `2753dfb`) and Condemn
(`66a74da`, as `bottom-attacker-controller-gains-toughness`) were already
integrated independently — dropped the redundant equipped-creature work
in progress before it was ever committed, and removed worker-05's duplicate
Condemn effect (`bottom-of-library-target-attacking-creature-then-life-gain-toughness`)
and its now-dead second `attacking-creature` `legalTargets` branch, keeping
the integrator's version. `any-creature-enters-trigger`,
`target-player-draw-and-lose-life` (the `draw-target-player`/`lose-life-target-player`
compound), `blood-artist-drain`, `rules-partner-keyword`, and Swords to
Plowshares (`exile-target-creature-then-life-gain-power`) were not duplicated
and remain worker-05's own contribution. Full check/test/simulate rerun green
after the merge; `npm run rules:engine:export` and `rules:set:coverage`
regenerated against the merged tree before the next claim.

### Worker checkpoint: Charmbreaker Devils random recovery (2026-09-04)

Added the parameterized `return-random-instant-or-sorcery-from-graveyard`
primitive. It filters by card type, returns up to `N` cards without replacement,
and advances the deterministic RNG, covering Charmbreaker Devils' upkeep
trigger (CR 603.2, 701.3). Commit `1d3212b` is queued for
integration; this branch is based on `b008385` and excludes sibling worker
commits.
The reported `241/337` C14 figure was observed in a transient/generated
working state, but is not reproducible from the current committed profiles or
from the worker branch history (the latter records 120/337 at its last
checkpoint). After a clean profile export, the reproducible five-precon union
is **116/322 unique Oracle IDs**; the edition-membership report in
`SET_COVERAGE.md` uses the same denominator. The useful C14 functionality from
the stale worker tree is already rescued through the integrated batch history
plus `893730c`; importing its remaining files would discard newer C13 rules
and is prohibited. To recover any extra work behind the 241 figure, the worker
must provide the exact card-to-commit mapping; no uncommitted generated
profile is treated as code. Commits `5f01afc`, `6b99130`, and `b8702fb` (C13
worker artifacts) remain queued for the next integration batch.

### C13 choose-one-or-both modal primitive (2026-09-04)

`Soul Manipulation` (`419c2ae1-fec7-4c27-a7a0-99f777abb4de`) and `Fissure
Vent` (`f5bac25d-72e9-4655-8a04-3646fc10be27`) now reuse the modal parser's
synthetic `Choose both` mode. It composes the already-supported branch effects,
preserves their ordered target kinds, and resolves each target at its own
offset; ordinary `Choose one` cards remain unchanged. The client and bot expose
the ordered target sequence, while the server validates every target.
### Worker checkpoint: Conjurer's Closet reusable blink (2026-09-04)

Added the reusable `blink-target-creature` primitive for Conjurer's Closet:
the optional end-step trigger targets a creature you control, exiles it, then
returns it under your control through the normal battlefield-entry path (CR
603.2, 603.5, 400.7). The implementation preserves ETB event generation and
does not return tokens from exile. Commit `2451f5c` is queued for
integration; this branch is based on `b008385` and excludes sibling worker
commits.
### Worker checkpoint: Tidal Force tap-or-untap choice (2026-09-04)

Added `tap-or-untap-target-permanent`, a reusable two-step trigger primitive:
the target is chosen first, then the controller chooses whether to tap or
untap it. This covers Tidal Force's “At the beginning of each upkeep” ability
and gives bots deterministic behavior (CR 603.2, 603.5, 701.21). Commit
`870297c` is queued for integration; this branch is based on `b008385`
and excludes sibling worker commits.
### C13 Wonder graveyard static primitive (2026-09-04)

`Wonder` (`232284f7-c623-4895-9ab9-8b1a39926830`) now records its static grant
with explicit `sourceZone: "graveyard"` and `requiresControlledLandSubtype:
"Island"`. The engine applies the grant only to creatures controlled by that
player while the required land subtype is present; the Python IR preserves the
same zone, subtype, and keyword operands for future cards.

### Worker checkpoint: Echo (2026-09-04)

Echo is parsed as a reusable profile cost and scheduled for the permanent's
controller at their next upkeep. The player may pay through the normal mana
planner; declining sacrifices the source. This closes C13 cards blocked only
by `Echo {cost}` (CR 702.30a-b).

### Integrator checkpoint (2026-09-04)

The accumulated C13 worker batch is validated locally before publication. The
engine-first queue now reports **186/341 C13 cards complete (54.5%)**, with 155
unfinished; C14 reports **191/322 (59.3%)**. Contributors must regenerate the
queue with `rules:engine:export`, `rules:roadmap:c13`, and
`rules:oracle:plan:c13`; the generated roadmap, not raw Oracle wording, is the
work-allocation source of truth.

### Integrator checkpoint: Thunderstaff and C14 cross-set reuse (2026-09-04)

Thunderstaff now reuses a parsed static replacement primitive: while an untapped
source is controlled, each applicable source prevents one creature combat damage
to that player; multiple sources stack and the prevented amount is also removed
from lifelink and commander-damage accounting (CR 614.1, 615.1). The scenario
suite covers both untapped and tapped states. This raises the current C13 export
to **187/341 (54.8%)**, with **154** unfinished and **76** one-line-away; C14 is
**191/322 (59.3%)**.

The catalog cross-check confirms why C14 work is reusable: of its **322 unique
Oracle IDs**, **315 also have printings outside C14** and **7 are C14-only**.
The 191 implemented profiles therefore already benefit other editions by stable
Oracle ID; the 131 pending IDs should be scheduled by primitive family rather
than by printing. Current C14-only cards are Breaching Leviathan, Crown of Doom,
Demon of Wailing Agonies, Dulcet Sirens, Flesh Carver, Raving Dead and Spoils of
Blood. Example pending reusable profiles include Skullclamp, Beastmaster
Ascension, Masked Admirers, Scrap Mastery, Cathodion and Reaper from the Abyss.

### Integrator checkpoint: Nightscape Familiar multi-color reduction (2026-09-04)

The cost-reduction parser now preserves a color union such as “blue spells and
red spells” as one reusable grant. Matching any listed color applies the generic
reduction once; unrelated colors remain full price. The C13 export is now
**188/341 (55.1%)**, with **153** unfinished and **75** one-line-away. The worker
plan remains five disjoint workers under the 2 GB scheduler budget, with up to
20 Oracle IDs per commit and the 11-commit integration threshold.

The worker planner now normalizes claim statuses before optional parenthesized
commit notes, so `review (abc123)` is excluded exactly like `review`. This keeps
fork work disjoint automatically: the current C13 plan has **34 unclaimed
primitives**, balanced as **7/7/7/7/6** across five workers.

### Worker-05: event-player drain family, from a user-supplied decklist (2026-09-04)

Claim `rules-event-player-drain`, prioritized from cards in a user-supplied
Moxfield decklist (Nekusar, the Mindrazer, group-draw punisher). "Whenever an
opponent draws a card, ~ deals N damage to that player/them" and "...that
player loses N life": "that player" is the `card-drawn` event's own player,
not a chosen target (CR 603.3d). `TriggerInstance.eventController` was only
captured from events with a `controller` field; extended `raiseEvent` to also
capture it from `seat`-keyed events (`card-drawn`, `life-gained`/`life-lost`),
then added two direct-resolution effects (`damage-event-player`,
`lose-life-event-player`) reading `object.trigger?.eventController`. Scenario
coverage casts a two-card draw spell at one opponent while a second player
sits idle, confirming the punisher credits the drawing seat specifically, not
its controller (the caster) and not "any" opponent.

Fully implements Nekusar the Mindrazer, Underworld Dreams, Scrawling Crawler,
Spellshock, Iron Maiden, Calculating Lich, Fate Unraveler, Incite Rebellion,
Viseling, and Aether Sting; partially resolves Razorkin Needlehead (a separate
first-strike clause remains). Global export: **8,572/38,711** (+7 from before
the merge below). `npm run check` and `npm test` PASS (**462 rules tests**,
up from 461; simulator and 49 Python tests PASS). Two pre-existing duplicate
`case` warnings from `vite:esbuild` (`shuffle-source-into-library`,
`target-player-sacrifice-attacking-creature`) are upstream, unrelated to this
change, and harmless (first match wins; dead code only).

### Worker-05: merged onto the integrator's latest batch (2026-09-04)

Fetched `origin/feat/activated-abilities-and-triggers` (now at `8c9e7fe`, far
ahead of the `8bcf441` base this branch started from) and merged it in before
continuing, per the user's instruction to re-check `AI_CONTRIBUTOR.md` and
`WORK_CLAIMS.md`. Cross-checked every worker-05 claim above against the new
HEAD: `equipped-creature triggered abilities` (commit `2753dfb`) and Condemn
(`66a74da`, as `bottom-attacker-controller-gains-toughness`) were already
integrated independently — dropped the redundant equipped-creature work
in progress before it was ever committed, and removed worker-05's duplicate
Condemn effect (`bottom-of-library-target-attacking-creature-then-life-gain-toughness`)
and its now-dead second `attacking-creature` `legalTargets` branch, keeping
the integrator's version. `any-creature-enters-trigger`,
`target-player-draw-and-lose-life` (the `draw-target-player`/`lose-life-target-player`
compound), `blood-artist-drain`, `rules-partner-keyword`, and Swords to
Plowshares (`exile-target-creature-then-life-gain-power`) were not duplicated
and remain worker-05's own contribution. Full check/test/simulate rerun green
after the merge; `npm run rules:engine:export` and `rules:set:coverage`
regenerated against the merged tree before the next claim.

### Integrator checkpoint: Protection quality (2026-09-04)

Protection from color is now represented as a reusable profile operand and
enforced for legal permanent targets, blocking declarations, and combat damage
prevention (CR 702.16). The scenario uses Sphinx of the Steel Wind and a red
creature; it also verifies that first-strike combat can destroy the red creature
without marking damage on the protected Sphinx. Non-color protection qualities
remain intentionally unparsed until a fixture requires them. The refreshed
export is **190/341 C13 (55.7%)**, with **151 unfinished** and **73 one-line-away**.

### Incoming worker patch queue

`commitsv1.patch` / `commitsv1.md` report one external commit
(`83872d6`, `worker/c13-primitives-batch1`), not a batch. It overlaps the
already-integrated multi-color reduction and combat-prevention work, so it is
queued for comparison rather than applied wholesale. The integrator continues
to process incoming fork work in batches of 11+ commits; use the exact
card-to-commit map when rescuing additional changes.

### C13 conditional kicked Split second (2026-09-04)

The Oracle compiler preserves `If ~ was kicked, it has split second` as the
reusable `kickedKeywords` operand. The engine activates that keyword only while
the kicked spell is on the stack, reusing the normal Split second priority lock
without changing non-kicked casts (CR 702.33e, 702.61). Scenarios cover profile
completeness, kicked casting, and the opponent response window.

### Integrator checkpoint: multiple nonblack targets (2026-09-04)

The compiler now carries ordered target requirements on the card profile, not
only on modal choices. This makes the reusable `destroy-n-creatures` primitive
honor explicit targets while retaining its deterministic fallback for effects
without target selection. `Reckless Spite` is covered as two distinct nonblack
creature targets followed by controller life loss (CR 601.2c, 608.2b). C13 is
now **191/341 (56.0%)**, with **150 unfinished** and **72 one-line-away**.

### Integrator checkpoint: source-only combat prevention (2026-09-04)

`CombatRules` now distinguishes prevention to-and-by the source from
prevention only to the source. `Guard Gomazoa` uses the latter; combat damage
assignment, trample overflow, and its own outgoing damage remain correct under
CR 615.1. The reusable profile closes equivalent Oracle printings as well.
The refreshed export is **192/341 C13 (56.3%)**, with **149 unfinished** and
**71 one-line-away**. The fork report `3af0cb0` (conditional Split second) is
also queued as one incoming commit and remains outside the integration batch.

### C13 conditional life-comparison draw (2026-09-04)

The effect IR now supports “Then if you have more life than an opponent, draw
N cards” as a reusable conditional draw. It evaluates after preceding effects,
so Survival Cache gains life before checking the comparison (CR 608.2c).

### Primitive dictionary and mass one-line audit (2026-09-04)

Added `tools/rules/build_primitive_dictionary.py` and the generated
`docs/PRIMITIVE_DICTIONARY_C13.md`. It indexes common wording such as
`sacrifice`, `search`, `exile`, `return`, `draw`, `discard`, `counter`,
`damage`, `token`, triggers and activated abilities against the actual parser
fields and engine handlers. The sacrifice section explicitly distinguishes
costs from effects and links typed and multi-permanent candidate selection.
The generated C13 audit currently reports **205/341 complete**, **136
unfinished**, and **58 cards one unmatched line away**. Those candidates are
grouped by normalized blocker and suggested claim, so a worker fixes the shared
primitive instead of repeating a card-name patch. Run
`npm run rules:engine:export`, `npm run rules:roadmap:c13`,
`npm run rules:oracle:plan:c13`, and `npm run rules:dictionary:c13` after each
accepted batch.

The mass audit closed Deathbringer Thoctar by reusing the activated-ability
parser's source normalization for Oracle's “It deals...” wording; the scenario
still exercises counter payment, target legality and stack resolution. This is
the model for future one-line fixes: only mark a card complete after the fresh
engine export confirms every line.

### External commit rescue protocol

When worker commits arrive, fetch all refs only at the scheduled ten-minute
integration check (or on an explicit exception), then inspect each candidate's
stat, diff and tests. Rescue code and scenarios selectively; never merge a
stale full tree or generated status file wholesale. Preserve existing parser
fields and engine handlers, resolve conflicts explicitly, regenerate coverage,
run the full checks, and record each head as accepted, duplicate, rejected or
pending with its reason. Accepted incoming work is consolidated into one batch
commit when the queue reaches eleven or more commits, unless a safety or
blocking fix requires earlier integration.

### Pages and local match server

GitHub Pages remains a static client and cannot execute Fastify/Socket.IO. The
local authoritative server is currently healthy at `http://localhost:8787`
(`GET /health` returned `{"ok":true,"service":"prossh-match-server"}`). Use
`npm run dev:server` alongside `npm run dev` for AI-battle testing. A public
AI battle requires a separately deployed match-server origin configured through
`window.__PROSSH_API_BASE__`; Pages must never treat its HTML fallback as the
match API.

### Review-first worker queue (2026-09-04)

The C13 worker planner now accepts `data/rules/oracle-effects-c13.json` and
promotes cards with status `needs-review` before broad primitive work. It also
tracks the exact engine `one_line_cards` queue, so workers can close cards with
one unresolved Oracle line first. This is triage only: each change still needs
the appropriate Comprehensive Rules citation and scenario test. Regenerate with
`npm run rules:engine:export`, `npm run rules:roadmap:c13`, then
`npm run rules:oracle:plan:c13`; choose randomly among the highest-priority
unclaimed jobs and re-check `docs/WORK_CLAIMS.md` immediately before editing.
After refreshing the engine export, the current plan reports **9** Oracle
needs-review card occurrences across its unclaimed C13 jobs and **39**
one-line candidates in those jobs. The authoritative C13 export is **206/341
complete**, with **135** unfinished and **58** one-line-away cards.

### Worker-05: shock lands were already correct, just uncredited (2026-09-04)

Claim `rules-shock-land-credit`, continuing from the same user-supplied
Moxfield decklist. "As ~ enters, you may pay 2 life. If you don't, it enters
tapped." (Blood Crypt, Watery Grave, Steam Vents in the decklist) turned out
to need **zero engine changes** — `entersTapped`'s `unless-pay-life` branch
(`engine.ts`) already enforces exactly this: paying whenever the player's
life total can comfortably afford it (`life > rule.life + 1`), tapped
otherwise. `parseEntersTapped` (`characteristics.ts`) already recognized the
wording into that structured rule too. The only gap was that the per-line
`unimplementedText` loop had no consumption check for this specific two-
sentence combo, so every shock land was honestly-but-wrongly reported as
`fullyImplemented: false` despite the printed text executing correctly.
Added the missing `continue` and — since this exact mechanic apparently had
no scenario test anywhere in the suite — a first one: plays the land at high
life (untapped, −2 life) and at life 2 (tapped, life unchanged).

Fully implements the entire real shock-land cycle: Blood Crypt, Watery Grave,
Steam Vents, Breeding Pool, Hallowed Fountain, Temple Garden, Overgrown Tomb,
Sacred Foundry, Godless Shrine, Stomping Ground. Global export:
**8,780/38,711** (+15 from 8,765 before this and the drain cluster above).
`npm run check` and `npm test` PASS (**479 rules tests**, up from 478;
simulator and the full Python suite PASS). Same two pre-existing upstream
duplicate-`case` `vite:esbuild` warnings as before, unrelated.

Worth flagging for a future claim: `parseEntersTapped`'s other branches
(`unless-reveal-card` for Frostboil-style reveal lands, `unless-few-lands`,
`unless-many-lands`) likely have the identical uncredited-but-working gap —
not checked in this batch, scope was the decklist's shock lands only.

### Worker-05: pain lands/talismans were producing colored mana for free (2026-09-04)

Claim `rules-pain-mana-lifecost`, from the same decklist (Shivan Reef,
Talisman of Dominance, Talisman of Indulgence). Unlike the shock-land claim
above, this one is a **real correctness bug**, not just a missing credit:
`parseManaInstruction` (`characteristics.ts`) recognized "{T}: Add {U} or
{R}. ~ deals 1 damage to you." far enough to produce the mana ability, but
had no handling for the trailing "~ deals N damage to you" clause, so it
silently dropped it — the ability's `lifeCost` came out `0`. Every pain land
and painful talisman was granting its colored mana for free.

Added a strip step for that clause (same shape as the existing "You gain N
life" strip immediately above it) and folded the amount into `lifeCost`,
which was already fully wired everywhere else — activation legality (can't
activate at lethal-or-lower life), the mana planner, and payment. No engine
change was needed, only the parser gap. Added the primitive's first scenario
test: activating the colored half at `abilityIndex: 1` now costs exactly 1
life and produces the mana, while the colorless half at `abilityIndex: 0`
stays free.

Fully implements 30 cards: the complete pain-land cycle (Adarkar Wastes,
Battlefield Forge, Brushland, Caves of Koilos, Karplusan Forest, Llanowar
Wastes, Shivan Reef, Sulfurous Springs, Underground River, Yavimaya Coast)
and the complete painful-talisman cycle (all 10 guild pairs), plus Ancient
Tomb, Grand Coliseum, Tarnished Citadel, Fogwell's Gym, Elves of Deep Shadow,
Scabland, Salt Flats, Pine Barrens, Skyshroud Forest, and Caldera Lake.
Global export: **8,810/38,711** (+30 from 8,780 after the shock-land claim).
`npm run check` and `npm test` PASS (**480 rules tests**, up from 479;
simulator smoke tests and the full 55-test Python suite PASS).

`npm run simulate:engine` now reports **2/200** invariant failures instead of
the usual 1 — seed 92 (the known pre-existing "P1 lost track of its
commander" bug) plus **seed 116, newly failing with the identical message**.
Verified this is not a new bug: stashing this claim's diff and rerunning
reproduces exactly the original 1/200 (seed 92 only) on the same commit.
Since this claim legalizes new mana abilities the bot did not have before,
it changes which legal actions exist at various decision points, which
changes the deterministic-but-seed-dependent game path — so the same
pre-existing bug is now reachable from one additional seed. The underlying
bug itself is unrelated to mana/life and remains unfixed; it should be
investigated on its own (seed 92 and seed 116 both point at the same commander-
tracking invariant) rather than blocking this claim.

### Worker-05: Torbran-style damage amplifiers, a new static primitive (2026-09-04)

Claim `rules-damage-amplify`, continuing the decklist (Torbran, Thane of Red
Fell). This is genuinely new territory, not a variant of an existing
primitive: "If a red source you control would deal damage to an opponent or
a permanent an opponent controls, it deals that much damage plus 2 instead"
(CR 614.1c) is a static replacement effect on the *amount* of damage, which
nothing in the engine modeled before. Designed it as a reusable
`CardProfile.damageAmplify` shape (`colorFilter?: ManaType`, `excludesSelf`
for "another ... source" wording, `scope: "opponent" | "any"`, `amount`) and
a `damageAmplifyBonus` helper that sums every matching amplifier the
damage's controller has on the battlefield.

The subtle part was wiring it into every damage path without double-counting
or missing spells: `dealDamageToPermanent` gained an optional `source`
param threaded through all 8 `applyEffect` call sites plus combat damage
(each already had `controller`/`sourcePermanentId` on hand). Player damage
needed a correction mid-implementation — `dealDamageFromObject` must key
amplification off `object.controller`/`object.card` directly, *not* the
permanent looked up by `sourceForDamage`, because a spell dealing its own
damage (Lightning Bolt, say) has no matching battlefield permanent yet;
relying on that lookup silently produced zero bonus for every spell while
still amplifying combat/activated-ability damage correctly. Combat damage to
players and commander-damage tracking both apply the same bonus via the
existing `dealer` permanent, which is always resolvable there.

Fully implements Torbran, Thane of Red Fell; Jaya, Venerated Firemage;
Embermaw Hellion; Thor, Asgard's Avenger (4 cards, matching every catalog
card whose amplifier clause names a single fixed color or none, uses plain
"a"/"another" — not an "or" color/type list — and doesn't gate on an extra
condition like Saga chapters or Max Speed). Scenario coverage: combat damage
from the amplifier's own red body (self-inclusion, no "another"), a red
spell amplified against an opponent, a blue spell *not* amplified (color
filter), and the same red spell targeting its own controller *not* amplified
(opponent-only scope).

**Known limit, left honest rather than guessed at:** lifelink on amplified
combat damage still gains only the pre-amplification amount —
`computeCombatDamage` computes the lifelink batch before `applyCombatDamage`
applies the bonus, and reordering that touches combat's core damage-batching
architecture beyond this claim's scope. No currently-pending card combines
lifelink with being amplified by this exact family, so it isn't blocking
anything today, but a future claim should thread the bonus into the lifelink
batch too.

Global export: **8,814/38,711** (+4 from 8,810 after the pain-mana claim).
`npm run check` and `npm test` PASS (**481 rules tests**, up from 480;
simulator and the full 55-test Python suite PASS). `npm run simulate:engine`
still reports 2/200 (seeds 92 and 116, both the same pre-existing bug
already flagged above and as a separate task) — no new seed introduced by
this claim.

### Worker-05: ritual spells wire up the dormant "add-mana" spell effect (2026-09-04)

Claim `rules-ritual-add-mana`, continuing the Nekusar decklist (Dark Ritual).
The `"add-mana"` `SpellEffect` kind and its `engine.ts` executor already
existed, fully correct, adding a fixed pool straight into the caster's mana
pool — but nothing in `characteristics.ts` ever produced that effect. It was
a dead primitive: type and executor present, zero `recognizeSentence`
wiring, so every ritual spell parsed as unimplemented regardless of how
simple its text was. This is the same "Nemotron pattern" flagged by the new
`docs/WORKER_COMMIT_AUDIT.md` integrator gate, just found on our own side
first.

Added one `recognizeSentence` pattern matching the literal `Add {mana
symbols}.` sentence and reusing the existing `parseAddClause` helper (already
battle-tested for land/creature mana abilities) to build the effect's
`pool: Record<string, number>`. `parseAddClause` returns either a single
repeated symbol (`{R}{R}{R}` on Pyretic Ritual) or a `fixedProduces` list of
distinct symbols (`{W}{U}{B}{R}{G}` on Channel the Suns); both shapes fold
into the pool. Deliberately left unmatched: any ritual phrased as a choice
("choose a color") or "any color" mana, since no printed ritual in the
catalog asks the caster to pick and guessing at that shape isn't worth the
risk of getting the choice-resolution UX wrong.

Fully implements 10 cards, verified individually against `oracle_text`
rather than assumed from the pattern match: Dark Ritual, Pyretic Ritual,
Seething Song, Channel the Suns (single bare `Add {...}.` sentence); First
Stage of Magic Design, Rapturous Moment, Liturgy of Blood, Seismic Spike,
Deconstruct, Turn to Dust (an `Add {...}.` sentence alongside other clauses
that were already independently parsed — draw/discard, destroy-target, life
gain, damage). 12 other cards in the catalog also contain a bare `Add
{mana}.` sentence but stay `fullyImplemented: false` because a different
clause on the same card is still unmodeled (e.g. Cabal Ritual's
life-payment-scaled amount, Desperate Ritual's Convoke-style alternate cost);
this claim does not touch those.

Global export: **9,032/38,712** (+18 from 9,014 — includes cards where the
new pattern completed the *last* remaining unimplemented sentence, on top of
the 10 named above whose entire text is now covered end-to-end). `npm run
check` and `npm test` PASS (**514 rules tests**, up from 513, plus the full
64-test Python suite). `npm run simulate:engine` reported 8/200 immediately
after this change (up from 7/200); stashed the diff and reran on the exact
same base commit twice in a row and got 7/200 both times but with two
*different* seed sets (`23,40,68,84,92,114,175` vs. `23,34,40,55,68,92,158`)
— the harness itself is not deterministic run-to-run at a fixed commit, so
an 8-vs-7 delta carries no signal. Both failure classes ("owns N card
objects, expected 100" and "lost track of its commander") are the
pre-existing upstream invariant bugs already documented above and being
tracked separately, not something this claim introduces.

### Worker-05: discards become a watchable event (2026-09-04)

Claim `rules-discard-event-trigger`, continuing the Nekusar decklist
(Liliana's Caress). "Whenever a player discards a card" is an extremely
common Wheel/discard-punisher trigger shape, but nothing in the engine could
answer it: every discard was an inline `hand`/`graveyard` mutation baked
into whichever effect caused it — the pending-choice resolver
(`applyChooseDiscard`, backing `Target player discards a card` and
`draw-then-discard`), the end-of-turn hand-size cleanup, two separate
activated-ability discard-as-a-cost sites, `Windfall`'s discard-your-whole-hand
effect, and Syphon Mind's "each opponent discards their priciest card." None
of the seven raised anything a triggered ability could watch for.

Added `card-discarded` to both `GameEvent` and `TriggerEvent` (mirroring the
already-existing `card-drawn`), and a `discardCard`/`discardCards` pair of
helpers next to `loseLife`/`drawCards` that perform the exact same mutation
each site already did, then `raiseEvent` it. All 7 sites now call the
helper instead of hand-rolling the mutation — the selection logic (which
card gets discarded, how many, in what order) is untouched, only the missing
event is added. `eventController` capture was already generalized last
claim to any `seat`-keyed event, so `"that player" ...` effect language
resolves automatically off `object.trigger?.eventController` with zero
further wiring; two `TRIGGER_TEMPLATES` patterns (`whenever a player
discards a card` / `whenever an opponent discards a card`) complete the
parser side.

Fully implements Liliana's Caress (`lose-life-event-player`), Megrim
(`damage-event-player`), Spirit Cairn (optional pay-to-create-token),
Geth's Grimoire (optional draw), Abyssal Nocturnus (`+2/+2` and fear until
end of turn) — five cards across four *different* pre-existing effect kinds,
none of which needed a single line of new executor code; the new event was
the entire gap. Scenario coverage casts `Target player discards a card`,
verifies the pending-choice resolves normally, and confirms the watcher's
life-loss effect fires keyed to the discarding player, not the caster.

Global export: **9,099/38,712** (+5 from 9,094 post-merge). `npm run check`
and `npm test` PASS (**517 rules tests**, up from 516, plus the full
Python suite). `npm run simulate:engine` reports 10/200 — identical seed set
to the post-merge baseline immediately before this claim, so no new failure
introduced (this is a purely additive change: existing discard mutations are
unchanged, only a new event is raised alongside them).

**Known limit:** Waste Not's three per-discarded-card-type triggers
("...discards a creature card" / "a land card" / "a noncreature, nonland
card") need a card-type filter on the trigger itself, which `TriggerSubject`
doesn't carry yet for discard events — left for a follow-up claim rather
than bolted on here.

### Worker-05: "whenever you draw/discard a card" was the one subject missing (2026-09-04)

Claim `rules-you-draw-discard-trigger`, continuing the Nekusar decklist
(Sheoldred, the Apocalypse). `TriggerSubject` already had a `"you"` value —
it's what makes `"life-gained"`/`"life-lost"` triggers work — but the
`card-drawn`/`card-discarded` event matcher only ever checked for
`"each-player"` and `"opponent"`, so `"Whenever you draw a card, ..."` never
fired even though every piece it needed already existed. One `if` branch
(`if (definition.subject === "you") return event.seat === watcher.controller;`)
closes the gap for both events at once.

No new effect executor was needed either: `"You gain N life"` already
resolves against the ability's own `controller` (plain `gain-life`, not the
event-keyed `lose-life-event-player`), and for a `"you"`-subject trigger the
controller *is* the player who drew/discarded, so it was correct without
touching it. The only other change was widening the existing `"That player
loses N life"` pattern to also accept `"They lose N life"` — the same
`lose-life-event-player` effect, Sheoldred just uses the shorter pronoun.

Fully implements 15 cards found by grepping the catalog for `"whenever you
(draw|discard) a card"`: Sheoldred, the Apocalypse; Niv-Mizzet, the
Firemind; Hobgoblin, Mantled Marauder; Chasm Skulker; The Value Knight;
Spirit; Psychic Corrosion; Mystic Redaction; Clinquant Skymage; Oneirophage;
Ravenhill Flock; Lyla, Holographic Assistant; Lorescale Coatl; Burlfist Oak;
Horizon Chimera. Scenario coverage casts a two-target draw spell at the
ability's own controller (confirms the `"you"` life-gain branch) and at an
opponent (confirms the `"opponent"` branch still drains the opponent, never
the controller) with the same permanent on the battlefield.

Global export: **9,114/38,712** (+15 from 9,099). `npm run check` and `npm
test` PASS (**518 rules tests**, up from 517, plus the full Python suite).
`npm run simulate:engine` reports 12/200; stashed the diff and reran twice
on the same base commit, reproducing exactly 10/200 with the identical seed
set both times — the two extra failures are newly-legalized bot actions
(Sheoldred and friends becoming castable) reaching the same pre-existing
invariant bugs via new game paths, the same pattern documented on every
prior claim this session, not a new bug.

### Worker-05: opponent-lands mana rocks, plus a latent state-passing bug they exposed (2026-09-04)

Claim `rules-opponent-lands-any-color-mana`, continuing the Nekusar decklist
(Fellwar Stone). "{T}: Add one mana of any color that a land an opponent
controls could produce" was deliberately unmodeled: `parseAddClause` in
`characteristics.ts` carries a comment explicitly refusing to read this
clause, because doing so naively would hand the table five free colors
regardless of the actual board. What nobody had fixed is that refusal fell
through to the *next* layer down — the `produced_mana` Scryfall fallback —
which had no such scruples and quietly built the bogus five-color ability
anyway. A characteristics test (`refuses to read a restricted mana clause as
five free colours`) asserted exactly this: the fallback ran, but
`fullyImplemented` stayed `false` so the bogus ability was at least never
credited as correct.

Implemented it properly instead of leaving it refused: `ManaAbility` gained
`anyColorFromLandsControlledBy: "opponent" | "you"`, computed not from the
card but from the battlefield at activation time via a new
`colorsFromLandsControlledBy(state, seats)` helper (unions every mana color
each of the given seats' lands could produce, from their own
`manaAbilities`, basic lands included since those already synthesize an
ability from `produced_mana`). `manaOptionsFor` — the one function every
mana-source call site funnels through — gained a `state` parameter to
support this, threaded through its 3 callers (`manaSources`,
`legalActions`'s mana-ability enumeration, `applyActivateMana`).

That state-threading surfaced a real, previously-invisible bug:
`applyChooseTrigger`'s "may pay {N} to keep this permanent"/"may pay {N}
onto the stack" branch called `planManaPayment(optionalCost, player)` with
no `{ state }`, while its two sibling branches a few lines above already
correctly pass `{ state: next }`. This was harmless for every ability that
existed before today, because no mana source's *options* depended on board
state — but the moment one did, `legalActions` (which does pass state)
could offer "pay" as legal while the actual `applyChooseTrigger` application
(which didn't) recomputed a poorer, state-blind source list and threw
`No puedes pagar {4} por Mana Vault.` Root-caused via `git stash` isolating
the diff (baseline: clean 200/200; with diff: 4/200, all the same error) and
a small throwaway script looping seeds 1–200 to catch it directly rather
than guessing from the aggregate count. Fixed by adding the missing
`{ state: next }`, matching the two sibling branches exactly.

Fully implements Fellwar Stone, Exotic Orchard, Sylvok Explorer, Quirion
Explorer, Harvester Druid. Updated the now-outdated characteristics test to
assert the new, correct behavior (`anyColorFromLandsControlledBy: "opponent"`,
`produces: []`, `fullyImplemented: true`) instead of the old bogus-fallback
one. Scenario coverage puts the mana rock on one seat with no lands of its
own and a Mountain/Forest on the opponent's side, confirming its options are
exactly `{R, G}` — never anything from the caster's own board.

Global export: **9,119/38,712** (+5 from 9,114). `npm run check` and `npm
test` PASS (**520 rules tests**, up from 518 — one new scenario plus the
updated guard test). `npm run simulate:engine`: **200/200 passed**, both
before this claim (post the upstream commander-fix merge) and after fixing
the state-passing bug above; the 4/200 Mana Vault failure was transient,
introduced and then fixed within this same claim, never landed on `worker-05`.

### Worker-05: check lands were already correct too, same uncredited bug as shock lands (2026-09-04)

Claim `rules-check-land-credit`, continuing the Nekusar decklist (Choked
Estuary). Same shape as the earlier shock-land fix: the `entersTapped`
`unless-reveal-card` rule was already fully enforced in `engine.ts`
(`applyPlayLand` raises a `reveal-card` pending choice; upstream had already
landed full scenario tests for it against Frostboil Snarl), but the printed
"As ~ enters, you may reveal a(n) <type> card from your hand. If you don't,
~ enters tapped." line was never consumed by the per-line coverage check in
`characteristics.ts`, so it fell through to the generic sentence-splitter
and got reported as two separate unimplemented fragments — keeping every
check land `fullyImplemented: false` despite playing correctly. Added one
consumption regex next to the existing shock-land one, matching the same
style. No engine change; added a profile-level test crediting Frostboil
Snarl alongside its existing (already-passing) behavioral tests.

Fully implements 17 of the 19 catalog cards using this rule: Frostboil
Snarl, Vineglimmer Snarl, Shineshadow Snarl, Furycalm Snarl, Necroblossom
Snarl, Port Town, Foreboding Ruins, Game Trail, Fortified Village, Choked
Estuary, Ancient Amphitheater, Gilt-Leaf Palace, Secluded Glen, Wanderwine
Hub, Auntie's Hovel, Murmuring Bosk, Flamekin Village. Primal Beyond and
Rustic Clachan stay `false` — each carries one more unrelated unimplemented
line (a restricted-mana ability and Reinforce, respectively) untouched by
this claim.

Global export: **9,143/38,712** (+17 from 9,126). `npm run check` and `npm
test` PASS (**525 rules tests**, up from 524). `npm run simulate:engine`:
**200/200 passed**, unchanged — expected, since this is a pure coverage
credit with zero behavioral change.

### Worker-05: "entered this turn" mana lands needed a permanent-level clock the engine never kept (2026-09-04)

Claim `rules-mana-entered-this-turn-restriction`, continuing the Nekusar
decklist (Hidden Lair). "{T}: Add {U} or {B}. Activate only if ~ entered
the battlefield this turn or if you control a basic land." is a fast-mana
gate on a two-ability land (the `{C}` half is unconditional): the ability
is free the turn the land is played, then locked behind having a basic
land out afterward. Nothing like it existed: `summoningSick` tracks
creature-specific "just arrived" state, but no field on `Permanent` recorded
"this entered the battlefield this turn" for any permanent type, mana
abilities included.

Added `Permanent.enteredThisTurn: boolean`, following the exact lifecycle
`summoningSick` already uses — stamped `true` in `putOntoBattlefield` (the
one real creation path) and reset to `false` for the active player's whole
battlefield in the `untap` step (CR 302.6's "since the beginning of that
player's most recent turn" window, just generalized past creatures). Making
the field required rather than optional was deliberate: it forced the
compiler to point at every `Permanent` object literal in the codebase
(3 in `engine.ts`, 4 across `engine.test.ts` and
`services/match-server/src/matches.test.ts`) instead of trusting me to find
them all by hand.

New `ManaAbility.activationRestriction: { enteredThisTurn: boolean;
orControlsBasicLand?: boolean }`, parsed in `parseManaInstruction` right
alongside the existing `requiresLands` restriction (same "strip a trailing
clause, recurse into `parseAddClause` on what's left" shape), enforced in
`canUseManaAbility` — the single choke point already shared by
`manaSources`, `legalActions`, and `applyActivateMana`, so no call site
needed its own copy of the check. The basic-land branch reads
`cardProfile(land).supertypes.includes("Basic")`; caught one mistake before
committing — this codebase's own `splitTypeLine` puts "Basic" in
`supertypes` (matching how Scryfall type lines actually work), not
`subtypes`, despite an unrelated same-named local variable elsewhere in the
file for a different job (parsing "search for a basic land card" text) that
made it look otherwise at a glance. A scenario test with a Forest on the
battlefield caught the mismatch immediately.

Fully implements Hidden Lair, Dark Fortress, Training Compound, Gleaming
Bastion, Gathering Place, Mirrex (Mirrex's own third ability — a Phyrexian
Mite token-creator — was already modeled independently, so only this
restriction stood between it and full coverage). Scenario coverage plays
the land fresh (colored half available immediately), advances a full round
with no basic land out (colored half shuts off, `{C}` half still works),
then adds a Forest and confirms the colored half reopens.

**Known limit:** the identical restriction phrase also gates a non-mana
activated ability (Fungus Elemental's "Activate only if ~ entered this
turn", no basic-land escape clause) — this claim only wires
`enteredThisTurn` into `ManaAbility`/`canUseManaAbility`, not
`ActivatedAbility`'s own legality check, so Fungus Elemental stays
unimplemented pending a follow-up claim.

Global export: **9,150/38,712** (+6 from 9,144). `npm run check` and `npm
test` PASS (**527 rules tests**, up from 525). `npm run simulate:engine`:
**200/200 passed**.

### Worker-05: a missing trigger template, not a missing primitive (2026-09-04)

Claim `rules-noncreature-spell-cast-each-player-drain`, continuing the
Nekusar decklist (Mai, Scornful Striker). Every piece "Whenever a player
casts a noncreature spell, they lose 2 life" needed already existed:
`spellType: "noncreature"` filtering in the trigger matcher, the
`each-player` subject, `eventController` capture off `spell-cast`'s own
`controller` field (from an earlier claim this session), and
`lose-life-event-player` as the effect. Nobody had ever combined
`each-player` with the `noncreature` filter in a `TRIGGER_TEMPLATES` entry —
only `you`+`noncreature` (Prowess) and `you`/`opponent`+`creature` existed.
Adding the one template also required widening `TriggerTemplate`'s own
`spellType` union, which had drifted out of sync with the sibling
`TriggerDefinition` type (missing `"noncreature"` even though the executor
already handled it) — caught immediately by `tsc`, not a runtime gap.

Fully implements Mai, Scornful Striker; Ruric Thar, the Unbowed; Medusa,
Inhuman Queen. Scenario coverage casts a noncreature spell as the trigger
source's own controller (self-inflicted life loss — "a player" is not "an
opponent") and confirms a creature spell never triggers it.

Global export: **9,163/38,712** (+3 from 9,160). `npm run check` and `npm
test` PASS (**538 rules tests**, up from 537). `npm run simulate:engine`:
**200/200 passed**.

### Worker-05: Surveil, built as a generalization of Scry rather than a duplicate (2026-09-05)

Claim `rules-surveil`, continuing the Nekusar decklist (Otherworldly Gaze).
Surveil N (CR 701.42) is mechanically Scry N with one difference: declined
cards go to the graveyard instead of the library bottom. Rather than build
a parallel `PendingChoice`/resolution path, generalized the existing one:
the `"scry"` choice type and `beginScry` gained a
`destination: "library-bottom" | "graveyard"` parameter, defaulting to
`"library-bottom"` so every one of Scry's existing call sites, tests, and
log messages needed zero changes — only `applyChooseScry`'s final-resolution
branch gained a `destination === "graveyard"` fork routing the declined
cards to the graveyard, and the Spanish log/label text got a graveyard
variant ("en el cementerio" / "termina de vigilar").

New `SpellEffect` kind `"surveil"` (`{ amount }`), wired at both places Scry
itself is dispatched — as a spell's own effect and as a triggered ability's
effect — calling the same `beginScry` helper with
`destination: "graveyard"`. Two `recognizeSentence` patterns ("Surveil N"
in both digit and word-number form, mirroring Scry's own pair) complete the
parser side.

This was the highest-leverage claim of the session by a wide margin: Surveil
appears on **210** cards in the full catalog (only 1 was already
implemented, apparently by accident/coincidence before this claim). Fully
implements **73** of them — everywhere Surveil was the card's only
unimplemented clause — including the target card Otherworldly Gaze plus
well-known cards like Consider, Sinister Sabotage, Doom Whisperer,
Unexplained Disappearance, Curate, and Think Tank. The other 137 have a
second unmodeled clause (a triggered ability, a modal choice, etc.) and stay
`fullyImplemented: false` pending separate claims.

Scenario coverage: a spell-level Surveil 2 (declined card confirmed in the
graveyard, never the library bottom) and a triggered ETB Surveil 2 through
the trigger bus (same graveyard destination, exercising the second dispatch
site). Both existing Scry tests pass completely unchanged, confirming the
generalization didn't touch Scry's own behavior.

Global export: **9,243/38,712** (+72 from 9,171; of the 73 now-`true`
Surveil cards, one was already implemented before this claim by
coincidence). `npm run check` and `npm test` PASS (**545 rules tests**, up
from 543). `npm run simulate:engine`: **200/200 passed**.

### Worker-05: Reanimate needed a phrasing variant, not a new mechanic (2026-09-05)

Claim `rules-reanimate`, continuing the Nekusar decklist (Reanimate itself).
"Put target creature card from a graveyard onto the battlefield under your
control" was completely unmodeled, but only because of wording: the
existing `return-target-creature-card-from-graveyard-to-battlefield`
executor already does exactly this — `putOntoBattlefield(next,
object.controller, card, false)` puts the card under the *caster's*
control regardless of which player's graveyard it came from — it was just
never matched, because every existing recognizer looked for "Return ... to
the battlefield," and Reanimate/Hymn of Rebirth say "Put ... onto the
battlefield under your control" instead. Added that phrasing as a second
pattern mapping to the same effect and the already-existing (but
previously unused) `creature-card-in-a-graveyard` target kind.

The costed half ("You lose life equal to that card's mana value") needed a
genuinely new compound effect, `reanimate-target-creature-lose-mana-value-life`,
modeled on the existing `return-target-artifact-and-gain-mana-value`
precedent: read the card's mana value before it leaves the graveyard, move
it to the battlefield, then apply the cost. Life is lost by the caster, not
the card's original owner — confirmed with a scenario that reanimates from
an *opponent's* graveyard and checks life drops only on the caster's side.

Fully implements Reanimate and Hymn of Rebirth outright. Teneb, the
Harvester (combat-damage trigger with an optional `{2}{B}` pay-cost) and
Debtors' Knell (upkeep trigger) both use the identical clause as a
*triggered* ability and flip to fully implemented for free — the trigger
and optional-cost infrastructure they route through was already generic
enough to need no changes at all.

Scenario coverage: reanimating a Bear from seat 1's graveyard onto seat 0's
battlefield with the correct 2-life cost (Grizzly Bears has mana value 2),
and a second test confirming the plain (no-cost) phrasing reanimates for
free.

Global export: **9,259/38,712** (+5 from 9,254 — 4 unique cards, one
counted twice across reprints). `npm run check` and `npm test` PASS
(**549 rules tests**, up from 547). `npm run simulate:engine`:
**200/200 passed**.

### Worker-05: a keyword gated on whose turn it is (2026-09-05)

Claim `rules-keyword-during-your-turn`, continuing the Nekusar decklist
(Razorkin Needlehead). "~ has first strike during your turn" needed a new
primitive distinct from the existing `staticKeywordGrants`: that system
grants keywords to *other* permanents (all creatures, creatures you
control, a subtype, etc.) unconditionally; this is self-only and
conditional on the active player. Added `CardProfile.keywordsDuringYourTurn`,
parsed with the same `GRANTABLE_KEYWORDS` list and `parseKeywordList` helper
`parseStaticKeywordGrant` already relies on, and checked in `keywordOf`
against `state.activeSeat === permanent.controller`.

Scenario coverage exercises both directions on the same creature: attacking
on its own turn (first strike applies, kills the blocker before regular
damage — identical to a plain first striker), and blocking on the
opponent's turn (no first strike, so both creatures trade simultaneously
instead of the source surviving). The second case is what actually proves
the gate works rather than the keyword being unconditionally on.

Fully implements Razorkin Needlehead. Hunter's Blowgun carries the
identical clause but on an Equipment granting to whatever it's attached to,
with an "otherwise it has reach" else-branch — a genuinely different shape
(conditional-with-alternative on a non-self target) left for a follow-up.

Global export: **9,272/38,712** (+1 from 9,271). `npm run check` and `npm
test` PASS (**552 rules tests**, up from 551). `npm run simulate:engine`:
**200/200 passed**.

### C13 Razor Hippogriff artifact recovery (2026-09-04)

The artifact-graveyard return primitive now supports optional recovery followed
by life gain equal to the recovered card's mana value. Razor Hippogriff is the
covered C13 application (CR 603.2, 608.2).
### Worker checkpoint: Brooding Saurian ownership reset (2026-09-04)

Added the reusable `return-owned-nontoken-permanents-to-control` trigger
primitive. At each end step it restores control of every nontoken permanent
to its owner without changing zones, covering Brooding Saurian (CR 603.2,
603.6, 110.2). Commit `f6f8031` is queued for integration; this
branch is based on `b008385` and excludes sibling worker commits.

### C13 optional cycle “may have” triggers (2026-09-04)

The generic `card-cycled` trigger parser now normalizes “you may have it deal …”
and “you may have target creature gain …” into existing reusable effects. Slice
and Dice uses the all-creature damage path; Dirge of Dread uses the targeted
temporary keyword path (CR 603.2, 702.29).
### Integrator checkpoint: Capricious Efreet multi-target random destruction (2026-09-05)

Added reusable ordered multi-target trigger selection: mandatory targets are
chosen first, optional target slots can be finished explicitly, and target
filters remain authoritative per slot. Capricious Efreet now selects one
controlled nonland permanent plus up to two opposing nonland permanents, then
destroys one selected target using deterministic RNG (CR 603.3d, 601.2c,
701.7). The functional worker commit `a868c8d` is integrated on top of the
current authoritative engine; stale generated handoff text was not imported.

Azorius Herald | `a0476da9-51b1-4cd3-90c4-ad01d0e4c3d6` was then closed in
`c11cd0f`. The parser recognizes “sacrifice it unless {U} was spent to cast
it”, the stack records colors actually spent, and permanents retain that
payment context for the enters trigger (CR 603.4). Validation: 572 rules
tests, `npm run check`, 9,311 global profiles, C13 258/341.

Hooded Horror | `8267561e-bc25-4aaa-8242-f6d7ec88143e` was then closed with
the dynamic defending-player creature-count evasion primitive (CR 509.1b).
Its blocker legality compares the defender's creature count with the maximum
among all players, including ties. Validation: 574 rules tests, `npm run
check`, 9,321 global profiles, C13 259/341.

Prossh, Skyraider of Kher | `868882d2-ed4e-4171-a17c-478a341080fb` was closed
with the reusable mana-spent cast-trigger token primitive (CR 603.2, 107.3h).
The stack carries total spent mana into the trigger; a temporary watcher is
used only for the explicit “when you cast this spell” wording, so keyword
triggers such as Extort remain battlefield-only. Validation: 575 rules tests,
`npm run check`, 9,324 global profiles, C13 260/341.

The next origin audit selectively rescued two executable worker batches into
`0fc5e12`: Dungeon Geists | `ab5ebae2-cd77-4a7d-a93b-8042cd486429` adds the
opponent-creature target and source-controlled untap lock; Standstill adds the
event-caster opponent draw scope. Validation: **577 rules tests**, `npm run
check`, 9,326 global profiles, C13 **261/341**. `fa5b133` (Phyrexian Delver)
was skipped as a duplicate: the generic reanimate-plus-mana-value-loss
primitive and scenario were already present in the published tree.

`60cba3b` then closed Contested Cliffs | `b891a683-2ebc-4e9c-b402-5dd9c1b42b69`
with a reusable multi-target activation and CR 701.12 fight executor. The
authoritative action path validates each target slot independently. Validation:
**578 rules tests**, `npm run check`, 9,327 global profiles, C13 **262/341**
with 79 pending.

`f3cd692` closed Witch Hunt | `e86bd38f-7804-449d-af29-21e96a56ab30` with a
reusable deterministic random-opponent control effect (CR 603.2, 110.2).
Validation: **579 rules tests**, `npm run check`, 9,328 global profiles, C13
**263/341** with 78 pending.

`72c99c5` then closed Naya Soulbeast | `5ea0c608-2c56-4889-a5d3-d435df515950`
with a reusable cast-trigger reveal that stores total revealed mana value as
entry counters. Validation: **580 rules tests**, `npm run check`, 9,329 global
profiles, C13 **264/341** with 77 pending.

Faerie Mastermind | `a984db23-40ea-428d-829f-e944267280f8` was closed with a
new `second-draw-this-turn` trigger condition (CR 603.2, 603.3, 121.1). A
`PlayerState.drawsThisTurn` counter (reset each untap step alongside
`landsPlayedThisTurn`) is threaded onto the `card-drawn` `GameEvent` as
`count`, and `triggerMatches` requires `count === 2` for this condition. The
condition is attached statically via a new `TriggerTemplate.condition` field
(distinct from the existing ad-hoc "if X, Y" post-condition regex extraction),
covering both "a player" and "an opponent" phrasings. Known limit: Krang, the
All-Powerful | `ffab80ef-fe51-4d6d-aa6f-bd538f40844f` stays
`fullyImplemented: false` — its other clause ("If a player drawing a card
causes a triggered ability of a permanent you control to trigger, that
ability triggers an additional time") needs a distinct trigger-doubler
variant scoped to triggers *caused by* a draw event, which this claim
deliberately does not build. Validation: **584 rules tests**, `npm run
check`, `npm run simulate:engine` 200/200, 9,336 global profiles.

Brainstorm | `36cd2364-d113-47d1-b2c4-b088d9eb88dd` was closed with a new
`draw-then-put-back-on-top` effect (CR 601.2h, 701.8). Rather than a bespoke
mechanism, the existing single-card `hand-card-to-library-top` pendingChoice
(built for Widespread Panic) gained a `remaining` counter, mirroring how
`discard-cards` already iterates a multi-card choice: each pick becomes the
new top, so the player's chosen sequence determines draw order (CR 701.8a —
"in any order" is the caster's choice). Brainsurge (draw 4, put back 2) is
covered for free by the same recognizer. Validation: **586 rules tests**,
`npm run check`, `npm run simulate:engine` 200/200, 9,341 global profiles.

Forget | `619ef7e1-33cd-4470-a1d4-83c5f1f5c31e` was closed with a new
`discard-target-player-then-draw-same` effect (CR 701.8). It reuses the
existing `discard-cards` pendingChoice (the targeted player still chooses
which cards to discard, CR 701.8a) with a new optional `thenDrawSame` flag;
when the final discard resolves, the same player draws exactly as many
cards as were actually discarded (capped by hand size, so a short hand
still resolves correctly). While wiring this in, a latent duplicate
`discard-cards` `PendingChoice` union member — dead weight left over from
an earlier upstream merge — was deleted; it carried no behavior difference,
only the live member now carries `thenDrawSame`. Validation: **587 rules
tests**, `npm run check`, `npm run simulate:engine` 200/200, 9,342 global
profiles.

Teferi's Puzzle Box | `37abcc92-9466-47ea-9e0b-5eda2eb62c8e` was closed with a
new `put-active-player-hand-on-library-bottom-then-draw-same` effect
(CR 504.1, 701.8), reusing the existing `draw-step`/`each-player` trigger
template and resolving "that player" via `state.activeSeat`, the same
pattern Draw Mine's `draw-active-player` already relies on. Since the
turn-based mandatory draw (CR 504.1) happens before the triggered ability
is even put on the stack, the hand bottomed includes that turn's draw. As
with the existing "put the rest on the bottom of your library in any
order" precedent (the `library-pick` family), the bottom placement order
itself is not offered as a player choice — the cards land in their
existing order, which is inconsequential since the very next action draws
fresh cards off the top, not the ones just bottomed. Validation: **588
rules tests**, `npm run check`, `npm run simulate:engine` 200/200, 9,343
global profiles.

Howling Mine | `d26b27db-a567-4631-b4b6-7294222fbdd1` was closed with a new
`source-untapped` trigger condition (CR 603.4), attached via the existing
ad-hoc "if X, Y" post-condition extraction (`triggered.effectText`), the
same mechanism used for `no-controlled-subtype`/`creature-died-this-turn`.
It checks `findPermanent(state, watcher.instanceId).tapped` — the watching
permanent's own state, not any event object — so no new effect kind was
needed: "that player draws an additional card" already recognizes to the
existing `draw-active-player`. Validation: **589 rules tests**, `npm run
check`, `npm run simulate:engine` 200/200, 9,345 global profiles.

Peer into the Abyss | `21fa2442-6eac-4dce-a9cc-76f0053fdb8f` was closed
with a new `draw-half-library-then-lose-half-life-target-player` effect
(CR 107.1a — both halves round up independently, computed live off the
target's own library length and life total at resolution, not fixed
amounts). "Round up each time." is a rounding clarifier for the preceding
sentence, not a separate instruction, so it was added to the existing
`isIgnorableSentence` whitelist (alongside "then shuffle.") rather than
needing its own effect — a reusable hook for any future card with the
same trailing clarifier. Validation: **590 rules tests**, `npm run check`,
`npm run simulate:engine` 200/200, 9,346 global profiles.

Fevered Visions | `70763549-4b4e-4cb8-8c02-0639ba18bb1a` was closed with a
new `draw-active-player-then-damage-if-opponent-hand-at-least` effect
(CR 603.2, 603.3). Its two sentences are one trigger, not two: the draw is
unconditional for whichever player's end step it is, while the damage only
applies when that player is an opponent of the enchantment's controller
and their hand (after the draw) meets the threshold — an effect-level
branch, not a trigger-gating condition, since "opponent" here is relative
to the event's active player, not a fixed watcher scope. Discovered along
the way: `TRIGGER_TEMPLATES` had "at the beginning of each end step" but
was missing "each player's end step" entirely (only "your end step" and
"each opponent's end step" existed alongside it) — added, which may
unlock other pending cards using that exact wording. Validation: **591
rules tests**, `npm run check`, `npm run simulate:engine` 200/200, 9,347
global profiles.

Waste Not | `00fdcc19-88ed-46c3-91f0-095806228105` was closed with a new
`discardedCardType` field on `TriggerTemplate`/`TriggerDefinition` (CR
603.2, 701.8), mirroring the existing `spellType` filter but checked
against the discarded card's own type in `triggerMatches` rather than a
cast spell's. All three of Waste Not's reactions (Zombie token, `{B}{B}`,
a card) reuse pre-existing effect kinds (`create-token`, `add-mana`,
`draw`) unchanged — only the trigger-matching side needed new plumbing.
Validation: **592 rules tests**, `npm run check`, `npm run
simulate:engine` 200/200, 9,348 global profiles.

Geier Reach Sanitarium | `7b9fafe7-d26a-4ed5-b4c4-ce13763770b5` was closed
with a new `each-player-draws-then-discards` effect (CR 101.4, 701.8a).
The draw is unconditional and simultaneous for every player; the discard
is each player's own choice, so a new `nextSeats` field on the existing
`discard-cards` `PendingChoice` re-issues the same choice for the next
seat in APNAP order (controller first, then opponents in turn order) once
the current seat's discard(s) resolve, instead of clearing to `null`.
Currently hardcodes one discard per queued seat — the only caller so far
— rather than threading a per-seat variable amount through the chain.
Validation: **593 rules tests**, `npm run check`, `npm run
simulate:engine` 200/200, 9,350 global profiles.

Deadly Rollick | `0456ec64-2c81-4763-a352-8ff64a4c3d6b` was closed with the
first alternative-cost primitive: `CardProfile.freeCastIfCommander`
(CR 601.2b, 118.9), the "may cast without paying its mana cost if you
control a commander" shape. `castableCard`/`applyCast` both gained a
trailing `freeCast` parameter/`GameAction.freeCast` flag; when set and
`controlsCommander(state, seat)` holds, the whole `planManaPayment`/
`applyManaPlan`/`payCost` path is bypassed with an `emptyPool()` payment
instead — the printed mana cost itself is untouched (still relevant to
anything that reads it), only the payment step is skipped. `legalActions`
offers the free cast as an *additional* option alongside the normal paid
cast (CR 601.2b: the caster still chooses which cost to pay), not a
replacement. Flawless Maneuver and Fierce Guardianship share the exact
phrasing and are now covered for free; Deflecting Swat and Obscuring Haze
still have other unimplemented text and correctly remain
`fullyImplemented: false`. This is deliberately the minimal-footprint
version of a general alternative-cost system — Daze (return a permanent
instead of paying) and Snuff Out (pay life instead) need their own
distinct shapes and were not attempted here. Validation: **594 rules
tests**, `npm run check`, `npm run simulate:engine` 200/200, 9,353 global
profiles.

Snuff Out | `324824cb-f938-401c-b9b5-d8908b431ef0` was closed with the
second alternative-cost shape: `CardProfile.payLifeInsteadOfManaCost:
{ life, controlLandType } | null` (CR 601.2b, 118.9). `castableCard`/
`applyCast` gained a `payLifeCost` parameter/flag alongside `freeCast`,
sharing the same bypass-the-mana-plan structure but substituting a fixed
life payment (`payment.lifePaid`) instead of an empty one; a new
`controlsLandType(state, seat, subtype)` helper checks the land
condition. `legalActions` offers it as an additional option next to the
normal paid cast, exactly like the free-cast primitive. Both alternative
costs now share one shape family in `castableCard`'s signature
(`freeCast`, `payLifeCost` — both default `false`, mutually exclusive by
construction since only one is ever passed `true`), so a third shape
(e.g. Daze's "return a permanent instead of paying") should extend this
same pattern rather than inventing a new one. Validation: **598 rules
tests**, `npm run check`, `npm run simulate:engine` 200/200, 9,361 global
profiles.

Daze | `70486bee-6ee7-41ea-b834-8caf4699302b` was closed with two pieces.
First, a new `counter-target-spell-unless-pay` effect (CR 601.2b, 603.3,
118.9): rather than building a new pendingChoice from scratch, it reuses
the existing `optional-trigger` type with `unlessPayCost` (plus `payCost`
for the affordability check `legalActions` already runs), setting `seat`
to the *targeted spell's* controller and `targets: [target]` so the
existing decline-path (`applyEffect` with `triggerEffect: { kind:
"counter-target-spell" }`) finds and counters the right stack entry.
Discovered along the way: `applyChooseTrigger` has an earlier, unrelated
`choice.paymentBy === "opponent"` branch keyed off `choice.manaCost`
specifically (a different pre-existing "unless that player pays" shape) —
setting `paymentBy` on the new pendingChoice routes into that branch by
mistake and throws, so Daze's construction deliberately omits it. This
single primitive flips roughly 35 cards sharing the exact "Counter target
spell unless its controller pays {N}." phrasing, including Mana Leak.
Second, a third alternative-cost shape,
`CardProfile.returnLandInsteadOfManaCost: { subtype } | null` (Daze's own
"return an Island... rather than pay its mana cost"): unlike the first
two shapes, this one needs the caster to *pick which* land, so
`legalActions` offers one cast option per eligible controlled land
(`returnPermanentId`) rather than a single flag, and `applyCast` moves
that permanent to its owner's hand (mirroring the existing `karoo-bounce`
executor's two-step move) instead of paying. Validation: **603 rules
tests**, `npm run check`, `npm run simulate:engine` 200/200, 9,396 global
profiles.

Mana Drain | `74d3277a-38e5-4732-afed-084a56148f20` was closed with a new
`delayed-mana-equal-to-target-spell-mana-value` effect (CR 603.7). Its two
sentences stay two independent effects (unlike Arcane Denial's combined
delayed-draw shape) since both can read the same shared `object.targets[0]`
at resolution — the first counters it, the second reads its mana value off
the (still-present, now-countered) stack entry. A new `DelayedManaAdd`
queue mirrors `DelayedDraw` exactly but is keyed by `seat` and resolved
during `precombat-main` (via a new `queueDelayedManaAdds`, mirroring
`queueDelayedDraws`) rather than by a computed turn number — sidestepping
the per-player turn-numbering arithmetic that turned out to be fragile
earlier this session (Teferi's Puzzle Box, Howling Mine): "next main
phase" just means "the next time this seat's own precombat-main begins,"
regardless of how many turns that takes. Both this and Draw Mine's family
push directly onto `triggerQueue`, resolving through the normal stack
rather than applying immediately. Validation: **603 rules tests**, `npm
run check`, `npm run simulate:engine` 200/200, 9,397 global profiles.

Krang, the All-Powerful | `466d5226-f4c7-4d69-9f56-4f893010127f` was
closed with a new `draw-caused-triggers` scope on the existing
`TriggerDoubler` primitive (CR 603.3f). Its own "second card each turn"
clause was already covered by the earlier `second-draw-this-turn` work;
only its static "if a player drawing a card causes a triggered ability of
a permanent you control to trigger, it triggers an additional time"
remained. Unlike the existing `subtype-you-control`/`equipped-creature`
scopes (which key on *which permanent* is watching), this one keys on
*which event* caused the trigger, so `triggerDoublerCount` gained an
`event` parameter and checks `event.kind === "card-drawn"` instead of the
watcher's own characteristics. A test fixture pitfall worth remembering:
a naive "whenever a player draws a card, you draw a card" watcher
self-triggers on the very draws it causes, producing a runaway feedback
loop that has nothing to do with the doubler itself — the scenario test
uses "whenever an **opponent** draws a card" instead, which only fires
off draws it doesn't itself cause. Validation: **604 rules tests**, `npm
run check`, `npm run simulate:engine` 200/200, 9,398 global profiles.

Baleful Mastery | `adfcdadd-ddda-477b-8e72-0cae2430fb63` was closed with a
fourth alternative-cost shape, `CardProfile.payReducedCostInstead:
ManaCost | null` (CR 601.2b, 118.9): unlike `freeCast`/`payLifeCost`,
which bypass payment entirely, this one *replaces* `cost` with the
reduced cost and runs the real `planManaPayment`/`payCost` path
unchanged, so board cost reductions and commander tax still apply on top
of it (CR 601.2f). Its second sentence, "if the {1}{B} cost was paid, an
opponent draws a card," needed the resolving effect to know *how* the
spell was cast — the first such case this session — so `StackObject`
gained an optional `castViaAlternativeCost` flag, threaded through a new
trailing `pushOnStack` parameter and read by the new
`opponent-draws-if-cast-via-alternative-cost` effect. "Exile target
creature or planeswalker" needed a new `creature-or-planeswalker`
`TargetKind` (the existing `artifact-creature-or-planeswalker` was too
broad). All four alternative-cost shapes (`freeCast`, `payLifeCost`,
`returnPermanentId`, `payReducedCost`) now share one parameter family on
`castableCard`'s signature. Validation: **605 rules tests**, `npm run
check`, `npm run simulate:engine` 200/200, 9,405 global profiles.

Long River's Pull | `f1993767-1d07-49c8-b8dc-04ec9840a999` was closed with
the Gift keyword (CR 702.166), a different shape from the four
alternative-cost primitives: promising the gift doesn't change the mana
cost at all, only widens the legal target set for the *same* printed
effect. `CardProfile.giftPromisedTargetKind` holds that wider `TargetKind`
(parsed from "if the gift was promised, instead [wider target]" — reusing
`recognizeSentence` just for its `target`, since the effect kind itself
never changes); `castableCard` substitutes it in place of
`profile.targetKind` when a new `giftPromised` flag is set, and because
`applyCast` already validates targets against whatever `castableCard`
returned rather than re-deriving them, no further target-side changes were
needed. `giftDrawsCard` makes the gifted opponent draw immediately during
`applyCast`, mirroring `additionalCostSacrificeLand`'s immediate-cast-time
side effect. `legalActions` offers the gift-promised cast as a same-cost
variant alongside the normal one, the same pattern used for kicker/evoke,
except a boolean rather than an extra cost. Caught mid-work: the initial
"if the gift was promised, instead ..." parser matched against whole
*lines*, but the clause sits mid-line as the second of two sentences
("Counter target creature spell. If the gift was promised, ...") — fixed
by splitting on `SENTENCE_SPLIT` first, matching how the rest of the file
already handles multi-sentence lines. Validation: **606 rules tests**,
`npm run check`, `npm run simulate:engine` 200/200, 9,406 global profiles.

Propaganda | `ea9709b6-4c37-4d5a-b04d-cd4c42e4f9dd` was closed with a new
`CardProfile.attackTaxPerCreature: number | null` (a generic-mana amount
per attacking creature, CR 508.1a) — the first change to shared combat
code this session. `applyDeclareAttackers` sums every taxing permanent the
targeted defender controls, multiplies by that defender's attacker count,
and pays it from the attacking player automatically (throwing, and
leaving the whole declaration undeclared, if unaffordable) right after the
existing attack-requirement checks and before attackers are tapped.
Caught while implementing: `legalActions`' attacker-offering loop only
ever proposes one creature attacking at a time, and did not check
affordability at all, so a bot could pick an offered "attack" action that
`applyDeclareAttackers` would then throw on — fixed by having that loop
skip offering an attacker against a defender whose tax it can't afford,
the same "don't offer what would throw" invariant `castableCard` already
upholds for spells. This bug had no test coverage until the scenario test
added here asserted `legalActions` excludes the unaffordable declaration,
not just that the direct `applyAction` call throws. Validation: **607
rules tests**, `npm run check`, `npm run simulate:engine` 200/200, 9,410
global profiles.

Orcish Bowmasters | `ea5103f5-27e0-4eb1-902c-7f34652d6bf3` was closed with
four new pieces. First, `PlayerState.drawsThisDrawStep` — a SEPARATE
counter from the earlier `drawsThisTurn` (Faerie Mastermind), reset only
at the start of the "draw" step rather than at untap, feeding a new
`GameEvent.drawStepCount` and a `not-first-draw-step-draw` trigger
condition. The suppression only applies when `state.step === "draw"` AND
`drawStepCount === 1` — a draw happening in any OTHER step always
triggers regardless of the counter's value, which matters because "except
the first ... in each of their draw steps" is scoped to draws that happen
*during* a draw step, not to the player's first draw of the turn overall
(those are different counts whenever an earlier effect, e.g. an upkeep
trigger, draws before the mandatory turn-based draw). Second, the Amass
mechanic (CR 701.44) as a new `amass` effect: grows an existing
Army-subtyped creature the controller controls via `+1/+1` counters, or
creates a 0/0 black `[tokenType]` Army token with them via
`putOntoBattlefield`'s existing `additionalCounters` parameter. Third, a
new "when ~ enters and whenever an opponent draws a card except the first
one ..., X" compound-trigger template, mirroring the existing
`entersOrAttacks` pattern: two `TriggerDefinition`s (one `enters-battlefield`,
one `card-drawn`/`opponent` with the new condition) sharing one recognized
effect. Fourth, a generic "`X`. Then amass `Type` `N`" sentence combinator
in `recognizeSentence` (recursing on the leading effect via
`recognizeSentence` itself, since it's always shorter) — reusable for any
future "does something, then amasses" card. Validation: **609 rules
tests**, `npm run check`, `npm run simulate:engine` 200/200, 9,411 global
profiles.

Mjölnir, Hammer of Thor | `7f9a8845-d760-44a7-a4c9-8a20dba4e14a` was closed
with three pieces. First, "When Mjölnir enters, it deals 4 damage to up to
one target creature" reuses the EXISTING multi-target `targetKinds`/
`minimumTargets` choice machinery (previously only used for mandatory
multi-target triggers like Inferno Titan's divided damage) with
`targetKinds: ["creature"], minimumTargets: 0` — "up to one target" is
just "0-or-more picks from a 1-element array," so this needed zero new
engine plumbing, only the parser special case. Second, a new
`CardProfile.equipWorthyCost: ManaCost | null` for "Equip worthy {1} (A
creature is worthy if it's a legendary non-Villain that's red and/or
white.)" — a NEW Marvel-set Equip restriction — plus `isWorthyCreature`/
`equipTargets` helpers in `engine.ts` that narrow both `legalActions`'
Equip offer and `applyEquip`'s target validation to worthy creatures only
when this cost is set (kept fully separate from the plain `equipCost` and
the subtype-restricted `typedEquipCost`, since a card only ever has one of
the three). Paired with `CardProfile.doublesEquippedCreatureDamage:
boolean` for "Double all damage equipped creature would deal" (CR 301.5c)
— a MULTIPLICATIVE modifier, architecturally distinct from the existing
ADDITIVE `damageAmplify` primitive (Torbran) — via a new
`equippedCreatureDamageMultiplier(state, sourcePermanentId)` helper wired
into all three central damage-dealing call sites: `dealDamageFromObject`,
`dealDamageToPermanent`, and `applyCombatDamage`'s to-players loop (so
both combat damage and noncombat damage from the equipped creature are
doubled). Third, "{2}{R}, Discard this card: It deals 2 damage to each
creature" needed a genuinely new activation-cost primitive:
`ActivatedAbility.discardsSelf?: boolean`, parsed from `discard\s+(?:~|this
card)` in the generic activated-ability cost grammar, which forces
`sourceZone: "hand"` (the ability can only ever be offered from hand,
since paying its own cost requires the source to still be there) and, in
`applyActivate`, moves the source card from hand to graveyard via the
existing `discardCard` helper right alongside the pre-existing
`sacrificesSelf` cost-payment block. Caught while writing this: the first
regex (`/discard\s+(?:~|this\s+card)\b/i`) silently failed to match "Discard
~" because `~` is a non-word character, so the trailing `\b` word-boundary
assertion (fine for "this card," a real word) never matched after `~` —
fixed by dropping the `\b`, matching the precedent already set by the
neighboring `sacrificesSelf` regex, which has no trailing boundary either.
Validation: **612 rules tests**, `npm run check`, `npm run simulate:engine`
200/200, 9,415 global profiles.

Wizard Class | `36f68aa3-9955-46f1-bc87-497f16ef5222` opened a brand new
subsystem: Class enchantments (CR 702.134), which none of the deck's
prior 88 cards had needed. A Class prints "{cost}: Level N" activation
lines, each unlocking a NEW ability while keeping every lower-level
ability active — a strictly sequential, cumulative unlock rather than a
single repeatable "Level up {cost}" (the Kamigawa mechanic already
supported via `levelUpCost`/`levelDefinitions`, which is architecturally
unrelated: one repeatable cost with P/T *bands*, not N one-time costs each
gaining a whole new ability). New pieces: `Permanent.classLevel` (absent
= level 1); `CardProfile.classLevels`, parsed from the "{cost}: Level N"
lines into synthetic per-level `ActivatedAbility`s carrying a new
`requiresClassLevel` field (`activatableAbility` requires the source be
*exactly* at that level minus one — Scryfall rulings confirm you can't
skip levels); a `class-level-up` `TriggerEvent` and matching `SpellEffect`
(the level-up ability's own resolution sets `classLevel` and raises the
event, mirroring the Kamigawa `"level-up"` case exactly except it sets a
dedicated field instead of incrementing a counter); and
`TriggerDefinition.minClassLevel`, a floor gate checked in `raiseEvent`'s
per-watcher loop alongside the existing `requiresKicked`/`requiresEvoked`
gates. The interesting design problem: `recognizeText` (the shared
body-parser used for spells, modal choices, AND activated-ability effect
text) takes only a `text: string` — it has no idea a card is a Class, so
it cannot itself decide that "whenever you draw a card, put a +1/+1
counter on target creature you control" (level 3's ability, printed with
no level number in its own wording) needs `minClassLevel: 3` gating. Two
lines DO carry their level in-text ("When this Class becomes level 2,
draw two cards.") and needed no such help — a new `class-level-reached`
trigger condition keyed on the event's own `level` field makes those
self-gating with zero positional awareness. For the rest, added
`classLevelByLine(text)`: a small second pass over the SAME raw text,
independent of `recognizeText`, that maps each printed line to the level
active at its position (1 before the first "{cost}: Level N" line, else
the most recent one) — then, back in `cardProfile`, `recognized.triggers`
is mapped through this table by matching each trigger's own `sourceText`
(a field every trigger constructor already stamps) and `minClassLevel` is
attached to whichever ones land above level 1. This keeps `recognizeText`
completely untouched and card-type-agnostic; only `cardProfile`'s
Class-specific post-pass knows about levels at all. Also added the
generic "Put a/an/N +1/+1 counter(s) on target creature you control"
effect pattern needed for the level-3 ability — a gap that existed
independently of Class cards and now flips other unrelated cards using
the exact same wording. Caught while writing the scenario test: this
trivial two-permanent board has nothing to do most steps, so the harness
auto-fast-forwards straight through "draw" without ever pausing there —
`passUntil(state => state.step === "draw" ...)` overshot 100+ turns
before incidentally matching, stacking dozens of +1/+1 counters onto the
same creature instead of the expected one. Fixed by waiting for the
seat's next OWN `precombat-main` instead (reliably observable turn over
turn, since sorcery-speed actions always keep a real priority window open
there), by which point exactly one draw for that turn has already
happened. Validation: **613 rules tests**, `npm run check`, `npm run
simulate:engine` 200/200, 9,433 global profiles.

Black Market Connections | `d2664f28-49e1-46f8-a863-b217e961a57c` closed
the deck's last genuinely new-subsystem card: "At the beginning of your
first main phase, choose one or more —" with three costed modes. Two
pieces. First, a `first-main-phase` `TriggerEvent`, raised in `beginStep`
right alongside the existing `step === "precombat-main"` hook that Mana
Drain's delayed-mana queue already uses — this project has no card
granting "an additional main phase," so modeling "first main phase" as
literally "precombat main begins" is exact for every card in scope, not
an approximation (documented as such in the `TriggerEvent` union comment
in case a future card breaks that assumption). Second, and the harder
piece: a triggered ability's own "choose one or more." CR 603.3d puts
this choice at the SAME timing as choosing a trigger's targets — when the
ability is put on the stack, not when cast (unlike a spell's modal
choice, which is a cast-time decision already fully built via
`CardProfile.modalChoices`). So rather than reuse the spell path, this
needed a parallel one: `TriggerDefinition.modalEffects` holds every legal
non-empty mode subset (computed with the exact same recursive
subset-enumeration `visit()` already used for a spell's "Choose N or
more," just targeting a different field), a new `"trigger-mode"`
`PendingChoice` opened by `putNextTriggerOnStack` before its normal
target-kind branching runs, and a `choose-trigger-mode` action resolved
by `applyChooseTriggerMode` — which builds the chosen subset's `TriggerInstance`
by spreading the ORIGINAL trigger with `definition.effect` swapped for
the selected subset, then hands it to the existing `triggerStackObject`
unmodified. That reuse meant zero new resolution code: the stack object
behaves exactly like any other trigger once its effect is decided. Also
added a `botAction` branch (pick the subset option with the longest
joined label, a cheap proxy for "the richest combination") — a
"trigger-mode" choice has no generic `"pass"` fallback the way most other
choice types eventually get, so an unhandled bot encountering this card
would have silently stalled instead of erroring. Caught mid-build: the
first attempt taught `recognizeSentence` itself a generic "X. You lose N
life." combinator so each mode's two sentences ("Create a Treasure
token. You lose 1 life.") would fold into one compound — but this is a
SHARED, global function, and the new pattern immediately also matched
Read the Bones' unrelated "Scry 2, then draw two cards. You lose 2
life.", reshaping its previously-correct flat two-element
`CardProfile.effects` array into one nested compound and failing that
card's existing test. Reverted the global change entirely and rebuilt it
as a small LOCAL step inside this card's own bullet-parsing loop (split
each mode's text on the same `SENTENCE_SPLIT` the rest of the file
already uses for multi-sentence lines, recognize each sentence, join into
a compound) — `recognizeSentence` itself is untouched. Validation: **616
rules tests**, `npm run check`, `npm run simulate:engine` 200/200, 9,434
global profiles.

Notion Thief | `f8dab16e-1d50-443e-9431-8b6f1cf61c9c` turned out to be
much more tractable than the earlier assessment in this document
suggested: "if an opponent would draw a card except the first one they
draw in each of their draw steps, instead that player skips that draw
and you draw a card" is a CR 614/616 REPLACEMENT effect, not a triggered
one, and it swaps WHO draws without ever revealing what either player's
hand or library contains — so despite its wording resembling a
hidden-information risk, it never actually crosses the boundary
CLAUDE.md mandates. New `CardProfile.redirectsOpponentDrawsExceptFirst:
boolean`, checked directly inside `drawCards`'s existing per-card loop
using the identical "except the first ... draw step" condition Orcish
Bowmasters' trigger already tracks via `PlayerState.drawsThisDrawStep`:
when it applies and an opponent controls this static, the affected
player's draw is skipped outright (their library never moves) and a
plain recursive `drawCards(next, redirectorController, 1)` draws for
Notion Thief's controller instead — no new zone-transfer primitive
needed, since "you draw a card" here just means an ordinary draw for a
different player. Caught while writing the scenario test for "the
opponent's own draw-step draw is NOT redirected": it failed even after
the redirect logic looked correct, exposing a genuine latent bug in
`beginStep` that had gone uncaught until now — the mandatory per-turn
draw (`case "draw": ... drawCards(...)`) ran BEFORE `drawsThisDrawStep`
was reset to 0 for that same step (the reset lived in a separate
`if (step === "draw")` block AFTER the switch), so every player's first
real draw step of the whole game — right after their 7-card opening
hand, itself dealt through `drawCards` and so incrementing the same
counter — read a stale nonzero value and was wrongly treated as "not the
first draw of the draw step." Fixed by moving the reset to immediately
before the mandatory draw call inside the switch case itself; this also
retroactively fixes an equivalent (until now untested) edge case for
Orcish Bowmasters' own suppression condition on a fresh player's first
turn. Validation: **618 rules tests**, `npm run check`, `npm run
simulate:engine` 200/200, 9,435 global profiles.

Gitaxian Probe | `1d67f5ff-1fce-45e5-b6a1-416c569351e2` DOES genuinely
cross the hidden-information boundary — unlike Notion Thief, "Look at
target player's hand" really does need one player to see another's
cards — but it turned out to fit an EXISTING pattern exactly:
`projection.ts` already has three precedents (library search, Scry,
top-of-library review) for "a `PendingChoice` scoped to one seat, whose
private card contents `projectGame` includes ONLY when
`viewerSeat === choice.seat`." A new `"view-hand"` `PendingChoice` plus a
`ViewedHandView` follows the identical shape: the target's hand is copied
into the projection only for the entitled viewer (the caster), and the
gate is exactly one equality check — `state.pendingChoice?.type ===
"view-hand" && state.pendingChoice.seat === viewerSeat` — so it is
structurally impossible for the target's own projection, or any other
seat's, to ever receive this field; the code that would need to leak it
simply never runs for them. A new `acknowledge-view-hand` action closes
the view, deferring the spell's move to its owner's graveyard/exile until
then (exactly like Scry holds its own source card in limbo until its
choice concludes) — resolveTop resolves "Draw a card" BEFORE opening the
view, mirroring Scry's "resolve every sibling effect first, then open the
private pause" ordering discipline exactly, including reusing the same
`profile.effects.find(...)` / "resolve everything else" shape. Also
needed a `botAction` heuristic to auto-acknowledge, since — like the
"trigger-mode" choice from Black Market Connections — this choice type
has no generic `"pass"` fallback and a bot would otherwise stall on it.
Validation: **619 rules tests**, `npm run check`, `npm run
simulate:engine` 200/200, 9,439 global profiles.

Reforge the Soul | `ece854f8-8c60-4f30-894f-2286d3dd61b9` closed the
Miracle keyword (CR 702.93), which turned out NOT to need the
`castableCard`/`applyCast` alternative-cost family built earlier this
session for free-cast/pay-life/return-land/pay-reduced-cost (Deadly
Rollick, Snuff Out, Daze, Baleful Mastery): those are all offered any
time the card sits in hand, evaluated fresh by `legalActions` on every
turn of the game. Miracle is fundamentally different — it is a single,
one-shot window that opens exactly once, for exactly one card, the
instant it is drawn as a player's first draw of the turn, and closes
forever the moment that draw resolves (or the choice is declined). New
`CardProfile.miracleCost`, parsed identically to `evokeCost`/`echoCost`.
The check lives directly inside `drawCards`'s existing per-card loop,
reusing `count` (`drawsThisTurn + 1`, already computed there and already
relied on by Krang, Faerie Mastermind's "second card each turn") — when
`count === 1` and the just-drawn card has a `miracleCost`, a new
`"miracle"` `PendingChoice` opens after the whole draw batch finishes
(tracked via a `miracleCandidate` local so a multi-card draw like
Reforge the Soul's own "draws seven cards" can't have more than one
candidate: only the very first card of the batch can ever have
`count === 1`). A dedicated `cast-miracle`/`decline-miracle` action pair
resolves it: casting pays the reduced cost and pushes the card onto the
stack through the existing `pushOnStack` with
`castViaAlternativeCost: true` (reusing the flag from the Baleful
Mastery work rather than adding a new one); declining leaves the card
sitting in hand exactly where it already was, for an ordinary cast at
its printed cost later. `applyCastMiracle` is deliberately its own small
function rather than a `castableCard` extension — Miracle's timing (an
interstitial reveal window between draw and priority, not a hand-cast
menu entry) doesn't fit that function's "is this card offerable from
hand right now" contract. Also added a `botAction` heuristic (pay
whenever affordable) since, like the "trigger-mode" and "view-hand"
choices added earlier this session, this new choice type has no generic
`"pass"` fallback. Caught while writing the "not the first draw of the
turn" scenario test: the decoy-card setup put the extra land-sacrifice
draw on the STARTING player (seat 0), whose very first draw step is
skipped entirely (CR 103.7a) — so the "first card this turn" slot was
still open when the test's OWN activated-ability draw fired, defeating
the test's own premise. Fixed by moving that test to the non-starting
seat, whose first turn actually has a real mandatory draw to consume the
decoy first. Validation: **622 rules tests**, `npm run check`, `npm run
simulate:engine` 200/200, 9,443 global profiles.

Naktamun Lorespinner // Wheel of Fortune | `c78783e5-868d-4a8b-a4f8-95a92853cf0a`
closed the deck's last card, and it turned out this earlier assessment
was simply wrong: "Prepared" (a brand-new mechanic, first seen in this
project) is NOT a transform/DFC card at all. The permanent's zone and
characteristics never change; "you may cast a copy of its spell" is a
genuine CR 707.14-style spell copy — one that ceases to exist once it
leaves the stack rather than occupying any zone — and this engine
already had full support for that shape via the `fromCopy` `StackObject`
flag, built earlier for `copy-triggered-spell` (Mirari-style effects).
So the real work was much smaller than the deferred assessment implied.
Confirmed first via the project's OWN exported
`data/rules/engine-card-profiles.json`: this card's `unimplementedText`
already read the FRONT face's real oracle line correctly (`~ becomes
prepared`) — proving the existing `frontFace(card)` helper (used for any
multi-faced card, e.g. transforming/split/adventure) already resolves
`card_faces[0]` correctly, so no catalog or ingestion fix was needed at
all; only a new parser pattern and a matching primitive were missing.
New pieces: a `become-prepared` `SpellEffect` and an
`any-player-hand-at-most` trigger condition recognize "At the beginning
of your upkeep, if a player has N or fewer cards in hand, ~ becomes
prepared." on the front face; a new `Permanent.prepared` boolean; a new
EXPORTED `backFace(card)` — the mirror of the existing private
`frontFace`, reading `card_faces[1]` instead of `[0]` — returning a
synthetic `CardData` keyed under `${scryfall_id}::back` specifically so
its recursive `cardProfile()` call gets its OWN cache entry rather than
colliding with the front face's (the cache key is the raw `scryfall_id`,
so reusing the same one would have returned the wrong profile back).
That back-face profile is computed once, lazily — only for a card whose
`gatedTriggers` actually contains a `become-prepared` effect, so
unrelated multi-faced cards (transform, split, adventure) never pay this
extra recursive-parse cost — and its cost/effect/targetKind/name are
lifted straight into a new `CardProfile.preparedCast`. Casting the copy
(`cast-prepared-copy` action, `applyCastPreparedCopy`) pays that cost,
flips `prepared` back off, and constructs a synthetic `GameCard` for the
copy via `backFace(source.card)` plus a fresh `instance_id`, pushed with
`pushOnStack`'s newly-parameterized trailing `fromCopy` argument (that
function previously had no way to mark a pushed spell as a copy at all —
only the hand-rolled `copy-triggered-spell` `StackObject` literal did).
Resolution needed ZERO new code past that: `resolveTop` and
`sendSpellToOwnerZone` already special-case `fromCopy` to skip every
zone-move step, exactly matching CR 707.14. Caught while writing the
scenario test: `twoSeatGame` already settles all the way to turn 1's own
precombat-main inside `createGame`, before the test has added ANY
permanent — so a permanent staged afterward, as every test in this file
does, has already missed that turn's upkeep by the time the test can
observe it. `passUntil(state => state.step === "precombat-main" &&
...)`, satisfied by the CURRENT untouched state, returned immediately
without ever advancing to a fresh upkeep. Fixed by waiting for the
seat's NEXT own precombat-main (`state.turn > turnBefore`, landing on
turn 3) instead, whose own upkeep runs fresh with the permanent already
present. Validation: **623 rules tests**, `npm run check`, `npm run
simulate:engine` 200/200, 9,444 global profiles.

**All 94 cards in the Nekusar, the Mindrazer decklist are now
implemented.** See `docs/WORK_CLAIMS.md` for the complete per-card
primitive history across every cluster this and prior sessions
delivered — nothing in this deck remains unimplemented or partially
implemented.

## Post-completion coverage sweep (2026-09-05)

With the decklist closed, work continued as a general engine-coverage
sweep: implementing additional primitives that complement what the
decklist already needed, scored against the whole catalog rather than
one deck. `data/rules/engine-card-profiles.json` (regenerated by `npm
run rules:engine:export` after every change) is the ground truth for
how many cards a given primitive actually flips — cited below wherever
a claim is a hard, re-checkable number rather than an estimate.

`entersPrepared` | The "Prepared" mechanic (Naktamun Lorespinner) turned
out to be a whole set mechanic, not a one-off — grepping
`unimplementedText` for "prepared" in the exported profiles turned up
~60 distinct cards. The single highest-value gap: "~ enters prepared."
(no trigger at all, just a static ETB state), true for 16 cards whose
ENTIRE remaining blocker was exactly that one line — real, well-known
back-face spells like Rampant Growth, Raise Dead, Seething Song already
parse fine on their own. New `CardProfile.entersPrepared: boolean`,
wired into `putOntoBattlefield` (sets `prepared: true` at creation) and
into the `preparedCast` back-face-profile gate (previously computed only
for cards with a `become-prepared` trigger). One primitive, zero new
engine concepts, verified **+16** in the export count (9,444 → 9,460).
Caught while testing: the test file's own `putOnBattlefield` helper
constructs a `Permanent` literal directly and never calls the real
`putOntoBattlefield`, so the test had to actually cast the creature
(hand + mana + `type: "cast"`) to exercise the new code at all; the
resulting "cast a copy of Rampant Growth" then opened a genuine
`search-library` `PendingChoice` that a plain `passUntil(state =>
state.stack.length === 0)` sails past (the stack is already empty while
a choice is pending) — same class of timing mistake as the Wizard Class
draw-step catch earlier, fixed the same way, with an explicit
`choose-library-card` action. Validation: **627 rules tests**, `npm run
check`, `npm run simulate:engine` 200/200, 9,460 global profiles.

`rules-prepared-trigger-templates` | Four more Prepared trigger shapes,
all pure reuse of existing machinery: `attacks`/self (Encouraging
Aviator — the mechanic's first test of this event, everything before
only exercised `upkeep`/`first-main-phase`), unconditional `upkeep`/you
(the printed "if ~ isn't prepared" guard is a no-op — setting an
already-true flag true again does nothing, so no new condition kind was
needed), unconditional `first-main-phase`/you (Scathing Shadelock,
reusing the Black Market Connections event), and `spell-cast`/you with
`spellType: "creature"` (Abigale, Poet Laureate, reusing the existing
spell-type filter). Verified **+41** in the export count (9,460 →
9,501) — well beyond the four cards targeted directly, since several
`Emeritus of *` cards pair these same templates with already-supported
iconic reprints (Lightning Bolt, Ancestral Recall, Demonic Tutor,
Regrowth, Sign in Blood) that needed no back-face work at all.
Validation: **640 rules tests**, `npm run check`, `npm run
simulate:engine` 200/200, 9,501 global profiles.

`rules-prepared-landfall-combat-damage` | Two more Prepared shapes, both
zero-new-code reuse: Landfall — Whenever a land you control enters
(Tam, Observant Sequencer; reuses the `land-you-control` subject) and
Whenever one or more creatures you control deal combat damage to a
player (Striding Shotcaller; reuses `creature-you-control` against
`deals-combat-damage-to-player`). Caught by a debug script, not a test:
Tam's front face literally starts with "Landfall — Whenever...", so the
first version of the pattern (anchored on "Whenever...") silently never
matched — fixed by stripping the `landfall\s+[—–-]\s*` ability-word
prefix first, the same stripping `matchTriggerLine` already does
elsewhere. Scenario-tested that Shotcaller becomes prepared from a
DIFFERENT creature's combat damage (not its own), confirming the
subject is genuinely "any creature you control." Validation: **645
rules tests**, `npm run check`, `npm run simulate:engine` 200/200,
9,508 global profiles.

`rules-static-extra-land-drops` | New `CardProfile.extraLandDropsPerTurn:
number` recognizes the printed template "You may play {a|an|one|two|
three} additional land(s) on each of your turns" (CR 305.2). A new
`maxLandDrops(state, seat)` engine helper sums the printed land drop,
`player.extraLandDrops` (existing turn-limited grants), and every
battlefield permanent's static `extraLandDropsPerTurn`, replacing the
old inline `1 + player.extraLandDrops` expression at both consumption
sites (`legalActions`'s land-play offering and `applyPlayLand`'s
authoritative check) so the two can never drift apart. Verified **+6**
in the export count (9,508 → 9,514), including two format staples —
Exploration and Azusa, Lost but Seeking — plus Urban Evolution,
Titania, The Explorer, Summer Bloom, Aesi Tyrant of Gyre Strait, and
Journey of Discovery. Scenario-tested end to end: with Exploration in
play a controller plays a 2nd land off one land drop and is correctly
blocked from a 3rd; with Azusa's own +2 stacked on the printed drop a
controller plays 3 lands in one turn and is blocked from a 4th.
Validation: **649 rules tests**, `npm run check`, `npm run
simulate:engine` 200/200, 9,514 global profiles.

`rules-aura-targeting-attachment` | The biggest gap found this sweep:
Auras had **zero** targeting or attachment support — the "Enchant
creature" line, the single most common unimplemented line in the whole
catalog (880 unique-oracle Auras), was simply falling through to
`unimplementedText` with nothing downstream to consume it even if it
had matched. Mining unique oracle texts by their "Enchant X" phrasing
showed creature (880), land (84), creature you control (57), player
(43), and permanent (24) covering 89% of all 1,228 distinct Auras.
Implemented the four permanent-shaped ones (not player — Curses need a
player-attachment concept the engine doesn't have yet, left for a
future pass): the "Enchant X" line now sets `CardProfile.targetKind`
directly, so it rides every existing targeting mechanism for free —
`castableCard`'s legality check, `legalTargets`, and the CR 608.2b
fizzle-on-illegal-target check at spell resolution. The permanent
attaches (`attachedTo`) to its chosen target on resolution (CR
303.4h). New `CardProfile.auraModification` (the existing
`EquipmentModification` shape, reused as-is) recognizes "Enchanted
creature gets ±N/±N[ and has KEYWORDS]" and "Enchanted creature has
KEYWORDS", wired into `powerOf`/`toughnessOf`/`keywordOf` through new
`attachedAuras`/`auraBonus` helpers that mirror the pre-existing
Equipment ones exactly. Added the CR 704.5n state-based action: an
Aura not attached to a legal object falls to its owner's graveyard,
via a new `auraAttachmentLegal` predicate (creature / creature-you-
control / land / permanent only, deliberately excluding hexproof and
protection-based fall-off — CR 702.16e — as a known boundary).
Real bug caught while wiring that SBA: the pre-existing CR 704.5q
Equipment-unattach loop iterated *every* permanent with `attachedTo`
set and never checked it was actually an Equipment — harmless while
only Equipment ever populated that field, but it would have ripped
every land- or permanent-enchanting Aura right back off on the very
next state-based-action pass, since `isCreature(land)` is false. Fixed
by gating that loop to `hasSubtype(profile, "Equipment")` as part of
this same change. Verified **+213** in the export count (9,514 →
9,727) and set coverage 28.5% → 29.2% — by far the largest single
jump this sweep, confirming Auras were the highest-value remaining
gap. Scenario-tested end to end: Hardened-Scale Armor attaches to a
Bear and its +3/+3 is visible through `powerOf`/`toughnessOf`;
Debilitating Injury's -2/-2 kills the enchanted Bear through ordinary
lethal-toughness state-based actions, and the Aura itself falls to the
graveyard in the same state-based pass (704.5n); Wild Growth (Enchant
land) attaches to a Forest, proving the attach path isn't creature-
only. Validation: **654 rules tests**, `npm run check`, `npm run
simulate:engine` 200/200, 9,727 global profiles.

`rules-untapped-enters-with-counters` | Found while triaging Commander
2014 by request for cards one line from complete.
`parseEntersWithCounters` (the "~ enters with N counters on it"
parser) already existed and was already wired into
`putOntoBattlefield` — but the only skip-list line consuming it out of
`unimplementedText` required the word "tapped" between "enters" and
"with", so the untapped form (Pentavus, Spike Feeder, Kalonian Hydra,
Swarm of Bloodflies, Wickerbough Elder, ...) sat permanently
unimplemented even though the value was already computed and applied
correctly. Added the missing untapped skip line, anchored at "on it"
so a trailing dynamic clause (Avatar of the Resolute: "...for each
other creature you control with a +1/+1 counter on it") stays
unconsumed rather than getting silently mis-parsed as a fixed amount.
Also added a sibling template, new `CardProfile.entersWithVariableCounters:
{kind} | null`, for the literal-"X" phrasing ("~ enters with X +1/+1
counters on it" — Walking Ballista, Hangarback Walker, Shivan
Devastator, Mistcutter Hydra), wired at cast resolution to read the
spell's own paid `{X}` (`object.variableValue`) into the same
`additionalCounters` plumbing Auras and kicker already share. Verified
**+41** in the export count (9,730 → 9,771); 46 cards had this as
their sole remaining blocker going in, a few of which pulled in other
still-open lines by the time this pass's count was taken. Scenario-
tested: Pentavus enters with exactly 5 counters with no "tapped" in
its text at all; Walking Ballista cast for X=2 enters with 2 counters
and correctly reads 2/2 through `powerOf`/`toughnessOf`; cast for X=0
it enters 0/0 with no counters and is confirmed — not assumed — to die
immediately to ordinary lethal-toughness state-based actions.
Validation: **661 rules tests**, `npm run check`, `npm run
simulate:engine` 200/200, 9,771 global profiles.

`rules-tribal-lord-subtype-grants` | Another C14 one-liner, found the
same way: `StaticPowerToughnessGrant` already declared an optional
`subtype` field on its interface, but `staticPowerToughnessBonus`
never read it anywhere — dead scaffolding left over from an earlier
pass. "Other Elves you control get +1/+1." (Imperious Perfect, and 66
other tribal lords catalog-wide: Goblins, Cats, Spirits, Soldiers,
Clerics, ...) had no recognizer at all and fell straight into
`unimplementedText`. Added the recognizer — reusing the pre-existing
`singularSubtype` helper ("Elves" → "Elf", "Dwarves" → "Dwarf") so no
new pluralization logic was needed — producing a new
`other-subtype-creatures-you-control` scope, then wired `grant.subtype`
into the existing "you control" filter branch of
`staticPowerToughnessBonus` right alongside the color filter that was
already there for the "other [color] creatures you control" case.
In the same pass, also closed the sibling gap noted below: Bad Moon
("Black creatures get +1/+1.") and Celestial Crusader ("Other white
creatures get +1/+1.") are a color anthem with no "you control" at
all — every player's creatures of that color, not just yours. Added
`all-creatures`/`other-all-creatures` scopes and gave the
`powerOf`/`toughnessOf` global-bonus path a color filter it never had
(previously any "all-creatures" grant applied to every creature
unconditionally — harmless only because no colored "all-creatures"
grant had existed yet to expose it). Writing that filter surfaced a
real, previously-uncaught bug in the pre-existing "Other [color]
creatures you control get +N/+N" branch of the same parser function:
it stored the color as `match[2].toUpperCase()` (e.g. "WHITE") instead
of the single-letter form `cardProfile(...).colors` actually holds
("W") — using plain `.toUpperCase()` on the color word instead of the
`DAMAGE_AMPLIFY_COLOR_LETTER` map the file already uses elsewhere for
this exact conversion. That branch's color filter could never have
matched anything, for any card, ever, and nothing caught it because no
existing test exercised a colored "you control" tribal-style grant.
Fixed both the new and the pre-existing branch to go through
`DAMAGE_AMPLIFY_COLOR_LETTER`. Verified **+34** combined in the export
count (9,792 → 9,826) and set coverage 29.4% → 29.5%. Scenario-tested:
Imperious Perfect turns a same-seat 1/1 Elf into a 2/2, leaves itself
unboosted (the printed "Other"), leaves a same-seat non-Elf Bear
unboosted, and leaves an opponent's Elf unboosted (the printed "you
control"); Bad Moon boosts a black creature under either seat while
leaving a green one alone; Celestial Crusader boosts a white creature
under either seat but never itself. Validation: **668 rules tests**,
`npm run check`, `npm run simulate:engine` 200/200, 9,826 global
profiles.

`rules-tribal-lord-explicit-creatures-phrasing` | A sibling tribal-lord
phrasing turned up right after the one above landed: "Other Goblin
creatures you control get +1/+1." (Mad Auntie, Diregraf Captain,
Merrow Reejerey, Dwynen, Gilt-Leaf Daen, ...) spells out the literal
word "creatures" between the subtype and "you control" — a different
shape from "Other Elves you control get +1/+1." that the earlier
branch didn't cover, so these still fell into `unimplementedText`.
Added a second regex branch producing the same
`other-subtype-creatures-you-control` scope; the qualifier here is
already singular in the printed Oracle text ("Goblin", not "Goblins"),
so no `singularSubtype` call is needed for this phrasing. A few of
these use a card TYPE rather than a creature subtype — Master of
Etherium and Chief of the Foundry both read "Other artifact creatures
you control get +1/+1." — so the engine-side check in
`staticPowerToughnessBonus` now tests `hasSubtype(...) OR
profile.types.includes(...)` against the same stored string, rather
than adding a second field to distinguish the two cases. Verified
**+13** in the export count (9,876 → 9,889). Scenario-tested with two
synthetic fixtures: a Goblin lord boosts another Goblin but leaves
itself and a Bear alone; an artifact-creature lord boosts another
artifact creature through the card-type path (not the subtype path)
but leaves itself and a Bear alone. Validation: **675 rules tests**,
`npm run check`, `npm run simulate:engine` 200/200, 9,889 global
profiles.

## cEDH staples pass (2026-09-05)

Pivoted from broad set coverage to naming specific competitive-EDH
staples by request, working the gaps one card at a time rather than
mining by pattern frequency. Three independent one-card primitives:

**Mana Vault** — "At the beginning of your draw step, if ~ is tapped,
it deals 1 damage to you." The "if ~ is untapped" trigger condition
already existed (Howling Mine); this just adds its exact mirror, a new
`TriggerCondition` kind `source-tapped`, checked at both the
event-time gate and the resolution-time intervening-if re-check
(mirroring `source-untapped` at both sites so a tap/untap between
trigger and resolution is handled the same way). +1 in the export
count (9,907 → 9,908).

**Silence** — "Your opponents can't cast spells this turn." A whole
new restriction category: a new `SpellEffect` kind
`opponents-cant-cast-spells-this-turn` sets a new
`PlayerState.cantCastSpellsUntilEndOfTurn` flag on every opponent,
cleared every cleanup step alongside the other per-turn permanent
flags. The flag is enforced in exactly one place, `castableCard`,
which both `legalActions`'s offering path and `applyAction`'s cast
handler already call for authoritative validation — so both paths
respect the lock for free from a single check. +1 in the export count
(9,908 → 9,909).

**Flusterstorm** (and Miscalculation, Daze) — "Counter target instant
or sorcery spell unless its controller pays {1}." The pre-existing
`counter-target-spell-unless-pay` template only recognized the generic
"Counter target spell..." wording; these are meaningfully different
(a creature spell is a legal target of the generic template but must
NOT be a legal target here). Added a new TargetKind
`instant-or-sorcery-spell` with `legalTargets` support (filters the
stack to Instant/Sorcery card types) and widened the parser regex to
accept either noun phrase, mapping to the matching TargetKind. +6 in
the export count (9,909 → 9,915).

Set coverage moved 29.5% → 29.9% across the batch. Scenario-tested:
Mana Vault deals exactly 1 damage on its controller's draw step while
tapped and none while untapped (both branches exercised); Silence
blocks the opponent's instant-speed cast for the rest of that turn
only — confirmed cleared by their own next turn, not just assumed —
while leaving the caster itself free to act; Flusterstorm's
`legalTargets` accepts an on-stack Lightning Bolt but correctly
rejects an on-stack Grizzly Bears (cast on its controller's own turn,
since creatures are sorcery-speed), then the ordinary counter-unless-
pay decline flow resolves normally against the Bolt. Validation: **684
rules tests**, `npm run check`, `npm run simulate:engine` 200/200,
9,915 global profiles.

**City of Traitors** — switched from mining the export by pattern
frequency to cross-referencing `data/decks/cedh-pod.json`, a real
4-deck / 400-card imported cEDH pool the "tested pod" Home mode
already draws from (see `docs/TESTED_POD.md`), against the export to
find specific named staples still missing. "When you play another
land, sacrifice this land." needed a whole new trigger EVENT, not just
a condition or effect: nothing in the engine raised an event for the
ACTION of playing a land, as distinct from that land's own "enters the
battlefield." Added `TriggerEvent` kind `play-land`, raised once in
`applyPlayLand` right after `putOntoBattlefield` (alongside, not
instead of, the land's own ETB event), plus the matching
`TRIGGER_TEMPLATES` entry, a Spanish log label, and a client
`abilities.ts` glyph entry — both are `Record<TriggerEvent, ...>`
maps, so the build failed loudly until every one was updated, which is
exactly the safety net that kind of exhaustive map is for. Also added
a bare `Sacrifice ~` sentence recognizer; only the compound "Sacrifice
~. If you do, ..." form existed before. Verified **+3** in the export
count (9,919 → 9,922 — City of Traitors has three printings in the
catalog, each counted separately) with set coverage holding at 29.9%.
Scenario-tested: with City of Traitors already on the battlefield,
playing a Forest from hand fires the trigger, which resolves and sends
City of Traitors to its owner's graveyard while the Forest stays in
play. Validation: **689 rules tests**, `npm run check`, `npm run
simulate:engine` 200/200, 9,922 global profiles.

**Diabolic Intent / Culling the Weak** — both `cedh-pod.json` staples
share "As an additional cost to cast ~, sacrifice a creature." The
mana-cost sibling `additionalCostSacrificeLand` already existed
(Harrow); this is the exact same shape with `isCreature` swapped in
for `isLand`. New `CardProfile.additionalCostSacrificeCreature`, wired
into `applyCast` the same way the land case is (auto-picks the first
qualifying creature — the same simplification the land case already
made, not a new corner cut introduced here). One thing added that the
land case was missing: a `castableCard` legality gate, so a player
with no creature to sacrifice never sees the spell offered as castable
at all, instead of only discovering it's illegal via a thrown error at
execution time. Verified **+21** in the export count (9,927 → 9,948)
— by far the largest single jump of this cEDH pass — and set coverage
29.9% → 30.0%. Scenario-tested: casting Diabolic Intent with a Bear on
the battlefield sacrifices the Bear and opens the ordinary
`search-library` tutor choice, landing the chosen card in hand; with
zero creatures on the battlefield the cast is absent from
`legalActions` entirely and throws if forced anyway. Validation: **691
rules tests**, `npm run check`, `npm run simulate:engine` 200/200,
9,948 global profiles.

## Second target deck: Prossh, Skyraider of Kher (2026-09-05)

By request, switched the standing-goal target deck from the C14/cEDH-
pod sweep to a user-supplied Prossh, Skyraider of Kher decklist (97
unique cards, tappedout.net — the site's own bot-check blocked
automated fetching, so the user pasted the list directly). Cross-
referencing it against the export the same way as the cEDH pod
surfaced two more one-line gaps:

**Persist's missing skip line** — the bare "Persist" reminder line
(and its "Undying" sibling) was never consumed by `recognizeText`,
even though both keywords already synthesize a real `undying-return`
trigger from `card.keywords` at the top level of `cardProfile()`. Same
class of gap as the untapped enters-with-counters fix earlier this
session: the VALUE was already computed correctly, only the line
consumption was missing. Added both skip lines, mirroring the existing
`rebound`/`extort` pattern immediately above them.

**Zulaport Cutthroat's each-opponent drain** — "Whenever ~ or another
creature you control dies, each opponent loses 1 life and you gain 1
life." looks like Blood Artist's "...target player loses 1 life and
you gain 1 life." but is a genuinely different template: every
opponent drains at once, not one chosen target. The underlying
`each-opponent-loses-life` effect already existed with a bare-sentence
recognizer ("Each opponent loses N life"); this only needed the
compound "...and you gain N life" tail, mirroring the pre-existing
"Draw N cards and each opponent loses N life" compound already in the
file.

Verified **+50** combined in the export count (9,948 → 9,998) — the
Zulaport template alone matched 126 distinct catalog-wide oracle
texts, the single largest regex win of the entire session. Set
coverage 30.0% → 30.2%. Scenario-tested: a synthetic Persist creature
comes back once with a -1/-1 counter after dying, then stays dead on a
second death (the "if it had no counter" guard correctly suppresses
the second trigger before it's even queued); Zulaport Cutthroat drains
1 from every opponent and gains its controller 1 life when a different
creature that controller owns dies. Validation: **695 rules tests**,
`npm run check`, `npm run simulate:engine` 200/200, 9,998 global
profiles.

Prossh decklist status after this pass: **54 of 97 unique cards fully
implemented (55.7%)**. Remaining, roughly ranked by apparent size:
Skullclamp (equipped-creature-dies trigger subject — worth doing next,
high catalog-wide reuse), Natural Order (green-creature-restricted
sibling of the sacrifice-a-creature cost added this session), Urborg
Tomb of Yawgmoth (global land-type grant), Chromatic Lantern / Joraga
Treespeaker (granting a mana ability to other permanents), Purphoros /
Xenagos God of Revels (devotion-gated "isn't a creature", a Theros god
family), then the larger multi-line cards (Necropotence, Birthing Pod,
Food Chain, Craterhoof Behemoth, Protean Hulk, Chord of Calling, Green
Sun's Zenith, Tooth and Nail, Yawgmoth's Will, planeswalker loyalty
abilities for Garruk Wildspeaker and Xenagos the Reveler).

**Skullclamp** — checked next, and it turned out the engine was already
most of the way there: the `equipped-creature` `TriggerSubject` was
already fully wired end-to-end in `matchesSubject` ("the watcher is
the Equipment; the event object must be the creature it is attached
to"), with a comment explicitly naming Skullclamp and Argentum Armor
as the intended cards — but no `TRIGGER_TEMPLATES` entry had ever been
added to actually produce a trigger with that subject, so the
machinery sat completely unused. Added two entries — "Whenever
equipped creature dies, ..." and "Whenever equipped creature
attacks, ..." — both pure data-table additions with zero new engine
code. The export crossed the 10,000 fully-implemented milestone in
this same cycle (9,998 → 10,050), though that delta also folds in
upstream contributions merged in alongside this change; Skullclamp and
Argentum Armor are both individually confirmed `fullyImplemented:
true`. Set coverage 30.2% → 30.3%. Scenario-tested: equipping
Skullclamp onto a Grizzly Bears (2/2 → 3/1 from the clamp's own
+1/-1) leaves it alive on its own; a burn spell then finishes off the
now-1-toughness Bear and the death trigger draws its controller two
cards (net +1 hand size once the burn spell itself leaving hand to be
cast is accounted for). Validation: **698 rules tests**, `npm run
check`, `npm run simulate:engine` 200/200.

**Natural Order** — a two-line color-restricted sibling of the
sacrifice-a-creature primitives from earlier this session: "sacrifice
a green creature" as the additional cost, "search your library for a
green creature card" as the effect. New
`CardProfile.additionalCostSacrificeCreatureColor: string | null`,
wired exactly like `additionalCostSacrificeCreature` (a `castableCard`
gate plus the `applyCast` sacrifice, both filtered by color). The
tutor half surfaced a real, previously-unnoticed correctness gap: the
shared `searchCriterion` parser — used by every "Search your library
for a [criterion] card" template in the file — had no concept of color
at all. A leading color adjective like "green" fell all the way
through the type/subtype detection and was silently dropped, meaning
any color-restricted library search built on this shared helper would
have quietly become unrestricted the moment it needed one. Added color
detection to `searchCriterion` (stripped out before type/subtype
parsing runs, since "green" is not a valid subtype), a new optional
`colors` field on the `search-library` effect, and a matching filter
in the engine's own search-resolution code. Verified **+1** in the
export count (10,050 → 10,051; Natural Order specifically — an
isolated single-card primitive, unlike the broader pattern fixes
earlier in the session). Scenario-tested: with only a red creature
available, Natural Order isn't offered as castable and throws if
forced anyway; with a green creature on the battlefield, casting it
sacrifices the green creature specifically (an unrelated red creature
is left alone), and the resulting tutor choice accepts a green
creature from the library but throws on a red one — confirmed as a
rejection, not just an absent option. Validation: **702 rules tests**,
`npm run check`, `npm run simulate:engine` 200/200, 10,051 global
profiles.

**Beast Within / Generous Gift** — "Destroy target permanent. Its
controller creates a 3/3 green Beast/Elephant creature token." turned
out to have an exact sibling already implemented:
`destroy-target-creature-then-controller-token`, built earlier for
"Destroy target CREATURE..." cards (An Offer You Can't Refuse style).
Its engine handler is target-agnostic — it destroys whatever
`object.targets[0]` resolves to and hands the token to THAT
permanent's controller, regardless of what kind of permanent it was —
so this needed zero new `engine.ts` code, only a sibling parser branch
in `recognizeText`'s closed-template section matching "Destroy target
permanent..." instead of "...creature...", reusing the identical
effect kind with `targetKind: "permanent"` in place of `"creature"`.
Verified **+2** in the export count (10,051 → 10,053) and set coverage
30.3% → 30.4%. Scenario-tested: casting Beast Within on an opponent's
Grizzly Bears destroys it and creates the 3/3 Beast token under the
OPPONENT's control, not the caster's — the entire point of the card,
and the detail a naive "give myself a token" implementation would get
backwards. Validation: **704 rules tests**, `npm run check`, `npm run
simulate:engine` 200/200, 10,053 global profiles.

**Green Sun's Zenith / Wargate** — "Search your library for a [green]
creature/permanent card with mana value X or less, put it onto the
battlefield, then shuffle." needed a genuinely new `search-library`
restriction: the shared `single` regex requires a literal comma
immediately after the word "card", but this text reads "...card with
mana value X or less," — the comma lands after the whole clause, not
right after "card" — so none of the existing branches matched at all.
Added a dedicated regex branch, a new optional `maxManaValue?: "X"`
field on the `search-library` effect, and a matching filter in the
engine's resolution code reading the spell's own paid `{X}` straight
off the stack object (`object.variableValue`) — the same value the
untapped-`X`-counters and other X-reading primitives earlier this
session already rely on. Verified **+2** in the export count (10,053 →
10,055): Green Sun's Zenith and Wargate (a colorless, any-permanent
sibling of the same template). Chord of Calling shares this exact
search line but still needs Convoke — a wholly separate, unimplemented
alternate-cost mechanic (paying part of a spell's cost by tapping
creatures) — noted as a real boundary rather than pulled into scope
here. Scenario-tested: casting Green Sun's Zenith for X=2 opens a
tutor choice that rejects a green creature with mana value 6 (over
budget, confirmed via a thrown error) but accepts one with mana value
1, landing it on the battlefield. Validation: **711 rules tests**,
`npm run check`, `npm run simulate:engine` 200/200, 10,055 global
profiles.

**Static mana-ability grants** — the biggest whole-mechanic gap found
in this deck's sweep. "X [you control] have '{T}: Add ...'"
(Chromatic Lantern, Joraga Treespeaker, Cryptolith Rite, Manaweft
Sliver — 44 catalog-wide) had no support at all: every consumption
site read `manaAbilities` straight off the permanent's own
`CardProfile`, with no notion of a mana ability granted by a DIFFERENT
permanent's static ability. Added `CardProfile.staticManaAbilityGrants`
(`scope: "you-control" | "all"`, optional `excludesSelf` / `type` /
`subtype` / `minLevel`, reusing the existing `ManaAbility` shape
outright and the existing `parseManaAbilities` line-parser on the
quoted inner ability text — no new mana-ability grammar needed at
all) and a new `grantedManaAbilities` / `manaAbilitiesFor` pair in the
engine that re-indexes granted abilities *after* a permanent's own
printed ones so the two can never collide. Wired into all three real
consumption sites: `manaSources` (automatic payment planning),
`legalActions`'s offering loop, and `applyActivateMana`'s authoritative
lookup — previously each read `profile.manaAbilities` or
`cardProfile(...).manaAbilities` directly, and all three had to move in
lockstep or the "offered" and "executed" ability sets would silently
diverge.

Joraga Treespeaker's own grant only applies at LEVEL 5+, not from
level 0 — a real correctness trap the naive version of this feature
would have missed entirely (the grant line sits inside a Level Up
creature's text with no engine-level concept of "current level" for a
static ability). The parser now tracks the nearest preceding
"LEVEL N[+/-M]" marker the same way `parseLevelDefinitions` already
does for power/toughness/keyword changes, attaching a `minLevel` the
engine checks against `permanent.counters.level` before ever
considering the grant active. Verified **+11** combined in the export
count (10,055 → 10,066, across two passes — the second pass closed
the bare-subtype phrasing gap Joraga Treespeaker itself uses, "Elves
you control have..." with no "creatures" noun, which the first pass's
regex required) and set coverage 30.4% → 30.5%. Scenario-tested:
Chromatic Lantern lets its controller tap a plain Forest for blue
mana, not just green; a Test Elf gains no mana ability at all while
Joraga Treespeaker sits below level 5, then gains "{T}: Add {G}{G}."
the instant a level counter pushes Joraga to level 5 — both branches
confirmed, not just the happy path. Validation: **714 rules tests**,
`npm run check`, `npm run simulate:engine` 200/200, 10,066 global
profiles.

**Craterhoof Behemoth / Pathbreaker Ibex** — Overwhelming Stampede's
effect ("creatures you control gain trample and get +X/+X until end
of turn, where X is the greatest power among creatures you control")
already existed as a dedicated `overwhelming-stampede` kind, but the
regex only matched with "Until end of turn," as a LEADING clause.
Pathbreaker Ibex's attack trigger carries the identical effect with
"until end of turn" TRAILING instead of leading, so the existing regex
missed it completely; added a sibling regex reusing the exact same
effect kind and handler, zero new engine code. Craterhoof Behemoth is
the same template with a different X formula — creature count, not
greatest power — so it got a new `creature-count-stampede` kind
sharing the SAME handler body (merged into one `case` label,
branching only on which `effect.kind` actually matched). Verified
**+2** in the export count (10,066 → 10,068); set coverage holds at
30.5%. Scenario-tested: casting Craterhoof Behemoth with two Grizzly
Bears already in play pumps all three creatures (Craterhoof counts
itself as a controlled creature at the moment its own ETB resolves)
by +3/+3 with trample; attacking with Pathbreaker Ibex (3 power)
alongside a Grizzly Bears (2 power) pumps both creatures by +3/+3 with
trample, correctly using Ibex's own power as the greatest among them.
Validation: **721 rules tests**, `npm run check`, `npm run
simulate:engine` 200/200, 10,068 global profiles.

Prossh decklist status after this pass: **62 of 97 unique cards fully
implemented (63.9%)**.

Oracle of Mul Daya's three static lines are each real primitives, not a
one-off card hack. Added `CardProfile.playLandsFromTopOfLibrary` and
`CardProfile.revealsTopOfLibrary` (`extraLandDropsPerTurn` for the third
line was already covered by Exploration/Azusa). `legalActions` now also
offers a `play-land` action for the top card of the controller's library
when a permanent grants that permission, and `applyPlayLand` accepts a
`cardId` from either the hand or that exact top card, shifting the library
instead of filtering the hand. "Play with the top card of your library
revealed" is genuine public information (CR 108.4), not merely visible to
its controller, so `projectGame` now exposes a `revealedTopLibraryCard` on
`PlayerView` for EVERY viewer (including opponents) whenever that player
controls a revealing permanent — the one deliberate, narrowly-scoped
exception to the "opponent's library is structurally absent" boundary
documented at the top of `projection.ts`, gated on an explicit static
ability rather than a general leak. Verified **+4** in the export count
(10,068 → 10,072, Oracle of Mul Daya's four printings); set coverage holds
at 30.5%. Scenario-tested: the top-of-library land drop is offered and
correctly removes the played land from the library (not the hand); it is
NOT offered for a player without the static; the top card is visible in
both the controller's own projection and the opponent's; a player without
the reveal static keeps `revealedTopLibraryCard` undefined for opponents.
Validation: **728 rules tests**, `npm run check`, `npm run simulate:engine`
200/200, 10,072 global profiles.

Prossh decklist status after this pass: **63 of 97 unique cards fully
implemented (64.9%)**.

Ogre Battledriver ("Whenever another creature you control enters, that
creature gets +2/+0 and gains haste until end of turn.") needed a new
`modify-event-creature-and-grant-keyword` effect kind — the closest
existing template, `modify-triggered-creature-and-grant-keyword`, targets
`object.trigger?.sourcePermanentId` (the "~" that has the ability itself),
while this card's "that creature" refers to the OTHER creature named by
the triggering event (`eventPermanentId`), the same distinction already
drawn between `modify-triggered-creature` and the self-only pump kinds.
Parsing this card surfaced a real, previously-unnoticed matching bug: the
shared `TRIGGER_TEMPLATES` entry for "Whenever [a/another] creature you
control enters" used an optional `(?:a|another)?` group but always
assigned the self-inclusive `creature-you-control` subject regardless of
which word actually matched — so every card phrased with "another
creature you control enters" (Ogre Battledriver, Cathars' Crusade, etc.)
was silently treated as if its own ETB also qualified (CR 109.5 requires
"another" to exclude the source). Split it into two ordered templates:
"another creature you control enters" → `another-creature-you-control`
(checked first), "a creature you control enters" → the existing
self-inclusive `creature-you-control`. Verified **+1** in the export
count (10,072 → 10,073) and set coverage holds at 30.5%; the full **731**
rules-test suite (up from 728) stayed green through the template split,
confirming no other card's coverage regressed from tightening this
subject. Scenario-tested: casting a Grizzly Bears while Ogre Battledriver
is already on the battlefield pumps the ENTERING bear to 4/2 with haste
while leaving Battledriver's own power/toughness/keywords untouched — the
exact case the old bug would have gotten backwards on Battledriver's own
resolution (or any other "another…enters" card) had it not already been
placed via the ETB-bypassing test fixture. Validation: **731 rules
tests**, `npm run check`, `npm run simulate:engine` 200/200, 10,073 global
profiles.

Prossh decklist status after this pass: **64 of 97 unique cards fully
implemented (66.0%)**.

Reflecting Pool ("{T}: Add one mana of any type that a land you control
could produce.") is functionally identical to the existing Fellwar
Stone/Harvester Druid "any COLOR that a land you/an opponent controls
could produce" board-dependent mana template — the underlying
`ManaAbility.anyColorFromLandsControlledBy` mechanism and
`colorsFromLandsControlledBy` already union every `ManaType` (including
`C`) a controlled land's own mana abilities produce, so "type" was never
a real semantic difference, only a wording one the parser rejected
outright. Widened both the ability-construction regex and its matching
`unimplementedText` coverage check to accept "color" or "type"
interchangeably rather than adding a second parallel code path. Verified
**+1** in the export count and confirmed the mana options returned by
`manaSources` are exactly the colors the controller's OTHER lands (not
Reflecting Pool itself) could produce.

Vexing Shusher ("{R/G}: Target spell can't be countered.") needed a new
`make-target-spell-uncounterable` effect kind: `StackObject` already
carries a `cantBeCountered?: boolean` flag set at cast time (Delighted
Halfling's legendary-spell mana), and `canCounterSpell` already checks
it — the only missing piece was an ability that mutates that flag on an
EXISTING stack entry, targeted the same way `counter-target-spell`
already targets one (`target.kind === "spell"`, matched by
`target.stackId`). Added the sentence-grammar branch ("Target spell
can't be countered" → `targetKind: "spell"`) to the SHARED
`recognizeSentence` grammar rather than a Vexing-Shusher-specific parser
branch, so any future card with an identically-worded activated or
triggered ability inherits it for free through the same generic
activated-ability fallback every other targeted activation already uses.
Verified **+2** combined in the export count (10,073 → 10,076, Reflecting
Pool + Vexing Shusher) and set coverage holds at 30.5%. Scenario-tested:
Reflecting Pool with a Mountain and a Forest in play offers exactly
`{R, G}`, never colors from lands it doesn't see; casting a Lightning
Bolt while Vexing Shusher is in play, THEN activating Vexing Shusher
targeting that spell on the stack, flips `cantBeCountered` on that exact
stack entry and `canCounterSpell` flips from true to false for it.
Validation: **737 rules tests**, `npm run check`, `npm run
simulate:engine` 200/200, 10,076 global profiles.

Prossh decklist status after this pass: **66 of 97 unique cards fully
implemented (68.0%)**.

Garruk Wildspeaker's "+1: Untap two target lands" was the one missing
line on an otherwise-complete planeswalker (its −1 token and −4 anthem
abilities were already covered). Reused the existing single-target
`untap-target-permanent` effect kind rather than adding a new one — it
only read `object.targets[0]`, so generalized it to fold over every
`"permanent"` target in `object.targets`, which changes nothing for
every existing single-target user of that kind. Parsing "two target
lands" surfaced a real, previously-unnoticed bug: `recognizeSentence`
already supports returning `targetKinds` for multi-target abilities, but
`parseActivatedAbility`'s LOYALTY-ability branch (planeswalker `+N`/`−N`
costs) had its own separate return statement that never forwarded
`recognized.targetKinds` — so any planeswalker ability needing more than
one target of the same kind would have silently lost every target past
the first. Fixed by forwarding it the same way the ordinary
mana-cost-ability path already does. Separately, the shared
`targetKinds` validation had no distinctness check at all (CR 601.2c:
the same object can't be chosen twice for one instance of "target"), so
also added: a legality-time check that repeated same-kind slots have
enough DISTINCT legal candidates (not just a non-empty list per slot),
and an execution-time rejection if the same target is chosen for two
slots. Verified **+11** in the export count (10,076 → 10,087, spanning
Garruk's own multiple printings plus the loyalty-targetKinds fix
unblocking any other affected planeswalker) and set coverage 30.5% →
30.6%. Scenario-tested: activating +1 with two named lands untaps
exactly those two, leaves a third tapped land untouched, and adds a
loyalty counter; choosing the SAME land for both target slots throws;
the ability is not offered at all with only one land in play (a known,
documented boundary — the exact-count multi-target model here does not
yet support "up to N, minimum 1", so a single-land board under-offers
rather than mis-targeting). Validation: **743 rules tests**, `npm run
check`, `npm run simulate:engine` 200/200, 10,087 global profiles.

Prossh decklist status after this pass: **67 of 97 unique cards fully
implemented (69.1%)**.

Whole-mechanic gap closed: "Look at the top N cards of your library,
then put them back in any order" (Ponder's first line, Sensei's Divining
Top, Sage Owl, Halimar Depths, Mirri's Guile, 21 catalog cards total)
had zero support — unlike Scry/Surveil, no card ever LEAVES the top
group, only the sequence changes, so neither existing choice shape
fit. Added a new `look-top-reorder` `SpellEffect`, a new `reorder-top`
`PendingChoice` (the revealed cards, private to the choosing seat via a
new `ReorderTopView` in `projection.ts`, mirroring `ScryView`), and a new
`reorder-top` `GameAction` that submits a full permutation of the
revealed cards' instance ids in one action (validated as a true
permutation: same length, same set, no repeats) rather than the
per-card sequential decisions Scry uses — reordering has no "send this
one to the bottom" branch point to hang a step on. `legalActions` offers
one representative action (keep the current order, itself a fully legal
choice per the Oracle text) so bots always have something to take;
human clients may submit any explicit order directly. Implemented as a
single `case` in the SHARED `applyEffect` switch, which is what let it
work identically whether reached through a spell, an activated ability,
or (Sage Owl, Halimar Depths) a triggered ability, with no per-path
special-casing. Sensei's Divining Top additionally needed its OWN
second ability as a new `draw-then-source-to-library-top` effect kind
("{T}: Draw a card, then put this artifact on top of its owner's
library") — draws for the controller, then moves the activating
permanent itself from the battlefield to the top of its owner's
library, found via the `StackObject.sourcePermanentId` field activated
abilities already carry. Verified **+13** in the export count (10,087 →
10,100: Sensei's Divining Top plus every other catalog card sharing the
reorder-top template) and set coverage holds at 30.6%. Ponder itself
stays unimplemented — its trailing "You may shuffle" is a distinct,
not-yet-parsed clause, noted as a deliberate follow-up rather than
pulled into this pass's scope. Scenario-tested: activating the {1}
ability opens a private reorder choice over exactly the top three cards
in their current order; submitting an explicit permutation reorders the
library to match; submitting a list that repeats or omits a card
throws; activating the {T} ability draws the named card and leaves the
Top itself as the new top-of-library card, removed from the
battlefield. Validation: **747 rules tests**, `npm run check`, `npm run
simulate:engine` 200/200, 10,100 global profiles.

Prossh decklist status after this pass: **68 of 97 unique cards fully
implemented (70.1%)**.

Atarka, World Render ("Whenever a Dragon you control attacks, it gains
double strike until end of turn.") needed a genuinely new subject-filter
primitive: every existing `TriggerSubject` is a fixed string, with no
way to say "the object must ALSO have subtype X" for an "attacks" event
the way `condition`-kind fields check board-wide counts, not the
triggering object's own type. Added `TriggerDefinition.requireSubtype`
as a sibling to the existing `excludeSubtype` field (Requiem Angel's
"another non-Subtype creature... dies" already proved this
field-alongside-subject pattern works), checked once in the shared
subject-matching function right next to `excludeSubtype`. Parsed via its
own dedicated regex block (mirroring how Requiem Angel's `nonSubtypeDies`
line is built outside the flat `TRIGGER_TEMPLATES` array), since the
subtype word itself must flow into the new field rather than only into
the effect text. "it gains double strike until end of turn" needed one
more small addition: the general trigger-building path normalizes a
leading "it" to "~" (self), which would have been wrong here — "it"
means the ATTACKING creature, not Atarka itself — so this new dedicated
block passes the effect text to `recognizeSentence` unnormalized, and a
new "it gains KEYWORD until end of turn" pattern there returns the
existing `modify-event-creature-and-grant-keyword` kind (added for Ogre
Battledriver earlier this session) with power/toughness both 0 — a pure
keyword grant, reusing the kind rather than inventing another one.
Verified **+10** in the export count (10,100 → 10,110: Atarka plus other
catalog cards sharing the tribal-attack-trigger or "it gains keyword"
shapes) and set coverage 30.6% → 30.7%. Scenario-tested: attacking with
Atarka, a second Dragon, and a Grizzly Bears together grants double
strike to both Dragons but not the Bear, with power/toughness unchanged
on all three. Validation: **749 rules tests**, `npm run check`, `npm run
simulate:engine` 200/200, 10,110 global profiles.

Prossh decklist status after this pass: **69 of 97 unique cards fully
implemented (71.1%)**.

Beastmaster Ascension's trigger line ("Whenever a creature you control
attacks, you may put a quest counter on this enchantment") was already
covered by the existing generic `add-counter-source` template; only its
static anthem ("As long as ~ has seven or more quest counters on it,
creatures you control get +5/+5") was missing. Discovered that
`StaticPowerToughnessGrant` already had unused `counterName`/`threshold`
fields — declared on the interface but never read anywhere in
`engine.ts`, apparently added ahead of a card that needed them and then
never wired up. Added the missing half: a new
`creatures-you-control-source-counter-threshold` scope, a parser branch
in `parseStaticPowerToughnessGrant` (word-number threshold parsing via
the shared `toNumber`, matching every other counted-quantity pattern),
and a second pass in `staticPowerToughnessBonus` that checks the
GRANTING permanent's own counters (not the receiving creature's) before
adding its bonus to every creature the same controller owns — a
separate loop from the existing wide "creatures-you-control" filter,
since that one has no way to gate on the source's own state. Verified
**+1** in the export count (10,110 → 10,111) and set coverage holds at
30.7%. Scenario-tested: with six quest counters every controlled Grizzly
Bears stays 2/2; pushing the same enchantment to seven counters pumps
both Bears to 7/7 without touching anything else on the board.
Validation: **751 rules tests**, `npm run check`, `npm run
simulate:engine` 200/200, 10,111 global profiles.

Prossh decklist status after this pass: **70 of 97 unique cards fully
implemented (72.2%)**.

Forbidden Orchard ("Whenever you tap this land for mana, target opponent
creates a 1/1 colorless Spirit creature token") needed a genuinely new
trigger event: the existing `becomes-tapped` fires for ANY tap (Icy
Manipulator-style effects included), which would over-trigger here — CR
requires this to fire specifically when the land is tapped to activate
a mana ability. Added `TriggerEvent`/`GameEvent` variant `taps-for-mana`
(carrying `permanentId`/`controller`/`card` like every other object
event, so the existing generic `eventObject` helper and `"self"` subject
match needed no changes) and raised it from `applyActivateMana`
alongside the existing `raiseTapEvents` call, gated on
`ability.requiresTap` — an untapped mana ability can't be "tapped for."
As with the `play-land` event added earlier this session, adding a new
`TriggerEvent` union member is caught immediately and completely by
TypeScript's exhaustiveness checking on every `Record<TriggerEvent, ...>`
map: this pass hit two, both real (a `default:` branch in `engine.ts`'s
event-to-log-text switch that would have silently produced a nonsense
message, and the client's `TRIGGER_GLYPHS` map in `abilities.ts`), and
both had to be filled in before either `npm run check` workspace would
pass — the exact safety net this pattern is for. Parsing this card also
surfaced a real, previously-unnoticed and unrelated bug affecting
roughly 97 catalog cards: the shared token-descriptor parser
(`parseCreateToken`) recognizes exactly five color words (white, blue,
black, red, green) to strip from a token's subtype text, but never
recognized "colorless" — so "a 1/1 colorless Spirit creature token"
produced a token with the correct EMPTY `colors` array but a wrong
`typeLine` of "Creature — colorless Spirit" instead of "Creature —
Spirit". Fixed by adding "colorless" to the same exclusion list as
"artifact"/"creature"/"and" (grammar words already stripped from the
subtype, not literal subtype text). Verified **+2** in the export count
(10,111 → 10,113) and set coverage holds at 30.7%. Scenario-tested:
tapping Forbidden Orchard for mana gives the OPPONENT (not the
controller) a 1/1 Spirit with the corrected type line and empty colors;
a plain non-mana tap (simulated directly on the permanent) raises no
such token. Validation: **754 rules tests**, `npm run check`, `npm run
simulate:engine` 200/200, 10,113 global profiles.

Prossh decklist status after this pass: **71 of 97 unique cards fully
implemented (73.2%)**.

Lotus Cobra ("Landfall — Whenever a land you control enters, add one
mana of any color") needed a new `add-mana-any-color` effect kind — a
one-shot resolution that requires a runtime color choice, unlike a mana
ABILITY, which is why the deterministic-ritual "Add {W}{U}{B}{R}{G}"
pattern deliberately never matches "any color" (its own comment already
called this out). Reused the existing `choose-color` `PendingChoice`
infrastructure (built for `return-all-permanents-of-color` /
`damage-all-creatures-of-color`) rather than inventing a parallel one,
widening its `effect` type union to also accept the new kind. The two
existing consumers distinguish "still needs a choice" from "color
already chosen" via a `color: "chosen"` discriminant field checked
against `object.chosenColor`; `add-mana-any-color` has no fixed-color
variant to discriminate against, so it checks `object.chosenColor`
presence directly instead — absent, open the choice; present, add that
mana to the pool. Reusing `choose-color` surfaced a real bug the two
existing consumers never triggered: `applyChooseColor` unconditionally
moved the choice's `sourceCard` to the graveyard (or exile) after
resolving, an assumption valid only when the source is a resolving
SPELL — for a permanent's own triggered ability (Lotus Cobra is already
on the battlefield when its Landfall trigger fires), that would have
incorrectly sent the permanent to the graveyard the moment its
controller chose a color. Added a `sendSourceToGraveyard: boolean` field
to the choice, `true` for the two existing spell-effect consumers and
`false` for `add-mana-any-color`, gating that move. Verified **+3** in
the export count (10,113 → 10,116) and set coverage holds at 30.7%.
Scenario-tested: playing a land while Lotus Cobra is in play opens a
color choice; choosing blue adds `{U}` to the pool and leaves Lotus
Cobra on the battlefield, confirmed absent from the graveyard.
Validation: **756 rules tests**, `npm run check`, `npm run
simulate:engine` 200/200, 10,116 global profiles.

Prossh decklist status after this pass: **72 of 97 unique cards fully
implemented (74.2%)**.

## Gameplay interaction baseline (2026-09-05)

The current client contract for card interactions is:

- Required choices are rendered in a centered, fixed dialog so they do not
  move the hand, phase rail, or life/mana HUD. This includes library search,
  scry, graveyard targets, optional triggers, reveal choices, and cast/cycle
  mode selection.
- The bottom action list remains a compact fallback. It must not become the
  only way to reach a required choice.
- `autoPass` ignores mana abilities and Equip when there is no legal creature
  target, but stops for real activated abilities and for counterspells only
  while a counterable spell is on the stack.
- Right-clicking the playmat opens the reversible-action menu when the server
  reports `undoAvailable`. The rules layer accepts only a single manual mana
  activation whose settled delta is limited to mana/life and tapping its
  source; triggers and stack-producing sources such as City of Brass remain
  non-reversible.
- `CardView.isToken` is authoritative. Token permanents receive the client
  tombstone frame and keep their name and independent `instance_id`; broken
  image URLs are removed by the global image fallback instead of showing the
  browser's broken-image icon.
- Multiplayer combat tracks which defending seats already submitted blockers;
  a defender cannot be asked twice and the server logs a stabilization
  snapshot if a match still hits a loop guard.

Validation for this baseline: **625 rules tests**, `npm run check` (rules,
client, match-server), and `git diff --check`.

## Restricted mana baseline (2026-09-05)

Delighted Halfling is now executable instead of merely exposing its colour
choice. `ManaAbility.manaRestriction` tags each generated mana unit, the
payment planner excludes tagged mana from ordinary spells, and legendary-spell
payments may consume it. When the payment uses the tagged mana, the resulting
stack object carries `cantBeCountered`, so counter effects and counter-only
auto-pass correctly see no legal counter. The tag empties with the mana pool,
survives ordinary payments untouched, is projected only to its controller, and
is rendered in the reserve with the same mana symbol and a restricted tooltip.
The representation is unit-based so later restrictions can be added without
turning the normal pool into card-specific conditionals. Regression coverage
also checks that a nonlegendary spell cannot use it and that a legendary spell
cast with it is not counterable. Validation: **628 rules tests**, `npm run
check`.

## Intervening-if trigger baseline (2026-09-05)

Triggered conditions that use the current game state now follow CR 603.4 at
both checkpoints: the trigger is discarded before it reaches the stack when
the condition has stopped being true, and it does nothing at resolution when
the condition became false after stacking. The shared pure helper currently
covers source-untapped, controlled-subtype/power thresholds, morbid-style
"creature died this turn", and hand-size gates; event facts such as kicked,
evoked, second-draw, and cast-from-hand remain fixed facts from the event.
Howling Mine has regression scenarios for both checkpoints. Validation:
**629 rules tests**, `npm run check`.

Same-controller simultaneous triggers now expose a projected `trigger-order`
choice using only public labels; the authoritative trigger objects stay on the
server. Repeated copies with the same source/text/effect remain automatic
because their order cannot change the result, and bot seats select the first
deterministic option. The Cradle of Vitality scenario covers the meaningful
ordering path before its optional trigger resolves.

## Commit audit and energy baseline (2026-09-05)

The remote `origin/master` audit found a sequence of duplicate placeholder union
members (`activate-only-as-<n>-sorcery`, `landwalk-<type>`, and similar). They
add no parser, engine, or scenario behavior and are intentionally rejected;
workers must implement one reusable effect with a test, never append a nominal
type to claim a variant. The real C13/C14 feature branches remain reviewable
by their focused commits.

Energy is now compositional in both directions: `{E}` activation costs consume
the controller's public `energy` counter, and exact Oracle sentences such as
`You get {E}{E}.` produce that same counter through the generic
`add-player-counter` effect. This keeps future energy cards on the shared
counter primitive instead of adding card-specific branches (CR 121.1, 121.3).

## Counter state-based action baseline (2026-09-05)

The rules loop now applies CR 704.5r: matching `+1/+1` and `-1/-1` counters
annihilate before lethal-toughness checks. The remaining counter amount is
preserved, zero-valued keys are removed, and the normal state-based-action
loop reevaluates the creature after the change. This is shared by undying,
persist, graft, level and ordinary counter effects rather than a card branch;
the regression suite covers both the stored counters and live P/T result.
