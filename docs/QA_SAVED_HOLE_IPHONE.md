# QA — captura guardada y UX iPhone

Fecha: 2026-09-03. Rama exclusiva: `codex-dev`.

## Recuperación y alcance

Se conservaron los 13 archivos de la pasada interrumpida; no hubo reset, cambio de rama ni recuperación desde una versión anterior. Base recuperada: `918b2de3fcae899cd730032c0fd4604d0b0d76be`.

Implementación: `a440f6f2a21df249c1a65331af3775c7f69666e3`.
Preview de código probado: `dpl_F89a8Yzhg4Rj4LaPZb6PHuYJoNXY`, READY.
URL estable: https://beta.thebackyard.com.mx

No se modificaron `lib/engine.ts`, `lib/personal-nassau.ts`, los fixtures Personal autoritativos, Auth, Supabase ni Polla Live. No se tocaron main, Production, dominio o migraciones remotas.

## Cambios exactos

| Archivo | Cambio |
| --- | --- |
| `app/page.tsx` | Captura por hoyo separada de scores oficiales, persistencia/Undo del borrador, PAR individual, Guardar confirma el hoyo, resumen con datos recién guardados, cierre seguro del último hoyo; quita Confirmar Par y selector Foursome legacy; simplifica parejas/presión y agrega escalas de tarjeta. |
| `lib/score-capture.ts` (nuevo) | Resolución de Par/captura/score previo y confirmación inmutable de una sola fila. Vacíos explícitos permanecen vacíos y no se guardan como scores válidos. |
| `lib/foursome-config.ts` (nuevo) | Presión efectiva compatible con flags anteriores; Sin presión limpia la vuelta y neutraliza el flag antiguo. |
| `app/components/foursome-live.tsx` | Dos equipos con acumulados opuestos, hoyo actual y acumulado sin duplicados; detalles económicos plegados; edición sin guardar claramente identificada. |
| `app/components/personal-compact.tsx` | Live compacto con Match, Medal, neto y acceso al detalle profundo. |
| `app/components/rules-panel.tsx` | Secciones independientes inicialmente cerradas; IA, reglamento, comité, aclaraciones, locales contextuales, caballeros, documentos, videos; búsqueda y regreso conservados. Dictado parcial/final sin concatenación duplicada. |
| `lib/speech-dictation.ts` | es-MX, inicio por gesto directo, parciales, fin sin borrar transcript, watchdog incluso tras onstart, mensajes recuperables y foco al input. |
| `app/components/internal-pdf-viewer.tsx` | Visor interno primero; tiempos máximos de carga/render, canvas roto oculto, reintento, enlace oficial siempre disponible y Regresar. |
| `lib/pdf-viewer-utils.ts` (nuevo) | Deadline de promesas y límite de píxeles del canvas para reducir presión de memoria móvil. |
| `app/functional-ux.css` | Controles compactos, resumen legible, Live reducido, acordeones, scroll de tarjeta y escalas 75/90/100%, landscape sin bloquear zoom nativo. |
| `tests/iphone-capture.test.ts` (nuevo) | 18 regresiones nuevas de captura, Excel/legacy, presión, parejas, Live, resumen, reglas, PDF, micrófono y landscape. |
| `tests/functional-closure.test.ts` | Actualiza expectativas estructurales del flujo de captura; conserva regresiones anteriores. |
| `tests/rules-navigation.test.ts` | Actualiza expectativas de acordeones/fallback; conserva búsqueda y reglas contextuales. |

## Cobertura del prompt (23 secciones)

1–3: método Excel automático para rondas nuevas, snapshots legacy conservados, selector eliminado, presión neutralizada y parejas simples. Verificados con tests y UI Preview.

4–6 y 10: Par en inputs nuevos, +/− y PAR individual, sin Confirmar Par global. Los motores reciben únicamente scores guardados. Verificados con UI y fixtures; H1/H10 y 9/18 cubiertos en tests.

7–9: resumen legible, X y timeout con avance único; Foursome y Personales compactos con detalle retenido. Verificados visual y funcionalmente.

11–14: orden y acordeones de Reglas, buscador dentro del reglamento, locales solo contextuales y caballeros separados. Verificados en Preview.

15–16: robustez/fallback PDF y dictado implementados. Límites externos y físicos detallados abajo; no se declara Safari real probado.

17 y 19: medidas reales 390×844, 430×932 y 844×390 en Chrome headless, screenshots inspeccionados. Scroll/zoom de tarjeta, controles y resumen revisados. Esto no emula el sistema de permisos/teclado de Safari físico.

18: configuración oficial de Toolbar investigada; ajuste externo pendiente, sin hacks en CSS.

20–21: historia conservada, corrección sin duplicados y regresiones Personal intactas.

22–23: suite ampliada, lint/build/diff-check y Preview del commit de código verificados.

## Evidencia funcional del Preview

