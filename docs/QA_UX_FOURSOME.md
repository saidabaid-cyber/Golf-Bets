# QA — UX, Foursome y cierre funcional

Base verificada, árbol limpio: `codex-dev`, HEAD `c18f992470f53f93043ba414a2e89605eeaf6909`. Sin reset, merge, modificación de main ni agentes paralelos.

## Cobertura del encargo (21 secciones)

| Sección | Evidencia / estado |
|---|---|
| 1 Editar activa | Home y Tarjeta abren configuración; conservaron los cinco scores deH18 tras cambiar fijo200→250. Cambios de campo/Par/SI, salida, longitud, integrantes/grupo explican efecto y requieren confirmación cuando hay scores. |
| 2 Navegación | Historial interno de pantallas/scroll y navegador Back. Verificado hoyo→Personal→hoyo, Resultados→Personal→Resultados, histórico rival→regresar con filtro Este mes, PDF→Reglas, subregla→búsqueda conservada. No se declara probado cada menú de Auth/Polla, no modificados. |
| 3 Foursome Excel | Método explícito Excel con rebasing entre integrantes, ROUND a una décima y umbralesSI/SI+18; Low/High y liquidación uniforme. Referencias exactas y variantes no equivalentes en EXCEL_BETTING_REFERENCE.md. |
| 4 Scores reales | Auto-Par retirado; nuevo H10 vacío y captura parcial mostraron Esperando scores. Confirmar Par registra explícitamente. H11 volvió vacío, acumulado+1 conservado. |
| 5 Live | Ambos equipos con valores opuestos, hoyo actual separado del acumulado; probaron +1/−1 y espera parcial. En ronda18, quitar CarlosH18 retiró solo el resultado de ese hoyo de sus tres matches. |
| 6 Personal compacto | Tarjetas por rival en el hoyo; detalle separado con seis componentes, gross, golpes, netos, carry, presión, brutos y neto. |
| 7 Carry | Create/edit y plantillas conservan campo; cuatro apuestas editables mostraron Carry Sí. Tests anteriores de plantillas y migración siguen pasando. |
| 8 Resultados | Resultado final y resumen arriba; valores y detalle Foursome plegables. Menos espacio, sin quitar el resumen por jugador. Contraste del total corregido tras observarlo en captura real. |
| 9 Cantidades | Bloques pequeños Jugados; conteos calculados sin cambiar carry final no cobrado. |
| 10 Copiar | Clipboard real comprobado: nombre del campo, fecha México, todos los balances; mensaje Resumen copiado. Fallback seleccionable si clipboard falla. |
| 11 Personales resultados | Tabla1ª/2ª/18 firmada desde dueño, conserva cuatro resultados exactos y enlace al detalle. |
| 12 Micrófono | Gesto sin await previo, detección estándar/WebKit, start/result/error/end, watchdog, stop conservando resultado final y cleanup. En navegador integrado real expone API pero no inició reconocimiento; watchdog mostró error y búsqueda escrita siguió funcionando. NO se certifica dictado físico en iPhone. |
| 13 Búsqueda | Todo el índice, subreglas y páginas de tres fuentes; sin tope silencioso12/18/24. UI muestra total y paginación20. Acentos/espacios/sinónimos; búsqueda7.3 ya no promueve17.3. Se evita heredar palabras del padre a subreglas no relacionadas. |
| 14 PDFs | PDF.js canvas interno, página, zoom, texto accesible y regreso; fuente íntegra bajo endpoint propio. Los tres existen localmente. En build producción, los tres endpoints devolvieron200/application/pdf obtenidos de USGA/R&A (sin PDFs locales). |
| 15 Listas | Reglas Locales y Caballeros compactos, separados y solo lectura. |
| 16 Histórico Personal | Rondas distintas, neto del principal, wins/losses/ties por neto. Duplicados deID se deduplican. Dueños distintos no mezclan balances. Filtros conservados al volver del detalle. |
| 17 Terminar | Último hoyo termina/guarda después del resumen y confirma Ronda guardada✓. Snapshot2 agrega parejas/segmentos, balances y detalle de motores. Recarga y reapertura confirmadas. |
| 18 Corrección histórica | Confirmación, copia editable, mismoID, upsert, updatedAt, foto conservada; cancelar no cambia histórico. Abrir y corregir una ronda completa recuperó90 scores, valores y segmentos. Borrar Personal también retira configuración para no resucitarla al corregir. |
| 19 Regresiones |18 pruebas nuevas:262 totales frente a244 iniciales, ninguna eliminada. Fixtures de Excel, cuatro Personales, persistencia/duplicados/borrado, edición, copia, búsqueda y dictado. Algunas pruebas de enlaces son estructurales y se complementaron con navegador. |
| 20 Conservación | Detalle Foursome y resumen conservados. Auth/Supabase/Polla Live sin cambios; Monkey/Copa/carrySkins y suite previa pasan. No se afirma nueva prueba física de servicios externos. |
| 21 Validación | npm run lint:0 errores/advertencias. npm test:262 aprobados,0 fallidos. npm run build:Next16.3.3 correcto. Push autorizado solamente codex-dev; resultado Preview se informa después de verificar Vercel. |

