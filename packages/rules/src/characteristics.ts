/**
 * Derives the structured characteristics the engine plays with from imported card data.
 *
 * Nothing here interprets free-form Oracle text as a general rules language. It
 * reads Scryfall's structured fields (types, power/toughness, keywords,
 * produced_mana) and recognises a small, closed set of unambiguous templates.
 * Anything outside that set is reported as unimplemented rather than guessed at,
 * so the table never pretends a card did something it did not do.
 */

import { MANA_COLORS, parseManaCost, type ManaCost, type ManaType } from "./mana.js";


export interface CardData {
  readonly scryfall_id: string;
  readonly oracle_id?: string;
  readonly name: string;
  readonly mana_cost?: string | null;
  readonly cmc?: number;
  readonly type_line: string;
  readonly oracle_text?: string | null;
  readonly image_normal?: string;
  readonly image_art_crop?: string;
  readonly power?: string | null;
  readonly toughness?: string | null;
  readonly loyalty?: string | null;
  readonly colors?: readonly string[];
  readonly color_identity?: readonly string[];
  readonly keywords?: readonly string[];
  readonly produced_mana?: readonly string[];
  readonly card_faces?: readonly Partial<CardData>[];
}

export type CardType =
  | "Land" | "Creature" | "Artifact" | "Enchantment" | "Planeswalker"
  | "Instant" | "Sorcery" | "Battle" | "Kindred";

const CARD_TYPES: readonly CardType[] = ["Land", "Creature", "Artifact", "Enchantment", "Planeswalker", "Instant", "Sorcery", "Battle", "Kindred"];

/** Combat- and priority-relevant keywords the engine actually enforces. */
export const ENFORCED_KEYWORDS = [
  "flying", "reach", "first strike", "double strike", "deathtouch", "trample",
  "vigilance", "lifelink", "menace", "defender", "haste", "indestructible",
  "hexproof", "shroud", "flash"
] as const;
export type EnforcedKeyword = (typeof ENFORCED_KEYWORDS)[number];

export interface ManaAbility {
  readonly index: number;
  /** The mana types the controller may choose between for each mana produced. */
  readonly produces: readonly ManaType[];
  readonly amount: number;
  /** Fixed mixed output, such as `{T}: Add {W}{U}`, rather than a choice. */
  readonly fixedProduces?: readonly ManaType[];
  readonly requiresTap: boolean;
  /** Life the ability costs (pain and filter lands). */
  readonly lifeCost: number;
  /** Counters removed from the source as an activation cost. */
  readonly removeCounters?: readonly CounterCost[];
  /** Some mana abilities have a small immediate side effect (CR 605). */
  readonly gainLife?: number;
  /** Static activation restriction such as Temple of the False God. */
  readonly requiresLands?: number;
  readonly text: string;
}

/** A counter cost or entry quantity. Counter names stay normalized and public. */
export interface CounterCost {
  readonly kind: string;
  readonly amount: number;
}

/**
 * A non-mana activated ability whose cost and effect both fit an explicit,
 * deterministic template.  This deliberately does not try to interpret all
 * Oracle prose: an ability appears here only when the engine can pay every
 * cost and resolve every instruction it exposes.
 */
export interface ActivatedAbility {
  readonly index: number;
  readonly requiresTap: boolean;
  readonly sacrificesSelf: boolean;
  readonly lifeCost: number;
  /** Mana part of the activation cost, or null when the ability needs none. */
  readonly manaCost: ManaCost | null;
  readonly effect: SpellEffect;
  readonly targetKind: TargetKind;
  /** Level up is an activated ability with a sorcery-speed restriction. */
  readonly sorcerySpeed?: boolean;
  readonly text: string;
}

/** One independently selectable mode of a supported `Choose one` spell. */
export interface ModalChoice {
  readonly index: number;
  readonly text: string;
  readonly effect: SpellEffect;
  readonly targetKind: TargetKind;
}

/** A landcycling variant: discard from hand to search a land subtype. */
export interface CyclingSearchAbility {
  readonly index: number;
  readonly cost: ManaCost;
  readonly subtypes: readonly string[];
  readonly text: string;
}

/** Static bonuses granted by an Equipment to its equipped creature. */
export interface EquipmentModification {
  readonly power: number;
  readonly toughness: number;
  readonly keywords: readonly EnforcedKeyword[];
  readonly text: string;
}

/** Characteristics printed in one level band of a leveler card (CR 711). */
export interface LevelDefinition {
  readonly minLevel: number;
  readonly maxLevel?: number;
  readonly power: number;
  readonly toughness: number;
  readonly keywords: readonly EnforcedKeyword[];
  readonly text: string;
}

export interface TokenDefinition {
  readonly name: string;
  readonly typeLine: string;
  readonly power: number | null;
  readonly toughness: number | null;
  readonly colors: readonly string[];
  readonly keywords: readonly EnforcedKeyword[];
}

/** A closed set of effects the engine executes. Everything else is flagged unimplemented. */
export type SpellEffect =
  | { readonly kind: "draw"; readonly amount: number }
  | { readonly kind: "draw-target-player"; readonly amount: number | "X" }
  | { readonly kind: "each-player-draw"; readonly amount: number | "X" }
  | { readonly kind: "discard-target-player"; readonly amount: number }
  | { readonly kind: "mill-target-player"; readonly amount: number | "X" }
  | { readonly kind: "gain-life"; readonly amount: number | "X" }
  | { readonly kind: "each-opponent-loses-life"; readonly amount: number }
  | { readonly kind: "damage-any-target"; readonly amount: number | "X" }
  | { readonly kind: "damage-each-opponent"; readonly amount: number | "X" }
  | { readonly kind: "damage-all-creatures"; readonly amount: number | "X"; readonly excludeSource: boolean }
  | { readonly kind: "damage-each-creature-and-player"; readonly amount: number | "X" }
  | { readonly kind: "equip-{cost}"; readonly cost: string | "X" }
  | { readonly kind: "equip-{cost}-static"; readonly cost: string }
  | { readonly kind: "equip-{cost}-<n>"; readonly cost: string, readonly n: number }
  | { readonly kind: "equip-{cost}-variant"; readonly cost: string, readonly variant: number }
  | { readonly kind: "land-enters-tapped"; readonly basic?: boolean }
  | { readonly kind: "choose-<n>"; readonly choice: number | "X" }
  | { readonly kind: "counter-<type>"; readonly type: string }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "landwalk-<type>"; readonly type: string }
  | { readonly kind: "landwalk-<type>"; readonly type: string }
  | { readonly kind: "this-land-enters-tapped"; readonly basic?: boolean }
  | { readonly kind: "choose-<n>-|-modal"; readonly choices: readonly string[] }
  | { readonly kind: "enchant-creature"; readonly aura?: boolean }
  | { readonly kind: "enchant-creature-static"; readonly aura?: boolean, readonly target: string }
  if ((match = /^Enchant creature$/i.exec(text)))
    return { effect: { kind: "enchant-creature", aura: false }, target: "any" };
  if ((match = /^Enchant (\w+) creature$/i.exec(text)))
    const type = match[1].toLowerCase();
    return { effect: { kind: "enchant-creature", aura: type === "aura" }, target: "any" };
  }
  
  | { readonly kind: "fortify-{effect}"; readonly effect: string }
  | { readonly kind: "fortify land"; readonly land_type: string }
  | { readonly kind: "fortify land static"; readonly land_type: string, readonly effect: string }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
  | { readonly kind: "activate-only-as-<n>-sorcery"; readonly n: number }
    | { readonly kind: "damage-prevent-target"; readonly amount: number | "X" }
    /** Layer 7c P/T modifications which expire during cleanup (CR 613.4c, 514.2). */
  | { readonly kind: "modify-all-creatures"; readonly power: number; readonly toughness: number }
  | { readonly kind: "modify-creatures-you-control"; readonly power: number; readonly toughness: number }
  | { readonly kind: "modify-target-creature"; readonly power: number; readonly toughness: number }
  | { readonly kind: "modify-target-creature"; readonly power: number; readonly toughness: number }
  | { readonly kind: "modify-all-creatures-you-control"; readonly power: number; readonly toughness: number }
  | { readonly kind: "add-counter-target-creature"; readonly counter: string; readonly amount: number }
  | { readonly kind: "destroy-target-creature" }
  | { readonly kind: "destroy-target-permanent" }
  | { readonly kind: "destroy-all-artifacts-creatures-enchantments" }
  | { readonly kind: "exile-target-permanent" }
  | { readonly kind: "exile-target-graveyard" }
  | { readonly kind: "return-target-creature" }
  | { readonly kind: "return-target-permanent" }
  | { readonly kind: "return-target-land" }
  | { readonly kind: "untap-equipped-creature" }
  | { readonly kind: "untap-all-other-creatures-you-control" }
  | { readonly kind: "destroy-all-creatures" }
  | { readonly kind: "counter-target-spell" }
  /** Resolves a level-up activation by adding one level counter (CR 702.87). */
  | { readonly kind: "level-up" }
  | { readonly kind: "tap-target-permanent" }
  | { readonly kind: "untap-target-permanent" }
  | { readonly kind: "attach-equipment" }
  | { readonly kind: "create-token"; readonly amount: number | "X"; readonly token: TokenDefinition }
  | {
      readonly kind: "search-library";
      readonly types: readonly CardType[];
      readonly subtypes?: readonly string[];
      readonly destination: "top" | "hand" | "graveyard" | "battlefield";
      /** Ramp templates put the found land onto the battlefield tapped. */
      readonly tapped?: boolean;
      readonly reveal: boolean;
    };

