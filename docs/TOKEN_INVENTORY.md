# Token inventory and worker clusters

Tokens are indexed separately from playable-card coverage. Their identity is
the normalized token definition, while every set/printing remains available so
the client can choose the token art that matches the originating edition.

Generate the inventory with:

```text
python tools/rules/export_token_inventory.py --catalog data/catalog/prossh.sqlite --output data/rules/token-inventory.json --markdown-output docs/TOKEN_WORK_QUEUE.md
```

The output has two useful queues:

- `token-frame-only`: token has no executable rules text; finish its set-aware
  image/frame mapping first.
- `token-rules`: fallback for token text containing executable rules.
- `token-trigger`, `token-activated`, `token-keyword`, `token-zone-effect`:
  focused queues for workers. A token may still require a second primitive;
  the normalized token key prevents duplicate work across its printings.

Do not count token printings as independent Oracle cards. Do preserve every
printing and set relation. A token created by an edition-specific card should
prefer that edition's matching token printing; otherwise use the newest regular
paper token with the same normalized definition.

Current generated inventory: **809** normalized token definitions and **2,834**
printings. The queue is split into 39 activated, 207 keyword, 98 triggered,
and 2 zone-effect definitions; regenerate it after catalog changes rather than
copying its timestamp or assigning printings as separate rules cards.

The rules engine carries the creating card's `set_code` through every generated
token, including copy, amass, replacement, and targeted-player effects. The
match server uses that value only for artwork selection; it never affects rules
identity or token behavior.
