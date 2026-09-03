# ProsshTCG — kit de consulta de reglas

Índice rápido para investigar rulings complejos antes de añadir una familia al
motor. Las partidas no dependen de ninguna fuente externa: `packages/rules`
debe seguir siendo puro, determinista y sin red.

## Fuentes y uso

| Fuente | Para qué sirve | Cómo usarla |
|---|---|---|
| [Wizards Rules](https://magic.wizards.com/en/rules) | Fuente normativa oficial y versiones vigentes de CR/MTR | Confirmar el número de regla y cambios recientes |
| [Comprehensive Rules local](docs/COMPREHENSIVE_RULES.md) | Consulta offline en Markdown | Buscar por `702.x`, `603.x`, `608.x`, etc. |
| [Academy Ruins API](ACADEMY_RUINS_API.md) | CR estructurada, glosario, trazas y diferencias | Consultar JSON; refrescar el Markdown con `npm run rules:cr:sync` |
| [French-Vanilla](FRENCH_VANILLA_REFERENCE.md) | Navegador/buscador de CR y parser de reglas | Estudiar organización, búsqueda y datos locales |
| [mtgish](MTGISH_REFERENCE.md) | Gramática/IR tipada para convertir Oracle en estructuras reutilizables | Comparar formas de agrupar operandos y separar parser de engine; no copiar código/datos |
| [XMage](XMAGE_REFERENCE.md) | Implementación open source y tests de comportamiento | Comparar contratos, casos borde y orden de eventos |
| [Ability Icon wiki](ABILITY_ICON_REFERENCE.md) | Referencia visual de iconos de habilidades | Solo estudiar UX; no importar assets de Arena |

## Compilación masiva de Oracle

`npm run rules:oracle:compile` transforma todas las cartas únicas del catálogo
en `data/rules/oracle-effects.json`, un IR determinista con cláusulas,
familias, objetivos, cantidades y texto no reconocido. También genera
`data/rules/oracle-review.md` como cola para revisión asistida por IA y
`data/rules/oracle-clusters.json` como cola agrupada por primitiva. El IR no
se ejecuta directamente: cada vector aprobado debe convertirse en un tipo
cerrado de `characteristics.ts`, citar CR y recibir un escenario de prueba.

La clasificación puede procesar muchas cartas/primitivas independientes en
lotes con `--workers 8 --memory-budget-gb 2 --batch-size 256` (se puede bajar a
`--workers 1 --backend threads` para depurar). El backend por defecto usa
procesos para aprovechar varios núcleos, conserva el orden determinista y
reserva 256 MB por worker para no superar el presupuesto configurado. Es un
límite conservador del scheduler, no un hard cap del sistema operativo; un
runner local de modelos deberá añadir aislamiento/Job Objects. La VRAM no se
usa en esta fase: solo aplicará si se ejecuta un modelo local en GPU.

Benchmark reproducible: `npm run rules:oracle:benchmark`. En la medición más
reciente del catálogo completo (38.711 cartas, Windows, 2026-09-03), 1 proceso
tardó 13,43 s, 5 procesos 4,43 s, 8 procesos 3,75 s y 5 hilos 10,25 s:
aproximadamente 3,58x con el perfil de 8 procesos. El
parser sigue siendo ligero y la memoria depende del proceso/runtime; el límite
del scheduler permanece en 2 GB. La ganancia principal viene de agrupar el
trabajo por primitiva, no de crear workers ilimitados.

La misma ejecución produjo 18.254 cartas pendientes agrupadas en 11.072
clusters, con hasta veinte `oracle_id` por commit (`commit_batches` en el
manifiesto). El límite se puede ajustar con `--commit-card-limit` si una tanda
mayor sigue siendo revisable. El resultado es determinista y permite que varios forks tomen
clusters disjuntos sin repetir el análisis de cada carta.

El compilador conserva restricciones reutilizables (`types`, `subtypes` y
`target_zone`). En el motor, un objetivo de subtipo usa `subtype:<Subtype>`;
Equipment, Aura, Goblin y los subtipos futuros comparten la misma primitiva.
Cada cláusula también recibe un `primitive_cluster` estable y cada carta una
lista `primitive_clusters`; la cola Markdown agrupa cartas por esos clusters
para que un worker resuelva una primitiva una sola vez y la reutilice en todas
las cartas compatibles.

## Flujo para un efecto nuevo

1. Buscar el texto Oracle y su familia en la CR local/API.
2. Confirmar reglas de anuncio, costes, objetivos, zonas, capas y SBAs.
3. Revisar cómo XMage y French-Vanilla modelan el caso, sin copiar código.
4. Crear una definición estructurada en `characteristics.ts`.
5. Implementar el evento/efecto como función pura en `engine.ts`.
6. Añadir un escenario de reglas y una prueba de privacidad si hay información oculta.
7. Ejecutar `npm run check`, `npm test` y `npm run simulate:engine`.
8. Actualizar `docs/RULES_RESEARCH.md` y el export de cobertura.

## Prioridades actuales

- Búsquedas de biblioteca y reemplazos de entrada al campo.
- Tokens, contadores y efectos continuos.
- Habilidades de palabra clave en familias pequeñas, empezando por 702.2–702.21.
- Costes alternativos y habilidades activadas complejas.
- Capas y dependencias.

## Licencias y límites

- XMage es MIT; French-Vanilla es GPLv3. Son referencias, no dependencias del
  motor actual.
- Academy Ruins es una API de consulta; se conserva el enlace y no se usa en runtime.
- Las reglas se consultan y resumen; no se debe convertir una fuente externa en
  una afirmación de que todas las cartas están implementadas.
