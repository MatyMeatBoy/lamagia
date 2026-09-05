import type { CardData } from "./characteristics.js";

/** The imported-deck shape needed by the deterministic tested-mode filter. */
export interface TestedDeckLike {
  readonly name: string;
  readonly commanders: readonly string[];
  readonly cards: readonly CardData[];
}

const COMMANDER_DECK_SIZE = 100;

function isBasicLand(card: CardData): boolean {
  return /^Basic Land(?: —|$)/i.test(card.type_line);
}

function commanderIdentity(commanderCards: readonly CardData[]): Set<string> {
  const identity = new Set<string>();
  for (const card of commanderCards) for (const color of card.color_identity ?? []) identity.add(color.toUpperCase());
  return identity;
}

function isCommanderLegal(card: CardData, identity: ReadonlySet<string>): boolean {
  return (card.color_identity ?? []).every((color) => identity.has(color.toUpperCase()));
}

function competitiveScore(card: CardData): number {
  if (isBasicLand(card)) return -1000;
  const text = card.oracle_text ?? "";
  const type = card.type_line ?? "";
  let score = 0;
  if (/counter target/i.test(text)) score += 12;
  if (/search your library|tutor/i.test(text)) score += 10;
  if (/draw (?:a|one|two|three|four|five|x) cards?|draw a card/i.test(text)) score += 8;
  if (/destroy|exile|sacrifice target|return target/i.test(text)) score += 7;
  if (/add \{[WUBRGC]/i.test(text) || /search your library for .*land/i.test(text)) score += 6;
  if (/you may cast|cast .*without paying|reduce/i.test(text)) score += 5;
  if (/flash|instant/i.test(text) || /Instant/i.test(type)) score += 3;
  if (/mana cost|cmc|mana value/i.test(text)) score += 2;
  const manaValue = Number(card.cmc ?? 99);
  if (Number.isFinite(manaValue) && manaValue <= 2) score += 3;
  return score;
}

/**
 * Builds the exact 100-card list used by Home's tested mode.
 *
 * Completion is intentionally keyed only by stable oracle_id. Incomplete cards
 * are removed, while complete basic lands from the same imported list may be
 * repeated to keep the Commander deck at the engine's required minimum size.
 */
export function filterTestedDeckCards(
  deck: TestedDeckLike,
  completeOracleIds: ReadonlySet<string>,
  deckSize = COMMANDER_DECK_SIZE,
  competitivePool: readonly CardData[] = []
): CardData[] {
  if (deckSize < 1) throw new Error("Tested deck size must be positive.");
  if (deck.cards.length < deckSize) {
    throw new Error(`${deck.name} does not contain the ${deckSize}-card minimum.`);
  }

  const commanderIndexes: number[] = [];
  for (const commanderName of deck.commanders) {
    const index = deck.cards.findIndex((card, cardIndex) => card.name === commanderName && !commanderIndexes.includes(cardIndex));
    if (index < 0) throw new Error(`${deck.name} does not contain commander ${commanderName}.`);
    commanderIndexes.push(index);
  }
  if (!commanderIndexes.length) throw new Error(`${deck.name} does not declare a commander.`);

  const commanderCards = commanderIndexes.map((index) => deck.cards[index]!);
  const identity = commanderIdentity(commanderCards);
  const complete = deck.cards.filter((card) =>
    Boolean(card.oracle_id) && completeOracleIds.has(card.oracle_id!) && isCommanderLegal(card, identity));
  const completeCommanders = commanderCards.filter((card) =>
    Boolean(card.oracle_id) && completeOracleIds.has(card.oracle_id!) && isCommanderLegal(card, identity));
  if (completeCommanders.length !== commanderCards.length) {
    throw new Error(`${deck.name} does not have all commanders fully implemented.`);
  }

  const commanderOracleIds = new Set(commanderCards.map((card) => card.oracle_id).filter(Boolean));
  const usedOracleIds = new Set<string>();
  const selected = [
    ...commanderCards,
    ...complete.filter((card) => {
      if (!card.oracle_id || commanderOracleIds.has(card.oracle_id) || usedOracleIds.has(card.oracle_id)) return false;
      usedOracleIds.add(card.oracle_id);
      return true;
    })
  ].slice(0, deckSize);
  const upgrades = competitivePool
    .filter((card) => Boolean(card.oracle_id) && completeOracleIds.has(card.oracle_id!) && isCommanderLegal(card, identity))
    .filter((card) => Boolean(card.oracle_id) && !commanderOracleIds.has(card.oracle_id!) && !usedOracleIds.has(card.oracle_id!))
    .sort((left, right) => competitiveScore(right) - competitiveScore(left) || left.name.localeCompare(right.name));
  for (const card of upgrades) {
    if (selected.length >= deckSize) break;
    if (!card.oracle_id || usedOracleIds.has(card.oracle_id) || isBasicLand(card)) continue;
    usedOracleIds.add(card.oracle_id);
    selected.push(card);
  }
  const basics = complete.filter(isBasicLand);
  if (selected.length < deckSize && !basics.length) {
    throw new Error(`${deck.name} has only ${selected.length} implemented cards and no basic lands to reach the minimum.`);
  }
  for (let index = selected.length; selected.length < deckSize; index += 1) {
    selected.push(basics[index % basics.length]!);
  }
  return selected;
}
