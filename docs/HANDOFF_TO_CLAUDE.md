# ProsshTCG — implementation handoff

**Read this before changing the project.** It is an honest snapshot of the working tree as of 2026-09-03, separating what is implemented and verified from what is still product intent. Do not present anything below the "Truth boundaries" line as working.

Repository: <https://github.com/MatyMeatBoy/ProsshTCG> (private).

## Product objective

ProsshTCG is a Commander simulator built for a four-player pod but architected for 2–8 seats. It targets the browser first, with Android (Capacitor) and desktop (Tauri) planned from the same client. The visual reference is a modernised MTGO: three opponents share the upper band, the local player owns the lower band, phases and priority are explicit, and public zones can be inspected without leaking hidden information.

The long-term product still needs online rooms, profiles, rewards/tournaments, deck construction, a wishlist/price gallery and far more rules coverage. **It is not complete.**

## What changed in this pass

The previous build could not be played. Four defects made it unusable, all confirmed by running it:

1. Priority was closed during `untap` and `cleanup` with no way to reopen it, so `passCommanderPriority` threw and the table **deadlocked twice per turn**. The only escape was a debug button that skipped a step outright.
2. `advanceStep` set `stack: []`, so any spell on the stack vanished on a step change while `pendingSpells` kept its entry — a permanent desync.
3. Only fully generic mana costs could be cast. In a real Commander deck that is almost nothing, so a hand was effectively dead.
4. There was no combat, no damage, no state-based actions and no winner: 16 simulated turns left every player on 40 life. The bot in `commander-ai.ts` was never wired to the server.

All four are fixed by a rewritten engine. `commander-game.ts` and `commander-ai.ts` were replaced by the modules below.

## Current verified state

| Area | Implemented now | Evidence |
| --- | --- | --- |
| Turn structure | All twelve steps, with `untap` and `cleanup` resolving their turn-based actions automatically. A seat whose only legal move is passing is passed for it, so no window can stall. | `settle` in `packages/rules/src/engine.ts`; `engine.test.ts` → "never leaves the table without somebody able to act" |
| Priority and stack | Circular passing, resolution one object at a time, priority back to the controller after casting, no step advance while the stack is occupied. | `applyPass` / `resolveTop`; `engine.test.ts` → "holds the spell on the stack while an opponent can still respond" |
| Mana | Generic, colored, colorless, hybrid, monocolored hybrid, Phyrexian (life payment), snow-as-generic and `{X}` parsing. A backtracking solver decides which permanents to tap. | `packages/rules/src/mana.ts`, `planManaPayment`; `mana.test.ts` (12 cases) |
| Casting | Any card whose printed cost the board can pay, at sorcery or instant speed, with targeting and fizzling when targets leave. | `applyCast`, `legalTargets`; `engine.test.ts` → "casting" |
| Commander | Command-zone start, `{2}` tax per previous cast, return-to-command-zone on death, 21-damage elimination tracked per commander. | `commanderTax`, `movePermanentToZone`; `engine.test.ts` → "commander rules" |
| Combat | Attack declaration with per-attacker defender choice, blocks, first/double strike sub-step, deathtouch, trample, lifelink, vigilance, menace, flying/reach restrictions, defender, haste, summoning sickness. | `computeCombatDamage`; `engine.test.ts` → "combat" (11 cases) |
| State-based actions | Lethal damage, zero toughness, indestructible, legend rule, 0 life, empty-library draw, 21 commander damage, last player standing. | `applyStateBasedActions`; `engine.test.ts` → "state-based actions" |
| Privacy | A projection contains the viewer's hand and nothing hidden from any other seat — not the cards, not their identifiers. | `packages/rules/src/projection.ts`; asserted in `engine.test.ts`, `real-decks.test.ts` and the engine matrix |
| Bot | Plays only from the same `legalActions` list a human receives: lands, castables, attack and block heuristics, target selection. | `packages/rules/src/bot.ts` |
| Server | Match registry with seat-bound secret tokens, bots driven between human decisions, per-seat projections, Socket.IO update notifications. | `services/match-server/src/matches.ts` |
| Client | Full-viewport table, side rail (stack + legal actions), three opponents at full width, land/nonland rows oriented per seat, fanned hand, hover preview with Oracle text and coverage, toggleable log with per-seat colours and card links, mana pips, internal card pages. | `apps/client/src/main.ts`, `styles.css` |
| Card data | 117,621 printings with rules fields (power/toughness/loyalty, produced mana, faces) and printing fields (promo, frame, finishes, set type) plus a precomputed `printing_rank`. | `tools/card_catalog/sync_scryfall.py` |
| Catalog search | One row per card — the current plain reprint — with the printing count. Relevance: exact name, whole-word, then substring, ordered by reprint count. | `bestPrintingSelect` in `services/match-server/src/index.ts` |
| Precons | 192 Commander deck products (2009–2026) grouped by set with set icons. Each card resolves to **that product's own printing** via MTGJSON's `scryfallId`. | `tools/decks/import_commander_precons.py`, `/api/decks/precons?grouped=1` |

