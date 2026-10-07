import { PilotLocation, pilotDistance } from './pilot.mjs';
import { mountHoleImage } from './image-view.mjs';

const messages = {
  STOPPED: ['GPS detenido', 'Toca “Usar mi ubicación” para comenzar.'],
  WAITING: ['Buscando ubicación…', 'Permite el acceso a tu ubicación cuando el teléfono lo solicite.'],
  DENIED: ['Permiso de ubicación denegado', 'Habilita ubicación para este sitio en los ajustes de Safari y vuelve a intentar.'],
  UNAVAILABLE: ['Ubicación no disponible', 'Busca un lugar con mejor señal y toca “Usar mi ubicación”.'],
  TIMEOUT: ['No llegó una ubicación a tiempo', 'Puedes volver a intentar; no mostramos una posición anterior como actual.'],
  HTTPS_REQUIRED: ['Se requiere conexión segura', 'La prueba en iPhone necesita el enlace HTTPS del DEV autorizado.'],
  PAUSED: ['GPS en pausa', 'Se detuvo al salir de esta pantalla. Toca “Usar mi ubicación” para recibir una lectura nueva.'],
  STALE: ['Lectura caducada', 'La última posición tiene más de 15 segundos. Esperamos una lectura nueva para calcular.'],
  LOW_ACCURACY: ['Señal imprecisa', 'La precisión reportada supera 30 m. Esperamos una lectura mejor antes de calcular.'],
  INVALID_TIME: ['Hora de lectura inválida', 'No podemos tratar esta lectura como actual.'],
  INVALID_PROVISIONAL_TARGET: ['Objetivo no disponible', 'El objetivo provisional no cumple el contrato de esta prueba.'],
  DISTANCE_UNAVAILABLE: ['Distancia no disponible', 'No pudimos calcular una distancia válida.'],
  PROVISIONAL_DIRECT_DISTANCE: ['Ubicación recibida', 'Distancia horizontal directa al punto marcado; no sigue el trazado del hoyo.'],
  SIMULATED_PROVISIONAL_DISTANCE: ['PRUEBA SIMULADA', 'Esta posición es de automatización. No es GPS físico ni una validación en campo.'],
};

