# Campos cercanos — seguimiento de QA, 20 septiembre 2026

> **Checkpoint histórico — no ejecutar sus comandos ni configurar sus ramas.** Este documento conserva evidencia de una ejecución anterior en `phase2/course-catalog-feedback`; esa rama y su Preview ya no son destinos operativos. La única activación vigente parte de `integration/backyard-current` y está definida en [PREVIEW_CONTROLLED_ACTIVATION.md](./PREVIEW_CONTROLLED_ACTIVATION.md), con `https://dev.thebackyard.com.mx` como única URL de QA para el owner.

## Entorno y límites

- Rama: `phase2/course-catalog-feedback`, repo `saidabaid-cyber/Golf-Bets`.
- HEAD inicial confirmado por fetch: `609c532c0c34bd428be6ad3eca1de568f9ae9d6c`.
- Aplicación corregida: `b851ec3a37f364e389d060c35145eb90c04f242e`.
- Preview probado: https://historical-preview-url-retired.invalid — READY, metadata del mismo SHA.
- Única DB consultada: `bymeopxkxapfizeeqeyb`. No se aplicaron migraciones ni cambios de datos en esta ejecución.
- La aplicación de 75 ubicaciones fue rechazada por el control de permisos debido a la autorización anterior que excluía cambios de DB. No se intentó por otra vía. Se solicitó autorización separada para 75 ubicaciones y seis tarjetas.
- No se modificaron main, beta, Production, secretos, dominios, motores de apuestas, fórmulas ni históricos. Cero correos enviados.

## Diagnóstico y corrección

No hubo iPhone físico disponible; no se atribuye una causa física definitiva sin reproducirla en el dispositivo.

El código anterior podía invalidar una solicitud GPS pendiente cuando cambiaba el token o se recargaba el catálogo: incrementaba el contador de geolocalización en el cleanup del fetch, pero dejaba `locating=true`. Además dependía exclusivamente del timeout nativo y no capturaba excepciones síncronas del navegador. El botón se deshabilitaba mientras cargaban los datos, sin explicar adecuadamente ese estado.

La solicitud GPS tiene ahora ciclo de vida independiente, cancelación al desmontar, timeout nativo de 10 s y límite de espera de 15 s para un callback que nunca llegue. Reintento, cancelación, permiso rechazado, navegador no compatible, error y éxito tienen estados visibles. Una recarga del catálogo recalcula resultados con el punto en memoria; no cancela GPS. No hay persistencia, logs ni envío de coordenadas del usuario.

## Evidencia ejecutada

| Función | Estado | Evidencia / alcance exacto |
|---|---|---|
| Ubicación aceptada | PASS | Callback GPS simulado en navegador real Chromium, Preview autenticado, 390 px: La Vista 1.4 km, Campestre de Puebla 1.8 km, Las Fuentes 7.8 km. Datos de clubes obtenidos de QA, no fixtures de tarjetas. |
| Permiso rechazado | PASS | Error nativo simulado código 1; Reintentar y búsqueda disponibles. |
| Timeout sin callback | PASS | Espera real de 15 s en Preview a 430 px; salió de loading, mostró error y Reintentar. |
| Búsqueda manual | PASS | API autenticada; México/Mexico: 19 resultados cada uno. Sin coincidencias: 0. Campestre Puebla visible tras timeout. |
| Recorrido / tee | PASS | La Vista: cuatro tees reales; selección Azules 7,122 yd. Campestre Puebla: cinco tarjetas por API y recorrido cargado en browser. |
| Score-only | PENDING_CONTROLLED_DB_APPLY | UI hasta revisión: La Vista, Azules, 9H, salida H10. No se afirma creación/persistencia cloud: escrituras bloqueadas deliberadamente. |
| Ronda completa, total, grupo, tee por jugador | PENDING_CONTROLLED_DB_APPLY | Suite de regresión verde; falta repetir guardado E2E con autorización de escrituras QA. No equivale a PASS cloud. |
| Snapshot histórico | PASS | Pruebas de clonación, JSON reload, cambios posteriores al catálogo, SI/par independiente por jugador; no hubo modificaciones a históricos. Nivel de evidencia: regresión determinística, no nuevo guardado cloud. |
| Feedback UI | PASS | 430 px: siete categorías, validación, mailto a contacto@thebackyard.com.mx, X/Cancelar, confirmación de descarte y texto conservado al seguir escribiendo. No se abrió ni envió correo. |
| Mailer servidor | BLOCKED_EXTERNAL | GET `/api/feedback`: `serverEmailAvailable:false`, `mailtoAvailable:true`. |
| Safari / PWA / teclado físico | PENDING_DEVICE_QA | Sólo Chromium automatizado 390/430; no se afirma prueba física. |
| Suite completa | PASS | `npm test`: 2,074/2,074; 0 FAIL, 0 skipped. Incluye catálogo, feedback, rondas, apuestas, handicap, grupos/social y snapshots. |
| TypeScript / ESLint / build | PASS | `tsc --noEmit`, `eslint .`, `next build`; Vercel READY. |
| Smoke remoto | PASS | `/` 200, catálogo autenticado 200, catálogo sin sesión 401, ID inexistente 404, feedback con ID inválido 400. Son negative paths deliberados. |
| Runtime | PASS | Consulta del deployment `dpl_6aqzTavG7GMcT6TVqKNsjyjmQkPD`: sin 5xx registrados durante este corrido; sin errores JS en consulta del navegador. |

