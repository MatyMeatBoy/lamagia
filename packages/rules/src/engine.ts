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
  cardProfile, isCreature, isLand, TRIGGER_EVENT_LABELS, type ActivatedAbility, type CardData, type CardProfile, type CardType, type CounterCost, type EnforcedKeyword, type ManaAbility, type SpellEffect, type TargetKind, type TriggerDefinition, type TriggerEvent
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
  /** Layer 7c modifications that expire in the cleanup step. */
  readonly powerModifier: number;
  readonly toughnessModifier: number;
  /** Keyword effects from spells/abilities that expire during cleanup. */
  readonly temporaryKeywords?: readonly EnforcedKeyword[];
  /** The creature this Equipment is attached to, when it is equipped. */
  readonly attachedTo?: string;
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
  readonly variableValue: number;
  readonly countered: boolean;
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
  | { readonly kind: "dies"; readonly permanentId: string; readonly controller: SeatId; readonly card: GameCard }
  | { readonly kind: "attacks"; readonly permanentId: string; readonly controller: SeatId; readonly card: GameCard }
  | { readonly kind: "blocks"; readonly permanentId: string; readonly controller: SeatId; readonly card: GameCard }
  | { readonly kind: "deals-combat-damage-to-player"; readonly permanentId: string; readonly controller: SeatId; readonly card: GameCard; readonly victim: SeatId }
  | { readonly kind: "becomes-tapped"; readonly permanentId: string; readonly controller: SeatId; readonly card: GameCard }
  | { readonly kind: "spell-cast"; readonly controller: SeatId; readonly card: GameCard }
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
    }
  | {
      readonly type: "discard-cards";
      readonly seat: SeatId;
      readonly sourceId: string;
      readonly sourceCard: GameCard;
      readonly amount: number;
      readonly remaining: number;
    };

export type GameAction =
  | { readonly type: "pass" }
  | { readonly type: "play-land"; readonly cardId: string }
  | { readonly type: "cast"; readonly cardId: string; readonly targets?: readonly Target[]; readonly variableValue?: number; readonly mode?: number }
  | { readonly type: "cycle"; readonly cardId: string }
  | { readonly type: "equip"; readonly sourceId: string; readonly targetId?: string }
  | { readonly type: "activate-mana"; readonly sourceId: string; readonly abilityIndex: number; readonly mana: ManaType }
  | { readonly type: "activate"; readonly sourceId: string; readonly abilityIndex: number; readonly targets?: readonly Target[] }
  | { readonly type: "choose-reveal"; readonly sourceId: string; readonly reveal: boolean; readonly cardId?: string }
  | { readonly type: "choose-trigger"; readonly sourceId: string; readonly accept: boolean }
  | { readonly type: "choose-trigger-target"; readonly sourceId: string; readonly target: Target }
  /** The query is a player intent; the library instance id never leaves the server. */
  | { readonly type: "choose-library-card"; readonly sourceId: string; readonly query: string }
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
export function powerOf(permanent: Permanent, state?: GameState): number {
  const profile = cardProfile(permanent.card);
  const level = state ? profile.levelDefinitions.filter((definition) => {
    const count = permanent.counters.level ?? 0;
    return count >= definition.minLevel && (definition.maxLevel === undefined || count <= definition.maxLevel);
  }).at(-1) : undefined;
  return (level?.power ?? profile.power ?? 0) + counterModifier(permanent) + permanent.powerModifier + equipmentBonus(state, permanent).power;
}
export function toughnessOf(permanent: Permanent, state?: GameState): number {
  const profile = cardProfile(permanent.card);
  const level = state ? profile.levelDefinitions.filter((definition) => {
    const count = permanent.counters.level ?? 0;
    return count >= definition.minLevel && (definition.maxLevel === undefined || count <= definition.maxLevel);
  }).at(-1) : undefined;
  return (level?.toughness ?? profile.toughness ?? 0) + counterModifier(permanent) + permanent.toughnessModifier + equipmentBonus(state, permanent).toughness;
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
  readonly lifeCost: number;
  readonly requiresTap: boolean;
  readonly removeCounters?: readonly CounterCost[];
}

/** Rule 302.6 applies to a creature's own tap ability, including Llanowar Elves. */
function canUseManaAbility(player: PlayerState, permanent: Permanent, ability: ManaAbility): boolean {
  if (ability.requiresTap && permanent.tapped) return false;
  if (ability.requiresTap && permanent.summoningSick && isCreature(cardProfile(permanent.card))) return false;
  if (ability.lifeCost >= player.life) return false;
  if (ability.requiresLands !== undefined && player.battlefield.filter((candidate) => isLand(cardProfile(candidate.card))).length < ability.requiresLands) return false;
  return (ability.removeCounters ?? []).every((cost) => (permanent.counters[cost.kind] ?? 0) >= cost.amount);
}

