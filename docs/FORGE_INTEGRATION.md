# Forge: revisión de integración

## Resultado de la revisión

Forge publica su repositorio bajo **GNU GPLv3**. Eso permite forks y trabajos
derivados, pero exige conservar avisos, distribuir el código fuente
correspondiente y aplicar las obligaciones de GPLv3 al trabajo derivado. La
licencia de upstream es la fuente válida; el archivo local
`permiso_uso_codigo.txt` contiene una declaración sin firma ni fecha, por lo
que no se registra como autorización adicional.

En el estado actual no se ha copiado código de Forge/XMage/Phase al árbol de
ProsshTCG. La política de `AGENTS.md` exige una implementación propia y el
motor actual depende de invariantes distintas: TypeScript puro y determinista,
proyección privada por jugador y el match server como autoridad.

## Ruta técnica aprobada para este repositorio

1. Usar Forge/XMage/Phase como referencia de reglas, cobertura y escenarios,
   sin copiar implementaciones ni assets.
2. Modelar en ProsshTCG las mismas familias como primitivas estructuradas:
   eventos, cola de triggers, objetos de pila, APNAP, elecciones, objetivos,
   state-based actions y capas.
3. Comparar los resultados con escenarios independientes y con las
   Comprehensive Rules oficiales.
4. Si en el futuro se quiere incorporar literalmente un componente GPL, hacer
   una revisión de licencia separada y aislarlo como componente identificable,
   con sus avisos, fuente correspondiente y compatibilidad de licencia. Esa
   decisión no se toma implícitamente por la existencia de un archivo de
   permiso local.

La meta de cobertura sigue siendo amplia —idealmente todas las cartas que el
producto soporte—, pero cada lote debe tener definición estructurada, prueba y
resultado reproducible antes de marcarse como ejecutado.
