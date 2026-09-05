import { cardProfile } from "./characteristics.js";
import type { GameAction, GameState, SeatId } from "./engine.js";

/** Fail closed: only a manual mana activation whose reversible delta is limited
 * to the activating player's mana/life and the source's tapped state.
 * Every other field (including private zones, RNG, triggers and priority) must
 * remain identical. The caller must compare the final settled/bot-driven state.
 */
export function isSafeManaUndo(before: GameState, after: GameState, seat: SeatId, action: GameAction): boolean {
  if (action.type !== "activate-mana" || before.finished || after.finished || before.pendingChoice || after.pendingChoice
    || before.triggerQueue.length || after.triggerQueue.length || before.prioritySeat !== seat
    || !before.priorityOpen || after.version !== before.version + 1) return false;
  const player = before.players.find(p => p.seat === seat);
  const source = player?.battlefield.find(p => p.instance_id === action.sourceId);
  const ability = source && cardProfile(source.card).manaAbilities[action.abilityIndex];
  if (!player || !source || !ability || ability.removeCounters?.length
    || ability.variableAmountCounter || ability.manaCost?.symbols.length) return false;
  // Extra log entries reveal intervening work even if its board delta cancels.
  if (after.log.length !== before.log.length + 1 || JSON.stringify(after.log.slice(0, -1)) !== JSON.stringify(before.log)) return false;
  const normalized: GameState = { ...after, version: before.version, log: before.log,
    players: after.players.map(p => p.seat !== seat ? p : { ...p, life: player.life, manaPool: player.manaPool, restrictedMana: player.restrictedMana,
      battlefield: p.battlefield.map(permanent => permanent.instance_id === source.instance_id
        ? { ...permanent, tapped: source.tapped } : permanent) }) };
  return JSON.stringify(normalized) === JSON.stringify(before);
}
