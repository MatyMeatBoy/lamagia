# ProsshTCG — implementation handoff

**Read this first before changing the project.** This is an honest snapshot of the working tree as of 2026-09-03. It distinguishes implemented behavior from product intent so the next agent does not accidentally present a prototype as a complete Magic rules engine.

## Product objective

ProsshTCG is a fast, high-legibility Commander simulator, designed first for four players but architected for pods of 2–8. It targets the browser initially, with Android (Capacitor) and desktop (Tauri) planned from the same client. The desired visual reference is a modernized MTGO: three opponents use the upper table area, the local player owns the lower area, phases/priorities are explicit, and public zones can be inspected without leaking hidden information.

The required long-term product includes online rooms, profiles, avatars, rewards/tournaments, deck construction, a fully navigable card catalog, preconstructed Commander decks, wishlists/prices, and an authoritative rules engine. **It is not complete.**

## Current verified state

| Area | Implemented now | Evidence |
| --- | --- | --- |
| Client table | Four-seat layout: three public opponent battlefields on top; player commander, battlefield, hand and phase controls below. Responsive breakpoints exist. | `apps/client/src/main.ts`, `apps/client/src/styles.css` |
| Card art | Actual card image URLs from linked Scryfall metadata render for hand, battlefield, commander, catalog and avatars. The app does not bundle/card-cache art files. | `data/catalog/prossh.sqlite` (generated, ignored) and `services/match-server/src/index.ts` |
| Privacy | A player sees their own hand; opponents' library/hand contents are never present in the projected game view. Opponent public zones are visible. | `projectCommanderGame` in `packages/rules/src/commander-game.ts`; regression test |
| Rules slice | 2–8 seats, 40 life, 100-card deck validation, commander removed to command zone, opening 7, draw handling, one land/main phase, generic-only spell casting, stack and all-player passing. | `packages/rules/src/commander-game.ts` and `commander-game.test.ts` |
| Engine bot | A deterministic TypeScript bot advances full turns through the exact authoritative action functions, logs seed/action traces and asserts 100-card / command-zone / stack invariants. | `packages/rules/src/commander-ai.ts` and `commander-ai.test.ts` |
| cEDH data | Local Scryfall catalog has previously imported 117,621 default-card printings; a verified four-deck cEDH pod exists when generated. | `tools/card_catalog/`, `tools/decks/import_cedh_pod.py` |
| Precons | 190 Commander products / 19,000 card entries imported from MTGJSON and selectable in the UI to start a deterministic four-precon pod. | `tools/decks/import_commander_precons.py`, `/api/decks/precons`, `/api/matches/demo/precon` |
| Regression matrix | 1,000 seeded, seat-rotated games were executed successfully in about 9 seconds. It asserts card conservation and commander-zone invariants. | `data/simulations/ai-matrix-last.json` (generated, ignored); `tools/simulator/run_ai_matrix.py` |
| Current checks | `npm run check` and `npm test` passed after the current changes. Browser verification confirmed real card art, the AI status label, and a four-precon start. | Re-run the commands below; do not treat this table as a future guarantee. |

## Critical truth boundaries

1. The client demo is a development test table, **not a legal public multiplayer game**. The Socket.IO transport only has a room-join skeleton. There is no auth, persistence, matchmaking, reconnect protocol, tournament system, or real remote player control yet.
2. The authoritative TypeScript game slice only supports fully generic mana costs. It does not execute arbitrary Oracle text, colored mana, targets, responses, replacement effects, continuous effects/layers, state-based actions, combat assignment/blocking, commander tax/damage, or mulligans.
3. `tools/simulator/simulate_cedh_pod.py` and `run_ai_matrix.py` use metadata/heuristic behavior. They are excellent regression pressure tests but do **not** prove that a real card effect was resolved correctly. Never report their win rates as meaningful game balance data.
4. The precon `cover_art_uri` is a linked display-commander's Scryfall art crop, **not official product box art**. MTGJSON supplies no canonical distributable box-art URL in the imported deck feed. Preserve `cover_art_kind: "display_commander_art_crop"` until a licensed source is selected.
5. Card data/images remain subject to upstream terms. The current strategy links to provider-hosted images on demand; do not bulk download, transform to WebP, mirror, or redistribute art without a rights review and provider permission.

## Repository map