- Ronda sintética de 18 hoyos, 4 jugadores QA, HCP 0/4/8/12, La Vista, scores Par guardados mediante UI en H1–18. Hoyo nuevo no contribuye a resultados hasta Guardar.
- H1 todos 4: antes de guardar, sin hoyos oficiales; después, Foursome QA Said/QA Carlos −2 y QA Flavio/QA Javier +2. H2 conserva ese acumulado mientras está pendiente.
- + cambia 4 a 5 y PAR devuelve 4. Borrar/guardar inválido está cubierto en tests. Volver a un hoyo existente no repone Par sobre su score guardado.
- Ronda completa: QA Said −1600, QA Carlos −1600, QA Flavio −1200, QA Javier +4400; transferencias suman 0. Foursome acumulado −16/+16. Se guardó H18 y apareció “Ronda guardada ✓”.
- El histórico previo de 9 hoyos permaneció en −1450. Recargar conservó ambas rondas. Corrección explícita de la nueva ronda cambió H18 de QA Said de 4 a 5 tras confirmar sobrescritura, y siguieron existiendo exactamente 2 rondas (no se duplicó).
- En otra sesión local aislada, H1 guardado y H2 editado sin guardar sobrevivieron a recarga. Cambiar Foursome fijo de 200 a 250 mediante Editar configuración conservó H1 oficial y el borrador de H2.
- Detalle Personal → Regresar volvió al mismo hoyo. Browser Back desde una subregla conservó `cart path` en búsqueda. Browser Back desde PDF devolvió Documentos oficiales abierto.
- “Copiar resumen” mostró confirmación. El puente de clipboard del navegador integrado devolvió vacío, por lo que no se declara verificación E2E del contenido del portapapeles; generación del texto sigue cubierta en la suite.
- Búsquedas reales: `cart path` devolvió Regla 16/16.1 y referencias Comité (130 coincidencias con Mostrar más); `16.1` incluyó Reglas, Aclaraciones y Comité; `área penalidad` y `area penalidad` dieron los mismos primeros resultados. Las 25 reglas permanecen disponibles.
- Reglas locales no apareció sin ronda; apareció para la ronda La Vista, en modo lectura. Se mantuvo la playlist exacta indicada por el usuario.
- El navegador aislado no reportó errores JavaScript no manejados durante el recorrido. No se invocó la IA para búsquedas locales.

## PDFs: estado real por documento

| Documento | Resultado de esta prueba |
| --- | --- |
| Parte 1 | La descarga de la fuente USGA devolvió HTTP 403 en Chrome de QA; no se pudo acreditar render interno en ese entorno. Mostró mensaje, Reintentar, Ver documento oficial y Regresar; canvas roto oculto. |
| Parte 2 / Comité | Mismo bloqueo HTTP 403 de la fuente USGA; fallback visible y Regresar probados. No se declara PDF interno funcionando en este entorno. |
| Aclaraciones julio 2026 | Render interno real, 13 páginas; página 2 y zoom probados a 430×932, screenshot inspeccionado y regreso seguro. |

No se subieron PDFs originales ni se inventaron fuentes. Los enlaces de Parte 1/2 apuntan a sus PDFs oficiales USGA; el fallback no garantiza superar una respuesta 403 del proveedor. Falta confirmar su apertura desde el iPhone real. No se intentó eludir controles del sitio oficial.

## Micrófono y pruebas físicas pendientes

La prueba de navegador real devolvió permiso denegado, presentó instrucciones humanas y enfocó el buscador. Los tests verifican eventos parciales/finales, es-MX, onend sin pérdida y fallback por ausencia de transcript. No se simuló un éxito de voz real ni se probó un iPhone físico.

En Safari/PWA deben comprobarse permiso concedido → voz → transcript, dictado del teclado como fallback, teclado/safe areas reales y pinch-to-zoom. El viewport no limita maximumScale ni userScalable.

## Toolbar: acción externa exacta

Ruta oficial: **Vercel → proyecto Golf-Bets → Settings → General → Vercel Toolbar → Preview → Off**. Dejar Production sin cambios.

Alternativa limitada a esta rama: variable `VERCEL_PREVIEW_FEEDBACK_ENABLED=0` en **Settings → Environment Variables → Preview / codex-dev**, efectiva en el siguiente deployment.

Fuente: https://vercel.com/docs/vercel-toolbar/managing-toolbar

No se cambió configuración remota ni se ocultó Toolbar desde la aplicación.

## Validación automática

- 331 tests: 331 aprobados, 0 fallidos (18 nuevos; no se eliminaron tests).
- Regresiones autoritativas: Carlos −600; José Juan −200; Flavio +800; Javier −800; total Said −800. También pasan a través de 18 confirmaciones de captura, con suma cero.
- `npm run lint`: 0 errores / 0 warnings.
- `npm run build`: correcto.
- `git diff --check`: correcto.
- Tests con mocks/inspección estructural se distinguen de las pruebas UI de Preview descritas arriba; no acreditan hardware iPhone ni una sesión cloud real.
