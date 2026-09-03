# Patrón de mesa inspirado en MTGO, rediseñado para ProsshTCG

La referencia es la mesa multijugador compartida por el usuario. Se toma su jerarquía de juego, no sus marcas, arte, iconos ni la densidad extrema de su UI.

## Qué conserva ProsshTCG

```text
┌──────── rival izquierdo ────────┬──────── rival central ────────┬──────── rival derecho ─────────┐
│ identidad · vida · [B][C][E]    │ identidad · vida · [B][C][E]  │ identidad · vida · [B][C][E]    │
│ battlefield de cartas reales    │ battlefield de cartas reales  │ battlefield de cartas reales    │
│ comandante compacto             │ comandante compacto           │ comandante compacto             │
└─────────────────────────────────┴───────────────────────────────┴─────────────────────────────────┘
┌────────────────────────── tu battlefield ──────────────────────────────────────────────────────────┐
│ comandante · vida · zonas privadas propias                                                           │
├── timeline horizontal de fases / stops ──┬── mano compacta de imágenes ──┬── pila / registro ───────┤
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- Los tres rivales llenan la mayor parte del alto de escritorio, de modo que las cartas son el foco.
- La pila, fases, mano y acciones quedan en la franja inferior; no existe una gran columna central que robe área a los campos.
- `B`, `C` y `E` son accesos compactos a biblioteca, cementerio y exilio. En el motor autoritativo, una zona sólo se puede abrir si es pública para ese asiento.
- La mano propia es solapada y de altura limitada; al posar o mantener una carta se amplía, sin tapar la mesa permanentemente.

## Cambios respecto de MTGO clásico

| Problema observado | Decisión de ProsshTCG |
| --- | --- |
| Texto y cartas muy pequeños | Cartas con imagen normal, interpolación nativa, borde definido y capa de brillo sutil. |
| Mucho espacio para mano | Mano compacta, con foco/hover para inspección puntual. |
| Zonas laterales difíciles de escanear | Rail `B/C/E` coherente por rival; contenido sólo bajo demanda. |
| Muchas permanentes | Grid adaptativo, comandante anclado abajo y elevación temporal al enfocar una carta. |
| Fases legibles pero rígidas | Timeline horizontal persistente con stops por jugador y paso; móvil la convierte en carril desplazable. |

## Regla de visibilidad

El prototipo visual no debe fingir que una biblioteca o mano ajena es visible. Al conectar el estado autoritativo, cada `B/C/E` recibe una proyección de zona filtrada por espectador: cementerio/exilio normalmente públicos; biblioteca y mano no, salvo efectos que revelen cartas.
