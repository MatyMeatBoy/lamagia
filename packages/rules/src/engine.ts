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
  cardProfile, isCreature, isLand, type CardData, type CardProfile, type EnforcedKeyword, type SpellEffect
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
}

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
  readonly combat: CombatState;
  readonly log: readonly LogEntry[];
  readonly winnerSeat: SeatId | null;
  readonly finished: boolean;
  readonly seed: number;
  readonly rngState: number;
  readonly version: number;
  readonly startingSeat: SeatId;
}

export type GameAction =
  | { readonly type: "pass" }
  | { readonly type: "play-land"; readonly cardId: string }
  | { readonly type: "cast"; readonly cardId: string; readonly targets?: readonly Target[]; readonly variableValue?: number }
  | { readonly type: "declare-attackers"; readonly attackers: readonly AttackerDeclaration[] }
  | { readonly type: "declare-blockers"; readonly blockers: readonly BlockerDeclaration[] }
  | { readonly type: "concede" };

/** A legal action plus the presentation metadata the client needs to offer it. */
export interface LegalAction {
  readonly action: GameAction;
  readonly label: string;
  readonly cardId?: string;
  readonly requiresTarget?: "any" | "creature" | "spell";
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

function powerOf(permanent: Permanent): number { return cardProfile(permanent.card).power ?? 0; }
function toughnessOf(permanent: Permanent): number { return cardProfile(permanent.card).toughness ?? 0; }
function keywordOf(permanent: Permanent, keyword: EnforcedKeyword): boolean {
  return cardProfile(permanent.card).keywords.includes(keyword);
}

// ---------------------------------------------------------------------------
// Mana sources and automatic payment
// ---------------------------------------------------------------------------

export interface ManaSource {
  readonly permanentId: string;
  readonly name: string;
  readonly options: readonly ManaType[];
  readonly amount: number;
  readonly lifeCost: number;
  readonly requiresTap: boolean;
}

/** Untapped permanents this player can currently tap for mana. */
export function manaSources(player: PlayerState): ManaSource[] {
  const sources: ManaSource[] = [];
  for (const permanent of player.battlefield) {
    const profile = cardProfile(permanent.card);
    for (const ability of profile.manaAbilities) {
      if (ability.requiresTap && permanent.tapped) continue;
      // A creature's `{T}` ability needs it to have been controlled since the turn began.
      if (ability.requiresTap && permanent.summoningSick && isCreature(profile)) continue;
      if (ability.lifeCost >= player.life) continue;
      sources.push({
        permanentId: permanent.instance_id,
        name: permanent.card.name,
        options: ability.produces,
        amount: ability.amount,
        lifeCost: ability.lifeCost,
        requiresTap: ability.requiresTap
      });
      break; // One mana ability per permanent keeps automatic tapping unambiguous.
    }
  }
  return sources;
}

export interface ManaPlan {
  readonly taps: readonly { readonly permanentId: string; readonly type: ManaType; readonly amount: number; readonly lifeCost: number }[];
  readonly pool: ManaPool;
  readonly lifeCost: number;
}

/** Upper bound on mana available, used for quick "can I afford anything?" filtering. */
export function potentialMana(player: PlayerState): number {
  return manaSources(player).reduce((total, source) => total + source.amount, 0) + poolTotal(player.manaPool);
}

type Tap = { readonly permanentId: string; readonly type: ManaType; readonly amount: number; readonly lifeCost: number };

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
  return `${[...source.options].sort().join("")}|${source.amount}|${source.lifeCost}`;
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
  if (poolTotal(startingPool) + sources.reduce((total, source) => total + source.amount, 0) < needed) return null;

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
      currentPool = addMana(currentPool, type, source.amount);
      currentTaps = [...currentTaps, { permanentId: source.permanentId, type, amount: source.amount, lifeCost: source.lifeCost }];
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
          addMana(produced, type, source.amount),
          { ...reserved, [type]: reserved[type] + 1 },
          new Set([...used, source.permanentId]),
          [...taps, { permanentId: source.permanentId, type, amount: source.amount, lifeCost: source.lifeCost }],
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
  const tapped = new Set(plan.taps.map((tap) => tap.permanentId));
  return withPlayer(state, seat, (player) => ({
    ...player,
    life: player.life - plan.lifeCost,
    battlefield: player.battlefield.map((permanent) => (tapped.has(permanent.instance_id) ? { ...permanent, tapped: true } : permanent)),
    manaPool: plan.pool
  }));
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
    return {
      seat,
      id: deck.id,
      name: deck.playerName ?? deck.name,
      deckName: deck.name,
      kind: deck.kind ?? (seat === 0 ? "human" : "bot"),
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
      autoPass: true
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
    combat: { attackers: [], blockers: [], attackersDeclared: false, blockersDeclared: false, firstStrikeResolved: false, damageResolved: false },
    log: [],
    winnerSeat: null,
    finished: false,
    seed,
    rngState,
    version: 0,
    startingSeat: 0
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
  next = withPlayer(next, ownerSeat, (player) => ({ ...player, [zone]: [...player[zone], permanent.card] }));
  return logged(next, permanent.controller, `${permanent.card.name} va ${zone === "graveyard" ? "al cementerio" : "al exilio"}.`);
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
  }
}