/**
 * Game events the engine raises for triggered abilities.
 *
 * The vocabulary is closed on purpose: an event only appears here once the
 * engine actually raises it at the right moment, so a recognised trigger is
 * always a trigger that fires.
 */
export type TriggerEvent =
  | "enters-battlefield"
  | "dies"
  | "attacks"
  | "blocks"
  | "deals-combat-damage-to-player"
  | "becomes-tapped"
  | "spell-cast"
  | "upkeep"
  | "draw-step"
  | "end-step";

/**
 * Which object or player the event has to involve for the ability to trigger.
 *
 * This is what separates "when ~ dies" from "whenever another creature you
 * control dies" without needing a general rules language.
 */
export type TriggerSubject =
  | "self"
  | "another-creature-you-control"
  | "creature-you-control"
  | "artifact-creature-you-control"
  | "land-you-control"
  | "another-creature"
  | "any-creature"
  | "you"
  | "each-player"
  | "opponent";

export const TRIGGER_EVENT_LABELS: Readonly<Record<TriggerEvent, string>> = {
  "enters-battlefield": "habilidad de entrada",
  dies: "habilidad de muerte",
  attacks: "habilidad de ataque",
  blocks: "habilidad de bloqueo",
  "deals-combat-damage-to-player": "habilidad de daño de combate",
  "becomes-tapped": "habilidad de giro",
  "spell-cast": "habilidad de lanzamiento",
  upkeep: "habilidad de mantenimiento",
  "draw-step": "habilidad del paso de robo",
  "end-step": "habilidad del paso final"
};

/** A triggered ability whose source is already on the battlefield. */
export interface TriggerDefinition {
  readonly event: TriggerEvent;
  readonly subject: TriggerSubject;
  readonly effect: SpellEffect;
  readonly optional: boolean;
  /**
   * What the ability targets. Targets for a trigger are chosen when it is put
   * onto the stack (CR 603.3d), never when the source is cast, so this is kept
   * apart from the card-level `targetKind` used by spells.
   */
  readonly targetKind: TargetKind;
  readonly sourceText: string;
}

export type TargetKind =
  | "any" | "player" | "creature" | "spell" | "creature-spell" | "noncreature-spell" | "permanent" | "artifact-or-enchantment"
  | "artifact-creature-or-planeswalker" | "artifact-enchantment-or-land" | "player-or-planeswalker" | "artifact" | "nonland" | "nonartifact-creature"
  | "enchantment" | "land"
  | "nonblack-creature" | "creature-with-flying" | "creature-you-control" | "nonbasic-land" | "noncreature-permanent" | "land-you-control" | `subtype:${string}` | "none";

export interface CardProfile {
  readonly name: string;
  readonly typeLine: string;
  readonly types: readonly CardType[];
  readonly supertypes: readonly string[];
  readonly subtypes: readonly string[];
  readonly cost: ManaCost | null;
  readonly manaValue: number;
  readonly colors: readonly string[];
  readonly colorIdentity: readonly string[];
  readonly keywords: readonly EnforcedKeyword[];
  readonly power: number | null;
  readonly toughness: number | null;
  readonly loyalty: number | null;
  readonly manaAbilities: readonly ManaAbility[];
  /** Generic cycling from hand. */
  readonly cyclingCost: ManaCost | null;
  readonly cyclingSearches: readonly CyclingSearchAbility[];
  /** The printed Equip cost, when this permanent is an Equipment. */
  readonly equipCost: ManaCost | null;
  readonly equipmentModification: EquipmentModification | null;
  /** Printed Level up cost and level bands, when present. */
  readonly levelUpCost: ManaCost | null;
  readonly levelDefinitions: readonly LevelDefinition[];
  readonly activatedAbilities: readonly ActivatedAbility[];
  readonly modalChoices: readonly ModalChoice[];
  readonly effects: readonly SpellEffect[];
  readonly triggers: readonly TriggerDefinition[];
  readonly targetKind: TargetKind;
  readonly entersTapped: EntersTappedRule;
  /** Counters with which this permanent enters the battlefield. */
  readonly entersWithCounters: readonly CounterCost[];
  readonly isPermanent: boolean;
  readonly castableFromHand: boolean;
  /** True when every printed instruction is covered by the engine. */
  readonly fullyImplemented: boolean;
  /** Normalized clauses preventing the card from being marked implemented. */
  readonly unimplementedText: readonly string[];
  readonly oracleText: string;
}

export type EntersTappedRule =
  | { readonly kind: "untapped" }
  | { readonly kind: "tapped" }
  | { readonly kind: "unless-few-lands"; readonly max: number }
  | { readonly kind: "unless-many-lands"; readonly min: number }
  | { readonly kind: "unless-pay-life"; readonly life: number }
  /** The controller may reveal a card with one of these subtypes to avoid entering tapped. */
  | { readonly kind: "unless-reveal-card"; readonly subtypes: readonly string[] };

const WORD_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, twenty: 20
};

function toNumber(token: string | undefined): number | null {
  if (!token) return null;
  const word = WORD_NUMBERS[token.toLowerCase()];
  if (word !== undefined) return word;
  return /^\d+$/.test(token) ? Number(token) : null;
}

/** Front face of a modal/transforming card; that face is what gets cast from hand. */
function frontFace(card: CardData): CardData {
  const faces = card.card_faces;
  if (!faces?.length) return card;
  const front = faces[0]!;
  return {
    ...card,
    name: front.name ?? card.name,
    mana_cost: front.mana_cost ?? card.mana_cost,
    type_line: front.type_line ?? card.type_line,
    oracle_text: front.oracle_text ?? card.oracle_text,
    power: front.power ?? card.power,
    toughness: front.toughness ?? card.toughness,
    loyalty: front.loyalty ?? card.loyalty,
    colors: front.colors ?? card.colors
  };
}

