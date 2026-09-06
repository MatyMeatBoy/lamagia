/**
 * Derives the structured characteristics the engine plays with from imported card data.
 *
 * Nothing here interprets free-form Oracle text as a general rules language. It
 * reads Scryfall's structured fields (types, power/toughness, keywords,
 * produced_mana) and recognises a small, closed set of unambiguous templates.
 * Anything outside that set is reported as unimplemented rather than guessed at,
 * so the table never pretends a card did something it did not do.
 */

import { MANA_COLORS, parseManaCost, type ManaCost, type ManaRestriction, type ManaType } from "./mana.js";


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
  "hexproof", "shroud", "flash", "fear", "intimidate", "horsemanship", "prowess", "shadow", "exalted", "split second"
] as const;
export type EnforcedKeyword = (typeof ENFORCED_KEYWORDS)[number];

export interface ManaAbility {
  readonly index: number;
  /** Zone from which this mana ability can be activated (battlefield by default). */
  readonly sourceZone?: "battlefield" | "hand";
  /** Exile the source card as part of a hand-based mana cost (e.g. Simian Spirit Guide). */
  readonly exilesSelf?: boolean;
  /** The mana types the controller may choose between for each mana produced. */
  readonly produces: readonly ManaType[];
  readonly amount: number;
  /** "Add {C} for each <Subtype> on the battlefield / you control" (Priest of Titania, Magus of the Coffers). */
  readonly scalesWith?: { readonly kind: "subtype-anywhere" | "subtype-you-control"; readonly subtype: string };
  /** Fixed mixed output, such as `{T}: Add {W}{U}`, rather than a choice. */
  readonly fixedProduces?: readonly ManaType[];
  /** Restricts choices to the controller's commander color identity. */
  readonly commanderIdentity?: boolean;
  /** "Add one mana of any color that a land you/an opponent control(s) could produce" (Fellwar Stone, Harvester Druid): the color set is computed from the battlefield at activation time, not fixed on the card. */
  readonly anyColorFromLandsControlledBy?: "opponent" | "you";
  /** The produced mana can add Opal Palace's commander-entry counters when spent to cast that commander. */
  readonly commanderEntryCounters?: boolean;
  /** Restriction retained on the floating mana, e.g. Delighted Halfling. */
  readonly manaRestriction?: ManaRestriction;
  readonly requiresTap: boolean;
  /** Life the ability costs (pain and filter lands). */
  readonly lifeCost: number;
  /** Counters removed from the source as an activation cost. */
  readonly removeCounters?: readonly CounterCost[];
  /** Fixed mana cost paid before a variable counter-to-mana ability resolves. */
  readonly manaCost?: ManaCost;
  /** Fast-mana restriction: the source entered this turn, or a basic land is controlled. */
  readonly activationRestriction?: { readonly enteredThisTurn: boolean; readonly orControlsBasicLand?: boolean };
  /** Storage-counter abilities produce one mana per removed counter. */
  readonly variableAmountCounter?: string;
  /** A variable number of typed creatures is paid as an activation cost. */
  readonly sacrificesCreatures?: { readonly amount: number | "X"; readonly subtype?: string };
  /** The amount of mana/life is the number of creatures sacrificed. */
  readonly amountFromSacrifice?: boolean;
  readonly gainLifeFromAmount?: boolean;
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
  /** Untapped creature chosen as an activation cost, optionally by subtype. */
  readonly tapsCreature?: { readonly subtype?: string; readonly mode: "any" | "another" };
  /** Creature chosen as an activation cost, optionally excluding the source. */
  readonly sacrificesCreature?: "any" | "another";
  /** Multiple creatures chosen as one activation cost, e.g. "Sacrifice two creatures". */
  readonly sacrificesCreatures?: { readonly amount: number; readonly subtype?: string };
  /** Creature subtype required by the activation cost, e.g. "Sacrifice a Beast". */
  readonly sacrificesCreatureSubtype?: { readonly subtype: string; readonly mode: "any" | "another" };
  readonly sacrificesArtifact?: boolean;
  readonly sacrificesLand?: boolean;
  /** Noncreature permanent chosen as an activation cost, optionally excluding the source. */
  readonly sacrificesPermanent?: { readonly type: "Artifact" | "Enchantment" | "Land" | "Noncreature" | "Token" | "Permanent"; readonly mode: "any" | "another"; readonly nontoken?: boolean };
  /** One card chosen from the controller's hand as an activation cost. */
  readonly discardsCard?: boolean;
  /** One card chosen from the controller's graveyard and exiled as a cost. */
  readonly exilesGraveyardCard?: boolean;
  /** Multiple creature cards chosen from one graveyard and exiled as a cost. */
  readonly exilesGraveyardCards?: { readonly amount: number; readonly scope: "single-graveyard" };
  /** Counters removed from the source as an activation cost. */
  readonly removeCounters?: readonly CounterCost[];
  readonly lifeCost: number;
  /** Mana part of the activation cost, or null when the ability needs none. */
  readonly manaCost: ManaCost | null;
  readonly effect: SpellEffect;
  readonly targetKind: TargetKind;
  readonly targetKinds?: readonly Exclude<TargetKind, "none">[];
  /** Level up is an activated ability with a sorcery-speed restriction. */
  readonly sorcerySpeed?: boolean;
  /** Planeswalker loyalty ability: signed loyalty change paid as the cost (CR 606). */
  readonly loyaltyCost?: number;
  /** Energy paid from the controller's player counters (CR 107.4, 118.3). */
  readonly energyCost?: number;
  /** Untap symbol cost `{Q}` (CR 118.1, 602.1). */
  readonly requiresUntap?: boolean;
  /** Printed restriction that narrows activation to the precombat main phase. */
  readonly precombatMainOnly?: boolean;
  /** The ability is activated from the named zone instead of the battlefield. */
  readonly sourceZone?: "hand" | "graveyard";
  /** Printed upkeep restriction (Forecast, CR 702.57). */
  readonly upkeepOnly?: boolean;
  /** The same source ability can be activated only once during its controller's turn. */
  readonly oncePerTurn?: boolean;
  /** Reveal a hand source while announcing the ability (Forecast, CR 702.57). */
  readonly revealSourceFromHand?: boolean;
  /** The ability's own source card is discarded from hand to pay its cost (Mjölnir, CR 702). */
  readonly discardsSelf?: boolean;
  /** A Class's level-up ability: legal only while the source is exactly at this level (CR 702.134c). */
  readonly requiresClassLevel?: number;
  readonly requiresOpponentLands?: number;
  readonly text: string;
}

/** One independently selectable mode of a supported `Choose one` spell. */
export interface ModalChoice {
  readonly index: number;
  readonly text: string;
  readonly effect: SpellEffect;
  readonly targetKind: TargetKind;
  /** Ordered target kinds when this synthetic mode selects multiple branches. */
  readonly targetKinds?: readonly Exclude<TargetKind, "none">[];
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
  /** "~ can't be blocked as long as defending player controls the most creatures". */
  readonly cannotBeBlockedWhenDefenderHasMostCreatures: boolean;
  /** "~ attacks each combat if able" (CR 508.1d). */
  readonly mustAttack: boolean;
  /** "No more than N creatures can attack you each combat" (CR 508.1d). */
  readonly maxAttackers: number | null;
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
  /** "Prevent all combat damage that would be dealt to ~" (Guard Gomazoa). */
  readonly preventsAllCombatDamageToSelf: boolean;
  /** "If a creature would deal combat damage to you, prevent N of that damage" while untapped (CR 615.1). */
  readonly preventsCombatDamageToController: number;
  /** "You may have ~ assign its combat damage as though it weren't blocked" (Tornado Elemental). */
  readonly assignsAsUnblocked: boolean;
}

