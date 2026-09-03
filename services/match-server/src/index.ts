import cors from "@fastify/cors";
import Fastify from "fastify";
import { Server } from "socket.io";
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { GameAction } from "@prossh/rules";
import { actInMatch, createMatch, getMatch, listMatches, matchSummary, seatForToken, setAutoPass, viewMatch, type ImportedDeck } from "./matches.js";

const port = Number(process.env.PORT ?? 8787);
const clientOrigin = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";
const contact = process.env.CATALOG_CONTACT ?? "contact@example.com";
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "warn" } });
const searchCache = new Map<string, { expiresAt: number; value: unknown }>();
let lastCatalogRequestAt = 0;
const catalogDbPath = process.env.CATALOG_DB_PATH ?? fileURLToPath(new URL("../../../data/catalog/prossh.sqlite", import.meta.url));
const activePodPath = process.env.ACTIVE_POD_PATH ?? fileURLToPath(new URL("../../../data/decks/cedh-pod.json", import.meta.url));
const preconsPath = process.env.PRECONS_PATH ?? fileURLToPath(new URL("../../../data/decks/commander-precons.json", import.meta.url));
const engineReportPath = process.env.ENGINE_REPORT_PATH ?? fileURLToPath(new URL("../../../data/simulations/engine-matrix-last.json", import.meta.url));

interface ImportedPod { readonly source: string; readonly synced_at: string; readonly decks: readonly ImportedDeck[] }
interface ImportedPrecon extends ImportedDeck { readonly set_code: string; readonly released_at: string; readonly cover_art_uri?: string; readonly cover_art_kind: string }
interface ImportedPrecons { readonly source: string; readonly synced_at: string; readonly decks: readonly ImportedPrecon[] }

let podCache: ImportedPod | null = null;
let preconCache: ImportedPrecons | null = null;

async function readActivePod(): Promise<ImportedPod> {
  if (podCache) return podCache;
  if (!existsSync(activePodPath)) throw new Error("Ejecuta npm run decks:pod:sync para cargar el pod cEDH.");
  podCache = JSON.parse(await readFile(activePodPath, "utf8")) as ImportedPod;
  return podCache;
}

async function readPrecons(): Promise<ImportedPrecons> {
  if (preconCache) return preconCache;
  if (!existsSync(preconsPath)) throw new Error("Ejecuta npm run precons:sync para importar los mazos precon.");
  preconCache = JSON.parse(await readFile(preconsPath, "utf8")) as ImportedPrecons;
  return preconCache;
}

// ---------------------------------------------------------------------------
// Card catalog
// ---------------------------------------------------------------------------

interface CatalogCard {
  readonly id: string;
  readonly name: string;
  readonly type_line: string;
  readonly mana_cost: string;
  readonly oracle_text: string;
  readonly scryfall_uri: string;
  readonly power: string | null;
  readonly toughness: string | null;
  readonly image_uris: { readonly small?: string; readonly normal?: string; readonly art_crop?: string };
}

function mapCatalogRow(row: Record<string, unknown>): CatalogCard {
  return {
    id: String(row.id),
    name: String(row.name),
    type_line: String(row.type_line ?? ""),
    mana_cost: String(row.mana_cost ?? ""),
    oracle_text: String(row.oracle_text ?? ""),
    scryfall_uri: String(row.scryfall_uri ?? ""),
    power: row.power === null || row.power === undefined ? null : String(row.power),
    toughness: row.toughness === null || row.toughness === undefined ? null : String(row.toughness),
    image_uris: { small: String(row.image_small ?? ""), normal: String(row.image_normal ?? ""), art_crop: String(row.image_art_crop ?? "") }
  };
}

function catalogColumns(database: DatabaseSync): string {
  const columns = new Set(database.prepare("SELECT name FROM pragma_table_info('cards')").all().map((row) => String((row as Record<string, unknown>).name)));
  const optional = ["power", "toughness"].filter((column) => columns.has(column));
  return ["id", "name", "type_line", "mana_cost", "oracle_text", "scryfall_uri", "image_small", "image_normal", "image_art_crop", ...optional].join(", ");
}

