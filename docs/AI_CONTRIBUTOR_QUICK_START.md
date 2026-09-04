# AI Contributor Quick Start

Use this contract when adding rules to **La Magia**. Read `AGENTS.md`,
`docs/HANDOFF_TO_CLAUDE.md`, and `docs/WORK_CLAIMS.md` before editing.

## Scope

- Claim one disjoint reusable primitive in `docs/WORK_CLAIMS.md`.
- Work from the published integration branch and record its exact `BASE` SHA.
- Start from the same published integration SHA as every other worker. Select
  one unclaimed cluster at random from the refreshed roadmap; re-check claims
  immediately before editing and redraw if it was claimed.
- Use `oracle_id`/Scryfall ID for identity; card names and set codes are never
  implementation keys. Reprints inherit the same rules automatically.
- Reuse an existing primitive before adding a parser branch. Add structured
  parameters for changed wording, zones, types, targets, costs, quantities,
  and optional choices instead of card-name exceptions.
- Keep `packages/rules` pure and deterministic. The match server validates
  intents and projections; the client never decides outcomes or reveals hidden
  zones.
- Cite the applicable official Comprehensive Rules number in the test or
  handoff. Do not copy XMage, Forge, Arena, Scryfall, or Wizards code/assets.

## Generate the next task

Do not choose cards by name or by an old status count. Refresh the engine-first
queue, choose one unclaimed generated cluster at random, then claim it:

```text
npm run rules:engine:export
npm run rules:roadmap:c13
npm run rules:oracle:plan:c13
```

Read `docs/PRIMITIVE_ROADMAP_C13.md` and `docs/PRIMITIVE_WORKERS_C13.md`.
The roadmap ranks work by cards actually closed (last-blocker wins), while the
worker plan co-locates overlapping `oracle_id`s and assigns disjoint primitives
to five workers within the 2 GB budget. The raw Oracle IR command
(`npm run rules:oracle:c13`) is useful for inspecting wording, but the engine
roadmap is authoritative for what still needs implementation.

## Definition of done

Add scenario tests before implementation when the change affects the engine.
Cover normal resolution plus relevant choices, invalid targets, zones,
multiplayer, replacement effects, and state-based actions. Then run:

```text
npm run check
npm test
npm run simulate:engine
python -m unittest discover -s tools/rules -p "test_*.py"
```

Only report a card as complete when the engine export marks every Oracle clause
as `fullyImplemented`. A rules/test-only commit may add zero cards; report the
before/after coverage instead of inventing a card count.

## Commit contract

One commit contains one cluster and at most 20 new `oracle_id`s. Stage only
explicit files; never use `git add -A` or include generated data, secrets,
`ChromaKey/`, `apps/client/public/`, or `site/assets/`.

```bash
git add -- packages/rules/src/characteristics.ts packages/rules/src/engine.ts packages/rules/src/characteristics.test.ts packages/rules/src/engine.test.ts docs/WORK_CLAIMS.md docs/HANDOFF_TO_CLAUDE.md
git diff --cached --check && npm run check && npm test && npm run simulate:engine
git commit -m "feat(rules): implement <cluster> batch <nn>"
git push origin HEAD
```

If a test fails, do not publish a green-looking report. Fix it or leave the
work uncommitted and state the blocker.

## Required compact handoff

Send this exact shape after pushing. Keep output to one block; include details
only for failures, limits, or decisions requiring review.

```text
CLAIM: c13-<primitive>
BASE: <exact integration SHA>
COMMIT: <published SHA>
CARDS:
- <Card name> | <oracle_id>
FILES: <explicit paths>
TESTS: check=PASS; test=PASS; simulate=PASS; python=PASS
SCENARIOS: <short list, with CR numbers>
LIMITS: <unsupported clauses/cards, or none>
```

After publishing, do not rebase, reset, force-push, or silently amend the
commit. Claim a new cluster with a new `BASE` for the next batch. The
integrator reviews commits in order, normally accumulates 11 or more incoming
commits, runs the full validation once, updates coverage, and marks merged
claims. A conflict or safety issue is the only reason to integrate earlier.

