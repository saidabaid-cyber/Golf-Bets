# GHIN FULL CYCLE — QA25 Rojas / round-trip real

**STATUS: DONE — GHIN + BACKYARD QA cerrado.**
El dueño certificó el cierre físico en una sesión privada NUEVA de Safari:
login, recuperación, GHIN VERIFIED30.8, QA24H2, historial retenido y QA25 única.
Vercel confirmó más de3minutos sin eventos runtime tras la última acción,
sync periódico0 observado, errores0 y request stormNO.
DEV:https://dev.thebackyard.com.mx;branch:integration/backyard-current.
No quedan etapas funcionales pendientes. Evidencia completa:
[GHIN_EL_MONGAS_FINAL.json](GHIN_EL_MONGAS_FINAL.json).

| Bloque | Resultado real |
|---|---|
|MAPPING_ROJAS|PASS live2026-10-07T00:09:48.594Z:facility19886/course23233/tee106090,Female,18h,par72,71/137,5476yd.18geometrías par/yardaje/stroke idénticas. Entitlement incluye106090.|
|QA25_CREATION|PASS UI normal,una ronda nueva sin apuestas. ID49cd75db-eb6f-47fa-9e0e-b1841ae0f93b,local3sygtta5,date6oct2026,completed,version21.|
|QA25_HANDICAP|PASS freeze GHIN30.8,Rojas71/137/par72,CH=round(30.8×137/113+(71−72))=36.|
|QA25_SCORE|PASS18h UI:5,4,6,7,6,5,4,6,7 / 7,6,5,6,6,7,6,4,6. Gross103,OUT50/IN53,+31.|
|DRY_RUN|READY local con datos reales persistidos y READY server-side con sesión,profile,tee,entitlement y scoring fresco. Sin duplicate. All18,F,H.|
|POST_TRANSPORT|PASS separado del cliente read-only; /scores/hbh.json, sesión propia; preview+branch+DBaislada+flagprivado+VERIFIED+mapping/gender/geometry+complete/date/duplicate+confirm+uniqueclaim.|
|POST_RESULT|Un POST upstream HTTP200,providerID1208915748,receipt106216c7-cdbb-4e30-824c-ebf35139c039,SUCCEEDED,postedAt2026-10-07T00:39:47.603Z.|
|PROVIDER_VERIFY|PASS invalidated cache→fresh record→ID exacto una vez,date6oct2026,18h,23233/106090,adjusted103,PROVIDER_CONFIRMED.|
|IMPORT_AFTER_POST|PASS fetched7,new1,matched1,ambiguous0,invalid0,errors0.|
|ROUND_TRIP|PASS EXACT_MATCH,linked_round_id=QA25original. Backyard completed23 antes/después de import; QA25version21 antes/después.|
|IDEMPOTENCE|PASS previo y después de unlink→relink: preflight real ALREADY_POSTED, providerID1208915748, receiptSUCCEEDED, providerPOST adicional0.|
|UNIFIED_HISTORY|6GHIN-only,1Backyard+GHIN,22Backyard-only,0duplicates. Carrera23completadas,promedio83.7,mejor71,birdies18; una fila lógica QA25.|
|GHIN_INDEX|VERIFIED30.8 tras relink del mismo GHIN y refresh explícito; única fuente activa. Confirmado físicamente en Safari privado NUEVO.|
|BACKYARD_INDEX|Antiguo5.5 RESET/NO ACTIVO/NO VISIBLE. Frontera persistente; no se reactivó durante unlink ni relink. Los snapshots históricos permanecen congelados.|
|ATEST|10/20=50%,antes11/20=55%. Nueva Backyard QA25pendiente desplaza una atestada fuera de últimas20. GHIN-only no cambia Atest; ninguna previa borrada ni auto-atest.|
|QA24|PASS restaurada por Reanudar ronda→Salir y continuar después. InicioCTA H2. Server active_draft roundIdrrouggse,live,H1dueño5/guest6,H2null,cloudStateVersion494.|
|RELINK/REIMPORT|PASS mismo GHIN. Reimport explícito0nuevas/1vinculada/0revisión;7providerIDs retenidos,0duplicados.|
|CLEAN_SESSION|PASS físico del dueño en Safari privado NUEVO. GHIN activo, viejo5.5 ausente, QA24H2, QA25 única, retained history e histórico/Carrera recuperados; sin conflicto.|
|TESTS|Cierre funcional ya ejecutado: dirigidos171/171PASS; full4710:4701PASS/9baseline idénticos/0nuevos; scripts117/117PASS; Typecheck/Lint/BuildPASS. No se repitieron suites en este cierre documental.|
|GIT|Código final validado b647eaf7dd168c365665a8d1f9f9c99ba23846c3. El commit de este cierre modifica sólo documentación; su SHA se registra en la entrega y en Git. GPS y fixes previos preservados.|
|DEPLOYMENT|DEV READY,dpl_2dcqTfVGYx9FBKS5kf2G9jwGTrox. Health confirmado2026-10-07T04:10Z:HTTP200,preview,buildSha b647eaf7dd168c365665a8d1f9f9c99ba23846c3. Sin nuevo deployment funcional.|
|MANUAL_REVIEW|[Guía](../MANUAL_REVIEW_EL_MONGAS_GHIN.md),[Mapping](GHIN_QA25_ROJAS_EVIDENCE.json),[Historial](evidence/qa25-unified-history.jpg),[QA24](evidence/qa24-restored-h2.jpg).|
|UNRESOLVED|Ninguna etapa bloqueante pendiente. Único backlog de copy descrito al final.|

