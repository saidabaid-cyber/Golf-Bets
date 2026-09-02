"use client";

import Link from "next/link";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="es"><body><main className="app"><section className="welcomeScreen"><h1>THE BACKYARD necesita recargar.</h1><p>El autoguardado local protege la ronda en curso.</p><button onClick={reset}>Reintentar</button><Link href="/">Volver a Inicio</Link></section></main></body></html>;
}
