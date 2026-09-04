# Commander deck generator

`tools/decks/generate_deck.py` is a library and CLI for producing deterministic
100-card Commander proposals. It uses the existing expanded deck shape (`format`,
`commanders`, and `cards`) so the result can be consumed by the current deck
import/simulator code, while adding `validation`, `category_counts`, source
metadata, and per-card `provenance`.

## Quick start

With a local catalog:

```powershell
python tools/decks/generate_deck.py `
  --catalog data/catalog/prossh.sqlite `
  --commander "Prossh, Skyraider of Kher" `
  --tier 4 --land-count 36 `
  --source-deck data/decks/commander-precons.json `
  --output data/decks/prossh-proposal.json
```

The commander may also be passed as its stable `oracle_id`. `--colors` is an
optional exact color-identity assertion (`WUBRG`, `BRG`, or `C` for colorless);
a mismatch stops generation rather than producing a misleading list. Commander
size is intentionally fixed at 100, including the commander. `--quota ramp=10
--quota draw=10` adds explicit category requirements; named quotas are
reported as shortfalls if the local sources cannot satisfy them.

`Cloud, Midgar Mercenary` is not a Scryfall card in a normal catalog. The tool
will therefore report it as unresolved until a local catalog containing that
custom card is supplied; it will not invent an ID or a legality result.

## Source adapters

The reusable `generate_deck()` function accepts source adapters, so a future pod
builder can compose lists without invoking the CLI. The shipped adapters are:

- `JsonDeckDatabaseAdapter(path)`: reads existing local JSON databases and only
  accepts decks explicitly marked `Commander`. It matches the requested
  commander, aggregates card frequency, keeps deck IDs in provenance, and
  supports `deck_ids` / `exclude_deck_ids` constraints.
- `EdhrecAdapter(cache_path=path)`: reads a local EDHREC JSON cache, including
  the repository's rank/`num_decks`-style card records. This is the recommended
  offline path.
- `EdhrecAdapter(url=url, allow_network=True)`: loads only an explicitly
  supplied public JSON URL. There is no hard-coded or undocumented EDHREC API
  endpoint, and network access is opt-in. A URL is not treated as authoritative
  unless its payload resolves through the local catalog.
- `CatalogFallbackAdapter` is used internally after source adapters. It gives a
  deterministic, clearly labelled local-catalog fallback when source data is
  absent or too small.

Library callers can compose the same pipeline directly:

```python
from pathlib import Path
from tools.decks.generate_deck import EdhrecAdapter, JsonDeckDatabaseAdapter, SQLiteCatalog, generate_deck

catalog = SQLiteCatalog(Path("data/catalog/prossh.sqlite"))
proposal = generate_deck(
    "Prossh, Skyraider of Kher", catalog=catalog,
    sources=[JsonDeckDatabaseAdapter(Path("data/decks/commander-precons.json"))],
    tier=4, land_count=36,
)
```

Tier metadata is filtered when a source labels candidates with tiers 1–5.
Unlabelled source records can remain as fallback candidates, but the output
records that the tier was not verified. Tier is a selection preference, not a
power-level guarantee or format legality claim.

## Output and guarantees

`cards` is expanded: the commander is the first item and basic lands can repeat,
matching the existing precon/import format. Every item has `oracle_id`, a chosen
printing `scryfall_id`, normalized card metadata, a generated `category`, and a
`provenance` array. Reprints merge by `oracle_id`; non-basic cards are never
duplicated. Card candidates must resolve through the local catalog, be
Commander-legal when catalog legality is available, and have color identity
contained by the commander's identity. Missing or rejected candidates appear in
`unresolved_candidates` with a reason.

The `validation` object reports:

- exact 100-card count and requested land count;
- commander resolution and local Commander legality when available;
- color-identity and singleton checks;
- category quota shortfalls;
- `legality: "verified"` only when all selected cards and the commander have
  local Commander legality data. Otherwise the result remains `status:
  "proposal"` and explicitly says legality is unverified.

The checks implement the Commander construction constraints in Comprehensive
Rules 903.4–903.6. The checked-in rules file is a local reference; verify the
current [official Wizards rules](https://magic.wizards.com/en/rules) before
publishing a generated list as tournament-legal.

## Tests

The network-free tests use `MemoryCatalog`, temporary JSON fixtures, and a
network-failing patch around the EDHREC cache path:

```powershell
python -m unittest tools/decks/test_generate_deck.py -v
```

No test constructs an HTTP source or requires `data/catalog` or `data/decks`.
