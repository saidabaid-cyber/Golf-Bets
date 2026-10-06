# Revisión manual GHIN — el_mongas

Usar exclusivamente **https://dev.thebackyard.com.mx** e iniciar sesión como
**el_mongas@yahoo.com.mx**. Esta cuenta conserva toda la evidencia QA anterior.
No borrar rondas/importaciones, cerrar QA24 ni publicar tarjetas para superar un bloqueo.

## Resultado real actual

**Importación PASS; ciclo completo POSTING_BLOCKED_MAPPING, no DONE.**
El usuario renovó GHIN manualmente. Se consultaron seis tarjetas oficiales y
se importaron mediante el flujo normal. La segunda importación agregó **0**.
Hay **6 GHIN-only**, **22 completadas Backyard-only**, **0 vinculadas** y
**0 ambiguas**. **0 publicaciones** upstream.

- GHIN VERIFIED: vínculo enmascarado `****3351`.
- Handicap Index GHIN observado: **30.8**, sync `2026-10-06T22:13:02.411Z`.
- Backyard Index: **5.5**, independiente.
- Atest: **11/20 = 55%**, independiente de GHIN.
- 22 completadas Backyard, QA22 cancelada, QA24 live H2 y dos parciales antiguas.
- Auditoría posterior: **26/26 snapshots/versiones/scores intactos**.
- GHIN-only tienen adjusted gross. Gross/campo ID/tee ID son **null**.
  No se presentan adjusted scores como gross ni se fabrican estadísticas.

## Recorrido de revisión

1. Abrir una **sesión privada nueva** en DEV e iniciar sesión con el_mongas.
   Introducir personalmente el OTP si se solicita; no enviarlo por chat.
   La certificación limpia previa fue antes del import. Falta confirmar esta
   sesión posterior con las seis tarjetas nuevas.
2. Perfil → GHIN: comprobar VERIFIED, Handicap Index **30.8**, última actualización.
   Una futura actualización legítima puede cambiar ese valor; no imponerlo.
3. Carrera → Resumen/Índice: comprobar GHIN como fuente principal y
   **Backyard Index conservado 5.5**, sin mezcla ni promedio.
4. Perfil → “Ver scoring record” consulta al provider. “Sincronizar tarjetas GHIN”
   persiste información oficial privada. Ya se ejecutaron **dos** sincronizaciones;
   no hace falta repetirlas para esta revisión.
5. Scoring record antes de import: **6**. Provider scores persistidos antes: **0**.
   Después de import: **6**. GHIN upstream no recibió tarjetas nuevas.
6. El resumen de la segunda sincronización fue **0 nuevas, 0 vinculadas,
   0 requieren revisión**. El total guardado permanece **6**, sin duplicados.
7. En “Tarjetas GHIN guardadas”, comprobar las seis tarjetas:

   | ID GHIN | Fecha | Tee | Ajustado |
   |---|---|---|---:|
   | 902029046 | 7 jun 2023 | Red / Red | 112 |
   | 899647834 | 1 jun 2023 | Red | 107 |
   | 888298526 | 1 may 2023 | Red / Red | 116 |
   | 853907291 | 6 oct 2022 | Red / Red | 122 |
   | 819244193 | 21 jun 2022 | Red / Red | 129 |
   | 816066271 | 12 jun 2022 | Red | 126 |

   Campo devuelto: “La Vista Country Club | La Vista”, duplicado como texto
   de dos lados para Red / Red. Se conserva la información recibida.
8. Cada una debe mostrar **GHIN / SOLO LECTURA**. Abrir “Detalle del provider”
   en la primera: ID 902029046, ajustado 112, diff 33.8, 18 hoyos, CR 71, slope 137.
   No debería mostrar gross, scores por hoyo, putts/GIR/bets/Atest inventados.
9. En Carrera → Rondas, seleccionar todo el historial: las seis GHIN se ordenan
   por fecha real después de las Backyard de 2026. Revisar también Histórico
   si se accede desde las tarjetas/acciones existentes.
10. No existe una ronda publicada en este checkpoint. **BACKYARD + GHIN = 0**
    es el resultado real; no buscar un provider ID de posting inexistente.
11. Posting permanece apagado: ninguna completada tiene course + tee
    CONFIRMED para sus IDs congelados. Las seis oficiales no proporcionan
    IDs suficientes y sus tees Red no confirman Blancas/Doradas.
    No intentar publicar otra ronda a ciegas.
12. Dedupe de import: cada uno de los seis IDs debe aparecer una sola vez
    por vista. No confundir su aparición en Perfil y Carrera con una duplicación
    de registros. No se fusionaron por nombre con las 22 de 2026.
13. Carrera → Resumen conserva **22 completadas**, promedio gross **82.8**,
    mejor **71**, birdies **18**. GHIN ajustado-only no se convierte en gross.
14. Logros conserva **5/7**; Rivalidades **25 enfrentamientos** Backyard.
    GHIN no añade rivales, birdies/putts/GIR ni apuestas. Torneos permanece
    **0 / estado vacío real**.
15. Atest conserva **55%, 11/20**, con tarjetas GHIN aparte de las últimas
    20 Backyard. GHIN sólo lectura no certifica ni altera Atest.
16. Inicio muestra **Continuar ronda · Hoyo 2 de 18** para QA24.
    ID `16e2c462-e6c3-4d5d-80d4-b68f6fc25a2d`, local `rrouggse`,
    La Vista / Blancas (el CTA conserva el texto actual “Par 72 — Tarjeta del club — Actual”),
    H1 **5/6**, H2 pendiente, versión **4**. No cerrarla, cancelarla ni publicarla.
17. **MATCH_REVIEW_REQUIRED = 0**. Si una futura sincronización produce
    ambigüedades, conservar ambas entradas hasta revisión; nunca forzar match
    por nombre. Las 22 completadas siguen Backyard-only en esta importación.

## Qué permanece pendiente

- Confirmación posterior a import en sesión privada nueva, sin reutilizar
  el storage de la sesión del agente.
- Campo y tee GHIN **CONFIRMED** de un candidato completed elegible.
- Dry run → post real → verify provider → reimport same round → segundo
  intento bloqueado. Ninguna de esas etapas upstream se ejecutó por falta
  de mappings; los tests locales no sustituyen esa prueba.
- CSS corregido verificado en DEV, build
  `f3de6341e78f3127ce5b6b6dab6c2b7846ad8d08`, READY/health 200.
  Ancho efectivo del navegador 573 px: no se afirma prueba física de iPhone.
  Confirmar durante la revisión privada que “Ajustado” no se encima con GHIN.

Las seis provider cards viven en servidor privado y quedan guardadas.
No hubo cleanup, cambios de scores ni nuevas rondas.
No se declara PASS del ciclo GHIN completo.
