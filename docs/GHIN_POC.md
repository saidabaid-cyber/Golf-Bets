# GHIN read-only POC

> **DOCUMENTO HISTÓRICO — NO USAR COMO ESTADO CANÓNICO NI RUNBOOK.** Conserva evidencia de `codex/ghin-poc`; el código aceptado se evalúa ahora en `integration/backyard-current`, con GHIN live apagado hasta QA externo. Consulte el [manifiesto de consolidación](./CONSOLIDATION_MANIFEST_2026-09-24.md), el [estado canónico del producto](./CANONICAL_PRODUCT_STATUS_2026-09-24.md) y el [ledger canónico de migraciones](./CANONICAL_MIGRATION_LEDGER_2026-09-24.md). No habilite credenciales, flags, deploys ni migraciones a partir de este archivo.

## Estado y alcance

- Repositorio: `saidabaid-cyber/Golf-Bets`.
- Rama de trabajo: `codex/ghin-poc`.
- Commit base auditado: `3274c418a27da49ca6acb2ce7d025f4efcd070d3`.

> **No existe un PASS de integración GHIN en vivo.** El código local, los parsers,
> los controles de seguridad y los tests con respuestas simuladas no acreditan
> autenticación real, acceso a un jugador, Score History ni Course Data.

Este POC es exclusivamente de lectura y está preparado para un Vercel Preview
aislado. No habilita GHIN en Production, no reemplaza el catálogo de campos de
The Backyard, no publica scores y no demuestra que The Backyard tenga todavía
autorización comercial o técnica para consumir datos GHIN.

| Alcance | Estado | Evidencia o bloqueo |
| --- | --- | --- |
| Primitivas locales, normalización, cliente read-only y comparación | `PASS` local únicamente | Tests deterministas/mocks; no son evidencia GHIN live |
| Alcanzabilidad de endpoints públicos conocidos | `PARTIAL` | Respondieron con 400/401 a credenciales/token deliberadamente inválidos |
| Autenticación con cuenta autorizada | `BLOCKED_EXTERNAL` | Faltan `GHIN_TEST_LOGIN` y `GHIN_TEST_PASSWORD` autorizados |
| Lookup real de GHIN `11103349` | `BLOCKED_EXTERNAL` | No se obtuvo bearer token real |
| Score History real | `BLOCKED_EXTERNAL` | No se obtuvo bearer token real |
| Course Data/TeeSetRatings real | `BLOCKED_EXTERNAL` | Autenticación y entitlement de Course Data no determinados |
| Asociación en Perfil | `BLOCKED_EXTERNAL` | No se activa sin lookup real exitoso y revisión humana |
| Tablas provider-link y perfil proveedor | `PENDING_CONTROLLED_DB_APPLY` | Migración preparada, no aplicada a una DB Preview aislada |
| Página de diagnóstico en Preview | `PASS` de despliegue únicamente | La página responde; la API rechaza acceso anónimo. Esto no acredita GHIN live |
| Ejecución del diagnóstico GHIN live | `PENDING_INTERACTIVE_QA` | Requiere admin autorizado, credenciales autorizadas y los opt-ins de Preview |

## Evidencia de red realmente obtenida

Fuente versionada: `docs/ghin-poc-evidence.json`.

- Timestamp UTC exacto: `2026-09-24T20:19:18.8732526Z`.
- Entorno: `controlled-local-read-only-probe`.
- Credenciales: sentinel deliberadamente inválido; no se utilizaron credenciales
  reales de una persona.

| Método | Endpoint probado | HTTP | Resultado sanitizado | Interpretación |
| --- | --- | ---: | --- | --- |
| `POST` | `https://api.ghin.com/api/v1/golfer_login.json` | 400 | `Incorrect Credentials` | Endpoint alcanzable. No prueba autenticación autorizada. |
| `GET` | `https://api.ghin.com/api/v1/golfers/search.json` | 401 | `Invalid token` | Endpoint alcanzable y protegido. No hubo lookup. |
| `GET` | `https://api.ghin.com/api/v1/scores/search.json` | 401 | `Invalid token` | Endpoint alcanzable y protegido. No hubo scores. |
| `GET` | `https://api2.ghin.com/api/v1/golfers.json` | 401 | `Invalid token` | Endpoint alcanzable y protegido. No hubo lookup. |
| `GET` | `https://api2.ghin.com/api/v1/crsCourseMethods.asmx/SearchCourses.json` | 401 | `Invalid token` | Endpoint alcanzable y protegido. No prueba entitlement de Course Data. |

