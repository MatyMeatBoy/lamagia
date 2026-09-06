/**
 * Zone iconography for the seat panels and the local dock.
 *
 * Same discipline as `abilities.ts`: each icon is an original 24×24 path drawn
 * in `currentColor`, so it inherits the surrounding text colour and works in
 * both table themes. The Spanish zone name stays as the button's accessible
 * label and tooltip — the icon is a visual shorthand, not a replacement for it.
 */

export type ZoneId = "library" | "hand" | "graveyard" | "exile" | "command";

export interface ZoneGlyph {
  readonly label: string;
  readonly path: string;
}

export const ZONE_GLYPHS: Readonly<Record<ZoneId, ZoneGlyph>> = {
  // A squared-off deck seen slightly from the side.
  library: {
    label: "Biblioteca",
    path: "M7 6h11a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM9 4h9M11 2h7"
  },
  // A fan of three cards.
  hand: {
    label: "Mano",
    path: "M4 19 8 8l3.5 1.3M20 19 16 8l-3.5 1.3M12 21V8m-8 11h16"
  },
  // A headstone with an incised cross — the same silhouette as a token frame.
  graveyard: {
    label: "Cementerio",
    path: "M6 21V11a6 6 0 0 1 12 0v10zM12 8v7M9 11h6"
  },
  // A card being pulled out of the game through a rift.
  exile: {
    label: "Exilio",
    path: "M15 4h4v4M19 4l-7 7M10.5 4H7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3.5"
  },
  // A five-point crown for the command zone.
  command: {
    label: "Mando",
    path: "M4 8l3.5 9h9L20 8l-4.5 3.5L12 5 8.5 11.5zM6.5 20h11"
  }
};

/** One zone glyph as an inline SVG. */
export function zoneIconSvg(zone: ZoneId, size = 15): string {
  const glyph = ZONE_GLYPHS[zone];
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${glyph.path}"/></svg>`;
}
