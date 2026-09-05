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
  readonly isCreature: boolean;
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
  readonly destination: "top" | "hand" | "graveyard" | "battlefield" | "multiple";
  /** Multi-card searches expose progress without exposing server-only ids. */
  readonly selectedCount?: number;
  readonly maxSelections?: number;
  /** Every card matching the effect's type/subtype restriction. */
  readonly candidates: readonly CardView[];
  /** The complete library, available only to the searching player. */
  readonly allCards: readonly CardView[];
}

/** The top card is disclosed only to the player resolving Scry. */
export interface ScryView {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly topCards: readonly CardView[];
  readonly remaining: number;
}

/** Top cards disclosed only to the player resolving a look-top effect. */
export interface TopSelectionView {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly stage: "select" | "bottom";
  readonly cards: readonly CardView[];
  readonly eligibleTypes: readonly string[];
  readonly selectedCardId?: string;
}

/**
 * Another player's hand, disclosed only to the one viewer entitled to see it
 * right now (Gitaxian Probe, CR 701.20) — the sole place this engine ever
 * puts one player's hand into a projection other than their own.
 */
export interface ViewedHandView {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly targetSeat: SeatId;
  readonly cards: readonly CardView[];
}

export interface GameView {
  /** Set by the authoritative match registry; no undo snapshots leave it. */
  readonly undoAvailable: boolean;
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
  /** Present only for the player currently resolving Scry. */
  readonly scry: ScryView | null;
  /** Present only for the player currently resolving a top-card selection. */
  readonly topSelection: TopSelectionView | null;
  /** Present only for the player currently entitled to look at another player's hand. */
  readonly viewedHand: ViewedHandView | null;
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
        if (grant.scope === "all-creatures" || grant.scope === "creatures-you-control" || (grant.scope === "other-creatures-you-control" && source.instance_id !== permanent.instance_id)) keywords.add(grant.keyword);
      }
    }
  }
  for (const equipment of state.players.flatMap((player) => player.battlefield).filter((candidate) => candidate.attachedTo === permanent.instance_id)) {
    for (const keyword of cardProfile(equipment.card).equipmentModification?.keywords ?? []) keywords.add(keyword);
  }
  return [...keywords];
}

