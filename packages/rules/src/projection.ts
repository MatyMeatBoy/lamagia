/**
 * The security boundary between the authoritative state and one seat's client.
 *
 * A projection is the only shape that ever leaves the server. Hidden zones are
 * reduced to counts for every seat except the viewer, so an opponent's hand and
 * library contents are structurally absent rather than merely hidden in the UI.
 */

import { cardProfile, type TriggerEvent } from "./characteristics.js";
import {
  STEP_LABELS, defendersAwaitingBlocks, legalActions, legalAttackers, legalBlockers, legalTargets, manaSourcePotential, powerOf, toughnessOf,
  type GameCard, type GameState, type LegalAction, type LogEntry, type Permanent, type SeatId, type Target, type TurnStep
} from "./engine.js";
import { emptyPool, type ManaPool } from "./mana.js";

export interface CardView {
  readonly instance_id: string;
  readonly scryfall_id: string;
  readonly name: string;
  readonly mana_cost: string;
  readonly manaValue: number;
  readonly type_line: string;
  readonly oracle_text: string;
  readonly image_normal?: string;
  readonly image_art_crop?: string;
  readonly power: number | null;
  readonly toughness: number | null;
  readonly keywords: readonly string[];
  readonly colors: readonly string[];
  readonly isPermanent: boolean;
  readonly fullyImplemented: boolean;
}

/** One printed ability of a permanent, as the table needs to show it. */
export interface AbilityView {
  readonly index: number;
  readonly kind: "mana" | "activated" | "triggered";
  readonly text: string;
  /** Set for triggered abilities so the client can pick the right icon. */
  readonly event?: TriggerEvent;
  /** True when the viewer can activate it right now. */
  readonly available: boolean;
}

export interface PermanentView extends CardView {
  readonly abilities: readonly AbilityView[];
  readonly controller: SeatId;
  readonly tapped: boolean;
  readonly summoningSick: boolean;
  readonly damage: number;
  readonly counters: Readonly<Record<string, number>>;
  readonly isCommander: boolean;
  readonly attacking: SeatId | null;
  readonly blocking: string | null;
  readonly blockedBy: readonly string[];
  readonly producesMana: boolean;
  readonly attachedTo?: string;
}

export interface PlayerView {
  readonly seat: SeatId;
  readonly name: string;
  readonly deckName: string;
  readonly kind: "human" | "bot";
  readonly life: number;
  readonly lost: boolean;
  readonly lossReason?: string;
  readonly libraryCount: number;
  readonly handCount: number;
  /** Present only for the viewer's own seat. */
  readonly hand?: readonly CardView[];
  readonly battlefield: readonly PermanentView[];
  readonly graveyard: readonly CardView[];
  readonly exile: readonly CardView[];
  readonly commandZone: readonly CardView[];
  readonly commanderDamage: Readonly<Record<string, number>>;
  readonly landsPlayedThisTurn: number;
  readonly manaPool: ManaPool;
  /** Untapped mana the viewer could still produce; opponents report zero. */
  readonly availableMana: number;
}

export interface StackView {
  readonly id: string;
  readonly controller: SeatId;
  readonly name: string;
  readonly image_normal?: string;
  readonly targets: readonly string[];
  readonly countered: boolean;
}

/** Cards the viewer is allowed to inspect during an active library search. */
export interface LibrarySearchView {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly destination: "top" | "hand" | "graveyard" | "battlefield";
  /** Every card matching the effect's type/subtype restriction. */
  readonly candidates: readonly CardView[];
  /** The complete library, available only to the searching player. */
  readonly allCards: readonly CardView[];
}

export interface GameView {
  readonly viewerSeat: SeatId;
  readonly version: number;
  readonly turn: number;
  readonly step: TurnStep;
  readonly stepLabel: string;
  readonly activeSeat: SeatId;
  readonly prioritySeat: SeatId;
  readonly priorityOpen: boolean;
  readonly finished: boolean;
  readonly winnerSeat: SeatId | null;
  readonly players: readonly PlayerView[];
  readonly stack: readonly StackView[];
  /** Present only for the player currently resolving a library search. */
  readonly librarySearch: LibrarySearchView | null;
  readonly combat: {
    readonly attackers: readonly { readonly instanceId: string; readonly name: string; readonly defender: SeatId }[];
    readonly blockers: readonly { readonly instanceId: string; readonly name: string; readonly attackerId: string }[];
    readonly awaitingAttackers: boolean;
    readonly awaitingBlockersFrom: readonly SeatId[];
  };
  readonly log: readonly LogEntry[];
  /** What this viewer may do right now. Empty when it is not their decision. */
  readonly legalActions: readonly LegalAction[];
  readonly selectableAttackers: readonly string[];
  readonly selectableBlockers: readonly string[];
  /** Targets this viewer may pick, grouped by what a spell asks for. */
  readonly targetOptions: Readonly<Record<string, readonly Target[]>>;
  readonly waitingOn: SeatId | null;
}

