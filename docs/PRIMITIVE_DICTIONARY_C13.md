# Primitive dictionary

Generated from the current `packages/rules` parser/engine. This is a contributor index: it links common Oracle words to reusable code surfaces and does not replace the authoritative rules engine.

- Generated: `2026-09-04T20:36:23.734686+00:00`
- Scope: **C13**
- Exported profiles in scope: **341**; fully implemented: **206**
- Source of truth: `packages/rules/src/characteristics.ts`, `packages/rules/src/engine.ts`, and the engine export.

## Workflow

1. Search this dictionary by the common verb before adding a regex or card-name branch.
2. Reuse an existing field/handler and add structured operands for the new type, zone, target, quantity or choice.
3. Add a scenario test with the applicable Comprehensive Rules citation.
4. Regenerate the engine export and take the next unclaimed generated cluster.

## Code-grounded support

### sacrifice

Move a permanent from the battlefield to its controller's graveyard as a cost or effect.

**Parser / IR fields**
- ✅ `sacrificesSelf`
- ✅ `sacrificesCreature`
- ✅ `sacrificesCreatures`
- ✅ `sacrificesCreatureSubtype`
- ✅ `sacrificesPermanent`
- ✅ `sacrificesArtifact`
- ✅ `sacrificesLand`
**Reusable engine helpers**
- ✅ `matchesSacrificeCreatureCost`
- ✅ `matchesSacrificeType`
- ✅ `combinations`
- ✅ `activatableAbility`
- ✅ `applyActivate`
**Existing effect handlers**
- ✅ `sacrifice-source`
- ✅ `each-opponent-sacrifice-creature`
- ✅ `sacrifice-own-creature-then-draw`
- ✅ `target-player-sacrifice-attacking-creature`
**Wording families**
- Sacrifice ~
- Sacrifice a/an creature or permanent
- Sacrifice N creatures
- Each opponent sacrifices...
- Sacrifice as an additional cost
**Rule-engine note:** Keep cost and effect separate. A typed cost filters candidates; an effect resolves through the stack. N-creature costs require distinct candidates and atomic validation.

### search / library

Inspect a library and optionally move matching cards to a destination, then shuffle when the effect requires it.

**Parser / IR fields**
- ✅ `cyclingSearches`
- ⚠️ `search-library`
- ⚠️ `search-library-multi`
**Reusable engine helpers**
- ✅ `legalTargets`
- ✅ `applyChooseLibraryCard`
- ✅ `applyChooseMultiLibraryCard`
- ✅ `applyFinishLibrarySearch`
- ✅ `shuffle`
**Existing effect handlers**
- ✅ `search-library`
**Wording families**
- Search your library for a card
- Search your library for a basic land
- Landcycling
- Fetch-land activation
**Rule-engine note:** Preserve type, subtype, color and destination criteria. Never expose another player's library in a projection.

### exile

Move a card or permanent to the exile zone, with the source zone and return permission kept explicit.

**Parser / IR fields**
- ✅ `exilesGraveyardCard`
- ⚠️ `exileSourceAfterResolution`
- ⚠️ `returnExiledAtNextEndStep`
**Reusable engine helpers**
- ✅ `movePermanentToZone`
- ✅ `applyEffect`
- ⚠️ `pendingChoice`
**Existing effect handlers**
- ✅ `exile-target-permanent`
- ✅ `exile-all-attacking-creatures`
**Wording families**
- Exile target...
- Exile a card from your graveyard
- Exile another permanent then return it
- Exile source after resolution
**Rule-engine note:** Exile is a zone change, not merely a flag. Track owner/controller and delayed return conditions separately.

### return / graveyard

Move a card from a graveyard or exile to a specified destination with type and controller restrictions.

**Parser / IR fields**
- ⚠️ `return-to-hand`
- ⚠️ `return-to-battlefield`
- ⚠️ `returnExiledAtNextEndStep`
**Reusable engine helpers**
- ⚠️ `moveCardToZone`
- ✅ `movePermanentToZone`
- ✅ `legalTargets`
**Existing effect handlers**
- ✅ `return-target-permanent`
**Wording families**
- Return target card from your graveyard
- Return that card to the battlefield
- Return to its owner's hand
**Rule-engine note:** The destination, owner/controller, target zone and timing are independent operands; do not collapse them into a generic return.

### draw / discard

Change hand contents while preserving the acting player and event metadata.

