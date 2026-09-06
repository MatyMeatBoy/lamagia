import { describe, expect, it } from "vitest";
import { legalActions, type CardData } from "@prossh/rules";
import { actInMatch, createMatch, getMatch, setAutoPass, undoInMatch, viewMatch } from "./matches.js";

function fixture() {
  const land: CardData = { scryfall_id: "test-island", name: "Island", type_line: "Basic Land — Island", mana_cost: "", produced_mana: ["U"] };
  const commander: CardData = { scryfall_id: "test-commander", name: "Captain", type_line: "Legendary Creature", mana_cost: "{9}", power: "2", toughness: "2" };
  const deck = { id: "test", name: "test", commanders: ["Captain"], cards: [commander, ...Array.from({ length: 99 }, () => land)] };
  const created = createMatch([deck, deck], { source: "test", seed: 7, humanSeats: [0, 1] });
  const match = getMatch(created.matchId);
  match.seatTokens.set("other", 1);
  match.state = { ...match.state, step: "precombat-main", priorityOpen: true, prioritySeat: 0, activeSeat: 0,
    players: match.state.players.map(p => ({ ...p, autoPass: false, battlefield: [0, 1].map(i => ({ instance_id: `land-${p.seat}-${i}`, card: { ...land, instance_id: `land-${p.seat}-${i}`, owner: p.seat }, controller: p.seat, tapped: false, summoningSick: false, enteredThisTurn: false, damage: 0, deathtouched: false, counters: {}, powerModifier: 0, toughnessModifier: 0, isCommander: false })) })) };
  return created;
}
function tap(id: string, token: string) {
  const action = legalActions(getMatch(id).state, 0).find(a => a.action.type === "activate-mana")!.action;
  return actInMatch(id, token, action);
}
describe("authoritative mana undo", () => {
  it("reverses consecutive taps with monotonic versions, private ownership and stale rejection", () => {
    const { matchId: id, token } = fixture();
    const first = tap(id, token);
    const second = tap(id, token);
    expect(second.undoAvailable).toBe(true);
    expect(viewMatch(id, "other").undoAvailable).toBe(false);
    expect(() => undoInMatch(id, "other", second.version)).toThrow();
    expect(() => undoInMatch(id, "invalid", second.version)).toThrow();
    expect(() => undoInMatch(id, token, first.version)).toThrow();
    const undone = undoInMatch(id, token, second.version);
    expect(undone.version).toBeGreaterThan(second.version);
    expect(undone.undoAvailable).toBe(true);
    const final = undoInMatch(id, token, undone.version);
    expect(final.undoAvailable).toBe(false);
    expect(getMatch(id).state.players[0]!.battlefield.every(p => !p.tapped)).toBe(true);
    expect(JSON.stringify(final)).not.toContain('"undoHistory"');
    expect(() => undoInMatch(id, token, final.version)).toThrow();
  });
  it("invalidates on passing, settings and unexpected information changes", () => {
    for (const barrier of ["pass", "settings", "reveal"]) {
      const { matchId: id, token } = fixture();
      const view = tap(id, token);
      if (barrier === "pass") actInMatch(id, token, { type: "pass" });
      if (barrier === "settings") expect(setAutoPass(id, token, false).version).toBeGreaterThan(view.version);
      if (barrier === "reveal") getMatch(id).state = { ...getMatch(id).state, rngState: 123 };
      expect(viewMatch(id, token).undoAvailable).toBe(false);
      expect(() => undoInMatch(id, token, getMatch(id).state.version)).toThrow();
    }
  });
});

describe("token projection", () => {
  it("keeps generated token metadata in every public projection path", () => {
    const { matchId: id, token } = fixture();
    const match = getMatch(id);
    const tokenCard: CardData & { instance_id: string; owner: 0; token: true; token_source_set_code: string } = {
      scryfall_id: "token:test",
      instance_id: "token:test",
      owner: 0,
      token: true,
      token_source_set_code: "tst",
      name: "Soldier",
      type_line: "Token Creature — Soldier",
      mana_cost: "",
      oracle_text: "Vigilance",
      power: "1",
      toughness: "1"
    };
    match.state = {
      ...match.state,
      players: match.state.players.map((player) => player.seat === 0
        ? { ...player, battlefield: [{ instance_id: tokenCard.instance_id, card: tokenCard, controller: 0, tapped: false, summoningSick: false, enteredThisTurn: false, damage: 0, deathtouched: false, counters: {}, powerModifier: 0, toughnessModifier: 0, isCommander: false }] }
        : player)
    };
    expect(viewMatch(id, token).players[0]!.battlefield[0]!.tokenSourceSetCode).toBe("tst");
    expect(setAutoPass(id, token, false).players[0]!.battlefield[0]!.tokenSourceSetCode).toBe("tst");
    expect(() => undoInMatch(id, token, match.state.version)).toThrow();
  });
});
