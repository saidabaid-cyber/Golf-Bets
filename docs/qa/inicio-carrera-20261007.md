# Inicio y Carrera — implementación DEV, 7 octubre 2026

## Bloque A: estado y fuentes

Rama: `integration/backyard-current`. HEAD inicial: `78710d2af23a92d9e64c31d12ca0967e85f16212`.
Árbol inicial limpio. Checkpoint recuperable: `checkpoint/dev-before-inicio-carrera-20261007`.
Se revisaron los 17 archivos de referencia, índice y guía antes de programar.

Mapa de presentación:

| Área | Componentes | Autoridad conservada |
|---|---|---|
| Inicio | HomeDashboard, CloudSocialActivity, SocialRoundActivityCard | API social autorizada, identidad autenticada |
| Amigos | FriendsHub, SocialQr | conexiones y privacidad existentes; descubrimiento por club, sin GPS |
| Carrera | CareerHub, CareerOverview, CareerRounds | histórico atribuible y elegibilidad de estadísticas existentes |
| HCP / Atest | CareerIndexPanel, CareerGhinScores | fuente activa GHIN/Backyard; GET Atest de últimas 20 |
| Estadísticas | StatsDashboard, golf-insights, proyección de captura | perspectiva del propietario, tarjetas completas, cohortes 9/18 separadas |
| Tarjeta | ScorecardNavigationBoundary, PremiumScorecard | componentes y guardado existentes; sin reconstrucción |

Auditoría de lectura previa: hashes de datos de las dos cuentas QA iguales al checkpoint anterior.
Mongas: 23 rondas completadas; GHIN activo 30.8 (revisión 8 junio 2023), índice Backyard calculable 5.5 desactivado.
Said: GHIN activo 7.9 (revisión 24 septiembre 2026), cero tarjetas completas elegibles para estadísticas.
Son observaciones de QA, nunca constantes del producto.

## Contrato de métricas

| Métrica | Campo y fórmula | Elegibilidad / ausencia |
|---|---|---|
| Gross y vs par | recap autorizado; suma de scores, suma menos par | tarjetas completas y cohorte 9/18; total declarado no produce datos por hoyo |
| Birdies / eagles / pars / bogeys | diferencia score-par por hoyo | sólo hoyos reales del jugador atribuido |
| Putts por ronda | suma `putts[hole][owner]` | todos los hoyos capturados; cero válido; ausente no cuenta como cero |
| Putts por hoyo y distribución | conteos explícitos 0/1/2/3/4+ | denominador de hoyos capturados, indicando muestra incompleta |
| FIR | `advancedStats.fairwayHit`; aciertos/capturas | par 4/5; par 3 excluido; no se infiere desde score |
| Dirección | `advancedStats.teeDirection` | sólo capturas explícitas, no ubicación real ni GPS |
| GIR | `advancedStats.greenInRegulation` | captura explícita; no inventar desde total |
| Penalidades | `advancedStats.penaltyStrokes` | sólo cantidades registradas; ausencia distinta de cero |
| OB | contador `outOfBoundsCount`, o booleano legado | contador prevalece; OB no se suma otra vez a penalidades |
| Distancia / bastón | `teeDistance`, `teeClub` | capturas reales, yardas; sin simulación de tracking |
| Tendencias | series cronológicas de misma cohorte y periodo | fechas de juego/cierre, sin mezcla 9/18 ni jugadores |

No se modificarán motores HCP, Atest, apuestas, GPS, permisos, scoring ni base de datos.
No se copiarán valores ni recursos propietarios de las referencias.

## Registro por bloques

