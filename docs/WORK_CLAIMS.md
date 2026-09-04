# Work claims

This is the lightweight coordination ledger for parallel card and rules work.
The claim key is a reusable primitive or a disjoint card batch, never a vague
feature name.

## Before editing

1. Read this file, `AGENTS.md` and `docs/HANDOFF_TO_CLAUDE.md`.
2. Search open PRs and this table for the same claim key, card Scryfall IDs or
   engine files.
3. If free, add a row and publish that claim commit immediately.
4. Work only inside the declared scope. The first published claim wins; a
   later worker stops or chooses another batch.

## Active claims

| Claim key | Scope | Branch / PR | Status | Since (UTC) |
| --- | --- | --- | --- | --- |
| `rules-land-search` | Landcycling variants and land-subtype search resolution | `feat/activated-abilities-and-triggers` | merged (`7c7f77c`) | 2026-09-03 |
| `rules-equipment` | Equip actions, attachment state, and Equipment static bonuses | `codex/c13-equipment-cluster` | merged (`f61a096`) | 2026-09-03 |
| `rules-level-up` | Level up costs, level counters, and the three C13 cards: Echo Mage, Hada Spy Patrol, Kazandu Tuskcaller | `codex/c13-equipment-cluster` | merged (`f325052`) | 2026-09-03 |
| `rules-tap-untap` | Targeted Tap target creature and Untap target permanent effects | `codex/c13-equipment-cluster` | merged (`4fa0290`) | 2026-09-03 |
| `rules-mill` | Target player mills a bounded number of cards into their graveyard | `codex/c13-equipment-cluster` | merged (`2842700`) | 2026-09-03 |
| `rules-counter-restrictions` | Creature-spell and noncreature-spell counter target families | `codex/c13-equipment-cluster` | merged (`dcc9ada`) | 2026-09-03 |
| `rules-plus-counters` | Put +1/+1 or -1/-1 counters on a target creature | `codex/c13-equipment-cluster` | merged (`f026bdd`) | 2026-09-03 |
| `rules-target-discard` | Target player chooses bounded cards from their hand to discard | `codex/c13-equipment-cluster` | merged (`90e0098`) | 2026-09-03 |
| `rules-life-gained` | Life-gained trigger event and source +1/+1/-1/-1 counter effect | `codex/c13-equipment-cluster` | merged (`b1bf642`) | 2026-09-03 |
| `rules-target-life` | Target-player life gain with event propagation | `codex/c13-equipment-cluster` | merged (`41bfb46`) | 2026-09-03 |
| `rules-each-life` | Living-player life gain with one event per recipient | `codex/c13-equipment-cluster` | merged (`283a02f`) | 2026-09-03 |
| `rules-target-life-loss` | Target-player life loss, distinct from damage | `codex/c13-equipment-cluster` | merged (`93318e6`) | 2026-09-03 |
| `rules-each-life-loss` | Living-player global life loss, distinct from damage | `codex/c13-equipment-cluster` | merged (`6d128b6`) | 2026-09-03 |
| `rules-self-life-loss` | Controller life loss, distinct from damage | `codex/c13-equipment-cluster` | merged (`67f92db`) | 2026-09-03 |
| `rules-life-lost-trigger` | Life-loss event bus for `Whenever you lose life` | `codex/c13-equipment-cluster` | merged (`3d4ab69`) | 2026-09-03 |
| `rules-token-creation` | Preserve tapped state on created tokens | `codex/c13-equipment-cluster` | merged (`19ae957`) | 2026-09-03 |
| `rules-graveyard-return` | Target card return from own graveyard to hand | `codex/c13-equipment-cluster` | merged (`ff80bd1`) | 2026-09-03 |
| `rules-graveyard-target-ui` | Visible player selector for legal graveyard card targets | `codex/c13-equipment-cluster` | merged (`c518638`) | 2026-09-03 |
| `rules-any-creature-combat` | Combat-damage triggers from any creature | `codex/c13-equipment-cluster` | merged (`d554c36`) | 2026-09-03 |
| `rules-landscaled-tokens` | Token amounts scaled by lands controlled | `codex/c13-equipment-cluster` | merged (`00be19b`) | 2026-09-03 |
| `rules-subtype-counters` | Counter effects across a creature subtype | `codex/c13-equipment-cluster` | merged (`015e495`) | 2026-09-03 |
| `rules-exile-graveyard` | Exile a target card from its controller's graveyard | `codex/c13-equipment-cluster` | merged (`85f46f8`) | 2026-09-03 |
| `rules-x-life-loss` | X-scaled opponent life loss | `codex/c13-equipment-cluster` | merged (`1d6be6d`) | 2026-09-03 |
| `rules-x-draw` | X-scaled card draw | `codex/c13-equipment-cluster` | merged (`47e23f6`) | 2026-09-03 |
| `rules-opponent-mill` | Each opponent mills a bounded amount | `codex/c13-equipment-cluster` | merged (`5311b7f`) | 2026-09-03 |
| `rules-opponent-draw` | Each opponent draws a bounded amount | `codex/c13-equipment-cluster` | merged (`4b0fa92`) | 2026-09-03 |
| `rules-graveyard-top` | Return a target graveyard card to library top | `codex/c13-equipment-cluster` | merged (`fa5b4bd`) | 2026-09-03 |
| `rules-all-creature-counters` | Put counters on all controlled creatures | `codex/c13-equipment-cluster` | merged (`160e3b4`) | 2026-09-03 |
| `rules-python-ir` | Reusable raw-text operands: actions, zones, card types, and subtypes for the Oracle compiler | `feat/activated-abilities-and-triggers` | merged (`7326cbe`) | 2026-09-03 |
| `tools-primitive-roadmap` | `tools/rules/plan_primitive_roadmap.py` and its unit tests: rank Oracle primitives by cards actually finished | `codex-ready/c14-combat-restrictions` | merged (`3677066`) | 2026-09-03 |
| `c14-combat-restrictions` | Printed can't attack / can't block / attacks each combat if able / can block only creatures with X | `codex-ready/c14-combat-restrictions` | merged (`3677066`) | 2026-09-03 |
| `c14-landwalk` | Landwalk evasion for every basic land type plus legendary landwalk | `codex-ready/c14-combat-restrictions` | merged (`3677066`) | 2026-09-03 |
| `c14-self-pump` | Firebreathing-style `{cost}: ~ gets +N/±N until end of turn` self activated pumps (`modify-source-creature` effect) | `c14-self-pump` | merged (`8d88bbb`) | 2026-09-03 |
| `c14-scry` | `Scry N` / `Scry N, then draw M` as a spell effect and ETB trigger; sequential keep/bottom pending choice | `c14-self-pump` | merged (`ead5da1`) | 2026-09-03 |
| `c14-combat-damage-target` | `~ deals N damage to target attacking or blocking creature` (`attacking-or-blocking-creature` target kind) | `c14-self-pump` | merged (`ead5da1`) | 2026-09-03 |
| `c14-it-deals-trigger` | Normalise leading "it deals/gets/gains/fights" in a trigger clause to the source (`~`) | `c14-self-pump` | merged (`cbdceac`) | 2026-09-03 |
| `c14-damage-sweep-filter` | `~ deals N damage to each nonartifact creature` / `each creature without flying` | `c14-self-pump` | merged (`cbdceac`) | 2026-09-03 |
| `c13-unblockable` | Printed `~ can't be blocked` combat restriction | `codex/c13-equipment-cluster` | merged (`4a883e1`) | 2026-09-03 |
| `c13-activated-sacrifice-creature` | Activated costs that sacrifice a creature or another creature | `codex/c13-equipment-cluster` | merged (`7c54447`) | 2026-09-03 |
| `c13-activated-remove-counters` | Activated costs that remove counters from the source permanent | `codex/c13-equipment-cluster` | merged (`96142f7`) | 2026-09-03 |
| `c13-global-temporary-keyword` | Static `Creatures you control have <keyword>` grants, including summoning-sickness checks and projection | `codex/c13-equipment-cluster` | merged (`a1b42d9`) | 2026-09-03 |
| `c13-life-equals-power` | Gain life equal to the current power of a target creature you control | `codex/c13-equipment-cluster` | merged (`8c76cc9`) | 2026-09-03 |
| `c13-compound-draw-life-loss` | Resolve a compound draw plus life-loss instruction as one effect | `codex/c13-equipment-cluster` | merged (`80c6d53`) | 2026-09-03 |
| `c13-hand-count-damage` | Resolve damage equal to the controller's hand size | `codex/c13-equipment-cluster` | merged (`969c85d`) | 2026-09-03 |
| `tools-parallel-workers` | Assign disjoint primitive clusters to bounded workers under the shared memory budget | `codex/c13-equipment-cluster` | merged (`96be7d7`) | 2026-09-03 |
| `rules-regeneration` | Regeneration shields, destruction replacement, combat removal, and reusable `{cost}: Regenerate ~` parsing | `feat/activated-abilities-and-triggers` | merged (`f30492d`) | 2026-09-03 |
| `c13-draw-step-additional-card` | Draw-step triggers that draw an additional card for the active player | `codex/c13-equipment-cluster` | merged (`e002034`) | 2026-09-03 |
| `c13-opponent-hand-minus-damage` | Opponent-upkeep damage equal to active player's hand count minus an offset | `codex/c13-equipment-cluster` | merged (`93bd5a2`) | 2026-09-03 |
| `c13-conditional-subtype-trigger` | Conditional triggers gated by controlling no permanent of a subtype | `codex/c13-equipment-cluster` | merged (`e352f7b`) | 2026-09-03 |
| `c13-draw-tapped-creatures` | Draw a card for each tapped creature controlled by a targeted opponent | `codex/c13-equipment-cluster` | merged (`493f587`) | 2026-09-03 |
| `c13-global-creature-keyword` | Temporary keyword grants to all creatures on the battlefield | `codex/c13-equipment-cluster` | merged (`7426cf7`) | 2026-09-03 |
| `c13-life-gain-prevention` | Static prevention of all player life gain | `codex/c13-equipment-cluster` | merged (`4fc6670`) | 2026-09-03 |
| `c13-no-maximum-hand-size` | Static removal of the cleanup maximum-hand-size discard | `codex/c13-equipment-cluster` | merged (`64dd7a3`) | 2026-09-03 |
| `c13-static-creature-pt-grant` | Static +P/+T bonuses for other creatures you control | `codex/c13-equipment-cluster` | merged (`5f1b014`) | 2026-09-03 |
| `c13-destroy-power-toughness-loss` | Destroy a creature then make its controller lose its power plus toughness | `codex/c13-equipment-cluster` | merged (`9ea3d05`) | 2026-09-03 |
| `c13-variable-global-debuff` | X-scaled -X/-X effects affecting every creature | `codex/c13-equipment-cluster` | merged (`cb9abba`) | 2026-09-03 |
| `c13-conditional-power-trigger` | Optional triggers gated by a controlled creature's power threshold | `codex/c13-equipment-cluster` | merged (`a5fb83a`) | 2026-09-03 |
| `c13-nonflying-global-damage` | X-scaled damage to nonflying creatures and each player | `codex/c13-equipment-cluster` | merged (`7216afe`) | 2026-09-03 |
| `c13-upkeep-draw-life-loss` | Upkeep draw-and-life-loss compound trigger wording | `codex/c13-equipment-cluster` | merged (`2efb489`) | 2026-09-03 |
| `c13-counted-effects-batch` | Reusable draw/life/damage/mill/discard/token primitives scaled by hand size, permanent type, creature count, lands, and power thresholds | `codex/c13-equipment-cluster` | merged (`77b235a`) | 2026-09-04 |
| `c13-keyword-target-filters` | Target filters for fear, defender, deathtouch, lifelink, menace, haste, first/double strike, trample, vigilance, indestructible, hexproof, and shroud; continuous grants are respected | `codex/c13-equipment-cluster` | merged (`3b2f825`) | 2026-09-04 |
| `rules-compound-sentence-order` | Parse multi-sentence destruction plus power/toughness life-loss effects before the generic destruction primitive | `feat/activated-abilities-and-triggers` | merged (`5e9f3cf`) | 2026-09-04 |
| `c13-fork-followup-20260904` | Reach and flying-only filters; global keyword/P+T layers; counted planeswalkers and battles; optional-condition narrowing; GameCard test fixtures | `codex/c13-equipment-cluster` | merged (local `b3372a2`; source `3cd6156`) | 2026-09-04 |

## Claim format

Copy this row when starting work:

```text
| `cluster-or-batch` | exact primitive, files and/or Scryfall IDs | branch / PR | active | YYYY-MM-DD |
```

Use one row per independent worker. Keep a claim active until the PR is merged
or explicitly abandoned. After merge, change it to `merged` and record the
commit in the handoff. If a worker discovers that its scope is larger than
declared, it must update the claim before touching the additional files.

Claims coordinate contributors but do not replace review: CI, scenario tests,
rules citations and the integrator review remain mandatory.
