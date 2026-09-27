# GHIN `@spicygolf/ghin@0.20.0` — validación QA read-only

Validación puntual ejecutada el 2026-09-27 exclusivamente en el Preview de
`integration/backyard-current`, usando `https://dev.thebackyard.com.mx`. La
evidencia sanitizada está en
`docs/ghin-spicygolf-020-poc-evidence.json`.

## Source auditado

El registro npm de `@spicygolf/ghin@0.20.0` declara el commit
`07f458391b04d22df9f647b5c3c4d634fba1458a` del repositorio `boorad/ghin`.
Se revisaron directamente `src/client/request-client/index.ts`, los modelos de
login/sesión, `src/client/ghin/index.ts`, y los modelos de golfer y scores de ese
commit.

El flujo normal de golfista observado es:

1. `POST https://firebaseinstallations.googleapis.com/v1/projects/ghin-mobile-app/installations`
   con el `appId`, `authVersion`, `fid`, `sdkVersion`, `x-goog-api-key` y User-Agent
   que contiene esa versión.
2. Extraer el `authToken.token` dinámico de la respuesta Firebase.
3. `POST https://api2.ghin.com/api/v1/golfer_login.json` con ese token y las
   credenciales server-only.
4. Usar `golfer_user.golfer_user_token` sólo como Bearer para los dos GET
   read-only de esta prueba.

## Resultado real

| Etapa | HTTP | Resultado |
| --- | ---: | --- |
| Firebase Installation session | 200 | PASS; `authToken.token` recibido |
| `golfer_login` | 200 | PASS; `golfer_user_token` recibido |
| `golfers/search.json` para `11103349` | 200 | PASS; identidad coincidente |
| `scores.json` para `11103349` | 200 | PASS; 503 scores |

El lookup devolvió `Said Abaid Taja`, GHIN `11103349`, `LA Vista Country Club`
como club/home club, Handicap Index `7.9`, estado `Active` y `rev_date`
`2026-09-24`. Esos valores son evidencia de la respuesta live de este timestamp;
no son fixtures ni valores esperados codificados en el flujo.

La respuesta de scores reportó 503 filas y `total_count=503`. Para minimizar la
exposición, la evidencia conserva sólo el conteo y los nombres de campos
estructurales presentes; no conserva scores, campos, fechas ni cuerpos crudos.

## Diferencia contra el cliente Backyard anterior

La autenticación anterior de Backyard llamaba directamente a
`/golfer_login.json` con un token RSA derivado del bundle web, añadía `source` y
`remember_me`, y agregaba `source=GHINcom` a las lecturas. Ese contrato devolvía
HTTP 400 para esta cuenta autorizada.

`@spicygolf/ghin@0.20.0` primero obtiene un token de Firebase Installations y lo
manda como `token`; no incluye `source` ni `remember_me` en el body de login y no
añade `source` a los GET. Esa diferencia concreta produjo HTTP 200 en las cuatro
etapas de esta POC.

## Flujo GPA / `apiAccess=true`

La misma versión implementa por separado `POST /users/login.json` cuando
`apiAccess=true`, con `user.email`, `user.password` y `remember_me=true`. Ese
flujo corresponde a credenciales/entitlements API o GPA y **no se probó** porque
no se proporcionaron credenciales GPA/vendor autorizadas. No se infirieron ni
inventaron permisos.

## Integración read-only promovida en QA

La implementación server-side de `GhinReadOnlyClient` consolidó el mismo flujo
demostrado. El bearer vive sólo en memoria, respeta expiración y se renueva una
sola vez ante 401/403. Las lecturas usan exactamente
`/golfers/search.json` y `/scores.json`; no existen métodos de score posting.

La activación requiere simultáneamente Preview, el master flag existente,
`GHIN_READ_ONLY_ENABLED=true` y `GHIN_GOLFER_LOOKUP_ENABLED=true`. Las rutas de
Perfil requieren además sesión Backyard y una membresía admin activa. Sólo el
GHIN QA `11103349` está permitido en esta fase.

La proyección persistida usa `player_handicap_provider_profiles`, ya aplicada en
Supabase QA. Guarda sólo GHIN, nombre, home club, estado, Handicap Index, fecha de
revisión y timestamps/estado de sync. No guarda password, Firebase token,
golfer bearer, cookies, Authorization ni respuesta cruda. Un refresh fallido
conserva el último valor exitoso.

El flujo GPA/vendor `POST /users/login.json` continúa separado y
`BLOCKED_EXTERNAL`; no se probó ni se infirieron permisos.

## Controles y cierre

- La evidencia POC permanece aislada; su flujo demostrado fue consolidado en
  `GhinReadOnlyClient` sin convertir la librería de referencia en dependencia.
- La ruta externa de prueba y su bearer efímero se retiraron después del run.
- `GHIN_TEST_LOGIN` y `GHIN_TEST_PASSWORD` permanecieron server-side; no se
  imprimieron, devolvieron, almacenaron ni incluyeron en commits.
- No se usaron cookies ni tokens anteriores.
- No se llamó ningún endpoint de publicación, edición o borrado de scores.
- No se tocó `main`, `beta`, Production, Supabase ni un dominio productivo.
