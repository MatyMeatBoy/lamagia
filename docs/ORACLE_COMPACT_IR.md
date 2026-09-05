# Compact Oracle IR

`tools/rules/compact_oracle_ir.py` creates a small symbol table for worker
review. It is inspired by compiler intermediate representations: LLVM keeps a
typed, inspectable representation usable by multiple compiler phases, while
MLIR separates reusable operations from attributes and allows dialects to be
extended without encoding every transformation as a special case.

- [LLVM Language Reference](https://llvm.org/docs/LangRef.html)
- [MLIR Language Reference](https://mlir.llvm.org/docs/LangRef/)
- [MLIR operation definitions](https://mlir.llvm.org/docs/DefiningDialects/Operations/)

## Design

The existing Oracle compiler remains authoritative for raw text, classification,
and `fullyImplemented` decisions. The compact artifact only interns unresolved
clause shapes:

```text
Draw three cards.
=> primitive p0001: draw|static-or-spell|shape:draw <n> cards
=> operands: { amount: 3 }
```

The same symbol can therefore be reused by another amount, while operands keep
the amount, target, zone, card type/subtype, cost, choice, and optionality.
Target/zone/type differences remain different keys. Original Oracle text is
never discarded from the normal IR, and compact IR is never imported by the
rules runtime. It is a context and scheduling artifact only.

The artifact also contains a second, compositional dictionary of semantic
atoms. For example, two clauses can share `op:draw` and `zone:hand` while
retaining distinct `target:player` / `target:creature` atoms and their exact
primitive keys. This is the kanji-like layer: workers can reuse the known
operation and inspect only the differing operands instead of relearning the
whole sentence. `semantic_atom_reuse_ratio` measures this reuse. It is still
review metadata, never permission to merge effects with different targeting,
zones, types, costs, or timing.

## Commands

```powershell
npm run rules:oracle:compile
npm run rules:oracle:compact
npm run rules:oracle:benchmark:compact
python -m unittest tools/rules/test_compact_oracle_ir.py -v
```

The benchmark compares three payloads: repeated legacy text, compact IR for
every clause, and a hybrid payload. Hybrid keeps exact Oracle text for unique
or complex clauses and uses IR symbols only for repeated exact shapes. It
fails if card identities, clause order, exact primitive keys, or structured
operands change. This is important: preserving only counts could silently
turn (for example) a battlefield target into a graveyard target while still
reporting `PASS`. The comparison also materializes its input once, so
generator-based callers cannot accidentally benchmark an empty compact
payload.
On the full current catalog it reports 22,210 clause references, 9,745 exact
shapes, 47 compositional atoms, 99.9% atom reuse, and a **22.8%** worker-
context byte reduction with the hybrid payload (1,606 repeated exact shapes,
adaptive minimum frequency 2), so hybrid is recommended. The current C13
batch is measured separately: 103 review cards, 143 clause references, 24
atoms, and **7.9%** reduction with hybrid (14 repeated exact shapes, adaptive
minimum frequency 2). The benchmark tests multiple reuse thresholds per batch
and emits
`recommended_workflow` so workers do not choose by intuition.

The output reports `reuse_ratio` (repeated exact-clause references),
`semantic_atom_reuse_ratio` (repeated compositional atoms), and
`compact_to_raw_ratio` as measurements, not correctness claims. The latter
includes the explanatory symbol table and operands, so it can be larger than
the raw text when most clauses are unique; `reuse_ratio` is the useful signal
for worker scheduling. A symbol is useful only when a worker maps it to a
structured parser or profile, an authoritative executor, a scenario test with
official CR numbers, and exact `oracle_id` evidence. Never merge symbols,
clauses, or cards merely because their English text looks similar.
