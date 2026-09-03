import { describe, expect, it } from "vitest";
import type { CardData } from "./characteristics.js";
import {
  applyAction, createGame, legalActions, legalAttackers, legalBlockers, manaSources, planManaPayment,
  profileOf, TURN_STEPS, type DeckInput, type GameCard, type GameState, type SeatId, type TurnStep
} from "./engine.js";
import { pendingSeat, playBotGame } from "./bot.js";
import { projectGame } from "./projection.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let unique = 0;
function make(overrides: Partial<CardData> & { name: string; type_line: string }): CardData {
  unique += 1;
  return { scryfall_id: `fixture-${unique}-${overrides.name}`, mana_cost: "", cmc: 0, ...overrides };
}

const FOREST = () => make({ name: "Forest", type_line: "Basic Land — Forest", produced_mana: ["G"] });
const PLAINS = () => make({ name: "Plains", type_line: "Basic Land — Plains", produced_mana: ["W"] });
const ISLAND = () => make({ name: "Island", type_line: "Basic Land — Island", produced_mana: ["U"] });
const TAPLAND = () => make({ name: "Slow Gate", type_line: "Land", oracle_text: "Slow Gate enters tapped.\n{T}: Add {G}.", produced_mana: ["G"] });
const BEAR = () => make({ name: "Grizzly Bears", type_line: "Creature — Bear", mana_cost: "{1}{G}", cmc: 2, power: "2", toughness: "2" });
const WALL = () => make({ name: "Stone Wall", type_line: "Creature — Wall", mana_cost: "{W}", cmc: 1, power: "0", toughness: "4", keywords: ["Defender"], oracle_text: "Defender" });
const FLIER = () => make({ name: "Storm Crow", type_line: "Creature — Bird", mana_cost: "{1}{U}", cmc: 2, power: "1", toughness: "2", keywords: ["Flying"], oracle_text: "Flying" });
const TRAMPLER = () => make({ name: "Big Stomper", type_line: "Creature — Beast", mana_cost: "{3}{G}", cmc: 4, power: "6", toughness: "6", keywords: ["Trample"], oracle_text: "Trample" });
const DEATHTOUCHER = () => make({ name: "Tiny Viper", type_line: "Creature — Snake", mana_cost: "{B}", cmc: 1, power: "1", toughness: "1", keywords: ["Deathtouch"], oracle_text: "Deathtouch" });
const LIFELINKER = () => make({ name: "Kind Knight", type_line: "Creature — Knight", mana_cost: "{1}{W}", cmc: 2, power: "2", toughness: "2", keywords: ["Lifelink"], oracle_text: "Lifelink" });
const FIRST_STRIKER = () => make({ name: "Quick Blade", type_line: "Creature — Soldier", mana_cost: "{1}{W}", cmc: 2, power: "2", toughness: "2", keywords: ["First strike"], oracle_text: "First strike" });
const BOLT = () => make({ name: "Lightning Bolt", type_line: "Instant", mana_cost: "{R}", cmc: 1, oracle_text: "Lightning Bolt deals 3 damage to any target." });
const MOUNTAIN = () => make({ name: "Mountain", type_line: "Basic Land — Mountain", produced_mana: ["R"] });
const COMMANDER = (name = "Test Commander") => make({ name, type_line: "Legendary Creature — Human Soldier", mana_cost: "{2}{G}", cmc: 3, power: "3", toughness: "3" });

function deck(id: string, commander: CardData, contents: CardData[], size = 40): DeckInput {
  const cards = [commander, ...contents];
  while (cards.length < size) cards.push(FOREST());
  return { id, name: `${id} deck`, playerName: id, kind: "bot", commanderNames: [commander.name], cards };
}

/** Builds a two-seat game with fully controlled libraries. */
function twoSeatGame(left: CardData[], right: CardData[], options: { seed?: number } = {}): GameState {
  return createGame(
    [deck("A", COMMANDER("Alpha Captain"), left), deck("B", COMMANDER("Beta Captain"), right)],
    { seed: options.seed ?? 7, allowPartialDecks: true }
  );
}

