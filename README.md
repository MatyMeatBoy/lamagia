# La Magia

Community Magic rules engine and Commander client. Implement reusable rules
clusters, not one-off card names. Cards share logic by stable `oracle_id`, so
one good primitive improves every printing and set.

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

To refresh the reusable work queue, run `npm run rules:oracle:compile` and claim
one entry from `data/rules/oracle-clusters.json`; it already carries stable
`oracle_id`s and twenty-card commit batch counts. The compiler keeps an ignored
incremental cache, so unchanged Oracle rows are reused on later runs and the
cache is invalidated automatically when the parser version changes. To measure
the local speedup, run `npm run rules:oracle:benchmark`.

For the current C13 sprint, use `npm run rules:oracle:c13` to generate the same
queue from only the 356 cards in that set, then
`npm run rules:oracle:plan:c13` to assign five disjoint primitive clusters.

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
