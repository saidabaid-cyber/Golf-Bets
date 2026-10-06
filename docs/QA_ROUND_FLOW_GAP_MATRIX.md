# Auditoría inicial — flujo final de ronda DEV

BASE_SHA: f987a54ed4ebd982ca5e3c0a62caf30fde09c336. Branch integration/backyard-current; worktree limpio; health HTTP 200 y SHA coincidente.

Baseline: 20 completas + 2 parciales antiguas, hashes registrados en artefacto privado local. No se modifican.

| Función | Existe DEV | Lógica madura | E2E actual | Necesita fix | Resultado inicial |
|---|---|---|---|---|---|
| Ronda activa / continuar | Sí | active-round-navigation y checkpoint | Pendiente | Por determinar | PENDING |
| Nueva con activa / preservar | Sí | parkActiveRound(live), save-before-clear | Pendiente | Por determinar | PENDING |
| Soft cancel | Sí | cancelOwnerRound CAS, preserveUnfinishedRound | Pendiente | Por determinar | PENDING |
| Review / editar | Sí | restoreRoundSnapshot, upsert por ID | Pendiente | Por determinar | PENDING |
| Campo / tee / HCP | Sí | snapshot Course Handicap, player cards | Pendiente | Por determinar | PENDING |
| Agregar/quitar/buscar jugadores | Sí | accountPrimaryPlayerId, picker existente | Pendiente | Por determinar | PENDING |
| Frecuentes | Sí | upsertFrequentPlayers | Pendiente | Auditar matching invitado por nombre | PENDING |
| Grupos / memberId | Sí | GroupGameTemplate con memberAssignment | Pendiente | Por determinar | PENDING |
| Apuestas / Carry / personales | Sí | Engine + personal-nassau + supplemental | Pendiente | No cambiar fórmulas | PENDING |
| Diferencial / Completo / ayudas | Sí | relative=resta referencia; course=HCP completo | Pendiente | Mapping ya implementado | PENDING |
| Sin apuestas | Sí | roundPresentation.playMode, motor condicionado | Pendiente | Por determinar | PENDING |
| Cierre / histórico / persistencia | Sí | canonical CAS/receipts/checkpoint | Pendiente | Preservar fixes | PENDING |
| Atest posterior | Sí | hash actual, compañero, no self-atest | Pendiente | Por determinar | PENDING |
| Backyard Index sin Atest | Sí | elegibilidad no depende de Atest | Regresión local por ampliar | No cambiar regla | PASS auditoría |
| Carrera válidas / canceladas | Sí | agregación de completed / elegibilidad | Pendiente | Por determinar | PENDING |

Pruebas locales iniciales fresh output: 858/858 PASS. .test-dist viejo contenía tests retirados de GPS: se descartó ese output; se compiló en tmp/round-flow-tests sin borrar nada.

Referencia Production: una lectura pública HTTP200 (landing, sin login ni escritura). Comparación funcional madura mediante git show origin/main y tests existentes; la landing no acredita flujos autenticados. Fórmulas relative/course coinciden con la lógica madura. DEV contiene validaciones adicionales legítimas; no se revierte el engine.

Plan máximo cuatro nuevas: QA21 activa→park→reanudar→completar→editar→Atest posterior; QA22 progreso→soft cancel; QA23 grupo+HCP+Skins Carry+personal→cerrar; QA24 H1 guardado→activa en H2 para revisión. No se crean fixtures DB finales ni se borra al terminar.
