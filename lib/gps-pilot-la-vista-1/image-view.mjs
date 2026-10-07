import { accuracyPixelRadius, clampCamera, fullImageCamera, geographicToPixel, insideImage,
  validImageReference, zoomCamera } from './image-geometry.mjs';

export function mountHoleImage(root, { target, imageUrl, imageReference: ref }) {
  const el = name => root.querySelector(`[data-${name}]`);
  const frame = el('map'), svg = el('map-svg'), raster = el('raster');
  const targetMark = el('target-marker'), playerMark = el('player-marker'), accuracy = el('accuracy-circle');
  let camera = fullImageCamera(ref), player = null, ready = false, disposed = false, timer;
  const listeners = [], pointers = new Map(); let gesture = null;
  const on = (node, event, fn, options) => { node.addEventListener(event, fn, options); listeners.push(() => node.removeEventListener(event, fn, options)); };
  const targetPixel = geographicToPixel(target.coordinates, ref);
  const mapped = validImageReference(ref) && insideImage(targetPixel, ref);
  frame.style.aspectRatio = `${ref.width} / ${ref.height}`;
  svg.setAttribute('viewBox', `0 0 ${ref.width} ${ref.height}`);
  raster.setAttribute('width', ref.width); raster.setAttribute('height', ref.height);
  const preloader = new Image();
  function draw() {
    svg.setAttribute('viewBox', `${camera.x} ${camera.y} ${camera.width} ${camera.height}`);
    // Keep symbols touch-legible in screen pixels, without moving their anchors.
    const symbol = 9 * camera.width / ref.width;
    if (mapped) {
      targetMark.setAttribute('transform', `translate(${targetPixel[0]} ${targetPixel[1]})`);
      targetMark.querySelector('circle').setAttribute('r', symbol);
      targetMark.querySelector('path').setAttribute('d', `M${-symbol * 1.6},0 H${symbol * 1.6} M0,${-symbol * 1.6} V${symbol * 1.6}`);
    }
    const inside = mapped && player && insideImage(player.pixel, ref);
    playerMark.hidden = !inside; accuracy.hidden = !inside;
    // SVG's hidden attribute is not consistently honoured in Safari.
    playerMark.style.display = inside ? '' : 'none'; accuracy.style.display = inside ? '' : 'none';
    if (inside) {
      playerMark.setAttribute('transform', `translate(${player.pixel[0]} ${player.pixel[1]})`);
      playerMark.querySelector('circle').setAttribute('r', symbol * .8);
      accuracy.setAttribute('cx', player.pixel[0]); accuracy.setAttribute('cy', player.pixel[1]);
      const radii = accuracyPixelRadius(player.coordinates, player.accuracy, ref);
      accuracy.setAttribute('rx', radii?.[0] || 0); accuracy.setAttribute('ry', radii?.[1] || 0);
    }
    targetMark.style.display = mapped ? '' : 'none';
    el('center').disabled = !ready || !inside;
    el('zoom-in').disabled = !ready || camera.width <= ref.width / 6 + .001;
    el('zoom-out').disabled = !ready || camera.width >= ref.width - .001;
    el('full').disabled = !ready;
    el('coverage').hidden = !player && mapped;
    el('coverage').textContent = !mapped ? 'Superposición no disponible: faltan metadatos geográficos válidos.' :
      inside ? 'Dentro del área visible · superposición provisional' : 'Estás fuera del área del hoyo';
    el('zoom-level').textContent = `${(ref.width / camera.width).toFixed(1)}×`;
  }
  function loadImage() {
    frame.dataset.loadState = 'loading';
    ready = false; svg.style.visibility = 'hidden'; el('image-state').hidden = false; el('image-retry').hidden = true;
    el('image-message').textContent = 'Cargando imagen del hoyo…'; draw();
    const fail = (reason = 'load-error') => {
      if (disposed) return;
      window.clearTimeout(timer); ready = false;
      frame.dataset.loadState = reason;
      el('image-message').textContent = 'No pudimos cargar la imagen. La distancia sigue disponible con GPS válido.';
      el('image-retry').hidden = false; draw();
    };
    // Only same-origin local image assets. No SDK, map style, tile or provider.
    if (new URL(imageUrl, window.location.href).origin !== window.location.origin) { fail(); return; }
    preloader.onload = () => {
      if (disposed) return;
      window.clearTimeout(timer);
      if (preloader.naturalWidth !== ref.width || preloader.naturalHeight !== ref.height) { fail(`dimension-mismatch-${preloader.naturalWidth}x${preloader.naturalHeight}`); return; }
      raster.setAttribute('href', imageUrl); ready = true; svg.style.visibility = 'visible';
      frame.dataset.loadState = 'ready';
      el('image-state').hidden = true; draw();
    };
    preloader.onerror = () => fail();
    window.clearTimeout(timer); timer = window.setTimeout(() => fail('timeout'), 12000);
    preloader.src = imageUrl;
  }
  const center = () => [camera.x + camera.width / 2, camera.y + camera.height / 2];
  function zoom(factor, anchor = center()) { camera = zoomCamera(camera, factor, anchor, ref); draw(); }
  on(el('zoom-in'), 'click', () => zoom(1.5));
  on(el('zoom-out'), 'click', () => zoom(1 / 1.5));
  on(el('full'), 'click', () => { camera = fullImageCamera(ref); draw(); });
  on(el('center'), 'click', () => {
    if (!player || !insideImage(player.pixel, ref)) return;
    const width = ref.width / 2, height = ref.height / 2;
    camera = clampCamera({ x: player.pixel[0] - width / 2, y: player.pixel[1] - height / 2, width, height }, ref); draw();
  });
  on(el('image-retry'), 'click', loadImage);
  function resetGesture() {
    const points = [...pointers.values()];
    if (!points.length) { gesture = null; return; }
    const mid = points.length === 1 ? points[0] : [(points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2];
    const box = frame.getBoundingClientRect();
    gesture = { camera: { ...camera }, mid, anchor: [camera.x + (mid[0] - box.left) * camera.width / box.width,
      camera.y + (mid[1] - box.top) * camera.height / box.height], distance: points.length > 1 ? Math.hypot(points[0][0] - points[1][0], points[0][1] - points[1][1]) : 0 };
  }
  on(svg, 'pointerdown', e => {
    if (!ready || (e.pointerType === 'mouse' && e.button !== 0)) return;
    pointers.set(e.pointerId, [e.clientX, e.clientY]); svg.setPointerCapture(e.pointerId); resetGesture();
  });
  on(svg, 'pointermove', e => {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    const points = [...pointers.values()], box = frame.getBoundingClientRect();
    const mid = points.length === 1 ? points[0] : [(points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2];
    let next = gesture.camera;
    if (points.length > 1 && gesture.distance > 0) next = zoomCamera(next,
      Math.hypot(points[0][0] - points[1][0], points[0][1] - points[1][1]) / gesture.distance, gesture.anchor, ref);
    camera = clampCamera({ ...next, x: next.x - (mid[0] - gesture.mid[0]) * next.width / box.width,
      y: next.y - (mid[1] - gesture.mid[1]) * next.height / box.height }, ref); draw();
  });
  const release = e => { pointers.delete(e.pointerId); resetGesture(); };
  on(svg, 'pointerup', release); on(svg, 'pointercancel', release); on(svg, 'lostpointercapture', release);
  on(svg, 'keydown', e => {
    if (!ready) return;
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (delta) { e.preventDefault(); camera = clampCamera({ ...camera, x: camera.x + delta[0] * camera.width / 8,
      y: camera.y + delta[1] * camera.height / 8 }, ref); draw(); }
  });
  loadImage();
  return {
    update(reading) {
      player = reading ? { pixel: geographicToPixel(reading.wgs84, ref), coordinates: reading.wgs84, accuracy: reading.accuracyMeters } : null;
      draw();
    },
    dispose() {
      disposed = true; window.clearTimeout(timer); preloader.onload = null; preloader.onerror = null;
      listeners.forEach(remove => remove()); pointers.clear();
    },
  };
}

