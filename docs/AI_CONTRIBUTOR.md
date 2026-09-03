# Contribuir una carta con tu LLM

Este documento es el equivalente de la idea “Contribute a Card with Your LLM”
de [Phase](https://github.com/phase-rs/phase), adaptado a lamagia (antes
ProsshTCG). Copia el
prompt de abajo en otro LLM desde la raíz del repositorio. Puede usarse para
pedir una propuesta o una implementación; el resultado siempre debe pasar por
revisión humana.

## Prompt para copiar

```text
Actúa como ingeniero de reglas y TypeScript en el repositorio lamagia.

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

## Paralelizar y depurar automáticamente

Un fork de esta tarea conserva el contexto terminado hasta el momento del fork,
pero no comparte memoria viva ni integra cambios automáticamente. Para avanzar
varias primitivas, usa tareas/worktrees separados con alcance sin solapamiento:

- consulta y actualiza `docs/WORK_CLAIMS.md` antes de editar; publica el claim
  primero para que otro worker lo vea rápidamente;
- un worker por cluster reutilizable o por lote de cartas;
- cada worker lee este documento y `docs/HANDOFF_TO_CLAUDE.md`, añade escenarios,
  actualiza el mapa de cobertura y deja un commit pequeño;
- este task actúa como integrador: revisa el diff, ejecuta las pruebas y fusiona
  solo cambios verdes;
- nunca permitas que dos workers editen simultáneamente la misma primitiva,
  fixture o archivo generado.

El workflow `.github/workflows/codex-debug.yml` ejecuta un diagnóstico de Codex
en cada PR y publica un comentario con fallos reproducibles, causa probable y
pruebas faltantes. Requiere configurar el secreto `OPENAI_API_KEY` en GitHub.
El debugger es de solo lectura respecto al PR: diagnostica y propone, pero no
comete ni fusiona cambios. El workflow `verify.yml` sigue siendo la barrera
obligatoria de compilación y pruebas.

## Entrega segura del worker e integración

El worker no entrega una carpeta modificada: entrega un commit reproducible.
Esto permite que el integrador revise exactamente el cambio y lo aplique con
`cherry-pick`, incluso si otro worker ya terminó un cluster distinto.

### Instrucción para copiar al fork

```text
Trabaja únicamente en el claim [CLAIM_KEY] y en estos archivos/cartas:
[SCOPE]. No toques otros claims ni archivos generados.

Antes de editar:
1. Lee AGENTS.md, docs/HANDOFF_TO_CLAUDE.md y docs/WORK_CLAIMS.md.
2. Confirma que tu rama parte de la rama integradora publicada:
   feat/activated-abilities-and-triggers.
3. Publica o confirma tu claim antes de implementar.

Antes de entregar:
1. Añade escenarios de reglas y cita la Comprehensive Rule aplicable.
2. Ejecuta npm run check, npm test y npm run simulate:engine.
3. Comprueba git diff --check y revisa git diff --stat.
4. No incluyas cambios no relacionados, ChromaKey/ ni apps/client/public/.
5. Haz un único commit pequeño y no cambies su historial después de publicarlo.

Entrega solo este informe: claim key, base SHA, commit SHA, archivos,
escenarios, comandos/resultados y límites pendientes. Si algo falla, no digas
que está listo: explica el fallo y deja la rama sin un commit engañoso.
```

### Comando de entrega del worker

Después de revisar que los archivos son los del claim, el worker puede usar
este comando en PowerShell 7 o Git Bash. Sustituye las rutas por archivos
explícitos; nunca uses `git add -A` ni `git add .`:

```text
git add -- <archivo-1> <archivo-2> && git diff --cached --check && git commit -m "feat(rules): implement <cluster>" && git push -u origin HEAD
```

Antes de ese comando debe haber ejecutado las pruebas. El mensaje de entrega
obligatorio es:

```text
CLAIM: rules-example
BASE: <sha de la rama integradora usada>
COMMIT: <sha exacto publicado>
FILES: <lista explícita>
TESTS: check=PASS; test=PASS; simulate=PASS
SCENARIOS: <lista breve>
LIMITS: <lo que sigue sin soportar>
```

Una vez publicado el commit, el worker no debe hacer `rebase`, `reset` ni
`push --force`: el SHA es el contrato que usa el integrador. Si necesita
corregir algo, entrega un commit posterior claramente relacionado.

### Comando del integrador

El integrador verifica el commit antes de aplicarlo y no copia cambios a mano:

```text
git fetch origin <worker-branch>
git show --stat --oneline <commit-sha>
git diff <base-sha>..<commit-sha> --check
git cherry-pick <commit-sha>
npm run check && npm test && npm run simulate:engine
```

Si el `cherry-pick` tiene conflicto, se conserva la semántica de ambos claims,
se resuelve de forma explícita y se repiten las tres validaciones. Si no puede
resolverse con seguridad: `git cherry-pick --abort`, se devuelve el SHA al
worker y no se fuerza la integración. Tras una integración verde, se cambia el
claim a `merged` en `docs/WORK_CLAIMS.md`, anotando el SHA integrado, y se
actualiza `docs/HANDOFF_TO_CLAUDE.md`.

Codex permite revisar una rama, un commit o los cambios preparados sin alterar
el árbol; el panel de revisión también permite preparar solo los fragmentos
aceptados. Ver la [guía oficial de revisión de código de Codex](https://learn.chatgpt.com/es-419/docs/code-review).