**Parser / IR fields**
- ✅ `discardsCard`
- ✅ `draw`
- ⚠️ `draw-if-life-more-than-opponent`
**Reusable engine helpers**
- ✅ `drawCards`
- ✅ `raiseEvent`
- ✅ `applyEffect`
**Existing effect handlers**
- ✅ `draw`
- ✅ `draw-active-player`
- ✅ `draw-if-life-more-than-opponent`
**Wording families**
- Draw N cards
- That player draws
- Discard a card as a cost
- Discard at random
**Rule-engine note:** 'Discard' can be a cost or an effect. Keep the selected card ID in the intent and resolve the discard on the server.

### counter

Add, remove or inspect public counters, including counters used as costs.

**Parser / IR fields**
- ✅ `removeCounters`
- ✅ `entersWithCounters`
- ⚠️ `counterModification`
**Reusable engine helpers**
- ✅ `withPlayer`
- ✅ `applyEffect`
- ⚠️ `stateBasedActions`
**Existing effect handlers**
- ✅ `add-counter-source`
**Wording families**
- Put a +1/+1 counter
- Remove a counter from ~
- Proliferate
- Enters with counters
**Rule-engine note:** Normalize counter names, validate availability before payment, and keep counter changes separate from P/T layer calculation.

### damage / life

Apply damage or life changes and raise the corresponding events for replacement and triggered abilities.

**Parser / IR fields**
- ✅ `preventsLifeGain`
- ✅ `additionalLifeCost`
- ⚠️ `damage-prevention`
**Reusable engine helpers**
- ⚠️ `dealDamage`
- ⚠️ `gainLife`
- ✅ `loseLife`
- ✅ `raiseEvent`
**Existing effect handlers**
- ✅ `damage-any-target`
- ✅ `damage-event-player`
- ✅ `gain-life`
- ✅ `gain-life-equal-target-power`
- ✅ `lose-life`
- ✅ `lose-life-event-player`
**Wording families**
- Deal N damage
- Gain N life
- Lose N life
- Gain life equal to power
- That player loses life
**Rule-engine note:** Resolve the event's player separately from the ability controller; this matters for 'that player' wording.

### create / token

Create a token with explicit name, colors, types, stats and keywords.

**Parser / IR fields**
- ⚠️ `create-token`
- ✅ `token`
**Reusable engine helpers**
- ⚠️ `createToken`
- ✅ `applyEffect`
- ⚠️ `stateBasedActions`
**Existing effect handlers**
- ✅ `create-token`
**Wording families**
- Create a N/N token
- Create tokens equal to...
- Token enters with...
**Rule-engine note:** Tokens need stable instance IDs and visible names in the client; their rules identity is their generated characteristics, not a card name lookup.

### trigger / ETB

Queue a triggered ability from an event, then choose targets and optional choices at the correct time.

**Parser / IR fields**
- ✅ `triggers`
- ✅ `targetKind`
- ✅ `optional`
- ✅ `condition`
**Reusable engine helpers**
- ✅ `raiseEvent`
- ✅ `putNextTriggerOnStack`
- ✅ `openMultiTriggerTargetChoice`
- ✅ `applyFinishTriggerTargets`
**Existing effect handlers**
- ✅ `compound`
- ✅ `modify-source-creature`
- ✅ `gain-life-equal-target-power`
- ✅ `destroy-target-permanent`
**Wording families**
- When ~ enters
- Whenever a creature dies
- At the beginning of your end step
- You may...
**Rule-engine note:** ETB is not an automatic side effect. It is an event, an APNAP-ordered trigger, a target choice and a stack object.

### activated ability / mana

Pay a structured cost, announce targets and put a non-mana ability on the stack; mana abilities resolve immediately.

**Parser / IR fields**
- ✅ `manaAbilities`
- ✅ `activatedAbilities`
- ✅ `manaCost`
- ✅ `requiresTap`
- ✅ `lifeCost`
**Reusable engine helpers**
- ✅ `activatableAbility`
- ✅ `legalActions`
- ✅ `applyActivate`
- ✅ `applyActivateMana`
- ✅ `planManaPayment`
**Existing effect handlers**
- ✅ `attach-equipment`
- ✅ `untap-source`
- ✅ `modify-source-creature`
- ✅ `search-library`
**Wording families**
- {cost}: effect
- {T}: Add mana
- Pay life: effect
- Sacrifice a...: effect
**Rule-engine note:** Use the same legality function for offered actions and forged intents. A cost is paid before the ability resolves and cannot leak hidden choices.

## Mass review: C13 one-line queue

The engine export currently marks **206/341** profiles complete; **58** unfinished cards have exactly one unmatched line.
These are generated candidates, not automatic approvals: claim the suggested cluster, inspect the exact Oracle text, add a scenario, then regenerate the export.

