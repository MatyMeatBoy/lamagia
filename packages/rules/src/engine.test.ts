import { describe, expect, it } from "vitest";
import { cardProfile } from "./characteristics.js";
import type { CardData } from "./characteristics.js";
import {
  applyAction, canCounterSpell, createGame, legalActions, legalTargets, legalAttackers, legalBlockers, defendersAwaitingBlocks, manaSources, planManaPayment, powerOf, toughnessOf,
  hasRealChoice, profileOf, settle, stabilizationDiagnostic, TURN_STEPS, type DeckInput, type GameCard, type GameState, type SeatId, type TriggerInstance, type TurnStep
} from "./engine.js";
import { parseManaCost } from "./mana.js";
import { botAction, pendingSeat, playBotGame } from "./bot.js";
import { projectGame } from "./projection.js";
import { isSafeManaUndo } from "./undo.js";

describe("smart counter response and safe mana undo", () => {
  it("resolves Sudden Spoiling's target-player layer and clears it at cleanup", () => {
    const card = make({ name: "Sudden Spoiling", type_line: "Instant", mana_cost: "{1}{B}{B}", cmc: 3, keywords: ["Split Second"], oracle_text: "Split second\nUntil end of turn, creatures target player controls lose all abilities and have base power and toughness 0/2." });
    let game = twoSeatGame([], []);
    game = { ...game, step: "precombat-main", activeSeat: 0, prioritySeat: 0, priorityOpen: true, players: game.players.map(p => ({ ...p, hand: [], autoPass: false })) };
    game = stage(game, 0, () => ({ hand: toHand(0, [card], "spoiling"), manaPool: { W: 0, U: 0, B: 2, R: 0, G: 0, C: 1 } }));
    game = putOnBattlefield(game, 1, [BEAR()]);
    game = applyAction(game, 0, { type: "cast", cardId: "spoiling-0", targets: [{ kind: "player", seat: 1 }] });
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "pass" });
    const affected = game.players[1]!.battlefield[0]!;
    expect(powerOf(affected, game)).toBe(0);
    expect(toughnessOf(affected, game)).toBe(2);
    expect(legalActions(game, 1).some(entry => entry.action.type === "activate" && entry.action.sourceId === affected.instance_id)).toBe(false);
  });
  it("creates bounded stabilization evidence without hidden zones", () => {
    const game = twoSeatGame([], []);
    const diagnostic = stabilizationDiagnostic({
      ...game,
      stack: [{ id: "public-spell", controller: 1, card: toHand(1, [make({ name: "Visible Spell", type_line: "Instant", oracle_text: "" })])[0]!, label: "Visible Spell", targets: [{ kind: "player", seat: 0 }], fromCommandZone: false, variableValue: 0, countered: false }],
      log: [...game.log, { turn: game.turn, step: game.step, seat: 0, text: "public checkpoint" }]
    });
    expect(diagnostic).toContain("stack=public-spell:Visible Spell");
    expect(diagnostic).toContain("targets=A");
    expect(diagnostic).toContain("recent=");
    expect(diagnostic).not.toContain("library");
    expect(diagnostic).not.toContain("hand");
  });

  it("projects creature status without invented noncreature 0/0 stats", () => {
    const game = putOnBattlefield(twoSeatGame([], []), 0, [ISLAND(), make({ name: "Zero", type_line: "Creature", power: "0", toughness: "0" })]);
    const permanents = projectGame(game, 0).players[0]!.battlefield;
    expect(permanents.at(-2)).toMatchObject({ isCreature: false, power: null, toughness: null });
    expect(permanents.at(-1)).toMatchObject({ isCreature: true, power: 0, toughness: 0 });
  });
  it("projects stack cards with their object kind and readable label", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ kind: "human", autoPass: false, hand: toHand(0, [BOLT()], "stack-card") }));
    game = stage(game, 1, () => ({ autoPass: false }));
    game = putOnBattlefield(game, 0, [MOUNTAIN()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    game = applyAction(game, 0, { type: "cast", cardId: "stack-card-0", targets: [{ kind: "player", seat: 1 }] });
    expect(projectGame(game, 1).stack[0]).toMatchObject({ kind: "spell", name: "Lightning Bolt", label: "Lightning Bolt", text: "Lightning Bolt deals 3 damage to any target.", targets: ["B"] });
  });
  it("keeps a public last-known target label after the target leaves", () => {
    let game = twoSeatGame([], []);
    const target = BEAR();
    game = stage(game, 0, () => ({ autoPass: false, hand: toHand(0, [BOLT()], "label-bolt") }));
    game = stage(game, 1, () => ({ autoPass: false }));
    game = putOnBattlefield(game, 1, [target]);
    game = putOnBattlefield(game, 0, [MOUNTAIN()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const bear = game.players[1]!.battlefield[0]!;
    game = applyAction(game, 0, { type: "cast", cardId: "label-bolt-0", targets: [{ kind: "permanent", instanceId: bear.instance_id }] });
    game = stage(game, 1, (player) => ({ battlefield: [] }));
    const projected = projectGame(game, 1);
    expect(projected.stack[0]!.targets).toEqual(["Grizzly Bears"]);
    expect(projected.players[0]!.hand).toBeUndefined();
  });
  it("projects the public priority pass cycle for the graphical stack", () => {
    let game = twoSeatGame([], []);
    game = { ...game, step: "precombat-main", activeSeat: 0, prioritySeat: 0, priorityOpen: true, passedSeats: [], players: game.players.map((player) => ({ ...player, autoPass: false })) };
    const first = projectGame(game, 0);
    expect(first.prioritySeat).toBe(0);
    expect(first.passedSeats).toEqual([]);
    game = applyAction(game, 0, { type: "pass" });
    const second = projectGame(game, 1);
    expect(second.prioritySeat).toBe(1);
    expect(second.passedSeats).toEqual([0]);
    expect(projectGame(game, 0).passedSeats).toEqual([0]);
  });
  it("cycles priority through living players and resets the pass cycle after a response", () => {
    let game = threeSeatGame();
    game = { ...game, step: "precombat-main", activeSeat: 0, prioritySeat: 0, priorityOpen: true, passedSeats: [], players: game.players.map((player) => ({ ...player, autoPass: false })) };
    game = applyAction(game, 0, { type: "pass" });
    expect(game.prioritySeat).toBe(1);
    expect(game.passedSeats).toEqual([0]);
    game = applyAction(game, 1, { type: "pass" });
    expect(game.prioritySeat).toBe(2);
    expect(game.passedSeats).toEqual([0, 1]);
    const boltCard = toHand(0, [BOLT()], "three-bolt")[0]!;
    const bolt = { id: "three-bolt", controller: 0 as SeatId, card: boltCard, label: boltCard.name, targets: [{ kind: "player", seat: 1 } as const], fromCommandZone: false, variableValue: 0, countered: false };
    game = { ...game, stack: [bolt], prioritySeat: 2, passedSeats: [0, 1] };
    game = applyAction(game, 2, { type: "pass" });
    expect(game.stack).toHaveLength(0);
    expect(game.passedSeats).toEqual([]);
  });
  it("projects stack spells as public targets and resolves the top object first", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, (player) => ({ autoPass: false, hand: toHand(0, [BOLT()], "stack-bolt") }));
    game = stage(game, 1, (player) => ({ autoPass: false, hand: toHand(1, [COUNTER()], "stack-counter") }));
    game = putOnBattlefield(game, 0, [MOUNTAIN(), MOUNTAIN(), MOUNTAIN()]);
    game = putOnBattlefield(game, 1, [ISLAND(), ISLAND()]);
    const boltCard = game.players[0]!.hand.find((card) => card.instance_id === "stack-bolt-0")!;
    const bolt = { id: "stack-bolt", controller: 0 as SeatId, card: boltCard, label: boltCard.name, targets: [{ kind: "player", seat: 1 } as const], fromCommandZone: false, variableValue: 0, countered: false };
    game = { ...game, step: "precombat-main", activeSeat: 1, prioritySeat: 1, priorityOpen: true, passedSeats: [], stack: [bolt] };
    const counter = legalActions(game, 1).find((entry) => entry.action.type === "cast" && entry.cardId === "stack-counter-0")!;
    expect(projectGame(game, 1).targetOptions.spell).toContainEqual({ kind: "spell", stackId: bolt.id });
    game = applyAction(game, 1, { ...counter.action, targets: [{ kind: "spell", stackId: bolt.id }] } as Extract<import("./engine.js").GameAction, { type: "cast" }>);
    expect(game.stack.map((object) => object.card.name)).toEqual(["Lightning Bolt", "Cancel Spell"]);
    game = applyAction(game, 1, { type: "pass" });
    game = applyAction(game, 0, { type: "pass" });
    expect(game.stack.at(-1)?.countered).toBe(true);
  });
  it("requires a full multiplayer pass cycle before resolving the top stack object", () => {
    let game = threeSeatGame();
    const spellCard = toHand(0, [BOLT()], "priority-bolt")[0]!;
    const spell = { id: "priority-bolt", controller: 0 as SeatId, card: spellCard, label: spellCard.name,
      targets: [{ kind: "player", seat: 1 } as const], fromCommandZone: false, variableValue: 0, countered: false };
    game = { ...game, step: "precombat-main", activeSeat: 0, prioritySeat: 0, priorityOpen: true, passedSeats: [], stack: [spell],
      players: game.players.map((player) => ({ ...player, autoPass: false })) };
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "pass" });
    expect(game.stack).toHaveLength(1);
    expect(game.prioritySeat).toBe(2);
    expect(game.passedSeats).toEqual([0, 1]);
    game = applyAction(game, 2, { type: "pass" });
    expect(game.stack).toHaveLength(0);
  });
  it("projects every target kind for a multi-target modal action", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ kind: "human", autoPass: false, hand: toHand(0, [FISSURE_VENT()], "multi-target") }));
    game = stage(game, 1, () => ({ autoPass: false }));
    game = putOnBattlefield(game, 0, [MOUNTAIN(), MOUNTAIN(), MOUNTAIN(), MOUNTAIN()]);
    game = putOnBattlefield(game, 1, [SOL_RING(), COMMAND_TOWER()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const projected = projectGame(game, 0);
    expect(projected.targetOptions["nonbasic-land"]).toEqual(expect.arrayContaining([
      { kind: "permanent", instanceId: expect.any(String) }
    ]));
  });
  it("offers Simian Spirit Guide's hand mana instead of guessing cast", () => {
    let game = twoSeatGame([], []);
    const guide = SIMIAN_SPIRIT_GUIDE();
    game = stage(game, 0, () => ({ kind: "human", autoPass: false, hand: toHand(0, [guide], "guide") }));
    game = stage(game, 1, () => ({ autoPass: false }));
    game = putOnBattlefield(game, 0, [MOUNTAIN(), MOUNTAIN(), MOUNTAIN()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const actions = legalActions(game, 0).filter((entry) => entry.cardId === "guide-0");
    expect(actions.some((entry) => entry.action.type === "cast")).toBe(true);
    const manaAction = actions.find((entry) => entry.action.type === "activate-mana");
    expect(manaAction?.action).toMatchObject({ type: "activate-mana", mana: "R" });
    game = applyAction(game, 0, manaAction!.action);
    expect(game.players[0]!.hand.some((card) => card.instance_id === "guide-0")).toBe(false);
    expect(game.players[0]!.exile.some((card) => card.instance_id === "guide-0")).toBe(true);
    expect(game.players[0]!.manaPool.R).toBe(1);
    expect(game.stack).toHaveLength(0);
    const battlefieldGuide = putOnBattlefield(twoSeatGame([], []), 0, [guide]);
    expect(projectGame(battlefieldGuide, 0).players[0]!.battlefield[0]!.producesMana).toBe(false);
  });
  it("executes a Treasure token's sacrifice-for-mana ability", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [make({ name: "Treasure", type_line: "Artifact — Treasure", oracle_text: "{T}, Sacrifice this artifact: Add one mana of any color.", scryfall_id: "fixture-treasure-mana" })]);
    const treasure = game.players[0]!.battlefield[0]!;
    const action = legalActions(game, 0).find((entry) => entry.action.type === "activate-mana"
      && entry.cardId === treasure.instance_id && entry.action.mana === "G");
    expect(action?.action).toMatchObject({ type: "activate-mana", mana: "G" });
    game = applyAction(game, 0, action!.action);
    expect(game.players[0]!.battlefield).toHaveLength(0);
    expect(game.players[0]!.manaPool.G).toBe(1);
  });

  it("keeps `this card` fast mana and casting as separate legal hand actions", () => {
    let game = twoSeatGame([], []);
    const guide = make({
      name: "Simian Spirit Guide", type_line: "Creature — Ape Spirit", mana_cost: "{2}{R}", cmc: 3,
      power: "2", toughness: "2", oracle_text: "Exile this card from your hand: Add {R}."
    });
    game = stage(game, 0, () => ({ kind: "human", autoPass: false, hand: toHand(0, [guide], "modern-guide") }));
    game = stage(game, 1, () => ({ autoPass: false }));
    game = putOnBattlefield(game, 0, [MOUNTAIN(), MOUNTAIN(), MOUNTAIN()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const actions = legalActions(game, 0).filter((entry) => entry.cardId === "modern-guide-0");
    expect(actions.some((entry) => entry.action.type === "cast")).toBe(true);
    expect(actions.some((entry) => entry.action.type === "activate-mana")).toBe(true);
  });
  it("projects player-attached Auras without leaking or losing the attachment", () => {
    const curse = make({ name: "Test Curse", type_line: "Enchantment — Aura", oracle_text: "Enchant player" });
    let game = putOnBattlefield(twoSeatGame([], []), 0, [curse]);
    const aura = game.players[0]!.battlefield[0]!;
    game = stage(game, 0, (player) => ({
      battlefield: player.battlefield.map((permanent) => permanent.instance_id === aura.instance_id
        ? { ...permanent, attachedToPlayer: 1 }
        : permanent)
    }));
    expect(projectGame(game, 0).players[0]!.battlefield[0]).toMatchObject({ attachedToPlayer: 1 });
    expect(projectGame(game, 1).players[0]!.battlefield[0]).toMatchObject({ attachedToPlayer: 1 });
  });
  it("annihilates opposing +1/+1 and -1/-1 counters as a state-based action", () => {
    let game = putOnBattlefield(twoSeatGame([], []), 0, [BEAR()]);
    const bear = game.players[0]!.battlefield.at(-1)!;
    game = stage(game, 0, (player) => ({
      battlefield: player.battlefield.map((permanent) => permanent.instance_id === bear.instance_id
        ? { ...permanent, counters: { "+1/+1": 2, "-1/-1": 1 } }
        : permanent)
    }));
    game = settle(game);
    const updated = game.players[0]!.battlefield.find((permanent) => permanent.instance_id === bear.instance_id)!;
    expect(updated.counters).toEqual({ "+1/+1": 1 });
    expect(powerOf(updated, game)).toBe(3);
    expect(toughnessOf(updated, game)).toBe(3);
  });
  function board(text = "Counter target spell with mana value 1.") {
    let game = twoSeatGame([], []);
    game = { ...game, step: "precombat-main", activeSeat: 0, prioritySeat: 0, priorityOpen: true, stack: [], triggerQueue: [], pendingChoice: null,
      players: game.players.map(p => ({ ...p, autoPass: false, hand: [], commandZone: [] })) };
    game = stage(game, 0, () => ({ hand: toHand(0, [make({ name: "Mental Misstep", type_line: "Instant", mana_cost: "{U/P}", cmc: 1, oracle_text: text })]) }));
    return putOnBattlefield(game, 0, [ISLAND(), ISLAND()]);
  }
  function spell(game: GameState, mv: number, text = "") {
    const card = toHand(1, [make({ name: "Response subject", type_line: "Instant", mana_cost: `{${mv}}`, cmc: mv, oracle_text: text })])[0]!;
    return { ...game, stack: [{ id: "subject", controller: 1, card, label: card.name, targets: [], fromCommandZone: false, variableValue: 0, countered: false }] };
  }
  it("requires exactly MV 1, not an empty stack or a different MV", () => {
    const game = board();
    expect(hasRealChoice(game, 0)).toBe(false);
    expect(hasRealChoice(spell(game, 2), 0)).toBe(false);
    expect(hasRealChoice(spell(game, 0), 0)).toBe(false);
    expect(hasRealChoice(spell(game, 1), 0)).toBe(true);
  });
  it("never auto-passes an explicit pending choice", () => {
    const game = { ...board(), pendingChoice: { type: "choose-color" as const, seat: 0 as SeatId, sourceId: "color", sourceCard: { ...BOLT(), instance_id: "color-source", owner: 0 as SeatId }, effect: { kind: "add-mana-any-color" as const }, variableValue: 0, exileSourceAfterResolution: false, sendSourceToGraveyard: false } };
    expect(hasRealChoice(game, 0)).toBe(true);
  });
  it("keeps uncounterable targets legal in full control but skips counter-only responses", () => {
    const game = spell(board(), 1, "This spell can't be countered.");
    expect(hasRealChoice(game, 0)).toBe(false);
    const cast = legalActions(game, 0).find(a => a.action.type === "cast")!;
    expect(cast).toBeDefined();
    let next = applyAction(game, 0, { ...cast.action, targets: [{ kind: "spell", stackId: "subject" }] } as Extract<import("./engine.js").GameAction, { type: "cast" }>);
    next = applyAction(next, 0, { type: "pass" });
    next = applyAction(next, 1, { type: "pass" });
    expect(next.stack.find(s => s.id === "subject")?.countered).toBe(false);
    expect(hasRealChoice(spell(board("Counter target spell. Draw a card."), 1, "This spell can't be countered."), 0)).toBe(true);
  });
  it("never offers counter-only priority for triggered or activated stack objects", () => {
    const counter = board("Counter target spell.");
    const source = putOnBattlefield(counter, 1, [make({ name: "Trigger Source", type_line: "Creature", power: "1", toughness: "1", oracle_text: "Whenever you gain life, draw a card." })]);
    const triggerCard = source.players[1]!.battlefield[0]!.card;
    const trigger = {
      id: "trigger-subject", controller: 1 as SeatId, card: triggerCard, label: "Trigger Source · life gained", targets: [],
      fromCommandZone: false, variableValue: 0, countered: false,
      trigger: {
        id: "trigger-subject", controller: 1 as SeatId, sourcePermanentId: source.players[1]!.battlefield[0]!.instance_id,
        sourceCard: triggerCard, definition: { event: "life-gained" as const, subject: "you" as const, effect: { kind: "draw", amount: 1 } as const, targetKind: "none" as const, optional: false, sourceText: "Whenever you gain life, draw a card." }, cause: "test"
      }
    };
    const activated = { ...trigger, id: "activated-subject", label: "Trigger Source · activated", trigger: undefined,
      activated: { index: 0, text: "{T}: Draw a card.", cost: { manaValue: 0, raw: "{T}", symbols: [], hasVariable: false }, effect: { kind: "draw", amount: 1 } as const, targetKind: "none" as const,
        requiresTap: true, sacrificesSelf: false, lifeCost: 0, manaCost: null } };
    expect(hasRealChoice({ ...source, stack: [trigger] }, 0)).toBe(false);
    expect(hasRealChoice({ ...source, stack: [activated] }, 0)).toBe(false);
  });
  it("projects only spells as counter targets when the stack mixes object kinds", () => {
    const counter = board("Counter target spell.");
    const source = putOnBattlefield(counter, 1, [make({ name: "Trigger Source", type_line: "Creature", power: "1", toughness: "1", oracle_text: "Whenever you gain life, draw a card." })]);
    const card = source.players[1]!.battlefield[0]!.card;
    const spell = { ...BOLT(), instance_id: "mixed-spell", owner: 1 };
    const trigger = { id: "mixed-trigger", controller: 1 as SeatId, card, label: "Trigger Source · life gained", targets: [], fromCommandZone: false, variableValue: 0, countered: false,
      trigger: { id: "mixed-trigger", controller: 1 as SeatId, sourcePermanentId: source.players[1]!.battlefield[0]!.instance_id, sourceCard: card,
        definition: { event: "life-gained" as const, subject: "you" as const, effect: { kind: "draw", amount: 1 } as const, targetKind: "none" as const, optional: false, sourceText: "Whenever you gain life, draw a card." }, cause: "test" } };
    const activated = { ...trigger, id: "mixed-activated", label: "Trigger Source · activated", trigger: undefined,
      activated: { index: 0, text: "{T}: Draw a card.", cost: { manaValue: 0, raw: "{T}", symbols: [], hasVariable: false }, effect: { kind: "draw", amount: 1 } as const, targetKind: "none" as const, requiresTap: true, sacrificesSelf: false, lifeCost: 0, manaCost: null } };
    const projected = projectGame({ ...source, stack: [trigger, activated, { id: "mixed-spell", controller: 1 as SeatId, card: spell, label: spell.name, targets: [], fromCommandZone: false, variableValue: 0, countered: false }] }, 0);
    expect(projected.targetOptions.spell).toEqual([{ kind: "spell", stackId: "mixed-spell" }]);
  });
  it("allows only unchanged-state mana/tap deltas and rejects City of Brass triggers", () => {
    const game = board();
    const action = legalActions(game, 0).find(a => a.action.type === "activate-mana")!.action;
    const next = applyAction(game, 0, action);
    expect(isSafeManaUndo(game, next, 0, action)).toBe(true);
    expect(isSafeManaUndo(game, { ...next, players: next.players.map(p => p.seat === 1 ? { ...p, life: p.life - 1 } : p) }, 0, action)).toBe(false);
    expect(isSafeManaUndo(game, applyAction(next, 0, { type: "pass" }), 0, action)).toBe(false);
    const city = putOnBattlefield(game, 0, [make({ name: "City of Brass", type_line: "Land", oracle_text: "Whenever City of Brass becomes tapped, it deals 1 damage to you.\n{T}: Add one mana of any color." })]);
    const cityAction = legalActions(city, 0).find(a => a.action.type === "activate-mana" && a.action.sourceId === city.players[0]!.battlefield.at(-1)!.instance_id)!.action;
    const tapped = applyAction(city, 0, cityAction);
    expect(tapped.stack.length).toBeGreaterThan(0);
    expect(isSafeManaUndo(city, tapped, 0, cityAction)).toBe(false);

    const pain = putOnBattlefield(game, 0, [PAIN_LAND()]);
    const painAction = legalActions(pain, 0).find(a => a.action.type === "activate-mana"
      && a.action.sourceId === pain.players[0]!.battlefield.at(-1)!.instance_id && a.action.abilityIndex === 1)!.action;
    const painTapped = applyAction(pain, 0, painAction);
    expect(painTapped.players[0]!.life).toBe(39);
    expect(isSafeManaUndo(pain, painTapped, 0, painAction)).toBe(true);
  });
});

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
const MOUNTAIN = () => make({ name: "Mountain", type_line: "Basic Land — Mountain", produced_mana: ["R"] });
const SWAMP = () => make({ name: "Swamp", type_line: "Basic Land — Swamp", produced_mana: ["B"] });
const FROSTBOIL = () => make({
  name: "Frostboil Snarl", type_line: "Land", oracle_text: "As Frostboil Snarl enters, you may reveal an Island or Mountain card from your hand. If you don't, Frostboil Snarl enters tapped.\n{T}: Add {U} or {R}.", produced_mana: ["U", "R"]
});
const TAPLAND = () => make({ name: "Slow Gate", type_line: "Land", oracle_text: "Slow Gate enters tapped.\n{T}: Add {G}.", produced_mana: ["G"] });
const STARTING_TOWN = () => make({ name: "Starting Town", type_line: "Land — Town", oracle_text: "This land enters tapped unless it's your first, second, or third turn of the game.\n{T}: Add {C}.", produced_mana: ["C"] });
const BEAR = () => make({ name: "Grizzly Bears", type_line: "Creature — Bear", mana_cost: "{1}{G}", cmc: 2, power: "2", toughness: "2" });
const ETB_DRAWER = () => make({ name: "Archivist Bear", type_line: "Creature — Bear", mana_cost: "{1}{G}", cmc: 2, power: "2", toughness: "2", oracle_text: "When Archivist Bear enters the battlefield, draw a card." });
const TRIGGER_DOUBLER_SUBTYPE = () => make({ name: "Test Harmonic Prodigy", type_line: "Creature — Fox Shaman", mana_cost: "{1}{U}", cmc: 2, power: "2", toughness: "2", oracle_text: "If a triggered ability of a Shaman or another Wizard you control triggers, that ability triggers an additional time." });
const WIZARD_ETB_DRAWER = () => make({ name: "Test Wizard Apprentice", type_line: "Creature — Human Wizard", mana_cost: "{1}{U}", cmc: 2, power: "1", toughness: "1", oracle_text: "When this creature enters, draw a card." });
const ARTIFACT_ETB_DRAWER = () => make({ name: "Relic Archivist", type_line: "Creature — Human", mana_cost: "{2}{U}", cmc: 3, power: "2", toughness: "2", oracle_text: "Whenever an artifact enters the battlefield under your control, draw a card." });
const ENCHANTMENT_ETB_DRAWER = () => make({ name: "Oath Archivist", type_line: "Creature — Human", mana_cost: "{2}{U}", cmc: 3, power: "2", toughness: "2", oracle_text: "Whenever an enchantment enters the battlefield under your control, draw a card." });
const PERMANENT_ETB_DRAWER = () => make({ name: "Permanent Archivist", type_line: "Creature — Human", mana_cost: "{2}{U}", cmc: 3, power: "2", toughness: "2", oracle_text: "Whenever a permanent enters the battlefield under your control, draw a card." });
const ANOTHER_PERMANENT_ETB_DRAWER = () => make({ name: "Another Archivist", type_line: "Creature — Human", mana_cost: "{2}{U}", cmc: 3, power: "2", toughness: "2", oracle_text: "Whenever another permanent enters the battlefield under your control, draw a card." });
const ANY_SPELL_TRIGGER = () => make({ name: "Spell Archivist", type_line: "Creature — Human", mana_cost: "{2}{U}", cmc: 3, power: "2", toughness: "2", oracle_text: "Whenever a player casts a spell, draw a card." });
const OPTIONAL_ETB_DRAWER = () => make({ name: "Optional Archivist", type_line: "Creature — Bear", mana_cost: "{1}{G}", cmc: 2, power: "2", toughness: "2", oracle_text: "When Optional Archivist enters the battlefield, you may draw a card." });
const WALL = () => make({ name: "Stone Wall", type_line: "Creature — Wall", mana_cost: "{W}", cmc: 1, power: "0", toughness: "4", keywords: ["Defender"], oracle_text: "Defender" });
const WARD_SENTINEL = () => make({ name: "Ward Sentinel", type_line: "Creature — Spirit", mana_cost: "{2}{U}", cmc: 3, power: "2", toughness: "3", keywords: ["Ward"], oracle_text: "Ward {2}" });
const WARD_BOLT = () => make({ name: "Ward Bolt", type_line: "Instant", mana_cost: "{R}", cmc: 1, oracle_text: "Destroy target creature." });
const SERENE_MASTER = () => make({ name: "Serene Master", type_line: "Creature — Human Monk", mana_cost: "{1}{W}", cmc: 2, power: "0", toughness: "2", oracle_text: "Whenever this creature blocks, exchange its power and the power of target creature it's blocking until end of combat.", oracle_id: "2ce0d583-81ca-4dca-bde0-52f86b683afd", scryfall_id: "06223a09-a32c-4c60-86a1-f8f7bf5a7cdd" });
const FLIER = () => make({ name: "Storm Crow", type_line: "Creature — Bird", mana_cost: "{1}{U}", cmc: 2, power: "1", toughness: "2", keywords: ["Flying"], oracle_text: "Flying" });
const GUARD_GOMAZOA = () => make({ name: "Guard Gomazoa", type_line: "Creature — Jellyfish", mana_cost: "{2}{U}", cmc: 3, power: "1", toughness: "3", keywords: ["Defender", "Flying"], oracle_text: "Defender, flying\nPrevent all combat damage that would be dealt to this creature." });
const TRAMPLER = () => make({ name: "Big Stomper", type_line: "Creature — Beast", mana_cost: "{3}{G}", cmc: 4, power: "6", toughness: "6", keywords: ["Trample"], oracle_text: "Trample" });
const DEATHTOUCHER = () => make({ name: "Tiny Viper", type_line: "Creature — Snake", mana_cost: "{B}", cmc: 1, power: "1", toughness: "1", keywords: ["Deathtouch"], oracle_text: "Deathtouch" });
const VRASKA_SWARMS_EMINENCE = () => make({ name: "Vraska, Swarm's Eminence", type_line: "Legendary Planeswalker — Vraska", mana_cost: "{2}{B}{G}", cmc: 4, loyalty: "4", oracle_text: "Whenever a creature you control with deathtouch deals damage to a player or planeswalker, put a +1/+1 counter on that creature.", oracle_id: "cff8b4e9-c60c-42c1-ad2e-74ae9d7f3afb" });
const FEARER = () => make({ name: "Fear Stalker", type_line: "Creature — Horror", mana_cost: "{2}{B}", cmc: 3, power: "3", toughness: "2", keywords: ["Fear"], oracle_text: "Fear" });
const BLACK_BLOCKER = () => make({ name: "Dusk Bat", type_line: "Creature — Bat", mana_cost: "{1}{B}", cmc: 2, power: "1", toughness: "1", colors: ["B"] });
const ARTIFACT_BLOCKER = () => make({ name: "Iron Construct", type_line: "Artifact Creature — Construct", mana_cost: "{2}", cmc: 2, power: "2", toughness: "2" });
const C13_SYDRI = () => make({ name: "Sydri, Galvanic Genius", type_line: "Legendary Creature — Human Wizard", mana_cost: "{W}{U}{B}", cmc: 3, power: "2", toughness: "2", oracle_text: "{U}: Target noncreature artifact becomes an artifact creature with power and toughness each equal to its mana value until end of turn.\n{W}{B}: Target artifact creature gains deathtouch and lifelink until end of turn.", oracle_id: "4e92d36b-1a35-4fa9-87ea-10eace5a3cc7" });
const LIFELINKER = () => make({ name: "Kind Knight", type_line: "Creature — Knight", mana_cost: "{1}{W}", cmc: 2, power: "2", toughness: "2", keywords: ["Lifelink"], oracle_text: "Lifelink" });
const FIRST_STRIKER = () => make({ name: "Quick Blade", type_line: "Creature — Soldier", mana_cost: "{1}{W}", cmc: 2, power: "2", toughness: "2", keywords: ["First strike"], oracle_text: "First strike" });
const FIRST_STRIKE_ON_YOUR_TURN = () => make({ name: "Test Razorkin Needlehead", type_line: "Creature — Goblin Berserker", mana_cost: "{B}", cmc: 1, power: "2", toughness: "2", oracle_text: "This creature has first strike during your turn." });
const SPHINX_OF_THE_STEEL_WIND = () => make({
  name: "Sphinx of the Steel Wind", type_line: "Artifact Creature — Sphinx", mana_cost: "{5}{W}{U}{B}", cmc: 8,
  power: "6", toughness: "6", colors: ["W", "U", "B"],
  oracle_text: "Flying, first strike, vigilance, lifelink, protection from red and from green"
});
const RED_RAIDER = () => make({ name: "Red Raider", type_line: "Creature — Goblin", mana_cost: "{1}{R}", cmc: 2, power: "3", toughness: "3", colors: ["R"] });
const BOLT = () => make({ name: "Lightning Bolt", type_line: "Instant", mana_cost: "{R}", cmc: 1, oracle_text: "Lightning Bolt deals 3 damage to any target." });
const SIMIAN_SPIRIT_GUIDE = () => make({ name: "Simian Spirit Guide", type_line: "Creature — Ape Spirit", mana_cost: "{2}{R}", cmc: 3, power: "2", toughness: "2", oracle_text: "Exile Simian Spirit Guide from your hand: Add {R}." });
const WAR_CADENCE = () => make({ name: "War Cadence", type_line: "Enchantment", mana_cost: "{2}{R}", cmc: 3, oracle_text: "{X}: This turn, creatures can't block unless their controller pays {X} for each blocking creature they control.", oracle_id: "49d0fdd6-cc8f-4fe1-a6bd-4321dac18404" });
const SEKKUAR = () => make({ name: "Sek'Kuar, Deathkeeper", type_line: "Legendary Creature — Orc Shaman", mana_cost: "{2}{B}{R}{G}", cmc: 5, power: "4", toughness: "3", colors: ["B", "R", "G"], oracle_text: "Whenever another nontoken creature you control dies, create a 3/1 black and red Graveborn creature token with haste.", oracle_id: "94426127-65c2-435e-ba92-423a3c102061" });
const REGENERATE_TARGET = () => make({ name: "Regrowth Shield", type_line: "Instant", mana_cost: "{1}{G}", cmc: 2, oracle_text: "Regenerate target creature." });
const CHAOS_WARP = () => make({ name: "Chaos Warp", type_line: "Instant", mana_cost: "{2}{R}", cmc: 3, oracle_text: "The owner of target permanent shuffles it into their library, then reveals the top card of their library. If it's a permanent card, they put it onto the battlefield." });
const WASH_OUT = () => make({ name: "Wash Out", type_line: "Sorcery", mana_cost: "{3}{U}", cmc: 4, oracle_text: "Return all permanents of the color of your choice to their owners' hands.", oracle_id: "54748cb1-d92a-4212-ad76-417ee79b5ef1" });
const BLUE_PERMANENT = () => make({ name: "Blue Permanent", type_line: "Enchantment", colors: ["U"] });
const RED_PERMANENT = () => make({ name: "Red Permanent", type_line: "Enchantment", colors: ["R"] });
const COLORLESS_PERMANENT = () => make({ name: "Colorless Permanent", type_line: "Artifact" });
const DESTROY_TARGET_CREATURE = () => make({ name: "Destroy Target Creature", type_line: "Instant", mana_cost: "{1}{B}", cmc: 2, oracle_text: "Destroy target creature." });
const DECREE_OF_PAIN = () => make({ name: "Decree of Pain", type_line: "Sorcery", mana_cost: "{4}{B}{B}", cmc: 6, oracle_text: "Destroy all creatures. They can't be regenerated. Draw a card for each creature destroyed this way.\nCycling {3}{B}{B}\nWhen you cycle this card, all creatures get -2/-2 until end of turn." });
const C13_SUDDEN_DEMISE = () => make({ name: "Sudden Demise", type_line: "Sorcery", mana_cost: "{X}{R}", cmc: 1, oracle_text: "Choose a color. ~ deals X damage to each creature of the chosen color.", oracle_id: "b34b5b3f-7f17-4292-814e-634408a5d7a5", scryfall_id: "7217afaa-00e1-45a7-bb7f-66a770487b77" });
const C13_FIERY_JUSTICE = () => make({ name: "Fiery Justice", type_line: "Sorcery", mana_cost: "{R}{G}{W}", cmc: 3, oracle_text: "Fiery Justice deals 5 damage divided as you choose among any number of targets. Target opponent gains 5 life.", oracle_id: "333809cb-e196-45f2-8a67-31374438e56e", scryfall_id: "ab5056f0-8297-4b83-9655-7ff385e309a8" });
const C13_SUDDEN_SPOILING = () => make({ name: "Sudden Spoiling", type_line: "Instant", mana_cost: "{1}{B}{B}", cmc: 3, keywords: ["Split Second"], oracle_text: "Split second (As long as this spell is on the stack, players can't cast spells or activate abilities that aren't mana abilities.)\nUntil end of turn, creatures target player controls lose all abilities and have base power and toughness 0/2.", oracle_id: "dce202c7-fe8e-462a-858e-7a5a69bd5b6b", scryfall_id: "14d8bf94-ba55-437f-ac69-ece24049944d" });
const C13_PHANTOM_NANTUKO = () => make({ name: "Phantom Nantuko", type_line: "Creature — Insect", mana_cost: "{2}{G}{G}", cmc: 4, power: "2", toughness: "2", keywords: ["Trample"], oracle_text: "Trample\nThis creature enters with two +1/+1 counters on it.\nIf damage would be dealt to this creature, prevent that damage. Remove a +1/+1 counter from this creature.\n{T}: Put a +1/+1 counter on this creature.", oracle_id: "0951b529-646c-4dfd-88ad-84ee117ce722", scryfall_id: "0951b529-646c-4dfd-88ad-84ee117ce722" });
const C13_HULL_BREACH = () => make({ name: "Hull Breach", type_line: "Sorcery", mana_cost: "{R}{G}", cmc: 2, oracle_text: "Choose one —\n• Destroy target artifact.\n• Destroy target enchantment.\n• Destroy target artifact and target enchantment.", oracle_id: "2da232d8-580f-4116-b977-2c59cd21b5a4", scryfall_id: "6e8c6558-ff31-4511-942a-8fe88ac20f1f" });
const C13_DECEIVER_EXARCH = () => make({ name: "Deceiver Exarch", type_line: "Creature — Cleric", mana_cost: "{2}{U}", cmc: 3, power: "1", toughness: "4", oracle_text: "Flash\nWhen this creature enters, choose one —\n• Untap target permanent you control.\n• Tap target permanent an opponent controls.", oracle_id: "3c939ea6-68b7-4965-b1d3-af1d3dc79778", scryfall_id: "b9c5761b-52f8-4f43-abfb-8d2366500f8f" });
const THOUSAND_YEAR_ELIXIR = () => make({ name: "Thousand-Year Elixir", type_line: "Artifact", mana_cost: "{3}", cmc: 3, oracle_text: "You may activate abilities of creatures you control as though those creatures had haste.\n{1}, {T}: Untap target creature.", oracle_id: "4dc5726e-2f7e-4c2b-9616-c3301d212f78" });
const KIRTARS_WRATH = () => make({ name: "Kirtar's Wrath", type_line: "Sorcery", mana_cost: "{4}{W}{W}", cmc: 6, oracle_text: "Destroy all creatures. They can't be regenerated.\nThreshold — If there are seven or more cards in your graveyard, instead destroy all creatures, then create two 1/1 white Spirit creature tokens with flying. Creatures destroyed this way can't be regenerated.", oracle_id: "4f66d82a-492f-4638-9f77-190d4a33ad7f" });
const SICK_TAPPER = () => make({ name: "Sick Tapper", type_line: "Creature — Human", mana_cost: "{1}", cmc: 1, power: "1", toughness: "1", oracle_text: "{T}: Draw a card." });
const DIRGE_OF_DREAD = () => make({ name: "Dirge of Dread", type_line: "Sorcery", mana_cost: "{2}{B}", cmc: 3, oracle_text: "All creatures gain fear until end of turn.\nCycling {1}{B}\nWhen you cycle this card, you may have target creature gain fear until end of turn.", oracle_id: "be7b16ef-32aa-40d5-b287-c5e79d52d6b9", scryfall_id: "be7b16ef-32aa-40d5-b287-c5e79d52d6b9" });
const SLICE_AND_DICE = () => make({ name: "Slice and Dice", type_line: "Sorcery", mana_cost: "{4}{R}{R}", cmc: 6, oracle_text: "Cycling {2}{R}\nWhen you cycle Slice and Dice, you may have it deal 1 damage to each creature.", oracle_id: "463fc961-d34e-4f40-b383-5b78a0fcb5c8" });
const DESERTION = () => make({ name: "Desertion", type_line: "Instant", mana_cost: "{2}{U}{U}", cmc: 4, oracle_text: "Counter target spell. If that spell is an artifact or creature spell, put it onto the battlefield under your control instead of into its owner's graveyard." });
const CREATURE_COUNT_BOLT = () => make({ name: "Creature Count Bolt", type_line: "Instant", mana_cost: "{2}{R}", cmc: 3, oracle_text: "This spell deals damage equal to the number of creatures you control to any target." });
const TAP_SPELL = () => make({ name: "Tactical Tap", type_line: "Instant", mana_cost: "{1}{U}", cmc: 2, oracle_text: "Tap target creature." });
const UNTAP_SPELL = () => make({ name: "Tactical Untap", type_line: "Instant", mana_cost: "{1}{U}", cmc: 2, oracle_text: "Untap target permanent." });
const MILL_SPELL = () => make({ name: "Gravewind", type_line: "Sorcery", mana_cost: "{1}{B}", cmc: 2, oracle_text: "Target player mills three cards." });
const EACH_MILL_SPELL = () => make({ name: "Shared Gravewind", type_line: "Sorcery", mana_cost: "{2}{B}", cmc: 3, oracle_text: "Each opponent mills two cards." });
const ALL_MILL_SPELL = () => make({ name: "Universal Gravewind", type_line: "Sorcery", mana_cost: "{2}{B}", cmc: 3, oracle_text: "Each player mills two cards." });
const EACH_DRAW_SPELL = () => make({ name: "Shared Insight", type_line: "Sorcery", mana_cost: "{2}{U}", cmc: 3, oracle_text: "Each opponent draws two cards." });
const WHEEL_SPELL = () => make({ name: "Shared Wheel", type_line: "Sorcery", mana_cost: "{3}{U}", cmc: 4, oracle_text: "Each player discards their hand, then draws seven cards." });
const CREATURE_COUNTER = () => make({ name: "Creature Denial", type_line: "Instant", mana_cost: "{U}", cmc: 1, oracle_text: "Counter target creature spell." });
const NONCREATURE_COUNTER = () => make({ name: "Noncreature Denial", type_line: "Instant", mana_cost: "{U}", cmc: 1, oracle_text: "Counter target noncreature spell." });
const GROWTH_SPELL = () => make({ name: "Measured Growth", type_line: "Instant", mana_cost: "{1}{G}", cmc: 2, oracle_text: "Put a +1/+1 counter on target creature." });
const DISCARD_SPELL = () => make({ name: "Mind Twist", type_line: "Sorcery", mana_cost: "{1}{B}", cmc: 2, oracle_text: "Target player discards a card." });
const BLIGHTNING = () => make({ name: "Blightning", type_line: "Sorcery", mana_cost: "{1}{B}{R}", cmc: 3, oracle_text: "Blightning deals 3 damage to target player or planeswalker. That player or that planeswalker's controller discards two cards.", oracle_id: "a6496440-dc0c-4d9b-bf37-f537b6f0187b", scryfall_id: "a6496440-dc0c-4d9b-bf37-f537b6f0187b" });
const PEER_INTO_THE_ABYSS = () => make({ name: "Peer into the Abyss", type_line: "Sorcery", mana_cost: "{5}{B}{B}", cmc: 7, oracle_text: "Target player draws cards equal to half the number of cards in their library and loses half their life. Round up each time.", oracle_id: "21fa2442-6eac-4dce-a9cc-76f0053fdb8f", scryfall_id: "8627ecd0-3b32-43f9-8d0e-46a8d175ee2d" });
const DISCARD_HAND_SPELL = () => make({ name: "Memory Collapse", type_line: "Sorcery", mana_cost: "{3}{B}", cmc: 4, oracle_text: "Target player discards their hand." });
const X_DISCARD_SPELL = () => make({ name: "Scalable Mind Twist", type_line: "Sorcery", mana_cost: "{X}{B}", cmc: 1, oracle_text: "Target player discards X cards." });
const FORGET = () => make({ name: "Forget", type_line: "Sorcery", mana_cost: "{1}{U}", cmc: 2, oracle_text: "Target player discards two cards, then draws as many cards as they discarded this way.", oracle_id: "619ef7e1-33cd-4470-a1d4-83c5f1f5c31e", scryfall_id: "8cc8e367-1aa4-43b6-b17a-01bfb097f620" });
const LIFE_SPELL = () => make({ name: "Simple Blessing", type_line: "Instant", mana_cost: "{G}", cmc: 1, oracle_text: "You gain 1 life." });
const ARTIFACT_LIFE_SPELL = () => make({ name: "Artifact Blessing", type_line: "Instant", mana_cost: "{2}{W}", cmc: 3, oracle_text: "You gain 2 life for each artifact you control." });
const CREATURE_LIFE_SPELL = () => make({ name: "Creature Blessing", type_line: "Instant", mana_cost: "{2}{W}", cmc: 3, oracle_text: "You gain 1 life for each creature you control." });
const LAND_LIFE_SPELL = () => make({ name: "Land Blessing", type_line: "Instant", mana_cost: "{2}{W}", cmc: 3, oracle_text: "You gain 1 life for each land you control." });
const PERMANENT_LIFE_SPELL = () => make({ name: "Permanent Blessing", type_line: "Instant", mana_cost: "{3}{W}", cmc: 4, oracle_text: "You gain 1 life for each permanent you control." });
const PLANESWALKER_LIFE_SPELL = () => make({ name: "Walker Blessing", type_line: "Instant", mana_cost: "{3}{W}", cmc: 4, oracle_text: "You gain 2 life for each planeswalker you control." });
const BATTLE_LIFE_SPELL = () => make({ name: "Battle Blessing", type_line: "Instant", mana_cost: "{3}{W}", cmc: 4, oracle_text: "You gain 1 life for each battle you control." });
const TEST_ARTIFACT = () => make({ name: "Test Relic", type_line: "Artifact", mana_cost: "{2}", cmc: 2 });
const POWER_LIFE_SPELL = () => make({ name: "Power Blessing", type_line: "Instant", mana_cost: "{G}", cmc: 1, oracle_text: "You gain life equal to the power of target creature you control." });
const BROODING_SAURIAN = () => make({ name: "Brooding Saurian", type_line: "Creature — Lizard", mana_cost: "{2}{G}{G}", cmc: 4, power: "4", toughness: "4", oracle_text: "At the beginning of each end step, each player gains control of all nontoken permanents they own.", scryfall_id: "2fb7f844-edaf-43ef-9121-318baf9ec9ce" });
const MIRARI = () => make({ name: "Mirari", type_line: "Legendary Artifact", mana_cost: "{5}", cmc: 5, oracle_text: "Whenever you cast an instant or sorcery spell, you may pay {3}. If you do, copy that spell. You may choose new targets for the copy.", oracle_id: "8f6a2fce-719e-4745-80d3-aabce5c9bafa", scryfall_id: "7de1dfcf-f2e7-4c7c-8b00-c5d30a2d3f98" });
const CAPRICIOUS_EFREET = () => make({ name: "Capricious Efreet", type_line: "Creature — Efreet", mana_cost: "{3}{R}{R}", cmc: 5, power: "3", toughness: "3", oracle_text: "At the beginning of your upkeep, choose target nonland permanent you control and up to two target nonland permanents you don't control. Destroy one of them at random.", scryfall_id: "9abd2286-23e9-49cd-be53-39423890f35c" });
const CHARMBREAKER_DEVILS = () => make({ name: "Charmbreaker Devils", type_line: "Creature — Devil", mana_cost: "{5}{R}", cmc: 6, power: "5", toughness: "4", oracle_text: "At the beginning of your upkeep, return an instant or sorcery card at random from your graveyard to your hand.", scryfall_id: "1b9df437-6988-4ddc-80c4-893e11076067" });
const ARCHAEOMANCER = () => make({ name: "Archaeomancer", type_line: "Creature — Human Wizard", mana_cost: "{2}{U}{U}", cmc: 4, power: "1", toughness: "2", oracle_text: "When Archaeomancer enters the battlefield, return target instant or sorcery card from your graveyard to your hand.", oracle_id: "a91a3266-cadd-47a0-9b20-160307f14c07", scryfall_id: "dd94eb97-d231-4880-9c6f-e25da02782b4" });
const IZZET_CHRONARCH = () => make({ name: "Izzet Chronarch", type_line: "Creature — Human Wizard", mana_cost: "{3}{U}{R}", cmc: 5, power: "2", toughness: "2", oracle_text: "When Izzet Chronarch enters the battlefield, return target instant or sorcery card from your graveyard to your hand.", oracle_id: "1da438f3-db1c-4713-a60c-e078f31d809c", scryfall_id: "d2f8fe93-8d20-41d4-8205-597a9c9b8bbe" });
const CHARNELHOARD_WURM = () => make({ name: "Charnelhoard Wurm", type_line: "Creature — Wurm", mana_cost: "{4}{B}{R}{G}", cmc: 7, power: "6", toughness: "6", keywords: ["Trample"], oracle_text: "Trample\nWhenever this creature deals damage to an opponent, you may return target card from your graveyard to your hand.", scryfall_id: "4a430fa3-e693-424b-9981-d7d8193445e3" });
const DAMAGE_TRIGGERER = () => make({ name: "Damage Triggerer", type_line: "Creature — Wurm", mana_cost: "{3}{R}", cmc: 4, power: "3", toughness: "3", oracle_text: "Whenever this creature deals damage to an opponent, you may return target card from your graveyard to your hand.\n{T}: ~ deals 1 damage to any target." });
const CONJURERS_CLOSET = () => make({ name: "Conjurer's Closet", type_line: "Artifact", mana_cost: "{5}", cmc: 5, oracle_text: "At the beginning of your end step, you may exile target creature you control, then return that card to the battlefield under your control.", scryfall_id: "cd1eda60-53e4-44d0-9b2c-7a57395e291f" });
const TIDAL_FORCE = () => make({ name: "Tidal Force", type_line: "Creature — Elemental", mana_cost: "{5}{U}{U}", cmc: 7, power: "8", toughness: "8", oracle_text: "At the beginning of each upkeep, you may tap or untap target permanent.", scryfall_id: "1b25e262-e2df-4768-b55e-1b7b8d3ee993" });
const CURSE_OF_INERTIA = () => make({ name: "Curse of Inertia", type_line: "Enchantment — Aura Curse", mana_cost: "{2}{U}", cmc: 3, oracle_text: "Enchant player\nWhenever a player attacks enchanted player with one or more creatures, that attacking player may tap or untap target permanent of their choice.", oracle_id: "0bbeb0ee-647b-43d3-91b3-6869d5ccb8b8", scryfall_id: "32d0c2a7-4277-43eb-bb09-5ca0c27edee4" });
const DRAW_AND_LOSE = () => make({ name: "Dark Exchange", type_line: "Sorcery", mana_cost: "{2}{B}", cmc: 3, oracle_text: "Draw a card and lose 1 life." });
const HAND_DAMAGE = () => make({ name: "Viseling Memory", type_line: "Instant", mana_cost: "{2}{B}", cmc: 3, oracle_text: "This spell deals damage to you equal to the number of cards in your hand." });
const DRAW_MINE = () => make({ name: "Draw Mine", type_line: "Artifact", mana_cost: "{2}", cmc: 2, oracle_text: "At the beginning of each player's draw step, that player draws an additional card." });
const TEFERIS_PUZZLE_BOX = () => make({ name: "Teferi's Puzzle Box", type_line: "Artifact", mana_cost: "{4}", cmc: 4, oracle_text: "At the beginning of each player's draw step, that player puts the cards in their hand on the bottom of their library in any order, then draws that many cards.", oracle_id: "37abcc92-9466-47ea-9e0b-5eda2eb62c8e", scryfall_id: "b5fb88b2-5dc6-43de-8a38-1f8982ed395a" });
const HOWLING_MINE = () => make({ name: "Howling Mine", type_line: "Artifact", mana_cost: "{2}", cmc: 2, oracle_text: "At the beginning of each player's draw step, if this artifact is untapped, that player draws an additional card.", oracle_id: "d26b27db-a567-4631-b4b6-7294222fbdd1", scryfall_id: "3d911839-cb2c-4068-aba3-3441fc0c79ac" });
const FEVERED_VISIONS = () => make({ name: "Fevered Visions", type_line: "Enchantment", mana_cost: "{2}{R}", cmc: 3, oracle_text: "At the beginning of each player's end step, that player draws a card. If the player is your opponent and has four or more cards in hand, this enchantment deals 2 damage to that player.", oracle_id: "70763549-4b4e-4cb8-8c02-0639ba18bb1a", scryfall_id: "8badb2d3-530b-40ca-bcca-4137487f9f01" });
const HAND_MINUS_DAMAGE = () => make({ name: "Hand Minus Damage", type_line: "Creature — Artifact", mana_cost: "{5}", cmc: 5, power: "2", toughness: "2", oracle_text: "At the beginning of each opponent's upkeep, this creature deals X damage to that player, where X is the number of cards in their hand minus 4." });
const WASTE_NOT = () => make({ name: "Waste Not", type_line: "Enchantment", mana_cost: "{1}{B}", cmc: 2, oracle_text: "Whenever an opponent discards a creature card, create a 2/2 black Zombie creature token.\nWhenever an opponent discards a land card, add {B}{B}.\nWhenever an opponent discards a noncreature, nonland card, draw a card.", oracle_id: "00fdcc19-88ed-46c3-91f0-095806228105", scryfall_id: "5737b4ac-1a0c-475c-bc0c-489bce302ff0" });
const GEIER_REACH_SANITARIUM = () => make({ name: "Geier Reach Sanitarium", type_line: "Legendary Land", oracle_text: "{T}: Add {C}.\n{2}, {T}: Each player draws a card, then discards a card.", oracle_id: "7b9fafe7-d26a-4ed5-b4c4-ce13763770b5", scryfall_id: "6a046c90-5161-43d9-a4d9-01d93c12c097" });
const HAND_EQUAL_DAMAGE = () => make({ name: "Hand Equal Damage", type_line: "Creature — Horror", mana_cost: "{4}{B}", cmc: 5, power: "3", toughness: "3", oracle_text: "At the beginning of each opponent's upkeep, this creature deals damage to that player equal to the number of cards in that player's hand." });
const EACH_HAND_DAMAGE = () => make({ name: "Shared Hand Damage", type_line: "Sorcery", mana_cost: "{3}{B}", cmc: 4, oracle_text: "Each player loses life equal to the number of cards in their hand." });
const TAPPED_DRAW = () => make({ name: "Tapped Draw", type_line: "Sorcery", mana_cost: "{3}{U}", cmc: 4, oracle_text: "Draw a card for each tapped creature target opponent controls." });
const CREATURE_DRAW = () => make({ name: "Creature Insight", type_line: "Sorcery", mana_cost: "{3}{U}", cmc: 4, oracle_text: "Draw a card for each creature you control." });
const GLOBAL_FEAR = () => make({ name: "Global Fear", type_line: "Sorcery", mana_cost: "{2}{B}", cmc: 3, oracle_text: "All creatures gain menace until end of turn." });
const GLOBAL_REAL_FEAR = () => make({ name: "Global Real Fear", type_line: "Sorcery", mana_cost: "{2}{B}", cmc: 3, oracle_text: "All creatures gain fear until end of turn." });
const LIFE_LOCK = () => make({ name: "Life Lock", type_line: "Enchantment", mana_cost: "{3}{B}", cmc: 4, oracle_text: "Players can't gain life." });
const NO_MAX_HAND = () => make({ name: "No Hand Limit", type_line: "Enchantment", mana_cost: "{3}", cmc: 3, oracle_text: "You have no maximum hand size." });
const PUMP_LORD = () => make({ name: "Pump Lord", type_line: "Creature — Elf", mana_cost: "{2}{G}", cmc: 3, power: "2", toughness: "2", oracle_text: "Other creatures you control get +1/+1." });
const C13_DIVINITY_OF_PRIDE = () => make({ name: "Divinity of Pride", type_line: "Creature — Spirit Avatar", mana_cost: "{3}{W}{B}", cmc: 5, power: "4", toughness: "4", oracle_text: "This creature gets +4/+4 as long as you have 25 or more life.", scryfall_id: "2c91c236-34d7-4454-a55a-784db7f68bde" });
const C13_WIGHT = () => make({ name: "Wight of Precinct Six", type_line: "Creature — Zombie", mana_cost: "1B", cmc: 2, power: "1", toughness: "1", oracle_text: "This creature gets +1/+1 for each creature card in your opponents' graveyards.", scryfall_id: "6397c046-4c59-4f0b-9b44-2a804eb95edf" });
const C13_HOODED_HORROR = () => make({ name: "Hooded Horror", type_line: "Creature — Horror", mana_cost: "{4}{B}", cmc: 5, power: "4", toughness: "4", oracle_text: "This creature can't be blocked as long as defending player controls the most creatures or is tied for the most.", scryfall_id: "8267561e-bc25-4aaa-8242-f6d7ec88143e", oracle_id: "8267561e-bc25-4aaa-8242-f6d7ec88143e" });
const C13_PROSSH = () => make({ name: "Prossh, Skyraider of Kher", type_line: "Legendary Creature — Dragon", mana_cost: "{3}{B}{R}{G}", cmc: 6, power: "5", toughness: "5", oracle_text: "Flying\nWhen you cast this spell, create X 0/1 red Kobold creature tokens named Kobolds of Kher Keep, where X is the amount of mana spent to cast it.", scryfall_id: "868882d2-ed4e-4171-a17c-478a341080fb", oracle_id: "868882d2-ed4e-4171-a17c-478a341080fb" });
const POWER_LOSS_REMOVAL = () => make({ name: "Power Loss Removal", type_line: "Sorcery", mana_cost: "{2}{B}", cmc: 3, oracle_text: "Destroy target creature. Its controller loses life equal to its power plus its toughness." });
const EXILE_LIFEGAIN_REMOVAL = () => make({ name: "Peaceforge Edict", type_line: "Instant", mana_cost: "{W}", cmc: 1, oracle_text: "Exile target creature. Its controller gains life equal to its power." });
const CONDEMN_LIKE = () => make({ name: "Battlefield Condemnation", type_line: "Instant", mana_cost: "{W}", cmc: 1, oracle_text: "Put target attacking creature on the bottom of its owner's library. Its controller gains life equal to its toughness." });
// "That player" refers back to the card-drawn event's own player (the
// opponent who drew), resolved from `object.trigger?.eventController` —
// not a chosen target and not always `object.controller`'s opponent list.
const DAMAGE_ON_OPPONENT_DRAW = () => make({ name: "Test Nekusar", type_line: "Creature — Wizard", mana_cost: "{2}{U}{B}{R}", cmc: 5, power: "2", toughness: "4", oracle_text: "Whenever an opponent draws a card, ~ deals 1 damage to that player." });
const FAERIE_MASTERMIND = () => make({ name: "Test Faerie Mastermind", type_line: "Creature — Faerie Wizard", mana_cost: "{1}{U}", cmc: 2, power: "2", toughness: "1", oracle_text: "Flash\nWhenever an opponent draws their second card each turn, you draw a card." });
const KRANG_DOUBLER = () => make({ name: "Test Krang", type_line: "Legendary Artifact Creature — Robot", mana_cost: "{5}", cmc: 5, power: "5", toughness: "5", oracle_text: "If a player drawing a card causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time." });
const DRAW_WATCHER = () => make({ name: "Test Draw Watcher", type_line: "Artifact", mana_cost: "{1}", cmc: 1, oracle_text: "Whenever an opponent draws a card, you draw a card." });
const LIFELOSS_ON_OPPONENT_DRAW = () => make({ name: "Test Scrawling Crawler", type_line: "Creature — Horror", mana_cost: "{4}{B}", cmc: 5, power: "3", toughness: "3", oracle_text: "Whenever an opponent draws a card, that player loses 1 life." });
const LIFELOSS_ON_OPPONENT_DISCARD = () => make({ name: "Test Liliana's Caress", type_line: "Enchantment", mana_cost: "{3}{B}", cmc: 4, oracle_text: "Whenever an opponent discards a card, that player loses 2 life." });
const GAIN_ON_YOUR_DRAW_DRAIN_ON_OPPONENT_DRAW = () => make({ name: "Test Sheoldred", type_line: "Creature — Phyrexian Praetor", mana_cost: "{3}{B}{B}", cmc: 5, power: "4", toughness: "5", oracle_text: "Deathtouch\nWhenever you draw a card, you gain 2 life.\nWhenever an opponent draws a card, they lose 2 life." });
const DRAW_TWO_TARGET = () => make({ name: "Test Divination", type_line: "Sorcery", mana_cost: "{2}{U}", cmc: 3, oracle_text: "Target player draws two cards." });
const X_MINUS_SWEEP = () => make({ name: "X Minus Sweep", type_line: "Sorcery", mana_cost: "{X}{B}", cmc: 1, oracle_text: "All creatures get -X/-X until end of turn." });
const POWER_DRAW_TRIGGER = () => make({ name: "Power Draw Trigger", type_line: "Creature — Human Druid", mana_cost: "{3}{G}", cmc: 4, power: "2", toughness: "2", oracle_text: "At the beginning of your end step, if you control a creature with power 5 or greater, you may draw a card." });
const NONFLYING_SWEEP = () => make({ name: "Nonflying Sweep", type_line: "Sorcery", mana_cost: "{X}{R}", cmc: 1, oracle_text: "This spell deals X damage to each creature without flying and each player." });
const FLYING_SWEEP = () => make({ name: "Flying Sweep", type_line: "Sorcery", mana_cost: "{X}{R}", cmc: 1, oracle_text: "This spell deals X damage to each creature with flying." });
const UPKEEP_DRAW_LOSS = () => make({ name: "Upkeep Draw Loss", type_line: "Creature — Demon", mana_cost: "{5}{B}", cmc: 6, power: "2", toughness: "2", oracle_text: "At the beginning of each upkeep, you draw a card and you lose 1 life." });
const PLAGUE_ENGINE = () => make({ name: "Plague Engine", type_line: "Creature — Horror", mana_cost: "{3}{B}", cmc: 4, power: "2", toughness: "2", oracle_text: "At the beginning of your upkeep, put a plague counter on Plague Engine." });
const Ophiomancer_MEMORY = () => make({ name: "Ophiomancer Memory", type_line: "Creature — Human Shaman", mana_cost: "{2}{B}", cmc: 3, power: "2", toughness: "2", oracle_text: "At the beginning of each upkeep, if you control no Snakes, create a 1/1 black Snake creature token with deathtouch." });
const SELF_LOSS_SPELL = () => make({ name: "Private Burden", type_line: "Sorcery", mana_cost: "{B}", cmc: 1, oracle_text: "You lose 2 life." });
const LOSS_COUNTER = () => make({ name: "Pain Counter", type_line: "Creature — Human Cleric", mana_cost: "{1}{B}", cmc: 2, power: "1", toughness: "1", oracle_text: "Whenever you lose life, put a +1/+1 counter on Pain Counter." });
const TARGET_LIFE_SPELL = () => make({ name: "Shared Blessing", type_line: "Instant", mana_cost: "{G}", cmc: 1, oracle_text: "Target player gains 2 life." });
const EACH_LIFE_SPELL = () => make({ name: "Common Blessing", type_line: "Sorcery", mana_cost: "{G}", cmc: 1, oracle_text: "Each player gains 1 life." });
const TARGET_LOSS_SPELL = () => make({ name: "Shared Burden", type_line: "Sorcery", mana_cost: "{B}", cmc: 1, oracle_text: "Target player loses 3 life." });
const SIGN_IN_BLOOD = () => make({ name: "Bled Wisdom", type_line: "Sorcery", mana_cost: "{B}", cmc: 1, oracle_text: "Target player draws two cards and loses 2 life." });
const CREATURE_COUNT_LOSS = () => make({ name: "Creature Toll", type_line: "Sorcery", mana_cost: "{2}{B}", cmc: 3, oracle_text: "Target player loses life equal to the number of creatures you control." });
const EACH_LOSS_SPELL = () => make({ name: "Common Burden", type_line: "Sorcery", mana_cost: "{B}", cmc: 1, oracle_text: "Each player loses 1 life." });
const X_OPPONENT_LOSS = () => make({ name: "Scalable Burden", type_line: "Sorcery", mana_cost: "{X}{B}", cmc: 1, oracle_text: "Each opponent loses X life." });
const X_DRAW = () => make({ name: "Scalable Insight", type_line: "Sorcery", mana_cost: "{X}{U}", cmc: 1, oracle_text: "Draw X cards." });
const GRAVEYARD_RETURN = () => make({ name: "Unearth Memory", type_line: "Sorcery", mana_cost: "{B}", cmc: 1, oracle_text: "Return target creature card from your graveyard to your hand." });
const GRAVEYARD_BATTLEFIELD = () => make({ name: "Reanimate Memory", type_line: "Sorcery", mana_cost: "{B}", cmc: 1, oracle_text: "Return target creature card from your graveyard to the battlefield." });
const REANIMATE_SPELL = () => make({ name: "Test Reanimate", type_line: "Instant", mana_cost: "{B}", cmc: 1, oracle_text: "Put target creature card from a graveyard onto the battlefield under your control. You lose life equal to that card's mana value." });
const PHYREXIAN_DELVER = () => make({ name: "Phyrexian Delver", type_line: "Creature — Phyrexian Human", mana_cost: "{3}{B}{B}", cmc: 5, power: "3", toughness: "2", oracle_text: "When Phyrexian Delver enters the battlefield, return target creature card from your graveyard to the battlefield. You lose life equal to that card's mana value.", oracle_id: "a13cbac0-4c76-4970-b61e-5f4e020ee95c" });
const PLAIN_GRAVEYARD_REANIMATE = () => make({ name: "Test Hymn of Rebirth", type_line: "Sorcery", mana_cost: "{4}{B}{B}", cmc: 6, oracle_text: "Put target creature card from a graveyard onto the battlefield under your control." });
const ARTIFACT_GRAVEYARD_RETURN = () => make({ name: "Artifact Reclaim", type_line: "Sorcery", mana_cost: "{1}{B}", cmc: 2, oracle_text: "Return target artifact card from your graveyard to your hand." });
const LAND_GRAVEYARD_BATTLEFIELD = () => make({ name: "Restore Memory", type_line: "Sorcery", mana_cost: "{2}{G}", cmc: 3, oracle_text: "Put target land card from a graveyard onto the battlefield under your control." });
const ARTIFACT_GRAVEYARD_BATTLEFIELD = () => make({ name: "Sharuum Memory", type_line: "Sorcery", mana_cost: "{2}{U}{B}", cmc: 4, oracle_text: "Return target artifact card from your graveyard to the battlefield." });
const C13_SHARUUM = () => make({
  name: "Sharuum the Hegemon", type_line: "Legendary Artifact Creature — Sphinx", mana_cost: "{3}{W}{U}{B}", cmc: 6, power: "5", toughness: "5",
  keywords: ["Flying"],
  oracle_text: "Flying\nWhen Sharuum the Hegemon enters the battlefield, you may return target artifact card from your graveyard to the battlefield.",
  scryfall_id: "037e7fc9-3aa6-484c-a2c8-43009e45f1d8", oracle_id: "037e7fc9-3aa6-484c-a2c8-43009e45f1d8"
});
const ENCHANTMENT_GRAVEYARD_RETURN = () => make({ name: "Enchantment Reclaim", type_line: "Sorcery", mana_cost: "{1}{G}", cmc: 2, oracle_text: "Return target enchantment card from your graveyard to your hand." });
const ENCHANTMENT_GRAVEYARD_BATTLEFIELD = () => make({ name: "Enchantment Reanimate", type_line: "Sorcery", mana_cost: "{2}{G}", cmc: 3, oracle_text: "Return target enchantment card from your graveyard to the battlefield." });
const ARTIFACT_BOUNCE = () => make({ name: "Artifact Recall", type_line: "Instant", mana_cost: "{1}{U}", cmc: 2, oracle_text: "Return target artifact to its owner's hand." });
const ENCHANTMENT_BOUNCE = () => make({ name: "Enchantment Recall", type_line: "Instant", mana_cost: "{1}{U}", cmc: 2, oracle_text: "Return target enchantment to its owner's hand." });
const DOUBLE_STRIKE_SPELL = () => make({ name: "Twin Edge", type_line: "Instant", mana_cost: "{R}{W}", cmc: 2, oracle_text: "Target creature gains double strike until end of turn." });
const TRAMPLE_BOOST = () => make({ name: "Selesnya Memory", type_line: "Instant", mana_cost: "{G}{W}", cmc: 2, oracle_text: "Target creature gets +2/+2 and gains trample until end of turn." });
const INFERNO_PUMP = () => make({ name: "Inferno Memory", type_line: "Creature — Giant", mana_cost: "{4}{R}{R}", cmc: 6, power: "6", toughness: "6", oracle_text: "{R}: This creature gets +1/+0 until end of turn." });
const MARROW_BATS = () => make({ name: "Marrow Bats", type_line: "Creature — Bat", mana_cost: "{3}{B}", cmc: 4, power: "2", toughness: "2", oracle_text: "{B}, Pay 4 life: Regenerate Marrow Bats." });
const COUNTER_DAMAGE = () => make({ name: "Deathbringer Thoctar", type_line: "Creature — Beast", mana_cost: "{2}{R}{R}", cmc: 4, power: "5", toughness: "5", oracle_text: "Remove a +1/+1 counter from ~: It deals 1 damage to any target." });
const CARNAGE_ALTAR = () => make({ name: "Carnage Memory", type_line: "Artifact", mana_cost: "{4}", cmc: 4, oracle_text: "{3}, Sacrifice a creature: Draw a card." });
const TOOTH_AND_CLAW = () => make({ name: "Tooth and Claw", type_line: "Artifact", mana_cost: "{4}", cmc: 4, oracle_text: "Sacrifice two creatures: Create a 3/1 red Beast creature token named Carnivore." });
const SURVIVAL_CACHE = () => make({ name: "Survival Cache", type_line: "Sorcery", mana_cost: "{2}{W}", cmc: 3, oracle_text: "You gain 2 life. Then if you have more life than an opponent, draw a card." });
const RAVENOUS_BALOTH = () => make({ name: "Ravenous Baloth", type_line: "Creature — Beast", mana_cost: "{2}{G}{G}", cmc: 4, power: "4", toughness: "4", oracle_text: "Sacrifice a Beast: You gain 4 life." });
const ARTIFACT_SAC_ALTAR = () => make({ name: "Artifact Memory", type_line: "Artifact", mana_cost: "{2}", cmc: 2, oracle_text: "Sacrifice an artifact: Draw a card." });
const ENCHANTMENT_SAC_ALTAR = () => make({ name: "Enchantment Memory", type_line: "Enchantment", mana_cost: "{2}", cmc: 2, oracle_text: "Sacrifice an enchantment: Draw a card." });
const LAND_SAC_ALTAR = () => make({ name: "Land Memory", type_line: "Land", oracle_text: "Sacrifice a land: Draw a card." });
const ANOTHER_ARTIFACT_SAC = () => make({ name: "Another Artifact Memory", type_line: "Artifact", mana_cost: "{2}", cmc: 2, oracle_text: "Sacrifice another artifact: Draw a card." });
const NONCREATURE_SAC = () => make({ name: "Noncreature Memory", type_line: "Creature — Shaman", mana_cost: "{2}", cmc: 2, power: "2", toughness: "2", oracle_text: "Sacrifice a noncreature permanent: Draw a card." });
const DISCARD_ACTIVATION = () => make({ name: "Discard Memory", type_line: "Creature — Wizard", mana_cost: "{2}{U}", cmc: 3, power: "2", toughness: "2", oracle_text: "{T}, Discard a card: Draw a card." });
const TOKEN_SAC_ACTIVATION = () => make({ name: "Token Memory", type_line: "Creature — Shaman", mana_cost: "{2}{G}", cmc: 3, power: "2", toughness: "2", oracle_text: "Sacrifice a token: Draw a card." });
const GRAVEYARD_EXILE_ACTIVATION = () => make({ name: "Grave Memory", type_line: "Creature — Wizard", mana_cost: "{2}{B}", cmc: 3, power: "2", toughness: "2", oracle_text: "Exile a card from your graveyard: Draw a card." });
const COMBINED_COST_ACTIVATION = () => make({ name: "Combined Memory", type_line: "Artifact", mana_cost: "{2}", cmc: 2, oracle_text: "Sacrifice an artifact, Discard a card: Draw a card." });
const PERMANENT_SAC_ACTIVATION = () => make({ name: "Permanent Sacrifice Memory", type_line: "Creature — Shaman", mana_cost: "{2}{G}", cmc: 3, power: "2", toughness: "2", oracle_text: "Sacrifice another permanent: Draw a card." });
const GENERIC_REANIMATE = () => make({ name: "Permanent Reclaim", type_line: "Sorcery", mana_cost: "{2}{B}", cmc: 3, oracle_text: "Return target permanent card from your graveyard to the battlefield." });
const CROSS_GENERIC_REANIMATE = () => make({ name: "Cross Permanent Reclaim", type_line: "Sorcery", mana_cost: "{2}{B}", cmc: 3, oracle_text: "Return target permanent card from a graveyard to the battlefield." });
const PERMANENT_GRAVEYARD_EXILE = () => make({ name: "Permanent Exile", type_line: "Instant", mana_cost: "{B}", cmc: 1, oracle_text: "Exile target permanent card from your graveyard." });
const CROSS_PERMANENT_GRAVEYARD_EXILE = () => make({ name: "Cross Permanent Exile", type_line: "Instant", mana_cost: "{1}{B}", cmc: 2, oracle_text: "Exile target permanent card from a graveyard." });
const LOYAL_RETAINERS = () => make({ name: "Loyal Retainers", type_line: "Creature — Human Advisor", mana_cost: "{2}{W}", cmc: 3, power: "1", toughness: "1", oracle_text: "Sacrifice this creature: Return target legendary creature card from your graveyard to the battlefield. Activate only during your turn, before attackers are declared." });
const MIRARIS_WAKE = () => make({ name: "Mirari's Wake", type_line: "Enchantment", mana_cost: "{3}{G}{W}", cmc: 5, oracle_text: "Creatures you control get +1/+1.\nWhenever you tap a land for mana, add one mana of any type that land produced." });
const BOTTOM_RETURN = () => make({ name: "Bottom Reclaim", type_line: "Sorcery", mana_cost: "{G}", cmc: 1, oracle_text: "Put target card from your graveyard on the bottom of your library." });
const SHUFFLE_RETURN = () => make({ name: "Shuffle Reclaim", type_line: "Sorcery", mana_cost: "{G}", cmc: 1, oracle_text: "Shuffle target card from your graveyard into your library." });
const UNBLOCKABLE = () => make({ name: "Herald Memory", type_line: "Creature — Spirit", mana_cost: "{1}{U}", cmc: 2, power: "2", toughness: "2", oracle_text: "This creature can't be blocked." });
const GRAVEYARD_EXILE = () => make({ name: "Grave Purge", type_line: "Instant", mana_cost: "{B}", cmc: 1, oracle_text: "Exile target card from your graveyard." });
const ANY_GRAVEYARD_EXILE = () => make({ name: "Cross Grave Purge", type_line: "Instant", mana_cost: "{B}", cmc: 1, oracle_text: "Exile target card from a graveyard." });
const ANY_GRAVEYARD_RETURN = () => make({ name: "Cross Grave Reclaim", type_line: "Sorcery", mana_cost: "{2}{G}", cmc: 3, oracle_text: "Return target card from a graveyard to its owner's hand." });
const ANY_CREATURE_EXILE = () => make({ name: "Cross Creature Purge", type_line: "Instant", mana_cost: "{1}{B}", cmc: 2, oracle_text: "Exile target creature card from a graveyard." });
const ANY_ARTIFACT_EXILE = () => make({ name: "Cross Artifact Purge", type_line: "Instant", mana_cost: "{1}{B}", cmc: 2, oracle_text: "Exile target artifact card from a graveyard." });
const ANY_ENCHANTMENT_EXILE = () => make({ name: "Cross Enchantment Purge", type_line: "Instant", mana_cost: "{1}{B}", cmc: 2, oracle_text: "Exile target enchantment card from a graveyard." });
const ANY_LAND_EXILE = () => make({ name: "Cross Land Purge", type_line: "Instant", mana_cost: "{1}{B}", cmc: 2, oracle_text: "Exile target land card from a graveyard." });
const GRAVEYARD_TOP = () => make({ name: "Library Reclaim", type_line: "Sorcery", mana_cost: "{G}", cmc: 1, oracle_text: "Put target card from your graveyard on top of your library." });
const LIFE_COUNTER = () => make({ name: "Life Counter", type_line: "Creature — Human Cleric", mana_cost: "{1}{W}", cmc: 2, power: "1", toughness: "1", oracle_text: "Whenever you gain life, put a +1/+1 counter on Life Counter." });
const SANGUINE_BOND = () => make({ name: "Sanguine Bond", type_line: "Enchantment", mana_cost: "{3}{B}{B}", cmc: 5, oracle_text: "Whenever you gain life, target opponent loses that much life.", scryfall_id: "73089a39-a2f6-4aa2-a058-e6551475153d" });
const AERIE_MYSTICS = () => make({ name: "Aerie Mystics", type_line: "Creature — Bird Wizard", mana_cost: "{3}{G}{U}", cmc: 5, power: "3", toughness: "3", keywords: ["Flying"], oracle_text: "Flying\n{1}{G}{U}: Creatures you control gain shroud until end of turn.", scryfall_id: "12134f7d-433a-416a-b668-c1a21984c94b" });
const RAKECLAW_GARGANTUAN = () => make({ name: "Rakeclaw Gargantuan", type_line: "Creature — Beast", mana_cost: "{2}{R}{G}{W}", cmc: 5, power: "5", toughness: "3", oracle_text: "{1}: Target creature with power 5 or greater gains first strike until end of turn.", scryfall_id: "8dbb4a8f-78e9-4ceb-824d-bb67bdf939db" });
const HOMEWARD_PATH = () => make({ name: "Homeward Path", type_line: "Land", oracle_text: "{T}: Add {C}.\n{T}: Each player gains control of all creatures they own.", scryfall_id: "cb8ec2e4-8223-4172-8f2c-37c918a573fa" });
const AZORIUS_KEYRUNE = () => make({ name: "Azorius Keyrune", type_line: "Artifact", mana_cost: "{3}", cmc: 3, oracle_text: "{T}: Add {W} or {U}.\n{W}{U}: This artifact becomes a 2/2 white and blue Bird artifact creature with flying until end of turn.", scryfall_id: "7266b491-54e6-4393-a448-d5ae99d965c6" });
const VOLTAIC_KEY = () => make({ name: "Voltaic Key", type_line: "Artifact", mana_cost: "{1}", cmc: 1, oracle_text: "{1}, {T}: Untap target artifact.", oracle_id: "09aeea91-b1dc-443f-a509-4758f052c0a7", scryfall_id: "09aeea91-b1dc-443f-a509-4758f052c0a7" });
const ANNIHILATE = () => make({ name: "Annihilate", type_line: "Instant", mana_cost: "{2}{B}", cmc: 3, oracle_text: "Destroy target nonblack creature. Draw a card." });
const FAMINE = () => make({ name: "Famine", type_line: "Sorcery", mana_cost: "{3}{B}{B}", cmc: 5, oracle_text: "Famine deals 3 damage to each creature and each player." });
const ALL_PLAYER_DAMAGE = () => make({ name: "Shared Scorch", type_line: "Sorcery", mana_cost: "{2}{R}", cmc: 3, oracle_text: "This spell deals 2 damage to each player." });
const DEATH_GRASP = () => make({ name: "Death Grasp", type_line: "Sorcery", mana_cost: "{X}{W}{B}", cmc: 2, oracle_text: "Death Grasp deals X damage to any target. You gain X life." });
const LIGHTNING_HELIX = () => make({ name: "Lightning Helix", type_line: "Instant", mana_cost: "{R}{W}", cmc: 2, oracle_text: "Lightning Helix deals 3 damage to any target and you gain 3 life.", oracle_id: "800c258a-cfc4-4a54-a667-065ea8dea69e", scryfall_id: "800c258a-cfc4-4a54-a667-065ea8dea69e" });
const INCINERATE = () => make({ name: "Incinerate", type_line: "Instant", mana_cost: "{1}{R}", cmc: 2, oracle_text: "Incinerate deals 3 damage to any target. A creature dealt damage this way can't be regenerated this turn.", oracle_id: "d8fd7a34-8418-4e98-b79b-119c4348c667", scryfall_id: "d8fd7a34-8418-4e98-b79b-119c4348c667" });
const LAVA_COIL = () => make({ name: "Lava Coil", type_line: "Sorcery", mana_cost: "{1}{R}", cmc: 2, oracle_text: "Lava Coil deals 4 damage to target creature. If that creature would die this turn, exile it instead.", oracle_id: "fa71db44-5181-4c51-8b24-7fbedf36e3ca", scryfall_id: "e165d16a-06c7-4373-9c36-89e127e669dd" });
const BURST_LIGHTNING = () => make({ name: "Burst Lightning", type_line: "Instant", mana_cost: "{R}", cmc: 1, oracle_text: "Kicker {4} (You may pay an additional {4} as you cast this spell.)\nBurst Lightning deals 2 damage to any target. If this spell was kicked, it deals 4 damage instead.", oracle_id: "ac2086fe-98ee-4280-9c7c-c5c2d6548a8b", scryfall_id: "0f350255-930a-41da-a58b-55beb66da7bd" });
const FLING = () => make({ name: "Fling", type_line: "Instant", mana_cost: "{1}{R}", cmc: 2, oracle_text: "As an additional cost to cast this spell, sacrifice a creature.\nFling deals damage equal to the sacrificed creature's power to any target.", oracle_id: "24227761-b50e-4b9e-93a2-e82d053b3e3d", scryfall_id: "050eb421-a446-4d84-b331-a267b02dc9f5" });
const TREASURE_HUNT = () => make({ name: "Treasure Hunt", type_line: "Sorcery", mana_cost: "{1}{U}", cmc: 2, oracle_text: "Reveal cards from the top of your library until you reveal a nonland card, then put all cards revealed this way into your hand.", oracle_id: "05079479-86a6-4041-a395-83d325b6ddb7", scryfall_id: "53af54e3-412f-4bc4-8a3a-911eaa62be27" });
const PSIONIC_BLAST = () => make({ name: "Psionic Blast", type_line: "Instant", mana_cost: "{2}{U}", cmc: 3, oracle_text: "Psionic Blast deals 4 damage to any target and 2 damage to you.", oracle_id: "7f221ad6-7ec4-483d-a6b5-1456c95c1cad", scryfall_id: "7f221ad6-7ec4-483d-a6b5-1456c95c1cad" });
const CHANDRAS_OUTRAGE = () => make({ name: "Chandra's Outrage", type_line: "Instant", mana_cost: "{2}{R}{R}", cmc: 4, oracle_text: "Chandra's Outrage deals 4 damage to target creature and 2 damage to that creature's controller." });
const FLYING_REMOVAL = () => make({ name: "Sky Hunter's Bane", type_line: "Instant", mana_cost: "{2}{G}", cmc: 3, oracle_text: "Destroy target creature with flying." });
const WONDER = () => make({ name: "Wonder", type_line: "Creature — Incarnation", mana_cost: "{3}{U}", cmc: 4, power: "2", toughness: "2", oracle_text: "Flying\nAs long as this card is in your graveyard and you control an Island, creatures you control have flying.", scryfall_id: "232284f7-c623-4895-9ab9-8b1a39926830" });
const BIG_CREATURE_REMOVAL = () => make({ name: "Big Game Bane", type_line: "Instant", mana_cost: "{2}{G}", cmc: 3, oracle_text: "Destroy target creature with power 5 or greater." });
const TOUGH_CREATURE_REMOVAL = () => make({ name: "Tough Game Bane", type_line: "Instant", mana_cost: "{2}{G}", cmc: 3, oracle_text: "Destroy target creature with toughness 4 or greater." });
const SMALL_CREATURE_REMOVAL = () => make({ name: "Small Game Bane", type_line: "Instant", mana_cost: "{2}{G}", cmc: 3, oracle_text: "Destroy target creature with power 4 or less." });
const TOUGHNESS_REMOVAL = () => make({ name: "Fragile Game Bane", type_line: "Instant", mana_cost: "{2}{G}", cmc: 3, oracle_text: "Destroy target creature with toughness 4 or less." });
const DEFENDER_REMOVAL = () => make({ name: "Wall Bane", type_line: "Instant", mana_cost: "{2}{G}", cmc: 3, oracle_text: "Destroy target creature with defender." });
const DEATHTOUCH_REMOVAL = () => make({ name: "Viper Bane", type_line: "Instant", mana_cost: "{2}{G}", cmc: 3, oracle_text: "Destroy target creature with deathtouch." });
const LIFELINK_REMOVAL = () => make({ name: "Knight Bane", type_line: "Instant", mana_cost: "{2}{G}", cmc: 3, oracle_text: "Destroy target creature with lifelink." });
const MENACE_REMOVAL = () => make({ name: "Menace Bane", type_line: "Instant", mana_cost: "{2}{G}", cmc: 3, oracle_text: "Destroy target creature with menace." });
const HASTE_REMOVAL = () => make({ name: "Haste Bane", type_line: "Instant", mana_cost: "{2}{G}", cmc: 3, oracle_text: "Destroy target creature with haste." });
const FIRST_STRIKE_REMOVAL = () => make({ name: "First Strike Bane", type_line: "Instant", mana_cost: "{2}{G}", cmc: 3, oracle_text: "Destroy target creature with first strike." });
const DOUBLE_STRIKE_REMOVAL = () => make({ name: "Double Strike Bane", type_line: "Instant", mana_cost: "{2}{G}", cmc: 3, oracle_text: "Destroy target creature with double strike." });
const TRAMPLE_REMOVAL = () => make({ name: "Trample Bane", type_line: "Instant", mana_cost: "{2}{G}", cmc: 3, oracle_text: "Destroy target creature with trample." });
const VIGILANCE_REMOVAL = () => make({ name: "Vigilance Bane", type_line: "Instant", mana_cost: "{2}{G}", cmc: 3, oracle_text: "Destroy target creature with vigilance." });
const INDESTRUCTIBLE_REMOVAL = () => make({ name: "Indestructible Bane", type_line: "Instant", mana_cost: "{2}{G}", cmc: 3, oracle_text: "Destroy target creature with indestructible." });
const HEXPROOF_REMOVAL = () => make({ name: "Hexproof Bane", type_line: "Instant", mana_cost: "{2}{G}", cmc: 3, oracle_text: "Destroy target creature with hexproof." });
const SHROUD_REMOVAL = () => make({ name: "Shroud Bane", type_line: "Instant", mana_cost: "{2}{G}", cmc: 3, oracle_text: "Destroy target creature with shroud." });
const REACH_REMOVAL = () => make({ name: "Reach Bane", type_line: "Instant", mana_cost: "{2}{G}", cmc: 3, oracle_text: "Destroy target creature with reach." });
const NONBASIC_REMOVAL = () => make({ name: "Land Bane", type_line: "Sorcery", mana_cost: "{2}{R}", cmc: 3, oracle_text: "Destroy target nonbasic land." });
const BEDEVIL = () => make({ name: "Bedevil", type_line: "Instant", mana_cost: "{1}{B}{B}", cmc: 3, oracle_text: "Destroy target artifact, creature, or planeswalker." });
const MORTIFY = () => make({ name: "Mortify", type_line: "Instant", mana_cost: "{1}{W}{B}", cmc: 3, oracle_text: "Destroy target creature or enchantment.", oracle_id: "faa01ed1-ccfa-4e58-951f-cd81f9068027", scryfall_id: "faa01ed1-ccfa-4e58-951f-cd81f9068027" });
const CELESTIAL_PURGE = () => make({ name: "Celestial Purge", type_line: "Instant", mana_cost: "{1}{W}", cmc: 2, oracle_text: "Exile target black or red permanent.", oracle_id: "ec1f6188-2516-46ac-8a03-7b7285b23a62", scryfall_id: "ec1f6188-2516-46ac-8a03-7b7285b23a62" });
const CRUEL_EDICT = () => make({ name: "Cruel Edict", type_line: "Sorcery", mana_cost: "{1}{B}", cmc: 2, oracle_text: "Target opponent sacrifices a creature of their choice.", oracle_id: "10c585c4-bf5b-4d8f-94a9-e9a5036a688f", scryfall_id: "6f11fe08-d745-4dc7-b995-8ed28cc8b501" });
const ARTIFACT_REMOVAL = () => make({ name: "Shatter", type_line: "Instant", mana_cost: "{1}{R}", cmc: 2, oracle_text: "Destroy target artifact." });
const ENCHANTMENT_REMOVAL = () => make({ name: "Demolish Enchantment", type_line: "Instant", mana_cost: "{1}{W}", cmc: 2, oracle_text: "Destroy target enchantment." });
const LAND_REMOVAL = () => make({ name: "Stone Rain", type_line: "Sorcery", mana_cost: "{2}{R}", cmc: 3, oracle_text: "Destroy target land." });
const DISK = () => make({ name: "Nevinyrral's Disk", type_line: "Artifact", mana_cost: "{4}", cmc: 4, oracle_text: "{1}, {T}: Destroy all artifacts, creatures, and enchantments." });
const DROMARS_CHARM = () => make({
  name: "Dromar's Charm", type_line: "Instant", mana_cost: "{W}{U}{B}", cmc: 3,
  oracle_text: "Choose one —\n• You gain 5 life.\n• Counter target spell.\n• Target creature gets -2/-2 until end of turn."
});
const BOROS_CHARM = () => make({
  name: "Boros Charm", type_line: "Instant", mana_cost: "{R}{W}", cmc: 2,
  oracle_text: "Choose one —\n• Boros Charm deals 4 damage to target player or planeswalker.\n• Permanents you control gain indestructible until end of turn.\n• Target creature gains double strike until end of turn."
});
const SELESNYA_CHARM = () => make({
  name: "Selesnya Charm", type_line: "Instant", mana_cost: "{G}{W}", cmc: 2,
  oracle_text: "Choose one —\n• Create a 2/2 white Knight creature token with vigilance.\n• Exile target creature with power 5 or greater.\n• Target creature gets +2/+2 and gains trample until end of turn."
});
const AZORIUS_CHARM = () => make({
  name: "Azorius Charm", type_line: "Instant", mana_cost: "{W}{U}", cmc: 2,
  oracle_text: "Choose one —\n• Put target creature on top of its owner's library.\n• Draw a card.\n• Creatures you control get +1/+1 until end of turn."
});
const NAYA_CHARM = () => make({
  name: "Naya Charm", type_line: "Instant", mana_cost: "{R}{G}{W}", cmc: 3,
  oracle_text: "Choose one —\n• Naya Charm deals 3 damage to target creature.\n• Return target card from a graveyard to its owner's hand.\n• Tap all creatures target player controls."
});
const SOUL_MANIPULATION = () => make({
  name: "Soul Manipulation", type_line: "Instant", mana_cost: "{1}{U}{B}", cmc: 3,
  oracle_text: "Choose one or both —\n• Counter target creature spell.\n• Return target creature card from your graveyard to your hand."
});
const FISSURE_VENT = () => make({
  name: "Fissure Vent", type_line: "Sorcery", mana_cost: "{3}{R}", cmc: 4,
  oracle_text: "Choose one or both —\n• Destroy target artifact.\n• Destroy target nonbasic land."
});
const ONE_DOZEN_EYES = () => make({
  name: "One Dozen Eyes", type_line: "Sorcery", mana_cost: "{4}{G}", cmc: 5,
  oracle_text: "Choose one —\n• Create a 3/3 green Beast creature token.\n• Create five 1/1 green Insect creature tokens.\nEntwine {5}"
});
const GLOBAL_INDESTRUCTIBLE = () => make({
  name: "Global Indestructible", type_line: "Instant", mana_cost: "{R}{W}", cmc: 2,
  oracle_text: "Permanents you control gain indestructible until end of turn."
});
const HASTE_LORD = () => make({ name: "Haste Memory", type_line: "Creature — Goblin", mana_cost: "{2}{R}", cmc: 3, power: "2", toughness: "2", oracle_text: "Creatures you control have haste." });
const MAELSTROM_WANDERER = () => make({ name: "Maelstrom Wanderer", type_line: "Legendary Creature — Elemental", mana_cost: "{5}{G}{U}{R}", cmc: 8, power: "7", toughness: "5", oracle_text: "Creatures you control have haste.\nCascade\nCascade" });
const VELA = () => make({ name: "Vela the Night-Clad", type_line: "Legendary Creature — Vampire", mana_cost: "{3}{U}{B}", cmc: 5, power: "4", toughness: "4", colors: ["U", "B"], keywords: ["Intimidate"], oracle_text: "Intimidate\nOther creatures you control have intimidate.\nWhenever Vela the Night-Clad or another creature you control leaves the battlefield, each opponent loses 1 life." });
const GAHIJI = () => make({ name: "Gahiji, Honored One", type_line: "Legendary Creature — Beast", mana_cost: "{3}{R}{G}{W}", cmc: 6, power: "4", toughness: "4", oracle_text: "Whenever a creature attacks one of your opponents or a planeswalker an opponent controls, that creature gets +2/+0 until end of turn." });
const TERRA_RAVAGER = () => make({ name: "Terra Ravager", type_line: "Creature — Elemental", mana_cost: "{3}{R}", cmc: 4, power: "0", toughness: "4", oracle_text: "Whenever Terra Ravager attacks, it gets +X/+0 until end of turn, where X is the number of lands defending player controls.", oracle_id: "c7686204-0433-48cf-bbfb-5d32b6a25cc3" });
const INFERNO_TITAN = () => make({ name: "Inferno Titan", type_line: "Creature — Giant", mana_cost: "{4}{R}{R}", cmc: 6, power: "6", toughness: "6", oracle_text: "Whenever Inferno Titan enters the battlefield or attacks, it deals 3 damage divided as you choose among one, two, or three targets.", oracle_id: "0ce47c8b-1e1f-463f-94f0-35ca00be89e6" });
const GUTTERSNIPE = () => make({ name: "Guttersnipe", type_line: "Creature — Goblin Shaman", mana_cost: "{2}{R}", cmc: 3, power: "2", toughness: "2", oracle_text: "Whenever you cast an instant or sorcery spell, Guttersnipe deals 2 damage to each opponent." });
const FECUNDITY = () => make({ name: "Fecundity", type_line: "Enchantment", mana_cost: "{2}{G}", cmc: 3, oracle_text: "Whenever a creature dies, that creature's controller may draw a card." });
const FIRES_OF_YAVIMAYA = () => make({ name: "Fires of Yavimaya", type_line: "Enchantment", mana_cost: "{1}{R}{G}", cmc: 3, oracle_text: "Creatures you control have haste.\n{R}{G}, Sacrifice Fires of Yavimaya: Creatures you control get +2/+2 until end of turn." });
const GOBLIN_BOMBARDMENT = () => make({ name: "Goblin Bombardment", type_line: "Enchantment", mana_cost: "{1}{R}", cmc: 2, oracle_text: "Sacrifice a creature: Goblin Bombardment deals 1 damage to any target." });
const C13_COMMAND_TOWER = () => ({ ...COMMAND_TOWER(), scryfall_id: "0895c9b7-ae7d-4bb3-af17-3b75deb50a25" });
const C13_DECREE_OF_PAIN = () => ({ ...DECREE_OF_PAIN(), scryfall_id: "932668fa-d6e3-41c0-ad0c-8e0a00e68d11" });
const C13_CONTESTED_CLIFFS = () => make({ name: "Contested Cliffs", type_line: "Land", oracle_text: "{T}: Add {C}.\n{R}{G}, {T}: Target Beast creature you control fights target creature an opponent controls.", produced_mana: ["C"], oracle_id: "b891a683-2ebc-4e9c-b402-5dd9c1b42b69" });
const TEST_BEAST = () => make({ name: "Test Beast", type_line: "Creature — Beast", mana_cost: "{2}{G}", cmc: 3, power: "4", toughness: "4" });
const C13_WITCH_HUNT = () => make({ name: "Witch Hunt", type_line: "Enchantment", oracle_text: "Players can't gain life.\nAt the beginning of your upkeep, this enchantment deals 4 damage to you.\nAt the beginning of your end step, target opponent chosen at random gains control of this enchantment.", oracle_id: "e86bd38f-7804-449d-af29-21e96a56ab30" });
const C13_NAYA_SOULBEAST = () => make({ name: "Naya Soulbeast", type_line: "Creature — Beast", mana_cost: "{6}{G}{G}", cmc: 8, power: "0", toughness: "0", oracle_text: "When you cast this spell, each player reveals the top card of their library. This creature enters with X +1/+1 counters on it, where X is the total mana value of all cards revealed this way.\nTrample", oracle_id: "5ea0c608-2c56-4889-a5d3-d435df515950" });
const C13_ETERNAL_DRAGON = () => make({ name: "Eternal Dragon", type_line: "Creature — Dragon Spirit", mana_cost: "{5}{W}{W}", cmc: 7, power: "5", toughness: "5", oracle_text: "Flying\n{3}{W}{W}: Return this card from your graveyard to your hand. Activate only during your upkeep.\nPlainscycling {2} ({2}, Discard this card: Search your library for a Plains card, reveal it, put it into your hand, then shuffle.)", oracle_id: "04d8615c-3883-4251-9790-1d8a4a40e142" });
const C13_MIRROR_ENTITY = () => make({ name: "Mirror Entity", type_line: "Creature — Shapeshifter", mana_cost: "{2}{W}", cmc: 3, power: "1", toughness: "1", oracle_text: "Changeling (This card is every creature type.)\n{X}: Until end of turn, creatures you control have base power and toughness X/X and gain all creature types.", oracle_id: "17e905ca-c0bd-473d-95a7-e180ba5fea43" });
const C13_FAERIE_CONCLAVE = () => make({ name: "Faerie Conclave", type_line: "Land", oracle_text: "This land enters tapped.\n{T}: Add {U}.\n{1}{U}: This land becomes a 2/1 blue Faerie creature with flying until end of turn. It's still a land.", scryfall_id: "0c25f6b1-8fb3-4406-9605-0282d2dbbcec", oracle_id: "0c25f6b1-8fb3-4406-9605-0282d2dbbcec" });
const C13_ARMY_OF_THE_DAMNED = () => {
  const card = TAPPED_ZOMBIES();
  return { ...card, oracle_text: `${card.oracle_text}\nFlashback {7}{B}{B}`, scryfall_id: "75d667ec-86f4-4850-a3b6-e7a9fc7053b0" };
};
const C13_CULTIVATE = () => make({ name: "Cultivate", type_line: "Sorcery", mana_cost: "{2}{G}", cmc: 3, oracle_text: "Search your library for up to two basic land cards, put one onto the battlefield tapped and the other into your hand, then shuffle.", scryfall_id: "8b755881-a72d-4e21-a369-d2924eb4585a" });
const C13_AETHERMAGES_TOUCH = () => make({ name: "Aethermage's Touch", type_line: "Instant", mana_cost: "{2}{W}{U}", cmc: 4, oracle_text: "Reveal the top four cards of your library. You may put a creature card from among them onto the battlefield. It gains \"At the beginning of your end step, return this creature to its owner's hand.\" Then put the rest of the cards revealed this way on the bottom of your library in any order.", scryfall_id: "15692698-ef57-4672-bf76-5fe4a00c693a", oracle_id: "15692698-ef57-4672-bf76-5fe4a00c693a" });
const C13_STRATEGIC_PLANNING = () => make({ name: "Strategic Planning", type_line: "Sorcery", mana_cost: "{1}{U}", cmc: 2, oracle_text: "Look at the top three cards of your library. Put one of them into your hand and the rest into your graveyard.", scryfall_id: "02b5acf3-47cb-4d39-9307-e02656f1879b", oracle_id: "02b5acf3-47cb-4d39-9307-e02656f1879b" });
const C13_SKYWARD_EYE_PROPHETS = () => make({ name: "Skyward Eye Prophets", type_line: "Creature — Human Wizard", mana_cost: "{3}{G}{W}{U}", cmc: 6, power: "3", toughness: "3", oracle_text: "Vigilance\n{T}: Reveal the top card of your library. If it's a land card, put it onto the battlefield. Otherwise, put it into your hand.", scryfall_id: "056f9887-3ab0-486a-b859-5999d39f9ec2", oracle_id: "45bef776-121b-4489-9c46-f7b4fd4c3c0d" });
const C13_AZORIUS_HERALD = () => make({ name: "Azorius Herald", type_line: "Creature — Spirit", mana_cost: "{1}{W}{U}", cmc: 3, power: "2", toughness: "2", oracle_text: "This creature can't be blocked.\nWhen this creature enters, you gain 4 life.\nWhen this creature enters, sacrifice it unless {U} was spent to cast it.", scryfall_id: "a0476da9-51b1-4cd3-90c4-ad01d0e4c3d6", oracle_id: "a0476da9-51b1-4cd3-90c4-ad01d0e4c3d6" });
const C13_ARMILLARY_SPHERE = () => make({ name: "Armillary Sphere", type_line: "Artifact", mana_cost: "{2}", cmc: 2, oracle_text: "{2}, {T}, Sacrifice this artifact: Search your library for up to two basic land cards, reveal them, put them into your hand, then shuffle.", scryfall_id: "3963140c-da67-43e6-9514-fe9dc0a43c4d", oracle_id: "3963140c-da67-43e6-9514-fe9dc0a43c4d" });
const C13_SPOILS_OF_VICTORY = () => make({ name: "Spoils of Victory", type_line: "Sorcery", mana_cost: "{2}{G}", cmc: 3, oracle_text: "Search your library for a Plains, Island, Swamp, Mountain, or Forest card and put that card onto the battlefield. Then shuffle.", scryfall_id: "8a7ee186-b25f-4185-830d-e8e7cf23d4e5", oracle_id: "852bd598-6e48-43c8-9211-740ae9e0c42e" });
const C13_BURNISHED_HART = () => make({ name: "Burnished Hart", type_line: "Artifact Creature — Elk", mana_cost: "{3}", cmc: 3, power: "2", toughness: "2", oracle_text: "{3}, Sacrifice Burnished Hart: Search your library for up to two basic land cards, put them onto the battlefield tapped, then shuffle.", scryfall_id: "893fed41-c144-433f-af88-bc7d419b7fb3" });
const C13_AJANI_PRIDEMATE = () => make({ name: "Ajani's Pridemate", type_line: "Creature — Cat Soldier", mana_cost: "{1}{W}", cmc: 2, power: "2", toughness: "2", oracle_text: "Whenever you gain life, put a +1/+1 counter on Ajani's Pridemate.", scryfall_id: "95e94dea-5ac0-4d6f-adec-ca147aee861f" });
const C13_CRADLE_OF_VITALITY = () => make({ name: "Cradle of Vitality", type_line: "Enchantment", mana_cost: "{2}{W}", cmc: 3, oracle_text: "Whenever you gain life, you may pay {1}{W}. If you do, put a +1/+1 counter on target creature for each 1 life you gained.", scryfall_id: "956250da-532a-4457-8696-73915be56943" });
const C13_THOPTER_FOUNDRY = () => make({ name: "Thopter Foundry", type_line: "Artifact", mana_cost: "{2}", cmc: 2, oracle_text: "{1}, Sacrifice a nontoken artifact: Create a 1/1 blue Thopter artifact creature token with flying. You gain 1 life.", scryfall_id: "88bef744-550e-4f33-b1ff-a8ee990ec754" });
const C13_BLUE_SUN = () => make({ name: "Blue Sun's Zenith", type_line: "Instant", mana_cost: "{X}{U}{U}{U}", cmc: 3, oracle_text: "Target player draws X cards. Shuffle Blue Sun's Zenith into its owner's library.", scryfall_id: "613a41b8-0b4f-4995-bf1e-ca41f96e6438" });
const C13_NEW_BENALIA = () => make({ name: "New Benalia", type_line: "Land", oracle_text: "New Benalia enters the battlefield tapped.\nWhen New Benalia enters the battlefield, scry 1.\n{T}: Add {W}.", produced_mana: ["W"], scryfall_id: "6e743fbf-b5b6-4176-a4f2-6933f521f2fe" });
const C13_BALOTH_WOODCRASHER = () => make({ name: "Baloth Woodcrasher", type_line: "Creature — Beast", mana_cost: "{4}{G}{G}", cmc: 6, power: "4", toughness: "4", oracle_text: "Landfall — Whenever a land you control enters, this creature gets +4/+4 and gains trample until end of turn.", scryfall_id: "d8af1377-72bb-4d93-80bd-2c927b02cc73" });
const MURKFIEND_LIEGE = () => make({ name: "Murkfiend Liege", type_line: "Creature — Horror", mana_cost: "{2}{G}{U}", cmc: 4, power: "4", toughness: "4", oracle_text: "Other green creatures you control get +1/+1. Other blue creatures you control get +1/+1. Untap all green and/or blue creatures you control during each other player's untap step.", oracle_id: "61d28182-498f-4bbc-bb7a-c5e1ef872dda" });
const C13_GRAZING_GLADEHART = () => make({ name: "Grazing Gladehart", type_line: "Creature — Antelope", mana_cost: "{2}{G}", cmc: 3, power: "2", toughness: "2", oracle_text: "Landfall — Whenever a land enters the battlefield under your control, you may gain 2 life.", scryfall_id: "f19f28e5-9cad-4398-b2d4-9e7fefb23cb4", oracle_id: "f19f28e5-9cad-4398-b2d4-9e7fefb23cb4" });
const C13_HUNTED_TROLL = () => make({ name: "Hunted Troll", type_line: "Creature — Troll Warrior", mana_cost: "{2}{G}{G}", cmc: 4, power: "8", toughness: "4", oracle_text: "When Hunted Troll enters the battlefield, create four 1/1 blue Faerie creature tokens with flying under target opponent's control.", scryfall_id: "1f789fcf-3df6-45a6-a732-9f43e33718d6", oracle_id: "1f789fcf-3df6-45a6-a732-9f43e33718d6" });
const LANDFALL_SELF_PUMP = () => make({ name: "Landfall Self Pump", type_line: "Creature — Beast", mana_cost: "{2}{G}", cmc: 3, power: "3", toughness: "3", oracle_text: "Landfall — Whenever a land you control enters, this creature gets +2/+2 until end of turn." });
const C13_DUNGEON_GEISTS = () => make({
  name: "Dungeon Geists", type_line: "Creature — Spirit", mana_cost: "{2}{U}{U}", cmc: 4, power: "3", toughness: "3",
  keywords: ["Flying"],
  oracle_text: "Flying\nWhen this creature enters, tap target creature an opponent controls. That creature doesn't untap during its controller's untap step for as long as you control this creature.",
  scryfall_id: "d3c81fda-c23d-437c-85f0-62d7b492ea32", oracle_id: "ab5ebae2-cd77-4a7d-a93b-8042cd486429"
});
const C13_BASALT_MONOLITH = () => make({ name: "Basalt Monolith", type_line: "Artifact", mana_cost: "{3}", cmc: 3, oracle_text: "This artifact doesn't untap during your untap step.\n{T}: Add {C}{C}{C}.\n{3}: Untap this artifact.", produced_mana: ["C"], scryfall_id: "7770e48e-72e1-4475-a4b5-c1c561a1beaa" });
const C13_MOLTEN_SLAGHEAP = () => make({ name: "Molten Slagheap", type_line: "Land", oracle_text: "{T}: Add {C}.\n{1}, {T}: Put a storage counter on this land.\n{1}, Remove X storage counters from this land: Add X mana in any combination of {B} and/or {R}.", produced_mana: ["C", "B", "R"], scryfall_id: "c13-molten-slagheap" });
const C13_SALTCRUSTED_STEPPE = () => make({ name: "Saltcrusted Steppe", type_line: "Land", oracle_text: "{T}: Add {C}.\n{1}, {T}: Put a storage counter on this land.\n{1}, Remove X storage counters from this land: Add X mana in any combination of {G} and/or {W}.", produced_mana: ["C", "G", "W"], scryfall_id: "c13-saltcrusted-steppe" });
const TOXIC_DELUGE = () => make({ name: "Toxic Deluge", type_line: "Sorcery", mana_cost: "{2}{B}", cmc: 3, oracle_text: "As an additional cost to cast ~, pay X life.\nAll creatures get -X/-X until end of turn.", scryfall_id: "c13-toxic-deluge" });
const C13_KROSAN_GRIP = () => make({ name: "Krosan Grip", type_line: "Instant", mana_cost: "{2}{G}", cmc: 3, keywords: ["Split Second"], oracle_text: "Split second\nDestroy target artifact or enchantment.", scryfall_id: "c13-krosan-grip" });
const C13_AZAMI = () => make({ name: "Azami, Lady of Scrolls", type_line: "Legendary Creature — Human Wizard", mana_cost: "{2}{U}{U}", cmc: 4, power: "0", toughness: "2", oracle_text: "Tap an untapped Wizard you control: Draw a card.", scryfall_id: "cafda395-840f-4359-9314-e1cbf137cc66" });
const AZAMI_WIZARD = () => make({ name: "Library Wizard", type_line: "Creature — Human Wizard", mana_cost: "{1}{U}", cmc: 2, power: "1", toughness: "1" });
const C13_BRILLIANT_PLAN = () => make({ name: "Brilliant Plan", type_line: "Sorcery", mana_cost: "{4}{U}", cmc: 5, oracle_text: "Draw three cards.", scryfall_id: "4fc6b5a0-9a0f-4934-8a43-a0e5364832ec" });
const C13_HARMONIZE = () => make({ name: "Harmonize", type_line: "Sorcery", mana_cost: "{2}{G}{G}", cmc: 4, oracle_text: "Draw three cards.", scryfall_id: "83da2456-0c5c-4b2b-8183-20c332566127" });
const C13_VISION_SKEINS = () => make({ name: "Vision Skeins", type_line: "Instant", mana_cost: "{1}{U}", cmc: 2, oracle_text: "Each player draws two cards.", scryfall_id: "b4b032de-808e-4c47-ba86-ac59609378e0" });
const C13_SKYSCRIBING = () => make({
  name: "Skyscribing", type_line: "Sorcery", mana_cost: "{X}{U}{U}", cmc: 2,
  oracle_text: "Each player draws X cards.\nForecast — {2}{U}, Reveal this card from your hand: Each player draws a card. (Activate only during your upkeep and only once each turn.)",
  scryfall_id: "c3416e6c-ec46-410c-ab80-6e8fdb89f42d", oracle_id: "c3416e6c-ec46-410c-ab80-6e8fdb89f42d"
});
const C13_DEEP_ANALYSIS = () => make({ name: "Deep Analysis", type_line: "Sorcery", mana_cost: "{3}{U}", cmc: 4, oracle_text: "Target player draws two cards.\nFlashback—{1}{U}, Pay 3 life. (You may cast this card from your graveyard for its flashback cost. Then exile it.)", scryfall_id: "952800af-f52c-44bf-a98b-51c5f8142dc9" });
const C13_BALEFUL_STRIX = () => make({ name: "Baleful Strix", type_line: "Artifact Creature — Bird", mana_cost: "{U}{B}", cmc: 2, power: "1", toughness: "1", keywords: ["Flying", "Deathtouch"], oracle_text: "Flying\nDeathtouch\nWhen this creature enters, draw a card.", scryfall_id: "47ac0f77-1294-4de9-93d1-141a9f314f98" });
const C13_PHYREXIAN_GARGANTUA = () => make({ name: "Phyrexian Gargantua", type_line: "Creature — Phyrexian Horror", mana_cost: "{4}{B}{B}", cmc: 6, power: "4", toughness: "4", oracle_text: "When this creature enters, you draw two cards and you lose 2 life.", scryfall_id: "56ae94c2-8bbb-4807-b1e0-8ef178dd1697" });
const C13_ANNIHILATE = () => make({ name: "Annihilate", type_line: "Instant", mana_cost: "{3}{B}{B}", cmc: 5, oracle_text: "Destroy target nonblack creature. It can't be regenerated.\nDraw a card.", scryfall_id: "595e8c26-672d-4978-87ec-9e0ed64ceaf0" });
const C13_RECKLESS_SPITE = () => make({ name: "Reckless Spite", type_line: "Instant", mana_cost: "{3}{B}{B}", cmc: 5, oracle_text: "Destroy two target nonblack creatures. You lose 5 life.", scryfall_id: "a684df3a-5441-4daa-86d1-c47a91b35e6a" });
const C13_UNEXPECTEDLY_ABSENT = () => make({ name: "Unexpectedly Absent", type_line: "Instant", mana_cost: "{X}{W}{U}", cmc: 2, oracle_text: "Put target nonland permanent into its owner's library just beneath the top X cards of that library.", scryfall_id: "e8d78a83-c932-4b55-8f75-7094c672c3a9" });
const C13_ANGEL_OF_FINALITY = () => make({ name: "Angel of Finality", type_line: "Creature — Angel", mana_cost: "{3}{W}", cmc: 4, power: "3", toughness: "4", keywords: ["Flying"], oracle_text: "Flying\nWhen this creature enters, exile target player's graveyard.", scryfall_id: "bd3c34c9-2072-4ebb-93ef-34173015bfb8" });
const C13_BOJUKA_BOG = () => make({ name: "Bojuka Bog", type_line: "Land", oracle_text: "This land enters tapped.\nWhen this land enters, exile target player's graveyard.\n{T}: Add {B}.", produced_mana: ["B"], scryfall_id: "2ef9848c-fe7f-4434-8936-4074f67883af" });
const C13_SPRINGJACK_PASTURE = () => make({ name: "Springjack Pasture", type_line: "Land", oracle_text: "{T}: Add {C}.\n{4}, {T}: Create a 0/1 white Goat creature token.\n{T}, Sacrifice X Goats: Add X mana of any one color. You gain X life.", produced_mana: ["C", "W", "U", "B", "R", "G"], scryfall_id: "035438b1-f794-41e5-9e2b-bc5136766cd5", oracle_id: "9eaadbbc-818b-4c21-9d4b-1bba48504d38" });
const GOAT = () => make({ name: "Goat", type_line: "Token Creature — Goat", power: "0", toughness: "1" });
const C13_ARCANE_DENIAL = () => make({ name: "Arcane Denial", type_line: "Instant", mana_cost: "{1}{U}{U}", cmc: 3, oracle_text: "Counter target spell. Its controller may draw up to two cards at the beginning of the next turn's upkeep.\nYou draw a card at the beginning of the next turn's upkeep.", scryfall_id: "ab175817-da6a-4ae7-a016-c3bfb087eae0" });
const C13_BANE_OF_PROGRESS = () => make({ name: "Bane of Progress", type_line: "Creature — Elemental", mana_cost: "{2}{G}{G}", cmc: 4, power: "2", toughness: "2", oracle_text: "When Bane of Progress enters the battlefield, destroy all artifacts and enchantments, then put a +1/+1 counter on Bane of Progress for each permanent destroyed this way.", scryfall_id: "51f9a6cc-8eb2-44ed-a2d9-913ac514ad67" });
const C13_RAZOR_HIPPOGRIFF = () => make({ name: "Razor Hippogriff", type_line: "Creature — Hippogriff", mana_cost: "{3}{W}{W}", cmc: 5, power: "3", toughness: "3", keywords: ["Flying"], oracle_text: "Flying\nWhen Razor Hippogriff enters the battlefield, you may return target artifact card from your graveyard to your hand. You gain life equal to that card's converted mana cost.", scryfall_id: "d121108e-f0bc-469b-bf94-e5e530801a4" });
const C13_NIGHT_SOIL = () => make({ name: "Night Soil", type_line: "Enchantment", mana_cost: "{2}{G}", cmc: 3, oracle_text: "{1}, Exile two creature cards from a single graveyard: Create a 1/1 green Saproling creature token.", scryfall_id: "52a0eca1-f936-4f5a-820b-fa12542c593d", oracle_id: "3165fe8f-52d7-40f7-bb14-8f4300a564e6" });
const C13_DISCIPLE_OF_GRISELBRAND = () => make({ name: "Disciple of Griselbrand", type_line: "Creature — Human Cleric", mana_cost: "{1}{W}{B}", cmc: 3, power: "2", toughness: "2", oracle_text: "{1}, Sacrifice a creature: You gain life equal to the sacrificed creature's toughness.", scryfall_id: "2d92a035-dd7a-4426-a8c0-f04e0b836dad", oracle_id: "2d92a035-dd7a-4426-a8c0-f04e0b836dad" });
const C13_SPELLBREAKER_BEHEMOTH = () => make({ name: "Spellbreaker Behemoth", type_line: "Creature — Beast", mana_cost: "{2}{R}{G}", cmc: 4, power: "5", toughness: "5", oracle_text: "Creature spells you control with power 5 or greater can't be countered.", scryfall_id: "cba07472-7212-4411-a9f9-38a48870ad69", oracle_id: "cba07472-7212-4411-a9f9-38a48870ad69" });
const C13_FLICKERWISP = () => make({ name: "Flickerwisp", type_line: "Creature — Elemental", mana_cost: "{1}{W}{W}", cmc: 3, power: "3", toughness: "1", keywords: ["Flying"], oracle_text: "Flying\nWhen this creature enters, exile another target permanent. Return that card to the battlefield under its owner's control at the beginning of the next end step.", scryfall_id: "f6cccf30-2025-49bb-9b1e-240bbef03f27", oracle_id: "b23a3d30-6b8e-4aad-890f-db0c3af43ace" });
const C13_FIEND_HUNTER = () => make({ name: "Fiend Hunter", type_line: "Creature — Human Cleric", mana_cost: "{1}{W}{W}", cmc: 3, power: "1", toughness: "3", oracle_text: "When ~ enters, you may exile another target creature.\nWhen ~ leaves the battlefield, return the exiled card to the battlefield under its owner's control.", scryfall_id: "cb9d557a-fc06-428c-8be6-7d28add33028", oracle_id: "cb9d557a-fc06-428c-8be6-7d28add33028" });
const C13_VILE_REQUIEM = () => make({ name: "Vile Requiem", type_line: "Enchantment", mana_cost: "{2}{B}{B}", cmc: 4, oracle_text: "At the beginning of your upkeep, you may put a verse counter on this enchantment.\n{1}{B}, Sacrifice this enchantment: Destroy up to X target nonblack creatures, where X is the number of verse counters on this enchantment. They can't be regenerated.", scryfall_id: "923972d3-d838-43f8-800a-904489c5791a" });
const C13_WELL_OF_LOST_DREAMS = () => make({ name: "Well of Lost Dreams", type_line: "Artifact", mana_cost: "{4}", cmc: 4, oracle_text: "Whenever you gain life, you may pay {X}, where X is less than or equal to the amount of life you gained. If you do, draw X cards.", scryfall_id: "b0394cf2-12a0-4d4f-87e0-fe8937e6faff" });
const C13_OLORO = () => make({ name: "Oloro, Ageless Ascetic", type_line: "Legendary Creature — Giant Soldier", mana_cost: "{3}{W}{U}{B}", cmc: 6, power: "4", toughness: "5", oracle_text: "At the beginning of your upkeep, you gain 2 life.\nWhenever you gain life, you may pay {1}. If you do, draw a card and each opponent loses 1 life.\nAt the beginning of your upkeep, if Oloro, Ageless Ascetic is in the command zone, you gain 2 life.", scryfall_id: "abf8df47-405c-42d8-be9e-0f0d0a49589b", oracle_id: "620ff5f2-7d3f-467f-943d-3b62c2135023" });
const C13_JACES_ARCHIVIST = () => make({ name: "Jace's Archivist", type_line: "Creature — Human Wizard", mana_cost: "{1}{U}", cmc: 2, power: "2", toughness: "2", oracle_text: "{U}, {T}: Each player discards their hand, then draws cards equal to the greatest number of cards a player discarded this way.", scryfall_id: "b6c8ac69-daa7-4e2e-a1d9-439731a81870" });
const C13_AUGUR_OF_BOLAS = () => make({ name: "Augur of Bolas", type_line: "Creature — Merfolk Wizard", mana_cost: "{1}{U}", cmc: 2, power: "1", toughness: "3", oracle_text: "When Augur of Bolas enters the battlefield, look at the top three cards of your library. You may reveal an instant or sorcery card from among them and put it into your hand. Put the rest on the bottom of your library in any order.", scryfall_id: "c13-augur-of-bolas" });
const C13_ACT_OF_AUTHORITY = () => make({ name: "Act of Authority", type_line: "Enchantment", mana_cost: "{3}{W}", cmc: 4, oracle_text: "When this enchantment enters, you may exile target artifact or enchantment.\nAt the beginning of your upkeep, you may exile target artifact or enchantment. If you do, its controller gains control of this enchantment.", scryfall_id: "c13-act-of-authority" });
const C13_BORROWING_ARROWS = () => make({ name: "Borrowing 100,000 Arrows", type_line: "Sorcery", mana_cost: "{3}{U}", cmc: 4, oracle_text: "Draw a card for each tapped creature target opponent controls.", scryfall_id: "26334142-e9a2-4bf0-983e-dca4b4d817d7" });
const C13_BLOOD_RITES = () => make({ name: "Blood Rites", type_line: "Enchantment", mana_cost: "{3}{R}{R}", cmc: 5, oracle_text: "{1}{R}, Sacrifice a creature: This enchantment deals 2 damage to any target.", scryfall_id: "89d77b63-eeee-4d8a-9622-b1ea36dc70de" });
const C13_CARNAGE_ALTAR = () => make({ name: "Carnage Altar", type_line: "Artifact", mana_cost: "{2}", cmc: 2, oracle_text: "{3}, Sacrifice a creature: Draw a card.", scryfall_id: "c08486d3-3d94-49c7-b8c9-61eb8a3e6428" });
const C13_BALEFUL_FORCE = () => make({ name: "Baleful Force", type_line: "Creature — Elemental", mana_cost: "{5}{B}{B}{B}", cmc: 8, power: "8", toughness: "8", oracle_text: "At the beginning of each upkeep, you draw a card and you lose 1 life.", scryfall_id: "a5e79f7b-0212-476b-9dea-bf1ada419e72" });
const C13_DRUIDIC_SATCHEL = () => make({ name: "Druidic Satchel", type_line: "Artifact", mana_cost: "{3}", cmc: 3, oracle_text: "{2}, {T}: Reveal the top card of your library. If it's a creature card, create a 1/1 green Saproling creature token. If it's a land card, put that card onto the battlefield under your control. If it's a noncreature, nonland card, you gain 2 life.", scryfall_id: "f3aaefb4-4662-434a-9c31-3f2c754ce9cc" });
const C13_RUPTURE_SPIRE = () => make({ name: "Rupture Spire", type_line: "Land", oracle_text: "Rupture Spire enters the battlefield tapped.\nWhen Rupture Spire enters the battlefield, sacrifice it unless you pay {1}.\n{T}: Add one mana of any color.", produced_mana: ["W", "U", "B", "R", "G"], scryfall_id: "622087fc-4e34-43cd-a46f-fd2c339b3905" });
const C13_TRANSGUILD_PROMENADE = () => make({ name: "Transguild Promenade", type_line: "Land", oracle_text: "Transguild Promenade enters the battlefield tapped.\nWhen Transguild Promenade enters the battlefield, sacrifice it unless you pay {1}.\n{T}: Add one mana of any color.", produced_mana: ["W", "U", "B", "R", "G"], scryfall_id: "9f325665-43cd-4b6d-8878-e42a39178e3f" });
const SCRY_TWO = () => make({ name: "Scry Two", type_line: "Sorcery", mana_cost: "{U}", cmc: 1, oracle_text: "Scry 2." });
const SURVEIL_TWO = () => make({ name: "Surveil Two", type_line: "Sorcery", mana_cost: "{U}", cmc: 1, oracle_text: "Surveil 2." });
const EDRIC = () => make({ name: "Edric, Spymaster of Trest", type_line: "Legendary Creature — Elf Rogue", mana_cost: "{1}{G}{U}", cmc: 3, power: "2", toughness: "2", colors: ["G", "U"], oracle_text: "Whenever a creature deals combat damage to one of your opponents, you may draw a card." });
const AUGURY_ADEPT = () => make({ name: "Augury Adept", type_line: "Creature — Kithkin Wizard", mana_cost: "{1}{W/U}{W/U}", cmc: 3, power: "2", toughness: "2", colors: ["W", "U"], oracle_text: "Whenever this creature deals combat damage to a player, reveal the top card of your library and put that card into your hand. You gain life equal to its mana value.", scryfall_id: "be5a65fd-0d06-4771-bee7-0e42cc9871da" });
const FOSTER = () => make({ name: "Foster", type_line: "Enchantment", mana_cost: "{2}{G}", cmc: 3, oracle_text: "Whenever a creature you control dies, you may pay {1}. If you do, reveal cards from the top of your library until you reveal a creature card. Put that card into your hand and the rest into your graveyard.", scryfall_id: "fb431500-152c-4524-b76b-de62922ff57f" });
const MINDS_EYE = () => make({ name: "Mind's Eye", type_line: "Artifact", mana_cost: "{5}", cmc: 5, oracle_text: "Whenever an opponent draws a card, you may pay {1}. If you do, draw a card." });
const RHYSTIC_STUDY = () => make({ name: "Rhystic Study", type_line: "Enchantment", mana_cost: "{2}{U}", cmc: 3, oracle_text: "Whenever an opponent casts a spell, you may draw a card unless that player pays {1}." });
const DUPLICANT = () => make({ name: "Duplicant", type_line: "Artifact Creature — Shapeshifter", mana_cost: "{6}", cmc: 6, power: "2", toughness: "4", oracle_text: "When Duplicant enters, you may exile target nontoken creature.\nAs long as a card exiled with Duplicant is a creature card, Duplicant has the power, toughness, and creature types of the last creature card exiled with Duplicant. It's still a Shapeshifter." });
const FLYING_LORD = () => make({ name: "Sky Lord", type_line: "Creature — Bird", mana_cost: "{3}{U}", cmc: 4, power: "2", toughness: "2", oracle_text: "Creatures you control have flying." });
const OTHER_FLYING_LORD = () => make({ name: "Other Sky Lord", type_line: "Creature — Bird", mana_cost: "{3}{U}", cmc: 4, power: "2", toughness: "2", oracle_text: "Other creatures you control have flying." });
const GAIN_FLYING_LORD = () => make({ name: "Gain Sky Lord", type_line: "Creature — Bird", mana_cost: "{3}{U}", cmc: 4, power: "2", toughness: "2", oracle_text: "Creatures you control gain flying." });
const ALL_FLYING_LORD = () => make({ name: "Universal Sky", type_line: "Enchantment", mana_cost: "{3}{U}", cmc: 4, oracle_text: "All creatures have flying." });
const ALL_PUMP = () => make({ name: "Universal Pump", type_line: "Enchantment", mana_cost: "{3}{G}", cmc: 4, oracle_text: "All creatures get +1/+1." });
const CROSIS_CHARM = () => make({
  name: "Crosis's Charm", type_line: "Instant", mana_cost: "{U}{B}{R}", cmc: 3,
  oracle_text: "Choose one —\n• Return target permanent to its owner's hand.\n• Destroy target nonblack creature. It can't be regenerated.\n• Destroy target artifact."
});
const LANDFALL_BEAST = () => make({
  name: "Landfall Beast", type_line: "Creature — Beast", mana_cost: "{2}{G}", cmc: 3, power: "4", toughness: "4",
  oracle_text: "Landfall — Whenever a land you control enters, create a 4/4 green Beast creature token."
});
const VALLEY_RANNET = () => make({
  name: "Valley Rannet", type_line: "Creature — Beast", mana_cost: "{3}{R}{G}", cmc: 5, power: "6", toughness: "3",
  oracle_text: "Mountaincycling {2}, forestcycling {2} ({2}, Discard this card: Search your library for a Mountain or Forest card, reveal it, put it into your hand, then shuffle.)"
});
const UNSUMMON = () => make({ name: "Unsummon", type_line: "Instant", mana_cost: "{U}", cmc: 1, oracle_text: "Return target creature to its owner's hand." });
const FIREBALL = () => make({ name: "Fireball", type_line: "Sorcery", mana_cost: "{X}{R}", cmc: 1, oracle_text: "Fireball deals X damage to any target. It costs {1} more to cast for each target beyond the first." });
const COUNTER = () => make({ name: "Cancel Spell", type_line: "Instant", mana_cost: "{U}{U}", cmc: 2, oracle_text: "Counter target spell." });
const OFFER_YOU_CANT_REFUSE = () => make({ name: "Test An Offer You Can't Refuse", type_line: "Instant", mana_cost: "{1}{U}", cmc: 2, oracle_text: "Counter target noncreature spell. Its controller creates two Treasure tokens." });
const TUTOR = () => make({ name: "Enlightened Tutor", type_line: "Instant", mana_cost: "{W}", cmc: 1, oracle_text: "Search your library for an artifact or enchantment card, reveal it, then shuffle. Put that card on top of your library." });
const DIABOLIC_INTENT = () => make({ name: "Diabolic Intent", type_line: "Sorcery", mana_cost: "{1}{B}", cmc: 2, oracle_text: "As an additional cost to cast this spell, sacrifice a creature.\nSearch your library for a card, put that card into your hand, then shuffle." });
const DEADLY_ROLLICK = () => make({ name: "Deadly Rollick", type_line: "Instant", mana_cost: "{2}{B}{B}", cmc: 4, oracle_text: "If you control a commander, you may cast this spell without paying its mana cost.\nExile target creature.", oracle_id: "0456ec64-2c81-4763-a352-8ff64a4c3d6b", scryfall_id: "a30c266d-579e-4757-a4d6-6722fa343a6c" });
const SNUFF_OUT = () => make({ name: "Snuff Out", type_line: "Instant", mana_cost: "{3}{B}", cmc: 4, oracle_text: "If you control a Swamp, you may pay 4 life rather than pay this spell's mana cost.\nDestroy target nonblack creature. It can't be regenerated.", oracle_id: "324824cb-f938-401c-b9b5-d8908b431ef0", scryfall_id: "cdb4bdc5-2533-4e6d-ab69-ccbf3d497748" });
const BALEFUL_MASTERY = () => make({ name: "Baleful Mastery", type_line: "Instant", mana_cost: "{2}{B}{B}", cmc: 4, oracle_text: "You may pay {1}{B} rather than pay this spell's mana cost.\nIf the {1}{B} cost was paid, an opponent draws a card.\nExile target creature or planeswalker.", oracle_id: "adfcdadd-ddda-477b-8e72-0cae2430fb63", scryfall_id: "09f8d1e2-7f12-4828-8391-eb50f67e66a5" });
const BLACK_SOURCE = () => make({ name: "Onyx Mana Rock", type_line: "Land", produced_mana: ["B"] });
const COUNTER_UNLESS_PAY = () => make({ name: "Test Mana Leak", type_line: "Instant", mana_cost: "{1}{U}", cmc: 2, oracle_text: "Counter target spell unless its controller pays {1}." });
const DAZE = () => make({ name: "Daze", type_line: "Instant", mana_cost: "{1}{U}", cmc: 2, oracle_text: "You may return an Island you control to its owner's hand rather than pay this spell's mana cost.\nCounter target spell unless its controller pays {1}.", oracle_id: "70486bee-6ee7-41ea-b834-8caf4699302b", scryfall_id: "61968d99-6571-49ce-bcf1-2aaac3a10f45" });
const FLUSTERSTORM = () => make({ name: "Flusterstorm", type_line: "Instant", mana_cost: "{U}", cmc: 1, keywords: ["storm"], oracle_text: "Counter target instant or sorcery spell unless its controller pays {1}.\nStorm (When you cast this spell, copy it for each spell cast before it this turn. You may choose new targets for the copies.)", oracle_id: "86bf58f2-7f25-4e10-b797-25e0e8e67769", scryfall_id: "0bc0f90d-1aef-4c70-9529-0482023d084f" });
const MANA_DRAIN = () => make({ name: "Mana Drain", type_line: "Instant", mana_cost: "{U}{U}", cmc: 2, oracle_text: "Counter target spell. At the beginning of your next main phase, add an amount of {C} equal to that spell's mana value.", oracle_id: "74d3277a-38e5-4732-afed-084a56148f20", scryfall_id: "f4e72225-0008-46cf-b403-3402ae8bfe47" });
const LONG_RIVERS_PULL = () => make({ name: "Long River's Pull", type_line: "Instant", mana_cost: "{1}{U}", cmc: 2, oracle_text: "Gift a card (You may promise an opponent a gift as you cast this spell. If you do, they draw a card before its other effects.)\nCounter target creature spell. If the gift was promised, instead counter target spell.", oracle_id: "f1993767-1d07-49c8-b8dc-04ec9840a999", scryfall_id: "1c81d0fa-81a1-4f9b-a5fd-5a648fd01dea" });
const PROPAGANDA = () => make({ name: "Propaganda", type_line: "Enchantment", mana_cost: "{2}{U}", cmc: 3, oracle_text: "Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.", oracle_id: "ea9709b6-4c37-4d5a-b04d-cd4c42e4f9dd", scryfall_id: "2a874a07-502a-48d8-a48f-f4357b38b4ae" });
const ORCISH_BOWMASTERS = () => make({ name: "Orcish Bowmasters", type_line: "Creature — Orc Archer", mana_cost: "{1}{B}", cmc: 2, power: "1", toughness: "1", keywords: ["Flash"], oracle_text: "Flash\nWhen ~ enters and whenever an opponent draws a card except the first one they draw in each of their draw steps, ~ deals 1 damage to any target. Then amass Orcs 1.", oracle_id: "ea5103f5-27e0-4eb1-902c-7f34652d6bf3", scryfall_id: "10f14c9e-6776-4efd-9e3b-1d25b7625e17" });
const WIDESPREAD_PANIC = () => make({ name: "Widespread Panic", type_line: "Enchantment", mana_cost: "{2}{R}", cmc: 3, oracle_text: "Whenever a spell or ability causes its controller to shuffle their library, that player puts a card from their hand on top of their library.", oracle_id: "853a3c2b-3d37-453a-8a77-4d90bd3a1cb7", scryfall_id: "d9e1b37f-8168-4dc0-858f-434ee96ff748" });
const MJOLNIR = () => make({
  name: "Mjölnir, Hammer of Thor", type_line: "Legendary Artifact — Equipment", mana_cost: "{3}{R}", cmc: 4,
  oracle_text: "When Mjölnir enters, it deals 4 damage to up to one target creature.\nDouble all damage equipped creature would deal.\nEquip worthy {1} (A creature is worthy if it's a legendary non-Villain that's red and/or white.)\n{2}{R}, Discard this card: It deals 2 damage to each creature.",
  oracle_id: "7f9a8845-d760-44a7-a4c9-8a20dba4e14a", scryfall_id: "e0c7f566-5351-44e3-a346-b84b0eb10209"
});
const WORTHY_CREATURE = () => make({ name: "Test Worthy Avenger", type_line: "Legendary Creature — Human Hero", mana_cost: "{2}{R}", cmc: 3, power: "2", toughness: "2", colors: ["R"] });
const NAKTAMUN_LORESPINNER = () => make({
  name: "Naktamun Lorespinner // Wheel of Fortune", type_line: "Creature — Jackal Wizard // Sorcery", mana_cost: "{2}{R} // {2}{R}", cmc: 3, power: "3", toughness: "3", colors: ["R"],
  card_faces: [
    {
      name: "Naktamun Lorespinner", mana_cost: "{2}{R}", type_line: "Creature — Jackal Wizard", power: "3", toughness: "3",
      oracle_text: "At the beginning of your upkeep, if a player has one or fewer cards in hand, this creature becomes prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)"
    },
    { name: "Wheel of Fortune", mana_cost: "{2}{R}", type_line: "Sorcery", oracle_text: "Each player discards their hand, then draws seven cards." }
  ],
  oracle_id: "c78783e5-868d-4a8b-a4f8-95a92853cf0a", scryfall_id: "acca1fd4-6384-460e-905f-118f01aa76ed"
});
const REFORGE_THE_SOUL = () => make({
  name: "Reforge the Soul", type_line: "Sorcery", mana_cost: "{3}{R}{R}", cmc: 5, keywords: ["Miracle"],
  oracle_text: "Each player discards their hand, then draws seven cards.\nMiracle {1}{R} (You may cast this card for its miracle cost when you draw it if it's the first card you drew this turn.)",
  oracle_id: "ece854f8-8c60-4f30-894f-2286d3dd61b9", scryfall_id: "1c3509c6-2ae7-45be-8ac9-4d14d69db32f"
});
const GITAXIAN_PROBE = () => make({
  name: "Gitaxian Probe", type_line: "Sorcery", mana_cost: "{U/P}", cmc: 1, oracle_text: "Look at target player's hand.\nDraw a card.",
  oracle_id: "1d67f5ff-1fce-45e5-b6a1-416c569351e2", scryfall_id: "995486ce-58bb-4753-a812-0ca73ef1a235"
});
const NOTION_THIEF = () => make({
  name: "Notion Thief", type_line: "Creature — Human Rogue", mana_cost: "{2}{U}{B}", cmc: 4, power: "3", toughness: "1", keywords: ["Flash"],
  oracle_text: "Flash\nIf an opponent would draw a card except the first one they draw in each of their draw steps, instead that player skips that draw and you draw a card.",
  oracle_id: "f8dab16e-1d50-443e-9431-8b6f1cf61c9c", scryfall_id: "f675f509-4343-4568-96dd-265626cb6c2b"
});
const BLACK_MARKET_CONNECTIONS = () => make({
  name: "Black Market Connections", type_line: "Enchantment", mana_cost: "{2}{B}", cmc: 3,
  oracle_text: "At the beginning of your first main phase, choose one or more —\n• Sell Contraband — Create a Treasure token. You lose 1 life.\n• Buy Information — Draw a card. You lose 2 life.\n• Hire a Mercenary — Create a 3/2 colorless Shapeshifter creature token with changeling. You lose 3 life.",
  oracle_id: "d2664f28-49e1-46f8-a863-b217e961a57c", scryfall_id: "9d9ca869-e68a-4f53-9f52-85c714dac6f3"
});
const WIZARD_CLASS = () => make({
  name: "Wizard Class", type_line: "Enchantment — Class", mana_cost: "{U}", cmc: 1,
  oracle_text: "You have no maximum hand size.\n{2}{U}: Level 2\nWhen this Class becomes level 2, draw two cards.\n{4}{U}: Level 3\nWhenever you draw a card, put a +1/+1 counter on target creature you control.",
  oracle_id: "36f68aa3-9955-46f1-bc87-497f16ef5222", scryfall_id: "d1f629fb-b097-4240-8560-ef47f5678f48"
});
const BRAINSTORM = () => make({ name: "Brainstorm", type_line: "Instant", mana_cost: "{U}", cmc: 1, oracle_text: "Draw three cards, then put two cards from your hand on top of your library in any order.", oracle_id: "36cd2364-d113-47d1-b2c4-b088d9eb88dd", scryfall_id: "d8bcdbfb-27df-4553-b8ec-97c3f2053745" });
const WORLDLY = () => make({ name: "Worldly Tutor", type_line: "Instant", mana_cost: "{G}", cmc: 1, oracle_text: "Search your library for a creature card, reveal it, then shuffle and put the card on top." });
const ELADAMRI = () => make({ name: "Eladamri's Call", type_line: "Instant", mana_cost: "{G}{W}", cmc: 2, oracle_text: "Search your library for a creature card, reveal that card, put it into your hand, then shuffle." });
const ENTOMB = () => make({ name: "Entomb", type_line: "Instant", mana_cost: "{B}", cmc: 1, oracle_text: "Search your library for a card, put that card into your graveyard, then shuffle." });
const PLANT_SPELL = () => make({ name: "Plant Ritual", type_line: "Sorcery", mana_cost: "{3}{G}", cmc: 4, oracle_text: "Create three 0/1 green Plant creature tokens." });
const TAPPED_ZOMBIES = () => make({ name: "Army of the Dead", type_line: "Sorcery", mana_cost: "{5}{B}{B}", cmc: 7, oracle_text: "Create thirteen tapped 2/2 black Zombie creature tokens." });
const LAND_SCALED_TOKENS = () => make({ name: "Land Bloom", type_line: "Sorcery", mana_cost: "{G}", cmc: 1, oracle_text: "Create a 0/1 green Plant creature token for each land you control." });
const CREATURE_SCALED_TOKENS = () => make({ name: "Brood Bloom", type_line: "Sorcery", mana_cost: "{2}{G}", cmc: 3, oracle_text: "Create a 1/1 green Saproling creature token for each creature you control." });
const FEAR_TOKEN_SPELL = () => make({ name: "Fear Brood", type_line: "Sorcery", mana_cost: "{3}{B}", cmc: 4, oracle_text: "Create a 1/1 black Horror creature token with fear." });
const PLANT_COUNTERS = () => make({ name: "Verdant Rally", type_line: "Sorcery", mana_cost: "{G}", cmc: 1, oracle_text: "Put a +1/+1 counter on each Plant creature you control." });
const CREATURE_COUNTERS = () => make({ name: "Creature Rally", type_line: "Sorcery", mana_cost: "{G}", cmc: 1, oracle_text: "Put a +1/+1 counter on each creature you control." });
const PLANT = () => make({ name: "Plant", type_line: "Creature — Plant", mana_cost: "", cmc: 0, power: "0", toughness: "1" });
const PYROCLASM = () => make({ name: "Pyroclasm", type_line: "Sorcery", mana_cost: "{1}{R}", cmc: 2, oracle_text: "Pyroclasm deals 2 damage to each creature." });
const INFEST = () => make({ name: "Infest", type_line: "Sorcery", mana_cost: "{1}{B}{B}", cmc: 3, oracle_text: "All creatures get -2/-2 until end of turn." });
const GIANT = () => make({ name: "Hill Giant", type_line: "Creature — Giant", mana_cost: "{3}{R}", cmc: 4, power: "3", toughness: "3" });
const EQUIPMENT = () => make({ name: "Test Equipment", type_line: "Artifact — Equipment", mana_cost: "{1}", cmc: 1 });
const BEHEMOTH_SLEDGE = () => make({ name: "Behemoth Sledge", type_line: "Artifact — Equipment", mana_cost: "{3}", cmc: 3, oracle_text: "Equipped creature gets +2/+2 and has trample and lifelink.\nEquip {3}" });
const TYPED_EQUIP_ITEM = () => make({ name: "Test Wizard's Staff", type_line: "Artifact — Equipment", mana_cost: "{2}", cmc: 2, oracle_text: "Equipped creature has prowess.\nIf a triggered ability of equipped creature triggers, that ability triggers an additional time.\nEquip Wizard {1}\nEquip {3}" });
const WIZARD_CREATURE = () => make({ name: "Test Wizard", type_line: "Creature — Human Wizard", mana_cost: "{1}{U}", cmc: 2, power: "1", toughness: "1" });
const SWIFTFOOT_BOOTS = () => make({ name: "Swiftfoot Boots", type_line: "Artifact — Equipment", mana_cost: "{2}", cmc: 2, oracle_text: "Equipped creature has hexproof and haste.\nEquip {1}" });
const SWORD_OF_THE_PARUNS = () => make({ name: "Sword of the Paruns", type_line: "Artifact — Equipment", mana_cost: "{4}", cmc: 4, oracle_text: "Equipped creature gets +2/+0.\n{3}: Untap equipped creature.\n{3}: Untap all other creatures you control.\nEquip {3}" });
const LEVELER = () => make({
  name: "Test Leveler", type_line: "Creature — Human Wizard", mana_cost: "{1}{U}", cmc: 2, power: "1", toughness: "1",
  oracle_text: "Level up {1}{U}\nLEVEL 2-3\n2/3\nHexproof\nLEVEL 4+\n3/4\nFlying"
});
const STEELSHAPERS_GIFT = () => make({ name: "Steelshaper's Gift", type_line: "Sorcery", mana_cost: "{W}", cmc: 1, oracle_text: "Search your library for an Equipment card, reveal it, put it into your hand, then shuffle." });
const EXILE_EQUIPMENT = () => make({ name: "Exile Equipment", type_line: "Instant", mana_cost: "{1}{W}", cmc: 2, oracle_text: "Exile target Equipment." });
const ACIDIC_SLIME = () => make({ name: "Acidic Slime", type_line: "Creature — Ooze", mana_cost: "{3}{G}{G}", cmc: 5, power: "2", toughness: "2", oracle_text: "When Acidic Slime enters, destroy target artifact, enchantment, or land." });
const DEEP_STUDY = () => make({ name: "Deep Study", type_line: "Sorcery", mana_cost: "{1}{U}", cmc: 2, oracle_text: "Target player draws two cards." });
const VISION_SKEINS = () => make({ name: "Vision Skeins", type_line: "Instant", mana_cost: "{1}{U}", cmc: 2, oracle_text: "Each player draws two cards." });
const GRAVE_PURGE = () => make({ name: "Grave Purge", type_line: "Sorcery", mana_cost: "{B}", cmc: 1, oracle_text: "Exile target player's graveyard." });
const BOOMERANG = () => make({ name: "Boomerang", type_line: "Instant", mana_cost: "{U}{U}", cmc: 2, oracle_text: "Return target permanent to its owner's hand." });
const AZORIUS_CHANCERY = () => make({ name: "Azorius Chancery", type_line: "Land", oracle_text: "Azorius Chancery enters tapped.\nWhen Azorius Chancery enters, return a land you control to its owner's hand.\n{T}: Add {W}{U}.", produced_mana: ["W", "U"] });
const AZORIUS_SPELL = () => make({ name: "Azorius Lesson", type_line: "Sorcery", mana_cost: "{W}{U}", cmc: 2, oracle_text: "Draw a card." });
const AZORIUS_RELIC = () => make({ name: "Azorius Relic", type_line: "Artifact", mana_cost: "{2}", cmc: 2, oracle_text: "{T}: Add {W}{U}.", produced_mana: ["W", "U"] });
const SOL_RING = () => make({ name: "Sol Ring", type_line: "Artifact", mana_cost: "{1}", cmc: 1, oracle_text: "{T}: Add {C}{C}.", produced_mana: ["C"] });
const PRISTINE_TALISMAN = () => make({ name: "Pristine Talisman", type_line: "Artifact", mana_cost: "{3}", cmc: 3, oracle_text: "{T}: Add {C}. You gain 1 life.", produced_mana: ["C"] });
// Pain lands / painful talismans: the colored half of the ability is
// automatic damage, distinct from an up-front "Pay 1 life:" activation cost.
const PAIN_LAND = () => make({ name: "Test Pain Land", type_line: "Land", oracle_text: "{T}: Add {C}.\n{T}: Add {U} or {R}. ~ deals 1 damage to you.", produced_mana: ["C", "U", "R"] });
// Ritual spells (Dark Ritual, Channel the Suns): a one-shot mana burst as the
// spell's own effect, not a permanent's activated ability.
const RITUAL = () => make({ name: "Test Dark Ritual", type_line: "Instant", mana_cost: "{B}", cmc: 1, oracle_text: "Add {B}{B}{B}." });
const MIXED_RITUAL = () => make({ name: "Test Channel the Suns", type_line: "Sorcery", mana_cost: "{3}{W}{U}", cmc: 5, oracle_text: "Add {W}{U}{B}{R}{G}." });
// Board-dependent mana (Fellwar Stone): the color set is whatever a land the
// *opponent* controls could produce, recomputed at activation time — not a
// fixed list on the card, and never influenced by the caster's own lands.
const OPPONENT_LANDS_MANA_ROCK = () => make({ name: "Test Fellwar Stone", type_line: "Artifact", mana_cost: "{2}", cmc: 2, oracle_text: "{T}: Add one mana of any color that a land an opponent controls could produce." });
const OWN_LANDS_MANA_DORK = () => make({ name: "Test Harvester Druid", type_line: "Creature — Human Druid", mana_cost: "{1}{G}", cmc: 2, power: "1", toughness: "1", oracle_text: "{T}: Add one mana of any color that a land you control could produce." });
// Fast-mana land (Hidden Lair): the colored half only works fresh off the
// draw or once a basic land is out — a real activation gate, not reminder
// text, distinct from the unconditional {C} half on the same card.
const ENTERED_THIS_TURN_LAND = () => make({ name: "Test Hidden Lair", type_line: "Land", oracle_text: "{T}: Add {C}.\n{T}: Add {U} or {B}. Activate only if this land entered this turn or if you control a basic land." });
const NONCREATURE_CAST_DRAIN = () => make({ name: "Test Mai", type_line: "Creature — Human Warrior", mana_cost: "{1}{B}", cmc: 2, power: "2", toughness: "2", oracle_text: "First strike\nWhenever a player casts a noncreature spell, they lose 2 life." });
const STANDSTILL = () => make({ name: "Test Standstill", type_line: "Enchantment", mana_cost: "{1}{U}", cmc: 2, oracle_text: "When a player casts a spell, sacrifice this enchantment. If you do, each of that player's opponents draws three cards." });
const INSTANT_OR_SORCERY_CAST_DRAW = () => make({ name: "Test Niv-Mizzet Lite", type_line: "Creature — Dragon", mana_cost: "{4}{U}{R}", cmc: 6, power: "3", toughness: "3", oracle_text: "Whenever a player casts an instant or sorcery spell, you draw a card." });
const TEMPLE_OF_FALSE_GOD = () => make({ name: "Temple of the False God", type_line: "Land", oracle_text: "{T}: Add {C}{C}. Activate only if you control five or more lands.", produced_mana: ["C"] });
const VIVID_CREEK = () => make({ name: "Vivid Creek", type_line: "Land", oracle_text: "Vivid Creek enters the battlefield tapped with two charge counters on it.\n{T}: Add {U}.\n{T}, Remove a charge counter from Vivid Creek: Add one mana of any color.", produced_mana: ["U", "W", "B", "R", "G"] });
const VIVID_SPELL = () => make({ name: "Vivid Lesson", type_line: "Sorcery", mana_cost: "{R}", cmc: 1, oracle_text: "Draw a card." });
const ELVES = () => make({ name: "Llanowar Elves", type_line: "Creature — Elf Druid", mana_cost: "{G}", cmc: 1, power: "1", toughness: "1", oracle_text: "{T}: Add {G}.", produced_mana: ["G"] });
const DELTA = () => make({
  name: "Polluted Delta", type_line: "Land",
  oracle_text: "{T}, Pay 1 life, Sacrifice Polluted Delta: Search your library for an Island or Swamp card, put it onto the battlefield, then shuffle."
});
const GHOST_QUARTER = () => make({
  name: "Ghost Quarter", type_line: "Land",
  oracle_text: "{T}: Add {C}.\n{T}, Sacrifice Ghost Quarter: Destroy target land. Its controller may search their library for a basic land card, put it onto the battlefield, then shuffle."
});
const KHER_KEEP = () => make({
  name: "Kher Keep", type_line: "Legendary Land",
  oracle_text: "{T}: Add {C}."
});
const SNOW_FOREST = () => make({
  name: "Snow-Covered Forest", type_line: "Basic Snow Land — Forest", produced_mana: ["G"]
});
const GRAFT_LAND = () => make({
  name: "Llanowar Reborn", type_line: "Land — Forest", oracle_text: "Llanowar Reborn enters the battlefield tapped.\n{T}: Add {G}.\nGraft 1",
  produced_mana: ["G"]
});
const GOBLIN_SHARPSHOOTER = () => make({
  name: "Goblin Sharpshooter", type_line: "Creature — Goblin", mana_cost: "{2}{R}", power: "1", toughness: "1",
  oracle_text: "Whenever a creature dies, untap ~", scryfall_id: "d81285b7-a718-411a-8be3-ecc0cfe0bcb0"
});
const WARSTORM_SURGE = () => make({
  name: "Warstorm Surge", type_line: "Enchantment", mana_cost: "{5}{R}",
  oracle_text: "Whenever a creature you control enters the battlefield, it deals damage equal to its power to any target.",
  scryfall_id: "42fb1a1c-ab3d-4cdc-a6ff-a591f7481583"
});
const WHERE_ANCIENTS_TREAD = () => make({
  name: "Where Ancients Tread", type_line: "Enchantment", mana_cost: "{4}{R}",
  oracle_text: "Whenever a creature you control with power 5 or greater enters the battlefield, you may have ~ deal 5 damage to any target.",
  scryfall_id: "fca2fcab-4f17-448d-bf6d-f6c913159df8"
});
const SPITEFUL_VISIONS = () => make({
  name: "Spiteful Visions", type_line: "Enchantment", mana_cost: "{2}{B}{R}",
  oracle_text: "Whenever a player draws a card, Spiteful Visions deals 1 damage to that player.",
  scryfall_id: "922cf963-2b1b-43ad-819e-6e49133e6aae"
});
const CYCLING_LAND = () => make({
  name: "Barren Moor", type_line: "Land", oracle_text: "This land enters tapped.\n{T}: Add {B}.\nCycling {B} ({B}, Discard this card: Draw a card.)"
});
const WATERY_GRAVE = () => make({
  name: "Watery Grave", type_line: "Land — Island Swamp", oracle_text: "({T}: Add {U} or {B}.)"
});
// A shock land: the `unless-pay-life` entersTapped rule was already fully
// enforced by the engine, but the printed line wasn't credited as covered.
const SHOCK_LAND = () => make({
  name: "Test Steam Vents", type_line: "Land — Island Mountain",
  oracle_text: "({T}: Add {U} or {R}.)\nAs this land enters, you may pay 2 life. If you don't, it enters tapped.",
  produced_mana: ["U", "R"]
});
// Torbran-style static damage amplifier (CR 614.1c): a red source *you
// control* deals that much damage plus 2 to an opponent (or their
// permanents) instead — never to the controller's own side, and never for a
// non-red source.
const DAMAGE_AMPLIFIER = () => make({
  name: "Test Torbran", type_line: "Creature — Dwarf Berserker", mana_cost: "{2}{R}{R}", cmc: 4, power: "2", toughness: "3",
  colors: ["R"], color_identity: ["R"],
  oracle_text: "If a red source you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus 2 instead."
});
const NONCOMBAT_ONLY_AMPLIFIER = () => make({
  name: "Test Hawkeye", type_line: "Creature — Human Archer", mana_cost: "{2}{G}", cmc: 3, power: "3", toughness: "3", keywords: ["Reach"],
  oracle_text: "Reach\nIf a source you control would deal noncombat damage to an opponent or a permanent an opponent controls, instead it deals that much damage plus X, where X is this creature's power."
});
const RED_BOLT = () => make({ name: "Test Red Bolt", type_line: "Instant", mana_cost: "{R}", cmc: 1, colors: ["R"], oracle_text: "~ deals 3 damage to any target." });
const BLUE_BOLT = () => make({ name: "Test Blue Bolt", type_line: "Instant", mana_cost: "{U}", cmc: 1, colors: ["U"], oracle_text: "~ deals 3 damage to any target." });
const ETB_BOLTER = () => make({
  name: "Flame Herald", type_line: "Creature — Dragon", mana_cost: "{3}{R}", cmc: 4, power: "3", toughness: "3",
  oracle_text: "When Flame Herald enters the battlefield, Flame Herald deals 2 damage to any target."
});
const DEATH_DRAIN = () => make({
  name: "Grave Pact Acolyte", type_line: "Creature — Cleric", mana_cost: "{1}{B}", cmc: 2, power: "1", toughness: "1",
  oracle_text: "When Grave Pact Acolyte dies, each opponent loses 2 life."
});
const FELL_SHEPHERD = () => make({
  name: "Fell Shepherd", type_line: "Creature — Demon", mana_cost: "{5}{B}{B}", cmc: 7, power: "8", toughness: "6",
  oracle_text: "Whenever Fell Shepherd deals combat damage to a player, you may return to your hand all creature cards that were put into your graveyard from the battlefield this turn.",
  scryfall_id: "5fd78088-53db-453b-90a3-b8426b0a826e"
});
const STALKING_VENGEANCE = () => make({
  name: "Stalking Vengeance", type_line: "Creature — Avatar", mana_cost: "{6}{R}", cmc: 7, power: "5", toughness: "5",
  keywords: ["Haste"],
  oracle_text: "Haste\nWhenever another creature you control dies, it deals damage equal to its power to target player or planeswalker.",
  scryfall_id: "5f4ff27f-ebc1-4a86-8b0b-eeea470a25fb"
});
const DEEPFIRE_ELEMENTAL = () => make({
  name: "Deepfire Elemental", type_line: "Creature — Elemental", mana_cost: "{4}{R}{R}", cmc: 6, power: "4", toughness: "4",
  oracle_text: "{X}{X}{1}: Destroy target artifact or creature with mana value X.",
  scryfall_id: "c8119ebe-aedd-4bdb-8f7f-368674a049fd"
});
const WATCHER = () => make({
  name: "Mortuary Watcher", type_line: "Creature — Spirit", mana_cost: "{2}{B}", cmc: 3, power: "2", toughness: "2",
  oracle_text: "Whenever another creature you control dies, you gain 1 life."
});
const ANY_DEATH_WATCHER = () => make({
  name: "Blood Chronicler", type_line: "Creature — Vampire", mana_cost: "{2}{B}", cmc: 3, power: "2", toughness: "3",
  oracle_text: "Whenever a creature dies, you gain 1 life."
});
// Blood Artist / Falkenrath Noble: "~ or another creature" restores the
// source itself to the death watch (unlike WATCHER above), and the drain
// targets a chosen player rather than always the controller.
const DRAIN_ARTIST = () => make({
  name: "Vein Reaper", type_line: "Creature — Vampire", mana_cost: "{B}{B}", cmc: 2, power: "0", toughness: "2",
  oracle_text: "Whenever ~ or another creature dies, target player loses 1 life and you gain 1 life."
});
// Partner (CR 702.123) is purely a deck-construction rule already covered by
// createGame's multi-commander support; the printed line carries no state.
const PARTNER_BARE = () => make({
  name: "Twinbond Kin", type_line: "Legendary Creature — Human Scout", mana_cost: "{1}{W}", cmc: 2, power: "2", toughness: "2",
  oracle_text: "Partner (You can have two commanders if both have partner.)"
});
// Partner with <name> (CR 702.124f) is an exact, deterministic library
// search decided by the chosen target, not the controller.
const PARTNER_WITH_SEEKER = () => make({
  name: "Bonded Seeker", type_line: "Legendary Creature — Human Scout", mana_cost: "{1}{G}", cmc: 2, power: "2", toughness: "2",
  oracle_text: "Partner with Bonded Kin (When this creature enters, target player may put Bonded Kin into their hand from their library, then shuffle.)"
});
const PARTNER_WITH_KIN = () => make({
  name: "Bonded Kin", type_line: "Legendary Creature — Human Scout", mana_cost: "{1}{G}", cmc: 2, power: "2", toughness: "2",
  oracle_text: "Partner with Bonded Seeker (When this creature enters, target player may put Bonded Seeker into their hand from their library, then shuffle.)"
});
// Modern errata dropped "under your control" from Essence Warden and Soul
// Warden: the trigger now watches every creature entering, not only the
// controller's own (still excluding the source itself, CR 109.5).
const ANY_ENTER_WARDEN = () => make({
  name: "Bramble Warden", type_line: "Creature — Elf Shaman", mana_cost: "{G}", cmc: 1, power: "1", toughness: "1",
  oracle_text: "Whenever another creature enters, you gain 1 life."
});
const ANY_ENTER_DRAINER = () => make({
  name: "Anurid Sentinel", type_line: "Creature — Zombie", mana_cost: "{1}{B}", cmc: 2, power: "2", toughness: "2",
  oracle_text: "Whenever another creature enters, you lose 1 life."
});
const RAIDER = () => make({
  name: "Bloodthirst Raider", type_line: "Creature — Orc", mana_cost: "{1}{R}", cmc: 2, power: "2", toughness: "2",
  oracle_text: "Whenever Bloodthirst Raider attacks, Bloodthirst Raider deals 1 damage to any target."
});
const MYR_BATTLESPHERE = () => make({
  name: "Myr Battlesphere", type_line: "Artifact Creature — Construct", mana_cost: "{7}", cmc: 7, power: "4", toughness: "7",
  oracle_text: "When this creature enters, create four 1/1 colorless Myr artifact creature tokens.\nWhenever this creature attacks, you may tap X untapped Myr you control. If you do, this creature gets +X/+0 until end of turn and deals X damage to the player or planeswalker it's attacking.",
  scryfall_id: "c53ba31a-ba27-4e17-9a92-311acb1cab29"
});
const MYR_TOKEN = () => make({ name: "Myr", type_line: "Artifact Creature — Myr", power: "1", toughness: "1" });
const CREATURE_COMBAT_DRAWER = () => make({
  name: "Combat Chronicler", type_line: "Creature — Human Wizard", mana_cost: "{2}{U}", cmc: 3, power: "1", toughness: "3",
  oracle_text: "Whenever a creature deals combat damage to a player, draw a card."
});
const DIVINER_SPIRIT = () => make({
  name: "Diviner Spirit", type_line: "Creature — Spirit", mana_cost: "{4}{U}", cmc: 5, power: "2", toughness: "4",
  oracle_text: "Whenever this creature deals combat damage to a player, you and that player each draw that many cards.",
  scryfall_id: "911b8849-dd0a-4383-8403-ea80227c5d7d"
});
const SEKKUAR_DEATHKEEPER = () => make({
  name: "Sek'Kuar, Deathkeeper", type_line: "Legendary Creature — Orc Shaman", mana_cost: "{2}{B}{R}{G}", cmc: 5, power: "4", toughness: "3",
  oracle_text: "Whenever another nontoken creature you control dies, create a 3/1 black and red Graveborn creature token with haste.",
  scryfall_id: "94426127-65c2-435e-ba92-423a3c102061"
});
const CREATURE_CAST_DRAWER = () => make({
  name: "Creature Scholar", type_line: "Creature — Human Wizard", mana_cost: "{2}{U}", cmc: 3, power: "1", toughness: "3",
  oracle_text: "Whenever you cast a creature spell, draw a card."
});
const UPKEEP_SAGE = () => make({
  name: "Dawn Sage", type_line: "Creature — Human Wizard", mana_cost: "{2}{W}", cmc: 3, power: "1", toughness: "3",
  oracle_text: "At the beginning of your upkeep, you gain 2 life."
});
const ECHO_CREATURE = () => make({
  name: "Echo Adept", type_line: "Creature — Wizard", mana_cost: "{1}{G}", cmc: 2, power: "2", toughness: "2",
  oracle_text: "Echo {1}{G}"
});
const SIGNAL_PEST = () => make({
  name: "Well of Lore", type_line: "Artifact", mana_cost: "{2}", cmc: 2,
  oracle_text: "{1}{U}, {T}: Draw a card."
});
const FIREBREATHER = () => make({
  name: "Firecoil Drake", type_line: "Creature — Dragon", mana_cost: "{2}{R}", cmc: 3, power: "2", toughness: "2",
  oracle_text: "{R}: Firecoil Drake gets +1/+0 until end of turn."
});
const HAND_SIZE_CDA_CREATURE = () => make({
  name: "Test Psychosis Crawler", type_line: "Creature — Horror", mana_cost: "{3}{U}", cmc: 4,
  oracle_text: "Test Psychosis Crawler's power and toughness are each equal to the number of cards in your hand.\nWhenever you draw a card, each opponent loses 1 life."
});
const SCRY_SPELL = () => make({ name: "Read the Bones Lite", type_line: "Sorcery", mana_cost: "{U}", cmc: 1, oracle_text: "Scry 3." });
const SCRY_ETB_CREATURE = () => make({ name: "Omen Owl", type_line: "Creature — Bird", mana_cost: "{2}{U}", cmc: 3, power: "1", toughness: "3", oracle_text: "When Omen Owl enters the battlefield, scry 2." });
const SURVEIL_ETB_CREATURE = () => make({ name: "Test Sinister Starfish", type_line: "Creature — Fish", mana_cost: "{2}{U}", cmc: 3, power: "1", toughness: "3", oracle_text: "When this creature enters, surveil 2." });
const SCRY_DRAW_SPELL = () => make({ name: "Read the Bones", type_line: "Sorcery", mana_cost: "{1}{B}", cmc: 2, oracle_text: "Scry 2, then draw two cards. You lose 2 life." });
const COMBAT_SEAR = () => make({ name: "Combat Sear", type_line: "Instant", mana_cost: "{R}", cmc: 1, oracle_text: "Combat Sear deals 3 damage to target attacking or blocking creature." });
const THUNDERSTAFF = () => make({ name: "Thunderstaff", type_line: "Artifact", mana_cost: "{3}", cmc: 3, oracle_text: "As long as Thunderstaff is untapped, if a creature would deal combat damage to you, prevent 1 of that damage.\n{2}, {T}: Attacking creatures get +1/+0 until end of turn." });
const FLAMETONGUE = () => make({ name: "Flametongue Kavu", type_line: "Creature — Kavu", mana_cost: "{3}{R}", cmc: 4, power: "4", toughness: "2", oracle_text: "When Flametongue Kavu enters the battlefield, it deals 4 damage to target creature." });
const WHIPFLARE = () => make({ name: "Whipflare", type_line: "Sorcery", mana_cost: "{1}{R}", cmc: 2, oracle_text: "Whipflare deals 2 damage to each nonartifact creature." });
const LEONIN_BLADETRAP = () => make({ name: "Leonin Bladetrap", type_line: "Artifact", mana_cost: "{3}", cmc: 3, oracle_text: "Flash\n{2}, Sacrifice this artifact: It deals 2 damage to each attacking creature without flying." });
const IRON_BEAR = () => make({ name: "Iron Bear", type_line: "Artifact Creature — Bear", mana_cost: "{3}", cmc: 3, power: "2", toughness: "2" });
const COMMANDER = (name = "Test Commander") => make({ name, type_line: "Legendary Creature — Human Soldier", mana_cost: "{2}{G}", cmc: 3, power: "3", toughness: "3" });
const GREEN_COMMANDER = () => make({ name: "Green Commander", type_line: "Legendary Creature — Human", mana_cost: "{2}{G}", cmc: 3, power: "3", toughness: "3", colors: ["G"], color_identity: ["G"] });
const COMMAND_TOWER = () => make({ name: "Command Tower", type_line: "Land", oracle_text: "{T}: Add one mana of any color in your commander's color identity.", produced_mana: ["W", "U", "B", "R", "G"] });
const OPAL_PALACE = () => make({ name: "Opal Palace", type_line: "Land", oracle_text: "{T}: Add {C}.\n{1}, {T}: Add one mana of any color in your commander's color identity. If you spend this mana to cast your commander, it enters with a number of additional +1/+1 counters on it equal to the number of times it's been cast from the command zone this game.", produced_mana: ["B", "C", "G", "R", "U", "W"], scryfall_id: "912553e7-1e67-4045-84fd-0a791754cf6c" });
const RAKDOS_SIGNET = () => make({ name: "Rakdos Signet", type_line: "Artifact", mana_cost: "{2}", oracle_text: "{1}, {T}: Add {B}{R}." });

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

function threeSeatGame(): GameState {
  return createGame(
    [deck("A", COMMANDER("Alpha Captain"), []), deck("B", COMMANDER("Beta Captain"), []), deck("C", COMMANDER("Gamma Captain"), [])],
    { seed: 7, allowPartialDecks: true }
  );
}

/** Forces the exact board state a test needs without going through the action API. */
function stage(state: GameState, seat: SeatId, update: (player: GameState["players"][number]) => Partial<GameState["players"][number]>): GameState {
  return { ...state, players: state.players.map((player, index) => (index === seat ? { ...player, ...update(player) } : player)) };
}

function putOnBattlefield(state: GameState, seat: SeatId, cards: readonly CardData[], options: { sick?: boolean; tapped?: boolean; entered?: boolean } = {}): GameState {
  const permanents = cards.map((card, index) => ({
    instance_id: `staged-${seat}-${index}-${card.name}-${Math.random().toString(36).slice(2, 8)}`,
    card: { ...card, instance_id: `staged-${seat}-${index}-${card.name}`, owner: seat },
    controller: seat,
    tapped: options.tapped ?? false,
    summoningSick: options.sick ?? false,
    enteredThisTurn: options.entered ?? false,
    damage: 0,
    deathtouched: false,
    counters: Object.fromEntries(profileOf(card).entersWithCounters.map((counter) => [counter.kind, counter.amount])),
    powerModifier: 0,
    toughnessModifier: 0,
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
    const triggerOrder = available.find((entry) => entry.action.type === "choose-trigger-order");
    if (triggerOrder) {
      current = applyAction(current, seat, triggerOrder.action);
      continue;
    }
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

  it("does not auto-pass the human seat by default", () => {
    const human = deck("Human", COMMANDER("Human Captain"), []);
    const bot = { ...deck("Bot", COMMANDER("Bot Captain"), []), kind: "bot" as const };
    const game = createGame([{ ...human, kind: "human" as const }, bot], { seed: 4, allowPartialDecks: true });
    expect(game.players[0]!.kind).toBe("human");
    expect(game.players[0]!.autoPass).toBe(false);
    expect(game.players[1]!.autoPass).toBe(true);
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

  it("keeps the active player's empty main phase as a playable checkpoint", () => {
    let game = twoSeatGame([], []);
    game = { ...game, players: game.players.map((player) => ({ ...player, autoPass: true })) };
    expect(game.step).toBe("precombat-main");
    expect(game.activeSeat).toBe(0);
    expect(game.prioritySeat).toBe(0);
    expect(game.turn).toBe(1);
  });

  it("does not skip the rest of the active turn after playing the only land", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ hand: toHand(0, [FOREST()], "checkpoint-forest"), autoPass: true }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    game = applyAction(game, 0, { type: "play-land", cardId: "checkpoint-forest-0" });
    expect(game.turn).toBe(1);
    expect(game.step).toBe("precombat-main");
    expect(game.prioritySeat).toBe(0);
  });

  it("asks before a shock land pays 2 life or enters tapped", () => {
    const profile = profileOf(SHOCK_LAND());
    expect(profile.entersTapped).toEqual({ kind: "unless-pay-life", life: 2 });
    expect(profile.fullyImplemented).toBe(true);

    let flush = twoSeatGame([], []);
    flush = stage(flush, 0, () => ({ hand: toHand(0, [SHOCK_LAND()], "shock-flush") }));
    flush = passUntil(flush, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const before = flush.players[0]!.life;
    flush = applyAction(flush, 0, { type: "play-land", cardId: "shock-flush-0" });
    const flushLand = flush.players[0]!.battlefield.find((permanent) => permanent.card.name === "Test Steam Vents")!;
    expect(flush.pendingChoice).toMatchObject({ type: "land-entry", life: 2, sourceId: flushLand.instance_id });
    expect(flushLand.tapped).toBe(true);
    expect(flush.players[0]!.life).toBe(before);
    expect(legalActions(flush, 0).map((entry) => entry.action)).toEqual([
      { type: "choose-land-entry", sourceId: flushLand.instance_id, payLife: true },
      { type: "choose-land-entry", sourceId: flushLand.instance_id, payLife: false }
    ]);
    flush = applyAction(flush, 0, { type: "choose-land-entry", sourceId: flushLand.instance_id, payLife: true });
    expect(flush.players[0]!.battlefield.find((permanent) => permanent.instance_id === flushLand.instance_id)!.tapped).toBe(false);
    expect(flush.players[0]!.life).toBe(before - 2);

    // At low life, the same choice protects it and the land enters tapped instead.
    let poor = twoSeatGame([], []);
    poor = stage(poor, 0, () => ({ hand: toHand(0, [SHOCK_LAND()], "shock-poor"), life: 2 }));
    poor = passUntil(poor, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    poor = applyAction(poor, 0, { type: "play-land", cardId: "shock-poor-0" });
    const poorLand = poor.players[0]!.battlefield.find((permanent) => permanent.card.name === "Test Steam Vents")!;
    expect(legalActions(poor, 0).map((entry) => entry.action)).toEqual([
      { type: "choose-land-entry", sourceId: poorLand.instance_id, payLife: false }
    ]);
    poor = applyAction(poor, 0, { type: "choose-land-entry", sourceId: poorLand.instance_id, payLife: false });
    expect(poorLand.tapped).toBe(true);
    expect(poor.players[0]!.life).toBe(2);
  });

  it("skips the opening draw only for the starting player", () => {
    const game = twoSeatGame([], []);
    expect(game.players[0]!.hand).toHaveLength(7);
    const secondTurn = passUntil(game, (state) => state.activeSeat === 1 && state.step === "precombat-main");
    expect(secondTurn.players[1]!.hand).toHaveLength(8);
  });

  it("tracks each player's personal turn count independent of the global turn", () => {
    let game = twoSeatGame([], []);
    expect(game.players.map((player) => player.turnsTaken)).toEqual([1, 0]);
    expect(projectGame(game, 0).players.map((player) => player.turnsTaken)).toEqual([1, 0]);

    game = passUntil(game, (state) => state.activeSeat === 1 && state.step === "precombat-main");
    expect(game.players.map((player) => player.turnsTaken)).toEqual([1, 1]);

    game = passUntil(game, (state) => state.turn === 3 && state.activeSeat === 0 && state.step === "precombat-main");
    expect(game.players.map((player) => player.turnsTaken)).toEqual([2, 1]);
    expect(projectGame(game, 0).players[0]!.turnsTaken).toBe(2);
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

  it("keeps Starting Town untapped through turn three and taps it from turn four", () => {
    const playAtTurn = (turn: number, prefix: string) => {
      let game = twoSeatGame([], []);
      game = stage(game, 0, () => ({ hand: toHand(0, [STARTING_TOWN()], prefix), autoPass: false }));
      game = { ...game, turn, step: "precombat-main", activeSeat: 0, prioritySeat: 0, priorityOpen: true };
      return applyAction(game, 0, { type: "play-land", cardId: `${prefix}-0` });
    };
    expect(playAtTurn(1, "starting-town-1").players[0]!.battlefield[0]!.tapped).toBe(false);
    expect(playAtTurn(3, "starting-town-3").players[0]!.battlefield[0]!.tapped).toBe(false);
    expect(playAtTurn(4, "starting-town-4").players[0]!.battlefield[0]!.tapped).toBe(true);
  });

  it("asks whether to reveal a matching land before Frostboil Snarl enters", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ hand: toHand(0, [FROSTBOIL(), ISLAND(), FOREST()], "hand-frostboil") }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);

    game = applyAction(game, 0, { type: "play-land", cardId: "hand-frostboil-0" });
    expect(game.pendingChoice).toMatchObject({ type: "reveal-card", stage: "confirm", seat: 0 });
    expect(pendingSeat(game)).toBe(0);
    expect(legalActions(game, 0).map((entry) => entry.label)).toEqual(["No, entra girada", "Sí, revelar una carta"]);

    game = applyAction(game, 0, { type: "choose-reveal", sourceId: "hand-frostboil-0", reveal: true });
    const choices = legalActions(game, 0).filter((entry) => entry.action.type === "choose-reveal");
    expect(choices).toHaveLength(1);
    expect(choices[0]!.cardId).toBe("hand-frostboil-1");

    game = applyAction(game, 0, choices[0]!.action);
    expect(game.pendingChoice).toBeNull();
    expect(game.players[0]!.hand.some((card) => card.instance_id === "hand-frostboil-1")).toBe(true);
    expect(game.players[0]!.battlefield.find((permanent) => permanent.instance_id === "hand-frostboil-0")!.tapped).toBe(false);
  });

  it("credits Frostboil Snarl's printed text as covered, not just its enforced behavior", () => {
    // `unless-reveal-card` was already fully enforced (see the two tests
    // above); the printed line simply wasn't consumed by the per-line
    // coverage check, so the whole check-land cycle stayed
    // `fullyImplemented: false` despite playing correctly.
    const profile = profileOf(FROSTBOIL());
    expect(profile.entersTapped).toEqual({ kind: "unless-reveal-card", subtypes: ["Island", "Mountain"] });
    expect(profile.fullyImplemented).toBe(true);
  });

  it("keeps Frostboil Snarl tapped when the controller declines", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ hand: toHand(0, [FROSTBOIL(), ISLAND()], "hand-frostboil-no") }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    game = applyAction(game, 0, { type: "play-land", cardId: "hand-frostboil-no-0" });
    game = applyAction(game, 0, { type: "choose-reveal", sourceId: "hand-frostboil-no-0", reveal: false });
    expect(game.pendingChoice).toBeNull();
    expect(game.players[0]!.battlefield.find((permanent) => permanent.instance_id === "hand-frostboil-no-0")!.tapped).toBe(true);
  });
});

describe("mana payment", () => {
  it("asks which non-interchangeable source pays Rakdos Signet, then activates it", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ kind: "human" }));
    game = putOnBattlefield(game, 0, [MOUNTAIN(), FOREST(), RAKDOS_SIGNET()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const signet = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Rakdos Signet")!;
    const action = legalActions(game, 0).find((entry) => entry.action.type === "activate-mana" && entry.action.sourceId === signet.instance_id)!;
    game = applyAction(game, 0, action.action);
    expect(game.pendingChoice?.type).toBe("mana-payment");
    const sources = legalActions(game, 0).filter((entry) => entry.action.type === "choose-mana-source");
    expect(sources.map((entry) => entry.label).join(" ")).toContain("Mountain");
    expect(sources.map((entry) => entry.label).join(" ")).toContain("Forest");
    const forest = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Forest")!;
    const forestChoice = sources.find((entry) => entry.action.type === "choose-mana-source" && entry.action.manaSourceId === forest.instance_id)!;
    game = applyAction(game, 0, forestChoice.action);
    expect(game.pendingChoice).toBeNull();
    expect(game.players[0]!.manaPool).toMatchObject({ B: 1, R: 1 });
    expect(game.players[0]!.battlefield.find((permanent) => permanent.instance_id === signet.instance_id)!.tapped).toBe(true);
  });

  it("asks for each source when casting a colored spell, preserving the hand action", () => {
    const spell = make({ name: "Red Test Spell", type_line: "Creature — Goblin", mana_cost: "{1}{R}", power: "2", toughness: "2" });
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ kind: "human" }));
    game = stage(game, 0, () => ({ hand: toHand(0, [spell], "manual-cast") }));
    game = putOnBattlefield(game, 0, [MOUNTAIN(), FOREST()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const cast = legalActions(game, 0).find((entry) => entry.action.type === "cast" && entry.cardId === "manual-cast-0")!;
    game = applyAction(game, 0, cast.action);
    expect(game.pendingChoice?.type).toBe("mana-payment");
    const mountain = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Mountain")!;
    const forest = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Forest")!;
    const red = legalActions(game, 0).find((entry) => entry.action.type === "choose-mana-source" && entry.action.manaSourceId === mountain.instance_id && entry.action.mana === "R")!;
    game = applyAction(game, 0, red.action);
    expect(game.pendingChoice?.type).toBe("mana-payment");
    const generic = legalActions(game, 0).find((entry) => entry.action.type === "choose-mana-source" && entry.action.manaSourceId === forest.instance_id)!;
    game = applyAction(game, 0, generic.action);
    expect(game.pendingChoice).toBeNull();
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Red Test Spell")).toBe(true);
  });

  it("returns to a clean, recastable state when the mana payment is cancelled", () => {
    const spell = make({ name: "Red Test Spell", type_line: "Creature — Goblin", mana_cost: "{1}{R}", power: "2", toughness: "2" });
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ kind: "human" }));
    game = stage(game, 0, () => ({ hand: toHand(0, [spell], "manual-cast") }));
    game = putOnBattlefield(game, 0, [MOUNTAIN(), FOREST()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);

    const cast = legalActions(game, 0).find((entry) => entry.action.type === "cast" && entry.cardId === "manual-cast-0")!;
    game = applyAction(game, 0, cast.action);
    expect(game.pendingChoice?.type).toBe("mana-payment");

    // Select one source, then bail out of the whole payment.
    const mountain = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Mountain")!;
    const red = legalActions(game, 0).find((entry) => entry.action.type === "choose-mana-source" && entry.action.manaSourceId === mountain.instance_id && entry.action.mana === "R")!;
    game = applyAction(game, 0, red.action);
    game = applyAction(game, 0, { type: "cancel-mana-payment", sourceId: game.pendingChoice!.sourceId });

    // Clean state: no pending choice, spell still in hand, nothing tapped, no
    // floating mana, priority still with the caster, and the cast is offered again.
    expect(game.pendingChoice).toBeNull();
    expect(game.stack).toHaveLength(0);
    expect(game.players[0]!.hand.some((card) => card.instance_id === "manual-cast-0")).toBe(true);
    expect(game.players[0]!.battlefield.every((permanent) => !permanent.tapped)).toBe(true);
    expect(game.players[0]!.manaPool).toMatchObject({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
    expect(game.priorityOpen).toBe(true);
    expect(game.prioritySeat).toBe(0);
    expect(legalActions(game, 0).some((entry) => entry.action.type === "cast" && entry.cardId === "manual-cast-0")).toBe(true);

    // And it can actually be recast to completion.
    game = applyAction(game, 0, cast.action);
    const forest = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Forest")!;
    game = applyAction(game, 0, legalActions(game, 0).find((entry) => entry.action.type === "choose-mana-source" && entry.action.manaSourceId === mountain.instance_id && entry.action.mana === "R")!.action);
    game = applyAction(game, 0, legalActions(game, 0).find((entry) => entry.action.type === "choose-mana-source" && entry.action.manaSourceId === forest.instance_id)!.action);
    expect(game.pendingChoice).toBeNull();
    expect(game.stack.some((object) => object.card.name === "Red Test Spell") || game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Red Test Spell")).toBe(true);
  });

  it("keeps five independent primitives executable in the same card batch", () => {
    expect(profileOf(PRISTINE_TALISMAN()).fullyImplemented).toBe(true);
    expect(profileOf(PRISTINE_TALISMAN()).manaAbilities[0]).toMatchObject({ gainLife: 1 });
    expect(profileOf(TEMPLE_OF_FALSE_GOD()).fullyImplemented).toBe(true);
    expect(profileOf(TEMPLE_OF_FALSE_GOD()).manaAbilities[0]).toMatchObject({ requiresLands: 5 });

    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [PRISTINE_TALISMAN()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const talisman = game.players[0]!.battlefield[0]!;
    game = applyAction(game, 0, { type: "activate-mana", sourceId: talisman.instance_id, abilityIndex: 0, mana: "C" });
    expect(game.players[0]!.life).toBe(41);
    expect(game.players[0]!.manaPool.C).toBe(1);

    game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [TEMPLE_OF_FALSE_GOD(), FOREST(), FOREST(), FOREST()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    expect(legalActions(game, 0).some((entry) => entry.action.type === "activate-mana" && entry.cardId === game.players[0]!.battlefield[0]!.instance_id)).toBe(false);
    game = putOnBattlefield(game, 0, [FOREST()]);
    const temple = game.players[0]!.battlefield[0]!;
    expect(legalActions(game, 0).some((entry) => entry.action.type === "activate-mana" && entry.cardId === temple.instance_id)).toBe(true);
  });

  it("pays 1 life when a pain land is tapped for colored mana, but not for colorless", () => {
    const profile = profileOf(PAIN_LAND());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.manaAbilities[0]).toMatchObject({ produces: ["C"], lifeCost: 0 });
    expect(profile.manaAbilities[1]).toMatchObject({ produces: ["U", "R"], lifeCost: 1 });

    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [PAIN_LAND()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const land = game.players[0]!.battlefield[0]!;
    const before = game.players[0]!.life;
    game = applyAction(game, 0, { type: "activate-mana", sourceId: land.instance_id, abilityIndex: 1, mana: "R" });
    expect(game.players[0]!.life).toBe(before - 1);
    expect(game.players[0]!.manaPool.R).toBe(1);
  });

  it("keeps Delighted Halfling mana restricted and makes the eligible spell uncounterable", () => {
    const halfling = make({
      name: "Delighted Halfling", type_line: "Creature — Halfling", power: "1", toughness: "2",
      oracle_text: "{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast a legendary spell, and that spell can't be countered.",
      produced_mana: ["B", "C", "G", "R", "U", "W"]
    });
    const ordinary = make({ name: "Ordinary Spell", type_line: "Creature — Elf", mana_cost: "{G}", cmc: 1, power: "1", toughness: "1" });
    const legendary = make({ name: "Legendary Spell", type_line: "Legendary Creature — Elf", mana_cost: "{G}", cmc: 1, power: "1", toughness: "1" });

    let blocked = twoSeatGame([], []);
    blocked = stage(blocked, 0, () => ({ hand: toHand(0, [ordinary]), autoPass: false }));
    blocked = putOnBattlefield(blocked, 0, [halfling]);
    blocked = passUntil(blocked, (state) => state.step === "precombat-main" && state.prioritySeat === 0);
    const source = blocked.players[0]!.battlefield.find((permanent) => permanent.card.name === halfling.name)!;
    const restrictedAction = legalActions(blocked, 0).find((entry) => entry.action.type === "activate-mana"
      && entry.action.sourceId === source.instance_id && entry.action.abilityIndex === 1 && entry.action.mana === "G")!;
    blocked = applyAction(blocked, 0, restrictedAction.action);
    expect(blocked.players[0]!.restrictedMana).toMatchObject([{ type: "G", restriction: { kind: "legendary-spell", makesSpellUncounterable: true } }]);
    expect(legalActions(blocked, 0).some((entry) => entry.action.type === "cast" && entry.action.cardId === "hand-0")).toBe(false);

    let allowed = twoSeatGame([], []);
    allowed = stage(allowed, 0, () => ({ hand: toHand(0, [legendary]), autoPass: false }));
    allowed = stage(allowed, 1, () => ({ autoPass: false }));
    allowed = putOnBattlefield(allowed, 0, [halfling]);
    allowed = passUntil(allowed, (state) => state.step === "precombat-main" && state.prioritySeat === 0);
    const allowedSource = allowed.players[0]!.battlefield.find((permanent) => permanent.card.name === halfling.name)!;
    const cast = legalActions(allowed, 0).find((entry) => entry.action.type === "cast" && entry.action.cardId === "hand-0")!;
    expect(cast).toBeDefined();
    allowed = applyAction(allowed, 0, cast.action);
    expect(allowed.players[0]!.battlefield.find((permanent) => permanent.instance_id === allowedSource.instance_id)?.tapped).toBe(true);
    const spell = allowed.stack.find((entry) => entry.card.name === legendary.name)!;
    expect(spell.cantBeCountered).toBe(true);
    expect(canCounterSpell(spell, allowed)).toBe(false);
  });

  it("auto-passes an Equipment activation when no creature can be equipped", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [BEHEMOTH_SLEDGE(), ISLAND()]);
    game = stage(game, 0, () => ({ hand: [] }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    expect(legalActions(game, 0).some((entry) => entry.action.type === "equip")).toBe(false);
    expect(hasRealChoice(game, 0)).toBe(false);
  });

  it("adds a fixed mana pool from a ritual spell, including a mix of distinct colors", () => {
    const profile = profileOf(RITUAL());
    expect(profile.effects).toEqual([{ kind: "add-mana", pool: { B: 3 } }]);
    expect(profile.fullyImplemented).toBe(true);
    const mixedProfile = profileOf(MIXED_RITUAL());
    expect(mixedProfile.effects).toEqual([{ kind: "add-mana", pool: { W: 1, U: 1, B: 1, R: 1, G: 1 } }]);
    expect(mixedProfile.fullyImplemented).toBe(true);

    // Casting the ritual spends the Swamp's own {B} on its cost, then the
    // spell's own effect adds three fresh black mana to the now-empty pool.
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [SWAMP()]);
    game = stage(game, 0, () => ({ hand: toHand(0, [RITUAL()]) }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.players[0]!.manaPool.B).toBe(3);
  });

  it("computes an opponent-lands mana rock's colors from the battlefield, never the caster's own lands", () => {
    const rockProfile = profileOf(OPPONENT_LANDS_MANA_ROCK());
    expect(rockProfile.manaAbilities[0]).toMatchObject({ anyColorFromLandsControlledBy: "opponent" });
    expect(rockProfile.fullyImplemented).toBe(true);
    const dorkProfile = profileOf(OWN_LANDS_MANA_DORK());
    expect(dorkProfile.manaAbilities[0]).toMatchObject({ anyColorFromLandsControlledBy: "you" });
    expect(dorkProfile.fullyImplemented).toBe(true);

    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [OPPONENT_LANDS_MANA_ROCK(), PLAINS()]);
    game = putOnBattlefield(game, 1, [MOUNTAIN(), FOREST()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const rock = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Test Fellwar Stone")!;
    const options = manaSources(game.players[0]!, game).find((source) => source.permanentId === rock.instance_id)!.options;
    expect([...options].sort()).toEqual(["G", "R"]);
    game = applyAction(game, 0, { type: "activate-mana", sourceId: rock.instance_id, abilityIndex: 0, mana: "R" });
    expect(game.players[0]!.manaPool.R).toBe(1);
  });

  it("gates a land's colored mana to the turn it entered, or once a basic land is out", () => {
    const profile = profileOf(ENTERED_THIS_TURN_LAND());
    expect(profile.manaAbilities[0]).toMatchObject({ produces: ["C"] });
    expect(profile.manaAbilities[1]).toMatchObject({
      produces: ["U", "B"],
      activationRestriction: { enteredThisTurn: true, orControlsBasicLand: true }
    });
    expect(profile.fullyImplemented).toBe(true);

    // Fresh off the draw: the colored ability is available the same turn.
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ hand: toHand(0, [ENTERED_THIS_TURN_LAND()], "hand-lair") }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    game = applyAction(game, 0, { type: "play-land", cardId: "hand-lair-0" });
    const land = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Test Hidden Lair")!;
    expect(legalActions(game, 0).some((entry) => entry.action.type === "activate-mana" && entry.cardId === land.instance_id && entry.action.mana !== "C")).toBe(true);

    // One full round later, with no basic land out, the colored half shuts off.
    const enteredTurn = game.turn;
    game = passUntil(game, (state) => state.turn > enteredTurn && state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    expect(legalActions(game, 0).some((entry) => entry.action.type === "activate-mana" && entry.cardId === land.instance_id && entry.action.mana !== "C")).toBe(false);
    expect(legalActions(game, 0).some((entry) => entry.action.type === "activate-mana" && entry.cardId === land.instance_id && entry.action.mana === "C")).toBe(true);

    // Controlling a basic land reopens it even on a later turn.
    game = putOnBattlefield(game, 0, [FOREST()]);
    expect(legalActions(game, 0).some((entry) => entry.action.type === "activate-mana" && entry.cardId === land.instance_id && entry.action.mana !== "C")).toBe(true);
  });

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
  it("asks the spell controller to pay Ward and counters when unpaid", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ hand: toHand(0, [WARD_BOLT()]), manaPool: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 }, autoPass: false }));
    game = stage(game, 1, () => ({ autoPass: false }));
    game = putOnBattlefield(game, 1, [WARD_SENTINEL()]);
    game = { ...game, step: "precombat-main", activeSeat: 0, prioritySeat: 0, priorityOpen: true, passedSeats: [] };
    const ward = game.players[1]!.battlefield[0]!;
    game = applyAction(game, 0, { type: "cast", cardId: game.players[0]!.hand[0]!.instance_id, targets: [{ kind: "permanent", instanceId: ward.instance_id }] });
    expect(game.pendingChoice?.type).toBe("optional-trigger");
    expect(game.pendingChoice?.seat).toBe(0);
    const choice = game.pendingChoice!;
    game = applyAction(game, 0, { type: "choose-trigger", sourceId: choice.sourceId, accept: false });
    expect(game.stack.at(-1)?.countered).toBe(true);
  });

  it("keeps a spell targeting Ward when its controller pays the tax", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ hand: toHand(0, [WARD_BOLT()]), manaPool: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 2 }, autoPass: false }));
    game = stage(game, 1, () => ({ autoPass: false }));
    game = putOnBattlefield(game, 1, [WARD_SENTINEL()]);
    game = { ...game, step: "precombat-main", activeSeat: 0, prioritySeat: 0, priorityOpen: true, passedSeats: [] };
    const ward = game.players[1]!.battlefield[0]!;
    game = applyAction(game, 0, { type: "cast", cardId: game.players[0]!.hand[0]!.instance_id, targets: [{ kind: "permanent", instanceId: ward.instance_id }] });
    const choice = game.pendingChoice!;
    game = applyAction(game, 0, { type: "choose-trigger", sourceId: choice.sourceId, accept: true });
    expect(game.pendingChoice).toBeNull();
    expect(game.stack.at(-1)?.countered).toBe(false);
    expect(game.players[0]!.manaPool.C).toBe(0);
  });

  it("chains Ward payments for multiple Ward permanents targeted by one spell", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ hand: toHand(0, [WARD_BOLT()]), manaPool: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 4 }, autoPass: false }));
    game = stage(game, 1, () => ({ autoPass: false }));
    game = putOnBattlefield(game, 1, [WARD_SENTINEL(), WARD_SENTINEL()]);
    game = { ...game, step: "precombat-main", activeSeat: 0, prioritySeat: 0, priorityOpen: true, passedSeats: [] };
    const wards = game.players[1]!.battlefield;
    game = applyAction(game, 0, {
      type: "cast",
      cardId: game.players[0]!.hand[0]!.instance_id,
      targets: wards.map((ward) => ({ kind: "permanent", instanceId: ward.instance_id }))
    });
    expect(game.pendingChoice?.type).toBe("optional-trigger");
    const first = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "optional-trigger" }>;
    expect(first.remainingWardTargets).toHaveLength(1);
    game = applyAction(game, 0, { type: "choose-trigger", sourceId: first.sourceId, accept: true });
    expect(game.pendingChoice?.type).toBe("optional-trigger");
    const second = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "optional-trigger" }>;
    expect(second.sourceId).not.toBe(first.sourceId);
    game = applyAction(game, 0, { type: "choose-trigger", sourceId: second.sourceId, accept: true });
    expect(game.pendingChoice).toBeNull();
    expect(game.stack.at(-1)?.countered).toBe(false);
    expect(game.players[0]!.manaPool.C).toBe(0);
  });
  function readyToCast(cards: readonly CardData[], battlefield: readonly CardData[], opponentHand: readonly CardData[] = [], opponentBoard: readonly CardData[] = []) {
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

  it("recognizes and resolves Proliferate for selected permanents and players", () => {
    const proliferate = make({ name: "Test Proliferate", type_line: "Sorcery", mana_cost: "{2}{G}", cmc: 3, oracle_text: "Proliferate." });
    expect(profileOf(proliferate)).toMatchObject({ effects: [{ kind: "proliferate" }], fullyImplemented: true });
    let game = readyToCast([proliferate], [FOREST(), FOREST(), FOREST(), BEAR()]);
    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    game = stage(game, 0, (player) => ({
      counters: { poison: 1 },
      battlefield: player.battlefield.map((permanent) => permanent.instance_id === bear.instance_id
        ? { ...permanent, counters: { "+1/+1": 2, "level": 1 } }
        : permanent)
    }));
    game = stage(game, 1, (player) => ({ counters: { energy: 2 } }));
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.pendingChoice).toMatchObject({ type: "proliferate", seat: 0 });
    const sourceId = game.pendingChoice!.sourceId;
    const targetActions = legalActions(game, 0).filter((entry) => entry.action.type === "choose-proliferate-target");
    expect(targetActions).toHaveLength(3);
    const bearTarget = targetActions.find((entry) => entry.action.type === "choose-proliferate-target" && entry.action.target.kind === "permanent" && entry.action.target.instanceId === bear.instance_id)!;
    game = applyAction(game, 0, bearTarget.action);
    const playerTarget = legalActions(game, 0).find((entry) => entry.action.type === "choose-proliferate-target" && entry.action.target.kind === "player" && entry.action.target.seat === 1)!;
    game = applyAction(game, 0, playerTarget.action);
    game = applyAction(game, 0, { type: "finish-proliferate", sourceId });
    const updatedBear = game.players[0]!.battlefield.find((permanent) => permanent.instance_id === bear.instance_id)!;
    expect(updatedBear.counters).toEqual({ "+1/+1": 3, level: 2 });
    expect(game.players[0]!.counters).toEqual({ poison: 1 });
    expect(game.players[1]!.counters).toEqual({ energy: 3 });
  });

  it("draws two cards then offers Proliferate for Tezzeret's Gambit", () => {
    const gambit = make({ name: "Tezzeret's Gambit", type_line: "Sorcery", mana_cost: "{2}{U}", cmc: 3, oracle_text: "Draw two cards, then proliferate." });
    expect(profileOf(gambit)).toMatchObject({
      fullyImplemented: true,
      effects: [{ kind: "compound", effects: [{ kind: "draw", amount: 2 }, { kind: "proliferate" }] }]
    });
    let game = readyToCast([gambit], [ISLAND(), FOREST(), FOREST()]);
    game = putOnBattlefield(game, 0, [BEAR()]);
    game = stage(game, 0, (player) => ({
      battlefield: player.battlefield.map((permanent) => permanent.card.name === "Grizzly Bears"
        ? { ...permanent, counters: { "+1/+1": 1 } } : permanent)
    }));
    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    const handBefore = game.players[0]!.hand.length;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.players[0]!.hand.length).toBe(handBefore - 1 + 2);
    expect(game.pendingChoice).toMatchObject({ type: "proliferate", seat: 0 });
    const sourceId = game.pendingChoice!.sourceId;
    const target = legalActions(game, 0).find((entry) => entry.action.type === "choose-proliferate-target"
      && entry.action.target.kind === "permanent" && entry.action.target.instanceId === bear.instance_id)!;
    game = applyAction(game, 0, target.action);
    game = applyAction(game, 0, { type: "finish-proliferate", sourceId });
    const boostedBear = game.players[0]!.battlefield.find((permanent) => permanent.instance_id === bear.instance_id)!;
    expect(boostedBear.counters["+1/+1"]).toBe(2);
  });

  it("preserves Azorius Herald when blue mana was spent to cast it", () => {
    const herald = C13_AZORIUS_HERALD();
    let game = readyToCast([herald], [PLAINS(), ISLAND(), ISLAND()]);
    expect(profileOf(herald)).toMatchObject({ fullyImplemented: true });
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Azorius Herald")).toBe(true);
    expect(game.players[0]!.life).toBe(44);
  });

  it("adds Naya Soulbeast counters from the revealed top cards", () => {
    const soulbeast = C13_NAYA_SOULBEAST();
    let game = readyToCast([soulbeast], Array.from({ length: 8 }, () => FOREST()));
    game = stage(game, 0, (player) => ({ autoPass: false, library: toHand(0, [BEAR()], "naya-a") }));
    game = stage(game, 1, (player) => ({ autoPass: false, library: toHand(1, [BOLT()], "naya-b") }));
    expect(profileOf(soulbeast)).toMatchObject({ fullyImplemented: true, triggers: [{ effect: { kind: "reveal-top-cards-and-add-source-counters" } }] });
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = passUntil(game, (state) => state.players[0]!.battlefield.some((permanent) => permanent.card.name === "Naya Soulbeast"));
    const permanent = game.players[0]!.battlefield.find((candidate) => candidate.card.name === "Naya Soulbeast")!;
    expect(permanent.counters["+1/+1"]).toBe(3);
    expect(game.players[0]!.library[0]!.name).toBe("Grizzly Bears");
    expect(game.players[1]!.library[0]!.name).toBe("Lightning Bolt");
  });

  it("creates Prossh's Kobolds from the mana actually spent to cast it", () => {
    const prossh = C13_PROSSH();
    let game = readyToCast([prossh], [SWAMP(), MOUNTAIN(), FOREST(), FOREST(), MOUNTAIN(), SWAMP()]);
    expect(profileOf(prossh)).toMatchObject({ fullyImplemented: true });
    expect(profileOf(prossh).triggers[0]?.effect).toMatchObject({ kind: "create-token", amount: "mana-spent" });
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = passUntil(game, (state) => state.pendingChoice === null && state.stack.length === 0);
    expect(game.players[0]!.battlefield.filter((permanent) => permanent.card.name === "Kobolds of Kher Keep")).toHaveLength(6);
  });

  it("chooses a color and returns matching permanents to their owners' hands", () => {
    let game = readyToCast([WASH_OUT()], [ISLAND(), FOREST(), FOREST(), FOREST()], [], [BLUE_PERMANENT(), RED_PERMANENT(), COLORLESS_PERMANENT()]);
    game = { ...game, players: game.players.map((player) => ({ ...player, autoPass: false })) };
    const wash = game.players[0]!.hand.find((card) => card.name === "Wash Out")!;
    expect(profileOf(WASH_OUT())).toMatchObject({
      effects: [{ kind: "return-all-permanents-of-color", color: "chosen" }],
      fullyImplemented: true
    });
    game = applyAction(game, 0, { type: "cast", cardId: wash.instance_id });
    game = passUntil(game, (state) => state.pendingChoice?.type === "choose-color");
    expect(game.pendingChoice).toMatchObject({ type: "choose-color", sourceCard: { name: "Wash Out" } });
    const choice = game.pendingChoice!;
    expect(legalActions(game, 0).filter((entry) => entry.action.type === "choose-color")).toHaveLength(5);
    game = applyAction(game, 0, { type: "choose-color", sourceId: choice.sourceId, color: "U" });
    expect(game.players[1]!.battlefield.some((permanent) => permanent.card.name === "Blue Permanent")).toBe(false);
    expect(game.players[1]!.hand.some((card) => card.name === "Blue Permanent")).toBe(true);
    expect(game.players[1]!.battlefield.some((permanent) => permanent.card.name === "Red Permanent")).toBe(true);
    expect(game.players[1]!.battlefield.some((permanent) => permanent.card.name === "Colorless Permanent")).toBe(true);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Wash Out")).toBe(true);
  });

  it("chooses a color before Sudden Demise damages only matching creatures", () => {
    const profile = profileOf(C13_SUDDEN_DEMISE());
    expect(profile).toMatchObject({
      effects: [{ kind: "damage-all-creatures-of-color", amount: "X", color: "chosen" }],
      fullyImplemented: true
    });
    let game = readyToCast([C13_SUDDEN_DEMISE()], [MOUNTAIN(), MOUNTAIN(), MOUNTAIN(), MOUNTAIN()], [], [RED_RAIDER(), BLACK_BLOCKER()]);
    game = { ...game, players: game.players.map((player) => ({ ...player, autoPass: false })) };
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", variableValue: 3 });
    game = passUntil(game, (state) => state.pendingChoice?.type === "choose-color");
    expect(game.pendingChoice).toMatchObject({ type: "choose-color", sourceCard: { name: "Sudden Demise" } });
    const choice = game.pendingChoice!;
    game = applyAction(game, 0, { type: "choose-color", sourceId: choice.sourceId, color: "R" });
    game = passUntil(game, (state) => state.pendingChoice === null && state.stack.length === 0);
    expect(game.players[1]!.battlefield.some((permanent) => permanent.card.name === "Red Raider")).toBe(false);
    expect(game.players[1]!.battlefield.some((permanent) => permanent.card.name === "Dusk Bat")).toBe(true);
  });

  it("moves a Graft counter to the next creature that enters", () => {
    const land = GRAFT_LAND();
    let game = readyToCast([BEAR()], [land, FOREST()]);
    const graft = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Llanowar Reborn")!;
    expect(graft.counters["+1/+1"]).toBe(1);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.pendingChoice).toMatchObject({ type: "optional-trigger", sourceCard: { name: "Llanowar Reborn" } });
    const choice = game.pendingChoice!;
    game = applyAction(game, 0, { type: "choose-trigger", sourceId: choice.sourceId, accept: true });
    const movedLand = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Llanowar Reborn")!;
    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    expect(movedLand.counters["+1/+1"]).toBe(0);
    expect(bear.counters["+1/+1"]).toBe(1);
  });

  it("untaps Goblin Sharpshooter whenever a creature dies", () => {
    let game = readyToCast([DESTROY_TARGET_CREATURE()], [MOUNTAIN(), SWAMP(), MOUNTAIN()], [], [BEAR()]);
    game = putOnBattlefield(game, 0, [GOBLIN_SHARPSHOOTER()]);
    const shooter = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Goblin Sharpshooter")!;
    game = stage(game, 0, (player) => ({ battlefield: player.battlefield.map((permanent) => permanent.instance_id === shooter.instance_id ? { ...permanent, tapped: true } : permanent) }));
    const bear = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: bear.instance_id }] });
    game = passUntil(game, (state) => state.pendingChoice === null && state.stack.length === 0);
    expect(game.players[0]!.battlefield.find((permanent) => permanent.instance_id === shooter.instance_id)?.tapped).toBe(false);
  });

  it("deals entering-creature power with Warstorm Surge", () => {
    let game = readyToCast([BEAR()], [WARSTORM_SURGE(), FOREST(), FOREST()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.pendingChoice).toMatchObject({ type: "trigger-target", targetKind: "any" });
    const choice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "trigger-target" }>;
    game = applyAction(game, 0, { type: "choose-trigger-target", sourceId: choice.sourceId, target: { kind: "player", seat: 1 } });
    game = passUntil(game, (state) => state.pendingChoice === null && state.stack.length === 0);
    expect(game.players[1]!.life).toBe(38);
  });

  it("offers Where Ancients Tread only for creatures meeting its power threshold", () => {
    let game = readyToCast([TRAMPLER()], [WHERE_ANCIENTS_TREAD(), FOREST(), FOREST(), FOREST(), FOREST()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.pendingChoice).toMatchObject({ type: "trigger-target", targetKind: "any" });
    const choice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "trigger-target" }>;
    game = applyAction(game, 0, { type: "choose-trigger-target", sourceId: choice.sourceId, target: { kind: "player", seat: 1 } });
    expect(game.pendingChoice).toMatchObject({ type: "optional-trigger", sourceCard: { name: "Where Ancients Tread" } });
    const optional = game.pendingChoice!;
    game = applyAction(game, 0, { type: "choose-trigger", sourceId: optional.sourceId, accept: true });
    game = passUntil(game, (state) => state.pendingChoice === null && state.stack.length === 0);
    expect(game.players[1]!.life).toBe(35);

    game = readyToCast([BEAR()], [WHERE_ANCIENTS_TREAD(), FOREST(), FOREST()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.pendingChoice).toBeNull();
    expect(game.players[1]!.life).toBe(40);
  });

  it("damages the player who draws through Spiteful Visions", () => {
    let game = readyToCast([DRAW_TWO_TARGET()], [SPITEFUL_VISIONS(), ISLAND(), ISLAND(), ISLAND()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 0 }] });
    game = passUntil(game, (state) => state.pendingChoice === null && state.stack.length === 0);
    expect(game.players[0]!.life).toBe(38);
    expect(game.log.filter((entry) => entry.text.includes("hace 1 de daño")).length).toBe(2);
  });

  it("checks the life comparison after Survival Cache gains life", () => {
    let game = readyToCast([SURVIVAL_CACHE()], [PLAINS(), PLAINS(), PLAINS()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[0]!.life).toBe(42);
    expect(game.players[0]!.hand).toHaveLength(1);
  });

  it("parses echo and sacrifices the permanent when its next-upkeep cost is declined", () => {
    const profile = profileOf(ECHO_CREATURE());
    expect(profile.echoCost).toMatchObject({ raw: "{1}{G}", manaValue: 2 });
    expect(profile.fullyImplemented).toBe(true);

    let game = readyToCast([ECHO_CREATURE()], [FOREST(), FOREST(), FOREST()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Echo Adept")).toBe(true);
    game = passUntil(game, (state) => state.pendingChoice?.type === "optional-trigger");
    expect(game.pendingChoice).toMatchObject({ type: "optional-trigger", unlessPayCost: { raw: "{1}{G}" } });
    game = applyAction(game, 0, { type: "choose-trigger", sourceId: game.pendingChoice!.sourceId, accept: false });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Echo Adept")).toBe(false);
  });

  it("pays echo through the normal mana planner and keeps the permanent", () => {
    let game = readyToCast([ECHO_CREATURE()], [FOREST(), FOREST(), FOREST(), FOREST()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = passUntil(game, (state) => state.pendingChoice?.type === "optional-trigger");
    const echoChoice = game.pendingChoice!;
    expect(legalActions(game, 0).some((entry) => entry.action.type === "choose-trigger" && entry.action.accept)).toBe(true);
    game = applyAction(game, 0, { type: "choose-trigger", sourceId: echoChoice.sourceId, accept: true });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Echo Adept")).toBe(true);
  });

  it("resolves Chaos Warp as an owner-library replacement", () => {
    expect(cardProfile(CHAOS_WARP()).fullyImplemented).toBe(true);
    let game = readyToCast([CHAOS_WARP()], [MOUNTAIN(), MOUNTAIN(), MOUNTAIN()], [], [BEAR()]);
    game = stage(game, 1, () => ({ library: toHand(1, [BOLT()], "warp-library") }));
    const target = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: target.instance_id }] });
    expect(game.players[1]!.battlefield.some((permanent) => permanent.instance_id === target.instance_id)).toBe(false);
    expect(game.players[1]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(false);
    expect(game.players[1]!.library.some((card) => card.name === "Lightning Bolt")).toBe(true);
  });

  it("reuses oracle-driven rules for C13 reprints", () => {
    expect(C13_COMMAND_TOWER().scryfall_id).toBe("0895c9b7-ae7d-4bb3-af17-3b75deb50a25");
    expect(C13_DECREE_OF_PAIN().scryfall_id).toBe("932668fa-d6e3-41c0-ad0c-8e0a00e68d11");
    expect(cardProfile(C13_COMMAND_TOWER()).manaAbilities).toHaveLength(1);
    expect(cardProfile(C13_DECREE_OF_PAIN()).effects).toMatchObject([{ kind: "destroy-all-creatures-draw-destroyed" }]);
  });

  it("uses the greatest discarded hand size for Jace's Archivist", () => {
    const profile = cardProfile(C13_JACES_ARCHIVIST());
    expect(profile.activatedAbilities[0]).toMatchObject({
      requiresTap: true,
      manaCost: { raw: "{U}" },
      effect: { kind: "each-player-discard-and-draw-greatest" }
    });
    expect(profile.fullyImplemented).toBe(true);

    let game = readyToCast([], [C13_JACES_ARCHIVIST(), ISLAND(), ISLAND(), ISLAND()], [BEAR(), BEAR()], [WALL()]);
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Jace's Archivist")!;
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.action.sourceId === source.instance_id);
    expect(activation).toBeDefined();
    game = applyAction(game, 0, activation!.action);
    game = passUntil(game, (state) => state.pendingChoice === null && state.stack.length === 0);

    expect(game.players[0]!.hand).toHaveLength(2);
    expect(game.players[1]!.hand).toHaveLength(2);
    expect(game.players[0]!.graveyard.filter((card) => card.name === "Jace's Archivist")).toHaveLength(0);
    expect(game.players[1]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);
    expect(game.players[1]!.battlefield.some((permanent) => permanent.card.name === "Stone Wall")).toBe(true);
  });

  it("draws for each creature destroyed by Decree of Pain", () => {
    expect(cardProfile(DECREE_OF_PAIN()).effects).toMatchObject([{ kind: "destroy-all-creatures-draw-destroyed" }]);
    let game = readyToCast([DECREE_OF_PAIN()], [SWAMP(), SWAMP(), SWAMP(), SWAMP(), SWAMP(), SWAMP(), BEAR()], [], [BEAR()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Grizzly Bears")).toBe(false);
    expect(game.players[1]!.battlefield.some((permanent) => permanent.card.name === "Grizzly Bears")).toBe(false);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);
    expect(game.players[1]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);
    expect(game.players[0]!.hand).toHaveLength(2);
  });

  it("resolves Decree of Pain's cycling trigger", () => {
    const profile = profileOf(DECREE_OF_PAIN());
    expect(profile.cyclingCost?.raw).toBe("{3}{B}{B}");
    expect(profile.triggers).toMatchObject([{
      event: "card-cycled",
      subject: "self",
      effect: { kind: "modify-all-creatures", power: -2, toughness: -2 }
    }]);
    expect(profile.fullyImplemented).toBe(true);
    let game = readyToCast(
      [DECREE_OF_PAIN()],
      [SWAMP(), SWAMP(), SWAMP(), SWAMP(), SWAMP(), BEAR()],
      [],
      [BEAR()]
    );
    const decree = game.players[0]!.hand[0]!;
    const offered = legalActions(game, 0).find((entry) => entry.action.type === "cycle" && entry.cardId === decree.instance_id);
    expect(offered).toBeDefined();
    game = applyAction(game, 0, offered!.action);
    game = passUntil(game, (state) => state.stack.length === 0 && state.triggerQueue.length === 0);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Decree of Pain")).toBe(true);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);
    expect(game.players[1]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);
  });

  it("resolves Slice and Dice's optional cycling damage trigger", () => {
    const profile = profileOf(SLICE_AND_DICE());
    expect(profile.triggers[0]).toMatchObject({
      event: "card-cycled",
      subject: "self",
      optional: true,
      effect: { kind: "damage-all-creatures", amount: 1 }
    });
    expect(profile.fullyImplemented).toBe(true);
    let game = readyToCast(
      [SLICE_AND_DICE()],
      [MOUNTAIN(), MOUNTAIN(), MOUNTAIN()],
      [],
      [BEAR()]
    );
    const slice = game.players[0]!.hand[0]!;
    const offered = legalActions(game, 0).find((entry) => entry.action.type === "cycle" && entry.cardId === slice.instance_id);
    expect(offered).toBeDefined();
    game = applyAction(game, 0, offered!.action);
    game = passUntil(game, (state) => state.pendingChoice?.type === "optional-trigger");
    const choice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "optional-trigger" }>;
    game = applyAction(game, 0, { type: "choose-trigger", sourceId: choice.sourceId, accept: true });
    game = passUntil(game, (state) => state.stack.length === 0 && state.triggerQueue.length === 0);
    expect(game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")?.damage).toBe(1);
  });

  it("resolves Dirge of Dread's optional cycling keyword trigger", () => {
    const profile = profileOf(DIRGE_OF_DREAD());
    expect(profile.cyclingCost?.raw).toBe("{1}{B}");
    expect(profile.triggers).toMatchObject([{ event: "card-cycled", subject: "self", optional: true, targetKind: "creature", effect: { kind: "grant-target-creature-keyword", keyword: "fear" } }]);
    expect(profile.fullyImplemented).toBe(true);
    let game = readyToCast([DIRGE_OF_DREAD()], [SWAMP(), SWAMP()], [], [BEAR()]);
    game = stage(game, 0, () => ({ library: toHand(0, [FOREST()], "dirge-library") }));
    const cycled = legalActions(game, 0).find((entry) => entry.action.type === "cycle" && entry.cardId === "hand-0");
    expect(cycled).toBeDefined();
    game = applyAction(game, 0, cycled!.action);
    expect(game.pendingChoice).toMatchObject({ type: "optional-trigger", sourceCard: { name: "Dirge of Dread" } });
    const optional = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "optional-trigger" }>;
    game = applyAction(game, 0, { type: "choose-trigger", sourceId: optional.sourceId, accept: true });
    const bear = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    if (game.pendingChoice?.type === "trigger-target") game = applyAction(game, 0, { type: "choose-trigger-target", sourceId: game.pendingChoice.sourceId, target: { kind: "permanent", instanceId: bear.instance_id } });
    game = passUntil(game, (state) => state.pendingChoice === null && state.stack.length === 0 && state.triggerQueue.length === 0);
    expect(game.players[1]!.battlefield.find((permanent) => permanent.instance_id === bear.instance_id)?.temporaryKeywords).toContain("fear");
    expect(game.players[0]!.graveyard.some((card) => card.name === "Dirge of Dread")).toBe(true);
  });

  it("lets Mind's Eye pay for opponent draws", () => {
    const profile = profileOf(MINDS_EYE());
    expect(profile.triggers).toMatchObject([{
      event: "card-drawn",
      subject: "opponent",
      optional: true,
      manaCost: { raw: "{1}" },
      effect: { kind: "draw", amount: 1 }
    }]);
    expect(profile.fullyImplemented).toBe(true);
    let game = readyToCast([EACH_DRAW_SPELL()], [ISLAND(), ISLAND(), ISLAND(), ISLAND(), ISLAND(), MINDS_EYE()]);
    const beforeHand = game.players[0]!.hand.length;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    for (let count = 0; count < 2; count += 1) {
      const choice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "optional-trigger" }>;
      expect(choice.sourceCard.name).toBe("Mind's Eye");
      game = applyAction(game, 0, { type: "choose-trigger", sourceId: choice.sourceId, accept: true });
    }
    expect(game.players[0]!.hand.length).toBe(beforeHand + 1);
  });

  it("puts an artifact or creature spell countered by Desertion onto its controller's battlefield", () => {
    expect(cardProfile(DESERTION()).effects).toEqual([{ kind: "counter-target-spell-to-battlefield" }]);
    let game = readyToCast([DESERTION()], [ISLAND(), ISLAND(), ISLAND(), ISLAND()]);
    const spell = { ...BEAR(), instance_id: "desertion-spell", owner: 1 };
    game = { ...game, stack: [{ id: "desertion-spell", controller: 1, card: spell, label: spell.name, targets: [], fromCommandZone: false, variableValue: 0, countered: false }] };
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "spell", stackId: "desertion-spell" }] });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Grizzly Bears")).toBe(true);
    expect(game.players[1]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(false);
  });
  it("counters a spell and schedules Arcane Denial's two next-upkeep draws", () => {
    let game = readyToCast([BOLT()], [MOUNTAIN()], [C13_ARCANE_DENIAL()], [ISLAND(), ISLAND(), ISLAND()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 1 }] });
    const bolt = game.stack.at(-1)!;
    game = applyAction(game, 1, { type: "cast", cardId: "foe-0", targets: [{ kind: "spell", stackId: bolt.id }] });
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Lightning Bolt")).toBe(true);
    expect(game.players[1]!.graveyard.some((card) => card.name === "Arcane Denial")).toBe(true);
    expect(game.delayedDraws).toMatchObject([
      { seat: 0, amount: 2, optional: true, triggerAtTurn: 2 },
      { seat: 1, amount: 1, optional: false, triggerAtTurn: 2 }
    ]);
  });

  it("offers zero through two cards for the controller's delayed draw", () => {
    let game = readyToCast([BOLT()], [MOUNTAIN()], [C13_ARCANE_DENIAL()], [ISLAND(), ISLAND(), ISLAND()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 1 }] });
    const bolt = game.stack.at(-1)!;
    game = applyAction(game, 1, { type: "cast", cardId: "foe-0", targets: [{ kind: "spell", stackId: bolt.id }] });
    game = passUntil(game, (state) => state.pendingChoice?.type === "draw-cards");
    const choice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "draw-cards" }>;
    expect(choice.seat).toBe(0);
    expect(legalActions(game, 0).map((entry) => entry.action.type === "choose-draw" ? entry.action.amount : -1)).toEqual([0, 1, 2]);
    expect(legalActions(game, 1)).toHaveLength(0);
    expect(projectGame(game, 1).legalActions).toHaveLength(0);
    const before = game.players[0]!.hand.length;
    game = applyAction(game, 0, { type: "choose-draw", sourceId: choice.sourceId, amount: 2 });
    expect(game.pendingChoice).toBeNull();
    expect(game.players[0]!.hand.length).toBe(before + 2);
    expect(game.players[1]!.hand.length).toBe(2);
  });

  it("clamps the delayed draw choice and supports declining it", () => {
    let game = readyToCast([BOLT()], [MOUNTAIN()], [C13_ARCANE_DENIAL()], [ISLAND(), ISLAND(), ISLAND()]);
    game = stage(game, 0, (player) => ({ library: toHand(0, [FOREST()], "arcane-short") }));
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 1 }] });
    const bolt = game.stack.at(-1)!;
    game = applyAction(game, 1, { type: "cast", cardId: "foe-0", targets: [{ kind: "spell", stackId: bolt.id }] });
    game = passUntil(game, (state) => state.pendingChoice?.type === "draw-cards");
    const choice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "draw-cards" }>;
    expect(legalActions(game, 0).map((entry) => entry.action.type === "choose-draw" ? entry.action.amount : -1)).toEqual([0, 1]);
    game = applyAction(game, 0, { type: "choose-draw", sourceId: choice.sourceId, amount: 0 });
    expect(game.players[0]!.library.map((card) => card.name)).toEqual(["Forest"]);
  });

  it("lets the deterministic bot choose the maximum delayed draw", () => {
    let game = readyToCast([BOLT()], [MOUNTAIN()], [C13_ARCANE_DENIAL()], [ISLAND(), ISLAND(), ISLAND()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 1 }] });
    const bolt = game.stack.at(-1)!;
    game = applyAction(game, 1, { type: "cast", cardId: "foe-0", targets: [{ kind: "spell", stackId: bolt.id }] });
    game = passUntil(game, (state) => state.pendingChoice?.type === "draw-cards");
    const action = botAction(game, 0);
    expect(action?.action).toMatchObject({ type: "choose-draw", amount: 2 });
  });

  it("uses a fixed multicolor mana ability as its full printed output", () => {
    let game = readyToCast([AZORIUS_SPELL()], [AZORIUS_RELIC()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Azorius Relic")?.tapped).toBe(true);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Azorius Lesson")).toBe(true);
    expect(game.players[0]!.hand).toHaveLength(1);
  });

  it("creates deterministic creature tokens and keeps them out of graveyards", () => {
    let game = readyToCast([PLANT_SPELL()], [FOREST(), FOREST(), FOREST(), FOREST()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    const plants = game.players[0]!.battlefield.filter((permanent) => permanent.card.name === "Plant");
    expect(plants).toHaveLength(3);
    expect(new Set(plants.map((permanent) => permanent.instance_id)).size).toBe(3);
    expect(projectGame(game, 0).players[0]!.battlefield.filter((permanent) => permanent.name === "Plant").every((permanent) => permanent.isToken)).toBe(true);

    game = { ...game, players: game.players.map((player, seat) => seat === 0
      ? { ...player, battlefield: player.battlefield.map((permanent) => permanent.card.name === "Plant" ? { ...permanent, damage: 1 } : permanent) }
      : player) };
    game = applyAction(game, 0, { type: "pass" });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Plant")).toBe(false);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Plant")).toBe(false);
  });

  it("creates a Graveborn token when Sek'Kuar sees another nontoken creature die", () => {
    const profile = profileOf(SEKKUAR());
    expect(profile.triggers).toMatchObject([{
      event: "dies",
      subject: "another-creature-you-control",
      nontoken: true,
      effect: { kind: "create-token", amount: 1, token: { name: "Graveborn", power: 3, toughness: 1, colors: ["B", "R"], keywords: ["haste"] } }
    }]);
    expect(profile.fullyImplemented).toBe(true);

    let game = readyToCast([DESTROY_TARGET_CREATURE()], [SWAMP(), SWAMP(), SEKKUAR(), BEAR()]);
    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: bear.instance_id }] });
    game = passUntil(game, (state) => state.stack.length === 0 && state.triggerQueue.length === 0 && state.pendingChoice === null);

    expect(game.players[0]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);
    const graveborn = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Graveborn");
    expect(graveborn).toMatchObject({ card: { token: true, colors: ["B", "R"], keywords: ["haste"], power: "3", toughness: "1" } });
  });

  it("returns a targeted creature card from its controller's graveyard", () => {
    const profile = profileOf(GRAVEYARD_RETURN());
    expect(profile).toMatchObject({ targetKind: "creature-card-in-your-graveyard", effects: [{ kind: "return-target-card-from-graveyard" }] });
    let game = readyToCast([GRAVEYARD_RETURN()], [SWAMP()]);
    game = stage(game, 0, (player) => ({ autoPass: false, graveyard: toHand(0, [BEAR()], "yard") }));
    game = stage(game, 1, (player) => ({ autoPass: false }));
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "graveyard-card", seat: 0, instanceId: "yard-0" }] });
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "pass" });
    expect(game.players[0]!.hand.some((card) => card.name === "Grizzly Bears")).toBe(true);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(false);
  });

  it.each([
    ["Archaeomancer", ARCHAEOMANCER],
    ["Izzet Chronarch", IZZET_CHRONARCH]
  ] as const)("%s returns only an instant or sorcery card from its graveyard", (_name, makeSource) => {
    const source = makeSource();
    const profile = profileOf(source);
    expect(profile.triggers).toMatchObject([{
      event: "enters-battlefield", subject: "self",
      effect: { kind: "return-target-card-from-graveyard" },
      targetKind: "instant-or-sorcery-card-in-your-graveyard"
    }]);
    expect(profile.fullyImplemented).toBe(true);

    const spell = BOLT();
    const creature = BEAR();
    let game = readyToCast([source], [ISLAND(), ISLAND(), ISLAND(), ISLAND(), MOUNTAIN()]);
    game = stage(game, 0, () => ({ autoPass: false, graveyard: toHand(0, [creature, spell], `${_name}-yard`) }));
    game = stage(game, 1, () => ({ autoPass: false }));
    expect(legalTargets(game, 0, "instant-or-sorcery-card-in-your-graveyard")).toEqual([
      { kind: "graveyard-card", seat: 0, instanceId: `${_name}-yard-1` }
    ]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "pass" });
    expect(game.stack.at(-1)?.trigger?.definition).toMatchObject({
      targetKind: "instant-or-sorcery-card-in-your-graveyard"
    });
    expect(game.stack.at(-1)?.targets).toEqual([
      { kind: "graveyard-card", seat: 0, instanceId: `${_name}-yard-1` }
    ]);
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "pass" });
    expect(game.players[0]!.hand.some((card) => card.name === "Lightning Bolt")).toBe(true);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Lightning Bolt")).toBe(false);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);
  });

  it("moves the chosen graveyard card to exile", () => {
    const profile = profileOf(GRAVEYARD_EXILE());
    expect(profile).toMatchObject({ targetKind: "card-in-your-graveyard", effects: [{ kind: "exile-target-card-from-graveyard" }] });
    let game = readyToCast([GRAVEYARD_EXILE()], [SWAMP()]);
    game = stage(game, 0, (player) => ({ autoPass: false, graveyard: toHand(0, [BEAR()], "exile-yard") }));
    game = stage(game, 1, (player) => ({ autoPass: false }));
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "graveyard-card", seat: 0, instanceId: "exile-yard-0" }] });
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "pass" });
    expect(game.players[0]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(false);
    expect(game.players[0]!.exile.some((card) => card.name === "Grizzly Bears")).toBe(true);
  });

  it("returns a targeted creature card from its graveyard to the battlefield", () => {
    const profile = profileOf(GRAVEYARD_BATTLEFIELD());
    expect(profile).toMatchObject({ targetKind: "creature-card-in-your-graveyard", effects: [{ kind: "return-target-creature-card-from-graveyard-to-battlefield" }] });
    let game = readyToCast([GRAVEYARD_BATTLEFIELD()], [SWAMP()]);
    game = stage(game, 0, (player) => ({ autoPass: false, graveyard: toHand(0, [BEAR()], "battlefield-yard") }));
    game = stage(game, 1, (player) => ({ autoPass: false }));
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "graveyard-card", seat: 0, instanceId: "battlefield-yard-0" }] });
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "pass" });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Grizzly Bears")).toBe(true);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(false);
  });

  it("reanimates a creature from an opponent's graveyard, paying life equal to its mana value", () => {
    const profile = profileOf(REANIMATE_SPELL());
    expect(profile).toMatchObject({ targetKind: "creature-card-in-a-graveyard", effects: [{ kind: "reanimate-target-creature-lose-mana-value-life" }] });
    expect(profile.fullyImplemented).toBe(true);

    let game = readyToCast([REANIMATE_SPELL()], [SWAMP()], [], []);
    game = stage(game, 1, (player) => ({ autoPass: false, graveyard: toHand(1, [BEAR()], "reanimate-yard") }));
    game = stage(game, 0, (player) => ({ autoPass: false }));
    const life0 = game.players[0]!.life;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "graveyard-card", seat: 1, instanceId: "reanimate-yard-0" }] });
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "pass" });
    // The reanimated creature enters under the CASTER's control, not its
    // original owner's, and only the caster pays the life cost.
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Grizzly Bears")).toBe(true);
    expect(game.players[1]!.battlefield.some((permanent) => permanent.card.name === "Grizzly Bears")).toBe(false);
    expect(game.players[1]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(false);
    expect(game.players[0]!.life).toBe(life0 - 2);
  });

  it("reuses reanimation life-loss for Phyrexian Delver's ETB", () => {
    const profile = profileOf(PHYREXIAN_DELVER());
    expect(profile.triggers[0]).toMatchObject({ event: "enters-battlefield", targetKind: "creature-card-in-your-graveyard", effect: { kind: "reanimate-target-creature-lose-mana-value-life" } });
    expect(profile.fullyImplemented).toBe(true);
  });

  it("reanimates for free when there is no cost clause", () => {
    expect(profileOf(PLAIN_GRAVEYARD_REANIMATE())).toMatchObject({
      targetKind: "creature-card-in-a-graveyard",
      effects: [{ kind: "return-target-creature-card-from-graveyard-to-battlefield" }],
      fullyImplemented: true
    });
    let game = readyToCast([PLAIN_GRAVEYARD_REANIMATE()], [SWAMP(), SWAMP(), SWAMP(), SWAMP(), SWAMP(), SWAMP()], [], []);
    game = stage(game, 0, (player) => ({ autoPass: false, graveyard: toHand(0, [BEAR()], "hymn-yard") }));
    game = stage(game, 1, (player) => ({ autoPass: false }));
    const life0 = game.players[0]!.life;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "graveyard-card", seat: 0, instanceId: "hymn-yard-0" }] });
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "pass" });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Grizzly Bears")).toBe(true);
    expect(game.players[0]!.life).toBe(life0);
  });

  it("uses Stitch Together's threshold at resolution", () => {
    const stitch = make({ name: "Stitch Together", type_line: "Sorcery", mana_cost: "{1}{B}", cmc: 2,
      oracle_text: "Return target creature card from your graveyard to your hand. Threshold — Return that card from your graveyard to the battlefield instead if there are seven or more cards in your graveyard.",
      scryfall_id: "bc3d5911-3580-4132-9daf-2826495b5739" });
    let game = readyToCast([stitch], [SWAMP(), SWAMP()]);
    game = stage(game, 0, () => ({ graveyard: toHand(0, [BEAR(), FOREST(), FOREST(), FOREST(), FOREST(), FOREST(), FOREST()], "stitch-yard") }));
    const target = { kind: "graveyard-card" as const, seat: 0 as const, instanceId: "stitch-yard-0" };
    expect(legalTargets(game, 0, "creature-card-in-your-graveyard")).toContainEqual(target);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [target] });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Grizzly Bears")).toBe(true);
    expect(game.players[0]!.hand.some((card) => card.name === "Grizzly Bears")).toBe(false);
    expect(game.players[0]!.graveyard).toHaveLength(7);
  });

  it("puts the chosen graveyard card on top of its owner's library", () => {
    const profile = profileOf(GRAVEYARD_TOP());
    expect(profile).toMatchObject({ targetKind: "card-in-your-graveyard", effects: [{ kind: "return-target-card-to-library-top" }] });
    let game = readyToCast([GRAVEYARD_TOP()], [FOREST()]);
    game = stage(game, 0, (player) => ({ autoPass: false, graveyard: toHand(0, [BEAR()], "top-yard"), library: toHand(0, [ISLAND()], "top-library") }));
    game = stage(game, 1, (player) => ({ autoPass: false }));
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "graveyard-card", seat: 0, instanceId: "top-yard-0" }] });
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "pass" });
    expect(game.players[0]!.library[0]!.name).toBe("Grizzly Bears");
    expect(game.players[0]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(false);
  });

  it("restricts artifact graveyard recovery to artifact cards", () => {
    const profile = profileOf(ARTIFACT_GRAVEYARD_RETURN());
    expect(profile).toMatchObject({ targetKind: "artifact-card-in-your-graveyard", effects: [{ kind: "return-target-card-from-graveyard" }] });
    let game = readyToCast([ARTIFACT_GRAVEYARD_RETURN()], [SWAMP(), SWAMP()]);
    game = stage(game, 0, (player) => ({ autoPass: false, graveyard: toHand(0, [EQUIPMENT(), BEAR()], "artifact-yard") }));
    game = stage(game, 1, (player) => ({ autoPass: false }));
    expect(legalTargets(game, 0, "artifact-card-in-your-graveyard")).toHaveLength(1);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "graveyard-card", seat: 0, instanceId: "artifact-yard-0" }] });
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "pass" });
    expect(game.players[0]!.hand.some((card) => card.name === "Test Equipment")).toBe(true);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Test Equipment")).toBe(false);
  });

  it("preserves the tapped instruction on created tokens", () => {
    const profile = profileOf(TAPPED_ZOMBIES());
    expect(profile.effects[0]).toMatchObject({ kind: "create-token", amount: 13, token: { name: "Zombie", power: 2, toughness: 2, tapped: true } });
    let game = readyToCast([TAPPED_ZOMBIES()], [SWAMP(), SWAMP(), SWAMP(), SWAMP(), SWAMP(), SWAMP(), SWAMP()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    const zombies = game.players[0]!.battlefield.filter((permanent) => permanent.card.name === "Zombie");
    expect(zombies).toHaveLength(13);
    expect(zombies.every((permanent) => permanent.tapped)).toBe(true);
  });

  it("recognises Army of the Damned's executable Flashback cost", () => {
    const card = C13_ARMY_OF_THE_DAMNED();
    expect(card.scryfall_id).toBe("75d667ec-86f4-4850-a3b6-e7a9fc7053b0");
    expect(cardProfile(card).fullyImplemented).toBe(true);
    expect(cardProfile(card).flashbackCost?.raw).toBe("{7}{B}{B}");
    expect(cardProfile(card).effects[0]).toMatchObject({
      kind: "create-token",
      amount: 13,
      token: { name: "Zombie", power: 2, toughness: 2, tapped: true }
    });
  });

  it("resolves the C13 Army print into thirteen tapped Zombies", () => {
    let game = readyToCast([C13_ARMY_OF_THE_DAMNED()], [SWAMP(), SWAMP(), SWAMP(), SWAMP(), SWAMP(), SWAMP(), SWAMP()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    const zombies = game.players[0]!.battlefield.filter((permanent) => permanent.card.name === "Zombie");
    expect(zombies).toHaveLength(13);
    expect(zombies.every((permanent) => permanent.tapped)).toBe(true);
  });

  it("casts Army of the Damned from the graveyard with Flashback and exiles it", () => {
    let game = readyToCast([], [SWAMP(), SWAMP(), SWAMP(), SWAMP(), SWAMP(), SWAMP(), SWAMP(), SWAMP(), SWAMP()]);
    game = stage(game, 0, (player) => ({ graveyard: toHand(0, [C13_ARMY_OF_THE_DAMNED()], "flashback-yard") }));
    const card = game.players[0]!.graveyard[0]!;
    const offered = legalActions(game, 0).find((entry) => entry.action.type === "cast"
      && entry.action.cardId === card.instance_id && entry.action.fromGraveyard === true);
    expect(offered).toBeDefined();
    game = applyAction(game, 0, offered!.action);
    expect(game.players[0]!.graveyard.some((candidate) => candidate.instance_id === card.instance_id)).toBe(false);
    game = passUntil(game, (state) => state.stack.length === 0
      && state.players[0]!.exile.some((candidate) => candidate.instance_id === card.instance_id));
    expect(game.players[0]!.battlefield.filter((permanent) => permanent.card.name === "Zombie")).toHaveLength(13);
  });

  it("exiles a Flashback spell when an opponent counters it", () => {
    let game = readyToCast([], [SWAMP(), SWAMP(), SWAMP(), SWAMP(), SWAMP(), SWAMP(), SWAMP(), SWAMP(), SWAMP()], [COUNTER()], [ISLAND(), ISLAND()]);
    game = stage(game, 0, (player) => ({ graveyard: toHand(0, [C13_ARMY_OF_THE_DAMNED()], "countered-flashback") }));
    const card = game.players[0]!.graveyard[0]!;
    const offered = legalActions(game, 0).find((entry) => entry.action.type === "cast"
      && entry.action.cardId === card.instance_id && entry.action.fromGraveyard === true);
    expect(offered).toBeDefined();
    game = applyAction(game, 0, offered!.action);
    const spell = game.stack.at(-1)!;
    game = applyAction(game, 1, { type: "cast", cardId: "foe-0", targets: [{ kind: "spell", stackId: spell.id }] });
    game = passUntil(game, (state) => state.stack.length === 0
      && state.players[0]!.exile.some((candidate) => candidate.instance_id === card.instance_id));
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Zombie")).toBe(false);
  });

  it("does not offer Flashback when its alternative cost cannot be paid", () => {
    let game = readyToCast([], [SWAMP(), SWAMP(), SWAMP(), SWAMP(), SWAMP(), SWAMP(), SWAMP(), SWAMP()]);
    game = stage(game, 0, (player) => ({ graveyard: toHand(0, [C13_ARMY_OF_THE_DAMNED()], "insufficient-flashback") }));
    const card = game.players[0]!.graveyard[0]!;
    expect(legalActions(game, 0).some((entry) => entry.action.type === "cast"
      && entry.action.cardId === card.instance_id && entry.action.fromGraveyard === true)).toBe(false);
  });

  it("pays a Flashback life component in addition to its mana cost", () => {
    const card = make({
      name: "Deep Analysis",
      type_line: "Sorcery",
      mana_cost: "{3}{U}",
      cmc: 4,
      oracle_text: "Target player draws two cards.\nFlashback—{1}{U}, Pay 3 life."
    });
    let game = readyToCast([], [ISLAND(), FOREST()]);
    game = stage(game, 0, (player) => ({ life: 4, graveyard: toHand(0, [card], "life-flashback") }));
    const offered = legalActions(game, 0).find((entry) => entry.action.type === "cast"
      && entry.action.cardId === "life-flashback-0" && entry.action.fromGraveyard === true);
    expect(offered?.label).toContain("paga 3 vidas");
    expect(offered).toBeDefined();
    game = applyAction(game, 0, offered!.action);
    expect(game.players[0]!.life).toBe(1);
  });

  it("Hua Tuo puts only a creature card from its graveyard on top", () => {
    const hua = make({
      name: "Hua Tuo, Honored Physician",
      type_line: "Legendary Creature — Human",
      mana_cost: "{2}{G}",
      cmc: 3,
      power: "2",
      toughness: "2",
      oracle_text: "{T}: Put target creature card from your graveyard on top of your library. Activate only during your turn, before attackers are declared."
    });
    const creature = make({ name: "Grave Creature", type_line: "Creature — Beast", mana_cost: "{3}{G}", cmc: 4, power: "3", toughness: "3" });
    const land = make({ name: "Grave Land", type_line: "Land", mana_cost: "", cmc: 0 });
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [hua]);
    game = stage(game, 0, (player) => ({ graveyard: toHand(0, [creature, land], "hua-yard") }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.prioritySeat === 0);
    const source = game.players[0]!.battlefield[0]!;
    const target = { kind: "graveyard-card" as const, seat: 0, instanceId: "hua-yard-0" };
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.action.sourceId === source.instance_id);
    expect(activation).toBeDefined();
    const activationAction = activation!.action;
    if (activationAction.type !== "activate") throw new Error("Hua Tuo activation was not offered.");
    game = applyAction(game, 0, { ...activationAction, targets: [target] });
    game = passUntil(game, (state) => state.stack.length === 0 && state.pendingChoice === null);
    expect(game.players[0]!.library[0]!.name).toBe("Grave Creature");
    expect(game.players[0]!.graveyard.some((card) => card.name === "Grave Land")).toBe(true);
  });

  it("returns a land from any graveyard under the caster's control", () => {
    const profile = profileOf(LAND_GRAVEYARD_BATTLEFIELD());
    expect(profile).toMatchObject({ targetKind: "land-card-in-a-graveyard", effects: [{ kind: "return-target-land-card-from-graveyard-to-battlefield" }] });
    let game = readyToCast([LAND_GRAVEYARD_BATTLEFIELD()], [FOREST(), FOREST(), FOREST()]);
    game = stage(game, 0, (player) => ({ autoPass: false }));
    game = stage(game, 1, (player) => ({ autoPass: false, graveyard: toHand(1, [ISLAND()], "land-yard") }));
    expect(legalTargets(game, 0, "land-card-in-a-graveyard")).toMatchObject([{ kind: "graveyard-card", seat: 1, instanceId: "land-yard-0" }]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "graveyard-card", seat: 1, instanceId: "land-yard-0" }] });
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "pass" });
    const island = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Island");
    expect(island).toMatchObject({ controller: 0, card: { name: "Island", owner: 1 } });
    expect(game.players[1]!.graveyard.some((card) => card.name === "Island")).toBe(false);
  });

  it("returns a targeted artifact from its graveyard to the battlefield", () => {
    const profile = profileOf(ARTIFACT_GRAVEYARD_BATTLEFIELD());
    expect(profile).toMatchObject({ targetKind: "artifact-card-in-your-graveyard", effects: [{ kind: "return-target-artifact-card-from-graveyard-to-battlefield" }] });
    let game = readyToCast([ARTIFACT_GRAVEYARD_BATTLEFIELD()], [ISLAND(), SWAMP(), SWAMP(), SWAMP()]);
    game = stage(game, 0, (player) => ({ autoPass: false, graveyard: toHand(0, [EQUIPMENT(), BEAR()], "artifact-battlefield-yard") }));
    game = stage(game, 1, (player) => ({ autoPass: false }));
    expect(legalTargets(game, 0, "artifact-card-in-your-graveyard")).toHaveLength(1);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "graveyard-card", seat: 0, instanceId: "artifact-battlefield-yard-0" }] });
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "pass" });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Test Equipment")).toBe(true);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Test Equipment")).toBe(false);
  });

  it("reuses artifact graveyard recovery for C13 Sharuum's ETB", () => {
    const profile = profileOf(C13_SHARUUM());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.triggers).toMatchObject([{
      event: "enters-battlefield",
      targetKind: "artifact-card-in-your-graveyard",
      effect: { kind: "return-target-artifact-card-from-graveyard-to-battlefield" }
    }]);

    let game = readyToCast([C13_SHARUUM()], [PLAINS(), ISLAND(), SWAMP(), SWAMP(), SWAMP(), SWAMP()]);
    game = stage(game, 0, (player) => ({ autoPass: false, graveyard: toHand(0, [EQUIPMENT(), BEAR()], "sharuum-yard") }));
    game = stage(game, 1, (player) => ({ autoPass: false }));
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = passUntil(game, (state) => state.pendingChoice?.type === "optional-trigger");
    const optional = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "optional-trigger" }>;
    expect(optional.targets).toHaveLength(1);
    expect(optional.targets?.[0]).toEqual({ kind: "graveyard-card", seat: 0, instanceId: "sharuum-yard-0" });
    game = applyAction(game, 0, { type: "choose-trigger", sourceId: optional.sourceId, accept: true });
    game = passUntil(game, (state) => state.pendingChoice === null && state.stack.length === 0);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Test Equipment")).toBe(true);
  });

  it("restricts enchantment graveyard recovery to enchantment cards", () => {
    const profile = profileOf(ENCHANTMENT_GRAVEYARD_RETURN());
    expect(profile).toMatchObject({ targetKind: "enchantment-card-in-your-graveyard", effects: [{ kind: "return-target-card-from-graveyard" }] });
    const enchantment = make({ name: "Test Enchantment", type_line: "Enchantment", mana_cost: "{1}{G}", cmc: 2 });
    let game = readyToCast([ENCHANTMENT_GRAVEYARD_RETURN()], [FOREST(), FOREST()]);
    game = stage(game, 0, (player) => ({ autoPass: false, graveyard: toHand(0, [enchantment, BEAR()], "enchantment-yard") }));
    game = stage(game, 1, (player) => ({ autoPass: false }));
    expect(legalTargets(game, 0, "enchantment-card-in-your-graveyard")).toHaveLength(1);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "graveyard-card", seat: 0, instanceId: "enchantment-yard-0" }] });
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "pass" });
    expect(game.players[0]!.hand.some((card) => card.name === "Test Enchantment")).toBe(true);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Test Enchantment")).toBe(false);
  });

  it("grants a temporary combat keyword to the chosen creature", () => {
    const profile = profileOf(DOUBLE_STRIKE_SPELL());
    expect(profile).toMatchObject({ targetKind: "creature", effects: [{ kind: "grant-target-creature-keyword", keyword: "double strike" }] });
    let game = readyToCast([DOUBLE_STRIKE_SPELL()], [MOUNTAIN(), PLAINS()], [], [BEAR()]);
    const target = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: target.instance_id }] });
    const boosted = game.players[1]!.battlefield.find((permanent) => permanent.instance_id === target.instance_id)!;
    expect(boosted.temporaryKeywords).toEqual(["double strike"]);
  });

  it("combines a temporary P/T boost and keyword grant", () => {
    const profile = profileOf(TRAMPLE_BOOST());
    expect(profile).toMatchObject({ targetKind: "creature", effects: [{ kind: "modify-and-grant-target-creature", power: 2, toughness: 2, keyword: "trample" }] });
    let game = readyToCast([TRAMPLE_BOOST()], [FOREST(), PLAINS()], [], [BEAR()]);
    const target = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: target.instance_id }] });
    const boosted = game.players[1]!.battlefield.find((permanent) => permanent.instance_id === target.instance_id)!;
    expect([powerOf(boosted), toughnessOf(boosted)]).toEqual([4, 4]);
    expect(boosted.temporaryKeywords).toEqual(["trample"]);
  });

  it("resolves an activated self-pump against its source permanent", () => {
    const profile = profileOf(INFERNO_PUMP());
    expect(profile.activatedAbilities[0]).toMatchObject({ manaCost: { raw: "{R}" }, targetKind: "none", effect: { kind: "modify-source-creature", power: 1, toughness: 0 } });
    let game = readyToCast([], [MOUNTAIN(), INFERNO_PUMP()]);
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Inferno Memory")!;
    game = applyAction(game, 0, { type: "activate", sourceId: source.instance_id, abilityIndex: 0 });
    const boosted = game.players[0]!.battlefield.find((permanent) => permanent.instance_id === source.instance_id)!;
    expect([powerOf(boosted), toughnessOf(boosted)]).toEqual([7, 6]);
  });

  it("creates a reusable regeneration shield from an activated ability", () => {
    const profile = profileOf(MARROW_BATS());
    expect(profile.activatedAbilities[0]).toMatchObject({
      manaCost: { raw: "{B}" }, lifeCost: 4, targetKind: "none", effect: { kind: "regenerate-source" }
    });
    let game = readyToCast([], [SWAMP(), MARROW_BATS()]);
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Marrow Bats")!;
    game = applyAction(game, 0, { type: "activate", sourceId: source.instance_id, abilityIndex: 0 });
    expect(game.players[0]!.life).toBe(36);
    expect(game.players[0]!.battlefield.find((permanent) => permanent.instance_id === source.instance_id)?.regenerationShields).toBe(1);

    game = stage(game, 0, (player) => ({ battlefield: player.battlefield.map((permanent) =>
      permanent.instance_id === source.instance_id ? { ...permanent, damage: 2 } : permanent) }));
    game = applyAction(game, pendingSeat(game)!, { type: "pass" });
    const surviving = game.players[0]!.battlefield.find((permanent) => permanent.instance_id === source.instance_id)!;
    expect(surviving).toMatchObject({ damage: 0, deathtouched: false, tapped: true, regenerationShields: 0 });
    expect(profile.fullyImplemented).toBe(true);

    const anotherProfile = profileOf(make({
      name: "Wizard Chorus", type_line: "Creature — Human Wizard", mana_cost: "{2}{U}", cmc: 3, power: "2", toughness: "2",
      oracle_text: "Tap another untapped creature you control: Draw a card."
    }));
    expect(anotherProfile.activatedAbilities[0]).toMatchObject({ tapsCreature: { mode: "another" } });

    const genericProfile = profileOf(make({
      name: "Creature Chorus", type_line: "Creature — Human", mana_cost: "{2}{G}", cmc: 3, power: "2", toughness: "2",
      oracle_text: "Tap an untapped creature you control: Draw a card."
    }));
    expect(genericProfile.activatedAbilities[0]).toMatchObject({ tapsCreature: { mode: "any" } });
    expect(genericProfile.activatedAbilities[0]!.tapsCreature?.subtype).toBeUndefined();
  });

  it("regenerates a targeted creature and removes it from combat", () => {
    let game = readyToCast([REGENERATE_TARGET()], [FOREST(), FOREST()], [], [BEAR()]);
    const target = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: target.instance_id }] });
    game = {
      ...game,
      combat: { ...game.combat, attackers: [{ instanceId: target.instance_id, defender: 0 }] },
      players: game.players.map((player) => player.seat === 1
        ? { ...player, battlefield: player.battlefield.map((permanent) => permanent.instance_id === target.instance_id ? { ...permanent, damage: 2 } : permanent) }
        : player)
    };
    game = applyAction(game, pendingSeat(game)!, { type: "pass" });
    const surviving = game.players[1]!.battlefield.find((permanent) => permanent.instance_id === target.instance_id)!;
    expect(surviving).toMatchObject({ damage: 0, tapped: true, regenerationShields: 0 });
    expect(game.combat.attackers).not.toContainEqual(expect.objectContaining({ instanceId: target.instance_id }));
  });

  it("reuses draw primitives for C13 draw spells", () => {
    expect(profileOf(C13_BRILLIANT_PLAN())).toMatchObject({ effects: [{ kind: "draw", amount: 3 }], targetKind: "none", fullyImplemented: true });
    expect(profileOf(C13_HARMONIZE())).toMatchObject({ effects: [{ kind: "draw", amount: 3 }], targetKind: "none", fullyImplemented: true });
    expect(profileOf(C13_VISION_SKEINS())).toMatchObject({ effects: [{ kind: "each-player-draw", amount: 2 }], targetKind: "none", fullyImplemented: true });
    expect(profileOf(C13_DEEP_ANALYSIS())).toMatchObject({ effects: [{ kind: "draw-target-player", amount: 2 }], targetKind: "player", flashbackCost: { raw: "{1}{U}" }, fullyImplemented: true });
    expect(profileOf(C13_SKYSCRIBING())).toMatchObject({
      effects: [{ kind: "each-player-draw", amount: "X" }], fullyImplemented: true,
      activatedAbilities: [{ sourceZone: "hand", upkeepOnly: true, oncePerTurn: true, manaCost: { raw: "{2}{U}" }, effect: { kind: "each-player-draw", amount: 1 } }]
    });
  });

  it("activates Forecast from hand only during upkeep and once per turn", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, (player) => ({ hand: toHand(0, [C13_SKYSCRIBING()]), library: toHand(0, [FOREST(), FOREST()], "library-a"), autoPass: false }));
    game = stage(game, 1, (player) => ({ hand: [], library: toHand(1, [FOREST(), FOREST()], "library-b"), autoPass: false }));
    game = putOnBattlefield(game, 0, [ISLAND(), ISLAND(), ISLAND()]);
    game = { ...game, step: "upkeep", activeSeat: 0, prioritySeat: 0, priorityOpen: true, stack: [], triggerQueue: [], pendingChoice: null };

    const forecast = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.cardId === "hand-0");
    expect(forecast).toBeDefined();
    game = applyAction(game, 0, forecast!.action);
    expect(game.players[0]!.hand.some((card) => card.name === "Skyscribing")).toBe(true);
    expect(game.players[0]!.oncePerTurnActivations).toContain("hand-0:0");
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "pass" });
    expect(game.players[0]!.hand).toHaveLength(2);
    expect(game.players[1]!.hand).toHaveLength(1);
    expect(legalActions(game, 0).some((entry) => entry.action.type === "activate" && entry.cardId === "hand-0")).toBe(false);

    const mainPhase: GameState = { ...game, step: "precombat-main", priorityOpen: true, prioritySeat: 0, stack: [], passedSeats: [] };
    expect(legalActions(mainPhase, 0).some((entry) => entry.action.type === "activate" && entry.cardId === "hand-0")).toBe(false);
  });

  it("keeps a real hand activation visible to smart priority", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, (player) => ({ hand: toHand(0, [C13_SKYSCRIBING()]), autoPass: true }));
    game = stage(game, 1, (player) => ({ autoPass: true }));
    game = putOnBattlefield(game, 0, [ISLAND(), ISLAND(), ISLAND()]);
    game = { ...game, step: "upkeep", activeSeat: 0, prioritySeat: 0, priorityOpen: true, stack: [], triggerQueue: [], pendingChoice: null };
    expect(legalActions(game, 0).some((entry) => entry.action.type === "activate" && entry.cardId === "hand-0")).toBe(true);
    expect(hasRealChoice(game, 0)).toBe(true);
  });

  it("activates Eternal Dragon from the graveyard only during upkeep", () => {
    const dragon = C13_ETERNAL_DRAGON();
    expect(profileOf(dragon).activatedAbilities[0]).toMatchObject({
      sourceZone: "graveyard", upkeepOnly: true, manaCost: { raw: "{3}{W}{W}" },
      effect: { kind: "return-source-to-hand" }
    });
    expect(profileOf(dragon).cyclingSearches).toMatchObject([{ subtypes: ["Plains"], cost: { raw: "{2}" } }]);
    let game = twoSeatGame([], []);
    game = stage(game, 0, (player) => ({ graveyard: toHand(0, [dragon], "graveyard"), autoPass: false }));
    game = putOnBattlefield(game, 0, [PLAINS(), PLAINS(), PLAINS(), PLAINS(), PLAINS()]);
    game = { ...game, step: "upkeep", activeSeat: 0, prioritySeat: 0, priorityOpen: true, stack: [], triggerQueue: [], pendingChoice: null };
    const activate = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.cardId === "graveyard-0");
    expect(activate).toBeDefined();
    game = applyAction(game, 0, activate!.action);
    game = applyAction(game, pendingSeat(game)!, { type: "pass" });
    game = applyAction(game, pendingSeat(game)!, { type: "pass" });
    expect(game.players[0]!.graveyard.some((card) => card.name === "Eternal Dragon")).toBe(false);
    expect(game.players[0]!.hand.some((card) => card.name === "Eternal Dragon")).toBe(true);
    const nonUpkeep = { ...game, step: "precombat-main" as const, priorityOpen: true, prioritySeat: 0, stack: [], passedSeats: [] };
    expect(legalActions(nonUpkeep, 0).some((entry) => entry.action.type === "activate" && entry.cardId === "graveyard-0")).toBe(false);
  });

  it("resolves Mirror Entity X/X and creature-type activation", () => {
    const mirror = C13_MIRROR_ENTITY();
    expect(profileOf(mirror)).toMatchObject({
      fullyImplemented: true,
      activatedAbilities: [{ manaCost: { raw: "{X}" }, effect: { kind: "set-creatures-you-control-base-pt-all-types", power: "X", toughness: "X" } }]
    });
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [mirror, BEAR(), FOREST(), FOREST(), FOREST()]);
    game = { ...game, step: "precombat-main", activeSeat: 0, prioritySeat: 0, priorityOpen: true, stack: [], triggerQueue: [], pendingChoice: null };
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Mirror Entity")!;
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate"
      && entry.action.sourceId === source.instance_id && entry.action.variableValue === 2);
    expect(activation).toBeDefined();
    game = applyAction(game, 0, activation!.action);
    game = applyAction(game, pendingSeat(game)!, { type: "pass" });
    game = applyAction(game, pendingSeat(game)!, { type: "pass" });
    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    expect(powerOf(bear, game)).toBe(2);
    expect(toughnessOf(bear, game)).toBe(2);
    expect(legalTargets(game, 0, "subtype:Wizard")).toContainEqual({ kind: "permanent", instanceId: bear.instance_id });
    expect(legalTargets(game, 0, "subtype:Equipment")).not.toContainEqual({ kind: "permanent", instanceId: bear.instance_id });
  });

  it("animates Faerie Conclave as a blue Faerie land creature", () => {
    const conclave = C13_FAERIE_CONCLAVE();
    expect(profileOf(conclave)).toMatchObject({
      fullyImplemented: true,
      activatedAbilities: [{ manaCost: { raw: "{1}{U}" }, effect: { kind: "animate-source", types: ["Land", "Creature"], subtypes: ["Faerie"] } }]
    });
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [conclave, ISLAND(), ISLAND()]);
    game = { ...game, step: "precombat-main", activeSeat: 0, prioritySeat: 0, priorityOpen: true, stack: [], triggerQueue: [], pendingChoice: null };
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Faerie Conclave")!;
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.action.sourceId === source.instance_id);
    expect(activation).toBeDefined();
    game = applyAction(game, 0, activation!.action);
    const animated = game.players[0]!.battlefield.find((permanent) => permanent.instance_id === source.instance_id)!;
    expect(powerOf(animated, game)).toBe(2);
    expect(toughnessOf(animated, game)).toBe(1);
    expect(animated.temporaryAnimation?.types).toEqual(["Land", "Creature"]);
    expect(legalTargets(game, 0, "creature")).toContainEqual({ kind: "permanent", instanceId: source.instance_id });
  });

  it("offers storage-counter mana as variable colour choices", () => {
    const profile = profileOf(C13_MOLTEN_SLAGHEAP());
    const storage = profile.manaAbilities.find((ability) => ability.variableAmountCounter === "storage");
    expect(storage).toMatchObject({ manaCost: { raw: "{1}" }, produces: ["B", "R"] });
    let game = readyToCast([], [C13_MOLTEN_SLAGHEAP()]);
    const source = game.players[0]!.battlefield[0]!;
    game = stage(game, 0, (player) => ({
      battlefield: player.battlefield.map((permanent) => permanent.instance_id === source.instance_id
        ? { ...permanent, counters: { storage: 2 } }
        : permanent)
    }));
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate-mana"
      && entry.action.sourceId === source.instance_id
      && entry.action.variableAmount === 2
      && entry.action.manaChoices?.join("") === "BR");
    expect(activation).toBeDefined();
    game = applyAction(game, 0, activation!.action);
    expect(game.players[0]!.manaPool).toMatchObject({ B: 1, R: 1 });
    expect(game.players[0]!.battlefield[0]!.counters.storage).toBe(0);
    expect(game.players[0]!.battlefield[0]!.tapped).toBe(true);
  });

  it("pays a spell's additional life cost exactly once", () => {
    const profile = profileOf(TOXIC_DELUGE());
    expect(profile).toMatchObject({ additionalLifeCost: 0, additionalLifeCostVariable: true, fullyImplemented: true });
    let game = readyToCast([TOXIC_DELUGE()], [SWAMP(), SWAMP(), SWAMP()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", variableValue: 1 });
    expect(game.players[0]!.life).toBe(39);
  });

  it("blocks non-mana responses while a Split second spell is on the stack", () => {
    const split = C13_KROSAN_GRIP();
    expect(profileOf(split).keywords).toContain("split second");
    let game = readyToCast([BOLT()], [MOUNTAIN()]);
    const stackCard = { ...split, instance_id: "split-second", owner: 1 };
    game = { ...game, stack: [{ id: "split-second", controller: 1, card: stackCard, label: stackCard.name, targets: [], fromCommandZone: false, variableValue: 0, countered: false }], prioritySeat: 0, priorityOpen: true };
    expect(legalActions(game, 0).some((entry) => entry.action.type === "cast" || entry.action.type === "activate" || entry.action.type === "cycle" || entry.action.type === "equip")).toBe(false);
  });

  it("recognizes a reusable typed tap cost", () => {
    const profile = profileOf(C13_AZAMI());
    expect(profile.activatedAbilities[0]).toMatchObject({
      tapsCreature: { mode: "any", subtype: "Wizard" },
      effect: { kind: "draw", amount: 1 }
    });
    expect(profile.fullyImplemented).toBe(true);
  });

  it("offers Flashback life costs in actions and pays them once", () => {
    let game = readyToCast([], [ISLAND(), ISLAND()]);
    game = stage(game, 0, (player) => ({
      life: 10,
      graveyard: toHand(0, [C13_DEEP_ANALYSIS()], "analysis-flashback"),
      library: toHand(0, [FOREST(), PLAINS()], "analysis-flashback-library")
    }));
    const flashback = legalActions(game, 0).find((entry) => entry.action.type === "cast"
      && entry.action.fromGraveyard
      && entry.action.cardId === "analysis-flashback-0");
    expect(flashback).toBeDefined();
    expect(flashback!.label).toContain("Pay 3 life");
    game = applyAction(game, 0, flashback!.action);
    expect(game.players[0]!.life).toBe(7);
    expect(game.players[0]!.hand.map((card) => card.name)).toEqual(["Forest", "Plains"]);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Deep Analysis")).toBe(false);
    expect(game.players[0]!.exile.some((card) => card.name === "Deep Analysis")).toBe(true);
  });

  it("reuses ETB draw and combat keywords for C13 Baleful Strix", () => {
    const profile = profileOf(C13_BALEFUL_STRIX());
    expect(profile.keywords).toEqual(expect.arrayContaining(["flying", "deathtouch"]));
    expect(profile.triggers).toMatchObject([{ event: "enters-battlefield", effect: { kind: "draw", amount: 1 } }]);
    expect(profile.fullyImplemented).toBe(true);
  });

  it("generalizes compound ETB draw and life loss amounts", () => {
    const profile = profileOf(C13_PHYREXIAN_GARGANTUA());
    expect(profile.triggers).toMatchObject([{
      event: "enters-battlefield",
      effect: { kind: "compound", effects: [{ kind: "draw", amount: 2 }, { kind: "lose-life", amount: 2 }] }
    }]);
    expect(profile.fullyImplemented).toBe(true);
  });

  it("reuses typed destruction and draw for C13 Annihilate", () => {
    expect(profileOf(C13_ANNIHILATE())).toMatchObject({
      effects: [{ kind: "destroy-target-permanent" }, { kind: "draw", amount: 1 }],
      targetKind: "nonblack-creature",
      fullyImplemented: true
    });
  });

  it("reuses distinct nonblack creature targets for C13 Reckless Spite", () => {
    const profile = profileOf(C13_RECKLESS_SPITE());
    expect(profile.effects).toEqual([{ kind: "compound", effects: [{ kind: "destroy-n-creatures", count: 2, nonblack: true }, { kind: "lose-life", amount: 5 }] }]);
    expect(profile.targetKinds).toEqual(["nonblack-creature", "nonblack-creature"]);
    expect(profile.fullyImplemented).toBe(true);

    let game = readyToCast([C13_RECKLESS_SPITE()], [SWAMP(), SWAMP(), SWAMP(), SWAMP(), SWAMP()], [], [BEAR(), FLIER()]);
    const targets = game.players[1]!.battlefield.map((permanent) => ({ kind: "permanent" as const, instanceId: permanent.instance_id }));
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets });
    expect(game.players[0]!.life).toBe(35);
    expect(game.players[1]!.battlefield).toHaveLength(0);
  });

  it("puts C13 Unexpectedly Absent's target beneath X cards of its owner's library", () => {
    const profile = profileOf(C13_UNEXPECTEDLY_ABSENT());
    expect(profile.effects).toEqual([{ kind: "put-target-nonland-permanent-under-top", count: "X" }]);
    expect(profile.targetKind).toBe("nonland");
    expect(profile.fullyImplemented).toBe(true);

    let game = readyToCast([C13_UNEXPECTEDLY_ABSENT()], [PLAINS(), ISLAND(), PLAINS(), ISLAND()], [], [BEAR()]);
    game = stage(game, 1, () => ({ library: toHand(1, [FOREST(), SWAMP(), MOUNTAIN()], "absent-library") }));
    const target = game.players[1]!.battlefield[0]!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", variableValue: 2, targets: [{ kind: "permanent", instanceId: target.instance_id }] });
    expect(game.players[1]!.battlefield).toHaveLength(0);
    expect(game.players[1]!.library.map((card) => card.name)).toEqual(["Forest", "Swamp", "Grizzly Bears", "Mountain"]);
  });

  it("reuses target graveyard exile for C13 ETB cards", () => {
    for (const card of [C13_ANGEL_OF_FINALITY(), C13_BOJUKA_BOG()]) {
      const profile = profileOf(card);
      expect(profile.triggers).toMatchObject([{
        event: "enters-battlefield",
        targetKind: "player",
        effect: { kind: "exile-target-graveyard" }
      }]);
      expect(profile.fullyImplemented).toBe(true);
    }
    expect(profileOf(C13_BOJUKA_BOG())).toMatchObject({ entersTapped: { kind: "tapped" }, manaAbilities: [{ produces: ["B"] }] });
  });

  it("reuses the artifact/enchantment sweep for C13 Bane of Progress", () => {
    const profile = profileOf(C13_BANE_OF_PROGRESS());
    expect(profile.triggers).toMatchObject([{
      event: "enters-battlefield",
      effect: { kind: "destroy-all-artifacts-enchantments-add-counters", counter: "+1/+1" }
    }]);
    expect(profile.fullyImplemented).toBe(true);
    let game = readyToCast([C13_BANE_OF_PROGRESS()], [FOREST(), FOREST(), FOREST(), FOREST()], [], [SOL_RING(), LIFE_LOCK()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    const bane = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Bane of Progress")!;
    expect(game.players[1]!.battlefield).toHaveLength(0);
    expect(bane.counters["+1/+1"]).toBe(2);
    expect(powerOf(bane, game)).toBe(4);
  });

  it("recognizes modern split-sentence Bane of Progress Oracle wording", () => {
    const modern = make({
      name: "Bane of Progress", type_line: "Creature — Elemental", mana_cost: "{2}{G}{G}", cmc: 4,
      power: "2", toughness: "2",
      oracle_text: "When this creature enters, destroy all artifacts and enchantments. Put a +1/+1 counter on this creature for each permanent destroyed this way.",
      scryfall_id: "c13-bane-of-progress-modern-wording"
    });
    expect(profileOf(modern)).toMatchObject({
      fullyImplemented: true,
      triggers: [{ event: "enters-battlefield", effect: { kind: "destroy-all-artifacts-enchantments-add-counters", counter: "+1/+1" } }]
    });
  });

  it("counts only destructible permanents for Bane of Progress", () => {
    const indestructibleRelic = make({ name: "Indestructible Relic", type_line: "Artifact", keywords: ["Indestructible"] });
    let game = readyToCast([C13_BANE_OF_PROGRESS()], [FOREST(), FOREST(), FOREST(), FOREST()], [], [SOL_RING(), LIFE_LOCK(), indestructibleRelic]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    const bane = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Bane of Progress")!;
    expect(game.players[1]!.battlefield.map((permanent) => permanent.card.name)).toEqual(["Indestructible Relic"]);
    expect(bane.counters["+1/+1"]).toBe(2);
  });

  it("allows the Bane of Progress ETB to be countered before it sweeps", () => {
    let game = readyToCast([C13_BANE_OF_PROGRESS()], [FOREST(), FOREST(), FOREST(), FOREST()], [COUNTER()], [SOL_RING(), ISLAND(), ISLAND()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    const trigger = game.stack.at(-1)!;
    game = applyAction(game, 1, { type: "cast", cardId: "foe-0", targets: [{ kind: "spell", stackId: trigger.id }] });
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[1]!.battlefield.some((permanent) => permanent.card.name === "Sol Ring")).toBe(true);
    expect(game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Bane of Progress")?.counters["+1/+1"]).toBeUndefined();
  });

  it("counts matching permanents across both battlefields", () => {
    let game = readyToCast([C13_BANE_OF_PROGRESS()], [FOREST(), FOREST(), FOREST(), FOREST(), SOL_RING()], [], [LIFE_LOCK()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    const bane = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Bane of Progress")!;
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Sol Ring")).toBe(false);
    expect(game.players[1]!.battlefield).toHaveLength(0);
    expect(bane.counters["+1/+1"]).toBe(2);
  });

  it("keeps Augur's top-three review private and offers only instant/sorcery cards", () => {
    expect(profileOf(C13_AUGUR_OF_BOLAS()).triggers[0]).toMatchObject({
      effect: { kind: "look-top-select", amount: 3, types: ["Instant", "Sorcery"] }
    });
    let game = readyToCast([C13_AUGUR_OF_BOLAS()], [ISLAND(), ISLAND()], [], []);
    game = stage(game, 0, () => ({ library: toHand(0, [FOREST(), BOLT(), BEAR()], "augur-library") }));
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.pendingChoice?.type).toBe("look-top-select");
    expect(legalActions(game, 0).filter((entry) => entry.action.type === "choose-look-top")).toHaveLength(1);
    expect(legalActions(game, 1)).toHaveLength(0);
    const ownView = projectGame(game, 0);
    const opponentView = projectGame(game, 1);
    expect(ownView.topSelection?.cards.map((card) => card.name)).toEqual(["Forest", "Lightning Bolt", "Grizzly Bears"]);
    expect(opponentView.topSelection).toBeNull();
    expect(exposedInstanceIds(opponentView)).not.toContain("augur-library-0");

    const sourceId = (game.pendingChoice as Extract<GameState["pendingChoice"], { type: "look-top-select" }>).sourceId;
    game = applyAction(game, 0, { type: "choose-look-top", sourceId, ordinal: 1 });
    expect((game.pendingChoice as Extract<GameState["pendingChoice"], { type: "look-top-select" }>).stage).toBe("bottom");
    game = applyAction(game, 0, { type: "choose-look-top-bottom", sourceId, ordinal: 1 });
    game = applyAction(game, 0, { type: "choose-look-top-bottom", sourceId, ordinal: 0 });
    expect(game.pendingChoice).toBeNull();
    expect(game.players[0]!.hand.some((card) => card.name === "Lightning Bolt")).toBe(true);
    expect(game.players[0]!.library.slice(-2).map((card) => card.name)).toEqual(["Grizzly Bears", "Forest"]);
  });

  it("can decline Augur's selection and bottom all reviewed cards", () => {
    let game = readyToCast([C13_AUGUR_OF_BOLAS()], [ISLAND(), ISLAND()]);
    game = stage(game, 0, () => ({ library: toHand(0, [FOREST(), BEAR(), BOLT()], "augur-decline") }));
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    const sourceId = (game.pendingChoice as Extract<GameState["pendingChoice"], { type: "look-top-select" }>).sourceId;
    game = applyAction(game, 0, { type: "finish-look-top", sourceId });
    while (game.pendingChoice?.type === "look-top-select") {
      game = applyAction(game, 0, { type: "choose-look-top-bottom", sourceId, ordinal: 0 });
    }
    expect(game.players[0]!.hand.some((card) => card.name === "Grizzly Bears")).toBe(false);
    expect(game.players[0]!.library.slice(-3).map((card) => card.name)).toEqual(["Forest", "Grizzly Bears", "Lightning Bolt"]);
  });

  it("exiles Act of Authority's target and transfers the source to that controller", () => {
    let game = readyToCast([C13_ACT_OF_AUTHORITY()], [PLAINS(), PLAINS(), PLAINS(), PLAINS()], [], [SOL_RING()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.pendingChoice).toMatchObject({ type: "trigger-target", targetKind: "artifact-or-enchantment" });
    const targetChoice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "trigger-target" }>;
    const ring = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Sol Ring")!;
    game = applyAction(game, 0, { type: "choose-trigger-target", sourceId: targetChoice.sourceId, target: { kind: "permanent", instanceId: ring.instance_id } });
    game = passUntil(game, (state) => state.pendingChoice?.type === "optional-trigger");
    const optional = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "optional-trigger" }>;
    game = applyAction(game, 0, { type: "choose-trigger", sourceId: optional.sourceId, accept: true });
    expect(game.players[1]!.battlefield.some((permanent) => permanent.card.name === "Sol Ring")).toBe(false);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Act of Authority")).toBe(true);
    expect(game.players[1]!.battlefield.some((permanent) => permanent.card.name === "Act of Authority")).toBe(false);

    game = putOnBattlefield(game, 1, [SOL_RING()]);
    game = stage(game, 0, () => ({ autoPass: true }));
    game = stage(game, 1, () => ({ autoPass: true }));
    game = passUntil(game, (state) => state.pendingChoice?.type === "trigger-target");
    const upkeepTarget = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "trigger-target" }>;
    const upkeepRing = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Sol Ring")!;
    game = applyAction(game, 0, { type: "choose-trigger-target", sourceId: upkeepTarget.sourceId, target: { kind: "permanent", instanceId: upkeepRing.instance_id } });
    game = passUntil(game, (state) => state.pendingChoice?.type === "optional-trigger");
    const upkeepOptional = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "optional-trigger" }>;
    game = applyAction(game, 0, { type: "choose-trigger", sourceId: upkeepOptional.sourceId, accept: true });
    expect(game.players[1]!.battlefield.some((permanent) => permanent.card.name === "Act of Authority")).toBe(true);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Act of Authority")).toBe(false);
  });

  it("lets Angel of Finality choose a player and exile that graveyard", () => {
    let game = readyToCast([C13_ANGEL_OF_FINALITY()], [PLAINS(), PLAINS(), PLAINS(), PLAINS()]);
    game = stage(game, 1, () => ({ graveyard: toHand(1, [BEAR(), FOREST()], "angel-yard") }));
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.pendingChoice).toMatchObject({ type: "trigger-target", targetKind: "player" });
    const choice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "trigger-target" }>;
    game = applyAction(game, 0, { type: "choose-trigger-target", sourceId: choice.sourceId, target: { kind: "player", seat: 1 } });
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[1]!.graveyard).toHaveLength(0);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Angel of Finality")).toBe(true);
  });

  it("gains the sacrificed creature's toughness with Disciple of Griselbrand", () => {
    const profile = profileOf(C13_DISCIPLE_OF_GRISELBRAND());
    expect(profile.activatedAbilities[0]).toMatchObject({
      sacrificesCreature: "any",
      manaCost: { symbols: [{ kind: "generic", amount: 1 }] },
      effect: { kind: "gain-life-equal-sacrificed-toughness" }
    });
    expect(profile.fullyImplemented).toBe(true);
    let game = readyToCast([], [C13_DISCIPLE_OF_GRISELBRAND(), WALL(), PLAINS()]);
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Disciple of Griselbrand")!;
    const victim = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Stone Wall")!;
    const action = legalActions(game, 0).find((entry) => entry.action.type === "activate"
      && entry.action.sourceId === source.instance_id && entry.action.sacrificeId === victim.instance_id)!;
    expect(action).toBeDefined();
    game = applyAction(game, 0, action.action);
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[0]!.life).toBe(44);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Stone Wall")).toBe(true);
  });
  it("sacrifices X Goats to add X mana and gain life with Springjack Pasture", () => {
    const profile = profileOf(C13_SPRINGJACK_PASTURE());
    expect(profile.manaAbilities).toMatchObject([
      { produces: ["C"], amount: 1, requiresTap: true },
      { sacrificesCreatures: { amount: "X", subtype: "Goat" }, amountFromSacrifice: true, gainLifeFromAmount: true, requiresTap: true }
    ]);
    expect(profile.fullyImplemented).toBe(true);
    let game = readyToCast([], [C13_SPRINGJACK_PASTURE(), GOAT(), GOAT()]);
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Springjack Pasture")!;
    expect(legalActions(game, 0).some((entry) => entry.action.type === "activate-mana"
      && entry.action.sourceId === source.instance_id && entry.action.variableAmount === 1)).toBe(true);
    const action = legalActions(game, 0).find((entry) => entry.action.type === "activate-mana"
      && entry.action.sourceId === source.instance_id && entry.action.variableAmount === 2 && entry.action.mana === "G")!;
    expect(action).toBeDefined();
    game = applyAction(game, 0, action.action);
    expect(game.players[0]!.manaPool.G).toBe(2);
    expect(game.players[0]!.life).toBe(42);
    expect(game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Springjack Pasture")?.tapped).toBe(true);
    expect(game.players[0]!.graveyard.filter((card) => card.name === "Goat")).toHaveLength(2);
  });

  it("untaps green and blue creatures during another player's untap step", () => {
    const profile = profileOf(MURKFIEND_LIEGE());
    expect(profile.untapColorsDuringOtherPlayersUntap).toEqual(["G", "U"]);
    expect(profile.fullyImplemented).toBe(true);
    let game = readyToCast([], [MURKFIEND_LIEGE(), FOREST()]);
    game = putOnBattlefield(game, 0, [MURKFIEND_LIEGE(), FOREST()]);
    game = stage(game, 0, (player) => ({ battlefield: player.battlefield.map((permanent) => ({ ...permanent, tapped: true })) }));
    game = passUntil(game, (state) => state.step === "untap" && state.activeSeat === 1);
    expect(game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Forest")?.tapped).toBe(false);
  });

  it("returns Razor Hippogriff's artifact and gains its mana value", () => {
    const profile = profileOf(C13_RAZOR_HIPPOGRIFF());
    expect(profile.triggers[0]).toMatchObject({
      event: "enters-battlefield", optional: true,
      targetKind: "artifact-card-in-your-graveyard",
      effect: { kind: "return-target-artifact-and-gain-mana-value" }
    });
    expect(profile.fullyImplemented).toBe(true);
    let game = readyToCast([C13_RAZOR_HIPPOGRIFF()], [PLAINS(), PLAINS(), PLAINS(), PLAINS(), PLAINS()]);
    game = stage(game, 0, () => ({ graveyard: toHand(0, [SOL_RING()], "hippogriff-yard") }));
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    if (game.pendingChoice?.type === "trigger-target") {
      const choice = game.pendingChoice;
      game = applyAction(game, 0, { type: "choose-trigger-target", sourceId: choice.sourceId, target: choice.options[0]! });
    }
    game = passUntil(game, (state) => state.pendingChoice?.type === "optional-trigger");
    const optional = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "optional-trigger" }>;
    game = applyAction(game, 0, { type: "choose-trigger", sourceId: optional.sourceId, accept: true });
    expect(game.players[0]!.life).toBe(41);
    expect(game.players[0]!.hand.some((card) => card.name === "Sol Ring")).toBe(true);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Sol Ring")).toBe(false);
  });

  it("protects qualifying creature spells from counters with Spellbreaker Behemoth", () => {
    const profile = profileOf(C13_SPELLBREAKER_BEHEMOTH());
    expect(profile.uncounterableCreaturePowerThreshold).toBe(5);
    expect(profile.fullyImplemented).toBe(true);
    const counter = make({ name: "Mental Misstep", type_line: "Instant", mana_cost: "{U/P}", cmc: 1, oracle_text: "Counter target spell." });
    let game = readyToCast([counter], [ISLAND(), ISLAND()]);
    game = putOnBattlefield(game, 1, [C13_SPELLBREAKER_BEHEMOTH()]);
    const targetCard = toHand(1, [make({ name: "Large creature", type_line: "Creature — Beast", mana_cost: "{1}", cmc: 1, power: "5", toughness: "5" })])[0]!;
    game = { ...game, stack: [{ id: "subject", controller: 1, card: targetCard, label: targetCard.name, targets: [], fromCommandZone: false, variableValue: 0, countered: false }] };
    expect(hasRealChoice(game, 0)).toBe(false);
    const cast = legalActions(game, 0).find((entry) => entry.action.type === "cast")!;
    game = applyAction(game, 0, { ...cast.action, targets: [{ kind: "spell", stackId: game.stack[0]!.id }] } as Extract<import("./engine.js").GameAction, { type: "cast" }>);
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[1]!.battlefield.some((permanent) => permanent.card.name === "Large creature")).toBe(true);
  });

  it("delays Flickerwisp's exiled permanent until the next end step", () => {
    const profile = profileOf(C13_FLICKERWISP());
    expect(profile.triggers[0]).toMatchObject({
      event: "enters-battlefield",
      effect: { kind: "exile-target-permanent-delayed-return" },
      targetKind: "permanent",
      excludesSourceFromTargets: true
    });
    expect(profile.fullyImplemented).toBe(true);
    let game = readyToCast([C13_FLICKERWISP()], [PLAINS(), PLAINS(), PLAINS()], [], [BEAR()]);
    game = { ...game, players: game.players.map((player) => ({ ...player, autoPass: false })) };
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = passUntil(game, (state) => state.pendingChoice?.type === "trigger-target" || state.delayedReturns.length === 1);
    if (game.pendingChoice?.type === "trigger-target") {
      const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Flickerwisp")!;
      const choice = game.pendingChoice;
      expect(choice.options.some((target) => target.kind === "permanent" && target.instanceId === source.instance_id)).toBe(false);
      const bear = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
      const target = choice.options.find((candidate) => candidate.kind === "permanent" && candidate.instanceId === bear.instance_id)!;
      game = applyAction(game, 0, { type: "choose-trigger-target", sourceId: choice.sourceId, target });
    }
    game = passUntil(game, (state) => state.delayedReturns.length === 1);
    expect(game.players[1]!.battlefield.some((permanent) => permanent.card.name === "Grizzly Bears")).toBe(false);
    expect(game.players[1]!.exile.some((card) => card.name === "Grizzly Bears")).toBe(true);
    game = passUntil(game, (state) => state.players[1]!.battlefield.some((permanent) => permanent.card.name === "Grizzly Bears"));
    expect(game.delayedReturns).toHaveLength(0);
    expect(game.players[1]!.exile.some((card) => card.name === "Grizzly Bears")).toBe(false);
  });

  it("returns Fiend Hunter's linked creature when the Hunter leaves", () => {
    const profile = profileOf(C13_FIEND_HUNTER());
    expect(profile).toMatchObject({
      fullyImplemented: true,
      triggers: [
        { event: "enters-battlefield", effect: { kind: "exile-target-nontoken-creature", returnOnSourceLeave: true }, targetKind: "nontoken-creature", excludesSourceFromTargets: true },
        { event: "leaves-battlefield", effect: { kind: "return-exiled-card" }, targetKind: "none" }
      ]
    });
    let game = readyToCast([C13_FIEND_HUNTER(), DESTROY_TARGET_CREATURE()], [PLAINS(), PLAINS(), PLAINS(), SWAMP(), SWAMP()], [], [BEAR(), BEAR()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = passUntil(game, (state) => state.pendingChoice?.type === "trigger-target" || state.pendingChoice?.type === "optional-trigger");
    const targetChoice = game.pendingChoice?.type === "trigger-target" ? game.pendingChoice : null;
    const hunter = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Fiend Hunter")!;
    const bear = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    if (targetChoice) {
      expect(targetChoice.options).toContainEqual({ kind: "permanent", instanceId: bear.instance_id });
      expect(targetChoice.options).not.toContainEqual({ kind: "permanent", instanceId: hunter.instance_id });
      game = applyAction(game, 0, { type: "choose-trigger-target", sourceId: targetChoice.sourceId, target: { kind: "permanent", instanceId: bear.instance_id } });
      game = passUntil(game, (state) => state.pendingChoice?.type === "optional-trigger");
    }
    const optional = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "optional-trigger" }>;
    game = applyAction(game, 0, { type: "choose-trigger", sourceId: optional.sourceId, accept: true });
    expect(game.players[1]!.exile.some((card) => card.instance_id === bear.card.instance_id)).toBe(true);
    const removal = game.players[0]!.hand.find((card) => card.name === "Destroy Target Creature")!;
    game = applyAction(game, 0, { type: "cast", cardId: removal.instance_id, targets: [{ kind: "permanent", instanceId: hunter.instance_id }] });
    expect(game.players[0]!.graveyard.some((card) => card.name === "Fiend Hunter")).toBe(true);
    expect(game.players[1]!.exile.some((card) => card.instance_id === bear.card.instance_id)).toBe(false);
    expect(game.players[1]!.battlefield.some((permanent) => permanent.card.instance_id === bear.card.instance_id)).toBe(true);
  });

  it("captures Vile Requiem's verse counters before its self-sacrifice", () => {
    const profile = profileOf(C13_VILE_REQUIEM());
    expect(profile.triggers[0]).toMatchObject({
      event: "upkeep",
      optional: true,
      effect: { kind: "add-counter-source", counter: "verse", amount: 1 }
    });
    expect(profile.activatedAbilities[0]).toMatchObject({
      sacrificesSelf: true,
      manaCost: { raw: "{1}{B}" },
      targetKind: "nonblack-creature",
      effect: { kind: "destroy-n-creatures", count: "X", nonblack: true, counter: "verse" }
    });
    expect(profile.fullyImplemented).toBe(true);

    let game = readyToCast([], [C13_VILE_REQUIEM(), SWAMP(), SWAMP()], [], [BEAR(), TRAMPLER()]);
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Vile Requiem")!;
    game = stage(game, 0, (player) => ({
      battlefield: player.battlefield.map((permanent) => permanent.instance_id === source.instance_id
        ? { ...permanent, counters: { ...permanent.counters, verse: 2 } }
        : permanent)
    }));
    game = { ...game, players: game.players.map((player) => ({ ...player, autoPass: false })) };
    const targets = game.players[1]!.battlefield.map((permanent) => ({ kind: "permanent" as const, instanceId: permanent.instance_id }));
    game = applyAction(game, 0, { type: "activate", sourceId: source.instance_id, abilityIndex: 0, targets });
    expect(game.stack.at(-1)?.variableValue).toBe(2);
    game = passUntil(game, (state) => state.pendingChoice === null && state.stack.length === 0);

    expect(game.players[0]!.graveyard.some((card) => card.name === "Vile Requiem")).toBe(true);
    expect(game.players[1]!.battlefield.filter((permanent) => profileOf(permanent.card).types.includes("Creature"))).toHaveLength(0);
  });

  it("offers Well of Lost Dreams X up to the life-gain event amount", () => {
    const profile = profileOf(C13_WELL_OF_LOST_DREAMS());
    expect(profile.triggers[0]).toMatchObject({
      event: "life-gained",
      optional: true,
      effect: { kind: "draw", amount: "X" },
      payCost: { raw: "{X}" },
      variablePayCost: "event-amount"
    });
    expect(profile.fullyImplemented).toBe(true);
    let game = readyToCast([TARGET_LIFE_SPELL()], [C13_WELL_OF_LOST_DREAMS(), FOREST(), FOREST(), FOREST()]);
    game = { ...game, players: game.players.map((player) => ({ ...player, autoPass: false })) };
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 0 }] });
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "pass" });
    game = passUntil(game, (state) => state.pendingChoice?.type === "optional-trigger");
    const choice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "optional-trigger" }>;
    expect(choice.variablePayCostMax).toBe(2);
    const xTwo = legalActions(game, 0).find((entry) => entry.action.type === "choose-trigger" && entry.action.accept && entry.action.variableValue === 2);
    expect(xTwo).toBeDefined();
    game = applyAction(game, 0, xTwo!.action);
    expect(game.players[0]!.hand).toHaveLength(2);
    expect(game.players[0]!.life).toBe(42);
  });

  it("reuses the tapped self-counter primitive for Phantom Nantuko", () => {
    const profile = profileOf(C13_PHANTOM_NANTUKO());
    expect(profile).toMatchObject({
      fullyImplemented: true,
      preventsDamageByRemovingCounter: "+1/+1",
      activatedAbilities: [expect.objectContaining({ requiresTap: true, effect: { kind: "add-counter-source", counter: "+1/+1", amount: 1 } })]
    });
    let game = readyToCast([C13_PHANTOM_NANTUKO()], [FOREST(), FOREST(), FOREST(), FOREST()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = stage(game, 0, (player) => ({ battlefield: player.battlefield.map((permanent) => ({ ...permanent, summoningSick: false })) }));
    const phantom = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Phantom Nantuko")!;
    expect(phantom.counters["+1/+1"]).toBe(2);
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate"
      && entry.action.sourceId === phantom.instance_id && entry.action.abilityIndex === 0)!;
    if (activation.action.type !== "activate") throw new Error("Phantom Nantuko counter activation was not offered.");
    game = applyAction(game, 0, activation.action);
    game = passUntil(game, (state) => state.pendingChoice === null && state.stack.length === 0);
    expect(game.players[0]!.battlefield.find((permanent) => permanent.instance_id === phantom.instance_id)!.counters["+1/+1"]).toBe(3);

    let damageGame = readyToCast([CHANDRAS_OUTRAGE()], [C13_PHANTOM_NANTUKO(), MOUNTAIN(), MOUNTAIN(), MOUNTAIN(), MOUNTAIN()]);
    const damageTarget = damageGame.players[0]!.battlefield.find((permanent) => permanent.card.name === "Phantom Nantuko")!;
    damageGame = applyAction(damageGame, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: damageTarget.instance_id }] });
    damageGame = passUntil(damageGame, (state) => state.pendingChoice === null && state.stack.length === 0);
    const damagedPhantom = damageGame.players[0]!.battlefield.find((permanent) => permanent.instance_id === damageTarget.instance_id)!;
    expect(damagedPhantom.counters["+1/+1"]).toBe(1);
    expect(damagedPhantom.damage).toBe(0);
  });

  it("resolves Oloro's optional life-gain draw and opponent life loss", () => {
    const profile = profileOf(C13_OLORO());
    const lifeTrigger = profile.triggers.find((trigger) => trigger.event === "life-gained");
    expect(lifeTrigger).toMatchObject({
      event: "life-gained",
      optional: true,
      payCost: { raw: "{1}" },
      effect: { kind: "compound", effects: [
        { kind: "draw", amount: 1 },
        { kind: "each-opponent-loses-life", amount: 1 }
      ] }
    });
    expect(profile.fullyImplemented).toBe(true);

    let game = readyToCast([TARGET_LIFE_SPELL()], [C13_OLORO(), FOREST(), FOREST()]);
    game = { ...game, players: game.players.map((player) => ({ ...player, autoPass: false })) };
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 0 }] });
    game = passUntil(game, (state) => state.pendingChoice?.type === "optional-trigger");
    const choice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "optional-trigger" }>;
    expect(choice.sourceCard.name).toBe("Oloro, Ageless Ascetic");
    const handBefore = game.players[0]!.hand.length;
    const opponentLifeBefore = game.players[1]!.life;
    game = applyAction(game, 0, { type: "choose-trigger", sourceId: choice.sourceId, accept: true });
    expect(game.players[0]!.hand).toHaveLength(handBefore + 1);
    expect(game.players[1]!.life).toBe(opponentLifeBefore - 1);
  });

  it("resolves Bojuka Bog's ETB exile while preserving its tapped land entry", () => {
    let game = readyToCast([C13_BOJUKA_BOG()], []);
    game = stage(game, 1, () => ({ graveyard: toHand(1, [BEAR()], "bog-yard") }));
    game = applyAction(game, 0, { type: "play-land", cardId: "hand-0" });
    expect(game.pendingChoice).toMatchObject({ type: "trigger-target", targetKind: "player" });
    const choice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "trigger-target" }>;
    game = applyAction(game, 0, { type: "choose-trigger-target", sourceId: choice.sourceId, target: { kind: "player", seat: 1 } });
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[1]!.graveyard).toHaveLength(0);
    expect(game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Bojuka Bog")?.tapped).toBe(true);
  });

  it("destroys only the legal nonblack target before drawing", () => {
    let game = readyToCast([C13_ANNIHILATE()], [SWAMP(), SWAMP(), SWAMP(), SWAMP(), SWAMP()], [], [BEAR(), BLACK_BLOCKER()]);
    game = stage(game, 0, () => ({ library: toHand(0, [FOREST()], "annihilate-library") }));
    const bear = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    const black = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Dusk Bat")!;
    expect(legalTargets(game, 0, "nonblack-creature")).toContainEqual({ kind: "permanent", instanceId: bear.instance_id });
    expect(legalTargets(game, 0, "nonblack-creature")).not.toContainEqual({ kind: "permanent", instanceId: black.instance_id });
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: bear.instance_id }] });
    expect(game.players[1]!.battlefield.some((permanent) => permanent.instance_id === bear.instance_id)).toBe(false);
    expect(game.players[1]!.battlefield.some((permanent) => permanent.instance_id === black.instance_id)).toBe(true);
    expect(game.players[0]!.hand.map((card) => card.name)).toEqual(["Forest"]);
  });

  it("resolves Phyrexian Gargantua's compound ETB draw and life loss", () => {
    let game = readyToCast([C13_PHYREXIAN_GARGANTUA()], [SWAMP(), SWAMP(), SWAMP(), SWAMP(), SWAMP(), SWAMP()]);
    game = stage(game, 0, () => ({ library: toHand(0, [FOREST(), PLAINS()], "gargantua-library") }));
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.players[0]!.life).toBe(38);
    expect(game.players[0]!.hand.map((card) => card.name)).toEqual(["Forest", "Plains"]);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Phyrexian Gargantua")).toBe(true);
  });

  it("resolves Baleful Strix ETB draw when the artifact creature enters", () => {
    let game = readyToCast([C13_BALEFUL_STRIX()], [ISLAND(), SWAMP()]);
    game = stage(game, 0, () => ({ library: toHand(0, [FOREST()], "strix-library") }));
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Baleful Strix")).toBe(true);
    expect(game.players[0]!.hand.map((card) => card.name)).toEqual(["Forest"]);
  });

  it("resolves C13 draw-only spells through the shared draw engine", () => {
    for (const [spell, lands] of [
      [C13_BRILLIANT_PLAN(), [ISLAND(), ISLAND(), ISLAND(), ISLAND(), ISLAND()]],
      [C13_HARMONIZE(), [FOREST(), FOREST(), FOREST(), FOREST()]]
    ] as const) {
      let game = readyToCast([spell], lands);
      game = stage(game, 0, () => ({ library: toHand(0, [BEAR(), FLIER(), FOREST()], `draw-${spell.name}`) }));
      game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
      expect(game.players[0]!.hand.map((card) => card.name)).toEqual(["Grizzly Bears", "Storm Crow", "Forest"]);
    }
  });

  it("resolves Vision Skeins for every living player", () => {
    let game = readyToCast([C13_VISION_SKEINS()], [ISLAND(), ISLAND()], [BEAR()]);
    game = stage(game, 0, () => ({ library: toHand(0, [FOREST(), PLAINS()], "vision-caster") }));
    game = stage(game, 1, () => ({ library: toHand(1, [MOUNTAIN(), SWAMP()], "vision-opponent") }));
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.players[0]!.hand.map((card) => card.name)).toEqual(["Forest", "Plains"]);
    expect(game.players[1]!.hand.map((card) => card.name)).toEqual(["Grizzly Bears", "Mountain", "Swamp"]);
  });

  it("reuses target draw for Deep Analysis and pays its Flashback life", () => {
    let game = readyToCast([C13_DEEP_ANALYSIS()], [ISLAND(), ISLAND(), ISLAND(), ISLAND()], [BEAR()]);
    game = stage(game, 1, () => ({ library: toHand(1, [FOREST(), PLAINS()], "analysis-target") }));
    game = applyAction(game, 0, {
      type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 1 }]
    });
    expect(game.players[1]!.hand.map((card) => card.name)).toEqual(["Grizzly Bears", "Forest", "Plains"]);

    game = readyToCast([], [ISLAND(), ISLAND()]);
    game = stage(game, 0, (player) => ({
      life: 10,
      graveyard: toHand(0, [C13_DEEP_ANALYSIS()], "analysis-flashback"),
      library: toHand(0, [FOREST(), PLAINS()], "analysis-flashback-library")
    }));
    const flashback = legalActions(game, 0).find((entry) => entry.action.type === "cast"
      && entry.action.fromGraveyard
      && entry.action.cardId === "analysis-flashback-0");
    expect(flashback).toBeDefined();
    game = applyAction(game, 0, flashback!.action);
    expect(game.players[0]!.life).toBe(7);
    expect(game.players[0]!.hand.map((card) => card.name)).toEqual(["Forest", "Plains"]);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Deep Analysis")).toBe(false);
    expect(game.players[0]!.exile.some((card) => card.name === "Deep Analysis")).toBe(true);
  });

  it("does not offer Flashback when its printed life payment is unavailable", () => {
    let game = readyToCast([], [ISLAND(), ISLAND()]);
    game = stage(game, 0, (player) => ({
      life: 2,
      graveyard: toHand(0, [C13_DEEP_ANALYSIS()], "analysis-too-little-life")
    }));
    expect(legalActions(game, 0).some((entry) => entry.action.type === "cast"
      && entry.action.fromGraveyard
      && entry.action.cardId === "analysis-too-little-life-0")).toBe(false);
  });

  it("offers and pays a chosen untapped Wizard for Azami", () => {
    let game = readyToCast([], [C13_AZAMI(), AZAMI_WIZARD(), BEAR()]);
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Azami, Lady of Scrolls")!;
    const wizard = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Library Wizard")!;
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate"
      && entry.action.sourceId === source.instance_id
      && entry.action.tapId === wizard.instance_id);
    expect(activation).toBeDefined();
    expect(activation!.label).toContain("Tap Library Wizard");
    game = applyAction(game, 0, activation!.action);
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[0]!.hand).toHaveLength(1);
    expect(game.players[0]!.battlefield.find((permanent) => permanent.instance_id === wizard.instance_id)!.tapped).toBe(true);
    expect(game.players[0]!.battlefield.find((permanent) => permanent.instance_id === source.instance_id)!.tapped).toBe(false);
  });

  it("pays energy from player counters for an activated ability", () => {
    const energyDevice = make({
      name: "Energy Device", type_line: "Artifact", mana_cost: "{2}", cmc: 2,
      oracle_text: "{T}, Pay {E}: Draw a card."
    });
    let game = readyToCast([], [energyDevice]);
    game = stage(game, 0, (player) => ({ counters: { energy: 1 } }));
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Energy Device")!;
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.action.sourceId === source.instance_id);
    expect(activation).toBeDefined();
    game = applyAction(game, 0, activation!.action);
    expect(game.players[0]!.counters).toEqual({ energy: 0 });
    expect(game.players[0]!.battlefield.find((permanent) => permanent.instance_id === source.instance_id)!.tapped).toBe(true);
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[0]!.hand.length).toBe(1);

    game = readyToCast([], [energyDevice]);
    game = stage(game, 0, (player) => ({ counters: {} }));
    const unavailable = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Energy Device")!;
    expect(legalActions(game, 0).some((entry) => entry.action.type === "activate" && entry.action.sourceId === unavailable.instance_id)).toBe(false);
  });

  it("opens explicit mana-source selection for activated abilities with non-interchangeable sources", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ autoPass: false, kind: "human", hand: [] }));
    game = putOnBattlefield(game, 0, [SIGNAL_PEST(), ISLAND(), MOUNTAIN()], { entered: false });
    game = { ...game, step: "precombat-main", activeSeat: 0, prioritySeat: 0, priorityOpen: true, stack: [], triggerQueue: [], pendingChoice: null };
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Well of Lore")!;
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.action.sourceId === source.instance_id)!;
    game = applyAction(game, 0, activation.action);
    expect(game.pendingChoice).toMatchObject({ type: "mana-payment", continuation: { type: "activate", sourceId: source.instance_id } });
    expect(game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Island")!.tapped).toBe(false);
    const choice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "mana-payment" }>;
    const blue = legalActions(game, 0).find((entry) => entry.action.type === "choose-mana-source" && entry.action.mana === "U");
    expect(blue).toBeDefined();
    game = applyAction(game, 0, blue!.action);
    const generic = legalActions(game, 0).find((entry) => entry.action.type === "choose-mana-source" && entry.action.manaSourceId !== choice.selected[0]?.sourceId);
    expect(generic).toBeDefined();
    game = applyAction(game, 0, generic!.action);
    expect(game.pendingChoice).toBeNull();
    expect(game.stack.at(-1)?.activated).toBeDefined();
  });

  it("resolves energy production into public player counters", () => {
    const energyBurst = make({
      name: "Energy Burst", type_line: "Instant", mana_cost: "{1}{G}", cmc: 2,
      oracle_text: "You get {E}{E}."
    });
    let game = readyToCast([energyBurst], [FOREST(), FOREST()]);
    expect(profileOf(energyBurst).effects).toEqual([{ kind: "add-player-counter", counter: "energy", amount: 2 }]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[0]!.counters).toEqual({ energy: 2 });
  });

  it("requires a tapped, continuously controlled permanent for an untap-symbol activation", () => {
    const untapDevice = make({
      name: "Untap Device", type_line: "Artifact", mana_cost: "{2}", cmc: 2,
      oracle_text: "{Q}: Draw a card."
    });
    let game = readyToCast([], [untapDevice]);
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Untap Device")!;
    game = stage(game, 0, (player) => ({
      battlefield: player.battlefield.map((permanent) => permanent.instance_id === source.instance_id ? { ...permanent, tapped: true } : permanent)
    }));
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.action.sourceId === source.instance_id);
    expect(activation).toBeDefined();
    game = applyAction(game, 0, activation!.action);
    expect(game.players[0]!.battlefield.find((permanent) => permanent.instance_id === source.instance_id)!.tapped).toBe(false);
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[0]!.hand.length).toBe(1);

    game = readyToCast([], [untapDevice]);
    const freshSource = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Untap Device")!;
    expect(legalActions(game, 0).some((entry) => entry.action.type === "activate" && entry.action.sourceId === freshSource.instance_id)).toBe(false);
  });

  it("does not offer a typed tap activation without an untapped matching creature", () => {
    let game = readyToCast([], [C13_AZAMI(), BEAR()]);
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Azami, Lady of Scrolls")!;
    game = stage(game, 0, (player) => ({
      battlefield: player.battlefield.map((permanent) => permanent.instance_id === source.instance_id ? { ...permanent, tapped: true } : permanent)
    }));
    expect(legalActions(game, 0).some((entry) => entry.action.type === "activate" && entry.action.sourceId === source.instance_id)).toBe(false);

    game = readyToCast([], [C13_AZAMI(), AZAMI_WIZARD()], [], []);
    const wizard = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Library Wizard")!;
    game = stage(game, 0, (player) => ({
      battlefield: player.battlefield.map((permanent) => permanent.instance_id === wizard.instance_id || permanent.card.name === "Azami, Lady of Scrolls" ? { ...permanent, tapped: true } : permanent)
    }));
    const stagedSource = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Azami, Lady of Scrolls")!;
    expect(legalActions(game, 0).some((entry) => entry.action.type === "activate" && entry.action.sourceId === stagedSource.instance_id)).toBe(false);
  });

  it("rejects a forged tap target that does not match the typed cost", () => {
    const game = readyToCast([], [C13_AZAMI(), AZAMI_WIZARD(), BEAR()]);
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Azami, Lady of Scrolls")!;
    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    expect(() => applyAction(game, 0, {
      type: "activate", sourceId: source.instance_id, abilityIndex: 0, tapId: bear.instance_id
    })).toThrow();
  });

  it("honors another when excluding the activation source from a tap cost", () => {
    const sourceCard = make({
      name: "Wizard Chorus", type_line: "Creature — Human Wizard", mana_cost: "{2}{U}", cmc: 3, power: "2", toughness: "2",
      oracle_text: "Tap another untapped creature you control: Draw a card."
    });
    let game = readyToCast([], [sourceCard, BEAR()]);
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Wizard Chorus")!;
    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    const actions = legalActions(game, 0).filter((entry) => entry.action.type === "activate" && entry.action.sourceId === source.instance_id);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.action).toMatchObject({ tapId: bear.instance_id });
    game = applyAction(game, 0, actions[0]!.action);
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[0]!.hand).toHaveLength(1);
    expect(game.players[0]!.battlefield.find((permanent) => permanent.instance_id === bear.instance_id)!.tapped).toBe(true);
  });

  it("offers and pays a chosen creature sacrifice activation cost", () => {
    const profile = profileOf(CARNAGE_ALTAR());
    expect(profile.activatedAbilities[0]).toMatchObject({ sacrificesCreature: "any", effect: { kind: "draw", amount: 1 } });
    let game = readyToCast([], [FOREST(), FOREST(), FOREST(), CARNAGE_ALTAR(), BEAR()]);
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Carnage Memory")!;
    const creature = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.action.sourceId === source.instance_id && entry.action.sacrificeId === creature.instance_id);
    expect(activation).toBeDefined();
    game = applyAction(game, 0, activation!.action);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.instance_id === creature.instance_id)).toBe(false);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);
    expect(game.players[0]!.hand).toHaveLength(1);
  });

  it("reuses sacrificed-toughness life gain for C13 Disciple of Griselbrand", () => {
    const profile = profileOf(C13_DISCIPLE_OF_GRISELBRAND());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.activatedAbilities[0]).toMatchObject({
      sacrificesCreature: "any", effect: { kind: "gain-life-equal-sacrificed-toughness" }
    });
    let game = readyToCast([], [C13_DISCIPLE_OF_GRISELBRAND(), TRAMPLER(), SWAMP()]);
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Disciple of Griselbrand")!;
    const sacrifice = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Big Stomper")!;
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate"
      && entry.action.sourceId === source.instance_id && entry.action.sacrificeId === sacrifice.instance_id);
    expect(activation).toBeDefined();
    const life = game.players[0]!.life;
    game = applyAction(game, 0, activation!.action);
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[0]!.life).toBe(life + 6);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Big Stomper")).toBe(true);
  });

  it("restricts Ravenous Baloth's sacrifice cost to Beasts and gains life", () => {
    const baloth = RAVENOUS_BALOTH();
    let game = readyToCast([], [baloth, TRAMPLER(), BEAR()]);
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === baloth.name)!;
    const beast = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Big Stomper")!;
    expect(legalActions(game, 0).some((entry) => entry.action.type === "activate"
      && entry.action.sourceId === source.instance_id
      && entry.action.sacrificeId === beast.instance_id)).toBe(true);
    expect(legalActions(game, 0).some((entry) => entry.action.type === "activate"
      && entry.action.sourceId === source.instance_id
      && entry.action.sacrificeId === game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!.instance_id)).toBe(false);
    game = applyAction(game, 0, {
      type: "activate", sourceId: source.instance_id, abilityIndex: 0, sacrificeId: beast.instance_id
    });
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[0]!.life).toBe(44);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Big Stomper")).toBe(true);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === baloth.name)).toBe(true);
  });

  it("offers typed permanent sacrifice costs and moves the chosen permanent", () => {
    for (const [altar, sacrificedName, expectedType] of [
      [ARTIFACT_SAC_ALTAR(), "Artifact Memory", "Artifact"],
      [ENCHANTMENT_SAC_ALTAR(), "Pacifism", "Enchantment"],
      [LAND_SAC_ALTAR(), "Forest", "Land"]
    ] as const) {
      const sacrificed = sacrificedName === "Artifact Memory"
        ? ARTIFACT_SAC_ALTAR()
        : sacrificedName === "Pacifism"
          ? make({ name: "Pacifism", type_line: "Enchantment — Aura", mana_cost: "{1}{W}", cmc: 2, oracle_text: "Enchant creature" })
          : FOREST();
      const profile = profileOf(altar);
      expect(profile.activatedAbilities[0]).toMatchObject({ sacrificesPermanent: { type: expectedType, mode: "any" } });
      let game = readyToCast([], [altar, sacrificed]);
      const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === altar.name)!;
      const target = game.players[0]!.battlefield.find((permanent) => permanent.card.name === sacrificedName)!;
      const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.action.sourceId === source.instance_id && entry.action.sacrificeId === target.instance_id);
      expect(activation).toBeDefined();
      game = applyAction(game, 0, activation!.action);
      expect(game.players[0]!.battlefield.some((permanent) => permanent.instance_id === target.instance_id)).toBe(false);
      expect(game.players[0]!.graveyard.some((card) => card.name === sacrificedName)).toBe(true);
    }
  });

  it("offers and pays two distinct creature sacrifice costs for Tooth and Claw", () => {
    let game = readyToCast([], [TOOTH_AND_CLAW(), BEAR(), TRAMPLER()]);
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Tooth and Claw")!;
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate"
      && entry.action.sourceId === source.instance_id
      && entry.action.sacrificeIds?.length === 2);
    expect(activation).toBeDefined();
    game = applyAction(game, 0, activation!.action);
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[0]!.graveyard.map((card) => card.name)).toEqual(expect.arrayContaining(["Grizzly Bears", "Big Stomper"]));
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Carnivore")).toBe(true);
  });

  it("does not offer the source for an another-artifact sacrifice cost", () => {
    const sourceCard = ANOTHER_ARTIFACT_SAC();
    const profile = profileOf(sourceCard);
    expect(profile.activatedAbilities[0]).toMatchObject({ sacrificesPermanent: { type: "Artifact", mode: "another" } });
    let game = readyToCast([], [sourceCard]);
    const source = game.players[0]!.battlefield[0]!;
    expect(legalActions(game, 0).some((entry) => entry.action.type === "activate" && entry.action.sourceId === source.instance_id)).toBe(false);
    game = readyToCast([], [sourceCard, ARTIFACT_SAC_ALTAR()]);
    const sourceAgain = game.players[0]!.battlefield.find((permanent) => permanent.card.name === sourceCard.name)!;
    const second = game.players[0]!.battlefield.find((permanent) => permanent.instance_id !== sourceAgain.instance_id)!;
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.action.sourceId === sourceAgain.instance_id && entry.action.sacrificeId === second.instance_id);
    expect(activation).toBeDefined();
  });

  it("accepts any noncreature permanent but excludes creatures", () => {
    const sourceCard = NONCREATURE_SAC();
    expect(profileOf(sourceCard).activatedAbilities[0]).toMatchObject({ sacrificesPermanent: { type: "Noncreature", mode: "any" } });
    let game = readyToCast([], [sourceCard, BEAR(), FOREST()]);
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === sourceCard.name)!;
    const land = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Forest")!;
    expect(legalActions(game, 0).some((entry) => entry.action.type === "activate" && entry.action.sourceId === source.instance_id && entry.action.sacrificeId === land.instance_id)).toBe(true);
    expect(legalActions(game, 0).some((entry) => entry.action.type === "activate" && entry.action.sourceId === source.instance_id && entry.action.sacrificeId !== land.instance_id && entry.action.sacrificeId)).toBe(false);
  });

  it("projects and pays a chosen card discarded as an activation cost", () => {
    const sourceCard = DISCARD_ACTIVATION();
    expect(profileOf(sourceCard).activatedAbilities[0]).toMatchObject({ discardsCard: true, requiresTap: true, effect: { kind: "draw", amount: 1 } });
    const discarded = BEAR();
    let game = readyToCast([discarded], [sourceCard]);
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === sourceCard.name)!;
    const card = game.players[0]!.hand.find((candidate) => candidate.name === discarded.name)!;
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.action.sourceId === source.instance_id && entry.action.discardCardId === card.instance_id);
    expect(activation).toBeDefined();
    game = applyAction(game, 0, activation!.action);
    expect(game.players[0]!.hand.some((candidate) => candidate.instance_id === card.instance_id)).toBe(false);
    expect(game.players[0]!.graveyard.some((candidate) => candidate.instance_id === card.instance_id)).toBe(true);
  });

  it("pays the explicitly selected discard when several hand cards are available", () => {
    const sourceCard = DISCARD_ACTIVATION();
    let game = readyToCast([BEAR(), SOL_RING()], [sourceCard]);
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === sourceCard.name)!;
    const selected = game.players[0]!.hand.find((card) => card.name === "Grizzly Bears")!;
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate"
      && entry.action.sourceId === source.instance_id && entry.action.discardCardId === selected.instance_id)!;
    game = applyAction(game, 0, activation.action);
    expect(game.players[0]!.graveyard.some((card) => card.instance_id === selected.instance_id)).toBe(true);
    expect(game.players[0]!.hand.some((card) => card.name === "Sol Ring")).toBe(true);
  });

  it("rejects an activation that names a card outside the available cost choices", () => {
    let game = readyToCast([BEAR()], [DISCARD_ACTIVATION()]);
    const source = game.players[0]!.battlefield[0]!;
    expect(() => applyAction(game, 0, {
      type: "activate", sourceId: source.instance_id, abilityIndex: 0, discardCardId: "not-in-hand"
    })).toThrow();
  });

  it("combines sacrifice and discard choices in one atomic activation", () => {
    const sourceCard = COMBINED_COST_ACTIVATION();
    expect(profileOf(sourceCard).activatedAbilities[0]).toMatchObject({ sacrificesPermanent: { type: "Artifact" }, discardsCard: true });
    let game = readyToCast([BEAR()], [sourceCard, ARTIFACT_SAC_ALTAR()]);
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === sourceCard.name)!;
    const sacrifice = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Artifact Memory")!;
    const discard = game.players[0]!.hand[0]!;
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.action.sourceId === source.instance_id && entry.action.sacrificeId === sacrifice.instance_id && entry.action.discardCardId === discard.instance_id);
    expect(activation).toBeDefined();
    game = applyAction(game, 0, activation!.action);
    expect(game.players[0]!.graveyard.map((card) => card.name)).toEqual(expect.arrayContaining(["Artifact Memory", "Grizzly Bears"]));
  });

  it("offers any other permanent for a generic permanent sacrifice cost", () => {
    const sourceCard = PERMANENT_SAC_ACTIVATION();
    expect(profileOf(sourceCard).activatedAbilities[0]).toMatchObject({ sacrificesPermanent: { type: "Permanent", mode: "another" } });
    let game = readyToCast([], [sourceCard, TEST_ARTIFACT(), BEAR()]);
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === sourceCard.name)!;
    const artifact = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Test Relic")!;
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.action.sourceId === source.instance_id && entry.action.sacrificeId === artifact.instance_id);
    expect(activation).toBeDefined();
    expect(legalActions(game, 0).some((entry) => entry.action.type === "activate" && entry.action.sourceId === source.instance_id && entry.action.sacrificeId === source.instance_id)).toBe(false);
  });

  it("filters generic graveyard return to permanent cards", () => {
    const permanent = make({ name: "Dead Relic", type_line: "Artifact" });
    const instant = make({ name: "Dead Trick", type_line: "Instant", mana_cost: "{U}" });
    let game = readyToCast([GENERIC_REANIMATE()], [SWAMP(), SWAMP(), SWAMP()]);
    game = stage(game, 0, () => ({ graveyard: toHand(0, [permanent, instant], "generic-reanimate") }));
    const targets = legalTargets(game, 0, "permanent-card-in-your-graveyard");
    expect(targets).toHaveLength(1);
    let target = targets[0]!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [target] });
    expect(game.players[0]!.battlefield.some((candidate) => candidate.card.name === "Dead Relic")).toBe(true);
    expect(game.players[0]!.graveyard.some((candidate) => candidate.name === "Dead Trick")).toBe(true);
  });

  it("can return a permanent from either graveyard under the caster's control", () => {
    const permanent = make({ name: "Opponent Relic", type_line: "Artifact" });
    const instant = make({ name: "Opponent Trick", type_line: "Instant", mana_cost: "{U}" });
    let game = readyToCast([CROSS_GENERIC_REANIMATE()], [SWAMP(), SWAMP(), SWAMP()]);
    game = stage(game, 1, () => ({ graveyard: toHand(1, [permanent, instant], "cross-generic-reanimate") }));
    const targets = legalTargets(game, 0, "permanent-card-in-a-graveyard");
    expect(targets).toHaveLength(1);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets });
    expect(game.players[0]!.battlefield.some((candidate) => candidate.card.name === "Opponent Relic")).toBe(true);
    expect(game.players[1]!.graveyard.some((candidate) => candidate.name === "Opponent Relic")).toBe(false);
  });

  it("filters graveyard exile to permanent cards", () => {
    const permanent = make({ name: "Exile Relic", type_line: "Artifact" });
    const instant = make({ name: "Exile Trick", type_line: "Instant", mana_cost: "{U}" });
    let game = readyToCast([PERMANENT_GRAVEYARD_EXILE()], [SWAMP()]);
    game = stage(game, 0, () => ({ graveyard: toHand(0, [permanent, instant], "permanent-exile") }));
    const targets = legalTargets(game, 0, "permanent-card-in-your-graveyard");
    expect(targets).toHaveLength(1);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets });
    expect(game.players[0]!.exile.some((card) => card.name === "Exile Relic")).toBe(true);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Exile Trick")).toBe(true);
  });

  it("filters cross-graveyard permanent exile without exposing nonpermanents", () => {
    const permanent = make({ name: "Cross Exile Relic", type_line: "Artifact" });
    const instant = make({ name: "Cross Exile Trick", type_line: "Instant", mana_cost: "{U}" });
    let game = readyToCast([CROSS_PERMANENT_GRAVEYARD_EXILE()], [SWAMP(), SWAMP()]);
    game = stage(game, 1, () => ({ graveyard: toHand(1, [permanent, instant], "cross-permanent-exile") }));
    const targets = legalTargets(game, 0, "permanent-card-in-a-graveyard");
    expect(targets).toHaveLength(1);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets });
    expect(game.players[1]!.exile.some((card) => card.name === "Cross Exile Relic")).toBe(true);
    expect(game.players[1]!.graveyard.some((card) => card.name === "Cross Exile Trick")).toBe(true);
  });

  it("supports Loyal Retainers' precombat legendary-creature activation", () => {
    const legendary = make({ name: "Dead General", type_line: "Legendary Creature — Human", power: "3", toughness: "3" });
    const profile = profileOf(LOYAL_RETAINERS());
    expect(profile.activatedAbilities[0]).toMatchObject({ sacrificesSelf: true, precombatMainOnly: true, targetKind: "legendary-creature-card-in-your-graveyard" });
    let game = readyToCast([], [LOYAL_RETAINERS()]);
    game = stage(game, 0, () => ({ graveyard: toHand(0, [legendary], "loyal-retainers-graveyard") }));
    const source = game.players[0]!.battlefield[0]!;
    const target = legalTargets(game, 0, "legendary-creature-card-in-your-graveyard")[0]!;
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.action.sourceId === source.instance_id);
    if (!activation || activation.action.type !== "activate") throw new Error("Loyal Retainers activation was not generated");
    game = applyAction(game, 0, { ...activation.action, targets: [target] });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Dead General")).toBe(true);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Loyal Retainers")).toBe(false);
  });

  it("applies Mirari's Wake to each creature its controller controls", () => {
    const game = readyToCast([], [MIRARIS_WAKE(), BEAR(), WALL()]);
    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    const wall = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Stone Wall")!;
    expect([powerOf(bear, game), toughnessOf(bear, game)]).toEqual([3, 3]);
    expect([powerOf(wall, game), toughnessOf(wall, game)]).toEqual([1, 5]);
  });

  it("adds a second mana when a controlled land produces mana", () => {
    let game = readyToCast([], [MIRARIS_WAKE(), FOREST()]);
    const land = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Forest")!;
    const entry = legalActions(game, 0).find((candidate) => candidate.action.type === "activate-mana" && candidate.action.sourceId === land.instance_id);
    if (!entry || entry.action.type !== "activate-mana") throw new Error("Mirari's Wake mana action was not generated");
    expect(entry.action.manaBonus).toBe("G");
    game = applyAction(game, 0, entry.action);
    expect(game.players[0]!.manaPool.G).toBe(2);
  });

  it("lets the automatic mana planner use Mirari's Wake's extra mana", () => {
    const game = readyToCast([BEAR()], [MIRARIS_WAKE(), FOREST()]);
    expect(legalActions(game, 0).some((candidate) => candidate.action.type === "cast"
      && candidate.action.cardId === game.players[0]!.hand[0]!.instance_id)).toBe(true);
  });

  it("restricts Command Tower to the commander's color identity", () => {
    expect(cardProfile(COMMAND_TOWER()).fullyImplemented).toBe(true);
    let game = createGame([
      deck("tower", GREEN_COMMANDER(), [COMMAND_TOWER()]),
      deck("opponent", COMMANDER("Blue Commander"), [])
    ], { allowPartialDecks: true });
    game = putOnBattlefield(game, 0, [COMMAND_TOWER()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.prioritySeat === 0);
    const tower = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Command Tower")!;
    const actions = legalActions(game, 0).filter((candidate) => candidate.action.type === "activate-mana" && candidate.action.sourceId === tower.instance_id);
    expect(actions).toHaveLength(1);
    if (actions[0]!.action.type !== "activate-mana") throw new Error("Command Tower action was not generated");
    expect(actions[0]!.action.mana).toBe("G");
    game = applyAction(game, 0, actions[0]!.action);
    expect(game.players[0]!.manaPool.G).toBe(1);
    expect(game.players[0]!.manaPool.U).toBe(0);
  });

  it("uses the C13 Command Tower print in the shared mana action", () => {
    let game = createGame([
      deck("c13-tower", GREEN_COMMANDER(), [C13_COMMAND_TOWER()]),
      deck("opponent", COMMANDER("Blue Commander"), [])
    ], { allowPartialDecks: true });
    game = putOnBattlefield(game, 0, [C13_COMMAND_TOWER()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.prioritySeat === 0);
    const tower = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Command Tower")!;
    const actions = legalActions(game, 0).filter((candidate) => candidate.action.type === "activate-mana" && candidate.action.sourceId === tower.instance_id);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.action.type === "activate-mana" && actions[0]!.action.mana).toBe("G");
  });

  it("offers only generated tokens for a token sacrifice cost", () => {
    const sourceCard = TOKEN_SAC_ACTIVATION();
    expect(profileOf(sourceCard).activatedAbilities[0]).toMatchObject({ sacrificesPermanent: { type: "Token", mode: "any" } });
    let game = readyToCast([PLANT_SPELL()], [FOREST(), FOREST(), FOREST(), FOREST(), sourceCard, BEAR()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === sourceCard.name)!;
    const token = game.players[0]!.battlefield.find((permanent) => permanent.card.token)!;
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.action.sourceId === source.instance_id && entry.action.sacrificeId === token.instance_id);
    expect(activation).toBeDefined();
    expect(legalActions(game, 0).some((entry) => entry.action.type === "activate" && entry.action.sourceId === source.instance_id && entry.action.sacrificeId === game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")?.instance_id)).toBe(false);
  });

  it("projects and pays a chosen graveyard exile activation cost", () => {
    const sourceCard = GRAVEYARD_EXILE_ACTIVATION();
    expect(profileOf(sourceCard).activatedAbilities[0]).toMatchObject({ exilesGraveyardCard: true, effect: { kind: "draw", amount: 1 } });
    const exiled = BEAR();
    let game = readyToCast([], [sourceCard]);
    game = stage(game, 0, () => ({ graveyard: toHand(0, [exiled], "activation-graveyard") }));
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === sourceCard.name)!;
    const card = game.players[0]!.graveyard.find((candidate) => candidate.name === exiled.name)!;
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.action.sourceId === source.instance_id && entry.action.exileCardId === card.instance_id);
    expect(activation).toBeDefined();
    game = applyAction(game, 0, activation!.action);
    expect(game.players[0]!.graveyard.some((candidate) => candidate.instance_id === card.instance_id)).toBe(false);
    expect(game.players[0]!.exile.some((candidate) => candidate.instance_id === card.instance_id)).toBe(true);
  });

  it("exiles two creature cards from one graveyard for Night Soil", () => {
    const sourceCard = C13_NIGHT_SOIL();
    expect(profileOf(sourceCard).activatedAbilities[0]).toMatchObject({
      exilesGraveyardCards: { amount: 2, scope: "single-graveyard" },
      effect: { kind: "create-token", amount: 1, token: { name: "Saproling", power: 1, toughness: 1 } }
    });
    expect(profileOf(sourceCard).fullyImplemented).toBe(true);
    let game = readyToCast([], [sourceCard, FOREST()]);
    const graveyard = toHand(1, [BEAR(), BLACK_BLOCKER()], "night-soil-yard");
    game = stage(game, 1, () => ({ graveyard }));
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === sourceCard.name)!;
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate"
      && entry.action.sourceId === source.instance_id
      && entry.action.exileCardIds?.length === 2);
    expect(activation).toBeDefined();
    const ids = activation!.action.type === "activate" ? activation!.action.exileCardIds! : [];
    game = applyAction(game, 0, activation!.action);
    expect(game.players[1]!.graveyard).toHaveLength(0);
    expect(game.players[1]!.exile.map((card) => card.instance_id)).toEqual(expect.arrayContaining([...ids]));
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Saproling" && permanent.card.token)).toBe(true);
  });

  it("returns a selected graveyard card to the bottom of its library", () => {
    const returned = BEAR();
    let game = readyToCast([BOTTOM_RETURN()], [FOREST()]);
    game = stage(game, 0, () => ({ graveyard: toHand(0, [returned], "bottom-graveyard") }));
    const target = legalTargets(game, 0, "card-in-your-graveyard")[0]!;
    const targetId = target.kind === "graveyard-card" ? target.instanceId : "";
    const before = game.players[0]!.library.length;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [target] });
    expect(game.players[0]!.graveyard.some((card) => card.instance_id === targetId)).toBe(false);
    expect(game.players[0]!.library).toHaveLength(before + 1);
    expect(game.players[0]!.library.at(-1)!.instance_id).toBe(target.kind === "graveyard-card" ? target.instanceId : "");
  });

  it("shuffles a selected graveyard card into its owner's library", () => {
    const returned = BEAR();
    let game = readyToCast([SHUFFLE_RETURN()], [FOREST()]);
    game = stage(game, 0, () => ({ graveyard: toHand(0, [returned], "shuffle-graveyard") }));
    const target = legalTargets(game, 0, "card-in-your-graveyard")[0]!;
    const targetId = target.kind === "graveyard-card" ? target.instanceId : "";
    const before = game.players[0]!.library.length;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [target] });
    expect(game.players[0]!.graveyard.some((card) => card.instance_id === targetId)).toBe(false);
    expect(game.players[0]!.library).toHaveLength(before + 1);
    expect(game.players[0]!.library.some((card) => card.instance_id === targetId)).toBe(true);
  });

  it("offers and pays an activated counter-removal cost", () => {
    const profile = profileOf(COUNTER_DAMAGE());
    expect(profile.activatedAbilities[0]).toMatchObject({
      removeCounters: [{ kind: "+1/+1", amount: 1 }],
      effect: { kind: "damage-any-target", amount: 1 },
      targetKind: "any"
    });
    let game = readyToCast([], [COUNTER_DAMAGE()], [], [BEAR()]);
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Deathbringer Thoctar")!;
    const target = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    game = {
      ...game,
      players: game.players.map((player) => player.seat === 0
        ? { ...player, battlefield: player.battlefield.map((permanent) => permanent.instance_id === source.instance_id
          ? { ...permanent, counters: { "+1/+1": 1 } } : permanent) }
        : player)
    };
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.action.sourceId === source.instance_id);
    expect(activation).toBeDefined();
    if (!activation || activation.action.type !== "activate") throw new Error("Expected a counter-removal activation.");
    game = applyAction(game, 0, { ...activation.action, targets: [{ kind: "permanent", instanceId: target.instance_id }] });
    const updated = game.players[0]!.battlefield.find((permanent) => permanent.instance_id === source.instance_id)!;
    expect(updated.counters["+1/+1"]).toBe(0);
  });

  it("enforces a creature's cannot-be-blocked restriction", () => {
    const profile = profileOf(UNBLOCKABLE());
    expect(profile.combatRules.cannotBeBlocked).toBe(true);
    let game = readyToCast([], [UNBLOCKABLE()], [], [BEAR()]);
    const attacker = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Herald Memory")!;
    const blocker = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    game = { ...game, step: "declare-blockers", combat: { ...game.combat, attackers: [{ instanceId: attacker.instance_id, defender: 1 }] } };
    expect(legalBlockers(game, 1)).not.toContainEqual(blocker);
  });

  it("grants a temporary keyword to every permanent controlled by the caster", () => {
    const profile = profileOf(GLOBAL_INDESTRUCTIBLE());
    expect(profile.effects[0]).toMatchObject({ kind: "grant-permanents-you-control-keyword", keyword: "indestructible" });
    let game = readyToCast([GLOBAL_INDESTRUCTIBLE()], [MOUNTAIN(), PLAINS(), BEAR()], [], [BEAR()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", mode: 0 });
    expect(game.players[0]!.battlefield.every((permanent) => permanent.temporaryKeywords?.includes("indestructible"))).toBe(true);
    expect(game.players[1]!.battlefield.some((permanent) => permanent.temporaryKeywords?.includes("indestructible"))).toBe(false);
  });

  it("calculates life from the targeted creature's current power", () => {
    const profile = profileOf(POWER_LIFE_SPELL());
    expect(profile).toMatchObject({ targetKind: "creature-you-control", effects: [{ kind: "gain-life-equal-target-power" }] });
    let game = readyToCast([POWER_LIFE_SPELL()], [FOREST(), BEAR()]);
    const creature = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    const before = game.players[0]!.life;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: creature.instance_id }] });
    expect(game.players[0]!.life).toBe(before + 2);
  });

  it("applies static haste granted by another creature you control", () => {
    const profile = profileOf(HASTE_LORD());
    expect(profile.staticKeywordGrants).toEqual([{ scope: "creatures-you-control", keyword: "haste" }]);
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [HASTE_LORD(), BEAR()], { sick: true });
    game = passUntil(game, (state) => state.step === "declare-attackers" && state.activeSeat === 0);
    expect(legalAttackers(game, 0).map((permanent) => permanent.card.name)).toEqual(expect.arrayContaining(["Haste Memory", "Grizzly Bears"]));
  });

  it("reuses static haste for Maelstrom Wanderer while leaving cascade explicit", () => {
    const profile = profileOf(MAELSTROM_WANDERER());
    expect(profile.staticKeywordGrants).toEqual([{ scope: "creatures-you-control", keyword: "haste" }]);
    expect(profile.unimplementedText).toEqual(["Cascade", "Cascade"]);
  });

  it("enforces Vela's intimidate and static intimidate grant", () => {
    const profile = profileOf(VELA());
    expect(profile.keywords).toContain("intimidate");
    expect(profile.staticKeywordGrants).toEqual([{ scope: "other-creatures-you-control", keyword: "intimidate" }]);
    let game = readyToCast([], [VELA()], [], [BLACK_BLOCKER(), BEAR()]);
    const vela = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Vela the Night-Clad")!;
    game = passUntil(game, (state) => state.step === "declare-attackers" && state.activeSeat === 0);
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: vela.instance_id, defender: 1 }] });
    expect(legalBlockers(game, 1).map((permanent) => permanent.card.name)).toEqual(["Dusk Bat"]);
  });

  it("triggers Vela when another controlled creature leaves", () => {
    const profile = profileOf(VELA());
    expect(profile.triggers).toMatchObject([{
      event: "leaves-battlefield",
      subject: "self-or-another-creature-you-control",
      effect: { kind: "each-opponent-loses-life", amount: 1 }
    }]);
    let game = readyToCast([DESTROY_TARGET_CREATURE()], [SWAMP(), SWAMP(), VELA(), BEAR()]);
    const target = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: target.instance_id }] });
    expect(game.players[1]!.life).toBe(39);
  });
  it("supports static grants that exclude their source", () => {
    expect(profileOf(OTHER_FLYING_LORD()).staticKeywordGrants).toEqual([{ scope: "other-creatures-you-control", keyword: "flying" }]);
    let game = readyToCast([FLYING_REMOVAL()], [FOREST(), FOREST(), FOREST()]);
    game = putOnBattlefield(game, 0, [OTHER_FLYING_LORD(), BEAR()]);
    expect(legalTargets(game, 0, "creature-with-flying")).toHaveLength(1);
  });

  it("applies Wonder's graveyard static grant only while its controller has an Island", () => {
    expect(profileOf(WONDER()).staticKeywordGrants).toEqual([{
      scope: "creatures-you-control", keyword: "flying", sourceZone: "graveyard", requiresControlledLandSubtype: "Island"
    }]);
    let game = readyToCast([FLYING_REMOVAL()], [FOREST(), FOREST(), FOREST(), BEAR()]);
    game = stage(game, 0, (player) => ({ graveyard: toHand(0, [WONDER()], "wonder-yard") }));
    const ownBear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    expect(legalTargets(game, 0, "creature-with-flying")).not.toContainEqual({ kind: "permanent", instanceId: ownBear.instance_id });

    game = putOnBattlefield(game, 0, [ISLAND()]);
    expect(legalTargets(game, 0, "creature-with-flying")).toContainEqual({ kind: "permanent", instanceId: ownBear.instance_id });
  });

  it("accepts gain as an alternate static keyword verb", () => {
    expect(profileOf(GAIN_FLYING_LORD()).staticKeywordGrants).toEqual([{ scope: "creatures-you-control", keyword: "flying" }]);
  });

  it("supports static keyword grants that affect every creature", () => {
    expect(profileOf(ALL_FLYING_LORD()).staticKeywordGrants).toEqual([{ scope: "all-creatures", keyword: "flying" }]);
    let game = readyToCast([FLYING_REMOVAL()], [FOREST(), FOREST(), FOREST()], [], [ALL_FLYING_LORD(), BEAR()]);
    expect(legalTargets(game, 0, "creature-with-flying")).toHaveLength(1);
  });

  it("applies global static power and toughness bonuses", () => {
    expect(profileOf(ALL_PUMP()).staticPowerToughnessGrants).toEqual([{ scope: "all-creatures", power: 1, toughness: 1 }]);
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [ALL_PUMP(), BEAR()]);
    expect(powerOf(game.players[0]!.battlefield[1]!, game)).toBe(3);
    expect(toughnessOf(game.players[0]!.battlefield[1]!, game)).toBe(3);
  });

  it("applies life-threshold and opponents' graveyard static bonuses", () => {
    expect(profileOf(C13_DIVINITY_OF_PRIDE()).staticPowerToughnessGrants).toEqual([
      { scope: "source-controller-life-threshold", power: 4, toughness: 4, threshold: 25 }
    ]);
    expect(profileOf(C13_WIGHT()).staticPowerToughnessGrants).toEqual([
      { scope: "source-opponents-graveyard-creatures", power: 1, toughness: 1 }
    ]);
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [C13_DIVINITY_OF_PRIDE(), C13_WIGHT()]);
    game = stage(game, 1, () => ({ graveyard: toHand(1, [BEAR(), FLIER()], "opponent-creatures") }));
    const divinity = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Divinity of Pride")!;
    const wight = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Wight of Precinct Six")!;
    expect([powerOf(divinity, game), toughnessOf(divinity, game)]).toEqual([8, 8]);
    expect([powerOf(wight, game), toughnessOf(wight, game)]).toEqual([3, 3]);
    game = stage(game, 0, () => ({ life: 24 }));
    expect([powerOf(divinity, game), toughnessOf(divinity, game)]).toEqual([4, 4]);
  });

  it("applies Hooded Horror's defending-player creature-count evasion", () => {
    expect(profileOf(C13_HOODED_HORROR()).combatRules.cannotBeBlockedWhenDefenderHasMostCreatures).toBe(true);
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [C13_HOODED_HORROR(), BEAR(), BEAR()]);
    game = putOnBattlefield(game, 1, [BEAR()]);
    const horror = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Hooded Horror")!;
    const blocker = game.players[1]!.battlefield[0]!;
    const attack = { ...game, combat: { ...game.combat, attackers: [{ instanceId: horror.instance_id, defender: 1 }] } };
    expect(legalBlockers(attack, 1)).toContain(blocker);
    game = putOnBattlefield(game, 1, [BEAR(), BEAR()]);
    const tiedAttack = { ...game, combat: { ...game.combat, attackers: [{ instanceId: horror.instance_id, defender: 1 }] } };
    expect(legalBlockers(tiedAttack, 1)).not.toContain(blocker);
  });

  it("resolves a compound draw-and-life-loss instruction as one effect", () => {
    const profile = profileOf(DRAW_AND_LOSE());
    expect(profile.effects).toEqual([{ kind: "compound", effects: [{ kind: "draw", amount: 1 }, { kind: "lose-life", amount: 1 }] }]);
    let game = readyToCast([DRAW_AND_LOSE(), BEAR()], [SWAMP(), SWAMP(), SWAMP()]);
    const beforeLife = game.players[0]!.life;
    const beforeHand = game.players[0]!.hand.length;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.players[0]!.life).toBe(beforeLife - 1);
    expect(game.players[0]!.hand.length).toBe(beforeHand);
  });

  it("computes hand-count damage at resolution", () => {
    const profile = profileOf(HAND_DAMAGE());
    expect(profile.effects).toEqual([{ kind: "damage-controller-equal-hand" }]);
    let game = readyToCast([HAND_DAMAGE(), BEAR(), BEAR()], [SWAMP(), SWAMP(), SWAMP()]);
    const before = game.players[0]!.life;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.players[0]!.life).toBe(before - 2);
  });

  it("scales life gain by the number of controlled artifacts", () => {
    expect(profileOf(ARTIFACT_LIFE_SPELL()).effects).toEqual([{ kind: "gain-life-each-controlled-type", amount: 2, type: "Artifact" }]);
    let game = readyToCast([ARTIFACT_LIFE_SPELL()], [PLAINS(), PLAINS(), PLAINS()], [], [TEST_ARTIFACT()]);
    game = putOnBattlefield(game, 0, [TEST_ARTIFACT(), TEST_ARTIFACT()]);
    const before = game.players[0]!.life;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.players[0]!.life).toBe(before + 4);
  });

  it("reuses the same scaling primitive for controlled creatures", () => {
    expect(profileOf(CREATURE_LIFE_SPELL()).effects).toEqual([{ kind: "gain-life-each-controlled-type", amount: 1, type: "Creature" }]);
  });

  it("also counts lands through the same controlled-type primitive", () => {
    expect(profileOf(LAND_LIFE_SPELL()).effects).toEqual([{ kind: "gain-life-each-controlled-type", amount: 1, type: "Land" }]);
  });

  it("counts every controlled permanent when the text says permanent", () => {
    expect(profileOf(PERMANENT_LIFE_SPELL()).effects).toEqual([{ kind: "gain-life-each-permanent", amount: 1 }]);
  });

  it("counts planeswalkers in the reusable controlled-type primitive", () => {
    expect(profileOf(PLANESWALKER_LIFE_SPELL()).effects).toEqual([{ kind: "gain-life-each-controlled-type", amount: 2, type: "Planeswalker" }]);
  });

  it("counts battles in scalable controlled-type effects", () => {
    expect(profileOf(BATTLE_LIFE_SPELL()).effects).toEqual([{ kind: "gain-life-each-controlled-type", amount: 1, type: "Battle" }]);
  });

  it("draws for the active player when a draw-step trigger resolves", () => {
    const profile = profileOf(DRAW_MINE());
    expect(profile.triggers[0]).toMatchObject({ event: "draw-step", subject: "each-player", effect: { kind: "draw-active-player" } });
    let game = twoSeatGame(Array.from({ length: 10 }, () => BEAR()), []);
    game = putOnBattlefield(game, 0, [DRAW_MINE()]);
    game = passUntil(game, (state) => state.turn === 2 && state.activeSeat === 0 && state.step === "precombat-main");
    expect(game.log.some((entry) => entry.text.includes("Se resuelve la habilidad del paso de robo de Draw Mine"))).toBe(true);
  });

  it("cycles the active player's whole hand through the library on Teferi's Puzzle Box", () => {
    const profile = profileOf(TEFERIS_PUZZLE_BOX());
    expect(profile.triggers[0]).toMatchObject({ event: "draw-step", subject: "each-player", effect: { kind: "put-active-player-hand-on-library-bottom-then-draw-same" } });

    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [TEFERIS_PUZZLE_BOX()]);
    game = stage(game, 0, () => ({
      hand: toHand(0, [SOL_RING(), FLIER()], "puzzle-hand"),
      library: toHand(0, [MOUNTAIN(), ISLAND()], "puzzle-library")
    }));
    // Turn 1's draw step already happened before the artifact entered play, so
    // seat 0's own draw step first sees Teferi's Puzzle Box on turn 3 (their
    // second real turn): the turn-based draw adds Mountain, then the trigger
    // bottoms the whole 3-card hand and redraws 3, landing on top in order.
    game = passUntil(game, (state) => state.turn === 3 && state.activeSeat === 0 && state.step === "precombat-main");
    expect(game.players[0]!.hand.map((card) => card.name)).toEqual(["Island", "Sol Ring", "Storm Crow"]);
    expect(game.players[0]!.library.map((card) => card.name)).toEqual(["Mountain"]);
  });

  it("only grants Howling Mine's extra draw while it is untapped", () => {
    const profile = profileOf(HOWLING_MINE());
    expect(profile.triggers[0]).toMatchObject({ event: "draw-step", subject: "each-player", condition: { kind: "source-untapped" }, effect: { kind: "draw-active-player" } });

    let game = twoSeatGame(Array.from({ length: 10 }, () => BEAR()), Array.from({ length: 10 }, () => BEAR()));
    game = putOnBattlefield(game, 0, [HOWLING_MINE()]);
    game = passUntil(game, (state) => state.turn === 2 && state.activeSeat === 0 && state.step === "precombat-main");
    expect(game.log.some((entry) => entry.text.includes("Se resuelve la habilidad del paso de robo de Howling Mine"))).toBe(true);

    // Tap it right after its own controller's turn resolves. The opponent's
    // untap step only untaps their own permanents, so Howling Mine stays
    // tapped through their very next draw step, which should grant nothing.
    game = stage(game, 0, (player) => ({
      battlefield: player.battlefield.map((permanent) => permanent.card.name === "Howling Mine" ? { ...permanent, tapped: true } : permanent)
    }));
    const logLengthBeforeOpponentTurn = game.log.length;
    game = passUntil(game, (state) => state.turn === 3 && state.activeSeat === 1 && state.step === "precombat-main");
    expect(game.log.slice(logLengthBeforeOpponentTurn).some((entry) => entry.text.includes("Se resuelve la habilidad del paso de robo de Howling Mine"))).toBe(false);
  });

  it("applies intervening-if conditions before stacking and again on resolution", () => {
    const sourceGame = putOnBattlefield(twoSeatGame(Array.from({ length: 10 }, () => BEAR()), []), 0, [HOWLING_MINE()]);
    const source = sourceGame.players[0]!.battlefield.find((permanent) => permanent.card.name === "Howling Mine")!;
    const definition = profileOf(HOWLING_MINE()).triggers[0]!;
    const trigger: TriggerInstance = {
      id: "howling-mine-intervening-if",
      controller: 0,
      sourcePermanentId: source.instance_id,
      sourceCard: source.card,
      definition,
      cause: "comienza el paso de robo"
    };
    const quiet = (state: GameState): GameState => ({
      ...state,
      priorityOpen: true,
      prioritySeat: 0,
      players: state.players.map((player) => ({ ...player, autoPass: false }))
    });

    // The condition is already false when the queued trigger would be put on
    // the stack, so it is removed before any player can respond.
    let beforeStack = quiet({ ...sourceGame, triggerQueue: [trigger] });
    beforeStack = stage(beforeStack, 0, (player) => ({
      battlefield: player.battlefield.map((permanent) => permanent.instance_id === source.instance_id ? { ...permanent, tapped: true } : permanent)
    }));
    beforeStack = settle(beforeStack);
    expect(beforeStack.triggerQueue).toHaveLength(0);
    expect(beforeStack.stack).toHaveLength(0);
    expect(beforeStack.log.at(-1)?.text).toContain("no se pone en la pila");

    // It may be stacked while untapped, but tapping it before resolution makes
    // the intervening-if fail and prevents the extra draw.
    let beforeResolution = settle(quiet({ ...sourceGame, triggerQueue: [trigger] }));
    expect(beforeResolution.stack.at(-1)?.trigger?.id).toBe(trigger.id);
    beforeResolution = stage(beforeResolution, 0, (player) => ({
      battlefield: player.battlefield.map((permanent) => permanent.instance_id === source.instance_id ? { ...permanent, tapped: true } : permanent)
    }));
    beforeResolution = applyAction(beforeResolution, 0, { type: "pass" });
    beforeResolution = applyAction(beforeResolution, 1, { type: "pass" });
    expect(beforeResolution.stack).toHaveLength(0);
    expect(beforeResolution.log.at(-1)?.text).toContain("no se resuelve");
  });

  it("damages only an opponent whose hand reaches four after Fevered Visions' end-step draw", () => {
    const profile = profileOf(FEVERED_VISIONS());
    expect(profile.triggers[0]).toMatchObject({
      event: "end-step",
      subject: "each-player",
      effect: { kind: "draw-active-player-then-damage-if-opponent-hand-at-least", handAtLeast: 4, damage: 2 }
    });

    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [FEVERED_VISIONS()]);
    game = stage(game, 0, () => ({ hand: [], library: toHand(0, Array.from({ length: 15 }, () => FOREST()), "self-lib") }));
    // Three staged cards plus the unconditional end-step draw brings the
    // opponent's hand to exactly four, crossing the damage threshold.
    game = stage(game, 1, () => ({
      hand: toHand(1, [BEAR(), FLIER(), SOL_RING()], "fevered-hand"),
      library: toHand(1, Array.from({ length: 15 }, () => FOREST()), "foe-lib")
    }));
    const opponentLifeBefore = game.players[1]!.life;
    game = passUntil(game, (state) => state.log.some((entry) => entry.text.includes("Fevered Visions hace")));
    expect(game.players[1]!.hand.length).toBeGreaterThanOrEqual(4);
    expect(game.players[1]!.life).toBe(opponentLifeBefore - 2);
  });

  it("clamps opponent hand-count damage at zero", () => {
    const profile = profileOf(HAND_MINUS_DAMAGE());
    expect(profile.triggers[0]).toMatchObject({ event: "upkeep", subject: "opponent", effect: { kind: "damage-active-player-hand-minus", offset: 4 } });
  });

  it("uses the active opponent's hand for equal-hand upkeep damage", () => {
    const profile = profileOf(HAND_EQUAL_DAMAGE());
    expect(profile.triggers[0]).toMatchObject({ event: "upkeep", subject: "opponent", effect: { kind: "damage-active-player-equal-hand" } });
    let game = twoSeatGame(Array.from({ length: 12 }, () => BEAR()), Array.from({ length: 12 }, () => BEAR()));
    game = putOnBattlefield(game, 0, [HAND_EQUAL_DAMAGE()]);
    game = passUntil(game, (state) => state.players[1]!.life < 40);
    expect(game.players[1]!.life).toBeLessThan(40);
  });

  it("resolves equal-hand life loss for every player", () => {
    expect(profileOf(EACH_HAND_DAMAGE()).effects).toEqual([{ kind: "lose-life-each-player-equal-hand" }]);
  });

  it("gates a conditional upkeep token trigger on a controlled subtype", () => {
    const profile = profileOf(Ophiomancer_MEMORY());
    expect(profile.triggers[0]).toMatchObject({ event: "upkeep", subject: "each-player", condition: { kind: "no-controlled-subtype", subtype: "Snakes" }, effect: { kind: "create-token" } });
    let game = twoSeatGame(Array.from({ length: 10 }, () => BEAR()), []);
    game = putOnBattlefield(game, 0, [Ophiomancer_MEMORY()]);
    game = passUntil(game, (state) => state.players[0]!.battlefield.some((permanent) => permanent.card.name === "Snake"));
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Snake")).toBe(true);
  });

  it("recognizes non-power counters placed on the source", () => {
    const profile = profileOf(PLAGUE_ENGINE());
    expect(profile.triggers[0]).toMatchObject({ event: "upkeep", subject: "you", effect: { kind: "add-counter-source", counter: "plague", amount: 1 } });
    let game = twoSeatGame(Array.from({ length: 12 }, () => BEAR()), []);
    game = putOnBattlefield(game, 0, [PLAGUE_ENGINE()]);
    game = passUntil(game, (state) => (state.players[0]!.battlefield[0]!.counters.plague ?? 0) > 0);
    expect(game.players[0]!.battlefield[0]!.counters.plague).toBe(1);
  });

  it("draws once per tapped creature controlled by the targeted opponent", () => {
    const profile = profileOf(TAPPED_DRAW());
    expect(profile).toMatchObject({ targetKind: "opponent", effects: [{ kind: "draw-equal-tapped-creatures" }] });
    let game = readyToCast([TAPPED_DRAW()], [ISLAND(), ISLAND(), ISLAND(), ISLAND()], [], [BEAR(), BEAR()]);
    game = {
      ...game,
      players: game.players.map((player) => player.seat === 1
        ? { ...player, battlefield: player.battlefield.map((permanent) => ({ ...permanent, tapped: true })) }
        : player)
    };
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 1 }] });
    expect(game.players[1]!.hand.length).toBe(2);
  });

  it("reuses the tapped-creature draw primitive for C13 Borrowing 100,000 Arrows", () => {
    let game = readyToCast([C13_BORROWING_ARROWS()], [ISLAND(), ISLAND(), ISLAND(), ISLAND()], [], [BEAR(), BEAR()]);
    game = {
      ...game,
      players: game.players.map((player) => player.seat === 1
        ? { ...player, battlefield: player.battlefield.map((permanent) => ({ ...permanent, tapped: true })) }
        : player)
    };
    const before = game.players[1]!.hand.length;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 1 }] });
    expect(game.players[1]!.hand.length).toBe(before + 2);
  });

  it("keeps opponent-only draw targets from selecting its own controller", () => {
    const game = readyToCast([C13_BORROWING_ARROWS()], [ISLAND(), ISLAND(), ISLAND(), ISLAND()]);
    expect(profileOf(C13_BORROWING_ARROWS()).targetKind).toBe("opponent");
    expect(legalTargets(game, 0, "opponent")).toEqual([{ kind: "player", seat: 1 }]);
  });

  it("reuses typed sacrifice and any-target damage for C13 Blood Rites", () => {
    let game = readyToCast([], [C13_BLOOD_RITES(), MOUNTAIN(), MOUNTAIN(), BEAR()], [], [BEAR()]);
    const rites = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Blood Rites")!;
    const victim = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.action.sourceId === rites.instance_id);
    if (!activation || activation.action.type !== "activate") throw new Error("Blood Rites activation was not generated.");
    expect(activation.action.sacrificeId).toBeDefined();
    game = applyAction(game, 0, {
      ...activation.action,
      targets: [{ kind: "permanent", instanceId: victim.instance_id }]
    });
    game = passUntil(game, (state) => state.stack.length === 0 && state.players[1]!.graveyard.some((card) => card.name === "Grizzly Bears"));
    expect(game.players[0]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);
    expect(game.players[1]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);
  });

  it("reuses the generic sacrifice-cost draw activation for C13 Carnage Altar", () => {
    let game = readyToCast([], [C13_CARNAGE_ALTAR(), FOREST(), FOREST(), FOREST(), BEAR()]);
    const altar = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Carnage Altar")!;
    const beforeHand = game.players[0]!.hand.length;
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.action.sourceId === altar.instance_id);
    expect(activation?.action.type).toBe("activate");
    game = applyAction(game, 0, activation!.action);
    game = passUntil(game, (state) => state.stack.length === 0 && state.players[0]!.hand.length === beforeHand + 1);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);
  });

  it("reuses the upkeep compound trigger for C13 Baleful Force", () => {
    let game = twoSeatGame(Array.from({ length: 12 }, () => BEAR()), []);
    game = putOnBattlefield(game, 0, [C13_BALEFUL_FORCE()]);
    const beforeHand = game.players[0]!.hand.length;
    game = passUntil(game, (state) => state.players[0]!.life === 39 && state.players[0]!.hand.length === beforeHand + 1);
    expect(game.players[0]!.life).toBe(39);
    expect(game.players[0]!.hand.length).toBe(beforeHand + 1);
  });

  it("draws once per creature controlled by the caster", () => {
    expect(profileOf(CREATURE_DRAW()).effects).toEqual([{ kind: "draw-equal-controlled-type", type: "Creature" }]);
  });

  it("grants a temporary keyword to all creatures on the battlefield", () => {
    const profile = profileOf(GLOBAL_FEAR());
    expect(profile.effects).toEqual([{ kind: "grant-all-creatures-keyword", keyword: "menace" }]);
    let game = readyToCast([GLOBAL_FEAR()], [SWAMP(), SWAMP(), SWAMP()], [], [BEAR()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.players.flatMap((player) => player.battlefield)
      .filter((permanent) => permanent.card.type_line.includes("Creature"))
      .every((permanent) => permanent.temporaryKeywords?.includes("menace"))).toBe(true);
  });

  it("recognizes fear as a global evasion keyword", () => {
    expect(profileOf(GLOBAL_REAL_FEAR()).effects).toEqual([{ kind: "grant-all-creatures-keyword", keyword: "fear" }]);
    let game = readyToCast([GLOBAL_REAL_FEAR()], [SWAMP(), SWAMP(), SWAMP()], [], [BEAR()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    const enemy = game.players[1]!.battlefield[0]!;
    expect(enemy.temporaryKeywords).toContain("fear");
  });

  it("prevents life gain while a static life-gain lock remains on the battlefield", () => {
    expect(profileOf(LIFE_LOCK()).preventsLifeGain).toBe(true);
    let game = readyToCast([LIFE_SPELL()], [LIFE_LOCK(), FOREST()]);
    const before = game.players[0]!.life;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.players[0]!.life).toBe(before);
  });

  it("skips cleanup discards for a player with no maximum hand size", () => {
    expect(profileOf(NO_MAX_HAND()).noMaximumHandSize).toBe(true);
    let game = twoSeatGame(Array.from({ length: 10 }, () => BEAR()), []);
    game = putOnBattlefield(game, 0, [NO_MAX_HAND()]);
    game = stage(game, 0, (player) => ({ hand: [...player.hand, ...toHand(0, [BEAR()], "no-max-extra")] }));
    game = passUntil(game, (state) => state.turn === 2 && state.activeSeat === 0 && state.step === "untap");
    expect(game.log.some((entry) => entry.text.includes("descarta") && entry.seat === 0)).toBe(false);
  });

  it("applies a global no-maximum-hand-size effect to every player", () => {
    const price = make({ name: "Price of Knowledge", type_line: "Enchantment", mana_cost: "{5}{U}", cmc: 6, oracle_text: "Players have no maximum hand size." });
    expect(profileOf(price)).toMatchObject({ noMaximumHandSizeForAllPlayers: true, fullyImplemented: true });
    let game = twoSeatGame(Array.from({ length: 12 }, () => BEAR()), Array.from({ length: 12 }, () => BEAR()));
    game = putOnBattlefield(game, 0, [price]);
    game = stage(game, 1, (player) => ({ ...player, hand: [...player.hand, ...toHand(1, [BEAR(), BEAR()], "global-no-max")] }));
    game = passUntil(game, (state) => state.turn === 3 && state.activeSeat === 0 && state.step === "untap");
    expect(game.players[1]!.hand.length).toBeGreaterThan(7);
  });

  it("applies static bonuses to other creatures without buffing the source", () => {
    const profile = profileOf(PUMP_LORD());
    expect(profile.staticPowerToughnessGrants).toEqual([{ scope: "other-creatures-you-control", power: 1, toughness: 1 }]);
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [PUMP_LORD(), BEAR()]);
    const lord = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Pump Lord")!;
    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    expect(powerOf(lord, game)).toBe(2);
    expect(toughnessOf(lord, game)).toBe(2);
    expect(powerOf(bear, game)).toBe(3);
    expect(toughnessOf(bear, game)).toBe(3);
  });

  it("uses current power and toughness before destroying the targeted creature", () => {
    const profile = profileOf(POWER_LOSS_REMOVAL());
    expect(profile).toMatchObject({ targetKind: "creature", effects: [{ kind: "destroy-target-creature-then-life-loss" }] });
    let game = readyToCast([POWER_LOSS_REMOVAL()], [SWAMP(), SWAMP(), SWAMP()], [], [BEAR()]);
    const bear = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    const before = game.players[1]!.life;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: bear.instance_id }] });
    expect(game.players[1]!.life).toBe(before - 4);
    expect(game.players[1]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);
  });

  it("exiles the targeted creature and pays its controller life equal to its power", () => {
    const profile = profileOf(EXILE_LIFEGAIN_REMOVAL());
    expect(profile).toMatchObject({ targetKind: "creature", effects: [{ kind: "exile-target-creature-then-life-gain-power" }], fullyImplemented: true });
    let game = readyToCast([EXILE_LIFEGAIN_REMOVAL()], [PLAINS()], [], [BEAR()]);
    const bear = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    const before = game.players[1]!.life;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: bear.instance_id }] });
    expect(game.players[1]!.life).toBe(before + 2);
    expect(game.players[1]!.exile.some((card) => card.name === "Grizzly Bears")).toBe(true);
    expect(game.players[1]!.battlefield.some((permanent) => permanent.card.name === "Grizzly Bears")).toBe(false);
  });

  it("only lets Condemn-style removal target an attacking creature, paying life equal to toughness", () => {
    const profile = profileOf(CONDEMN_LIKE());
    expect(profile).toMatchObject({ targetKind: "attacking-creature", effects: [{ kind: "bottom-attacker-controller-gains-toughness" }], fullyImplemented: true });
    let game = readyToCast([CONDEMN_LIKE()], [PLAINS()], [], [BEAR()]);
    const bear = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    // Not attacking yet: no legal target.
    expect(legalTargets(game, 0, "attacking-creature")).toHaveLength(0);
    game = { ...game, combat: { ...game.combat, attackers: [{ instanceId: bear.instance_id, defender: 0 }] } };
    const before = game.players[1]!.life;
    const libraryBefore = game.players[1]!.library.length;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: bear.instance_id }] });
    expect(game.players[1]!.life).toBe(before + 2);
    expect(game.players[1]!.battlefield.some((permanent) => permanent.card.name === "Grizzly Bears")).toBe(false);
    expect(game.players[1]!.library.length).toBe(libraryBefore + 1);
    expect(game.players[1]!.library.at(-1)?.name).toBe("Grizzly Bears");
    expect(game.combat.attackers).not.toContainEqual(expect.objectContaining({ instanceId: bear.instance_id }));
  });

  it("punishes the specific opponent who drew, not the ability's own controller", () => {
    const profileDamage = profileOf(DAMAGE_ON_OPPONENT_DRAW());
    expect(profileDamage.triggers[0]).toMatchObject({ event: "card-drawn", subject: "opponent", effect: { kind: "damage-event-player", amount: 1 } });
    expect(profileDamage.fullyImplemented).toBe(true);
    const profileLife = profileOf(LIFELOSS_ON_OPPONENT_DRAW());
    expect(profileLife.triggers[0]).toMatchObject({ event: "card-drawn", subject: "opponent", effect: { kind: "lose-life-event-player", amount: 1 } });
    expect(profileLife.fullyImplemented).toBe(true);

    // Seat 0 controls the punisher and casts the draw spell, but both draws
    // are targeted at seat 1: the trigger must credit seat 1, resolved from
    // the card-drawn event itself, not seat 0 (the caster/controller).
    let game = readyToCast([DRAW_TWO_TARGET()], [DAMAGE_ON_OPPONENT_DRAW(), ISLAND(), ISLAND(), ISLAND()], [], []);
    const life0 = game.players[0]!.life;
    const life1 = game.players[1]!.life;
    const handBefore1 = game.players[1]!.hand.length;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 1 }] });
    expect(game.players[1]!.hand.length).toBe(handBefore1 + 2);
    expect(game.players[0]!.life).toBe(life0);
    expect(game.players[1]!.life).toBe(life1 - 2);
  });

  it("draws only off an opponent's second card each turn, not their first", () => {
    const profile = profileOf(FAERIE_MASTERMIND());
    expect(profile.triggers[0]).toMatchObject({
      event: "card-drawn", subject: "opponent", condition: { kind: "second-draw-this-turn" }, effect: { kind: "draw", amount: 1 }
    });
    expect(profile.fullyImplemented).toBe(true);

    // Seat 1 draws twice from one spell; only the second draw should trigger
    // Faerie Mastermind, giving seat 0 exactly one card back.
    let game = readyToCast([DRAW_TWO_TARGET()], [FAERIE_MASTERMIND(), ISLAND(), ISLAND(), ISLAND()], [], []);
    const hand0Before = game.players[0]!.hand.length;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 1 }] });
    expect(game.players[1]!.hand.length).toBe(2);
    expect(game.players[0]!.hand.length).toBe(hand0Before - 1 + 1);
  });

  it("doubles a controlled permanent's card-drawn trigger via Krang's static ability", () => {
    expect(profileOf(KRANG_DOUBLER()).triggerDoublers).toEqual([{ scope: "draw-caused-triggers" }]);
    expect(profileOf(DRAW_WATCHER()).triggers[0]).toMatchObject({ event: "card-drawn", subject: "opponent", effect: { kind: "draw", amount: 1 } });

    let game = readyToCast([DRAW_TWO_TARGET()], [KRANG_DOUBLER(), DRAW_WATCHER(), ISLAND(), ISLAND(), ISLAND()], [], []);
    const hand0Before = game.players[0]!.hand.length;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 1 }] });
    expect(game.players[1]!.hand.length).toBe(2);
    // Two opponent draws each fire the watcher's trigger once, and Krang
    // doubles each of those card-drawn-caused triggers: 2 draws x 2 copies.
    expect(game.players[0]!.hand.length).toBe(hand0Before - 1 + 4);
  });

  it("splits a two-clause draw trigger between its own controller and an opponent", () => {
    const profile = profileOf(GAIN_ON_YOUR_DRAW_DRAIN_ON_OPPONENT_DRAW());
    expect(profile.triggers).toContainEqual(expect.objectContaining({ event: "card-drawn", subject: "you", effect: { kind: "gain-life", amount: 2 } }));
    expect(profile.triggers).toContainEqual(expect.objectContaining({ event: "card-drawn", subject: "opponent", effect: { kind: "lose-life-event-player", amount: 2 } }));
    expect(profile.fullyImplemented).toBe(true);

    // Seat 0 controls the praetor. Drawing itself gains life; making seat 1
    // draw instead drains seat 1, never seat 0.
    let game = readyToCast([DRAW_TWO_TARGET()], [GAIN_ON_YOUR_DRAW_DRAIN_ON_OPPONENT_DRAW(), ISLAND(), ISLAND(), ISLAND()], [], []);
    const life0 = game.players[0]!.life;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 0 }] });
    expect(game.players[0]!.life).toBe(life0 + 4);

    game = readyToCast([DRAW_TWO_TARGET()], [GAIN_ON_YOUR_DRAW_DRAIN_ON_OPPONENT_DRAW(), ISLAND(), ISLAND(), ISLAND()], [], []);
    const life0b = game.players[0]!.life;
    const life1 = game.players[1]!.life;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 1 }] });
    expect(game.players[0]!.life).toBe(life0b);
    expect(game.players[1]!.life).toBe(life1 - 4);
  });

  it("uses the announced X value for variable all-creature debuffs", () => {
    const profile = profileOf(X_MINUS_SWEEP());
    expect(profile.effects).toEqual([{ kind: "modify-all-creatures-minus-X" }]);
    let game = readyToCast([X_MINUS_SWEEP()], [SWAMP(), SWAMP(), SWAMP()], [], [BEAR()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", variableValue: 2 });
    expect(game.players[1]!.battlefield.some((permanent) => permanent.card.name === "Grizzly Bears")).toBe(false);
  });

  it("gates an optional end-step draw on a controlled power threshold", () => {
    const profile = profileOf(POWER_DRAW_TRIGGER());
    expect(profile.triggers[0]).toMatchObject({ condition: { kind: "controlled-creature-power-at-least", amount: 5 }, effect: { kind: "draw", amount: 1 } });
  });

  it("selects Capricious Efreet's required and optional random targets", () => {
    const profile = profileOf(CAPRICIOUS_EFREET());
    expect(profile.triggers[0]).toMatchObject({
      event: "upkeep", subject: "you", optional: false,
      effect: { kind: "destroy-random-target-permanent", amount: 1 },
      targetKind: "nonland-you-control",
      targetKinds: ["nonland-you-control", "nonland-opponent", "nonland-opponent"],
      minimumTargets: 1
    });
    expect(profile.fullyImplemented).toBe(true);

    let game = readyToCast([], [CAPRICIOUS_EFREET(), BEAR()], [], [BEAR(), TEST_ARTIFACT()]);
    game = passUntil(game, (state) => state.pendingChoice?.type === "trigger-target");
    let choice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "trigger-target" }>;
    expect(choice.options).toHaveLength(2);
    const ownBear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    game = applyAction(game, 0, { type: "choose-trigger-target", sourceId: choice.sourceId, target: { kind: "permanent", instanceId: ownBear.instance_id } });
    choice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "trigger-target" }>;
    expect(choice.options).toHaveLength(2);
    const enemyBear = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    game = applyAction(game, 0, { type: "choose-trigger-target", sourceId: choice.sourceId, target: { kind: "permanent", instanceId: enemyBear.instance_id } });
    expect(legalActions(game, 0).some((entry) => entry.action.type === "finish-trigger-targets")).toBe(true);
    game = applyAction(game, 0, { type: "finish-trigger-targets", sourceId: game.pendingChoice!.sourceId });
    game = passUntil(game, (state) => state.players.some((player) => player.graveyard.some((card) => ["Grizzly Bears", "Test Relic"].includes(card.name))));
    expect(game.players.some((player) => player.graveyard.some((card) => ["Grizzly Bears", "Test Relic"].includes(card.name)))).toBe(true);
  });

  it("damages only nonfliers while still damaging every player", () => {
    const profile = profileOf(NONFLYING_SWEEP());
    expect(profile.effects).toEqual([{ kind: "damage-nonflying-creatures-and-players", amount: "X" }]);
    let game = readyToCast([NONFLYING_SWEEP()], [MOUNTAIN(), MOUNTAIN(), MOUNTAIN()], [], [BEAR(), FLIER()]);
    const flying = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Storm Crow")!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", variableValue: 2 });
    expect(game.players[1]!.battlefield.some((permanent) => permanent.instance_id === flying.instance_id)).toBe(true);
    expect(game.players[1]!.life).toBe(38);
  });

  it("reuses compound resolution for upkeep draw-and-life-loss triggers", () => {
    expect(profileOf(UPKEEP_DRAW_LOSS()).triggers[0]).toMatchObject({ event: "upkeep", effect: { kind: "compound", effects: [{ kind: "draw", amount: 1 }, { kind: "lose-life", amount: 1 }] } });
  });

  it("scales token creation from the controller's current land count", () => {
    const profile = profileOf(LAND_SCALED_TOKENS());
    expect(profile.effects[0]).toMatchObject({ kind: "create-token", amount: "lands-you-control", token: { name: "Plant", power: 0, toughness: 1 } });
    let game = readyToCast([LAND_SCALED_TOKENS()], [FOREST(), FOREST(), FOREST()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.players[0]!.battlefield.filter((permanent) => permanent.card.name === "Plant")).toHaveLength(3);
  });

  it("scales token creation from the controller's current creature count", () => {
    const profile = profileOf(CREATURE_SCALED_TOKENS());
    expect(profile.effects[0]).toMatchObject({ kind: "create-token", amount: "creatures-you-control", token: { name: "Saproling" } });
    let game = readyToCast([CREATURE_SCALED_TOKENS()], [FOREST(), FOREST(), FOREST()]);
    game = putOnBattlefield(game, 0, [BEAR(), BEAR()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.players[0]!.battlefield.filter((permanent) => permanent.card.name === "Saproling")).toHaveLength(2);
  });

  it("preserves fear on generated tokens", () => {
    expect(profileOf(FEAR_TOKEN_SPELL()).effects[0]).toMatchObject({ kind: "create-token", token: { keywords: ["fear"] } });
  });

  it("adds counters only to creatures of the requested subtype", () => {
    const profile = profileOf(PLANT_COUNTERS());
    expect(profile.effects[0]).toMatchObject({ kind: "add-counter-creatures-subtype", subtype: "Plant", counter: "+1/+1", amount: 1 });
    let game = readyToCast([PLANT_COUNTERS()], [FOREST(), PLANT(), PLANT(), BEAR()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    const plants = game.players[0]!.battlefield.filter((permanent) => permanent.card.name === "Plant");
    expect(plants.every((permanent) => permanent.counters["+1/+1"] === 1)).toBe(true);
    expect(game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")?.counters["+1/+1"]).toBeUndefined();
  });

  it("adds counters to every creature the controller controls", () => {
    const profile = profileOf(CREATURE_COUNTERS());
    expect(profile.effects[0]).toMatchObject({ kind: "add-counter-creatures-you-control", counter: "+1/+1", amount: 1 });
    let game = readyToCast([CREATURE_COUNTERS()], [FOREST(), PLANT(), BEAR()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.players[0]!.battlefield.filter((permanent) => permanent.card.type_line.includes("Creature")).every((permanent) => permanent.counters["+1/+1"] === 1)).toBe(true);
  });

  it("registers a required ETB trigger after the permanent enters", () => {
    let game = readyToCast([ETB_DRAWER()], [FOREST(), FOREST()], [BOLT()], [MOUNTAIN()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    // The opponent has a real response, so the creature is still on the stack.
    expect(game.stack).toHaveLength(1);
    game = applyAction(game, 1, { type: "pass" });
    // The creature resolves, its ETB is put on the normal stack, and the
    // active player receives priority before the card is drawn.
    expect(game.stack).toHaveLength(1);
    expect(game.stack[0]!.trigger?.definition.effect.kind).toBe("draw");
    expect(game.players[0]!.hand).toHaveLength(0);
    // The opponent gets the first response window for the triggered ability;
    // the active player is auto-passed because no other choice is available.
    game = applyAction(game, 1, { type: "pass" });
    expect(game.stack).toHaveLength(0);
    expect(game.players[0]!.hand).toHaveLength(1);
  });

  it("doubles a Wizard's triggered ability when a Harmonic-Prodigy-style doubler is out", () => {
    const profile = profileOf(TRIGGER_DOUBLER_SUBTYPE());
    expect(profile.triggerDoublers).toEqual([{ scope: "subtype-you-control", subtypes: ["Shaman", "Wizard"] }]);
    expect(profile.fullyImplemented).toBe(true);

    let game = readyToCast([WIZARD_ETB_DRAWER()], [ISLAND(), ISLAND(), TRIGGER_DOUBLER_SUBTYPE()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[0]!.hand).toHaveLength(2);

    // Without the doubler on the battlefield, the ability fires only once.
    let baseline = readyToCast([WIZARD_ETB_DRAWER()], [ISLAND(), ISLAND()]);
    baseline = applyAction(baseline, 0, { type: "cast", cardId: "hand-0" });
    baseline = passUntil(baseline, (state) => state.stack.length === 0);
    expect(baseline.players[0]!.hand).toHaveLength(1);
  });

  it("does not let a spell counter target an ETB ability", () => {
    let game = readyToCast([ETB_DRAWER()], [FOREST(), FOREST()], [COUNTER()], [ISLAND(), ISLAND()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = applyAction(game, 1, { type: "pass" });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Archivist Bear")).toBe(true);
    expect(legalActions(game, 1).some((entry) => entry.action.type === "cast" && entry.cardId === "foe-0")).toBe(false);
    expect(game.players[1]!.hand).toHaveLength(1);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Archivist Bear")).toBe(true);
    expect(game.players[0]!.library).toHaveLength(31);
  });

  it("asks the controller to accept or decline a simple optional ETB", () => {
    let game = readyToCast([OPTIONAL_ETB_DRAWER()], [FOREST(), FOREST()]);
    expect(profileOf(OPTIONAL_ETB_DRAWER()).triggers[0]!.optional).toBe(true);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.pendingChoice).toMatchObject({ type: "optional-trigger", seat: 0 });
    expect(legalActions(game, 1)).toHaveLength(0);
    expect(legalActions(game, 0).map((entry) => entry.label)).toEqual(["Sí, resolver habilidad", "No, no hacerlo"]);
    game = applyAction(game, 0, { type: "choose-trigger", sourceId: game.pendingChoice!.sourceId, accept: false });
    expect(game.players[0]!.library).toHaveLength(32);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Optional Archivist")).toBe(true);
  });

  it("returns one random instant or sorcery for Charmbreaker Devils", () => {
    const profile = profileOf(CHARMBREAKER_DEVILS());
    expect(profile.triggers[0]).toMatchObject({
      event: "upkeep", subject: "you", optional: false,
      effect: { kind: "return-random-instant-or-sorcery-from-graveyard", amount: 1 }, targetKind: "none"
    });
    expect(profile.fullyImplemented).toBe(true);

    let game = readyToCast([], [CHARMBREAKER_DEVILS()]);
    game = stage(game, 0, (player) => ({ ...player, graveyard: toHand(0, [BOLT(), TAP_SPELL()], "grave") }));
    game = passUntil(game, (state) => state.players[0]!.hand.some((card) => card.name === "Lightning Bolt" || card.name === "Tactical Tap"));
    const recovered = game.players[0]!.hand.filter((card) => card.name === "Lightning Bolt" || card.name === "Tactical Tap");
    expect(recovered).toHaveLength(1);
  });

  it("lets Tidal Force choose whether to tap or untap its target", () => {
    const profile = profileOf(TIDAL_FORCE());
    expect(profile.triggers[0]).toMatchObject({
      event: "upkeep", subject: "each-player", optional: true,
      effect: { kind: "tap-or-untap-target-permanent" }, targetKind: "permanent"
    });
    expect(profile.fullyImplemented).toBe(true);

    let game = readyToCast([], [BEAR()]);
    game = putOnBattlefield(game, 0, [TIDAL_FORCE()]);
    game = passUntil(game, (state) => state.pendingChoice?.type === "trigger-target");
    const targetChoice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "trigger-target" }>;
    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    game = applyAction(game, 0, { type: "choose-trigger-target", sourceId: targetChoice.sourceId, target: { kind: "permanent", instanceId: bear.instance_id } });
    game = passUntil(game, (state) => state.pendingChoice?.type === "optional-trigger");
    const optional = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "optional-trigger" }>;
    game = applyAction(game, 0, { type: "choose-trigger", sourceId: optional.sourceId, accept: true });
    expect(game.pendingChoice?.type).toBe("tap-or-untap");
    game = applyAction(game, 0, { type: "choose-tap-or-untap", sourceId: game.pendingChoice!.sourceId, mode: "tap" });
    expect(game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!.tapped).toBe(true);
  });

  it("reuses the untap primitive for Voltaic Key's artifact-only activation", () => {
    // CR 602.1, 701.21: the target restriction is part of the activation,
    // while the existing untap executor performs the resolution.
    const key = VOLTAIC_KEY();
    expect(profileOf(key)).toMatchObject({
      fullyImplemented: true,
      activatedAbilities: [{ manaCost: { raw: "{1}" }, requiresTap: true, effect: { kind: "untap-target-permanent" }, targetKind: "artifact" }]
    });
    let game = readyToCast([], [MOUNTAIN(), key, TEST_ARTIFACT()]);
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Voltaic Key")!;
    const target = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Test Relic")!;
    game = stage(game, 0, (player) => ({ battlefield: player.battlefield.map((permanent) => permanent.instance_id === target.instance_id
      ? { ...permanent, tapped: true } : permanent) }));
    const action = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.action.sourceId === source.instance_id)!;
    expect(action.requiresTarget).toBe("artifact");
    if (action.action.type !== "activate") throw new Error("Voltaic Key activation missing.");
    game = applyAction(game, 0, { ...action.action, targets: [{ kind: "permanent", instanceId: target.instance_id }] });
    expect(game.players[0]!.battlefield.find((permanent) => permanent.instance_id === target.instance_id)!.tapped).toBe(false);
    expect(game.players[0]!.battlefield.find((permanent) => permanent.instance_id === source.instance_id)!.tapped).toBe(true);
  });

  it("resolves the optional ETB only after the controller accepts it", () => {
    let game = readyToCast([OPTIONAL_ETB_DRAWER()], [FOREST(), FOREST()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = applyAction(game, 0, { type: "choose-trigger", sourceId: game.pendingChoice!.sourceId, accept: true });
    expect(game.players[0]!.library).toHaveLength(31);
    expect(game.players[0]!.hand).toHaveLength(1);
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

  it("fires a generic permanent ETB trigger for a controlled artifact", () => {
    expect(profileOf(PERMANENT_ETB_DRAWER()).triggers[0]).toMatchObject({ event: "enters-battlefield", subject: "permanent-you-control", effect: { kind: "draw", amount: 1 } });
    let game = readyToCast([TEST_ARTIFACT()], [FOREST(), FOREST(), PERMANENT_ETB_DRAWER()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.players[0]!.hand).toHaveLength(1);
    expect(game.players[0]!.library.length).toBeLessThan(99);
  });

  it("keeps another-permanent ETB triggers from matching their own source", () => {
    expect(profileOf(ANOTHER_PERMANENT_ETB_DRAWER()).triggers[0]!.subject).toBe("another-permanent-you-control");
    let game = readyToCast([TEST_ARTIFACT()], [FOREST(), FOREST(), ANOTHER_PERMANENT_ETB_DRAWER()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.players[0]!.hand).toHaveLength(1);
  });

  it("raises a trigger when any player casts a spell", () => {
    expect(profileOf(ANY_SPELL_TRIGGER()).triggers[0]).toMatchObject({ event: "spell-cast", subject: "each-player", effect: { kind: "draw", amount: 1 } });
    let game = readyToCast([BEAR()], [FOREST(), FOREST()], [], [ANY_SPELL_TRIGGER()]);
    game = { ...game, players: game.players.map((player) => ({ ...player, autoPass: false })) };
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.stack.some((entry) => entry.trigger?.definition.subject === "each-player")).toBe(true);
  });

  it("drains whichever player casts a noncreature spell, creature spells excluded", () => {
    const profile = profileOf(NONCREATURE_CAST_DRAIN());
    expect(profile.triggers[0]).toMatchObject({ event: "spell-cast", subject: "each-player", spellType: "noncreature", effect: { kind: "lose-life-event-player", amount: 2 } });
    expect(profile.fullyImplemented).toBe(true);

    // Casting a noncreature spell drains its own caster too — "a player" is
    // not "an opponent".
    let game = readyToCast([RITUAL()], [NONCREATURE_CAST_DRAIN(), SWAMP()]);
    const life0 = game.players[0]!.life;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.players[0]!.life).toBe(life0 - 2);

    // A creature spell never triggers it.
    let creatureGame = readyToCast([BEAR()], [NONCREATURE_CAST_DRAIN(), FOREST(), FOREST()]);
    const life0b = creatureGame.players[0]!.life;
    creatureGame = applyAction(creatureGame, 0, { type: "cast", cardId: "hand-0" });
    expect(creatureGame.players[0]!.life).toBe(life0b);
  });

  it("sacrifices Standstill and draws for the caster's opponents, never the caster", () => {
    const profile = profileOf(STANDSTILL());
    expect(profile.triggers[0]).toMatchObject({
      event: "spell-cast", subject: "each-player",
      effect: { kind: "compound", effects: [{ kind: "sacrifice-source" }, { kind: "each-opponent-of-event-player-draws", amount: 3 }] }
    });
    expect(profile.fullyImplemented).toBe(true);

    // Seat 1 casts the spell; Standstill lives on seat 0's battlefield but
    // it's seat 1's OWN opponent (seat 0) who draws, not seat 1.
    let game = readyToCast([], [STANDSTILL(), SWAMP()], [BOLT()], [MOUNTAIN()]);
    game = { ...game, players: game.players.map((player) => ({ ...player, autoPass: false })) };
    game = applyAction(game, 0, { type: "pass" });
    const hand0Before = game.players[0]!.hand.length;
    game = applyAction(game, 1, { type: "cast", cardId: "foe-0", targets: [{ kind: "player", seat: 0 }] });
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Test Standstill")).toBe(false);
    expect(game.players[0]!.hand.length).toBe(hand0Before + 3);
    expect(game.players[1]!.hand).toHaveLength(0);
  });

  it("draws off any player's instant or sorcery, never their creature spells", () => {
    const profile = profileOf(INSTANT_OR_SORCERY_CAST_DRAW());
    expect(profile.triggers[0]).toMatchObject({ event: "spell-cast", subject: "each-player", spellType: "instant-or-sorcery", effect: { kind: "draw", amount: 1 } });
    expect(profile.fullyImplemented).toBe(true);

    // An opponent's instant still draws a card for this permanent's controller.
    let game = readyToCast([], [INSTANT_OR_SORCERY_CAST_DRAW(), ISLAND(), ISLAND()], [BOLT()], [MOUNTAIN()]);
    game = { ...game, players: game.players.map((player) => ({ ...player, autoPass: false })) };
    game = applyAction(game, 0, { type: "pass" });
    const hand0Before = game.players[0]!.hand.length;
    game = applyAction(game, 1, { type: "cast", cardId: "foe-0", targets: [{ kind: "player", seat: 0 }] });
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[0]!.hand.length).toBe(hand0Before + 1);

    // A creature spell never triggers it, even cast by its own controller.
    let creatureGame = readyToCast([BEAR()], [INSTANT_OR_SORCERY_CAST_DRAW(), FOREST(), FOREST()]);
    const handBeforeCreature = creatureGame.players[0]!.hand.length;
    creatureGame = applyAction(creatureGame, 0, { type: "cast", cardId: "hand-0" });
    expect(creatureGame.players[0]!.hand.length).toBe(handBeforeCreature - 1);
  });

  it("fires Prowess only for noncreature spells and pumps its source", () => {
    const prowess = make({
      name: "Monk", type_line: "Creature — Human Monk", mana_cost: "{1}{U}", cmc: 2,
      power: "1", toughness: "1", keywords: ["Prowess"], oracle_text: "Prowess"
    });
    expect(profileOf(prowess)).toMatchObject({
      keywords: ["prowess"],
      triggers: [{ event: "spell-cast", subject: "you", spellType: "noncreature", targetKind: "none", effect: { kind: "modify-source-creature", power: 1, toughness: 1 } }],
      fullyImplemented: true
    });
    let game = readyToCast([BOLT()], [prowess, MOUNTAIN()]);
    game = { ...game, players: game.players.map((player) => ({ ...player, autoPass: false })) };
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 1 }] });
    const trigger = game.stack.find((entry) => entry.trigger?.definition.sourceText === "Prowess");
    expect(trigger?.trigger?.definition.spellType).toBe("noncreature");
    game = passUntil(game, (state) => state.stack.length === 0 && state.triggerQueue.length === 0
      && state.players[0]!.battlefield.find((permanent) => permanent.card.name === "Monk")?.powerModifier === 1);
    expect(game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Monk")?.toughnessModifier).toBe(1);

    let creatureSpell = readyToCast([BEAR()], [prowess, FOREST(), FOREST()]);
    creatureSpell = { ...creatureSpell, players: creatureSpell.players.map((player) => ({ ...player, autoPass: false })) };
    creatureSpell = applyAction(creatureSpell, 0, { type: "cast", cardId: "hand-0" });
    expect(creatureSpell.stack.some((entry) => entry.trigger?.definition.sourceText === "Prowess")).toBe(false);
  });

  it("sacrifices Standstill and draws for the spell caster's opponents", () => {
    const profile = profileOf(STANDSTILL());
    expect(profile.triggers[0]).toMatchObject({
      event: "spell-cast", subject: "each-player",
      effect: { kind: "compound", effects: [{ kind: "sacrifice-source" }, { kind: "each-opponent-of-event-player-draws", amount: 3 }] }
    });
    expect(profile.fullyImplemented).toBe(true);

    let game = readyToCast([], [STANDSTILL(), SWAMP()], [BOLT()], [MOUNTAIN()]);
    game = { ...game, players: game.players.map((player) => ({ ...player, autoPass: false })) };
    game = applyAction(game, 0, { type: "pass" });
    const hand0Before = game.players[0]!.hand.length;
    game = applyAction(game, 1, { type: "cast", cardId: "foe-0", targets: [{ kind: "player", seat: 0 }] });
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Test Standstill")).toBe(false);
    expect(game.players[0]!.hand.length).toBe(hand0Before + 3);
    expect(game.players[1]!.hand).toHaveLength(0);
  });

  it("returns a targeted artifact permanent to its owner's hand", () => {
    expect(profileOf(ARTIFACT_BOUNCE()).targetKind).toBe("artifact");
    let game = readyToCast([ARTIFACT_BOUNCE()], [ISLAND(), ISLAND()], [], [TEST_ARTIFACT()]);
    const target = game.players[1]!.battlefield[0]!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: target.instance_id }] });
    expect(game.players[1]!.hand.some((card) => card.name === "Test Relic")).toBe(true);
  });

  it("returns a targeted enchantment permanent to its owner's hand", () => {
    expect(profileOf(ENCHANTMENT_BOUNCE()).targetKind).toBe("enchantment");
    let game = readyToCast([ENCHANTMENT_BOUNCE()], [ISLAND(), ISLAND()], [], [make({ name: "Test Oath", type_line: "Enchantment" })]);
    const target = game.players[1]!.battlefield[0]!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: target.instance_id }] });
    expect(game.players[1]!.hand.some((card) => card.name === "Test Oath")).toBe(true);
  });

  it("returns an enchantment card from the graveyard to the battlefield", () => {
    expect(profileOf(ENCHANTMENT_GRAVEYARD_BATTLEFIELD()).effects).toEqual([{ kind: "return-target-enchantment-card-from-graveyard-to-battlefield" }]);
    const targetCard = make({ name: "Dead Oath", type_line: "Enchantment" });
    let game = readyToCast([ENCHANTMENT_GRAVEYARD_BATTLEFIELD()], [FOREST(), FOREST(), FOREST()]);
    game = stage(game, 0, () => ({ graveyard: toHand(0, [targetCard], "dead-oath") }));
    const target = legalTargets(game, 0, "enchantment-card-in-your-graveyard")[0]!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [target] });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Dead Oath")).toBe(true);
  });

  it("exposes graveyard cards from either player for cross-graveyard exile", () => {
    expect(profileOf(ANY_GRAVEYARD_EXILE()).targetKind).toBe("card-in-a-graveyard");
    let game = readyToCast([ANY_GRAVEYARD_EXILE()], [SWAMP()]);
    game = stage(game, 1, () => ({ graveyard: toHand(1, [BEAR()], "opponent-grave") }));
    expect(legalTargets(game, 0, "card-in-a-graveyard")).toHaveLength(1);
  });

  it("returns a card from either graveyard to its owner's hand", () => {
    expect(profileOf(ANY_GRAVEYARD_RETURN()).targetKind).toBe("card-in-a-graveyard");
    let game = readyToCast([ANY_GRAVEYARD_RETURN()], [FOREST(), FOREST(), FOREST()]);
    game = stage(game, 1, () => ({ graveyard: toHand(1, [BEAR()], "opponent-return") }));
    const target = legalTargets(game, 0, "card-in-a-graveyard")[0]!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [target] });
    expect(game.players[1]!.hand.some((card) => card.name === "Grizzly Bears")).toBe(true);
  });

  it("filters cross-graveyard exile to creature cards", () => {
    expect(profileOf(ANY_CREATURE_EXILE()).targetKind).toBe("creature-card-in-a-graveyard");
    let game = readyToCast([ANY_CREATURE_EXILE()], [SWAMP(), SWAMP()]);
    game = stage(game, 1, () => ({ graveyard: toHand(1, [BEAR(), FOREST()], "cross-creature") }));
    expect(legalTargets(game, 0, "creature-card-in-a-graveyard")).toHaveLength(1);
  });

  it("filters cross-graveyard exile to artifact cards", () => {
    expect(profileOf(ANY_ARTIFACT_EXILE()).targetKind).toBe("artifact-card-in-a-graveyard");
    let game = readyToCast([ANY_ARTIFACT_EXILE()], [SWAMP(), SWAMP()]);
    game = stage(game, 1, () => ({ graveyard: toHand(1, [TEST_ARTIFACT(), BEAR()], "cross-artifact") }));
    expect(legalTargets(game, 0, "artifact-card-in-a-graveyard")).toHaveLength(1);
  });

  it("filters cross-graveyard exile to enchantment cards", () => {
    expect(profileOf(ANY_ENCHANTMENT_EXILE()).targetKind).toBe("enchantment-card-in-a-graveyard");
    let game = readyToCast([ANY_ENCHANTMENT_EXILE()], [SWAMP(), SWAMP()]);
    game = stage(game, 1, () => ({ graveyard: toHand(1, [make({ name: "Dead Oath", type_line: "Enchantment" }), BEAR()], "cross-enchantment") }));
    expect(legalTargets(game, 0, "enchantment-card-in-a-graveyard")).toHaveLength(1);
  });

  it("filters cross-graveyard exile to land cards", () => {
    expect(profileOf(ANY_LAND_EXILE()).targetKind).toBe("land-card-in-a-graveyard");
    let game = readyToCast([ANY_LAND_EXILE()], [SWAMP(), SWAMP()]);
    game = stage(game, 1, () => ({ graveyard: toHand(1, [FOREST(), BEAR()], "cross-land") }));
    expect(legalTargets(game, 0, "land-card-in-a-graveyard")).toHaveLength(1);
  });

  it("scales any-target damage from controlled creatures", () => {
    expect(profileOf(CREATURE_COUNT_BOLT()).effects).toEqual([{ kind: "damage-any-target-each-controlled-type", type: "Creature" }]);
  });

  it("draws for the chosen player and for every player when instructed", () => {
    let game = readyToCast([DEEP_STUDY()], [ISLAND(), FOREST()]);
    const opponentLibrary = game.players[1]!.library.length;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 1 }] });
    expect(game.players[1]!.hand).toHaveLength(2);
    expect(game.players[1]!.library).toHaveLength(opponentLibrary - 2);

    game = readyToCast([VISION_SKEINS()], [ISLAND(), FOREST()]);
    const before = game.players.map((player) => player.library.length);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.players.map((player, seat) => player.library.length)).toEqual(before.map((count, seat) => count - 2));
  });

  it("models a wheel as discard-to-graveyard followed by equal draws", () => {
    expect(profileOf(WHEEL_SPELL()).effects).toEqual([{ kind: "each-player-discard-and-draw", amount: 7 }]);
  });

  it("moves a targeted player's entire hand to their graveyard", () => {
    let game = readyToCast([DISCARD_HAND_SPELL()], [SWAMP(), SWAMP(), SWAMP(), SWAMP()], [BEAR(), BEAR()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 1 }] });
    expect(game.players[1]!.hand).toHaveLength(0);
    expect(game.players[1]!.graveyard.filter((card) => card.name === "Grizzly Bears")).toHaveLength(2);
  });

  it("scales targeted life loss from the caster's creature count", () => {
    expect(profileOf(CREATURE_COUNT_LOSS()).effects).toEqual([{ kind: "lose-life-target-player-each-controlled-type", type: "Creature" }]);
    let game = readyToCast([CREATURE_COUNT_LOSS()], [SWAMP(), SWAMP(), SWAMP()], [], [BEAR()]);
    game = putOnBattlefield(game, 0, [BEAR(), BEAR()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 1 }] });
    expect(game.players[1]!.life).toBe(38);
  });

  it("mills every player with the same deterministic amount", () => {
    expect(profileOf(ALL_MILL_SPELL()).effects).toEqual([{ kind: "mill-each-player", amount: 2 }]);
  });

  it("separates player-only damage from creature-and-player sweepers", () => {
    expect(profileOf(ALL_PLAYER_DAMAGE()).effects).toEqual([{ kind: "damage-each-player", amount: 2 }]);
  });

  it("deals spell damage to every creature and lets state-based actions clear lethal damage", () => {
    let game = readyToCast([PYROCLASM()], [MOUNTAIN(), MOUNTAIN(), BEAR()], [], [BEAR()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Grizzly Bears")).toBe(false);
    expect(game.players[1]!.battlefield.some((permanent) => permanent.card.name === "Grizzly Bears")).toBe(false);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Pyroclasm")).toBe(true);
  });

  it("compiles the five-card damage and restricted-target batch", () => {
    expect(profileOf(ANNIHILATE()).fullyImplemented).toBe(true);
    expect(profileOf(FAMINE()).fullyImplemented).toBe(true);
    expect(profileOf(DEATH_GRASP()).fullyImplemented).toBe(true);
    expect(profileOf(LIGHTNING_HELIX())).toMatchObject({
      targetKind: "any",
      effects: [{ kind: "compound", effects: [{ kind: "damage-any-target", amount: 3 }, { kind: "gain-life", amount: 3 }] }],
      fullyImplemented: true
    });
    expect(profileOf(FLYING_REMOVAL()).fullyImplemented).toBe(true);
    expect(profileOf(NONBASIC_REMOVAL()).fullyImplemented).toBe(true);

    let game = readyToCast([FAMINE()], [SWAMP(), SWAMP(), SWAMP(), SWAMP(), SWAMP()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.players[0]!.life).toBe(37);
    expect(game.players[1]!.life).toBe(37);

    game = readyToCast([DEATH_GRASP()], [SWAMP(), SWAMP(), PLAINS(), FOREST()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", variableValue: 2, targets: [{ kind: "player", seat: 1 }] });
    expect(game.players[1]!.life).toBe(38);
    expect(game.players[0]!.life).toBe(42);

    game = readyToCast([LIGHTNING_HELIX()], [MOUNTAIN(), PLAINS()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 1 }] });
    expect(game.players[1]!.life).toBe(37);
    expect(game.players[0]!.life).toBe(43);

    expect(profileOf(TREASURE_HUNT())).toMatchObject({
      targetKind: "none",
      effects: [{ kind: "reveal-until-nonland-to-hand" }],
      fullyImplemented: true
    });
    game = readyToCast([TREASURE_HUNT()], [ISLAND(), ISLAND()]);
    game = stage(game, 0, (player) => ({ library: toHand(0, [FOREST(), ISLAND(), BEAR()], "treasure-library") }));
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.players[0]!.hand.map((card) => card.name)).toEqual(["Forest", "Island", "Grizzly Bears"]);
    expect(game.players[0]!.library).toHaveLength(0);

    expect(profileOf(PSIONIC_BLAST())).toMatchObject({
      targetKind: "any",
      effects: [{ kind: "compound", effects: [{ kind: "damage-any-target", amount: 4 }, { kind: "damage-controller", amount: 2 }] }],
      fullyImplemented: true
    });
    game = readyToCast([PSIONIC_BLAST()], [ISLAND(), ISLAND(), ISLAND()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 1 }] });
    expect(game.players[1]!.life).toBe(36);
    expect(game.players[0]!.life).toBe(38);
  });

  it("filters power-threshold creature targets before resolution", () => {
    const profile = profileOf(BIG_CREATURE_REMOVAL());
    expect(profile.targetKind).toBe("creature-power-at-least-5");
    let game = readyToCast([BIG_CREATURE_REMOVAL()], [FOREST(), FOREST(), FOREST()], [], [TRAMPLER(), BEAR()]);
    expect(legalTargets(game, 0, "creature-power-at-least-5")).toHaveLength(1);
    const target = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Big Stomper")!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: target.instance_id }] });
    expect(game.players[1]!.battlefield.some((permanent) => permanent.card.name === "Big Stomper")).toBe(false);
  });

  it("reuses typed artifact-or-creature targeting for Mortify", () => {
    expect(profileOf(MORTIFY())).toMatchObject({ targetKind: "creature-or-enchantment", fullyImplemented: true });
    const enchantment = make({ name: "Test Enchantment", type_line: "Enchantment" });
    let game = readyToCast([MORTIFY()], [PLAINS(), SWAMP(), SWAMP()], [], [enchantment, BEAR()]);
    expect(legalTargets(game, 0, "creature-or-enchantment")).toHaveLength(2);
    const target = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Test Enchantment")!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: target.instance_id }] });
    expect(game.players[1]!.battlefield.some((permanent) => permanent.instance_id === target.instance_id)).toBe(false);
  });

  it("uses continuous flying grants when filtering flying targets", () => {
    let game = readyToCast([FLYING_REMOVAL()], [FOREST(), FOREST(), FOREST()], [], [FLYING_LORD(), BEAR()]);
    expect(legalTargets(game, 0, "creature-with-flying")).toHaveLength(2);
    expect(legalTargets(game, 0, "creature-with-flying").every((target) => target.kind === "permanent")).toBe(true);
  });

  it("filters creatures by current toughness threshold", () => {
    const profile = profileOf(TOUGH_CREATURE_REMOVAL());
    expect(profile.targetKind).toBe("creature-toughness-at-least-4");
    let game = readyToCast([TOUGH_CREATURE_REMOVAL()], [FOREST(), FOREST(), FOREST()], [], [WALL(), BEAR()]);
    expect(legalTargets(game, 0, "creature-toughness-at-least-4")).toHaveLength(1);
  });

  it("supports the inverse power threshold for small creatures", () => {
    expect(profileOf(SMALL_CREATURE_REMOVAL()).targetKind).toBe("creature-power-at-most-4");
    const game = readyToCast([SMALL_CREATURE_REMOVAL()], [FOREST(), FOREST(), FOREST()], [], [TRAMPLER(), BEAR()]);
    expect(legalTargets(game, 0, "creature-power-at-most-4")).toHaveLength(1);
  });

  it("supports low-toughness creature target filters", () => {
    expect(profileOf(TOUGHNESS_REMOVAL()).targetKind).toBe("creature-toughness-at-most-4");
    const game = readyToCast([TOUGHNESS_REMOVAL()], [FOREST(), FOREST(), FOREST()], [], [WALL(), TRAMPLER()]);
    expect(legalTargets(game, 0, "creature-toughness-at-most-4")).toHaveLength(1);
  });

  it("uses enforced defender when selecting defender creature targets", () => {
    expect(profileOf(DEFENDER_REMOVAL()).targetKind).toBe("creature-with-defender");
    const game = readyToCast([DEFENDER_REMOVAL()], [FOREST(), FOREST(), FOREST()], [], [WALL(), BEAR()]);
    expect(legalTargets(game, 0, "creature-with-defender")).toHaveLength(1);
  });

  it("uses enforced deathtouch when selecting deathtouch creature targets", () => {
    expect(profileOf(DEATHTOUCH_REMOVAL()).targetKind).toBe("creature-with-deathtouch");
    const game = readyToCast([DEATHTOUCH_REMOVAL()], [FOREST(), FOREST(), FOREST()], [], [DEATHTOUCHER(), BEAR()]);
    expect(legalTargets(game, 0, "creature-with-deathtouch")).toHaveLength(1);
  });

  it("uses enforced lifelink when selecting lifelink creature targets", () => {
    expect(profileOf(LIFELINK_REMOVAL()).targetKind).toBe("creature-with-lifelink");
    const game = readyToCast([LIFELINK_REMOVAL()], [FOREST(), FOREST(), FOREST()], [], [LIFELINKER(), BEAR()]);
    expect(legalTargets(game, 0, "creature-with-lifelink")).toHaveLength(1);
  });

  it("uses enforced menace when selecting menace creature targets", () => {
    expect(profileOf(MENACE_REMOVAL()).targetKind).toBe("creature-with-menace");
    const game = readyToCast([MENACE_REMOVAL()], [FOREST(), FOREST(), FOREST()], [], [GLOBAL_FEAR(), BEAR()]);
    expect(legalTargets(game, 0, "creature-with-menace")).toHaveLength(0);
  });

  it("supports haste creature target filtering", () => {
    expect(profileOf(HASTE_REMOVAL()).targetKind).toBe("creature-with-haste");
    const game = readyToCast([HASTE_REMOVAL()], [FOREST(), FOREST(), FOREST()], [], [HASTE_LORD(), BEAR()]);
    expect(legalTargets(game, 0, "creature-with-haste")).toHaveLength(2);
  });

  it("supports first-strike creature target filtering", () => {
    expect(profileOf(FIRST_STRIKE_REMOVAL()).targetKind).toBe("creature-with-first-strike");
    const game = readyToCast([FIRST_STRIKE_REMOVAL()], [FOREST(), FOREST(), FOREST()], [], [FIRST_STRIKER(), BEAR()]);
    expect(legalTargets(game, 0, "creature-with-first-strike")).toHaveLength(1);
  });

  it("supports double-strike creature target filtering", () => {
    expect(profileOf(DOUBLE_STRIKE_REMOVAL()).targetKind).toBe("creature-with-double-strike");
    const game = readyToCast([DOUBLE_STRIKE_REMOVAL()], [FOREST(), FOREST(), FOREST()], [], [make({ name: "Twin Viper", type_line: "Creature — Snake", power: "2", toughness: "2", keywords: ["Double strike"] }), BEAR()]);
    expect(legalTargets(game, 0, "creature-with-double-strike")).toHaveLength(1);
  });

  it("supports trample creature target filtering", () => {
    expect(profileOf(TRAMPLE_REMOVAL()).targetKind).toBe("creature-with-trample");
    const game = readyToCast([TRAMPLE_REMOVAL()], [FOREST(), FOREST(), FOREST()], [], [TRAMPLER(), BEAR()]);
    expect(legalTargets(game, 0, "creature-with-trample")).toHaveLength(1);
  });

  it("supports vigilance creature target filtering", () => {
    expect(profileOf(VIGILANCE_REMOVAL()).targetKind).toBe("creature-with-vigilance");
    const game = readyToCast([VIGILANCE_REMOVAL()], [FOREST(), FOREST(), FOREST()], [], [make({ name: "Vigilant Knight", type_line: "Creature — Knight", power: "2", toughness: "2", keywords: ["Vigilance"] }), BEAR()]);
    expect(legalTargets(game, 0, "creature-with-vigilance")).toHaveLength(1);
  });

  it("supports indestructible creature target filtering", () => {
    expect(profileOf(INDESTRUCTIBLE_REMOVAL()).targetKind).toBe("creature-with-indestructible");
    const game = readyToCast([INDESTRUCTIBLE_REMOVAL()], [FOREST(), FOREST(), FOREST()], [], [make({ name: "Iron Saint", type_line: "Creature — Angel", power: "4", toughness: "4", keywords: ["Indestructible"] }), BEAR()]);
    expect(legalTargets(game, 0, "creature-with-indestructible")).toHaveLength(1);
  });

  it("allows the controller to select its own hexproof creature", () => {
    expect(profileOf(HEXPROOF_REMOVAL()).targetKind).toBe("creature-with-hexproof");
    let game = readyToCast([HEXPROOF_REMOVAL()], [FOREST(), FOREST(), FOREST()], [], [make({ name: "Hex Saint", type_line: "Creature — Spirit", power: "2", toughness: "2", keywords: ["Hexproof"] })]);
    game = putOnBattlefield(game, 0, [make({ name: "Own Hex Saint", type_line: "Creature — Spirit", power: "2", toughness: "2", keywords: ["Hexproof"] })]);
    expect(legalTargets(game, 0, "creature-with-hexproof")).toHaveLength(1);
  });

  it("allows shroud creatures only through legal-target ownership rules", () => {
    expect(profileOf(SHROUD_REMOVAL()).targetKind).toBe("creature-with-shroud");
    let game = readyToCast([SHROUD_REMOVAL()], [FOREST(), FOREST(), FOREST()], [], [make({ name: "Shrouded Saint", type_line: "Creature — Spirit", power: "2", toughness: "2", keywords: ["Shroud"] })]);
    game = putOnBattlefield(game, 0, [make({ name: "Own Shrouded Saint", type_line: "Creature — Spirit", power: "2", toughness: "2", keywords: ["Shroud"] })]);
    expect(legalTargets(game, 0, "creature-with-shroud")).toHaveLength(0);
  });

  it("supports reach creature target filtering", () => {
    expect(profileOf(REACH_REMOVAL()).targetKind).toBe("creature-with-reach");
    const game = readyToCast([REACH_REMOVAL()], [FOREST(), FOREST(), FOREST()], [], [make({ name: "Reach Spider", type_line: "Creature — Spider", power: "2", toughness: "4", keywords: ["Reach"] }), BEAR()]);
    expect(legalTargets(game, 0, "creature-with-reach")).toHaveLength(1);
  });

  it("applies all-creature P/T changes as cleanup-expiring modifiers", () => {
    expect(profileOf(INFEST()).fullyImplemented).toBe(true);
    let game = readyToCast([INFEST()], [SWAMP(), SWAMP(), FOREST(), GIANT()], [], [GIANT()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    const own = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Hill Giant")!;
    const foe = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Hill Giant")!;
    expect([powerOf(own), toughnessOf(own)]).toEqual([1, 1]);
    expect([powerOf(foe), toughnessOf(foe)]).toEqual([1, 1]);
    expect(own).toMatchObject({ powerModifier: -2, toughnessModifier: -2 });
  });

  it("adds a reusable +1/+1 counter to the chosen creature", () => {
    let game = readyToCast([GROWTH_SPELL()], [FOREST(), FOREST()], [], [BEAR()]);
    const target = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    expect(profileOf(GROWTH_SPELL()).effects).toContainEqual({ kind: "add-counter-target-creature", counter: "+1/+1", amount: 1 });
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: target.instance_id }] });
    game = applyAction(game, 0, { type: "pass" });
    const grown = game.players[1]!.battlefield.find((permanent) => permanent.instance_id === target.instance_id)!;
    expect(grown.counters["+1/+1"]).toBe(1);
    expect(powerOf(grown, game)).toBe(3);
    expect(toughnessOf(grown, game)).toBe(3);
  });

  it("lets the targeted player choose the card discarded from their hand", () => {
    let game = readyToCast([DISCARD_SPELL()], [SWAMP(), SWAMP()], [BEAR(), FLIER()]);
    expect(profileOf(DISCARD_SPELL()).effects).toContainEqual({ kind: "discard-target-player", amount: 1 });
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 1 }] });
    game = applyAction(game, 0, { type: "pass" });
    expect(game.pendingChoice).toMatchObject({ type: "discard-cards", seat: 1, remaining: 1 });
    const options = legalActions(game, 1).filter((entry) => entry.action.type === "choose-discard");
    expect(options.map((entry) => entry.cardId)).toEqual(expect.arrayContaining(["foe-0", "foe-1"]));
    game = applyAction(game, 1, { type: "choose-discard", sourceId: game.pendingChoice!.sourceId, cardId: "foe-1" });
    expect(game.pendingChoice).toBeNull();
    expect(game.players[1]!.hand.map((card) => card.name)).toEqual(["Grizzly Bears"]);
    expect(game.players[1]!.graveyard.at(-1)?.name).toBe("Storm Crow");
  });

  it("reuses player-or-planeswalker targeting for Blightning's discard sentence", () => {
    expect(profileOf(BLIGHTNING())).toMatchObject({
      targetKind: "player-or-planeswalker",
      effects: [
        { kind: "damage-any-target", amount: 3 },
        { kind: "discard-target-player-or-planeswalker", amount: 2 }
      ],
      fullyImplemented: true
    });
    let game = readyToCast([BLIGHTNING()], [MOUNTAIN(), SWAMP(), SWAMP()], [BEAR(), FLIER()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 1 }] });
    game = applyAction(game, 0, { type: "pass" });
    expect(game.players[1]!.life).toBe(37);
    expect(game.pendingChoice).toMatchObject({ type: "discard-cards", seat: 1, remaining: 2 });
    const sourceId = game.pendingChoice!.sourceId;
    game = applyAction(game, 1, { type: "choose-discard", sourceId, cardId: "foe-0" });
    game = applyAction(game, 1, { type: "choose-discard", sourceId, cardId: "foe-1" });
    expect(game.players[1]!.hand).toHaveLength(0);
  });

  it("reacts differently to each type of card an opponent discards, via Waste Not", () => {
    const profile = profileOf(WASTE_NOT());
    expect(profile.triggers).toHaveLength(3);
    expect(profile.triggers[0]).toMatchObject({ event: "card-discarded", subject: "opponent", discardedCardType: "creature", effect: { kind: "create-token" } });
    expect(profile.triggers[1]).toMatchObject({ event: "card-discarded", subject: "opponent", discardedCardType: "land", effect: { kind: "add-mana", pool: { B: 2 } } });
    expect(profile.triggers[2]).toMatchObject({ event: "card-discarded", subject: "opponent", discardedCardType: "noncreature-nonland", effect: { kind: "draw", amount: 1 } });

    // A discarded creature card creates a Zombie token for Waste Not's controller.
    let game = readyToCast([DISCARD_SPELL()], [SWAMP(), SWAMP()], [BEAR()]);
    game = putOnBattlefield(game, 0, [WASTE_NOT()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 1 }] });
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "choose-discard", sourceId: game.pendingChoice!.sourceId, cardId: "foe-0" });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Zombie")).toBe(true);

    // A discarded land card adds {B}{B} for Waste Not's controller.
    game = readyToCast([DISCARD_SPELL()], [SWAMP(), SWAMP()], [FOREST()]);
    game = putOnBattlefield(game, 0, [WASTE_NOT()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 1 }] });
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "choose-discard", sourceId: game.pendingChoice!.sourceId, cardId: "foe-0" });
    expect(game.players[0]!.manaPool.B).toBe(2);

    // A discarded noncreature, nonland card draws a card for Waste Not's controller.
    game = readyToCast([DISCARD_SPELL()], [SWAMP(), SWAMP()], [SOL_RING()]);
    game = putOnBattlefield(game, 0, [WASTE_NOT()]);
    const hand0Before = game.players[0]!.hand.length;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 1 }] });
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "choose-discard", sourceId: game.pendingChoice!.sourceId, cardId: "foe-0" });
    expect(game.players[0]!.hand.length).toBe(hand0Before);
  });

  it("lets Forget's targeted player discard two then draw that many back", () => {
    let game = readyToCast([FORGET()], [ISLAND(), ISLAND()], [BEAR(), FLIER(), SOL_RING()]);
    game = stage(game, 1, (player) => ({ library: [...toHand(1, [TEST_ARTIFACT(), MOUNTAIN()], "forget-library"), ...player.library] }));
    expect(profileOf(FORGET()).effects).toContainEqual({ kind: "discard-target-player-then-draw-same", amount: 2 });
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 1 }] });
    game = applyAction(game, 0, { type: "pass" });
    expect(game.pendingChoice).toMatchObject({ type: "discard-cards", seat: 1, remaining: 2, thenDrawSame: true });
    expect(game.players[1]!.hand).toHaveLength(3);

    game = applyAction(game, 1, { type: "choose-discard", sourceId: game.pendingChoice!.sourceId, cardId: "foe-0" });
    expect(game.pendingChoice).toMatchObject({ type: "discard-cards", seat: 1, remaining: 1 });
    expect(game.players[1]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);

    game = applyAction(game, 1, { type: "choose-discard", sourceId: game.pendingChoice!.sourceId, cardId: "foe-1" });
    expect(game.pendingChoice).toBeNull();
    expect(game.players[1]!.graveyard.filter((card) => ["Grizzly Bears", "Storm Crow"].includes(card.name))).toHaveLength(2);
    expect(game.players[1]!.hand).toHaveLength(3);
    expect(game.players[1]!.hand.some((card) => card.name === "Test Relic")).toBe(true);
    expect(game.players[1]!.hand.some((card) => card.name === "Mountain")).toBe(true);
  });

  it("draws and loses life equal to half the targeted player's library and life, rounded up", () => {
    expect(profileOf(PEER_INTO_THE_ABYSS()).effects).toEqual([{ kind: "draw-half-library-then-lose-half-life-target-player" }]);
    let game = readyToCast([PEER_INTO_THE_ABYSS()], [SWAMP(), SWAMP(), SWAMP(), SWAMP(), SWAMP(), SWAMP(), SWAMP()]);
    game = stage(game, 1, () => ({
      library: toHand(1, [BEAR(), FLIER(), SOL_RING(), MOUNTAIN(), ISLAND(), TEST_ARTIFACT(), FOREST()], "abyss-library"),
      life: 15
    }));
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 1 }] });
    game = applyAction(game, 0, { type: "pass" });
    expect(game.players[1]!.hand).toHaveLength(4);
    expect(game.players[1]!.library).toHaveLength(3);
    expect(game.players[1]!.life).toBe(7);
  });

  it("uses X to request multiple private discard choices", () => {
    let game = readyToCast([X_DISCARD_SPELL()], [SWAMP(), SWAMP(), SWAMP(), SWAMP()]);
    game = stage(game, 0, (player) => ({ autoPass: false }));
    game = stage(game, 1, (player) => ({ autoPass: false, hand: toHand(1, [BEAR(), FLIER(), FOREST()], "x-discard-hand") }));
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", variableValue: 2, targets: [{ kind: "player", seat: 1 }] });
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "pass" });
    expect(game.pendingChoice).toMatchObject({ type: "discard-cards", seat: 1, amount: 2, remaining: 2 });
    const sourceId = game.pendingChoice!.sourceId;
    game = applyAction(game, 1, { type: "choose-discard", sourceId, cardId: "x-discard-hand-0" });
    game = applyAction(game, 1, { type: "choose-discard", sourceId, cardId: "x-discard-hand-1" });
    expect(game.pendingChoice).toBeNull();
    expect(game.players[1]!.hand).toHaveLength(1);
  });

  it("punishes any discard by an opponent, not just draw-triggered ones", () => {
    const profile = profileOf(LIFELOSS_ON_OPPONENT_DISCARD());
    expect(profile.triggers[0]).toMatchObject({ event: "card-discarded", subject: "opponent", effect: { kind: "lose-life-event-player", amount: 2 } });
    expect(profile.fullyImplemented).toBe(true);

    let game = readyToCast([DISCARD_SPELL()], [SWAMP(), SWAMP(), LIFELOSS_ON_OPPONENT_DISCARD()], [BEAR(), FLIER()]);
    const life1 = game.players[1]!.life;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 1 }] });
    game = applyAction(game, 0, { type: "pass" });
    expect(game.pendingChoice).toMatchObject({ type: "discard-cards", seat: 1 });
    game = applyAction(game, 1, { type: "choose-discard", sourceId: game.pendingChoice!.sourceId, cardId: "foe-1" });
    expect(game.pendingChoice).toBeNull();
    expect(game.players[1]!.life).toBe(life1 - 2);
  });

  it("lets Lightning Bolt target a creature as well as a player", () => {
    let game = readyToCast([BOLT()], [MOUNTAIN()], [], [BEAR()]);
    const bearId = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!.instance_id;
    expect(legalTargets(game, 0, "any")).toContainEqual({ kind: "player", seat: 1 });
    expect(legalTargets(game, 0, "any")).toContainEqual({ kind: "permanent", instanceId: bearId });
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: bearId }] });
    expect(game.players[1]!.battlefield.some((permanent) => permanent.instance_id === bearId)).toBe(false);
    expect(game.players[1]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);
  });

  it("enforces restricted permanent targets for destroy and bounce effects", () => {
    let game = readyToCast([BEDEVIL()], [SWAMP(), SWAMP(), SWAMP()], [], [BEAR(), SOL_RING()]);
    const creatureId = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!.instance_id;
    const artifactId = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Sol Ring")!.instance_id;
    expect(legalTargets(game, 0, "artifact-creature-or-planeswalker")).toContainEqual({ kind: "permanent", instanceId: creatureId });
    expect(legalTargets(game, 0, "artifact-creature-or-planeswalker")).toContainEqual({ kind: "permanent", instanceId: artifactId });
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: creatureId }] });
    expect(game.players[1]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);

    game = readyToCast([UNSUMMON()], [ISLAND()], [], [BEAR()]);
    const bounceId = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!.instance_id;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: bounceId }] });
    expect(game.players[1]!.hand.some((card) => card.name === "Grizzly Bears")).toBe(true);
  });

  it("keeps artifact, enchantment, and land removal targets separate", () => {
    expect(profileOf(ARTIFACT_REMOVAL()).fullyImplemented).toBe(true);
    expect(profileOf(ENCHANTMENT_REMOVAL()).fullyImplemented).toBe(true);
    expect(profileOf(LAND_REMOVAL()).fullyImplemented).toBe(true);

    let game = readyToCast([ARTIFACT_REMOVAL()], [MOUNTAIN(), MOUNTAIN()], [], [SOL_RING(), BEAR()]);
    const artifact = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Sol Ring")!;
    expect(legalTargets(game, 0, "artifact")).toContainEqual({ kind: "permanent", instanceId: artifact.instance_id });
    expect(legalTargets(game, 0, "artifact")).not.toContainEqual(expect.objectContaining({ kind: "permanent", instanceId: expect.stringContaining("Grizzly") }));
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: artifact.instance_id }] });
    expect(game.players[1]!.graveyard.some((card) => card.name === "Sol Ring")).toBe(true);
  });

  it("resolves the artifact-creature-enchantment board sweep", () => {
    expect(profileOf(DISK()).fullyImplemented).toBe(true);
    let game = readyToCast([], [FOREST(), FOREST(), DISK(), BEAR(), SOL_RING()]);
    const disk = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Nevinyrral's Disk")!;
    game = applyAction(game, 0, { type: "activate", sourceId: disk.instance_id, abilityIndex: 0 });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Nevinyrral's Disk")).toBe(false);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Grizzly Bears")).toBe(false);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Forest")).toBe(true);
  });

  it("offers and resolves each supported Choose one mode", () => {
    const dromar = DROMARS_CHARM();
    expect(profileOf(dromar).fullyImplemented).toBe(true);
    expect(profileOf(dromar).modalChoices).toHaveLength(3);
    let game = readyToCast([dromar], [PLAINS(), ISLAND(), SWAMP()], [], [BEAR()]);
    const modes = legalActions(game, 0).filter((entry) => entry.action.type === "cast" && entry.cardId === "hand-0");
    expect(modes).toHaveLength(2);
    expect(modes.some((entry) => entry.label.includes("You gain 5 life"))).toBe(true);
    expect(modes.some((entry) => entry.label.includes("Target creature gets -2/-2"))).toBe(true);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", mode: 0 });
    expect(game.players[0]!.life).toBe(45);

    game = readyToCast([CROSIS_CHARM()], [ISLAND(), SWAMP(), MOUNTAIN()], [], [SOL_RING()]);
    const ring = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Sol Ring")!;
    const destroy = legalActions(game, 0).find((entry) => entry.action.type === "cast" && entry.cardId === "hand-0" && entry.action.mode === 2);
    expect(destroy?.requiresTarget).toBe("artifact");
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", mode: 2, targets: [{ kind: "permanent", instanceId: ring.instance_id }] });
    expect(game.players[1]!.graveyard.some((card) => card.name === "Sol Ring")).toBe(true);
  });

  it("implements Hull Breach's three modal target branches", () => {
    const profile = profileOf(C13_HULL_BREACH());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.modalChoices).toHaveLength(3);
    expect(profile.modalChoices).toMatchObject([
      { targetKind: "artifact" },
      { targetKind: "enchantment" },
      { targetKind: "artifact", targetKinds: ["artifact", "enchantment"], effect: { kind: "compound", targetOffsets: [0, 1] } }
    ]);

    let game = readyToCast([C13_HULL_BREACH()], [MOUNTAIN(), FOREST()], [], [SOL_RING()]);
    const artifact = game.players[1]!.battlefield[0]!;
    const artifactMode = legalActions(game, 0).find((entry) =>
      entry.action.type === "cast" && entry.cardId === "hand-0" && entry.action.mode === 0);
    expect(artifactMode?.requiresTarget).toBe("artifact");
    game = applyAction(game, 0, {
      type: "cast", cardId: "hand-0", mode: 0,
      targets: [{ kind: "permanent", instanceId: artifact.instance_id }]
    });
    expect(game.players[1]!.graveyard.some((card) => card.name === "Sol Ring")).toBe(true);

    game = readyToCast([C13_HULL_BREACH()], [MOUNTAIN(), FOREST()], [], [BLUE_PERMANENT()]);
    const enchantment = game.players[1]!.battlefield[0]!;
    const enchantmentMode = legalActions(game, 0).find((entry) =>
      entry.action.type === "cast" && entry.cardId === "hand-0" && entry.action.mode === 1);
    expect(enchantmentMode?.requiresTarget).toBe("enchantment");
    game = applyAction(game, 0, {
      type: "cast", cardId: "hand-0", mode: 1,
      targets: [{ kind: "permanent", instanceId: enchantment.instance_id }]
    });
    expect(game.players[1]!.graveyard.some((card) => card.name === "Blue Permanent")).toBe(true);

    game = readyToCast([C13_HULL_BREACH()], [MOUNTAIN(), FOREST()], [], [SOL_RING(), BLUE_PERMANENT()]);
    const both = legalActions(game, 0).find((entry) =>
      entry.action.type === "cast" && entry.cardId === "hand-0" && entry.action.mode === 2);
    expect(both?.requiresTargets).toEqual(["artifact", "enchantment"]);
    const bothArtifact = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Sol Ring")!;
    const bothEnchantment = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Blue Permanent")!;
    game = applyAction(game, 0, {
      type: "cast", cardId: "hand-0", mode: 2,
      targets: [
        { kind: "permanent", instanceId: bothArtifact.instance_id },
        { kind: "permanent", instanceId: bothEnchantment.instance_id }
      ]
    });
    expect(game.players[1]!.graveyard.map((card) => card.name)).toEqual(expect.arrayContaining(["Sol Ring", "Blue Permanent"]));
  });

  it("offers Deceiver Exarch's ETB modes before selecting the mode's target", () => {
    const profile = profileOf(C13_DECEIVER_EXARCH());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.triggers[0]).toMatchObject({
      event: "enters-battlefield",
      modalEffects: [
        { targetKind: "permanent-you-control" },
        { targetKind: "permanent-opponent" }
      ]
    });

    let game = readyToCast([C13_DECEIVER_EXARCH()], [ISLAND(), ISLAND(), ISLAND()], [], [SOL_RING()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = passUntil(game, (state) => state.pendingChoice?.type === "trigger-mode");
    const mode = game.pendingChoice;
    if (mode?.type !== "trigger-mode") throw new Error("expected Deceiver Exarch's mode choice");
    expect(mode.options.map((option) => option.targetKind)).toEqual(["permanent-you-control", "permanent-opponent"]);
    game = applyAction(game, 0, { type: "choose-trigger-mode", sourceId: mode.sourceId, optionIndex: 0 });
    expect(game.pendingChoice?.type).toBe("trigger-target");
    const target = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Island")!;
    if (game.pendingChoice?.type !== "trigger-target") throw new Error("expected Deceiver Exarch target choice");
    game = applyAction(game, 0, { type: "choose-trigger-target", sourceId: game.pendingChoice.sourceId, target: { kind: "permanent", instanceId: target.instance_id } });
    game = passUntil(game, (state) => state.pendingChoice === null && state.stack.length === 0 && state.triggerQueue.length === 0);
    expect(game.players[0]!.battlefield.find((permanent) => permanent.instance_id === target.instance_id)?.tapped).toBe(false);
  });

  it("offers and resolves the synthetic both mode with ordered targets", () => {
    const profile = profileOf(FISSURE_VENT());
    expect(profile.modalChoices).toHaveLength(3);
    expect(profile.modalChoices[2]).toMatchObject({
      text: "Choose both",
      effect: { kind: "compound", targetOffsets: [0, 1] },
      targetKind: "artifact",
      targetKinds: ["artifact", "nonbasic-land"]
    });
    expect(profile.fullyImplemented).toBe(true);

    let game = readyToCast([FISSURE_VENT()], [MOUNTAIN(), MOUNTAIN(), MOUNTAIN(), MOUNTAIN()], [], [SOL_RING(), COMMAND_TOWER()]);
    const artifact = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Sol Ring")!;
    const land = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Command Tower")!;
    const both = legalActions(game, 0).find((entry) => entry.action.type === "cast" && entry.cardId === "hand-0" && entry.action.mode === 2);
    expect(both?.requiresTargets).toEqual(["artifact", "nonbasic-land"]);
    game = applyAction(game, 0, {
      type: "cast", cardId: "hand-0", mode: 2,
      targets: [{ kind: "permanent", instanceId: artifact.instance_id }, { kind: "permanent", instanceId: land.instance_id }]
    });
    expect(game.players[1]!.battlefield).toHaveLength(0);
    expect(game.players[1]!.graveyard.map((card) => card.name)).toEqual(expect.arrayContaining(["Sol Ring", "Command Tower"]));
  });

  it("generates every legal subset for Choose one or more", () => {
    const rain = make({
      name: "Rain of Thorns", type_line: "Sorcery", mana_cost: "{4}{G}{G}", cmc: 6,
      oracle_text: "Choose one or more —\n• Destroy target artifact.\n• Destroy target creature.\n• Destroy target land."
    });
    const profile = profileOf(rain);
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.modalChoices).toHaveLength(7);
    expect(profile.modalChoices.filter((choice) => choice.targetKinds?.length === 3)).toHaveLength(1);
    const minimumTwo = profileOf({ ...rain, name: "Rain of Thorns (minimum two)", scryfall_id: "test-rain-minimum-two", oracle_text: rain.oracle_text!.replace("one or more", "two or more") });
    expect(minimumTwo.modalChoices).toHaveLength(4);

    let game = readyToCast([rain], [FOREST(), FOREST(), FOREST(), FOREST(), FOREST(), FOREST()], [], [SOL_RING(), BEAR(), COMMAND_TOWER()]);
    const all = legalActions(game, 0).find((entry) => entry.action.type === "cast" && entry.cardId === "hand-0" && entry.action.mode !== undefined && entry.requiresTargets?.length === 3);
    expect(all?.requiresTargets).toEqual(["artifact", "creature", "land"]);
    if (!all || all.action.type !== "cast") throw new Error("Rain of Thorns should expose the all-target modal action.");
    const artifact = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Sol Ring")!;
    const creature = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    const land = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Command Tower")!;
    game = applyAction(game, 0, {
      type: "cast", cardId: "hand-0", mode: all.action.mode,
      targets: [
        { kind: "permanent", instanceId: artifact.instance_id },
        { kind: "permanent", instanceId: creature.instance_id },
        { kind: "permanent", instanceId: land.instance_id }
      ]
    });
    expect(game.players[1]!.battlefield).toHaveLength(0);
  });

  it("resolves all Boros Charm modes after normalizing its printed name", () => {
    const charm = BOROS_CHARM();
    expect(profileOf(charm).fullyImplemented).toBe(true);
    expect(profileOf(charm).modalChoices).toHaveLength(3);

    let game = readyToCast([charm], [MOUNTAIN(), PLAINS()]);
    const damage = legalActions(game, 0).find((entry) =>
      entry.action.type === "cast" && entry.cardId === "hand-0" && entry.action.mode === 0);
    expect(damage?.requiresTarget).toBe("player-or-planeswalker");
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", mode: 0, targets: [{ kind: "player", seat: 1 }] });
    expect(game.players[1]!.life).toBe(36);

    game = readyToCast([BOROS_CHARM()], [MOUNTAIN(), PLAINS(), BEAR()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", mode: 1 });
    expect(game.players[0]!.battlefield.every((permanent) => permanent.temporaryKeywords?.includes("indestructible"))).toBe(true);

    game = readyToCast([BOROS_CHARM()], [MOUNTAIN(), PLAINS(), BEAR()]);
    const doubleStrike = legalActions(game, 0).find((entry) =>
      entry.action.type === "cast" && entry.cardId === "hand-0" && entry.action.mode === 2);
    expect(doubleStrike?.requiresTarget).toBe("creature");
  });

  it("resolves Selesnya Charm's token, power-filtered exile, and pump modes", () => {
    const charm = SELESNYA_CHARM();
    expect(profileOf(charm).fullyImplemented).toBe(true);
    expect(profileOf(charm).modalChoices).toHaveLength(3);

    let game = readyToCast([charm], [FOREST(), PLAINS()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", mode: 0 });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Knight")).toBe(true);

    const large = make({ name: "Large Bear", type_line: "Creature — Bear", mana_cost: "{4}", cmc: 4, power: "5", toughness: "5" });
    game = readyToCast([SELESNYA_CHARM()], [FOREST(), PLAINS()], [], [large]);
    const target = game.players[1]!.battlefield[0]!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", mode: 1, targets: [{ kind: "permanent", instanceId: target.instance_id }] });
    expect(game.players[1]!.exile.some((card) => card.name === "Large Bear")).toBe(true);

    game = readyToCast([SELESNYA_CHARM()], [FOREST(), PLAINS(), BEAR()]);
    const pump = legalActions(game, 0).find((entry) =>
      entry.action.type === "cast" && entry.cardId === "hand-0" && entry.action.mode === 2);
    expect(pump?.requiresTarget).toBe("creature");
  });

  it("puts Azorius Charm's creature on top of its owner's library", () => {
    const charm = AZORIUS_CHARM();
    expect(profileOf(charm).fullyImplemented).toBe(true);
    expect(profileOf(charm).modalChoices).toHaveLength(3);
    const creature = make({ name: "Top Bear", type_line: "Creature — Bear", mana_cost: "{1}{G}", cmc: 2, power: "2", toughness: "2" });
    let game = readyToCast([charm], [PLAINS(), ISLAND()], [], [creature]);
    const target = game.players[1]!.battlefield[0]!;
    const action = legalActions(game, 0).find((entry) =>
      entry.action.type === "cast" && entry.cardId === "hand-0" && entry.action.mode === 0);
    expect(action?.requiresTarget).toBe("creature");
    game = applyAction(game, 0, {
      type: "cast",
      cardId: "hand-0",
      mode: 0,
      targets: [{ kind: "permanent", instanceId: target.instance_id }]
    });
    expect(game.players[1]!.battlefield.some((permanent) => permanent.card.name === "Top Bear")).toBe(false);
    expect(game.players[1]!.library[0]!.name).toBe("Top Bear");
  });

  it("resolves Naya Charm's damage, graveyard return, and tap-all modes", () => {
    const charm = NAYA_CHARM();
    expect(profileOf(charm).fullyImplemented).toBe(true);
    expect(profileOf(charm).modalChoices).toHaveLength(3);
    const creature = make({ name: "Naya Target", type_line: "Creature — Beast", mana_cost: "{2}{G}", cmc: 3, power: "3", toughness: "3" });
    let game = readyToCast([charm], [MOUNTAIN(), FOREST(), PLAINS()], [], [creature]);
    const target = game.players[1]!.battlefield[0]!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", mode: 0, targets: [{ kind: "permanent", instanceId: target.instance_id }] });
    expect(game.players[1]!.graveyard.some((card) => card.name === "Naya Target")).toBe(true);

    game = readyToCast([NAYA_CHARM()], [MOUNTAIN(), FOREST(), PLAINS()], [], [BEAR(), SOL_RING()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", mode: 2, targets: [{ kind: "player", seat: 1 }] });
    expect(game.players[1]!.battlefield.filter((permanent) => permanent.card.name === "Grizzly Bears")[0]!.tapped).toBe(true);
    expect(game.players[1]!.battlefield.filter((permanent) => permanent.card.name === "Sol Ring")[0]!.tapped).toBe(false);
  });

  it("reuses haste and self-sacrifice pump for Fires of Yavimaya", () => {
    const profile = profileOf(FIRES_OF_YAVIMAYA());
    expect(profile.staticKeywordGrants).toMatchObject([{ keyword: "haste" }]);
    expect(profile.activatedAbilities[0]).toMatchObject({
      sacrificesSelf: true,
      manaCost: { raw: "{R}{G}" },
      effect: { kind: "modify-creatures-you-control", power: 2, toughness: 2 }
    });
    let game = readyToCast([], [FIRES_OF_YAVIMAYA(), BEAR(), MOUNTAIN(), FOREST()]);
    const fires = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Fires of Yavimaya")!;
    const activation = legalActions(game, 0).find((entry) =>
      entry.action.type === "activate" && entry.action.sourceId === fires.instance_id);
    expect(activation).toBeDefined();
    game = applyAction(game, 0, activation!.action);
    game = passUntil(game, (state) => state.stack.length === 0
      && state.players[0]!.graveyard.some((card) => card.name === "Fires of Yavimaya"));
    expect(game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")?.powerModifier).toBe(2);
  });

  it("sacrifices a creature before resolving Goblin Bombardment", () => {
    const profile = profileOf(GOBLIN_BOMBARDMENT());
    expect(profile.activatedAbilities[0]).toMatchObject({
      sacrificesCreature: "any",
      effect: { kind: "damage-any-target", amount: 1 },
      targetKind: "any"
    });
    let game = readyToCast([], [GOBLIN_BOMBARDMENT(), BEAR()]);
    const bombardment = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Goblin Bombardment")!;
    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    expect(legalActions(game, 0).some((entry) => entry.action.type === "activate"
      && entry.action.sourceId === bombardment.instance_id
      && entry.action.sacrificeId === bear.instance_id)).toBe(true);
    game = applyAction(game, 0, {
      type: "activate",
      sourceId: bombardment.instance_id,
      abilityIndex: 0,
      sacrificeId: bear.instance_id,
      targets: [{ kind: "player", seat: 1 }]
    });
    game = passUntil(game, (state) => state.stack.length === 0 && state.players[1]!.life === 39);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);
  });

  it("lets Goblin Bombardment target a creature and applies lethal damage", () => {
    let game = readyToCast([], [GOBLIN_BOMBARDMENT(), BEAR()], [], [DEATHTOUCHER()]);
    const bombardment = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Goblin Bombardment")!;
    const sacrifice = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    const target = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Tiny Viper")!;
    game = applyAction(game, 0, {
      type: "activate",
      sourceId: bombardment.instance_id,
      abilityIndex: 0,
      sacrificeId: sacrifice.instance_id,
      targets: [{ kind: "permanent", instanceId: target.instance_id }]
    });
    game = passUntil(game, (state) => state.stack.length === 0
      && state.players[1]!.graveyard.some((card) => card.name === "Tiny Viper"));
    expect(game.players[0]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);
    expect(game.players[1]!.battlefield.some((permanent) => permanent.instance_id === target.instance_id)).toBe(false);
  });

  it("does not offer Fires of Yavimaya without both colored mana sources", () => {
    const game = readyToCast([], [FIRES_OF_YAVIMAYA(), MOUNTAIN(), BEAR()]);
    const fires = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Fires of Yavimaya")!;
    expect(legalActions(game, 0).some((entry) => entry.action.type === "activate" && entry.action.sourceId === fires.instance_id)).toBe(false);
  });

  it("does not offer Goblin Bombardment without a creature to sacrifice", () => {
    const game = readyToCast([], [GOBLIN_BOMBARDMENT()]);
    const bombardment = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Goblin Bombardment")!;
    expect(legalActions(game, 0).some((entry) => entry.action.type === "activate" && entry.action.sourceId === bombardment.instance_id)).toBe(false);
  });

  it("lets a creature attack immediately under Fires of Yavimaya", () => {
    let game = readyToCast([], []);
    game = putOnBattlefield(game, 0, [FIRES_OF_YAVIMAYA(), BEAR()], { sick: true });
    game = passUntil(game, (state) => state.step === "declare-attackers" && state.activeSeat === 0 && state.prioritySeat === 0);
    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    expect(legalActions(game, 0).some((entry) => entry.action.type === "declare-attackers"
      && entry.action.attackers.some((attacker) => attacker.instanceId === bear.instance_id))).toBe(true);
  });

  it("keeps Fires of Yavimaya's pump limited to its controller's creatures", () => {
    let game = readyToCast([], [FIRES_OF_YAVIMAYA(), BEAR(), MOUNTAIN(), FOREST()], [BEAR()]);
    const fires = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Fires of Yavimaya")!;
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.action.sourceId === fires.instance_id)!;
    game = applyAction(game, 0, activation.action);
    game = passUntil(game, (state) => state.stack.length === 0
      && state.players[0]!.graveyard.some((card) => card.name === "Fires of Yavimaya"));
    expect(game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")?.powerModifier).toBe(2);
    expect(game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")?.powerModifier ?? 0).toBe(0);
  });

  it("reuses the landfall trigger subject when a land enters", () => {
    let game = readyToCast([LANDFALL_BEAST(), FOREST()], [FOREST(), FOREST(), FOREST()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Landfall Beast")).toBe(true);
    game = applyAction(game, 0, { type: "play-land", cardId: "hand-1" });
    expect(game.players[0]!.battlefield.filter((permanent) => permanent.card.name === "Beast")).toHaveLength(1);
    expect(game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Beast")?.card).toMatchObject({ power: "4", toughness: "4", type_line: "Creature — Beast" });
  });

  it("offers optional life gain for Grazing Gladehart landfall", () => {
    const profile = profileOf(C13_GRAZING_GLADEHART());
    expect(profile.triggers[0]).toMatchObject({ event: "enters-battlefield", subject: "land-you-control", optional: true, effect: { kind: "gain-life", amount: 2 } });
    expect(profile.fullyImplemented).toBe(true);
    let game = readyToCast([C13_GRAZING_GLADEHART(), FOREST()], [FOREST(), FOREST(), FOREST()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = applyAction(game, 0, { type: "play-land", cardId: "hand-1" });
    game = passUntil(game, (state) => state.pendingChoice?.type === "optional-trigger");
    const choice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "optional-trigger" }>;
    game = applyAction(game, 0, { type: "choose-trigger", sourceId: choice.sourceId, accept: true });
    game = passUntil(game, (state) => state.stack.length === 0 && state.triggerQueue.length === 0);
    expect(game.players[0]!.life).toBe(42);
  });

  it("creates Hunted Troll's Faeries under the targeted opponent's control", () => {
    const profile = profileOf(C13_HUNTED_TROLL());
    expect(profile.triggers[0]).toMatchObject({ event: "enters-battlefield", targetKind: "opponent", effect: { kind: "create-token-for-target-player", amount: 4 } });
    expect(profile.fullyImplemented).toBe(true);
    let game = readyToCast([C13_HUNTED_TROLL()], [FOREST(), FOREST(), FOREST(), FOREST()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = passUntil(game, (state) => state.stack.length === 0 && state.triggerQueue.length === 0);
    expect(game.players[1]!.battlefield.filter((permanent) => permanent.card.name === "Faerie")).toHaveLength(4);
    expect(game.players[1]!.battlefield.every((permanent) => permanent.card.name !== "Faerie" || permanent.card.keywords?.includes("flying"))).toBe(true);
  });

  it("offers each landcycling variant and searches the matching subtype", () => {
    let game = readyToCast([VALLEY_RANNET()], [MOUNTAIN(), MOUNTAIN()]);
    game = stage(game, 0, (player) => ({ library: toHand(0, [MOUNTAIN(), FOREST()], "library") }));
    const options = legalActions(game, 0).filter((entry) => entry.action.type === "cycle");
    expect(options).toHaveLength(2);
    expect(options.map((entry) => entry.label)).toEqual(["Mountaincycling {2} Valley Rannet", "Forestcycling {2} Valley Rannet"]);
    game = applyAction(game, 0, { type: "cycle", cardId: "hand-0", cyclingIndex: 0 });
    expect(game.pendingChoice).toMatchObject({ type: "search-library", sourceCard: { name: "Valley Rannet" } });
    game = applyAction(game, 0, { type: "choose-library-card", sourceId: game.pendingChoice!.sourceId, query: "Mountain" });
    expect(game.players[0]!.hand.some((card) => card.name === "Mountain")).toBe(true);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Valley Rannet")).toBe(true);
  });

  it("rejects a forged landcycling option", () => {
    const game = readyToCast([VALLEY_RANNET()], [MOUNTAIN(), MOUNTAIN()]);
    expect(() => applyAction(game, 0, { type: "cycle", cardId: "hand-0", cyclingIndex: 99 })).toThrow("no existe");
  });

  it("reuses the triggered self-modifier for C13 Baloth Woodcrasher", () => {
    let game = readyToCast([C13_BALOTH_WOODCRASHER(), FOREST()], [FOREST(), FOREST(), FOREST(), FOREST(), FOREST(), FOREST()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = applyAction(game, 0, { type: "play-land", cardId: "hand-1" });
    game = passUntil(game, (state) => state.stack.length === 0 && state.triggerQueue.length === 0
      && (state.players[0]!.battlefield.find((permanent) => permanent.card.name === "Baloth Woodcrasher")?.powerModifier ?? 0) === 4);
    const baloth = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Baloth Woodcrasher")!;
    expect(baloth.powerModifier).toBe(4);
    expect(baloth.toughnessModifier).toBe(4);
    expect(baloth.temporaryKeywords).toContain("trample");
  });

  it("resolves a triggered self P/T modifier without requiring an event target", () => {
    let game = readyToCast([LANDFALL_SELF_PUMP(), FOREST()], [FOREST(), FOREST(), FOREST(), FOREST()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    const sourceId = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Landfall Self Pump")!.instance_id;
    game = applyAction(game, 0, { type: "play-land", cardId: "hand-1" });
    game = passUntil(game, (state) => state.stack.length === 0 && state.triggerQueue.length === 0
      && (state.players[0]!.battlefield.find((permanent) => permanent.instance_id === sourceId)?.powerModifier ?? 0) === 2);
    expect(game.players[0]!.battlefield.find((permanent) => permanent.instance_id === sourceId)).toMatchObject({ powerModifier: 2, toughnessModifier: 2 });
  });

  it("uses the defending player's lands for Terra Ravager", () => {
    let game = readyToCast([], [TERRA_RAVAGER()], [], [FOREST(), FOREST(), FOREST()]);
    game = { ...game, players: game.players.map((player) => ({ ...player, autoPass: false })), step: "declare-attackers", activeSeat: 0, prioritySeat: 0, priorityOpen: true, passedSeats: [], combat: { ...game.combat, attackers: [], blockers: [], attackersDeclared: false, blockersDeclared: false, firstStrikeResolved: false, damageResolved: false } };
    const terra = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Terra Ravager")!;
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: terra.instance_id, defender: 1 }] });
    game = passUntil(game, (state) => state.step === "declare-blockers" && state.stack.length === 0 && state.triggerQueue.length === 0);
    const attackingTerra = game.players[0]!.battlefield.find((permanent) => permanent.instance_id === terra.instance_id)!;
    expect(powerOf(attackingTerra, game)).toBe(3);
  });

  it("keeps C13 Basalt Monolith tapped through untap and resolves its untap activation", () => {
    let game = readyToCast([], [C13_BASALT_MONOLITH(), FOREST(), FOREST(), FOREST()]);
    const basalt = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Basalt Monolith")!;
    const mana = legalActions(game, 0).find((entry) => entry.action.type === "activate-mana" && entry.action.sourceId === basalt.instance_id);
    expect(mana?.action.type).toBe("activate-mana");
    game = applyAction(game, 0, mana!.action);
    expect(game.players[0]!.battlefield.find((permanent) => permanent.instance_id === basalt.instance_id)?.tapped).toBe(true);

    game = { ...game, step: "untap", priorityOpen: false, prioritySeat: 0, passedSeats: [] };
    game = settle(game);
    expect(game.players[0]!.battlefield.find((permanent) => permanent.instance_id === basalt.instance_id)?.tapped).toBe(true);

    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.action.sourceId === basalt.instance_id);
    expect(activation?.action.type).toBe("activate");
    game = applyAction(game, 0, activation!.action);
    game = passUntil(game, (state) => state.stack.length === 0 && state.players[0]!.battlefield.find((permanent) => permanent.instance_id === basalt.instance_id)?.tapped === false);
    expect(game.players[0]!.battlefield.find((permanent) => permanent.instance_id === basalt.instance_id)?.tapped).toBe(false);
  });

  it("locks an opposing creature with C13 Dungeon Geists while the source is controlled", () => {
    let game = readyToCast([C13_DUNGEON_GEISTS()], [ISLAND(), ISLAND(), ISLAND(), ISLAND()], [], [BEAR(), BEAR()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = passUntil(game, (state) => state.pendingChoice?.type === "trigger-target");
    const choice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "trigger-target" }>;
    expect(choice.targetKind).toBe("creature-opponent");
    expect(choice.options).toHaveLength(2);
    const target = choice.options[0]!;
    expect(target.kind).toBe("permanent");
    game = applyAction(game, 0, { type: "choose-trigger-target", sourceId: choice.sourceId, target });
    game = passUntil(game, (state) => state.pendingChoice === null && state.stack.length === 0);
    const targetId = target.kind === "permanent" ? target.instanceId : "";
    expect(game.players[1]!.battlefield.find((permanent) => permanent.instance_id === targetId)?.tapped).toBe(true);

    game = { ...game, step: "untap", activeSeat: 1, priorityOpen: false, prioritySeat: 1, passedSeats: [] };
    game = settle(game);
    expect(game.players[1]!.battlefield.find((permanent) => permanent.instance_id === targetId)?.tapped).toBe(true);
  });

  it("exiles a selected graveyard and returns any selected permanent to its owner", () => {
    let game = readyToCast([GRAVE_PURGE()], [SWAMP()]);
    game = stage(game, 1, (player) => ({ graveyard: toHand(1, [BEAR()], "fallen") }));
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 1 }] });
    expect(game.players[1]!.graveyard).toHaveLength(0);
    expect(game.players[1]!.exile.some((card) => card.name === "Grizzly Bears")).toBe(true);

    game = readyToCast([BOOMERANG()], [ISLAND(), ISLAND()], [], [SOL_RING()]);
    const target = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Sol Ring")!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: target.instance_id }] });
    expect(game.players[1]!.battlefield.some((permanent) => permanent.instance_id === target.instance_id)).toBe(false);
    expect(game.players[1]!.hand.some((card) => card.name === "Sol Ring")).toBe(true);
  });

  it("offers legal X values and uses the chosen value when Fireball resolves", () => {
    let game = readyToCast([FIREBALL()], [MOUNTAIN(), FOREST(), FOREST()]);
    const options = legalActions(game, 0).filter((entry) => entry.action.type === "cast" && entry.cardId === "hand-0");
    expect(options.map((entry) => entry.action.type === "cast" ? entry.action.variableValue : undefined)).toContain(2);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", variableValue: 2, targets: [{ kind: "player", seat: 1 }] });
    expect(game.players[1]!.life).toBe(38);
  });

  it("does not overclaim Fireball while its extra-target cost is unsupported", () => {
    const profile = cardProfile(FIREBALL());
    expect(profile.fullyImplemented).toBe(false);
    expect(profile.unimplementedText.some((text) => /costs.*more.*target/i.test(text))).toBe(true);
  });

  it("lets Enlightened Tutor choose a legal artifact from the library", () => {
    let game = readyToCast([TUTOR()], [PLAINS()]);
    game = stage(game, 0, (player) => ({ library: [...toHand(0, [SOL_RING()], "library"), ...player.library] }));
    expect(profileOf(TUTOR()).fullyImplemented).toBe(true);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.pendingChoice).toMatchObject({ type: "search-library", seat: 0 });
    expect(legalActions(game, 1)).toHaveLength(0);
    const search = legalActions(game, 0).find((entry) => entry.action.type === "choose-library-card");
    expect(search?.label).toBe("Elegir carta de la biblioteca");
    expect(search?.action.type).toBe("choose-library-card");
    expect(JSON.stringify(search?.action)).not.toContain("Sol Ring");
    game = applyAction(game, 0, { type: "choose-library-card", sourceId: game.pendingChoice!.sourceId, query: "Sol Ring" });
    expect(game.players[0]!.library[0]!.name).toBe("Sol Ring");
    expect(game.players[0]!.graveyard.some((card) => card.name === "Enlightened Tutor")).toBe(true);
  });

  it("normalizes whitespace and Unicode compatibility forms in library searches", () => {
    const tutor = TUTOR();
    const printed = make({ name: "Apostrophe’s Relic", type_line: "Artifact", mana_cost: "{1}", cmc: 1, oracle_text: "" });
    let game = readyToCast([tutor], [PLAINS()]);
    game = stage(game, 0, (player) => ({ library: [...toHand(0, [printed], "library"), ...player.library] }));
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = applyAction(game, 0, { type: "choose-library-card", sourceId: game.pendingChoice!.sourceId, query: "  Apostrophe’s   Relic " });
    expect(game.players[0]!.library[0]!.name).toBe("Apostrophe’s Relic");
  });

  it("pays Diabolic Intent's sacrifice-a-creature additional cost, then tutors a chosen card to hand", () => {
    const intent = DIABOLIC_INTENT();
    expect(profileOf(intent).fullyImplemented).toBe(true);
    let game = readyToCast([intent], [SWAMP(), SWAMP(), BEAR()]);
    game = stage(game, 0, (player) => ({ library: [...toHand(0, [SOL_RING()], "library"), ...player.library] }));
    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.instance_id === bear.instance_id)).toBe(false);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);
    expect(game.pendingChoice).toMatchObject({ type: "search-library", seat: 0 });
    game = applyAction(game, 0, { type: "choose-library-card", sourceId: game.pendingChoice!.sourceId, query: "Sol Ring" });
    expect(game.players[0]!.hand.some((card) => card.name === "Sol Ring")).toBe(true);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Diabolic Intent")).toBe(true);
  });

  it("lets Fling choose the sacrificed creature and uses its last-known power", () => {
    // CR 601.2b, 608.2h: choose the additional-cost sacrifice while casting,
    // then use that creature's power after it has left the battlefield.
    const fling = FLING();
    expect(profileOf(fling)).toMatchObject({
      additionalCostSacrificeCreature: true,
      targetKind: "any",
      effects: [{ kind: "damage-any-target-equal-sacrificed-creature-power" }],
      fullyImplemented: true
    });
    const small = make({ name: "Small Sacrifice", type_line: "Creature — Bear", mana_cost: "{1}{G}", cmc: 2, power: "2", toughness: "2" });
    const large = make({ name: "Large Sacrifice", type_line: "Creature — Beast", mana_cost: "{4}{G}", cmc: 5, power: "5", toughness: "5" });
    let game = readyToCast([fling], [MOUNTAIN(), MOUNTAIN(), small, large]);
    const permanents = game.players[0]!.battlefield;
    const smallPermanent = permanents.find((permanent) => permanent.card.name === "Small Sacrifice")!;
    const largePermanent = permanents.find((permanent) => permanent.card.name === "Large Sacrifice")!;
    const options = legalActions(game, 0).filter((entry) => entry.action.type === "cast" && entry.cardId === "hand-0");
    expect(options.map((entry) => entry.action.type === "cast" ? entry.action.sacrificeId : undefined)).toEqual(expect.arrayContaining([smallPermanent.instance_id, largePermanent.instance_id]));

    game = applyAction(game, 0, {
      type: "cast",
      cardId: "hand-0",
      sacrificeId: largePermanent.instance_id,
      targets: [{ kind: "player", seat: 1 }]
    });
    expect(game.players[0]!.graveyard.some((card) => card.name === "Large Sacrifice")).toBe(true);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.instance_id === smallPermanent.instance_id)).toBe(true);
    expect(game.players[1]!.life).toBe(35);
  });

  it("keeps Incinerate from being regenerated after it deals damage", () => {
    // CR 615.1, 701.19: the rider applies only to a creature actually dealt
    // damage and lasts through the current cleanup step.
    const incinerate = INCINERATE();
    expect(profileOf(incinerate)).toMatchObject({
      targetKind: "any",
      effects: [{ kind: "damage-any-target-prevents-regeneration", amount: 3 }],
      fullyImplemented: true
    });
    let game = readyToCast([incinerate], [MOUNTAIN(), MOUNTAIN()], [], [make({ name: "Regeneration Test", type_line: "Creature — Beast", mana_cost: "{4}{G}", cmc: 5, power: "5", toughness: "5" })]);
    const target = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Regeneration Test")!;
    game = stage(game, 1, (player) => ({ battlefield: player.battlefield.map((permanent) => permanent.instance_id === target.instance_id
      ? { ...permanent, regenerationShields: 1 } : permanent) }));
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: target.instance_id }] });
    const damaged = game.players[1]!.battlefield.find((permanent) => permanent.instance_id === target.instance_id)!;
    expect(damaged).toMatchObject({ damage: 3, regenerationShields: 1, cantRegenerateUntilEndOfTurn: true });
    game = stage(game, 1, (player) => ({ battlefield: player.battlefield.map((permanent) => permanent.instance_id === target.instance_id
      ? { ...permanent, damage: 5 } : permanent) }));
    game = applyAction(game, pendingSeat(game)!, { type: "pass" });
    expect(game.players[1]!.battlefield.some((permanent) => permanent.instance_id === target.instance_id)).toBe(false);
    expect(game.players[1]!.graveyard.some((card) => card.name === "Regeneration Test")).toBe(true);
  });

  it("exiles a creature marked by Lava Coil instead of putting it in a graveyard", () => {
    // CR 614.1, 700.4: the rider creates a replacement effect for this turn;
    // the creature's battlefield-to-graveyard move is replaced by exile.
    const lavaCoil = LAVA_COIL();
    expect(profileOf(lavaCoil)).toMatchObject({
      targetKind: "creature",
      effects: [{ kind: "damage-any-target-exiles-if-dies", amount: 4 }],
      fullyImplemented: true
    });
    const targetCard = make({ name: "Lava Coil Target", type_line: "Creature — Beast", mana_cost: "{4}{G}", cmc: 5, power: "5", toughness: "5" });
    let game = readyToCast([lavaCoil], [MOUNTAIN(), MOUNTAIN()], [], [targetCard]);
    const target = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Lava Coil Target")!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: target.instance_id }] });
    const damaged = game.players[1]!.battlefield.find((permanent) => permanent.instance_id === target.instance_id)!;
    expect(damaged).toMatchObject({ damage: 4, exileIfWouldDieUntilEndOfTurn: true });
    game = stage(game, 1, (player) => ({ battlefield: player.battlefield.map((permanent) => permanent.instance_id === target.instance_id
      ? { ...permanent, damage: 5 } : permanent) }));
    game = applyAction(game, pendingSeat(game)!, { type: "pass" });
    expect(game.players[1]!.battlefield.some((permanent) => permanent.instance_id === target.instance_id)).toBe(false);
    expect(game.players[1]!.graveyard.some((card) => card.name === "Lava Coil Target")).toBe(false);
    expect(game.players[1]!.exile.some((card) => card.name === "Lava Coil Target")).toBe(true);
  });

  it("uses the kicked damage amount for Burst Lightning without changing its target restriction", () => {
    // CR 702.33e, 614.1: the kicked clause replaces the base damage amount;
    // it does not create a second damage event or widen the target set.
    const burst = BURST_LIGHTNING();
    expect(profileOf(burst)).toMatchObject({
      kickerCost: { raw: "{4}" },
      targetKind: "any",
      effects: [{ kind: "damage-any-target", amount: 2, kickedAmount: 4 }],
      kickedEffects: [],
      fullyImplemented: true
    });
    let game = readyToCast([burst], [MOUNTAIN(), MOUNTAIN(), MOUNTAIN(), MOUNTAIN(), MOUNTAIN()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 1 }] });
    expect(game.players[1]!.life).toBe(38);

    game = readyToCast([BURST_LIGHTNING()], [MOUNTAIN(), MOUNTAIN(), MOUNTAIN(), MOUNTAIN(), MOUNTAIN()]);
    const kickedAction = legalActions(game, 0).find((entry) => entry.action.type === "cast" && entry.cardId === "hand-0" && entry.action.kicked);
    expect(kickedAction).toBeDefined();
    if (!kickedAction || kickedAction.action.type !== "cast") throw new Error("Burst Lightning kicker action missing.");
    game = applyAction(game, 0, { ...kickedAction.action, targets: [{ kind: "player", seat: 1 }] });
    expect(game.players[1]!.life).toBe(36);
  });

  it("can't cast Diabolic Intent with no creature to sacrifice", () => {
    let game = readyToCast([DIABOLIC_INTENT()], [SWAMP(), SWAMP()]);
    expect(legalActions(game, 0).some((entry) => entry.action.type === "cast")).toBe(false);
    expect(() => applyAction(game, 0, { type: "cast", cardId: "hand-0" })).toThrow();
  });

  it("lets Widespread Panic put a chosen hand card on top after a library shuffle", () => {
    const panic = WIDESPREAD_PANIC();
    let game = readyToCast([TUTOR(), SOL_RING()], [PLAINS(), panic]);
    game = stage(game, 0, (player) => ({ library: [...toHand(0, [TEST_ARTIFACT()], "panic-library"), ...player.library] }));
    expect(profileOf(panic).fullyImplemented).toBe(true);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = applyAction(game, 0, { type: "choose-library-card", sourceId: game.pendingChoice!.sourceId, query: "Test Relic" });
    expect(game.pendingChoice).toMatchObject({ type: "hand-card-to-library-top", seat: 0 });
    const choice = game.pendingChoice!;
    expect(legalActions(game, 1)).toHaveLength(0);
    const put = legalActions(game, 0).find((entry) => entry.action.type === "choose-hand-card-to-library-top" && entry.cardId === "hand-1");
    expect(put?.label).toBe("Put Sol Ring on top of your library");
    game = applyAction(game, 0, { type: "choose-hand-card-to-library-top", sourceId: choice.sourceId, cardId: "hand-1" });
    expect(game.players[0]!.library[0]!.name).toBe("Sol Ring");
    expect(game.players[0]!.hand.some((card) => card.instance_id === "hand-1")).toBe(false);
   });

  it("lets Mirari pay {3} to copy an instant or sorcery spell", () => {
    const mirari = MIRARI();
    let game = readyToCast([AZORIUS_SPELL()], [PLAINS(), ISLAND(), FOREST(), FOREST(), FOREST(), mirari]);
    game = stage(game, 0, (player) => ({ library: [...toHand(0, [BEAR(), TEST_ARTIFACT()], "mirari-library"), ...player.library] }));
    expect(profileOf(mirari).fullyImplemented).toBe(true);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.pendingChoice).toMatchObject({ type: "optional-trigger", sourceCard: { name: "Mirari" } });
    const accept = legalActions(game, 0).find((entry) => entry.action.type === "choose-trigger" && entry.action.accept);
    expect(accept).toBeDefined();
    game = applyAction(game, 0, accept!.action);
    expect(game.players[0]!.hand.filter((card) => card.name === "Grizzly Bears" || card.name === "Test Relic")).toHaveLength(2);
  });

  it("lets Brainstorm draw three then put two back on top in the chosen order", () => {
    const profile = profileOf(BRAINSTORM());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.effects[0]).toEqual({ kind: "draw-then-put-back-on-top", draw: 3, putBack: 2 });

    let game = readyToCast([BRAINSTORM()], [ISLAND()]);
    game = stage(game, 0, (player) => ({ library: [...toHand(0, [SOL_RING(), BEAR(), TEST_ARTIFACT()], "brainstorm-library"), ...player.library] }));
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.players[0]!.hand).toHaveLength(3);
    expect(game.pendingChoice).toMatchObject({ type: "hand-card-to-library-top", seat: 0, remaining: 2 });
    expect(legalActions(game, 1)).toHaveLength(0);

    let choice = game.pendingChoice!;
    const solRingId = game.players[0]!.hand.find((card) => card.name === "Sol Ring")!.instance_id;
    game = applyAction(game, 0, { type: "choose-hand-card-to-library-top", sourceId: choice.sourceId, cardId: solRingId });
    expect(game.pendingChoice).toMatchObject({ type: "hand-card-to-library-top", seat: 0, remaining: 1 });
    expect(game.players[0]!.library[0]!.name).toBe("Sol Ring");

    choice = game.pendingChoice!;
    const bearId = game.players[0]!.hand.find((card) => card.name === "Grizzly Bears")!.instance_id;
    game = applyAction(game, 0, { type: "choose-hand-card-to-library-top", sourceId: choice.sourceId, cardId: bearId });
    expect(game.pendingChoice).toBeNull();
    expect(game.players[0]!.hand).toHaveLength(1);
    expect(game.players[0]!.library[0]!.name).toBe("Grizzly Bears");
    expect(game.players[0]!.library[1]!.name).toBe("Sol Ring");
  });

  it("lets Deadly Rollick be cast free only while controlling a commander, exiling the target either way", () => {
    const profile = profileOf(DEADLY_ROLLICK());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.effects).toEqual([{ kind: "exile-target-permanent" }]);

    // No commander in play: only the normal paid cast is offered.
    let game = readyToCast([DEADLY_ROLLICK()], [SWAMP(), SWAMP(), SWAMP(), SWAMP()], [], [BEAR()]);
    let target = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    let options = legalActions(game, 0).filter((entry) => entry.action.type === "cast" && entry.cardId === "hand-0");
    expect(options).toHaveLength(1);
    expect(options[0]!.action).not.toHaveProperty("freeCast");
    const manaBefore = game.players[0]!.manaPool;
    expect(manaBefore.B).toBe(0);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: target.instance_id }] });
    game = applyAction(game, 0, { type: "pass" });
    expect(game.players[1]!.exile.some((card) => card.name === "Grizzly Bears")).toBe(true);

    // Controlling a commander unlocks a free-cast option offered alongside the paid one.
    game = readyToCast([DEADLY_ROLLICK()], [SWAMP(), SWAMP(), SWAMP(), SWAMP()], [], [BEAR()]);
    game = putOnBattlefield(game, 0, [COMMANDER("Test Commander")]);
    game = stage(game, 0, (player) => ({
      battlefield: player.battlefield.map((permanent) => permanent.card.name === "Test Commander" ? { ...permanent, isCommander: true } : permanent)
    }));
    target = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    options = legalActions(game, 0).filter((entry) => entry.action.type === "cast" && entry.cardId === "hand-0");
    expect(options).toHaveLength(2);
    const freeOption = options.find((entry) => (entry.action as { freeCast?: boolean }).freeCast);
    expect(freeOption).toBeDefined();

    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", freeCast: true, targets: [{ kind: "permanent", instanceId: target.instance_id }] });
    expect(game.players[0]!.manaPool).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.tapped)).toBe(false);
    game = applyAction(game, 0, { type: "pass" });
    expect(game.players[1]!.exile.some((card) => card.name === "Grizzly Bears")).toBe(true);
  });

  it("recognizes Curse of Inertia and offers its attacker the tap choice", () => {
    const profile = profileOf(CURSE_OF_INERTIA());
    expect(profile).toMatchObject({ fullyImplemented: true, targetKind: "player" });
    expect(profile.triggers[0]).toMatchObject({ event: "attacks", subject: "player-attacks-enchanted-player", optional: true, choiceBy: "event-controller", effect: { kind: "tap-or-untap-target-permanent" }, targetKind: "permanent" });
  });

  it("does not expose a commander free-cast alternative from the graveyard", () => {
    let game = readyToCast([], [SWAMP(), SWAMP(), SWAMP(), SWAMP()], [], [BEAR()]);
    game = putOnBattlefield(game, 0, [COMMANDER("Test Commander")]);
    game = stage(game, 0, (player) => ({
      battlefield: player.battlefield.map(permanent => permanent.card.name === "Test Commander" ? { ...permanent, isCommander: true } : permanent),
      graveyard: toHand(0, [DEADLY_ROLLICK()], "graveyard-rollick")
    }));
    const options = legalActions(game, 0).filter(entry => entry.action.type === "cast" && entry.cardId === "graveyard-rollick-0");
    expect(options.some(entry => (entry.action as { freeCast?: boolean }).freeCast)).toBe(false);
  });

  it("lets Snuff Out be cast by paying 4 life only while controlling a Swamp", () => {
    const profile = profileOf(SNUFF_OUT());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.effects).toEqual([{ kind: "destroy-target-permanent" }]);

    // A black source that isn't a Swamp: only the normal paid cast is offered.
    let game = readyToCast([SNUFF_OUT()], [BLACK_SOURCE(), BLACK_SOURCE(), BLACK_SOURCE(), BLACK_SOURCE()], [], [BEAR()]);
    let target = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    let options = legalActions(game, 0).filter((entry) => entry.action.type === "cast" && entry.cardId === "hand-0");
    expect(options).toHaveLength(1);
    expect(options[0]!.action).not.toHaveProperty("payLifeCost");
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: target.instance_id }] });
    game = applyAction(game, 0, { type: "pass" });
    expect(game.players[1]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);

    // Controlling a Swamp unlocks a life-payment option offered alongside the paid one.
    game = readyToCast([SNUFF_OUT()], [SWAMP(), SWAMP(), SWAMP(), SWAMP()], [], [BEAR()]);
    target = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    options = legalActions(game, 0).filter((entry) => entry.action.type === "cast" && entry.cardId === "hand-0");
    expect(options).toHaveLength(2);
    const lifeOption = options.find((entry) => (entry.action as { payLifeCost?: boolean }).payLifeCost);
    expect(lifeOption).toBeDefined();

    const lifeBefore = game.players[0]!.life;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", payLifeCost: true, targets: [{ kind: "permanent", instanceId: target.instance_id }] });
    expect(game.players[0]!.life).toBe(lifeBefore - 4);
    expect(game.players[0]!.manaPool).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.tapped)).toBe(false);
    game = applyAction(game, 0, { type: "pass" });
    expect(game.players[1]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);
  });

  it("gives the opponent a card only when Baleful Mastery pays its reduced cost", () => {
    const profile = profileOf(BALEFUL_MASTERY());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.effects).toEqual([
      { kind: "opponent-draws-if-cast-via-alternative-cost" },
      { kind: "exile-target-permanent" }
    ]);

    // Paying the normal printed cost: no extra draw for the opponent.
    let game = readyToCast([BALEFUL_MASTERY()], [SWAMP(), SWAMP(), SWAMP(), SWAMP()], [], [BEAR()]);
    let target = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    const options = legalActions(game, 0).filter((entry) => entry.action.type === "cast" && entry.cardId === "hand-0");
    expect(options).toHaveLength(2);
    const hand1BeforePaid = game.players[1]!.hand.length;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: target.instance_id }] });
    game = applyAction(game, 0, { type: "pass" });
    expect(game.players[1]!.exile.some((card) => card.name === "Grizzly Bears")).toBe(true);
    expect(game.players[1]!.hand.length).toBe(hand1BeforePaid);

    // Paying the reduced {1}{B} cost instead: the opponent draws a card.
    game = readyToCast([BALEFUL_MASTERY()], [SWAMP(), SWAMP()], [], [BEAR()]);
    target = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    const reducedOption = legalActions(game, 0).find((entry) => entry.action.type === "cast" && (entry.action as { payReducedCost?: boolean }).payReducedCost);
    expect(reducedOption).toBeDefined();
    const hand1Before = game.players[1]!.hand.length;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", payReducedCost: true, targets: [{ kind: "permanent", instanceId: target.instance_id }] });
    expect(game.players[0]!.manaPool).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
    game = applyAction(game, 0, { type: "pass" });
    expect(game.players[1]!.exile.some((card) => card.name === "Grizzly Bears")).toBe(true);
    expect(game.players[1]!.hand.length).toBe(hand1Before + 1);
  });

  it("reuses the library search family for top, hand and graveyard destinations", () => {
    let game = readyToCast([WORLDLY()], [FOREST()]);
    game = stage(game, 0, (player) => ({ library: [...toHand(0, [SOL_RING(), BEAR()], "worldly-library"), ...player.library] }));
    expect(profileOf(WORLDLY()).effects[0]).toMatchObject({ kind: "search-library", types: ["Creature"], destination: "top" });
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = applyAction(game, 0, { type: "choose-library-card", sourceId: game.pendingChoice!.sourceId, query: "Grizzly Bears" });
    expect(game.players[0]!.library[0]!.name).toBe("Grizzly Bears");

    game = readyToCast([ELADAMRI()], [FOREST(), PLAINS()]);
    game = stage(game, 0, (player) => ({ library: [...toHand(0, [BEAR()], "call-library"), ...player.library] }));
    expect(profileOf(ELADAMRI()).effects[0]).toMatchObject({ kind: "search-library", types: ["Creature"], destination: "hand" });
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = applyAction(game, 0, { type: "choose-library-card", sourceId: game.pendingChoice!.sourceId, query: "Grizzly Bears" });
    expect(game.players[0]!.hand.some((card) => card.name === "Grizzly Bears")).toBe(true);

    game = readyToCast([ENTOMB()], [SWAMP()]);
    game = stage(game, 0, (player) => ({ library: [...toHand(0, [BEAR()], "entomb-library"), ...player.library] }));
    expect(profileOf(ENTOMB()).effects[0]).toMatchObject({ kind: "search-library", types: [], destination: "graveyard" });
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = applyAction(game, 0, { type: "choose-library-card", sourceId: game.pendingChoice!.sourceId, query: "Grizzly Bears" });
    expect(game.players[0]!.graveyard.filter((card) => card.name === "Grizzly Bears")).toHaveLength(1);
  });

  it("puts Aethermage's Touch creature onto the battlefield and returns it next end step", () => {
    const profile = profileOf(C13_AETHERMAGES_TOUCH());
    expect(profile).toMatchObject({
      fullyImplemented: true,
      effects: [{ kind: "look-top-select", amount: 4, types: ["Creature"], destination: "battlefield", returnAtEndStep: true }]
    });
    let game = readyToCast([C13_AETHERMAGES_TOUCH()], [PLAINS(), ISLAND(), ISLAND(), ISLAND()]);
    game = stage(game, 0, (player) => ({ library: [...toHand(0, [BEAR(), ISLAND(), MOUNTAIN(), FLIER()], "aethermage-library"), ...player.library] }));
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.pendingChoice).toMatchObject({ type: "look-top-select", stage: "select", destination: "battlefield" });
    const sourceId = game.pendingChoice!.sourceId;
    game = applyAction(game, 0, { type: "choose-look-top", sourceId, ordinal: 0 });
    while (game.pendingChoice?.type === "look-top-select" && game.pendingChoice.stage === "bottom") {
      game = applyAction(game, 0, { type: "choose-look-top-bottom", sourceId, ordinal: 0 });
    }
    expect(game.pendingChoice).toBeNull();
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Grizzly Bears")).toBe(true);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Aethermage's Touch")).toBe(true);
    expect(game.delayedReturns).toMatchObject([{ card: { name: "Grizzly Bears" }, destination: "hand" }]);
    game = passUntil(game, (state) => state.players[0]!.hand.some((card) => card.name === "Grizzly Bears"));
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Grizzly Bears")).toBe(false);
    expect(game.players[0]!.hand.some((card) => card.name === "Grizzly Bears")).toBe(true);
  });

  it("filters Mayael's top-five selection by minimum power", () => {
    const mayael = make({ name: "Mayael, the Anima", type_line: "Legendary Creature — Elf Shaman", oracle_text: "{3}{R}{G}{W}, {T}: Look at the top five cards of your library. You may put a creature card with power 5 or greater from among them onto the battlefield. Put the rest on the bottom of your library in any order.", scryfall_id: "fixture-mayael" });
    const small = make({ name: "Small Creature", type_line: "Creature — Bear", power: "4", toughness: "4", scryfall_id: "fixture-mayael-small" });
    const large = make({ name: "Large Creature", type_line: "Creature — Beast", power: "5", toughness: "5", scryfall_id: "fixture-mayael-large" });
    const profile = profileOf(mayael);
    expect(profile.activatedAbilities).toContainEqual(expect.objectContaining({ effect: { kind: "look-top-select", amount: 5, types: ["Creature"], destination: "battlefield", minPower: 5 } }));
  });

  it("puts Strategic Planning's unselected top cards into the graveyard", () => {
    const profile = profileOf(C13_STRATEGIC_PLANNING());
    expect(profile).toMatchObject({ fullyImplemented: true, effects: [{ kind: "look-put-one-in-hand", amount: 3, restDestination: "graveyard" }] });
    let game = readyToCast([C13_STRATEGIC_PLANNING()], [ISLAND(), ISLAND()]);
    game = stage(game, 0, (player) => ({ library: [...toHand(0, [BEAR(), MOUNTAIN(), SWAMP()], "planning-library"), ...player.library] }));
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.pendingChoice).toMatchObject({ type: "library-pick", restDestination: "graveyard" });
    const choice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "library-pick" }>;
    game = applyAction(game, 0, { type: "resolve-library-pick", sourceId: choice.sourceId, cardId: "planning-library-1" });
    expect(game.players[0]!.hand.some((card) => card.name === "Mountain")).toBe(true);
    expect(game.players[0]!.graveyard.map((card) => card.name)).toEqual(expect.arrayContaining(["Grizzly Bears", "Swamp", "Strategic Planning"]));
    expect(game.players[0]!.library.some((card) => ["Grizzly Bears", "Mountain", "Swamp"].includes(card.name))).toBe(false);
  });

  it("lets Cultivate choose two basics for battlefield and hand", () => {
    let game = readyToCast([C13_CULTIVATE()], [FOREST(), FOREST(), FOREST()]);
    game = stage(game, 0, (player) => ({ library: [...toHand(0, [ISLAND(), SWAMP()], "cultivate-library"), ...player.library] }));
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.pendingChoice).toMatchObject({ type: "search-library-multi", seat: 0, selectedIds: [] });
    const sourceId = game.pendingChoice!.sourceId;
    game = applyAction(game, 0, { type: "choose-library-card", sourceId, query: "Island" });
    expect(game.pendingChoice).toMatchObject({ type: "search-library-multi", selectedIds: ["cultivate-library-0"] });
    game = applyAction(game, 0, { type: "choose-library-card", sourceId, query: "Swamp" });
    expect(game.pendingChoice).toBeNull();
    expect(game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Island")).toMatchObject({ tapped: true });
    expect(game.players[0]!.hand.some((card) => card.name === "Swamp")).toBe(true);
    expect(game.players[0]!.library.some((card) => card.name === "Island" || card.name === "Swamp")).toBe(false);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Cultivate")).toBe(true);
  });

  it("reuses typed basic-land subtypes for Spoils of Victory", () => {
    const profile = profileOf(C13_SPOILS_OF_VICTORY());
    expect(profile).toMatchObject({
      fullyImplemented: true,
      effects: [{ kind: "search-library", types: ["Land"], subtypes: ["Plains", "Island", "Swamp", "Mountain", "Forest"], destination: "battlefield" }]
    });
    let game = readyToCast([C13_SPOILS_OF_VICTORY()], [FOREST(), FOREST(), FOREST()]);
    game = stage(game, 0, (player) => ({ library: [...toHand(0, [ISLAND(), MOUNTAIN(), BEAR()], "spoils-library"), ...player.library] }));
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.pendingChoice).toMatchObject({ type: "search-library", seat: 0 });
    const choice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "search-library" }>;
    const options = game.players[0]!.library.filter((card) => choice.optionIds.includes(card.instance_id)).map((card) => card.name);
    expect(options).toEqual(expect.arrayContaining(["Island", "Mountain"]));
    expect(options).not.toContain("Grizzly Bears");
    game = applyAction(game, 0, { type: "choose-library-card", sourceId: choice.sourceId, query: "Island" });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Island")).toBe(true);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Spoils of Victory")).toBe(true);
  });

  it("allows an up-to-two basic search to finish without choosing a card", () => {
    let game = readyToCast([C13_CULTIVATE()], [FOREST(), FOREST(), FOREST()]);
    game = stage(game, 0, (player) => ({ library: [...toHand(0, [ISLAND()], "cultivate-optional"), ...player.library] }));
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.pendingChoice?.type).toBe("search-library-multi");
    game = applyAction(game, 0, { type: "finish-library-search", sourceId: game.pendingChoice!.sourceId });
    expect(game.pendingChoice).toBeNull();
    expect(game.players[0]!.library.some((card) => card.name === "Island")).toBe(true);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Island")).toBe(false);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Cultivate")).toBe(true);
  });

  it("orders both top and bottom cards for the reusable Scry 2 primitive", () => {
    let game = readyToCast([SCRY_TWO()], [ISLAND()]);
    game = stage(game, 0, (player) => ({ library: [...toHand(0, [BEAR(), SWAMP()], "scry-two"), ...player.library] }));
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.pendingChoice).toMatchObject({ type: "scry", remainingCards: [{ name: "Grizzly Bears" }, { name: "Swamp" }] });
    const sourceId = game.pendingChoice!.sourceId;
    game = applyAction(game, 0, { type: "choose-scry", sourceId, query: "Grizzly Bears", bottom: true });
    expect(game.pendingChoice).toMatchObject({ type: "scry", remainingCards: [{ name: "Swamp" }] });
    game = applyAction(game, 0, { type: "choose-scry", sourceId, query: "Swamp", bottom: false });
    expect(game.pendingChoice).toBeNull();
    expect(game.players[0]!.library[0]?.name).toBe("Swamp");
    expect(game.players[0]!.library.at(-1)?.name).toBe("Grizzly Bears");
    expect(game.players[0]!.graveyard.some((card) => card.name === "Scry Two")).toBe(true);
  });

  it("sends declined cards to the graveyard for Surveil, not the library bottom", () => {
    expect(profileOf(SURVEIL_TWO()).effects).toContainEqual({ kind: "surveil", amount: 2 });
    expect(profileOf(SURVEIL_TWO()).fullyImplemented).toBe(true);

    let game = readyToCast([SURVEIL_TWO()], [ISLAND()]);
    game = stage(game, 0, (player) => ({ library: [...toHand(0, [BEAR(), SWAMP()], "surveil-two"), ...player.library] }));
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.pendingChoice).toMatchObject({ type: "scry", destination: "graveyard", remainingCards: [{ name: "Grizzly Bears" }, { name: "Swamp" }] });
    const sourceId = game.pendingChoice!.sourceId;
    game = applyAction(game, 0, { type: "choose-scry", sourceId, query: "Grizzly Bears", bottom: true });
    game = applyAction(game, 0, { type: "choose-scry", sourceId, query: "Swamp", bottom: false });
    expect(game.pendingChoice).toBeNull();
    expect(game.players[0]!.library[0]?.name).toBe("Swamp");
    // The declined card lands in the graveyard, never the library bottom.
    expect(game.players[0]!.library.some((card) => card.name === "Grizzly Bears")).toBe(false);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Surveil Two")).toBe(true);
  });

  it("uses an opaque ordinal so duplicate Scry names remain independently selectable", () => {
    let game = readyToCast([SCRY_TWO()], [ISLAND()]);
    game = stage(game, 0, (player) => ({ library: [...toHand(0, [BEAR(), BEAR()], "scry-duplicates"), ...player.library] }));
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    const sourceId = game.pendingChoice!.sourceId;
    const actions = legalActions(game, 0).filter((entry) => entry.action.type === "choose-scry");
    expect(actions.map((entry) => entry.action.type === "choose-scry" ? entry.action.ordinal : undefined)).toEqual([0, 0, 1, 1]);
    game = applyAction(game, 0, { type: "choose-scry", sourceId, query: "Grizzly Bears", ordinal: 1, bottom: true });
    game = applyAction(game, 0, { type: "choose-scry", sourceId, query: "Grizzly Bears", ordinal: 0, bottom: false });
    expect(game.players[0]!.library[0]!.instance_id).toBe("scry-duplicates-0");
    expect(game.players[0]!.library.at(-1)!.instance_id).toBe("scry-duplicates-1");
  });

  it("gives the countered spell's OWN controller Treasure tokens, not the caster", () => {
    const profile = profileOf(OFFER_YOU_CANT_REFUSE());
    expect(profile).toMatchObject({
      targetKind: "noncreature-spell",
      effects: [{ kind: "counter-target-spell-then-controller-token", amount: 2, token: { name: "Treasure" } }]
    });
    expect(profile.fullyImplemented).toBe(true);

    let game = readyToCast([OFFER_YOU_CANT_REFUSE()], [ISLAND(), ISLAND()], [BOLT()], [MOUNTAIN()]);
    game = { ...game, players: game.players.map((player) => ({ ...player, autoPass: false })) };
    const life0Before = game.players[0]!.life;
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "cast", cardId: "foe-0", targets: [{ kind: "player", seat: 0 }] });
    const bolt = game.stack.at(-1)!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "spell", stackId: bolt.id }] });
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[1]!.graveyard.some((card) => card.name === "Lightning Bolt")).toBe(true);
    // The spell's own controller (seat 1) gets the tokens, not seat 0, and
    // the countered damage never lands.
    expect(game.players[0]!.life).toBe(life0Before);
    expect(game.players[1]!.battlefield.filter((permanent) => permanent.card.name === "Treasure")).toHaveLength(2);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Treasure")).toBe(false);
  });

  it("lets the targeted spell's own controller pay to avoid a counter-unless-pay effect", () => {
    const profile = profileOf(COUNTER_UNLESS_PAY());
    expect(profile).toMatchObject({ targetKind: "spell", effects: [{ kind: "counter-target-spell-unless-pay", cost: { raw: "{1}" } }] });
    expect(profile.fullyImplemented).toBe(true);

    let game = readyToCast([COUNTER_UNLESS_PAY()], [ISLAND(), ISLAND()], [BOLT()], [MOUNTAIN(), MOUNTAIN()]);
    game = { ...game, players: game.players.map((player) => ({ ...player, autoPass: false })) };
    const life0Before = game.players[0]!.life;
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "cast", cardId: "foe-0", targets: [{ kind: "player", seat: 0 }] });
    const bolt = game.stack.at(-1)!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "spell", stackId: bolt.id }] });
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "pass" });
    expect(game.pendingChoice).toMatchObject({ type: "optional-trigger", seat: 1 });

    const payOption = legalActions(game, 1).find((entry) => entry.action.type === "choose-trigger" && (entry.action as { accept?: boolean }).accept === true);
    expect(payOption).toBeDefined();
    game = applyAction(game, 1, payOption!.action);
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[0]!.life).toBe(life0Before - 3);
  });

  it("counters the targeted spell when its controller declines or can't pay", () => {
    let game = readyToCast([COUNTER_UNLESS_PAY()], [ISLAND(), ISLAND()], [BOLT()], [MOUNTAIN()]);
    game = { ...game, players: game.players.map((player) => ({ ...player, autoPass: false })) };
    const life0Before = game.players[0]!.life;
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "cast", cardId: "foe-0", targets: [{ kind: "player", seat: 0 }] });
    const bolt = game.stack.at(-1)!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "spell", stackId: bolt.id }] });
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "pass" });
    expect(game.pendingChoice).toMatchObject({ type: "optional-trigger", seat: 1 });

    const declineOption = legalActions(game, 1).find((entry) => entry.action.type === "choose-trigger" && (entry.action as { accept?: boolean }).accept === false);
    expect(declineOption).toBeDefined();
    game = applyAction(game, 1, declineOption!.action);
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[0]!.life).toBe(life0Before);
    expect(game.players[1]!.graveyard.some((card) => card.name === "Lightning Bolt")).toBe(true);
  });

  it("lets Daze be cast by returning an Island, still leaving the counter-unless-pay decision to the target's controller", () => {
    const profile = profileOf(DAZE());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.effects).toEqual([{ kind: "counter-target-spell-unless-pay", cost: expect.objectContaining({ raw: "{1}" }) }]);

    let game = readyToCast([DAZE()], [ISLAND(), MOUNTAIN()], [BOLT()], [MOUNTAIN()]);
    game = { ...game, players: game.players.map((player) => ({ ...player, autoPass: false })) };
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "cast", cardId: "foe-0", targets: [{ kind: "player", seat: 0 }] });
    const bolt = game.stack.at(-1)!;
    game = applyAction(game, 1, { type: "pass" });

    // Once a legal target exists: one normal paid cast plus one alt-cost option per controlled Island.
    const options = legalActions(game, 0).filter((entry) => entry.action.type === "cast" && entry.cardId === "hand-0");
    expect(options).toHaveLength(2);
    const returnOption = options.find((entry) => (entry.action as { returnPermanentId?: string }).returnPermanentId);
    expect(returnOption).toBeDefined();

    const island = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Island")!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", returnPermanentId: island.instance_id, targets: [{ kind: "spell", stackId: bolt.id }] });
    expect(game.players[0]!.hand.some((card) => card.name === "Island")).toBe(true);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Island")).toBe(false);
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "pass" });
    expect(game.pendingChoice).toMatchObject({ type: "optional-trigger", seat: 1 });

    const declineOption = legalActions(game, 1).find((entry) => entry.action.type === "choose-trigger" && (entry.action as { accept?: boolean }).accept === false);
    const life0Before = game.players[0]!.life;
    game = applyAction(game, 1, declineOption!.action);
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[0]!.life).toBe(life0Before);
  });

  it("restricts Flusterstorm to instant-or-sorcery spells, unlike the generic 'target spell' template", () => {
    const profile = profileOf(FLUSTERSTORM());
    expect(profile).toMatchObject({
      targetKind: "instant-or-sorcery-spell",
      effects: [{ kind: "counter-target-spell-unless-pay", cost: { raw: "{1}" } }]
    });
    expect(profile.fullyImplemented).toBe(true);

    let game = readyToCast([FLUSTERSTORM()], [ISLAND()], [BOLT(), BEAR()], [MOUNTAIN(), MOUNTAIN(), FOREST(), FOREST()]);
    game = { ...game, players: game.players.map((player) => ({ ...player, autoPass: false })) };

    // Creatures are sorcery-speed, so seat 1 needs their own turn to cast one;
    // seat 0 still gets priority to respond and try (and fail) to Flusterstorm it.
    game = applyAction(game, 0, { type: "pass" });
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 1 && state.prioritySeat === 1);
    game = applyAction(game, 1, { type: "cast", cardId: "foe-1" });
    const bearSpell = game.stack.at(-1)!;
    expect(legalTargets(game, 0, "instant-or-sorcery-spell").some((target) => target.kind === "spell" && target.stackId === bearSpell.id)).toBe(false);
    game = passUntil(game, (state) => state.stack.length === 0);

    game = applyAction(game, 1, { type: "cast", cardId: "foe-0", targets: [{ kind: "player", seat: 0 }] });
    const bolt = game.stack.at(-1)!;
    expect(legalTargets(game, 0, "instant-or-sorcery-spell").some((target) => target.kind === "spell" && target.stackId === bolt.id)).toBe(true);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "spell", stackId: bolt.id }] });
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "pass" });
    expect(game.pendingChoice).toMatchObject({ type: "optional-trigger", seat: 1 });
    const declineFlusterstorm = legalActions(game, 1).find((entry) => entry.action.type === "choose-trigger" && (entry.action as { accept?: boolean }).accept === false);
    const life0Before = game.players[0]!.life;
    game = applyAction(game, 1, declineFlusterstorm!.action);
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[0]!.life).toBe(life0Before);
    expect(game.players[1]!.graveyard.some((card) => card.name === "Lightning Bolt")).toBe(true);
  });

  it("counters the target spell and delays colorless mana equal to its mana value to the caster's next main phase", () => {
    const profile = profileOf(MANA_DRAIN());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.effects).toEqual([
      { kind: "counter-target-spell" },
      { kind: "delayed-mana-equal-to-target-spell-mana-value", manaType: "C" }
    ]);

    let game = readyToCast([MANA_DRAIN()], [ISLAND(), ISLAND()], [BOLT()], [MOUNTAIN()]);
    game = { ...game, players: game.players.map((player) => ({ ...player, autoPass: false })) };
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "cast", cardId: "foe-0", targets: [{ kind: "player", seat: 0 }] });
    const bolt = game.stack.at(-1)!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "spell", stackId: bolt.id }] });
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[1]!.graveyard.some((card) => card.name === "Lightning Bolt")).toBe(true);
    expect(game.players[0]!.manaPool.C).toBe(0);

    game = passUntil(game, (state) => state.players[0]!.manaPool.C > 0);
    expect(game.players[0]!.manaPool.C).toBe(1);
    expect(game.step).toBe("precombat-main");
    expect(game.activeSeat).toBe(0);
  });

  it("lets Long River's Pull widen its target to any spell by promising the gift, drawing the opponent a card first", () => {
    const profile = profileOf(LONG_RIVERS_PULL());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.targetKind).toBe("creature-spell");
    expect(profile.effects).toEqual([{ kind: "counter-target-spell" }]);

    let game = readyToCast([LONG_RIVERS_PULL()], [ISLAND(), ISLAND()], [BOLT()], [MOUNTAIN()]);
    game = { ...game, players: game.players.map((player) => ({ ...player, autoPass: false })) };
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "cast", cardId: "foe-0", targets: [{ kind: "player", seat: 0 }] });
    const bolt = game.stack.at(-1)!;
    game = applyAction(game, 1, { type: "pass" });

    // Lightning Bolt is not a creature spell, so every offered cast must
    // have promised the gift; a plain cast is not a legal option here.
    const options = legalActions(game, 0).filter((entry) => entry.action.type === "cast" && entry.cardId === "hand-0");
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((entry) => (entry.action as { giftPromised?: boolean }).giftPromised)).toBe(true);

    const hand1Before = game.players[1]!.hand.length;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", giftPromised: true, targets: [{ kind: "spell", stackId: bolt.id }] });
    expect(game.players[1]!.hand.length).toBe(hand1Before + 1);
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[1]!.graveyard.some((card) => card.name === "Lightning Bolt")).toBe(true);
  });

  it("does not start Scry when the spell is countered", () => {
    let game = readyToCast([SCRY_TWO()], [ISLAND()], [COUNTER()], [ISLAND(), ISLAND()]);
    game = { ...game, players: game.players.map((player) => ({ ...player, autoPass: false })) };
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    const spell = game.stack.at(-1)!;
    game = applyAction(game, 1, { type: "cast", cardId: "foe-0", targets: [{ kind: "spell", stackId: spell.id }] });
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.pendingChoice).toBeNull();
    expect(game.players[0]!.graveyard.some((card) => card.name === "Scry Two")).toBe(true);
    expect(game.players[0]!.library.some((card) => card.name === "Scry Two")).toBe(false);
  });

  it("clamps Scry N to the cards actually left in the library", () => {
    let game = readyToCast([SCRY_TWO()], [ISLAND()]);
    game = stage(game, 0, (player) => ({ library: toHand(0, [BEAR()], "scry-short") }));
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.pendingChoice).toMatchObject({ type: "scry", remainingCards: [{ name: "Grizzly Bears" }] });
    game = applyAction(game, 0, { type: "choose-scry", sourceId: game.pendingChoice!.sourceId, query: "Grizzly Bears", bottom: true });
    expect(game.pendingChoice).toBeNull();
    expect(game.players[0]!.library.map((card) => card.name)).toEqual(["Grizzly Bears"]);
  });

  it("finishes an empty-library Scry spell without opening a choice", () => {
    let game = readyToCast([SCRY_TWO()], [ISLAND()]);
    game = stage(game, 0, (player) => ({ library: [] }));
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.pendingChoice).toBeNull();
    expect(game.players[0]!.graveyard.some((card) => card.name === "Scry Two")).toBe(true);
  });

  it("returns Blue Sun's Zenith to its owner's library after drawing", () => {
    let game = readyToCast([C13_BLUE_SUN()], [ISLAND(), ISLAND(), ISLAND(), ISLAND()]);
    const beforeHand = game.players[0]!.hand.length;
    game = applyAction(game, 0, {
      type: "cast",
      cardId: "hand-0",
      variableValue: 1,
      targets: [{ kind: "player", seat: 0 }]
    });
    expect(game.pendingChoice).toBeNull();
    expect(game.players[0]!.hand).toHaveLength(beforeHand);
    expect(game.players[0]!.hand.some((card) => card.name === "Blue Sun's Zenith")).toBe(false);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Blue Sun's Zenith")).toBe(false);
    expect(game.players[0]!.library.some((card) => card.name === "Blue Sun's Zenith")).toBe(true);
  });

  it("does not apply Blue Sun's library replacement when the spell is countered", () => {
    let game = readyToCast([C13_BLUE_SUN()], [ISLAND(), ISLAND(), ISLAND(), ISLAND()], [COUNTER()], [ISLAND(), ISLAND()]);
    game = { ...game, players: game.players.map((player) => ({ ...player, autoPass: false })) };
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", variableValue: 1, targets: [{ kind: "player", seat: 0 }] });
    const spell = game.stack.at(-1)!;
    game = applyAction(game, 1, { type: "cast", cardId: "foe-0", targets: [{ kind: "spell", stackId: spell.id }] });
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Blue Sun's Zenith")).toBe(true);
    expect(game.players[0]!.library.some((card) => card.name === "Blue Sun's Zenith")).toBe(false);
  });

  it("lets New Benalia scry its private top card to the bottom", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, (player) => ({
      hand: toHand(0, [C13_NEW_BENALIA()], "new-benalia"),
      library: toHand(0, [BEAR(), ISLAND()], "scry-library")
    }));
    game = putOnBattlefield(game, 0, [FOREST()]);
    game = { ...game, activeSeat: 0, prioritySeat: 0, step: "precombat-main", priorityOpen: true, passedSeats: [] };
    game = applyAction(game, 0, { type: "play-land", cardId: "new-benalia-0" });
    expect(game.pendingChoice).toMatchObject({ type: "scry", seat: 0, remainingCards: [{ name: "Grizzly Bears" }] });
    expect(legalActions(game, 1)).toHaveLength(0);
    expect(legalActions(game, 0).map((entry) => entry.action.type)).toEqual(["choose-scry", "choose-scry"]);
    expect(projectGame(game, 0).scry?.topCards.map((card) => card.name)).toEqual(["Grizzly Bears"]);
    expect(projectGame(game, 1).scry).toBeNull();
    game = applyAction(game, 0, { type: "choose-scry", sourceId: game.pendingChoice!.sourceId, query: "Grizzly Bears", bottom: true });
    expect(game.pendingChoice).toBeNull();
    expect(game.players[0]!.library.map((card) => card.name)).toEqual(["Island", "Grizzly Bears"]);
    expect(game.players[0]!.battlefield.find((permanent) => permanent.card.name === "New Benalia")?.tapped).toBe(true);
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

  it("logs the public target when a stack spell fizzles", () => {
    let game = readyToCast([BOLT()], [MOUNTAIN()], [BOLT()], [MOUNTAIN(), BEAR()]);
    const bearId = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!.instance_id;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: bearId }] });
    game = stage(game, 1, (player) => ({ battlefield: player.battlefield.filter((permanent) => permanent.instance_id !== bearId) }));
    game = applyAction(game, 1, { type: "pass" });
    expect(game.log.at(-1)?.text).toContain("objetivo: Grizzly Bears");
  });

  it("resolves the legal half of a multi-target spell when another target leaves", () => {
    let game = readyToCast([FISSURE_VENT()], [MOUNTAIN(), MOUNTAIN(), MOUNTAIN(), MOUNTAIN()], [], [SOL_RING(), COMMAND_TOWER()]);
    const artifact = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Sol Ring")!;
    const land = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Command Tower")!;
    game = applyAction(game, 0, {
      type: "cast", cardId: "hand-0", mode: 2,
      targets: [{ kind: "permanent", instanceId: artifact.instance_id }, { kind: "permanent", instanceId: land.instance_id }]
    });
    game = stage(game, 1, (player) => ({
      battlefield: player.battlefield.filter((permanent) => permanent.instance_id !== artifact.instance_id)
    }));
    game = { ...game, prioritySeat: 1, priorityOpen: true, passedSeats: [] };
    game = applyAction(game, 1, { type: "pass" });
    expect(game.players[1]!.battlefield.some((permanent) => permanent.instance_id === land.instance_id)).toBe(false);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Fissure Vent")).toBe(true);
    expect(game.log.some((entry) => entry.text.includes("sus objetivos ya no son legales"))).toBe(false);
  });

  it("filters creature and noncreature counterspell targets by the spell on the stack", () => {
    const game = readyToCast([CREATURE_COUNTER(), NONCREATURE_COUNTER()], [ISLAND(), ISLAND()]);
    const creatureCard = { ...BEAR(), instance_id: "stack-creature", owner: 1 };
    const instantCard = { ...BOLT(), instance_id: "stack-instant", owner: 1 };
    const withStack = {
      ...game,
      stack: [
        { id: "creature-stack", controller: 1, card: creatureCard, label: creatureCard.name, targets: [], fromCommandZone: false, variableValue: 0, countered: false },
        { id: "instant-stack", controller: 1, card: instantCard, label: instantCard.name, targets: [], fromCommandZone: false, variableValue: 0, countered: false }
      ]
    };
    expect(profileOf(CREATURE_COUNTER()).targetKind).toBe("creature-spell");
    expect(profileOf(NONCREATURE_COUNTER()).targetKind).toBe("noncreature-spell");
    expect(legalTargets(withStack, 0, "creature-spell")).toEqual([{ kind: "spell", stackId: "creature-stack" }]);
    expect(legalTargets(withStack, 0, "noncreature-spell")).toEqual([{ kind: "spell", stackId: "instant-stack" }]);
  });

  it("refuses an illegal target", () => {
    const game = readyToCast([BOLT()], [MOUNTAIN()]);
    expect(() => applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: "ghost" }] })).toThrow(/Objetivo ilegal/);
  });

  it("reuses the subtype search cluster for Steelshaper's Gift", () => {
    let game = readyToCast([STEELSHAPERS_GIFT()], [PLAINS(), PLAINS()]);
    game = stage(game, 0, (player) => ({ library: [...toHand(0, [EQUIPMENT(), SOL_RING()], "equipment-library"), ...player.library] }));
    expect(profileOf(STEELSHAPERS_GIFT()).effects[0]).toMatchObject({ subtypes: ["Equipment"] });
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect((game.pendingChoice as Extract<GameState["pendingChoice"], { type: "search-library" }>).optionIds)
      .toHaveLength(1);
    game = applyAction(game, 0, { type: "choose-library-card", sourceId: game.pendingChoice!.sourceId, query: "Test Equipment" });
    expect(game.players[0]!.hand.some((card) => card.name === "Test Equipment")).toBe(true);

    game = readyToCast([EXILE_EQUIPMENT()], [PLAINS(), PLAINS()], [], [EQUIPMENT(), SOL_RING()]);
    const equipment = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Test Equipment")!;
    expect(legalTargets(game, 0, "subtype:Equipment")).toContainEqual({ kind: "permanent", instanceId: equipment.instance_id });
    expect(legalTargets(game, 0, "subtype:Equipment")).toHaveLength(1);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: equipment.instance_id }] });
    expect(game.players[1]!.exile.some((card) => card.name === "Test Equipment")).toBe(true);
  });
});

describe("scry and combat-restricted damage", () => {
  function ready(cards: CardData[], battlefield: CardData[], top: CardData[] = [], opponentBoard: CardData[] = []) {
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ hand: toHand(0, cards) }));
    game = stage(game, 1, () => ({ hand: [] }));
    if (top.length) game = stage(game, 0, (player) => ({ library: [...toHand(0, top, "top"), ...player.library].slice(0, player.library.length) }));
    game = putOnBattlefield(game, 0, battlefield);
    if (opponentBoard.length) game = putOnBattlefield(game, 1, opponentBoard);
    return passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
  }

  it("resolves Scry N as a keep/bottom decision per looked-at card and rebuilds the library", () => {
    expect(profileOf(SCRY_SPELL()).effects).toContainEqual({ kind: "scry", amount: 3 });
    expect(profileOf(SCRY_SPELL()).fullyImplemented).toBe(true);

    let game = ready([SCRY_SPELL()], [ISLAND()], [BEAR(), FOREST(), MOUNTAIN()]);
    const topNames = game.players[0]!.library.slice(0, 4).map((card) => card.name);
    expect(topNames.slice(0, 3)).toEqual(["Grizzly Bears", "Forest", "Mountain"]);

    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.pendingChoice?.type).toBe("scry");

    // Keep Grizzly Bears, bottom Forest, keep Mountain.
    const scryId = game.pendingChoice!.sourceId;
    const decide = (toBottom: boolean) => {
      const top = (game.pendingChoice as Extract<GameState["pendingChoice"], { type: "scry" }>).remainingCards[0]!;
      game = applyAction(game, 0, { type: "choose-scry", sourceId: scryId, query: top.name, ordinal: 0, bottom: toBottom });
    };
    decide(false);
    decide(true);
    decide(false);

    expect(game.pendingChoice).toBeNull();
    const library = game.players[0]!.library.map((card) => card.name);
    expect(library.slice(0, 3)).toEqual(["Mountain", "Grizzly Bears", topNames[3]]);
    expect(library[library.length - 1]).toBe("Forest");
    expect(game.players[0]!.graveyard.some((card) => card.name === "Read the Bones Lite")).toBe(true);
  });

  it("chains 'scry N, then draw M' and keeps the rest of the sentence", () => {
    const profile = profileOf(SCRY_DRAW_SPELL());
    expect(profile.effects).toContainEqual({ kind: "scry", amount: 2, thenDraw: 2 });
    expect(profile.effects).toContainEqual({ kind: "lose-life", amount: 2 });
    expect(profile.fullyImplemented).toBe(true);

    let game = ready([SCRY_DRAW_SPELL()], [SWAMP(), SWAMP()], [BEAR(), FOREST()]);
    const handBefore = game.players[0]!.hand.length;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.pendingChoice?.type).toBe("scry");
    const scryId = game.pendingChoice!.sourceId;
    for (let i = 0; i < 2; i += 1) {
      const top = (game.pendingChoice as Extract<GameState["pendingChoice"], { type: "scry" }>).remainingCards[0]!;
      game = applyAction(game, 0, { type: "choose-scry", sourceId: scryId, query: top.name, ordinal: 0, bottom: false });
    }
    expect(game.pendingChoice).toBeNull();
    expect(game.players[0]!.hand.length).toBe(handBefore - 1 + 2);
    expect(game.players[0]!.life).toBe(38);
  });

  it("runs an enters-the-battlefield scry through the trigger bus", () => {
    expect(profileOf(SCRY_ETB_CREATURE()).fullyImplemented).toBe(true);
    let game = ready([SCRY_ETB_CREATURE()], [ISLAND(), ISLAND(), ISLAND()], [BEAR(), FOREST()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = passUntil(game, (state) => state.pendingChoice?.type === "scry" || state.players[0]!.battlefield.some((p) => p.card.name === "Omen Owl") && !state.stack.length);
    expect(game.pendingChoice?.type).toBe("scry");
    const scryId = game.pendingChoice!.sourceId;
    const first = (game.pendingChoice as Extract<GameState["pendingChoice"], { type: "scry" }>).remainingCards[0]!;
    game = applyAction(game, 0, { type: "choose-scry", sourceId: scryId, query: first.name, ordinal: 0, bottom: true });
    const second = (game.pendingChoice as Extract<GameState["pendingChoice"], { type: "scry" }>).remainingCards[0]!;
    game = applyAction(game, 0, { type: "choose-scry", sourceId: scryId, query: second.name, ordinal: 0, bottom: false });
    expect(game.pendingChoice).toBeNull();
    expect(game.players[0]!.library[game.players[0]!.library.length - 1]!.name).toBe("Grizzly Bears");
  });

  it("runs an enters-the-battlefield surveil through the trigger bus, sending declined cards to the graveyard", () => {
    expect(profileOf(SURVEIL_ETB_CREATURE()).fullyImplemented).toBe(true);
    let game = ready([SURVEIL_ETB_CREATURE()], [ISLAND(), ISLAND(), ISLAND()], [BEAR(), FOREST()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = passUntil(game, (state) => state.pendingChoice?.type === "scry" || state.players[0]!.battlefield.some((p) => p.card.name === "Test Sinister Starfish") && !state.stack.length);
    expect(game.pendingChoice).toMatchObject({ type: "scry", destination: "graveyard" });
    const surveilId = game.pendingChoice!.sourceId;
    const first = (game.pendingChoice as Extract<GameState["pendingChoice"], { type: "scry" }>).remainingCards[0]!;
    game = applyAction(game, 0, { type: "choose-scry", sourceId: surveilId, query: first.name, ordinal: 0, bottom: true });
    const second = (game.pendingChoice as Extract<GameState["pendingChoice"], { type: "scry" }>).remainingCards[0]!;
    game = applyAction(game, 0, { type: "choose-scry", sourceId: surveilId, query: second.name, ordinal: 0, bottom: false });
    expect(game.pendingChoice).toBeNull();
    expect(game.players[0]!.library.some((card) => card.name === "Grizzly Bears")).toBe(false);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);
  });

  it("normalises 'it deals' in an ETB trigger so Flametongue Kavu resolves", () => {
    const profile = profileOf(FLAMETONGUE());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.triggers).toContainEqual(expect.objectContaining({
      event: "enters-battlefield", subject: "self", effect: { kind: "damage-any-target", amount: 4 }, targetKind: "creature"
    }));

    let game = ready([FLAMETONGUE()], [MOUNTAIN(), MOUNTAIN(), MOUNTAIN(), MOUNTAIN()], [], [BEAR()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    const foeBear = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    if (game.pendingChoice?.type === "trigger-target") {
      game = applyAction(game, 0, { type: "choose-trigger-target", sourceId: game.pendingChoice.sourceId, target: { kind: "permanent", instanceId: foeBear.instance_id } });
    }
    game = passUntil(game, (state) => !state.players[1]!.battlefield.some((p) => p.card.name === "Grizzly Bears") || state.turn > 1);
    expect(game.players[1]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);
  });

  it("spares artifact creatures from a nonartifact damage sweep", () => {
    expect(profileOf(WHIPFLARE()).effects).toContainEqual({ kind: "damage-all-creatures", amount: 2, excludeSource: false, filter: "nonartifact" });
    expect(profileOf(WHIPFLARE()).fullyImplemented).toBe(true);

    let game = ready([WHIPFLARE()], [MOUNTAIN(), MOUNTAIN()], [], [BEAR(), IRON_BEAR()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = passUntil(game, (state) => state.players[1]!.battlefield.length <= 1 || state.turn > 1);
    expect(game.players[1]!.battlefield.map((permanent) => permanent.card.name)).toEqual(["Iron Bear"]);
  });

  it("only offers an attacking or blocking creature to Combat Sear and deals lethal damage", () => {
    expect(profileOf(COMBAT_SEAR()).targetKind).toBe("attacking-or-blocking-creature");
    expect(profileOf(COMBAT_SEAR()).fullyImplemented).toBe(true);

    let game = ready([COMBAT_SEAR()], [MOUNTAIN(), GIANT()], [], [BEAR()]);
    // Before combat there is nothing to target, so the spell is not castable.
    expect(legalTargets(game, 0, "attacking-or-blocking-creature")).toHaveLength(0);
    expect(legalActions(game, 0).some((entry) => entry.action.type === "cast" && entry.cardId === "hand-0")).toBe(false);

    game = passUntil(game, (state) => state.step === "declare-attackers" && state.activeSeat === 0 && !state.combat.attackersDeclared);
    const giant = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Hill Giant")!;
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: giant.instance_id, defender: 1 }] });

    const options = legalTargets(game, 0, "attacking-or-blocking-creature");
    expect(options).toEqual([{ kind: "permanent", instanceId: giant.instance_id }]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: options });
    game = passUntil(game, (state) => !state.players[0]!.battlefield.some((p) => p.card.name === "Hill Giant") || state.turn > 1);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Hill Giant")).toBe(false);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Hill Giant")).toBe(true);
  });
});

describe("kicker and optional-cost triggers", () => {
  const INTO_THE_ROIL = () => make({ name: "Into the Roil", type_line: "Instant", mana_cost: "{1}{U}", cmc: 2, oracle_text: "Kicker {1}{U} (You may pay an additional {1}{U} as you cast this spell.)\nReturn target nonland permanent to its owner's hand. If this spell was kicked, draw a card." });
  const KICKED_SPLIT = () => make({ name: "Kicked Split", type_line: "Sorcery", mana_cost: "{R}", cmc: 1, colors: ["R"], oracle_text: "Kicker {R}\nEach player loses 1 life.\nIf this spell was kicked, it has split second." });
  const KOR_SANCTIFIERS = () => make({ name: "Kor Sanctifiers", type_line: "Creature — Kor Cleric", mana_cost: "{3}{W}", cmc: 4, power: "2", toughness: "3", oracle_text: "Kicker {W} (You may pay an additional {W} as you cast this spell.)\nWhen Kor Sanctifiers enters the battlefield, if it was kicked, destroy target artifact or enchantment." });
  const JALUM_TOME = () => make({ name: "Jalum Tome", type_line: "Artifact", mana_cost: "{3}", cmc: 3, oracle_text: "{2}, {T}: Draw a card, then discard a card." });
  const PAY_DRAWER = () => make({ name: "Ledger Keeper", type_line: "Creature — Human", mana_cost: "{1}{U}", cmc: 2, power: "1", toughness: "3", oracle_text: "When Ledger Keeper enters the battlefield, you may pay {1}. If you do, draw a card." });

  function ready(cards: CardData[], battlefield: CardData[], opponentBoard: CardData[] = []) {
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ hand: toHand(0, cards) }));
    game = stage(game, 1, () => ({ hand: [] }));
    game = putOnBattlefield(game, 0, battlefield);
    if (opponentBoard.length) game = putOnBattlefield(game, 1, opponentBoard);
    return passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
  }

  it("parses the kicker cost and applies the kicked clause only when paid", () => {
    const profile = profileOf(INTO_THE_ROIL());
    expect(profile.kickerCost?.raw).toBe("{1}{U}");
    expect(profile.effects).toContainEqual({ kind: "return-target-permanent" });
    expect(profile.kickedEffects).toContainEqual({ kind: "draw", amount: 1 });
    expect(profile.fullyImplemented).toBe(true);

    let game = ready([INTO_THE_ROIL()], [ISLAND(), ISLAND(), ISLAND(), ISLAND()], [BEAR()]);
    const bearId = game.players[1]!.battlefield.find((p) => p.card.name === "Grizzly Bears")!.instance_id;
    const kicked = legalActions(game, 0).find((entry) => entry.action.type === "cast" && entry.cardId === "hand-0" && entry.action.kicked);
    expect(kicked).toBeDefined();
    const hb = game.players[0]!.hand.length;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", kicked: true, targets: [{ kind: "permanent", instanceId: bearId }] });
    game = applyAction(game, 0, { type: "pass" });
    expect(game.players[1]!.hand.some((c) => c.name === "Grizzly Bears")).toBe(true);
    expect(game.players[0]!.hand.length).toBe(hb - 1 + 1);
  });

  it("enables Split second only for a kicked spell", () => {
    const profile = profileOf(KICKED_SPLIT());
    expect(profile.kickedKeywords).toEqual(["split second"]);
    expect(profile.fullyImplemented).toBe(true);
    let game = ready([KICKED_SPLIT()], [MOUNTAIN(), MOUNTAIN()]);
    game = stage(game, 1, () => ({ autoPass: false, hand: toHand(1, [BOLT()], "response") }));
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", kicked: true });
    if (game.prioritySeat === 0) game = applyAction(game, 0, { type: "pass" });
    expect(legalActions(game, 1).some((entry) => entry.action.type === "cast")).toBe(false);
    expect(legalActions(game, 1).some((entry) => entry.action.type === "pass")).toBe(true);
  });

  it("fires a kicked-only enters trigger only on the kicked cast", () => {
    expect(profileOf(KOR_SANCTIFIERS()).fullyImplemented).toBe(true);
    let game = ready([KOR_SANCTIFIERS()], [PLAINS(), PLAINS(), PLAINS(), PLAINS()], [IRON_BEAR()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = passUntil(game, (state) => state.players[0]!.battlefield.some((p) => p.card.name === "Kor Sanctifiers") && !state.stack.length && state.pendingChoice === null);
    expect(game.players[1]!.battlefield.some((p) => p.card.name === "Iron Bear")).toBe(true);

    game = ready([KOR_SANCTIFIERS()], [PLAINS(), PLAINS(), PLAINS(), PLAINS(), PLAINS()], [IRON_BEAR()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", kicked: true });
    game = passUntil(game, (state) => !state.players[1]!.battlefield.some((p) => p.card.name === "Iron Bear") || state.turn > 1);
    expect(game.players[1]!.graveyard.some((c) => c.name === "Iron Bear")).toBe(true);
  });

  it("draws then discards for a {cost}: draw, then discard ability", () => {
    const profile = profileOf(JALUM_TOME());
    expect(profile.activatedAbilities[0]!.effect).toEqual({ kind: "draw-then-discard", draw: 1, discard: 1 });
    expect(profile.fullyImplemented).toBe(true);
    let game = ready([], [JALUM_TOME(), ISLAND(), ISLAND()]);
    game = stage(game, 0, (player) => ({ library: [...toHand(0, [BEAR()], "jt"), ...player.library] }));
    const tome = game.players[0]!.battlefield.find((p) => p.card.name === "Jalum Tome")!;
    const hb = game.players[0]!.hand.length;
    game = applyAction(game, 0, { type: "activate", sourceId: tome.instance_id, abilityIndex: 0 });
    game = applyAction(game, 0, { type: "pass" });
    expect(game.pendingChoice?.type).toBe("discard-cards");
    const drew = game.players[0]!.hand.find((c) => c.name === "Grizzly Bears")!;
    game = applyAction(game, 0, { type: "choose-discard", sourceId: game.pendingChoice!.sourceId, cardId: drew.instance_id });
    expect(game.players[0]!.hand.length).toBe(hb);
    expect(game.players[0]!.graveyard.some((c) => c.name === "Grizzly Bears")).toBe(true);
  });

  it("synthesises an Extort cast trigger from the keyword", () => {
    const ghast = () => make({ name: "Extortionist", type_line: "Creature — Human", mana_cost: "{2}{B}", cmc: 3, power: "2", toughness: "3", keywords: ["Extort"], oracle_text: "Extort" });
    const p = profileOf(ghast());
    expect(p.triggers.some((t) => t.event === "spell-cast" && t.effect.kind === "extort" && t.optional && t.payCost?.raw === "{W/B}")).toBe(true);
    expect(p.fullyImplemented).toBe(true);

    let game = ready([ghast(), BOLT()], [SWAMP(), SWAMP(), SWAMP(), SWAMP(), SWAMP(), MOUNTAIN()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = passUntil(game, (state) => state.players[0]!.battlefield.some((x) => x.card.name === "Extortionist") && state.pendingChoice === null && !state.stack.length);
    // Cast Bolt; extort triggers and offers the {W/B} payment.
    game = applyAction(game, 0, { type: "cast", cardId: game.players[0]!.hand.find((c) => c.name === "Lightning Bolt")!.instance_id, targets: [{ kind: "player", seat: 1 }] });
    game = passUntil(game, (state) => state.pendingChoice?.type === "optional-trigger" || state.turn > 1);
    if (game.pendingChoice?.type === "optional-trigger") {
      const before = game.players[1]!.life;
      const accept = legalActions(game, 0).find((e) => e.action.type === "choose-trigger" && e.action.accept)!;
      game = applyAction(game, 0, accept.action);
      game = passUntil(game, (state) => state.players[1]!.life < before || state.turn > 1);
      expect(game.players[1]!.life).toBeLessThan(before);
    }
  });

  it("casts an evoke creature for its alternative cost and sacrifices it on entry", () => {
    const drifter = () => make({ name: "Mulldrifter", type_line: "Creature — Elemental", mana_cost: "{4}{U}", cmc: 5, power: "2", toughness: "2", keywords: ["Flying"], oracle_text: "Flying\nEvoke {2}{U}\nWhen Mulldrifter enters the battlefield, draw two cards." });
    const p = profileOf(drifter());
    expect(p.evokeCost?.raw).toBe("{2}{U}");
    expect(p.triggers.some((t) => t.effect.kind === "sacrifice-source" && t.requiresEvoked)).toBe(true);
    expect(p.fullyImplemented).toBe(true);

    let game = ready([drifter()], [ISLAND(), ISLAND(), ISLAND()]);
    const evoke = legalActions(game, 0).find((entry) => entry.action.type === "cast" && entry.cardId === "hand-0" && entry.action.evoked);
    expect(evoke).toBeDefined();
    const hb = game.players[0]!.hand.length;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", evoked: true });
    game = passUntil(game, (state) => state.turn > 1 || (!state.stack.length && state.pendingChoice === null && !state.players[0]!.battlefield.some((x) => x.card.name === "Mulldrifter") && state.players[0]!.graveyard.some((c) => c.name === "Mulldrifter")));
    expect(game.players[0]!.hand.length).toBe(hb - 1 + 2);
    expect(game.players[0]!.graveyard.some((c) => c.name === "Mulldrifter")).toBe(true);
  });

  it("casts an instant from the graveyard via Flashback and then exiles it", () => {
    const bolt = () => make({ name: "Fire Echo", type_line: "Instant", mana_cost: "{R}", cmc: 1, oracle_text: "Fire Echo deals 2 damage to any target.\nFlashback {3}{R} (You may cast this card from your graveyard for its flashback cost. Then exile it.)" });
    const p = profileOf(bolt());
    expect(p.flashbackCost?.raw).toBe("{3}{R}");
    expect(p.fullyImplemented).toBe(true);

    let game = ready([], [MOUNTAIN(), MOUNTAIN(), MOUNTAIN(), MOUNTAIN()]);
    game = stage(game, 0, () => ({ graveyard: toHand(0, [bolt()], "fb") }));
    const fb = legalActions(game, 0).find((entry) => entry.action.type === "cast" && entry.action.flashback);
    expect(fb).toBeDefined();
    const before = game.players[1]!.life;
    game = applyAction(game, 0, { type: "cast", cardId: "fb-0", flashback: true, targets: [{ kind: "player", seat: 1 }] });
    game = applyAction(game, 0, { type: "pass" });
    expect(game.players[1]!.life).toBe(before - 2);
    expect(game.players[0]!.exile.some((c) => c.name === "Fire Echo")).toBe(true);
    expect(game.players[0]!.graveyard.some((c) => c.name === "Fire Echo")).toBe(false);
  });

  it("parses a graveyard self-return dies trigger and a compound draw/loss spell", () => {
    const spine = () => make({ name: "Spine of Ish Sah", type_line: "Artifact", mana_cost: "{7}", cmc: 7, oracle_text: "When Spine of Ish Sah enters the battlefield, destroy target permanent.\nWhen Spine of Ish Sah is put into a graveyard from the battlefield, return it to its owner's hand." });
    expect(profileOf(spine()).triggers.some((t) => t.event === "dies" && t.effect.kind === "return-source-to-hand")).toBe(true);
    expect(profileOf(spine()).fullyImplemented).toBe(true);

    const scrying = () => make({ name: "Skeletal Scrying", type_line: "Instant", mana_cost: "{X}{B}", cmc: 1, oracle_text: "You draw X cards and you lose X life." });
    expect(profileOf(scrying()).effects.some((e) => e.kind === "compound")).toBe(true);
  });

  it("applies a Medallion-style static cost reduction to matching spells only", () => {
    const medallion = () => make({ name: "Ruby Medallion", type_line: "Artifact", mana_cost: "{2}", cmc: 2, oracle_text: "Red spells you cast cost {1} less to cast." });
    const redSpell = () => make({ name: "Fire Jolt", type_line: "Instant", mana_cost: "{1}{R}", cmc: 2, colors: ["R"], oracle_text: "Fire Jolt deals 2 damage to any target." });
    expect(profileOf(medallion())).toMatchObject({ spellCostReductionGrant: { amount: 1, color: "R" }, fullyImplemented: true });
    // With Ruby Medallion out, {1}{R} costs just {R}: one Mountain pays it.
    let game = ready([redSpell()], [MOUNTAIN(), medallion()]);
    const cast = legalActions(game, 0).find((entry) => entry.action.type === "cast" && entry.cardId === "hand-0");
    expect(cast).toBeDefined();
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 1 }] });
    game = applyAction(game, 0, { type: "pass" });
    expect(game.players[1]!.life).toBe(38);
  });

  it("applies one shared reduction to blue or red spells", () => {
    const familiar = () => make({ name: "Nightscape Familiar", type_line: "Creature — Zombie", mana_cost: "{1}{B}", cmc: 2, power: "1", toughness: "1", oracle_text: "Blue spells and red spells you cast cost {1} less to cast.\n{1}{B}: Regenerate Nightscape Familiar." });
    const blueSpell = () => make({ name: "Blue Insight", type_line: "Instant", mana_cost: "{1}{U}", cmc: 2, colors: ["U"], oracle_text: "Draw a card." });
    const greenSpell = () => make({ name: "Green Insight", type_line: "Instant", mana_cost: "{1}{G}", cmc: 2, colors: ["G"], oracle_text: "Draw a card." });
    expect(profileOf(familiar())).toMatchObject({ spellCostReductionGrant: { amount: 1, colors: ["U", "R"] }, fullyImplemented: true });
    let game = ready([blueSpell()], [ISLAND(), familiar()]);
    expect(legalActions(game, 0).some((entry) => entry.action.type === "cast" && entry.cardId === "hand-0")).toBe(true);
    game = ready([greenSpell()], [FOREST(), familiar()]);
    expect(legalActions(game, 0).some((entry) => entry.action.type === "cast" && entry.cardId === "hand-0")).toBe(false);
  });

  it("applies Arcane Melee's global reduction to an opponent's spell", () => {
    const melee = () => make({ name: "Arcane Melee", type_line: "Enchantment", mana_cost: "{2}{U}{U}", cmc: 4, oracle_text: "Instant and sorcery spells cost {2} less to cast." });
    const instant = () => make({ name: "Cheap Insight", type_line: "Instant", mana_cost: "{1}{U}", cmc: 2, colors: ["U"], oracle_text: "You gain 1 life." });
    expect(profileOf(melee())).toMatchObject({
      spellCostReductionGrant: { amount: 2, types: ["Instant", "Sorcery"], appliesToAllPlayers: true },
      fullyImplemented: true
    });
    // Seat 1 has only one Island; the global {2} reduction makes {1}{U} payable.
    let game = ready([], [melee()], [ISLAND()]);
    game = stage(game, 1, () => ({ hand: toHand(1, [instant()]) }));
    game = { ...game, activeSeat: 1, prioritySeat: 1, step: "precombat-main", priorityOpen: true, passedSeats: [] };
    const cast = legalActions(game, 1).find((entry) => entry.action.type === "cast" && entry.cardId === "hand-0");
    expect(cast).toBeDefined();
  });

  it("applies subtype and multi-color spell cost reductions", () => {
    const warchief = () => make({ name: "Krosan Warchief", type_line: "Creature — Goblin Warrior", mana_cost: "{2}{G}", cmc: 3, power: "2", toughness: "2", oracle_text: "Beast spells you cast cost {1} less to cast." });
    const beast = () => make({ name: "Test Beast", type_line: "Creature — Beast", mana_cost: "{1}{G}", cmc: 2, power: "2", toughness: "2", colors: ["G"] });
    const nonBeast = () => make({ name: "Test Elf", type_line: "Creature — Elf", mana_cost: "{1}{G}", cmc: 2, power: "2", toughness: "2", colors: ["G"] });
    expect(profileOf(warchief())).toMatchObject({ spellCostReductionGrant: { amount: 1, subtype: "Beast" }, fullyImplemented: true });
    let game = ready([beast()], [FOREST(), warchief()]);
    expect(legalActions(game, 0).some((entry) => entry.action.type === "cast" && entry.cardId === "hand-0")).toBe(true);
    game = ready([nonBeast()], [FOREST(), warchief()]);
    expect(legalActions(game, 0).some((entry) => entry.action.type === "cast" && entry.cardId === "hand-0")).toBe(false);

    const familiar = () => make({ name: "Nightscape Familiar", type_line: "Creature — Zombie", mana_cost: "{1}{B}", cmc: 2, power: "1", toughness: "1", oracle_text: "Blue spells and red spells you cast cost {1} less to cast." });
    const blueSpell = () => make({ name: "Test Blue Spell", type_line: "Instant", mana_cost: "{1}{U}", cmc: 2, colors: ["U"], oracle_text: "You gain 1 life." });
    expect(profileOf(familiar())).toMatchObject({ spellCostReductionGrant: { amount: 1, colors: ["U", "R"] }, fullyImplemented: true });
    game = ready([blueSpell()], [ISLAND(), familiar()]);
    expect(legalActions(game, 0).some((entry) => entry.action.type === "cast" && entry.cardId === "hand-0")).toBe(true);
  });

  it("reduces a spell's generic cost by {N} per creature on the battlefield", () => {
    const act = () => make({ name: "Blasphemous Act", type_line: "Sorcery", mana_cost: "{8}{R}", cmc: 9, oracle_text: "This spell costs {1} less to cast for each creature on the battlefield.\nBlasphemous Act deals 13 damage to each creature." });
    expect(profileOf(act()).costReducesPerBoardCreature).toBe(1);
    expect(profileOf(act()).fullyImplemented).toBe(true);
    // Six creatures out: {8}{R} becomes {2}{R}, payable with three Mountains.
    let game = ready([act()], [MOUNTAIN(), MOUNTAIN(), MOUNTAIN(), BEAR(), BEAR(), BEAR()], [BEAR(), BEAR(), BEAR()]);
    const cast = legalActions(game, 0).find((entry) => entry.action.type === "cast" && entry.cardId === "hand-0");
    expect(cast).toBeDefined();
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = applyAction(game, 0, { type: "pass" });
    expect(game.players[0]!.graveyard.some((c) => c.name === "Blasphemous Act")).toBe(true);
  });

  it("recognises plain 'Destroy target permanent' and self-bounce ETB triggers", () => {
    const obelisk = () => make({ name: "Unstable Obelisk", type_line: "Artifact", mana_cost: "{4}", cmc: 4, oracle_text: "{T}: Add {C}.\n{7}, {T}, Sacrifice Unstable Obelisk: Destroy target permanent." });
    const lion = () => make({ name: "Whitemane Lion", type_line: "Creature — Cat", mana_cost: "{1}{W}", cmc: 2, power: "2", toughness: "2", oracle_text: "Flash\nWhen Whitemane Lion enters the battlefield, return a creature you control to its owner's hand." });
    const op = profileOf(obelisk());
    expect(op.activatedAbilities.some((a) => a.effect.kind === "destroy-target-permanent")).toBe(true);
    expect(op.fullyImplemented).toBe(true);
    const lp = profileOf(lion());
    expect(lp.triggers[0]).toMatchObject({ event: "enters-battlefield", effect: { kind: "return-target-creature" }, targetKind: "creature-you-control" });
    expect(lp.fullyImplemented).toBe(true);
  });

  it("gates an optional trigger behind a payable mana cost", () => {
    const profile = profileOf(PAY_DRAWER());
    expect(profile.triggers[0]).toMatchObject({ optional: true, effect: { kind: "draw", amount: 1 } });
    expect(profile.triggers[0]!.payCost?.raw).toBe("{1}");
    expect(profile.fullyImplemented).toBe(true);

    let game = ready([PAY_DRAWER()], [ISLAND(), ISLAND(), ISLAND()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = passUntil(game, (state) => state.pendingChoice?.type === "optional-trigger");
    const accept = legalActions(game, 0).find((entry) => entry.action.type === "choose-trigger" && entry.action.accept);
    expect(accept).toBeDefined();
    const hb = game.players[0]!.hand.length;
    game = applyAction(game, 0, accept!.action);
    game = passUntil(game, (state) => state.players[0]!.hand.length !== hb || state.turn > 1);
    expect(game.players[0]!.hand.length).toBe(hb + 1);

    let broke = ready([PAY_DRAWER()], [ISLAND(), ISLAND()]);
    broke = applyAction(broke, 0, { type: "cast", cardId: "hand-0" });
    broke = passUntil(broke, (state) => state.pendingChoice?.type === "optional-trigger");
    const opts = legalActions(broke, 0).filter((entry) => entry.action.type === "choose-trigger");
    expect(opts.every((entry) => entry.action.type === "choose-trigger" && entry.action.accept === false)).toBe(true);
  });
});

describe("triggered abilities", () => {
  function readyToCast(cards: CardData[], battlefield: CardData[], opponentBoard: CardData[] = []) {
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ hand: toHand(0, cards) }));
    game = stage(game, 1, () => ({ hand: [] }));
    game = putOnBattlefield(game, 0, battlefield);
    if (opponentBoard.length) game = putOnBattlefield(game, 1, opponentBoard);
    return passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
  }

  it("creates Sek'Kuar's Graveborn token when another nontoken creature dies", () => {
    let game = readyToCast([], [SEKKUAR_DEATHKEEPER(), GOBLIN_BOMBARDMENT(), BEAR()]);
    const sacrifice = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    const bombardment = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Goblin Bombardment")!;
    const before = game.players[0]!.battlefield.length;
    expect(profileOf(SEKKUAR_DEATHKEEPER()).triggers[0]).toMatchObject({
      event: "dies", subject: "another-creature-you-control", nontoken: true,
      effect: { kind: "create-token", amount: 1, token: { power: 3, toughness: 1, colors: ["B", "R"], keywords: ["haste"] } }
    });

    game = applyAction(game, 0, { type: "activate", sourceId: bombardment.instance_id, abilityIndex: 0,
      sacrificeId: sacrifice.instance_id, targets: [{ kind: "player", seat: 1 }] });
    game = passUntil(game, (state) => state.players[0]!.battlefield.some((permanent) => permanent.card.name === "Graveborn"));

    expect(game.players[0]!.battlefield).toHaveLength(before);
    expect(game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Graveborn")).toMatchObject({
      card: { type_line: "Creature — Graveborn", power: "3", toughness: "1", colors: ["B", "R"] }
    });
  });

  it("aims Acidic Slime at an artifact, enchantment, or land", () => {
    const profile = profileOf(ACIDIC_SLIME());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.triggers[0]!.targetKind).toBe("artifact-enchantment-or-land");
    let game = readyToCast([ACIDIC_SLIME()], [FOREST(), FOREST(), FOREST(), FOREST(), FOREST()], [SOL_RING()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.pendingChoice).toMatchObject({ type: "trigger-target", targetKind: "artifact-enchantment-or-land" });
    const choice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "trigger-target" }>;
    const ring = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Sol Ring")!;
    expect(choice.options).toContainEqual({ kind: "permanent", instanceId: ring.instance_id });
    game = applyAction(game, 0, { type: "choose-trigger-target", sourceId: choice.sourceId, target: { kind: "permanent", instanceId: ring.instance_id } });
    expect(game.players[1]!.graveyard.some((card) => card.name === "Sol Ring")).toBe(true);
  });

  it("passes Witch Hunt to a deterministic random opponent at end step", () => {
    const hunt = C13_WITCH_HUNT();
    let game = readyToCast([], [hunt]);
    expect(profileOf(hunt)).toMatchObject({
      fullyImplemented: true,
      triggers: [
        { event: "upkeep", effect: { kind: "damage-controller", amount: 4 } },
        { event: "end-step", effect: { kind: "gain-control-of-source-random-opponent" } }
      ]
    });
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Witch Hunt")!;
    game = { ...game, step: "end", activeSeat: 0, prioritySeat: 0, priorityOpen: false, passedSeats: [] };
    game = settle(game);
    game = passUntil(game, (state) => state.players[1]!.battlefield.some((permanent) => permanent.instance_id === source.instance_id));
    expect(game.players[0]!.battlefield.some((permanent) => permanent.instance_id === source.instance_id)).toBe(false);
  });

 it("reads the event and the subject of each recognised trigger line", () => {
    expect(profileOf(DUPLICANT()).triggers[0]).toMatchObject({
      event: "enters-battlefield",
      subject: "self",
      optional: true,
      targetKind: "nontoken-creature",
      effect: { kind: "exile-target-nontoken-creature" }
    });
    expect(profileOf(DUPLICANT()).copiesImprintedCreatureStats).toBe(true);
    expect(profileOf(DUPLICANT()).fullyImplemented).toBe(true);
    expect(profileOf(ETB_DRAWER()).triggers[0]).toMatchObject({ event: "enters-battlefield", subject: "self", targetKind: "none" });
    expect(profileOf(ARTIFACT_ETB_DRAWER()).triggers[0]).toMatchObject({ event: "enters-battlefield", subject: "artifact-you-control", effect: { kind: "draw", amount: 1 } });
    expect(profileOf(ENCHANTMENT_ETB_DRAWER()).triggers[0]).toMatchObject({ event: "enters-battlefield", subject: "enchantment-you-control", effect: { kind: "draw", amount: 1 } });
    expect(profileOf(DEATH_DRAIN()).triggers[0]).toMatchObject({ event: "dies", subject: "self" });
    expect(profileOf(WATCHER()).triggers[0]).toMatchObject({ event: "dies", subject: "another-creature-you-control" });
    expect(profileOf(ANY_ENTER_WARDEN()).triggers[0]).toMatchObject({ event: "enters-battlefield", subject: "another-creature", effect: { kind: "gain-life", amount: 1 } });
    expect(profileOf(ANY_ENTER_WARDEN()).fullyImplemented).toBe(true);
    expect(profileOf(ANY_ENTER_DRAINER()).triggers[0]).toMatchObject({ event: "enters-battlefield", subject: "another-creature", effect: { kind: "lose-life", amount: 1 } });
    expect(profileOf(ANY_ENTER_DRAINER()).fullyImplemented).toBe(true);
    expect(profileOf(DRAIN_ARTIST()).triggers[0]).toMatchObject({
      event: "dies", subject: "any-creature", targetKind: "player",
      effect: { kind: "compound", effects: [{ kind: "lose-life-target-player", amount: 1 }, { kind: "gain-life", amount: 1 }] }
    });
    expect(profileOf(DRAIN_ARTIST()).fullyImplemented).toBe(true);
    expect(profileOf(PARTNER_BARE())).toMatchObject({ triggers: [], effects: [], fullyImplemented: true });
    expect(profileOf(PARTNER_WITH_SEEKER()).triggers[0]).toMatchObject({
      event: "enters-battlefield", subject: "self", optional: true, choiceBy: "target", targetKind: "player",
      effect: { kind: "partner-with-search", cardName: "Bonded Kin" }
    });
    expect(profileOf(PARTNER_WITH_SEEKER()).fullyImplemented).toBe(true);
    expect(profileOf(RAIDER()).triggers[0]).toMatchObject({ event: "attacks", subject: "self", targetKind: "any" });
    expect(profileOf(UPKEEP_SAGE()).triggers[0]).toMatchObject({ event: "upkeep", subject: "you" });
    expect(profileOf(CREATURE_COMBAT_DRAWER()).triggers[0]).toMatchObject({ event: "deals-combat-damage-to-player", subject: "any-creature", effect: { kind: "draw", amount: 1 } });
    expect(profileOf(EDRIC()).triggers[0]).toMatchObject({ event: "deals-combat-damage-to-player", subject: "any-creature", optional: true, effect: { kind: "draw", amount: 1 } });
    expect(profileOf(RHYSTIC_STUDY()).triggers[0]).toMatchObject({
      event: "spell-cast", subject: "opponent", optional: true, manaCost: { raw: "{1}" },
      paymentBy: "opponent", effect: { kind: "draw", amount: 1 }
    });
   expect(profileOf(CREATURE_CAST_DRAWER()).triggers[0]).toMatchObject({ event: "spell-cast", subject: "you", spellType: "creature" });
 });

  it("puts a counter on a deathtouch creature after it damages an opponent", () => {
    const profile = profileOf(VRASKA_SWARMS_EMINENCE());
    expect(profile.triggers[0]).toMatchObject({
      event: "deals-damage-to-player",
      subject: "creature-with-deathtouch-you-control",
      effect: { kind: "add-counter-triggered-creature", counter: "+1/+1", amount: 1 }
    });
    expect(profile.fullyImplemented).toBe(true);
    let game = readyToCast([], [VRASKA_SWARMS_EMINENCE(), DEATHTOUCHER()]);
    game = passUntil(game, (state) => state.step === "declare-attackers" && state.activeSeat === 0 && state.prioritySeat === 0);
    const viper = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Tiny Viper")!;
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: viper.instance_id, defender: 1 }] });
    game = passUntil(game, (state) => state.players[0]!.battlefield.find((permanent) => permanent.instance_id === viper.instance_id)?.counters["+1/+1"] === 1);
    expect(game.players[0]!.battlefield.find((permanent) => permanent.instance_id === viper.instance_id)?.counters["+1/+1"]).toBe(1);
    expect(game.players[1]!.life).toBe(39);
  });

  it("blinks Conjurer's Closet's controlled creature target", () => {
    const profile = profileOf(CONJURERS_CLOSET());
    expect(profile.triggers[0]).toMatchObject({
      event: "end-step", subject: "you", optional: true,
      effect: { kind: "blink-target-creature" }, targetKind: "creature-you-control"
    });
    expect(profile.fullyImplemented).toBe(true);

    let game = readyToCast([], [CONJURERS_CLOSET(), BEAR()]);
    game = passUntil(game, (state) => state.step === "declare-attackers" && state.activeSeat === 0 && state.prioritySeat === 0);
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [] });
    game = passUntil(game, (state) => state.pendingChoice?.type === "optional-trigger");
    const optional = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "optional-trigger" }>;
    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    game = applyAction(game, 0, { type: "choose-trigger", sourceId: optional.sourceId, accept: true });
    expect(game.players[0]!.exile.some((card) => card.instance_id === bear.instance_id)).toBe(false);
    expect(game.players[0]!.battlefield.filter((permanent) => permanent.card.name === "Grizzly Bears")).toHaveLength(1);
    expect(game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!.summoningSick).toBe(true);
  });

  it("returns owned nontoken permanents to their owners with Brooding Saurian", () => {
    const profile = profileOf(BROODING_SAURIAN());
    expect(profile.triggers[0]).toMatchObject({
      event: "end-step", subject: "each-player", optional: false,
      effect: { kind: "return-owned-nontoken-permanents-to-control" }, targetKind: "none"
    });
    expect(profile.fullyImplemented).toBe(true);

    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [BROODING_SAURIAN(), BEAR()]);
    const owned = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    game = stage(game, 0, (player) => ({ battlefield: player.battlefield.filter((permanent) => permanent.instance_id !== owned.instance_id) }));
    game = stage(game, 1, (player) => ({ battlefield: [...player.battlefield, { ...owned, controller: 1 }] }));
    game = passUntil(game, (state) => state.step === "declare-attackers" && state.activeSeat === 0 && state.prioritySeat === 0);
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [] });
    game = passUntil(game, (state) => state.players[0]!.battlefield.some((permanent) => permanent.instance_id === owned.instance_id));
    expect(game.players[0]!.battlefield.find((permanent) => permanent.instance_id === owned.instance_id)!.controller).toBe(0);
    expect(game.players[1]!.battlefield.some((permanent) => permanent.instance_id === owned.instance_id)).toBe(false);
  });

  it("lets Duplicant imprint a nontoken creature on entry", () => {
    let game = readyToCast([DUPLICANT()], [FOREST(), FOREST(), FOREST(), FOREST(), FOREST(), FOREST()], [BEAR()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    const choice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "trigger-target" }>;
    expect(choice.options).toHaveLength(2);
    const target = { kind: "permanent" as const, instanceId: game.players[1]!.battlefield[0]!.instance_id };
   game = applyAction(game, 0, { type: "choose-trigger-target", sourceId: choice.sourceId, target });
    const optional = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "optional-trigger" }>;
    game = applyAction(game, 0, { type: "choose-trigger", sourceId: optional.sourceId, accept: true });
   const duplicant = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Duplicant")!;
    expect(game.players[1]!.exile.some((card) => card.name === "Grizzly Bears")).toBe(true);
    expect(duplicant.exiledWith?.name).toBe("Grizzly Bears");
    expect(powerOf(duplicant, game)).toBe(2);
    expect(toughnessOf(duplicant, game)).toBe(2);
  });

  it("lets Duplicant decline its optional imprint", () => {
    let game = readyToCast([DUPLICANT()], [FOREST(), FOREST(), FOREST(), FOREST(), FOREST(), FOREST()], [BEAR()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    const targetChoice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "trigger-target" }>;
    const target = targetChoice.options.find((option) => option.kind === "permanent")!;
    game = applyAction(game, 0, { type: "choose-trigger-target", sourceId: targetChoice.sourceId, target });
    const optional = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "optional-trigger" }>;
    game = applyAction(game, 0, { type: "choose-trigger", sourceId: optional.sourceId, accept: false });
    expect(game.players[1]!.battlefield.some((permanent) => permanent.card.name === "Grizzly Bears")).toBe(true);
    expect(game.players[1]!.exile).toHaveLength(0);
    expect(game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Duplicant")?.exiledWith).toBeUndefined();
  });

  it("lets Rhystic Study draw when the opponent declines to pay", () => {
    let game = readyToCast([], [RHYSTIC_STUDY()]);
    game = putOnBattlefield(game, 1, [FOREST(), FOREST()]);
    game = stage(game, 1, () => ({ hand: toHand(1, [BEAR()], "rhystic-foe") }));
    game = { ...game, activeSeat: 1, prioritySeat: 1, step: "precombat-main", priorityOpen: true, passedSeats: [] };
    const spell = game.players[1]!.hand[0]!;
    game = applyAction(game, 1, { type: "cast", cardId: spell.instance_id });
    const choice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "optional-trigger" }>;
    expect(choice.seat).toBe(1);
    expect(legalActions(game, 1).some((entry) => entry.action.type === "choose-trigger" && entry.action.accept)).toBe(false);
    game = applyAction(game, 1, { type: "choose-trigger", sourceId: choice.sourceId, accept: false });
    expect(game.players[0]!.hand).toHaveLength(1);
  });

  it("lets the spell's caster pay Rhystic Study's unless cost", () => {
    let game = readyToCast([], [RHYSTIC_STUDY()]);
    game = putOnBattlefield(game, 1, [FOREST(), FOREST(), FOREST()]);
    game = stage(game, 1, () => ({ hand: toHand(1, [BEAR()], "rhystic-payer") }));
    game = { ...game, activeSeat: 1, prioritySeat: 1, step: "precombat-main", priorityOpen: true, passedSeats: [] };
    game = applyAction(game, 1, { type: "cast", cardId: game.players[1]!.hand[0]!.instance_id });
    const choice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "optional-trigger" }>;
    expect(choice.seat).toBe(1);
    expect(legalActions(game, 1).find((entry) => entry.action.type === "choose-trigger" && entry.action.accept)?.label).toBe("Pagar {1} para evitar");
    game = applyAction(game, 1, { type: "choose-trigger", sourceId: choice.sourceId, accept: true });
    expect(game.players[0]!.hand).toHaveLength(0);
    expect(game.players[1]!.battlefield.filter((permanent) => permanent.tapped)).toHaveLength(3);
  });

  it("fires creature-spell triggers only for creature spells", () => {
    let game = readyToCast([BEAR()], [FOREST(), FOREST(), CREATURE_CAST_DRAWER()]);
    game = { ...game, players: game.players.map((player) => ({ ...player, autoPass: false })) };
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.stack.at(-1)?.trigger?.definition.spellType).toBe("creature");
  });

  it("buffs the attacking creature with Gahiji", () => {
    const profile = profileOf(GAHIJI());
    expect(profile.triggers[0]).toMatchObject({
      event: "attacks",
      subject: "creature-attacks-opponent",
      effect: { kind: "modify-triggered-creature", power: 2, toughness: 0 }
    });
    let game = readyToCast([], [GAHIJI(), BEAR()]);
    game = passUntil(game, (state) => state.step === "declare-attackers" && state.activeSeat === 0 && state.prioritySeat === 0);
    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: bear.instance_id, defender: 1 }] });
    game = passUntil(game, (state) => state.triggerQueue.length === 0
      && state.stack.length === 0
      && state.players[0]!.battlefield.find((permanent) => permanent.instance_id === bear.instance_id)?.powerModifier === 2);
    expect(game.players[0]!.battlefield.find((permanent) => permanent.instance_id === bear.instance_id)?.powerModifier).toBe(2);
  });

  it("scales Terra Ravager's attack trigger from the defending player's lands", () => {
    expect(profileOf(TERRA_RAVAGER())).toMatchObject({
      triggers: [{ event: "attacks", subject: "self", effect: { kind: "pump-source-by-defending-lands" } }],
      fullyImplemented: true
    });
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [TERRA_RAVAGER()]);
    game = putOnBattlefield(game, 1, [BEAR(), FOREST(), SWAMP()]);
    game = passUntil(game, (state) => state.step === "declare-attackers" && state.activeSeat === 0);
    const ravager = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Terra Ravager")!;
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: ravager.instance_id, defender: 1 }] });
    game = passUntil(game, (state) => state.triggerQueue.length === 0 && state.stack.length === 0);
    expect(game.players[0]!.battlefield.find((permanent) => permanent.instance_id === ravager.instance_id)?.powerModifier).toBe(2);
  });

  it("makes an attack illegal without paying Propaganda's {2}-per-creature tax", () => {
    const profile = profileOf(PROPAGANDA());
    expect(profile.fullyImplemented).toBe(true);

    // Only one Mountain: not enough to pay the {2} tax, so the attack is illegal
    // and legalActions must not offer it (a bot could otherwise crash on it).
    let game = readyToCast([], [BEAR(), MOUNTAIN()], [PROPAGANDA()]);
    game = passUntil(game, (state) => state.step === "declare-attackers" && state.activeSeat === 0 && state.prioritySeat === 0);
    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    expect(legalActions(game, 0).some((entry) => entry.action.type === "declare-attackers" && entry.action.attackers.length > 0)).toBe(false);
    expect(() => applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: bear.instance_id, defender: 1 }] })).toThrow();

    // With enough mana, the tax is paid automatically and the attack proceeds.
    game = readyToCast([], [BEAR(), MOUNTAIN(), MOUNTAIN()], [PROPAGANDA()]);
    game = passUntil(game, (state) => state.step === "declare-attackers" && state.activeSeat === 0 && state.prioritySeat === 0);
    const bear2 = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: bear2.instance_id, defender: 1 }] });
    expect(game.combat.attackersDeclared).toBe(true);
    expect(game.players[0]!.manaPool.R).toBe(0);
    expect(game.players[0]!.battlefield.filter((permanent) => permanent.card.name === "Mountain" && permanent.tapped)).toHaveLength(2);
  });

  it("charges Propaganda taxes independently for each attacked defender", () => {
    let game = threeSeatGame();
    game = stage(game, 0, () => ({ autoPass: false, hand: toHand(0, [BEAR(), MOUNTAIN(), MOUNTAIN(), MOUNTAIN(), MOUNTAIN()], "multi-tax") }));
    game = putOnBattlefield(game, 0, [BEAR(), BEAR(), MOUNTAIN(), MOUNTAIN(), MOUNTAIN(), MOUNTAIN()]);
    game = putOnBattlefield(game, 1, [PROPAGANDA()]);
    game = putOnBattlefield(game, 2, [PROPAGANDA()]);
    game = passUntil(game, (state) => state.step === "declare-attackers" && state.activeSeat === 0 && state.prioritySeat === 0);
    const bears = game.players[0]!.battlefield.filter((permanent) => permanent.card.name === "Grizzly Bears");
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [
      { instanceId: bears[0]!.instance_id, defender: 1 },
      { instanceId: bears[1]!.instance_id, defender: 2 }
    ] });
    expect(game.combat.attackers).toHaveLength(2);
    expect(game.players[0]!.battlefield.filter((permanent) => permanent.card.name === "Mountain" && permanent.tapped)).toHaveLength(4);
    expect(game.log.filter((entry) => entry.text.includes("impuesto de ataque"))).toHaveLength(2);
  });

  it("deals damage and amasses Orcs when Orcish Bowmasters enters", () => {
    const profile = profileOf(ORCISH_BOWMASTERS());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.triggers).toHaveLength(2);
    expect(profile.triggers[0]).toMatchObject({ event: "enters-battlefield", subject: "self" });
    expect(profile.triggers[1]).toMatchObject({ event: "card-drawn", subject: "opponent", condition: { kind: "not-first-draw-step-draw" } });

    let game = readyToCast([ORCISH_BOWMASTERS()], [SWAMP(), SWAMP()], [BEAR()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    const foeBear = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    if (game.pendingChoice?.type === "trigger-target") {
      game = applyAction(game, 0, { type: "choose-trigger-target", sourceId: game.pendingChoice.sourceId, target: { kind: "permanent", instanceId: foeBear.instance_id } });
    }
    game = passUntil(game, (state) => state.triggerQueue.length === 0 && state.stack.length === 0);
    expect(game.players[1]!.battlefield.find((permanent) => permanent.instance_id === foeBear.instance_id)?.damage).toBe(1);
    const army = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Army");
    expect(army).toBeDefined();
    expect(army!.counters["+1/+1"]).toBe(1);
  });

  it("lets Mjölnir's ETB trigger optionally hit up to one target creature", () => {
    const profile = profileOf(MJOLNIR());
    expect(profile.triggers[0]).toMatchObject({
      event: "enters-battlefield", effect: { kind: "damage-any-target", amount: 4 }, targetKinds: ["creature"], minimumTargets: 0
    });
    expect(profile.fullyImplemented).toBe(true);

    let hit = readyToCast([MJOLNIR()], [MOUNTAIN(), MOUNTAIN(), MOUNTAIN(), MOUNTAIN()], [TRAMPLER()]);
    hit = applyAction(hit, 0, { type: "cast", cardId: "hand-0" });
    const foeTrampler = hit.players[1]!.battlefield.find((permanent) => permanent.card.name === "Big Stomper")!;
    expect(hit.pendingChoice?.type).toBe("trigger-target");
    if (hit.pendingChoice?.type === "trigger-target") {
      hit = applyAction(hit, 0, { type: "choose-trigger-target", sourceId: hit.pendingChoice.sourceId, target: { kind: "permanent", instanceId: foeTrampler.instance_id } });
    }
    hit = passUntil(hit, (state) => state.triggerQueue.length === 0 && state.stack.length === 0);
    // 6/6 survives 4 damage, so the marked damage itself is checkable (unlike a lethal hit, which would remove the permanent via state-based actions).
    expect(hit.players[1]!.battlefield.find((permanent) => permanent.instance_id === foeTrampler.instance_id)?.damage).toBe(4);

    // "up to one" means declining is legal too: `finish-trigger-targets` satisfies minimumTargets: 0.
    let skip = readyToCast([MJOLNIR()], [MOUNTAIN(), MOUNTAIN(), MOUNTAIN(), MOUNTAIN()], [BEAR()]);
    skip = applyAction(skip, 0, { type: "cast", cardId: "hand-0" });
    expect(skip.pendingChoice?.type).toBe("trigger-target");
    if (skip.pendingChoice?.type === "trigger-target") {
      skip = applyAction(skip, 0, { type: "finish-trigger-targets", sourceId: skip.pendingChoice.sourceId });
    }
    skip = passUntil(skip, (state) => state.triggerQueue.length === 0 && state.stack.length === 0);
    expect(skip.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")?.damage).toBe(0);
  });

  it("triggers Orcish Bowmasters again on an opponent's draw outside their draw step, growing the same Army", () => {
    let game = readyToCast([DRAW_TWO_TARGET()], [ORCISH_BOWMASTERS(), ISLAND(), ISLAND(), ISLAND()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 1 }] });
    for (let i = 0; i < 2 && game.pendingChoice?.type === "trigger-target"; i += 1) {
      const options = legalActions(game, 0).filter((entry) => entry.action.type === "choose-trigger-target");
      game = applyAction(game, 0, options[0]!.action);
    }
    game = passUntil(game, (state) => state.pendingChoice?.type !== "trigger-target" && state.triggerQueue.length === 0 && state.stack.length === 0);
    expect(game.players[1]!.hand).toHaveLength(2);
    const army = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Army");
    expect(army).toBeDefined();
    expect(army!.counters["+1/+1"]).toBe(2);
  });

  it("divides Inferno Titan's trigger damage across one to three targets", () => {
    expect(profileOf(INFERNO_TITAN())).toMatchObject({
      triggers: [
        { event: "enters-battlefield", targetKinds: ["any", "any", "any"], minimumTargets: 1, effect: { kind: "damage-divided-targets", amount: 3 } },
        { event: "attacks", targetKinds: ["any", "any", "any"], minimumTargets: 1, effect: { kind: "damage-divided-targets", amount: 3 } }
      ],
      fullyImplemented: true
    });
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [INFERNO_TITAN()]);
    game = putOnBattlefield(game, 1, [BEAR()]);
    game = passUntil(game, (state) => state.step === "declare-attackers" && state.activeSeat === 0);
    const titan = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Inferno Titan")!;
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: titan.instance_id, defender: 1 }] });
    expect(game.pendingChoice?.type).toBe("trigger-target");
    const sourceId = game.pendingChoice?.type === "trigger-target" ? game.pendingChoice.sourceId : "";
    game = applyAction(game, 0, { type: "choose-trigger-target", sourceId, target: { kind: "player", seat: 1 } });
    game = applyAction(game, 0, { type: "finish-trigger-targets", sourceId });
    game = passUntil(game, (state) => state.triggerQueue.length === 0 && state.stack.length === 0);
    expect(game.players[1]!.life).toBe(37);
  });

  it("keeps multi-target trigger slots distinct and rejects a duplicate target", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [INFERNO_TITAN()]);
    game = putOnBattlefield(game, 1, [BEAR()]);
    game = passUntil(game, (state) => state.step === "declare-attackers" && state.activeSeat === 0);
    const titan = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Inferno Titan")!;
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: titan.instance_id, defender: 1 }] });
    const pending = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "trigger-target" }>;
    const sourceId = pending.sourceId;
    const target = { kind: "player", seat: 1 } as const;
    game = applyAction(game, 0, { type: "choose-trigger-target", sourceId, target });
    expect(() => applyAction(game, 0, { type: "choose-trigger-target", sourceId, target })).toThrow("Objetivo ilegal");
  });

  it("triggers Guttersnipe only from instant and sorcery casts", () => {
    const profile = profileOf(GUTTERSNIPE());
    expect(profile.triggers[0]).toMatchObject({
      event: "spell-cast",
      subject: "you",
      spellType: "instant-or-sorcery",
      effect: { kind: "damage-each-opponent", amount: 2 }
    });
    let game = readyToCast([BOLT()], [GUTTERSNIPE(), MOUNTAIN()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 1 }] });
    game = passUntil(game, (state) => state.stack.length === 0 && state.triggerQueue.length === 0 && state.players[1]!.life === 35);
    expect(game.players[1]!.life).toBe(35);
  });

  it("lets the controller of a dead creature choose Fecundity's draw", () => {
    const profile = profileOf(FECUNDITY());
    expect(profile.triggers[0]).toMatchObject({
      event: "dies",
      subject: "any-creature",
      choiceBy: "event-controller",
      optional: true,
      effect: { kind: "draw", amount: 1 }
    });
    let game = readyToCast([BOLT()], [FECUNDITY(), MOUNTAIN()], [BEAR()]);
    game = applyAction(game, 0, {
      type: "cast",
      cardId: "hand-0",
      targets: [{ kind: "permanent", instanceId: game.players[1]!.battlefield[0]!.instance_id }]
    });
    game = passUntil(game, (state) => state.pendingChoice?.type === "optional-trigger");
    const choice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "optional-trigger" }>;
    expect(choice.seat).toBe(1);
    const before = game.players[1]!.hand.length;
    game = applyAction(game, 1, { type: "choose-trigger", sourceId: choice.sourceId, accept: true });
    expect(game.players[1]!.hand).toHaveLength(before + 1);
  });

  it("yields optional triggers from a marked source without suppressing the trigger system", () => {
    let game = readyToCast([BOLT()], [FECUNDITY(), MOUNTAIN(), BEAR()]);
    const fecundity = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Fecundity")!;
    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    game = applyAction(game, 0, { type: "toggle-trigger-yield", sourceId: fecundity.instance_id, abilityIndex: 0, enabled: true });
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: bear.instance_id }] });
    game = passUntil(game, (state) => state.stack.length === 0 && state.triggerQueue.length === 0 && state.pendingChoice === null);
    expect(game.players[0]!.yieldedTriggerSources).toContain(`${fecundity.instance_id}:0`);
    expect(game.log.some((entry) => entry.text.includes("no realiza la habilidad opcional de Fecundity"))).toBe(true);
  });

  it("never yields a mandatory trigger from a source marked for optional yields", () => {
    const sourceCard = make({
      name: "Mandatory Trigger Source", type_line: "Creature — Human", mana_cost: "{1}{G}", cmc: 2,
      power: "2", toughness: "2", oracle_text: "Whenever you gain life, draw a card."
    });
    let game = readyToCast([LIFE_SPELL()], [sourceCard, FOREST(), FOREST()]);
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === sourceCard.name)!;
    game = applyAction(game, 0, { type: "toggle-trigger-yield", sourceId: source.instance_id, enabled: true });
    game = applyAction(game, 0, { type: "cast", cardId: game.players[0]!.hand[0]!.instance_id });
    game = passUntil(game, (state) => state.pendingChoice === null && state.stack.length === 0 && state.triggerQueue.length === 0);
    expect(game.players[0]!.hand.length).toBeGreaterThan(0);
    expect(game.players[0]!.yieldedTriggerSources).toContain(source.instance_id);
  });

  it("yields one optional trigger of a multi-trigger card and keeps the other live", () => {
    const twoTrigger = make({
      name: "Twin Beacon", type_line: "Enchantment", mana_cost: "{2}{U}", cmc: 3,
      oracle_text: "Whenever you draw a card, you may gain 1 life.\nWhenever you gain life, you may draw a card."
    });
    let game = readyToCast([], [twoTrigger]);
    game = stage(game, 0, () => ({ autoPass: false }));
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Twin Beacon")!;
    const toggles = legalActions(game, 0).filter((entry) => entry.action.type === "toggle-trigger-yield" && entry.action.sourceId === source.instance_id);
    expect(toggles).toHaveLength(2);
    expect(toggles.every((entry) => entry.action.type === "toggle-trigger-yield" && entry.action.abilityIndex !== undefined)).toBe(true);
    // Each toggle names the specific ability it silences.
    expect(new Set(toggles.map((entry) => entry.label)).size).toBe(2);

    const drawYield = toggles.find((entry) => entry.label.includes("draw a card") || entry.label.includes("gain 1 life"))!;
    game = applyAction(game, 0, drawYield.action);
    expect(game.players[0]!.yieldedTriggerSources).toHaveLength(1);
    expect(game.players[0]!.yieldedTriggerSources![0]).toMatch(new RegExp(`^${source.instance_id}:[01]$`));
  });

  it("sacrifices a Ball Lightning-style creature at the end step", () => {
    const ballLightning = make({
      name: "Test Ball Lightning", type_line: "Creature — Elemental", mana_cost: "{R}{R}{R}", cmc: 3, power: "6", toughness: "1",
      oracle_text: "Trample, haste\nAt the beginning of the end step, sacrifice this creature."
    });
    expect(profileOf(ballLightning).triggers[0]).toMatchObject({ event: "end-step", effect: { kind: "sacrifice-source" } });
    let game = readyToCast([], [ballLightning]);
    game = stage(game, 0, () => ({ autoPass: false }));
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Test Ball Lightning")).toBe(true);
    game = passUntil(game, (state) => state.turn === 2 && state.step === "precombat-main");
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Test Ball Lightning")).toBe(false);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Test Ball Lightning")).toBe(true);
  });

  it("deals damage to a creature and gains life on the same spell (Firebolt-style)", () => {
    const firebolt = make({
      name: "Test Firebolt", type_line: "Instant", mana_cost: "{R}", cmc: 1,
      oracle_text: "This spell deals 3 damage to target creature and you gain 3 life."
    });
    expect(profileOf(firebolt)).toMatchObject({ fullyImplemented: true, targetKind: "creature" });
    let game = readyToCast([firebolt], [MOUNTAIN()], [make({ name: "Chump", type_line: "Creature — Goblin", mana_cost: "{R}", power: "2", toughness: "3" })]);
    game = stage(game, 0, () => ({ autoPass: false }));
    const foe = game.players[1]!.battlefield[0]!;
    const lifeBefore = game.players[0]!.life;
    game = applyAction(game, 0, { type: "cast", cardId: game.players[0]!.hand[0]!.instance_id, targets: [{ kind: "permanent", instanceId: foe.instance_id }] });
    game = passUntil(game, (state) => state.stack.length === 0 && state.pendingChoice === null);
    expect(game.players[0]!.life).toBe(lifeBefore + 3);
    expect(game.players[1]!.battlefield.some((permanent) => permanent.instance_id === foe.instance_id)).toBe(false);
  });

  it("applies a Threshold static +X/+Y once seven cards are in the graveyard", () => {
    const mongoose = make({
      name: "Test Mongoose", type_line: "Creature — Mongoose", mana_cost: "{G}", cmc: 1, power: "1", toughness: "1",
      oracle_text: "Threshold — This creature gets +2/+2 as long as there are seven or more cards in your graveyard."
    });
    expect(profileOf(mongoose).staticPowerToughnessGrants[0]).toMatchObject({ scope: "source-controller-graveyard-threshold", power: 2, toughness: 2, threshold: 7 });
    let game = readyToCast([], [FOREST()]);
    game = putOnBattlefield(game, 0, [mongoose]);
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Test Mongoose")!;
    expect(powerOf(source, game)).toBe(1);

    game = stage(game, 0, (player) => ({ graveyard: [...Array(6)].map((_, i) => ({ ...BOLT(), instance_id: `gy-${i}`, owner: 0 } as GameCard)) }));
    expect(powerOf(game.players[0]!.battlefield.find((p) => p.instance_id === source.instance_id)!, game)).toBe(1);
    game = stage(game, 0, (player) => ({ graveyard: [...player.graveyard, { ...BOLT(), instance_id: "gy-6", owner: 0 } as GameCard] }));
    expect(powerOf(game.players[0]!.battlefield.find((p) => p.instance_id === source.instance_id)!, game)).toBe(3);
    expect(toughnessOf(game.players[0]!.battlefield.find((p) => p.instance_id === source.instance_id)!, game)).toBe(3);
  });

  it("triggers 'whenever you cast a noncreature spell' on the source", () => {
    const docent = make({
      name: "Test Spellweaver", type_line: "Creature — Merfolk Wizard", mana_cost: "{1}{U}", cmc: 2, power: "1", toughness: "2",
      oracle_text: "Whenever you cast a noncreature spell, put a +1/+1 counter on this creature."
    });
    expect(profileOf(docent).triggers[0]).toMatchObject({ event: "spell-cast", effect: { kind: "add-counter-source", counter: "+1/+1", amount: 1 } });
    let game = readyToCast([BOLT(), BEAR()], [MOUNTAIN(), FOREST(), MOUNTAIN()]);
    game = putOnBattlefield(game, 0, [docent]);
    game = stage(game, 0, () => ({ autoPass: false }));
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Test Spellweaver")!;
    expect(source.counters["+1/+1"] ?? 0).toBe(0);

    // Casting an instant (noncreature) adds a counter.
    game = applyAction(game, 0, { type: "cast", cardId: game.players[0]!.hand.find((card) => card.name === "Lightning Bolt")!.instance_id, targets: [{ kind: "player", seat: 1 }] });
    game = passUntil(game, (state) => state.stack.length === 0 && state.triggerQueue.length === 0 && state.pendingChoice === null);
    expect(game.players[0]!.battlefield.find((p) => p.instance_id === source.instance_id)?.counters["+1/+1"]).toBe(1);

    // Casting a creature does not.
    game = applyAction(game, 0, { type: "cast", cardId: game.players[0]!.hand.find((card) => card.name === "Grizzly Bears")!.instance_id });
    game = passUntil(game, (state) => state.stack.length === 0 && state.triggerQueue.length === 0 && state.pendingChoice === null);
    expect(game.players[0]!.battlefield.find((p) => p.instance_id === source.instance_id)?.counters["+1/+1"]).toBe(1);
  });

  it("pays 'discard a card' / 'sacrifice an artifact' additional cast costs", () => {
    const looter = make({
      name: "Test Loot Spell", type_line: "Sorcery", mana_cost: "{1}{U}", cmc: 2,
      oracle_text: "As an additional cost to cast this spell, discard a card.\nDraw two cards."
    });
    expect(profileOf(looter)).toMatchObject({ fullyImplemented: true, additionalCostDiscardCard: true });
    let game = readyToCast([looter, BEAR(), BOLT()], [ISLAND(), ISLAND()]);
    game = stage(game, 0, (player) => ({ autoPass: false, library: toHand(0, [FLIER(), FOREST(), SOL_RING()], "lib") }));
    const bear = game.players[0]!.hand.find((card) => card.name === "Grizzly Bears")!;
    game = applyAction(game, 0, { type: "cast", cardId: game.players[0]!.hand.find((card) => card.name === "Test Loot Spell")!.instance_id, discardCardId: bear.instance_id });
    game = passUntil(game, (state) => state.stack.length === 0 && state.pendingChoice === null);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);
    // Discarded one, drew two → net +1 from a two-card hand minus the spell.
    expect(game.players[0]!.hand.filter((card) => ["Storm Crow", "Forest"].includes(card.name)).length).toBe(2);

    const shatter = make({
      name: "Test Shatter Spree", type_line: "Instant", mana_cost: "{R}", cmc: 1,
      oracle_text: "As an additional cost to cast this spell, sacrifice an artifact.\nDestroy target artifact."
    });
    let g2 = readyToCast([shatter], [MOUNTAIN()]);
    // No artifact to sacrifice → illegal.
    expect(legalActions(g2, 0).some((entry) => entry.action.type === "cast" && entry.cardId === g2.players[0]!.hand[0]!.instance_id)).toBe(false);
    g2 = putOnBattlefield(g2, 0, [SOL_RING()]);
    expect(legalActions(g2, 0).some((entry) => entry.action.type === "cast" && entry.cardId === g2.players[0]!.hand[0]!.instance_id)).toBe(true);
  });

  it("taps the enchanted creature and keeps it tapped (Claustrophobia)", () => {
    const claustro = make({
      name: "Test Claustrophobia", type_line: "Enchantment — Aura", mana_cost: "{2}{U}", cmc: 3,
      oracle_text: "Enchant creature\nWhen this Aura enters, tap enchanted creature.\nEnchanted creature doesn't untap during its controller's untap step."
    });
    expect(profileOf(claustro)).toMatchObject({ fullyImplemented: true, triggers: [{ effect: { kind: "tap-enchanted-creature" } }], auraModification: { cannotUntap: true } });
    let game = createGame([deck("A", COMMANDER("A"), []), deck("B", COMMANDER("B"), [])], { seed: 7, allowPartialDecks: true });
    game = stage(game, 0, () => ({ kind: "human", autoPass: false, hand: toHand(0, [claustro], "cast") }));
    game = putOnBattlefield(game, 1, [BEAR()]);
    game = putOnBattlefield(game, 0, [ISLAND(), ISLAND(), ISLAND()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const bear = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;

    game = applyAction(game, 0, { type: "cast", cardId: "cast-0", targets: [{ kind: "permanent", instanceId: bear.instance_id }] });
    game = passUntil(game, (state) => state.stack.length === 0 && state.triggerQueue.length === 0 && state.pendingChoice === null);
    expect(game.players[1]!.battlefield.find((p) => p.instance_id === bear.instance_id)?.tapped).toBe(true);

    // It stays tapped through seat 1's untap step.
    game = passUntil(game, (state) => state.activeSeat === 1 && state.step === "precombat-main");
    expect(game.players[1]!.battlefield.find((p) => p.instance_id === bear.instance_id)?.tapped).toBe(true);
  });

  it("pumps the enchanted creature from a Firebreathing aura's activated ability", () => {
    const firebreathing = make({
      name: "Test Firebreathing", type_line: "Enchantment — Aura", mana_cost: "{R}", cmc: 1,
      oracle_text: "Enchant creature\n{R}: Enchanted creature gets +1/+0 until end of turn."
    });
    expect(profileOf(firebreathing)).toMatchObject({ fullyImplemented: true, auraActivatedAbility: { effect: { kind: "modify-source-creature", power: 1, toughness: 0 } } });
    let game = readyToCast([firebreathing], [MOUNTAIN(), MOUNTAIN(), MOUNTAIN()]);
    game = stage(game, 0, () => ({ autoPass: false }));
    game = putOnBattlefield(game, 0, [BEAR()]);
    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;

    game = applyAction(game, 0, { type: "cast", cardId: game.players[0]!.hand[0]!.instance_id, targets: [{ kind: "permanent", instanceId: bear.instance_id }] });
    game = passUntil(game, (state) => state.stack.length === 0 && state.pendingChoice === null);
    expect(powerOf(game.players[0]!.battlefield.find((p) => p.instance_id === bear.instance_id)!, game)).toBe(2);

    // The enchanted creature now has the {R}: +1/+0 activation.
    const mountain = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Mountain" && !permanent.tapped)!;
    game = applyAction(game, 0, { type: "activate-mana", sourceId: mountain.instance_id, abilityIndex: 0, mana: "R" });
    const pump = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.action.sourceId === bear.instance_id);
    expect(pump).toBeDefined();
    game = applyAction(game, 0, pump!.action);
    game = passUntil(game, (state) => state.stack.length === 0 && state.pendingChoice === null);
    expect(powerOf(game.players[0]!.battlefield.find((p) => p.instance_id === bear.instance_id)!, game)).toBe(3);

    // Cleared at cleanup.
    game = passUntil(game, (state) => state.turn === 3);
    expect(powerOf(game.players[0]!.battlefield.find((p) => p.instance_id === bear.instance_id)!, game)).toBe(2);
  });

  it("investigates into a working Clue token", () => {
    const inspector = make({
      name: "Test Inspector", type_line: "Creature — Human Soldier", mana_cost: "{W}", cmc: 1, power: "1", toughness: "2",
      oracle_text: "When this creature enters, investigate."
    });
    expect(profileOf(inspector).triggers[0]).toMatchObject({ effect: { kind: "create-token", amount: 1, token: { name: "Clue" } } });
    let game = readyToCast([inspector], [PLAINS(), PLAINS(), PLAINS()]);
    game = stage(game, 0, (player) => ({ autoPass: false, library: toHand(0, [BEAR(), BOLT()], "lib") }));
    game = applyAction(game, 0, { type: "cast", cardId: game.players[0]!.hand[0]!.instance_id });
    game = passUntil(game, (state) => state.stack.length === 0 && state.triggerQueue.length === 0 && state.pendingChoice === null);

    const clue = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Clue");
    expect(clue).toBeDefined();
    const activate = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.action.sourceId === clue!.instance_id);
    expect(activate).toBeDefined();
    const handBefore = game.players[0]!.hand.length;
    game = applyAction(game, 0, activate!.action);
    game = passUntil(game, (state) => state.stack.length === 0 && state.pendingChoice === null && state.triggerQueue.length === 0);
    expect(game.players[0]!.hand.length).toBe(handBefore + 1);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Clue")).toBe(false);
  });

  it("gives a kicked creature its 'enters with +1/+1 counters' only when kicked", () => {
    const boa = make({
      name: "Test Kicker Boa", type_line: "Creature — Snake", mana_cost: "{1}{G}", cmc: 2, power: "1", toughness: "1",
      oracle_text: "Kicker {2}\nIf this creature was kicked, it enters with two +1/+1 counters on it."
    });
    expect(profileOf(boa)).toMatchObject({ fullyImplemented: true, kickedEntersWithCounters: [{ kind: "+1/+1", amount: 2 }] });

    // Unkicked: no counters.
    let plain = readyToCast([boa], [FOREST(), FOREST()]);
    plain = applyAction(plain, 0, { type: "cast", cardId: plain.players[0]!.hand[0]!.instance_id });
    plain = passUntil(plain, (state) => state.stack.length === 0 && state.pendingChoice === null);
    expect(plain.players[0]!.battlefield.find((permanent) => permanent.card.name === "Test Kicker Boa")?.counters["+1/+1"] ?? 0).toBe(0);

    // Kicked: two +1/+1 counters.
    let kicked = readyToCast([boa], [FOREST(), FOREST(), FOREST(), FOREST()]);
    const cast = legalActions(kicked, 0).find((entry) => entry.action.type === "cast" && entry.action.kicked === true);
    expect(cast).toBeDefined();
    kicked = applyAction(kicked, 0, cast!.action);
    kicked = passUntil(kicked, (state) => state.stack.length === 0 && state.pendingChoice === null);
    expect(kicked.players[0]!.battlefield.find((permanent) => permanent.card.name === "Test Kicker Boa")?.counters["+1/+1"]).toBe(2);
  });

  it("schedules a cantrip's 'draw at the next turn's upkeep' rider", () => {
    const blow = make({
      name: "Test Cantrip", type_line: "Instant", mana_cost: "{W}", cmc: 1,
      oracle_text: "Target creature gains first strike until end of turn.\nDraw a card at the beginning of the next turn's upkeep."
    });
    expect(profileOf(blow).fullyImplemented).toBe(true);
    let game = readyToCast([blow], [PLAINS()]);
    game = stage(game, 0, (player) => ({ autoPass: false, library: toHand(0, [BEAR(), BOLT()], "lib") }));
    game = putOnBattlefield(game, 0, [BEAR()]);
    const own = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears" && !permanent.summoningSick)
      ?? game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    const handBefore = game.players[0]!.hand.length;
    game = applyAction(game, 0, { type: "cast", cardId: game.players[0]!.hand.find((card) => card.name === "Test Cantrip")!.instance_id, targets: [{ kind: "permanent", instanceId: own.instance_id }] });
    game = passUntil(game, (state) => state.stack.length === 0 && state.pendingChoice === null);
    // No immediate draw; the delayed draw is queued.
    expect(game.players[0]!.hand.length).toBe(handBefore - 1);
    expect(game.delayedDraws.some((delayed) => delayed.seat === 0 && delayed.amount === 1)).toBe(true);

    // It fires at the very next upkeep.
    const castTurn = game.turn;
    const graveBefore = game.players[0]!.graveyard.length;
    game = passUntil(game, (state) => state.turn === castTurn + 1 && state.step === "precombat-main");
    expect(game.delayedDraws.length).toBe(0);
    expect(game.players[0]!.graveyard.length).toBeGreaterThanOrEqual(graveBefore);
  });

  it("stops an enchanted creature from attacking or blocking (Pacifism)", () => {
    const pacifism = make({
      name: "Test Pacifism", type_line: "Enchantment — Aura", mana_cost: "{1}{W}", cmc: 2,
      oracle_text: "Enchant creature\nEnchanted creature can't attack or block."
    });
    expect(profileOf(pacifism)).toMatchObject({ fullyImplemented: true, auraModification: { cannotAttack: true, cannotBlock: true } });
    let game = readyToCast([pacifism], [PLAINS(), PLAINS()], [BEAR()]);
    game = stage(game, 0, () => ({ autoPass: false }));
    const foe = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;

    expect(legalAttackers(game, 1).some((permanent) => permanent.instance_id === foe.instance_id)).toBe(true);
    game = applyAction(game, 0, { type: "cast", cardId: game.players[0]!.hand[0]!.instance_id, targets: [{ kind: "permanent", instanceId: foe.instance_id }] });
    game = passUntil(game, (state) => state.stack.length === 0 && state.pendingChoice === null);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Test Pacifism" && permanent.attachedTo === foe.instance_id)).toBe(true);

    // The enchanted Bears can no longer be declared as an attacker.
    expect(legalAttackers(game, 1).some((permanent) => permanent.instance_id === foe.instance_id)).toBe(false);
    // ...nor as a blocker: put a seat-0 attacker into combat targeting seat 1.
    const attackerId = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")?.instance_id
      ?? (game = putOnBattlefield(game, 0, [BEAR()]), game.players[0]!.battlefield.at(-1)!.instance_id);
    const combatGame = { ...game, step: "declare-blockers" as const, combat: { ...game.combat, attackers: [{ instanceId: attackerId, defender: 1 as SeatId }], attackersDeclared: true } };
    expect(legalBlockers(combatGame, 1).some((permanent) => permanent.instance_id === foe.instance_id)).toBe(false);
  });

  it("shrinks an opponent's creature with an ETB '-1/-1 to target creature an opponent controls'", () => {
    const assassin = make({
      name: "Test Eyeblight", type_line: "Creature — Elf Warrior", mana_cost: "{2}{B}", cmc: 3, power: "2", toughness: "2",
      oracle_text: "When this creature enters, target creature an opponent controls gets -1/-1 until end of turn."
    });
    expect(profileOf(assassin).triggers[0]).toMatchObject({ targetKind: "creature-opponent", effect: { kind: "modify-target-creature", power: -1, toughness: -1 } });
    const oneOne = make({ name: "Little Guy", type_line: "Creature — Bird", mana_cost: "{U}", cmc: 1, power: "1", toughness: "1" });
    let game = readyToCast([assassin], [SWAMP(), SWAMP(), SWAMP()], [oneOne]);
    game = stage(game, 0, () => ({ autoPass: false }));
    expect(game.players[1]!.battlefield.some((permanent) => permanent.card.name === "Little Guy")).toBe(true);

    game = applyAction(game, 0, { type: "cast", cardId: game.players[0]!.hand[0]!.instance_id });
    game = passUntil(game, (state) => state.stack.length === 0 && state.triggerQueue.length === 0 && state.pendingChoice === null);
    // The 1/1 dropped to 0/0 and was swept by the state-based action.
    expect(game.players[1]!.battlefield.some((permanent) => permanent.card.name === "Little Guy")).toBe(false);
    expect(game.players[1]!.graveyard.some((card) => card.name === "Little Guy")).toBe(true);
  });

  it("pings a chosen opponent from an ETB 'deals 1 damage to target opponent' land", () => {
    const painLand = make({
      name: "Test Painland", type_line: "Land", mana_cost: "", cmc: 0,
      oracle_text: "This land enters tapped.\nWhen this land enters, it deals 1 damage to target opponent.\n{T}: Add {B} or {G}."
    });
    expect(profileOf(painLand).triggers[0]).toMatchObject({ event: "enters-battlefield", targetKind: "opponent", effect: { kind: "damage-any-target", amount: 1 } });
    let game = readyToCast([], []);
    game = stage(game, 0, () => ({ autoPass: false, hand: [{ ...painLand, instance_id: "pl-0", owner: 0 } as GameCard] }));

    game = applyAction(game, 0, { type: "play-land", cardId: "pl-0" });
    game = passUntil(game, (state) => state.pendingChoice !== null || state.stack.length > 0);
    // The trigger targets an opponent; with one opponent it is auto-aimed.
    const trigger = legalActions(game, 0).find((entry) => entry.action.type === "choose-trigger-target" || entry.action.type === "pass");
    game = applyAction(game, 0, trigger!.action);
    game = passUntil(game, (state) => state.stack.length === 0 && state.triggerQueue.length === 0 && state.pendingChoice === null);
    expect(game.players[1]!.life).toBe(39);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Test Painland" && permanent.tapped)).toBe(true);
  });

  it("adds energy counters from an ETB 'you get {E}' trigger (reminder text stripped)", () => {
    const leopard = make({
      name: "Test Leopard", type_line: "Creature — Cat", mana_cost: "{1}{G}", cmc: 2, power: "2", toughness: "2",
      oracle_text: "Trample\nWhen this creature enters, you get {E}{E} (two energy counters)."
    });
    expect(profileOf(leopard).triggers[0]).toMatchObject({ event: "enters-battlefield", effect: { kind: "add-player-counter", counter: "energy", amount: 2 } });
    let game = readyToCast([leopard], [FOREST(), FOREST()]);
    expect(game.players[0]!.counters.energy ?? 0).toBe(0);
    game = applyAction(game, 0, { type: "cast", cardId: game.players[0]!.hand[0]!.instance_id });
    game = passUntil(game, (state) => state.stack.length === 0 && state.triggerQueue.length === 0 && state.pendingChoice === null);
    expect(game.players[0]!.counters.energy).toBe(2);
  });

  it("gets energy on ETB and bounces only the controller's own creature (Decoction Module)", () => {
    const module = make({
      name: "Decoction Module", type_line: "Artifact",
      oracle_text: "Whenever a creature you control enters, you get {E} (an energy counter).\n{4}, {T}: Return target creature you control to its owner's hand."
    });
    expect(profileOf(module)).toMatchObject({
      fullyImplemented: true,
      triggers: [expect.objectContaining({ event: "enters-battlefield", subject: "creature-you-control", effect: { kind: "add-player-counter", counter: "energy", amount: 1 } })],
      activatedAbilities: [expect.objectContaining({ targetKind: "creature-you-control", effect: { kind: "return-target-creature" } })]
    });
    let game = readyToCast([BEAR()], [module, FOREST(), FOREST()], [BEAR()]);
    expect(game.players[0]!.counters.energy ?? 0).toBe(0);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = passUntil(game, (state) => state.stack.length === 0 && state.triggerQueue.length === 0);
    expect(game.players[0]!.counters.energy).toBe(1);
    expect(game.players[1]!.counters.energy ?? 0).toBe(0);

    const moduleInPlay = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Decoction Module")!;
    const ownBear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    const opponentBear = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    game = stage(game, 0, () => ({ manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 4 } }));
    const candidates = legalTargets(game, 0, "creature-you-control");
    expect(candidates.some((target) => target.kind === "permanent" && target.instanceId === ownBear.instance_id)).toBe(true);
    expect(candidates.some((target) => target.kind === "permanent" && target.instanceId === opponentBear.instance_id)).toBe(false);
    game = applyAction(game, 0, { type: "activate", sourceId: moduleInPlay.instance_id, abilityIndex: 0, targets: [{ kind: "permanent", instanceId: ownBear.instance_id }] });
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Grizzly Bears")).toBe(false);
    expect(game.players[0]!.hand.some((card) => card.name === "Grizzly Bears")).toBe(true);
    expect(game.players[1]!.battlefield.some((permanent) => permanent.card.name === "Grizzly Bears")).toBe(true);
  });

  it("rummages (discard then draw) from an optional trigger", () => {
    const racer = make({
      name: "Test Racer", type_line: "Creature — Human", mana_cost: "{1}{R}", cmc: 2, power: "2", toughness: "2",
      oracle_text: "Whenever this creature becomes tapped, you may discard a card. If you do, draw a card."
    });
    expect(profileOf(racer).triggers[0]).toMatchObject({ event: "becomes-tapped", optional: true, effect: { kind: "discard-then-draw", amount: 1 } });
    let game = readyToCast([], [racer, make({ name: "Tap Engine", type_line: "Artifact", oracle_text: "{T}: Add {C}." })]);
    game = stage(game, 0, (player) => ({ autoPass: false, hand: toHand(0, [BEAR(), BOLT(), SOL_RING()], "h"), library: toHand(0, [FLIER(), FOREST()], "lib") }));
    // Tap the creature for mana... it has no mana ability; instead attack to tap it.
    game = passUntil(game, (state) => state.step === "declare-attackers" && state.activeSeat === 0 && !state.combat.attackersDeclared);
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Test Racer")!;
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: source.instance_id, defender: 1 }] });
    game = passUntil(game, (state) => state.pendingChoice?.type === "optional-trigger" || state.pendingChoice?.type === "discard-cards");
    if (game.pendingChoice?.type === "optional-trigger") {
      game = applyAction(game, 0, { type: "choose-trigger", sourceId: game.pendingChoice.sourceId, accept: true });
    }
    expect(game.pendingChoice).toMatchObject({ type: "discard-cards", seat: 0, remaining: 1, thenDrawSame: true });
    const handBefore = game.players[0]!.hand.length;
    game = applyAction(game, 0, { type: "choose-discard", sourceId: game.pendingChoice!.sourceId, cardId: "h-0" });
    game = passUntil(game, (state) => state.pendingChoice === null && state.stack.length === 0 && state.triggerQueue.length === 0);
    // Net card count unchanged (pitched one, drew one); Grizzly Bears in graveyard.
    expect(game.players[0]!.hand).toHaveLength(handBefore);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);
  });

  it("recurs a creature from the graveyard with an unrestricted '{cost}: Return this card' ability", () => {
    const skeleton = make({
      name: "Test Skeleton", type_line: "Creature — Skeleton", mana_cost: "{1}{B}", cmc: 2, power: "1", toughness: "1",
      oracle_text: "{2}{B}: Return this card from your graveyard to your hand."
    });
    expect(profileOf(skeleton).activatedAbilities[0]).toMatchObject({ sourceZone: "graveyard", effect: { kind: "return-source-to-hand" } });
    let game = readyToCast([], [SWAMP(), SWAMP(), SWAMP()]);
    game = stage(game, 0, (player) => ({ autoPass: false, graveyard: [{ ...skeleton, instance_id: "gy-skel", owner: 0 } as GameCard] }));

    const activate = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.action.sourceId === "gy-skel");
    expect(activate).toBeDefined();
    game = applyAction(game, 0, activate!.action);
    game = passUntil(game, (state) => state.stack.length === 0 && state.pendingChoice === null);
    expect(game.players[0]!.hand.some((card) => card.instance_id === "gy-skel")).toBe(true);
    expect(game.players[0]!.graveyard.some((card) => card.instance_id === "gy-skel")).toBe(false);
  });

  it("grants the source a keyword until end of turn from its own activated ability", () => {
    const kestrel = make({
      name: "Test Kestrel", type_line: "Creature — Bird", mana_cost: "{1}{U}", cmc: 2, power: "2", toughness: "2",
      oracle_text: "{U}: This creature gains flying until end of turn."
    });
    expect(profileOf(kestrel).activatedAbilities[0]).toMatchObject({ effect: { kind: "grant-source-keyword", keyword: "flying" } });
    let game = readyToCast([], [kestrel, ISLAND()]);
    game = stage(game, 0, () => ({ autoPass: false }));
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Test Kestrel")!;
    const island = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Island")!;
    expect(projectGame(game, 0).players[0]!.battlefield.find((p) => p.name === "Test Kestrel")?.keywords).not.toContain("flying");

    game = applyAction(game, 0, { type: "activate-mana", sourceId: island.instance_id, abilityIndex: 0, mana: "U" });
    game = applyAction(game, 0, { type: "activate", sourceId: source.instance_id, abilityIndex: 0 });
    game = passUntil(game, (state) => state.stack.length === 0 && state.pendingChoice === null);
    expect(projectGame(game, 0).players[0]!.battlefield.find((p) => p.name === "Test Kestrel")?.keywords).toContain("flying");

    // Cleared at cleanup.
    game = passUntil(game, (state) => state.turn === 3);
    expect(projectGame(game, 0).players[0]!.battlefield.find((p) => p.name === "Test Kestrel")?.keywords).not.toContain("flying");
  });

  it("mills the controller's own library from an ETB 'mill two cards' trigger", () => {
    const skullkeeper = make({
      name: "Test Skullkeeper", type_line: "Creature — Human Rogue", mana_cost: "{1}{B}", cmc: 2, power: "1", toughness: "1",
      oracle_text: "When this creature enters, mill two cards."
    });
    expect(profileOf(skullkeeper).fullyImplemented).toBe(true);
    let game = readyToCast([skullkeeper], [SWAMP(), SWAMP()]);
    game = stage(game, 0, (player) => ({ library: toHand(0, [BEAR(), BOLT(), SOL_RING()], "mill-lib") }));
    const graveBefore = game.players[0]!.graveyard.length;
    game = applyAction(game, 0, { type: "cast", cardId: game.players[0]!.hand[0]!.instance_id });
    game = passUntil(game, (state) => state.stack.length === 0 && state.triggerQueue.length === 0 && state.pendingChoice === null);
    expect(game.players[0]!.library.map((card) => card.name)).toEqual(["Sol Ring"]);
    expect(game.players[0]!.graveyard.length).toBe(graveBefore + 2);
    expect(game.players[0]!.graveyard.map((card) => card.name)).toEqual(expect.arrayContaining(["Grizzly Bears", "Lightning Bolt"]));
  });

  it("makes every opponent discard once, in APNAP order, from an ETB trigger", () => {
    const specter = make({
      name: "Test Specter", type_line: "Creature — Specter", mana_cost: "{1}{B}", cmc: 2, power: "2", toughness: "2",
      oracle_text: "Flying\nWhen this creature enters, each opponent discards a card."
    });
    expect(profileOf(specter).fullyImplemented).toBe(true);
    let game = createGame(
      [deck("A", COMMANDER("A"), []), deck("B", COMMANDER("B"), []), deck("C", COMMANDER("C"), [])],
      { seed: 7, allowPartialDecks: true }
    );
    game = stage(game, 0, () => ({ kind: "human", autoPass: false, hand: toHand(0, [specter], "cast") }));
    game = stage(game, 1, () => ({ hand: toHand(1, [BEAR(), BOLT()], "b") }));
    game = stage(game, 2, () => ({ hand: toHand(2, [SOL_RING(), FLIER()], "c") }));
    game = putOnBattlefield(game, 0, [SWAMP(), SWAMP()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);

    game = applyAction(game, 0, { type: "cast", cardId: "cast-0" });
    game = passUntil(game, (state) => state.pendingChoice?.type === "discard-cards");
    // Controller's first opponent in turn order goes first.
    expect(game.pendingChoice).toMatchObject({ type: "discard-cards", seat: 1, remaining: 1 });
    game = applyAction(game, 1, { type: "choose-discard", sourceId: game.pendingChoice!.sourceId, cardId: "b-0" });
    expect(game.pendingChoice).toMatchObject({ type: "discard-cards", seat: 2, remaining: 1 });
    game = applyAction(game, 2, { type: "choose-discard", sourceId: game.pendingChoice!.sourceId, cardId: "c-0" });
    expect(game.pendingChoice).toBeNull();

    expect(game.players[1]!.graveyard.map((card) => card.name)).toContain("Grizzly Bears");
    expect(game.players[2]!.graveyard.map((card) => card.name)).toContain("Sol Ring");
    expect(game.players[0]!.hand).toHaveLength(0);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Test Specter")).toBe(false);
  });

  it("pays Foster and reveals until a creature, sending the rest to the graveyard", () => {
    const first = make({ name: "Revealed Land", type_line: "Land", cmc: 0 });
    const found = make({ name: "Revealed Creature", type_line: "Creature — Beast", mana_cost: "{2}{G}", cmc: 3, power: "3", toughness: "3" });
    let game = readyToCast([BOLT()], [FOSTER(), MOUNTAIN(), MOUNTAIN(), BEAR()]);
    game = stage(game, 0, () => ({ library: toHand(0, [first, found], "foster-library") }));
    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: bear.instance_id }] });
    game = passUntil(game, (state) => state.pendingChoice?.type === "optional-trigger");
    const choice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "optional-trigger" }>;
    expect(choice.sourceCard.name).toBe("Foster");
    game = applyAction(game, 0, { type: "choose-trigger", sourceId: choice.sourceId, accept: true });
    expect(game.players[0]!.hand.some((card) => card.name === "Revealed Creature")).toBe(true);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Revealed Land")).toBe(true);
    expect(game.players[0]!.library).toHaveLength(0);
  });

  it("raises life-gained once and resolves a source counter trigger", () => {
    const profile = profileOf(LIFE_COUNTER());
    expect(profile.triggers[0]).toMatchObject({ event: "life-gained", subject: "you", effect: { kind: "add-counter-source", counter: "+1/+1", amount: 1 } });
    let game = readyToCast([LIFE_SPELL()], [FOREST(), LIFE_COUNTER()]);
    game = { ...game, players: game.players.map((player) => ({ ...player, autoPass: false })) };
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "pass" });
    expect(game.players[0]!.life).toBe(41);
    expect(game.stack.some((entry) => entry.trigger?.definition.event === "life-gained")).toBe(true);
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "pass" });
    const countered = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Life Counter")!;
    expect(countered.counters["+1/+1"]).toBe(1);
  });

  it("carries a life-gain amount into Sanguine Bond's targeted loss", () => {
    const profile = profileOf(SANGUINE_BOND());
    expect(profile.triggers[0]).toMatchObject({
      event: "life-gained", subject: "you", targetKind: "opponent",
      effect: { kind: "lose-life-target-event-amount" }
    });
    let game = readyToCast([LIFE_SPELL()], [FOREST(), SANGUINE_BOND()]);
    game = { ...game, players: game.players.map((player) => ({ ...player, autoPass: false })) };
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "pass" });
    expect(game.players[0]!.life).toBe(41);
    expect(game.pendingChoice).toBeNull();
    expect(game.stack.some((entry) => entry.trigger?.definition.effect.kind === "lose-life-target-event-amount")).toBe(true);
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "pass" });
    expect(game.players[1]!.life).toBe(39);
  });

  it("reuses the life-gained counter trigger for C13 Ajani's Pridemate", () => {
    const profile = profileOf(C13_AJANI_PRIDEMATE());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.triggers[0]).toMatchObject({
      event: "life-gained",
      subject: "you",
      effect: { kind: "add-counter-source", counter: "+1/+1", amount: 1 }
    });
    let game = readyToCast([LIFE_SPELL()], [FOREST(), C13_AJANI_PRIDEMATE()]);
    game = { ...game, players: game.players.map((player) => ({ ...player, autoPass: false })) };
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "pass" });
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "pass" });
    const pridemate = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Ajani's Pridemate")!;
    expect(pridemate.counters["+1/+1"]).toBe(1);
  });

  it("scales Cradle of Vitality counters with the life-gain event", () => {
    const profile = profileOf(C13_CRADLE_OF_VITALITY());
    expect(profile).toMatchObject({
      fullyImplemented: true,
      triggers: [{
        event: "life-gained", subject: "you", optional: true, targetKind: "creature",
        payCost: { raw: "{1}{W}" }, effect: { kind: "add-counter-target-creature-per-life-gained", counter: "+1/+1" }
      }]
    });
    let game = readyToCast([LIFE_SPELL()], [FOREST(), FOREST(), C13_CRADLE_OF_VITALITY(), C13_AJANI_PRIDEMATE(), PLAINS()]);
    game = { ...game, players: game.players.map((player) => ({ ...player, autoPass: false })) };
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "pass" });
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "pass" });
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "pass" });
    if (game.pendingChoice?.type === "trigger-order") {
      const order = legalActions(game, 0).find((entry) => entry.action.type === "choose-trigger-order" && entry.label.includes("Ajani"));
      expect(order).toBeDefined();
      game = applyAction(game, 0, order!.action);
      game = passUntil(game, (state) => state.pendingChoice?.type === "optional-trigger");
    }
    const target = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Ajani's Pridemate")!;
    expect(game.pendingChoice?.type).toBe("optional-trigger");
    const choice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "optional-trigger" }>;
    expect(choice.targets).toEqual([{ kind: "permanent", instanceId: target.instance_id }]);
    game = applyAction(game, 0, { type: "choose-trigger", sourceId: choice.sourceId, accept: true });
    game = passUntil(game, (state) => (state.players[0]!.battlefield.find((permanent) => permanent.instance_id === target.instance_id)?.counters["+1/+1"] ?? 0) > 0);
    const countered = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Ajani's Pridemate")!;
    expect(countered.counters["+1/+1"]).toBe(1);
  });

  it("reuses nontoken artifact sacrifice and token/life compound primitives", () => {
    const profile = profileOf(C13_THOPTER_FOUNDRY());
    expect(profile).toMatchObject({
      fullyImplemented: true,
      activatedAbilities: [{
        sacrificesPermanent: { type: "Artifact", nontoken: true },
        effect: { kind: "compound", effects: [{ kind: "create-token" }, { kind: "gain-life", amount: 1 }] }
      }]
    });
    let game = readyToCast([], [C13_THOPTER_FOUNDRY(), FOREST(), TEST_ARTIFACT()]);
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Thopter Foundry")!;
    const sacrifice = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Test Relic")!;
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate"
      && entry.action.sourceId === source.instance_id && entry.action.sacrificeId === sacrifice.instance_id);
    expect(activation).toBeDefined();
    game = applyAction(game, 0, activation!.action);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Test Relic")).toBe(false);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Thopter")).toBe(true);
    expect(game.players[0]!.life).toBe(41);
  });

  it("gains life for the chosen target player and raises that player's event", () => {
    const profile = profileOf(TARGET_LIFE_SPELL());
    expect(profile.effects[0]).toMatchObject({ kind: "gain-life-target-player", amount: 2 });
    let game = readyToCast([TARGET_LIFE_SPELL()], [FOREST()]);
    game = { ...game, players: game.players.map((player) => ({ ...player, autoPass: false })) };
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 1 }] });
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "pass" });
    expect(game.players[0]!.life).toBe(40);
    expect(game.players[1]!.life).toBe(42);
  });

  it("applies self life loss without entering the damage pipeline", () => {
    const profile = profileOf(SELF_LOSS_SPELL());
    expect(profile.effects[0]).toMatchObject({ kind: "lose-life", amount: 2 });
    let game = readyToCast([SELF_LOSS_SPELL()], [SWAMP()]);
    game = { ...game, players: game.players.map((player) => ({ ...player, autoPass: false })) };
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "pass" });
    expect(game.players[0]!.life).toBe(38);
    expect(game.players[1]!.life).toBe(40);
  });

  it("raises life-lost for life loss and resolves the matching source trigger", () => {
    const profile = profileOf(LOSS_COUNTER());
    expect(profile.triggers[0]).toMatchObject({ event: "life-lost", effect: { kind: "add-counter-source", counter: "+1/+1", amount: 1 } });
    let game = readyToCast([SELF_LOSS_SPELL()], [SWAMP(), LOSS_COUNTER()]);
    game = { ...game, players: game.players.map((player) => ({ ...player, autoPass: false })) };
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "pass" });
    expect(game.players[0]!.life).toBe(38);
    expect(game.stack.some((entry) => entry.trigger?.definition.event === "life-lost")).toBe(true);
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "pass" });
    const countered = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Pain Counter")!;
    expect(countered.counters["+1/+1"]).toBe(1);
  });

  it("gains life for every living player", () => {
    const profile = profileOf(EACH_LIFE_SPELL());
    expect(profile.effects[0]).toMatchObject({ kind: "each-player-gains-life", amount: 1 });
    let game = readyToCast([EACH_LIFE_SPELL()], [FOREST()]);
    game = { ...game, players: game.players.map((player) => ({ ...player, autoPass: false })) };
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "pass" });
    expect(game.players.map((player) => player.life)).toEqual([41, 41]);
  });

  it("makes the chosen target player lose life without treating it as damage", () => {
    const profile = profileOf(TARGET_LOSS_SPELL());
    expect(profile.effects[0]).toMatchObject({ kind: "lose-life-target-player", amount: 3 });
    let game = readyToCast([TARGET_LOSS_SPELL()], [SWAMP()]);
    game = { ...game, players: game.players.map((player) => ({ ...player, autoPass: false })) };
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 1 }] });
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "pass" });
    expect(game.players[0]!.life).toBe(40);
    expect(game.players[1]!.life).toBe(37);
  });

  it("lets the target player both draw and pay the life for a Sign in Blood effect", () => {
    const profile = profileOf(SIGN_IN_BLOOD());
    expect(profile.effects[0]).toMatchObject({
      kind: "compound",
      effects: [{ kind: "draw-target-player", amount: 2 }, { kind: "lose-life-target-player", amount: 2 }]
    });
    expect(profile.fullyImplemented).toBe(true);
    let game = readyToCast([SIGN_IN_BLOOD()], [SWAMP()]);
    game = { ...game, players: game.players.map((player) => ({ ...player, autoPass: false })) };
    const targetHand = game.players[1]!.hand.length;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 1 }] });
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "pass" });
    // The caster neither draws nor pays: both effects resolve against the
    // single chosen target, not the controller.
    expect(game.players[0]!.life).toBe(40);
    expect(game.players[1]!.life).toBe(38);
    expect(game.players[1]!.hand.length).toBe(targetHand + 2);
  });

  it("makes each living player lose life", () => {
    const profile = profileOf(EACH_LOSS_SPELL());
    expect(profile.effects[0]).toMatchObject({ kind: "each-player-loses-life", amount: 1 });
    let game = readyToCast([EACH_LOSS_SPELL()], [SWAMP()]);
    game = { ...game, players: game.players.map((player) => ({ ...player, autoPass: false })) };
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "pass" });
    expect(game.players.map((player) => player.life)).toEqual([39, 39]);
  });

  it("scales opponent life loss from the spell's X value", () => {
    const profile = profileOf(X_OPPONENT_LOSS());
    expect(profile.effects[0]).toMatchObject({ kind: "each-opponent-loses-life", amount: "X" });
    let game = readyToCast([X_OPPONENT_LOSS()], [SWAMP(), SWAMP(), SWAMP(), SWAMP()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", variableValue: 3 });
    expect(game.players[0]!.life).toBe(40);
    expect(game.players[1]!.life).toBe(37);
  });

  it("scales its draw effect from the spell's X value", () => {
    const profile = profileOf(X_DRAW());
    expect(profile.effects[0]).toMatchObject({ kind: "draw", amount: "X" });
    let game = readyToCast([X_DRAW()], [ISLAND(), ISLAND(), ISLAND()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", variableValue: 2 });
    expect(game.players[0]!.hand).toHaveLength(2);
  });

  it("keeps a trigger's target out of the cost of casting its source", () => {
    // The ETB targets; the creature spell itself does not (CR 603.3d).
    const profile = profileOf(ETB_BOLTER());
    expect(profile.targetKind).toBe("none");
    expect(profile.triggers[0]!.targetKind).toBe("any");
    // With no creature anywhere, the creature is still castable.
    const game = readyToCast([ETB_BOLTER()], [MOUNTAIN(), MOUNTAIN(), MOUNTAIN(), MOUNTAIN()]);
    expect(legalActions(game, 0).some((entry) => entry.label === "Lanzar Flame Herald")).toBe(true);
  });

  it("asks the controller to aim an ETB trigger and then deals the damage", () => {
    let game = readyToCast([ETB_BOLTER()], [MOUNTAIN(), MOUNTAIN(), MOUNTAIN(), MOUNTAIN()], [BEAR(), WALL()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    // Several legal targets, so the ability waits on a real choice.
    expect(game.pendingChoice).toMatchObject({ type: "trigger-target", seat: 0, targetKind: "any" });
    const choice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "trigger-target" }>;
    const bear = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    expect(legalActions(game, 1)).toHaveLength(0);

    game = applyAction(game, 0, { type: "choose-trigger-target", sourceId: choice.sourceId, target: { kind: "permanent", instanceId: bear.instance_id } });
    // Nobody can respond, so the ability goes on the stack with its target
    // locked in and resolves in the same settle.
    expect(game.players[1]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);
    // The 0/4 wall was never a legal pick for the two damage that killed the bear.
    expect(game.players[1]!.battlefield.some((permanent) => permanent.card.name === "Stone Wall")).toBe(true);
  });

  it("lets an any-target trigger see both seats and the creature that just entered", () => {
    let game = readyToCast([ETB_BOLTER()], [MOUNTAIN(), MOUNTAIN(), MOUNTAIN(), MOUNTAIN()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    const choice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "trigger-target" }>;
    const herald = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Flame Herald")!;
    expect(choice.options).toContainEqual({ kind: "player", seat: 0 });
    expect(choice.options).toContainEqual({ kind: "player", seat: 1 });
    // The source of the trigger is itself a legal target for "any target".
    expect(choice.options).toContainEqual({ kind: "permanent", instanceId: herald.instance_id });
    game = applyAction(game, 0, { type: "choose-trigger-target", sourceId: choice.sourceId, target: { kind: "player", seat: 1 } });
    expect(game.players[1]!.life).toBe(38);
  });

  it("fires a dies trigger from the creature that just left the battlefield", () => {
    let game = readyToCast([BOLT()], [MOUNTAIN()]);
    game = putOnBattlefield(game, 1, [DEATH_DRAIN()]);
    const victim = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grave Pact Acolyte")!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: victim.instance_id }] });
    game = passUntil(game, (state) => state.stack.length === 0 && !state.triggerQueue.length);
    expect(game.players[1]!.graveyard.some((card) => card.name === "Grave Pact Acolyte")).toBe(true);
    // Its own death trigger resolved even though its source had already left.
    expect(game.players[0]!.life).toBe(38);
  });

  it("uses the source power for Stalking Vengeance after another creature dies", () => {
    let game = readyToCast([BOLT()], [STALKING_VENGEANCE(), MOUNTAIN(), BEAR()]);
    const victim = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: victim.instance_id }] });
    expect(game.pendingChoice).toMatchObject({ type: "trigger-target", seat: 0, targetKind: "player-or-planeswalker" });
    const choice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "trigger-target" }>;
    game = applyAction(game, 0, { type: "choose-trigger-target", sourceId: choice.sourceId, target: { kind: "player", seat: 1 } });
    expect(game.players[1]!.life).toBe(35);
  });

  it("recognizes the complementary flying-only sweeper", () => {
    expect(profileOf(FLYING_SWEEP()).effects).toEqual([{ kind: "damage-flying-creatures", amount: "X" }]);
  });

  it("fires another creature's death trigger without firing it for itself", () => {
    let game = readyToCast([BOLT()], [MOUNTAIN()]);
    game = putOnBattlefield(game, 1, [WATCHER(), BEAR()]);
    const bear = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    const life = game.players[1]!.life;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: bear.instance_id }] });
    game = passUntil(game, (state) => state.stack.length === 0 && !state.triggerQueue.length);
    expect(game.players[1]!.life).toBe(life + 1);

    // Killing the watcher itself must not trigger its own "another creature" ability.
    let solo = readyToCast([BOLT()], [MOUNTAIN()]);
    solo = putOnBattlefield(solo, 1, [WATCHER()]);
    const watcher = solo.players[1]!.battlefield.find((permanent) => permanent.card.name === "Mortuary Watcher")!;
    const before = solo.players[1]!.life;
    solo = applyAction(solo, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: watcher.instance_id }] });
    solo = passUntil(solo, (state) => state.stack.length === 0 && !state.triggerQueue.length);
    expect(solo.players[1]!.life).toBe(before);
  });

  it("drains a chosen player for any creature's death, including its own", () => {
    // An opponent's creature dying fires it, and only the chosen player pays.
    let game = readyToCast([BOLT()], [DRAIN_ARTIST(), MOUNTAIN()], [BEAR()]);
    const bear = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    const life0 = game.players[0]!.life;
    const life1 = game.players[1]!.life;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: bear.instance_id }] });
    expect(game.pendingChoice).toMatchObject({ type: "trigger-target", seat: 0 });
    const choice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "trigger-target" }>;
    expect(choice.options).toContainEqual({ kind: "player", seat: 1 });
    game = applyAction(game, 0, { type: "choose-trigger-target", sourceId: choice.sourceId, target: { kind: "player", seat: 1 } });
    expect(game.players[0]!.life).toBe(life0 + 1);
    expect(game.players[1]!.life).toBe(life1 - 1);

    // "~ or another creature" restores the source to its own death watch
    // (unlike WATCHER above); the trigger still belongs to its last
    // controller, seat 1, even though seat 0's spell killed it.
    let solo = readyToCast([BOLT()], [MOUNTAIN()]);
    solo = putOnBattlefield(solo, 1, [DRAIN_ARTIST()]);
    const artist = solo.players[1]!.battlefield.find((permanent) => permanent.card.name === "Vein Reaper")!;
    const soloLife0 = solo.players[0]!.life;
    const soloLife1 = solo.players[1]!.life;
    solo = applyAction(solo, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: artist.instance_id }] });
    expect(solo.pendingChoice).toMatchObject({ type: "trigger-target", seat: 1 });
    const soloChoice = solo.pendingChoice as Extract<GameState["pendingChoice"], { type: "trigger-target" }>;
    solo = applyAction(solo, 1, { type: "choose-trigger-target", sourceId: soloChoice.sourceId, target: { kind: "player", seat: 0 } });
    expect(solo.players[0]!.life).toBe(soloLife0 - 1);
    expect(solo.players[1]!.life).toBe(soloLife1 + 1);
  });

  it("lets the chosen target search for its exact partner", () => {
    const bondedKin = PARTNER_WITH_KIN();
    let game = readyToCast([PARTNER_WITH_SEEKER()], [FOREST(), FOREST()]);
    game = stage(game, 1, (player) => ({ library: [...toHand(1, [bondedKin], "lib"), ...player.library] }));
    const libraryBefore = game.players[1]!.library.length;
    const handBefore = game.players[1]!.hand.length;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    // The caster's controller chooses the target, as with any targeted ability.
    expect(game.pendingChoice).toMatchObject({ type: "trigger-target", seat: 0 });
    const targetChoice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "trigger-target" }>;
    game = applyAction(game, 0, { type: "choose-trigger-target", sourceId: targetChoice.sourceId, target: { kind: "player", seat: 1 } });
    // But the chosen player, not the caster, decides whether to search.
    expect(game.pendingChoice).toMatchObject({ type: "optional-trigger", seat: 1 });
    const optional = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "optional-trigger" }>;
    game = applyAction(game, 1, { type: "choose-trigger", sourceId: optional.sourceId, accept: true });
    expect(game.players[1]!.hand.some((card) => card.name === "Bonded Kin")).toBe(true);
    expect(game.players[1]!.hand.length).toBe(handBefore + 1);
    expect(game.players[1]!.library.length).toBe(libraryBefore - 1);
  });

  it("leaves the chosen target's hand untouched when they decline the search", () => {
    const bondedKin = PARTNER_WITH_KIN();
    let game = readyToCast([PARTNER_WITH_SEEKER()], [FOREST(), FOREST()]);
    game = stage(game, 1, (player) => ({ library: [...toHand(1, [bondedKin], "lib"), ...player.library] }));
    const handBefore = game.players[1]!.hand.length;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    const targetChoice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "trigger-target" }>;
    game = applyAction(game, 0, { type: "choose-trigger-target", sourceId: targetChoice.sourceId, target: { kind: "player", seat: 1 } });
    const optional = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "optional-trigger" }>;
    game = applyAction(game, 1, { type: "choose-trigger", sourceId: optional.sourceId, accept: false });
    expect(game.players[1]!.hand.some((card) => card.name === "Bonded Kin")).toBe(false);
    expect(game.players[1]!.hand.length).toBe(handBefore);
  });

  it("fires another creature's enter trigger under any player's control, but not for itself", () => {
    // The controller's own creature entering triggers it.
    let game = readyToCast([BEAR()], [ANY_ENTER_WARDEN(), FOREST(), FOREST()]);
    const life = game.players[0]!.life;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = passUntil(game, (state) => state.stack.length === 0 && !state.triggerQueue.length);
    expect(game.players[0]!.life).toBe(life + 1);

    // So does an opponent's creature entering: the errata dropped "you control".
    let cross = twoSeatGame([], []);
    cross = stage(cross, 1, () => ({ hand: toHand(1, [BEAR()]) }));
    cross = putOnBattlefield(cross, 0, [ANY_ENTER_WARDEN()]);
    cross = putOnBattlefield(cross, 1, [FOREST(), FOREST()]);
    cross = passUntil(cross, (state) => state.activeSeat === 1 && state.step === "precombat-main" && state.prioritySeat === 1);
    const crossLife = cross.players[0]!.life;
    cross = applyAction(cross, 1, { type: "cast", cardId: "hand-0" });
    cross = passUntil(cross, (state) => state.stack.length === 0 && !state.triggerQueue.length);
    expect(cross.players[0]!.life).toBe(crossLife + 1);

    // The warden entering itself must not trigger its own ability (CR 109.5).
    let solo = readyToCast([ANY_ENTER_WARDEN()], [FOREST()]);
    const before = solo.players[0]!.life;
    solo = applyAction(solo, 0, { type: "cast", cardId: "hand-0" });
    solo = passUntil(solo, (state) => state.stack.length === 0 && !state.triggerQueue.length);
    expect(solo.players[0]!.life).toBe(before);
  });

  it("fires an attack trigger when attackers are declared", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ hand: [] }));
    game = putOnBattlefield(game, 0, [RAIDER()]);
    game = passUntil(game, (state) => state.step === "declare-attackers" && state.activeSeat === 0);
    const raider = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Bloodthirst Raider")!;
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: raider.instance_id, defender: 1 }] });
    // The attack trigger is announced before blockers, so it needs its target now.
    expect(game.pendingChoice).toMatchObject({ type: "trigger-target", seat: 0 });
    const choice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "trigger-target" }>;
    game = applyAction(game, 0, { type: "choose-trigger-target", sourceId: choice.sourceId, target: { kind: "player", seat: 1 } });
    // Nothing else needs a decision, so the trigger's 1 damage and the 2 points
    // of unblocked combat damage both land inside the same settle.
    expect(game.players[1]!.life).toBe(37);
    expect(game.log.some((entry) => entry.text.includes("Bloodthirst Raider hace 1 de daño"))).toBe(true);
  });

  it("lets Myr Battlesphere choose untapped Myr and uses the chosen count for X", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ hand: [] }));
    game = putOnBattlefield(game, 0, [MYR_BATTLESPHERE(), MYR_TOKEN(), MYR_TOKEN(), MYR_TOKEN()]);
    game = passUntil(game, (state) => state.step === "declare-attackers" && state.activeSeat === 0);
    const sphere = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Myr Battlesphere")!;
    const myrs = game.players[0]!.battlefield.filter((permanent) => permanent.card.name === "Myr");
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: sphere.instance_id, defender: 1 }] });
    expect(game.pendingChoice).toMatchObject({ type: "optional-trigger", tapCost: { amount: "any", subtype: "Myr" } });
    const choice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "optional-trigger" }>;
    const selected = myrs.slice(0, 2).map((permanent) => permanent.instance_id);
    expect(legalActions(game, 0).some((entry) => entry.action.type === "choose-trigger"
      && entry.action.accept && JSON.stringify(entry.action.tapIds) === JSON.stringify(selected))).toBe(true);
    game = applyAction(game, 0, { type: "choose-trigger", sourceId: choice.sourceId, accept: true, tapIds: selected });
    const updatedSphere = game.players[0]!.battlefield.find((permanent) => permanent.instance_id === sphere.instance_id)!;
    expect(myrs.slice(0, 2).every((permanent) => game.players[0]!.battlefield.find((candidate) => candidate.instance_id === permanent.instance_id)!.tapped)).toBe(true);
    expect(powerOf(updatedSphere, game)).toBe(6);
    expect(game.players[1]!.life).toBe(32);
  });

  it("fires an upkeep trigger only in its controller's own upkeep", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ hand: [] }));
    game = stage(game, 1, () => ({ hand: [] }));
    game = putOnBattlefield(game, 0, [UPKEEP_SAGE()]);
    const start = game.players[0]!.life;
    // Turn 1 is already past its upkeep, so the first firing is the controller's
    // next turn — not the opponent's turn 2 upkeep in between.
    game = passUntil(game, (state) => state.players[0]!.life !== start);
    expect(game.players[0]!.life).toBe(start + 2);
    expect(game.activeSeat).toBe(0);
    expect(game.turn).toBe(3);
  });

  it("puts simultaneous triggers on the stack in APNAP order", () => {
    // Both seats own a creature that watches for any creature dying, so one
    // death queues two triggers controlled by different players.
    let game = readyToCast([BOLT()], [MOUNTAIN()]);
    game = putOnBattlefield(game, 0, [ANY_DEATH_WATCHER()]);
    game = putOnBattlefield(game, 1, [ANY_DEATH_WATCHER(), BEAR()]);
    // Seats that hold priority let the stack be inspected before it resolves.
    game = { ...game, players: game.players.map((player) => ({ ...player, autoPass: false })) };
    const bear = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: bear.instance_id }] });
    game = passUntil(game, (state) => state.stack.filter((object) => object.trigger).length === 2);
    // Seat 0 is the active player, so its trigger went on the stack first and
    // therefore sits at the bottom; the opponent's resolves first.
    const triggers = game.stack.filter((object) => object.trigger);
    expect(triggers).toHaveLength(2);
    expect(triggers[0]!.controller).toBe(0);
    expect(triggers[1]!.controller).toBe(1);
  });

  it("keeps a mandatory trigger on the graphical stack even when its source left", () => {
    let game = readyToCast([BOLT()], [MOUNTAIN()], [BEAR()]);
    game = putOnBattlefield(game, 0, [ANY_DEATH_WATCHER()]);
    const watcher = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Blood Chronicler")!;
    game = stage(game, 0, (player) => ({ battlefield: player.battlefield.filter((permanent) => permanent.instance_id !== watcher.instance_id) }));
    game = { ...game, triggerQueue: [], priorityOpen: true, prioritySeat: 0, passedSeats: [], players: game.players.map((player) => ({ ...player, autoPass: false })) };
    const trigger = {
      id: "mandatory-left-source", controller: 0 as SeatId, sourcePermanentId: watcher.instance_id,
      sourceCard: watcher.card, definition: profileOf(watcher.card).triggers[0]!, cause: "criatura murió"
    } satisfies TriggerInstance;
    game = settle({ ...game, triggerQueue: [trigger] });
    expect(game.stack.some((object) => object.trigger?.id === trigger.id)).toBe(true);
    expect(game.priorityOpen).toBe(true);
  });
});


describe("activated abilities", () => {
  it("animates Sydri's target artifact and grants its artifact-creature keywords", () => {
    expect(profileOf(C13_SYDRI())).toMatchObject({
      fullyImplemented: true,
      activatedAbilities: [
        { targetKind: "noncreature-artifact", effect: { kind: "animate-target-artifact-mana-value" } },
        { targetKind: "artifact-creature", effect: { kind: "compound" } }
      ]
    });
    let game = readyOnBoard([C13_SYDRI(), TEST_ARTIFACT()], { hold: true });
    game = stage(game, 0, () => ({ manaPool: { W: 0, U: 1, B: 0, R: 0, G: 0, C: 0 } }));
    const sydri = permanentNamed(game, 0, "Sydri, Galvanic Genius")!;
    const relic = permanentNamed(game, 0, "Test Relic")!;
    game = applyAction(game, 0, { type: "activate", sourceId: sydri.instance_id, abilityIndex: 0, targets: [{ kind: "permanent", instanceId: relic.instance_id }] });
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(permanentNamed(game, 0, "Test Relic")!.temporaryAnimation).toMatchObject({ power: 2, toughness: 2, types: ["Artifact", "Creature"] });
  });
  /** Board plus priority in the controller's own precombat main phase. */
  function readyOnBoard(cards: CardData[], options: { sick?: boolean; library?: CardData[]; hold?: boolean } = {}) {
    let game = twoSeatGame([], []);
    // `hold` models a human seat: it keeps priority instead of being auto-passed,
    // which is what lets floating mana survive to be spent.
    game = stage(game, 0, () => ({ hand: [], ...(options.hold ? { autoPass: false } : {}) }));
    if (options.library) {
      game = stage(game, 0, (player) => ({
        library: [...toHand(0, options.library!, "lib"), ...player.library].slice(0, player.library.length)
      }));
    }
    game = putOnBattlefield(game, 0, cards, { sick: options.sick ?? false });
    return passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
  }

  function permanentNamed(game: GameState, seat: SeatId, name: string) {
    return game.players[seat]!.battlefield.find((permanent) => permanent.card.name === name);
  }

  it("reads a tap-for-mana ability as a mana ability, not a stack ability", () => {
    const profile = profileOf(ELVES());
    expect(profile.manaAbilities).toHaveLength(1);
    expect(profile.manaAbilities[0]!.produces).toEqual(["G"]);
    expect(profile.activatedAbilities).toHaveLength(0);
  });

  it("applies War Cadence's variable block tax and charges it per blocker", () => {
    const card = WAR_CADENCE();
    expect(profileOf(card)).toMatchObject({
      fullyImplemented: true,
      activatedAbilities: [{ manaCost: { raw: "{X}", hasVariable: true }, effect: { kind: "set-blocking-tax", amount: "X" }, targetKind: "none" }]
    });
    let game = readyOnBoard([card, MOUNTAIN(), MOUNTAIN(), MOUNTAIN()], { hold: true });
    const lands = game.players[0]!.battlefield.filter((permanent) => permanent.card.name === "Mountain");
    for (const land of lands.slice(0, 2)) game = applyAction(game, 0, { type: "activate-mana", sourceId: land.instance_id, abilityIndex: 0, mana: "R" });
    const source = permanentNamed(game, 0, "War Cadence")!;
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate"
      && entry.action.sourceId === source.instance_id && entry.action.abilityIndex === 0 && entry.action.variableValue === 2);
    expect(activation).toBeDefined();
    game = applyAction(game, 0, activation!.action);
    game = applyAction(game, 0, { type: "pass" });
    expect(game.blockingTaxPerCreature).toEqual([2]);

    game = readyOnBoard([MOUNTAIN(), BEAR()], { hold: true });
    game = putOnBattlefield(game, 1, [BEAR()]);
    const blocker = permanentNamed(game, 0, "Grizzly Bears")!;
    const attacker = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    game = stage(game, 0, () => ({ manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 2 } }));
    game = {
      ...game,
      step: "declare-blockers",
      blockingTaxPerCreature: [2],
      combat: { attackers: [{ instanceId: attacker.instance_id, defender: 0 }], blockers: [], attackersDeclared: true, blockersDeclared: false, blockersDeclaredBy: [], firstStrikeResolved: false, damageResolved: false }
    };
    game = applyAction(game, 0, { type: "declare-blockers", blockers: [{ instanceId: blocker.instance_id, attackerId: attacker.instance_id }] });
    expect(game.players[0]!.manaPool.C).toBe(0);
    expect(game.combat.blockers).toEqual([{ instanceId: blocker.instance_id, attackerId: attacker.instance_id }]);
  });

  it("supports Contested Cliffs multi-target Beast fights", () => {
    let game = readyOnBoard([C13_CONTESTED_CLIFFS(), MOUNTAIN(), FOREST(), TEST_BEAST()], { hold: true });
    game = putOnBattlefield(game, 1, [BEAR()]);
    const source = permanentNamed(game, 0, "Contested Cliffs")!;
    const beast = permanentNamed(game, 0, "Test Beast")!;
    const bear = permanentNamed(game, 1, "Grizzly Bears")!;
    const profile = profileOf(C13_CONTESTED_CLIFFS());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.activatedAbilities[0]).toMatchObject({
      effect: { kind: "fight" }, targetKinds: ["creature-you-control", "creature-opponent"]
    });
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.action.sourceId === source.instance_id && entry.action.abilityIndex === 0);
    expect(activation).toMatchObject({ requiresTargets: ["creature-you-control", "creature-opponent"] });
    game = applyAction(game, 0, {
      ...activation!.action,
      targets: [{ kind: "permanent", instanceId: beast.instance_id }, { kind: "permanent", instanceId: bear.instance_id }]
    } as Extract<import("./engine.js").GameAction, { type: "activate" }>);
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[1]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Test Beast")).toBe(true);
  });

  it("resolves Leonin Bladetrap against only attacking nonfliers", () => {
    let game = readyOnBoard([LEONIN_BLADETRAP(), MOUNTAIN(), MOUNTAIN()], { hold: true });
    game = putOnBattlefield(game, 1, [BEAR(), FLIER()], { sick: false });
    const attacker = permanentNamed(game, 1, "Grizzly Bears")!;
    const flier = permanentNamed(game, 1, "Storm Crow")!;
    game = {
      ...game,
      step: "declare-blockers",
      activeSeat: 1,
      prioritySeat: 0,
      priorityOpen: true,
      passedSeats: [],
      combat: { ...game.combat, attackers: [{ instanceId: attacker.instance_id, defender: 0 }], attackersDeclared: true, blockersDeclared: true }
    };
    const source = permanentNamed(game, 0, "Leonin Bladetrap")!;
    expect(profileOf(LEONIN_BLADETRAP()).activatedAbilities[0]).toMatchObject({
      sacrificesSelf: true,
      manaCost: { raw: "{2}" },
      targetKind: "none",
      effect: { kind: "damage-attacking-creatures", amount: 2, filter: "without-flying" }
    });
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.action.sourceId === source.instance_id);
    expect(activation).toBeDefined();
    game = applyAction(game, 0, activation!.action);
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[1]!.graveyard.some((card) => card.instance_id === attacker.card.instance_id)).toBe(true);
    expect(game.players[1]!.battlefield.some((permanent) => permanent.instance_id === flier.instance_id)).toBe(true);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Leonin Bladetrap")).toBe(true);
  });

  it("offers Deepfire Elemental targets and payment values for X", () => {
    let game = readyOnBoard([DEEPFIRE_ELEMENTAL(), MOUNTAIN(), MOUNTAIN(), MOUNTAIN(), MOUNTAIN(), MOUNTAIN()], { hold: true });
    game = putOnBattlefield(game, 1, [BEAR(), ARTIFACT_BLOCKER()]);
    const source = permanentNamed(game, 0, "Deepfire Elemental")!;
    const profile = profileOf(DEEPFIRE_ELEMENTAL());
    expect(profile.activatedAbilities[0]).toMatchObject({
      effect: { kind: "destroy-target-artifact-or-creature-mana-value" },
      targetKind: "artifact-or-creature"
    });
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate"
      && entry.action.sourceId === source.instance_id
      && entry.action.variableValue === 2);
    expect(activation).toMatchObject({ requiresTarget: "artifact-or-creature-mana-value-2" });
    const bear = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    game = applyAction(game, 0, { ...activation!.action, targets: [{ kind: "permanent", instanceId: bear.instance_id }] } as Extract<import("./engine.js").GameAction, { type: "activate" }>);
    game = passUntil(game, (state) => state.stack.length === 0 && state.players[1]!.graveyard.some((card) => card.name === "Grizzly Bears"));
    expect(game.players[1]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);
    expect(game.players[1]!.battlefield.some((permanent) => permanent.card.name === "Iron Construct")).toBe(true);
  });

  it("grants Aerie Mystics' activated shroud to creatures only", () => {
    let game = readyOnBoard([AERIE_MYSTICS(), BEAR(), FOREST(), ISLAND(), FOREST()], { hold: true });
    const source = permanentNamed(game, 0, "Aerie Mystics")!;
    const activation = legalActions(game, 0).find((entry) =>
      entry.action.type === "activate" && entry.action.sourceId === source.instance_id
    );
    expect(activation).toBeDefined();

    game = applyAction(game, 0, activation!.action);
    game = passUntil(game, (state) => state.stack.length === 0);

    expect(permanentNamed(game, 0, "Aerie Mystics")!.temporaryKeywords).toContain("shroud");
    expect(permanentNamed(game, 0, "Grizzly Bears")!.temporaryKeywords).toContain("shroud");
    expect(permanentNamed(game, 0, "Forest")!.temporaryKeywords ?? []).not.toContain("shroud");
  });

  it("filters Rakeclaw Gargantuan's first-strike target by current power", () => {
    let game = readyOnBoard([RAKECLAW_GARGANTUAN(), FOREST()], { hold: true });
    game = putOnBattlefield(game, 1, [TRAMPLER(), BEAR()]);
    const source = permanentNamed(game, 0, "Rakeclaw Gargantuan")!;
    const big = permanentNamed(game, 1, "Big Stomper")!;
    expect(profileOf(RAKECLAW_GARGANTUAN()).activatedAbilities[0]).toMatchObject({
      manaCost: { raw: "{1}" }, targetKind: "creature-power-at-least-5",
      effect: { kind: "grant-target-creature-keyword", keyword: "first strike" }
    });
    const legal = legalTargets(game, 0, "creature-power-at-least-5");
    expect(legal).toContainEqual({ kind: "permanent", instanceId: big.instance_id });
    expect(legal).not.toContainEqual({ kind: "permanent", instanceId: permanentNamed(game, 1, "Grizzly Bears")!.instance_id });

    game = applyAction(game, 0, { type: "activate", sourceId: source.instance_id, abilityIndex: 0,
      targets: [{ kind: "permanent", instanceId: big.instance_id }] });
    game = passUntil(game, (state) => state.stack.length === 0);

    expect(permanentNamed(game, 1, "Big Stomper")!.temporaryKeywords).toContain("first strike");
  });

  it("returns only owned creatures with Homeward Path", () => {
    let game = readyOnBoard([HOMEWARD_PATH(), BEAR()], { hold: true });
    game = putOnBattlefield(game, 1, [FLIER()]);
    const ownedBear = permanentNamed(game, 0, "Grizzly Bears")!;
    const ownedCrow = permanentNamed(game, 1, "Storm Crow")!;
    game = stage(game, 0, (player) => ({ battlefield: player.battlefield.filter((p) => p.instance_id !== ownedBear.instance_id).concat({ ...ownedCrow, controller: 0 }) }));
    game = stage(game, 1, (player) => ({ battlefield: player.battlefield.filter((p) => p.instance_id !== ownedCrow.instance_id).concat({ ...ownedBear, controller: 1 }) }));

    const source = permanentNamed(game, 0, "Homeward Path")!;
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.action.sourceId === source.instance_id && entry.action.abilityIndex === 0);
    expect(activation).toBeDefined();
    expect(profileOf(HOMEWARD_PATH()).activatedAbilities[0]).toMatchObject({ requiresTap: true, targetKind: "none", effect: { kind: "return-owned-creatures-to-control" } });

    game = applyAction(game, 0, activation!.action);
    game = passUntil(game, (state) => state.stack.length === 0);

    expect(permanentNamed(game, 0, "Grizzly Bears")!.controller).toBe(0);
    expect(permanentNamed(game, 1, "Storm Crow")!.controller).toBe(1);
    expect(permanentNamed(game, 1, "Grizzly Bears")).toBeUndefined();
    expect(permanentNamed(game, 0, "Storm Crow")).toBeUndefined();
  });

  it("animates Azorius Keyrune as a temporary flying creature", () => {
    let game = readyOnBoard([AZORIUS_KEYRUNE(), PLAINS(), ISLAND()], { hold: true });
    const source = permanentNamed(game, 0, "Azorius Keyrune")!;
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.action.sourceId === source.instance_id);
    expect(activation).toBeDefined();
    expect(profileOf(AZORIUS_KEYRUNE()).activatedAbilities[0]).toMatchObject({
      manaCost: { raw: "{W}{U}" }, targetKind: "none",
      effect: { kind: "animate-source", power: 2, toughness: 2, colors: ["W", "U"], subtypes: ["Bird"], keywords: ["flying"] }
    });

    game = applyAction(game, 0, activation!.action);
    game = passUntil(game, (state) => state.stack.length === 0);
    const animated = permanentNamed(game, 0, "Azorius Keyrune")!;
    expect(animated.temporaryAnimation).toMatchObject({ power: 2, toughness: 2, types: ["Artifact", "Creature"], subtypes: ["Bird"] });
    expect(powerOf(animated, game)).toBe(2);
    expect(legalAttackers(game, 0).some((permanent) => permanent.instance_id === animated.instance_id)).toBe(true);
    expect(cardProfile(animated.card).types).not.toContain("Creature");

    game = passUntil(game, (state) => state.turn > 1);
    expect(permanentNamed(game, 0, "Azorius Keyrune")!.temporaryAnimation).toBeUndefined();
    expect(legalAttackers(game, 0).some((permanent) => permanent.card.name === "Azorius Keyrune")).toBe(false);
  });

  it("resolves Druidic Satchel's conditional top-card reveal", () => {
    const card = C13_DRUIDIC_SATCHEL();
    expect(profileOf(card).activatedAbilities[0]).toMatchObject({
      requiresTap: true,
      manaCost: { raw: "{2}" },
      effect: { kind: "reveal-top-card-conditional" }
    });
    let game = readyOnBoard([FOREST(), FOREST(), card], { hold: true });
    game = stage(game, 0, (player) => ({ library: toHand(0, [BEAR()], "satchel-library") }));
    const source = permanentNamed(game, 0, "Druidic Satchel")!;
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.action.sourceId === source.instance_id);
    expect(activation).toBeDefined();
    game = applyAction(game, 0, activation!.action);
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[0]!.library).toHaveLength(0);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Saproling")).toBe(true);
  });

  it("offers the ETB payment for C13 sacrifice-unless-paid lands", () => {
    let game = readyOnBoard([FOREST()], { hold: true });
    game = stage(game, 0, () => ({ hand: toHand(0, [C13_RUPTURE_SPIRE()], "rupture-hand") }));
    game = applyAction(game, 0, { type: "play-land", cardId: "rupture-hand-0" });
    game = applyAction(game, 0, { type: "pass" });
    expect(game.pendingChoice).toMatchObject({ type: "optional-trigger", unlessPayCost: { raw: "{1}" } });
    const choice = game.pendingChoice!;
    game = applyAction(game, 0, { type: "choose-trigger", sourceId: choice.sourceId, accept: true });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Rupture Spire")).toBe(true);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Rupture Spire")).toBe(false);

    game = readyOnBoard([], { hold: true });
    game = stage(game, 0, () => ({ hand: toHand(0, [C13_TRANSGUILD_PROMENADE()], "promenade-hand") }));
    game = applyAction(game, 0, { type: "play-land", cardId: "promenade-hand-0" });
    game = applyAction(game, 0, { type: "pass" });
    expect(legalActions(game, 0).map((entry) => entry.action.type)).toEqual(["choose-trigger"]);
    game = applyAction(game, 0, { type: "choose-trigger", sourceId: game.pendingChoice!.sourceId, accept: false });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Transguild Promenade")).toBe(false);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Transguild Promenade")).toBe(true);
  });

  it("fires an any-damage trigger from a permanent source", () => {
    expect(profileOf(CHARNELHOARD_WURM()).triggers[0]).toMatchObject({
      event: "deals-damage-to-player", subject: "self", optional: true,
      targetKind: "card-in-your-graveyard", effect: { kind: "return-target-card-from-graveyard" }
    });
    expect(profileOf(CHARNELHOARD_WURM()).fullyImplemented).toBe(true);

    let game = readyOnBoard([DAMAGE_TRIGGERER()], { hold: true });
    const yard = toHand(0, [BEAR(), FLIER()], "damage-yard");
    const returned = yard[0]!;
    const other = yard[1]!;
    game = stage(game, 0, (player) => ({ graveyard: [returned, other] }));
    const source = permanentNamed(game, 0, "Damage Triggerer")!;
    game = applyAction(game, 0, {
      type: "activate", sourceId: source.instance_id, abilityIndex: 0,
      targets: [{ kind: "player", seat: 1 }]
    });
    game = passUntil(game, (state) => state.pendingChoice?.type === "trigger-target");
    const choice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "trigger-target" }>;
    expect(choice.options).toContainEqual({ kind: "graveyard-card", seat: 0, instanceId: returned.instance_id });
    game = applyAction(game, 0, {
      type: "choose-trigger-target", sourceId: choice.sourceId,
      target: { kind: "graveyard-card", seat: 0, instanceId: returned.instance_id }
    });
    game = passUntil(game, (state) => state.pendingChoice?.type === "optional-trigger");
    const optional = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "optional-trigger" }>;
    game = applyAction(game, 0, { type: "choose-trigger", sourceId: optional.sourceId, accept: true });
    game = passUntil(game, (state) => state.stack.length === 0 && state.pendingChoice === null);
    expect(game.players[0]!.hand.some((card) => card.instance_id === returned.instance_id)).toBe(true);
  });

  it("refuses Llanowar Elves the turn it arrives and adds {G} once it can tap", () => {
    let game = readyOnBoard([ELVES()], { sick: true });
    const sick = permanentNamed(game, 0, "Llanowar Elves")!;
    expect(legalActions(game, 0).some((entry) => entry.action.type === "activate-mana" && entry.action.sourceId === sick.instance_id)).toBe(false);
    expect(() => applyAction(game, 0, { type: "activate-mana", sourceId: sick.instance_id, abilityIndex: 0, mana: "G" }))
      .toThrow(/no puedes activar/i);

    game = readyOnBoard([ELVES()], { hold: true });
    const ready = permanentNamed(game, 0, "Llanowar Elves")!;
    game = applyAction(game, 0, { type: "activate-mana", sourceId: ready.instance_id, abilityIndex: 0, mana: "G" });
    expect(game.players[0]!.manaPool.G).toBe(1);
    expect(permanentNamed(game, 0, "Llanowar Elves")!.tapped).toBe(true);
    // The pool is emptied when the step ends (rule 500.4), never before.
    // A mana ability never uses the stack (rule 605.3a).
    expect(game.stack).toHaveLength(0);
  });

  it("reuses top-card land-or-hand selection for Skyward Eye Prophets", () => {
    const profile = profileOf(C13_SKYWARD_EYE_PROPHETS());
    expect(profile).toMatchObject({ fullyImplemented: true, activatedAbilities: [{ requiresTap: true, effect: { kind: "reveal-top-card-land-or-hand" } }] });
    let game = readyOnBoard([C13_SKYWARD_EYE_PROPHETS()], { hold: true });
    game = stage(game, 0, (player) => ({ library: toHand(0, [ISLAND()], "prophets-land") }));
    const source = permanentNamed(game, 0, "Skyward Eye Prophets")!;
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.action.sourceId === source.instance_id);
    expect(activation).toBeDefined();
    game = applyAction(game, 0, activation!.action);
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Island")).toBe(true);

    game = readyOnBoard([C13_SKYWARD_EYE_PROPHETS()], { hold: true });
    game = stage(game, 0, (player) => ({ library: toHand(0, [BEAR()], "prophets-spell") }));
    const second = permanentNamed(game, 0, "Skyward Eye Prophets")!;
    game = applyAction(game, 0, { type: "activate", sourceId: second.instance_id, abilityIndex: 0 });
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[0]!.hand.some((card) => card.name === "Grizzly Bears")).toBe(true);
  });

  it("recognises the fetch land cost and refuses it while the land is tapped", () => {
    const profile = profileOf(DELTA());
    expect(profile.activatedAbilities).toHaveLength(1);
    const ability = profile.activatedAbilities[0]!;
    expect(ability).toMatchObject({ requiresTap: true, sacrificesSelf: true, lifeCost: 1, manaCost: null });
    expect(ability.effect).toMatchObject({ kind: "search-library", destination: "battlefield" });
    expect(profile.manaAbilities).toHaveLength(0);

    let game = readyOnBoard([DELTA()], { library: [ISLAND()] });
    game = { ...game, players: game.players.map((player, index) => (index === 0
      ? { ...player, battlefield: player.battlefield.map((permanent) => ({ ...permanent, tapped: true })) }
      : player)) };
    const tapped = permanentNamed(game, 0, "Polluted Delta")!;
    expect(legalActions(game, 0).some((entry) => entry.action.type === "activate" && entry.action.sourceId === tapped.instance_id)).toBe(false);
  });

  it("pays 1 life, sacrifices Polluted Delta and fetches only a matching land", () => {
    let game = readyOnBoard([DELTA()], { library: [ISLAND(), MOUNTAIN()] });
    const delta = permanentNamed(game, 0, "Polluted Delta")!;
    const offered = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.action.sourceId === delta.instance_id);
    expect(offered).toBeDefined();

    game = applyAction(game, 0, offered!.action);
    // Costs are paid on announcement: life is gone and the land is already in the graveyard.
    expect(game.players[0]!.life).toBe(39);
    expect(permanentNamed(game, 0, "Polluted Delta")).toBeUndefined();
    expect(game.players[0]!.graveyard.filter((card) => card.name === "Polluted Delta")).toHaveLength(1);

    // The ability resolved into the library search; only Island is a legal pick.
    expect(game.pendingChoice).toMatchObject({ type: "search-library", seat: 0 });
    const choice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "search-library" }>;
    const legalNames = game.players[0]!.library.filter((card) => choice.optionIds.includes(card.instance_id)).map((card) => card.name);
    expect(legalNames).toContain("Island");
    expect(legalNames).not.toContain("Mountain");

    game = applyAction(game, 0, { type: "choose-library-card", sourceId: choice.sourceId, query: "Island" });
    expect(permanentNamed(game, 0, "Island")).toBeDefined();
    // The sacrificed land is not added to the graveyard a second time by the search.
    expect(game.players[0]!.graveyard.filter((card) => card.name === "Polluted Delta")).toHaveLength(1);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Island")).toBe(false);
  });

  it("resolves Ghost Quarter against its controller's land and offers Snow-Covered basics", () => {
    const profile = profileOf(GHOST_QUARTER());
    expect(profile).toMatchObject({ fullyImplemented: true });
    expect(profile.activatedAbilities[0]).toMatchObject({ targetKind: "land", effect: { kind: "destroy-target-land-search-basic" } });

    let game = readyOnBoard([GHOST_QUARTER(), KHER_KEEP()], { hold: true, library: [SNOW_FOREST(), FOREST()] });
    const ghostQuarter = permanentNamed(game, 0, "Ghost Quarter")!;
    const kherKeep = permanentNamed(game, 0, "Kher Keep")!;
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate"
      && entry.action.sourceId === ghostQuarter.instance_id);
    expect(activation).toBeDefined();

    const activationAction = activation!.action;
    if (activationAction.type !== "activate") throw new Error("Expected Ghost Quarter activation.");
    game = applyAction(game, 0, { ...activationAction, targets: [{ kind: "permanent", instanceId: kherKeep.instance_id }] });
    expect(game.log.at(-1)?.text).toContain("objetivo: Kher Keep");
    game = passUntil(game, (state) => state.pendingChoice?.type === "optional-basic-land-search");
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Kher Keep")).toBe(false);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Kher Keep")).toBe(true);
    expect(game.pendingChoice).toMatchObject({ type: "optional-basic-land-search", seat: 0 });

    const optional = game.pendingChoice!;
    game = applyAction(game, 0, { type: "choose-basic-land-search", sourceId: optional.sourceId, accept: true });
    expect(game.pendingChoice).toMatchObject({ type: "search-library", seat: 0 });
    const search = game.pendingChoice!;
    expect((search as Extract<GameState["pendingChoice"], { type: "search-library" }>).optionIds)
      .toContain("lib-0");
    game = applyAction(game, 0, { type: "choose-library-card", sourceId: search.sourceId, query: "Snow-Covered Forest" });
    expect(permanentNamed(game, 0, "Snow-Covered Forest")).toBeDefined();
  });

  it("sacrifices Armillary Sphere and puts both selected basics into hand", () => {
    let game = readyOnBoard([C13_ARMILLARY_SPHERE(), ISLAND(), ISLAND()], { library: [ISLAND(), SWAMP(), MOUNTAIN()] });
    const sphere = permanentNamed(game, 0, "Armillary Sphere")!;
    const offered = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.action.sourceId === sphere.instance_id);
    expect(offered).toBeDefined();

    game = applyAction(game, 0, offered!.action);
    expect(permanentNamed(game, 0, "Armillary Sphere")).toBeUndefined();
    expect(game.players[0]!.graveyard.filter((card) => card.name === "Armillary Sphere")).toHaveLength(1);
    expect(game.pendingChoice).toMatchObject({ type: "search-library-multi", seat: 0, selectedIds: [] });
    const sourceId = game.pendingChoice!.sourceId;

    game = applyAction(game, 0, { type: "choose-library-card", sourceId, query: "Island" });
    game = applyAction(game, 0, { type: "choose-library-card", sourceId, query: "Swamp" });
    expect(game.pendingChoice).toBeNull();
    expect(game.players[0]!.hand.filter((card) => card.name === "Island")).toHaveLength(1);
    expect(game.players[0]!.hand.filter((card) => card.name === "Swamp")).toHaveLength(1);
    expect(game.players[0]!.library.some((card) => card.name === "Island" || card.name === "Swamp")).toBe(false);
    expect(game.players[0]!.library.some((card) => card.name === "Mountain")).toBe(true);
  });

  it("reuses typed basic-land subtypes for Spoils of Victory", () => {
    const profile = profileOf(C13_SPOILS_OF_VICTORY());
    expect(profile).toMatchObject({
      fullyImplemented: true,
      effects: [{ kind: "search-library", types: ["Land"], subtypes: ["Plains", "Island", "Swamp", "Mountain", "Forest"], destination: "battlefield" }]
    });
    let game = twoSeatGame([], []);
    game = stage(game, 0, (player) => ({ hand: toHand(0, [C13_SPOILS_OF_VICTORY()]), library: [...toHand(0, [ISLAND(), MOUNTAIN(), BEAR()], "spoils-library")] }));
    game = putOnBattlefield(game, 0, [FOREST(), FOREST(), FOREST()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    const choice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "search-library" }>;
    expect(choice.optionIds).toHaveLength(2);
    game = applyAction(game, 0, { type: "choose-library-card", sourceId: choice.sourceId, query: "Island" });
    expect(permanentNamed(game, 0, "Island")).toBeDefined();
    expect(game.players[0]!.graveyard.some((card) => card.name === "Spoils of Victory")).toBe(true);
  });

  it("sacrifices Burnished Hart and puts both selected basics tapped onto the battlefield", () => {
    let game = readyOnBoard([C13_BURNISHED_HART(), FOREST(), FOREST(), FOREST()], { library: [ISLAND(), SWAMP(), MOUNTAIN()] });
    const hart = permanentNamed(game, 0, "Burnished Hart")!;
    game = applyAction(game, 0, { type: "activate", sourceId: hart.instance_id, abilityIndex: 0 });
    expect(game.players[0]!.graveyard.filter((card) => card.name === "Burnished Hart")).toHaveLength(1);
    expect(game.pendingChoice?.type).toBe("search-library-multi");
    const sourceId = game.pendingChoice!.sourceId;
    game = applyAction(game, 0, { type: "choose-library-card", sourceId, query: "Island" });
    game = applyAction(game, 0, { type: "choose-library-card", sourceId, query: "Swamp" });
    expect(game.pendingChoice).toBeNull();
    expect(game.players[0]!.battlefield.filter((permanent) => ["Island", "Swamp"].includes(permanent.card.name))).toHaveLength(2);
    expect(game.players[0]!.battlefield.filter((permanent) => ["Island", "Swamp"].includes(permanent.card.name)).every((permanent) => permanent.tapped)).toBe(true);
    expect(game.players[0]!.hand.some((card) => card.name === "Island" || card.name === "Swamp")).toBe(false);
  });

  it("spends entry counters for Vivid mana, including automatic coloured payment", () => {
    const profile = profileOf(VIVID_CREEK());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.entersTapped).toEqual({ kind: "tapped" });
    expect(profile.entersWithCounters).toEqual([{ kind: "charge", amount: 2 }]);
    expect(profile.manaAbilities[1]).toMatchObject({ produces: ["W", "U", "B", "R", "G"], removeCounters: [{ kind: "charge", amount: 1 }] });

    let game = readyOnBoard([VIVID_CREEK()], { hold: true });
    game = stage(game, 0, () => ({ hand: toHand(0, [VIVID_SPELL()], "vivid") }));
    const vivid = permanentNamed(game, 0, "Vivid Creek")!;
    expect(vivid.counters).toMatchObject({ charge: 2 });

    const cast = legalActions(game, 0).find((entry) => entry.action.type === "cast" && entry.cardId === "vivid-0");
    expect(cast).toBeDefined();
    game = applyAction(game, 0, cast!.action);
    expect(permanentNamed(game, 0, "Vivid Creek")?.counters.charge).toBe(1);
    expect(permanentNamed(game, 0, "Vivid Creek")?.tapped).toBe(true);
  });

  it("projects every legal fetch target and the full library only to the searching player", () => {
    let game = readyOnBoard([DELTA()], { library: [ISLAND(), WATERY_GRAVE(), MOUNTAIN()] });
    const delta = permanentNamed(game, 0, "Polluted Delta")!;
    game = applyAction(game, 0, { type: "activate", sourceId: delta.instance_id, abilityIndex: 0 });

    const own = projectGame(game, 0);
    expect(own.librarySearch?.candidates.map((card) => card.name)).toEqual(expect.arrayContaining(["Island", "Watery Grave"]));
    expect(own.librarySearch?.candidates.map((card) => card.name)).not.toContain("Mountain");
    expect(own.librarySearch?.allCards.map((card) => card.name)).toContain("Mountain");
    expect(projectGame(game, 1).librarySearch).toBeNull();
  });

  it("projects multi-card search targets and progress privately", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ hand: toHand(0, [C13_CULTIVATE()], "multi"), library: toHand(0, [ISLAND(), SWAMP(), MOUNTAIN()], "library") }));
    game = putOnBattlefield(game, 0, [FOREST(), ISLAND(), ISLAND()]);
    game = { ...game, activeSeat: 0, prioritySeat: 0, step: "precombat-main", priorityOpen: true, passedSeats: [] };
    game = applyAction(game, 0, { type: "cast", cardId: game.players[0]!.hand[0]!.instance_id });
    const sourceId = game.pendingChoice!.sourceId;
    game = applyAction(game, 0, { type: "choose-library-card", sourceId, query: "Island" });
    const own = projectGame(game, 0);
    expect(own.librarySearch).toMatchObject({ destination: "multiple", selectedCount: 1, maxSelections: 2 });
    expect(own.librarySearch?.candidates.map((card) => card.name)).toContain("Swamp");
    expect(own.librarySearch?.candidates.map((card) => card.name)).not.toContain("Island");
    expect(own.librarySearch?.allCards.map((card) => card.name)).toEqual(expect.arrayContaining(["Island", "Swamp", "Mountain"]));
    expect(projectGame(game, 1).librarySearch).toBeNull();
  });

  it("resolves a bounce land's ETB by returning a land its controller chose", () => {
    expect(profileOf(AZORIUS_CHANCERY()).fullyImplemented).toBe(true);
    let game = readyOnBoard([PLAINS()]);
    game = stage(game, 0, () => ({ hand: toHand(0, [AZORIUS_CHANCERY()], "bounce") }));
    game = applyAction(game, 0, { type: "play-land", cardId: "bounce-0" });
    expect(game.pendingChoice).toMatchObject({ type: "trigger-target", targetKind: "land-you-control" });
    const choice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "trigger-target" }>;
    const plains = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Plains")!;
    expect(choice.options).toContainEqual({ kind: "permanent", instanceId: plains.instance_id });

    game = applyAction(game, 0, { type: "choose-trigger-target", sourceId: choice.sourceId, target: { kind: "permanent", instanceId: plains.instance_id } });
    expect(game.players[0]!.hand.some((card) => card.name === "Plains")).toBe(true);
    expect(game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Azorius Chancery")?.tapped).toBe(true);
  });

  it("pays the mana part of an activation cost and puts the ability on the stack", () => {
    const profile = profileOf(SIGNAL_PEST());
    expect(profile.activatedAbilities[0]).toMatchObject({ requiresTap: true, sacrificesSelf: false, lifeCost: 0 });
    expect(profile.activatedAbilities[0]!.manaCost?.raw).toBe("{1}{U}");

    // One Island alone cannot pay {1}{U}; the ability must not be offered.
    let game = readyOnBoard([SIGNAL_PEST(), ISLAND()]);
    const well = permanentNamed(game, 0, "Well of Lore")!;
    expect(legalActions(game, 0).some((entry) => entry.action.type === "activate" && entry.action.sourceId === well.instance_id)).toBe(false);

    game = readyOnBoard([SIGNAL_PEST(), ISLAND(), ISLAND()]);
    const source = permanentNamed(game, 0, "Well of Lore")!;
    const hand = game.players[0]!.hand.length;
    game = applyAction(game, 0, { type: "activate", sourceId: source.instance_id, abilityIndex: 0 });
    expect(game.players[0]!.battlefield.filter((permanent) => permanent.tapped)).toHaveLength(3);
    expect(game.players[0]!.manaPool).toMatchObject({ U: 0, C: 0 });
    // An activated ability that is not a mana ability resolves through the stack.
    expect(game.players[0]!.hand).toHaveLength(hand + 1);
  });

  it("returns priority to the activating player with a graphical stack object", () => {
    let game = readyOnBoard([FIREBREATHER(), MOUNTAIN()], { hold: true });
    const drake = permanentNamed(game, 0, "Firecoil Drake")!;
    game = applyAction(game, 0, { type: "activate", sourceId: drake.instance_id, abilityIndex: 0 });
    expect(game.stack).toHaveLength(1);
    expect(game.stack[0]).toMatchObject({ activated: expect.any(Object), sourcePermanentId: drake.instance_id });
    expect(game.priorityOpen).toBe(true);
    expect(game.prioritySeat).toBe(0);
    expect(game.passedSeats).toEqual([]);
    expect(game.players[0]!.manaPool.R).toBe(0);
  });

  it("preserves the chosen permanent target on the public stack object", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ autoPass: false, hand: toHand(0, [FLAMETONGUE()], "kavu") }));
    game = stage(game, 1, () => ({ autoPass: false }));
    game = putOnBattlefield(game, 0, [MOUNTAIN(), MOUNTAIN(), MOUNTAIN(), MOUNTAIN()]);
    game = putOnBattlefield(game, 1, [BEAR()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.prioritySeat === 0);
    const kavu = permanentNamed(game, 0, "Flametongue Kavu")!;
    const bear = permanentNamed(game, 1, "Grizzly Bears")!;
    game = applyAction(game, 0, { type: "cast", cardId: "kavu-0", targets: [{ kind: "permanent", instanceId: bear.instance_id }] });
    expect(game.stack.at(-1)?.targets).toEqual([{ kind: "permanent", instanceId: bear.instance_id }]);
    expect(game.priorityOpen).toBe(true);
  });

  it("resolves a self-pump activated ability through the stack and expires it in cleanup", () => {
    const profile = profileOf(FIREBREATHER());
    expect(profile.activatedAbilities).toHaveLength(1);
    expect(profile.activatedAbilities[0]).toMatchObject({ requiresTap: false, sacrificesSelf: false, lifeCost: 0 });
    expect(profile.activatedAbilities[0]!.manaCost?.raw).toBe("{R}");
    expect(profile.activatedAbilities[0]!.effect).toEqual({ kind: "modify-source-creature", power: 1, toughness: 0 });
    expect(profile.fullyImplemented).toBe(true);

    let game = readyOnBoard([FIREBREATHER(), MOUNTAIN(), MOUNTAIN()], { hold: true });
    const drake = permanentNamed(game, 0, "Firecoil Drake")!;
    expect([powerOf(drake, game), toughnessOf(drake, game)]).toEqual([2, 2]);

    const action = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.action.sourceId === drake.instance_id);
    expect(action).toBeDefined();
    game = applyAction(game, 0, action!.action);
    // A non-mana activation uses the stack; it resolves once priority is passed (CR 602.2a).
    expect(game.stack).toHaveLength(1);
    game = applyAction(game, 0, { type: "pass" });
    expect(game.stack).toHaveLength(0);
    expect(powerOf(permanentNamed(game, 0, "Firecoil Drake")!, game)).toBe(3);

    // A second activation stacks another layer 7c modifier (CR 613.4c).
    game = applyAction(game, 0, { type: "activate", sourceId: drake.instance_id, abilityIndex: 0 });
    game = applyAction(game, 0, { type: "pass" });
    expect(powerOf(permanentNamed(game, 0, "Firecoil Drake")!, game)).toBe(4);

    // The modifier is removed during the cleanup step (CR 514.2).
    game = passUntil(game, (state) => state.turn > 1);
    expect(powerOf(permanentNamed(game, 0, "Firecoil Drake")!, game)).toBe(2);
  });

  it("tracks a characteristic-defining power/toughness live off the controller's hand size", () => {
    const profile = profileOf(HAND_SIZE_CDA_CREATURE());
    expect(profile.cdaPowerToughness).toBe("cards-in-your-hand");
    expect(profile.fullyImplemented).toBe(true);

    let game = readyOnBoard([HAND_SIZE_CDA_CREATURE()]);
    const crawler = permanentNamed(game, 0, "Test Psychosis Crawler")!;
    expect([powerOf(crawler, game), toughnessOf(crawler, game)]).toEqual([0, 0]);

    game = stage(game, 0, () => ({ hand: toHand(0, [BEAR(), FOREST(), FOREST()], "crawler-hand") }));
    expect([powerOf(crawler, game), toughnessOf(crawler, game)]).toEqual([3, 3]);

    game = stage(game, 0, (player) => ({ hand: player.hand.slice(1) }));
    expect([powerOf(crawler, game), toughnessOf(crawler, game)]).toEqual([2, 2]);
  });

  it("keeps mana abilities out of the decision the table waits on", () => {
    const game = readyOnBoard([FOREST()]);
    // The action exists for a player who wants it...
    const manaAction = legalActions(game, 0).find((entry) => entry.action.type === "activate-mana");
    expect(manaAction).toMatchObject({ label: "Forest: Add {G}" });
    // ...but adding mana is never the decision that stops the game.
    expect(hasRealChoice({ ...game, players: game.players.map((player) => ({ ...player, autoPass: true })) }, 0)).toBe(false);
  });

  it("keeps non-mana activated abilities as smart-priority stops", () => {
    const game = readyOnBoard([SIGNAL_PEST(), ISLAND(), ISLAND()]);
    expect(hasRealChoice({ ...game, players: game.players.map((player) => ({ ...player, autoPass: true })) }, 0)).toBe(true);
  });

  it("does not treat a hand fast-mana action as a smart-priority stop", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({
      autoPass: true,
      hand: toHand(0, [SIMIAN_SPIRIT_GUIDE()], "autopass-guide")
    }));
    game = stage(game, 1, () => ({ autoPass: true }));
    game = { ...putOnBattlefield(game, 0, [MOUNTAIN(), MOUNTAIN(), MOUNTAIN()]), priorityOpen: true, prioritySeat: 0, step: "precombat-main", activeSeat: 1, stack: [], pendingChoice: null };
    expect(legalActions(game, 0).some((entry) => entry.action.type === "activate-mana" && entry.cardId === "autopass-guide-0")).toBe(true);
    expect(hasRealChoice(game, 0)).toBe(false);
  });

  it("reuses targeted tap and untap effects through the normal stack target flow", () => {
    let game = readyOnBoard([BEAR(), ISLAND(), ISLAND(), ISLAND(), ISLAND()], { hold: true });
    const creature = permanentNamed(game, 0, "Grizzly Bears")!;
    game = stage(game, 0, (player) => ({ hand: toHand(0, [TAP_SPELL(), UNTAP_SPELL()], "tap-untap") }));

    const tapCard = game.players[0]!.hand[0]!;
    const tapAction = legalActions(game, 0).find((entry) => entry.action.type === "cast" && entry.cardId === tapCard.instance_id)!;
    expect(tapAction.requiresTarget).toBe("creature");
    game = applyAction(game, 0, { type: "cast", cardId: tapCard.instance_id, targets: [{ kind: "permanent", instanceId: creature.instance_id }] });
    game = applyAction(game, 0, { type: "pass" });
    expect(permanentNamed(game, 0, "Grizzly Bears")?.tapped).toBe(true);

    const untapCard = game.players[0]!.hand[0]!;
    const untapAction = legalActions(game, 0).find((entry) => entry.action.type === "cast" && entry.cardId === untapCard.instance_id)!;
    expect(untapAction.requiresTarget).toBe("permanent");
    game = applyAction(game, 0, { type: "cast", cardId: untapCard.instance_id, targets: [{ kind: "permanent", instanceId: creature.instance_id }] });
    game = applyAction(game, 0, { type: "pass" });
    expect(permanentNamed(game, 0, "Grizzly Bears")?.tapped).toBe(false);
  });

  it("mills only the chosen player's library and preserves library order", () => {
    let game = readyOnBoard([SWAMP(), SWAMP()], { hold: true });
    const top = [BEAR(), FOREST(), ISLAND()];
    game = stage(game, 0, (player) => ({ hand: toHand(0, [MILL_SPELL()], "mill-hand") }));
    game = stage(game, 1, (player) => ({ library: toHand(1, top, "mill-library") }));
    const card = game.players[0]!.hand[0]!;
    expect(cardProfile(card).effects).toContainEqual({ kind: "mill-target-player", amount: 3 });
    const before = game.players[1]!.library.length;
    game = applyAction(game, 0, { type: "cast", cardId: card.instance_id, targets: [{ kind: "player", seat: 1 }] });
    game = applyAction(game, 0, { type: "pass" });
    expect(game.players[1]!.library).toHaveLength(before - 3);
    expect(game.players[1]!.graveyard.slice(-3).map((entry) => entry.name)).toEqual(["Grizzly Bears", "Forest", "Island"]);
    expect(game.players[0]!.graveyard).toHaveLength(1);
  });

  it("mills each opponent without touching the controller's library", () => {
    let game = readyOnBoard([SWAMP(), SWAMP(), SWAMP()], { hold: true });
    const top = [BEAR(), FOREST(), ISLAND()];
    game = stage(game, 0, (player) => ({ hand: toHand(0, [EACH_MILL_SPELL()], "each-mill-hand") }));
    game = stage(game, 1, (player) => ({ library: toHand(1, top, "each-mill-library") }));
    const before = game.players[0]!.library.length;
    game = applyAction(game, 0, { type: "cast", cardId: "each-mill-hand-0" });
    game = applyAction(game, 0, { type: "pass" });
    expect(game.players[1]!.library).toHaveLength(1);
    expect(game.players[1]!.graveyard.slice(-2).map((entry) => entry.name)).toEqual(["Grizzly Bears", "Forest"]);
    expect(game.players[0]!.library).toHaveLength(before);
  });

  it("draws for each opponent without changing the controller's hand", () => {
    let game = readyOnBoard([ISLAND(), ISLAND(), ISLAND()], { hold: true });
    game = stage(game, 0, (player) => ({ hand: toHand(0, [EACH_DRAW_SPELL()], "each-draw-hand") }));
    game = stage(game, 1, (player) => ({ hand: [], library: toHand(1, [BEAR(), FOREST()], "each-draw-library") }));
    game = applyAction(game, 0, { type: "cast", cardId: "each-draw-hand-0" });
    game = applyAction(game, 0, { type: "pass" });
    expect(game.players[1]!.hand.map((card) => card.name)).toEqual(["Grizzly Bears", "Forest"]);
    expect(game.players[0]!.hand).toHaveLength(0);
  });

  it("puts Equip on the stack, grants Behemoth Sledge bonuses, and detaches when the creature leaves", () => {
    let game = readyOnBoard([BEHEMOTH_SLEDGE(), BEAR(), FOREST(), FOREST(), FOREST()], { hold: true });
    const equipment = permanentNamed(game, 0, "Behemoth Sledge")!;
    const creature = permanentNamed(game, 0, "Grizzly Bears")!;
    const equip = legalActions(game, 0).find((entry) => entry.action.type === "equip" && entry.cardId === equipment.instance_id);
    expect(equip).toMatchObject({ requiresTarget: "creature-you-control", note: "Equip {3}" });

    game = applyAction(game, 0, { type: "equip", sourceId: equipment.instance_id, targetId: creature.instance_id });
    expect(game.stack.at(-1)?.activated?.effect).toEqual({ kind: "attach-equipment" });
    game = applyAction(game, 0, { type: "pass" });
    const equipped = permanentNamed(game, 0, "Grizzly Bears")!;
    const sledge = permanentNamed(game, 0, "Behemoth Sledge")!;
    expect(sledge.attachedTo).toBe(equipped.instance_id);
    expect(powerOf(equipped, game)).toBe(4);
    expect(toughnessOf(equipped, game)).toBe(4);
    expect(legalTargets(game, 0, "creature")).toContainEqual({ kind: "permanent", instanceId: equipped.instance_id });

    game = settle(stage(game, 0, (player) => ({ battlefield: player.battlefield.filter((permanent) => permanent.instance_id !== equipped.instance_id) })));
    expect(permanentNamed(game, 0, "Behemoth Sledge")?.attachedTo).toBeUndefined();
  });

  it("equips a matching creature for the cheaper typed cost, everything else for the general cost", () => {
    const profile = profileOf(TYPED_EQUIP_ITEM());
    expect(profile.typedEquipCost).toMatchObject({ subtype: "Wizard", cost: { raw: "{1}" } });
    expect(profile.equipCost).toMatchObject({ raw: "{3}" });
    expect(profile.fullyImplemented).toBe(true);

    let game = readyOnBoard([TYPED_EQUIP_ITEM(), WIZARD_CREATURE(), BEAR(), ISLAND(), ISLAND(), ISLAND(), ISLAND()], { hold: true });
    const staff = permanentNamed(game, 0, "Test Wizard's Staff")!;
    const wizard = permanentNamed(game, 0, "Test Wizard")!;
    const bear = permanentNamed(game, 0, "Grizzly Bears")!;

    game = applyAction(game, 0, { type: "equip", sourceId: staff.instance_id, targetId: wizard.instance_id });
    expect(game.stack.at(-1)?.activated?.text).toBe("Equip {1}");
    game = applyAction(game, 0, { type: "pass" });
    expect(permanentNamed(game, 0, "Test Wizard's Staff")?.attachedTo).toBe(wizard.instance_id);

    game = applyAction(game, 0, { type: "equip", sourceId: staff.instance_id, targetId: bear.instance_id });
    expect(game.stack.at(-1)?.activated?.text).toBe("Equip {3}");
    game = applyAction(game, 0, { type: "pass" });
    expect(permanentNamed(game, 0, "Test Wizard's Staff")?.attachedTo).toBe(bear.instance_id);
  });

  it("preserves explicit mana-source selection while equipping", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ kind: "human" }));
    game = putOnBattlefield(game, 0, [BEHEMOTH_SLEDGE(), BEAR(), MOUNTAIN(), FOREST(), FOREST()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const equipment = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Behemoth Sledge")!;
    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    const equip = legalActions(game, 0).find((entry) => entry.action.type === "equip" && entry.cardId === equipment.instance_id)!;
    game = applyAction(game, 0, { type: "equip", sourceId: equipment.instance_id, targetId: bear.instance_id });
    expect(game.pendingChoice?.type).toBe("mana-payment");
    const forest = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Forest")!;
    const source = legalActions(game, 0).find((entry) => entry.action.type === "choose-mana-source" && entry.action.manaSourceId === forest.instance_id)!;
    game = applyAction(game, 0, source.action);
    const secondSource = legalActions(game, 0).find((entry) => entry.action.type === "choose-mana-source" && entry.action.manaSourceId !== forest.instance_id)!;
    game = applyAction(game, 0, secondSource.action);
    const thirdSource = legalActions(game, 0).find((entry) => entry.action.type === "choose-mana-source" && entry.action.manaSourceId !== forest.instance_id)!;
    game = applyAction(game, 0, thirdSource.action);
    expect(game.pendingChoice).toBeNull();
    expect(game.players[0]!.battlefield.find((permanent) => permanent.instance_id === equipment.instance_id)?.attachedTo).toBe(bear.instance_id);
    expect(game.players[0]!.battlefield.find((permanent) => permanent.instance_id === forest.instance_id)?.tapped).toBe(true);
  });

  it("reuses Equip for Swiftfoot Boots and Sword of the Paruns", () => {
    let game = readyOnBoard([SWIFTFOOT_BOOTS(), SWORD_OF_THE_PARUNS(), BEAR(), FLIER(), ...Array.from({ length: 13 }, () => FOREST())], { hold: true });
    const creature = permanentNamed(game, 0, "Grizzly Bears")!;
    const boots = permanentNamed(game, 0, "Swiftfoot Boots")!;
    const bootsAction = legalActions(game, 0).find((entry) => entry.action.type === "equip" && entry.cardId === boots.instance_id)!;
    game = applyAction(game, 0, { type: "equip", sourceId: boots.instance_id, targetId: creature.instance_id });
    game = applyAction(game, 0, { type: "pass" });
    expect(powerOf(creature, game)).toBe(2);
    expect(cardProfile(creature.card).keywords).not.toContain("haste");
    expect(projectGame(game, 0).players[0]!.battlefield.find((permanent) => permanent.name === "Grizzly Bears")?.keywords)
      .toEqual(expect.arrayContaining(["hexproof", "haste"]));

    const sword = permanentNamed(game, 0, "Sword of the Paruns")!;
    const swordAction = legalActions(game, 0).find((entry) => entry.action.type === "equip" && entry.cardId === sword.instance_id)!;
    game = applyAction(game, 0, { type: "equip", sourceId: sword.instance_id, targetId: creature.instance_id });
    game = applyAction(game, 0, { type: "pass" });
    expect(powerOf(creature, game)).toBe(4);
    expect(permanentNamed(game, 0, "Sword of the Paruns")?.attachedTo).toBe(creature.instance_id);

    game = stage(game, 0, (player) => ({ battlefield: player.battlefield.map((permanent) =>
      permanent.card.name === "Grizzly Bears" || permanent.card.name === "Storm Crow" ? { ...permanent, tapped: true } : permanent) }));
    const untapOthers = legalActions(game, 0).find((entry) => entry.action.type === "activate"
      && entry.cardId === sword.instance_id && entry.action.abilityIndex === 1)!;
    game = applyAction(game, 0, untapOthers.action);
    game = applyAction(game, 0, { type: "pass" });
    expect(permanentNamed(game, 0, "Grizzly Bears")?.tapped).toBe(true);
    expect(permanentNamed(game, 0, "Storm Crow")?.tapped).toBe(false);

    const untapEquipped = legalActions(game, 0).find((entry) => entry.action.type === "activate"
      && entry.cardId === sword.instance_id && entry.action.abilityIndex === 0)!;
    game = applyAction(game, 0, untapEquipped.action);
    game = applyAction(game, 0, { type: "pass" });
    expect(permanentNamed(game, 0, "Grizzly Bears")?.tapped).toBe(false);
  });

  it("uses one reusable Level up activation for counters, level stats, and keywords", () => {
    let game = readyOnBoard([LEVELER(), ISLAND(), ISLAND(), ISLAND(), ISLAND()], { hold: true });
    const leveler = permanentNamed(game, 0, "Test Leveler")!;
    const profile = profileOf(leveler.card);
    expect(profile.levelUpCost?.raw).toBe("{1}{U}");
    expect(profile.levelDefinitions).toEqual([
      expect.objectContaining({ minLevel: 2, maxLevel: 3, power: 2, toughness: 3, keywords: ["hexproof"] }),
      expect.objectContaining({ minLevel: 4, power: 3, toughness: 4, keywords: ["flying"] })
    ]);

    const levelAction = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.cardId === leveler.instance_id);
    expect(levelAction?.note).toBe("Level up {1}{U}");
    expect(levelAction?.action).toMatchObject({ type: "activate", abilityIndex: 0 });
    game = applyAction(game, 0, levelAction!.action);
    expect(game.stack.at(-1)?.activated?.effect).toEqual({ kind: "level-up" });
    game = applyAction(game, 0, { type: "pass" });
    expect(permanentNamed(game, 0, "Test Leveler")?.counters.level).toBe(1);
    expect(powerOf(permanentNamed(game, 0, "Test Leveler")!, game)).toBe(1);

    game = applyAction(game, 0, levelAction!.action);
    game = applyAction(game, 0, { type: "pass" });
    const second = permanentNamed(game, 0, "Test Leveler")!;
    expect(second.counters.level).toBe(2);
    expect(powerOf(second, game)).toBe(2);
    expect(toughnessOf(second, game)).toBe(3);
    expect(legalTargets(game, 1, "permanent")).not.toContainEqual({ kind: "permanent", instanceId: second.instance_id });
  });

  it("cycles a card from hand, pays mana, and draws", () => {
    let game = twoSeatGame([CYCLING_LAND()], []);
    game = stage(game, 0, (player) => ({
      autoPass: false,
      hand: toHand(0, [CYCLING_LAND()], "cycle-hand")
    }));
    game = putOnBattlefield(game, 0, [SWAMP()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);

    const cycling = game.players[0]!.hand[0]!;
    const libraryBefore = game.players[0]!.library.length;
    const offered = legalActions(game, 0).find((entry) => entry.action.type === "cycle" && entry.cardId === cycling.instance_id);
    expect(offered).toBeDefined();

    game = applyAction(game, 0, offered!.action);
    expect(game.players[0]!.hand).toHaveLength(1);
    expect(game.players[0]!.library).toHaveLength(libraryBefore - 1);
    expect(game.players[0]!.graveyard.some((card) => card.instance_id === cycling.instance_id)).toBe(true);
    expect(game.log.at(-1)?.text).toMatch(/cicla Barren Moor/i);
  });

  it("lets each player draw then choose their own discard for Geier Reach Sanitarium", () => {
    const profile = profileOf(GEIER_REACH_SANITARIUM());
    expect(profile.activatedAbilities[0]).toMatchObject({ effect: { kind: "each-player-draws-then-discards" } });

    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [GEIER_REACH_SANITARIUM(), SWAMP(), SWAMP()]);
    game = stage(game, 0, () => ({ autoPass: false, hand: toHand(0, [SOL_RING()], "sanitarium-hand-0"), library: toHand(0, [BEAR()], "sanitarium-lib-0") }));
    game = stage(game, 1, () => ({ autoPass: false, hand: toHand(1, [FLIER()], "sanitarium-hand-1"), library: toHand(1, [MOUNTAIN()], "sanitarium-lib-1") }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);

    const sanitarium = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Geier Reach Sanitarium")!;
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.action.sourceId === sanitarium.instance_id);
    expect(activation).toBeDefined();
    game = applyAction(game, 0, activation!.action);
    game = applyAction(game, 0, { type: "pass" });
    game = applyAction(game, 1, { type: "pass" });

    expect(game.players[0]!.hand.map((card) => card.name)).toEqual(expect.arrayContaining(["Sol Ring", "Grizzly Bears"]));
    expect(game.players[1]!.hand.map((card) => card.name)).toEqual(expect.arrayContaining(["Storm Crow", "Mountain"]));

    // Controller discards first (APNAP order), then the opponent.
    expect(game.pendingChoice).toMatchObject({ type: "discard-cards", seat: 0, remaining: 1 });
    game = applyAction(game, 0, { type: "choose-discard", sourceId: game.pendingChoice!.sourceId, cardId: "sanitarium-hand-0-0" });
    expect(game.pendingChoice).toMatchObject({ type: "discard-cards", seat: 1, remaining: 1 });
    game = applyAction(game, 1, { type: "choose-discard", sourceId: game.pendingChoice!.sourceId, cardId: "sanitarium-hand-1-0" });
    expect(game.pendingChoice).toBeNull();

    expect(game.players[0]!.hand.map((card) => card.name)).toEqual(["Grizzly Bears"]);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Sol Ring")).toBe(true);
    expect(game.players[1]!.hand.map((card) => card.name)).toEqual(["Mountain"]);
    expect(game.players[1]!.graveyard.some((card) => card.name === "Storm Crow")).toBe(true);
  });

  describe("fetch land (subtype search from an activated ability)", () => {
    const FLOODED_STRAND = () => make({
      name: "Flooded Strand", type_line: "Land",
      oracle_text: "{T}, Pay 1 life, Sacrifice this land: Search your library for a Plains or Island card, put it onto the battlefield, then shuffle."
    });
    const GODLESS_SHRINE = () => make({ name: "Godless Shrine", type_line: "Land — Plains Swamp", produced_mana: ["W", "B"] });

    it("parses the crack into a Plains/Island battlefield search", () => {
      expect(profileOf(FLOODED_STRAND()).activatedAbilities[0]).toMatchObject({
        sacrificesSelf: true, lifeCost: 1, requiresTap: true,
        effect: { kind: "search-library", types: [], subtypes: ["Plains", "Island"], destination: "battlefield" }
      });
    });

    it("finds a nonbasic land with the Plains subtype and offers it as a choice", () => {
      let game = readyOnBoard([FLOODED_STRAND()], { library: [GODLESS_SHRINE()], hold: true });
      const source = permanentNamed(game, 0, "Flooded Strand")!;
      game = applyAction(game, 0, { type: "activate", sourceId: source.instance_id, abilityIndex: 0 });
      game = applyAction(game, 0, { type: "pass" });
      game = passUntil(game, (state) => state.stack.length === 0);
      expect(game.pendingChoice).toMatchObject({ type: "search-library", seat: 0 });
      expect((game.pendingChoice as Extract<typeof game.pendingChoice, { type: "search-library" }>).optionIds).toHaveLength(1);
    });

    it("fails to find and shuffles when the library holds no legal target, with an unambiguous log", () => {
      let game = readyOnBoard([FLOODED_STRAND()], { library: [SWAMP(), MOUNTAIN(), FOREST()], hold: true });
      const source = permanentNamed(game, 0, "Flooded Strand")!;
      game = applyAction(game, 0, { type: "activate", sourceId: source.instance_id, abilityIndex: 0 });
      game = applyAction(game, 0, { type: "pass" });
      game = passUntil(game, (state) => state.stack.length === 0);
      expect(game.pendingChoice).toBeNull();
      expect(game.players[0]!.graveyard.some((card) => card.name === "Flooded Strand")).toBe(true);
      const last = game.log.at(-1)!.text;
      expect(last).toContain("Flooded Strand");
      expect(last).toMatch(/no encuentra ninguna carta|baraja su biblioteca/);
      expect(last).not.toContain("no hay una carta válida");
    });
  });
});


describe("commander rules", () => {
  it("puts Opal Palace counters on a commander cast with its mana", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ hand: [], commanderColorIdentity: ["G"] }));
    game = putOnBattlefield(game, 0, [OPAL_PALACE(), FOREST(), FOREST(), FOREST()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const palace = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Opal Palace")!;
    game = applyAction(game, 0, { type: "activate-mana", sourceId: palace.instance_id, abilityIndex: 1, mana: "G" });
    expect(game.players[0]!.commanderMana).toBe(1);
    const commanderId = game.players[0]!.commandZone[0]!.instance_id;
    game = applyAction(game, 0, { type: "cast", cardId: commanderId });
    const commander = game.players[0]!.battlefield.find((permanent) => permanent.isCommander)!;
    expect(commander.counters["+1/+1"]).toBe(1);
    expect(game.players[0]!.commanderMana).toBe(0);
  });

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
        tapped: false, summoningSick: false, enteredThisTurn: false, damage: 99, deathtouched: false, counters: {}, powerModifier: 0, toughnessModifier: 0, isCommander: true
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

describe("combat restrictions and landwalk", () => {
  const NO_BLOCKER = () => make({
    name: "Gutter Skulk", type_line: "Creature — Zombie", mana_cost: "{1}{B}", cmc: 2, power: "2", toughness: "2",
    oracle_text: "Gutter Skulk can't block."
  });
  const FLYING_ONLY_BLOCKER = () => make({
    name: "Cloud Sentry", type_line: "Creature — Wall", mana_cost: "{2}", cmc: 2, power: "1", toughness: "4",
    keywords: ["Reach"],
    oracle_text: "Reach\nCloud Sentry can block only creatures with flying."
  });
  const MUST_ATTACK = () => make({
    name: "Reckless Berserker", type_line: "Creature — Goblin", mana_cost: "{1}{R}", cmc: 2, power: "3", toughness: "1",
    oracle_text: "Reckless Berserker attacks each combat if able."
  });
  const SWAMPWALKER = () => make({
    name: "Bog Stalker", type_line: "Creature — Horror", mana_cost: "{2}{B}", cmc: 3, power: "2", toughness: "2",
    oracle_text: "Swampwalk"
  });
  const HORSEMAN = () => make({
    name: "Lu Xun, Scholar General", type_line: "Legendary Creature — Human Soldier", mana_cost: "{3}{U}", cmc: 4,
    power: "2", toughness: "2", keywords: ["Horsemanship"], oracle_text: "Horsemanship"
  });
  const HORSEMAN_BLOCKER = () => make({
    name: "River Rider", type_line: "Creature — Human", mana_cost: "{2}{U}", cmc: 3,
    power: "2", toughness: "2", keywords: ["Horsemanship"], oracle_text: "Horsemanship"
  });
  const SHADOWER = () => make({
    name: "Dauthi Slayer", type_line: "Creature — Dauthi Soldier", mana_cost: "{B}{B}", cmc: 2,
    power: "2", toughness: "2", keywords: ["Shadow"], oracle_text: "Shadow"
  });
  const SHADOW_BLOCKER = () => make({
    name: "Dauthi Horror", type_line: "Creature — Dauthi Horror", mana_cost: "{1}{B}", cmc: 2,
    power: "2", toughness: "1", keywords: ["Shadow"], oracle_text: "Shadow"
  });
  const EXALTED = () => make({
    name: "Noble Hierarch", type_line: "Creature — Human Druid", mana_cost: "{G}", cmc: 1,
    power: "0", toughness: "1", keywords: ["Exalted"], oracle_text: "Exalted"
  });
  const CRAWLSPACE = () => make({
    name: "Crawlspace", type_line: "Artifact", mana_cost: "{3}", cmc: 3,
    oracle_text: "No more than one creature can attack you each combat."
  });

  it("reads each restriction off the printed line", () => {
    expect(profileOf(NO_BLOCKER()).combatRules).toMatchObject({ cannotBlock: true, mustAttack: false });
    expect(profileOf(FLYING_ONLY_BLOCKER()).combatRules.blocksOnlyWithKeyword).toBe("flying");
    expect(profileOf(MUST_ATTACK()).combatRules.mustAttack).toBe(true);
    expect(profileOf(SWAMPWALKER()).combatRules.landwalk).toEqual(["swamp"]);
    expect(profileOf(CRAWLSPACE()).combatRules.maxAttackers).toBe(1);
    // A recognised restriction is not left over as unimplemented text.
    expect(profileOf(NO_BLOCKER()).fullyImplemented).toBe(true);
    expect(profileOf(SWAMPWALKER()).fullyImplemented).toBe(true);
    expect(profileOf(HORSEMAN()).keywords).toContain("horsemanship");
    expect(profileOf(HORSEMAN()).fullyImplemented).toBe(true);
    expect(profileOf(SHADOWER()).keywords).toContain("shadow");
    expect(profileOf(SHADOWER()).fullyImplemented).toBe(true);
    expect(profileOf(EXALTED()).triggers[0]).toMatchObject({
      event: "attacks", subject: "creature-you-control", condition: { kind: "attacking-alone" },
      effect: { kind: "modify-triggered-creature", power: 1, toughness: 1 }
    });
    expect(profileOf(EXALTED()).fullyImplemented).toBe(true);
    expect(profileOf(CRAWLSPACE()).fullyImplemented).toBe(true);
  });

  it("enforces a defender-controlled attacker limit", () => {
    let game = attackWith([BEAR(), FLIER()], [CRAWLSPACE()]);
    const bear = permanentNamed(game, 0, "Grizzly Bears");
    const flier = permanentNamed(game, 0, "Storm Crow");
    expect(() => applyAction(game, 0, {
      type: "declare-attackers",
      attackers: [
        { instanceId: bear.instance_id, defender: 1 },
        { instanceId: flier.instance_id, defender: 1 }
      ]
    })).toThrow(/más de 1 criatura/i);
    game = stage(game, 0, () => ({ autoPass: false }));
    game = stage(game, 1, () => ({ autoPass: false }));
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: bear.instance_id, defender: 1 }] });
    expect(game.combat.attackers).toHaveLength(1);
  });

  it("advances each defending player once in multiplayer combat", () => {
    let game = threeSeatGame();
    game = game.players.reduce((current, player) => stage(current, player.seat, () => ({ autoPass: false, hand: [] })), game);
    game = putOnBattlefield(game, 0, [BEAR(), BEAR()]);
    game = putOnBattlefield(game, 1, [BEAR()]);
    game = putOnBattlefield(game, 2, [BEAR()]);
    game = passUntil(game, (state) => state.step === "declare-attackers" && state.activeSeat === 0);
    const attackers = game.players[0]!.battlefield;
    game = applyAction(game, 0, {
      type: "declare-attackers",
      attackers: [
        { instanceId: attackers[0]!.instance_id, defender: 1 },
        { instanceId: attackers[1]!.instance_id, defender: 2 }
      ]
    });
    game = passUntil(game, (state) => state.step === "declare-blockers" && !state.combat.blockersDeclared);
    expect(defendersAwaitingBlocks(game)).toEqual([1, 2]);
    game = applyAction(game, 1, { type: "declare-blockers", blockers: [] });
    expect(defendersAwaitingBlocks(game)).toEqual([2]);
    expect(legalActions(game, 1)).toHaveLength(0);
    game = applyAction(game, 2, { type: "declare-blockers", blockers: [] });
    game = passUntil(game, (state) => state.step !== "declare-blockers");
    expect(game.step).not.toBe("declare-blockers");
  });

  /** Both seats staged, attackers already declared by seat 0. */
  function attackWith(attackers: CardData[], defenders: CardData[], defenderLands: CardData[] = []) {
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ hand: [] }));
    game = stage(game, 1, () => ({ hand: [] }));
    game = putOnBattlefield(game, 0, attackers);
    if (defenders.length) game = putOnBattlefield(game, 1, defenders);
    if (defenderLands.length) game = putOnBattlefield(game, 1, defenderLands);
    return passUntil(game, (state) => state.step === "declare-attackers" && state.activeSeat === 0);
  }

  function permanentNamed(game: GameState, seat: SeatId, name: string) {
    return game.players[seat]!.battlefield.find((permanent) => permanent.card.name === name)!;
  }

  it("keeps a creature that can't block out of the legal blockers", () => {
    let game = attackWith([BEAR()], [NO_BLOCKER(), WALL()]);
    const bear = permanentNamed(game, 0, "Grizzly Bears");
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: bear.instance_id, defender: 1 }] });
    const blockers = legalBlockers(game, 1).map((permanent) => permanent.card.name);
    expect(blockers).toContain("Stone Wall");
    expect(blockers).not.toContain("Gutter Skulk");
    const skulk = permanentNamed(game, 1, "Gutter Skulk");
    expect(() => applyAction(game, 1, { type: "declare-blockers", blockers: [{ instanceId: skulk.instance_id, attackerId: bear.instance_id }] }))
      .toThrow(/no puede bloquear/i);
  });

  it("lets a flying-only blocker stop a flier and nothing else", () => {
    let ground = attackWith([BEAR()], [FLYING_ONLY_BLOCKER()]);
    const bear = permanentNamed(ground, 0, "Grizzly Bears");
    ground = applyAction(ground, 0, { type: "declare-attackers", attackers: [{ instanceId: bear.instance_id, defender: 1 }] });
    expect(legalBlockers(ground, 1)).toHaveLength(0);

    let air = attackWith([FLIER()], [FLYING_ONLY_BLOCKER()]);
    const crow = permanentNamed(air, 0, "Storm Crow");
    air = applyAction(air, 0, { type: "declare-attackers", attackers: [{ instanceId: crow.instance_id, defender: 1 }] });
    expect(legalBlockers(air, 1).map((permanent) => permanent.card.name)).toEqual(["Cloud Sentry"]);
  });

  it("enforces fear: only black or artifact creatures may block", () => {
    let game = attackWith([FEARER()], [BEAR(), BLACK_BLOCKER(), ARTIFACT_BLOCKER()]);
    const fearer = permanentNamed(game, 0, "Fear Stalker");
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: fearer.instance_id, defender: 1 }] });
    expect(legalBlockers(game, 1).map((permanent) => permanent.card.name)).toEqual(["Dusk Bat", "Iron Construct"]);
  });

  it("refuses a declaration that leaves out a creature which must attack", () => {
    const game = attackWith([MUST_ATTACK(), BEAR()], []);
    const berserker = permanentNamed(game, 0, "Reckless Berserker");
    const bear = permanentNamed(game, 0, "Grizzly Bears");
    expect(() => applyAction(game, 0, { type: "declare-attackers", attackers: [] }))
      .toThrow(/ataca en cada combate/i);
    expect(() => applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: bear.instance_id, defender: 1 }] }))
      .toThrow(/ataca en cada combate/i);
    // Nobody owes a decision after the declaration, so the whole combat settles:
    // assert the attack actually happened rather than a mid-combat snapshot.
    const legal = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: berserker.instance_id, defender: 1 }] });
    expect(legal.log.some((entry) => entry.text.includes("ataca con Reckless Berserker"))).toBe(true);
    expect(legal.players[1]!.life).toBe(37);
  });

  it("does not require an attack from a creature that cannot make one", () => {
    // Summoning sickness makes the requirement inapplicable (CR 508.1d), so the
    // bear may attack alone and the sick berserker is not missing from anything.
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ hand: [] }));
    game = stage(game, 1, () => ({ hand: [] }));
    game = putOnBattlefield(game, 0, [BEAR()]);
    game = putOnBattlefield(game, 0, [MUST_ATTACK()], { sick: true });
    game = passUntil(game, (state) => state.step === "declare-attackers" && state.activeSeat === 0);
    expect(legalAttackers(game, 0).map((permanent) => permanent.card.name)).toEqual(["Grizzly Bears"]);
    const bear = permanentNamed(game, 0, "Grizzly Bears");
    const played = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: bear.instance_id, defender: 1 }] });
    expect(played.players[1]!.life).toBe(38);
  });

  it("makes a swampwalker unblockable only against a defender with a Swamp", () => {
    let dry = attackWith([SWAMPWALKER()], [BEAR()], [FOREST()]);
    const stalker = permanentNamed(dry, 0, "Bog Stalker");
    dry = applyAction(dry, 0, { type: "declare-attackers", attackers: [{ instanceId: stalker.instance_id, defender: 1 }] });
    expect(legalBlockers(dry, 1).map((permanent) => permanent.card.name)).toEqual(["Grizzly Bears"]);

    let wet = attackWith([SWAMPWALKER()], [BEAR()], [SWAMP()]);
    const walker = permanentNamed(wet, 0, "Bog Stalker");
    wet = applyAction(wet, 0, { type: "declare-attackers", attackers: [{ instanceId: walker.instance_id, defender: 1 }] });
    expect(legalBlockers(wet, 1)).toHaveLength(0);
    // The damage still lands because nothing could be declared as a blocker.
    wet = passUntil(wet, (state) => state.players[1]!.life < 40);
    expect(wet.players[1]!.life).toBe(38);
  });

  it("requires horsemanship to block a horsemanship attacker", () => {
    let game = attackWith([HORSEMAN()], [BEAR(), HORSEMAN_BLOCKER()]);
    const attacker = permanentNamed(game, 0, "Lu Xun, Scholar General");
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: attacker.instance_id, defender: 1 }] });
    expect(legalBlockers(game, 1).map((permanent) => permanent.card.name)).toEqual(["River Rider"]);
  });

  it("allows shadow combat only between creatures with shadow", () => {
    let shadowGame = attackWith([SHADOWER()], [BEAR(), SHADOW_BLOCKER()]);
    const shadowAttacker = permanentNamed(shadowGame, 0, "Dauthi Slayer");
    shadowGame = applyAction(shadowGame, 0, { type: "declare-attackers", attackers: [{ instanceId: shadowAttacker.instance_id, defender: 1 }] });
    expect(legalBlockers(shadowGame, 1).map((permanent) => permanent.card.name)).toEqual(["Dauthi Horror"]);

    let groundGame = attackWith([BEAR()], [SHADOW_BLOCKER()]);
    const groundAttacker = permanentNamed(groundGame, 0, "Grizzly Bears");
    groundGame = applyAction(groundGame, 0, { type: "declare-attackers", attackers: [{ instanceId: groundAttacker.instance_id, defender: 1 }] });
    expect(legalBlockers(groundGame, 1)).toHaveLength(0);
  });

  it("pumps only the sole attacker for Exalted", () => {
    let alone = attackWith([EXALTED()], []);
    const exalted = permanentNamed(alone, 0, "Noble Hierarch");
    alone = applyAction(alone, 0, { type: "declare-attackers", attackers: [{ instanceId: exalted.instance_id, defender: 1 }] });
    alone = passUntil(alone, (state) => state.stack.length === 0 && state.triggerQueue.length === 0
      && state.players[0]!.battlefield.find((permanent) => permanent.instance_id === exalted.instance_id)?.powerModifier === 1);
    expect(alone.players[0]!.battlefield.find((permanent) => permanent.instance_id === exalted.instance_id)?.toughnessModifier).toBe(1);

    let together = attackWith([EXALTED(), BEAR()], []);
    const exaltedTogether = permanentNamed(together, 0, "Noble Hierarch");
    const bear = permanentNamed(together, 0, "Grizzly Bears");
    together = applyAction(together, 0, { type: "declare-attackers", attackers: [
      { instanceId: exaltedTogether.instance_id, defender: 1 }, { instanceId: bear.instance_id, defender: 1 }
    ] });
    expect(together.stack.some((entry) => entry.trigger?.definition.sourceText === "Exalted")).toBe(false);
  });
});


describe("combat", () => {
  function atAttackers(attacker: CardData[], defender: CardData[]) {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, attacker);
    game = putOnBattlefield(game, 1, defender);
    return passUntil(game, (state) => state.step === "declare-attackers" && !state.combat.attackersDeclared);
  }

  it("keeps identical generated tokens independently selectable in combat", () => {
    let game = putOnBattlefield(twoSeatGame([], []), 0, [FOREST(), FOREST(), FOREST(), FOREST()]);
    game = stage(game, 0, () => ({ hand: toHand(0, [PLANT_SPELL()]) }));
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    const plants = game.players[0]!.battlefield.filter((permanent) => permanent.card.name === "Plant");
    expect(plants).toHaveLength(3);
    expect(new Set(plants.map((permanent) => permanent.instance_id)).size).toBe(3);
    game = stage(game, 0, (player) => ({ battlefield: player.battlefield.map((permanent) => ({ ...permanent, summoningSick: false })) }));
    game = stage(game, 0, () => ({ autoPass: false }));
    game = stage(game, 1, () => ({ autoPass: false }));
    game = passUntil(game, (state) => state.step === "declare-attackers" && !state.combat.attackersDeclared);
    const chosen = plants[1]!;
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: chosen.instance_id, defender: 1 }] });
    expect(game.combat.attackers).toEqual([{ instanceId: chosen.instance_id, defender: 1 }]);
    expect(game.players[0]!.battlefield.filter((permanent) => permanent.card.name === "Plant")).toHaveLength(3);
  });

  it("swaps Serene Master's power with the creature it blocks until combat ends", () => {
    const serene = SERENE_MASTER();
    expect(profileOf(serene).fullyImplemented).toBe(true);
    let game = atAttackers([TRAMPLER()], [serene]);
    game = { ...game, players: game.players.map((player) => ({ ...player, autoPass: false })) };
    const attacker = game.players[0]!.battlefield[0]!;
    const blocker = game.players[1]!.battlefield[0]!;
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: attacker.instance_id, defender: 1 }] });
    game = passUntil(game, (state) => state.step === "declare-blockers" && !state.combat.blockersDeclared);
    game = applyAction(game, 1, { type: "declare-blockers", blockers: [{ instanceId: blocker.instance_id, attackerId: attacker.instance_id }] });
    expect(game.stack.at(-1)?.targets).toEqual([{ kind: "permanent", instanceId: attacker.instance_id }]);
    game = passUntil(game, (state) => state.step === "declare-blockers" && state.combat.blockersDeclared && state.stack.length === 0);
    const activeBlocker = game.players[1]!.battlefield.find((permanent) => permanent.instance_id === blocker.instance_id)!;
    expect(powerOf(activeBlocker, game)).toBe(6);
    expect(powerOf(game.players[0]!.battlefield[0]!, game)).toBe(0);
    game = passUntil(game, (state) => state.step === "end-combat" && state.combat.attackers.length === 0);
    expect(powerOf(game.players[1]!.battlefield.find((permanent) => permanent.instance_id === blocker.instance_id)!, game)).toBe(0);
  });

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

  it("lets Edric optionally draw after combat damage to an opponent", () => {
    let game = atAttackers([EDRIC(), BEAR()], []);
    const attacker = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    const beforeHand = game.players[0]!.hand.length;
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: attacker.instance_id, defender: 1 }] });
    game = passUntil(game, (state) => state.pendingChoice?.type === "optional-trigger");
    const choice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "optional-trigger" }>;
    expect(choice.sourceCard.name).toBe("Edric, Spymaster of Trest");
    game = applyAction(game, 0, { type: "choose-trigger", sourceId: choice.sourceId, accept: true });
    expect(game.players[0]!.hand.length).toBe(beforeHand + 1);
  });

  it("returns every own creature card that died this turn with Fell Shepherd", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ hand: toHand(0, [BOLT()]) }));
    game = putOnBattlefield(game, 0, [FELL_SHEPHERD(), BEAR(), MOUNTAIN()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.prioritySeat === 0);
    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: bear.instance_id }] });
    game = passUntil(game, (state) => state.players[0]!.graveyard.some((card) => card.name === "Grizzly Bears"));
    game = passUntil(game, (state) => state.step === "declare-attackers" && !state.combat.attackersDeclared);
    const shepherd = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Fell Shepherd")!;
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: shepherd.instance_id, defender: 1 }] });
    game = passUntil(game, (state) => state.pendingChoice?.type === "optional-trigger");
    const choice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "optional-trigger" }>;
    expect(choice.sourceCard.name).toBe("Fell Shepherd");
    game = applyAction(game, 0, { type: "choose-trigger", sourceId: choice.sourceId, accept: true });
    expect(game.players[0]!.hand.some((card) => card.name === "Grizzly Bears")).toBe(true);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(false);
  });
  it("draws Diviner Spirit's combat damage amount for both players", () => {
    let game = atAttackers([DIVINER_SPIRIT()], []);
    const attacker = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Diviner Spirit")!;
    const beforeController = game.players[0]!.hand.length;
    const beforeDamaged = game.players[1]!.hand.length;
    expect(profileOf(DIVINER_SPIRIT()).triggers[0]).toMatchObject({
      event: "deals-combat-damage-to-player", subject: "self", effect: { kind: "draw-combat-damage-participants" }, targetKind: "none"
    });

    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: attacker.instance_id, defender: 1 }] });
    game = passUntil(game, (state) => state.step === "postcombat-main" || state.turn > 1);

    expect(game.players[0]!.hand.length).toBe(beforeController + 2);
    expect(game.players[1]!.hand.length).toBe(beforeDamaged + 2);
  });

  it("reveals the top card, puts it into hand, and gains its mana value", () => {
    const revealed = make({ name: "Revealed Relic", type_line: "Artifact", mana_cost: "{3}{G}", cmc: 4 });
    let game = atAttackers([AUGURY_ADEPT()], []);
    game = stage(game, 0, () => ({ library: toHand(0, [revealed], "library") }));
    const adept = game.players[0]!.battlefield[0]!;
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: adept.instance_id, defender: 1 }] });
    game = passUntil(game, (state) => state.step === "postcombat-main" || state.turn > 1);
    expect(game.players[0]!.hand.some((card) => card.name === "Revealed Relic")).toBe(true);
    expect(game.players[0]!.life).toBe(44);
    expect(game.players[0]!.library).toHaveLength(0);
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

  it("prevents one creature combat damage while Thunderstaff is untapped", () => {
    expect(profileOf(THUNDERSTAFF()).combatRules.preventsCombatDamageToController).toBe(1);
    expect(profileOf(THUNDERSTAFF()).fullyImplemented).toBe(true);

    let game = atAttackers([BEAR()], [THUNDERSTAFF()]);
    const bear = game.players[0]!.battlefield[0]!;
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: bear.instance_id, defender: 1 }] });
    game = passUntil(game, (state) => state.step === "postcombat-main" || state.turn > 1);
    expect(game.players[1]!.life).toBe(39);

    game = atAttackers([BEAR()], [THUNDERSTAFF()]);
    game = stage(game, 1, (player) => ({ battlefield: player.battlefield.map((permanent) => ({ ...permanent, tapped: true })) }));
    const tappedBear = game.players[0]!.battlefield[0]!;
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: tappedBear.instance_id, defender: 1 }] });
    game = passUntil(game, (state) => state.step === "postcombat-main" || state.turn > 1);
    expect(game.players[1]!.life).toBe(38);
  });

  it("enforces protection from red for targets, blocking, and combat damage", () => {
    const sphinx = SPHINX_OF_THE_STEEL_WIND();
    const redRaider = RED_RAIDER();
    expect(profileOf(sphinx).protectionFrom).toEqual(["R", "G"]);
    expect(profileOf(sphinx).fullyImplemented).toBe(true);

    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 1, [sphinx]);
    game = putOnBattlefield(game, 0, [redRaider]);
    expect(legalTargets(game, 0, "creature", profileOf(redRaider)))
      .not.toContainEqual({ kind: "permanent", instanceId: game.players[1]!.battlefield[0]!.instance_id });

    game = atAttackers([sphinx], [redRaider]);
    const sphinxId = game.players[0]!.battlefield[0]!.instance_id;
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: sphinxId, defender: 1 }] });
    game = passUntil(game, (state) => state.step === "declare-blockers" && !state.combat.blockersDeclared);
    expect(legalBlockers(game, 1)).toHaveLength(0);

    game = atAttackers([redRaider], [sphinx]);
    const raiderId = game.players[0]!.battlefield[0]!.instance_id;
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: raiderId, defender: 1 }] });
    game = passUntil(game, (state) => state.step === "declare-blockers" && !state.combat.blockersDeclared);
    const sphinxIdAsBlocker = game.players[1]!.battlefield[0]!.instance_id;
    game = applyAction(game, 1, { type: "declare-blockers", blockers: [{ instanceId: sphinxIdAsBlocker, attackerId: raiderId }] });
    game = passUntil(game, (state) => state.step === "end-combat" || state.turn > 1);
    expect(game.players[0]!.battlefield).toHaveLength(0);
    expect(game.players[1]!.battlefield[0]!.damage).toBe(0);
  });

  it("prevents combat damage dealt to Guard Gomazoa without preventing its own damage", () => {
    const profile = profileOf(GUARD_GOMAZOA());
    expect(profile.combatRules.preventsAllCombatDamageToSelf).toBe(true);
    expect(profile.fullyImplemented).toBe(true);
    let game = atAttackers([TRAMPLER()], [GUARD_GOMAZOA()]);
    const attacker = game.players[0]!.battlefield[0]!;
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: attacker.instance_id, defender: 1 }] });
    game = passUntil(game, (state) => state.step === "declare-blockers" && !state.combat.blockersDeclared);
    const blocker = game.players[1]!.battlefield[0]!;
    game = applyAction(game, 1, { type: "declare-blockers", blockers: [{ instanceId: blocker.instance_id, attackerId: attacker.instance_id }] });
    game = passUntil(game, (state) => state.step === "end-combat" || state.turn > 1);
    expect(game.players[1]!.battlefield[0]!.damage).toBe(0);
    expect(game.players[1]!.life).toBe(37);
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

  it("grants first strike only on its controller's own turn", () => {
    const profile = profileOf(FIRST_STRIKE_ON_YOUR_TURN());
    expect(profile.keywordsDuringYourTurn).toEqual(["first strike"]);
    expect(profile.fullyImplemented).toBe(true);

    // Attacking on its own turn: first strike applies, same as a plain
    // first striker.
    let attacking = atAttackers([FIRST_STRIKE_ON_YOUR_TURN()], [BEAR()]);
    const attacker = attacking.players[0]!.battlefield[0]!.instance_id;
    attacking = applyAction(attacking, 0, { type: "declare-attackers", attackers: [{ instanceId: attacker, defender: 1 }] });
    attacking = passUntil(attacking, (state) => state.step === "declare-blockers" && !state.combat.blockersDeclared);
    const blocker = attacking.players[1]!.battlefield[0]!.instance_id;
    attacking = applyAction(attacking, 1, { type: "declare-blockers", blockers: [{ instanceId: blocker, attackerId: attacker }] });
    attacking = passUntil(attacking, (state) => state.step === "end-combat" || state.turn > 1);
    expect(attacking.players[1]!.battlefield).toHaveLength(0);
    expect(attacking.players[0]!.battlefield).toHaveLength(1);

    // Blocking on the opponent's turn: no first strike, so both creatures
    // trade in the regular damage step instead of the source surviving.
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [FIRST_STRIKE_ON_YOUR_TURN()]);
    game = putOnBattlefield(game, 1, [BEAR()]);
    game = passUntil(game, (state) => state.activeSeat === 1 && state.step === "declare-attackers" && !state.combat.attackersDeclared);
    const defender = game.players[0]!.battlefield[0]!.instance_id;
    const foeAttacker = game.players[1]!.battlefield[0]!.instance_id;
    game = applyAction(game, 1, { type: "declare-attackers", attackers: [{ instanceId: foeAttacker, defender: 0 }] });
    game = passUntil(game, (state) => state.step === "declare-blockers" && !state.combat.blockersDeclared);
    game = applyAction(game, 0, { type: "declare-blockers", blockers: [{ instanceId: defender, attackerId: foeAttacker }] });
    game = passUntil(game, (state) => state.step === "end-combat" || state.turn > 2);
    expect(game.players[0]!.battlefield).toHaveLength(0);
    expect(game.players[1]!.battlefield).toHaveLength(0);
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
        tapped: false, summoningSick: false, enteredThisTurn: false, damage: 0, deathtouched: false, counters: {}, powerModifier: 0, toughnessModifier: 0, isCommander: true
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

  it("amplifies a red source's damage to an opponent, but not to its own controller or from off-color sources", () => {
    const profile = profileOf(DAMAGE_AMPLIFIER());
    expect(profile.damageAmplify).toEqual({ colorFilter: "R", excludesSelf: false, scope: "opponent", amount: 2 });
    expect(profile.fullyImplemented).toBe(true);

    // Combat damage: the amplifier itself is a red source, so no self-exclusion applies.
    let game = atAttackers([DAMAGE_AMPLIFIER()], []);
    const attacker = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Test Torbran")!;
    const before = game.players[1]!.life;
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: attacker.instance_id, defender: 1 }] });
    expect(game.players[1]!.life).toBe(before - 4); // 2 power + 2 bonus

    // A red spell targeting the opponent is amplified too; a blue spell is not.
    let spellGame = twoSeatGame([], []);
    spellGame = putOnBattlefield(spellGame, 0, [DAMAGE_AMPLIFIER(), MOUNTAIN(), ISLAND()]);
    spellGame = stage(spellGame, 0, () => ({ hand: toHand(0, [RED_BOLT(), BLUE_BOLT()]) }));
    spellGame = passUntil(spellGame, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const life1 = spellGame.players[1]!.life;
    spellGame = applyAction(spellGame, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 1 }] });
    spellGame = passUntil(spellGame, (state) => state.stack.length === 0);
    expect(spellGame.players[1]!.life).toBe(life1 - 5); // 3 + 2 amplified (red)
    const life1After = spellGame.players[1]!.life;
    spellGame = applyAction(spellGame, 0, { type: "cast", cardId: "hand-1", targets: [{ kind: "player", seat: 1 }] });
    spellGame = passUntil(spellGame, (state) => state.stack.length === 0);
    expect(spellGame.players[1]!.life).toBe(life1After - 3); // blue: not amplified

    // Damage the amplifier's own controller deals to themselves is never amplified.
    let selfGame = twoSeatGame([], []);
    selfGame = putOnBattlefield(selfGame, 0, [DAMAGE_AMPLIFIER(), MOUNTAIN()]);
    selfGame = stage(selfGame, 0, () => ({ hand: toHand(0, [RED_BOLT()]) }));
    selfGame = passUntil(selfGame, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const ownLife = selfGame.players[0]!.life;
    selfGame = applyAction(selfGame, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 0 }] });
    expect(selfGame.players[0]!.life).toBe(ownLife - 3); // no amplification against self
  });

  it("amplifies noncombat damage by the source's own power, but leaves combat damage untouched", () => {
    const profile = profileOf(NONCOMBAT_ONLY_AMPLIFIER());
    expect(profile.damageAmplify).toEqual({ excludesSelf: false, scope: "opponent", amount: "source-power", noncombatOnly: true });
    expect(profile.fullyImplemented).toBe(true);

    // Noncombat: a spell dealing damage to the opponent gets +3 (the amplifier's own power).
    let spellGame = twoSeatGame([], []);
    spellGame = putOnBattlefield(spellGame, 0, [NONCOMBAT_ONLY_AMPLIFIER(), MOUNTAIN()]);
    spellGame = stage(spellGame, 0, () => ({ hand: toHand(0, [RED_BOLT()]) }));
    spellGame = passUntil(spellGame, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const life1 = spellGame.players[1]!.life;
    spellGame = applyAction(spellGame, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 1 }] });
    spellGame = passUntil(spellGame, (state) => state.stack.length === 0);
    expect(spellGame.players[1]!.life).toBe(life1 - 6); // 3 (Bolt) + 3 (source's own power)

    // Combat damage from the same creature is never amplified, unlike Torbran.
    let combatGame = atAttackers([NONCOMBAT_ONLY_AMPLIFIER()], []);
    const attacker = combatGame.players[0]!.battlefield.find((permanent) => permanent.card.name === "Test Hawkeye")!;
    const before = combatGame.players[1]!.life;
    combatGame = applyAction(combatGame, 0, { type: "declare-attackers", attackers: [{ instanceId: attacker.instance_id, defender: 1 }] });
    expect(combatGame.players[1]!.life).toBe(before - 3); // just its own power, no amplification
  });
});

describe("Mjölnir, Hammer of Thor", () => {
  it("restricts Equip to a worthy creature and doubles its unblocked combat damage", () => {
    const profile = profileOf(MJOLNIR());
    expect(profile.equipWorthyCost?.raw).toBe("{1}");
    expect(profile.equipCost).toBeNull();
    expect(profile.doublesEquippedCreatureDamage).toBe(true);
    expect(profile.fullyImplemented).toBe(true);

    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [MJOLNIR(), WORTHY_CREATURE(), BEAR(), MOUNTAIN()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);

    const equipment = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Mjölnir, Hammer of Thor")!;
    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    const worthy = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Test Worthy Avenger")!;

    // Grizzly Bears is not legendary and not red/white: "Equip worthy" refuses it.
    expect(legalActions(game, 0).some((entry) => entry.action.type === "equip" && entry.cardId === equipment.instance_id)).toBe(true);
    expect(() => applyAction(game, 0, { type: "equip", sourceId: equipment.instance_id, targetId: bear.instance_id }))
      .toThrow("Equip necesita una criatura digna que controles.");

    game = applyAction(game, 0, { type: "equip", sourceId: equipment.instance_id, targetId: worthy.instance_id });
    game = applyAction(game, 0, { type: "pass" });
    expect(game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Mjölnir, Hammer of Thor")?.attachedTo).toBe(worthy.instance_id);

    game = passUntil(game, (state) => state.step === "declare-attackers" && !state.combat.attackersDeclared);
    const attacker = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Test Worthy Avenger")!;
    const lifeBefore = game.players[1]!.life;
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: attacker.instance_id, defender: 1 }] });
    game = passUntil(game, (state) => state.step === "end-combat" || state.turn > 1);
    expect(game.players[1]!.life).toBe(lifeBefore - 4); // 2 power doubled by Mjölnir, unblocked
  });

  it("discards itself to pay for its {2}{R} board-wipe activated ability", () => {
    const profile = profileOf(MJOLNIR());
    expect(profile.activatedAbilities[0]).toMatchObject({
      sourceZone: "hand", discardsSelf: true, effect: { kind: "damage-all-creatures", amount: 2 }
    });
    expect(profile.fullyImplemented).toBe(true);

    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [MOUNTAIN(), MOUNTAIN(), MOUNTAIN(), BEAR()]);
    game = putOnBattlefield(game, 1, [BEAR()]);
    game = stage(game, 0, () => ({ hand: toHand(0, [MJOLNIR()]) }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);

    const source = game.players[0]!.hand[0]!;
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.cardId === source.instance_id)!;
    expect(activation).toBeDefined();
    game = applyAction(game, 0, activation.action);
    expect(game.players[0]!.hand).toHaveLength(0);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Mjölnir, Hammer of Thor")).toBe(true);
    game = passUntil(game, (state) => state.stack.length === 0);

    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Grizzly Bears")).toBe(false);
    expect(game.players[1]!.battlefield.some((permanent) => permanent.card.name === "Grizzly Bears")).toBe(false);
  });
});

describe("Wizard Class", () => {
  it("gates its level-2 and level-3 abilities behind the Class's current level", () => {
    const profile = profileOf(WIZARD_CLASS());
    expect(profile.noMaximumHandSize).toBe(true);
    expect(profile.classLevels).toMatchObject([
      { level: 2, cost: { raw: "{2}{U}" } },
      { level: 3, cost: { raw: "{4}{U}" } }
    ]);
    expect(profile.fullyImplemented).toBe(true);

    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [WIZARD_CLASS(), BEAR(), ...Array.from({ length: 10 }, () => ISLAND())]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);

    const wizardClass = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Wizard Class")!;
    // Only the level-2 ability is legal while the Class is at level 1.
    const level2Options = legalActions(game, 0).filter((entry) => entry.action.type === "activate" && entry.cardId === wizardClass.instance_id);
    expect(level2Options).toHaveLength(1);
    expect(level2Options[0]!.note).toBe("{2}{U}: Level 2");

    const handBefore = game.players[0]!.hand.length;
    game = applyAction(game, 0, level2Options[0]!.action);
    game = passUntil(game, (state) => state.triggerQueue.length === 0 && state.stack.length === 0);
    expect(game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Wizard Class")?.classLevel).toBe(2);
    // "When this Class becomes level 2, draw two cards."
    expect(game.players[0]!.hand.length).toBe(handBefore + 2);

    // The level-2 ability is gone now (already used); only level 3 remains.
    const level3Options = legalActions(game, 0).filter((entry) => entry.action.type === "activate" && entry.cardId === wizardClass.instance_id);
    expect(level3Options).toHaveLength(1);
    expect(level3Options[0]!.note).toBe("{4}{U}: Level 3");

    game = applyAction(game, 0, level3Options[0]!.action);
    game = passUntil(game, (state) => state.triggerQueue.length === 0 && state.stack.length === 0);
    expect(game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Wizard Class")?.classLevel).toBe(3);
    expect(legalActions(game, 0).some((entry) => entry.action.type === "activate" && entry.cardId === wizardClass.instance_id)).toBe(false);

    // Level 3's "whenever you draw a card" trigger is inert before level 3 (it already
    // drew twice above without adding any counters) and live only from here on. A trivial
    // board auto-passes straight through the intervening draw step, so wait for the next
    // time this seat is back in its OWN precombat main instead of trying to catch "draw"
    // itself — by then this turn's one mandatory draw has already happened exactly once.
    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    expect(bear.counters["+1/+1"]).toBeUndefined();
    const turnAfterLevel3 = game.turn;
    game = passUntil(game, (state) => state.turn > turnAfterLevel3 && state.activeSeat === 0 && state.step === "precombat-main");
    game = passUntil(game, (state) => state.triggerQueue.length === 0 && state.stack.length === 0);
    if (game.pendingChoice?.type === "trigger-target") {
      game = applyAction(game, 0, { type: "choose-trigger-target", sourceId: game.pendingChoice.sourceId, target: { kind: "permanent", instanceId: bear.instance_id } });
      game = passUntil(game, (state) => state.triggerQueue.length === 0 && state.stack.length === 0);
    }
    expect(game.players[0]!.battlefield.find((permanent) => permanent.instance_id === bear.instance_id)?.counters["+1/+1"]).toBe(1);
  });
});

describe("Black Market Connections", () => {
  it("offers all seven mode combinations at its controller's own first main phase, not the opponent's", () => {
    const profile = profileOf(BLACK_MARKET_CONNECTIONS());
    expect(profile.triggers[0]).toMatchObject({ event: "first-main-phase", subject: "you", targetKind: "none" });
    expect(profile.triggers[0]!.modalEffects).toHaveLength(7);
    expect(profile.fullyImplemented).toBe(true);

    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [BLACK_MARKET_CONNECTIONS()]);
    game = passUntil(game, (state) => state.pendingChoice?.type === "trigger-mode");
    const choice = game.pendingChoice;
    if (choice?.type !== "trigger-mode") throw new Error("expected a trigger-mode choice");
    expect(choice.options).toHaveLength(7);
    expect(game.activeSeat).toBe(0);

    // Clear this turn's mandatory choice, then confirm the same trigger does
    // not also fire during the opponent's first main phase.
    const sellOnly = choice.options.find((option) => option.text.startsWith("Sell Contraband") && !option.text.includes(";"))!;
    game = applyAction(game, 0, { type: "choose-trigger-mode", sourceId: choice.sourceId, optionIndex: sellOnly.index });
    game = passUntil(game, (state) => state.triggerQueue.length === 0 && state.stack.length === 0);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 1);
    expect(game.pendingChoice?.type).not.toBe("trigger-mode");
  });

  it("resolves a single chosen mode and its life cost", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [BLACK_MARKET_CONNECTIONS()]);
    game = passUntil(game, (state) => state.pendingChoice?.type === "trigger-mode");
    const choice = game.pendingChoice;
    if (choice?.type !== "trigger-mode") throw new Error("expected a trigger-mode choice");
    const sellOnly = choice.options.find((option) => option.text.startsWith("Sell Contraband") && !option.text.includes(";"))!;

    const lifeBefore = game.players[0]!.life;
    const treasuresBefore = game.players[0]!.battlefield.filter((permanent) => permanent.card.name === "Treasure").length;
    game = applyAction(game, 0, { type: "choose-trigger-mode", sourceId: choice.sourceId, optionIndex: sellOnly.index });
    game = passUntil(game, (state) => state.triggerQueue.length === 0 && state.stack.length === 0);
    expect(game.players[0]!.battlefield.filter((permanent) => permanent.card.name === "Treasure")).toHaveLength(treasuresBefore + 1);
    expect(game.players[0]!.life).toBe(lifeBefore - 1);
  });

  it("applies every effect and every life cost when multiple modes are chosen together", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [BLACK_MARKET_CONNECTIONS()]);
    game = passUntil(game, (state) => state.pendingChoice?.type === "trigger-mode");
    const choice = game.pendingChoice;
    if (choice?.type !== "trigger-mode") throw new Error("expected a trigger-mode choice");
    const sellAndBuy = choice.options.find((option) =>
      option.text.startsWith("Sell Contraband") && option.text.includes("Buy Information") && !option.text.includes("Hire"))!;

    const lifeBefore = game.players[0]!.life;
    const handBefore = game.players[0]!.hand.length;
    game = applyAction(game, 0, { type: "choose-trigger-mode", sourceId: choice.sourceId, optionIndex: sellAndBuy.index });
    game = passUntil(game, (state) => state.triggerQueue.length === 0 && state.stack.length === 0);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Treasure")).toBe(true);
    expect(game.players[0]!.hand).toHaveLength(handBefore + 1);
    expect(game.players[0]!.life).toBe(lifeBefore - 3); // 1 (Sell Contraband) + 2 (Buy Information)
  });
});

describe("Notion Thief", () => {
  it("redirects an opponent's non-draw-step draw to itself without touching either library's cards", () => {
    const profile = profileOf(NOTION_THIEF());
    expect(profile.redirectsOpponentDrawsExceptFirst).toBe(true);
    expect(profile.keywords).toContain("flash");
    expect(profile.fullyImplemented).toBe(true);

    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [NOTION_THIEF()]);
    game = putOnBattlefield(game, 1, [LAND_SAC_ALTAR()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 1 && state.prioritySeat === 1);

    const altar = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Land Memory")!;
    const activation = legalActions(game, 1).find((entry) => entry.action.type === "activate" && entry.cardId === altar.instance_id)!;
    const libraryBefore1 = game.players[1]!.library.length;
    const handBefore1 = game.players[1]!.hand.length;
    const libraryBefore0 = game.players[0]!.library.length;
    const handBefore0 = game.players[0]!.hand.length;
    game = applyAction(game, 1, activation.action);
    game = passUntil(game, (state) => state.stack.length === 0);

    // The opponent's draw is skipped entirely: no change beyond the sacrifice cost.
    expect(game.players[1]!.library.length).toBe(libraryBefore1);
    expect(game.players[1]!.hand.length).toBe(handBefore1);
    // Notion Thief's controller draws instead, from their OWN library.
    expect(game.players[0]!.library.length).toBe(libraryBefore0 - 1);
    expect(game.players[0]!.hand.length).toBe(handBefore0 + 1);
  });

  it("does not redirect the opponent's own mandatory draw-step draw", () => {
    // A trivial board auto-passes straight through "upkeep"/"draw" without
    // ever pausing there, so anchor on precombat-main (always a real
    // decision point) instead, one turn apart to bracket exactly one draw.
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [NOTION_THIEF()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const handBefore1 = game.players[1]!.hand.length;
    const handBefore0 = game.players[0]!.hand.length;
    const turnBefore = game.turn;
    game = passUntil(game, (state) => state.turn > turnBefore && state.activeSeat === 1 && state.step === "precombat-main");
    expect(game.players[1]!.hand.length).toBe(handBefore1 + 1);
    expect(game.players[0]!.hand.length).toBe(handBefore0);
  });
});

describe("Gitaxian Probe", () => {
  it("shows the caster (and only the caster) the target's hand, then draws a card", () => {
    const profile = profileOf(GITAXIAN_PROBE());
    expect(profile.effects).toMatchObject([{ kind: "look-at-target-players-hand" }, { kind: "draw", amount: 1 }]);
    expect(profile.targetKind).toBe("player");
    expect(profile.fullyImplemented).toBe(true);

    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ hand: toHand(0, [GITAXIAN_PROBE()]) }));
    game = stage(game, 1, () => ({ hand: toHand(1, [BEAR(), FOREST()], "foe") }));
    game = putOnBattlefield(game, 0, [ISLAND()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);

    const libraryBefore = game.players[0]!.library.length;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 1 }] });

    // The private view opens for the caster only, before anyone gets to act again.
    expect(game.pendingChoice?.type).toBe("view-hand");
    const casterView = projectGame(game, 0);
    expect(casterView.viewedHand?.targetSeat).toBe(1);
    expect(casterView.viewedHand?.cards.map((card) => card.name).sort()).toEqual(["Forest", "Grizzly Bears"]);
    expect(game.players[0]!.library.length).toBe(libraryBefore - 1); // "Draw a card" already resolved

    // Nobody else's projection ever includes it — not even the target's own.
    expect(projectGame(game, 1).viewedHand).toBeNull();

    // Closing the view sends the spell to the graveyard.
    const acknowledge = legalActions(game, 0).find((entry) => entry.action.type === "acknowledge-view-hand")!;
    expect(acknowledge).toBeDefined();
    game = applyAction(game, 0, acknowledge.action);
    expect(game.pendingChoice).toBeNull();
    expect(game.players[0]!.graveyard.some((card) => card.name === "Gitaxian Probe")).toBe(true);
  });
});

describe("Reforge the Soul", () => {
  it("offers Miracle only as the first card drawn that turn, and resolves at its reduced cost", () => {
    const profile = profileOf(REFORGE_THE_SOUL());
    expect(profile.miracleCost?.raw).toBe("{1}{R}");
    expect(profile.fullyImplemented).toBe(true);

    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 1, [MOUNTAIN(), MOUNTAIN()]);
    game = stage(game, 1, (player) => ({ library: [...toHand(1, [REFORGE_THE_SOUL()], "reforge-top"), ...player.library] }));
    game = passUntil(game, (state) => state.pendingChoice?.type === "miracle");

    const choice = game.pendingChoice;
    if (choice?.type !== "miracle") throw new Error("expected a miracle choice");
    expect(choice.seat).toBe(1);
    expect(choice.sourceCard.name).toBe("Reforge the Soul");

    game = applyAction(game, 1, { type: "cast-miracle", sourceId: choice.sourceId });
    game = passUntil(game, (state) => state.stack.length === 0);

    // "Each player discards their hand, then draws seven cards" — both end at 7 regardless of starting size.
    expect(game.players[0]!.hand).toHaveLength(7);
    expect(game.players[1]!.hand).toHaveLength(7);
    expect(game.players[1]!.graveyard.some((card) => card.name === "Reforge the Soul")).toBe(true);
  });

  it("does not offer Miracle when the card isn't the first draw of the turn", () => {
    // seat0 is the starting player, whose very first draw step is skipped
    // entirely (CR 103.7a) — use seat1 so the mandatory draw-step draw
    // actually happens and consumes the decoy card first.
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 1, [LAND_SAC_ALTAR(), MOUNTAIN()]);
    game = stage(game, 1, (player) => ({ library: [...toHand(1, [FOREST(), REFORGE_THE_SOUL()], "not-first-draw"), ...player.library] }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 1 && state.prioritySeat === 1);

    const altar = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Land Memory")!;
    const activation = legalActions(game, 1).find((entry) => entry.action.type === "activate" && entry.cardId === altar.instance_id)!;
    game = applyAction(game, 1, activation.action);
    game = passUntil(game, (state) => state.stack.length === 0);

    expect(game.players[1]!.hand.some((card) => card.name === "Reforge the Soul")).toBe(true);
    expect(game.pendingChoice?.type).not.toBe("miracle");
  });

  it("leaves the card in hand for a normal cast when Miracle is declined", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 1, [MOUNTAIN(), MOUNTAIN()]);
    game = stage(game, 1, (player) => ({ library: [...toHand(1, [REFORGE_THE_SOUL()], "reforge-top"), ...player.library] }));
    game = passUntil(game, (state) => state.pendingChoice?.type === "miracle");

    const choice = game.pendingChoice;
    if (choice?.type !== "miracle") throw new Error("expected a miracle choice");
    game = applyAction(game, 1, { type: "decline-miracle", sourceId: choice.sourceId });

    expect(game.pendingChoice).toBeNull();
    expect(game.players[1]!.hand.some((card) => card.name === "Reforge the Soul")).toBe(true);
  });
});

describe("Naktamun Lorespinner // Wheel of Fortune", () => {
  it("becomes prepared at upkeep when a player is low on cards, then casts a copy without ever leaving the battlefield", () => {
    const profile = profileOf(NAKTAMUN_LORESPINNER());
    expect(profile.triggers[0]).toMatchObject({
      event: "upkeep", subject: "you", condition: { kind: "any-player-hand-at-most", amount: 1 }, effect: { kind: "become-prepared" }
    });
    expect(profile.preparedCast).toMatchObject({ spellName: "Wheel of Fortune", effect: { kind: "each-player-discard-and-draw", amount: 7 } });
    expect(profile.fullyImplemented).toBe(true);

    // `twoSeatGame` already settles to turn 1's precombat-main before this
    // permanent ever exists, so its first real chance at an upkeep trigger is
    // turn 3 (this seat's next own turn) — wait for that one specifically.
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [NAKTAMUN_LORESPINNER(), MOUNTAIN(), MOUNTAIN(), MOUNTAIN()]);
    game = stage(game, 0, () => ({ hand: [] })); // qualifies "a player has one or fewer cards in hand"
    const turnBefore = game.turn;
    game = passUntil(game, (state) => state.turn > turnBefore && state.activeSeat === 0 && state.step === "precombat-main");

    const creature = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Naktamun Lorespinner // Wheel of Fortune")!;
    expect(creature.prepared).toBe(true);

    const copyAction = legalActions(game, 0).find((entry) => entry.action.type === "cast-prepared-copy" && entry.cardId === creature.instance_id)!;
    expect(copyAction).toBeDefined();
    game = applyAction(game, 0, copyAction.action);
    game = passUntil(game, (state) => state.stack.length === 0);

    // "Each player discards their hand, then draws seven cards" — both end at 7.
    expect(game.players[0]!.hand).toHaveLength(7);
    expect(game.players[1]!.hand).toHaveLength(7);
    // The permanent itself never left the battlefield or changed zone (CR 707.14: the copy just ceases to exist,
    // so neither it nor the discarded pre-Wheel hand's own draw ever names Naktamun Lorespinner or its copy).
    const stillThere = game.players[0]!.battlefield.find((permanent) => permanent.instance_id === creature.instance_id);
    expect(stillThere).toBeDefined();
    expect(stillThere?.prepared).toBe(false);
    expect(game.players[0]!.graveyard.some((card) => card.name.includes("Naktamun") || card.name === "Wheel of Fortune")).toBe(false);

    // Unprepared now, so it can't be copied again immediately.
    expect(legalActions(game, 0).some((entry) => entry.action.type === "cast-prepared-copy")).toBe(false);
  });
});

describe("Prepared mechanic — enters prepared", () => {
  const STUDIOUS_FIRST_YEAR = () => make({
    name: "Studious First-Year // Rampant Growth", type_line: "Creature — Bear Wizard // Sorcery", mana_cost: "{G} // {1}{G}", cmc: 1, power: "1", toughness: "1", colors: ["G"],
    card_faces: [
      { name: "Studious First-Year", mana_cost: "{G}", type_line: "Creature — Bear Wizard", power: "1", toughness: "1", oracle_text: "This creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)" },
      { name: "Rampant Growth", mana_cost: "{1}{G}", type_line: "Sorcery", oracle_text: "Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle." }
    ],
    oracle_id: "58b0c737-0a84-4f9a-b3b7-300c5de43874", scryfall_id: "24f888dd-785c-4089-a89c-03f9080130ed"
  });

  it("is already prepared the moment it enters the battlefield, with no trigger needed", () => {
    const profile = profileOf(STUDIOUS_FIRST_YEAR());
    expect(profile.entersPrepared).toBe(true);
    expect(profile.preparedCast).toMatchObject({ spellName: "Rampant Growth", cost: { raw: "{1}{G}" } });
    expect(profile.fullyImplemented).toBe(true);

    // Cast it for real (not the raw `putOnBattlefield` test helper, which
    // builds a Permanent directly and would bypass `putOntoBattlefield`'s
    // own `entersPrepared` wiring) so this actually exercises the engine path.
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [FOREST(), FOREST(), FOREST()]);
    game = stage(game, 0, () => ({ hand: toHand(0, [STUDIOUS_FIRST_YEAR()]) }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = passUntil(game, (state) => state.stack.length === 0);

    const creature = game.players[0]!.battlefield.find((permanent) => permanent.card.name.includes("Studious First-Year"))!;
    expect(creature.prepared).toBe(true);

    const copyAction = legalActions(game, 0).find((entry) => entry.action.type === "cast-prepared-copy" && entry.cardId === creature.instance_id)!;
    expect(copyAction).toBeDefined();
    const landsBefore = game.players[0]!.battlefield.filter((permanent) => permanent.card.name === "Forest").length;
    game = applyAction(game, 0, copyAction.action);
    expect(game.pendingChoice).toMatchObject({ type: "search-library", sourceCard: { name: "Rampant Growth" } });
    game = applyAction(game, 0, { type: "choose-library-card", sourceId: game.pendingChoice!.sourceId, query: "Forest" });

    expect(game.players[0]!.battlefield.filter((permanent) => permanent.card.name === "Forest")).toHaveLength(landsBefore + 1);
    const stillThere = game.players[0]!.battlefield.find((permanent) => permanent.instance_id === creature.instance_id);
    expect(stillThere?.prepared).toBe(false);
  });
});

describe("Prepared mechanic — additional trigger templates", () => {
  const ENCOURAGING_AVIATOR = () => make({
    name: "Encouraging Aviator // Jump", type_line: "Creature — Bird Wizard // Instant", mana_cost: "{2}{U} // {U}", cmc: 3, power: "2", toughness: "3", colors: ["U"], keywords: ["Flying"],
    card_faces: [
      { name: "Encouraging Aviator", mana_cost: "{2}{U}", type_line: "Creature — Bird Wizard", power: "2", toughness: "3", oracle_text: "Flying\nWhenever this creature attacks, it becomes prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)" },
      { name: "Jump", mana_cost: "{U}", type_line: "Instant", oracle_text: "Target creature gains flying until end of turn." }
    ],
    oracle_id: "d6accaed-ff35-4324-b31b-35e6837bc079", scryfall_id: "72654b84-9902-41db-92ab-a3499c31221c"
  });
  const PARADOX_SHAPER = () => make({
    name: "Paradox Shaper // Omit Variables", type_line: "Creature — Octopus Wizard // Sorcery", mana_cost: "{1}{U/B} // {U/B}", cmc: 2, power: "1", toughness: "3", colors: ["B", "U"],
    card_faces: [
      { name: "Paradox Shaper", mana_cost: "{1}{U/B}", type_line: "Creature — Octopus Wizard", power: "1", toughness: "3", oracle_text: "At the beginning of your upkeep, if this creature isn't prepared, it becomes prepared.\n{2}: Put target card from your graveyard on the bottom of your library." },
      { name: "Omit Variables", mana_cost: "{U/B}", type_line: "Sorcery", oracle_text: "Mill three cards." }
    ],
    oracle_id: "511951ed-fbff-4e44-9429-27f237496672", scryfall_id: "e61b9d48-0ace-4453-afe0-a1024444bac0"
  });
  const SCATHING_SHADELOCK = () => make({
    name: "Scathing Shadelock // Venomous Words", type_line: "Creature — Snake Warlock // Sorcery", mana_cost: "{4}{B} // {B}", cmc: 5, power: "4", toughness: "6", colors: ["B"],
    card_faces: [
      { name: "Scathing Shadelock", mana_cost: "{4}{B}", type_line: "Creature — Snake Warlock", power: "4", toughness: "6", oracle_text: "At the beginning of your first main phase, this creature becomes prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)" },
      { name: "Venomous Words", mana_cost: "{B}", type_line: "Sorcery", oracle_text: "Target creature you control gets +2/+0 and gains deathtouch until end of turn." }
    ],
    oracle_id: "2796c3d9-9e56-40f2-8398-7a131c4657ff", scryfall_id: "03e664cd-c3a6-4263-b2d8-dd99058fb8ec"
  });
  const ABIGALE = () => make({
    name: "Abigale, Poet Laureate // Heroic Stanza", type_line: "Legendary Creature — Bird Bard // Sorcery", mana_cost: "{1}{W}{B} // {1}{W/B}", cmc: 3, power: "2", toughness: "3", colors: ["B", "W"], keywords: ["Flying"],
    card_faces: [
      { name: "Abigale, Poet Laureate", mana_cost: "{1}{W}{B}", type_line: "Legendary Creature — Bird Bard", power: "2", toughness: "3", oracle_text: "Flying\nWhenever you cast a creature spell, Abigale becomes prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)" },
      { name: "Heroic Stanza", mana_cost: "{1}{W/B}", type_line: "Sorcery", oracle_text: "Put a +1/+1 counter on target creature." }
    ],
    oracle_id: "2f5f46ed-b8aa-4864-bd20-17281d4632bf", scryfall_id: "77285d12-e658-4eb3-ba13-ff202afab9c8"
  });
  const TAM = () => make({
    name: "Tam, Observant Sequencer // Deep Sight", type_line: "Legendary Creature — Gorgon Wizard // Sorcery", mana_cost: "{2}{G}{U} // {G}{U}", cmc: 4, power: "4", toughness: "3", colors: ["G", "U"], keywords: ["Landfall"],
    card_faces: [
      { name: "Tam, Observant Sequencer", mana_cost: "{2}{G}{U}", type_line: "Legendary Creature — Gorgon Wizard", power: "4", toughness: "3", oracle_text: "Landfall — Whenever a land you control enters, Tam becomes prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)" },
      { name: "Deep Sight", mana_cost: "{G}{U}", type_line: "Sorcery", oracle_text: "You draw a card and gain 1 life." }
    ],
    oracle_id: "702e871d-90d8-4468-8f69-5ae42af2c9d3", scryfall_id: "7120e71b-2976-451b-89a7-a1665dc6fb6b"
  });
  const STRIDING_SHOTCALLER = () => make({
    name: "Striding Shotcaller // Run the Play", type_line: "Creature — Troll Druid // Sorcery", mana_cost: "{G}{U} // {X}{G}{U}", cmc: 2, power: "0", toughness: "4", colors: ["G", "U"], keywords: ["Reach"],
    card_faces: [
      { name: "Striding Shotcaller", mana_cost: "{G}{U}", type_line: "Creature — Troll Druid", power: "0", toughness: "4", oracle_text: "Reach\nWhenever one or more creatures you control deal combat damage to a player, this creature becomes prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)" },
      { name: "Run the Play", mana_cost: "{X}{G}{U}", type_line: "Sorcery", oracle_text: "Put a +1/+1 counter on each of up to X target creatures. Those creatures gain flying until end of turn. Draw a card." }
    ],
    oracle_id: "10389ff7-2ea4-4413-90cc-0e3ca268c64d", scryfall_id: "159c2891-c1e2-4ec3-8c20-d6b97315dd1c"
  });

  it("recognizes all six templates as fully implemented", () => {
    expect(profileOf(ENCOURAGING_AVIATOR())).toMatchObject({
      fullyImplemented: true, triggers: [{ event: "attacks", subject: "self", effect: { kind: "become-prepared" } }]
    });
    expect(profileOf(PARADOX_SHAPER())).toMatchObject({
      fullyImplemented: true, triggers: [{ event: "upkeep", subject: "you", effect: { kind: "become-prepared" } }]
    });
    expect(profileOf(SCATHING_SHADELOCK())).toMatchObject({
      fullyImplemented: true, triggers: [{ event: "first-main-phase", subject: "you", effect: { kind: "become-prepared" } }]
    });
    expect(profileOf(ABIGALE())).toMatchObject({
      fullyImplemented: true, triggers: [{ event: "spell-cast", subject: "you", spellType: "creature", effect: { kind: "become-prepared" } }]
    });
    expect(profileOf(TAM())).toMatchObject({
      fullyImplemented: true, triggers: [{ event: "enters-battlefield", subject: "land-you-control", effect: { kind: "become-prepared" } }]
    });
    expect(profileOf(STRIDING_SHOTCALLER())).toMatchObject({
      fullyImplemented: true, triggers: [{ event: "deals-combat-damage-to-player", subject: "creature-you-control", effect: { kind: "become-prepared" } }]
    });
  });

  it("becomes prepared (landfall-shaped) when a land you control enters", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [TAM()]);
    game = stage(game, 0, () => ({ hand: toHand(0, [FOREST()]) }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const creature = game.players[0]!.battlefield.find((permanent) => permanent.card.name.includes("Tam"))!;
    expect(creature.prepared).toBeUndefined();
    game = applyAction(game, 0, { type: "play-land", cardId: "hand-0" });
    const afterLand = game.players[0]!.battlefield.find((permanent) => permanent.instance_id === creature.instance_id);
    expect(afterLand?.prepared).toBe(true);
  });

  it("becomes prepared when a creature you control deals combat damage to a player", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [STRIDING_SHOTCALLER(), BEAR()]);
    game = passUntil(game, (state) => state.step === "declare-attackers" && !state.combat.attackersDeclared);
    const shotcaller = game.players[0]!.battlefield.find((permanent) => permanent.card.name.includes("Striding Shotcaller"))!;
    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    expect(shotcaller.prepared).toBeUndefined();
    // Only the Bear attacks (power 0 Shotcaller wouldn't deal any damage itself); the trigger cares about ANY creature you control, not itself.
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: bear.instance_id, defender: 1 }] });
    game = passUntil(game, (state) => state.step === "end-combat" || state.turn > 1);
    const afterCombat = game.players[0]!.battlefield.find((permanent) => permanent.instance_id === shotcaller.instance_id);
    expect(afterCombat?.prepared).toBe(true);
  });

  it("becomes prepared when it attacks (new event wiring, not covered by the upkeep/main-phase templates)", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [ENCOURAGING_AVIATOR()]);
    game = passUntil(game, (state) => state.step === "declare-attackers" && !state.combat.attackersDeclared);
    const attacker = game.players[0]!.battlefield[0]!;
    expect(attacker.prepared).toBeUndefined();
    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: attacker.instance_id, defender: 1 }] });
    const afterAttack = game.players[0]!.battlefield.find((permanent) => permanent.instance_id === attacker.instance_id);
    expect(afterAttack?.prepared).toBe(true);
  });
});

describe("static extra land drops", () => {
  const EXPLORATION = () => make({ name: "Exploration", type_line: "Enchantment", mana_cost: "{G}", cmc: 1, oracle_text: "You may play an additional land on each of your turns.", oracle_id: "0c2841bb-038c-4fbf-8360-bc0a1522b58d", scryfall_id: "5b372045-a4a0-44c8-96ec-1e201d61ed26" });
  const AZUSA = () => make({ name: "Azusa, Lost but Seeking", type_line: "Legendary Creature — Human Monk", mana_cost: "{2}{G}", cmc: 3, power: "1", toughness: "2", oracle_text: "You may play two additional lands on each of your turns.", oracle_id: "6c2c8bf3-9bf8-4a86-89d3-3bb36260dc51", scryfall_id: "2fe97fbe-a6d6-4e96-8c26-f81bcdf579a1" });

  it("lets Exploration's controller play a second land the same turn, but not a third", () => {
    const profile = profileOf(EXPLORATION());
    expect(profile.extraLandDropsPerTurn).toBe(1);
    expect(profile.fullyImplemented).toBe(true);

    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [EXPLORATION()]);
    game = stage(game, 0, () => ({ hand: toHand(0, [FOREST(), FOREST(), FOREST()]) }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);

    game = applyAction(game, 0, { type: "play-land", cardId: "hand-0" });
    game = applyAction(game, 0, { type: "play-land", cardId: "hand-1" });
    expect(game.players[0]!.battlefield.filter((permanent) => permanent.card.name === "Forest")).toHaveLength(2);
    expect(legalActions(game, 0).some((entry) => entry.action.type === "play-land")).toBe(false);
    expect(() => applyAction(game, 0, { type: "play-land", cardId: "hand-2" })).toThrow();
  });

  it("stacks two static extra land drops (Azusa's own +2) on top of the printed one", () => {
    const profile = profileOf(AZUSA());
    expect(profile.extraLandDropsPerTurn).toBe(2);
    expect(profile.fullyImplemented).toBe(true);

    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [AZUSA()]);
    game = stage(game, 0, () => ({ hand: toHand(0, [FOREST(), FOREST(), FOREST(), FOREST()]) }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);

    game = applyAction(game, 0, { type: "play-land", cardId: "hand-0" });
    game = applyAction(game, 0, { type: "play-land", cardId: "hand-1" });
    game = applyAction(game, 0, { type: "play-land", cardId: "hand-2" });
    expect(game.players[0]!.battlefield.filter((permanent) => permanent.card.name === "Forest")).toHaveLength(3);
    expect(legalActions(game, 0).some((entry) => entry.action.type === "play-land")).toBe(false);
  });
});

describe("Aura targeting, attachment, and static bonuses", () => {
  const CONTROL_MAGIC = () => make({ name: "Control Magic", type_line: "Enchantment — Aura", mana_cost: "{2}{U}{U}", cmc: 4, oracle_text: "Enchant creature\nYou control enchanted creature.", oracle_id: "cd0d7141-46d2-4aa3-bc77-6b3b4513803e", scryfall_id: "7b52f459-c703-4a0b-9114-ff69eec61287" });
  const HARDENED_SCALE_ARMOR = () => make({ name: "Hardened-Scale Armor", type_line: "Enchantment — Aura", mana_cost: "{2}{G}", cmc: 3, oracle_text: "Enchant creature\nEnchanted creature gets +3/+3.", oracle_id: "9eb58db8-7934-485c-8606-fb1a6cc60d42", scryfall_id: "54c4cb29-3eb9-4a24-a91a-896802c78aef" });
  const DEBILITATING_INJURY = () => make({ name: "Debilitating Injury", type_line: "Enchantment — Aura", mana_cost: "{1}{B}", cmc: 2, oracle_text: "Enchant creature\nEnchanted creature gets -2/-2.", oracle_id: "52eab77d-9a07-4e14-8872-72681d3b3d0e", scryfall_id: "cf2d01e2-9f9f-4674-b8ab-b783d3faef03" });
  const DARKSTEEL_MUTATION = () => make({ name: "Darksteel Mutation", type_line: "Enchantment — Aura", mana_cost: "{1}{W}", cmc: 2, oracle_text: "Enchant creature\nEnchanted creature is an Insect artifact creature with base power and toughness 0/1 and has indestructible, and it loses all other abilities, card types, and creature types.", oracle_id: "05a4f8ff-49da-42af-add5-6248c4b0644b", scryfall_id: "05a4f8ff-49da-42af-add5-6248c4b0644b" });
  const WILD_GROWTH = () => make({ name: "Wild Growth", type_line: "Enchantment — Aura", mana_cost: "{G}", cmc: 1, oracle_text: "Enchant land\nWhenever enchanted land is tapped for mana, its controller adds an additional {G}.", oracle_id: "706ae742-1807-44b7-a4fa-f2e26f61519a", scryfall_id: "b87f2d2c-d6ad-4639-b8c3-e75569c5373f" });
  const LEAFDRAKE_ROOST = () => make({ name: "Leafdrake Roost", type_line: "Enchantment — Aura", mana_cost: "{3}{G}{U}", cmc: 5, oracle_text: "Enchant land\nEnchanted land has \"{G}{U}, {T}: Create a 2/2 green and blue Drake creature token with flying.\"", oracle_id: "b5ff42a1-1ac4-472b-8479-5e3749845305" });
  const PRESENCE_OF_GOND = () => make({ name: "Presence of Gond", type_line: "Enchantment — Aura", mana_cost: "{2}{G}", cmc: 3, oracle_text: "Enchant creature\nEnchanted creature has \"{T}: Create a 1/1 green Elf Warrior creature token.\"", oracle_id: "ab42398c-f0a1-4b94-ac5f-b8768e1b4e05" });
  const SPAWNING_GROUNDS = () => make({ name: "Spawning Grounds", type_line: "Enchantment — Aura", mana_cost: "{6}{G}", cmc: 7, oracle_text: "Enchant land\nEnchanted land has \"{T}: Create a 5/5 green Beast creature token with trample.\"", oracle_id: "1961dd92-db0b-4f02-b9c8-08f760f4051b" });

  function readyToCast(cards: readonly CardData[], battlefield: readonly CardData[]) {
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ hand: toHand(0, cards) }));
    game = putOnBattlefield(game, 0, battlefield);
    return passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
  }

  it("recognizes Enchant creature plus a static +N/+N grant as fully implemented", () => {
    const profile = profileOf(HARDENED_SCALE_ARMOR());
    expect(profile.targetKind).toBe("creature");
    expect(profile.auraModification).toMatchObject({ power: 3, toughness: 3 });
    expect(profile.fullyImplemented).toBe(true);
  });

  it("filters Celestial Purge to black or red permanents before exiling", () => {
    expect(profileOf(CELESTIAL_PURGE())).toMatchObject({ targetKind: "black-or-red-permanent", fullyImplemented: true });
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ hand: toHand(0, [CELESTIAL_PURGE()]) }));
    game = putOnBattlefield(game, 0, [PLAINS(), PLAINS()]);
    game = putOnBattlefield(game, 1, [BLACK_BLOCKER(), RED_RAIDER(), BEAR()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    expect(legalTargets(game, 0, "black-or-red-permanent")).toHaveLength(2);
    const target = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Dusk Bat")!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: target.instance_id }] });
    expect(game.players[1]!.battlefield.some((permanent) => permanent.instance_id === target.instance_id)).toBe(false);
    expect(game.players[1]!.exile.some((card) => card.name === "Dusk Bat")).toBe(true);
  });

  it("resolves Cruel Edict against a chosen opponent's creature pool", () => {
    expect(profileOf(CRUEL_EDICT())).toMatchObject({ targetKind: "opponent", fullyImplemented: true });
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ hand: toHand(0, [CRUEL_EDICT()]) }));
    game = putOnBattlefield(game, 0, [SWAMP(), SWAMP()]);
    game = putOnBattlefield(game, 1, [BEAR(), TRAMPLER()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "player", seat: 1 }] });
    expect(game.players[1]!.battlefield.filter((permanent) => permanent.card.name === "Grizzly Bears")).toHaveLength(0);
    expect(game.players[1]!.battlefield.some((permanent) => permanent.card.name === "Big Stomper")).toBe(true);
  });

  // CR 303.4h (attachment), 613.1/613.6 (continuous effects), and 613.7 (base P/T).
  it("applies Darksteel Mutation's layer-setting Aura and removes the enchanted creature's abilities", () => {
    const mutation = DARKSTEEL_MUTATION();
    expect(profileOf(mutation)).toMatchObject({
      targetKind: "creature",
      fullyImplemented: true,
      auraModification: {
        characteristicSetting: {
          basePower: 0,
          baseToughness: 1,
          types: ["Artifact", "Creature"],
          subtypes: ["Insect"],
          keywords: ["indestructible"],
          removeAbilities: true
        }
      }
    });
    let game = readyToCast([mutation], [SICK_TAPPER(), PLAINS(), PLAINS()]);
    const creature = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Sick Tapper")!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: creature.instance_id }] });
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Darksteel Mutation")?.attachedTo).toBe(creature.instance_id);
    const enchanted = game.players[0]!.battlefield.find((permanent) => permanent.instance_id === creature.instance_id)!;
    expect(powerOf(enchanted, game)).toBe(0);
    expect(toughnessOf(enchanted, game)).toBe(1);
    expect(legalActions(game, 0).some((entry) => entry.action.type === "activate" && entry.action.sourceId === creature.instance_id)).toBe(false);
    expect(enchanted.card.name).toBe("Sick Tapper");
  });

  it("attaches to its target creature on resolution and applies the static bonus", () => {
    let game = readyToCast([HARDENED_SCALE_ARMOR()], [BEAR(), FOREST(), FOREST(), FOREST()]);
    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: bear.instance_id }] });
    const aura = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Hardened-Scale Armor")!;
    expect(aura.attachedTo).toBe(bear.instance_id);
    const enchantedBear = game.players[0]!.battlefield.find((permanent) => permanent.instance_id === bear.instance_id)!;
    expect(powerOf(enchantedBear, game)).toBe(5);
    expect(toughnessOf(enchantedBear, game)).toBe(5);
  });

  it("falls to the graveyard (rule 704.5n) when its enchanted creature dies from the Aura's own -2/-2", () => {
    let game = readyToCast([DEBILITATING_INJURY()], [BEAR(), SWAMP(), SWAMP()]);
    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: bear.instance_id }] });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.instance_id === bear.instance_id)).toBe(false);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Debilitating Injury")).toBe(true);
  });

  it("attaches Enchant land Auras to a land, not just creatures", () => {
    let game = readyToCast([WILD_GROWTH()], [FOREST(), FOREST()]);
    const forest = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Forest")!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: forest.instance_id }] });
    const aura = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Wild Growth")!;
    expect(aura.attachedTo).toBe(forest.instance_id);
  });

  it("adds Wild Growth's fixed mana to both manual and automatic land activation", () => {
    const profile = profileOf(WILD_GROWTH());
    expect(profile).toMatchObject({
      fullyImplemented: true,
      auraLandManaBonus: { mana: "G", amount: 1 }
    });
    let game = readyToCast([WILD_GROWTH()], [FOREST(), FOREST()]);
    const forests = game.players[0]!.battlefield.filter((permanent) => permanent.card.name === "Forest");
    const forest = forests[1]!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: forest.instance_id }] });
    const source = manaSources(game.players[0]!, game).find((entry) => entry.permanentId === forest.instance_id)!;
    expect(source).toMatchObject({ amount: 1, bonusTypes: ["G"] });
    const plan = planManaPayment(parseManaCost("{G}{G}")!, game.players[0]!, { state: game });
    expect(plan?.taps).toMatchObject([{ permanentId: forest.instance_id, bonusTypes: ["G"] }]);
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate-mana" && entry.cardId === forest.instance_id)!;
    expect(activation.label).toContain("{G}{G}");
    game = applyAction(game, 0, activation.action);
    expect(game.players[0]!.manaPool.G).toBe(2);
  });

  it("continuously controls the enchanted creature and restores its prior controller when the Aura leaves", () => {
    const profile = profileOf(CONTROL_MAGIC());
    expect(profile).toMatchObject({ fullyImplemented: true, auraControlTarget: "creature", targetKind: "creature" });
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ hand: toHand(0, [CONTROL_MAGIC()]) }));
    game = putOnBattlefield(game, 1, [BEAR()]);
    game = putOnBattlefield(game, 0, [ISLAND(), ISLAND(), ISLAND(), ISLAND()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const bear = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: bear.instance_id }] });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.instance_id === bear.instance_id)).toBe(true);
    const aura = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Control Magic")!;
    expect(aura.attachedTo).toBe(bear.instance_id);
    expect(game.players[0]!.battlefield.find((permanent) => permanent.instance_id === bear.instance_id)?.auraControlSourceId).toBe(aura.instance_id);
    game = stage(game, 0, (player) => ({ battlefield: player.battlefield.filter((permanent) => permanent.instance_id !== aura.instance_id) }));
    game = settle(game);
    expect(game.players[1]!.battlefield.find((permanent) => permanent.instance_id === bear.instance_id)?.controller).toBe(1);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.instance_id === bear.instance_id)).toBe(false);
  });

  it("keeps chained control Auras on one battlefield and restores the owner after both leave", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ hand: toHand(0, [CONTROL_MAGIC(), CONTROL_MAGIC()]) }));
    game = putOnBattlefield(game, 1, [BEAR()]);
    game = putOnBattlefield(game, 0, [ISLAND(), ISLAND(), ISLAND(), ISLAND(), ISLAND(), ISLAND(), ISLAND(), ISLAND()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const bear = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: bear.instance_id }] });
    game = passUntil(game, (state) => state.stack.length === 0 && state.players[0]!.battlefield.some((permanent) => permanent.instance_id === bear.instance_id));
    const firstAura = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Control Magic")!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-1", targets: [{ kind: "permanent", instanceId: bear.instance_id }] });
    game = passUntil(game, (state) => state.stack.length === 0 && state.players[0]!.battlefield.filter((permanent) => permanent.instance_id === bear.instance_id).length === 1);
    expect(game.players[0]!.battlefield.filter((permanent) => permanent.instance_id === bear.instance_id)).toHaveLength(1);
    const secondAura = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Control Magic" && permanent.instance_id !== firstAura.instance_id)!;
    game = stage(game, 0, (player) => ({ battlefield: player.battlefield.filter((permanent) => permanent.instance_id !== firstAura.instance_id && permanent.instance_id !== secondAura.instance_id) }));
    game = settle(game);
    expect(game.players[1]!.battlefield.filter((permanent) => permanent.instance_id === bear.instance_id)).toHaveLength(1);
    expect(game.players[1]!.battlefield.find((permanent) => permanent.instance_id === bear.instance_id)?.controller).toBe(1);
  });

  it("parses Aura-granted activated abilities as reusable primitives", () => {
    for (const aura of [LEAFDRAKE_ROOST(), PRESENCE_OF_GOND(), SPAWNING_GROUNDS()]) {
      expect(profileOf(aura)).toMatchObject({ fullyImplemented: true, auraActivatedAbility: { requiresTap: true, effect: { kind: "create-token" } } });
    }
    expect(profileOf(LEAFDRAKE_ROOST()).auraActivatedAbility).toMatchObject({ manaCost: { raw: "{G}{U}" } });
  });

  it("grants Presence of Gond's token ability to the enchanted creature", () => {
    let game = readyToCast([PRESENCE_OF_GOND()], [BEAR(), FOREST(), FOREST(), FOREST()]);
    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: bear.instance_id }] });
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.action.sourceId === bear.instance_id && entry.action.abilityIndex >= 1000);
    expect(activation).toBeDefined();
    game = applyAction(game, 0, activation!.action);
    game = passUntil(game, (state) => state.stack.length === 0 && state.players[0]!.battlefield.some((permanent) => permanent.card.name === "Elf Warrior"));
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Elf Warrior")).toBe(true);
    expect(game.players[0]!.battlefield.find((permanent) => permanent.instance_id === bear.instance_id)?.tapped).toBe(true);
  });
});

describe("untapped enters-with-counters templates", () => {
  const PENTAVUS = () => make({ name: "Pentavus", type_line: "Artifact Creature — Construct", mana_cost: "{7}", cmc: 7, power: "0", toughness: "0", oracle_text: "This creature enters with five +1/+1 counters on it.\n{1}, Remove a +1/+1 counter from this creature: Create a 1/1 colorless Pentavite artifact creature token with flying.\n{1}, Sacrifice a Pentavite: Put a +1/+1 counter on this creature." });
  const WALKING_BALLISTA = () => make({ name: "Walking Ballista", type_line: "Artifact Creature — Construct", mana_cost: "{X}{X}", cmc: 0, power: "0", toughness: "0", oracle_text: "This creature enters with X +1/+1 counters on it.\n{4}: Put a +1/+1 counter on this creature.\nRemove a +1/+1 counter from this creature: It deals 1 damage to any target." });

  function readyToCast(cards: readonly CardData[], battlefield: readonly CardData[]) {
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ hand: toHand(0, cards) }));
    game = putOnBattlefield(game, 0, battlefield);
    return passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
  }

  it("recognizes a fixed 'enters with N counters' line without requiring 'tapped'", () => {
    const profile = profileOf(PENTAVUS());
    expect(profile.entersWithCounters).toEqual([{ kind: "+1/+1", amount: 5 }]);
    expect(profile.fullyImplemented).toBe(true);
  });

  it("recognizes 'enters with X counters' as a distinct variable-count template", () => {
    const profile = profileOf(WALKING_BALLISTA());
    expect(profile.entersWithVariableCounters).toEqual({ kind: "+1/+1" });
    expect(profile.fullyImplemented).toBe(true);
  });

  it("puts five +1/+1 counters on Pentavus as it resolves", () => {
    let game = readyToCast([PENTAVUS()], [FOREST(), FOREST(), FOREST(), FOREST(), FOREST(), FOREST(), FOREST()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    const pentavus = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Pentavus")!;
    expect(pentavus.counters["+1/+1"]).toBe(5);
    expect(powerOf(pentavus, game)).toBe(5);
    expect(toughnessOf(pentavus, game)).toBe(5);
  });

  it("enters Walking Ballista with a number of +1/+1 counters equal to the announced X", () => {
    let game = readyToCast([WALKING_BALLISTA()], [FOREST(), FOREST(), FOREST(), FOREST()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", variableValue: 2 });
    const ballista = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Walking Ballista")!;
    expect(ballista.counters["+1/+1"]).toBe(2);
    expect(powerOf(ballista, game)).toBe(2);
    expect(toughnessOf(ballista, game)).toBe(2);
  });

  it("enters with no counters (and immediately dies to state-based actions as a 0/0) when cast for X = 0", () => {
    let game = readyToCast([WALKING_BALLISTA()], []);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", variableValue: 0 });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Walking Ballista")).toBe(false);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Walking Ballista")).toBe(true);
  });
});

describe("tribal lord static bonuses", () => {
  const IMPERIOUS_PERFECT = () => make({ name: "Imperious Perfect", type_line: "Creature — Elf Warrior", mana_cost: "{2}{G}", cmc: 3, power: "2", toughness: "2", oracle_text: "Other Elves you control get +1/+1.\n{G}, {T}: Create a 1/1 green Elf Warrior creature token." });
  const TEST_ELF = () => make({ name: "Test Elf", type_line: "Creature — Elf Warrior", mana_cost: "{1}{G}", cmc: 2, power: "1", toughness: "1" });

  it("recognizes 'Other Elves you control get +1/+1' as a subtype-scoped grant", () => {
    const profile = profileOf(IMPERIOUS_PERFECT());
    expect(profile.staticPowerToughnessGrants).toEqual([
      { scope: "other-subtype-creatures-you-control", subtype: "Elf", power: 1, toughness: 1 }
    ]);
    expect(profile.fullyImplemented).toBe(true);
  });

  it("boosts other Elves you control but not itself, non-Elves, or an opponent's Elf", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [IMPERIOUS_PERFECT(), TEST_ELF(), BEAR()]);
    game = putOnBattlefield(game, 1, [TEST_ELF()]);
    const lord = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Imperious Perfect")!;
    const ownElf = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Test Elf")!;
    const ownBear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    const foeElf = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Test Elf")!;
    expect([powerOf(lord, game), toughnessOf(lord, game)]).toEqual([2, 2]);
    expect([powerOf(ownElf, game), toughnessOf(ownElf, game)]).toEqual([2, 2]);
    expect([powerOf(ownBear, game), toughnessOf(ownBear, game)]).toEqual([2, 2]);
    expect([powerOf(foeElf, game), toughnessOf(foeElf, game)]).toEqual([1, 1]);
  });

  const GOBLIN_LORD = () => make({ name: "Test Goblin Lord", type_line: "Creature — Goblin", mana_cost: "{1}{R}", cmc: 2, power: "1", toughness: "1", oracle_text: "Other Goblin creatures you control get +1/+1." });
  const TEST_GOBLIN = () => make({ name: "Test Goblin Grunt", type_line: "Creature — Goblin", mana_cost: "{R}", cmc: 1, power: "1", toughness: "1" });
  const ARTIFACT_LORD = () => make({ name: "Test Artifact Lord", type_line: "Artifact Creature — Construct", mana_cost: "{2}{U}", cmc: 3, power: "1", toughness: "1", oracle_text: "Other artifact creatures you control get +1/+1." });
  const TEST_ARTIFACT_CREATURE = () => make({ name: "Test Artifact Creature", type_line: "Artifact Creature — Construct", mana_cost: "{2}", cmc: 2, power: "1", toughness: "1" });

  it("recognizes the 'Other <Subtype> creatures you control get' phrasing (explicit 'creatures')", () => {
    const profile = profileOf(GOBLIN_LORD());
    expect(profile.staticPowerToughnessGrants).toEqual([
      { scope: "other-subtype-creatures-you-control", subtype: "Goblin", power: 1, toughness: 1 }
    ]);
    expect(profile.fullyImplemented).toBe(true);
  });

  it("boosts other Goblins you control but not itself or a non-Goblin", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [GOBLIN_LORD(), TEST_GOBLIN(), BEAR()]);
    const lord = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Test Goblin Lord")!;
    const grunt = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Test Goblin Grunt")!;
    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    expect([powerOf(lord, game), toughnessOf(lord, game)]).toEqual([1, 1]);
    expect([powerOf(grunt, game), toughnessOf(grunt, game)]).toEqual([2, 2]);
    expect([powerOf(bear, game), toughnessOf(bear, game)]).toEqual([2, 2]);
  });

  it("also matches a card TYPE qualifier ('Other artifact creatures you control'), not just a creature subtype", () => {
    const profile = profileOf(ARTIFACT_LORD());
    expect(profile.staticPowerToughnessGrants).toEqual([
      { scope: "other-subtype-creatures-you-control", subtype: "artifact", power: 1, toughness: 1 }
    ]);
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [ARTIFACT_LORD(), TEST_ARTIFACT_CREATURE(), BEAR()]);
    const lord = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Test Artifact Lord")!;
    const otherArtifact = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Test Artifact Creature")!;
    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    expect([powerOf(lord, game), toughnessOf(lord, game)]).toEqual([1, 1]);
    expect([powerOf(otherArtifact, game), toughnessOf(otherArtifact, game)]).toEqual([2, 2]);
    expect([powerOf(bear, game), toughnessOf(bear, game)]).toEqual([2, 2]);
  });
});

describe("color anthem static bonuses (any controller)", () => {
  const BAD_MOON = () => make({ name: "Bad Moon", type_line: "Enchantment", mana_cost: "{1}{B}", cmc: 2, oracle_text: "Black creatures get +1/+1." });
  const CELESTIAL_CRUSADER = () => make({ name: "Celestial Crusader", type_line: "Creature — Spirit", mana_cost: "{2}{W}{W}", cmc: 4, power: "2", toughness: "2", colors: ["W"], oracle_text: "Flash\nSplit second (As long as this spell is on the stack, players can't cast spells or activate abilities that aren't mana abilities.)\nFlying\nOther white creatures get +1/+1." });
  const TEST_BLACK_CREATURE = () => make({ name: "Test Black Creature", type_line: "Creature — Zombie", mana_cost: "{1}{B}", cmc: 2, power: "2", toughness: "2", colors: ["B"] });
  const TEST_WHITE_CREATURE = () => make({ name: "Test White Creature", type_line: "Creature — Soldier", mana_cost: "{1}{W}", cmc: 2, power: "1", toughness: "1", colors: ["W"] });

  it("recognizes a colorless-anthem-source's color-restricted grant covering every controller", () => {
    const profile = profileOf(BAD_MOON());
    expect(profile.staticPowerToughnessGrants).toEqual([{ scope: "all-creatures", color: "B", power: 1, toughness: 1 }]);
    expect(profile.fullyImplemented).toBe(true);
  });

  it("boosts every player's black creatures but leaves a green one alone", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [BAD_MOON(), TEST_BLACK_CREATURE(), BEAR()]);
    game = putOnBattlefield(game, 1, [TEST_BLACK_CREATURE()]);
    const ownZombie = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Test Black Creature")!;
    const ownBear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    const foeZombie = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Test Black Creature")!;
    expect([powerOf(ownZombie, game), toughnessOf(ownZombie, game)]).toEqual([3, 3]);
    expect([powerOf(ownBear, game), toughnessOf(ownBear, game)]).toEqual([2, 2]);
    expect([powerOf(foeZombie, game), toughnessOf(foeZombie, game)]).toEqual([3, 3]);
  });

  it("boosts white creatures under any controller but not itself ('other')", () => {
    const profile = profileOf(CELESTIAL_CRUSADER());
    expect(profile.staticPowerToughnessGrants).toEqual([{ scope: "other-all-creatures", color: "W", power: 1, toughness: 1 }]);
    expect(profile.fullyImplemented).toBe(true);

    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [CELESTIAL_CRUSADER(), TEST_WHITE_CREATURE()]);
    game = putOnBattlefield(game, 1, [TEST_WHITE_CREATURE()]);
    const crusader = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Celestial Crusader")!;
    const ownSoldier = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Test White Creature")!;
    const foeSoldier = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Test White Creature")!;
    expect([powerOf(crusader, game), toughnessOf(crusader, game)]).toEqual([2, 2]);
    expect([powerOf(ownSoldier, game), toughnessOf(ownSoldier, game)]).toEqual([2, 2]);
    expect([powerOf(foeSoldier, game), toughnessOf(foeSoldier, game)]).toEqual([2, 2]);
  });
});

describe("Mana Vault draw-step self-damage while tapped", () => {
  const MANA_VAULT = () => make({ name: "Mana Vault", type_line: "Artifact", mana_cost: "{1}", cmc: 1, oracle_text: "This artifact doesn't untap during your untap step.\nAt the beginning of your upkeep, you may pay {4}. If you do, untap this artifact.\nAt the beginning of your draw step, if this artifact is tapped, it deals 1 damage to you.\n{T}: Add {C}{C}{C}." });

  // Mana Vault's own upkeep trigger ("you may pay {4}. If you do, untap it")
  // is optional and has to be declined explicitly before the generic
  // pass-forward helper can find a plain "pass" action again.
  function passDecliningOptionalTriggers(game: ReturnType<typeof twoSeatGame>, predicate: (state: typeof game) => boolean) {
    let current = game;
    for (let guard = 0; guard < 50; guard += 1) {
      current = passUntil(current, (state) => predicate(state) || state.pendingChoice?.type === "optional-trigger");
      if (predicate(current)) return current;
      const choice = current.pendingChoice!;
      current = applyAction(current, choice.seat, { type: "choose-trigger", sourceId: choice.sourceId, accept: false });
    }
    throw new Error("passDecliningOptionalTriggers: guard exceeded");
  }

  it("recognizes the source-tapped condition on its draw-step damage trigger", () => {
    const profile = profileOf(MANA_VAULT());
    expect(profile.triggers).toContainEqual(expect.objectContaining({
      event: "draw-step", subject: "you", condition: { kind: "source-tapped" }, effect: { kind: "damage-controller", amount: 1 }
    }));
    expect(profile.fullyImplemented).toBe(true);
  });

  it("deals 1 damage to its controller on their draw step only while tapped", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [MANA_VAULT()]);
    game = stage(game, 0, (player) => ({
      battlefield: player.battlefield.map((permanent) => permanent.card.name === "Mana Vault" ? { ...permanent, tapped: true } : permanent)
    }));
    const lifeBefore = game.players[0]!.life;
    game = passDecliningOptionalTriggers(game, (state) => state.turn === 3 && state.activeSeat === 0 && state.step === "precombat-main");
    expect(game.players[0]!.life).toBe(lifeBefore - 1);
  });

  it("deals no damage on the draw step while untapped", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [MANA_VAULT()]);
    const lifeBefore = game.players[0]!.life;
    game = passDecliningOptionalTriggers(game, (state) => state.turn === 3 && state.activeSeat === 0 && state.step === "precombat-main");
    expect(game.players[0]!.life).toBe(lifeBefore);
  });
});

describe("Silence locks out opponents' casting for the turn", () => {
  const SILENCE = () => make({ name: "Silence", type_line: "Instant", mana_cost: "{W}", cmc: 1, oracle_text: "Your opponents can't cast spells this turn." });
  const TEST_INSTANT = () => make({ name: "Test Cantrip", type_line: "Instant", mana_cost: "{U}", cmc: 1, oracle_text: "Draw a card." });

  it("recognizes the effect", () => {
    const profile = profileOf(SILENCE());
    expect(profile.effects).toEqual([{ kind: "opponents-cant-cast-spells-this-turn" }]);
    expect(profile.fullyImplemented).toBe(true);
  });

  it("stops the opponent from casting an instant this turn, but clears by their next turn", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ hand: toHand(0, [SILENCE()]) }));
    game = stage(game, 1, () => ({ hand: toHand(1, [TEST_INSTANT()], "foe") }));
    game = putOnBattlefield(game, 0, [PLAINS()]);
    game = putOnBattlefield(game, 1, [ISLAND()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    game = { ...game, players: game.players.map((player) => ({ ...player, autoPass: false })) };

    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[1]!.cantCastSpellsUntilEndOfTurn).toBe(true);
    expect(game.prioritySeat).toBe(0);
    game = applyAction(game, 0, { type: "pass" });
    expect(game.prioritySeat).toBe(1);
    expect(legalActions(game, 1).some((entry) => entry.action.type === "cast")).toBe(false);
    expect(() => applyAction(game, 1, { type: "cast", cardId: "hand-0" })).toThrow();

    // The lock is only "this turn" (CR 116.3) -- it clears at cleanup, well
    // before the opponent's own next turn opens.
    game = passUntil(game, (state) => state.turn === 2 && state.activeSeat === 1 && state.step === "precombat-main" && state.prioritySeat === 1);
    expect(game.players[1]!.cantCastSpellsUntilEndOfTurn).toBeFalsy();
    expect(legalActions(game, 1).some((entry) => entry.action.type === "cast")).toBe(true);
  });
});

describe("City of Traitors sacrifices itself when another land is played", () => {
  const CITY_OF_TRAITORS = () => make({ name: "City of Traitors", type_line: "Land", oracle_text: "When you play another land, sacrifice this land.\n{T}: Add {C}{C}." });

  it("recognizes the trigger", () => {
    const profile = profileOf(CITY_OF_TRAITORS());
    expect(profile.triggers).toEqual([{
      event: "play-land", subject: "you", effect: { kind: "sacrifice-source" },
      optional: false, targetKind: "none", sourceText: "When you play another land, sacrifice ~."
    }]);
    expect(profile.fullyImplemented).toBe(true);
  });

  it("sacrifices itself the moment its controller plays a different land", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [CITY_OF_TRAITORS()]);
    game = stage(game, 0, () => ({ hand: toHand(0, [FOREST()]) }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);

    game = applyAction(game, 0, { type: "play-land", cardId: "hand-0" });
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "City of Traitors")).toBe(false);
    expect(game.players[0]!.graveyard.some((card) => card.name === "City of Traitors")).toBe(true);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Forest")).toBe(true);
  });
});

describe("Persist and the each-opponent drain template", () => {
  const MURDEROUS_REDCAP = () => make({ name: "Murderous Redcap", type_line: "Creature — Goblin Assassin", mana_cost: "{2}{B/R}{B/R}", cmc: 4, power: "2", toughness: "2", keywords: ["Persist"], oracle_text: "When this creature enters, it deals damage equal to its power to any target.\nPersist (When this creature dies, if it had no -1/-1 counters on it, return it to the battlefield under its owner's control with a -1/-1 counter on it.)" });
  // A Persist creature with no other triggers, to isolate the mechanic under
  // test from Murderous Redcap's own ETB damage (which would need its own
  // target-selection flow to resolve).
  const TEST_PERSIST_CREATURE = () => make({ name: "Test Persist Creature", type_line: "Creature — Spirit", mana_cost: "{1}{B}", cmc: 2, power: "2", toughness: "2", keywords: ["Persist"], oracle_text: "Persist (When this creature dies, if it had no -1/-1 counters on it, return it to the battlefield under its owner's control with a -1/-1 counter on it.)" });
  const ZULAPORT_CUTTHROAT = () => make({ name: "Zulaport Cutthroat", type_line: "Creature — Human Rogue Ally", mana_cost: "{1}{B}", cmc: 2, power: "1", toughness: "1", oracle_text: "Whenever this creature or another creature you control dies, each opponent loses 1 life and you gain 1 life." });

  it("recognizes the bare 'Persist' reminder line as consumed by the synthesized keyword trigger", () => {
    const profile = profileOf(MURDEROUS_REDCAP());
    expect(profile.triggers).toContainEqual(expect.objectContaining({ event: "dies", subject: "self", effect: { kind: "undying-return", counter: "-1/-1" } }));
    expect(profile.fullyImplemented).toBe(true);
  });

  it("returns a Persist creature once with a -1/-1 counter, but not a second time", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [TEST_PERSIST_CREATURE(), MOUNTAIN(), MOUNTAIN(), MOUNTAIN(), MOUNTAIN()]);
    game = stage(game, 0, () => ({ hand: toHand(0, [BOLT(), BOLT()]) }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    let persistCreature = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Test Persist Creature")!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: persistCreature.instance_id }] });
    game = passUntil(game, (state) => state.stack.length === 0);
    persistCreature = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Test Persist Creature")!;
    expect(persistCreature.counters["-1/-1"]).toBe(1);
    expect(powerOf(persistCreature, game)).toBe(1);
    expect(toughnessOf(persistCreature, game)).toBe(1);

    game = applyAction(game, 0, { type: "cast", cardId: "hand-1", targets: [{ kind: "permanent", instanceId: persistCreature.instance_id }] });
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Test Persist Creature")).toBe(false);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Test Persist Creature")).toBe(true);
  });

  it("recognizes the each-opponent drain template, distinct from Blood Artist's single-target one", () => {
    const profile = profileOf(ZULAPORT_CUTTHROAT());
    expect(profile.triggers).toEqual([{
      event: "dies", subject: "creature-you-control",
      effect: { kind: "compound", effects: [{ kind: "each-opponent-loses-life", amount: 1 }, { kind: "gain-life", amount: 1 }] },
      optional: false, targetKind: "none",
      sourceText: "Whenever ~ or another creature you control dies, each opponent loses 1 life and you gain 1 life."
    }]);
    expect(profile.fullyImplemented).toBe(true);
  });

  it("drains every opponent by 1 when another creature you control dies", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [ZULAPORT_CUTTHROAT(), BEAR(), MOUNTAIN()]);
    game = stage(game, 0, () => ({ hand: toHand(0, [BOLT()]) }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const life0Before = game.players[0]!.life;
    const life1Before = game.players[1]!.life;
    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: bear.instance_id }] });
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.instance_id === bear.instance_id)).toBe(false);
    expect(game.players[0]!.life).toBe(life0Before + 1);
    expect(game.players[1]!.life).toBe(life1Before - 1);
  });
});

describe("Skullclamp's equipped-creature-dies draw", () => {
  const SKULLCLAMP = () => make({ name: "Skullclamp", type_line: "Artifact — Equipment", mana_cost: "{1}", cmc: 1, oracle_text: "Equipped creature gets +1/-1.\nWhenever equipped creature dies, draw two cards.\nEquip {1}" });

  it("wires 'equipped creature dies' to the existing equipped-creature trigger subject", () => {
    const profile = profileOf(SKULLCLAMP());
    expect(profile.triggers).toContainEqual(expect.objectContaining({ event: "dies", subject: "equipped-creature", effect: { kind: "draw", amount: 2 } }));
    expect(profile.equipmentModification).toMatchObject({ power: 1, toughness: -1 });
    expect(profile.fullyImplemented).toBe(true);
  });

  it("draws two cards when the equipped creature dies from the clamp's own -1 toughness", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [SKULLCLAMP(), BEAR(), MOUNTAIN(), MOUNTAIN()]);
    game = stage(game, 0, () => ({ hand: toHand(0, [BOLT()]) }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const clamp = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Skullclamp")!;
    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    // 2/2 Bear -> 3/1 once clamped; still alive on its own.
    game = applyAction(game, 0, { type: "equip", sourceId: clamp.instance_id, targetId: bear.instance_id });
    game = passUntil(game, (state) => state.stack.length === 0);
    const clamped = game.players[0]!.battlefield.find((permanent) => permanent.instance_id === bear.instance_id)!;
    expect(powerOf(clamped, game)).toBe(3);
    expect(toughnessOf(clamped, game)).toBe(1);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Grizzly Bears")).toBe(true);

    const handBeforeCast = game.players[0]!.hand.length;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: bear.instance_id }] });
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Grizzly Bears")).toBe(false);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);
    // Casting Bolt removes it from hand (-1); the Skullclamp death trigger draws two (+2).
    expect(game.players[0]!.hand.length).toBe(handBeforeCast + 1);
  });
});

describe("Natural Order's green-restricted sacrifice and tutor", () => {
  const NATURAL_ORDER = () => make({ name: "Natural Order", type_line: "Sorcery", mana_cost: "{2}{G}{G}", cmc: 4, oracle_text: "As an additional cost to cast this spell, sacrifice a green creature.\nSearch your library for a green creature card, put it onto the battlefield, then shuffle." });
  const GREEN_BEAST = () => make({ name: "Test Green Beast", type_line: "Creature — Beast", mana_cost: "{2}{G}", cmc: 3, power: "3", toughness: "3", colors: ["G"] });
  const RED_GOBLIN = () => make({ name: "Test Red Goblin", type_line: "Creature — Goblin", mana_cost: "{R}", cmc: 1, power: "1", toughness: "1", colors: ["R"] });
  const GREEN_HYDRA = () => make({ name: "Test Green Hydra", type_line: "Creature — Hydra", mana_cost: "{4}{G}{G}", cmc: 6, power: "6", toughness: "6", colors: ["G"] });

  it("recognizes both the color-restricted sacrifice cost and the color-restricted tutor", () => {
    const profile = profileOf(NATURAL_ORDER());
    expect(profile.additionalCostSacrificeCreatureColor).toBe("G");
    expect(profile.effects).toEqual([{ kind: "search-library", types: ["Creature"], colors: ["G"], destination: "battlefield", reveal: false }]);
    expect(profile.fullyImplemented).toBe(true);
  });

  it("sacrifices the green creature and only offers green creatures as the tutor target", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [GREEN_BEAST(), RED_GOBLIN(), FOREST(), FOREST(), FOREST(), FOREST()]);
    game = stage(game, 0, (player) => ({
      hand: toHand(0, [NATURAL_ORDER()]),
      library: [...toHand(0, [RED_GOBLIN(), GREEN_HYDRA()], "library"), ...player.library]
    }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);

    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Test Green Beast")).toBe(false);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Test Green Beast")).toBe(true);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Test Red Goblin")).toBe(true);
    expect(game.pendingChoice).toMatchObject({ type: "search-library", seat: 0 });
    expect(() => applyAction(game, 0, { type: "choose-library-card", sourceId: game.pendingChoice!.sourceId, query: "Test Red Goblin" })).toThrow();
    game = applyAction(game, 0, { type: "choose-library-card", sourceId: game.pendingChoice!.sourceId, query: "Test Green Hydra" });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Test Green Hydra")).toBe(true);
  });

  it("can't be cast with only a non-green creature to sacrifice", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [RED_GOBLIN(), FOREST(), FOREST(), FOREST(), FOREST()]);
    game = stage(game, 0, () => ({ hand: toHand(0, [NATURAL_ORDER()]) }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    expect(legalActions(game, 0).some((entry) => entry.action.type === "cast" && entry.cardId === "hand-0")).toBe(false);
    expect(() => applyAction(game, 0, { type: "cast", cardId: "hand-0" })).toThrow();
  });
});

describe("Beast Within gives the destroyed permanent's own controller the token", () => {
  const BEAST_WITHIN = () => make({ name: "Beast Within", type_line: "Instant", mana_cost: "{2}{G}", cmc: 3, oracle_text: "Destroy target permanent. Its controller creates a 3/3 green Beast creature token." });

  it("recognizes the compound effect", () => {
    const profile = profileOf(BEAST_WITHIN());
    expect(profile).toMatchObject({
      targetKind: "permanent",
      effects: [{ kind: "destroy-target-creature-then-controller-token", token: { name: "Beast", typeLine: "Creature — Beast", power: 3, toughness: 3, colors: ["G"] } }]
    });
    expect(profile.fullyImplemented).toBe(true);
  });

  it("destroys the opponent's permanent and gives the token to the opponent, not the caster", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [FOREST(), FOREST(), FOREST()]);
    game = putOnBattlefield(game, 1, [BEAR()]);
    game = stage(game, 0, () => ({ hand: toHand(0, [BEAST_WITHIN()]) }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);

    const bear = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", targets: [{ kind: "permanent", instanceId: bear.instance_id }] });
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[1]!.battlefield.some((permanent) => permanent.instance_id === bear.instance_id)).toBe(false);
    expect(game.players[1]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);
    expect(game.players[1]!.battlefield.some((permanent) => permanent.card.name === "Beast" && permanent.card.token)).toBe(true);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Beast")).toBe(false);
  });
});

describe("Green Sun's Zenith tutors a green creature within the paid X", () => {
  const GREEN_SUNS_ZENITH = () => make({ name: "Green Sun's Zenith", type_line: "Sorcery", mana_cost: "{X}{G}", cmc: 0, oracle_text: "Search your library for a green creature card with mana value X or less, put it onto the battlefield, then shuffle. Shuffle Green Sun's Zenith into its owner's library." });
  const CHEAP_GREEN_CREATURE = () => make({ name: "Test Cheap Sprout", type_line: "Creature — Plant", mana_cost: "{G}", cmc: 1, power: "1", toughness: "1", colors: ["G"] });
  const EXPENSIVE_GREEN_CREATURE = () => make({ name: "Test Expensive Titan", type_line: "Creature — Giant", mana_cost: "{4}{G}{G}", cmc: 6, power: "6", toughness: "6", colors: ["G"] });

  it("recognizes the X-mana-value-restricted tutor", () => {
    const profile = profileOf(GREEN_SUNS_ZENITH());
    expect(profile.effects).toEqual([
      { kind: "search-library", types: ["Creature"], colors: ["G"], maxManaValue: "X", destination: "battlefield", reveal: false },
      { kind: "shuffle-self-into-library" }
    ]);
    expect(profile.fullyImplemented).toBe(true);
  });

  it("only offers a green creature within the paid X as the tutor target", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [FOREST(), FOREST(), FOREST(), FOREST()]);
    game = stage(game, 0, (player) => ({
      hand: toHand(0, [GREEN_SUNS_ZENITH()]),
      library: [...toHand(0, [EXPENSIVE_GREEN_CREATURE(), CHEAP_GREEN_CREATURE()], "library"), ...player.library]
    }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);

    game = applyAction(game, 0, { type: "cast", cardId: "hand-0", variableValue: 2 });
    expect(game.pendingChoice).toMatchObject({ type: "search-library", seat: 0 });
    expect(() => applyAction(game, 0, { type: "choose-library-card", sourceId: game.pendingChoice!.sourceId, query: "Test Expensive Titan" })).toThrow();
    game = applyAction(game, 0, { type: "choose-library-card", sourceId: game.pendingChoice!.sourceId, query: "Test Cheap Sprout" });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Test Cheap Sprout")).toBe(true);
  });
});

describe("static mana-ability grants (Chromatic Lantern, Joraga Treespeaker)", () => {
  const CHROMATIC_LANTERN = () => make({ name: "Chromatic Lantern", type_line: "Artifact", mana_cost: "{3}", cmc: 3, oracle_text: "Lands you control have \"{T}: Add one mana of any color.\"\n{T}: Add one mana of any color." });
  const JORAGA_TREESPEAKER = () => make({ name: "Joraga Treespeaker", type_line: "Creature — Elf Druid", mana_cost: "{G}", cmc: 1, power: "1", toughness: "1", oracle_text: "Level up {1}{G} ({1}{G}: Put a level counter on this. Level up only as a sorcery.)\nLEVEL 1-4\n1/2\n{T}: Add {G}{G}.\nLEVEL 5+\n1/4\nElves you control have \"{T}: Add {G}{G}.\"" });
  const TEST_ELF = () => make({ name: "Test Elf", type_line: "Creature — Elf", mana_cost: "{G}", cmc: 1, power: "1", toughness: "1" });

  it("recognizes Chromatic Lantern's land-wide grant and Joraga's level-5+ Elf grant", () => {
    const lanternProfile = profileOf(CHROMATIC_LANTERN());
    expect(lanternProfile.staticManaAbilityGrants).toEqual([
      { scope: "you-control", excludesSelf: false, type: "Land", ability: expect.objectContaining({ produces: expect.arrayContaining(["W", "U", "B", "R", "G"]) }) }
    ]);
    expect(lanternProfile.fullyImplemented).toBe(true);

    const joragaProfile = profileOf(JORAGA_TREESPEAKER());
    expect(joragaProfile.staticManaAbilityGrants).toEqual([
      { scope: "you-control", excludesSelf: false, type: "Creature", subtype: "Elf", minLevel: 5, ability: expect.objectContaining({ produces: ["G"], amount: 2 }) }
    ]);
    expect(joragaProfile.fullyImplemented).toBe(true);
  });

  it("lets Chromatic Lantern's controller tap a Forest for any color, not just green", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [CHROMATIC_LANTERN(), FOREST()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const forest = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Forest")!;
    expect(legalActions(game, 0).some((entry) => entry.action.type === "activate-mana" && entry.action.sourceId === forest.instance_id && entry.action.mana === "U")).toBe(true);
    game = applyAction(game, 0, { type: "activate-mana", sourceId: forest.instance_id, abilityIndex: 1, mana: "U" });
    expect(game.players[0]!.manaPool.U).toBe(1);
  });

  it("does not grant Elves the mana ability until Joraga Treespeaker reaches level 5", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [JORAGA_TREESPEAKER(), TEST_ELF()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const elf = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Test Elf")!;
    expect(legalActions(game, 0).some((entry) => entry.action.type === "activate-mana" && entry.action.sourceId === elf.instance_id)).toBe(false);

    game = stage(game, 0, (player) => ({
      battlefield: player.battlefield.map((permanent) => permanent.card.name === "Joraga Treespeaker"
        ? { ...permanent, counters: { ...permanent.counters, level: 5 } } : permanent)
    }));
    expect(legalActions(game, 0).some((entry) => entry.action.type === "activate-mana" && entry.action.sourceId === elf.instance_id)).toBe(true);
    game = applyAction(game, 0, { type: "activate-mana", sourceId: elf.instance_id, abilityIndex: 0, mana: "G" });
    expect(game.players[0]!.manaPool.G).toBe(2);
  });
});

describe("Urborg, Tomb of Yawgmoth's every-land black-mana grant", () => {
  const URBORG = () => make({ name: "Urborg, Tomb of Yawgmoth", type_line: "Legendary Land", oracle_text: "Each land is a Swamp in addition to its other land types." });
  const YAVIMAYA = () => make({ name: "Yavimaya, Cradle of Growth", type_line: "Legendary Land", oracle_text: "Each land is a Forest in addition to its other land types." });

  it("recognizes an all-scope, land-typed mana ability grant", () => {
    const profile = profileOf(URBORG());
    expect(profile.staticManaAbilityGrants).toEqual([
      { scope: "all", excludesSelf: false, type: "Land", ability: expect.objectContaining({ produces: ["B"], amount: 1 }) }
    ]);
    expect(profile.fullyImplemented).toBe(true);
  });

  it("recognizes the same grant for Yavimaya's Forest-typed sibling", () => {
    const profile = profileOf(YAVIMAYA());
    expect(profile.staticManaAbilityGrants).toEqual([
      { scope: "all", excludesSelf: false, type: "Land", ability: expect.objectContaining({ produces: ["G"], amount: 1 }) }
    ]);
    expect(profile.fullyImplemented).toBe(true);
  });

  it("lets a Forest tap for black mana, for either player, not just Urborg's controller", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [URBORG(), FOREST()]);
    game = putOnBattlefield(game, 1, [MOUNTAIN()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const forest = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Forest")!;
    const mountain = game.players[1]!.battlefield.find((permanent) => permanent.card.name === "Mountain")!;
    expect(legalActions(game, 0).some((entry) => entry.action.type === "activate-mana" && entry.action.sourceId === forest.instance_id && entry.action.mana === "B")).toBe(true);
    game = applyAction(game, 0, { type: "activate-mana", sourceId: forest.instance_id, abilityIndex: 1, mana: "B" });
    expect(game.players[0]!.manaPool.B).toBe(1);

    expect(manaSources(game.players[1]!, game).some((source) =>
      source.permanentId === mountain.instance_id && source.options.includes("B"))).toBe(true);
  });
});

describe("board-scaled mana abilities (Priest of Titania, Cloudpost)", () => {
  const PRIEST_OF_TITANIA = () => make({ name: "Priest of Titania", type_line: "Creature — Elf Druid", mana_cost: "{G}", cmc: 1, power: "1", toughness: "1", oracle_text: "{T}: Add {G} for each Elf on the battlefield." });
  const CLOUDPOST = () => make({ name: "Cloudpost", type_line: "Land — Locus", oracle_text: "This land enters tapped.\n{T}: Add {C} for each Locus on the battlefield." });
  const TEST_ELF_B = () => make({ name: "Test Elf B", type_line: "Creature — Elf", mana_cost: "{G}", cmc: 1, power: "1", toughness: "1" });
  const ELF_CHIEFTAIN_TEST = () => make({ name: "Elf Chieftain Test", type_line: "Creature — Elf", mana_cost: "{1}{G}", cmc: 2, power: "1", toughness: "1", oracle_text: "{T}: Add {G} for each Elf you control." });

  it("recognizes both the 'on the battlefield' and 'you control' scaled shapes as a fully-implemented mana ability", () => {
    const priestProfile = profileOf(PRIEST_OF_TITANIA());
    expect(priestProfile.fullyImplemented).toBe(true);
    expect(priestProfile.manaAbilities[0]).toMatchObject({ produces: ["G"], scalesWith: { kind: "subtype-anywhere", subtype: "Elf" } });

    const cloudpostProfile = profileOf(CLOUDPOST());
    expect(cloudpostProfile.fullyImplemented).toBe(true);
    expect(cloudpostProfile.manaAbilities[0]).toMatchObject({ produces: ["C"], scalesWith: { kind: "subtype-anywhere", subtype: "Locus" } });
  });

  it("counts Elves on the WHOLE battlefield, including an opponent's, not just the controller's own", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [PRIEST_OF_TITANIA()]);
    game = putOnBattlefield(game, 1, [TEST_ELF_B(), TEST_ELF_B()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const priest = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Priest of Titania")!;
    const source = manaSources(game.players[0]!, game).find((entry) => entry.permanentId === priest.instance_id)!;
    expect(source.amount).toBe(3); // Priest of Titania itself plus the two opposing Elves.
    game = applyAction(game, 0, { type: "activate-mana", sourceId: priest.instance_id, abilityIndex: 0, mana: "G" });
    expect(game.players[0]!.manaPool.G).toBe(3);
  });

  it("counts only the controller's own Elves for a sibling 'you control' scaled ability", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [ELF_CHIEFTAIN_TEST(), TEST_ELF_B()]);
    game = putOnBattlefield(game, 1, [TEST_ELF_B()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const chieftain = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Elf Chieftain Test")!;
    game = applyAction(game, 0, { type: "activate-mana", sourceId: chieftain.instance_id, abilityIndex: 0, mana: "G" });
    expect(game.players[0]!.manaPool.G).toBe(2); // Chieftain and its own Test Elf B, NOT the opponent's.
  });
});

describe("the stampede family (Craterhoof Behemoth, Pathbreaker Ibex)", () => {
  const CRATERHOOF = () => make({ name: "Craterhoof Behemoth", type_line: "Creature — Beast", mana_cost: "{5}{G}{G}{G}", cmc: 8, power: "5", toughness: "5", keywords: ["Haste"], oracle_text: "Haste\nWhen this creature enters, creatures you control gain trample and get +X/+X until end of turn, where X is the number of creatures you control." });
  const PATHBREAKER_IBEX = () => make({ name: "Pathbreaker Ibex", type_line: "Creature — Goat", mana_cost: "{4}{G}{G}", cmc: 6, power: "3", toughness: "3", oracle_text: "Whenever this creature attacks, creatures you control gain trample and get +X/+X until end of turn, where X is the greatest power among creatures you control." });

  it("recognizes both stampede shapes", () => {
    expect(profileOf(CRATERHOOF())).toMatchObject({ fullyImplemented: true, triggers: [{ event: "enters-battlefield", subject: "self", effect: { kind: "creature-count-stampede" } }] });
    expect(profileOf(PATHBREAKER_IBEX())).toMatchObject({ fullyImplemented: true, triggers: [{ event: "attacks", subject: "self", effect: { kind: "overwhelming-stampede" } }] });
  });

  it("pumps every controlled creature (including itself) by the creature count when Craterhoof enters", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [BEAR(), BEAR(), FOREST(), FOREST(), FOREST(), FOREST(), FOREST(), FOREST(), FOREST(), FOREST()]);
    game = stage(game, 0, () => ({ hand: toHand(0, [CRATERHOOF()]) }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);

    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = passUntil(game, (state) => state.stack.length === 0);
    // Two Bears already in play plus Craterhoof itself: X = 3.
    const bears = game.players[0]!.battlefield.filter((permanent) => permanent.card.name === "Grizzly Bears");
    const hoof = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Craterhoof Behemoth")!;
    expect(bears).toHaveLength(2);
    for (const bear of bears) {
      expect([powerOf(bear, game), toughnessOf(bear, game)]).toEqual([5, 5]);
      expect(bear.temporaryKeywords).toContain("trample");
    }
    expect([powerOf(hoof, game), toughnessOf(hoof, game)]).toEqual([8, 8]);
  });

  it("pumps every controlled creature by the greatest power among them when Pathbreaker Ibex attacks", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [PATHBREAKER_IBEX(), BEAR()]);
    game = passUntil(game, (state) => state.step === "declare-attackers" && state.activeSeat === 0);
    const ibex = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Pathbreaker Ibex")!;
    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;

    game = applyAction(game, 0, { type: "declare-attackers", attackers: [{ instanceId: ibex.instance_id, defender: 1 }] });
    game = passUntil(game, (state) => state.stack.length === 0);
    const attackedIbex = game.players[0]!.battlefield.find((permanent) => permanent.instance_id === ibex.instance_id)!;
    const pumpedBear = game.players[0]!.battlefield.find((permanent) => permanent.instance_id === bear.instance_id)!;
    // Greatest power among Ibex (3) and Bear (2) is 3.
    expect([powerOf(attackedIbex, game), toughnessOf(attackedIbex, game)]).toEqual([6, 6]);
    expect([powerOf(pumpedBear, game), toughnessOf(pumpedBear, game)]).toEqual([5, 5]);
    expect(pumpedBear.temporaryKeywords).toContain("trample");
  });
});

describe("Oracle of Mul Daya's top-of-library land drop and public reveal", () => {
  const ORACLE_OF_MUL_DAYA = () => make({
    name: "Oracle of Mul Daya", type_line: "Creature — Human Shaman", mana_cost: "{2}{G}{G}", cmc: 4, power: "2", toughness: "2",
    oracle_text: "Play with the top card of your library revealed.\nYou may play lands from the top of your library.\nYou may play an additional land on each of your turns."
  });

  it("recognizes all three static lines", () => {
    expect(profileOf(ORACLE_OF_MUL_DAYA())).toMatchObject({
      fullyImplemented: true, playLandsFromTopOfLibrary: true, revealsTopOfLibrary: true, extraLandDropsPerTurn: 1
    });
  });

  it("offers and resolves playing a land straight from the top of the library", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [ORACLE_OF_MUL_DAYA()]);
    game = stage(game, 0, (player) => ({ library: [...toHand(0, [MOUNTAIN()], "mul-daya-top"), ...player.library] }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);

    const actions = legalActions(game, 0);
    expect(actions.some((entry) => entry.action.type === "play-land" && entry.action.cardId === "mul-daya-top-0")).toBe(true);

    const librarySizeBefore = game.players[0]!.library.length;
    game = applyAction(game, 0, { type: "play-land", cardId: "mul-daya-top-0" });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Mountain")).toBe(true);
    expect(game.players[0]!.library).toHaveLength(librarySizeBefore - 1);
  });

  it("does not offer a top-of-library land drop without the static permission", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, (player) => ({ library: [...toHand(0, [MOUNTAIN()], "no-mul-daya-top"), ...player.library] }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const actions = legalActions(game, 0);
    expect(actions.some((entry) => entry.action.type === "play-land" && entry.action.cardId === "no-mul-daya-top-0")).toBe(false);
  });

  it("exposes the controller's top library card publicly, including to the opponent's projection", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [ORACLE_OF_MUL_DAYA()]);
    game = stage(game, 0, (player) => ({ library: [...toHand(0, [MOUNTAIN()], "mul-daya-reveal"), ...player.library] }));
    const ownView = projectGame(game, 0).players[0]!;
    const opponentView = projectGame(game, 1).players[0]!;
    expect(ownView.revealedTopLibraryCard).toMatchObject({ name: "Mountain" });
    expect(opponentView.revealedTopLibraryCard).toMatchObject({ name: "Mountain" });
  });

  it("keeps the top card private for a player without the reveal static", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, (player) => ({ library: [...toHand(0, [MOUNTAIN()], "no-reveal"), ...player.library] }));
    expect(projectGame(game, 1).players[0]!.revealedTopLibraryCard).toBeUndefined();
  });
});

describe("Ramunap Excavator's graveyard land drop", () => {
  const RAMUNAP_EXCAVATOR = () => make({ name: "Ramunap Excavator", type_line: "Creature — Snake Cleric", mana_cost: "{2}{G}", cmc: 3, power: "2", toughness: "3", oracle_text: "You may play lands from your graveyard." });

  it("recognizes the static permission", () => {
    expect(profileOf(RAMUNAP_EXCAVATOR())).toMatchObject({ fullyImplemented: true, playLandsFromGraveyard: true });
  });

  it("offers and resolves playing a land straight from the graveyard", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [RAMUNAP_EXCAVATOR()]);
    game = stage(game, 0, (player) => ({ graveyard: [...toHand(0, [MOUNTAIN()], "excavator-yard"), ...player.graveyard] }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);

    const actions = legalActions(game, 0);
    expect(actions.some((entry) => entry.action.type === "play-land" && entry.action.cardId === "excavator-yard-0")).toBe(true);

    const graveyardSizeBefore = game.players[0]!.graveyard.length;
    game = applyAction(game, 0, { type: "play-land", cardId: "excavator-yard-0" });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Mountain")).toBe(true);
    expect(game.players[0]!.graveyard).toHaveLength(graveyardSizeBefore - 1);
  });

  it("does not offer a graveyard land drop without the static permission", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, (player) => ({ graveyard: [...toHand(0, [MOUNTAIN()], "no-excavator-yard"), ...player.graveyard] }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const actions = legalActions(game, 0);
    expect(actions.some((entry) => entry.action.type === "play-land" && entry.action.cardId === "no-excavator-yard-0")).toBe(false);
  });
});

describe("Ogre Battledriver pumps and hastes another entering creature", () => {
  const OGRE_BATTLEDRIVER = () => make({
    name: "Ogre Battledriver", type_line: "Creature — Ogre Warrior", mana_cost: "{3}{R}{R}", cmc: 5, power: "4", toughness: "4",
    oracle_text: "Whenever another creature you control enters, that creature gets +2/+0 and gains haste until end of turn."
  });

  it("recognizes the trigger with the event creature (not the source) as its target", () => {
    expect(profileOf(OGRE_BATTLEDRIVER())).toMatchObject({
      fullyImplemented: true,
      triggers: [{
        event: "enters-battlefield", subject: "another-creature-you-control",
        effect: { kind: "modify-event-creature-and-grant-keyword", power: 2, toughness: 0, keyword: "haste" }
      }]
    });
  });

  it("pumps and hastes a creature that enters after Ogre Battledriver, leaving Battledriver itself untouched", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [OGRE_BATTLEDRIVER(), FOREST(), FOREST()]);
    game = stage(game, 0, () => ({ hand: toHand(0, [BEAR()], "battledriver-hand") }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);

    game = applyAction(game, 0, { type: "cast", cardId: "battledriver-hand-0" });
    game = passUntil(game, (state) => state.stack.length === 0 && state.triggerQueue.length === 0 && state.pendingChoice === null);

    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    const battledriver = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Ogre Battledriver")!;
    expect([powerOf(bear, game), toughnessOf(bear, game)]).toEqual([4, 2]);
    expect(bear.temporaryKeywords).toContain("haste");
    expect([powerOf(battledriver, game), toughnessOf(battledriver, game)]).toEqual([4, 4]);
    expect(battledriver.temporaryKeywords ?? []).not.toContain("haste");
  });
});

describe("Reflecting Pool's board-dependent 'any type' mana", () => {
  const REFLECTING_POOL = () => make({ name: "Reflecting Pool", type_line: "Land", oracle_text: "{T}: Add one mana of any type that a land you control could produce." });

  it("recognizes 'any type' the same way as the existing 'any color' Fellwar Stone template", () => {
    const profile = profileOf(REFLECTING_POOL());
    expect(profile.manaAbilities[0]).toMatchObject({ anyColorFromLandsControlledBy: "you" });
    expect(profile.fullyImplemented).toBe(true);
  });

  it("computes its options from the controller's own other lands, including a colorless one", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [REFLECTING_POOL(), MOUNTAIN(), FOREST()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const pool = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Reflecting Pool")!;
    const options = manaSources(game.players[0]!, game).find((source) => source.permanentId === pool.instance_id)!.options;
    expect([...options].sort()).toEqual(["G", "R"]);
    game = applyAction(game, 0, { type: "activate-mana", sourceId: pool.instance_id, abilityIndex: 0, mana: "G" });
    expect(game.players[0]!.manaPool.G).toBe(1);
  });
});

describe("Vexing Shusher makes a target spell uncounterable", () => {
  const VEXING_SHUSHER = () => make({ name: "Vexing Shusher", type_line: "Creature — Goblin Shaman", mana_cost: "{1}{R}", cmc: 2, power: "2", toughness: "2", oracle_text: "{R/G}: Target spell can't be countered." });

  it("recognizes the activated ability targeting a spell on the stack", () => {
    const profile = profileOf(VEXING_SHUSHER());
    expect(profile.activatedAbilities[0]).toMatchObject({ effect: { kind: "make-target-spell-uncounterable" }, targetKind: "spell" });
    expect(profile.fullyImplemented).toBe(true);
  });

  it("protects a spell already on the stack from being countered", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 1, () => ({ hand: toHand(1, [BOLT()], "shusher-bolt"), autoPass: false }));
    game = putOnBattlefield(game, 1, [MOUNTAIN()]);
    game = putOnBattlefield(game, 0, [VEXING_SHUSHER(), MOUNTAIN(), FOREST()]);
    game = stage(game, 0, () => ({ autoPass: false }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 1 && state.prioritySeat === 1);
    game = applyAction(game, 1, { type: "cast", cardId: "shusher-bolt-0", targets: [{ kind: "player", seat: 0 }] });
    game = applyAction(game, 1, { type: "pass" });

    const shusher = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Vexing Shusher")!;
    const bolt = game.stack.find((entry) => entry.card.name === "Lightning Bolt")!;
    expect(canCounterSpell(bolt, game)).toBe(true);
    game = applyAction(game, 0, { type: "activate", sourceId: shusher.instance_id, abilityIndex: 0, targets: [{ kind: "spell", stackId: bolt.id }] });
    game = passUntil(game, (state) => state.stack.length === 1 || state.stack.length === 0);

    const protectedBolt = game.stack.find((entry) => entry.card.name === "Lightning Bolt")!;
    expect(protectedBolt.cantBeCountered).toBe(true);
    expect(canCounterSpell(protectedBolt, game)).toBe(false);
  });
});

describe("Garruk Wildspeaker's '+1: Untap two target lands'", () => {
  const GARRUK_WILDSPEAKER = () => make({
    name: "Garruk Wildspeaker", type_line: "Legendary Planeswalker — Garruk", mana_cost: "{2}{G}{G}", cmc: 4, loyalty: "3",
    oracle_text: "+1: Untap two target lands.\n−1: Create a 3/3 green Beast creature token.\n−4: Creatures you control get +3/+3 and gain trample until end of turn."
  });

  it("recognizes the +1 ability as a distinct two-land target", () => {
    const profile = profileOf(GARRUK_WILDSPEAKER());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.activatedAbilities[0]).toMatchObject({ loyaltyCost: 1, targetKind: "land", targetKinds: ["land", "land"], effect: { kind: "untap-target-permanent" } });
  });

  it("untaps exactly the two chosen lands and gains a loyalty counter", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [GARRUK_WILDSPEAKER(), FOREST(), FOREST(), FOREST()]);
    game = stage(game, 0, (player) => ({
      battlefield: player.battlefield.map((permanent) => permanent.card.name === "Forest"
        ? { ...permanent, tapped: true }
        : permanent.card.name === "Garruk Wildspeaker" ? { ...permanent, counters: { loyalty: 3 } } : permanent),
      autoPass: false
    }));
    const garruk = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Garruk Wildspeaker")!;
    const forests = game.players[0]!.battlefield.filter((permanent) => permanent.card.name === "Forest");
    game = applyAction(game, 0, {
      type: "activate", sourceId: garruk.instance_id, abilityIndex: 0,
      targets: [{ kind: "permanent", instanceId: forests[0]!.instance_id }, { kind: "permanent", instanceId: forests[1]!.instance_id }]
    });
    game = passUntil(game, (state) => state.stack.length === 0);

    const updated = game.players[0]!.battlefield;
    expect(updated.find((permanent) => permanent.instance_id === forests[0]!.instance_id)?.tapped).toBe(false);
    expect(updated.find((permanent) => permanent.instance_id === forests[1]!.instance_id)?.tapped).toBe(false);
    expect(updated.find((permanent) => permanent.instance_id === forests[2]!.instance_id)?.tapped).toBe(true);
    expect(updated.find((permanent) => permanent.instance_id === garruk.instance_id)?.counters.loyalty).toBe(4);
  });

  it("rejects choosing the same land for both target slots", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [GARRUK_WILDSPEAKER(), FOREST(), FOREST()]);
    game = stage(game, 0, () => ({ autoPass: false }));
    const garruk = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Garruk Wildspeaker")!;
    const forest = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Forest")!;
    expect(() => applyAction(game, 0, {
      type: "activate", sourceId: garruk.instance_id, abilityIndex: 0,
      targets: [{ kind: "permanent", instanceId: forest.instance_id }, { kind: "permanent", instanceId: forest.instance_id }]
    })).toThrow();
  });

  it("is not activatable with fewer than two lands in play", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [GARRUK_WILDSPEAKER(), FOREST()]);
    const garruk = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Garruk Wildspeaker")!;
    expect(legalActions(game, 0).some((entry) => entry.action.type === "activate" && entry.action.sourceId === garruk.instance_id && entry.action.abilityIndex === 0)).toBe(false);
  });
});

describe("Sensei's Divining Top's reorder-top and draw-then-return abilities", () => {
  const SENSEIS_TOP = () => make({
    name: "Sensei's Divining Top", type_line: "Artifact", mana_cost: "{1}",
    oracle_text: "{1}: Look at the top three cards of your library, then put them back in any order.\n{T}: Draw a card, then put this artifact on top of its owner's library."
  });

  it("recognizes both abilities", () => {
    const profile = profileOf(SENSEIS_TOP());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.activatedAbilities[0]).toMatchObject({ effect: { kind: "look-top-reorder", amount: 3 } });
    expect(profile.activatedAbilities[1]).toMatchObject({ effect: { kind: "draw-then-source-to-library-top" }, requiresTap: true });
  });

  it("opens a private reorder choice over the top three cards and applies a submitted order", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [SENSEIS_TOP(), FOREST()]);
    game = stage(game, 0, (player) => ({
      library: [...toHand(0, [BEAR(), SOL_RING(), ISLAND()], "top-reorder"), ...player.library],
      autoPass: false
    }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const top = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Sensei's Divining Top")!;
    game = applyAction(game, 0, { type: "activate", sourceId: top.instance_id, abilityIndex: 0 });
    game = passUntil(game, (state) => state.pendingChoice?.type === "reorder-top" || state.stack.length === 0);

    const choice = game.pendingChoice;
    expect(choice?.type).toBe("reorder-top");
    if (choice?.type !== "reorder-top") throw new Error("expected a pending reorder-top choice");
    expect(choice.cards.map((card) => card.name)).toEqual(["Grizzly Bears", "Sol Ring", "Island"]);

    const [bear, solRing, island] = choice.cards;
    game = applyAction(game, 0, { type: "reorder-top", sourceId: choice.sourceId, order: [island!.instance_id, bear!.instance_id, solRing!.instance_id] });
    expect(game.players[0]!.library.slice(0, 3).map((card) => card.name)).toEqual(["Island", "Grizzly Bears", "Sol Ring"]);
  });

  it("rejects a submitted order that omits or repeats a card", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [SENSEIS_TOP(), FOREST()]);
    game = stage(game, 0, (player) => ({
      library: [...toHand(0, [BEAR(), SOL_RING(), ISLAND()], "top-reorder-bad"), ...player.library],
      autoPass: false
    }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const top = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Sensei's Divining Top")!;
    game = applyAction(game, 0, { type: "activate", sourceId: top.instance_id, abilityIndex: 0 });
    game = passUntil(game, (state) => state.pendingChoice?.type === "reorder-top" || state.stack.length === 0);
    const choice = game.pendingChoice;
    if (choice?.type !== "reorder-top") throw new Error("expected a pending reorder-top choice");
    const ids = choice.cards.map((card) => card.instance_id);
    expect(() => applyAction(game, 0, { type: "reorder-top", sourceId: choice.sourceId, order: [ids[0]!, ids[0]!] })).toThrow();
  });

  it("draws a card, then returns itself to the top of its owner's library", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [SENSEIS_TOP()]);
    game = stage(game, 0, (player) => ({
      library: [...toHand(0, [BEAR()], "top-return"), ...player.library],
      autoPass: false
    }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const top = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Sensei's Divining Top")!;
    const handSizeBefore = game.players[0]!.hand.length;
    game = applyAction(game, 0, { type: "activate", sourceId: top.instance_id, abilityIndex: 1 });
    game = passUntil(game, (state) => state.stack.length === 0);

    expect(game.players[0]!.hand).toHaveLength(handSizeBefore + 1);
    expect(game.players[0]!.hand.some((card) => card.name === "Grizzly Bears")).toBe(true);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Sensei's Divining Top")).toBe(false);
    expect(game.players[0]!.library[0]?.name).toBe("Sensei's Divining Top");
  });
});

describe("Atarka, World Render's tribal double-strike attack trigger", () => {
  const ATARKA = () => make({
    name: "Atarka, World Render", type_line: "Legendary Creature — Dragon", mana_cost: "{4}{R}{R}{G}{G}", cmc: 8, power: "6", toughness: "6",
    keywords: ["flying", "trample"],
    oracle_text: "Flying, trample\nWhenever a Dragon you control attacks, it gains double strike until end of turn."
  });
  const SMALL_DRAGON = () => make({ name: "Small Dragon", type_line: "Creature — Dragon", mana_cost: "{2}{R}", cmc: 3, power: "2", toughness: "2" });

  it("recognizes the tribal attack trigger with a requireSubtype filter", () => {
    expect(profileOf(ATARKA())).toMatchObject({
      fullyImplemented: true,
      triggers: [{
        event: "attacks", subject: "creature-you-control", requireSubtype: "Dragon",
        effect: { kind: "modify-event-creature-and-grant-keyword", power: 0, toughness: 0, keyword: "double strike" }
      }]
    });
  });

  it("grants double strike to attacking Dragons but not a non-Dragon attacker", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [ATARKA(), SMALL_DRAGON(), BEAR()]);
    game = passUntil(game, (state) => state.step === "declare-attackers" && state.activeSeat === 0);
    const atarka = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Atarka, World Render")!;
    const dragon = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Small Dragon")!;
    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;

    game = applyAction(game, 0, {
      type: "declare-attackers",
      attackers: [
        { instanceId: atarka.instance_id, defender: 1 },
        { instanceId: dragon.instance_id, defender: 1 },
        { instanceId: bear.instance_id, defender: 1 }
      ]
    });
    game = passUntil(game, (state) => state.stack.length === 0);

    const updated = game.players[0]!.battlefield;
    expect(updated.find((permanent) => permanent.instance_id === atarka.instance_id)?.temporaryKeywords).toContain("double strike");
    expect(updated.find((permanent) => permanent.instance_id === dragon.instance_id)?.temporaryKeywords).toContain("double strike");
    expect(updated.find((permanent) => permanent.instance_id === bear.instance_id)?.temporaryKeywords ?? []).not.toContain("double strike");
    expect([powerOf(updated.find((permanent) => permanent.instance_id === atarka.instance_id)!, game), toughnessOf(updated.find((permanent) => permanent.instance_id === atarka.instance_id)!, game)]).toEqual([6, 6]);
  });
});

describe("Beastmaster Ascension's quest-counter anthem", () => {
  const BEASTMASTER_ASCENSION = () => make({
    name: "Beastmaster Ascension", type_line: "Enchantment", mana_cost: "{3}{G}", cmc: 4,
    oracle_text: "Whenever a creature you control attacks, you may put a quest counter on this enchantment.\nAs long as this enchantment has seven or more quest counters on it, creatures you control get +5/+5."
  });

  it("recognizes the trigger and the counter-gated anthem", () => {
    const profile = profileOf(BEASTMASTER_ASCENSION());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.triggers[0]).toMatchObject({ event: "attacks", subject: "creature-you-control", optional: true, effect: { kind: "add-counter-source", counter: "quest", amount: 1 } });
    expect(profile.staticPowerToughnessGrants).toMatchObject([{ scope: "creatures-you-control-source-counter-threshold", power: 5, toughness: 5, threshold: 7, counterName: "quest" }]);
  });

  it("grants no bonus below seven quest counters and +5/+5 to every controlled creature at seven or more", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [BEASTMASTER_ASCENSION(), BEAR(), BEAR()]);
    game = stage(game, 0, (player) => ({
      battlefield: player.battlefield.map((permanent) => permanent.card.name === "Beastmaster Ascension" ? { ...permanent, counters: { quest: 6 } } : permanent)
    }));
    const bears = game.players[0]!.battlefield.filter((permanent) => permanent.card.name === "Grizzly Bears");
    for (const bear of bears) expect([powerOf(bear, game), toughnessOf(bear, game)]).toEqual([2, 2]);

    game = stage(game, 0, (player) => ({
      battlefield: player.battlefield.map((permanent) => permanent.card.name === "Beastmaster Ascension" ? { ...permanent, counters: { quest: 7 } } : permanent)
    }));
    const updatedBears = game.players[0]!.battlefield.filter((permanent) => permanent.card.name === "Grizzly Bears");
    for (const bear of updatedBears) expect([powerOf(bear, game), toughnessOf(bear, game)]).toEqual([7, 7]);
  });
});

describe("Forbidden Orchard's mana-tap gift to an opponent", () => {
  const FORBIDDEN_ORCHARD = () => make({
    name: "Forbidden Orchard", type_line: "Land",
    oracle_text: "{T}: Add one mana of any color.\nWhenever you tap this land for mana, target opponent creates a 1/1 colorless Spirit creature token."
  });

  it("recognizes the mana-tap trigger, targeting the opponent for a colorless Spirit token", () => {
    const profile = profileOf(FORBIDDEN_ORCHARD());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.triggers[0]).toMatchObject({
      event: "taps-for-mana", subject: "self", targetKind: "opponent",
      effect: { kind: "create-token-for-target-player", token: { name: "Spirit", typeLine: "Creature — Spirit", colors: [] } }
    });
  });

  it("gives the opponent a 1/1 Spirit token when tapped for mana, but not on a non-mana tap", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [FORBIDDEN_ORCHARD()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const orchard = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Forbidden Orchard")!;

    game = applyAction(game, 0, { type: "activate-mana", sourceId: orchard.instance_id, abilityIndex: 0, mana: "G" });
    game = passUntil(game, (state) => state.triggerQueue.length === 0 && state.pendingChoice === null && state.stack.length === 0);

    expect(game.players[0]!.manaPool.G).toBe(1);
    expect(game.players[1]!.battlefield.some((permanent) => permanent.card.name === "Spirit")).toBe(true);
  });

  it("does not trigger from a plain non-mana tap", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [FORBIDDEN_ORCHARD()]);
    game = stage(game, 0, (player) => ({
      battlefield: player.battlefield.map((permanent) => permanent.card.name === "Forbidden Orchard" ? { ...permanent, tapped: true } : permanent)
    }));
    expect(game.players[1]!.battlefield.some((permanent) => permanent.card.name === "Spirit")).toBe(false);
  });
});

describe("Lotus Cobra's Landfall any-color mana", () => {
  const LOTUS_COBRA = () => make({
    name: "Lotus Cobra", type_line: "Creature — Snake", mana_cost: "{1}{G}", cmc: 2, power: "2", toughness: "1",
    oracle_text: "Landfall — Whenever a land you control enters, add one mana of any color."
  });

  it("recognizes the landfall trigger as a chosen-color mana add", () => {
    const profile = profileOf(LOTUS_COBRA());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.triggers[0]).toMatchObject({ event: "enters-battlefield", subject: "land-you-control", effect: { kind: "add-mana-any-color" } });
  });

  it("opens a color choice on landfall, adds the chosen mana, and leaves Lotus Cobra on the battlefield", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [LOTUS_COBRA()]);
    game = stage(game, 0, () => ({ hand: toHand(0, [FOREST()], "cobra-land"), autoPass: false }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);

    game = applyAction(game, 0, { type: "play-land", cardId: "cobra-land-0" });
    game = passUntil(game, (state) => state.pendingChoice?.type === "choose-color");
    expect(game.pendingChoice?.type).toBe("choose-color");
    const choice = game.pendingChoice;
    if (choice?.type !== "choose-color") throw new Error("expected a pending choose-color choice");

    game = applyAction(game, 0, { type: "choose-color", sourceId: choice.sourceId, color: "U" });
    expect(game.players[0]!.manaPool.U).toBe(1);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Lotus Cobra")).toBe(true);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Lotus Cobra")).toBe(false);
  });
});

describe("Mana Crypt's upkeep coin flip", () => {
  const MANA_CRYPT = () => make({
    name: "Mana Crypt", type_line: "Artifact", mana_cost: "{0}", cmc: 0,
    oracle_text: "At the beginning of your upkeep, flip a coin. If you lose the flip, this artifact deals 3 damage to you.\n{T}: Add {C}{C}."
  });

  it("recognizes both the coin-flip trigger and the mana ability", () => {
    const profile = profileOf(MANA_CRYPT());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.triggers[0]).toMatchObject({ event: "upkeep", subject: "you", effect: { kind: "coin-flip-self-damage-if-lost", amount: 3 } });
    expect(profile.manaAbilities[0]).toMatchObject({ produces: ["C"], amount: 2 });
  });

  it("deals 3 damage when the flip is lost", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [MANA_CRYPT()]);
    game = { ...game, rngState: 0 };
    game = passUntil(game, (state) => state.players[0]!.life !== 40, 60);
    expect(game.players[0]!.life).toBe(37);
  });

  it("deals no damage when the flip is won", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [MANA_CRYPT()]);
    game = { ...game, rngState: 682 };
    game = passUntil(game, (state) => state.turn >= 4, 60);
    expect(game.players[0]!.life).toBe(40);
  });
});

describe("Pattern of Rebirth's dies-triggered reanimation tutor", () => {
  const PATTERN_OF_REBIRTH = () => make({
    name: "Pattern of Rebirth", type_line: "Enchantment — Aura", mana_cost: "{2}{G}", cmc: 3,
    oracle_text: "Enchant creature\nWhen enchanted creature dies, that creature's controller may search their library for a creature card, put that card onto the battlefield, then shuffle."
  });

  it("wires 'enchanted creature dies' to a new enchanted-creature trigger subject", () => {
    const profile = profileOf(PATTERN_OF_REBIRTH());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.triggers[0]).toMatchObject({
      event: "dies", subject: "enchanted-creature", optional: true, choiceBy: "event-controller",
      effect: { kind: "search-library", types: ["Creature"], destination: "battlefield" }
    });
  });

  it("lets the fallen creature's controller tutor a replacement onto the battlefield", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [BEAR(), FOREST(), FOREST(), FOREST(), MOUNTAIN()]);
    game = stage(game, 0, (player) => ({
      hand: toHand(0, [PATTERN_OF_REBIRTH(), BOLT()], "pattern-hand"),
      library: [...toHand(0, [SOL_RING(), TRAMPLER()], "pattern-library"), ...player.library]
    }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;

    game = applyAction(game, 0, { type: "cast", cardId: "pattern-hand-0", targets: [{ kind: "permanent", instanceId: bear.instance_id }] });
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Pattern of Rebirth")?.attachedTo).toBe(bear.instance_id);

    game = applyAction(game, 0, { type: "cast", cardId: "pattern-hand-1", targets: [{ kind: "permanent", instanceId: bear.instance_id }] });
    game = passUntil(game, (state) => state.pendingChoice?.type === "search-library");
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Grizzly Bears")).toBe(false);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);

    const choice = game.pendingChoice as Extract<typeof game.pendingChoice, { type: "search-library" }>;
    const legalNames = game.players[0]!.library.filter((card) => choice.optionIds.includes(card.instance_id)).map((card) => card.name);
    expect(legalNames).toContain("Big Stomper");
    expect(legalNames).not.toContain("Sol Ring");

    game = applyAction(game, 0, { type: "choose-library-card", sourceId: choice.sourceId, query: "Big Stomper" });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Big Stomper")).toBe(true);
  });
});

describe("triggered tutors preserve mana-value caps", () => {
  const TRIGGERED_MANA_CAP_TUTOR = () => make({
    name: "Triggered Mana Cap Tutor", type_line: "Creature — Human", mana_cost: "{2}{G}", cmc: 3,
    power: "2", toughness: "2",
    oracle_text: "When Triggered Mana Cap Tutor enters, you may search your library for a creature card with mana value X or less, put it onto the battlefield, then shuffle."
  });

  it("filters the triggered search options by the printed mana-value cap", () => {
    const profile = profileOf(TRIGGERED_MANA_CAP_TUTOR());
    expect(profile.triggers[0]).toMatchObject({
      effect: { kind: "search-library", types: ["Creature"], maxManaValue: "X", destination: "battlefield" }
    });
  });
});

describe("Survival of the Fittest's creature-only discard-tutor", () => {
  const SURVIVAL_OF_THE_FITTEST = () => make({
    name: "Survival of the Fittest", type_line: "Enchantment", mana_cost: "{1}{G}", cmc: 2,
    oracle_text: "{G}, Discard a creature card: Search your library for a creature card, reveal that card, put it into your hand, then shuffle."
  });

  it("recognizes the creature-only discard cost and the search effect", () => {
    const profile = profileOf(SURVIVAL_OF_THE_FITTEST());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.activatedAbilities[0]).toMatchObject({
      discardsCreatureCard: true,
      effect: { kind: "search-library", types: ["Creature"], destination: "hand", reveal: true }
    });
  });

  it("discards a creature card and tutors a different creature into hand, refusing a non-creature discard", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [SURVIVAL_OF_THE_FITTEST(), FOREST()]);
    game = stage(game, 0, (player) => ({
      hand: toHand(0, [BEAR(), SOL_RING()], "survival-hand"),
      library: [...toHand(0, [TRAMPLER()], "survival-library"), ...player.library],
      autoPass: false
    }));
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Survival of the Fittest")!;

    expect(legalActions(game, 0).some((entry) => entry.action.type === "activate"
      && entry.action.sourceId === source.instance_id && entry.action.discardCardId === "survival-hand-1")).toBe(false);

    game = applyAction(game, 0, { type: "activate", sourceId: source.instance_id, abilityIndex: 0, discardCardId: "survival-hand-0" });
    expect(game.players[0]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);
    game = passUntil(game, (state) => state.pendingChoice?.type === "search-library");

    const choice = game.pendingChoice as Extract<typeof game.pendingChoice, { type: "search-library" }>;
    const legalNames = game.players[0]!.library.filter((card) => choice.optionIds.includes(card.instance_id)).map((card) => card.name);
    expect(legalNames).toEqual(["Big Stomper"]);

    game = applyAction(game, 0, { type: "choose-library-card", sourceId: choice.sourceId, query: "Big Stomper" });
    expect(game.players[0]!.hand.some((card) => card.name === "Big Stomper")).toBe(true);
  });
});

describe("Beseech the Queen's land-count-capped tutor", () => {
  const BESEECH_THE_QUEEN = () => make({
    name: "Beseech the Queen", type_line: "Sorcery", mana_cost: "{2}{B}", cmc: 3,
    oracle_text: "Search your library for a card with mana value less than or equal to the number of lands you control, reveal it, put it into your hand, then shuffle."
  });

  it("recognizes the land-count cap as a search-library restriction", () => {
    const profile = profileOf(BESEECH_THE_QUEEN());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.effects[0]).toMatchObject({ kind: "search-library", types: [], maxManaValue: "lands-you-control", destination: "hand", reveal: true });
  });

  it("offers only cards at or under the controller's land count", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [SWAMP(), SWAMP(), SWAMP()]);
    game = stage(game, 0, (player) => ({
      hand: toHand(0, [BESEECH_THE_QUEEN()], "beseech-hand"),
      library: [...toHand(0, [SOL_RING(), BEAR(), TRAMPLER()], "beseech-library"), ...player.library],
      autoPass: false
    }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);

    game = applyAction(game, 0, { type: "cast", cardId: "beseech-hand-0" });
    game = passUntil(game, (state) => state.pendingChoice?.type === "search-library");

    const choice = game.pendingChoice as Extract<typeof game.pendingChoice, { type: "search-library" }>;
    const legalNames = game.players[0]!.library.filter((card) => choice.optionIds.includes(card.instance_id)).map((card) => card.name);
    expect(legalNames).toContain("Grizzly Bears");
    expect(legalNames).toContain("Sol Ring");
    expect(legalNames).not.toContain("Big Stomper");

    game = applyAction(game, 0, { type: "choose-library-card", sourceId: choice.sourceId, query: "Sol Ring" });
    expect(game.players[0]!.hand.some((card) => card.name === "Sol Ring")).toBe(true);
  });
});

describe("Protean Hulk's any-number total-mana-value reanimation", () => {
  const PROTEAN_HULK = () => make({
    name: "Protean Hulk", type_line: "Creature — Shapeshifter", mana_cost: "{4}{G}{G}", cmc: 6, power: "6", toughness: "1",
    oracle_text: "When this creature dies, search your library for any number of creature cards with total mana value 6 or less, put them onto the battlefield, then shuffle."
  });

  it("recognizes the dies trigger as an open-ended total-mana-value search", () => {
    const profile = profileOf(PROTEAN_HULK());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.triggers[0]).toMatchObject({
      event: "dies", subject: "self",
      effect: { kind: "search-library-multi", types: ["Creature"], destinations: ["battlefield"], maxTotalManaValue: 6 }
    });
  });

  it("lets the controller pick multiple creatures under the budget, rejects exceeding it, and battlefields them untapped", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [PROTEAN_HULK(), MOUNTAIN()]);
    game = stage(game, 0, (player) => ({
      hand: toHand(0, [BOLT()], "hulk-hand"),
      library: [...toHand(0, [BEAR(), BEAR(), TRAMPLER()], "hulk-library"), ...player.library],
      autoPass: false
    }));
    const hulk = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Protean Hulk")!;
    game = applyAction(game, 0, { type: "cast", cardId: "hulk-hand-0", targets: [{ kind: "permanent", instanceId: hulk.instance_id }] });
    game = passUntil(game, (state) => state.pendingChoice?.type === "search-library-multi");

    let choice = game.pendingChoice as Extract<typeof game.pendingChoice, { type: "search-library-multi" }>;
    game = applyAction(game, 0, { type: "choose-library-card", sourceId: choice.sourceId, query: "Grizzly Bears" });
    choice = game.pendingChoice as Extract<typeof game.pendingChoice, { type: "search-library-multi" }>;
    game = applyAction(game, 0, { type: "choose-library-card", sourceId: choice.sourceId, query: "Grizzly Bears" });

    expect(() => applyAction(game, 0, { type: "choose-library-card", sourceId: choice.sourceId, query: "Big Stomper" })).toThrow();

    game = applyAction(game, 0, { type: "finish-library-search", sourceId: choice.sourceId });
    const bears = game.players[0]!.battlefield.filter((permanent) => permanent.card.name === "Grizzly Bears");
    expect(bears).toHaveLength(2);
    expect(bears.every((bear) => !bear.tapped)).toBe(true);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Big Stomper")).toBe(false);
  });
});

describe("Somberwald Sage's creature-spell-restricted triple mana", () => {
  const SOMBERWALD_SAGE = () => make({
    name: "Somberwald Sage", type_line: "Creature — Human Druid", mana_cost: "{2}{G}", cmc: 3, power: "1", toughness: "1",
    oracle_text: "{T}: Add three mana of any one color. Spend this mana only to cast creature spells.",
    produced_mana: ["B", "C", "G", "R", "U", "W"]
  });

  it("recognizes the tap ability with a creature-spell mana restriction", () => {
    const profile = profileOf(SOMBERWALD_SAGE());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.manaAbilities[0]).toMatchObject({
      produces: ["W", "U", "B", "R", "G"], amount: 3, manaRestriction: { kind: "creature-spell" }
    });
  });

  it("blocks a noncreature spell but allows a creature spell to spend the restricted mana", () => {
    const noncreatureSpell = make({ name: "Ordinary Bolt", type_line: "Instant", mana_cost: "{R}", cmc: 1 });
    const creatureSpell = make({ name: "Ordinary Bear", type_line: "Creature — Bear", mana_cost: "{1}{G}", cmc: 2, power: "2", toughness: "2" });

    let blocked = twoSeatGame([], []);
    blocked = stage(blocked, 0, () => ({ hand: toHand(0, [noncreatureSpell]), autoPass: false }));
    blocked = putOnBattlefield(blocked, 0, [SOMBERWALD_SAGE()]);
    blocked = passUntil(blocked, (state) => state.step === "precombat-main" && state.prioritySeat === 0);
    const source = blocked.players[0]!.battlefield.find((permanent) => permanent.card.name === "Somberwald Sage")!;
    const activate = legalActions(blocked, 0).find((entry) => entry.action.type === "activate-mana"
      && entry.action.sourceId === source.instance_id && entry.action.mana === "R")!;
    blocked = applyAction(blocked, 0, activate.action);
    expect(blocked.players[0]!.restrictedMana).toMatchObject([
      { type: "R", restriction: { kind: "creature-spell" } },
      { type: "R", restriction: { kind: "creature-spell" } },
      { type: "R", restriction: { kind: "creature-spell" } }
    ]);
    expect(legalActions(blocked, 0).some((entry) => entry.action.type === "cast" && entry.action.cardId === "hand-0")).toBe(false);

    let allowed = twoSeatGame([], []);
    allowed = stage(allowed, 0, () => ({ hand: toHand(0, [creatureSpell]), autoPass: false }));
    allowed = putOnBattlefield(allowed, 0, [SOMBERWALD_SAGE()]);
    allowed = passUntil(allowed, (state) => state.step === "precombat-main" && state.prioritySeat === 0);
    const allowedSource = allowed.players[0]!.battlefield.find((permanent) => permanent.card.name === "Somberwald Sage")!;
    const allowedActivate = legalActions(allowed, 0).find((entry) => entry.action.type === "activate-mana"
      && entry.action.sourceId === allowedSource.instance_id && entry.action.mana === "G")!;
    allowed = applyAction(allowed, 0, allowedActivate.action);
    const cast = legalActions(allowed, 0).find((entry) => entry.action.type === "cast" && entry.action.cardId === "hand-0")!;
    expect(cast).toBeDefined();
    allowed = applyAction(allowed, 0, cast.action);
    expect(allowed.stack.some((entry) => entry.card.name === "Ordinary Bear")).toBe(true);
  });
});

describe("Food Chain's exile-a-creature mana ability", () => {
  const FOOD_CHAIN = () => make({
    name: "Food Chain", type_line: "Enchantment", mana_cost: "{2}{G}", cmc: 3,
    oracle_text: "Exile a creature you control: Add X mana of any one color, where X is 1 plus the exiled creature's mana value. Spend this mana only to cast creature spells.",
    produced_mana: ["B", "C", "G", "R", "U", "W"]
  });

  it("recognizes the exile-a-creature ability with a mana-value-derived amount and creature-spell restriction", () => {
    const profile = profileOf(FOOD_CHAIN());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.manaAbilities[0]).toMatchObject({
      produces: ["W", "U", "B", "R", "G"], exilesCreature: true, amountFromExiledManaValuePlusOne: true,
      manaRestriction: { kind: "creature-spell" }
    });
  });

  it("exiles the chosen creature, adds mana equal to 1 plus its mana value, and only creature spells may spend it", () => {
    const noncreatureSpell = make({ name: "Ordinary Bolt", type_line: "Instant", mana_cost: "{R}", cmc: 1 });
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ hand: toHand(0, [noncreatureSpell]), autoPass: false }));
    game = putOnBattlefield(game, 0, [FOOD_CHAIN(), BEAR()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.prioritySeat === 0);
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Food Chain")!;
    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    const activate = legalActions(game, 0).find((entry) => entry.action.type === "activate-mana"
      && entry.action.sourceId === source.instance_id && entry.action.exileId === bear.instance_id && entry.action.mana === "R")!;
    expect(activate).toBeDefined();
    game = applyAction(game, 0, activate.action);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Grizzly Bears")).toBe(false);
    expect(game.players[0]!.exile.some((card) => card.name === "Grizzly Bears")).toBe(true);
    expect(game.players[0]!.restrictedMana).toMatchObject([
      { type: "R", restriction: { kind: "creature-spell" } },
      { type: "R", restriction: { kind: "creature-spell" } },
      { type: "R", restriction: { kind: "creature-spell" } }
    ]);
    expect(legalActions(game, 0).some((entry) => entry.action.type === "cast" && entry.action.cardId === "hand-0")).toBe(false);

    let allowed = twoSeatGame([], []);
    const creatureSpell = make({ name: "Ordinary Elf", type_line: "Creature — Elf", mana_cost: "{2}{G}", cmc: 3, power: "2", toughness: "2" });
    allowed = stage(allowed, 0, () => ({ hand: toHand(0, [creatureSpell]), autoPass: false }));
    allowed = putOnBattlefield(allowed, 0, [FOOD_CHAIN(), BEAR()]);
    allowed = passUntil(allowed, (state) => state.step === "precombat-main" && state.prioritySeat === 0);
    const allowedSource = allowed.players[0]!.battlefield.find((permanent) => permanent.card.name === "Food Chain")!;
    const allowedBear = allowed.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    const allowedActivate = legalActions(allowed, 0).find((entry) => entry.action.type === "activate-mana"
      && entry.action.sourceId === allowedSource.instance_id && entry.action.exileId === allowedBear.instance_id && entry.action.mana === "G")!;
    allowed = applyAction(allowed, 0, allowedActivate.action);
    expect(allowed.players[0]!.manaPool.G).toBe(0);
    const cast = legalActions(allowed, 0).find((entry) => entry.action.type === "cast" && entry.action.cardId === "hand-0")!;
    expect(cast).toBeDefined();
    allowed = applyAction(allowed, 0, cast.action);
    expect(allowed.stack.some((entry) => entry.card.name === "Ordinary Elf")).toBe(true);
  });
});

describe("Eldritch Evolution's sacrifice-scaled creature tutor", () => {
  const ELDRITCH_EVOLUTION = () => make({
    name: "Eldritch Evolution", type_line: "Sorcery", mana_cost: "{1}{G}{G}", cmc: 3,
    oracle_text: "As an additional cost to cast this spell, sacrifice a creature.\nSearch your library for a creature card with mana value X or less, where X is 2 plus the sacrificed creature's mana value. Put that card onto the battlefield, then shuffle. Exile Eldritch Evolution."
  });

  it("recognizes the sacrifice-scaled search and the self-exile rider", () => {
    const profile = profileOf(ELDRITCH_EVOLUTION());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.additionalCostSacrificeCreature).toBe(true);
    expect(profile.effects).toEqual([
      { kind: "search-library", types: ["Creature"], maxManaValue: "sacrificed-creature-value", manaValueOffset: 2, destination: "battlefield", reveal: false },
      { kind: "exile-self" }
    ]);
  });

  it("caps the search at 2 plus the sacrificed creature's mana value and exiles itself instead of the graveyard", () => {
    const fourDrop = make({ name: "Test Four Drop", type_line: "Creature — Giant", mana_cost: "{4}", cmc: 4, power: "4", toughness: "4" });
    const fiveDrop = make({ name: "Test Five Drop", type_line: "Creature — Giant", mana_cost: "{5}", cmc: 5, power: "5", toughness: "5" });
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [BEAR(), FOREST(), FOREST(), FOREST()]);
    game = stage(game, 0, (player) => ({
      hand: toHand(0, [ELDRITCH_EVOLUTION()]),
      library: [...toHand(0, [fiveDrop, fourDrop], "library"), ...player.library]
    }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    const cast = legalActions(game, 0).find((entry) => entry.action.type === "cast" && entry.action.cardId === "hand-0" && entry.action.sacrificeId === bear.instance_id)!;
    expect(cast).toBeDefined();
    game = applyAction(game, 0, cast.action);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);
    expect(game.pendingChoice).toMatchObject({ type: "search-library" });
    expect(() => applyAction(game, 0, { type: "choose-library-card", sourceId: game.pendingChoice!.sourceId, query: "Test Five Drop" })).toThrow();
    game = applyAction(game, 0, { type: "choose-library-card", sourceId: game.pendingChoice!.sourceId, query: "Test Four Drop" });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Test Four Drop")).toBe(true);
    expect(game.players[0]!.exile.some((card) => card.name === "Eldritch Evolution")).toBe(true);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Eldritch Evolution")).toBe(false);
  });
});

describe("Birthing Pod's sacrifice-scaled creature tutor", () => {
  const BIRTHING_POD = () => make({
    name: "Birthing Pod", type_line: "Artifact", mana_cost: "{3}{G/P}", cmc: 4,
    oracle_text: "({G/P} can be paid with either {G} or 2 life.)\n{1}{G/P}, {T}, Sacrifice a creature: Search your library for a creature card with mana value equal to 1 plus the sacrificed creature's mana value, put that card onto the battlefield, then shuffle. Activate only as a sorcery."
  });

  it("recognizes the sacrifice-scaled activated ability with a sorcery-speed restriction", () => {
    const profile = profileOf(BIRTHING_POD());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.activatedAbilities[0]).toMatchObject({
      requiresTap: true, sacrificesCreature: "any", sorcerySpeed: true,
      effect: { kind: "search-library", types: ["Creature"], maxManaValue: "sacrificed-creature-value", manaValueOffset: 1, exactManaValue: true, destination: "battlefield" }
    });
  });

  it("finds a creature with mana value exactly one more than the sacrificed creature and stays on the battlefield", () => {
    const threeDrop = make({ name: "Test Three Drop", type_line: "Creature — Giant", mana_cost: "{3}", cmc: 3, power: "3", toughness: "3" });
    const fourDrop = make({ name: "Test Four Drop", type_line: "Creature — Giant", mana_cost: "{4}", cmc: 4, power: "4", toughness: "4" });
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [BIRTHING_POD(), BEAR(), FOREST(), FOREST()]);
    game = stage(game, 0, (player) => ({
      library: [...toHand(0, [fourDrop, threeDrop], "library"), ...player.library],
      autoPass: false
    }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const pod = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Birthing Pod")!;
    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate"
      && entry.action.sourceId === pod.instance_id && entry.action.sacrificeId === bear.instance_id)!;
    expect(activation).toBeDefined();
    game = applyAction(game, 0, activation.action);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);
    game = passUntil(game, (state) => state.pendingChoice?.type === "search-library");
    expect(game.pendingChoice).toMatchObject({ type: "search-library" });
    expect(() => applyAction(game, 0, { type: "choose-library-card", sourceId: game.pendingChoice!.sourceId, query: "Test Four Drop" })).toThrow();
    game = applyAction(game, 0, { type: "choose-library-card", sourceId: game.pendingChoice!.sourceId, query: "Test Three Drop" });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Test Three Drop")).toBe(true);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Birthing Pod")).toBe(true);
  });
});

describe("Sidisi, Undead Vizier's Exploit ETB and its own exploited-creature trigger", () => {
  const SIDISI = () => make({
    name: "Sidisi, Undead Vizier", type_line: "Legendary Creature — Zombie Snake", mana_cost: "{3}{B}{B}", cmc: 5, power: "4", toughness: "5",
    keywords: ["Deathtouch", "Exploit"],
    oracle_text: "Deathtouch\nExploit (When this creature enters, you may sacrifice a creature.)\nWhen Sidisi exploits a creature, you may search your library for a card, put it into your hand, then shuffle."
  });

  it("recognizes both the synthesized Exploit ETB and its own exploited-creature search trigger", () => {
    const profile = profileOf(SIDISI());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.keywords).toContain("deathtouch");
    expect(profile.triggers).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: "enters-battlefield", subject: "self", effect: { kind: "exploit" } }),
      expect.objectContaining({ event: "exploits", subject: "self", effect: { kind: "search-library", types: [], destination: "hand", reveal: false } })
    ]));
  });

  it("lets the controller decline the sacrifice, offering no search", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ hand: toHand(0, [SIDISI()]), autoPass: false }));
    game = putOnBattlefield(game, 0, [BEAR(), SWAMP(), SWAMP(), SWAMP(), SWAMP(), SWAMP()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.prioritySeat === 0);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = passUntil(game, (state) => state.pendingChoice?.type === "exploit");
    const choice = game.pendingChoice!;
    game = applyAction(game, 0, { type: "choose-exploit", sourceId: choice.sourceId });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Grizzly Bears")).toBe(true);
    expect(game.pendingChoice).toBeNull();
  });

  it("exploiting a creature raises the search for Sidisi's own exploited-creature trigger", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, (player) => ({
      hand: toHand(0, [SIDISI()], "sidisi-hand"),
      library: [...toHand(0, [SOL_RING()], "sidisi-library"), ...player.library],
      autoPass: false
    }));
    game = putOnBattlefield(game, 0, [BEAR(), SWAMP(), SWAMP(), SWAMP(), SWAMP(), SWAMP()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.prioritySeat === 0);
    game = applyAction(game, 0, { type: "cast", cardId: "sidisi-hand-0" });
    game = passUntil(game, (state) => state.pendingChoice?.type === "exploit");
    const exploitChoice = game.pendingChoice!;
    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    game = applyAction(game, 0, { type: "choose-exploit", sourceId: exploitChoice.sourceId, sacrificeId: bear.instance_id });
    expect(game.players[0]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);
    game = passUntil(game, (state) => state.pendingChoice?.type === "search-library");
    const searchChoice = game.pendingChoice!;
    game = applyAction(game, 0, { type: "choose-library-card", sourceId: searchChoice.sourceId, query: "Sol Ring" });
    expect(game.players[0]!.hand.some((card) => card.name === "Sol Ring")).toBe(true);
  });
});

describe("Necropotence's skipped draw, discard-exile trigger, and delayed-hand exile ability", () => {
  const NECROPOTENCE = () => make({
    name: "Necropotence", type_line: "Enchantment", mana_cost: "{B}{B}{B}", cmc: 3,
    oracle_text: "Skip your draw step.\nWhenever you discard a card, exile that card from your graveyard.\nPay 1 life: Exile the top card of your library face down. Put that card into your hand at the beginning of your next end step."
  });
  const PLAIN_CYCLER = () => make({ name: "Test Cycler", type_line: "Sorcery", mana_cost: "{2}{U}", cmc: 3, oracle_text: "Cycling {1}" });

  it("recognizes all three lines: skip draw, discard-exile trigger, and the delayed pay-life ability", () => {
    const profile = profileOf(NECROPOTENCE());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.staticSkipsDrawStep).toBe(true);
    expect(profile.triggers[0]).toMatchObject({ event: "card-discarded", subject: "you", effect: { kind: "exile-event-card-from-graveyard" } });
    expect(profile.activatedAbilities[0]).toMatchObject({ lifeCost: 1, manaCost: null, effect: { kind: "exile-top-card-then-hand-next-end-step" } });
  });

  it("skips the controller's mandatory draw for the turn", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [NECROPOTENCE()]);
    const before = game.players[0]!.library.length;
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    expect(game.players[0]!.library.length).toBe(before);
  });

  it("exiles a discarded card straight out of the graveyard", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ hand: toHand(0, [PLAIN_CYCLER()]), autoPass: false }));
    game = putOnBattlefield(game, 0, [NECROPOTENCE(), FOREST()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.prioritySeat === 0);
    game = applyAction(game, 0, { type: "cycle", cardId: "hand-0" });
    game = passUntil(game, (state) => state.stack.length === 0 && state.triggerQueue.length === 0);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Test Cycler")).toBe(false);
    expect(game.players[0]!.exile.some((card) => card.name === "Test Cycler")).toBe(true);
  });

  it("exiles the top card face down and delivers it to hand at the next end step", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [NECROPOTENCE()]);
    game = stage(game, 0, () => ({ autoPass: false }));
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const source = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Necropotence")!;
    const topCard = game.players[0]!.library[0]!;
    const life = game.players[0]!.life;
    const activation = legalActions(game, 0).find((entry) => entry.action.type === "activate" && entry.action.sourceId === source.instance_id)!;
    expect(activation).toBeDefined();
    game = applyAction(game, 0, activation.action);
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[0]!.life).toBe(life - 1);
    expect(game.players[0]!.exile.some((card) => card.instance_id === topCard.instance_id)).toBe(true);
    expect(game.players[0]!.hand.some((card) => card.instance_id === topCard.instance_id)).toBe(false);
    game = passUntil(game, (state) => state.players[0]!.hand.some((card) => card.instance_id === topCard.instance_id));
    expect(game.players[0]!.exile.some((card) => card.instance_id === topCard.instance_id)).toBe(false);
  });
});

describe("Body Snatcher's discard-or-exile ETB and its dies-triggered reanimation", () => {
  const BODY_SNATCHER = () => make({
    name: "Body Snatcher", type_line: "Creature — Phyrexian Minion", mana_cost: "{2}{B}{B}", cmc: 4, power: "3", toughness: "2",
    oracle_text: "When this creature enters, exile it unless you discard a creature card.\nWhen this creature dies, exile it and return target creature card from your graveyard to the battlefield."
  });

  it("recognizes both the discard-or-exile ETB and the dies-triggered reanimation", () => {
    const profile = profileOf(BODY_SNATCHER());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.triggers[0]).toMatchObject({ event: "enters-battlefield", subject: "self", effect: { kind: "exile-source-permanent" }, unlessDiscardCreatureCard: true });
    expect(profile.triggers[1]).toMatchObject({
      event: "dies", subject: "self", targetKind: "creature-card-in-your-graveyard",
      effect: { kind: "compound", effects: [{ kind: "exile-source-from-graveyard" }, { kind: "return-target-creature-card-from-graveyard-to-battlefield" }] }
    });
  });

  it("exiles itself when the controller declines to discard a creature card", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ hand: toHand(0, [BODY_SNATCHER()]), autoPass: false }));
    game = putOnBattlefield(game, 0, [SWAMP(), SWAMP(), SWAMP(), SWAMP()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.prioritySeat === 0);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = passUntil(game, (state) => state.pendingChoice?.type === "optional-trigger");
    const choice = game.pendingChoice!;
    game = applyAction(game, 0, { type: "choose-trigger", sourceId: choice.sourceId, accept: false });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Body Snatcher")).toBe(false);
    expect(game.players[0]!.exile.some((card) => card.name === "Body Snatcher")).toBe(true);
  });

  it("stays on the battlefield when the controller discards a creature card instead", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ hand: toHand(0, [BODY_SNATCHER(), BEAR()]), autoPass: false }));
    game = putOnBattlefield(game, 0, [SWAMP(), SWAMP(), SWAMP(), SWAMP()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.prioritySeat === 0);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = passUntil(game, (state) => state.pendingChoice?.type === "optional-trigger");
    const choice = game.pendingChoice!;
    const bear = game.players[0]!.hand.find((card) => card.name === "Grizzly Bears")!;
    game = applyAction(game, 0, { type: "choose-trigger", sourceId: choice.sourceId, accept: true, discardCardId: bear.instance_id });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Body Snatcher")).toBe(true);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);
    expect(game.players[0]!.exile.some((card) => card.name === "Body Snatcher")).toBe(false);
  });

  it("exiles itself and reanimates a target creature card from the graveyard when it dies", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, (player) => ({
      hand: toHand(0, [BOLT()], "bs-hand"),
      graveyard: [...toHand(0, [TRAMPLER()], "bs-graveyard"), ...player.graveyard],
      autoPass: false
    }));
    game = putOnBattlefield(game, 0, [BODY_SNATCHER(), MOUNTAIN()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.prioritySeat === 0);
    const snatcher = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Body Snatcher")!;
    game = applyAction(game, 0, { type: "cast", cardId: "bs-hand-0", targets: [{ kind: "permanent", instanceId: snatcher.instance_id }] });
    game = passUntil(game, (state) => state.pendingChoice?.type === "trigger-target");
    const targetChoice = game.pendingChoice!;
    const stomper = game.players[0]!.graveyard.find((card) => card.name === "Big Stomper")!;
    game = applyAction(game, 0, { type: "choose-trigger-target", sourceId: targetChoice.sourceId, target: { kind: "graveyard-card", seat: 0, instanceId: stomper.instance_id } });
    game = passUntil(game, (state) => state.stack.length === 0 && state.triggerQueue.length === 0);
    expect(game.players[0]!.exile.some((card) => card.name === "Body Snatcher")).toBe(true);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Body Snatcher")).toBe(false);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Big Stomper")).toBe(true);
  });
});

describe("Tooth and Nail's modal tutor-to-hand and hand-to-battlefield modes", () => {
  const TOOTH_AND_NAIL = () => make({
    name: "Tooth and Nail", type_line: "Sorcery", mana_cost: "{5}{G}{G}", cmc: 7,
    oracle_text: "Choose one —\n• Search your library for up to two creature cards, reveal them, put them into your hand, then shuffle.\n• Put up to two creature cards from your hand onto the battlefield.\nEntwine {2} (Choose both if you pay the entwine cost.)"
  });

  it("recognizes both modes and the entwine cost", () => {
    const profile = profileOf(TOOTH_AND_NAIL());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.modalChoices[0]).toMatchObject({ effect: { kind: "search-library", types: ["Creature"], destination: "hand", count: 2 } });
    expect(profile.modalChoices[1]).toMatchObject({ effect: { kind: "put-hand-creatures-onto-battlefield", amount: 2 } });
    expect(profile.entwineCost).toMatchObject({ raw: "{2}" });
  });

  it("puts up to two chosen creature cards from hand onto the battlefield with mode 2", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({
      hand: toHand(0, [TOOTH_AND_NAIL(), BEAR(), TRAMPLER()], "tn-hand"),
      autoPass: false
    }));
    game = putOnBattlefield(game, 0, [FOREST(), FOREST(), FOREST(), FOREST(), FOREST(), FOREST(), FOREST()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.prioritySeat === 0);
    game = applyAction(game, 0, { type: "cast", cardId: "tn-hand-0", mode: 1 });
    game = passUntil(game, (state) => state.pendingChoice?.type === "hand-to-battlefield-multi");
    let choice = game.pendingChoice as Extract<typeof game.pendingChoice, { type: "hand-to-battlefield-multi" }>;
    const bear = game.players[0]!.hand.find((card) => card.name === "Grizzly Bears")!;
    game = applyAction(game, 0, { type: "choose-hand-battlefield-card", sourceId: choice.sourceId, cardId: bear.instance_id });
    choice = game.pendingChoice as Extract<typeof game.pendingChoice, { type: "hand-to-battlefield-multi" }>;
    const stomper = game.players[0]!.hand.find((card) => card.name === "Big Stomper")!;
    game = applyAction(game, 0, { type: "choose-hand-battlefield-card", sourceId: choice.sourceId, cardId: stomper.instance_id });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Grizzly Bears")).toBe(true);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Big Stomper")).toBe(true);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Tooth and Nail")).toBe(true);
  });

  it("searches for up to two creature cards to hand with mode 1", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, (player) => ({
      hand: toHand(0, [TOOTH_AND_NAIL()], "tn-hand"),
      library: [...toHand(0, [BEAR(), TRAMPLER()], "tn-library"), ...player.library],
      autoPass: false
    }));
    game = putOnBattlefield(game, 0, [FOREST(), FOREST(), FOREST(), FOREST(), FOREST(), FOREST(), FOREST()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.prioritySeat === 0);
    game = applyAction(game, 0, { type: "cast", cardId: "tn-hand-0", mode: 0 });
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[0]!.hand.some((card) => card.name === "Grizzly Bears")).toBe(true);
    expect(game.players[0]!.hand.some((card) => card.name === "Big Stomper")).toBe(true);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Grizzly Bears")).toBe(false);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Tooth and Nail")).toBe(true);
  });
});

describe("Buried Alive's up-to-three-to-graveyard search", () => {
  const BURIED_ALIVE = () => make({ name: "Buried Alive", type_line: "Sorcery", mana_cost: "{2}{B}", cmc: 3, oracle_text: "Search your library for up to three creature cards, put them into your graveyard, then shuffle." });

  it("recognizes the up-to-three graveyard search", () => {
    expect(profileOf(BURIED_ALIVE())).toMatchObject({
      fullyImplemented: true,
      effects: [{ kind: "search-library", types: ["Creature"], destination: "graveyard", reveal: false, count: 3 }]
    });
  });

  it("puts exactly the matching creature cards into the graveyard, leaving a noncreature card in the library", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, (player) => ({
      hand: toHand(0, [BURIED_ALIVE()], "buried-hand"),
      library: [...toHand(0, [BEAR(), TRAMPLER(), BOLT()], "buried-library"), ...player.library],
      autoPass: false
    }));
    game = putOnBattlefield(game, 0, [SWAMP(), SWAMP(), SWAMP()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.prioritySeat === 0);
    game = applyAction(game, 0, { type: "cast", cardId: "buried-hand-0" });
    game = passUntil(game, (state) => state.stack.length === 0);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Big Stomper")).toBe(true);
    expect(game.players[0]!.library.some((card) => card.name === "Lightning Bolt")).toBe(true);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Buried Alive")).toBe(true);
  });
});

describe("Recruiter of the Guard's toughness-capped tutor", () => {
  const RECRUITER_OF_THE_GUARD = () => make({ name: "Recruiter of the Guard", type_line: "Creature — Human Soldier", power: "1", toughness: "2", mana_cost: "{2}{W}", cmc: 3, oracle_text: "When Recruiter of the Guard enters, you may search your library for a creature card with toughness 2 or less, reveal it, put it into your hand, then shuffle." });

  it("recognizes the toughness-capped hand tutor", () => {
    expect(profileOf(RECRUITER_OF_THE_GUARD()).triggers[0]).toMatchObject({
      event: "enters-battlefield", subject: "self", optional: true,
      effect: { kind: "search-library", types: ["Creature"], maxToughness: 2, destination: "hand", reveal: true }
    });
  });

  it("offers only creatures with toughness 2 or less, excluding a bigger creature", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, (player) => ({
      hand: toHand(0, [RECRUITER_OF_THE_GUARD()], "recruiter-hand"),
      library: [...toHand(0, [BEAR(), TRAMPLER()], "recruiter-library"), ...player.library]
    }));
    game = putOnBattlefield(game, 0, [PLAINS(), PLAINS(), PLAINS()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    game = applyAction(game, 0, { type: "cast", cardId: "recruiter-hand-0" });
    game = passUntil(game, (state) => state.pendingChoice?.type === "search-library");
    const choice = game.pendingChoice as Extract<typeof game.pendingChoice, { type: "search-library" }>;
    const legalNames = game.players[0]!.library.filter((card) => choice.optionIds.includes(card.instance_id)).map((card) => card.name);
    expect(legalNames).toContain("Grizzly Bears");
    expect(legalNames).not.toContain("Big Stomper");
    game = applyAction(game, 0, { type: "choose-library-card", sourceId: choice.sourceId, query: "Grizzly Bears" });
    expect(game.players[0]!.hand.some((card) => card.name === "Grizzly Bears")).toBe(true);
  });
});

describe("Grapple with the Past's mill-then-optional-return", () => {
  const GRAPPLE_WITH_THE_PAST = () => make({ name: "Grapple with the Past", type_line: "Sorcery", mana_cost: "{1}{G}", cmc: 2, oracle_text: "Mill three cards, then you may return a creature or land card from your graveyard to your hand." });

  it("recognizes the mill-then-return compound as a non-targeted graveyard choice", () => {
    expect(profileOf(GRAPPLE_WITH_THE_PAST())).toMatchObject({
      fullyImplemented: true,
      effects: [{ kind: "compound", effects: [{ kind: "mill", amount: 3 }, { kind: "return-graveyard-card-choice", types: expect.arrayContaining(["Creature", "Land"]) }] }]
    });
  });

  it("mills three cards then offers only the creature and land among them for return", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, (player) => ({
      hand: toHand(0, [GRAPPLE_WITH_THE_PAST()], "grapple-hand"),
      library: [...toHand(0, [BEAR(), FOREST(), BOLT()], "grapple-library"), ...player.library]
    }));
    game = putOnBattlefield(game, 0, [FOREST(), FOREST()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    game = applyAction(game, 0, { type: "cast", cardId: "grapple-hand-0" });
    game = passUntil(game, (state) => state.pendingChoice?.type === "graveyard-card-choice" || state.stack.length === 0);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Forest")).toBe(true);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Lightning Bolt")).toBe(true);
    const choice = game.pendingChoice as Extract<typeof game.pendingChoice, { type: "graveyard-card-choice" }>;
    const legalNames = game.players[0]!.graveyard.filter((card) => choice.optionIds.includes(card.instance_id)).map((card) => card.name);
    expect(legalNames).toContain("Grizzly Bears");
    expect(legalNames).toContain("Forest");
    expect(legalNames).not.toContain("Lightning Bolt");
    const bear = game.players[0]!.graveyard.find((card) => card.name === "Grizzly Bears")!;
    game = applyAction(game, 0, { type: "choose-graveyard-card", sourceId: choice.sourceId, accept: true, cardId: bear.instance_id });
    expect(game.players[0]!.hand.some((card) => card.name === "Grizzly Bears")).toBe(true);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(false);
  });

  it("declines cleanly when the controller chooses not to return a card", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, (player) => ({
      hand: toHand(0, [GRAPPLE_WITH_THE_PAST()], "grapple-hand-2"),
      library: [...toHand(0, [BEAR(), FOREST(), BOLT()], "grapple-library-2"), ...player.library]
    }));
    game = putOnBattlefield(game, 0, [FOREST(), FOREST()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    game = applyAction(game, 0, { type: "cast", cardId: "grapple-hand-2-0" });
    game = passUntil(game, (state) => state.pendingChoice?.type === "graveyard-card-choice");
    const choice = game.pendingChoice as Extract<typeof game.pendingChoice, { type: "graveyard-card-choice" }>;
    game = applyAction(game, 0, { type: "choose-graveyard-card", sourceId: choice.sourceId, accept: false });
    expect(game.pendingChoice).toBeNull();
    expect(game.players[0]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);
    expect(game.players[0]!.hand).toHaveLength(0);
  });
});

describe("Hunting Wilds' kicked-only untap-and-animate-fetched-lands", () => {
  const HUNTING_WILDS = () => make({
    name: "Hunting Wilds", type_line: "Sorcery", mana_cost: "{3}{G}", cmc: 4,
    oracle_text: "Kicker {3}{G} (You may pay an additional {3}{G} as you cast this spell.)\nSearch your library for up to two Forest cards, put them onto the battlefield tapped, then shuffle.\nIf this spell was kicked, untap all Forests put onto the battlefield this way. They become 3/3 green creatures with haste that are still lands."
  });

  it("recognizes the base search and the kicked-only animate follow-up", () => {
    const profile = profileOf(HUNTING_WILDS());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.effects[0]).toMatchObject({ kind: "search-library", subtypes: ["Forest"], destination: "battlefield", tapped: true, count: 2 });
    expect(profile.kickedEffects[0]).toMatchObject({ kind: "untap-and-animate-fetched-lands", subtype: "Forest", power: 3, toughness: 3, color: "G" });
  });

  it("fetches Forests tapped and inanimate when cast unkicked", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, (player) => ({
      hand: toHand(0, [HUNTING_WILDS()], "hw-hand"),
      library: [...toHand(0, [FOREST(), FOREST()], "hw-library"), ...player.library],
      autoPass: false
    }));
    game = putOnBattlefield(game, 0, [FOREST(), FOREST(), FOREST(), FOREST()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.prioritySeat === 0);
    game = applyAction(game, 0, { type: "cast", cardId: "hw-hand-0" });
    game = passUntil(game, (state) => state.stack.length === 0);
    const fetched = game.players[0]!.battlefield.filter((permanent) => permanent.card.instance_id.startsWith("hw-library"));
    expect(fetched).toHaveLength(2);
    expect(fetched.every((permanent) => permanent.tapped)).toBe(true);
    expect(fetched.every((permanent) => !permanent.temporaryAnimation)).toBe(true);
  });

  it("fetches Forests untapped and animated as 3/3 haste creatures when kicked", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, (player) => ({
      hand: toHand(0, [HUNTING_WILDS()], "hw-hand"),
      library: [...toHand(0, [FOREST(), FOREST()], "hw-library"), ...player.library],
      autoPass: false
    }));
    game = putOnBattlefield(game, 0, [FOREST(), FOREST(), FOREST(), FOREST(), FOREST(), FOREST(), FOREST(), FOREST()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.prioritySeat === 0);
    game = applyAction(game, 0, { type: "cast", cardId: "hw-hand-0", kicked: true });
    game = passUntil(game, (state) => state.stack.length === 0);
    const fetched = game.players[0]!.battlefield.filter((permanent) => permanent.card.instance_id.startsWith("hw-library"));
    expect(fetched).toHaveLength(2);
    expect(fetched.every((permanent) => !permanent.tapped)).toBe(true);
    expect(fetched.every((permanent) => permanent.temporaryAnimation?.power === 3 && permanent.temporaryAnimation?.toughness === 3)).toBe(true);
    expect(fetched.every((permanent) => permanent.temporaryKeywords?.includes("haste"))).toBe(true);
  });
});

describe("Xenagos, the Reveler's creature-scaled mana and exile-batch loyalty abilities", () => {
  const XENAGOS = () => make({
    name: "Xenagos, the Reveler", type_line: "Legendary Planeswalker — Xenagos", mana_cost: "{2}{R}{G}", cmc: 4, loyalty: "3",
    oracle_text: "+1: Add X mana in any combination of {R} and/or {G}, where X is the number of creatures you control.\n0: Create a 2/2 red and green Satyr creature token with haste.\n−6: Exile the top seven cards of your library. You may put any number of creature and/or land cards from among them onto the battlefield."
  });

  it("recognizes all three loyalty abilities", () => {
    const profile = profileOf(XENAGOS());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.activatedAbilities[0]).toMatchObject({ loyaltyCost: 1, effect: { kind: "add-mana-any-color", colors: ["R", "G"], amount: "creatures-you-control" } });
    expect(profile.activatedAbilities[2]).toMatchObject({ loyaltyCost: -6, effect: { kind: "exile-top-then-choose-creatures-lands-to-battlefield", amount: 7 } });
  });

  it("adds mana equal to the number of creatures controlled, in one chosen color from the restricted pair", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [XENAGOS(), BEAR(), TRAMPLER()]);
    game = stage(game, 0, () => ({ autoPass: false }));
    const xenagos = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Xenagos, the Reveler")!;
    game = applyAction(game, 0, { type: "activate", sourceId: xenagos.instance_id, abilityIndex: 0 });
    game = passUntil(game, (state) => state.pendingChoice?.type === "choose-color");
    const choice = game.pendingChoice as Extract<typeof game.pendingChoice, { type: "choose-color" }>;
    expect(() => applyAction(game, 0, { type: "choose-color", sourceId: choice.sourceId, color: "W" })).toThrow();
    game = applyAction(game, 0, { type: "choose-color", sourceId: choice.sourceId, color: "R" });
    expect(game.players[0]!.manaPool.R).toBe(2);
    expect(game.players[0]!.battlefield.find((permanent) => permanent.instance_id === xenagos.instance_id)?.counters.loyalty).toBe(1);
  });

  it("allows the creature-scaled mana to be split between both offered colors", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [XENAGOS(), BEAR(), TRAMPLER()]);
    game = stage(game, 0, () => ({ autoPass: false }));
    const xenagos = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Xenagos, the Reveler")!;
    game = applyAction(game, 0, { type: "activate", sourceId: xenagos.instance_id, abilityIndex: 0 });
    game = passUntil(game, (state) => state.pendingChoice?.type === "choose-color");
    const choice = game.pendingChoice as Extract<typeof game.pendingChoice, { type: "choose-color" }>;
    game = applyAction(game, 0, { type: "choose-color", sourceId: choice.sourceId, color: "R", amount: 1 });
    expect(game.players[0]!.manaPool.R).toBe(1);
    expect(game.players[0]!.manaPool.G).toBe(1);
  });

  it("adds the full remainder to the other color when the chosen amount is less than the total", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [XENAGOS(), BEAR(), BEAR(), TRAMPLER()]);
    game = stage(game, 0, () => ({ autoPass: false }));
    const xenagos = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Xenagos, the Reveler")!;
    game = applyAction(game, 0, { type: "activate", sourceId: xenagos.instance_id, abilityIndex: 0 });
    game = passUntil(game, (state) => state.pendingChoice?.type === "choose-color");
    const choice = game.pendingChoice as Extract<typeof game.pendingChoice, { type: "choose-color" }>;
    game = applyAction(game, 0, { type: "choose-color", sourceId: choice.sourceId, color: "G", amount: 2 });
    expect(game.players[0]!.manaPool.G).toBe(2);
    expect(game.players[0]!.manaPool.R).toBe(1);
  });

  it("exiles the top seven and lets the controller put any number of creature/land cards onto the battlefield", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, (player) => ({
      library: [...toHand(0, [BEAR(), BOLT(), FOREST(), TRAMPLER(), SOL_RING(), MOUNTAIN(), SWAMP()], "xen-library"), ...player.library],
      autoPass: false
    }));
    game = putOnBattlefield(game, 0, [XENAGOS()]);
    game = stage(game, 0, (player) => ({
      battlefield: player.battlefield.map((permanent) => permanent.card.name === "Xenagos, the Reveler" ? { ...permanent, counters: { loyalty: 6 } } : permanent)
    }));
    const xenagos = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Xenagos, the Reveler")!;
    game = applyAction(game, 0, { type: "activate", sourceId: xenagos.instance_id, abilityIndex: 2 });
    game = passUntil(game, (state) => state.pendingChoice?.type === "exile-batch-multi");
    let choice = game.pendingChoice as Extract<typeof game.pendingChoice, { type: "exile-batch-multi" }>;
    expect(choice.optionIds).toHaveLength(5); // Bear, Forest, Trampler, Mountain, Swamp (creatures/lands); Bolt and Sol Ring excluded.
    const bear = game.players[0]!.exile.find((card) => card.name === "Grizzly Bears")!;
    game = applyAction(game, 0, { type: "choose-exile-batch-card", sourceId: choice.sourceId, cardId: bear.instance_id });
    choice = game.pendingChoice as Extract<typeof game.pendingChoice, { type: "exile-batch-multi" }>;
    game = applyAction(game, 0, { type: "finish-exile-batch", sourceId: choice.sourceId });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Grizzly Bears")).toBe(true);
    expect(game.players[0]!.exile.some((card) => card.name === "Grizzly Bears")).toBe(false);
    expect(game.players[0]!.exile.some((card) => card.name === "Big Stomper")).toBe(true);
    expect(game.players[0]!.exile.some((card) => card.name === "Lightning Bolt")).toBe(true);
  });
});

describe("Skullmulcher's Devour and the linked devoured-count draw", () => {
  const SKULLMULCHER = () => make({
    name: "Skullmulcher", type_line: "Creature — Elemental", mana_cost: "{4}{G}", cmc: 5, power: "3", toughness: "3",
    keywords: ["Devour"],
    oracle_text: "Devour 1 (As this creature enters, you may sacrifice any number of creatures. It enters with that many +1/+1 counters on it.)\nWhen this creature enters, draw a card for each creature it devoured."
  });

  it("recognizes the synthesized Devour entry ability and the linked draw trigger", () => {
    const profile = profileOf(SKULLMULCHER());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.devourAmount).toBe(1);
    expect(profile.triggers).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: "enters-battlefield", subject: "self", effect: { kind: "devour", multiplier: 1 } }),
      expect.objectContaining({ event: "enters-battlefield", subject: "self", effect: { kind: "draw-per-devoured" } })
    ]));
  });

  it("with no other creature to devour, enters with no counters and draws no cards", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ hand: toHand(0, [SKULLMULCHER()]), autoPass: false }));
    game = putOnBattlefield(game, 0, [FOREST(), FOREST(), FOREST(), FOREST(), FOREST()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.prioritySeat === 0);
    const handBefore = game.players[0]!.hand.length - 1;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    // No other creature is on the battlefield, so Devour's own PendingChoice
    // never opens at all (there is nothing to offer); it auto-resolves with 0.
    game = passUntil(game, (state) => state.stack.length === 0 && state.triggerQueue.length === 0);
    const skull = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Skullmulcher")!;
    expect(skull.counters["+1/+1"] ?? 0).toBe(0);
    expect(game.players[0]!.hand.length).toBe(handBefore);
  });

  it("devouring two creatures enters with 2 +1/+1 counters and draws 2 cards", () => {
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ hand: toHand(0, [SKULLMULCHER()]), autoPass: false }));
    game = putOnBattlefield(game, 0, [BEAR(), TRAMPLER(), FOREST(), FOREST(), FOREST(), FOREST(), FOREST()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.prioritySeat === 0);
    const handBefore = game.players[0]!.hand.length - 1;
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = passUntil(game, (state) => state.pendingChoice?.type === "devour");
    let choice = game.pendingChoice as Extract<typeof game.pendingChoice, { type: "devour" }>;
    expect(choice.candidateIds).toHaveLength(2);
    const bear = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Grizzly Bears")!;
    const trampler = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Big Stomper")!;
    game = applyAction(game, 0, { type: "choose-devour-creature", sourceId: choice.sourceId, cardId: bear.instance_id });
    choice = game.pendingChoice as Extract<typeof game.pendingChoice, { type: "devour" }>;
    game = applyAction(game, 0, { type: "choose-devour-creature", sourceId: choice.sourceId, cardId: trampler.instance_id });
    game = passUntil(game, (state) => state.stack.length === 0 && state.triggerQueue.length === 0);
    const skull = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Skullmulcher")!;
    expect(skull.counters["+1/+1"]).toBe(2);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Big Stomper")).toBe(true);
    expect(game.players[0]!.hand.length).toBe(handBefore + 2);
  });
});

describe("Smothering Abomination's upkeep sacrifice-then-draw", () => {
  const SMOTHERING_ABOMINATION = () => make({
    name: "Smothering Abomination", type_line: "Creature — Eldrazi", mana_cost: "{2}{B}{B}", cmc: 4, power: "3", toughness: "3",
    keywords: ["Devoid", "Flying"],
    oracle_text: "Devoid (This card has no color.)\nFlying\nAt the beginning of your upkeep, sacrifice a creature.\nWhenever you sacrifice a creature, draw a card."
  });

  it("recognizes the synthesized upkeep sacrifice-then-draw trigger and keeps Flying enforced", () => {
    const profile = profileOf(SMOTHERING_ABOMINATION());
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.keywords).toContain("flying");
    expect(profile.triggers[0]).toMatchObject({ event: "upkeep", subject: "you", effect: { kind: "sacrifice-own-creature-then-draw", amount: 1 } });
  });

  it("sacrifices the least valuable creature and draws a card at the controller's own upkeep", () => {
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [SMOTHERING_ABOMINATION(), BEAR()]);
    game = stage(game, 0, () => ({ autoPass: false }));
    const before = game.players[0]!.hand.length;
    game = passUntil(game, (state) => state.activeSeat === 0 && state.step === "precombat-main" && state.turn > 1);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Grizzly Bears")).toBe(false);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Grizzly Bears")).toBe(true);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Smothering Abomination")).toBe(true);
    // +1 from the ability's own draw, +1 from the normal draw step reached
    // along the way to this turn's precombat main.
    expect(game.players[0]!.hand.length).toBe(before + 2);
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

describe("static activation haste", () => {
  it("lets Thousand-Year Elixir activate a creature that entered this turn", () => {
    const elixir = profileOf(THOUSAND_YEAR_ELIXIR());
    expect(elixir.grantsCreatureActivationHaste).toBe(true);
    expect(elixir.activatedAbilities).toContainEqual(expect.objectContaining({
      effect: { kind: "untap-target-permanent" }, targetKind: "creature"
    }));
    expect(elixir.fullyImplemented).toBe(true);

    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [THOUSAND_YEAR_ELIXIR(), SICK_TAPPER(), FOREST()], { sick: true });
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const tapper = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Sick Tapper")!;
    expect(legalActions(game, 0).some((entry) => entry.action.type === "activate" && entry.action.sourceId === tapper.instance_id)).toBe(true);
  });
});

describe("threshold board wipes", () => {
  it("uses Kirtar's Wrath threshold to create Spirits after destroying creatures", () => {
    const profile = profileOf(KIRTARS_WRATH());
    expect(profile.effects).toMatchObject([{
      kind: "kirtars-wrath", threshold: 7,
      token: { name: "Spirit", power: 1, toughness: 1, keywords: ["flying"] }
    }]);
    expect(profile.fullyImplemented).toBe(true);

    let game = twoSeatGame([], []);
    game = stage(game, 0, (player) => ({
      hand: toHand(0, [KIRTARS_WRATH()]),
      graveyard: toHand(0, Array.from({ length: 7 }, (_, index) => make({ name: `Spent ${index}`, type_line: "Sorcery" })), "grave")
    }));
    game = putOnBattlefield(game, 0, [BEAR(), PLAINS(), PLAINS(), PLAINS(), PLAINS(), PLAINS(), PLAINS()]);
    game = putOnBattlefield(game, 1, [BEAR()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = passUntil(game, (state) => state.stack.length === 0);

    expect(game.players.flatMap((player) => player.battlefield).filter((permanent) => permanent.card.name === "Grizzly Bears")).toHaveLength(0);
    expect(game.players[0]!.battlefield.filter((permanent) => permanent.card.name === "Spirit")).toHaveLength(2);
    expect(game.players[0]!.battlefield.filter((permanent) => permanent.card.name === "Spirit").map((permanent) => permanent.card.keywords)).toEqual([["flying"], ["flying"]]);
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
          + result.state.stack.filter((object) => !object.trigger && object.card.owner === player.seat).length;
        expect(total).toBe(40);
        expect(Number.isInteger(player.life)).toBe(true);
      }
      expect(result.finished || result.turns > 60).toBe(true);
    }
  }, 10_000);

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

  it("rechecks each bot blocker against its assigned attacker", () => {
    const shadowAttacker = () => make({
      name: "Dauthi Attacker", type_line: "Creature — Dauthi", mana_cost: "{B}", cmc: 1,
      power: "2", toughness: "2", keywords: ["Shadow"], oracle_text: "Shadow"
    });
    const groundAttacker = () => make({
      name: "Ground Attacker", type_line: "Creature — Soldier", mana_cost: "{1}", cmc: 1,
      power: "2", toughness: "2"
    });
    const groundBlocker = () => make({
      name: "Ground Blocker", type_line: "Creature — Elf", mana_cost: "{1}", cmc: 1,
      power: "2", toughness: "2"
    });
    const shadowBlocker = () => make({
      name: "Dauthi Blocker", type_line: "Creature — Dauthi", mana_cost: "{1}{B}", cmc: 2,
      power: "2", toughness: "2", keywords: ["Shadow"], oracle_text: "Shadow"
    });
    let game = twoSeatGame([], []);
    game = putOnBattlefield(game, 0, [shadowAttacker(), groundAttacker()]);
    game = putOnBattlefield(game, 1, [groundBlocker(), shadowBlocker()]);
    game = passUntil(game, (state) => state.step === "declare-attackers" && state.activeSeat === 0);
    const attackers = game.players[0]!.battlefield.map((permanent) => ({ instanceId: permanent.instance_id, defender: 1 }));
    game = applyAction(game, 0, { type: "declare-attackers", attackers });
    const choice = botAction(game, 1);
    expect(choice?.action.type).toBe("declare-blockers");
    expect(() => applyAction(game, 1, choice!.action)).not.toThrow();
  });

  it("uses hand fast mana only when it unlocks a cast", () => {
    let game = twoSeatGame([], []);
    const guide = SIMIAN_SPIRIT_GUIDE();
    const expensive = make({ name: "Fast Mana Test", type_line: "Instant", mana_cost: "{2}{R}", cmc: 3, oracle_text: "Draw a card." });
    game = stage(game, 0, () => ({ autoPass: false, hand: toHand(0, [guide, expensive], "fast") }));
    game = stage(game, 1, () => ({ autoPass: false }));
    game = putOnBattlefield(game, 0, [MOUNTAIN(), MOUNTAIN()]);
    game = passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const choice = botAction(game, 0);
    expect(choice?.action).toMatchObject({ type: "activate-mana", sourceId: "fast-0" });
  });
});
