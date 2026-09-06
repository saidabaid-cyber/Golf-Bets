"use client";

import { useEffect, useState } from "react";

export function PwaRuntime() {
  const [offline, setOffline] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);

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
        const handleInstalledWorker = (worker: ServiceWorker) => {
          if (navigator.serviceWorker.controller && worker.state === "installed") setUpdateReady(true);
        };
        let installing: ServiceWorker | null = null;
        const handleStateChange = () => {
          if (installing?.state === "installed") handleInstalledWorker(installing);
        };
        const handleUpdateFound = () => {
          installing?.removeEventListener("statechange", handleStateChange);
          installing = registration.installing;
          installing?.addEventListener("statechange", handleStateChange);
        };
        if (registration.installing) handleUpdateFound();
        if (registration.waiting) handleInstalledWorker(registration.waiting);
        registration.addEventListener("updatefound", handleUpdateFound);
        const checkForUpdate = () => { if (navigator.onLine) void registration.update().catch(() => undefined); };
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

  return <>
    {offline && <div className="offlineBanner" role="status">Sin conexión · Los cambios permanecen guardados en este dispositivo mientras vuelve internet.</div>}
    {!offline && updateReady && <div className="pwaUpdateBanner" role="status">
      <div><b>Nueva versión lista</b><span>Para aplicarla con seguridad, guarda tu captura y cierra todas las ventanas de The Backyard. Se instalará al volver a abrir.</span></div>
      <div><button type="button" className="secondary" onClick={() => setUpdateReady(false)}>Entendido</button></div>
    </div>}
  </>;
}
