# Cooperative primitive batch prompt

Use this prompt when assigning an independent card/rules batch to another
worker or model. Replace the bracketed fields before sending it.

```text
You are contributing one isolated rules batch to lamagia (formerly ProsshTCG).

CLAIM: [unique claim id; reserve it in docs/WORK_CLAIMS.md]
SCOPE: [one reusable primitive; process as many matching cards as useful,
        but publish at most five new oracle_id values per commit]
BASE: start from the current branch HEAD; do not assume prior chat context.

1. Read AGENTS.md, docs/HANDOFF_TO_CLAUDE.md, docs/WORK_CLAIMS.md, the
   relevant rules source, and existing scenario tests.
2. Confirm the claim is disjoint from active claims. Add your claim and scope
   to docs/WORK_CLAIMS.md before editing. If another worker owns it, choose a
   different primitive instead of duplicating work.
3. Extract the reusable rule from oracle text. Do not hard-code card names;
   fixture-specific aliases are allowed only in tests/data.
4. Add scenario tests first (or in the same change) for normal resolution,
   invalid targets/costs, and the important zone or priority boundary.
5. Cite the applicable official Comprehensive Rules section in the handoff.
6. Run npm run check, npm test, and the smallest relevant simulator/oracle
   test. Fix failures caused by the batch before committing.
7. Update docs/HANDOFF_TO_CLAUDE.md with exact files, tests, limits, and
   integration notes. Never stage generated data, assets, or unrelated user
   changes.
8. Create exactly one focused commit for this batch and report CLAIM, BASE SHA,
   COMMIT SHA, FILES, TESTS, SCENARIOS, and LIMITS. The integrator cherry-picks
   the SHA, reruns full coverage, and marks the claim merged. Continue with the
   next disjoint batch only after publishing the previous one.
```

This prevents workers from relying on stale conversation context and makes
each commit reviewable and cherry-pickable.
