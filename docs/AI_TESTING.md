# AI regression testing

`npm run simulate:ai` runs 1,000 deterministic four-seat games using the real imported cEDH pod. Each run gets a reproducible seed and rotates seating so a deck is not permanently assigned the starting-player position.

The report is written to `data/simulations/ai-matrix-last.json`. It includes configurations, winning/unfinished counts and enough replay samples (seed + seat rotation + recent events) to reproduce a suspicious match.

## What it proves today

The current agents are deliberately simple and safe. They exercise the imported 100-card deck lists, opening hands, commander removal from library, drawing, land development, abstract zone movement and basic combat pressure. Every simulated turn asserts that every player still owns exactly 100 cards and exactly one commander remains in the command zone.

## What it does not claim

This is not a declaration that all Magic cards work. The harness does not execute arbitrary Oracle text, colored mana choices, response windows, targeting, replacement effects, layers, state-based actions, or the full Commander rules. A card mechanic becomes **verified** only after an implementation exists in the rules engine, a focused regression test covers it, and the multi-game harness reaches that implementation.

## XMage and AI

XMage is a valuable Java rules-engine and computer-player reference, but it cannot safely be treated as a drop-in browser AI service. The production plan is to keep Prossh's authoritative match server independent, model legal actions in the TypeScript rules package, then plug deterministic bot policies into the same legal-action API used by human players. This makes every bot decision replayable and prevents the tester from silently accepting unsupported effects.
