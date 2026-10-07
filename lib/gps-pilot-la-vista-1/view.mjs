import { PilotLocation, pilotDistance } from './pilot.mjs';

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

export function mountPilot(root, { target, imageUrl, adapter, now = () => Date.now() }) {
  root.classList.add('gpsPilot');
  // Static owned template. Source metadata and readings are inserted with textContent.
  root.innerHTML = `<header class="gpsPilotHeader"><a href="/">← The Backyard</a><span>PRUEBA GPS</span></header>
    <section class="gpsPilotIntro"><p class="gpsPilotEyebrow">LA VISTA COUNTRY CLUB</p><h1>La Vista — Hoyo 1</h1><p>Distancia al objetivo provisional del green</p></section>
    <p class="gpsPilotWarning">Objetivo provisional; pendiente de comprobar en campo</p>
    <p class="gpsPilotSimulation" hidden>PRUEBA SIMULADA · No es GPS físico</p>
    <section class="gpsPilotDistance" aria-label="Distancia directa al objetivo"><p>Distancia directa</p><div><strong data-yards>—</strong><span>yd</span></div><p><b data-meters>—</b> metros</p></section>
    <section class="gpsPilotSignal"><p>Precisión reportada <b data-accuracy>—</b></p><p>Antigüedad <b data-age>—</b></p><p>Permiso <b data-permission>Pendiente</b></p></section>
    <section class="gpsPilotStatus" role="status" aria-live="polite"><h2 data-status>GPS detenido</h2><p data-message>Toca “Usar mi ubicación” para comenzar.</p></section>
    <div class="gpsPilotActions"><button type="button" data-start>Usar mi ubicación</button><button type="button" data-stop disabled>Detener GPS</button></div>
    <figure class="gpsPilotReference"><img alt="Ortofoto INEGI del trazado candidato del hoyo 1, con el punto provisional señalado dentro del green"/><figcaption>El círculo marca el punto candidato, no la bandera. Fuente: INEGI, ortofoto E14B43d4, enero de 2010. Recorte y señalamiento propios.</figcaption></figure>
    <p class="gpsPilotNote">La precisión del objetivo no está comprobada. La ortofoto es de 2010 y su conversión al sistema del teléfono es aproximada. La precisión indicada corresponde únicamente a la ubicación reportada por tu dispositivo.</p>
    <p class="gpsPilotNote">Tu posición se calcula en este dispositivo; no se guarda ni se envía. No hay Mapbox ni ajustes por elevación, viento o condiciones.</p>`;
  const el = name => root.querySelector(`[data-${name}]`);
  const image = root.querySelector('img'); image.src = imageUrl;
  image.addEventListener('error', () => { image.alt = 'No se pudo cargar la imagen de referencia; no confirma la identidad del green.'; });
  const browserAdapter = adapter || { geolocation: navigator.geolocation,
    permissions: navigator.permissions, secure: window.isSecureContext, simulated: false };
  let snapshot = { status: 'STOPPED', permission: 'unknown', reading: null, active: false };
  const permissions = { unknown: 'Pendiente', prompt: 'Pendiente', denied: 'Denegado', granted: 'Concedido' };
  function render() {
    const result = snapshot.active && snapshot.reading ? pilotDistance(snapshot.reading, target, now()) : null;
    const status = result?.status || snapshot.status;
    const text = messages[status] || messages.UNAVAILABLE;
    el('yards').textContent = result?.yards == null ? '—' : Math.round(result.yards).toLocaleString('es-MX');
    el('meters').textContent = result?.meters == null ? '—' : Math.round(result.meters).toLocaleString('es-MX');
    const r = snapshot.reading;
    el('accuracy').textContent = Number.isFinite(r?.accuracyMeters) ? `±${Math.round(r.accuracyMeters)} m` : '—';
    el('age').textContent = Number.isFinite(r?.timestamp) ? `${Math.max(0, Math.floor((now() - r.timestamp) / 1000))} s` : '—';
    el('permission').textContent = permissions[snapshot.permission] || 'Pendiente';
    el('status').textContent = text[0]; el('message').textContent = text[1];
    el('stop').disabled = !snapshot.active;
    root.querySelector('.gpsPilotSimulation').hidden = !browserAdapter.simulated;
  }
  const session = new PilotLocation(browserAdapter, state => { snapshot = state; render(); }, now);
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
    window.removeEventListener('pagehide', pause); session.dispose(); root.replaceChildren();
  };
}
