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
| `rules-c13-reprint-equivalence` | Verify C13 reprints reuse existing oracle-driven rules for Command Tower and Decree of Pain; track Army of the Damned's Flashback gap | `codex/c13-equipment-cluster` | merged (`44d0e78`) | 2026-09-04 |
| `rules-flashback` | Flashback alternative-cost casting, graveyard action visibility, and exile replacement | `codex/c13-equipment-cluster` | merged (`44d0e78`) | 2026-09-04 |
| `rules-flashback-life-cost` | Parse and pay life bundled into Flashback alternative costs, including C13 Deep Analysis | `feat/activated-abilities-and-triggers` | merged (`2b856c6`) | 2026-09-04 |
| `rules-c13-multi-basic-search` | Multi-card basic-land searches with ordered destinations for Cultivate, Armillary Sphere, and Burnished Hart | `codex/c13-equipment-cluster` | merged (`a4883df`) | 2026-09-04 |
| `rules-c13-self-shuffle` | Self-shuffling spell resolution and life-gain/+1/+1 trigger reuse, including Blue Sun's Zenith | `codex/c13-equipment-cluster` | merged (`3f6c2ec`) | 2026-09-04 |
| `c13-hua-tuo-graveyard-top` | Hua Tuo's tapped activation: put a target creature card from your graveyard on top of your library | `feat/activated-abilities-and-triggers` | merged (`f65d252`) | 2026-09-04 |
| `c13-global-spell-cost-reduction` | Global instant/sorcery spell cost reductions, including Arcane Melee; reusable for equivalent Oracle text | `feat/activated-abilities-and-triggers` | merged (`01a1a07`) | 2026-09-04 |
| `rules-c13-scry` | Scry N private ordered choices, including chained draw and ETB resolution | `codex/c13-equipment-cluster` | merged (`94eb93d`) | 2026-09-04 |
| `rules-c13-landfall-pump` | Triggered source self-pump (`~ gets +N/+N`, optional keyword) with reusable source identity | `codex/c13-equipment-cluster` | merged (`285a34c`) | 2026-09-04 |
| `c13-attack-limit` | Static defender-side limit on the number of creatures that can attack a player each combat; Crawlspace | `feat/activated-abilities-and-triggers` | merged (`9ee30ae`) | 2026-09-04 |
| `c13-basalt-untap` | Activated self-untap plus static no-untap-during-untap rule, including Basalt Monolith | `codex/c13-equipment-cluster` | merged (`e587d1d`) | 2026-09-04 |
| `c13-reuse-basic-effects` | Reuse draw-per-tapped-creature, typed sacrifice damage/draw, and upkeep compound triggers for four C13 cards | `codex/c13-equipment-cluster` | merged (`8474a06`) | 2026-09-04 |
| `c13-typed-tap-cost` | Reusable `Tap an untapped [subtype] you control` activation costs with `any`/`another` selection and server validation; Azami | `codex/c13-equipment-cluster` | merged (`c50a721`) | 2026-09-04 |
| `c13-druidic-satchel-top-reveal` | Reveal-top-card conditional: create a Saproling for creatures, put lands onto the battlefield, otherwise gain life | `feat/activated-abilities-and-triggers` | merged (`abd93f1`) | 2026-09-04 |
| `c13-etb-sacrifice-unless-pay` | ETB trigger that sacrifices its source unless its controller pays a fixed mana cost | `feat/activated-abilities-and-triggers` | merged (`51435d3`) | 2026-09-04 |
| `c13-draw-and-draw-life-reuse` | Reuse draw-only and draw/life compound primitives for Brilliant Plan, Harmonize, Vision Skeins, Deep Analysis and Phyrexian Gargantua | `feat/activated-abilities-and-triggers` | merged (`761c675`) | 2026-09-04 |
| `c13-baleful-strix-etb` | Baleful Strix ETB draw plus flying/deathtouch through existing primitives | `feat/activated-abilities-and-triggers` | merged (`5b397e8`) | 2026-09-04 |
| `c13-annihilate-destroy-draw` | Annihilate typed nonblack-creature removal followed by draw, with target legality scenarios | `feat/activated-abilities-and-triggers` | merged (`8d6c17b`) | 2026-09-04 |
| `c13-storage-mana` | Molten Slagheap and Saltcrusted Steppe storage counters: variable B/R or G/W output after paying {1} | `feat/activated-abilities-and-triggers` | active | 2026-09-04 |
| `c13-additional-life-cost` | Parse and pay spell additional life costs, starting with Toxic Deluge; reusable independently of the spell effect | `feat/activated-abilities-and-triggers` | merged (`704f234`) | 2026-09-04 |
| `c13-delayed-draw-choice` | Arcane Denial's delayed upkeep draws with private 0..N choice, deterministic bot selection and library clamping | `feat/activated-abilities-and-triggers` | merged (`a439b56`) | 2026-09-04 |
| `c13-graveyard-exile-etb` | ETB exile all graveyards for Angel of Finality and Bojuka Bog, reusing zone-exile primitives | `feat/activated-abilities-and-triggers` | merged (`054e82a`) | 2026-09-04 |
| `c13-split-second` | Enforce Split second's prohibition on non-mana spells and activated abilities while the spell is on the stack | `feat/activated-abilities-and-triggers` | merged (pending commit) | 2026-09-04 |
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
| `c14-destroy-permanent-and-self-bounce` | plain `Destroy target permanent`; `Return a creature you control to its owner's hand` | `c14-batch2-clean` | ready (`d3dae63`) | 2026-09-04 |
| `c14-board-cost-reduction` | `~ costs {N} less to cast for each creature on the battlefield` (negative additionalGeneric) | `c14-batch2-clean` | ready (`8def468`) | 2026-09-04 |
| `c14-medallion-cost-reduction` | `<color/type> spells you cast cost {N} less to cast` static grant | `c14-batch2-clean` | ready (`5a6b506`) | 2026-09-04 |
| `c14-graveyard-self-return` | `When ~ is put into a graveyard from the battlefield, return it to its owner's hand`; `You draw N cards and you lose N life` | `c14-batch2-clean` | ready (`ccc5268`) | 2026-09-04 |
| `c14-tapped-wipe-and-commander-mana` | `Destroy all tapped creatures`; `Add N mana of any color in your commander's color identity` | `c14-batch2-clean` | ready (`727fe47`) | 2026-09-04 |
| `c14-evoke` | Evoke alternative cost + kicked-style sacrifice trigger (CR 702.34) | `c14-batch2-clean` | ready (`95c912c`) | 2026-09-04 |
| `c14-extort` | Extort keyword synthesised as a spell-cast optional-pay drain trigger (CR 702.39) | `c14-batch2-clean` | ready (`4992925`) | 2026-09-04 |
| `c14-static-land-mana-bonus` | `<Basic type>s you control produce an additional {C}` / tap-for-mana wording | `c14-batch2-clean` | ready (`fa44b87`) | 2026-09-04 |
| `c14-planeswalker-loyalty` | Planeswalker loyalty counters, sorcery-speed loyalty abilities, 0-loyalty SBA; `draw a card for each <color> creature` | `c14-batch2-clean` | ready (`d98a87f`) | 2026-09-04 |
| `c14-enters-or-dies-and-leaves` | `When ~ enters or is put into a graveyard from the battlefield, X` (two triggers); `leaves the battlefield` aliased to the dies event | `c14-batch2-clean` | active | 2026-09-04 |
| `c14-target-cant-block` | `Target creature can't block this turn` (per-permanent flag cleared in cleanup) | `c14-batch2-clean` | active | 2026-09-04 |
| `c14-storm-attacker-sacrifice` | Consume Storm keyword text and resolve `Target player sacrifices an attacking creature of their choice` | `c14-batch2-clean` | merged (`893730c`) | 2026-09-04 |
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
| `c13-cross-graveyard-targets` | Exile or return cards from any graveyard with reusable creature, artifact, enchantment, and land filters | `codex/c13-equipment-cluster` | merged (local `5bd0bff`) | 2026-09-04 |
| `c13-artifact-etb-trigger-subject` | Trigger subjects for artifacts entering under your control | `codex/c13-equipment-cluster` | merged (source `295e798`) | 2026-09-04 |
| `c13-enchantment-etb-trigger-subject` | Trigger subjects for enchantments entering under your control | `codex/c13-equipment-cluster` | merged (local `25a5bbf`) | 2026-09-04 |
| `rules-python-sacrifice-operands` | Preserve typed sacrifice operands and reusable primitive clusters in the Oracle compiler | `codex/c13-equipment-cluster` | merged (local `89e25d2`) | 2026-09-04 |
| `c13-activated-sacrifice-artifact` | Activated costs that sacrifice an artifact, including “another” | `codex/c13-equipment-cluster` | merged (local `e1a0518`) | 2026-09-04 |
| `c13-activated-sacrifice-enchantment` | Activated costs that sacrifice an enchantment, including “another” | `codex/c13-equipment-cluster` | merged (local `e1a0518`) | 2026-09-04 |
| `c13-activated-sacrifice-land` | Activated costs that sacrifice a land, including “another” | `codex/c13-equipment-cluster` | merged (local `e1a0518`) | 2026-09-04 |
| `c13-activated-sacrifice-noncreature` | Activated costs that sacrifice any noncreature permanent | `codex/c13-equipment-cluster` | merged (local `98df4aa`) | 2026-09-04 |
| `c13-activated-discard-cost` | Activated costs that discard one card from the controller’s hand | `codex/c13-equipment-cluster` | merged (local `bea78a5`) | 2026-09-04 |
| `rules-python-cost-actions` | Preserve reusable activated-cost actions (`discard`, `exile`, `sacrifice`) in Oracle IR clusters | `codex/c13-equipment-cluster` | merged (local `2ccfbed`) | 2026-09-04 |
| `c13-each-player-spell-trigger` | Triggered abilities that watch any player cast a spell | `codex/c13-equipment-cluster` | merged (local `a40b295`) | 2026-09-04 |
| `c13-trigger-subject-clusters` | Reuse generic permanent ETB subjects instead of rediscovering them per card | `feat/activated-abilities-and-triggers` | merged (local `df3db32`) | 2026-09-04 |
| `c13-generic-permanent-sacrifice-cost` | Activated costs that sacrifice any permanent, with server-side legal choice validation | `codex/c13-equipment-cluster` | merged (local `f821ede`) | 2026-09-04 |
| `c13-graveyard-permanent-return` | Return a permanent card from your or any graveyard to the battlefield | `codex/c13-equipment-cluster` | merged (local `eaa7159`) | 2026-09-04 |
| `c13-graveyard-permanent-exile` | Exile a permanent card from any graveyard with privacy-safe target filtering | `codex/c13-equipment-cluster` | merged (local `e38277a`) | 2026-09-04 |
| `c14-kicker` | Kicker/Multikicker cost (CR 702.33): kicked cast action, kicked-only effects and enters triggers | `c14-batch2-clean` | merged (`02b40ed`) | 2026-09-04 |
| `c14-optional-pay-trigger` | `you may pay {cost}. If you do, X` optional-cost trigger effects | `c14-batch2-clean` | merged (`02b40ed`) | 2026-09-04 |
| `c14-draw-then-discard` | `Draw N, then discard M` effect (spell + activated) + bot discard-cards policy | `c14-batch2-clean` | merged (`02b40ed`) | 2026-09-04 |
| `c14-self-zone` | `Exile ~` / `Shuffle ~ into its owner's library` spell self-destination; graveyard `another target` + nonland-permanent bounce | `c14-batch2-clean` | merged (`02b40ed`) | 2026-09-04 |
| `bot-fear-block` | Bot chooseBlockers respects fear (CR 702.36b) | `c14-batch2-clean` | merged (`8f095af`) | 2026-09-04 |
| `rules-python-sacrifice-operands` | Preserve typed sacrifice operands and reusable primitive clusters in the Oracle compiler | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `rules-python-trigger-subjects` | Preserve reusable trigger subjects such as permanent-you-control in the Oracle compiler | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `rules-python-activated-cost-operands` | Preserve reusable discard, exile, and sacrifice cost operands for activated-ability batches | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `rules-python-graveyard-return-operands` | Preserve permanent-card graveyard return destinations for compiler clusters | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `tools-primitive-roadmap` | `tools/rules/plan_primitive_roadmap.py` and its unit tests: rank Oracle primitives by cards actually finished | `codex-ready/c14-combat-restrictions` | ready to integrate | 2026-09-03 |
| `tools-parallel-workers` | `tools/rules/plan_primitive_workers.py`: assign disjoint primitives to bounded workers and split 20-card commit batches | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c14-combat-restrictions` | Printed can't attack / can't block / attacks each combat if able / can block only creatures with X | `codex-ready/c14-combat-restrictions` | ready to integrate | 2026-09-03 |
| `c14-landwalk` | Landwalk evasion for every basic land type plus legendary landwalk | `codex-ready/c14-combat-restrictions` | ready to integrate | 2026-09-03 |
| `c13-activated-pump` | Activated self-creature P/T bonuses through end of turn | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-unblockable` | Printed creature can't-be-blocked restriction | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-activated-sacrifice-creature` | Activated costs that sacrifice a creature, including “another” | `codex/c13-equipment-cluster` | active | 2026-09-03 |
| `c13-activated-sacrifice-artifact` | Activated costs that sacrifice an artifact, including “another” (CR 117.3b, 602.2b) | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-activated-sacrifice-enchantment` | Activated costs that sacrifice an enchantment, including “another” (CR 117.3b, 602.2b) | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-activated-sacrifice-land` | Activated costs that sacrifice a land, including “another” (CR 117.3b, 602.2b) | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-activated-sacrifice-noncreature` | Activated costs that sacrifice any noncreature permanent (CR 117.3b, 602.2b) | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-activated-sacrifice-permanent` | Activated costs that sacrifice a permanent, including “another” (CR 117.3b, 602.2b) | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-activated-discard-cost` | Activated costs that discard one card from the controller’s hand (CR 117.3b, 602.2b) | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-activated-sacrifice-token` | Activated costs that sacrifice a token permanent (CR 117.3b, 602.2b) | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-activated-exile-graveyard-cost` | Activated costs that exile one card from the controller’s graveyard (CR 117.3b, 602.2b) | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-graveyard-to-library-bottom` | Return a targeted card from your graveyard to the bottom of your library (CR 400.7, 701.19) | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-graveyard-shuffle-into-library` | Shuffle a targeted card from your graveyard into your library (CR 400.7, 701.20) | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-return-permanent-card-to-battlefield` | Return a targeted permanent card from your graveyard to the battlefield (CR 400.7, 603.3) | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-return-permanent-card-from-any-graveyard` | Return a targeted permanent card from any graveyard to the battlefield (CR 400.7, 603.3) | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-exile-permanent-card-from-graveyard` | Exile a targeted permanent card from your graveyard (CR 400.7, 701.11) | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-exile-permanent-card-from-any-graveyard` | Exile a targeted permanent card from any graveyard (CR 400.7, 701.11) | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `arsenal-loyal-retainers` | Loyal Retainers: precombat activated sacrifice and legendary-creature graveyard return (CR 602.2b, 608.2b) | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `arsenal-miraris-wake-pt` | Mirari’s Wake static +1/+1 grant to creatures you control (CR 613.4, 613.5) | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `arsenal-miraris-wake-mana` | Mirari’s Wake adds one mana of a produced type when a controlled land produces mana (CR 605.1, 613.6) | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `arsenal-command-tower` | Command Tower produces mana restricted to the commander’s color identity (CR 903.5d, 106.1) | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `arsenal-chaos-warp` | Chaos Warp shuffles a target permanent into its owner’s library and conditionally puts the revealed top card onto the battlefield (CR 701.20, 701.34) | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `arsenal-decree-of-pain` | Decree of Pain destroys all creatures/draws for creatures destroyed and its cycling -2/-2 trigger (CR 603.2, 608.2c, 701.7, 702.29) | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `arsenal-desertion` | Desertion counters a spell and puts an artifact or creature spell onto the battlefield under its controller’s control | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `arsenal-maelstrom-haste` | Reuse the static “creatures you control have haste” primitive for Maelstrom Wanderer; cascade remains separate | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `arsenal-vela-intimidate` | Intimidate keyword/static grants plus Vela’s leaves-the-battlefield trigger (CR 603.6c, 702.13, 509.1a) | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-each-player-spell-trigger` | Triggered abilities that watch any player cast a spell (CR 603.2, 603.3) | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-permanent-etb-trigger-subject` | ETB triggers for any permanent entering under the controller’s control (CR 603.2) | `codex/c13-equipment-cluster` | active | 2026-09-04 |
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
| `c13-first-strike-targets` | Creature targets filtered by enforced first strike | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-double-strike-targets` | Creature targets filtered by enforced double strike | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-trample-targets` | Creature targets filtered by enforced trample | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-vigilance-targets` | Creature targets filtered by enforced vigilance | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-indestructible-targets` | Creature targets filtered by enforced indestructible | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-hexproof-targets` | Creature targets filtered by enforced hexproof and ownership | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-shroud-targets` | Shroud target prohibition kept in target filtering | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-reach-targets` | Creature targets filtered by enforced reach | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-flying-only-sweeper` | Damage effects restricted to creatures with flying | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-static-keyword-gain-verb` | Alternate gain wording for static keyword grants | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-global-static-keywords` | Static keyword grants affecting every creature | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-global-static-pt` | Global static power/toughness layer bonuses | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-global-static-pt-dedup` | Prevent duplicate application of global static bonuses | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-counted-planeswalkers` | Planeswalkers accepted by controlled-type scaling | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-counted-battles` | Battles accepted by controlled-type scaling | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-return-artifact-to-hand` | Return target artifact permanents to their owners' hands | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-return-enchantment-to-hand` | Return target enchantment permanents to their owners' hands | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-return-enchantment-from-graveyard` | Return target enchantment card from graveyard to battlefield | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-exile-card-from-any-graveyard` | Exile target card from any graveyard | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-return-card-from-any-graveyard` | Return target card from any graveyard to its owner's hand | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-exile-creature-from-any-graveyard` | Exile target creature card from any graveyard | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-exile-artifact-from-any-graveyard` | Exile target artifact card from any graveyard | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-exile-enchantment-from-any-graveyard` | Exile target enchantment card from any graveyard | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-exile-land-from-any-graveyard` | Exile target land card from any graveyard | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-artifact-etb-trigger-subject` | Trigger subjects for artifacts entering under your control | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-enchantment-etb-trigger-subject` | Trigger subjects for enchantments entering under your control | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-storage-counter-mana-output` | Consume variable storage-counter mana lines already executed by the mana engine (Saltcrusted Steppe, Molten Slagheap; CR 605.1a) | `feat/activated-abilities-and-triggers` | active | 2026-09-04 |
| `c13-reveal-top-gain-mana-value` | Augury Adept top-card reveal, move to hand and mana-value life gain | `codex/c13-augury-adept` | active | 2026-09-04 |
| `c13-reveal-until-creature` | Foster reveal until a creature, move it to hand and revealed cards to graveyard | `codex/c13-foster` | active | 2026-09-04 |
| `c13-threshold-graveyard-return` | Stitch Together threshold branch between battlefield and hand | `codex/c13-stitch-together` | active | 2026-09-04 |
| `c13-choose-both` | Soul Manipulation and Fissure Vent modal one-or-both selection | `codex/c13-choose-both` | active | 2026-09-04 |

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
| `arsenal-edric-combat-draw` | Edric draws optionally when a creature deals combat damage to one of his opponents (CR 603.2, 603.5, 120.3) | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `arsenal-minds-eye` | Mind's Eye watches opponent card draws and supports optional payment of {1} before drawing (CR 603.2, 603.5, 121.1) | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `arsenal-duplicant-etb-imprint` | Duplicant optionally exiles a target nontoken creature on ETB and copies its power/toughness through last-known imprint (CR 603.2, 603.5, 607.2, 707.2) | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `arsenal-rhystic-study` | Rhystic Study asks the exact spell caster to pay {1}; if they decline, its controller draws a card, with no pay action exposed when the cost is unaffordable (CR 603.2, 603.5, 117.1, 121.1) | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-boros-charm-modal-self-reference` | Boros Charm's three modes plus normalization of printed card-name self references (CR 601.2b, 700.2) | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `azorius-charm-library-top` | Azorius Charm's creature-to-owner-library-top mode, draw mode, and controlled-creature pump mode; shared card primitive (CR 601.2b, 701.18) | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-naya-charm-modal` | Naya Charm's three modes, including damage to a creature and tapping all creatures controlled by a target player (CR 601.2b, 609.3, 701.21) | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-gahiji-attack-buff` | Gahiji's attack trigger buffs the attacking creature only when it attacks one of its controller's opponents (CR 603.2, 508.1i, 613.4) | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-guttersnipe-spell-trigger` | Guttersnipe triggers from your instant/sorcery casts and deals 2 damage to each opponent (CR 603.2, 603.5, 608.2c) | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-fecundity-death-draw` | Fecundity lets the controller of each creature that dies optionally draw a card (CR 603.2, 603.5, 603.6a, 121.1) | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-fires-yavimaya-activation` | Fires of Yavimaya grants haste and sacrifices itself for a controlled-creature +2/+2 activation (CR 602.2b, 613.4, 611.3) | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-goblin-bombardment-activation` | Goblin Bombardment sacrifices a creature as a cost to deal 1 damage to any target (CR 602.2b, 117.1) | `codex/c13-equipment-cluster` | active | 2026-09-04 |
| `c13-tidal-force-tap-untap-choice` | Optional each-upkeep choice to tap or untap a target permanent for Tidal Force (CR 603.2, 603.5, 701.21) | `codex/c13-tidal-force` | active | 2026-09-04 |
