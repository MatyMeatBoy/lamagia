# lamagia engineering rules

- Use `trl-retrieve` / `explain_symbol` for cross-file inspection when the project-scoped MCP is available; use exact file reads for small, known files. Do not repeatedly retrieve the same context.
- The match server is authoritative. Clients submit intents and render only a player-specific projection; never send hidden zones or legal actions belonging to another player.
- Keep rules pure and deterministic. No I/O, clocks, sockets, or UI state in `packages/rules`.
- Represent cards by stable Scryfall IDs and normalized metadata. Names are display/search fields, never identity.
- Before implementing a card interaction, add a scenario test for rules behavior. Validate Comprehensive Rules citations from the official Wizards rules source.

- Keep assistant output as short as possible to save context. Work through the tools silently; report only substantive changes, blockers, validation failures, or a needed decision.
- For parallel workers, claim a disjoint primitive before editing and return a compact `CLAIM/BASE/COMMIT/FILES/TESTS/SCENARIOS/LIMITS` report. The integrator batches 11 or more incoming commits before processing them, unless a safety or blocking issue requires an exception; never use `git add -A` or include unrelated/generated assets.
- Every worker report must also list each completed card as `<name> | <oracle_id>`; publish the focused commit with `git push origin HEAD`, keep one cluster per commit and at most 20 new `oracle_id`s. A card count without this mapping is not integrable evidence.
