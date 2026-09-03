import { describe, expect, it } from "vitest";
import { canPay, costColors, emptyPool, parseManaCost, payCost, poolTotal, type ManaPool } from "./mana.js";

const pool = (values: Partial<ManaPool>): ManaPool => ({ ...emptyPool(), ...values });
const cost = (raw: string) => {
  const parsed = parseManaCost(raw);
  if (!parsed) throw new Error(`Cost ${raw} should parse`);
  return parsed;
};

describe("parseManaCost", () => {
  it("reads generic and colored symbols", () => {
    const parsed = cost("{3}{G}{W}");
    expect(parsed.manaValue).toBe(5);
    expect(parsed.hasVariable).toBe(false);
    expect(costColors(parsed)).toEqual(["W", "G"]);
  });

  it("counts {X} as zero mana value but flags it", () => {
    const parsed = cost("{X}{X}{R}");
    expect(parsed.manaValue).toBe(1);
    expect(parsed.hasVariable).toBe(true);
  });

  it("reads hybrid, monocolored hybrid and Phyrexian symbols", () => {
    expect(cost("{G/W}").symbols[0]).toEqual({ kind: "hybrid", options: ["G", "W"] });
    expect(cost("{2/U}").symbols[0]).toEqual({ kind: "monohybrid", color: "U", generic: 2 });
    expect(cost("{B/P}").symbols[0]).toEqual({ kind: "phyrexian", color: "B", life: 2 });
    expect(cost("{2/U}").manaValue).toBe(2);
  });

  it("treats an empty cost as free and rejects text that is not a cost", () => {
    expect(parseManaCost("")?.manaValue).toBe(0);
    expect(parseManaCost("Land")).toBeNull();
    expect(parseManaCost("{Q}")).toBeNull();
  });
});

describe("payCost", () => {
  it("pays exact colored requirements", () => {
    const result = payCost(cost("{G}{W}"), pool({ G: 1, W: 1 }));
    expect(result?.spent).toEqual(pool({ G: 1, W: 1 }));
    expect(poolTotal(result!.remaining)).toBe(0);
  });

  it("refuses a cost when the required color is missing", () => {
    expect(canPay(cost("{G}{G}"), pool({ G: 1, W: 5 }))).toBe(false);
  });

  it("spends colorless before colored mana for generic", () => {
    const result = payCost(cost("{2}{R}"), pool({ C: 2, R: 1, G: 3 }));
    expect(result?.spent).toEqual(pool({ C: 2, R: 1 }));
    expect(result?.remaining.G).toBe(3);
  });

  it("chooses the payable half of a hybrid symbol", () => {
    expect(canPay(cost("{G/W}{G/W}"), pool({ W: 2 }))).toBe(true);
    expect(canPay(cost("{G/W}"), pool({ U: 1 }))).toBe(false);
  });

  it("pays a monocolored hybrid with its generic half when the color is absent", () => {
    const result = payCost(cost("{2/U}"), pool({ R: 2 }));
    expect(result?.spent.R).toBe(2);
    expect(canPay(cost("{2/U}"), pool({ U: 1 }))).toBe(true);
  });

  it("pays Phyrexian with life only when life allows it", () => {
    const withLife = payCost(cost("{B/P}"), emptyPool(), { availableLife: 40 });
    expect(withLife?.lifePaid).toBe(2);
    expect(canPay(cost("{B/P}"), emptyPool(), { availableLife: 2 })).toBe(false);
    expect(payCost(cost("{B/P}"), pool({ B: 1 }), { availableLife: 40 })?.lifePaid).toBe(0);
  });

  it("charges additional generic such as commander tax", () => {
    expect(canPay(cost("{1}{U}"), pool({ U: 1, C: 1 }), { additionalGeneric: 2 })).toBe(false);
    expect(canPay(cost("{1}{U}"), pool({ U: 1, C: 3 }), { additionalGeneric: 2 })).toBe(true);
  });

  it("resolves a cost whose colors compete for the same sources", () => {
    // {W}{U}{B}{R}{G} needs one of each even though the pool is exactly five mana.
    expect(canPay(cost("{W}{U}{B}{R}{G}"), pool({ W: 1, U: 1, B: 1, R: 1, G: 1 }))).toBe(true);
    expect(canPay(cost("{W}{U}{B}{R}{G}"), pool({ W: 2, U: 1, B: 1, R: 1 }))).toBe(false);
  });

  it("adds the chosen value of {X} to the generic requirement", () => {
    expect(canPay(cost("{X}{R}"), pool({ R: 1, C: 3 }), { variableValue: 3 })).toBe(true);
    expect(canPay(cost("{X}{R}"), pool({ R: 1, C: 2 }), { variableValue: 3 })).toBe(false);
  });
});
