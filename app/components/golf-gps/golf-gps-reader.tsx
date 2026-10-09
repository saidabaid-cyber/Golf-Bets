'use client';
import { useEffect, useState } from 'react';
import { GolfGpsView, type GpsRoundContext } from './golf-gps-view';
import styles from './golf-gps.module.css';
import type { GpsCoursesResponse } from '../../../lib/golf-gps/types';

/** Future host passes its ALREADY RESOLVED session token. Does not add an auth
 * provider or modify shared navigation/login. One private read per token; no
 * polling, hole refresh, upstream request or key in the JSON payload. */
export function GolfGpsReader({ token, onBack, initialCourseId, initialPosition, active = true, roundContext, mappingUnavailable }: { token: string | null; onBack?: () => void; initialCourseId?: string; initialPosition?: number; active?: boolean; roundContext?: GpsRoundContext; mappingUnavailable?: boolean }) {
  const [result, setResult] = useState<{ token: string; body: GpsCoursesResponse | null; error: string } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!token || mappingUnavailable) return;
    const controller = new AbortController(); let active = true;
    const timeout = window.setTimeout(() => { controller.abort(); if (active) setResult({ token, body: null, error: 'La lectura privada tardó demasiado. Puedes reintentar.' }); }, 12000);
    void fetch('/api/golf-gps/courses', { headers: { authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal }).then(async response => {
      const body = await response.json(); if (!active || controller.signal.aborted) return;
      if (response.ok && body.schemaVersion === 1 && Array.isArray(body.courses)) setResult({ token, body, error: '' });
      else setResult({ token, body: null, error: body.error || 'No hay datos GPS guardados disponibles.' });
    }).catch(() => { if (active && !controller.signal.aborted) setResult({ token, body: null, error: 'No pudimos leer los datos guardados. Puedes reintentar.' }); }).finally(() => window.clearTimeout(timeout));
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [token, retry, mappingUnavailable]);
  if (mappingUnavailable) return <section className={styles.root} aria-label="GPS"><p role="status">Esta configuración no tiene una correspondencia comprobada con los hoyos físicos. GPS no disponible; tu tarjeta y scores se conservan.</p>{onBack && <button type="button" onClick={onBack}>Volver al score</button>}</section>;
  const current = result?.token === token ? result : null;
  if (!token || !current) return <section className={styles.root} aria-label="GPS"><p role="status">{token ? 'Leyendo datos GPS guardados…' : 'Esperando una sesión autenticada…'}</p>{onBack ? <button type="button" onClick={onBack}>Volver</button> : null}</section>;
  if (!current.body) return <section className={styles.root} aria-label="GPS"><p role="status">{current.error}</p><button type="button" onClick={() => { setResult(null); setRetry(value => value + 1); }}>Reintentar lectura privada</button>{onBack ? <button type="button" onClick={onBack}>Volver</button> : null}</section>;
  if (initialCourseId && !current.body.courses.some(course => course.id === initialCourseId)) return <section className={styles.root} aria-label="GPS"><p role="status">Este campo no tiene coordenadas GPS guardadas. Tu ronda y scores se conservan.</p>{onBack ? <button type="button" onClick={onBack}>Volver al score</button> : null}</section>;
  return <GolfGpsView courses={current.body.courses} mapsEnabled={current.body.mapsEnabled} onBack={onBack} initialCourseId={initialCourseId} initialPosition={initialPosition} active={active} roundContext={roundContext} />;
}
