import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { filterTestedDeckCards } from "@prossh/rules";
import type { ImportedDeck } from "./matches.js";

interface EngineProfile {
  readonly oracle_id?: string;
  readonly fullyImplemented?: boolean;
}

interface EngineProfileExport {
  readonly profiles?: readonly EngineProfile[];
}

interface ImportedPool {
  readonly source: string;
  readonly decks: readonly ImportedDeck[];
}

export interface TestedPod {
  readonly source: string;
  readonly decks: ImportedDeck[];
}

export async function readCompletedOracleIds(path: string): Promise<ReadonlySet<string>> {
  if (!existsSync(path)) {
    throw new Error("Tested mode is unavailable: the engine profile index is missing. Run npm run rules:engine:export.");
  }
  let report: EngineProfileExport;
  try {
    report = JSON.parse(await readFile(path, "utf8")) as EngineProfileExport;
  } catch {
    throw new Error("Tested mode is unavailable: the engine profile index could not be read.");
  }
  const profiles = Array.isArray(report.profiles) ? report.profiles : [];
  const complete = new Set(
    profiles
      .filter((profile) => profile.fullyImplemented === true && typeof profile.oracle_id === "string" && profile.oracle_id.length > 0)
      .map((profile) => profile.oracle_id!)
  );
  if (!complete.size) throw new Error("Tested mode is unavailable: the index contains no fully implemented profiles.");
  return complete;
}

function prepareDeck(deck: ImportedDeck, completeOracleIds: ReadonlySet<string>): ImportedDeck {
  const cards = filterTestedDeckCards(deck, completeOracleIds);
  return { ...deck, cards } satisfies ImportedDeck;
}

/** Selects four deterministic, legal imported decks for the Home mode. */
export function selectTestedPod(
  pools: readonly ImportedPool[],
  completeOracleIds: ReadonlySet<string>,
  preferredDeckId?: string
): TestedPod {
  const candidates = pools.flatMap((pool) => pool.decks.map((deck) => ({ deck, source: pool.source })));
  const ordered = preferredDeckId
    ? [...candidates].sort((left, right) => Number(right.deck.id === preferredDeckId) - Number(left.deck.id === preferredDeckId))
    : candidates;
  const selected: ImportedDeck[] = [];
  const sources = new Set<string>();
  const selectedIds = new Set<string>();
  for (const candidate of ordered) {
    if (selectedIds.has(candidate.deck.id)) continue;
    try {
      selected.push(prepareDeck(candidate.deck, completeOracleIds));
      sources.add(candidate.source);
      selectedIds.add(candidate.deck.id);
    } catch {
      // A deck with an incomplete commander or too few complete cards is not a
      // suitable pool member; the final error below reports the pod-level issue.
    }
    if (selected.length === 4) break;
  }
  if (selected.length < 4) {
    throw new Error(`Tested mode is unavailable: only ${selected.length} imported decks have fully implemented commanders and cards; 4 are required.`);
  }
  return { source: `tested (${[...sources].join(", ")})`, decks: selected };
}
