# Reglas base que gobiernan la mesa

Este documento define el mínimo que el motor debe respetar. No convierte todavía las 117 mil impresiones del catálogo en reglas ejecutables; una carta sólo se habilita en partidas cuando sus efectos están cubiertos por primitivas verificadas.

## Commander multijugador

- Una lista de Commander contiene exactamente 100 cartas, incluido su comandante. La partida free-for-all comienza normalmente con 40 vidas y tres o más jugadores; la mesa de cuatro es el caso de diseño principal.
- El comandante comienza en la zona de mando. Biblioteca, mano y cartas buscadas son información privada: el servidor las guarda y cada asiento recibe únicamente su propia proyección.
- En una mesa multijugador los turnos y la prioridad avanzan en el orden de los asientos. El jugador activo inicia cada turno y puede atacar o elegir objetivos entre oponentes legales.

## Prioridad y pila

- Enderezar no abre prioridad. El motor abre ventanas en pasos/fases apropiados después de aplicar acciones basadas en estado y disparadas pendientes.
- Al lanzar un hechizo o activar una habilidad, el objeto va a la pila y su controlador conserva prioridad. Si todos pasan con pila no vacía, se resuelve sólo el objeto superior; luego el jugador activo recibe prioridad de nuevo.
- Si todos pasan con pila vacía, el juego avanza al siguiente paso/fase. La pila es LIFO; las elecciones, objetivos y costes quedan registrados antes de que los rivales respondan.
- Un stop point pertenece a un jugador y a un paso/fase. Sólo evita el auto-pase en esa ventana; no inventa prioridad donde las reglas no la conceden.

## Alcance de la primera partida jugable

1. Zonas por asiento, robo inicial/mulligan, tierras, prioridad, pila y paso de turnos autoritativos.
2. Estado de combate multijugador: atacantes, defensor por criatura, bloqueos y daño.
3. Acciones basadas en estado, disparadas, reemplazos y efectos continuos por primitivas.
4. Cobertura por mecánica de cartas, con casos de regresión reproducibles antes de exponerla en salas públicas.

Fuentes de producto y semántica: [Commander de Magic](https://magic.wizards.com/en/formats/commander) y [guía oficial de la pila](https://magic.wizards.com/en/news/feature/stack-and-its-tricks-2017-11-30).