- A: auditoría y checkpoint; datos QA de lectura preservados.
- B–K: registrar validaciones y evidencias al completar cada bloque.
- B: Feed compacto con Score/Vs par separados y semántica bajo/par/sobre; avatar abre perfil; Inicio explícito reinicia Feed sin interferir con Back de tarjeta. 26 tests relevantes PASS. Comparación de componente React real a 390px con fixtures aislados; métricas ausentes ocultas y cero visible. No publicación de fixtures en DEV.
- C: Amigos y Agregar amigos conservan APIs, QR, solicitudes y privacidad. Filas/solicitudes/QR compactados sin HCP ni distancias ficticias. Comparación estructural con referencias 08/09; 33 tests de comunidad y acciones PASS. Confirmación visual final pendiente en DEV real.
- D: Resumen compacto con panorama histórico, rondas recientes, mejor ronda y acceso directo a categorías de estadísticas. Temporada e historial combinado secundarios; sin duplicar panel GHIN. 16 tests de muestras/subvistas PASS; comparación React real a 390px PASS.
- E: HCP y Atest reunidos en una banda compacta; detalles dedicados y tarjetas GHIN preservados. Fecha GHIN distingue revisión de consulta; sin gráficas o percentiles inventados. 32 tests de HCP/Atest/GHIN PASS; comparación estructural con referencias 10/11, verificación visual final en DEV pendiente.
- F: Rondas coloca filtros y lista compacta primero; elimina gráficas y tarjeta parcial repetida del recorrido. GHIN vinculado reutiliza la fila real Backyard; origen, deduplicación y sólo lectura intactos. 50 tests de historial/subvistas/GHIN PASS; comparación estructural con referencia 17 y acceso Premium conservado.
- G: Estadísticas en cinco subvistas, período/formato separados antes del cálculo, distribución real por hoyo, putting completo/parcial, FIR par 3 excluido, GIR explícito y penalidades/OB capturados. Proyección exclusivamente de lectura; selección preservada en URL al abrir una ronda. 34 tests de métricas/categorías/privacidad IA PASS; componentes React reales Putting/Driving comparados a tamaño iPhone con fixtures aislados. Datos de producto y motores intactos.
- H: Logros usa nombres españoles en presentación y detalle dedicado sin scroll por ancla; Rivalidades prioriza lista/cara a cara y secundarias plegables; Torneos vacío no repite paneles sin resultados. Motores sin cambios. 30 tests PASS; Logros comparado a tamaño iPhone con componente real y fixtures aislados, contraste del destacado corregido.
- I: Microcopy GHIN en español, controles táctiles de categorías de 44px y navegación de estadísticas preservada al consultar una ronda. QA de componentes React reales a 320/375/390/393/430px sin overflow documental; datos ricos sólo en fixtures de test. Typecheck, lint y build PASS. Se actualizaron expectativas antiguas de entrada Inicio/Carrera y microcopy sin relajar permisos ni privacidad.
- J: Suite completa PASS: 4,706 tests de aplicación + 117 scripts = 4,823. Typecheck, lint y build PASS; cuatro expectativas antiguas ajustadas a navegación/microcopy requeridas. Tests de backup/HTTP/Git temporal requirieron ejecución fuera del sandbox y pasaron sin datos externos. PremiumScorecard, Boundary, HCP, motor de apuestas, Supabase/migraciones y configuración DEV sin diferencias respecto al checkpoint.
- G/J, comprobación final: FIR/GIR por ronda usan únicamente denominadores capturados; frecuencia de penalidades por ronda sólo con captura completa de los 9/18 hoyos. Nuevo test verifica exclusión de tarjetas parciales y cero válido. Suite final: 4,707 + 117 = 4,824 PASS; typecheck, lint y build PASS.
- K: checkpoint de código y deployment estable previo registrados. Push normal exclusivamente a `integration/backyard-current`; verificar SHA canónico y recorridos reales antes de declarar despliegue validado. Evidencia de runtime y capturas originales se entregan en el artefacto de QA, sin fixtures en producto ni escrituras de datos de negocio.
- K, QA visual canónico: detectada precedencia del tema global de 38px sobre números de estadísticas; ajuste restringido a `.golfStats` para mantener 25px y `vs par` en una sola línea. Feed → tarjeta → hoyo preserva Vuelta y scroll exacto del Feed. HCP 30.8 GHIN histórico y Atest 10/20 se conservan en la cuenta Mongas. Se vuelve a validar el despliegue del ajuste visual antes del cierre.
