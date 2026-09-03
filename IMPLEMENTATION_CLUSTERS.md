# La Magia — clusters de implementación

Este archivo es la guía corta para que personas o modelos puedan añadir cartas
sin rehacer la arquitectura. Un cluster es una familia de texto Oracle que
comparte reglas, parser, efectos y pruebas. Se implementa el cluster, no una
lista de nombres de cartas.

## Fuente de trabajo

Los pendientes se generan desde el catálogo completo y los perfiles reales:

```powershell
npm run rules:engine:export
npm run rules:coverage:c13
npm run rules:oracle:compile
npm run rules:test:oracle
npm run rules:set:coverage
```

`data/rules/oracle-review.md` y `data/rules/coverage-c13.md` son artefactos
generados e ignorados por Git. La cláusula `unimplementedText` del perfil es la
fuente exacta para decidir qué falta; no marcar una carta completa porque solo
se reconoció una parte de su texto.

`docs/SET_COVERAGE.md` y `data/rules/set-coverage.json` agrupan por edición.
Las impresiones se deduplican por `oracle_id`: una mejora de una carta se
propaga a sus reimpresiones, mientras los pendientes siguen listados bajo cada
edición para repartir trabajo entre colaboradores. Cada edición también recibe
un grupo de producto (Jumpstart, Duel Decks, Masters/Remastered, Commander,
Secret Lair, promos, etc.) para que el mapa no mezcle productos distintos bajo
un único “otras”.

## Clusters

| ID | Alcance | Primitivas típicas |
|---|---|---|
| `mana` | producción, costes, filtros y condiciones de maná | `ManaAbility`, `ManaPlan`, pagos |
| `lands` | ETB, tipos, fetch, bounce, shock, contadores de tierras | reemplazos, búsquedas, contadores |
| `zones` | robar, descartar, exiliar, devolver y reanimar | efectos de zona y objetos |
| `targets` | restricciones, objetivos múltiples, zonas y fizzle | `TargetKind`, `legalTargets` |
| `modifiers` | P/T, tipos y habilidades hasta fin de turno | capas y limpieza |
| `counters` | poner, quitar, proliferar y SBA de contadores | estado del permanente |
| `tokens` | fichas, copias y características copiables | `TokenDefinition` |
| `triggers` | ETB, muerte, ataque, upkeep, retrasadas y condicionales | eventos, APNAP, pila |
| `keywords` | reglas 702.x reutilizables | perfil de palabra clave y combate |
| `casting` | costes alternativos/adicionales, X, kicker y modos | anuncio, pago, resolución |
| `static-layers` | efectos continuos y dependencias | capas CR 613 |

Estado inicial priorizado: tierras y maná; zonas y búsquedas; tokens; P/T y
contadores; triggers; keywords 702.2–702.21; después capas y costes
alternativos. El orden puede cambiar si una primitiva desbloquea más cartas,
pero cada cambio debe actualizar este archivo y el handoff.

## Contrato de una contribución

1. Elegir un cluster y localizar las cláusulas exactas en los reportes.
2. Consultar la CR oficial vigente y anotar la regla en el código y el test.
3. Añadir un tipo cerrado y determinista; no evaluar Oracle arbitrario en
   runtime ni llamar a APIs desde `packages/rules`.
4. Añadir primero un escenario representativo y una prueba de privacidad si
   toca una zona oculta.
5. Reutilizar la primitiva para todas las cartas equivalentes y conservar como
   pendientes las frases que todavía no se ejecutan.
6. Ejecutar `npm run check`, `npm test`, exportar perfiles y regenerar C13.
7. Hacer un commit pequeño, solo con los archivos del cluster. No añadir
   `data/` generado, secretos, arte no autorizado ni carpetas de trabajo.

## Para agentes de IA

Los objetivos de subtipo usan la forma reusable `subtype:<Subtype>`; no se crea
un `TargetKind` nuevo por cada palabra como Equipment, Aura o Goblin. La búsqueda
conserva por separado `types`, `subtypes` y `target_zone` en el IR.

La tarea debe ser: “implementa el cluster `<ID>`, empezando por estas cláusulas
exactas, con cita CR y escenarios”. El agente debe devolver cambios revisables,
no afirmar que una carta funciona por inferencia. Las identidades son IDs de
Scryfall; los nombres solo sirven para mostrar y buscar. El servidor es la
autoridad y nunca se envían cartas de mano o biblioteca del oponente.

Antes de abrir un cluster nuevo, consultar `RULES_TOOLKIT.md`,
`ACADEMY_RUINS_API.md`, `XMAGE_REFERENCE.md` y `FRENCH_VANILLA_REFERENCE.md`.
Son referencias de investigación; no son dependencias de ejecución ni
autorizan copiar código o assets.

El agente puede continuar descubriendo cartas equivalentes mientras tenga
contexto o tokens; el límite es por commit: máximo cinco `oracle_id` nuevos.
El comando y la revisión están detallados en [CONTRIBUTING.md](CONTRIBUTING.md).
