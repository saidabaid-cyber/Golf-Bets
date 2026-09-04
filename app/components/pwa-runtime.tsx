"use client";

import { useEffect, useState } from "react";

export function PwaRuntime() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
        // IndexedDB autosave still protects the round; Account shows the error.
      });
    }
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  return offline ? <div className="offlineBanner" role="status">Sin conexión · Los cambios se guardan en este dispositivo y se sincronizarán al volver internet.</div> : null;
}
