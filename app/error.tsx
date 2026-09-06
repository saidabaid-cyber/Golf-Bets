"use client";

import { useEffect } from "react";
import Link from "next/link";
import { trackOperationalError } from "../lib/telemetry";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); trackOperationalError("unexpected_ui_error", error, { code: error.digest }); }, [error]);
  return <main className="app"><section className="welcomeScreen"><div className="eyebrow">THE BACKYARD</div><h1>La pantalla no pudo cargar.</h1><p>Tu ronda permanece guardada en este dispositivo. Intenta abrirla de nuevo.</p><button className="primary big" onClick={reset}>Reintentar</button><Link className="secondary linkButton big" href="/">Volver a Inicio</Link></section></main>;
}
