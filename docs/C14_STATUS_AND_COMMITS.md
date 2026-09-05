# Commander 2014 (C14) — estado y commits (rama `c14-batch2-clean`)

**Trabajo detenido a pedido del usuario.** Este documento es solo un registro de lo ya hecho, para que el integrador (codex/main) lo revise. No se hará más trabajo en esta rama hasta nueva indicación.

- Rama: `c14-batch2-clean` (worker `claude-c14`)
- Base: `b05c1b48a78c98fc0ba2123bc5c343b87ff1eeb7` (creada desde `origin/feat/activated-abilities-and-triggers` en un punto que luego quedó ~212 commits atrás de esa rama)
- HEAD actual: `af82c1f4cecf416047fdcf3df9dbb9a9b2e197a7`
- Estado: local = remoto (`origin/c14-batch2-clean`), sin commits pendientes de subir.
- Cobertura verificada (regenerada justo antes de este documento, con el código de este HEAD): **241/337 cartas C14 con `fullyImplemented: true`**.
- Gate verde en el último commit: `npm run check`, `npm test --workspace=@prossh/rules` (277 tests), `npm run simulate:engine` (200/200), `npm run rules:test:oracle` (25/25).

## ⚠️ Aviso para el integrador

Esta rama **no fue reconciliada** con el estado actual de `feat/activated-abilities-and-triggers` (que avanzó ~212 commits mientras se trabajaba aquí). Antes de fusionar cualquier commit de esta lista:

1. **Dos commits duplican trabajo ya hecho en `feat/activated-abilities-and-triggers`** (implementación más completa allá) — no cherry-pickear:
   - `f326a02` "feat(rules): Flashback (cast from graveyard, then exile)"
   - `795589e` "feat(rules): up-to-N basic land fetch onto the battlefield"
2. Cualquier otro commit puede tener conflictos de merge por el desfase de 212 commits — revisar caso por caso, no fusionar la rama entera de un tirón.
3. El resto de primitivas (ver tabla) fueron chequeadas contra `feat/activated-abilities-and-triggers` por palabra clave (grep) al momento de cada commit y no se encontró duplicado, pero no hay garantía total dado el desfase.

## Commits de esta rama (orden: más nuevo primero)

Cada commit es autocontenido (build + tests + sim + oracle en verde). La columna "Cartas" son las nombradas explícitamente en el mensaje del commit; muchas primitivas también destraban cartas de catálogo no-C14 o cartas C14 no nombradas como efecto secundario (columna "+catálogo" cuando el mensaje lo indica).

