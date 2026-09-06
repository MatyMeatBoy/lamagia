/**
 * ProsshTCG table client.
 *
 * The client is deliberately thin: it renders the seat projection the server
 * sends and can only submit actions the server already declared legal. It never
 * decides a rule, never sees another seat's hidden zones, and never invents a
 * card effect.
 *
 * Layout is a single non-scrolling viewport: opponents own the upper band at
 * full width, the local player owns the lower band, and the log, the stack and
 * the card preview float over the table so they never steal board space.
 */

import type { AbilityView, CardView, GameView, LegalAction, PermanentView, PlayerView, Target, TargetKind, TurnStep } from "@prossh/rules";
import { ACTIVATION_GLYPHS, KEYWORD_GLYPHS, TRIGGER_GLYPHS, glyphSvg, keywordGlyph, type AbilityGlyph } from "./abilities.js";
import "./styles.css";
import { manaImageUrl, recoverManaImage } from "./mana-images.js";
import { hasCreatureStats } from "./card-stats.js";

declare global {
  interface Window { __PROSSH_API_BASE__?: string; }
}

type PreconSummary = {
  id: string; name: string; commanders: string[]; set_code: string; set_name?: string;
  released_at: string; cover_art_uri?: string; cover_art_kind: string; set_icon_uri?: string;
};
type PreconGroup = { set_code: string; set_name: string; released_at: string; set_icon_uri?: string; decks: PreconSummary[] };
type CardRuling = { published_at: string; comment: string };
type CatalogCard = {
  id: string; name: string; type_line: string; mana_cost: string; oracle_text: string;
  set_code: string; set_name: string; set_type: string; released_at: string; rarity: string; scryfall_uri: string;
  power: string | null; toughness: string | null; printings?: number;
  promo: boolean; variation: boolean; main_set: boolean;
  printings_list?: CatalogPrinting[];
  rulings?: CardRuling[];
  image_uris: { small?: string; normal?: string; art_crop?: string };
};
type CatalogPrinting = {
  id: string; set_code: string; set_name: string; set_type: string; released_at: string; rarity: string;
  collector_number: string; promo: boolean; variation: boolean; main_set: boolean; image_normal?: string;
};
type CoverageCard = { oracleId: string; scryfallId: string; name: string; implemented: boolean };
type CoverageSet = {
  code: string; name: string; setType: string; category: "main" | "commander" | "secret-lair" | "other"; group: string; subgroup: string;
  releasedAt: string; uniqueCards: number; implemented: number; pending: number; percentage: number;
  pendingCards?: CoverageCard[];
};
type SetCoverageReport = {
  generatedAt: string; setCount: number; membershipCount: number; implementedMembershipCount: number;
  percentage: number; excludedEditions?: { code: string; name: string; setType: string }[]; sets: CoverageSet[];
};
type AvatarChoice = { name: string; image: string };
type MatchSession = { matchId: string; token: string; seat: number };

const STEP_ORDER: TurnStep[] = [
  "untap", "upkeep", "draw", "precombat-main", "begin-combat", "declare-attackers",
  "declare-blockers", "combat-damage", "end-combat", "postcombat-main", "end", "cleanup"
];
const STEP_LABELS: Record<TurnStep, string> = {
  untap: "Enderezar", upkeep: "Mantenimiento", draw: "Robo", "precombat-main": "Principal 1",
  "begin-combat": "Combate", "declare-attackers": "Atacantes", "declare-blockers": "Bloqueadores",
  "combat-damage": "Daño", "end-combat": "Fin combate", "postcombat-main": "Principal 2",
  end: "Final", cleanup: "Limpieza"
};

interface UiState {
  pendingTarget: { action: LegalAction; options: readonly Target[]; targetKinds: readonly TargetKind[]; selectedTargets: readonly Target[]; targetIndex: number } | null;
  attackers: Map<string, number>;
  blockers: Map<string, string>;
  selectedBlocker: string | null;
  notice: string;
  busy: boolean;
  logOpen: boolean;
  autoPass: boolean;
  actionsOpen: boolean;
  /** The permanent whose ability menu is open, Arena-style. */
  abilityMenu: string | null;
  /** The hand card whose cast/cycle alternatives are being chosen. */
  cardActionMenu: string | null;
  /** Context menu opened from the playmat for reversible actions. */
  contextMenu: { x: number; y: number } | null;
  showFullLibrary: boolean;
  /** The keyword or ability glyph whose help card is open. */
  glyphHelp: AbilityGlyph | null;
  /** Public stack object currently inspected in the graphical stack. */
  stackDetail: string | null;
  /** "auto" follows the viewport; "mobile" forces the landscape touch layout on a desktop. */
  layout: "auto" | "mobile";
}

let session: MatchSession | null = null;
let view: GameView | null = null;
let avatarChoices: AvatarChoice[] = [];
let selectedAvatar = window.localStorage.getItem("prossh.avatar") ?? "";
let coverageFilter: CoverageSet["category"] | "all" = "main";
let coverageGroup = "all";
let coverageSubgroup = "all";
let coverageQuery = "";
const ui: UiState = {
  pendingTarget: null, attackers: new Map(), blockers: new Map(), selectedBlocker: null, abilityMenu: null, cardActionMenu: null, contextMenu: null, glyphHelp: null, stackDetail: null,
  notice: "", busy: false, logOpen: window.localStorage.getItem("prossh.log") === "1", showFullLibrary: false,
  // Smart priority is the default; manual priority remains an explicit opt-out.
  autoPass: window.localStorage.getItem("prossh.auto-pass") !== "0",
  actionsOpen: false,
  layout: window.localStorage.getItem("prossh.layout") === "mobile" ? "mobile" : "auto"
};

interface CardDragState {
  readonly cardId: string;
  readonly button: HTMLButtonElement;
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  ghost: HTMLButtonElement | null;
  moved: boolean;
  longPressed: boolean;
  longPressTimer: number | null;
}

let cardDrag: CardDragState | null = null;
interface CardDetailPressState {
  readonly cardId: string;
  readonly button: HTMLButtonElement;
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  timer: number | null;
  longPressed: boolean;
}

let cardDetailPress: CardDetailPressState | null = null;
/** Native click fires after pointerup; this prevents a long-press/drag from playing twice. */
let suppressNextCardClick = false;
let suppressNextPermanentClick = false;

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Falta el contenedor #app.");

const escapeHtml = (value: string) =>
  value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
const dialog = (id: string) => document.querySelector<HTMLDialogElement>(`#${id}`);

// ---------------------------------------------------------------------------
// Mana symbols
// ---------------------------------------------------------------------------

/** Local copies of the full-colour Magic symbol artwork supplied by the user. */
const MANA_ASSET_IDS = new Set([
  "W", "U", "B", "R", "G", "C", "S", "T", "X",
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20",
  "WU", "UB", "BR", "RG", "GW", "WB", "UR", "BG", "RW", "GU",
  "WP", "UP", "BP", "RP", "GP", "2W", "2U", "2B", "2R", "2G", "CW", "CU", "CB", "CR", "CG"
]);

const HYBRID_ASSET_IDS: Record<string, string> = {
  "W/U": "WU", "U/W": "WU", "U/B": "UB", "B/U": "UB", "B/R": "BR", "R/B": "BR", "R/G": "RG", "G/R": "RG",
  "G/W": "GW", "W/G": "GW", "W/B": "WB", "B/W": "WB", "U/R": "UR", "R/U": "UR", "B/G": "BG", "G/B": "BG",
  "R/W": "RW", "W/R": "RW", "G/U": "GU", "U/G": "GU",
  "W/P": "WP", "P/W": "WP", "U/P": "UP", "P/U": "UP", "B/P": "BP", "P/B": "BP", "R/P": "RP", "P/R": "RP", "G/P": "GP", "P/G": "GP",
  "2/W": "2W", "W/2": "2W", "2/U": "2U", "U/2": "2U", "2/B": "2B", "B/2": "2B", "2/R": "2R", "R/2": "2R", "2/G": "2G", "G/2": "2G",
  "C/W": "CW", "W/C": "CW", "C/U": "CU", "U/C": "CU", "C/B": "CB", "B/C": "CB", "C/R": "CR", "R/C": "CR", "C/G": "CG", "G/C": "CG"
};

function manaAssetId(symbol: string): string | undefined {
  const upper = symbol.toUpperCase();
  return MANA_ASSET_IDS.has(upper) ? upper : HYBRID_ASSET_IDS[upper];
}

function manaSymbolHtml(symbol: string): string {
  const upper = symbol.toUpperCase();
  const asset = manaAssetId(upper);
  const url = asset && manaImageUrl(asset);
  if (url) return `<i class="pip mana-asset" role="img" aria-label="${escapeHtml(upper)}"><img src="${escapeHtml(url)}" data-mana-symbol="${escapeHtml(upper)}" alt="" draggable="false"/></i>`;
  return `<i class="pip p-${escapeHtml(/^\d+$/.test(upper) ? "generic" : upper.toLowerCase())}" aria-label="${escapeHtml(upper)}">${escapeHtml(upper)}</i>`;
}

/** Renders `{2}{G/W}{B/P}` as Magic-like coloured symbols; hybrids split in two. */
function manaHtml(cost: string | undefined): string {
  const symbols = [...(cost ?? "").matchAll(/\{([^}]+)\}/g)].map((match) => match[1]!);
  if (!symbols.length) return "";
  return `<span class="mana">${symbols.map(manaSymbolHtml).join("")}</span>`;
}

const MANA_POOL_ORDER = ["W", "U", "B", "R", "G", "C"] as const;

function manaReserveHtml(pool: Readonly<Record<string, number>>, restricted: readonly string[] = []): string {
  const entries = MANA_POOL_ORDER.filter((symbol) => (pool[symbol] ?? 0) > 0);
  const restrictedEntries = MANA_POOL_ORDER
    .map((symbol) => ({ symbol, count: restricted.filter((candidate) => candidate === symbol).length }))
    .filter((entry) => entry.count > 0);
  if (!entries.length && !restrictedEntries.length) return `<span class="mana-reserve-empty">—</span>`;
  return `${entries.map((symbol) => `<span class="mana-reserve-item">${manaSymbolHtml(symbol)}<b>${pool[symbol] ?? 0}</b></span>`).join("")}${restrictedEntries.map(({ symbol, count }) => `<span class="mana-reserve-item restricted" title="Solo para hechizos legendarios">${manaSymbolHtml(symbol)}<b>${count}</b></span>`).join("")}`;
}

/** Replaces Oracle mana tokens while keeping the rules text and line breaks. */
function oracleHtml(text: string): string {
  let html = "";
  let last = 0;
  for (const match of text.matchAll(/\{([^}]+)\}/g)) {
    const index = match.index ?? 0;
    html += escapeHtml(text.slice(last, index));
    html += manaHtml(`{${match[1]!}}`);
    last = index + match[0].length;
  }
  return html + escapeHtml(text.slice(last));
}

// ---------------------------------------------------------------------------
// Server access
// ---------------------------------------------------------------------------

/** Optional public match-server origin; empty keeps local relative `/api` calls. */
const API_BASE = (window.__PROSSH_API_BASE__ ?? "").replace(/\/$/, "");

function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), init);
  const contentType = response.headers.get("content-type") ?? "";
  const raw = await response.text();
  let payload: (T & { error?: string }) | null = null;
  if (contentType.includes("json") && raw) {
    try { payload = JSON.parse(raw) as T & { error?: string }; } catch { /* handled below */ }
  }
  if (!payload && raw.trim().startsWith("<")) {
    throw new Error(API_BASE
      ? "El servidor de partidas devolvió una página HTML en vez de JSON. Revisa la URL del match-server."
      : "La web pública está publicada, pero GitHub Pages no ejecuta el match-server. Inicia `npm run dev:server` para jugar contra la IA o configura un backend público en `__PROSSH_API_BASE__`.");
  }
  if (!response.ok) throw new Error(payload?.error ?? `La petición falló (${response.status}).`);
  if (!payload) throw new Error("El servidor devolvió una respuesta inválida.");
  return payload;
}

function recoverCardImage(image: HTMLImageElement): void {
  const name = image.dataset.cardName?.trim() || image.alt.trim();
  if (!name) { image.remove(); return; }
  const fallback = document.createElement("span");
  fallback.className = "card-image-fallback";
  fallback.setAttribute("role", "img");
  fallback.setAttribute("aria-label", `Imagen no disponible: ${name}`);
  fallback.textContent = name;
  image.replaceWith(fallback);
}

document.addEventListener("error", (event) => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement)) return;
  if (image.dataset.manaSymbol) recoverManaImage(image);
  else if (image.dataset.cardName) recoverCardImage(image);
  else image.remove();
}, true);

async function startMatch(mode: "cedh" | "precon" | "tested", deckId?: string): Promise<void> {
  ui.notice = "Repartiendo mazos…";
  render();
  try {
    const created = await api<{ matchId: string; seat: number; token: string; view: GameView }>("/api/matches", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, ...(deckId ? { deckId } : {}) })
    });
    session = { matchId: created.matchId, token: created.token, seat: created.seat };
    window.sessionStorage.setItem("prossh.match", JSON.stringify(session));
    ui.notice = "";
    applyView(created.view);
    if (ui.autoPass) {
      try {
        const settled = await api<GameView>(`/api/matches/${session.matchId}/settings`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: session.token, autoPass: true })
        });
        applyView(settled);
      } catch (error) {
        ui.notice = error instanceof Error ? error.message : "No se pudo activar el auto-paso.";
        render();
      }
    }
  } catch (error) {
    ui.notice = error instanceof Error ? error.message : "No se pudo crear la partida.";
    render();
  }
}

function returnToMain(): void {
  session = null;
  view = null;
  window.sessionStorage.removeItem("prossh.match");
  ui.pendingTarget = null;
  ui.notice = "";
  render();
}

async function refresh(): Promise<void> {
  if (!session) return;
  try { applyView(await api<GameView>(`/api/matches/${session.matchId}?token=${encodeURIComponent(session.token)}`)); }
  catch { session = null; window.sessionStorage.removeItem("prossh.match"); render(); }
}

async function submit(action: LegalAction["action"]): Promise<void> {
  if (!session || ui.busy) return;
  ui.busy = true;
  render();
  try {
    const next = await api<GameView>(`/api/matches/${session.matchId}/action`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: session.token, action })
    });
    ui.notice = "";
    ui.busy = false;
    applyView(next);
  } catch (error) {
    ui.notice = error instanceof Error ? error.message : "La acción fue rechazada.";
    ui.busy = false;
    render();
  }
}

