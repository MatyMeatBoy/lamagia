# Contribuir a La Magia

Para bots y forks, empieza por [AI Contributor Quick Start](docs/AI_CONTRIBUTOR_QUICK_START.md);
es el contrato corto y actualizado para entregar commits directos integrables.

El trabajo se reparte por clusters de reglas, no por nombres de cartas. Una
mejora de una gramática se reutiliza automáticamente en todas las ediciones y
reimpresiones que comparten `oracle_id`.

## Encargo para una persona o IA

Puede seguir trabajando mientras tenga contexto o tokens, descubriendo más
cartas y reutilizando las primitivas existentes. Primero reserva el cluster en
`docs/WORK_CLAIMS.md`; si ya está activo, elige otro. El límite es del commit:
**cada commit contiene como máximo veinte `oracle_id` nuevos** del mismo cluster.

```text
Implementa el cluster [ID] y sigue con más cartas equivalentes mientras tengas
contexto. No añadas excepciones por nombre o edición. Consulta la Comprehensive
Rules oficial, añade pruebas de escenario y conserva como pendiente cualquier
cláusula no ejecutable. Divide el resultado en commits de máximo veinte
oracle_id y ejecuta npm run check && npm test && npm run rules:set:coverage.
Entrega cada commit con CLAIM, BASE SHA, COMMIT SHA, FILES, TESTS, SCENARIOS y
LIMITS para que otro agente pueda integrarlo sin repetir trabajo.
```

Las distintas ilustraciones, marcos y sets no requieren otra implementación.
Si una carta tiene varias funciones, cuenta como pendiente hasta cubrirlas
todas.

El plan global marca como `quick-win` cada carta con una sola cláusula Oracle
pendiente. Prioriza esos IDs dentro de su cluster: una primitiva correcta puede
cerrar varias cartas de golpe. No confundas una primitiva nueva con una carta
cerrada; comprueba el export de perfiles antes y después.

## Un commit por cada bloque de veinte

Después de revisar el diff, el contribuyente puede publicar cada bloque con un
solo comando:

```powershell
git add packages/rules/src tools/rules docs/SET_COVERAGE.md IMPLEMENTATION_CLUSTERS.md; git commit -m "feat(rules): implement [cluster] batch [01]"
```

Publica cada commit en el remoto para que el integrador pueda recogerlo; los
commits se acumulan y se integran juntos después de la revisión.

No se deben añadir `data/`, secretos, imágenes no autorizadas ni carpetas de
trabajo. Si el cambio toca cliente o servidor, inclúyelos explícitamente en
`git add`.

## Formato único de entrega directa

El commit debe llegar acompañado de este bloque, sin resumen ambiguo de
"cartas funcionales":

```text
CLAIM: c13-<primitive>
BASE: <sha exacto usado antes de editar>
COMMIT: <sha publicado>
CARDS:
- <Card name> | <oracle_id>
FILES: <lista explícita>
TESTS: <comandos y resultado>
SCENARIOS: <casos cubiertos>
LIMITS: <texto o cartas todavía no soportados>
```

Un commit contiene un solo cluster y como máximo 20 `oracle_id`. El worker
debe publicar el commit (`git push origin HEAD`) y puede continuar con otro
cluster solo después de actualizar `BASE` y reclamarlo. Comando recomendado:

```powershell
git add packages/rules/src/characteristics.ts packages/rules/src/engine.ts packages/rules/src/*test.ts docs/WORK_CLAIMS.md; git diff --cached --check; npm run check; npm test; git commit -m "feat(rules): implement <primitive> batch <nn>"; git push origin HEAD
```

No uses `git add -A` ni incluyas archivos generados. El integrador reúne 11 o
más commits publicados, revisa cada bloque y actualiza cobertura antes de
integrarlos.

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
