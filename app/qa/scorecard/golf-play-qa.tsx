'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import type { Course, RoundSnapshot, HoleScore } from '../../../lib/types';
import { playQaPersistence, playQaRoundPrefix } from '../../../lib/play-qa-persistence';
import { OwnerRoundCancellationConflict } from '../../../lib/owner-round-cancel';

/** Existing authorized DEV gate. By default capture stays in memory. Explicit
 * persist=1 uses one identified owner card, without global draft/history writes
 * or completed analytics. Both modes use production components/saved maps. */
export function GolfPlayQa({ token, courses, mapsEnabled, requestCatalog, persistentUserId }: {
  token: string; courses: GpsCourse[]; mapsEnabled: boolean;
  persistentUserId?: string;
  requestCatalog?: (url:string,init:RequestInit)=>Promise<Response>;
}) {
  const [view, setView] = useState<'play'|'setup'|'round'>('play');
  const [cards, setCards] = useState<Course[]>([]), [card, setCard] = useState<Course|null>(null);
  const [pending, setPending] = useState<{name:string;catalogClubId?:string;catalogCourseId?:string;selectionIssue?:string}|null>(null);
  const [started, setStarted] = useState(false), [closed, setClosed] = useState(false);
  const [index, setIndex] = useState(0), [saves, setSaves] = useState(0);
  const [saved, setSaved] = useState<Record<number,HoleScore>>({});
  const [edits, setEdits] = useState<Record<number,Record<string,number|null>>>({});
  const [message, setMessage] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false), [ready, setReady] = useState(!persistentUserId);
  const [review, setReview] = useState<OwnerRoundCancellationConflict|null>(null);
  const [qaRecord, setQaRecord] = useState<RoundSnapshot|null>(null);
  const currentRound = useRef<RoundSnapshot|null>(null), qaId = useRef(''), writes = useRef(false);
  const persistence = useMemo(()=>persistentUserId&&typeof window!=='undefined'?playQaPersistence(persistentUserId,token,localStorage):null,[persistentUserId,token]);
  const qaKey = `backyard-play-qa-only:${persistentUserId}`;
  const players = [{id:'QA-MEMORY-ONLY',name:'Jugador QA aislado',handicap:null,...(persistentUserId?{accountUserId:persistentUserId}:{})}];
  const bets = useMemo(()=>initialBets(['QA-MEMORY-ONLY']),[]);
  const factory = useMemo(()=>mapsEnabled ? undefined : simulationMapFactory(),[mapsEnabled]);
  const issues = collectRoundSetupPreflightIssues({courseSelected:!!card,pendingCourse:pending,players,betIssues:[]});
  useEffect(()=>{
    if(!persistence)return;
    let alive=true;
    const checkpoint=JSON.parse(localStorage.getItem(qaKey)||'null');
    if(!checkpoint?.id){setReady(true);return;}
    void persistence.read(checkpoint.id).then(row=>{
      if(!alive)return;
      if(row){const round=row.snapshot;currentRound.current=round;setQaRecord(round);qaId.current=round.id;setCard(round.courseSnapshot||null);setCards(round.courseSnapshot?[round.courseSnapshot]:[]);setSaved(round.scores||{});setStarted(true);setClosed(round.lifecycleState==='cancelled');setIndex(checkpoint.index??round.resumeHoleIndex??0);setEdits(checkpoint.edits||{});setMessage(`Tarjeta QA leída de nube · Revisión ${row.version} · ${round.lifecycleState}`);}
      setReady(true);
    }).catch(error=>{if(alive)setMessage(error.message);});
    return()=>{alive=false;};
  },[persistence,qaKey]);
  useEffect(()=>{if(persistence&&ready&&qaId.current)localStorage.setItem(qaKey,JSON.stringify({id:qaId.current,index,edits}));},[persistence,ready,qaKey,index,edits]);
  const fresh = () => {if(persistence&&started&&!closed){setMessage('Conserva o cancela esta tarjeta QA antes de iniciar otra.');return;}qaId.current='';currentRound.current=null;setQaRecord(null);setCards([]);setCard(null);setPending(null);setSaved({});setEdits({});setIndex(0);setStarted(false);setClosed(false);setSaves(0);setView('setup');setMessage('');};
  function snapshot(nextScores=saved):RoundSnapshot {
    if(!card||!persistentUserId)throw new Error('Selecciona recorrido y tee.');
    qaId.current ||= playQaRoundPrefix(persistentUserId)+crypto.randomUUID();
    const now=new Date().toISOString();
    return {...currentRound.current,id:qaId.current,lifecycleState:'live',startedAt:currentRound.current?.startedAt||now,date:currentRound.current?.date||now.slice(0,10),courseName:`QA PERSISTENCIA · ${card.name}`,teeName:card.teeName,courseSnapshot:card,ownerId:players[0].id,ownerName:players[0].name,players,scorekeeping:{version:1,mode:'owner',organizerAccountUserId:persistentUserId},presentation:{playMode:'score_only'},roundHoles:card.holes.length===9?9:18,startHole:1,order:card.holes.map(h=>h.number),resumeHoleIndex:index,scores:nextScores,betResult:0,expenseTotal:0,netResult:0,categoryResults:{},expenses:{caddie:0,food:0,drinks:0,greenFee:0,cartRental:0,other:0}};
  }
  async function write(nextScores=saved) {
    if(!persistence)return true;
    if(writes.current)return false;
    writes.current=true;setBusy(true);
    try {const next=snapshot(nextScores);await persistence.save(next,currentRound.current||undefined);currentRound.current=next;setQaRecord(next);localStorage.setItem(qaKey,JSON.stringify({id:next.id,index,edits}));setMessage('Tarjeta QA guardada en nube. Puedes recargar para comprobarla.');return true;}
    catch(error){setMessage(error instanceof Error?error.message:'Nube pendiente.');return false;}
    finally{writes.current=false;setBusy(false);}
  }
  async function leave() {if(!started||await write())setView('play');}
  async function saveCurrentHole() {
    const hole=card?.holes[index]; if(!hole)return false;
    const value=edits[hole.number]?.['QA-MEMORY-ONLY']??saved[hole.number]?.['QA-MEMORY-ONLY'];
    if(typeof value!=='number')return false;
    const next={...saved,[hole.number]:{'QA-MEMORY-ONLY':value}};
    if(!await write(next))return false;
    setSaved(next);setEdits(rows=>({...rows,[hole.number]:{}}));setSaves(n=>n+1);return true;
  }
  async function cancel() {
    if(!persistence){setConfirm(false);setClosed(true);setMessage('QA cerrada. La tarjeta capturada queda visible en la evidencia en memoria.');return;}
    if(writes.current)return;
    writes.current=true;setBusy(true);
    try {const next=snapshot();await persistence.cancel(next);currentRound.current={...next,lifecycleState:'cancelled'};setQaRecord(currentRound.current);setClosed(true);setConfirm(false);setMessage('Tarjeta QA cancelada en nube. Sus scores se conservan; recarga para comprobarlo.');}
    catch(error){if(error instanceof OwnerRoundCancellationConflict)setReview(error);setMessage(error instanceof Error?error.message:'Cancelación pendiente.');}
    finally{writes.current=false;setBusy(false);}
  }
  const noop = () => {};
  const finish = () => {
    if(persistence){setMessage('Esta prueba escribe solo tarjetas pendientes/canceladas. Finalizar no se ejecuta para evitar estadísticas sintéticas.');setView('play');return;}
    if (!card || card.holes.some(h=>typeof saved[h.number]?.['QA-MEMORY-ONLY']!=='number') || Object.values(edits).some(row=>Object.keys(row).length)) {setMessage('Faltan scores guardados. La ronda QA se conserva pendiente.');setView('play');return;}
    setClosed(true);setView('play');setMessage('Ronda QA finalizada en memoria. No se incorporó al historial de tu cuenta.');
  };
  const active = !closed && (pending||card) ? {courseName:card?.name||pending?.name||'Campo por elegir',roundDate:persistence?(qaRecord?.date||'QA · nube'):'QA · memoria',status:started?'live' as const:'setup' as const,totalHoles:(card?.holes.length===9?9:18) as 9|18,playerCount:1,currentHole:card?.holes[index]?.number,playedHoles:Object.keys(saved).length}:null;
  function renderGps({active,onBack,onScore}: {active:boolean;onBack:()=>void;onScore:(position:number)=>void}) {
    if(!card)return null;
    const hole=card.holes[index],order=card.holes.map(h=>h.number),gps=courses.find(row=>row.id===card.catalogCourseId);
    return (gps?<GolfGpsView courses={[gps]} mapsEnabled={mapsEnabled} mapFactory={factory} simulation={!mapsEnabled} initialCourseId={gps.id} initialPosition={hole.number} active={active} onBack={onBack} roundContext={{roundId:qaRecord?.id||'QA-ISOLATED-NEVER-CLOUD',name:`QA · ${card.name}`,teeName:card.teeName,holes:card.holes,onNavigate:position=>setIndex(order.indexOf(position)),onScore,onExit:leave,onFinish:finish}}/>:<section><p>Sin correspondencia GPS para esta configuración. Puedes anotar score.</p><button onClick={onBack}>Volver a score</button><button onClick={()=>setView('play')}>Guardar y salir QA</button></section>);
  }
  if(!ready)return <main><p role="status">{message||'Leyendo la tarjeta QA real de nube…'}</p><button onClick={()=>location.reload()}>Reintentar lectura</button></main>;
  return <main style={{maxWidth:680,margin:'auto',padding:12}}>
    <p style={{background:'#ffe0b0',padding:8}}>QA AISLADO · Tarjetas reales guardadas · {mapsEnabled?'Google real bajo demanda':'Mapa simulado, sin solicitudes externas'} · {persistence?'UNA tarjeta QA con persistencia real, sin estadísticas ni borrador principal':'Sin escrituras en tu cuenta'}</p>
    {message&&<p role="status">{message}</p>}
    <p data-testid="qa-play-ledger">{persistence?'QA nube':'Memoria'}: {JSON.stringify({id:qaRecord?.id,saved,edits,saves,index,started,closed})}</p>
    {view==='play'&&<PlayHub activeRound={active} onContinueRound={()=>setView(started?'round':'setup')} onEditRound={()=>setView('setup')} onCancelRound={()=>setConfirm(true)} onFinishRound={finish} onNewRound={fresh} onScoreOnly={fresh} onOpenGps={()=>active?setView(started?'round':'setup'):fresh()} onAiRound={fresh} onTotalScore={fresh} onOpenHistory={noop} onOpenBalances={noop} onOpenPersonalHistory={noop} onOpenStats={noop} onOpenCourses={noop} onOpenGroups={noop} onOpenRules={noop} onOpenStandings={noop} onOpenResults={noop}/>}
    {confirm&&<section role="dialog" aria-label="Descartar / cancelar QA"><h2>{started?'¿Cancelar ronda QA?':'¿Descartar borrador QA?'}</h2><button disabled={busy} onClick={()=>setConfirm(false)}>Conservar</button><button disabled={busy} onClick={()=>{if(started)void cancel();else{setClosed(true);setConfirm(false);}}}>Confirmar QA</button></section>}
    {review&&<section role="dialog" aria-label="Revisar tarjeta vigente antes de cancelar"><h2>La tarjeta cambió en la nube</h2><p>Revisión {review.version} · {JSON.stringify(review.snapshot.scores)}</p><button onClick={()=>setReview(null)}>Conservar mi copia</button><button onClick={()=>{localStorage.setItem(`${qaKey}:preserved:${Date.now()}`,JSON.stringify(snapshot()));currentRound.current=review.snapshot;setQaRecord(review.snapshot);setSaved(review.snapshot.scores||{});setCard(review.snapshot.courseSnapshot||null);setEdits({});localStorage.setItem(`backyard-owner-round-revision:${persistentUserId}:${review.snapshot.id}`,String(review.version));setReview(null);setMessage('Tarjeta vigente cargada. Confirma nuevamente la cancelación.');}}>Cargar tarjeta vigente y revisar</button></section>}
    {view==='setup'&&<RoundSetupWizard key={closed?'fresh':'draft'} storageKey="QA-PLAY-GPS-STEP-ONLY" scoreOnly quickSolo={!started} editing={started} issues={issues} onSave={()=>!busy} onExit={()=>void leave()} onStart={async()=>{if(issues.length||!await write())return false;setStarted(true);setView('round');return true;}}>
      <RoundSetupStep step={1}>{!cards.length?<CatalogCoursePicker token={token} permissionOwnerId="QA-ISOLATED" selectedCourseId={pending?.catalogCourseId} selectedClubId={pending?.catalogClubId} onSelectClub={entry=>setPending({name:entry.clubName,catalogClubId:entry.clubId})} onConfigurationPending={(entry,issue)=>setPending({name:entry.name,catalogClubId:entry.clubId,catalogCourseId:entry.id,selectionIssue:issue})} onSelect={(_course,tees)=>{setCards(tees);setCard(null);}} onRequest={name=>setMessage(`Reportar ${name||'campo'}: formulario disponible en la app; QA no envía solicitudes.`)} requestCatalog={requestCatalog}/>:<RoundTeePicker courseName={cards[0].name} tees={cards} selectedTeeId={card?roundTeeSelectionId(card):''} onSelect={setCard} onBack={()=>{setCards([]);}} onMissingTee={()=>setMessage('QA no envía solicitudes al club.')}/>}</RoundSetupStep>
      <RoundSetupStep step={2}><p>Un jugador QA · Sin GHIN · HCP desconocido. El score no requiere GHIN.</p></RoundSetupStep><RoundSetupStep step={5}><p>{card?.name} · {card?.teeName}</p></RoundSetupStep>
    </RoundSetupWizard>}
    {view==='round'&&card&&(()=>{
      const hole=card.holes[index],order=card.holes.map(h=>h.number);
      return <RoundCaptureV2 initialGpsOpen course={card} hole={hole} order={order} currentIndex={index} completedHoles={new Set(Object.keys(saved).map(Number))} players={players} ownerId="QA-MEMORY-ONLY" caddiePlanId="free" mode="quick" bets={bets} supplementalBets={[]} scores={{...saved[hole.number],...edits[hole.number]}} putts={{}} advancedStats={{}} roundId={qaRecord?.id||"QA-ISOLATED-NEVER-CLOUD"} shots={[]} counterQuantities={{vipers:{},camels:{},fish:{}}} unitQuantities={{}} playerIndicators={()=>[]} onNavigateHole={setIndex} onModeChange={noop} onScoreChange={(id,value)=>setEdits(rows=>({...rows,[hole.number]:{...rows[hole.number],[id]:value}}))} onPuttsChange={noop} onCounterChange={noop} onUnitDelta={noop} onAdvancedChange={noop} onShotsChange={noop} onOpenLoba={noop} onOpenBallFriend={noop} onOpenScanner={noop} onToggleFullCard={noop} fullCardVisible={false} onOpenStandings={()=>setView('play')} onUndo={noop} undoDisabled onSaveAndAdvance={noop} onSaveHole={saveCurrentHole} saveDisabled={busy} saveLabel="Guardar score" gpsContent={renderGps}/>;
    })()}
  </main>;
}
