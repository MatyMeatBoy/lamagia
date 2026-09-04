/**
 * Deterministic bot policy.
 *
 * The bot never touches game state directly: it reads `legalActions` and
 * returns one of them, exactly like a human client. That keeps a bot game a
 * valid regression test for the rules engine rather than a parallel simulation.
 */

import { cardProfile, isCreature, isLand } from "./characteristics.js";
import {
  applyAction, defendersAwaitingBlocks, legalAttackers, legalBlockers, legalTargets, legalActions, maxAttackersForDefender,
  type AttackerDeclaration, type BlockerDeclaration, type GameAction, type GameState, type Permanent, type SeatId
} from "./engine.js";
import type { TargetKind } from "./characteristics.js";

export interface BotDecision {
  readonly turn: number;
  readonly step: string;
  readonly seat: SeatId;
  readonly action: GameAction;
  readonly label: string;
}

function power(permanent: Permanent): number { return cardProfile(permanent.card).power ?? 0; }
function toughness(permanent: Permanent): number { return cardProfile(permanent.card).toughness ?? 0; }
function keyword(permanent: Permanent, name: string): boolean { return cardProfile(permanent.card).keywords.includes(name as never); }

/** Lowest life among the bot's living opponents; ties break to the lowest seat for determinism. */
function preferredDefender(state: GameState, seat: SeatId): SeatId | null {
  const opponents = state.players.filter((player) => player.seat !== seat && !player.lost);
  if (!opponents.length) return null;
  return [...opponents].sort((left, right) => left.life - right.life || left.seat - right.seat)[0]!.seat;
}

function chooseAttackers(state: GameState, seat: SeatId): AttackerDeclaration[] {
  const defender = preferredDefender(state, seat);
  if (defender === null) return [];
  const candidates = legalAttackers(state, seat);
  const defenderBoard = state.players[defender]!.battlefield.filter((permanent) => isCreature(cardProfile(permanent.card)) && !permanent.tapped);
  const biggestBlocker = defenderBoard.reduce((best, permanent) => Math.max(best, power(permanent)), 0);

  return candidates
    .filter((attacker) => {
      if (power(attacker) <= 0) return false;
      // Hold back a creature that simply dies to the best available blocker for nothing.
      const evasive = keyword(attacker, "flying") && !defenderBoard.some((permanent) => keyword(permanent, "flying") || keyword(permanent, "reach"));
      if (evasive || !defenderBoard.length) return true;
      if (keyword(attacker, "indestructible") || keyword(attacker, "deathtouch")) return true;
      return toughness(attacker) > biggestBlocker || power(attacker) >= 4;
    })
    .slice(0, maxAttackersForDefender(state, defender) ?? Number.MAX_SAFE_INTEGER)
    .map((attacker) => ({ instanceId: attacker.instance_id, defender }));
}

function chooseBlockers(state: GameState, seat: SeatId): BlockerDeclaration[] {
  const incoming = state.combat.attackers
    .filter((entry) => entry.defender === seat)
    .map((entry) => ({ entry, permanent: state.players.flatMap((player) => player.battlefield).find((candidate) => candidate.instance_id === entry.instanceId) }))
    .filter((item): item is { entry: AttackerDeclaration; permanent: Permanent } => Boolean(item.permanent))
    .sort((left, right) => power(right.permanent) - power(left.permanent));
  if (!incoming.length) return [];

  const available = [...legalBlockers(state, seat)].sort((left, right) => power(left) - power(right));
  const used = new Set<string>();
  const blocks: BlockerDeclaration[] = [];
  const life = state.players[seat]!.life;
  const totalIncoming = incoming.reduce((total, item) => total + power(item.permanent), 0);
  const mustChump = totalIncoming >= life;

  for (const { entry, permanent: attacker } of incoming) {
    if (keyword(attacker, "menace")) continue; // Needs two blockers; not modeled by this policy.
    const blocker = available.find((candidate) => {
      if (used.has(candidate.instance_id)) return false;
      const attackerProfile = cardProfile(attacker.card);
      const candidateProfile = cardProfile(candidate.card);
      if (attackerProfile.keywords.includes("flying") && !candidateProfile.keywords.includes("flying") && !candidateProfile.keywords.includes("reach")) return false;
      // Fear / intimidate: only artifact or black creatures may block (CR 702.36b).
      if (attackerProfile.keywords.includes("fear") && !candidateProfile.colors.includes("B") && !candidateProfile.types.includes("Artifact")) return false;
      const kills = power(candidate) >= toughness(attacker) || keyword(candidate, "deathtouch");
      const survives = toughness(candidate) > power(attacker) || keyword(candidate, "indestructible");
      return mustChump || kills || survives;
    });
    if (!blocker) continue;
    used.add(blocker.instance_id);
    blocks.push({ instanceId: blocker.instance_id, attackerId: entry.instanceId });
  }
  return blocks;
}