```text
apps/client/                    Vite TypeScript client and board UI
packages/rules/                 Pure deterministic TypeScript engine primitives
  src/index.ts                  turn/priority/stack state
  src/commander-game.ts         zones, projections, land/generic spell actions
  src/*.test.ts                 Vitest regression suite
services/match-server/          Fastify + Socket.IO server
  src/index.ts                  REST APIs plus demo-table state
tools/card_catalog/             Scryfall SQLite sync
tools/decks/                    cEDH and MTGJSON Commander deck importers
tools/simulator/                Python metadata regressions and AI matrix
data/                           generated local catalog/decks/reports; gitignored
docs/                           product, data, MTGO, AI and rules decisions
.codex/config.toml              project-scoped TRL token-reduction configuration
```

## Commands

Run from repository root (`C:\Users\MP\Documents\00 Claude\ProsshTCG` on the current Windows host):

```powershell
npm install
npm run dev:server        # Fastify server, default http://localhost:8787
npm run dev               # Vite client, default http://localhost:5173
npm run check             # TypeScript checks (build rules first)
npm test                  # 12 rules tests + Python simulator tests at last verification
npm run build             # production builds
```

Generate/rebuild data in this dependency order:

```powershell
npm run catalog:sync      # downloads/indexes Scryfall default_cards to data/catalog/prossh.sqlite
npm run decks:sync        # 56 cEDH DDB profiles (supporting source)
npm run decks:pod:sync    # actual four-deck cEDH pod resolved against local catalog
npm run precons:sync      # all MTGJSON Commander Deck products resolved against catalog
npm run simulate:cedh     # one real-list metadata smoke run
npm run simulate:ai       # 1,000 seeded regression games; writes ai-matrix-last.json
```

`data/` is deliberately ignored by Git due to size and generated provenance. A fresh clone needs the catalog sync before the deck/precon imports. If a service cannot find data, follow the order above instead of adding fake placeholders.

## HTTP surface implemented today

| Endpoint | Purpose | Important limitation |
| --- | --- | --- |
| `GET /health` | server liveness | no auth |
| `GET /api/catalog/search?q=` | local full-text-ish name/type lookup; falls back to Scryfall | minimum query length 2 |
| `GET /api/catalog/named?name=` | one printing/linked image metadata | provider fallback only if local miss |
| `GET /api/catalog/status` | local catalog availability | exposes local path for development only |
| `GET /api/decks/active-pod` | imported 4-deck cEDH data | no player ownership/deck legality enforcement |
| `GET /api/decks/precons` | paginated/searchable precon summaries | artwork is commander art crop, not a box image |
| `GET /api/matches/demo?seat=0` | filtered table projection | one in-memory demo game only |
| `POST /api/matches/demo/reset` | reset cEDH demo | deterministic dev seed |
| `POST /api/matches/demo/precon` | `{ deckId? }`, start selected + next three precons | deterministic dev seed |
| `POST /api/matches/demo/autopilot` | `{ turns? }`, at most 32 turn simulations | primitive-only heuristic, not a bot opponent service |
| `POST /api/matches/demo/action` | `advance`, `pass`, `play-land`, `cast-generic` | unauthenticated seat 0 prototype only |
| `GET /api/simulations/ai-matrix` | returns latest generated AI report | report must have been generated locally |

## How the current turn model works

`packages/rules/src/index.ts` owns `MatchState`: ordered seats, active seat, priority seat, turn step, pass sequence, priority flag and public stack entries. `untap` and `cleanup` do not open priority. At other supported steps, each pass advances priority circularly. All seats passing with an empty stack advances the step; all passing with stack contents resolves only the top object and returns priority to the active player.

`packages/rules/src/commander-game.ts` wraps it in Commander zones. `createCommanderGame` requires exact 100-card inputs, removes a declared commander from the library and draws a private seven. `projectCommanderGame` is the security boundary: it exposes only the viewer's hand and counts for opponents' hidden zones.

The present action set is intentionally narrow:

- `playLand`: active player, main phase, one land per turn.
- `castGenericSpell`: active player, main phase, all mana symbols numeric only, taps sufficient generic sources and creates a stack object.
- `passCommanderPriority`: resolves a supported spell to battlefield if permanent, or graveyard otherwise, after every player passes.

Do not extend this by parsing free-form Oracle text in the client. Add structured primitives and server-side legal action validation, then focused regression tests first.

