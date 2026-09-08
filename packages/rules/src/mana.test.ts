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

  it("reads hybrid Phyrexian symbols and keeps both color options", () => {
    expect(cost("{G/U/P}").symbols[0]).toEqual({ kind: "hybrid-phyrexian", options: ["G", "U"], life: 2 });
    expect(costColors(cost("{G/U/P}"))).toEqual(["U", "G"]);
    expect(cost("{G/U/P}").manaValue).toBe(1);
  });

  it("parses snow as a dedicated payment marker", () => {
    expect(cost("{S}{1}").symbols[0]).toEqual({ kind: "snow" });
    expect(cost("{S}{1}").manaValue).toBe(2);
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
    expect(canPay(cost("{B/P}"), emptyPool(), { availableLife: 2 })).toBe(true);
    expect(payCost(cost("{B/P}"), emptyPool(), { availableLife: 2 })?.lifePaid).toBe(2);
    expect(payCost(cost("{B/P}"), pool({ B: 1 }), { availableLife: 40 })?.lifePaid).toBe(0);
  });

  it("requires snow-source mana for {S}, while preserving its color for normal costs", () => {
    expect(canPay(cost("{S}"), pool({ G: 1 }))).toBe(false);
    const snow = payCost(cost("{S}"), pool({ G: 1, snow: { G: 1 } }));
    expect(snow?.spent.G).toBe(1);
    expect(snow?.spent.snow?.G).toBe(1);
    expect(snow?.remaining.G).toBe(0);

    const colored = payCost(cost("{G}"), pool({ G: 1, snow: { G: 1 } }));
    expect(colored?.spent.snow?.G).toBe(1);
    expect(canPay(cost("{S}"), pool({ C: 1, snow: { C: 1 } }))).toBe(true);
  });

  it("allows hybrid Phyrexian to use either color or exactly two life", () => {
    expect(canPay(cost("{G/U/P}"), pool({ U: 1 }), { availableLife: 0 })).toBe(true);
    expect(payCost(cost("{G/U/P}"), emptyPool(), { availableLife: 2 })?.lifePaid).toBe(2);
    expect(canPay(cost("{G/U/P}"), emptyPool(), { availableLife: 1 })).toBe(false);
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
