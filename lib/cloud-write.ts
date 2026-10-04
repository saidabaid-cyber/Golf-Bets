import type { SupabaseClient } from "@supabase/supabase-js";

function timestamp(value: unknown) {
  const parsed = Date.parse(typeof value === "string" ? value : "");
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Compare-and-swap protects the read→write window across Vercel instances.
 * A concurrent change or RLS's zero-row update is a recoverable error, NOT ack. */
export async function writeVersionedRow(client: SupabaseClient, table: string, keys: Record<string, unknown>, row: Record<string, unknown>) {
  const snapshot = row.snapshot as { lifecycleState?: string; scorekeeping?: { version?: number } } | undefined;
  const closingShared = table === "rounds_cloud" && snapshot?.lifecycleState === "completed" && snapshot.scorekeeping?.version === 1;
  let select = client.from(table).select(closingShared ? "updated_at,snapshot" : "updated_at");
  for (const [key, value] of Object.entries(keys)) select = select.eq(key, value);
  const { data: raw, error } = await select.maybeSingle();
  const old = raw as unknown as { updated_at: string; snapshot?: { lifecycleState?: string } } | null;
  if (error) throw error;
  // A queued live capture may finish just after the client constructed its final
  // card. A completed owner card must not remain silently stuck behind that live
  // timestamp. The same read→write CAS still rejects a concurrent intervening write.
  if (old && closingShared && old.snapshot?.lifecycleState === "live")
    row = { ...row, updated_at: new Date(Math.max(Date.now(), timestamp(old.updated_at) + 1, timestamp(row.updated_at))).toISOString() };
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
