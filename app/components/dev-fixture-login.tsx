'use client';

import { useState } from 'react';
import { getSupabaseBrowser } from '../../lib/supabase/client';

/** Mounted only by the existing server-gated DEV pilot page. */
export function DevFixtureLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/gps-pilot/qa-access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ email, password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo iniciar sesión QA.');
      const client = getSupabaseBrowser();
      if (!client) throw new Error('La sesión DEV no está configurada.');
      const result = await client.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
      if (result.error) throw new Error('No se pudo conservar la sesión QA.');
      window.location.replace('/?screen=play');
    } catch (error) { setError(error instanceof Error ? error.message : 'No se pudo iniciar sesión QA.'); setBusy(false); }
  }
  return <main style={{ maxWidth: 420, margin: 'auto', padding: 'max(24px, env(safe-area-inset-top)) 24px' }}>
    <h1>Acceso QA · DEV</h1>
    <p>Sólo Diego y Carlos, las cuentas de prueba existentes. No modifica permisos ni cierra sesiones de otros dispositivos.</p>
    <form onSubmit={login} style={{ display: 'grid', gap: 16 }}>
      <label>Correo QA<input style={{ display: 'block', width: '100%', minHeight: 44 }} type="email" autoComplete="off" required value={email} onChange={event => setEmail(event.target.value)} disabled={busy} /></label>
      <label>Contraseña QA<input style={{ display: 'block', width: '100%', minHeight: 44 }} type="password" autoComplete="off" required value={password} onChange={event => setPassword(event.target.value)} disabled={busy} /></label>
      <button type="submit" disabled={busy}>{busy ? 'Verificando cuenta…' : 'Entrar a Play con cuenta QA'}</button>
      {error && <p role="alert">{error}</p>}
    </form>
  </main>;
}