El fixture sintético tenía un draft previo en la nube. La protección local contra escrituras ocasionó avisos de conflicto de sincronización durante edición; se restauró la copia cloud, sin alterarla. No se reporta ese efecto del harness como bug nuevo ni como persistencia validada.

Evidencias locales no secretas: `.qa-artifacts/nearby-390.png`, `.qa-artifacts/feedback-430.png`, `.qa-artifacts/catalog-geographic-qa.json`, `.qa-artifacts/catalog-final-npm-test.log`, `.qa-artifacts/catalog-final-build.log`. Archivos de sesión permanecen ignorados y no se publican.

## Datos: aplicado frente a preparado

Readback real SQL posterior al intento bloqueado: **153 clubes, 176 recorridos, 769 tees, 752 tarjetas completas, 1,538 ratings independientes de 9H, 9 clubes geolocalizados, 0 suplementos aplicados**.

Preparado, NO aplicado: **75 ubicaciones adicionales**, total potencial **84/153**, y **6 tarjetas**, total potencial **758/769**. Restan **69 ubicaciones sin verificar** y **11 tarjetas sin evidencia suficiente** después de esos cambios. Los 21 conflictos de yardaje originales se conservan; no se corrigen por deducción.

- `data/course-osm-locations.json`: 63 correspondencias revisadas manualmente por nombre y región. Consulta pública `leisure=golf_course` de México; ODbL / © OpenStreetMap contributors, URL y fecha por elemento.
- `data/course-location-followup.json`: 12 ubicaciones adicionales, fuente oficial cuando disponible, cartografía y fuentes de golf para las restantes.
- Puntos de áreas OSM: centro de la extensión del **campo cartografiado**, no centro de ciudad. Otros registros identifican explícitamente punto de salida o instalación del club. Distancia aproximada geográfica, nunca de manejo.
- Se mantienen pendientes las coincidencias ambiguas; por ejemplo, Vista Verde presenta fuentes discordantes y el sitio oficial no estuvo disponible; Cola de Lagarto no publicó coordenadas verificables en la página consultada.
- La reutilización comercial del catálogo y condiciones de licencias siguen `LEGAL_REVIEW_REQUIRED`. No existe integración GHIN/FMG ni se consultaron historiales personales.

### QA geográfico del conjunto preparado (local, NO demuestra publicación en DB)

Coordenadas de prueba, no de usuarios. Se comprobó orden de distancia y tres club IDs distintos para diez zonas.