| Commit | Asunto | Cartas C14 nombradas |
|---|---|---|
| `af82c1f` | consume Storm keyword line + target-player sac-attacker | Wing Shards (+19 catálogo) |
| `2b0cdc4` | 'draw N. If you do, discard M' wording | Mask of Memory |
| `5e75436` | board-wide attack requirement + attacking-creatures pump | Warmonger Hellkite (+9 catálogo) |
| `a4730c9` | random creature return from graveyard | Haunted Fengraf |
| `d5daf9a` | sacrifice-then-draw + reanimate-own-best | Infernal Offering |
| `b7df53f` | Benevolent Offering (create-token genérico + vida por criatura) | Benevolent Offering |
| `fe7e02e` | 'Choose an opponent' symmetric effects (ciclo Offering) | Intellectual Offering, Sylvan Offering |
| `7f096ba` | mass destroy then reanimate one | Necromantic Selection |
| `018be85` | power filter en la criatura que entra | Mentor of the Meek |
| `ceec4fb` | life-total CDA + shuffle-source-into-library | Serra Avatar |
| `942eef7` | skip-next-untap mass tap | Breaching Leviathan |
| `a2a56b3` | 'cast it from your hand' ETB gate | Angel of the Dire Hour |
| `011de0e` | X-scaled drain/pump activated ability | Drana, Kalastria Bloodchief |
| `953bcdb` | docs: aviso de 2 commits duplicados con upstream | (documentación) |
| `0cc2612` | kicked copy count | Rite of Replication |
| `ba35c3e` | token copy de una criatura objetivo | Cackling Counterpart |
| `595a49b` | coste `{X}` en habilidades activadas | Silklash Spider (+catálogo) |
| `daf88a8` | tierras extra por turno + sacrificar tierra como coste | Harrow |
| `795589e` | ⚠️ **DUPLICADO — no integrar** (búsqueda múltiple de tierras) | Burnished Hart, Myriad Landscape (+14 catálogo) |
| `ed227ad` | reanimar un permanente de bajo coste | Sun Titan |
| `30c9346` | keyword Rebound | Nomads' Assembly (+12 catálogo) |
| `30f8687` | destrucción múltiple de criaturas | Dregs of Sorrow |
| `02ec161` | gate de activación por tierras del oponente | Tectonic Edge |
| `74853cd` | valor de maná de artefacto sacrificado + strip de rampa | Bosh Iron Golem, Ghost Quarter |
| `696ccd6` | ETB de sacrificio (Disciple of Bolas) | Disciple of Bolas |
| `7423a65` | daño a cada volador + asignar como no bloqueado (por criatura) | Tornado Elemental (+16 catálogo) |
| `e363e98` | rebote de hasta N criaturas | Hoverguard Sweepers |
| `3fbef33` | sacrificio-drenaje de mantenimiento | Xathrid Demon |
| `6164506` | devolver todo el cementerio a la mano | Praetor's Counsel |
| `57dc1aa` | Syphon Mind, Tendrils, strip de "no puede regenerarse" | Syphon Mind, Tendrils of Corruption, Nekrataal |
| `f3620df` | poder de criatura sacrificada alimenta habilidades activadas | Ghoulcaller Gisa |
| `598d519` | daño a planeswalkers + Magmaquake | Magmaquake |
| `f69d06b` | sacrificio de cada oponente + Condemn | Butcher of Malakir, Condemn |
| `36e2c0b` | consumir línea de keyword Split second | (+8 catálogo) |
| `df32e9a` | devoción, CDA verde, "no puedes perder" | Gray Merchant of Asphodel, Drove of Elves, Abyssal Persecutor |
| `603232b` | Oblation + descarte-salvo-tierra | Oblation, Compulsive Research |
| `7bdb44e` | keywords Undying y Persist | (keyword genérico, +22 catálogo) |
| `7381dde` | rebote múltiple sin tierra | Aether Gale, Distorting Wake |
| `ab0fce7` | coste adicional de exilio de cementerio + token por mano rival | Skeletal Scrying, Wolfcaller's Howl |
| `9db5385` | asignar daño de combate como no bloqueado | Siege Behemoth |
| `5d53c73` | extort concedido | Pontiff of Blight |
| `93f43cc` | remoción de contadores + -1/-1 por tierra | Black Sun's Zenith, Vampire Hexmage, Aether Snap |
| `f326a02` | ⚠️ **DUPLICADO — no integrar** (Flashback) | Faithless Looting (+~60 catálogo) |
| `7f4f3f4` | destrucción masiva con gate de X + Incite Rebellion | Martial Coup, Incite Rebellion |
| `c053508` | tokens escalados por muertes | Fresh Meat, Spoils of Blood |
| `ca4490c` | bloqueo de acciones del oponente + robo por maná mayor | Grand Abolisher, Rush of Knowledge |
| `32b96f9` | disparadores Morbid + objetivo no-Demonio | Reaper from the Abyss |
| `95e8b8c` | contador de criaturas muertas este turno (Morbid) | Tragic Slip |
| `43b3fae` | tokens por equipo + gate de disparador por subtipo | Kemba Kha Regent, Emeria the Sky Ruin |
| `322f1d5` | debuff masivo escalado por pantano + emblema por contadores | Mutilate, Beastmaster Ascension |
| `8487418` | prevención total de daño de combate | Fog Bank, Sphinx of Jwar Isle |
| `9132746` | disparador "entra o ataca" | Grave Titan |
| `7bea808` | "mirar N arriba, una a la mano, resto abajo" | Sea Gate Oracle |
| `655b65e` | más efectos compuestos de habilidad activada | Sphinx of Magosi, Armistice |
| `c84ec95` | Lieutenant (Commander 2014) | Angelic Field Marshal, Thunderfoot Baloth |
| `2326e87` | disparador "otra criatura no-<Subtipo> muere" | Requiem Angel |
| `c8749b1` | filtros de disparador por subtipo de hechizo / nontoken | Lys Alana Huntmaster, Soul of the Harvest |
| `513e70e` | efectos de objetivo escalados por subtipo (todo el campo) | Timberwatch Elf |
| `1169fb2` | pump masivo estilo Overrun + normalización de subtipo plural | Overrun, Overwhelming Stampede |
| `c711a32` | destrucción por umbral de poder + token escalado por tablero | Fell the Mighty, Deploy to the Front |
| `c4347de` | pump/contador de objetivo escalado por subtipo | Timberwatch Elf, Immaculate Magistrate |
| `1f1af45` | coste de activación "sacrificar una tierra" | Sylvan Safekeeper |
| `312ecfe` | disparadores de hechizo filtrados por color | Titania's Chosen |
| `2fe4f92` | vida por subtipo + disparadores "criatura que controlas entra" | Wellwisher, Cathars' Crusade |
| `4f60668` | keywords estáticos más amplios + disparadores de entrada | True Conviction, Mobilization, Elvish Archdruid, Essence Warden |
| `42ed8c9` | coste de activación "descartar una carta" | Trading Post |
| `ce86f11` | "destruir criatura, su controlador crea token" | Pongify, Afterlife |
| `9cb7170` | retorno de instant/sorcery + robo escalado por cementerio | Call to Mind, Grim Flowering |
| `bebb10e` | remoción no-artefacto/no-negro, arrase de voladores, robo+pérdida | Nekrataal, Shriekmaw, Whirlwind, Sign in Blood |
| `6e31151` | habilidades de maná escaladas por subtipo | Priest of Titania, Magus of the Coffers |
| `0185b50` | emblemas de color y subtipo (P/T) | Bad Moon, Imperious Perfect |
| `3979944` | rebote de tierras Karoo | Karoo, Coral Atoll, Everglades, Jungle Basin, Dormant Volcano |
| `2468728` | habilidades disparadas de "criatura equipada" | Skullclamp, Moonsilver Spear, Argentum Armor |
| `2318d3c` | efecto add-mana + coste "sacrificar un artefacto" | Cathodion, Phyrexia's Core |
| `810173b` | poder/resistencia característicos (CDA) | Geist-Honored Monk |
| `26bba29` | "criatura objetivo no puede bloquear este turno" | Panic Spellbomb |
| `175ee62` | disparadores "entra o muere" + "deja el campo de batalla" | Ichor Wellspring, Spitebellows |
| `7d879d7` | docs: registro de claims (sin cambio de código) | — |
| `d98a87f` | habilidades de lealtad de planeswalker | Freyalise, Llanowar's Fury |
| `fa44b87` | bono estático de maná de tierra básica | Crypt Ghast, Nirkana Revenant |
| `4992925` | Extort | (keyword genérico) |
| `95c912c` | Evoke | Mulldrifter, Shriekmaw |
| `727fe47` | arrase de tapadas + maná de identidad de comandante | Sunblast Angel, Commander's Sphere |
| `ccc5268` | disparador de auto-retorno desde cementerio + robo/pérdida compuesto | Fool's Demise, Spine of Ish Sah |
| `5a6b506` | reducción estática de coste estilo Medallion | ciclo Medallion completo |
| `8def468` | reducción de coste propio escalada por tablero | Blasphemous Act |
| `d3dae63` | "Destruir permanente objetivo" genérico + auto-rebote ETB | Unstable Obelisk, Whitemane Lion |
| `008a772` | kicker, disparadores de coste opcional, robar-luego-descartar, hechizos de auto-zona | (batch base, muchas cartas) |

