# Referencia del Excel original — análisis previo a cambios del motor

## Fuente y alcance

Archivo recibido: `1-Apuestas-2024.xlsx` (denominado por el usuario «Apuestas 2024 Armando.xlsx»). SHA-256: `2e084174b57447ca56d0a8cc59b6f9c8b0f30fef6c1523776e6b6e56552174cf`. Conservado fuera del repositorio. No se publica ni se modifica.

Base de comparación de la app: `3e6da095c798b1b5de6623d0f85da936707ff07c`, rama `codex-dev`.

Se importó el libro y se extrajeron las 7 hojas, sus valores, referencias y **30,195 fórmulas**, incluidas las fórmulas compartidas con referencias relativas expandidas. Hojas: Comienzo (122 fórmulas), Jugar (5,114), R J2/R J3/R J4/R J5 (623 cada una), Cálculos (oculta, 22,467). No hay vínculos externos. La extracción privada está en `tmp/excel-reference/`, ignorada.

El archivo recibido es una plantilla sin los scores de la ronda de La Vista Temporary. Los cuatro casos de esa ronda provienen de los datos explícitos del usuario, no de valores cacheados del libro. No se presenta un recálculo de Excel completo como si hubiera ocurrido.

## Trazabilidad por modalidad

| Modalidad | Origen real | Regla trazada | Comparación con la app base |
|---|---|---|---|
| Ventaja directa Personal | Comienzo G3:G6; Cálculos K7, B1089:C1090, H1073:H1075 | El signo elige receptor; valor absoluto asigna un golpe si ventaja ≥ SI, otro si ≥ SI+18. No depende del HCP publicado. | Coincide para ventajas enteras usuales. |
| Match Personal | Cálculos H1091:H1092, AI/BK/BL; L1097, L1099, L1101 | Comparación neta por hoyo +1/0/−1, acumulados de primera/segunda vuelta jugada y total. | App separaba mitades físicas: corregir para salida H10. |
| Medal Personal | Cálculos H1093, AI/BK/BL; L1098, L1100, L1102 | Diferencia de sumas netas por segmento; importe fijo al ganador, no dinero por golpe. | Comparación correcta; misma corrección de orden. |
| Carry/Presión Personal | Cálculos L1099:L1100; P1097:P1098 → Jugar O182:O183 | El Excel duplica si primera empata **o** hay presión. Sus IF no suman ambos. Match y Medal independientes. | App no implementaba carry. **La instrucción explícita nueva prevalece:** segunda = base × presión + base empatada, por componente. Con $100: $300, no $200. Total18 separado a base. |
| Liquidación Personal | Cálculos L1103; reportes R J2–R J5 | Suma de importes con signo (equivalente a bruto de cada lado y compensación). | Exponer ambos brutos y neto; verificar casos reales. |
| Foursome | Cálculos E33:K34; D193:G197; D228/I228/N228; J271:J277 | Low Ball contra Low Ball + High Ball contra High Ball; cada comparación SIGN, suma −2…+2. Gana fijo por signo del total del segmento. | Algoritmo LB/HB coincide; contrastar matrices económicas. |
| Patada | Cálculos D235:M250, J271/J275/J276; segunda tabla L299:M299/J320 | Puntos del segmento × valor de patada; pagos entre contrarios con MIN de sus valores y factor W28 (.5 en el archivo). | Equivale a modo puntos/fijo+puntos con importes uniformes y pago mitad (.5). La app no ofrece el factor completo ni valores individuales del Excel. |
| HCP Foursome | Comienzo M31/U31; Cálculos G99, E34, D36:D37; AB194/AB211 | El control % se refleja en G99, pero los scores efectivos de tabla1 usan **E34 sin %**. Tabla2 rebaja contra los cuatro elegidos mediante AA211:AA215/AB211. | Cerrado para la variante representable: método explícito `excel` reproduce tabla2, sin % ni golpes fraccionarios. Método `configured` conserva acuerdos y borradores previos; no se denomina equivalencia Excel. Véase cierre UX abajo. |
| Skins | Cálculos K99; M99:P99; D922:AG926; E991:F993 | HCP rebajado × %. Enteros primero, fracción desempata; carry suma hoyos sin ganador único; se paga solo al ganador único. | Comparar selección fraccionaria y acumulación con fixtures derivados. Carry final sin ganador no se paga. |
| Conejos | Cálculos F99; D758:AG762; E848:I869 y bloques siguientes | Ganadores netos alimentan Libre/Agarra/Mantiene/Gana; ganar en segunda posición reinicia ciclo. Si no se cobra al cerrar ciclo de tres se acumula. E848:E852 contienen **solo candidatos ganadores**, no todos los nombres. | Máquina actual compatible en estructura; probar secuencias desde fórmulas, no confundir columnas candidatas con participantes. |
| Bola Amiga | Cálculos A111:C125/D112:D113; D108:D109; M129:AC129; AD167; filas1523:1526 | HCP rebajado × S6; V6=Sí compara con SI−.5 (redondeo .5 arriba). Dos scores ajustados, cap9. Birdie gross invierte dígitos del contrario. | Coinciden cap, inversión y pago uniforme en fixture derivado. Excel permite valores individuales con liquidación ponderada MIN, no disponible en app. |
| Unidades | Jugar E/F de cada hoyo; Cálculos N1561, D1568:H1572 | Captura manual; cada positivo cobra a cada rival MIN de sus valores. | Coincide con importe uniforme; no hay fórmula de auto Birdie/Eagle/HIO en el libro. Automatismos aprobados de app no se afirman contrastados contra Excel. |
| Copas | Cálculos Q1542:U1556, S1552 y diagonal | Captura separada; quien registra copa paga a cada rival. Valor/participación separados de Unidades. | Corregido valor independiente `units.copaValue`; ausente hereda valor unitario antiguo. Solo eventos etiquetados Copa usan ese valor. Participantes siguen compartidos con Unidades; importes individuales por jugador no se implementaron. |
| Monkey | Comienzo I16/L16; Cálculos P34:T34, E1447:E1452, F1459 y L1491:M1493 | Tres jugadores. Por cada rival: 2 puntos al ganarle, 1 al empatar, 0 al perder. Liquidar diferencias de puntos por pares × valor. | Implementado desde estas fórmulas, incluyendo HCP rebajado SI/SI+18, sin % añadido. Configuración opcional y desactivada para datos antiguos; live, Cómo Vamos, Resultados e histórico. No es Fantasma. |
| Pollas / Mini Polla | Sin fórmula/etiqueta en ninguna de las siete hojas | No existen en este archivo. | Conservar reglas previamente aprobadas; no afirmar validación Excel. |

