# Opening procedure and professional mana payment

## Opening procedure

The match server enables the London mulligan before turn one:

1. Players decide in starting-seat order whether to keep or mulligan.
2. Players who mulligan shuffle that hand into their library and draw seven again.
3. Once everyone has kept, each player who mulliganed puts exactly that many cards on the bottom in any order.
4. Opening-hand actions are then offered in turn order. The current typed implementation supports Gemstone Caverns: it enters with a luck counter and the player chooses a different card to exile.
5. Only after those decisions does the normal turn engine open priority.

This follows the official London procedure and the official Gemstone Caverns opening-hand timing:

- [The London Mulligan — Wizards of the Coast](https://magic.wizards.com/en/news/announcements/london-mulligan-2019-06-03)
- [Time Spiral Remastered Release Notes — Wizards of the Coast](https://magic.wizards.com/en/news/feature/time-spiral-remastered-release-notes-2021-03-23)

Bots keep their opening hand and skip optional opening actions deterministically. Human decisions are exposed through `legalActions`; the client does not invent or resolve them locally.

## Mana payment policy

The payment planner remains authoritative and deterministic. For human players it opens the source selector when a meaningful decision remains. It auto-pays only when:

- the available mana exactly equals the current cost, and
- all available sources are interchangeable for that payment.

When any mana would remain, the selector stays open so the player can preserve a land or a special source for a response. Distinct sources also remain selectable when their choice can matter (colours, restrictions, life costs, counters, or triggered effects). Bots continue using the deterministic planner without a UI-only pause.

Scenario coverage lives in `packages/rules/src/engine.test.ts` under `game creation` and `professional mana autopay`.
