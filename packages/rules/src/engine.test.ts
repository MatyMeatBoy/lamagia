import { describe, expect, it } from "vitest";
import { cardProfile } from "./characteristics.js";
import type { CardData } from "./characteristics.js";
import {
  applyAction, createGame, legalActions, legalTargets, legalAttackers, legalBlockers, manaSources, planManaPayment, powerOf, toughnessOf,
  hasRealChoice, profileOf, settle, TURN_STEPS, type DeckInput, type GameCard, type GameState, type SeatId, type TurnStep
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
const MOUNTAIN = () => make({ name: "Mountain", type_line: "Basic Land — Mountain", produced_mana: ["R"] });
const SWAMP = () => make({ name: "Swamp", type_line: "Basic Land — Swamp", produced_mana: ["B"] });
const FROSTBOIL = () => make({
  name: "Frostboil Snarl", type_line: "Land", oracle_text: "As Frostboil Snarl enters, you may reveal an Island or Mountain card from your hand. If you don't, Frostboil Snarl enters tapped.\n{T}: Add {U} or {R}.", produced_mana: ["U", "R"]
});
const TAPLAND = () => make({ name: "Slow Gate", type_line: "Land", oracle_text: "Slow Gate enters tapped.\n{T}: Add {G}.", produced_mana: ["G"] });
const BEAR = () => make({ name: "Grizzly Bears", type_line: "Creature — Bear", mana_cost: "{1}{G}", cmc: 2, power: "2", toughness: "2" });
const ETB_DRAWER = () => make({ name: "Archivist Bear", type_line: "Creature — Bear", mana_cost: "{1}{G}", cmc: 2, power: "2", toughness: "2", oracle_text: "When Archivist Bear enters the battlefield, draw a card." });
const OPTIONAL_ETB_DRAWER = () => make({ name: "Optional Archivist", type_line: "Creature — Bear", mana_cost: "{1}{G}", cmc: 2, power: "2", toughness: "2", oracle_text: "When Optional Archivist enters the battlefield, you may draw a card." });
const WALL = () => make({ name: "Stone Wall", type_line: "Creature — Wall", mana_cost: "{W}", cmc: 1, power: "0", toughness: "4", keywords: ["Defender"], oracle_text: "Defender" });
const FLIER = () => make({ name: "Storm Crow", type_line: "Creature — Bird", mana_cost: "{1}{U}", cmc: 2, power: "1", toughness: "2", keywords: ["Flying"], oracle_text: "Flying" });
const TRAMPLER = () => make({ name: "Big Stomper", type_line: "Creature — Beast", mana_cost: "{3}{G}", cmc: 4, power: "6", toughness: "6", keywords: ["Trample"], oracle_text: "Trample" });
const DEATHTOUCHER = () => make({ name: "Tiny Viper", type_line: "Creature — Snake", mana_cost: "{B}", cmc: 1, power: "1", toughness: "1", keywords: ["Deathtouch"], oracle_text: "Deathtouch" });
const LIFELINKER = () => make({ name: "Kind Knight", type_line: "Creature — Knight", mana_cost: "{1}{W}", cmc: 2, power: "2", toughness: "2", keywords: ["Lifelink"], oracle_text: "Lifelink" });
const FIRST_STRIKER = () => make({ name: "Quick Blade", type_line: "Creature — Soldier", mana_cost: "{1}{W}", cmc: 2, power: "2", toughness: "2", keywords: ["First strike"], oracle_text: "First strike" });
const BOLT = () => make({ name: "Lightning Bolt", type_line: "Instant", mana_cost: "{R}", cmc: 1, oracle_text: "Lightning Bolt deals 3 damage to any target." });
const TAP_SPELL = () => make({ name: "Tactical Tap", type_line: "Instant", mana_cost: "{1}{U}", cmc: 2, oracle_text: "Tap target creature." });
const UNTAP_SPELL = () => make({ name: "Tactical Untap", type_line: "Instant", mana_cost: "{1}{U}", cmc: 2, oracle_text: "Untap target permanent." });
const MILL_SPELL = () => make({ name: "Gravewind", type_line: "Sorcery", mana_cost: "{1}{B}", cmc: 2, oracle_text: "Target player mills three cards." });
const CREATURE_COUNTER = () => make({ name: "Creature Denial", type_line: "Instant", mana_cost: "{U}", cmc: 1, oracle_text: "Counter target creature spell." });
const NONCREATURE_COUNTER = () => make({ name: "Noncreature Denial", type_line: "Instant", mana_cost: "{U}", cmc: 1, oracle_text: "Counter target noncreature spell." });
const GROWTH_SPELL = () => make({ name: "Measured Growth", type_line: "Instant", mana_cost: "{1}{G}", cmc: 2, oracle_text: "Put a +1/+1 counter on target creature." });
const DISCARD_SPELL = () => make({ name: "Mind Twist", type_line: "Sorcery", mana_cost: "{1}{B}", cmc: 2, oracle_text: "Target player discards a card." });
const LIFE_SPELL = () => make({ name: "Simple Blessing", type_line: "Instant", mana_cost: "{G}", cmc: 1, oracle_text: "You gain 1 life." });
const SELF_LOSS_SPELL = () => make({ name: "Private Burden", type_line: "Sorcery", mana_cost: "{B}", cmc: 1, oracle_text: "You lose 2 life." });
const LOSS_COUNTER = () => make({ name: "Pain Counter", type_line: "Creature — Human Cleric", mana_cost: "{1}{B}", cmc: 2, power: "1", toughness: "1", oracle_text: "Whenever you lose life, put a +1/+1 counter on Pain Counter." });
const TARGET_LIFE_SPELL = () => make({ name: "Shared Blessing", type_line: "Instant", mana_cost: "{G}", cmc: 1, oracle_text: "Target player gains 2 life." });
const EACH_LIFE_SPELL = () => make({ name: "Common Blessing", type_line: "Sorcery", mana_cost: "{G}", cmc: 1, oracle_text: "Each player gains 1 life." });
const TARGET_LOSS_SPELL = () => make({ name: "Shared Burden", type_line: "Sorcery", mana_cost: "{B}", cmc: 1, oracle_text: "Target player loses 3 life." });
const EACH_LOSS_SPELL = () => make({ name: "Common Burden", type_line: "Sorcery", mana_cost: "{B}", cmc: 1, oracle_text: "Each player loses 1 life." });
const X_OPPONENT_LOSS = () => make({ name: "Scalable Burden", type_line: "Sorcery", mana_cost: "{X}{B}", cmc: 1, oracle_text: "Each opponent loses X life." });
const GRAVEYARD_RETURN = () => make({ name: "Unearth Memory", type_line: "Sorcery", mana_cost: "{B}", cmc: 1, oracle_text: "Return target creature card from your graveyard to your hand." });
const GRAVEYARD_EXILE = () => make({ name: "Grave Purge", type_line: "Instant", mana_cost: "{B}", cmc: 1, oracle_text: "Exile target card from your graveyard." });
const LIFE_COUNTER = () => make({ name: "Life Counter", type_line: "Creature — Human Cleric", mana_cost: "{1}{W}", cmc: 2, power: "1", toughness: "1", oracle_text: "Whenever you gain life, put a +1/+1 counter on Life Counter." });
const ANNIHILATE = () => make({ name: "Annihilate", type_line: "Instant", mana_cost: "{2}{B}", cmc: 3, oracle_text: "Destroy target nonblack creature. Draw a card." });
const FAMINE = () => make({ name: "Famine", type_line: "Sorcery", mana_cost: "{3}{B}{B}", cmc: 5, oracle_text: "Famine deals 3 damage to each creature and each player." });
const DEATH_GRASP = () => make({ name: "Death Grasp", type_line: "Sorcery", mana_cost: "{X}{W}{B}", cmc: 2, oracle_text: "Death Grasp deals X damage to any target. You gain X life." });
const FLYING_REMOVAL = () => make({ name: "Sky Hunter's Bane", type_line: "Instant", mana_cost: "{2}{G}", cmc: 3, oracle_text: "Destroy target creature with flying." });
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
const CROSIS_CHARM = () => make({
  name: "Crosis's Charm", type_line: "Instant", mana_cost: "{U}{B}{R}", cmc: 3,
  oracle_text: "Choose one —\n• Return target permanent to its owner's hand.\n• Destroy target nonblack creature. It can't be regenerated.\n• Destroy target artifact."
});
const LANDFALL_BEAST = () => make({
  name: "Landfall Beast", type_line: "Creature — Beast", mana_cost: "{2}{G}", cmc: 3, power: "4", toughness: "4",
  oracle_text: "Landfall — Whenever a land you control enters, create a 4/4 green Beast creature token."
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
const PLANT_COUNTERS = () => make({ name: "Verdant Rally", type_line: "Sorcery", mana_cost: "{G}", cmc: 1, oracle_text: "Put a +1/+1 counter on each Plant creature you control." });
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
const TEMPLE_OF_FALSE_GOD = () => make({ name: "Temple of the False God", type_line: "Land", oracle_text: "{T}: Add {C}{C}. Activate only if you control five or more lands.", produced_mana: ["C"] });
const VIVID_CREEK = () => make({ name: "Vivid Creek", type_line: "Land", oracle_text: "Vivid Creek enters the battlefield tapped with two charge counters on it.\n{T}: Add {U}.\n{T}, Remove a charge counter from Vivid Creek: Add one mana of any color.", produced_mana: ["U", "W", "B", "R", "G"] });
const VIVID_SPELL = () => make({ name: "Vivid Lesson", type_line: "Sorcery", mana_cost: "{R}", cmc: 1, oracle_text: "Draw a card." });
const ELVES = () => make({ name: "Llanowar Elves", type_line: "Creature — Elf Druid", mana_cost: "{G}", cmc: 1, power: "1", toughness: "1", oracle_text: "{T}: Add {G}.", produced_mana: ["G"] });
const DELTA = () => make({
  name: "Polluted Delta", type_line: "Land",
  oracle_text: "{T}, Pay 1 life, Sacrifice Polluted Delta: Search your library for an Island or Swamp card, put it onto the battlefield, then shuffle."
});
const CYCLING_LAND = () => make({
  name: "Barren Moor", type_line: "Land", oracle_text: "This land enters tapped.\n{T}: Add {B}.\nCycling {B} ({B}, Discard this card: Draw a card.)"
});
const WATERY_GRAVE = () => make({
  name: "Watery Grave", type_line: "Land — Island Swamp", oracle_text: "({T}: Add {U} or {B}.)"
});
const ETB_BOLTER = () => make({
  name: "Flame Herald", type_line: "Creature — Dragon", mana_cost: "{3}{R}", cmc: 4, power: "3", toughness: "3",
  oracle_text: "When Flame Herald enters the battlefield, Flame Herald deals 2 damage to any target."
});
const DEATH_DRAIN = () => make({
  name: "Grave Pact Acolyte", type_line: "Creature — Cleric", mana_cost: "{1}{B}", cmc: 2, power: "1", toughness: "1",
  oracle_text: "When Grave Pact Acolyte dies, each opponent loses 2 life."
});
const WATCHER = () => make({
  name: "Mortuary Watcher", type_line: "Creature — Spirit", mana_cost: "{2}{B}", cmc: 3, power: "2", toughness: "2",
  oracle_text: "Whenever another creature you control dies, you gain 1 life."
});
const ANY_DEATH_WATCHER = () => make({
  name: "Blood Chronicler", type_line: "Creature — Vampire", mana_cost: "{2}{B}", cmc: 3, power: "2", toughness: "3",
  oracle_text: "Whenever a creature dies, you gain 1 life."
});
const RAIDER = () => make({
  name: "Bloodthirst Raider", type_line: "Creature — Orc", mana_cost: "{1}{R}", cmc: 2, power: "2", toughness: "2",
  oracle_text: "Whenever Bloodthirst Raider attacks, Bloodthirst Raider deals 1 damage to any target."
});
const CREATURE_COMBAT_DRAWER = () => make({
  name: "Combat Chronicler", type_line: "Creature — Human Wizard", mana_cost: "{2}{U}", cmc: 3, power: "1", toughness: "3",
  oracle_text: "Whenever a creature deals combat damage to a player, draw a card."
});
const UPKEEP_SAGE = () => make({
  name: "Dawn Sage", type_line: "Creature — Human Wizard", mana_cost: "{2}{W}", cmc: 3, power: "1", toughness: "3",
  oracle_text: "At the beginning of your upkeep, you gain 2 life."
});
const SIGNAL_PEST = () => make({
  name: "Well of Lore", type_line: "Artifact", mana_cost: "{2}", cmc: 2,
  oracle_text: "{1}{U}, {T}: Draw a card."
});
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

  it("preserves the tapped instruction on created tokens", () => {
    const profile = profileOf(TAPPED_ZOMBIES());
    expect(profile.effects[0]).toMatchObject({ kind: "create-token", amount: 13, token: { name: "Zombie", power: 2, toughness: 2, tapped: true } });
    let game = readyToCast([TAPPED_ZOMBIES()], [SWAMP(), SWAMP(), SWAMP(), SWAMP(), SWAMP(), SWAMP(), SWAMP()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    const zombies = game.players[0]!.battlefield.filter((permanent) => permanent.card.name === "Zombie");
    expect(zombies).toHaveLength(13);
    expect(zombies.every((permanent) => permanent.tapped)).toBe(true);
  });

  it("scales token creation from the controller's current land count", () => {
    const profile = profileOf(LAND_SCALED_TOKENS());
    expect(profile.effects[0]).toMatchObject({ kind: "create-token", amount: "lands-you-control", token: { name: "Plant", power: 0, toughness: 1 } });
    let game = readyToCast([LAND_SCALED_TOKENS()], [FOREST(), FOREST(), FOREST()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.players[0]!.battlefield.filter((permanent) => permanent.card.name === "Plant")).toHaveLength(3);
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

  it("lets an opponent respond to and counter the ETB ability", () => {
    let game = readyToCast([ETB_DRAWER()], [FOREST(), FOREST()], [COUNTER()], [ISLAND(), ISLAND()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    game = applyAction(game, 1, { type: "pass" });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Archivist Bear")).toBe(true);
    const triggerId = game.stack[0]!.id;
    game = applyAction(game, 1, { type: "cast", cardId: "foe-0", targets: [{ kind: "spell", stackId: triggerId }] });
    expect(game.players[0]!.hand).toHaveLength(0);
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Archivist Bear")).toBe(true);
    expect(game.players[0]!.library).toHaveLength(32);
    expect(game.players[1]!.graveyard.some((card) => card.name === "Cancel Spell")).toBe(true);
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

  it("reuses the landfall trigger subject when a land enters", () => {
    let game = readyToCast([LANDFALL_BEAST(), FOREST()], [FOREST(), FOREST(), FOREST()]);
    game = applyAction(game, 0, { type: "cast", cardId: "hand-0" });
    expect(game.players[0]!.battlefield.some((permanent) => permanent.card.name === "Landfall Beast")).toBe(true);
    game = applyAction(game, 0, { type: "play-land", cardId: "hand-1" });
    expect(game.players[0]!.battlefield.filter((permanent) => permanent.card.name === "Beast")).toHaveLength(1);
    expect(game.players[0]!.battlefield.find((permanent) => permanent.card.name === "Beast")?.card).toMatchObject({ power: "4", toughness: "4", type_line: "Creature — Beast" });
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

describe("triggered abilities", () => {
  function readyToCast(cards: CardData[], battlefield: CardData[], opponentBoard: CardData[] = []) {
    let game = twoSeatGame([], []);
    game = stage(game, 0, () => ({ hand: toHand(0, cards) }));
    game = stage(game, 1, () => ({ hand: [] }));
    game = putOnBattlefield(game, 0, battlefield);
    if (opponentBoard.length) game = putOnBattlefield(game, 1, opponentBoard);
    return passUntil(game, (state) => state.step === "precombat-main" && state.activeSeat === 0 && state.prioritySeat === 0);
  }

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
    expect(profileOf(ETB_DRAWER()).triggers[0]).toMatchObject({ event: "enters-battlefield", subject: "self", targetKind: "none" });
    expect(profileOf(DEATH_DRAIN()).triggers[0]).toMatchObject({ event: "dies", subject: "self" });
    expect(profileOf(WATCHER()).triggers[0]).toMatchObject({ event: "dies", subject: "another-creature-you-control" });
    expect(profileOf(RAIDER()).triggers[0]).toMatchObject({ event: "attacks", subject: "self", targetKind: "any" });
    expect(profileOf(UPKEEP_SAGE()).triggers[0]).toMatchObject({ event: "upkeep", subject: "you" });
    expect(profileOf(CREATURE_COMBAT_DRAWER()).triggers[0]).toMatchObject({ event: "deals-combat-damage-to-player", subject: "any-creature", effect: { kind: "draw", amount: 1 } });
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
        tapped: false, summoningSick: false, damage: 99, deathtouched: false, counters: {}, powerModifier: 0, toughnessModifier: 0, isCommander: true
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
        tapped: false, summoningSick: false, damage: 0, deathtouched: false, counters: {}, powerModifier: 0, toughnessModifier: 0, isCommander: true
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
});