## Límites y defectos del archivo fuente

- Foursome del libro contiene tres segmentos de 6; 3/9/18, presión física y Fantasma son extensiones de la app, no fórmulas verificables 1:1 aquí.
- HCP/score sin capturar de la plantilla produce errores cacheados `#VALUE!` en AB211/AB399/AB587. Nombres definidos Fivesome/Names apuntan a `#REF!`.
- I852:I853 conserva `#REF!` a un estado anterior inexistente; en el arranque normal I848=1 las ramas rotas no se evalúan. No trasladar referencias inválidas al motor.
- El libro limita algunas asignaciones a dos golpes (SI y SI+18). La app soporta HCP más altos; no reducir esta capacidad sin una regla expresa.
- Comienzo H38 calcula HCP de campo con índice×slope/113+(rating−par); H39 aplica F39 (80%). Es una calculadora auxiliar, no un enlace automático a todas las apuestas.

## Casos reales obligatorios (fuente: usuario)

Todos base100, presión2 en segunda vuelta jugada, carry independiente activado. SI y scores íntegros en `tests/fixtures/personals-real.ts`.

| Rival | Ventaja | Match 1/2/18 | Medal 1/2/18 (a favor Said) | Bruto Said / rival | Neto Said |
|---|---|---|---|---|---|
| Carlos | Carlos da12 | 0/−1/−1 | +1/−3/−2 | 100/700 | −600 |
| José Juan | Said da5 | +1/−1/0 | +1/−1/0 | 200/400 | −200 |
| Flavio | Said da5 | +1/+1/+2 | 0/+4/+4 | 800/0 | +800 |
| Javier | Said da7 | 0/−1/−1 | −1/−4/−5 | 0/800 | −800 |