function splitTypeLine(typeLine: string): { supertypes: string[]; types: CardType[]; subtypes: string[] } {
  const face = typeLine.split("//")[0]!.trim();
  const [left, right] = face.split(/[—–-]\s/);
  const words = (left ?? "").trim().split(/\s+/).filter(Boolean);
  const types = words.filter((word): word is CardType => (CARD_TYPES as readonly string[]).includes(word));
  const supertypes = words.filter((word) => !types.includes(word as CardType));
  const subtypes = (right ?? "").trim().split(/\s+/).filter(Boolean);
  return { supertypes, types, subtypes };
}

function numeric(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  // `*` and `1+*` characteristic-defining values are not modeled; treat them as zero-ish bodies.
  return /\*/.test(trimmed) ? 0 : null;
}

/**
 * Nouns Wizards uses when a card refers to itself in current Oracle text.
 *
 * Modern templating writes "Sacrifice this land" and "When this creature
 * enters" instead of repeating the card's name, so a parser that only knows the
 * printed name silently misses most reprints. The list is explicit on purpose:
 * "this turn", "this way", "this game" and "this player" are not self
 * references and must never be rewritten.
 */
const SELF_NOUNS = [
  "creature", "land", "artifact", "enchantment", "permanent", "planeswalker",
  "battle", "token", "card", "spell", "Vehicle", "Equipment", "Aura", "Saga"
] as const;

/**
 * Removes reminder text and normalises every way a card names itself to `~`,
 * so one template can match both the printed name and the modern "this land"
 * phrasing of the same ability.
 */
export function normalizedOracle(card: CardData): string {
  const raw = (card.oracle_text ?? "").replace(/\([^)]*\)/g, " ");
  const shortName = card.name.split(",")[0]!.split("//")[0]!.trim();
  const escaped = [card.name, shortName].filter(Boolean).map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  let text = raw;
  for (const pattern of escaped) text = text.replace(new RegExp(pattern, "g"), "~");
  const selfReference = new RegExp(`\\bthis (?:${SELF_NOUNS.join("|")})\\b`, "gi");
  text = text.replace(selfReference, "~");
  return text.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
}

const MANA_LETTERS = new Set(["W", "U", "B", "R", "G", "C"]);

function symbolsIn(text: string): ManaType[] {
  return [...text.matchAll(/\{([WUBRGC])\}/g)].map((match) => match[1] as ManaType);
}
/**
 * Recognises the mana an `Add` clause produces, or null when it is unmodeled.
 *
 * Every pattern must consume the whole clause. A restrictive tail such as
 * "of any color that a land an opponent controls could produce" is a different,
 * board-dependent ability, and reading it as five free colours would let the
 * table pay costs it cannot actually pay.
 */
function parseAddClause(effect: string): { produces: ManaType[]; amount: number; fixedProduces?: ManaType[] } | null {
  const clause = effect.trim().replace(/\.$/, "");
  const anyColor = /^add\s+(\w+)\s+mana\s+of\s+any\s+(?:one\s+)?colors?$/i.exec(clause);
  if (anyColor) {
    const amount = toNumber(anyColor[1]);
    return amount ? { produces: [...MANA_COLORS], amount } : null;
  }
  const anyCombination = /^add\s+(\w+)\s+mana\s+in\s+any\s+combination\s+of\s+colors$/i.exec(clause);
  if (anyCombination) {
    const amount = toNumber(anyCombination[1]);
    return amount ? { produces: [...MANA_COLORS], amount } : null;
  }
  const explicit = /^add\s+((?:\{[WUBRGC]\}|\s|,|or|and)+)$/i.exec(clause);
  if (!explicit) return null;
  const symbols = symbolsIn(explicit[1]!);
  if (!symbols.length) return null;
  const distinct = [...new Set(symbols)];
  // `Add {G}{G}` is two of one type; `Add {W} or {U}` is one mana with a choice.
  const isChoice = /\bor\b/i.test(explicit[1]!) && distinct.length > 1;
  if (isChoice) return { produces: distinct, amount: 1 };
  if (distinct.length > 1) return { produces: distinct, amount: symbols.length, fixedProduces: symbols };
  return { produces: distinct, amount: symbols.length };
}

function parseManaInstruction(effect: string): { produced: ReturnType<typeof parseAddClause>; gainLife?: number; requiresLands?: number } | null {
  let remainder = effect.trim().replace(/\.$/, "");
  let gainLife: number | undefined;
  let requiresLands: number | undefined;
  const gain = /\.\s*You gain (\w+) life$/i.exec(remainder);
  if (gain) {
    const amount = toNumber(gain[1]);
    if (amount === null) return null;
    gainLife = amount;
    remainder = remainder.slice(0, gain.index).trim();
  }
  const restriction = /\.\s*Activate only if you control (\w+) or more lands$/i.exec(remainder);
  if (restriction) {
    const amount = toNumber(restriction[1]);
    if (amount === null) return null;
    requiresLands = amount;
    remainder = remainder.slice(0, restriction.index).trim();
  }
  const produced = parseAddClause(remainder);
  return produced ? { produced, ...(gainLife === undefined ? {} : { gainLife }), ...(requiresLands === undefined ? {} : { requiresLands }) } : null;
}

function parseManaAbilities(card: CardData, text: string): ManaAbility[] {
  const abilities: ManaAbility[] = [];
  const lines = text.split("\n");
  for (const line of lines) {
    const activated = /^([^:]{1,80}):\s*(.+)$/.exec(line.trim());
    if (!activated) continue;
    const [, costText, effectText] = activated as unknown as [string, string, string];
    if (!/^add\b/i.test(effectText.trim())) continue;
    const requiresTap = /\{T\}/.test(costText);
    const lifeMatch = /pay\s+(\d+)\s+life/i.exec(costText);
    const lifeCost = lifeMatch ? Number(lifeMatch[1]) : 0;
    const counterMatch = /remove\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+([+\-\w/ ]+?)\s+counters?\s+from\s+~/i.exec(costText);
    const counterAmount = counterMatch ? toNumber(counterMatch[0].match(/remove\s+(\w+)/i)?.[1]) : null;
    const removeCounters = counterMatch && counterAmount
      ? [{ kind: counterMatch[1]!.trim().replace(/\s+/g, " ").toLowerCase(), amount: counterAmount }]
      : [];
    // Costs beyond tapping, life, and counters on the source (mana, sacrifice,
    // discard) are not modeled.
    const leftovers = costText
      .replace(/\{T\}/g, "")
      .replace(/pay\s+\d+\s+life/gi, "")
      .replace(/remove\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+[+\-\w/ ]+?\s+counters?\s+from\s+~/gi, "")
      .replace(/[,\s]/g, "");
    if (leftovers.length) continue;
    // Restrictions follow the first sentence in Oracle text. Parse the
    // production clause independently so cards such as Delighted Halfling
    // keep both printed mana abilities instead of falling back to one
    // structured `produced_mana` entry.
    // `manaAbilities` may still expose a production choice whose restriction
    // is not executable yet; `recognizeText` below remains strict so coverage
    // does not claim that trailing restriction is enforced.
    const instruction = parseManaInstruction(effectText) ?? (() => {
      const produced = parseAddClause(effectText.split(/[.!?]/, 1)[0] ?? effectText);
      return produced ? { produced, gainLife: undefined, requiresLands: undefined } : null;
    })();
    if (!instruction?.produced) continue;
    const produced = instruction.produced;
    abilities.push({
      index: abilities.length, produces: produced.produces, amount: produced.amount,
      ...(produced.fixedProduces ? { fixedProduces: produced.fixedProduces } : {}),
      ...(removeCounters.length ? { removeCounters } : {}),
      ...(instruction.gainLife === undefined ? {} : { gainLife: instruction.gainLife }),
      ...(instruction.requiresLands === undefined ? {} : { requiresLands: instruction.requiresLands }),
      requiresTap, lifeCost, text: line.trim()
    });
  }
  if (abilities.length) return abilities;

  // Fallback for cards whose printed ability is only reminder text (basic lands) or
  // phrasing outside the templates above: use Scryfall's structured produced_mana.
  const produced = (card.produced_mana ?? []).filter((symbol) => MANA_LETTERS.has(symbol)) as ManaType[];
  if (!produced.length) return [];
  return [{ index: 0, produces: produced, amount: 1, requiresTap: true, lifeCost: 0, text: `{T}: Add one mana (${produced.join("/")}).` }];
}

