# Mana cost and alternative-payment coverage

This is the regression map for mana symbols that are easy to misread as plain
generic mana. The authoritative implementation is `packages/rules/src/mana.ts`;
the match engine must use `payCost`/`planManaPayment` rather than reimplementing
these choices in a card primitive.

## Implemented

| Symbol/form | Engine behavior |
|---|---|
| `{W}`, `{U}`, `{B}`, `{R}`, `{G}`, `{C}` | Exact colored/colorless payment |
| `{0}`–`{N}` | Generic payment |
| `{X}`, `{Y}`, `{Z}` | Variable generic value supplied by the action |
| `{G/W}`, `{2/U}` | Hybrid and monocolored hybrid backtracking |
| `{B/P}` | Phyrexian mana: color or exactly 2 life; life may reach 0 |
| `{G/U/P}` and equivalents | Hybrid Phyrexian: either color or exactly 2 life |
| `{S}` | Requires one unit marked as produced by a snow source; snow mana retains its color |

Snow is represented as a per-color marker, not as a fake seventh mana type. A
Snow-Covered basic land, Snow artifact, or other snow permanent that produces
mana marks its output. Normal colored/generic costs may still spend that mana,
and spending it removes the snow marker.

## Deliberately not treated as normal game symbols

`{HW}`, `{D}`, `{L}` and other isolated catalog tokens come from silver-border,
playtest, or non-ordinary product data. They remain unsupported and must not be
silently converted to generic mana. Un-set/Alchemy cards are excluded from the
normal implementation target, as recorded in the project workflow.

## Required regression cases

- Normal mana cannot pay `{S}`.
- Colored or colorless mana from a snow source can pay `{S}`.
- Snow mana can pay its ordinary color and then loses its snow marker.
- Hybrid Phyrexian can choose either color or life, including exact life total.
- Automatic and manual payment paths preserve the same choices.

Rules references: [Comprehensive Rules changes, rule 107.4h](https://magic.wizards.com/en/news/announcements/comprehensive-rules-changes-2021-02-02), [Kaldheim Release Notes](https://magic.wizards.com/en/news/feature/kaldheim-release-notes-2021-01-22).