### Last verification run

```text
npm run check          rules build + rules/client/server typecheck   PASS
npm run test           Vitest 5 files / 89 tests                     PASS
npm run simulate:engine 200 seeded games in 5.99s                    PASS
                       finished 115, unfinished 85, avg 54.34 turns
                       0 invariant failures, 0 projection leaks
```

Browser smoke test at `http://localhost:5173`: a cEDH pod starts, lands and spells are cast from the hand, bots take their turns, combat resolves, the log shows coloured seat names and linked card names, and the card preview reports per-card rules coverage.

## Truth boundaries — do not overstate these

1. **Card text is mostly not executed.** `characteristics.ts` recognises a closed set of templates: draw N, gain N life, each opponent loses N life, "~ deals N damage to any target", damage to each opponent, destroy target creature, destroy all creatures, counter target spell. Over the current cEDH pod that is **83 of 400 cards fully covered**. Every other card plays as a real body with real types, power/toughness and combat keywords, and both the hand tooltip and the card page say so. Never claim "all cards work".
2. **No activated abilities beyond mana, no triggered abilities, no ETB effects, no static/continuous effects, no layers, no counters on permanents, no tokens, no planeswalker loyalty, no mulligans.**
3. **The bot is a heuristic, not a strong opponent.** Its win rates are not balance data.
4. **There is no authentication, persistence, matchmaking or reconnect.** Matches live in one process's memory and are lost on restart. Seat tokens stop a client from claiming another seat; they are not a security system.
5. **`cover_art_uri` on a precon is the display commander's Scryfall art crop, not official product box art.** MTGJSON publishes no distributable box-art URL and no rights-cleared source has been selected. Keep `cover_art_kind: "display_commander_art_crop"` until one is. The deck browser shows the set's Scryfall icon as the product mark for the same reason.
6. **Only 100-card Commander deck products are imported.** "Commander Arsenal", "Commander Anthology" and similar are MTGJSON *Box Sets* — collections of singles, not decks — so they have no deck to play and are correctly absent.
7. **Card data and images remain subject to upstream terms.** Images are linked from the provider on demand. Do not bulk download, re-encode or mirror art without a rights review.
8. **The Python simulators (`simulate_cedh_pod.py`, `run_ai_matrix.py`) are metadata heuristics, not the game engine.** `npm run simulate:engine` is the real regression matrix; prefer it. The Python ones are kept only as cheap deck-plumbing smoke tests.

## Repository map

```text
apps/client/                    Vite TypeScript client
  src/main.ts                   table rendering, interaction, dialogs
  src/styles.css                full-viewport layout and card styling
packages/rules/                 authoritative engine (pure, deterministic)
  src/mana.ts                   symbols, pools, payment solver
  src/characteristics.ts        card profiles + the closed Oracle template set
  src/engine.ts                 state, legal actions, stack, combat, SBAs
  src/projection.ts             the per-seat security boundary
  src/bot.ts                    bot policy over legal actions only
  src/simulator.ts              coarse metadata simulator (legacy tooling)
  src/*.test.ts                 89 Vitest specs
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
data/                           generated, gitignored
```

## Commands

From the repository root:

```powershell
npm install
npm run dev:server        # Fastify + Socket.IO on http://localhost:8787
npm run dev               # Vite client on http://localhost:5173
npm run check             # build rules, then typecheck rules/client/server
npm test                  # 89 Vitest specs + Python smoke tests
npm run simulate:engine   # 200 seeded games through the real engine
npm run build             # production builds
```

