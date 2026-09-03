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

import type { CardView, GameView, LegalAction, PermanentView, PlayerView, Target, TurnStep } from "@prossh/rules";
import "./styles.css";

type PreconSummary = {
  id: string; name: string; commanders: string[]; set_code: string; set_name?: string;
  released_at: string; cover_art_uri?: string; cover_art_kind: string; set_icon_uri?: string;
};
type PreconGroup = { set_code: string; set_name: string; released_at: string; set_icon_uri?: string; decks: PreconSummary[] };
type CatalogCard = {
  id: string; name: string; type_line: string; mana_cost: string; oracle_text: string;
  set_code: string; set_name: string; released_at: string; rarity: string; scryfall_uri: string;
  power: string | null; toughness: string | null; printings?: number;
  image_uris: { small?: string; normal?: string; art_crop?: string };
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
  pendingTarget: { action: LegalAction; options: readonly Target[] } | null;
  attackers: Map<string, number>;
  blockers: Map<string, string>;
  selectedBlocker: string | null;
  notice: string;
  busy: boolean;
  logOpen: boolean;
  autoPass: boolean;
}

let session: MatchSession | null = null;
let view: GameView | null = null;
let avatarChoices: AvatarChoice[] = [];
let selectedAvatar = window.localStorage.getItem("prossh.avatar") ?? "";
const ui: UiState = {
  pendingTarget: null, attackers: new Map(), blockers: new Map(), selectedBlocker: null,
  notice: "", busy: false, logOpen: window.localStorage.getItem("prossh.log") === "1", autoPass: true
};

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Falta el contenedor #app.");

const escapeHtml = (value: string) =>
  value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
const dialog = (id: string) => document.querySelector<HTMLDialogElement>(`#${id}`);

// ---------------------------------------------------------------------------
// Mana symbols
// ---------------------------------------------------------------------------

/** Renders `{2}{G/W}{B/P}` as coloured pips; hybrids get a split background. */
function manaHtml(cost: string | undefined): string {
  const symbols = [...(cost ?? "").matchAll(/\{([^}]+)\}/g)].map((match) => match[1]!);
  if (!symbols.length) return "";
  const tone: Record<string, string> = { W: "#f8f4e3", U: "#a3cee6", B: "#4b4249", R: "#e79b86", G: "#96c69d", C: "#c8c8c4" };
  return `<span class="mana">${symbols.map((symbol) => {
    const upper = symbol.toUpperCase();
    const hybrid = /^([WUBRGC0-9]+)\/([WUBRGCP])$/.exec(upper);
    if (hybrid) {
      const left = tone[hybrid[1]!] ?? "#b8b2a4";
      const right = tone[hybrid[2]!] ?? "#c0b9a8";
      return `<i class="pip hybrid" style="--pip-a:${left};--pip-b:${right}">${escapeHtml(upper)}</i>`;
    }
    const kind = /^\d+$/.test(upper) ? "generic" : upper.toLowerCase();
    return `<i class="pip p-${escapeHtml(kind)}">${escapeHtml(upper)}</i>`;
  }).join("")}</span>`;
}

// ---------------------------------------------------------------------------
// Server access
// ---------------------------------------------------------------------------

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `La petición falló (${response.status}).`);
  return payload;
}

async function startMatch(mode: "cedh" | "precon", deckId?: string): Promise<void> {
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
  } catch (error) {
    ui.notice = error instanceof Error ? error.message : "No se pudo crear la partida.";
    render();
  }
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

async function setAutoPass(autoPass: boolean): Promise<void> {
  if (!session) return;
  ui.autoPass = autoPass;
  try {
    applyView(await api<GameView>(`/api/matches/${session.matchId}/settings`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: session.token, autoPass })
    }));
  } catch (error) { ui.notice = error instanceof Error ? error.message : "No se pudo cambiar la preferencia."; render(); }
}

function applyView(next: GameView): void {
  view = next;
  ui.pendingTarget = null;
  ui.selectedBlocker = null;
  if (!next.combat.awaitingAttackers) ui.attackers.clear();
  if (!next.combat.awaitingBlockersFrom.includes(next.viewerSeat)) ui.blockers.clear();
  render();
}

// ---------------------------------------------------------------------------
// View helpers
// ---------------------------------------------------------------------------

