/**
 * ProsshTCG table client.
 *
 * The client is deliberately thin: it renders the seat projection the server
 * sends and can only submit actions the server already declared legal. It never
 * decides a rule, never sees another seat's hidden zones, and never invents a
 * card effect.
 */

import type { GameView, LegalAction, PermanentView, PlayerView, Target, TurnStep } from "@prossh/rules";
import "./styles.css";

type PreconSummary = { id: string; name: string; commanders: string[]; set_code: string; released_at: string; cover_art_uri?: string; cover_art_kind: string };
type AvatarChoice = { name: string; image: string };
type MatchSession = { matchId: string; token: string; seat: number };

const STEP_ORDER: TurnStep[] = [
  "untap", "upkeep", "draw", "precombat-main", "begin-combat", "declare-attackers",
  "declare-blockers", "combat-damage", "end-combat", "postcombat-main", "end", "cleanup"
];
const STEP_LABELS: Record<TurnStep, string> = {
  untap: "Enderezar", upkeep: "Mantenimiento", draw: "Robo", "precombat-main": "Principal 1",
  "begin-combat": "Inicio combate", "declare-attackers": "Atacantes", "declare-blockers": "Bloqueadores",
  "combat-damage": "Daño", "end-combat": "Fin combate", "postcombat-main": "Principal 2",
  end: "Final", cleanup: "Limpieza"
};
const ACCENTS = ["gold", "rose", "azure", "violet"];

interface UiState {
  /** A cast waiting for the player to click a target. */
  pendingTarget: { action: LegalAction; options: readonly Target[] } | null;
  attackers: Map<string, number>;
  blockers: Map<string, string>;
  selectedBlocker: string | null;
  notice: string;
  busy: boolean;
}

let session: MatchSession | null = null;
let view: GameView | null = null;
let preconResults: PreconSummary[] = [];
let avatarChoices: AvatarChoice[] = [];
let selectedAvatar = window.localStorage.getItem("prossh.avatar") ?? "";
const ui: UiState = { pendingTarget: null, attackers: new Map(), blockers: new Map(), selectedBlocker: null, notice: "", busy: false };

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Falta el contenedor #app.");

const escapeHtml = (value: string) =>
  value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
const dialog = (id: string) => document.querySelector<HTMLDialogElement>(`#${id}`);

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
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, ...(deckId ? { deckId } : {}) })
    });
    session = { matchId: created.matchId, token: created.token, seat: created.seat };
    window.sessionStorage.setItem("prossh.match", JSON.stringify(session));
    applyView(created.view);
    ui.notice = "";
  } catch (error) {
    ui.notice = error instanceof Error ? error.message : "No se pudo crear la partida.";
    render();
  }
}

async function refresh(): Promise<void> {
  if (!session) return;
  try {
    applyView(await api<GameView>(`/api/matches/${session.matchId}?token=${encodeURIComponent(session.token)}`));
  } catch (error) {
    ui.notice = error instanceof Error ? error.message : "No se pudo leer la partida.";
    render();
  }
}

