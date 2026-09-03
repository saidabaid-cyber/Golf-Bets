import type { SupabaseClient } from "@supabase/supabase-js";
type Row = Record<string, unknown>;
/** In-memory PostgREST protocol fake, NOT a real session/RLS integration test. */
export class CloudDb {
  tables: Record<string, Row[]> = {};
  calls: Array<{ table: string; op: string }> = [];
  fail?: (table: string, op: string, payload: Row[]) => boolean;
  before?: (table: string, op: string) => void;
  seq = 0;
  client = { from: (table: string) => new Query(this, table) } as unknown as SupabaseClient;
  rows(table: string) { return this.tables[table] ||= []; }
}
class Query {
  op = "select"; payload: Row[] = []; filters: Array<(row: Row) => boolean> = [];
  first = 0; last = 999; single = false; conflict = ""; ignored = false;
  constructor(private db: CloudDb, private table: string) {}
  select() { return this; }
  eq(key: string, value: unknown) { this.filters.push(row => row[key] === value); return this; }
  not(key: string) { this.filters.push(row => row[key] != null); return this; }
  in(key: string, values: unknown[]) { this.filters.push(row => values.includes(row[key])); return this; }
  order() { return this; }
  range(first: number, last: number) { this.first = first; this.last = last; return this; }
  maybeSingle() { this.single = true; return this; }
  insert(value: Row | Row[]) { this.op = "insert"; this.payload = Array.isArray(value) ? value : [value]; return this; }
  update(value: Row) { this.op = "update"; this.payload = [value]; return this; }
  upsert(value: Row | Row[], options?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.insert(value); this.op = "upsert"; this.conflict = options?.onConflict || ""; this.ignored = !!options?.ignoreDuplicates; return this;
  }
  delete() { this.op = "delete"; return this; }
  async execute() {
    this.db.calls.push({ table: this.table, op: this.op }); this.db.before?.(this.table, this.op);
    if (this.db.fail?.(this.table, this.op, this.payload)) return { error: new Error("Injected Supabase failure"), data: null };
    const rows = this.db.rows(this.table), matches = rows.filter(row => this.filters.every(filter => filter(row)));
    if (this.op === "select") return { error: null, data: structuredClone(this.single ? matches[0] || null : matches.slice(this.first, this.last + 1)) };
    if (this.op === "delete") {
      this.db.tables[this.table] = rows.filter(row => !matches.includes(row));
      if (this.table === "round_players_cloud") this.db.tables.round_scores_cloud = this.db.rows("round_scores_cloud").filter(score => !matches.some(player => player.id === score.round_player_id));
      return { error: null, data: matches };
    }
    if (this.op === "update") { for (const row of matches) Object.assign(row, structuredClone(this.payload[0])); return { error: null, data: matches }; }
    const written = [];
    for (const row of this.payload) {
      const keys = this.conflict ? this.conflict.split(",") : this.table === "round_players_cloud" ? ["round_id", "local_player_id"] : this.table === "round_scores_cloud" ? ["round_player_id", "hole"] : row.local_id ? ["owner_id", "local_id"] : row.round_id ? ["round_id"] : row.user_id ? ["user_id"] : row.id ? ["id"] : [];
      const existing = keys.length ? rows.find(other => keys.every(key => other[key] === row[key])) : undefined;
      if (existing && this.op === "insert") return { error: new Error("Unique conflict"), data: null };
      if (existing) { if (!this.ignored) Object.assign(existing, structuredClone(row)); written.push(existing); }
      else { const created = { id: "generated-" + (++this.db.seq), ...structuredClone(row) }; rows.push(created); written.push(created); }
    }
    return { error: null, data: written };
  }
  then(resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) { return this.execute().then(resolve, reject); }
}
