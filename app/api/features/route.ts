import { NextResponse } from "next/server";
import { authSocialServerEnabled, cloudServerEnabled, equipmentCloudServerEnabled, pollaLiveServerEnabled } from "../../../lib/feature-flags";
import { readAuthProviderStatus } from "../../../lib/auth-provider-status";
import { serverPhase2FeatureFlags } from "../../../features/feature-flags/server";

export async function GET() {
  const phase2 = serverPhase2FeatureFlags();
  const authProviders = await readAuthProviderStatus(process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return NextResponse.json({
    authProviders,
    authSocialEnabled: authSocialServerEnabled,
    cloudEnabled: cloudServerEnabled,
    equipmentCloudEnabled: cloudServerEnabled && equipmentCloudServerEnabled,
    pollaLiveEnabled: cloudServerEnabled && pollaLiveServerEnabled,
    phase2,
  }, { headers: { "cache-control": "no-store" } });
}
