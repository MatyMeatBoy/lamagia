# Fuentes de reglas y estrategia de implementación

## Fuentes disponibles

- **Comprehensive Rules oficial:** [Wizards Rules](https://magic.wizards.com/en/rules).
- **Consulta estructurada:** [Academy Ruins API](https://github.com/lunakv/academyruins-api),
  que publica versiones de CR, MTR e IPG y una representación JSON de la CR.
- **Snapshot Markdown local:** `docs/COMPREHENSIVE_RULES.md`, generado con:

  ```powershell
  python tools/rules/sync_comprehensive_rules.py
  ```

- **Referencia de comportamiento:** [XMage](https://github.com/magefree/mage) y
  [French-Vanilla](https://github.com/didymusbenson/French-Vanilla). Se estudian
  contratos y escenarios; no se copia código en `packages/rules`.
- **Referencia de arquitectura de parser:** [mtgish](https://github.com/i5jb/mtgish).
  Su separación texto → IR → intérprete respalda nuestro compilador Python por
  clusters; no es dependencia ni fuente de código/datos.

## Cómo se usará Academy Ruins

La API sirve para consultar el significado normativo de una regla al diseñar un
efecto, verificar una regresión y detectar cambios entre versiones. No se llama
desde el cliente, el servidor ni el motor: las partidas deben seguir siendo
deterministas y funcionar sin red.

Cada nueva familia debe aportar:

1. una definición estructurada en `packages/rules/src/characteristics.ts`;
2. un evento, coste o efecto puro en `packages/rules/src/engine.ts`;
3. una prueba de escenario con el número de regla relevante;
4. una actualización honesta de `docs/RULES_RESEARCH.md` y del export de cobertura.

## Próxima prioridad desde XMage

1. Corregir y ampliar búsquedas de biblioteca: candidatos visibles durante la
   elección, incluyendo tierras no básicas que tengan el subtipo buscado;
2. efectos de reemplazo y entradas al campo;
3. tokens y contadores;
4. costes alternativos y habilidades de palabra clave por familias pequeñas;
5. capas y efectos continuos.

La visualización completa de la biblioteca durante una búsqueda es una decisión
de privacidad explícita: solo se incluye en la proyección del jugador que está
resolviendo esa búsqueda, nunca en las proyecciones de oponentes.
