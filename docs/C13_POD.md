# Commander 2013 pod

The server accepts `POST /api/matches` with `{ "mode": "c13", "seed": 123 }`.
It loads the five complete Commander 2013 precons and seats four players with
one distinct precon each. The omitted deck rotates deterministically with the
seed, so all five products can be covered without creating a five-player table:

- Eternal Bargain — Oloro, Ageless Ascetic
- Evasive Maneuvers — Derevi, Empyrial Tactician
- Mind Seize — Jeleva, Nephalia's Scourge
- Nature of the Beast — Marath, Will of the Wild
- Power Hungry — Prossh, Skyraider of Kher

Each selected list is validated as exactly 99 cards plus its declared commander
(100 cards total) before the authoritative match is created. The client exposes
this as **Jugar pod Commander 2013** on Home and **Pod C13** in-game.
