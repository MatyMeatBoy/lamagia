import cors from "@fastify/cors";
import Fastify from "fastify";
import { Server } from "socket.io";
import { DatabaseSync } from "node:sqlite";
import { existsSync, statSync } from "node:fs";
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
const setCoveragePath = process.env.SET_COVERAGE_PATH ?? fileURLToPath(new URL("../../../data/rules/set-coverage.json", import.meta.url));

interface ImportedPod { readonly source: string; readonly synced_at: string; readonly decks: readonly ImportedDeck[] }
interface ImportedPrecon extends ImportedDeck { readonly set_code: string; readonly released_at: string; readonly cover_art_uri?: string; readonly cover_art_kind: string }
interface ImportedPrecons { readonly source: string; readonly synced_at: string; readonly decks: readonly ImportedPrecon[] }
interface CoverageCard { readonly oracleId: string; readonly scryfallId: string; readonly name: string; readonly implemented: boolean }
interface CoverageSet {
  readonly code: string; readonly setType: string; readonly category: string; readonly group: string; readonly releasedAt: string;
  readonly uniqueCards: number; readonly implemented: number; readonly pending: number; readonly percentage: number;
  readonly pendingCards: readonly CoverageCard[];
}
interface SetCoverageReport { readonly format: string; readonly generatedAt: string; readonly setCount: number; readonly membershipCount: number; readonly implementedMembershipCount: number; readonly percentage: number; readonly sets: readonly CoverageSet[] }

let podCache: ImportedPod | null = null;
let preconCache: ImportedPrecons | null = null;
let setCoverageCache: SetCoverageReport | null = null;
let setCoverageMtime = 0;

async function readSetCoverage(): Promise<SetCoverageReport> {
  if (!existsSync(setCoveragePath)) throw new Error("Todavía no hay mapa de cobertura. Ejecuta npm run rules:set:coverage.");
  const mtime = statSync(setCoveragePath).mtimeMs;
  if (setCoverageCache && setCoverageMtime === mtime) return setCoverageCache;
  setCoverageCache = JSON.parse(await readFile(setCoveragePath, "utf8")) as SetCoverageReport;
  setCoverageMtime = mtime;
  return setCoverageCache;
}

const PRODUCT_BOX_ART: Readonly<Record<string, string>> = {
  MindSeize_C13: "https://m.media-amazon.com/images/I/71oIylvF4fL.jpg",
  PowerHungry_C13: "https://m.media-amazon.com/images/I/61uQke4LCKL._AC_UF350,350_QL50_.jpg"
};

function isCollectorEdition(deck: ImportedPrecon): boolean {
  return `${deck.id} ${deck.name}`.toLocaleLowerCase().includes("collector");
}

async function readActivePod(): Promise<ImportedPod> {
  if (podCache) return podCache;
  if (!existsSync(activePodPath)) throw new Error("Ejecuta npm run decks:pod:sync para cargar el pod cEDH.");
  podCache = JSON.parse(await readFile(activePodPath, "utf8")) as ImportedPod;
  return podCache;
}

async function readPrecons(): Promise<ImportedPrecons> {
  if (preconCache) return preconCache;
  if (!existsSync(preconsPath)) throw new Error("Ejecuta npm run precons:sync para importar los mazos precon.");
  const imported = JSON.parse(await readFile(preconsPath, "utf8")) as ImportedPrecons;
  // Keep collector variants documented in the source file, but do not expose
  // them as selectable Commander products in the normal deck browser.
  preconCache = { ...imported, decks: imported.decks.filter((deck) => !isCollectorEdition(deck)) };
  return preconCache;
}

// ---------------------------------------------------------------------------
// Card catalog
// ---------------------------------------------------------------------------

interface CatalogCard {
  readonly id: string;
  readonly oracle_id: string;
  readonly name: string;
  readonly type_line: string;
  readonly mana_cost: string;
  readonly oracle_text: string;
  readonly set_code: string;
  readonly set_name: string;
  readonly set_type: string;
  readonly released_at: string;
  readonly rarity: string;
  readonly scryfall_uri: string;
  readonly power: string | null;
  readonly toughness: string | null;
  readonly promo: boolean;
  readonly variation: boolean;
  readonly main_set: boolean;
  readonly printings?: number;
  readonly image_uris: { readonly small?: string; readonly normal?: string; readonly art_crop?: string };
}