function cardView(card: GameCard): CardView {
  const profile = cardProfile(card);
  return {
    instance_id: card.instance_id,
    scryfall_id: card.scryfall_id,
    name: card.name,
    mana_cost: card.mana_cost ?? "",
    manaValue: profile.manaValue,
    type_line: card.type_line,
    oracle_text: card.oracle_text ?? "",
    ...(card.image_normal ? { image_normal: card.image_normal } : {}),
    ...(card.image_art_crop ? { image_art_crop: card.image_art_crop } : {}),
    power: profile.power,
    toughness: profile.toughness,
    keywords: profile.keywords,
    colors: profile.colors,
    isPermanent: profile.isPermanent,
    fullyImplemented: profile.fullyImplemented
  };
}

/**
 * The printed abilities of one permanent.
 *
 * Availability is read from `legalActions` rather than recomputed, so an icon
 * is never lit for something the authoritative path would refuse.
 */
function abilitiesOf(permanent: Permanent, available: readonly LegalAction[]): AbilityView[] {
  const profile = cardProfile(permanent.card);
  const canActivate = (kind: "activate" | "activate-mana", index: number) => available.some((entry) =>
    entry.action.type === kind && entry.action.sourceId === permanent.instance_id && entry.action.abilityIndex === index);
  return [
    ...profile.manaAbilities.map((ability): AbilityView => ({
      index: ability.index, kind: "mana", text: ability.text, available: canActivate("activate-mana", ability.index)
    })),
    ...profile.activatedAbilities.map((ability): AbilityView => ({
      index: ability.index, kind: "activated", text: ability.text, available: canActivate("activate", ability.index)
    })),
    ...profile.triggers.map((trigger, index): AbilityView => ({
      index, kind: "triggered", text: trigger.sourceText, event: trigger.event, available: false
    }))
  ];
}

function effectiveKeywords(state: GameState, permanent: Permanent): readonly string[] {
  const keywords = new Set<string>(cardProfile(permanent.card).keywords);
  for (const keyword of permanent.temporaryKeywords ?? []) keywords.add(keyword);
  if (cardProfile(permanent.card).types.includes("Creature")) {
    for (const source of state.players.flatMap((player) => player.battlefield)) {
      if (source.controller !== permanent.controller) continue;
      for (const grant of cardProfile(source.card).staticKeywordGrants) {
        if (grant.scope === "creatures-you-control" || (grant.scope === "other-creatures-you-control" && source.instance_id !== permanent.instance_id)) keywords.add(grant.keyword);
      }
    }
  }
  for (const equipment of state.players.flatMap((player) => player.battlefield).filter((candidate) => candidate.attachedTo === permanent.instance_id)) {
    for (const keyword of cardProfile(equipment.card).equipmentModification?.keywords ?? []) keywords.add(keyword);
  }
  return [...keywords];
}

function permanentView(state: GameState, permanent: Permanent, available: readonly LegalAction[]): PermanentView {
  const attacking = state.combat.attackers.find((entry) => entry.instanceId === permanent.instance_id);
  const blocking = state.combat.blockers.find((entry) => entry.instanceId === permanent.instance_id);
  const blockedBy = state.combat.blockers.filter((entry) => entry.attackerId === permanent.instance_id).map((entry) => entry.instanceId);
  return {
    ...cardView(permanent.card),
    instance_id: permanent.instance_id,
    power: powerOf(permanent, state),
    toughness: toughnessOf(permanent, state),
    keywords: effectiveKeywords(state, permanent),
    abilities: abilitiesOf(permanent, available),
    controller: permanent.controller,
    tapped: permanent.tapped,
    summoningSick: permanent.summoningSick,
    damage: permanent.damage,
    counters: permanent.counters,
    isCommander: permanent.isCommander,
    attacking: attacking ? attacking.defender : null,
    blocking: blocking ? blocking.attackerId : null,
    blockedBy,
    producesMana: cardProfile(permanent.card).manaAbilities.length > 0,
    ...(permanent.attachedTo ? { attachedTo: permanent.attachedTo } : {})
  };
}

function nameOf(state: GameState, instanceId: string): string {
  for (const player of state.players) {
    const found = player.battlefield.find((permanent) => permanent.instance_id === instanceId);
    if (found) return found.card.name;
  }
  return "criatura";
}

