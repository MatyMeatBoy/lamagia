# ProsshTCG — familias de tierras

Índice de implementación para tierras. La taxonomía proviene de la
[guía de tierras de MTG Wiki](https://mtg.fandom.com/wiki/Land), aportada como
catálogo por el proyecto. No es una fuente normativa: antes de ejecutar una
regla, verificar la versión vigente en [Wizards Rules](https://magic.wizards.com/en/rules)
y en [la CR local](docs/COMPREHENSIVE_RULES.md). Los nombres de ciclos son
atajos de diseño, no tipos de carta ni reglas por sí mismos.

## Invariantes del motor

- Una tierra puede tener varios **tipos de tierra básicos**. Cada subtipo
  `Plains`, `Island`, `Swamp`, `Mountain` o `Forest` aporta su habilidad de
  maná intrínseca; no depende de que la carta sea básica. Es por eso que un
  fetch por `Island`/`Swamp` encuentra también `Watery Grave`.
- `Basic` es un supertipo; `Wastes` es tierra básica pero no tiene tipo de
  tierra básico ni habilidad intrínseca. Sus habilidades Oracle se modelan
  normalmente.
- Las habilidades de maná no usan la pila; los demás textos activados sí,
  salvo que cumplan su definición de CR. La elección de objetivos, coste y
  visibilidad siempre ocurre en el servidor autoritativo.
- Los ciclos son patrones de Oracle. La implementación se basa en texto y
  metadatos normalizados, nunca en el nombre inglés de un ciclo.

## Matriz de soporte

| Grupo | Ejemplos / texto característico | Estado actual | Siguiente capacidad necesaria |
|---|---|---|---|
| Básicas y duales con tipos | `Island`, `Watery Grave` | Soportado: subtipos y búsqueda por tipo | Efectos que cambien tipos/capas |
| Taplands simples | “enters tapped” | Soportado | — |
| Shock lands | “unless you pay 2 life” | Soportado | — |
| Fast, slow y battle lands | condición por cantidad de tierras | Soportado en los patrones actuales | Condiciones nuevas de Oracle |
| Reveal lands | revelar carta de mano para evitar entrar girada | Soportado en los patrones actuales | Selección/revelación genérica adicional |
| Bounce lands | entra girada; devolver tierra; añade dos manás | Soportado, incluido maná fijo multicolor | — |
| Fetch lands | sacrificar, pagar vida si corresponde, buscar por tipo | Soportado para selección visible del mazo y tipos básicos | Condiciones de búsqueda no tipadas |
| Cycling lands | `Cycling {cost}` | Soportado para coste genérico | Variantes de landcycling y disparos |
| Scry lands | entra girada, `scry 1` | Pendiente | Elección determinista de scry |
| Sac / utility taplands | sacrificar para daño, fichas, búsqueda o valor | Parcial: los efectos ya estructurados funcionan | Familias de efectos específicas |
| Check, bond, tainted y verge | condición por permanentes/tierras para producir maná | Pendiente | Predicados genéricos sobre permanentes |
| Pain lands | pagar vida al producir maná coloreado | Parcial | Coste de vida en planificación automática |
| Filter lands | pagar/filtrar maná para producir combinaciones | Pendiente | Costes de maná dentro de habilidades de maná |
| Vivid | entra con contadores de carga; retirarlos para cualquier color | Soportado | — |
| Storage / depletion | contadores, acumulación y/o retirada para maná | Parcial | Añadir/mover contadores y coste de maná en habilidad |
| Manlands | activarse y volverse criatura | Pendiente | Efectos continuos de tipo/P/T/capas |
| Striplands | destruir tierra objetivo | Parcial: objetivo y destrucción; falta revisar cada texto | Restricciones de objetivo y costes |
| Pathways y MDFC | elegir cara al jugar | Pendiente | Selección de cara y características por zona |
| Legendary lands | supertipo legendario | La regla de leyenda ya es transversal | Excepciones particulares de cartas |
| Artifact/enchantment/typal/triple/guild | tipos adicionales o varios colores | Tipos normalizados; efectos Oracle se clasifican aparte | Dependencias por tipo/colores |
| Cave, Desert, Gate, Lair, Locus, Sphere, Urza | subtipos no básicos | Soportado como metadato y para búsquedas | Sinergias específicas de cada carta |

## Catálogo recibido

- Básicas: Plains, Island, Swamp, Mountain, Forest, Wastes.
- Taplands: battle, bond, bounce, check, fast, slow, reveal, sac, scry,
  shock y unlucky.
- Utilidad: fetch, guildhall, manland, stripland, utility tapland y cycling.
- Con desventaja: legendary, pain y nap.
- Con contadores: depletion y storage.
- Subtipos: Cave, Desert, Gate, Lair, Locus, Sphere, Urza's Mine,
  Power-Plant y Tower.
- Otras: artifact, dual, enchantment, filter, guild, pathway, verge,
  tainted, typal y triple.

## Método para ampliar una familia

1. Añadir un escenario de reglas representativo y cita de CR oficial.
2. Extender el IR/parser solo con una construcción de Oracle verificable.
3. Convertirla a un tipo cerrado del motor y resolverla de forma pura.
4. Marcar la cláusula exacta como implementada; texto restante sigue pendiente.
5. Ejecutar pruebas, comprobación de tipos y exportar cobertura.

Una familia no se declara completa por reconocer parte del texto: los perfiles
guardan las cláusulas Oracle todavía no ejecutables para impedir falsos
positivos.
