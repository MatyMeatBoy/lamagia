# Catálogo y derechos de contenido

## Modelo

- Ingesta periódica y deliberada del bulk data de Scryfall para metadatos, nunca un barrido de búsquedas por carta. `npm run catalog:sync` indexa `default_cards` de forma streaming en SQLite; incluye todas las impresiones inglesas por defecto, el texto Oracle, las relaciones de metadatos y URLs de imágenes.
- Índice propio: `oracle_id`, `scryfall_id`, nombre normalizado, tipos/subtipos, texto oracle, keywords, legalidades, set, número, artista, precios y enlaces de relaciones.
- El clic en `Elf` compone una consulta por tipo y abre la galería; no depende de texto libre ni de nombres localizados.
- Al añadir al mazo por nombre, el selector elige la impresión más reciente de un set principal elegible. La fila de mazo permite reemplazarla por cualquier impresión legal del mismo `oracle_id`.
- La wishlist guarda `oracle_id` e impresión preferida; el precio se solicita/visualiza exclusivamente en esa vista y se etiqueta con fecha/fuente.

## Scryfall

El gateway actual respeta un límite conservador de 8 solicitudes por segundo, usa `User-Agent` y `Accept` explícitos, y guarda respuestas de búsqueda brevemente. Para catálogo masivo debe usarse Bulk Data. No se harán reintentos agresivos tras 429.

No se empaquetan imágenes en el instalador, no se convierten a WebP ni se crea un CDN de imágenes. El cliente consume la URL de imagen entregada por Scryfall bajo sus términos. Antes de producción hay que obtener revisión legal de marca/copyright, política de fan content de Wizards y las condiciones vigentes de Scryfall.
