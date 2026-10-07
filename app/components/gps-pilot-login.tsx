"use client";

import { useEffect } from "react";
import { AccountProvider, useBackyardAccount } from "./account-provider";
import { consumeGpsPilotReturn, gpsReturnStorage, GPS_PILOT_PATH, rememberGpsPilotReturn } from "../../lib/gps-pilot-la-vista-1/auth-return";

function ReturnToPilot() {
  const { identity } = useBackyardAccount();
  useEffect(() => {
    if (identity.mode !== "authenticated" || !identity.accessToken) return;
    consumeGpsPilotReturn(gpsReturnStorage(), window.location.host);
    window.location.replace(GPS_PILOT_PATH);
  }, [identity.mode, identity.accessToken]);
  return <p role="status">Regresando al piloto GPS…</p>;
}

/** Existing account UI and lifecycle gates; never mounts the round application. */
export function GpsPilotLogin() {
  useEffect(() => { rememberGpsPilotReturn(gpsReturnStorage(), window.location.host); }, []);
  return <AccountProvider><ReturnToPilot /></AccountProvider>;
}
