# Mazos competitivos de referencia

`npm run decks:sync` descarga los perfiles marcados **COMPETITIVE** por cEDH Decklist Database a `data/decks/cedh-ddb.json`. El archivo conserva comandante(s), descripción, fecha y URL original de cada decklist, junto con atribución MIT.

No se hace scraping de Moxfield u otros hosts de listas: sus APIs públicas no son un contrato de integración. La app tendrá un importador explícito de texto/Moxfield para que el jugador autorice importar una lista concreta. Un perfil disponible no implica que sus 100 cartas ya sean ejecutables por el motor; esa cobertura debe ser medida por carta/mecánica y bloqueada si es incompleta.

Para un pod reproducible de cuatro listas completas, `npm run decks:pod:sync` importa 99+comandante de cuatro listas publicadas por el proyecto MIT `KonradHoeffner/cedh`, y resuelve cada nombre contra la base local. `npm run simulate:cedh` las somete al simulador de regresión de metadatos; conserva todas las zonas y produce un log auditable, pero no afirma aplicar reglas completas de Magic.
