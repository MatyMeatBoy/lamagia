/**
 * Derives the structured characteristics the engine plays with from imported card data.
 *
 * Nothing here interprets free-form Oracle text as a general rules language. It
 * reads Scryfall's structured fields (types, power/toughness, keywords,
 * produced_mana) and recognises a small, closed set of unambiguous templates.
 * Anything outside that set is reported as unimplemented rather than guessed at,
 * so the table never pretends a card did something it did not do.
 */

import { MANA_COLORS, parseManaCost, type ManaCost, type ManaType } from "./mana.js";

export interface CardData {
  readonly scryfall_id: string;
  readonly oracle_id?: string;
  readonly name: string;
  readonly mana_cost?: string | null;
  readonly cmc?: number;
  readonly type_line: string;
  readonly oracle_text?: string | null;
  readonly image_normal?: string;
  readonly image_art_crop?: string;
  readonly power?: string | null;
  readonly toughness?: string | null;
  readonly loyalty?: string | null;
  readonly colors?: readonly string[];
  readonly color_identity?: readonly string[];
  readonly keywords?: readonly string[];
  readonly produced_mana?: readonly string[];
  readonly card_faces?: readonly Partial<CardData>[];
}

export type CardType =
  | "Land" | "Creature" | "Artifact" | "Enchantment" | "Planeswalker"
  | "Instant" | "Sorcery" | "Battle" | "Kindred";

const CARD_TYPES: readonly CardType[] = ["Land", "Creature", "Artifact", "Enchantment", "Planeswalker", "Instant", "Sorcery", "Battle", "Kindred"];

/** Combat- and priority-relevant keywords the engine actually enforces. */
export const ENFORCED_KEYWORDS = [
  "flying", "reach", "first strike", "double strike", "deathtouch", "trample",
  "vigilance", "lifelink", "menace", "defender", "haste", "indestructible",
  "hexproof", "shroud", "flash"
] as const;
export type EnforcedKeyword = (typeof ENFORCED_KEYWORDS)[number];

export interface ManaAbility {
  readonly index: number;
  /** The mana types the controller may choose between for each mana produced. */
  readonly produces: readonly ManaType[];
  readonly amount: number;
  readonly requiresTap: boolean;
  /** Life the ability costs (pain and filter lands). */
  readonly lifeCost: number;
  readonly text: string;
}

/** A closed set of effects the engine executes. Everything else is flagged unimplemented. */
export type SpellEffect =
  | { readonly kind: "draw"; readonly amount: number }
  | { readonly kind: "gain-life"; readonly amount: number }
  | { readonly kind: "each-opponent-loses-life"; readonly amount: number }
  | { readonly kind: "damage-any-target"; readonly amount: number }
  | { readonly kind: "damage-each-opponent"; readonly amount: number }
  | { readonly kind: "destroy-target-creature" }
  | { readonly kind: "destroy-all-creatures" }
  | { readonly kind: "counter-target-spell" };

export type TargetKind = "any" | "creature" | "spell" | "none";

export interface CardProfile {
  readonly name: string;
  readonly typeLine: string;
  readonly types: readonly CardType[];
  readonly supertypes: readonly string[];
  readonly subtypes: readonly string[];
  readonly cost: ManaCost | null;
  readonly manaValue: number;
  readonly colors: readonly string[];
  readonly colorIdentity: readonly string[];
  readonly keywords: readonly EnforcedKeyword[];
  readonly power: number | null;
  readonly toughness: number | null;
  readonly loyalty: number | null;
  readonly manaAbilities: readonly ManaAbility[];
  readonly effects: readonly SpellEffect[];
  readonly targetKind: TargetKind;
  readonly entersTapped: EntersTappedRule;
  readonly isPermanent: boolean;
  readonly castableFromHand: boolean;
  /** True when every printed instruction is covered by the engine. */
  readonly fullyImplemented: boolean;
  readonly oracleText: string;
}

export type EntersTappedRule =
  | { readonly kind: "untapped" }
  | { readonly kind: "tapped" }
  | { readonly kind: "unless-few-lands"; readonly max: number }
  | { readonly kind: "unless-many-lands"; readonly min: number }
  | { readonly kind: "unless-pay-life"; readonly life: number };

