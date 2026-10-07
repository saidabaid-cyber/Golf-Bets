# GHIN FULL CYCLE — QA25 Rojas / round-trip real

**BLOCKED_EXTERNAL únicamente por confirmación final de sesión limpia.**
Posting/provider verify/import/round-trip/idempotencia: **PASS real**.
DEV:https://dev.thebackyard.com.mx;branch:integration/backyard-current.
No DONE mientras falte esa comprobación. Evidencia completa:
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
|IDEMPOTENCE|PASS acción real repetida devuelve ALREADY_POSTED antes de upstream; segundo providerPOST0. Tests cubren POST explícito repetido y simultáneo.|
|UNIFIED_HISTORY|6GHIN-only,1Backyard+GHIN,22Backyard-only,0duplicates. Carrera23completadas,promedio83.7,mejor71,birdies18; una fila lógica QA25.|
|GHIN_INDEX|VERIFIED30.8,refresh legítimo posterior2026-10-07T00:45:00.494Z.|
|BACKYARD_INDEX|5.5preservado. QA25 tiene preferencia Index internoOFF,reasonINDEX_NOT_ENABLED. No matemática/eligibilidad forzadas.|
|ATEST|10/20=50%,antes11/20=55%. Nueva Backyard QA25pendiente desplaza una atestada fuera de últimas20. GHIN-only no cambia Atest; ninguna previa borrada ni auto-atest.|
|QA24|PASS restaurada por Reanudar ronda→Salir y continuar después. InicioCTA H2. Server active_draft roundIdrrouggse,live,H1dueño5/guest6,H2null,cloudStateVersion494.|
|CLEAN_SESSION|BLOCKED_EXTERNAL: sesión original cerrada después de ACK; pendiente confirmación física de dueño en Safari privado NUEVO. Storage automatizado compartido no se etiqueta limpio.|
|TESTS|Posting18/18PASS; dirigidos545:544PASS/1baselineMiBolsa; full4666:4657PASS/9baseline,0nuevos. Typecheck/Lint/BuildPASS.|
|GIT|Inicio observado0d70689; baselinefuncionald26733f(GPSajeno preservado). Commits0a41fe2,3c81726,da0cf5c,f7a3cc7; documentación posterior.|
|DEPLOYMENT|Código f7a3cc7e2da10faa4c3d9f82e5f7b6a8d22e6986 READY,dpl_F5dQxTcNZtqGPxQ3Uwo9y2epRqFt,healthHTTP200/buildShaexacto; sólo DEV.|
|MANUAL_REVIEW|[Guía](../MANUAL_REVIEW_EL_MONGAS_GHIN.md),[Mapping](GHIN_QA25_ROJAS_EVIDENCE.json),[Historial](evidence/qa25-unified-history.jpg),[QA24](evidence/qa24-restored-h2.jpg).|
|UNRESOLVED|Login privado final pendiente; nueve tests baseline ajenos, sin nuevos.|

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

## REQUEST_BUDGET

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

## Tests baseline

Los nueve nombres finales son exactamente los iniciales:4GPS,3Equipment,
1Rules,1nightlycatalogaudit. Detalle exacto en manifest. No cambios a esas
áreas para maquillar la suite.18pruebas nuevas cubren guards,ownedidentity,
immutablefreeze,date/geometry,golfer/gender,claimconcurrency,ACKreceiptfailure,
uncertainoutcome,verifyoptionalfields,roundtrip,duplicate yeditwithoutrepost.

No cleanup: QA25,receipt,providerrecord/link,6GHIN-only,QA24live ytodoelhistorial
permanecen. main,beta,Production,app.thebackyard.com.mx no fueron tocados.