async function undoLatestMana(): Promise<void> {
  if (!session || !view?.undoAvailable || ui.busy) return;
  ui.busy = true;
  render();
  try {
    const next = await api<GameView>(`/api/matches/${session.matchId}/undo`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: session.token, version: view.version })
    });
    ui.notice = "";
    ui.busy = false;
    applyView(next);
  } catch (error) {
    ui.notice = error instanceof Error ? error.message : "La acción ya no se puede deshacer.";
    ui.busy = false;
    render();
  }
}

async function setAutoPass(autoPass: boolean): Promise<void> {
  if (!session) return;
  ui.autoPass = autoPass;
  window.localStorage.setItem("prossh.auto-pass", autoPass ? "1" : "0");
  try {
    applyView(await api<GameView>(`/api/matches/${session.matchId}/settings`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: session.token, autoPass })
    }));
  } catch (error) { ui.notice = error instanceof Error ? error.message : "No se pudo cambiar la preferencia."; render(); }
}

function applyView(next: GameView): void {
  const sameDecision = view?.version === next.version
    && view?.prioritySeat === next.prioritySeat
    && view?.stack.map((object) => object.id).join(",") === next.stack.map((object) => object.id).join(",");
  view = next;
  if (!sameDecision) ui.pendingTarget = null;
  ui.selectedBlocker = null;
  ui.abilityMenu = null;
  ui.cardActionMenu = null;
  ui.contextMenu = null;
  ui.stackDetail = next.stack.some((object) => object.id === ui.stackDetail) ? ui.stackDetail : null;
  ui.showFullLibrary = false;
  if (!next.combat.awaitingAttackers) ui.attackers.clear();
  if (!next.combat.awaitingBlockersFrom.includes(next.viewerSeat)) ui.blockers.clear();
  render();
}

// ---------------------------------------------------------------------------
// View helpers
// ---------------------------------------------------------------------------

function seatOf(seat: number): PlayerView | undefined { return view?.players.find((player) => player.seat === seat); }
const CARD_ACTION_TYPES = new Set<LegalAction["action"]["type"]>([
  "cast", "cycle", "play-land", "activate", "activate-mana", "equip", "choose-reveal", "toggle-trigger-yield"
]);

/**
 * One general card menu for hand, battlefield and visible zone cards.
 * Keep the server's action objects intact so menu clicks still use the same
 * authoritative legal-action index as the compact action dock.
 */
function cardActionEntriesForCard(cardId: string): LegalAction[] {
  const seen = new Set<string>();
  return (view?.legalActions ?? [])
    .filter((entry) => entry.cardId === cardId && CARD_ACTION_TYPES.has(entry.action.type))
    .filter((entry) => {
      const key = JSON.stringify(entry.action);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => (right.manaValue ?? 0) - (left.manaValue ?? 0));
}

function cardActionMenuEntries(cardId: string): LegalAction[] {
  const entries = cardActionEntriesForCard(cardId);
  const yieldEntries = triggerYieldActionsFor(cardId);
  return [...entries, ...yieldEntries];
}

function cardActionsForCard(cardId: string): LegalAction[] {
  return cardActionEntriesForCard(cardId);
}
function actionForCard(cardId: string): LegalAction | undefined {
  return cardActionsForCard(cardId)[0];
}
function actionNeedsTargetSelection(entry: LegalAction): boolean {
  return Boolean(entry.requiresTarget || entry.requiresTargets?.length);
}
function passAction(): LegalAction | undefined { return view?.legalActions.find((entry) => entry.action.type === "pass"); }

/** Every activation this viewer may take with one permanent, in menu order. */
function activationsFor(instanceId: string): LegalAction[] {
  return (view?.legalActions ?? []).filter((entry) =>
    (entry.action.type === "activate" || entry.action.type === "activate-mana" || entry.action.type === "equip")
      && entry.action.sourceId === instanceId);
}

/** True while the engine is waiting for this viewer to aim a triggered ability. */
function triggerTargetActions(): LegalAction[] {
  return (view?.legalActions ?? []).filter((entry) => entry.action.type === "choose-trigger-target");
}
function isLandCard(card: { type_line: string }): boolean { return /\bLand\b/.test(card.type_line.split("//")[0]!); }
function isChoosingReveal(): boolean { return Boolean(view?.legalActions.some((entry) => entry.action.type === "choose-reveal")); }
function isTargetable(instanceId: string): boolean {
  if (triggerTargetActions().some((entry) =>
    entry.action.type === "choose-trigger-target" && entry.action.target.kind === "permanent" && entry.action.target.instanceId === instanceId)) return true;
  return Boolean(ui.pendingTarget?.options.some((target) => target.kind === "permanent" && target.instanceId === instanceId));
}
function isPlayerTargetable(seat: number): boolean {
  if (triggerTargetActions().some((entry) =>
    entry.action.type === "choose-trigger-target" && entry.action.target.kind === "player" && entry.action.target.seat === seat)) return true;
  return Boolean(ui.pendingTarget?.options.some((target) => target.kind === "player" && target.seat === seat));
}
function isStackTargetable(stackId: string): boolean {
  if (triggerTargetActions().some((entry) =>
    entry.action.type === "choose-trigger-target" && entry.action.target.kind === "spell" && entry.action.target.stackId === stackId)) return true;
  return Boolean(ui.pendingTarget?.options.some((target) => target.kind === "spell" && target.stackId === stackId));
}

/** Every card the viewer can currently see, for preview lookups and log linking. */
function visibleCards(): Map<string, CardView> {
  const index = new Map<string, CardView>();
  for (const player of view?.players ?? []) {
    for (const group of [player.battlefield as readonly CardView[], player.graveyard, player.exile, player.commandZone, player.hand ?? []]) {
      for (const card of group) index.set(card.instance_id, card);
    }
  }
  return index;
}

function chooseTarget(target: Target): void {
  // A triggered ability being aimed is its own pending decision, so it wins
  // over any spell or activation the player had started.
  const trigger = triggerTargetActions().find((entry) =>
    entry.action.type === "choose-trigger-target" && JSON.stringify(entry.action.target) === JSON.stringify(target));
  if (trigger) { ui.pendingTarget = null; void submit(trigger.action); return; }

  const pending = ui.pendingTarget;
  if (!pending) return;
  if (pending.selectedTargets.some((selected) => JSON.stringify(selected) === JSON.stringify(target))) {
    ui.notice = "Ese objetivo ya fue elegido; selecciona otro.";
    render();
    return;
  }
  const action = pending.action.action;
  if (action.type !== "cast" && action.type !== "activate" && action.type !== "equip") return;
  ui.pendingTarget = null;
  if (action.type === "equip") {
    if (target.kind !== "permanent") return;
    void submit({ ...action, targetId: target.instanceId });
    return;
  }
  const selectedTargets = [...pending.selectedTargets, target];
  const nextIndex = pending.targetIndex + 1;
  if (nextIndex < pending.targetKinds.length) {
    const nextKind = pending.targetKinds[nextIndex]!;
    const selected = new Set(selectedTargets.map((candidate) => JSON.stringify(candidate)));
    const options = (view?.targetOptions[nextKind] ?? []).filter((candidate) => !selected.has(JSON.stringify(candidate)));
    if (!options.length) {
      ui.notice = "Ya no hay objetivos legales para completar esta elección.";
      render();
      return;
    }
    ui.pendingTarget = { ...pending, options, selectedTargets, targetIndex: nextIndex };
    ui.notice = `Elige el objetivo ${nextIndex + 1} de ${pending.targetKinds.length}.`;
    render();
    return;
  }
  void submit({ ...action, targets: selectedTargets });
}

function graveyardTargetHtml(): string {
  const options = ui.pendingTarget?.options.filter((target) => target.kind === "graveyard-card") ?? [];
  if (!options.length) return "";
  return `<section class="target-picker decision-overlay" role="dialog" aria-label="Elegir carta del cementerio"><small>Elige una carta del cementerio</small><div class="target-cards">${options.map((target) => {
    if (target.kind !== "graveyard-card") return "";
    const card = seatOf(target.seat)?.graveyard.find((candidate) => candidate.instance_id === target.instanceId);
    if (!card) return "";
    return `<button class="target-card" type="button" data-graveyard-target="${escapeHtml(target.instanceId)}" data-graveyard-seat="${target.seat}">${card.image_normal ? `<img src="${escapeHtml(card.image_normal)}" data-card-name="${escapeHtml(card.name)}" alt="${escapeHtml(card.name)}"/>` : ""}<b>${escapeHtml(card.name)}</b></button>`;
  }).join("")}</div></section>`;
}

/** Starts the target flow for one action, or submits it when it needs no target. */
function runAction(entry: LegalAction, subject: string): void {
  const targetKinds = entry.requiresTargets ?? (entry.requiresTarget ? [entry.requiresTarget] : []);
  if (targetKinds.length && view) {
    const options = view.targetOptions[targetKinds[0]!] ?? [];
    if (!options.length) { ui.notice = `No hay objetivos legales para ${subject}.`; render(); return; }
    ui.pendingTarget = { action: entry, options, targetKinds, selectedTargets: [], targetIndex: 0 };
    ui.notice = targetKinds.length > 1 ? `Elige el objetivo 1 de ${targetKinds.length}.` : `Elige un objetivo para ${subject}.`;
    render();
    return;
  }
  void submit(entry.action);
}

function onCardClick(cardId: string, forcedAction?: LegalAction): void {
  const choices = cardActionMenuEntries(cardId);
  const card = seatOf(view?.viewerSeat ?? -1)?.hand?.find((candidate) => candidate.instance_id === cardId);
  const hasCycleOnly = choices.some((entry) => entry.action.type === "cycle") && !choices.some((entry) => entry.action.type === "cast");
  const hasManaAbility = choices.some((entry) => entry.action.type === "activate-mana");
  const hasYieldToggle = choices.some((entry) => entry.action.type === "toggle-trigger-yield");
  // Never guess between printed modes. This is especially important for
  // hand-based mana abilities (e.g. Simian Spirit Guide): a normal click must
  // open the general menu, where casting and exiling for mana are separate.
  if (!forcedAction && (choices.length > 1 || hasManaAbility || hasYieldToggle || (hasCycleOnly && Boolean(card)))) {
    ui.cardActionMenu = ui.cardActionMenu === cardId ? null : cardId;
    ui.notice = "Elige qué hacer con esta carta.";
    render();
    return;
  }
  const action = forcedAction ?? choices[0];
  if (!action) {
    if (isChoosingReveal()) {
      ui.notice = "Solo puedes elegir una carta compatible para la revelación.";
      render();
      return;
    }
    ui.notice = "Esa carta no tiene una acción legal ahora. Manténla pulsada o usa el botón derecho para ver sus detalles.";
    render();
    return;
  }
  if (action.action.type === "choose-reveal") { void submit(action.action); return; }
  runAction(action, action.label.replace(/^Lanzar /, ""));
}

function undoPendingTarget(): void {
  const pending = ui.pendingTarget;
  if (!pending || !pending.selectedTargets.length) return;
  const selectedTargets = pending.selectedTargets.slice(0, -1);
  const targetIndex = selectedTargets.length;
  const targetKind = pending.targetKinds[targetIndex];
  const selected = new Set(selectedTargets.map((candidate) => JSON.stringify(candidate)));
  ui.pendingTarget = {
    ...pending,
    selectedTargets,
    targetIndex,
    options: (view?.targetOptions[targetKind!] ?? []).filter((candidate) => !selected.has(JSON.stringify(candidate)))
  };
  ui.notice = `Elige el objetivo ${targetIndex + 1} de ${pending.targetKinds.length}.`;
  render();
}
function triggerYieldActionsFor(instanceId: string): LegalAction[] {
  return (view?.legalActions ?? []).filter((entry) =>
    entry.action.type === "toggle-trigger-yield" && entry.action.sourceId === instanceId);
}

function openCardActionMenu(cardId: string): void {
  ui.cardActionMenu = cardId;
  ui.notice = "Elige una acción o consulta la información de la carta.";
  render();
}

function updateCardDrag(event: PointerEvent): void {
  if (!cardDrag || cardDrag.pointerId !== event.pointerId) return;
  const distance = Math.hypot(event.clientX - cardDrag.startX, event.clientY - cardDrag.startY);
  if (!cardDrag.moved && distance < 7) return;
  if (!cardDrag.moved) {
    cardDrag.moved = true;
    if (cardDrag.longPressTimer !== null) {
      window.clearTimeout(cardDrag.longPressTimer);
      cardDrag.longPressTimer = null;
    }
    cardDrag.ghost = cardDrag.button.cloneNode(true) as HTMLButtonElement;
    cardDrag.ghost.classList.add("drag-ghost");
    document.body.append(cardDrag.ghost);
    document.body.classList.add("dragging-card");
    cardDrag.button.classList.add("drag-source");
  }
  event.preventDefault();
  const tiltX = Math.max(-12, Math.min(12, (event.clientY - cardDrag.startY) * -0.08));
  const tiltY = Math.max(-14, Math.min(14, (event.clientX - cardDrag.startX) * 0.08));
  cardDrag.ghost!.style.left = `${event.clientX}px`;
  cardDrag.ghost!.style.top = `${event.clientY}px`;
  cardDrag.ghost!.style.transform = `translate3d(-50%, -72%, 0) rotateX(${tiltX}deg) rotateY(${tiltY}deg) rotateZ(${tiltY * .18}deg)`;
}

function endCardDrag(event: PointerEvent): void {
  if (!cardDrag || cardDrag.pointerId !== event.pointerId) return;
  const drag = cardDrag;
  cardDrag = null;
  if (drag.longPressTimer !== null) window.clearTimeout(drag.longPressTimer);
  if (drag.button.hasPointerCapture(event.pointerId)) drag.button.releasePointerCapture(event.pointerId);
  const droppedOnBoard = drag.moved && Boolean(document.elementFromPoint(event.clientX, event.clientY)?.closest(".self-board"));
  drag.ghost?.remove();
  drag.button.classList.remove("drag-source");
  document.body.classList.remove("dragging-card");
  if (drag.moved || drag.longPressed) suppressNextCardClick = true;
  if (droppedOnBoard) onCardClick(drag.cardId);
}

function wireCardDrag(button: HTMLButtonElement): void {
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || ui.busy) return;
    const cardId = button.dataset.hand!;
    cardDrag = {
      cardId, button, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      ghost: null, moved: false, longPressed: false, longPressTimer: window.setTimeout(() => {
        if (!cardDrag || cardDrag.pointerId !== event.pointerId || cardDrag.moved || ui.busy) return;
        cardDrag.longPressed = true;
        openCardActionMenu(cardId);
      }, 520)
    };
    button.setPointerCapture(event.pointerId);
  });
  button.addEventListener("pointermove", updateCardDrag);
  button.addEventListener("pointerup", endCardDrag);
  button.addEventListener("pointercancel", endCardDrag);
  button.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    if (cardDrag?.button === button) {
      cardDrag.longPressed = true;
      if (cardDrag.longPressTimer !== null) window.clearTimeout(cardDrag.longPressTimer);
    }
    openCardActionMenu(button.dataset.hand!);
  });
}