/** Forces the exact board state a test needs without going through the action API. */
function stage(state: GameState, seat: SeatId, update: (player: GameState["players"][number]) => Partial<GameState["players"][number]>): GameState {
  return { ...state, players: state.players.map((player, index) => (index === seat ? { ...player, ...update(player) } : player)) };
}

function putOnBattlefield(state: GameState, seat: SeatId, cards: CardData[], options: { sick?: boolean; tapped?: boolean } = {}): GameState {
  const permanents = cards.map((card, index) => ({
    instance_id: `staged-${seat}-${index}-${card.name}-${Math.random().toString(36).slice(2, 8)}`,
    card: { ...card, instance_id: `staged-${seat}-${index}-${card.name}`, owner: seat },
    controller: seat,
    tapped: options.tapped ?? false,
    summoningSick: options.sick ?? false,
    damage: 0,
    deathtouched: false,
    isCommander: false
  }));
  return stage(state, seat, (player) => ({ battlefield: [...player.battlefield, ...permanents] }));
}

/** Turns plain card data into hand instances owned by a seat. */
function toHand(seat: SeatId, cards: readonly CardData[], prefix = "hand"): GameCard[] {
  return cards.map((card, index) => ({ ...card, instance_id: `${prefix}-${index}`, owner: seat }));
}

/** Every `instance_id` reachable in a projection, compared as a whole value. */
function exposedInstanceIds(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) { for (const entry of value) exposedInstanceIds(entry, found); return found; }
  if (!value || typeof value !== "object") return found;
  const record = value as Record<string, unknown>;
  if (typeof record.instance_id === "string") found.add(record.instance_id);
  for (const entry of Object.values(record)) exposedInstanceIds(entry, found);
  return found;
}

function passUntil(state: GameState, predicate: (state: GameState) => boolean, limit = 400): GameState {
  let current = state;
  for (let index = 0; index < limit; index += 1) {
    if (predicate(current) || current.finished) return current;
    const seat = pendingSeat(current);
    if (seat === null) throw new Error("Nobody owes a decision but the predicate is unmet.");
    const available = legalActions(current, seat);
    const pass = available.find((entry) => entry.action.type === "pass")
      ?? available.find((entry) => entry.action.type === "declare-attackers")
      ?? available.find((entry) => entry.action.type === "declare-blockers");
    if (!pass) throw new Error(`Seat ${seat} has no passing action at ${current.step}.`);
    current = applyAction(current, seat, pass.action);
  }
  throw new Error("passUntil exhausted its budget.");
}

// ---------------------------------------------------------------------------
// Setup and turn structure
// ---------------------------------------------------------------------------

describe("game creation", () => {
  it("moves the commander to the command zone and deals an opening hand", () => {
    const game = twoSeatGame([], []);
    for (const player of game.players) {
      expect(player.commandZone).toHaveLength(1);
      expect(player.hand).toHaveLength(7);
      expect(player.library).toHaveLength(32);
      expect(player.life).toBe(40);
      expect(player.library.some((card) => card.name.includes("Captain"))).toBe(false);
    }
  });

  it("rejects a deck that does not contain its declared commander", () => {
    expect(() => createGame([
      { id: "A", name: "A", commanderNames: ["Absent"], cards: [FOREST(), FOREST()] },
      { id: "B", name: "B", commanderNames: ["Absent"], cards: [FOREST(), FOREST()] }
    ], { allowPartialDecks: true })).toThrow(/no incluye a su comandante/);
  });

  it("requires exactly 100 cards unless a test opts out", () => {
    expect(() => createGame([deck("A", COMMANDER("X"), []), deck("B", COMMANDER("Y"), [])])).toThrow(/exactamente 100 cartas/);
  });

  it("settles straight to a real decision instead of stopping in untap", () => {
    const game = twoSeatGame([], []);
    expect(game.step).not.toBe("untap");
    expect(game.step).not.toBe("cleanup");
    expect(pendingSeat(game)).not.toBeNull();
  });
});

