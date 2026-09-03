# mtg-mcp: referencia opcional para debugging

Fuente: [nathanmartins/mtg-mcp](https://github.com/nathanmartins/mtg-mcp).

## Para qué sirve

`mtg-mcp` es un servidor MCP externo orientado a Commander. Expone consultas de cartas Scryfall, rulings, Comprehensive Rules, legalidad y validación de mazos. Puede ayudar a investigar por qué una carta C13 o histórica fue clasificada como `needs-review`.

Consultas útiles:

- `get_card_details`: comparar Oracle, tipos, coste, colores e identidad.
- `get_card_rulings`: buscar aclaraciones específicas de una carta.
- `search_rules` / `get_rule`: localizar la regla CR relevante.
- `search_cards`: encontrar cartas con el mismo patrón de texto para ampliar un parser.
- `validate_deck`: comprobar que un mazo importado conserva sus restricciones.

## Flujo recomendado en ProsshTCG

1. Identificar la carta por `oracle_id`/Scryfall ID en `data/rules/coverage-c13.md`.
2. Consultar Oracle y rulings con `mtg-mcp`.
3. Consultar la regla oficial de Wizards y registrar la referencia en el test o markdown correspondiente.
4. Convertir el texto a un efecto cerrado y determinista en `packages/rules/src/characteristics.ts`.
5. Añadir un escenario en `packages/rules/src/*.test.ts`.
6. Ejecutar `npm test`, `npm run check`, `npm run rules:engine:export` y la auditoría de cobertura.

El MCP solo es una fuente de investigación. No escribe estados de partida, no decide acciones legales y no sustituye al servidor autoritativo ni a los tests.

## Instalación opcional

El repositorio documenta un binario Go con transporte stdio. Si se instala localmente, se debe registrar el ejecutable en el cliente MCP con un nombre como `mtg-commander`. No se añade como dependencia de producción de ProsshTCG.

Antes de usarlo en una revisión:

- verificar la versión/revisión del repositorio;
- preferir la fuente oficial de Wizards para Comprehensive Rules;
- tratar Scryfall y cualquier respuesta MCP como datos externos no confiables;
- no enviar manos, bibliotecas, mazos privados ni estados ocultos de otro jugador;
- no copiar una interpretación directamente al runtime sin test y cita de regla.

## Plantilla de revisión

```text
Carta: <nombre> (<oracle_id>)
Texto Oracle: <texto>
Herramienta: get_card_rulings / search_rules / get_rule
Regla: <número CR y enlace oficial>
Familia: <tokens | zonas | daño | counters | ...>
Efecto interno: <SpellEffect / ActivatedAbility / TriggerDefinition>
Caso límite: <objetivos ilegales, APNAP, ETB, reemplazos, etc.>
Test: <nombre del escenario>
```
