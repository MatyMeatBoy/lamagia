# ProsshTCG engineering rules

- Use `trl-retrieve` / `explain_symbol` for cross-file inspection when the project-scoped MCP is available; use exact file reads for small, known files. Do not repeatedly retrieve the same context.
- The match server is authoritative. Clients submit intents and render only a player-specific projection; never send hidden zones or legal actions belonging to another player.
- Keep rules pure and deterministic. No I/O, clocks, sockets, or UI state in `packages/rules`.
- Represent cards by stable Scryfall IDs and normalized metadata. Names are display/search fields, never identity.
- Do not copy source or assets from XMage, MTGO, Arena, Argentum, Scryfall, or Wizards. Consult them as references and respect their licenses and policies.
- Before implementing a card interaction, add a scenario test for rules behavior. Validate Comprehensive Rules citations from the official Wizards rules source.

