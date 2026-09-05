"use client";

import { useEffect, useState } from "react";

export function PwaRuntime() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let disposed = false;
    let removeRegistrationListeners = () => {};
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).then((registration) => {
        if (disposed) return;
        const activateWaiting = () => registration.waiting?.postMessage({ type: "SKIP_WAITING" });
        let installing: ServiceWorker | null = null;
        const handleStateChange = () => {
          if (installing?.state === "installed") activateWaiting();
        };
        const handleUpdateFound = () => {
          installing?.removeEventListener("statechange", handleStateChange);
          installing = registration.installing;
          installing?.addEventListener("statechange", handleStateChange);
        };
        activateWaiting();
        registration.addEventListener("updatefound", handleUpdateFound);
        const checkForUpdate = () => { if (navigator.onLine) void registration.update(); };
        window.addEventListener("online", checkForUpdate);
        window.addEventListener("pageshow", checkForUpdate);
        removeRegistrationListeners = () => {
          registration.removeEventListener("updatefound", handleUpdateFound);
          installing?.removeEventListener("statechange", handleStateChange);
          window.removeEventListener("online", checkForUpdate);
          window.removeEventListener("pageshow", checkForUpdate);
        };
      }).catch(() => {
        // IndexedDB autosave still protects the round; Account shows the error.
      });
    }
    return () => {
      disposed = true;
      removeRegistrationListeners();
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return offline ? <div className="offlineBanner" role="status">Sin conexión · Los cambios se guardan en este dispositivo y se sincronizarán al volver internet.</div> : null;
}
