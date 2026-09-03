# Exportador local de contratos de reglas

`tools/rules/compile_card_rules.py` genera un inventario local de todas las
cartas únicas del catálogo y clasifica las familias de texto que aparecen en
cada carta. En la ejecución actual procesó 38.711 cartas. También puede
combinar vectores de comportamiento escritos para ProsshTCG.

```powershell
npm run rules:compile
```

El resultado queda en `data/rules/card-rules.json`. Es un artefacto generado y
no se versiona. Cada carta conserva `oracle_id`/`scryfall_id`, texto y metadatos,
además de `families`, `requires_structured_spec` y `reference_status`.

Para medir el motor real:

```powershell
npm run rules:engine:export
```

Esta segunda salida ejecuta `cardProfile` sobre cada carta única y exporta los
perfiles que nuestro código entiende. La ejecución actual produjo 5.151 perfiles
fully implemented contando cartas sin texto y 2.090 con texto Oracle no vacío.
`fullyImplemented` es la única señal válida para afirmar cobertura; la
clasificación del primer exportador no la reemplaza.

## Vectores de referencia

Un vector no contiene Java, TypeScript ni cuerpos de clases. Sólo describe una
identidad, efectos estructurados y escenarios reproducibles:

```json
{
  "cards": [
    {
      "oracle_id": "...",
      "effects": [{"kind": "damage-any-target", "amount": 3}],
      "scenarios": [{"name": "hits a creature", "setup": {}, "actions": [], "assertions": []}]
    }
  ]
}
```

Los vectores se pueden producir al observar una implementación de referencia
con permiso, pero el motor propio debe revisarlos, citar la regla aplicable y
añadir su prueba antes de marcarlos como implementados. El exportador rechaza
campos que intenten transportar código fuente externo.