function passOr(available: readonly { action: GameAction; label: string }[]): { action: GameAction; label: string } | null {
  const pass = available.find((entry) => entry.action.type === "pass");
  return pass ? { action: pass.action, label: pass.label } : null;
}

/** Aims removal and burn at opponents, never at the bot's own board. */
function pickTargets(state: GameState, seat: SeatId, kind: Exclude<TargetKind, "none">) {
  const all = legalTargets(state, seat, kind);
  const board = state.players.flatMap((player) => player.battlefield);
  const hostile = all.filter((target) => {
    if (target.kind === "player") return target.seat !== seat;
    if (target.kind === "permanent") return board.find((permanent) => permanent.instance_id === target.instanceId)?.controller !== seat;
    if (target.kind === "graveyard-card") return target.seat === seat;
    return state.stack.find((entry) => entry.id === target.stackId)?.controller !== seat;
  });
  if (!hostile.length) return [];
  // Biggest enemy creature first; otherwise the opponent closest to dying.
  const ranked = [...hostile].sort((left, right) => {
    const leftScore = left.kind === "permanent" ? 100 + (cardProfile(board.find((permanent) => permanent.instance_id === left.instanceId)!.card).power ?? 0) : left.kind === "player" ? 50 - state.players[left.seat]!.life : 200;
    const rightScore = right.kind === "permanent" ? 100 + (cardProfile(board.find((permanent) => permanent.instance_id === right.instanceId)!.card).power ?? 0) : right.kind === "player" ? 50 - state.players[right.seat]!.life : 200;
    return rightScore - leftScore;
  });
  return ranked.slice(0, 1);
}

