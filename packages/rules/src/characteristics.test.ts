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

  it("keeps multiple mana abilities when a restriction follows production", () => {
    const profile = cardProfile(card({
      name: "Delighted Halfling",
      type_line: "Creature — Halfling",
      oracle_text: "{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast a legendary spell, and that spell can't be countered.",
      produced_mana: ["B", "C", "G", "R", "U", "W"]
    }));
    expect(profile.manaAbilities).toHaveLength(2);
    expect(profile.manaAbilities[0]!.produces).toEqual(["C"]);
    expect(profile.manaAbilities[1]!.produces).toEqual(["W", "U", "B", "R", "G"]);
  });

  it("recognises generic cycling from hand", () => {
    const profile = cardProfile(card({ name: "Barren Moor", type_line: "Land", oracle_text: "This land enters tapped.\n{T}: Add {B}.\nCycling {B} ({B}, Discard this card: Draw a card.)" }));
    expect(profile.cyclingCost?.raw).toBe("{B}");
    expect(profile.fullyImplemented).toBe(true);
  });

  it("recognises multiple landcycling variants as reusable searches", () => {
    const profile = cardProfile(card({
      name: "Valley Rannet", type_line: "Creature — Beast", mana_cost: "{3}{R}{G}",
      oracle_text: "Mountaincycling {2}, forestcycling {2} ({2}, Discard this card: Search your library for a Mountain or Forest card, reveal it, put it into your hand, then shuffle.)"
    }));
    expect(profile.cyclingSearches.map((ability) => ability.subtypes)).toEqual([["Mountain"], ["Forest"]]);
    expect(profile.cyclingSearches.map((ability) => ability.cost.raw)).toEqual(["{2}", "{2}"]);
    expect(profile.cyclingSearches.map((ability) => ability.text)).toEqual(["Mountaincycling {2}", "Forestcycling {2}"]);
    expect(profile.fullyImplemented).toBe(true);
  });

  it("preserves an open-ended subtype in Steelshaper's Gift", () => {
    const profile = cardProfile(card({
      name: "Steelshaper's Gift", type_line: "Sorcery", mana_cost: "{W}",
      oracle_text: "Search your library for an Equipment card, reveal it, put it into your hand, then shuffle."
    }));
    expect(profile.effects[0]).toMatchObject({ kind: "search-library", types: [], subtypes: ["Equipment"], destination: "hand" });
    expect(profile.fullyImplemented).toBe(true);
  });

  it("recognises reusable Equipment equip and static modifications", () => {
    const cases = [
      card({ name: "Behemoth Sledge", type_line: "Artifact — Equipment", oracle_text: "Equipped creature gets +2/+2 and has trample and lifelink.\nEquip {3}" }),
      card({ name: "Swiftfoot Boots", type_line: "Artifact — Equipment", oracle_text: "Equipped creature has hexproof and haste.\nEquip {1}" }),
      card({ name: "Sword of the Paruns", type_line: "Artifact — Equipment", oracle_text: "Equipped creature gets +2/+0.\n{3}: Untap equipped creature.\n{3}: Untap all other creatures you control.\nEquip {3}" })
    ].map(cardProfile);
    expect(cases.map((profile) => profile.equipCost?.raw)).toEqual(["{3}", "{1}", "{3}"]);
    expect(cases[0]!.equipmentModification).toMatchObject({ power: 2, toughness: 2, keywords: ["trample", "lifelink"] });
    expect(cases[1]!.equipmentModification?.keywords).toEqual(["hexproof", "haste"]);
    expect(cases[2]!.equipmentModification).toMatchObject({ power: 2, toughness: 0, keywords: [] });
    expect(cases[2]!.activatedAbilities.map((ability) => ability.effect.kind)).toEqual([
      "untap-equipped-creature", "untap-all-other-creatures-you-control"
    ]);
    expect(cases.every((profile) => profile.fullyImplemented)).toBe(true);
  });
});

