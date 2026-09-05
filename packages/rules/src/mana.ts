/**
 * Mana primitives: symbol parsing, pools and cost payment.
 *
 * Everything here is pure and deterministic. The payment solver backtracks over
 * the hybrid/phyrexian choices of a single cost, which stays cheap because a
 * printed mana cost never carries more than a handful of choice symbols.
 */

export const MANA_COLORS = ["W", "U", "B", "R", "G"] as const;
export type ManaColor = (typeof MANA_COLORS)[number];
/** `C` is colorless mana: a payment type, not a color. */
export type ManaType = ManaColor | "C";
export const MANA_TYPES: readonly ManaType[] = [...MANA_COLORS, "C"];

/** A tag carried by floating mana until it is spent or empties (CR 106.7). */
export interface ManaRestriction {
  readonly kind: "legendary-spell";
  /** Delighted Halfling's rider also creates a can't-be-countered effect. */
  readonly makesSpellUncounterable?: boolean;
}

/** One restricted unit of mana. Keeping units tagged makes future restrictions composable. */
export interface RestrictedMana {
  readonly type: ManaType;
  readonly restriction: ManaRestriction;
}

export type ManaPool = Record<ManaType, number>;

export function emptyPool(): ManaPool {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
}

export function poolTotal(pool: ManaPool): number {
  return MANA_TYPES.reduce((total, type) => total + pool[type], 0);
}

export function addMana(pool: ManaPool, type: ManaType, amount = 1): ManaPool {
  return { ...pool, [type]: pool[type] + amount };
}

export function poolLabel(pool: ManaPool): string {
  return MANA_TYPES.filter((type) => pool[type] > 0).map((type) => `${pool[type]}${type}`).join(" ") || "—";
}

/** One parsed symbol of a mana cost. */
export type ManaSymbol =
  | { readonly kind: "generic"; readonly amount: number }
  | { readonly kind: "variable" }
  | { readonly kind: "colored"; readonly color: ManaType }
  | { readonly kind: "hybrid"; readonly options: readonly ManaType[] }
  | { readonly kind: "monohybrid"; readonly color: ManaType; readonly generic: number }
  | { readonly kind: "phyrexian"; readonly color: ManaType; readonly life: number }
  | { readonly kind: "snow" };

export interface ManaCost {
  readonly symbols: readonly ManaSymbol[];
  /** Mana value with every `{X}` counted as zero, matching rule 202.3b. */
  readonly manaValue: number;
  readonly hasVariable: boolean;
  readonly raw: string;
}

const PAYMENT_TYPES = new Set<string>(["W", "U", "B", "R", "G", "C"]);

function parseSymbol(token: string): ManaSymbol | null {
  const symbol = token.trim().toUpperCase();
  if (/^\d+$/.test(symbol)) return { kind: "generic", amount: Number(symbol) };
  if (/^[XYZ]$/.test(symbol)) return { kind: "variable" };
  if (symbol === "S") return { kind: "snow" };
  if (PAYMENT_TYPES.has(symbol)) return { kind: "colored", color: symbol as ManaType };
  const phyrexian = /^([WUBRGC])\/P$/.exec(symbol) ?? /^P\/([WUBRGC])$/.exec(symbol);
  if (phyrexian) return { kind: "phyrexian", color: phyrexian[1] as ManaType, life: 2 };
  const monohybrid = /^(\d+)\/([WUBRGC])$/.exec(symbol);
  if (monohybrid) return { kind: "monohybrid", color: monohybrid[2] as ManaType, generic: Number(monohybrid[1]) };
  const hybrid = /^([WUBRGC])\/([WUBRGC])$/.exec(symbol);
  if (hybrid) return { kind: "hybrid", options: [hybrid[1] as ManaType, hybrid[2] as ManaType] };
  return null;
}

function symbolValue(symbol: ManaSymbol): number {
  switch (symbol.kind) {
    case "generic": return symbol.amount;
    case "variable": return 0;
    case "monohybrid": return symbol.generic;
    default: return 1;
  }
}

/**
 * Parses `{3}{G}{W/U}{B/P}` into structured symbols.
 * Returns `null` for a cost containing a token this engine cannot pay, so an
 * unsupported card is refused instead of silently resolving for free.
 */
export function parseManaCost(raw: string | undefined | null): ManaCost | null {
  const text = (raw ?? "").trim();
  if (!text) return { symbols: [], manaValue: 0, hasVariable: false, raw: "" };
  const tokens = [...text.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]!);
  if (!tokens.length) return null;
  // Reject anything printed outside the `{...}` groups; that is not a mana cost.
  if (text.replace(/\{[^}]*\}/g, "").trim().length > 0) return null;
  const symbols: ManaSymbol[] = [];
  for (const token of tokens) {
    const symbol = parseSymbol(token);
    if (!symbol) return null;
    symbols.push(symbol);
  }
  return {
    symbols,
    manaValue: symbols.reduce((total, symbol) => total + symbolValue(symbol), 0),
    hasVariable: symbols.some((symbol) => symbol.kind === "variable"),
    raw: text
  };
}

