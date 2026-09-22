import { equipmentIdentityKey, type EquipmentIdentity } from "./admin-control-center";

export type ImportRowStatus = "NEW" | "UPDATE" | "POSSIBLE_DUPLICATE" | "INVALID" | "NO_CHANGE";
export type ImportPreviewRow<T> = { rowNumber: number; status: ImportRowStatus; value: T | null; existingId: string | null; issues: string[] };

export function parseControlledCsv(input: string): string[][] {
  if (new TextEncoder().encode(input).byteLength > 2_000_000) throw new Error("IMPORT_TOO_LARGE");
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') { value += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else value += character;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ",") { row.push(value.trim()); value = ""; }
    else if (character === "\n") { row.push(value.trim()); if (row.some(Boolean)) rows.push(row); row = []; value = ""; }
    else if (character !== "\r") value += character;
  }
  if (quoted) throw new Error("UNTERMINATED_CSV_QUOTE");
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

export function csvObjects(input: string) {
  const rows = parseControlledCsv(input);
  if (rows.length < 2) return [];
  const header = rows[0].map((name) => name.trim());
  if (new Set(header).size !== header.length || header.some((name) => !name)) throw new Error("INVALID_CSV_HEADER");
  return rows.slice(1).map((values, index) => ({
    rowNumber: index + 2,
    value: Object.fromEntries(header.map((name, column) => [name, values[column] ?? ""])),
  }));
}

export function jsonObjects(input: string) {
  if (new TextEncoder().encode(input).byteLength > 2_000_000) throw new Error("IMPORT_TOO_LARGE");
  const parsed: unknown = JSON.parse(input);
  if (!Array.isArray(parsed)) throw new Error("JSON_ARRAY_REQUIRED");
  return parsed.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`INVALID_JSON_ROW_${index + 1}`);
    return { rowNumber: index + 1, value: value as Record<string, unknown> };
  });
}

export function equipmentImportPreview<T extends EquipmentIdentity & { id: string }>(input: readonly { rowNumber: number; value: T | null; issues?: string[] }[], existing: readonly T[]): ImportPreviewRow<T>[] {
  const byId = new Map(existing.map((item) => [item.id, item]));
  const byIdentity = new Map(existing.map((item) => [equipmentIdentityKey(item), item]));
  return input.map((row) => {
    const issues = [...(row.issues ?? [])];
    if (!row.value) return { rowNumber: row.rowNumber, status: "INVALID", value: null, existingId: null, issues: issues.length ? issues : ["Fila inválida."] };
    const exact = byId.get(row.value.id);
    const duplicate = byIdentity.get(equipmentIdentityKey(row.value));
    if (exact) {
      const noChange = JSON.stringify(exact) === JSON.stringify(row.value);
      return { rowNumber: row.rowNumber, status: noChange ? "NO_CHANGE" : "UPDATE", value: row.value, existingId: exact.id, issues };
    }
    if (duplicate) return { rowNumber: row.rowNumber, status: "POSSIBLE_DUPLICATE", value: row.value, existingId: duplicate.id, issues: [...issues, "Coincide marca, modelo, generación, año y categoría/uso."] };
    return { rowNumber: row.rowNumber, status: issues.length ? "INVALID" : "NEW", value: row.value, existingId: null, issues };
  });
}
