# Cooperative work claims

| Cluster | Worker branch | Scope | Status |
| --- | --- | --- | --- |
| `rules-equipment` | `codex/c13-equipment-cluster` | Equip, attachment, Equipment static bonuses, and Sword of the Paruns untap abilities | Ready for integrator review |
| `rules-level-up` | `codex/c13-equipment-cluster` | Level up activation, level counters, and level-band P/T/keyword characteristics | Ready for integrator review |
| `rules-tap-untap` | `codex/c13-equipment-cluster` | Targeted Tap target creature and Untap target permanent effects | Ready for integrator review |
| `rules-mill` | `codex/c13-equipment-cluster` | Target player mills a bounded number of cards into their graveyard | Ready for integrator review |
| `rules-counter-restrictions` | `codex/c13-equipment-cluster` | Creature-spell and noncreature-spell counter target families | Ready for integrator review |
| `rules-plus-counters` | `codex/c13-equipment-cluster` | Put +1/+1 or -1/-1 counters on a target creature | Ready for integrator review |
| `rules-target-discard` | `codex/c13-equipment-cluster` | Target-player discard with an explicit hand-card choice | Ready for integrator review |
| `rules-life-gained` | `codex/c13-equipment-cluster` | Life-gained trigger event and source +1/+1/-1/-1 counter effect | Ready for integrator review |
| `rules-target-life` | `codex/c13-equipment-cluster` | Target-player life gain with event propagation | Ready for integrator review |
| `rules-each-life` | `codex/c13-equipment-cluster` | Living-player life gain with one event per recipient | Ready for integrator review |
| `rules-target-life-loss` | `codex/c13-equipment-cluster` | Target-player life loss, distinct from damage | Ready for integrator review |
| `rules-each-life-loss` | `codex/c13-equipment-cluster` | Living-player global life loss, distinct from damage | Ready for integrator review |
| `rules-self-life-loss` | `codex/c13-equipment-cluster` | Controller life loss, distinct from damage | Ready for integrator review |
| `rules-life-lost-trigger` | `codex/c13-equipment-cluster` | Life-lost event bus for effects and damage | Ready for integrator review |
| `rules-token-creation` | `codex/c13-equipment-cluster` | Token creation preserves tapped state for C13 token family | Ready for integrator review |
| `rules-graveyard-return` | `codex/c13-equipment-cluster` | Targeted creature-card return from own graveyard to hand | Ready for integrator review |
| `rules-combat-damage-any-creature` | `codex/c13-equipment-cluster` | Combat-damage trigger for any creature source | Ready for integrator review |
| `rules-token-scaling` | `codex/c13-equipment-cluster` | Token creation scaled by lands controlled | Ready for integrator review |
| `rules-subtype-counters` | `codex/c13-equipment-cluster` | Counters on all controlled creatures of a subtype | Ready for integrator review |
| `rules-graveyard-exile` | `codex/c13-equipment-cluster` | Exile a targeted card from own graveyard | Ready for integrator review |
| `rules-x-opponent-loss` | `codex/c13-equipment-cluster` | X-scaled life loss for each opponent | Ready for integrator review |
| `rules-x-draw` | `codex/c13-equipment-cluster` | X-scaled self draw effect | Ready for integrator review |
| `rules-each-opponent-mill` | `codex/c13-equipment-cluster` | Global mill for each opponent | Ready for integrator review |
| `rules-each-opponent-draw` | `codex/c13-equipment-cluster` | Global draw for each opponent | Ready for integrator review |
| `rules-graveyard-library-top` | `codex/c13-equipment-cluster` | Return own graveyard card to library top | Ready for integrator review |
| `rules-all-creature-counters` | `codex/c13-equipment-cluster` | Counters on all creatures controlled by the caster | Ready for integrator review |
| `rules-creature-spell-trigger` | `codex/c13-equipment-cluster` | Creature-spell filter for cast triggers | Ready for integrator review |
| `rules-x-discard` | `codex/c13-equipment-cluster` | X-scaled private discard choices | Ready for integrator review |
| `rules-graveyard-battlefield` | `codex/c13-equipment-cluster` | Return a creature card from own graveyard to battlefield | Ready for integrator review |
| `rules-artifact-graveyard-target` | `codex/c13-equipment-cluster` | Restrict artifact-card recovery to artifact cards | Ready for integrator review |
| `rules-land-graveyard-battlefield` | `codex/c13-equipment-cluster` | Put a land from any graveyard onto battlefield under caster control | Ready for integrator review |
| `rules-artifact-graveyard-battlefield` | `codex/c13-equipment-cluster` | Return an artifact from own graveyard to battlefield | Ready for integrator review |
| `rules-enchantment-graveyard-target` | `codex/c13-equipment-cluster` | Restrict enchantment-card recovery to enchantment cards | Ready for integrator review |
| `rules-temporary-keyword` | `codex/c13-equipment-cluster` | Temporary keyword grants on targeted creatures | Ready for integrator review |
| `rules-temporary-pt-keyword` | `codex/c13-equipment-cluster` | Combined temporary P/T and keyword grant | Ready for integrator review |