Neto Said conjunto: **−800**. Transferencias de los cinco jugadores: suma cero.

## Compatibilidad prevista

Carry ausente en apuestas antiguas = desactivado, para no introducir obligaciones nuevas silenciosamente. Nuevas apuestas guardan versión Nassau2. Al migrar un borrador antiguo de 18 hoyos con salida H10 se intercambian los interruptores de las dos vueltas para conservar los hoyos físicos antes seleccionados; después las claves 1/2 siempre significan orden jugado. La presión Personal se aplica a segunda vuelta jugada conforme a la regla nueva. Snapshots históricos/importes liquidados no se migran ni recalculan.

## Validación y cierre

Pruebas nuevas en `tests/excel-reference.test.ts`: traducción independiente del desempate decimal (2,160 combinaciones), carry Skins, estados Conejos, cinco resultados LB/HB, fijo+Patada, cap/inversión Bola Amiga, Unidades/Copas y Monkey. Todas esas comparaciones pasaron. No son un recálculo íntegro en Microsoft Excel.

Los cuatro casos Personales fallaron primero contra la app base (Carlos −500, Flavio +700, Javier −700 para Said); luego pasaron con los resultados exigidos. Juan ya coincidía. Se actualizó el test antiguo que exigía presión física en Personales porque contradice la nueva instrucción explícita. Foursome mantiene presión física.

### Revisión funcional en navegador

- Origen QA `http://localhost:3001` separado del storage del usuario en3000. Proxy local al servidor Next existente, sin cambios de configuración publicados.
- Captura manual automatizada por UI de los90 scores, SI real y Par69 verificados en editor.
- Apuestas activas: Conejos, Skins, Unidades, Foursome (3 segmentos/9 matches), Monkey y los4 Personales. Gross finales:82/68/87/91/84.
- Recarga trasH9, continuarH10, completarH18, guardar histórico, cerrar/reabrir:90 scores y carry conservados; histórico previo sigue presente.
- Personales en pantalla: Said/Carlos−600; Said/José Juan−200; Said/Flavio+800; Said/Javier−800. Brutos100/700,200/400,800/0,0/800.
- Ronda de QA con HCP publicados0 (ventajas Personales directas): totales de todas las apuestas Said−340, Carlos+8670, José Juan−2130, Flavio−3900, Javier−2300. Suma0. Estos totales combinados son evidencia de integración, no resultados cacheados del Excel original.
- Monkey: puntos27/58/23, balances−540/+1320/−780; visible en resumen e histórico.
- Resumen H1 avanzó por timeout una vez; X avanzó un hoyo en los siguientes; H18 terminó en Resultados. Se corrigió otro bug: resumen Skins usaba `count`=0 en empates; ahora muestra carry pendiente1 enH1 del fixture.
- 390×844 y430×932: contenido/inputs legibles, sin overflow horizontal del documento (tablas con su scroll propio), consola sin errores. No sustituye prueba física de Safari/iPhone.

### Diferencias todavía abiertas (NO certificadas como equivalencia total)

1. Foursome: el %/redondeo visible del libro no alimenta sus scores de tabla1. La continuación UX implementa literalmente tabla2 como método `excel`; el método configurable previo permanece disponible y explícitamente diferenciado. El rebasing por match corresponde al mecanismo de tabla2, no a usar ciegamente todos los jugadores de tabla1. No se atribuye el método configurable al libro.
2. Excel admite importes por jugador y factor pago completo/mitad en matrices; la app usa importes uniformes y la convención mitad validada. No afirmar equivalencia para configuraciones no representables.
3. Copas tiene valor propio ahora, pero no selección de participantes separada de Unidades ni valores individuales por jugador.
4. Foursome Fantasma, tamaños3/9/18 y presión física; auto-unidades; Pollas/Mini Polla: extensiones previas sin fuente equivalente completa en este libro. Conservadas y cubiertas por regresiones existentes, no «validadas Excel».
5. No se reparó ni reescribió el archivo original, ni se recalcularon todos sus30,195 registros de fórmula en Excel. Se trazaron dependencias y se contrastaron los fragmentos económicos indicados. Sus referencias rotas y plantilla sin scores impiden usar valores cacheados como oráculo de una ronda completa.