/** Builds the filtered view one seat is allowed to receive. */
export function projectGame(state: GameState, viewerSeat: SeatId): GameView {
  if (viewerSeat < 0 || viewerSeat >= state.players.length) throw new Error("Ese asiento no participa en esta partida.");
  const awaitingBlockers = defendersAwaitingBlocks(state);
  const viewer = state.players[viewerSeat]!;
  const viewerActions = legalActions(state, viewerSeat);

  const players: PlayerView[] = state.players.map((player) => ({
    seat: player.seat,
    name: player.name,
    deckName: player.deckName,
    kind: player.kind,
    life: player.life,
    lost: player.lost,
    ...(player.lossReason ? { lossReason: player.lossReason } : {}),
    libraryCount: player.library.length,
    handCount: player.hand.length,
    ...(player.seat === viewerSeat ? { hand: player.hand.map(cardView) } : {}),
    battlefield: player.battlefield.map((permanent) => permanentView(state, permanent, player.seat === viewerSeat ? viewerActions : [])),
    graveyard: player.graveyard.map(cardView),
    exile: player.exile.map(cardView),
    commandZone: player.commandZone.map(cardView),
    commanderDamage: player.commanderDamage,
    landsPlayedThisTurn: player.landsPlayedThisTurn,
    manaPool: player.seat === viewerSeat ? player.manaPool : emptyPool(),
    availableMana: player.seat === viewerSeat ? manaSourcePotential(player) : 0
  }));

  const mustDeclareAttackers = state.step === "declare-attackers" && !state.combat.attackersDeclared;
  const mustDeclareBlockers = state.step === "declare-blockers" && !state.combat.blockersDeclared;

  const pendingSearch = state.pendingChoice?.type === "search-library" && state.pendingChoice.seat === viewerSeat
    ? state.pendingChoice
    : null;
  const librarySearch: LibrarySearchView | null = pendingSearch
    ? {
        sourceId: pendingSearch.sourceId,
        sourceName: pendingSearch.sourceCard.name,
        destination: pendingSearch.search.destination,
        candidates: state.players[viewerSeat]!.library
          .filter((card) => pendingSearch.optionIds.includes(card.instance_id))
          .map(cardView),
        allCards: state.players[viewerSeat]!.library.map(cardView)
      }
    : null;

  const targetKinds = new Set<string>([
    "any", "player", "creature", "spell", "creature-spell", "noncreature-spell", "permanent", "artifact-or-enchantment", "creature-power-at-least-5", "creature-toughness-at-least-4",
    "artifact-creature-or-planeswalker", "artifact-enchantment-or-land", "artifact",
    "nonland", "nonartifact-creature", "creature-you-control", "land-you-control", "enchantment", "land",
    "player-or-planeswalker", "card-in-your-graveyard", "creature-card-in-your-graveyard", "artifact-card-in-your-graveyard", "enchantment-card-in-your-graveyard", "land-card-in-a-graveyard",
    ...viewerActions.flatMap((action) => action.requiresTarget ? [action.requiresTarget] : [])
  ]);
  const targetOptions = Object.fromEntries([...targetKinds].map((kind) => [kind, legalTargets(state, viewerSeat, kind as Exclude<import("./characteristics.js").TargetKind, "none">)]));

  return {
    viewerSeat,
    version: state.version,
    turn: state.turn,
    step: state.step,
    stepLabel: STEP_LABELS[state.step],
    activeSeat: state.activeSeat,
    prioritySeat: state.prioritySeat,
    priorityOpen: state.priorityOpen,
    finished: state.finished,
    winnerSeat: state.winnerSeat,
    players,
    stack: state.stack.map((object) => ({
      id: object.id,
      controller: object.controller,
      name: object.card.name,
      ...(object.card.image_normal ? { image_normal: object.card.image_normal } : {}),
      targets: object.targets.map((target) =>
        target.kind === "player" ? state.players[target.seat]!.name
          : target.kind === "permanent" ? nameOf(state, target.instanceId)
            : target.kind === "graveyard-card" ? state.players[target.seat]!.graveyard.find((card) => card.instance_id === target.instanceId)?.name ?? "carta del cementerio"
            : state.stack.find((entry) => entry.id === target.stackId)?.card.name ?? "hechizo"),
      countered: object.countered
    })),
    librarySearch,
    combat: {
      attackers: state.combat.attackers.map((entry) => ({ instanceId: entry.instanceId, name: nameOf(state, entry.instanceId), defender: entry.defender })),
      blockers: state.combat.blockers.map((entry) => ({ instanceId: entry.instanceId, name: nameOf(state, entry.instanceId), attackerId: entry.attackerId })),
      awaitingAttackers: mustDeclareAttackers,
      awaitingBlockersFrom: awaitingBlockers
    },
    log: state.log.slice(-60),
    legalActions: viewerActions,
    selectableAttackers: mustDeclareAttackers && state.activeSeat === viewerSeat && !viewer.lost
      ? legalAttackers(state, viewerSeat).map((permanent) => permanent.instance_id)
      : [],
    selectableBlockers: mustDeclareBlockers && awaitingBlockers.includes(viewerSeat)
      ? legalBlockers(state, viewerSeat).map((permanent) => permanent.instance_id)
      : [],
    targetOptions,
    waitingOn: mustDeclareAttackers ? state.activeSeat : mustDeclareBlockers ? (awaitingBlockers[0] ?? null) : state.priorityOpen ? state.prioritySeat : null
  };
}
