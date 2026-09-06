"use client";

import Link from "next/link";
import { useEffect } from "react";
import { trackOperationalError } from "../lib/telemetry";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { trackOperationalError("unexpected_global_error", error, { code: error.digest }); }, [error]);
  return <html lang="es"><body><main className="app"><section className="welcomeScreen"><h1>THE BACKYARD necesita recargar.</h1><p>El autoguardado local protege la ronda en curso.</p><button onClick={reset}>Reintentar</button><Link href="/">Volver a Inicio</Link></section></main></body></html>;
}
