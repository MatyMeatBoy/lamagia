/**
 * In-memory match registry.
 *
 * It is still a single-process store with no persistence, but it fixes the two
 * things that made the previous demo unusable: a seat is bound to a secret token
 * instead of being supplied by the caller, and the bot seats are actually driven
 * by the engine between human decisions.
 */

import { randomUUID } from "node:crypto";
import {
  applyAction, createGame, pendingSeat, projectGame, runBots, settle,
  type CardData, type DeckInput, type GameAction, type GameState, type GameView, type SeatId
} from "@prossh/rules";

export interface ImportedDeck {
  readonly id: string;
  readonly name: string;
  readonly commanders: readonly string[];
  readonly cards: readonly CardData[];
}

export interface MatchRecord {
  readonly id: string;
  state: GameState;
  /** Secret token per seat; only seat 0 is handed out today. */
  readonly seatTokens: Map<string, SeatId>;
  readonly humanSeats: Set<SeatId>;
  readonly createdAt: number;
  lastActivityAt: number;
  readonly source: string;
  readonly deckNames: readonly string[];
}

export interface CreatedMatch {
  readonly matchId: string;
  readonly seat: SeatId;
  readonly token: string;
  readonly view: GameView;
}

const MATCH_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_MATCHES = 64;
const DEFAULT_NAMES = ["Tú", "Luna", "Mauro", "Nox", "Iris", "Vega", "Rook", "Sable"];

const matches = new Map<string, MatchRecord>();

function evictStaleMatches(): void {
  const cutoff = Date.now() - MATCH_TTL_MS;
  for (const [id, match] of matches) if (match.lastActivityAt < cutoff) matches.delete(id);
  if (matches.size <= MAX_MATCHES) return;
  const ordered = [...matches.entries()].sort((left, right) => left[1].lastActivityAt - right[1].lastActivityAt);
  for (const [id] of ordered.slice(0, matches.size - MAX_MATCHES)) matches.delete(id);
}

export function toDeckInputs(decks: readonly ImportedDeck[], humanSeats: ReadonlySet<SeatId>): DeckInput[] {
  return decks.map((deck, seat) => {
    if (!deck.commanders.length) throw new Error(`${deck.name} no declara comandante.`);
    return {
      id: `seat-${seat}`,
      name: deck.name,
      playerName: DEFAULT_NAMES[seat] ?? `Asiento ${seat + 1}`,
      kind: humanSeats.has(seat) ? "human" : "bot",
      commanderNames: deck.commanders,
      cards: deck.cards
    } satisfies DeckInput;
  });
}

/** Advances every bot seat until a human owes the next decision. */
function driveBots(match: MatchRecord): void {
  const result = runBots(match.state, (seat) => !match.humanSeats.has(seat));
  match.state = result.state;
  match.lastActivityAt = Date.now();
}

export function createMatch(decks: readonly ImportedDeck[], options: { seed?: number; source: string; humanSeats?: readonly SeatId[] }): CreatedMatch {
  evictStaleMatches();
  const humanSeats = new Set<SeatId>(options.humanSeats ?? [0]);
  const state = createGame(toDeckInputs(decks, humanSeats), { seed: options.seed ?? Date.now() & 0x7fffffff });
  const id = randomUUID();
  const token = randomUUID();
  const record: MatchRecord = {
    id,
    state,
    seatTokens: new Map([[token, 0]]),
    humanSeats,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    source: options.source,
    deckNames: decks.map((deck) => deck.name)
  };
  matches.set(id, record);
  driveBots(record);
  return { matchId: id, seat: 0, token, view: projectGame(record.state, 0) };
}

export function getMatch(matchId: string): MatchRecord {
  const match = matches.get(matchId);
  if (!match) throw new Error("Esa partida no existe o ya expiró.");
  return match;
}

/** Resolves the seat a token controls; an unknown token gets no seat at all. */
export function seatForToken(match: MatchRecord, token: string | undefined): SeatId {
  const seat = token ? match.seatTokens.get(token) : undefined;
  if (seat === undefined) throw new Error("Token de asiento inválido para esta partida.");
  return seat;
}

export function viewMatch(matchId: string, token: string | undefined): GameView {
  const match = getMatch(matchId);
  const seat = seatForToken(match, token);
  return projectGame(match.state, seat);
}

export function actInMatch(matchId: string, token: string | undefined, action: GameAction): GameView {
  const match = getMatch(matchId);
  const seat = seatForToken(match, token);
  if (match.state.finished) throw new Error("La partida ya terminó.");
  const owed = pendingSeat(match.state);
  if (owed !== seat) throw new Error("Todavía no es tu turno de decidir.");
  match.state = applyAction(match.state, seat, action);
  driveBots(match);
  return projectGame(match.state, seat);
}

export function setAutoPass(matchId: string, token: string | undefined, autoPass: boolean): GameView {
  const match = getMatch(matchId);
  const seat = seatForToken(match, token);
  match.state = {
    ...match.state,
    players: match.state.players.map((player) => (player.seat === seat ? { ...player, autoPass } : player))
  };
  // Enabling auto-pass must immediately consume empty priority windows. Without
  // this settle call, a new match stays visibly parked in upkeep until a click.
  match.state = settle(match.state);
  driveBots(match);
  return projectGame(match.state, seat);
}

export function matchSummary(match: MatchRecord) {
  return {
    matchId: match.id,
    source: match.source,
    decks: match.deckNames,
    turn: match.state.turn,
    step: match.state.step,
    finished: match.state.finished,
    winnerSeat: match.state.winnerSeat,
    createdAt: new Date(match.createdAt).toISOString()
  };
}

export function listMatches() {
  evictStaleMatches();
  return [...matches.values()].map(matchSummary);
}