| Suggested claim | Cards | Remaining line template |
| --- | ---: | --- |
| `c13-cost-exile-creature-cards` | 1 | {cost}, exile <n> creature cards from <n> single graveyard: create <n> <n>/<n> green saproling creature token — Night Soil |
| `c13-cost-sacrifice-creature-you` | 1 | {cost}, sacrifice <n> creature: you gain life equal to the sacrificed creature's toughness — Disciple of Griselbrand |
| `c13-creatures-can-attack-you` | 1 | creatures can't attack you unless their controller pays {cost} for each creature they control that's attacking you — Propaganda |
| `c13-forecast-cost-reveal-from` | 1 | forecast - {cost}, reveal ~ from your hand: each player draws <n> card — Skyscribing |
| `c13-graft` | 1 | graft <n> — Llanowar Reborn |
| `c13-horsemanship` | 1 | horsemanship — Lu Xun, Scholar General |
| `c13-landfall-whenever-land-you` | 1 | landfall - whenever <n> land you control enters, you may gain <n> life — Grazing Gladehart |
| `c13-return-all-permanents-the` | 1 | return all permanents of the color of your choice to their owners' hands — Wash Out |
| `c13-the-beginning-your-end` | 1 | at the beginning of your end step, you may gain life equal to the power of target creature you control — Wall of Reverence |
| `unclaimed` | 1 | {cost}, sacrifice <n> goats: add <n> mana of any <n> color. you gain <n> life — Springjack Pasture |
| `unclaimed` | 1 | {cost}, sacrifice <n> nontoken artifact: create <n> <n>/<n> blue thopter artifact creature token with flying — Thopter Foundry |
| `unclaimed` | 1 | {cost}, sacrifice ~: destroy up to <n> target nonblack creatures, where <n> is the number of verse counters on ~ — Vile Requiem |
| `unclaimed` | 1 | {cost}, sacrifice ~: it deals <n> damage to each attacking creature without flying — Leonin Bladetrap |
| `unclaimed` | 1 | {cost}, {cost}, sacrifice ~: search your library for up to <n> basic land cards, reveal them, put them into your hand, then shuffle — Armillary Sphere |
| `unclaimed` | 1 | {cost}, {cost}: add <n> mana of any color in your commander's color identity. if you spend this mana to cast your commander, it enters with <n> number of additional +<n>/+<n> counters on it equal to the number of times it's been cast from the command zone this game — Opal Palace |
| `unclaimed` | 1 | {cost}, {cost}: each player discards their hand, then draws cards equal to the greatest number of cards <n> player discarded this way — Jace's Archivist |
| `unclaimed` | 1 | {cost}, {cost}: target beast creature you control fights target creature <n> opponent controls — Contested Cliffs |
| `unclaimed` | 1 | {cost}: creatures you control gain shroud until end of turn — Aerie Mystics |
| `unclaimed` | 1 | {cost}: destroy target artifact or creature with mana value <n> — Deepfire Elemental |
| `unclaimed` | 1 | {cost}: each player gains control of all creatures they own — Homeward Path |
| `unclaimed` | 1 | {cost}: target creature with power <n> or greater gains first strike until end of turn — Rakeclaw Gargantuan |
| `unclaimed` | 1 | {cost}: this turn, creatures can't block unless their controller pays {cost} for each blocking creature they control — War Cadence |
| `unclaimed` | 1 | {cost}: whenever you gain life this turn, each opponent loses that much life — Vizkopa Guildmage |
| `unclaimed` | 1 | {cost}: ~ becomes <n> <n>/<n> white and blue bird artifact creature with flying until end of turn — Azorius Keyrune |
| `unclaimed` | 1 | ~ can't be blocked as long as defending player controls the most creatures or is tied for the most — Hooded Horror |
| `unclaimed` | 1 | ~ gets +<n>/+<n> as long as you have <n> or more life — Divinity of Pride |
| `unclaimed` | 1 | ~ gets +<n>/+<n> for each creature card in your opponents' graveyards — Wight of Precinct Six |
| `c13-untap-all-green-and` | 1 | untap all green and/or blue creatures you control during each other player's untap step — Murkfiend Liege |
| `c13-until-end-turn-creatures` | 1 | until end of turn, creatures target player controls lose all abilities and have base power and toughness <n>/<n> — Sudden Spoiling |
| `c13-when-enters-destroy-all` | 1 | when ~ enters, destroy all artifacts and enchantments. put <n> +<n>/+<n> counter on ~ for each permanent destroyed this way — Bane of Progress |
| `c13-when-enters-exile-another` | 1 | when ~ enters, exile another target permanent. return that card to the battlefield under its owner's control at the beginning of the next end step — Flickerwisp |
| `c13-when-enters-return-target` | 1 | when ~ enters, return target artifact card from your graveyard to your hand. you gain life equal to that card's mana value — Razor Hippogriff |
| `c13-when-enters-return-target-2` | 1 | when ~ enters, return target creature card from your graveyard to the battlefield. you lose life equal to that card's mana value — Phyrexian Delver |
| `c13-when-enters-sacrifice-unless` | 1 | when ~ enters, sacrifice it unless {cost} was spent to cast it — Azorius Herald |
| `c13-when-enters-tap-target` | 1 | when ~ enters, tap target creature <n> opponent controls. that creature doesn't untap during its controller's untap step for as long as you control ~ — Dungeon Geists |
| `c13-when-enters-target-opponent` | 1 | when ~ enters, target opponent creates <n> <n>/<n> blue faerie creature tokens with flying — Hunted Troll |
| `c13-when-enters-you-may` | 1 | when ~ enters, you may return target instant or sorcery card from your graveyard to your hand — Mnemonic Wall |
| `c13-when-sharuum-enters-you` | 1 | when sharuum enters, you may return target artifact card from your graveyard to the battlefield — Sharuum the Hegemon |
| `c13-when-you-cast-create` | 1 | when you cast ~, create <n> <n>/<n> red kobold creature tokens named kobolds of kher keep, where <n> is the amount of mana spent to cast it — Prossh, Skyraider of Kher |
| `c13-when-you-cycle-you` | 1 | when you cycle ~, you may have it deal <n> damage to each creature — Slice and Dice |
| `c13-when-you-cycle-you-2` | 1 | when you cycle ~, you may have target creature gain fear until end of turn — Dirge of Dread |
| `c13-whenever-another-creature-you` | 1 | whenever another creature you control dies, it deals damage equal to its power to target player or planeswalker — Stalking Vengeance |
| `c13-whenever-another-nontoken-creature` | 1 | whenever another nontoken creature you control dies, create <n> <n>/<n> black and red graveborn creature token with haste — Sek'Kuar, Deathkeeper |
| `c13-whenever-attacks-gets-until` | 1 | whenever ~ attacks, it gets +<n>/+<n> until end of turn, where <n> is the number of lands defending player controls — Terra Ravager |
| `c13-whenever-attacks-you-may` | 1 | whenever ~ attacks, you may tap <n> untapped myr you control. if you do, ~ gets +<n>/+<n> until end of turn and deals <n> damage to the player or planeswalker it's attacking — Myr Battlesphere |
| `c13-whenever-blocks-exchange-its` | 1 | whenever ~ blocks, exchange its power and the power of target creature it's blocking until end of combat — Serene Master |
| `c13-whenever-creature-dies-untap` | 1 | whenever <n> creature dies, untap ~ — Goblin Sharpshooter |
| `c13-whenever-creature-you-control` | 1 | whenever <n> creature you control enters, it deals damage equal to its power to any target — Warstorm Surge |
| `c13-whenever-creature-you-control-2` | 1 | whenever <n> creature you control with power <n> or greater enters, you may have ~ deal <n> damage to any target — Where Ancients Tread |
| `c13-whenever-deals-combat-damage` | 1 | whenever ~ deals combat damage to <n> player, you and that player each draw that many cards — Diviner Spirit |
| `c13-whenever-deals-combat-damage-2` | 1 | whenever ~ deals combat damage to <n> player, you may return to your hand all creature cards that were put into your graveyard from the battlefield this turn — Fell Shepherd |
| `c13-whenever-enters-attacks-deals` | 1 | whenever ~ enters or attacks, it deals <n> damage divided as you choose among <n>, <n>, or <n> targets — Inferno Titan |
| `c13-whenever-player-draws-card` | 1 | whenever <n> player draws <n> card, ~ deals <n> damage to that player — Spiteful Visions |
| `c13-whenever-spell-ability-causes` | 1 | whenever <n> spell or ability causes its controller to shuffle their library, that player puts <n> card from their hand on top of their library — Widespread Panic |
| `c13-whenever-you-cast-instant` | 1 | whenever you cast <n> instant or sorcery spell, you may pay {cost}. if you do, copy that spell. you may choose new targets for the copy — Mirari |
| `c13-whenever-you-gain-life` | 1 | whenever you gain life, target opponent loses that much life — Sanguine Bond |
| `c13-whenever-you-gain-life-2` | 1 | whenever you gain life, you may pay {cost}, where <n> is less than or equal to the amount of life you gained. if you do, draw <n> cards — Well of Lost Dreams |
| `c13-whenever-you-gain-life-3` | 1 | whenever you gain life, you may pay {cost}. if you do, put <n> +<n>/+<n> counter on target creature for each <n> life you gained — Cradle of Vitality |

The highest-value fix is the shared template, not the first card name. A new primitive should parameterize type, zone, target, quantity and optionality so reprints and other sets inherit it.

