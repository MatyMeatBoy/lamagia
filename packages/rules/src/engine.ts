/**
 * Authoritative Commander engine.
 *
 * The whole game is a pure function of (state, seat, action). Every mutation
 * goes through `applyAction`, every legal move comes from `legalActions`, and
 * `settle` drives all turn-based actions, state-based actions and automatic
 * priority passes so a table can never stall on a step nobody can act in.
 *
 * Scope is deliberately explicit: zones, priority, the stack, mana (all colors,
 * hybrid and Phyrexian), casting, commander tax/damage, combat with the enforced
 * keyword set, state-based actions and win conditions. Card text beyond the
 * templates in `characteristics.ts` is not executed and is reported as such.
 */

import {
  cardProfile, hasSubtype, isArtifact, isCreature, isEnchantment, isLand, TRIGGER_EVENT_LABELS, type ActivatedAbility, type CardData, type CardProfile, type CardType, type CounterCost, type EnforcedKeyword, type ManaAbility, type SpellEffect, type TargetKind, type TriggerDefinition, type TriggerEvent
} from "./characteristics.js";
import {
  addMana, emptyPool, payCost, poolTotal, type ManaCost, type ManaPool, type ManaType
} from "./mana.js";

export type SeatId = number;

export type TurnStep =
  | "untap" | "upkeep" | "draw" | "precombat-main" | "begin-combat"
  | "declare-attackers" | "declare-blockers" | "combat-damage" | "end-combat"
  | "postcombat-main" | "end" | "cleanup";

export const TURN_STEPS: readonly TurnStep[] = [
  "untap", "upkeep", "draw", "precombat-main", "begin-combat", "declare-attackers",
  "declare-blockers", "combat-damage", "end-combat", "postcombat-main", "end", "cleanup"
];

/** Steps in which no player receives priority (rules 502.1 and 514.3). */
const NO_PRIORITY_STEPS: readonly TurnStep[] = ["untap", "cleanup"];
const MAIN_STEPS: readonly TurnStep[] = ["precombat-main", "postcombat-main"];

export const STEP_LABELS: Readonly<Record<TurnStep, string>> = {
  untap: "Enderezar", upkeep: "Mantenimiento", draw: "Robo",
  "precombat-main": "Principal 1", "begin-combat": "Inicio de combate",
  "declare-attackers": "Declarar atacantes", "declare-blockers": "Declarar bloqueadores",
  "combat-damage": "Daño de combate", "end-combat": "Fin de combate",
  "postcombat-main": "Principal 2", end: "Paso final", cleanup: "Limpieza"
};

function matchesSacrificeType(permanent: Permanent, type: "Artifact" | "Enchantment" | "Land" | "Noncreature" | "Token" | "Permanent"): boolean {
  const profile = cardProfile(permanent.card);
  if (type === "Artifact") return isArtifact(profile);
  if (type === "Enchantment") return isEnchantment(profile);
  if (type === "Noncreature") return profile.isPermanent && !isCreature(profile);
  if (type === "Token") return Boolean(permanent.card.token);
  if (type === "Permanent") return profile.isPermanent;
  return isLand(profile);
}

export interface GameCard extends CardData {
  readonly instance_id: string;
  readonly owner: SeatId;
  readonly token?: boolean;
}

export interface Permanent {
  readonly instance_id: string;
  readonly card: GameCard;
  readonly controller: SeatId;
  readonly tapped: boolean;
  /** A creature cannot attack or use `{T}` abilities the turn it arrives (rule 302.6). */
  readonly summoningSick: boolean;
  readonly damage: number;
  readonly deathtouched: boolean;
  /** Public counters on this permanent, by normalized counter name. */
  readonly counters: Readonly<Record<string, number>>;
  /** The spell that became this permanent was kicked (CR 702.33e). */
  readonly kicked?: boolean;
  readonly evoked?: boolean;
  /** A loyalty ability was activated on this planeswalker this turn (CR 606.3). */
  readonly loyaltyUsedThisTurn?: boolean;
  /** "Target creature can't block this turn"; cleared during cleanup. */
  readonly cantBlockThisTurn?: boolean;
  /** Layer 7c modifications that expire in the cleanup step. */
  readonly powerModifier: number;
  readonly toughnessModifier: number;
  /** Keyword effects from spells/abilities that expire during cleanup. */
  readonly temporaryKeywords?: readonly EnforcedKeyword[];
  /** One-shot destruction-replacement shields created by Regenerate (CR 701.19). */
  readonly regenerationShields?: number;
  /** The creature this Equipment is attached to, when it is equipped. */
  readonly attachedTo?: string;
  /** The last card exiled by an imprint ability, if any. */
  readonly exiledWith?: GameCard;
  readonly isCommander: boolean;
}

export interface CommanderIdentity {
  readonly cardId: string;
  readonly name: string;
  readonly image_normal?: string;
  readonly image_art_crop?: string;
}

export interface PlayerState {
  readonly seat: SeatId;
  readonly id: string;
  readonly name: string;
  readonly deckName: string;
  readonly kind: "human" | "bot";
  readonly life: number;
  readonly library: readonly GameCard[];
  readonly hand: readonly GameCard[];
  readonly battlefield: readonly Permanent[];
  readonly graveyard: readonly GameCard[];
  readonly exile: readonly GameCard[];
  readonly commandZone: readonly GameCard[];
  /** Union of the declared commanders' color identities (CR 903.4). */
  readonly commanderColorIdentity: readonly string[];
  readonly commanderIds: readonly string[];
  /** Commander tax counter: `{2}` more for each previous cast from the command zone. */
  readonly commanderCasts: Readonly<Record<string, number>>;
  /** Combat damage received from each opposing commander, keyed by commander instance id. */
  readonly commanderDamage: Readonly<Record<string, number>>;
  readonly landsPlayedThisTurn: number;
  readonly manaPool: ManaPool;
  readonly lost: boolean;
  readonly lossReason?: string;
  readonly drewFromEmptyLibrary: boolean;
  /** Skip priority automatically in windows where this seat has nothing to do. */
  readonly autoPass: boolean;
}

export type Target =
  | { readonly kind: "player"; readonly seat: SeatId }
  | { readonly kind: "permanent"; readonly instanceId: string }
  | { readonly kind: "graveyard-card"; readonly seat: SeatId; readonly instanceId: string }
  | { readonly kind: "spell"; readonly stackId: string };

export interface StackObject {
  readonly id: string;
  readonly controller: SeatId;
  readonly card: GameCard;
  readonly label: string;
  readonly targets: readonly Target[];
  readonly fromCommandZone: boolean;
  /** The spell was cast from a graveyard using Flashback (CR 702.34). */
  readonly flashback?: boolean;
  readonly variableValue: number;
  readonly countered: boolean;
  /** Seat that countered this spell with a replacement-to-battlefield effect. */
  readonly counteredToBattlefieldController?: SeatId;
  /** The spell was cast for its kicker cost (CR 702.33). */
  readonly kicked?: boolean;
  readonly evoked?: boolean;
  /** Selected `Choose one` mode, when the spell has supported modal text. */
  readonly selectedEffect?: SpellEffect;
  /** Present when this is a triggered ability rather than a spell. */
  readonly trigger?: TriggerInstance;
  /** Present when this is a non-mana activated ability rather than a spell. */
  readonly activated?: ActivatedAbility;
  /** Permanent source for activated abilities; unlike card identity, this is an in-play instance. */
  readonly sourcePermanentId?: string;
}

export interface TriggerInstance {
  readonly id: string;
  readonly controller: SeatId;
  readonly sourcePermanentId: string;
  readonly sourceCard: GameCard;
  readonly definition: TriggerDefinition;
  /** What raised it, for the log and for the client's stack strip. */
  readonly cause: string;
  /** Player whose action raised the event, used by payment clauses such as Rhystic Study. */
  readonly eventController?: SeatId;
  /** Permanent involved in the event, used by effects referring to "that creature". */
  readonly eventPermanentId?: string;
}

/** A delayed trigger created by a resolving spell (CR 603.7). */
export interface DelayedDraw {
  readonly id: string;
  readonly triggerAtTurn: number;
  readonly seat: SeatId;
  readonly sourceCard: GameCard;
  readonly amount: number;
  readonly optional: boolean;
  readonly sourceText: string;
}

/**
 * One thing that happened in the game.
 *
 * Events are raised at the moment the rules say they happen; triggered
 * abilities that match are queued and only reach the stack the next time a
 * player would receive priority (CR 603.3).
 */
export type GameEvent =
  | { readonly kind: "enters-battlefield"; readonly permanentId: string; readonly controller: SeatId; readonly card: GameCard }
  | { readonly kind: "leaves-battlefield"; readonly permanentId: string; readonly controller: SeatId; readonly card: GameCard }
  | { readonly kind: "dies"; readonly permanentId: string; readonly controller: SeatId; readonly card: GameCard }
  | { readonly kind: "attacks"; readonly permanentId: string; readonly controller: SeatId; readonly card: GameCard; readonly defender: SeatId }
  | { readonly kind: "blocks"; readonly permanentId: string; readonly controller: SeatId; readonly card: GameCard }
  | { readonly kind: "deals-combat-damage-to-player"; readonly permanentId: string; readonly controller: SeatId; readonly card: GameCard; readonly victim: SeatId }
  | { readonly kind: "becomes-tapped"; readonly permanentId: string; readonly controller: SeatId; readonly card: GameCard }
  | { readonly kind: "spell-cast"; readonly controller: SeatId; readonly card: GameCard }
  | { readonly kind: "card-cycled"; readonly controller: SeatId; readonly card: GameCard }
  | { readonly kind: "card-drawn"; readonly seat: SeatId; readonly card: GameCard }
  | { readonly kind: "upkeep" | "draw-step" | "end-step"; readonly activeSeat: SeatId }
  | { readonly kind: "life-gained" | "life-lost"; readonly seat: SeatId; readonly amount: number };

export interface AttackerDeclaration { readonly instanceId: string; readonly defender: SeatId }
export interface BlockerDeclaration { readonly instanceId: string; readonly attackerId: string }

export interface CombatState {
  readonly attackers: readonly AttackerDeclaration[];
  readonly blockers: readonly BlockerDeclaration[];
  readonly attackersDeclared: boolean;
  readonly blockersDeclared: boolean;
  readonly firstStrikeResolved: boolean;
  readonly damageResolved: boolean;
}

export interface LogEntry {
  readonly turn: number;
  readonly step: TurnStep;
  readonly seat: SeatId | null;
  readonly text: string;
}

export interface GameState {
  readonly players: readonly PlayerState[];
  readonly turn: number;
  readonly activeSeat: SeatId;
  readonly prioritySeat: SeatId;
  readonly step: TurnStep;
  readonly priorityOpen: boolean;
  readonly passedSeats: readonly SeatId[];
  readonly stack: readonly StackObject[];
  /** Triggered abilities waiting to be put onto the stack. */
  readonly triggerQueue: readonly TriggerInstance[];
  /** Delayed draw triggers waiting for their next upkeep. */
  readonly delayedDraws: readonly DelayedDraw[];
  readonly combat: CombatState;
  readonly log: readonly LogEntry[];
  readonly winnerSeat: SeatId | null;
  readonly finished: boolean;
  readonly seed: number;
  readonly rngState: number;
  readonly version: number;
  readonly startingSeat: SeatId;
  /** A replacement-effect choice that must be completed before priority resumes. */
  readonly pendingChoice: PendingChoice | null;
}

export type PendingChoice =
  | {
      readonly type: "reveal-card";
      readonly seat: SeatId;
      readonly sourceId: string;
      readonly stage: "confirm" | "card";
      readonly optionIds: readonly string[];
    }
  | {
      readonly type: "optional-trigger";
      readonly seat: SeatId;
      readonly sourceId: string;
      readonly triggerEffect: SpellEffect;
      readonly sourceCard: GameCard;
      /** Mana cost that must be paid to accept ("you may pay {cost}. If you do"). */
      readonly payCost?: ManaCost;
      readonly manaCost?: ManaCost;
      readonly targets?: readonly Target[];
      readonly sourcePermanentId?: string;
      readonly sourceController?: SeatId;
      readonly paymentBy?: "opponent";
      readonly unlessPayCost?: ManaCost;
    }
  | {
      /**
       * A triggered ability needs a target. Targets are chosen as the ability
       * is put onto the stack (CR 603.3d), before anyone receives priority.
       */
      readonly type: "trigger-target";
      readonly seat: SeatId;
      readonly sourceId: string;
      readonly trigger: TriggerInstance;
      readonly targetKind: Exclude<TargetKind, "none">;
      readonly options: readonly Target[];
    }
  | {
      readonly type: "search-library";
      readonly seat: SeatId;
      readonly sourceId: string;
      readonly optionIds: readonly string[];
      readonly sourceCard: GameCard;
      readonly search: Extract<SpellEffect, { kind: "search-library" }>;
      /** Spells move to the graveyard after resolving; activated sources already paid their costs. */
      readonly returnSourceToGraveyard: boolean;
      /** Flashback replaces that destination with exile when the search choice finishes. */
      readonly exileSourceAfterResolution: boolean;
    }
  | {
      readonly type: "search-library-multi";
      readonly seat: SeatId;
      readonly sourceId: string;
      readonly optionIds: readonly string[];
      readonly selectedIds: readonly string[];
      readonly sourceCard: GameCard;
      readonly search: Extract<SpellEffect, { kind: "search-library-multi" }>;
      readonly returnSourceToGraveyard: boolean;
      readonly exileSourceAfterResolution: boolean;
    }
  | {
      readonly type: "discard-cards";
      readonly seat: SeatId;
      readonly sourceId: string;
      readonly sourceCard: GameCard;
      readonly amount: number;
      readonly remaining: number;
    }
  | {
      /** Scry (CR 701.17): inspect the top N cards and order each to top or bottom. */
      readonly type: "scry";
      readonly seat: SeatId;
      readonly sourceId: string;
      readonly sourceCard: GameCard;
      readonly remainingCards: readonly GameCard[];
      readonly topCards: readonly GameCard[];
      readonly bottomCards: readonly GameCard[];
      /** Cards drawn after all Scry decisions, for "Scry N, then draw M". */
      readonly thenDraw: number;
      readonly returnSourceToGraveyard: boolean;
      readonly exileSourceAfterResolution: boolean;
    }
  | {
      readonly type: "discard-cards";
      readonly seat: SeatId;
      readonly sourceId: string;
      readonly sourceCard: GameCard;
      readonly amount: number;
      readonly remaining: number;
    }
  | {
      readonly type: "draw-cards";
      readonly seat: SeatId;
      readonly sourceId: string;
      readonly sourceCard: GameCard;
      readonly maxAmount: number;
    };

export type GameAction =
  | { readonly type: "pass" }
  | { readonly type: "play-land"; readonly cardId: string }
  | { readonly type: "cast"; readonly cardId: string; readonly targets?: readonly Target[]; readonly variableValue?: number; readonly mode?: number; readonly kicked?: boolean; readonly evoked?: boolean; readonly fromGraveyard?: boolean }
  | { readonly type: "cycle"; readonly cardId: string; readonly cyclingIndex?: number }
  | { readonly type: "equip"; readonly sourceId: string; readonly targetId?: string }
  | { readonly type: "activate-mana"; readonly sourceId: string; readonly abilityIndex: number; readonly mana: ManaType; readonly manaBonus?: ManaType; readonly variableAmount?: number; readonly manaChoices?: readonly ManaType[] }
  | { readonly type: "activate"; readonly sourceId: string; readonly abilityIndex: number; readonly targets?: readonly Target[]; readonly sacrificeId?: string; readonly tapId?: string; readonly discardCardId?: string; readonly exileCardId?: string }
  | { readonly type: "choose-reveal"; readonly sourceId: string; readonly reveal: boolean; readonly cardId?: string }
  | { readonly type: "choose-trigger"; readonly sourceId: string; readonly accept: boolean }
  | { readonly type: "choose-trigger-target"; readonly sourceId: string; readonly target: Target }
  /** The query is a player intent; the library instance id never leaves the server. */
  | { readonly type: "choose-library-card"; readonly sourceId: string; readonly query: string }
  | { readonly type: "finish-library-search"; readonly sourceId: string }
  | { readonly type: "choose-scry"; readonly sourceId: string; readonly query: string; readonly bottom: boolean; readonly ordinal?: number }
  | { readonly type: "choose-draw"; readonly sourceId: string; readonly amount: number }
  | { readonly type: "choose-discard"; readonly sourceId: string; readonly cardId: string }
  | { readonly type: "declare-attackers"; readonly attackers: readonly AttackerDeclaration[] }
  | { readonly type: "declare-blockers"; readonly blockers: readonly BlockerDeclaration[] }
  | { readonly type: "concede" };

/** A legal action plus the presentation metadata the client needs to offer it. */
export interface LegalAction {
  readonly action: GameAction;
  readonly label: string;
  readonly cardId?: string;
  readonly requiresTarget?: Exclude<TargetKind, "none">;
  readonly manaValue?: number;
  readonly note?: string;
}

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

function nextRandom(state: number): { value: number; state: number } {
  const advanced = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return { value: advanced / 0x1_0000_0000, state: advanced };
}

