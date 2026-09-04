import { describe, expect, it } from "vitest";
import { filterTestedDeckCards } from "./tested.js";
import type { CardData } from "./characteristics.js";

const commander: CardData = {
  scryfall_id: "commander-printing",
  oracle_id: "commander-oracle",
  name: "Green Captain",
  type_line: "Legendary Creature — Human",
  color_identity: ["G"],
  mana_cost: "{G}"
};
const forest: CardData = {
  scryfall_id: "forest-printing",
  oracle_id: "forest-oracle",
  name: "Forest",
  type_line: "Basic Land — Forest",
  color_identity: ["G"],
  produced_mana: ["G"]
};
const completeSpell: CardData = {
  scryfall_id: "spell-printing",
  oracle_id: "spell-oracle",
  name: "Complete Spell",
  type_line: "Sorcery",
  color_identity: ["G"]
};
const incompleteSpell: CardData = {
  scryfall_id: "incomplete-printing",
  oracle_id: "incomplete-oracle",
  name: "Incomplete Spell",
  type_line: "Sorcery",
  color_identity: ["G"]
};
const offColorSpell: CardData = {
  scryfall_id: "off-color-printing",
  oracle_id: "off-color-oracle",
  name: "Off Color Spell",
  type_line: "Sorcery",
  color_identity: ["U"]
};

function deck(cards: CardData[] = [commander, completeSpell, incompleteSpell, offColorSpell, ...Array.from({ length: 96 }, () => forest)]) {
  return { name: "Test deck", commanders: [commander.name], cards };
}

describe("tested-mode deck filter", () => {
  it("filters by oracle_id, keeps a legal commander and fills to 100 with complete basics", () => {
    const cards = filterTestedDeckCards(deck(), new Set(["commander-oracle", "spell-oracle", "forest-oracle"]));
    expect(cards).toHaveLength(100);
    expect(cards[0]).toBe(commander);
    expect(cards.some((card) => card.oracle_id === "incomplete-oracle")).toBe(false);
    expect(cards.some((card) => card.oracle_id === "off-color-oracle")).toBe(false);
    expect(cards.every((card) => card.oracle_id && ["commander-oracle", "spell-oracle", "forest-oracle"].includes(card.oracle_id))).toBe(true);
    expect(cards.filter((card) => card.oracle_id === "forest-oracle").length).toBeGreaterThan(96);
  });

  it("rejects a deck when its commander is not fully implemented", () => {
    expect(() => filterTestedDeckCards(deck(), new Set(["forest-oracle"]))).toThrow(/fully implemented/);
  });

  it("rejects a filtered deck that cannot reach the Commander minimum", () => {
    const noBasics = [
      commander,
      ...Array.from({ length: 50 }, (_, index) => ({ ...completeSpell, scryfall_id: `spell-${index}` })),
      ...Array.from({ length: 49 }, (_, index) => ({ ...incompleteSpell, scryfall_id: `incomplete-${index}` }))
    ];
    expect(() => filterTestedDeckCards(deck(noBasics), new Set(["commander-oracle", "spell-oracle"]))).toThrow(/minimum/);
  });
});