Validación final/commits/Preview: ver `docs/QA_EXCEL_NASSAU.md`.

## Continuación UX / Foursome desde c18f992 (2 septiembre 2026)

No se repitió la auditoría del libro ni se cambiaron las reglas Personales. Se volvió a consultar la extracción privada de las fórmulas de Foursome antes de implementar:

- `AA211:AA215`: jugadores excluidos se sustituyen por999 para hallar el mínimo del match. La app utiliza exclusivamente sus participantes reales (y el duplicado Fantasma cuando aplica).
- `AC211=MIN(AA211:AA215)`; `AB211=AA211-AC211`; `AB194=ROUND(AB211,1)`.
- `AC195=IF(raw=0,0,IF(AB194-AC192>=0,raw-1,raw))`, con `AC192=SI`.
- `AC196=IF(raw=0,0,IF(AB194-AC193>=0,AC195-1,AC195))`, con `AC193=SI+18`.
- `D194:D197`: MIN contra MIN y MAX contra MAX; signos sumados −2/−1/0/+1/+2.
- `D228/I228/N228`: puntos de cada segmento de seis. Matrices económicas y Patada indicadas arriba, con valores uniformes y factor .5.

`excelFoursomeNet` reproduce esos dos umbrales y redondeo a una décima:4.6 no recibe golpe enSI5. El HCP porcentual no se inventa como dependencia del libro. La nueva configuración usa `handicapMethod: excel`; los borradores sin campo mantienen `configured`, con su porcentaje/redondeo previo, para no alterar acuerdos silenciosamente. Snapshots guardados no se recalculan por abrirlos. HCP más allá de36 conserva el comportamiento anterior en modo configurable; Excel replica su límite de dos umbrales.

Los fixtures en `tests/functional-closure.test.ts` traducen independientemente las fórmulas citadas. Contrastan HCP decimales, jugador ajeno al match, scores ajustados, los tres modos económicos, ambas salidas y tamaños3/6/9/18. Solo la aplicación por6 se atribuye al libro; los demás tamaños, presión y Fantasma son extensiones aprobadas, verificadas por sus propias regresiones, no nuevas equivalencias1:1. Los cinco posibles resultados LB/HB y las matrices uniformes siguen cubiertos en `tests/excel-reference.test.ts`.

### Cambio solicitado sobre Par y compatibilidad

Un Par visual ya NO materializa un score. Solo captura, +/- o **Confirmar Par en scores pendientes** registra golpes. Sin los cuatro scores reales (tres para Fantasma), el match no produce puntos de ese hoyo. Se conserva únicamente el acumulado de hoyos registrados. El mismo almacenamiento vacío alimenta los otros motores: no reciben pars inventados.

Los números ya existentes en borradores antiguos se conservan: el formato anterior no distingue si los generó el antiguo auto-Par o si fueron capturados. No es seguro borrarlos automáticamente. Se pueden borrar/corregir expresamente en Tarjeta. Históricos completos permanecen inmutables salvo confirmación de corrección.

### Snapshots y corrección

Snapshot2 agrega ownerId, parejas/segmentos, balances por jugador/categoría, detalle de motores y brutos Personales, junto con los datos completos previos. La corrección reutiliza ID, conserva foto y fecha original de terminación y actualiza updatedAt. Registros antiguos sin parejas Foursome quedan consultables de solo lectura: no se inventan parejas. Eliminar un Personal también retira su configuración y balances derivados para que corregir la ronda no lo resucite.

Evidencia de esta continuación y límites de prueba física: `docs/QA_UX_FOURSOME.md`.
