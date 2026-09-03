import { describe, expect, it } from "vitest";
import { cardProfile, normalizedOracle, type CardData } from "./characteristics.js";

let counter = 0;
function card(overrides: Partial<CardData> & { name: string; type_line: string }): CardData {
  counter += 1;
  return { scryfall_id: `test-${counter}`, mana_cost: "", cmc: 0, ...overrides };
}

describe("type line parsing", () => {
  it("splits supertypes, types and subtypes", () => {
    const profile = cardProfile(card({ name: "Test Angel", type_line: "Legendary Creature — Phyrexian Angel" }));
    expect(profile.supertypes).toEqual(["Legendary"]);
    expect(profile.types).toEqual(["Creature"]);
    expect(profile.subtypes).toEqual(["Phyrexian", "Angel"]);
    expect(profile.isPermanent).toBe(true);
  });

  it("marks instants and sorceries as non-permanents", () => {
    expect(cardProfile(card({ name: "Test Bolt", type_line: "Instant" })).isPermanent).toBe(false);
    expect(cardProfile(card({ name: "Test Wrath", type_line: "Sorcery" })).isPermanent).toBe(false);
  });
});

describe("mana abilities", () => {
  it("derives a basic land ability from produced_mana", () => {
    const profile = cardProfile(card({ name: "Forest", type_line: "Basic Land — Forest", oracle_text: "({T}: Add {G}.)", produced_mana: ["G"] }));
    expect(profile.manaAbilities).toHaveLength(1);
    expect(profile.manaAbilities[0]).toMatchObject({ produces: ["G"], amount: 1, requiresTap: true, lifeCost: 0 });
  });

  it("reads a repeated symbol as two mana", () => {
    const profile = cardProfile(card({ name: "Sol Ring", type_line: "Artifact", mana_cost: "{1}", oracle_text: "{T}: Add {C}{C}.", produced_mana: ["C"] }));
    expect(profile.manaAbilities[0]).toMatchObject({ produces: ["C"], amount: 2 });
  });

  it("reads an any-color ability", () => {
    const profile = cardProfile(card({ name: "Command Tower", type_line: "Land", oracle_text: "{T}: Add one mana of any color in your commander's color identity.", produced_mana: ["W", "U", "B", "R", "G"] }));
    expect(profile.manaAbilities[0]?.produces).toHaveLength(5);
    expect(profile.manaAbilities[0]?.amount).toBe(1);
  });

  it("reads an either-or ability as a single mana with a choice", () => {
    const profile = cardProfile(card({ name: "Test Dual", type_line: "Land", oracle_text: "{T}: Add {W} or {U}.", produced_mana: ["W", "U"] }));
    expect(profile.manaAbilities[0]).toMatchObject({ produces: ["W", "U"], amount: 1 });
  });

  it("records the life cost of a pain land", () => {
    const profile = cardProfile(card({ name: "Test Pain", type_line: "Land", oracle_text: "{T}: Add {C}.\n{T}, Pay 1 life: Add {R}.", produced_mana: ["C", "R"] }));
    expect(profile.manaAbilities[0]).toMatchObject({ produces: ["C"], lifeCost: 0 });
  });

  it("ignores an ability whose cost is not modeled", () => {
    const profile = cardProfile(card({ name: "Test Filter", type_line: "Land", oracle_text: "{1}, {T}: Add {W}{U}." }));
    expect(profile.manaAbilities).toHaveLength(0);
  });

  it("gives a fetch land no mana ability", () => {
    const profile = cardProfile(card({ name: "Flooded Strand", type_line: "Land", oracle_text: "{T}, Pay 1 life, Sacrifice Flooded Strand: Search your library for an Island or Plains card.", produced_mana: [] }));
    expect(profile.manaAbilities).toHaveLength(0);
  });
});

