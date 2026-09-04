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
  deckSize = COMMANDER_DECK_SIZE
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

  const commanderSet = new Set(commanderCards);
  const selected = [
    ...commanderCards,
    ...complete.filter((card) => !commanderSet.has(card))
  ].slice(0, deckSize);
  const basics = complete.filter(isBasicLand);
  if (selected.length < deckSize && !basics.length) {
    throw new Error(`${deck.name} has only ${selected.length} implemented cards and no basic lands to reach the minimum.`);
  }
  for (let index = selected.length; selected.length < deckSize; index += 1) {
    selected.push(basics[index % basics.length]!);
  }
  return selected;
}