/** Colors a cost requires or may require. */
export function costColors(cost: ManaCost): ManaColor[] {
  const colors = new Set<string>();
  for (const symbol of cost.symbols) {
    if (symbol.kind === "colored" || symbol.kind === "monohybrid" || symbol.kind === "phyrexian") colors.add(symbol.color);
    if (symbol.kind === "hybrid") for (const option of symbol.options) colors.add(option);
  }
  return MANA_COLORS.filter((color) => colors.has(color));
}

export interface PaymentResult {
  /** Mana actually spent, by type. */
  readonly spent: ManaPool;
  /** Life paid through Phyrexian symbols. */
  readonly lifePaid: number;
  /** What is left in the pool after paying. */
  readonly remaining: ManaPool;
}

export interface PaymentOptions {
  /** Value chosen for every `{X}` in the cost. */
  readonly variableValue?: number;
  /** Life the payer can spend on Phyrexian symbols; payment never reduces life to 0. */
  readonly availableLife?: number;
  /** Extra generic the cost demands (commander tax, additional cost, …). */
  readonly additionalGeneric?: number;
}

type Choice =
  | { readonly kind: "type"; readonly type: ManaType }
  | { readonly kind: "generic"; readonly amount: number }
  | { readonly kind: "life"; readonly amount: number };

function requirementsOf(cost: ManaCost, variableValue: number): { choices: Choice[][]; generic: number } {
  const choices: Choice[][] = [];
  let generic = 0;
  for (const symbol of cost.symbols) {
    switch (symbol.kind) {
      case "generic": generic += symbol.amount; break;
      case "variable": generic += variableValue; break;
      // Snow sources are not modeled yet; `{S}` is charged as one generic mana.
      case "snow": generic += 1; break;
      case "colored": choices.push([{ kind: "type", type: symbol.color }]); break;
      case "hybrid": choices.push(symbol.options.map((type) => ({ kind: "type", type }))); break;
      case "monohybrid": choices.push([{ kind: "type", type: symbol.color }, { kind: "generic", amount: symbol.generic }]); break;
      case "phyrexian": choices.push([{ kind: "type", type: symbol.color }, { kind: "life", amount: symbol.life }]); break;
    }
  }
  return { choices, generic };
}

/** Spends `owed` generic from `pool`, colorless first then most abundant color, so scarce colors survive. */
function spendGeneric(pool: ManaPool, spent: ManaPool, owed: number): boolean {
  if (poolTotal(pool) < owed) return false;
  let remaining = owed;
  const order = [...MANA_TYPES].sort((left, right) => (left === "C" ? -1 : right === "C" ? 1 : pool[right] - pool[left]));
  for (const type of order) {
    if (!remaining) break;
    const take = Math.min(remaining, pool[type]);
    pool[type] -= take;
    spent[type] += take;
    remaining -= take;
  }
  return remaining === 0;
}

/**
 * Finds a concrete way to pay `cost` from `pool`, or `null` when it cannot be paid.
 *
 * Colored, hybrid and Phyrexian symbols are assigned first by backtracking;
 * generic is then paid from whatever is left. Because every remaining mana is
 * interchangeable for generic, the greedy leaf step is optimal.
 */
export function payCost(cost: ManaCost, pool: ManaPool, options: PaymentOptions = {}): PaymentResult | null {
  const variableValue = Math.max(0, Math.floor(options.variableValue ?? 0));
  const availableLife = options.availableLife ?? 0;
  const { choices, generic } = requirementsOf(cost, variableValue);
  const owedGeneric = Math.max(0, generic + (options.additionalGeneric ?? 0));

  // Fewest options first keeps the search shallow and the result stable.
  const order = choices
    .map((options_, index) => ({ options: options_, index }))
    .sort((left, right) => left.options.length - right.options.length || left.index - right.index)
    .map((entry) => entry.options);

  const solve = (position: number, working: ManaPool, spent: ManaPool, lifePaid: number): PaymentResult | null => {
    if (position === order.length) {
      const leafPool = { ...working };
      const leafSpent = { ...spent };
      if (!spendGeneric(leafPool, leafSpent, owedGeneric)) return null;
      return { spent: leafSpent, lifePaid, remaining: leafPool };
    }
    for (const choice of order[position]!) {
      if (choice.kind === "type") {
        if (working[choice.type] <= 0) continue;
        const next = { ...working, [choice.type]: working[choice.type] - 1 };
        const nextSpent = { ...spent, [choice.type]: spent[choice.type] + 1 };
        const result = solve(position + 1, next, nextSpent, lifePaid);
        if (result) return result;
      } else if (choice.kind === "generic") {
        const next = { ...working };
        const nextSpent = { ...spent };
        if (!spendGeneric(next, nextSpent, choice.amount)) continue;
        const result = solve(position + 1, next, nextSpent, lifePaid);
        if (result) return result;
      } else {
        // Paying life may never reduce the payer to zero or below (rule 118.4).
        if (availableLife - lifePaid <= choice.amount) continue;
        const result = solve(position + 1, working, spent, lifePaid + choice.amount);
        if (result) return result;
      }
    }
    return null;
  };

  return solve(0, { ...pool }, emptyPool(), 0);
}

export function canPay(cost: ManaCost, pool: ManaPool, options: PaymentOptions = {}): boolean {
  return payCost(cost, pool, options) !== null;
}