function seatOf(seat: number): PlayerView | undefined { return view?.players.find((player) => player.seat === seat); }
function actionForCard(cardId: string): LegalAction | undefined {
  return view?.legalActions.find((entry) => entry.cardId === cardId && (entry.action.type === "cast" || entry.action.type === "play-land"));
}
function passAction(): LegalAction | undefined { return view?.legalActions.find((entry) => entry.action.type === "pass"); }
function isLandCard(card: { type_line: string }): boolean { return /\bLand\b/.test(card.type_line.split("//")[0]!); }
function isTargetable(instanceId: string): boolean {
  return Boolean(ui.pendingTarget?.options.some((target) => target.kind === "permanent" && target.instanceId === instanceId));
}
function isPlayerTargetable(seat: number): boolean {
  return Boolean(ui.pendingTarget?.options.some((target) => target.kind === "player" && target.seat === seat));
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
  const pending = ui.pendingTarget;
  if (!pending || pending.action.action.type !== "cast") return;
  ui.pendingTarget = null;
  void submit({ ...pending.action.action, targets: [target] });
}

function onCardClick(cardId: string): void {
  const action = actionForCard(cardId);
  if (!action) { showCardDetail(cardId); return; }
  if (action.requiresTarget && view) {
    const options = view.targetOptions[action.requiresTarget];
    if (!options.length) { ui.notice = "No hay objetivos legales para esa carta."; render(); return; }
    ui.pendingTarget = { action, options };
    ui.notice = `Elige un objetivo para ${action.label.replace(/^Lanzar /, "")}.`;
    render();
    return;
  }
  void submit(action.action);
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
  showCardDetail(instanceId);
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
  if (isTargetable(permanent.instance_id)) classes.push("targetable");
  if (own && ui.attackers.has(permanent.instance_id)) classes.push("selected-attacker");
  if (own && ui.selectedBlocker === permanent.instance_id) classes.push("selected-blocker");
  if (own && ui.blockers.has(permanent.instance_id)) classes.push("assigned-blocker");
  if (view?.selectableAttackers.includes(permanent.instance_id)) classes.push("can-attack");
  if (view?.selectableBlockers.includes(permanent.instance_id)) classes.push("can-block");

  const stats = permanent.power !== null && permanent.toughness !== null
    ? `<b class="pt">${permanent.power}/${permanent.toughness}${permanent.damage ? `<i> -${permanent.damage}</i>` : ""}</b>` : "";
  const badges = [
    permanent.isCommander ? `<i class="tile-badge cmd" title="Comandante">C</i>` : "",
    permanent.summoningSick ? `<i class="tile-badge sick" title="Mareo de invocación">z</i>` : "",
    permanent.attacking !== null ? `<i class="tile-badge atk" title="Ataca a ${escapeHtml(seatOf(permanent.attacking)?.name ?? "")}">⚔</i>` : "",
    permanent.blocking ? `<i class="tile-badge blk" title="Bloqueando">◈</i>` : "",
    permanent.producesMana && !permanent.tapped ? `<i class="tile-badge mana" title="Puede producir maná">◇</i>` : ""
  ].join("");

  return `<button class="${classes.join(" ")}" type="button" data-permanent="${escapeHtml(permanent.instance_id)}"
    data-preview="${escapeHtml(permanent.instance_id)}" title="${escapeHtml(permanent.name)}">
    ${permanent.image_normal ? `<img src="${escapeHtml(permanent.image_normal)}" alt="" loading="lazy" decoding="async"/>` : ""}
    <span class="tile-name">${escapeHtml(permanent.name)}</span>${stats}<span class="tile-badges">${badges}</span>
  </button>`;
}

