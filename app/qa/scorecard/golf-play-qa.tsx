'use client';
import { useMemo, useState } from 'react';
import { PlayHub } from '../../components/play-hub';
import { CatalogCoursePicker } from '../../components/catalog-course-picker';
import { RoundTeePicker } from '../../components/round-tee-picker';
import { RoundSetupWizard, RoundSetupStep } from '../../components/round-setup-wizard';
import { RoundCaptureV2 } from '../../components/round-capture-v2';
import { GolfGpsView } from '../../components/golf-gps/golf-gps-view';
import { initialBets } from '../../../lib/new-round-bets';
import { roundTeeSelectionId } from '../../../lib/course-scorecard-profiles';
import { collectRoundSetupPreflightIssues } from '../../../lib/round-setup-preflight';
import { simulationMapFactory } from '../../../lib/golf-gps/simulation-map.mjs';
import type { GpsCourse } from '../../../lib/golf-gps/types';
import type { Course } from '../../../lib/types';

/** DEV's existing authorized QA gate. The production components are exercised
 * against real saved cards/maps, but the round/score remains in memory. No cloud
 * sync, account writes, analytics, notification or provider import is mounted. */
export function GolfPlayQa({ token, courses, mapsEnabled, requestCatalog }: {
  token: string; courses: GpsCourse[]; mapsEnabled: boolean;
  requestCatalog?: (url:string,init:RequestInit)=>Promise<Response>;
}) {
  const [view, setView] = useState<'play'|'setup'|'round'>('play');
  const [cards, setCards] = useState<Course[]>([]), [card, setCard] = useState<Course|null>(null);
  const [pending, setPending] = useState<{name:string;catalogClubId?:string;catalogCourseId?:string;selectionIssue?:string}|null>(null);
  const [started, setStarted] = useState(false), [closed, setClosed] = useState(false);
  const [index, setIndex] = useState(0), [saves, setSaves] = useState(0);
  const [saved, setSaved] = useState<Record<number,Record<string,number>>>({});
  const [edits, setEdits] = useState<Record<number,Record<string,number|null>>>({});
  const [message, setMessage] = useState('');
  const [confirm, setConfirm] = useState(false);
  const players = [{id:'QA-MEMORY-ONLY',name:'Jugador QA aislado',handicap:null}];
  const bets = useMemo(()=>initialBets(['QA-MEMORY-ONLY']),[]);
  const factory = useMemo(()=>mapsEnabled ? undefined : simulationMapFactory(),[mapsEnabled]);
  const issues = collectRoundSetupPreflightIssues({courseSelected:!!card,pendingCourse:pending,players,betIssues:[]});
  const fresh = () => {setCards([]);setCard(null);setPending(null);setSaved({});setEdits({});setIndex(0);setStarted(false);setClosed(false);setSaves(0);setView('setup');setMessage('');};
  const noop = () => {};
  const finish = () => {
    if (!card || card.holes.some(h=>typeof saved[h.number]?.['QA-MEMORY-ONLY']!=='number') || Object.values(edits).some(row=>Object.keys(row).length)) {setMessage('Faltan scores guardados. La ronda QA se conserva pendiente.');setView('play');return;}
    setClosed(true);setView('play');setMessage('Ronda QA finalizada en memoria. No se incorporó al historial de tu cuenta.');
  };
  const active = !closed && (pending||card) ? {courseName:card?.name||pending?.name||'Campo por elegir',roundDate:'QA · memoria',status:started?'live' as const:'setup' as const,totalHoles:(card?.holes.length===9?9:18) as 9|18,playerCount:1,currentHole:card?.holes[index]?.number,playedHoles:Object.keys(saved).length}:null;
  return <main style={{maxWidth:680,margin:'auto',padding:12}}>
    <p style={{background:'#ffe0b0',padding:8}}>QA AISLADO · Tarjetas reales guardadas · {mapsEnabled?'Google real bajo demanda':'Mapa simulado, sin solicitudes externas'} · Sin escrituras en tu cuenta</p>
    {message&&<p role="status">{message}</p>}
    <p data-testid="qa-play-ledger">Memoria: {JSON.stringify({saved,edits,saves,index,started,closed})}</p>
    {view==='play'&&<PlayHub activeRound={active} onContinueRound={()=>setView(started?'round':'setup')} onEditRound={()=>setView('setup')} onCancelRound={()=>setConfirm(true)} onFinishRound={finish} onNewRound={fresh} onScoreOnly={fresh} onOpenGps={()=>active?setView(started?'round':'setup'):fresh()} onAiRound={fresh} onTotalScore={fresh} onOpenHistory={noop} onOpenBalances={noop} onOpenPersonalHistory={noop} onOpenStats={noop} onOpenCourses={noop} onOpenGroups={noop} onOpenRules={noop} onOpenStandings={noop} onOpenResults={noop}/>}
    {confirm&&<section role="dialog" aria-label="Descartar / cancelar QA"><h2>{started?'¿Cancelar ronda QA?':'¿Descartar borrador QA?'}</h2><button onClick={()=>setConfirm(false)}>Conservar</button><button onClick={()=>{setConfirm(false);setClosed(true);setMessage('QA cerrada. La tarjeta capturada queda visible en la evidencia en memoria.');}}>Confirmar QA</button></section>}
    {view==='setup'&&<RoundSetupWizard key={closed?'fresh':'draft'} storageKey="QA-PLAY-GPS-STEP-ONLY" scoreOnly quickSolo={!started} editing={started} issues={issues} onSave={()=>true} onExit={()=>setView('play')} onStart={async()=>{if(issues.length)return false;setStarted(true);setView('round');return true;}}>
      <RoundSetupStep step={1}>{!cards.length?<CatalogCoursePicker token={token} permissionOwnerId="QA-ISOLATED" selectedCourseId={pending?.catalogCourseId} selectedClubId={pending?.catalogClubId} onSelectClub={entry=>setPending({name:entry.clubName,catalogClubId:entry.clubId})} onConfigurationPending={(entry,issue)=>setPending({name:entry.name,catalogClubId:entry.clubId,catalogCourseId:entry.id,selectionIssue:issue})} onSelect={(_course,tees)=>{setCards(tees);setCard(null);}} onRequest={name=>setMessage(`Reportar ${name||'campo'}: formulario disponible en la app; QA no envía solicitudes.`)} requestCatalog={requestCatalog}/>:<RoundTeePicker courseName={cards[0].name} tees={cards} selectedTeeId={card?roundTeeSelectionId(card):''} onSelect={setCard} onBack={()=>{setCards([]);setCard(null);}} onMissingTee={()=>setMessage('QA no envía solicitudes al club.')}/>}</RoundSetupStep>
      <RoundSetupStep step={2}><p>Un jugador QA · Sin GHIN · HCP desconocido. El score no requiere GHIN.</p></RoundSetupStep><RoundSetupStep step={5}><p>{card?.name} · {card?.teeName}</p></RoundSetupStep>
    </RoundSetupWizard>}
    {view==='round'&&card&&(()=>{
      const hole=card.holes[index],order=card.holes.map(h=>h.number),gps=courses.find(row=>row.id===card.catalogCourseId);
      return <RoundCaptureV2 initialGpsOpen course={card} hole={hole} order={order} currentIndex={index} completedHoles={new Set(Object.keys(saved).map(Number))} players={players} ownerId="QA-MEMORY-ONLY" caddiePlanId="free" mode="quick" bets={bets} supplementalBets={[]} scores={{...saved[hole.number],...edits[hole.number]}} putts={{}} advancedStats={{}} roundId="QA-ISOLATED-NEVER-CLOUD" shots={[]} counterQuantities={{vipers:{},camels:{},fish:{}}} unitQuantities={{}} playerIndicators={()=>[]} onNavigateHole={setIndex} onModeChange={noop} onScoreChange={(id,value)=>setEdits(rows=>({...rows,[hole.number]:{...rows[hole.number],[id]:value}}))} onPuttsChange={noop} onCounterChange={noop} onUnitDelta={noop} onAdvancedChange={noop} onShotsChange={noop} onOpenLoba={noop} onOpenBallFriend={noop} onOpenScanner={noop} onToggleFullCard={noop} fullCardVisible={false} onOpenStandings={()=>setView('play')} onUndo={noop} undoDisabled onSaveAndAdvance={noop} onSaveHole={()=>{const value=edits[hole.number]?.['QA-MEMORY-ONLY']??saved[hole.number]?.['QA-MEMORY-ONLY'];if(typeof value!=='number')return false;setSaved(rows=>({...rows,[hole.number]:{'QA-MEMORY-ONLY':value}}));setEdits(rows=>({...rows,[hole.number]:{}}));setSaves(n=>n+1);return true;}} saveDisabled={false} saveLabel="Guardar score" gpsContent={({active,onBack,onScore})=>gps?<GolfGpsView courses={[gps]} mapsEnabled={mapsEnabled} mapFactory={factory} simulation={!mapsEnabled} initialCourseId={gps.id} initialPosition={hole.number} active={active} onBack={onBack} roundContext={{roundId:'QA-ISOLATED-NEVER-CLOUD',name:`QA · ${card.name}`,teeName:card.teeName,holes:card.holes,onNavigate:position=>setIndex(order.indexOf(position)),onScore,onExit:()=>setView('play'),onFinish:finish}}/>:<section><p>Sin correspondencia GPS para esta configuración. Puedes anotar score.</p><button onClick={onBack}>Volver a score</button><button onClick={()=>setView('play')}>Guardar y salir QA</button></section>}/>;
    })()}
  </main>;
}
