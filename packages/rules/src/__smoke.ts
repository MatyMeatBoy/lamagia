import { readFileSync } from "node:fs";
import { createGame, playBotGame, cardProfile, type DeckInput } from "./index.js";

const pod = JSON.parse(readFileSync("C:/Users/MP/Documents/00 Claude/ProsshTCG/data/decks/cedh-pod.json", "utf8"));
const precons = JSON.parse(readFileSync("C:/Users/MP/Documents/00 Claude/ProsshTCG/data/decks/commander-precons.json", "utf8"));

const missing: string[] = [];
for (const deck of pod.decks) for (const card of deck.cards) {
  const p = cardProfile(card);
  if (p.types.includes("Land") && !p.manaAbilities.length) missing.push(card.name);
}
console.log("lands without a modeled mana ability:", [...new Set(missing)].join(", "));

function toDecks(source: any[], seed: number): DeckInput[] {
  return source.map((deck: any, seat: number) => ({
    id: `seat-${seat}`, name: deck.name, playerName: ["A", "B", "C", "D"][seat]!,
    kind: "bot" as const, commanderNames: deck.commanders, cards: deck.cards
  }));
}

for (const [label, decks] of [["cEDH", pod.decks.slice(0, 4)], ["precon", precons.decks.slice(0, 4)]] as const) {
  let finished = 0, totalTurns = 0, blocks = 0, attacks = 0, elapsed = 0;
  for (let seed = 1; seed <= 20; seed += 1) {
    const started = Date.now();
    const result = playBotGame(createGame(toDecks(decks, seed), { seed }), 80);
    elapsed += Date.now() - started;
    if (result.finished) finished += 1;
    totalTurns += result.turns;
    blocks += result.state.log.filter((entry) => entry.text.includes("bloquea con")).length;
    attacks += result.state.log.filter((entry) => entry.text.includes("ataca con")).length;
  }
  console.log(`${label}: finished ${finished}/20, avg turns ${(totalTurns / 20).toFixed(1)}, attacks ${attacks}, blocks ${blocks}, ${elapsed}ms total`);
}