## Las 241 cartas C14 con `fullyImplemented: true` (orden alfabético)

Abyssal Persecutor, Aether Gale, Aether Snap, Afterlife, Angel of the Dire Hour, Angelic Field Marshal, Annihilate, Argentum Armor, Armistice, Azure Mage, Bad Moon, Barren Moor, Beastmaster Ascension, Beetleback Chief, Benevolent Offering, Black Sun's Zenith, Blasphemous Act, Bloodgift Demon, Bojuka Bog, Bosh Iron Golem, Bottle Gnomes, Breaching Leviathan, Buried Ruin, Burnished Hart, Butcher of Malakir, Cackling Counterpart, Call to Mind, Cathars' Crusade, Cathodion, Charcoal Diamond, Collective Unconscious, Commander's Sphere, Compulsive Research, Concentrate, Condemn, Coral Atoll, Crypt Ghast, Crystal Vein, Darksteel Citadel, Deploy to the Front, Desert Twister, Disciple of Bolas, Dismiss, Distorting Wake, Dormant Volcano, Drana Kalastria Bloodchief, Dreamstone Hedron, Dregs of Sorrow, Drifting Meadow, Drove of Elves, Elvish Archdruid, Elvish Mystic, Elvish Skysweeper, Elvish Visionary, Emerald Medallion, Emeria the Sky Ruin, Essence Warden, Everglades, Evernight Shade, Evolving Wilds, Exclude, Faithless Looting, Farhaven Elf, Fell the Mighty, Fire Diamond, Flametongue Kavu, Fog Bank, Forest (x4), Forgotten Cave, Fresh Meat, Freyalise Llanowar's Fury, Gargoyle Castle, Geist-Honored Monk, Ghost Quarter, Ghoulcaller Gisa, Grand Abolisher, Grave Titan, Gray Merchant of Asphodel, Great Furnace, Grim Flowering, Hallowed Spiritkeeper, Harrow, Haunted Fengraf, Havenwood Battleground, Hoverguard Sweepers, Ichor Wellspring, Immaculate Magistrate, Imperious Perfect, Incite Rebellion, Infernal Offering, Ingot Chewer, Intellectual Offering, Into the Roil, Island (x4), Jalum Tome, Jet Medallion, Jungle Basin, Junk Diver, Karoo, Kemba Kha Regent, Kor Sanctifiers, Llanowar Elves, Lonely Sandbar, Loxodon Warhammer, Lys Alana Huntmaster, Magmaquake, Magus of the Coffers, Marble Diamond, Martial Coup, Mask of Memory, Mentor of the Meek, Midnight Haunting, Mind Stone, Mobilization, Moonsilver Spear, Morkrut Banshee, Moss Diamond, Mountain (x4), Mulldrifter, Mutilate, Mycosynth Wellspring, Myr Retriever, Myr Sire, Myriad Landscape, Nantuko Shade, Necromantic Selection, Nekrataal, Nevinyrral's Disk, Nomads' Assembly, Oblation, Overrun, Overwhelming Stampede, Palladium Myr, Panic Spellbomb, Pearl Medallion, Pestilence Demon, Phyrexia's Core, Phyrexian Gargantua, Pilgrim's Eye, Plains (x4), Polluted Mire, Pongify, Pontiff of Blight, Praetor's Counsel, Predator Flagship, Priest of Titania, Primordial Sage, Pristine Talisman, Rampaging Baloths, Read the Bones, Reaper from the Abyss, Reclamation Sage, Reef Worm, Reliquary Tower, Remote Isle, Requiem Angel, Rite of Replication, Ruby Medallion, Rush of Knowledge, Sapphire Medallion, Sea Gate Oracle, Secluded Steppe, Seer's Sundial, Serra Avatar, Shriekmaw, Siege Behemoth, Sign in Blood, Silklash Spider, Skeletal Scrying, Skullclamp, Sky Diamond, Skyhunter Skirmisher, Slippery Karst, Smoldering Crater, Sol Ring, Solemn Simulacrum, Soul of the Harvest, Spectral Procession, Sphinx of Jwar Isle, Sphinx of Magosi, Spine of Ish Sah, Spitebellows, Spoils of Blood, Starstorm, Stroke of Genius, Sun Titan, Sunblast Angel, Swamp (x4), Swiftfoot Boots, Sword of Vengeance, Sylvan Offering, Sylvan Ranger, Sylvan Safekeeper, Syphon Mind, Tectonic Edge, Temple of the False God, Tendrils of Corruption, Terramorphic Expanse, Thornweald Archer, Thran Dynamo, Thunderfoot Baloth, Timberwatch Elf, Titania's Chosen, Tormod's Crypt, Tornado Elemental, Trading Post, Tragic Slip, Tranquil Thicket, True Conviction, Tuktuk the Explorer, Unstable Obelisk, Ur-Golem's Eye, Vampire Hexmage, Warmonger Hellkite, Wayfarer's Bauble, Wellwisher, Whipflare, Whirlwind, White Sun's Zenith, Whitemane Lion, Wing Shards, Wolfcaller's Howl, Wood Elves, Worn Powerstone, Wurmcoil Engine, Xathrid Demon.

