# Cierre operativo de rondas — el_mongas — DEV

## A. STATUS

**PENDING_DEVICE_QA. Flujo operativo y persistencia en navegador: PASS.** El login independiente recuperó las 22 completas, Index 5.5, Atest 55%, el grupo, frecuentes y QA24 en H2 con H1 intacto. La recuperación canónica no escribió ni duplicó la tarjeta activa. Reposo de 132 segundos: cero llamadas cloud; navegación posterior: cero llamadas cloud. No se acredita todavía iPhone físico ni se declara DONE físico.

DEV único: https://dev.thebackyard.com.mx. Cuenta el_mongas@yahoo.com.mx. Branch integration/backyard-current. Base f987a54ed4ebd982ca5e3c0a62caf30fde09c336; código019b8c9114d3fbebc3f0cbb055be5695b7db3a2a. No se utilizó GHIN.

## B. BASELINE

PASS. Las20 originales y360 scores del dueño se conservaron. Comparación exacta de las22 filas iniciales, incluyendo2 parciales antiguas: versión, snapshot_hash, scores_hash, lifecycle y número de hoyos sin cambios. Tras4 nuevas, servidor26 filas:22 completed,1 cancelled y3 live. Las11 atestaciones previas permanecen; QA21 agregó una posterior. No hubo DELETE ni restauración de snapshot antiguo.

## C. GAP MATRIX

Ver [matriz completa](QA_ROUND_FLOW_GAP_MATRIX.md): auditoría previa, lógica madura, flujo real y fix por función. Se comparó código maduro con origin/main mediante lectura; Production sólo se leyó como landing pública. Esa landing no acredita operaciones autenticadas en Production. No se copiaron UI ni motores anteriores.

## D. ACTIVE ROUND

PASS en sesión original, servidor y login independiente. QA21 guardó H1, salió a Inicio y continuó H2. QA24 conserva H1 dueño 5/invitado 6, Blancas y dos jugadores; queda activa H2. La primera prueba fría detectó cursor H1 y revisión local ausente: se pausaron escrituras, se corrigió localmente y se repitió sólo la recuperación. Con 019b8c9, Inicio ofrece Hoyo 2; al continuar muestra Hoyo 2, H1 5/6 y «Scores sincronizados». Dos GET de una tarjeta comprueban revisión y material idéntico; cero PUT. Servidor permanece versión 3 y hashes iguales.

## E. NEW ROUND WHILE ACTIVE

PASS. Se probaron Cancelar, Continuar ronda actual e Iniciar nueva. QA21 se conservó como live al crear QA22, con mismo ID y H1. Posteriormente se reanudó y terminó; no se reemplazó destructivamente.

## F. SOFT CANCEL

PASS en flujo canónico. QA22 confirmó cancelación y quedó cancelled con H1=5 retenido, sin afectar métricas/Index. La API existente sólo actualiza live; cancelled es terminal de sólo lectura. Se quitó el CTA que intentaba reactivarla. Tests22/22 PASS. Nueva sesión mostró Cancelada, H1=5, sin Reanudar ni Corregir; evidencia clean-cancel-readonly.png.

## G. EDIT / REVIEW

PASS flujo, servidor y nueva sesión: QA21 muestra86. QA21 terminó85 y se corrigió por UI H1 de5 a6, total86. Conservó UUID24493b70-a2ef-456b-8060-aa5d69bb02ea. La corrección usa persistencia histórica; ya no intenta PUT del transporte live de una completed. Participación posterior y Atest actual se conservaron como operaciones distintas.

## H. FIELD / TEE

PASS. QA21 usa CLUB CAMPESTRE DE PUEBLA/PUEBLA/Doradas, catálogo real; su tee carece de evidencia Rating/Slope suficiente, por lo que no se inventaron valores ni elegibilidad Index. QA23/24 usan La Vista, tarjeta actual, Blancas6590yd/par72/Rating70.8/Slope125. QA24 probó cambio explícito confirmado Blancas→Doradas→Blancas después de H1, conservando scores y recalculando CH5→2→5. La configuración final es Blancas.

## I. PLAYERS

PASS. Buscador encontró QA Diego Green y QA Carlos Fairway; agregar/quitar Carlos se realizó durante configuración. Grupo conserva dueño, Diego e invitado; QA23 seleccionó dueño+invitado. Las identidades son UUID de cuenta o ID estable de invitado, no displayName.

## J. FREQUENT PLAYERS