export const NO_COMBAT_RULES: CombatRules = {
  cannotAttack: false,
  cannotBlock: false,
  cannotBeBlocked: false,
  cannotBeBlockedWhenDefenderHasMostCreatures: false,
  mustAttack: false,
  maxAttackers: null,
  blocksOnlyWithKeyword: null,
  landwalk: [],
  preventsAllCombatDamage: false,
  preventsAllCombatDamageToSelf: false,
  preventsCombatDamageToController: 0,
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
  if (/^~ can't be blocked as long as defending player controls the most creatures or is tied for the most$/.test(text)) {
    return { cannotBeBlockedWhenDefenderHasMostCreatures: true };
  }
  if (/^~ can't attack or block$/.test(text)) return { cannotAttack: true, cannotBlock: true };
  if (/^~ attacks each combat if able$/.test(text)) return { mustAttack: true };
  if (/^prevent all combat damage that would be dealt to and dealt by ~$/i.test(text)) return { preventsAllCombatDamage: true };
  if (/^prevent all combat damage that would be dealt to ~$/i.test(text)) return { preventsAllCombatDamageToSelf: true };
  const controllerPrevention = /^as long as ~ is untapped, if a creature would deal combat damage to you, prevent (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) of that damage$/i.exec(text);
  if (controllerPrevention) return { preventsCombatDamageToController: toNumber(controllerPrevention[1]!) ?? 0 };
  if (/^you may have ~ assign its combat damage as though it weren't blocked$/i.test(text)) return { assignsAsUnblocked: true };

  const attackLimit = /^no more than (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) creatures? can attack you each combat$/.exec(text);
  if (attackLimit) return { maxAttackers: toNumber(attackLimit[1]) ?? 0 };

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

const PROTECTION_QUALITIES: Readonly<Record<string, string>> = {
  white: "W", blue: "U", black: "B", red: "R", green: "G"
};

/** Reads the common color-only protection line while preserving each quality. */
function parseProtectionFromLine(line: string): readonly string[] | null {
  const match = /(?:^|,\s*)protection from (.+)$/i.exec(line.trim().replace(/\.$/, ""));
  if (!match) return null;
  const qualities = match[1]!.replace(/\s+and\s+from\s+/gi, ",").replace(/\s+and\s+/gi, ",")
    .split(",").map((quality) => quality.trim().toLowerCase()).filter(Boolean);
  if (!qualities.length || qualities.some((quality) => !PROTECTION_QUALITIES[quality])) return null;
  return qualities.map((quality) => PROTECTION_QUALITIES[quality]!);
}

/** Static bonuses granted by an Equipment to its equipped creature. */
export interface EquipmentModification {
  readonly power: number;
  readonly toughness: number;
  readonly keywords: readonly EnforcedKeyword[];
  /** Pacifism / Arrest: the enchanted creature can't attack and/or can't block. */
  readonly cannotAttack?: boolean;
  readonly cannotBlock?: boolean;
  /** Multiplier for a dynamic Aura bonus. */
  readonly scaling?: "other-enchantments-on-battlefield";
  /** Aura characteristic-setting layer (CR 613.1): replaces base values/types and may remove abilities. */
  readonly characteristicSetting?: {
    readonly basePower: number;
    readonly baseToughness: number;
    readonly types: readonly CardType[];
    readonly subtypes: readonly string[];
    readonly keywords: readonly EnforcedKeyword[];
    readonly removeAbilities: boolean;
  };
  readonly text: string;
}

export interface StaticKeywordGrant {
  readonly scope: "creatures-you-control" | "other-creatures-you-control" | "all-creatures" | "subtype-creatures-you-control";
  readonly keyword: EnforcedKeyword;
  readonly subtype?: string;
  /** Zone where the source supplies the static ability (battlefield by default). */
  readonly sourceZone?: "battlefield" | "graveyard";
  /** Land subtype required when the source ability is active in a graveyard. */
  readonly requiresControlledLandSubtype?: string;
}

/** "X [you control] have '{T}: Add ...'" (Chromatic Lantern, Joraga Treespeaker, Cryptolith Rite, CR 113.6). */
export interface StaticManaAbilityGrant {
  readonly scope: "you-control" | "all";
  readonly excludesSelf: boolean;
  readonly type?: CardType;
  readonly subtype?: string;
  readonly ability: ManaAbility;
  /** Only active once the granting permanent (a Class or Level Up card) has reached this level (CR 702.134, 710.3). */
  readonly minLevel?: number;
}

/** "If a triggered ability of X triggers, that ability triggers an additional time" (CR 603.3f). */
export interface TriggerDoubler {
  readonly scope: "subtype-you-control" | "equipped-creature" | "draw-caused-triggers";
  readonly subtypes?: readonly string[];
}

export interface StaticPowerToughnessGrant {
  readonly scope: "creatures-you-control" | "other-creatures-you-control" | "all-creatures"
    | "source-opponents-graveyard-creatures" | "source-controller-life-threshold" | "other-subtype-creatures-you-control"
    | "other-all-creatures" | "creatures-you-control-source-counter-threshold";
  readonly power: number;
  readonly toughness: number;
  readonly color?: string;
  readonly subtype?: string;
  readonly counterName?: string;
  readonly threshold?: number;
  /** Dynamic +1/+1 per creature card in opponents' graveyards (Wight). */
  readonly scaling?: "creature-cards-in-opponents-graveyards";
}

/** Torbran-style static damage amplifier (CR 614.1c). */
export interface DamageAmplify {
  /** Undefined means any color (e.g. Thor, Asgard's Avenger). */
  readonly colorFilter?: ManaType;
  /** "another ... source" excludes the amplifier's own permanent from its own bonus. */
  readonly excludesSelf: boolean;
  /** "opponent" = only damage to an opponent or their permanents; "any" = every permanent or player, including allies. */
  readonly scope: "opponent" | "any";
  /** "source-power" (Hawkeye, Young Avenger): the bonus is the amplifier's own power, read live rather than fixed on the card. */
  readonly amount: number | "source-power";
  /** "noncombat damage" (Hawkeye, Young Avenger): excludes combat damage from the bonus, unlike Torbran-style amplifiers. */
  readonly noncombatOnly?: boolean;
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
  | { readonly kind: "compound"; readonly effects: readonly SpellEffect[]; readonly targetOffsets?: readonly (number | null)[] }
  | { readonly kind: "incite-rebellion" }
  | { readonly kind: "draw"; readonly amount: number | "X" }
  /** Add public player counters such as energy (CR 121.1, 121.3). */
  | { readonly kind: "add-player-counter"; readonly counter: string; readonly amount: number }
  /** Proliferate (CR 701.27): choose any number of players/permanents with counters. */
  | { readonly kind: "proliferate" }
  /** Both the source controller and combat-damaged player draw the event amount. */
  | { readonly kind: "draw-combat-damage-participants" }
  /** Draw only if the controller currently has more life than an opponent. */
  | { readonly kind: "draw-if-life-more-than-opponent"; readonly amount: number }
  | { readonly kind: "draw-target-player"; readonly amount: number | "X" }
  | { readonly kind: "draw-active-player" }
  | { readonly kind: "put-active-player-hand-on-library-bottom-then-draw-same" }
  /** Fevered Visions: the draw always happens; the damage only hits an opponent whose hand, after drawing, meets the threshold (CR 603.2, 603.3). */
  | { readonly kind: "draw-active-player-then-damage-if-opponent-hand-at-least"; readonly handAtLeast: number; readonly damage: number }
  | { readonly kind: "draw-equal-tapped-creatures" }
  | { readonly kind: "draw-equal-controlled-type"; readonly type: CardType }
  | { readonly kind: "draw-equal-controlled-color-creature"; readonly color: string }
  | { readonly kind: "draw-equal-graveyard-creatures" }
  | { readonly kind: "draw-equal-greatest-mana-value-you-control" }
  | { readonly kind: "scry"; readonly amount: number; readonly thenDraw?: number }
  /** Surveil N (CR 701.42): look at the top N, put any number in the graveyard, the rest on top in any order. */
  | { readonly kind: "surveil"; readonly amount: number }
  /** Look at the top N cards, optionally take one matching card, bottom the rest. */
  | { readonly kind: "look-top-select"; readonly amount: number; readonly types: readonly CardType[]; readonly destination: "hand" | "battlefield"; readonly returnAtEndStep?: boolean }
  /** "Look at the top N cards of your library, then put them back in any order" (Ponder, Sensei's Divining Top, Sage Owl): a private reorder, unlike Scry/Surveil no card ever leaves the top group. */
  | { readonly kind: "look-top-reorder"; readonly amount: number }
  /** "Draw a card, then put ~ on top of its owner's library" (Sensei's Divining Top's tap ability). */
  | { readonly kind: "draw-then-source-to-library-top" }
  /** "Look at target player's hand" (Gitaxian Probe, CR 701.20): a private reveal to the caster only. */
  | { readonly kind: "look-at-target-players-hand" }
  | { readonly kind: "each-player-draw"; readonly amount: number | "X" }
  | { readonly kind: "each-player-discard-and-draw"; readonly amount: number }
  /** Each player discards their hand, then all draw the greatest discarded hand size. */
  | { readonly kind: "each-player-discard-and-draw-greatest" }
  /** Geier Reach Sanitarium: draw happens for everyone at once; the discard is each player's own choice, queued one seat at a time (CR 701.8a, APNAP order). */
  | { readonly kind: "each-player-draws-then-discards" }
  | { readonly kind: "each-opponent-draw"; readonly amount: number | "X" }
  /** Baleful Mastery: "if the {cost} was paid, an opponent draws a card" — reads whether this cast used its own alternative cost (CR 601.2b). */
  | { readonly kind: "opponent-draws-if-cast-via-alternative-cost" }
  | { readonly kind: "discard-target-player"; readonly amount: number | "X" }
  | { readonly kind: "discard-target-player-or-planeswalker"; readonly amount: number | "X" }
  | { readonly kind: "discard-target-player-hand" }
  | { readonly kind: "discard-target-player-then-draw-same"; readonly amount: number }
  /** Curse of Chaos: the attacking player may discard one, then draws one. */
  | { readonly kind: "discard-event-controller-then-draw"; readonly amount: number }
  | { readonly kind: "draw-then-discard"; readonly draw: number; readonly discard: number }
  /** "Discard a card. If you do, draw a card" — a rummage; the controller chooses what to pitch. */
  | { readonly kind: "discard-then-draw"; readonly amount: number }
  | { readonly kind: "draw-then-put-back-on-top"; readonly draw: number; readonly putBack: number }
  | { readonly kind: "exile-self" }
  | { readonly kind: "shuffle-self-into-library" }
  | { readonly kind: "return-source-to-hand" }
  | { readonly kind: "sacrifice-source" }
  /** Each opponent of the spell caster draws, scoped to the triggering event player (Standstill). */
  | { readonly kind: "each-opponent-of-event-player-draws"; readonly amount: number }
  /** "Mill N cards" with no subject: the controller mills their own library (CR 701.13). */
  | { readonly kind: "mill"; readonly amount: number | "X" }
  | { readonly kind: "mill-target-player"; readonly amount: number | "X" }
  | { readonly kind: "mill-each-opponent"; readonly amount: number | "X" }
  | { readonly kind: "mill-each-player"; readonly amount: number | "X" }
  /** "Each opponent discards N cards": one card chosen by each opponent, in APNAP order. */
  | { readonly kind: "each-opponent-discards"; readonly amount: number | "X" }
  | { readonly kind: "gain-life"; readonly amount: number | "X" }
  /** Activated sacrifice costs may use the sacrificed creature's toughness. */
  | { readonly kind: "gain-life-equal-sacrificed-toughness" }
  | { readonly kind: "gain-life-each-controlled-type"; readonly amount: number; readonly type: CardType }
  | { readonly kind: "gain-life-each-subtype"; readonly amount: number; readonly subtype: string }
  | { readonly kind: "gain-life-each-permanent"; readonly amount: number }
  | { readonly kind: "gain-life-each-creature-you-control"; readonly amount: number }
  | { readonly kind: "gain-life-equal-target-power" }
  /** Installs Vizkopa's life-gain trigger until cleanup. */
  | { readonly kind: "grant-life-gain-opponent-loss" }
  | { readonly kind: "gain-life-equal-sacrificed-toughness" }
  | { readonly kind: "lose-life"; readonly amount: number | "X" }
  | { readonly kind: "gain-life-target-player"; readonly amount: number | "X" }
  | { readonly kind: "each-player-gains-life"; readonly amount: number | "X" }
  | { readonly kind: "sacrifice-own-creature-then-draw"; readonly amount: number }
  | { readonly kind: "return-all-your-graveyard-to-hand" }
  /** Return every creature card that entered your graveyard from the battlefield this turn. */
  | { readonly kind: "return-creatures-died-this-turn-to-hand" }
  | { readonly kind: "look-put-one-in-hand"; readonly amount: number; readonly restDestination?: "bottom" | "graveyard" }
  | { readonly kind: "undying-return"; readonly counter: "+1/+1" | "-1/-1" }
  | { readonly kind: "oblation"; readonly draw: number }
  | { readonly kind: "devotion-drain"; readonly color: string }
  | { readonly kind: "each-opponent-sacrifice-creature" }
  | { readonly kind: "syphon-mind" }
  | { readonly kind: "xathrid-upkeep"; readonly fallbackLife: number }
  | { readonly kind: "disciple-of-bolas" }
  | { readonly kind: "create-copy-token"; readonly amount: number; readonly kickedAmount?: number }
  | { readonly kind: "drain-target-toughness-pump-source-power" }
  | { readonly kind: "exile-all-attacking-creatures" }
  | { readonly kind: "tap-all-nonblue-skip-untap" }
  | { readonly kind: "destroy-all-then-reanimate-one" }
  | { readonly kind: "you-and-opponent-each"; readonly effect: SpellEffect }
  | { readonly kind: "untap-all-nonland-both" }
  | { readonly kind: "play-additional-land"; readonly amount: number }
  | { readonly kind: "tendrils-of-corruption"; readonly subtype: string }
  | { readonly kind: "bottom-attacker-controller-gains-toughness" }
  | { readonly kind: "target-player-discard-unless-land"; readonly discard: number }
  | { readonly kind: "reanimate-own-best-creature-from-graveyard" }
  | { readonly kind: "return-random-creature-from-graveyard-to-hand" }
  | { readonly kind: "modify-all-attacking-creatures"; readonly power: number; readonly toughness: number }
  | { readonly kind: "target-player-sacrifice-attacking-creature" }
  | { readonly kind: "target-player-sacrifice-creature" }
  | { readonly kind: "lose-life-target-player"; readonly amount: number | "X" }
  /** Peer into the Abyss: both halves are rounded up and computed independently at resolution (CR 107.1a). */
  | { readonly kind: "draw-half-library-then-lose-half-life-target-player" }
  /** Target loses the amount carried by the life-gain/loss event that caused this trigger. */
  | { readonly kind: "lose-life-target-event-amount" }
  | { readonly kind: "lose-life-target-player-each-controlled-type"; readonly type: CardType }
  | { readonly kind: "each-player-loses-life"; readonly amount: number | "X" }
  | { readonly kind: "each-opponent-loses-life"; readonly amount: number | "X" }
  /** Dynamic life-loss amount from a life-gained trigger event. */
  | { readonly kind: "each-opponent-loses-life-event-amount" }
  /** "that player" in a triggered ability referring back to the event's own player (e.g. the opponent who drew) — CR 603.3d, not a chosen target. */
  | { readonly kind: "lose-life-event-player"; readonly amount: number | "X" }
  /** That player's choice to put a card from hand on top after a library shuffle (CR 401.5, 701.20). */
  | { readonly kind: "put-event-player-hand-card-on-library-top" }
  /** Copy the instant or sorcery spell that caused this trigger (CR 707.10). */
  | { readonly kind: "copy-triggered-spell" }
  /** Swap a blocking source's power with the creature it blocked until combat ends (CR 701.10). */
  | { readonly kind: "exchange-source-power-with-blocking-creature" }
  | { readonly kind: "damage-event-player"; readonly amount: number | "X" }
  /** Noncombat damage to the controller of the permanent source. */
  | { readonly kind: "damage-controller"; readonly amount: number | "X" }
  | { readonly kind: "extort" }
  | { readonly kind: "damage-any-target"; readonly amount: number | "X"; readonly kickedAmount?: number | "X" }
  /** Incinerate-style damage rider that disables regeneration for the damaged creature (CR 615.1, 701.19). */
  | { readonly kind: "damage-any-target-prevents-regeneration"; readonly amount: number | "X" }
  /** Lava Coil-style damage rider that exiles the damaged creature if it would die this turn (CR 614.1). */
  | { readonly kind: "damage-any-target-exiles-if-dies"; readonly amount: number | "X" }
  /** Damage equal to the power of the creature paid for this spell's additional cost (CR 608.2h). */
  | { readonly kind: "damage-any-target-equal-sacrificed-creature-power" }
  /** Amass N (CR 701.44): put N +1/+1 counters on an Army you control, or create a 0/0 black [tokenType] Army token with them if you control none. */
  | { readonly kind: "amass"; readonly amount: number; readonly tokenType: string }
  /** Target two creatures; they deal damage equal to their power to each other (CR 701.12). */
  | { readonly kind: "fight" }
  /** Reveals each player's top card and stores the total mana value for the source spell's entry counters. */
  | { readonly kind: "reveal-top-cards-and-add-source-counters" }
  /** Damage equal to the power of the creature that caused this trigger. */
  | { readonly kind: "damage-triggered-creature-power" }
  /** Curse of Predation: put a counter on the creature that attacked the enchanted player. */
  | { readonly kind: "add-counter-triggered-creature"; readonly counter: string; readonly amount: number }
  /** Curse of the Forsaken: the attacking creature's controller gains life. */
  | { readonly kind: "gain-life-event-controller"; readonly amount: number }
  /** Divide fixed damage among one to three targets chosen by an attack/ETB trigger. */
  | { readonly kind: "damage-divided-targets"; readonly amount: number }
  /** Damage from the ability source equal to that source's current power. */
  | { readonly kind: "damage-source-power" }
  /** Tap a typed group as an optional trigger cost, then pump the source and damage its attacker. */
  | { readonly kind: "tap-creatures-pump-source-damage-attacker"; readonly subtype: string }
  /** Terra Ravager: +X/+0 where X is the defending player's land count. */
  | { readonly kind: "pump-source-by-defending-lands" }
  | { readonly kind: "destroy-random-target-permanent"; readonly amount: number }
  | { readonly kind: "damage-any-target-each-controlled-type"; readonly type: CardType }
  | { readonly kind: "damage-controller-equal-hand" }
  | { readonly kind: "damage-active-player-equal-hand" }
  | { readonly kind: "lose-life-each-player-equal-hand" }
  | { readonly kind: "damage-active-player-hand-minus"; readonly offset: number }
  | { readonly kind: "damage-each-opponent"; readonly amount: number | "X" }
  | { readonly kind: "damage-all-creatures"; readonly amount: number | "X"; readonly excludeSource: boolean; readonly filter?: "nonartifact" | "without-flying" | "with-flying"; readonly alsoPlaneswalkers?: boolean }
  /** Sudden Demise: damage each creature of a chosen color (CR 105.2, 609.3). */
  | { readonly kind: "damage-all-creatures-of-color"; readonly amount: number | "X"; readonly color: MagicColor | "chosen" }
  | { readonly kind: "damage-attacking-creatures"; readonly amount: number | "X"; readonly filter?: "without-flying" | "with-flying" }
  | { readonly kind: "damage-each-creature-and-player"; readonly amount: number | "X" }
  | { readonly kind: "damage-each-player"; readonly amount: number | "X" }
  | { readonly kind: "damage-nonflying-creatures-and-players"; readonly amount: number | "X" }
  | { readonly kind: "damage-flying-creatures"; readonly amount: number | "X" }
  /** Layer 7c P/T modifications which expire during cleanup (CR 613.4c, 514.2). */
  | { readonly kind: "modify-all-creatures"; readonly power: number; readonly toughness: number }
  /** War Cadence: generic mana paid per creature that blocks this turn (CR 509.1a). */
  | { readonly kind: "set-blocking-tax"; readonly amount: number | "X" }
  | { readonly kind: "target-player-sacrifice-attacking-creature" }
  | { readonly kind: "modify-all-creatures-minus-X" }
  | { readonly kind: "modify-all-creatures-per-land"; readonly power: number; readonly toughness: number; readonly subtype: string }
  | { readonly kind: "modify-target-creature-morbid"; readonly power: number; readonly toughness: number; readonly morbidPower: number; readonly morbidToughness: number }
  | { readonly kind: "modify-creatures-you-control"; readonly power: number; readonly toughness: number }
  | { readonly kind: "modify-target-creature"; readonly power: number; readonly toughness: number }
  | { readonly kind: "modify-source-creature"; readonly power: number; readonly toughness: number }
  /** "{cost}: ~ gains KEYWORD until end of turn" — a self-targeting keyword pump (CR 613). */
  | { readonly kind: "grant-source-keyword"; readonly keyword: EnforcedKeyword }
  /** Mirror Entity: set base P/T and grant every creature type until cleanup. */
  | { readonly kind: "set-creatures-you-control-base-pt-all-types"; readonly power: number | "X"; readonly toughness: number | "X" }
  /** Temporary characteristic-setting animation for artifact manlands (CR 613.6). */
  | { readonly kind: "animate-source"; readonly power: number; readonly toughness: number; readonly colors: readonly string[]; readonly subtypes: readonly string[]; readonly keywords: readonly EnforcedKeyword[]; readonly types?: readonly CardType[] }
  | { readonly kind: "modify-target-creature-per-subtype"; readonly subtype: string; readonly anywhere?: boolean }
  | { readonly kind: "add-counter-target-per-subtype"; readonly counter: string; readonly subtype: string; readonly anywhere?: boolean }
  | { readonly kind: "modify-triggered-creature"; readonly power: number; readonly toughness: number }
  /** Temporary pump based on the defending player in the triggering attack. */
  | { readonly kind: "modify-triggered-creature-by-defending-lands" }
  | { readonly kind: "modify-triggered-creature-and-grant-keyword"; readonly power: number; readonly toughness: number; readonly keyword: EnforcedKeyword }
  /** "That creature gets +X/+Y and gains KEYWORD until end of turn" (Ogre Battledriver): targets the OTHER creature named by the triggering event, not the source. */
  | { readonly kind: "modify-event-creature-and-grant-keyword"; readonly power: number; readonly toughness: number; readonly keyword: EnforcedKeyword }
  /** Graft counter transfer to the creature that caused the trigger (CR 702.58). */
  | { readonly kind: "move-counter-from-source-to-triggered-creature"; readonly counter: string }
  | { readonly kind: "grant-target-creature-keyword"; readonly keyword: EnforcedKeyword }
  | { readonly kind: "grant-permanents-you-control-keyword"; readonly keyword: EnforcedKeyword }
  /** Temporary keyword grant limited to creatures controlled by the effect's controller. */
  | { readonly kind: "grant-creatures-you-control-keyword"; readonly keyword: EnforcedKeyword }
  | { readonly kind: "overwhelming-stampede" }
  /** Craterhoof Behemoth: same trample/+X/+X grant as Overwhelming Stampede, but X is the creature count, not the greatest power. */
  | { readonly kind: "creature-count-stampede" }
  | { readonly kind: "grant-all-creatures-keyword"; readonly keyword: EnforcedKeyword }
  | { readonly kind: "modify-and-grant-target-creature"; readonly power: number; readonly toughness: number; readonly keyword: EnforcedKeyword }
  | { readonly kind: "add-counter-target-creature"; readonly counter: string; readonly amount: number }
  /** Cradle of Vitality: counters scale with the life-gain event amount. */
  | { readonly kind: "add-counter-target-creature-per-life-gained"; readonly counter: string }
  | { readonly kind: "add-counter-source"; readonly counter: string; readonly amount: number }
  | { readonly kind: "add-counter-creatures-subtype"; readonly counter: string; readonly amount: number; readonly subtype: string }
  | { readonly kind: "add-counter-creatures-you-control"; readonly counter: string; readonly amount: number }
  /** Ajani, the Greathearted: counters on creatures plus loyalty on other planeswalkers. */
  | { readonly kind: "add-counter-creatures-and-other-planeswalkers"; readonly counter: string; readonly amount: number; readonly planeswalkerAmount: number }
  | { readonly kind: "add-counter-all-creatures"; readonly counter: string; readonly amount: number | "X" }
  | { readonly kind: "remove-all-counters-target" }
  | { readonly kind: "remove-all-counters-all-and-exile-tokens" }
  | { readonly kind: "destroy-target-creature" }
  | { readonly kind: "destroy-target-creature-then-life-loss" }
  | { readonly kind: "destroy-target-creature-then-controller-token"; readonly token: TokenDefinition }
  /** Counter target spell, then its (former) controller creates N tokens (An Offer You Can't Refuse). */
  | { readonly kind: "counter-target-spell-then-controller-token"; readonly amount: number; readonly token: TokenDefinition }
  | { readonly kind: "destroy-target-permanent" }
  /** Ghost Quarter: destroy a land, then its controller may search for a basic land. */
  | { readonly kind: "destroy-target-land-search-basic" }
  /** Destroy a target artifact or creature whose mana value equals X. */
  | { readonly kind: "destroy-target-artifact-or-creature-mana-value" }
  /** Return each non-token permanent to its owner's control without changing zones. */
  | { readonly kind: "return-owned-nontoken-permanents-to-control" }
  /** Return each non-token creature to its owner's control without changing zones. */
  | { readonly kind: "return-owned-creatures-to-control" }
  /** Gives the source to a deterministic random opponent at the start of its controller's end step. */
  | { readonly kind: "gain-control-of-source-random-opponent" }
  /** Return each non-token permanent to its owner's control without changing zones. */
  | { readonly kind: "return-owned-nontoken-permanents-to-control" }
  /** Destroy one random permanent from an already-selected target group. */
  | { readonly kind: "destroy-random-target-permanent"; readonly amount: number }
  /** Return every permanent of a chosen color to its owner's hand (CR 701.19). */
  | { readonly kind: "return-all-permanents-of-color"; readonly color: MagicColor | "chosen" }
  | { readonly kind: "chaos-warp" }
  /** Creates one destruction-replacement shield for the source permanent (CR 701.19). */
  | { readonly kind: "regenerate-source" }
  /** Creates one destruction-replacement shield for the targeted creature (CR 701.19). */
  | { readonly kind: "regenerate-target-creature" }
  | { readonly kind: "destroy-all-artifacts-creatures-enchantments" }
  /** Destroy artifact/enchantment permanents, then count the ones destroyed. */
  | { readonly kind: "destroy-all-artifacts-enchantments-add-counters"; readonly counter: string }
  | { readonly kind: "exile-target-permanent"; readonly gainSourceControl?: "target-controller" }
  /** Exile a permanent now and return it under its owner's control next end step. */
  | { readonly kind: "exile-target-permanent-delayed-return" }
  /** Resolves a delayed return created by the previous effect. */
  | { readonly kind: "return-delayed-permanent" }
  | { readonly kind: "exile-target-nontoken-creature"; readonly returnOnSourceLeave?: boolean }
  /** Return the card linked by a Fiend Hunter-style exile ability (CR 607.1). */
  | { readonly kind: "return-exiled-card" }
  /** Exile a controlled creature, then return it under its controller's control (CR 400.7). */
  | { readonly kind: "blink-target-creature" }
  | { readonly kind: "exile-target-graveyard" }
  | { readonly kind: "return-target-creature" }
  | { readonly kind: "return-target-permanent" }
  | { readonly kind: "put-target-creature-on-library-top" }
  | { readonly kind: "put-target-nonland-permanent-under-top"; readonly count: number | "X" }
  | { readonly kind: "return-target-land" }
  | { readonly kind: "return-target-card-from-graveyard" }
  | { readonly kind: "return-target-artifact-and-gain-mana-value" }
  /** Return N random instant/sorcery cards from your graveyard to hand. */
  | { readonly kind: "return-random-instant-or-sorcery-from-graveyard"; readonly amount: number }
  | { readonly kind: "return-target-creature-card-from-graveyard-to-battlefield" }
  /** Reanimate: put target creature card from any graveyard onto the battlefield under your control, then you lose life equal to its mana value. */
  | { readonly kind: "reanimate-target-creature-lose-mana-value-life" }
  | { readonly kind: "return-target-creature-card-from-graveyard-threshold"; readonly threshold: number }
  | { readonly kind: "return-target-legendary-creature-card-from-graveyard-to-battlefield" }
  | { readonly kind: "return-target-permanent-card-from-graveyard-to-battlefield" }
  | { readonly kind: "return-target-land-card-from-graveyard-to-battlefield" }
  | { readonly kind: "return-target-artifact-card-from-graveyard-to-battlefield" }
  | { readonly kind: "return-target-enchantment-card-from-graveyard-to-battlefield" }
  | { readonly kind: "exile-target-card-from-graveyard" }
  | { readonly kind: "exile-target-permanent-card-from-graveyard" }
  | { readonly kind: "return-target-card-to-library-top" }
  | { readonly kind: "return-target-card-to-library-bottom" }
  | { readonly kind: "shuffle-target-card-into-library" }
  /** Replaces a resolving spell's normal graveyard destination (CR 701.19). */
  | { readonly kind: "shuffle-source-into-library" }
  | { readonly kind: "untap-equipped-creature" }
  | { readonly kind: "untap-all-other-creatures-you-control" }
  | { readonly kind: "destroy-all-creatures"; readonly tappedOnly?: boolean; readonly flyingOnly?: boolean; readonly xThreshold?: number; readonly excludeSource?: boolean }
  /** Kirtar's Wrath: threshold chooses the token-producing replacement mode (CR 702.34, 608.2h). */
  | { readonly kind: "kirtars-wrath"; readonly threshold: number; readonly token: TokenDefinition }
  | { readonly kind: "destroy-creatures-power-greater-than-target" }
  | { readonly kind: "return-n-nonland-permanents"; readonly count: number | "X" }
  | { readonly kind: "return-n-creatures"; readonly count: number | "X" }
  | { readonly kind: "destroy-n-creatures"; readonly count: number | "X"; readonly nonblack?: boolean; readonly counter?: string }
  | { readonly kind: "tap-all-creatures-target-player" }
  | { readonly kind: "destroy-all-creatures-draw-destroyed" }
  | { readonly kind: "counter-target-spell" }
  /** "Target spell can't be countered" (Vexing Shusher): tags the targeted stack object, mirroring the cast-time StackObject.cantBeCountered flag. */
  | { readonly kind: "make-target-spell-uncounterable" }
  /** Daze: the targeted spell's own controller decides whether to pay (CR 601.2b, 603.3, 118.9). */
  | { readonly kind: "counter-target-spell-unless-pay"; readonly cost: ManaCost }
  | { readonly kind: "counter-target-spell-to-battlefield" }
  /** Counter a spell and schedule the Arcane Denial-style upkeep draws (CR 603.7). */
  | { readonly kind: "counter-target-spell-with-delayed-draw"; readonly targetAmount: number; readonly casterAmount: number }
  /** "Draw a card at the beginning of the next turn's upkeep" — a cantrip rider (Barbed Sextant, Lightning Blow). CR 603.7. */
  | { readonly kind: "delayed-draw"; readonly amount: number }
  /** Mana Drain: paired with the separate "Counter target spell" sentence, reads the same shared target at resolution (CR 603.7, 605.3a). */
  | { readonly kind: "delayed-mana-equal-to-target-spell-mana-value"; readonly manaType: ManaType }
  /** Resolves a level-up activation by adding one level counter (CR 702.87). */
  | { readonly kind: "level-up" }
  /** Resolves a Class's level-up activation by setting its level directly (CR 702.134). */
  | { readonly kind: "class-level-up"; readonly to: number }
  /** Prepared (new mechanic, Naktamun Lorespinner // Wheel of Fortune): marks the source permanent prepared. */
  | { readonly kind: "become-prepared" }
  | { readonly kind: "tap-target-permanent" }
  /** Taps a creature and suppresses its controller's untap while the source is controlled. */
  | { readonly kind: "tap-target-creature-and-lock" }
  /** Tidal Force-style choice to tap or untap the selected permanent (CR 701.21). */
  | { readonly kind: "tap-or-untap-target-permanent" }
  | { readonly kind: "target-cant-block" }
  /** "Your opponents can't cast spells this turn." (Silence, CR 116.3). */
  | { readonly kind: "opponents-cant-cast-spells-this-turn" }
  | { readonly kind: "add-mana"; readonly pool: Readonly<Record<string, number>> }
  /** "Add one mana of any color" as a one-shot resolution, not a mana ability (Lotus Cobra's Landfall): the color is chosen when the effect resolves. */
  | { readonly kind: "add-mana-any-color" }
  | { readonly kind: "karoo-bounce"; readonly subtype: string }
  /** "Flip a coin. If you lose the flip, ~ deals N damage to you" (Mana Crypt's upkeep trigger). */
  | { readonly kind: "coin-flip-self-damage-if-lost"; readonly amount: number }
  | { readonly kind: "untap-target-permanent" }
  | { readonly kind: "untap-source" }
  | { readonly kind: "attach-equipment" }
  | { readonly kind: "create-token"; readonly amount: number | "X" | "mana-spent" | "lands-you-control" | "creatures-you-control" | "creatures-on-battlefield" | "equipment-attached-to-source" | "creatures-died-this-turn" | "opponents-with-4-plus-cards"; readonly token: TokenDefinition; readonly statsFromAmount?: boolean }
  | { readonly kind: "create-token-for-target-player"; readonly amount: number | "X"; readonly token: TokenDefinition; readonly statsFromAmount?: boolean }
  /** Reveals one library card, moves it to hand, then gains its mana value. */
  | { readonly kind: "reveal-top-card-to-hand-and-gain-mana-value" }
  /** Reveals until a card type is found, then sends the rest to a zone. */
  | { readonly kind: "reveal-until-type-to-hand"; readonly type: CardType; readonly restDestination: "graveyard" }
  /** Reveals through the first nonland, then moves every revealed card to hand. */
  | { readonly kind: "reveal-until-nonland-to-hand" }
  | { readonly kind: "reveal-top-card-conditional"; readonly creatureToken: TokenDefinition; readonly landDestination: "battlefield"; readonly fallbackLife: number }
  | { readonly kind: "reveal-top-card-land-or-hand" }
  | {
      readonly kind: "search-library";
      readonly types: readonly CardType[];
      readonly subtypes?: readonly string[];
      /** "a green creature card" (Natural Order): restricts by color, not just type/subtype. */
      readonly colors?: readonly string[];
      /** "...card with mana value X or less" (Green Sun's Zenith): X is the spell's own paid {X}. */
      readonly maxManaValue?: "X";
      readonly destination: "top" | "hand" | "graveyard" | "battlefield";
      /** Ramp templates put the found land onto the battlefield tapped. */
      readonly tapped?: boolean;
      readonly reveal: boolean;
      readonly count?: number;
    }
  | {
      readonly kind: "search-library-multi";
      readonly types: readonly CardType[];
      readonly subtypes?: readonly string[];
      readonly destinations: readonly ("hand" | "battlefield-tapped")[];
      readonly reveal: boolean;
    }
  /** Partner with <name> (CR 702.124f): a deterministic, name-exact search — no candidate choice, unlike `search-library`. */
  | { readonly kind: "partner-with-search"; readonly cardName: string }
  /** Swords to Plowshares: power is captured before the creature leaves the battlefield (last known information, CR 613.7a). */
  | { readonly kind: "exile-target-creature-then-life-gain-power" };

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
  | "deals-damage-to-player"
  | "becomes-tapped"
  | "spell-cast"
  | "card-cycled"
  | "card-drawn"
  | "card-discarded"
  | "library-shuffled"
  | "upkeep"
  | "draw-step"
  | "end-step"
  /** Modeled as precombat main beginning (CR 505.1a); this project has no "additional main phase" effects, so the two coincide for every card in scope. */
  | "first-main-phase"
  | "leaves-battlefield"
  | "life-gained"
  | "life-lost"
  | "class-level-up"
  /** The action of playing a land (CR 305.1), distinct from that land's own "enters the battlefield" event (City of Traitors). */
  | "play-land"
  /** Specifically a mana ability's activation (Forbidden Orchard), narrower than the general "becomes-tapped" (a non-mana tap effect must not trigger this). */
  | "taps-for-mana";

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
  | "creature-with-deathtouch-you-control"
  | "another-permanent-you-control"
  | "permanent-you-control"
  | "land-you-control"
  | "artifact-you-control"
  | "enchantment-you-control"
  | "another-creature"
  | "self-or-another-creature-you-control"
  | "any-creature"
  | "equipped-creature"
  | "creature-attacks-opponent"
  | "creature-attacks-enchanted-player"
  | "player-attacks-enchanted-player"
  | "you"
  | "each-player"
  | "opponent"
  /** The player whose spell or ability caused a library shuffle. */
  | "shuffle-controller";

export const TRIGGER_EVENT_LABELS: Readonly<Record<TriggerEvent, string>> = {
  "enters-battlefield": "habilidad de entrada",
  dies: "habilidad de muerte",
  attacks: "habilidad de ataque",
  blocks: "habilidad de bloqueo",
  "deals-combat-damage-to-player": "habilidad de daño de combate",
  "deals-damage-to-player": "habilidad de daño a un jugador",
  "becomes-tapped": "habilidad de giro",
  "spell-cast": "habilidad de lanzamiento",
  "card-cycled": "habilidad de cycling",
  "card-drawn": "habilidad de robo",
  "card-discarded": "habilidad de descarte",
  "library-shuffled": "library-shuffle trigger",
  upkeep: "habilidad de mantenimiento",
  "draw-step": "habilidad del paso de robo",
  "end-step": "habilidad del paso final",
  "leaves-battlefield": "habilidad de salida del campo de batalla",
  "life-gained": "life-gain trigger",
  "life-lost": "life-loss trigger",
  "class-level-up": "habilidad de nivel de Clase",
  "first-main-phase": "habilidad de la primera fase principal",
  "play-land": "habilidad de jugar una tierra",
  "taps-for-mana": "habilidad de girar por maná"
};

/** A triggered ability whose source is already on the battlefield. */
export interface TriggerDefinition {
  readonly event: TriggerEvent;
  readonly subject: TriggerSubject;
  readonly effect: SpellEffect;
  readonly optional: boolean;
  /**
   * "Choose one or more" for a triggered ability (Black Market Connections):
   * every legal non-empty mode subset, precomputed the same way a spell's
   * "Choose N or more" modal choices are, but resolved as a choice made when
   * the ability is put on the stack (CR 603.3d) rather than at cast time.
   */
  readonly modalEffects?: readonly {
    readonly text: string;
    readonly effect: SpellEffect;
    readonly targetKind?: TargetKind;
    readonly targetKinds?: readonly Exclude<TargetKind, "none">[];
  }[];
  /**
   * What the ability targets. Targets for a trigger are chosen when it is put
   * onto the stack (CR 603.3d), never when the source is cast, so this is kept
   * apart from the card-level `targetKind` used by spells.
   */
  readonly targetKind: TargetKind;
  /** Ordered target slots for multi-target triggered abilities. */
  readonly targetKinds?: readonly Exclude<TargetKind, "none">[];
  /** Minimum number of targets required when `targetKinds` has optional slots. */
  readonly minimumTargets?: number;
  readonly sourceText: string;
  /** Mana that must be paid when an optional trigger is accepted. */
 readonly manaCost?: ManaCost;
  /** Maximum value for an optional `{X}` cost, derived from the triggering event. */
  readonly variablePayCost?: "event-amount";
  /** For "unless that player pays", the opponent is the payer and the trigger controller receives the effect if they decline. */
  readonly paymentBy?: "opponent";
  /**
   * Who makes the ability's optional "may" choice, when it isn't the trigger's
   * controller: the event object's controller ("event-controller"), or the
   * ability's own chosen target ("target" — CR 603.3d: targets are already
   * fixed by the time the ability resolves, e.g. "target player may ...").
   */
  readonly choiceBy?: "event-controller" | "target";
  /** Maximum cards for a delayed/up-to draw trigger; the player chooses 0..N on resolution. */
  readonly drawUpTo?: number;
  readonly condition?:
    | { readonly kind: "no-controlled-subtype"; readonly subtype: string }
    | { readonly kind: "controlled-creature-power-at-least"; readonly amount: number }
    | { readonly kind: "controlled-subtype-at-least"; readonly subtype: string; readonly amount: number }
    | { readonly kind: "entering-power-at-least"; readonly amount: number }
    | { readonly kind: "creature-died-this-turn" }
    | { readonly kind: "cast-from-hand" }
    | { readonly kind: "attacking-alone" }
    /** "draws their second card each turn" (Krang, Faerie Mastermind): gated on the per-turn draw count, not just any draw. */
    | { readonly kind: "second-draw-this-turn" }
    /** "if ~ is untapped" (Howling Mine): checks the source permanent's own tapped state. */
    | { readonly kind: "source-untapped" }
    /** "if ~ is tapped" (Mana Vault): the inverse check on the source permanent's own tapped state. */
    | { readonly kind: "source-tapped" }
    /** "except the first [card] they draw in each of their draw steps" (Orcish Bowmasters): suppressed only for the player's first draw during an actual draw step; any draw outside a draw step always counts. */
    | { readonly kind: "not-first-draw-step-draw" }
    /** "When this Class becomes level N" (CR 702.134): fires only for the transition that reaches exactly this level. */
    | { readonly kind: "class-level-reached"; readonly level: number }
    /** "If a player has N or fewer cards in hand" (Naktamun Lorespinner's Prepared trigger): true if ANY player qualifies. */
    | { readonly kind: "any-player-hand-at-most"; readonly amount: number }
    | { readonly kind: "entering-power-at-most"; readonly amount: number }
    /** Commander-only trigger that functions while the source remains in the command zone. */
    | { readonly kind: "source-in-command-zone" };
  /** A Class's second/third-tier ability, inactive until the source reaches this level (CR 702.134d). */
  readonly minClassLevel?: number;
  readonly spellType?: "creature" | "noncreature" | "instant-or-sorcery";
  readonly spellColor?: string;
  readonly spellSubtype?: string;
  readonly nontoken?: boolean;
  readonly excludeSubtype?: string;
  /** Tribal filter on the event object itself (Atarka, World Render's "a Dragon you control attacks"), distinct from a board-count condition. */
  readonly requireSubtype?: string;
  /** Filters a card-discarded event by the discarded card's own type (Waste Not). */
  readonly discardedCardType?: "creature" | "land" | "noncreature-nonland";
  /** "if it was kicked" gate on an enters trigger (CR 702.33e, 603.4). */
  readonly requiresKicked?: boolean;
  /** "sacrifice it unless {U} was spent to cast it" gate (CR 603.4). */
  readonly requiresManaTypeNotSpent?: ManaType;
  /** "if its evoke cost was paid" gate on the sacrifice trigger (CR 702.34c). */
  readonly requiresEvoked?: boolean;
  /** Optional mana cost to get the effect ("you may pay {cost}. If you do, ..."). */
  readonly payCost?: ManaCost;
  /** Optional tap cost paid by choosing and tapping a group of permanents. */
  readonly tapCost?: { readonly amount: number | "any"; readonly subtype?: string; readonly mode: "any" | "another" };
  /** For "sacrifice ~ unless you pay {cost}", declining the payment applies the effect. */
  readonly unlessPayCost?: ManaCost;
  /** Trigger target selection excludes the source permanent ("another"). */
  readonly excludesSourceFromTargets?: boolean;
}

export type MagicColor = "W" | "U" | "B" | "R" | "G";

export type TargetKind =
  | `spell-mana-value-${number}`
  | `artifact-or-creature-mana-value-${number}`
  | "any" | "player" | "opponent" | "creature" | "spell" | "creature-spell" | "noncreature-spell" | "instant-or-sorcery-spell" | "permanent" | "artifact-or-enchantment" | "artifact-or-creature" | "creature-or-enchantment" | "black-or-red-permanent"
  | "artifact-creature-or-planeswalker" | "creature-or-planeswalker" | "artifact-enchantment-or-land" | "player-or-planeswalker" | "artifact" | "nonland" | "nonartifact-creature"
  | "enchantment" | "land" | "permanent-you-control" | "permanent-opponent"
  | "nonblack-creature" | "nonartifact-nonblack-creature" | "non-demon-creature" | "creature-with-flying" | "creature-you-control" | "creature-opponent" | "nonbasic-land" | "noncreature-permanent" | "land-you-control" | "nonland-you-control" | "nonland-opponent"
  | "attacking-or-blocking-creature" | "attacking-creature" | "blocked-creature"
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
  | "creature-with-reach"
  | "card-in-your-graveyard" | "card-in-a-graveyard" | "creature-card-in-your-graveyard" | "creature-card-in-a-graveyard" | "artifact-card-in-your-graveyard" | "artifact-card-in-a-graveyard" | "enchantment-card-in-your-graveyard" | "enchantment-card-in-a-graveyard" | "land-card-in-your-graveyard" | "land-card-in-a-graveyard" | "permanent-card-in-your-graveyard" | "permanent-card-in-a-graveyard" | "legendary-creature-card-in-your-graveyard" | "instant-or-sorcery-card-in-your-graveyard" | "permanent-card-in-your-graveyard-mv-3-or-less" | `subtype:${string}` | "none" | "nontoken-creature"
  | "card-in-your-graveyard" | "card-in-a-graveyard" | "creature-card-in-your-graveyard" | "creature-card-in-a-graveyard" | "artifact-card-in-your-graveyard" | "artifact-card-in-a-graveyard" | "enchantment-card-in-your-graveyard" | "enchantment-card-in-a-graveyard" | "land-card-in-a-graveyard" | "permanent-card-in-your-graveyard" | "permanent-card-in-a-graveyard" | "legendary-creature-card-in-your-graveyard" | `subtype:${string}` | "none";
  

export interface CardProfile {
  /** Unconditional self prohibition; targeting remains legal (CR 101.2). */
  readonly cantBeCountered: boolean;
  /** Static protection for controlled creature spells meeting a power threshold. */
  readonly uncounterableCreaturePowerThreshold: number | null;
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
  /** Static effect that lets creatures' activated abilities ignore summoning sickness (CR 302.6). */
  readonly grantsCreatureActivationHaste: boolean;
  /** Changeling means this creature has every creature type (CR 702.73). */
  readonly changeling: boolean;
  readonly power: number | null;
  readonly toughness: number | null;
  readonly loyalty: number | null;
  readonly manaAbilities: readonly ManaAbility[];
  /** Generic cycling from hand. */
  readonly cyclingCost: ManaCost | null;
  readonly cyclingSearches: readonly CyclingSearchAbility[];
  /** Echo cost paid at the controller's next upkeep (CR 702.30). */
  readonly echoCost: ManaCost | null;
  /** Alternative cost for casting this instant or sorcery from a graveyard (CR 702.34). */
  readonly flashbackCost: ManaCost | null;
  /** Additional life payment bundled into a Flashback cost (CR 118.8). */
  readonly flashbackLifeCost: number;
  /** Additional life payment required when casting this spell (CR 118.8). */
  readonly additionalLifeCost: number;
  /** Whether the additional life payment scales with the spell's X value. */
  readonly additionalLifeCostVariable: boolean;
  /** The printed Equip cost, when this permanent is an Equipment. */
  readonly equipCost: ManaCost | null;
  /** A second, typically cheaper Equip cost restricted to a creature subtype (Wizard's Staff's "Equip Wizard {1}"). */
  readonly typedEquipCost: { readonly subtype: string; readonly cost: ManaCost } | null;
  /** "Equip worthy {cost}" (Mjölnir): Equip restricted to a legendary, non-Villain creature that's red and/or white. */
  readonly equipWorthyCost: ManaCost | null;
  readonly equipmentModification: EquipmentModification | null;
  /** Static bonuses an Aura grants the permanent it's attached to (CR 303.4.5), e.g. "Enchanted creature gets +2/+2." */
  readonly auraModification: EquipmentModification | null;
  /** Fixed mana added when the enchanted land is tapped for mana (CR 303.4, 605.1a). */
  readonly auraLandManaBonus: { readonly mana: ManaType; readonly amount: number } | null;
  /** Permanent type continuously controlled by an Aura, e.g. "You control enchanted creature." (CR 611.3, 613.7). */
  readonly auraControlTarget: "creature" | "land" | "permanent" | null;
  /** Activated ability granted by an attached Aura (CR 303.4, 605.1a). */
  readonly auraActivatedAbility: ActivatedAbility | null;
  readonly staticKeywordGrants: readonly StaticKeywordGrant[];
  readonly staticManaAbilityGrants: readonly StaticManaAbilityGrant[];
  /** "~ has flying during your turn" (Razorkin Needlehead): self-only, active-player-gated. */
  readonly keywordsDuringYourTurn: readonly EnforcedKeyword[];
  /** Colors of creatures this permanent untaps during each other player's untap step (CR 502.2). */
  readonly untapColorsDuringOtherPlayersUntap: readonly string[];
  readonly triggerDoublers: readonly TriggerDoubler[];
  readonly preventsLifeGain: boolean;
  readonly noMaximumHandSize: boolean;
  readonly noMaximumHandSizeForAllPlayers: boolean;
  readonly locksOpponentsOnYourTurn: boolean;
  readonly grantsExtortToOthers: boolean;
  readonly attackersAssignAsUnblockedWhileAttacking: boolean;
  readonly preventsOpponentLoss: boolean;
  readonly forcesAllCreaturesToAttack: boolean;
  /** Torbran-style static damage amplifier (CR 614.1c): "If a [color] source you control would deal damage to X, it deals that much damage plus N instead." */
  readonly damageAmplify: DamageAmplify | null;
 readonly staticPowerToughnessGrants: readonly StaticPowerToughnessGrant[];
  /** Whether the permanent copies the power/toughness of its exiled imprint. */
  readonly copiesImprintedCreatureStats: boolean;
  /** Static replacement effect that adds one mana when a controlled land produces mana. */
  readonly doublesLandMana: boolean;
  /** Printed Level up cost and level bands, when present. */
  readonly levelUpCost: ManaCost | null;
  readonly levelDefinitions: readonly LevelDefinition[];
  /** A Class's printed "{cost}: Level N" lines, in order (CR 702.134). */
  readonly classLevels: readonly { readonly level: number; readonly cost: ManaCost }[];
  /** Color qualities named by a Protection line (CR 702.16). */
  readonly protectionFrom: readonly string[];
  readonly activatedAbilities: readonly ActivatedAbility[];
  readonly modalChoices: readonly ModalChoice[];
  readonly effects: readonly SpellEffect[];
  readonly triggers: readonly TriggerDefinition[];
  readonly targetKind: TargetKind;
  /** Ordered target requirements for non-modal spells with multiple targets. */
  readonly targetKinds?: readonly Exclude<TargetKind, "none">[];
  readonly kickerCost: ManaCost | null;
  /** Entwine additional cost for selecting every modal branch (CR 702.42). */
  readonly entwineCost: ManaCost | null;
  readonly kickedEffects: readonly SpellEffect[];
  /** "If ~ was kicked, it enters with N <kind> counters on it" — applied only on a kicked cast. */
  readonly kickedEntersWithCounters: readonly CounterCost[];
  /** Keywords granted only when the spell is kicked (CR 702.33e). */
  readonly kickedKeywords: readonly EnforcedKeyword[];
  /** Evoke alternative cost (CR 702.34), null when absent. */
  readonly evokeCost: ManaCost | null;
  /** Miracle alternative cost (CR 702.93), offered only right after being drawn as the first card that turn. */
  readonly miracleCost: ManaCost | null;
  /** Prepared (new mechanic): the back face's spell, castable as a copy while this permanent is prepared. */
  readonly preparedCast: { readonly cost: ManaCost; readonly effect: SpellEffect; readonly targetKind: TargetKind; readonly spellName: string; readonly spellTypeLine: string } | null;
  /** "~ enters prepared" (Prepared mechanic): already prepared the moment it enters the battlefield. */
  readonly entersPrepared: boolean;
  /** "You may play N additional land(s) on each of your turns" (Exploration, Azusa, CR 305.2). */
  readonly extraLandDropsPerTurn: number;
  /** "You may play lands from the top of your library" (Oracle of Mul Daya, CR 305.1). */
  readonly playLandsFromTopOfLibrary: boolean;
  /** "Play with the top card of your library revealed" (Oracle of Mul Daya): public information, not merely visible to its controller. */
  readonly revealsTopOfLibrary: boolean;
  /** "As an additional cost to cast ~, exile X cards from your graveyard" (Skeletal Scrying, CR 601.2b). */
  readonly additionalCostExileGraveyardX: boolean;
  /** Rebound (CR 702.88): if cast from hand, exile on resolution and offer a free recast next upkeep. */
  readonly hasRebound: boolean;
  /** "As an additional cost to cast ~, sacrifice a land" (Harrow, CR 601.2b). */
  readonly additionalCostSacrificeLand: boolean;
  /** "As an additional cost to cast ~, sacrifice a creature" (Diabolic Intent, CR 601.2b). */
  readonly additionalCostSacrificeCreature: boolean;
  /** "As an additional cost to cast ~, sacrifice a green creature" (Natural Order, CR 601.2b): the color-restricted sibling. */
  readonly additionalCostSacrificeCreatureColor: string | null;
  /** "If you control a commander, you may cast ~ without paying its mana cost" (Deadly Rollick, CR 601.2b, 118.9). */
  readonly freeCastIfCommander: boolean;
  /** "If you control a [land type], you may pay N life rather than pay ~'s mana cost" (Snuff Out, CR 601.2b, 118.9). */
  readonly payLifeInsteadOfManaCost: { readonly life: number; readonly controlLandType: string } | null;
  /** "You may return a [land type] you control to its owner's hand rather than pay ~'s mana cost" (Daze, CR 601.2b, 118.9). */
  readonly returnLandInsteadOfManaCost: { readonly subtype: string } | null;
  /** "You may pay {cost} rather than pay ~'s mana cost" (Baleful Mastery, CR 601.2b, 118.9). */
  readonly payReducedCostInstead: ManaCost | null;
  /** "Gift a card" (CR 702.166): promising the gift while casting draws an opponent a card before other effects. */
  readonly giftDrawsCard: boolean;
  /** "If the gift was promised, instead [wider target]" — the printed effect stays the same; only the legal target set widens. */
  readonly giftPromisedTargetKind: Exclude<TargetKind, "none"> | null;
  /** "Creatures can't attack you unless their controller pays {N} for each creature they control that's attacking you" (Propaganda, CR 508.1a). Generic-mana amount per attacking creature. */
  readonly attackTaxPerCreature: number | null;
  /** "Double all damage equipped creature would deal" (Mjölnir, Equipment CR 301.5c). */
  readonly doublesEquippedCreatureDamage: boolean;
  /** "If an opponent would draw a card except the first one they draw in each of their draw steps, instead that player skips that draw and you draw a card" (Notion Thief, CR 614/616 replacement effect). */
  readonly redirectsOpponentDrawsExceptFirst: boolean;
  /** Generic cost reduction per creature on the battlefield ("costs {N} less to cast for each creature"). */
  readonly costReducesPerBoardCreature: number;
  /** Affinity quality: reduce this spell's generic cost by one per matching permanent you control (CR 702.41, 118.9). */
  readonly affinityFor: string | null;
  /** Static spell-cost reduction grant (CR 118.9); global grants apply to every player. */
  readonly spellCostReductionGrant: {
    readonly amount: number;
    readonly color?: string;
    /** A single reduction applies to any matching color in this union. */
    readonly colors?: readonly string[];
    readonly type?: CardType;
    readonly subtype?: string;
    readonly types?: readonly CardType[];
    readonly appliesToAllPlayers?: boolean;
  } | null;
  /** "<Basic type>s you control produce an additional {C}" (Crypt Ghast, CR 605). */
  readonly staticLandManaBonus: { readonly subtype: string; readonly mana: string } | null;
  /** Characteristic-defining P/T "equal to the number of X you control" (CR 604.3). */
  readonly cdaPowerToughness: "creatures-you-control" | "lands-you-control" | "artifacts-you-control" | "green-permanents-you-control" | "your-life-total" | "cards-in-your-hand" | null;
  /** Lieutenant (Commander 2014): commander-conditional static bonuses. */
  readonly lieutenant: {
    readonly selfPower: number;
    readonly selfToughness: number;
    readonly otherPower: number;
    readonly otherToughness: number;
    readonly otherKeywords: readonly EnforcedKeyword[];
  } | null;
  readonly entersTapped: EntersTappedRule;
  /** Static replacement rule that keeps this permanent tapped during untap. */
  readonly doesNotUntapDuringUntap: boolean;
  /** Printed attack/block restrictions and landwalk evasion. */
  readonly combatRules: CombatRules;
  /** Counters with which this permanent enters the battlefield. */
  readonly entersWithCounters: readonly CounterCost[];
  /** "~ enters with X <kind> counters on it" (Walking Ballista, Hangarback Walker): X is the value paid for the spell's own {X} in its cost. */
  readonly entersWithVariableCounters: { readonly kind: string } | null;
  /** Graft number, when this permanent has the Graft keyword. */
  readonly graftAmount: number | null;
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
  | { readonly kind: "unless-first-turns"; readonly maxTurn: number }
  | { readonly kind: "unless-pay-life"; readonly life: number }
  /** The controller may reveal a card with one of these subtypes to avoid entering tapped. */
  | { readonly kind: "unless-reveal-card"; readonly subtypes: readonly string[] };

const WORD_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, first: 1, two: 2, second: 2, three: 3, third: 3, four: 4, fourth: 4, five: 5, fifth: 5, six: 6, sixth: 6, seven: 7, seventh: 7,
  eight: 8, eighth: 8, nine: 9, ninth: 9, ten: 10, tenth: 10, eleven: 11, twelve: 12, thirteen: 13, twenty: 20
};

function toNumber(token: string | undefined): number | null {
  if (!token) return null;
  const word = WORD_NUMBERS[token.toLowerCase()];
  if (word !== undefined) return word;
  return /^\d+$/.test(token) ? Number(token) : null;
}

/**
 * Small executable IR for exact, compositional Oracle templates.
 *
 * This is intentionally narrower than the legacy recognizer: repeated
 * operation/subject/amount shapes (draw, mill, life) use one grammar while
 * dependent, modal, and multi-zone text still falls through to the explicit
 * recognizers below.  The IR is only a parser front-end; the existing
 * SpellEffect executor remains authoritative (CR 609.3, 701.5, 701.13).
 */
type SimpleEffectIROperation = "draw" | "mill" | "discard" | "gain-life" | "lose-life";
type SimpleEffectIRSubject = "you" | "target-player" | "each-player" | "each-opponent";
interface SimpleEffectIR {
  readonly operation: SimpleEffectIROperation;
  readonly subject: SimpleEffectIRSubject;
  readonly amount: number | "X";
}

function simpleEffectIR(text: string): SimpleEffectIR | null {
  const match = /^(?:(you|target player|each player|each opponent)\s+)?(draw|mill|discard)\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|twenty|\d+|X)\s+cards?$/i.exec(text)
    ?? /^(you|target player|each player|each opponent)\s+(gain|gains|lose|loses)\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|twenty|\d+|X)\s+life$/i.exec(text);
  if (!match) return null;

  const subjectText = (match[1] ?? "you").toLowerCase();
  const subject: SimpleEffectIRSubject = subjectText === "target player" ? "target-player"
    : subjectText === "each player" ? "each-player"
      : subjectText === "each opponent" ? "each-opponent" : "you";
  const operationText = match[2]!.toLowerCase();
  const operation: SimpleEffectIROperation = operationText === "draw" || operationText === "mill" || operationText === "discard"
    ? operationText
    : operationText.startsWith("gain") ? "gain-life" : "lose-life";
  const amount = toNumber(match[3]) ?? (match[3]!.toUpperCase() === "X" ? "X" : null);
  return amount === null ? null : { operation, subject, amount };
}

function simpleEffectFromIR(ir: SimpleEffectIR): { effect: SpellEffect; target: TargetKind } | null {
  const target = ir.subject === "target-player" ? "player" as TargetKind : "none" as TargetKind;
  if (ir.operation === "draw") {
    const kind = ir.subject === "target-player" ? "draw-target-player"
      : ir.subject === "each-player" ? "each-player-draw"
        : ir.subject === "each-opponent" ? "each-opponent-draw" : "draw";
    return { effect: { kind, amount: ir.amount } as SpellEffect, target };
  }
  if (ir.operation === "mill") {
    if (ir.subject === "you") return { effect: { kind: "mill", amount: ir.amount }, target: "none" };
    const kind = ir.subject === "target-player" ? "mill-target-player"
      : ir.subject === "each-player" ? "mill-each-player"
        : ir.subject === "each-opponent" ? "mill-each-opponent" : "mill-target-player";
    return { effect: { kind, amount: ir.amount } as SpellEffect, target };
  }
  if (ir.operation === "discard") {
    if (ir.subject === "each-opponent") return { effect: { kind: "each-opponent-discards", amount: ir.amount }, target: "none" };
    if (ir.subject !== "target-player") return null;
    return { effect: { kind: "discard-target-player", amount: ir.amount }, target: "player" };
  }
  if (ir.operation === "gain-life" && ir.subject === "each-opponent") return null;
  const kind = ir.operation === "gain-life"
    ? ir.subject === "target-player" ? "gain-life-target-player" : ir.subject === "each-player" ? "each-player-gains-life" : "gain-life"
    : ir.subject === "target-player" ? "lose-life-target-player" : ir.subject === "each-player" ? "each-player-loses-life" : ir.subject === "each-opponent" ? "each-opponent-loses-life" : "lose-life";
  return { effect: { kind, amount: ir.amount } as SpellEffect, target };
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

/**
 * Back face of a two-faced card, e.g. the sorcery half of a Prepared creature
 * (CR 702.120-ish new "Prepared" mechanic, Naktamun Lorespinner // Wheel of
 * Fortune). Distinct from `frontFace`: this is never the face cast from hand,
 * only ever "a copy of its spell" cast while prepared — so it gets its own
 * synthetic `scryfall_id` to avoid colliding with the front face's cached
 * `cardProfile` entry, which is keyed by that id.
 */
export function backFace(card: CardData): CardData | null {
  const faces = card.card_faces;
  const back = faces?.[1];
  if (!back?.oracle_text) return null;
  return {
    ...card,
    scryfall_id: `${card.scryfall_id}::back`,
    name: back.name ?? card.name,
    mana_cost: back.mana_cost ?? card.mana_cost,
    type_line: back.type_line ?? card.type_line,
    oracle_text: back.oracle_text,
    power: back.power ?? null,
    toughness: back.toughness ?? null,
    loyalty: back.loyalty ?? null,
    colors: back.colors ?? card.colors,
    card_faces: undefined
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
  // Some historical catalog imports decoded the UTF-8 em dash as U+FFFD.
  // Treat that replacement character as the same keyword-ability separator
  // used by current Oracle text; otherwise valid Landfall/Morbid lines fall
  // out of the shared trigger grammar before they reach the legacy parser.
  const raw = (card.oracle_text ?? "").replace(/\uFFFD/g, "—").replace(/\([^)]*\)/g, " ");
  const shortName = card.name.split(",")[0]!.split("//")[0]!.trim();
  const escaped = [card.name, shortName].filter(Boolean).map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  let text = raw;
  for (const pattern of escaped) text = text.replace(new RegExp(pattern, "g"), "~");
  // Older Oracle imports sometimes abbreviate a multi-word card name in its
  // self-reference (e.g. "When Sharuum enters" for Sharuum the Hegemon).
  // Only normalize the first name token when it is followed by a
  // self-referential verb, avoiding accidental changes to descriptive text.
  const firstName = card.name.trim().split(/\s+/)[0] ?? "";
  if (firstName.length >= 4) {
    const escapedFirst = firstName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`\\b${escapedFirst}(?=\\s+(?:enters|attacks|blocks|dies|gets|gains|deals|is|has|can't|doesn't|doesn’t)\\b)`, "g"), "~");
  }
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
function parseAddClause(effect: string): { produces: ManaType[]; amount: number; fixedProduces?: ManaType[]; commanderIdentity?: boolean } | null {
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
    return amount ? { produces: [...MANA_COLORS], amount, commanderIdentity: true } : null;
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

function parseManaInstruction(effect: string): { produced: ReturnType<typeof parseAddClause>; gainLife?: number; requiresLands?: number; painDamage?: number; activationRestriction?: { enteredThisTurn: boolean; orControlsBasicLand?: boolean }; commanderEntryCounters?: boolean } | null {
  let remainder = effect.trim().replace(/\.$/, "");
  let gainLife: number | undefined;
  let requiresLands: number | undefined;
  let painDamage: number | undefined;
  let activationRestriction: { enteredThisTurn: boolean; orControlsBasicLand?: boolean } | undefined;
  let commanderEntryCounters = false;
  const commanderEntry = /\.\s*If you spend this mana to cast your commander, it enters with a number of additional \+1\/\+1 counters on it equal to the number of times it's been cast from the command zone this game$/i.exec(remainder);
  if (commanderEntry) {
    commanderEntryCounters = true;
    remainder = remainder.slice(0, commanderEntry.index).trim();
  }
  const gain = /\.\s*You gain (\w+) life$/i.exec(remainder);
  if (gain) {
    const amount = toNumber(gain[1]);
    if (amount === null) return null;
    gainLife = amount;
    remainder = remainder.slice(0, gain.index).trim();
  }
  // "Pain lands" (Shivan Reef, Talisman of X): the tap-for-colored-mana half
  // automatically deals damage to the controller, distinct from an
  // activation cost paid up front (CR 605.1a, e.g. Karplusan Forest's own
  // "Pay 1 life:" wording, already handled via the activation cost text).
  const pain = /\.\s*~\s+deals\s+(\w+)\s+damage\s+to\s+you$/i.exec(remainder);
  if (pain) {
    const amount = toNumber(pain[1]);
    if (amount === null) return null;
    painDamage = amount;
    remainder = remainder.slice(0, pain.index).trim();
  }
  const restriction = /\.\s*Activate only if you control (\w+) or more lands$/i.exec(remainder);
  if (restriction) {
    const amount = toNumber(restriction[1]);
    if (amount === null) return null;
    requiresLands = amount;
    remainder = remainder.slice(0, restriction.index).trim();
  }
  // "Activate only if ~ entered the battlefield this turn (or if you control
  // a basic land)" (Hidden Lair, Mirrex): a fast-mana check gating the
  // colored half of a two-ability land, not present on the {C} half.
  const enteredRestriction = /\.\s*Activate only if ~ entered(?: the battlefield)? this turn(\s*or\s*if\s+you\s+control\s+a\s+basic\s+land)?$/i.exec(remainder);
  if (enteredRestriction) {
    activationRestriction = { enteredThisTurn: true, ...(enteredRestriction[1] ? { orControlsBasicLand: true } : {}) };
    remainder = remainder.slice(0, enteredRestriction.index).trim();
  }
  const produced = parseAddClause(remainder);
  return produced
    ? {
      produced,
      ...(gainLife === undefined ? {} : { gainLife }),
      ...(requiresLands === undefined ? {} : { requiresLands }),
      ...(painDamage === undefined ? {} : { painDamage }),
      ...(activationRestriction === undefined ? {} : { activationRestriction }),
      ...(commanderEntryCounters ? { commanderEntryCounters: true } : {})
    }
    : null;
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
    // Modern Oracle uses either the printed name, `~`, or `this card` here.
    // All three mean the same hand-based mana ability (CR 605.1a); do not let
    // a wording variant make a fast-mana card look like a normal cast only.
    const escapedSelfNames = [card.name, card.name.split(",")[0] ?? ""]
      .filter(Boolean)
      .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const exilesSelfFromHand = new RegExp(
      `^exile\\s+(?:~|this\\s+card|${escapedSelfNames.join("|")})\\s+from\\s+your\\s+hand$`,
      "i"
    ).test(costText.trim());
    const variableSacrifice = /^(?:\{T\},\s*)?sacrifice\s+X\s+([A-Za-z][A-Za-z'’-]*)s?$/i.exec(costText.trim().replace(/,\s*$/, ""));
    if (variableSacrifice && /^add\s+X\s+mana\s+of\s+any\s+(?:one\s+)?color\.?\s*You gain X life\.?$/i.test(effectText.trim())) {
      abilities.push({
        index: abilities.length, produces: [...MANA_COLORS], amount: 0, requiresTap, lifeCost: 0,
        sacrificesCreatures: { amount: "X", subtype: variableSacrifice[1]!.replace(/s$/i, "") },
        amountFromSacrifice: true, gainLifeFromAmount: true, text: line.trim()
      });
      continue;
    }
    const variableStorage = /^add\s+X\s+mana\s+in\s+any\s+combination\s+of\s+(\{[WUBRGC]\})(?:\s+and\/or\s+(\{[WUBRGC]\}))?\.?$/i.exec(effectText.trim());
    if (variableStorage && /remove\s+X\s+storage\s+counters\s+from\s+(?:~|this\s+(?:land|permanent))/i.test(costText)) {
      const manaSymbols = costText.match(/\{[^}]+\}/g) ?? [];
      const manaCost = manaSymbols.length ? parseManaCost(manaSymbols.join("")) : null;
      const leftovers = costText
        .replace(/\{[^}]+\}/g, "")
        .replace(/remove\s+X\s+storage\s+counters\s+from\s+(?:~|this\s+(?:land|permanent))/i, "")
        .replace(/[，,\s]/g, "");
      const colors = [variableStorage[1], variableStorage[2]].filter((symbol): symbol is string => Boolean(symbol)).map((symbol) => symbol.slice(1, -1).toUpperCase() as ManaType);
      if (!leftovers.length && manaCost && !manaCost.hasVariable && colors.length) {
        abilities.push({ index: abilities.length, produces: colors, amount: 0, manaCost, variableAmountCounter: "storage", requiresTap: false, lifeCost: 0, text: line.trim() });
        continue;
      }
    }
    const lifeMatch = /pay\s+(\d+)\s+life/i.exec(costText);
    const lifeCost = lifeMatch ? Number(lifeMatch[1]) : 0;
    const counterMatch = /remove\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+([+\-\w/ ]+?)\s+counters?\s+from\s+~/i.exec(costText);
    const counterAmount = counterMatch ? toNumber(counterMatch[0].match(/remove\s+(\w+)/i)?.[1]) : null;
    const removeCounters = counterMatch && counterAmount
      ? [{ kind: counterMatch[1]!.trim().replace(/\s+/g, " ").toLowerCase(), amount: counterAmount }]
      : [];
    // Costs beyond tapping, life, counters on the source, and mana are not
    // modeled here; sacrifice/discard still stay excluded from mana abilities.
    const manaSymbols = (costText.match(/\{[^}]+\}/g) ?? []).filter((symbol) => !/^\{[TQ]\}$/i.test(symbol));
    const manaCost = manaSymbols.length ? parseManaCost(manaSymbols.join("")) : null;
    if (manaSymbols.length && !manaCost) continue;
    const leftovers = costText
      .replace(/exile\s+(?:~|this\s+card)\s+from\s+your\s+hand/gi, "")
      .replace(new RegExp(`exile\\s+(?:${escapedSelfNames.join("|")})\\s+from\\s+your\\s+hand`, "gi"), "")
      .replace(/\{T\}/g, "")
      .replace(/\{[^}]+\}/g, "")
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
      return produced ? {
        produced,
        gainLife: undefined,
        requiresLands: undefined,
        painDamage: undefined,
        activationRestriction: undefined,
        commanderEntryCounters: false
      } : null;
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
    // Board-dependent color (Fellwar Stone, Harvester Druid): resolved from
    // the battlefield at activation time, not a fixed color set on the card.
    const anyColorFromLands = /^add\s+one\s+mana\s+of\s+any\s+(?:color|type)\s+that\s+a\s+land\s+(an\s+opponent\s+controls|you\s+control)\s+could\s+produce$/i.exec(effectText.trim().replace(/\.$/, ""));
    if (anyColorFromLands && !instruction?.produced) {
      abilities.push({
        index: abilities.length, produces: [], amount: 1,
        anyColorFromLandsControlledBy: /opponent/i.test(anyColorFromLands[1]!) ? "opponent" : "you",
        ...(removeCounters.length ? { removeCounters } : {}),
        requiresTap, lifeCost, text: line.trim()
      });
      continue;
    }
    if (!instruction?.produced) continue;
    const produced = instruction.produced;
    const manaRestriction: ManaRestriction | undefined = /spend\s+this\s+mana\s+only\s+to\s+cast\s+a\s+legendary\s+spell/i.test(effectText)
      ? {
          kind: "legendary-spell",
          ...( /that\s+spell\s+can't\s+be\s+countered/i.test(effectText) ? { makesSpellUncounterable: true } : {})
        }
      : undefined;
    abilities.push({
      index: abilities.length, produces: produced.produces, amount: produced.amount,
      ...(exilesSelfFromHand ? { sourceZone: "hand" as const, exilesSelf: true } : {}),
      ...(produced.fixedProduces ? { fixedProduces: produced.fixedProduces } : {}),
      ...(produced.commanderIdentity ? { commanderIdentity: true } : {}),
      ...(instruction.commanderEntryCounters ? { commanderEntryCounters: true } : {}),
      ...(manaRestriction ? { manaRestriction } : {}),
      ...(removeCounters.length ? { removeCounters } : {}),
      ...(instruction.gainLife === undefined ? {} : { gainLife: instruction.gainLife }),
      ...(instruction.requiresLands === undefined ? {} : { requiresLands: instruction.requiresLands }),
      ...(instruction.activationRestriction === undefined ? {} : { activationRestriction: instruction.activationRestriction }),
      ...(manaCost ? { manaCost } : {}),
      requiresTap, lifeCost: lifeCost + (instruction.painDamage ?? 0), text: line.trim()
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

/** "Equip Wizard {1}" (Wizard's Staff): a second, subtype-restricted Equip cost alongside the plain "Equip {cost}" line. */
function parseTypedEquipCost(text: string): { subtype: string; cost: ManaCost } | null {
  for (const line of text.split("\n")) {
    const match = /^equip\s+([A-Za-z][A-Za-z'’-]*)\s+(.+)$/i.exec(line.trim().replace(/\.$/, ""));
    if (!match) continue;
    const cost = parseManaCost(match[2]!.trim());
    if (cost && !cost.hasVariable) return { subtype: match[1]!, cost };
  }
  return null;
}

/** "Equip worthy {cost} (reminder text)" (Mjölnir): Equip restricted to a worthy creature. */
function parseEquipWorthyCost(text: string): ManaCost | null {
  for (const line of text.split("\n")) {
    const match = /^equip\s+worthy\s+((?:\{[^}]+\})+)\s*(?:\(.*\))?\.?$/i.exec(line.trim());
    if (!match) continue;
    const cost = parseManaCost(match[1]!.trim());
    if (cost && !cost.hasVariable) return cost;
  }
  return null;
}

const CLASS_LEVEL_LINE = /^((?:\{[^}]+\})+):\s*Level\s+(\d+)\.?$/i;

/** A Class enchantment's printed "{cost}: Level N" lines, in printed order (CR 702.134). */
function parseClassLevelCosts(text: string): readonly { level: number; cost: ManaCost }[] {
  const levels: { level: number; cost: ManaCost }[] = [];
  for (const raw of text.split("\n")) {
    const match = CLASS_LEVEL_LINE.exec(raw.trim());
    if (!match) continue;
    const cost = parseManaCost(match[1]!.trim());
    if (cost && !cost.hasVariable) levels.push({ level: Number(match[2]), cost });
  }
  return levels;
}

/**
 * Maps each printed line to the Class level active at its position: 1 for
 * everything before the first "{cost}: Level N" line, else the most recently
 * printed level number (CR 702.134d — a level's abilities stay active at every
 * higher level too, so this is a floor, not an exact match).
 */
function classLevelByLine(text: string): ReadonlyMap<string, number> {
  const map = new Map<string, number>();
  let level = 1;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const match = CLASS_LEVEL_LINE.exec(line);
    if (match) { level = Number(match[2]); continue; }
    map.set(line, level);
  }
  return map;
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

/** Static bonuses granted by an Aura to the permanent it's attached to (CR 303.4.5). */
function parseAuraModification(text: string): EquipmentModification | null {
  for (const line of text.split("\n")) {
    const clean = line.trim().replace(/\.$/, "");
    // Pacifism / Bound in Silence / Kasmina's Transmutation-style locks. Arrest
    // ("...and its activated abilities can't be activated") is deliberately not
    // matched here — that extra clause is not yet enforced.
    if (/^enchanted creature can'?t attack or block$/i.test(clean)) {
      return { power: 0, toughness: 0, keywords: [], cannotAttack: true, cannotBlock: true, text: line.trim() };
    }
    if (/^enchanted creature can'?t attack$/i.test(clean)) {
      return { power: 0, toughness: 0, keywords: [], cannotAttack: true, text: line.trim() };
    }
    if (/^enchanted creature can'?t block$/i.test(clean)) {
      return { power: 0, toughness: 0, keywords: [], cannotBlock: true, text: line.trim() };
    }
    const characteristicSetting = /^enchanted creature is an insect artifact creature with base power and toughness (\d+)\/(\d+) and has (.+), and it loses all other abilities, card types, and creature types$/i.exec(clean);
    if (characteristicSetting) {
      const keywords = characteristicSetting[3]!.split(/\s+and\s+|,\s*/i).map((word) => word.trim().toLowerCase())
        .filter((word): word is EnforcedKeyword => (ENFORCED_KEYWORDS as readonly string[]).includes(word));
      return {
        power: 0,
        toughness: 0,
        keywords,
        characteristicSetting: {
          basePower: Number(characteristicSetting[1]),
          baseToughness: Number(characteristicSetting[2]),
          types: ["Artifact", "Creature"],
          subtypes: ["Insect"],
          keywords,
          removeAbilities: true
        },
        text: line.trim()
      };
    }
    let match = /^enchanted creature gets ([+-]\d+)\/([+-]\d+)(?:\s+and\s+has\s+(.+))?$/i.exec(clean);
    const counted = /^enchanted creature gets \+(\d+)\/\+(\d+) for each other enchantment on the battlefield$/i.exec(clean);
    if (counted) return {
      power: Number(counted[1]), toughness: Number(counted[2]), keywords: [],
      scaling: "other-enchantments-on-battlefield", text: line.trim()
    };
    if (match) {
      const keywords = (match[3] ?? "").split(/\s+and\s+|,\s*/i).map((word) => word.trim().toLowerCase())
        .filter((word): word is EnforcedKeyword => (ENFORCED_KEYWORDS as readonly string[]).includes(word));
      return { power: Number(match[1]), toughness: Number(match[2]), keywords, text: line.trim() };
    }
    match = /^enchanted creature has\s+(.+)$/i.exec(clean);
    if (match) {
      const keywords = match[1]!.split(/\s+and\s+|,\s*/i).map((word) => word.trim().toLowerCase())
        .filter((word): word is EnforcedKeyword => (ENFORCED_KEYWORDS as readonly string[]).includes(word));
      if (keywords.length) return { power: 0, toughness: 0, keywords, text: line.trim() };
    }
  }
  return null;
}

/** Parses the reusable Control Magic-style static control template. */
function parseAuraControlTarget(text: string): "creature" | "land" | "permanent" | null {
  for (const line of text.split("\n")) {
    const match = /^you control enchanted (creature|land|permanent)\.?$/i.exec(line.trim());
    if (match) return match[1]!.toLowerCase() as "creature" | "land" | "permanent";
  }
  return null;
}

/** Parses the closed Oracle template used by Auras that grant an activated ability. */
function parseAuraGrantedActivatedAbility(text: string): ActivatedAbility | null {
  for (const line of text.split("\n")) {
    const match = /^enchanted (?:creature|land) has "(.+)"\.?$/i.exec(line.trim());
    if (!match) continue;
    const ability = parseActivatedAbility(match[1]!, 0);
    if (ability) return ability;
  }
  return null;
}

/** Parses Wild Growth-style mana granted to an enchanted land (CR 605.1a). */
function parseAuraLandManaBonus(text: string): { readonly mana: ManaType; readonly amount: number } | null {
  for (const line of text.split("\n")) {
    const match = /^whenever enchanted land is tapped for mana, its controller adds an additional \{([WUBRGC])\}\.?$/i.exec(line.trim());
    if (match) return { mana: match[1]!.toUpperCase() as ManaType, amount: 1 };
  }
  return null;
}

function parseFlashbackDetails(text: string): { cost: ManaCost; lifeCost: number } | null {
  for (const line of text.split("\n")) {
    const match = /^flashback(?:\s+|[—–-]\s*)(.+)$/i.exec(line.trim().replace(/\.$/, ""));
    if (!match) continue;
    const costMatch = /^((?:\{[^}]+\})+)(?:,\s*pay\s+(\d+)\s+life)?/i.exec(match[1]!.trim());
    if (!costMatch) continue;
    const cost = parseManaCost(costMatch[1]!.trim());
    if (cost && !cost.hasVariable) return { cost, lifeCost: Number(costMatch[2] ?? 0) };
  }
  return null;
}

function parseFlashbackCost(text: string): ManaCost | null {
  return parseFlashbackDetails(text)?.cost ?? null;
}

function parseFlashbackLifeCost(text: string): number {
  return parseFlashbackDetails(text)?.lifeCost ?? 0;
}

const GRANTABLE_KEYWORDS = "flying|reach|first strike|double strike|deathtouch|trample|vigilance|lifelink|menace|defender|haste|indestructible|hexproof|shroud|fear|intimidate";

function parseKeywordList(text: string): EnforcedKeyword[] {
  return text.split(/\s*(?:,|\band\b)\s*/i).map((word) => word.trim().toLowerCase())
    .filter((word): word is EnforcedKeyword => (ENFORCED_KEYWORDS as readonly string[]).includes(word));
}

function parseStaticKeywordGrant(line: string): StaticKeywordGrant[] {
  const clean = line.trim().replace(/\.$/, "");
  const graveyard = new RegExp(`^as long as (?:this card|~) is in your graveyard and you control (?:a|an) ([A-Za-z][A-Za-z'’ -]*), creatures you control have ((?:${GRANTABLE_KEYWORDS})(?:(?:,| and )(?:${GRANTABLE_KEYWORDS}))*)$`, "i").exec(clean);
  if (graveyard) return parseKeywordList(graveyard[2]!).map((keyword) => ({
    scope: "creatures-you-control" as const,
    keyword,
    sourceZone: "graveyard" as const,
    requiresControlledLandSubtype: graveyard[1]!.trim()
  }));
  const all = new RegExp(`^all creatures (?:have|gain) ((?:${GRANTABLE_KEYWORDS})(?:(?:,| and )(?:${GRANTABLE_KEYWORDS}))*)$`, "i").exec(clean);
  if (all) return parseKeywordList(all[1]!).map((keyword) => ({ scope: "all-creatures" as const, keyword }));
  const own = new RegExp(`^(other )?creatures you control (?:have|gain) ((?:${GRANTABLE_KEYWORDS})(?:(?:,| and )(?:${GRANTABLE_KEYWORDS}))*)$`, "i").exec(clean);
  if (own) return parseKeywordList(own[2]!).map((keyword) => ({ scope: own[1] ? "other-creatures-you-control" as const : "creatures-you-control" as const, keyword }));
  const subtype = new RegExp(`^([A-Za-z][A-Za-z'’-]*) creatures (?:you control )?have ((?:${GRANTABLE_KEYWORDS})(?:(?:,| and )(?:${GRANTABLE_KEYWORDS}))*)$`, "i").exec(clean);
  if (subtype && !/^creature$/i.test(subtype[1]!)) return parseKeywordList(subtype[2]!).map((keyword) => ({ scope: "subtype-creatures-you-control" as const, keyword, subtype: subtype[1]! }));
  return [];
}

function parseStaticKeywordGrants(text: string): StaticKeywordGrant[] {
  return text.split("\n").flatMap(parseStaticKeywordGrant);
}

const MANA_GRANT_TYPE_WORDS: Readonly<Record<string, CardType | undefined>> = {
  creatures: "Creature", lands: "Land", artifacts: "Artifact", enchantments: "Enchantment", permanents: undefined
};

/** "X [you control] have '{T}: Add ...'" (Chromatic Lantern, Joraga Treespeaker, Cryptolith Rite, CR 113.6). */
function parseManaAbilityGrant(line: string): StaticManaAbilityGrant | null {
  const clean = line.trim().replace(/\.$/, "");
  const build = (typeWord: string, scope: "you-control" | "all", excludesSelf: boolean, abilityText: string): StaticManaAbilityGrant | null => {
    const type = MANA_GRANT_TYPE_WORDS[typeWord.toLowerCase()];
    return finish({ scope, excludesSelf, ...(type ? { type } : {}) }, abilityText);
  };
  const buildSubtype = (subtypeWord: string, scope: "you-control" | "all", excludesSelf: boolean, abilityText: string): StaticManaAbilityGrant | null =>
    finish({ scope, excludesSelf, type: "Creature", subtype: singularSubtype(subtypeWord) }, abilityText);
  const finish = (base: { scope: "you-control" | "all"; excludesSelf: boolean; type?: CardType; subtype?: string }, abilityText: string): StaticManaAbilityGrant | null => {
    const fakeCard: CardData = { scryfall_id: "mana-grant", name: "~", type_line: "", mana_cost: "", cmc: 0 };
    const abilities = parseManaAbilities(fakeCard, abilityText.trim());
    return abilities.length === 1 ? { ...base, ability: abilities[0]! } : null;
  };

  const typeWordAlt = "creatures|lands|artifacts|enchantments|permanents";
  const allMatch = new RegExp(`^all (${typeWordAlt}) have "([^"]+)"$`, "i").exec(clean);
  if (allMatch) return build(allMatch[1]!, "all", false, allMatch[2]!);
  const otherMatch = new RegExp(`^other (${typeWordAlt}) you control have "([^"]+)"$`, "i").exec(clean);
  if (otherMatch) return build(otherMatch[1]!, "you-control", true, otherMatch[2]!);
  const typeMatch = new RegExp(`^(${typeWordAlt}) you control have "([^"]+)"$`, "i").exec(clean);
  if (typeMatch) return build(typeMatch[1]!, "you-control", false, typeMatch[2]!);
  const subtypeMatch = /^([A-Za-z][A-Za-z'’-]*) creatures you control have "([^"]+)"$/i.exec(clean);
  if (subtypeMatch && !/^creatures?$/i.test(subtypeMatch[1]!)) return buildSubtype(subtypeMatch[1]!, "you-control", false, subtypeMatch[2]!);
  // Bare subtype, no "creatures" noun (Joraga Treespeaker: "Elves you control have ...").
  const bareSubtypeMatch = /^([A-Za-z][A-Za-z'’-]*) you control have "([^"]+)"$/i.exec(clean);
  if (bareSubtypeMatch && !MANA_GRANT_TYPE_WORDS[bareSubtypeMatch[1]!.toLowerCase()] && bareSubtypeMatch[1]!.toLowerCase() !== "permanents") {
    return buildSubtype(bareSubtypeMatch[1]!, "you-control", false, bareSubtypeMatch[2]!);
  }
  return null;
}

/**
 * Scans every line for a mana-ability grant, gating each one on the nearest
 * preceding "LEVEL N[+/-M]" marker (Joraga Treespeaker's grant only applies
 * at LEVEL 5+, not from level 0) the same way `parseLevelDefinitions` tracks
 * level blocks for power/toughness/keywords.
 */
function parseManaAbilityGrants(text: string): StaticManaAbilityGrant[] {
  const grants: StaticManaAbilityGrant[] = [];
  let currentMinLevel: number | undefined;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    const marker = /^level\s+(\d+)(?:-\d+|\+)?$/i.exec(line);
    if (marker) { currentMinLevel = Number(marker[1]); continue; }
    const grant = parseManaAbilityGrant(line);
    if (grant) grants.push(currentMinLevel !== undefined ? { ...grant, minLevel: currentMinLevel } : grant);
  }
  return grants;
}

/** "~ has flying during your turn" (Razorkin Needlehead) — self-only, gated on whose turn it is. */
function parseKeywordDuringYourTurn(line: string): EnforcedKeyword[] {
  const clean = line.trim().replace(/\.$/, "");
  const match = new RegExp(`^~ has ((?:${GRANTABLE_KEYWORDS})(?:(?:,| and )(?:${GRANTABLE_KEYWORDS}))*) during your turn$`, "i").exec(clean);
  return match ? parseKeywordList(match[1]!) : [];
}

function parseKeywordsDuringYourTurn(text: string): EnforcedKeyword[] {
  return text.split("\n").flatMap(parseKeywordDuringYourTurn);
}

/** Harmonic Prodigy / Wizard's Staff style trigger-doubling clauses. */
function parseTriggerDoubler(line: string): TriggerDoubler | null {
  const clean = line.trim().replace(/\.$/, "");
  if (/^If a triggered ability of equipped creature triggers,\s*that ability triggers an additional time$/i.test(clean)) {
    return { scope: "equipped-creature" };
  }
  if (/^If a player drawing a card causes a triggered ability of a permanent you control to trigger,\s*that ability triggers an additional time$/i.test(clean)) {
    return { scope: "draw-caused-triggers" };
  }
  const subtypeMatch = /^If a triggered ability of (?:an?|another)\s+([A-Za-z][A-Za-z'’-]*)(?:\s+or\s+(?:an?|another)\s+([A-Za-z][A-Za-z'’-]*))?\s+you control triggers,\s*that ability triggers an additional time$/i.exec(clean);
  if (!subtypeMatch) return null;
  return {
    scope: "subtype-you-control",
    subtypes: [subtypeMatch[1], subtypeMatch[2]].filter((value): value is string => Boolean(value))
  };
}

function parseTriggerDoublers(text: string): TriggerDoubler[] {
  return text.split("\n").flatMap((line) => parseTriggerDoubler(line) ?? []);
}

function parseUntapColorsDuringOtherPlayersUntap(text: string): string[] {
  if (/untap all green and\/?or blue creatures you control during each other/i.test(text)) return ["G", "U"];
  const match = /^untap all (.+?) creatures you control during each other .*?untap step\.?$/im.exec(text);
  if (!match) return [];
  const colors = match[1]!.toLowerCase().match(/green|blue/g) ?? [];
  return [...new Set(colors.map((color) => color === "green" ? "G" : "U"))];
}

function parseStaticPowerToughnessGrant(line: string): StaticPowerToughnessGrant | null {
  const clean = line.trim().replace(/\.$/, "");
  const graveyard = /^~ gets ([+-]\d+)\/([+-]\d+) for each creature card in your opponents' graveyards$/i.exec(clean);
  if (graveyard) return { scope: "source-opponents-graveyard-creatures", power: Number(graveyard[1]), toughness: Number(graveyard[2]) };
  const life = /^~ gets ([+-]\d+)\/([+-]\d+) as long as you have (\d+) or more life$/i.exec(clean);
  if (life) return { scope: "source-controller-life-threshold", power: Number(life[1]), toughness: Number(life[2]), threshold: Number(life[3]) };
  // "As long as ~ has N or more <name> counters on it, creatures you control get +X/+Y" (Beastmaster Ascension).
  const counterThreshold = /^as long as ~ has (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) or more ([a-z][a-z\s-]*?) counters? on it,\s*creatures you control get ([+-]\d+)\/([+-]\d+)$/i.exec(clean);
  if (counterThreshold) {
    const threshold = toNumber(counterThreshold[1]!);
    if (threshold !== null) return {
      scope: "creatures-you-control-source-counter-threshold",
      power: Number(counterThreshold[3]), toughness: Number(counterThreshold[4]),
      threshold, counterName: counterThreshold[2]!.trim().toLowerCase()
    };
  }
  const match = /^(?:(other\s+(?:(white|blue|black|red|green)\s+)?creatures\s+you\s+control)|(creatures\s+you\s+control)|(all creatures))\s+get\s+([+-]\d+)\/([+-]\d+)$/i.exec(clean);
  if (match) {
    return {
      scope: match[4] ? "all-creatures" : match[3] ? "creatures-you-control" : "other-creatures-you-control",
      ...(match[2] ? { color: DAMAGE_AMPLIFY_COLOR_LETTER[match[2]!.toLowerCase()] } : {}),
      power: Number(match[5]), toughness: Number(match[6])
    };
  }
  // Tribal lord: "Other Elves you control get +1/+1." (CR 205.3g creature subtypes).
  const subtypeLord = /^other\s+([A-Za-z]+)\s+you\s+control\s+get\s+([+-]\d+)\/([+-]\d+)$/i.exec(clean);
  if (subtypeLord) {
    return {
      scope: "other-subtype-creatures-you-control",
      subtype: singularSubtype(subtypeLord[1]!),
      power: Number(subtypeLord[2]), toughness: Number(subtypeLord[3])
    };
  }
  // Same tribal lord, spelled with an explicit "creatures" (Mad Auntie: "Other
  // Goblin creatures you control get +1/+1."). The qualifier is already
  // singular here — some of these are card types ("artifact"/"enchantment"
  // creatures), not creature subtypes, so the engine checks both.
  const subtypeCreaturesLord = /^other\s+([A-Za-z]+)\s+creatures\s+you\s+control\s+get\s+([+-]\d+)\/([+-]\d+)$/i.exec(clean);
  if (subtypeCreaturesLord) {
    return {
      scope: "other-subtype-creatures-you-control",
      subtype: subtypeCreaturesLord[1]!,
      power: Number(subtypeCreaturesLord[2]), toughness: Number(subtypeCreaturesLord[3])
    };
  }
  // Color anthem, any controller (Bad Moon, Celestial Crusader): unlike the
  // "you control" grants above, this affects every player's creatures.
  const colorAnthem = /^(other\s+)?(white|blue|black|red|green)\s+creatures\s+get\s+([+-]\d+)\/([+-]\d+)$/i.exec(clean);
  if (colorAnthem) {
    return {
      scope: colorAnthem[1] ? "other-all-creatures" : "all-creatures",
      color: DAMAGE_AMPLIFY_COLOR_LETTER[colorAnthem[2]!.toLowerCase()],
      power: Number(colorAnthem[3]), toughness: Number(colorAnthem[4])
    };
  }
  return null;
}

function parseStaticPowerToughnessGrants(text: string): StaticPowerToughnessGrant[] {
  return text.split("\n").map(parseStaticPowerToughnessGrant).filter((grant): grant is StaticPowerToughnessGrant => grant !== null);
}

// Torbran, Thane of Red Fell (CR 614.1c): "opponent" scope excludes the
// controller's own permanents and life total from the bonus, so a card that
// could hurt its own controller is left unmatched rather than guessed at.
const DAMAGE_AMPLIFY_OPPONENT = /^If (a|another) (red|white|blue|black|green)? ?source you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus (\d+) instead\.?$/i;
// "any" scope hits every permanent or player, including the controller's own.
const DAMAGE_AMPLIFY_ANY = /^If (a|another) (red|white|blue|black|green)? ?source you control would deal damage to a permanent or player, it deals that much damage plus (\d+)(?: to that permanent or player)? instead\.?$/i;

const DAMAGE_AMPLIFY_COLOR_LETTER: Readonly<Record<string, ManaType>> = { white: "W", blue: "U", black: "B", red: "R", green: "G" };

// Hawkeye, Young Avenger: the same replacement shape, restricted to
// noncombat damage, with a dynamic bonus equal to the source's own power
// rather than a fixed number.
const DAMAGE_AMPLIFY_OPPONENT_SOURCE_POWER = /^If (a|another) (red|white|blue|black|green)? ?source you control would deal noncombat damage to an opponent or a permanent an opponent controls, instead it deals that much damage plus X, where X is ~'s power\.?$/i;

function parseDamageAmplify(line: string): DamageAmplify | null {
  const clean = line.trim();
  const sourcePower = DAMAGE_AMPLIFY_OPPONENT_SOURCE_POWER.exec(clean);
  if (sourcePower) {
    const colorFilter = sourcePower[2] ? DAMAGE_AMPLIFY_COLOR_LETTER[sourcePower[2]!.toLowerCase()] : undefined;
    return {
      excludesSelf: sourcePower[1]!.toLowerCase() === "another",
      ...(colorFilter ? { colorFilter } : {}),
      scope: "opponent",
      amount: "source-power",
      noncombatOnly: true
    };
  }
  const opponent = DAMAGE_AMPLIFY_OPPONENT.exec(clean);
  const any = opponent ? null : DAMAGE_AMPLIFY_ANY.exec(clean);
  const match = opponent ?? any;
  if (!match) return null;
  const colorFilter = match[2] ? DAMAGE_AMPLIFY_COLOR_LETTER[match[2]!.toLowerCase()] : undefined;
  return {
    excludesSelf: match[1]!.toLowerCase() === "another",
    ...(colorFilter ? { colorFilter } : {}),
    scope: opponent ? "opponent" : "any",
    amount: Number(match[3])
  };
}

/**
 * Parses an activation cost made from mana, tapping, paying life and
 * sacrificing its own source, removing counters, plus an effect the engine can
 * resolve.
 *
 * Everything else — exiling or sacrificing
 * other permanents or discarding — leaves the ability out of
 * the profile rather than letting the table activate a cost it cannot pay.
 */
/** True when an effect reads the spell/ability's X (so an `{X}` cost is meaningful). */
function effectUsesVariable(effect: SpellEffect): boolean {
  const anyEffect = effect as Record<string, unknown>;
  if (anyEffect.amount === "X" || anyEffect.count === "X" || anyEffect.power === "X" || anyEffect.toughness === "X") return true;
  if (effect.kind === "drain-target-toughness-pump-source-power") return true;
  if (effect.kind === "destroy-target-artifact-or-creature-mana-value") return true;
  if (effect.kind === "compound") return effect.effects.some(effectUsesVariable);
  return false;
}

function parseActivatedAbility(line: string, index: number): ActivatedAbility | null {
  const activated = /^([^:]{1,120}):\s*(.+)$/.exec(line.trim());
  if (!activated) return null;
  const [, costText, effectText] = activated as unknown as [string, string, string];
  // Forecast is an activated ability whose source remains in hand (CR 702.57).
  // Parse it through the shared sentence grammar so every supported effect is
  // reusable by both the printed spell and its Forecast ability.
  const forecast = /^Forecast\s+[—–-]\s*((?:\{[^}]+\})+),\s*Reveal\s+(?:~|this card)\s+from\s+your hand:\s*(.+)$/i.exec(line.trim());
  if (forecast) {
    const manaCost = parseManaCost(forecast[1]!);
    const recognized = recognizeSentence(forecast[2]!.trim());
    if (!manaCost || !recognized) return null;
    return {
      index, requiresTap: false, sacrificesSelf: false, lifeCost: 0, manaCost,
      sourceZone: "hand", upkeepOnly: true, oncePerTurn: true, revealSourceFromHand: true,
      effect: recognized.effect, targetKind: recognized.target, text: line.trim()
    };
  }
  // Mana abilities have their own immediate-resolution path (CR 605.1a).
  if (/^add\b/i.test(effectText.trim())) return null;
  const precombatMainOnly = /activate only during your turn, before attackers are declared/i.test(effectText);
  const parsedEffectText = effectText
    .replace(/\.?\s*Activate only during your turn, before attackers are declared\.?$/i, "")
    // Oracle often uses “it” after naming the source in the cost/effect line.
    // Normalize it to the same source marker used by the shared effect parser.
    .replace(/^it\s+(deals|gets|gains)\b/i, "~ $1")
    .trim();
  const selfUntap = /^Untap ~\.?$/i.test(parsedEffectText);
  // Planeswalker loyalty abilities (CR 606): the cost is a signed loyalty change.
  const loyalty = /^\s*([+\u2212\u2013-])?\s*(\d+)\s*$/.exec(costText);
  if (loyalty) {
    const recognized = recognizeSentence(parsedEffectText);
    if (!recognized) return null;
    const magnitude = Number(loyalty[2]);
    const sign = loyalty[1] && /[\u2212\u2013-]/.test(loyalty[1]) ? -1 : 1;
    return {
      index, requiresTap: false, sacrificesSelf: false, lifeCost: 0, manaCost: null,
      loyaltyCost: magnitude === 0 ? 0 : sign * magnitude, sorcerySpeed: true,
      effect: recognized.effect, targetKind: recognized.target,
      ...(recognized.targetKinds ? { targetKinds: recognized.targetKinds } : {}),
      text: line.trim()
    };
  }
  // "Activate only if an opponent controls N or more lands" (Tectonic Edge, CR 602.5).
  const oppLandGate = /\.\s*Activate only if an opponent controls (\w+) or more lands\.?\s*$/i.exec(effectText);
  const requiresOpponentLands = oppLandGate ? toNumber(oppLandGate[1]!) : null;
  const effectBody = oppLandGate ? effectText.slice(0, oppLandGate.index) : effectText;
  // The effect grammar is shared by spells, triggers and activations; do not
  // duplicate card-text patterns in the activation-cost parser.
  const selfPump = /^~ gets ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i.exec(parsedEffectText);
  const revealTopConditional = parseRevealTopCardConditional(parsedEffectText);
  const revealTopToHand = parseRevealTopCardToHandAndGainManaValue(parsedEffectText);
  const fight = /^Target Beast creature you control fights target creature an opponent controls\.?$/i.test(parsedEffectText);
  const tokenAndLife = /^(Create\s+.+?\s+token(?:s)?(?:\s+named\s+[^,]+)?(?:\s+with\s+.+)?)\.\s*You gain (\w+) life\.?$/i.exec(parsedEffectText);
  const tokenEffect = tokenAndLife ? parseCreateToken(tokenAndLife[1]!) : null;
  const tokenLifeAmount = tokenAndLife ? toNumber(tokenAndLife[2]!) : null;
  const sacrificedToughnessLife = /^You gain life equal to the sacrificed creature's toughness\.?$/i.test(parsedEffectText);
  const recognized = selfUntap
    ? { effect: { kind: "untap-source" } as SpellEffect, target: "none" as TargetKind }
    : selfPump
    ? { effect: { kind: "modify-source-creature", power: Number(selfPump[1]), toughness: Number(selfPump[2]) } as SpellEffect, target: "none" as TargetKind }
    : revealTopConditional
    ? { effect: revealTopConditional, target: "none" as TargetKind }
    : revealTopToHand
    ? { effect: revealTopToHand, target: "none" as TargetKind }
    : fight
    ? { effect: { kind: "fight" } as SpellEffect, target: "creature-you-control" as TargetKind, targetKinds: ["creature-you-control", "creature-opponent"] as const }
    : tokenEffect && tokenEffect.kind === "create-token" && tokenLifeAmount !== null
    ? { effect: { kind: "compound", effects: [tokenEffect, { kind: "gain-life", amount: tokenLifeAmount }] } as SpellEffect, target: "none" as TargetKind }
    : sacrificedToughnessLife
    ? { effect: { kind: "gain-life-equal-sacrificed-toughness" } as SpellEffect, target: "none" as TargetKind }
    : recognizeSentence(parsedEffectText);
  if (!recognized) return null;

  const symbols = costText.match(/\{[^}]+\}/g) ?? [];
  const requiresTap = symbols.some((symbol) => symbol.toUpperCase() === "{T}");
  const requiresUntap = symbols.some((symbol) => /^\{Q\}$/i.test(symbol));
  const energyCost = (costText.match(/pay\s+(?:\{E\})+/i)?.[0].match(/\{E\}/gi) ?? []).length;
  const manaSymbols = symbols.filter((symbol) => !/^\{[TQE]\}$/i.test(symbol));
  const manaCost = manaSymbols.length ? parseManaCost(manaSymbols.join("")) : null;
  if (manaSymbols.length && !manaCost) return null;
  // An {X} cost is payable only when the effect actually consumes X (CR 107.3).
  if (manaCost?.hasVariable && !effectUsesVariable(recognized.effect)) return null;

  const namedSelfSacrifice = /\bsacrifice\s+(?!a\b|an\b|another\b|~\b|this\b)([A-Z][^,:]*?)(?=,|$)/.test(costText);
  const sacrificesSelf = /sacrifice\s+(?:~|this\s+(?:artifact|permanent|creature|enchantment|land))/i.test(costText) || namedSelfSacrifice;
  const tapCreatureMatch = /tap\s+(an|another)\s+untapped\s+([A-Za-z][A-Za-z'’/-]*)\s+you\s+control/i.exec(costText);
  const tapsCreature = tapCreatureMatch ? {
    mode: tapCreatureMatch[1]!.toLowerCase() === "another" ? "another" as const : "any" as const,
    ...(tapCreatureMatch[2]!.toLowerCase() === "creature" ? {} : { subtype: tapCreatureMatch[2]! })
  } : undefined;
  const sacrificeCreatures = /sacrifice\s+(two|three|four|five|\d+)\s+(?:(?:a|an)\s+)?([A-Za-z][A-Za-z'’-]*\s+)?creatures\b/i.exec(costText);
  const sacrificeCreature = /sacrifice\s+(another\s+)?(?:a\s+|an\s+)?creature\b/i.exec(costText);
  const sacrificeCreatureSubtype = /sacrifice\s+(another\s+)?(?:a\s+|an\s+)?([A-Za-z][A-Za-z'’-]*)\b/i.exec(costText);
  const typedCreature = !sacrificeCreatures && sacrificeCreatureSubtype && !/^(?:nontoken|creature|artifact|enchantment|land|noncreature|token|permanent)$/i.test(sacrificeCreatureSubtype[2]!)
    ? sacrificeCreatureSubtype
    : null;
  const sacrificePermanent = /sacrifice\s+(another\s+)?(?:a\s+|an\s+)?(nontoken\s+artifact|artifact|enchantment|land|noncreature\s+permanent|token|permanent)\b/i.exec(costText);
  const nontokenArtifact = Boolean(sacrificePermanent && /^nontoken\s+artifact$/i.test(sacrificePermanent[2]!));
  const discardsCard = /discard\s+(?:a|one)\s+card\b/i.test(costText);
  // "{cost}, Discard this card: ..." (Mjölnir): the source pays its own cost by
  // leaving hand for the graveyard, so the ability can only be offered there.
  const discardsSelf = /discard\s+(?:~|this\s+card)/i.test(costText);
  const exilesGraveyardCard = /exile\s+(?:a|one)\s+card\s+from\s+your\s+graveyard\b/i.test(costText);
  const exilesGraveyardCardsMatch = /exile\s+(two|three|four|five|\d+)\s+creature\s+cards\s+from\s+a\s+single\s+graveyard\b/i.exec(costText);
  const removedCounters: CounterCost[] = [];
  for (const match of costText.matchAll(/remove\s+(a|an|one|two|three|four|five|\d+)\s+([+\-]\d+\/[+\-]\d+|[\w/-]+(?:\s+[\w/-]+)*)\s+counters?\s+from\s+~/gi)) {
    const amount = toNumber(match[1]);
    const kind = match[2]?.trim().replace(/\s+/g, " ").toLowerCase();
    if (amount !== null && kind) removedCounters.push({ kind, amount });
  }
  const lifeMatch = /pay\s+(\d+)\s+life/i.exec(costText);
  const lifeCost = lifeMatch ? Number(lifeMatch[1]) : 0;
  const leftovers = costText
    .replace(/pay\s+(?:\{E\})+/gi, "")
    .replace(/\{[^}]*\}/g, "")
    .replace(/pay\s+\d+\s+life/gi, "")
    .replace(/sacrifice\s+(?:~|this\s+(?:artifact|permanent|creature|enchantment|land))/gi, "")
    .replace(/\bsacrifice\s+(?!a\b|an\b|another\b|~\b)([A-Z][^,:]*?)(?=,|$)/g, "")
    .replace(/sacrifice\s+(?:two|three|four|five|\d+)\s+(?:(?:a|an)\s+)?(?:[A-Za-z][A-Za-z'’-]*\s+)?creatures\b/gi, "")
    .replace(/sacrifice\s+(?:another\s+|a\s+|an\s+)?creature/gi, "")
    .replace(/sacrifice\s+(?:another\s+|a\s+|an\s+)?[A-Za-z][A-Za-z'’-]*\b/gi, (match) => typedCreature ? "" : match)
    .replace(/sacrifice\s+(?:another\s+|a\s+|an\s+)?(?:nontoken\s+artifact|artifact|enchantment|land|noncreature\s+permanent|token|permanent)\b/gi, "")
    .replace(/tap\s+(?:an|another)\s+untapped\s+[A-Za-z][A-Za-z'’/-]*\s+you\s+control/gi, "")
    .replace(/discard\s+(?:a|one)\s+card\b/gi, "")
    .replace(/discard\s+(?:~|this\s+card)/gi, "")
    .replace(/exile\s+(?:two|three|four|five|\d+)\s+creature\s+cards\s+from\s+a\s+single\s+graveyard\b/gi, "")
    .replace(/exile\s+(?:a|one)\s+card\s+from\s+your\s+graveyard\b/gi, "")
    .replace(/remove\s+(?:a|an|one|two|three|four|five|\d+)\s+[+\-]\d+\/[+\-]\d+\s+counters?\s+from\s+~/gi, "")
    .replace(/[,\s]/g, "");
  if (leftovers.length) return null;
  return {
    index,
    requiresTap,
    sacrificesSelf,
    ...(tapsCreature ? { tapsCreature } : {}),
    ...(sacrificeCreatures ? { sacrificesCreatures: { amount: toNumber(sacrificeCreatures[1])!, ...(sacrificeCreatures[2] ? { subtype: sacrificeCreatures[2].trim() } : {}) } } : {}),
    ...(sacrificeCreature ? { sacrificesCreature: sacrificeCreature[1] ? "another" as const : "any" as const } : {}),
    ...(typedCreature ? { sacrificesCreatureSubtype: { subtype: typedCreature[2]!, mode: typedCreature[1] ? "another" as const : "any" as const } } : {}),
    ...(sacrificePermanent ? { sacrificesPermanent: { mode: sacrificePermanent[1] ? "another" as const : "any" as const, type: nontokenArtifact ? "Artifact" as const : /^noncreature/i.test(sacrificePermanent[2]!) ? "Noncreature" as const : /^token$/i.test(sacrificePermanent[2]!) ? "Token" as const : /^permanent$/i.test(sacrificePermanent[2]!) ? "Permanent" as const : `${sacrificePermanent[2]![0]!.toUpperCase()}${sacrificePermanent[2]![1]! ? sacrificePermanent[2]!.slice(1).toLowerCase() : ""}` as "Artifact" | "Enchantment" | "Land", ...(nontokenArtifact ? { nontoken: true } : {}) } } : {}),
    ...(discardsCard ? { discardsCard: true } : {}),
    ...(discardsSelf ? { discardsSelf: true, sourceZone: "hand" as const } : {}),
    ...(exilesGraveyardCard ? { exilesGraveyardCard: true } : {}),
    ...(exilesGraveyardCardsMatch ? { exilesGraveyardCards: { amount: toNumber(exilesGraveyardCardsMatch[1])!, scope: "single-graveyard" as const } } : {}),
    ...(precombatMainOnly ? { precombatMainOnly: true } : {}),
    ...(removedCounters.length ? { removeCounters: removedCounters } : {}),
    ...(energyCost ? { energyCost } : {}),
    ...(requiresUntap ? { requiresUntap: true } : {}),
    ...(requiresOpponentLands !== null ? { requiresOpponentLands } : {}),
    lifeCost,
    manaCost,
    effect: recognized.effect,
    targetKind: recognized.target,
    ...("targetKinds" in recognized && recognized.targetKinds ? { targetKinds: recognized.targetKinds } : {}),
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
  // Starting Town and similar designs use the game turn rather than a
  // battlefield count: it enters untapped during the first N turns, then
  // enters tapped. Keep this replacement effect explicit so it cannot fall
  // through to the generic always-tapped case.
  const firstTurns = /unless[^.\n]*your[^.\n]*turn\s+of\s+the\s+game/i.exec(text);
  if (firstTurns) {
    const ordinals = firstTurns[0]!.match(/first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+/gi) ?? [];
    const maxTurn = Math.max(...ordinals.map((ordinal) => toNumber(ordinal) ?? 0));
    if (maxTurn > 0) return { kind: "unless-first-turns", maxTurn };
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
  readonly targetKinds?: readonly Exclude<TargetKind, "none">[];
  kickerCost?: ManaCost | null;
  entwineCost?: ManaCost | null;
  graftAmount?: number | null;
  kickedEffects?: SpellEffect[];
  kickedKeywords?: EnforcedKeyword[];
  kickedEntersWithCounters?: CounterCost[];
  echoCost?: ManaCost | null;
  evokeCost?: ManaCost | null;
  flashbackCost?: ManaCost | null;
  miracleCost?: ManaCost | null;
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

/** "~ enters ... with X <kind> counters on it" (Walking Ballista): X is the spell's own paid {X}, not a fixed number. */
function parseEntersWithVariableCounters(text: string): { kind: string } | null {
  const match = /(?:~|this [^.]+)\s+enters(?:\s+the\s+battlefield)?\s+with\s+x\s+([+\-\w/ ]+?)\s+counters?\s+on\s+it/i.exec(text);
  return match ? { kind: match[1]!.trim().replace(/\s+/g, " ").toLowerCase() } : null;
}

const SENTENCE_SPLIT = /(?<=\.)\s+(?=[A-Z~])/;

function searchCriterion(text: string): { types: CardType[]; subtypes: string[]; colors: string[] } {
  // "a green creature card" (Natural Order): a leading color adjective
  // restricts by color, not a creature subtype, so pull it out first.
  const colorMatch = /\b(white|blue|black|red|green)\b/i.exec(text);
  const colors = colorMatch ? [DAMAGE_AMPLIFY_COLOR_LETTER[colorMatch[1]!.toLowerCase()]!] : [];
  const withoutColor = colorMatch ? text.replace(colorMatch[0], " ").replace(/\s+/g, " ").trim() : text;
  const types = CARD_TYPES.filter((type) => new RegExp(`\\b${type}\\b`, "i").test(withoutColor));
  const subtypes: string[] = /\bbasic\b/i.test(withoutColor) ? ["Basic"] : [];
  // Search criteria are open-ended in Oracle: Equipment, Aura, Goblin and
  // future creature/artefact subtypes must not be reduced to “all cards”.
  // Only collect a single lexical criterion after removing card-type words;
  // compound descriptions ("land with ...", "card with ...") stay pending.
  const criterion = withoutColor.replace(/\b(?:a|an|up to (?:one|two|three|five))\b/gi, "")
    .replace(/\bcard\b/gi, "").replace(/\s+/g, " ").trim();
  for (const part of criterion.split(/\s+(?:or|and)\s+/i)) {
    const candidate = part.trim();
    if (!candidate || /\b(?:with|that|whose|where|named|converted|mana|power|toughness)\b/i.test(candidate)) continue;
    if (/^(?:basic|land|creature|artifact|enchantment|instant|sorcery|planeswalker|battle|kindred)$/i.test(candidate)) continue;
    if (/^[A-Za-z][A-Za-z'’/-]*$/.test(candidate) && !subtypes.some((subtype) => subtype.toLowerCase() === candidate.toLowerCase())) {
      subtypes.push(candidate);
    }
  }
  return { types, subtypes, colors };
}

function parseLibrarySearch(text: string): SpellEffect | null {
  const single = /^Search your library for (?:a |an |up to (?:one|two|three|five) )?(.+?) card, (.+)$/i.exec(text);
  const namedBasic = /^Search your library for a ((?:Plains|Island|Swamp|Mountain|Forest)(?:,\s*(?:Plains|Island|Swamp|Mountain|Forest))*?(?:,?\s+or\s+(?:Plains|Island|Swamp|Mountain|Forest))?) card and put that card onto the battlefield\.?$/i.exec(text.trim());
  if (namedBasic) {
    return {
      kind: "search-library", types: ["Land"],
      subtypes: namedBasic[1]!.match(/Plains|Island|Swamp|Mountain|Forest/gi) ?? [],
      destination: "battlefield", reveal: false
    };
  }
  // Some historical imports use plural pronouns after selecting several
  // cards. Keep the amount as a structured operand instead of forcing this
  // through the single-card `it/that card` grammar.
  const multiHand = /^Search your library for up to (one|two|three|five) (.+?) cards, reveal (?:them|those cards), put (?:them|those cards) into your hand, then shuffle\.?$/i.exec(text);
  if (multiHand) {
    const count = toNumber(multiHand[1]!) ?? 1;
    const criterion = searchCriterion(multiHand[2]!);
    return {
      kind: "search-library",
      types: criterion.types,
      ...(criterion.subtypes.length ? { subtypes: criterion.subtypes } : {}),
      ...(criterion.colors.length ? { colors: criterion.colors } : {}),
      destination: "hand",
      reveal: true,
      count
    };
  }
  // "up to N basic land cards, put them onto the battlefield tapped, then shuffle" (Burnished Hart, Harrow).
  const multi = /^Search your library for up to (one|two|three) (.+?) cards(?:\s+that share a land type)?, put them onto the battlefield( tapped)?,?\s*(?:then shuffle)?\.?$/i.exec(text);
  if (multi) {
    const count = toNumber(multi[1]!) ?? 1;
    const criterion = searchCriterion(multi[2]!);
    return {
      kind: "search-library",
      types: criterion.types,
      ...(criterion.subtypes.length ? { subtypes: criterion.subtypes } : {}),
      ...(criterion.colors.length ? { colors: criterion.colors } : {}),
      destination: "battlefield",
      ...(multi[3] ? { tapped: true } : {}),
      reveal: false,
      count
    };
  }
  // "...card with mana value X or less, put it onto the battlefield, then
  // shuffle" (Green Sun's Zenith, Chord of Calling): X is the spell's own
  // paid {X}, read from the stack object at resolution.
  const manaValueX = /^Search your library for (?:a |an )?(.+?) card with mana value X or less, put it onto the battlefield, then shuffle\.?$/i.exec(text);
  if (manaValueX) {
    const criterion = searchCriterion(manaValueX[1]!);
    return {
      kind: "search-library",
      types: criterion.types,
      ...(criterion.subtypes.length ? { subtypes: criterion.subtypes } : {}),
      ...(criterion.colors.length ? { colors: criterion.colors } : {}),
      maxManaValue: "X",
      destination: "battlefield",
      reveal: false
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
    ...(criterion.colors.length ? { colors: criterion.colors } : {}),
    destination,
    ...(destination === "battlefield" && /onto the battlefield tapped/i.test(instructions) ? { tapped: true } : {}),
    reveal: /reveal/i.test(instructions)
  };
}

/** Basic-land subtype search that Oracle prints without a comma before "and put". */
function parseNamedBasicLandSearch(text: string): SpellEffect | null {
  const match = /^Search your library for (a|an) ((?:Plains|Island|Swamp|Mountain|Forest)(?:,\s*(?:Plains|Island|Swamp|Mountain|Forest))*?(?:,?\s+or\s+(?:Plains|Island|Swamp|Mountain|Forest))?) card and put that card onto the battlefield\.?$/i.exec(text.trim());
  if (!match) return null;
  const subtypes = match[2]!.match(/Plains|Island|Swamp|Mountain|Forest/gi) ?? [];
  return { kind: "search-library", types: ["Land"], subtypes, destination: "battlefield", reveal: false };
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
  // Oracle token descriptors commonly join multiple colors with "and";
  // conjunctions are grammar, not part of the token's subtype/name. "Colorless"
  // is a real descriptor too (an absent color, not a subtype word) — the
  // token's empty `colors` array already expresses it correctly.
  const subtype = words.filter((word) => !colorWords[word.toLowerCase()] && !/^(artifact|creature|and|colorless)$/i.test(word)).join(" ");
  const name = (match[5]?.trim() || (subtype || (artifact ? "Treasure" : "Token"))).replace(/\s+token$/i, "");
  const keywords = (match[6]?.match(/flying|reach|first strike|double strike|deathtouch|trample|vigilance|lifelink|menace|defender|haste|indestructible|hexproof|shroud|fear|intimidate/gi) ?? [])
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

/**
 * Shared top-of-library selection primitive (CR 401.5, 401.4, 701.20e): disclose a
 * bounded private slice, optionally select one card of the requested types,
 * then order every other card on the bottom. The amount is deliberately a
 * parameter so Augur of Bolas and future look-top templates share one rule.
 */
function parseLookTopSelection(text: string): SpellEffect | null {
  const match = /^Look at the top (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\. You may reveal (?:an? )?(.+?) card from among them and put it into your hand\. Put the rest on the bottom of your library in any order$/i.exec(text.trim().replace(/\.$/, ""));
  if (!match) return null;
  const amount = toNumber(match[1]);
  if (amount === null || amount < 0) return null;
  const types = match[2]!
    .split(/\s+or\s+/i)
    .map((type) => type.trim())
    .filter((type): type is CardType => CARD_TYPES.some((cardType) => cardType.toLowerCase() === type.toLowerCase()))
    .map((type) => CARD_TYPES.find((cardType) => cardType.toLowerCase() === type.toLowerCase())!);
  if (!types.length) return null;
  return { kind: "look-top-select", amount, types, destination: "hand" };
}

function parseAethermagesTouch(text: string): SpellEffect | null {
  if (!/^Reveal the top four cards of your library. You may put a creature card from among them onto the battlefield. It gains "At the beginning of your end step, return (?:this creature|~) to its owner'?s hand." Then put the rest of the cards revealed this way on the bottom of your library in any order.?$/i.test(text.trim())) return null;
  return { kind: "look-top-select", amount: 4, types: ["Creature"], destination: "battlefield", returnAtEndStep: true };
}

function parseExileAndTransferSource(text: string): SpellEffect | null {
  if (/^Exile target artifact or enchantment$/i.test(text.trim().replace(/\.$/, ""))) {
    return { kind: "exile-target-permanent" };
  }
  if (/^Exile target artifact or enchantment\. If you do, its controller gains control of (?:this enchantment|~)$/i.test(text.trim())) {
    return { kind: "exile-target-permanent", gainSourceControl: "target-controller" };
  }
  return null;
}

function parseMultiBasicSearch(text: string): SpellEffect | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (/^Search your library for up to two basic land cards, (?:reveal those cards, )?put one onto the battlefield tapped and (?:the other|the rest) into your hand, then shuffle\.?$/i.test(normalized)) {
    return { kind: "search-library-multi", types: ["Land"], subtypes: ["Basic"], destinations: ["battlefield-tapped", "hand"], reveal: /reveal those cards/i.test(normalized) };
  }
  if (/^Search your library for up to two basic land cards, (?:reveal those cards, )?put them onto the battlefield tapped, then shuffle\.?$/i.test(normalized)) {
    return { kind: "search-library-multi", types: ["Land"], subtypes: ["Basic"], destinations: ["battlefield-tapped", "battlefield-tapped"], reveal: /reveal those cards/i.test(normalized) };
  }
  // Armillary Sphere's current Oracle uses "reveal them" while older
  // printings use "reveal those cards"; both share this search primitive (CR 701.19).
  if (/^Search your library for up to two basic land cards, reveal (?:those cards|them), put them into your hand, then shuffle\.?$/i.test(normalized)) {
    return { kind: "search-library-multi", types: ["Land"], subtypes: ["Basic"], destinations: ["hand", "hand"], reveal: true };
  }
  return null;
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

function parseManaSpentToken(text: string): SpellEffect | null {
  const suffix = /,?\s*where x is the amount of mana spent to cast it\.?$/i;
  if (!suffix.test(text.trim())) return null;
  const base = parseCreateToken(text.trim().replace(suffix, ""));
  return base?.kind === "create-token" ? { ...base, amount: "mana-spent" } : null;
}

function parseRevealTopCardConditional(text: string): SpellEffect | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!/^Reveal the top card of your library\. If it's a creature card, create a 1\/1 green Saproling creature token\. If it's a land card, put that card onto the battlefield under your control\. If it's a noncreature, nonland card, you gain 2 life\.?$/i.test(normalized)) return null;
  return {
    kind: "reveal-top-card-conditional",
    creatureToken: { name: "Saproling", typeLine: "Creature — Saproling", power: 1, toughness: 1, colors: ["G"], keywords: [], tapped: false },
    landDestination: "battlefield",
    fallbackLife: 2
  };
}

function parseRevealTopCardLandOrHand(text: string): SpellEffect | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!/^Reveal the top card of your library\. If it's a land card, put it onto the battlefield\. Otherwise, put it into your hand\.?$/i.test(normalized)) return null;
  return { kind: "reveal-top-card-land-or-hand" };
}

function parseRevealTopCardToHandAndGainManaValue(text: string): SpellEffect | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!/^Reveal the top card of your library and put that card into your hand\. You gain life equal to its mana value\.?$/i.test(normalized)) return null;
  return { kind: "reveal-top-card-to-hand-and-gain-mana-value" };
}

function parseRevealUntilTypeToHand(text: string): SpellEffect | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  const match = /^Reveal cards from the top of your library until you reveal a (artifact|creature|enchantment|instant|land|planeswalker|sorcery|battle) card\. Put that card into your hand and the rest into your graveyard\.?$/i.exec(normalized);
  if (!match) return null;
  const rawType = match[1]!;
  return {
    kind: "reveal-until-type-to-hand",
    type: rawType[0]!.toUpperCase() + rawType.slice(1) as CardType,
    restDestination: "graveyard"
  };
}

function parseRevealUntilNonlandToHand(text: string): SpellEffect | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!/^Reveal cards from the top of your library until you reveal a nonland card, then put all cards revealed this way into your hand\.?$/i.test(normalized)) return null;
  return { kind: "reveal-until-nonland-to-hand" };
}

/**
 * Recognises the trigger condition of one printed line.
 *
 * Each entry pairs an Oracle template with the event the engine raises and the
 * subject the event must involve. Anything outside this table is left unmatched
 * and reported as uncovered rather than attributed to the wrong permanent.
 */
type TriggerTemplate = {
  readonly event: TriggerEvent;
  readonly subject: TriggerSubject;
  readonly pattern: RegExp;
  readonly spellType?: "creature" | "noncreature" | "instant-or-sorcery";
  readonly spellColor?: string;
  readonly spellSubtype?: string;
  readonly nontoken?: boolean;
  readonly discardedCardType?: "creature" | "land" | "noncreature-nonland";
  /** A condition baked into the trigger phrase itself (e.g. "their second card each turn"), not the "if X, Y" style attached to effectText below. */
  readonly condition?: TriggerDefinition["condition"];
};

const TRIGGER_TEMPLATES: readonly TriggerTemplate[] = [
  { event: "library-shuffled", subject: "shuffle-controller", pattern: /^whenever a spell or ability causes its controller to shuffle their library,?\s*(that player puts a card from their hand on top of their library)\.?$/i },
  { event: "life-gained", subject: "you", pattern: /^whenever\s+you\s+gain\s+life,?\s*(.+)$/i },
  { event: "life-lost", subject: "you", pattern: /^whenever\s+you\s+lose\s+life,?\s*(.+)$/i },
  // The permanent that carries the ability is the object the event is about.
  { event: "enters-battlefield", subject: "self", pattern: /^(?:when|whenever)\s+~\s+enters(?:\s+the\s+battlefield)?,?\s*(.+)$/i },
  { event: "dies", subject: "self", pattern: /^(?:when|whenever)\s+~\s+dies,?\s*(.+)$/i },
  { event: "dies", subject: "self", pattern: /^(?:when|whenever)\s+~\s+is\s+put\s+into\s+a\s+graveyard\s+from\s+the\s+battlefield,?\s*(.+)$/i },
  // "~ or another creature dies" (Blood Artist, Falkenrath Noble) is CR
  // 109.5's "another" restored to include the source: any creature dying,
  // any controller. Equivalent to the plain "any-creature" subject below.
  { event: "dies", subject: "any-creature", pattern: /^whenever\s+~\s+or\s+another\s+creature\s+dies,?\s*(.+)$/i },
  // CR 603.6e fires this from every zone; the engine only models the
  // battlefield->graveyard case (by far the common one), so this is an
  // approximation rather than the full anywhere-trigger.
  { event: "dies", subject: "self", pattern: /^(?:when|whenever)\s+~\s+is\s+put\s+into\s+a\s+graveyard\s+from\s+anywhere,?\s*(.+)$/i },
  { event: "attacks", subject: "self", pattern: /^(?:when|whenever)\s+~\s+attacks(?:\s+for\s+the\s+first\s+time)?,?\s*(.+)$/i },
  { event: "blocks", subject: "self", pattern: /^(?:when|whenever)\s+~\s+blocks(?:\s+a\s+creature)?,?\s*(.+)$/i },
  { event: "deals-combat-damage-to-player", subject: "self", pattern: /^(?:when|whenever)\s+~\s+deals\s+combat\s+damage\s+to\s+a\s+player,?\s*(.+)$/i },
  { event: "becomes-tapped", subject: "self", pattern: /^(?:when|whenever)\s+~\s+becomes\s+tapped,?\s*(.+)$/i },
  // Equipment triggers about the creature it's attached to (Skullclamp,
  // Argentum Armor); the "equipped-creature" subject already exists for the
  // static P/T-doubler grant, wired here for the first time as a real event.
  { event: "dies", subject: "equipped-creature", pattern: /^whenever\s+equipped\s+creature\s+dies,?\s*(.+)$/i },
  { event: "attacks", subject: "equipped-creature", pattern: /^whenever\s+equipped\s+creature\s+attacks,?\s*(.+)$/i },

  // Another object triggers it. `another` excludes the source itself (CR 109.5).
  { event: "enters-battlefield", subject: "another-creature-you-control", pattern: /^whenever\s+another\s+creature\s+enters(?:\s+the\s+battlefield)?\s+under\s+your\s+control,?\s*(.+)$/i },
  // "another" must exclude the source itself (CR 109.5); kept as its own
  // template ahead of the bare "a creature you control enters" one below so a
  // real "another" in the Oracle text is never collapsed into the
  // self-inclusive subject (Ogre Battledriver, Cathars' Crusade).
  { event: "enters-battlefield", subject: "another-creature-you-control", pattern: /^whenever\s+another\s+creature\s+you\s+control\s+enters(?:\s+the\s+battlefield)?,?\s*(.+)$/i },
  { event: "enters-battlefield", subject: "creature-you-control", pattern: /^whenever\s+a?\s*creature\s+you\s+control\s+enters(?:\s+the\s+battlefield)?,?\s*(.+)$/i },
  { event: "enters-battlefield", subject: "another-permanent-you-control", pattern: /^whenever\s+another\s+permanent\s+enters(?:\s+the\s+battlefield)?\s+under\s+your\s+control,?\s*(.+)$/i },
  { event: "enters-battlefield", subject: "permanent-you-control", pattern: /^whenever\s+a\s+permanent\s+enters(?:\s+the\s+battlefield)?\s+under\s+your\s+control,?\s*(.+)$/i },
  { event: "enters-battlefield", subject: "creature-you-control", pattern: /^whenever\s+(?:a|another)?\s*creature\s+enters(?:\s+the\s+battlefield)?\s+under\s+your\s+control,?\s*(.+)$/i },
  { event: "enters-battlefield", subject: "land-you-control", pattern: /^whenever\s+a\s+land(?:\s+enters(?:\s+the\s+battlefield)?\s+under\s+your\s+control|\s+you\s+control\s+enters(?:\s+the\s+battlefield)?),?\s*(.+)$/i },
  { event: "enters-battlefield", subject: "artifact-you-control", pattern: /^whenever\s+an\s+artifact\s+enters(?:\s+the\s+battlefield)?\s+under\s+your\s+control,?\s*(.+)$/i },
  { event: "enters-battlefield", subject: "enchantment-you-control", pattern: /^whenever\s+an\s+enchantment\s+enters(?:\s+the\s+battlefield)?\s+under\s+your\s+control,?\s*(.+)$/i },
  // Errata dropped "under your control" from some printings (e.g. Essence
  // Warden, Soul Warden): the trigger now watches every creature entering,
  // not just the controller's own. Must stay after the "...under your
  // control" patterns above so those remain the first match when present.
  { event: "enters-battlefield", subject: "another-creature", pattern: /^whenever\s+another\s+creature\s+enters(?:\s+the\s+battlefield)?,?\s*(.+)$/i },
  { event: "dies", subject: "another-creature-you-control", nontoken: true, pattern: /^whenever\s+another\s+nontoken\s+creature\s+you\s+control\s+dies,?\s*(.+)$/i },
  { event: "dies", subject: "another-creature-you-control", pattern: /^whenever\s+another\s+creature\s+you\s+control\s+dies,?\s*(.+)$/i },
  { event: "dies", subject: "another-creature-you-control", nontoken: true, pattern: /^whenever\s+another\s+nontoken\s+creature\s+you\s+control\s+dies,?\s*(.+)$/i },
  { event: "dies", subject: "creature-you-control", pattern: /^whenever\s+~\s+or\s+another\s+creature\s+you\s+control\s+dies,?\s*(.+)$/i },
  { event: "dies", subject: "creature-you-control", pattern: /^whenever\s+a\s+creature\s+you\s+control\s+dies,?\s*(.+)$/i },
  { event: "dies", subject: "another-creature", pattern: /^whenever\s+another\s+creature\s+dies,?\s*(.+)$/i },
  { event: "dies", subject: "any-creature", pattern: /^whenever\s+a\s+creature\s+dies,?\s*(that\s+creature[’']s\s+controller\s+may\s+.+)$/i },
  { event: "dies", subject: "any-creature", pattern: /^whenever\s+a\s+creature\s+dies,?\s*(.+)$/i },
  { event: "leaves-battlefield", subject: "self-or-another-creature-you-control", pattern: /^whenever\s+~\s+or\s+another\s+creature\s+you\s+control\s+leaves(?:\s+the\s+battlefield)?,?\s*(.+)$/i },
  { event: "leaves-battlefield", subject: "self", pattern: /^(?:when|whenever)\s+~\s+leaves(?:\s+the\s+battlefield)?,?\s*(.+)$/i },
  { event: "attacks", subject: "creature-you-control", pattern: /^whenever\s+a\s+creature\s+you\s+control\s+attacks,?\s*(.+)$/i },
  { event: "attacks", subject: "creature-attacks-opponent", pattern: /^whenever\s+a\s+creature\s+attacks\s+one\s+of\s+your\s+opponents(?:\s+or\s+a\s+planeswalker\s+an\s+opponent\s+controls)?,?\s*(.+)$/i },
  { event: "attacks", subject: "creature-attacks-enchanted-player", pattern: /^whenever\s+a\s+creature\s+attacks\s+enchanted\s+player,?\s*(.+)$/i },
  { event: "attacks", subject: "player-attacks-enchanted-player", pattern: /^whenever\s+a\s+player\s+attacks\s+enchanted\s+player\s+with\s+one\s+or\s+more\s+creatures,?\s*(.+)$/i },
  { event: "deals-combat-damage-to-player", subject: "artifact-creature-you-control", pattern: /^whenever\s+an\s+artifact\s+creature\s+you\s+control\s+deals\s+combat\s+damage\s+to\s+a\s+player,?\s*(.+)$/i },
  { event: "deals-combat-damage-to-player", subject: "creature-with-deathtouch-you-control", pattern: /^whenever\s+a\s+creature\s+you\s+control\s+with\s+deathtouch\s+deals\s+combat\s+damage\s+to\s+a\s+player(?:\s+or\s+(?:a\s+)?planeswalker)?,?\s*(.+)$/i },
  { event: "deals-combat-damage-to-player", subject: "creature-you-control", pattern: /^whenever\s+a\s+creature\s+you\s+control\s+deals\s+combat\s+damage\s+to\s+a\s+player,?\s*(.+)$/i },
  { event: "deals-combat-damage-to-player", subject: "any-creature", pattern: /^whenever\s+a\s+creature\s+deals\s+combat\s+damage\s+to\s+a\s+player,?\s*(.+)$/i },
  { event: "deals-combat-damage-to-player", subject: "any-creature", pattern: /^whenever\s+a\s+creature\s+deals\s+combat\s+damage\s+to\s+one\s+of\s+your\s+opponents,?\s*(.+)$/i },
  // This event is raised for both combat and noncombat damage from a
  // permanent, unlike the combat-only templates above (CR 603.2).
  { event: "deals-damage-to-player", subject: "creature-with-deathtouch-you-control", pattern: /^whenever\s+a\s+creature\s+you\s+control\s+with\s+deathtouch\s+deals\s+damage\s+to\s+a\s+player(?:\s+or\s+(?:a\s+)?planeswalker)?,?\s*(.+)$/i },
  { event: "deals-damage-to-player", subject: "self", pattern: /^(?:when|whenever)\s+~\s+deals\s+damage\s+to\s+an?\s+opponent,?\s*(.+)$/i },

  // A player is the subject.
  { event: "spell-cast", subject: "you", pattern: /^when\s+you\s+cast\s+~,?\s*(.+)$/i },
  { event: "spell-cast", subject: "you", spellSubtype: "elf", pattern: /^whenever\s+you\s+cast\s+an\s+elf\s+spell,?\s*(.+)$/i },
  { event: "enters-battlefield", subject: "another-creature-you-control", nontoken: true, pattern: /^whenever\s+another\s+nontoken\s+creature\s+you\s+control\s+enters(?:\s+the\s+battlefield)?,?\s*(.+)$/i },
  { event: "spell-cast", subject: "you", spellType: "creature", pattern: /^whenever\s+you\s+cast\s+a\s+creature\s+spell,?\s*(.+)$/i },
  { event: "spell-cast", subject: "opponent", spellType: "creature", pattern: /^whenever\s+an\s+opponent\s+casts\s+a\s+creature\s+spell,?\s*(.+)$/i },
  { event: "spell-cast", subject: "you", spellType: "instant-or-sorcery", pattern: /^whenever\s+you\s+cast\s+an?\s+instant\s+or\s+sorcery\s+spell,?\s*(.+)$/i },
  { event: "spell-cast", subject: "each-player", pattern: /^(?:when|whenever)\s+a\s+player\s+casts\s+a\s+spell,?\s*(.+)$/i },
  { event: "spell-cast", subject: "each-player", spellType: "noncreature", pattern: /^whenever\s+a\s+player\s+casts\s+a\s+noncreature\s+spell,?\s*(.+)$/i },
  { event: "spell-cast", subject: "each-player", spellType: "instant-or-sorcery", pattern: /^whenever\s+a\s+player\s+casts\s+an?\s+instant\s+or\s+sorcery\s+spell,?\s*(.+)$/i },
  { event: "spell-cast", subject: "you", pattern: /^whenever\s+you\s+cast\s+a\s+spell,?\s*(.+)$/i },
  { event: "spell-cast", subject: "opponent", pattern: /^whenever\s+an\s+opponent\s+casts\s+a\s+spell,?\s*(.+)$/i },
  { event: "card-cycled", subject: "self", pattern: /^when\s+you\s+cycle\s+(?:this\s+card|~),?\s*(.+)$/i },
  { event: "card-drawn", subject: "each-player", pattern: /^whenever\s+a\s+player\s+draws\s+a\s+card,?\s*(.+)$/i },
  { event: "card-drawn", subject: "opponent", pattern: /^whenever\s+an\s+opponent\s+draws\s+a\s+card,?\s*(.+)$/i },
  { event: "card-drawn", subject: "you", pattern: /^whenever\s+you\s+draw\s+a\s+card,?\s*(.+)$/i },
  { event: "card-drawn", subject: "each-player", condition: { kind: "second-draw-this-turn" }, pattern: /^whenever\s+a\s+player\s+draws\s+their\s+second\s+card\s+each\s+turn,?\s*(.+)$/i },
  { event: "card-drawn", subject: "opponent", condition: { kind: "second-draw-this-turn" }, pattern: /^whenever\s+an\s+opponent\s+draws\s+their\s+second\s+card\s+each\s+turn,?\s*(.+)$/i },
  { event: "card-discarded", subject: "each-player", pattern: /^whenever\s+a\s+player\s+discards\s+a\s+card,?\s*(.+)$/i },
  { event: "card-discarded", subject: "opponent", pattern: /^whenever\s+an\s+opponent\s+discards\s+a\s+card,?\s*(.+)$/i },
  { event: "card-discarded", subject: "you", pattern: /^whenever\s+you\s+discard\s+a\s+card,?\s*(.+)$/i },
  { event: "card-discarded", subject: "opponent", discardedCardType: "creature", pattern: /^whenever\s+an\s+opponent\s+discards\s+a\s+creature\s+card,?\s*(.+)$/i },
  { event: "card-discarded", subject: "opponent", discardedCardType: "land", pattern: /^whenever\s+an\s+opponent\s+discards\s+a\s+land\s+card,?\s*(.+)$/i },
  { event: "card-discarded", subject: "opponent", discardedCardType: "noncreature-nonland", pattern: /^whenever\s+an\s+opponent\s+discards\s+an?\s+noncreature,\s*nonland\s+card,?\s*(.+)$/i },

  // Turn-structure triggers (CR 603.2b).
  { event: "upkeep", subject: "you", pattern: /^at\s+the\s+beginning\s+of\s+your\s+upkeep,?\s*(.+)$/i },
  { event: "upkeep", subject: "each-player", pattern: /^at\s+the\s+beginning\s+of\s+each\s+upkeep,?\s*(.+)$/i },
  { event: "upkeep", subject: "opponent", pattern: /^at\s+the\s+beginning\s+of\s+each\s+opponent[’']s\s+upkeep,?\s*(.+)$/i },
  { event: "draw-step", subject: "you", pattern: /^at\s+the\s+beginning\s+of\s+your\s+draw\s+step,?\s*(.+)$/i },
  { event: "draw-step", subject: "each-player", pattern: /^at\s+the\s+beginning\s+of\s+each\s+player[’']s\s+draw\s+step,?\s*(.+)$/i },
  { event: "end-step", subject: "you", pattern: /^at\s+the\s+beginning\s+of\s+your\s+end\s+step,?\s*(.+)$/i },
  { event: "end-step", subject: "each-player", pattern: /^at\s+the\s+beginning\s+of\s+each\s+end\s+step,?\s*(.+)$/i },
  { event: "end-step", subject: "each-player", pattern: /^at\s+the\s+beginning\s+of\s+each\s+player[’']s\s+end\s+step,?\s*(.+)$/i },
  { event: "end-step", subject: "opponent", pattern: /^at\s+the\s+beginning\s+of\s+each\s+opponent[’']s\s+end\s+step,?\s*(.+)$/i },

  // The action of playing a land (CR 305.1), not that land's own ETB (City of Traitors).
  { event: "play-land", subject: "you", pattern: /^when\s+you\s+play\s+(?:a|another)\s+land,?\s*(.+)$/i },
  // Specifically a mana ability's activation (Forbidden Orchard), narrower than
  // the general "becomes-tapped" — a non-mana tap effect must not trigger this.
  { event: "taps-for-mana", subject: "self", pattern: /^whenever\s+you\s+tap\s+~\s+for\s+mana,?\s*(.+)$/i }
];

function matchTriggerLine(line: string): (Omit<TriggerTemplate, "pattern"> & { effectText: string }) | null {
  // Landfall is a keyword ability word; its rules-bearing trigger follows the
  // dash and uses the same enters-battlefield event (CR 603.1, 603.2).
  const normalized = line.replace(/^landfall\s+[—–-]\s*/i, "").replace(/^morbid\s+[—–-]\s*/i, "");
  for (const template of TRIGGER_TEMPLATES) {
    const match = template.pattern.exec(normalized);
    if (match) return { event: template.event, subject: template.subject, effectText: match[1]!.trim(), ...(template.spellType ? { spellType: template.spellType } : {}), ...(template.spellColor ? { spellColor: template.spellColor } : {}), ...(template.spellSubtype ? { spellSubtype: template.spellSubtype } : {}), ...(template.nontoken ? { nontoken: true } : {}), ...(template.discardedCardType ? { discardedCardType: template.discardedCardType } : {}), ...(template.condition ? { condition: template.condition } : {}) };
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
function recognizeSentence(sentence: string): { effect: SpellEffect; target: TargetKind; targetKinds?: readonly Exclude<TargetKind, "none">[] } | null {
  // Trailing whitespace before the full stop appears when reminder text such as
  // "(an energy counter)" is stripped mid-sentence; drop it with the period.
  const text = sentence.trim().replace(/\s+/g, " ").replace(/\s*\.\s*$/, "").trim();
  let match: RegExpExecArray | null;

  const simple = simpleEffectIR(text);
  const simpleResult = simple ? simpleEffectFromIR(simple) : null;
  if (simpleResult) return simpleResult;
  if (/^Exile another target permanent\. Return that card to the battlefield under its owner'?s control at the beginning of the next end step$/i.test(text)) {
    return { effect: { kind: "exile-target-permanent-delayed-return" }, target: "permanent" };
  }

  if (/^Untap ~$/i.test(text)) return { effect: { kind: "untap-source" }, target: "none" };

  // "X. Then amass [Type] N" (Orcish Bowmasters, CR 701.44): the amass always
  // trails another effect, so recognize the lead effect and append amass.
  const thenAmass = /^(.+?)\.\s*Then amass ([A-Za-z]+) (\d+)$/i.exec(text);
  if (thenAmass) {
    const inner = recognizeSentence(thenAmass[1]!);
    if (inner) {
      return {
        effect: { kind: "compound", effects: [inner.effect, { kind: "amass", amount: Number(thenAmass[3]), tokenType: thenAmass[2]! }] },
        target: inner.target
      };
    }
  }

  // Ritual spells (Dark Ritual, Pyretic Ritual, Seething Song, Channel the
  // Suns): a one-shot mana burst as the spell's own effect, not a permanent's
  // activated ability. Only deterministic pools are modeled — a fixed color
  // repeated (`{B}{B}{B}`) or a fixed mix of distinct colors (`{W}{U}{B}{R}{G}`).
  // No printed ritual asks the caster to choose among colors, so that shape
  // is deliberately left unmatched rather than guessed at.
  if (/^Add (?:\{[WUBRGC]\})+$/i.test(text)) {
    const produced = parseAddClause(text);
    const pool: Record<string, number> | null = !produced ? null
      : produced.fixedProduces
        ? produced.fixedProduces.reduce<Record<string, number>>((acc, symbol) => ({ ...acc, [symbol]: (acc[symbol] ?? 0) + 1 }), {})
        : produced.produces.length === 1
          ? { [produced.produces[0]!]: produced.amount }
          : null;
    if (pool) return { effect: { kind: "add-mana", pool }, target: "none" };
  }
  // "Add one mana of any color" as a triggered/activated ability's own
  // resolution (Lotus Cobra's Landfall), not a mana ability: the caster picks
  // the color as part of resolving the effect, mirroring the existing
  // choose-color infrastructure for spell effects.
  if (/^Add one mana of any color$/i.test(text)) return { effect: { kind: "add-mana-any-color" }, target: "none" };
  const targetOpponentToken = /^Target opponent creates (.+)$/i.exec(text)
    ?? /^Create (.+) under target opponent'?s control$/i.exec(text);
  if (targetOpponentToken) {
    const token = parseCreateToken(`Create ${targetOpponentToken[1]!}`);
    if (token?.kind === "create-token") {
      const amount = token.amount === "X" || typeof token.amount === "number" ? token.amount : 1;
      return { effect: { kind: "create-token-for-target-player", amount, token: token.token }, target: "opponent" };
    }
  }

  if (/^The owner of target permanent shuffles it into their library, then reveals the top card of their library\. If it's a permanent card, they put it onto the battlefield$/i.test(text)) {
    return { effect: { kind: "chaos-warp" }, target: "permanent" };
  }
  // Swords to Plowshares: the exiled creature's power is read before it
  // leaves the battlefield (CR 613.7a last known information).
  if (/^Exile target creature\. Its controller gains life equal to its power$/i.test(text)) {
    return { effect: { kind: "exile-target-creature-then-life-gain-power" }, target: "creature" };
  }

  if (/^Sacrifice ~$/i.test(text)) return { effect: { kind: "sacrifice-source" }, target: "none" };

  // Standstill: "that player" refers to the player who cast the triggering
  // spell, so the executor must use TriggerInstance.eventController rather
  // than the enchantment controller.
  if ((match = /^Sacrifice ~\.\s*If you do,\s*each of that player['’]s opponents draws (\w+) cards?$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return {
      effect: { kind: "compound", effects: [{ kind: "sacrifice-source" }, { kind: "each-opponent-of-event-player-draws", amount }] },
      target: "none"
    };
  }

  // Oloro and similar triggers combine the controller's draw with a
  // table-wide life loss. Reuse the shared primitives instead of adding a
  // card-specific executor (CR 609.3, 118.1).
  const drawAndOpponentLoss = /^Draw (a|an|\w+) cards? and each opponent loses (\w+) life$/i.exec(text);
  if (drawAndOpponentLoss) {
    const draw = toNumber(drawAndOpponentLoss[1]);
    const life = toNumber(drawAndOpponentLoss[2]);
    if (draw !== null && life !== null) return {
      effect: { kind: "compound", effects: [{ kind: "draw", amount: draw }, { kind: "each-opponent-loses-life", amount: life }] },
      target: "none"
    };
  }

  const drawLose = /^(?:you\s+)?draw\s+(a|an|\w+)\s+cards?\s+and\s+(?:you\s+)?lose\s+(\w+)\s+life$/i.exec(text);
  if (drawLose) {
    const drawAmount = toNumber(drawLose[1]);
    const lifeAmount = toNumber(drawLose[2]);
    if (drawAmount !== null && lifeAmount !== null) return {
      effect: { kind: "compound", effects: [{ kind: "draw", amount: drawAmount }, { kind: "lose-life", amount: lifeAmount }] },
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
  if ((match = /^(?:You )?[Dd]raw (\w+) cards? at the beginning of the next turn'?s upkeep$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null && amount > 0) return { effect: { kind: "delayed-draw", amount }, target: "none" };
  }
  if ((match = /^Then if you have more life than an opponent, draw (\w+) cards?$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "draw-if-life-more-than-opponent", amount }, target: "none" };
  }
  // Trigger parsing removes the optional prefix before handing the effect to
  // this shared grammar (e.g. Grazing Gladehart: "you may gain 2 life").
  // Accept both spell-style and executable trigger wording so optional life
  // gain reuses the same primitive (CR 603.5, 609.3).
  if ((match = /^(?:You )?gain (\w+) life$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount) return { effect: { kind: "gain-life", amount }, target: "none" };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "gain-life", amount: "X" }, target: "none" };
  }
  if (/^You gain life equal to the sacrificed creature's toughness$/i.test(text)) {
    return { effect: { kind: "gain-life-equal-sacrificed-toughness" }, target: "none" };
  }
  if ((match = /^You gain (\w+) life for each (artifact|creature|enchantment|land|planeswalker|battle) you control$/i.exec(text))) {
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
  if (/^Whenever you gain life this turn, each opponent loses that much life$/i.test(text)) {
    return { effect: { kind: "grant-life-gain-opponent-loss" }, target: "none" };
  }
  if ((match = /^Each opponent loses (\w+) life$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount) return { effect: { kind: "each-opponent-loses-life", amount }, target: "none" };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "each-opponent-loses-life", amount: "X" }, target: "none" };
  }
  // Zulaport Cutthroat template (CR 119.3): a drain that hits every opponent
  // at once, unlike Blood Artist's single "target player" variant above.
  if ((match = /^Each opponent loses (\w+) life and you gain \1 life$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount) return {
      effect: { kind: "compound", effects: [{ kind: "each-opponent-loses-life", amount }, { kind: "gain-life", amount }] },
      target: "none"
    };
  }
  // "that player" in these two refers back to the event's own player (e.g.
  // the opponent who drew the card that triggered this), not a chosen
  // target — CR 603.3d. Resolved from `object.trigger?.eventController`.
  if ((match = /^~ deals (\w+) damage to (?:that player|them)$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount) return { effect: { kind: "damage-event-player", amount }, target: "none" };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "damage-event-player", amount: "X" }, target: "none" };
  }
  if ((match = /^~ deals (\w+) damage to you$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "damage-controller", amount }, target: "none" };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "damage-controller", amount: "X" }, target: "none" };
  }
  if ((match = /^(?:That player|They) lose(?:s)? (\w+) life$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount) return { effect: { kind: "lose-life-event-player", amount }, target: "none" };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "lose-life-event-player", amount: "X" }, target: "none" };
  }
  const damageAndLife = /^~ deals (\w+) damage to any target and you gain (\w+) life$/i.exec(text);
  if (damageAndLife) {
    const damage = damageAndLife[1]!.toUpperCase() === "X" ? "X" as const : toNumber(damageAndLife[1]!);
    const life = damageAndLife[2]!.toUpperCase() === "X" ? "X" as const : toNumber(damageAndLife[2]!);
    if (damage !== null && life !== null) {
      return {
        effect: { kind: "compound", effects: [{ kind: "damage-any-target", amount: damage }, { kind: "gain-life", amount: life }] },
        target: "any"
      };
    }
  }
  const damageAndSelf = /^~ deals (\w+) damage to any target and (\w+) damage to you$/i.exec(text);
  if (damageAndSelf) {
    const damage = damageAndSelf[1]!.toUpperCase() === "X" ? "X" as const : toNumber(damageAndSelf[1]!);
    const selfDamage = damageAndSelf[2]!.toUpperCase() === "X" ? "X" as const : toNumber(damageAndSelf[2]!);
    if (damage !== null && selfDamage !== null) {
      return {
        effect: { kind: "compound", effects: [{ kind: "damage-any-target", amount: damage }, { kind: "damage-controller", amount: selfDamage }] },
        target: "any"
      };
    }
  }
  if ((match = /^~ deals (\w+) damage to any target$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "damage-any-target", amount }, target: "any" };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "damage-any-target", amount: "X" }, target: "any" };
  }
  // "~ deals N damage to target opponent" (painful ETB taplands, direct burn):
  // the damage executor already handles a player target; only the target kind
  // narrows to opponents.
  if ((match = /^~ deals (\w+) damage to target (opponent|player)$/i.exec(text))) {
    const amount = toNumber(match[1]);
    const target = match[2]!.toLowerCase() === "opponent" ? "opponent" as const : "player" as const;
    if (amount !== null) return { effect: { kind: "damage-any-target", amount }, target };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "damage-any-target", amount: "X" }, target };
  }
  if (/^~ deals damage equal to the sacrificed creature's power to any target$/i.test(text)) {
    return { effect: { kind: "damage-any-target-equal-sacrificed-creature-power" }, target: "any" };
  }
  if (/^~ deals damage equal to its power to any target$/i.test(text)) {
    return { effect: { kind: "damage-triggered-creature-power" }, target: "any" };
  }
  if (/^~ deals damage equal to its power to target player or planeswalker$/i.test(text)) {
    return { effect: { kind: "damage-triggered-creature-power" }, target: "player-or-planeswalker" };
  }
  if (/^put a \+1\/\+1 counter on (?:it|that creature)\.?$/i.test(text)) {
    return { effect: { kind: "add-counter-triggered-creature", counter: "+1/+1", amount: 1 }, target: "none" };
  }
  if (/^its controller gains (\w+) life\.?$/i.test(text)) {
    const amount = toNumber(/^its controller gains (\w+) life\.?$/i.exec(text)![1]!);
    if (amount !== null) return { effect: { kind: "gain-life-event-controller", amount }, target: "none" };
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
  // "Look at target player's hand" (Gitaxian Probe, CR 701.20): a private
  // reveal to the caster alone, resolved via a self-closing pendingChoice —
  // it never crosses the hidden-information boundary the same way a public
  // reveal or a card-transfer effect would, since only the caster's own
  // projection ever includes the target's hand.
  if (/^Look at target player'?s hand$/i.test(text)) {
    return { effect: { kind: "look-at-target-players-hand" }, target: "player" };
  }
  if (/^Target player draws cards equal to half the number of cards in their library and loses half their life$/i.test(text)) {
    return { effect: { kind: "draw-half-library-then-lose-half-life-target-player" }, target: "player" };
  }
  if ((match = /^Target player draws (\w+) cards?$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "draw-target-player", amount }, target: "player" };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "draw-target-player", amount: "X" }, target: "player" };
  }
  // Energy is a player counter, not mana. Keep the parser exact so mana symbols
  // in unrelated sentences are never reclassified (CR 121.1, 121.3).
  if ((match = /^You get ((?:\{E\})+)$/i.exec(text))) {
    return { effect: { kind: "add-player-counter", counter: "energy", amount: (match[1]!.match(/\{E\}/gi) ?? []).length }, target: "none" };
  }
  // Sign in Blood pattern: one target player both draws and pays the life,
  // reusing the existing single-player draw and life-loss effect kinds
  // resolved against the same stack-object target (Sign in Blood, Blood Pact,
  // Painful Lesson, Harrowing Journey, Damnable Pact).
  if ((match = /^Target player draws (\w+) cards? and loses (\w+) life$/i.exec(text))) {
    const drawAmount = toNumber(match[1]) ?? (match[1]!.toUpperCase() === "X" ? "X" as const : null);
    const lifeAmount = toNumber(match[2]) ?? (match[2]!.toUpperCase() === "X" ? "X" as const : null);
    if (drawAmount !== null && lifeAmount !== null) return {
      effect: { kind: "compound", effects: [{ kind: "draw-target-player", amount: drawAmount }, { kind: "lose-life-target-player", amount: lifeAmount }] },
      target: "player"
    };
  }
  if ((match = /^Scry (\d+)$/i.exec(text))) return { effect: { kind: "scry", amount: Number(match[1]) }, target: "none" };
  if ((match = /^Surveil (\d+)$/i.exec(text))) return { effect: { kind: "surveil", amount: Number(match[1]) }, target: "none" };
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
  if ((match = /^(?:~|This spell) deals (\w+) damage to each creature with flying$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "damage-flying-creatures", amount }, target: "none" };
    if (match[1]!.toUpperCase() === "X") return { effect: { kind: "damage-flying-creatures", amount: "X" }, target: "none" };
  }
  if (/^That player draws an additional card$/i.test(text)) {
    return { effect: { kind: "draw-active-player" }, target: "none" };
  }
  if (/^That player puts the cards in their hand on the bottom of their library in any order, then draws that many cards$/i.test(text)) {
    return { effect: { kind: "put-active-player-hand-on-library-bottom-then-draw-same" }, target: "none" };
  }
  if ((match = /^That player draws a card\.\s*If the player is your opponent and has (\w+) or more cards in hand,\s*~\s*deals (\w+) damage to that player$/i.exec(text))) {
    const handAtLeast = toNumber(match[1]);
    const damage = toNumber(match[2]);
    if (handAtLeast !== null && damage !== null) {
      return { effect: { kind: "draw-active-player-then-damage-if-opponent-hand-at-least", handAtLeast, damage }, target: "none" };
    }
  }
  if (/^That player puts a card from their hand on top of their library$/i.test(text)) {
    return { effect: { kind: "put-event-player-hand-card-on-library-top" }, target: "none" };
  }
  if (/^Copy that spell\. You may choose new targets for the copy$/i.test(text)) {
    return { effect: { kind: "copy-triggered-spell" }, target: "none" };
  }
  if (/^Exchange its power and the power of target creature it's blocking until end of combat$/i.test(text)) {
    return { effect: { kind: "exchange-source-power-with-blocking-creature" }, target: "blocked-creature" };
  }
  if (/^Reveal the top card of your library and put that card into your hand\. You gain life equal to its mana value$/i.test(text)) {
    return { effect: { kind: "reveal-top-card-to-hand-and-gain-mana-value" }, target: "none" };
  }
  if (/^Each player reveals the top card of their library\. (?:~|this creature) enters with X \+1\/\+1 counters on it, where X is the total mana value of all cards revealed this way\.?$/i.test(text)) {
    return { effect: { kind: "reveal-top-cards-and-add-source-counters" }, target: "none" };
  }
  const revealUntil = parseRevealUntilTypeToHand(text);
  if (revealUntil) return { effect: revealUntil, target: "none" };
  const revealUntilNonland = parseRevealUntilNonlandToHand(text);
  if (revealUntilNonland) return { effect: revealUntilNonland, target: "none" };
  if (/^Draw a card for each tapped creature target opponent controls$/i.test(text)) {
    return { effect: { kind: "draw-equal-tapped-creatures" }, target: "opponent" };
  }
  if ((match = /^Draw a card for each (creature|artifact|enchantment|land|planeswalker|battle) you control$/i.exec(text))) {
    const type = match[1]![0]!.toUpperCase() + match[1]!.slice(1) as CardType;
    return { effect: { kind: "draw-equal-controlled-type", type }, target: "none" };
  }
  if ((match = /^Draw a card for each (white|blue|black|red|green) creature you control$/i.exec(text))) {
    const COLOR: Record<string, string> = { white: "W", blue: "U", black: "B", red: "R", green: "G" };
    return { effect: { kind: "draw-equal-controlled-color-creature", color: COLOR[match[1]!.toLowerCase()]! }, target: "none" };
  }
  if (/^You and that player each draw that many cards?$/i.test(text)) {
    return { effect: { kind: "draw-combat-damage-participants" }, target: "none" };
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
  if ((match = /^Each opponent discards (a|an|one|two|three|\d+) cards?$/i.exec(text))) {
    const amount = /^(a|an|one)$/i.test(match[1]!) ? 1 : toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "each-opponent-discards", amount }, target: "none" };
  }
  if (/^If the (?:\{[^}]+\})+ cost was paid, an opponent draws a card$/i.test(text)) {
    return { effect: { kind: "opponent-draws-if-cast-via-alternative-cost" }, target: "none" };
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
  if (/^Target opponent loses that much life$/i.test(text)) {
    return { effect: { kind: "lose-life-target-event-amount" }, target: "opponent" };
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
  // Blood Artist pattern: the chosen player pays the life, the controller
  // heals for the same source event. Deliberately numeric-only — an "X" here
  // is always defined by a card-specific source (sacrificed creature's power,
  // Domain, etc.), not a spell's own {X} cost, so it is left pending instead
  // of silently resolving to zero.
  if ((match = /^Target player loses (\w+) life and you gain (\w+) life$/i.exec(text))) {
    const lifeLost = toNumber(match[1]);
    const lifeGained = toNumber(match[2]);
    if (lifeLost !== null && lifeGained !== null) return {
      effect: { kind: "compound", effects: [{ kind: "lose-life-target-player", amount: lifeLost }, { kind: "gain-life", amount: lifeGained }] },
      target: "player"
    };
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
  if ((match = /^That player or that planeswalker['’]s controller discards (a|an|one|two|three|four|five|\d+) cards?$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "discard-target-player-or-planeswalker", amount }, target: "none" };
  }
  if (/^Discard a card\. If the player does, they draw a card$/i.test(text)) {
    return { effect: { kind: "discard-event-controller-then-draw", amount: 1 }, target: "none" };
  }
  if ((match = /^Target player discards X cards?$/i.exec(text))) return { effect: { kind: "discard-target-player", amount: "X" }, target: "player" };
  if ((match = /^Target player discards (\w+) cards?, then draws as many cards as they discarded this way$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null && amount > 0) return { effect: { kind: "discard-target-player-then-draw-same", amount }, target: "player" };
  }
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
  // Rummage: "discard a card. If you do, draw a card" (also "discard N cards, then draw N cards").
  // The optional "you may" is stripped by the trigger parser before this point.
  if ((match = /^(?:You )?discard (a|an|one|two|three|\d+) cards?(?:\.\s*If you do,|,\s*then) draw (a|an|one|two|three|\d+) cards?$/i.exec(text))) {
    const discard = /^(a|an|one)$/i.test(match[1]!) ? 1 : toNumber(match[1]);
    const draw = /^(a|an|one)$/i.test(match[2]!) ? 1 : toNumber(match[2]);
    if (discard !== null && draw !== null && discard > 0 && discard === draw) {
      return { effect: { kind: "discard-then-draw", amount: discard }, target: "none" };
    }
  }
  if ((match = /^Draw (\w+) cards?\.\s*If you do, discard (\w+) cards?$/i.exec(text))) {
    const draw = toNumber(match[1]);
    const discard = toNumber(match[2]);
    if (draw !== null && draw > 0 && discard !== null && discard > 0) return { effect: { kind: "draw-then-discard", draw, discard }, target: "none" };
  }
  if ((match = /^Draw (\w+) cards?, then put (\w+) cards? from your hand on top of your library in any order$/i.exec(text))) {
    const draw = toNumber(match[1]);
    const putBack = toNumber(match[2]);
    if (draw !== null && draw > 0 && putBack !== null && putBack > 0) return { effect: { kind: "draw-then-put-back-on-top", draw, putBack }, target: "none" };
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
  // "Target creature an opponent controls gets -1/-1 until end of turn" (Eyeblight
  // Assassin, Orc Sureshot): same modifier, but the target kind narrows.
  if ((match = /^Target creature an opponent controls gets ([+-]\d+)\/([+-]\d+) until end of turn$/i.exec(text))) {
    return { effect: { kind: "modify-target-creature", power: Number(match[1]), toughness: Number(match[2]) }, target: "creature-opponent" };
  }
  if ((match = /^Until end of turn, creatures you control have base power and toughness (X|\d+)\/(X|\d+) and gain all creature types\.?$/i.exec(text))) {
    const power = match[1]!.toUpperCase() === "X" ? "X" as const : Number(match[1]);
    const toughness = match[2]!.toUpperCase() === "X" ? "X" as const : Number(match[2]);
    return { effect: { kind: "set-creatures-you-control-base-pt-all-types", power, toughness }, target: "none" };
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
  // Same effect, "until end of turn" trailing instead of leading (Pathbreaker Ibex's attack trigger).
  if (/^creatures you control gain trample and get \+X\/\+X until end of turn, where X is the greatest power among creatures you control$/i.test(text)) {
    return { effect: { kind: "overwhelming-stampede" }, target: "none" };
  }
  // Craterhoof Behemoth: same shape, X is the creature COUNT instead of the greatest power.
  if (/^creatures you control gain trample and get \+X\/\+X until end of turn, where X is the number of creatures you control$/i.test(text)) {
    return { effect: { kind: "creature-count-stampede" }, target: "none" };
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
  if (/^Return to your hand all creature cards that were put into your graveyard from the battlefield this turn$/i.test(text)) {
    return { effect: { kind: "return-creatures-died-this-turn-to-hand" }, target: "none" };
  }
  if ((match = /^Attacking creatures get ([+-]\d+)\/([+-]\d+) until end of turn$/i.exec(text))) {
    return { effect: { kind: "modify-all-attacking-creatures", power: Number(match[1]), toughness: Number(match[2]) }, target: "none" };
  }
  if (/^Target player sacrifices an attacking creature of their choice$/i.test(text)) {
    return { effect: { kind: "target-player-sacrifice-attacking-creature" }, target: "player" };
  }
  if (/^Target player sacrifices a creature of their choice$/i.test(text)) {
    return { effect: { kind: "target-player-sacrifice-creature" }, target: "player" };
  }
  if (/^Target opponent sacrifices a creature of their choice$/i.test(text)) {
    return { effect: { kind: "target-player-sacrifice-creature" }, target: "opponent" };
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
  const temporaryKeyword = /^Target creature gains (flying|reach|first strike|double strike|deathtouch|trample|vigilance|lifelink|menace|defender|haste|indestructible|hexproof|shroud|fear|intimidate) until end of turn$/i.exec(text);
  if (temporaryKeyword) return { effect: { kind: "grant-target-creature-keyword", keyword: temporaryKeyword[1]!.toLowerCase() as EnforcedKeyword }, target: "creature" };
  const thresholdKeyword = /^Target creature with power 5 or greater gains (flying|reach|first strike|double strike|deathtouch|trample|vigilance|lifelink|menace|defender|haste|indestructible|hexproof|shroud|fear|intimidate) until end of turn$/i.exec(text);
  if (thresholdKeyword) return { effect: { kind: "grant-target-creature-keyword", keyword: thresholdKeyword[1]!.toLowerCase() as EnforcedKeyword }, target: "creature-power-at-least-5" };
  const globalKeyword = /^Permanents you control gain (flying|reach|first strike|double strike|deathtouch|trample|vigilance|lifelink|menace|defender|haste|indestructible|hexproof|shroud|fear|intimidate) until end of turn$/i.exec(text);
  if (globalKeyword) return { effect: { kind: "grant-permanents-you-control-keyword", keyword: globalKeyword[1]!.toLowerCase() as EnforcedKeyword }, target: "none" };
  const creaturesKeyword = /^Creatures you control gain (flying|reach|first strike|double strike|deathtouch|trample|vigilance|lifelink|menace|defender|haste|indestructible|hexproof|shroud|fear|intimidate) until end of turn$/i.exec(text);
  if (creaturesKeyword) return { effect: { kind: "grant-creatures-you-control-keyword", keyword: creaturesKeyword[1]!.toLowerCase() as EnforcedKeyword }, target: "none" };
  const allKeyword = /^All creatures gain (flying|reach|first strike|double strike|deathtouch|trample|vigilance|lifelink|menace|defender|haste|indestructible|hexproof|shroud|fear|intimidate) until end of turn$/i.exec(text);
  if (allKeyword) return { effect: { kind: "grant-all-creatures-keyword", keyword: allKeyword[1]!.toLowerCase() as EnforcedKeyword }, target: "none" };
  const combined = /^Target creature gets ([+-]\d+)\/([+-]\d+) and gains (flying|reach|first strike|double strike|deathtouch|trample|vigilance|lifelink|menace|defender|haste|indestructible|hexproof|shroud|fear|intimidate) until end of turn$/i.exec(text);
  if (combined) return {
    effect: { kind: "modify-and-grant-target-creature", power: Number(combined[1]), toughness: Number(combined[2]), keyword: combined[3]!.toLowerCase() as EnforcedKeyword },
    target: "creature"
  };
  const triggeredCombined = /^~ gets ([+-]\d+)\/([+-]\d+) and gains (flying|reach|first strike|double strike|deathtouch|trample|vigilance|lifelink|menace|defender|haste|indestructible|hexproof|shroud|fear|intimidate) until end of turn$/i.exec(text);
  if (triggeredCombined) return {
    effect: {
      kind: "modify-triggered-creature-and-grant-keyword",
      power: Number(triggeredCombined[1]),
      toughness: Number(triggeredCombined[2]),
      keyword: triggeredCombined[3]!.toLowerCase() as EnforcedKeyword
    },
    target: "none"
  };
  const selfKeyword = /^~ gains (flying|reach|first strike|double strike|deathtouch|trample|vigilance|lifelink|menace|haste|indestructible|hexproof|shroud|fear|intimidate) until end of turn$/i.exec(text);
  if (selfKeyword) return {
    effect: { kind: "grant-source-keyword", keyword: selfKeyword[1]!.toLowerCase() as EnforcedKeyword },
    target: "none"
  };
  const triggeredSelfPump = /^~ gets ([+-]\d+)\/([+-]\d+) until end of turn$/i.exec(text);
  if (triggeredSelfPump) return {
    effect: { kind: "modify-source-creature", power: Number(triggeredSelfPump[1]), toughness: Number(triggeredSelfPump[2]) },
    target: "none"
  };
  if (/^(?:~|This artifact) becomes a 2\/2 white and blue Bird artifact creature with flying until end of turn$/i.test(text)) {
    return {
      effect: { kind: "animate-source", power: 2, toughness: 2, colors: ["W", "U"], subtypes: ["Bird"], keywords: ["flying"] },
      target: "none"
    };
  }
  if (/^(?:~|This land) becomes a 2\/1 blue Faerie creature with flying until end of turn\. It's still a land\.?$/i.test(text)) {
    return {
      effect: { kind: "animate-source", power: 2, toughness: 1, colors: ["U"], subtypes: ["Faerie"], keywords: ["flying"], types: ["Land", "Creature"] },
      target: "none"
    };
  }
  if (/^Proliferate\.?$/i.test(text)) return { effect: { kind: "proliferate" }, target: "none" };

  if ((match = /^Put (a|an|one|two|three|four|five|\d+) (\+1\/\+1|-1\/-1) counter(?:s)? on target creature$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "add-counter-target-creature", counter: match[2]!, amount }, target: "creature" };
  }
  if ((match = /^Put (a|an|one|two|three|four|five|\d+) (\+1\/\+1|-1\/-1) counter(?:s)? on target creature you control$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "add-counter-target-creature", counter: match[2]!, amount }, target: "creature-you-control" };
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
  if ((match = /^Put (a|an|one|two|three|four|five|\d+) (\+1\/\+1|-1\/-1) counter(?:s)? on each creature you control and (?:a|an|one|two|three|four|five|\d+) loyalty counter on each other planeswalker you control$/i.exec(text))) {
    const amount = toNumber(match[1]);
    const loyaltyAmount = toNumber(text.match(/and (a|an|one|two|three|four|five|\d+) loyalty counter/i)?.[1] ?? "") ?? 1;
    if (amount !== null) {
      return { effect: { kind: "add-counter-creatures-and-other-planeswalkers", counter: match[2]!, amount, planeswalkerAmount: loyaltyAmount }, target: "none" };
    }
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
  if ((match = /^~ deals (\w+) damage to each attacking creature( without flying)?$/i.exec(text))) {
    const amount = match[1]!.toUpperCase() === "X" ? "X" as const : toNumber(match[1]!);
    if (amount !== null) return { effect: { kind: "damage-attacking-creatures", amount, ...(match[2] ? { filter: "without-flying" as const } : {}) }, target: "none" };
  }
  if ((match = /^Look at the top (\w+) cards of your library\. Put one of them into your hand and the other(?:s)? on the bottom of your library in any order$/i.exec(text))
      || (match = /^Look at the top (\w+) cards of your library\. Put one of them into your hand and the rest on the bottom of your library in any order$/i.exec(text))
      || (match = /^Look at the top (\w+) cards of your library\. Put one of them into your hand and the other on the bottom of your library$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null && amount > 1) return { effect: { kind: "look-put-one-in-hand", amount }, target: "none" };
  }
  if ((match = /^Look at the top (\w+) cards of your library\. Put one of them into your hand and the rest into your graveyard$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null && amount > 1) return { effect: { kind: "look-put-one-in-hand", amount, restDestination: "graveyard" }, target: "none" };
  }
  if ((match = /^Scry (\w+)$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null && amount > 0) return { effect: { kind: "scry", amount }, target: "none" };
  }
  if ((match = /^Surveil (\w+)$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null && amount > 0) return { effect: { kind: "surveil", amount }, target: "none" };
  }
  if ((match = /^Scry (\w+), then draw (\w+) cards?$/i.exec(text))) {
    const amount = toNumber(match[1]);
    const draw = toNumber(match[2]);
    if (amount !== null && amount > 0 && draw !== null && draw > 0) return { effect: { kind: "scry", amount, thenDraw: draw }, target: "none" };
  }
  if (/^Destroy target creature\. Its controller loses life equal to its power plus its toughness$/i.test(`${text}.`)) {
    return { effect: { kind: "destroy-target-creature-then-life-loss" }, target: "creature" };
  }
  if (/^Each player gains control of all nontoken permanents they own$/i.test(text)) {
    return { effect: { kind: "return-owned-nontoken-permanents-to-control" }, target: "none" };
  }
  if (/^Each player gains control of all creatures they own$/i.test(text)) {
    return { effect: { kind: "return-owned-creatures-to-control" }, target: "none" };
  }
  if (/^Target opponent chosen at random gains control of ~$/i.test(text)) {
    return { effect: { kind: "gain-control-of-source-random-opponent" }, target: "none" };
  }
  if (/^Return all permanents of the color of your choice to their owners' hands\.?$/i.test(text)) {
    return { effect: { kind: "return-all-permanents-of-color", color: "chosen" }, target: "none" };
  }
  if (/^~ deals X damage to each creature of the chosen color\.?$/i.test(text)) {
    return { effect: { kind: "damage-all-creatures-of-color", amount: "X", color: "chosen" }, target: "none" };
  }
  if (/^Destroy target creature$/i.test(text)) return { effect: { kind: "destroy-target-creature" }, target: "creature" };
  if (/^Destroy target artifact or creature with mana value X\.?$/i.test(text)) {
    return { effect: { kind: "destroy-target-artifact-or-creature-mana-value" }, target: "artifact-or-creature" };
  }
  if ((match = /^That creature gets ([+-]\d+)\/([+-]\d+) until end of turn$/i.exec(text))) {
    return { effect: { kind: "modify-triggered-creature", power: Number(match[1]), toughness: Number(match[2]) }, target: "none" };
  }
  if ((match = /^That creature gets ([+-]\d+)\/([+-]\d+) and gains (flying|reach|first strike|double strike|deathtouch|trample|vigilance|lifelink|menace|defender|haste|indestructible|hexproof|shroud|fear|intimidate) until end of turn$/i.exec(text))) {
    return {
      effect: { kind: "modify-event-creature-and-grant-keyword", power: Number(match[1]), toughness: Number(match[2]), keyword: match[3]!.toLowerCase() as EnforcedKeyword },
      target: "none"
    };
  }
  // "it gains KEYWORD until end of turn" (Atarka, World Render): the event
  // object (the attacking creature), not the ability's own source.
  if ((match = /^it gains (flying|reach|first strike|double strike|deathtouch|trample|vigilance|lifelink|menace|defender|haste|indestructible|hexproof|shroud|fear|intimidate) until end of turn$/i.exec(text))) {
    return {
      effect: { kind: "modify-event-creature-and-grant-keyword", power: 0, toughness: 0, keyword: match[1]!.toLowerCase() as EnforcedKeyword },
      target: "none"
    };
  }
  if (/^~ gets \+X\/\+0 until end of turn, where X is the number of lands defending player controls$/i.test(text)) {
    return { effect: { kind: "modify-triggered-creature-by-defending-lands" }, target: "none" };
  }
  if ((match = /^Each player discards their hand, then draws (\w+) cards?$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "each-player-discard-and-draw", amount }, target: "none" };
  }
  if (/^Each player discards their hand, then draws cards equal to the greatest number of cards a player discarded this way$/i.test(text)) {
    return { effect: { kind: "each-player-discard-and-draw-greatest" }, target: "none" };
  }
  if (/^Each player draws a card, then discards a card$/i.test(text)) {
    return { effect: { kind: "each-player-draws-then-discards" }, target: "none" };
  }
  if (/^Target player discards their hand$/i.test(text)) return { effect: { kind: "discard-target-player-hand" }, target: "player" };
  if ((match = /^Put (a|an|one|two|three|four|five|\d+) ([A-Za-z][A-Za-z -]*) counter(?:s)? on (?:~|this (?:artifact|enchantment|creature|permanent|land))$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount !== null) return { effect: { kind: "add-counter-source", counter: match[2]!.trim().toLowerCase(), amount }, target: "none" };
  }
  if (/^All creatures get -X\/-X until end of turn$/i.test(text)) {
    return { effect: { kind: "modify-all-creatures-minus-X" }, target: "none" };
  }
  if ((match = /^All creatures get (-?\d+)\/(-?\d+) until end of turn$/i.exec(text))) {
    return { effect: { kind: "modify-all-creatures", power: Number(match[1]), toughness: Number(match[2]) }, target: "none" };
  }
  if (/^Target player sacrifices an attacking creature of their choice$/i.test(text)) {
    return { effect: { kind: "target-player-sacrifice-attacking-creature" }, target: "player" };
  }
  if (/^(?:You may )?exile another target creature$/i.test(text)) {
    return { effect: { kind: "exile-target-nontoken-creature", returnOnSourceLeave: true }, target: "nontoken-creature" };
  }
  if (/^(?:You may )?exile target nontoken creature$/i.test(text)) return { effect: { kind: "exile-target-nontoken-creature" }, target: "nontoken-creature" };
  if (/^Return the exiled card to the battlefield under its owner'?s control$/i.test(text)) {
    return { effect: { kind: "return-exiled-card" }, target: "none" };
  }
  if (/^Exile target creature you control, then return that card to the battlefield under your control$/i.test(text)) {
    return { effect: { kind: "blink-target-creature" }, target: "creature-you-control" };
  }
  if (/^Destroy target creature$/i.test(text)) return { effect: { kind: "destroy-target-creature" }, target: "creature" };
  if (/^Destroy target creature or enchantment$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "creature-or-enchantment" };
  if (/^Destroy target artifact or creature$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "artifact-or-creature" };
  if (/^Destroy up to X target nonblack creatures, where X is the number of verse counters on (?:~|this enchantment)\.?\s*(?:They can'?t be regenerated\.?)?$/i.test(text)) {
    return { effect: { kind: "destroy-n-creatures", count: "X", nonblack: true, counter: "verse" }, target: "nonblack-creature" };
  }
  if (/^Destroy target artifact or enchantment$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "artifact-or-enchantment" };
  if (/^Destroy target artifact$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "artifact" };
  if (/^Destroy target enchantment$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "enchantment" };
  if (/^Destroy target artifact and target enchantment$/i.test(text)) {
    return {
      effect: {
        kind: "compound",
        effects: [{ kind: "destroy-target-permanent" }, { kind: "destroy-target-permanent" }],
        targetOffsets: [0, 1]
      },
      target: "artifact",
      targetKinds: ["artifact", "enchantment"]
    };
  }
  if (/^Destroy target land\.\s*Its controller may search their library for a basic land card, put it onto the battlefield, then shuffle$/i.test(text)) {
    return { effect: { kind: "destroy-target-land-search-basic" }, target: "land" };
  }
  if (/^Destroy target land$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "land" };
  if (/^Destroy target nonbasic land$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "nonbasic-land" };
  if (/^Destroy target artifact, creature, or planeswalker$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "artifact-creature-or-planeswalker" };
  if (/^Exile target creature or planeswalker$/i.test(text)) return { effect: { kind: "exile-target-permanent" }, target: "creature-or-planeswalker" };
  if (/^Exile target black or red permanent$/i.test(text)) return { effect: { kind: "exile-target-permanent" }, target: "black-or-red-permanent" };
  if (/^Destroy target artifact, enchantment, or land$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "artifact-enchantment-or-land" };
  if (/^Destroy target permanent$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "permanent" };
  if (/^Choose target nonland permanent you control and up to two target nonland permanents you don't control\. Destroy one of them at random$/i.test(text)) {
    return { effect: { kind: "destroy-random-target-permanent", amount: 1 }, target: "nonland-you-control" };
  }
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
  if (/^Destroy target creature with reach$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "creature-with-reach" };
  if (/^Destroy target creature with power 5 or greater$/i.test(text)) return { effect: { kind: "destroy-target-permanent" }, target: "creature-power-at-least-5" };
  if (/^Exile target creature with power 5 or greater$/i.test(text)) return { effect: { kind: "exile-target-permanent" }, target: "creature-power-at-least-5" };
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
  const randomSpellReturn = /^(?:Return|Put) (a|an|one|two|three|four|five|\d+) instant or sorcery cards? at random from your graveyard to your hand$/i.exec(text);
  if (randomSpellReturn) {
    const amount = toNumber(randomSpellReturn[1]!);
    if (amount !== null && amount > 0) return { effect: { kind: "return-random-instant-or-sorcery-from-graveyard", amount }, target: "none" };
  }
   if (/^Put target creature on top of its owner's library$/i.test(text)) return { effect: { kind: "put-target-creature-on-library-top" }, target: "creature" };
   if (/^Return target permanent to its owner's hand$/i.test(text)) return { effect: { kind: "return-target-permanent" }, target: "permanent" };
  if (/^Return target artifact to its owner's hand$/i.test(text)) return { effect: { kind: "return-target-permanent" }, target: "artifact" };
  if (/^Return target enchantment to its owner's hand$/i.test(text)) return { effect: { kind: "return-target-permanent" }, target: "enchantment" };
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
  // CR 109.2a identifies a card type in a named zone; the triggered ability
  // chooses this target as it is put on the stack (CR 603.3d).
  if (/^Return target instant or sorcery card from your graveyard to your hand$/i.test(text)) return { effect: { kind: "return-target-card-from-graveyard" }, target: "instant-or-sorcery-card-in-your-graveyard" };
  if (/^Return (?:another )?target creature card from your graveyard to the battlefield$/i.test(text)) return { effect: { kind: "return-target-creature-card-from-graveyard-to-battlefield" }, target: "creature-card-in-your-graveyard" };
  if (/^Return target creature card from your graveyard to the battlefield\. You lose life equal to that card's (?:mana value|converted mana cost)$/i.test(text)) {
    return { effect: { kind: "reanimate-target-creature-lose-mana-value-life" }, target: "creature-card-in-your-graveyard" };
  }
  if (/^Return (?:another )?target permanent card from your graveyard to the battlefield$/i.test(text)) return { effect: { kind: "return-target-permanent-card-from-graveyard-to-battlefield" }, target: "permanent-card-in-your-graveyard" };
  if (/^Return (?:another )?target permanent card from a graveyard to the battlefield$/i.test(text)) return { effect: { kind: "return-target-permanent-card-from-graveyard-to-battlefield" }, target: "permanent-card-in-a-graveyard" };
  if (/^Return (?:another )?target artifact card from your graveyard to your hand\. You gain life equal to that card's (?:mana value|converted mana cost)$/i.test(text)) return { effect: { kind: "return-target-artifact-and-gain-mana-value" }, target: "artifact-card-in-your-graveyard" };
  if (/^Return (?:another )?target artifact card from your graveyard to your hand$/i.test(text)) return { effect: { kind: "return-target-card-from-graveyard" }, target: "artifact-card-in-your-graveyard" };
  if (/^Return (?:another )?target enchantment card from your graveyard to your hand$/i.test(text)) return { effect: { kind: "return-target-card-from-graveyard" }, target: "enchantment-card-in-your-graveyard" };
  if (/^Return target creature card from your graveyard to your hand$/i.test(text)) return { effect: { kind: "return-target-card-from-graveyard" }, target: "creature-card-in-your-graveyard" };
  if (/^Return target creature card from your graveyard to the battlefield$/i.test(text)) return { effect: { kind: "return-target-creature-card-from-graveyard-to-battlefield" }, target: "creature-card-in-your-graveyard" };
  if (/^Return target legendary creature card from your graveyard to the battlefield$/i.test(text)) return { effect: { kind: "return-target-legendary-creature-card-from-graveyard-to-battlefield" }, target: "legendary-creature-card-in-your-graveyard" };
  if (/^Return target permanent card from your graveyard to the battlefield$/i.test(text)) return { effect: { kind: "return-target-permanent-card-from-graveyard-to-battlefield" }, target: "permanent-card-in-your-graveyard" };
  if (/^Return target permanent card from a graveyard to the battlefield$/i.test(text)) return { effect: { kind: "return-target-permanent-card-from-graveyard-to-battlefield" }, target: "permanent-card-in-a-graveyard" };
  // Reanimate/Hymn of Rebirth phrasing ("Put ... onto the battlefield under
  // your control") rather than "Return ... to the battlefield" — same
  // executor, since it already moves the card under the caster's control
  // regardless of whose graveyard it started in.
  if (/^Put target creature card from a graveyard onto the battlefield under your control\. You lose life equal to that card['’]s mana value$/i.test(text)) {
    return { effect: { kind: "reanimate-target-creature-lose-mana-value-life" }, target: "creature-card-in-a-graveyard" };
  }
  if (/^Put target creature card from a graveyard onto the battlefield under your control$/i.test(text)) {
    return { effect: { kind: "return-target-creature-card-from-graveyard-to-battlefield" }, target: "creature-card-in-a-graveyard" };
  }
  if (/^Return target artifact card from your graveyard to your hand$/i.test(text)) return { effect: { kind: "return-target-card-from-graveyard" }, target: "artifact-card-in-your-graveyard" };
  if (/^Return target enchantment card from your graveyard to your hand$/i.test(text)) return { effect: { kind: "return-target-card-from-graveyard" }, target: "enchantment-card-in-your-graveyard" };
  if (/^Put target land card from a graveyard onto the battlefield under your control$/i.test(text)) return { effect: { kind: "return-target-land-card-from-graveyard-to-battlefield" }, target: "land-card-in-a-graveyard" };
  if (/^Return (?:another )?target artifact card from your graveyard to the battlefield$/i.test(text)) return { effect: { kind: "return-target-artifact-card-from-graveyard-to-battlefield" }, target: "artifact-card-in-your-graveyard" };
  if (/^Return (?:another )?target enchantment card from your graveyard to the battlefield$/i.test(text)) return { effect: { kind: "return-target-enchantment-card-from-graveyard-to-battlefield" }, target: "enchantment-card-in-your-graveyard" };
  if (/^Return (?:another )?target card from your graveyard to your hand$/i.test(text)) return { effect: { kind: "return-target-card-from-graveyard" }, target: "card-in-your-graveyard" };
  if (/^Return target card from a graveyard to its owner's hand$/i.test(text)) return { effect: { kind: "return-target-card-from-graveyard" }, target: "card-in-a-graveyard" };
  if (/^Exile target card from your graveyard$/i.test(text)) return { effect: { kind: "exile-target-card-from-graveyard" }, target: "card-in-your-graveyard" };
  if (/^Exile target permanent card from your graveyard$/i.test(text)) return { effect: { kind: "exile-target-permanent-card-from-graveyard" }, target: "permanent-card-in-your-graveyard" };
  if (/^Exile target permanent card from a graveyard$/i.test(text)) return { effect: { kind: "exile-target-permanent-card-from-graveyard" }, target: "permanent-card-in-a-graveyard" };
  if (/^Exile target card from a graveyard$/i.test(text)) return { effect: { kind: "exile-target-card-from-graveyard" }, target: "card-in-a-graveyard" };
  if (/^Exile target creature card from a graveyard$/i.test(text)) return { effect: { kind: "exile-target-card-from-graveyard" }, target: "creature-card-in-a-graveyard" };
  if (/^Exile target artifact card from a graveyard$/i.test(text)) return { effect: { kind: "exile-target-card-from-graveyard" }, target: "artifact-card-in-a-graveyard" };
  if (/^Exile target enchantment card from a graveyard$/i.test(text)) return { effect: { kind: "exile-target-card-from-graveyard" }, target: "enchantment-card-in-a-graveyard" };
  if (/^Exile target land card from a graveyard$/i.test(text)) return { effect: { kind: "exile-target-card-from-graveyard" }, target: "land-card-in-a-graveyard" };
   if (/^Put target creature card from your graveyard on top of your library$/i.test(text)) return { effect: { kind: "return-target-card-to-library-top" }, target: "creature-card-in-your-graveyard" };
   if (/^Put target card from your graveyard on top of your library$/i.test(text)) return { effect: { kind: "return-target-card-to-library-top" }, target: "card-in-your-graveyard" };
  if (/^Put target card from your graveyard on the bottom of your library$/i.test(text)) return { effect: { kind: "return-target-card-to-library-bottom" }, target: "card-in-your-graveyard" };
  if (/^Shuffle target card from your graveyard into your library$/i.test(text)) return { effect: { kind: "shuffle-target-card-into-library" }, target: "card-in-your-graveyard" };
  if (/^Shuffle ~ into its owner's library$/i.test(text)) return { effect: { kind: "shuffle-source-into-library" }, target: "none" };
  if (/^Untap equipped creature$/i.test(text)) return { effect: { kind: "untap-equipped-creature" }, target: "none" };
  if (/^Untap all other creatures you control$/i.test(text)) return { effect: { kind: "untap-all-other-creatures-you-control" }, target: "none" };
  if (/^Tap all creatures target player controls$/i.test(text)) return { effect: { kind: "tap-all-creatures-target-player" }, target: "player" };
  if (/^Tap target creature$/i.test(text)) return { effect: { kind: "tap-target-permanent" }, target: "creature" };
  if (/^Tap target permanent an opponent controls$/i.test(text)) return { effect: { kind: "tap-target-permanent" }, target: "permanent-opponent" };
  if (/^Tap or untap target permanent(?: of their choice)?$/i.test(text)) return { effect: { kind: "tap-or-untap-target-permanent" }, target: "permanent" };
  if (/^Target creature can'?t block this turn$/i.test(text)) return { effect: { kind: "target-cant-block" }, target: "creature" };
  if (/^Your opponents can'?t cast spells this turn$/i.test(text)) return { effect: { kind: "opponents-cant-cast-spells-this-turn" }, target: "none" };
  if (/^This turn, creatures can'?t block unless their controller pays \{X\} for each blocking creature they control$/i.test(text)) {
    return { effect: { kind: "set-blocking-tax", amount: "X" }, target: "none" };
  }
  if ((match = /^sacrifice it unless you return an untapped (Plains|Island|Swamp|Mountain|Forest) you control to its owner'?s hand$/i.exec(text))) {
    return { effect: { kind: "karoo-bounce", subtype: match[1]![0]!.toUpperCase() + match[1]!.slice(1).toLowerCase() }, target: "none" };
  }
  if ((match = /^Flip a coin\.\s*If you lose the flip,\s*~ deals (\d+) damage to you$/i.exec(text))) {
    return { effect: { kind: "coin-flip-self-damage-if-lost", amount: Number(match[1]) }, target: "none" };
  }
  if (/^Untap target permanent$/i.test(text)) return { effect: { kind: "untap-target-permanent" }, target: "permanent" };
  if (/^Untap target artifact$/i.test(text)) return { effect: { kind: "untap-target-permanent" }, target: "artifact" };
  if (/^Untap target creature$/i.test(text)) return { effect: { kind: "untap-target-permanent" }, target: "creature" };
  if (/^Untap target permanent you control$/i.test(text)) return { effect: { kind: "untap-target-permanent" }, target: "permanent-you-control" };
  if (/^Untap target land$/i.test(text)) return { effect: { kind: "untap-target-permanent" }, target: "land" };
  if ((match = /^Look at the top (\w+) cards? of your library, then put (?:it|them) back in any order$/i.exec(text))) {
    const amount = toNumber(match[1]!);
    if (amount !== null) return { effect: { kind: "look-top-reorder", amount }, target: "none" };
  }
  if (/^Draw a card, then put ~ on top of its owner'?s library$/i.test(text)) {
    return { effect: { kind: "draw-then-source-to-library-top" }, target: "none" };
  }
  // Garruk Wildspeaker's "+1" (CR 601.2c: the same target can't be chosen
  // twice for one instance of "target", enforced at resolution alongside the
  // shared multi-slot targetKinds check).
  if (/^Untap two target lands$/i.test(text)) return { effect: { kind: "untap-target-permanent" }, target: "land", targetKinds: ["land", "land"] };
  if (/^Tap target creature an opponent controls\. That creature doesn't untap during its controller's untap step for as long as you control ~$/i.test(text)) {
    return { effect: { kind: "tap-target-creature-and-lock" }, target: "creature-opponent" };
  }
  if (/^Destroy all creatures$/i.test(text)) return { effect: { kind: "destroy-all-creatures" }, target: "none" };
  if (/^Destroy all tapped creatures$/i.test(text)) return { effect: { kind: "destroy-all-creatures", tappedOnly: true }, target: "none" };
  if (/^Destroy all artifacts, creatures, and enchantments$/i.test(text)) {
    return { effect: { kind: "destroy-all-artifacts-creatures-enchantments" }, target: "none" };
  }
  if ((match = /^Destroy all artifacts and enchantments, then put a (\+1\/\+1|-1\/-1) counter on ~ for each permanent destroyed this way$/i.exec(text))) {
    return { effect: { kind: "destroy-all-artifacts-enchantments-add-counters", counter: match[1]! }, target: "none" };
  }
  const exileAndTransfer = parseExileAndTransferSource(text);
  if (exileAndTransfer) return { effect: exileAndTransfer, target: "artifact-or-enchantment" };
  if (/^Counter target spell$/i.test(text)) return { effect: { kind: "counter-target-spell" }, target: "spell" };
  if (/^Counter target instant or sorcery spell$/i.test(text)) return { effect: { kind: "counter-target-spell" }, target: "instant-or-sorcery-spell" };
  if ((match = /^Counter target (spell|instant or sorcery spell) unless its controller pays ((?:\{[^}]+\})+)\.?$/i.exec(text))) {
    const cost = parseManaCost(match[2]!);
    if (cost) return { effect: { kind: "counter-target-spell-unless-pay", cost }, target: match[1]!.toLowerCase() === "spell" ? "spell" : "instant-or-sorcery-spell" };
  }
  const exactSpellValue = /^Counter target spell with (?:mana value|converted mana cost) (\d+)$/i.exec(text);
  if (exactSpellValue) return { effect: { kind: "counter-target-spell" }, target: `spell-mana-value-${Number(exactSpellValue[1])}` };
  if (/^Counter target creature spell$/i.test(text)) return { effect: { kind: "counter-target-spell" }, target: "creature-spell" };
  if (/^Counter target noncreature spell$/i.test(text)) return { effect: { kind: "counter-target-spell" }, target: "noncreature-spell" };
  if ((match = /^At the beginning of your next main phase, add an amount of \{([WUBRGC])\} equal to that spell's mana value$/i.exec(text))) {
    return { effect: { kind: "delayed-mana-equal-to-target-spell-mana-value", manaType: match[1]!.toUpperCase() as ManaType }, target: "spell" };
  }
  if (/^Target spell can'?t be countered$/i.test(text)) return { effect: { kind: "make-target-spell-uncounterable" }, target: "spell" };
  const multiBasicSearch = parseMultiBasicSearch(text);
  if (multiBasicSearch) return { effect: multiBasicSearch, target: "none" };
  const token = parseManaSpentToken(text) ?? parseLandScaledToken(text) ?? parseCreatureScaledToken(text) ?? parseCreateToken(text);
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

function isIgnorableSentence(sentence: string, hasChosenColorEffect = false): boolean {
  const s = sentence.trim();
  if (/^(?:It|They|That creature) can't be regenerated\.?$/i.test(s)) return true;
  // Control Magic's continuous effect is applied by the engine from the Aura
  // attachment; it is not a one-shot resolution instruction (CR 110.2, 613.7).
  if (/^You control enchanted creature\.?$/i.test(s)) return true;
  // The following sentence carries the actual chosen-color effect; the
  // standalone instruction only opens that resolution choice.
  if (hasChosenColorEffect && /^choose a color\.?$/i.test(s)) return true;
  // No-maximum-hand-size from a one-shot spell: the engine's deterministic
  // cleanup discard only bites at 8+ cards and the sim rarely floods that far,
  // so treating this as a no-op keeps the card playable without new state.
  if (/^you have no maximum hand size for the rest of the game\.?$/i.test(s)) return true;
  if (/^then shuffle\.?$/i.test(s)) return true;
  // A rounding clarifier for a preceding "half of X" computation (Peer into
  // the Abyss); the half-amount effect already rounds up, so this adds no
  // separate action (CR 107.1a).
  if (/^Round up each time\.?$/i.test(s)) return true;
  // The quoted ability is parsed into CardProfile.auraActivatedAbility and
  // granted to the enchanted permanent by the engine (CR 303.4, 605.1a).
  const auraAbility = /^Enchanted (?:creature|land) has "(.+)"\.?$/i.exec(s);
  if (auraAbility && parseActivatedAbility(auraAbility[1]!, 0)) return true;
  // "If the gift was promised, instead [wider target]" (CR 702.166) only
  // widens the legal target set for the already-printed effect; it is
  // consumed into CardProfile.giftPromisedTargetKind, not a second action.
  // Only ignorable when that widened target actually parses — otherwise a
  // genuinely different "instead" clause would be silently dropped.
  const giftInstead = /^If the gift was promised, instead (.+)$/i.exec(s.replace(/\.$/, ""));
  if (giftInstead) {
    const recognized = recognizeSentence(giftInstead[1]!);
    if (recognized && recognized.target !== "none") return true;
  }
  return false;
}

function recognizeText(text: string): RecognizedText {
  const body = text.split("\n")
    // Scryfall uses `•`; a few imported historical rows contain U+FFFD in its
    // place. Both are presentation markers, never part of Oracle semantics.
    .map((raw) => {
      const line = raw.trim();
      return {
        text: line.replace(/^[•\u2014\u2013\uFFFD]\s*/u, ""),
        bullet: /^[•\u2014\u2013\uFFFD]\s*/u.test(line),
      };
    })
    .filter(Boolean);
  if (!body.length) return { effects: [], triggers: [], activatedAbilities: [], modalChoices: [], targetKind: "none", unimplementedText: [], covered: true };

  // Enlightened Tutor-style searches are one resolution instruction spread
  // over two sentences. Recognise the complete sequence before the generic
  // sentence splitter can mark the second half as unknown.
  const joined = body.map((entry) => entry.text).join(" ").replace(/\s+/g, " ").trim();
  const decreeBody = body.filter((entry) => !/^cycling\s+\{[^}]+\}/i.test(entry.text) && !/^when you cycle (?:this card|~),/i.test(entry.text));
  const decreeJoined = decreeBody.map((entry) => entry.text).join(" ").replace(/\s+/g, " ").trim();
  const aethermagesTouch = parseAethermagesTouch(joined);
  if (aethermagesTouch) {
    return { effects: [aethermagesTouch], triggers: [], activatedAbilities: [], modalChoices: [], targetKind: "none", unimplementedText: [], covered: true };
  }
  const revealTopLandOrHand = parseRevealTopCardLandOrHand(joined.replace(/^vigilance\s+/i, "").replace(/^\{T\}:\s*/i, ""));
  if (revealTopLandOrHand) {
    return {
      effects: [], triggers: [], activatedAbilities: [{
        index: 0, requiresTap: true, sacrificesSelf: false, lifeCost: 0, manaCost: null,
        effect: revealTopLandOrHand, targetKind: "none", text: joined
      }],
      modalChoices: [], targetKind: "none", unimplementedText: [], covered: true
    };
  }
  if (/^Destroy all creatures\. They can't be regenerated\. Draw a card for each creature destroyed this way\.?$/i.test(decreeJoined)) {
    const cycleTrigger = body.find((entry) => /^when\s+you\s+cycle\s+(?:this\s+card|~),/i.test(entry.text));
    const matchedCycle = cycleTrigger ? matchTriggerLine(cycleTrigger.text) : null;
    const cycleEffect = matchedCycle ? recognizeSentence(matchedCycle.effectText) : null;
    const unsupported = body
      .filter((entry) => !/^cycling\s+/i.test(entry.text) && !decreeBody.includes(entry) && entry !== cycleTrigger)
      .map((entry) => entry.text);
    return {
      effects: [{ kind: "destroy-all-creatures-draw-destroyed" }],
      triggers: matchedCycle && cycleEffect ? [{
        event: matchedCycle.event,
        subject: matchedCycle.subject,
        effect: cycleEffect.effect,
        optional: false,
        targetKind: cycleEffect.target,
        sourceText: cycleTrigger!.text
      }] : [],
      activatedAbilities: [], modalChoices: [], targetKind: "none",
      unimplementedText: cycleTrigger && !cycleEffect ? [cycleTrigger.text, ...unsupported] : unsupported,
      covered: unsupported.length === 0 && Boolean(cycleEffect)
    };
  }
  const kirtarsWrath = /^Destroy all creatures\. They can't be regenerated\.\s*Threshold\s*[—–-]\s*If there are (one|two|three|four|five|six|seven|eight|nine|ten|\d+) or more cards in your graveyard, instead destroy all creatures, then create two 1\/1 white Spirit creature tokens with flying\. Creatures destroyed this way can't be regenerated\.?$/i.exec(joined);
  const kirtarsThreshold = kirtarsWrath ? toNumber(kirtarsWrath[1]!) : null;
  if (kirtarsThreshold !== null) {
    return {
      effects: [{ kind: "kirtars-wrath", threshold: kirtarsThreshold, token: {
        name: "Spirit", typeLine: "Creature — Spirit", power: 1, toughness: 1, colors: ["W"], keywords: ["flying"], tapped: false
      } }],
      triggers: [], activatedAbilities: [], modalChoices: [], targetKind: "none", unimplementedText: [], covered: true
    };
  }
  if (/^Counter target spell\. If that spell is an artifact or creature spell, put it onto the battlefield under your control instead of into its owner's graveyard\.?$/i.test(joined)) {
    return {
      effects: [{ kind: "counter-target-spell-to-battlefield" }],
      triggers: [], activatedAbilities: [], modalChoices: [], targetKind: "spell", unimplementedText: [], covered: true
    };
  }
  if (/^Counter target spell\. Its controller may draw up to two cards at the beginning of the next turn's upkeep\. You draw a card at the beginning of the next turn's upkeep\.?$/i.test(joined)) {
    return {
      effects: [{ kind: "counter-target-spell-with-delayed-draw", targetAmount: 2, casterAmount: 1 }],
      triggers: [], activatedAbilities: [], modalChoices: [], targetKind: "spell", unimplementedText: [], covered: true
    };
  }
  if (/^Search your library for an artifact or enchantment card, reveal it, then shuffle\. Put that card on top of your library\.$/i.test(joined)) {
    return {
      effects: [{ kind: "search-library", types: ["Artifact", "Enchantment"], destination: "top", reveal: true }],
      triggers: [], activatedAbilities: [], modalChoices: [], targetKind: "none", unimplementedText: [], covered: true
    };
  }
  const namedBasicLandSearch = parseNamedBasicLandSearch(joined.replace(/\s+Then shuffle\.?$/i, ""));
  if (namedBasicLandSearch) {
    return {
      effects: [namedBasicLandSearch],
      triggers: [], activatedAbilities: [], modalChoices: [], targetKind: "none", unimplementedText: [], covered: true
    };
  }
  const thresholdReturn = /^Return target creature card from your graveyard to your hand\. Threshold [—–-] Return that card from your graveyard to the battlefield instead if there are (one|two|three|four|five|six|seven|eight|nine|ten|\d+) or more cards in your graveyard\.?$/i.exec(joined);
  const threshold = thresholdReturn ? toNumber(thresholdReturn[1]!) : null;
  if (threshold !== null) {
    return {
      effects: [{ kind: "return-target-creature-card-from-graveyard-threshold", threshold }],
      triggers: [], activatedAbilities: [], modalChoices: [], targetKind: "creature-card-in-your-graveyard", unimplementedText: [], covered: true
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
  const unexpectedlyAbsent = /^Put target nonland permanent into its owner'?s library just beneath the top (X|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of that library\.?$/i.exec(joined);
  if (unexpectedlyAbsent) {
    const count = /^X$/i.test(unexpectedlyAbsent[1]!) ? "X" as const : toNumber(unexpectedlyAbsent[1]!);
    if (count !== null) {
      return {
        effects: [{ kind: "put-target-nonland-permanent-under-top", count }],
        triggers: [], activatedAbilities: [], modalChoices: [], targetKind: "nonland", unimplementedText: [], covered: true
      };
    }
  }
  // Reckless Spite: "Destroy two target nonblack creatures. You lose 5 life."
  const recklessSpite = /^Destroy two target nonblack creatures\.\s*You lose 5 life\.$/i.test(joined);
  if (recklessSpite) {
    return {
      effects: [{ kind: "compound", effects: [{ kind: "destroy-n-creatures", count: 2, nonblack: true }, { kind: "lose-life", amount: 5 }] }],
      triggers: [], activatedAbilities: [], modalChoices: [], targetKind: "nonblack-creature",
      targetKinds: ["nonblack-creature", "nonblack-creature"], unimplementedText: [], covered: true
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
  // Beast Within / Generous Gift: the same shape, but any permanent (the
  // engine's handler for the effect kind above is target-agnostic — it just
  // destroys whatever was targeted and hands its controller the token).
  const destroyPermanentThenToken = /^Destroy target permanent\.\s+Its controller creates (.+?)\.?$/i.exec(joined);
  if (destroyPermanentThenToken) {
    const token = parseCreateToken(`Create ${destroyPermanentThenToken[1]!}`);
    if (token?.kind === "create-token") {
      return {
        effects: [{ kind: "destroy-target-creature-then-controller-token", token: token.token }],
        triggers: [], activatedAbilities: [], modalChoices: [], targetKind: "permanent", unimplementedText: [], covered: true
      };
    }
  }
  // "Counter target noncreature spell. Its controller creates two Treasure
  // tokens." (An Offer You Can't Refuse) — the reminder-text parenthetical
  // explaining Treasure is stripped before `joined` is built.
  const counterThenToken = /^Counter target noncreature spell\.\s*Its controller creates (.+?)\.?$/i.exec(joined);
  if (counterThenToken) {
    const token = parseCreateToken(`Create ${counterThenToken[1]!}`);
    if (token?.kind === "create-token" && typeof token.amount === "number") {
      return {
        effects: [{ kind: "counter-target-spell-then-controller-token", amount: token.amount, token: token.token }],
        triggers: [], activatedAbilities: [], modalChoices: [], targetKind: "noncreature-spell", unimplementedText: [], covered: true
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
  let entwineCost: ManaCost | null = null;
  let graftAmount: number | null = null;
  let echoCost: ManaCost | null = null;
  let evokeCost: ManaCost | null = null;
  let flashbackCost: ManaCost | null = null;
  let miracleCost: ManaCost | null = null;
  const kickedEffects: SpellEffect[] = [];
  const kickedKeywords: EnforcedKeyword[] = [];
  const kickedEntersWithCounters: CounterCost[] = [];

  for (let lineIndex = 0; lineIndex < body.length; lineIndex += 1) {
    const lineEntry = body[lineIndex]!;
    const line = lineEntry.text;
    // Thousand-Year Elixir-style static permission (CR 302.6). The engine
    // applies this as a characteristic of the controller's battlefield, not
    // as a triggered or activated ability of the artifact.
    if (/^You may activate abilities of creatures you control as though those creatures had haste\.?$/i.test(line)) continue;
    // Graveyard recursion: "{cost}: Return ~ from your graveyard to your hand"
    // (Sanitarium Skeleton, Firewing Phoenix; Eternal Dragon adds an upkeep-only
    // restriction). CR 602.1, 602.5.
    const graveyardReturn = /^((?:\{[^}]+\})+):\s*Return (?:~|this card) from your graveyard to your hand\.?/i.exec(line);
    const upkeepRestrictionOnNextLine = /^Activate only during your upkeep\.?$/i.test(body[lineIndex + 1]?.text ?? "");
    const upkeepRestrictionInline = /Activate only during your upkeep\.?$/i.test(line);
    if (graveyardReturn) {
      const manaCost = parseManaCost(graveyardReturn[1]!);
      const upkeepOnly = upkeepRestrictionInline || upkeepRestrictionOnNextLine;
      if (manaCost) {
        activatedAbilities.push({
          index: activatedAbilities.length, requiresTap: false, sacrificesSelf: false, lifeCost: 0,
          manaCost, sourceZone: "graveyard", ...(upkeepOnly ? { upkeepOnly: true } : {}),
          effect: { kind: "return-source-to-hand" }, targetKind: "none",
          text: upkeepRestrictionOnNextLine ? `${line} ${body[lineIndex + 1]!.text}` : line
        });
        if (upkeepRestrictionOnNextLine) lineIndex += 1;
        continue;
      }
    }
    // Echo is a delayed upkeep payment for permanents that just entered under
    // a player's control (CR 702.30a-b). Reminder text is not executable.
    const echo = /^Echo\s+((?:\{[^}]+\})+)(?:\s*\([^)]*\))?\.?$/i.exec(line);
    if (echo) { echoCost = parseManaCost(echo[1]!); continue; }
    // Evoke alternative cost (CR 702.34). Reminder text is dropped.
    const evoke = /^Evoke\s+((?:\{[^}]+\})+)(?:\s*\([^)]*\))?\.?$/i.exec(line);
    if (evoke) { evokeCost = parseManaCost(evoke[1]!); continue; }
    // Miracle (CR 702.93): an alternative cost offered only in the single
    // window right after being drawn as the first card that turn. Reminder text is dropped.
    const miracle = /^Miracle\s+((?:\{[^}]+\})+)(?:\s*\([^)]*\))?\.?$/i.exec(line);
    if (miracle) { miracleCost = parseManaCost(miracle[1]!); continue; }
    // Kicker / Multikicker additional cost (CR 702.33). Reminder text is dropped.
    const kicker = /^(?:Multikicker|Kicker)\s+((?:\{[^}]+\})+)(?:\s*\([^)]*\))?\.?$/i.exec(line);
    if (kicker) { kickerCost = parseManaCost(kicker[1]!); continue; }
    // Partner (CR 702.123): purely a deck-construction rule — createGame
    // already accepts multiple declared commanderNames, so the printed line
    // carries no per-card state here. Reminder text (parenthetical) is
    // already stripped from `text` above, so no parenthetical ever survives
    // to this loop.
    if (/^Partner\.?$/i.test(line)) continue;
    // Partner with <name> (CR 702.124f): an exact, deterministic library
    // search — no candidate choice, unlike fetch-land style `search-library`.
    // The target player (not the controller) decides on resolution, so this
    // is `choiceBy: "target"`. Two known printings are excluded by name: The
    // Knight of Land Drops lets you freely choose any legendary Knight and
    // never searches, and Mothers Yamazaki's "partner with itself" needs a
    // self-referential two-copy deck this primitive does not model.
    const partnerWith = /^Partner with (.+?)\.?$/i.exec(line);
    if (partnerWith) {
      const cardName = partnerWith[1]!.trim();
      const excluded = cardName.toLowerCase() === "itself" || cardName.toLowerCase() === "knight";
      if (!excluded) {
        triggers.push({
          event: "enters-battlefield", subject: "self",
          effect: { kind: "partner-with-search", cardName },
          optional: true, choiceBy: "target", targetKind: "player", sourceText: line
        });
        continue;
      }
    }
    // Entwine is an additional cost to choose every mode of a modal spell
    // (CR 702.42a). Reminder text is not executable.
    const entwine = /^Entwine\s+((?:\{[^}]+\})+)(?:\s*\([^)]*\))?\.?$/i.exec(line);
    if (entwine) { entwineCost = parseManaCost(entwine[1]!); continue; }
    // Graft is an entry replacement plus a triggered counter-transfer ability
    // (CR 702.58a-b); cardProfile synthesizes the trigger from this value.
    const graft = /^Graft\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)(?:\s*\([^)]*\))?\.?$/i.exec(line);
    if (graft) { graftAmount = toNumber(graft[1]); continue; }
    // Flashback: cast from the graveyard for this cost, then exile (CR 702.34 → 702.34a numbering aside, 702.33 family).
    const flashback = /^Flashback\s+((?:\{[^}]+\})+)(?:\s*\([^)]*\))?\.?$/i.exec(line);
    if (flashback) { flashbackCost = parseManaCost(flashback[1]!); continue; }
    // Board-scaled self cost reduction is consumed by cardProfile, not resolved here.
    if (/^~ costs \{\d+\} less to cast for each creature on the battlefield\.?$/i.test(line)) continue;
    if (/^(?:(?:(?:white|blue|black|red|green)\s+spells)(?:\s+and\s+(?:white|blue|black|red|green)\s+spells)+|(?:(?:white|blue|black|red|green) )?(?:artifact|creature|enchantment|instant|sorcery|planeswalker)? ?spells) you cast cost \{\d+\} less to cast\.?$/i.test(line)) continue;
    if (/^instant and sorcery spells cost \{\d+\} less to cast\.?$/i.test(line)) continue;
    if (/^[A-Za-z][A-Za-z'’/-]* spells you cast cost \{\d+\} less to cast\.?$/i.test(line)) continue;
    // "At the beginning of your first main phase, choose one or more —"
    // (Black Market Connections): unlike a spell's modal choice, this is a
    // TRIGGERED ability's own choice, made when it goes on the stack (CR
    // 603.3d) rather than at cast time — so the subsets become
    // `TriggerDefinition.modalEffects`, not `CardProfile.modalChoices`.
    const triggerChooseMore = /^At the beginning of your first main phase,\s*choose (one|two|three|four|five) or more(?:\s+[—–-�])?\s*$/i.exec(line);
    if (triggerChooseMore) {
      const minimumModes = toNumber(triggerChooseMore[1]) ?? 1;
      const start = lineIndex + 1;
      const modes: { text: string; effect: SpellEffect }[] = [];
      let cursor = start;
      let invalid = false;
      while (cursor < body.length && body[cursor]!.bullet) {
        const entry = body[cursor]!;
        // Each mode is printed as "Ability word — effect" (an ability word
        // naming the mode, CR 207.2c); it carries no independent rules meaning.
        // A mode is often two sentences ("Create a Treasure token. You lose 1
        // life."); each is recognized on its own and joined into a compound
        // here, rather than teaching `recognizeSentence` a generic "X. You
        // lose N life." combinator that would also reshape unrelated cards
        // already parsed as separate top-level sentences (Read the Bones).
        const modeText = entry.text.replace(/^[A-Za-z][A-Za-z' ]*\s+[—–-]\s*/, "");
        const sentences = modeText.split(SENTENCE_SPLIT).map((sentence) => sentence.trim()).filter(Boolean);
        const recognizedSentences = sentences.map((sentence) => recognizeSentence(sentence));
        if (!sentences.length || recognizedSentences.some((recognized) => !recognized || recognized.target !== "none")) {
          invalid = true;
          break;
        }
        const modeEffects = recognizedSentences.map((recognized) => recognized!.effect);
        modes.push({ text: entry.text, effect: modeEffects.length === 1 ? modeEffects[0]! : { kind: "compound", effects: modeEffects } });
        cursor += 1;
      }
      if (!invalid && modes.length > 0 && cursor > start) {
        const subsets: { text: string; effect: SpellEffect }[] = [];
        const visit = (from: number, selected: { text: string; effect: SpellEffect }[]): void => {
          for (let index = from; index < modes.length; index += 1) {
            const next = [...selected, modes[index]!];
            if (next.length >= minimumModes) {
              subsets.push({
                text: next.map((mode) => mode.text.replace(/\.$/, "")).join("; "),
                effect: next.length === 1 ? next[0]!.effect : { kind: "compound", effects: next.map((mode) => mode.effect) }
              });
            }
            if (index + 1 < modes.length) visit(index + 1, next);
          }
        };
        visit(0, []);
        triggers.push({
          event: "first-main-phase", subject: "you", effect: subsets[0]!.effect, modalEffects: subsets,
          optional: false, targetKind: "none", sourceText: line
        });
        lineIndex = Math.max(lineIndex, cursor - 1);
        continue;
      }
    }
    // ETB modal abilities such as Deceiver Exarch make their mode choice when
    // the trigger is put on the stack (CR 603.3d), not when the creature is
    // cast. Preserve each mode's target requirement so the same target-choice
    // machinery used by ordinary triggered abilities can run afterward.
    const triggerChooseOne = /^(?:when|whenever)\s+(?:~|this creature|this permanent)\s+enters(?:\s+the\s+battlefield)?,?\s*choose one(?:\s+[—–-\uFFFD])?\s*$/i.test(line);
    if (triggerChooseOne) {
      const start = lineIndex + 1;
      const modes: { text: string; effect: SpellEffect; targetKind: TargetKind; targetKinds?: readonly Exclude<TargetKind, "none">[] }[] = [];
      let cursor = start;
      let invalid = false;
      while (cursor < body.length && body[cursor]!.bullet) {
        const entry = body[cursor]!;
        const recognized = recognizeSentence(entry.text.replace(/\s+It can(?:not|'t) be regenerated\.?$/i, ""));
        if (!recognized) {
          invalid = true;
          break;
        }
        modes.push({
          text: entry.text, effect: recognized.effect, targetKind: recognized.target,
          ...(recognized.targetKinds?.length ? { targetKinds: recognized.targetKinds } : {})
        });
        cursor += 1;
      }
      if (!invalid && modes.length > 0 && cursor > start) {
        triggers.push({
          event: "enters-battlefield", subject: "self", effect: modes[0]!.effect,
          modalEffects: modes.map(({ text, effect, targetKind, targetKinds }) => ({ text, effect, targetKind, ...(targetKinds ? { targetKinds } : {}) })),
          optional: false, targetKind: modes[0]!.targetKind,
          ...(modes[0]!.targetKinds ? { targetKinds: modes[0]!.targetKinds } : {}), sourceText: line
        });
        lineIndex = Math.max(lineIndex, cursor - 1);
        continue;
      }
      unimplementedText.push(line, ...body.slice(start, cursor).map((entry) => entry.text));
      lineIndex = Math.max(lineIndex, cursor - 1);
      continue;
    }
    const chooseOneOrBoth = /^Choose one or both(?:\s+[—–-�])?\s*$/i.test(line);
    const chooseMoreMatch = /^Choose (one|two|three|four|five|six|seven|eight|nine|ten|\d+) or more(?:\s+[—–-�])?\s*$/i.exec(line);
    if (chooseOneOrBoth || chooseMoreMatch || /^Choose one(?:\s+[—–-�])?\s*$/i.test(line)) {
      const minimumChoices = chooseMoreMatch ? (toNumber(chooseMoreMatch[1]!) ?? Number(chooseMoreMatch[1])) : 1;
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
        else choices.push({ index: choices.length, text: choiceText, effect: recognized.effect, targetKind: recognized.target, ...(recognized.targetKinds?.length ? { targetKinds: recognized.targetKinds } : {}) });
        cursor += 1;
      }
      if (!invalid && choices.length > 0 && choices.length === cursor - start) {
        if (!chooseMoreMatch) modalChoices.push(...choices);
        if (chooseOneOrBoth) {
          const targetKinds = choices.map((choice) => choice.targetKind)
            .filter((kind): kind is Exclude<TargetKind, "none"> => kind !== "none");
          let targetOffset = 0;
          modalChoices.push({
            index: choices.length,
            text: "Choose both",
            effect: {
              kind: "compound",
              effects: choices.map((choice) => choice.effect),
              targetOffsets: choices.map((choice) => choice.targetKind === "none" ? null : targetOffset++)
            },
            targetKind: targetKinds[0] ?? "none",
            ...(targetKinds.length ? { targetKinds } : {})
          });
        } else if (chooseMoreMatch) {
          // "Choose N or more" is a single modal choice whose legal modes are
          // all non-empty subsets meeting the printed minimum. Generate those
          // combinations once so every matching card reuses the same primitive
          // and each selected branch retains its own target slot (CR 700.2).
          const subsets: ModalChoice[][] = [];
          const visit = (start: number, selected: ModalChoice[]): void => {
            for (let index = start; index < choices.length; index += 1) {
              const next = [...selected, choices[index]!];
              if (next.length >= minimumChoices) subsets.push(next);
              if (index + 1 < choices.length) visit(index + 1, next);
            }
          };
          visit(0, []);
          for (const subset of subsets) {
            const targetKinds = subset.map((choice) => choice.targetKind)
              .filter((kind): kind is Exclude<TargetKind, "none"> => kind !== "none");
            let targetOffset = 0;
            modalChoices.push({
              index: modalChoices.length,
              text: `Choose ${subset.map((choice) => choice.text.replace(/[.;]$/, "")).join("; ")}`,
              effect: {
                kind: "compound",
                effects: subset.map((choice) => choice.effect),
                targetOffsets: subset.map((choice) => choice.targetKind === "none" ? null : targetOffset++)
              },
              targetKind: targetKinds[0] ?? "none",
              ...(targetKinds.length ? { targetKinds } : {})
            });
          }
        }
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
    // Untapped counterpart of the same template (Pentavus, Spike Feeder):
    // a fixed amount is consumed into `entersWithCounters`, a literal "X"
    // into `entersWithVariableCounters`. Anchored at "on it" so a trailing
    // dynamic clause ("...for each creature you control...") is left
    // unconsumed and still reported as unimplemented.
    if (/^~\s+enters(?:\s+the\s+battlefield)?\s+with\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+[+\-\w/ ]+?\s+counters?\s+on\s+it\.?$/i.test(line)) continue;
    if (/^~\s+enters(?:\s+the\s+battlefield)?\s+with\s+x\s+[+\-\w/ ]+?\s+counters?\s+on\s+it\.?$/i.test(line)) continue;
    // Shock lands ("As ~ enters, you may pay 2 life. If you don't, it enters
    // tapped.") and reveal lands ("...you may reveal a <type> card from your
    // hand. If you don't, ~ enters tapped.") print the same replacement as
    // two sentences on one line. `parseEntersTapped` already executes it as
    // the permanent enters (CR 614.12); this is not a separate instruction.
    if (/^as\s+~\s+enters,\s*you\s+may\s+(?:pay\s+\d+\s+life|reveal\s+.+?\s+card\s+from\s+your\s+hand)\.\s*if\s+you\s+don[’']t,\s*(?:it|~)\s+enters\s+tapped\.?$/i.test(line)) continue;
    // Check lands use the same enters-tapped replacement with a reveal choice.
    if (/^As ~ enters, you may reveal an?\s+[A-Za-z][A-Za-z'’ -]*\s+card from your hand\.\s*If you don['’]t, (?:~|it) enters tapped\.?$/i.test(line)) continue;
    if (/^(?:cycling|[A-Za-z][A-Za-z ]+cycling)\b/i.test(line)) continue;
    if (/^cycling\s+\{[^}]+\}(?:\{[^}]+\})*(?:\.?$)/i.test(line)) continue;
    if (/^flashback(?:\s+|\s*—\s*)\{[^}]+\}(?:\{[^}]+\})*(?:,\s*pay\s+\d+\s+life)?(?:\.?$)/i.test(line)) continue;
    if (/^as an additional cost to cast ~, pay (?:X|\d+) life\.?$/i.test(line)) continue;
    if (/^equip\s+\{[^}]+\}(?:\{[^}]+\})*(?:\.?$)/i.test(line)) continue;
    if (/^equip\s+worthy\s+(?:\{[^}]+\})+\s*(?:\(.*\))?(?:\.?$)/i.test(line)) continue;
    if (CLASS_LEVEL_LINE.test(line)) continue;
    if (/^equip\s+[A-Za-z][A-Za-z'’-]*\s+\{[^}]+\}(?:\{[^}]+\})*(?:\.?$)/i.test(line)) continue;
   if (/^level up\s+\{[^}]+\}(?:\{[^}]+\})*(?:\.?$)/i.test(line)) continue;
    if (/^as long as a card exiled with ~ is a creature card, ~ has the power, toughness, and creature types of the last creature card exiled with ~\. it's still a shapeshifter\.?$/i.test(line)) continue;
    if (/^level\s+\d+(?:-\d+|\+)?$/i.test(line) || /^\d+\/\d+$/.test(line)) continue;
    if (parseEquipmentModification(line)) continue;
    if (parseAuraModification(line)) continue;
    if (/^Enchanted creature gets \+\d+\/\+\d+ for each other enchantment on the battlefield\.?$/i.test(line)) continue;
    if (parseAuraControlTarget(line)) continue;
    // "Enchant creature/land/permanent/creature you control" (CR 303.4.5) is
    // an Aura's own targeting restriction, not a resolved effect — it becomes
    // the spell's targetKind so the whole existing targeting/fizzle pipeline
    // (legalTargets, the stack fizzle check, castableCard) applies for free.
    const enchantTarget = /^enchant (creature|land|permanent|player|creature you control)\.?$/i.exec(line);
    if (enchantTarget) {
      targetKind = enchantTarget[1]! === "creature you control" ? "creature-you-control" : enchantTarget[1]! as TargetKind;
      continue;
    }
    // Combat restrictions and landwalk are static: they change which
    // declarations are legal rather than resolving anything (CR 508.1d, 509.1a).
    if (combatRuleLines.has(line)) continue;
    // Protection's quality is tracked separately because it affects targeting,
    // blocking and damage prevention, not stack resolution (CR 702.16).
    if (parseProtectionFromLine(line)) continue;
    if (parseStaticKeywordGrant(line).length) continue;
    if (parseManaAbilityGrant(line)) continue;
    if (parseKeywordDuringYourTurn(line).length) continue;
    if (parseTriggerDoubler(line)) continue;
    if (parseStaticPowerToughnessGrant(line)) continue;
    if (/^players can't gain life\.?$/i.test(line)) continue;
    if (/^creature spells you control with power \d+ or greater can't be countered\.?$/i.test(line)) continue;
    if (/^you have no maximum hand size\.?$/i.test(line)) continue;
    if (/^players have no maximum hand size\.?$/i.test(line)) continue;
    if (/^during your turn, your opponents can't cast spells or activate abilities of artifacts, creatures, or enchantments\.?$/i.test(line)) continue;
    if (/untap all (?:green|blue|green and\/?or blue|blue and\/?or green) creatures you control during each other/i.test(line)) continue;
    if (/^other creatures you control have extort\.?$/i.test(line)) continue;
    if (/^as long as ~ is attacking, for each creature you control, you may have that creature assign its combat damage as though it weren't blocked\.?$/i.test(line)) continue;
    if (/^as an additional cost to cast ~, exile x cards from your graveyard\.?$/i.test(line)) continue;
    if (/^as an additional cost to cast ~, sacrifice a land\.?$/i.test(line)) continue;
    if (/^as an additional cost to cast ~, sacrifice a creature\.?$/i.test(line)) continue;
    if (/^as an additional cost to cast ~, sacrifice an? (?:white|blue|black|red|green) creature\.?$/i.test(line)) continue;
    if (/^if you control a commander, you may cast ~ without paying its mana cost\.?$/i.test(line)) continue;
    if (/^if you control an? [A-Za-z][A-Za-z'’-]*, you may pay \d+ life rather than pay ~'s mana cost\.?$/i.test(line)) continue;
    if (/^you may return an? [A-Za-z][A-Za-z'’-]* you control to its owner's hand rather than pay ~'s mana cost\.?$/i.test(line)) continue;
    if (/^you may pay (?:\{[^}]+\})+ rather than pay ~'s mana cost\.?$/i.test(line)) continue;
    if (/^gift a card\.?$/i.test(line)) continue;
    if (/^creatures can'?t attack you unless their controller pays \{(\d+)\} for each creature they control that'?s attacking you\.?$/i.test(line)) continue;
    if (/^double all damage equipped creature would deal\.?$/i.test(line)) continue;
    if (/^~ enters prepared\.?$/i.test(line)) continue;
    if (/^you\s+may\s+play\s+(?:a|an|one|two|three)\s+additional\s+lands?\s+on\s+each\s+of\s+your\s+turns\.?$/i.test(line)) continue;
    // Oracle of Mul Daya (CR 305.1): consumed into CardProfile.playLandsFromTopOfLibrary.
    if (/^you\s+may\s+play\s+lands\s+from\s+the\s+top\s+of\s+your\s+library\.?$/i.test(line)) continue;
    // Consumed into CardProfile.revealsTopOfLibrary; the engine exposes the top
    // card as public information in the projection rather than a one-shot effect.
    if (/^play\s+with\s+the\s+top\s+card\s+of\s+your\s+library\s+revealed\.?$/i.test(line)) continue;
    if (/^if an opponent would draw a card except the first one they draw in each of their draw steps, instead that player skips that draw and you draw a card\.?$/i.test(line)) continue;
    if (/^you can't win the game and your opponents can't lose the game\.?$/i.test(line)) continue;
    if (/^all creatures attack each combat if able\.?$/i.test(line)) continue;
    if (parseDamageAmplify(line)) continue;
    // Rebound is synthesised from the keyword; consume the reminder line.
    if (/^rebound$/i.test(line)) continue;
    // Extort is synthesised from the keyword below (CR 702.39).
    if (/^extort\.?$/i.test(line)) continue;
    // Undying / Persist (CR 702.93/702.92) are synthesised from the keyword below.
    if (/^undying\.?$/i.test(line)) continue;
    if (/^persist\.?$/i.test(line)) continue;
    // Changeling is represented by `profile.changeling` and enforced by
    // `hasSubtype` in every zone (CR 702.73a); consume the keyword line only
    // after that semantic representation has been built.
    if (/^changeling\.?$/i.test(line)) continue;
    // Storm remains a keyword-only marker until copy-count tracking is added.
    if (/^storm\.?$/i.test(line)) continue;
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
    if (/^Whenever enchanted land is tapped for mana, its controller adds an additional \{[WUBRGC]\}\.?$/i.test(line)) continue;
    if (/^~ doesn[’']t untap during your untap step\.?$/i.test(line)) continue;
    if (/^Whenever you tap a land for mana, add one mana of any type that land produced\.?$/i.test(line)) continue;
    // A keyword-only line ("Flying, vigilance") is fully covered by the keyword engine.
    const words = line.replace(/\.$/, "").split(/,\s*/).map((word) => word.trim().toLowerCase());
    if (words.length && words.every((word) => (ENFORCED_KEYWORDS as readonly string[]).includes(word))) continue;
    // A mana ability counts as covered only when its printed output is really
    // recognised. One the parser cannot read still plays through the structured
    // `produced_mana` fallback, but the card must not claim its text is executed.
    const manaLine = /^([^:]{1,80}):\s*(add\b.*)$/i.exec(line);
    if (manaLine) {
      const variableStorageMana = /^add\s+X\s+mana\s+in\s+any\s+combination\s+of\s+\{[WUBRGC]\}(?:\s+and\/or\s+\{[WUBRGC]\})?\.?$/i.test(manaLine[2]!.trim())
        && /remove\s+X\s+storage\s+counters\s+from\s+(?:~|this\s+(?:land|permanent))/i.test(manaLine[1]!);
      // Board-dependent color (Fellwar Stone, Harvester Druid): resolved at
      // activation time by `manaOptionsFor`, not by `parseAddClause`.
      const anyColorFromLandsLine = /^add\s+one\s+mana\s+of\s+any\s+(?:color|type)\s+that\s+a\s+land\s+(?:an\s+opponent\s+controls|you\s+control)\s+could\s+produce\.?$/i.test(manaLine[2]!.trim());
      const variableSacrificeMana = /(?:\{T\},\s*)?sacrifice\s+X\s+[A-Za-z][A-Za-z'’-]*s?\s*$/i.test(manaLine[1]!.trim())
        && /^add\s+X\s+mana\s+of\s+any\s+(?:one\s+)?color\.?\s*You gain X life\.?$/i.test(manaLine[2]!.trim());
      const restrictedManaLine = /spend\s+this\s+mana\s+only\s+to\s+cast\s+a\s+legendary\s+spell/i.test(manaLine[2]!)
        && Boolean(parseAddClause(manaLine[2]!.split(/[.!?]/, 1)[0] ?? ""));
      if (!parseManaInstruction(manaLine[2]!) && !variableStorageMana && !anyColorFromLandsLine && !variableSacrificeMana && !restrictedManaLine) unimplementedText.push(line);
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
    // "When ~ enters and whenever an opponent draws a card except the first
    // one they draw in each of their draw steps, X" is an enters trigger
    // plus a filtered card-drawn trigger (Orcish Bowmasters, CR 603.2).
    const entersAndOpponentDrawStep = /^when\s+~\s+enters\s+and\s+whenever\s+an\s+opponent\s+draws\s+a\s+card\s+except\s+the\s+first\s+one\s+they\s+draw\s+in\s+each\s+of\s+their\s+draw\s+steps,?\s*(.+)$/i.exec(line);
    if (entersAndOpponentDrawStep) {
      const rec = recognizeSentence(entersAndOpponentDrawStep[1]!);
      if (rec) {
        triggers.push({ event: "enters-battlefield", subject: "self", effect: rec.effect, optional: false, targetKind: rec.target, sourceText: line });
        triggers.push({
          event: "card-drawn", subject: "opponent", condition: { kind: "not-first-draw-step-draw" },
          effect: rec.effect, optional: false, targetKind: rec.target, sourceText: line
        });
        continue;
      }
    }
    // "When this Class becomes level N, X" (CR 702.134): self-gated by the
    // reached level, so it needs no positional block-splitting like the other
    // Class ability lines do.
    const classLevelReached = /^when\s+this\s+class\s+becomes\s+level\s+(\d+),?\s*(.+)$/i.exec(line);
    if (classLevelReached) {
      const rec = recognizeSentence(classLevelReached[2]!.trim());
      if (rec) {
        triggers.push({
          event: "class-level-up", subject: "self", condition: { kind: "class-level-reached", level: Number(classLevelReached[1]) },
          effect: rec.effect, optional: false, targetKind: rec.target, sourceText: line
        });
        continue;
      }
    }
    // "At the beginning of your upkeep, if a player has N or fewer cards in
    // hand, ~ becomes prepared." (new "Prepared" mechanic, Naktamun
    // Lorespinner // Wheel of Fortune): the source itself gains the state,
    // no target and no further effect text.
    const becomesPrepared = /^at\s+the\s+beginning\s+of\s+your\s+upkeep,\s*if\s+a\s+player\s+has\s+(\w+)\s+or\s+fewer\s+cards?\s+in\s+hand,?\s*~\s+becomes\s+prepared\.?$/i.exec(line);
    if (becomesPrepared) {
      const amount = toNumber(becomesPrepared[1]);
      if (amount !== null) {
        triggers.push({
          event: "upkeep", subject: "you", condition: { kind: "any-player-hand-at-most", amount },
          effect: { kind: "become-prepared" }, optional: false, targetKind: "none", sourceText: line
        });
        continue;
      }
    }
    // "Whenever ~ attacks, it becomes prepared." (Prepared mechanic): unconditional, no target.
    if (/^whenever\s+~\s+attacks,?\s*(?:it\s+)?becomes\s+prepared\.?$/i.test(line)) {
      triggers.push({ event: "attacks", subject: "self", effect: { kind: "become-prepared" }, optional: false, targetKind: "none", sourceText: line });
      continue;
    }
    // "At the beginning of your upkeep, if ~ isn't prepared, it becomes
    // prepared." (Prepared mechanic): the guard is a no-op (setting an
    // already-true flag to true again), so this is just an unconditional
    // per-upkeep re-preparation.
    if (/^at\s+the\s+beginning\s+of\s+your\s+upkeep,\s*if\s+~\s+isn['’]t\s+prepared,?\s*(?:it\s+)?becomes\s+prepared\.?$/i.test(line)) {
      triggers.push({ event: "upkeep", subject: "you", effect: { kind: "become-prepared" }, optional: false, targetKind: "none", sourceText: line });
      continue;
    }
    // "At the beginning of your first main phase, ~ becomes prepared." (Prepared mechanic): unconditional.
    if (/^at\s+the\s+beginning\s+of\s+your\s+first\s+main\s+phase,?\s*~\s+becomes\s+prepared\.?$/i.test(line)) {
      triggers.push({ event: "first-main-phase", subject: "you", effect: { kind: "become-prepared" }, optional: false, targetKind: "none", sourceText: line });
      continue;
    }
    // "Whenever you cast a creature spell, ~ becomes prepared." (Prepared mechanic).
    if (/^whenever\s+you\s+cast\s+a\s+creature\s+spell,?\s*~\s+becomes\s+prepared\.?$/i.test(line)) {
      triggers.push({ event: "spell-cast", subject: "you", spellType: "creature", effect: { kind: "become-prepared" }, optional: false, targetKind: "none", sourceText: line });
      continue;
    }
    // "Landfall — Whenever a land you control enters, ~ becomes prepared."
    // (Prepared mechanic): reuses the existing "land-you-control" trigger
    // subject, already used by real Landfall abilities, and the same
    // ability-word-prefix stripping `matchTriggerLine` already applies.
    const landfallPrepared = line.replace(/^landfall\s+[—–-]\s*/i, "");
    if (/^whenever\s+a\s+land\s+you\s+control\s+enters(?:\s+the\s+battlefield)?,?\s*~\s+becomes\s+prepared\.?$/i.test(landfallPrepared)) {
      triggers.push({ event: "enters-battlefield", subject: "land-you-control", effect: { kind: "become-prepared" }, optional: false, targetKind: "none", sourceText: line });
      continue;
    }
    // "Whenever one or more creatures you control deal combat damage to a
    // player, ~ becomes prepared." (Prepared mechanic): fires once per
    // qualifying creature, harmless since `prepared` is already idempotent.
    if (/^whenever\s+one\s+or\s+more\s+creatures\s+you\s+control\s+deal\s+combat\s+damage\s+to\s+a\s+player,?\s*~\s+becomes\s+prepared\.?$/i.test(line)) {
      triggers.push({ event: "deals-combat-damage-to-player", subject: "creature-you-control", effect: { kind: "become-prepared" }, optional: false, targetKind: "none", sourceText: line });
      continue;
    }
    // "Whenever another creature you control with power N or less enters, X" (Mentor of the Meek).
    const highPowerEnters = /^whenever\s+(?:a|another)\s+creature\s+you\s+control\s+with\s+power\s+(\d+)\s+or\s+greater\s+enters(?:\s+the\s+battlefield)?,?\s*(.+)$/i.exec(line);
    if (highPowerEnters) {
      const rawEffect = highPowerEnters[2]!.trim();
      const optional = /^you\s+may\b/i.test(rawEffect);
      const executable = rawEffect.replace(/^you\s+may\s+have\s+/i, "").replace(/^you\s+may\s+/i, "").replace(/^~\s+deal\b/i, "~ deals");
      const rec = recognizeSentence(executable);
      if (rec) {
        triggers.push({
          event: "enters-battlefield", subject: "creature-you-control", effect: rec.effect,
          optional, targetKind: rec.target, sourceText: line,
          condition: { kind: "entering-power-at-least", amount: Number(highPowerEnters[1]) }
        });
      } else unimplementedText.push(line);
      continue;
    }
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
    // "Whenever a <Subtype> you control attacks, X" (Atarka, World Render): a
    // tribal filter on the attacking creature itself, distinct from a
    // board-count condition.
    const subtypeAttacks = /^whenever\s+an?\s+([A-Za-z][A-Za-z'’-]*)\s+you\s+control\s+attacks,?\s*(.+)$/i.exec(line);
    if (subtypeAttacks && !/^(?:creature|permanent|player)$/i.test(subtypeAttacks[1]!)) {
      const rec = recognizeSentence(subtypeAttacks[2]!);
      if (rec) {
        triggers.push({
          event: "attacks", subject: "creature-you-control", effect: rec.effect,
          optional: false, targetKind: rec.target, sourceText: line,
          requireSubtype: subtypeAttacks[1]!
        });
        continue;
      }
    }
    // "When ~ enters, it deals N damage to up to one target creature" (Mjölnir,
    // CR 603.2, 601.2c): the target is optional, so `minimumTargets: 0` lets
    // the existing multi-target choice machinery offer "finish with none".
    const optionalCreatureDamageEnters = /^when\s+~\s+enters,?\s+it deals (\d+) damage to up to one target creature\.?$/i.exec(line);
    if (optionalCreatureDamageEnters) {
      triggers.push({
        event: "enters-battlefield", subject: "self", effect: { kind: "damage-any-target", amount: Number(optionalCreatureDamageEnters[1]) },
        optional: false, targetKind: "creature", targetKinds: ["creature"], minimumTargets: 0, sourceText: line
      });
      continue;
    }
    const dividedDamageTrigger = /^(?:when|whenever)\s+~\s+enters(?:\s+the\s+battlefield)?\s+or\s+attacks,?\s+it deals (\d+) damage divided as you choose among one, two, or three targets\.?$/i.exec(line);
    if (dividedDamageTrigger) {
      triggers.push({
        event: "enters-battlefield", subject: "self", effect: { kind: "damage-divided-targets", amount: Number(dividedDamageTrigger[1]) },
        optional: false, targetKind: "any", targetKinds: ["any", "any", "any"], minimumTargets: 1, sourceText: line
      });
      // The same printed ability also fires from attacks; the shared effect is
      // represented by a second trigger so both event paths remain explicit.
      triggers.push({
        event: "attacks", subject: "self", effect: { kind: "damage-divided-targets", amount: Number(dividedDamageTrigger[1]) },
        optional: false, targetKind: "any", targetKinds: ["any", "any", "any"], minimumTargets: 1, sourceText: line
      });
      continue;
    }
    // Myr Battlesphere: tapping any number of untapped Myr is an optional
    // resolution choice, not a mana cost. Keep the selected group explicit so
    // the authoritative engine can validate and tap the exact permanents.
    const tapAndAttack = /^(?:when|whenever)\s+~\s+attacks,?\s+you may tap\s+(X|any number of|a|an|one|two|three|four|five|\d+)\s+untapped\s+([A-Za-z][A-Za-z'’/-]*)\s+you\s+control\.\s*if you do,\s+~ gets \+X\/\+0 until end of turn and deals X damage to the player or planeswalker it's attacking\.?$/i.exec(line);
    if (tapAndAttack) {
      const amountText = tapAndAttack[1]!.toLowerCase();
      const amount = /^(?:x|any number of)$/.test(amountText) ? "any" as const : toNumber(amountText);
      if (amount !== null) {
        triggers.push({
          event: "attacks", subject: "self",
          effect: { kind: "tap-creatures-pump-source-damage-attacker", subtype: singularSubtype(tapAndAttack[2]!) },
          optional: true, targetKind: "none", sourceText: line,
          tapCost: { amount, subtype: singularSubtype(tapAndAttack[2]!), mode: "any" }
        });
        continue;
      }
    }
    const defendingLandsPump = /^(?:when|whenever)\s+~\s+attacks,?\s+it gets \+X\/\+0 until end of turn,?\s+where X is the number of lands defending player controls\.?$/i.test(line);
    if (defendingLandsPump) {
      triggers.push({
        event: "attacks", subject: "self", effect: { kind: "pump-source-by-defending-lands" },
        optional: false, targetKind: "none", sourceText: line
      });
      continue;
    }
    // Stalking Vengeance: "it" refers to the source permanent, not the
    // creature whose death caused the trigger (CR 109.5).
    if (/^whenever\s+another\s+creature\s+you\s+control\s+dies,?\s+it\s+deals\s+damage\s+equal\s+to\s+its\s+power\s+to\s+target\s+player\s+or\s+planeswalker\.?$/i.test(line)) {
      triggers.push({
        event: "dies", subject: "another-creature-you-control", effect: { kind: "damage-source-power" },
        optional: false, targetKind: "player-or-planeswalker", sourceText: line
      });
      continue;
    }
    const linkedLeavesReturn = /~\s+leaves\s+the\s+battlefield,?\s+return\s+the\s+exiled\s+card\s+to\s+the\s+battlefield\s+under\s+its\s+owner[\x27\u2019]?s\s+control/i.test(line);
    const leavesLine = linkedLeavesReturn ? line : line.replace(/~\s+leaves\s+the\s+battlefield/i, "~ is put into a graveyard from the battlefield");
    // Modern Oracle splits Bane of Progress's dependent instruction into a
    // second sentence. Keep it attached to the ETB trigger so the existing
    // counted sweep primitive remains reusable across printings (CR 603.2,
    // 603.3; the count is locked to permanents destroyed by that event).
    const modernBane = /^(?:when|whenever)\s+~\s+enters(?:\s+the\s+battlefield)?,?\s*destroy all artifacts and enchantments\.\s*put a (\+1\/\+1|-1\/-1) counter on ~ for each permanent destroyed this way\.?$/i.exec(line);
    if (modernBane) {
      triggers.push({
        event: "enters-battlefield", subject: "self",
        effect: { kind: "destroy-all-artifacts-enchantments-add-counters", counter: modernBane[1]! },
        optional: false, targetKind: "none", sourceText: line
      });
      continue;
    }
    const lifeGainCounter = /^whenever\s+you\s+gain\s+life,?\s+you may pay\s+((?:\{[^}]+\})+)\.?\s*if you do,?\s*put a (\+1\/\+1|-1\/-1) counter on target creature for each 1 life you gained\.?$/i.exec(line);
    if (lifeGainCounter) {
      const payCost = parseManaCost(lifeGainCounter[1]!);
      if (payCost && !payCost.hasVariable) {
        triggers.push({
          event: "life-gained", subject: "you",
          effect: { kind: "add-counter-target-creature-per-life-gained", counter: lifeGainCounter[2]! },
          optional: true, targetKind: "creature", payCost, sourceText: line
        });
        continue;
      }
    }
    // Ability words are presentation labels, not part of the trigger grammar.
    // Normalize both current and legacy-import separators here as a second
    // boundary so a malformed historical U+FFFD cannot hide a valid trigger.
    const triggerLine = (leavesLine !== line ? leavesLine : line)
      .replace(/^(?:landfall|morbid)\s+[—–-\uFFFD]\s*/i, "");
    const triggered = matchTriggerLine(triggerLine);
    if (triggered) {
      const subtypeCondition = /^if\s+you\s+control\s+no\s+([A-Za-z][A-Za-z'’/-]*),\s*(.+)$/i.exec(triggered.effectText);
      const powerCondition = /^if\s+you\s+control\s+a\s+creature\s+with\s+power\s+(\d+)\s+or\s+greater,\s*(.+)$/i.exec(triggered.effectText);
      const countCondition = /^if\s+you\s+control\s+([a-z]+|\d+)\s+or\s+more\s+([A-Za-z][A-Za-z'’/-]*?)s?,\s*(.+)$/i.exec(triggered.effectText);
      const countConditionAmount = countCondition ? toNumber(countCondition[1]!) : null;
      const diedCondition = /^if\s+a\s+creature\s+died\s+this\s+turn,\s*(.+)$/i.exec(triggered.effectText);
      const castFromHandCondition = /^if\s+you\s+cast\s+it\s+from\s+your\s+hand,\s*(.+)$/i.exec(triggered.effectText);
      const commandZoneCondition = /^if\s+.+?\s+is\s+in\s+the\s+command\s+zone,\s*(.+)$/i.exec(triggered.effectText);
      const sourceUntappedCondition = /^if\s+~\s+is\s+untapped,\s*(.+)$/i.exec(triggered.effectText);
      const sourceTappedCondition = /^if\s+~\s+is\s+tapped,\s*(.+)$/i.exec(triggered.effectText);
      const eventControllerChoice = /^that\s+(?:creature[’']s\s+controller|attacking\s+player)\s+may\s+(.+)$/i.exec(triggered.effectText);
      const unlessPayment = /^you\s+may\s+(.+?)\s+unless\s+that\s+player\s+pays\s+((?:\{[^}]+\})+)\.?$/i.exec(triggered.effectText);
       const sacrificeUnlessPayment = /^sacrifice\s+(?:~|it|this\s+[^,]+?)\s+unless\s+you\s+pay\s+((?:\{[^}]+\})+)\.?$/i.exec(triggered.effectText);
       const sacrificeUnlessSpent = /^sacrifice\s+(?:~|it|this\s+[^,]+?)\s+unless\s+\{([WUBRGC])\}\s+was\s+spent\s+to\s+cast\s+it\.?$/i.exec(triggered.effectText);
      const mayHave = /^you\s+may\s+have\b/i.test(triggered.effectText);
      // Wizards writes the source as "it" once the trigger clause has already
      // named the permanent (e.g. Flametongue Kavu: "..., it deals 4 damage").
      let effectText = (powerCondition?.[2]?.trim() ?? subtypeCondition?.[2]?.trim() ?? commandZoneCondition?.[1]?.trim() ?? sourceUntappedCondition?.[1]?.trim() ?? sourceTappedCondition?.[1]?.trim() ?? unlessPayment?.[1]?.trim() ?? eventControllerChoice?.[1]?.trim() ?? triggered.effectText)
        .replace(/^you\s+may\s+have\s+it\s+deal\b/i, "~ deals")
        .replace(/^you\s+may\s+have\s+target\s+creature\s+gain\b/i, "Target creature gains")
        .replace(/^it\s+(deals|gets|gains|enters|fights)\b/i, "~ $1");
      // "if it was kicked" gate (CR 702.33e).
      const kickedGate = /^if (?:it|this creature|this permanent|~) was kicked,\s*(.+)$/i.exec(effectText);
      const requiresKicked = Boolean(kickedGate);
      if (kickedGate) effectText = kickedGate[1]!.replace(/^it\s+(deals|gets|gains|enters|fights)\b/i, "~ $1");
      // Well of Lost Dreams: X is chosen on resolution and capped by the life
      // gain event (CR 107.3, 118.3). Keep this as a reusable variable-cost
      // trigger shape instead of hard-coding the card in the engine.
      const variableLifePay = /^you may pay \{X\}, where X is less than or equal to the amount of life you gained\.?\s*if you do,?\s*(draw X cards?\.?)$/i.test(effectText);
      if (variableLifePay) effectText = effectText.replace(/^you may pay \{X\}, where X is less than or equal to the amount of life you gained\.?\s*if you do,?\s*/i, "");
      // "you may pay {cost}. If you do, X" — an optional mana cost gating X.
      const payGate = variableLifePay ? null : /^you may pay ((?:\{[^}]+\})+)\.?\s*(?:if you do,?\s*)?(.+)$/i.exec(effectText);
      const payCost = payGate ? parseManaCost(payGate[1]!) : unlessPayment ? parseManaCost(unlessPayment[2]!) : sacrificeUnlessPayment ? parseManaCost(sacrificeUnlessPayment[1]!) : null;
      if (payGate) effectText = payGate[2]!.replace(/^it\s+(deals|gets|gains|enters|fights)\b/i, "~ $1");
       const optional = variableLifePay || payGate || unlessPayment || sacrificeUnlessPayment || eventControllerChoice || mayHave ? true : /^you\s+may\b/i.test(effectText);
      const recognized = (payCost && payCost.hasVariable && !variableLifePay) ? null
         : sacrificeUnlessPayment || sacrificeUnlessSpent
        ? { effect: { kind: "sacrifice-source" } as SpellEffect, target: "none" as TargetKind }
        : (() => {
          // Normalize cycling's optional targeted keyword wording to the
          // existing temporary-keyword primitive (CR 603.1, 603.2).
          const optionalTargetKeyword = /^you\s+may\s+have\s+target creature gain\s+(flying|reach|first strike|double strike|deathtouch|trample|vigilance|lifelink|menace|defender|haste|indestructible|hexproof|shroud|fear|intimidate)\s+until end of turn\.?$/i.exec(effectText);
          const executableText = optionalTargetKeyword
            ? `Target creature gains ${optionalTargetKeyword[1]} until end of turn`
            : optional && !payGate
            // Keep the subject for the compositional draw/life grammar. A
            // blanket removal would turn "you may gain 2 life" into the
            // invalid fragment "gain 2 life" (CR 609.3).
            ? effectText.replace(/^you\s+may\s+(?=(?:draw|mill|discard|gain|lose)\b)/i, "You ").replace(/^you\s+may\s+/i, "")
            : effectText;
          const normalizedExecutableText = executableText.replace(/^(?:have\s+)?(?:it|~)\s+deal\b/i, "~ deals");
          const lookTop = parseLookTopSelection(normalizedExecutableText);
          const manaSpentToken = parseManaSpentToken(normalizedExecutableText);
          return manaSpentToken ? { effect: manaSpentToken, target: "none" as TargetKind }
            : lookTop ? { effect: lookTop, target: "none" as TargetKind } : recognizeSentence(normalizedExecutableText);
        })();
      if (recognized) {
        const capriciousMultiTarget = /^choose target nonland permanent you control and up to two target nonland permanents you don't control\. destroy one of them at random\.?$/i.test(effectText);
        triggers.push({
          event: triggered.event,
          subject: triggered.subject,
          effect: recognized.effect,
          optional,
          targetKind: recognized.target,
          ...(capriciousMultiTarget ? { targetKinds: ["nonland-you-control", "nonland-opponent", "nonland-opponent"] as const, minimumTargets: 1 } : {}),
          ...(recognized.effect.kind === "exile-target-permanent-delayed-return"
            || (recognized.effect.kind === "exile-target-nontoken-creature" && recognized.effect.returnOnSourceLeave)
            ? { excludesSourceFromTargets: true } : {}),
          sourceText: line,
          ...(unlessPayment && payCost ? { paymentBy: "opponent" as const } : {}),
          ...(eventControllerChoice ? { choiceBy: "event-controller" as const } : {}),
          ...(triggered.condition ? { condition: triggered.condition } : {}),
          ...(subtypeCondition ? { condition: { kind: "no-controlled-subtype" as const, subtype: subtypeCondition[1]! } } : {}),
          ...(powerCondition ? { condition: { kind: "controlled-creature-power-at-least" as const, amount: Number(powerCondition[1]) } } : {}),
          ...(countCondition && countConditionAmount !== null ? { condition: { kind: "controlled-subtype-at-least" as const, subtype: countCondition[2]!, amount: countConditionAmount } } : {}),
          ...(diedCondition ? { condition: { kind: "creature-died-this-turn" as const } } : {}),
          ...(castFromHandCondition ? { condition: { kind: "cast-from-hand" as const } } : {}),
          ...(sourceUntappedCondition ? { condition: { kind: "source-untapped" as const } } : {}),
          ...(sourceTappedCondition ? { condition: { kind: "source-tapped" as const } } : {}),
          ...(commandZoneCondition ? { condition: { kind: "source-in-command-zone" as const } } : {}),
          ...(triggered.spellType ? { spellType: triggered.spellType } : {}),
          ...(triggered.spellColor ? { spellColor: triggered.spellColor } : {}),
          ...(triggered.spellSubtype ? { spellSubtype: triggered.spellSubtype } : {}),
          ...(triggered.nontoken ? { nontoken: true } : {}),
          ...(triggered.discardedCardType ? { discardedCardType: triggered.discardedCardType } : {}),
          ...(requiresKicked ? { requiresKicked: true as const } : {}),
          ...(payCost && payCost.symbols.length && !sacrificeUnlessPayment && !variableLifePay ? { payCost, manaCost: payCost } : {}),
          ...(variableLifePay ? { payCost: parseManaCost("{X}")!, variablePayCost: "event-amount" as const } : {}),
           ...(sacrificeUnlessPayment && payCost?.symbols.length ? { unlessPayCost: payCost } : {}),
           ...(sacrificeUnlessSpent ? { requiresManaTypeNotSpent: sacrificeUnlessSpent[1]!.toUpperCase() as ManaType } : {})
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

    const sentences = line.split(SENTENCE_SPLIT);
    for (let sentenceIndex = 0; sentenceIndex < sentences.length; sentenceIndex += 1) {
      const sentence = sentences[sentenceIndex]!;
      if (!sentence.trim()) continue;
      // "If ~ was kicked, X" — X applies only on a kicked cast (CR 702.33e).
      const ifKicked = /^If (?:~|this spell|this creature) was kicked(?:\s+\d+ times?)?,\s*(.+)$/i.exec(sentence.trim());
      if (ifKicked) {
        const keyword = /^it has (split second)\.?$/i.exec(ifKicked[1]!.trim());
        if (keyword) { kickedKeywords.push(keyword[1]!.toLowerCase() as EnforcedKeyword); continue; }
        const kickedText = ifKicked[1]!
          .replace(/^instead\s+/i, "")
          .replace(/^it\b/i, "~")
          .replace(/\s+instead\.?$/i, "");
        // "If ~ was kicked, it enters with N +1/+1 counters on it" (Marsh Boa,
        // Woodland Wanderer-adjacent kicker creatures): a conditional ETB
        // replacement, applied by putOntoBattlefield when the cast was kicked.
        const kickedCounters = parseEntersWithCounters(kickedText);
        if (kickedCounters.length) { kickedEntersWithCounters.push(...kickedCounters); continue; }
        // Kicker replacement clauses commonly omit the already-established
        // target ("If kicked, it deals 4 damage instead"). Infer the same
        // any-target damage primitive and retain the base sentence's target.
        const damageOnly = /^~ deals (\w+) damage$/i.exec(kickedText);
        const damageAmount = damageOnly ? (damageOnly[1]!.toUpperCase() === "X" ? "X" as const : toNumber(damageOnly[1]!)) : null;
        const rk = recognizeSentence(kickedText) ?? (damageAmount !== null
          ? { effect: { kind: "damage-any-target", amount: damageAmount } as SpellEffect, target: "none" as TargetKind }
          : null);
        if (rk && /\binstead\b/i.test(ifKicked[1]!)) {
          const base = effects[effects.length - 1];
          if (base?.kind === "damage-any-target" && rk.effect.kind === "damage-any-target") {
            effects[effects.length - 1] = { ...base, kickedAmount: rk.effect.amount };
            if (rk.target !== "none") targetKind = rk.target;
            continue;
          }
        }
        if (rk) { kickedEffects.push(rk.effect); if (rk.target !== "none") targetKind = rk.target; }
        else unimplementedText.push(sentence.trim());
        continue;
      }
      const recognized = recognizeSentence(sentence);
      if (!recognized) {
        if (!isIgnorableSentence(sentence, /chosen color/i.test(joined))) unimplementedText.push(sentence.trim());
        continue;
      }
      // Incinerate and the same reusable wording carry the regeneration rider
      // in the sentence immediately following their damage instruction.
      // Fold both clauses into one executable effect so the rider only applies
      // to a creature that actually received this damage (CR 615.1, 701.19).
      const noRegenerationRider = sentences[sentenceIndex + 1]?.trim();
      if (recognized.effect.kind === "damage-any-target"
        && /^a creature dealt damage this way can(?:not|'t) be regenerated this turn\.?$/i.test(noRegenerationRider ?? "")) {
        effects.push({ kind: "damage-any-target-prevents-regeneration", amount: recognized.effect.amount });
        if (recognized.target !== "none") targetKind = recognized.target;
        sentenceIndex += 1;
        continue;
      }
      if (recognized.effect.kind === "damage-any-target"
        && /^if that creature would die this turn, exile it instead\.?$/i.test(noRegenerationRider ?? "")) {
        effects.push({ kind: "damage-any-target-exiles-if-dies", amount: recognized.effect.amount });
        if (recognized.target !== "none") targetKind = recognized.target;
        sentenceIndex += 1;
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
  return { effects, triggers, activatedAbilities, modalChoices, targetKind, kickerCost, entwineCost, graftAmount, kickedEffects, kickedKeywords, kickedEntersWithCounters, evokeCost, flashbackCost, echoCost, miracleCost, unimplementedText, covered: unimplementedText.length === 0 };
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
  const changeling = (card.keywords ?? []).some((keyword) => keyword.toLowerCase() === "changeling");
  const isPermanent = types.some((type) => type === "Land" || type === "Creature" || type === "Artifact" || type === "Enchantment" || type === "Planeswalker" || type === "Battle");
  const cost = parseManaCost(face.mana_cost);
  const cantBeCountered = /(?:^|\n)(?:~|This spell) can't be countered\.(?=\s|$)/i.test(text);
  const uncounterableCreaturePowerMatch = /creature spells you control with power (\d+) or greater can't be countered\.?/i.exec(text);
  const affinityMatch = /^Affinity for (.+)$/im.exec(text);
  const affinityFor = affinityMatch?.[1]?.trim().toLowerCase() ?? null;
  const recognized = recognizeText(text
    .replace(/(?:^|\n)(?:~|This spell) can't be countered\.(?=\s|$)/gi, "\n")
    .replace(/^Affinity for .+$/gim, ""));
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
  // Prowess (CR 702.108): a noncreature spell cast by this creature's
  // controller creates a temporary +1/+1 self-trigger. Keep it on the same
  // event/effect path used by ordinary triggered card text.
  if (lowerKeywords.includes("prowess")) synthesizedTriggers.push({
    event: "spell-cast", subject: "you", spellType: "noncreature",
    effect: { kind: "modify-source-creature", power: 1, toughness: 1 },
    optional: false, targetKind: "none", sourceText: "Prowess"
  });
  // Exalted (CR 702.83): the attacking creature gets +1/+1 only when it is
  // the sole attacker; the normal attack event carries the exact creature.
  if (lowerKeywords.includes("exalted")) synthesizedTriggers.push({
    event: "attacks", subject: "creature-you-control", condition: { kind: "attacking-alone" },
    effect: { kind: "modify-triggered-creature", power: 1, toughness: 1 },
    optional: false, targetKind: "none", sourceText: "Exalted"
  });
  const graftAmount = recognized.graftAmount ?? null;
  if (graftAmount !== null) synthesizedTriggers.push({
    event: "enters-battlefield", subject: "another-creature",
    effect: { kind: "move-counter-from-source-to-triggered-creature", counter: "+1/+1" },
    optional: true, targetKind: "none", sourceText: `Graft ${graftAmount}`
  });
  const manaAbilities = isPermanent ? parseManaAbilities(card, text) : [];
  const cyclingCost = parseCyclingCost(text);
  const cyclingSearches = parseCyclingSearches(text);
  const flashbackCost = parseFlashbackCost(text);
  const flashbackLifeCost = parseFlashbackLifeCost(text);
  const additionalLifeMatch = /^as an additional cost to cast ~, pay (X|\d+) life\.?$/im.exec(text);
  const additionalLifeCost = additionalLifeMatch && additionalLifeMatch[1] !== "X" ? Number(additionalLifeMatch[1]) : 0;
  const additionalLifeCostVariable = additionalLifeMatch?.[1] === "X";
  const equipCost = parseEquipCost(text);
  const typedEquipCost = parseTypedEquipCost(text);
  const equipWorthyCost = parseEquipWorthyCost(text);
  // "~ costs {N} less to cast for each creature on the battlefield" (Blasphemous Act, CR 118.9).
  const boardReduceMatch = /~ costs \{(\d+)\} less to cast for each creature on the battlefield/i.exec(text);
  const costReducesPerBoardCreature = boardReduceMatch ? Number(boardReduceMatch[1]) : 0;
  const cdaMatch = /~'?s power and toughness are each equal to the number of (creature|land|artifact|green permanent)s? you control/i.exec(text);
  const lifeCdaMatch = /~'?s power and toughness are each equal to your life total/i.test(text);
  const handCdaMatch = /~'?s power and toughness are each equal to the number of cards in your hand/i.test(text);
  const cdaPowerToughness = lifeCdaMatch
    ? "your-life-total"
    : handCdaMatch
      ? "cards-in-your-hand"
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
  const multiColorGrantMatch = /^((?:(?:white|blue|black|red|green)\s+spells)(?:\s+and\s+(?:white|blue|black|red|green)\s+spells)+) you cast cost \{(\d+)\} less to cast\.?$/im.exec(text);
  const grantMatch = /^(?:(white|blue|black|red|green) )?(artifact|creature|enchantment|instant|sorcery|planeswalker)? ?spells you cast cost \{(\d+)\} less to cast\.?$/im.exec(text);
  const colorPairGrantMatch = /^(blue|red) spells and (blue|red) spells you cast cost \{(\d+)\} less to cast\.?$/im.exec(text);
  const subtypeGrantMatch = /^([A-Za-z][A-Za-z'’/-]*) spells you cast cost \{(\d+)\} less to cast\.?$/im.exec(text);
  const globalInstantSorceryMatch = /^instant and sorcery spells cost \{(\d+)\} less to cast\.?$/im.exec(text);
  const COLOR_LETTER: Record<string, string> = { white: "W", blue: "U", black: "B", red: "R", green: "G" };
  const spellCostReductionGrant = globalInstantSorceryMatch
    ? { amount: Number(globalInstantSorceryMatch[1]), types: ["Instant", "Sorcery"] as const, appliesToAllPlayers: true }
    : multiColorGrantMatch
    ? {
        amount: Number(multiColorGrantMatch[2]),
        colors: [...new Set([...multiColorGrantMatch[1]!.matchAll(/(white|blue|black|red|green)\s+spells/gi)].map((match) => COLOR_LETTER[match[1]!.toLowerCase()]!))]
      }
    : grantMatch
    ? {
        amount: Number(grantMatch[3]),
        ...(grantMatch[1] ? { color: COLOR_LETTER[grantMatch[1].toLowerCase()] } : {}),
        ...(grantMatch[2] ? { type: (grantMatch[2][0]!.toUpperCase() + grantMatch[2].slice(1)) as CardType } : {})
      }
    : subtypeGrantMatch && !COLOR_LETTER[subtypeGrantMatch[1]!.toLowerCase()] && !CARD_TYPES.some((type) => type.toLowerCase() === subtypeGrantMatch[1]!.toLowerCase())
    ? { amount: Number(subtypeGrantMatch[2]), subtype: subtypeGrantMatch[1]![0]!.toUpperCase() + subtypeGrantMatch[1]!.slice(1) }
    : null;
  const equipmentModification = subtypes.some((subtype) => subtype.toLowerCase() === "equipment")
    ? parseEquipmentModification(text) : null;
  const auraModification = subtypes.some((subtype) => subtype.toLowerCase() === "aura")
    ? parseAuraModification(text) : null;
  const auraLandManaBonus = subtypes.some((subtype) => subtype.toLowerCase() === "aura")
    ? parseAuraLandManaBonus(text) : null;
  const auraControlTarget = subtypes.some((subtype) => subtype.toLowerCase() === "aura")
    ? parseAuraControlTarget(text) : null;
  const auraActivatedAbility = subtypes.some((subtype) => subtype.toLowerCase() === "aura")
    ? parseAuraGrantedActivatedAbility(text) : null;
  const staticKeywordGrants = parseStaticKeywordGrants(text);
  const staticManaAbilityGrants = parseManaAbilityGrants(text);
  const keywordsDuringYourTurn = parseKeywordsDuringYourTurn(text);
  const grantsCreatureActivationHaste = text.split("\n").some((line) =>
    /^you may activate abilities of creatures you control as though those creatures had haste\.?$/i.test(line.trim()));
  const untapColorsDuringOtherPlayersUntap = parseUntapColorsDuringOtherPlayersUntap(text);
  const triggerDoublers = parseTriggerDoublers(text);
  const preventsLifeGain = text.split("\n").some((line) => /^players can't gain life\.?$/i.test(line.trim()));
  const noMaximumHandSize = text.split("\n").some((line) => /^you have no maximum hand size\.?$/i.test(line.trim()));
  const noMaximumHandSizeForAllPlayers = text.split("\n").some((line) => /^players have no maximum hand size\.?$/i.test(line.trim()));
  const locksOpponentsOnYourTurn = /during your turn, your opponents can't cast spells or activate abilities of artifacts, creatures, or enchantments\.?/i.test(text);
  const grantsExtortToOthers = /other creatures you control have extort\.?/i.test(text);
  const attackersAssignAsUnblockedWhileAttacking = /for each creature you control, you may have that creature assign its combat damage as though it weren't blocked/i.test(text);
  const preventsOpponentLoss = /your opponents can't lose the game\.?/i.test(text);
  const forcesAllCreaturesToAttack = /all creatures attack each combat if able\.?/i.test(text);
  const damageAmplify = text.split("\n").map((line) => parseDamageAmplify(line.trim())).find((grant): grant is DamageAmplify => grant !== null) ?? null;
  const additionalCostExileGraveyardX = /as an additional cost to cast ~, exile x cards from your graveyard\.?/i.test(text);
  const hasRebound = /(?:^|\n)rebound\.?(?:$|\n)/i.test(text);
  const additionalCostSacrificeLand = /as an additional cost to cast ~, sacrifice a land\.?/i.test(text);
  const additionalCostSacrificeCreature = /as an additional cost to cast ~, sacrifice a creature\.?/i.test(text);
  const additionalCostSacrificeCreatureColorMatch = /as an additional cost to cast ~, sacrifice an? (white|blue|black|red|green) creature\.?/i.exec(text);
  const additionalCostSacrificeCreatureColor = additionalCostSacrificeCreatureColorMatch ? DAMAGE_AMPLIFY_COLOR_LETTER[additionalCostSacrificeCreatureColorMatch[1]!.toLowerCase()]! : null;
  const freeCastIfCommander = text.split("\n").some((line) => /^if you control a commander, you may cast ~ without paying its mana cost\.?$/i.test(line.trim()));
  const payLifeInsteadMatch = text.split("\n").map((line) => /^if you control an? ([A-Za-z][A-Za-z'’-]*), you may pay (\d+) life rather than pay ~'s mana cost\.?$/i.exec(line.trim())).find((match): match is RegExpExecArray => match !== null);
  const payLifeInsteadOfManaCost = payLifeInsteadMatch ? { life: Number(payLifeInsteadMatch[2]), controlLandType: payLifeInsteadMatch[1]! } : null;
  const returnLandInsteadMatch = text.split("\n").map((line) => /^you may return an? ([A-Za-z][A-Za-z'’-]*) you control to its owner's hand rather than pay ~'s mana cost\.?$/i.exec(line.trim())).find((match): match is RegExpExecArray => match !== null);
  const returnLandInsteadOfManaCost = returnLandInsteadMatch ? { subtype: returnLandInsteadMatch[1]! } : null;
  const payReducedCostMatch = text.split("\n").map((line) => /^you may pay ((?:\{[^}]+\})+) rather than pay ~'s mana cost\.?$/i.exec(line.trim())).find((match): match is RegExpExecArray => match !== null);
  const payReducedCostInstead = payReducedCostMatch ? parseManaCost(payReducedCostMatch[1]!) : null;
  const giftDrawsCard = text.split("\n").some((line) => /^gift a card$/i.test(line.trim().replace(/\.$/, "")));
  const attackTaxMatch = text.split("\n").map((line) => /^creatures can'?t attack you unless their controller pays \{(\d+)\} for each creature they control that'?s attacking you$/i.exec(line.trim().replace(/\.$/, ""))).find((match): match is RegExpExecArray => match !== null);
  const attackTaxPerCreature = attackTaxMatch ? Number(attackTaxMatch[1]) : null;
  const doublesEquippedCreatureDamage = text.split("\n").some((line) => /^double all damage equipped creature would deal$/i.test(line.trim().replace(/\.$/, "")));
  const redirectsOpponentDrawsExceptFirst = text.split("\n").some((line) =>
    /^if an opponent would draw a card except the first one they draw in each of their draw steps, instead that player skips that draw and you draw a card$/i.test(line.trim().replace(/\.$/, "")));
  const entersPrepared = text.split("\n").some((line) => /^~ enters prepared$/i.test(line.trim().replace(/\.$/, "")));
  const extraLandDropsMatch = text.split("\n")
    .map((line) => /^you\s+may\s+play\s+(a|an|one|two|three)\s+additional\s+lands?\s+on\s+each\s+of\s+your\s+turns$/i.exec(line.trim().replace(/\.$/, "")))
    .find((match): match is RegExpExecArray => match !== null);
  const extraLandDropsPerTurn = extraLandDropsMatch ? toNumber(extraLandDropsMatch[1]) ?? 1 : 0;
  const playLandsFromTopOfLibrary = text.split("\n").some((line) => /^you may play lands from the top of your library$/i.test(line.trim().replace(/\.$/, "")));
  const revealsTopOfLibrary = text.split("\n").some((line) => /^play with the top card of your library revealed$/i.test(line.trim().replace(/\.$/, "")));
  const giftPromisedMatch = text.split("\n").flatMap((line) => line.split(SENTENCE_SPLIT)).map((sentence) => /^if the gift was promised, instead (.+)$/i.exec(sentence.trim().replace(/\.$/, ""))).find((match): match is RegExpExecArray => match !== null);
  const giftPromisedRecognized = giftPromisedMatch ? recognizeSentence(giftPromisedMatch[1]!) : null;
  const giftPromisedTargetKind = giftPromisedRecognized && giftPromisedRecognized.target !== "none" ? giftPromisedRecognized.target : null;
  const doesNotUntapDuringUntap = text.split("\n").some((line) => /^~ doesn[’']t untap during your untap step\.?$/i.test(line.trim()));
 const staticPowerToughnessGrants = parseStaticPowerToughnessGrants(text);
  const copiesImprintedCreatureStats = /^as long as a card exiled with ~ is a creature card, ~ has the power, toughness, and creature types of the last creature card exiled with ~\. it's still a shapeshifter\.?$/im.test(text);
  const doublesLandMana = text.split("\n").some((line) => /^Whenever you tap a land for mana, add one mana of any type that land produced\.?$/i.test(line.trim()));
  const levelUpCost = parseLevelUpCost(text);
  const levelDefinitions = parseLevelDefinitions(text);
  const protectionFrom = text.split(/\r?\n/).flatMap((line) => parseProtectionFromLine(line) ?? []);
  const combatRules = parseCombatRules(text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)).rules;
  // A Class's second/third ability block is inactive until its level is
  // reached (CR 702.134d); `recognizeText` parses the whole card body without
  // knowing about card type, so the level floor for each printed line is
  // derived here and applied to its resulting triggers as a post-pass.
  const classLevels = subtypes.some((subtype) => subtype.toLowerCase() === "class") ? parseClassLevelCosts(text) : [];
  const classLevelLines = classLevels.length ? classLevelByLine(text) : null;
  const gatedTriggers = classLevelLines
    ? recognized.triggers.map((trigger) => {
        if (trigger.condition?.kind === "class-level-reached") return trigger;
        const level = classLevelLines.get(trigger.sourceText.trim());
        return level && level > 1 ? { ...trigger, minClassLevel: level } : trigger;
      })
    : recognized.triggers;
  // Prepared (new mechanic): only compute the back face's profile — a
  // recursive `cardProfile` call under its own synthetic `scryfall_id` — for
  // a card that actually has a "becomes prepared" trigger, so unrelated
  // multi-faced cards (Adventure, transform, split) never pay this cost.
  const preparedBackCard = (entersPrepared || gatedTriggers.some((trigger) => trigger.effect.kind === "become-prepared")) ? backFace(card) : null;
  const preparedBackProfile = preparedBackCard ? cardProfile(preparedBackCard) : null;
  const preparedCast = preparedBackProfile && preparedBackProfile.cost && preparedBackProfile.effects.length === 1
    ? {
        cost: preparedBackProfile.cost,
        effect: preparedBackProfile.effects[0]!,
        targetKind: preparedBackProfile.targetKind,
        spellName: preparedBackCard!.name,
        spellTypeLine: preparedBackCard!.type_line
      }
    : null;

  const profile: CardProfile = {
    name: card.name,
    typeLine: card.type_line,
    types,
    supertypes,
    subtypes,
    cost,
    manaValue: cost?.manaValue ?? Math.round(card.cmc ?? 0),
    cantBeCountered,
    uncounterableCreaturePowerThreshold: uncounterableCreaturePowerMatch ? Number(uncounterableCreaturePowerMatch[1]) : null,
    colors: [...(face.colors ?? card.colors ?? [])],
    colorIdentity: [...(card.color_identity ?? [])],
    keywords,
    grantsCreatureActivationHaste,
    changeling,
    power: numeric(face.power),
    toughness: numeric(face.toughness),
    loyalty: numeric(face.loyalty),
    manaAbilities,
    cyclingCost,
    cyclingSearches,
    echoCost: recognized.echoCost ?? null,
    flashbackLifeCost,
    additionalLifeCost,
    additionalLifeCostVariable,
    equipCost,
    typedEquipCost,
    equipWorthyCost,
    equipmentModification,
    auraModification,
    auraLandManaBonus,
    auraControlTarget,
    auraActivatedAbility,
    staticKeywordGrants,
    staticManaAbilityGrants,
    keywordsDuringYourTurn,
    untapColorsDuringOtherPlayersUntap,
    triggerDoublers,
    preventsLifeGain,
    noMaximumHandSize,
    noMaximumHandSizeForAllPlayers,
    locksOpponentsOnYourTurn,
    grantsExtortToOthers,
    attackersAssignAsUnblockedWhileAttacking,
    preventsOpponentLoss,
    forcesAllCreaturesToAttack,
    damageAmplify,
   staticPowerToughnessGrants,
    copiesImprintedCreatureStats,
    doublesLandMana,
    levelUpCost,
    levelDefinitions,
    classLevels,
    protectionFrom,
    activatedAbilities: isPermanent || recognized.activatedAbilities.some((ability) => ability.sourceZone === "hand")
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
          }] : []),
          ...classLevels.map((entry, index) => ({
            index: recognized.activatedAbilities.length + (levelUpCost ? 1 : 0) + index,
            requiresTap: false,
            sacrificesSelf: false,
            lifeCost: 0,
            manaCost: entry.cost,
            effect: { kind: "class-level-up" as const, to: entry.level },
            targetKind: "none" as const,
            sorcerySpeed: true,
            requiresClassLevel: entry.level - 1,
            text: `${entry.cost.raw}: Level ${entry.level}`
          }))
        ]
      : [],
    modalChoices: recognized.modalChoices,
    effects: recognized.effects,
    triggers: [...gatedTriggers, ...synthesizedTriggers],
    targetKind: recognized.targetKind,
    ...(recognized.targetKinds?.length ? { targetKinds: recognized.targetKinds } : {}),
    kickerCost: recognized.kickerCost ?? null,
    entwineCost: recognized.entwineCost ?? null,
    graftAmount,
    evokeCost: recognized.evokeCost ?? null,
    miracleCost: recognized.miracleCost ?? null,
    preparedCast,
    entersPrepared,
    extraLandDropsPerTurn,
    playLandsFromTopOfLibrary,
    revealsTopOfLibrary,
    flashbackCost,
    kickedEffects: recognized.kickedEffects ?? [],
    kickedKeywords: recognized.kickedKeywords ?? [],
    kickedEntersWithCounters: recognized.kickedEntersWithCounters ?? [],
    additionalCostExileGraveyardX,
    hasRebound,
    additionalCostSacrificeLand,
    additionalCostSacrificeCreature,
    additionalCostSacrificeCreatureColor,
    freeCastIfCommander,
    payLifeInsteadOfManaCost,
    returnLandInsteadOfManaCost,
    payReducedCostInstead,
    giftDrawsCard,
    giftPromisedTargetKind,
    attackTaxPerCreature,
    doublesEquippedCreatureDamage,
    redirectsOpponentDrawsExceptFirst,
    costReducesPerBoardCreature,
    affinityFor,
    spellCostReductionGrant,
    staticLandManaBonus,
    cdaPowerToughness,
    lieutenant,
    combatRules,
    entersTapped: types.includes("Land") ? parseEntersTapped(text, face.type_line) : { kind: "untapped" },
    doesNotUntapDuringUntap,
    entersWithCounters: isPermanent
      ? (() => {
          const counters = parseEntersWithCounters(text);
          if (graftAmount === null) return counters;
          const existing = counters.find((counter) => counter.kind === "+1/+1");
          return existing
            ? counters.map((counter) => counter.kind === "+1/+1" ? { ...counter, amount: counter.amount + graftAmount } : counter)
            : [...counters, { kind: "+1/+1", amount: graftAmount }];
        })()
      : [],
    entersWithVariableCounters: isPermanent ? parseEntersWithVariableCounters(text) : null,
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
export function isArtifact(profile: CardProfile): boolean { return profile.types.includes("Artifact"); }
export function isEnchantment(profile: CardProfile): boolean { return profile.types.includes("Enchantment"); }
export function hasKeyword(profile: CardProfile, keyword: EnforcedKeyword): boolean { return profile.keywords.includes(keyword); }
/** CR 702.73a: a changeling creature has every creature type in every zone. */
export function hasSubtype(profile: CardProfile, subtype: string): boolean {
  return profile.subtypes.some((candidate) => candidate.toLowerCase() === subtype.toLowerCase())
    || (profile.changeling && isCreature(profile));
}
