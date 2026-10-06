# Auditoría y cierre — flujo final de ronda DEV

BASE_SHA: f987a54ed4ebd982ca5e3c0a62caf30fde09c336. Branch integration/backyard-current; worktree limpio; health HTTP 200 y SHA coincidente.

Baseline: 20 completas + 2 parciales antiguas, hashes registrados en artefacto privado local. No se modifican.

| Función | Existe DEV | Lógica madura | E2E actual | Fix aplicado | Resultado |
|---|---|---|---|---|---|
| Ronda activa / continuar | Sí | active-round-navigation y checkpoint | QA21 salió y volvió en H2; QA24 recuperó H2 y H1=5/6 desde login independiente | Cursor derivado en recuperación fría; revisión adoptada sólo con igualdad canónica exacta, sin PUT | PASS |
| Nueva con activa / preservar | Sí | parkActiveRound(live), save-before-clear | Cancelar, Continuar e Iniciar nueva; QA21 conservó H1 | Revisión CAS explícita de base idéntica | PASS |
| Soft cancel | Sí | cancelOwnerRound CAS, preserveUnfinishedRound | QA22 confirmó cancelación; H1 conservado en servidor y nueva sesión de sólo lectura | Canceladas sólo lectura, sin CTA de reactivar | PASS |
| Review / editar | Sí | restoreRoundSnapshot, upsert por ID | QA21 H1 5→6, total85→86; mismo ID, nueva sesión conserva86 | Corrección completed fuera del transporte live | PASS |
| Campo / tee / HCP | Sí | snapshot Course Handicap, player cards | Puebla/Doradas; La Vista Blancas; QA24 cambio confirmado Blancas→Doradas→Blancas | Preservar semántica de Index del miembro y recalcular sólo en edición explícita | PASS |
| Agregar/quitar/buscar jugadores | Sí | accountPrimaryPlayerId, picker existente | Buscó Diego/Carlos; añadió y quitó Carlos; seleccionó miembros y guest | UUID de cuenta canónico, tee individual | PASS |
| Frecuentes | Sí | upsertFrequentPlayers | QA23→QA24 reutiliza o78yfyah | Matching por identidad; memberId único explícito | PASS reutilización; semilla duplicada anterior preservada |
| Grupos / memberId | Sí | GroupGameTemplate con memberAssignment | QA Flujo Final creado, usado en QA23 y recuperado en login independiente con sus3 miembros | Reutilizar frecuente sólo con asociación memberId inequívoca | PASS |
| Apuestas / Carry / personales | Sí | Engine + personal-nassau + supplemental | QA23 SkinsCarry+30 y Dólar por golpe+1; total+31 | Ninguna fórmula cambiada | PASS |
| Diferencial / Completo / ayudas | Sí | relative=resta referencia; course=HCP completo | Index5.5→CH5; invitado12; diferencial7, SI1–7; ayudas funcionales | Etiquetas actuales preservadas | PASS |
| Sin apuestas | Sí | roundPresentation.playMode, motor condicionado | QA24 score_only sin grupos/personales/aplicación HCP de apuestas | Ninguno adicional | PASS |
| Cierre / histórico / persistencia | Sí | canonical CAS/receipts/checkpoint | QA21/QA23 completed, QA22 cancelled, QA24 live; servidor26 filas; login independiente recuperó histórico, bets y activa | Separar edición histórica del transporte live y recuperar revisión segura en nueva instalación | PASS |
| Atest posterior | Sí | hash actual, compañero, no self-atest | Diego confirmó y luego atestó QA21 versión10, hash actual | Ninguno | PASS API canónica |
| Backyard Index sin Atest | Sí | elegibilidad no depende de Atest | Regresión específica; QA23 pendiente con diferencial16.5 elegible | Sólo documentación y test; regla intacta | PASS |
| Carrera válidas / canceladas | Sí | agregación de completed / elegibilidad | Las5 subvistas verificadas en login independiente;22 completas; media82.8; Index5.5; Atest55%; cancel/live excluidas | Detalle cancelada sólo lectura | PASS |

Pruebas locales iniciales fresh output: 858/858 PASS. .test-dist viejo contenía tests retirados de GPS: se descartó ese output; se compiló en tmp/round-flow-tests sin borrar nada.

Referencia Production: una lectura pública HTTP200 (landing, sin login ni escritura). Comparación funcional madura mediante git show origin/main y tests existentes; la landing no acredita flujos autenticados. Fórmulas relative/course coinciden con la lógica madura. DEV contiene validaciones adicionales legítimas; no se revierte el engine.

Plan máximo cuatro nuevas: QA21 activa→park→reanudar→completar→editar→Atest posterior; QA22 progreso→soft cancel; QA23 grupo+HCP+Skins Carry+personal→cerrar; QA24 H1 guardado→activa en H2 para revisión. No se crean fixtures DB finales ni se borra al terminar.

Se ejecutaron exactamente esas cuatro rondas. Las22 filas anteriores (20 completas y2 parciales) mantienen versión y hashes idénticos. Consulta final:26 filas,22 completed,1 cancelled,3 live. No se repitió la corrida de20.

Validación final local: TypeScript4527 tests,4522 PASS y5 fallos baseline idénticos; scripts117/117 PASS; dirigidos nuevos45/45 PASS; typecheck, lint y build PASS. Viewports320/375/390/430 PASS en navegador tras corregir overflow en capture. iPhone físico PENDING_DEVICE_QA.

Login independiente final PASS en https://golf-bets-1gh9xdq75-saha8.vercel.app, build019b8c9 del mismo proyecto DEV. Cuenta reconstruida:22 completas, Index5.5, Atest55%, grupo/frecuentes, QA24H2 yH1=5/6. Owner transport verificó metadata+tarjeta idéntica, ACK sin PUT. Reposo132s y navegación de verificación:0cloudcalls. Arranque:2GETsync+2POSTsync+2GETrounds,0retries/failures. Datos canónicos y baseline permanecen intactos. No se creó una quinta ronda.