PASS reutilización QA23→QA24, IDo78yfyah. Se preservó además la plantilla inicialpoz7xfkz, usos0, creada antes de corregir el bug de identidad del miembro invitado. No se fusionaron ni borraron por nombre. El fix reutiliza sólo una asociación memberId explícita e inequívoca. Existe esa evidencia duplicada anterior; no se presenta como eliminada.

## K. GROUPS

PASS en servidor, sesión original y login independiente. QA Flujo Final cloud 40b8867b-c967-41af-b75a-d626a3a1c9b0, local vj94jnag, tres miembros, usado en QA23. Play → Grupos recuperó este grupo y el anterior; su detalle conserva dueño, Diego e invitado. La configuración de QA24 recuperó seis frecuentes, incluidos el invitado utilizado y la semilla anterior preservada. No se cargó otro grupo sobre QA24.

## L. MEMBER IDENTITY

PASS. Tests de ida/vuelta grupo→ronda→frecuente→grupo conservan memberId, cambios de nombre mantienen identidad, homónimos distintos no colapsan y asociaciones ambiguas no se adivinan. E2E reutilizó invitadoo78yfyah; apuesta personal ligada a ese ID. No se cambió nombre a usuarios reales para probarlo.

## M. HANDICAP

PASS. Index5.5 con Blancas70.8/125/par72 produce CH5; Doradas68.4/121/par72 produce CH2. Invitado manual12. Cambio explícito de tee recalcula; cambios externos tras inicio no modifican silenciosamente el snapshot. Diferencial corresponde a relative, restar referencia; Completo a course. QA23 usa diferencial7, uno en SI1–7. No se alteró fórmula del engine.

## N. BETS

PASS E2E Skins Carry y personal Dólar por golpe, sólo valores sintéticos, sin pagos reales. Configuración, ayuda, HCP, scores, resultados, cierre y servidor concordaron con engine real. No se escribió engine.ts. Las otras modalidades se cubrieron en regresión local, no se afirma E2E real de cada modalidad. QA24 score_only no muestra apuestas ni opciones de aplicación HCP para apuestas; sí admite jugadores/score.

## O. CARRY

PASS. H1/H2 empatan por neto; dueño gana H3, tres skins ×10=+30, rival−30. H4–18 empatan sin ganador; no se fabricó payout. El contador existente muestra16 incluyendo el siguiente skin; son15 hoyos empatados sin resolver. Se mantuvo la convención del motor. Oracle usa engine real y snapshot QA23.

## P. PERSONAL BETS

PASS. Personal f4dcc5e2-128f-4416-9a81-e6bb60e7ccfd, Dólar por golpe1, ventaja7 al invitado. Gross89/97, net relativo89/90, resultado propio+1. Sumado a Skins+30, recap propio+31. Identidad invitadoo78yfyah. Carrera/Rivalidades muestra balance propio; no se agregó exposición de balances ajenos.

## Q. ATEST LATER

PASS API real. QA21 quedó pendiente al cerrar y editar. Después de navegar y confirmar participación, Diego realizó Atest canónica autenticada contra versión10 y currentHash6313a0c9f3c5695cc328738a432e578fff0cd4760cefa2c0585cd0f07e02df87. Se persistió una válida. QA23 sigue pendiente; no hubo auto-atest ni inserción DB manual. Total12 atestaciones; ventana últimas20=11/20=55% porque una tarjeta antigua quedó fuera.

## R. BACKYARD INDEX RULE

**Una tarjeta sin Atest sí cuenta si es elegible.** Código lib/backyard-index.ts valida evidencia y filtra snapshots elegibles; no usa Atest como requisito. Test tests/backyard-index.test.ts «unattested eligible Backyard cards count for Index; cancelled and live cards do not» lo acredita. Contrato docs/BACKYARD_INDEX.md explícito. No se cambió la regla ni matemática. QA23 sin Atest tiene diferencial16.5. Son21 elegibles, últimas20/mejores8:1.1+2.4+3.8+5.2+6.5+7.1+8.0+9.9=44;44/8=**5.5**, establecido. QA21 es NO ELEGIBLE por evidencia faltante. Live/cancelled excluidas.

## S. CAREER

PASS las cinco subvistas en sesión independiente. Resumen: 22 rondas, promedio 82.8, birdies 18, mejor 71, Index 5.5 y Atest 55%. Logros 5/7: Low Round 71, Birdie Club 18/10, Par Master 157/50, Consistency 22/12, Win Streak 3/3. Rivalidades: 25 enfrentamientos, 64%, balance propio 43, nuevo rival invitado. Rondas muestra 89/86 y cancelada, sin contar activa/cancelada como completa. Torneos 0 legítimo. Salón de la Fama conserva vacío honesto. Cinco tabs inmediatamente debajo del header, subvistas, sin hero ni anchors; Carrera permanece activa. Se guardaron screenshots y snapshots de la sesión independiente.

