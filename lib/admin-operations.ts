import type { AdminRecord } from "./admin-simple-catalog";

/** Daily editing shows one current draft; immutable prior versions remain in the ledger. */
export function adminLatestDrafts<T extends {entity_id:string;entity_type?:string;version:number}>(rows:readonly T[]):T[]{
 const latest=new Map<string,T>();
 for(const row of rows){const key=`${row.entity_type||""}:${row.entity_id}`;if(row.version>(latest.get(key)?.version??-1))latest.set(key,row);}
 return [...latest.values()];
}
export function adminCurrentDrafts<T extends {entity_id:string;entity_type?:string;version:number}>(drafts:readonly T[],published:readonly {entity_id:string;entity_type?:string;version:number}[]):T[]{
 const key=(row:{entity_id:string;entity_type?:string})=>`${row.entity_type||""}:${row.entity_id}`;
 const current=new Map(adminLatestDrafts(published).map(row=>[key(row),row.version]));
 return adminLatestDrafts(drafts).filter(row=>row.version>(current.get(key(row))??0));
}

/** Group for display only. Every underlying course/card keeps its identity. */
export function adminCourseFamilies(items: readonly AdminRecord[]) {
  const groups = new Map<string, AdminRecord[]>();
  for (const item of items) {
    const club = item.values.club as { id?: string } | undefined;
    const key = club?.id || item.id;
    groups.set(key, [...(groups.get(key) || []), item]);
  }
  return [...groups.values()].map(family => {
    const club = family[0].values.club as { name?: string } | undefined;
    const primary = family.find(item => item.title === club?.name) || family[0];
    return { ...primary, title: club?.name || primary.title, active: family.some(item => item.active),
      values: { ...primary.values, family: family.map(item => ({ id: item.id, title: item.title, active: item.active })) } };
  });
}

export function adminCatalogFacets(items: readonly AdminRecord[]) {
  const distinct = (key: string) => [...new Set(items.map(item => String(item.values[key] ?? "")).filter(Boolean))].sort();
  return { brand: distinct("brand"), category: distinct("category"), year: distinct("year") };
}
export function filterAdminCatalog(items: readonly AdminRecord[], filters: Record<string, string>) {
  return items.filter(item => ["brand", "category", "year"].every(key => !filters[key] || String(item.values[key] ?? "") === filters[key]));
}
export function adminListSummary(item: AdminRecord): AdminRecord {
  const { brand, category, year, generation, family } = item.values;
  return { ...item, values: { brand, category, year, generation, ...(family ? { family } : {}) } };
}
export function structuredNumbers(values: readonly unknown[], minimum: number, maximum: number) {
  if (values.length > 60) throw new Error("Demasiados valores.");
  const result = values.map(Number);
  if (result.some(value => !Number.isFinite(value) || value < minimum || value > maximum)) throw new Error("Revisa los valores numéricos.");
  return [...new Set(result)];
}
