# Recuperación y revisión funcional — 2 septiembre 2026

## Alcance y evidencia

Trabajo secuencial, sin agentes paralelos. Se retomó el estado local conservado después del corte de luz, sin reset, checkout destructivo, eliminación de cambios ni reimplementación de módulos sanos.

Las comprobaciones combinan pruebas automatizadas, lectura dirigida y uso real del navegador en localhost. No se presentan los tests de código fuente/mocks como pruebas contra servicios reales. La sesión funcional utilizó el origen aislado `http://localhost:3001` para no alterar los datos del usuario en `http://localhost:3000`.

Validación final ejecutada: `npm run lint`, `npm test`, `npm run build`. Resultado: **221 tests aprobados, 0 fallidos, 0 omitidos; lint y build correctos**. Next.js 16.3.4 generó las 17 páginas estáticas y las rutas dinámicas sin errores de TypeScript.

## Reporte solicitado (46 puntos)

1. **Punto de interrupción:** había trabajo local de infraestructura, Reglas y revisión funcional de Foursome/Par/recarga, con fixtures y tests, todavía sin respaldar en una rama de desarrollo. No se dio por terminado ningún proceso interrumpido: se volvieron a ejecutar las validaciones.
2. **Trabajo recuperado:** 59 archivos modificados/nuevos coherentes, incluidos APIs, componentes, migración SQL, documentación y pruebas. El respaldo inicial pasó 210 tests, lint y build.
3. **Pérdidas:** no se detectó pérdida de archivos guardados ni commits. No es posible demostrar si existía algún buffer del editor aún sin guardar al apagarse el equipo. No se descartó ningún cambio recuperado.
4. **Rama:** `codex-dev`, creada desde el estado recuperado porque no existía localmente ni en origin.
5. **Remoto:** seguimiento `origin/codex-dev`; cada bloque estable se envió exclusivamente a esa rama. La verificación final del SHA remoto se entrega en el mensaje de cierre.
6. **Commits:** `2f03de7` — recuperación después de interrupción; `47fc664` — histórico personal con snapshots inmutables; cierre de cobertura/persistencia y este reporte en el commit final.
7. **SHA final:** se informa en el mensaje de cierre, después de crear y comprobar el último commit. `git rev-parse HEAD` identifica exactamente el cierre de esta rama.
8. **main:** permanece en `09de83f69ad80116fda83abb4abd1e0a08660ef1`. No se hizo merge ni push a main.
9. **Producción:** no se solicitó ningún deployment de producción, tag, cambio de configuración, DNS, Cloudflare o dominio. La producción comprobada correspondía al mismo commit `09de83f`.
10. **Preview:** Vercel crea automáticamente previews de `codex-dev`. La beta estable de revisión es `https://beta.thebackyard.com.mx`. La URL inmutable y el estado del último preview se verifican al cerrar.
11. **Bugs encontrados:** Par podía no materializarse para todos los jugadores; efectos de saneamiento/regeneración podían vaciar participantes durante la hidratación; Cómo Vamos omitía dinero provisional de Foursome/Personales; Foursome Live no exponía claramente cada match; el histórico personal agrupaba por IDs locales de cada ronda, contaba varias apuestas como varias rondas y no congelaba el HCP del rival externo.
12. **Correcciones:** inicialización real de Par sin sobrescribir capturas; guardas de hidratación; balances provisionales separados del settlement; detalle Live/Resultados por match; agrupación histórica estable, conteo por ronda, filtros/orden y snapshots de nombre/HCP/configuración/resultado. Al seleccionar un rival nuevo se limpia el HCP de la plantilla anterior.
13. **Foursome:** pasan las regresiones de rebasing con los cuatro jugadores del match, porcentaje HCP, SI, Low/High, rango -2 a +2, fijo/puntos/combinación, segmentos 3/6/9/18, presión física H1–9/H10–18 y Fantasma. Se conservó la economía existente; no se sustituyeron fórmulas por intuición.
14. **Excel real:** NO se pudo hacer validación 1:1. No apareció el Excel original ni una extracción verificable de sus fórmulas en los archivos revisados.
15. **Excel necesario:** libro original `.xlsx`/`.xlsm` de apuestas; hoja(s) de Foursome y celdas de fórmulas de rebasing, porcentaje/redondeo HCP, golpes por SI, Low/High, fijo/patada, segmentos y presión que cruza H9/H10; reglas/celdas del Fantasma; tarjeta gross original de los 18 hoyos de Said, Cuau, Armando, Jesús y Raúl. No se conoce el nombre real de las hojas y no se inventa. El fixture histórico reproduce los nueve resultados proporcionados, pero no es la tarjeta original del Excel.
16. **Foursome Live:** muestra ambas parejas, resultado del hoyo, acumulado, ganador y dinero provisional. Comprobado cambiando un score sin guardar. En H10 con tres jugadores, Carlos 4 frente a Said/Jorge 5 produjo -2 puntos para la pareja, -$200 para cada integrante y +$400 para Carlos/Fantasma; al terminar H10–18 se mantuvo ese settlement.
17. **Par real:** confirmado en estado, tests y UI sin tocar +/-; cada hoyo abierto inicializa únicamente valores faltantes. La fixture H1–18 comprueba Par, captura posterior y recarga en cada hoyo.
18. **Presión:** UI con Sin presión/2x/3x/4x/5x y selección física H1–9/H10–18; sin opción visible 1x. Compatibilidad con datos anteriores mantenida.
19. **Conejos:** se conserva la máquina Libre/Agarra/Mantiene/Gana y su acumulación cada tres hoyos; regresiones y actualización real de UI correctas.
20. **Skins:** HCP, carry y desempates pasan; carry final no cobrado no se cuenta como ganado. La UI reaccionó al birdie sin guardar.
21. **Unidades:** Birdie +1, Eagle +2, Albatros/HIO +3 sin sumar dos veces; especiales/copas y Undo conservados, con regresiones existentes aprobadas.
22. **Bola Amiga:** se conservaron parejas, HCP, cap, número bajo/alto e inversión por gross bajo Par. Participa en la fixture integral junto con los demás motores.
23. **Pollas:** componentes independientes, selección física de vueltas, ronda de nueve desde H10 y Mini Polla sobre los últimos tres hoyos efectivamente jugados pasan los tests.
24. **Personales:** Match/Medal y presión conservados, provisional auditable, vuelta relevante más total. Golpes recibidos admite escribir, borrar y dejar vacío; vacío se interpreta como Sin ventaja.
25. **Histórico por rival:** balance desde el jugador principal; rondas/ganadas/perdidas/empatadas, fecha reciente, detalle Match/Medal/configuración, filtros total/año/mes y orden. Varias apuestas de una misma ronda cuentan una ronda. Borrar recalcula todo; editar plantillas no cambia snapshots antiguos. Datos antiguos sin HCP/configuración se indican como no registrados, no se inventan.
26. **Grupos guardados:** ya funcionaban; se comprobó desde Home → Armar grupos el menú de editar/eliminar, renombrar, editar HCP, quitar integrante, cancelar borrado y confirmar. No se rehízo. La ronda activa y los jugadores frecuentes se conservaron.
27. **Duplicados:** trim y mayúsculas/minúsculas comprobados en tests y UI; ` PRUEBA 1 ` fue rechazado al existir `Prueba 1`, sin aumentar los diez integrantes.
28. **Armar grupos:** stress de 3–20 jugadores con objetivos 3/4/5 en ambos modos, sin pérdidas/duplicados/grupos inválidos. En UI, diez jugadores y objetivo cinco dieron exactamente 5+5, con HCP promedio 5.6 y 5.4; se probaron resorteo, intercambio, guardado y Jugar con este grupo.
29. **Manuales:** +500/-500 se capturan sin cero precargado y cierran en cero. Importes desequilibrados no entran al settlement válido.
30. **Cómo Vamos:** usa el score actual y agrega provisionales de Foursome/Personales. No liquida Pollas incompletas antes de tiempo. Se verificó el desglose y la suma cero en UI y fixture.
31. **Resultados:** cantidades y dinero, valores de apuesta, detalle fijo/puntos de Foursome, Personales, manuales y gastos conservados. Los motores de transferencia cierran en cero; los gastos son egresos, no transferencias entre jugadores.
32. **Histórico:** guardar/abrir/cancelar borrado/borrar/recargar comprobados. Borrar un personal de +$400 dejó Personales en cero y cambió el total histórico del principal de -$700 a -$1,100, sin alterar Conejos/Skins/Unidades ni borrar al rival.
33. **Reglas:** 25 reglas, acordeones/subreglas, búsqueda por palabra/número/acentos/sinónimos, Aclaraciones, Comité, fuentes oficiales y regreso seguro comprobados con UI/tests. La Vista/La Vista Temporal solamente muestran sus reglas locales, de solo lectura. Código de Caballeros separado; playlist conservada. IA no se llama automáticamente al buscar. Dictado probado por detección/mocks, no por voz en un iPhone físico; no se realizó consulta IA de pago ni reindexación.
34. **Persistencia:** recarga real conservó ronda, scores, participantes y configuración; guardado/borrado de históricos y grupos persistió. Fixture serializa y restaura todos los motores cada uno de los 18 hoyos. No se borraron datos del origen del usuario.
35. **Mobile:** revisión real de DOM/capturas en 390x844, 430x932 y desktop; fecha, tarjetas, modales, formularios, tablas desplazables y navegación. Falta validación en iPhone físico de teclado, safe areas nativas, micrófono, Web Share y regreso OAuth/PWA. La emulación no sustituye esa prueba.
36. **Auth/Supabase local:** Invitado y datos locales funcionan; infraestructura recuperada compila. OTP/OAuth, restauración y logout tienen mocks; no se presentaron como logins reales. No se crearon proyectos ni credenciales externas.
37. **Polla Live local:** infraestructura, cola offline, conflictos, autorización lógica y fixture de 60 jugadores pasan. Sin pruebas multiusuario reales ni aplicación de migraciones a Supabase durante esta revisión.
38. **Ronda completa:** fixture simultánea Conejos/Skins/Unidades/Foursome/Bola Amiga/Polla/Mini Polla/Personales, H1–18, Live/Cómo Vamos/settlement y JSON-reload por hoyo. Sin pérdida de scores; sumas cero; Live y settlement coinciden al terminar.
39. **Total tests:** 221.
40. **Aprobados:** 221; cero fallidos, cancelados u omitidos. La suite incluye unidades, contratos de código fuente y mocks; no son 221 pruebas de navegador.
41. **Lint:** `npm run lint` correcto, exit 0.
42. **Build:** `npm run build` correcto, exit 0; TypeScript correcto.
43. **Archivos:** inventario completo al final. La recuperación preservó 59; el nuevo bloque personal modifica siete; el cierre agrega una prueba integral, este reporte y conserva los tipos generados por `next dev`.
44. **Pendientes reales:** Excel original para contraste exacto; iPhone físico/PWA; validación externa de cuentas/nube/multiusuario. No se conoce un fallo local pendiente reproducible al cierre; no equivale a garantizar ausencia absoluta de bugs.
45. **Configuración externa:** proyecto Supabase correcto, llaves en entorno servidor, migraciones en orden, RLS/Storage/Realtime probados con cuentas reales; Email OTP/SMTP/plantilla; Google/Apple providers y redirects permitidos, incluido el preview si se probará OAuth allí. Instrucciones en `docs/SETUP_SUPABASE.md`, `SETUP_AUTH.md`, `SETUP_EMAIL_OTP.md`, `SETUP_GOOGLE_AUTH.md`, `SETUP_APPLE_AUTH.md`, `POLLA_LIVE.md`. No se cambió ninguna configuración externa.
46. **Seguridad:** los pushes se comprobaron por rutas y patrones de secretos sin imprimir valores. `.env.local`, `rules-source/` y `brand-source/` siguen ignorados; sin PDFs fuente, Excel original, claves privadas, tokens reales ni credenciales añadidos a los commits. `.env.example` contiene solamente nombres/valores de ejemplo no secretos.