## T. REQUEST BUDGET

Captura diagnóstica de la sesión original: GET sync 79, POST sync 73, /rounds 69, total 221. Primer Chrome agregó 2 GET sync. Sesión independiente final: 2 GET sync, 2 POST sync, 2 GET /rounds y cero PUT /rounds. **Total instrumentado mínimo: GET sync 83, POST sync 75, /rounds 71; 229 requests.** No es conteo exhaustivo de Vercel: las lecturas/finalizaciones de cancelOwnerRound/finalizeOwnerRound y social no están todas instrumentadas. Cinco requests de Atest posterior y tres de confirmación social se midieron por separado. El primer preview 014e473 no emitía diagnostics por la limitación de hostname; ausencia de logs no se interpreta como cero requests.

Retries 0; polling 0; storm 0 en ventanas observadas. Full GET de sync instrumentados: 11, inesperados 0: nueve de la sesión original más las hidrataciones iniciales del primer Chrome y del preview final. Máximo response 528789 bytes; upload 38388 bytes. POST entrega canonical receipt con bundle completo por contrato actual, hasta ~529 KB; delta reduce upload, no se ocultan esas respuestas grandes.

Los9 fullGET legítimos: hidratación inicial437197B; cambio canónico de cancelación483640B; reload hotfix483898B; reload revisión pausada486776B; cierre QA21 en /rounds503983B; reload fix edición503983B; reload fix Index de grupo500868B; cierre QA23 en /rounds528789B; reload fix móvil523827B. Ninguno fue POST exitoso→failure cliente→retry inexplicable.

La sesión final tuvo un GET inicial completo de 521578 bytes, otro condicional de 260 bytes y dos POST de arranque clasificados por el cliente como local-change, uploads de 26495/26494 bytes, receipts de 521695/521694 bytes. Fueron dos ciclos success con canonical receipt, sin failure ni retry; no un GET completo posterior al POST. Las lecturas de owner fueron 66 y 10698 bytes, seguidas de ACK local sin PUT. Recorrer Carrera, Atest, detalle QA23, Perfil, Grupos y configuración/frecuentes añadió cero cloud requests. No se afirma que el arranque haya sido GET-only; el detalle de colección de esos POST no se capturó en el preview.

Usage guard pausó escrituras ante el PUT 409 explicado de edición completed y ante el problema de recuperación fría H1/revisión ausente. Se corrigieron localmente y se repitieron sólo esos casos; no se debilitó CAS. Reposos originales 143 s, 135 s, 4 m 24 s y >6 min: cero llamadas. Reposo final independiente **132 s: cero llamadas**, retry 0, failures 0. Observability Plus respondió 402: métricas exhaustivas de plataforma BLOCKED_EXTERNAL por el plan; no se cambió billing. El build habilita consola sólo en el hostname exacto del preview DEV, sin telemetry requests.

## U. PERSISTENCE

Servidor PASS:26 filas, baseline22 idénticas,4 nuevas canónicas, draftQA24, grupo, frecuentes y12 atestaciones. Original logout realizado. El primer relogin en Chrome completó autenticación, pero tenía almacenamiento anterior: Resumen20 rondas, media82.3 y14 conflictos protegidos antes de aplicar la nube. No se eligió una copia ni se borró almacenamiento. Ese intento NO acredita sesión limpia.

Para aislar almacenamiento sin destruir datos se abrió el origen exclusivo del deployment DEV nuevo: **https://golf-bets-1gh9xdq75-saha8.vercel.app**, commit 019b8c9, preview, health 200. El usuario introdujo el código privadamente. Recuperación servidor **PASS**: 22 completas, tarjetas 86/89, apuestas +31, Index 5.5, Atest 55%, cinco vistas de Carrera, grupo, frecuentes y activa en H2. La cancelada también se verificó de sólo lectura en la sesión independiente previa. El origen nuevo no reutilizó el almacenamiento del dominio canónico ni del agente anterior. No se borró almacenamiento para resolver conflictos.