(Nota: los básicos Forest/Island/Mountain/Plains/Swamp aparecen 4 veces cada uno en el mazo — 4 copias distintas por precon — y ya venían cubiertos por el motor base antes de esta rama; no tienen commit dedicado.)

## Las 96 cartas C14 aún pendientes (para referencia del integrador)

Adarkar Valkyrie, Arcane Lighthouse, Artisan of Kozilek, Assault Suit, Bitter Feud, Bogardan Hellkite, Bonehoard, Brave the Elements, Brine Elemental, Caged Sun, Celestial Crusader, Chaos Warp, Comeuppance, Containment Priest, Creeperhulk, Crown of Doom, Crypt of Agadeem, Cyclonic Rift, Daretti Scrap Savant, Decree of Justice, Deep-Sea Kraken, Demon of Wailing Agonies, Domineering Will, Dread Return, Dualcaster Mage, Dulcet Sirens, Epochrasite, Everflowing Chalice, Ezuri Renegade Leader, Fathom Seer, Feldon of the Third Path, Flamekin Village, Flesh Carver, Flickerwisp, Fool's Demise, Frost Titan, Gift of Estates, Goblin Welder, Grave Sifter, Hoard-Smelter Dragon, Hunting Triad, Impact Resonance, Infinite Reflection, Ixidron, Jazal Goldmane, Joraga Warcaller, Lashwrithe, Lifeblood Hydra, Liliana's Reaver, Liquimetal Coating, Loreseeker's Stone, Lorthos the Tidemaker, Malicious Affliction, Marshal's Anthem, Masked Admirers, Masterwork of Ingenuity, Myr Battlesphere, Nahiri the Lithomancer, Ob Nixilis of the Black Oath, Oran-Rief the Vastwood, Overseer of the Damned, Pentavus, Phyrexian Ingester, Profane Command, Promise of Power, Raving Dead, Return to Dust, Riptide Survivor, Sacred Mesa, Scrap Mastery, Shaper Parasite, Silverblade Paladin, Skirsdag High Priest, Song of the Dryads, Sphinx of Uthuun, Steel Hellkite, Stitcher Geralf, Stormsurge Kraken, Strata Scythe, Sudden Spoiling, Teferi Temporal Archmage, Terastodon, Titania Protector of Argoth, Turn to Frog, Twilight Shepherd, Tyrant's Familiar, Victimize, Volcanic Offering, Wake the Dead, Wave of Vitriol, Well of Ideas, Willbender, Wolfbriar Elemental, Word of Seizing, Wren's Run Packmaster, Zoetic Cavern.

Razones típicas de lo pendiente (para planear el siguiente batch): mecánica Morph (~6 cartas), planeswalkers con emblemas (Daretti/Nahiri/Ob Nixilis/Teferi), objetivos múltiples genéricos, Auras con "enchant creature" (el motor no adjunta Auras a un objetivo todavía), fijar poder/resistencia base, "se convierte en objetivo de un hechizo/habilidad", copiar un hechizo, costes de activación con `{X}` no numérico simple, y varias líneas de una sola carta sin primitiva compartida.

## Verificación

Regenerado inmediatamente antes de escribir este documento, con el código exacto del HEAD `af82c1f`:

```
npm run rules:engine:export   -> 38711 cards; 8469 fully implemented
python tools/rules/check_precon_coverage.py --set-code C14 --output data/rules/coverage-c14.md
  -> Unique cards: 337; implemented: 241; pending: 96
```
