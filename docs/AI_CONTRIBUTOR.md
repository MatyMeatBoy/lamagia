# Contribuir una carta con tu LLM

Este documento es el equivalente de la idea “Contribute a Card with Your LLM”
de [Phase](https://github.com/phase-rs/phase), adaptado a ProsshTCG. Copia el
prompt de abajo en otro LLM desde la raíz del repositorio. Puede usarse para
pedir una propuesta o una implementación; el resultado siempre debe pasar por
revisión humana.

## Prompt para copiar

```text
Actúa como ingeniero de reglas y TypeScript en el repositorio ProsshTCG.

Objetivo de esta tarea:
- Carta: [NOMBRE DE LA CARTA]
- Scryfall ID estable: [SCRYFALL_ID]
- Oracle text: [ORACLE_TEXT]
- Comportamiento deseado: [DESCRIBE EL RESULTADO REGLAMENTARIO]
- Escenarios que deben funcionar: [LISTA CASOS NORMALES, OPCIONALES,
  INVALIDOS, MULTIJUGADOR Y CASOS DE INTERACCION]

Antes de tocar código lee completamente:
1. AGENTS.md
2. docs/HANDOFF_TO_CLAUDE.md
3. docs/RULES_BASELINE.md
4. docs/ARCHITECTURE.md
5. El código y las pruebas del parser/engine que correspondan.

Reglas obligatorias del proyecto:
- El servidor de partida es la autoridad. El cliente solo envía intenciones y
  renderiza su proyección; nunca envíes cartas ocultas, acciones legales o
  objetivos de otro jugador.
- packages/rules debe ser puro, determinista e independiente de I/O, reloj,
  sockets y estado de UI.
- Usa Scryfall ID/oracle_id como identidad. El nombre solo sirve para mostrar
  o buscar.
- No copies código, assets ni bases de datos de XMage, Forge, Phase, MTGO,
  Arena, Scryfall o Wizards. Puedes consultar sus comportamientos y citar sus
  licencias/documentación, pero la implementación debe ser propia.
- No simules una regla con un parche de UI. Una elección debe existir como
  acción legal validada por el engine y aparecer únicamente a quien corresponde.
- Antes de implementar, valida la regla aplicable en las Comprehensive Rules
  oficiales de Wizards y deja el enlace/número de regla en el comentario o en
  la documentación del cambio.

Proceso:
1. Busca si ya existe una primitiva estructurada para este efecto. No añadas
   regex que “adivine” texto si la semántica necesita una nueva clase de
   evento, elección, objetivo, reemplazo, trigger o capa.
2. Escribe primero escenarios ejecutables en packages/rules/*.test.ts. Incluye
   como mínimo: resolución normal, elección de no, elección/objetivo inválido,
   carta que abandona la zona, varios jugadores y una interacción con pila o
   state-based actions cuando aplique.
3. Implementa la mínima primitiva estructurada en characteristics/engine y
   actualiza legalActions, applyAction, settle, bot y projection si corresponde.
4. Si cambia la experiencia, actualiza el cliente: símbolos de maná, estados
   visibles y resaltado solo de opciones legales. No muestres texto oculto.
5. Ejecuta y reporta exactamente:
   - npm run check
   - npm test
   - npm run simulate:engine
   Si una prueba falla, corrige la causa o deja el cambio sin aplicar; no
   marques una prueba como pasada artificialmente.
6. Actualiza docs/HANDOFF_TO_CLAUDE.md con: comportamiento implementado,
   archivos, límite de cobertura, comandos y resultado.

Entrega una respuesta con:
- resumen de la regla y su fuente oficial;
- archivos modificados;
- escenarios agregados;
- comandos ejecutados y resultados;
- limitaciones que todavía no están implementadas;
- cualquier decisión que requiera revisión humana.

No abras PR, no descargues assets y no cambies datos generados salvo que el
usuario lo pida expresamente. Si el objetivo no está suficientemente definido,
propón primero una estructura de escenarios concreta y espera confirmación.
```

## Modo propuesta

Para que el LLM solo sugiera código, sustituye “Proceso” por: “No edites
archivos. Devuelve un plan, un diff unificado tentativo, escenarios de prueba,
riesgos de privacidad y comandos de verificación. No afirmes que está
implementado”.

## Checklist humano

- [ ] La carta se identifica por Scryfall ID y no por nombre.
- [ ] La prueba cubre la elección, el orden de triggers y la privacidad que
      correspondan.
- [ ] La acción aparece solo para el jugador que debe decidir.
- [ ] El cliente no determina el resultado de la regla.
- [ ] La fuente de Comprehensive Rules está citada.
- [ ] `npm run check`, `npm test` y `npm run simulate:engine` tienen resultado
      reproducible.
- [ ] El handoff declara honestamente qué sigue sin ejecutarse.