function parseCyclingCost(text: string): ManaCost | null {
  for (const line of text.split("\n")) {
    const match = /^cycling\s+(.+)$/i.exec(line.trim().replace(/\.$/, ""));
    if (!match || /landcycling|typecycling/i.test(line)) continue;
    const cost = parseManaCost(match[1]!.trim());
    if (cost && !cost.hasVariable) return cost;
  }
  return null;
}

function parseCyclingSearches(text: string): CyclingSearchAbility[] {
  const abilities: CyclingSearchAbility[] = [];
  for (const line of text.split("\n")) {
    const matches = [...line.matchAll(/([A-Za-z][A-Za-z ]*)cycling\s+((?:\{[^}]+\})+)/gi)];
    for (const match of matches) {
      const subtype = match[1]!.trim().replace(/\s+land$/i, "");
      const cost = parseManaCost(match[2]!);
      if (!cost || cost.hasVariable || !subtype) continue;
      const displaySubtype = subtype.toLowerCase() === "basic"
        ? "Basic land"
        : `${subtype[0]!.toUpperCase()}${subtype.slice(1).toLowerCase()}`;
      abilities.push({
        index: abilities.length,
        cost,
        subtypes: [displaySubtype.replace(/ land$/i, "")],
        text: `${displaySubtype}cycling ${match[2]}`
      });
    }
  }
  return abilities;
}

function parseEquipCost(text: string): ManaCost | null {
  for (const line of text.split("\n")) {
    const match = /^equip\s+(.+)$/i.exec(line.trim().replace(/\.$/, ""));
    if (!match) continue;
    const cost = parseManaCost(match[1]!.trim());
    if (cost && !cost.hasVariable) return cost;
  }
  return null;
}

function parseLevelUpCost(text: string): ManaCost | null {
  for (const line of text.split("\n")) {
    const match = /^level up\s+(.+)$/i.exec(line.trim().replace(/\.$/, ""));
    if (!match) continue;
    const cost = parseManaCost(match[1]!.trim());
    if (cost && !cost.hasVariable) return cost;
  }
  return null;
}

/**
 * Reads only the characteristic bands of a leveler card. The ability text in
 * each band remains outside this cluster until its own reusable primitive is
 * implemented; P/T and keyword changes are deterministic layer-7 effects.
 */
function parseLevelDefinitions(text: string): LevelDefinition[] {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const definitions: LevelDefinition[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const marker = /^level\s+(\d+)(?:-(\d+)|(\+))?$/i.exec(lines[index]!);
    if (!marker) continue;
    const stats = /^(\d+)\/(\d+)$/.exec(lines[index + 1] ?? "");
    if (!stats) continue;
    const keywords: EnforcedKeyword[] = [];
    let cursor = index + 2;
    while (cursor < lines.length && !/^level\s+\d+(?:-\d+|\+)?$/i.test(lines[cursor]!)) {
      const candidate = lines[cursor]!.replace(/\.$/, "").toLowerCase();
      if ((ENFORCED_KEYWORDS as readonly string[]).includes(candidate)) {
        keywords.push(candidate as EnforcedKeyword);
      }
      cursor += 1;
    }
    definitions.push({
      minLevel: Number(marker[1]),
      ...(marker[2] ? { maxLevel: Number(marker[2]) } : {}),
      power: Number(stats[1]),
      toughness: Number(stats[2]),
      keywords,
      text: lines.slice(index, cursor).join(" ")
    });
    index = cursor - 1;
  }
  return definitions;
}

function parseEquipmentModification(text: string): EquipmentModification | null {
  for (const line of text.split("\n")) {
    const clean = line.trim().replace(/\.$/, "");
    let match = /^equipped creature gets ([+-]\d+)\/([+-]\d+)(?:\s+and\s+has\s+(.+))?$/i.exec(clean);
    if (match) {
      const keywords = (match[3] ?? "").split(/\s+and\s+|,\s*/i).map((word) => word.trim().toLowerCase())
        .filter((word): word is EnforcedKeyword => (ENFORCED_KEYWORDS as readonly string[]).includes(word));
      return { power: Number(match[1]), toughness: Number(match[2]), keywords, text: line.trim() };
    }
    match = /^equipped creature has\s+(.+)$/i.exec(clean);
    if (match) {
      const keywords = match[1]!.split(/\s+and\s+|,\s*/i).map((word) => word.trim().toLowerCase())
        .filter((word): word is EnforcedKeyword => (ENFORCED_KEYWORDS as readonly string[]).includes(word));
      if (keywords.length) return { power: 0, toughness: 0, keywords, text: line.trim() };
    }
  }
  return null;
}

/**
 * Parses an activation cost made from mana, tapping, paying life and
 * sacrificing its own source, plus an effect the engine can resolve.
 *
 * Everything else — untapping ({Q}), loyalty, energy, exiling or sacrificing
 * other permanents or discarding — leaves the ability out of
 * the profile rather than letting the table activate a cost it cannot pay.
 */
function parseActivatedAbility(line: string, index: number): ActivatedAbility | null {
  const activated = /^([^:]{1,120}):\s*(.+)$/.exec(line.trim());
  if (!activated) return null;
  const [, costText, effectText] = activated as unknown as [string, string, string];
  // Mana abilities have their own immediate-resolution path (CR 605.1a).
  if (/^add\b/i.test(effectText.trim())) return null;
  // Loyalty abilities are a separate cost system the engine does not model yet.
  if (/^\s*[+\u2212\u2013-]?\d+\s*:/.test(line)) return null;
  const recognized = recognizeSentence(effectText);
  if (!recognized) return null;

  const symbols = costText.match(/\{[^}]+\}/g) ?? [];
  const requiresTap = symbols.some((symbol) => symbol.toUpperCase() === "{T}");
  // `{Q}` (untap) and every other non-mana symbol are outside the payable set.
  if (symbols.some((symbol) => /^\{Q\}$/i.test(symbol))) return null;
  const manaSymbols = symbols.filter((symbol) => !/^\{[TQ]\}$/i.test(symbol));
  const manaCost = manaSymbols.length ? parseManaCost(manaSymbols.join("")) : null;
  // A cost the mana parser rejects, or one carrying `{X}`, is not payable here.
  if (manaSymbols.length && (!manaCost || manaCost.hasVariable)) return null;

  const sacrificesSelf = /sacrifice\s+~/i.test(costText);
  const lifeMatch = /pay\s+(\d+)\s+life/i.exec(costText);
  const lifeCost = lifeMatch ? Number(lifeMatch[1]) : 0;
  const leftovers = costText
    .replace(/\{[^}]*\}/g, "")
    .replace(/pay\s+\d+\s+life/gi, "")
    .replace(/sacrifice\s+~/gi, "")
    .replace(/[,\s]/g, "");
  if (leftovers.length) return null;
  return {
    index,
    requiresTap,
    sacrificesSelf,
    lifeCost,
    manaCost,
    effect: recognized.effect,
    targetKind: recognized.target,
    text: line.trim()
  };
}

