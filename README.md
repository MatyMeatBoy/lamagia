# La Magia

AI contributors: read [the quick-start contract](docs/AI_CONTRIBUTOR_QUICK_START.md)
before claiming a cluster or publishing a commit.

Community Magic rules engine and Commander client. Implement reusable rules
clusters, not one-off card names. Cards share logic by stable `oracle_id`, so
one good primitive improves every printing and set.

Published coverage is currently **10,123/38,711 unique engine profiles** and
**26,114/84,990 edition memberships (30.7%)**. The public set map uses edition
memberships; reprints therefore appear there separately even though their
rules implementation is shared. Current C13 is **292/341** and C14 is
**203/322**. See the [current handoff checkpoint](docs/HANDOFF_TO_CLAUDE.md).

The reusable offline Commander deck generator is documented in
[docs/DECK_GENERATOR.md](docs/DECK_GENERATOR.md); it composes local catalog,
imported-deck, and optional cached EDHREC sources without inventing unresolved
cards.

Rules workers use the compositional Oracle IR as a shared vocabulary. Its
benchmark selects the payload mode per batch: repeated exact shapes use
hybrid symbols while unique or complex clauses retain exact card text. The
same measured workflow applies to the full catalog and C13; no card is marked
implemented by compression alone.

## AI contributor quick start

Read [AGENTS.md](AGENTS.md), [docs/HANDOFF_TO_CLAUDE.md](docs/HANDOFF_TO_CLAUDE.md)
and [docs/WORK_CLAIMS.md](docs/WORK_CLAIMS.md). Claim one unused primitive,
work from the current `HEAD`, add scenario tests and CR citations, then publish
one focused local commit containing at most twenty new `oracle_id`s; the
integrator batches pushes:

```powershell
git add packages/rules/src tools/rules docs/HANDOFF_TO_CLAUDE.md docs/WORK_CLAIMS.md docs/SET_COVERAGE.md IMPLEMENTATION_CLUSTERS.md; git diff --cached --check; npm run check; npm test; git commit -m "feat(rules): implement <cluster> batch <nn>"
```

Report `CLAIM`, `BASE SHA`, `COMMIT SHA`, `FILES`, `TESTS`, `SCENARIOS`, and
`LIMITS`. Never stage `data/`, assets, secrets, or unrelated changes. Full
instructions: [CONTRIBUTING.md](CONTRIBUTING.md) and
[IMPLEMENTATION_CLUSTERS.md](IMPLEMENTATION_CLUSTERS.md).

Before asking for integration, run the read-only [worker commit audit](docs/WORKER_COMMIT_AUDIT.md).
Type-only declarations, repeated union variants, parser-only patches, and
commits without an executor plus scenario test are rejected and do not count as
cards.

Workers should use their available compute only for useful, test-backed
changes. Small correct primitives, executor fixes, regression scenarios, and
accurate coverage reports all count; placeholders, duplicate effect kinds,
guessed card totals, and malformed parser fragments do not.

Required direct-commit report (one cluster, at most 20 `oracle_id`s):

```text
CLAIM: c13-<primitive>
BASE: <sha>
COMMIT: <sha>
CARDS: <name> | <oracle_id>; ...
FILES: <explicit paths>
TESTS: <commands + result>
SCENARIOS: <covered cases>
LIMITS: <remaining unsupported wording>
```

Publish with `git push origin HEAD`; do not send only a card count or a stale
full-tree branch. The integrator batches 11+ commits before integration.

### Parallel bot handoff

Workers claim disjoint primitives, commit locally, and report only the compact
contract above. The integrator accumulates **11+ commits** (up to 20
`oracle_id`s each), reviews them as one batch, cherry-picks only green commits,
then runs the full checks and updates the claim ledger. Workers may keep going
after each commit, but must stop when a claim is taken. Keep bot output to one
short status line per commit; include details only for failures, blockers, or
limits. This saves context without losing reproducibility.