**EL_MONGAS_PERSISTENCE: PASS. BASELINE_PERSISTED: 20/20. COMPLETED_VISIBLE: 22. SERVER_REHYDRATION: PASS. CLEAN_SESSION_RELOGIN: PASS. HISTORY_VISIBLE: PASS. CAREER_VISIBLE: PASS. BACKYARD_INDEX_VISIBLE: PASS. ATEST_VISIBLE: PASS. ACTIVE_H2_VISIBLE: PASS.** Una comparación SQL después del relogin confirma las 26 tarjetas exactamente iguales al checkpoint previo, las 22 originales intactas y las 11 Atest anteriores conservadas; 12 Atest totales. QA24 continúa versión 3, H1 único, sin score nuevo ni duplicado.

Primer intento Chrome adicional: GETsync2, POSTsync0, rounds0, retries0, failures0. Full inicial521578B legítimo y lectura condicional260B. Durante la revisión no hubo más requests cloud. Los conflictos mantuvieron la protección de datos y no se sobrescribieron las20 originales.

## V. NEW QA ROUNDS

| ID cloud / local | Propósito | Campo / tee | Score dueño | Bets | Atest | Lifecycle |
|---|---|---|---:|---|---|---|
|24493b70-a2ef-456b-8060-aa5d69bb02ea / z082rref|Activa, park, recuperar, cerrar, editar, Atest posterior|PUEBLA / Doradas|86|Sin activas|Válida Diego, versión10|completed|
|8b512844-eee5-4c34-95d1-877470b19361 / hho9yjs8|Confirmar soft cancel y conservar H1|La Vista actual / Blancas|5 parcial H1|Sin activas|No elegible incompleta|cancelled|
|fee4ab11-9650-4f3b-99b3-8af0bd0eebde / a9sro2vv|Grupo, CH, Carry, personal, cierre|La Vista actual / Blancas|89|Skins Carry10 + Dólar/golpe1|Pendiente|completed|
|16e2c462-e6c3-4d5d-80d4-b68f6fc25a2d / rrouggse|Activa final para revisión; cambio tee confirmado|La Vista actual / Blancas|5 parcial H1|score_only|No elegible incompleta|live|

## W. FINAL ACTIVE ROUND

QA24 ID 16e2c462-e6c3-4d5d-80d4-b68f6fc25a2d, local rrouggse, versión 3. La Vista tarjeta real/Blancas 6590 yd/70.8/125. Dueño account:b182e0a1-d3f5-4e32-a005-29c6d55b6cdf, invitado o78yfyah. H1=5/6; H2 pendiente; score_only; queda abierta. El cloud draft no transporta currentIndex. La primera sesión fría abrió H1: applyCloudBundle preservaba UI también al reemplazar el bootstrap. Fix 019b8c9 deriva primer hoyo pendiente sólo sin cursor local válido y adopta revisión del owner sólo al comprobar igualdad exacta de tarjeta canónica. **Prueba DEV fría PASS:** CTA H2, captura H2, H1 5/6, CH 5/12, sincronizada, cero PUT, versión/hash intactos. Se dejó Inicio abierto con Continuar ronda.

## X. MANUAL REVIEW GUIDE

[MANUAL_REVIEW_EL_MONGAS.md](MANUAL_REVIEW_EL_MONGAS.md). [Manifest no sensible](QA_ROUND_FLOW_DATA_MANIFEST.json). Sin password, OTP, token ni secretos. Datos permanentes; no cleanup.

## Y. TESTS

Fresh TypeScript suite: **4527 tests,4522 PASS,5 FAIL preexistentes idénticos**, cero nuevos. Scripts mjs: **117/117 PASS**. Total observado4644/4639 PASS/5baselineFAIL. No se inventa clasificación unit/integration/e2e que el runner no entrega. QA E2E real se informa por escenarios arriba, no como tests automatizados inexistentes.

Dirigidos:947/947 engines/grupos/identidad/frecuentes/roundutils;32/32 capture/sync;22/22 cancel/detalle/configuración final. Nuevas pruebas dirigidas de recuperación fría:45/45 PASS; typecheckPASS; lintPASS; buildPASS. Primera ejecución mjs en sandbox falló por restricciones de procesos/server local, misma suite en entorno autorizado sin credenciales117PASS; no fallo de producto.

Cinco baseline: equipment-owner-review, equipment-ui-contract, final-brand-ghin-closeout (equipment), iphone-capture.test (Rules) y nightly-catalog-quality (equipment-gaps desactualizado). No se tocaron áreas ajenas para borrar esos fallos. Viewports320/375/390/430: sin overflow después del fix; documento305/360/375/415px respectivamente. iPhone físico/teclado/safe-area reales: PENDING_DEVICE_QA.