const WORD_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, twenty: 20
};

function toNumber(token: string | undefined): number | null {
  if (!token) return null;
  const word = WORD_NUMBERS[token.toLowerCase()];
  if (word !== undefined) return word;
  return /^\d+$/.test(token) ? Number(token) : null;
}

/** Front face of a modal/transforming card; that face is what gets cast from hand. */
function frontFace(card: CardData): CardData {
  const faces = card.card_faces;
  if (!faces?.length) return card;
  const front = faces[0]!;
  return {
    ...card,
    name: front.name ?? card.name,
    mana_cost: front.mana_cost ?? card.mana_cost,
    type_line: front.type_line ?? card.type_line,
    oracle_text: front.oracle_text ?? card.oracle_text,
    power: front.power ?? card.power,
    toughness: front.toughness ?? card.toughness,
    loyalty: front.loyalty ?? card.loyalty,
    colors: front.colors ?? card.colors
  };
}

function splitTypeLine(typeLine: string): { supertypes: string[]; types: CardType[]; subtypes: string[] } {
  const face = typeLine.split("//")[0]!.trim();
  const [left, right] = face.split(/[—–-]\s/);
  const words = (left ?? "").trim().split(/\s+/).filter(Boolean);
  const types = words.filter((word): word is CardType => (CARD_TYPES as readonly string[]).includes(word));
  const supertypes = words.filter((word) => !types.includes(word as CardType));
  const subtypes = (right ?? "").trim().split(/\s+/).filter(Boolean);
  return { supertypes, types, subtypes };
}

function numeric(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  // `*` and `1+*` characteristic-defining values are not modeled; treat them as zero-ish bodies.
  return /\*/.test(trimmed) ? 0 : null;
}

/** Removes reminder text and normalises the card's own name to `~` for template matching. */
export function normalizedOracle(card: CardData): string {
  const raw = (card.oracle_text ?? "").replace(/\([^)]*\)/g, " ");
  const shortName = card.name.split(",")[0]!.split("//")[0]!.trim();
  const escaped = [card.name, shortName].filter(Boolean).map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  let text = raw;
  for (const pattern of escaped) text = text.replace(new RegExp(pattern, "g"), "~");
  return text.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
}

const MANA_LETTERS = new Set(["W", "U", "B", "R", "G", "C"]);

function symbolsIn(text: string): ManaType[] {
  return [...text.matchAll(/\{([WUBRGC])\}/g)].map((match) => match[1] as ManaType);
}

/** Recognises the mana an `Add …` clause produces. Returns null for variable or unmodeled output. */
function parseAddClause(effect: string): { produces: ManaType[]; amount: number } | null {
  const clause = effect.trim();
  const anyColor = /^add\s+(\w+)\s+mana\s+of\s+any\s+(?:one\s+)?colors?\b/i.exec(clause);
  if (anyColor) {
    const amount = toNumber(anyColor[1]);
    return amount ? { produces: [...MANA_COLORS], amount } : null;
  }
  const anyCombination = /^add\s+(\w+)\s+mana\s+in\s+any\s+combination\s+of\s+colors/i.exec(clause);
  if (anyCombination) {
    const amount = toNumber(anyCombination[1]);
    return amount ? { produces: [...MANA_COLORS], amount } : null;
  }
  const explicit = /^add\s+((?:\{[WUBRGC]\}|\s|,|or|and)+)/i.exec(clause);
  if (!explicit) return null;
  const symbols = symbolsIn(explicit[1]!);
  if (!symbols.length) return null;
  const distinct = [...new Set(symbols)];
  // `Add {G}{G}` is two of one type; `Add {W} or {U}` is one mana with a choice.
  const isChoice = /\bor\b/i.test(explicit[1]!) && distinct.length > 1;
  if (isChoice) return { produces: distinct, amount: 1 };
  if (distinct.length > 1) return null; // Mixed fixed output like `Add {W}{U}` needs a multi-type pool entry.
  return { produces: distinct, amount: symbols.length };
}

