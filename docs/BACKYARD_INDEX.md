# Índice Backyard — contrato local, no oficial

Índice Backyard es una referencia privada derivada de rondas con evidencia suficiente. No es un Handicap Index WHS, no es GHIN y no modifica el HCP manual del perfil, el Course Handicap ni el Playing Handicap que usa el motor de apuestas. GHIN futuro debe conservar el histórico y mostrar su dato oficial en un carril separado.

## Elegibilidad

La versión 1 admite sólo 18 hoyos cerrados con score real de los 18 hoyos, par y stroke index válidos, tee congelado del jugador, adjusted gross calculable, Rating/Slope **acreditados para ese tee**, y PCC publicado o una declaración explícita de “PCC 0 sólo para cálculo local”. Nunca presume que el PCC desconocido sea cero.

El catálogo interno `BACKYARD_INTERNAL` y un `verifiedAt` del club no prueban por sí solos la acreditación del Course Rating/Slope. La evidencia `BackyardIndexRatedTeeEvidence` debe proceder de un proveedor/autoridad autorizados y coincidir con el `PlayerTeeAssignmentSnapshot` guardado. Sin esa evidencia el snapshot queda `NO ELEGIBLE` con motivo; las rondas antiguas sin snapshot tampoco se convierten retroactivamente en elegibles. No se inventan tees, ratings, pendientes PCC ni scores.

Para adjusted gross, el límite por hoyo es net double bogey con el **Course Handicap irrestricto congelado**, no el HCP limitado para apuestas. Sin Index previo, la regla de scores iniciales es par + 5. Un Index informado sin Course Handicap congelado queda no elegible. Los 9 hoyos y rondas incompletas quedan no elegibles hasta implementar de forma fiable el diferencial equivalente/expected score.

## Aritmética y límites

El diferencial de una ronda elegible es `(113 / Slope) × (adjusted gross − Course Rating − PCC)`, redondeado a una décima. Con 20 o más diferenciales elegibles se toman los 20 más recientes **por fecha de juego** y se promedian los mejores 8. Para 3–19 se usa exactamente la selección/ajuste de [USGA Rule 5.2a](https://www.usga.org/handicapping/roh/Content/rules/5%202a%20For%20Fewer%20Than%2020%20Scores.htm):

| Diferenciales | Usar | Ajuste |
| --- | --- | --- |
| 3 | menor 1 | −2.0 |
| 4 | menor 1 | −1.0 |
| 5 | menor 1 | 0 |
| 6 | menores 2 | −1.0 |
| 7–8 | menores 2 | 0 |
| 9–11 | menores 3 | 0 |
| 12–14 | menores 4 | 0 |
| 15–16 | menores 5 | 0 |
| 17–18 | menores 6 | 0 |
| 19 | menores 7 | 0 |

La fórmula y el adjusted gross siguen [USGA Rule 5.1a](https://www.usga.org/handicapping/roh/Content/rules/5%201a%20Calculation%20of%20a%20Score%20Differential18Hole.htm) y [USGA Rule 3.1](https://www.usga.org/handicapping/roh/Content/rules/3%201b%20After%20a%20Handicap%20Index%20Has%20Been%20Established.htm); [R&A Rule 5](https://www.randa.org/ko-KR/roh/the-rules-of-handicapping/rule-5) confirma el registro de 20/mejores 8 y PCC. **No** se implementan aquí revisión de formato autorizado, certificación, expected score, reducciones por scores excepcionales, Low Handicap Index/caps ni ajustes de comité. Por ello nunca se rotula “WHS” u “oficial”.

## Persistencia e integración

`RoundSnapshot.backyardIndexSnapshots` contiene evidencia congelada por cuenta/jugador. Integración en el guardado, una sola vez antes de `saveRoundHistoryLocalFirst`:

```ts
const indexRound = snapshotBackyardIndexRound(snapshot, identity.userId, {
  priorRound: history.find((round) => round.id === snapshot.id),
  // ratedTeeEvidence y pccEvidence sólo cuando exista fuente/decisión explícita.
});
await saveRoundHistoryLocalFirst({ ...args, snapshot: indexRound });
```

En una corrección histórica, `priorRound` reutiliza sólo la evidencia congelada de tee/PCC; se revalida contra el tee y los scores corregidos. Nunca se recalcula la ronda en cada render ni se cambia el registro histórico anterior hasta confirmar Guardar. El JSON completo de `RoundSnapshot` ya pasa por el flujo local-first y `rounds_cloud.snapshot`; no se requieren columnas ni migraciones nuevas para este campo opcional. La vista lee únicamente snapshots guardados y deduplica correcciones por ID.

La tarjeta `BackyardIndexCard` exige prop `enabled` y callback opcional `onEnabledChange`. El padre debe persistir ese opt-in privado mediante su mecanismo canónico de preferencias de cuenta; no usar `identity.defaultHandicap` como interruptor ni como salida del cálculo. La tarjeta enumera las rondas `NO ELEGIBLE` y muestra el índice sólo después del opt-in.

Pruebas: `tests/backyard-index.test.ts` cubre 20/mejores 8, tabla 3–19, PCC, adjusted gross, tee, rolling por fecha de juego, correcciones históricas no mutantes y separación de HCP.