function permanentView(state: GameState, permanent: Permanent, available: readonly LegalAction[]): PermanentView {
  const isCreature = cardProfile(permanent.card).types.includes("Creature");
  const attacking = state.combat.attackers.find((entry) => entry.instanceId === permanent.instance_id);
  const blocking = state.combat.blockers.find((entry) => entry.instanceId === permanent.instance_id);
  const blockedBy = state.combat.blockers.filter((entry) => entry.attackerId === permanent.instance_id).map((entry) => entry.instanceId);
  return {
    ...cardView(permanent.card),
    instance_id: permanent.instance_id,
    isCreature,
    power: isCreature ? powerOf(permanent, state) : null,
    toughness: isCreature ? toughnessOf(permanent, state) : null,
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

  const pendingSearch = (state.pendingChoice?.type === "search-library" || state.pendingChoice?.type === "search-library-multi") && state.pendingChoice.seat === viewerSeat
    ? state.pendingChoice
    : null;
  const librarySearch: LibrarySearchView | null = pendingSearch
    ? pendingSearch.type === "search-library"
      ? {
        sourceId: pendingSearch.sourceId,
        sourceName: pendingSearch.sourceCard.name,
        destination: pendingSearch.search.destination,
        candidates: state.players[viewerSeat]!.library
          .filter((card) => pendingSearch.optionIds.includes(card.instance_id))
          .map(cardView),
        allCards: state.players[viewerSeat]!.library.map(cardView)
      }
      : {
        sourceId: pendingSearch.sourceId,
        sourceName: pendingSearch.sourceCard.name,
        destination: "multiple",
        selectedCount: pendingSearch.selectedIds.length,
        maxSelections: pendingSearch.search.destinations.length,
        candidates: state.players[viewerSeat]!.library
          .filter((card) => pendingSearch.optionIds.includes(card.instance_id) && !pendingSearch.selectedIds.includes(card.instance_id))
          .map(cardView),
        allCards: state.players[viewerSeat]!.library.map(cardView)
      }
    : null;
  const pendingScry = state.pendingChoice?.type === "scry" && state.pendingChoice.seat === viewerSeat
    ? state.pendingChoice : null;
  const scry: ScryView | null = pendingScry ? {
    sourceId: pendingScry.sourceId,
    sourceName: pendingScry.sourceCard.name,
    topCards: pendingScry.remainingCards.map(cardView),
    remaining: pendingScry.remainingCards.length
  } : null;
  const pendingTopSelection = state.pendingChoice?.type === "look-top-select" && state.pendingChoice.seat === viewerSeat
    ? state.pendingChoice : null;
  const topSelection: TopSelectionView | null = pendingTopSelection ? {
    sourceId: pendingTopSelection.sourceId,
    sourceName: pendingTopSelection.sourceCard.name,
    stage: pendingTopSelection.stage,
    cards: pendingTopSelection.remainingCards.map(cardView),
    eligibleTypes: pendingTopSelection.types,
    ...(pendingTopSelection.selectedCardId ? { selectedCardId: pendingTopSelection.selectedCardId } : {})
  } : null;
  // Gitaxian Probe: the target's hand is included ONLY when THIS viewer is
  // the one entitled to see it (`choice.seat`), never for the target
  // themselves or any other seat — the projection for every other viewer
  // simply never computes this field at all.
  const pendingViewHand = state.pendingChoice?.type === "view-hand" && state.pendingChoice.seat === viewerSeat
    ? state.pendingChoice : null;
  const viewedHand: ViewedHandView | null = pendingViewHand ? {
    sourceId: pendingViewHand.sourceId,
    sourceName: pendingViewHand.sourceCard.name,
    targetSeat: pendingViewHand.targetSeat,
    cards: state.players[pendingViewHand.targetSeat]!.hand.map(cardView)
  } : null;

  const targetKinds = new Set<string>([
    "any", "player", "creature", "spell", "creature-spell", "noncreature-spell", "permanent", "artifact-or-enchantment", "creature-with-defender", "creature-with-deathtouch", "creature-with-lifelink", "creature-with-menace", "creature-with-haste", "creature-with-first-strike", "creature-with-double-strike", "creature-with-trample", "creature-with-vigilance", "creature-with-indestructible", "creature-with-hexproof", "creature-with-shroud", "creature-with-reach", "creature-power-at-least-5", "creature-power-at-most-4", "creature-toughness-at-least-4", "creature-toughness-at-most-4",
    "artifact-creature-or-planeswalker", "artifact-enchantment-or-land", "artifact",
    "nonland", "nonartifact-creature", "non-demon-creature", "creature-you-control", "land-you-control", "enchantment", "land",
    "attacking-or-blocking-creature",
    "player-or-planeswalker", "card-in-your-graveyard", "card-in-a-graveyard", "creature-card-in-your-graveyard", "creature-card-in-a-graveyard", "artifact-card-in-your-graveyard", "artifact-card-in-a-graveyard", "enchantment-card-in-your-graveyard", "enchantment-card-in-a-graveyard", "land-card-in-a-graveyard",
    ...viewerActions.flatMap((action) => action.requiresTarget ? [action.requiresTarget] : [])
  ]);
  const targetOptions = Object.fromEntries([...targetKinds].map((kind) => [kind, legalTargets(state, viewerSeat, kind as Exclude<import("./characteristics.js").TargetKind, "none">)]));

  return {
    viewerSeat,
    version: state.version,
    undoAvailable: false,
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
    scry,
    topSelection,
    viewedHand,
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