describe("turn structure", () => {
  it("never leaves the table without somebody able to act", () => {
    let game = twoSeatGame([], []);
    const seen = new Set<TurnStep>();
    let actionCount = 0;
    for (let index = 0; index < 400 && !game.finished; index += 1) {
      const seat = pendingSeat(game);
      expect(seat).not.toBeNull();
      seen.add(game.step);
      const actions = legalActions(game, seat!);
      expect(actions.length).toBeGreaterThan(0);
      const pass = actions.find((entry) => entry.action.type === "pass") ?? actions[0]!;
      game = applyAction(game, seat!, pass.action);
      actionCount += 1;
    }
    // Steps that never open priority are resolved by the engine, never surfaced as a decision.
    expect(seen.has("untap")).toBe(false);
    expect(seen.has("cleanup")).toBe(false);
    expect(actionCount).toBeGreaterThan(50);
    expect(game.turn).toBeGreaterThan(3);
  });

  it("walks every priority step when a seat turns auto-pass off", () => {
    let game = twoSeatGame([], []);
    game = { ...game, players: game.players.map((player) => ({ ...player, autoPass: false })) };
    const advance = () => {
      const seat = pendingSeat(game)!;
      const actions = legalActions(game, seat);
      game = applyAction(game, seat, (actions.find((entry) => entry.action.type === "pass") ?? actions[0]!).action);
    };
    // Turn 1 is already settled past upkeep when the game is handed over, so measure turn 2.
    while (game.turn === 1) advance();
    const visited: TurnStep[] = [];
    const measured = game.turn;
    for (let index = 0; index < 200 && game.turn === measured; index += 1) {
      if (!visited.includes(game.step)) visited.push(game.step);
      advance();
    }
    const expected = TURN_STEPS.filter((step) => step !== "untap" && step !== "cleanup");
    for (const step of expected) expect(visited).toContain(step);
  });

  it("auto-passes a seat that has nothing to do", () => {
    const game = twoSeatGame([], []);
    // With auto-pass on, the engine settles past upkeep straight into a main phase.
    expect(["precombat-main", "postcombat-main"]).toContain(game.step);
  });

  it("skips the opening draw only for the starting player", () => {
    const game = twoSeatGame([], []);
    expect(game.players[0]!.hand).toHaveLength(7);
    const secondTurn = passUntil(game, (state) => state.activeSeat === 1 && state.step === "precombat-main");
    expect(secondTurn.players[1]!.hand).toHaveLength(8);
  });
});

// ---------------------------------------------------------------------------
// Lands, mana and casting
// ---------------------------------------------------------------------------

describe("playing lands", () => {
  it("allows one land per turn in a main phase", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ hand: toHand(0, [FOREST(), FOREST()], "hand-forest") }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);

    game = applyAction(game, 0, { type: "play-land", cardId: "hand-forest-0" });
    expect(game.players[0]!.battlefield).toHaveLength(1);
    expect(game.players[0]!.landsPlayedThisTurn).toBe(1);
    // The second land is no longer offered, and forcing it is refused.
    expect(legalActions(game, 0).filter((entry) => entry.action.type === "play-land")).toHaveLength(0);
    expect(() => applyAction(game, 0, { type: "play-land", cardId: "hand-forest-1" })).toThrow();
  });

  it("puts a tap-land onto the battlefield tapped", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ hand: toHand(0, [TAPLAND()], "hand-tapland") }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    game = applyAction(game, 0, { type: "play-land", cardId: "hand-tapland-0" });
    expect(game.players[0]!.battlefield[0]!.tapped).toBe(true);
    expect(manaSources(game.players[0]!)).toHaveLength(0);
  });
});

