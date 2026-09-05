# Primitive dictionary

Generated from the current `packages/rules` parser/engine. This is a contributor index: it links common Oracle words to reusable code surfaces and does not replace the authoritative rules engine.

- Generated: `2026-09-05T06:43:45.556304+00:00`
- Scope: **C13**
- Exported profiles in scope: **341**; fully implemented: **263**
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

The engine export currently marks **263/341** profiles complete; **9** unfinished cards have exactly one unmatched line.
These are generated candidates, not automatic approvals: claim the suggested cluster, inspect the exact Oracle text, add a scenario, then regenerate the export.

| Suggested claim | Cards | Remaining line template |
| --- | ---: | --- |
| `unclaimed` | 1 | creatures can't attack you unless their controller pays {cost} for each creature they control that's attacking you — Propaganda |
| `unclaimed` | 1 | return all permanents of the color of your choice to their owners' hands — Wash Out |
| `unclaimed` | 1 | until end of turn, creatures target player controls lose all abilities and have base power and toughness <n>/<n> — Sudden Spoiling |
| `unclaimed` | 1 | when you cast ~, each player reveals the top card of their library. ~ enters with <n> +<n>/+<n> counters on it, where <n> is the total mana value of all cards revealed this way — Naya Soulbeast |
| `unclaimed` | 1 | whenever <n> spell or ability causes its controller to shuffle their library, that player puts <n> card from their hand on top of their library — Widespread Panic |
| `unclaimed` | 1 | whenever you cast <n> instant or sorcery spell, you may pay {cost}. if you do, copy that spell. you may choose new targets for the copy — Mirari |
| `unclaimed` | 1 | whenever ~ blocks, exchange its power and the power of target creature it's blocking until end of combat — Serene Master |
| `unclaimed` | 1 | {cost}: this turn, creatures can't block unless their controller pays {cost} for each blocking creature they control — War Cadence |
| `unclaimed` | 1 | {cost}: until end of turn, creatures you control have base power and toughness <n>/<n> and gain all creature types — Mirror Entity |

The highest-value fix is the shared template, not the first card name. A new primitive should parameterize type, zone, target, quantity and optionality so reprints and other sets inherit it.