function putOntoBattlefield(state: GameState, seat: SeatId, card: GameCard, isCommander: boolean): GameState {
  const profile = cardProfile(card);
  const enters = entersTapped(state, seat, profile);
  const permanent: Permanent = {
    instance_id: card.instance_id,
    card,
    controller: seat,
    tapped: enters.tapped,
    summoningSick: true,
    damage: 0,
    deathtouched: false,
    isCommander
  };
  let next = withPlayer(state, seat, (player) => ({
    ...player,
    life: player.life - enters.lifeCost,
    battlefield: [...player.battlefield, permanent]
  }));
  if (enters.lifeCost) next = logged(next, seat, `${playerAt(next, seat).name} paga ${enters.lifeCost} vidas para que ${card.name} entre enderezada.`);
  return next;
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

function opponentsOf(state: GameState, seat: SeatId): SeatId[] {
  return state.players.filter((player) => player.seat !== seat && !player.lost).map((player) => player.seat);
}

function dealDamageToPlayer(state: GameState, seat: SeatId, amount: number, sourceName: string): GameState {
  if (amount <= 0) return state;
  const next = withPlayer(state, seat, (player) => ({ ...player, life: player.life - amount }));
  return logged(next, seat, `${sourceName} hace ${amount} de daño a ${playerAt(next, seat).name}.`);
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

function applyEffect(state: GameState, object: StackObject, effect: SpellEffect): GameState {
  const controller = object.controller;
  const sourceName = object.card.name;
  switch (effect.kind) {
    case "draw": return drawCards(state, controller, effect.amount);
    case "gain-life": {
      const next = withPlayer(state, controller, (player) => ({ ...player, life: player.life + effect.amount }));
      return logged(next, controller, `${playerAt(next, controller).name} gana ${effect.amount} vidas.`);
    }
    case "each-opponent-loses-life": {
      let next = state;
      for (const seat of opponentsOf(state, controller)) next = dealDamageToPlayer(next, seat, effect.amount, sourceName);
      return next;
    }
    case "damage-each-opponent": {
      let next = state;
      for (const seat of opponentsOf(state, controller)) next = dealDamageToPlayer(next, seat, effect.amount, sourceName);
      return next;
    }
    case "damage-any-target": {
      const target = object.targets[0];
      if (!target) return state;
      if (target.kind === "player") return dealDamageToPlayer(state, target.seat, effect.amount, sourceName);
      if (target.kind === "permanent") return dealDamageToPermanent(state, target.instanceId, effect.amount, false, sourceName);
      return state;
    }
    case "destroy-target-creature": {
      const target = object.targets[0];
      if (!target || target.kind !== "permanent") return state;
      const permanent = findPermanent(state, target.instanceId);
      if (!permanent || keywordOf(permanent, "indestructible")) return state;
      return movePermanentToZone(state, permanent, "graveyard");
    }
    case "destroy-all-creatures": {
      let next = state;
      for (const permanent of allPermanents(state)) {
        if (!isCreature(cardProfile(permanent.card)) || keywordOf(permanent, "indestructible")) continue;
        next = movePermanentToZone(next, permanent, "graveyard");
      }
      return logged(next, controller, `${sourceName} destruye todas las criaturas.`);
    }
    case "counter-target-spell": {
      const target = object.targets[0];
      if (!target || target.kind !== "spell") return state;
      return { ...state, stack: state.stack.map((entry) => (entry.id === target.stackId ? { ...entry, countered: true } : entry)) };
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
    next = withPlayer(next, object.card.owner, (player) => ({ ...player, graveyard: [...player.graveyard, object.card] }));
    return logged(next, object.controller, `${object.card.name} es contrarrestado.`);
  }

  // A target that left the battlefield makes the spell fizzle (rule 608.2b).
  const targetsGone = object.targets.some((target) =>
    (target.kind === "permanent" && !findPermanent(next, target.instanceId)) ||
    (target.kind === "spell" && !next.stack.some((entry) => entry.id === target.stackId)) ||
    (target.kind === "player" && playerAt(next, target.seat).lost));
  if (object.targets.length && targetsGone) {
    next = withPlayer(next, object.card.owner, (player) => ({ ...player, graveyard: [...player.graveyard, object.card] }));
    return logged(next, object.controller, `${object.card.name} se contrarresta: sus objetivos ya no son legales.`);
  }

  if (profile.isPermanent) {
    next = putOntoBattlefield(next, object.controller, object.card, object.fromCommandZone || playerAt(next, object.card.owner).commanderIds.includes(object.card.instance_id));
    next = logged(next, object.controller, `${playerAt(next, object.controller).name} resuelve ${object.card.name} al campo de batalla.`);
    for (const effect of profile.effects) next = applyEffect(next, object, effect);
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

    for (const permanent of allPermanents(next)) {
      const profile = cardProfile(permanent.card);
      if (!isCreature(profile)) continue;
      const toughness = toughnessOf(permanent);
      const lethal = toughness <= 0 || (permanent.damage > 0 && permanent.damage >= toughness) || permanent.deathtouched;
      if (!lethal) continue;
      if (keywordOf(permanent, "indestructible") && toughness > 0 && permanent.damage < toughness && !permanent.deathtouched) continue;
      if (keywordOf(permanent, "indestructible") && toughness > 0) continue;
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
  if (permanent.summoningSick && !profile.keywords.includes("haste")) return false;
  void state;
  return true;
}

function canBlock(attacker: Permanent, blocker: Permanent): boolean {
  const blockerProfile = cardProfile(blocker.card);
  if (!isCreature(blockerProfile) || blocker.tapped) return false;
  const attackerProfile = cardProfile(attacker.card);
  if (attackerProfile.keywords.includes("flying") && !blockerProfile.keywords.includes("flying") && !blockerProfile.keywords.includes("reach")) return false;
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
      return attacker ? canBlock(attacker, blocker) : false;
    }));
}

/** Seats that must still declare blockers this combat. */
export function defendersAwaitingBlocks(state: GameState): SeatId[] {
  if (state.step !== "declare-blockers" || state.combat.blockersDeclared) return [];
  const defenders = new Set(state.combat.attackers.map((entry) => entry.defender));
  return [...defenders].filter((seat) => !playerAt(state, seat).lost);
}

function tapAttackers(state: GameState, attackers: readonly AttackerDeclaration[]): GameState {
  const ids = new Set(attackers.filter((entry) => {
    const permanent = findPermanent(state, entry.instanceId);
    return permanent ? !keywordOf(permanent, "vigilance") : false;
  }).map((entry) => entry.instanceId));
  if (!ids.size) return state;
  return {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      battlefield: player.battlefield.map((permanent) => (ids.has(permanent.instance_id) ? { ...permanent, tapped: true } : permanent))
    }))
  };
}