function parseManaAbilities(card: CardData, text: string): ManaAbility[] {
  const abilities: ManaAbility[] = [];
  const lines = text.split("\n");
  for (const line of lines) {
    const activated = /^([^:]{1,80}):\s*(.+)$/.exec(line.trim());
    if (!activated) continue;
    const [, costText, effectText] = activated as unknown as [string, string, string];
    if (!/^add\b/i.test(effectText.trim())) continue;
    const requiresTap = /\{T\}/.test(costText);
    const lifeMatch = /pay\s+(\d+)\s+life/i.exec(costText);
    const lifeCost = lifeMatch ? Number(lifeMatch[1]) : 0;
    // Costs beyond tapping and paying life (mana, sacrifice, discard) are not modeled.
    const leftovers = costText
      .replace(/\{T\}/g, "")
      .replace(/pay\s+\d+\s+life/gi, "")
      .replace(/[,\s]/g, "");
    if (leftovers.length) continue;
    const produced = parseAddClause(effectText);
    if (!produced) continue;
    abilities.push({ index: abilities.length, produces: produced.produces, amount: produced.amount, requiresTap, lifeCost, text: line.trim() });
  }
  if (abilities.length) return abilities;

  // Fallback for cards whose printed ability is only reminder text (basic lands) or
  // phrasing outside the templates above: use Scryfall's structured produced_mana.
  const produced = (card.produced_mana ?? []).filter((symbol) => MANA_LETTERS.has(symbol)) as ManaType[];
  if (!produced.length) return [];
  return [{ index: 0, produces: produced, amount: 1, requiresTap: true, lifeCost: 0, text: `{T}: Add one mana (${produced.join("/")}).` }];
}

function parseEntersTapped(text: string, typeLine: string): EntersTappedRule {
  if (!/enters\s+tapped/i.test(text)) return { kind: "untapped" };
  const fewLands = /unless\s+you\s+control\s+(\w+)\s+or\s+fewer\s+other\s+lands/i.exec(text);
  if (fewLands) {
    const max = toNumber(fewLands[1]);
    if (max !== null) return { kind: "unless-few-lands", max };
  }
  const manyLands = /unless\s+you\s+control\s+(\w+)\s+or\s+more\s+other\s+lands/i.exec(text);
  if (manyLands) {
    const min = toNumber(manyLands[1]);
    if (min !== null) return { kind: "unless-many-lands", min };
  }
  const payLife = /(?:unless\s+you\s+pay|you\s+may\s+pay)\s+(\d+)\s+life/i.exec(text);
  if (payLife) return { kind: "unless-pay-life", life: Number(payLife[1]) };
  if (/^Basic\b/.test(typeLine)) return { kind: "untapped" };
  return { kind: "tapped" };
}

interface RecognizedText { readonly effects: SpellEffect[]; readonly targetKind: TargetKind; readonly covered: boolean }

const SENTENCE_SPLIT = /(?<=\.)\s+(?=[A-Z~])/;

