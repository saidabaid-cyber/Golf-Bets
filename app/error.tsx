"use client";

import { useEffect } from "react";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  return <main className="app"><section className="welcomeScreen"><div className="eyebrow">GOLF BETS</div><h1>La pantalla no pudo cargar.</h1><p>Tu ronda permanece guardada en este dispositivo. Intenta abrirla de nuevo.</p><button className="primary big" onClick={reset}>Reintentar</button></section></main>;
}
