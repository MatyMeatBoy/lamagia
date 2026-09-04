/**
 * Ability iconography for the table.
 *
 * Every glyph here is drawn for this project. MTG Arena is used only as a
 * reference for *where* icons help — compressing rules text on a small card
 * face — never as a source of artwork: its icons are Wizards of the Coast game
 * assets and are not redistributable, whatever a wiki mirror implies.
 *
 * Each icon is a 24×24 path drawn in `currentColor`, so it inherits the
 * surrounding text colour and works in both the light and dark table themes.
 * Every keyword also carries the rule it comes from and an explicit statement
 * of what this engine enforces, so a player is never shown an icon whose
 * behaviour the table does not actually implement.
 */

import type { TriggerEvent } from "@prossh/rules";

export interface AbilityGlyph {
  /** Short label used in the help panel and as the accessible name. */
  readonly label: string;
  /** The rule as printed, in the table's language. */
  readonly rule: string;
  /** Exactly what this engine does with it today. */
  readonly enforced: string;
  /** SVG path data on a 24×24 grid. */
  readonly path: string;
}

/** The fifteen keywords `packages/rules` actually enforces in combat and priority. */
export const KEYWORD_GLYPHS: Readonly<Record<string, AbilityGlyph>> = {
  flying: {
    label: "Volar",
    rule: "Solo puede ser bloqueada por criaturas con volar o alcance.",
    enforced: "El motor rechaza bloqueos ilegales y los ofrece filtrados.",
    path: "M3 15c4-1 6-3 8-6 1.6-2.4 3.6-3.6 6-3.6 1.8 0 3.4.7 4.6 2-2.2.3-3.7 1.2-4.6 2.7 1.3.1 2.4.5 3.3 1.2-2 .5-3.4 1.6-4.2 3.2-2.2 4.2-6.6 5-13.1 2.5l3.6-1.2z"
  },
  reach: {
    label: "Alcance",
    rule: "Puede bloquear criaturas con volar.",
    enforced: "Se considera al validar bloqueos contra atacantes con volar.",
    path: "M12 21V7m0 0L6.5 12M12 7l5.5 5M4 4h16"
  },
  "first strike": {
    label: "Dañar primero",
    rule: "Hace daño de combate en un sub-paso anterior.",
    enforced: "Hay un sub-paso real de daño primero; lo que muere ahí no responde.",
    path: "M4 20 19 5m0 0h-5m5 0v5M4 8l4 4"
  },
  "double strike": {
    label: "Dañar dos veces",
    rule: "Hace daño en el sub-paso de daño primero y en el normal.",
    enforced: "Golpea en ambos sub-pasos, con las mismas reglas de asignación.",
    path: "M3 20 18 5m0 0h-4m4 0v4M3 13 13 3m0 0H9m4 0v4"
  },
  deathtouch: {
    label: "Toque mortal",
    rule: "Cualquier cantidad de daño que haga a una criatura es letal.",
    enforced: "Marca a la criatura dañada y la acción basada en estado la destruye.",
    path: "M12 3c3.9 0 7 3 7 6.8 0 2.4-1.2 4-2.6 5.1V18a2 2 0 0 1-2 2h-4.8a2 2 0 0 1-2-2v-3.1C6.2 13.8 5 12.2 5 9.8 5 6 8.1 3 12 3zm-2.6 7.2a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8zm5.2 0a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8z"
  },
  trample: {
    label: "Arrollar",
    rule: "El daño sobrante pasa al jugador defensor.",
    enforced: "Se asigna daño letal a los bloqueadores y el resto va al defensor.",
    path: "M6 4h12v8a6 6 0 0 1-12 0V4zm-1 16h14M7.5 20l-1 2m10-2 1 2"
  },
  vigilance: {
    label: "Vigilancia",
    rule: "Atacar no hace que se gire.",
    enforced: "No se gira al declarar ataque, así que sigue pudiendo bloquear.",
    path: "M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"
  },
  lifelink: {
    label: "Vínculo vital",
    rule: "El daño que hace también hace ganar esa cantidad de vidas.",
    enforced: "Suma vidas a su controlador al hacer daño de combate.",
    path: "M12 20S3.5 14.6 3.5 9.3A4.8 4.8 0 0 1 12 6.4a4.8 4.8 0 0 1 8.5 2.9C20.5 14.6 12 20 12 20z"
  },
  menace: {
    label: "Amenaza",
    rule: "No puede ser bloqueada excepto por dos o más criaturas.",
    enforced: "Un bloqueo con una sola criatura es rechazado por el motor.",
    path: "M4 8h9m0 0-3-3m3 3-3 3M20 16h-9m0 0 3-3m-3 3 3 3"
  },
  defender: {
    label: "Defensor",
    rule: "No puede atacar.",
    enforced: "Nunca aparece en la lista de atacantes legales.",
    path: "M12 3 20 6v6c0 4.4-3.2 7.9-8 9-4.8-1.1-8-4.6-8-9V6l8-3z"
  },
  haste: {
    label: "Prisa",
    rule: "Puede atacar y usar habilidades de girar en cuanto entra.",
    enforced: "Ignora el mareo de invocación al atacar y al pagar costes de {T}.",
    path: "M13 2 4 14h6l-1 8 9-12h-6l1-8z"
  },
  indestructible: {
    label: "Indestructible",
    rule: "El daño letal y los efectos de destruir no la destruyen.",
    enforced: "Sobrevive al daño letal, a la destrucción dirigida y a los barridos.",
    path: "M12 3 20 6v6c0 4.4-3.2 7.9-8 9-4.8-1.1-8-4.6-8-9V6l8-3zM8 12h8"
  },
  hexproof: {
    label: "Antimaleficio",
    rule: "No puede ser objetivo de hechizos ni habilidades de tus oponentes.",
    enforced: "Se excluye de la lista de objetivos legales de los demás asientos.",
    path: "M12 3 20 6v6c0 4.4-3.2 7.9-8 9-4.8-1.1-8-4.6-8-9V6l8-3zM9 13l6-4"
  },
  shroud: {
    label: "Antimaleficio total",
    rule: "No puede ser objetivo de ningún hechizo ni habilidad.",
    enforced: "Se excluye de la lista de objetivos legales de todos los asientos.",
    path: "M4 15c0-2.2 1.6-4 3.6-4.3C8.2 7.5 10.8 5 14 5c3.6 0 6.5 3 6.5 6.7 0 .5 0 1-.2 1.5 1 .6 1.7 1.7 1.7 3 0 1.9-1.5 3.4-3.4 3.4H7.4A3.4 3.4 0 0 1 4 16.2V15z"
  },
  flash: {
    label: "Destello",
    rule: "Puede lanzarse en cualquier momento en que se pudiera lanzar un instantáneo.",
    enforced: "Se ofrece con la pila ocupada y en el turno de otro jugador.",
    path: "M7 3h10v3.5L13.5 12 17 17.5V21H7v-3.5L10.5 12 7 6.5V3zm2.6 3.5h4.8M9 18h6"
  }
};