function queryLocalCatalog(query: string): CatalogCard[] | null {
  if (!existsSync(catalogDbPath)) return null;
  const database = new DatabaseSync(catalogDbPath, { readOnly: true });
  try {
    const columns = catalogColumns(database);
    const typeQuery = /^t:(.+)$/i.exec(query.trim());
    const statement = typeQuery
      ? database.prepare(`SELECT DISTINCT ${columns.split(", ").map((column) => `c.${column}`).join(", ")} FROM cards c JOIN card_terms t ON t.card_id = c.id WHERE t.kind = 'type' AND t.term = ? ORDER BY c.released_at DESC LIMIT 24`)
      : database.prepare(`SELECT ${columns} FROM cards WHERE name LIKE ? OR normalized_name LIKE ? ORDER BY released_at DESC LIMIT 24`);
    const rows = typeQuery
      ? statement.all(typeQuery[1]!.trim().toLocaleLowerCase())
      : statement.all(`%${query.trim()}%`, `%${query.trim().toLocaleLowerCase()}%`);
    return rows.map((row) => mapCatalogRow(row as Record<string, unknown>));
  } finally { database.close(); }
}

function namedLocalCard(name: string): CatalogCard | null {
  if (!existsSync(catalogDbPath)) return null;
  const database = new DatabaseSync(catalogDbPath, { readOnly: true });
  try {
    const row = database.prepare(`SELECT ${catalogColumns(database)} FROM cards WHERE normalized_name = ? ORDER BY released_at DESC LIMIT 1`).get(name.toLocaleLowerCase());
    return row ? mapCatalogRow(row as Record<string, unknown>) : null;
  } finally { database.close(); }
}

async function fetchScryfall(path: string): Promise<unknown> {
  const waitMs = Math.max(0, 125 - (Date.now() - lastCatalogRequestAt));
  if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastCatalogRequestAt = Date.now();
  const upstream = await fetch(`https://api.scryfall.com${path}`, {
    headers: { Accept: "application/json;q=0.9,*/*;q=0.8", "User-Agent": `ProsshTCG/0.1 (${contact})` },
    signal: AbortSignal.timeout(8_000)
  });
  if (!upstream.ok) throw new Error(`Scryfall respondió ${upstream.status}`);
  return upstream.json();
}

await app.register(cors, { origin: clientOrigin });