interface CatalogPrinting {
  readonly id: string;
  readonly set_code: string;
  readonly set_name: string;
  readonly set_type: string;
  readonly released_at: string;
  readonly rarity: string;
  readonly collector_number: string;
  readonly promo: boolean;
  readonly variation: boolean;
  readonly main_set: boolean;
  readonly image_normal?: string;
}

const CARD_COLUMNS = [
  "id", "oracle_id", "name", "type_line", "mana_cost", "oracle_text",
  "set_code", "set_name", "set_type", "released_at", "rarity", "collector_number",
  "scryfall_uri", "power", "toughness", "promo", "variation", "frame_effects_json",
  "image_small", "image_normal", "image_art_crop"
];

/** Only regular Core/Expansion printings are the default gallery version. */
function isMainSetPrinting(row: Record<string, unknown>): boolean {
  const setType = String(row.set_type ?? "");
  const frameEffects = String(row.frame_effects_json ?? "[]");
  return (setType === "core" || setType === "expansion")
    && !Boolean(row.promo) && !Boolean(row.variation) && frameEffects === "[]";
}

function mapCatalogRow(row: Record<string, unknown>): CatalogCard {
  const text = (key: string) => (row[key] === null || row[key] === undefined ? "" : String(row[key]));
  return {
    id: text("id"),
    oracle_id: text("oracle_id"),
    name: text("name"),
    type_line: text("type_line"),
    mana_cost: text("mana_cost"),
    oracle_text: text("oracle_text"),
    set_code: text("set_code"),
    set_name: text("set_name"),
    set_type: text("set_type"),
    released_at: text("released_at"),
    rarity: text("rarity"),
    scryfall_uri: text("scryfall_uri"),
    power: row.power === null || row.power === undefined ? null : String(row.power),
    toughness: row.toughness === null || row.toughness === undefined ? null : String(row.toughness),
    promo: Boolean(row.promo),
    variation: Boolean(row.variation),
    main_set: isMainSetPrinting(row),
    ...(row.printings === undefined ? {} : { printings: Number(row.printings) }),
    image_uris: { small: text("image_small"), normal: text("image_normal"), art_crop: text("image_art_crop") }
  };
}

let schemaColumns: Set<string> | null = null;
function catalogHasPrintingRank(database: DatabaseSync): boolean {
  if (!schemaColumns) {
    schemaColumns = new Set(database.prepare("SELECT name FROM pragma_table_info('cards')").all()
      .map((row) => String((row as Record<string, unknown>).name)));
  }
  return schemaColumns.has("printing_rank");
}

/** Products that are not playable cards: tokens, art series, emblems, memorabilia. */
const PLAYABLE_ONLY = `layout NOT IN ('token','double_faced_token','emblem','art_series','scheme','planar','vanguard','reversible_card')
  AND (set_type IS NULL OR set_type NOT IN ('token','memorabilia','minigame','vanguard'))`;

/**
 * One row per distinct card, not per printing.
 *
 * `printing_rank` is precomputed by the importer: 0 is a plain paper printing in
 * a normal frame, and every promo, foil-only, showcase, oversized or digital
 * treatment scores higher. Picking the lowest rank and then the newest release
 * gives the version a player actually recognises, while `printings` still
 * reports how many exist so the card page can list them.
 */
