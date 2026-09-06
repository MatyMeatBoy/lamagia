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
  applyAction, createGame, pendingSeat, projectGame, runBots, settle, stabilizationDiagnostic,
  type CardData, type DeckInput, type GameAction, type GameState, type GameView, type SeatId
} from "@prossh/rules";
import { isSafeManaUndo } from "@prossh/rules";
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
  /** Consecutive manual mana activations whose settled deltas are reversible. */
  undoHistory: readonly { before: GameState; after: GameState; seat: SeatId }[];
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
const catalogPath = process.env.CATALOG_DB_PATH ?? fileURLToPath(new URL("../../../data/catalog/prossh.sqlite", import.meta.url));
const tokenArtCache = new Map<string, { image_normal?: string; image_art_crop?: string }>();

function enrichTokenArt(view: GameView): GameView {
  if (!existsSync(catalogPath)) return view;
  const database = new DatabaseSync(catalogPath, { readOnly: true });
  try {
    const tokenArt = (card: GameView["players"][number]["battlefield"][number]) => {
      if (!card.isToken || card.image_normal) return card;
      const sourceSet = card.tokenSourceSetCode?.toLowerCase();
      const cacheKey = `${card.name.toLowerCase()}|${sourceSet ?? ""}`;
      const cached = tokenArtCache.get(cacheKey);
      if (cached) return { ...card, ...(cached.image_normal ? { image_normal: cached.image_normal } : {}), ...(cached.image_art_crop ? { image_art_crop: cached.image_art_crop } : {}) };
      const query = database.prepare(`SELECT image_normal, image_art_crop FROM cards
        WHERE (layout IN ('token','double_faced_token') OR set_type = 'token')
          AND LOWER(name) = LOWER(?) AND LOWER(type_line) LIKE '%token%'
        ORDER BY CASE WHEN LOWER(set_code) = ? THEN 0 ELSE 1 END,
                 CASE WHEN set_type IN ('core','expansion') AND COALESCE(promo,0)=0 AND COALESCE(variation,0)=0 THEN 0 ELSE 1 END,
                 released_at DESC, set_code ASC LIMIT 1`);
      const image = query.get(card.name, sourceSet ?? "") as { image_normal?: string; image_art_crop?: string } | undefined;
      if (image?.image_normal) tokenArtCache.set(cacheKey, image);
      return image?.image_normal ? { ...card, image_normal: image.image_normal, ...(image.image_art_crop ? { image_art_crop: image.image_art_crop } : {}) } : card;
    };
    return { ...view, players: view.players.map((player) => ({ ...player, battlefield: player.battlefield.map(tokenArt) })) };
  } finally { database.close(); }
}

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
  const waiting = pendingSeat(result.state);
  if (waiting !== null && !match.humanSeats.has(waiting)) {
    // Never leave the UI silently waiting on a bot. This turns an unsupported
    // bot choice or a budget exhaustion into an actionable server log with a
    // bounded public-state snapshot (and the route already records it).
    throw new Error(`El bot no pudo estabilizar la partida. ${stabilizationDiagnostic(result.state)}`);
  }
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
    deckNames: decks.map((deck) => deck.name),
    undoHistory: []
  };
  matches.set(id, record);
  driveBots(record);
  return { matchId: id, seat: 0, token, view: enrichTokenArt({ ...projectGame(record.state, 0), undoAvailable: false }) };
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
  return enrichTokenArt({ ...projectGame(match.state, seat), undoAvailable: canUndo(match, seat) });
}

function canUndo(match: MatchRecord, seat: SeatId): boolean {
  const entry = match.undoHistory.at(-1);
  if (entry?.seat !== seat) return false;
  const { version: _currentVersion, ...current } = match.state;
  const { version: _recordedVersion, ...recorded } = entry.after;
  return JSON.stringify(current) === JSON.stringify(recorded);
}

