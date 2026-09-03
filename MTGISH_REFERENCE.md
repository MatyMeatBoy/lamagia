# mtgish — referencia de parser e IR

Referencia externa: <https://github.com/i5jb/mtgish>.

`mtgish` representa el texto Oracle con una sintaxis intermedia tipada. Su
flujo —texto normalizado → gramática reusable → IR → intérprete— es la
alternativa que adoptamos para acelerar el trabajo histórico de La Magia:
una primitiva como `SearchLibrary(subtype=Equipment, destination=Hand)` se
define una vez y se reutiliza en todas las cartas y reimpresiones que tengan
el mismo `oracle_id`.

## Aplicación en este repositorio

- `tools/rules/compile_oracle_effects.py` es nuestro inventario local y
  conserva cláusulas, familias, operandos, zonas y `primitive_cluster`; su
  salida `oracle-clusters.json` es la cola determinista para repartir trabajo.
- `packages/rules/src/characteristics.ts` es el límite de entrada: solo una
  forma estructurada cerrada puede declararse ejecutable.
- `packages/rules/src/engine.ts` aplica esa forma de manera pura y
  determinista; el texto Oracle nunca se evalúa dinámicamente en una partida.
- Las cartas que comparten una forma reciben la misma implementación; solo
  difieren los datos (cantidades, tipos, subtipos, zonas y costes).
- Las cláusulas ambiguas o únicas permanecen en la cola de revisión para una
  implementación manual con cita de Comprehensive Rules y escenario.

## Comparación y decisión

| Enfoque | Ventaja | Decisión en lamagia |
|---|---|---|
| Parser local actual | Corre offline sobre todo el catálogo, conserva `oracle_id`, operandos, zonas y estado de revisión | Adoptado para inventario, regresiones y cola de trabajo |
| IR tipada estilo mtgish | Hace explícita la separación entre sintaxis, datos y semántica ejecutable | Adoptado como dirección del IR; las primitivas aprobadas siguen cerradas en TypeScript |
| Ejecutar texto Oracle directamente | Parece rápido al principio, pero convierte ambigüedad en reglas falsas y rompe determinismo | Rechazado |
| Resolver carta por carta | Repite el mismo análisis de `Equipment`, `battlefield`, `library`, etc. | Rechazado; los workers reciben clusters |

La prueba local confirmó el beneficio operativo: sobre 38.711 cartas, ocho
procesos tardaron 3,75 s frente a 13,43 s con uno (3,58x); cinco procesos
tardaron 4,43 s y cinco hilos 10,25 s, bajo el presupuesto
de 2 GB. La salida es estable y genera `data/rules/oracle-clusters.json` para
repartir primitivas sin volver a leer cada carta desde cero.

## Qué no hacemos

No incorporamos `mtgish` como dependencia de runtime, no copiamos su código,
gramáticas ni corpus y no tratamos su salida como autoridad normativa. La CR
oficial de Wizards sigue siendo la fuente de reglas; XMage y French-Vanilla
solo sirven para contrastar comportamiento y casos borde.

## Estrategia de velocidad

1. Compilar una vez el catálogo y generar `oracle-clusters.json`, agrupado por
   `primitive_cluster`.
2. Asignar un worker a cada cluster, no a cada nombre de carta.
3. Añadir una prueba representativa y reutilizar la primitiva para el resto.
4. Exportar perfiles y cobertura C13; solo las cartas con todas sus cláusulas
   cubiertas pasan a `fullyImplemented`.
5. Reservar trabajo manual para excepciones, costes/elecciones complejas y
   efectos que necesitan estado nuevo.

Esto conserva la velocidad del parser automático sin convertir una inferencia
de texto en una regla falsa.