/**
 * Splits a battlefield into a land row and a nonland row, laid out the way a
 * paper table reads: each player's lands sit on their own edge and their
 * creatures sit toward the middle, where combat happens.
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
  return own ? `${nonlandRow}${landRow}` : `${landRow}${nonlandRow}`;
}

function seatPanelHtml(player: PlayerView): string {
  const acting = view?.waitingOn === player.seat;
  const classes = ["seat-panel"];
  if (acting) classes.push("acting");
  if (player.lost) classes.push("eliminated");
  if (isPlayerTargetable(player.seat)) classes.push("targetable-player");
  const commander = player.commandZone[0];
  const cmdDamage = Object.values(player.commanderDamage).filter((amount) => amount > 0);
  return `<article class="${classes.join(" ")}" style="--accent: var(--seat-${player.seat})" aria-label="Campo de ${escapeHtml(player.name)}">
    <header class="seat-head">
      <span class="seat-avatar"${commander?.image_art_crop ? ` style="background-image:url('${escapeHtml(commander.image_art_crop)}')"` : ""}>${escapeHtml(player.name.slice(0, 1))}</span>
      <span class="seat-name"><b>${escapeHtml(player.name)}${view?.activeSeat === player.seat ? `<i class="active-dot" title="Jugador activo"></i>` : ""}</b><span>${escapeHtml(player.deckName)}</span></span>
      <button class="life-chip${player.life <= 10 ? " low" : ""}" type="button" data-target-player="${player.seat}"
        title="${player.lost ? escapeHtml(player.lossReason ?? "Eliminado") : "Vidas"}"><b>${player.lost ? "✕" : player.life}</b><small>vidas</small></button>
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
    if (action) classes.push("playable");
    if (!card.fullyImplemented) classes.push("partial");
    return `<button class="${classes.join(" ")}" type="button" data-hand="${escapeHtml(card.instance_id)}"
      data-preview="${escapeHtml(card.instance_id)}" title="${escapeHtml(card.name)}">
      ${card.image_normal ? `<img src="${escapeHtml(card.image_normal)}" alt="" loading="lazy" decoding="async"/>` : ""}
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

function stackPanelHtml(): string {
  if (!view?.stack.length) return "";
  return `<section class="rail-panel stack"><h2>Pila (${view.stack.length})</h2>
    ${[...view.stack].reverse().map((object) => `<div class="stack-item${object.countered ? " countered" : ""}">
      ${object.image_normal ? `<img src="${escapeHtml(object.image_normal)}" alt=""/>` : ""}
      <div><b>${escapeHtml(object.name)}</b><span style="color: var(--seat-${object.controller})">${escapeHtml(seatOf(object.controller)?.name ?? "")}</span>
      ${object.targets.length ? `<span>→ ${escapeHtml(object.targets.join(", "))}</span>` : ""}</div>
    </div>`).join("")}</section>`;
}

function actionTrayHtml(): string {
  if (!view?.legalActions.length) return "";
  return `<section class="rail-panel"><h2>Acciones legales</h2><div class="action-list">
    ${view.legalActions.map((entry, index) => `<button class="action-row" type="button" data-action-index="${index}" title="${escapeHtml(entry.note ?? "")}">
      <span>${escapeHtml(entry.label)}</span>${entry.manaValue ? `<i>${entry.manaValue}</i>` : ""}</button>`).join("")}</div></section>`;
}

function landingHtml(): string {
  return `<main class="shell landing">
    <header class="topbar"><a class="brand" href="#">PROSSH<span>TCG</span></a><span class="turn-readout">Simulador de Commander</span></header>
    <section class="landing-body">
      <h1>Mesa de Commander de cuatro jugadores</h1>
      <p>Controlas el asiento inferior. Los otros tres los juega el bot determinista del motor, eligiendo solo entre las mismas acciones legales que se te ofrecen a ti.</p>
      <div class="landing-actions">
        <button id="start-cedh" class="primary-button">Jugar pod cEDH</button>
        <button id="start-precon" class="text-button">Elegir mazo precon</button>
        <button id="open-catalog" class="text-button">Buscar cartas</button>
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

  root!.innerHTML = `<main class="shell${ui.busy ? " busy" : ""}">
    <header class="topbar">
      <a class="brand" href="#">PROSSH<span>TCG</span></a>
      <span class="turn-readout"><span class="badge-pill">Turno <b>${view.turn}</b></span>
        <span class="badge-pill accent">${escapeHtml(view.stepLabel)}</span>
        <span>Activo: <b style="color: var(--seat-${view.activeSeat})">${escapeHtml(seatOf(view.activeSeat)?.name ?? "")}</b></span></span>
      <span class="topbar-right">
        <button id="new-cedh" class="text-button">Nueva cEDH</button>
        <button id="new-precon" class="text-button">Precons</button>
        <button id="search" class="text-button">Catálogo</button>
        <button id="toggle-log" class="icon-button${ui.logOpen ? " on" : ""}" type="button" title="Registro" aria-label="Registro">≡</button>
        <button id="profile" class="profile-avatar" aria-label="Perfil">${selectedAvatar ? `<img src="${escapeHtml(selectedAvatar)}" alt=""/>` : "MP"}</button>
      </span>
    </header>

    <nav class="phase-rail" aria-label="Fases del turno">
      ${STEP_ORDER.map((step, index) => `<span class="phase-step${step === view!.step ? " current" : index < currentIndex ? " done" : ""}">${escapeHtml(STEP_LABELS[step])}</span>`).join("")}
      <span class="spacer"></span>
      <span class="priority-readout"><span class="pulse${myTurn ? "" : " muted"}"></span>Decide: <b style="color: var(--seat-${view.waitingOn ?? 0})">${escapeHtml(seatOf(view.waitingOn ?? -1)?.name ?? "nadie")}</b></span>
    </nav>

    <div class="play-area">
      <aside class="side-rail" aria-label="Pila y acciones">${stackPanelHtml()}${actionTrayHtml()}</aside>
      <div class="table">
      <section class="opponent-row seats-${opponents.length}" aria-label="Campos de los oponentes">${opponents.map(seatPanelHtml).join("")}</section>
      ${combatBarHtml()}
      <section class="self-area" aria-label="Tu campo de batalla">
        <div class="self-board">${boardHtml(me, true)}</div>
        <div class="self-dock">
          <div class="self-identity">
            <span class="seat-avatar" style="border-color: var(--seat-${me.seat})${selectedAvatar ? `;background-image:url('${escapeHtml(selectedAvatar)}')` : ""}">${escapeHtml(me.name.slice(0, 1))}</span>
            <div>
              <button class="self-life" type="button" data-target-player="${me.seat}"><b>${me.lost ? "✕" : me.life}</b><small>vidas</small></button>
              <div class="self-zones">
                <button class="zone-chip" type="button" data-zone="library" data-seat="${me.seat}">Biblioteca <b>${me.libraryCount}</b></button>
                <button class="zone-chip" type="button" data-zone="graveyard" data-seat="${me.seat}">Cementerio <b>${me.graveyard.length}</b></button>
                <button class="zone-chip" type="button" data-zone="exile" data-seat="${me.seat}">Exilio <b>${me.exile.length}</b></button>
                <button class="zone-chip" type="button" data-zone="command" data-seat="${me.seat}">Mando <b>${me.commandZone.length}</b></button>
                <span class="mana-chip" title="Maná que aún puedes producir">◇ <b>${me.availableMana}</b></span>
              </div>
            </div>
          </div>
          <div class="hand-wrap">
            <div class="hand-label"><b>Tu mano · ${me.handCount}</b><span class="hint">${escapeHtml(ui.notice || (myTurn ? "Las cartas con borde dorado se pueden jugar ahora." : "Esperando a los demás jugadores…"))}</span></div>
            <div class="hand">${handHtml(me)}</div>
          </div>
          <div class="dock-actions">
            ${ui.pendingTarget ? `<button id="cancel-target" class="text-button">Cancelar objetivo</button>` : ""}
            <button id="pass" class="primary-button" ${pass ? "" : "disabled"}>${escapeHtml(pass?.label ?? "Sin prioridad")}<kbd>Espacio</kbd></button>
            <label class="toggle"><input id="auto-pass" type="checkbox" ${ui.autoPass ? "checked" : ""}/> Auto-pasar sin jugadas</label>
          </div>
        </div>
      </section>
      </div>
    </div>
  </main>
  ${logDrawerHtml()}
  <div class="card-preview" id="card-preview"></div>
  ${view.finished ? `<div class="winner-banner"><div class="winner-card">
    <h2>${winner ? `${escapeHtml(winner.name)} gana` : "Empate"}</h2>
    <p>Turno ${view.turn}. ${escapeHtml(view.players.filter((player) => player.lost).map((player) => `${player.name}: ${player.lossReason ?? "eliminado"}`).join(" · ") || "")}</p>
    <button id="rematch" class="primary-button">Jugar otra</button></div></div>` : ""}`;

  wireBoard();
}

// ---------------------------------------------------------------------------
// Hover preview
// ---------------------------------------------------------------------------

function showPreview(card: CardView, anchor: HTMLElement): void {
  const panel = document.querySelector<HTMLElement>("#card-preview");
  if (!panel) return;
  const onRightSide = anchor.getBoundingClientRect().left > window.innerWidth * 0.62;
  panel.className = `card-preview visible${onRightSide ? " left" : ""}`;
  panel.innerHTML = `${card.image_normal ? `<img src="${escapeHtml(card.image_normal)}" alt=""/>` : ""}
    <div class="preview-body">
      <div class="preview-type">${escapeHtml(card.type_line)} ${manaHtml(card.mana_cost)}</div>
      ${card.power !== null ? `<div class="preview-type">${card.power}/${card.toughness}</div>` : ""}
      <pre class="preview-rules">${escapeHtml(card.oracle_text || "Sin texto de reglas.")}</pre>
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
  document.querySelector("#start-precon")?.addEventListener("click", () => openPrecons());
  document.querySelector("#open-catalog")?.addEventListener("click", () => dialog("catalog")?.showModal());
}

function wireBoard(): void {
  const on = (selector: string, handler: () => void) => document.querySelector(selector)?.addEventListener("click", handler);
  on("#pass", () => { const action = passAction(); if (action) void submit(action.action); });
  on("#new-cedh", () => void startMatch("cedh"));
  on("#rematch", () => void startMatch("cedh"));
  on("#new-precon", () => openPrecons());
  on("#search", () => { dialog("catalog")?.showModal(); document.querySelector<HTMLInputElement>("#card-query")?.focus(); });
  on("#profile", () => { dialog("profile-dialog")?.showModal(); void loadAvatars(); });
  on("#cancel-target", () => { ui.pendingTarget = null; ui.notice = ""; render(); });
  on("#toggle-log", () => { ui.logOpen = !ui.logOpen; window.localStorage.setItem("prossh.log", ui.logOpen ? "1" : "0"); render(); });
  on("#close-log", () => { ui.logOpen = false; window.localStorage.setItem("prossh.log", "0"); render(); });
  on("#confirm-attack", () => void submit({ type: "declare-attackers", attackers: [...ui.attackers.entries()].map(([instanceId, defender]) => ({ instanceId, defender })) }));
  on("#confirm-block", () => void submit({ type: "declare-blockers", blockers: [...ui.blockers.entries()].map(([instanceId, attackerId]) => ({ instanceId, attackerId })) }));

  document.querySelector<HTMLInputElement>("#auto-pass")?.addEventListener("change", (event) =>
    void setAutoPass((event.target as HTMLInputElement).checked));

  document.querySelectorAll<HTMLButtonElement>("[data-hand]").forEach((button) =>
    button.addEventListener("click", () => onCardClick(button.dataset.hand!)));
  document.querySelectorAll<HTMLButtonElement>("[data-permanent]").forEach((button) =>
    button.addEventListener("click", () => onPermanentClick(button.dataset.permanent!)));
  document.querySelectorAll<HTMLButtonElement>("[data-target-player]").forEach((button) =>
    button.addEventListener("click", () => {
      const seat = Number(button.dataset.targetPlayer);
      if (isPlayerTargetable(seat)) chooseTarget({ kind: "player", seat });
    }));
  document.querySelectorAll<HTMLButtonElement>("[data-cycle-defender]").forEach((button) =>
    button.addEventListener("click", () => cycleDefender(button.dataset.cycleDefender!)));
  document.querySelectorAll<HTMLButtonElement>("[data-action-index]").forEach((button) =>
    button.addEventListener("click", () => {
      const entry = view?.legalActions[Number(button.dataset.actionIndex)];
      if (!entry) return;
      if (entry.requiresTarget && entry.cardId) { onCardClick(entry.cardId); return; }
      void submit(entry.action);
    }));
  document.querySelectorAll<HTMLButtonElement>("[data-zone]").forEach((button) =>
    button.addEventListener("click", () => showZone(Number(button.dataset.seat), button.dataset.zone as never)));

  const index = visibleCards();
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

function showCardDetail(instanceId: string): void {
  const card = visibleCards().get(instanceId);
  if (!card) return;
  fillDialog("card-dialog", panelHtml("card-dialog", card.name, `<div class="card-detail">
    ${card.image_normal ? `<img src="${escapeHtml(card.image_normal)}" alt="${escapeHtml(card.name)}"/>` : ""}
    <div class="detail-body">
      <div class="detail-type">${escapeHtml(card.type_line)} ${manaHtml(card.mana_cost)}</div>
      ${card.power !== null ? `<div class="detail-type">Fuerza/resistencia ${card.power}/${card.toughness}</div>` : ""}
      <pre>${escapeHtml(card.oracle_text || "Sin texto de reglas.")}</pre>
      <div class="coverage ${card.fullyImplemented ? "ok" : "partial"}">${card.fullyImplemented
        ? "El motor ejecuta todo el texto impreso de esta carta."
        : "El motor todavía no ejecuta este texto. La carta entra al juego con su cuerpo, tipos y palabras clave de combate."}</div>
      <a class="external-link" href="https://scryfall.com/card/${escapeHtml(card.scryfall_id)}" target="_blank" rel="noreferrer">Ver la impresión en Scryfall ↗</a>
    </div></div>`));
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
      ? `<div class="zone-cards">${cards.map((card) => `<article>${card.image_normal ? `<img src="${escapeHtml(card.image_normal)}" alt="${escapeHtml(card.name)}"/>` : ""}<b>${escapeHtml(card.name)}</b></article>`).join("")}</div>`
      : `<p class="zone-private">No hay cartas en esta zona.</p>`));
}

// ---------------------------------------------------------------------------
// Precon browser and card catalog
// ---------------------------------------------------------------------------

let preconQuery = "";

function openPrecons(): void {
  fillDialog("precon-dialog", panelHtml("precon-dialog", "Mazos precon de Commander",
    `<p class="panel-note">Agrupados por producto y ordenados del más reciente al más antiguo. Al empezar, los otros tres asientos juegan mazos del mismo producto.</p><div id="precon-results">Cargando…</div>`,
    { label: "Buscar mazo, comandante o producto", value: preconQuery, placeholder: "Ej. Ghave, 40K, Commander 2014" }));
  const input = document.querySelector<HTMLInputElement>("#precon-dialog-query");
  input?.addEventListener("input", () => { preconQuery = input.value; void loadPrecons(preconQuery); });
  input?.focus();
  void loadPrecons(preconQuery);
}

async function loadPrecons(query = ""): Promise<void> {
  const container = document.querySelector<HTMLElement>("#precon-results");
  if (!container) return;
  try {
    const payload = await api<{ groups?: PreconGroup[]; total?: number }>(`/api/decks/precons?grouped=1&q=${encodeURIComponent(query)}`);
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
    const card = await api<CatalogCard & { printings_list?: { set_code: string; set_name: string; released_at: string }[] }>(`/api/catalog/card/${encodeURIComponent(id)}`);
    fillDialog("card-dialog", panelHtml("card-dialog", card.name, `<div class="card-detail">
      ${card.image_uris.normal ? `<img src="${escapeHtml(card.image_uris.normal)}" alt="${escapeHtml(card.name)}"/>` : ""}
      <div class="detail-body">
        <div class="detail-type">${escapeHtml(card.type_line)} ${manaHtml(card.mana_cost)}</div>
        ${card.power !== null ? `<div class="detail-type">Fuerza/resistencia ${escapeHtml(card.power ?? "")}/${escapeHtml(card.toughness ?? "")}</div>` : ""}
        <pre>${escapeHtml(card.oracle_text || "Sin texto de reglas.")}</pre>
        <div class="detail-type">${escapeHtml(card.set_name)} · ${escapeHtml(card.released_at)} · ${escapeHtml(card.rarity)}</div>
        ${card.printings_list?.length ? `<div class="printings">${card.printings_list.slice(0, 24).map((printing) =>
          `<span title="${escapeHtml(printing.set_name)}">${escapeHtml(printing.set_code.toUpperCase())} ${escapeHtml(printing.released_at.slice(0, 4))}</span>`).join("")}</div>` : ""}
        <a class="external-link" href="${escapeHtml(card.scryfall_uri)}" target="_blank" rel="noreferrer">Ver en Scryfall ↗</a>
      </div></div>`));
  } catch (error) { ui.notice = error instanceof Error ? error.message : "No se pudo abrir la carta."; render(); }
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
  if (event.code === "Escape" && ui.pendingTarget) { ui.pendingTarget = null; ui.notice = ""; render(); }
  if (event.code === "KeyL") { ui.logOpen = !ui.logOpen; render(); }
});

const stored = window.sessionStorage.getItem("prossh.match");
if (stored) {
  try { session = JSON.parse(stored) as MatchSession; void refresh(); }
  catch { window.sessionStorage.removeItem("prossh.match"); }
}
render();