function shuffle<T>(items: readonly T[], seedState: number): { items: T[]; state: number } {
  const result = [...items];
  let current = seedState;
  for (let index = result.length - 1; index > 0; index -= 1) {
    const rolled = nextRandom(current);
    current = rolled.state;
    const swap = Math.floor(rolled.value * (index + 1));
    [result[index], result[swap]] = [result[swap]!, result[index]!];
  }
  return { items: result, state: current };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function profileOf(card: CardData): CardProfile { return cardProfile(card); }

function playerAt(state: GameState, seat: SeatId): PlayerState {
  const player = state.players[seat];
  if (!player) throw new Error(`No existe el asiento ${seat}.`);
  return player;
}

function withPlayer(state: GameState, seat: SeatId, update: (player: PlayerState) => PlayerState): GameState {
  return { ...state, players: state.players.map((player, index) => (index === seat ? update(player) : player)) };
}

function logged(state: GameState, seat: SeatId | null, text: string): GameState {
  const entry: LogEntry = { turn: state.turn, step: state.step, seat, text };
  return { ...state, log: [...state.log, entry].slice(-400) };
}

function livingSeats(state: GameState): SeatId[] {
  return state.players.filter((player) => !player.lost).map((player) => player.seat);
}

function nextLivingSeat(state: GameState, seat: SeatId): SeatId {
  const total = state.players.length;
  for (let step = 1; step <= total; step += 1) {
    const candidate = (seat + step) % total;
    if (!state.players[candidate]!.lost) return candidate;
  }
  return seat;
}

function allPermanents(state: GameState): Permanent[] {
  return state.players.flatMap((player) => player.battlefield);
}

function findPermanent(state: GameState, instanceId: string): Permanent | null {
  return allPermanents(state).find((permanent) => permanent.instance_id === instanceId) ?? null;
}

function counterModifier(permanent: Permanent): number {
  return (permanent.counters["+1/+1"] ?? 0) - (permanent.counters["-1/-1"] ?? 0);
}
function attachedEquipment(state: GameState, creature: Permanent): Permanent[] {
  return allPermanents(state).filter((candidate) => candidate.attachedTo === creature.instance_id
    && cardProfile(candidate.card).subtypes.some((subtype) => subtype.toLowerCase() === "equipment"));
}
function equipmentBonus(state: GameState | undefined, creature: Permanent): { power: number; toughness: number } {
  if (!state) return { power: 0, toughness: 0 };
  return attachedEquipment(state, creature).reduce((total, equipment) => {
    const modification = cardProfile(equipment.card).equipmentModification;
    return modification
      ? { power: total.power + modification.power, toughness: total.toughness + modification.toughness }
      : total;
  }, { power: 0, toughness: 0 });
}
function staticPowerToughnessBonus(state: GameState, permanent: Permanent): { power: number; toughness: number } {
  return allPermanents(state)
    .filter((source) => source.controller === permanent.controller)
    .flatMap((source) => cardProfile(source.card).staticPowerToughnessGrants
      .filter((grant) => grant.scope === "creatures-you-control"
        || (grant.scope === "other-creatures-you-control" && source.instance_id !== permanent.instance_id))
      .map((grant) => ({ source, grant })))
    .filter(({ grant }) => !grant.color || cardProfile(permanent.card).colors.some((color) => color.toUpperCase() === grant.color))
    .reduce((total, { grant }) => ({ power: total.power + grant.power, toughness: total.toughness + grant.toughness }), { power: 0, toughness: 0 });
}
export function powerOf(permanent: Permanent, state?: GameState): number {
  const profile = cardProfile(permanent.card);
  const level = state ? profile.levelDefinitions.filter((definition) => {
    const count = permanent.counters.level ?? 0;
    return count >= definition.minLevel && (definition.maxLevel === undefined || count <= definition.maxLevel);
  }).at(-1) : undefined;
  const staticBonus = state ? staticPowerToughnessBonus(state, permanent).power : 0;
  const globalBonus = state ? allPermanents(state).flatMap((source) => cardProfile(source.card).staticPowerToughnessGrants)
    .filter((grant) => grant.scope === "all-creatures").reduce((total, grant) => total + grant.power, 0) : 0;
  const imprint = permanent.exiledWith && isCreature(cardProfile(permanent.exiledWith)) ? cardProfile(permanent.exiledWith) : undefined;
  return (imprint?.power ?? level?.power ?? profile.power ?? 0) + counterModifier(permanent) + permanent.powerModifier + equipmentBonus(state, permanent).power + staticBonus + globalBonus;
}
export function toughnessOf(permanent: Permanent, state?: GameState): number {
  const profile = cardProfile(permanent.card);
  const level = state ? profile.levelDefinitions.filter((definition) => {
    const count = permanent.counters.level ?? 0;
    return count >= definition.minLevel && (definition.maxLevel === undefined || count <= definition.maxLevel);
  }).at(-1) : undefined;
  const staticBonus = state ? staticPowerToughnessBonus(state, permanent).toughness : 0;
  const globalBonus = state ? allPermanents(state).flatMap((source) => cardProfile(source.card).staticPowerToughnessGrants)
    .filter((grant) => grant.scope === "all-creatures").reduce((total, grant) => total + grant.toughness, 0) : 0;
  const imprint = permanent.exiledWith && isCreature(cardProfile(permanent.exiledWith)) ? cardProfile(permanent.exiledWith) : undefined;
  return (imprint?.toughness ?? level?.toughness ?? profile.toughness ?? 0) + counterModifier(permanent) + permanent.toughnessModifier + equipmentBonus(state, permanent).toughness + staticBonus + globalBonus;
}
function keywordOf(state: GameState, permanent: Permanent, keyword: EnforcedKeyword): boolean {
  const profile = cardProfile(permanent.card);
  if (profile.keywords.includes(keyword)) return true;
  const level = profile.levelDefinitions.filter((definition) => {
    const count = permanent.counters.level ?? 0;
    return count >= definition.minLevel && (definition.maxLevel === undefined || count <= definition.maxLevel);
  }).at(-1);
  if (level?.keywords.includes(keyword)) return true;
  if (permanent.temporaryKeywords?.includes(keyword)) return true;
  if (isCreature(profile) && allPermanents(state).some((source) => cardProfile(source.card).staticKeywordGrants.some((grant) => grant.keyword === keyword
      && (grant.scope === "all-creatures" || (source.controller === permanent.controller
        && (grant.scope === "creatures-you-control" || (grant.scope === "other-creatures-you-control" && source.instance_id !== permanent.instance_id))))))) return true;
  return attachedEquipment(state, permanent).some((equipment) => cardProfile(equipment.card).equipmentModification?.keywords.includes(keyword));
}

// ---------------------------------------------------------------------------
// Mana sources and automatic payment
// ---------------------------------------------------------------------------

export interface ManaSource {
  readonly permanentId: string;
  readonly abilityIndex: number;
  readonly name: string;
  readonly options: readonly ManaType[];
  readonly amount: number;
  readonly fixedProduces?: readonly ManaType[];
  /** Extra type choice from a controlled static mana replacement effect. */
  readonly bonusOptions?: readonly ManaType[];
  readonly lifeCost: number;
  readonly requiresTap: boolean;
  readonly removeCounters?: readonly CounterCost[];
}

/** Rule 302.6 applies to a creature's own tap ability, including Llanowar Elves. */
function splitSecondActive(state: GameState): boolean {
  const top = state.stack.at(-1);
  return Boolean(top && cardProfile(top.card).keywords.includes("split second"));
}

function canUseManaAbility(player: PlayerState, permanent: Permanent, ability: ManaAbility, state?: GameState): boolean {
  if (ability.requiresTap && permanent.tapped) return false;
  if (ability.requiresTap && permanent.summoningSick && isCreature(cardProfile(permanent.card))) return false;
  if (ability.lifeCost >= player.life) return false;
  if (ability.requiresLands !== undefined && player.battlefield.filter((candidate) => isLand(cardProfile(candidate.card))).length < ability.requiresLands) return false;
  if (!(ability.removeCounters ?? []).every((cost) => (permanent.counters[cost.kind] ?? 0) >= cost.amount)) return false;
  if (ability.variableAmountCounter && (permanent.counters[ability.variableAmountCounter] ?? 0) < 1) return false;
  if (ability.manaCost && !planManaPayment(ability.manaCost, player, { state })) return false;
  return true;
}

function manaOptionsFor(player: PlayerState, ability: ManaAbility): readonly ManaType[] {
  return ability.commanderIdentity
    ? ability.produces.filter((mana) => player.commanderColorIdentity.includes(mana))
    : ability.produces;
}

/** All distributions of N mana across the colours offered by a storage ability. */
function manaChoiceVectors(options: readonly ManaType[], amount: number): readonly (readonly ManaType[])[] {
  if (amount < 1 || !options.length) return [];
  const result: ManaType[][] = [];
  const build = (index: number, remaining: number, chosen: ManaType[]) => {
    if (index === options.length - 1) {
      result.push([...chosen, ...Array.from({ length: remaining }, () => options[index]!)]);
      return;
    }
    for (let count = 0; count <= remaining; count += 1) {
      build(index + 1, remaining - count, [...chosen, ...Array.from({ length: count }, () => options[index]!)])
    }
  };
  build(0, amount, []);
  return result;
}

/** Untapped permanents this player can currently tap for mana. */
export function manaSources(player: PlayerState, state?: GameState): ManaSource[] {
  const sources: ManaSource[] = [];
  const landBonuses = player.battlefield
    .map((permanent) => cardProfile(permanent.card).staticLandManaBonus)
    .filter((bonus): bonus is { subtype: string; mana: string } => Boolean(bonus));
  const doublesLandMana = state ? allPermanents(state).some((permanent) => permanent.controller === player.seat
    && cardProfile(permanent.card).doublesLandMana) : false;
  for (const permanent of player.battlefield) {
    const profile = cardProfile(permanent.card);
    for (const ability of profile.manaAbilities) {
      // Variable storage output is chosen as a single activation and cannot
      // be used as an automatic source while paying another cost.
      if (ability.variableAmountCounter) continue;
      if (!canUseManaAbility(player, permanent, ability)) continue;
      const options = manaOptionsFor(player, ability);
      if (!options.length) continue;
      // "<Basic type>s you control produce an additional {C}" (Crypt Ghast):
      // a matching land's ability produces one extra of the granted colour.
      const bonus = landBonuses.find((entry) =>
        isLand(profile) && hasSubtype(profile, entry.subtype)
        && (options as readonly string[]).includes(entry.mana));
      sources.push({
        permanentId: permanent.instance_id,
        abilityIndex: ability.index,
        name: permanent.card.name,
        options,
        amount: ability.amount + (bonus ? 1 : 0),
        ...(ability.fixedProduces ? { fixedProduces: ability.fixedProduces } : {}),
        ...(doublesLandMana && isLand(profile) ? { bonusOptions: options } : {}),
        ...(ability.removeCounters ? { removeCounters: ability.removeCounters } : {}),
        lifeCost: ability.lifeCost,
        requiresTap: ability.requiresTap
      });
    }
  }
  return sources;
}

/** At most one mana ability on a permanent can be used for one payment. */
function manaSourceCapacity(sources: readonly ManaSource[]): number {
  const byPermanent = new Map<string, number>();
  for (const source of sources) {
    byPermanent.set(source.permanentId, Math.max(byPermanent.get(source.permanentId) ?? 0, source.amount + (source.bonusOptions?.length ? 1 : 0)));
  }
  return [...byPermanent.values()].reduce((total, amount) => total + amount, 0);
}

/** Maximum mana currently available from untapped sources, excluding the pool. */
export function manaSourcePotential(player: PlayerState): number {
  return manaSourceCapacity(manaSources(player));
}

export interface ManaPlan {
  readonly taps: readonly { readonly permanentId: string; readonly abilityIndex: number; readonly type: ManaType; readonly amount: number; readonly lifeCost: number; readonly requiresTap: boolean; readonly bonusType?: ManaType; readonly removeCounters?: readonly CounterCost[] }[];
  readonly pool: ManaPool;
  readonly lifeCost: number;
}

/** Upper bound on mana available, used for quick "can I afford anything?" filtering. */
export function potentialMana(player: PlayerState): number {
  return manaSourcePotential(player) + poolTotal(player.manaPool);
}

type Tap = ManaPlan["taps"][number];

/** Colored requirements a cost imposes; each entry lists the types that satisfy it. */
function coloredRequirements(cost: ManaCost): ManaType[][] {
  const requirements: ManaType[][] = [];
  for (const symbol of cost.symbols) {
    if (symbol.kind === "colored") requirements.push([symbol.color]);
    else if (symbol.kind === "hybrid") requirements.push([...symbol.options]);
    else if (symbol.kind === "monohybrid") requirements.push([symbol.color]);
    // Phyrexian symbols are intentionally omitted: paying life is a legal fallback
    // and `payCost` decides between mana and life during final validation.
  }
  return requirements.sort((left, right) => left.length - right.length || left.join("").localeCompare(right.join("")));
}

function sourceSignature(source: ManaSource): string {
  const counters = (source.removeCounters ?? []).map((cost) => `${cost.amount}:${cost.kind}`).join(",");
  return `${[...(source.fixedProduces ?? source.options)].sort().join("")}|${source.amount}|${[...(source.bonusOptions ?? [])].join("")}|${source.lifeCost}|${counters}`;
}

function sourceTap(source: ManaSource, type: ManaType, bonusType?: ManaType): Tap {
  return {
    permanentId: source.permanentId,
    abilityIndex: source.abilityIndex,
    type,
    amount: source.amount,
    lifeCost: source.lifeCost,
    requiresTap: source.requiresTap,
    ...(source.removeCounters ? { removeCounters: source.removeCounters } : {}),
    ...(bonusType ? { bonusType } : {})
  };
}

function addSourceOutput(pool: ManaPool, source: ManaSource, chosen: ManaType, bonusType?: ManaType): ManaPool {
  const base = !source.fixedProduces
    ? addMana(pool, chosen, source.amount)
    : source.fixedProduces.reduce((current, mana) => addMana(current, mana, 1), pool);
  return bonusType ? addMana(base, bonusType, 1) : base;
}

/**
 * Chooses which permanents to tap to pay `cost`.
 *
 * Colored requirements are satisfied first, drawing from the floating pool and
 * then from the least flexible untapped source that can produce the colour, so a
 * dual land stays free for the requirement only it can cover. Whatever remains is
 * paid by tapping further sources until `payCost` validates the whole cost.
 * Interchangeable sources share one search branch, and a node budget guarantees
 * the search terminates on very wide boards.
 */
export function planManaPayment(
  cost: ManaCost,
  player: PlayerState,
  options: { readonly variableValue?: number; readonly additionalGeneric?: number; readonly state?: GameState; readonly lifeCost?: number } = {}
): ManaPlan | null {
  const startingPool = player.manaPool;
  const sources = manaSources(player, options.state);
  const variableValue = options.variableValue ?? 0;
  const additionalGeneric = options.additionalGeneric ?? 0;
  const externalLifeCost = options.lifeCost ?? 0;
  const variableCount = cost.symbols.filter((symbol) => symbol.kind === "variable").length;
  const needed = Math.max(0, cost.manaValue + variableValue * variableCount + additionalGeneric);
  if (poolTotal(startingPool) + manaSourceCapacity(sources) < needed) return null;

  const payOptions = (lifeSpent: number) => ({ variableValue, additionalGeneric, availableLife: player.life - externalLifeCost - lifeSpent });
  const ordered = [...sources].sort((left, right) =>
    left.options.length - right.options.length ||
    left.lifeCost - right.lifeCost ||
    (right.amount + (right.bonusOptions?.length ? 1 : 0)) - (left.amount + (left.bonusOptions?.length ? 1 : 0)) ||
    left.permanentId.localeCompare(right.permanentId));
  const wanted = new Set(coloredRequirements(cost).flat());
  let budget = 40_000;

  /** Once colours are covered, tap the biggest remaining sources until the cost validates. */
  const finish = (pool: ManaPool, used: ReadonlySet<string>, taps: readonly Tap[], lifeSpent: number): ManaPlan | null => {
    let currentPool = pool;
    let currentTaps = [...taps];
    let currentLife = lifeSpent;
    const spare = ordered
      .filter((source) => !used.has(source.permanentId))
      .sort((left, right) => (right.amount + (right.bonusOptions?.length ? 1 : 0)) - (left.amount + (left.bonusOptions?.length ? 1 : 0)) || left.lifeCost - right.lifeCost || left.permanentId.localeCompare(right.permanentId));
    let index = 0;
    for (;;) {
      const payment = payCost(cost, currentPool, payOptions(currentLife));
      if (payment) return { taps: currentTaps, pool: currentPool, lifeCost: currentLife + externalLifeCost };
      if (index >= spare.length) return null;
      const source = spare[index]!;
      index += 1;
      if (player.life - externalLifeCost - currentLife - source.lifeCost <= 0) continue;
      // Prefer a colour the cost still asks for; otherwise any option works for generic.
      const type = source.options.find((candidate) => wanted.has(candidate)) ?? source.options[0]!;
      const bonusType = source.bonusOptions?.find((candidate) => wanted.has(candidate)) ?? source.bonusOptions?.[0];
      currentPool = addSourceOutput(currentPool, source, type, bonusType);
      currentTaps = [...currentTaps, sourceTap(source, type, bonusType)];
      currentLife += source.lifeCost;
    }
  };

  const requirements = coloredRequirements(cost);

  /**
   * `produced` is every mana the chosen taps make available; `reserved` only
   * records which of it a coloured requirement has already claimed, so the same
   * mana is never counted twice. Final accounting is always done by `payCost`
   * against `produced`.
   */
  const solve = (index: number, produced: ManaPool, reserved: ManaPool, used: ReadonlySet<string>, taps: readonly Tap[], lifeSpent: number): ManaPlan | null => {
    if (budget-- <= 0) return null;
    if (index === requirements.length) return finish(produced, used, taps, lifeSpent);
    const requirement = requirements[index]!;

    for (const type of requirement) {
      if (produced[type] - reserved[type] <= 0) continue;
      const result = solve(index + 1, produced, { ...reserved, [type]: reserved[type] + 1 }, used, taps, lifeSpent);
      if (result) return result;
    }

    const tried = new Set<string>();
    for (const source of ordered) {
      if (used.has(source.permanentId)) continue;
      const signature = sourceSignature(source);
      if (tried.has(signature)) continue; // Interchangeable sources share one branch.
      tried.add(signature);
      if (player.life - externalLifeCost - lifeSpent - source.lifeCost <= 0) continue;
      for (const type of requirement) {
        if (!source.options.includes(type)) continue;
        for (const bonusType of source.bonusOptions ?? [undefined]) {
          const result = solve(
            index + 1,
            addSourceOutput(produced, source, type, bonusType),
            { ...reserved, [type]: reserved[type] + 1 },
            new Set([...used, source.permanentId]),
            [...taps, sourceTap(source, type, bonusType)],
            lifeSpent + source.lifeCost
          );
          if (result) return result;
        }
      }
    }
    return null;
  };

  return solve(0, { ...startingPool }, emptyPool(), new Set(), [], 0);
}

function applyManaPlan(state: GameState, seat: SeatId, plan: ManaPlan): GameState {
  const tapped = new Set(plan.taps.filter((tap) => tap.requiresTap).map((tap) => tap.permanentId));
  const next = withPlayer(state, seat, (player) => ({
    ...player,
    life: player.life - plan.lifeCost,
    battlefield: player.battlefield.map((permanent) => {
      const tap = plan.taps.find((candidate) => candidate.permanentId === permanent.instance_id);
      if (!tap) return permanent;
      const counters = { ...permanent.counters };
      for (const cost of tap.removeCounters ?? []) counters[cost.kind] = (counters[cost.kind] ?? 0) - cost.amount;
      return { ...permanent, ...(tap.requiresTap ? { tapped: true } : {}), counters };
    }),
    manaPool: plan.pool
  }));
  return raiseTapEvents(next, state, tapped);
}

// ---------------------------------------------------------------------------
// Game creation
// ---------------------------------------------------------------------------

export interface DeckInput {
  readonly id: string;
  readonly name: string;
  readonly playerName?: string;
  readonly kind?: "human" | "bot";
  /** Names of the declared commander(s); they must be present in `cards`. */
  readonly commanderNames: readonly string[];
  readonly cards: readonly CardData[];
}

export interface GameOptions {
  readonly seed?: number;
  readonly startingLife?: number;
  readonly openingHand?: number;
  /** Relaxes the exact-100 deck check for focused tests. */
  readonly allowPartialDecks?: boolean;
}

export function createGame(decks: readonly DeckInput[], options: GameOptions = {}): GameState {
  if (decks.length < 2 || decks.length > 8) throw new Error("Una partida de Commander necesita entre 2 y 8 jugadores.");
  const seed = options.seed ?? 1;
  const startingLife = options.startingLife ?? 40;
  const openingHand = options.openingHand ?? 7;
  let rngState = seed >>> 0;

  const players: PlayerState[] = decks.map((deck, seat) => {
    if (!options.allowPartialDecks && deck.cards.length !== 100) {
      throw new Error(`${deck.name} debe tener exactamente 100 cartas (tiene ${deck.cards.length}).`);
    }
    const instances: GameCard[] = deck.cards.map((card, index) => ({ ...card, instance_id: `${deck.id}#${index}`, owner: seat }));
    const commanders: GameCard[] = [];
    for (const name of deck.commanderNames) {
      const found = instances.find((card) => card.name === name && !commanders.includes(card));
      if (!found) throw new Error(`${deck.name} no incluye a su comandante «${name}».`);
      commanders.push(found);
    }
    if (!commanders.length) throw new Error(`${deck.name} no declara comandante.`);
    const commanderIds = new Set(commanders.map((card) => card.instance_id));
    const shuffled = shuffle(instances.filter((card) => !commanderIds.has(card.instance_id)), rngState);
    rngState = shuffled.state;
    const library = shuffled.items;
    const hand = library.splice(0, Math.min(openingHand, library.length));
    const kind = deck.kind ?? (seat === 0 ? "human" : "bot");
    return {
      seat,
      id: deck.id,
      name: deck.playerName ?? deck.name,
      deckName: deck.name,
      kind,
      life: startingLife,
      library,
      hand,
      battlefield: [],
      graveyard: [],
      exile: [],
      commandZone: commanders,
      commanderIds: commanders.map((card) => card.instance_id),
      commanderColorIdentity: [...new Set(commanders.flatMap((card) => card.color_identity ?? []).map((color) => color.toUpperCase()))],
      commanderCasts: Object.fromEntries(commanders.map((card) => [card.instance_id, 0])),
      commanderDamage: {},
      landsPlayedThisTurn: 0,
      manaPool: emptyPool(),
      lost: false,
      drewFromEmptyLibrary: false,
      autoPass: kind === "bot"
    } satisfies PlayerState;
  });

  const base: GameState = {
    players,
    turn: 1,
    activeSeat: 0,
    prioritySeat: 0,
    step: "untap",
    priorityOpen: false,
    passedSeats: [],
    stack: [],
    triggerQueue: [],
    delayedDraws: [],
    combat: { attackers: [], blockers: [], attackersDeclared: false, blockersDeclared: false, firstStrikeResolved: false, damageResolved: false },
    log: [],
    winnerSeat: null,
    finished: false,
    seed,
    rngState,
    version: 0,
    startingSeat: 0,
    pendingChoice: null
  };
  const opened = logged(base, null, `Partida creada con ${players.length} jugadores · ${startingLife} vidas · mano inicial de ${openingHand}.`);
  return settle(opened);
}

// ---------------------------------------------------------------------------
// Zone movement
// ---------------------------------------------------------------------------

function drawCards(state: GameState, seat: SeatId, amount: number): GameState {
  let next = state;
  for (let index = 0; index < amount; index += 1) {
    const player = playerAt(next, seat);
    if (player.lost) return next;
    const card = player.library[0];
    if (!card) {
      next = withPlayer(next, seat, (current) => ({ ...current, drewFromEmptyLibrary: true }));
      next = logged(next, seat, `${player.name} intenta robar de una biblioteca vacía.`);
      return next;
    }
    next = withPlayer(next, seat, (current) => ({ ...current, library: current.library.slice(1), hand: [...current.hand, card] }));
    next = raiseEvent(next, { kind: "card-drawn", seat, card });
  }
  const player = playerAt(next, seat);
  if (amount > 0 && !player.drewFromEmptyLibrary) next = logged(next, seat, `${player.name} roba ${amount === 1 ? "una carta" : `${amount} cartas`}.`);
  return next;
}

/** Moves up to `amount` cards from the top of a library to its owner's graveyard (CR 701.13). */
function millCards(state: GameState, seat: SeatId, amount: number): GameState {
  if (amount <= 0) return state;
  const player = playerAt(state, seat);
  const milled = player.library.slice(0, amount);
  if (!milled.length) return logged(state, seat, `${player.name} no tiene cartas para moler.`);
  return withPlayer(logged(state, seat, `${player.name} muele ${milled.length} carta(s).`), seat, (current) => ({
    ...current,
    library: current.library.slice(milled.length),
    graveyard: [...current.graveyard, ...milled]
  }));
}

/** Moves a permanent off the battlefield, honouring the commander-zone replacement. */
function movePermanentToZone(state: GameState, permanent: Permanent, zone: "graveyard" | "exile"): GameState {
  const ownerSeat = permanent.card.owner;
  let next = withPlayer(state, permanent.controller, (player) => ({
    ...player,
    battlefield: player.battlefield.filter((candidate) => candidate.instance_id !== permanent.instance_id)
  }));
  // Rule 603.6c-d: leaves-the-battlefield triggers use the object's last
  // known information, before commander/token replacements are applied.
  next = raiseEvent(next, {
    kind: "leaves-battlefield",
    permanentId: permanent.instance_id,
    controller: permanent.controller,
    card: permanent.card
  }, [permanent]);
  if (permanent.isCommander) {
    // Rule 903.9: the owner may put the commander into the command zone instead.
    next = withPlayer(next, ownerSeat, (player) => ({ ...player, commandZone: [...player.commandZone, permanent.card] }));
    return logged(next, ownerSeat, `${permanent.card.name} vuelve a la zona de mando.`);
  }
  if (permanent.card.token) {
    if (zone === "graveyard" && isCreature(cardProfile(permanent.card))) {
      next = raiseEvent(next, { kind: "dies", permanentId: permanent.instance_id, controller: permanent.controller, card: permanent.card }, [permanent]);
    }
    return logged(next, permanent.controller, `${permanent.card.name} deja el campo de batalla.`);
  }
  next = withPlayer(next, ownerSeat, (player) => ({ ...player, [zone]: [...player[zone], permanent.card] }));
  next = logged(next, permanent.controller, `${permanent.card.name} va ${zone === "graveyard" ? "al cementerio" : "al exilio"}.`);
  // "Dies" is specifically battlefield → graveyard (rule 700.4). A commander
  // redirected to the command zone above never reaches this point.
  if (zone === "graveyard" && isCreature(cardProfile(permanent.card))) {
    next = raiseEvent(next, { kind: "dies", permanentId: permanent.instance_id, controller: permanent.controller, card: permanent.card }, [permanent]);
  }
  return next;
}

/** Removes a permanent from combat without moving it off the battlefield. */
function removeFromCombat(state: GameState, instanceId: string): GameState {
  const attackers = state.combat.attackers.filter((entry) => entry.instanceId !== instanceId);
  const blockers = state.combat.blockers.filter((entry) => entry.instanceId !== instanceId && entry.attackerId !== instanceId);
  if (attackers.length === state.combat.attackers.length && blockers.length === state.combat.blockers.length) return state;
  return { ...state, combat: { ...state.combat, attackers, blockers } };
}

/**
 * Applies the destruction replacement created by Regenerate, or destroys the
 * permanent normally when no shield remains (CR 701.19, 400.7g).
 */
function destroyPermanent(state: GameState, permanent: Permanent): GameState {
  const current = findPermanent(state, permanent.instance_id);
  if (!current || keywordOf(state, current, "indestructible")) return state;
  const shields = current.regenerationShields ?? 0;
  if (shields <= 0) return movePermanentToZone(state, current, "graveyard");
  let next = withPlayer(state, current.controller, (player) => ({
    ...player,
    battlefield: player.battlefield.map((candidate) => candidate.instance_id === current.instance_id
      ? { ...candidate, tapped: true, damage: 0, deathtouched: false, regenerationShields: shields - 1 }
      : candidate)
  }));
  next = removeFromCombat(next, current.instance_id);
  return logged(next, current.controller, `${current.card.name} regenera y permanece en el campo de batalla.`);
}

function entersTapped(state: GameState, seat: SeatId, profile: CardProfile): { tapped: boolean; lifeCost: number } {
  const rule = profile.entersTapped;
  const player = playerAt(state, seat);
  switch (rule.kind) {
    case "untapped": return { tapped: false, lifeCost: 0 };
    case "tapped": return { tapped: true, lifeCost: 0 };
    case "unless-few-lands": {
      const otherLands = player.battlefield.filter((permanent) => isLand(cardProfile(permanent.card))).length;
      return { tapped: otherLands > rule.max, lifeCost: 0 };
    }
    case "unless-many-lands": {
      const otherLands = player.battlefield.filter((permanent) => isLand(cardProfile(permanent.card))).length;
      return { tapped: otherLands < rule.min, lifeCost: 0 };
    }
    case "unless-pay-life":
      // Paying is the standard line whenever the life total can afford it comfortably.
      return player.life > rule.life + 1 ? { tapped: false, lifeCost: rule.life } : { tapped: true, lifeCost: 0 };
    case "unless-reveal-card":
      // The land is provisionally tapped until the controller completes the
      // replacement-effect choice (CR 614.1c).
      return { tapped: true, lifeCost: 0 };
  }
}

function putOntoBattlefield(state: GameState, seat: SeatId, card: GameCard, isCommander: boolean, forceTapped = false, kicked = false, evoked = false): GameState {
  const profile = cardProfile(card);
  const printed = entersTapped(state, seat, profile);
  // An effect that says "onto the battlefield tapped" overrides the card's own
  // printed entry rule; it never makes a tapped-by-default land enter untapped.
  const enters = forceTapped ? { tapped: true, lifeCost: 0 } : printed;
  const permanent: Permanent = {
    instance_id: card.instance_id,
    card,
    controller: seat,
    tapped: enters.tapped,
    summoningSick: true,
    damage: 0,
    deathtouched: false,
    ...(kicked ? { kicked: true } : {}),
    ...(evoked ? { evoked: true } : {}),
    counters: {
      ...Object.fromEntries(profile.entersWithCounters.map((counter) => [counter.kind, counter.amount])),
      // A planeswalker enters with loyalty counters equal to its printed value (CR 306.5b).
      ...(profile.types.includes("Planeswalker") && profile.loyalty !== null ? { loyalty: profile.loyalty } : {})
    },
    powerModifier: 0,
    toughnessModifier: 0,
    temporaryKeywords: [],
    regenerationShields: 0,
    isCommander
  };
  let next = withPlayer(state, seat, (player) => ({
    ...player,
    life: player.life - enters.lifeCost,
    battlefield: [...player.battlefield, permanent]
  }));
  if (enters.lifeCost) next = logged(next, seat, `${playerAt(next, seat).name} paga ${enters.lifeCost} vidas para que ${card.name} entre enderezada.`);
  const entered = playerAt(next, seat).battlefield.find((candidate) => candidate.instance_id === card.instance_id);
  if (entered) next = raiseEvent(next, { kind: "enters-battlefield", permanentId: entered.instance_id, controller: seat, card: entered.card });
  return next;
}

/** The object an event is about, when it is about an object at all. */
function eventObject(event: GameEvent): { permanentId: string; controller: SeatId; card: GameCard } | null {
  return "permanentId" in event
    ? { permanentId: event.permanentId, controller: event.controller, card: event.card }
    : null;
}

/**
 * Whether one printed trigger condition matches one event.
 *
 * `watcher` is the permanent carrying the ability, which is what makes
 * "another" and "you control" mean anything.
 */
function triggerMatches(
  state: GameState,
  watcher: { readonly instanceId: string; readonly controller: SeatId },
  definition: TriggerDefinition,
  event: GameEvent
): boolean {
  if (definition.event !== event.kind) return false;
  const condition = definition.condition;
  if (condition?.kind === "no-controlled-subtype") {
    const subtype = condition.subtype.toLowerCase();
    if (playerAt(state, watcher.controller).battlefield.some((permanent) => hasSubtype(cardProfile(permanent.card), subtype))) return false;
  }
  if (condition?.kind === "controlled-creature-power-at-least") {
    if (!playerAt(state, watcher.controller).battlefield.some((permanent) => isCreature(cardProfile(permanent.card))
      && powerOf(permanent, state) >= condition.amount)) return false;
  }
  const subject = definition.subject;

  // Turn-structure triggers are about a player, not an object.
  if (event.kind === "upkeep" || event.kind === "draw-step" || event.kind === "end-step") {
    if (subject === "you") return event.activeSeat === watcher.controller;
    if (subject === "each-player") return true;
    if (subject === "opponent") return event.activeSeat !== watcher.controller;
    return false;
  }

  if (event.kind === "spell-cast") {
    if (definition.spellType === "creature" && !isCreature(cardProfile(event.card))) return false;
    if (definition.spellType === "instant-or-sorcery"
      && !cardProfile(event.card).types.some((type) => type === "Instant" || type === "Sorcery")) return false;
    if (subject === "you") return event.controller === watcher.controller;
    if (subject === "opponent") return event.controller !== watcher.controller;
    if (subject === "each-player") return true;
    return false;
  }

  if (event.kind === "card-cycled") {
    return definition.subject === "self"
      && event.controller === watcher.controller
      && event.card.instance_id === watcher.instanceId;
  }

  if (event.kind === "card-drawn") {
    return definition.subject === "opponent" && event.seat !== watcher.controller;
  }

  if (event.kind === "life-gained" || event.kind === "life-lost") {
    return subject === "you" && event.seat === watcher.controller;
  }

  const object = eventObject(event);
  if (!object) return false;
  const isSelf = object.permanentId === watcher.instanceId;
  const objectIsCreature = isCreature(cardProfile(object.card));
  switch (subject) {
    case "self": return isSelf;
    case "self-or-another-creature-you-control": return objectIsCreature && object.controller === watcher.controller;
    case "creature-attacks-opponent":
      return event.kind === "attacks" && objectIsCreature && opponentsOf(state, watcher.controller).includes(event.defender);
    // Rule 109.5: "another" excludes the object the ability is printed on.
    case "another-creature-you-control": return !isSelf && objectIsCreature && object.controller === watcher.controller;
    case "another-permanent-you-control": return !isSelf && cardProfile(object.card).isPermanent && object.controller === watcher.controller;
    case "permanent-you-control": return cardProfile(object.card).isPermanent && object.controller === watcher.controller;
    case "creature-you-control": return objectIsCreature && object.controller === watcher.controller;
    case "artifact-creature-you-control": {
      const profile = cardProfile(object.card);
      return objectIsCreature && profile.types.includes("Artifact") && object.controller === watcher.controller;
    }
    case "land-you-control": return isLand(cardProfile(object.card)) && object.controller === watcher.controller;
    case "artifact-you-control": return cardProfile(object.card).types.includes("Artifact") && object.controller === watcher.controller;
    case "enchantment-you-control": return cardProfile(object.card).types.includes("Enchantment") && object.controller === watcher.controller;
    case "another-creature": return !isSelf && objectIsCreature;
    case "any-creature": return objectIsCreature;
    default: return false;
  }
}

function causeOf(state: GameState, event: GameEvent): string {
  const object = eventObject(event);
  switch (event.kind) {
    case "enters-battlefield": return `${object!.card.name} entra al campo de batalla`;
    case "leaves-battlefield": return `${object!.card.name} deja el campo de batalla`;
    case "dies": return `${object!.card.name} muere`;
    case "attacks": return `${object!.card.name} ataca`;
    case "blocks": return `${object!.card.name} bloquea`;
    case "deals-combat-damage-to-player": return `${object!.card.name} hace daño de combate a ${playerAt(state, event.victim).name}`;
    case "becomes-tapped": return `${object!.card.name} se gira`;
    case "spell-cast": return `${playerAt(state, event.controller).name} lanza ${event.card.name}`;
    case "card-cycled": return `${playerAt(state, event.controller).name} cicla ${event.card.name}`;
    case "card-drawn": return `${playerAt(state, event.seat).name} roba una carta`;
    case "life-gained": return `${playerAt(state, event.seat).name} gana ${event.amount} vidas`;
    case "life-lost": return `${playerAt(state, event.seat).name} pierde ${event.amount} vidas`;
    default: return `comienza el ${STEP_LABELS[event.kind === "upkeep" ? "upkeep" : event.kind === "draw-step" ? "draw" : "end"]} de ${playerAt(state, event.activeSeat).name}`;
  }
}

/**
 * Raises one event and queues every triggered ability that matches it.
 *
 * `extraWatchers` exists for leave-the-battlefield events: a creature's own
 * "when this dies" ability triggers from the moment it left, so the engine has
 * to look back at a permanent that is no longer on the battlefield (CR 603.6d).
 */
function raiseEvent(
  state: GameState,
  event: GameEvent,
  extraWatchers: readonly Permanent[] = []
): GameState {
  const watchers = [...allPermanents(state), ...extraWatchers];
  const queued: TriggerInstance[] = [];
  for (const watcher of watchers) {
    const definitions = cardProfile(watcher.card).triggers;
    for (const [index, definition] of definitions.entries()) {
      if (!triggerMatches(state, { instanceId: watcher.instance_id, controller: watcher.controller }, definition, event)) continue;
      // "if it was kicked" gate (CR 702.33e): only the kicked cast fires it.
      if (definition.requiresKicked && !watcher.kicked) continue;
      if (definition.requiresEvoked && !watcher.evoked) continue;
      queued.push({
        id: `trigger:${state.version}:${state.triggerQueue.length + queued.length}:${watcher.instance_id}:${index}`,
        controller: watcher.controller,
        sourcePermanentId: watcher.instance_id,
        sourceCard: watcher.card,
        definition,
        cause: causeOf(state, event),
        ...("controller" in event ? { eventController: event.controller } : {}),
        ...("permanentId" in event ? { eventPermanentId: event.permanentId } : {})
      });
    }
  }
  return queued.length ? { ...state, triggerQueue: [...state.triggerQueue, ...queued] } : state;
}

/** Raises `becomes-tapped` for each permanent that went from untapped to tapped. */
function raiseTapEvents(state: GameState, before: GameState, ids: Iterable<string>): GameState {
  let next = state;
  for (const id of ids) {
    const previous = findPermanent(before, id);
    const current = findPermanent(next, id);
    if (!previous || !current || previous.tapped || !current.tapped) continue;
    next = raiseEvent(next, { kind: "becomes-tapped", permanentId: id, controller: current.controller, card: current.card });
  }
  return next;
}

function revealOptions(player: PlayerState, subtypes: readonly string[]): GameCard[] {
  const wanted = new Set(subtypes.map((subtype) => subtype.toLowerCase()));
  return player.hand.filter((card) => Array.from(wanted).some((subtype) => hasSubtype(cardProfile(card), subtype)));
}

function pendingRevealFor(state: GameState, seat: SeatId, sourceId: string, subtypes: readonly string[]): PendingChoice {
  return {
    type: "reveal-card", seat, sourceId, stage: "confirm",
    optionIds: revealOptions(playerAt(state, seat), subtypes).map((card) => card.instance_id)
  };
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

function opponentsOf(state: GameState, seat: SeatId): SeatId[] {
  return state.players.filter((player) => player.seat !== seat && !player.lost).map((player) => player.seat);
}

function effectAmount(amount: number | "X", object: StackObject): number {
  return amount === "X" ? object.variableValue : amount;
}

function dealDamageToPlayer(state: GameState, seat: SeatId, amount: number, sourceName: string): GameState {
  if (amount <= 0) return state;
  const next = loseLife(state, seat, amount);
  return logged(next, seat, `${sourceName} hace ${amount} de daño a ${playerAt(next, seat).name}.`);
}

function loseLife(state: GameState, seat: SeatId, amount: number): GameState {
  if (amount <= 0) return state;
  const next = withPlayer(state, seat, (player) => ({ ...player, life: player.life - amount }));
  return raiseEvent(next, { kind: "life-lost", seat, amount });
}

function playersCantGainLife(state: GameState): boolean {
  return allPermanents(state).some((permanent) => cardProfile(permanent.card).preventsLifeGain);
}

function playerHasNoMaximumHandSize(state: GameState, seat: SeatId): boolean {
  return playerAt(state, seat).battlefield.some((permanent) => cardProfile(permanent.card).noMaximumHandSize);
}

function dealDamageToPermanent(state: GameState, instanceId: string, amount: number, deathtouch: boolean, sourceName: string): GameState {
  const permanent = findPermanent(state, instanceId);
  if (!permanent || amount <= 0) return state;
  const next = withPlayer(state, permanent.controller, (player) => ({
    ...player,
    battlefield: player.battlefield.map((candidate) =>
      candidate.instance_id === instanceId
        ? { ...candidate, damage: candidate.damage + amount, deathtouched: candidate.deathtouched || deathtouch }
        : candidate)
  }));
  return logged(next, permanent.controller, `${sourceName} hace ${amount} de daño a ${permanent.card.name}.`);
}

/** Applies a layer 7c P/T modifier which cleanup removes (CR 613.4c, 514.2). */
function modifyCreatures(
  state: GameState,
  power: number,
  toughness: number,
  predicate: (permanent: Permanent) => boolean
): GameState {
  return {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      battlefield: player.battlefield.map((permanent) =>
        isCreature(cardProfile(permanent.card)) && predicate(permanent)
          ? { ...permanent, powerModifier: permanent.powerModifier + power, toughnessModifier: permanent.toughnessModifier + toughness }
          : permanent)
    }))
  };
}