function parseEntersTapped(text: string, typeLine: string): EntersTappedRule {
  // This is the current Oracle template used by Frostboil Snarl and the
  // allied reveal lands: the reveal is a replacement-effect choice made as
  // the land enters, not a triggered ability after it is already in play.
  const reveal = /as\s+~\s+enters,?\s+you\s+may\s+reveal\s+(?:an?\s+)?(.+?)\s+card\s+from\s+your\s+hand[\s\S]*?if\s+you\s+don[’']t,?\s+~\s+enters\s+tapped/i.exec(text);
  if (reveal) {
    const subtypes = reveal[1]!
      .split(/\s*(?:,|\bor\b|\band\b)\s*/i)
      .map((part) => part.trim())
      .filter(Boolean);
    if (subtypes.length) return { kind: "unless-reveal-card", subtypes };
  }
  if (!/enters(?:\s+the\s+battlefield)?\s+tapped/i.test(text)) return { kind: "untapped" };
  const fewLands = /unless\s+you\s+control\s+(\w+)\s+or\s+fewer\s+other\s+lands/i.exec(text);
  if (fewLands) {
    const max = toNumber(fewLands[1]);
    if (max !== null) return { kind: "unless-few-lands", max };
  }
  const manyLands = /unless\s+you\s+control\s+(\w+)\s+or\s+more\s+other\s+lands/i.exec(text);
  if (manyLands) {
    const min = toNumber(manyLands[1]);
    if (min !== null) return { kind: "unless-many-lands", min };
  }
  const payLife = /(?:unless\s+you\s+pay|you\s+may\s+pay)\s+(\d+)\s+life/i.exec(text);
  if (payLife) return { kind: "unless-pay-life", life: Number(payLife[1]) };
  if (/^Basic\b/.test(typeLine)) return { kind: "untapped" };
  return { kind: "tapped" };
}

interface RecognizedText {
  readonly effects: SpellEffect[];
  readonly triggers: TriggerDefinition[];
  readonly activatedAbilities: ActivatedAbility[];
  readonly modalChoices: ModalChoice[];
  readonly targetKind: TargetKind;
  /** Exact normalized clauses the closed engine intentionally does not execute. */
  readonly unimplementedText: readonly string[];
  readonly covered: boolean;
}

/** Handles the closed “enters ... with N <kind> counters” Oracle template. */
function parseEntersWithCounters(text: string): CounterCost[] {
  const counters: CounterCost[] = [];
  for (const match of text.matchAll(/(?:~|this [^.]+)\s+enters(?:\s+the\s+battlefield)?(?:\s+tapped)?\s+with\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+([+\-\w/ ]+?)\s+counters?\s+on\s+it/gi)) {
    const amount = toNumber(match[1]);
    const kind = match[2]?.trim().replace(/\s+/g, " ").toLowerCase();
    if (amount && kind) counters.push({ kind, amount });
  }
  return counters;
}

const SENTENCE_SPLIT = /(?<=\.)\s+(?=[A-Z~])/;

function searchCriterion(text: string): { types: CardType[]; subtypes: string[] } {
  const types = CARD_TYPES.filter((type) => new RegExp(`\\b${type}\\b`, "i").test(text));
  const subtypes: string[] = /\bbasic\b/i.test(text) ? ["Basic"] : [];
  // Search criteria are open-ended in Oracle: Equipment, Aura, Goblin and
  // future creature/artefact subtypes must not be reduced to “all cards”.
  // Only collect a single lexical criterion after removing card-type words;
  // compound descriptions ("land with ...", "card with ...") stay pending.
  const criterion = text.replace(/\b(?:a|an|up to (?:one|two|three|five))\b/gi, "")
    .replace(/\bcard\b/gi, "").replace(/\s+/g, " ").trim();
  for (const part of criterion.split(/\s+(?:or|and)\s+/i)) {
    const candidate = part.trim();
    if (!candidate || /\b(?:with|that|whose|where|named|converted|mana|power|toughness)\b/i.test(candidate)) continue;
    if (/^(?:basic|land|creature|artifact|enchantment|instant|sorcery|planeswalker|battle|kindred)$/i.test(candidate)) continue;
    if (/^[A-Za-z][A-Za-z'’/-]*$/.test(candidate) && !subtypes.some((subtype) => subtype.toLowerCase() === candidate.toLowerCase())) {
      subtypes.push(candidate);
    }
  }
  return { types, subtypes };
}

function parseLibrarySearch(text: string): SpellEffect | null {
  const match = /^Search your library for (?:a |an |up to (?:one|two|three|five) )?(.+?) card, (.+)$/i.exec(text);
  if (!match) return null;
  const criterion = searchCriterion(match[1]!);
  const instructions = match[2]!;
  const selected = "(?:(?:that|the) card|it)";
  const destination = new RegExp(`(?:put|place) ${selected} on top(?: of your library)?`, "i").test(instructions) ? "top"
    : new RegExp(`put ${selected} into your hand`, "i").test(instructions) ? "hand"
    : new RegExp(`put ${selected} into your graveyard`, "i").test(instructions) ? "graveyard"
    : new RegExp(`put ${selected} onto the battlefield`, "i").test(instructions) ? "battlefield" : null;
  if (!destination) return null;
  return {
    kind: "search-library",
    types: criterion.types,
    ...(criterion.subtypes.length ? { subtypes: criterion.subtypes } : {}),
    destination,
    ...(destination === "battlefield" && /onto the battlefield tapped/i.test(instructions) ? { tapped: true } : {}),
    reveal: /reveal/i.test(instructions)
  };
}

function parseCreateToken(text: string): SpellEffect | null {
  const match = /^Create\s+(?:(a|an|one|two|three|four|five|six|seven|eight|nine|ten|thirteen|X|\d+)\s+)?(?:(\d+)\/(\d+)\s+)?(.+?)\s+token(?:s)?(?:\s+named\s+([^,]+))?(?:\s+with\s+(.+))?$/i.exec(text.trim().replace(/\.$/, ""));
  if (!match) return null;
  const amount = /^X$/i.test(match[1] ?? "") ? "X" : toNumber(match[1]) ?? 1;
  const inlineStats = /^(\d+)\/(\d+)\s+/.exec(match[4]!.trim().replace(/\btapped\s+/i, ""));
  const power = match[2] ? Number(match[2]) : inlineStats ? Number(inlineStats[1]) : null;
  const toughness = match[3] ? Number(match[3]) : inlineStats ? Number(inlineStats[2]) : null;
  const descriptor = match[4]!.trim().replace(/\btapped\s+/i, "").replace(/^\d+\/\d+\s+/, "");
  const words = descriptor.split(/\s+/).filter(Boolean);
  const colorWords: Readonly<Record<string, string>> = { white: "W", blue: "U", black: "B", red: "R", green: "G" };
  const colors = words.filter((word) => colorWords[word.toLowerCase()]).map((word) => colorWords[word.toLowerCase()]!);
  const artifact = /\bartifact\b/i.test(descriptor);
  const creature = /\bcreature\b/i.test(descriptor);
  const subtype = words.filter((word) => !colorWords[word.toLowerCase()] && !/^(artifact|creature)$/i.test(word)).join(" ");
  const name = (match[5]?.trim() || (subtype || (artifact ? "Treasure" : "Token"))).replace(/\s+token$/i, "");
  const keywords = (match[6]?.match(/flying|reach|first strike|double strike|deathtouch|trample|vigilance|lifelink|menace|defender|haste|indestructible|hexproof|shroud/gi) ?? [])
    .map((keyword) => keyword.toLowerCase() as EnforcedKeyword);
  const typeLine = subtype ? `${artifact ? "Artifact " : ""}${creature ? "Creature" : "Artifact"} — ${subtype}` : `${artifact ? "Artifact" : "Creature"}`;
  return {
    kind: "create-token",
    amount,
    token: { name, typeLine, power, toughness, colors, keywords }
  };
}

/**
 * Recognises the trigger condition of one printed line.
 *
 * Each entry pairs an Oracle template with the event the engine raises and the
 * subject the event must involve. Anything outside this table is left unmatched
 * and reported as uncovered rather than attributed to the wrong permanent.
 */
const TRIGGER_TEMPLATES: readonly {
  readonly event: TriggerEvent;
  readonly subject: TriggerSubject;
  readonly pattern: RegExp;
}[] = [
  // The permanent that carries the ability is the object the event is about.
  { event: "enters-battlefield", subject: "self", pattern: /^(?:when|whenever)\s+~\s+enters(?:\s+the\s+battlefield)?,?\s*(.+)$/i },
  { event: "dies", subject: "self", pattern: /^(?:when|whenever)\s+~\s+dies,?\s*(.+)$/i },
  { event: "attacks", subject: "self", pattern: /^(?:when|whenever)\s+~\s+attacks(?:\s+for\s+the\s+first\s+time)?,?\s*(.+)$/i },
  { event: "blocks", subject: "self", pattern: /^(?:when|whenever)\s+~\s+blocks(?:\s+a\s+creature)?,?\s*(.+)$/i },
  { event: "deals-combat-damage-to-player", subject: "self", pattern: /^(?:when|whenever)\s+~\s+deals\s+combat\s+damage\s+to\s+a\s+player,?\s*(.+)$/i },
  { event: "becomes-tapped", subject: "self", pattern: /^(?:when|whenever)\s+~\s+becomes\s+tapped,?\s*(.+)$/i },

  // Another object triggers it. `another` excludes the source itself (CR 109.5).
  { event: "enters-battlefield", subject: "another-creature-you-control", pattern: /^whenever\s+another\s+creature\s+enters(?:\s+the\s+battlefield)?\s+under\s+your\s+control,?\s*(.+)$/i },
  { event: "enters-battlefield", subject: "creature-you-control", pattern: /^whenever\s+(?:a|another)?\s*creature\s+enters(?:\s+the\s+battlefield)?\s+under\s+your\s+control,?\s*(.+)$/i },
  { event: "enters-battlefield", subject: "land-you-control", pattern: /^whenever\s+a\s+land\s+you\s+control\s+enters(?:\s+the\s+battlefield)?,?\s*(.+)$/i },
  { event: "dies", subject: "another-creature-you-control", pattern: /^whenever\s+another\s+creature\s+you\s+control\s+dies,?\s*(.+)$/i },
  { event: "dies", subject: "creature-you-control", pattern: /^whenever\s+a\s+creature\s+you\s+control\s+dies,?\s*(.+)$/i },
  { event: "dies", subject: "another-creature", pattern: /^whenever\s+another\s+creature\s+dies,?\s*(.+)$/i },
  { event: "dies", subject: "any-creature", pattern: /^whenever\s+a\s+creature\s+dies,?\s*(.+)$/i },
  { event: "attacks", subject: "creature-you-control", pattern: /^whenever\s+a\s+creature\s+you\s+control\s+attacks,?\s*(.+)$/i },
  { event: "deals-combat-damage-to-player", subject: "artifact-creature-you-control", pattern: /^whenever\s+an\s+artifact\s+creature\s+you\s+control\s+deals\s+combat\s+damage\s+to\s+a\s+player,?\s*(.+)$/i },
  { event: "deals-combat-damage-to-player", subject: "creature-you-control", pattern: /^whenever\s+a\s+creature\s+you\s+control\s+deals\s+combat\s+damage\s+to\s+a\s+player,?\s*(.+)$/i },

  // A player is the subject.
  { event: "spell-cast", subject: "you", pattern: /^whenever\s+you\s+cast\s+a\s+spell,?\s*(.+)$/i },
  { event: "spell-cast", subject: "opponent", pattern: /^whenever\s+an\s+opponent\s+casts\s+a\s+spell,?\s*(.+)$/i },

  // Turn-structure triggers (CR 603.2b).
  { event: "upkeep", subject: "you", pattern: /^at\s+the\s+beginning\s+of\s+your\s+upkeep,?\s*(.+)$/i },
  { event: "upkeep", subject: "each-player", pattern: /^at\s+the\s+beginning\s+of\s+each\s+upkeep,?\s*(.+)$/i },
  { event: "upkeep", subject: "opponent", pattern: /^at\s+the\s+beginning\s+of\s+each\s+opponent[’']s\s+upkeep,?\s*(.+)$/i },
  { event: "draw-step", subject: "you", pattern: /^at\s+the\s+beginning\s+of\s+your\s+draw\s+step,?\s*(.+)$/i },
  { event: "end-step", subject: "you", pattern: /^at\s+the\s+beginning\s+of\s+your\s+end\s+step,?\s*(.+)$/i },
  { event: "end-step", subject: "each-player", pattern: /^at\s+the\s+beginning\s+of\s+each\s+end\s+step,?\s*(.+)$/i },
  { event: "end-step", subject: "opponent", pattern: /^at\s+the\s+beginning\s+of\s+each\s+opponent[’']s\s+end\s+step,?\s*(.+)$/i }
];

function matchTriggerLine(line: string): { event: TriggerEvent; subject: TriggerSubject; effectText: string } | null {
  // Landfall is a keyword ability word; its rules-bearing trigger follows the
  // dash and uses the same enters-battlefield event (CR 603.1, 603.2).
  const normalized = line.replace(/^landfall\s+[—–-]\s*/i, "");
  for (const template of TRIGGER_TEMPLATES) {
    const match = template.pattern.exec(normalized);
    if (match) return { event: template.event, subject: template.subject, effectText: match[1]!.trim() };
  }
  return null;
}

/** Matches one sentence against the closed effect templates. */
function recognizeSentence(sentence: string): { effect: SpellEffect; target: TargetKind } | null {
  const text = sentence.trim().replace(/\s+/g, " ").replace(/\.$/, "");
  let match: RegExpExecArray | null;

  if ((match = /^Draw (\w+) cards?$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount) return { effect: { kind: "draw", amount }, target: "none" };
  }
  if ((match = /^You gain (\w+) life$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount) return { effect: { kind: "gain-life", amount }, target: "none" };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "gain-life", amount: "X" }, target: "none" };
  }
  if ((match = /^Each opponent loses (\w+) life$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount) return { effect: { kind: "each-opponent-loses-life", amount }, target: "none" };
  }
  if ((match = /^~ deals (\w+) damage to any target$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "damage-any-target", amount }, target: "any" };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "damage-any-target", amount: "X" }, target: "any" };
  }
  if ((match = /^~ deals (\w+) damage to (?:each opponent|each of your opponents)$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "damage-each-opponent", amount }, target: "none" };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "damage-each-opponent", amount: "X" }, target: "none" };
  }
  if ((match = /^~ deals (\w+) damage to target player or planeswalker$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "damage-any-target", amount }, target: "player-or-planeswalker" };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "damage-any-target", amount: "X" }, target: "player-or-planeswalker" };
  }
  if ((match = /^~ deals (\w+) damage to each creature and each player$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "damage-each-creature-and-player", amount }, target: "none" };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "damage-each-creature-and-player", amount: "X" }, target: "none" };
  }
    if ((match = /^Equip (\w+) \(cost\)$/i.exec(text)))
    const cost = match[1];
    if (cost !== null) return { effect: { kind: "equip-{cost}", cost: cost }, target: "none" };
  }