export function mountPilot(root, { target, imageUrl, imageReference, adapter, now = () => Date.now() }) {
  root.classList.add('gpsPilot');
  // Static owned template. Source metadata and readings are inserted with textContent.
  root.innerHTML = `<header class="gpsPilotHeader"><a href="/" aria-label="Volver a The Backyard">←</a><h1>La Vista · Hoyo 1</h1><span>PRUEBA GPS</span></header>
    <p class="gpsPilotWarning">Objetivo provisional; pendiente de comprobar en campo</p>
    <p class="gpsPilotSimulation" hidden>PRUEBA SIMULADA · No es GPS físico</p>
    <figure class="gpsPilotReference">
      <div class="gpsPilotMap" data-map>
        <svg data-map-svg class="gpsPilotMapSvg" role="img" tabindex="0" aria-label="Imagen aérea del hoyo 1. Usa los controles para ampliar y arrastra para desplazar." preserveAspectRatio="xMidYMid meet">
          <image data-raster x="0" y="0" />
          <ellipse data-accuracy-circle fill="#368dff33" stroke="#5faaff" stroke-width="1.5" vector-effect="non-scaling-stroke" />
          <g data-target-marker><title>Objetivo provisional del green; no es la bandera</title><circle fill="#ad781ccc" stroke="white" stroke-width="3" vector-effect="non-scaling-stroke"/><path stroke="white" stroke-width="1.5" vector-effect="non-scaling-stroke"/></g>
          <g data-player-marker><title>Tu ubicación; precisión reportada por el teléfono</title><circle fill="#247beb" stroke="white" stroke-width="3" vector-effect="non-scaling-stroke"/></g>
        </svg>
        <div class="gpsPilotImageState" data-image-state role="status"><p data-image-message>Cargando imagen del hoyo…</p><button type="button" data-image-retry hidden>Reintentar imagen</button></div>
        <span class="gpsPilotNorth" aria-label="Norte de la cuadrícula de la fuente">N ↑</span>
        <div class="gpsPilotZoom"><button type="button" data-zoom-in aria-label="Ampliar imagen">+</button><button type="button" data-zoom-out aria-label="Reducir imagen">−</button><span data-zoom-level>1.0×</span></div>
      </div>
      <figcaption><span class="gpsPilotTargetKey">●</span> Objetivo provisional del green <span class="gpsPilotPlayerKey">●</span> Tu ubicación</figcaption>
    </figure>
    <p class="gpsPilotCoverage" data-coverage hidden></p>
    <div class="gpsPilotMapActions"><button type="button" data-full>Ver hoyo completo</button><button type="button" data-center disabled>Centrar mi ubicación</button></div>
    <section class="gpsPilotDistance" aria-label="Distancia directa al objetivo"><div><p>Distancia directa al objetivo</p><strong data-distance>—</strong><span data-unit-label>yd</span><small data-secondary-distance>— metros</small></div><div class="gpsPilotUnits" role="group" aria-label="Unidad de distancia"><button type="button" data-unit="yards" aria-pressed="true">Yardas</button><button type="button" data-unit="meters" aria-pressed="false">Metros</button></div></section>
    <section class="gpsPilotStatus" role="status" aria-live="polite"><h2 data-status>GPS detenido</h2><p data-message>Toca “Usar mi ubicación” para comenzar.</p></section>
    <div class="gpsPilotSignal"><span>Precisión <b data-accuracy>—</b></span><span>Lectura <b data-age>—</b></span><span>Permiso <b data-permission>Pendiente</b></span></div>
    <div class="gpsPilotActions"><button type="button" data-start>Usar mi ubicación</button><button type="button" data-stop disabled>Detener GPS</button></div>
    <details class="gpsPilotTechnical"><summary>Fuente y detalles de esta prueba</summary><p>Fuente: INEGI, ortofoto E14B43d4, enero de 2010. Recorte propio con atribución. La imagen cubre el trazado candidato y su contexto, desde la zona de salida hasta el green; no delimita oficialmente el hoyo.</p><p>El punto marcado es el objetivo provisional del green, no una bandera ni un centro exacto verificado. La conversión entre la ortofoto ITRF92/UTM 14N y WGS84 es aproximada, sin corrección de datum o época. Su incertidumbre absoluta es desconocida. La precisión indicada pertenece al teléfono; el círculo azul no incluye la incertidumbre de la ortofoto.</p><p>Distancia horizontal directa, no yardaje de tarjeta ni distancia siguiendo el trazado. Tu posición se calcula aquí; no se guarda ni se envía. Sin Mapbox, ajustes por elevación o seguimiento en segundo plano.</p></details>`;
  const el = name => root.querySelector(`[data-${name}]`);
  const holeImage = mountHoleImage(root, { target, imageUrl, imageReference });
  const browserAdapter = adapter || { geolocation: navigator.geolocation,
    permissions: navigator.permissions, secure: window.isSecureContext, simulated: false };
  let snapshot = { status: 'STOPPED', permission: 'unknown', reading: null, active: false };
  const permissions = { unknown: 'Pendiente', prompt: 'Pendiente', denied: 'Denegado', granted: 'Concedido' };
  let unit = 'yards';
  function render() {
    const result = snapshot.active && snapshot.reading ? pilotDistance(snapshot.reading, target, now()) : null;
    const status = result?.status || snapshot.status;
    const text = messages[status] || messages.UNAVAILABLE;
    const number = value => value == null ? '—' : Math.round(value).toLocaleString('es-MX');
    el('distance').textContent = number(result?.[unit]);
    el('unit-label').textContent = unit === 'yards' ? 'yd' : 'm';
    el('secondary-distance').textContent = unit === 'yards' ? `${number(result?.meters)} metros` : `${number(result?.yards)} yardas`;
    const r = snapshot.reading;
    el('accuracy').textContent = Number.isFinite(r?.accuracyMeters) ? `±${Math.round(r.accuracyMeters)} m` : '—';
    el('age').textContent = Number.isFinite(r?.timestamp) ? `${Math.max(0, Math.floor((now() - r.timestamp) / 1000))} s` : '—';
    el('permission').textContent = permissions[snapshot.permission] || 'Pendiente';
    el('status').textContent = text[0]; el('message').textContent = text[1];
    el('stop').disabled = !snapshot.active;
    // Do not restart a good/waiting watch when tapped repeatedly. Error retries
    // explicitly replace the old watch; never run two subscriptions at once.
    el('start').disabled = snapshot.active && !['TIMEOUT', 'UNAVAILABLE'].includes(snapshot.status);
    holeImage.update(result?.meters == null ? null : snapshot.reading);
    root.querySelector('.gpsPilotSimulation').hidden = !browserAdapter.simulated;
  }
  const session = new PilotLocation(browserAdapter, state => { snapshot = state; render(); }, now);
  root.querySelectorAll('[data-unit]').forEach(button => button.addEventListener('click', () => {
    unit = button.dataset.unit;
    root.querySelectorAll('[data-unit]').forEach(option => option.setAttribute('aria-pressed', String(option.dataset.unit === unit)));
    render();
  }));
  el('start').addEventListener('click', () => session.start());
  el('stop').addEventListener('click', () => session.stop());
  const pause = () => session.stop('PAUSED');
  const visibility = () => { if (document.hidden) pause(); };
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', pause);
  const timer = window.setInterval(render, 1000);
  void session.initializePermission(); render();
  return () => {
    window.clearInterval(timer); document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('pagehide', pause); session.dispose(); holeImage.dispose(); root.replaceChildren();
  };
}
