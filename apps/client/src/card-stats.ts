interface StatCard {
  readonly type_line: string;
  readonly power?: string | number | null;
  readonly toughness?: string | number | null;
}

interface PermanentStats extends StatCard {
  /** Authoritative current type from the battlefield projection. */
  readonly isCreature: boolean;
}

/** Battlefield types belong to the server; CardView values use printed types. */
export function hasCreatureStats(card: StatCard | PermanentStats): boolean {
  const creature = "isCreature" in card
    ? card.isCreature
    : /\bCreature\b/i.test(card.type_line.split(/[—–]/, 1)[0] ?? "");
  return creature && card.power != null && card.toughness != null;
}