/** Untapped permanents this player can currently tap for mana. */
export function manaSources(player: PlayerState): ManaSource[] {
  const sources: ManaSource[] = [];
  for (const permanent of player.battlefield) {
    const profile = cardProfile(permanent.card);
    for (const ability of profile.manaAbilities) {
      if (!canUseManaAbility(player, permanent, ability)) continue;
      sources.push({
        permanentId: permanent.instance_id,
        abilityIndex: ability.index,
        name: permanent.card.name,
        options: ability.produces,
        amount: ability.amount,
        ...(ability.fixedProduces ? { fixedProduces: ability.fixedProduces } : {}),
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
    byPermanent.set(source.permanentId, Math.max(byPermanent.get(source.permanentId) ?? 0, source.amount));
  }
  return [...byPermanent.values()].reduce((total, amount) => total + amount, 0);
}

/** Maximum mana currently available from untapped sources, excluding the pool. */
export function manaSourcePotential(player: PlayerState): number {
  return manaSourceCapacity(manaSources(player));
}

export interface ManaPlan {
  readonly taps: readonly { readonly permanentId: string; readonly abilityIndex: number; readonly type: ManaType; readonly amount: number; readonly lifeCost: number; readonly requiresTap: boolean; readonly removeCounters?: readonly CounterCost[] }[];
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
  return `${[...(source.fixedProduces ?? source.options)].sort().join("")}|${source.amount}|${source.lifeCost}|${counters}`;
}

function sourceTap(source: ManaSource, type: ManaType): Tap {
  return {
    permanentId: source.permanentId,
    abilityIndex: source.abilityIndex,
    type,
    amount: source.amount,
    lifeCost: source.lifeCost,
    requiresTap: source.requiresTap,
    ...(source.removeCounters ? { removeCounters: source.removeCounters } : {})
  };
}

function addSourceOutput(pool: ManaPool, source: ManaSource, chosen: ManaType): ManaPool {
  if (!source.fixedProduces) return addMana(pool, chosen, source.amount);
  return source.fixedProduces.reduce((current, mana) => addMana(current, mana, 1), pool);
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
  options: { readonly variableValue?: number; readonly additionalGeneric?: number } = {}
): ManaPlan | null {
  const startingPool = player.manaPool;
  const sources = manaSources(player);
  const variableValue = options.variableValue ?? 0;
  const additionalGeneric = options.additionalGeneric ?? 0;
  const variableCount = cost.symbols.filter((symbol) => symbol.kind === "variable").length;
  const needed = cost.manaValue + variableValue * variableCount + additionalGeneric;
  if (poolTotal(startingPool) + manaSourceCapacity(sources) < needed) return null;

  const payOptions = (lifeSpent: number) => ({ variableValue, additionalGeneric, availableLife: player.life - lifeSpent });
  const ordered = [...sources].sort((left, right) =>
    left.options.length - right.options.length ||
    left.lifeCost - right.lifeCost ||
    right.amount - left.amount ||
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
      .sort((left, right) => right.amount - left.amount || left.lifeCost - right.lifeCost || left.permanentId.localeCompare(right.permanentId));
    let index = 0;
    for (;;) {
      const payment = payCost(cost, currentPool, payOptions(currentLife));
      if (payment) return { taps: currentTaps, pool: currentPool, lifeCost: currentLife };
      if (index >= spare.length) return null;
      const source = spare[index]!;
      index += 1;
      if (player.life - currentLife - source.lifeCost <= 0) continue;
      // Prefer a colour the cost still asks for; otherwise any option works for generic.
      const type = source.options.find((candidate) => wanted.has(candidate)) ?? source.options[0]!;
      currentPool = addSourceOutput(currentPool, source, type);
      currentTaps = [...currentTaps, sourceTap(source, type)];
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
      if (player.life - lifeSpent - source.lifeCost <= 0) continue;
      for (const type of requirement) {
        if (!source.options.includes(type)) continue;
        const result = solve(
          index + 1,
          addSourceOutput(produced, source, type),
          { ...reserved, [type]: reserved[type] + 1 },
          new Set([...used, source.permanentId]),
          [...taps, sourceTap(source, type)],
          lifeSpent + source.lifeCost
        );
        if (result) return result;
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

function putOntoBattlefield(state: GameState, seat: SeatId, card: GameCard, isCommander: boolean, forceTapped = false): GameState {
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
    counters: Object.fromEntries(profile.entersWithCounters.map((counter) => [counter.kind, counter.amount])),
    powerModifier: 0,
    toughnessModifier: 0,
    temporaryKeywords: [],
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
    if (subject === "you") return event.controller === watcher.controller;
    if (subject === "opponent") return event.controller !== watcher.controller;
    if (subject === "each-player") return true;
    return false;
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
    // Rule 109.5: "another" excludes the object the ability is printed on.
    case "another-creature-you-control": return !isSelf && objectIsCreature && object.controller === watcher.controller;
    case "creature-you-control": return objectIsCreature && object.controller === watcher.controller;
    case "artifact-creature-you-control": {
      const profile = cardProfile(object.card);
      return objectIsCreature && profile.types.includes("Artifact") && object.controller === watcher.controller;
    }
    case "land-you-control": return isLand(cardProfile(object.card)) && object.controller === watcher.controller;
    case "another-creature": return !isSelf && objectIsCreature;
    case "any-creature": return objectIsCreature;
    default: return false;
  }
}

function causeOf(state: GameState, event: GameEvent): string {
  const object = eventObject(event);
  switch (event.kind) {
    case "enters-battlefield": return `${object!.card.name} entra al campo de batalla`;
    case "dies": return `${object!.card.name} muere`;
    case "attacks": return `${object!.card.name} ataca`;
    case "blocks": return `${object!.card.name} bloquea`;
    case "deals-combat-damage-to-player": return `${object!.card.name} hace daño de combate a ${playerAt(state, event.victim).name}`;
    case "becomes-tapped": return `${object!.card.name} se gira`;
    case "spell-cast": return `${playerAt(state, event.controller).name} lanza ${event.card.name}`;
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
      queued.push({
        id: `trigger:${state.version}:${state.triggerQueue.length + queued.length}:${watcher.instance_id}:${index}`,
        controller: watcher.controller,
        sourcePermanentId: watcher.instance_id,
        sourceCard: watcher.card,
        definition,
        cause: causeOf(state, event)
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
  return player.hand.filter((card) => cardProfile(card).subtypes.some((subtype) => wanted.has(subtype.toLowerCase())));
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
    case "draw": return drawCards(state, controller, effectAmount(effect.amount, object));
    case "draw-target-player": {
      const target = object.targets[0];
      return target?.kind === "player" ? drawCards(state, target.seat, effectAmount(effect.amount, object)) : state;
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
      const amount = effectAmount(effect.amount, object);
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
      const amount = effectAmount(effect.amount, object);
      const next = withPlayer(state, target.seat, (player) => ({ ...player, life: player.life + amount }));
      return logged(raiseEvent(next, { kind: "life-gained", seat: target.seat, amount }), controller, `${playerAt(next, target.seat).name} gana ${amount} vidas.`);
    }
    case "each-player-gains-life": {
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
    case "damage-each-opponent": {
      let next = state;
      for (const seat of opponentsOf(state, controller)) next = dealDamageToPlayer(next, seat, effectAmount(effect.amount, object), sourceName);
      return next;
    }
    case "damage-all-creatures": {
      let next = state;
      const amount = effectAmount(effect.amount, object);
      for (const permanent of allPermanents(state)) {
        if (!isCreature(cardProfile(permanent.card))) continue;
        if (effect.excludeSource && permanent.instance_id === object.card.instance_id) continue;
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
    case "damage-any-target": {
      const target = object.targets[0];
      if (!target) return state;
      const amount = effectAmount(effect.amount, object);
      if (target.kind === "player") return dealDamageToPlayer(state, target.seat, amount, sourceName);
      if (target.kind === "permanent") return dealDamageToPermanent(state, target.instanceId, amount, false, sourceName);
      return state;
    }
    case "modify-all-creatures": {
      const next = modifyCreatures(state, effect.power, effect.toughness, () => true);
      return logged(next, controller, `${sourceName} modifica a todas las criaturas hasta el final del turno.`);
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
      const source = object.sourcePermanentId ? findPermanent(state, object.sourcePermanentId) : undefined;
      if (!source || !isCreature(cardProfile(source.card))) return state;
      return modifyCreatures(state, effect.power, effect.toughness, (candidate) => candidate.instance_id === source.instance_id);
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
      if (!permanent || keywordOf(state, permanent, "indestructible")) return state;
      return movePermanentToZone(state, permanent, "graveyard");
    }
    case "destroy-target-permanent": {
      const target = object.targets[0];
      if (!target || target.kind !== "permanent") return state;
      const permanent = findPermanent(state, target.instanceId);
      if (!permanent || keywordOf(state, permanent, "indestructible")) return state;
      return movePermanentToZone(state, permanent, "graveyard");
    }
    case "exile-target-permanent": {
      const target = object.targets[0];
      if (!target || target.kind !== "permanent") return state;
      const permanent = findPermanent(state, target.instanceId);
      return permanent ? movePermanentToZone(state, permanent, "exile") : state;
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
    case "destroy-all-creatures": {
      let next = state;
      for (const permanent of allPermanents(state)) {
        if (!isCreature(cardProfile(permanent.card)) || keywordOf(state, permanent, "indestructible")) continue;
        next = movePermanentToZone(next, permanent, "graveyard");
      }
      return logged(next, controller, `${sourceName} destruye todas las criaturas.`);
    }
    case "destroy-all-artifacts-creatures-enchantments": {
      let next = state;
      for (const permanent of allPermanents(state)) {
        const profile = cardProfile(permanent.card);
        const affected = profile.types.some((type) => ["Artifact", "Creature", "Enchantment"].includes(type));
        if (!affected || keywordOf(state, permanent, "indestructible")) continue;
        next = movePermanentToZone(next, permanent, "graveyard");
      }
      return logged(next, controller, `${sourceName} destruye artifacts, criaturas y encantamientos.`);
    }
    case "counter-target-spell": {
      const target = object.targets[0];
      if (!target || target.kind !== "spell") return state;
      return { ...state, stack: state.stack.map((entry) => (entry.id === target.stackId ? { ...entry, countered: true } : entry)) };
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
          if (!isCreature(profile) || !profile.subtypes.some((candidate) => candidate.toLowerCase() === subtype)) return permanent;
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
    case "create-token": {
      const amount = effect.amount === "lands-you-control"
        ? playerAt(state, controller).battlefield.filter((permanent) => isLand(cardProfile(permanent.card))).length
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

function resolveTop(state: GameState): GameState {
  const object = state.stack.at(-1);
  if (!object) return state;
  let next: GameState = { ...state, stack: state.stack.slice(0, -1) };
  const profile = cardProfile(object.card);

  if (object.countered) {
    if (object.trigger) return logged(next, object.controller, `Se contrarresta la habilidad disparada de ${object.card.name}.`);
    if (object.activated) return logged(next, object.controller, `Se contrarresta la habilidad activada de ${object.card.name}.`);
    next = withPlayer(next, object.card.owner, (player) => ({ ...player, graveyard: [...player.graveyard, object.card] }));
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
    next = withPlayer(next, object.card.owner, (player) => ({ ...player, graveyard: [...player.graveyard, object.card] }));
    return logged(next, object.controller, `${object.card.name} se contrarresta: sus objetivos ya no son legales.`);
  }

  if (object.trigger) {
    if (object.trigger.definition.optional) {
      return {
        ...next,
        pendingChoice: {
          type: "optional-trigger",
          seat: object.controller,
          sourceId: object.trigger.id,
          triggerEffect: object.trigger.definition.effect,
          sourceCard: object.trigger.sourceCard
        }
      };
    }
    const nextEffect = applyEffect(next, object, object.trigger.definition.effect);
    return logged(nextEffect, object.controller,
      `Se resuelve la ${TRIGGER_EVENT_LABELS[object.trigger.definition.event]} de ${object.card.name}.`);
  }

  const activatedEffect = object.activated?.effect;
  const selectedEffect = object.selectedEffect;
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
            : profile.subtypes.some((value) => value.toLowerCase() === subtype.toLowerCase()));
        return typeMatches && subtypeMatches;
      })
      .map((card) => card.instance_id);
    if (!options.length) {
      if (!object.activated) next = withPlayer(next, object.card.owner, (player) => ({ ...player, graveyard: [...player.graveyard, object.card] }));
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
        returnSourceToGraveyard: !object.activated
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
    return withPlayer(next, object.card.owner, (player) => ({ ...player, graveyard: [...player.graveyard, object.card] }));
  }

  if (profile.isPermanent) {
    next = putOntoBattlefield(next, object.controller, object.card, object.fromCommandZone || playerAt(next, object.card.owner).commanderIds.includes(object.card.instance_id));
    next = logged(next, object.controller, `${playerAt(next, object.controller).name} resuelve ${object.card.name} al campo de batalla.`);
    return next;
  }

  for (const effect of profile.effects) next = applyEffect(next, object, effect);
  if (!profile.effects.length) {
    next = logged(next, object.controller, `${object.card.name} se resuelve sin efecto: su texto todavía no está implementado.`);
  }
  next = withPlayer(next, object.card.owner, (player) => ({ ...player, graveyard: [...player.graveyard, object.card] }));
  return next;
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

    for (const permanent of allPermanents(next)) {
      const profile = cardProfile(permanent.card);
      if (!isCreature(profile)) continue;
      const toughness = toughnessOf(permanent, next);
      const lethal = toughness <= 0 || (permanent.damage > 0 && permanent.damage >= toughness) || permanent.deathtouched;
      if (!lethal) continue;
      if (keywordOf(next, permanent, "indestructible") && toughness > 0 && permanent.damage < toughness && !permanent.deathtouched) continue;
      if (keywordOf(next, permanent, "indestructible") && toughness > 0) continue;
      next = movePermanentToZone(next, permanent, "graveyard");
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
  if (permanent.summoningSick && !profile.keywords.includes("haste")) return false;
  void state;
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
  if (blockerProfile.combatRules.cannotBlock) return false;
  const attackerProfile = cardProfile(attacker.card);
  if (attackerProfile.combatRules.cannotBeBlocked) return false;
  if (attackerProfile.keywords.includes("flying") && !blockerProfile.keywords.includes("flying") && !blockerProfile.keywords.includes("reach")) return false;
  // "Can block only creatures with X" is an evasion check read from the blocker.
  const only = blockerProfile.combatRules.blocksOnlyWithKeyword;
  if (only && !attackerProfile.keywords.includes(only)) return false;
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

function beginStep(state: GameState, step: TurnStep): GameState {
  let next: GameState = { ...state, step, passedSeats: [], prioritySeat: state.activeSeat };
  next = emptyManaPools(next);

  switch (step) {
    case "untap": {
      next = withPlayer(next, next.activeSeat, (player) => ({
        ...player,
        landsPlayedThisTurn: 0,
        battlefield: player.battlefield.map((permanent) => ({ ...permanent, tapped: false, summoningSick: false }))
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
      if (excess > 0) {
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
          battlefield: current.battlefield.map((permanent) => ({ ...permanent, damage: 0, deathtouched: false, powerModifier: 0, toughnessModifier: 0, temporaryKeywords: [] }))
        }))
      };
      break;
    }
    default: break;
  }

  // Turn-structure triggers are raised as the step begins, before priority
  // opens, so they are already queued when a player would first receive it.
  if (step === "upkeep") next = raiseEvent(next, { kind: "upkeep", activeSeat: next.activeSeat });
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

function castableCard(state: GameState, seat: SeatId, card: GameCard, fromCommandZone: boolean, variableValue = 0, mode?: number): { legal: boolean; note?: string; targetKind?: Exclude<TargetKind, "none"> } {
  const player = playerAt(state, seat);
  const profile = cardProfile(card);
  if (!profile.castableFromHand || !profile.cost) return { legal: false };
  if (!Number.isInteger(variableValue) || variableValue < 0) return { legal: false, note: "El valor de X debe ser un entero no negativo." };
  const instantSpeed = profile.types.includes("Instant") || profile.keywords.includes("flash");
  if (!instantSpeed && !sorcerySpeed(state, seat)) return { legal: false };
  const additionalGeneric = fromCommandZone ? commanderTax(player, card.instance_id) : 0;
  const plan = planManaPayment(profile.cost, player, { additionalGeneric, variableValue });
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
      actions.push({
        action: { type: "choose-trigger", sourceId: choice.sourceId, accept: true },
        label: "Sí, resolver habilidad",
        note: "La habilidad opcional se resuelve ahora."
      });
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
    if (choice.type === "discard-cards") {
      for (const card of player.hand) {
        actions.push({
          action: { type: "choose-discard", sourceId: choice.sourceId, cardId: card.instance_id },
          label: `Descartar ${card.name}`,
          cardId: card.instance_id,
          note: `${choice.sourceCard.name}: elige una carta (${choice.remaining} restante(s)).`
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

  for (const card of player.hand) {
    const profile = cardProfile(card);
    const values = profile.cost?.hasVariable ? [...Array(Math.max(1, potentialMana(player) + 1)).keys()] : [0];
    const modes: (number | undefined)[] = profile.modalChoices.length ? profile.modalChoices.map((_, index) => index) : [undefined];
    for (const variableValue of values) for (const mode of modes) {
      const check = castableCard(state, seat, card, false, variableValue, mode);
      if (!check.legal) continue;
      const modal = mode === undefined ? undefined : profile.modalChoices[mode];
      actions.push({
        action: { type: "cast", cardId: card.instance_id, ...(profile.cost?.hasVariable ? { variableValue } : {}), ...(mode === undefined ? {} : { mode }) },
        label: `${profile.cost?.hasVariable ? `Lanzar ${card.name} (X=${variableValue})` : `Lanzar ${card.name}`}${modal ? ` — ${modal.text}` : ""}`,
        cardId: card.instance_id,
        manaValue: cardProfile(card).manaValue + (profile.cost?.hasVariable ? variableValue : 0),
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
    for (const variableValue of values) for (const mode of modes) {
      const check = castableCard(state, seat, card, true, variableValue, mode);
      if (!check.legal) continue;
      const modal = mode === undefined ? undefined : profile.modalChoices[mode];
      actions.push({
        action: { type: "cast", cardId: card.instance_id, ...(profile.cost?.hasVariable ? { variableValue } : {}), ...(mode === undefined ? {} : { mode }) },
        label: `Lanzar comandante ${card.name}${tax ? ` (+${tax} impuesto)` : ""}${profile.cost?.hasVariable ? ` (X=${variableValue})` : ""}${modal ? ` — ${modal.text}` : ""}`,
        cardId: card.instance_id,
        manaValue: cardProfile(card).manaValue + tax + (profile.cost?.hasVariable ? variableValue : 0),
        ...(check.targetKind ? { requiresTarget: check.targetKind } : {}),
        ...(check.note ? { note: check.note } : {})
      });
    }
  }

  for (const card of player.hand) {
    const cost = cardProfile(card).cyclingCost;
    if (!cost || !planManaPayment(cost, player)) continue;
    actions.push({
      action: { type: "cycle", cardId: card.instance_id },
      label: `Ciclar ${card.name}`,
      cardId: card.instance_id,
      manaValue: cost.manaValue,
      note: `Cycling ${cost.raw}`
    });
  }

  // Abilities of permanents this seat controls. Mana abilities resolve
  // immediately and never use the stack (rule 605.3a); everything else is
  // announced like a spell and waits for priority to pass.
  for (const permanent of player.battlefield) {
    const profile = cardProfile(permanent.card);
    for (const ability of profile.manaAbilities) {
      if (!canUseManaAbility(player, permanent, ability)) continue;
      const activations = ability.fixedProduces ? [ability.fixedProduces[0]!] : ability.produces;
      for (const mana of activations) {
        const produced = ability.fixedProduces ? ability.fixedProduces.map((type) => `{${type}}`).join("") : `${ability.amount > 1 ? ability.amount : ""}{${mana}}`;
        actions.push({
          action: { type: "activate-mana", sourceId: permanent.instance_id, abilityIndex: ability.index, mana },
          label: `${permanent.card.name}: Add ${produced}`,
          cardId: permanent.instance_id,
          ...(ability.lifeCost ? { note: `Cuesta ${ability.lifeCost} de vida.` } : {})
        });
      }
    }
    for (const ability of profile.activatedAbilities) {
      const check = activatableAbility(state, seat, permanent, ability);
      if (!check.legal) continue;
      actions.push({
        action: { type: "activate", sourceId: permanent.instance_id, abilityIndex: ability.index },
        label: `${permanent.card.name}: ${ability.text.split(":").slice(1).join(":").trim() || ability.text}`,
        cardId: permanent.instance_id,
        ...(check.targetKind ? { requiresTarget: check.targetKind } : {}),
        note: ability.text
      });
    }
    if (profile.equipCost && profile.subtypes.some((subtype) => subtype.toLowerCase() === "equipment")
      && planManaPayment(profile.equipCost, player)
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
  if (kind === "card-in-your-graveyard" || kind === "creature-card-in-your-graveyard" || kind === "artifact-card-in-your-graveyard" || kind === "enchantment-card-in-your-graveyard") {
    return playerAt(state, seat).graveyard
      .filter((card) => kind === "card-in-your-graveyard"
        || (kind === "creature-card-in-your-graveyard" && isCreature(cardProfile(card)))
        || (kind === "artifact-card-in-your-graveyard" && cardProfile(card).types.includes("Artifact"))
        || (kind === "enchantment-card-in-your-graveyard" && cardProfile(card).types.includes("Enchantment")))
      .map((card) => ({ kind: "graveyard-card", seat, instanceId: card.instance_id }) as Target);
  }
  if (kind === "land-card-in-a-graveyard") {
    return state.players.flatMap((player) => player.graveyard
      .filter((card) => isLand(cardProfile(card)))
      .map((card) => ({ kind: "graveyard-card", seat: player.seat, instanceId: card.instance_id }) as Target));
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
    if (kind === "creature" || kind === "creature-you-control" || kind === "nonartifact-creature" || kind === "nonblack-creature" || kind === "creature-with-flying") {
      if (!isCreature(profile)) return false;
      if (kind === "creature-you-control" && permanent.controller !== seat) return false;
      if (kind === "nonartifact-creature" && profile.types.includes("Artifact")) return false;
      if (kind === "nonblack-creature" && profile.colors.some((color) => color.toUpperCase() === "B")) return false;
      if (kind === "creature-with-flying" && !profile.keywords.includes("flying")) return false;
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
      return profile.subtypes.some((candidate) => candidate.toLowerCase() === subtype);
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

function pushOnStack(state: GameState, seat: SeatId, card: GameCard, targets: readonly Target[], fromCommandZone: boolean, variableValue: number, selectedEffect?: SpellEffect): GameState {
  const object: StackObject = {
    id: `stack:${state.version}:${card.instance_id}`,
    controller: seat,
    card,
    label: card.name,
    targets,
    fromCommandZone,
    variableValue,
    countered: false,
    ...(selectedEffect ? { selectedEffect } : {})
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
  if (!ability || !ability.produces.includes(action.mana)) throw new Error("Esa habilidad de maná no existe.");
  if (ability.fixedProduces && action.mana !== ability.fixedProduces[0]) throw new Error("Esa habilidad de maná produce un conjunto fijo.");
  if (!canUseManaAbility(player, source, ability)) throw new Error("No puedes activar esa habilidad de maná ahora.");
  const next = withPlayer(state, seat, (current) => ({
    ...current,
    life: current.life - ability.lifeCost + (ability.gainLife ?? 0),
    manaPool: ability.fixedProduces
      ? ability.fixedProduces.reduce((pool, mana) => addMana(pool, mana, 1), current.manaPool)
      : addMana(current.manaPool, action.mana, ability.amount),
    battlefield: current.battlefield.map((permanent) => {
      if (permanent.instance_id !== source.instance_id) return permanent;
      const counters = { ...permanent.counters };
      for (const cost of ability.removeCounters ?? []) counters[cost.kind] = (counters[cost.kind] ?? 0) - cost.amount;
      return { ...permanent, ...(ability.requiresTap ? { tapped: true } : {}), counters };
    })
  }));
  const tapped = ability.requiresTap ? raiseTapEvents(next, state, [source.instance_id]) : next;
  const output = ability.fixedProduces ? ability.fixedProduces.map((mana) => `{${mana}}`).join("") : `${ability.amount > 1 ? ability.amount : ""}{${action.mana}}`;
  return logged(tapped, seat, `${player.name} activa ${source.card.name} y agrega ${output}.`);
}

function applyCycle(state: GameState, seat: SeatId, action: Extract<GameAction, { type: "cycle" }>): GameState {
  if (!state.priorityOpen || state.prioritySeat !== seat) throw new Error("No tienes prioridad para ciclar esa carta.");
  const player = playerAt(state, seat);
  const card = player.hand.find((candidate) => candidate.instance_id === action.cardId);
  const cost = card ? cardProfile(card).cyclingCost : null;
  if (!card || !cost) throw new Error("Esa carta no tiene un coste de cycling válido.");
  const plan = planManaPayment(cost, player);
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
  next = drawCards(next, seat, 1);
  return logged(next, seat, `${player.name} cicla ${card.name}.`);
}

function applyEquip(state: GameState, seat: SeatId, action: Extract<GameAction, { type: "equip" }>): GameState {
  if (!state.priorityOpen || state.prioritySeat !== seat) throw new Error("No tienes prioridad para equipar.");
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
  const plan = planManaPayment(profile.equipCost, player);
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
  if (permanent.controller !== seat) return { legal: false };
  if (ability.sorcerySpeed && !sorcerySpeed(state, seat)) return { legal: false };
  if (ability.requiresTap && permanent.tapped) return { legal: false };
  // Rule 302.6: a `{T}` cost needs a creature that has been controlled since
  // the turn began. Non-creature permanents are unaffected by summoning sickness.
  if (ability.requiresTap && permanent.summoningSick && isCreature(cardProfile(permanent.card))) return { legal: false };
  if (ability.lifeCost >= player.life) return { legal: false };
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
    if (!planManaPayment(ability.manaCost, budget)) return { legal: false };
  }
  const targetKind = ability.targetKind;
  if (targetKind === "none") return { legal: true };
  if ((targetKind === "spell" || targetKind === "creature-spell" || targetKind === "noncreature-spell") && !legalTargets(state, seat, targetKind).length) return { legal: false };
  if (!legalTargets(state, seat, targetKind).length) return { legal: false };
  return { legal: true, targetKind };
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
  if (check.targetKind) {
    const allowed = legalTargets(state, seat, check.targetKind);
    const chosen = targets.length ? targets : allowed.slice(0, 1);
    if (!chosen.length) throw new Error(`${source.card.name} necesita un objetivo legal.`);
    const valid = chosen.every((target) => allowed.some((candidate) => JSON.stringify(candidate) === JSON.stringify(target)));
    if (!valid) throw new Error(`Objetivo ilegal para ${source.card.name}.`);
    targets = chosen;
  }

  // Costs are paid in one lump: tap, life, mana, then the sacrifice.
  let next = withPlayer(state, seat, (current) => ({
    ...current,
    life: current.life - ability.lifeCost,
    battlefield: current.battlefield.map((permanent) =>
      permanent.instance_id === source.instance_id && ability.requiresTap ? { ...permanent, tapped: true } : permanent)
  }));
  if (ability.requiresTap) next = raiseTapEvents(next, state, [source.instance_id]);
  if (ability.lifeCost) next = logged(next, seat, `${player.name} paga ${ability.lifeCost} de vida por ${source.card.name}.`);

  if (ability.manaCost && ability.manaCost.symbols.length) {
    const plan = planManaPayment(ability.manaCost, playerAt(next, seat));
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

  if (ability.sacrificesSelf) {
    const paid = playerAt(next, seat).battlefield.find((permanent) => permanent.instance_id === source.instance_id);
    if (!paid) throw new Error(`${source.card.name} ya no está en el campo para sacrificarse.`);
    next = movePermanentToZone(next, paid, "graveyard");
    next = logged(next, seat, `${player.name} sacrifica ${source.card.name}.`);
  }

  next = pushActivatedOnStack(next, seat, source, ability, targets);
  return logged(next, seat, `${player.name} activa la habilidad de ${source.card.name}.`);
}

function applyCast(state: GameState, seat: SeatId, action: Extract<GameAction, { type: "cast" }>): GameState {
  const player = playerAt(state, seat);
  const fromHand = player.hand.find((card) => card.instance_id === action.cardId);
  const fromCommand = player.commandZone.find((card) => card.instance_id === action.cardId);
  const card = fromHand ?? fromCommand;
  if (!card) throw new Error("Esa carta no está en tu mano ni en tu zona de mando.");
  const check = castableCard(state, seat, card, Boolean(fromCommand), action.variableValue ?? 0, action.mode);
  if (!check.legal) throw new Error(check.note ?? `No puedes lanzar ${card.name} ahora.`);

  const profile = cardProfile(card);
  const additionalGeneric = fromCommand ? commanderTax(player, card.instance_id) : 0;
  const plan = planManaPayment(profile.cost!, player, { additionalGeneric, variableValue: action.variableValue ?? 0 });
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
  const payment = payCost(profile.cost!, playerAt(next, seat).manaPool, { additionalGeneric, availableLife: playerAt(next, seat).life });
  if (!payment) throw new Error(`No se pudo pagar el coste de ${card.name}.`);
  next = withPlayer(next, seat, (current) => ({
    ...current,
    manaPool: payment.remaining,
    life: current.life - payment.lifePaid,
    hand: current.hand.filter((candidate) => candidate.instance_id !== card.instance_id),
    commandZone: current.commandZone.filter((candidate) => candidate.instance_id !== card.instance_id),
    ...(fromCommand ? { commanderCasts: { ...current.commanderCasts, [card.instance_id]: (current.commanderCasts[card.instance_id] ?? 0) + 1 } } : {})
  }));
  const selectedEffect = profile.modalChoices[action.mode ?? -1]?.effect;
  if (profile.modalChoices.length && !selectedEffect) throw new Error(`Debes elegir un modo válido para ${card.name}.`);
  next = pushOnStack(next, seat, card, action.targets ?? [], Boolean(fromCommand), action.variableValue ?? 0, selectedEffect);
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
  if (!action.accept) return logged(next, seat, `${playerAt(state, seat).name} no realiza la habilidad opcional de ${choice.sourceCard.name}.`);
  const source: StackObject = {
    id: choice.sourceId,
    controller: seat,
    card: choice.sourceCard,
    label: `${choice.sourceCard.name} · habilidad opcional`,
    targets: [],
    fromCommandZone: false,
    variableValue: 0,
    countered: false
  };
  next = applyEffect(next, source, choice.triggerEffect);
  return logged(next, seat, `Se resuelve la habilidad opcional de ${choice.sourceCard.name}.`);
}

function applyChooseLibraryCard(state: GameState, seat: SeatId, action: Extract<GameAction, { type: "choose-library-card" }>): GameState {
  const choice = state.pendingChoice;
  if (!choice || choice.type !== "search-library" || choice.seat !== seat) throw new Error("No tienes una búsqueda de biblioteca pendiente.");
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
    ]
  }));
  if (choice.search.destination === "battlefield") {
    next = putOntoBattlefield(next, seat, selected, false, choice.search.tapped === true);
  }
  const destination = choice.search.destination === "top" ? "la parte superior de su biblioteca"
    : choice.search.destination === "hand" ? "su mano"
    : choice.search.destination === "graveyard" ? "su cementerio" : "el campo de batalla";
  return logged(next, seat, `${player.name} ${choice.search.reveal ? `revela ${selected.name} y la pone en ${destination}` : `pone ${selected.name} en ${destination}`}.`);
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
  // Attack requirements are checked against the whole declaration (CR 508.1d).
  const missing = requiredAttackers(state, seat).find((permanent) => !unique.has(permanent.instance_id));
  if (missing) throw new Error(`${missing.card.name} ataca en cada combate si puede.`);

  let next: GameState = { ...state, combat: { ...state.combat, attackers: [...attackers], attackersDeclared: true } };
  next = tapAttackers(next, attackers);
  // Attack triggers fire once the whole declaration is made (CR 508.1i).
  for (const entry of attackers) {
    const attacker = findPermanent(next, entry.instanceId);
    if (attacker) next = raiseEvent(next, { kind: "attacks", permanentId: attacker.instance_id, controller: attacker.controller, card: attacker.card });
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