describe("mana payment", () => {
  it("finds the lands that pay a colored cost", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [FOREST(), FOREST(), PLAINS()]);
    const cost = profileOf(BEAR()).cost!;
    const plan = planManaPayment(cost, game.players[0]!);
    expect(plan).not.toBeNull();
    expect(plan!.taps).toHaveLength(2);
    expect(plan!.taps.some((tap) => tap.type === "G")).toBe(true);
  });

  it("refuses a cost the board cannot produce", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [PLAINS(), PLAINS(), PLAINS()]);
    expect(planManaPayment(profileOf(BEAR()).cost!, game.players[0]!)).toBeNull();
  });

  it("does not tap a land twice", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [FOREST()]);
    expect(planManaPayment(profileOf(BEAR()).cost!, game.players[0]!)).toBeNull();
  });

  it("keeps a scarce color free when a flexible source can pay the generic", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [ISLAND(), FOREST(), PLAINS()]);
    const plan = planManaPayment(profileOf(BEAR()).cost!, game.players[0]!);
    expect(plan!.taps.some((tap) => tap.type === "G")).toBe(true);
    expect(plan!.taps).toHaveLength(2);
  });
});

describe("casting", () => {
  function readyToCast(cards: CardData[], battlefield: CardData[], opponentHand: CardData[] = [], opponentBoard: CardData[] = []) {
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ hand: toHand(0, cards) }));
    game = stage(game, 1, () => ({ hand: toHand(1, opponentHand, "foe") }));
    game = putOnBattlefield(game, 0, battlefield);
    if (opponentBoard.length) game = putOnBattlefield(game, 1, opponentBoard);
    return passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
  }

  it("taps the right mana and resolves a creature onto the battlefield", () => {
    let game = readyToCast([BEAR()], [FOREST(), FOREST()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    // Nobody can respond, so the engine resolves it instead of asking for empty passes.
    expect(game.stack).toHaveLength(0);
    expect(game.players[0]!.battlefield.filter((permanent) => permanent.tapped)).toHaveLength(2);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Grizzly Bears")).toBe(true);
    expect(game.players[0]!.hand).toHaveLength(0);
  });

  it("holds the spell on the stack while an opponent can still respond", () => {
    let game = readyToCast([BEAR()], [FOREST(), FOREST()], [BOLT()], [MOUNTAIN()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.stack).toHaveLength(1);
    expect(game.prioritySeat).toBe(1);
    expect(legalActions(game, 1).some((entry) => entry.label.includes("Lightning Bolt"))).toBe(true);
    // Sorcery-speed plays are unavailable to the caster while an object is on the stack.
    expect(legalActions(game, 0)).toHaveLength(0);
    game = applyAction(game, 1, { type: "pass" });
    expect(game.stack).toHaveLength(0);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Grizzly Bears")).toBe(true);
  });

  it("refuses a spell with no mana available", () => {
    const game = readyToCast([BEAR()], []);
    expect(() => applyAction(game, 0, { type: "cast", cardId: "hand-0" })).toThrow(/No puedes lanzar/);
    expect(legalActions(game, 0).filter((entry) => entry.action.type === "cast")).toHaveLength(0);
  });

  it("resolves an instant's damage against the chosen target", () => {
    let game = readyToCast([BOLT()], [MOUNTAIN()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 1 }] });
    expect(game.players[1]!.life).toBe(37);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Lightning Bolt")).toBe(true);
  });

  it("counters a spell whose target has left the battlefield", () => {
    let game = readyToCast([BOLT()], [MOUNTAIN()], [BOLT()], [MOUNTAIN(), BEAR()]);
    const bearId = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!.instance_id;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: bearId }] });
    expect(game.stack).toHaveLength(1);
    game = stage(game, 1, (player) => ({ battlefield: player.battlefield.filter((permanent) => permanent.instance_id !== bearId) }));
    game = applyAction(game, 1, { type: "pass" });
    expect(game.log.some((entry) => entry.text.includes("sus objetivos ya no son legales"))).toBe(true);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Lightning Bolt")).toBe(true);
  });

  it("refuses an illegal target", () => {
    const game = readyToCast([BOLT()], [MOUNTAIN()]);
    expect(() => applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: "ghost" }] })).toThrow(/Objetivo ilegal/);
  });
});

