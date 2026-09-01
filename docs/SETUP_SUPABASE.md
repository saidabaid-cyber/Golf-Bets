# Configurar Supabase para Polla Live

La app compila y las apuestas privadas funcionan si Supabase no está configurado. En ese caso Polla Live muestra un aviso claro y no intenta conectarse.

1. Crea un proyecto Supabase.
2. Ejecuta, en orden, las migraciones de `supabase/migrations/` desde el SQL Editor o la CLI.
3. Activa Realtime para las tablas incluidas por la migración. La interfaz mantiene polling como respaldo si Realtime falla.
4. Crea `.env.local` a partir de `.env.example`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://TU-PROYECTO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

5. Reinicia `pnpm dev`.

## Seguridad

- La service role solo se importa en módulos `server-only` y nunca usa prefijo `NEXT_PUBLIC_`.
- Todas las tablas expuestas tienen RLS activado.
- El administrador edita torneos propios; el scorer invitado pasa por endpoints servidor y queda limitado a su grupo y a una tarjeta abierta.
- El PIN se almacena con `crypt()`; la sesión invitada se guarda como hash SHA-256 y puede revocarse.
- El leaderboard público sale por un endpoint que selecciona campos permitidos. No expone hashes, access tokens ni apuestas privadas.
- Cada insert/update de score crea una entrada inmutable de auditoría.

Antes de producción ejecuta también las verificaciones de `supabase/tests/polla_live_rls.sql` con usuarios de prueba. Nunca copies la service role al navegador.

## Cuentas

El panel de administrador usa magic link de Supabase Auth. Los jugadores pueden entrar a una Polla sin cuenta eligiendo su nombre y usando su PIN individual. La base deja preparado `profile_id` para reclamar el jugador más adelante.
