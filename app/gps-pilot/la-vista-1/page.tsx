import { Suspense } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { pilotHostEnabled } from "../../../lib/gps-pilot-la-vista-1/pilot.mjs";

export const metadata = { title: "Piloto GPS · La Vista 1 · The Backyard", robots: { index: false, follow: false } };

async function AuthorizedPilot() {
  const requestHeaders = await headers();
  if (!pilotHostEnabled({ enabled: process.env.GPS_LA_VISTA_1_PILOT_ENABLED,
    branch: process.env.VERCEL_GIT_COMMIT_REF, deploymentEnvironment: process.env.VERCEL_ENV,
    host: requestHeaders.get("host") })) notFound();
  // Retain the old URL/login return, but use the canonical round GPS.
  return redirect("/?screen=gps");
}

// The flag defaults to off; only the existing canonical DEV branch and host can
// serve this route. No database, Course Master, GHIN or round write is involved.
export default function Page() {
  return <Suspense fallback={<p>Cargando piloto GPS…</p>}><AuthorizedPilot /></Suspense>;
}
