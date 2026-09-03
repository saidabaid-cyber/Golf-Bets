import { NextResponse } from "next/server";
import { authSocialServerEnabled, cloudServerEnabled, pollaLiveServerEnabled } from "../../../lib/feature-flags";

export function GET() {
  return NextResponse.json({
    authSocialEnabled: authSocialServerEnabled,
    cloudEnabled: cloudServerEnabled,
    pollaLiveEnabled: cloudServerEnabled && pollaLiveServerEnabled,
  }, { headers: { "cache-control": "no-store" } });
}
