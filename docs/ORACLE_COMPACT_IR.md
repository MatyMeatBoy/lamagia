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

## Commands

```powershell
npm run rules:oracle:compile
npm run rules:oracle:compact
python -m unittest tools/rules/test_compact_oracle_ir.py -v
```

The output reports `reuse_ratio` (repeated clause references after interning)
and `compact_to_raw_ratio` as measurements, not correctness claims. The latter
includes the explanatory symbol table and operands, so it can be larger than
the raw text when most clauses are unique; `reuse_ratio` is the useful signal
for worker scheduling. A symbol is useful only when a worker maps it to a structured parser or
profile, an authoritative executor, a scenario test with official CR numbers,
and exact `oracle_id` evidence. Never merge symbols, clauses, or cards merely
because their English text looks similar.
