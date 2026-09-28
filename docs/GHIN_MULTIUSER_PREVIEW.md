# GHIN multiusuario — Preview read-only

Estado: implementación exclusiva de `integration/backyard-current` y Vercel
Preview. Score posting permanece apagado.

## Flujo normal

Cada usuario Backyard autenticado aporta su propio email/número GHIN y password
en el diálogo de Perfil. El backend ejecuta:

1. Firebase Installation session.
2. `POST /golfer_login.json` con las credenciales recibidas.
3. Identidad autenticada desde `golfer_user` cuando GHIN la incluye; si el
   login fue por correo y esa respuesta omite el GHIN, búsqueda exacta por el
   mismo correo autenticado. Más de un GHIN distinto se rechaza sin adivinar.
4. Lookup del mismo número GHIN.
5. Confirmación explícita del usuario antes de persistir.

El comprobante de confirmación está firmado, ligado al `auth.uid()` Backyard y
expira en diez minutos. Contiene sólo la proyección pública del golfer; nunca el
password, token Firebase ni bearer GHIN. El password se descarta después del
login/lookup. El bearer vive sólo en la caché de memoria del proceso. Si expira
o el proceso cambia, Perfil devuelve `REAUTH_REQUIRED` y pide las credenciales
otra vez; no existe relogin silencioso.

Las variables `GHIN_TEST_LOGIN` y `GHIN_TEST_PASSWORD` siguen reservadas para el
diagnóstico admin protegido en `/admin/dev/ghin`. Las rutas normales de Perfil
no importan ni resuelven ese runtime global.

## Persistencia y ownership

`player_handicap_provider_profiles` mantiene una relación por owner/proveedor y
un índice único `(provider, external_player_id)`. Un GHIN no puede estar ligado
a dos cuentas Backyard. RLS permite a cada usuario leer exclusivamente su fila;
las escrituras continúan siendo server-managed y siempre se acotan al `userId`
obtenido de la sesión Backyard verificada.

Se persisten sólo número GHIN, nombre, club/home club, Handicap Index, status,
revision date y metadatos sanitizados de sincronización. La desvinculación borra
la relación activa y escribe un evento mínimo server-only; no toca rondas,
scores, snapshots ni la base de campos.

## Alcance comercial

La viabilidad técnica del flujo consumer no equivale a autorización comercial
para acceso masivo. GPA/vendor y `POST /users/login.json` permanecen
`BLOCKED_EXTERNAL` hasta disponer de credenciales y entitlements oficiales.
La relación estable `User ↔ GHIN link ↔ Profile ↔ Rounds` no depende del método
de reautenticación y podrá conservarse al migrar a ese flujo.

## Campos y score posting

El onboarding de Handicap ya no consulta campos. La selección vive en
`Jugar ronda → Campo → Layout → Tee`, reutilizando el catálogo interno y los
mappings GHIN ya confirmados (incluido La Vista oficial Par 72 y los layouts
provisionales Par 70/69).

`GHIN_SCORE_POSTING_ENABLED` debe permanecer `false`. Esta fase no agrega ni
invoca métodos de publicación.