/** Matches one sentence against the closed effect templates. */
function recognizeSentence(sentence: string): { effect: SpellEffect; target: TargetKind } | null {
  const text = sentence.trim().replace(/\s+/g, " ").replace(/\.$/, "");
  let match: RegExpExecArray | null;

  if ((match = /^Draw (\w+) cards?$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount) return { effect: { kind: "draw", amount }, target: "none" };
  }
  if ((match = /^You gain (\w+) life$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount) return { effect: { kind: "gain-life", amount }, target: "none" };
  }
  if ((match = /^Each opponent loses (\w+) life$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount) return { effect: { kind: "each-opponent-loses-life", amount }, target: "none" };
  }
  if ((match = /^~ deals (\w+) damage to any target$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount) return { effect: { kind: "damage-any-target", amount }, target: "any" };
  }
  if ((match = /^~ deals (\w+) damage to (?:each opponent|each of your opponents)$/i.exec(text))) {
    const amount = toNumber(match[1]);
    if (amount) return { effect: { kind: "damage-each-opponent", amount }, target: "none" };
  }
  if (/^Destroy target creature$/i.test(text)) return { effect: { kind: "destroy-target-creature" }, target: "creature" };
  if (/^Destroy all creatures$/i.test(text)) return { effect: { kind: "destroy-all-creatures" }, target: "none" };
  if (/^Counter target spell$/i.test(text)) return { effect: { kind: "counter-target-spell" }, target: "spell" };
  // Purely cosmetic trailing clauses do not change the outcome the engine produces.
  if (/^(It|They) can't be regenerated$/i.test(text)) return null;
  return null;
}

function recognizeText(text: string): RecognizedText {
  const body = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (!body.length) return { effects: [], targetKind: "none", covered: true };

  const effects: SpellEffect[] = [];
  let targetKind: TargetKind = "none";
  let unmatched = 0;

  for (const line of body) {
    // A keyword-only line ("Flying, vigilance") is fully covered by the keyword engine.
    const words = line.replace(/\.$/, "").split(/,\s*/).map((word) => word.trim().toLowerCase());
    if (words.length && words.every((word) => (ENFORCED_KEYWORDS as readonly string[]).includes(word))) continue;
    if (/^[^:]{1,80}:/.test(line) && /^[^:]*:\s*add\b/i.test(line)) continue; // Mana ability, handled separately.

    let lineCovered = false;
    for (const sentence of line.split(SENTENCE_SPLIT)) {
      if (!sentence.trim()) continue;
      const recognized = recognizeSentence(sentence);
      if (!recognized) continue;
      effects.push(recognized.effect);
      lineCovered = true;
      if (recognized.target !== "none") targetKind = recognized.target;
    }
    if (!lineCovered) unmatched += 1;
  }
  return { effects, targetKind, covered: unmatched === 0 };
}

const profileCache = new Map<string, CardProfile>();

/** Builds (and memoises) the engine profile for one printed card. */
export function cardProfile(card: CardData): CardProfile {
  const cached = profileCache.get(card.scryfall_id);
  if (cached) return cached;

  const face = frontFace(card);
  const { supertypes, types, subtypes } = splitTypeLine(face.type_line);
  const text = normalizedOracle(face);
  const keywords = (card.keywords ?? [])
    .map((keyword) => keyword.toLowerCase())
    .filter((keyword): keyword is EnforcedKeyword => (ENFORCED_KEYWORDS as readonly string[]).includes(keyword));
  const isPermanent = types.some((type) => type === "Land" || type === "Creature" || type === "Artifact" || type === "Enchantment" || type === "Planeswalker" || type === "Battle");
  const cost = parseManaCost(face.mana_cost);
  const recognized = recognizeText(text);
  const manaAbilities = isPermanent ? parseManaAbilities(card, text) : [];

  const profile: CardProfile = {
    name: card.name,
    typeLine: card.type_line,
    types,
    supertypes,
    subtypes,
    cost,
    manaValue: cost?.manaValue ?? Math.round(card.cmc ?? 0),
    colors: [...(face.colors ?? card.colors ?? [])],
    colorIdentity: [...(card.color_identity ?? [])],
    keywords,
    power: numeric(face.power),
    toughness: numeric(face.toughness),
    loyalty: numeric(face.loyalty),
    manaAbilities,
    effects: recognized.effects,
    targetKind: recognized.targetKind,
    entersTapped: types.includes("Land") ? parseEntersTapped(text, face.type_line) : { kind: "untapped" },
    isPermanent,
    // Lands are played, not cast; everything else needs a payable printed cost.
    castableFromHand: !types.includes("Land") && cost !== null && cost.symbols.length > 0,
    // A permanent whose extra text is unmatched still plays as a real body with real
    // combat keywords; a spell whose text is unmatched would resolve doing nothing.
    fullyImplemented: recognized.covered,
    oracleText: text
  };
  profileCache.set(card.scryfall_id, profile);
  return profile;
}

export function isCreature(profile: CardProfile): boolean { return profile.types.includes("Creature"); }
export function isLand(profile: CardProfile): boolean { return profile.types.includes("Land"); }
export function hasKeyword(profile: CardProfile, keyword: EnforcedKeyword): boolean { return profile.keywords.includes(keyword); }
