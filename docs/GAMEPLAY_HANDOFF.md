# Gameplay handoff

This is the current play-test contract for the local AI match. The match server
is authoritative; the client only renders its player-scoped projection and
submits actions already exposed as legal.

## Verified interaction contract

- `Auto-pasar` skips empty priority windows and counter-only responses when the
  stack has no counterable spell. It still stops for a real response, trigger,
  target, modal choice, combat declaration, or activated ability.
- The centered decision overlay is the primary surface for library searches,
  graveyard targets, trigger choices, mana/land choices, cycle-versus-cast
  choices, and stack responses. The dock remains a compact fallback.
- Fetch searches expose every legal card from the searching player's library,
  plus `Ver todo el mazo`; opponent libraries remain private.
- Mana activations are shown with local mana symbols and the reserve HUD.
  Safe consecutive mana activations can be undone from the button or playmat
  context menu. Passing priority, changing settings, a stack/effect, or a
  non-reversible mana ability clears undo history.
- Tokens have unique `instance_id` values, names, token frames, and independent
  combat/target selection. Creature stats are hidden on lands and noncreatures.
- Right-click/long-press opens the general card action menu for battlefield,
  hand, graveyard, exile, and command-zone cards. It lists legal cast/cycle/
  activation/yield actions and keeps **View information** as the final row.
  Image and mana-asset failures degrade to a readable local fallback instead
  of a broken image element.
- Human payments open a centered source chooser when available sources are not
  interchangeable; bots retain the deterministic fast planner. The menu also
  supports MTGO-style yielding from optional triggers of one source without
  suppressing mandatory triggers or response priority.
- Hand-based mana cards such as Simian Spirit Guide expose a separate mana
  action beside casting; selecting it exiles the card as a cost and never
  auto-casts or silently pays with it. The general menu recognizes the printed
  name, `~`, and `this card` Oracle variants and deduplicates its actions before
  the final **View information** row.
- The graphical stack shows one card-like item per spell, activated ability, or
  trigger, with top-first resolution order, controller, targets, and rules
  text. Priority remains authoritative in `packages/rules`.
- The central phase rail is the MTGO-style stopper surface. White triangles
  mark local phase stops; dark/hollow triangles are disabled. Left-click toggles
  a phase stop and right-click opens the same toggle as a context menu. Stops
  persist in local storage and prevent the client from enabling smart auto-pass
  at that phase; they do not invent server priority or alter turn rules.
- Stabilization failures are logged server-side with a bounded public-state
  diagnostic: turn, step, priority, stack summary, pending choice, combat
  declarations, and recent log entries. Hidden hands and libraries are omitted.

## Play-test commands

```text
npm run dev:server
npm run dev
```

The local client is served at `http://localhost:5173/lamagia/` and the match
server at `http://localhost:8787`. A direct smoke test is:

```text
POST /api/matches  {"mode":"tested","seed":2028}
POST /api/matches/:id/settings  {"token":"...","autoPass":true}
GET  /api/matches/:id?token=...
```

The tested pod currently creates a four-seat Commander match and settles to a
playable main phase after enabling auto-pass. The authoritative engine matrix
completed 200 games without rule-engine failures on 2026-09-05; 166 reached a
terminal state within 60 turns and 34 hit the simulation turn cap.

## Validation gate

Run before reporting gameplay ready:

```text
npm run check
npm test
npm run test --workspace=@prossh/match-server
npm run simulate:engine
python -m unittest discover -s tools/rules -p "test_*.py"
```

Card coverage is separate from gameplay stability. A card marked partial must
not be presented as verified merely because the table, priority loop, or UI
can load it.
