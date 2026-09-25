# Catálogo y feedback — QA 2026-09-20

> **DOCUMENTO HISTÓRICO — NO USAR COMO ESTADO ACTUAL NI RUNBOOK.** Conserva evidencia de `phase2/course-catalog-feedback`; sus ramas, métricas, bloqueos y pasos pendientes corresponden a ese cierre. La fuente operativa es `integration/backyard-current`; consulte el [manifiesto de consolidación](./CONSOLIDATION_MANIFEST_2026-09-24.md), el [estado canónico del producto](./CANONICAL_PRODUCT_STATUS_2026-09-24.md) y el [ledger canónico de migraciones](./CANONICAL_MIGRATION_LEDGER_2026-09-24.md). No ejecute deploys, cambios de entorno ni migraciones a partir de este archivo.

## Entorno y estado de publicación

- Base inicial obtenida por fetch: `phase2/full-platform`, `97fe6f3c9258c4336a9bd3e65d99694a2f1dbff5`.
- Rama aislada de este trabajo: `phase2/course-catalog-feedback`, conforme al último encargo.
- Única base usada: `phase2-full-platform-qa` / `bymeopxkxapfizeeqeyb`.
- Sin cambios en main, beta, Production, DNS, custom domains o configuración Auth.
- Validación HTTP/browser de esta tarea: build Next de producción ejecutado localmente en `http://127.0.0.1:3005`, conectado a Supabase QA real. **No es un Preview remoto actualizado.**
- Preview nuevo: **BLOCKED_EXTERNAL**. La política de permisos rechazó trasladar credenciales QA existentes a las variables Vercel Preview de la nueva rama sin confirmación explícita del payload y destino. No se ejecutó ese cambio ni se publicará una rama que pueda heredar la DB compartida.
- Se solicitó confirmación sólo para reutilizar las credenciales existentes de `bymeopxkxapfizeeqeyb` en Preview de `phase2/course-catalog-feedback`; sin rotación, sin secretos por chat, sin Production.
- No se mezclan pruebas del Preview anterior con este build.

## Importación real

Se leyeron LEEME.md, CONTROL_CALIDAD.md y PENDIENTES.md del ZIP antes de importar. El archivo fuente permanece en almacenamiento local ignorado por Git; no se publica un dump cuya reutilización comercial está pendiente.

| Entidad | Cantidad verificada en QA |
| --- | ---: |
| Clubes distintos | 153 |
| Recorridos | 176 |
| Salidas | 769 |
| Tarjetas completas | 752 |
| Registros de hoyos por tee | 13,536 |
| Ratings independientes de 9 hoyos | 1,538 |
| Tarjetas PASS en la fuente | 731 |
| Diferencias de yardas conservadas | 21 |
| Salidas sin tarjeta | 17 |
| Categorías de rating confirmadas | 0 |
| Clubes geolocalizados | 9 |
| Clubes pendientes de ubicación | 144 |

Migración aditiva aplicada sólo a QA: `20260920185147_course_catalog_feedback.sql`. Nombre/version local alineado con el ledger real del servidor; no volver a aplicar.

Importación inicial: 176 insertados. Repetición: 176 sin cambios, 0 nuevos. La operación transaccional por recorrido usa un lock, IDs fuente, hash de contenido y detección de conflictos; no sobreescribe datos de otro proveedor ni corrige divergencias a ciegas. La actualización de coordenadas es independiente e idempotente, sin modificar el hash ni las tarjetas.

Se conservaron alias/correspondencias, metadata original, origen, fecha de consulta, yardas/par/SI por tee y ratings front/back. Categoría NULL sigue NULL. El API de revisión requiere sesión, entorno Preview y ref QA; los registros importados son PRIVATE, no un catálogo público licenciado.

Reejecución con credenciales obtenidas por un canal seguro, nunca incluidas en Git:

