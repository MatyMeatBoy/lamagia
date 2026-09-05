import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CardData } from "@prossh/rules";
import { createMatch, getMatch } from "./matches.js";
import { selectTestedPod } from "./tested-mode.js";

const land: CardData = {
  scryfall_id: "forest-printing",
  oracle_id: "forest-oracle",
  name: "Forest",
  type_line: "Basic Land — Forest",
  color_identity: ["G"],
  produced_mana: ["G"]
};

function importedDeck(index: number) {
  const commander: CardData = {
    scryfall_id: `commander-printing-${index}`,
    oracle_id: `commander-oracle-${index}`,
    name: `Captain ${index}`,
    type_line: "Legendary Creature — Human",
    color_identity: ["G"],
    mana_cost: "{G}"
  };
  return {
    id: `deck-${index}`,
    name: `Deck ${index}`,
    commanders: [commander.name],
    cards: [commander, ...Array.from({ length: 99 }, () => land)]
  };
}

describe("tested-mode server route", () => {
  it("selects four filtered Commander decks and creates the authoritative match", () => {
    const decks = Array.from({ length: 4 }, (_, index) => importedDeck(index));
    const selected = selectTestedPod(
      [{ source: "precons-fixture", decks }, { source: "pod-fixture", decks: [] }],
      new Set(decks.flatMap((deck) => [deck.cards[0]!.oracle_id!, "forest-oracle"])),
      "deck-2"
    );
    expect(selected.decks.map((deck) => deck.id)).toEqual(["deck-2", "deck-0", "deck-1", "deck-3"]);
    expect(selected.decks.every((deck) => deck.cards.length === 100)).toBe(true);
    const created = createMatch(selected.decks, { source: selected.source, seed: 7 });
    const match = getMatch(created.matchId);
    expect(match.state.players).toHaveLength(4);
    expect(JSON.stringify(created.view)).not.toContain("forest-oracle");
  });

  it("exposes public priority state through the match route without hidden zones", async () => {
    const decks = Array.from({ length: 4 }, (_, index) => importedDeck(index));
    const selected = selectTestedPod(
      [{ source: "precons-fixture", decks }, { source: "pod-fixture", decks: [] }],
      new Set(decks.flatMap((deck) => [deck.cards[0]!.oracle_id!, "forest-oracle"])),
      "deck-0"
    );
    const created = createMatch(selected.decks, { source: selected.source, seed: 11, humanSeats: [0, 1, 2, 3] });
    const { app } = await import("./index.js");
    const response = await app.inject({ method: "GET", url: `/api/matches/${created.matchId}?token=${created.token}` });
    expect(response.statusCode).toBe(200);
    const view = response.json() as { viewerSeat: number; prioritySeat: number; passedSeats: number[]; players: Array<{ libraryCount: number; hand?: unknown }> };
    expect(view.prioritySeat).toBeTypeOf("number");
    expect(view.passedSeats).toEqual([]);
    expect(view.players.every((player, seat) => seat === view.viewerSeat || player.hand === undefined)).toBe(true);
    expect(JSON.stringify(view)).not.toContain("forest-oracle");
  });

  // Importing the Fastify/SQLite route can cold-start slower than Vitest's
  // default five-second test budget when this file runs beside matches.test.
  it("exposes a clear HTTP failure when the tested pool has fewer than four suitable decks", async () => {
    const folder = mkdtempSync(join(tmpdir(), "prossh-tested-mode-"));
    const profilePath = join(folder, "profiles.json");
    const preconsPath = join(folder, "precons.json");
    const podPath = join(folder, "pod.json");
    const sourceDeck = importedDeck(0);
    writeFileSync(profilePath, JSON.stringify({ profiles: [{ oracle_id: sourceDeck.cards[0]!.oracle_id, fullyImplemented: true }, { oracle_id: "forest-oracle", fullyImplemented: true }] }));
    writeFileSync(preconsPath, JSON.stringify({ source: "precons-fixture", decks: [sourceDeck] }));
    writeFileSync(podPath, JSON.stringify({ source: "pod-fixture", decks: [] }));

    const previous = { NODE_ENV: process.env.NODE_ENV, ENGINE_PROFILES_PATH: process.env.ENGINE_PROFILES_PATH, PRECONS_PATH: process.env.PRECONS_PATH, ACTIVE_POD_PATH: process.env.ACTIVE_POD_PATH };
    process.env.NODE_ENV = "test";
    process.env.ENGINE_PROFILES_PATH = profilePath;
    process.env.PRECONS_PATH = preconsPath;
    process.env.ACTIVE_POD_PATH = podPath;
    try {
      const { app } = await import("./index.js");
      const response = await app.inject({ method: "POST", url: "/api/matches", payload: { mode: "tested", seed: 7 } });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toMatch(/Tested mode is unavailable/);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(folder, { recursive: true, force: true });
    }
  }, 30000);
});
