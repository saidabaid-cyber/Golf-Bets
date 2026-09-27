import aliasSeed from "../data/equipment-catalog-aliases.json";

export type EquipmentAliasKind = "BALL" | "CLUB" | "SHAFT";

type BrandAliasRow = {
  kind: EquipmentAliasKind;
  canonical: string;
  aliases: string[];
  relationship: string;
  sourceUrl: string;
};

type ItemAliasRow = {
  kind: EquipmentAliasKind;
  catalogId: string;
  aliases: string[];
  sourceUrl: string;
};

type AliasSeed = {
  schemaVersion: number;
  verifiedAt: string;
  brandAliases: BrandAliasRow[];
  itemAliases: ItemAliasRow[];
};

const seed = aliasSeed as AliasSeed;

function aliasKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[®™]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/\bgolf\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function brandRows(kind: EquipmentAliasKind) {
  return seed.brandAliases.filter((row) => row.kind === kind);
}

export function canonicalEquipmentBrand(kind: EquipmentAliasKind, value: string) {
  const key = aliasKey(value);
  const row = brandRows(kind).find((candidate) => aliasKey(candidate.canonical) === key
    || candidate.aliases.some((alias) => aliasKey(alias) === key));
  return row?.canonical || value;
}

export function equipmentBrandAliases(kind: EquipmentAliasKind, canonicalBrand: string) {
  const key = aliasKey(canonicalBrand);
  const row = brandRows(kind).find((candidate) => aliasKey(candidate.canonical) === key);
  return row ? [...new Set(row.aliases)] : [];
}

export function equipmentItemAliases(kind: EquipmentAliasKind, catalogId: string) {
  return [...new Set(seed.itemAliases
    .filter((row) => row.kind === kind && row.catalogId === catalogId)
    .flatMap((row) => row.aliases))];
}

export function equipmentSearchAliases(kind: EquipmentAliasKind, item: { id: string; brand: string; aliases?: readonly string[] }) {
  return [...new Set([
    ...equipmentBrandAliases(kind, item.brand),
    ...equipmentItemAliases(kind, item.id),
    ...(item.aliases || []),
  ])];
}

export const equipmentAliasRegistry = Object.freeze({
  schemaVersion: seed.schemaVersion,
  verifiedAt: seed.verifiedAt,
  brandAliases: Object.freeze(seed.brandAliases.map((row) => Object.freeze({ ...row, aliases: Object.freeze([...row.aliases]) }))),
  itemAliases: Object.freeze(seed.itemAliases.map((row) => Object.freeze({ ...row, aliases: Object.freeze([...row.aliases]) }))),
});
