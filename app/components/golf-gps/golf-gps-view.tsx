'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { GpsCoordinate, GpsCourse } from '../../../lib/golf-gps/types';
import { GpsLocationSession, browserLocationAdapter, type LocationAdapter, type LocationState } from '../../../lib/golf-gps/location.mjs';
import { gpsMeasurements, liveReading, displayDistance } from '../../../lib/golf-gps/model.mjs';
import { GpsMapSession, type MapFactory } from '../../../lib/golf-gps/map-session.mjs';
import { googleMapsFactory } from '../../../lib/golf-gps/google-maps.mjs';
import styles from './golf-gps.module.css';

const INITIAL_LOCATION: LocationState = { status: 'STOPPED', permission: 'unknown', reading: null, active: false, simulated: false, ageSeconds: null };
const GPS_LABELS: Record<string, string> = { STOPPED: 'GPS detenido', WAITING: 'Buscando ubicación…', LIVE_REPORTED: 'Ubicación recibida', DENIED: 'Permiso de ubicación denegado', UNAVAILABLE: 'Ubicación no disponible', TIMEOUT: 'Se agotó el tiempo; esperando señal', STALE: 'Ubicación antigua; distancias pausadas', LOW_ACCURACY: 'Poca precisión; distancias pausadas', INVALID_TIME: 'Hora de ubicación inválida', SUSPENDED: 'GPS pausado mientras la pantalla está oculta', HTTPS_REQUIRED: 'GPS requiere HTTPS' };
const MAP_LABELS: Record<string, string> = { LOADING: 'Cargando mapa…', MAP_DISABLED: 'Mapa desactivado. GPS y distancias siguen disponibles.', MAP_ORIGIN_NOT_ALLOWED: 'Google Maps se probará únicamente en DEV tras la integración.', MAP_KEY_MISSING: 'Falta configurar NEXT_PUBLIC_GOOGLE_MAPS_API_KEY.', MAP_OFFLINE: 'Sin conexión para cargar el mapa.', MAP_AUTH_OR_QUOTA_ERROR: 'Google rechazó el acceso o la cuota. No se reintentará automáticamente.', MAP_LOAD_TIMEOUT: 'La carga del mapa tardó demasiado. No se reintentará automáticamente.', MAP_NETWORK_ERROR: 'No se pudo cargar el mapa. No se reintentará automáticamente.', MAP_ERROR: 'Mapa no disponible; las distancias siguen funcionando.' };

export type GpsRoundContext = { roundId: string; name: string; teeName: string; holes: { number: number; par: number; yards?: number }[]; onScore: (position: number) => void; onNavigate?: (position: number) => void; onExit?: () => void; onFinish?: () => void };
export type GolfGpsViewProps = { courses: GpsCourse[]; mapsEnabled: boolean; initialCourseId?: string; initialPosition?: number; mapFactory?: MapFactory; locationAdapter?: LocationAdapter; simulation?: boolean; onBack?: () => void; active?: boolean; roundContext?: GpsRoundContext };

/** Isolated GPS surface. No shared navigation, rounds, score or bet imports.
 * Overrides are passed ONLY by the local QA client, never by a query parameter. */