function bestPrintingSelect(database: DatabaseSync, where: string): string {
  const modern = catalogHasPrintingRank(database);
  // Prefer a regular Core/Expansion printing even when a Secret Lair or a
  // supplemental product is newer. If a card has no main-set printing, the
  // second branch still gives it the best documented non-promo version.
  const preferred = modern
    ? "CASE WHEN set_type IN ('core','expansion') AND COALESCE(promo,0) = 0 AND COALESCE(variation,0) = 0 AND COALESCE(frame_effects_json,'[]') = '[]' THEN 0 ELSE 1 END,"
    : "";
  const ranked = modern ? "printing_rank ASC," : "";
  const playable = modern ? `(${PLAYABLE_ONLY}) AND ` : "";
  return `
    WITH matched AS (SELECT * FROM cards WHERE ${playable}(${where})),
         best AS (
           SELECT *, ROW_NUMBER() OVER (
             PARTITION BY COALESCE(oracle_id, name)
             ORDER BY ${preferred} ${ranked} released_at DESC, set_code ASC
           ) AS pick,
           COUNT(*) OVER (PARTITION BY COALESCE(oracle_id, name)) AS printings
           FROM matched
         )
    SELECT ${CARD_COLUMNS.join(", ")}, printings FROM best WHERE pick = 1`;
}

function openCatalog(): DatabaseSync | null {
  if (!existsSync(catalogDbPath)) return null;
  return new DatabaseSync(catalogDbPath, { readOnly: true });
}

function queryLocalCatalog(query: string): CatalogCard[] | null {
  const database = openCatalog();
  if (!database) return null;
  try {
    const term = query.trim();
    const typeQuery = /^t:(.+)$/i.exec(term);
    if (typeQuery) {
      const statement = database.prepare(
        `${bestPrintingSelect(database, "id IN (SELECT card_id FROM card_terms WHERE kind = 'type' AND term = ?)")} ORDER BY name LIMIT 60`);
      return statement.all(typeQuery[1]!.trim().toLocaleLowerCase()).map((row) => mapCatalogRow(row as Record<string, unknown>));
    }
    // Relevance: exact name, then a whole-word hit anywhere in the name ("bolt"
    // has to reach both Bolt Bend and Lightning Bolt), then any substring. Within
    // a tier, reprint count is the popularity signal that floats the card the
    // player actually meant; name length breaks the remaining ties.
    // Numbered placeholders keep the CTE filter and the ORDER BY on one binding set.
    const statement = database.prepare(
      `${bestPrintingSelect(database, "normalized_name LIKE ?2")}
       ORDER BY CASE
           WHEN normalized_name = ?1 THEN 0
           WHEN normalized_name LIKE ?3 OR normalized_name LIKE ?4 OR normalized_name LIKE ?5 THEN 1
           ELSE 2 END,
         printings DESC, LENGTH(name), name
       LIMIT 60`);
    const lower = term.toLocaleLowerCase();
    return statement.all(lower, `%${lower}%`, `${lower} %`, `% ${lower} %`, `% ${lower}`)
      .map((row) => mapCatalogRow(row as Record<string, unknown>));
  } finally { database.close(); }
}

function namedLocalCard(name: string): CatalogCard | null {
  const database = openCatalog();
  if (!database) return null;
  try {
    const row = database.prepare(`${bestPrintingSelect(database, "normalized_name = ?")} LIMIT 1`).get(name.toLocaleLowerCase());
    return row ? mapCatalogRow(row as Record<string, unknown>) : null;
  } finally { database.close(); }
}

interface CardPage extends CatalogCard {
  readonly printings_list: CatalogPrinting[];
  /** Wizards' published clarifications, the same body Gatherer shows. */
  readonly rulings: { published_at: string; comment: string }[];
}

let rulingsTableChecked = false;
let hasRulingsTable = false;
function catalogHasRulings(database: DatabaseSync): boolean {
  if (!rulingsTableChecked) {
    hasRulingsTable = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='card_rulings'").get() !== undefined;
    rulingsTableChecked = true;
  }
  return hasRulingsTable;
}

