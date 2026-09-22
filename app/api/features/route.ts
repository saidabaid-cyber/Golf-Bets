import { NextResponse } from "next/server";
import { authSocialServerEnabled, cloudServerEnabled, equipmentCloudServerEnabled, pollaLiveServerEnabled } from "../../../lib/feature-flags";
import { readAuthProviderStatus } from "../../../lib/auth-provider-status";
import { previewDatabaseFeaturesAvailable } from "../../../lib/preview-database";
import { serverPhase2FeatureFlags } from "../../../features/feature-flags/server";

export async function GET() {
  const phase2 = serverPhase2FeatureFlags();
  const databaseBindingReady = previewDatabaseFeaturesAvailable();
  const authProviders = databaseBindingReady
    ? await readAuthProviderStatus(process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    : { status: "unconfigured" as const, email: false, google: false, apple: false };
  return NextResponse.json({
    authProviders,
    authSocialEnabled: databaseBindingReady && authSocialServerEnabled,
    cloudEnabled: databaseBindingReady && cloudServerEnabled,
    equipmentCloudEnabled: databaseBindingReady && cloudServerEnabled && equipmentCloudServerEnabled,
    pollaLiveEnabled: databaseBindingReady && cloudServerEnabled && pollaLiveServerEnabled,
    phase2,
  }, { headers: { "cache-control": "no-store" } });
}
