# XMage como referencia de comportamiento

[XMage](https://github.com/magefree/mage) es un motor open source de reglas con
Commander, multiplayer, AI, servidor autoritativo y una gran suite de tests.
Su README documenta aproximadamente 9.000 tests y el enforcement server-side.

## Qué consultar

- `Mage/src/main/java/mage/abilities/`: familias de habilidades y efectos.
- `Mage/src/main/java/mage/game/`: turnos, prioridad, pila y acciones.
- `Mage.Sets/src/main/java/mage/cards/`: implementaciones concretas de cartas.
- `Mage.Tests/src/test/java/`: escenarios de regresión y casos borde.
- Issues/PRs: bugs reales y decisiones de reglas discutidas.

## Qué extraer para ProsshTCG

- Contratos de anuncio → pago → pila → resolución.
- Orden APNAP y ventanas de prioridad.
- Eventos de zona, triggers intervening-if y state-based actions.
- Patrones de selección de objetivos, elecciones y costes alternativos.
- Escenarios de prueba, no código.

## Restricción

XMage se mantiene como referencia externa. No copiar clases, assets ni
implementaciones GPL/terceras dentro de `packages/rules`; nuestro engine debe
ser una implementación propia, pura y determinista.
