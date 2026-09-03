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
| `rules-level-up` | Level up costs, level counters, and the three C13 cards: Echo Mage, Hada Spy Patrol, Kazandu Tuskcaller | `codex/c13-equipment-cluster` | active | 2026-09-03 |
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
