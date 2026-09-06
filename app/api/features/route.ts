import { NextResponse } from "next/server";
import { authSocialServerEnabled, cloudServerEnabled, equipmentCloudServerEnabled, pollaLiveServerEnabled } from "../../../lib/feature-flags";
import { readAuthProviderStatus } from "../../../lib/auth-provider-status";

export async function GET() {
  const authProviders = await readAuthProviderStatus(process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return NextResponse.json({
    authProviders,
    authSocialEnabled: authSocialServerEnabled,
    cloudEnabled: cloudServerEnabled,
    equipmentCloudEnabled: cloudServerEnabled && equipmentCloudServerEnabled,
    pollaLiveEnabled: cloudServerEnabled && pollaLiveServerEnabled,
  }, { headers: { "cache-control": "no-store" } });
}
