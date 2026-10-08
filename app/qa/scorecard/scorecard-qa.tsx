"use client";

import { useState } from 'react';
import { ScorecardBoundary } from '../../components/scorecard-boundary';
import { prepareQuickHole } from '../../../lib/premium-scorecard';
import { qaAccess, qaAdvanced, qaCourse, qaOrder, qaOther, qaPlayer, qaPutts, qaScores } from '../../../tests/fixtures/scorecard-ux';

export function ScorecardQa() {
  const [data, setData] = useState(() => ({ scores: qaScores, edits: {}, putts: qaPutts, advancedStats: qaAdvanced }));
  const [readonly, setReadonly] = useState(false), [saves, setSaves] = useState(0), [generation, setGeneration] = useState(0);
  return <main className="scorecardQaShell"><aside className="scorecardQaBanner"><b>QA AISLADO · DATOS DE PRUEBA</b><p>Capturas sólo en memoria. Sin cuentas, almacenamiento ni conexión a la base de datos.</p><div><button type="button" onClick={() => setReadonly(value => !value)}>{readonly ? 'Probar editable' : 'Probar sólo lectura'}</button><button type="button" onClick={() => { setData({ scores: qaScores, edits: {}, putts: qaPutts, advancedStats: qaAdvanced }); setSaves(0); setGeneration(value => value + 1); }}>Restablecer fixture</button></div><span role="status">{saves} capturas confirmadas en memoria · {readonly ? 'Sólo lectura' : 'Editable'}</span></aside>
    <ScorecardBoundary key={generation} roundId={qaAccess.roundId} course={qaCourse} players={[qaPlayer, qaOther]} order={qaOrder} {...data} ownerId={qaPlayer.id} accountUserId={qaPlayer.accountUserId} date="2026-10-07" lifecycle="live" access={{ ...qaAccess, readOnly: readonly }} saveNotice={hole => `Hoyo ${hole} confirmado sólo en memoria QA.`} onSaveHole={(hole, playerId, draft) => {
      const player = [qaPlayer, qaOther].find(value => value.id === playerId)!;
      const next = prepareQuickHole({ access: { ...qaAccess, readOnly: readonly }, player, hole: qaCourse.holes.find(value => value.number === hole)!, ...data, draft });
      setData(next); setSaves(value => value + 1);
    }}>{open => <section className="scorecardQaRound"><h1>Ronda de prueba aislada</h1><p>Incluye Putts 0, FIR no aplicable en par 3, un hoyo sin estadísticas, GIR y penalidades.</p><button type="button" onClick={open}>Abrir tarjeta de prueba</button></section>}</ScorecardBoundary>
  </main>;
}