En ese probe: `realUserCredentialsUsed=false`, `bearerTokenObtained=false`,
`scorePosted=false` y `productionTouched=false`. Un HTTP 400/401 esperado no se
convierte en PASS del caso funcional.

## Autorización pendiente: GHIN, GPA y Course Data

GPA significa **Golfer Product Access Program**. La USGA describe a los productos
aprobados como Handicap Data Affiliates autorizados en su
[lista oficial de vendors GPA](https://www.usga.org/content/usga/home-page/handicapping/world-handicap-system/GPA-Approved-Vendors.html).
El repositorio no contiene evidencia de que The Backyard ya tenga esa aprobación,
un acuerdo GHIN/API o credenciales emitidas para este uso. Una cuenta de golfista
autorizada para la prueba tampoco demuestra por sí sola autorización del producto.

Antes de consultar datos reales se requiere:

1. Confirmación escrita del acceso autorizado aplicable — GPA/Handicap Data
   Affiliate u otro acuerdo oficial que GHIN/USGA indique para este producto.
2. Una cuenta de prueba GHIN cuyo titular autorice expresamente el probe.
3. Confirmar con documentación o soporte autorizado el contrato actual de login.
   El cliente POC conserva el contrato histórico observado:
   `user.email_or_ghin`, `password`, `remember_me: "true"` y el campo superior
   `token`. El probe inválido sólo demostró alcance del endpoint; este contrato
   aún debe confirmarse con la documentación autorizada vigente.
4. Confirmar separadamente si el bearer token de `golfer_login` autoriza Golfer,
   Scores y Course Data, o si Course/Data Services requiere otro entitlement,
   `client_id`/`client_secret`, cuenta u origen.

No se deben reutilizar credenciales publicadas, claves encontradas en GitHub,
cookies, sesiones de otras aplicaciones ni secretos de un desarrollador externo.
No se debe sortear CAPTCHA, rate limits, bloqueos o controles de acceso. Si el
token de golfista no autoriza Course Data, ese resultado es `BLOCKED_EXTERNAL`,
no un motivo para probar endpoints privados por ingeniería inversa.

## Configuración exclusiva de Preview

Los valores se configuran únicamente como variables del deployment Vercel Preview
de esta rama. Production debe conservar todos los flags GHIN desactivados.
`VERCEL_ENV=preview` lo proporciona Vercel; no debe falsearse manualmente para
saltar el guard.

```dotenv
# Booleano público, nunca contiene una credencial.
NEXT_PUBLIC_BACKYARD_GHIN_INTEGRATION=true

# Opt-ins server-side independientes.
GHIN_GOLFER_LOOKUP_ENABLED=true
GHIN_COURSE_LOOKUP_ENABLED=false
GHIN_COURSE_SYNC_ENABLED=false

# Secretos server-only de la cuenta autorizada.
GHIN_TEST_LOGIN=<configurar en el gestor de secretos de Preview>
GHIN_TEST_PASSWORD=<configurar en el gestor de secretos de Preview>

# Opcional; sólo estos dos hosts y exactamente /api/v1 son aceptados.
GHIN_API_BASE_URL=https://api.ghin.com/api/v1

# Opcional. El POC usa "123" como sentinel histórico no secreto si se omite.
# Confirmar el contrato vigente; no copiar una API key de terceros.
GHIN_LOGIN_BOOTSTRAP_TOKEN=
```

Activación escalonada:

1. Empezar con `GHIN_COURSE_LOOKUP_ENABLED=false` y
   `GHIN_COURSE_SYNC_ENABLED=false`.
2. Habilitar Golfer únicamente para el probe fijo descrito abajo.
3. Habilitar Course Lookup sólo después de probar la autenticación y recibir
   confirmación de que esa credencial está autorizada para Course Data.
4. `GHIN_COURSE_SYNC_ENABLED=true` habilita exclusivamente la capacidad de
   **dry-run**; no autoriza escrituras ni aplicación automática.

`lib/ghin/config.ts` rechaza HTTP, puertos, credenciales embebidas, query/hash,
hosts distintos de `api.ghin.com`/`api2.ghin.com` y paths distintos de
`/api/v1`. `lib/ghin/credentials.server.ts` pertenece al grafo server-only.
Nunca colocar login, password o bearer token en `NEXT_PUBLIC_*`, logs, screenshots,
telemetría, respuestas HTTP o almacenamiento del navegador.

## Superficie de red implementada

`GhinReadOnlyClient` usa uno de los dos bases allowlisted anteriores y expone
solamente estas operaciones. Los parámetros indicados son los que construye el
código actual; todavía deben confirmarse contra el servicio autorizado real.

| Operación | Método y path exacto |
| --- | --- |
| Login | `POST /golfer_login.json` |
| Golfer principal | `GET /golfers/search.json?golfer_id=<GHIN>&per_page=10&page=1&sorting_criteria=id&order=ASC` |
| Golfer fallback, sólo ante 404/405 | `GET /golfers.json?golfer_id=<GHIN>&source=GHINcom&from_ghin=true&per_page=10&page=1` |
| Scores principal | `GET /scores/search.json?golfer_id=<GHIN>&per_page=<1..100>&page=1` |
| Scores fallback, sólo ante 404/405 | `GET /scores.json?golfer_id=<GHIN>&source=GHINcom&per_page=<1..100>&page=1` |
| Course Search | `GET /crsCourseMethods.asmx/SearchCourses.json?name=<nombre>&source=GHINcom&per_page=<1..100>&page=1` |
| Course Details | `GET /crsCourseMethods.asmx/GetCourseDetails.json?course_id=<id>&tee_set_status=Active` |
| TeeSet Rating | `GET /TeeSetRatings/<teeSetRatingId>.json?include_altered_tees=false` |

Todas las lecturas usan `Authorization: Bearer <token>`, `cache: no-store`, timeout
de 10 segundos, redirect bloqueado y errores sanitizados. Ante 401/403 el cliente
descarta la sesión, autentica de nuevo una sola vez y reintenta exactamente una
vez. El trace conserva sólo método, path sin query, HTTP, duración, timestamp y
resultado; no conserva cuerpos, credenciales ni token. La huella de diagnóstico
del token es SHA-256 truncado, no el bearer.

La implementación utiliza hoy un solo `GHIN_API_BASE_URL`. Si Golfer y Course Data
requieren hosts o mecanismos de autenticación distintos, el POC actual queda
`PARTIAL`; no se debe forzar un token de una capacidad sobre la otra.

No existe método para publicar, editar o borrar scores. Tampoco existen handlers
`PUT`, `PATCH` o `DELETE` GHIN.

### Endpoint interno de diagnóstico

La API preparada para el Preview es `/api/admin/dev/ghin`:

- `GET` devuelve únicamente configuración/capacidades sanitizadas, targets fijos
  y blockers. No ejecuta una consulta GHIN.
- `POST` acepta exclusivamente `{"operation":"run_full_read_only"}` y ejecuta
  la secuencia fija de auth, jugador, scores y, cuando su flag está autorizado,
  La Vista/Course/TeeSet/dry-run.
- No acepta query-string ni selectores libres; el body máximo es 1 KiB.
- Requiere mismo origen, sesión Backyard válida, `admin_v1` y una membresía
  `admin_memberships` activa.
- El POST permite tres ejecuciones por usuario por ventana de diez minutos.
- Las respuestas son `private, no-store` y `nosniff`.

La ruta no persiste el resultado, no activa Perfil y no aplica mappings. Su
limiter también vive en memoria y comparte las limitaciones serverless indicadas
abajo; es defensa de POC, no un rate limit global distribuido.

## TTL, deduplicación y límite serverless

Valores actuales en memoria:

| Dato | TTL |
| --- | ---: |
| Sesión/token sin expiración verificable | 55 minutos, con margen de 60 segundos |
| Golfer | 5 minutos |
| Score History | 5 minutos |
| Course Search | 30 minutos |
| Course Details | 30 minutos |
| TeeSet Rating | 30 minutos |

`TtlPromiseCache` comparte una única promesa entre consultas concurrentes con la
misma llave y no conserva rechazos. El login también es single-flight. Esto reduce
duplicados dentro de **una instancia caliente**.

Limitaciones importantes:

- La caché y el rate limiting local no son durables ni distribuidos.
- Un cold start pierde token y resultados; dos instancias/regiones pueden volver
  a autenticar o consultar simultáneamente.
- El singleton de módulo no coordina deployments, regiones ni escalado horizontal.
- El TTL no constituye una cuota contractual ni garantiza respetar un rate limit
  global del proveedor.
- Antes de ampliar el acceso se requiere un limiter compartido server-side,
  política de retención/cleanup y métricas sanitizadas. Nunca almacenar el bearer
  en una tabla o caché accesible por el cliente.

## Secuencia controlada: GHIN 11103349 y La Vista

Esta secuencia debe ejecutarse desde la página/ruta admin protegida del Preview,
nunca desde el navegador directamente a GHIN.

1. Confirmar deployment Preview, admin autenticado, flags y secrets server-only.
2. Ejecutar `POST /golfer_login.json`. Registrar sólo éxito/fallo, HTTP,
   timestamp y fingerprint sanitizado.
3. Consultar exactamente `11103349`.
4. Exigir que la respuesta real conserve `ghinNumber === "11103349"` y revisar
   humanamente que corresponda a **Said Abaid Taja** y **La Vista Country Club**.
   El Handicap Index debe tomarse de la respuesta real: no se espera ni se
   hardcodea `7.9`. `NH`, ausente o `null` permanece `null`, nunca cero.
5. Si número o identidad no coinciden, detener asociación y registrar `FAIL`.
   Si la autenticación o permisos faltan, registrar `BLOCKED_EXTERNAL`.
6. Con la misma sesión autorizada, leer Score History. No publicar ni modificar
   registros. Conservar fecha, campo, tee, score, adjusted score, differential,
   rating, slope, tipo, posting method, hoyos e IDs sólo cuando existan.
7. Sólo después del lookup de jugador exitoso y la autorización de Course Data,
   buscar `LA VISTA COUNTRY CLUB` y resolver inequívocamente Puebla, Puebla,
   México. Registrar facility/course ID, ubicación, hoyos y estado reales.
8. Consultar Course Details y cada TeeSet Rating cuyo significado de ID esté
   verificado. Conservar `null` en campos ausentes.
9. Ejecutar el comparador contra `club-la-vista` / `course-la-vista`; revisar el
   reporte humano y JSON. No aplicar cambios.

No se debe marcar Golfer, Scores o Courses como PASS por respuestas de tests,
fixtures históricos o el snapshot QA del catálogo.

## Política de comparación y mappings

`lib/ghin/course-comparison.ts` produce un `DRY_RUN` con `readOnly=true` y
`applied=false`. Clasifica cada campo como:

- `MATCH`
- `DIFFERENT`
- `MISSING_IN_BACKYARD`
- `MISSING_IN_GHIN`
- `UNKNOWN`

Compara datos generales del campo, nombre/género/hoyos del tee, Course Rating,
Slope Rating, rating/slope front y back, par, yardas totales, par/yardas/Stroke
Index por hoyo. El matching de tees admite ID o nombre explícito, nombre exacto
normalizado y aliases suministrados; nunca hace fuzzy matching. Duplicados quedan
ambiguos y no se elige uno silenciosamente.

Reglas de identidad:

- Un slug `BACKYARD_INTERNAL` no es un Course/Facility ID GHIN.
- Los IDs QA `ghin:23233:tee:<hash>` son claves sintéticas de evidencia, no TeeSet
  IDs. No se insertan en `external_tee_set_id`.
- El `teeSetId=106087` presente en una URL histórica de La Vista no acredita por
  sí solo el ID de cada tee/color.
- `proposeLaVistaGhinMappings` sólo propone un provider ID de tee cuando llega
  separadamente mediante `verifiedTeeSetIdsBySourceId`. La verificación sigue
  requiriendo revisión humana.
- GHIN es una fuente externa de candidatos; no reemplaza la DB Backyard. GPS,
  mapas, hazards, imágenes y metadata propia permanecen fuera de esta sincronía.
- Rating, slope, par, nombre y yardaje sólo pueden avanzar después de respuesta
  autorizada, procedencia, categoría correcta y QA explícito. No hay sync masivo.

## Perfil: preparado pero no activado

El adapter `createGhinHandicapProvider` reutiliza `HandicapProvider`, preserva el
índice oficial sin aplicarle el cap del HCP manual, mantiene `NH/null` como null y
declara `authorized_write=false`. La capacidad `account_link` permanece false
salvo opt-in explícito de servidor.

Como no hubo lookup live autorizado:

- No se habilita la asociación GHIN en Perfil.
- No se persiste nombre, club, índice ni estado del fixture/mock.
- No se muestra “GHIN verificado”. Un lookup futuro sólo permite
  `LOOKUP_FOUND`; una confirmación “¿Este eres tú?” sería `SELF_ATTESTED`, no
  prueba de propiedad de la cuenta GHIN.
- El flujo manual y Backyard Index continúan operando sin GHIN.
- El HCP de cada ronda debe seguir congelado en su snapshot; una sincronización
  posterior nunca recalcula rondas históricas.

Los números como `7.9`, `7.2` o `41.7` presentes en tests/migraciones son fixtures
sintéticos y no son el Handicap Index real de `11103349`.

## Migración: aplicación controlada pendiente

`supabase/migrations/20260924010000_ghin_provider_foundation.sql` prepara de forma
aditiva:

- `golf_course_provider_links`
- `golf_tee_provider_links`
- `player_handicap_provider_profiles`

No almacena passwords, bearer tokens, cookies ni respuestas crudas. Los mappings
y perfiles son server-managed; cuentas autenticadas sólo tienen las lecturas RLS
permitidas. El perfil conserva el último valor exitoso ante un refresh fallido y
jamás convierte null a cero. `LOOKUP_FOUND` y `SELF_ATTESTED` no equivalen a
ownership verificado.

Estado: `PENDING_CONTROLLED_DB_APPLY`. No se aplicó esta migración a Production ni
a una DB compartida. Antes de activarla:

1. Confirmar una ref Supabase Preview realmente aislada y distinta de Production.
2. Revisar el ledger y aplicar la migración una sola vez por el mecanismo normal.
3. Ejecutar `supabase/tests/ghin_provider_foundation_rls.sql` contra esa ref.
4. Probar aislamiento owner A/owner B, grants, RLS, preservación del último éxito
   y rechazo de mappings tee/course cruzados.
5. Mantener `GHIN_COURSE_SYNC_ENABLED=false` hasta completar revisión humana.

## Score posting y Production

Score posting está fuera de alcance y no está implementado. No se envió ningún
score de prueba, no se modificó un handicap GHIN y no debe añadirse un endpoint de
escritura en este POC. Para una fase futura se necesita autorización oficial,
documentación vigente, consentimiento del usuario y contrato de campos requerido;
la viabilidad técnica no concede autorización comercial.

Production permanece sin tocar:

- El probe registró `productionTouched=false`.
- Los guards requieren `VERCEL_ENV=preview`.
- Los flags Production continúan apagados.
- No se aplicó la migración GHIN remotamente.
- Existe un deployment Preview verificable y la página de diagnóstico responde,
  pero no está activado con credenciales reales; su URL no puede presentarse como
  GHIN live PASS.

## Criterio de cierre posterior

Un cierre live sólo puede declararse después de guardar evidencia sanitizada de:

1. autenticación autorizada real;
2. lookup real de `11103349` con identidad esperada;
3. Handicap Index real y timestamp, sin valor esperado hardcodeado;
4. Score History real o error/permiso exacto;
5. Course Search de La Vista y autorización usada;
6. Course/Facility/TeeSet IDs y datos realmente devueltos;
7. dry-run Backyard vs GHIN sin aplicar cambios;
8. deployment Preview y DB aislada identificables;
9. confirmación reiterada de cero score posting y cero cambios Production.

Hasta entonces, la conclusión sigue siendo: infraestructura local preparada,
alcanzabilidad parcial demostrada y acceso funcional real `BLOCKED_EXTERNAL`.