```sh
node scripts/import-owner-course-catalog.mjs /ruta/privada/base_campos.json
# Tras comprobar dry-run y QA_CONFIRM_ISOLATED_PREVIEW=bymeopxkxapfizeeqeyb:
node scripts/import-owner-course-catalog.mjs /ruta/privada/base_campos.json --apply
node scripts/update-reviewed-course-locations.mjs --apply
```

## Búsqueda, ubicación y tarjetas

- Catálogo completo autenticado; búsqueda en nombre/alias/localidad, sin acentos ni distinción de mayúsculas.
- Geolocalización sólo tras acción explícita; coordenadas del usuario no se envían ni persisten. Distancia Haversine aproximada, no de manejo. Tres clubes distintos, no tres recorridos del mismo club.
- Rechazo, timeout y ausencia de ubicación conservan búsqueda manual.
- Club → recorrido → tee, conectado a configuración completa, score-only y total-score existentes.
- 9/18 hoyos y vuelta utilizan los controles existentes. Ratings de nueve independientes, sin dividir el de 18; SI original 1–18 conservado.
- Categorías desconocidas: rating informado sólo como evidencia, sin aplicación automática. Declaración manual explícita de Rating/Slope de 18, categoría y fuente por jugador. No verifica el catálogo ni habilita GHIN/Index oficial.
- Se congelan tarjetas por jugador, incluidos par/yardas/SI y evidencia de rating. El game screen, cálculos determinísticos, estadísticas e histórico leen ese snapshot. Las fórmulas no se reescribieron; cambia la entrada al SI/par del tee correspondiente.
- Las 17 salidas incompletas se muestran sin inventar hoyos, deshabilitadas para iniciar con esa tarjeta. Sigue disponible la captura manual existente.
- Una actualización futura del catálogo no cambia las tarjetas ya congeladas.

## Coordenadas documentadas

Fecha de comprobación: 2026-09-20. No se usaron centroides de ciudades.
Evidencia exacta en `data/course-verified-locations.json` y `data/course-additional-locations.json`.