function failure(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

app.get("/health", async () => ({ ok: true, service: "prossh-match-server", matches: listMatches().length }));

app.get<{ Querystring: { q?: string } }>("/api/catalog/search", async (request, reply) => {
  const query = request.query.q?.trim();
  if (!query || query.length < 2) return reply.code(400).send({ error: "Usa al menos dos caracteres." });
  const cacheKey = query.toLocaleLowerCase();
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const localCards = queryLocalCatalog(query);
  const payload: unknown = localCards
    ? { object: "list", data: localCards, has_more: false, source: "local" }
    : await fetchScryfall(`/cards/search?q=${encodeURIComponent(query)}&unique=prints&order=released`);
  searchCache.set(cacheKey, { value: payload, expiresAt: Date.now() + 5 * 60_000 });
  return payload;
});

app.get<{ Querystring: { name?: string } }>("/api/catalog/named", async (request, reply) => {
  const name = request.query.name?.trim();
  if (!name) return reply.code(400).send({ error: "Falta el nombre de la carta." });
  const local = namedLocalCard(name);
  if (local) return local;
  try { return await fetchScryfall(`/cards/named?exact=${encodeURIComponent(name)}`); }
  catch { return reply.code(502).send({ error: "El proveedor de catálogo no está disponible." }); }
});

app.get("/api/catalog/status", async () => ({ localCatalog: existsSync(catalogDbPath), catalogDbPath }));

app.get("/api/simulations/engine-matrix", async (_request, reply) => {
  if (!existsSync(engineReportPath)) return reply.code(404).send({ error: "Todavía no hay reporte. Ejecuta npm run simulate:engine." });
  try { return JSON.parse(await readFile(engineReportPath, "utf8")); }
  catch { return reply.code(500).send({ error: "No se pudo leer el reporte del motor." }); }
});

app.get("/api/decks/active-pod", async (_request, reply) => {
  try {
    const pod = await readActivePod();
    return { source: pod.source, synced_at: pod.synced_at, decks: pod.decks.map(({ id, name, commanders }) => ({ id, name, commanders, size: 100 })) };
  } catch (error) { return reply.code(404).send({ error: failure(error, "Pod no disponible.") }); }
});

app.get<{ Querystring: { q?: string; offset?: string; limit?: string } }>("/api/decks/precons", async (request, reply) => {
  try {
    const precons = await readPrecons();
    const query = request.query.q?.trim().toLocaleLowerCase() ?? "";
    const filtered = query
      ? precons.decks.filter((deck) => `${deck.name} ${deck.commanders.join(" ")} ${deck.set_code}`.toLocaleLowerCase().includes(query))
      : precons.decks;
    const offset = Math.max(0, Number(request.query.offset ?? 0));
    const limit = Math.min(48, Math.max(1, Number(request.query.limit ?? 24)));
    return {
      total: filtered.length, offset, source: precons.source,
      data: filtered.slice(offset, offset + limit).map(({ id, name, commanders, set_code, released_at, cover_art_uri, cover_art_kind }) =>
        ({ id, name, commanders, set_code, released_at, cover_art_uri, cover_art_kind }))
    };
  } catch (error) { return reply.code(404).send({ error: failure(error, "Precons no disponibles.") }); }
});

// ---------------------------------------------------------------------------
// Matches
// ---------------------------------------------------------------------------

interface CreateBody { readonly mode?: "cedh" | "precon"; readonly deckId?: string; readonly seed?: number }

app.post<{ Body: CreateBody }>("/api/matches", async (request, reply) => {
  try {
    const mode = request.body?.mode ?? "cedh";
    const seed = Number.isFinite(request.body?.seed) ? Number(request.body?.seed) : undefined;
    let decks: ImportedDeck[];
    let source: string;
    if (mode === "precon") {
      const precons = await readPrecons();
      const start = request.body?.deckId ? precons.decks.findIndex((deck) => deck.id === request.body!.deckId) : 0;
      if (start < 0) throw new Error("No se encontró ese mazo precon.");
      decks = Array.from({ length: 4 }, (_, offset) => precons.decks[(start + offset) % precons.decks.length]!);
      source = precons.source;
    } else {
      const pod = await readActivePod();
      decks = [...pod.decks.slice(0, 4)];
      source = pod.source;
    }
    const created = createMatch(decks, { ...(seed === undefined ? {} : { seed }), source });
    return created;
  } catch (error) { return reply.code(400).send({ error: failure(error, "No se pudo crear la partida.") }); }
});

app.get<{ Params: { id: string }; Querystring: { token?: string } }>("/api/matches/:id", async (request, reply) => {
  try { return viewMatch(request.params.id, request.query.token); }
  catch (error) { return reply.code(404).send({ error: failure(error, "Partida no disponible.") }); }
});

app.post<{ Params: { id: string }; Body: { token?: string; action?: GameAction } }>("/api/matches/:id/action", async (request, reply) => {
  try {
    const action = request.body?.action;
    if (!action || typeof action.type !== "string") return reply.code(400).send({ error: "Falta la acción." });
    const view = actInMatch(request.params.id, request.body?.token, action);
    io.to(`match:${request.params.id}`).emit("match:updated", { matchId: request.params.id, version: view.version });
    return view;
  } catch (error) { return reply.code(400).send({ error: failure(error, "La acción fue rechazada.") }); }
});

app.post<{ Params: { id: string }; Body: { token?: string; autoPass?: boolean } }>("/api/matches/:id/settings", async (request, reply) => {
  try { return setAutoPass(request.params.id, request.body?.token, request.body?.autoPass !== false); }
  catch (error) { return reply.code(400).send({ error: failure(error, "No se pudo cambiar la preferencia.") }); }
});

app.get<{ Params: { id: string }; Querystring: { token?: string } }>("/api/matches/:id/summary", async (request, reply) => {
  try {
    const match = getMatch(request.params.id);
    seatForToken(match, request.query.token);
    return matchSummary(match);
  } catch (error) { return reply.code(404).send({ error: failure(error, "Partida no disponible.") }); }
});

const io = new Server(app.server, { cors: { origin: clientOrigin } });
io.on("connection", (socket) => {
  socket.emit("session:ready", { message: "Transporte listo. La autenticación real sigue pendiente." });
  socket.on("match:watch", ({ matchId }: { matchId?: string }) => {
    if (typeof matchId === "string" && matchId) void socket.join(`match:${matchId}`);
  });
});

await app.listen({ port, host: "0.0.0.0" });
console.log(`ProsshTCG match server escuchando en http://localhost:${port}`);
