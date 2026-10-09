import { holePoints, holeViewport, validCoordinate } from './model.mjs';
import { MapTapGuard } from './touch.mjs';

const loaders = new WeakMap();
const fail = code => Object.assign(new Error(code), { code });
export function googleMapGate({ enabled, apiKey, origin, online = true }) {
  if (!enabled) return 'MAP_DISABLED';
  if (origin !== 'https://dev.thebackyard.com.mx') return 'MAP_ORIGIN_NOT_ALLOWED';
  if (!apiKey?.trim()) return 'MAP_KEY_MISSING';
  if (!online) return 'MAP_OFFLINE';
  return null;
}

/** On-demand Maps JS only. No import side effect, prefetch, other Google API,
 * Mapbox or upstream GolfAPI. Deduplicated per window; failures stay failed.
 * A browser key is necessarily sent to Google, never to logs/our API. */
export function loadGoogleMaps(options, runtime = globalThis.window) {
  const denied = googleMapGate({ ...options, origin: runtime?.location?.origin, online: runtime?.navigator?.onLine !== false });
  if (denied) return Promise.reject(fail(denied));
  if (loaders.has(runtime)) {
    const existing = loaders.get(runtime);
    return existing.failed ? Promise.reject(fail(existing.failureCode)) : existing.promise;
  }
  if (runtime.google?.maps?.Map && runtime.google.maps.OverlayView) return Promise.resolve(runtime.google.maps);
  const state = { promise: null, listeners: new Set(), failed: false, failureCode: null };
  const previousAuth = runtime.gm_authFailure;
  state.promise = new Promise((resolve, reject) => {
    const script = runtime.document.createElement('script');
    const timeout = runtime.setTimeout(() => failure('MAP_LOAD_TIMEOUT'), 15000);
    function failure(code) {
      state.failed = true; state.failureCode = code; runtime.clearTimeout(timeout); reject(fail(code));
      for (const listener of state.listeners) listener(code);
    }
    runtime.gm_authFailure = () => { failure('MAP_AUTH_OR_QUOTA_ERROR'); previousAuth?.(); };
    runtime.__backyardGpsGoogleReady = () => {
      runtime.clearTimeout(timeout);
      if (state.failed) return;
      if (!runtime.google?.maps?.Map || !runtime.google.maps.OverlayView) { failure('MAP_SDK_INCOMPLETE'); return; }
      resolve(runtime.google.maps);
    };
    const url = new URL('https://maps.googleapis.com/maps/api/js');
    url.search = new URLSearchParams({ key: options.apiKey, v: 'quarterly', loading: 'async', callback: '__backyardGpsGoogleReady', language: 'es', region: 'MX' }).toString();
    script.async = true; script.src = url.toString();
    script.nonce = runtime.document.querySelector('script[nonce]')?.nonce ?? '';
    script.onerror = () => failure('MAP_NETWORK_ERROR');
    runtime.document.head.append(script);
  });
  loaders.set(runtime, state);
  return state.promise;
}

const latLng = coordinate => ({ lat: coordinate[1], lng: coordinate[0] });
const fromLatLng = value => [value.lng(), value.lat()];

/** OverlayView avoids deprecated Marker and the requirement to create/configure
 * a new Map ID just for this phase. Pointer/keyboard dragging is local. */
