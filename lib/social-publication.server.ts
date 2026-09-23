import "server-only";
import { after } from "next/server";
import { getSupabaseAdmin } from "./supabase/server";
import { socialPreviewEnabled } from "./social-preview-gate";
import { reconcileSocialEquipmentActivity, reconcileSocialRoundActivities } from "./social-activity.server";

function publicationFailureCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code.slice(0, 48);
  }
  const message = error instanceof Error ? error.message : "";
  if (/permission|row-level|42501/i.test(message)) return "permission_or_rls";
  if (/schema|table|column|PGRST20|42P01|42703/i.test(message)) return "schema_mismatch";
  if (/fetch|network|timeout/i.test(message)) return "network";
  return "reconcile_failed";
}

/** Source DB triggers are the durable publication reference; after() handles the
 * immediate derivation without changing the existing cloud save transaction.
 * Feed reads retry unfinished materialization after provider/runtime failures. */
export function scheduleSocialPublication(userId: string, kind: "round" | "equipment") {
  if (!socialPreviewEnabled()) return;
  try {
    after(async () => {
      try {
        const admin = getSupabaseAdmin("cloud");
        if (!admin) return;
        if (kind === "round") await reconcileSocialRoundActivities(admin, userId);
        else await reconcileSocialEquipmentActivity(admin, userId);
      } catch (error) {
        console.error("backyard_social_publication_pending", { kind, code: publicationFailureCode(error) });
      }
    });
  } catch {
    // Never turn a successfully committed round/equipment save into a failure.
    console.error("backyard_social_publication_schedule_pending", { kind });
  }
}