async function submit(action: LegalAction["action"]): Promise<void> {
  if (!session || ui.busy) return;
  ui.busy = true;
  render();
  try {
    const next = await api<GameView>(`/api/matches/${session.matchId}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: session.token, action })
    });
    ui.notice = "";
    applyView(next);
  } catch (error) {
    ui.notice = error instanceof Error ? error.message : "La acción fue rechazada.";
    render();
  } finally {
    ui.busy = false;
    render();
  }
}

async function setAutoPass(autoPass: boolean): Promise<void> {
  if (!session) return;
  try {
    applyView(await api<GameView>(`/api/matches/${session.matchId}/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

function passAction(): LegalAction | undefined {
  return view?.legalActions.find((entry) => entry.action.type === "pass");
}

function targetLabel(target: Target): string {
  if (target.kind === "player") return seatOf(target.seat)?.name ?? `Asiento ${target.seat + 1}`;
  if (target.kind === "spell") return view?.stack.find((entry) => entry.id === target.stackId)?.name ?? "hechizo";
  for (const player of view?.players ?? []) {
    const permanent = player.battlefield.find((candidate) => candidate.instance_id === target.instanceId);
    if (permanent) return `${permanent.name} (${player.name})`;
  }
  return "objetivo";
}

function targetsFor(action: LegalAction): readonly Target[] {
  if (!view || !action.requiresTarget) return [];
  return view.targetOptions[action.requiresTarget];
}

function isTargetable(instanceId: string): boolean {
  return Boolean(ui.pendingTarget?.options.some((target) => target.kind === "permanent" && target.instanceId === instanceId));
}

function isPlayerTargetable(seat: number): boolean {
  return Boolean(ui.pendingTarget?.options.some((target) => target.kind === "player" && target.seat === seat));
}

function chooseTarget(target: Target): void {
  const pending = ui.pendingTarget;
  if (!pending || pending.action.action.type !== "cast") return;
  ui.pendingTarget = null;
  void submit({ ...pending.action.action, targets: [target] });
}

function onCardClick(cardId: string): void {
  const action = actionForCard(cardId);
  if (!action) { ui.notice = "Esa carta no se puede jugar en este momento."; render(); return; }
  if (action.requiresTarget) {
    const options = targetsFor(action);
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

function onBlockerClick(instanceId: string): void {
  if (ui.blockers.has(instanceId)) { ui.blockers.delete(instanceId); ui.selectedBlocker = null; }
  else ui.selectedBlocker = ui.selectedBlocker === instanceId ? null : instanceId;
  render();
}

function assignBlock(attackerId: string): void {
  if (!ui.selectedBlocker) { ui.notice = "Primero elige una de tus criaturas para bloquear."; render(); return; }
  ui.blockers.set(ui.selectedBlocker, attackerId);
  ui.selectedBlocker = null;
  render();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function manaCostHtml(cost: string): string {
  const symbols = [...cost.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]!);
  if (!symbols.length) return "";
  return `<span class="mana">${symbols.map((symbol) => `<i class="pip p-${escapeHtml(symbol.replace(/[^A-Za-z0-9]/g, "").toLowerCase() || "x")}">${escapeHtml(symbol)}</i>`).join("")}</span>`;
}

function permanentHtml(permanent: PermanentView, options: { own: boolean }): string {
  const classes = ["board-card"];
  if (permanent.tapped) classes.push("tapped");
  if (permanent.attacking !== null) classes.push("attacking");
  if (permanent.blocking) classes.push("blocking");
  if (permanent.isCommander) classes.push("is-commander");
  if (isTargetable(permanent.instance_id)) classes.push("targetable");
  if (options.own && ui.attackers.has(permanent.instance_id)) classes.push("selected-attacker");
  if (options.own && ui.selectedBlocker === permanent.instance_id) classes.push("selected-blocker");
  if (options.own && ui.blockers.has(permanent.instance_id)) classes.push("assigned-blocker");
  if (view?.selectableAttackers.includes(permanent.instance_id)) classes.push("can-attack");
  if (view?.selectableBlockers.includes(permanent.instance_id)) classes.push("can-block");

  const stats = permanent.power !== null && permanent.toughness !== null
    ? `<b class="pt">${permanent.power}/${permanent.toughness}${permanent.damage ? `<i>-${permanent.damage}</i>` : ""}</b>` : "";
  const badges = [
    permanent.isCommander ? `<i class="badge cmd" title="Comandante">CMD</i>` : "",
    permanent.summoningSick ? `<i class="badge sick" title="Con mareo de invocación">z</i>` : "",
    permanent.attacking !== null ? `<i class="badge atk" title="Atacando a ${escapeHtml(seatOf(permanent.attacking)?.name ?? "")}">⚔</i>` : "",
    permanent.blocking ? `<i class="badge blk" title="Bloqueando">🛡</i>` : ""
  ].join("");

  return `<button class="${classes.join(" ")}" type="button" data-permanent="${escapeHtml(permanent.instance_id)}"
    title="${escapeHtml(permanent.name)} · ${escapeHtml(permanent.type_line)}">
    ${permanent.image_normal ? `<img src="${escapeHtml(permanent.image_normal)}" alt="${escapeHtml(permanent.name)}" loading="lazy" decoding="async"/>` : ""}
    <span class="board-name">${escapeHtml(permanent.name)}</span>${stats}<span class="badges">${badges}</span>
  </button>`;
}

function battlefieldHtml(player: PlayerView, own: boolean): string {
  if (!player.battlefield.length) return `<p class="board-loading">Sin permanentes en juego.</p>`;
  const order = [...player.battlefield].sort((left, right) => Number(right.power !== null) - Number(left.power !== null) || left.name.localeCompare(right.name));
  return order.map((permanent) => permanentHtml(permanent, { own })).join("");
}

function commanderDamageHtml(player: PlayerView): string {
  const entries = Object.entries(player.commanderDamage).filter(([, amount]) => amount > 0);
  if (!entries.length) return "";
  return `<span class="cmd-damage" title="Daño de comandante recibido">CMD ${entries.map(([, amount]) => amount).join("/")}</span>`;
}

function opponentHtml(player: PlayerView, index: number): string {
  const active = view?.activeSeat === player.seat;
  const waiting = view?.waitingOn === player.seat;
  const classes = ["opponent-zone", ACCENTS[(index + 1) % ACCENTS.length]!];
  if (waiting) classes.push("has-priority");
  if (player.lost) classes.push("eliminated");
  if (isPlayerTargetable(player.seat)) classes.push("targetable-player");
  const commander = player.commandZone[0];
  return `<article class="${classes.join(" ")}" aria-label="Campo de ${escapeHtml(player.name)}">
    <header class="opponent-head">
      <div class="identity">
        <span class="avatar-art mini"${commander?.image_art_crop ? ` style="background-image:url('${escapeHtml(commander.image_art_crop)}')"` : ""}>${escapeHtml(player.name.slice(0, 1))}</span>
        <div><b>${escapeHtml(player.name)}${active ? " <i class='turn-dot' title='Jugador activo'></i>" : ""}</b><span>${escapeHtml(player.deckName)}</span></div>
      </div>
      <div class="opponent-tools">
        <button class="opponent-stats" type="button" data-target-player="${player.seat}" title="${player.lost ? escapeHtml(player.lossReason ?? "Eliminado") : "Vidas"}">
          <span class="priority-dot"></span><b>${player.lost ? "✕" : player.life}</b><small>vidas</small>
        </button>
        ${commanderDamageHtml(player)}
        <div class="zone-rail" aria-label="Zonas de ${escapeHtml(player.name)}">
          <button type="button" data-zone="library" data-seat="${player.seat}" title="Biblioteca (${player.libraryCount})">B<i>${player.libraryCount}</i></button>
          <button type="button" data-zone="hand" data-seat="${player.seat}" title="Mano (${player.handCount})">M<i>${player.handCount}</i></button>
          <button type="button" data-zone="graveyard" data-seat="${player.seat}" title="Cementerio (${player.graveyard.length})">C<i>${player.graveyard.length}</i></button>
          <button type="button" data-zone="exile" data-seat="${player.seat}" title="Exilio (${player.exile.length})">E<i>${player.exile.length}</i></button>
        </div>
      </div>
    </header>
    <section class="opponent-battlefield"><div class="battlefield-grid">${battlefieldHtml(player, false)}</div>
      ${commander ? `<div class="commander-frame compact"><div class="commander-art"${commander.image_normal ? ` style="background-image:url('${escapeHtml(commander.image_normal)}')"` : ""}></div><div class="commander-caption"><b>${escapeHtml(commander.name)}</b><span>Zona de mando</span></div></div>` : ""}
    </section>
  </article>`;
}

function handHtml(player: PlayerView): string {
  const cards = player.hand ?? [];
  if (!cards.length) return `<p class="hand-loading">Mano vacía.</p>`;
  return cards.map((card) => {
    const action = actionForCard(card.instance_id);
    const classes = ["hand-card"];
    if (action) classes.push("playable");
    if (!card.fullyImplemented) classes.push("partial");
    const note = action?.note ? ` · ${action.note}` : !card.fullyImplemented ? " · texto no implementado" : "";
    return `<button class="${classes.join(" ")}" type="button" data-hand="${escapeHtml(card.instance_id)}"
      title="${escapeHtml(card.name)} ${escapeHtml(card.mana_cost)} · ${escapeHtml(card.type_line)}${escapeHtml(note)}">
      ${card.image_normal ? `<img src="${escapeHtml(card.image_normal)}" alt="${escapeHtml(card.name)}" loading="lazy" decoding="async"/>` : ""}
      <span>${escapeHtml(card.name)}</span>${manaCostHtml(card.mana_cost)}
    </button>`;
  }).join("");
}

function combatBarHtml(): string {
  if (!view) return "";
  if (view.combat.awaitingAttackers && view.activeSeat === view.viewerSeat) {
    const chosen = [...ui.attackers.keys()];
    const detail = chosen.map((id) => {
      const permanent = seatOf(view!.viewerSeat)?.battlefield.find((candidate) => candidate.instance_id === id);
      const defender = seatOf(ui.attackers.get(id)!);
      return `<button type="button" class="chip" data-cycle-defender="${escapeHtml(id)}">${escapeHtml(permanent?.name ?? "criatura")} → ${escapeHtml(defender?.name ?? "?")}</button>`;
    }).join("");
    return `<div class="combat-bar attackers">
      <b>Declara atacantes</b>
      <span>Clic en tus criaturas marcadas; clic en la ficha para cambiar de objetivo.</span>
      <div class="chips">${detail || "<i>Ninguno seleccionado</i>"}</div>
      <button id="confirm-attack" class="pass">${chosen.length ? `Atacar con ${chosen.length}` : "No atacar"}</button>
    </div>`;
  }
  if (view.combat.awaitingBlockersFrom.includes(view.viewerSeat)) {
    const detail = [...ui.blockers.entries()].map(([blocker, attacker]) => {
      const mine = seatOf(view!.viewerSeat)?.battlefield.find((candidate) => candidate.instance_id === blocker);
      const foe = view!.combat.attackers.find((candidate) => candidate.instanceId === attacker);
      return `<span class="chip">${escapeHtml(mine?.name ?? "criatura")} bloquea a ${escapeHtml(foe?.name ?? "?")}</span>`;
    }).join("");
    return `<div class="combat-bar blockers">
      <b>Declara bloqueadores</b>
      <span>Elige una criatura tuya y luego el atacante que quieres frenar.</span>
      <div class="chips">${detail || "<i>Sin bloqueos</i>"}</div>
      <button id="confirm-block" class="pass">${ui.blockers.size ? `Bloquear con ${ui.blockers.size}` : "No bloquear"}</button>
    </div>`;
  }
  if (view.combat.attackers.length) {
    return `<div class="combat-bar info"><b>En combate</b><div class="chips">${view.combat.attackers.map((entry) => {
      const blockers = view!.combat.blockers.filter((block) => block.attackerId === entry.instanceId).map((block) => block.name);
      return `<span class="chip">${escapeHtml(entry.name)} → ${escapeHtml(seatOf(entry.defender)?.name ?? "?")}${blockers.length ? ` (bloqueado por ${escapeHtml(blockers.join(", "))})` : ""}</span>`;
    }).join("")}</div></div>`;
  }
  return "";
}

function stackHtml(): string {
  if (!view?.stack.length) return `<p class="stack-empty">Pila vacía</p>`;
  return [...view.stack].reverse().map((object) => `<p class="stack-item${object.countered ? " countered" : ""}">
    <b>${escapeHtml(object.name)}</b> · ${escapeHtml(seatOf(object.controller)?.name ?? "")}${object.targets.length ? ` → ${escapeHtml(object.targets.join(", "))}` : ""}
  </p>`).join("");
}

function landingHtml(): string {
  return `<main class="shell landing">
    <header class="topbar"><a class="brand" href="#">PROSSH<span>TCG</span></a><div class="match-name">Simulador de Commander</div></header>
    <section class="landing-body">
      <h1>Mesa de Commander de cuatro jugadores</h1>
      <p>Tú controlas el asiento inferior. Los otros tres los juega el bot determinista del motor, usando exactamente las mismas acciones legales que tú.</p>
      <div class="landing-actions">
        <button id="start-cedh" class="pass">Jugar pod cEDH</button>
        <button id="start-precon" class="ghost">Elegir mazo precon</button>
        <button id="open-catalog" class="ghost">Buscar cartas</button>
      </div>
      <p class="landing-note">${escapeHtml(ui.notice || "El motor resuelve fases, prioridad, maná de todos los colores, la pila, combate y las condiciones de victoria. El texto de reglas complejo todavía no se ejecuta y se marca en cada carta.")}</p>
    </section>
  </main>`;
}

function render(): void {
  if (!view) { root!.innerHTML = landingHtml(); wireLanding(); return; }
  const me = seatOf(view.viewerSeat)!;
  const opponents = view.players.filter((player) => player.seat !== view!.viewerSeat);
  const pass = passAction();
  const myTurn = view.waitingOn === view.viewerSeat;
  const commander = me.commandZone[0];
  const winner = view.finished ? seatOf(view.winnerSeat ?? -1) : undefined;

  root!.innerHTML = `<main class="shell${ui.busy ? " busy" : ""}">
    <header class="topbar">
      <a class="brand" href="#">PROSSH<span>TCG</span></a>
      <div class="match-name">Commander · ${view.players.length} jugadores <span class="live">Turno ${view.turn}</span><span class="live">${escapeHtml(view.stepLabel)}</span></div>
      <button id="profile" class="profile-avatar" aria-label="Abrir perfil">${selectedAvatar ? `<img src="${escapeHtml(selectedAvatar)}" alt="Avatar"/>` : "MP"}</button>
    </header>

    <section class="command-strip">
      <div><strong>${escapeHtml(seatOf(view.activeSeat)?.name ?? "")}</strong><span>es el jugador activo</span></div>
      <div class="priority"><span class="pulse${myTurn ? "" : " muted"}"></span> Decide: <b>${escapeHtml(seatOf(view.waitingOn ?? -1)?.name ?? "nadie")}</b></div>
      <div class="strip-actions">
        <button id="new-cedh" class="ghost">Nueva cEDH</button>
        <button id="new-precon" class="ghost">Precons</button>
        <button id="search" class="ghost">Catálogo</button>
      </div>
    </section>

    ${winner || view.finished ? `<section class="winner-banner">${winner ? `<b>${escapeHtml(winner.name)}</b> gana la partida.` : "La partida terminó en empate."} <button id="rematch" class="pass">Jugar otra</button></section>` : ""}

    <section class="phase-track" aria-label="Fases del turno">
      ${STEP_ORDER.map((step) => `<span class="phase-pip${view!.step === step ? " current" : ""}">${escapeHtml(STEP_LABELS[step])}</span>`).join("")}
    </section>

    <section class="opponent-table" aria-label="Campos de los oponentes">${opponents.map((player, index) => opponentHtml(player, index)).join("")}</section>

    ${combatBarHtml()}

    <section class="self-area" aria-label="Tu campo de batalla">
      <div class="self-summary">
        <div class="self-identity"><span class="seat active">${view.viewerSeat + 1}</span><div><b>${escapeHtml(me.name)}</b><span>${escapeHtml(me.deckName)}</span></div>
          <button type="button" class="life-button" data-target-player="${me.seat}"><strong>${me.lost ? "✕" : me.life}</strong><small>vidas</small></button>${commanderDamageHtml(me)}</div>
        ${commander ? `<div class="commander-frame"><div class="commander-art"${commander.image_normal ? ` style="background-image:url('${escapeHtml(commander.image_normal)}')"` : ""}></div><div class="commander-caption"><b>${escapeHtml(commander.name)}</b><span>Zona de mando · ${escapeHtml(commander.mana_cost)}</span></div></div>` : ""}
        <div class="self-zones">
          <button type="button" data-zone="library" data-seat="${me.seat}">Biblioteca <b>${me.libraryCount}</b></button>
          <button type="button" data-zone="graveyard" data-seat="${me.seat}">Cementerio <b>${me.graveyard.length}</b></button>
          <button type="button" data-zone="exile" data-seat="${me.seat}">Exilio <b>${me.exile.length}</b></button>
          <span class="mana-readout" title="Maná que aún puedes producer sin desenderezar">Maná <b>${me.availableMana}</b></span>
        </div>
      </div>
      <div class="self-battlefield">${battlefieldHtml(me, true)}</div>
    </section>

    <section class="lower">
      <aside class="log">
        <h2>Pila</h2>${stackHtml()}
        <h2>Registro</h2>
        <div class="log-lines">${[...view.log].reverse().slice(0, 14).map((entry) => `<p><i>T${entry.turn}</i> ${escapeHtml(entry.text)}</p>`).join("")}</div>
      </aside>

      <section class="hand-wrap">
        <div class="hand-label">Tu mano · ${me.handCount} cartas <span>${escapeHtml(ui.notice || (myTurn ? "Las cartas resaltadas se pueden jugar ahora." : "Esperando a los demás jugadores…"))}</span></div>
        <div class="hand">${handHtml(me)}</div>
        <div class="actions">
          ${ui.pendingTarget ? `<button id="cancel-target" class="secondary">Cancelar objetivo</button>` : ""}
          <button id="pass" class="pass" ${pass ? "" : "disabled"}>${escapeHtml(pass?.label ?? "Sin prioridad")} <kbd>Espacio</kbd></button>
          <label class="toggle"><input id="auto-pass" type="checkbox" ${me.kind === "human" ? "" : "disabled"} ${viewAutoPass() ? "checked" : ""}/> Auto-pasar sin jugadas</label>
        </div>
      </section>

      <aside class="actions-panel">
        <h2>Acciones legales</h2>
        ${view.legalActions.length
          ? `<div class="action-list">${view.legalActions.map((entry, index) => `<button type="button" class="action-row" data-action-index="${index}" title="${escapeHtml(entry.note ?? "")}">${escapeHtml(entry.label)}${entry.manaValue ? `<i>${entry.manaValue}</i>` : ""}</button>`).join("")}</div>`
          : `<p class="stack-empty">No te toca decidir.</p>`}
      </aside>
    </section>
  </main>`;

  wireBoard();
}

/** The engine owns auto-pass; the checkbox mirrors whether the seat is currently skipping. */
let autoPassMirror = true;
function viewAutoPass(): boolean { return autoPassMirror; }

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function wireLanding(): void {
  document.querySelector("#start-cedh")?.addEventListener("click", () => void startMatch("cedh"));
  document.querySelector("#start-precon")?.addEventListener("click", () => { dialog("precon-dialog")?.showModal(); void loadPrecons(); });
  document.querySelector("#open-catalog")?.addEventListener("click", () => dialog("catalog")?.showModal());
}

function wireBoard(): void {
  document.querySelector("#pass")?.addEventListener("click", () => { const action = passAction(); if (action) void submit(action.action); });
  document.querySelector("#new-cedh")?.addEventListener("click", () => void startMatch("cedh"));
  document.querySelector("#rematch")?.addEventListener("click", () => void startMatch("cedh"));
  document.querySelector("#new-precon")?.addEventListener("click", () => { dialog("precon-dialog")?.showModal(); void loadPrecons(); });
  document.querySelector("#search")?.addEventListener("click", () => dialog("catalog")?.showModal());
  document.querySelector("#profile")?.addEventListener("click", () => { dialog("profile-dialog")?.showModal(); void loadAvatars(); });
  document.querySelector("#cancel-target")?.addEventListener("click", () => { ui.pendingTarget = null; ui.notice = ""; render(); });
  document.querySelector<HTMLInputElement>("#auto-pass")?.addEventListener("change", (event) => {
    autoPassMirror = (event.target as HTMLInputElement).checked;
    void setAutoPass(autoPassMirror);
  });

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

  document.querySelector("#confirm-attack")?.addEventListener("click", () =>
    void submit({ type: "declare-attackers", attackers: [...ui.attackers.entries()].map(([instanceId, defender]) => ({ instanceId, defender })) }));

  document.querySelector("#confirm-block")?.addEventListener("click", () =>
    void submit({ type: "declare-blockers", blockers: [...ui.blockers.entries()].map(([instanceId, attackerId]) => ({ instanceId, attackerId })) }));

  document.querySelectorAll<HTMLButtonElement>("[data-action-index]").forEach((button) =>
    button.addEventListener("click", () => {
      const entry = view?.legalActions[Number(button.dataset.actionIndex)];
      if (!entry) return;
      if (entry.requiresTarget) { onCardClick(entry.cardId ?? ""); return; }
      void submit(entry.action);
    }));

  document.querySelectorAll<HTMLButtonElement>("[data-zone]").forEach((button) =>
    button.addEventListener("click", () => showZone(Number(button.dataset.seat), button.dataset.zone as "library" | "hand" | "graveyard" | "exile")));
}

function onPermanentClick(instanceId: string): void {
  if (!view) return;
  if (isTargetable(instanceId)) { chooseTarget({ kind: "permanent", instanceId }); return; }
  if (view.combat.awaitingAttackers && view.selectableAttackers.includes(instanceId)) { toggleAttacker(instanceId); return; }
  if (view.combat.awaitingBlockersFrom.includes(view.viewerSeat)) {
    if (view.selectableBlockers.includes(instanceId)) { onBlockerClick(instanceId); return; }
    if (view.combat.attackers.some((entry) => entry.instanceId === instanceId)) { assignBlock(instanceId); return; }
  }
  showCard(instanceId);
}

function showCard(instanceId: string): void {
  const permanent = view?.players.flatMap((player) => player.battlefield).find((candidate) => candidate.instance_id === instanceId);
  const body = document.querySelector<HTMLElement>("#card-body");
  if (!permanent || !body) return;
  body.innerHTML = `<div class="catalog-top"><h2>${escapeHtml(permanent.name)}</h2><button type="button" data-close="card-dialog" aria-label="Cerrar">×</button></div>
    <div class="card-detail">
      ${permanent.image_normal ? `<img src="${escapeHtml(permanent.image_normal)}" alt="${escapeHtml(permanent.name)}"/>` : ""}
      <div>
        <p class="type">${escapeHtml(permanent.type_line)} ${manaCostHtml(permanent.mana_cost)}</p>
        ${permanent.power !== null ? `<p class="type">Fuerza/resistencia ${permanent.power}/${permanent.toughness}${permanent.damage ? ` · daño marcado ${permanent.damage}` : ""}</p>` : ""}
        <pre>${escapeHtml(permanent.oracle_text || "Sin texto de reglas.")}</pre>
        <p class="coverage ${permanent.fullyImplemented ? "ok" : "partial"}">${permanent.fullyImplemented ? "El motor ejecuta todo el texto de esta carta." : "El motor todavía no ejecuta el texto de esta carta; solo su cuerpo, tipos y palabras clave de combate."}</p>
      </div>
    </div>`;
  wireCloseButtons();
  dialog("card-dialog")?.showModal();
}

function showZone(seat: number, zone: "library" | "hand" | "graveyard" | "exile"): void {
  const player = seatOf(seat);
  const body = document.querySelector<HTMLElement>("#zone-body");
  if (!player || !body) return;
  const hidden = zone === "library" || (zone === "hand" && seat !== view?.viewerSeat);
  const cards = zone === "graveyard" ? player.graveyard : zone === "exile" ? player.exile : zone === "hand" ? (player.hand ?? []) : [];
  const label = { library: "biblioteca", hand: "mano", graveyard: "cementerio", exile: "exilio" }[zone];
  body.innerHTML = `<div class="catalog-top"><h2>${escapeHtml(player.name)} · ${label}</h2><button type="button" data-close="zone-view" aria-label="Cerrar">×</button></div>
    ${hidden
      ? `<p class="zone-private">Zona oculta. El servidor nunca envía estas cartas: solo el conteo (${zone === "library" ? player.libraryCount : player.handCount}).</p>`
      : cards.length
        ? `<div class="zone-cards">${cards.map((card) => `<article>${card.image_normal ? `<img src="${escapeHtml(card.image_normal)}" alt="${escapeHtml(card.name)}"/>` : ""}<b>${escapeHtml(card.name)}</b></article>`).join("")}</div>`
        : `<p class="zone-private">No hay cartas en esta zona pública.</p>`}`;
  wireCloseButtons();
  dialog("zone-view")?.showModal();
}

function wireCloseButtons(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-close]").forEach((button) => {
    button.onclick = () => dialog(button.dataset.close!)?.close();
  });
}

// ---------------------------------------------------------------------------
// Side panels
// ---------------------------------------------------------------------------

async function loadPrecons(query = ""): Promise<void> {
  const container = document.querySelector<HTMLElement>("#precon-results");
  if (!container) return;
  try {
    const payload = await api<{ data?: PreconSummary[] }>(`/api/decks/precons?limit=24&q=${encodeURIComponent(query)}`);
    preconResults = payload.data ?? [];
    container.innerHTML = preconResults.length
      ? preconResults.map((deck) => `<button type="button" class="precon-card" data-precon="${escapeHtml(deck.id)}">
          ${deck.cover_art_uri ? `<img src="${escapeHtml(deck.cover_art_uri)}" alt=""/>` : ""}
          <span><b>${escapeHtml(deck.name)}</b><small>${escapeHtml(deck.commanders.join(" / "))} · ${escapeHtml(deck.set_code)}</small></span>
        </button>`).join("")
      : "<p>Sin resultados.</p>";
    container.querySelectorAll<HTMLButtonElement>("[data-precon]").forEach((button) =>
      button.addEventListener("click", () => { dialog("precon-dialog")?.close(); void startMatch("precon", button.dataset.precon!); }));
  } catch (error) {
    container.innerHTML = `<p>${escapeHtml(error instanceof Error ? error.message : "No se pudieron cargar los precons.")}</p>`;
  }
}

async function searchCards(query: string): Promise<void> {
  const container = document.querySelector<HTMLDivElement>("#results");
  if (!container || query.trim().length < 2) return;
  container.innerHTML = "<p>Consultando catálogo…</p>";
  try {
    const payload = await api<{ data?: Array<{ id: string; name: string; type_line: string; mana_cost?: string; image_uris?: { small?: string }; scryfall_uri: string }> }>(
      `/api/catalog/search?q=${encodeURIComponent(query)}`);
    container.innerHTML = (payload.data ?? []).slice(0, 12).map((card) => {
      const terms = card.type_line.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
      return `<article class="result"><a class="result-card" href="${escapeHtml(card.scryfall_uri)}" target="_blank" rel="noreferrer">
        ${card.image_uris?.small ? `<img loading="lazy" src="${escapeHtml(card.image_uris.small)}" alt=""/>` : ""}
        <span><b>${escapeHtml(card.name)}</b><small>${escapeHtml(card.type_line)} ${escapeHtml(card.mana_cost ?? "")}</small></span></a>
        <div class="metadata-tags">${terms.map((term) => `<button type="button" data-type-query="${escapeHtml(term)}">${escapeHtml(term)}</button>`).join("")}</div>
      </article>`;
    }).join("") || "<p>Sin resultados.</p>";
    container.querySelectorAll<HTMLButtonElement>("[data-type-query]").forEach((button) => button.addEventListener("click", () => {
      const input = document.querySelector<HTMLInputElement>("#card-query");
      if (!input) return;
      input.value = `t:${button.dataset.typeQuery}`;
      void searchCards(input.value);
    }));
  } catch { container.innerHTML = "<p>No se pudo conectar al catálogo. Inicia el servidor local.</p>"; }
}

async function loadAvatars(): Promise<void> {
  const grid = document.querySelector<HTMLElement>("#avatar-grid");
  if (!grid || avatarChoices.length) return renderAvatars();
  const names = ["Birds of Paradise", "Liliana of the Veil", "Jace, the Mind Sculptor", "Atraxa, Grand Unifier"];
  const results = await Promise.all(names.map(async (name) => {
    try {
      const card = await api<{ name?: string; image_uris?: { art_crop?: string } }>(`/api/catalog/named?name=${encodeURIComponent(name)}`);
      return card.image_uris?.art_crop ? { name: card.name ?? name, image: card.image_uris.art_crop } : null;
    } catch { return null; }
  }));
  avatarChoices = results.filter((choice): choice is AvatarChoice => choice !== null);
  renderAvatars();
}

function renderAvatars(): void {
  const grid = document.querySelector<HTMLElement>("#avatar-grid");
  if (!grid) return;
  grid.innerHTML = avatarChoices.length
    ? avatarChoices.map((avatar) => `<button type="button" class="avatar-choice${selectedAvatar === avatar.image ? " selected" : ""}" data-avatar="${escapeHtml(avatar.image)}">
        <img src="${escapeHtml(avatar.image)}" alt="${escapeHtml(avatar.name)}"/><span>${escapeHtml(avatar.name)}</span></button>`).join("")
    : "<p>No se pudieron cargar los recortes de arte.</p>";
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

document.querySelector<HTMLInputElement>("#card-query")?.addEventListener("input", (event) => void searchCards((event.target as HTMLInputElement).value));
document.querySelector<HTMLInputElement>("#precon-query")?.addEventListener("input", (event) => void loadPrecons((event.target as HTMLInputElement).value));
wireCloseButtons();

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) return;
  if (event.code === "Space") { event.preventDefault(); document.querySelector<HTMLButtonElement>("#pass")?.click(); }
  if (event.code === "Escape" && ui.pendingTarget) { ui.pendingTarget = null; ui.notice = ""; render(); }
});

const stored = window.sessionStorage.getItem("prossh.match");
if (stored) {
  try {
    session = JSON.parse(stored) as MatchSession;
    void refresh();
  } catch { window.sessionStorage.removeItem("prossh.match"); }
}
render();
