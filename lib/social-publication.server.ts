import "server-only";
import { after } from "next/server";
import { getSupabaseAdmin } from "./supabase/server";
import { socialPreviewEnabled } from "./social-preview-gate";
import { reconcileSocialEquipmentActivity, reconcileSocialRoundActivities } from "./social-activity.server";

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
      } catch {
        console.error("backyard_social_publication_pending", { kind });
      }
    });
  } catch {
    // Never turn a successfully committed round/equipment save into a failure.
    console.error("backyard_social_publication_schedule_pending", { kind });
  }
}
