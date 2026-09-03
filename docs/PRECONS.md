# Commander precons

`npm run precons:sync` imports every product tagged `Commander Deck` in MTGJSON's deck index. Each import must resolve its declared commander plus 99 cards against the local catalog; products with a missing card fail the import instead of being silently omitted.

The generated record links `cover_art_uri` to the display commander's Scryfall art crop. This is a polished deck visual but is **not claimed to be official box art**. MTGJSON provides sealed-product IDs but no canonical, distributable product-box asset URL in this feed. A later licensed product-art source can replace only that field without changing deck identity or contents.

Source: [MTGJSON All Decks](https://mtgjson.com/downloads/all-decks/) and its [Deck data model](https://mtgjson.com/data-models/deck/). Recheck upstream license and attribution requirements before publishing imported data.