function catalogCardById(id: string): CardPage | null {
  const database = openCatalog();
  if (!database) return null;
  try {
    const row = database.prepare(`SELECT ${CARD_COLUMNS.join(", ")} FROM cards WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    const oracleId = row.oracle_id ? String(row.oracle_id) : "";
    const printings = oracleId
      ? database.prepare("SELECT id, set_code, set_name, set_type, released_at, rarity, collector_number, promo, variation, frame_effects_json, image_normal FROM cards WHERE oracle_id = ? ORDER BY released_at DESC, set_code ASC, collector_number ASC").all(oracleId)
      : [];
    // Rulings are keyed by oracle_id, so they hold across every printing.
    const rulings = oracleId && catalogHasRulings(database)
      ? database.prepare("SELECT published_at, comment FROM card_rulings WHERE oracle_id = ? ORDER BY published_at").all(oracleId)
      : [];
    return {
      ...mapCatalogRow(row),
      printings_list: printings.map((entry) => {
        const record = entry as Record<string, unknown>;
        return {
          id: String(record.id ?? ""), set_code: String(record.set_code ?? ""), set_name: String(record.set_name ?? ""),
          set_type: String(record.set_type ?? ""), released_at: String(record.released_at ?? ""), rarity: String(record.rarity ?? ""),
          collector_number: String(record.collector_number ?? ""), promo: Boolean(record.promo), variation: Boolean(record.variation),
          main_set: isMainSetPrinting(record), ...(record.image_normal ? { image_normal: String(record.image_normal) } : {})
        } satisfies CatalogPrinting;
      }),
      rulings: rulings.map((entry) => {
        const record = entry as Record<string, unknown>;
        return { published_at: String(record.published_at ?? ""), comment: String(record.comment ?? "") };
      })
    };
  } finally { database.close(); }
}

/** Set display names and icons, read from the local catalog and Scryfall's set list. */
let setIndexCache: Map<string, { name: string; icon?: string; released_at: string }> | null = null;
async function setIndex(): Promise<Map<string, { name: string; icon?: string; released_at: string }>> {
  if (setIndexCache) return setIndexCache;
  const index = new Map<string, { name: string; icon?: string; released_at: string }>();
  const database = openCatalog();
  if (database) {
    try {
      for (const row of database.prepare("SELECT set_code, set_name, MIN(released_at) AS released_at FROM cards GROUP BY set_code").all()) {
        const record = row as Record<string, unknown>;
        index.set(String(record.set_code ?? "").toLowerCase(), { name: String(record.set_name ?? ""), released_at: String(record.released_at ?? "") });
      }
    } finally { database.close(); }
  }
  try {
    const sets = await fetchScryfall("/sets") as { data?: { code?: string; name?: string; icon_svg_uri?: string; released_at?: string }[] };
    for (const entry of sets.data ?? []) {
      if (!entry.code) continue;
      const existing = index.get(entry.code.toLowerCase());
      index.set(entry.code.toLowerCase(), {
        name: entry.name ?? existing?.name ?? entry.code.toUpperCase(),
        ...(entry.icon_svg_uri ? { icon: entry.icon_svg_uri } : {}),
        released_at: entry.released_at ?? existing?.released_at ?? ""
      });
    }
  } catch { /* Offline is fine: the catalog already supplies names and dates. */ }
  setIndexCache = index;
  return index;
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

app.get<{ Params: { id: string } }>("/api/catalog/card/:id", async (request, reply) => {
  const card = catalogCardById(request.params.id);
  if (card) return card;
  try { return await fetchScryfall(`/cards/${encodeURIComponent(request.params.id)}`); }
  catch { return reply.code(404).send({ error: "No se encontró esa carta." }); }
});

app.get("/api/catalog/status", async () => ({ localCatalog: existsSync(catalogDbPath), catalogDbPath }));

app.get("/api/simulations/engine-matrix", async (_request, reply) => {
  if (!existsSync(engineReportPath)) return reply.code(404).send({ error: "Todavía no hay reporte. Ejecuta npm run simulate:engine." });
  try { return JSON.parse(await readFile(engineReportPath, "utf8")); }
  catch { return reply.code(500).send({ error: "No se pudo leer el reporte del motor." }); }
});

app.get("/api/rules/coverage/sets", async (_request, reply) => {
  try {
    const report = await readSetCoverage();
    return {
      ...report,
      // The chart needs counts only. Pending IDs are available on the detail route
      // so the normal response stays small even with hundreds of editions.
      sets: report.sets.map(({ pendingCards: _pendingCards, ...summary }) => summary)
    };
  } catch (error) { return reply.code(404).send({ error: failure(error, "Cobertura no disponible.") }); }
});

app.get<{ Params: { code: string } }>("/api/rules/coverage/sets/:code", async (request, reply) => {
  try {
    const report = await readSetCoverage();
    const found = report.sets.find((entry) => entry.code === request.params.code.toLowerCase());
    return found ? found : reply.code(404).send({ error: "No se encontró esa edición." });
  } catch (error) { return reply.code(404).send({ error: failure(error, "Cobertura no disponible.") }); }
});

app.get("/api/decks/active-pod", async (_request, reply) => {
  try {
    const pod = await readActivePod();
    return { source: pod.source, synced_at: pod.synced_at, decks: pod.decks.map(({ id, name, commanders }) => ({ id, name, commanders, size: 100 })) };
  } catch (error) { return reply.code(404).send({ error: failure(error, "Pod no disponible.") }); }
});

app.get<{ Querystring: { q?: string; offset?: string; limit?: string; grouped?: string } }>("/api/decks/precons", async (request, reply) => {
  try {
    const precons = await readPrecons();
    const sets = await setIndex();
    const query = request.query.q?.trim().toLocaleLowerCase() ?? "";
    const decorate = (deck: ImportedPrecon) => {
      const meta = sets.get(deck.set_code.toLowerCase());
      return {
        id: deck.id, name: deck.name, commanders: deck.commanders, set_code: deck.set_code,
        set_name: meta?.name ?? deck.set_code.toUpperCase(),
        released_at: deck.released_at || meta?.released_at || "",
        cover_art_uri: PRODUCT_BOX_ART[deck.id] ?? deck.cover_art_uri,
        cover_art_kind: PRODUCT_BOX_ART[deck.id] ? "product_box_render" : deck.cover_art_kind,
        ...(meta?.icon ? { set_icon_uri: meta.icon } : {})
      };
    };
    const matches = (deck: ImportedPrecon) => {
      if (!query) return true;
      const setName = sets.get(deck.set_code.toLowerCase())?.name ?? "";
      return `${deck.name} ${deck.commanders.join(" ")} ${deck.set_code} ${setName}`.toLocaleLowerCase().includes(query);
    };
    const filtered = precons.decks.filter(matches).map(decorate);

    // Grouped mode is what the deck browser uses: one section per Commander product.
    if (request.query.grouped === "1") {
      const offset = Math.max(0, Number(request.query.offset ?? 0));
      const limit = Math.min(96, Math.max(1, Number(request.query.limit ?? 48)));
      const page = filtered.slice(offset, offset + limit);
      const groups = new Map<string, { set_code: string; set_name: string; released_at: string; set_icon_uri?: string; decks: typeof filtered }>();
      for (const deck of page) {
        const existing = groups.get(deck.set_code);
        if (existing) { existing.decks.push(deck); continue; }
        groups.set(deck.set_code, {
          set_code: deck.set_code, set_name: deck.set_name, released_at: deck.released_at,
          ...(deck.set_icon_uri ? { set_icon_uri: deck.set_icon_uri } : {}),
          decks: [deck]
        });
      }
      const ordered = [...groups.values()].sort((left, right) => right.released_at.localeCompare(left.released_at) || left.set_name.localeCompare(right.set_name));
      for (const group of ordered) group.decks.sort((left, right) => left.name.localeCompare(right.name));
      return { total: filtered.length, offset, limit, hasMore: offset + limit < filtered.length, source: precons.source, groups: ordered };
    }

    const offset = Math.max(0, Number(request.query.offset ?? 0));
    const limit = Math.min(96, Math.max(1, Number(request.query.limit ?? 24)));
    return { total: filtered.length, offset, source: precons.source, data: filtered.slice(offset, offset + limit) };
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
      const chosen = precons.decks[start]!;
      // Fill the table from the same product first: a Commander 2014 pod should be
      // four Commander 2014 decks, not the next four rows of the whole catalogue.
      const sameProduct = precons.decks.filter((deck) => deck.set_code === chosen.set_code && deck.id !== chosen.id);
      const filler = precons.decks.filter((deck) => deck.set_code !== chosen.set_code);
      decks = [chosen, ...sameProduct, ...filler].slice(0, 4);
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
