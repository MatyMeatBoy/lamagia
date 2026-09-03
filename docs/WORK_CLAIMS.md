# Work claims

This is the lightweight coordination ledger for parallel card and rules work.
The claim key is a reusable primitive or a disjoint card batch, never a vague
feature name.

## Before editing

1. Read this file, `AGENTS.md` and `docs/HANDOFF_TO_CLAUDE.md`.
2. Search open PRs and this table for the same claim key, card Scryfall IDs or
   engine files.
3. If free, add a row and publish that claim commit immediately.
4. Work only inside the declared scope. The first published claim wins; a
   later worker stops or chooses another batch.

## Active claims

| Claim key | Scope | Branch / PR | Status | Since (UTC) |
| --- | --- | --- | --- | --- |
| `rules-land-search` | Landcycling variants and land-subtype search resolution | `feat/activated-abilities-and-triggers` | merged (`7c7f77c`) | 2026-09-03 |
| `rules-equipment` | Equip actions, attachment state, and Equipment static bonuses | `codex/c13-equipment-cluster` | merged (`f61a096`) | 2026-09-03 |
| `rules-level-up` | Level up costs, level counters, and the three C13 cards: Echo Mage, Hada Spy Patrol, Kazandu Tuskcaller | `codex/c13-equipment-cluster` | merged (`f325052`) | 2026-09-03 |
| `rules-tap-untap` | Targeted Tap target creature and Untap target permanent effects | `codex/c13-equipment-cluster` | merged (`4fa0290`) | 2026-09-03 |
| `rules-mill` | Target player mills a bounded number of cards into their graveyard | `codex/c13-equipment-cluster` | merged (`2842700`) | 2026-09-03 |
| `rules-counter-restrictions` | Creature-spell and noncreature-spell counter target families | `codex/c13-equipment-cluster` | merged (`dcc9ada`) | 2026-09-03 |
| `rules-plus-counters` | Put +1/+1 or -1/-1 counters on a target creature | `codex/c13-equipment-cluster` | merged (`f026bdd`) | 2026-09-03 |
| `rules-target-discard` | Target player chooses bounded cards from their hand to discard | `codex/c13-equipment-cluster` | merged (`90e0098`) | 2026-09-03 |
| `rules-life-gained` | Life-gained trigger event and source +1/+1/-1/-1 counter effect | `codex/c13-equipment-cluster` | merged (`b1bf642`) | 2026-09-03 |
| `rules-target-life` | Target-player life gain with event propagation | `codex/c13-equipment-cluster` | merged (`41bfb46`) | 2026-09-03 |
| `rules-each-life` | Living-player life gain with one event per recipient | `codex/c13-equipment-cluster` | merged (`283a02f`) | 2026-09-03 |
| `rules-target-life-loss` | Target-player life loss, distinct from damage | `codex/c13-equipment-cluster` | merged (`93318e6`) | 2026-09-03 |
| `rules-each-life-loss` | Living-player global life loss, distinct from damage | `codex/c13-equipment-cluster` | merged (`6d128b6`) | 2026-09-03 |
| `rules-self-life-loss` | Controller life loss, distinct from damage | `codex/c13-equipment-cluster` | merged (`67f92db`) | 2026-09-03 |
| `rules-life-lost-trigger` | Life-loss event bus for `Whenever you lose life` | `codex/c13-equipment-cluster` | merged (`3d4ab69`) | 2026-09-03 |
| `rules-token-creation` | Preserve tapped state on created tokens | `codex/c13-equipment-cluster` | merged (`19ae957`) | 2026-09-03 |
| `rules-graveyard-return` | Target card return from own graveyard to hand | `codex/c13-equipment-cluster` | merged (`ff80bd1`) | 2026-09-03 |
| `rules-python-ir` | Reusable raw-text operands: actions, zones, card types, and subtypes for the Oracle compiler | `feat/activated-abilities-and-triggers` | merged (`7326cbe`) | 2026-09-03 |

## Claim format

Copy this row when starting work:

```text
| `cluster-or-batch` | exact primitive, files and/or Scryfall IDs | branch / PR | active | YYYY-MM-DD |
```

Use one row per independent worker. Keep a claim active until the PR is merged
or explicitly abandoned. After merge, change it to `merged` and record the
commit in the handoff. If a worker discovers that its scope is larger than
declared, it must update the claim before touching the additional files.

Claims coordinate contributors but do not replace review: CI, scenario tests,
rules citations and the integrator review remain mandatory.