function endCardDetailPress(event: PointerEvent): void {
  if (!cardDetailPress || cardDetailPress.pointerId !== event.pointerId) return;
  const press = cardDetailPress;
  cardDetailPress = null;
  if (press.timer !== null) window.clearTimeout(press.timer);
  if (press.button.hasPointerCapture(event.pointerId)) press.button.releasePointerCapture(event.pointerId);
  if (press.longPressed) suppressNextPermanentClick = true;
}

function wirePermanentPress(button: HTMLButtonElement): void {
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || ui.busy) return;
    const cardId = button.dataset.permanent!;
    cardDetailPress = {
      cardId, button, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      longPressed: false, timer: window.setTimeout(() => {
        if (!cardDetailPress || cardDetailPress.pointerId !== event.pointerId) return;
        cardDetailPress.longPressed = true;
        openCardActionMenu(cardId);
      }, 520)
    };
    button.setPointerCapture(event.pointerId);
  });
  button.addEventListener("pointermove", (event) => {
    if (!cardDetailPress || cardDetailPress.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - cardDetailPress.startX, event.clientY - cardDetailPress.startY) >= 7 && cardDetailPress.timer !== null) {
      window.clearTimeout(cardDetailPress.timer);
      cardDetailPress.timer = null;
    }
  });
  button.addEventListener("pointerup", endCardDetailPress);
  button.addEventListener("pointercancel", endCardDetailPress);
  button.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    if (cardDetailPress?.button === button) {
      cardDetailPress.longPressed = true;
      if (cardDetailPress.timer !== null) window.clearTimeout(cardDetailPress.timer);
    }
    openCardActionMenu(button.dataset.permanent!);
  });
}

function toggleAttacker(instanceId: string): void {
  if (!view) return;
  if (ui.attackers.has(instanceId)) ui.attackers.delete(instanceId);
  else {
    const opponents = view.players.filter((player) => player.seat !== view!.viewerSeat && !player.lost);
    const weakest = [...opponents].sort((left, right) => left.life - right.life || left.seat - right.seat)[0];
    if (weakest) ui.attackers.set(instanceId, weakest.seat);
  }
  render();
}

function cycleDefender(instanceId: string): void {
  if (!view) return;
  const opponents = view.players.filter((player) => player.seat !== view!.viewerSeat && !player.lost).map((player) => player.seat);
  const current = ui.attackers.get(instanceId);
  if (current === undefined || opponents.length < 2) return;
  ui.attackers.set(instanceId, opponents[(opponents.indexOf(current) + 1) % opponents.length]!);
  render();
}

function assignBlock(attackerId: string): void {
  if (!ui.selectedBlocker) { ui.notice = "Primero elige una de tus criaturas para bloquear."; render(); return; }
  ui.blockers.set(ui.selectedBlocker, attackerId);
  ui.selectedBlocker = null;
  render();
}

function onPermanentClick(instanceId: string): void {
  if (!view) return;
  if (isTargetable(instanceId)) { chooseTarget({ kind: "permanent", instanceId }); return; }
  if (view.combat.awaitingAttackers && view.selectableAttackers.includes(instanceId)) { toggleAttacker(instanceId); return; }
  if (view.combat.awaitingBlockersFrom.includes(view.viewerSeat)) {
    if (view.selectableBlockers.includes(instanceId)) {
      if (ui.blockers.has(instanceId)) { ui.blockers.delete(instanceId); ui.selectedBlocker = null; }
      else ui.selectedBlocker = ui.selectedBlocker === instanceId ? null : instanceId;
      render();
      return;
    }
    if (view.combat.attackers.some((entry) => entry.instanceId === instanceId)) { assignBlock(instanceId); return; }
  }

  const activations = activationsFor(instanceId);
  // Every battlefield click now opens the same general menu as hand cards.
  // A single activation is still available there, but never fires implicitly:
  // Simian Spirit Guide-like cards and modal permanents must not guess intent.
  if (activations.length || visibleCards().has(instanceId)) openCardActionMenu(instanceId);
  else { ui.notice = "Ese permanente no tiene una acción legal ahora."; render(); }
}

/** The floating list of activations for one permanent. */
function abilityMenuHtml(): string {
  if (!ui.abilityMenu) return "";
  const entries = activationsFor(ui.abilityMenu);
  if (!entries.length) return "";
  const owner = view?.players.flatMap((player) => player.battlefield).find((permanent) => permanent.instance_id === ui.abilityMenu);
  return `<div class="ability-menu" role="dialog" aria-label="Habilidades de ${escapeHtml(owner?.name ?? "permanente")}">
    <div class="ability-menu-head"><b>${escapeHtml(owner?.name ?? "Permanente")}</b>
      <button class="close" type="button" id="close-ability-menu" aria-label="Cerrar">×</button></div>
    ${entries.map((entry) => {
      const index = view!.legalActions.indexOf(entry);
      const glyph = entry.action.type === "activate-mana" ? ACTIVATION_GLYPHS.mana : ACTIVATION_GLYPHS.activated;
      const manaTokens = entry.action.type === "activate-mana" ? (entry.label.match(/\{[^}]+\}/g) ?? []).join("") : "";
      const actionLabel = entry.action.type === "activate-mana"
        ? entry.label.replace(/^[^:]+:\s*/, "").replace(/\s*(?:\{[^}]+\})+\s*$/, "").trim()
        : entry.label.replace(/^[^:]+:\s*/, "");
      return `<button class="ability-row" type="button" data-action-index="${index}" title="${escapeHtml(entry.note ?? "")}">
        <span class="ability-glyph">${glyphSvg(glyph, 16)}</span>
        <span class="ability-label">${escapeHtml(actionLabel)}${manaTokens ? ` ${manaHtml(manaTokens)}` : ""}</span></button>`;
    }).join("")}
  </div>`;
}

/** The help card behind every icon: the printed rule and what the engine does. */
function glyphHelpHtml(): string {
  const glyph = ui.glyphHelp;
  if (!glyph) return "";
  return `<div class="glyph-help" role="dialog" aria-label="${escapeHtml(glyph.label)}">
    <div class="glyph-help-head"><span class="ability-glyph">${glyphSvg(glyph, 20)}</span><b>${escapeHtml(glyph.label)}</b>
      <button class="close" type="button" id="close-glyph-help" aria-label="Cerrar">×</button></div>
    <p class="glyph-rule">${escapeHtml(glyph.rule)}</p>
    <p class="glyph-enforced"><b>En este motor:</b> ${escapeHtml(glyph.enforced)}</p>
  </div>`;
}

