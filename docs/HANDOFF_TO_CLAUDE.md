# ProsshTCG — implementation handoff

**Read this before changing the project.** It is an honest snapshot of the working tree as of 2026-09-03, separating what is implemented and verified from what is still product intent. Do not present anything below the "Truth boundaries" line as working.

Repository: <https://github.com/MatyMeatBoy/ProsshTCG> (private).

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
| Catalog cards fully implemented | 5,151 | 6,067 |
| …of those, with non-empty Oracle text | 2,090 | 2,981 |
| C13 unique cards fully implemented | — | 118 / 356 (238 pending) |
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
  into deterministic bounded process batches. The review profile is 5 workers
  with a 2 GB scheduler budget; workers are capped from the requested memory
  estimate.
- Supported `Choose one` modes become reusable `ModalChoice` entries. The
  engine publishes one legal cast action per mode, applies the selected effect
  on resolution, and filters its targets normally.
- Added reusable exact target families for artifact, enchantment, land and
  player-or-planeswalker removal, plus the artifact/creature/enchantment board
  sweep. Crosis Charm and Dromar’s Charm are scenario-tested.
- Landfall and artifact-creature combat-damage triggers reuse the existing
  enters/deals-damage event bus; Rampaging Baloths and Grazing Gladehart are
  now covered by the same trigger subject rather than card-specific code.
- The Python IR emits stable `primitive_cluster` keys and a grouped review
  queue so contributors can implement one primitive across many cards.
- Supported keyword-only clauses are removed from the review queue; the latest
  full IR therefore reduced actionable pending entries from 22,678 to 18,254
  without changing executable-card coverage.

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

Measured on the current catalog: **15,217 of 32,057 unfinished cards are exactly
one line away**, and the top 40 templates would finish 1,326 of them. The
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
npm run test --workspace=@prossh/rules   182 passed, 6 skipped
python tools/rules/test_compile_oracle_effects.py   22 tests OK
npm run simulate:engine          200 games, 0 invariant failures, 160 finished
npm run rules:engine:export      38,711 cards; 6,654 fully implemented
```

Fully implemented moved **6,500 → 6,654 (+154)**, and every combat-restriction
and landwalk template dropped out of the regenerated roadmap, which is the
tool checking its own prediction.

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
| Activated abilities | Mana abilities resolve immediately and never use the stack; non-mana activations are announced, paid and put on the stack like a spell. Costs cover mana, `{T}`, paying life and sacrificing the source, and a source that taps for its own ability is removed from its mana sources first. | `activatableAbility`/`applyActivate`/`applyActivateMana` in `engine.ts`, `parseActivatedAbility` in `characteristics.ts`; `engine.test.ts` → "activated abilities" (6 cases) |
| Oracle reading | The printed name **and** the modern "this land" / "this creature" self reference both normalise to `~`, so current reprints parse. A mana clause must consume its whole sentence, so a restricted "any color that a land an opponent controls could produce" is not read as five free colours. | `normalizedOracle`, `parseAddClause`; `characteristics.test.ts` → "faces and oracle normalisation" |
| Commander | Command-zone start, `{2}` tax per previous cast, return-to-command-zone on death, 21-damage elimination tracked per commander. | `commanderTax`, `movePermanentToZone`; `engine.test.ts` → "commander rules" |
| Combat | Attack declaration with per-attacker defender choice, blocks, first/double strike sub-step, deathtouch, trample, lifelink, vigilance, menace, flying/reach restrictions, defender, haste, summoning sickness. | `computeCombatDamage`; `engine.test.ts` → "combat" (11 cases) |
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
npm test                Vitest 5 files / 152 tests + Python smoke tests    PASS
npm run simulate:engine 200 seeded games in 7.22s                          PASS
                        finished 141, unfinished 59, avg 51.63 turns
                        0 invariant failures, 0 projection leaks
npm run rules:cr:sync  3,162 structured CR rules -> Markdown snapshot      PASS
npm run rules:engine:export  38,711 cards; 6,067 fully implemented         PASS
npm run rules:set:coverage  708 editions; 14.3% membership coverage        PASS
```

The matrix now finishes 141 of 200 games (was 105 before activations and 100
before this pass): fetch lands, ramp and death triggers actually run, so games
reach a real result more often.