/** Icons for the two families of activated ability the engine can pay for. */
export const ACTIVATION_GLYPHS: Readonly<Record<"mana" | "activated", AbilityGlyph>> = {
  mana: {
    label: "Habilidad de maná",
    rule: "Se resuelve de inmediato y nunca usa la pila.",
    enforced: "Añade maná al depósito al instante; el solucionador la usa sola al pagar.",
    path: "M12 2.5 20 7v10l-8 4.5L4 17V7l8-4.5zm0 5.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"
  },
  activated: {
    label: "Habilidad activada",
    rule: "Se anuncia, se pagan sus costes y va a la pila como un hechizo.",
    enforced: "Solo se ofrece cuando el motor puede pagar todos sus costes.",
    path: "M12 4a8 8 0 1 1-5.6 2.3M12 1.5v5.5M12 9.5l3.5 6h-7l3.5-6z"
  }
};

/** Icons for each trigger event the engine raises. */
export const TRIGGER_GLYPHS: Readonly<Record<TriggerEvent, AbilityGlyph>> = {
  "enters-battlefield": {
    label: "Al entrar al campo",
    rule: "Se dispara cuando este permanente entra al campo de batalla.",
    enforced: "Se registra tras entrar y usa la pila; los objetivos se eligen ahí.",
    path: "M3 12h11m0 0-4-4m4 4-4 4M15 4h6v16h-6"
  },
  dies: {
    label: "Al morir",
    rule: "Se dispara cuando esta criatura va del campo al cementerio.",
    enforced: "Se dispara mirando atrás al permanente que acaba de irse.",
    path: "M12 3c3.9 0 7 3.1 7 7v11H5V10c0-3.9 3.1-7 7-7zm-2 8h4m-2-2v6"
  },
  attacks: {
    label: "Al atacar",
    rule: "Se dispara al declararse como atacante.",
    enforced: "Se dispara tras la declaración completa, antes de los bloqueos.",
    path: "M4 20 20 4m0 0h-5m5 0v5M9 15l-5 5m0 0h4m-4 0v-4"
  },
  blocks: {
    label: "Al bloquear",
    rule: "Se dispara al declararse como bloqueadora.",
    enforced: "Se dispara tras la declaración de bloqueos de ese defensor.",
    path: "M12 3 20 6v6c0 4.4-3.2 7.9-8 9-4.8-1.1-8-4.6-8-9V6l8-3zm-3 9 2.2 2.2L15 10.5"
  },
  "deals-combat-damage-to-player": {
    label: "Al hacer daño de combate",
    rule: "Se dispara cuando hace daño de combate a un jugador.",
    enforced: "Se dispara por cada golpe que llega a un jugador, incluido el arrollar.",
    path: "M12 2 14.5 9H22l-6 4.5 2.3 7L12 16.2 5.7 20.5 8 13.5 2 9h7.5L12 2z"
  },
  "becomes-tapped": {
    label: "Al girarse",
    rule: "Se dispara cuando este permanente pasa de enderezado a girado.",
    enforced: "Cubre girar por maná, por coste de habilidad y por atacar.",
    path: "M6 5v9a6 6 0 0 0 12 0m0 0 3 3m-3-3-3 3"
  },
  "spell-cast": {
    label: "Al lanzar un hechizo",
    rule: "Se dispara cuando el jugador indicado lanza un hechizo.",
    enforced: "Se dispara al ponerse el hechizo en la pila, no al resolverse.",
    path: "M5 19 17 7m0 0-1.5-3L19 5.5 20.5 9 17 7zM5 19l-1 2 2-1"
  },
  "card-cycled": {
    label: "Al ciclar una carta",
    rule: "Se dispara cuando el jugador indicado cicla una carta.",
    enforced: "Se registra después de pagar el coste y descartar la carta.",
    path: "M4 12a8 8 0 0 1 14-5l2 2m0-5v5h-5M20 12a8 8 0 0 1-14 5l-2-2m0 5v-5h5"
  },
  "card-drawn": {
    label: "Al robar una carta",
    rule: "Se dispara cuando el jugador indicado roba una carta.",
    enforced: "Se registra por cada carta robada, incluida la del paso de robo.",
    path: "M6 3h8l4 4v14H6V3zm2 9h8m-8 4h5"
  },
  "leaves-battlefield": {
    label: "Al dejar el campo",
    rule: "Se dispara cuando el permanente indicado deja el campo de batalla.",
    enforced: "Se registra antes de que desaparezca la información necesaria del permanente.",
    path: "M21 12H7m0 0 4-4m-4 4 4 4M3 5v14"
  },
  upkeep: {
    label: "En el mantenimiento",
    rule: "Se dispara al comenzar el paso de mantenimiento indicado.",
    enforced: "Se encola antes de que se abra la prioridad de ese paso.",
    path: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 4v5l3.5 2"
  },
  "draw-step": {
    label: "En el paso de robo",
    rule: "Se dispara al comenzar el paso de robo indicado.",
    enforced: "Se encola antes de que se abra la prioridad de ese paso.",
    path: "M6 3h8l4 4v14H6V3zm2 9h8m-8 4h5"
  },
  "end-step": {
    label: "En el paso final",
    rule: "Se dispara al comenzar el paso final indicado.",
    enforced: "Se encola antes de que se abra la prioridad de ese paso.",
    path: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm-4 9h8"
  },
  "life-gained": {
    label: "Life gained",
    rule: "Triggers when the indicated player gains life.",
    enforced: "Triggers once for each life-gain event.",
    path: "M12 21S4 16.5 4 10a4 4 0 0 1 8-2 4 4 0 0 1 8 2c0 6.5-8 11-8 11z"
  },
  "life-lost": {
    label: "Al perder vida",
    rule: "Se dispara cuando el jugador indicado pierde vida.",
    enforced: "Se dispara una vez por cada evento de pérdida de vida.",
    path: "M5 12h14"
  }
};

/** Renders one glyph as an inline SVG sized for the card face. */
export function glyphSvg(glyph: AbilityGlyph, size = 14): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false"
    fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${glyph.path}"/></svg>`;
}

export function keywordGlyph(keyword: string): AbilityGlyph | undefined {
  return KEYWORD_GLYPHS[keyword.toLowerCase()];
}