/** The keyword and ability icons shown on a card face. */
function abilityIconsHtml(permanent: PermanentView): string {
  const icons: string[] = [];
  for (const keyword of permanent.keywords) {
    const glyph = keywordGlyph(keyword);
    if (glyph) icons.push(`<i class="ability-icon" data-glyph="keyword:${escapeHtml(keyword)}" title="${escapeHtml(glyph.label)}">${glyphSvg(glyph)}</i>`);
  }
  const seen = new Set<string>();
  for (const ability of permanent.abilities as readonly AbilityView[]) {
    const key = ability.kind === "triggered" ? `trigger:${ability.event}` : `activation:${ability.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const glyph = ability.kind === "triggered"
      ? (ability.event ? TRIGGER_GLYPHS[ability.event] : undefined)
      : ACTIVATION_GLYPHS[ability.kind];
    if (!glyph) continue;
    const live = ability.kind !== "triggered" && permanent.abilities.some((candidate) => candidate.kind === ability.kind && candidate.available);
    icons.push(`<i class="ability-icon${live ? " live" : ""}" data-glyph="${escapeHtml(key)}" title="${escapeHtml(glyph.label)}">${glyphSvg(glyph)}</i>`);
  }
  return icons.length ? `<span class="ability-icons">${icons.join("")}</span>` : "";
}

// ---------------------------------------------------------------------------
// Rendering: cards
// ---------------------------------------------------------------------------

function tileHtml(permanent: PermanentView, own: boolean): string {
  const classes = ["card-tile"];
  if (permanent.tapped) classes.push("tapped");
  if (permanent.attacking !== null) classes.push("attacking");
  if (permanent.blocking) classes.push("blocking");
  if (permanent.isCommander) classes.push("is-commander");
  if (permanent.isToken) classes.push("token-tile");
  if (isTargetable(permanent.instance_id)) classes.push("targetable");
  if (own && ui.attackers.has(permanent.instance_id)) classes.push("selected-attacker");
  if (own && ui.selectedBlocker === permanent.instance_id) classes.push("selected-blocker");
  if (own && ui.blockers.has(permanent.instance_id)) classes.push("assigned-blocker");
  if (view?.selectableAttackers.includes(permanent.instance_id)) classes.push("can-attack");
  if (view?.selectableBlockers.includes(permanent.instance_id)) classes.push("can-block");
  const activations = own ? activationsFor(permanent.instance_id) : [];
  if (activations.some((entry) => entry.action.type === "activate" || entry.action.type === "equip")) classes.push("can-activate");
  if (ui.abilityMenu === permanent.instance_id) classes.push("menu-open");

  const stats = hasCreatureStats(permanent)
    ? `<b class="pt">${permanent.power}/${permanent.toughness}${permanent.damage ? `<i> -${permanent.damage}</i>` : ""}</b>` : "";
  const badges = [
    permanent.isCommander ? `<i class="tile-badge cmd" title="Comandante">C</i>` : "",
    permanent.summoningSick ? `<i class="tile-badge sick" title="Mareo de invocación">z</i>` : "",
    permanent.attacking !== null ? `<i class="tile-badge atk" title="Ataca a ${escapeHtml(seatOf(permanent.attacking)?.name ?? "")}">⚔</i>` : "",
    permanent.blocking ? `<i class="tile-badge blk" title="Bloqueando">◈</i>` : "",
    permanent.attachedToPlayer !== undefined ? `<i class="tile-badge aura" title="Encanta a ${escapeHtml(seatOf(permanent.attachedToPlayer)?.name ?? "jugador")}">A</i>` : "",
    permanent.producesMana && !permanent.tapped ? `<i class="tile-badge mana" title="Puede producir maná">◇</i>` : ""
  ].join("");
  const icons = abilityIconsHtml(permanent);

  return `<button class="${classes.join(" ")}" type="button" data-permanent="${escapeHtml(permanent.instance_id)}"
    data-preview="${escapeHtml(permanent.instance_id)}" title="${escapeHtml(permanent.name)}">
    ${permanent.image_art_crop || permanent.image_normal ? `<img src="${escapeHtml(permanent.image_art_crop ?? permanent.image_normal ?? "")}" data-card-name="${escapeHtml(permanent.name)}" alt="${escapeHtml(permanent.name)}" loading="lazy" decoding="async"/>` : ""}<span class="token-placeholder" aria-hidden="true">${permanent.isToken ? "✦" : ""}</span>
    <span class="tile-name">${escapeHtml(permanent.name)}</span>${stats}<span class="tile-badges">${badges}</span>${icons}
  </button>`;
}

/**
 * Splits a battlefield into a land row and a nonland row, laid out the way a
 * paper table reads: lands are always anchored to the lower edge of each
 * player board, while other permanents occupy the combat-facing area.
 */
function boardHtml(player: PlayerView, own: boolean): string {
  const lands = player.battlefield.filter((permanent) => isLandCard(permanent));
  const others = player.battlefield.filter((permanent) => !isLandCard(permanent));
  const sort = (list: readonly PermanentView[]) =>
    [...list].sort((left, right) => Number(right.isCommander) - Number(left.isCommander)
      || (right.power ?? -1) - (left.power ?? -1) || left.name.localeCompare(right.name));
  const nonlandRow = `<div class="board-row">${others.length
    ? sort(others).map((permanent) => tileHtml(permanent, own)).join("")
    : `<p class="board-empty">Sin permanentes</p>`}</div>`;
  const landRow = `<div class="board-row lands">${lands.length
    ? sort(lands).map((permanent) => tileHtml(permanent, own)).join("")
    : `<p class="board-empty">Sin tierras</p>`}</div>`;
  return `${nonlandRow}${landRow}`;
}

function seatPanelHtml(player: PlayerView): string {
  const acting = view?.waitingOn === player.seat;
  const classes = ["seat-panel"];
  if (acting) classes.push("acting");
  if (player.lost) classes.push("eliminated");
  if (isPlayerTargetable(player.seat)) classes.push("targetable-player");
  const commander = player.commandZone[0];
  const cmdDamage = Object.values(player.commanderDamage).filter((amount) => amount > 0);
  const counters = Object.entries(player.counters).filter(([, amount]) => amount > 0);
  return `<article class="${classes.join(" ")}" style="--accent: var(--seat-${player.seat})" aria-label="Campo de ${escapeHtml(player.name)}">
    <header class="seat-head${isPlayerTargetable(player.seat) ? " targetable-player" : ""}" data-target-player="${player.seat}">
      <span class="seat-avatar"${commander?.image_art_crop ? ` style="background-image:url('${escapeHtml(commander.image_art_crop)}')"` : ""}>${escapeHtml(player.name.slice(0, 1))}</span>
      <span class="seat-name"><b>${escapeHtml(player.name)}${view?.activeSeat === player.seat ? `<i class="active-dot" title="Jugador activo"></i>` : ""}</b><span>${escapeHtml(player.deckName)}</span></span>
      <button class="life-chip${player.life <= 10 ? " low" : ""}" type="button" data-target-player="${player.seat}"
        title="${player.lost ? escapeHtml(player.lossReason ?? "Eliminado") : "Vidas"}"><b>${player.lost ? "✕" : player.life}</b><small>vidas</small></button>
      ${counters.map(([kind, amount]) => `<span class="counter-chip" title="Contador ${escapeHtml(kind)}"><b>${amount}</b><small>${escapeHtml(kind)}</small></span>`).join("")}
    </header>
    <section class="seat-board">${boardHtml(player, false)}</section>
    <footer class="commander-strip">
      ${commander ? `<span class="thumb"${commander.image_art_crop ? ` style="background-image:url('${escapeHtml(commander.image_art_crop)}')"` : ""}></span>
        <span class="meta"><b>${escapeHtml(commander.name)}</b><span>Zona de mando</span></span>` : `<span class="meta"><b>—</b><span>Comandante en juego</span></span>`}
      <span class="zone-chips">
        <button class="zone-chip" type="button" data-zone="library" data-seat="${player.seat}" title="Biblioteca">Bib <b>${player.libraryCount}</b></button>
        <button class="zone-chip" type="button" data-zone="hand" data-seat="${player.seat}" title="Mano">Mano <b>${player.handCount}</b></button>
        <button class="zone-chip" type="button" data-zone="graveyard" data-seat="${player.seat}" title="Cementerio">Cem <b>${player.graveyard.length}</b></button>
        <button class="zone-chip" type="button" data-zone="exile" data-seat="${player.seat}" title="Exilio">Exi <b>${player.exile.length}</b></button>
      </span>
      ${cmdDamage.length ? `<span class="cmd-damage" title="Daño de comandante recibido">CMD ${cmdDamage.join("/")}</span>` : ""}
    </footer>
  </article>`;
}

function handHtml(player: PlayerView): string {
  const cards = player.hand ?? [];
  if (!cards.length) return `<p class="hand-empty">Mano vacía</p>`;
  const ordered = [...cards].sort((left, right) =>
    Number(isLandCard(left)) - Number(isLandCard(right)) || left.manaValue - right.manaValue || left.name.localeCompare(right.name));
  return ordered.map((card) => {
    const action = actionForCard(card.instance_id);
    const classes = ["hand-card"];
    const isRevealOption = action?.action.type === "choose-reveal";
    const revealOptions = view?.legalActions.some((entry) => entry.action.type === "choose-reveal" && Boolean(entry.cardId));
    if (action && !isRevealOption) classes.push("playable");
    if (isRevealOption) classes.push("choice-option");
    if (revealOptions && !isRevealOption) classes.push("choice-muted");
    if (!card.fullyImplemented) classes.push("partial");
    return `<button class="${classes.join(" ")}" type="button" data-hand="${escapeHtml(card.instance_id)}"
      data-preview="${escapeHtml(card.instance_id)}" title="${escapeHtml(card.name)}">
      ${card.image_normal ? `<img src="${escapeHtml(card.image_normal)}" data-card-name="${escapeHtml(card.name)}" alt="${escapeHtml(card.name)}" draggable="false" loading="lazy" decoding="async"/>` : ""}
      ${card.mana_cost ? `<span class="hand-cost" aria-label="Coste de maná">${manaHtml(card.mana_cost)}</span>` : ""}
      <span class="tile-name">${escapeHtml(card.name)}</span>
    </button>`;
  }).join("");
}

function combatBarHtml(): string {
  if (!view) return "";
  if (view.combat.awaitingAttackers && view.activeSeat === view.viewerSeat) {
    const chosen = [...ui.attackers.keys()];
    const mine = seatOf(view.viewerSeat);
    const chips = chosen.map((id) => {
      const permanent = mine?.battlefield.find((candidate) => candidate.instance_id === id);
      const defender = seatOf(ui.attackers.get(id)!);
      return `<button type="button" class="chip" data-cycle-defender="${escapeHtml(id)}" title="Clic para cambiar de objetivo">${escapeHtml(permanent?.name ?? "criatura")} → ${escapeHtml(defender?.name ?? "?")}</button>`;
    }).join("");
    return `<div class="combat-bar attackers"><b>Declara atacantes</b>
      <span class="hint">Clic en tus criaturas con borde dorado. Clic en la ficha para cambiar de objetivo.</span>
      <div class="chips">${chips || "<i class='chip'>Ninguno</i>"}</div>
      <button id="confirm-attack" class="primary-button alert">${chosen.length ? `Atacar con ${chosen.length}` : "No atacar"}</button></div>`;
  }
  if (view.combat.awaitingBlockersFrom.includes(view.viewerSeat)) {
    const mine = seatOf(view.viewerSeat);
    const chips = [...ui.blockers.entries()].map(([blocker, attacker]) => {
      const own = mine?.battlefield.find((candidate) => candidate.instance_id === blocker);
      const foe = view!.combat.attackers.find((candidate) => candidate.instanceId === attacker);
      return `<span class="chip">${escapeHtml(own?.name ?? "criatura")} ◈ ${escapeHtml(foe?.name ?? "?")}</span>`;
    }).join("");
    return `<div class="combat-bar blockers"><b>Declara bloqueadores</b>
      <span class="hint">Elige una criatura tuya y luego el atacante que quieres frenar.</span>
      <div class="chips">${chips || "<i class='chip'>Sin bloqueos</i>"}</div>
      <button id="confirm-block" class="primary-button alert">${ui.blockers.size ? `Bloquear con ${ui.blockers.size}` : "No bloquear"}</button></div>`;
  }
  if (view.combat.attackers.length) {
    return `<div class="combat-bar info"><b>En combate</b><div class="chips">${view.combat.attackers.map((entry) => {
      const blockers = view!.combat.blockers.filter((block) => block.attackerId === entry.instanceId).map((block) => block.name);
      return `<span class="chip">${escapeHtml(entry.name)} → ${escapeHtml(seatOf(entry.defender)?.name ?? "?")}${blockers.length ? ` <i>(${escapeHtml(blockers.join(", "))})</i>` : ""}</span>`;
    }).join("")}</div></div>`;
  }
  return "";
}

/** Colours player names and links card names inside a log line. */
function logLineHtml(text: string, cards: Map<string, CardView>): string {
  let html = escapeHtml(text);
  const names = [...new Set([...cards.values()].map((card) => card.name))].sort((left, right) => right.length - left.length);
  for (const name of names.slice(0, 120)) {
    const escaped = escapeHtml(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    html = html.replace(new RegExp(`(?<!<[^>]*)${escaped}`, "g"), `<span class="card-ref" data-card-name="${escapeHtml(name)}">${escapeHtml(name)}</span>`);
  }
  for (const player of view?.players ?? []) {
    const escaped = escapeHtml(player.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    html = html.replace(new RegExp(`(?<!<[^>]*)\\b${escaped}\\b`, "g"), `<span class="who" style="color: var(--seat-${player.seat})">${escapeHtml(player.name)}</span>`);
  }
  return html;
}

function logDrawerHtml(): string {
  const cards = visibleCards();
  return `<aside class="log-drawer${ui.logOpen ? " open" : ""}" aria-label="Registro de la partida">
    <div class="log-head"><h2>Registro</h2><button class="icon-button" id="close-log" type="button" aria-label="Cerrar registro">×</button></div>
    <div class="log-body">${[...(view?.log ?? [])].reverse().map((entry) =>
      `<p class="log-line"><span class="turn">T${entry.turn}</span><span>${logLineHtml(entry.text, cards)}</span></p>`).join("")}</div>
  </aside>`;
}

/** The stack rides just above the hand so it is impossible to miss mid-combat. */
function stackStripHtml(): string {
  if (!view?.stack.length) return "";
  const passed = view.passedSeats.map((seat) => seatOf(seat)?.name ?? `Jugador ${seat + 1}`);
  const priority = view.priorityOpen ? seatOf(view.prioritySeat)?.name : undefined;
  const status = priority
    ? `Prioridad: ${priority}${passed.length ? ` · ${passed.length} pasó${passed.length === 1 ? "" : "aron"}` : ""}`
    : "Sin prioridad abierta";
  const statusDetail = priority
    ? `${status}${passed.length ? ` · Pasaron: ${passed.join(", ")}` : ""}`
    : status;
  return `<div class="stack-strip" aria-label="Pila de hechizos y habilidades" title="${escapeHtml(statusDetail)}"><b>Pila</b><small class="stack-order-hint">Arriba resuelve primero · ${escapeHtml(status)}</small>${[...view.stack].reverse().map((object, index) => {
    const stackPosition = view!.stack.length - index;
    const kind = object.kind === "trigger" ? "habilidad disparada" : object.kind === "activated" ? "habilidad activada" : "hechizo";
    return `<button class="stack-chip${object.countered ? " countered" : ""}${isStackTargetable(object.id) ? " targetable" : ""}${object.resolvesNext ? " resolves-next" : ""}" type="button" data-stack-id="${escapeHtml(object.id)}" title="${escapeHtml(isStackTargetable(object.id) ? "Elegir este objeto como objetivo" : object.targets.length ? `Objetivo: ${object.targets.join(", ")}` : "Inspeccionar objeto de la pila")}" aria-label="Pila ${stackPosition} desde abajo, ${escapeHtml(kind)} ${escapeHtml(object.name)}${object.resolvesNext ? ", próximo en resolver" : ""}">
      <strong class="stack-order" title="${object.resolvesNext ? "Próximo en resolver" : `Posición ${index + 1} desde arriba`}">${object.resolvesNext ? "↑" : index + 1}</strong>
      ${object.image_normal ? `<img src="${escapeHtml(object.image_normal)}" data-card-name="${escapeHtml(object.name)}" alt="${escapeHtml(object.name)}"/>` : ""}
      <span><small class="stack-kind">${escapeHtml(kind)}${object.countered ? " · Contrarrestado" : ""}</small><b>${escapeHtml(object.name)}</b><i style="color: var(--seat-${object.controller})">${escapeHtml(seatOf(object.controller)?.name ?? "")}${object.targets.length ? ` → ${escapeHtml(object.targets.join(", "))}` : ""}</i><small class="stack-label">${escapeHtml(object.label)}${object.text && object.text !== object.label ? ` · ${escapeHtml(object.text)}` : ""}</small></span>
    </button>`;
  }).join("")}</div>`;
}

function stackDetailHtml(): string {
  if (!ui.stackDetail) return "";
  const object = view?.stack.find((entry) => entry.id === ui.stackDetail);
  if (!object) return "";
  const kind = object.kind === "trigger" ? "Habilidad disparada" : object.kind === "activated" ? "Habilidad activada" : "Hechizo";
  return `<section class="decision-overlay stack-detail-overlay" role="dialog" aria-modal="false" aria-label="Detalle de ${escapeHtml(object.name)}">
    <header class="decision-head"><div><b>${escapeHtml(object.name)}</b><span>${kind} · ${escapeHtml(seatOf(object.controller)?.name ?? "")}</span></div>
      <button id="close-stack-detail" class="icon-button" type="button" aria-label="Cerrar detalle de la pila">×</button></header>
    <div class="stack-detail-body">
      ${object.image_normal ? `<img src="${escapeHtml(object.image_normal)}" data-card-name="${escapeHtml(object.name)}" alt="${escapeHtml(object.name)}"/>` : ""}
      <div><b>${escapeHtml(object.label)}</b><p>${escapeHtml(object.text ?? "Sin texto adicional.")}</p>
        <small>${object.targets.length ? `Objetivos: ${escapeHtml(object.targets.join(", "))}` : "Sin objetivos"}${object.countered ? " · Contrarrestado" : ""}</small>
        <span class="stack-detail-hint">Cierra este panel para responder; los objetivos resaltados siguen seleccionables.</span></div>
    </div>
  </section>`;
}

/**
 * Every legal action, as a compact menu inside the dock.
 *
 * Most plays are made by clicking a card, so this stays collapsed and exists for
 * the actions that have no card to click.
 */
function actionMenuHtml(): string {
  const actions = view?.legalActions ?? [];
  const beyondPassing = actions.filter((entry) => entry.action.type !== "pass" && entry.action.type !== "concede");
  if (!actions.length) return "";
  const search = actions.find((entry) => entry.action.type === "choose-library-card");
  const rows = actions.filter((entry) => entry.action.type !== "choose-library-card");
  return `<details class="action-menu"${ui.actionsOpen ? " open" : ""}>
    <summary>Acciones legales <i>${beyondPassing.length}</i></summary>
    <div class="action-list">${search ? `<form class="library-search" id="library-search-form">
      <label for="library-search-query">${escapeHtml(search.label)}</label>
      <div><input id="library-search-query" name="query" autocomplete="off" placeholder="Nombre exacto de la carta" required/><button class="choice-action" type="submit">Buscar</button></div>
      <small>${escapeHtml(search.note ?? "La biblioteca permanece oculta hasta confirmar la elección.")}</small>
    </form>` : ""}${rows.map((entry) => {
      const index = actions.indexOf(entry);
      return `<button class="action-row${entry.action.type === "choose-reveal" || entry.action.type === "choose-trigger" ? " choice-action" : ""}" type="button" data-action-index="${index}" title="${escapeHtml(entry.note ?? "")}">
      <span>${escapeHtml(entry.label)}</span>${entry.manaValue ? `<i>${entry.manaValue}</i>` : ""}</button>`;
    }).join("")}</div>
  </details>`;
}

/** Arena-style choice for a card that has several legal modes (e.g. cast or cycle). */
function cardActionMenuHtml(): string {
  if (!ui.cardActionMenu) return "";
  const card = visibleCards().get(ui.cardActionMenu);
  const entries = cardActionMenuEntries(ui.cardActionMenu);
  if (!card) return "";
  const hasCast = entries.some((entry) => entry.action.type === "cast");
  const unavailableCast = !hasCast && entries.some((entry) => entry.action.type === "cycle")
    ? `<button class="action-row action-disabled" type="button" disabled><span><b>Lanzar ${escapeHtml(card.name)}</b><small>No disponible ahora; puedes ciclarla.</small></span></button>` : "";
  return `<section class="decision-overlay card-action-overlay" role="dialog" aria-modal="false" aria-label="Acciones de ${escapeHtml(card.name)}">
    <header class="decision-head"><div><b>${escapeHtml(card.name)}</b><span>Elige una acción</span></div>
      <button id="close-card-action-menu" class="icon-button" type="button" aria-label="Cerrar acciones">×</button></header>
    <div class="decision-list">${unavailableCast}${entries.map((entry) => {
      const index = view!.legalActions.indexOf(entry);
      const description = entry.action.type === "cycle"
        ? (entry.note ?? "Cicla esta carta, paga su coste y roba una carta.")
        : entry.action.type === "activate-mana"
          ? (entry.note ?? "Activa esta habilidad de maná; la carta se mueve al exilio como coste.")
          : entry.action.type === "toggle-trigger-yield"
            ? (entry.note ?? "Declina automáticamente los triggers opcionales de esta carta; no afecta triggers de otros permanentes.")
            : entry.note ?? entry.label;
      const choiceClass = entry.action.type === "toggle-trigger-yield" ? "choice-action trigger-yield-action" : "choice-action";
      return `<button class="action-row ${choiceClass}" type="button" data-action-index="${index}" title="${escapeHtml(description)}">
        <span><b>${escapeHtml(entry.label)}</b><small>${escapeHtml(description)}</small></span>${entry.manaValue ? `<i>${entry.manaValue}</i>` : ""}</button>`;
    }).join("")}<button id="card-action-info" class="action-row" type="button"><span><b>Ver información</b><small>Texto de reglas, tipo, coste y rulings.</small></span></button></div>
  </section>`;
}

/**
 * Primary decision surface for actions that need an explicit player choice.
 * The dock keeps the compact fallback menu, but the main interaction stays
 * centered so priority responses and pending triggers are not lost below the
 * playmat. Library searches have their own centered surface and are omitted
 * here to avoid presenting the same decision twice.
 */
function decisionOverlayHtml(): string {
  const actions = view?.legalActions ?? [];
  const respondingToStack = Boolean(view?.stack.length);
  const choices = actions.filter((entry) =>
    entry.action.type !== "pass" && entry.action.type !== "concede" && entry.action.type !== "choose-library-card"
      && !["cycle", "play-land", "activate-mana", "toggle-trigger-yield", "declare-attackers", "declare-blockers"].includes(entry.action.type)
      && (respondingToStack || !["cast", "activate", "equip"].includes(entry.action.type)));
  if (!choices.length) return "";
  const hasPendingChoice = choices.some((entry) => entry.action.type.startsWith("choose-"));
  const manaPayment = choices.some((entry) => entry.action.type === "choose-mana-source" || entry.action.type === "cancel-mana-payment");
  const triggerTargetChoice = choices.some((entry) => entry.action.type === "choose-trigger-target");
  const title = manaPayment ? "Elegir fuentes de maná" : triggerTargetChoice ? "Elegir objetivo" : hasPendingChoice ? "Acción requerida" : view?.stack.length ? "Responder a la pila" : "Acciones legales";
  const subtitle = triggerTargetChoice
    ? "Selecciona el permanente, jugador o hechizo marcado en la mesa."
    : hasPendingChoice
    ? (manaPayment ? "Elige qué fuentes girar para pagar; puedes cancelar el lanzamiento." : "Elige una opción para continuar la partida.")
    : view?.stack.length
      ? "Puedes responder ahora o pasar prioridad."
      : "Estas son las acciones disponibles en este momento.";
  return `<section class="decision-overlay" role="dialog" aria-modal="false" aria-label="${escapeHtml(title)}">
    <header class="decision-head"><div><b>${escapeHtml(title)}</b><span>${escapeHtml(subtitle)}</span></div>
      <button id="close-decision-overlay" class="icon-button" type="button" aria-label="Cerrar acciones">×</button></header>
    <div class="decision-list">${choices.map((entry) => {
      const index = actions.indexOf(entry);
      return `<button class="action-row${entry.action.type.startsWith("choose-") ? " choice-action" : ""}" type="button" data-action-index="${index}" title="${escapeHtml(entry.note ?? "")}">
        <span>${escapeHtml(entry.label)}</span>${entry.manaValue ? `<i>${entry.manaValue}</i>` : ""}</button>`;
    }).join("")}${ui.pendingTarget?.selectedTargets.length ? `<button id="undo-pending-target" class="action-row secondary-action" type="button"><span><b>Volver al objetivo anterior</b><small>Cambiar la última selección</small></span></button>` : ""}</div>
  </section>`;
}

function librarySearchHtml(): string {
  const search = view?.librarySearch;
  if (!search) return "";
  const cards = ui.showFullLibrary ? search.allCards : search.candidates;
  const progress = search.destination === "multiple" && search.selectedCount !== undefined && search.maxSelections !== undefined
    ? ` · ${search.selectedCount}/${search.maxSelections}` : "";
  const title = ui.showFullLibrary ? "Mazo completo" : `Objetivos posibles · ${search.candidates.length}${progress}`;
  return `<section class="library-search-overlay" aria-label="Buscar en biblioteca">
    <header><div><b>${escapeHtml(search.sourceName)}</b><span>${escapeHtml(title)}</span></div>
      <button id="toggle-full-library" class="text-button" type="button">${ui.showFullLibrary ? "Ver objetivos" : "Ver todo el mazo"}</button></header>
    <form class="library-search-overlay-form" id="library-search-overlay-form">
      <input id="library-search-overlay-query" name="query" autocomplete="off" placeholder="Nombre exacto o elige una carta" required/>
      <button class="choice-action" type="submit">Buscar</button>
    </form>
    <div class="library-search-cards">${cards.length ? cards.map((card) => `${(() => { const legal = search.candidates.some((candidate) => candidate.instance_id === card.instance_id); return `<button type="button" class="library-card${legal ? " legal" : ""}"${legal ? ` data-library-card="${escapeHtml(card.name)}"` : " disabled"} title="${escapeHtml(card.name)}">`; })()}
      ${card.image_normal ? `<img src="${escapeHtml(card.image_normal)}" data-card-name="${escapeHtml(card.name)}" alt="${escapeHtml(card.name)}" loading="lazy"/>` : ""}<b>${escapeHtml(card.name)}</b><small>${escapeHtml(card.type_line)}</small></button>`).join("") : `<p class="zone-private">No hay cartas que cumplan esta búsqueda.</p>`}</div>
  </section>`;
}

function scryHtml(): string {
  const scry = view?.scry;
  if (!scry) return "";
  const actions = view?.legalActions.filter((entry) => entry.action.type === "choose-scry") ?? [];
  return `<section class="library-search-overlay scry-overlay" aria-label="Scry">
    <header><div><b>${escapeHtml(scry.sourceName)}</b><span>Scry ${scry.topCards.length}</span></div></header>
    <div class="scry-cards">${scry.topCards.map((card) => `<article class="scry-card">
      ${card.image_normal ? `<img src="${escapeHtml(card.image_normal)}" data-card-name="${escapeHtml(card.name)}" alt="${escapeHtml(card.name)}" loading="lazy"/>` : ""}<b>${escapeHtml(card.name)}</b><small>${escapeHtml(card.type_line)}</small>
    </article>`).join("")}</div>
    <div class="scry-actions">${actions.map((entry) => {
      const index = view!.legalActions.indexOf(entry);
      return `<button class="action-row choice-action" type="button" data-action-index="${index}" title="${escapeHtml(entry.note ?? "")}">${escapeHtml(entry.label)}</button>`;
    }).join("")}</div>
  </section>`;
}

function landingHtml(): string {
  return `<main class="shell landing">
    <header class="topbar"><a class="brand" href="#">LAMAGIA</a><span class="turn-readout">Simulador de Commander</span></header>
    <section class="landing-body">
      <h1>Mesa de Commander de cuatro jugadores</h1>
      <p>Controlas el asiento inferior. Los otros tres los juega el bot determinista del motor, eligiendo solo entre las mismas acciones legales que se te ofrecen a ti.</p>
      <div class="landing-actions">
        <button id="start-cedh" class="primary-button">Jugar pod cEDH</button>
        <button id="start-tested" class="text-button">Jugar pod jugable</button>
        <button id="start-precon" class="text-button">Elegir mazo precon</button>
        <button id="open-catalog" class="text-button">Buscar cartas</button>
        <button id="open-coverage" class="text-button">Implementación por edición</button>
      </div>
      <p class="landing-note">${escapeHtml(ui.notice || "El motor resuelve fases, prioridad, maná de todos los colores, la pila, combate y las condiciones de victoria. El texto de reglas complejo todavía no se ejecuta y cada carta lo indica.")}</p>
    </section>
  </main>`;
}

function render(): void {
  if (!view) { root!.innerHTML = landingHtml(); wireLanding(); return; }
  const me = seatOf(view.viewerSeat)!;
  const opponents = view.players.filter((player) => player.seat !== view!.viewerSeat);
  const pass = passAction();
  const myTurn = view.waitingOn === view.viewerSeat;
  const currentIndex = STEP_ORDER.indexOf(view.step);
  const winner = view.finished ? seatOf(view.winnerSeat ?? -1) : undefined;
  const revealChoice = view.legalActions.find((entry) => entry.action.type === "choose-reveal");
  const triggerChoice = view.legalActions.find((entry) => entry.action.type === "choose-trigger");
  const searchChoice = view.legalActions.find((entry) => entry.action.type === "choose-library-card");
  const triggerTargets = triggerTargetActions();
  const handHint = triggerTargets.length
    ? `Elige el objetivo de ${triggerTargets[0]?.note?.split(":")[0] ?? "la habilidad disparada"}.`
    : view.scry
    ? `Mira las ${view.scry.topCards.length} cartas superiores y decide su orden.`
    : searchChoice
    ? "Elige en la biblioteca la carta que quieres poner arriba."
    : triggerChoice
    ? "Elige si quieres resolver la habilidad opcional."
    : revealChoice
    ? (revealChoice.action.type === "choose-reveal" && revealChoice.action.reveal
      ? "Elige en tu mano la carta compatible que quieres revelar."
      : "¿Quieres revelar una Isla o Montaña para que entre enderezada?")
    : (myTurn ? "Las cartas con borde dorado se pueden jugar ahora." : "Esperando a los demás jugadores…");

  root!.innerHTML = `<main class="shell${ui.busy ? " busy" : ""}" data-layout="${ui.layout}">
    <header class="topbar">
      <a class="brand" href="#">LAMAGIA</a>
      <span class="turn-readout"><span class="badge-pill">Turno <b>${view.turn}</b></span>
        <span class="badge-pill accent">${escapeHtml(view.stepLabel)}</span>
        <span>Activo: <b style="color: var(--seat-${view.activeSeat})">${escapeHtml(seatOf(view.activeSeat)?.name ?? "")}</b></span></span>
      <span class="topbar-right">
        <button id="main-menu" class="text-button">Inicio</button>
        <button id="play-tested" class="text-button">Pod jugable</button>
        <button id="new-cedh" class="text-button">Nueva cEDH</button>
        <button id="new-precon" class="text-button">Precons</button>
        <button id="search" class="text-button">Catálogo</button>
        <button id="coverage" class="text-button">Cobertura</button>
        <button id="toggle-layout" class="icon-button${ui.layout === "mobile" ? " on" : ""}" type="button" title="Alternar la disposición táctil de Android" aria-label="Disposición táctil">▭</button>
        <button id="toggle-log" class="icon-button${ui.logOpen ? " on" : ""}" type="button" title="Registro" aria-label="Registro">≡</button>
        <button id="profile" class="profile-avatar" aria-label="Perfil">${selectedAvatar ? `<img src="${escapeHtml(selectedAvatar)}" alt=""/>` : "MP"}</button>
      </span>
    </header>

    <nav class="phase-rail" aria-label="Fases del turno">
      ${STEP_ORDER.map((step, index) => `<span class="phase-step${step === view!.step ? " current" : index < currentIndex ? " done" : ""}">${escapeHtml(STEP_LABELS[step])}</span>`).join("")}
      <span class="spacer"></span>
      <span class="priority-readout"><span class="pulse${myTurn ? "" : " muted"}"></span>Decide: <b style="color: var(--seat-${view.waitingOn ?? 0})">${escapeHtml(seatOf(view.waitingOn ?? -1)?.name ?? "nadie")}</b></span>
    </nav>

    <div class="table">
      <p class="rotate-hint">Gira el dispositivo: la mesa está pensada para horizontal.</p>
      <section class="opponent-row seats-${opponents.length}" aria-label="Campos de los oponentes">${opponents.map(seatPanelHtml).join("")}</section>
      ${combatBarHtml()}
      <section class="self-area" aria-label="Tu campo de batalla">
        <div class="self-board">${boardHtml(me, true)}</div>
        <div class="self-dock">
          <div class="dock-left">
            <div class="self-identity" data-target-player="${me.seat}">
              <span class="seat-avatar" style="border-color: var(--seat-${me.seat})${selectedAvatar ? `;background-image:url('${escapeHtml(selectedAvatar)}')` : ""}">${escapeHtml(me.name.slice(0, 1))}</span>
              <button class="self-life" type="button"><b>${me.lost ? "✕" : me.life}</b><small>vidas</small></button>
              ${Object.entries(me.counters).filter(([, amount]) => amount > 0).map(([kind, amount]) => `<span class="counter-chip" title="Contador ${escapeHtml(kind)}"><b>${amount}</b><small>${escapeHtml(kind)}</small></span>`).join("")}
              <span class="mana-chip" title="Maná que aún puedes producir">◇ <b>${me.availableMana}</b></span>
              <span class="mana-reserve" title="Reserva de maná"><small>Reserva</small>${manaReserveHtml(me.manaPool, me.restrictedMana)}</span>
            </div>
            <div class="self-zones">
              <button class="zone-chip" type="button" data-zone="library" data-seat="${me.seat}"><i>Biblioteca</i><b>${me.libraryCount}</b></button>
              <button class="zone-chip" type="button" data-zone="graveyard" data-seat="${me.seat}"><i>Cementerio</i><b>${me.graveyard.length}</b></button>
              <button class="zone-chip" type="button" data-zone="exile" data-seat="${me.seat}"><i>Exilio</i><b>${me.exile.length}</b></button>
              <button class="zone-chip" type="button" data-zone="command" data-seat="${me.seat}"><i>Mando</i><b>${me.commandZone.length}</b></button>
            </div>
          </div>
          <div class="hand-wrap">
            ${stackStripHtml()}
            <div class="hand-label"><b>Tu mano · ${me.handCount}</b><span class="hint">${escapeHtml(ui.notice || handHint)}</span></div>
            <div class="hand">${handHtml(me)}</div>
          </div>
          <div class="dock-actions">
            ${actionMenuHtml()}
            ${graveyardTargetHtml()}
            ${ui.pendingTarget ? `<button id="cancel-target" class="text-button">Cancelar objetivo</button>` : ""}
            ${view.undoAvailable ? `<button id="undo" class="text-button" title="Deshacer la última activación de maná">Deshacer</button>` : ""}
            <button id="pass" class="primary-button" ${pass ? "" : "disabled"}>${escapeHtml(pass?.label ?? "Sin prioridad")}<kbd>Espacio</kbd></button>
            <label class="toggle"><input id="auto-pass" type="checkbox" ${ui.autoPass ? "checked" : ""}/> Auto-pasar</label>
          </div>
        </div>
      </section>
    </div>
  </main>
    ${librarySearchHtml()}
    ${scryHtml()}
    ${abilityMenuHtml()}
  ${cardActionMenuHtml()}
  ${decisionOverlayHtml()}
  ${stackDetailHtml()}
  ${ui.contextMenu && view.undoAvailable ? `<div class="context-menu" style="left:${ui.contextMenu.x}px;top:${ui.contextMenu.y}px" role="menu">
    <button id="context-undo" type="button">Deshacer última acción de maná</button>
  </div>` : ""}
  ${glyphHelpHtml()}
  ${logDrawerHtml()}
  <div class="card-preview" id="card-preview"></div>
  ${view.finished ? `<div class="winner-banner"><div class="winner-card">
    <h2>${winner ? `${escapeHtml(winner.name)} gana` : "Empate"}</h2>
    <p>Turno ${view.turn}. ${escapeHtml(view.players.filter((player) => player.lost).map((player) => `${player.name}: ${player.lossReason ?? "eliminado"}`).join(" · ") || "")}</p>
    <button id="rematch" class="primary-button">Jugar otra</button></div></div>` : ""}`;

  wireBoard();
}

// ---------------------------------------------------------------------------
// Detail preview
// ---------------------------------------------------------------------------

function showPreview(card: CardView, anchor: HTMLElement): void {
  const panel = document.querySelector<HTMLElement>("#card-preview");
  if (!panel) return;
  const onRightSide = anchor.getBoundingClientRect().left > window.innerWidth * 0.62;
  panel.className = `card-preview visible${onRightSide ? " left" : ""}`;
  panel.innerHTML = `${card.image_normal ? `<img src="${escapeHtml(card.image_normal)}" data-card-name="${escapeHtml(card.name)}" alt="${escapeHtml(card.name)}"/>` : ""}
    <div class="preview-body">
      <div class="preview-type">${escapeHtml(card.type_line)} ${manaHtml(card.mana_cost)}</div>
      ${hasCreatureStats(card) ? `<div class="preview-type">${card.power}/${card.toughness}</div>` : ""}
      <div class="preview-rules">${oracleHtml(card.oracle_text || "Sin texto de reglas.")}</div>
      <div class="preview-cover ${card.fullyImplemented ? "ok" : "partial"}">${card.fullyImplemented
        ? "El motor ejecuta todo el texto de esta carta."
        : "El motor todavía no ejecuta este texto: la carta juega como cuerpo, tipos y palabras clave de combate."}</div>
    </div>`;
}

function hidePreview(): void {
  const panel = document.querySelector<HTMLElement>("#card-preview");
  if (panel) panel.className = "card-preview";
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function wireLanding(): void {
  document.querySelector("#start-cedh")?.addEventListener("click", () => void startMatch("cedh"));
  document.querySelector("#start-tested")?.addEventListener("click", () => void startMatch("tested"));
  document.querySelector("#start-precon")?.addEventListener("click", () => openPrecons());
  document.querySelector("#open-catalog")?.addEventListener("click", () => dialog("catalog")?.showModal());
  document.querySelector("#open-coverage")?.addEventListener("click", () => openCoverage());
}

function wireBoard(): void {
  const on = (selector: string, handler: () => void) => document.querySelector(selector)?.addEventListener("click", handler);
  on("#pass", () => { const action = passAction(); if (action) void submit(action.action); });
  on("#main-menu", returnToMain);
  on("#play-tested", () => void startMatch("tested"));
  on("#new-cedh", () => void startMatch("cedh"));
  on("#rematch", () => void startMatch("cedh"));
  on("#new-precon", () => openPrecons());
  on("#search", () => { dialog("catalog")?.showModal(); document.querySelector<HTMLInputElement>("#card-query")?.focus(); });
  on("#coverage", () => openCoverage());
  on("#profile", () => { dialog("profile-dialog")?.showModal(); void loadAvatars(); });
  on("#cancel-target", () => { ui.pendingTarget = null; ui.notice = ""; render(); });
  on("#close-decision-overlay", () => document.querySelector(".decision-overlay")?.remove());
  on("#undo-pending-target", undoPendingTarget);
  on("#close-card-action-menu", () => { ui.cardActionMenu = null; ui.notice = ""; render(); });
  on("#close-stack-detail", () => { ui.stackDetail = null; render(); });
  on("#card-action-info", () => {
    const cardId = ui.cardActionMenu;
    ui.cardActionMenu = null;
    if (cardId) showCardDetail(cardId);
  });
  on("#undo", () => void undoLatestMana());
  on("#context-undo", () => { ui.contextMenu = null; void undoLatestMana(); });
  document.querySelector<HTMLElement>(".table")?.addEventListener("contextmenu", (event) => {
    if (event.target instanceof Element && event.target.closest("[data-hand], [data-permanent], [data-zone-card]")) return;
    if (!view?.undoAvailable) return;
    event.preventDefault();
    ui.contextMenu = {
      x: Math.min(event.clientX, Math.max(8, window.innerWidth - 250)),
      y: Math.min(event.clientY, Math.max(8, window.innerHeight - 58))
    };
    render();
  });
  document.querySelector<HTMLElement>(".table")?.addEventListener("click", () => {
    if (ui.contextMenu) { ui.contextMenu = null; render(); }
  });
  document.querySelectorAll<HTMLButtonElement>("[data-graveyard-target]").forEach((button) =>
    button.addEventListener("click", () => chooseTarget({ kind: "graveyard-card", seat: Number(button.dataset.graveyardSeat), instanceId: button.dataset.graveyardTarget! })));
  on("#close-ability-menu", () => { ui.abilityMenu = null; render(); });
  on("#close-glyph-help", () => { ui.glyphHelp = null; render(); });
  document.querySelectorAll<HTMLElement>("[data-glyph]").forEach((element) =>
    element.addEventListener("click", (event) => {
      // The icon lives inside the card button, so opening help must not also
      // play the card underneath it.
      event.stopPropagation();
      const [group, key] = element.dataset.glyph!.split(":");
      ui.glyphHelp = group === "keyword" ? KEYWORD_GLYPHS[key ?? ""] ?? null
        : group === "trigger" ? TRIGGER_GLYPHS[(key ?? "") as keyof typeof TRIGGER_GLYPHS] ?? null
        : ACTIVATION_GLYPHS[(key ?? "") as keyof typeof ACTIVATION_GLYPHS] ?? null;
      render();
    }));
  on("#toggle-log", () => { ui.logOpen = !ui.logOpen; window.localStorage.setItem("prossh.log", ui.logOpen ? "1" : "0"); render(); });
  on("#toggle-layout", () => {
    ui.layout = ui.layout === "mobile" ? "auto" : "mobile";
    window.localStorage.setItem("prossh.layout", ui.layout);
    render();
  });
  // Remember whether the action menu was open so a re-render does not close it.
  document.querySelector<HTMLDetailsElement>(".action-menu")?.addEventListener("toggle", (event) => {
    ui.actionsOpen = (event.target as HTMLDetailsElement).open;
  });
  document.querySelectorAll<HTMLFormElement>("#library-search-form, #library-search-overlay-form").forEach((form) => form.addEventListener("submit", (event) => {
    event.preventDefault();
    const search = view?.legalActions.find((entry) => entry.action.type === "choose-library-card");
    const input = form.querySelector<HTMLInputElement>("input[name=query]");
    const query = input?.value.trim();
    if (search?.action.type === "choose-library-card" && query) void submit({ ...search.action, query });
  }));
  on("#toggle-full-library", () => { ui.showFullLibrary = !ui.showFullLibrary; render(); });
  document.querySelectorAll<HTMLElement>("[data-library-card]").forEach((card) => card.addEventListener("click", () => {
    const search = view?.legalActions.find((entry) => entry.action.type === "choose-library-card");
    if (search?.action.type === "choose-library-card") void submit({ ...search.action, query: card.dataset.libraryCard ?? "" });
  }));
  on("#close-log", () => { ui.logOpen = false; window.localStorage.setItem("prossh.log", "0"); render(); });
  on("#confirm-attack", () => void submit({ type: "declare-attackers", attackers: [...ui.attackers.entries()].map(([instanceId, defender]) => ({ instanceId, defender })) }));
  on("#confirm-block", () => void submit({ type: "declare-blockers", blockers: [...ui.blockers.entries()].map(([instanceId, attackerId]) => ({ instanceId, attackerId })) }));

  document.querySelector<HTMLInputElement>("#auto-pass")?.addEventListener("change", (event) =>
    void setAutoPass((event.target as HTMLInputElement).checked));

  document.querySelectorAll<HTMLButtonElement>("[data-hand]").forEach((button) => {
    button.addEventListener("click", () => {
      if (suppressNextCardClick) { suppressNextCardClick = false; return; }
      onCardClick(button.dataset.hand!);
    });
    wireCardDrag(button);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-permanent]").forEach((button) => {
    button.addEventListener("click", () => {
      if (suppressNextPermanentClick) { suppressNextPermanentClick = false; return; }
      onPermanentClick(button.dataset.permanent!);
    });
    wirePermanentPress(button);
  });
  document.querySelectorAll<HTMLElement>("[data-target-player]").forEach((target) =>
    target.addEventListener("click", () => {
      const seat = Number(target.dataset.targetPlayer);
      if (isPlayerTargetable(seat)) chooseTarget({ kind: "player", seat });
    }));
  document.querySelectorAll<HTMLButtonElement>("[data-cycle-defender]").forEach((button) =>
    button.addEventListener("click", () => cycleDefender(button.dataset.cycleDefender!)));
  document.querySelectorAll<HTMLButtonElement>("[data-action-index]").forEach((button) =>
    button.addEventListener("click", () => {
      const entry = view?.legalActions[Number(button.dataset.actionIndex)];
      if (!entry) return;
      if (actionNeedsTargetSelection(entry) && entry.cardId) { onCardClick(entry.cardId, entry); return; }
      void submit(entry.action);
    }));
  document.querySelectorAll<HTMLButtonElement>("[data-stack-id]").forEach((button) =>
    button.addEventListener("click", () => {
      const stackId = button.dataset.stackId!;
      if (isStackTargetable(stackId)) chooseTarget({ kind: "spell", stackId });
      else { ui.stackDetail = stackId; render(); }
    }));
  document.querySelectorAll<HTMLButtonElement>("[data-zone]").forEach((button) =>
    button.addEventListener("click", () => showZone(Number(button.dataset.seat), button.dataset.zone as never)));

  const index = visibleCards();
  // The light hover preview never captures pointer events, so it can coexist
  // with normal click-to-play and drag-to-battlefield interactions.
  document.querySelectorAll<HTMLElement>("[data-preview]").forEach((element) => {
    element.addEventListener("mouseenter", () => {
      const card = index.get(element.dataset.preview!);
      if (card) showPreview(card, element);
    });
    element.addEventListener("mouseleave", hidePreview);
  });
  document.querySelectorAll<HTMLElement>("[data-card-name]").forEach((element) => {
    element.addEventListener("mouseenter", () => {
      const card = [...index.values()].find((candidate) => candidate.name === element.dataset.cardName);
      if (card) showPreview(card, element);
    });
    element.addEventListener("mouseleave", hidePreview);
  });
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

function panelHtml(id: string, title: string, body: string, search?: { label: string; value: string; placeholder: string }): string {
  return `<div class="panel">
    <div class="panel-head"><h2>${escapeHtml(title)}</h2><button class="close" type="button" data-close="${id}" aria-label="Cerrar">×</button></div>
    <div class="panel-body">
      ${search ? `<label class="panel-search">${escapeHtml(search.label)}<input id="${id}-query" value="${escapeHtml(search.value)}" placeholder="${escapeHtml(search.placeholder)}" autocomplete="off"/></label>` : ""}
      ${body}
    </div>
  </div>`;
}

function fillDialog(id: string, html: string): void {
  const element = dialog(id);
  if (!element) return;
  element.innerHTML = html;
  element.querySelectorAll<HTMLButtonElement>("[data-close]").forEach((button) => button.addEventListener("click", () => dialog(button.dataset.close!)?.close()));
  if (!element.open) element.showModal();
}

/** Rulings are the clarifications Wizards publishes, served from the local catalog. */
function rulingsHtml(rulings: readonly CardRuling[] | undefined): string {
  if (!rulings) return `<p class="rulings-loading">Buscando rulings…</p>`;
  if (!rulings.length) return `<p class="rulings-loading">Esta carta no tiene rulings publicados.</p>`;
  return `<div class="rulings"><h3>Rulings oficiales</h3>${rulings.map((ruling) =>
    `<p><i>${escapeHtml(ruling.published_at)}</i>${escapeHtml(ruling.comment)}</p>`).join("")}</div>`;
}

function cardDetailHtml(card: CardView, extra?: CatalogCard): string {
  return `<div class="card-detail">
    ${card.image_normal ? `<img src="${escapeHtml(card.image_normal)}" data-card-name="${escapeHtml(card.name)}" alt="${escapeHtml(card.name)}"/>` : ""}
    <div class="detail-body">
      <div class="detail-type">${escapeHtml(card.type_line)} ${manaHtml(card.mana_cost)}</div>
      ${hasCreatureStats(card) ? `<div class="detail-type stats">${card.power}/${card.toughness}</div>` : ""}
      <div class="oracle-text">${oracleHtml(card.oracle_text || "Sin texto de reglas.")}</div>
      <div class="coverage ${card.fullyImplemented ? "ok" : "partial"}">${card.fullyImplemented
        ? "El motor ejecuta todo el texto impreso de esta carta."
        : "El motor todavía no ejecuta este texto. La carta entra al juego con su cuerpo, tipos y palabras clave de combate."}</div>
      ${extra ? `<div class="detail-type">${escapeHtml(extra.set_name)} · ${escapeHtml(extra.released_at)} · ${escapeHtml(extra.rarity)}${extra.printings ? ` · ${extra.printings} impresiones` : ""}</div>` : ""}
      ${rulingsHtml(extra?.rulings)}
      <a class="external-link" href="https://scryfall.com/card/${escapeHtml(card.scryfall_id)}" target="_blank" rel="noreferrer">Ver la impresión en Scryfall ↗</a>
    </div></div>`;
}

function printingGalleryHtml(card: CatalogCard): string {
  const printings = card.printings_list ?? [];
  if (!printings.length) return "";
  const group = (title: string, entries: CatalogPrinting[]) => entries.length
    ? `<section class="printing-group"><h4>${title}</h4><div class="printings">${entries.map((printing) =>
      `<button class="printing-choice${printing.id === card.id ? " selected" : ""}" type="button" data-printing-id="${escapeHtml(printing.id)}" title="${escapeHtml(printing.set_name)}">
        ${printing.image_normal ? `<img src="${escapeHtml(printing.image_normal)}" data-card-name="${escapeHtml(card.name)}" alt="${escapeHtml(card.name)}" loading="lazy"/>` : ""}
        <span>${escapeHtml(printing.set_code.toUpperCase())} · ${escapeHtml(printing.released_at.slice(0, 4))}</span></button>`).join("")}</div></section>`
    : "";
  return `<section class="printing-gallery"><h3>Galería de impresiones · ${printings.length}</h3>
    ${group("Ediciones principales", printings.filter((printing) => printing.main_set))}
    ${group("Sets especiales y promocionales", printings.filter((printing) => !printing.main_set))}</section>`;
}

function wirePrintingGallery(card: CatalogCard): void {
  const panel = dialog("card-dialog");
  const image = panel?.querySelector<HTMLImageElement>(".gallery-main");
  const meta = panel?.querySelector<HTMLElement>("[data-gallery-meta]");
  panel?.querySelectorAll<HTMLButtonElement>("[data-printing-id]").forEach((button) => button.addEventListener("click", () => {
    const printing = card.printings_list?.find((entry) => entry.id === button.dataset.printingId);
    if (!printing) return;
    if (image && printing.image_normal) image.src = printing.image_normal;
    if (meta) meta.textContent = `${printing.set_name} · ${printing.released_at} · ${printing.rarity}`;
    panel.querySelectorAll(".printing-choice").forEach((choice) => choice.classList.toggle("selected", choice === button));
  }));
}

function showCardDetail(instanceId: string): void {
  const card = visibleCards().get(instanceId);
  if (!card) return;
  fillDialog("card-dialog", panelHtml("card-dialog", card.name, cardDetailHtml(card)));
  // The board projection has no rulings; fetch them for the printing in play.
  void api<CatalogCard>(`/api/catalog/card/${encodeURIComponent(card.scryfall_id)}`)
    .then((extra) => {
      const body = document.querySelector<HTMLElement>("#card-dialog .panel-body");
      if (body && dialog("card-dialog")?.open) body.innerHTML = cardDetailHtml(card, { ...extra, rulings: extra.rulings ?? [] });
    })
    .catch(() => {
      const body = document.querySelector<HTMLElement>("#card-dialog .panel-body");
      if (body && dialog("card-dialog")?.open) body.innerHTML = cardDetailHtml(card, undefined);
    });
}

function showZone(seat: number, zone: "library" | "hand" | "graveyard" | "exile" | "command"): void {
  const player = seatOf(seat);
  if (!player) return;
  const hidden = zone === "library" || (zone === "hand" && seat !== view?.viewerSeat);
  const cards = zone === "graveyard" ? player.graveyard : zone === "exile" ? player.exile
    : zone === "command" ? player.commandZone : zone === "hand" ? (player.hand ?? []) : [];
  const label = { library: "biblioteca", hand: "mano", graveyard: "cementerio", exile: "exilio", command: "zona de mando" }[zone];
  fillDialog("zone-view", panelHtml("zone-view", `${player.name} · ${label}`, hidden
    ? `<p class="zone-private">Zona oculta. El servidor nunca envía estas cartas: solo su conteo (${zone === "library" ? player.libraryCount : player.handCount}).</p>`
    : cards.length
      ? `<div class="zone-cards">${cards.map((card) => `<button class="zone-card" type="button" data-zone-card="${escapeHtml(card.instance_id)}" title="Ver detalles de ${escapeHtml(card.name)}">${card.image_normal ? `<img src="${escapeHtml(card.image_normal)}" data-card-name="${escapeHtml(card.name)}" alt="${escapeHtml(card.name)}"/>` : ""}<b>${escapeHtml(card.name)}</b></button>`).join("")}</div>`
      : `<p class="zone-private">No hay cartas en esta zona.</p>`));
  document.querySelectorAll<HTMLButtonElement>("[data-zone-card]").forEach((button) => {
    button.addEventListener("click", () => showCardDetail(button.dataset.zoneCard!));
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      openCardActionMenu(button.dataset.zoneCard!);
    });
  });
}

// ---------------------------------------------------------------------------
// Precon browser and card catalog
// ---------------------------------------------------------------------------

let preconQuery = "";
let preconLimit = 48;

function openPrecons(): void {
  preconLimit = 48;
  fillDialog("precon-dialog", panelHtml("precon-dialog", "Mazos precon de Commander",
    `<p class="panel-note">Ediciones principales primero, ordenadas por lanzamiento. Las variantes Collector no aparecen aquí; las impresiones de cartas siguen documentadas en el catálogo.</p><div id="precon-results">Cargando…</div>`,
    { label: "Buscar mazo, comandante o producto", value: preconQuery, placeholder: "Ej. Ghave, 40K, Commander 2014" }));
  const input = document.querySelector<HTMLInputElement>("#precon-dialog-query");
  input?.addEventListener("input", () => { preconQuery = input.value; preconLimit = 48; void loadPrecons(preconQuery); });
  input?.focus();
  void loadPrecons(preconQuery);
}

async function loadPrecons(query = ""): Promise<void> {
  const container = document.querySelector<HTMLElement>("#precon-results");
  if (!container) return;
  try {
    const payload = await api<{ groups?: PreconGroup[]; total?: number; offset?: number; hasMore?: boolean }>(`/api/decks/precons?grouped=1&limit=${preconLimit}&q=${encodeURIComponent(query)}`);
    const groups = payload.groups ?? [];
    container.innerHTML = groups.length
      ? groups.map((group) => `<section class="set-group">
          <div class="set-group-head">${group.set_icon_uri ? `<img src="${escapeHtml(group.set_icon_uri)}" alt=""/>` : ""}
            <b>${escapeHtml(group.set_name)}</b><small>${escapeHtml(group.released_at.slice(0, 4))} · ${group.decks.length} mazo(s)</small></div>
          <div class="deck-grid">${group.decks.map((deck) => `<button class="deck-card" type="button" data-precon="${escapeHtml(deck.id)}">
            ${deck.cover_art_uri ? `<img src="${escapeHtml(deck.cover_art_uri)}" alt="" loading="lazy"/>` : ""}
            <span class="deck-meta"><b>${escapeHtml(deck.name)}</b><small>${escapeHtml(deck.commanders.join(" / "))}</small></span></button>`).join("")}</div>
        </section>`).join("")
      : "<p class='zone-private'>Sin resultados.</p>";
    if (groups.length && payload.hasMore) {
      container.insertAdjacentHTML("beforeend", `<button type="button" class="load-more" id="load-more-precons">Mostrar más mazos</button>`);
      container.querySelector<HTMLButtonElement>("#load-more-precons")?.addEventListener("click", () => { preconLimit += 48; void loadPrecons(query); });
    }
    container.querySelectorAll<HTMLButtonElement>("[data-precon]").forEach((button) =>
      button.addEventListener("click", () => { dialog("precon-dialog")?.close(); void startMatch("precon", button.dataset.precon!); }));
  } catch (error) {
    container.innerHTML = `<p class="zone-private">${escapeHtml(error instanceof Error ? error.message : "No se pudieron cargar los precons.")}</p>`;
  }
}

async function searchCards(query: string): Promise<void> {
  const container = document.querySelector<HTMLDivElement>("#catalog-results");
  if (!container) return;
  if (query.trim().length < 2) { container.innerHTML = "<p class='zone-private'>Escribe al menos dos caracteres.</p>"; return; }
  container.innerHTML = "<p class='zone-private'>Consultando catálogo…</p>";
  try {
    const payload = await api<{ data?: CatalogCard[] }>(`/api/catalog/search?q=${encodeURIComponent(query)}`);
    const cards = payload.data ?? [];
    container.innerHTML = cards.length
      ? `<div class="result-grid">${cards.map((card) => `<button class="result-card" type="button" data-card-id="${escapeHtml(card.id)}">
          ${card.image_uris.normal ? `<img src="${escapeHtml(card.image_uris.normal)}" alt="" loading="lazy"/>` : ""}
          <b>${escapeHtml(card.name)}</b><small>${escapeHtml(card.type_line)}</small>
          <small>${escapeHtml(card.set_name)} · ${escapeHtml(card.released_at.slice(0, 4))}</small>
          ${card.printings && card.printings > 1 ? `<span class="prints">${card.printings} impresiones</span>` : ""}
        </button>`).join("")}</div>`
      : "<p class='zone-private'>Sin resultados.</p>";
    container.querySelectorAll<HTMLButtonElement>("[data-card-id]").forEach((button) =>
      button.addEventListener("click", () => void showCatalogCard(button.dataset.cardId!)));
  } catch { container.innerHTML = "<p class='zone-private'>No se pudo conectar al catálogo. Inicia el servidor local.</p>"; }
}

/** Opens the internal card page. Scryfall stays a deliberate opt-in link. */
async function showCatalogCard(id: string): Promise<void> {
  try {
    const card = await api<CatalogCard>(`/api/catalog/card/${encodeURIComponent(id)}`);
    fillDialog("card-dialog", panelHtml("card-dialog", card.name, `<div class="card-detail">
      ${card.image_uris.normal ? `<img class="gallery-main" src="${escapeHtml(card.image_uris.normal)}" alt="${escapeHtml(card.name)}"/>` : ""}
      <div class="detail-body">
        <div class="detail-type">${escapeHtml(card.type_line)} ${manaHtml(card.mana_cost)}</div>
        ${hasCreatureStats(card) ? `<div class="detail-type stats">${escapeHtml(card.power ?? "")}/${escapeHtml(card.toughness ?? "")}</div>` : ""}
        <div class="oracle-text">${oracleHtml(card.oracle_text || "Sin texto de reglas.")}</div>
        <div class="detail-type" data-gallery-meta>${escapeHtml(card.set_name)} · ${escapeHtml(card.released_at)} · ${escapeHtml(card.rarity)}</div>
        ${printingGalleryHtml(card)}
        ${rulingsHtml(card.rulings ?? [])}
        <a class="external-link" href="${escapeHtml(card.scryfall_uri)}" target="_blank" rel="noreferrer">Ver en Scryfall ↗</a>
      </div></div>`));
    wirePrintingGallery(card);
  } catch (error) { ui.notice = error instanceof Error ? error.message : "No se pudo abrir la carta."; render(); }
}

const COVERAGE_LABELS: Record<string, string> = { all: "Todas", main: "Principales", commander: "Commander", "secret-lair": "Secret Lair", other: "Otras" };
const COVERAGE_GROUP_LABELS: Record<string, string> = {
  "all": "Todos los grupos", "jumpstart": "Jumpstart", "duel-decks": "Duel Decks", "masters-remastered": "Masters / Remastered",
  "planechase": "Planechase", "conspiracy": "Conspiracy", "starter": "Starter", "premium-decks": "Premium Decks",
  "spellbooks": "Spellbooks", "anthologies": "Anthologies", "secret-lair": "Secret Lair", "promos": "Promos",
  "funny-special": "Un / especiales", "alchemy": "Alchemy", "commander": "Commander", "deck-products": "Deck products",
  "boxed-products": "Boxed products", "supplemental": "Supplemental", "masterpieces": "Masterpieces", "eternal": "Eternal",
  "core": "Core sets", "expansion": "Expansion sets", "from-the-vault": "From the Vault", "archenemy": "Archenemy", "treasure-chest": "Treasure Chests",
  "promos-fnm": "Promos · FNM", "promos-judge": "Promos · Judge", "promos-wpn": "Promos · WPN", "promos-magicfest": "Promos · MagicFest",
  "promos-regional": "Promos · Regional", "promos-comic-con": "Promos · Comic-Con", "promos-standard-showdown": "Promos · Standard Showdown",
  "promos-player-rewards": "Promos · Player Rewards", "promos-arena": "Promos · Arena", "promos-lgs": "Promos · Love Your LGS",
  "promos-guru": "Promos · Guru", "promos-championship": "Promos · Championship", "promos-junior": "Promos · Junior",
  "promos-set": "Promos de set", "promos-other": "Otras promos", "other": "Otros"
};

function coverageGroupLabel(group: string): string {
  return COVERAGE_GROUP_LABELS[group] ?? group.replace(/-/g, " ");
}

function coverageSubgroupLabel(group: string, subgroup: string): string {
  if (subgroup === "all") return "Todos los subgrupos";
  const promo = /^(fnm|judge|wpn|magicfest|regional|comic-con|standard-showdown|player-rewards|arena|lgs|guru|championship|junior)-(\d{4})$/.exec(subgroup);
  if (group === "promos" && promo) {
    const labels: Record<string, string> = { fnm: "FNM", judge: "Judge", wpn: "WPN", magicfest: "MagicFest", regional: "Regional", "comic-con": "Comic-Con", "standard-showdown": "Standard Showdown", "player-rewards": "Player Rewards", arena: "Arena", lgs: "Love Your LGS", guru: "Guru", championship: "Championship", junior: "Junior" };
    return `${labels[promo[1]!] ?? promo[1]} · ${promo[2]}`;
  }
  if (group === "commander" && /^\d{4}$/.test(subgroup)) return `Commander ${subgroup}`;
  return subgroup.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function coverageSetRows(sets: readonly CoverageSet[]): string {
  return sets.length ? sets.map((set) => {
    const percentage = Math.max(0, Math.min(100, set.percentage));
    return `<button class="coverage-row" type="button" data-coverage-set="${escapeHtml(set.code)}">
      <span class="coverage-row-title"><b>${escapeHtml(set.name)}</b><small>${escapeHtml(set.code.toUpperCase())} · ${escapeHtml(set.releasedAt.slice(0, 4) || "—")} · ${escapeHtml(coverageGroupLabel(set.group))} / ${escapeHtml(coverageSubgroupLabel(set.group, set.subgroup))}</small></span>
      <span class="coverage-track"><i style="width:${percentage}%"></i></span>
      <span class="coverage-number"><b>${percentage}%</b><small>${set.implemented}/${set.uniqueCards}</small></span>
    </button>`;
  }).join("") : `<p class="zone-private">No hay ediciones para este filtro.</p>`;
}

function coverageSubgroupRows(sets: readonly CoverageSet[]): string {
  const buckets = new Map<string, { group: string; subgroup: string; firstReleasedAt: string; editions: number; uniqueCards: number; implemented: number }>();
  for (const set of sets) {
    const key = `${set.group}\u0000${set.subgroup}`;
    const bucket = buckets.get(key) ?? { group: set.group, subgroup: set.subgroup, firstReleasedAt: set.releasedAt || "9999-99-99", editions: 0, uniqueCards: 0, implemented: 0 };
    if ((set.releasedAt || "9999-99-99") < bucket.firstReleasedAt) bucket.firstReleasedAt = set.releasedAt || "9999-99-99";
    bucket.editions += 1;
    bucket.uniqueCards += set.uniqueCards;
    bucket.implemented += set.implemented;
    buckets.set(key, bucket);
  }
  // Keep the same Alpha -> newest chronology as the edition list. Alphabetical
  // sorting made Commander years, promo families and historical blocks appear
  // unrelated when several top-level groups were visible at once.
  const rows = [...buckets.values()].sort((left, right) => left.firstReleasedAt.localeCompare(right.firstReleasedAt)
    || coverageGroupLabel(left.group).localeCompare(coverageGroupLabel(right.group))
    || left.subgroup.localeCompare(right.subgroup));
  return rows.length ? rows.map((bucket) => {
    const percentage = bucket.uniqueCards ? Math.round(bucket.implemented / bucket.uniqueCards * 1000) / 10 : 100;
    return `<button class="coverage-subgroup-row" type="button" data-coverage-subgroup="${escapeHtml(bucket.subgroup)}" data-coverage-subgroup-group="${escapeHtml(bucket.group)}">
      <span class="coverage-row-title"><b>${escapeHtml(coverageSubgroupLabel(bucket.group, bucket.subgroup))}</b><small>${escapeHtml(coverageGroupLabel(bucket.group))} · ${bucket.editions} ediciones</small></span>
      <span class="coverage-track"><i style="width:${percentage}%"></i></span>
      <span class="coverage-number"><b>${percentage}%</b><small>${bucket.implemented}/${bucket.uniqueCards}</small></span>
    </button>`;
  }).join("") : `<p class="zone-private">No hay subgrupos para este filtro.</p>`;
}

function coverageChronology<T extends { releasedAt: string }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => (left.releasedAt || "9999-99-99").localeCompare(right.releasedAt || "9999-99-99"));
}

function coverageGroupOptions(sets: readonly CoverageSet[]): string[] {
  const firstRelease = new Map<string, string>();
  for (const set of sets) {
    const date = set.releasedAt || "9999-99-99";
    if (!firstRelease.has(set.group) || date < firstRelease.get(set.group)!) firstRelease.set(set.group, date);
  }
  return [...firstRelease.keys()].sort((left, right) => firstRelease.get(left)!.localeCompare(firstRelease.get(right)!)
    || coverageGroupLabel(left).localeCompare(coverageGroupLabel(right)));
}

function coverageSubgroupOptions(sets: readonly CoverageSet[], group: string): string[] {
  const firstRelease = new Map<string, string>();
  for (const set of sets) {
    if (group !== "all" && set.group !== group) continue;
    const date = set.releasedAt || "9999-99-99";
    if (!firstRelease.has(set.subgroup) || date < firstRelease.get(set.subgroup)!) firstRelease.set(set.subgroup, date);
  }
  return [...firstRelease.keys()].sort((left, right) => firstRelease.get(left)!.localeCompare(firstRelease.get(right)!) || left.localeCompare(right));
}

function coverageResultsHtml(report: SetCoverageReport): string {
  const filtered = report.sets.filter((set) => (coverageFilter === "all" || set.category === coverageFilter)
    && (coverageGroup === "all" || set.group === coverageGroup)
    && (coverageSubgroup === "all" || set.subgroup === coverageSubgroup)
    && (!coverageQuery || `${set.name} ${set.code}`.toLocaleLowerCase().includes(coverageQuery.toLocaleLowerCase())));
  const subgroupSource = report.sets.filter((set) => (coverageFilter === "all" || set.category === coverageFilter)
    && (coverageGroup === "all" || set.group === coverageGroup)
    && (!coverageQuery || `${set.name} ${set.code}`.toLocaleLowerCase().includes(coverageQuery.toLocaleLowerCase())));
  return `<div class="coverage-subgroups"><h3>Subgrupos${coverageGroup === "all" ? " · orden cronológico" : ` · ${escapeHtml(coverageGroupLabel(coverageGroup))}`}</h3><div class="coverage-list">${coverageSubgroupRows(subgroupSource)}</div></div>
    <div class="coverage-list">${coverageSetRows(coverageChronology(filtered))}</div>`;
}

function wireCoverageResults(body: HTMLElement, report: SetCoverageReport): void {
  body.querySelectorAll<HTMLButtonElement>("[data-coverage-subgroup]").forEach((button) => button.addEventListener("click", () => {
    coverageGroup = button.dataset.coverageSubgroupGroup ?? "all";
    coverageSubgroup = button.dataset.coverageSubgroup ?? "all";
    renderCoverageReport(report);
  }));
  body.querySelectorAll<HTMLButtonElement>("[data-coverage-set]").forEach((button) => button.addEventListener("click", () => void loadCoverageSet(button.dataset.coverageSet!)));
}

function renderCoverageReport(report: SetCoverageReport): void {
  const body = document.querySelector<HTMLElement>("#coverage-dialog .panel-body");
  if (!body) return;
  const groups = coverageGroupOptions(report.sets);
  const subgroups = coverageSubgroupOptions(report.sets, coverageGroup);
  const excluded = report.excludedEditions?.length ? ` · ${report.excludedEditions.length} ediciones pausadas (Alchemy y Un-)` : "";
  body.innerHTML = `<div class="coverage-toolbar">
      <div class="coverage-filters">${(["all", "main", "commander", "secret-lair", "other"] as const).map((category) =>
        `<button type="button" class="text-button${coverageFilter === category ? " selected" : ""}" data-coverage-filter="${category}">${COVERAGE_LABELS[category]}</button>`).join("")}</div>
      <select id="coverage-group" aria-label="Grupo de edición"><option value="all">Todos los grupos</option>${groups.map((group) => `<option value="${escapeHtml(group)}"${coverageGroup === group ? " selected" : ""}>${escapeHtml(coverageGroupLabel(group))}</option>`).join("")}</select>
      <select id="coverage-subgroup" aria-label="Subgrupo de edición"><option value="all">Todos los subgrupos</option>${subgroups.map((subgroup) => `<option value="${escapeHtml(subgroup)}"${coverageSubgroup === subgroup ? " selected" : ""}>${escapeHtml(coverageSubgroupLabel(coverageGroup === "all" ? "" : coverageGroup, subgroup))}</option>`).join("")}</select>
      <input id="coverage-query" value="${escapeHtml(coverageQuery)}" placeholder="Filtrar edición" autocomplete="off"/>
    </div>
    <div class="coverage-total"><b>${report.percentage}% global</b><span>${report.setCount} ediciones · ${report.implementedMembershipCount.toLocaleString()} / ${report.membershipCount.toLocaleString()} cartas únicas por edición</span></div>
    <p class="panel-note">Orden cronológico: Alpha → ediciones nuevas. Las reimpresiones heredan el estado de su <code>oracle_id</code>; entra a un subgrupo y luego a una edición para ver sus pendientes${escapeHtml(excluded)}.</p>
    <div id="coverage-results">${coverageResultsHtml(report)}</div>`;
  body.querySelectorAll<HTMLButtonElement>("[data-coverage-filter]").forEach((button) => button.addEventListener("click", () => {
    coverageFilter = button.dataset.coverageFilter as CoverageSet["category"] | "all";
    renderCoverageReport(report);
  }));
  body.querySelector<HTMLSelectElement>("#coverage-group")?.addEventListener("change", (event) => {
    coverageGroup = (event.target as HTMLSelectElement).value;
    coverageSubgroup = "all";
    renderCoverageReport(report);
  });
  body.querySelector<HTMLInputElement>("#coverage-query")?.addEventListener("input", (event) => {
    const input = event.target as HTMLInputElement;
    coverageQuery = input.value;
    // Replace only the result list, not the input itself. Rebuilding the whole
    // dialog on every keystroke made the browser reset the caret and type text
    // backwards (for example `commander` became `rednammoc`).
    const results = body.querySelector<HTMLElement>("#coverage-results");
    if (results) {
      results.innerHTML = coverageResultsHtml(report);
      wireCoverageResults(body, report);
    }
  });
  body.querySelector<HTMLSelectElement>("#coverage-subgroup")?.addEventListener("change", (event) => {
    coverageSubgroup = (event.target as HTMLSelectElement).value;
    renderCoverageReport(report);
  });
  wireCoverageResults(body, report);
}

async function loadCoverageSet(code: string): Promise<void> {
  const body = document.querySelector<HTMLElement>("#coverage-dialog .panel-body");
  if (!body) return;
  body.innerHTML = `<p class="zone-private">Cargando pendientes…</p>`;
  try {
    const set = await api<CoverageSet>(`/api/rules/coverage/sets/${encodeURIComponent(code)}`);
    renderCoverageSetDetail(body, set, false);
  } catch {
    try {
      const report = await loadStaticCoverage();
      const set = report.sets.find((entry) => entry.code === code);
      if (!set) throw new Error("No se encontró esa edición en el mapa público.");
      renderCoverageSetDetail(body, set, true);
    } catch (error) { body.innerHTML = `<p class="zone-private">${escapeHtml(error instanceof Error ? error.message : "No se pudo cargar la edición.")}</p>`; }
  }
}

function renderCoverageSetDetail(body: HTMLElement, set: CoverageSet, publicSummary: boolean): void {
  const pendingMarkup = set.pendingCards
    ? set.pendingCards.length
      ? set.pendingCards.map((card) => `<div><span>□ ${escapeHtml(card.name)}</span><code>${escapeHtml(card.oracleId)}</code></div>`).join("")
      : `<p class="zone-private">Edición completa.</p>`
    : `<p class="zone-private">Resumen público disponible. Los <code>oracle_id</code> pendientes se muestran con el servidor de reglas conectado.</p>`;
  body.innerHTML = `<button type="button" class="text-button" data-coverage-back>← Volver al mapa</button>
      <div class="coverage-detail-head"><div><h3>${escapeHtml(set.name)}</h3><small>${escapeHtml(set.code.toUpperCase())} · ${escapeHtml(set.releasedAt)} · ${escapeHtml(coverageGroupLabel(set.group))} / ${escapeHtml(coverageSubgroupLabel(set.group, set.subgroup))}</small></div><b>${set.percentage}%</b></div>
      <div class="coverage-track large"><i style="width:${Math.max(0, Math.min(100, set.percentage))}%"></i></div>
      <p class="panel-note">${set.implemented} implementadas · ${set.pending} pendientes.${publicSummary ? " Este es el resumen estático de GitHub Pages." : " Cada pendiente identifica su lógica con <code>oracle_id</code>."}</p>
      <div class="coverage-pending">${pendingMarkup}</div>`;
  body.querySelector("[data-coverage-back]")?.addEventListener("click", () => void loadCoverage());
}

async function loadStaticCoverage(): Promise<SetCoverageReport> {
  const response = await fetch("./coverage.json");
  if (!response.ok) throw new Error(`No se pudo cargar el resumen público (${response.status}).`);
  return await response.json() as SetCoverageReport;
}

async function loadCoverage(): Promise<void> {
  const body = document.querySelector<HTMLElement>("#coverage-dialog .panel-body");
  if (!body) return;
  body.innerHTML = `<p class="zone-private">Cargando mapa de implementación…</p>`;
  try { renderCoverageReport(await api<SetCoverageReport>("/api/rules/coverage/sets")); }
  catch {
    try { renderCoverageReport(await loadStaticCoverage()); }
    catch (error) { body.innerHTML = `<p class="zone-private">${escapeHtml(error instanceof Error ? error.message : "No se pudo cargar el mapa.")}</p>`; }
  }
}

function openCoverage(): void {
  coverageFilter = "main";
  coverageGroup = "all";
  coverageSubgroup = "all";
  coverageQuery = "";
  fillDialog("coverage-dialog", panelHtml("coverage-dialog", "Implementación por edición", "Cargando mapa de implementación…"));
  void loadCoverage();
}

async function loadAvatars(): Promise<void> {
  const grid = document.querySelector<HTMLElement>("#avatar-grid");
  if (!grid) return;
  if (!avatarChoices.length) {
    const names = ["Birds of Paradise", "Liliana of the Veil", "Jace, the Mind Sculptor", "Atraxa, Grand Unifier", "Sol Ring", "Lightning Bolt"];
    const results = await Promise.all(names.map(async (name) => {
      try {
        const card = await api<{ name?: string; image_uris?: { art_crop?: string } }>(`/api/catalog/named?name=${encodeURIComponent(name)}`);
        return card.image_uris?.art_crop ? { name: card.name ?? name, image: card.image_uris.art_crop } : null;
      } catch { return null; }
    }));
    avatarChoices = results.filter((choice): choice is AvatarChoice => choice !== null);
  }
  grid.innerHTML = avatarChoices.length
    ? avatarChoices.map((avatar) => `<button type="button" class="avatar-choice${selectedAvatar === avatar.image ? " selected" : ""}" data-avatar="${escapeHtml(avatar.image)}">
        <img src="${escapeHtml(avatar.image)}" alt=""/><span>${escapeHtml(avatar.name)}</span></button>`).join("")
    : "<p class='zone-private'>No se pudieron cargar los recortes de arte.</p>";
  grid.querySelectorAll<HTMLButtonElement>("[data-avatar]").forEach((button) => button.addEventListener("click", () => {
    selectedAvatar = button.dataset.avatar!;
    window.localStorage.setItem("prossh.avatar", selectedAvatar);
    dialog("profile-dialog")?.close();
    render();
  }));
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

document.querySelectorAll<HTMLButtonElement>("[data-close]").forEach((button) =>
  button.addEventListener("click", () => dialog(button.dataset.close!)?.close()));
document.querySelector<HTMLInputElement>("#card-query")?.addEventListener("input", (event) =>
  void searchCards((event.target as HTMLInputElement).value));

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) return;
  if (event.code === "Space") { event.preventDefault(); document.querySelector<HTMLButtonElement>("#pass")?.click(); }
  if (event.code === "Escape" && (ui.pendingTarget || ui.abilityMenu || ui.cardActionMenu || ui.contextMenu || ui.glyphHelp || ui.stackDetail)) {
    ui.pendingTarget = null; ui.abilityMenu = null; ui.cardActionMenu = null; ui.contextMenu = null; ui.glyphHelp = null; ui.stackDetail = null; ui.notice = ""; render();
  }
  if (event.code === "KeyL") { ui.logOpen = !ui.logOpen; render(); }
});

const stored = window.sessionStorage.getItem("prossh.match");
if (stored) {
  try { session = JSON.parse(stored) as MatchSession; void refresh(); }
  catch { window.sessionStorage.removeItem("prossh.match"); }
}
render();