Workers must claim a disjoint primitive or card batch before editing. The
integrator owns merge order and reruns coverage after each accepted commit.

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
| `tools-primitive-roadmap` | `tools/rules/plan_primitive_roadmap.py` and its unit tests: rank Oracle primitives by cards actually finished | `codex-ready/c14-combat-restrictions` | ready to integrate | 2026-09-03 |
| `tools-parallel-workers` | `tools/rules/plan_primitive_workers.py`: assign disjoint primitives to bounded workers and split 20-card commit batches | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c14-combat-restrictions` | Printed can't attack / can't block / attacks each combat if able / can block only creatures with X | `codex-ready/c14-combat-restrictions` | ready to integrate | 2026-09-03 |
| `c14-landwalk` | Landwalk evasion for every basic land type plus legendary landwalk | `codex-ready/c14-combat-restrictions` | ready to integrate | 2026-09-03 |
| `c13-activated-pump` | Activated self-creature P/T bonuses through end of turn | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-unblockable` | Printed creature can't-be-blocked restriction | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-activated-sacrifice-creature` | Activated costs that sacrifice a creature, including “another” | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-activated-remove-counters` | Activated costs that remove counters from the source permanent | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-global-temporary-keyword` | Temporary keyword grants to all permanents controlled by the caster | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-life-equals-power` | Gain life equal to the current power of a targeted creature you control | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-compound-draw-life-loss` | Compound draw-and-life-loss effects used by upkeep triggers | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-damage-equal-hand` | Damage to a player equal to cards in that player's hand | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-static-haste-grant` | Static “creatures you control have haste” grants | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-draw-step-additional-card` | Draw-step triggers that draw an additional card for the active player | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-opponent-hand-minus-damage` | Opponent-upkeep damage equal to active player's hand count minus an offset | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-conditional-subtype-trigger` | Conditional triggers gated by controlling no permanent of a subtype | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-draw-tapped-creatures` | Draw a card for each tapped creature controlled by a targeted opponent | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-global-creature-keyword` | Temporary keyword grants to all creatures on the battlefield | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-life-gain-prevention` | Static prevention of all player life gain | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-no-maximum-hand-size` | Static removal of the cleanup maximum-hand-size discard | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-static-creature-pt-grant` | Static +P/+T bonuses for other creatures you control | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-destroy-power-toughness-loss` | Destroy a creature then make its controller lose its power plus toughness | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-variable-global-debuff` | X-scaled -X/-X effects affecting every creature | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-conditional-power-trigger` | Optional triggers gated by a controlled creature's power threshold | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-nonflying-global-damage` | X-scaled damage to nonflying creatures and each player | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-upkeep-draw-life-loss` | Upkeep draw-and-life-loss compound trigger wording | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-fear-evasion` | Fear keyword and black-or-artifact blocking restriction | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-equal-hand-upkeep-damage` | Opponent-upkeep damage equal to active player's hand size | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-counted-artifact-life` | Life gain multiplied by controlled artifacts | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-named-source-counters` | Named non-power counters placed on a triggered source | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-global-fear-test` | Scenario coverage for global fear grants | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-counted-life-types` | Reusable counted life gain for artifacts, creatures and enchantments | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-counted-creature-tokens` | Token creation scaled by controlled creature count | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-power-threshold-targets` | Legal target filtering for creatures with power five or greater | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-continuous-flying-targets` | Continuous flying grants respected by flying-target filters | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-other-creature-keyword-grants` | Static keyword grants excluding their source creature | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-fear-token-keywords` | Preserve fear when parsing generated token keywords | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-equal-hand-life-loss` | Life loss equal to each player's hand size | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-wheel-discard-draw` | Deterministic discard-hand then draw count effect | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-targeted-hand-discard` | Move a targeted player's full hand to graveyard | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-counted-target-life-loss` | Targeted life loss scaled by controlled type count | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-mill-each-player` | Mill a fixed or X amount from every library | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-player-only-global-damage` | Damage every player without affecting permanents | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-counted-land-life` | Count controlled lands in scalable life gain | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-life-per-permanent` | Life gain scaled by all controlled permanents | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-draw-controlled-type` | Draw one card per controlled creature, artifact, enchantment or land | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-counted-any-target-damage` | Any-target damage scaled by a controlled type count | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-toughness-threshold-targets` | Creature targets filtered by toughness four or greater | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-low-power-targets` | Creature targets filtered by power four or less | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-low-toughness-targets` | Creature targets filtered by toughness four or less | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-defender-targets` | Creature targets filtered by enforced defender | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-deathtouch-targets` | Creature targets filtered by enforced deathtouch | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-lifelink-targets` | Creature targets filtered by enforced lifelink | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-menace-targets` | Creature targets filtered by enforced menace | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-haste-targets` | Creature targets filtered by enforced haste | `codex/c13-equipment-cluster` | active | 2026-09-04 |

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
