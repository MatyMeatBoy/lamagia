import { describe, expect, it } from "vitest";
import { cardProfile } from "./characteristics.js";
import type { CardData } from "./characteristics.js";
import {
  applyAction, createGame, legalActions, legalTargets, legalAttackers, legalBlockers, manaSources, planManaPayment, powerOf, toughnessOf,
  hasRealChoice, profileOf, settle, TURN_STEPS, type DeckInput, type GameCard, type GameState, type SeatId, type TurnStep
} from "./engine.js";
import { botAction, pendingSeat, playBotGame } from "./bot.js";
import { projectGame } from "./projection.js";
import { isSafeManaUndo } from "./undo.js";

describe("smart counter response and safe mana undo", () => {
  it("projects creature status without invented noncreature 0/0 stats", () => {
    const game = putOnBattlefield(twoSeatGame([], []), 0, [ISLAND(), make({ name: "Zero", type_line: "Creature", power: "0", toughness: "0" })]);
    const permanents = projectGame(game, 0).players[0]!.battlefield;
    expect(permanents.at(-2)).toMatchObject({ isCreature: false, power: null, toughness: null });
    expect(permanents.at(-1)).toMatchObject({ isCreature: true, power: 0, toughness: 0 });
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
  it("allows only unchanged-state mana/tap deltas and rejects City of Brass triggers", () => {
    const game = board();
    const action = legalActions(game, 0).find(a => a.action.type === "activate-mana")!.action;
    const next = applyAction(game, 0, action);
    expect(isSafeManaUndo(game, next, 0, action)).toBe(true);
    expect(isSafeManaUndo(game, { ...next, players: next.players.map(p => p.seat === 0 ? { ...p, life: p.life - 1 } : p) }, 0, action)).toBe(false);
    expect(isSafeManaUndo(game, applyAction(next, 0, { type: "pass" }), 0, action)).toBe(false);
    const city = putOnBattlefield(game, 0, [make({ name: "City of Brass", type_line: "Land", oracle_text: "Whenever City of Brass becomes tapped, it deals 1 damage to you.\n{T}: Add one mana of any color." })]);
    const cityAction = legalActions(city, 0).find(a => a.action.type === "activate-mana" && a.action.sourceId === city.players[0]!.battlefield.at(-1)!.instance_id)!.action;
    const tapped = applyAction(city, 0, cityAction);
    expect(tapped.stack.length).toBeGreaterThan(0);
    expect(isSafeManaUndo(city, tapped, 0, cityAction)).toBe(false);
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
const BEAR = () => make({ name: "Grizzly Bears", type_line: "Creature — Bear", mana_cost: "{1}{G}", cmc: 2, power: "2", toughness: "2" });
const ETB_DRAWER = () => make({ name: "Archivist Bear", type_line: "Creature — Bear", mana_cost: "{1}{G}", cmc: 2, power: "2", toughness: "2", oracle_text: "When Archivist Bear enters the battlefield, draw a card." });
const ARTIFACT_ETB_DRAWER = () => make({ name: "Relic Archivist", type_line: "Creature — Human", mana_cost: "{2}{U}", cmc: 3, power: "2", toughness: "2", oracle_text: "Whenever an artifact enters the battlefield under your control, draw a card." });
const ENCHANTMENT_ETB_DRAWER = () => make({ name: "Oath Archivist", type_line: "Creature — Human", mana_cost: "{2}{U}", cmc: 3, power: "2", toughness: "2", oracle_text: "Whenever an enchantment enters the battlefield under your control, draw a card." });
const PERMANENT_ETB_DRAWER = () => make({ name: "Permanent Archivist", type_line: "Creature — Human", mana_cost: "{2}{U}", cmc: 3, power: "2", toughness: "2", oracle_text: "Whenever a permanent enters the battlefield under your control, draw a card." });
const ANOTHER_PERMANENT_ETB_DRAWER = () => make({ name: "Another Archivist", type_line: "Creature — Human", mana_cost: "{2}{U}", cmc: 3, power: "2", toughness: "2", oracle_text: "Whenever another permanent enters the battlefield under your control, draw a card." });
const ANY_SPELL_TRIGGER = () => make({ name: "Spell Archivist", type_line: "Creature — Human", mana_cost: "{2}{U}", cmc: 3, power: "2", toughness: "2", oracle_text: "Whenever a player casts a spell, draw a card." });
const OPTIONAL_ETB_DRAWER = () => make({ name: "Optional Archivist", type_line: "Creature — Bear", mana_cost: "{1}{G}", cmc: 2, power: "2", toughness: "2", oracle_text: "When Optional Archivist enters the battlefield, you may draw a card." });
const WALL = () => make({ name: "Stone Wall", type_line: "Creature — Wall", mana_cost: "{W}", cmc: 1, power: "0", toughness: "4", keywords: ["Defender"], oracle_text: "Defender" });
const FLIER = () => make({ name: "Storm Crow", type_line: "Creature — Bird", mana_cost: "{1}{U}", cmc: 2, power: "1", toughness: "2", keywords: ["Flying"], oracle_text: "Flying" });
const GUARD_GOMAZOA = () => make({ name: "Guard Gomazoa", type_line: "Creature — Jellyfish", mana_cost: "{2}{U}", cmc: 3, power: "1", toughness: "3", keywords: ["Defender", "Flying"], oracle_text: "Defender, flying\nPrevent all combat damage that would be dealt to this creature." });
const TRAMPLER = () => make({ name: "Big Stomper", type_line: "Creature — Beast", mana_cost: "{3}{G}", cmc: 4, power: "6", toughness: "6", keywords: ["Trample"], oracle_text: "Trample" });
const DEATHTOUCHER = () => make({ name: "Tiny Viper", type_line: "Creature — Snake", mana_cost: "{B}", cmc: 1, power: "1", toughness: "1", keywords: ["Deathtouch"], oracle_text: "Deathtouch" });
const FEARER = () => make({ name: "Fear Stalker", type_line: "Creature — Horror", mana_cost: "{2}{B}", cmc: 3, power: "3", toughness: "2", keywords: ["Fear"], oracle_text: "Fear" });
const BLACK_BLOCKER = () => make({ name: "Dusk Bat", type_line: "Creature — Bat", mana_cost: "{1}{B}", cmc: 2, power: "1", toughness: "1", colors: ["B"] });
const ARTIFACT_BLOCKER = () => make({ name: "Iron Construct", type_line: "Artifact Creature — Construct", mana_cost: "{2}", cmc: 2, power: "2", toughness: "2" });
const LIFELINKER = () => make({ name: "Kind Knight", type_line: "Creature — Knight", mana_cost: "{1}{W}", cmc: 2, power: "2", toughness: "2", keywords: ["Lifelink"], oracle_text: "Lifelink" });
const FIRST_STRIKER = () => make({ name: "Quick Blade", type_line: "Creature — Soldier", mana_cost: "{1}{W}", cmc: 2, power: "2", toughness: "2", keywords: ["First strike"], oracle_text: "First strike" });
const SPHINX_OF_THE_STEEL_WIND = () => make({
  name: "Sphinx of the Steel Wind", type_line: "Artifact Creature — Sphinx", mana_cost: "{5}{W}{U}{B}", cmc: 8,
  power: "6", toughness: "6", colors: ["W", "U", "B"],
  oracle_text: "Flying, first strike, vigilance, lifelink, protection from red and from green"
});
const RED_RAIDER = () => make({ name: "Red Raider", type_line: "Creature — Goblin", mana_cost: "{1}{R}", cmc: 2, power: "3", toughness: "3", colors: ["R"] });
const BOLT = () => make({ name: "Lightning Bolt", type_line: "Instant", mana_cost: "{R}", cmc: 1, oracle_text: "Lightning Bolt deals 3 damage to any target." });
const REGENERATE_TARGET = () => make({ name: "Regrowth Shield", type_line: "Instant", mana_cost: "{1}{G}", cmc: 2, oracle_text: "Regenerate target creature." });
const CHAOS_WARP = () => make({ name: "Chaos Warp", type_line: "Instant", mana_cost: "{2}{R}", cmc: 3, oracle_text: "The owner of target permanent shuffles it into their library, then reveals the top card of their library. If it's a permanent card, they put it onto the battlefield." });
const DESTROY_TARGET_CREATURE = () => make({ name: "Destroy Target Creature", type_line: "Instant", mana_cost: "{1}{B}", cmc: 2, oracle_text: "Destroy target creature." });
const DECREE_OF_PAIN = () => make({ name: "Decree of Pain", type_line: "Sorcery", mana_cost: "{4}{B}{B}", cmc: 6, oracle_text: "Destroy all creatures. They can't be regenerated. Draw a card for each creature destroyed this way.\nCycling {3}{B}{B}\nWhen you cycle this card, all creatures get -2/-2 until end of turn." });
const SLICE_AND_DICE = () => make({ name: "Slice and Dice", type_line: "Sorcery", mana_cost: "{4}{R}{R}", cmc: 6, oracle_text: "Cycling {2}{R}\nWhen you cycle this card, you may have it deal 1 damage to each creature." });
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
const DISCARD_HAND_SPELL = () => make({ name: "Memory Collapse", type_line: "Sorcery", mana_cost: "{3}{B}", cmc: 4, oracle_text: "Target player discards their hand." });
const X_DISCARD_SPELL = () => make({ name: "Scalable Mind Twist", type_line: "Sorcery", mana_cost: "{X}{B}", cmc: 1, oracle_text: "Target player discards X cards." });
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
const CAPRICIOUS_EFREET = () => make({ name: "Capricious Efreet", type_line: "Creature — Efreet", mana_cost: "{3}{R}{R}", cmc: 5, power: "3", toughness: "3", oracle_text: "At the beginning of your upkeep, choose target nonland permanent you control and up to two target nonland permanents you don't control. Destroy one of them at random.", scryfall_id: "9abd2286-23e9-49cd-be53-39423890f35c" });
const CHARMBREAKER_DEVILS = () => make({ name: "Charmbreaker Devils", type_line: "Creature — Devil", mana_cost: "{5}{R}", cmc: 6, power: "5", toughness: "4", oracle_text: "At the beginning of your upkeep, return an instant or sorcery card at random from your graveyard to your hand.", scryfall_id: "1b9df437-6988-4ddc-80c4-893e11076067" });
const ARCHAEOMANCER = () => make({ name: "Archaeomancer", type_line: "Creature — Human Wizard", mana_cost: "{2}{U}{U}", cmc: 4, power: "1", toughness: "2", oracle_text: "When Archaeomancer enters the battlefield, return target instant or sorcery card from your graveyard to your hand.", oracle_id: "a91a3266-cadd-47a0-9b20-160307f14c07", scryfall_id: "dd94eb97-d231-4880-9c6f-e25da02782b4" });
const IZZET_CHRONARCH = () => make({ name: "Izzet Chronarch", type_line: "Creature — Human Wizard", mana_cost: "{3}{U}{R}", cmc: 5, power: "2", toughness: "2", oracle_text: "When Izzet Chronarch enters the battlefield, return target instant or sorcery card from your graveyard to your hand.", oracle_id: "1da438f3-db1c-4713-a60c-e078f31d809c", scryfall_id: "d2f8fe93-8d20-41d4-8205-597a9c9b8bbe" });
const CHARNELHOARD_WURM = () => make({ name: "Charnelhoard Wurm", type_line: "Creature — Wurm", mana_cost: "{4}{B}{R}{G}", cmc: 7, power: "6", toughness: "6", keywords: ["Trample"], oracle_text: "Trample\nWhenever this creature deals damage to an opponent, you may return target card from your graveyard to your hand.", scryfall_id: "4a430fa3-e693-424b-9981-d7d8193445e3" });
const DAMAGE_TRIGGERER = () => make({ name: "Damage Triggerer", type_line: "Creature — Wurm", mana_cost: "{3}{R}", cmc: 4, power: "3", toughness: "3", oracle_text: "Whenever this creature deals damage to an opponent, you may return target card from your graveyard to your hand.\n{T}: ~ deals 1 damage to any target." });
const CONJURERS_CLOSET = () => make({ name: "Conjurer's Closet", type_line: "Artifact", mana_cost: "{5}", cmc: 5, oracle_text: "At the beginning of your end step, you may exile target creature you control, then return that card to the battlefield under your control.", scryfall_id: "cd1eda60-53e4-44d0-9b2c-7a57395e291f" });
const TIDAL_FORCE = () => make({ name: "Tidal Force", type_line: "Creature — Elemental", mana_cost: "{5}{U}{U}", cmc: 7, power: "8", toughness: "8", oracle_text: "At the beginning of each upkeep, you may tap or untap target permanent.", scryfall_id: "1b25e262-e2df-4768-b55e-1b7b8d3ee993" });
const DRAW_AND_LOSE = () => make({ name: "Dark Exchange", type_line: "Sorcery", mana_cost: "{2}{B}", cmc: 3, oracle_text: "Draw a card and lose 1 life." });
const HAND_DAMAGE = () => make({ name: "Viseling Memory", type_line: "Instant", mana_cost: "{2}{B}", cmc: 3, oracle_text: "This spell deals damage to you equal to the number of cards in your hand." });
const DRAW_MINE = () => make({ name: "Draw Mine", type_line: "Artifact", mana_cost: "{2}", cmc: 2, oracle_text: "At the beginning of each player's draw step, that player draws an additional card." });
const HAND_MINUS_DAMAGE = () => make({ name: "Hand Minus Damage", type_line: "Creature — Artifact", mana_cost: "{5}", cmc: 5, power: "2", toughness: "2", oracle_text: "At the beginning of each opponent's upkeep, this creature deals X damage to that player, where X is the number of cards in their hand minus 4." });
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
const POWER_LOSS_REMOVAL = () => make({ name: "Power Loss Removal", type_line: "Sorcery", mana_cost: "{2}{B}", cmc: 3, oracle_text: "Destroy target creature. Its controller loses life equal to its power plus its toughness." });
const EXILE_LIFEGAIN_REMOVAL = () => make({ name: "Peaceforge Edict", type_line: "Instant", mana_cost: "{W}", cmc: 1, oracle_text: "Exile target creature. Its controller gains life equal to its power." });
const CONDEMN_LIKE = () => make({ name: "Battlefield Condemnation", type_line: "Instant", mana_cost: "{W}", cmc: 1, oracle_text: "Put target attacking creature on the bottom of its owner's library. Its controller gains life equal to its toughness." });
// "That player" refers back to the card-drawn event's own player (the
// opponent who drew), resolved from `object.trigger?.eventController` —
// not a chosen target and not always `object.controller`'s opponent list.
const DAMAGE_ON_OPPONENT_DRAW = () => make({ name: "Test Nekusar", type_line: "Creature — Wizard", mana_cost: "{2}{U}{B}{R}", cmc: 5, power: "2", toughness: "4", oracle_text: "Whenever an opponent draws a card, ~ deals 1 damage to that player." });
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
const ARTIFACT_GRAVEYARD_RETURN = () => make({ name: "Artifact Reclaim", type_line: "Sorcery", mana_cost: "{1}{B}", cmc: 2, oracle_text: "Return target artifact card from your graveyard to your hand." });
const LAND_GRAVEYARD_BATTLEFIELD = () => make({ name: "Restore Memory", type_line: "Sorcery", mana_cost: "{2}{G}", cmc: 3, oracle_text: "Put target land card from a graveyard onto the battlefield under your control." });
const ARTIFACT_GRAVEYARD_BATTLEFIELD = () => make({ name: "Sharuum Memory", type_line: "Sorcery", mana_cost: "{2}{U}{B}", cmc: 4, oracle_text: "Return target artifact card from your graveyard to the battlefield." });
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
const ANNIHILATE = () => make({ name: "Annihilate", type_line: "Instant", mana_cost: "{2}{B}", cmc: 3, oracle_text: "Destroy target nonblack creature. Draw a card." });
const FAMINE = () => make({ name: "Famine", type_line: "Sorcery", mana_cost: "{3}{B}{B}", cmc: 5, oracle_text: "Famine deals 3 damage to each creature and each player." });
const ALL_PLAYER_DAMAGE = () => make({ name: "Shared Scorch", type_line: "Sorcery", mana_cost: "{2}{R}", cmc: 3, oracle_text: "This spell deals 2 damage to each player." });
const DEATH_GRASP = () => make({ name: "Death Grasp", type_line: "Sorcery", mana_cost: "{X}{W}{B}", cmc: 2, oracle_text: "Death Grasp deals X damage to any target. You gain X life." });
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
const GUTTERSNIPE = () => make({ name: "Guttersnipe", type_line: "Creature — Goblin Shaman", mana_cost: "{2}{R}", cmc: 3, power: "2", toughness: "2", oracle_text: "Whenever you cast an instant or sorcery spell, Guttersnipe deals 2 damage to each opponent." });
const FECUNDITY = () => make({ name: "Fecundity", type_line: "Enchantment", mana_cost: "{2}{G}", cmc: 3, oracle_text: "Whenever a creature dies, that creature's controller may draw a card." });
const FIRES_OF_YAVIMAYA = () => make({ name: "Fires of Yavimaya", type_line: "Enchantment", mana_cost: "{1}{R}{G}", cmc: 3, oracle_text: "Creatures you control have haste.\n{R}{G}, Sacrifice Fires of Yavimaya: Creatures you control get +2/+2 until end of turn." });
const GOBLIN_BOMBARDMENT = () => make({ name: "Goblin Bombardment", type_line: "Enchantment", mana_cost: "{1}{R}", cmc: 2, oracle_text: "Sacrifice a creature: Goblin Bombardment deals 1 damage to any target." });
const C13_COMMAND_TOWER = () => ({ ...COMMAND_TOWER(), scryfall_id: "0895c9b7-ae7d-4bb3-af17-3b75deb50a25" });
const C13_DECREE_OF_PAIN = () => ({ ...DECREE_OF_PAIN(), scryfall_id: "932668fa-d6e3-41c0-ad0c-8e0a00e68d11" });
const C13_ARMY_OF_THE_DAMNED = () => {
  const card = TAPPED_ZOMBIES();
  return { ...card, oracle_text: `${card.oracle_text}\nFlashback {7}{B}{B}`, scryfall_id: "75d667ec-86f4-4850-a3b6-e7a9fc7053b0" };
};
const C13_CULTIVATE = () => make({ name: "Cultivate", type_line: "Sorcery", mana_cost: "{2}{G}", cmc: 3, oracle_text: "Search your library for up to two basic land cards, put one onto the battlefield tapped and the other into your hand, then shuffle.", scryfall_id: "8b755881-a72d-4e21-a369-d2924eb4585a" });
const C13_ARMILLARY_SPHERE = () => make({ name: "Armillary Sphere", type_line: "Artifact", mana_cost: "{2}", cmc: 2, oracle_text: "{2}, {T}, Sacrifice Armillary Sphere: Search your library for up to two basic land cards, reveal those cards, put them into your hand, then shuffle.", scryfall_id: "3963140c-da67-43e6-9514-fe9dc0a43c4d" });
const C13_BURNISHED_HART = () => make({ name: "Burnished Hart", type_line: "Artifact Creature — Elk", mana_cost: "{3}", cmc: 3, power: "2", toughness: "2", oracle_text: "{3}, Sacrifice Burnished Hart: Search your library for up to two basic land cards, put them onto the battlefield tapped, then shuffle.", scryfall_id: "893fed41-c144-433f-af88-bc7d419b7fb3" });
const C13_AJANI_PRIDEMATE = () => make({ name: "Ajani's Pridemate", type_line: "Creature — Cat Soldier", mana_cost: "{1}{W}", cmc: 2, power: "2", toughness: "2", oracle_text: "Whenever you gain life, put a +1/+1 counter on Ajani's Pridemate.", scryfall_id: "95e94dea-5ac0-4d6f-adec-ca147aee861f" });
const C13_CRADLE_OF_VITALITY = () => make({ name: "Cradle of Vitality", type_line: "Enchantment", mana_cost: "{2}{W}", cmc: 3, oracle_text: "Whenever you gain life, you may pay {1}{W}. If you do, put a +1/+1 counter on target creature for each 1 life you gained.", scryfall_id: "956250da-532a-4457-8696-73915be56943" });
const C13_THOPTER_FOUNDRY = () => make({ name: "Thopter Foundry", type_line: "Artifact", mana_cost: "{2}", cmc: 2, oracle_text: "{1}, Sacrifice a nontoken artifact: Create a 1/1 blue Thopter artifact creature token with flying. You gain 1 life.", scryfall_id: "88bef744-550e-4f33-b1ff-a8ee990ec754" });
const C13_BLUE_SUN = () => make({ name: "Blue Sun's Zenith", type_line: "Instant", mana_cost: "{X}{U}{U}{U}", cmc: 3, oracle_text: "Target player draws X cards. Shuffle Blue Sun's Zenith into its owner's library.", scryfall_id: "613a41b8-0b4f-4995-bf1e-ca41f96e6438" });
const C13_NEW_BENALIA = () => make({ name: "New Benalia", type_line: "Land", oracle_text: "New Benalia enters the battlefield tapped.\nWhen New Benalia enters the battlefield, scry 1.\n{T}: Add {W}.", produced_mana: ["W"], scryfall_id: "6e743fbf-b5b6-4176-a4f2-6933f521f2fe" });
const C13_BALOTH_WOODCRASHER = () => make({ name: "Baloth Woodcrasher", type_line: "Creature — Beast", mana_cost: "{4}{G}{G}", cmc: 6, power: "4", toughness: "4", oracle_text: "Landfall — Whenever a land you control enters, this creature gets +4/+4 and gains trample until end of turn.", scryfall_id: "d8af1377-72bb-4d93-80bd-2c927b02cc73" });
const LANDFALL_SELF_PUMP = () => make({ name: "Landfall Self Pump", type_line: "Creature — Beast", mana_cost: "{2}{G}", cmc: 3, power: "3", toughness: "3", oracle_text: "Landfall — Whenever a land you control enters, this creature gets +2/+2 until end of turn." });
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
const C13_DEEP_ANALYSIS = () => make({ name: "Deep Analysis", type_line: "Sorcery", mana_cost: "{3}{U}", cmc: 4, oracle_text: "Target player draws two cards.\nFlashback—{1}{U}, Pay 3 life. (You may cast this card from your graveyard for its flashback cost. Then exile it.)", scryfall_id: "952800af-f52c-44bf-a98b-51c5f8142dc9" });
const C13_BALEFUL_STRIX = () => make({ name: "Baleful Strix", type_line: "Artifact Creature — Bird", mana_cost: "{U}{B}", cmc: 2, power: "1", toughness: "1", keywords: ["Flying", "Deathtouch"], oracle_text: "Flying\nDeathtouch\nWhen this creature enters, draw a card.", scryfall_id: "47ac0f77-1294-4de9-93d1-141a9f314f98" });
const C13_PHYREXIAN_GARGANTUA = () => make({ name: "Phyrexian Gargantua", type_line: "Creature — Phyrexian Horror", mana_cost: "{4}{B}{B}", cmc: 6, power: "4", toughness: "4", oracle_text: "When this creature enters, you draw two cards and you lose 2 life.", scryfall_id: "56ae94c2-8bbb-4807-b1e0-8ef178dd1697" });
const C13_ANNIHILATE = () => make({ name: "Annihilate", type_line: "Instant", mana_cost: "{3}{B}{B}", cmc: 5, oracle_text: "Destroy target nonblack creature. It can't be regenerated.\nDraw a card.", scryfall_id: "595e8c26-672d-4978-87ec-9e0ed64ceaf0" });
const C13_RECKLESS_SPITE = () => make({ name: "Reckless Spite", type_line: "Instant", mana_cost: "{3}{B}{B}", cmc: 5, oracle_text: "Destroy two target nonblack creatures. You lose 5 life.", scryfall_id: "a684df3a-5441-4daa-86d1-c47a91b35e6a" });
const C13_UNEXPECTEDLY_ABSENT = () => make({ name: "Unexpectedly Absent", type_line: "Instant", mana_cost: "{X}{W}{U}", cmc: 2, oracle_text: "Put target nonland permanent into its owner's library just beneath the top X cards of that library.", scryfall_id: "e8d78a83-c932-4b55-8f75-7094c672c3a9" });
const C13_ANGEL_OF_FINALITY = () => make({ name: "Angel of Finality", type_line: "Creature — Angel", mana_cost: "{3}{W}", cmc: 4, power: "3", toughness: "4", keywords: ["Flying"], oracle_text: "Flying\nWhen this creature enters, exile target player's graveyard.", scryfall_id: "bd3c34c9-2072-4ebb-93ef-34173015bfb8" });
const C13_BOJUKA_BOG = () => make({ name: "Bojuka Bog", type_line: "Land", oracle_text: "This land enters tapped.\nWhen this land enters, exile target player's graveyard.\n{T}: Add {B}.", produced_mana: ["B"], scryfall_id: "2ef9848c-fe7f-4434-8936-4074f67883af" });
const C13_ARCANE_DENIAL = () => make({ name: "Arcane Denial", type_line: "Instant", mana_cost: "{1}{U}{U}", cmc: 3, oracle_text: "Counter target spell. Its controller may draw up to two cards at the beginning of the next turn's upkeep.\nYou draw a card at the beginning of the next turn's upkeep.", scryfall_id: "ab175817-da6a-4ae7-a016-c3bfb087eae0" });
const C13_BANE_OF_PROGRESS = () => make({ name: "Bane of Progress", type_line: "Creature — Elemental", mana_cost: "{2}{G}{G}", cmc: 4, power: "2", toughness: "2", oracle_text: "When Bane of Progress enters the battlefield, destroy all artifacts and enchantments, then put a +1/+1 counter on Bane of Progress for each permanent destroyed this way.", scryfall_id: "51f9a6cc-8eb2-44ed-a2d9-913ac514ad67" });
const C13_RAZOR_HIPPOGRIFF = () => make({ name: "Razor Hippogriff", type_line: "Creature — Hippogriff", mana_cost: "{3}{W}{W}", cmc: 5, power: "3", toughness: "3", keywords: ["Flying"], oracle_text: "Flying\nWhen Razor Hippogriff enters the battlefield, you may return target artifact card from your graveyard to your hand. You gain life equal to that card's converted mana cost.", scryfall_id: "d121108e-f0bc-469b-bf94-e5e530801a4" });
const C13_NIGHT_SOIL = () => make({ name: "Night Soil", type_line: "Enchantment", mana_cost: "{2}{G}", cmc: 3, oracle_text: "{1}, Exile two creature cards from a single graveyard: Create a 1/1 green Saproling creature token.", scryfall_id: "52a0eca1-f936-4f5a-820b-fa12542c593d", oracle_id: "3165fe8f-52d7-40f7-bb14-8f4300a564e6" });
const C13_SPELLBREAKER_BEHEMOTH = () => make({ name: "Spellbreaker Behemoth", type_line: "Creature — Beast", mana_cost: "{2}{R}{G}", cmc: 4, power: "5", toughness: "5", oracle_text: "Creature spells you control with power 5 or greater can't be countered.", scryfall_id: "cba07472-7212-4411-a9f9-38a48870ad69", oracle_id: "cba07472-7212-4411-a9f9-38a48870ad69" });
const C13_FLICKERWISP = () => make({ name: "Flickerwisp", type_line: "Creature — Elemental", mana_cost: "{1}{W}{W}", cmc: 3, power: "3", toughness: "1", keywords: ["Flying"], oracle_text: "Flying\nWhen this creature enters, exile another target permanent. Return that card to the battlefield under its owner's control at the beginning of the next end step.", scryfall_id: "f6cccf30-2025-49bb-9b1e-240bbef03f27", oracle_id: "b23a3d30-6b8e-4aad-890f-db0c3af43ace" });
const C13_VILE_REQUIEM = () => make({ name: "Vile Requiem", type_line: "Enchantment", mana_cost: "{2}{B}{B}", cmc: 4, oracle_text: "At the beginning of your upkeep, you may put a verse counter on this enchantment.\n{1}{B}, Sacrifice this enchantment: Destroy up to X target nonblack creatures, where X is the number of verse counters on this enchantment. They can't be regenerated.", scryfall_id: "923972d3-d838-43f8-800a-904489c5791a" });
const C13_WELL_OF_LOST_DREAMS = () => make({ name: "Well of Lost Dreams", type_line: "Artifact", mana_cost: "{4}", cmc: 4, oracle_text: "Whenever you gain life, you may pay {X}, where X is less than or equal to the amount of life you gained. If you do, draw X cards.", scryfall_id: "b0394cf2-12a0-4d4f-87e0-fe8937e6faff" });
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
const TUTOR = () => make({ name: "Enlightened Tutor", type_line: "Instant", mana_cost: "{W}", cmc: 1, oracle_text: "Search your library for an artifact or enchantment card, reveal it, then shuffle. Put that card on top of your library." });
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
const TEMPLE_OF_FALSE_GOD = () => make({ name: "Temple of the False God", type_line: "Land", oracle_text: "{T}: Add {C}{C}. Activate only if you control five or more lands.", produced_mana: ["C"] });
const VIVID_CREEK = () => make({ name: "Vivid Creek", type_line: "Land", oracle_text: "Vivid Creek enters the battlefield tapped with two charge counters on it.\n{T}: Add {U}.\n{T}, Remove a charge counter from Vivid Creek: Add one mana of any color.", produced_mana: ["U", "W", "B", "R", "G"] });
const VIVID_SPELL = () => make({ name: "Vivid Lesson", type_line: "Sorcery", mana_cost: "{R}", cmc: 1, oracle_text: "Draw a card." });
const ELVES = () => make({ name: "Llanowar Elves", type_line: "Creature — Elf Druid", mana_cost: "{G}", cmc: 1, power: "1", toughness: "1", oracle_text: "{T}: Add {G}.", produced_mana: ["G"] });
const DELTA = () => make({
  name: "Polluted Delta", type_line: "Land",
  oracle_text: "{T}, Pay 1 life, Sacrifice Polluted Delta: Search your library for an Island or Swamp card, put it onto the battlefield, then shuffle."
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

  it("lets a shock land enter untapped for 2 life when it can be afforded, tapped otherwise", () => {
    const profile = profileOf(SHOCK_LAND());
    expect(profile.entersTapped).toEqual({ kind: "unless-pay-life", life: 2 });
    expect(profile.fullyImplemented).toBe(true);

    let flush = twoSeatGame([], []);
    flush = stage(flush, 0, () => ({ hand: toHand(0, [SHOCK_LAND()], "shock-flush") }));
    flush = passUntil(flush, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    const before = flush.players[0]!.life;
    flush = applyAction(flush, 0, { type: "play-land", cardId: "shock-flush-0" });
    const flushLand = flush.players[0]!.battlefield.find((permanent) => permanent.card.name === "Test Steam Vents")!;
    expect(flushLand.tapped).toBe(false);
    expect(flush.players[0]!.life).toBe(before - 2);

    // At low life, the same choice protects it and the land enters tapped instead.
    let poor = twoSeatGame([], []);
    poor = stage(poor, 0, () => ({ hand: toHand(0, [SHOCK_LAND()], "shock-poor"), life: 2 }));
    poor = passUntil(poor, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
    poor = applyAction(poor, 0, { type: "play-land", cardId: "shock-poor-0" });
    const poorLand = poor.players[0]!.battlefield.find((permanent) => permanent.card.name === "Test Steam Vents")!;
    expect(poorLand.tapped).toBe(true);
    expect(poor.players[0]!.life).toBe(2);
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

    game = { ...game, players: game.players.map((player, seat) => seat === 0
      ? { ...player, battlefield: player.battlefield.map((permanent) => permanent.card.name === "Plant" ? { ...permanent, damage: 1 } : permanent) }
      : player) };
    game = applyAction(game, 0, { type: "pass" });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Plant")).toBe(false);
    expect(game.players[0]!.graveyard.some((card) => card.name === "Plant")).toBe(false);
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
    const target = game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Ajani's Pridemate")!;
    expect(game.pendingChoice?.type).toBe("optional-trigger");
    const choice = game.pendingChoice as Extract<GameState["pendingChoice"], { type: "optional-trigger" }>;
    expect(choice.targets).toEqual([{ kind: "permanent", instanceId: target.instance_id }]);
    game = applyAction(game, 0, { type: "choose-trigger", sourceId: choice.sourceId, accept: true });
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
});


describe("activated abilities", () => {
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
          + result.state.stack.filter((object) => !object.trigger && object.card.owner === player.seat).length;
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
});