Generate data in this order (a fresh clone has none):

```powershell
npm run catalog:sync      # ~117k printings into data/catalog/prossh.sqlite
npm run decks:sync        # cEDH DDB profiles (supporting source)
npm run decks:pod:sync    # the four-deck cEDH pod
npm run precons:sync      # all 192 Commander precon products
```

`catalog:enrich` and `decks:enrich` exist only to upgrade data produced by the pre-2026-09-03 catalog schema. After a fresh `catalog:sync` they are unnecessary — the importers read the new columns directly.

## HTTP surface

| Endpoint | Purpose | Limitation |
| --- | --- | --- |
| `GET /health` | liveness and match count | no auth |
| `GET /api/catalog/search?q=` | one row per card, best printing; `t:type` supported | local catalog only unless it is missing |
| `GET /api/catalog/card/:id` | internal card page with its printing list | falls back to Scryfall on a local miss |
| `GET /api/catalog/named?name=` | one printing by exact name | provider fallback only |
| `GET /api/catalog/status` | catalog availability | exposes a local path; development only |
| `GET /api/decks/active-pod` | imported cEDH pod summary | no ownership or legality checks |
| `GET /api/decks/precons?grouped=1` | products with set icons and their decks | cover art is commander art, not box art |
| `POST /api/matches` | `{ mode: "cedh" \| "precon", deckId?, seed? }` → `{ matchId, seat, token, view }` | in-memory, unauthenticated |
| `GET /api/matches/:id?token=` | that seat's projection | wrong token → 404 |
| `POST /api/matches/:id/action` | `{ token, action }`; rejected unless that seat owes the decision | |
| `POST /api/matches/:id/settings` | `{ token, autoPass }` | |
| `GET /api/simulations/engine-matrix` | latest matrix report | must be generated locally |

## How the engine is put together

`GameState` is immutable; every change goes through `applyAction(state, seat, action)`, which validates against `legalActions(state, seat)` and then calls `settle`.

`settle` is the piece that makes the table playable. It loops until a player genuinely owes a decision: it applies state-based actions, prunes combat, resolves steps that never open priority, auto-submits attack/block declarations nobody can make, and auto-passes any seat whose only legal action is to pass. That is why the deadlocks are gone and why a spell nobody can respond to resolves without asking for four empty clicks.

`planManaPayment` decides which permanents to tap. Colored requirements are satisfied first from the floating pool, then from the least flexible untapped source that can produce the colour, so a dual land stays free for the requirement only it can cover; the rest is paid by tapping further sources until `payCost` validates the whole cost. Interchangeable sources share one search branch and a node budget guarantees termination.

## Recommended next sequence

1. **Triggered abilities and ETB effects.** They are the single largest coverage gap: most Commander cards do something on entry. Model them as structured triggers with a real trigger queue, not text parsing, and grow the template set with a test per template.
2. **Activated abilities beyond mana**, then counters on permanents and tokens.
3. **Continuous effects and layers.** Needed before anything that pumps, grants keywords, or changes types can be trusted.
4. **Persistence and identity.** Replace the in-memory registry with PostgreSQL/Redis, authenticated seats, event streams with versions, reconnects, and server-side priority timeouts.
5. **Deck construction and the collection.** Build on `oracle_id`/`scryfall_id` and the structured columns; wishlist pricing is a separate opt-in feature and must always carry a source and refresh timestamp.
6. **Precon box art.** Find a rights-cleared or licensed source, store provenance and licence per asset, and swap only `cover_art_uri`.
7. **Rulings text.** Scryfall exposes `/cards/:id/rulings`; if the preview should show current rulings, add a rulings table to the catalog sync and serve it locally rather than calling out per hover.

## Working style constraints

- Keep user-facing status and final replies in Spanish. English is fine inside code and docs.
- Update this file after every material functional change: source location, verified behaviour, remaining boundary, exact validation command and result.
- Generated `data/` stays out of Git. If a service cannot find data, run the sync order above instead of adding placeholders.
- Do not claim the game is "fully playable" or that "all cards work" until rules coverage and authenticated online flows actually prove it.
- Treat new card images and external data as licence and provenance decisions, not implementation conveniences.
