/**
 * Seeded regression matrix over the authoritative engine.
 *
 * Unlike the Python simulators, every game here is played through the real
 * `legalActions` / `applyAction` surface a human client uses, so a failure is a
 * genuine rules bug rather than a divergence between two models. Each game
 * asserts card conservation, command-zone integrity, life sanity and stack
 * agreement, and the run writes a report the server can serve.
 *
 * Run: npx tsx tools/simulator/run_engine_matrix.ts --games 200 --max-turns 60
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  createGame, playBotGame, projectGame,
  type CardData, type DeckInput, type GameState
} from "../../packages/rules/src/index.js";

interface ImportedDeck { readonly name: string; readonly commanders: readonly string[]; readonly cards: readonly CardData[] }

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

const root = resolve(import.meta.dirname, "../..");
const podPath = resolve(root, argument("pod", "data/decks/cedh-pod.json"));
const outputPath = resolve(root, argument("output", "data/simulations/engine-matrix-last.json"));
const games = Number(argument("games", "200"));
const maxTurns = Number(argument("max-turns", "60"));

const decks = (JSON.parse(readFileSync(podPath, "utf8")) as { decks: ImportedDeck[] }).decks;
if (decks.length < 2) throw new Error(`${podPath} does not contain enough decks.`);

function inputs(seatOffset: number): DeckInput[] {
  // Rotating the seating each game keeps a seat-order bug from hiding behind averages.
  return Array.from({ length: Math.min(4, decks.length) }, (_, seat) => {
    const deck = decks[(seat + seatOffset) % decks.length]!;
    return { id: `seat-${seat}`, name: deck.name, playerName: `P${seat + 1}`, kind: "bot" as const, commanderNames: deck.commanders, cards: deck.cards };
  });
}

/** The invariants a legal Commander game can never break. */
function assertInvariants(state: GameState, seed: number): void {
  for (const player of state.players) {
    const owned = player.library.length + player.hand.length + player.battlefield.length
      + player.graveyard.length + player.exile.length + player.commandZone.length
      + state.stack.filter((object) => object.card.owner === player.seat).length;
    if (owned !== 100) throw new Error(`seed ${seed}: ${player.name} owns ${owned} card objects, expected 100`);
    if (!Number.isInteger(player.life)) throw new Error(`seed ${seed}: ${player.name} has a non-integer life total`);
    const commanders = player.battlefield.filter((permanent) => permanent.isCommander).length + player.commandZone.length;
    if (commanders < 1) throw new Error(`seed ${seed}: ${player.name} lost track of its commander`);
  }
  if (state.stack.length && !state.priorityOpen) throw new Error(`seed ${seed}: objects on the stack with priority closed`);
  // Compare identifiers as whole JSON values: `seat-1#4` is a substring of
  // `seat-1#42`, so a plain `includes` would report a leak that never happened.
  const projection = projectGame(state, 0);
  const exposed = new Set<string>();
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) { for (const entry of value) collect(entry); return; }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (typeof record.instance_id === "string") exposed.add(record.instance_id);
    for (const entry of Object.values(record)) collect(entry);
  };
  collect(projection);
  for (let seat = 1; seat < state.players.length; seat += 1) {
    for (const card of [...state.players[seat]!.hand, ...state.players[seat]!.library]) {
      if (exposed.has(card.instance_id)) throw new Error(`seed ${seed}: seat 0's projection exposed ${card.instance_id} from seat ${seat}`);
    }
  }
}

const started = Date.now();
let finished = 0;
let unfinished = 0;
let totalTurns = 0;
let totalDecisions = 0;
const winners = new Map<number, number>();
const lossReasons = new Map<string, number>();
const failures: string[] = [];

for (let seed = 1; seed <= games; seed += 1) {
  try {
    const result = playBotGame(createGame(inputs(seed % decks.length), { seed }), maxTurns);
    assertInvariants(result.state, seed);
    totalTurns += result.turns;
    totalDecisions += result.decisions.length;
    if (result.finished) {
      finished += 1;
      if (result.winnerSeat !== null) winners.set(result.winnerSeat, (winners.get(result.winnerSeat) ?? 0) + 1);
      for (const player of result.state.players) {
        if (player.lossReason) lossReasons.set(player.lossReason, (lossReasons.get(player.lossReason) ?? 0) + 1);
      }
    } else unfinished += 1;
  } catch (error) {
    failures.push(`${error instanceof Error ? error.message : String(error)}`);
  }
  if (seed % 50 === 0) process.stderr.write(`  ${seed}/${games} games\n`);
}

const elapsed = (Date.now() - started) / 1000;
const report = {
  status: failures.length ? "failed" : "passed",
  generated_at: new Date().toISOString(),
  engine: "packages/rules authoritative engine",
  scope: "Turn structure, priority, mana, casting, combat and state-based actions. Card text outside the implemented templates is not executed.",
  configuration: { games, max_turns: maxTurns, pod: podPath, seats: Math.min(4, decks.length) },
  summary: {
    completed_games: games - failures.length,
    finished_games: finished,
    unfinished_games: unfinished,
    average_turns: Number((totalTurns / Math.max(1, games - failures.length)).toFixed(2)),
    average_decisions: Number((totalDecisions / Math.max(1, games - failures.length)).toFixed(1)),
    seconds: Number(elapsed.toFixed(3))
  },
  // Seat win counts detect a seating bias; they are not a statement about deck strength.
  wins_by_seat: Object.fromEntries([...winners.entries()].sort()),
  loss_reasons: Object.fromEntries([...lossReasons.entries()].sort()),
  failures
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");

if (failures.length) {
  console.error(`Engine matrix FAILED: ${failures.length}/${games} games broke an invariant`);
  for (const failure of failures.slice(0, 10)) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`Engine matrix passed: ${games} games in ${elapsed.toFixed(2)}s (finished ${finished}, unfinished ${unfinished}, avg ${report.summary.average_turns} turns) -> ${outputPath}`);
