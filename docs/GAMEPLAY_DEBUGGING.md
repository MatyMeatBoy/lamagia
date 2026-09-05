# Gameplay debugging

The match server now writes a bounded public-state trace to
`data/runtime/gameplay-debug.ndjson` (override with `GAMEPLAY_DEBUG_LOG`). It
records each submitted action and stabilization failures with turn, step,
priority, pending choice, stack, combat declarations, and the last public log
entries. Hidden hands and libraries are never written.

To inspect the latest failure locally:

```powershell
Get-Content data/runtime/gameplay-debug.ndjson -Tail 20
```

The file is capped at 4 MiB and is recreated when full. A failure reported by
the client should be reproduced once, then the last `failure` record should be
attached to the gameplay issue. This trace is diagnostic evidence; rules fixes
still require a deterministic scenario test in `packages/rules/src`.
