# Revisión manual GHIN — el_mongas / QA25 Rojas

Entrar exclusivamente en **https://dev.thebackyard.com.mx** con
**el_mongas@yahoo.com.mx**. Introducir personalmente OTP/credenciales si se
solicitan. No enviar códigos por chat. No borrar evidencia ni cerrar QA24.

**Posting, provider verify y round-trip PASS. Login privado final pendiente.**

1. Abrir una ventana privada **nueva** de Safari. La sesión original del agente
   ya fue cerrada por UI después de todas las confirmaciones canónicas.
2. Inicio: **Continuar ronda · Hoyo 2 de 18**. QA24, La Vista/Blancas, tarjeta
   del club actual. ID `16e2c462-e6c3-4d5d-80d4-b68f6fc25a2d`, local `rrouggse`.
   Entrar sin guardar: H2 pendiente; H1 **dueño5/invitado6**, HCP congelados5/12.
   No cerrar/cancelar/publicar QA24. Salir y continuar después conserva la ronda.
3. Perfil → GHIN: VERIFIED, vínculo `****3351`, Index **30.8**, lectura
   `2026-10-07T00:45:00.494Z`. Un refresh posterior legítimo puede cambiar el Index.
4. Tarjetas GHIN guardadas: **7 tarjetas,1 vinculada,0 requieren revisión**.
   Antes eran6. La nueva: **6oct2026,La Vista,Rojas,103 ajustado**, badge
   **BACKYARD + GHIN**. ProviderID **1208915748**,18h,CR71/slope137,diff26.4,
   course23233/tee106090. Abrir Detalle del provider para comprobar esos valores.
5. Las6históricas siguen GHIN/SOLO LECTURA:

   | ID | Fecha | Tee | Ajustado |
   |---|---|---|---:|
   |902029046|7jun2023|Red / Red|112|
   |899647834|1jun2023|Red|107|
   |888298526|1may2023|Red / Red|116|
   |853907291|6oct2022|Red / Red|122|
   |819244193|21jun2022|Red / Red|129|
   |816066271|12jun2022|Red|126|

   Sus gross/campoID/teeID son null cuando el provider no los devuelve.
   No deben mostrar scores por hoyo, putts/GIR/bets/Atest inventados.
6. Carrera → Rondas → Todo el historial: QA25 aparece **una sola fila lógica**
   con badge BACKYARD+GHIN. ABRIR RONDA BACKYARD abre el original
   `49cd75db-eb6f-47fa-9e0e-b1841ae0f93b`, local `3sygtta5`, versión21.
7. QA25:103,OUT50/IN53,par72,Rojas5476yd,CR71/slope137,GHIN Index congelado30.8,
   Course Handicap36. Sin apuestas, sin auto-Atest. Scores:
   `5,4,6,7,6,5,4,6,7 / 7,6,5,6,6,7,6,4,6`.
8. Las22completadas anteriores siguen Backyard-only. QA21:89; QA23Puebla:86;
   QA22cancelada,20originales y2parciales antiguas conservadas.
9. Carrera → Resumen:23rondas,promedio83.7,mejor71,birdies18. Historial combinado
   cuenta23con gross; QA25 vinculada una vez. GHIN adjusted-only no inventa gross
   ni birdies/putts/GIR/rivalidades/bets. Torneos continúa vacío legítimo.
10. Índice: GHIN principal30.8; **Backyard Index conservado5.5** separado.
    QA25 tiene Index interno desactivado por preferencia existente,
    `INDEX_NOT_ENABLED`; no se forzó elegibilidad ni se mezclaron índices.
11. Atest últimas20: **10/20=50%**, antes11/20=55%. La nueva QA25 pendiente
    desplaza una atestada fuera de esa ventana. Las11atestaciones previas siguen
    guardadas; importar GHIN no cambió Atest ni auto-atestó QA25.
12. Perfil → Publicar tarjeta en GHIN · QADEV → Ver rondas para revisar → QA25 →
    Validar sin publicar: **ALREADY_POSTED**,ID1208915748. Segundo providerPOST0.
    No publicar otras tarjetas: esta corrida autorizó una sola publicación.
13. Matches ambiguos0. No fusionar por nombre ni modificar snapshots históricos.
    Bets,grupos,frecuentes e historial previo permanecen. No cleanup.

Manifest: [GHIN_EL_MONGAS_FINAL.json](qa/GHIN_EL_MONGAS_FINAL.json).
Reporte: [GHIN_EL_MONGAS_REPORT.md](qa/GHIN_EL_MONGAS_REPORT.md).
Mapping: [GHIN_QA25_ROJAS_EVIDENCE.json](qa/GHIN_QA25_ROJAS_EVIDENCE.json).
[Historial](qa/evidence/qa25-unified-history.jpg),
[QA24H2](qa/evidence/qa24-restored-h2.jpg).

Pendiente: confirmación física de sesión privada nueva. El browser automatizado
comparte storage y no se presenta como contexto limpio. Nueve fallos baseline
ajenos permanecen; cero nuevos. main,beta,Production y su dominio no fueron tocados.