export function actInMatch(matchId: string, token: string | undefined, action: GameAction): GameView {
  const match = getMatch(matchId);
  const seat = seatForToken(match, token);
  if (match.state.finished) throw new Error("La partida ya terminó.");
  const owed = pendingSeat(match.state);
  if (owed !== seat) throw new Error("Todavía no es tu turno de decidir.");
  const before = match.state;
  const next = applyAction(before, seat, action);
  if (isSafeManaUndo(before, next, seat, action)) {
    match.undoHistory = [...match.undoHistory, { before, after: next, seat }].slice(-8);
  } else {
    match.undoHistory = [];
  }
  match.state = next;
  driveBots(match);
  return enrichTokenArt({ ...projectGame(match.state, seat), undoAvailable: canUndo(match, seat) });
}

export function setAutoPass(matchId: string, token: string | undefined, autoPass: boolean): GameView {
  const match = getMatch(matchId);
  const seat = seatForToken(match, token);
  match.undoHistory = [];
  match.state = {
    ...match.state,
    version: match.state.version + 1,
    players: match.state.players.map((player) => (player.seat === seat ? { ...player, autoPass } : player))
  };
  // Enabling auto-pass must immediately consume empty priority windows. Without
  // this settle call, a new match stays visibly parked in upkeep until a click.
  match.state = settle(match.state);
  driveBots(match);
  return { ...projectGame(match.state, seat), undoAvailable: false };
}

/** Undo only the latest safe mana activation for the authenticated seat. */
export function undoInMatch(matchId: string, token: string | undefined, version: number): GameView {
  const match = getMatch(matchId);
  const seat = seatForToken(match, token);
  const entry = match.undoHistory.at(-1);
  if (!entry || !canUndo(match, seat) || match.state.version !== version) throw new Error("Esta acción ya no se puede deshacer.");
  const restored = { ...entry.before, version: match.state.version + 1 };
  match.state = restored;
  match.undoHistory = match.undoHistory.slice(0, -1);
  match.lastActivityAt = Date.now();
  return { ...projectGame(match.state, seat), undoAvailable: canUndo(match, seat) };
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

/** Compact server-side evidence for an engine failure; never sent to clients. */
export function gameplayDebugSnapshot(match: MatchRecord) {
  const state = match.state;
  const combat = state.combat as GameState["combat"] & { readonly blockersDeclaredBy?: readonly SeatId[] };
  return {
    matchId: match.id,
    version: state.version,
    turn: state.turn,
    step: state.step,
    activeSeat: state.activeSeat,
    prioritySeat: state.prioritySeat,
    priorityOpen: state.priorityOpen,
    pendingChoice: state.pendingChoice?.type ?? null,
    pendingSource: state.pendingChoice && "sourceCard" in state.pendingChoice
      ? state.pendingChoice.sourceCard.name
      : null,
    passedSeats: state.passedSeats,
    stack: state.stack.map((object) => ({
      id: object.id,
      name: object.card.name,
      kind: object.trigger ? "trigger" : object.activated ? "activated" : "spell",
      controller: object.controller,
      label: object.label,
      countered: object.countered,
      targets: object.targets.map((target) => target.kind === "player"
        ? state.players[target.seat]?.name ?? `seat-${target.seat}`
        : target.kind === "permanent"
          ? state.players.flatMap((player) => player.battlefield).find((permanent) => permanent.instance_id === target.instanceId)?.card.name ?? target.instanceId
          : target.kind === "graveyard-card"
            ? state.players[target.seat]?.graveyard.find((card) => card.instance_id === target.instanceId)?.name ?? target.instanceId
            : state.stack.find((entry) => entry.id === target.stackId)?.card.name ?? target.stackId)
    })),
    combat: {
      attackers: combat.attackers,
      blockers: combat.blockers,
      blockersDeclared: combat.blockersDeclared,
      blockersDeclaredBy: combat.blockersDeclaredBy ?? []
    },
    recentLog: state.log.slice(-20)
  };
}

export function listMatches() {
  evictStaleMatches();
  return [...matches.values()].map(matchSummary);
}
