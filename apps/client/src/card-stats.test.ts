import { expect, it } from "vitest";
import { hasCreatureStats } from "./card-stats.js";

it("hides bogus 0/0 on lands, rocks and noncreature catalog cards", () => {
  for (const type_line of ["Basic Land — Forest", "Artifact", "Enchantment"]) {
    expect(hasCreatureStats({ type_line, power: 0, toughness: 0 })).toBe(false);
    expect(hasCreatureStats({ type_line, power: 0, toughness: 0, isCreature: false })).toBe(false);
  }
});

it("uses current server creature status for animated lands and lost creature types", () => {
  expect(hasCreatureStats({ type_line: "Land", isCreature: true, power: 3, toughness: 3 })).toBe(true);
  expect(hasCreatureStats({ type_line: "Artifact Creature", isCreature: false, power: 2, toughness: 2 })).toBe(false);
  expect(hasCreatureStats({ type_line: "Creature", power: 2, toughness: 2 })).toBe(true);
});

it("preserves real 0/0 and star stats while requiring both values", () => {
  expect(hasCreatureStats({ type_line: "Creature — Hydra", power: 0, toughness: 0 })).toBe(true);
  expect(hasCreatureStats({ type_line: "Artifact Creature", power: "*", toughness: "*" })).toBe(true);
  expect(hasCreatureStats({ type_line: "Creature", power: 2, toughness: null })).toBe(false);
});
