# Play y GPS integrado — 2026-10-09

Base comprobada de checkout, origin y DEV: `55f7d76abd1c6f8c8c7aab415a8cdf582e50a927`.
Destino único: `integration/backyard-current`, `https://dev.thebackyard.com.mx`.
Checkpoint recuperable y recibos privados conservados fuera del checkout.
Integración selectiva de archivos nuevos desde `codex/golfapi-controlled-ingestion@31ffc1c`; no sustitución de la aplicación.

## Correcciones de Play y persistencia

- Cancelar llamaba a `resetRound()`: recreaba el principal y el autosave proyectaba otro borrador. Ahora conserva la tarjeta parcial como cancelada, limpia el draft activo y permanece en Play.
- El servidor limpia `user_cloud_state.active_draft` únicamente si su `roundId` coincide con el cancelado. Se conserva CAS; otra ronda activa no se modifica.
- Una cancelación terminal impide resucitar su copia local/nube todavía live/draft. No prevalece sobre una tarjeta histórica finalizada ni compartida.
- Borrador: **Completar configuración**. Iniciada: **Continuar ronda**. Navegar entre hoyos por sí solo no inicia una ronda.
- Iniciar persiste un checkpoint con campo, jugadores, apuestas y hora de inicio antes de abrir score. Guardar y salir espera al checkpoint local.
- Rondas pendientes locales y de nube permiten continuar/ver/cerrar sin inventar resultados finales. Nueva ronda conserva la anterior.
- El selector muestra inmediatamente clubes guardados, búsqueda, recientes/favoritos y una acción explícita de ubicación. La consulta de permiso del navegador no solicita autorización; solo permiso vigente granted inicia ubicación automáticamente. Orden y distancias son locales, sin proveedor remoto de búsqueda.
- Modo sin apuestas reutiliza el principal real y los flujos existentes de compañeros/grupos. Motores, GHIN, índices y confirmación social no se modifican.

## GPS y datos privados

Entrada independiente: `/?screen=gps`; desde Play, **GPS / Hole Map**. En ronda, el botón GPS abre el mismo contexto campo/hoyo dentro de score, sin mutar ronda ni scores. Explorar otro hoyo GPS no cambia el de score.

Acceso conserva el permiso específico del piloto o el permiso existente courses; no se amplía a todos. Solo origin DEV y binding aislado. Lectura privada autenticada; ninguna llamada upstream durante GPS, tests o build.

| Campo | Posiciones de tarjeta | Hoyos físicos | Frente/centro/fondo | Tees geográficos | Otros puntos |
|---|---:|---:|---:|---:|---:|
| La Vista | 18 | 18 | 54 | 0 | 0 |
| Campestre de Puebla | 18 | 18 | 54 | 36 | 1 |
| Las Fuentes | 18 | 9 | 54 | 18 | 0 |
| El Cristo | 18 | 18 | 54 | 36 | 73 |
| Cola de Lagarto | sin datos GPS importados | no determinado por este import | 0 | 0 | 0 |

La Vista encuadra referencias de green: no hay un tee geográfico que permita afirmar mapa completo tee→green. Las Fuentes conserva ambos juegos de coordenadas de sus vueltas, sin promediar ni duplicar greens físicos; diferencias hasta 9.54 m pendientes de comprobación. El Cristo conserva un punto en cuarentena fuera del DTO jugador.

Frente/fondo son referencias fijas del proveedor, no extremos dinámicos. Centro no es bandera. Precisión y fecha de medición de los datos no demostradas; fecha de actualización del registro no equivale a fecha de captura. Validación física: **PENDING_DEVICE_QA**.

## Persistencia aplicada y aislamiento

DEV usa `bymeopxkxapfizeeqeyb`, rama Supabase no predeterminada `phase2-full-platform-qa`. Padre protegido `zhqmlpljloumldaczcfp` sin datos operados. Binding de variables Preview exclusivo de `integration/backyard-current`, sin cambios a Production, beta ni main.

Migración aplicada `20261009181746_golfapi_private_saved_gps_cache.sql`: dos tablas privadas append-only con RLS y tres RPC SECURITY INVOKER para service_role. anon/authenticated sin acceso. Diez respuestas completas y cuatro snapshots normalizados importados, con hashes verificados en PostgreSQL. Segunda importación idempotente: siguen 10/4. Baseline, recibo y reversión selectiva guardados privados; reversión no ejecutada.

No se modificaron catálogo, tarjetas, perfiles, datos de El Mongas ni rondas compartidas mediante la importación.

Variables existentes/configuradas para DEV: `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `GOLF_GPS_ENABLED`, `GOLF_GPS_MAPS_ENABLED`, `GPS_LA_VISTA_1_PILOT_USER_IDS`. Valores y payloads privados excluidos del repositorio.

## Pruebas antes de publicación

- Suite TypeScript: **4786/4786 PASS**, cero omitidas.
- Scripts de regresión de aplicación: **117/117 PASS**.
- Persistencia de rondas: PostgreSQL PGlite aislado, ruta real PUT, CAS, cancelación, recarga, no resurrección, no borrado de otra ronda y conservación de scores. No scores simulados en cuentas reales ni mensajes.
- Lectura offline de respuestas guardadas: hashes, 4 DTO, 18 posiciones y ledger intacto, PASS.
- `next typegen`, `tsc --noEmit`, lint y build ejecutados. Resultado final documentado en recibo privado de la corrida.
- Ocho expectativas antiguas de UI/mocks se actualizaron para el comportamiento nuevo; ningún fallo se atribuyó automáticamente a los cinco históricos. Suite final sin fallos.

## Consumo y QA real

Nuevas solicitudes GolfAPI: **0** (ledger previo 10/10). Mapbox: **0**. Google Maps únicamente al abrir GPS, una instancia por montaje y cambios de posición/hoyo sin reconstrucción. QA limitada a 20 inicializaciones; contador y capturas reales en recibo privado, actualizado tras publicación.

La suite usa datos sintéticos exclusivamente aislados, identificados como simulación en su pantalla localhost de QA, no publicada. No demuestra precisión de iPhone. Pruebas de campo y comportamiento físico Safari: **PENDING_DEVICE_QA**.

Publicación: pendiente de verificar deployment READY, SHA, health y navegación real. El recibo privado registra el resultado definitivo y capturas; un build local por sí solo no demuestra publicación.
