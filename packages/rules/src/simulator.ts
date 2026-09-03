/** Deterministic pod simulator for regression testing, not a replacement for Magic rules. */
export type SimulationRole = "land" | "threat" | "engine" | "interaction" | "wincon";

export interface SimulationCard {
  readonly id: string;
  readonly name: string;
  readonly role: SimulationRole;
  readonly manaValue: number;
  readonly power?: number;
}

export interface SimulationDeck { readonly name: string; readonly cards: readonly SimulationCard[]; }
export interface SimulationPlayer { readonly id: string; readonly deck: SimulationDeck; }
export interface SimulationSnapshot { readonly turn: number; readonly activePlayer: string; readonly life: Readonly<Record<string, number>>; readonly zones: Readonly<Record<string, { library: number; hand: number; battlefield: number; graveyard: number }>>; }
export interface SimulationResult { readonly seed: number; readonly winnerId: string | null; readonly turns: number; readonly events: readonly string[]; readonly final: SimulationSnapshot; }

interface MutablePlayer { id: string; deck: SimulationDeck; life: number; library: SimulationCard[]; hand: SimulationCard[]; battlefield: SimulationCard[]; graveyard: SimulationCard[]; landsPlayed: number; }

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 0x1_0000_0000; };
}

function shuffled<T>(items: readonly T[], next: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) { const swap = Math.floor(next() * (index + 1)); [result[index], result[swap]] = [result[swap]!, result[index]!]; }
  return result;
}

function draw(player: MutablePlayer): SimulationCard | null { const card = player.library.pop(); if (card) player.hand.push(card); return card ?? null; }
function mana(player: MutablePlayer): number { return player.battlefield.filter((card) => card.role === "land").length; }
function zoneTotal(player: MutablePlayer): number { return player.library.length + player.hand.length + player.battlefield.length + player.graveyard.length; }

export function assertSimulationInvariants(players: readonly MutablePlayer[]): void {
  for (const player of players) {
    if (zoneTotal(player) !== player.deck.cards.length) throw new Error(`Card conservation failed for ${player.id}.`);
    if (!Number.isInteger(player.life)) throw new Error(`Life must remain an integer for ${player.id}.`);
    if (player.landsPlayed < 0) throw new Error(`Negative lands played for ${player.id}.`);
  }
}

function snapshot(players: readonly MutablePlayer[], turn: number, activePlayer: string): SimulationSnapshot {
  return { turn, activePlayer, life: Object.fromEntries(players.map((player) => [player.id, player.life])), zones: Object.fromEntries(players.map((player) => [player.id, { library: player.library.length, hand: player.hand.length, battlefield: player.battlefield.length, graveyard: player.graveyard.length }])) };
}

/** Runs a compact, deterministic pressure test for deck zones and turn sequencing. */
export function simulatePod(players: readonly SimulationPlayer[], seed = 1, maxTurns = 40): SimulationResult {
  if (players.length < 2 || players.length > 8) throw new Error("Simulation pods must contain 2–8 players.");
  if (new Set(players.map((player) => player.id)).size !== players.length) throw new Error("Simulation player IDs must be unique.");
  for (const player of players) if (player.deck.cards.length !== 100) throw new Error(`${player.deck.name} must contain exactly 100 cards.`);
  const next = random(seed);
  const state: MutablePlayer[] = players.map((player) => ({ ...player, life: 40, library: shuffled(player.deck.cards, next), hand: [], battlefield: [], graveyard: [], landsPlayed: 0 }));
  for (const player of state) for (let drawIndex = 0; drawIndex < 7; drawIndex += 1) draw(player);
  const events: string[] = [];
  let active = 0;
  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const player = state[active]!;
    player.landsPlayed = 0;
    if (turn > 1 && !draw(player)) { player.life = 0; events.push(`${player.id} drew from an empty library`); }
    const land = player.hand.find((card) => card.role === "land");
    if (land) { player.hand.splice(player.hand.indexOf(land), 1); player.battlefield.push(land); player.landsPlayed = 1; events.push(`${player.id} played ${land.name}`); }
    const castable = player.hand.filter((card) => card.role !== "land" && card.manaValue <= mana(player)).sort((left, right) => right.manaValue - left.manaValue)[0];
    if (castable) { player.hand.splice(player.hand.indexOf(castable), 1); player.battlefield.push(castable); events.push(`${player.id} cast ${castable.name}`); }
    const attackers = player.battlefield.filter((card) => card.role === "threat" || card.role === "wincon");
    const damage = attackers.reduce((total, card) => total + (card.power ?? 1), 0);
    const target = state.filter((candidate) => candidate.id !== player.id && candidate.life > 0).sort((left, right) => left.life - right.life)[0];
    if (target && damage > 0) { target.life -= damage; events.push(`${player.id} attacked ${target.id} for ${damage}`); }
    assertSimulationInvariants(state);
    const survivors = state.filter((candidate) => candidate.life > 0);
    if (survivors.length <= 1) return { seed, winnerId: survivors[0]?.id ?? null, turns: turn, events, final: snapshot(state, turn, player.id) };
    active = (active + 1) % state.length;
  }
  return { seed, winnerId: null, turns: maxTurns, events, final: snapshot(state, maxTurns, state[(active + state.length - 1) % state.length]!.id) };
}

export function createRegressionDeck(name: string): SimulationDeck {
  const cards: SimulationCard[] = [
    ...Array.from({ length: 38 }, (_, index) => ({ id: `${name}-land-${index}`, name: "Basic land", role: "land" as const, manaValue: 0 })),
    ...Array.from({ length: 34 }, (_, index) => ({ id: `${name}-threat-${index}`, name: "Test creature", role: "threat" as const, manaValue: 2 + (index % 4), power: 1 + (index % 5) })),
    ...Array.from({ length: 20 }, (_, index) => ({ id: `${name}-engine-${index}`, name: "Test engine", role: "engine" as const, manaValue: 1 + (index % 4) })),
    ...Array.from({ length: 8 }, (_, index) => ({ id: `${name}-wincon-${index}`, name: "Test win condition", role: "wincon" as const, manaValue: 4 + (index % 3), power: 6 }))
  ];
  return { name, cards };
}
