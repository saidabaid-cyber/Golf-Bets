# DEV · Dos sesiones desde la interfaz · 2026-10-10

Base: `047772c498e3ef25b888e9d6521dc8d5d5159376`. Rama exclusiva: `integration/backyard-current`.

## Cambios y verificación local

- `517c26b`: captura individual de putts, bunkers, agua, unidades y desempate de Víboras; decisiones grupales del organizador; CAS y auditoría existentes. Reglas/motores conservados.
- `7af1d99`: reautenticación desde página de prueba DEV sin revocar sesiones de otros dispositivos; retorno a Play.
- `7ae7b28`: acceso QA limitado a IDs existentes Diego/Carlos, contraseña verificada por Supabase y metadata administrativa confiable; exige origen/host DEV, rama exacta y base aislada. No crea cuentas ni otorga permisos. El login general permanece sin cambios.
- 157 pruebas dirigidas PASS antes del acceso QA; 3 pruebas adicionales de acceso/reautenticación PASS. Typecheck, lint y build PASS. Primer build del acceso QA falló por EPERM del sandbox al crear un directorio .next; ejecución local autorizada completó correctamente.
- Migración aditiva `20261010070000_shared_round_bet_capture.sql` aplicada sólo a DEV aislado `bymeopxkxapfizeeqeyb`, preservando autorizaciones de CAS y registros históricos. Función sólo ejecutable por service_role; clientes no tienen UPDATE directo. Pruebas SQL locales comprobaron inmutabilidad y conflictos.

## Recorrido real desde dos interfaces

A: QA Diego Green, navegador interno. B: QA Carlos Fairway, Chrome. Son las cuentas persistentes existentes: no se creó ningún perfil. Se verificaron sus identidades en la interfaz después del login real del proveedor. No se enviaron códigos por email ni se revocaron sesiones remotas de El Mongas.

| Acción desde la aplicación publicada | Evidencia y resultado |
|---|---|
| A crea desde Play | Configurar ronda completa → La Vista GHIN oficial → Blancas Hombres, 6,591 yd, rating 70.8/slope 128. Inicialmente sólo A, sin apuestas/scores heredados. A añadió Carlos desde Jugadores frecuentes con su identidad de cuenta. Diego no tiene GHIN vinculado ni Index actual; pudo iniciar. PASS. |
| Modo individual | A seleccionó «Cada jugador en su teléfono» en revisión y pulsó Iniciar. PASS. |
| Unión de B | A copió el enlace visible; B lo abrió y pulsó «Unirme a esta ronda». B sólo recibió su campo de score. PASS. |
| Scores simultáneos | A escribió 4 y B 5 en sus formularios del hoyo 1; se pulsaron ambos Guardar. Las dos tarjetas mostraron 4/5, mismo UUID y revisión 4. PASS. |
| Avance independiente | A pasó al 2 y guardó 4 mientras B seguía en el 1. No se requirió un score de B ni se rellenó su celda. PASS. |
| Recarga de ambas sesiones | Tarjetas visibles después de recargar: H1 A=4/B=5; H2 A=4/B=—; mismo UUID, revisión 5. PASS. |
| GPS real de Google | A abrió GPS desde esa ronda, colocó un objetivo, lo arrastró (70→50 yd al centro), desplazó y amplió el mapa. La cámara no volvió sola. «Ver green» sí recentró explícitamente. PASS de navegador. |
| Hoyos y score | A recorrió 1→2→3→1; par/yardaje cambiaron, sin guardar scores al navegar. Abrió Anotar, vio su 4, guardó y volvió al mismo hoyo del mapa. Objetivo de 67 yd y cámara se conservaron al abrir/cerrar Tarjeta. PASS. |
| B en móvil | Chrome renderizado realmente a 390×844 y 430×932: mapa, controles, score propio 5 y vuelta al mapa. PASS de viewport. El navegador interno conservó su tamaño nativo 510×884: no se presenta como captura de 390 px. |
| Ubicación real | «Usar mi ubicación» solicitó la ubicación del navegador; terminó en timeout. Distancias desde teléfono permanecieron no disponibles. «Detener GPS» detuvo el seguimiento. No se simuló una posición en esta prueba interactiva. Precisión física: PENDING_DEVICE_QA. |
| Cierre incompleto | A pulsó Revisar y finalizar → Finalizar tarjeta. Respuesta visible: «Faltan scores en la tarjeta. La ronda sigue abierta». No se guardó como completa ni se publicó una liquidación definitiva. PASS. |

