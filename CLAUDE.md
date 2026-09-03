# ProsshTCG continuation instructions

Read [`docs/HANDOFF_TO_CLAUDE.md`](docs/HANDOFF_TO_CLAUDE.md) completely before making implementation decisions. It contains the verified product state, command sequence, architecture, rule-engine boundaries, data provenance, current tests, and next milestones.

Key constraints:

- Keep user-facing status/final replies in Spanish.
- Do not claim arbitrary Magic card text, online multiplayer, MTGO account sync, official precon box art, or a fully playable game exists unless it is implemented and verified.
- Keep hidden information server-side; player projections must never include an opponent's hand or library cards.
- Build Magic effects as server-authoritative, deterministic primitives with focused tests. The current Python simulator is regression tooling, not a legal game engine or production bot.
- Use linked provider-hosted card images unless a rights-cleared distribution strategy has been approved.
- Generated `data/` is ignored; recreate it through the commands in the handoff rather than adding placeholders.
- After every material functional change, update `docs/HANDOFF_TO_CLAUDE.md` with the source location, verified behavior, remaining boundary, and exact validation command/result.
