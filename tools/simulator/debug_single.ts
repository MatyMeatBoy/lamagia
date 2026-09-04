process.env.DEBUG_COMMANDER = "1";
const { createGame } = await import("../../packages/rules/src/engine.js");
const { playBotGame } = await import("../../packages/rules/src/bot.js");
const { readFileSync } = await import("node:fs");
const { resolve } = await import("node:path");

const root = resolve(import.meta.dirname, "../..");
const podPath = resolve(root, "data/decks/cedh-pod.json");
const decks = JSON.parse(readFileSync(podPath, "utf8")).decks;

function inputs(seatOffset) {
  return Array.from({ length: Math.min(4, decks.length) }, (_, seat) => {
    const deck = decks[(seat + seatOffset) % decks.length];
    return { id: `seat-${seat}`, name: deck.name, playerName: `P${seat + 1}`, kind: "bot", commanderNames: deck.commanders, cards: deck.cards };
  });
}

const seed = Number(process.argv[2] ?? "92");
const result = playBotGame(createGame(inputs(seed % decks.length), { seed }), 60);
console.log("finished:", result.finished, "turns:", result.turns);
for (const p of result.state.players) {
  console.log(p.name, "bf-commanders:", p.battlefield.filter((x) => x.isCommander).length, "cmdZone:", p.commandZone.length, "hand-has-commander:", p.hand.some(c=>p.commanderIds.includes(c.instance_id)), "gy-has-commander:", p.graveyard.some(c=>p.commanderIds.includes(c.instance_id)), "exile-has-commander:", p.exile.some(c=>p.commanderIds.includes(c.instance_id)), "lib-has-commander:", p.library.some(c=>p.commanderIds.includes(c.instance_id)));
}