| Origen simulado | Tres más cercanos entre los registros verificados preparados (km) |
|---|---|
| Puebla 19.02,-98.25 | La Vista 1.4; Campestre Puebla 1.8; Las Fuentes 7.8 |
| CDMX 19.4326,-99.1332 | Campestre Ciudad de México 9.1; El Copal 11.3; Chapultepec 11.7 |
| Monterrey 25.67,-100.31 | Campestre Monterrey 4.5; Valle Alto 12.2; Las Cruces 24.4 |
| Guadalajara 20.67,-103.35 | Guadalajara CC 4.3; Las Cañadas 12.8; El Cielo 15.8 |
| Querétaro 20.59,-100.39 | Campestre Querétaro 3.4; Zibatá 11.9; Juriquilla 15.0 |
| León 21.12,-101.68 | Campestre León 5.3; La Hacienda León 8.4; El Bosque 9.8 |
| Cancún 21.16,-86.83 | Puerto Cancún 2.1; Pok Ta Pok 7.7; Playa Mujeres 11.0 |
| Los Cabos 22.9,-109.91 | Cabo San Lucas CC 1.5; Quivira 5.5; Solmar 10.6 |
| Puerto Vallarta 20.65,-105.23 | Marina Vallarta 3.5; Paradise Village/El Tigre 7.6; Punta Mita 33.9 |
| Acapulco 16.81,-99.82 | Turtle Dunes 2.4; Vidanta 4.7; Santa Fe 221.8 — cobertura local incompleta, no presentar el tercero como vecino urbano |

### Las 17 salidas originales

“PASS” en esta tabla significa **fuente completa revisada**, NO aplicación a QA (las seis siguen `PENDING_CONTROLLED_DB_APPLY`).

| Club | Salida | Evidencia de tarjeta | Observación |
|---|---|---|---|
| Alquerías | Azules | PASS | Tarjeta oficial 2026: 18 posiciones explícitas, 2 vueltas de 9, par 54, 2,868 yd. |
| Alquerías | Blancas | PASS | Misma fuente, 2,578 yd. |
| Alquerías | Doradas | PASS | Misma fuente, 1,922 yd. |
| Alquerías | Azules / Blancas | PENDING_DATA | Sin identificación completa de salidas por hoyo; rating segunda vuelta 27.0 en PDF vs 27.3 en inventario. |
| Playa Mujeres | BLACK | PASS | PDF oficial, 7,218 yd, par 72, SI completo. |
| Playa Mujeres | GOLD | PASS | PDF oficial, 6,775 yd. |
| Playa Mujeres | COPPER | PASS | PDF oficial, 5,859 yd. |
| Playa Mujeres | SILVER | PENDING_DATA | El PDF deja vacío el yardaje del hoyo 6. No se infiere del total. |
| Las Parotas | Azules | PENDING_DATA | Sitio oficial 72.3/136 vs inventario 73.9/131; requiere resolver versión/correspondencia. |
| Las Parotas | Blancas | PENDING_DATA | Sitio oficial 69.7/131 vs inventario 71.3/129. No mezclar versiones. |
| Naval | Azules | PENDING_DATA | No se verificó tarjeta de 18 posiciones de esa salida. Fuente de la HENM describe campo físico de 9 hoyos. |
| Naval | Blancas | PENDING_DATA | Igual limitación, no duplicar una vuelta por suposición. |
| Naval | Doradas | PENDING_DATA | Igual limitación. |
| Real del Catorce | Blancas | PENDING_DATA | Fuentes secundarias discrepan en 9/18 hoyos; sin tarjeta completa vinculada inequívocamente. |
| Zirándaro | Amarillas | PENDING_DATA | Sitio oficial confirma campo físico de 9 hoyos par 3; falta tarjeta por salida/ventajas de dos vueltas. |
| Zirándaro | Azules | PENDING_DATA | Igual limitación. |
| Zirándaro | Blancas | PENDING_DATA | Igual limitación. |