function applyEffect(state: GameState, object: StackObject, effect: SpellEffect): GameState {
  const controller = object.controller;
  const sourceName = object.card.name;
  switch (effect.kind) {
    case "compound": {
      let next = state;
      for (const child of effect.effects) next = applyEffect(next, object, child);
      return next;
    }
    case "draw": return drawCards(state, controller, effectAmount(effect.amount, object));
    case "draw-target-player": {
      const target = object.targets[0];
      return target?.kind === "player" ? drawCards(state, target.seat, effectAmount(effect.amount, object)) : state;
    }
    case "draw-active-player": return drawCards(state, state.activeSeat, 1);
    case "draw-equal-tapped-creatures": {
      const target = object.targets[0];
      if (!target || target.kind !== "player") return state;
      const amount = playerAt(state, target.seat).battlefield.filter((permanent) => permanent.tapped && isCreature(cardProfile(permanent.card))).length;
      return drawCards(state, target.seat, amount);
    }
    case "draw-equal-controlled-type": {
      const amount = playerAt(state, controller).battlefield.filter((permanent) => cardProfile(permanent.card).types.includes(effect.type)).length;
      return drawCards(state, controller, amount);
    }
    case "draw-equal-controlled-color-creature": {
      const amount = playerAt(state, controller).battlefield.filter((permanent) => {
        const p = cardProfile(permanent.card);
        return isCreature(p) && p.colors.includes(effect.color);
      }).length;
      return drawCards(state, controller, amount);
    }
    case "each-player-draw": {
      let next = state;
      for (const player of state.players) if (!player.lost) next = drawCards(next, player.seat, effectAmount(effect.amount, object));
      return next;
    }
    case "each-opponent-draw": {
      let next = state;
      const amount = effectAmount(effect.amount, object);
      for (const seat of opponentsOf(state, controller)) next = drawCards(next, seat, amount);
      return next;
    }
    case "exile-self":
    case "shuffle-self-into-library":
      // The card's own move is handled by resolveTop after other effects run.
      return state;
    case "sacrifice-source": {
      const sourceId = object.trigger?.sourcePermanentId ?? object.sourcePermanentId ?? object.card.instance_id;
      const permanent = findPermanent(state, sourceId);
      if (!permanent) return state;
      return logged(movePermanentToZone(state, permanent, "graveyard"), permanent.controller, `${permanent.card.name} es sacrificado.`);
    }
    case "return-source-to-hand": {
      // "When ~ is put into a graveyard from the battlefield, return it to its
      // owner's hand" (Fool's Demise, Spine of Ish Sah). By the time this
      // resolves the card is already in the graveyard.
      const owner = object.card.owner;
      if (!playerAt(state, owner).graveyard.some((card) => card.instance_id === object.card.instance_id)) return state;
      return withPlayer(state, owner, (player) => ({
        ...player,
        graveyard: player.graveyard.filter((card) => card.instance_id !== object.card.instance_id),
        hand: [...player.hand, object.card]
      }));
    }
    case "draw-then-discard": {
      let next = drawCards(state, controller, effect.draw);
      const amount = Math.min(effect.discard, playerAt(next, controller).hand.length);
      if (amount <= 0) return next;
      return {
        ...next,
        priorityOpen: false,
        pendingChoice: { type: "discard-cards", seat: controller, sourceId: object.id, sourceCard: object.card, amount, remaining: amount }
      };
    }
    case "discard-target-player": {
      const target = object.targets[0];
      if (target?.kind !== "player") return state;
      const amount = Math.min(effectAmount(effect.amount, object), playerAt(state, target.seat).hand.length);
      if (amount <= 0) return state;
      return {
        ...state,
        priorityOpen: false,
        pendingChoice: {
          type: "discard-cards",
          seat: target.seat,
          sourceId: object.id,
          sourceCard: object.card,
          amount,
          remaining: amount
        }
      };
    }
    case "mill-target-player": {
      const target = object.targets[0];
      return target?.kind === "player" ? millCards(state, target.seat, effectAmount(effect.amount, object)) : state;
    }
    case "mill-each-opponent": {
      let next = state;
      const amount = effectAmount(effect.amount, object);
      for (const seat of opponentsOf(state, controller)) next = millCards(next, seat, amount);
      return next;
    }
    case "gain-life": {
      if (playersCantGainLife(state)) return state;
      const amount = effectAmount(effect.amount, object);
      const next = withPlayer(state, controller, (player) => ({ ...player, life: player.life + amount }));
      return logged(raiseEvent(next, { kind: "life-gained", seat: controller, amount }), controller, `${playerAt(next, controller).name} gana ${amount} vidas.`);
    }
    case "gain-life-each-controlled-type": {
      if (playersCantGainLife(state)) return state;
      const amount = allPermanents(state).filter((permanent) => permanent.controller === controller
        && cardProfile(permanent.card).types.includes(effect.type)).length * effect.amount;
      if (amount === 0) return state;
      const next = withPlayer(state, controller, (player) => ({ ...player, life: player.life + amount }));
      return logged(raiseEvent(next, { kind: "life-gained", seat: controller, amount }), controller, `${playerAt(next, controller).name} gana ${amount} vidas.`);
    }
    case "gain-life-each-permanent": {
      if (playersCantGainLife(state)) return state;
      const amount = playerAt(state, controller).battlefield.length * effect.amount;
      if (amount === 0) return state;
      const next = withPlayer(state, controller, (player) => ({ ...player, life: player.life + amount }));
      return logged(raiseEvent(next, { kind: "life-gained", seat: controller, amount }), controller, `${playerAt(next, controller).name} gana ${amount} vidas.`);
    }
    case "gain-life-equal-target-power": {
      if (playersCantGainLife(state)) return state;
      const target = object.targets[0];
      if (!target || target.kind !== "permanent") return state;
      const creature = findPermanent(state, target.instanceId);
      if (!creature || !isCreature(cardProfile(creature.card))) return state;
      const amount = powerOf(creature, state);
      const next = withPlayer(state, controller, (player) => ({ ...player, life: player.life + amount }));
      return logged(raiseEvent(next, { kind: "life-gained", seat: controller, amount }), controller, `${playerAt(next, controller).name} gana ${amount} vidas.`);
    }
    case "lose-life": {
      const amount = effectAmount(effect.amount, object);
      const next = loseLife(state, controller, amount);
      return logged(next, controller, `${playerAt(next, controller).name} pierde ${amount} vidas.`);
    }
    case "gain-life-target-player": {
      const target = object.targets[0];
      if (target?.kind !== "player") return state;
      if (playersCantGainLife(state)) return state;
      const amount = effectAmount(effect.amount, object);
      const next = withPlayer(state, target.seat, (player) => ({ ...player, life: player.life + amount }));
      return logged(raiseEvent(next, { kind: "life-gained", seat: target.seat, amount }), controller, `${playerAt(next, target.seat).name} gana ${amount} vidas.`);
    }
    case "each-player-gains-life": {
      if (playersCantGainLife(state)) return state;
      let next = state;
      const amount = effectAmount(effect.amount, object);
      for (const player of state.players) {
        if (player.lost) continue;
        next = withPlayer(next, player.seat, (current) => ({ ...current, life: current.life + amount }));
        next = raiseEvent(next, { kind: "life-gained", seat: player.seat, amount });
      }
      return logged(next, controller, `Cada jugador gana ${amount} vidas.`);
    }
    case "lose-life-target-player": {
      const target = object.targets[0];
      if (target?.kind !== "player") return state;
      const amount = effectAmount(effect.amount, object);
      const next = loseLife(state, target.seat, amount);
      return logged(next, controller, `${playerAt(next, target.seat).name} pierde ${amount} vidas.`);
    }
    case "lose-life-target-player-each-controlled-type": {
      const target = object.targets[0];
      if (target?.kind !== "player") return state;
      const amount = playerAt(state, controller).battlefield.filter((permanent) => cardProfile(permanent.card).types.includes(effect.type)).length;
      return loseLife(state, target.seat, amount);
    }
    case "each-player-loses-life": {
      let next = state;
      const amount = effectAmount(effect.amount, object);
      for (const player of state.players) {
        if (player.lost) continue;
        next = loseLife(next, player.seat, amount);
      }
      return logged(next, controller, `Cada jugador pierde ${amount} vidas.`);
    }
    case "each-opponent-loses-life": {
      let next = state;
      const amount = effectAmount(effect.amount, object);
      for (const seat of opponentsOf(state, controller)) {
        next = loseLife(next, seat, amount);
        next = logged(next, controller, `${playerAt(next, seat).name} pierde ${amount} vidas.`);
      }
      return next;
    }
    case "extort": {
      // Each opponent loses 1 life; the controller gains that much (CR 702.39a).
      let next = state;
      let drained = 0;
      for (const seat of opponentsOf(state, controller)) {
        next = loseLife(next, seat, 1);
        drained += 1;
      }
      if (drained > 0) {
        next = withPlayer(next, controller, (player) => ({ ...player, life: player.life + drained }));
        next = raiseEvent(next, { kind: "life-gained", seat: controller, amount: drained });
        next = logged(next, controller, `Extorsión: cada oponente pierde 1 vida; ${playerAt(next, controller).name} gana ${drained}.`);
      }
      return next;
    }
    case "damage-each-opponent": {
      let next = state;
      for (const seat of opponentsOf(state, controller)) next = dealDamageToPlayer(next, seat, effectAmount(effect.amount, object), sourceName);
      return next;
    }
    case "damage-all-creatures": {
      let next = state;
      const amount = effectAmount(effect.amount, object);
      for (const permanent of allPermanents(state)) {
        const profile = cardProfile(permanent.card);
        if (!isCreature(profile)) continue;
        if (effect.excludeSource && permanent.instance_id === object.card.instance_id) continue;
        if (effect.filter === "nonartifact" && profile.types.includes("Artifact")) continue;
        if (effect.filter === "without-flying" && keywordOf(next, permanent, "flying")) continue;
        next = dealDamageToPermanent(next, permanent.instance_id, amount, false, sourceName);
      }
      return next;
    }
    case "damage-each-creature-and-player": {
      const amount = effectAmount(effect.amount, object);
      let next = state;
      for (const permanent of allPermanents(state)) {
        if (isCreature(cardProfile(permanent.card))) next = dealDamageToPermanent(next, permanent.instance_id, amount, false, sourceName);
      }
      for (const player of state.players) {
        if (!player.lost) next = dealDamageToPlayer(next, player.seat, amount, sourceName);
      }
      return next;
    }
    case "damage-each-player": {
      const amount = effectAmount(effect.amount, object);
      let next = state;
      for (const player of state.players) if (!player.lost) next = dealDamageToPlayer(next, player.seat, amount, sourceName);
      return next;
    }
    case "mill-each-player": {
      let next = state;
      const amount = effectAmount(effect.amount, object);
      for (const player of state.players) next = millCards(next, player.seat, amount);
      return next;
    }
    case "each-player-discard-and-draw": {
      let next = state;
      for (const player of state.players) {
        const hand = playerAt(next, player.seat).hand;
        next = withPlayer(next, player.seat, (current) => ({ ...current, hand: [], graveyard: [...current.graveyard, ...hand] }));
        next = drawCards(next, player.seat, effect.amount);
      }
      return next;
    }
    case "damage-nonflying-creatures-and-players": {
      const amount = effectAmount(effect.amount, object);
      let next = state;
      for (const permanent of allPermanents(state)) {
        if (isCreature(cardProfile(permanent.card)) && !keywordOf(state, permanent, "flying")) {
          next = dealDamageToPermanent(next, permanent.instance_id, amount, false, sourceName);
        }
      }
      for (const player of state.players) if (!player.lost) next = dealDamageToPlayer(next, player.seat, amount, sourceName);
      return next;
    }
    case "damage-flying-creatures": {
      const amount = effectAmount(effect.amount, object);
      let next = state;
      for (const permanent of allPermanents(state)) {
        if (isCreature(cardProfile(permanent.card)) && keywordOf(state, permanent, "flying")) {
          next = dealDamageToPermanent(next, permanent.instance_id, amount, false, sourceName);
        }
      }
      return next;
    }
    case "damage-any-target": {
      const target = object.targets[0];
      if (!target) return state;
      const amount = effectAmount(effect.amount, object);
      if (target.kind === "player") return dealDamageToPlayer(state, target.seat, amount, sourceName);
      if (target.kind === "permanent") return dealDamageToPermanent(state, target.instanceId, amount, false, sourceName);
      return state;
    }
    case "damage-any-target-each-controlled-type": {
      const target = object.targets[0];
      if (!target) return state;
      const amount = playerAt(state, controller).battlefield.filter((permanent) => cardProfile(permanent.card).types.includes(effect.type)).length;
      if (target.kind === "player") return dealDamageToPlayer(state, target.seat, amount, sourceName);
      if (target.kind === "permanent") return dealDamageToPermanent(state, target.instanceId, amount, false, sourceName);
      return state;
    }
    case "damage-controller-equal-hand": {
      return dealDamageToPlayer(state, controller, playerAt(state, controller).hand.length, sourceName);
    }
    case "damage-active-player-equal-hand": {
      return dealDamageToPlayer(state, state.activeSeat, playerAt(state, state.activeSeat).hand.length, sourceName);
    }
    case "lose-life-each-player-equal-hand": {
      let next = state;
      for (const player of state.players) next = loseLife(next, player.seat, player.hand.length);
      return next;
    }
    case "damage-active-player-hand-minus": {
      const amount = Math.max(0, playerAt(state, state.activeSeat).hand.length - effect.offset);
      return dealDamageToPlayer(state, state.activeSeat, amount, sourceName);
    }
    case "modify-all-creatures": {
      const next = modifyCreatures(state, effect.power, effect.toughness, () => true);
      return logged(next, controller, `${sourceName} modifica a todas las criaturas hasta el final del turno.`);
    }
    case "modify-all-creatures-minus-X": {
      const amount = -object.variableValue;
      const next = modifyCreatures(state, amount, amount, () => true);
      return logged(next, controller, `${sourceName} da -${Math.abs(amount)}/-${Math.abs(amount)} a todas las criaturas hasta el final del turno.`);
    }
    case "modify-creatures-you-control": {
      const next = modifyCreatures(state, effect.power, effect.toughness, (permanent) => permanent.controller === controller);
      return logged(next, controller, `${sourceName} modifica tus criaturas hasta el final del turno.`);
    }
    case "modify-target-creature": {
      const target = object.targets[0];
      if (!target || target.kind !== "permanent") return state;
      const permanent = findPermanent(state, target.instanceId);
      if (!permanent || !isCreature(cardProfile(permanent.card))) return state;
      return modifyCreatures(state, effect.power, effect.toughness, (candidate) => candidate.instance_id === permanent.instance_id);
    }
    case "modify-source-creature": {
      const sourceId = object.sourcePermanentId ?? object.trigger?.sourcePermanentId;
      const source = sourceId ? findPermanent(state, sourceId) : undefined;
      if (!source || !isCreature(cardProfile(source.card))) return state;
      return modifyCreatures(state, effect.power, effect.toughness, (candidate) => candidate.instance_id === source.instance_id);
    }
    case "modify-triggered-creature": {
      const targetId = object.trigger?.eventPermanentId;
      if (!targetId) return state;
      return modifyCreatures(state, effect.power, effect.toughness, (candidate) => candidate.instance_id === targetId);
    }
    case "modify-triggered-creature-and-grant-keyword": {
      const targetId = object.trigger?.sourcePermanentId;
      if (!targetId) return state;
      return withPlayer(modifyCreatures(state, effect.power, effect.toughness, (candidate) => candidate.instance_id === targetId), controller, (player) => ({
        ...player,
        battlefield: player.battlefield.map((permanent) => permanent.instance_id === targetId
          ? { ...permanent, temporaryKeywords: [...new Set([...(permanent.temporaryKeywords ?? []), effect.keyword])] }
          : permanent)
      }));
    }
    case "grant-target-creature-keyword": {
      const target = object.targets[0];
      if (!target || target.kind !== "permanent") return state;
      const permanent = findPermanent(state, target.instanceId);
      if (!permanent || !isCreature(cardProfile(permanent.card))) return state;
      return withPlayer(state, permanent.controller, (player) => ({
        ...player,
        battlefield: player.battlefield.map((candidate) => candidate.instance_id === permanent.instance_id
          ? { ...candidate, temporaryKeywords: [...new Set([...(candidate.temporaryKeywords ?? []), effect.keyword])] }
          : candidate)
      }));
    }
    case "grant-permanents-you-control-keyword": {
      return withPlayer(state, controller, (player) => ({
        ...player,
        battlefield: player.battlefield.map((permanent) => ({
          ...permanent,
          temporaryKeywords: [...new Set([...(permanent.temporaryKeywords ?? []), effect.keyword])]
        }))
      }));
    }
    case "grant-all-creatures-keyword": {
      return {
        ...state,
        players: state.players.map((player) => ({
          ...player,
          battlefield: player.battlefield.map((permanent) => isCreature(cardProfile(permanent.card))
            ? { ...permanent, temporaryKeywords: [...new Set([...(permanent.temporaryKeywords ?? []), effect.keyword])] }
            : permanent)
        }))
      };
    }
    case "discard-target-player-hand": {
      const target = object.targets[0];
      if (target?.kind !== "player") return state;
      const hand = playerAt(state, target.seat).hand;
      if (!hand.length) return state;
      return withPlayer(state, target.seat, (player) => ({ ...player, hand: [], graveyard: [...player.graveyard, ...hand] }));
    }
    case "modify-and-grant-target-creature": {
      const target = object.targets[0];
      if (!target || target.kind !== "permanent") return state;
      const permanent = findPermanent(state, target.instanceId);
      if (!permanent || !isCreature(cardProfile(permanent.card))) return state;
      return withPlayer(state, permanent.controller, (player) => ({
        ...player,
        battlefield: player.battlefield.map((candidate) => candidate.instance_id === permanent.instance_id
          ? {
              ...candidate,
              powerModifier: candidate.powerModifier + effect.power,
              toughnessModifier: candidate.toughnessModifier + effect.toughness,
              temporaryKeywords: [...new Set([...(candidate.temporaryKeywords ?? []), effect.keyword])]
            }
          : candidate)
      }));
    }
    case "add-counter-target-creature": {
      const target = object.targets[0];
      if (!target || target.kind !== "permanent") return state;
      const permanent = findPermanent(state, target.instanceId);
      if (!permanent || !isCreature(cardProfile(permanent.card))) return state;
      return withPlayer(state, permanent.controller, (player) => ({
        ...player,
        battlefield: player.battlefield.map((candidate) => candidate.instance_id === permanent.instance_id
          ? {
              ...candidate,
              counters: {
                ...candidate.counters,
                [effect.counter]: (candidate.counters[effect.counter] ?? 0) + effect.amount
              }
            }
          : candidate)
      }));
    }
    case "destroy-target-creature": {
      const target = object.targets[0];
      if (!target || target.kind !== "permanent") return state;
      const permanent = findPermanent(state, target.instanceId);
      return permanent ? destroyPermanent(state, permanent) : state;
    }
    case "destroy-target-creature-then-life-loss": {
      const target = object.targets[0];
      if (!target || target.kind !== "permanent") return state;
      const permanent = findPermanent(state, target.instanceId);
      if (!permanent || !isCreature(cardProfile(permanent.card)) || keywordOf(state, permanent, "indestructible")) return state;
      const loss = powerOf(permanent, state) + toughnessOf(permanent, state);
      let next = movePermanentToZone(state, permanent, "graveyard");
      next = loseLife(next, permanent.controller, loss);
      return logged(next, controller, `${permanent.card.name} es destruida y su controlador pierde ${loss} vidas.`);
    }
    case "destroy-target-permanent": {
      const target = object.targets[0];
      if (!target || target.kind !== "permanent") return state;
      const permanent = findPermanent(state, target.instanceId);
      return permanent ? destroyPermanent(state, permanent) : state;
    }
    case "chaos-warp": {
      const target = object.targets[0];
      if (!target || target.kind !== "permanent") return state;
      const permanent = findPermanent(state, target.instanceId);
      if (!permanent) return state;

      // Chaos Warp removes the permanent without destroying it, then shuffles it
      // into its owner's library before revealing that library's top card.
      let next = withPlayer(state, permanent.controller, (player) => ({
        ...player,
        battlefield: player.battlefield.filter((candidate) => candidate.instance_id !== permanent.instance_id)
      }));
      next = permanent.isCommander
        ? withPlayer(next, permanent.card.owner, (player) => ({ ...player, commandZone: [...player.commandZone, permanent.card] }))
        : withPlayer(next, permanent.card.owner, (player) => ({ ...player, library: [...player.library, permanent.card] }));

      const owner = playerAt(next, permanent.card.owner);
      const shuffled = shuffle(owner.library, next.rngState);
      next = { ...next, rngState: shuffled.state };
      const top = shuffled.items[0];
      next = withPlayer(next, permanent.card.owner, (player) => ({ ...player, library: shuffled.items.slice(1) }));
      if (top && cardProfile(top).isPermanent) {
        next = putOntoBattlefield(next, permanent.card.owner, top, false);
      } else if (top) {
        next = withPlayer(next, permanent.card.owner, (player) => ({ ...player, library: [top, ...player.library] }));
      }
      return logged(next, controller, `${permanent.card.name} se baraja en la biblioteca de su propietario.`);
    }
    case "regenerate-source": {
      const sourceId = object.trigger?.sourcePermanentId ?? object.sourcePermanentId ?? object.card.instance_id;
      const source = findPermanent(state, sourceId);
      if (!source) return state;
      return withPlayer(state, source.controller, (player) => ({
        ...player,
        battlefield: player.battlefield.map((permanent) => permanent.instance_id === source.instance_id
          ? { ...permanent, regenerationShields: (permanent.regenerationShields ?? 0) + 1 }
          : permanent)
      }));
    }
    case "regenerate-target-creature": {
      const target = object.targets[0];
      if (!target || target.kind !== "permanent") return state;
      const creature = findPermanent(state, target.instanceId);
      if (!creature || !isCreature(cardProfile(creature.card))) return state;
      return withPlayer(state, creature.controller, (player) => ({
        ...player,
        battlefield: player.battlefield.map((permanent) => permanent.instance_id === creature.instance_id
          ? { ...permanent, regenerationShields: (permanent.regenerationShields ?? 0) + 1 }
          : permanent)
      }));
    }
    case "exile-target-permanent": {
      const target = object.targets[0];
      if (!target || target.kind !== "permanent") return state;
      const permanent = findPermanent(state, target.instanceId);
      return permanent ? movePermanentToZone(state, permanent, "exile") : state;
    }
    case "exile-target-nontoken-creature": {
      const target = object.targets[0];
      if (!target || target.kind !== "permanent") return state;
      const creature = findPermanent(state, target.instanceId);
      if (!creature || creature.card.token || !isCreature(cardProfile(creature.card))) return state;
      const moved = movePermanentToZone(state, creature, "exile");
      const sourceId = object.trigger?.sourcePermanentId ?? object.sourcePermanentId;
      const source = sourceId ? findPermanent(moved, sourceId) : undefined;
      if (!source) return moved;
      return withPlayer(moved, source.controller, (player) => ({
        ...player,
        battlefield: player.battlefield.map((permanent) => permanent.instance_id === source.instance_id
          ? { ...permanent, exiledWith: creature.card }
          : permanent)
      }));
    }
    case "exile-target-graveyard": {
      const target = object.targets[0];
      if (!target || target.kind !== "player") return state;
      const player = playerAt(state, target.seat);
      const next = withPlayer(state, target.seat, (current) => ({ ...current, graveyard: [], exile: [...current.exile, ...current.graveyard] }));
      return logged(next, controller, `${sourceName} exilia el cementerio de ${player.name}.`);
    }
    case "return-target-creature": {
      const target = object.targets[0];
      if (!target || target.kind !== "permanent") return state;
      const permanent = findPermanent(state, target.instanceId);
      if (!permanent) return state;
      const next = withPlayer(state, permanent.controller, (player) => ({
        ...player,
        battlefield: player.battlefield.filter((candidate) => candidate.instance_id !== permanent.instance_id)
      }));
      return withPlayer(next, permanent.card.owner, (player) => ({ ...player, hand: [...player.hand, permanent.card] }));
    }
    case "put-target-creature-on-library-top": {
      const target = object.targets[0];
      if (!target || target.kind !== "permanent") return state;
      const permanent = findPermanent(state, target.instanceId);
      if (!permanent || !isCreature(cardProfile(permanent.card))) return state;
      const removed = withPlayer(state, permanent.controller, (player) => ({
        ...player,
        battlefield: player.battlefield.filter((candidate) => candidate.instance_id !== permanent.instance_id)
      }));
      if (permanent.isCommander) {
        return withPlayer(removed, permanent.card.owner, (player) => ({ ...player, commandZone: [...player.commandZone, permanent.card] }));
      }
      return withPlayer(removed, permanent.card.owner, (player) => ({ ...player, library: [permanent.card, ...player.library] }));
    }
    case "return-target-permanent": {
      const target = object.targets[0];
      if (!target || target.kind !== "permanent") return state;
      const permanent = findPermanent(state, target.instanceId);
      if (!permanent) return state;
      const next = withPlayer(state, permanent.controller, (player) => ({
        ...player,
        battlefield: player.battlefield.filter((candidate) => candidate.instance_id !== permanent.instance_id)
      }));
      return withPlayer(next, permanent.card.owner, (player) => ({ ...player, hand: [...player.hand, permanent.card] }));
    }
    case "return-target-land": {
      const target = object.targets[0];
      if (!target || target.kind !== "permanent") return state;
      const permanent = findPermanent(state, target.instanceId);
      if (!permanent || permanent.controller !== controller || !isLand(cardProfile(permanent.card))) return state;
      const next = withPlayer(state, permanent.controller, (player) => ({
        ...player,
        battlefield: player.battlefield.filter((candidate) => candidate.instance_id !== permanent.instance_id)
      }));
      return withPlayer(next, permanent.card.owner, (player) => ({ ...player, hand: [...player.hand, permanent.card] }));
    }
    case "return-target-card-from-graveyard": {
      const target = object.targets[0];
      if (!target || target.kind !== "graveyard-card") return state;
      const player = playerAt(state, target.seat);
      const card = player.graveyard.find((candidate) => candidate.instance_id === target.instanceId);
      if (!card) return state;
      return withPlayer(state, target.seat, (current) => ({
        ...current,
        hand: [...current.hand, card],
        graveyard: current.graveyard.filter((candidate) => candidate.instance_id !== card.instance_id)
      }));
    }
    case "return-target-creature-card-from-graveyard-to-battlefield": {
      const target = object.targets[0];
      if (!target || target.kind !== "graveyard-card") return state;
      const player = playerAt(state, target.seat);
      const card = player.graveyard.find((candidate) => candidate.instance_id === target.instanceId);
      if (!card || !isCreature(cardProfile(card))) return state;
      const next = withPlayer(state, target.seat, (current) => ({
        ...current,
        graveyard: current.graveyard.filter((candidate) => candidate.instance_id !== card.instance_id)
      }));
      return putOntoBattlefield(next, object.controller, card, false);
    }
    case "return-target-land-card-from-graveyard-to-battlefield": {
      const target = object.targets[0];
      if (!target || target.kind !== "graveyard-card") return state;
      const player = playerAt(state, target.seat);
      const card = player.graveyard.find((candidate) => candidate.instance_id === target.instanceId);
      if (!card || !isLand(cardProfile(card))) return state;
      const next = withPlayer(state, target.seat, (current) => ({
        ...current,
        graveyard: current.graveyard.filter((candidate) => candidate.instance_id !== card.instance_id)
      }));
      return putOntoBattlefield(next, object.controller, card, false);
    }
    case "return-target-artifact-card-from-graveyard-to-battlefield": {
      const target = object.targets[0];
      if (!target || target.kind !== "graveyard-card") return state;
      const player = playerAt(state, target.seat);
      const card = player.graveyard.find((candidate) => candidate.instance_id === target.instanceId);
      if (!card || !cardProfile(card).types.includes("Artifact")) return state;
      const next = withPlayer(state, target.seat, (current) => ({
        ...current,
        graveyard: current.graveyard.filter((candidate) => candidate.instance_id !== card.instance_id)
      }));
      return putOntoBattlefield(next, object.controller, card, false);
    }
    case "return-target-legendary-creature-card-from-graveyard-to-battlefield": {
      const target = object.targets[0];
      if (!target || target.kind !== "graveyard-card") return state;
      const player = playerAt(state, target.seat);
      const card = player.graveyard.find((candidate) => candidate.instance_id === target.instanceId);
      const profile = card ? cardProfile(card) : null;
      if (!card || !profile || !isCreature(profile) || !profile.supertypes.some((value) => value.toLowerCase() === "legendary")) return state;
      const next = withPlayer(state, target.seat, (current) => ({ ...current, graveyard: current.graveyard.filter((candidate) => candidate.instance_id !== card.instance_id) }));
      return putOntoBattlefield(next, object.controller, card, false);
    }
    case "return-target-permanent-card-from-graveyard-to-battlefield": {
      const target = object.targets[0];
      if (!target || target.kind !== "graveyard-card") return state;
      const player = playerAt(state, target.seat);
      const card = player.graveyard.find((candidate) => candidate.instance_id === target.instanceId);
      if (!card || !cardProfile(card).isPermanent) return state;
      const next = withPlayer(state, target.seat, (current) => ({
        ...current,
        graveyard: current.graveyard.filter((candidate) => candidate.instance_id !== card.instance_id)
      }));
      return putOntoBattlefield(next, object.controller, card, false);
    }
    case "return-target-enchantment-card-from-graveyard-to-battlefield": {
      const target = object.targets[0];
      if (!target || target.kind !== "graveyard-card") return state;
      const player = playerAt(state, target.seat);
      const card = player.graveyard.find((candidate) => candidate.instance_id === target.instanceId);
      if (!card || !cardProfile(card).types.includes("Enchantment")) return state;
      const next = withPlayer(state, target.seat, (current) => ({
        ...current,
        graveyard: current.graveyard.filter((candidate) => candidate.instance_id !== card.instance_id)
      }));
      return putOntoBattlefield(next, object.controller, card, false);
    }
    case "exile-target-card-from-graveyard": {
      const target = object.targets[0];
      if (!target || target.kind !== "graveyard-card") return state;
      const player = playerAt(state, target.seat);
      const card = player.graveyard.find((candidate) => candidate.instance_id === target.instanceId);
      if (!card) return state;
      return withPlayer(state, target.seat, (current) => ({
        ...current,
        graveyard: current.graveyard.filter((candidate) => candidate.instance_id !== card.instance_id),
        exile: [...current.exile, card]
      }));
    }
    case "return-target-card-to-library-top": {
      const target = object.targets[0];
      if (!target || target.kind !== "graveyard-card") return state;
      const player = playerAt(state, target.seat);
      const card = player.graveyard.find((candidate) => candidate.instance_id === target.instanceId);
      if (!card) return state;
      return withPlayer(state, target.seat, (current) => ({
        ...current,
        graveyard: current.graveyard.filter((candidate) => candidate.instance_id !== card.instance_id),
        library: [card, ...current.library]
      }));
    }
    case "exile-target-permanent-card-from-graveyard": {
      const target = object.targets[0];
      if (!target || target.kind !== "graveyard-card") return state;
      const player = playerAt(state, target.seat);
      const card = player.graveyard.find((candidate) => candidate.instance_id === target.instanceId);
      if (!card || !cardProfile(card).isPermanent) return state;
      return withPlayer(state, target.seat, (current) => ({
        ...current,
        graveyard: current.graveyard.filter((candidate) => candidate.instance_id !== card.instance_id),
        exile: [...current.exile, card]
      }));
    }
    case "return-target-card-to-library-bottom": {
      const target = object.targets[0];
      if (!target || target.kind !== "graveyard-card") return state;
      const player = playerAt(state, target.seat);
      const card = player.graveyard.find((candidate) => candidate.instance_id === target.instanceId);
      if (!card) return state;
      return withPlayer(state, target.seat, (current) => ({
        ...current,
        graveyard: current.graveyard.filter((candidate) => candidate.instance_id !== card.instance_id),
        library: [...current.library, card]
      }));
    }
    case "shuffle-target-card-into-library": {
      const target = object.targets[0];
      if (!target || target.kind !== "graveyard-card") return state;
      const player = playerAt(state, target.seat);
      const card = player.graveyard.find((candidate) => candidate.instance_id === target.instanceId);
      if (!card) return state;
      const shuffled = shuffle([...player.library, card], state.rngState);
      const next = withPlayer(state, target.seat, (current) => ({
        ...current,
        graveyard: current.graveyard.filter((candidate) => candidate.instance_id !== card.instance_id),
        library: shuffled.items
      }));
      return { ...next, rngState: shuffled.state };
    }
    case "shuffle-source-into-library": {
      const owner = playerAt(state, object.card.owner);
      const shuffled = shuffle([...owner.library, object.card], state.rngState);
      return {
        ...withPlayer(state, object.card.owner, (current) => ({ ...current, library: shuffled.items })),
        rngState: shuffled.state
      };
    }
    case "untap-equipped-creature": {
      const equipment = findPermanent(state, object.sourcePermanentId ?? object.card.instance_id);
      const attachedId = equipment?.attachedTo;
      if (!attachedId) return state;
      return withPlayer(state, equipment.controller, (player) => ({
        ...player,
        battlefield: player.battlefield.map((permanent) =>
          permanent.instance_id === attachedId ? { ...permanent, tapped: false } : permanent)
      }));
    }
    case "untap-all-other-creatures-you-control": {
      const equipment = findPermanent(state, object.sourcePermanentId ?? object.card.instance_id);
      const attachedId = equipment?.attachedTo;
      return withPlayer(state, controller, (player) => ({
        ...player,
        battlefield: player.battlefield.map((permanent) =>
          permanent.instance_id !== attachedId && isCreature(cardProfile(permanent.card))
            ? { ...permanent, tapped: false } : permanent)
      }));
    }
    case "tap-all-creatures-target-player": {
      const target = object.targets[0];
      if (!target || target.kind !== "player") return state;
      const ids = playerAt(state, target.seat).battlefield
        .filter((permanent) => isCreature(cardProfile(permanent.card)))
        .map((permanent) => permanent.instance_id);
      const next = withPlayer(state, target.seat, (player) => ({
        ...player,
        battlefield: player.battlefield.map((permanent) =>
          ids.includes(permanent.instance_id) ? { ...permanent, tapped: true } : permanent)
      }));
      return raiseTapEvents(next, state, ids);
    }
    case "destroy-all-creatures": {
      let next = state;
      for (const permanent of allPermanents(state)) {
        if (!isCreature(cardProfile(permanent.card))) continue;
        if (effect.tappedOnly && !permanent.tapped) continue;
        next = destroyPermanent(next, permanent);
      }
      return logged(next, controller, `${sourceName} destruye ${effect.tappedOnly ? "las criaturas giradas" : "todas las criaturas"}.`);
    }
    case "destroy-all-creatures-draw-destroyed": {
      const destroyed = allPermanents(state).filter((permanent) => isCreature(cardProfile(permanent.card))
        && !keywordOf(state, permanent, "indestructible"));
      let next = state;
      for (const permanent of destroyed) next = destroyPermanent(next, permanent);
      next = drawCards(next, controller, destroyed.length);
      return logged(next, controller, `${sourceName} destruye ${destroyed.length} criatura(s) y roba ${destroyed.length}.`);
    }
    case "destroy-all-artifacts-creatures-enchantments": {
      let next = state;
      for (const permanent of allPermanents(state)) {
        const profile = cardProfile(permanent.card);
        const affected = profile.types.some((type) => ["Artifact", "Creature", "Enchantment"].includes(type));
        if (!affected) continue;
        next = destroyPermanent(next, permanent);
      }
      return logged(next, controller, `${sourceName} destruye artifacts, criaturas y encantamientos.`);
    }
    case "counter-target-spell": {
      const target = object.targets[0];
      if (!target || target.kind !== "spell") return state;
      return { ...state, stack: state.stack.map((entry) => (entry.id === target.stackId ? { ...entry, countered: true } : entry)) };
    }
    case "counter-target-spell-with-delayed-draw": {
      const target = object.targets[0];
      if (!target || target.kind !== "spell") return state;
      const targetSpell = state.stack.find((entry) => entry.id === target.stackId);
      if (!targetSpell) return state;
      const triggerAtTurn = state.turn + 1;
      const targetName = targetSpell.card.name;
      const delayedDraws: readonly DelayedDraw[] = [
        {
          id: `${object.id}:target-draw`, triggerAtTurn, seat: targetSpell.controller, sourceCard: object.card,
          amount: effect.targetAmount, optional: true,
          sourceText: `${targetName}'s controller may draw up to ${effect.targetAmount} cards at the beginning of the next turn's upkeep.`
        },
        {
          id: `${object.id}:caster-draw`, triggerAtTurn, seat: controller, sourceCard: object.card,
          amount: effect.casterAmount, optional: false,
          sourceText: `You draw ${effect.casterAmount} card${effect.casterAmount === 1 ? "" : "s"} at the beginning of the next turn's upkeep.`
        }
      ];
      return {
        ...state,
        stack: state.stack.map((entry) => (entry.id === target.stackId ? { ...entry, countered: true } : entry)),
        delayedDraws: [...state.delayedDraws, ...delayedDraws]
      };
    }
    case "counter-target-spell-to-battlefield": {
      const target = object.targets[0];
      if (!target || target.kind !== "spell") return state;
      return { ...state, stack: state.stack.map((entry) => (entry.id === target.stackId
        ? { ...entry, countered: true, counteredToBattlefieldController: controller }
        : entry)) };
    }
    case "add-counter-source": {
      const sourceId = object.trigger?.sourcePermanentId ?? object.sourcePermanentId ?? object.card.instance_id;
      const source = findPermanent(state, sourceId);
      if (!source) return state;
      return withPlayer(state, source.controller, (player) => ({
        ...player,
        battlefield: player.battlefield.map((permanent) => permanent.instance_id === source.instance_id
          ? { ...permanent, counters: { ...permanent.counters, [effect.counter]: (permanent.counters[effect.counter] ?? 0) + effect.amount } }
          : permanent)
      }));
    }
    case "add-counter-creatures-subtype": {
      const subtype = effect.subtype.toLowerCase();
      return withPlayer(state, controller, (player) => ({
        ...player,
        battlefield: player.battlefield.map((permanent) => {
          const profile = cardProfile(permanent.card);
          if (!isCreature(profile) || !hasSubtype(profile, subtype)) return permanent;
          return { ...permanent, counters: { ...permanent.counters, [effect.counter]: (permanent.counters[effect.counter] ?? 0) + effect.amount } };
        })
      }));
    }
    case "add-counter-creatures-you-control": {
      return withPlayer(state, controller, (player) => ({
        ...player,
        battlefield: player.battlefield.map((permanent) => isCreature(cardProfile(permanent.card))
          ? { ...permanent, counters: { ...permanent.counters, [effect.counter]: (permanent.counters[effect.counter] ?? 0) + effect.amount } }
          : permanent)
      }));
    }
    case "level-up": {
      const source = findPermanent(state, object.sourcePermanentId ?? object.card.instance_id);
      if (!source || source.controller !== controller || !isCreature(cardProfile(source.card))) return state;
      return withPlayer(state, controller, (player) => ({
        ...player,
        battlefield: player.battlefield.map((permanent) => permanent.instance_id === source.instance_id
          ? { ...permanent, counters: { ...permanent.counters, level: (permanent.counters.level ?? 0) + 1 } }
          : permanent)
      }));
    }
    case "tap-target-permanent": {
      const target = object.targets[0];
      if (!target || target.kind !== "permanent") return state;
      const permanent = findPermanent(state, target.instanceId);
      if (!permanent || permanent.tapped) return state;
      const next = withPlayer(state, permanent.controller, (player) => ({
        ...player,
        battlefield: player.battlefield.map((candidate) => candidate.instance_id === permanent.instance_id
          ? { ...candidate, tapped: true } : candidate)
      }));
      return raiseTapEvents(next, state, [permanent.instance_id]);
    }
    case "target-cant-block": {
      const target = object.targets[0];
      if (!target || target.kind !== "permanent") return state;
      const permanent = findPermanent(state, target.instanceId);
      if (!permanent) return state;
      return withPlayer(state, permanent.controller, (player) => ({
        ...player,
        battlefield: player.battlefield.map((candidate) => candidate.instance_id === permanent.instance_id
          ? { ...candidate, cantBlockThisTurn: true } : candidate)
      }));
    }
    case "untap-target-permanent": {
      const target = object.targets[0];
      if (!target || target.kind !== "permanent") return state;
      const permanent = findPermanent(state, target.instanceId);
      if (!permanent) return state;
      return withPlayer(state, permanent.controller, (player) => ({
        ...player,
        battlefield: player.battlefield.map((candidate) => candidate.instance_id === permanent.instance_id
          ? { ...candidate, tapped: false } : candidate)
      }));
    }
    case "untap-source": {
      const sourceId = object.sourcePermanentId ?? object.trigger?.sourcePermanentId;
      const source = sourceId ? findPermanent(state, sourceId) : undefined;
      if (!source) return state;
      return withPlayer(state, source.controller, (player) => ({
        ...player,
        battlefield: player.battlefield.map((candidate) => candidate.instance_id === source.instance_id
          ? { ...candidate, tapped: false } : candidate)
      }));
    }
    case "reveal-top-card-conditional": {
      const player = playerAt(state, controller);
      const card = player.library[0];
      if (!card) return logged(state, controller, `${player.name} revela la biblioteca vacía.`);
      let next = withPlayer(state, controller, (current) => ({ ...current, library: current.library.slice(1) }));
      next = logged(next, controller, `${player.name} revela ${card.name}.`);
      const profile = cardProfile(card);
      if (isCreature(profile)) {
        return applyEffect(next, object, { kind: "create-token", amount: 1, token: effect.creatureToken });
      }
      if (isLand(profile)) return putOntoBattlefield(next, controller, card, false);
      return applyEffect(next, object, { kind: "gain-life", amount: effect.fallbackLife });
    }
    case "reveal-top-card-to-hand-and-gain-mana-value": {
      const player = playerAt(state, controller);
      const card = player.library[0];
      if (!card) return logged(state, controller, `${player.name} revela la biblioteca vacía.`);
      let next = withPlayer(state, controller, (current) => ({
        ...current,
        library: current.library.slice(1),
        hand: [...current.hand, card]
      }));
      next = logged(next, controller, `${player.name} revela ${card.name} y la pone en su mano.`);
      const amount = cardProfile(card).manaValue;
      if (amount <= 0 || playersCantGainLife(next)) return next;
      next = withPlayer(next, controller, (current) => ({ ...current, life: current.life + amount }));
      return logged(raiseEvent(next, { kind: "life-gained", seat: controller, amount }), controller,
        `${playerAt(next, controller).name} gana ${amount} vidas.`);
    }
    case "create-token": {
      const amount = effect.amount === "lands-you-control"
        ? playerAt(state, controller).battlefield.filter((permanent) => isLand(cardProfile(permanent.card))).length
        : effect.amount === "creatures-you-control"
          ? playerAt(state, controller).battlefield.filter((permanent) => isCreature(cardProfile(permanent.card))).length
        : effectAmount(effect.amount, object);
      let next = state;
      for (let index = 0; index < amount; index += 1) {
        const token: GameCard = {
          scryfall_id: `token:${object.id}:${index}`,
          instance_id: `token:${object.id}:${index}`,
          owner: controller,
          token: true,
          name: effect.token.name,
          type_line: effect.token.typeLine,
          mana_cost: "",
          cmc: 0,
          oracle_text: effect.token.keywords.join(", "),
          power: effect.token.power === null ? null : String(effect.token.power),
          toughness: effect.token.toughness === null ? null : String(effect.token.toughness),
          colors: effect.token.colors,
          keywords: effect.token.keywords
        };
        next = putOntoBattlefield(next, controller, token, false, effect.token.tapped);
      }
      return logged(next, controller, `${playerAt(next, controller).name} crea ${amount} ${effect.token.name}${amount === 1 ? "" : "s"}.`);
    }
    case "search-library":
      // Search is resolved through the explicit library-choice action below.
      return state;
    case "search-library-multi":
      // Multi-card searches are completed through the explicit choice action below.
      return state;
    case "scry":
      // Scry is completed through the private top-card choice below.
      return state;
    case "attach-equipment": {
      const target = object.targets[0];
      if (!target || target.kind !== "permanent") return state;
      const equipment = findPermanent(state, object.sourcePermanentId ?? object.card.instance_id);
      const creature = findPermanent(state, target.instanceId);
      if (!equipment || !creature || equipment.controller !== controller
        || !cardProfile(equipment.card).subtypes.some((subtype) => subtype.toLowerCase() === "equipment")
        || !isCreature(cardProfile(creature.card))) return state;
      const legal = legalTargets(state, controller, "creature-you-control")
        .some((candidate) => candidate.kind === "permanent" && candidate.instanceId === creature.instance_id);
      if (!legal) return state;
      const next = withPlayer(state, equipment.controller, (player) => ({
        ...player,
        battlefield: player.battlefield.map((permanent) =>
          permanent.instance_id === equipment.instance_id ? { ...permanent, attachedTo: creature.instance_id } : permanent)
      }));
      return logged(next, controller, `${equipment.card.name} se anexa a ${creature.card.name}.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Stack resolution
// ---------------------------------------------------------------------------

function sendSpellToOwnerZone(state: GameState, object: StackObject): GameState {
  return withPlayer(state, object.card.owner, (player) => object.flashback
    ? { ...player, exile: [...player.exile, object.card] }
    : { ...player, graveyard: [...player.graveyard, object.card] });
}

function hasSelfShuffle(effect: SpellEffect): boolean {
  return effect.kind === "shuffle-source-into-library"
    || (effect.kind === "compound" && effect.effects.some(hasSelfShuffle));
}

function beginScry(
  state: GameState,
  seat: SeatId,
  sourceId: string,
  sourceCard: GameCard,
  amount: number,
  returnSourceToGraveyard: boolean,
  exileSourceAfterResolution: boolean,
  thenDraw = 0
): GameState {
  if (amount <= 0) return state;
  const topCard = playerAt(state, seat).library[0];
  if (!topCard) {
    let next = state;
    if (thenDraw > 0) next = drawCards(next, seat, thenDraw);
    if (!returnSourceToGraveyard) return next;
    return withPlayer(next, sourceCard.owner, (player) => exileSourceAfterResolution
      ? { ...player, exile: [...player.exile, sourceCard] }
      : { ...player, graveyard: [...player.graveyard, sourceCard] });
  }
  return {
    ...state,
    pendingChoice: {
      type: "scry",
      seat,
      sourceId,
      sourceCard,
      remainingCards: playerAt(state, seat).library.slice(0, amount),
      topCards: [],
      bottomCards: [],
      thenDraw,
      returnSourceToGraveyard,
      exileSourceAfterResolution
    }
  };
}

function resolveTop(state: GameState): GameState {
  const object = state.stack.at(-1);
  if (!object) return state;
  let next: GameState = { ...state, stack: state.stack.slice(0, -1) };
  const profile = cardProfile(object.card);

  if (object.countered) {
    if (object.trigger) return logged(next, object.controller, `Se contrarresta la habilidad disparada de ${object.card.name}.`);
    if (object.activated) return logged(next, object.controller, `Se contrarresta la habilidad activada de ${object.card.name}.`);
    if (object.counteredToBattlefieldController !== undefined
      && profile.isPermanent && (isArtifact(profile) || isCreature(profile))) {
      const entered = putOntoBattlefield(next, object.counteredToBattlefieldController, object.card, false);
      return logged(entered, object.counteredToBattlefieldController, `${object.card.name} entra al campo de batalla bajo su control.`);
    }
    next = sendSpellToOwnerZone(next, object);
    return logged(next, object.controller, `${object.card.name} es contrarrestado.`);
  }

  // A target that left the battlefield makes the spell fizzle (rule 608.2b).
  const targetsGone = object.targets.some((target) =>
    (target.kind === "permanent" && !findPermanent(next, target.instanceId)) ||
    (target.kind === "graveyard-card" && !playerAt(next, target.seat).graveyard.some((card) => card.instance_id === target.instanceId)) ||
    (target.kind === "spell" && !next.stack.some((entry) => entry.id === target.stackId)) ||
    (target.kind === "player" && playerAt(next, target.seat).lost));
  if (object.targets.length && targetsGone) {
    if (object.trigger) return logged(next, object.controller, `La habilidad de ${object.card.name} no se resuelve: su objetivo ya no es legal.`);
    if (object.activated) return logged(next, object.controller, `La habilidad activada de ${object.card.name} no se resuelve: su objetivo ya no es legal.`);
    next = sendSpellToOwnerZone(next, object);
    return logged(next, object.controller, `${object.card.name} se contrarresta: sus objetivos ya no son legales.`);
  }

  if (object.trigger) {
    const triggerScry = object.trigger.definition.effect.kind === "scry" ? object.trigger.definition.effect : null;
    if (triggerScry) return beginScry(next, object.controller, object.trigger.id, object.trigger.sourceCard, triggerScry.amount, false, false, triggerScry.thenDraw ?? 0);
    if (object.trigger.definition.drawUpTo !== undefined) {
      return {
        ...next,
        pendingChoice: {
          type: "draw-cards",
          seat: object.controller,
          sourceId: object.trigger.id,
          sourceCard: object.trigger.sourceCard,
          maxAmount: object.trigger.definition.drawUpTo
        }
      };
    }
    if (object.trigger.definition.optional) {
      const payer = object.trigger.definition.paymentBy === "opponent"
        ? (object.trigger.eventController ?? opponentsOf(next, object.controller)[0] ?? object.controller)
        : object.controller;
      const choiceSeat = object.trigger.definition.choiceBy === "event-controller"
        ? (object.trigger.eventController ?? object.controller)
        : payer;
      return {
        ...next,
        pendingChoice: {
          type: "optional-trigger",
          seat: choiceSeat,
          sourceId: object.trigger.id,
          triggerEffect: object.trigger.definition.effect,
          sourceCard: object.trigger.sourceCard,
          ...(object.trigger.definition.payCost ? { payCost: object.trigger.definition.payCost } : {}),
          ...(object.trigger.definition.unlessPayCost ? { payCost: object.trigger.definition.unlessPayCost, unlessPayCost: object.trigger.definition.unlessPayCost } : {}),
          targets: object.targets,
          sourcePermanentId: object.trigger.sourcePermanentId,
          sourceController: object.controller,
          ...(object.trigger.definition.paymentBy ? { paymentBy: object.trigger.definition.paymentBy } : {}),
          ...(object.trigger.definition.manaCost ? { manaCost: object.trigger.definition.manaCost } : {})
        }
      };
    }
    const nextEffect = applyEffect(next, object, object.trigger.definition.effect);
    return logged(nextEffect, object.controller,
      `Se resuelve la ${TRIGGER_EVENT_LABELS[object.trigger.definition.event]} de ${object.card.name}.`);
  }

  const activatedEffect = object.activated?.effect;
  const selectedEffect = object.selectedEffect;
  const scry = profile.effects.find((effect): effect is Extract<SpellEffect, { kind: "scry" }> => effect.kind === "scry");
  if (scry) {
    // Resolve sibling instructions before opening the private Scry choice;
    // otherwise an early return would silently drop text such as "then draw"
    // or "you lose life" on the same spell (CR 608.2c).
    for (const effect of profile.effects) {
      if (effect.kind !== "scry") next = applyEffect(next, object, effect);
    }
    return beginScry(next, object.controller, object.id, object.card, scry.amount, !object.activated, Boolean(object.flashback), scry.thenDraw ?? 0);
  }
  const search = activatedEffect?.kind === "search-library"
    ? activatedEffect
    : selectedEffect?.kind === "search-library"
      ? selectedEffect
      : profile.effects.find((effect): effect is Extract<SpellEffect, { kind: "search-library" }> => effect.kind === "search-library");
  if (search) {
    const options = playerAt(next, object.controller).library
      .filter((card) => {
        const profile = cardProfile(card);
        const typeMatches = !search.types.length || search.types.some((type) => profile.types.includes(type));
        const subtypeMatches = !search.subtypes?.length || search.subtypes.some((subtype) =>
          subtype.toLowerCase() === "basic" ? profile.supertypes.some((value) => value.toLowerCase() === "basic")
            : hasSubtype(profile, subtype));
        return typeMatches && subtypeMatches;
      })
      .map((card) => card.instance_id);
    if (!options.length) {
      if (!object.activated) next = sendSpellToOwnerZone(next, object);
      return logged(next, object.controller, `${object.card.name} se resuelve: no hay una carta válida en la biblioteca.`);
    }
    return {
      ...next,
      pendingChoice: {
        type: "search-library",
        seat: object.controller,
        sourceId: object.id,
        optionIds: options,
        sourceCard: object.card,
        search,
        returnSourceToGraveyard: !object.activated,
        exileSourceAfterResolution: Boolean(object.flashback)
      }
    };
  }

  const multiSearch = activatedEffect?.kind === "search-library-multi"
    ? activatedEffect
    : profile.effects.find((effect): effect is Extract<SpellEffect, { kind: "search-library-multi" }> => effect.kind === "search-library-multi");
  if (multiSearch) {
    const options = playerAt(next, object.controller).library
      .filter((card) => {
        const candidate = cardProfile(card);
        const typeMatches = multiSearch.types.some((type) => candidate.types.includes(type));
        const subtypeMatches = multiSearch.subtypes?.every((subtype) => subtype.toLowerCase() === "basic"
          ? candidate.supertypes.some((value) => value.toLowerCase() === "basic")
          : candidate.subtypes.some((value) => value.toLowerCase() === subtype.toLowerCase())) ?? true;
        return typeMatches && subtypeMatches;
      })
      .map((card) => card.instance_id);
    if (!options.length) {
      if (!object.activated) next = sendSpellToOwnerZone(next, object);
      return logged(next, object.controller, `${object.card.name} se resuelve: no hay tierras básicas válidas en la biblioteca.`);
    }
    return {
      ...next,
      pendingChoice: {
        type: "search-library-multi",
        seat: object.controller,
        sourceId: object.id,
        optionIds: options,
        selectedIds: [],
        sourceCard: object.card,
        search: multiSearch,
        returnSourceToGraveyard: !object.activated,
        exileSourceAfterResolution: Boolean(object.flashback)
      }
    };
  }

  if (activatedEffect) {
    const resolved = applyEffect(next, object, activatedEffect);
    return logged(resolved, object.controller, `Se resuelve la habilidad activada de ${object.card.name}.`);
  }

  if (selectedEffect) {
    const resolved = applyEffect(next, object, selectedEffect);
    next = logged(resolved, object.controller, `Se resuelve el modo elegido de ${object.card.name}.`);
    return sendSpellToOwnerZone(next, object);
  }

  if (profile.isPermanent) {
    next = putOntoBattlefield(next, object.controller, object.card, object.fromCommandZone || playerAt(next, object.card.owner).commanderIds.includes(object.card.instance_id), false, Boolean(object.kicked), Boolean(object.evoked));
    next = logged(next, object.controller, `${playerAt(next, object.controller).name} resuelve ${object.card.name} al campo de batalla.`);
    return next;
  }

  for (const effect of profile.effects) next = applyEffect(next, object, effect);
  if (object.kicked) for (const effect of profile.kickedEffects) next = applyEffect(next, object, effect);
  if (!profile.effects.length && !(object.kicked && profile.kickedEffects.length)) {
    next = logged(next, object.controller, `${object.card.name} se resuelve sin efecto: su texto todavía no está implementado.`);
  }
  // A spell that explicitly shuffles itself has already moved through its
  // effect (CR 701.20); do not send that same object to the graveyard.
  if (profile.effects.some(hasSelfShuffle)) {
    return logged(next, object.controller, `${object.card.name} se baraja en la biblioteca de su propietario.`);
  }
  const retire = profile.effects.find((effect) => effect.kind === "exile-self" || effect.kind === "shuffle-self-into-library");
  if (retire?.kind === "exile-self") {
    return withPlayer(next, object.card.owner, (player) => ({ ...player, exile: [...player.exile, object.card] }));
  }
  if (retire?.kind === "shuffle-self-into-library") {
    const shuffled = shuffle([...playerAt(next, object.card.owner).library, object.card], next.rngState);
    return withPlayer({ ...next, rngState: shuffled.state }, object.card.owner, (player) => ({ ...player, library: shuffled.items }));
  }
  return sendSpellToOwnerZone(next, object);
}

// ---------------------------------------------------------------------------
// State-based actions
// ---------------------------------------------------------------------------

function applyStateBasedActions(state: GameState): GameState {
  let next = state;
  let changed = true;
  let guard = 0;
  while (changed && guard < 32) {
    changed = false;
    guard += 1;

    // Rule 704.5q: an Equipment becomes unattached when its equipped object
    // leaves the battlefield or is no longer a creature.
    for (const equipment of allPermanents(next)) {
      if (equipment.attachedTo === undefined) continue;
      const target = findPermanent(next, equipment.attachedTo);
      if (target && isCreature(cardProfile(target.card))) continue;
      next = withPlayer(next, equipment.controller, (player) => ({
        ...player,
        battlefield: player.battlefield.map((permanent) => {
          if (permanent.instance_id !== equipment.instance_id) return permanent;
          const { attachedTo: _attachedTo, ...unattached } = permanent;
          return unattached;
        })
      }));
      changed = true;
    }

    // Rule 704.5i: a planeswalker with 0 loyalty is put into its owner's graveyard.
    for (const permanent of allPermanents(next)) {
      const profile = cardProfile(permanent.card);
      if (!profile.types.includes("Planeswalker") || !("loyalty" in permanent.counters)) continue;
      if ((permanent.counters.loyalty ?? 0) > 0) continue;
      next = movePermanentToZone(next, permanent, "graveyard");
      changed = true;
    }

    for (const permanent of allPermanents(next)) {
      const profile = cardProfile(permanent.card);
      if (!isCreature(profile)) continue;
      const toughness = toughnessOf(permanent, next);
      const lethal = toughness <= 0 || (permanent.damage > 0 && permanent.damage >= toughness) || permanent.deathtouched;
      if (!lethal) continue;
      next = destroyPermanent(next, permanent);
      changed = true;
    }

    // Legend rule: a player keeps only the first copy of a legendary permanent.
    for (const player of next.players) {
      const seen = new Set<string>();
      for (const permanent of player.battlefield) {
        const profile = cardProfile(permanent.card);
        if (!profile.supertypes.includes("Legendary")) continue;
        if (seen.has(permanent.card.name)) {
          next = movePermanentToZone(next, permanent, "graveyard");
          next = logged(next, player.seat, `Regla de legendarios: ${permanent.card.name} va al cementerio.`);
          changed = true;
        } else seen.add(permanent.card.name);
      }
    }

    for (const player of next.players) {
      if (player.lost) continue;
      const lethalCommander = Object.entries(player.commanderDamage).find(([, amount]) => amount >= 21);
      const reason = player.life <= 0
        ? "vidas a 0"
        : player.drewFromEmptyLibrary
          ? "robó de una biblioteca vacía"
          : lethalCommander
            ? "21 de daño de comandante"
            : null;
      if (!reason) continue;
      next = withPlayer(next, player.seat, (current) => ({ ...current, lost: true, lossReason: reason }));
      next = logged(next, player.seat, `${player.name} pierde la partida (${reason}).`);
      changed = true;
    }
  }

  const alive = livingSeats(next);
  if (!next.finished && alive.length <= 1) {
    const winner = alive[0] ?? null;
    next = { ...next, finished: true, winnerSeat: winner };
    next = logged(next, winner, winner === null ? "La partida termina en empate." : `${playerAt(next, winner).name} gana la partida.`);
  }
  return next;
}

/** Removes permanents that left the battlefield from the current combat. */
function pruneCombat(state: GameState): GameState {
  const present = new Set(allPermanents(state).map((permanent) => permanent.instance_id));
  const attackers = state.combat.attackers.filter((entry) => present.has(entry.instanceId) && !playerAt(state, entry.defender).lost);
  const attackerIds = new Set(attackers.map((entry) => entry.instanceId));
  const blockers = state.combat.blockers.filter((entry) => present.has(entry.instanceId) && attackerIds.has(entry.attackerId));
  if (attackers.length === state.combat.attackers.length && blockers.length === state.combat.blockers.length) return state;
  return { ...state, combat: { ...state.combat, attackers, blockers } };
}

// ---------------------------------------------------------------------------
// Combat
// ---------------------------------------------------------------------------

function canAttack(state: GameState, permanent: Permanent): boolean {
  const profile = cardProfile(permanent.card);
  if (!isCreature(profile)) return false;
  if (permanent.tapped) return false;
  if (profile.keywords.includes("defender")) return false;
  // A printed "can't attack" is the same restriction as defender (CR 506.3a).
  if (profile.combatRules.cannotAttack) return false;
  if (permanent.summoningSick && !keywordOf(state, permanent, "haste")) return false;
  return true;
}

/**
 * Creatures that must be declared as attackers this combat (CR 508.1d).
 *
 * "Attacks each combat if able" is a requirement, not a restriction: the
 * declaration is illegal unless it includes every such creature that could
 * legally attack.
 */
function requiredAttackers(state: GameState, seat: SeatId): Permanent[] {
  return playerAt(state, seat).battlefield.filter((permanent) =>
    cardProfile(permanent.card).combatRules.mustAttack && canAttack(state, permanent));
}

/** The tightest defender-controlled attacker limit (CR 508.1d). */
export function maxAttackersForDefender(state: GameState, defenderSeat: SeatId): number | null {
  const limits = playerAt(state, defenderSeat).battlefield
    .map((permanent) => cardProfile(permanent.card).combatRules.maxAttackers)
    .filter((limit): limit is number => limit !== null);
  return limits.length ? Math.min(...limits) : null;
}

/** True while the defending player controls a land matching the attacker's landwalk. */
function landwalkEvades(state: GameState, attacker: Permanent, defenderSeat: SeatId): boolean {
  const walks = cardProfile(attacker.card).combatRules.landwalk;
  if (!walks.length) return false;
  const wanted = new Set(walks.map((subtype) => subtype.toLowerCase()));
  return playerAt(state, defenderSeat).battlefield.some((permanent) => {
    const profile = cardProfile(permanent.card);
    if (!isLand(profile)) return false;
    // Rule 702.14a reads the land's subtypes, so "legendary landwalk" checks the
    // supertype list instead.
    return profile.subtypes.some((subtype) => wanted.has(subtype.toLowerCase()))
      || profile.supertypes.some((supertype) => wanted.has(supertype.toLowerCase()));
  });
}

function canBlock(state: GameState, attacker: Permanent, blocker: Permanent): boolean {
  const blockerProfile = cardProfile(blocker.card);
  if (!isCreature(blockerProfile) || blocker.tapped) return false;
  if (blockerProfile.combatRules.cannotBlock || blocker.cantBlockThisTurn) return false;
  const attackerProfile = cardProfile(attacker.card);
  if (attackerProfile.combatRules.cannotBeBlocked) return false;
  if (keywordOf(state, attacker, "flying") && !keywordOf(state, blocker, "flying") && !keywordOf(state, blocker, "reach")) return false;
  if (keywordOf(state, attacker, "fear") && !blockerProfile.colors.includes("B") && !blockerProfile.types.includes("Artifact")) return false;
  if (keywordOf(state, attacker, "intimidate") && !blockerProfile.types.includes("Artifact")
    && !attackerProfile.colors.some((color) => blockerProfile.colors.includes(color))) return false;
  // "Can block only creatures with X" is an evasion check read from the blocker.
  const only = blockerProfile.combatRules.blocksOnlyWithKeyword;
  if (only && !keywordOf(state, attacker, only)) return false;
  if (landwalkEvades(state, attacker, blocker.controller)) return false;
  return true;
}

export function legalAttackers(state: GameState, seat: SeatId): Permanent[] {
  return playerAt(state, seat).battlefield.filter((permanent) => canAttack(state, permanent));
}

export function legalBlockers(state: GameState, seat: SeatId): Permanent[] {
  const attackers = state.combat.attackers.filter((entry) => entry.defender === seat);
  if (!attackers.length) return [];
  return playerAt(state, seat).battlefield.filter((blocker) =>
    attackers.some((entry) => {
      const attacker = findPermanent(state, entry.instanceId);
      return attacker ? canBlock(state, attacker, blocker) : false;
    }));
}

/** Seats that must still declare blockers this combat. */
export function defendersAwaitingBlocks(state: GameState): SeatId[] {
  if (state.step !== "declare-blockers" || state.combat.blockersDeclared) return [];
  const defenders = new Set(state.combat.attackers.map((entry) => entry.defender));
  return [...defenders].filter((seat) => !playerAt(state, seat).lost);
}

function tapAttackers(state: GameState, attackers: readonly AttackerDeclaration[]): GameState {
  const before = state;
  const ids = new Set(attackers.filter((entry) => {
    const permanent = findPermanent(state, entry.instanceId);
    return permanent ? !keywordOf(state, permanent, "vigilance") : false;
  }).map((entry) => entry.instanceId));
  if (!ids.size) return state;
  const tappedState: GameState = {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      battlefield: player.battlefield.map((permanent) => (ids.has(permanent.instance_id) ? { ...permanent, tapped: true } : permanent))
    }))
  };
  return raiseTapEvents(tappedState, before, ids);
}

function dealsDamageInStep(state: GameState, permanent: Permanent, firstStrikeStep: boolean): boolean {
  const first = keywordOf(state, permanent, "first strike");
  const double = keywordOf(state, permanent, "double strike");
  return firstStrikeStep ? first || double : double || (!first && !double);
}

function needsFirstStrikeStep(state: GameState): boolean {
  const combatants = [
    ...state.combat.attackers.map((entry) => findPermanent(state, entry.instanceId)),
    ...state.combat.blockers.map((entry) => findPermanent(state, entry.instanceId))
  ].filter((permanent): permanent is Permanent => permanent !== null);
  return combatants.some((permanent) => keywordOf(state, permanent, "first strike") || keywordOf(state, permanent, "double strike"));
}

interface DamageBatch { readonly toPlayers: { seat: SeatId; amount: number; commanderId?: string; sourceName: string; sourceId: string }[]; readonly toPermanents: { instanceId: string; amount: number; deathtouch: boolean; sourceName: string }[]; readonly lifelink: { seat: SeatId; amount: number }[] }

function computeCombatDamage(state: GameState, firstStrikeStep: boolean): DamageBatch {
  const toPlayers: DamageBatch["toPlayers"] = [];
  const toPermanents: DamageBatch["toPermanents"] = [];
  const lifelink: DamageBatch["lifelink"] = [];

  for (const entry of state.combat.attackers) {
    const attacker = findPermanent(state, entry.instanceId);
    if (!attacker || !dealsDamageInStep(state, attacker, firstStrikeStep)) continue;
    const power = powerOf(attacker, state);
    if (power <= 0) continue;
    const deathtouch = keywordOf(state, attacker, "deathtouch");
    const blockers = state.combat.blockers
      .filter((block) => block.attackerId === entry.instanceId)
      .map((block) => findPermanent(state, block.instanceId))
      .filter((permanent): permanent is Permanent => permanent !== null);

    if (!blockers.length) {
      const wasBlocked = state.combat.blockers.some((block) => block.attackerId === entry.instanceId);
      // A creature whose blockers all left combat deals no damage unless it was never blocked.
      if (wasBlocked) continue;
      toPlayers.push({
        seat: entry.defender,
        amount: power,
        ...(attacker.isCommander ? { commanderId: attacker.instance_id } : {}),
        sourceName: attacker.card.name,
        sourceId: attacker.instance_id
      });
      if (keywordOf(state, attacker, "lifelink")) lifelink.push({ seat: attacker.controller, amount: power });
      continue;
    }

    // Damage is assigned in blocker order: lethal to each, then trample to the player.
    let remaining = power;
    for (const blocker of blockers) {
      if (remaining <= 0) break;
      const lethal = deathtouch ? 1 : Math.max(1, toughnessOf(blocker, state) - blocker.damage);
      const assigned = Math.min(remaining, lethal);
      toPermanents.push({ instanceId: blocker.instance_id, amount: assigned, deathtouch, sourceName: attacker.card.name });
      if (keywordOf(state, attacker, "lifelink")) lifelink.push({ seat: attacker.controller, amount: assigned });
      remaining -= assigned;
    }
    if (remaining > 0 && keywordOf(state, attacker, "trample")) {
      toPlayers.push({
        seat: entry.defender,
        amount: remaining,
        ...(attacker.isCommander ? { commanderId: attacker.instance_id } : {}),
        sourceName: attacker.card.name,
        sourceId: attacker.instance_id
      });
      if (keywordOf(state, attacker, "lifelink")) lifelink.push({ seat: attacker.controller, amount: remaining });
    }
  }

  for (const block of state.combat.blockers) {
    const blocker = findPermanent(state, block.instanceId);
    const attacker = findPermanent(state, block.attackerId);
    if (!blocker || !attacker || !dealsDamageInStep(state, blocker, firstStrikeStep)) continue;
    const power = powerOf(blocker, state);
    if (power <= 0) continue;
    toPermanents.push({ instanceId: attacker.instance_id, amount: power, deathtouch: keywordOf(state, blocker, "deathtouch"), sourceName: blocker.card.name });
    if (keywordOf(state, blocker, "lifelink")) lifelink.push({ seat: blocker.controller, amount: power });
  }

  return { toPlayers, toPermanents, lifelink };
}

function applyCombatDamage(state: GameState, firstStrikeStep: boolean): GameState {
  const batch = computeCombatDamage(state, firstStrikeStep);
  let next = state;
  for (const hit of batch.toPermanents) next = dealDamageToPermanent(next, hit.instanceId, hit.amount, hit.deathtouch, hit.sourceName);
  for (const hit of batch.toPlayers) {
    next = dealDamageToPlayer(next, hit.seat, hit.amount, hit.sourceName);
    const dealer = findPermanent(next, hit.sourceId);
    if (dealer && hit.amount > 0) {
      next = raiseEvent(next, {
        kind: "deals-combat-damage-to-player",
        permanentId: dealer.instance_id, controller: dealer.controller, card: dealer.card, victim: hit.seat
      });
    }
    if (hit.commanderId) {
      const commanderId = hit.commanderId;
      next = withPlayer(next, hit.seat, (player) => ({
        ...player,
        commanderDamage: { ...player.commanderDamage, [commanderId]: (player.commanderDamage[commanderId] ?? 0) + hit.amount }
      }));
    }
  }
  for (const gain of batch.lifelink) {
    next = withPlayer(next, gain.seat, (player) => ({ ...player, life: player.life + gain.amount }));
    next = raiseEvent(next, { kind: "life-gained", seat: gain.seat, amount: gain.amount });
    next = logged(next, gain.seat, `${playerAt(next, gain.seat).name} gana ${gain.amount} vidas por vínculo vital.`);
  }
  return next;
}

// ---------------------------------------------------------------------------
// Turn-based actions and step progression
// ---------------------------------------------------------------------------

function emptyManaPools(state: GameState): GameState {
  if (state.players.every((player) => poolTotal(player.manaPool) === 0)) return state;
  return { ...state, players: state.players.map((player) => ({ ...player, manaPool: emptyPool() })) };
}

function queueDelayedDraws(state: GameState): GameState {
  const due = state.delayedDraws.filter((delayed) => delayed.triggerAtTurn === state.turn);
  if (!due.length) return state;
  const remaining = state.delayedDraws.filter((delayed) => delayed.triggerAtTurn !== state.turn);
  const triggers: TriggerInstance[] = due.map((delayed) => ({
    id: delayed.id,
    controller: delayed.seat,
    sourcePermanentId: `delayed:${delayed.id}`,
    sourceCard: delayed.sourceCard,
    definition: {
      event: "upkeep",
      subject: "you",
      effect: { kind: "draw", amount: delayed.amount },
      optional: delayed.optional,
      targetKind: "none",
      sourceText: delayed.sourceText,
      ...(delayed.optional ? { drawUpTo: delayed.amount } : {})
    },
    cause: `${delayed.sourceCard.name}: delayed upkeep draw`,
    eventController: delayed.seat
  }));
  return { ...state, delayedDraws: remaining, triggerQueue: [...state.triggerQueue, ...triggers] };
}

function beginStep(state: GameState, step: TurnStep): GameState {
  let next: GameState = { ...state, step, passedSeats: [], prioritySeat: state.activeSeat };
  next = emptyManaPools(next);

  switch (step) {
    case "untap": {
      next = withPlayer(next, next.activeSeat, (player) => ({
        ...player,
        landsPlayedThisTurn: 0,
        battlefield: player.battlefield.map((permanent) => ({
           ...permanent,
           tapped: cardProfile(permanent.card).doesNotUntapDuringUntap ? permanent.tapped : false,
           summoningSick: false,
           loyaltyUsedThisTurn: false
         }))
      }));
      next = { ...next, combat: { attackers: [], blockers: [], attackersDeclared: false, blockersDeclared: false, firstStrikeResolved: false, damageResolved: false } };
      next = logged(next, next.activeSeat, `Turno ${next.turn} · ${playerAt(next, next.activeSeat).name} endereza sus permanentes.`);
      break;
    }
    case "draw": {
      // The starting player skips only the very first draw step of the game.
      const isOpeningDraw = next.turn === 1 && next.activeSeat === next.startingSeat;
      if (!isOpeningDraw) next = drawCards(next, next.activeSeat, 1);
      break;
    }
    case "combat-damage": {
      if (needsFirstStrikeStep(next)) {
        next = applyCombatDamage(next, true);
        next = { ...next, combat: { ...next.combat, firstStrikeResolved: true } };
        next = applyStateBasedActions(next);
        next = pruneCombat(next);
      }
      next = applyCombatDamage(next, false);
      next = { ...next, combat: { ...next.combat, damageResolved: true } };
      break;
    }
    case "end-combat": {
      next = { ...next, combat: { ...next.combat, attackers: [], blockers: [] } };
      break;
    }
    case "cleanup": {
      const player = playerAt(next, next.activeSeat);
      const excess = player.hand.length - 7;
      if (excess > 0 && !playerHasNoMaximumHandSize(next, next.activeSeat)) {
        // Deterministic discard: the most expensive cards go first.
        const ordered = [...player.hand].sort((left, right) => (cardProfile(right).manaValue) - (cardProfile(left).manaValue));
        const discarded = ordered.slice(0, excess);
        const discardIds = new Set(discarded.map((card) => card.instance_id));
        next = withPlayer(next, next.activeSeat, (current) => ({
          ...current,
          hand: current.hand.filter((card) => !discardIds.has(card.instance_id)),
          graveyard: [...current.graveyard, ...discarded]
        }));
        next = logged(next, next.activeSeat, `${player.name} descarta ${excess} carta(s) al límite de mano.`);
      }
      next = {
        ...next,
        players: next.players.map((current) => ({
          ...current,
          battlefield: current.battlefield.map((permanent) => ({ ...permanent, damage: 0, deathtouched: false, powerModifier: 0, toughnessModifier: 0, temporaryKeywords: [], regenerationShields: 0, cantBlockThisTurn: false }))
        }))
      };
      break;
    }
    default: break;
  }

  // Turn-structure triggers are raised as the step begins, before priority
  // opens, so they are already queued when a player would first receive it.
  if (step === "upkeep") {
    next = queueDelayedDraws(next);
    next = raiseEvent(next, { kind: "upkeep", activeSeat: next.activeSeat });
  }
  if (step === "draw") next = raiseEvent(next, { kind: "draw-step", activeSeat: next.activeSeat });
  if (step === "end") next = raiseEvent(next, { kind: "end-step", activeSeat: next.activeSeat });

  const opensPriority = !NO_PRIORITY_STEPS.includes(step) && !next.finished;
  next = { ...next, priorityOpen: opensPriority };
  if (opensPriority) next = { ...next, prioritySeat: playerAt(next, next.activeSeat).lost ? nextLivingSeat(next, next.activeSeat) : next.activeSeat };
  return next;
}

function advanceStep(state: GameState): GameState {
  const index = TURN_STEPS.indexOf(state.step);
  const isLast = index === TURN_STEPS.length - 1;
  if (!isLast) return beginStep(state, TURN_STEPS[index + 1]!);
  const nextActive = nextLivingSeat(state, state.activeSeat);
  const wrapped: GameState = { ...state, activeSeat: nextActive, turn: state.turn + 1 };
  return beginStep(wrapped, "untap");
}

// ---------------------------------------------------------------------------
// Legal actions
// ---------------------------------------------------------------------------

function commanderTax(player: PlayerState, cardId: string): number {
  return 2 * (player.commanderCasts[cardId] ?? 0);
}

function sorcerySpeed(state: GameState, seat: SeatId): boolean {
  return state.activeSeat === seat && MAIN_STEPS.includes(state.step) && state.stack.length === 0;
}

/** Generic cost reduction from board-scaled self text and Medallion-style grants (CR 118.9). */
function boardCostReduction(state: GameState, seat: SeatId, card: GameCard, profile: CardProfile): number {
  let reduction = 0;
  if (profile.costReducesPerBoardCreature) {
    reduction += profile.costReducesPerBoardCreature * allPermanents(state).filter((permanent) => isCreature(cardProfile(permanent.card))).length;
  }
  const spellColors = profile.colors;
  const battlefield = allPermanents(state).filter((permanent) =>
    permanent.controller === seat || cardProfile(permanent.card).spellCostReductionGrant?.appliesToAllPlayers
  );
  for (const permanent of battlefield) {
    const grant = cardProfile(permanent.card).spellCostReductionGrant;
    if (!grant) continue;
    if (grant.color && !spellColors.includes(grant.color)) continue;
    if (grant.type && !profile.types.includes(grant.type)) continue;
    if (grant.types && !grant.types.some((type) => profile.types.includes(type))) continue;
    reduction += grant.amount;
  }
  return reduction;
}

function withKicker(cost: ManaCost, kicker: ManaCost | null): ManaCost {
  if (!kicker || !kicker.symbols.length) return cost;
  return {
    symbols: [...cost.symbols, ...kicker.symbols],
    manaValue: cost.manaValue + kicker.manaValue,
    hasVariable: cost.hasVariable || kicker.hasVariable,
    raw: cost.raw + kicker.raw
  };
}

/** The mana cost a cast actually pays, after kicker (added) or evoke (replaces base). */
function spellCostOf(profile: CardProfile, kicked: boolean, evoked: boolean): ManaCost {
  if (evoked && profile.evokeCost) return profile.evokeCost;
  return withKicker(profile.cost!, kicked ? profile.kickerCost : null);
}

function castableCard(state: GameState, seat: SeatId, card: GameCard, fromCommandZone: boolean, variableValue = 0, mode?: number, kicked = false, evoked = false, flashback = false): { legal: boolean; note?: string; targetKind?: Exclude<TargetKind, "none"> } {
  const player = playerAt(state, seat);
  const profile = cardProfile(card);
  if (splitSecondActive(state)) return { legal: false };
  const cost = flashback ? profile.flashbackCost : spellCostOf(profile, kicked, evoked);
  const lifeCost = flashback
    ? profile.flashbackLifeCost
    : profile.additionalLifeCost + (profile.additionalLifeCostVariable ? variableValue : 0);
  if (flashback && (profile.isPermanent || !profile.flashbackCost)) return { legal: false };
  if (lifeCost >= player.life) return { legal: false };
  if (!flashback && (!profile.castableFromHand || !profile.cost)) return { legal: false };
  if (!flashback && kicked && !profile.kickerCost) return { legal: false };
  if (!flashback && evoked && !profile.evokeCost) return { legal: false };
  if (!cost) return { legal: false };
  if (!Number.isInteger(variableValue) || variableValue < 0) return { legal: false, note: "El valor de X debe ser un entero no negativo." };
  const instantSpeed = profile.types.includes("Instant") || profile.keywords.includes("flash");
  if (!instantSpeed && !sorcerySpeed(state, seat)) return { legal: false };
  const additionalGeneric = (fromCommandZone ? commanderTax(player, card.instance_id) : 0)
    - (flashback ? 0 : boardCostReduction(state, seat, card, profile));
  const plan = planManaPayment(cost, player, { additionalGeneric, variableValue, state, lifeCost });
  if (!plan) return { legal: false };
  const modal = profile.modalChoices.length ? profile.modalChoices[mode ?? -1] : undefined;
  if (profile.modalChoices.length && !modal) return { legal: false };
  const targetKind = modal?.targetKind ?? profile.targetKind;
  if (targetKind !== "none" && targetKind !== "any" && !legalTargets(state, seat, targetKind).length) return { legal: false };
  if ((targetKind === "spell" || targetKind === "creature-spell" || targetKind === "noncreature-spell") && !legalTargets(state, seat, targetKind).length) return { legal: false };
  return {
    legal: true,
    ...(targetKind !== "none" ? { targetKind } : {}),
    ...(profile.fullyImplemented ? {} : { note: "Su texto todavía no está implementado; entra al juego pero no ejecuta su efecto." })
  };
}

/** Every action `seat` may legally take right now. */
export function legalActions(state: GameState, seat: SeatId): LegalAction[] {
  if (state.finished) return [];
  const player = playerAt(state, seat);
  if (player.lost) return [];
  const actions: LegalAction[] = [];

  if (state.pendingChoice) {
    if (state.pendingChoice.seat !== seat) return actions;
    const choice = state.pendingChoice;
    if (choice.type === "optional-trigger") {
      const optionalCost = choice.payCost ?? choice.manaCost;
      const canPay = !optionalCost || !optionalCost.symbols.length || Boolean(planManaPayment(optionalCost, player, { state }));
      if (canPay) {
        actions.push({
          action: { type: "choose-trigger", sourceId: choice.sourceId, accept: true },
          label: choice.paymentBy === "opponent"
            ? `Pagar ${optionalCost?.raw ?? ""} para evitar`
            : optionalCost?.symbols.length ? `Sí, pagar ${optionalCost.raw}` : "Sí, resolver habilidad",
          note: choice.paymentBy === "opponent"
            ? "Paga para evitar la habilidad."
            : "La habilidad opcional se resuelve ahora."
        });
      }
      actions.push({
        action: { type: "choose-trigger", sourceId: choice.sourceId, accept: false },
        label: "No, no hacerlo",
        note: "No eliges realizar el efecto opcional."
      });
      return actions;
    }
    if (choice.type === "trigger-target") {
      for (const option of choice.options) {
        actions.push({
          action: { type: "choose-trigger-target", sourceId: choice.sourceId, target: option },
          label: `Objetivo: ${targetLabel(state, option)}`,
          ...(option.kind === "permanent" ? { cardId: option.instanceId } : {}),
          note: `${choice.trigger.sourceCard.name}: ${choice.trigger.definition.sourceText}`
        });
      }
      return actions;
    }
    if (choice.type === "search-library") {
      actions.push({
        action: { type: "choose-library-card", sourceId: choice.sourceId, query: "" },
        label: "Elegir carta de la biblioteca",
        note: "Escribe el nombre de una carta legal de tu biblioteca. La biblioteca permanece oculta hasta la elección."
      });
      return actions;
    }
    if (choice.type === "search-library-multi") {
      actions.push({
        action: { type: "choose-library-card", sourceId: choice.sourceId, query: "" },
        label: `Elegir carta de la biblioteca (${choice.selectedIds.length}/${choice.search.destinations.length})`,
        note: "Escribe el nombre de una carta legal de tu biblioteca; puedes terminar después de elegir una o más."
      });
      actions.push({
        action: { type: "finish-library-search", sourceId: choice.sourceId },
        label: "Terminar búsqueda",
        note: "Deja de elegir cartas y baraja la biblioteca."
      });
      return actions;
    }
    if (choice.type === "scry") {
      choice.remainingCards.forEach((card, ordinal) => {
        actions.push({
          action: { type: "choose-scry", sourceId: choice.sourceId, query: card.name, bottom: false, ordinal },
          label: `Mantener ${card.name} arriba`,
          note: `${choice.sourceCard.name}: coloca esta carta arriba.`
        });
        actions.push({
          action: { type: "choose-scry", sourceId: choice.sourceId, query: card.name, bottom: true, ordinal },
          label: `Poner ${card.name} en el fondo`,
          note: `${choice.sourceCard.name}: coloca esta carta en el fondo.`
        });
      });
      return actions;
    }
    if (choice.type === "draw-cards") {
      const maxAmount = Math.min(choice.maxAmount, player.library.length);
      for (let amount = 0; amount <= maxAmount; amount += 1) {
        actions.push({
          action: { type: "choose-draw", sourceId: choice.sourceId, amount },
          label: amount === 0 ? "No robar" : `Robar ${amount} carta${amount === 1 ? "" : "s"}`,
          note: `${choice.sourceCard.name}: puedes robar hasta ${choice.maxAmount}.`
        });
      }
      return actions;
    }
    if (choice.type === "discard-cards") {
      for (const card of player.hand) {
        actions.push({
          action: { type: "choose-discard", sourceId: choice.sourceId, cardId: card.instance_id },
          label: `Discard ${card.name}`,
          cardId: card.instance_id,
          note: `${choice.sourceCard.name}: choose a card (${choice.remaining} remaining).`
        });
      }
      return actions;
    }
    if (choice.stage === "confirm") {
      actions.push({
        action: { type: "choose-reveal", sourceId: choice.sourceId, reveal: false },
        label: "No, entra girada",
        note: "No revelas una carta y la tierra entra girada."
      });
      if (choice.optionIds.length) {
        actions.push({
          action: { type: "choose-reveal", sourceId: choice.sourceId, reveal: true },
          label: "Sí, revelar una carta",
          note: "Después elegirás un tipo de tierra válido de tu mano."
        });
      }
      return actions;
    }
    for (const cardId of choice.optionIds) {
      const card = player.hand.find((candidate) => candidate.instance_id === cardId);
      if (!card) continue;
      actions.push({
        action: { type: "choose-reveal", sourceId: choice.sourceId, reveal: true, cardId },
        label: `Revelar ${card.name}`,
        cardId,
        note: "La carta se revela y permanece en tu mano."
      });
    }
    return actions;
  }

  if (state.step === "declare-attackers" && !state.combat.attackersDeclared && seat === state.activeSeat) {
    const attackers = legalAttackers(state, seat);
    actions.push({ action: { type: "declare-attackers", attackers: [] }, label: "No atacar" });
    for (const attacker of attackers) {
      actions.push({
        action: { type: "declare-attackers", attackers: [{ instanceId: attacker.instance_id, defender: opponentsOf(state, seat)[0] ?? seat }] },
        label: `Atacar con ${attacker.card.name}`,
        cardId: attacker.instance_id
      });
    }
    return actions;
  }

  if (state.step === "declare-blockers" && !state.combat.blockersDeclared && defendersAwaitingBlocks(state).includes(seat)) {
    actions.push({ action: { type: "declare-blockers", blockers: [] }, label: "No bloquear" });
    for (const blocker of legalBlockers(state, seat)) {
      actions.push({ action: { type: "declare-blockers", blockers: [{ instanceId: blocker.instance_id, attackerId: "" }] }, label: `Bloquear con ${blocker.card.name}`, cardId: blocker.instance_id });
    }
    return actions;
  }

  if (!state.priorityOpen || state.prioritySeat !== seat) return actions;

  actions.push({ action: { type: "pass" }, label: state.stack.length ? "Dejar resolver" : "Pasar prioridad" });

  if (sorcerySpeed(state, seat) && player.landsPlayedThisTurn < 1) {
    for (const card of player.hand) {
      if (!isLand(cardProfile(card))) continue;
      actions.push({ action: { type: "play-land", cardId: card.instance_id }, label: `Jugar ${card.name}`, cardId: card.instance_id });
    }
  }

  if (!splitSecondActive(state)) for (const card of player.hand) {
    const profile = cardProfile(card);
    const values = profile.cost?.hasVariable ? [...Array(Math.max(1, potentialMana(player) + 1)).keys()] : [0];
    const modes: (number | undefined)[] = profile.modalChoices.length ? profile.modalChoices.map((_, index) => index) : [undefined];
    const variants: { kicked: boolean; evoked: boolean }[] = [{ kicked: false, evoked: false }];
    if (profile.kickerCost) variants.push({ kicked: true, evoked: false });
    if (profile.evokeCost) variants.push({ kicked: false, evoked: true });
    for (const variableValue of values) for (const mode of modes) for (const { kicked, evoked } of variants) {
      const check = castableCard(state, seat, card, false, variableValue, mode, kicked, evoked);
      if (!check.legal) continue;
      const modal = mode === undefined ? undefined : profile.modalChoices[mode];
      actions.push({
        action: { type: "cast", cardId: card.instance_id, ...(profile.cost?.hasVariable ? { variableValue } : {}), ...(mode === undefined ? {} : { mode }), ...(kicked ? { kicked: true } : {}), ...(evoked ? { evoked: true } : {}) },
        label: `${profile.cost?.hasVariable ? `Lanzar ${card.name} (X=${variableValue})` : `Lanzar ${card.name}`}${kicked ? " (kicker)" : ""}${evoked ? " (evocar)" : ""}${modal ? ` — ${modal.text}` : ""}`,
        cardId: card.instance_id,
        manaValue: cardProfile(card).manaValue + (profile.cost?.hasVariable ? variableValue : 0) + (kicked ? (profile.kickerCost?.manaValue ?? 0) : 0),
        ...(check.targetKind ? { requiresTarget: check.targetKind } : {}),
        ...(check.note ? { note: check.note } : {})
      });
    }
  }

  for (const card of player.graveyard) {
    const profile = cardProfile(card);
    const cost = profile.flashbackCost;
    if (!cost || profile.isPermanent) continue;
    const values = cost.hasVariable ? [...Array(Math.max(1, potentialMana(player) + 1)).keys()] : [0];
    const modes: (number | undefined)[] = profile.modalChoices.length ? profile.modalChoices.map((_, index) => index) : [undefined];
    for (const variableValue of values) for (const mode of modes) {
      const check = castableCard(state, seat, card, false, variableValue, mode, false, false, true);
      if (!check.legal) continue;
      const modal = mode === undefined ? undefined : profile.modalChoices[mode];
      actions.push({
        action: { type: "cast", cardId: card.instance_id, fromGraveyard: true, ...(cost.hasVariable ? { variableValue } : {}), ...(mode === undefined ? {} : { mode }) },
        label: `Lanzar ${card.name} con Flashback${profile.flashbackLifeCost ? ` — Pay ${profile.flashbackLifeCost} life (paga ${profile.flashbackLifeCost} vidas)` : ""}${modal ? ` — ${modal.text}` : ""}`,
        cardId: card.instance_id,
        manaValue: cost.manaValue + (cost.hasVariable ? variableValue : 0),
        ...(check.targetKind ? { requiresTarget: check.targetKind } : {}),
        ...(check.note ? { note: check.note } : {})
      });
    }
  }

  for (const card of player.commandZone) {
    const tax = commanderTax(player, card.instance_id);
    const profile = cardProfile(card);
    const values = profile.cost?.hasVariable ? [...Array(Math.max(1, potentialMana(player) + 1)).keys()] : [0];
    const modes: (number | undefined)[] = profile.modalChoices.length ? profile.modalChoices.map((_, index) => index) : [undefined];
    const kickers = profile.kickerCost ? [false, true] : [false];
    for (const variableValue of values) for (const mode of modes) for (const kicked of kickers) {
      const check = castableCard(state, seat, card, true, variableValue, mode, kicked);
      if (!check.legal) continue;
      const modal = mode === undefined ? undefined : profile.modalChoices[mode];
      actions.push({
        action: { type: "cast", cardId: card.instance_id, ...(profile.cost?.hasVariable ? { variableValue } : {}), ...(mode === undefined ? {} : { mode }), ...(kicked ? { kicked: true } : {}) },
        label: `Lanzar comandante ${card.name}${tax ? ` (+${tax} impuesto)` : ""}${kicked ? " (kicker)" : ""}${profile.cost?.hasVariable ? ` (X=${variableValue})` : ""}${modal ? ` — ${modal.text}` : ""}`,
        cardId: card.instance_id,
        manaValue: cardProfile(card).manaValue + tax + (profile.cost?.hasVariable ? variableValue : 0) + (kicked ? (profile.kickerCost?.manaValue ?? 0) : 0),
        ...(check.targetKind ? { requiresTarget: check.targetKind } : {}),
        ...(check.note ? { note: check.note } : {})
      });
    }
  }

  if (!splitSecondActive(state)) for (const card of player.hand) {
    const profile = cardProfile(card);
    const cyclingOptions = profile.cyclingCost
      ? [{ cost: profile.cyclingCost, index: undefined, label: `Cycle ${card.name}`, note: `Cycling ${profile.cyclingCost.raw}` }]
      : profile.cyclingSearches.map((ability) => ({ cost: ability.cost, index: ability.index, label: `${ability.text} ${card.name}`, note: ability.text }));
    for (const option of cyclingOptions) {
      if (!planManaPayment(option.cost, player, { state })) continue;
      actions.push({
        action: { type: "cycle", cardId: card.instance_id, ...(option.index === undefined ? {} : { cyclingIndex: option.index }) },
        label: option.label,
        cardId: card.instance_id,
        manaValue: option.cost.manaValue,
        note: option.note
      });
    }
  }

  // Abilities of permanents this seat controls. Mana abilities resolve
  // immediately and never use the stack (rule 605.3a); everything else is
  // announced like a spell and waits for priority to pass.
  for (const permanent of player.battlefield) {
    const profile = cardProfile(permanent.card);
    for (const ability of profile.manaAbilities) {
      if (!canUseManaAbility(player, permanent, ability, state)) continue;
      const options = manaOptionsFor(player, ability);
      if (!options.length) continue;
      if (ability.variableAmountCounter) {
        const available = permanent.counters[ability.variableAmountCounter] ?? 0;
        for (let amount = 1; amount <= available; amount += 1) {
          for (const manaChoices of manaChoiceVectors(options, amount)) {
            const produced = manaChoices.map((type) => `{${type}}`).join("");
            actions.push({
              action: { type: "activate-mana", sourceId: permanent.instance_id, abilityIndex: ability.index, mana: manaChoices[0]!, variableAmount: amount, manaChoices },
              label: `${permanent.card.name}: Remove ${amount} storage counter${amount === 1 ? "" : "s"} — Add ${produced}`,
              cardId: permanent.instance_id
            });
          }
        }
        continue;
      }
      const activations = ability.fixedProduces ? [ability.fixedProduces[0]!] : options;
      for (const mana of activations) {
        const bonusOptions = isLand(profile) && allPermanents(state).some((candidate) => candidate.controller === seat
          && cardProfile(candidate.card).doublesLandMana) ? [...new Set(options)] : [undefined];
        for (const manaBonus of bonusOptions) {
          const outputTypes = ability.fixedProduces ? ability.fixedProduces : Array.from({ length: ability.amount }, () => mana);
          const produced = [...outputTypes, ...(manaBonus ? [manaBonus] : [])].map((type) => `{${type}}`).join("");
          actions.push({
            action: { type: "activate-mana", sourceId: permanent.instance_id, abilityIndex: ability.index, mana, ...(manaBonus ? { manaBonus } : {}) },
            label: `${permanent.card.name}: Add ${produced}`,
            cardId: permanent.instance_id,
            ...(ability.lifeCost ? { note: `Cuesta ${ability.lifeCost} de vida.` } : {})
          });
        }
      }
    }
    for (const ability of profile.activatedAbilities) {
      const check = activatableAbility(state, seat, permanent, ability);
      if (!check.legal) continue;
      const sacrifices = ability.sacrificesCreature
        ? player.battlefield.filter((candidate) => isCreature(cardProfile(candidate.card))
          && (ability.sacrificesCreature !== "another" || candidate.instance_id !== permanent.instance_id))
        : ability.sacrificesPermanent
          ? player.battlefield.filter((candidate) => matchesSacrificeType(candidate, ability.sacrificesPermanent!.type)
            && (ability.sacrificesPermanent!.mode !== "another" || candidate.instance_id !== permanent.instance_id))
        : [undefined];
      const discards = ability.discardsCard ? player.hand : [undefined];
      const exiles = ability.exilesGraveyardCard ? player.graveyard : [undefined];
      const tapCreatures = ability.tapsCreature ? tapCostCandidates(state, seat, permanent, ability) : [undefined];
      for (const sacrifice of sacrifices) for (const tapCreature of tapCreatures) for (const discard of discards) for (const exile of exiles) actions.push({
        action: { type: "activate", sourceId: permanent.instance_id, abilityIndex: ability.index, ...(sacrifice ? { sacrificeId: sacrifice.instance_id } : {}), ...(tapCreature ? { tapId: tapCreature.instance_id } : {}), ...(discard ? { discardCardId: discard.instance_id } : {}), ...(exile ? { exileCardId: exile.instance_id } : {}) },
        label: `${permanent.card.name}: ${ability.text.split(":").slice(1).join(":").trim() || ability.text}${sacrifice ? ` — Sacrifice ${sacrifice.card.name}` : ""}${tapCreature ? ` — Tap ${tapCreature.card.name}` : ""}${discard ? ` — Discard ${discard.name}` : ""}${exile ? ` — Exile ${exile.name}` : ""}`,
        cardId: permanent.instance_id,
        ...(check.targetKind ? { requiresTarget: check.targetKind } : {}),
        note: ability.text
      });
    }
    if (!splitSecondActive(state) && profile.equipCost && profile.subtypes.some((subtype) => subtype.toLowerCase() === "equipment")
      && planManaPayment(profile.equipCost, player, { state })
      && legalTargets(state, seat, "creature-you-control").length) {
      actions.push({
        action: { type: "equip", sourceId: permanent.instance_id },
        label: `Equip ${permanent.card.name}`,
        cardId: permanent.instance_id,
        requiresTarget: "creature-you-control",
        note: `Equip ${profile.equipCost.raw}`
      });
    }
  }

  actions.push({ action: { type: "concede" }, label: "Conceder" });
  return actions;
}

/** Targets a spell could legally choose right now. */
export function legalTargets(state: GameState, seat: SeatId, kind: Exclude<TargetKind, "none">): Target[] {
  if (kind === "player") return state.players.filter((player) => !player.lost).map((player) => ({ kind: "player", seat: player.seat }) as Target);
  if (kind === "opponent") return state.players.filter((player) => player.seat !== seat && !player.lost).map((player) => ({ kind: "player", seat: player.seat }) as Target);
  if (kind === "card-in-your-graveyard" || kind === "card-in-a-graveyard" || kind === "creature-card-in-your-graveyard" || kind === "creature-card-in-a-graveyard" || kind === "artifact-card-in-your-graveyard" || kind === "artifact-card-in-a-graveyard" || kind === "enchantment-card-in-your-graveyard" || kind === "enchantment-card-in-a-graveyard" || kind === "permanent-card-in-your-graveyard" || kind === "permanent-card-in-a-graveyard" || kind === "legendary-creature-card-in-your-graveyard") {
    const sources = kind === "card-in-a-graveyard" || kind === "creature-card-in-a-graveyard" || kind === "artifact-card-in-a-graveyard" || kind === "enchantment-card-in-a-graveyard" || kind === "permanent-card-in-a-graveyard" ? state.players : [playerAt(state, seat)];
    return sources.flatMap((player) => player.graveyard
      .filter((card) => kind === "card-in-your-graveyard"
        || kind === "card-in-a-graveyard"
        || (kind === "creature-card-in-your-graveyard" && isCreature(cardProfile(card)))
        || (kind === "creature-card-in-a-graveyard" && isCreature(cardProfile(card)))
        || (kind === "artifact-card-in-your-graveyard" && cardProfile(card).types.includes("Artifact"))
        || (kind === "artifact-card-in-a-graveyard" && cardProfile(card).types.includes("Artifact"))
        || (kind === "enchantment-card-in-a-graveyard" && cardProfile(card).types.includes("Enchantment"))
        || (kind === "enchantment-card-in-your-graveyard" && cardProfile(card).types.includes("Enchantment"))
        || (kind === "permanent-card-in-your-graveyard" && cardProfile(card).isPermanent)
        || (kind === "permanent-card-in-a-graveyard" && cardProfile(card).isPermanent)
        || (kind === "legendary-creature-card-in-your-graveyard" && isCreature(cardProfile(card)) && cardProfile(card).supertypes.some((value) => value.toLowerCase() === "legendary"))
      )
      .map((card) => ({ kind: "graveyard-card", seat: player.seat, instanceId: card.instance_id }) as Target));
  }
  if (kind === "land-card-in-a-graveyard") {
    return state.players.flatMap((player) => player.graveyard
      .filter((card) => isLand(cardProfile(card)))
      .map((card) => ({ kind: "graveyard-card", seat: player.seat, instanceId: card.instance_id }) as Target));
  }
  if (kind === "attacking-or-blocking-creature") {
    const inCombat = new Set<string>([
      ...state.combat.attackers.map((entry) => entry.instanceId),
      ...state.combat.blockers.map((entry) => entry.instanceId)
    ]);
    return allPermanents(state)
      .filter((permanent) => inCombat.has(permanent.instance_id) && isCreature(cardProfile(permanent.card)))
      .filter((permanent) => (!keywordOf(state, permanent, "hexproof") || permanent.controller === seat) && !keywordOf(state, permanent, "shroud"))
      .map((permanent) => ({ kind: "permanent", instanceId: permanent.instance_id }) as Target);
  }
  if (kind === "spell") return state.stack.map((entry) => ({ kind: "spell", stackId: entry.id }) as Target);
  if (kind === "creature-spell" || kind === "noncreature-spell") {
    return state.stack
      .filter((entry) => !entry.activated && !entry.trigger)
      .filter((entry) => kind === "creature-spell"
        ? isCreature(cardProfile(entry.card))
        : !isCreature(cardProfile(entry.card)))
      .map((entry) => ({ kind: "spell", stackId: entry.id }) as Target);
  }
  const permanents = allPermanents(state)
    .filter((permanent) => !keywordOf(state, permanent, "hexproof") || permanent.controller === seat)
    .filter((permanent) => !keywordOf(state, permanent, "shroud"));
  const filtered = permanents.filter((permanent) => {
    const profile = cardProfile(permanent.card);
    if (kind === "nontoken-creature") return isCreature(profile) && !permanent.card.token;
    if (kind === "creature" || kind === "creature-you-control" || kind === "nonartifact-creature" || kind === "nonblack-creature" || kind === "creature-with-flying" || kind === "creature-with-defender" || kind === "creature-with-deathtouch" || kind === "creature-with-lifelink" || kind === "creature-with-menace" || kind === "creature-with-haste" || kind === "creature-with-first-strike" || kind === "creature-with-double-strike" || kind === "creature-with-trample" || kind === "creature-with-vigilance" || kind === "creature-with-indestructible" || kind === "creature-with-hexproof" || kind === "creature-with-shroud" || kind === "creature-with-reach" || kind === "creature-power-at-least-5" || kind === "creature-power-at-most-4" || kind === "creature-toughness-at-least-4" || kind === "creature-toughness-at-most-4") {
      if (!isCreature(profile)) return false;
      if (kind === "creature-you-control" && permanent.controller !== seat) return false;
      if (kind === "nonartifact-creature" && profile.types.includes("Artifact")) return false;
      if (kind === "nonblack-creature" && profile.colors.some((color) => color.toUpperCase() === "B")) return false;
      if (kind === "creature-with-flying" && !keywordOf(state, permanent, "flying")) return false;
      if (kind === "creature-with-defender" && !keywordOf(state, permanent, "defender")) return false;
      if (kind === "creature-with-deathtouch" && !keywordOf(state, permanent, "deathtouch")) return false;
      if (kind === "creature-with-lifelink" && !keywordOf(state, permanent, "lifelink")) return false;
      if (kind === "creature-with-menace" && !keywordOf(state, permanent, "menace")) return false;
      if (kind === "creature-with-haste" && !keywordOf(state, permanent, "haste")) return false;
      if (kind === "creature-with-first-strike" && !keywordOf(state, permanent, "first strike")) return false;
      if (kind === "creature-with-double-strike" && !keywordOf(state, permanent, "double strike")) return false;
      if (kind === "creature-with-trample" && !keywordOf(state, permanent, "trample")) return false;
      if (kind === "creature-with-vigilance" && !keywordOf(state, permanent, "vigilance")) return false;
      if (kind === "creature-with-indestructible" && !keywordOf(state, permanent, "indestructible")) return false;
      if (kind === "creature-with-hexproof" && !keywordOf(state, permanent, "hexproof")) return false;
      if (kind === "creature-with-shroud" && !keywordOf(state, permanent, "shroud")) return false;
      if (kind === "creature-with-reach" && !keywordOf(state, permanent, "reach")) return false;
      if (kind === "creature-power-at-least-5" && powerOf(permanent, state) < 5) return false;
      if (kind === "creature-power-at-most-4" && powerOf(permanent, state) > 4) return false;
      if (kind === "creature-toughness-at-least-4" && toughnessOf(permanent, state) < 4) return false;
      if (kind === "creature-toughness-at-most-4" && toughnessOf(permanent, state) > 4) return false;
      return true;
    }
    if (kind === "land-you-control") return isLand(profile) && permanent.controller === seat;
    if (kind === "nonbasic-land") return isLand(profile) && !profile.supertypes.some((value) => value.toLowerCase() === "basic");
    if (kind === "artifact-or-enchantment") return profile.types.includes("Artifact") || profile.types.includes("Enchantment");
    if (kind === "enchantment") return profile.types.includes("Enchantment");
    if (kind === "land") return isLand(profile);
    if (kind === "artifact-enchantment-or-land") return profile.types.includes("Artifact") || profile.types.includes("Enchantment") || isLand(profile);
    if (kind === "artifact") return profile.types.includes("Artifact");
    if (kind.startsWith("subtype:")) {
      const subtype = kind.slice("subtype:".length).toLowerCase();
      return hasSubtype(profile, subtype);
    }
    if (kind === "artifact-creature-or-planeswalker") return profile.types.some((type) => ["Artifact", "Creature", "Planeswalker"].includes(type));
    if (kind === "nonland") return !isLand(profile);
    if (kind === "noncreature-permanent") return !isCreature(profile);
    return true;
  }).map((permanent) => ({ kind: "permanent", instanceId: permanent.instance_id }) as Target);
  if (kind === "player-or-planeswalker") {
    return [
      ...state.players.filter((player) => !player.lost).map((player) => ({ kind: "player", seat: player.seat }) as Target),
      ...filtered.filter((target) => {
        const permanent = target.kind === "permanent" ? findPermanent(state, target.instanceId) : undefined;
        return permanent ? cardProfile(permanent.card).types.includes("Planeswalker") : false;
      })
    ];
  }
  if (kind === "any") {
    return [...state.players.filter((player) => !player.lost).map((player) => ({ kind: "player", seat: player.seat }) as Target), ...filtered.filter((target) => {
      const permanent = findPermanent(state, target.kind === "permanent" ? target.instanceId : "");
      return permanent ? isCreature(cardProfile(permanent.card)) : false;
    })];
  }
  return filtered;
}

// ---------------------------------------------------------------------------
// Action application
// ---------------------------------------------------------------------------

function pushOnStack(state: GameState, seat: SeatId, card: GameCard, targets: readonly Target[], fromCommandZone: boolean, variableValue: number, selectedEffect?: SpellEffect, kicked = false, evoked = false, flashback = false): GameState {
  const object: StackObject = {
    id: `stack:${state.version}:${card.instance_id}`,
    controller: seat,
    card,
    label: card.name,
    targets,
    fromCommandZone,
    flashback,
    variableValue,
    countered: false,
    ...(selectedEffect ? { selectedEffect } : {}),
    ...(kicked ? { kicked: true } : {}),
    ...(evoked ? { evoked: true } : {})
  };
  // After putting an object on the stack its controller receives priority again (rule 117.3c).
  return { ...state, stack: [...state.stack, object], prioritySeat: seat, priorityOpen: true, passedSeats: [] };
}

function pushActivatedOnStack(state: GameState, seat: SeatId, source: Permanent, ability: ActivatedAbility, targets: readonly Target[]): GameState {
  const object: StackObject = {
    id: `ability:${state.version}:${source.instance_id}:${ability.index}`,
    controller: seat,
    card: source.card,
    label: `${source.card.name} · habilidad activada`,
    targets,
    fromCommandZone: false,
    flashback: false,
    variableValue: 0,
    countered: false,
    activated: ability,
    sourcePermanentId: source.instance_id
  };
  return { ...state, stack: [...state.stack, object], prioritySeat: seat, priorityOpen: true, passedSeats: [] };
}

function applyActivateMana(state: GameState, seat: SeatId, action: Extract<GameAction, { type: "activate-mana" }>): GameState {
  if (!state.priorityOpen || state.prioritySeat !== seat) throw new Error("No tienes prioridad para activar esa habilidad de maná.");
  const player = playerAt(state, seat);
  const source = player.battlefield.find((permanent) => permanent.instance_id === action.sourceId);
  if (!source) throw new Error("Ese permanente ya no está bajo tu control.");
  const ability = cardProfile(source.card).manaAbilities.find((candidate) => candidate.index === action.abilityIndex);
  const options = ability ? manaOptionsFor(player, ability) : [];
  if (!ability || !options.includes(action.mana)) throw new Error("Esa habilidad de maná no existe.");
  if (ability.variableAmountCounter) {
    const amount = action.variableAmount;
    const choices = action.manaChoices ?? [];
    const available = source.counters[ability.variableAmountCounter] ?? 0;
    if (!amount || !Number.isInteger(amount) || amount < 1 || amount > available || choices.length !== amount) {
      throw new Error("Cantidad inválida de contadores de almacenamiento.");
    }
    if (choices.some((mana) => !options.includes(mana)) || choices[0] !== action.mana) {
      throw new Error("Tipo de maná inválido para esa habilidad de almacenamiento.");
    }
    if (!canUseManaAbility(player, source, ability, state)) throw new Error("No puedes activar esa habilidad de maná ahora.");
    if (!ability.manaCost) throw new Error("Falta el coste de maná de esa habilidad.");
    const plan = planManaPayment(ability.manaCost, player, { state });
    if (!plan) throw new Error("No tienes maná suficiente para activar esa habilidad.");
    let next = applyManaPlan(state, seat, plan);
    const current = playerAt(next, seat);
    const payment = payCost(ability.manaCost, current.manaPool, { availableLife: current.life });
    if (!payment) throw new Error("No se pudo pagar el coste de esa habilidad.");
    next = withPlayer(next, seat, (currentPlayer) => {
      const counters = { ...currentPlayer.battlefield.find((permanent) => permanent.instance_id === source.instance_id)?.counters };
      counters[ability.variableAmountCounter!] = (counters[ability.variableAmountCounter!] ?? 0) - amount;
      return {
        ...currentPlayer,
        manaPool: choices.reduce((pool, mana) => addMana(pool, mana, 1), payment.remaining),
        battlefield: currentPlayer.battlefield.map((permanent) => permanent.instance_id === source.instance_id
          ? { ...permanent, counters }
          : permanent)
      };
    });
    return logged(next, seat, `${player.name} activa ${source.card.name}, retira ${amount} contador${amount === 1 ? "" : "es"} de almacenamiento y agrega ${choices.map((mana) => `{${mana}}`).join("")}.`);
  }
  if (ability.fixedProduces && action.mana !== ability.fixedProduces[0]) throw new Error("Esa habilidad de maná produce un conjunto fijo.");
  if (!canUseManaAbility(player, source, ability, state)) throw new Error("No puedes activar esa habilidad de maná ahora.");
  const sourceProfile = cardProfile(source.card);
  const landBonus = player.battlefield.some((permanent) => {
    const grant = cardProfile(permanent.card).staticLandManaBonus;
    return grant && grant.mana === action.mana && sourceProfile.subtypes.some((subtype) => subtype.toLowerCase() === grant.subtype.toLowerCase());
  }) ? 1 : 0;
  const manaBonusOptions = isLand(cardProfile(source.card)) && allPermanents(state).some((candidate) => candidate.controller === seat
    && cardProfile(candidate.card).doublesLandMana) ? options : [];
  const manaBonus = action.manaBonus ?? (manaBonusOptions[0]);
  if (manaBonus && !manaBonusOptions.includes(manaBonus)) throw new Error("Ese tipo de maná adicional no es válido.");
  const next = withPlayer(state, seat, (current) => ({
    ...current,
    life: current.life - ability.lifeCost + (ability.gainLife ?? 0),
    manaPool: (ability.fixedProduces
      ? ability.fixedProduces.reduce((pool, mana) => addMana(pool, mana, 1), current.manaPool)
      : addMana(current.manaPool, action.mana, ability.amount + landBonus)),
    battlefield: current.battlefield.map((permanent) => {
      if (permanent.instance_id !== source.instance_id) return permanent;
      const counters = { ...permanent.counters };
      for (const cost of ability.removeCounters ?? []) counters[cost.kind] = (counters[cost.kind] ?? 0) - cost.amount;
      return { ...permanent, ...(ability.requiresTap ? { tapped: true } : {}), counters };
    })
  }));
  const withBonus = manaBonus ? withPlayer(next, seat, (current) => ({ ...current, manaPool: addMana(current.manaPool, manaBonus, 1) })) : next;
  const tapped = ability.requiresTap ? raiseTapEvents(withBonus, state, [source.instance_id]) : withBonus;
  const outputTypes = ability.fixedProduces ? ability.fixedProduces : Array.from({ length: ability.amount }, () => action.mana);
  const output = [...outputTypes, ...(manaBonus ? [manaBonus] : [])].map((mana) => `{${mana}}`).join("");
  return logged(tapped, seat, `${player.name} activa ${source.card.name} y agrega ${output}.`);
}

function applyCycle(state: GameState, seat: SeatId, action: Extract<GameAction, { type: "cycle" }>): GameState {
  if (!state.priorityOpen || state.prioritySeat !== seat) throw new Error("No tienes prioridad para ciclar esa carta.");
  if (splitSecondActive(state)) throw new Error("Split second impide activar habilidades que no sean de maná.");
  const player = playerAt(state, seat);
  const card = player.hand.find((candidate) => candidate.instance_id === action.cardId);
  const profile = card ? cardProfile(card) : null;
  const searchAbility = profile && action.cyclingIndex !== undefined ? profile.cyclingSearches[action.cyclingIndex] : undefined;
  if (action.cyclingIndex !== undefined && !searchAbility) {
    throw new Error("Esa opción de cycling no existe para la carta.");
  }
  const cost = searchAbility?.cost ?? profile?.cyclingCost ?? null;
  if (!card || !cost) throw new Error("Esa carta no tiene un coste de cycling válido.");
  const cycledCard = card;
  const plan = planManaPayment(cost, player, { state });
  if (!plan) throw new Error(`No tienes maná suficiente para ciclar ${card.name}.`);
  let next = applyManaPlan(state, seat, plan);
  const payment = payCost(cost, playerAt(next, seat).manaPool, { availableLife: playerAt(next, seat).life });
  if (!payment) throw new Error(`No se pudo pagar el cycling de ${card.name}.`);
  next = withPlayer(next, seat, (current) => ({
    ...current,
    manaPool: payment.remaining,
    hand: current.hand.filter((candidate) => candidate.instance_id !== card.instance_id),
    graveyard: [...current.graveyard, card]
  }));
  const cycledWatcher: Permanent = {
    instance_id: cycledCard.instance_id,
    card: cycledCard,
    controller: seat,
    tapped: false,
    summoningSick: false,
    damage: 0,
    deathtouched: false,
    counters: {},
    powerModifier: 0,
    toughnessModifier: 0,
    isCommander: false
  };
  next = raiseEvent(next, { kind: "card-cycled", controller: seat, card: cycledCard }, [cycledWatcher]);
  if (!searchAbility) return logged(drawCards(next, seat, 1), seat, `${player.name} cicla ${card.name}.`);

  const search: Extract<import("./characteristics.js").SpellEffect, { kind: "search-library" }> = {
    kind: "search-library", types: ["Land"], subtypes: searchAbility.subtypes, destination: "hand", reveal: true
  };
  const optionIds = playerAt(next, seat).library.filter((candidate) => {
    const candidateProfile = cardProfile(candidate);
    return candidateProfile.types.includes("Land") && search.subtypes?.some((subtype) =>
      subtype.toLowerCase() === "basic"
        ? candidateProfile.supertypes.some((supertype) => supertype.toLowerCase() === "basic")
        : hasSubtype(candidateProfile, subtype));
  }).map((candidate) => candidate.instance_id);
  if (!optionIds.length) {
    const shuffled = shuffle(playerAt(next, seat).library, next.rngState);
    const shuffledState = withPlayer({ ...next, rngState: shuffled.state }, seat, (current) => ({ ...current, library: shuffled.items }));
    return logged(shuffledState, seat, `${player.name} cicla ${card.name}, pero no encuentra una tierra válida.`);
  }
  return logged({
    ...next,
    pendingChoice: {
      type: "search-library", seat, sourceId: `cycle:${next.version}:${card.instance_id}`,
      optionIds, sourceCard: card, search, returnSourceToGraveyard: false, exileSourceAfterResolution: false
    }
  }, seat, `${player.name} usa ${searchAbility.text} de ${card.name}.`);
}

function applyEquip(state: GameState, seat: SeatId, action: Extract<GameAction, { type: "equip" }>): GameState {
  if (!state.priorityOpen || state.prioritySeat !== seat) throw new Error("No tienes prioridad para equipar.");
  if (splitSecondActive(state)) throw new Error("Split second impide activar habilidades que no sean de maná.");
  const player = playerAt(state, seat);
  const source = player.battlefield.find((permanent) => permanent.instance_id === action.sourceId);
  if (!source) throw new Error("Ese equipo ya no está bajo tu control.");
  const profile = cardProfile(source.card);
  if (!profile.equipCost || !profile.subtypes.some((subtype) => subtype.toLowerCase() === "equipment")) {
    throw new Error("Ese permanente no tiene una habilidad de equipar válida.");
  }
  const targetId = action.targetId;
  if (!targetId) throw new Error("Equip necesita un objetivo.");
  const allowed = legalTargets(state, seat, "creature-you-control");
  if (!allowed.some((target) => target.kind === "permanent" && target.instanceId === targetId)) {
    throw new Error("Equip necesita una criatura que controles.");
  }
  const plan = planManaPayment(profile.equipCost, player, { state });
  if (!plan) throw new Error(`No tienes maná suficiente para equipar ${source.card.name}.`);
  let next = applyManaPlan(state, seat, plan);
  const payment = payCost(profile.equipCost, playerAt(next, seat).manaPool, { availableLife: playerAt(next, seat).life });
  if (!payment) throw new Error(`No se pudo pagar el coste de equipar ${source.card.name}.`);
  next = withPlayer(next, seat, (current) => ({ ...current, manaPool: payment.remaining }));
  const ability: ActivatedAbility = {
    index: 0, requiresTap: false, sacrificesSelf: false, lifeCost: 0, manaCost: null,
    effect: { kind: "attach-equipment" }, targetKind: "creature-you-control", text: `Equip ${profile.equipCost.raw}`
  };
  next = pushActivatedOnStack(next, seat, source, ability, [{ kind: "permanent", instanceId: targetId }]);
  return logged(next, seat, `${player.name} activa equipar de ${source.card.name}.`);
}

/**
 * Whether a seat may activate one printed non-mana ability right now.
 *
 * This is the single source of truth shared by `legalActions` and
 * `applyActivate`, so the client is never offered an activation the
 * authoritative path would then refuse.
 */
function activatableAbility(
  state: GameState,
  seat: SeatId,
  permanent: Permanent,
  ability: ActivatedAbility
): { legal: boolean; targetKind?: Exclude<TargetKind, "none">; note?: string } {
  const player = playerAt(state, seat);
  if (splitSecondActive(state)) return { legal: false };
  if (permanent.controller !== seat) return { legal: false };
  if (ability.sorcerySpeed && !sorcerySpeed(state, seat)) return { legal: false };
  if (ability.loyaltyCost !== undefined) {
    // One loyalty ability per planeswalker per turn (CR 606.3); a minus ability
    // needs enough loyalty to pay it (CR 606.5).
    if (permanent.loyaltyUsedThisTurn) return { legal: false };
    if (ability.loyaltyCost < 0 && (permanent.counters.loyalty ?? 0) < -ability.loyaltyCost) return { legal: false };
  }
  if (ability.precombatMainOnly && (state.activeSeat !== seat || state.step !== "precombat-main" || state.stack.length !== 0)) return { legal: false };
  if (ability.requiresTap && permanent.tapped) return { legal: false };
  // Rule 302.6: a `{T}` cost needs a creature that has been controlled since
  // the turn began. Non-creature permanents are unaffected by summoning sickness.
  if (ability.requiresTap && permanent.summoningSick && isCreature(cardProfile(permanent.card))) return { legal: false };
  if (ability.lifeCost >= player.life) return { legal: false };
  if (ability.sacrificesCreature) {
    const candidates = player.battlefield.filter((candidate) => isCreature(cardProfile(candidate.card))
      && (ability.sacrificesCreature !== "another" || candidate.instance_id !== permanent.instance_id));
    if (!candidates.length) return { legal: false };
  }
  if (ability.sacrificesPermanent) {
    const candidates = player.battlefield.filter((candidate) => matchesSacrificeType(candidate, ability.sacrificesPermanent!.type)
      && (ability.sacrificesPermanent!.mode !== "another" || candidate.instance_id !== permanent.instance_id));
    if (!candidates.length) return { legal: false };
  }
  if (ability.tapsCreature && !tapCostCandidates(state, seat, permanent, ability).length) return { legal: false };
  if (ability.discardsCard && !player.hand.length) return { legal: false };
  if (ability.exilesGraveyardCard && !player.graveyard.length) return { legal: false };
  if (ability.removeCounters && !ability.removeCounters.every((cost) => (permanent.counters[cost.kind] ?? 0) >= cost.amount)) {
    return { legal: false };
  }
  if (ability.manaCost && ability.manaCost.symbols.length) {
    // The cost is paid as one lump, so the check has to look at the board the
    // payment will actually see: life already spent on the ability, and the
    // source no longer available as a mana source when it taps for the ability
    // itself. A land that taps for both would otherwise be counted twice.
    const budget: PlayerState = {
      ...player,
      life: player.life - ability.lifeCost,
      battlefield: ability.requiresTap
        ? player.battlefield.map((candidate) =>
            candidate.instance_id === permanent.instance_id ? { ...candidate, tapped: true } : candidate)
        : player.battlefield
    };
    if (!planManaPayment(ability.manaCost, budget, { state })) return { legal: false };
  }
  const targetKind = ability.targetKind;
  if (targetKind === "none") return { legal: true };
  if ((targetKind === "spell" || targetKind === "creature-spell" || targetKind === "noncreature-spell") && !legalTargets(state, seat, targetKind).length) return { legal: false };
  if (!legalTargets(state, seat, targetKind).length) return { legal: false };
  return { legal: true, targetKind };
}

/** Returns permanents that can pay a typed "tap an untapped ..." cost. */
function tapCostCandidates(
  state: GameState,
  seat: SeatId,
  source: Permanent,
  ability: ActivatedAbility
): Permanent[] {
  const cost = ability.tapsCreature;
  if (!cost) return [];
  return playerAt(state, seat).battlefield.filter((candidate) => {
    if (candidate.tapped || !isCreature(cardProfile(candidate.card))) return false;
    if (cost.mode === "another" && candidate.instance_id === source.instance_id) return false;
    return !cost.subtype || cardProfile(candidate.card).subtypes.some((subtype) => subtype.toLowerCase() === cost.subtype!.toLowerCase());
  });
}

function applyActivate(state: GameState, seat: SeatId, action: Extract<GameAction, { type: "activate" }>): GameState {
  if (!state.priorityOpen || state.prioritySeat !== seat) throw new Error("No tienes prioridad para activar esa habilidad.");
  const player = playerAt(state, seat);
  const source = player.battlefield.find((permanent) => permanent.instance_id === action.sourceId);
  if (!source) throw new Error("Ese permanente ya no está bajo tu control.");
  const ability = cardProfile(source.card).activatedAbilities.find((candidate) => candidate.index === action.abilityIndex);
  if (!ability) throw new Error("Esa habilidad activada no existe.");
  const check = activatableAbility(state, seat, source, ability);
  if (!check.legal) throw new Error(`No puedes activar la habilidad de ${source.card.name} ahora.`);

  // Targets are chosen while the ability is announced, before any cost is paid
  // (rule 601.2c applied to activations through 602.2b).
  let targets: readonly Target[] = action.targets ?? [];
  let sacrifice: Permanent | undefined;
  if (ability.sacrificesCreature) {
    const candidates = playerAt(state, seat).battlefield.filter((candidate) => isCreature(cardProfile(candidate.card))
      && (ability.sacrificesCreature !== "another" || candidate.instance_id !== source.instance_id));
    sacrifice = action.sacrificeId ? candidates.find((candidate) => candidate.instance_id === action.sacrificeId) : candidates[0];
    if (!sacrifice) throw new Error("Debes elegir una criatura para sacrificar.");
  } else if (ability.sacrificesPermanent) {
    const candidates = playerAt(state, seat).battlefield.filter((candidate) => matchesSacrificeType(candidate, ability.sacrificesPermanent!.type)
      && (ability.sacrificesPermanent!.mode !== "another" || candidate.instance_id !== source.instance_id));
    sacrifice = action.sacrificeId ? candidates.find((candidate) => candidate.instance_id === action.sacrificeId) : candidates[0];
    if (!sacrifice) throw new Error(`Debes elegir un ${ability.sacrificesPermanent.type.toLowerCase()} para sacrificar.`);
  }
  let tapCreature: Permanent | undefined;
  if (ability.tapsCreature) {
    const candidates = tapCostCandidates(state, seat, source, ability);
    tapCreature = action.tapId ? candidates.find((candidate) => candidate.instance_id === action.tapId) : candidates[0];
    if (!tapCreature) throw new Error("Debes elegir una criatura enderezada válida para girar.");
  }
  let discard: GameCard | undefined;
  if (ability.discardsCard) {
    discard = action.discardCardId ? playerAt(state, seat).hand.find((card) => card.instance_id === action.discardCardId) : playerAt(state, seat).hand[0];
    if (!discard) throw new Error("Debes elegir una carta para descartar.");
  }
  let exile: GameCard | undefined;
  if (ability.exilesGraveyardCard) {
    exile = action.exileCardId ? playerAt(state, seat).graveyard.find((card) => card.instance_id === action.exileCardId) : playerAt(state, seat).graveyard[0];
    if (!exile) throw new Error("Debes elegir una carta del cementerio para exiliar.");
  }

  if (check.targetKind) {
    const allowed = legalTargets(state, seat, check.targetKind);
    const chosen = targets.length ? targets : allowed.slice(0, 1);
    if (!chosen.length) throw new Error(`${source.card.name} necesita un objetivo legal.`);
    const valid = chosen.every((target) => allowed.some((candidate) => JSON.stringify(candidate) === JSON.stringify(target)));
    if (!valid) throw new Error(`Objetivo ilegal para ${source.card.name}.`);
    targets = chosen;
  }

  // Costs are paid in one lump: tap, life, mana, loyalty, then the sacrifice.
  let next = withPlayer(state, seat, (current) => ({
    ...current,
    life: current.life - ability.lifeCost,
    battlefield: current.battlefield.map((permanent) => {
      if (permanent.instance_id !== source.instance_id) return permanent;
      let updated = permanent;
      if (ability.requiresTap) updated = { ...updated, tapped: true };
      if (ability.loyaltyCost !== undefined) {
        updated = {
          ...updated,
          counters: { ...updated.counters, loyalty: (updated.counters.loyalty ?? 0) + ability.loyaltyCost },
          loyaltyUsedThisTurn: true
        };
      }
      return updated;
    })
  }));
  if (ability.requiresTap) next = raiseTapEvents(next, state, [source.instance_id]);
  if (ability.lifeCost) next = logged(next, seat, `${player.name} paga ${ability.lifeCost} de vida por ${source.card.name}.`);

  if (ability.manaCost && ability.manaCost.symbols.length) {
    const plan = planManaPayment(ability.manaCost, playerAt(next, seat), { state: next });
    if (!plan) throw new Error(`No tienes maná suficiente para la habilidad de ${source.card.name}.`);
    next = applyManaPlan(next, seat, plan);
    const payment = payCost(ability.manaCost, playerAt(next, seat).manaPool, { availableLife: playerAt(next, seat).life });
    if (!payment) throw new Error(`No se pudo pagar el coste de la habilidad de ${source.card.name}.`);
    next = withPlayer(next, seat, (current) => ({
      ...current,
      manaPool: payment.remaining,
      life: current.life - payment.lifePaid
    }));
  }

  if (tapCreature) {
    next = withPlayer(next, seat, (current) => ({
      ...current,
      battlefield: current.battlefield.map((permanent) =>
        permanent.instance_id === tapCreature!.instance_id ? { ...permanent, tapped: true } : permanent)
    }));
    next = raiseTapEvents(next, state, [tapCreature.instance_id]);
    next = logged(next, seat, `${player.name} gira ${tapCreature.card.name} como coste.`);
  }

  if (ability.removeCounters?.length) {
    next = withPlayer(next, seat, (current) => ({
      ...current,
      battlefield: current.battlefield.map((permanent) => {
        if (permanent.instance_id !== source.instance_id) return permanent;
        const counters = { ...permanent.counters };
        for (const cost of ability.removeCounters ?? []) counters[cost.kind] = (counters[cost.kind] ?? 0) - cost.amount;
        return { ...permanent, counters };
      })
    }));
  }

  if (ability.sacrificesSelf) {
    const paid = playerAt(next, seat).battlefield.find((permanent) => permanent.instance_id === source.instance_id);
    if (!paid) throw new Error(`${source.card.name} ya no está en el campo para sacrificarse.`);
    next = movePermanentToZone(next, paid, "graveyard");
    next = logged(next, seat, `${player.name} sacrifica ${source.card.name}.`);
  }
  if (sacrifice) {
    const paid = playerAt(next, seat).battlefield.find((permanent) => permanent.instance_id === sacrifice!.instance_id);
    if (!paid) throw new Error("La criatura elegida para sacrificar ya no está en el campo.");
    next = movePermanentToZone(next, paid, "graveyard");
    next = logged(next, seat, `${player.name} sacrifica ${paid.card.name}.`);
  }
  if (discard) {
    next = withPlayer(next, seat, (current) => ({
      ...current,
      hand: current.hand.filter((card) => card.instance_id !== discard!.instance_id),
      graveyard: [...current.graveyard, discard!]
    }));
    next = logged(next, seat, `${player.name} descarta ${discard.name}.`);
  }
  if (exile) {
    next = withPlayer(next, seat, (current) => ({
      ...current,
      graveyard: current.graveyard.filter((card) => card.instance_id !== exile!.instance_id),
      exile: [...current.exile, exile!]
    }));
    next = logged(next, seat, `${player.name} exilia ${exile.name} de su cementerio.`);
  }

  next = pushActivatedOnStack(next, seat, source, ability, targets);
  return logged(next, seat, `${player.name} activa la habilidad de ${source.card.name}.`);
}

function applyCast(state: GameState, seat: SeatId, action: Extract<GameAction, { type: "cast" }>): GameState {
  const player = playerAt(state, seat);
  const fromGraveyard = action.fromGraveyard === true;
  const fromHand = fromGraveyard ? undefined : player.hand.find((card) => card.instance_id === action.cardId);
  const fromCommand = fromGraveyard ? undefined : player.commandZone.find((card) => card.instance_id === action.cardId);
  const fromYard = fromGraveyard ? player.graveyard.find((card) => card.instance_id === action.cardId) : undefined;
  const card = fromHand ?? fromCommand ?? fromYard;
  if (!card) throw new Error("Esa carta no está en tu mano, cementerio ni zona de mando.");
  const kicked = Boolean(action.kicked);
  const evoked = Boolean(action.evoked);
  const check = castableCard(state, seat, card, Boolean(fromCommand), action.variableValue ?? 0, action.mode, kicked, evoked, fromGraveyard);
  if (!check.legal) throw new Error(check.note ?? `No puedes lanzar ${card.name} ahora.`);

  const profile = cardProfile(card);
  const spellCost = fromGraveyard ? profile.flashbackCost : spellCostOf(profile, kicked, evoked);
  const lifeCost = fromGraveyard
    ? profile.flashbackLifeCost
    : profile.additionalLifeCost + (profile.additionalLifeCostVariable ? (action.variableValue ?? 0) : 0);
  if (!spellCost) throw new Error(`No hay un coste válido para lanzar ${card.name}.`);
  const additionalGeneric = (fromCommand ? commanderTax(player, card.instance_id) : 0)
    - (fromGraveyard ? 0 : boardCostReduction(state, seat, card, profile));
  const plan = planManaPayment(spellCost, player, { additionalGeneric, variableValue: action.variableValue ?? 0, state, lifeCost });
  if (!plan) throw new Error(`No tienes maná suficiente para ${card.name}.`);

  const requested = action.targets ?? [];
  if (check.targetKind) {
    const allowed = legalTargets(state, seat, check.targetKind);
    const chosen = requested.length ? requested : allowed.slice(0, 1);
    if (!chosen.length) throw new Error(`${card.name} necesita un objetivo legal.`);
    const valid = chosen.every((target) => allowed.some((candidate) => JSON.stringify(candidate) === JSON.stringify(target)));
    if (!valid) throw new Error(`Objetivo ilegal para ${card.name}.`);
    action = { ...action, targets: chosen };
  }

  let next = applyManaPlan(state, seat, plan);
  const payment = payCost(spellCost, playerAt(next, seat).manaPool, { additionalGeneric, availableLife: playerAt(next, seat).life });
  if (!payment) throw new Error(`No se pudo pagar el coste de ${card.name}.`);
  next = withPlayer(next, seat, (current) => ({
    ...current,
    manaPool: payment.remaining,
    life: current.life - payment.lifePaid,
    hand: fromHand ? current.hand.filter((candidate) => candidate.instance_id !== card.instance_id) : current.hand,
    graveyard: fromYard ? current.graveyard.filter((candidate) => candidate.instance_id !== card.instance_id) : current.graveyard,
    commandZone: fromCommand ? current.commandZone.filter((candidate) => candidate.instance_id !== card.instance_id) : current.commandZone,
    ...(fromCommand ? { commanderCasts: { ...current.commanderCasts, [card.instance_id]: (current.commanderCasts[card.instance_id] ?? 0) + 1 } } : {})
  }));
  const selectedEffect = profile.modalChoices[action.mode ?? -1]?.effect;
  if (profile.modalChoices.length && !selectedEffect) throw new Error(`Debes elegir un modo válido para ${card.name}.`);
  next = pushOnStack(next, seat, card, action.targets ?? [], Boolean(fromCommand), action.variableValue ?? 0, selectedEffect, kicked, evoked, fromGraveyard);
  next = raiseEvent(next, { kind: "spell-cast", controller: seat, card });
  return logged(next, seat, `${player.name} lanza ${card.name}${additionalGeneric ? ` pagando ${additionalGeneric} de impuesto de comandante` : ""}.`);
}

function applyPlayLand(state: GameState, seat: SeatId, cardId: string): GameState {
  const player = playerAt(state, seat);
  if (!sorcerySpeed(state, seat)) throw new Error("Solo puedes jugar una tierra en tu fase principal con la pila vacía.");
  if (player.landsPlayedThisTurn >= 1) throw new Error("Ya jugaste una tierra este turno.");
  const card = player.hand.find((candidate) => candidate.instance_id === cardId);
  if (!card || !isLand(cardProfile(card))) throw new Error("Esa carta no es una tierra en tu mano.");
  let next = withPlayer(state, seat, (current) => ({
    ...current,
    hand: current.hand.filter((candidate) => candidate.instance_id !== cardId),
    landsPlayedThisTurn: current.landsPlayedThisTurn + 1
  }));
  next = putOntoBattlefield(next, seat, card, false);
  next = logged(next, seat, `${player.name} juega ${card.name}.`);
  const rule = cardProfile(card).entersTapped;
  if (rule.kind === "unless-reveal-card") {
    return {
      ...next,
      priorityOpen: false,
      pendingChoice: pendingRevealFor(next, seat, card.instance_id, rule.subtypes)
    };
  }
  return next;
}

function applyChooseReveal(state: GameState, seat: SeatId, action: Extract<GameAction, { type: "choose-reveal" }>): GameState {
  const choice = state.pendingChoice;
  if (!choice || choice.type !== "reveal-card" || choice.seat !== seat) throw new Error("No tienes una decisión de revelación pendiente.");
  if (choice.sourceId !== action.sourceId) throw new Error("Esa decisión ya no corresponde a la tierra en juego.");

  const source = playerAt(state, seat).battlefield.find((permanent) => permanent.instance_id === choice.sourceId);
  if (!source) throw new Error("La tierra que esperaba esta decisión ya no está en el campo.");

  if (choice.stage === "confirm") {
    if (!action.reveal) {
      return logged({ ...state, pendingChoice: null }, seat, `${playerAt(state, seat).name} no revela una carta; ${source.card.name} entra girada.`);
    }
    if (!choice.optionIds.length) throw new Error("No tienes una carta válida para revelar.");
    return { ...state, pendingChoice: { ...choice, stage: "card" } };
  }

  if (!action.reveal || !action.cardId || !choice.optionIds.includes(action.cardId)) {
    throw new Error("Debes elegir una carta válida para revelar.");
  }
  const revealed = playerAt(state, seat).hand.find((card) => card.instance_id === action.cardId);
  if (!revealed) throw new Error("Esa carta ya no está en tu mano.");
  const next = withPlayer({ ...state, pendingChoice: null }, seat, (player) => ({
    ...player,
    battlefield: player.battlefield.map((permanent) =>
      permanent.instance_id === source.instance_id ? { ...permanent, tapped: false } : permanent)
  }));
  // Revealing does not move the card out of the hand (CR 701.16a-b).
  return logged(next, seat, `${playerAt(next, seat).name} revela ${revealed.name}; ${source.card.name} entra enderezada.`);
}

function applyChooseTrigger(state: GameState, seat: SeatId, action: Extract<GameAction, { type: "choose-trigger" }>): GameState {
  const choice = state.pendingChoice;
  if (!choice || choice.type !== "optional-trigger" || choice.seat !== seat) throw new Error("No tienes una elección de trigger pendiente.");
  if (choice.sourceId !== action.sourceId) throw new Error("Esa elección de trigger ya no está pendiente.");
  let next: GameState = { ...state, pendingChoice: null };
  if (choice.paymentBy === "opponent") {
    if (!action.accept) {
      const source: StackObject = {
        id: choice.sourceId,
        controller: choice.sourceController ?? seat,
        card: choice.sourceCard,
        label: choice.sourceCard.name + " · habilidad opcional",
        targets: choice.targets ?? [],
        fromCommandZone: false,
        flashback: false,
        variableValue: 0,
        countered: false,
        sourcePermanentId: choice.sourcePermanentId
      };
      next = applyEffect(next, source, choice.triggerEffect);
      return logged(next, source.controller, choice.sourceCard.name + " resuelve su habilidad porque el oponente no paga.");
    }
    if (!choice.manaCost) throw new Error("La habilidad de pago no tiene coste.");
    const plan = planManaPayment(choice.manaCost, playerAt(next, seat), { state: next });
    if (!plan) throw new Error("No tienes maná suficiente para pagar.");
    next = applyManaPlan(next, seat, plan);
    const payment = payCost(choice.manaCost, playerAt(next, seat).manaPool, { availableLife: playerAt(next, seat).life });
    if (!payment) throw new Error("No se pudo pagar el coste de la habilidad.");
    next = withPlayer(next, seat, (current) => ({ ...current, manaPool: payment.remaining }));
    return logged(next, seat, playerAt(next, seat).name + " paga " + choice.manaCost.raw + " para evitar la habilidad.");
  }
  if (choice.unlessPayCost) {
    if (action.accept) {
      const plan = planManaPayment(choice.unlessPayCost, playerAt(next, seat), { state: next });
      if (!plan) throw new Error(`No puedes pagar ${choice.unlessPayCost.raw} por ${choice.sourceCard.name}.`);
      next = applyManaPlan(next, seat, plan);
      const paid = payCost(choice.unlessPayCost, playerAt(next, seat).manaPool, { availableLife: playerAt(next, seat).life });
      if (!paid) throw new Error(`No se pudo pagar ${choice.unlessPayCost.raw}.`);
      next = withPlayer(next, seat, (current) => ({ ...current, manaPool: paid.remaining, life: current.life - paid.lifePaid }));
      return logged(next, seat, `${playerAt(next, seat).name} paga ${choice.unlessPayCost.raw} para conservar ${choice.sourceCard.name}.`);
    }
    const source: StackObject = {
      id: choice.sourceId,
      controller: choice.sourceController ?? seat,
      card: choice.sourceCard,
      label: `${choice.sourceCard.name} · habilidad opcional`,
      targets: choice.targets ?? [],
      fromCommandZone: false,
      flashback: false,
      variableValue: 0,
      countered: false,
      sourcePermanentId: choice.sourcePermanentId
    };
    next = applyEffect(next, source, choice.triggerEffect);
    return logged(next, source.controller, `${choice.sourceCard.name} se sacrifica al no pagar ${choice.unlessPayCost.raw}.`);
  }
  if (!action.accept) return logged(next, seat, `${playerAt(state, seat).name} no realiza la habilidad opcional de ${choice.sourceCard.name}.`);
  const optionalCost = choice.payCost ?? choice.manaCost;
  if (optionalCost && optionalCost.symbols.length) {
    const plan = planManaPayment(optionalCost, playerAt(next, seat));
    if (!plan) throw new Error(`No puedes pagar ${optionalCost.raw} por ${choice.sourceCard.name}.`);
    next = applyManaPlan(next, seat, plan);
    const paid = payCost(optionalCost, playerAt(next, seat).manaPool, { availableLife: playerAt(next, seat).life });
    if (!paid) throw new Error(`No se pudo pagar ${optionalCost.raw}.`);
    next = withPlayer(next, seat, (current) => ({ ...current, manaPool: paid.remaining, life: current.life - paid.lifePaid }));
    next = logged(next, seat, `${playerAt(next, seat).name} paga ${optionalCost.raw} por ${choice.sourceCard.name}.`);
  }
  const source: StackObject = {
    id: choice.sourceId,
    controller: seat,
    card: choice.sourceCard,
   label: `${choice.sourceCard.name} · habilidad opcional`,
    targets: choice.targets ?? [],
   fromCommandZone: false,
   flashback: false,
   variableValue: 0,
    countered: false,
   sourcePermanentId: choice.sourcePermanentId
 };
  next = applyEffect(next, source, choice.triggerEffect);
  return logged(next, seat, `Se resuelve la habilidad opcional de ${choice.sourceCard.name}.`);
}

function applyChooseLibraryCard(state: GameState, seat: SeatId, action: Extract<GameAction, { type: "choose-library-card" }>): GameState {
  const choice = state.pendingChoice;
  if (!choice || choice.seat !== seat || (choice.type !== "search-library" && choice.type !== "search-library-multi")) throw new Error("No tienes una búsqueda de biblioteca pendiente.");
  if (choice.type === "search-library-multi") return applyChooseMultiLibraryCard(state, seat, action, choice);
  if (choice.sourceId !== action.sourceId) throw new Error("Debes elegir una carta de la búsqueda pendiente.");
  const player = playerAt(state, seat);
  const query = action.query.trim().toLocaleLowerCase();
  if (!query) throw new Error("Escribe el nombre de la carta que quieres buscar.");
  const candidates = player.library.filter((card) => choice.optionIds.includes(card.instance_id));
  const matches = candidates.filter((card) => card.name.trim().toLocaleLowerCase() === query);
  // Copies with the same name are interchangeable for a name-based search;
  // choose the first stable library entry without exposing its instance id.
  const selected = matches[0];
  if (!selected) throw new Error("La carta elegida ya no está en la biblioteca.");
  const remaining = player.library.filter((card) => card.instance_id !== selected.instance_id);
  const shuffled = shuffle(remaining, state.rngState);
  const nextLibrary = [selected, ...shuffled.items];
  let next: GameState = { ...state, pendingChoice: null, rngState: shuffled.state };
  next = withPlayer(next, seat, (current) => ({
    ...current,
    library: choice.search.destination === "top" ? nextLibrary : shuffled.items,
    hand: choice.search.destination === "hand" ? [...current.hand, selected] : current.hand,
    graveyard: [
      ...current.graveyard,
      ...(choice.search.destination === "graveyard" ? [selected] : []),
      ...(choice.returnSourceToGraveyard ? [choice.sourceCard] : [])
    ],
    exile: choice.exileSourceAfterResolution ? [...current.exile, choice.sourceCard] : current.exile
  }));
  if (choice.search.destination === "battlefield") {
    next = putOntoBattlefield(next, seat, selected, false, choice.search.tapped === true);
  }
  const destination = choice.search.destination === "top" ? "la parte superior de su biblioteca"
    : choice.search.destination === "hand" ? "su mano"
    : choice.search.destination === "graveyard" ? "su cementerio" : "el campo de batalla";
  return logged(next, seat, `${player.name} ${choice.search.reveal ? `revela ${selected.name} y la pone en ${destination}` : `pone ${selected.name} en ${destination}`}.`);
}

function finishMultiLibrarySearch(state: GameState, seat: SeatId, choice: Extract<PendingChoice, { type: "search-library-multi" }>, selectedIds: readonly string[]): GameState {
  const player = playerAt(state, seat);
  const selected = selectedIds
    .map((id) => player.library.find((card) => card.instance_id === id))
    .filter((card): card is GameCard => Boolean(card));
  const selectedSet = new Set(selected.map((card) => card.instance_id));
  const shuffled = shuffle(player.library.filter((card) => !selectedSet.has(card.instance_id)), state.rngState);
  let next: GameState = { ...state, pendingChoice: null, rngState: shuffled.state };
  const handCards = selected.filter((_, index) => choice.search.destinations[index] === "hand");
  next = withPlayer(next, seat, (current) => ({
    ...current,
    library: shuffled.items,
    hand: [...current.hand, ...handCards],
    graveyard: [
      ...current.graveyard,
      ...(choice.returnSourceToGraveyard && !choice.exileSourceAfterResolution ? [choice.sourceCard] : [])
    ],
    exile: choice.exileSourceAfterResolution ? [...current.exile, choice.sourceCard] : current.exile
  }));
  for (const [index, card] of selected.entries()) {
    if (choice.search.destinations[index] === "battlefield-tapped") next = putOntoBattlefield(next, seat, card, false, true);
  }
  const names = selected.map((card) => card.name).join(", ");
  return logged(next, seat, `${player.name} ${selected.length ? `elige ${names} y baraja su biblioteca` : "termina la búsqueda y baraja su biblioteca"}.`);
}

function applyChooseMultiLibraryCard(
  state: GameState,
  seat: SeatId,
  action: Extract<GameAction, { type: "choose-library-card" }>,
  choice: Extract<PendingChoice, { type: "search-library-multi" }>
): GameState {
  if (choice.sourceId !== action.sourceId) throw new Error("Debes elegir una carta de la búsqueda pendiente.");
  const query = action.query.trim().toLocaleLowerCase();
  if (!query) throw new Error("Escribe el nombre de la carta que quieres buscar.");
  const selectedSet = new Set(choice.selectedIds);
  const selected = playerAt(state, seat).library.find((card) => choice.optionIds.includes(card.instance_id)
    && !selectedSet.has(card.instance_id) && card.name.trim().toLocaleLowerCase() === query);
  if (!selected) throw new Error("La carta elegida ya no está en la biblioteca o ya fue elegida.");
  const selectedIds = [...choice.selectedIds, selected.instance_id];
  if (selectedIds.length >= choice.search.destinations.length) return finishMultiLibrarySearch(state, seat, choice, selectedIds);
  return logged({ ...state, pendingChoice: { ...choice, selectedIds } }, seat, `${playerAt(state, seat).name} selecciona ${selected.name}.`);
}

function applyFinishLibrarySearch(state: GameState, seat: SeatId, action: Extract<GameAction, { type: "finish-library-search" }>): GameState {
  const choice = state.pendingChoice;
  if (!choice || choice.type !== "search-library-multi" || choice.seat !== seat) throw new Error("No tienes una búsqueda múltiple pendiente.");
  if (choice.sourceId !== action.sourceId) throw new Error("Debes terminar la búsqueda pendiente.");
  return finishMultiLibrarySearch(state, seat, choice, choice.selectedIds);
}

function applyChooseScry(state: GameState, seat: SeatId, action: Extract<GameAction, { type: "choose-scry" }>): GameState {
  const choice = state.pendingChoice;
  if (!choice || choice.type !== "scry" || choice.seat !== seat) throw new Error("No tienes una elección de adivinar pendiente.");
  if (choice.sourceId !== action.sourceId) throw new Error("Debes resolver la elección de adivinar pendiente.");
  const player = playerAt(state, seat);
  const selected = action.ordinal !== undefined
    ? choice.remainingCards[action.ordinal]
    : choice.remainingCards.find((card) => card.name.trim().toLocaleLowerCase() === action.query.trim().toLocaleLowerCase());
  if (!selected) throw new Error("Debes elegir una carta visible de la selección de adivinar.");
  const remainingCards = choice.remainingCards.filter((card) => card.instance_id !== selected.instance_id);
  const topCards = action.bottom ? choice.topCards : [selected, ...choice.topCards];
  const bottomCards = action.bottom ? [...choice.bottomCards, selected] : choice.bottomCards;
  if (remainingCards.length) {
    return logged({ ...state, pendingChoice: { ...choice, remainingCards, topCards, bottomCards } }, seat,
      `${player.name} coloca ${selected.name} ${action.bottom ? "en el fondo" : "arriba"}.`);
  }
  const rest = player.library.slice(choice.remainingCards.length);
  let next = withPlayer({ ...state, pendingChoice: null }, seat, (current) => ({
    ...current,
    library: [...topCards, ...rest, ...bottomCards]
  }));
  if (choice.returnSourceToGraveyard) {
    next = withPlayer(next, choice.sourceCard.owner, (current) => choice.exileSourceAfterResolution
      ? { ...current, exile: [...current.exile, choice.sourceCard] }
      : { ...current, graveyard: [...current.graveyard, choice.sourceCard] });
  }
  if (choice.thenDraw > 0) next = drawCards(next, seat, choice.thenDraw);
  return logged(next, seat, `${player.name} termina de adivinar.`);
}

function applyChooseDraw(state: GameState, seat: SeatId, action: Extract<GameAction, { type: "choose-draw" }>): GameState {
  const choice = state.pendingChoice;
  if (!choice || choice.type !== "draw-cards" || choice.seat !== seat) throw new Error("No tienes una elección de robo pendiente.");
  if (choice.sourceId !== action.sourceId) throw new Error("Debes resolver la elección de robo pendiente.");
  const maxAmount = Math.min(choice.maxAmount, playerAt(state, seat).library.length);
  if (!Number.isInteger(action.amount) || action.amount < 0 || action.amount > maxAmount) {
    throw new Error("Debes elegir una cantidad válida de cartas para robar.");
  }
  const next = drawCards({ ...state, pendingChoice: null }, seat, action.amount);
  return logged(next, seat, action.amount === 0
    ? `${playerAt(next, seat).name} no roba cartas.`
    : `${playerAt(next, seat).name} elige robar ${action.amount} carta${action.amount === 1 ? "" : "s"}.`);
}

function applyDeclareAttackers(state: GameState, seat: SeatId, attackers: readonly AttackerDeclaration[]): GameState {
  if (state.step !== "declare-attackers" || seat !== state.activeSeat) throw new Error("No es tu paso de declarar atacantes.");
  if (state.combat.attackersDeclared) throw new Error("Los atacantes ya fueron declarados.");
  const available = new Map(legalAttackers(state, seat).map((permanent) => [permanent.instance_id, permanent]));
  const defenders = new Set(opponentsOf(state, seat));
  for (const entry of attackers) {
    if (!available.has(entry.instanceId)) throw new Error("Esa criatura no puede atacar.");
    if (!defenders.has(entry.defender)) throw new Error("Ese jugador no puede ser atacado.");
  }
  const unique = new Set(attackers.map((entry) => entry.instanceId));
  if (unique.size !== attackers.length) throw new Error("Una criatura no puede atacar dos veces.");
  const byDefender = new Map<SeatId, number>();
  for (const entry of attackers) byDefender.set(entry.defender, (byDefender.get(entry.defender) ?? 0) + 1);
  for (const [defender, count] of byDefender) {
    const limit = maxAttackersForDefender(state, defender);
    if (limit !== null && count > limit) throw new Error(`No puedes atacar a ese jugador con más de ${limit} criatura${limit === 1 ? "" : "s"}.`);
  }
  // Attack requirements are checked against the whole declaration (CR 508.1d).
  const missing = requiredAttackers(state, seat).find((permanent) => !unique.has(permanent.instance_id));
  if (missing) throw new Error(`${missing.card.name} ataca en cada combate si puede.`);

  let next: GameState = { ...state, combat: { ...state.combat, attackers: [...attackers], attackersDeclared: true } };
  next = tapAttackers(next, attackers);
  // Attack triggers fire once the whole declaration is made (CR 508.1i).
  for (const entry of attackers) {
    const attacker = findPermanent(next, entry.instanceId);
    if (attacker) next = raiseEvent(next, { kind: "attacks", permanentId: attacker.instance_id, controller: attacker.controller, card: attacker.card, defender: entry.defender });
  }
  next = { ...next, passedSeats: [], prioritySeat: seat, priorityOpen: true };
  if (attackers.length) {
    const names = attackers.map((entry) => findPermanent(next, entry.instanceId)?.card.name ?? "criatura").join(", ");
    next = logged(next, seat, `${playerAt(next, seat).name} ataca con ${names}.`);
  } else {
    next = logged(next, seat, `${playerAt(next, seat).name} no ataca.`);
  }
  return next;
}

function applyDeclareBlockers(state: GameState, seat: SeatId, blockers: readonly BlockerDeclaration[]): GameState {
  if (state.step !== "declare-blockers") throw new Error("No es el paso de declarar bloqueadores.");
  if (state.combat.blockersDeclared) throw new Error("Los bloqueadores ya fueron declarados.");
  if (!defendersAwaitingBlocks(state).includes(seat)) throw new Error("No estás siendo atacado.");
  const own = new Set(playerAt(state, seat).battlefield.map((permanent) => permanent.instance_id));
  for (const entry of blockers) {
    if (!own.has(entry.instanceId)) throw new Error("Esa criatura no es tuya.");
    const attacker = findPermanent(state, entry.attackerId);
    const blocker = findPermanent(state, entry.instanceId);
    const declaration = state.combat.attackers.find((candidate) => candidate.instanceId === entry.attackerId);
    if (!attacker || !blocker || !declaration || declaration.defender !== seat) throw new Error("Esa criatura no te está atacando.");
    if (!canBlock(state, attacker, blocker)) throw new Error(`${blocker.card.name} no puede bloquear a ${attacker.card.name}.`);
  }
  const unique = new Set(blockers.map((entry) => entry.instanceId));
  if (unique.size !== blockers.length) throw new Error("Una criatura solo puede bloquear a un atacante.");

  // Menace needs at least two blockers, so a single-blocker assignment is illegal.
  for (const declaration of state.combat.attackers) {
    const attacker = findPermanent(state, declaration.instanceId);
    if (!attacker || !keywordOf(state, attacker, "menace")) continue;
    const assigned = blockers.filter((entry) => entry.attackerId === declaration.instanceId).length;
    if (assigned === 1) throw new Error(`${attacker.card.name} tiene amenaza y no puede ser bloqueada por una sola criatura.`);
  }

  const remaining = defendersAwaitingBlocks(state).filter((candidate) => candidate !== seat);
  let next: GameState = {
    ...state,
    combat: {
      ...state.combat,
      blockers: [...state.combat.blockers, ...blockers],
      blockersDeclared: remaining.length === 0
    }
  };
  // Block triggers fire once this defender's declaration is complete (CR 509.1h).
  for (const entry of blockers) {
    const blocker = findPermanent(next, entry.instanceId);
    if (blocker) next = raiseEvent(next, { kind: "blocks", permanentId: blocker.instance_id, controller: blocker.controller, card: blocker.card });
  }
  if (blockers.length) {
    const names = blockers.map((entry) => findPermanent(next, entry.instanceId)?.card.name ?? "criatura").join(", ");
    next = logged(next, seat, `${playerAt(next, seat).name} bloquea con ${names}.`);
  } else {
    next = logged(next, seat, `${playerAt(next, seat).name} no bloquea.`);
  }
  if (next.combat.blockersDeclared) next = { ...next, passedSeats: [], prioritySeat: next.activeSeat, priorityOpen: true };
  return next;
}

function applyPass(state: GameState, seat: SeatId): GameState {
  if (!state.priorityOpen) throw new Error(`No hay prioridad abierta durante ${STEP_LABELS[state.step]}.`);
  if (state.prioritySeat !== seat) throw new Error("No tienes la prioridad.");
  const passed = state.passedSeats.includes(seat) ? state.passedSeats : [...state.passedSeats, seat];
  const alive = livingSeats(state);
  const everyonePassed = alive.every((candidate) => passed.includes(candidate));
  if (!everyonePassed) return { ...state, passedSeats: passed, prioritySeat: nextLivingSeat(state, seat) };
  if (state.stack.length) {
    const resolved = resolveTop({ ...state, passedSeats: [] });
    return { ...resolved, prioritySeat: resolved.activeSeat, priorityOpen: true, passedSeats: [] };
  }
  return advanceStep({ ...state, passedSeats: [] });
}

/** Places one waiting required trigger on the stack before priority resumes. */
/** Human-readable name of one target, used by the log and the client. */
function targetLabel(state: GameState, target: Target): string {
  if (target.kind === "player") return playerAt(state, target.seat).name;
  if (target.kind === "permanent") return findPermanent(state, target.instanceId)?.card.name ?? "permanente";
  if (target.kind === "graveyard-card") return playerAt(state, target.seat).graveyard.find((card) => card.instance_id === target.instanceId)?.name ?? "carta del cementerio";
  return state.stack.find((entry) => entry.id === target.stackId)?.card.name ?? "hechizo";
}

function triggerStackObject(trigger: TriggerInstance, targets: readonly Target[]): StackObject {
  return {
    id: trigger.id,
    controller: trigger.controller,
    card: trigger.sourceCard,
    label: `${trigger.sourceCard.name} · ${TRIGGER_EVENT_LABELS[trigger.definition.event]}`,
    targets,
    fromCommandZone: false,
    flashback: false,
    variableValue: 0,
    countered: false,
    trigger
  };
}

/**
 * Order the queued triggers in APNAP order (CR 603.3b).
 *
 * The active player puts theirs onto the stack first, then each other player in
 * turn order. Because the stack is last-in first-out, that means the active
 * player's triggers resolve last. Ties inside one seat keep the order the
 * events happened in, which keeps the whole engine deterministic.
 */
function apnapOrder(state: GameState): readonly TriggerInstance[] {
  const seats = state.players.length;
  const distance = (seat: SeatId) => (seat - state.activeSeat + seats) % seats;
  return [...state.triggerQueue]
    .map((trigger, index) => ({ trigger, index }))
    .sort((left, right) => distance(left.trigger.controller) - distance(right.trigger.controller) || left.index - right.index)
    .map((entry) => entry.trigger);
}

/**
 * Puts the next queued trigger onto the stack.
 *
 * Triggers do not wait for an empty stack: they go on top of whatever is there
 * the next time a player would receive priority. A trigger that needs a target
 * gets one here, before anybody can respond — automatically when exactly one is
 * legal, through a real choice when several are, and by being removed from the
 * stack entirely when none is (CR 603.3d).
 */
function putNextTriggerOnStack(state: GameState): GameState {
  const ordered = apnapOrder(state);
  const trigger = ordered[0];
  if (!trigger) return state;
  const remaining = state.triggerQueue.filter((candidate) => candidate.id !== trigger.id);
  const active = playerAt(state, state.activeSeat).lost ? nextLivingSeat(state, state.activeSeat) : state.activeSeat;
  const opened = { prioritySeat: active, priorityOpen: true, passedSeats: [] as SeatId[] };

  // A trigger whose source's controller has already lost never reaches the stack.
  if (playerAt(state, trigger.controller).lost) return { ...state, triggerQueue: remaining };

  const targetKind = trigger.definition.targetKind;
  if (targetKind === "none") {
    return { ...state, triggerQueue: remaining, stack: [...state.stack, triggerStackObject(trigger, [])], ...opened };
  }

  const options = legalTargets(state, trigger.controller, targetKind);
  if (!options.length) {
    const dropped = logged({ ...state, triggerQueue: remaining }, trigger.controller,
      `La habilidad disparada de ${trigger.sourceCard.name} se retira de la pila: no hay objetivo legal.`);
    return dropped;
  }
  if (options.length === 1) {
    return { ...state, triggerQueue: remaining, stack: [...state.stack, triggerStackObject(trigger, options)], ...opened };
  }
  return {
    ...state,
    triggerQueue: remaining,
    pendingChoice: {
      type: "trigger-target",
      seat: trigger.controller,
      sourceId: trigger.id,
      trigger,
      targetKind,
      options
    }
  };
}

function applyChooseTriggerTarget(state: GameState, seat: SeatId, action: Extract<GameAction, { type: "choose-trigger-target" }>): GameState {
  const choice = state.pendingChoice;
  if (!choice || choice.type !== "trigger-target" || choice.seat !== seat) throw new Error("No tienes un objetivo de habilidad pendiente.");
  if (choice.sourceId !== action.sourceId) throw new Error("Esa habilidad ya no espera un objetivo.");
  const valid = choice.options.some((option) => JSON.stringify(option) === JSON.stringify(action.target));
  if (!valid) throw new Error(`Objetivo ilegal para ${choice.trigger.sourceCard.name}.`);
  const active = playerAt(state, state.activeSeat).lost ? nextLivingSeat(state, state.activeSeat) : state.activeSeat;
  const next: GameState = {
    ...state,
    pendingChoice: null,
    stack: [...state.stack, triggerStackObject(choice.trigger, [action.target])],
    prioritySeat: active,
    priorityOpen: true,
    passedSeats: []
  };
  return logged(next, seat, `${choice.trigger.sourceCard.name} apunta a ${targetLabel(state, action.target)}.`);
}

function applyChooseDiscard(state: GameState, seat: SeatId, action: Extract<GameAction, { type: "choose-discard" }>): GameState {
  const choice = state.pendingChoice;
  if (!choice || choice.type !== "discard-cards" || choice.seat !== seat) throw new Error("No tienes una elección de descarte pendiente.");
  if (choice.sourceId !== action.sourceId) throw new Error("Ese descarte ya no corresponde a la habilidad pendiente.");
  const card = playerAt(state, seat).hand.find((candidate) => candidate.instance_id === action.cardId);
  if (!card) throw new Error("Debes elegir una carta de tu mano.");
  const remaining = choice.remaining - 1;
  const next = withPlayer({
    ...state,
    pendingChoice: remaining > 0 ? { ...choice, remaining } : null
  }, seat, (player) => ({
    ...player,
    hand: player.hand.filter((candidate) => candidate.instance_id !== card.instance_id),
    graveyard: [...player.graveyard, card]
  }));
  return logged(next, seat, `${playerAt(next, seat).name} descarta ${card.name}.`);
}

/** Applies one action for one seat, then settles the game to its next decision point. */
export function applyAction(state: GameState, seat: SeatId, action: GameAction): GameState {
  if (state.finished) throw new Error("La partida ya terminó.");
  const player = playerAt(state, seat);
  if (player.lost) throw new Error("Ese jugador ya está eliminado.");

  let next: GameState;
  switch (action.type) {
    case "pass": next = applyPass(state, seat); break;
    case "play-land": next = applyPlayLand(state, seat, action.cardId); break;
    case "cast": next = applyCast(state, seat, action); break;
    case "cycle": next = applyCycle(state, seat, action); break;
    case "equip": next = applyEquip(state, seat, action); break;
    case "activate-mana": next = applyActivateMana(state, seat, action); break;
    case "activate": next = applyActivate(state, seat, action); break;
    case "choose-reveal": next = applyChooseReveal(state, seat, action); break;
    case "choose-trigger": next = applyChooseTrigger(state, seat, action); break;
    case "choose-trigger-target": next = applyChooseTriggerTarget(state, seat, action); break;
    case "choose-library-card": next = applyChooseLibraryCard(state, seat, action); break;
    case "finish-library-search": next = applyFinishLibrarySearch(state, seat, action); break;
    case "choose-scry": next = applyChooseScry(state, seat, action); break;
    case "choose-draw": next = applyChooseDraw(state, seat, action); break;
    case "choose-discard": next = applyChooseDiscard(state, seat, action); break;
    case "declare-attackers": next = applyDeclareAttackers(state, seat, action.attackers); break;
    case "declare-blockers": next = applyDeclareBlockers(state, seat, action.blockers); break;
    case "concede": {
      next = withPlayer(state, seat, (current) => ({ ...current, lost: true, lossReason: "concedió" }));
      next = logged(next, seat, `${player.name} concede la partida.`);
      break;
    }
  }
  return settle({ ...next, version: next.version + 1 });
}

// ---------------------------------------------------------------------------
// Settling: turn-based actions, state-based actions and automatic passes
// ---------------------------------------------------------------------------

/**
 * True when the seat has something to decide beyond passing.
 *
 * Mana abilities are deliberately excluded from "something to decide",
 * because counting them would stop the table in every priority window:
 *
 * - Mana abilities. Floating mana achieves nothing on its own, and the payment
 *   solver taps sources automatically when a cost is actually paid, so holding
 *   priority to add mana is never the decision a player owes.
 * Non-mana activations are real smart-priority stops even outside sorcery
 * speed. This preserves narrow response windows such as cracking a fetch land
 * or activating a permanent in response to an opponent's spell (CR 117.1b,
 * 602.1), while mana is still produced by the payment solver when needed.
 */
export function hasRealChoice(state: GameState, seat: SeatId): boolean {
  return legalActions(state, seat).some((entry) => {
    if (entry.action.type === "pass" || entry.action.type === "concede") return false;
    if (entry.action.type === "activate-mana") return false;
    if (entry.action.type === "activate") return true;
    return true;
  });
}

function shouldAutoPass(state: GameState, seat: SeatId): boolean {
  const player = playerAt(state, seat);
  if (!player.autoPass) return false;
  // Keep the active player's main phase as a playable checkpoint. This avoids
  // collapsing an empty human turn together with every bot turn in one action
  // response, while still skipping upkeep/combat/end-step windows with no
  // relevant response.
  if (state.stack.length === 0 && state.activeSeat === seat && MAIN_STEPS.includes(state.step)) return false;
  return !hasRealChoice(state, seat);
}

/**
 * Drives the game forward until a player actually has to choose something.
 *
 * This is what keeps the table alive: steps without priority resolve
 * themselves, combat declarations nobody can make are auto-submitted, and a
 * seat with no legal option other than passing passes automatically.
 */
export function settle(state: GameState): GameState {
  let next = state;
  for (let guard = 0; guard < 4096; guard += 1) {
    next = applyStateBasedActions(next);
    next = pruneCombat(next);
    if (next.finished) return next;

    // A land's "as it enters" choice is resolved before the game can open
    // priority again. It is a real decision, so leave it projected to the
    // controller instead of advancing the turn while it is pending.
    if (next.pendingChoice) return next;

    // Triggers reach the stack before priority, on top of whatever is already
    // there (CR 603.3), so an ETB never has to wait for the stack to empty.
    if (next.triggerQueue.length) {
      next = putNextTriggerOnStack(next);
      continue;
    }

    if (!next.priorityOpen) { next = advanceStep(next); continue; }

    if (playerAt(next, next.prioritySeat).lost) {
      next = { ...next, prioritySeat: nextLivingSeat(next, next.prioritySeat) };
      continue;
    }

    if (next.step === "declare-attackers" && !next.combat.attackersDeclared) {
      const active = next.activeSeat;
      if (!legalAttackers(next, active).length || playerAt(next, active).lost) {
        next = applyDeclareAttackers(next, active, []);
        continue;
      }
      return next; // The active player must declare attackers.
    }

    if (next.step === "declare-blockers" && !next.combat.blockersDeclared) {
      const waiting = defendersAwaitingBlocks(next);
      if (!waiting.length) {
        next = { ...next, combat: { ...next.combat, blockersDeclared: true }, passedSeats: [], prioritySeat: next.activeSeat };
        continue;
      }
      const idle = waiting.find((seat) => !legalBlockers(next, seat).length);
      if (idle !== undefined) { next = applyDeclareBlockers(next, idle, []); continue; }
      return next; // A defender must declare blockers.
    }

    const seat = next.prioritySeat;
    const player = playerAt(next, seat);
    if (shouldAutoPass(next, seat)) { next = applyPass(next, seat); continue; }
    return next;
  }
  throw new Error("El motor no pudo estabilizar la partida; posible bucle de reglas.");
}

/** Seats that currently owe a decision. */
export function seatsToAct(state: GameState): SeatId[] {
  if (state.finished) return [];
  if (state.pendingChoice) return [state.pendingChoice.seat];
  if (state.step === "declare-attackers" && !state.combat.attackersDeclared) return [state.activeSeat];
  if (state.step === "declare-blockers" && !state.combat.blockersDeclared) return defendersAwaitingBlocks(state);
  return state.priorityOpen ? [state.prioritySeat] : [];
}
