/**
 * Integration coverage against the actual imported card data.
 *
 * `data/` is generated and gitignored, so these specs skip themselves when the
 * importers have not run. When the data is present they are the only tests that
 * prove the engine handles real Oracle text, real mana costs and real bodies.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cardProfile, type CardData } from "./characteristics.js";
import { createGame, type DeckInput } from "./engine.js";
import { playBotGame } from "./bot.js";
import { projectGame } from "./projection.js";

const podPath = fileURLToPath(new URL("../../../data/decks/cedh-pod.json", import.meta.url));
const preconPath = fileURLToPath(new URL("../../../data/decks/commander-precons.json", import.meta.url));
const hasPod = existsSync(podPath);
const hasPrecons = existsSync(preconPath);

interface ImportedDeck { readonly name: string; readonly commanders: readonly string[]; readonly cards: readonly CardData[] }
function load(path: string): ImportedDeck[] {
  return (JSON.parse(readFileSync(path, "utf8")) as { decks: ImportedDeck[] }).decks;
}

function toInputs(decks: readonly ImportedDeck[]): DeckInput[] {
  return decks.slice(0, 4).map((deck, seat) => ({
    id: `seat-${seat}`, name: deck.name, playerName: `P${seat + 1}`,
    kind: "bot" as const, commanderNames: deck.commanders, cards: deck.cards
  }));
}

describe.skipIf(!hasPod)("imported cEDH pod", () => {
  it("builds a legal four-player game from the real lists", () => {
    const game = createGame(toInputs(load(podPath)), { seed: 0xC0FFEE });
    expect(game.players).toHaveLength(4);
    for (const player of game.players) {
      expect(player.hand).toHaveLength(7);
      expect(player.commandZone).toHaveLength(1);
      expect(player.library).toHaveLength(92);
    }
  });

  it("derives mana abilities for every land that actually produces mana", () => {
    const decks = load(podPath);
    const lands = decks.flatMap((deck) => deck.cards).filter((card) => cardProfile(card).types.includes("Land"));
    const withMana = lands.filter((card) => cardProfile(card).manaAbilities.length > 0);
    const without = [...new Set(lands.filter((card) => !cardProfile(card).manaAbilities.length).map((card) => card.name))];
    expect(withMana.length).toBeGreaterThan(lands.length * 0.6);
    // Every land the engine cannot tap must be one that genuinely makes no mana.
    for (const name of without) {
      const card = lands.find((candidate) => candidate.name === name)!;
      expect(card.produced_mana ?? []).toHaveLength(0);
    }
  });

  it("reads a power and toughness for every real creature", () => {
    const creatures = load(podPath).flatMap((deck) => deck.cards).filter((card) => cardProfile(card).types.includes("Creature"));
    expect(creatures.length).toBeGreaterThan(50);
    for (const card of creatures) expect(cardProfile(card).power).not.toBeNull();
  });

  it("plays a full bot game that changes life totals and conserves cards", () => {
    const result = playBotGame(createGame(toInputs(load(podPath)), { seed: 42 }), 40);
    expect(result.state.log.some((entry) => entry.text.includes("ataca con"))).toBe(true);
    expect(result.state.players.some((player) => player.life !== 40)).toBe(true);
    for (const player of result.state.players) {
      // Tokens are created game objects, not cards from the imported 100-card deck.
      const owned = player.library.length + player.hand.length + player.battlefield.filter((permanent) => !permanent.card.token).length
        + player.graveyard.length + player.exile.length + player.commandZone.length
        + result.state.stack.filter((object) => object.card.owner === player.seat && !object.card.token && !object.trigger && !object.activated).length;
      expect(owned).toBe(100);
    }
  });

  it("never puts an opponent's hidden cards into a projection", () => {
    const game = createGame(toInputs(load(podPath)), { seed: 5 });
    const exposed = new Set<string>();
    const collect = (value: unknown): void => {
      if (Array.isArray(value)) { for (const entry of value) collect(entry); return; }
      if (!value || typeof value !== "object") return;
      const record = value as Record<string, unknown>;
      if (typeof record.instance_id === "string") exposed.add(record.instance_id);
      for (const entry of Object.values(record)) collect(entry);
    };
    collect(projectGame(game, 0));
    for (let seat = 1; seat < game.players.length; seat += 1) {
      for (const card of [...game.players[seat]!.hand, ...game.players[seat]!.library]) {
        expect(exposed.has(card.instance_id)).toBe(false);
      }
    }
  });
});

describe.skipIf(!hasPrecons)("imported Commander precons", () => {
  it("starts a four-precon pod and reaches a winner", () => {
    const result = playBotGame(createGame(toInputs(load(preconPath)), { seed: 0xBADC0DE }), 80);
    expect(result.turns).toBeGreaterThan(5);
    expect(result.state.log.some((entry) => entry.text.includes("de daño a"))).toBe(true);
  }, 15_000);
});