if ((match = /^Target player draws (\w+) cards?$/i.exec(text))) {
  if ((match = /^Target creature or player prevents (\w+) damage$/i.exec(text)))
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "damage-prevent-target", amount }, target: "any" };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "damage-prevent-target", amount: "X" }, target: "any" };
  }
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "draw-target-player", amount }, target: "player" };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "draw-target-player", amount: "X" }, target: "player" };
  }
  if ((match = /^Each player draws (\w+) cards?$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "each-player-draw", amount }, target: "none" };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "each-player-draw", amount: "X" }, target: "none" };
  }
  if ((match = /^Target player discards (a|an|one|two|three|four|five|\d+) cards?$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "discard-target-player", amount }, target: "player" };
  }
  if ((match = /^Target player mills (\w+) cards?$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "mill-target-player", amount }, target: "player" };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "mill-target-player", amount: "X" }, target: "player" };
  }
  if ((match = /^~ deals (\w+) damage to each (other )?creature$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "damage-all-creatures", amount, excludeSource: Boolean(match[2]) }, target: "none" };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "damage-all-creatures", amount: "X", excludeSource: Boolean(match[2]) }, target: "none" };
  }
  if ((match = /^(All creatures|Creatures you control|Target creature) gets? ([+-]\d+)\/([+-]\d+) until end of turn$/i.exec(text))) {
    const power = Number(match[2]);
    const toughness = Number(match[3]);
    const kind = /^all/i.test(match[1]!) ? "modify-all-creatures"
      : /^creatures you control/i.test(match[1]!) ? "modify-creatures-you-control"
        : "modify-target-creature";
    return {
      effect: { kind, power, toughness } as SpellEffect,
      target: kind === "modify-target-creature" ? "creature" : "none"
    };
  }
  if ((match = /^Put (a|an|one|two|three|four|five|\d+) (\+1\/\+1|-1\/-1) counter(?:s)? on target creature$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "add-counter-target-creature", counter: match[2]!, amount }, target: "creature" };
  }
  if ((match = /^~ deals (\w+) damage to target creature$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "damage-any-target", amount }, target: "creature" };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "damage-any-target", amount: "X" }, target: "creature" };
  }
  if (/^Destroy target creature$/i.test(text)) return { effect: { kind: "destroy-target-creature" }, target: "creature" };
  if (/^Destroy target artifact or enchantment$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "artifact-or-enchantment" };
  if (/^Destroy target artifact$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "artifact" };
  if (/^Destroy target enchantment$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "enchantment" };
  if (/^Destroy target land$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "land" };
  if (/^Destroy target artifact, creature, or planeswalker$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "artifact-creature-or-planeswalker" };
  if (/^Destroy target artifact, enchantment, or land$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "artifact-enchantment-or-land" };
  if (/^Destroy target nonland permanent$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "nonland" };
  if (/^Destroy target nonartifact creature$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "nonartifact-creature" };
  if (/^Destroy target nonblack creature$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "nonblack-creature" };
  if (/^Destroy target creature with flying$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "creature-with-flying" };
  if (/^Destroy target nonbasic land$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "nonbasic-land" };
  if (/^Destroy target noncreature permanent$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "noncreature-permanent" };
  if (/^Exile target (?:artifact or enchantment|nonland permanent|permanent|creature)$/i.test(text)) {
    const target = /artifact or enchantment/i.test(text) ? "artifact-or-enchantment"
      : /nonland/i.test(text) ? "nonland" : /creature$/i.test(text) ? "creature" : "permanent";
    return { effect: { kind: "exile-target-permanent" }, target };
  }
  if (/^Exile target artifact$/i.test(text)) return { effect: { kind: "exile-target-permanent" }, target: "artifact" };
  const subtypeTarget = /^(?:Destroy|Exile) target ([A-Za-z][A-Za-z'’/-]*)(?: from (?:the )?(?:battlefield|graveyard|hand))?$/i.exec(text);
  if (subtypeTarget && !CARD_TYPES.some((type) => type.toLowerCase() === subtypeTarget[1]!.toLowerCase()) && !/^(?:permanent|nonland|spell|player|creature)$/i.test(subtypeTarget[1]!)) {
    return { effect: { kind: /Destroy/i.test(text) ? "destroy-target-permanent" : "exile-target-permanent" }, target: `subtype:${subtypeTarget[1]!}` };
  }
  if (/^Exile target player's graveyard$/i.test(text)) return { effect: { kind: "exile-target-graveyard" }, target: "player" };
  if (/^Return target creature to its owner's hand$/i.test(text)) return { effect: { kind: "return-target-creature" }, target: "creature" };
  if (/^Return target permanent to its owner's hand$/i.test(text)) return { effect: { kind: "return-target-permanent" }, target: "permanent" };
  if (/^Return a land you control to its owner's hand$/i.test(text)) return { effect: { kind: "return-target-land" }, target: "land-you-control" };
  if (/^Untap equipped creature$/i.test(text)) return { effect: { kind: "untap-equipped-creature" }, target: "none" };
  if (/^Untap all other creatures you control$/i.test(text)) return { effect: { kind: "untap-all-other-creatures-you-control" }, target: "none" };
  if (/^Tap target creature$/i.test(text)) return { effect: { kind: "tap-target-permanent" }, target: "creature" };
  if (/^Untap target permanent$/i.test(text)) return { effect: { kind: "untap-target-permanent" }, target: "permanent" };
  if (/^Destroy all creatures$/i.test(text)) return { effect: { kind: "destroy-all-creatures" }, target: "none" };
  if (/^Destroy all artifacts, creatures, and enchantments$/i.test(text)) {
    return { effect: { kind: "destroy-all-artifacts-creatures-enchantments" }, target: "none" };
  }
  if (/^Counter target spell$/i.test(text)) return { effect: { kind: "counter-target-spell" }, target: "spell" };
  if (/^Counter target creature spell$/i.test(text)) return { effect: { kind: "counter-target-spell" }, target: "creature-spell" };
  if (/^Counter target noncreature spell$/i.test(text)) return { effect: { kind: "counter-target-spell" }, target: "noncreature-spell" };
  const token = parseCreateToken(text);
  if (token) return { effect: token, target: "none" };
  const genericSearch = parseLibrarySearch(text);
  if (genericSearch) return { effect: genericSearch, target: "none" };
  if (/^Search your library for an artifact or enchantment card, reveal it, then shuffle\. Put that card on top of your library$/i.test(text)) {
    return { effect: { kind: "search-library", types: ["Artifact", "Enchantment"], destination: "top", reveal: true }, target: "none" };
  }
  // Purely cosmetic trailing clauses do not change the outcome the engine produces.
  if (/^(It|They) can't be regenerated$/i.test(text)) return null;
  return null;
}

function isIgnorableSentence(sentence: string): boolean {
  return /^(It|They) can't be regenerated\.?$/i.test(sentence.trim());
}

function recognizeText(text: string): RecognizedText {
  const body = text.split("\n")
    // Scryfall uses `•`; a few imported historical rows contain U+FFFD in its
    // place. Both are presentation markers, never part of Oracle semantics.
    .map((raw) => {
      const line = raw.trim();
      return { text: line.replace(/^[•�]\s*/u, ""), bullet: /^[•�]\s*/u.test(line) };
    })
    .filter(Boolean);
  if (!body.length) return { effects: [], triggers: [], activatedAbilities: [], modalChoices: [], targetKind: "none", unimplementedText: [], covered: true };

  // Enlightened Tutor-style searches are one resolution instruction spread
  // over two sentences. Recognise the complete sequence before the generic
  // sentence splitter can mark the second half as unknown.
  const joined = body.map((entry) => entry.text).join(" ").replace(/\s+/g, " ").trim();
  if (/^Search your library for an artifact or enchantment card, reveal it, then shuffle\. Put that card on top of your library\.$/i.test(joined)) {
    return {
      effects: [{ kind: "search-library", types: ["Artifact", "Enchantment"], destination: "top", reveal: true }],
      triggers: [], activatedAbilities: [], modalChoices: [], targetKind: "none", unimplementedText: [], covered: true
    };
  }

  const effects: SpellEffect[] = [];
  const triggers: TriggerDefinition[] = [];
  const activatedAbilities: ActivatedAbility[] = [];
  const modalChoices: ModalChoice[] = [];
  let targetKind: TargetKind = "none";
  const unimplementedText: string[] = [];

  for (let lineIndex = 0; lineIndex < body.length; lineIndex += 1) {
    const lineEntry = body[lineIndex]!;
    const line = lineEntry.text;
    if (/^Choose one(?:\s+[—–-�])?\s*$/i.test(line)) {
      const start = lineIndex + 1;
      const choices: ModalChoice[] = [];
      let cursor = start;
      let invalid = false;
      while (cursor < body.length && body[cursor]!.bullet) {
        const entry = body[cursor]!;
        const choiceText = entry.text;
        const executableText = choiceText.replace(/\s+It can(?:not|'t) be regenerated\.?$/i, "");
        const recognized = recognizeSentence(executableText);
        if (!recognized) invalid = true;
        else choices.push({ index: choices.length, text: choiceText, effect: recognized.effect, targetKind: recognized.target });
        cursor += 1;
      }
      if (!invalid && choices.length > 0 && choices.length === cursor - start) {
        modalChoices.push(...choices);
      } else {
        unimplementedText.push(line);
      }
      lineIndex = Math.max(lineIndex, cursor - 1);
      continue;
    }
    // Replacement text for entering tapped is executed by `parseEntersTapped`
    // before priority opens; it is not an unresolved spell effect.
    if (/^~\s+enters(?:\s+the\s+battlefield)?\s+tapped(?:\s+with\s+.+?\s+counters?\s+on\s+it)?(?:\s+unless\b.*)?\.?$/i.test(line)) continue;
    if (/^(?:cycling|[A-Za-z][A-Za-z ]+cycling)\b/i.test(line)) continue;
    if (/^equip\s+\{[^}]+\}(?:\{[^}]+\})*(?:\.?$)/i.test(line)) continue;
    if (/^level up\s+\{[^}]+\}(?:\{[^}]+\})*(?:\.?$)/i.test(line)) continue;
    if (/^level\s+\d+(?:-\d+|\+)?$/i.test(line) || /^\d+\/\d+$/.test(line)) continue;
    if (parseEquipmentModification(line)) continue;
    // A keyword-only line ("Flying, vigilance") is fully covered by the keyword engine.
    const words = line.replace(/\.$/, "").split(/,\s*/).map((word) => word.trim().toLowerCase());
    if (words.length && words.every((word) => (ENFORCED_KEYWORDS as readonly string[]).includes(word))) continue;
    // A mana ability counts as covered only when its printed output is really
    // recognised. One the parser cannot read still plays through the structured
    // `produced_mana` fallback, but the card must not claim its text is executed.
    const manaLine = /^([^:]{1,80}):\s*(add\b.*)$/i.exec(line);
    if (manaLine) {
      if (!parseManaInstruction(manaLine[2]!)) unimplementedText.push(line);
      continue;
    }

    const activated = parseActivatedAbility(line, activatedAbilities.length);
    if (activated) {
      activatedAbilities.push(activated);
      continue;
    }

    // Triggered abilities whose source is the permanent itself. The event is
    // raised by the engine, the ability is queued, ordered by APNAP and then
    // resolved through the normal stack. A trigger's own target is chosen when
    // it goes on the stack (CR 603.3d), so it never leaks into the card-level
    // `targetKind` a spell uses when it is cast.
    const triggered = matchTriggerLine(line);
    if (triggered) {
      const effectText = triggered.effectText;
      const optional = /^you\s+may\b/i.test(effectText);
      const recognized = recognizeSentence(optional ? effectText.replace(/^you\s+may\s+/i, "") : effectText);
      if (recognized) {
        triggers.push({
          event: triggered.event,
          subject: triggered.subject,
          effect: recognized.effect,
          optional,
          targetKind: recognized.target,
          sourceText: line
        });
      } else {
        unimplementedText.push(line);
      }
      continue;
    }

    for (const sentence of line.split(SENTENCE_SPLIT)) {
      if (!sentence.trim()) continue;
      const recognized = recognizeSentence(sentence);
      if (!recognized) {
        if (!isIgnorableSentence(sentence)) unimplementedText.push(sentence.trim());
        continue;
      }
      effects.push(recognized.effect);
      if (recognized.target !== "none") targetKind = recognized.target;
    }
  }
  return { effects, triggers, activatedAbilities, modalChoices, targetKind, unimplementedText, covered: unimplementedText.length === 0 };
}

const profileCache = new Map<string, CardProfile>();

/** Builds (and memoises) the engine profile for one printed card. */
export function cardProfile(card: CardData): CardProfile {
  const cached = profileCache.get(card.scryfall_id);
  if (cached) return cached;

  const face = frontFace(card);
  const { supertypes, types, subtypes } = splitTypeLine(face.type_line);
  const text = normalizedOracle(face);
  const keywords = (card.keywords ?? [])
    .map((keyword) => keyword.toLowerCase())
    .filter((keyword): keyword is EnforcedKeyword => (ENFORCED_KEYWORDS as readonly string[]).includes(keyword));
  const isPermanent = types.some((type) => type === "Land" || type === "Creature" || type === "Artifact" || type === "Enchantment" || type === "Planeswalker" || type === "Battle");
  const cost = parseManaCost(face.mana_cost);
  const recognized = recognizeText(text);
  const manaAbilities = isPermanent ? parseManaAbilities(card, text) : [];
  const cyclingCost = parseCyclingCost(text);
  const cyclingSearches = parseCyclingSearches(text);
  const equipCost = parseEquipCost(text);
  const equipmentModification = subtypes.some((subtype) => subtype.toLowerCase() === "equipment")
    ? parseEquipmentModification(text) : null;
  const levelUpCost = parseLevelUpCost(text);
  const levelDefinitions = parseLevelDefinitions(text);

  const profile: CardProfile = {
    name: card.name,
    typeLine: card.type_line,
    types,
    supertypes,
    subtypes,
    cost,
    manaValue: cost?.manaValue ?? Math.round(card.cmc ?? 0),
    colors: [...(face.colors ?? card.colors ?? [])],
    colorIdentity: [...(card.color_identity ?? [])],
    keywords,
    power: numeric(face.power),
    toughness: numeric(face.toughness),
    loyalty: numeric(face.loyalty),
    manaAbilities,
    cyclingCost,
    cyclingSearches,
    equipCost,
    equipmentModification,
    levelUpCost,
    levelDefinitions,
    activatedAbilities: isPermanent
      ? [
          ...recognized.activatedAbilities,
          ...(levelUpCost ? [{
            index: recognized.activatedAbilities.length,
            requiresTap: false,
            sacrificesSelf: false,
            lifeCost: 0,
            manaCost: levelUpCost,
            effect: { kind: "level-up" as const },
            targetKind: "none" as const,
            sorcerySpeed: true,
            text: `Level up ${levelUpCost.raw}`
          }] : [])
        ]
      : [],
    modalChoices: recognized.modalChoices,
    effects: recognized.effects,
    triggers: recognized.triggers,
    targetKind: recognized.targetKind,
    entersTapped: types.includes("Land") ? parseEntersTapped(text, face.type_line) : { kind: "untapped" },
    entersWithCounters: isPermanent ? parseEntersWithCounters(text) : [],
    isPermanent,
    // Lands are played, not cast; everything else needs a payable printed cost.
    castableFromHand: !types.includes("Land") && cost !== null && cost.symbols.length > 0,
    // A permanent whose extra text is unmatched still plays as a real body with real
    // combat keywords; a spell whose text is unmatched would resolve doing nothing.
    fullyImplemented: recognized.covered,
    unimplementedText: recognized.unimplementedText,
    oracleText: text
  };
  profileCache.set(card.scryfall_id, profile);
  return profile;
}

export function isCreature(profile: CardProfile): boolean { return profile.types.includes("Creature"); }
export function isLand(profile: CardProfile): boolean { return profile.types.includes("Land"); }
export function hasKeyword(profile: CardProfile, keyword: EnforcedKeyword): boolean { return profile.keywords.includes(keyword); }