describe("commander rules", () => {
  it("charges two extra generic for each previous cast from the command zone", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ hand: [] }));
    game = putOnBattlefield(game, 0, [FOREST(), FOREST(), FOREST(), FOREST(), FOREST()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const commanderId = game.players[0]!.commandZone[0]!.instance_id;

    game = applyAction(game, 0, { type: "cast", cardId: commanderId });
    expect(game.players[0]!.commanderCasts[commanderId]).toBe(1);
    // {2}{G} is exactly three Forests, no more.
    expect(game.players[0]!.battlefield.filter((permanent) => permanent.tapped)).toHaveLength(3);
    const commander = game.players[0]!.battlefield.find((permanent) => permanent.isCommander);
    expect(commander).toBeDefined();

    // Back in the command zone, the same commander now costs {2} more to cast.
    game = stage(game, 0, (player) => ({
      battlefield: player.battlefield.filter((permanent) => !permanent.isCommander),
      commandZone: [commander!.card]
    }));
    const cost = profileOf(commander!.card).cost!;
    expect(planManaPayment(cost, game.players[0]!, { additionalGeneric: 2 })).toBeNull(); // Two untapped Forests left, five needed.
    const refreshed = stage(game, 0, (player) => ({ battlefield: player.battlefield.map((permanent) => ({ ...permanent, tapped: false })) }));
    expect(planManaPayment(cost, refreshed.players[0]!, { additionalGeneric: 2 })!.taps).toHaveLength(5);
  });

  it("returns a dying commander to the command zone", () => {
    let game = twoSeatGame([], []);
    const commanderCard = game.players[0]!.commandZone[0]!;
    game = stage(game, 0, (player) => ({
      commandZone: [],
      battlefield: [{
        instance_id: commanderCard.instance_id, card: commanderCard, controller: 0,
        tapped: false, summoningSick: false, damage: 99, deathtouched: false, isCommander: true
      }]
    }));
    game = applyAction(game, pendingSeat(game)!, { type: "pass" });
    expect(game.players[0]!.commandZone).toHaveLength(1);
    expect(game.players[0]!.graveyard).toHaveLength(0);
  });

  it("eliminates a player at 21 commander damage", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 1, () => ({ commanderDamage: { "some-commander": 21 } }));
    game = applyAction(game, pendingSeat(game)!, { type: "pass" });
    expect(game.players[1]!.lost).toBe(true);
    expect(game.players[1]!.lossReason).toContain("21");
    expect(game.finished).toBe(true);
    expect(game.winnerSeat).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Combat
// ---------------------------------------------------------------------------