## Evidencia funcional de navegador

Origen QA `http://localhost:3001` (proxy al dev3000) aislado del localStorage del usuario en3000. No se borraron sus datos. Se verificaron tamaños reales de viewport390×844 y430×932; PDF también en desktop1280×720. Tablas conservan scroll propio y no desbordan el documento. No emula el motor WebKit ni teclado físico de iPhone.

### Ronda18 del fixture real

- Se abrieron/corrigieron90 scores y SI originales del caso Personal. HCP públicos0 en esta ronda QA; ventaja Personal directa12/5/5/7.
- Said/Carlos:−600; Said/JoséJuan:−200; Said/Flavio:+800; Said/Javier:−800. Total Personal deSaid:−800.
- Brutos respectivos:100/700,200/400,800/0,0/800. DetalleFlavio mostró Medal2ª300=200presión+100carry; Match2ª200 sin carry.
- Cambio activo fijo200→250 no borróH18:[5,4,5,5,6]. Valores combinados de la ronda QA: Said+60, Carlos+9070, JoséJuan−2430, Flavio−4150, Javier−2550; suma0. No son valores cacheados del Excel.
- Guardar corrección reutilizó la ronda (seguían dos rondas); cancelar previamente mantuvo importes anteriores. Recarga y cerrar/reabrir recuperaron snapshot, scores, parejas y ajustes. Corrección no reemplaza histórico hasta guardar expresamente.

### Ronda nueva9, salidaH10

- Cuatro jugadores, HCP0, FoursomeExcel fijo200, parejasSaid/Carlos contraFlavio/Javier; segmentosH10–15/H16–18.
- H10 Par5: cuatro inputs vacíos; Said4 solo todavía sin resultado. Confirmar pars faltantes:[4,5,5,5] → +1/−1. Timeout avanzó solo aH11, cuatro vacíos y acumulado+1. X avanzó exactamente un hoyo en los siguientes.
- H11–18 confirmados enPar mediante botón, nunca por autofill. H18 no avanzó aH19; terminó, guardó y mostró Resultados.
- Final Said+950, Carlos−50, Flavio−450, Javier−450; suma0. Conejo1, Skin1 (carry final no cobrado), unidad1. ResultadoFoursome+200/+200/−200/−200.
- Recargar mostró tres rondas: las dos anteriores intactas y la nueva9H10 guardada. CopyResumen comprobado leyendo clipboard real.

### Reglas / documentos

- Búsquedas por UI:cart path,16.1,7.3,área penalidad,AREA  PENALIDAD. Regla16.1 abrió y regresó conservando query. La suite además cubreOB,drop,bola provisional,bola injugable,aspersor y fuentesComité/Aclaraciones.
- PDFParte1:410páginas; render y cambio a página15 observados dentro deapp a430×932. Comité:172páginas. Aclaraciones:13páginas, render a390×844, zoom y siguiente; browserBack cerró visor y regresó aReglas.
- Buildlocalproducción3002 (no deployment): GETParte1=200,13,566,580bytes; Parte2=200,5,186,675bytes; AclaracionesR&A=200,316,707bytes. Copia localAclaraciones314,785bytes, misma edición identificada1jul2026; no se exige identidad binaria entre archivos USGA/R&A.
- Sin llamadas automáticas OpenAI por búsqueda. No se reindexó Vector Store ni se añadieron PDFs al repositorio.

## Límites reales / revisión pendiente

1. **iPhone físico**: dictado/permisos/Siri, resultado de voz, Safari/PWA, zoom/táctil PDF y teclado/safearea requieren dispositivo. El navegador integrado no produjo transcript; se verificó salida controlada, no reconocimiento exitoso.
2. **Excel no representable**: importes individuales por jugador/factor completo, Fantasma y presión/tamaños no6 no equivalen1:1 al libro. Se conservan extensiones aprobadas con pruebas. Método configurable legado no se vende como Excel.
3. **Datos antiguos**: no se puede distinguir auto-Par previo de captura real porque no existía marcador. Se preservan números, no se borran automáticamente. Históricos sin segmentosFoursome no se recalculan inventando parejas; quedan de solo lectura.
4. **Preview**: confirmar READY y probar URL luego del push. Si Vercel exige autenticación, no desactivar protección ni declarar probado su interior sin sesión.

## Fuentes técnicas consultadas

- [WebKit Safari14.1 — reconocimiento de voz/Siri](https://webkit.org/blog/11648/new-webkit-features-in-safari-14-1/)
- [WebKit239816 — API expuesta en WKWebView sin reconocimiento operativo](https://bugs.webkit.org/show_bug.cgi?id=239816)
- [PDF.js ejemplos oficiales de render canvas](https://mozilla.github.io/pdf.js/examples/)

Las skills de Next, hojas de cálculo y PDF guiaron trazabilidad/formato y compatibilidad; las guías de navegador y Vercel se usan para comprobar UI y Preview. No se interpreta un testmock como prueba de micrófono físico.
