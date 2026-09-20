# Campos cercanos — seguimiento de QA, 20 septiembre 2026

## Entorno y límites

- Rama: `phase2/course-catalog-feedback`, repo `saidabaid-cyber/Golf-Bets`.
- HEAD inicial confirmado por fetch: `609c532c0c34bd428be6ad3eca1de568f9ae9d6c`.
- Aplicación corregida: `b851ec3a37f364e389d060c35145eb90c04f242e`.
- Preview probado: https://golf-bets-oht0ne1js-saha8.vercel.app — READY, metadata del mismo SHA.
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