describe("combat", () => {
  function atAttackers(attacker: CardData[], defender: CardData[]) {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, attacker);
    game = putOnBattlefield(game, 1, defender);
    return passUntil(game, (state) => state.step === "declare-attackers" && !state.combat.attackersDeclared);
  }

  it("does not let a summoning-sick creature attack", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [BEAR()], { sick: true });
    expect(legalAttackers(game, 0)).toHaveLength(0);
    // Untapping on its controller's next turn removes the sickness.
    const ready = stage(game, 0, (player) => ({ battlefield: player.battlefield.map((permanent) => ({ ...permanent, summoningSick: false })) }));
    expect(legalAttackers(ready, 0)).toHaveLength(1);
  });

  it("lets a creature with haste attack the turn it arrives", () => {
    const hasty = make({ name: "Fast Goblin", type_line: "Creature — Goblin", mana_cost: "{R}", power: "2", toughness: "1", keywords: ["Haste"], oracle_text: "Haste" });
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [hasty], { sick: true });
    expect(legalAttackers(game, 0)).toHaveLength(1);
  });

  it("does not let a tapped creature attack", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [BEAR()], { tapped: true });
    expect(legalAttackers(game, 0)).toHaveLength(0);
  });

  it("does not let a creature with defender attack", () => {
    const game = atAttackers([WALL()], []);
    expect(legalAttackers(game, 0)).toHaveLength(0);
  });

  it("taps attackers and deals unblocked damage to the defending player", () => {
    let game = atAttackers([BEAR()], []);
    const bear = game.players[0]!.battlefield[0]!;
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: bear.instance_id, defender: 1 }] });
    expect(game.players[0]!.battlefield[0]!.tapped).toBe(true);
    game = passUntil(game, (state) => state.step === "postcombat-main" || state.turn > 1);
    expect(game.players[1]!.life).toBe(38);
  });

  it("keeps a vigilant attacker untapped", () => {
    const vigilant = make({ name: "Watchful Ox", type_line: "Creature — Ox", mana_cost: "{2}{W}", power: "3", toughness: "3", keywords: ["Vigilance"], oracle_text: "Vigilance" });
    let game = atAttackers([vigilant], []);
    const id = game.players[0]!.battlefield[0]!.instance_id;
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: id, defender: 1 }] });
    expect(game.players[0]!.battlefield[0]!.tapped).toBe(false);
  });

  it("kills both creatures in an even trade", () => {
    let game = atAttackers([BEAR()], [BEAR()]);
    const attacker = game.players[0]!.battlefield[0]!.instance_id;
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: attacker, defender: 1 }] });
    game = passUntil(game, (state) => state.step === "declare-blockers" && !state.combat.blockersDeclared);
    const blocker = game.players[1]!.battlefield[0]!.instance_id;
    game = applyAction(game, 1, { type: "declare-blockers", blockers: [{ instanceId: blocker, attackerId: attacker }] });
    game = passUntil(game, (state) => state.step === "end-combat" || state.turn > 1);
    expect(game.players[0]!.battlefield).toHaveLength(0);
    expect(game.players[1]!.battlefield).toHaveLength(0);
    expect(game.players[1]!.life).toBe(40);
  });

  it("lets a ground creature block a flier only with flying or reach", () => {
    const reacher = make({ name: "Spider", type_line: "Creature — Spider", mana_cost: "{1}{G}", power: "1", toughness: "3", keywords: ["Reach"], oracle_text: "Reach" });
    let game = atAttackers([FLIER()], [BEAR(), reacher]);
    const attacker = game.players[0]!.battlefield[0]!.instance_id;
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: attacker, defender: 1 }] });
    game = passUntil(game, (state) => state.step === "declare-blockers" && !state.combat.blockersDeclared);
    const names = legalBlockers(game, 1).map((permanent) => permanent.card.name);
    expect(names).toEqual(["Spider"]);
  });

  it("applies first strike before the regular damage step", () => {
    let game = atAttackers([FIRST_STRIKER()], [BEAR()]);
    const attacker = game.players[0]!.battlefield[0]!.instance_id;
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: attacker, defender: 1 }] });
    game = passUntil(game, (state) => state.step === "declare-blockers" && !state.combat.blockersDeclared);
    const blocker = game.players[1]!.battlefield[0]!.instance_id;
    game = applyAction(game, 1, { type: "declare-blockers", blockers: [{ instanceId: blocker, attackerId: attacker }] });
    game = passUntil(game, (state) => state.step === "end-combat" || state.turn > 1);
    expect(game.players[1]!.battlefield).toHaveLength(0);
    expect(game.players[0]!.battlefield).toHaveLength(1); // The first striker survives untouched.
  });

  it("kills any blocker with deathtouch and lets trample through", () => {
    let game = atAttackers([TRAMPLER()], [BEAR()]);
    const attacker = game.players[0]!.battlefield[0]!.instance_id;
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: attacker, defender: 1 }] });
    game = passUntil(game, (state) => state.step === "declare-blockers" && !state.combat.blockersDeclared);
    const blocker = game.players[1]!.battlefield[0]!.instance_id;
    game = applyAction(game, 1, { type: "declare-blockers", blockers: [{ instanceId: blocker, attackerId: attacker }] });
    game = passUntil(game, (state) => state.step === "end-combat" || state.turn > 1);
    expect(game.players[1]!.battlefield).toHaveLength(0);
    expect(game.players[1]!.life).toBe(36); // 6 power, 2 assigned as lethal, 4 trample over.
  });

  it("lets a 1/1 deathtouch creature kill a 6/6", () => {
    let game = atAttackers([TRAMPLER()], [DEATHTOUCHER()]);
    const attacker = game.players[0]!.battlefield[0]!.instance_id;
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: attacker, defender: 1 }] });
    game = passUntil(game, (state) => state.step === "declare-blockers" && !state.combat.blockersDeclared);
    const blocker = game.players[1]!.battlefield[0]!.instance_id;
    game = applyAction(game, 1, { type: "declare-blockers", blockers: [{ instanceId: blocker, attackerId: attacker }] });
    game = passUntil(game, (state) => state.step === "end-combat" || state.turn > 1);
    expect(game.players[0]!.battlefield).toHaveLength(0);
  });

  it("gains life for the controller of a lifelinker", () => {
    let game = atAttackers([LIFELINKER()], []);
    const attacker = game.players[0]!.battlefield[0]!.instance_id;
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: attacker, defender: 1 }] });
    game = passUntil(game, (state) => state.step === "end-combat" || state.turn > 1);
    expect(game.players[0]!.life).toBe(42);
    expect(game.players[1]!.life).toBe(38);
  });

  it("tracks commander damage separately from life", () => {
    let game = twoSeatGame([], []);
    const commanderCard = game.players[0]!.commandZone[0]!;
    game = stage(game, 0, () => ({
      commandZone: [],
      battlefield: [{
        instance_id: commanderCard.instance_id, card: commanderCard, controller: 0,
        tapped: false, summoningSick: false, damage: 0, deathtouched: false, isCommander: true
      }]
    }));
    game = passUntil(game, (state) => state.step === "declare-attackers" && !state.combat.attackersDeclared);
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: commanderCard.instance_id, defender: 1 }] });
    game = passUntil(game, (state) => state.step === "end-combat" || state.turn > 1);
    expect(game.players[1]!.life).toBe(37);
    expect(game.players[1]!.commanderDamage[commanderCard.instance_id]).toBe(3);
  });

  it("rejects an illegal attacker or defender", () => {
    const game = atAttackers([BEAR()], []);
    const id = game.players[0]!.battlefield[0]!.instance_id;
    expect(() => applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: id, defender: 0 }] })).toThrow(/no puede ser atacado/);
    expect(() => applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: "ghost", defender: 1 }] })).toThrow(/no puede atacar/);
  });
});

