# Activación controlada de Admin Mode V2

El código de `feature/admin-mode-v2` exige una DB independiente. No aplicar estas migraciones en `bymeopxkxapfizeeqeyb` (DEV congelado) ni en `zhqmlpljloumldaczcfp` (proyecto padre compartido).

## Orden de activación

1. Confirmar organización y costo en Supabase; crear una nueva branch aislada. No reutilizar ni modificar la branch de DEV.
2. Revisar el historial de migraciones de esa nueva DB. Completar allí las migraciones existentes del repositorio que falten; luego aplicar, en orden, las cinco `20261001*_admin_mode_v2_*.sql`. Registrar cada apply y su ref. No ejecutar seeds de QA ni copiar datos personales, sesiones o credenciales desde DEV.
3. Configurar únicamente variables de Vercel Preview con `gitBranch=feature/admin-mode-v2`: `ADMIN_MODE_V2_ENABLED=true`, `ADMIN_MODE_ISOLATED_DB_REF=<nuevo-ref>`, `NEXT_PUBLIC_SUPABASE_URL=https://<nuevo-ref>.supabase.co`, la publishable/anon key y service role correspondientes a ese mismo proyecto. Preservar todas las variables globales y las de DEV/Production. Revisar los demás servicios externos antes de habilitarlos en esta branch.
4. Reconstruir el Preview. Next publica sólo el ref y los dos orígenes exactos de Vercel que el build pudo verificar. Configurar los redirects de Auth de la **nueva DB** para esos orígenes y `/auth/callback`; no cambiar Auth de DEV.
5. La identidad del propietario que ya funciona en DEV tiene un grant persistente GLOBAL SUPER_ADMIN; no necesita una allowlist por email. En la DB nueva, ese propietario debe autenticarse/registrarse realmente. Verificar su identidad de Auth antes de usar el bootstrap de operador.
6. Para una DB nueva sin SUPER_ADMIN, ejecutar `scripts/admin-mode-v2/bootstrap-super-admin.mjs` con las variables que documenta el script: ref, URL, service key, UUID del usuario real y motivo. El RPC sólo acepta `service_role`, una identidad existente y ninguna concesión SUPER_ADMIN activa. Registra el bootstrap en auditoría y rechaza repetirlo. No inventar usuarios ni hardcodear emails.
7. Buscar a `saidabaid@gmail.com` en Administradores. Existe en el QA actual, pero la nueva DB no recibe Auth users automáticamente. Si ya existe como identidad real en el nuevo entorno, asignar ADMIN desde la interfaz con motivo y confirmar auditoría. Hasta entonces: `PENDING_CONTROLLED_DB_APPLY`.
8. Hacer QA con sesiones reales PLAYER / ADMIN / SUPER_ADMIN: recargar después de guardar, leer desde otro cliente, revisar auditoría, probar accesos directos, rol revocado y sesión expirada. Confirmar navegación normal y probar móvil/iPhone.
9. Volver a comprobar que `/api/health` y el deployment que sirve `dev.thebackyard.com.mx` conservan el SHA congelado. No mergear ni mover aliases.

## Límites de producto

Simple Admin reutiliza publicación versionada de campos, equipo, bolas, reglas locales y competiciones. Las nuevas tablas sólo guardan presentación segura de apuestas y textos permitidos; no ejecutan código.

La creación de motores de apuestas, las importaciones, providers, fórmulas, evidencia de laboratorio, configuraciones complejas por hoyo y opciones de torneo sin backend permanecen en Administración Avanzada o requieren desarrollo. No hay borrado destructivo en los formularios simples.

## Verificación disponible sin servicios externos

`tests/admin-mode-database.test.ts` aplica las cinco migraciones nuevas a PostgreSQL/PGlite local y prueba RLS, concesiones, cambios de rol, auditoría, publicación, rechazos y persistencia entre sesiones SQL. Las tablas de compatibilidad y usuarios de ese test son fixtures exclusivos del test, no datos del producto. Esto no sustituye el apply ni el QA interactivo del Preview.

## Recuperación

DEV permanece en `1b53cf2e200d5ae6bd95d8f405b3dbe05004ede8`, recuperable desde `freeze/dev-2026-09-30-pre-admin-v2` y el tag anotado `freeze-dev-2026-09-30-pre-admin-v2`. Su deployment preservado es `dpl_CXisyFrTYx4qXgKr7dsyK7hV1X8y` (`https://golf-bets-kxv5aevm4-saha8.vercel.app`). No se necesita ni se ejecutó rollback. Cualquier futura reasignación de alias requiere orden humana explícita.
