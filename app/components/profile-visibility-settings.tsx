"use client";

import { useEffect, useRef, useState } from "react";
import { requestProfileAudience, type PersistedProfileAudience, type ProfileAudienceChoice } from "../../lib/profile-visibility";

/** Only server-confirmed audience is displayed. Legacy private never silently widens. */
export function ProfileVisibilitySettings({ userId, accessToken, authenticated }: { userId: string; accessToken?: string | null; authenticated: boolean }) {
  const [visibility, setVisibility] = useState<PersistedProfileAudience | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [retry, setRetry] = useState(0);
  const inFlight = useRef(false);
  const scope = useRef(0);
  useEffect(() => {
    const revision = ++scope.current;
    const controller = new AbortController();
    setVisibility(null); setStatus(""); setLoading(authenticated); setSaving(false); inFlight.current = false;
    if (authenticated && accessToken) void requestProfileAudience(accessToken, undefined, controller.signal)
      .then((value) => { if (scope.current === revision) setVisibility(value); })
      .catch(() => { if (scope.current === revision && !controller.signal.aborted) setStatus("No pudimos consultar tu privacidad. Reintenta."); })
      .finally(() => { if (scope.current === revision) setLoading(false); });
    else setLoading(false);
    return () => { scope.current = revision + 1; controller.abort(); };
  }, [userId, accessToken, authenticated, retry]);

  async function choose(next: ProfileAudienceChoice) {
    if (!authenticated || !accessToken || loading || inFlight.current || visibility === null) return;
    inFlight.current = true; setSaving(true); setStatus("");
    const revision = scope.current;
    try {
      const confirmed = await requestProfileAudience(accessToken, next);
      if (scope.current !== revision) return;
      setVisibility(confirmed); setStatus("Privacidad guardada.");
    } catch { if (scope.current === revision) setStatus("No pudimos guardar tu privacidad. Tu selección anterior se conserva."); }
    finally { if (scope.current === revision) { inFlight.current = false; setSaving(false); } }
  }

  return <section aria-label="Privacidad del perfil" aria-busy={loading || saving}>
    <b>Privacidad</b><p className="hint">Quién puede ver tu perfil social. Tu correo, ubicación y datos de cuenta no se hacen públicos.</p>
    <div className="segmented" role="group" aria-label="Visibilidad del perfil">
      <button type="button" aria-pressed={visibility === "public"} disabled={!authenticated || loading || saving || visibility === null} onClick={() => void choose("public")}>Público</button>
      <button type="button" aria-pressed={visibility === "friends"} disabled={!authenticated || loading || saving || visibility === null} onClick={() => void choose("friends")}>Amigos</button>
    </div>
    {visibility === "private" && <p className="hint">Tu configuración anterior sigue protegida. Elige una audiencia para cambiarla.</p>}
    {loading && <p role="status">Consultando privacidad…</p>}
    {saving && <p role="status">Guardando…</p>}
    {!authenticated && <p className="hint">Inicia sesión para guardar esta preferencia.</p>}
    {status && <p role="status">{status}</p>}
    {authenticated && !loading && visibility === null && <button type="button" onClick={() => setRetry((value) => value + 1)}>Reintentar</button>}
  </section>;
}