`packages/rules/src/commander-ai.ts` is the first production-shaped bot seam. `runCommanderBotTurn` advances only via the real action functions, and `simulateCommanderBots` replays a multi-seat game from an explicit seed. Its policy is deliberately narrow: play one legal land, cast supported fully-generic cards, otherwise pass. It produces serializable action traces and checks 100-card ownership, one-command-zone object per player, life integrity and stack/pending-spell agreement before each decision. It is **not yet connected to the HTTP demo endpoint** and it does not understand unsupported card mechanics.

## Recommended next implementation sequence

1. **Finish an authoritative action framework.** Model action intents, legal-action generation per seat, event log/versioning, costs, choices and deterministic replay. Bind it to authenticated server seats before building more UI buttons.
2. **Add a real deterministic bot policy inside `packages/rules`.** It must select only from the exact legal-action list used by human players, and emit a seed + action trace. Do not use the Python metadata test as the game bot.
3. **Build rules by small verified primitives.** Begin with colored mana/value pools, mana abilities, casting costs, permanent/instant resolution, state-based actions, triggers, then targeting and combat. Every primitive needs focused tests plus matrix coverage. Cards whose effects lack coverage must remain disabled or clearly flagged.
4. **Replace demo in-memory state with persistent rooms.** Add authenticated identities, PostgreSQL/Redis, match versions/event streams, seat assignment/randomization, reconnects and server-side timeout/priority policies. Never allow the client to supply an arbitrary seat.
5. **Continue UI from the current MTGO-inspired foundation.** Preserve three opponent fields above and the player area below. Improve card density with overlap/zoom/expand controls, graveyard/exile rails, responsive orientation and accessible touch interactions. Do not reintroduce a giant empty central game panel.
6. **Implement deck and collection features.** Card relationships should use structured metadata (`oracle_id`, `scryfall_id`, types, subtypes, colors, set, artist) rather than text scraping. Wishlist pricing is a separate, opt-in data feature and must never be shown as a live price guarantee without source/refresh timestamps.
7. **Precon artwork decision.** Find a rights-cleared or officially licensed product-art source. Store provenance/license per asset and swap only `cover_art_uri`; do not scrape/mirror random web images.

## Data provenance and design references

- Cards: Scryfall bulk/default-card data, via `tools/card_catalog/sync_scryfall.py`. See `docs/CARD_CATALOG.md`.
- Competitive decks: cEDH Decklist Database import/profile data; active four-deck list comes from the importer. See `docs/CEDH_DECKS.md`.
- Commander precons: MTGJSON `DeckList` + individual deck files. See `docs/PRECONS.md`.
- MTGO layout: use only as interaction/layout inspiration. See `docs/MTGO_LAYOUT.md`.
- MTGO SDK: do not promise account sync. It is not an OAuth/browser integration and should not be used for game automation. See `docs/MTGO_INTEGRATION.md`.
- XMage/Argentum: study as implementation references; do not copy code/data blindly or claim their AI is embeddable in this architecture.
- AI regression limitations: `docs/AI_TESTING.md` and `docs/SIMULATION.md`.

## Last verification snapshot

After adding the AI matrix endpoint/status label, the following all passed:

```text
npm run simulate:ai
  AI matrix passed: 1000 games in 9.089s; unfinished=72

npm test
  Vitest: 4 files / 14 tests passed
  Python: simulator tests 2 passed, AI matrix test 1 passed

npm run check
  rules build, client TypeScript check, match-server TypeScript check passed
```

Browser smoke test at `http://localhost:5173` confirmed 24 real image elements in the cEDH table, `AI 1000/1000 passed`, and that selecting **Counterpunch** starts a four-precon pod with Counterpunch and Devour for Power present. Repeat this test after UI/server changes; an old Vite page can briefly show a stale failed request after server hot reload, so reload before diagnosing a data regression.

## Working style constraints for continuation

- Keep user-facing final/status replies in Spanish unless the user asks otherwise. English is okay inside code/docs.
- Use `apply_patch` for edits. Do not discard uncommitted changes; the whole project is currently untracked/initial in Git, so `git diff` does not represent the actual work.
- Prefer `rg` for file search. Keep generated `data/` outside source control unless the repository owner changes that policy.
- Do not claim the game is "fully playable" or cards "all work" until the rules coverage and authenticated online flows actually prove it.
- Treat new card images and external data as legal/provenance decisions, not merely implementation conveniences.
