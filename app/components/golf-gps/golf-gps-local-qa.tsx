'use client';
import { useEffect, useMemo, useState } from 'react';
import type { GpsCourse } from '../../../lib/golf-gps/types';
import { simulationMapFactory } from '../../../lib/golf-gps/simulation-map.mjs';
import type { LocationAdapter } from '../../../lib/golf-gps/location.mjs';
import { RoundCaptureV2 } from '../round-capture-v2';
import { initialBets } from '../../../lib/new-round-bets';
import type { Course } from '../../../lib/types';
import { GolfGpsView } from './golf-gps-view';

export function GolfGpsLocalQa({ courses }: { courses: GpsCourse[] }) {
  const [scenario, setScenario] = useState('valid');
  const [qaOpen, setQaOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [scores, setScores] = useState<Record<number, Record<string, number|null>>>({});
  const [saves, setSaves] = useState(0);
  const card = useMemo<Course>(()=>({id:'SIMULATION_ONLY',name:courses[0]?.name||'QA',teeName:'Tee simulado',holes:courses[0].holes.map(row=>({number:row.position,par:4,strokeIndex:row.position}))}),[courses]);
  const bets = useMemo(()=>initialBets(['qa-local']),[]);
  const noop = () => {};
  const hole = card.holes[index];

  const [resourceHosts, setResourceHosts] = useState<Record<string, number>>({});
  useEffect(() => {
    const inspect = () => {
      const hosts: Record<string, number> = {};
      for (const resource of performance.getEntriesByType('resource')) {
        const host = new URL(resource.name, window.location.href).host;
        hosts[host] = (hosts[host] ?? 0) + 1;
      }
      setResourceHosts(hosts);
    };
    inspect(); const observer = new PerformanceObserver(inspect); observer.observe({ type: 'resource', buffered: true });
    return () => observer.disconnect();
  }, []);
  const factory = useMemo(() => simulationMapFactory(), []);
  const adapter = useMemo<LocationAdapter>(() => {
    const watchers = new Map<number, ReturnType<typeof setInterval>>(); let id = 0;
    const origin = courses[0]?.holes[0]?.green.center;
    return { secure: true, simulated: true, geolocation: {
      watchPosition(success, error) {
        const current = ++id;
        const tick = () => {
          if (scenario === 'denied') { error?.({ code: 1, message: 'SIMULATED DENIAL', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }); return; }
          if (scenario === 'timeout') { error?.({ code: 3, message: 'SIMULATED TIMEOUT', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }); return; }
          if (!origin) return;
          const age = scenario === 'stale' ? 30000 : 0;
          success({ timestamp: Date.now() - age, coords: { longitude: origin[0] - .0003, latitude: origin[1] - .0002, accuracy: scenario === 'inaccurate' ? 80 : 8, altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON: () => ({ simulation: true }) }, toJSON: () => ({ simulation: true }) });
        };
        watchers.set(current, setInterval(tick, 2000)); queueMicrotask(tick); return current;
      }, clearWatch(current) { clearInterval(watchers.get(current)); watchers.delete(current); },
    } };
  }, [courses, scenario]);
  return <><aside style={{ position:'fixed',right:4,top:4,zIndex:1200,fontSize:10,background:'#ffe0b0',maxWidth:320 }}><button type="button" onClick={()=>setQaOpen(!qaOpen)}>QA {qaOpen?'cerrar':'local'}</button>{qaOpen&&<div><label>QA local: escenario simulado <select aria-label="Escenario GPS simulado" value={scenario} onChange={event => setScenario(event.target.value)}>{[['valid', 'Señal válida'], ['denied', 'Permiso denegado'], ['timeout', 'Timeout'], ['stale', 'Lectura antigua'], ['inaccurate', 'Poca precisión']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><p data-testid="gps-resource-audit" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>Recursos observados: {Object.entries(resourceHosts).map(([host, count]) => `${host} (${count})`).join(', ') || 'pendiente'}. GolfAPI / Google Maps / Mapbox: {Object.entries(resourceHosts).filter(([host]) => /golfapi\.io|googleapis\.com|gstatic\.com|mapbox\.com/.test(host)).reduce((sum, [, count]) => sum + count, 0)}.</p><p data-testid="qa-score-ledger">Solo memoria QA: {JSON.stringify(scores)} · guardados {saves}</p></div>}</aside>
    <RoundCaptureV2 initialGpsOpen course={card} hole={hole} order={card.holes.map(row=>row.number)} currentIndex={index} completedHoles={new Set()} players={[{id:'qa-local',name:'Jugador QA aislado',handicap:0}]} ownerId="qa-local" caddiePlanId="free" mode="quick" bets={bets} supplementalBets={[]} scores={scores[hole.number]||{}} putts={{}} advancedStats={{}} roundId="LOCAL-SIMULATION-NEVER-SAVED" shots={[]} counterQuantities={{vipers:{},camels:{},fish:{}}} unitQuantities={{}} playerIndicators={()=>[]} onNavigateHole={setIndex} onModeChange={noop} onScoreChange={(player,value)=>setScores(rows=>({...rows,[hole.number]:{...rows[hole.number],[player]:value}}))} onPuttsChange={noop} onCounterChange={noop} onUnitDelta={noop} onAdvancedChange={noop} onShotsChange={noop} onOpenLoba={noop} onOpenBallFriend={noop} onOpenScanner={noop} onToggleFullCard={noop} fullCardVisible={false} onOpenStandings={noop} onUndo={noop} undoDisabled onSaveAndAdvance={()=>{if(typeof scores[hole.number]?.['qa-local']==='number'){setSaves(n=>n+1);setIndex(n=>Math.min(card.holes.length-1,n+1));}}} saveDisabled={typeof scores[hole.number]?.['qa-local']!=='number'} onSaveHole={()=>{if(typeof scores[hole.number]?.['qa-local']!=='number')return false;setSaves(n=>n+1);return true;}} saveLabel="Guardar y siguiente" gpsContent={({active,onBack,onScore})=><GolfGpsView courses={courses} mapsEnabled={false} mapFactory={factory} locationAdapter={adapter} simulation active={active} onBack={onBack} initialCourseId={courses[0].id} initialPosition={hole.number} roundContext={{roundId:'LOCAL-SIMULATION-NEVER-SAVED',name:card.name,teeName:'Tee / Par de prueba',holes:card.holes,onNavigate:position=>setIndex(card.holes.findIndex(row=>row.number===position)),onScore}} />} />
  </>;
}
