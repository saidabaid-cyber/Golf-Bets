import type { SupabaseClient } from "@supabase/supabase-js";

function timestamp(value: unknown) {
  const parsed = Date.parse(typeof value === "string" ? value : "");
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Compare-and-swap protects the read→write window across Vercel instances.
 * A concurrent change or RLS's zero-row update is a recoverable error, NOT ack. */
export async function writeVersionedRow(client: SupabaseClient, table: string, keys: Record<string, unknown>, row: Record<string, unknown>) {
  let select = client.from(table).select("updated_at");
  for (const [key, value] of Object.entries(keys)) select = select.eq(key, value);
  const { data: old, error } = await select.maybeSingle();
  if (error) throw error;
  if (old && timestamp(row.updated_at) <= timestamp(old.updated_at)) return false;
  if (!old) {
    const result = await client.from(table).insert(row).select();
    if (result.error || !result.data?.length) throw result.error || new Error("Escritura no confirmada");
  } else {
    let update = client.from(table).update(row).eq("updated_at", old.updated_at);
    for (const [key, value] of Object.entries(keys)) update = update.eq(key, value);
    const result = await update.select();
    if (result.error || !result.data?.length) throw result.error || Object.assign(new Error("Otro dispositivo actualizó este dato durante la escritura."), { code: "CLOUD_WRITE_RACE" });
  }
  return true;
}