Ronda canónica individual creada desde UI: `3568b699-c64c-484a-b5a1-c5f02dd5ccb1`.
Enlace DEV: `https://dev.thebackyard.com.mx/?sharedRound=3568b699-c64c-484a-b5a1-c5f02dd5ccb1`; sólo las cuentas vinculadas pueden entrar.

## Yo llevo todos los scores

A inició otra ronda nueva desde Play con los mismos dos QA, seleccionando «Yo llevo todos los scores». En la captura original del organizador confirmó A=4 y B=5; Tarjeta mostró ambos. Después guardó B=3 en el hoyo 2 sin completar A: avanzó al 3 con «Avance guardado. Pendientes: QA Diego Green. Resultados provisionales».

La primera observación de Play después de recargar no mostró la ronda activa. Se utilizó **Recuperar rondas sin terminar → Reanudar r39pyo6x**, desde la propia interfaz. La tarjeta de nube conservaba 4/5 y B=3; no se recreó ni se borró ninguna ronda. Tras reanudar, Guardar y salir → recargar → Continuar → Tarjeta conservó el hoyo 3 y esos mismos scores. Captura/persistencia comprobadas; se documenta la recuperación inicial, sin atribuir una causa no demostrada a las pestañas anteriores.

ID local `r39pyo6x`, canónico `fb464b14-a26a-4b94-9df9-db3f40c20555`. Ambas rondas QA permanecen en juego e incompletas, sin convertirse en estadísticas históricas completas. Los históricos reales no se editaron.

La revisión automática rechazó navegar varias pestañas anteriores porque podría descartar captura pendiente de El Mongas. Esa navegación no se ejecutó. La recuperación se completó desde la pestaña QA en primer plano; no se necesitó ese cambio de pestañas.

## Apuestas: datos que todavía debe aportar la captura

| Juego | Dato requerido cuando aplica | Flujo preparado |
|---|---|---|
| Conejos, Skins, Pollas, Nassau, Chicago, Vegas y Presiones configuradas | Scores reales de sus participantes; parejas/reglas en configuración | Cada cuenta guarda su score. Las celdas ausentes siguen vacías; cierre server-side bloquea tarjeta/resultados incompletos. |
| Víboras / Mínimo de Putts | Putts de participantes activos; desempate/distancia o tenedor según modalidad | Putts visibles como necesarios; cada cuenta captura los suyos. Se usa la derivación existente de Víboras, sin crear eventos repetidos por reintentar. Organizador resuelve desempate/tenedor. |
| Camellos / Peces | Eventos reales de bunker/agua; tenedor si la modalidad lo pide | «Eventos de mis apuestas» por jugador; decisiones del organizador para la resolución. Los eventos opcionales no capturados conservan el tratamiento de cero del contrato existente. |
| Unidades | Unidades adicionales manuales, cuando existan | Campo individual; las unidades naturales siguen derivadas del engine. |
| Loba | Loba, pareja/solo, fuego y unidades si están habilitadas | Panel Loba existente, con borrador y guardado explícito del organizador. |
| Bola Amiga | Parejas por hoyo y descanso del quinto cuando corresponde | Panel existente del organizador; no se inventan parejas. |
| Foursome | Pareja base válida del segmento | Selección del organizador, preservando segmentos/reglas y fórmulas. |
| Personal con rival externo | Score real del rival externo en los hoyos de los componentes activos | Campo del organizador para ese rival. No usa el score de otro jugador ni un score fabricado. |