Browser smoke test at `http://localhost:5173` against the local server on
`http://localhost:8787`: a cEDH pod starts, a land is played, its mana ability
menu opens with one row per producible colour, clicking an ability icon opens the
keyword help card, and the hand honestly marks partially implemented cards.

## Truth boundaries — do not overstate these

1. **Card text is mostly not executed.** `characteristics.ts` recognises a closed set of templates: draw N, gain N life, each opponent loses N life, "~ deals N/X damage to any target", damage to each opponent, target destruction/exile/bounce restrictions, destroy all creatures, counter target spell, common library searches to top/hand/graveyard/battlefield, entry/cost counter templates and a small set of temporary P/T modifiers, plus the Frostboil-style replacement choice. The C13 report is the current queue and must be regenerated after changes. Fireball's first-target/X branch is tested, but its additional-target cost and damage distribution are not. Every other card plays as a real body with real types, power/toughness and combat keywords, and both the hand tooltip and the card page say so. Never claim "all cards work".
2. **What triggers and activations still do not cover.** Activated abilities exist for costs made of mana, `{T}`, paying life, removing counters from the source and sacrificing the source. Everything else is left out of the profile rather than approximated: `{Q}`, loyalty, energy, discarding, exiling, and sacrificing *other* permanents. Triggers cover ten events and seven subjects with APNAP ordering and targets, but there are still **no intervening-if conditions**, no player-ordering choice between two of one player's own simultaneous triggers (they keep event order), no delayed or state triggers, and no trigger on zone changes other than entering and dying. Also still absent: general static/continuous effects, layer dependencies, counter addition/proliferation, tokens with copied characteristics, planeswalker loyalty and mulligans. Frostboil Snarl remains a separate entering replacement effect documented in `docs/RULES_RESEARCH.md`.
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
  src/*.test.ts                 139 Vitest specs
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
npm test                  # 121 Vitest specs + Python smoke tests
npm run simulate:engine   # 200 seeded games through the real engine
npm run rules:pool:sync   # 1,500-card EDHREC popularity pool in data/rules
npm run rules:compile     # 38k-card rules-family inventory in data/rules
npm run rules:engine:export # actual engine profile for each unique card
npm run rules:roadmap     # rank the primitives that finish the most cards next
npm run build             # production builds
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

Validation on this branch: `npm run check` and `npm test` pass (149 rules
tests, 6 skipped; simulator and 9 Python compiler tests pass).

The current batch adds reusable modal choices, exact artifact/enchantment/land
target restrictions, player-or-planeswalker targets, and the
artifact/creature/enchantment board sweep. `compile_oracle_effects.py` also
supports deterministic bounded card/primitives batches.

Validation: 152 rules tests, workspace TypeScript checks, simulator smoke tests
and 9 Python compiler regressions pass. C13 is 118/356 unique cards implemented
(33.1%); generated coverage remains in `data/rules/coverage-c13.md`.

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
6,067 of 38,711 cards are fully implemented, because most printed effects are
still outside `SpellEffect`.

1. **Widen `SpellEffect`, one template plus one test at a time.** The highest
   value families, in order of how often they appear in the local catalog: put a
   +1/+1 counter, create a token, target player draws/discards, mill N, tap or
   untap target permanent, return target card from a graveyard, scry N, and
   "target creature gets +N/+N until end of turn". The first three need new state
   (counters and tokens); the rest do not.
2. **Counters on permanents and tokens.** Needed by the families above, and by
   the state-based actions that check them.
3. **Intervening-if conditions and trigger ordering choices.** `TriggerDefinition`
   has the shape for a condition; the missing piece is checking it both on trigger
   and on resolution (CR 603.4), plus letting a player order two of their own
   simultaneous triggers instead of keeping event order.
4. **More activation costs.** Discarding, exiling from a graveyard, removing a
   counter and sacrificing another permanent are the four that unlock the most
   cards; each needs a real cost-payment choice, not an approximation.
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

## Cooperative C13 cluster: Level Up

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
packages/rules/src/engine.test.ts` PASS (153 passed, 6 skipped).

### Cooperative C13 cluster: counters on target creatures

The branch adds the reusable `Put N +1/+1 or -1/-1 counter(s) on target
creature` effect. It updates the existing public counter map, so the normal
P/T calculation and state-based actions immediately see the result. This
follows CR 122.1 and 701.4. Scenario coverage verifies parsing, target
resolution, and both P/T values after a resolved counter.

Validation: `npm run check` PASS; targeted engine tests PASS (154 passed, 6
skipped). Full `npm test` should be rerun by the integrator after merge.

### Cooperative C13 cluster: target-player discard

The branch adds `Target player discards a card` with a server-side pending
choice. The affected player sees only their own hand and chooses the card;
the chosen card then moves to that player's graveyard. No deterministic card
selection is hidden behind the UI. This follows CR 701.8 and 400.1. Scenario
coverage verifies the pending seat, both visible choices, selected-card
movement, and completion of the choice.

Validation: `npm run check` PASS; targeted engine tests PASS (155 passed, 6
skipped). Full `npm test` should be rerun by the integrator after merge.

### Cooperative C13 cluster: life-gained triggers

The branch adds a reusable `life-gained` event raised by explicit life-gain
effects and lifelink. It recognizes `Whenever you gain life` and resolves a
source counter effect such as `put a +1/+1 counter on ~`; the source is tracked
by permanent instance ID, not display name. This follows CR 603.2, 119.3 and
122.1. Scenario coverage verifies one event, stack ordering, and the counter
after resolution. The scope excludes replacement/prevention effects, batches
of simultaneous gains, and printed triggers with additional costs.

Validation: targeted engine tests PASS (156 passed, 6 skipped). Full `npm run
check` and `npm test` are required before integration.

### Cooperative C13 cluster: target-player life gain

The branch adds `Target player gains N life` as a reusable targeted effect.
It uses the normal player-target legality path and raises `life-gained` for the
chosen seat, so dependent triggers observe the actual recipient rather than
the spell controller. This follows CR 119.3 and 601.2c. Scenario coverage
verifies target metadata and that only the chosen player's life changes. The
scope excludes split effects, life-total setting, and replacement/prevention
effects.

Validation: targeted engine tests PASS (157 passed, 6 skipped). Full `npm run
check` and `npm test` are required before integration.

### Cooperative C13 cluster: each-player life gain

The branch adds `Each player gains N life` as a reusable global effect. It
skips eliminated players and raises one `life-gained` event per living
recipient, preserving the trigger bus semantics for dependent abilities. This
follows CR 119.3 and 608.2c. Scenario coverage verifies both players receive
life and the effect is recognised. The scope excludes replacement/prevention
effects and simultaneous-event batching beyond the per-recipient events.

Validation: targeted engine tests PASS (158 passed, 6 skipped). Full `npm run
check` and `npm test` are required before integration.

### Cooperative C13 cluster: target-player life loss

The branch adds `Target player loses N life` as a reusable player-targeted
effect. It changes only the target's life total and deliberately does not use
the damage pipeline, matching CR 118.2 and 119.4. Scenario coverage verifies
target selection and distinguishes life loss from damage. The scope excludes
life-loss triggers, replacement/prevention effects, and multi-player variants.

Validation: targeted engine tests PASS (159 passed, 6 skipped). Full `npm run
check` and `npm test` are required before integration.

### Cooperative C13 cluster: each-player life loss

The branch adds `Each player loses N life` as a reusable global life-loss
effect. Eliminated players are skipped and the effect remains distinct from
damage, so damage prevention and damage triggers do not apply. This follows CR
118.2 and 119.4. Scenario coverage verifies both living players lose life and
the parser emits the dedicated effect. The scope excludes life-loss triggers,
replacement/prevention effects, and conditional recipients.

Validation: targeted engine tests PASS (160 passed, 6 skipped). Full `npm run
check` and `npm test` are required before integration.

### Cooperative C13 cluster: self life loss

The branch adds `You lose N life` as a reusable non-targeted life-loss effect.
It changes only the spell controller's life total and remains outside the
damage pipeline. This follows CR 118.2 and 119.4. Scenario coverage verifies
recognition, resolution, and that the opponent is unchanged. The scope
excludes payment costs and life-loss replacement/prevention effects.

Validation: targeted engine tests PASS (161 passed, 6 skipped). Full `npm run
check` and `npm test` are required before integration.

### Cooperative C13 cluster: life-lost trigger bus

The branch adds a reusable `life-lost` event and recognizes `Whenever you lose
life`. Explicit life-loss effects and player damage now raise the event; the
existing `Each opponent loses life` path also uses life loss rather than the
damage logger. This follows CR 118.2, 119.4 and 603.2. Scenario coverage
verifies a source counter trigger after life loss. The scope excludes
replacement/prevention effects and intervening-if conditions.

Validation: targeted engine tests PASS (162 passed, 6 skipped). Full `npm run
check` and `npm test` are required before integration.

### Cooperative C13 cluster: token creation

The branch extends the reusable token compiler with the `tapped` instruction
and carries it into the battlefield permanent. This covers text such as
`Create thirteen tapped 2/2 black Zombie creature tokens` without a card-name
special case; existing color, type, stats, and keyword extraction remain
shared. This follows CR 111.2 and 701.6. Scenario coverage verifies all
thirteen generated tokens enter tapped. The scope excludes copy tokens,
replacement effects that multiply tokens, and variable-count costs.

Validation: targeted engine tests PASS (163 passed, 6 skipped). Full `npm run
check` and `npm test` are required before integration.

### Cooperative C13 cluster: graveyard card return

The branch adds explicit card targets for `Return target creature card from
your graveyard to your hand` and the generic card variant. Legal targets are
limited to the resolving player's own graveyard and filtered by card type;
resolution moves the stable `instance_id` card to hand, and a card leaving the
graveyard makes the spell fail its target check. This follows CR 400.1,
601.2c and 608.2b. Scenario coverage verifies filtering, target identity and
zone movement. The scope excludes opponent graveyards, multi-card returns and
replacement effects.

Validation: targeted engine tests PASS (164 passed, 6 skipped). Full `npm run
check` and `npm test` are required before integration.

### Commander's Arsenal progress

The Arsenal work now covers Loyal Retainers' precombat legendary-creature
activation, Mirari's Wake's creature bonus and controlled-land mana replacement,
Command Tower's commander-color-identity restriction, Chaos Warp's owner-library
replacement, Decree of Pain's creature sweep/draw count plus cycling -2/-2
trigger, Desertion's artifact/creature spell replacement to the battlefield,
Edric's optional combat-damage draw trigger, and Vela the Night-Clad's
intimidate/static grant plus leaves-the-battlefield trigger, Mind's Eye's
opponent-draw payment trigger, Duplicant's nontoken-creature ETB imprint
and copied power/toughness, and Rhystic Study's caster-payment trigger. These
use stable card profiles, deterministic state transitions, and scenario tests;
Maelstrom Wanderer's cascade and several other Arsenal cards remain explicitly
unimplemented. See
`docs/WORK_CLAIMS.md` for active claims and `docs/SET_COVERAGE.md` for the
remaining Arsenal cards.

The latest C13 batch also closes Gahiji's opponent-attack buff, Guttersnipe's
instant/sorcery trigger, Fecundity's death-draw choice for the dead creature's
controller, and the reusable Fires of Yavimaya/Goblin Bombardment sacrifice
activations. Each has parser and rules scenarios; the corresponding C13 rows
are checked in `docs/SET_COVERAGE.md`.

The multi-card library-search cluster now covers Cultivate and Armillary Sphere:
the parser extracts basic-land restrictions, ordered destinations, reveal text,
and Armillary Sphere's named self-sacrifice cost. The authoritative engine
keeps exact library ids private, supports selecting zero through the printed
maximum, shuffles the remainder deterministically, and projects only the
searching player's legal candidates plus their full-library review. The client
also shows multi-search progress. This follows CR 701.19, 701.23, 701.26 and
400.7; the scope excludes searches with different per-card restrictions or
non-deterministic destination choices.

The same reusable primitive now recognizes Burnished Hart's variant, where
both selected basics enter the battlefield tapped, with a scenario covering
its sacrifice cost and destination order.

Ajani's Pridemate is also verified as a C13 reprint of the life-gained
source-counter trigger: the stable profile, trigger event, and end-to-end
counter resolution are shared with the existing primitive.

Blue Sun's Zenith now uses a dedicated self-shuffle replacement: its target
draw resolves normally, then the spell is shuffled into its owner's library
instead of the graveyard. The countered-spell path correctly remains the
normal graveyard destination; both paths have scenarios and the C13 row is
checked.

The reprint-equivalence pass verifies C13's Command Tower and Decree of Pain
against their shared oracle-driven implementations. Army of the Damned is now
covered end to end, including Flashback from the graveyard and exile on
resolution or countering. Fireball remains excluded because its extra-target
cost clause is still unimplemented.

The current upstream branch also contains newly generated reusable clusters
for target-creature modification, landwalk, fortify, enchant-creature,
choose-modal, sorcery-speed restrictions, and typed counterspells. They were
reviewed before this batch and deliberately not duplicated here; integrate or
rebase that upstream work before claiming overlapping files.

### Cooperative C13 cluster: graveyard creature return

The branch recognises `Return target creature card from your graveyard to the
battlefield`, filters legal choices to creature cards in the caster's graveyard,
and returns the selected card under the spell controller's control through the
standard battlefield-entry path. This follows CR 400.1, 400.7 and 608.2c.
Scenario coverage verifies the card leaves the graveyard and enters the
battlefield. The scope excludes reanimation costs, replacement effects and
non-creature cards.

Validation: targeted engine tests PASS (176 passed, 6 skipped). Full `npm run
check` and `npm test` are required before integration.

### Cooperative C13 cluster: typed artifact graveyard target

The branch recognises `Return target artifact card from your graveyard to your
hand` as a reusable typed graveyard target. Legal target projection exposes only
artifact cards, while the existing hand-return resolution remains shared with
the broader recovery family. This follows CR 109.2 and 400.1. Scenario
coverage verifies an artifact is selectable and a creature in the same graveyard
is not. The scope excludes battlefield return and recursion costs.

Validation: targeted engine tests PASS (177 passed, 6 skipped). Full `npm run
check` and `npm test` are required before integration.

### Cooperative C13 cluster: land graveyard return

The branch recognises `Put target land card from a graveyard onto the
battlefield under your control`, exposes land cards from every graveyard as
legal targets, removes the selected card from its owner, and enters it under
the spell controller's control through the standard battlefield-entry path.
This follows CR 400.1, 400.7 and 608.2c. Scenario coverage verifies targeting
an opponent's graveyard and the resulting controller/owner distinction. The
scope excludes multiple targets, tapped-entry instructions and replacement
effects.

Validation: targeted engine tests PASS (178 passed, 6 skipped). Full `npm run
check` and `npm test` are required before integration.

### Cooperative C13 cluster: artifact graveyard return

The branch recognises `Return target artifact card from your graveyard to the
battlefield`, restricts legal choices to artifact cards in the caster's
graveyard, and reuses the normal battlefield-entry path. This follows CR
400.1, 400.7 and 608.2c. Scenario coverage verifies artifact filtering and
removal from the graveyard. The scope excludes attached-card handling,
replacement effects and non-artifact cards.

Validation: targeted engine tests PASS (179 passed, 6 skipped). Full `npm run
check` and `npm test` are required before integration.

### Cooperative C13 cluster: typed enchantment graveyard target

The branch recognises `Return target enchantment card from your graveyard to
your hand` as a reusable typed graveyard target. Legal target projection exposes
only enchantment cards, while the existing hand-return resolution remains
shared with the recovery family. This follows CR 109.2 and 400.1. Scenario
coverage verifies enchantment filtering and recovery. The scope excludes
battlefield return and recursion costs.

Validation: targeted engine tests PASS (180 passed, 6 skipped). Full `npm run
check` and `npm test` are required before integration.

### Cooperative C13 cluster: temporary creature keyword

The branch recognises `Target creature gains [keyword] until end of turn` for
the enforced combat-keyword set, stores the grant separately from printed and
Equipment keywords, and clears it during cleanup. This follows CR 613.1f and
514.2. Scenario coverage verifies a double-strike grant. The scope excludes
continuous non-temporary effects, protection clauses and multi-keyword grammar.

Validation: targeted engine tests PASS (181 passed, 6 skipped). Full `npm run
check` and `npm test` are required before integration.

### Cooperative C13 cluster: combined temporary P/T and keyword

The branch recognises `Target creature gets +/-N/+/-N and gains [keyword] until
end of turn` as one atomic effect, applying both the layer-7c modifier and the
temporary keyword through the same target. This follows CR 613.1f and 514.2.
Scenario coverage verifies the Selesnya-style +2/+2 and trample combination.
The scope excludes multiple targets, protection text and non-temporary
continuous effects.

Validation: targeted engine tests PASS (182 passed, 6 skipped). Full `npm run
check` and `npm test` are required before integration.

### Cooperative C13 cluster: activated self-pump

The branch recognises activated lines such as `{R}: This creature gets +1/+0
until end of turn`, binds the effect to the source permanent rather than
creating a target, and applies it through the existing cleanup-expiring P/T
modifier. This follows CR 602.1 and 613.4c. Scenario coverage verifies an
Inferno Titan-style activation and resolution. The scope excludes variable
costs, non-self targets and other activated costs.

Validation: targeted engine tests and full `npm run check`/`npm test` required
before integration.

### Cooperative C13 cluster: activated creature sacrifice costs

The branch recognises activated costs such as `Sacrifice a creature` and
`Sacrifice another creature`, exposes one legal activation per possible
creature, validates the selected permanent server-side, and moves it through
the normal sacrifice/death path before resolving the ability. This follows CR
602.1 and 601.2f. Scenario coverage verifies Carnage Altar-style draw and
selection. The scope excludes sacrificing multiple permanents, noncreature
costs and replacement effects.

Validation: targeted engine tests and full `npm run check`/`npm test` required
before integration.

### Cooperative C13 cluster: can't-be-blocked restriction

The branch recognises `This creature can't be blocked` as a static combat rule
and rejects all blocker declarations against that attacker. This follows CR
509.1a. Scenario coverage verifies the restriction through `legalBlockers`.
The scope excludes conditional evasion, protection and unblockable effects
granted by other objects.

Validation: targeted engine tests and full `npm run check`/`npm test` required
before integration.

### Cooperative C13 cluster: land-scaled token creation

The branch adds the reusable `Create a token for each land you control`
template. It evaluates the controller's current battlefield land count at
resolution, including when the effect is a triggered ability, and shares the
existing token definition compiler. This follows CR 111.2, 608.2h and 701.6.
Scenario coverage verifies compiler metadata and the resolved count. The scope
excludes copied tokens, token multipliers, and effects that count lands in
other zones.

Validation: targeted engine tests PASS (165 passed, 6 skipped). Full `npm run
check` and `npm test` are required before integration.

### Cooperative C13 cluster: subtype-wide counters

The branch adds `Put a +1/+1 counter on each [subtype] creature you control`
as a reusable effect. It filters by current controller, creature type and
subtype, then updates the public counter map used by P/T calculation. This
follows CR 122.1 and 701.4. Scenario coverage verifies Plant matching and that
an unrelated creature is unchanged. The scope excludes multiple subtypes,
opponent-wide effects and counter replacement effects.

Validation: targeted engine tests PASS (166 passed, 6 skipped). Full `npm run
check` and `npm test` are required before integration.

### Cooperative C13 cluster: graveyard card exile

The branch adds `Exile target card from your graveyard` using the existing
stable graveyard-card target and client picker. Resolution moves only the
chosen card to its owner's exile zone; target loss is handled by the shared
608.2b check. This follows CR 400.1, 406.1 and 601.2c. Scenario coverage
verifies target metadata and the graveyard-to-exile zone transition. The scope
excludes multi-card costs, opponent graveyards and replacement effects.

Validation: targeted engine tests PASS (167 passed, 6 skipped). Full `npm run
check` and `npm test` are required before integration.

### Cooperative C13 cluster: X-scaled opponent life loss

The branch extends `Each opponent loses X life` to use the spell's announced X
value at resolution. Each opponent receives life-loss semantics and the shared
`life-lost` event, without routing through damage. This follows CR 107.3 and
119.4. Scenario coverage verifies X payment and that only opponents lose life.
The scope excludes variable costs with additional non-mana effects.

Validation: targeted engine tests PASS (168 passed, 6 skipped). Full `npm run
check` and `npm test` are required before integration.

### Cooperative C13 cluster: X-scaled draw

The branch extends the base `Draw X cards` primitive to consume the announced
spell X value at resolution. It reuses the existing deterministic draw path
and keeps the spell card out of the drawn hand. This follows CR 107.3 and
121.1. Scenario coverage verifies parser metadata and a resolved X=2 draw.
The scope excludes variable draw replacement effects and hand-size choices.

Validation: targeted engine tests PASS (169 passed, 6 skipped). Full `npm run
check` and `npm test` are required before integration.

### Cooperative C13 cluster: each-opponent mill

The branch adds `Each opponent mills N cards` as a non-targeted zone effect.
It resolves independently for each living opponent through the existing ordered
mill primitive, leaving the controller's library untouched. This follows CR
701.13 and 608.2c. Scenario coverage verifies count, order and zone isolation.
The scope excludes replacement effects and opponent-specific choices.

Validation: targeted engine tests PASS (170 passed, 6 skipped). Full `npm run
check` and `npm test` are required before integration.

### Cooperative C13 cluster: each-opponent draw

The branch adds `Each opponent draws N cards` as a non-targeted effect. It
reuses the deterministic draw path for each living opponent while leaving the
controller's hand and library untouched in the scenario. This follows CR
121.1 and 608.2c. The scope excludes hand-size choices, replacement effects
and opponent-specific draw decisions.

Validation: targeted engine tests PASS (171 passed, 6 skipped). Full `npm run
check` and `npm test` are required before integration.

### Cooperative C13 cluster: graveyard to library top

The branch adds `Put target card from your graveyard on top of your library`
using the stable graveyard-card target and existing zone projection. Resolution
removes exactly that card and prepends it to its owner's library. This follows
CR 400.1, 401.4 and 601.2c. Scenario coverage verifies target metadata and
zone/order transition. The scope excludes shuffle effects, opponent graveyards
and replacement effects.

Validation: targeted engine tests PASS (172 passed, 6 skipped). Full `npm run
check` and `npm test` are required before integration.

### Cooperative C13 cluster: all controlled creature counters

The branch adds `Put a +1/+1 counter on each creature you control` as a
reusable board-wide effect. It updates only creatures controlled by the
resolving player, while preserving noncreatures and opposing creatures. This
follows CR 122.1 and 701.4. Scenario coverage verifies the parser and all
controlled-creature filtering. The scope excludes subtype filters, counters
on permanents other than creatures, and replacement effects.

Validation: targeted engine tests PASS (173 passed, 6 skipped). Full `npm run
check` and `npm test` are required before integration.

### Cooperative C13 cluster: creature-spell trigger filter

The branch adds a typed `spellType: "creature"` trigger constraint for lines
such as `Whenever you cast a creature spell`. The existing spell-cast event is
reused, but noncreature spells no longer fire the constrained trigger. This
follows CR 603.2 and 601.2. Scenario coverage verifies trigger metadata and
stack placement for a creature spell. The scope excludes card-color filters,
mana-value conditions and copied spells.

Validation: targeted engine tests PASS (174 passed, 6 skipped). Full `npm run
check` and `npm test` are required before integration.

### Cooperative C13 cluster: X-scaled discard

The branch extends `Target player discards X cards` through the existing
server-side private discard choice. X is evaluated from the announced spell
value, while the affected player chooses each card and the opponent sees no
hand contents. This follows CR 107.3, 701.8 and 400.1. Scenario coverage
verifies two sequential choices. The scope excludes random discard,
simultaneous multi-player choices and replacement effects.

Validation: targeted engine tests PASS (175 passed, 6 skipped). Full `npm run
check` and `npm test` are required before integration.

### Cooperative C13 cluster: any-creature combat damage triggers

The branch adds the reusable trigger grammar for `Whenever a creature deals
combat damage to a player`. It maps to the existing combat-damage event and
the existing `any-creature` subject, so no card-name exception or second damage
pipeline is introduced. This follows CR 603.2 and 510.2. Scenario coverage
verifies the printed line resolves to a draw effect. The scope excludes
noncombat damage and conditional/intervening-if clauses.

Validation: targeted engine tests PASS (164 passed, 6 skipped). Full `npm run
check` and `npm test` are required before integration.
