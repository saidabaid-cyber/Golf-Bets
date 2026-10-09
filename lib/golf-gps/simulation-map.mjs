import { holePoints, validCoordinate } from './model.mjs';

/** Explicit local QA double, never a fallback for unavailable Google Maps.
 * Grid and straight lines are an instrument test, NOT aerial imagery. */
export function simulationMapFactory(runtime = globalThis.window) {
  return async (container, callbacks) => {
    if (!['http://127.0.0.1:3217', 'http://localhost:3217'].includes(runtime?.location?.origin)) throw Object.assign(Error('LOCAL_QA_ONLY'), { code: 'MAP_ORIGIN_NOT_ALLOWED' });
    const root = runtime.document.createElement('div'); root.className = 'backyardGpsSimulation'; root.setAttribute('aria-label', 'Mapa simulado sin proveedor');
    container.append(root); let scene = null, bounds = null, drag = null, destroyed = false;
    const frame = points => {
      if (!points.length) return;
      const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
      const x = (Math.min(...xs) + Math.max(...xs)) / 2, y = (Math.min(...ys) + Math.max(...ys)) / 2;
      const dx = Math.max(.0005, Math.max(...xs) - Math.min(...xs)) * 1.4, dy = Math.max(.0005, Math.max(...ys) - Math.min(...ys)) * 1.4;
      bounds = [x - dx / 2, y - dy / 2, x + dx / 2, y + dy / 2];
    };
    const project = p => [(p[0] - bounds[0]) / (bounds[2] - bounds[0]) * root.clientWidth, (bounds[3] - p[1]) / (bounds[3] - bounds[1]) * root.clientHeight];
    const inverse = event => { const rect = root.getBoundingClientRect(); return [bounds[0] + (event.clientX - rect.left) / rect.width * (bounds[2] - bounds[0]), bounds[3] - (event.clientY - rect.top) / rect.height * (bounds[3] - bounds[1])]; };
    function draw() {
      if (!scene || !bounds || destroyed) return; root.replaceChildren();
      const svg = runtime.document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none'; root.append(svg);
      for (const [start, end, color] of [[scene.player?.wgs84, scene.target, '#143827'], [scene.target, scene.hole.green.center, '#b48e3e']]) {
        if (!start || !end) continue; const a = project(start), b = project(end);
        const line = runtime.document.createElementNS(svg.namespaceURI, 'line'); for (const [name, value] of Object.entries({ x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: color, 'stroke-width': 3 })) line.setAttribute(name, String(value)); svg.append(line);
      }
      if (scene.player) {
        const p = project(scene.player.wgs84), circle = runtime.document.createElementNS(svg.namespaceURI, 'circle');
        const metersPerPixel = (bounds[3] - bounds[1]) * 111320 / root.clientHeight;
        for (const [name, value] of Object.entries({ cx: p[0], cy: p[1], r: scene.player.accuracyMeters / metersPerPixel, fill: '#69bde533', stroke: '#418eb5' })) circle.setAttribute(name, String(value)); svg.append(circle);
      }
      const marker = (coordinate, label, target = false) => {
        const pixel = project(coordinate), element = runtime.document.createElement(target ? 'button' : 'span'); element.className = 'backyardGpsMapMarker'; element.textContent = label;
        element.style.cssText = `position:absolute;left:${pixel[0]}px;top:${pixel[1]}px;transform:translate(-50%,-50%)`;
        if (target) { element.type = 'button'; element.setAttribute('aria-label', 'Objetivo movible simulado'); element.addEventListener('pointerdown', event => { event.preventDefault(); event.stopPropagation(); drag = event.pointerId; root.setPointerCapture(event.pointerId); });
          element.addEventListener('keydown', event => { const offset = { ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, -8], ArrowDown: [0, 8] }[event.key]; if (!offset) return; event.preventDefault(); callbacks.onTarget([coordinate[0] + offset[0] / root.clientWidth * (bounds[2] - bounds[0]), coordinate[1] - offset[1] / root.clientHeight * (bounds[3] - bounds[1])]); }); }
        root.append(element);
      };
      for (const [role, coordinate] of Object.entries(scene.hole.green)) if (coordinate) marker(coordinate, { front: 'F', center: 'Centro', back: 'B' }[role]);
      for (const reference of scene.hole.references) marker(reference.coordinate, reference.kind.endsWith('TEE') ? 'Tee' : '·');
      if (scene.player) marker(scene.player.wgs84, 'Tú · SIM');
      if (scene.target) marker(scene.target, `◎ ${scene.targetCenterLabel} ${scene.unit} → centro`, true);
      const caption = runtime.document.createElement('span'); caption.className = 'backyardGpsSimulationCaption'; caption.textContent = 'SIMULACIÓN · sin satélite ni solicitudes externas'; root.append(caption);
    }
    const click = event => { if (!bounds || drag !== null || event.target.closest('button')) return; const p = inverse(event); if (validCoordinate(p)) callbacks.onTarget(p); };
    const move = event => { if (drag === event.pointerId && bounds) { event.preventDefault(); callbacks.onTarget(inverse(event)); } };
    const end = () => { drag = null; };
    root.addEventListener('click', click); root.addEventListener('pointermove', move); root.addEventListener('pointerup', end); root.addEventListener('pointercancel', end);
    const resize = new runtime.ResizeObserver(draw); resize.observe(root);
    return { update(value) { scene = value; draw(); }, fitHole(value) { scene = value; frame(holePoints(value.hole)); draw(); }, centerPlayer(coordinate) { const dx = bounds[2] - bounds[0], dy = bounds[3] - bounds[1]; bounds = [coordinate[0] - dx / 2, coordinate[1] - dy / 2, coordinate[0] + dx / 2, coordinate[1] + dy / 2]; draw(); }, destroy() { destroyed = true; resize.disconnect(); root.remove(); } };
  };
}