function dealsDamageInStep(permanent: Permanent, firstStrikeStep: boolean): boolean {
  const first = keywordOf(permanent, "first strike");
  const double = keywordOf(permanent, "double strike");
  return firstStrikeStep ? first || double : double || (!first && !double);
}

function needsFirstStrikeStep(state: GameState): boolean {
  const combatants = [
    ...state.combat.attackers.map((entry) => findPermanent(state, entry.instanceId)),
    ...state.combat.blockers.map((entry) => findPermanent(state, entry.instanceId))
  ].filter((permanent): permanent is Permanent => permanent !== null);
  return combatants.some((permanent) => keywordOf(permanent, "first strike") || keywordOf(permanent, "double strike"));
}

interface DamageBatch { readonly toPlayers: { seat: SeatId; amount: number; commanderId?: string; sourceName: string }[]; readonly toPermanents: { instanceId: string; amount: number; deathtouch: boolean; sourceName: string }[]; readonly lifelink: { seat: SeatId; amount: number }[] }

function computeCombatDamage(state: GameState, firstStrikeStep: boolean): DamageBatch {
  const toPlayers: DamageBatch["toPlayers"] = [];
  const toPermanents: DamageBatch["toPermanents"] = [];
  const lifelink: DamageBatch["lifelink"] = [];

  for (const entry of state.combat.attackers) {
    const attacker = findPermanent(state, entry.instanceId);
    if (!attacker || !dealsDamageInStep(attacker, firstStrikeStep)) continue;
    const power = powerOf(attacker);
    if (power <= 0) continue;
    const deathtouch = keywordOf(attacker, "deathtouch");
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
        sourceName: attacker.card.name
      });
      if (keywordOf(attacker, "lifelink")) lifelink.push({ seat: attacker.controller, amount: power });
      continue;
    }

    // Damage is assigned in blocker order: lethal to each, then trample to the player.
    let remaining = power;
    for (const blocker of blockers) {
      if (remaining <= 0) break;
      const lethal = deathtouch ? 1 : Math.max(1, toughnessOf(blocker) - blocker.damage);
      const assigned = Math.min(remaining, lethal);
      toPermanents.push({ instanceId: blocker.instance_id, amount: assigned, deathtouch, sourceName: attacker.card.name });
      if (keywordOf(attacker, "lifelink")) lifelink.push({ seat: attacker.controller, amount: assigned });
      remaining -= assigned;
    }
    if (remaining > 0 && keywordOf(attacker, "trample")) {
      toPlayers.push({
        seat: entry.defender,
        amount: remaining,
        ...(attacker.isCommander ? { commanderId: attacker.instance_id } : {}),
        sourceName: attacker.card.name
      });
      if (keywordOf(attacker, "lifelink")) lifelink.push({ seat: attacker.controller, amount: remaining });
    }
  }

  for (const block of state.combat.blockers) {
    const blocker = findPermanent(state, block.instanceId);
    const attacker = findPermanent(state, block.attackerId);
    if (!blocker || !attacker || !dealsDamageInStep(blocker, firstStrikeStep)) continue;
    const power = powerOf(blocker);
    if (power <= 0) continue;
    toPermanents.push({ instanceId: attacker.instance_id, amount: power, deathtouch: keywordOf(blocker, "deathtouch"), sourceName: blocker.card.name });
    if (keywordOf(blocker, "lifelink")) lifelink.push({ seat: blocker.controller, amount: power });
  }

  return { toPlayers, toPermanents, lifelink };
}

