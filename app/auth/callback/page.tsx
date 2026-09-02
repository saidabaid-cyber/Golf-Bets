"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSupabaseBrowser } from "../../../lib/supabase/client";
import { authErrorMessage } from "../../../lib/account-state";
import { BrandLockup } from "../../components/brand-lockup";

export default function AuthCallbackPage() {
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      if (mounted) setError("El acceso tardó demasiado. Vuelve a Inicio e inténtalo nuevamente.");
    }, 15_000);
    async function finish() {
      const supabase = getSupabaseBrowser();
      if (!supabase) { window.clearTimeout(timeout); setError("El acceso con cuenta todavía no está configurado."); return; }
      try {
        const params = new URLSearchParams(window.location.search);
        const providerError = params.get("error_description") || params.get("error");
        if (providerError) throw new Error(providerError);
        const code = params.get("code");
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        }
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !data.session) throw sessionError || new Error("No session");
        if (mounted && !timedOut) window.location.replace("/?auth=complete");
      } catch (callbackError) {
        if (mounted && !timedOut) setError(authErrorMessage(callbackError));
      } finally {
        window.clearTimeout(timeout);
      }
    }
    finish();
    return () => { mounted = false; window.clearTimeout(timeout); };
  }, []);

  return <main className="accessScreen"><section className="accessCard callbackCard">
    <BrandLockup compact />
    {!error ? <><h1>Terminando tu acceso…</h1><p>Regresaremos a The Backyard en un momento.</p><Link className="textButton" href="/">← Volver a Inicio</Link></> : <><h1>No pudimos completar el acceso</h1><p role="alert">{error}</p><Link className="primary linkButton" href="/">Volver a The Backyard</Link></>}
  </section></main>;
}