To refresh the reusable work queue for the whole catalog, run
`npm run rules:oracle:compile` followed by `npm run rules:oracle:plan`; claim one
entry from `data/rules/oracle-worker-plan.json`. Each card is tagged
`quick-win` when it has exactly one unresolved clause, and each cluster exposes
its quick-win count so workers can close complete cards first. The queue carries
stable `oracle_id`s and twenty-card commit batches. A rules/test-only commit may
add no completed card; the integrator must report before/after `fullyImplemented`
counts and only count a card when every clause is executable.

For the keyword backlog, run `npm run rules:keyword:audit`. It compares the
checked-in Comprehensive Rules 702 headings with engine contracts and catalog
frequency, separating implemented, partial, and backlog work. Use
[KEYWORD_COVERAGE.md](KEYWORD_COVERAGE.md) to choose a reusable primitive
instead of reimplementing a keyword per card.

For the current C13 sprint, use `npm run rules:oracle:c13` to generate the same
queue from only the 356 cards in that set, then
`npm run rules:oracle:plan:c13` to assign five disjoint primitive clusters.
For compact, reusable worker context, run `npm run rules:oracle:compact` (or
the `:c13` variant) after compiling the Oracle IR. It interns only review
symbols; it never replaces the authoritative raw text or rules engine.
When generating a scoped roadmap directly, `--set-code c13` now automatically
names claims in the `c13-*` namespace; pass `--claim-prefix` only for an
intentional shared primitive.

Coverage map: [docs/SET_COVERAGE.md](docs/SET_COVERAGE.md) and the web
“Implementation by set” view. The project is being renamed from `ProsshTCG`
to `lamagia`; use the new repository slug once GitHub finishes the rename.

## Estado inicial

Este primer corte ya incluye:

- una mesa responsive de 4 jugadores con prioridad, registro de acciones, pase automático y stop de upkeep;
- un núcleo de turnos puro y testeado para puestos 2–8, rotación de prioridad y stop points;
- un simulador determinista de pods para regresiones de zonas/turnos, con ejecución en CI;
- servidor WebSocket preparado para salas, proyecciones por jugador y una pasarela de catálogo con caché/rate limit;
- 117.621 impresiones inglesas indexadas localmente desde Scryfall, con metadatos y enlaces de imagen; un buscador por nombre/tipo con tags navegables;
- 56 perfiles de mazos cEDH competitivos importados desde la cEDH Decklist Database, con URL de la lista original;
- configuración de TRL, limitada al proyecto, para que Codex recupere trozos AST de código en vez de volcar archivos enteros.

## Ejecutar

1. Copia `.env.example` a `.env` y cambia `CATALOG_CONTACT` por un contacto real antes de publicar.
2. `npm install`
3. En una terminal: `npm run dev:server`
4. En otra terminal: `npm run dev`

Abre `http://localhost:5173`. Verificación: `npm run check`, `npm test`, `npm run build`.

Para refrescar los datos locales: `npm run catalog:sync` y `npm run decks:sync`. El catálogo se guarda en `data/` y se excluye de Git por su tamaño.

## Estructura

```text
apps/client/            UI web/PWA; futura envoltura Capacitor (Android) y Tauri (escritorio)
packages/rules/         reglas puras, deterministas y sin dependencias de red
services/match-server/  Fastify + Socket.IO; autoridad del estado y catálogo
docs/                   decisiones de producto, datos y licencias
```

Lee [el handoff de implementación](docs/HANDOFF_TO_CLAUDE.md), [la arquitectura](docs/ARCHITECTURE.md), [el plan de producto](docs/PRODUCT.md) y [la política del catálogo](docs/CARD_CATALOG.md) antes de ampliar el sistema.

## Uso de referencias externas

XMage y Argentum son referencias técnicas, no dependencias ni fuentes para copiar. Todas las imágenes y datos de cartas permanecen bajo los términos del proveedor. La app no trae arte de cartas ni lo transforma a WebP: el catálogo conserva IDs y URLs atribuidas, y el cliente solicita la imagen desde su host al verla. Cualquier mirror, precarga masiva o caché distribuida exige revisión jurídica y permiso del titular/proveedor.
