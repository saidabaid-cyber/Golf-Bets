import { Suspense } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { GpsPilotLogin } from "../../components/gps-pilot-login";
import { pilotHostEnabled } from "../../../lib/gps-pilot-la-vista-1/pilot.mjs";

export const metadata = { title: "Acceso al piloto GPS · The Backyard", robots: { index: false, follow: false } };

async function PilotLogin() {
  const requestHeaders = await headers();
  if (!pilotHostEnabled({ enabled: process.env.GPS_LA_VISTA_1_PILOT_ENABLED,
    branch: process.env.VERCEL_GIT_COMMIT_REF, deploymentEnvironment: process.env.VERCEL_ENV,
    host: requestHeaders.get("host") })) notFound();
  return <GpsPilotLogin />;
}

export default function Page() {
  return <Suspense fallback={<p>Cargando acceso al piloto…</p>}><PilotLogin /></Suspense>;
}
