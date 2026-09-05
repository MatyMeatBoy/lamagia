# Gameplay interaction contract

The match server remains authoritative. The client renders legal actions and
submits intents; it must never infer a payment, trigger, target, or stack
result locally.

## Mana payment

For a human seat, the rules engine opens `mana-payment` when more than one
meaningfully different source can pay the cost. The player chooses each source
with `choose-mana-source`; interchangeable sources (for example two basic
Mountains paying `{1}`) keep the fast path. Bots continue using the deterministic
planner so AI turns do not stall.

This follows the announce/choose/pay order in Comprehensive Rules 601.2 and
602.2, with mana abilities handled under 605.3. Source-specific costs and
effects must remain in the authoritative engine.

## Card action menu

Right-click or long-press opens the general card menu. It lists every currently
legal action (cast, cycle, activated ability, alternate action, or trigger
yield) and always puts **View information** last. A click is only a shortcut
when one unambiguous action exists.

Hand-based mana abilities such as Simian Spirit Guide are legal actions in that
same menu. They are never folded into casting or automatic payment: choosing
the mana action exiles the card as its cost and adds the selected mana directly
(CR 605.1a, 605.3a).

The parser accepts the printed card name, `~`, and `this card` in that cost, so
reprints/imports cannot silently collapse the fast-mana action into “cast”.
The menu deduplicates the server actions, then keeps **View information** as
the final non-gameplay row.

## Yield from this card

`toggle-trigger-yield` is a player preference for a battlefield source. It
automatically declines that source's optional triggers during `settle`; it does
not suppress mandatory triggers, target selection, or priority responses. This
preserves the distinction between skipping a needless choice and forfeiting the
opponent's response window (CR 603.1, 603.3, 117.1b).

## Graphical stack

The stack is shown in resolution order, with one card-like item per spell or
ability, controller, targets, countered state, and a visible top-first marker.
Priority still follows the engine's `pass` action; the strip is presentation,
not a second rules state.

## Regression rules

Every new interaction needs a deterministic rules scenario. Keep public logs
and projections free of hidden zones. For stuck games, use
`docs/GAMEPLAY_DEBUGGING.md` and inspect `data/runtime/gameplay-debug.ndjson`.
