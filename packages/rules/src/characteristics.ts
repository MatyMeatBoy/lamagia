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
  "hexproof", "shroud", "flash", "fear"
] as const;
export type EnforcedKeyword = (typeof ENFORCED_KEYWORDS)[number];

export interface ManaAbility {
  readonly index: number;
  /** The mana types the controller may choose between for each mana produced. */
  readonly produces: readonly ManaType[];
  readonly amount: number;
  /** "Add {C} for each <Subtype> on the battlefield / you control" (Priest of Titania, Magus of the Coffers). */
  readonly scalesWith?: { readonly kind: "subtype-anywhere" | "subtype-you-control"; readonly subtype: string };
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
  /** Creature chosen as an activation cost, optionally excluding the source. */
  readonly sacrificesCreature?: "any" | "another";
  /** Sacrifice an artifact you control as an activation cost. */
  readonly sacrificesArtifact?: boolean;
  /** Discard a card as an activation cost (Trading Post, CR 602.1). */
  readonly discardsCard?: boolean;
  /** Sacrifice a land you control as an activation cost (Sylvan Safekeeper). */
  readonly sacrificesLand?: boolean;
  /** Counters removed from the source as an activation cost. */
  readonly removeCounters?: readonly CounterCost[];
  readonly lifeCost: number;
  /** Mana part of the activation cost, or null when the ability needs none. */
  readonly manaCost: ManaCost | null;
  readonly effect: SpellEffect;
  readonly targetKind: TargetKind;
  /** Level up is an activated ability with a sorcery-speed restriction. */
  readonly sorcerySpeed?: boolean;
  /** Planeswalker loyalty ability: signed loyalty change paid as the cost (CR 606). */
  readonly loyaltyCost?: number;
  /** "Activate only if an opponent controls N or more lands" (Tectonic Edge). */
  readonly requiresOpponentLands?: number;
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

/**
 * Printed combat restrictions and evasion the engine enforces at declaration time.
 *
 * These are static abilities, not effects: nothing goes on the stack, they simply
 * change which declarations are legal (CR 509.1a for blocking restrictions,
 * CR 508.1d for attack requirements). Keeping them in one structure means
 * `legalAttackers`, `legalBlockers` and `canBlock` all read the same source.
 */
export interface CombatRules {
  /** "~ can't attack" (CR 506.3a). Distinct from defender only in wording. */
  readonly cannotAttack: boolean;
  /** "~ can't block" (CR 509.1a). */
  readonly cannotBlock: boolean;
  /** "~ can't be blocked" (CR 509.1a). */
  readonly cannotBeBlocked: boolean;
  /** "~ attacks each combat if able" (CR 508.1d). */
  readonly mustAttack: boolean;
  /**
   * "~ can block only creatures with flying" and its siblings. The creature is
   * still a legal blocker, but only against an attacker that has the keyword.
   */
  readonly blocksOnlyWithKeyword: EnforcedKeyword | null;
  /**
   * Landwalk (CR 702.14): unblockable while the defending player controls a land
   * with one of these subtypes. Stored as subtypes rather than as keywords
   * because the check is about the defender's board, not the attacker's.
   */
  readonly landwalk: readonly string[];
  /** "Prevent all combat damage that would be dealt to and dealt by ~" (Fog Bank). */
  readonly preventsAllCombatDamage: boolean;
  /** "You may have ~ assign its combat damage as though it weren't blocked" (Tornado Elemental). */
  readonly assignsAsUnblocked: boolean;
}

export const NO_COMBAT_RULES: CombatRules = {
  cannotAttack: false,
  cannotBlock: false,
  cannotBeBlocked: false,
  mustAttack: false,
  blocksOnlyWithKeyword: null,
  landwalk: [],
  preventsAllCombatDamage: false,
  assignsAsUnblocked: false
};

/** Basic land types landwalk can name, plus the two most common nonbasic ones. */
const LANDWALK_SUBTYPES = ["plains", "island", "swamp", "mountain", "forest", "desert", "legendary"] as const;

/**
 * Reads the closed set of combat restriction lines.
 *
 * Returns null when the line is not a combat restriction at all, so the caller
 * can keep looking; returning an empty rule set would silently swallow text.
 */
function parseCombatRuleLine(line: string): Partial<CombatRules> | null {
  const text = line.trim().replace(/\.$/, "").toLowerCase();

  if (/^~ can't attack$/.test(text)) return { cannotAttack: true };
  if (/^~ can't block$/.test(text)) return { cannotBlock: true };
  if (/^~ can't be blocked$/.test(text)) return { cannotBeBlocked: true };
  if (/^~ can't attack or block$/.test(text)) return { cannotAttack: true, cannotBlock: true };
  if (/^~ attacks each combat if able$/.test(text)) return { mustAttack: true };
  if (/^prevent all combat damage that would be dealt to and dealt by ~$/i.test(text)) return { preventsAllCombatDamage: true };
  if (/^you may have ~ assign its combat damage as though it weren't blocked$/i.test(text)) return { assignsAsUnblocked: true };

  const blocksOnly = /^~ can block only creatures with (flying|reach|defender|flash|haste|menace|trample|vigilance|lifelink|deathtouch|first strike|double strike|indestructible|hexproof|shroud)$/.exec(text);
  if (blocksOnly) return { blocksOnlyWithKeyword: blocksOnly[1] as EnforcedKeyword };

  // Landwalk is printed as one word: "swampwalk", "islandwalk", "legendary landwalk".
  const walk = new RegExp(`^(?:(${LANDWALK_SUBTYPES.join("|")})walk|(${LANDWALK_SUBTYPES.join("|")}) landwalk)$`).exec(text);
  if (walk) return { landwalk: [(walk[1] ?? walk[2])!] };

  return null;
}

/**
 * Folds every recognised combat-restriction line of a card into one rule set.
 *
 * `lines` is the whole normalized Oracle body; anything not recognised is left
 * for the caller to report as unimplemented.
 */
export function parseCombatRules(lines: readonly string[]): { rules: CombatRules; consumed: ReadonlySet<string> } {
  let rules = NO_COMBAT_RULES;
  const consumed = new Set<string>();
  for (const line of lines) {
    const parsed = parseCombatRuleLine(line);
    if (!parsed) continue;
    rules = {
      ...rules,
      ...parsed,
      landwalk: [...rules.landwalk, ...(parsed.landwalk ?? [])]
    };
    consumed.add(line);
  }
  return { rules, consumed };
}

/** Static bonuses granted by an Equipment to its equipped creature. */
export interface EquipmentModification {
  readonly power: number;
  readonly toughness: number;
  readonly keywords: readonly EnforcedKeyword[];
  readonly text: string;
}

export interface StaticKeywordGrant {
  readonly scope: "creatures-you-control" | "other-creatures-you-control" | "subtype-creatures-you-control";
  readonly keyword: EnforcedKeyword;
  readonly subtype?: string;
}

export interface StaticPowerToughnessGrant {
  readonly scope: "other-creatures-you-control" | "all-color-creatures" | "subtype-creatures-you-control" | "creatures-you-control-counter-threshold";
  readonly power: number;
  readonly toughness: number;
  readonly color?: string;
  readonly subtype?: string;
  readonly counterName?: string;
  readonly threshold?: number;
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
  readonly tapped: boolean;
}

/** A closed set of effects the engine executes. Everything else is flagged unimplemented. */
export type SpellEffect =
  | { readonly kind: "compound"; readonly effects: readonly SpellEffect[] }
  | { readonly kind: "incite-rebellion" }
  | { readonly kind: "draw"; readonly amount: number | "X" }
  | { readonly kind: "draw-target-player"; readonly amount: number | "X" }
  | { readonly kind: "draw-active-player" }
  | { readonly kind: "draw-equal-tapped-creatures" }
  | { readonly kind: "draw-equal-controlled-type"; readonly type: CardType }
  | { readonly kind: "draw-equal-controlled-color-creature"; readonly color: string }
  | { readonly kind: "draw-equal-graveyard-creatures" }
  | { readonly kind: "draw-equal-greatest-mana-value-you-control" }
  | { readonly kind: "each-player-draw"; readonly amount: number | "X" }
  | { readonly kind: "each-player-discard-and-draw"; readonly amount: number }
  | { readonly kind: "each-opponent-draw"; readonly amount: number | "X" }
  | { readonly kind: "discard-target-player"; readonly amount: number | "X" }
  | { readonly kind: "discard-target-player-hand" }
  | { readonly kind: "draw-then-discard"; readonly draw: number; readonly discard: number }
  | { readonly kind: "exile-self" }
  | { readonly kind: "shuffle-self-into-library" }
  | { readonly kind: "return-source-to-hand" }
  | { readonly kind: "sacrifice-source" }
  | { readonly kind: "mill-target-player"; readonly amount: number | "X" }
  | { readonly kind: "mill-each-opponent"; readonly amount: number | "X" }
  | { readonly kind: "mill-each-player"; readonly amount: number | "X" }
  | { readonly kind: "gain-life"; readonly amount: number | "X" }
  | { readonly kind: "gain-life-each-controlled-type"; readonly amount: number; readonly type: CardType }
  | { readonly kind: "gain-life-each-subtype"; readonly amount: number; readonly subtype: string }
  | { readonly kind: "gain-life-each-permanent"; readonly amount: number }
  | { readonly kind: "gain-life-each-creature-you-control"; readonly amount: number }
  | { readonly kind: "gain-life-equal-target-power" }
  | { readonly kind: "lose-life"; readonly amount: number | "X" }
  | { readonly kind: "gain-life-target-player"; readonly amount: number | "X" }
  | { readonly kind: "each-player-gains-life"; readonly amount: number | "X" }
  | { readonly kind: "sacrifice-own-creature-then-draw"; readonly amount: number }
  | { readonly kind: "reanimate-own-best-creature-from-graveyard" }
  | { readonly kind: "return-random-creature-from-graveyard-to-hand" }
  | { readonly kind: "modify-all-attacking-creatures"; readonly power: number; readonly toughness: number }
  | { readonly kind: "target-player-sacrifice-attacking-creature" }
  | { readonly kind: "damage-triggering-player"; readonly amount: number }
  | { readonly kind: "triggering-player-loses-life"; readonly amount: number }
  | { readonly kind: "lose-life-target-player"; readonly amount: number | "X" }
  | { readonly kind: "lose-life-target-player-each-controlled-type"; readonly type: CardType }
  | { readonly kind: "each-player-loses-life"; readonly amount: number | "X" }
  | { readonly kind: "each-opponent-loses-life"; readonly amount: number | "X" }
  | { readonly kind: "extort" }
  | { readonly kind: "damage-any-target"; readonly amount: number | "X" }
  | { readonly kind: "damage-any-target-each-controlled-type"; readonly type: CardType }
  | { readonly kind: "damage-controller-equal-hand" }
  | { readonly kind: "damage-active-player-equal-hand" }
  | { readonly kind: "lose-life-each-player-equal-hand" }
  | { readonly kind: "damage-active-player-hand-minus"; readonly offset: number }
  | { readonly kind: "damage-each-opponent"; readonly amount: number | "X" }
  | { readonly kind: "damage-all-creatures"; readonly amount: number | "X"; readonly excludeSource: boolean; readonly filter?: "nonartifact" | "without-flying" | "with-flying"; readonly alsoPlaneswalkers?: boolean }
  | { readonly kind: "damage-each-creature-and-player"; readonly amount: number | "X" }
  | { readonly kind: "damage-each-player"; readonly amount: number | "X" }
  | { readonly kind: "damage-nonflying-creatures-and-players"; readonly amount: number | "X" }
  /** Layer 7c P/T modifications which expire during cleanup (CR 613.4c, 514.2). */
  | { readonly kind: "modify-all-creatures"; readonly power: number; readonly toughness: number }
  | { readonly kind: "modify-all-creatures-minus-X" }
  | { readonly kind: "modify-all-creatures-per-land"; readonly power: number; readonly toughness: number; readonly subtype: string }
  | { readonly kind: "modify-target-creature-morbid"; readonly power: number; readonly toughness: number; readonly morbidPower: number; readonly morbidToughness: number }
  | { readonly kind: "modify-creatures-you-control"; readonly power: number; readonly toughness: number }
  | { readonly kind: "modify-target-creature"; readonly power: number; readonly toughness: number }
  | { readonly kind: "modify-source-creature"; readonly power: number; readonly toughness: number }
  | { readonly kind: "modify-target-creature-per-subtype"; readonly subtype: string; readonly anywhere?: boolean }
  | { readonly kind: "add-counter-target-per-subtype"; readonly counter: string; readonly subtype: string; readonly anywhere?: boolean }
  | { readonly kind: "scry"; readonly amount: number; readonly thenDraw?: number }
  | { readonly kind: "look-put-one-in-hand"; readonly amount: number }
  | { readonly kind: "grant-target-creature-keyword"; readonly keyword: EnforcedKeyword }
  | { readonly kind: "grant-permanents-you-control-keyword"; readonly keyword: EnforcedKeyword }
  | { readonly kind: "overwhelming-stampede" }
  | { readonly kind: "grant-all-creatures-keyword"; readonly keyword: EnforcedKeyword }
  | { readonly kind: "modify-and-grant-target-creature"; readonly power: number; readonly toughness: number; readonly keyword: EnforcedKeyword }
  | { readonly kind: "add-counter-target-creature"; readonly counter: string; readonly amount: number }
  | { readonly kind: "add-counter-source"; readonly counter: string; readonly amount: number }
  | { readonly kind: "add-counter-creatures-subtype"; readonly counter: string; readonly amount: number; readonly subtype: string }
  | { readonly kind: "add-counter-creatures-you-control"; readonly counter: string; readonly amount: number }
  | { readonly kind: "add-counter-all-creatures"; readonly counter: string; readonly amount: number | "X" }
  | { readonly kind: "remove-all-counters-target" }
  | { readonly kind: "remove-all-counters-all-and-exile-tokens" }
  | { readonly kind: "destroy-target-creature" }
  | { readonly kind: "destroy-target-creature-then-life-loss" }
  | { readonly kind: "destroy-target-creature-then-controller-token"; readonly token: TokenDefinition }
  | { readonly kind: "destroy-target-permanent" }
  /** Creates one destruction-replacement shield for the source permanent (CR 701.19). */
  | { readonly kind: "regenerate-source" }
  /** Creates one destruction-replacement shield for the targeted creature (CR 701.19). */
  | { readonly kind: "regenerate-target-creature" }
  | { readonly kind: "destroy-all-artifacts-creatures-enchantments" }
  | { readonly kind: "exile-target-permanent" }
  | { readonly kind: "exile-target-graveyard" }
  | { readonly kind: "return-target-creature" }
  | { readonly kind: "return-target-permanent" }
  | { readonly kind: "return-n-nonland-permanents"; readonly count: number | "X" }
  | { readonly kind: "return-n-creatures"; readonly count: number | "X" }
  | { readonly kind: "destroy-n-creatures"; readonly count: number | "X"; readonly nonblack?: boolean }
  | { readonly kind: "undying-return"; readonly counter: "+1/+1" | "-1/-1" }
  | { readonly kind: "oblation"; readonly draw: number }
  | { readonly kind: "devotion-drain"; readonly color: string }
  | { readonly kind: "each-opponent-sacrifice-creature" }
  | { readonly kind: "syphon-mind" }
  | { readonly kind: "return-all-your-graveyard-to-hand" }
  | { readonly kind: "xathrid-upkeep"; readonly fallbackLife: number }
  | { readonly kind: "disciple-of-bolas" }
  | { readonly kind: "create-copy-token"; readonly amount: number; readonly kickedAmount?: number }
  | { readonly kind: "drain-target-toughness-pump-source-power" }
  | { readonly kind: "exile-all-attacking-creatures" }
  | { readonly kind: "tap-all-nonblue-skip-untap" }
  | { readonly kind: "shuffle-source-into-library" }
  | { readonly kind: "destroy-all-then-reanimate-one" }
  | { readonly kind: "you-and-opponent-each"; readonly effect: SpellEffect }
  | { readonly kind: "untap-all-nonland-both" }
  | { readonly kind: "play-additional-land"; readonly amount: number }
  | { readonly kind: "tendrils-of-corruption"; readonly subtype: string }
  | { readonly kind: "bottom-attacker-controller-gains-toughness" }
  | { readonly kind: "target-player-discard-unless-land"; readonly discard: number }
  | { readonly kind: "return-target-land" }
  | { readonly kind: "return-target-card-from-graveyard" }
  | { readonly kind: "return-target-creature-card-from-graveyard-to-battlefield" }
  | { readonly kind: "return-target-land-card-from-graveyard-to-battlefield" }
  | { readonly kind: "return-target-artifact-card-from-graveyard-to-battlefield" }
  | { readonly kind: "exile-target-card-from-graveyard" }
  | { readonly kind: "return-target-card-to-library-top" }
  | { readonly kind: "untap-equipped-creature" }
  | { readonly kind: "untap-all-other-creatures-you-control" }
  | { readonly kind: "destroy-all-creatures"; readonly tappedOnly?: boolean; readonly flyingOnly?: boolean; readonly xThreshold?: number; readonly excludeSource?: boolean }
  | { readonly kind: "destroy-creatures-power-greater-than-target" }
  | { readonly kind: "counter-target-spell" }
  /** Resolves a level-up activation by adding one level counter (CR 702.87). */
  | { readonly kind: "level-up" }
  | { readonly kind: "tap-target-permanent" }
  | { readonly kind: "target-cant-block" }
  | { readonly kind: "add-mana"; readonly pool: Readonly<Record<string, number>> }
  | { readonly kind: "karoo-bounce"; readonly subtype: string }
  | { readonly kind: "untap-target-permanent" }
  | { readonly kind: "attach-equipment" }
  | { readonly kind: "create-token"; readonly amount: number | "X" | "lands-you-control" | "creatures-you-control" | "creatures-on-battlefield" | "equipment-attached-to-source" | "creatures-died-this-turn" | "opponents-with-4-plus-cards"; readonly token: TokenDefinition; readonly statsFromAmount?: boolean }
  | {
      readonly kind: "search-library";
      readonly types: readonly CardType[];
      readonly subtypes?: readonly string[];
      readonly destination: "top" | "hand" | "graveyard" | "battlefield";
      /** Ramp templates put the found land onto the battlefield tapped. */
      readonly tapped?: boolean;
      readonly reveal: boolean;
      /** "up to N" — more than one card is fetched at once (auto-resolved). */
      readonly count?: number;
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
  | "end-step"
  | "life-gained"
  | "life-lost"
  | "draws-card";

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
  | "equipped-creature"
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
  "end-step": "habilidad del paso final",
  "life-gained": "life-gain trigger",
  "life-lost": "life-loss trigger",
  "draws-card": "habilidad de robo"
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
  readonly condition?:
    | { readonly kind: "no-controlled-subtype"; readonly subtype: string }
    | { readonly kind: "controlled-creature-power-at-least"; readonly amount: number }
    | { readonly kind: "controlled-subtype-at-least"; readonly subtype: string; readonly amount: number }
    | { readonly kind: "creature-died-this-turn" }
    | { readonly kind: "cast-from-hand" }
    | { readonly kind: "entering-power-at-most"; readonly amount: number };
  readonly spellType?: "creature" | "instant-or-sorcery";
  /** Colour filter on a spell-cast trigger (Titania's Chosen). */
  readonly spellColor?: string;
  /** Creature-subtype filter on a spell-cast trigger (Lys Alana Huntmaster). */
  readonly spellSubtype?: string;
  /** Only nontoken permanents fire this trigger (Soul of the Harvest). */
  readonly nontoken?: boolean;
  /** Excludes creatures of this subtype from a dies/enters trigger (Requiem Angel). */
  readonly excludeSubtype?: string;
  /** "if it was kicked" gate on an enters trigger (CR 702.33e, 603.4). */
  readonly requiresKicked?: boolean;
  /** "if its evoke cost was paid" gate on the sacrifice trigger (CR 702.34c). */
  readonly requiresEvoked?: boolean;
  /** Optional mana cost to get the effect ("you may pay {cost}. If you do, ..."). */
  readonly payCost?: ManaCost;
}

export type TargetKind =
  | "any" | "player" | "creature" | "spell" | "creature-spell" | "noncreature-spell" | "permanent" | "artifact-or-enchantment"
  | "artifact-creature-or-planeswalker" | "artifact-enchantment-or-land" | "player-or-planeswalker" | "artifact" | "nonland" | "nonartifact-creature"
  | "enchantment" | "land"
  | "nonblack-creature" | "nonartifact-nonblack-creature" | "non-demon-creature" | "creature-with-flying" | "creature-you-control" | "nonbasic-land" | "noncreature-permanent" | "land-you-control"
  | "attacking-or-blocking-creature" | "attacking-creature"
  | "creature-power-at-least-5"
  | "creature-toughness-at-least-4"
  | "creature-power-at-most-4"
  | "creature-toughness-at-most-4"
  | "creature-with-defender"
  | "creature-with-deathtouch"
  | "creature-with-lifelink"
  | "creature-with-menace"
  | "creature-with-haste"
  | "creature-with-first-strike"
  | "creature-with-double-strike"
  | "creature-with-trample"
  | "creature-with-vigilance"
  | "creature-with-indestructible"
  | "creature-with-hexproof"
  | "creature-with-shroud"
  | "card-in-your-graveyard" | "creature-card-in-your-graveyard" | "artifact-card-in-your-graveyard" | "enchantment-card-in-your-graveyard" | "instant-or-sorcery-card-in-your-graveyard" | "land-card-in-a-graveyard" | "permanent-card-in-your-graveyard-mv-3-or-less" | `subtype:${string}` | "none";
  

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
  readonly staticKeywordGrants: readonly StaticKeywordGrant[];
  readonly preventsLifeGain: boolean;
  readonly noMaximumHandSize: boolean;
  /** Grand Abolisher: opponents can't cast spells / activate nonmana abilities during your turn (CR 720). */
  readonly locksOpponentsOnYourTurn: boolean;
  /** Pontiff of Blight: "Other creatures you control have extort" (CR 702.39). */
  readonly grantsExtortToOthers: boolean;
  /** Siege Behemoth: while it attacks, your creatures assign combat damage as though unblocked (CR 510.1c). */
  readonly attackersAssignAsUnblockedWhileAttacking: boolean;
  /** Abyssal Persecutor: "your opponents can't lose the game" (CR 104.3a). */
  readonly preventsOpponentLoss: boolean;
  /** Warmonger Hellkite: "All creatures attack each combat if able" (CR 508.1d). */
  readonly forcesAllCreaturesToAttack: boolean;
  /** "~ can't be countered" (CR 613.9, Niv-Mizzet Parun etc.). */
  readonly cantBeCountered: boolean;
  readonly staticPowerToughnessGrants: readonly StaticPowerToughnessGrant[];
  /** Printed Level up cost and level bands, when present. */
  readonly levelUpCost: ManaCost | null;
  readonly levelDefinitions: readonly LevelDefinition[];
  readonly activatedAbilities: readonly ActivatedAbility[];
  readonly modalChoices: readonly ModalChoice[];
  readonly effects: readonly SpellEffect[];
  readonly triggers: readonly TriggerDefinition[];
  readonly targetKind: TargetKind;
  readonly kickerCost: ManaCost | null;
  readonly kickedEffects: readonly SpellEffect[];
  /** Evoke alternative cost (CR 702.34), null when absent. */
  readonly evokeCost: ManaCost | null;
  /** Flashback cost — cast from graveyard, then exile (CR 702.34), null when absent. */
  readonly flashbackCost: ManaCost | null;
  /** "As an additional cost to cast ~, exile X cards from your graveyard" (Skeletal Scrying, CR 601.2b). */
  readonly additionalCostExileGraveyardX: boolean;
  /** Rebound (CR 702.88): if cast from hand, exile on resolution and offer a free recast next upkeep. */
  readonly hasRebound: boolean;
  /** "As an additional cost to cast ~, sacrifice a land" (Harrow, CR 601.2b). */
  readonly additionalCostSacrificeLand: boolean;
  /** Generic cost reduction per creature on the battlefield ("costs {N} less to cast for each creature"). */
  readonly costReducesPerBoardCreature: number;
  /** Static "<color/type> spells you cast cost {N} less to cast" grant (Medallion cycle, CR 118.9). */
  readonly spellCostReductionGrant: { readonly amount: number; readonly color?: string; readonly type?: CardType } | null;
  /** "<Basic type>s you control produce an additional {C}" (Crypt Ghast, CR 605). */
  readonly staticLandManaBonus: { readonly subtype: string; readonly mana: string } | null;
  /** Characteristic-defining P/T "equal to the number of X you control" (CR 604.3). */
  readonly cdaPowerToughness: "creatures-you-control" | "lands-you-control" | "artifacts-you-control" | "green-permanents-you-control" | "your-life-total" | "your-hand-size" | null;
  /** Lieutenant (Commander 2014): commander-conditional static bonuses. */
  readonly lieutenant: {
    readonly selfPower: number;
    readonly selfToughness: number;
    readonly otherPower: number;
    readonly otherToughness: number;
    readonly otherKeywords: readonly EnforcedKeyword[];
  } | null;
  readonly entersTapped: EntersTappedRule;
  /** Printed attack/block restrictions and landwalk evasion. */
  readonly combatRules: CombatRules;
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
  // "of any color in your commander's color identity" — modelled as any color;
  // the commander's identity is enforced at deck build, not at mana production.
  const commanderIdentity = /^add\s+(\w+)\s+mana\s+of\s+any\s+color\s+in\s+your\s+commander['’]s\s+color\s+identity$/i.exec(clause);
  if (commanderIdentity) {
    const amount = toNumber(commanderIdentity[1]);
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
    // "Add {C} for each <Subtype> on the battlefield / you control".
    const scaled = /^add\s+\{([WUBRGC])\}\s+for each\s+([A-Za-z][A-Za-z'’-]*)\s+(on the battlefield|you control)$/i.exec(effectText.trim().replace(/\.$/, ""));
    if (scaled && (!instruction?.produced)) {
      abilities.push({
        index: abilities.length, produces: [scaled[1]!.toUpperCase() as ManaType], amount: 1,
        scalesWith: { kind: /you control/i.test(scaled[3]!) ? "subtype-you-control" : "subtype-anywhere", subtype: scaled[2]! },
        ...(removeCounters.length ? { removeCounters } : {}),
        requiresTap, lifeCost, text: line.trim()
      });
      continue;
    }
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

const GRANTABLE_KEYWORDS = "flying|reach|first strike|double strike|deathtouch|trample|vigilance|lifelink|menace|defender|haste|indestructible|hexproof|shroud|fear";
function parseKeywordList(text: string): EnforcedKeyword[] {
  return text.split(/\s*(?:,|\band\b)\s*/i).map((word) => word.trim().toLowerCase())
    .filter((word): word is EnforcedKeyword => (ENFORCED_KEYWORDS as readonly string[]).includes(word));
}
function parseStaticKeywordGrant(line: string): StaticKeywordGrant[] {
  const clean = line.trim().replace(/\.$/, "");
  const own = new RegExp(`^(other )?creatures you control (?:have|gain) ((?:${GRANTABLE_KEYWORDS})(?:(?:,| and )(?:${GRANTABLE_KEYWORDS}))*)$`, "i").exec(clean);
  if (own) return parseKeywordList(own[2]!).map((keyword) => ({ scope: own[1] ? "other-creatures-you-control" as const : "creatures-you-control" as const, keyword }));
  const subtype = new RegExp(`^([A-Za-z][A-Za-z'’-]*) creatures (?:you control )?have ((?:${GRANTABLE_KEYWORDS})(?:(?:,| and )(?:${GRANTABLE_KEYWORDS}))*)$`, "i").exec(clean);
  if (subtype && !/^creature$/i.test(subtype[1]!)) return parseKeywordList(subtype[2]!).map((keyword) => ({ scope: "subtype-creatures-you-control" as const, keyword, subtype: subtype[1]! }));
  return [];
}

function parseStaticKeywordGrants(text: string): StaticKeywordGrant[] {
  return text.split("\n").flatMap(parseStaticKeywordGrant);
}

function parseStaticPowerToughnessGrant(line: string): StaticPowerToughnessGrant | null {
  const clean = line.trim().replace(/\.$/, "");
  const own = /^other\s+(?:(white|blue|black|red|green)\s+)?creatures\s+you\s+control\s+get\s+([+-]\d+)\/([+-]\d+)$/i.exec(clean);
  if (own) return {
    scope: "other-creatures-you-control",
    ...(own[1] ? { color: own[1].toUpperCase() } : {}),
    power: Number(own[2]), toughness: Number(own[3])
  };
  // "Black creatures get +1/+1" (Bad Moon) — every creature of the colour.
  const color = /^(white|blue|black|red|green)\s+creatures\s+get\s+([+-]\d+)\/([+-]\d+)$/i.exec(clean);
  const COLOR: Record<string, string> = { white: "W", blue: "U", black: "B", red: "R", green: "G" };
  if (color) return { scope: "all-color-creatures", color: COLOR[color[1]!.toLowerCase()], power: Number(color[2]), toughness: Number(color[3]) };
  // "Other Elves you control get +1/+1" (Imperious Perfect); "Other Elf creatures
  // you control get +1/+1" (Elvish Archdruid).
  const subtype = /^other\s+([A-Za-z][A-Za-z'’-]*?)s?(?:\s+creatures)?\s+you\s+control\s+get\s+([+-]\d+)\/([+-]\d+)$/i.exec(clean);
  if (subtype && !/^creature$/i.test(subtype[1]!)) return { scope: "subtype-creatures-you-control", subtype: subtype[1]!, power: Number(subtype[2]), toughness: Number(subtype[3]) };
  // "As long as ~ has seven or more quest counters on it, creatures you control get +5/+5" (Beastmaster Ascension).
  const gated = /^as long as ~ has ([a-z]+|\d+) or more ([a-z]+) counters on it, creatures you control get \+(\d+)\/\+(\d+)$/i.exec(clean);
  if (gated) {
    const threshold = toNumber(gated[1]!);
    if (threshold !== null) return { scope: "creatures-you-control-counter-threshold", counterName: gated[2]!.toLowerCase(), threshold, power: Number(gated[3]), toughness: Number(gated[4]) };
  }
  return null;
}

function parseStaticPowerToughnessGrants(text: string): StaticPowerToughnessGrant[] {
  return text.split("\n").map(parseStaticPowerToughnessGrant).filter((grant): grant is StaticPowerToughnessGrant => grant !== null);
}

/**
 * Parses an activation cost made from mana, tapping, paying life and
 * sacrificing its own source, removing counters, plus an effect the engine can
 * resolve.
 *
 * Everything else — untapping ({Q}), loyalty, energy, exiling or sacrificing
 * other permanents or discarding — leaves the ability out of
 * the profile rather than letting the table activate a cost it cannot pay.
 */
/** True when an effect reads the spell/ability's X (so an `{X}` cost is meaningful). */
function effectUsesVariable(effect: SpellEffect): boolean {
  const anyEffect = effect as Record<string, unknown>;
  if (anyEffect.amount === "X" || anyEffect.count === "X") return true;
  if (effect.kind === "drain-target-toughness-pump-source-power") return true;
  if (effect.kind === "compound") return effect.effects.some(effectUsesVariable);
  return false;
}

function parseActivatedAbility(line: string, index: number): ActivatedAbility | null {
  const activated = /^([^:]{1,120}):\s*(.+)$/.exec(line.trim());
  if (!activated) return null;
  const [, costText, effectText] = activated as unknown as [string, string, string];
  // Mana abilities have their own immediate-resolution path (CR 605.1a).
  if (/^add\b/i.test(effectText.trim())) return null;
  // Planeswalker loyalty abilities (CR 606): the cost is a signed loyalty change.
  const loyalty = /^\s*([+\u2212\u2013-])?\s*(\d+)\s*$/.exec(costText);
  if (loyalty) {
    const recognized = recognizeSentence(effectText);
    if (!recognized) return null;
    const magnitude = Number(loyalty[2]);
    const sign = loyalty[1] && /[\u2212\u2013-]/.test(loyalty[1]) ? -1 : 1;
    return {
      index, requiresTap: false, sacrificesSelf: false, lifeCost: 0, manaCost: null,
      loyaltyCost: magnitude === 0 ? 0 : sign * magnitude, sorcerySpeed: true,
      effect: recognized.effect, targetKind: recognized.target, text: line.trim()
    };
  }
  // "Activate only if an opponent controls N or more lands" (Tectonic Edge, CR 602.5).
  const oppLandGate = /\.\s*Activate only if an opponent controls (\w+) or more lands\.?\s*$/i.exec(effectText);
  const requiresOpponentLands = oppLandGate ? toNumber(oppLandGate[1]!) : null;
  const effectBody = oppLandGate ? effectText.slice(0, oppLandGate.index) : effectText;
  // The effect grammar is shared by spells, triggers and activations; do not
  // duplicate card-text patterns in the activation-cost parser.
  const recognized = recognizeSentence(effectBody);
  if (!recognized) return null;

  const symbols = costText.match(/\{[^}]+\}/g) ?? [];
  const requiresTap = symbols.some((symbol) => symbol.toUpperCase() === "{T}");
  // `{Q}` (untap) and every other non-mana symbol are outside the payable set.
  if (symbols.some((symbol) => /^\{Q\}$/i.test(symbol))) return null;
  const manaSymbols = symbols.filter((symbol) => !/^\{[TQ]\}$/i.test(symbol));
  const manaCost = manaSymbols.length ? parseManaCost(manaSymbols.join("")) : null;
  if (manaSymbols.length && !manaCost) return null;
  // An {X} cost is payable only when the effect actually consumes X (CR 107.3).
  if (manaCost?.hasVariable && !effectUsesVariable(recognized.effect)) return null;

  const sacrificesSelf = /sacrifice\s+~/i.test(costText);
  const sacrificeCreature = /sacrifice\s+(another\s+)?(?:a\s+|an\s+)?creature/i.exec(costText);
  const sacrificesArtifact = /sacrifice\s+(?:a\s+|an\s+)?artifact/i.test(costText);
  const discardsCard = /discard\s+a\s+card/i.test(costText);
  const sacrificesLand = /sacrifice\s+(?:a\s+|an\s+)?land/i.test(costText);
  const removedCounters: CounterCost[] = [];
  for (const match of costText.matchAll(/remove\s+(a|an|one|two|three|four|five|\d+)\s+([+\-]\d+\/[+\-]\d+|[\w/-]+(?:\s+[\w/-]+)*)\s+counters?\s+from\s+~/gi)) {
    const amount = toNumber(match[1]);
    const kind = match[2]?.trim().replace(/\s+/g, " ").toLowerCase();
    if (amount !== null && kind) removedCounters.push({ kind, amount });
  }
  const lifeMatch = /pay\s+(\d+)\s+life/i.exec(costText);
  const lifeCost = lifeMatch ? Number(lifeMatch[1]) : 0;
  const leftovers = costText
    .replace(/\{[^}]*\}/g, "")
    .replace(/pay\s+\d+\s+life/gi, "")
    .replace(/sacrifice\s+~/gi, "")
    .replace(/sacrifice\s+(?:another\s+|a\s+|an\s+)?creature/gi, "")
    .replace(/sacrifice\s+(?:a\s+|an\s+)?artifact/gi, "")
    .replace(/discard\s+a\s+card/gi, "")
    .replace(/sacrifice\s+(?:a\s+|an\s+)?land/gi, "")
    .replace(/remove\s+(?:a|an|one|two|three|four|five|\d+)\s+[+\-]\d+\/[+\-]\d+\s+counters?\s+from\s+~/gi, "")
    .replace(/[,\s]/g, "");
  if (leftovers.length) return null;
  return {
    index,
    requiresTap,
    sacrificesSelf,
    ...(sacrificeCreature ? { sacrificesCreature: sacrificeCreature[1] ? "another" as const : "any" as const } : {}),
    ...(sacrificesArtifact ? { sacrificesArtifact: true as const } : {}),
    ...(discardsCard ? { discardsCard: true as const } : {}),
    ...(sacrificesLand ? { sacrificesLand: true as const } : {}),
    ...(removedCounters.length ? { removeCounters: removedCounters } : {}),
    ...(requiresOpponentLands !== null ? { requiresOpponentLands } : {}),
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
  kickerCost?: ManaCost | null;
  kickedEffects?: SpellEffect[];
  evokeCost?: ManaCost | null;
  flashbackCost?: ManaCost | null;
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
  const single = /^Search your library for (?:a |an |up to (?:one|two|three|five) )?(.+?) card, (.+)$/i.exec(text);
  // "up to N basic land cards, put them onto the battlefield tapped, then shuffle" (Burnished Hart, Harrow).
  const multi = /^Search your library for up to (one|two|three) (.+?) cards(?:\s+that share a land type)?, put them onto the battlefield( tapped)?,?\s*(?:then shuffle)?\.?$/i.exec(text);
  if (multi) {
    const count = toNumber(multi[1]!) ?? 1;
    const criterion = searchCriterion(multi[2]!);
    return {
      kind: "search-library",
      types: criterion.types,
      ...(criterion.subtypes.length ? { subtypes: criterion.subtypes } : {}),
      destination: "battlefield",
      ...(multi[3] ? { tapped: true } : {}),
      reveal: false,
      count
    };
  }
  if (!single) return null;
  const criterion = searchCriterion(single[1]!);
  const instructions = single[2]!;
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
  const keywords = (match[6]?.match(/flying|reach|first strike|double strike|deathtouch|trample|vigilance|lifelink|menace|defender|haste|indestructible|hexproof|shroud|fear/gi) ?? [])
    .map((keyword) => keyword.toLowerCase() as EnforcedKeyword);
  const typeLine = subtype ? `${artifact ? "Artifact " : ""}${creature ? "Creature" : "Artifact"} — ${subtype}` : `${artifact ? "Artifact" : "Creature"}`;
  return {
    kind: "create-token",
    amount,
    token: { name, typeLine, power, toughness, colors, keywords, tapped: /\btapped\b/i.test(match[4]!) }
  };
}

function parseLandScaledToken(text: string): SpellEffect | null {
  if (!/\s+for each land you control$/i.test(text.trim())) return null;
  const base = parseCreateToken(text.trim().replace(/\s+for each land you control$/i, ""));
  return base?.kind === "create-token" ? { ...base, amount: "lands-you-control" } : null;
}

function parseEquipmentScaledToken(text: string): SpellEffect | null {
  const suffix = /\s+for each equipment attached to ~$/i;
  if (!suffix.test(text.trim())) return null;
  const base = parseCreateToken(text.trim().replace(suffix, "").replace(/^Create a\b/i, "Create a"));
  return base?.kind === "create-token" ? { ...base, amount: "equipment-attached-to-source" } : null;
}

function parseSacrificePowerToken(text: string): SpellEffect | null {
  const suffix = /,?\s*where x is the sacrificed creature's power$/i;
  if (!suffix.test(text.trim())) return null;
  const base = parseCreateToken(text.trim().replace(suffix, ""));
  return base?.kind === "create-token" ? { ...base, amount: "X" } : null;
}

function parseOpponentHandScaledToken(text: string): SpellEffect | null {
  const suffix = /,?\s*where x is the number of your opponents with four or more cards in hand$/i;
  if (!suffix.test(text.trim())) return null;
  const base = parseCreateToken(text.trim().replace(suffix, "").replace(/^Create X\b/i, "Create a"));
  return base?.kind === "create-token" ? { ...base, amount: "opponents-with-4-plus-cards" } : null;
}

function parseDeathScaledToken(text: string): SpellEffect | null {
  const trimmed = text.trim();
  // Spoils of Blood: "Create an X/X black Horror creature token, where X is the number of creatures that died this turn."
  const xx = /^Create an? X\/X (.+? token),?\s*where x is the number of creatures that died this turn$/i.exec(trimmed);
  if (xx) {
    const base = parseCreateToken(`Create a 1/1 ${xx[1]!}`);
    return base?.kind === "create-token" ? { ...base, amount: "creatures-died-this-turn", statsFromAmount: true } : null;
  }
  // Fresh Meat: "Create a 3/3 green Beast creature token for each creature put into your graveyard from the battlefield this turn."
  const suffix = /\s+for each creature put into your graveyard from the battlefield this turn$/i;
  if (suffix.test(trimmed)) {
    const base = parseCreateToken(trimmed.replace(suffix, ""));
    return base?.kind === "create-token" ? { ...base, amount: "creatures-died-this-turn" } : null;
  }
  return null;
}

function parseCreatureScaledToken(text: string): SpellEffect | null {
  const boardMatch = /\s*,?\s*where x is the number of creatures on the battlefield$/i;
  if (boardMatch.test(text.trim())) {
    const base = parseCreateToken(text.trim().replace(boardMatch, "").replace(/^Create X\b/i, "Create a"));
    return base?.kind === "create-token" ? { ...base, amount: "creatures-on-battlefield" } : null;
  }
  if (!/\s+for each creature you control$/i.test(text.trim())) return null;
  const base = parseCreateToken(text.trim().replace(/\s+for each creature you control$/i, ""));
  return base?.kind === "create-token" ? { ...base, amount: "creatures-you-control" } : null;
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
  readonly spellType?: "creature" | "instant-or-sorcery";
  readonly spellColor?: string;
  readonly spellSubtype?: string;
  readonly nontoken?: boolean;
}[] = [
  { event: "life-gained", subject: "you", pattern: /^whenever\s+you\s+gain\s+life,?\s*(.+)$/i },
  { event: "life-lost", subject: "you", pattern: /^whenever\s+you\s+lose\s+life,?\s*(.+)$/i },
  { event: "draws-card", subject: "you", pattern: /^whenever\s+you\s+draw\s+a\s+card,?\s*(.+)$/i },
  { event: "draws-card", subject: "opponent", pattern: /^whenever\s+an\s+opponent\s+draws\s+a\s+card,?\s*(.+)$/i },
  // The permanent that carries the ability is the object the event is about.
  { event: "enters-battlefield", subject: "self", pattern: /^(?:when|whenever)\s+~\s+enters(?:\s+the\s+battlefield)?,?\s*(.+)$/i },
  { event: "dies", subject: "self", pattern: /^(?:when|whenever)\s+~\s+dies,?\s*(.+)$/i },
  { event: "dies", subject: "self", pattern: /^(?:when|whenever)\s+~\s+is\s+put\s+into\s+a\s+graveyard\s+from\s+the\s+battlefield,?\s*(.+)$/i },
  // CR 603.6e fires this from every zone; the engine only models the
  // battlefield->graveyard case (by far the common one), so this is an
  // approximation rather than the full anywhere-trigger.
  { event: "dies", subject: "self", pattern: /^(?:when|whenever)\s+~\s+is\s+put\s+into\s+a\s+graveyard\s+from\s+anywhere,?\s*(.+)$/i },
  { event: "attacks", subject: "self", pattern: /^(?:when|whenever)\s+~\s+attacks(?:\s+for\s+the\s+first\s+time)?,?\s*(.+)$/i },
  { event: "blocks", subject: "self", pattern: /^(?:when|whenever)\s+~\s+blocks(?:\s+a\s+creature)?,?\s*(.+)$/i },
  { event: "deals-combat-damage-to-player", subject: "self", pattern: /^(?:when|whenever)\s+~\s+deals\s+combat\s+damage\s+to\s+a\s+player,?\s*(.+)$/i },
  { event: "becomes-tapped", subject: "self", pattern: /^(?:when|whenever)\s+~\s+becomes\s+tapped,?\s*(.+)$/i },

  // Another object triggers it. `another` excludes the source itself (CR 109.5).
  { event: "enters-battlefield", subject: "another-creature-you-control", pattern: /^whenever\s+another\s+creature\s+enters(?:\s+the\s+battlefield)?\s+under\s+your\s+control,?\s*(.+)$/i },
  { event: "enters-battlefield", subject: "creature-you-control", pattern: /^whenever\s+(?:a|another)?\s*creature\s+enters(?:\s+the\s+battlefield)?\s+under\s+your\s+control,?\s*(.+)$/i },
  { event: "enters-battlefield", subject: "land-you-control", pattern: /^whenever\s+a\s+land\s+you\s+control\s+enters(?:\s+the\s+battlefield)?,?\s*(.+)$/i },
  { event: "enters-battlefield", subject: "another-creature-you-control", pattern: /^whenever\s+another\s+creature\s+you\s+control\s+enters(?:\s+the\s+battlefield)?,?\s*(.+)$/i },
  { event: "enters-battlefield", subject: "creature-you-control", pattern: /^whenever\s+a\s+creature\s+you\s+control\s+enters(?:\s+the\s+battlefield)?,?\s*(.+)$/i },
  { event: "enters-battlefield", subject: "another-creature", pattern: /^whenever\s+another\s+creature\s+enters(?:\s+the\s+battlefield)?,?\s*(.+)$/i },
  { event: "enters-battlefield", subject: "any-creature", pattern: /^whenever\s+a\s+creature\s+enters(?:\s+the\s+battlefield)?,?\s*(.+)$/i },
  { event: "dies", subject: "another-creature-you-control", pattern: /^whenever\s+another\s+creature\s+you\s+control\s+dies,?\s*(.+)$/i },
  { event: "dies", subject: "creature-you-control", pattern: /^whenever\s+~\s+or\s+another\s+creature\s+you\s+control\s+dies,?\s*(.+)$/i },
  { event: "dies", subject: "creature-you-control", pattern: /^whenever\s+a\s+creature\s+you\s+control\s+dies,?\s*(.+)$/i },
  { event: "dies", subject: "another-creature", pattern: /^whenever\s+another\s+creature\s+dies,?\s*(.+)$/i },
  { event: "dies", subject: "any-creature", pattern: /^whenever\s+a\s+creature\s+dies,?\s*(.+)$/i },
  { event: "attacks", subject: "creature-you-control", pattern: /^whenever\s+a\s+creature\s+you\s+control\s+attacks,?\s*(.+)$/i },
  { event: "dies", subject: "equipped-creature", pattern: /^whenever\s+equipped\s+creature\s+dies,?\s*(.+)$/i },
  { event: "attacks", subject: "equipped-creature", pattern: /^whenever\s+equipped\s+creature\s+attacks,?\s*(.+)$/i },
  { event: "deals-combat-damage-to-player", subject: "equipped-creature", pattern: /^whenever\s+equipped\s+creature\s+deals\s+combat\s+damage\s+to\s+a\s+player,?\s*(.+)$/i },
  { event: "deals-combat-damage-to-player", subject: "artifact-creature-you-control", pattern: /^whenever\s+an\s+artifact\s+creature\s+you\s+control\s+deals\s+combat\s+damage\s+to\s+a\s+player,?\s*(.+)$/i },
  { event: "deals-combat-damage-to-player", subject: "creature-you-control", pattern: /^whenever\s+a\s+creature\s+you\s+control\s+deals\s+combat\s+damage\s+to\s+a\s+player,?\s*(.+)$/i },
  { event: "deals-combat-damage-to-player", subject: "any-creature", pattern: /^whenever\s+a\s+creature\s+deals\s+combat\s+damage\s+to\s+a\s+player,?\s*(.+)$/i },

  // A player is the subject.
  { event: "spell-cast", subject: "you", spellSubtype: "elf", pattern: /^whenever\s+you\s+cast\s+an\s+elf\s+spell,?\s*(.+)$/i },
  { event: "enters-battlefield", subject: "another-creature-you-control", nontoken: true, pattern: /^whenever\s+another\s+nontoken\s+creature\s+you\s+control\s+enters(?:\s+the\s+battlefield)?,?\s*(.+)$/i },
  { event: "spell-cast", subject: "you", spellType: "creature", pattern: /^whenever\s+you\s+cast\s+a\s+creature\s+spell,?\s*(.+)$/i },
  { event: "spell-cast", subject: "opponent", spellType: "creature", pattern: /^whenever\s+an\s+opponent\s+casts\s+a\s+creature\s+spell,?\s*(.+)$/i },
  { event: "spell-cast", subject: "each-player", spellType: "instant-or-sorcery", pattern: /^whenever\s+a\s+player\s+casts\s+an\s+instant\s+or\s+sorcery\s+spell,?\s*(.+)$/i },
  { event: "spell-cast", subject: "each-player", spellColor: "W", pattern: /^whenever\s+a\s+player\s+casts\s+a\s+white\s+spell,?\s*(.+)$/i },
  { event: "spell-cast", subject: "each-player", spellColor: "U", pattern: /^whenever\s+a\s+player\s+casts\s+a\s+blue\s+spell,?\s*(.+)$/i },
  { event: "spell-cast", subject: "each-player", spellColor: "B", pattern: /^whenever\s+a\s+player\s+casts\s+a\s+black\s+spell,?\s*(.+)$/i },
  { event: "spell-cast", subject: "each-player", spellColor: "R", pattern: /^whenever\s+a\s+player\s+casts\s+a\s+red\s+spell,?\s*(.+)$/i },
  { event: "spell-cast", subject: "each-player", spellColor: "G", pattern: /^whenever\s+a\s+player\s+casts\s+a\s+green\s+spell,?\s*(.+)$/i },
  { event: "spell-cast", subject: "you", pattern: /^whenever\s+you\s+cast\s+a\s+spell,?\s*(.+)$/i },
  { event: "spell-cast", subject: "opponent", pattern: /^whenever\s+an\s+opponent\s+casts\s+a\s+spell,?\s*(.+)$/i },

  // Turn-structure triggers (CR 603.2b).
  { event: "upkeep", subject: "you", pattern: /^at\s+the\s+beginning\s+of\s+your\s+upkeep,?\s*(.+)$/i },
  { event: "upkeep", subject: "each-player", pattern: /^at\s+the\s+beginning\s+of\s+each\s+upkeep,?\s*(.+)$/i },
  { event: "upkeep", subject: "opponent", pattern: /^at\s+the\s+beginning\s+of\s+each\s+opponent[’']s\s+upkeep,?\s*(.+)$/i },
  { event: "draw-step", subject: "you", pattern: /^at\s+the\s+beginning\s+of\s+your\s+draw\s+step,?\s*(.+)$/i },
  { event: "draw-step", subject: "each-player", pattern: /^at\s+the\s+beginning\s+of\s+each\s+player[’']s\s+draw\s+step,?\s*(.+)$/i },
  { event: "end-step", subject: "you", pattern: /^at\s+the\s+beginning\s+of\s+your\s+end\s+step,?\s*(.+)$/i },
  { event: "end-step", subject: "each-player", pattern: /^at\s+the\s+beginning\s+of\s+each\s+end\s+step,?\s*(.+)$/i },
  { event: "end-step", subject: "opponent", pattern: /^at\s+the\s+beginning\s+of\s+each\s+opponent[’']s\s+end\s+step,?\s*(.+)$/i }
];

function matchTriggerLine(line: string): { event: TriggerEvent; subject: TriggerSubject; effectText: string; spellType?: "creature" | "instant-or-sorcery"; spellColor?: string; spellSubtype?: string; nontoken?: boolean } | null {
  // Landfall is a keyword ability word; its rules-bearing trigger follows the
  // dash and uses the same enters-battlefield event (CR 603.1, 603.2).
  const normalized = line.replace(/^landfall\s+[—–-]\s*/i, "").replace(/^morbid\s+[—–-]\s*/i, "");
  for (const template of TRIGGER_TEMPLATES) {
    const match = template.pattern.exec(normalized);
    if (match) return { event: template.event, subject: template.subject, effectText: match[1]!.trim(), ...(template.spellType ? { spellType: template.spellType } : {}), ...(template.spellColor ? { spellColor: template.spellColor } : {}), ...(template.spellSubtype ? { spellSubtype: template.spellSubtype } : {}), ...(template.nontoken ? { nontoken: true } : {}) };
  }
  return null;
}

/** "Elves" -> "Elf", "Dwarves" -> "Dwarf", "Allies" -> "Ally", else drop a trailing "s". */
function singularSubtype(word: string): string {
  if (/ves$/i.test(word)) return word.replace(/ves$/i, "f");
  if (/ies$/i.test(word)) return word.replace(/ies$/i, "y");
  return word.replace(/s$/i, "");
}

/** Matches one sentence against the closed effect templates. */
function recognizeSentence(sentence: string): { effect: SpellEffect; target: TargetKind } | null {
  const text = sentence.trim().replace(/\s+/g, " ").replace(/\.$/, "");
  let match: RegExpExecArray | null;

  // "Add {C}{C}{C}" inside a triggered ability (Cathodion). Mana abilities on a
  // permanent have their own path; this is only for trigger/spell resolution.
  if ((match = /^Add ((?:\{[WUBRGC]\})+)$/i.exec(text))) {
    const pool: Record<string, number> = {};
    for (const sym of match[1]!.match(/\{([WUBRGC])\}/gi) ?? []) {
      const t = sym.replace(/[{}]/g, "").toUpperCase();
      pool[t] = (pool[t] ?? 0) + 1;
    }
    return { effect: { kind: "add-mana", pool }, target: "none" };
  }

  if ((match = /^Draw a card and lose (\w+) life$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return {
      effect: { kind: "compound", effects: [{ kind: "draw", amount: 1 }, { kind: "lose-life", amount }] },
      target: "none"
    };
  }
  if (/^Draw a card, then put a (\+1\/\+1|-1\/-1) counter on ~$/i.exec(text)) {
    const c = /^Draw a card, then put a (\+1\/\+1|-1\/-1) counter on ~$/i.exec(text)!;
    return { effect: { kind: "compound", effects: [{ kind: "draw", amount: 1 }, { kind: "add-counter-source", counter: c[1]!, amount: 1 }] }, target: "none" };
  }
  if (/^You draw a card and target opponent gains (\w+) life$/i.exec(text)) {
    const c = /^You draw a card and target opponent gains (\w+) life$/i.exec(text)!;
    const life = toNumber(c[1]!);
    if (life !== null) return { effect: { kind: "compound", effects: [{ kind: "draw", amount: 1 }, { kind: "gain-life-target-player", amount: life }] }, target: "player" };
  }
  if ((match = /^You draw a card and you lose (\w+) life$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return {
      effect: { kind: "compound", effects: [{ kind: "draw", amount: 1 }, { kind: "lose-life", amount }] },
      target: "none"
    };
  }
  if ((match = /^You draw (\w+) cards? and you lose (\w+) life$/i.exec(text))) {
    const draw = toNumber(match[1]);
    const life = toNumber(match[2]);
    if (draw !== null && life !== null) return {
      effect: { kind: "compound", effects: [{ kind: "draw", amount: draw }, { kind: "lose-life", amount: life }] },
      target: "none"
    };
    const dX = draw ?? (match[1]!.toUpperCase() === "X" ? "X" as const : null);
    const lX = life ?? (match[2]!.toUpperCase() === "X" ? "X" as const : null);
    if (dX !== null && lX !== null) return {
      effect: { kind: "compound", effects: [{ kind: "draw", amount: dX }, { kind: "lose-life", amount: lX }] },
      target: "none"
    };
  }
  if ((match = /^Draw (\w+) cards?$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount) return { effect: { kind: "draw", amount }, target: "none" };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "draw", amount: "X" }, target: "none" };
  }
  if ((match = /^You gain (\w+) life$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount) return { effect: { kind: "gain-life", amount }, target: "none" };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "gain-life", amount: "X" }, target: "none" };
  }
  if ((match = /^You gain (\w+) life for each (artifact|creature|enchantment|land) you control$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "gain-life-each-controlled-type", amount, type: match[2]![0]!.toUpperCase() + match[2]!.slice(1) as CardType }, target: "none" };
  }
  if ((match = /^You gain (\w+) life for each ([A-Za-z][A-Za-z'’-]*) (on the battlefield|you control)$/i.exec(text))
      && !/^(artifact|creature|enchantment|land|permanent)$/i.test(match[2]!)) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "gain-life-each-subtype", amount, subtype: match[2]! }, target: "none" };
  }
  if ((match = /^You gain (\w+) life for each permanent you control$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "gain-life-each-permanent", amount }, target: "none" };
  }
  if (/^You gain life equal to the power of target creature you control$/i.test(text)) {
    return { effect: { kind: "gain-life-equal-target-power" }, target: "creature-you-control" };
  }
  if ((match = /^Each opponent loses (\w+) life$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount) return { effect: { kind: "each-opponent-loses-life", amount }, target: "none" };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "each-opponent-loses-life", amount: "X" }, target: "none" };
  }
  if ((match = /^~ deals (\w+) damage to any target$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "damage-any-target", amount }, target: "any" };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "damage-any-target", amount: "X" }, target: "any" };
  }
  if ((match = /^(?:~|This spell) deals damage equal to the number of (creatures|artifacts|enchantments|lands) you control to any target$/i.exec(text))) {
    const type = match[1]![0]!.toUpperCase() + match[1]!.slice(1, -1) as CardType;
    return { effect: { kind: "damage-any-target-each-controlled-type", type }, target: "any" };
  }
  if ((match = /^Each player mills (\w+) cards?$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "mill-each-player", amount }, target: "none" };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "mill-each-player", amount: "X" }, target: "none" };
  }
  if ((match = /^Target player loses life equal to the number of (creatures|artifacts|enchantments) you control$/i.exec(text))) {
    const type = match[1]![0]!.toUpperCase() + match[1]!.slice(1, -1) as CardType;
    return { effect: { kind: "lose-life-target-player-each-controlled-type", type }, target: "player" };
  }
  if (/^(?:~|This spell) deals damage to you equal to the number of cards in your hand$/i.test(text)) {
    return { effect: { kind: "damage-controller-equal-hand" }, target: "none" };
  }
  const handMinus = /^(?:~|This creature) deals X damage to that player, where X is the number of cards in their hand minus (\d+)$/i.exec(text);
  if (handMinus) return { effect: { kind: "damage-active-player-hand-minus", offset: Number(handMinus[1]) }, target: "none" };
  if (/^(?:~|This creature) deals damage to that player equal to the number of cards in that player's hand$/i.test(text)) {
    return { effect: { kind: "damage-active-player-equal-hand" }, target: "none" };
  }
  if (/^Each player loses life equal to the number of cards in their hand$/i.test(text)) {
    return { effect: { kind: "lose-life-each-player-equal-hand" }, target: "none" };
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
  if ((match = /^Target player draws (\w+) cards?$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "draw-target-player", amount }, target: "player" };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "draw-target-player", amount: "X" }, target: "player" };
  }
  if ((match = /^(?:~|This spell) deals (\w+) damage to each player$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "damage-each-player", amount }, target: "none" };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "damage-each-player", amount: "X" }, target: "none" };
  }
  if ((match = /^(?:~|Molten Disaster) deals (\w+) damage to each creature without flying and each player$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "damage-nonflying-creatures-and-players", amount }, target: "none" };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "damage-nonflying-creatures-and-players", amount: "X" }, target: "none" };
  }
  if (/^That player draws an additional card$/i.test(text)) {
    return { effect: { kind: "draw-active-player" }, target: "none" };
  }
  if (/^Draw a card for each tapped creature target opponent controls$/i.test(text)) {
    return { effect: { kind: "draw-equal-tapped-creatures" }, target: "player" };
  }
  if ((match = /^Draw a card for each (creature|artifact|enchantment|land) you control$/i.exec(text))) {
    const type = match[1]![0]!.toUpperCase() + match[1]!.slice(1) as CardType;
    return { effect: { kind: "draw-equal-controlled-type", type }, target: "none" };
  }
  if ((match = /^Draw a card for each (white|blue|black|red|green) creature you control$/i.exec(text))) {
    const COLOR: Record<string, string> = { white: "W", blue: "U", black: "B", red: "R", green: "G" };
    return { effect: { kind: "draw-equal-controlled-color-creature", color: COLOR[match[1]!.toLowerCase()]! }, target: "none" };
  }
  if ((match = /^Each player draws (\w+) cards?$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "each-player-draw", amount }, target: "none" };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "each-player-draw", amount: "X" }, target: "none" };
  }
  if ((match = /^Each opponent draws (\w+) cards?$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "each-opponent-draw", amount }, target: "none" };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "each-opponent-draw", amount: "X" }, target: "none" };
  }
  if ((match = /^You lose (\w+) life$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount) return { effect: { kind: "lose-life", amount }, target: "none" };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "lose-life", amount: "X" }, target: "none" };
  }
  if ((match = /^Target player gains (\w+) life$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount) return { effect: { kind: "gain-life-target-player", amount }, target: "player" };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "gain-life-target-player", amount: "X" }, target: "player" };
  }
  if ((match = /^Each player gains (\w+) life$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount) return { effect: { kind: "each-player-gains-life", amount }, target: "none" };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "each-player-gains-life", amount: "X" }, target: "none" };
  }
  if ((match = /^Target player loses (\w+) life$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount) return { effect: { kind: "lose-life-target-player", amount }, target: "player" };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "lose-life-target-player", amount: "X" }, target: "player" };
  }
  if ((match = /^Each player loses (\w+) life$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount) return { effect: { kind: "each-player-loses-life", amount }, target: "none" };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "each-player-loses-life", amount: "X" }, target: "none" };
  }
  if ((match = /^Target player discards (a|an|one|two|three|four|five|\d+) cards?$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "discard-target-player", amount }, target: "player" };
  }
  if ((match = /^Target player discards X cards?$/i.exec(text))) return { effect: { kind: "discard-target-player", amount: "X" }, target: "player" };
  if ((match = /^Target player draws (\w+) cards? and loses (\w+) life$/i.exec(text))) {
    const draw = toNumber(match[1]);
    const life = toNumber(match[2]);
    if (draw !== null && life !== null) return {
      effect: { kind: "compound", effects: [{ kind: "draw-target-player", amount: draw }, { kind: "lose-life-target-player", amount: life }] },
      target: "player"
    };
  }
  if ((match = /^Draw (\w+) cards?, then discard (\w+) cards?$/i.exec(text))) {
    const draw = toNumber(match[1]);
    const discard = toNumber(match[2]);
    if (draw !== null && draw > 0 && discard !== null && discard > 0) return { effect: { kind: "draw-then-discard", draw, discard }, target: "none" };
  }
  if ((match = /^Draw (\w+) cards?\.\s*If you do, discard (\w+) cards?$/i.exec(text))) {
    const draw = toNumber(match[1]);
    const discard = toNumber(match[2]);
    if (draw !== null && draw > 0 && discard !== null && discard > 0) return { effect: { kind: "draw-then-discard", draw, discard }, target: "none" };
  }
  if (/^Exile ~$/i.test(text)) return { effect: { kind: "exile-self" }, target: "none" };
  if (/^Return (?:it|~) to its owner's hand$/i.test(text)) return { effect: { kind: "return-source-to-hand" }, target: "none" };
  if (/^Shuffle ~ into its owner's library$/i.test(text)) return { effect: { kind: "shuffle-self-into-library" }, target: "none" };
  if ((match = /^Target player mills (\w+) cards?$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "mill-target-player", amount }, target: "player" };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "mill-target-player", amount: "X" }, target: "player" };
  }
  if ((match = /^Each opponent mills (\w+) cards?$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "mill-each-opponent", amount }, target: "none" };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "mill-each-opponent", amount: "X" }, target: "none" };
  }
  if ((match = /^~ deals (\w+) damage to each (other )?creature$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "damage-all-creatures", amount, excludeSource: Boolean(match[2]) }, target: "none" };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "damage-all-creatures", amount: "X", excludeSource: Boolean(match[2]) }, target: "none" };
  }
  if ((match = /^~ deals (\w+) damage to each (nonartifact creature|creature without flying)$/i.exec(text))) {
    const amount = toNumber(match[1]) ?? (match[1]!.toUpperCase() === "X" ? "X" : null);
    const filter = /nonartifact/i.test(match[2]!) ? "nonartifact" as const : "without-flying" as const;
    if (amount !== null) return { effect: { kind: "damage-all-creatures", amount, excludeSource: false, filter }, target: "none" };
  }
  if ((match = /^~ deals (\w+) damage to each creature without flying and each planeswalker$/i.exec(text))) {
    const amount = toNumber(match[1]) ?? (match[1]!.toUpperCase() === "X" ? "X" : null);
    if (amount !== null) return { effect: { kind: "damage-all-creatures", amount, excludeSource: false, filter: "without-flying", alsoPlaneswalkers: true }, target: "none" };
  }
  if ((match = /^~ deals (\w+) damage to each creature with flying$/i.exec(text))) {
    const amount = toNumber(match[1]) ?? (match[1]!.toUpperCase() === "X" ? "X" : null);
    if (amount !== null) return { effect: { kind: "damage-all-creatures", amount, excludeSource: false, filter: "with-flying" }, target: "none" };
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
  // "Creatures you control get +N/+N and gain <keywords> until end of turn" (Overrun).
  if ((match = /^Creatures you control get ([+-]\d+)\/([+-]\d+) and gain ((?:flying|reach|first strike|double strike|deathtouch|trample|vigilance|lifelink|menace|defender|haste|indestructible|hexproof|shroud|fear)(?:(?:,| and )(?:flying|reach|first strike|double strike|deathtouch|trample|vigilance|lifelink|menace|defender|haste|indestructible|hexproof|shroud|fear))*) until end of turn$/i.exec(text))) {
    return {
      effect: { kind: "compound", effects: [
        { kind: "modify-creatures-you-control", power: Number(match[1]), toughness: Number(match[2]) },
        ...match[3]!.split(/\s*(?:,|\band\b)\s*/i).map((word) => word.trim().toLowerCase()).filter((word) => (ENFORCED_KEYWORDS as readonly string[]).includes(word))
          .map((keyword) => ({ kind: "grant-permanents-you-control-keyword" as const, keyword: keyword as EnforcedKeyword }))
      ] },
      target: "none"
    };
  }
  // "Until end of turn, creatures you control gain trample and get +X/+X, where X is the greatest power among creatures you control" (Overwhelming Stampede).
  if (/^Until end of turn, creatures you control gain trample and get \+X\/\+X, where X is the greatest power among creatures you control$/i.test(text)) {
    return { effect: { kind: "overwhelming-stampede" }, target: "none" };
  }
  if ((match = /^~ gets ([+-]\d+)\/([+-]\d+) until end of turn$/i.exec(text))) {
    // Firebreathing-style self pumps: the source is the only affected creature
    // and the modifier expires during cleanup (CR 613.4c, 514.2).
    return { effect: { kind: "modify-source-creature", power: Number(match[1]), toughness: Number(match[2]) }, target: "none" };
  }
  if (/^Target creature gets -0\/-X until end of turn and ~ gets \+X\/\+0 until end of turn$/i.test(text)) {
    return { effect: { kind: "drain-target-toughness-pump-source-power" }, target: "creature" };
  }
  if (/^exile all attacking creatures$/i.test(text)) {
    return { effect: { kind: "exile-all-attacking-creatures" }, target: "none" };
  }
  // The "Choose an opponent" offering cycle (Commander 2014): each line stands
  // on its own, picking a (possibly different) opponent each time.
  if ((match = /^Choose an opponent\.\s*You and that player each draw (\w+) cards?$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "you-and-opponent-each", effect: { kind: "draw", amount } }, target: "none" };
  }
  if (/^Choose an opponent\.\s*Untap all nonland permanents you control and all nonland permanents that player controls$/i.test(text)) {
    return { effect: { kind: "untap-all-nonland-both" }, target: "none" };
  }
  if (/^Choose an opponent\.\s*You and that player each create an X\/X green Treefolk creature token$/i.test(text)) {
    return {
      effect: { kind: "you-and-opponent-each", effect: { kind: "create-token", amount: "X", statsFromAmount: true, token: { name: "Treefolk", typeLine: "Creature — Treefolk", power: null, toughness: null, colors: ["G"], keywords: [], tapped: false } } },
      target: "none"
    };
  }
  if (/^Choose an opponent\.\s*You and that player each create X 1\/1 green Elf Warrior creature tokens$/i.test(text)) {
    return {
      effect: { kind: "you-and-opponent-each", effect: { kind: "create-token", amount: "X", token: { name: "Elf Warrior", typeLine: "Creature — Elf Warrior", power: 1, toughness: 1, colors: ["G"], keywords: [], tapped: false } } },
      target: "none"
    };
  }
  if ((match = /^Choose an opponent\.\s*You and that player each (create (?!an? X\/X|X\b).+)$/i.exec(text))) {
    const inner = parseCreateToken(match[1]!.replace(/^create/i, "Create"));
    if (inner?.kind === "create-token") return { effect: { kind: "you-and-opponent-each", effect: inner }, target: "none" };
  }
  if ((match = /^Choose an opponent\.\s*You gain (\d+) life for each creature you control and that player gains \d+ life for each creature they control$/i.exec(text))) {
    return { effect: { kind: "you-and-opponent-each", effect: { kind: "gain-life-each-creature-you-control", amount: Number(match[1]) } }, target: "none" };
  }
  if ((match = /^Choose an opponent\.\s*You and that player each sacrifice a creature\.\s*Each player who sacrificed a creature this way draws (\w+) cards?$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "you-and-opponent-each", effect: { kind: "sacrifice-own-creature-then-draw", amount } }, target: "none" };
  }
  if (/^Choose an opponent\.\s*Return a creature card from your graveyard to the battlefield, then that player returns a creature card from their graveyard to the battlefield$/i.test(text)) {
    return { effect: { kind: "you-and-opponent-each", effect: { kind: "reanimate-own-best-creature-from-graveyard" } }, target: "none" };
  }
  if (/^Return a creature card at random from your graveyard to your hand$/i.test(text)) {
    return { effect: { kind: "return-random-creature-from-graveyard-to-hand" }, target: "none" };
  }
  if ((match = /^Attacking creatures get ([+-]\d+)\/([+-]\d+) until end of turn$/i.exec(text))) {
    return { effect: { kind: "modify-all-attacking-creatures", power: Number(match[1]), toughness: Number(match[2]) }, target: "none" };
  }
  if (/^Target player sacrifices an attacking creature of their choice$/i.test(text)) {
    return { effect: { kind: "target-player-sacrifice-attacking-creature" }, target: "player" };
  }
  if ((match = /^~ deals (\w+) damage to that player$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "damage-triggering-player", amount }, target: "none" };
  }
  if ((match = /^(?:that player|they) loses? (\w+) life$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "triggering-player-loses-life", amount }, target: "none" };
  }
  if (/^tap all nonblue creatures\.\s*Those creatures don't untap during their controllers' next untap steps?$/i.test(text)) {
    return { effect: { kind: "tap-all-nonblue-skip-untap" }, target: "none" };
  }
  if (/^shuffle it into its owner'?s library$/i.test(text)) {
    return { effect: { kind: "shuffle-source-into-library" }, target: "none" };
  }
  if ((match = /^each opponent loses X life, where X is your devotion to (white|blue|black|red|green)\.?\s*You gain life equal to the life lost this way\.?$/i.exec(text))) {
    const COLOR: Record<string, string> = { white: "W", blue: "U", black: "B", red: "R", green: "G" };
    return { effect: { kind: "devotion-drain", color: COLOR[match[1]!.toLowerCase()]! }, target: "none" };
  }
  if ((match = /^sacrifice a creature other than ~, then each opponent loses life equal to the sacrificed creature's power\.\s*if you can't sacrifice a creature, tap ~ and you lose (\d+) life$/i.exec(text))) {
    return { effect: { kind: "xathrid-upkeep", fallbackLife: Number(match[1]) }, target: "none" };
  }
  if (/^each opponent sacrifices a creature of their choice$/i.test(text)) {
    return { effect: { kind: "each-opponent-sacrifice-creature" }, target: "none" };
  }
  if (/^Create a token that's a copy of target creature you control$/i.test(text)) {
    return { effect: { kind: "create-copy-token", amount: 1 }, target: "creature-you-control" };
  }
  if (/^Create a token that's a copy of target creature$/i.test(text)) {
    return { effect: { kind: "create-copy-token", amount: 1 }, target: "creature" };
  }
  if ((match = /^create (two|three|four|five|\d+) (?:tokens that are copies of that creature|of those tokens)(?: instead)?\.?$/i.exec(text.trim()))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "create-copy-token", amount }, target: "none" };
  }
  if ((match = /^You may play (an additional land|up to (\w+) additional lands?) this turn$/i.exec(text))) {
    const amount = match[2] ? (toNumber(match[2]) ?? 1) : 1;
    return { effect: { kind: "play-additional-land", amount }, target: "none" };
  }
  if (/^sacrifice another creature\.\s*You gain X life and draw X cards, where X is that creature's power$/i.test(text)) {
    return { effect: { kind: "disciple-of-bolas" }, target: "none" };
  }
  if (/^Each other player discards a card\.\s*You draw a card for each card discarded this way$/i.test(text)) {
    return { effect: { kind: "syphon-mind" }, target: "none" };
  }
  if ((match = /^~ deals X damage to target creature and you gain X life, where X is the number of ([A-Za-z]+)s you control$/i.exec(text))) {
    return { effect: { kind: "tendrils-of-corruption", subtype: match[1]! }, target: "creature" };
  }
  if (/^Put target attacking creature on the bottom of its owner's library\. Its controller gains life equal to its toughness$/i.test(text)) {
    return { effect: { kind: "bottom-attacker-controller-gains-toughness" }, target: "attacking-creature" };
  }
  if (/^Regenerate target creature$/i.test(text)) {
    return { effect: { kind: "regenerate-target-creature" }, target: "creature" };
  }
  if (/^Regenerate (?:~|[A-Za-z][A-Za-z'’ -]*)$/i.test(text)) {
    return { effect: { kind: "regenerate-source" }, target: "none" };
  }
  const temporaryKeyword = /^Target creature gains (flying|reach|first strike|double strike|deathtouch|trample|vigilance|lifelink|menace|defender|haste|indestructible|hexproof|shroud|fear) until end of turn$/i.exec(text);
  if (temporaryKeyword) return { effect: { kind: "grant-target-creature-keyword", keyword: temporaryKeyword[1]!.toLowerCase() as EnforcedKeyword }, target: "creature" };
  const ownKeyword = /^Target creature you control gains (flying|reach|first strike|double strike|deathtouch|trample|vigilance|lifelink|menace|defender|haste|indestructible|hexproof|shroud|fear) until end of turn$/i.exec(text);
  if (ownKeyword) return { effect: { kind: "grant-target-creature-keyword", keyword: ownKeyword[1]!.toLowerCase() as EnforcedKeyword }, target: "creature-you-control" };
  const globalKeyword = /^Permanents you control gain (flying|reach|first strike|double strike|deathtouch|trample|vigilance|lifelink|menace|defender|haste|indestructible|hexproof|shroud|fear) until end of turn$/i.exec(text);
  if (globalKeyword) return { effect: { kind: "grant-permanents-you-control-keyword", keyword: globalKeyword[1]!.toLowerCase() as EnforcedKeyword }, target: "none" };
  const allKeyword = /^All creatures gain (flying|reach|first strike|double strike|deathtouch|trample|vigilance|lifelink|menace|defender|haste|indestructible|hexproof|shroud|fear) until end of turn$/i.exec(text);
  if (allKeyword) return { effect: { kind: "grant-all-creatures-keyword", keyword: allKeyword[1]!.toLowerCase() as EnforcedKeyword }, target: "none" };
  const combined = /^Target creature gets ([+-]\d+)\/([+-]\d+) and gains (flying|reach|first strike|double strike|deathtouch|trample|vigilance|lifelink|menace|defender|haste|indestructible|hexproof|shroud|fear) until end of turn$/i.exec(text);
  if (combined) return {
    effect: { kind: "modify-and-grant-target-creature", power: Number(combined[1]), toughness: Number(combined[2]), keyword: combined[3]!.toLowerCase() as EnforcedKeyword },
    target: "creature"
  };
  if ((match = /^Put (a|an|one|two|three|four|five|\d+) (\+1\/\+1|-1\/-1) counter(?:s)? on target creature$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "add-counter-target-creature", counter: match[2]!, amount }, target: "creature" };
  }
  if ((match = /^Put a (\+1\/\+1|-1\/-1) counter on target creature for each ([A-Za-z][A-Za-z'’-]*) (you control|on the battlefield)$/i.exec(text))) {
    return { effect: { kind: "add-counter-target-per-subtype", counter: match[1]!, subtype: singularSubtype(match[2]!), ...(/battlefield/i.test(match[3]!) ? { anywhere: true } : {}) }, target: "creature" };
  }
  if ((match = /^Target creature gets \+X\/\+X until end of turn, where X is the number of ([A-Za-z][A-Za-z'’-]*) (you control|on the battlefield)$/i.exec(text))) {
    return { effect: { kind: "modify-target-creature-per-subtype", subtype: singularSubtype(match[1]!), ...(/battlefield/i.test(match[2]!) ? { anywhere: true } : {}) }, target: "creature" };
  }
  if ((match = /^Put (a|an|one|two|three|four|five|\d+) (\+1\/\+1|-1\/-1) counter(?:s)? on ~$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "add-counter-source", counter: match[2]!, amount }, target: "none" };
  }
  if ((match = /^Put (a|an|one|two|three|four|five|\d+) (\+1\/\+1|-1\/-1) counter(?:s)? on each ([A-Za-z][A-Za-z'’/-]*) creature you control$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "add-counter-creatures-subtype", counter: match[2]!, amount, subtype: match[3]! }, target: "none" };
  }
  if ((match = /^Put (a|an|one|two|three|four|five|\d+) (\+1\/\+1|-1\/-1) counter(?:s)? on each creature you control$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "add-counter-creatures-you-control", counter: match[2]!, amount }, target: "none" };
  }
  if ((match = /^Put (X|a|an|one|two|three|four|five|\d+) (\+1\/\+1|-1\/-1) counters? on each creature$/i.exec(text))) {
    const amount = /^X$/i.test(match[1]!) ? "X" as const : toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "add-counter-all-creatures", counter: match[2]!, amount }, target: "none" };
  }
  if (/^Remove all counters from target permanent$/i.test(text)) return { effect: { kind: "remove-all-counters-target" }, target: "permanent" };
  if (/^Remove all counters from all permanents and exile all tokens$/i.test(text)) return { effect: { kind: "remove-all-counters-all-and-exile-tokens" }, target: "none" };
  if ((match = /^~ deals (\w+) damage to target creature$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "damage-any-target", amount }, target: "creature" };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "damage-any-target", amount: "X" }, target: "creature" };
  }
  if (/^~ deals damage equal to the sacrificed artifact's mana value to any target$/i.test(text)) {
    return { effect: { kind: "damage-any-target", amount: "X" }, target: "any" };
  }
  if ((match = /^~ deals (\w+) damage to target attacking or blocking creature$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "damage-any-target", amount }, target: "attacking-or-blocking-creature" };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "damage-any-target", amount: "X" }, target: "attacking-or-blocking-creature" };
  }
  if ((match = /^Look at the top (\w+) cards of your library\. Put one of them into your hand and the other(?:s)? on the bottom of your library in any order$/i.exec(text))
      || (match = /^Look at the top (\w+) cards of your library\. Put one of them into your hand and the rest on the bottom of your library in any order$/i.exec(text))
      || (match = /^Look at the top (\w+) cards of your library\. Put one of them into your hand and the other on the bottom of your library$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null && amount > 1) return { effect: { kind: "look-put-one-in-hand", amount }, target: "none" };
  }
  if ((match = /^Scry (\w+)$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null && amount > 0) return { effect: { kind: "scry", amount }, target: "none" };
  }
  if ((match = /^Scry (\w+), then draw (\w+) cards?$/i.exec(text))) {
    const amount = toNumber(match[1]);
    const draw = toNumber(match[2]);
    if (amount !== null && amount > 0 && draw !== null && draw > 0) return { effect: { kind: "scry", amount, thenDraw: draw }, target: "none" };
  }
  if (/^Destroy target creature\. Its controller loses life equal to its power plus its toughness$/i.test(`${text}.`)) {
    return { effect: { kind: "destroy-target-creature-then-life-loss" }, target: "creature" };
  }
  if (/^Destroy target creature$/i.test(text)) return { effect: { kind: "destroy-target-creature" }, target: "creature" };
  if ((match = /^Each player discards their hand, then draws (\w+) cards?$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "each-player-discard-and-draw", amount }, target: "none" };
  }
  if (/^Target player discards their hand$/i.test(text)) return { effect: { kind: "discard-target-player-hand" }, target: "player" };
  if ((match = /^Put (a|an|one|two|three|four|five|\d+) ([A-Za-z][A-Za-z -]*) counter(?:s)? on ~$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "add-counter-source", counter: match[2]!.trim().toLowerCase(), amount }, target: "none" };
  }
  if (/^All creatures get -X\/-X until end of turn$/i.test(text)) {
    return { effect: { kind: "modify-all-creatures-minus-X" }, target: "none" };
  }
  if ((match = /^All creatures get (-\d+)\/(-\d+) until end of turn for each ([A-Za-z]+) you control$/i.exec(text))) {
    return { effect: { kind: "modify-all-creatures-per-land", power: Number(match[1]), toughness: Number(match[2]), subtype: singularSubtype(match[3]!) }, target: "none" };
  }
  if (/^Destroy target creature$/i.test(text)) return { effect: { kind: "destroy-target-creature" }, target: "creature" };
  if (/^Destroy target artifact or enchantment$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "artifact-or-enchantment" };
  if (/^Destroy target artifact$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "artifact" };
  if (/^Destroy target enchantment$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "enchantment" };
  if (/^Destroy target land$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "land" };
  if (/^Destroy target land\.\s*Its controller may search their library for a basic land card, put it onto the battlefield, then shuffle$/i.test(text)) {
    return { effect: { kind: "destroy-target-permanent" }, target: "land" };
  }
  if (/^Destroy target nonbasic land$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "nonbasic-land" };
  if (/^Destroy target artifact, creature, or planeswalker$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "artifact-creature-or-planeswalker" };
  if (/^Destroy target artifact, enchantment, or land$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "artifact-enchantment-or-land" };
  if (/^Destroy target permanent$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "permanent" };
  if (/^Destroy target nonland permanent$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "nonland" };
  if (/^Destroy target nonartifact creature$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "nonartifact-creature" };
  if (/^Destroy target nonblack creature$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "nonblack-creature" };
  if (/^Destroy target nonartifact,? nonblack creature$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "nonartifact-nonblack-creature" };
  if (/^Destroy target non-Demon creature$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "non-demon-creature" };
  if (/^Destroy all creatures with flying$/i.test(text)) return { effect: { kind: "destroy-all-creatures", flyingOnly: true }, target: "none" };
  if (/^Destroy all creatures with power greater than target creature'?s power$/i.test(text)) return { effect: { kind: "destroy-creatures-power-greater-than-target" }, target: "creature" };
  if (/^Destroy target creature with flying$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "creature-with-flying" };
  if (/^Destroy target creature with defender$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "creature-with-defender" };
  if (/^Destroy target creature with deathtouch$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "creature-with-deathtouch" };
  if (/^Destroy target creature with lifelink$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "creature-with-lifelink" };
  if (/^Destroy target creature with menace$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "creature-with-menace" };
  if (/^Destroy target creature with haste$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "creature-with-haste" };
  if (/^Destroy target creature with first strike$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "creature-with-first-strike" };
  if (/^Destroy target creature with double strike$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "creature-with-double-strike" };
  if (/^Destroy target creature with trample$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "creature-with-trample" };
  if (/^Destroy target creature with vigilance$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "creature-with-vigilance" };
  if (/^Destroy target creature with indestructible$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "creature-with-indestructible" };
  if (/^Destroy target creature with hexproof$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "creature-with-hexproof" };
  if (/^Destroy target creature with shroud$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "creature-with-shroud" };
  if (/^Destroy target creature with power 5 or greater$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "creature-power-at-least-5" };
  if (/^Destroy target creature with power 4 or less$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "creature-power-at-most-4" };
  if (/^Destroy target creature with toughness 4 or greater$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "creature-toughness-at-least-4" };
  if (/^Destroy target creature with toughness 4 or less$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "creature-toughness-at-most-4" };
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
  if (/^Return target nonland permanent to its owner's hand$/i.test(text)) return { effect: { kind: "return-target-permanent" }, target: "nonland" };
  if ((match = /^The owner of target nonland permanent shuffles it into their library, then draws (\w+) cards?$/i.exec(text))) {
    const draw = toNumber(match[1]);
    if (draw !== null) return { effect: { kind: "oblation", draw }, target: "nonland" };
  }
  if ((match = /^Return (X|two|three|four|five|six|seven|\d+) target nonland permanents to their owners' hands$/i.exec(text))) {
    const count = /^X$/i.test(match[1]!) ? "X" as const : toNumber(match[1]);
    if (count !== null) return { effect: { kind: "return-n-nonland-permanents", count }, target: "none" };
  }
  if ((match = /^(?:you may )?return up to (X|two|three|four|five|\d+) target creatures to their owners' hands$/i.exec(text))) {
    const count = /^X$/i.test(match[1]!) ? "X" as const : toNumber(match[1]);
    if (count !== null) return { effect: { kind: "return-n-creatures", count }, target: "none" };
  }
  if (/^Return a land you control to its owner's hand$/i.test(text)) return { effect: { kind: "return-target-land" }, target: "land-you-control" };
  if (/^Return a creature you control to its owner's hand$/i.test(text)) return { effect: { kind: "return-target-creature" }, target: "creature-you-control" };
  if (/^Return (?:another )?target creature card from your graveyard to your hand$/i.test(text)) return { effect: { kind: "return-target-card-from-graveyard" }, target: "creature-card-in-your-graveyard" };
  if (/^Return (?:another )?target creature card from your graveyard to the battlefield$/i.test(text)) return { effect: { kind: "return-target-creature-card-from-graveyard-to-battlefield" }, target: "creature-card-in-your-graveyard" };
  if (/^Return target permanent card with mana value 3 or less from your graveyard to the battlefield$/i.test(text)) return { effect: { kind: "return-target-creature-card-from-graveyard-to-battlefield" }, target: "permanent-card-in-your-graveyard-mv-3-or-less" };
  if (/^Return (?:another )?target artifact card from your graveyard to your hand$/i.test(text)) return { effect: { kind: "return-target-card-from-graveyard" }, target: "artifact-card-in-your-graveyard" };
  if (/^Return (?:another )?target enchantment card from your graveyard to your hand$/i.test(text)) return { effect: { kind: "return-target-card-from-graveyard" }, target: "enchantment-card-in-your-graveyard" };
  if (/^Return target instant or sorcery card from your graveyard to your hand$/i.test(text)) return { effect: { kind: "return-target-card-from-graveyard" }, target: "instant-or-sorcery-card-in-your-graveyard" };
  if ((match = /^Draw a card for each creature card in your graveyard$/i.exec(text))) return { effect: { kind: "draw-equal-graveyard-creatures" }, target: "none" };
  if (/^Draw cards equal to the greatest mana value among permanents you control$/i.test(text)) return { effect: { kind: "draw-equal-greatest-mana-value-you-control" }, target: "none" };
  if (/^Put target land card from a graveyard onto the battlefield under your control$/i.test(text)) return { effect: { kind: "return-target-land-card-from-graveyard-to-battlefield" }, target: "land-card-in-a-graveyard" };
  if (/^Return (?:another )?target artifact card from your graveyard to the battlefield$/i.test(text)) return { effect: { kind: "return-target-artifact-card-from-graveyard-to-battlefield" }, target: "artifact-card-in-your-graveyard" };
  if (/^Return (?:another )?target card from your graveyard to your hand$/i.test(text)) return { effect: { kind: "return-target-card-from-graveyard" }, target: "card-in-your-graveyard" };
  if (/^Return all cards from your graveyard to your hand$/i.test(text)) return { effect: { kind: "return-all-your-graveyard-to-hand" }, target: "none" };
  if (/^Exile target card from your graveyard$/i.test(text)) return { effect: { kind: "exile-target-card-from-graveyard" }, target: "card-in-your-graveyard" };
  if (/^Put target card from your graveyard on top of your library$/i.test(text)) return { effect: { kind: "return-target-card-to-library-top" }, target: "card-in-your-graveyard" };
  if (/^Untap equipped creature$/i.test(text)) return { effect: { kind: "untap-equipped-creature" }, target: "none" };
  if (/^Untap all other creatures you control$/i.test(text)) return { effect: { kind: "untap-all-other-creatures-you-control" }, target: "none" };
  if (/^Tap target creature$/i.test(text)) return { effect: { kind: "tap-target-permanent" }, target: "creature" };
  if (/^Target creature can'?t block this turn$/i.test(text)) return { effect: { kind: "target-cant-block" }, target: "creature" };
  if ((match = /^sacrifice it unless you return an untapped (Plains|Island|Swamp|Mountain|Forest) you control to its owner'?s hand$/i.exec(text))) {
    return { effect: { kind: "karoo-bounce", subtype: match[1]![0]!.toUpperCase() + match[1]!.slice(1).toLowerCase() }, target: "none" };
  }
  if (/^Untap target permanent$/i.test(text)) return { effect: { kind: "untap-target-permanent" }, target: "permanent" };
  if (/^Destroy all creatures$/i.test(text)) return { effect: { kind: "destroy-all-creatures" }, target: "none" };
  if (/^Destroy all tapped creatures$/i.test(text)) return { effect: { kind: "destroy-all-creatures", tappedOnly: true }, target: "none" };
  if (/^Destroy all artifacts, creatures, and enchantments$/i.test(text)) {
    return { effect: { kind: "destroy-all-artifacts-creatures-enchantments" }, target: "none" };
  }
  if (/^Counter target spell$/i.test(text)) return { effect: { kind: "counter-target-spell" }, target: "spell" };
  if (/^Counter target creature spell$/i.test(text)) return { effect: { kind: "counter-target-spell" }, target: "creature-spell" };
  if (/^Counter target noncreature spell$/i.test(text)) return { effect: { kind: "counter-target-spell" }, target: "noncreature-spell" };
  const token = parseLandScaledToken(text) ?? parseCreatureScaledToken(text) ?? parseEquipmentScaledToken(text) ?? parseDeathScaledToken(text) ?? parseSacrificePowerToken(text) ?? parseOpponentHandScaledToken(text) ?? parseCreateToken(text);
  if (token) return { effect: token, target: "none" };
  const genericSearch = parseLibrarySearch(text);
  if (genericSearch) return { effect: genericSearch, target: "none" };
  if (/^Search your library for an artifact or enchantment card, reveal it, then shuffle\. Put that card on top of your library$/i.test(text)) {
    return { effect: { kind: "search-library", types: ["Artifact", "Enchantment"], destination: "top", reveal: true }, target: "none" };
  }
  // Purely cosmetic trailing clauses do not change the outcome the engine produces.
  if (/^(?:It|They|That creature) can't be regenerated$/i.test(text)) return null;
  return null;
}

function isIgnorableSentence(sentence: string): boolean {
  const s = sentence.trim();
  if (/^(?:It|They|That creature) can't be regenerated\.?$/i.test(s)) return true;
  // No-maximum-hand-size from a one-shot spell: the engine's deterministic
  // cleanup discard only bites at 8+ cards and the sim rarely floods that far,
  // so treating this as a no-op keeps the card playable without new state.
  if (/^you have no maximum hand size for the rest of the game\.?$/i.test(s)) return true;
  return false;
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
  if (/^Destroy target creature\. Its controller loses life equal to its power plus its toughness\.$/i.test(joined)) {
    return {
      effects: [{ kind: "destroy-target-creature-then-life-loss" }],
      triggers: [], activatedAbilities: [], modalChoices: [], targetKind: "creature", unimplementedText: [], covered: true
    };
  }
  // "Destroy target creature. (It can't be regenerated.) Its controller creates <token>." (Pongify, Afterlife).
  // "Target creature gets -1/-1 ... Morbid — that creature gets -13/-13 ... instead if a creature died this turn." (Tragic Slip).
  const morbidPump = /^Target creature gets (-\d+)\/(-\d+) until end of turn\.\s*Morbid\s*[—–-]\s*That creature gets (-\d+)\/(-\d+) until end of turn instead if a creature died this turn\.$/i.exec(joined);
  if (morbidPump) {
    return {
      effects: [{ kind: "modify-target-creature-morbid", power: Number(morbidPump[1]), toughness: Number(morbidPump[2]), morbidPower: Number(morbidPump[3]), morbidToughness: Number(morbidPump[4]) }],
      triggers: [], activatedAbilities: [], modalChoices: [], targetKind: "creature", unimplementedText: [], covered: true
    };
  }
  // Necromantic Selection: destroy all creatures, reanimate one of them under your control, then exile self.
  if (/^Destroy all creatures, then return a creature card put into a graveyard this way to the battlefield under your control\.\s*It'?s a black Zombie in addition to its other colors and types\.\s*Exile ~\.$/i.test(joined)) {
    return {
      effects: [{ kind: "destroy-all-then-reanimate-one" }, { kind: "exile-self" }],
      triggers: [], activatedAbilities: [], modalChoices: [], targetKind: "none", unimplementedText: [], covered: true
    };
  }
  // Martial Coup: "Create X 1/1 white Soldier creature tokens. If X is 5 or more, destroy all other creatures."
  const martialCoup = /^Create X (.+? tokens)\.\s*If X is (\d+) or more, destroy all other creatures\.$/i.exec(joined);
  if (martialCoup) {
    const tokenEffect = parseCreateToken(`Create X ${martialCoup[1]!}`);
    if (tokenEffect?.kind === "create-token") {
      return {
        effects: [{ kind: "compound", effects: [tokenEffect, { kind: "destroy-all-creatures", xThreshold: Number(martialCoup[2]), excludeSource: true }] }],
        triggers: [], activatedAbilities: [], modalChoices: [], targetKind: "none", unimplementedText: [], covered: true
      };
    }
  }
  // Compulsive Research: "Target player draws three cards. Then that player discards two cards unless they discard a land card."
  const compulsive = /^Target player draws (\w+) cards\.\s*Then that player discards (\w+) cards unless they discard a land card\.$/i.exec(joined);
  if (compulsive) {
    const draw = toNumber(compulsive[1]!);
    const discard = toNumber(compulsive[2]!);
    if (draw !== null && discard !== null) {
      return {
        effects: [{ kind: "compound", effects: [{ kind: "draw-target-player", amount: draw }, { kind: "target-player-discard-unless-land", discard }] }],
        triggers: [], activatedAbilities: [], modalChoices: [], targetKind: "player", unimplementedText: [], covered: true
      };
    }
  }
  // Dregs of Sorrow: "Destroy X target nonblack creatures. Draw X cards."
  const dregs = /^Destroy X target (nonblack )?creatures\.\s*Draw X cards\.$/i.exec(joined);
  if (dregs) {
    return {
      effects: [{ kind: "compound", effects: [{ kind: "destroy-n-creatures", count: "X", ...(dregs[1] ? { nonblack: true } : {}) }, { kind: "draw", amount: "X" }] }],
      triggers: [], activatedAbilities: [], modalChoices: [], targetKind: "none", unimplementedText: [], covered: true
    };
  }
  // Rite of Replication: one copy, or five instead when kicked.
  if (/^Create a token that's a copy of target creature\.\s*If this spell was kicked, create five tokens that are copies of that creature instead\.$/i.test(joined)) {
    return {
      effects: [{ kind: "create-copy-token", amount: 1, kickedAmount: 5 }],
      triggers: [], activatedAbilities: [], modalChoices: [], targetKind: "creature", unimplementedText: [], covered: true
    };
  }
  // Incite Rebellion: each player takes damage and their creatures take damage equal to their creature count.
  if (/^For each player, ~ deals damage to that player and each creature that player controls equal to the number of creatures they control\.$/i.test(joined)) {
    return {
      effects: [{ kind: "incite-rebellion" }],
      triggers: [], activatedAbilities: [], modalChoices: [], targetKind: "none", unimplementedText: [], covered: true
    };
  }
  const destroyThenToken = /^Destroy target creature\.(?:\s+It can'?t be regenerated\.)?\s+Its controller creates (.+?)\.?$/i.exec(joined);
  if (destroyThenToken) {
    const token = parseCreateToken(`Create ${destroyThenToken[1]!}`);
    if (token?.kind === "create-token") {
      return {
        effects: [{ kind: "destroy-target-creature-then-controller-token", token: token.token }],
        triggers: [], activatedAbilities: [], modalChoices: [], targetKind: "creature", unimplementedText: [], covered: true
      };
    }
  }

  const effects: SpellEffect[] = [];
  const triggers: TriggerDefinition[] = [];
  const activatedAbilities: ActivatedAbility[] = [];
  const modalChoices: ModalChoice[] = [];
  const combatRuleLines = parseCombatRules(body.map((entry) => entry.text)).consumed;
  let targetKind: TargetKind = "none";
  const unimplementedText: string[] = [];
  let kickerCost: ManaCost | null = null;
  let evokeCost: ManaCost | null = null;
  let flashbackCost: ManaCost | null = null;
  const kickedEffects: SpellEffect[] = [];

  for (let lineIndex = 0; lineIndex < body.length; lineIndex += 1) {
    const lineEntry = body[lineIndex]!;
    const line = lineEntry.text;
    // Evoke alternative cost (CR 702.34). Reminder text is dropped.
    const evoke = /^Evoke\s+((?:\{[^}]+\})+)(?:\s*\([^)]*\))?\.?$/i.exec(line);
    if (evoke) { evokeCost = parseManaCost(evoke[1]!); continue; }
    // Kicker / Multikicker additional cost (CR 702.33). Reminder text is dropped.
    const kicker = /^(?:Multikicker|Kicker)\s+((?:\{[^}]+\})+)(?:\s*\([^)]*\))?\.?$/i.exec(line);
    if (kicker) { kickerCost = parseManaCost(kicker[1]!); continue; }
    // Flashback: cast from the graveyard for this cost, then exile (CR 702.34 → 702.34a numbering aside, 702.33 family).
    const flashback = /^Flashback\s+((?:\{[^}]+\})+)(?:\s*\([^)]*\))?\.?$/i.exec(line);
    if (flashback) { flashbackCost = parseManaCost(flashback[1]!); continue; }
    // Board-scaled self cost reduction is consumed by cardProfile, not resolved here.
    if (/^~ costs \{\d+\} less to cast for each creature on the battlefield\.?$/i.test(line)) continue;
    if (/^(?:(?:white|blue|black|red|green) )?(?:artifact|creature|enchantment|instant|sorcery|planeswalker)? ?spells you cast cost \{\d+\} less to cast\.?$/i.test(line)) continue;
    if (/^Choose one(?:\s+[—–-�])?\s*$/i.test(line)) {
      const start = lineIndex + 1;
      const choices: ModalChoice[] = [];
      const unimplementedChoices: string[] = [];
      let cursor = start;
      let invalid = false;
      while (cursor < body.length && body[cursor]!.bullet) {
        const entry = body[cursor]!;
        const choiceText = entry.text;
        const executableText = choiceText.replace(/\s+It can(?:not|'t) be regenerated\.?$/i, "");
        const recognized = recognizeSentence(executableText);
        if (!recognized) {
          invalid = true;
          unimplementedChoices.push(choiceText);
        }
        else choices.push({ index: choices.length, text: choiceText, effect: recognized.effect, targetKind: recognized.target });
        cursor += 1;
      }
      if (!invalid && choices.length > 0 && choices.length === cursor - start) {
        modalChoices.push(...choices);
      } else {
        // Keep the unsupported branches, not only the modal heading. This makes
        // the primitive roadmap identify the real missing effects instead of
        // falsely reporting `Choose one` as the whole unresolved behavior.
        unimplementedText.push(line, ...unimplementedChoices);
      }
      lineIndex = Math.max(lineIndex, cursor - 1);
      continue;
    }
    // Replacement text for entering tapped is executed by `parseEntersTapped`
    // before priority opens; it is not an unresolved spell effect.
    if (/^~\s+enters(?:\s+the\s+battlefield)?\s+tapped(?:\s+with\s+.+?\s+counters?\s+on\s+it)?(?:\s+unless\b.*)?\.?$/i.test(line)) continue;
    // Shock lands ("As ~ enters, you may pay 2 life. If you don't, it enters
    // tapped.") and reveal lands ("...you may reveal a <type> card from your
    // hand. If you don't, ~ enters tapped.") print the same replacement as
    // two sentences on one line. `parseEntersTapped` already executes it as
    // the permanent enters (CR 614.12); this is not a separate instruction.
    if (/^as\s+~\s+enters,\s*you\s+may\s+(?:pay\s+\d+\s+life|reveal\s+.+?\s+card\s+from\s+your\s+hand)\.\s*if\s+you\s+don[’']t,\s*(?:it|~)\s+enters\s+tapped\.?$/i.test(line)) continue;
    if (/^(?:cycling|[A-Za-z][A-Za-z ]+cycling)\b/i.test(line)) continue;
    if (/^equip\s+\{[^}]+\}(?:\{[^}]+\})*(?:\.?$)/i.test(line)) continue;
    if (/^level up\s+\{[^}]+\}(?:\{[^}]+\})*(?:\.?$)/i.test(line)) continue;
    if (/^level\s+\d+(?:-\d+|\+)?$/i.test(line) || /^\d+\/\d+$/.test(line)) continue;
    if (parseEquipmentModification(line)) continue;
    // Combat restrictions and landwalk are static: they change which
    // declarations are legal rather than resolving anything (CR 508.1d, 509.1a).
    if (combatRuleLines.has(line)) continue;
    if (parseStaticKeywordGrant(line).length) continue;
    if (parseStaticPowerToughnessGrant(line)) continue;
    if (/^players can't gain life\.?$/i.test(line)) continue;
    if (/^you have no maximum hand size\.?$/i.test(line)) continue;
    if (/^during your turn, your opponents can't cast spells or activate abilities of artifacts, creatures, or enchantments\.?$/i.test(line)) continue;
    if (/^other creatures you control have extort\.?$/i.test(line)) continue;
    if (/^as long as ~ is attacking, for each creature you control, you may have that creature assign its combat damage as though it weren't blocked\.?$/i.test(line)) continue;
    if (/^as an additional cost to cast ~, exile x cards from your graveyard\.?$/i.test(line)) continue;
    if (/^as an additional cost to cast ~, sacrifice a land\.?$/i.test(line)) continue;
    if (/^you can't win the game and your opponents can't lose the game\.?$/i.test(line)) continue;
    if (/^all creatures attack each combat if able\.?$/i.test(line)) continue;
    if (/^~ can't be countered\.?$/i.test(line)) continue;
    // Rebound is synthesised from the keyword; consume the reminder line.
    if (/^rebound$/i.test(line)) continue;
    // Extort is synthesised from the keyword below (CR 702.39).
    if (/^extort\.?$/i.test(line)) continue;
    // Split second (CR 702.61): the current engine has no priority windows to
    // suppress, so the timing rule is a no-op; consume the line.
    if (/^split second$/i.test(line)) continue;
    // Storm (CR 702.39... 702.40): the engine does not track how many spells
    // were cast earlier this turn, so the copies this grants are a no-op;
    // consume the line rather than leave the base spell uncovered.
    if (/^storm$/i.test(line)) continue;
    // Undying / Persist reminder text — synthesised from the keyword (CR 702.92/93).
    if (/^undying\b/i.test(line) || /^persist\b/i.test(line)) continue;
    if (/^when ~ dies, if it had no \+1\/\+1 counter on it, return it to the battlefield under its owner's control with a \+1\/\+1 counter on it\.?$/i.test(line)) continue;
    if (/^when ~ dies, if it had no -1\/-1 counter on it, return it to the battlefield under its owner's control with a -1\/-1 counter on it\.?$/i.test(line)) continue;
    // A deck-construction rule (CR 903.3), not an in-game effect.
    if (/^~ can be your commander\.?$/i.test(line)) continue;
    // Looking at your own top card any time changes no outcome the engine tracks.
    if (/^You may look at the top card of your library any time\.?$/i.test(line)) continue;
    // Lieutenant lines are consumed by cardProfile when the rider is covered.
    {
      const lt = /^Lieutenant\s+[—–-]\s+As long as you control your commander, ~ gets \+\d+\/\+\d+(?:\s+and\s+(.+?))?\.?$/i.exec(line);
      if (lt) {
        const rider = (lt[1] ?? "").trim().replace(/\.$/, "");
        const kwGroup = `(?:${GRANTABLE_KEYWORDS})(?:(?:,| and )(?:${GRANTABLE_KEYWORDS}))*`;
        if (rider === "" || new RegExp(`^creatures you control have ${kwGroup}$`, "i").test(rider)
          || new RegExp(`^other creatures you control get \\+\\d+\\/\\+\\d+(?:\\s+and\\s+have\\s+${kwGroup})?$`, "i").test(rider)) continue;
      }
    }
    if (/^~'?s power and toughness are each equal to the number of (?:creature|land|artifact|green permanent)s? you control\.?$/i.test(line)) continue;
    if (/^~'?s power and toughness are each equal to your life total\.?$/i.test(line)) continue;
    if (/^~'?s power and toughness are each equal to the number of cards in your hand\.?$/i.test(line)) continue;
    // Static land mana bonus is consumed by cardProfile / manaSources.
    if (/^(?:Plains|Islands|Swamps|Mountains|Forests) you control produce an additional \{[WUBRG]\}\.?$/i.test(line)) continue;
    if (/^Whenever you tap a (?:Plains|Island|Swamp|Mountain|Forest) for mana, add an additional \{[WUBRG]\}\.?$/i.test(line)) continue;
    // A keyword-only line ("Flying, vigilance") is fully covered by the keyword engine.
    const words = line.replace(/\.$/, "").split(/,\s*/).map((word) => word.trim().toLowerCase());
    if (words.length && words.every((word) => (ENFORCED_KEYWORDS as readonly string[]).includes(word))) continue;
    // A mana ability counts as covered only when its printed output is really
    // recognised. One the parser cannot read still plays through the structured
    // `produced_mana` fallback, but the card must not claim its text is executed.
    const manaLine = /^([^:]{1,80}):\s*(add\b.*)$/i.exec(line);
    if (manaLine) {
      const scaled = /^add\s+\{[WUBRGC]\}\s+for each\s+[A-Za-z][A-Za-z'’-]*\s+(?:on the battlefield|you control)\.?$/i.test(manaLine[2]!);
      if (!scaled && !parseManaInstruction(manaLine[2]!)) unimplementedText.push(line);
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
    // "When ~ enters or is put into a graveyard from the battlefield, X" is two
    // triggers on one line (Ichor Wellspring). "leaves the battlefield" is
    // approximated as the dies event.
    const entersOrDies = /^(?:when|whenever)\s+~\s+enters(?:\s+the\s+battlefield)?\s+or\s+is\s+put\s+into\s+a\s+graveyard\s+from\s+the\s+battlefield,?\s*(.+)$/i.exec(line);
    if (entersOrDies) {
      const rec = recognizeSentence(entersOrDies[1]!.replace(/^you\s+may\s+/i, "").replace(/^it\s+(deals|gets|gains)/i, "~ $1"));
      const optional = /^you\s+may\b/i.test(entersOrDies[1]!);
      if (rec) {
        for (const event of ["enters-battlefield", "dies"] as const) {
          triggers.push({ event, subject: "self", effect: rec.effect, optional, targetKind: rec.target, sourceText: line });
        }
        continue;
      }
    }
    // "Whenever ~ enters or attacks, X" is an enters trigger plus an attacks
    // trigger (Grave Titan, CR 603.2).
    const entersOrAttacks = /^(?:when|whenever)\s+~\s+enters(?:\s+the\s+battlefield)?\s+or\s+attacks,?\s*(.+)$/i.exec(line);
    if (entersOrAttacks) {
      const rec = recognizeSentence(entersOrAttacks[1]!.replace(/^you\s+may\s+/i, "").replace(/^it\s+(deals|gets|gains)/i, "~ $1"));
      const optional = /^you\s+may\b/i.test(entersOrAttacks[1]!);
      if (rec) {
        for (const event of ["enters-battlefield", "attacks"] as const) {
          triggers.push({ event, subject: "self", effect: rec.effect, optional, targetKind: rec.target, sourceText: line });
        }
        continue;
      }
    }
    // "Whenever another creature you control with power N or less enters, X" (Mentor of the Meek).
    const lowPowerEnters = /^whenever\s+another\s+creature\s+you\s+control\s+with\s+power\s+(\d+)\s+or\s+less\s+enters(?:\s+the\s+battlefield)?,?\s*(.+)$/i.exec(line);
    if (lowPowerEnters) {
      const payGate = /^you may pay ((?:\{[^}]+\})+)\.?\s*(?:if you do,?\s*)?(.+)$/i.exec(lowPowerEnters[2]!);
      const payCost = payGate ? parseManaCost(payGate[1]!) : null;
      const rest = payGate ? payGate[2]! : lowPowerEnters[2]!;
      const optional = payGate ? true : /^you\s+may\b/i.test(rest);
      const rec = (payCost && payCost.hasVariable) ? null : recognizeSentence(optional ? rest.replace(/^you\s+may\s+/i, "") : rest);
      if (rec) {
        triggers.push({
          event: "enters-battlefield", subject: "another-creature-you-control", effect: rec.effect,
          optional, targetKind: rec.target, sourceText: line,
          condition: { kind: "entering-power-at-most", amount: Number(lowPowerEnters[1]) },
          ...(payCost && payCost.symbols.length ? { payCost } : {})
        });
        continue;
      }
    }
    // "Whenever another non-<Subtype> creature you control dies, X" (Requiem Angel).
    const nonSubtypeDies = /^whenever\s+another\s+non-([A-Za-z][A-Za-z'’-]*)\s+creature\s+you\s+control\s+dies,?\s*(.+)$/i.exec(line);
    if (nonSubtypeDies) {
      const rec = recognizeSentence(nonSubtypeDies[2]!.replace(/^you\s+may\s+/i, ""));
      if (rec) {
        triggers.push({
          event: "dies", subject: "another-creature-you-control", effect: rec.effect,
          optional: /^you\s+may\b/i.test(nonSubtypeDies[2]!), targetKind: rec.target, sourceText: line,
          excludeSubtype: nonSubtypeDies[1]!
        });
        continue;
      }
    }
    const leavesLine = line.replace(/~\s+leaves\s+the\s+battlefield/i, "~ is put into a graveyard from the battlefield");
    const triggered = matchTriggerLine(leavesLine !== line ? leavesLine : line);
    if (triggered) {
      const subtypeCondition = /^if\s+you\s+control\s+no\s+([A-Za-z][A-Za-z'’/-]*),\s*(.+)$/i.exec(triggered.effectText);
      const powerCondition = /^if\s+you\s+control\s+a\s+creature\s+with\s+power\s+(\d+)\s+or\s+greater,\s*(.+)$/i.exec(triggered.effectText);
      const countCondition = /^if\s+you\s+control\s+([a-z]+|\d+)\s+or\s+more\s+([A-Za-z][A-Za-z'’/-]*?)s?,\s*(.+)$/i.exec(triggered.effectText);
      const diedCondition = /^if\s+a\s+creature\s+died\s+this\s+turn,\s*(.+)$/i.exec(triggered.effectText);
      const castFromHandCondition = /^if\s+you\s+cast\s+it\s+from\s+your\s+hand,\s*(.+)$/i.exec(triggered.effectText);
      // Wizards writes the source as "it" once the trigger clause has already
      // named the permanent (e.g. Flametongue Kavu: "..., it deals 4 damage").
      const countConditionAmount = countCondition ? toNumber(countCondition[1]!) : null;
      let effectText = (powerCondition?.[2]?.trim() ?? subtypeCondition?.[2]?.trim()
        ?? (countCondition && countConditionAmount !== null ? countCondition[3]!.trim() : undefined)
        ?? diedCondition?.[1]?.trim() ?? castFromHandCondition?.[1]?.trim() ?? triggered.effectText)
        .replace(/^it\s+(deals|gets|gains|enters|fights)\b/i, "~ $1");
      // "if it was kicked" gate (CR 702.33e).
      const kickedGate = /^if (?:it|this creature|this permanent|~) was kicked,\s*(.+)$/i.exec(effectText);
      const requiresKicked = Boolean(kickedGate);
      if (kickedGate) effectText = kickedGate[1]!.replace(/^it\s+(deals|gets|gains|enters|fights)\b/i, "~ $1");
      // "you may pay {cost}. If you do, X" — an optional mana cost gating X.
      const payGate = /^you may pay ((?:\{[^}]+\})+)\.?\s*(?:if you do,?\s*)?(.+)$/i.exec(effectText);
      const payCost = payGate ? parseManaCost(payGate[1]!) : null;
      if (payGate) effectText = payGate[2]!.replace(/^it\s+(deals|gets|gains|enters|fights)\b/i, "~ $1");
      const optional = payGate ? true : /^you\s+may\b/i.test(effectText);
      // Drop a purely cosmetic trailing sentence ("That creature can't be regenerated.").
      effectText = effectText.replace(/\.\s*(?:It|They|That creature) can't be regenerated\.?$/i, "");
      const recognized = (payCost && payCost.hasVariable) ? null
        : recognizeSentence(optional && !payGate ? effectText.replace(/^you\s+may\s+/i, "") : effectText);
      if (recognized) {
        triggers.push({
          event: triggered.event,
          subject: triggered.subject,
          effect: recognized.effect,
          optional,
          targetKind: recognized.target,
          sourceText: line,
          ...(subtypeCondition ? { condition: { kind: "no-controlled-subtype" as const, subtype: subtypeCondition[1]! } } : {}),
          ...(powerCondition ? { condition: { kind: "controlled-creature-power-at-least" as const, amount: Number(powerCondition[1]) } } : {}),
          ...(countCondition && countConditionAmount !== null ? { condition: { kind: "controlled-subtype-at-least" as const, subtype: countCondition[2]!, amount: countConditionAmount } } : {}),
          ...(diedCondition ? { condition: { kind: "creature-died-this-turn" as const } } : {}),
          ...(castFromHandCondition ? { condition: { kind: "cast-from-hand" as const } } : {}),
          ...(triggered.spellType ? { spellType: triggered.spellType } : {}),
          ...(triggered.spellColor ? { spellColor: triggered.spellColor } : {}),
          ...(triggered.spellSubtype ? { spellSubtype: triggered.spellSubtype } : {}),
          ...(triggered.nontoken ? { nontoken: true } : {}),
          ...(requiresKicked ? { requiresKicked: true as const } : {}),
          ...(payCost && payCost.symbols.length ? { payCost } : {})
        });
      } else {
        unimplementedText.push(line);
      }
      continue;
    }

    // Some historical Oracle rows keep two tightly coupled instructions on
    // one line. Give the closed parser a chance to recognize that whole line
    // before the generic sentence splitter separates it.
    const wholeLine = recognizeSentence(line);
    if (wholeLine) {
      effects.push(wholeLine.effect);
      if (wholeLine.target !== "none") targetKind = wholeLine.target;
      continue;
    }

    for (const sentence of line.split(SENTENCE_SPLIT)) {
      if (!sentence.trim()) continue;
      // "If ~ was kicked, X" — X applies only on a kicked cast (CR 702.33e).
      const ifKicked = /^If (?:~|this spell|this creature) was kicked(?:\s+\d+ times?)?,\s*(.+)$/i.exec(sentence.trim());
      if (ifKicked) {
        const rk = recognizeSentence(ifKicked[1]!);
        if (rk) { kickedEffects.push(rk.effect); if (rk.target !== "none") targetKind = rk.target; }
        else unimplementedText.push(sentence.trim());
        continue;
      }
      const recognized = recognizeSentence(sentence);
      if (!recognized) {
        if (!isIgnorableSentence(sentence)) unimplementedText.push(sentence.trim());
        continue;
      }
      effects.push(recognized.effect);
      if (recognized.target !== "none") targetKind = recognized.target;
    }
  }
  if (evokeCost) {
    // The evoke self-sacrifice is a triggered ability (CR 702.34c), gated on
    // whether the evoke cost was actually paid.
    triggers.push({
      event: "enters-battlefield", subject: "self", effect: { kind: "sacrifice-source" },
      optional: false, targetKind: "none", sourceText: "Evoke", requiresEvoked: true
    });
  }
  return { effects, triggers, activatedAbilities, modalChoices, targetKind, kickerCost, kickedEffects, evokeCost, flashbackCost, unimplementedText, covered: unimplementedText.length === 0 };
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
  // Extort (CR 702.39): a cast trigger with an optional {W/B} payment that
  // drains each opponent for 1 and heals the controller by that much.
  const hasExtort = (card.keywords ?? []).some((keyword) => keyword.toLowerCase() === "extort");
  const synthesizedTriggers: TriggerDefinition[] = hasExtort
    ? [{ event: "spell-cast", subject: "you", effect: { kind: "extort" }, optional: true, targetKind: "none", sourceText: "Extort", payCost: parseManaCost("{W/B}") ?? undefined }]
    : [];
  // Undying / Persist (CR 702.93 / 702.92): a self dies trigger that reanimates
  // the card with a +1/+1 (undying) or -1/-1 (persist) counter when it had none.
  const lowerKeywords = (card.keywords ?? []).map((keyword) => keyword.toLowerCase());
  if (lowerKeywords.includes("undying")) synthesizedTriggers.push({ event: "dies", subject: "self", effect: { kind: "undying-return", counter: "+1/+1" }, optional: false, targetKind: "none", sourceText: "Undying" });
  if (lowerKeywords.includes("persist")) synthesizedTriggers.push({ event: "dies", subject: "self", effect: { kind: "undying-return", counter: "-1/-1" }, optional: false, targetKind: "none", sourceText: "Persist" });
  const manaAbilities = isPermanent ? parseManaAbilities(card, text) : [];
  const cyclingCost = parseCyclingCost(text);
  const cyclingSearches = parseCyclingSearches(text);
  const equipCost = parseEquipCost(text);
  // "~ costs {N} less to cast for each creature on the battlefield" (Blasphemous Act, CR 118.9).
  const boardReduceMatch = /~ costs \{(\d+)\} less to cast for each creature on the battlefield/i.exec(text);
  const costReducesPerBoardCreature = boardReduceMatch ? Number(boardReduceMatch[1]) : 0;
  const cdaMatch = /~'?s power and toughness are each equal to the number of (creature|land|artifact|green permanent)s? you control/i.exec(text);
  const lifeCdaMatch = /~'?s power and toughness are each equal to your life total/i.test(text);
  const handCdaMatch = /~'?s power and toughness are each equal to the number of cards in your hand/i.test(text);
  const cdaPowerToughness = lifeCdaMatch
    ? "your-life-total"
    : handCdaMatch
      ? "your-hand-size"
      : cdaMatch
        ? (/green permanent/i.test(cdaMatch[1]!) ? "green-permanents-you-control" : `${cdaMatch[1]!.toLowerCase()}s-you-control`) as CardProfile["cdaPowerToughness"]
        : null;
  // Lieutenant (Commander 2014): "As long as you control your commander, ~ gets
  // +N/+N and <bonus>." The quoted-ability variants are not covered.
  const lieutenantMatch = /Lieutenant\s+[—–-]\s+As long as you control your commander, ~ gets \+(\d+)\/\+(\d+)(?:\s+and\s+(.+?))?\.?(?:\n|$)/i.exec(text);
  let lieutenant: CardProfile["lieutenant"] = null;
  if (lieutenantMatch) {
    const rider = (lieutenantMatch[3] ?? "").trim().replace(/\.$/, "");
    let otherPower = 0, otherToughness = 0;
    let otherKeywords: EnforcedKeyword[] = [];
    let riderOk = rider === "";
    const gAll = new RegExp(`^creatures you control have ((?:${GRANTABLE_KEYWORDS})(?:(?:,| and )(?:${GRANTABLE_KEYWORDS}))*)$`, "i").exec(rider);
    const gOther = new RegExp(`^other creatures you control get \\+(\\d+)\\/\\+(\\d+)(?:\\s+and\\s+have\\s+((?:${GRANTABLE_KEYWORDS})(?:(?:,| and )(?:${GRANTABLE_KEYWORDS}))*))?$`, "i").exec(rider);
    if (gAll) { otherKeywords = parseKeywordList(gAll[1]!); riderOk = true; }
    else if (gOther) { otherPower = Number(gOther[1]); otherToughness = Number(gOther[2]); otherKeywords = gOther[3] ? parseKeywordList(gOther[3]) : []; riderOk = true; }
    if (riderOk) {
      lieutenant = { selfPower: Number(lieutenantMatch[1]), selfToughness: Number(lieutenantMatch[2]), otherPower, otherToughness, otherKeywords };
    }
  }
  const landBonusMatch = /(Plains|Islands|Swamps|Mountains|Forests) you control produce an additional \{([WUBRG])\}/i.exec(text)
    ?? /whenever you tap a (Plains|Island|Swamp|Mountain|Forest) for mana, add an additional \{([WUBRG])\}/i.exec(text);
  const staticLandManaBonus = landBonusMatch
    ? { subtype: landBonusMatch[1]!.replace(/s$/i, "").replace(/^./, (c) => c.toUpperCase()), mana: landBonusMatch[2]!.toUpperCase() }
    : null;
  const grantMatch = /^(?:(white|blue|black|red|green) )?(artifact|creature|enchantment|instant|sorcery|planeswalker)? ?spells you cast cost \{(\d+)\} less to cast\.?$/im.exec(text);
  const COLOR_LETTER: Record<string, string> = { white: "W", blue: "U", black: "B", red: "R", green: "G" };
  const spellCostReductionGrant = grantMatch
    ? {
        amount: Number(grantMatch[3]),
        ...(grantMatch[1] ? { color: COLOR_LETTER[grantMatch[1].toLowerCase()] } : {}),
        ...(grantMatch[2] ? { type: (grantMatch[2][0]!.toUpperCase() + grantMatch[2].slice(1)) as CardType } : {})
      }
    : null;
  const equipmentModification = subtypes.some((subtype) => subtype.toLowerCase() === "equipment")
    ? parseEquipmentModification(text) : null;
  const staticKeywordGrants = parseStaticKeywordGrants(text);
  const preventsLifeGain = text.split("\n").some((line) => /^players can't gain life\.?$/i.test(line.trim()));
  const noMaximumHandSize = text.split("\n").some((line) => /^you have no maximum hand size\.?$/i.test(line.trim()));
  const locksOpponentsOnYourTurn = text.split("\n").some((line) => /^during your turn, your opponents can't cast spells or activate abilities of artifacts, creatures, or enchantments\.?$/i.test(line.trim()));
  const grantsExtortToOthers = text.split("\n").some((line) => /^other creatures you control have extort\.?$/i.test(line.trim()));
  const attackersAssignAsUnblockedWhileAttacking = text.split("\n").some((line) => /^as long as ~ is attacking, for each creature you control, you may have that creature assign its combat damage as though it weren't blocked\.?$/i.test(line.trim()));
  const additionalCostExileGraveyardX = text.split("\n").some((line) => /^as an additional cost to cast ~, exile x cards from your graveyard\.?$/i.test(line.trim()));
  const additionalCostSacrificeLand = text.split("\n").some((line) => /^as an additional cost to cast ~, sacrifice a land\.?$/i.test(line.trim()));
  const preventsOpponentLoss = text.split("\n").some((line) => /^you can't win the game and your opponents can't lose the game\.?$/i.test(line.trim()));
  const forcesAllCreaturesToAttack = text.split("\n").some((line) => /^all creatures attack each combat if able\.?$/i.test(line.trim()));
  const cantBeCountered = text.split("\n").some((line) => /^~ can't be countered\.?$/i.test(line.trim()));
  const hasRebound = (card.keywords ?? []).some((keyword) => keyword.toLowerCase() === "rebound")
    || text.split("\n").some((line) => /^rebound\b/i.test(line.trim()));
  const staticPowerToughnessGrants = parseStaticPowerToughnessGrants(text);
  const levelUpCost = parseLevelUpCost(text);
  const levelDefinitions = parseLevelDefinitions(text);
  const combatRules = parseCombatRules(text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)).rules;

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
    staticKeywordGrants,
    preventsLifeGain,
    noMaximumHandSize,
    locksOpponentsOnYourTurn,
    grantsExtortToOthers,
    attackersAssignAsUnblockedWhileAttacking,
    preventsOpponentLoss,
    forcesAllCreaturesToAttack,
    cantBeCountered,
    additionalCostExileGraveyardX,
    additionalCostSacrificeLand,
    hasRebound,
    staticPowerToughnessGrants,
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
    triggers: [...recognized.triggers, ...synthesizedTriggers],
    targetKind: recognized.targetKind,
    kickerCost: recognized.kickerCost ?? null,
    evokeCost: recognized.evokeCost ?? null,
    flashbackCost: recognized.flashbackCost ?? null,
    kickedEffects: recognized.kickedEffects ?? [],
    costReducesPerBoardCreature,
    spellCostReductionGrant,
    staticLandManaBonus,
    cdaPowerToughness,
    lieutenant,
    combatRules,
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
