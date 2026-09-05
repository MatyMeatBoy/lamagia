import { describe, expect, it } from "vitest";
import { cardProfile, hasSubtype, normalizedOracle, type CardData } from "./characteristics.js";

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

  it("models changeling as every creature subtype", () => {
    const profile = cardProfile(card({ name: "Shapeshifter", type_line: "Creature — Shapeshifter", keywords: ["Changeling"] }));
    expect(profile.changeling).toBe(true);
    expect(hasSubtype(profile, "Elf")).toBe(true);
    expect(hasSubtype(profile, "Goblin")).toBe(true);
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.unimplementedText).toEqual([]);
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

  it("recognises Opal Palace's commander-entry counter rider", () => {
    const profile = cardProfile(card({
      name: "Opal Palace", type_line: "Land",
      oracle_text: "{T}: Add {C}.\n{1}, {T}: Add one mana of any color in your commander's color identity. If you spend this mana to cast your commander, it enters with a number of additional +1/+1 counters on it equal to the number of times it's been cast from the command zone this game.",
      produced_mana: ["B", "C", "G", "R", "U", "W"]
    }));
    expect(profile.manaAbilities[1]).toMatchObject({
      produces: ["W", "U", "B", "R", "G"], amount: 1,
      commanderIdentity: true, commanderEntryCounters: true, manaCost: { raw: "{1}" }
    });
    expect(profile.fullyImplemented).toBe(true);
  });

  it("reads an either-or ability as a single mana with a choice", () => {
    const profile = cardProfile(card({ name: "Test Dual", type_line: "Land", oracle_text: "{T}: Add {W} or {U}.", produced_mana: ["W", "U"] }));
    expect(profile.manaAbilities[0]).toMatchObject({ produces: ["W", "U"], amount: 1 });
  });

  it("records the life cost of a pain land", () => {
    const profile = cardProfile(card({ name: "Test Pain", type_line: "Land", oracle_text: "{T}: Add {C}.\n{T}, Pay 1 life: Add {R}.", produced_mana: ["C", "R"] }));
    expect(profile.manaAbilities[0]).toMatchObject({ produces: ["C"], lifeCost: 0 });
  });

  it("reads a mana ability with a generic activation cost", () => {
    const profile = cardProfile(card({ name: "Test Filter", type_line: "Land", oracle_text: "{1}, {T}: Add {W}{U}." }));
    expect(profile.manaAbilities[0]).toMatchObject({ manaCost: { raw: "{1}" }, produces: ["W", "U"], fixedProduces: ["W", "U"] });
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
    expect(profile.manaAbilities[1]).toMatchObject({
      produces: ["W", "U", "B", "R", "G"],
      manaRestriction: { kind: "legendary-spell", makesSpellUncounterable: true }
    });
    expect(profile.fullyImplemented).toBe(true);
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

  it("recognises energy as a player-counter activation cost", () => {
    const profile = cardProfile(card({
      name: "Energy Device", type_line: "Artifact", mana_cost: "{2}",
      oracle_text: "{T}, Pay {E}: Draw a card."
    }));
    expect(profile.activatedAbilities[0]).toMatchObject({ requiresTap: true, energyCost: 1, effect: { kind: "draw", amount: 1 } });
    expect(profile.fullyImplemented).toBe(true);
  });

  it("recognises energy production as a player-counter effect", () => {
    const profile = cardProfile(card({
      name: "Energy Burst", type_line: "Instant", mana_cost: "{1}{G}",
      oracle_text: "You get {E}{E}."
    }));
    expect(profile.effects).toEqual([{ kind: "add-player-counter", counter: "energy", amount: 2 }]);
    expect(profile.fullyImplemented).toBe(true);
  });

  it("recognises the untap symbol as an activation cost", () => {
    const profile = cardProfile(card({
      name: "Untap Device", type_line: "Artifact", mana_cost: "{2}",
      oracle_text: "{Q}: Draw a card."
    }));
    expect(profile.activatedAbilities[0]).toMatchObject({ requiresUntap: true, effect: { kind: "draw", amount: 1 } });
    expect(profile.fullyImplemented).toBe(true);
  });

  it("normalizes replacement-character keyword separators from legacy imports", () => {
    const profile = cardProfile(card({
      name: "Legacy Landfall", type_line: "Creature — Elf",
      oracle_text: "Landfall � Whenever a land you control enters, you may gain 2 life."
    }));
    expect(profile.triggers[0]).toMatchObject({
      event: "enters-battlefield",
      subject: "land-you-control",
      optional: true,
      effect: { kind: "gain-life", amount: 2 }
    });
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

  it("handles plural multi-card search pronouns", () => {
    const profile = cardProfile(card({
      name: "Armillary Sphere", type_line: "Artifact",
      oracle_text: "{2}, {T}, Sacrifice ~: Search your library for up to two basic land cards, reveal them, put them into your hand, then shuffle."
    }));
    expect(profile.activatedAbilities[0]).toMatchObject({
      sacrificesSelf: true,
      effect: { kind: "search-library-multi", types: ["Land"], subtypes: ["Basic"], destinations: ["hand", "hand"], reveal: true }
    });
    expect(profile.fullyImplemented).toBe(true);
  });

  it("normalizes abbreviated self references in historical Oracle imports", () => {
    const profile = cardProfile(card({
      name: "Sharuum the Hegemon", type_line: "Legendary Artifact Creature — Sphinx",
      oracle_text: "When Sharuum enters, you may return target artifact card from your graveyard to the battlefield."
    }));
    expect(profile.triggers[0]).toMatchObject({
      event: "enters-battlefield",
      optional: true,
      targetKind: "artifact-card-in-your-graveyard",
      effect: { kind: "return-target-artifact-card-from-graveyard-to-battlefield" }
    });
    expect(profile.fullyImplemented).toBe(true);
  });

  it("recognises source and targeted regeneration as reusable effects", () => {
    const source = cardProfile(card({
      name: "Marrow Bats", type_line: "Creature — Bat", mana_cost: "{3}{B}", cmc: 4,
      oracle_text: "{B}, Pay 4 life: Regenerate Marrow Bats."
    }));
    expect(source.activatedAbilities[0]).toMatchObject({
      manaCost: { raw: "{B}" }, lifeCost: 4, targetKind: "none", effect: { kind: "regenerate-source" }
    });

    const target = cardProfile(card({
      name: "Regrowth Shield", type_line: "Instant", mana_cost: "{1}{G}", cmc: 2,
      oracle_text: "Regenerate target creature."
    }));
    expect(target.effects[0]).toEqual({ kind: "regenerate-target-creature" });
    expect(target.targetKind).toBe("creature");
    expect(target.fullyImplemented).toBe(true);
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
  // CR 614.12: entering-the-battlefield replacement effects worded as "As
  // [this permanent] enters, ..." are executed as the permanent enters, not
  // as a later resolved instruction — the two-sentence shock/reveal land
  // wording must not leak into unimplementedText once entersTapped already
  // captures the same replacement structurally.
  it("does not flag a shock land's two-sentence pay-life wording as unimplemented", () => {
    const profile = cardProfile(card({
      name: "Test Shock Land", type_line: "Land — Island Swamp",
      oracle_text: "({T}: Add {U} or {B}.)\nAs Test Shock Land enters, you may pay 2 life. If you don't, it enters tapped."
    }));
    expect(profile.entersTapped).toEqual({ kind: "unless-pay-life", life: 2 });
    expect(profile.fullyImplemented).toBe(true);
  });
  it("does not flag a reveal land's two-sentence wording as unimplemented", () => {
    const profile = cardProfile(card({
      name: "Test Reveal Land", type_line: "Land",
      oracle_text: "As Test Reveal Land enters, you may reveal an Island or Swamp card from your hand. If you don't, Test Reveal Land enters tapped.\n{T}: Add {U} or {B}."
    }));
    expect(profile.entersTapped).toEqual({ kind: "unless-reveal-card", subtypes: ["Island", "Swamp"] });
    expect(profile.fullyImplemented).toBe(true);
  });
});

describe("payment trigger parsing", () => {
  it("keeps the caster as the payer for an unless clause", () => {
    const profile = cardProfile(card({
      name: "Rhystic Study",
      type_line: "Enchantment",
      oracle_text: "Whenever an opponent casts a spell, you may draw a card unless that player pays {1}."
    }));
    expect(profile.triggers[0]).toMatchObject({
      event: "spell-cast",
      subject: "opponent",
      optional: true,
      paymentBy: "opponent",
      manaCost: { raw: "{1}" },
      effect: { kind: "draw", amount: 1 }
    });
    expect(profile.fullyImplemented).toBe(true);
  });
});

describe("shared charm parsing", () => {
  it("normalizes a named Naya Charm and preserves all three modes", () => {
    const profile = cardProfile(card({
      name: "Naya Charm",
      type_line: "Instant",
      oracle_text: "Choose one —\n• Naya Charm deals 3 damage to target creature.\n• Return target card from a graveyard to its owner's hand.\n• Tap all creatures target player controls."
    }));
    expect(profile.modalChoices).toHaveLength(3);
    expect(profile.modalChoices[0]).toMatchObject({ effect: { kind: "damage-any-target", amount: 3 }, targetKind: "creature" });
    expect(profile.modalChoices[2]).toMatchObject({ effect: { kind: "tap-all-creatures-target-player" }, targetKind: "player" });
    expect(profile.fullyImplemented).toBe(true);
  });

  it("adds a reusable synthetic mode for Choose one or both", () => {
    const profile = cardProfile(card({
      name: "Soul Manipulation",
      type_line: "Instant",
      oracle_text: "Choose one or both —\n• Counter target creature spell.\n• Return target creature card from your graveyard to your hand."
    }));
    expect(profile.modalChoices).toHaveLength(3);
    expect(profile.modalChoices[2]).toMatchObject({
      text: "Choose both",
      effect: { kind: "compound", targetOffsets: [0, 1] },
      targetKind: "creature-spell",
      targetKinds: ["creature-spell", "creature-card-in-your-graveyard"]
    });
    expect(profile.fullyImplemented).toBe(true);
  });
});

describe("C13 sacrifice-card parsing", () => {
  it("keeps Fires and Bombardment costs separate from their effects", () => {
    const fires = cardProfile(card({
      name: "Fires of Yavimaya",
      type_line: "Enchantment",
      oracle_text: "Creatures you control have haste.\n{R}{G}, Sacrifice Fires of Yavimaya: Creatures you control get +2/+2 until end of turn."
    }));
    const bombardment = cardProfile(card({
      name: "Goblin Bombardment",
      type_line: "Enchantment",
      oracle_text: "Sacrifice a creature: Goblin Bombardment deals 1 damage to any target."
    }));
    expect(fires.activatedAbilities[0]).toMatchObject({ sacrificesSelf: true, effect: { kind: "modify-creatures-you-control" } });
    expect(bombardment.activatedAbilities[0]).toMatchObject({ sacrificesCreature: "any", effect: { kind: "damage-any-target", amount: 1 } });
    expect(fires.fullyImplemented).toBe(true);
    expect(bombardment.fullyImplemented).toBe(true);
  });

  it("preserves a creature subtype in a sacrifice cost", () => {
    const baloth = cardProfile(card({
      name: "Ravenous Baloth",
      type_line: "Creature — Beast",
      oracle_text: "Sacrifice a Beast: You gain 4 life."
    }));
    expect(baloth.activatedAbilities[0]).toMatchObject({
      sacrificesCreatureSubtype: { subtype: "Beast", mode: "any" },
      effect: { kind: "gain-life", amount: 4 },
      targetKind: "none"
    });
    expect(baloth.fullyImplemented).toBe(true);
  });
});

describe("conditional life comparison parsing", () => {
  it("keeps a sequential life gain before the conditional draw", () => {
    const profile = cardProfile(card({
      name: "Survival Cache",
      type_line: "Sorcery",
      oracle_text: "You gain 2 life. Then if you have more life than an opponent, draw a card."
    }));
    expect(profile.effects).toEqual([
      { kind: "gain-life", amount: 2 },
      { kind: "draw-if-life-more-than-opponent", amount: 1 }
    ]);
    expect(profile.fullyImplemented).toBe(true);
  });
});

describe("flashback parsing", () => {
  it("extracts a fixed Flashback alternative cost without flagging the keyword line", () => {
    const profile = cardProfile(card({
      name: "Army of the Damned",
      type_line: "Sorcery",
      mana_cost: "{5}{B}{B}",
      oracle_text: "Create thirteen tapped 2/2 black Zombie creature tokens.\nFlashback {7}{B}{B}"
    }));
    expect(profile.flashbackCost?.raw).toBe("{7}{B}{B}");
    expect(profile.unimplementedText).toEqual([]);
    expect(profile.fullyImplemented).toBe(true);
  });

  it("extracts life bundled into an em-dash Flashback cost", () => {
    const profile = cardProfile(card({
      name: "Deep Analysis",
      type_line: "Sorcery",
      mana_cost: "{3}{U}",
      oracle_text: "Target player draws two cards.\nFlashback—{1}{U}, Pay 3 life."
    }));
    expect(profile.flashbackCost?.raw).toBe("{1}{U}");
    expect(profile.flashbackLifeCost).toBe(3);
    expect(profile.unimplementedText).toEqual([]);
    expect(profile.fullyImplemented).toBe(true);
  });
});

describe("multi-card library searches", () => {
  it("recognises Cultivate's battlefield-and-hand basic-land destinations", () => {
    const profile = cardProfile(card({
      name: "Cultivate",
      type_line: "Sorcery",
      mana_cost: "{2}{G}",
      oracle_text: "Search your library for up to two basic land cards, put one onto the battlefield tapped and the other into your hand, then shuffle."
    }));
    expect(profile.effects[0]).toEqual({
      kind: "search-library-multi",
      types: ["Land"],
      subtypes: ["Basic"],
      destinations: ["battlefield-tapped", "hand"],
      reveal: false
    });
    expect(profile.fullyImplemented).toBe(true);
  });

  it("recognises Armillary Sphere's two-card hand search", () => {
    const profile = cardProfile(card({
      name: "Armillary Sphere",
      type_line: "Artifact",
      oracle_text: "Search your library for up to two basic land cards, reveal those cards, put them into your hand, then shuffle."
    }));
    expect(profile.effects[0]).toMatchObject({ kind: "search-library-multi", destinations: ["hand", "hand"], reveal: true });
    expect(profile.fullyImplemented).toBe(true);
  });

  it("recognises Burnished Hart's two tapped basic-land destinations", () => {
    const profile = cardProfile(card({
      name: "Burnished Hart",
      type_line: "Artifact Creature — Elk",
      mana_cost: "{3}",
      oracle_text: "{3}, Sacrifice Burnished Hart: Search your library for up to two basic land cards, put them onto the battlefield tapped, then shuffle."
    }));
    expect(profile.activatedAbilities[0]).toMatchObject({ sacrificesSelf: true, manaCost: { raw: "{3}" } });
    expect(profile.activatedAbilities[0]?.effect).toMatchObject({ kind: "search-library-multi", destinations: ["battlefield-tapped", "battlefield-tapped"] });
    expect(profile.fullyImplemented).toBe(true);
  });

  it("recognises Armillary Sphere's named self-sacrifice activation", () => {
    const profile = cardProfile(card({
      name: "Armillary Sphere",
      type_line: "Artifact",
      mana_cost: "{2}",
      oracle_text: "{2}, {T}, Sacrifice Armillary Sphere: Search your library for up to two basic land cards, reveal those cards, put them into your hand, then shuffle."
    }));
    expect(profile.activatedAbilities[0]).toMatchObject({ requiresTap: true, sacrificesSelf: true, manaCost: { raw: "{2}" } });
    expect(profile.activatedAbilities[0]?.effect).toMatchObject({ kind: "search-library-multi", destinations: ["hand", "hand"] });
    expect(profile.fullyImplemented).toBe(true);
  });
});

describe("global spell cost reductions", () => {
  it("recognises Arcane Melee as a global instant-and-sorcery reduction", () => {
    const profile = cardProfile(card({
      name: "Arcane Melee",
      type_line: "Enchantment",
      mana_cost: "{2}{U}{U}",
      oracle_text: "Instant and sorcery spells cost {2} less to cast."
    }));
    expect(profile.spellCostReductionGrant).toEqual({
      amount: 2,
      types: ["Instant", "Sorcery"],
      appliesToAllPlayers: true
    });
    expect(profile.unimplementedText).toEqual([]);
    expect(profile.fullyImplemented).toBe(true);
  });
});

describe("self-shuffle replacement", () => {
  it("recognises Blue Sun's Zenith returning itself to its owner's library", () => {
    const profile = cardProfile(card({
      name: "Blue Sun's Zenith",
      type_line: "Instant",
      mana_cost: "{X}{U}{U}{U}",
      oracle_text: "Target player draws X cards. Shuffle Blue Sun's Zenith into its owner's library."
    }));
    expect(profile.effects).toEqual([
      { kind: "draw-target-player", amount: "X" },
      { kind: "shuffle-self-into-library" }
    ]);
    expect(profile.fullyImplemented).toBe(true);
  });
});

describe("threshold return", () => {
  it("keeps Stitch Together's threshold as a reusable numeric operand", () => {
    const profile = cardProfile(card({
      name: "Stitch Together", type_line: "Sorcery", mana_cost: "{1}{B}", cmc: 2,
      oracle_text: "Return target creature card from your graveyard to your hand. Threshold — Return that card from your graveyard to the battlefield instead if there are seven or more cards in your graveyard."
    }));
    expect(profile).toMatchObject({
      targetKind: "creature-card-in-your-graveyard",
      effects: [{ kind: "return-target-creature-card-from-graveyard-threshold", threshold: 7 }],
      fullyImplemented: true
    });
  });
});

describe("scry", () => {
  it("recognises the reusable Scry 1 effect", () => {
    const profile = cardProfile(card({
      name: "New Benalia",
      type_line: "Land",
      oracle_text: "New Benalia enters the battlefield tapped.\nWhen New Benalia enters the battlefield, scry 1.\n{T}: Add {W}."
    }));
    expect(profile.triggers[0]).toMatchObject({ event: "enters-battlefield", effect: { kind: "scry", amount: 1 } });
    expect(profile.fullyImplemented).toBe(true);
  });

  it("maps every numeric Scry amount to the same reusable primitive", () => {
    for (const amount of [1, 2, 3, 7]) {
      const profile = cardProfile(card({
        name: `Test Scry ${amount}`,
        type_line: "Sorcery",
        oracle_text: `Scry ${amount}.`
      }));
      expect(profile.effects).toEqual([{ kind: "scry", amount }]);
      expect(profile.fullyImplemented).toBe(true);
    }
  });
});

describe("look-top selection", () => {
  it("parameterizes Augur's top-three instant/sorcery selection", () => {
    const profile = cardProfile(card({
      name: "Augur of Bolas",
      type_line: "Creature — Merfolk Wizard",
      oracle_text: "When Augur of Bolas enters the battlefield, look at the top three cards of your library. You may reveal an instant or sorcery card from among them and put it into your hand. Put the rest on the bottom of your library in any order."
    }));
    expect(profile.triggers[0]).toMatchObject({
      event: "enters-battlefield",
      effect: { kind: "look-top-select", amount: 3, types: ["Instant", "Sorcery"], destination: "hand" }
    });
    expect(profile.fullyImplemented).toBe(true);
  });
});

describe("Act of Authority", () => {
  it("reuses typed exile and transfers its source to the target controller", () => {
    const profile = cardProfile(card({
      name: "Act of Authority",
      type_line: "Enchantment",
      oracle_text: "When this enchantment enters, you may exile target artifact or enchantment.\nAt the beginning of your upkeep, you may exile target artifact or enchantment. If you do, its controller gains control of this enchantment."
    }));
    expect(profile.triggers).toMatchObject([
      { event: "enters-battlefield", optional: true, targetKind: "artifact-or-enchantment", effect: { kind: "exile-target-permanent" } },
      { event: "upkeep", optional: true, targetKind: "artifact-or-enchantment", effect: { kind: "exile-target-permanent", gainSourceControl: "target-controller" } }
    ]);
    expect(profile.fullyImplemented).toBe(true);
  });
});

describe("delayed draw primitives", () => {
  it("recognises Arcane Denial as one counter plus two parametrized delayed draws", () => {
    const profile = cardProfile(card({
      name: "Arcane Denial",
      type_line: "Instant",
      oracle_text: "Counter target spell. Its controller may draw up to two cards at the beginning of the next turn's upkeep.\nYou draw a card at the beginning of the next turn's upkeep."
    }));
    expect(profile.effects).toEqual([{ kind: "counter-target-spell-with-delayed-draw", targetAmount: 2, casterAmount: 1 }]);
    expect(profile.targetKind).toBe("spell");
    expect(profile.fullyImplemented).toBe(true);
  });
});

describe("Bane of Progress primitives", () => {
  it("recognises the artifact/enchantment sweep and destruction count", () => {
    const profile = cardProfile(card({
      name: "Bane of Progress",
      type_line: "Creature — Elemental",
      oracle_text: "When Bane of Progress enters the battlefield, destroy all artifacts and enchantments, then put a +1/+1 counter on Bane of Progress for each permanent destroyed this way."
    }));
    expect(profile.triggers[0]).toMatchObject({
      event: "enters-battlefield",
      effect: { kind: "destroy-all-artifacts-enchantments-add-counters", counter: "+1/+1" }
    });
    expect(profile.fullyImplemented).toBe(true);
  });

  it("keeps the destruction-count primitive parameterized by counter type", () => {
    const profile = cardProfile(card({
      name: "Counter Sweep",
      type_line: "Creature — Elemental",
      oracle_text: "When this creature enters the battlefield, destroy all artifacts and enchantments, then put a -1/-1 counter on this creature for each permanent destroyed this way."
    }));
    expect(profile.triggers[0]!.effect).toEqual({ kind: "destroy-all-artifacts-enchantments-add-counters", counter: "-1/-1" });
  });
});

describe("triggered self modifications", () => {
  it("recognises Landfall P/T plus keyword as one reusable effect", () => {
    const profile = cardProfile(card({
      name: "Baloth Woodcrasher",
      type_line: "Creature — Beast",
      oracle_text: "Landfall — Whenever a land you control enters, this creature gets +4/+4 and gains trample until end of turn."
    }));
    expect(profile.triggers[0]).toMatchObject({
      event: "enters-battlefield",
      subject: "land-you-control",
      effect: { kind: "modify-triggered-creature-and-grant-keyword", power: 4, toughness: 4, keyword: "trample" }
    });
    expect(profile.fullyImplemented).toBe(true);
  });

  it("recognises a triggered self P/T-only modifier", () => {
    const profile = cardProfile(card({
      name: "Landfall Self Pump",
      type_line: "Creature — Beast",
      oracle_text: "Landfall — Whenever a land you control enters, this creature gets +2/+2 until end of turn."
    }));
    expect(profile.triggers[0]).toMatchObject({
      event: "enters-battlefield",
      effect: { kind: "modify-source-creature", power: 2, toughness: 2 }
    });
    expect(profile.fullyImplemented).toBe(true);
  });
});

describe("untap restrictions", () => {
  it("recognises the static no-untap rule and source untap activation", () => {
    const profile = cardProfile(card({
      name: "Basalt Monolith",
      type_line: "Artifact",
      oracle_text: "This artifact doesn't untap during your untap step.\n{T}: Add {C}{C}{C}.\n{3}: Untap this artifact."
    }));
    expect(profile.doesNotUntapDuringUntap).toBe(true);
    expect(profile.activatedAbilities).toContainEqual(expect.objectContaining({ effect: { kind: "untap-source" } }));
    expect(profile.fullyImplemented).toBe(true);

    const curly = cardProfile(card({
      name: "Curly Basalt",
      type_line: "Artifact",
      oracle_text: "This artifact doesn’t untap during your untap step."
    }));
    expect(curly.doesNotUntapDuringUntap).toBe(true);
    expect(curly.fullyImplemented).toBe(true);
  });
});

describe("C13 primitive reuse", () => {
  it("recognises each card through shared effect templates", () => {
    const arrows = card({ name: "Borrowing 100,000 Arrows", type_line: "Sorcery", oracle_text: "Draw a card for each tapped creature target opponent controls." });
    expect(cardProfile(arrows)).toMatchObject({ targetKind: "opponent", effects: [{ kind: "draw-equal-tapped-creatures" }], fullyImplemented: true });

    const rites = card({ name: "Blood Rites", type_line: "Enchantment", oracle_text: "{1}{R}, Sacrifice a creature: This enchantment deals 2 damage to any target." });
    expect(cardProfile(rites).activatedAbilities).toContainEqual(expect.objectContaining({ sacrificesCreature: "any", targetKind: "any", effect: { kind: "damage-any-target", amount: 2 } }));

    const altar = card({ name: "Carnage Altar", type_line: "Artifact", oracle_text: "{3}, Sacrifice a creature: Draw a card." });
    expect(cardProfile(altar).activatedAbilities).toContainEqual(expect.objectContaining({ sacrificesCreature: "any", effect: { kind: "draw", amount: 1 } }));

    const force = card({ name: "Baleful Force", type_line: "Creature — Elemental", oracle_text: "At the beginning of each upkeep, you draw a card and you lose 1 life." });
    expect(cardProfile(force).triggers).toContainEqual(expect.objectContaining({
      event: "upkeep",
      subject: "each-player",
      effect: expect.objectContaining({ kind: "compound" })
    }));

    const satchel = card({ name: "Druidic Satchel", type_line: "Artifact", oracle_text: "{2}, {T}: Reveal the top card of your library. If it's a creature card, create a 1/1 green Saproling creature token. If it's a land card, put that card onto the battlefield under your control. If it's a noncreature, nonland card, you gain 2 life." });
    expect(cardProfile(satchel)).toMatchObject({ fullyImplemented: true, activatedAbilities: [{ effect: { kind: "reveal-top-card-conditional" } }] });

    for (const name of ["Rupture Spire", "Transguild Promenade"]) {
      const land = card({ name, type_line: "Land", oracle_text: `${name} enters the battlefield tapped.\nWhen ${name} enters the battlefield, sacrifice it unless you pay {1}.\n{T}: Add one mana of any color.` });
      expect(cardProfile(land)).toMatchObject({ fullyImplemented: true, triggers: [{ effect: { kind: "sacrifice-source" }, unlessPayCost: { raw: "{1}" } }] });
    }
  });
});

describe("effect recognition", () => {
  it("keeps creature type when putting a graveyard card on top", () => {
    const profile = cardProfile(card({
      name: "Hua Tuo, Honored Physician",
      type_line: "Legendary Creature — Human",
      mana_cost: "{2}{G}",
      oracle_text: "{T}: Put target creature card from your graveyard on top of your library. Activate only during your turn, before attackers are declared."
    }));
    expect(profile.activatedAbilities[0]).toMatchObject({
      precombatMainOnly: true,
      targetKind: "creature-card-in-your-graveyard",
      effect: { kind: "return-target-card-to-library-top" }
    });
    expect(profile.fullyImplemented).toBe(true);
  });

  it("recognizes a draw spell", () => {
    const profile = cardProfile(card({ name: "Test Draw", type_line: "Sorcery", mana_cost: "{2}{U}", oracle_text: "Draw three cards." }));
    expect(profile.effects).toEqual([{ kind: "draw", amount: 3 }]);
    expect(profile.fullyImplemented).toBe(true);
    expect(profile.targetKind).toBe("none");
  });

  it("uses the partial compositional IR for repeated simple operations", () => {
    expect(cardProfile(card({ name: "IR Draw", type_line: "Sorcery", oracle_text: "You draw a card." })).effects)
      .toEqual([{ kind: "draw", amount: 1 }]);
    expect(cardProfile(card({ name: "IR Target Draw", type_line: "Sorcery", oracle_text: "Target player draws X cards." })).effects)
      .toEqual([{ kind: "draw-target-player", amount: "X" }]);
    expect(cardProfile(card({ name: "IR Life", type_line: "Sorcery", oracle_text: "Each opponent loses two life." })).effects)
      .toEqual([{ kind: "each-opponent-loses-life", amount: 2 }]);
    expect(cardProfile(card({ name: "IR Mill", type_line: "Sorcery", oracle_text: "Each player mills three cards." })).effects)
      .toEqual([{ kind: "mill-each-player", amount: 3 }]);
    expect(cardProfile(card({ name: "IR Discard", type_line: "Sorcery", oracle_text: "Target player discards two cards." })).effects)
      .toEqual([{ kind: "discard-target-player", amount: 2 }]);
    expect(cardProfile(card({ name: "IR Fallback", type_line: "Sorcery", oracle_text: "Draw a card for each creature you control." })).effects)
      .toEqual([{ kind: "draw-equal-controlled-type", type: "Creature" }]);
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

  it("recognises artifact recovery triggers that gain the recovered mana value", () => {
    const profile = cardProfile(card({
      name: "Razor Hippogriff", type_line: "Creature — Hippogriff",
      oracle_text: "When Razor Hippogriff enters the battlefield, you may return target artifact card from your graveyard to your hand. You gain life equal to that card's converted mana cost."
    }));
    expect(profile.triggers[0]).toMatchObject({
      optional: true,
      targetKind: "artifact-card-in-your-graveyard",
      effect: { kind: "return-target-artifact-and-gain-mana-value" }
    });
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

  it("normalizes optional cycle triggers that use 'you may have'", () => {
    const slice = cardProfile(card({
      name: "Slice and Dice", type_line: "Sorcery", oracle_text: "Cycling {2}{R}\nWhen you cycle this card, you may have it deal 1 damage to each creature."
    }));
    expect(slice.triggers[0]).toMatchObject({
      event: "card-cycled", subject: "self", optional: true,
      effect: { kind: "damage-all-creatures", amount: 1 }
    });
    expect(slice.fullyImplemented).toBe(true);

    const dirge = cardProfile(card({
      name: "Dirge of Dread", type_line: "Sorcery", oracle_text: "Cycling {1}{B}\nWhen you cycle this card, you may have target creature gain fear until end of turn."
    }));
    expect(dirge.triggers[0]).toMatchObject({
      event: "card-cycled", subject: "self", optional: true,
      targetKind: "creature", effect: { kind: "grant-target-creature-keyword", keyword: "fear" }
    });
    expect(dirge.fullyImplemented).toBe(true);
  });

  it("reuses the top-card reveal primitive with a mana-value amount", () => {
    const profile = cardProfile(card({
      name: "Augury Adept", type_line: "Creature — Kithkin Wizard", mana_cost: "{1}{W/U}{W/U}", cmc: 3,
      power: "2", toughness: "2",
      oracle_text: "Whenever this creature deals combat damage to a player, reveal the top card of your library and put that card into your hand. You gain life equal to its mana value."
    }));
    expect(profile.triggers[0]).toMatchObject({
      event: "deals-combat-damage-to-player",
      subject: "self",
      effect: { kind: "reveal-top-card-to-hand-and-gain-mana-value" }
    });
    expect(profile.fullyImplemented).toBe(true);
  });

  it("reuses the reveal-until type primitive for Foster", () => {
    const profile = cardProfile(card({
      name: "Foster", type_line: "Enchantment", mana_cost: "{2}{G}", cmc: 3,
      oracle_text: "Whenever a creature you control dies, you may pay {1}. If you do, reveal cards from the top of your library until you reveal a creature card. Put that card into your hand and the rest into your graveyard."
    }));
    expect(profile.triggers[0]).toMatchObject({
      event: "dies",
      subject: "creature-you-control",
      optional: true,
      payCost: { raw: "{1}" },
      effect: { kind: "reveal-until-type-to-hand", type: "Creature", restDestination: "graveyard" }
    });
    expect(profile.fullyImplemented).toBe(true);
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

  it("resolves a board-dependent mana clause dynamically instead of five free colours", () => {
    const profile = cardProfile(card({
      name: "Exotic Orchard", type_line: "Land", produced_mana: ["W", "U", "B", "R", "G"],
      oracle_text: "{T}: Add one mana of any color that a land an opponent controls could produce."
    }));
    // The parser must not read Scryfall's structured produced_mana as a fixed
    // five-color list — the colours it can really make depend on the board at
    // activation time (`manaOptionsFor`/`colorsFromLandsControlledBy` in
    // engine.ts), so the profile carries a marker, not a produces list.
    expect(profile.manaAbilities).toHaveLength(1);
    expect(profile.manaAbilities[0]).toMatchObject({ anyColorFromLandsControlledBy: "opponent", produces: [] });
    expect(profile.fullyImplemented).toBe(true);
  });

  it("consumes variable storage-counter mana already modeled by the mana engine", () => {
    const profile = cardProfile({
      scryfall_id: "c13-storage-profile",
      name: "Molten Slagheap",
      type_line: "Land",
      oracle_text: "{T}: Add {C}.\n{1}, Remove X storage counters from ~: Add X mana in any combination of {B} and/or {R}.",
      produced_mana: ["C", "B", "R"]
    });
    expect(profile.manaAbilities.find((ability) => ability.variableAmountCounter === "storage")).toBeDefined();
    expect(profile.unimplementedText).toEqual([]);
    expect(profile.fullyImplemented).toBe(true);
  });

  it("reuses Storm keyword consumption and targeted attacker sacrifice", () => {
    const profile = cardProfile(card({
      name: "Storm Offering", type_line: "Sorcery", mana_cost: "{3}{B}",
      oracle_text: "Storm\nTarget player sacrifices an attacking creature of their choice."
    }));
    expect(profile.effects).toEqual([{ kind: "target-player-sacrifice-attacking-creature" }]);
    expect(profile.targetKind).toBe("player");
    expect(profile.fullyImplemented).toBe(true);
  });

  it("recognises Graft as entry counters plus a reusable transfer trigger", () => {
    const profile = cardProfile(card({
      name: "Llanowar Reborn", type_line: "Land — Forest", produced_mana: ["G"],
      oracle_text: "Llanowar Reborn enters the battlefield tapped.\n{T}: Add {G}.\nGraft 1"
    }));
    expect(profile.graftAmount).toBe(1);
    expect(profile.entersWithCounters).toEqual([{ kind: "+1/+1", amount: 1 }]);
    expect(profile.triggers).toContainEqual(expect.objectContaining({
      event: "enters-battlefield", subject: "another-creature", optional: true,
      effect: { kind: "move-counter-from-source-to-triggered-creature", counter: "+1/+1" }
    }));
    expect(profile.fullyImplemented).toBe(true);
  });

  it("recognises a death-triggered source untap", () => {
    const profile = cardProfile(card({
      name: "Goblin Sharpshooter", type_line: "Creature — Goblin", mana_cost: "{2}{R}",
      oracle_text: "Whenever a creature dies, untap ~."
    }));
    expect(profile.triggers).toContainEqual(expect.objectContaining({
      event: "dies", subject: "any-creature", effect: { kind: "untap-source" }, targetKind: "none"
    }));
    expect(profile.fullyImplemented).toBe(true);
  });

  it("recognises entering-creature power damage as a targeted trigger", () => {
    const profile = cardProfile(card({
      name: "Warstorm Surge", type_line: "Enchantment", mana_cost: "{5}{R}",
      oracle_text: "Whenever a creature you control enters the battlefield, it deals damage equal to its power to any target."
    }));
    expect(profile.triggers).toContainEqual(expect.objectContaining({
      event: "enters-battlefield", subject: "creature-you-control", targetKind: "any",
      effect: { kind: "damage-triggered-creature-power" }
    }));
    expect(profile.fullyImplemented).toBe(true);
  });

  it("recognises the optional power-threshold entering trigger", () => {
    const profile = cardProfile(card({
      name: "Where Ancients Tread", type_line: "Enchantment", mana_cost: "{4}{R}",
      oracle_text: "Whenever a creature you control with power 5 or greater enters the battlefield, you may have ~ deal 5 damage to any target."
    }));
    expect(profile.triggers).toContainEqual(expect.objectContaining({
      event: "enters-battlefield", subject: "creature-you-control", optional: true,
      targetKind: "any", condition: { kind: "entering-power-at-least", amount: 5 },
      effect: { kind: "damage-any-target", amount: 5 }
    }));
    expect(profile.fullyImplemented).toBe(true);
  });

  it("recognises draw triggers that refer to any player", () => {
    const profile = cardProfile(card({
      name: "Spiteful Visions", type_line: "Enchantment", mana_cost: "{2}{B}{R}",
      oracle_text: "Whenever a player draws a card, Spiteful Visions deals 1 damage to that player."
    }));
    expect(profile.triggers).toContainEqual(expect.objectContaining({
      event: "card-drawn", subject: "each-player", effect: { kind: "damage-event-player", amount: 1 }, targetKind: "none"
    }));
    expect(profile.fullyImplemented).toBe(true);
  });

  it("recognises Myr Battlesphere's variable tap-and-attack trigger", () => {
    const profile = cardProfile(card({
      name: "Myr Battlesphere", type_line: "Artifact Creature — Construct", mana_cost: "{7}",
      oracle_text: "When this creature enters, create four 1/1 colorless Myr artifact creature tokens.\nWhenever this creature attacks, you may tap X untapped Myr you control. If you do, this creature gets +X/+0 until end of turn and deals X damage to the player or planeswalker it's attacking."
    }));
    expect(profile.triggers).toContainEqual(expect.objectContaining({
      event: "attacks", subject: "self", optional: true,
      tapCost: { amount: "any", subtype: "Myr", mode: "any" },
      effect: { kind: "tap-creatures-pump-source-damage-attacker", subtype: "Myr" },
      targetKind: "none"
    }));
    expect(profile.fullyImplemented).toBe(true);
  });

  it("recognises proportional life-gain triggers", () => {
    const profile = cardProfile(card({
      name: "Sanguine Bond", type_line: "Enchantment", mana_cost: "{3}{B}{B}",
      oracle_text: "Whenever you gain life, target opponent loses that much life."
    }));
    expect(profile.triggers).toContainEqual(expect.objectContaining({
      event: "life-gained", subject: "you", targetKind: "opponent",
      effect: { kind: "lose-life-target-event-amount" }
    }));
    expect(profile.fullyImplemented).toBe(true);
  });

  it("keeps creature-only keyword grants limited to creatures", () => {
    const profile = cardProfile(card({
      name: "Aerie Mystics", type_line: "Creature — Bird Wizard", mana_cost: "{3}{G}{U}",
      oracle_text: "Flying\n{1}{G}{U}: Creatures you control gain shroud until end of turn."
    }));
    expect(profile.activatedAbilities[0]).toMatchObject({
      manaCost: { raw: "{1}{G}{U}" }, targetKind: "none",
      effect: { kind: "grant-creatures-you-control-keyword", keyword: "shroud" }
    });
    expect(profile.fullyImplemented).toBe(true);
  });
});