function applyCombatDamage(state: GameState, firstStrikeStep: boolean): GameState {
  const batch = computeCombatDamage(state, firstStrikeStep);
  let next = state;
  for (const hit of batch.toPermanents) next = dealDamageToPermanent(next, hit.instanceId, hit.amount, hit.deathtouch, hit.sourceName);
  for (const hit of batch.toPlayers) {
    next = dealDamageToPlayer(next, hit.seat, hit.amount, hit.sourceName);
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
          battlefield: current.battlefield.map((permanent) => ({ ...permanent, damage: 0, deathtouched: false }))
        }))
      };
      break;
    }
    default: break;
  }

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

function castableCard(state: GameState, seat: SeatId, card: GameCard, fromCommandZone: boolean): { legal: boolean; note?: string; targetKind?: "any" | "creature" | "spell" } {
  const player = playerAt(state, seat);
  const profile = cardProfile(card);
  if (!profile.castableFromHand || !profile.cost) return { legal: false };
  const instantSpeed = profile.types.includes("Instant") || profile.keywords.includes("flash");
  if (!instantSpeed && !sorcerySpeed(state, seat)) return { legal: false };
  if (profile.cost.hasVariable) return { legal: false, note: "Los costes con {X} todavía no se pueden pagar." };
  const additionalGeneric = fromCommandZone ? commanderTax(player, card.instance_id) : 0;
  const plan = planManaPayment(profile.cost, player, { additionalGeneric });
  if (!plan) return { legal: false };
  if (profile.targetKind === "creature" && !allPermanents(state).some((permanent) => isCreature(cardProfile(permanent.card)))) return { legal: false };
  if (profile.targetKind === "spell" && !state.stack.length) return { legal: false };
  return {
    legal: true,
    ...(profile.targetKind !== "none" ? { targetKind: profile.targetKind } : {}),
    ...(profile.fullyImplemented ? {} : { note: "Su texto todavía no está implementado; entra al juego pero no ejecuta su efecto." })
  };
}

/** Every action `seat` may legally take right now. */
export function legalActions(state: GameState, seat: SeatId): LegalAction[] {
  if (state.finished) return [];
  const player = playerAt(state, seat);
  if (player.lost) return [];
  const actions: LegalAction[] = [];

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
    const check = castableCard(state, seat, card, false);
    if (!check.legal) continue;
    actions.push({
      action: { type: "cast", cardId: card.instance_id },
      label: `Lanzar ${card.name}`,
      cardId: card.instance_id,
      manaValue: cardProfile(card).manaValue,
      ...(check.targetKind ? { requiresTarget: check.targetKind } : {}),
      ...(check.note ? { note: check.note } : {})
    });
  }

  for (const card of player.commandZone) {
    const check = castableCard(state, seat, card, true);
    if (!check.legal) continue;
    const tax = commanderTax(player, card.instance_id);
    actions.push({
      action: { type: "cast", cardId: card.instance_id },
      label: `Lanzar comandante ${card.name}${tax ? ` (+${tax} impuesto)` : ""}`,
      cardId: card.instance_id,
      manaValue: cardProfile(card).manaValue + tax,
      ...(check.targetKind ? { requiresTarget: check.targetKind } : {}),
      ...(check.note ? { note: check.note } : {})
    });
  }

  actions.push({ action: { type: "concede" }, label: "Conceder" });
  return actions;
}