export function GolfGpsView({ courses, mapsEnabled, initialCourseId, initialPosition = 1, mapFactory, locationAdapter, simulation = false, onBack, active = true, roundContext }: GolfGpsViewProps) {
  const [courseId, setCourseId] = useState(initialCourseId ?? courses[0]?.id ?? '');
  const [position, setPosition] = useState(initialPosition);
  const [unit, setUnit] = useState<'m' | 'yd'>('yd');
  const [location, setLocation] = useState(INITIAL_LOCATION);
  const [targetState, setTarget] = useState<{ holeKey: string; coordinate: GpsCoordinate } | null>(null);
  const [mapStatus, setMapStatus] = useState('LOADING');
  const [online, setOnline] = useState(true);
  const [infoOpen, setInfoOpen] = useState(false);
  const [roundMenuOpen, setRoundMenuOpen] = useState(false);
  const mapElement = useRef<HTMLDivElement>(null), mapSession = useRef<GpsMapSession | null>(null), gpsSession = useRef<GpsLocationSession | null>(null);
  const course = courses.find(row => row.id === courseId) ?? courses[0];
  const hole = course?.holes.find(row => row.position === position) ?? course?.holes[0];
  const holeKey = `${course?.id}:${hole?.position}`;
  const holeKeyRef = useRef(holeKey);
  const target = targetState?.holeKey === holeKey ? targetState.coordinate : null;
  const distances = gpsMeasurements(hole ?? null, location, target);
  const player = liveReading(location);
  const factory = useMemo(() => mapFactory ?? googleMapsFactory({ enabled: mapsEnabled, apiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '' }), [mapFactory, mapsEnabled]);

  useEffect(() => { holeKeyRef.current = holeKey; }, [holeKey]);
  useEffect(() => {
    // A score-hole change updates context without rebuilding the map instance.
    setPosition(initialPosition);
    if (initialCourseId) setCourseId(initialCourseId);
  }, [initialCourseId, initialPosition]);
  useEffect(() => {
    const session = new GpsLocationSession(locationAdapter ?? browserLocationAdapter(), setLocation); gpsSession.current = session;
    return () => { session.dispose(); gpsSession.current = null; };
  }, [locationAdapter]);
  useEffect(() => {
    if (!active) { gpsSession.current?.stop(); return; }
    const previous = document.body.style.overflow; document.body.style.overflow = 'hidden';
    mapSession.current?.resize(); return () => { document.body.style.overflow = previous; };
  }, [active]);
  useEffect(() => {
    if (!mapElement.current) return;
    const observer = new ResizeObserver(() => mapSession.current?.resize());
    observer.observe(mapElement.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine); update();
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  useEffect(() => {
    if (!mapElement.current || !courses.length) return;
    const session = new GpsMapSession(factory, setMapStatus); mapSession.current = session;
    void session.open(mapElement.current, { onTarget: coordinate => setTarget({ holeKey: holeKeyRef.current, coordinate }), onError: setMapStatus });
    return () => { session.dispose(); mapSession.current = null; };
  }, [factory, courses.length]);
  useEffect(() => {
    if (hole) mapSession.current?.update({ holeKey, hole, player, target, unit, playerTargetLabel: displayDistance(distances.playerTarget, unit), targetCenterLabel: displayDistance(distances.targetCenter, unit) });
  }, [holeKey, hole, player, target, unit, distances.playerTarget, distances.targetCenter]);

  if (!course || !hole) return <section className={styles.root}><h1>GPS de campo</h1><p>No hay datos guardados disponibles para esta prueba.</p></section>;
  const playableHoles = roundContext ? roundContext.holes.flatMap(card => course.holes.filter(row => row.position === card.number)) : course.holes;
  const index = playableHoles.indexOf(hole);
  function navigateHole(next: number) { setPosition(next); roundContext?.onNavigate?.(next); }
  const cardHole = roundContext?.holes.find(row => row.number === hole.position);
  const hasTee = hole.references.some(reference => reference.kind.endsWith('TEE'));
  return <main className={styles.root} aria-label="GPS dedicado" data-round-id={roundContext?.roundId}>
    <header className={styles.header}>
      {onBack ? <button type="button" onClick={onBack} aria-label="Volver al score">←</button> : <span>GPS</span>}
      <div><h1>{roundContext?.name ?? course.name}</h1><small>{roundContext ? roundContext.teeName : 'Explorar campo'}</small></div>
      <button type="button" onClick={() => setInfoOpen(true)} aria-label="Información del mapa">ⓘ</button>
    </header>
    {simulation && <p className={styles.simulation}>SIMULACIÓN LOCAL · Sin satélite ni GPS físico</p>}
    {!roundContext && <label className={styles.courseSelect}>Campo<select value={course.id} onChange={event => { setCourseId(event.target.value); setPosition(1); }} aria-label="Campo GPS">{courses.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>}
    <nav className={styles.holeBar} aria-label="Explorar hoyos GPS">
      <button type="button" disabled={index === 0} onClick={() => navigateHole(playableHoles[index - 1].position)} aria-label="Ver hoyo anterior">‹</button>
      <label>Hoyo<select value={hole.position} onChange={event => navigateHole(Number(event.target.value))} aria-label="Hoyo GPS">{playableHoles.map(row => <option key={row.position} value={row.position}>{row.position}{course.physicalHoleCount === 9 ? ` · vuelta ${row.lap}` : ''}</option>)}</select></label>
      <span>{cardHole ? `Par ${cardHole.par}${cardHole.yards ? ` · ${cardHole.yards} yd` : ""}` : course.physicalHoleCount === 9 ? `Físico ${hole.physicalNumber}` : `de ${course.cardPositionCount}`}</span>
      <button type="button" disabled={index === playableHoles.length - 1} onClick={() => navigateHole(playableHoles[index + 1].position)} aria-label="Ver siguiente hoyo">›</button>
    </nav>
    <section className={styles.distances} aria-label="Distancias del jugador al green">{(['front', 'center', 'back'] as const).map(role => <div key={role}><span>{{ front: 'Frente', center: 'Centro del green', back: 'Fondo' }[role]}</span><strong>{displayDistance(distances[role], unit)}</strong><small>{unit}</small></div>)}</section>
    <section className={styles.mapArea} aria-label="Mapa y objetivo del hoyo"><div ref={mapElement} className={styles.map} data-testid="gps-map" />
      {mapStatus !== 'READY' && <div className={styles.mapMessage} role="status">{MAP_LABELS[mapStatus] ?? MAP_LABELS.MAP_ERROR}</div>}
      {!online && <div className={styles.offline} role="status">Sin conexión para mapa remoto. GPS y cálculos locales disponibles.</div>}
      <div className={styles.mapControls}><button type="button" disabled={mapStatus !== 'READY' || !player} onClick={() => mapSession.current?.centerPlayer()}>Centrar en mí</button><button type="button" disabled={mapStatus !== 'READY'} onClick={() => mapSession.current?.fitHole()}>{hasTee ? 'Ver hoyo' : 'Ver zona del hoyo'}</button><button type="button" onClick={() => setUnit(unit === 'yd' ? 'm' : 'yd')} aria-label="Cambiar unidades">{unit === 'yd' ? 'Yardas' : 'Metros'} ⇄</button></div>
    </section>
    <div className={styles.target} aria-label="Distancias del objetivo">{target ? <><span>Tú → objetivo <b>{displayDistance(distances.playerTarget, unit)} {unit}</b> · Objetivo → centro <b>{displayDistance(distances.targetCenter, unit)} {unit}</b></span><button type="button" onClick={() => setTarget(null)} aria-label="Quitar objetivo">×</button></> : <span>Toca para colocar un objetivo; arrástralo para moverlo.{!hasTee ? ' Sin tee/trazado GPS: vista del entorno del green.' : ''}</span>}</div>
    <div className={styles.gpsState} role="status"><b>{GPS_LABELS[location.status] ?? 'Ubicación no disponible'}{location.simulated ? ' · SIMULADA' : ''}</b><small>{location.reading ? `±${Math.round(location.reading.accuracyMeters)} m · hace ${Math.round(location.ageSeconds ?? 0)} s` : 'Activa ubicación para medir desde tu teléfono.'}</small></div>
    <footer className={styles.gpsControls}><button type="button" className={styles.primary} disabled={location.active} onClick={() => gpsSession.current?.start()}>Usar mi ubicación</button><button type="button" disabled={!location.active && location.status !== 'SUSPENDED'} onClick={() => gpsSession.current?.stop()}>Detener GPS</button>{roundContext && <button type="button" disabled={!cardHole} onClick={() => roundContext.onScore(hole.position)}>Anotar score · {hole.position}</button>}</footer>
    {roundContext && <div className={styles.roundTools}><button type="button" onClick={() => setRoundMenuOpen(true)}>Ronda · guardar y salir / finalizar</button></div>}
    {roundMenuOpen && roundContext && <section className={styles.infoBackdrop} role="dialog" aria-modal="true" aria-label="Acciones de la ronda"><div className={styles.info}><h2>Tu ronda</h2><p>Los scores se confirman con Guardar score. Salir conserva también las ediciones pendientes.</p><button type="button" onClick={() => { setRoundMenuOpen(false); roundContext.onExit?.(); }}>Guardar y salir a Play</button><button type="button" onClick={() => { setRoundMenuOpen(false); roundContext.onFinish?.(); }}>Finalizar / revisar tarjeta</button><button type="button" onClick={() => setRoundMenuOpen(false)}>Seguir jugando</button></div></section>}
    {infoOpen && <section className={styles.infoBackdrop} role="dialog" aria-modal="true" aria-label="Información del mapa"><div className={styles.info}><button type="button" onClick={() => setInfoOpen(false)}>Cerrar información</button><h2>Información del mapa</h2><p>Referencias GolfAPI; precisión y fecha de captura desconocidas. Centro del green ≠ bandera del día. Validación en campo pendiente.</p>{course.source.mappingEvidence && <p>{course.source.mappingEvidence}</p>}<p>Registro actualizado {course.source.recordUpdatedAt?.slice(0, 10) ?? 'sin fecha conocida'}. Esta fecha no es la de medición ni la de imagen satelital.</p><p>Frente y fondo son referencias fijas del proveedor. No hay ajustes por viento, elevación ni “plays like”. Tu posición no se guarda ni se envía a nuestra base. Señal útil: máximo 15 s de antigüedad y precisión reportada hasta 30 m.</p><p>Al cerrar el GPS se detiene el seguimiento; actívalo de nuevo al volver. No hay captura en segundo plano. Puedes mover el objetivo con las flechas del teclado cuando tiene foco.</p>{course.physicalHoleCount === 9 && <p>Nueve hoyos físicos, dos vueltas. Diferencias de observación: {Object.entries(hole.pairingDifferencesMeters ?? {}).map(([key, value]) => `${key}: ${value === null ? 'sin dato' : value.toFixed(2) + ' m'}`).join(' · ')}. Revisión física pendiente.</p>}<p>Google conserva sus atribuciones. Explorar hoyos no guarda scores ni cambia la configuración de la ronda.</p></div></section>}
  </main>;
}
