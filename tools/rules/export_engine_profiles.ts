/** Export the actual ProsshTCG engine profile for every unique catalog card. */
import { mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { cardProfile, type CardData } from "../../packages/rules/src/characteristics.ts";

const catalogIndex = process.argv.indexOf("--catalog");
const outputIndex = process.argv.indexOf("--output");
const catalog = catalogIndex >= 0 ? process.argv[catalogIndex + 1]! : "data/catalog/prossh.sqlite";
const output = outputIndex >= 0 ? process.argv[outputIndex + 1]! : "data/rules/engine-card-profiles.json";

const database = new DatabaseSync(catalog, { readOnly: true });
const rows = database.prepare(`
  SELECT id, oracle_id, name, mana_cost, cmc, type_line, oracle_text,
         colors_json, color_identity_json, keywords_json, produced_mana_json,
         card_faces_json, power, toughness, loyalty
  FROM cards ORDER BY printing_rank DESC, released_at DESC, id
`).all() as Array<Record<string, unknown>>;

const seen = new Set<string>();
const profiles: unknown[] = [];
for (const row of rows) {
  const identity = String(row.oracle_id ?? row.id);
  if (seen.has(identity)) continue;
  seen.add(identity);
  const card: CardData = {
    scryfall_id: String(row.id),
    ...(row.oracle_id ? { oracle_id: String(row.oracle_id) } : {}),
    name: String(row.name),
    mana_cost: row.mana_cost ? String(row.mana_cost) : null,
    cmc: Number(row.cmc ?? 0),
    type_line: String(row.type_line),
    oracle_text: row.oracle_text ? String(row.oracle_text) : "",
    colors: JSON.parse(String(row.colors_json ?? "[]")),
    color_identity: JSON.parse(String(row.color_identity_json ?? "[]")),
    keywords: JSON.parse(String(row.keywords_json ?? "[]")),
    produced_mana: JSON.parse(String(row.produced_mana_json ?? "[]")),
    card_faces: JSON.parse(String(row.card_faces_json ?? "null")) ?? undefined,
    power: row.power ? String(row.power) : null,
    toughness: row.toughness ? String(row.toughness) : null,
    loyalty: row.loyalty ? String(row.loyalty) : null
  };
  const profile = cardProfile(card);
  profiles.push({
    oracle_id: row.oracle_id ?? null,
    scryfall_id: row.id,
    name: row.name,
    oracle_text: row.oracle_text ?? "",
    fullyImplemented: profile.fullyImplemented,
    types: profile.types,
    supertypes: profile.supertypes,
    subtypes: profile.subtypes,
    manaValue: profile.manaValue,
    colors: profile.colors,
    keywords: profile.keywords,
    manaAbilities: profile.manaAbilities,
    activatedAbilities: profile.activatedAbilities,
    effects: profile.effects,
    triggers: profile.triggers,
    targetKind: profile.targetKind,
    entersTapped: profile.entersTapped
  });
}

const separator = Math.max(output.lastIndexOf("/"), output.lastIndexOf("\\"));
if (separator > 0) mkdirSync(output.slice(0, separator), { recursive: true });
const implemented = profiles.filter((profile) => (profile as { fullyImplemented: boolean }).fullyImplemented).length;
writeFileSync(output, JSON.stringify({
  format: "prossh-engine-profiles/v1",
  source: "ProsshTCG packages/rules",
  cardCount: profiles.length,
  implementedCount: implemented,
  generatedAt: new Date().toISOString(),
  profiles
}, null, 2) + "\n", "utf8");
console.log(`Engine profiles written: ${profiles.length} cards; ${implemented} fully implemented -> ${output}`);