Fuentes revisadas: [Alquerías PDF](https://alquerias.com.mx/documents/golf/tarjeta-alquerias-2026.pdf), [Playa Mujeres PDF](https://www.golfplayamujeres.com/assets/pdf/scorecard.pdf), [Las Parotas oficial](https://www.lasparotasgolf.com/), [HENM](https://henm.uninav.edu.mx/quienesSomos.html), [Zirándaro oficial](https://www.zirandaro.com.mx/campodegolf).

Alquerías documenta categoría **Caballeros** y ratings de nueve independientes para tres salidas, conservados como evidencia en el suplemento. La aplicación automática a jugadores sigue deshabilitada; no se inventa categoría a partir del color. Playa Mujeres no identifica categoría en su PDF. Los NULL originales no se transforman en universal/hombre/mujer. No se divide ningún rating de 18H.

## Aplicación pendiente, idempotencia y correo

1. Autorizar datos QA: 75 coordenadas + seis tarjetas documentadas. `scripts/update-reviewed-course-locations.mjs` valida el ref, rechaza conflictos, sólo rellena coordenadas NULL y hace no-op si ya coinciden. Dry run real: 75 por añadir, seis ubicaciones existentes iguales. Ejecutar `--apply` sólo después de aprobación.
2. `node scripts/reviewed-card-supplement-sql.mjs bymeopxkxapfizeeqeyb` emite transacción DML revisada para ESA DB. Rechaza tarjetas previas/conflictos rating/par, conserva `supplementOriginal`, versiona por hash y no modifica rondas. Ejecutar dos veces después de autorización y verificar que la segunda no cambia conteos. Esto está preparado/testeado localmente; idempotencia real DB pendiente.
3. Repetir QA cloud de creación/guardado con fixture sintético autorizado. No hay migraciones nuevas requeridas.
4. Vercel → proyecto `golf-bets` → Settings → Environment Variables → **Preview**, Git Branch **phase2/course-catalog-feedback**: añadir **FEEDBACK_RESEND_API_KEY** y **FEEDBACK_FROM_EMAIL**, con remitente verificado; redeploy Preview. No enviarlos por chat. También se soportan GROUP_INVITES_* si el owner los proporciona en ese scope. Las variables de la rama phase2/full-platform son Sensitive, no legibles/copiales por CLI; no se ampliaron a todas las ramas ni se usó SMTP Auth. [Restricción de Vercel](https://vercel.com/docs/environment-variables/sensitive-environment-variables).
5. Autorización específica de correo de prueba, si se desea verificar recepción; no está concedida en este corrido. Mailto y UI no demuestran entrega.

Este bloque **no está cerrado por completo**: el fix está publicado, pero faltan aprobación de datos QA, datos de fuente restantes, mailer y prueba física.

## Aplicación controlada autorizada — 20 septiembre 2026

Esta sección actualiza los bloqueos de DB de las secciones anteriores sin borrar su evidencia.

- Autorización explícita recibida: 75 ubicaciones, seis tarjetas, repetición idempotente y rondas sintéticas nuevas en QA. Ninguna migración, cambio de Auth/configuración/secretos, ni edición de históricos existentes.
- HEAD inicial local/remoto confirmado por fetch: `701c10e360104559bda88e78384598a91c07a92d`, rama `phase2/course-catalog-feedback`.
- Target comprobado programáticamente en los runners: `https://bymeopxkxapfizeeqeyb.supabase.co`. El bundle del Preview también se verifica antes de enviar credenciales.
- Primer script de ubicaciones: `updated:75, unchanged:6`. La repetición detectó dos diferencias de serialización float8 de menos de 0.000000000001 grados; se corrigió la comparación de no-op a los 15 dígitos significativos de la representación de la API. No se redondean ni reescriben coordenadas almacenadas. Tests rechazan ubicaciones distintas y valores inválidos.
- Segunda ejecución completa: `updated:0, unchanged:81`. No sobrescribe fuentes existentes ni modifica tarjetas.
- Transacción de tarjetas ejecutada dos veces: seis suplementos en ambas ejecuciones, 108 registros de hoyo y 108 pares tee/hoyo distintos. Sin duplicados; originales conservados en metadata. Alquerías Azules/Blancas/Doradas y Playa Mujeres Black/Gold/Copper, con sus fuentes oficiales ya documentadas arriba.

### Readback real

| Entidad | Antes | Después |
|---|---:|---:|
| Clubes | 153 | 153 |
| Recorridos | 176 | 176 |
| Tees | 769 | 769 |
| Clubes geolocalizados | 9 | 84 |
| Tarjetas completas | 752 | 758 |
| Tarjetas incompletas | 17 | 11 |

Los 79 registros `rounds_cloud` anteriores conservaron el fingerprint agregado `2207175243c7d2ff7832cd816e702d0f` después de ambos scripts. Después del QA API había 88 rondas: nueve nuevas y cero cambios en los fingerprints individuales de las 79 anteriores.

### QA cloud ejecutado

`scripts/qa-course-catalog-live.mjs --write-rounds` utiliza una cuenta sintética **existente**, sin crear usuarios Auth ni enviar correos. No modifica catálogo, perfiles ni preferencias. Crea únicamente nuevos IDs y conserva fixtures.

- Catálogo API autenticado: 176 recorridos / 153 clubes / 84 clubes geolocalizados. Tres clubes distintos ordenados por distancia local para Puebla, CDMX, Monterrey, Guadalajara, Querétaro, León, Cancún, Los Cabos, Puerto Vallarta y Acapulco. La tabla geográfica anterior ahora coincide con datos leídos de QA, sin superponer ubicaciones locales preparadas.
- México/Mexico: mismos IDs. La Vista: cuatro tarjetas; Campestre Puebla: cinco. Playa Mujeres y Alquerías: tres tarjetas completas y una incompleta cada uno. Rating ambiguo no aplicado automáticamente.
- Nueve rondas API: modos completo (sin apuestas), score-only y sólo total, cada uno en 9H H1, 9H H10 y 18H H1. POST real 201; reintento del mismo ID 409 sin duplicar. Readback con una nueva sesión autenticada por cada caso.
- Dos tees distintos por jugador en las seis rondas detalladas, con hoyos/SI/par/yardas/fuente/versiones congelados; comparación completa del snapshot. Modificar el objeto de catálogo en memoria no altera el snapshot persistido. Ninguna actualización artificial del catálogo ni de históricos para demostrarlo.
- Sólo total conserva `scores:{}`; no se fabrican scores por hoyo. Las rondas detalladas mantienen exactamente 9/18 hoyos y el orden seleccionado.
- Evidencia: `.qa-artifacts/catalog-applied-cloud-report.json` (sin credenciales). `--verify-created` repite readback sin crear rondas adicionales, para comprobar el Preview final.

### Alcance de UI y pendientes honestos

La cuenta sintética sin histórico elegida para el recorrido visual llegó a un checkpoint de términos obligatorio. El control de seguridad rechazó aceptar legalmente esos checks de forma automática; no se eludió. Los nueve casos anteriores demuestran persistencia real **API → DB → nueva sesión**, no nueve recorridos completos por clicks. El cierre completo desde UI queda `PENDING_INTERACTIVE_QA` para una cuenta con autorizaciones resueltas. La cuenta QA ya habilitada se utiliza para selección móvil de sólo lectura, sin alterar su histórico ni Auth.

Calidad: 2,075/2,075 tests, cero fallos/omitidos; TypeScript, ESLint y Next build correctos. Incluye regresión nueva del fallo real de idempotencia. Safari/iPhone/PWA/teclado físico sigue `PENDING_DEVICE_QA`.

Pendientes de datos: 69 clubes sin ubicación verificada y once tees incompletos (`PENDING_DATA`), con el listado anterior y `data/course-locations-pending.json`. Categorías ambiguas y conflictos originales no se corrigieron por suposición. Mailer sigue `BLOCKED_EXTERNAL`; no se tocaron secretos ni se enviaron correos. Reutilización comercial y aprobación jurídica siguen `LEGAL_REVIEW_REQUIRED`.

El Preview final se genera mediante el push de este cierre a la misma rama; su URL inmutable y SHA se entregan en el mensaje final, comprobados contra metadata Vercel. No se promueve a Production ni se cambian dominios.