/** Picks the single action the bot takes with the decision it currently owes. */
export function botAction(state: GameState, seat: SeatId): { action: GameAction; label: string } | null {
  if (state.finished) return null;
  const available = legalActions(state, seat);
  if (!available.length) return null;

  if (state.pendingChoice?.type === "reveal-card" && state.pendingChoice.seat === seat) {
    // The deterministic policy reveals the first valid card when possible;
    // otherwise it accepts the tapped default.
    const reveal = available.find((entry) => entry.action.type === "choose-reveal" && entry.action.reveal);
    const decline = available.find((entry) => entry.action.type === "choose-reveal" && !entry.action.reveal);
    const chosen = reveal ?? decline;
    if (chosen) {
      if (chosen.action.type === "choose-reveal" && chosen.action.reveal && !chosen.action.cardId) {
        const card = available.find((entry) => entry.action.type === "choose-reveal" && entry.action.reveal && entry.action.cardId);
        if (card) return { action: card.action, label: card.label };
      }
      return { action: chosen.action, label: chosen.label };
    }
  }
  if (state.pendingChoice?.type === "optional-trigger" && state.pendingChoice.seat === seat) {
    const accept = available.find((entry) => entry.action.type === "choose-trigger" && entry.action.accept);
    const decline = available.find((entry) => entry.action.type === "choose-trigger" && !entry.action.accept);
    const chosen = accept ?? decline;
    if (chosen) return { action: chosen.action, label: chosen.label };
  }
  if (state.pendingChoice?.type === "trigger-target" && state.pendingChoice.seat === seat) {
    // Same preference as a spell: point the ability at an opponent's board when
    // the effect is hostile, otherwise take the first legal option.
    const hostile = pickTargets(state, seat, state.pendingChoice.targetKind);
    const wanted = hostile[0];
    const chosen = wanted
      ? available.find((entry) => entry.action.type === "choose-trigger-target" && JSON.stringify(entry.action.target) === JSON.stringify(wanted))
      : undefined;
    const fallback = available.find((entry) => entry.action.type === "choose-trigger-target");
    const pick = chosen ?? fallback;
    if (pick) return { action: pick.action, label: pick.label };
  }
  const searchChoice = state.pendingChoice?.type === "search-library" ? state.pendingChoice : null;
  if (searchChoice && searchChoice.seat === seat) {
    const chosen = available.find((entry) => entry.action.type === "choose-library-card");
    const card = state.players[seat]!.library.find((candidate) => searchChoice.optionIds.includes(candidate.instance_id));
    if (chosen && card && chosen.action.type === "choose-library-card") {
      return { action: { ...chosen.action, query: card.name }, label: `busca ${card.name}` };
    }
  }
  if (state.pendingChoice?.type === "discard-cards" && state.pendingChoice.seat === seat) {
    // Discard a surplus land when flooded, otherwise the highest-cost card.
    const hand = state.players[seat]!.hand;
    const lands = hand.filter((card) => isLand(cardProfile(card)));
    const preferred = lands.length > 4 ? lands[lands.length - 1]
      : [...hand].sort((left, right) => (cardProfile(right).cost?.symbols.length ?? 0) - (cardProfile(left).cost?.symbols.length ?? 0))[0];
    const wanted = available.find((entry) => entry.action.type === "choose-discard" && entry.action.cardId === preferred?.instance_id)
      ?? available.find((entry) => entry.action.type === "choose-discard");
    if (wanted) return { action: wanted.action, label: wanted.label };
  }
  if (state.pendingChoice?.type === "scry" && state.pendingChoice.seat === seat) {
    // Deterministic policy: bottom the top card only when the bot is flooded on
    // lands (5+ in play and the card is another land), otherwise keep it.
    const scry = state.pendingChoice;
    const card = scry.remainingCards[0];
    const landsInPlay = state.players[seat]!.battlefield.filter((permanent) => isLand(cardProfile(permanent.card))).length;
    const flooded = Boolean(card && isLand(cardProfile(card)) && landsInPlay >= 5);
    const wanted = available.find((entry) => entry.action.type === "choose-scry" && entry.action.ordinal === 0 && entry.action.bottom === flooded)
      ?? available.find((entry) => entry.action.type === "choose-scry" && entry.action.ordinal === 0);
    if (wanted) return { action: wanted.action, label: wanted.label };
  }

  if (state.step === "declare-attackers" && !state.combat.attackersDeclared && seat === state.activeSeat) {
    return { action: { type: "declare-attackers", attackers: chooseAttackers(state, seat) }, label: "declara atacantes" };
  }
  if (state.step === "declare-blockers" && !state.combat.blockersDeclared && defendersAwaitingBlocks(state).includes(seat)) {
    return { action: { type: "declare-blockers", blockers: chooseBlockers(state, seat) }, label: "declara bloqueadores" };
  }

  const player = state.players[seat]!;
  const isMyMain = state.activeSeat === seat && (state.step === "precombat-main" || state.step === "postcombat-main");

  if (isMyMain) {
    // Self-limiting activations come before anything else: a fetch land that
    // sacrifices itself, or a `{T}` ability, can only be used once, and using it
    // first means the mana or the fixing is available for the rest of the turn.
    //
    // Abilities whose cost is repeatable (pay life, pay mana, no tap) are left
    // alone on purpose: this policy has no way to know when to stop paying, and
    // a bot that drains itself is worse than a bot that never activates.
    if (!state.stack.length) {
      const activation = available.find((entry) => {
        const action = entry.action;
        if (action.type !== "activate") return false;
        const source = player.battlefield.find((permanent) => permanent.instance_id === action.sourceId);
        if (!source) return false;
        const ability = cardProfile(source.card).activatedAbilities.find((candidate) => candidate.index === action.abilityIndex);
        return Boolean(ability && (ability.requiresTap || ability.sacrificesSelf || ability.loyaltyCost !== undefined));
      });
      if (activation && activation.action.type === "activate") {
        const targets = activation.requiresTarget ? pickTargets(state, seat, activation.requiresTarget) : undefined;
        if (!activation.requiresTarget || targets?.length) {
          return { action: targets ? { ...activation.action, targets } : activation.action, label: activation.label };
        }
      }
    }

    // A land first: it is free and unlocks everything else this turn.
    const land = available.find((entry) => entry.action.type === "play-land");
    if (land) {
      const lands = available.filter((entry) => entry.action.type === "play-land");
      // Prefer a land that enters untapped so the mana is usable this turn.
      const untapped = lands.find((entry) => {
        const card = player.hand.find((candidate) => candidate.instance_id === entry.cardId);
        return card ? cardProfile(card).entersTapped.kind === "untapped" : false;
      });
      const chosen = untapped ?? land;
      return { action: chosen.action, label: chosen.label };
    }

    const casts = available
      .filter((entry) => entry.action.type === "cast")
      .sort((left, right) => (right.manaValue ?? 0) - (left.manaValue ?? 0));
    // Rebuild the commander first, then the most expensive real body available.
    const commander = casts.find((entry) => player.commandZone.some((card) => card.instance_id === entry.cardId));
    const permanent = casts.find((entry) => {
      const card = player.hand.find((candidate) => candidate.instance_id === entry.cardId);
      return card ? cardProfile(card).isPermanent && !isLand(cardProfile(card)) : false;
    });
    const chosen = commander ?? permanent ?? casts[0];
    if (chosen && chosen.action.type === "cast") {
      const targets = chosen.requiresTarget ? pickTargets(state, seat, chosen.requiresTarget) : undefined;
      if (chosen.requiresTarget && !targets?.length) return passOr(available);
      return { action: targets ? { ...chosen.action, targets } : chosen.action, label: chosen.label };
    }
  }

  const pass = available.find((entry) => entry.action.type === "pass");
  return pass ? { action: pass.action, label: pass.label } : null;
}

