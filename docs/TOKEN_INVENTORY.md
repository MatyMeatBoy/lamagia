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
printings. All 809 definitions currently have at least one normal image in the
catalog. The exporter records per-definition image counts and missing sets so a
future catalog refresh turns artwork gaps into explicit work items rather than
silent broken frames.

`rulesDataStatus` distinguishes tokens with explicit Oracle text from
predefined/no-text tokens. The latter still require the engine's CR 111.10
definition when their built-in abilities matter (for example Treasure, Food,
Clue, and Blood); artwork completeness does not imply rules completeness.

## Predefined-token implementation queue

The current engine executes Clue and Food token activations through explicit
token Oracle text. Treasure, Gold, Blood, Powerstone, Map, Junk, Lander,
Mutagen, and other predefined tokens remain artwork/data-complete but must not
be marked fully executable until their sacrifice costs, mana restrictions,
target choices, and activation-speed rules have scenario coverage. Implement
these as shared token primitives keyed by normalized `tokenKey`, never as
card-name branches. Each worker must claim one token cluster, add a rules
scenario, and preserve the originating set for artwork selection.

The rules engine carries the creating card's `set_code` through every generated
token, including copy, amass, replacement, and targeted-player effects. The
match server uses that value only for artwork selection; it never affects rules
identity or token behavior.