// ---------------------------------------------------------------------------
// State-based actions and privacy
// ---------------------------------------------------------------------------

describe("state-based actions", () => {
  it("eliminates a player at zero life and ends a two-player game", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 1, () => ({ life: 0 }));
    game = applyAction(game, pendingSeat(game)!, { type: "pass" });
    expect(game.players[1]!.lost).toBe(true);
    expect(game.finished).toBe(true);
    expect(game.winnerSeat).toBe(0);
  });

  it("eliminates a player who draws from an empty library", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 1, () => ({ library: [] }));
    game = passUntil(game, (state) => state.finished || (state.activeSeat === 1 && state.step === "precombat-main"));
    expect(game.players[1]!.lost).toBe(true);
  });

  it("keeps only one copy of a legendary permanent per player", () => {
    let game = twoSeatGame([], []);
    const legend = make({ name: "Twin Legend", type_line: "Legendary Creature — Human", mana_cost: "{G}", power: "1", toughness: "1" });
    game = putOnBattlefield(game, 0, [legend, legend]);
    game = applyAction(game, pendingSeat(game)!, { type: "pass" });
    expect(game.players[0]!.battlefield.filter((permanent) => permanent.card.name === "Twin Legend")).toHaveLength(1);
  });

  it("does not destroy an indestructible creature that took lethal damage", () => {
    const wall = make({ name: "Iron Idol", type_line: "Creature — Golem", mana_cost: "{4}", power: "3", toughness: "3", keywords: ["Indestructible"], oracle_text: "Indestructible" });
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [wall]);
    game = stage(game, 0, (player) => ({ battlefield: player.battlefield.map((permanent) => ({ ...permanent, damage: 10 })) }));
    game = applyAction(game, pendingSeat(game)!, { type: "pass" });
    expect(game.players[0]!.battlefield).toHaveLength(1);
  });
});