/** Runs every bot decision until a human seat owes one, the game ends, or the budget runs out. */
export function runBots(state: GameState, isBot: (seat: SeatId) => boolean, budget = 2_000): { state: GameState; decisions: BotDecision[] } {
  let current = state;
  const decisions: BotDecision[] = [];
  for (let step = 0; step < budget; step += 1) {
    if (current.finished) break;
    const pending = pendingSeat(current);
    if (pending === null || !isBot(pending)) break;
    const choice = botAction(current, pending);
    if (!choice) break;
    decisions.push({ turn: current.turn, step: current.step, seat: pending, action: choice.action, label: choice.label });
    current = applyAction(current, pending, choice.action);
  }
  return { state: current, decisions };
}

/** The single seat that owes the next decision, or null when nobody does. */
export function pendingSeat(state: GameState): SeatId | null {
  if (state.finished) return null;
  if (state.pendingChoice) return state.pendingChoice.seat;
  if (state.step === "declare-attackers" && !state.combat.attackersDeclared) return state.activeSeat;
  if (state.step === "declare-blockers" && !state.combat.blockersDeclared) return defendersAwaitingBlocks(state)[0] ?? null;
  return state.priorityOpen ? state.prioritySeat : null;
}

export interface BotGameResult {
  readonly state: GameState;
  readonly decisions: readonly BotDecision[];
  readonly turns: number;
  readonly winnerSeat: SeatId | null;
  readonly finished: boolean;
}

/** Plays a full game with every seat under bot control. */
export function playBotGame(initial: GameState, maxTurns = 60, budget = 40_000): BotGameResult {
  let current = initial;
  const decisions: BotDecision[] = [];
  for (let step = 0; step < budget; step += 1) {
    if (current.finished || current.turn > maxTurns) break;
    const pending = pendingSeat(current);
    if (pending === null) break;
    const choice = botAction(current, pending);
    if (!choice) break;
    decisions.push({ turn: current.turn, step: current.step, seat: pending, action: choice.action, label: choice.label });
    current = applyAction(current, pending, choice.action);
  }
  return { state: current, decisions, turns: current.turn, winnerSeat: current.winnerSeat, finished: current.finished };
}