| Club | Fuente |
| --- | --- |
| Campestre de Puebla | [Sitio oficial, marcador del mapa](https://clubcampestrepuebla.com/index.php/informes/contacto) |
| La Vista | [FullGolf](https://fullgolf.com/en/golf-club/mexico/puebla/san-andres-cholula/vista-country-club) |
| El Cristo | [18hole.golf](https://18hole.golf/course/club-campestre-el-cristo-atlixco-pue) |
| La Huerta | [OSM vía Mapcarta, way 151530906](https://mapcarta.com/34499184) |
| Las Fuentes | [OSM vía Mapcarta, way 35074426](https://mapcarta.com/34500072) |
| Golf México | [Where2Golf](https://www.where2golf.com/mexico/club-de-golf-mexico/) |
| Guadalajara Country Club | [Where2Golf](https://www.where2golf.com/mexico/guadalajara-country-club/) |
| El Río | [Where2Golf](https://www.where2golf.com/mexico/el-rio-country-club/) |
| Chapultepec | [Where2Golf](https://www.where2golf.com/mexico/club-de-golf-chapultepec/) |

OSM: © OpenStreetMap contributors / ODbL, atribución visible. No se presenta una fuente secundaria como sitio oficial. Puebla: 5 de 7 clubes con ubicación documentada. Cola de Lagarto y Vista Verde siguen pendientes; no se aprobó una coordenada por aproximación. No se declara geolocalización nacional completa.

## Feedback

- Inicio, Perfil/Más y solicitudes contextuales campo/bastón/bola/varilla.
- Formulario con categorías, validación, email de respuesta editable, campos condicionales y protección de texto no enviado. X y Cancelar.
- Destinatario fijo: `contacto@thebackyard.com.mx`. Reply-To del usuario. Remitente/clave sólo en servidor.
- Reutiliza Resend transaccional mediante `FEEDBACK_RESEND_API_KEY` + `FEEDBACK_FROM_EMAIL`, o los existentes `GROUP_INVITES_RESEND_API_KEY` + `GROUP_INVITES_FROM_EMAIL`. Nunca usa credenciales SMTP de Auth.
- Registro DB con UUID, propietario, payload, fechas, estado, límite 10/día, lease e idempotencia por petición. Aceptación del proveedor no equivale a recepción.
- `mailtoOnly` registra una copia pero **nunca llama al proveedor**, aunque esté configurado.
- En el entorno probado no hay mailer transaccional disponible: **BLOCKED_EXTERNAL** para envío desde servidor. `Abrir correo` prepara destinatario/asunto/cuerpo y no dice «enviado».
- **Correos de prueba enviados: 0.** Recepción/delivery no comprobados ni autorizados. No se exige esa autorización para usar el fallback.
- Vercel no permite leer variables sensibles existentes para copiarlas. Si se desea envío en esta nueva rama, el owner debe configurar el par de variables transaccionales en Preview de esta rama mediante Vercel, nunca por chat. No modificar Auth SMTP.

## Evidencia ejecutada

| Comprobación | Resultado / alcance |
| --- | --- |
| Tests completos | 2,059 PASS / 0 FAIL / 0 skipped |
| TypeScript noEmit | PASS |
| ESLint | PASS |
| Next production build | PASS con ref QA |
| Importar dos veces | PASS real DB: 176 insertados y después 176 unchanged |
| API autenticado | PASS real HTTP local→QA: 176 recorridos, Campestre 5 tarjetas; sin sesión 401, ID inválido 404 |
| RLS | PASS real A/B: B no lee/modifica feedback A; usuario no ejecuta import/claim; catálogo privado no accesible directamente |
| Feedback persistencia | PASS real API/DB, modo mailtoOnly dos veces produce un registro y provider_message_id NULL; nueva sesión lee el registro |
| Ubicación rechazada | PASS browser automatizado: rechazo real del contexto, búsqueda sigue usable |
| Ubicación permitida | PASS con coordenadas **simuladas** 19.02/-98.25: La Vista 1.4 km, Campestre 1.8 km, Las Fuentes 7.8 km |
| Campestre / La Vista | PASS browser: 5/5 y 4/4 tarjetas reales cargadas |
| 9H segunda vuelta | PASS browser: Blancas H10–18, rating 35.4 / slope 135 informado sin aplicación automática |
| Tee por jugador | PASS browser/cloud: Blancas y Doradas conservados tras guardar/reload |
| Captura real | PASS browser+QA: ronda sintética iniciada, score 4 para ambos en H10, guardado, avance H11 |
| Tarjeta individual | PASS browser: H10 Blancas 436 yd/SI4; Doradas 390 yd/SI3 |
| Snapshot cloud | PASS DB: dos tarjetas de 18 hoyos congeladas, ronda de 9 hoyos salida10, scores guardados |
| Históricos inmutables | PASS regresión determinística, edición del objeto fuente no muta snapshot serializado |
| Mobile 390/430 | PASS automatizado: ancho documento coincide con viewport; feedback cancelable y texto conservado |
| Cliente | Sin errores JS observados durante este recorrido |
| Safari/iPhone físico, teclado/PWA | PENDING_DEVICE_QA |
| Preview final remoto | BLOCKED_EXTERNAL; falta autorización de conexión específica, no se afirma desplegado |
| Reutilización comercial/categorías | LEGAL_REVIEW_REQUIRED / categorías aún por confirmar |

Logs privados, sin versionar credenciales: `.qa-artifacts/catalog-full-tests.log`, `catalog-lint.log`, `catalog-typecheck.log`, `catalog-build-qa.log`, `catalog-real-qa.log`.
Capturas: `screenshot-1789933699012.png` (feedback390), `screenshot-1789933654823.png` (cierre430), `screenshot-1789934006239.png` (LaVista), `screenshot-1789934383025.png` (captura430), en la carpeta temporal de agent-browser.
No se afirma GPS físico, teclado nativo, envío/recepción de email ni E2E remoto final.

## Clubes pendientes de ubicación (144)

- ALQUERIAS DE POZOS
- ALTOZANO EL NUEVO COLIMA
- ASOCIACION DEPORTIVA TULA
- AZUL TALAVERA COUNTRY CLUB
- Baja Country Club
- Bajamar Oceanfront Golf Resort
- BELLAVISTA GOLF & COUNTRY CLUB
- BOSQUE REAL COUNTRY CLUB CAMPO EJECUTIVO
- BOSQUES CLUB DE GOLF
- Cabo del Sol
- Cabo Real Golf Course
- Cabo San Lucas Country Club
- CAMPECHE COUNTRY CLUB
- CAMPESTRE TORREON
- CAMPO DE GOLF NAVAL
- CAMPO DE GOLF ZIBATA
- CANCUN GOLF CLUB AT POK TA POK
- CCC COUNTRY CLUB PLAYA PALMAS
- CENTRO ASTURIANO DE MEXICO
- Chileno Bay
- CLUB CAMPESTRE COATZACOALCOS
- CLUB CAMPESTRE CORDOBES
- CLUB CAMPESTRE DE AGUASCALIENTES
- CLUB CAMPESTRE DE CHIHUAHUA
- CLUB CAMPESTRE DE DURANGO
- CLUB CAMPESTRE DE LA CIUDAD DE MEXICO
- CLUB CAMPESTRE DE LEON
- Club Campestre de Mexicali
- CLUB CAMPESTRE DE MORELIA
- CLUB CAMPESTRE DE NUEVO LAREDO
- CLUB CAMPESTRE DE QUERETARO
- CLUB CAMPESTRE DE REYNOSA
- CLUB CAMPESTRE DE SALTILLO
- CLUB CAMPESTRE DE SAN LUIS
- CLUB CAMPESTRE DE TIJUANA
- CLUB CAMPESTRE EL COPAL
- CLUB CAMPESTRE ERANDENI
- CLUB CAMPESTRE IZAR
- CLUB CAMPESTRE JUAREZ
- CLUB CAMPESTRE LOMAS DE COCOYOC
- CLUB CAMPESTRE LOURDES
- CLUB CAMPESTRE MONTERREY
- CLUB CAMPESTRE REAL DEL CATORCE
- CLUB CAMPESTRE RIAMA
- Club Campestre San Jose del Cabo
- CLUB CAMPESTRE TAMPICO
- CLUB CAMPESTRE TUXTLA
- CLUB CAMPESTRE VICTORIA
- CLUB DE GOLF ACAPULCO
- CLUB DE GOLF ALTOZANO EL NUEVO TABASCO
- CLUB DE GOLF AVANDARO
- CLUB DE GOLF BALVANERA
- CLUB DE GOLF CAÑADA DE SANTA FE
- CLUB DE GOLF DE CUERNAVACA
- CLUB DE GOLF EL SOCORRO
- CLUB DE GOLF LA HACIENDA
- CLUB DE GOLF LA HACIENDA DE LEON
- CLUB DE GOLF LA PRIMAVERA
- CLUB DE GOLF LA VILLA RICA
- CLUB DE GOLF LAGUNAS DE MIRALTA
- CLUB DE GOLF LAS CRUCES
- CLUB DE GOLF LOS NARANJOS
- CLUB DE GOLF LOS TABACHINES
- CLUB DE GOLF MALANQUIN
- CLUB DE GOLF MALINALCO
- CLUB DE GOLF PACHUCA
- CLUB DE GOLF PULGAS PANDAS
- CLUB DE GOLF PUNTA MITA
- CLUB DE GOLF SAN CARLOS
- CLUB DE GOLF SAN GIL
- CLUB DE GOLF SANFORD
- CLUB DE GOLF SANTA ANITA
- CLUB DE GOLF TRES MARIAS
- CLUB DE GOLF VALLE ALTO
- CLUB DE GOLF VALLE IMPERIAL
- CLUB DE GOLF VISTA HERMOSA
- CLUB DE GOLF YUCATAN
- COLA DE LAGARTO CAMPO MÍTICO
- Costa Palmas Golf Club
- COUNTRY CLUB DE CHAPALA
- COUNTRY CLUB DE CULIACAN
- Country Club de Los Mochis
- COUNTRY CLUB MANTE
- COZUMEL COUNTRY CLUB
- DANZANTE BAY GOLF CLUB
- Diamante Cabo San Lucas
- EL BOSQUE COUNTRY CLUB DE GRAN JARDIN
- EL CAMALEON MAYAKOBA
- El Cid Golf & CC
- EL CIELO COUNTRY CLUB
- EL CORTES GOLF CLUB
- El Dorado Golf & Beach Club
- EL MOLINO GOLF CLUB
- Estrella Del Mar Golf Club
- GOLF BOSQUE MONARCA
- GOLF JURIQUILLA
- GRAN COYOTE GOLF
- GRAN RESERVA GOLF RESORT & COUNTRY CLUB
- HACIENDA CANTALAGUA COUNTRY CLUB
- HIGUERA GOLF CLUB
- IBEROSTAR CANCUN GOLF CLUB
- LA ESMERALDA COUNTRY CLUB
- LAS CAÑADAS COUNTRY CLUB
- Las Caras de Mexico
- LAS PAROTAS CLUB DE GOLF
- Links at Las Palomas, The
- LOMAS COUNTRY CLUB
- Loreto Bay Golf Resort and Spa
- MARINA VALLARTA CLUB DE GOLF
- MOON PALACE CANCÚN
- NAUKA GOLF CLUB
- Oleada Golf Links Los Cabos
- PALMA REAL GOLF & BEACH CLUB
- Palmilla Golf Club
- PARADISE VILLAGE COUNTRY CLUB
- PARAISO DEL MAR GOLF CLUB
- PGA RIVIERA MAYA BY BAHIA PRINCIPE GOLF
- PLAYA MUJERES GOLF CLUB
- PRINCESS MUNDO IMPERIAL GOLF CLUB
- PROVINCIA GOLF CLUB
- PUERTO CANCUN GOLF CLUB
- Puerto Los Cabos Golf Club
- Punta Brava Golf & Surf Club
- PUNTA TIBURON COUNTRY CLUB
- Querencia
- Quivira Golf Club
- RANCHO AVANDARO COUNTRY CLUB
- Real Del Mar Golf Resort
- RIO GRANDE COUNTRY CLUB
- RIVIERA CANCUN GOLF CLUB
- SAN FRANCISCO COUNTRY CLUB
- SANTA FE SOCIAL GOLF CLUB
- SANTA GERTRUDIS CLUB DE GOLF
- Solmar Golf Links
- TAJIN CLUB DE GOLF
- THE SPRINGS GOLF CLUB
- TURTLE DUNES COUNTRY CLUB
- Twin Dolphin Club
- VIDANTA GOLF ACAPULCO
- Vidanta Golf Los Cabos
- Vidanta Golf Puerto Penasco
- VISTA VERDE COUNTRY CLUB
- YUCATAN COUNTRY CLUB
- ZIRANDARO GOLF CLUB

## Pendientes concretos

1. Confirmar reutilización de credenciales QA existentes **sólo** en Vercel Preview de `phase2/course-catalog-feedback`; después push y deployment inmutable, repetir smoke remoto. No se necesitan secretos por chat.
2. Mailer transaccional de esta rama opcional para envío servidor; fallback mailto ya implementado. No probar envío sin autorización específica.
3. Completar fuentes de coordenadas restantes y verificar categorías de rating con autoridad de datos. No bloquear búsqueda manual.
4. Revisar derechos comerciales y condiciones de las fuentes antes de publicación pública.
5. QA físico Safari/iPhone/PWA, permisos GPS y app de correo por owner.