/** Targets a spell could legally choose right now. */
export function legalTargets(state: GameState, seat: SeatId, kind: "any" | "creature" | "spell"): Target[] {
  if (kind === "spell") return state.stack.map((entry) => ({ kind: "spell", stackId: entry.id }) as Target);
  const creatures = allPermanents(state)
    .filter((permanent) => isCreature(cardProfile(permanent.card)))
    .filter((permanent) => !keywordOf(permanent, "hexproof") || permanent.controller === seat)
    .filter((permanent) => !keywordOf(permanent, "shroud"))
    .map((permanent) => ({ kind: "permanent", instanceId: permanent.instance_id }) as Target);
  if (kind === "creature") return creatures;
  return [...state.players.filter((player) => !player.lost).map((player) => ({ kind: "player", seat: player.seat }) as Target), ...creatures];
}

// ---------------------------------------------------------------------------
// Action application
// ---------------------------------------------------------------------------

function pushOnStack(state: GameState, seat: SeatId, card: GameCard, targets: readonly Target[], fromCommandZone: boolean, variableValue: number): GameState {
  const object: StackObject = {
    id: `stack:${state.version}:${card.instance_id}`,
    controller: seat,
    card,
    label: card.name,
    targets,
    fromCommandZone,
    variableValue,
    countered: false
  };
  // After putting an object on the stack its controller receives priority again (rule 117.3c).
  return { ...state, stack: [...state.stack, object], prioritySeat: seat, priorityOpen: true, passedSeats: [] };
}

function applyCast(state: GameState, seat: SeatId, action: Extract<GameAction, { type: "cast" }>): GameState {
  const player = playerAt(state, seat);
  const fromHand = player.hand.find((card) => card.instance_id === action.cardId);
  const fromCommand = player.commandZone.find((card) => card.instance_id === action.cardId);
  const card = fromHand ?? fromCommand;
  if (!card) throw new Error("Esa carta no está en tu mano ni en tu zona de mando.");
  const check = castableCard(state, seat, card, Boolean(fromCommand));
  if (!check.legal) throw new Error(check.note ?? `No puedes lanzar ${card.name} ahora.`);

  const profile = cardProfile(card);
  const additionalGeneric = fromCommand ? commanderTax(player, card.instance_id) : 0;
  const plan = planManaPayment(profile.cost!, player, { additionalGeneric });
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
  next = pushOnStack(next, seat, card, action.targets ?? [], Boolean(fromCommand), action.variableValue ?? 0);
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
  return logged(next, seat, `${player.name} juega ${card.name}.`);
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

  let next: GameState = { ...state, combat: { ...state.combat, attackers: [...attackers], attackersDeclared: true } };
  next = tapAttackers(next, attackers);
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
    if (!canBlock(attacker, blocker)) throw new Error(`${blocker.card.name} no puede bloquear a ${attacker.card.name}.`);
  }
  const unique = new Set(blockers.map((entry) => entry.instanceId));
  if (unique.size !== blockers.length) throw new Error("Una criatura solo puede bloquear a un atacante.");

  // Menace needs at least two blockers, so a single-blocker assignment is illegal.
  for (const declaration of state.combat.attackers) {
    const attacker = findPermanent(state, declaration.instanceId);
    if (!attacker || !keywordOf(attacker, "menace")) continue;
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

/** True when the seat has something to decide beyond passing. */
export function hasRealChoice(state: GameState, seat: SeatId): boolean {
  return legalActions(state, seat).some((entry) => entry.action.type !== "pass" && entry.action.type !== "concede");
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
    if (player.autoPass && !hasRealChoice(next, seat)) { next = applyPass(next, seat); continue; }
    return next;
  }
  throw new Error("El motor no pudo estabilizar la partida; posible bucle de reglas.");
}

/** Seats that currently owe a decision. */
export function seatsToAct(state: GameState): SeatId[] {
  if (state.finished) return [];
  if (state.step === "declare-attackers" && !state.combat.attackersDeclared) return [state.activeSeat];
  if (state.step === "declare-blockers" && !state.combat.blockersDeclared) return defendersAwaitingBlocks(state);
  return state.priorityOpen ? [state.prioritySeat] : [];
}
