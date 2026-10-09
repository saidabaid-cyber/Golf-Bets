'use client';
import { useEffect, useMemo, useState } from 'react';
import type { GpsCourse } from '../../../lib/golf-gps/types';
import { simulationMapFactory } from '../../../lib/golf-gps/simulation-map.mjs';
import type { LocationAdapter } from '../../../lib/golf-gps/location.mjs';
import { GolfGpsView } from './golf-gps-view';

export function GolfGpsLocalQa({ courses }: { courses: GpsCourse[] }) {
  const [scenario, setScenario] = useState('valid');
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
  return <><div style={{ padding: 12, maxWidth: 680, margin: 'auto', background: '#ffe0b0' }}><label>QA local: escenario simulado <select aria-label="Escenario GPS simulado" value={scenario} onChange={event => setScenario(event.target.value)}>{[['valid', 'Señal válida'], ['denied', 'Permiso denegado'], ['timeout', 'Timeout'], ['stale', 'Lectura antigua'], ['inaccurate', 'Poca precisión']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><p data-testid="gps-resource-audit" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>Recursos observados: {Object.entries(resourceHosts).map(([host, count]) => `${host} (${count})`).join(', ') || 'pendiente'}. GolfAPI / Google Maps / Mapbox: {Object.entries(resourceHosts).filter(([host]) => /golfapi\.io|googleapis\.com|gstatic\.com|mapbox\.com/.test(host)).reduce((sum, [, count]) => sum + count, 0)}.</p></div><GolfGpsView courses={courses} mapsEnabled={false} mapFactory={factory} locationAdapter={adapter} simulation /></>;
}
