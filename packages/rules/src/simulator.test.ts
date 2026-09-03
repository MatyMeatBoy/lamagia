import { describe, expect, it } from "vitest";
import { createRegressionDeck, simulatePod } from "./simulator.js";

const pod = ["prossh", "najeela", "kinnan", "atraxa"].map((id) => ({ id, deck: createRegressionDeck(id) }));

describe("deterministic pod regression simulator", () => {
  it("replays the same game from the same seed", () => {
    expect(simulatePod(pod, 42, 30)).toEqual(simulatePod(pod, 42, 30));
  });

  it("preserves all 100 cards in every player zone", () => {
    const result = simulatePod(pod, 7, 35);
    for (const zones of Object.values(result.final.zones)) expect(zones.library + zones.hand + zones.battlefield + zones.graveyard).toBe(100);
  });

  it("rejects a malformed deck before a simulation starts", () => {
    expect(() => simulatePod([{ id: "bad", deck: { name: "bad", cards: [] } }, pod[1]!])).toThrow("exactly 100 cards");
  });
});
