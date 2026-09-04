# Parallel primitive workers

`tools/rules/plan_primitive_workers.py` turns a generated primitive roadmap into
independent work orders. A primitive is assigned to one worker only; cards from
that primitive are split into batches of at most 20 for review and commits.

The default budget is five workers with 256 MB reserved per worker and a 2 GB
ceiling. The scheduler clamps the requested count to the budget and skips keys
already marked `active`, `ready`, `in progress`, or `review` in
`docs/WORK_CLAIMS.md`.

```powershell
npm run rules:roadmap
npm run rules:workers
```

The JSON plan is intended for agents or scripts; the Markdown plan is the
human-readable handoff. Re-run both after integrating a batch so the remaining
claims and card IDs are recalculated. This coordinates parallel work but does
not authorize concurrent edits to the same engine files.

The planner also co-locates connected jobs: when multiple unresolved primitives
share an `oracle_id`, their jobs stay on one worker and the worker estimate
counts that card once. This preserves primitive-level reuse without allowing
parallel agents to modify the same card in separate worktrees.

Fork protocol: workers do not push directly. They accumulate at least 11
commits, report all SHAs in one message, and keep each commit at no more than
20 new `oracle_id` values. The integrator reviews and imports the complete
batch together, then regenerates the queue. This reduces polling and prevents
two workers from rediscovering the same primitive.