export function googleMapsFactory(options, runtime = globalThis.window) {
  return async (container, callbacks, signal, initialScene) => {
    const initialCenter = initialScene?.hole.green.center ?? holePoints(initialScene?.hole)[0];
    if (!initialCenter) throw fail('MAP_GEOMETRY_MISSING');
    const maps = await loadGoogleMaps(options, runtime);
    if (signal?.aborted) throw fail('MAP_CANCELED');
    const loader = loaders.get(runtime); loader?.listeners.add(callbacks.onError);
    const map = new maps.Map(container, { mapTypeId: 'satellite', zoom: 18, center: latLng(initialCenter), tilt: 0, streetViewControl: false, fullscreenControl: false, mapTypeControl: false, zoomControl: true, gestureHandling: 'greedy', clickableIcons: false });
    runtime.console?.info?.('[GPS] Google Maps initialized'); // No token or personal coordinates.
    let destroyed = false, target = null, player = null; const anchors = [];
    const tap = new MapTapGuard();
    const pointerDown = event => tap.down(event, Boolean(event.target?.closest?.('.backyardGpsMapMarker')));
    const pointerMove = event => tap.move(event);
    const pointerUp = event => tap.up(event);
    const pointerCancel = event => tap.up(event, true);
    const pointerListeners = { pointerdown: pointerDown, pointermove: pointerMove, pointerup: pointerUp, pointercancel: pointerCancel };
    for (const [name, listener] of Object.entries(pointerListeners)) container.addEventListener(name, listener, { capture: true, passive: true });
    const drag = map.addListener('dragstart', () => tap.suppress());
    let currentHole = null;
    const circle = new maps.Circle({ map, radius: 0, fillColor: '#54a9db', fillOpacity: .15, strokeColor: '#54a9db', strokeOpacity: .6, strokeWeight: 1, clickable: false });
    const playerLine = new maps.Polyline({ map, path: [], strokeColor: '#ffffff', strokeWeight: 3, clickable: false, geodesic: true });
    const greenLine = new maps.Polyline({ map, path: [], strokeColor: '#d7b76d', strokeWeight: 3, clickable: false, geodesic: true });
    class Anchor extends maps.OverlayView {
      constructor(coordinate, label, draggable = false) {
        super(); this.coordinate = coordinate;
        this.element = runtime.document.createElement(draggable ? 'button' : 'span');
        this.element.className = 'backyardGpsMapMarker'; this.element.textContent = label; this.element.title = label;
        this.element.style.position = 'absolute'; this.element.style.transform = 'translate(-50%,-50%)';
        if (draggable) {
          this.element.type = 'button'; this.element.setAttribute('aria-label', 'Objetivo movible. Arrastra o usa las flechas del teclado');
          this.element.style.touchAction = 'none';
          this.element.addEventListener('pointerdown', event => {
            if (this.drag) return;
            event.preventDefault(); event.stopPropagation();
            this.drag = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, pixel: this.getProjection().fromLatLngToDivPixel(new maps.LatLng(latLng(this.coordinate))) };
            this.element.setPointerCapture(event.pointerId); map.setOptions({ draggable: false });
          });
          this.element.addEventListener('pointermove', event => {
            if (!this.drag || event.pointerId !== this.drag.pointerId) return; event.preventDefault(); event.stopPropagation();
            this.movePixel(new maps.Point(this.drag.pixel.x + event.clientX - this.drag.clientX, this.drag.pixel.y + event.clientY - this.drag.clientY));
          });
          const release = event => { if (this.drag && event.pointerId === this.drag.pointerId) { event.stopPropagation(); this.drag = null; map.setOptions({ draggable: true }); } };
          this.element.addEventListener('pointerup', release); this.element.addEventListener('pointercancel', release);
          this.element.addEventListener('lostpointercapture', release);
          this.element.addEventListener('keydown', event => {
            const offsets = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
            if (!offsets) return; event.preventDefault(); event.stopPropagation();
            const pixel = this.getProjection().fromLatLngToDivPixel(new maps.LatLng(latLng(this.coordinate))), step = event.shiftKey ? 40 : 8;
            this.movePixel(new maps.Point(pixel.x + offsets[0] * step, pixel.y + offsets[1] * step));
          });
        }
        maps.OverlayView.preventMapHitsAndGesturesFrom(this.element); this.setMap(map);
      }
      movePixel(pixel) { const value = this.getProjection().fromDivPixelToLatLng(pixel); if (value) { const coordinate = fromLatLng(value); if (validCoordinate(coordinate)) { this.coordinate = coordinate; this.draw(); callbacks.onTarget(coordinate); } } }
      onAdd() { this.getPanes().overlayMouseTarget.append(this.element); }
      draw() { const projection = this.getProjection(); if (!projection) return; const pixel = projection.fromLatLngToDivPixel(new maps.LatLng(latLng(this.coordinate))); if (pixel) { this.element.style.left = `${pixel.x}px`; this.element.style.top = `${pixel.y}px`; } }
      onRemove() { this.element.remove(); }
      update(coordinate, label) { this.coordinate = coordinate; this.element.textContent = label; this.draw(); }
    }
    const click = map.addListener('click', event => { if (!destroyed && event.latLng && tap.allow()) callbacks.onTarget(fromLatLng(event.latLng)); });
    const clearAnchors = () => { for (const marker of anchors) marker.setMap(null); anchors.length = 0; };
    return {
      update(scene) {
        if (destroyed) return;
        if (currentHole !== scene.holeKey) {
          clearAnchors(); currentHole = scene.holeKey;
          for (const [role, coordinate] of Object.entries(scene.hole.green)) if (coordinate) anchors.push(new Anchor(coordinate, { front: 'F', center: 'Centro', back: 'B' }[role]));
          for (const reference of scene.hole.references) anchors.push(new Anchor(reference.coordinate, reference.kind.endsWith('TEE') ? 'Tee' : '·'));
        }
        if (scene.player) {
          if (!player) player = new Anchor(scene.player.wgs84, 'Tú'); else player.update(scene.player.wgs84, 'Tú');
          circle.setCenter(latLng(scene.player.wgs84)); circle.setRadius(scene.player.accuracyMeters); circle.setMap(map);
        } else { player?.setMap(null); player = null; circle.setMap(null); }
        if (scene.target) {
          const label = `◎ ${scene.targetCenterLabel} ${scene.unit} → centro`;
          if (!target) target = new Anchor(scene.target, label, true); else target.update(scene.target, label);
        } else { target?.setMap(null); target = null; }
        playerLine.setPath(scene.player && scene.target ? [latLng(scene.player.wgs84), latLng(scene.target)] : []);
        greenLine.setPath(scene.target && scene.hole.green.center ? [latLng(scene.target), latLng(scene.hole.green.center)] : []);
      },
      fitHole(scene) {
        const extent = holeViewport(scene.hole, scene.player); if (!extent || destroyed) return;
        const bounds = new maps.LatLngBounds({lat:extent.south,lng:extent.west},{lat:extent.north,lng:extent.east});
        map.fitBounds(bounds, 48);
      },
      centerPlayer(coordinate) { if (!destroyed) map.panTo(latLng(coordinate)); },
      resize() { if (!destroyed) maps.event.trigger(map, 'resize'); },
      destroy() { destroyed = true; loader?.listeners.delete(callbacks.onError); click.remove(); drag.remove(); for (const [name, listener] of Object.entries(pointerListeners)) container.removeEventListener(name, listener, true); clearAnchors(); target?.setMap(null); player?.setMap(null); circle.setMap(null); playerLine.setMap(null); greenLine.setMap(null); maps.event.clearInstanceListeners(map); container.replaceChildren(); },
    };
  };
}