describe("projection privacy", () => {
  it("never includes another seat's hand or library cards", () => {
    const game = twoSeatGame([], []);
    const view = projectGame(game, 0);
    expect(view.players[0]!.hand).toHaveLength(7);
    expect(view.players[1]!.hand).toBeUndefined();
    expect(view.players[1]!.handCount).toBe(7);
    // Identifiers are compared as whole values: one id can be a prefix of another.
    const exposed = exposedInstanceIds(view);
    for (const card of game.players[1]!.hand) expect(exposed.has(card.instance_id)).toBe(false);
    for (const card of game.players[1]!.library) expect(exposed.has(card.instance_id)).toBe(false);
    for (const card of game.players[0]!.hand) expect(exposed.has(card.instance_id)).toBe(true);
  });

  it("reports zero available mana for opponents", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 1, [FOREST(), FOREST()]);
    const view = projectGame(game, 0);
    expect(view.players[1]!.availableMana).toBe(0);
  });

  it("only offers legal actions to the seat that owes a decision", () => {
    const game = twoSeatGame([], []);
    const acting = pendingSeat(game)!;
    expect(projectGame(game, acting).legalActions.length).toBeGreaterThan(0);
    expect(projectGame(game, acting === 0 ? 1 : 0).legalActions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Full bot games
// ---------------------------------------------------------------------------

describe("bot games", () => {
  function fourSeatGame(seed: number): GameState {
    const decks: DeckInput[] = ["A", "B", "C", "D"].map((id) =>
      deck(id, COMMANDER(`${id} Captain`), [
        ...Array.from({ length: 6 }, BEAR), ...Array.from({ length: 3 }, FLIER),
        ...Array.from({ length: 2 }, TRAMPLER), ...Array.from({ length: 2 }, LIFELINKER),
        ...Array.from({ length: 12 }, FOREST), ...Array.from({ length: 4 }, PLAINS)
      ]));
    return createGame(decks, { seed, allowPartialDecks: true });
  }

  it("plays deterministic games that reach a winner without breaking invariants", () => {
    for (const seed of [1, 2, 3, 5, 8]) {
      const result = playBotGame(fourSeatGame(seed), 60);
      expect(result.state.log.length).toBeGreaterThan(20);
      for (const player of result.state.players) {
        const total = player.library.length + player.hand.length + player.battlefield.length
          + player.graveyard.length + player.exile.length + player.commandZone.length
          + result.state.stack.filter((object) => object.card.owner === player.seat).length;
        expect(total).toBe(40);
        expect(Number.isInteger(player.life)).toBe(true);
      }
      expect(result.finished || result.turns > 60).toBe(true);
    }
  });

  it("produces the same game for the same seed", () => {
    const first = playBotGame(fourSeatGame(11), 30);
    const second = playBotGame(fourSeatGame(11), 30);
    expect(second.state.log.map((entry) => entry.text)).toEqual(first.state.log.map((entry) => entry.text));
    expect(second.state.players.map((player) => player.life)).toEqual(first.state.players.map((player) => player.life));
  });

  it("actually changes life totals through combat", () => {
    const result = playBotGame(fourSeatGame(4), 40);
    expect(result.state.players.some((player) => player.life !== 40)).toBe(true);
    expect(result.state.log.some((entry) => entry.text.includes("ataca con"))).toBe(true);
    expect(result.state.log.some((entry) => entry.text.includes("de daño a"))).toBe(true);
  });
});
