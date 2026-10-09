"use client";

import { useState } from 'react';
import { ScorecardBoundary } from '../../components/scorecard-boundary';
import { prepareQuickHole } from '../../../lib/premium-scorecard';
import {multiplayerScorecardQa, type ScorecardQaFixture} from '../../../lib/scorecard-qa-fixture';

export function ScorecardQa({fixture}:{fixture:ScorecardQaFixture}) {
  const {access:qaAccess,advancedStats:qaAdvanced,course:qaCourse,order:qaOrder,player:qaPlayer,putts:qaPutts,scores:qaScores}=fixture;
  const [playerCount,setPlayerCount]=useState(1);
  const multi=multiplayerScorecardQa(fixture,playerCount);
  const [data, setData] = useState(() => ({ scores: qaScores, edits: {}, putts: qaPutts, advancedStats: qaAdvanced }));
  const [readonly, setReadonly] = useState(true), [saves, setSaves] = useState(0), [generation, setGeneration] = useState(0), [failNext, setFailNext] = useState(false);
  return <main className="scorecardQaShell"><aside className="scorecardQaBanner"><details><summary><b>DEMO QA — DATOS DE PRUEBA</b> · {saves} guardadas</summary><p>Capturas sólo en memoria. No se publican ni se guardan en tu cuenta, historial o base de datos.</p><div><label>Jugadores QA<select aria-label="Número de jugadores QA" value={playerCount} onChange={event=>{setPlayerCount(Number(event.target.value));setGeneration(value=>value+1);}}>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n} jugadores aislados</option>)}</select></label><button type="button" onClick={() => setReadonly(value => !value)}>{readonly ? 'Probar editable' : 'Probar sólo lectura'}</button><button type="button" onClick={() => { setData({ scores: qaScores, edits: {}, putts: qaPutts, advancedStats: qaAdvanced }); setSaves(0); setFailNext(false); setGeneration(value => value + 1); }}>Restablecer fixture</button><button type="button" aria-pressed={failNext} onClick={() => setFailNext(value => !value)}>Simular fallo al guardar</button></div><span role="status">{saves} capturas confirmadas en memoria · {readonly ? 'Sólo lectura' : 'Editable'}</span></details></aside>
    <ScorecardBoundary key={generation} initialOpen roundId={qaAccess.roundId} course={multi.course} players={multi.players} assignments={multi.assignments} order={qaOrder} {...data} scores={multiplayerScorecardQa({...fixture,scores:data.scores},playerCount).scores} ownerId={qaPlayer.id} accountUserId={qaPlayer.accountUserId} date="2026-10-08" lifecycle="live" access={{ ...qaAccess, readOnly: readonly }} saveNotice={hole => `Hoyo ${hole} confirmado sólo en memoria QA.`} onSaveHole={(hole, playerId, draft) => {
      if (failNext) { setFailNext(false); throw new Error('Fallo controlado de QA; no hubo escritura.'); }
      if(playerId!==qaPlayer.id)throw new Error('Jugador de prueba no disponible.');
      const player = qaPlayer;
      const next = prepareQuickHole({ access: { ...qaAccess, readOnly: readonly }, player, hole: qaCourse.holes.find(value => value.number === hole)!, ...data, draft });
      setData(next); setSaves(value => value + 1);
    }}>{open => <section className="scorecardQaRound"><h1>Ronda de prueba aislada</h1><p>18 hoyos: putts, salidas, GIR, bunker, penalidades y OB. Sin GPS.</p><button type="button" onClick={open}>Abrir tarjeta de prueba</button></section>}</ScorecardBoundary>
  </main>;
}
