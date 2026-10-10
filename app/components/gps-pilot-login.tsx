"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AccountProvider, useBackyardAccount } from "./account-provider";
import { DevFixtureLogin } from "./dev-fixture-login";
import { consumeGpsPilotReturn, gpsReturnStorage, GPS_PILOT_PATH, rememberGpsPilotReturn } from "../../lib/gps-pilot-la-vista-1/auth-return";

function ReturnToPilot({ reauthenticate, onRequested, destination }: { reauthenticate: boolean; onRequested: () => void; destination: string }) {
  const { identity, openAccess } = useBackyardAccount();
  useEffect(() => {
    // DEV pilot page is gated server-side. Reuse the normal login, keeping
    // other browser refresh sessions and each account's workspace intact.
    if (reauthenticate) { onRequested(); openAccess(); return; }
    if (identity.mode !== "authenticated" || !identity.accessToken) return;
    consumeGpsPilotReturn(gpsReturnStorage(), window.location.host);
    window.location.replace(destination);
  }, [identity.mode, identity.accessToken, reauthenticate, onRequested, openAccess, destination]);
  return <p role="status">Regresando al piloto GPS…</p>;
}

/** Existing account UI and lifecycle gates; never mounts the round application. */
export function GpsPilotLogin() {
  const params = useSearchParams();
  const [reauthenticate, setReauthenticate] = useState(() => params.get("reauth") === "1");
  useEffect(() => { rememberGpsPilotReturn(gpsReturnStorage(), window.location.host); }, []);
  if (params.get('qa') === '1') return <DevFixtureLogin />;
  return <AccountProvider><ReturnToPilot reauthenticate={reauthenticate} onRequested={() => setReauthenticate(false)} destination={params.get("return") === "play" ? "/?screen=play" : GPS_PILOT_PATH} /></AccountProvider>;
}
