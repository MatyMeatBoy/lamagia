# Handoff — habilidades activadas y ficha de campo

Fecha: 2026-09-03

## Iteración actual: cinco primitivas reutilizables

Se completó y verificó un lote de cinco primitivas distintas, para que las
cartas siguientes reutilicen el mismo vocabulario en vez de añadir casos
aislados:

- objetivos restringidos: criatura que no sea negra, criatura con flying,
  tierra no básica y permanente no criatura;
- daño a cada criatura y jugador;
- ganar X vidas;
- efecto adicional de una habilidad de maná (ganar vida);
- restricción de habilidad de maná por cantidad mínima de tierras.

El compilador Python (`tools/rules/compile_oracle_effects.py`) ahora exporta
`mana_abilities` con coste, símbolos producidos, efectos secundarios y
restricciones. Esto conserva tipos abiertos como `Equipment` sin convertirlos
en búsquedas genéricas. La referencia normativa local es CR 605 para maná y
CR 601/113 para costes, objetivos y resolución.

Validado: `npm run test --workspace=@prossh/rules` (147),
`npm run check`, `python tools/rules/test_compile_oracle_effects.py` (5).
Cobertura C13: **112/356 (31.5%)**, 244 pendientes.

La UI muestra símbolos SVG reales en cada opción de maná y una reserva visible
por color en la mesa. El modelo sigue separado para poder añadir restricciones
de gasto, buffs o habilidades disparadas al usar una fuente.

Medición local del compilador Python sobre las mismas cinco primitivas: un solo
worker 80 KB de RSS incremental máximo; cinco workers compartiendo proceso
156 KB (≈76 KB extra), con el coste de cinco workers prácticamente liviano.
Esto mide el compilador, no cinco modelos de IA independientes.

## Hallazgo confirmado: Polluted Delta

`Polluted Delta` no fallaba por el selector de biblioteca ni por su texto Oracle. El defecto estaba en el modelo de acciones:

- `packages/rules/src/engine.ts::legalActions` sólo publicaba `play-land`, `cast`, decisiones pendientes y combate.
- No generaba ninguna acción desde `player.battlefield`.
- El cliente (`apps/client/src/main.ts::onPermanentClick`) sólo sabía seleccionar objetivos/combate; si el permanente no estaba en esos modos mostraba el aviso de que no tenía acción legal.
- Las habilidades de maná sí se reconocían para el pago automático de hechizos mediante `manaSources`, pero no existía una intención del jugador para activarlas manualmente.

Consecuencia: ni `Polluted Delta` podía pagar `{T}, pagar 1 vida, sacrificar` y buscar, ni `Llanowar Elves` podía girarse para añadir `{G}`.

## Cambios ya iniciados (sin validar todavía)

Se comenzó una solución en el motor autoritativo, no un parche visual:

1. `packages/rules/src/characteristics.ts`
   - Se añadió `ActivatedAbility`.
   - Se reconoce una habilidad activada sólo cuando todos sus costes son explícitos y soportados: `{T}`, pagar vida y sacrificar la propia fuente.
   - El efecto reutiliza los templates cerrados existentes. Esto cubre el patrón de fetch lands, porque `Search your library for an Island or Swamp card, put it onto the battlefield, then shuffle.` ya encaja en `search-library`.
   - `CardProfile` ahora incluye `activatedAbilities`.

2. `packages/rules/src/engine.ts`
   - Se añadieron las intenciones `activate-mana` y `activate`.
   - Se añadieron helpers para validar el mareo de invocación al usar una habilidad `{T}` y para poner una habilidad activada no-mana en la pila.
   - `StackObject` puede marcar una activación y `resolveTop` utiliza su efecto, sin convertir la fuente en un hechizo.
   - La búsqueda de biblioteca ahora contiene `returnSourceToGraveyard`, necesario para que una fetch land sacrificada no se añada por segunda vez al cementerio al terminar la búsqueda.

## Trabajo pendiente imprescindible antes de probar

El árbol está en estado de implementación intermedia: **no se ha ejecutado TypeScript ni tests después de estos cambios**. Completar, en este orden:

1. En `legalActions`, publicar:
   - una acción por opción de cada `manaAbility` disponible de un permanente;
   - una acción por cada `activatedAbility` legal, con `cardId = permanent.instance_id` y `requiresTarget` cuando corresponda.
2. En `applyAction`, enrutar `activate-mana` a `applyActivateMana` y `activate` a `applyActivate`.
3. En el cliente:
   - incluir ambas activaciones en `actionForCard`;
   - hacer que `onPermanentClick` ejecute la acción legal o abra selección de objetivo;
   - permitir que `chooseTarget` complete también `activate`, no sólo `cast`.
4. Añadir escenarios en `packages/rules/src/engine.test.ts` antes de ampliar otros patrones:
   - `Llanowar Elves`: no usable con mareo; luego se gira y añade exactamente `{G}`.
   - `Polluted Delta`: al activar pierde 1 vida, se sacrifica, entra la habilidad a pila, permite elegir sólo Island/Swamp, baraja y pone la tierra en campo sin duplicar Delta en cementerio.
5. Ejecutar `npm run check`, `npm test` y `git diff --check`.

## UI de campo: decisión de diseño

Referencia estudiada: Arena usa iconos para comprimir habilidades y usa azul para información ganada/modificada; también prioriza P/T e indicadores por encima del texto de reglas. La implementación debe ser original: no reutilizar los iconos o archivos de Arena.

Propuesta para la siguiente iteración:

- Crear un set propio de iconos SVG para los keywords que el motor ya aplica: flying, reach, first strike, double strike, deathtouch, trample, vigilance, lifelink, menace, defender, haste, indestructible, hexproof, shroud y flash.
- Cada icono debe ser un control accesible enlazado a un panel de ayuda de keyword; el panel debe explicar regla e interacción actualmente implementada.
- Ficha de permanente: arte, marco compacto de nombre, coste de maná, P/T grande, borde según color/tipo y badges de keyword. Los keywords ganados y P/T modificados sólo deben verse en azul cuando el motor exponga la procedencia; no fingir ese estado con datos impresos.
- Básicas: glifo de maná local centrado en la franja inferior de la ficha de tierra.
- Tokens: clase visual distinta tipo lápida solamente cuando exista un token real en el estado; hoy el motor todavía no crea tokens, por lo que primero se necesita un efecto de creación y una marca de token en la proyección.
- Añadir preferencia de «detalle de ficha» para alternar entre nombre compacto y la capa ampliada de coste/P/T/iconos.

## Restricciones que no deben romperse

- El servidor sigue siendo autoritativo y nunca debe mandar bibliotecas/manos de oponentes.
- Reglas puras en `packages/rules`; ninguna interacción DOM/I/O allí.
- Cada nueva interacción de carta debe empezar por escenario de reglas y citar las Comprehensive Rules oficiales aplicables.
- Usar los enlaces de Arena sólo como referencia visual; crear iconografía propia.