describe("enters tapped", () => {
  const rule = (text: string, typeLine = "Land") => cardProfile(card({ name: "Test Land", type_line: typeLine, oracle_text: text })).entersTapped;

  it("defaults to untapped", () => { expect(rule("{T}: Add {G}.").kind).toBe("untapped"); });
  it("detects a plain tapped land", () => { expect(rule("Test Land enters tapped.\n{T}: Add {W} or {U}.").kind).toBe("tapped"); });
  it("detects a fast land condition", () => { expect(rule("Test Land enters tapped unless you control two or fewer other lands.")).toEqual({ kind: "unless-few-lands", max: 2 }); });
  it("detects a shock land condition", () => { expect(rule("As Test Land enters, you may pay 2 life. If you don't, it enters tapped.")).toEqual({ kind: "unless-pay-life", life: 2 }); });
  it("does not flag an entering-tapped replacement already handled by the profile", () => {
    const profile = cardProfile(card({ name: "Test Guildgate", type_line: "Land — Gate", oracle_text: "This land enters tapped.\n{T}: Add {W} or {U}." }));
    expect(profile.fullyImplemented).toBe(true);
  });
});

describe("effect recognition", () => {
  it("recognizes a draw spell", () => {
    const profile = cardProfile(card({ name: "Test Draw", type_line: "Sorcery", mana_cost: "{2}{U}", oracle_text: "Draw three cards." }));
    expect(profile.effects).toEqual([{ kind: "draw", amount: 3 }]);
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.targetKind).toBe("none");
  });

  it("recognizes a token creation effect", () => {
    const profile = cardProfile(card({ name: "Plant Maker", type_line: "Sorcery", mana_cost: "{3}{G}", oracle_text: "Create three 0/1 green Plant creature tokens." }));
    expect(profile.effects[0]).toMatchObject({ kind: "create-token", amount: 3, token: { name: "Plant", power: 0, toughness: 1, colors: ["G"] } });
    expect(profile.fullyImplemented).toBe(true);
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

  it("keeps unsupported modal branches in diagnostics", () => {
    const profile = cardProfile(card({
      name: "Modal Diagnostic",
      type_line: "Instant",
      mana_cost: "{2}",
      oracle_text: "Choose one —\n• Target player sacrifices a permanent.\n• Put a doom counter on target permanent."
    }));
    expect(profile.fullyImplemented).toBe(false);
    expect(profile.unimplementedText).toEqual([
      "Choose one —",
      "Target player sacrifices a permanent.",
      "Put a doom counter on target permanent."
    ]);
  });

  it("recognises Equipment as an artifact subtype target on the battlefield", () => {
    const profile = cardProfile(card({ name: "Exile Equipment", type_line: "Instant", mana_cost: "{1}{W}", oracle_text: "Exile target Equipment." }));
    expect(profile.effects).toEqual([{ kind: "exile-target-permanent" }]);
    expect(profile.targetKind).toBe("subtype:Equipment");
    expect(profile.fullyImplemented).toBe(true);
  });

  it("recognises any simple subtype target through the same grammar", () => {
    const profile = cardProfile(card({ name: "Goblin Removal", type_line: "Instant", mana_cost: "{1}{R}", oracle_text: "Destroy target Goblin." }));
    expect(profile.targetKind).toBe("subtype:Goblin");
    expect(profile.fullyImplemented).toBe(true);
  });

  it("recognises the artifact, enchantment, or land target union", () => {
    const profile = cardProfile(card({ name: "Slime", type_line: "Creature — Ooze", oracle_text: "When Slime enters, destroy target artifact, enchantment, or land." }));
    expect(profile.triggers[0]?.targetKind).toBe("artifact-enchantment-or-land");
    expect(profile.fullyImplemented).toBe(true);
  });

  it("recognises reusable landfall and artifact-creature trigger subjects", () => {
    const landfall = cardProfile(card({
      name: "Landfall Beast", type_line: "Creature — Beast", mana_cost: "{2}{G}", power: "4", toughness: "4",
      oracle_text: "Landfall — Whenever a land you control enters, create a 4/4 green Beast creature token."
    }));
    expect(landfall.triggers[0]).toMatchObject({ event: "enters-battlefield", subject: "land-you-control", effect: { kind: "create-token", amount: 1 } });
    expect(landfall.fullyImplemented).toBe(true);

    const sphinx = cardProfile(card({
      name: "Artifact Sphinx", type_line: "Creature — Sphinx", mana_cost: "{4}{U}", power: "4", toughness: "4",
      oracle_text: "Whenever an artifact creature you control deals combat damage to a player, you may create a 1/1 blue Thopter artifact creature token with flying."
    }));
    expect(sphinx.triggers[0]).toMatchObject({ event: "deals-combat-damage-to-player", subject: "artifact-creature-you-control", optional: true });
    expect(sphinx.fullyImplemented).toBe(true);
  });

  it("treats a keyword-only body as fully covered", () => {
    const profile = cardProfile(card({ name: "Serra Angel", type_line: "Creature — Angel", mana_cost: "{3}{W}{W}", oracle_text: "Flying, vigilance", keywords: ["Flying", "Vigilance"], power: "4", toughness: "4" }));
    expect(profile.keywords).toEqual(["flying", "vigilance"]);
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.power).toBe(4);
  });

  it("reports unmatched text instead of guessing at it", () => {
    const profile = cardProfile(card({ name: "Complex Card", type_line: "Sorcery", mana_cost: "{2}{G}", oracle_text: "Search your library for a creature card, then do something strange." }));
    expect(profile.effects).toHaveLength(0);
    expect(profile.fullyImplemented).toBe(false);
  });

  it("does not claim a partially recognised multi-sentence spell is complete", () => {
    const profile = cardProfile(card({
      name: "Partial Wrath", type_line: "Sorcery", mana_cost: "{4}{B}{B}",
      oracle_text: "Destroy all creatures. Draw a card for each creature destroyed this way."
    }));
    expect(profile.effects).toEqual([{ kind: "destroy-all-creatures" }]);
    expect(profile.fullyImplemented).toBe(false);
    expect(profile.unimplementedText).toEqual(["Draw a card for each creature destroyed this way."]);
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

  it("treats the modern \"this land\" phrasing as a self reference", () => {
    // Current Oracle text stopped repeating the card's name; a parser that only
    // knows the printed name misses most reprints.
    const text = normalizedOracle(card({
      name: "Polluted Delta", type_line: "Land",
      oracle_text: "{T}, Pay 1 life, Sacrifice this land: Search your library for an Island or Swamp card, put it onto the battlefield, then shuffle."
    }));
    expect(text).toContain("Sacrifice ~:");
  });

  it("leaves phrases that only look like self references alone", () => {
    const text = normalizedOracle(card({
      name: "Test", type_line: "Sorcery",
      oracle_text: "Draw a card. You gain 2 life this turn. Each player chooses this way."
    }));
    expect(text).toBe("Draw a card. You gain 2 life this turn. Each player chooses this way.");
  });

  it("reads a fetch land's whole ability through the modern phrasing", () => {
    const profile = cardProfile(card({
      name: "Polluted Delta", type_line: "Land",
      oracle_text: "{T}, Pay 1 life, Sacrifice this land: Search your library for an Island or Swamp card, put it onto the battlefield, then shuffle."
    }));
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.activatedAbilities).toHaveLength(1);
    expect(profile.activatedAbilities[0]).toMatchObject({ requiresTap: true, sacrificesSelf: true, lifeCost: 1 });
  });

  it("reads both halves of a modern enters/dies creature", () => {
    const profile = cardProfile(card({
      name: "Solemn Simulacrum", type_line: "Artifact Creature — Golem", mana_cost: "{4}", power: "2", toughness: "2",
      oracle_text: "When this creature enters, you may search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.\nWhen this creature dies, you may draw a card."
    }));
    expect(profile.triggers.map((trigger) => trigger.event)).toEqual(["enters-battlefield", "dies"]);
    expect(profile.triggers.every((trigger) => trigger.optional)).toBe(true);
    // The land arrives tapped because the effect says so, not because of its own text.
    expect(profile.triggers[0]!.effect).toMatchObject({ kind: "search-library", destination: "battlefield", tapped: true });
  });

  it("refuses to read a restricted mana clause as five free colours", () => {
    const profile = cardProfile(card({
      name: "Exotic Orchard", type_line: "Land", produced_mana: ["W", "U", "B", "R", "G"],
      oracle_text: "{T}: Add one mana of any color that a land an opponent controls could produce."
    }));
    // It still plays through the structured fallback, but it must not claim the
    // text is executed, because the colours it can really make are conditional.
    expect(profile.manaAbilities).toHaveLength(1);
    expect(profile.fullyImplemented).toBe(false);
  });
});