Estas apuestas no son definitivas mientras falten sus datos. Se completó el canal de captura/CAS/auditoría, usando los editores y motores existentes. Las dos rondas del recorrido interactivo fueron **sin apuestas activadas**: no se presenta ese recorrido como prueba interactiva de liquidación de cada modalidad. Capturas especiales, autorización, conflicto, retry y cierre con putts faltantes/completos fueron probados con fixtures aislados. QA interactivo exhaustivo de todas las modalidades: PENDING_INTERACTIVE_QA.

Corrección final de texto: los pendientes se indican «para finalizar» y aclaran que se puede cambiar de hoyo; no se muestra un panel vacío de eventos cuando el jugador no participa en esas apuestas. No cambió ningún motor.

## Evidencia durable

Capturas JPEG reales y snapshots DOM en:
`C:/Users/said_/.codex/visualizations/2026/10/03/01a1039a-6144-7c61-ae88-7601acdff261/shared-round-ui-20261010/`.

- `A-modo-individual.jpg`, `B-unirme.jpg`: creación/unión visible.
- `A-tarjeta-4-5.jpg`, `B-tarjeta-4-5.jpg`: ambos resultados en ambas interfaces.
- `A-recarga-persistencia.jpg`, `B-recarga-persistencia.jpg`, `tarjetas-despues-recarga.txt`: persistencia después de recargas.
- `A-gps-objetivo-movido.jpg`, `gps-cambio-hoyos.json`, `A-score-sobre-mapa.jpg`: interacción y contexto.
- `B-gps-390x844.jpg`, `B-score-390x844.jpg`, `B-gps-430x932.jpg`: tamaños móviles comprobados.
- `A-modo-organizador.jpg`, `A-organizador-tarjeta-4-5.jpg`, `A-organizador-parcial.jpg`, `A-organizador-recarga-persistencia.jpg`, `organizador-despues-recarga.txt`: modo organizador y recuperación.
- `A-finalizacion-bloqueada-por-pendientes.jpg`, `finalizacion-incompleta.txt`: cierre rechazado.

Las capturas locales sirven como evidencia en esta computadora; no se presentan como URLs accesibles desde el iPhone.

## Datos y consumo

GolfAPI: **0** nuevas llamadas. Mapbox: **0**. Google: **2 adicionales** para el recorrido de las dos interfaces (`2026-10-10T14:03:17.078Z`, A; `14:06:54.319Z`, B). Una instancia por sesión, sin reinicializaciones al cambiar hoyo, objetivo, tamaño o panel de score/tarjeta. Contabilidad conservadora acumulativa: cuatro anteriores + una ya presente al inspeccionar Chrome + dos nuevas = **7/10**. No se modificó facturación.

Par 70 continúa como pendiente independiente de datos. Precisión física en campo y gestos físicos de iPhone: **PENDING_DEVICE_QA**. Sesión real de Said: **PENDING_INTERACTIVE_QA**; las sesiones QA sí se autenticaron y operaron desde sus interfaces.

## Publicación y comprobaciones

El código funcional `7ae7b280089f30db333e664679eaa30b8e91e9fd` fue verificado interactuando con el DEV canónico. Vercel confirmó READY, deployment `dpl_8HZFCTetW5LGGKm32udBBx2Qv2Mj`, alias `dev.thebackyard.com.mx`, rama `integration/backyard-current`; `/api/health` 200 con ese buildSha. El commit de cierre agrega este informe y las dos correcciones de claridad anteriores; se comprobará nuevamente el alias/health y la tarjeta desplegada.

Comprobación final dirigida: **44/44** (interfaz real bajo harness, shared live/CAS, base SQL aislada, captura de apuestas, cancelación y regresión de captura). Typecheck PASS; lint de los dos componentes finales PASS; build PASS. Los tests con fixtures no consumen proveedores de mapas ni validan el GPS físico. Logs privados ignorados en `.qa-artifacts/ui-shared-round-20261010/`.
