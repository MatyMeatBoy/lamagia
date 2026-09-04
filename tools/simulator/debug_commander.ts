import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createGame, type CardData, type GameState } from "../../packages/rules/src/index.js";
import * as engineModule from "../../packages/rules/src/engine.js";
import { playBotGame } from "../../packages/rules/src/bot.js";

interface ImportedDeck { readonly name: string; readonly commanders: readonly string[]; readonly cards: readonly CardData[] }

const root = resolve(import.meta.dirname, "../..");
const podPath = resolve(root, "data/decks/cedh-pod.json");
const decks = (JSON.parse(readFileSync(podPath, "utf8")) as { decks: ImportedDeck[] }).decks;

function inputs(seatOffset: number) {
  return Array.from({ length: Math.min(4, decks.length) }, (_, seat) => {
    const deck = decks[(seat + seatOffset) % decks.length]!;
    return { id: `seat-${seat}`, name: deck.name, playerName: `P${seat + 1}`, kind: "bot" as const, commanderNames: deck.commanders, cards: deck.cards };
  });
}

function commanderCount(state: GameState, seat: number): number {
  const player = state.players[seat]!;
  return player.battlefield.filter((p) => p.isCommander).length + player.commandZone.length;
}

const seed = Number(process.argv[2] ?? "92");
const original = engineModule.applyAction;
const patched = (state: GameState, seat: number, action: any): GameState => {
  const before = state.players.map((_, i) => commanderCount(state, i));
  const next = original(state, seat, action);
  const after = next.players.map((_, i) => commanderCount(next, i));
  for (let i = 0; i < before.length; i += 1) {
    if (after[i]! < before[i]!) {
      console.log(`Commander count dropped for seat ${i}: ${before[i]} -> ${after[i]}`);
      console.log(`  action:`, JSON.stringify(action));
      console.log(`  by seat ${seat}`);
    }
  }
  return next;
};
(engineModule as any).applyAction = patched;

const result = playBotGame(createGame(inputs(seed % decks.length), { seed }), 60);
console.log("finished:", result.finished, "turns:", result.turns);
for (const p of result.state.players) {
  console.log(p.name, "battlefield commanders:", p.battlefield.filter((x) => x.isCommander).length, "commandZone:", p.commandZone.length);
}
