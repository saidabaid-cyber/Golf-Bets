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

export type GolfGpsViewProps = { courses: GpsCourse[]; mapsEnabled: boolean; initialCourseId?: string; initialPosition?: number; mapFactory?: MapFactory; locationAdapter?: LocationAdapter; simulation?: boolean; onBack?: () => void };

/** Isolated GPS surface. No shared navigation, rounds, score or bet imports.
 * Overrides are passed ONLY by the local QA client, never by a query parameter. */
export function GolfGpsView({ courses, mapsEnabled, initialCourseId, initialPosition = 1, mapFactory, locationAdapter, simulation = false, onBack }: GolfGpsViewProps) {
  const [courseId, setCourseId] = useState(initialCourseId ?? courses[0]?.id ?? '');
  const [position, setPosition] = useState(initialPosition);
  const [unit, setUnit] = useState<'m' | 'yd'>('yd');
  const [location, setLocation] = useState(INITIAL_LOCATION);
  const [targetState, setTarget] = useState<{ holeKey: string; coordinate: GpsCoordinate } | null>(null);
  const [mapStatus, setMapStatus] = useState('LOADING');
  const [online, setOnline] = useState(true);
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
  const index = course.holes.indexOf(hole);
  return <main className={styles.root}>
    <header className={styles.header}>{onBack ? <button type="button" onClick={onBack}>← Volver</button> : <span>THE BACKYARD · GPS</span>}<h1>{course.name} · Hoyo {hole.position}</h1></header>
    {simulation ? <p className={styles.simulation}>SIMULACIÓN LOCAL: mapa sin satélite y posición simulada. No es una prueba física ni una carga de Google Maps.</p> : null}
    <p className={styles.warning}>Referencias GolfAPI; precisión y fecha de captura desconocidas. Centro ≠ bandera del día.</p>
    <div className={styles.selectors}><label>Campo<select value={course.id} onChange={event => { setCourseId(event.target.value); setPosition(1); }} aria-label="Campo GPS">{courses.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <label>Hoyo<select value={hole.position} onChange={event => setPosition(Number(event.target.value))} aria-label="Hoyo GPS">{course.holes.map(row => <option key={row.position} value={row.position}>{row.position}{course.physicalHoleCount === 9 && course.cardPositionCount === 18 ? ` · vuelta ${row.lap} · físico ${row.physicalNumber}` : ''}</option>)}</select></label></div>
    <div className={styles.holeBar}><button type="button" disabled={index === 0} onClick={() => setPosition(course.holes[index - 1].position)}>← Anterior</button><span>{course.physicalHoleCount === 9 ? `Vuelta ${hole.lap} · físico ${hole.physicalNumber}` : `${hole.position} de ${course.cardPositionCount}`}</span><button type="button" disabled={index === course.holes.length - 1} onClick={() => setPosition(course.holes[index + 1].position)}>Siguiente →</button></div>
    <section className={styles.mapArea} aria-label="Mapa y objetivo del hoyo"><div ref={mapElement} className={styles.map} data-testid="gps-map" />
      {mapStatus !== 'READY' ? <div className={styles.mapMessage} role="status">{MAP_LABELS[mapStatus] ?? MAP_LABELS.MAP_ERROR}</div> : null}
      {!online ? <div className={styles.offline} role="status">Sin conexión. GPS y cálculos locales pueden seguir disponibles; el mapa remoto puede faltar.</div> : null}</section>
    <div className={styles.mapControls}><button type="button" disabled={mapStatus !== 'READY'} onClick={() => mapSession.current?.fitHole()}>Ver hoyo</button><button type="button" disabled={!player || mapStatus !== 'READY'} onClick={() => mapSession.current?.centerPlayer()}>Centrar en mí</button></div>
    {!hole.references.some(row => row.kind.endsWith('TEE')) ? <p className={styles.note}>Encuadre de referencias del green. No hay coordenadas de tees para este hoyo.</p> : null}
    <div className={styles.distanceHeader}><span>Distancia directa desde tu ubicación</span><div aria-label="Unidad de distancia"><button type="button" aria-pressed={unit === 'yd'} onClick={() => setUnit('yd')}>Yardas</button><button type="button" aria-pressed={unit === 'm'} onClick={() => setUnit('m')}>Metros</button></div></div>
    <div className={styles.distances}>{(['front', 'center', 'back'] as const).map(role => <div key={role}><span>{{ front: 'Frente', center: 'Centro', back: 'Fondo' }[role]}</span><strong>{displayDistance(distances[role], unit)}</strong><small>{unit}</small></div>)}</div>
    <p className={styles.gpsState} role="status">{GPS_LABELS[location.status] ?? 'Ubicación no disponible'}{location.simulated ? ' · SIMULADA' : ''}<br /><small>Permiso: {location.permission === 'granted' ? 'concedido' : location.permission === 'denied' ? 'denegado' : 'sin resolver'}{location.reading ? ` · ±${Math.round(location.reading.accuracyMeters)} m · hace ${Math.round(location.ageSeconds ?? 0)} s` : ''}</small></p>
    <div className={styles.gpsControls}><button type="button" className={styles.primary} disabled={location.active} onClick={() => gpsSession.current?.start()}>Usar mi ubicación</button><button type="button" disabled={!location.active && location.status !== 'SUSPENDED'} onClick={() => gpsSession.current?.stop()}>Detener GPS</button></div>
    <section className={styles.target}><div><h2>Objetivo movible</h2><button type="button" disabled={!target} onClick={() => setTarget(null)}>Quitar objetivo</button></div><p>Toca el mapa y arrastra el objetivo. No representa la bandera.</p><dl><div><dt>Tú → objetivo</dt><dd>{displayDistance(distances.playerTarget, unit)} {unit}</dd></div><div><dt>Objetivo → centro</dt><dd>{displayDistance(distances.targetCenter, unit)} {unit}</dd></div></dl></section>
    <details className={styles.details}><summary>Fuente y límites</summary><p>GolfAPI, registro actualizado {course.source.recordUpdatedAt?.slice(0, 10) ?? 'sin fecha conocida'}. Esta fecha no indica cuándo se midieron las coordenadas. Los puntos no están comprobados en campo. Frente y fondo son referencias fijas del proveedor.</p>
      <p>No hay ajustes por elevación, viento, rutas ni “plays like”. La posición no se guarda ni se envía a nuestra base. Señal válida: antigüedad máxima 15 s, precisión reportada hasta 30 m. Al ocultar esta pantalla se detiene el seguimiento y al volver se pide una lectura nueva.</p>
      {course.physicalHoleCount === 9 && course.cardPositionCount === 18 ? <p>Nueve hoyos físicos, dos vueltas. Conservamos las coordenadas de ambas posiciones sin promediarlas. Diferencias entre vueltas: {Object.entries(hole.pairingDifferencesMeters ?? {}).map(([key, value]) => `${key}: ${value === null ? 'sin dato' : value.toFixed(2) + ' m'}`).join(' · ')}. Revisión física pendiente.</p> : null}
      <p>Google conserva sus atribuciones en el mapa. Fecha de imagen satelital no comprobada. Esta vista no inicia ni modifica rondas.</p></details>
  </main>;
}