describe("enters tapped", () => {
  const rule = (text: string, typeLine = "Land") => cardProfile(card({ name: "Test Land", type_line: typeLine, oracle_text: text })).entersTapped;

  it("defaults to untapped", () => { expect(rule("{T}: Add {G}.").kind).toBe("untapped"); });
  it("detects a plain tapped land", () => { expect(rule("Test Land enters tapped.\n{T}: Add {W} or {U}.").kind).toBe("tapped"); });
  it("detects a fast land condition", () => { expect(rule("Test Land enters tapped unless you control two or fewer other lands.")).toEqual({ kind: "unless-few-lands", max: 2 }); });
  it("detects a shock land condition", () => { expect(rule("As Test Land enters, you may pay 2 life. If you don't, it enters tapped.")).toEqual({ kind: "unless-pay-life", life: 2 }); });
});

describe("effect recognition", () => {
  it("recognizes a draw spell", () => {
    const profile = cardProfile(card({ name: "Test Draw", type_line: "Sorcery", mana_cost: "{2}{U}", oracle_text: "Draw three cards." }));
    expect(profile.effects).toEqual([{ kind: "draw", amount: 3 }]);
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.targetKind).toBe("none");
  });

  it("recognizes targeted damage and its target kind", () => {
    const profile = cardProfile(card({ name: "Lightning Bolt", type_line: "Instant", mana_cost: "{R}", oracle_text: "Lightning Bolt deals 3 damage to any target." }));
    expect(profile.effects).toEqual([{ kind: "damage-any-target", amount: 3 }]);
    expect(profile.targetKind).toBe("any");
  });

  it("recognizes removal and counterspells", () => {
    expect(cardProfile(card({ name: "Murder", type_line: "Instant", mana_cost: "{1}{B}{B}", oracle_text: "Destroy target creature." })).targetKind).toBe("creature");
    expect(cardProfile(card({ name: "Counterspell", type_line: "Instant", mana_cost: "{U}{U}", oracle_text: "Counter target spell." })).targetKind).toBe("spell");
    expect(cardProfile(card({ name: "Wrath of God", type_line: "Sorcery", mana_cost: "{2}{W}{W}", oracle_text: "Destroy all creatures. They can't be regenerated." })).effects).toEqual([{ kind: "destroy-all-creatures" }]);
  });

  it("treats a keyword-only body as fully covered", () => {
    const profile = cardProfile(card({ name: "Serra Angel", type_line: "Creature — Angel", mana_cost: "{3}{W}{W}", oracle_text: "Flying, vigilance", keywords: ["Flying", "Vigilance"], power: "4", toughness: "4" }));
    expect(profile.keywords).toEqual(["flying", "vigilance"]);
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.power).toBe(4);
  });

  it("reports unmatched text instead of guessing at it", () => {
    const profile = cardProfile(card({ name: "Complex Card", type_line: "Sorcery", mana_cost: "{2}{G}", oracle_text: "Search your library for a creature card, put it onto the battlefield, then shuffle." }));
    expect(profile.effects).toHaveLength(0);
    expect(profile.fullyImplemented).toBe(false);
  });
});

describe("faces and oracle normalisation", () => {
  it("uses the front face of a double-faced card", () => {
    const profile = cardProfile(card({
      name: "Front // Back", type_line: "Creature — Avatar // Sorcery",
      card_faces: [{ name: "Front", type_line: "Creature — Avatar", mana_cost: "{4}", power: "5", toughness: "5" }, { name: "Back", type_line: "Sorcery" }]
    }));
    expect(profile.types).toEqual(["Creature"]);
    expect(profile.power).toBe(5);
  });

  it("replaces the card's own name with ~ and strips reminder text", () => {
    const text = normalizedOracle(card({ name: "Atraxa, Grand Unifier", type_line: "Creature", oracle_text: "When Atraxa enters, draw a card. (Reminder.)" }));
    expect(text).toBe("When ~ enters, draw a card.");
  });
});
