# Revisión de triggers, ETB y capas

**Fecha:** 2026-09-03  
**Fuente normativa:** [Magic Comprehensive Rules](https://media.wizards.com/2026/downloads/MagicCompRules%2020260619.pdf), vigente desde el 19 de junio de 2026. La página oficial de [Rules](https://magic.wizards.com/en/rules) es el punto de entrada para futuras versiones.

## Decisiones de arquitectura

Forge, XMage y Phase sirven como referencias de comportamiento y de casos de
prueba, pero ProsshTCG no copia su código ni sus assets. La implementación
propia debe conservar la frontera actual: el match server decide, el cliente
solo envía intenciones, y `packages/rules` no hace I/O ni depende de UI.

El caso Frostboil Snarl ya no se trata como un trigger: “As this enters” es un
efecto de reemplazo (CR 614.1c). La elección de revelar es una acción legal del
jugador, y revelar no mueve la carta de la mano (CR 701.16a-b).

Los triggers generales necesitan extender la infraestructura actual: registrar
el evento, poner todas las habilidades disparadas en una cola, ordenar por APNAP,
resolverlas por la pila y volver a comprobar state-based actions entre pasos.
Las capas necesitan un cálculo de características continuo, dependencias y
orden de aplicación; no se deben aproximar con el orden de renderizado.

## Matriz de escenarios

| Familia | Escenario mínimo | Contrato esperado | Estado |
| --- | --- | --- | --- |
| Reemplazo al entrar | Tierra opcional: revelar tipo válido o entrar girada | La elección aparece solo al jugador activo; solo cartas válidas brillan; la carta queda en mano | Implementado y probado |
| ETB obligatorio | Criatura entra y roba una carta | Se registra un trigger; no ocurre antes de que el permanente entre; se pone en pila | Primera familia implementada y probada |
| ETB opcional | “Puedes…” con sí/no y objetivo opcional | La elección no se salta; cancelar/no elegir no ejecuta el efecto | Primera elección effect-only implementada; objetivos aún pendientes |
| Varios triggers | Dos ETB del jugador activo y uno de un oponente | APNAP; cada jugador ordena sus propios triggers; prioridad después de ponerlos en pila | Pendiente: APNAP |
| Intervening-if | Trigger con “cuando/si” y condición que cambia antes de resolver | Se dispara solo si corresponde y se vuelve a verificar al resolver | Pendiente: condiciones |
| Objetivo ilegal | El objetivo deja el campo antes de resolver | Se reevalúan objetivos y el efecto se contrarresta o resuelve parcialmente según la regla | Parcial en hechizos; pendiente en triggers |
| State-based action | ETB crea criatura 0/0 o daño letal antes de prioridad | SBAs se aplican antes de que el jugador reciba prioridad | Implementado para cuerpos; pendiente para tokens/counters |
| Capa 1 | Copiar un permanente | Se aplican efectos de copia antes de modificaciones posteriores | Pendiente: sistema de capas |
| Capas 2–6 | Control, texto, tipo, color y habilidades | Orden de capas y dependencias determinista | Pendiente: sistema de capas |
| Capa 7 | Efectos que fijan/modifican fuerza y resistencia | 7a–7e en orden; valores característicos y dependencias correctos | Pendiente: sistema de capas |
| Efecto continuo | “Las otras criaturas obtienen…” | Se recalcula al cambiar el conjunto afectado; no se congela en render | Pendiente: efectos continuos |

## Orden de implementación

1. Convertir texto de carta a definiciones estructuradas versionadas por
   `oracle_id`; empezar con ETB simples sin objetivos.
2. Extender `triggerQueue` con eventos de juego y objetos de pila que no sean
   solo hechizos de carta.
3. Añadir elecciones y objetivos para triggers con las mismas garantías de
   privacidad que `choose-reveal`.
4. Añadir APNAP y pruebas multijugador con dos o más triggers simultáneos.
5. Añadir capas y dependencias como un evaluador puro de características.
6. Ampliar familias por lotes de cartas, con una prueba de escenario por cada
   plantilla y una matriz de regresión antes de declarar cobertura.

No se debe afirmar que el motor tiene “todas las cartas” hasta que el catálogo
de definiciones estructuradas, los escenarios y la matriz de simulación lo
demuestren. El archivo `docs/AI_CONTRIBUTOR.md` está preparado para que otros
LLM ayuden a completar cada lote sin saltarse esta frontera.