## Z. GIT / BUGS / DEPLOYMENT

| Commit | Síntoma y causa | Solución y regresión |
|---|---|---|
|7d55f2d|Invitado frecuente podía cambiar identidad; cambio de tee no recalculaba snapshot correctamente|Identidad estable y recalculación explícita; active-round-configuration, round-utils, group-habitual-personal; test de Index sin Atest|
|ecd0483|Detalle live trataba tarjeta pausada como terminada|Reanudar live mediante guardia activa; historical-round-detail-ui|
|b7a9d50|Base local de ronda pausada tenía revisión anterior tras park; retry manual bloqueaba aunque snapshot base idéntico|Adoptar revisión sólo en retry explícito y base exacta; owner-paused-revision prueba remoto cambiado bloqueado|
|7edd991|Corrección completed montaba OwnerRoundSync y produjo PUT409 legítimo|Excluir histórico completed del transporte live, mantener CAS histórico; owner-paused-revision|
|fcbbbb9|Cuenta importada desde grupo perdió semántica de Index/HCP|Preservar cuenta y calcular tee a partir de Index al configurar, freeze al iniciar; group-account-handicap|
|fbd8f43|Grupo generaba nuevo ID invitado aun cuando existía memberId asociado|Reusar asociación única memberId/frecuente; pruebas rename/homónimos/ambigüedad|
|d00d16f|Capture320px tenía7px overflow y controles comprimidos|CSS sólo captureV2 estrecho: labels arriba, distancia/club una columna, select limitado; tests capture32PASS y cuatro screenshots|
|014e473|Detalle cancelled mostraba Reanudar aunque API no admite reactivación terminal|Detalle y handler sólo lectura, H1 trazable; SSR y ejecución real del handler con snapshot intacto|
|019b8c9|Nueva sesión aplicaba draft cloud preservando cursor del bootstrap; transporte owner exigía revisión sólo guardada en el dispositivo previo|Derivar primer pendiente al reemplazar ronda, verificar igualdad canónica completa antes de ACK sin PUT; CAS/edición remota siguen bloqueados. Diagnostics exactos sólo preview DEV.45 dirigidos PASS, suite sin fail nuevos|

Archivos por función: app/page.tsx integra guardias/identidad/HCP; historical-round-detail.tsx presenta lifecycle; owner-round-sync.tsx/lib/owner-round-sync.ts separan transporte live y revisión manual segura; round-capture-v2.module.css corrige320px; account-primary-player.ts/group-game-template.ts/round-utils.ts/frequent-templates.ts/types.ts preservan IDs y semántica HCP. Tests relacionados y docs de Index/QA. Engine de apuestas, GHIN, Rules, Coach, Notification Center, Admin y schema/RLS sin cambios.

Código 019b8c9114d3fbebc3f0cbb055be5695b7db3a2a publicado exclusivamente origin/integration/backyard-current; deployment dpl_F9jqmNXobMM6HRXPkLyzxsvz5Hed READY. Health canónico y preview HTTP 200, environment preview, buildSha 019b8c9114d3fbebc3f0cbb055be5695b7db3a2a antes de la prueba fría. El último commit documental no modifica código ejecutado; su SHA de entrega y health final se registran en la respuesta de cierre. El SHA de estos documentos se obtiene con `git log -1 --format=%H -- docs/QA_ROUND_FLOW_FINAL_REPORT.md`.

origin/main a1b33ddfad905e0d45bcfe0848916ba19ceed0af yorigin/beta c9a9d3550a0feb39fdeda82fcc79ab6eddb1a582 sin cambios; rama de campos sin escrituras. Fixdc4185fab8fd3143c44d4aa879f10459bd492106 sigue ancestro. No main/beta/Production/app.thebackyard.com.mx escritos. Datos QA no eliminados.

Checkpoint frío cerrado: código 019b8c9 probado en DEV; 26 filas sin cambios tras recuperación, baseline 22 intacto, QA24 v3/H1 intacto. next.config.ts sólo publica hostname no sensible del preview DEV para diagnósticos; production/beta/otras ramas reciben valor vacío.

Pendientes reales: iPhone físico (teclado, safe areas y tacto), métricas exhaustivas Vercel bloqueadas por el plan y decisión humana sobre la semilla frecuente duplicada preservada. No se fusionó por nombre. El arranque frío todavía realiza dos POST finitos; se reporta su coste, no se afirma una hidratación GET-only. No se crearon una quinta ronda, nuevas migraciones ni permisos. La cuenta queda permanentemente revisable.
