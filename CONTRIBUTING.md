# Contribuir a La Magia

El trabajo se reparte por clusters de reglas, no por nombres de cartas. Una
mejora de una gramática se reutiliza automáticamente en todas las ediciones y
reimpresiones que comparten `oracle_id`.

## Encargo para una persona o IA

Puede seguir trabajando mientras tenga contexto o tokens, descubriendo más
cartas y reutilizando las primitivas existentes. Primero reserva el cluster en
`docs/WORK_CLAIMS.md`; si ya está activo, elige otro. El límite es del commit:
**cada commit contiene como máximo cinco `oracle_id` nuevos** del mismo cluster.

```text
Implementa el cluster [ID] y sigue con más cartas equivalentes mientras tengas
contexto. No añadas excepciones por nombre o edición. Consulta la Comprehensive
Rules oficial, añade pruebas de escenario y conserva como pendiente cualquier
cláusula no ejecutable. Divide el resultado en commits de máximo cinco
oracle_id y ejecuta npm run check && npm test && npm run rules:set:coverage.
Entrega cada commit con CLAIM, BASE SHA, COMMIT SHA, FILES, TESTS, SCENARIOS y
LIMITS para que otro agente pueda integrarlo sin repetir trabajo.
```

Las distintas ilustraciones, marcos y sets no requieren otra implementación.
Si una carta tiene varias funciones, cuenta como pendiente hasta cubrirlas
todas.

## Un commit por cada bloque de cinco

Después de revisar el diff, el contribuyente puede publicar cada bloque con un
solo comando:

```powershell
git add packages/rules/src tools/rules docs/SET_COVERAGE.md IMPLEMENTATION_CLUSTERS.md; git commit -m "feat(rules): implement [cluster] batch [01]"; git push -u origin HEAD
```

No se deben añadir `data/`, secretos, imágenes no autorizadas ni carpetas de
trabajo. Si el cambio toca cliente o servidor, inclúyelos explícitamente en
`git add`.

## Revisión antes de sumar cobertura

El mantenedor revisa el diff, las citas CR, la privacidad y los escenarios:

```powershell
npm run check; npm test; npm run rules:engine:export; npm run rules:set:coverage; git diff --check
```

Solo si todo pasa y las cartas tienen `fullyImplemented: true` se acepta el
incremento. El gráfico web y `docs/SET_COVERAGE.md` muestran las ediciones que
heredaron la mejora y las cartas que siguen pendientes.

## Mapas

- [IMPLEMENTATION_CLUSTERS.md](IMPLEMENTATION_CLUSTERS.md): clusters y flujo para IA.
- [docs/SET_COVERAGE.md](docs/SET_COVERAGE.md): ediciones, porcentajes y pendientes.
- [RULES_TOOLKIT.md](RULES_TOOLKIT.md): fuentes de reglas y referencias técnicas.
