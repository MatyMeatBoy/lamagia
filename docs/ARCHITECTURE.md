# Arquitectura base

```text
Cliente web / Android / escritorio
   │ intentos de jugador + autenticación
   ▼
Match server (autoridad) ──► proyección filtrada por asiento ──► Socket.IO
   │
   ├── motor puro: validar intención → evento(s) → estado nuevo
   ├── Redis/PostgreSQL (siguiente hito: perfiles, salas, torneos)
   └── gateway de catálogo: Scryfall, caché de metadatos y rate limit
```

## Límites no negociables

1. El servidor conserva biblioteca, mano, información de búsqueda y acciones legales completas; cada jugador recibe sólo su proyección.
2. Cada cambio es un evento versionado. La reconexión se hace por `matchVersion`, no enviando mutaciones de UI.
3. `packages/rules` no conoce Scryfall, sockets ni base de datos.
4. Una carta se identifica por `oracle_id` (concepto de juego) y una impresión/arte por `scryfall_id`. Los tipos, subtipos, keywords, colores, set y artista son metadatos navegables.

## Roadmap técnico

1. Vertical slice: lobby, mazos importados, prioridad/pila, tierras y criaturas con escenarios.
2. Persistencia: perfiles, auth, mazos, favoritos y colecciones deseadas; precios sólo en wishlist.
3. Reglas: efectos por primitivas, acciones basadas en estado, combate, disparadas, reemplazos y capas.
4. Online: reconexión, reloj, ranking, moderación, torneos Swiss/eliminación y medallas propias inspiradas en colores de maná.
5. Empaquetado: PWA, Capacitor Android y Tauri Windows/macOS/Linux desde el mismo cliente.