## Caso histórico de Foursome

La fixture conserva exactamente +1/-1/+2, -2/+2/+1 y -1/-2/-3 para los nueve matches indicados. No debe confundirse esta regresión con la extracción de un Excel que no está disponible.

| Jugador | Fijo $200 | Fijo $200 + $100/punto | Solo $100/punto |
|---|---:|---:|---:|
| Cuau | +800 | +1400 | +600 |
| Armando | +600 | +1100 | +500 |
| Raúl | +400 | +900 | +500 |
| Said | -400 | -800 | -400 |
| Jesús | -1400 | -2600 | -1200 |

## Cobertura de fases

Revisadas 0, 0.1, 0.2, 0.3 y 1–44. Trabajo local ejecutable completado. Límites explícitos: fase 5 (Excel), 29/35 (voz e iPhone/PWA reales), 36/37 (proveedores externos y multiusuario). La fase 44 se completa con el SHA y la verificación remota del mensaje de cierre.

## Inventario respecto a main

`M` = modificado; `A` = nuevo. Incluye trabajo recuperado, no afirma que todo se escribiera después del apagado.

```text
M .env.example
M .gitignore
M next-env.d.ts
M app/api/cloud/rounds/route.ts
A app/api/cloud/sync/route.ts
A app/api/features/route.ts
A app/api/polla/admin/[tournamentId]/route.ts
M app/api/polla/group/route.ts
M app/api/polla/invite/[publicId]/route.ts
M app/api/polla/join/route.ts
M app/api/polla/leaderboard/[publicId]/route.ts
A app/api/polla/oyes/route.ts
M app/api/polla/scores/route.ts
M app/api/polla/tournaments/route.ts
M app/api/rules/search/route.ts
M app/components/account-panel.tsx
M app/components/account-provider.tsx
A app/components/personal-history-panel.tsx
M app/components/polla-live-panel.tsx
M app/components/rules-panel.tsx
M app/globals.css
M app/page.tsx
A app/polla/[code]/page.tsx
M docs/POLLA_LIVE.md
A docs/QA_RECOVERY_CODEX_DEV.md
A docs/SETUP_APPLE_AUTH.md
M docs/SETUP_AUTH.md
A docs/SETUP_EMAIL_OTP.md
A docs/SETUP_GOOGLE_AUTH.md
M docs/SETUP_SUPABASE.md
M lib/account-state.ts
A lib/auth-flow.ts
A lib/cloud-sync.ts
M lib/engine.ts
A lib/feature-flags.ts
M lib/frequent-templates.ts
A lib/personal-history.ts
M lib/polla-live.ts
M lib/polla-offline.ts
A lib/polla-private-link.ts
M lib/round-utils.ts
A lib/rules-navigation.ts
A lib/rules-search-normalization.ts
M lib/rules-search.ts
M lib/scorecard-photo.ts
M lib/supabase/server.ts
M lib/types.ts
A supabase/migrations/202609020001_cloud_sync_polla_hardening.sql
A tests/auth-flow.test.ts
A tests/cloud-infrastructure.test.ts
A tests/cloud-sync.test.ts
M tests/engine.test.ts
A tests/fixtures/foursome-historical.ts
A tests/fixtures/full-round.ts
A tests/fixtures/polla-live-60.ts
A tests/full-round-persistence.test.ts
M tests/group-generator.test.ts
M tests/local-product-flows.test.ts
A tests/personal-history.test.ts
M tests/polla-live.test.ts
A tests/polla-offline.test.ts
A tests/polla-private-link.test.ts
M tests/product-major.test.ts
M tests/round-utils.test.ts
A tests/rules-navigation.test.ts
M tests/v3-closure.test.ts
```

`next-env.d.ts` es generado por Next.js: al dejar `npm run dev` activo usa `.next/dev/types/`; `next build` regenera las referencias de build. No se cambió su lógica manualmente.