## Integridad / mapping / límites

Se reutilizaron links CONFIRMED:course-la-vista→23233 ytee-la-vista-rojas→106090.
0DML de mapping,0migraciones,0RLSchanges,0cambios de genderglobal/snapshots históricos.
26rondas previas conservan todos los scores.25snapshots/versiones idénticos;
QA24 sólo metadata normal park/resume,version4→5,scorehash igual
`66e1869c4a4a09292175d295235e2762`. QA22cancelada,QA21/23complete y20baseline intactas.

Fingerprint `5a940101e675cdc613b76e11764e57fdde0ac7788484283f8e69f24464ae413c`.
Provider import conserva grossnull y adjusted103,diff26.4; Backyard conserva su
gross103/hole-by-hole. Provider score ID es la prueba primaria; optional IDs
ausentes se toleran sólo sin contradicción. Fechas/hoyos/total/IDs conflictivos
bloquean. Timeout/ACK perdido mantiene claim ocupado, nunca reintenta el POST.
No corrección/delete upstream ni repost silencioso después de editar.

## REQUEST_BUDGET — etapa histórica QA25

Observado en la sesión del agente: cloud sync GET22/POST18; cloud rounds
GET21/PUT19/POST1,total41.81callscloud, finitas ligadas a18scores/config/cierre/resume.
Tres fullGET legítimos:521587B cold reload;536595B al incorporar completedcard
publicada por rounds endpoint;509451B reload deliberado del deployment.
No failure/retry ligados a ellos. Maxupload34810B,maxresponse536595B.
Los POST canonical receipts también devuelven bundle privado; esos bytes
no se presentan como delta response ni se ocultan. Unexpected fullGET0,
retry0,cyclefailure0,polling0,storm0,usage guard no disparado.

Reposo122.43s,2026-10-07T00:42:44.251Z→00:44:46.681Z:0cloudcalls.
Provider POST1,797requestB/6673responseB,0retries. App postingGET1/POST4
(dryrun/post/verify/repeat);importPOST1. App POSTs de preflight son distintos
del POST real /scores/hbh.json. Otros requests explícitos:2lookups directos
de course/tee al inicio y1refreshGHINposterior. Sin polling ni lookupgeneral repetido.
El tráfico externo Safari no se declara cero por ausencia de observación.

## Cierre relink / sesión limpia / reposo

Los27 IDs, scores, lifecycle, snapshots/versiones, QA24 y QA25 se compararon
antes/después de relink, reimport, preflight y logout:sin cambios. Los7providerIDs,
linked_round_id y receiptSUCCEEDED siguen iguales. El nuevo relink confirmado
estableció revision3/frontera `2026-10-07T03:27:17.051751Z`; refresh/import no
volvieron a moverla. El antiguo5.5 permanece cerrado.

Reposo autenticado del agente154.636s:0eventos cloud observados. La certificación
física final del dueño agrega más de3minutos sin eventos runtime en Vercel,
0sync periódico observado,0errores y ninguna tormenta. Reauthorize y scoring
record respondieronHTTP200. CLEAN_SESSION=PASS; IDLE_2_MIN=PASS; REQUEST_STORM=NO.
No se infieren totales globales ni bytes no instrumentados. En el preflight
final QA25:providerPOST adicional0. En este cierre documental:un GET de health,
ninguna llamada GHIN, ninguna escritura sobre la cuenta.

## Tests baseline

Los nueve nombres finales son exactamente los iniciales:4GPS,3Equipment,
1Rules,1nightlycatalogaudit. Detalle exacto en manifest. No cambios a esas
áreas para maquillar la suite.18pruebas nuevas cubren guards,ownedidentity,
immutablefreeze,date/geometry,golfer/gender,claimconcurrency,ACKreceiptfailure,
uncertainoutcome,verifyoptionalfields,roundtrip,duplicate yeditwithoutrepost.

No cleanup: QA25,receipt,providerrecord/link,6GHIN-only,QA24live ytodoelhistorial
permanecen. main,beta,Production,app.thebackyard.com.mx no fueron tocados.

## BACKLOG_NON_BLOCKING

- Revisar en otro frente el copy/banner: “Ronda actualizada desde la nube.
  La versión local anterior se conservó en este dispositivo.” Puede confundir
  en sesión limpia; no produjo conflicto, no cambióH2 y no bloquea funcionalidad.
