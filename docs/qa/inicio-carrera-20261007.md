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
