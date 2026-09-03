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
| HCP Foursome | Comienzo M31/U31; Cálculos G99, E34, D36:D37; AB194/AB211 | El control % se refleja en G99, pero los scores efectivos de tabla1 usan **E34 sin %**. Tabla2 rebaja contra los cuatro elegidos mediante AA211:AA215/AB211. | App aplica %/redondeo y rebasa cada match. Diferencia real de cableado del libro; no atribuir a sus fórmulas controles que no usan. Pendiente resolver intención del control sin cambiarlo por intuición. |
| Skins | Cálculos K99; M99:P99; D922:AG926; E991:F993 | HCP rebajado × %. Enteros primero, fracción desempata; carry suma hoyos sin ganador único; se paga solo al ganador único. | Comparar selección fraccionaria y acumulación con fixtures derivados. Carry final sin ganador no se paga. |
| Conejos | Cálculos F99; D758:AG762; E848:I869 y bloques siguientes | Ganadores netos alimentan Libre/Agarra/Mantiene/Gana; ganar en segunda posición reinicia ciclo. Si no se cobra al cerrar ciclo de tres se acumula. E848:E852 contienen **solo candidatos ganadores**, no todos los nombres. | Máquina actual compatible en estructura; probar secuencias desde fórmulas, no confundir columnas candidatas con participantes. |
| Bola Amiga | Cálculos A111:C125/D112:D113; M129:AC129; AD167; filas1523:1526 | Dos scores ajustados, cap Comienzo M30 (9). Orden bajo/alto; birdie gross de un equipo invierte dígitos del contrario. Diferencia de números de dos dígitos. | App tiene la estructura; validar HCP efectivo y pagos uniformes. Excel permite valores individuales: liquidación ponderada MIN, no disponible en app. |
| Unidades | Jugar E/F de cada hoyo; Cálculos N1561, D1568:H1572 | Captura manual; cada positivo cobra a cada rival MIN de sus valores. | Coincide con importe uniforme; no hay fórmula de auto Birdie/Eagle/HIO en el libro. Automatismos aprobados de app no se afirman contrastados contra Excel. |
| Copas | Cálculos Q1542:U1556, S1552 y diagonal | Captura separada; quien registra copa paga a cada rival. Valor/participación separados de Unidades. | App las registra como unidades negativas con mismo valor/participantes; equivalencia solo si iguales. Diferencia de configuración real. |
| Monkey | Comienzo I16/L16; Cálculos P34:T34, E1447:E1452, F1459 y L1491:M1493 | Tres jugadores. Por cada rival: 2 puntos al ganarle, 1 al empatar, 0 al perder. Liquidar diferencias de puntos por pares × valor. | No existe motor/configuración Monkey en la app base. No confundir con Foursome Fantasma. |
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

En curso. Los resultados finales de tests, navegador y diferencias no resueltas se registrarán al terminar. Este documento distingue siempre fórmula trazada, extensión aprobada y caso real; no certifica todo el motor por el mero hecho de que pase la suite existente.
