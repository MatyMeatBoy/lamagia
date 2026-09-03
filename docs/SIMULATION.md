# Simulación de regresión

`packages/rules/src/simulator.ts` ejecuta pods de 2–8 con una semilla reproducible, conserva zonas de 100 cartas y detecta pérdida/duplicación de cartas, vida inválida y secuencias no deterministas. `npm test` la ejecuta continuamente.

No es un sustituto del motor de reglas de Magic: las cartas se clasifican por roles abstractos y no se debe exponer esa salida como resultado de una partida legal. Su misión es romper temprano integraciones de mazo, zonas, prioridad y sincronización, mientras el motor de reglas va incorporando efectos por primitivas y escenarios verificables.

El comando `npm run simulate:cedh` utiliza cuatro listas cEDH de 100 cartas resueltas localmente; su resultado mantiene 100 cartas en cada jugador y es reproducible por semilla. Modela una presión de combate simple y la línea Oracle + Consultation/Pact sólo como smoke test de integración, nunca como veredicto de reglas.
