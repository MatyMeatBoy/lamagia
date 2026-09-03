# Academy Ruins API

Fuente estructurada para consultar reglas de Magic: [repositorio](https://github.com/lunakv/academyruins-api)
· [documentación](https://api.academyruins.com/docs).

## Endpoints útiles

| Endpoint | Uso |
|---|---|
| `GET https://api.academyruins.com/cr` | CR completa como JSON indexado por número |
| `GET https://api.academyruins.com/cr/{rule_id}` | Regla concreta, por ejemplo `702.2` |
| `GET https://api.academyruins.com/cr/keywords` | Índice de keywords |
| `GET https://api.academyruins.com/cr/glossary` | Glosario |
| `GET https://api.academyruins.com/cr/trace/{rule_id}` | Relaciones/traza de una regla |
| `GET https://api.academyruins.com/diff/cr` | Cambios entre versiones |
| `GET https://api.academyruins.com/link/cr` | Enlace a la versión CR actual |

## En el repo

```powershell
npm run rules:cr:sync
```

Esto genera `docs/COMPREHENSIVE_RULES.md`. El script está en
`tools/rules/sync_comprehensive_rules.py`; solo descarga y renderiza referencia
Markdown, nunca se importa desde el engine ni el servidor.

## Consulta recomendada

Para un caso complejo, consultar primero la regla de keyword (`702.x`), después
las reglas generales de habilidades (`603.x`), objetivos/resolución (`601.x`,
`608.x`), zonas (`400.x`), SBAs (`704.x`) y capas (`613.x`) según corresponda.
