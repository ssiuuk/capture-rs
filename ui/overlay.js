// One overlay window covers one monitor and shows the frozen screenshot.
// Coordinates: "local" = physical pixels within this monitor; "global" =
// physical pixels on the virtual desktop (what the Rust side expects).

const { invoke, convertFileSrc } = window.__TAURI__.core;
const { emit, listen } = window.__TAURI__.event;
const { getCurrentWindow } = window.__TAURI__.window;

const $ = (id) => document.getElementById(id);
const monitorIndex = Number(new URLSearchParams(location.search).get('monitor'));

const ZOOM = 8;
const LOUPE_CSS = 136;
const LOUPE_SRC = LOUPE_CSS / ZOOM; // 17 source pixels across
const MIN_DRAG = 4; // smaller drags count as a click
const DIM = 0.45;
const FADE_MS = 500; // dimming eases in on open and back out on close

const canvas = $('screen');
const ctx = canvas.getContext('2d');
const loupeCanvas = $('loupe_canvas');
const loupeCtx = loupeCanvas.getContext('2d');

let info; // overlay_init result
let image; // frozen monitor image
let pixels; // 2D context holding the image, for colour lookups
let mode = 'choose'; // 'choose' | 'region' | 'window'
let cursor = null; // local {x, y}
let dragStart = null;
let selection = null; // local {x, y, width, height}
let pending = false; // region drawn, waiting for confirm
let hoverWindow = null;
let finished = false;
let drawQueued = false;
let dim = 0; // current dimming, eased from 0 to DIM when the overlay opens

// ---- geometry -------------------------------------------------------------

const scale = () => info.monitor.bounds.width / window.innerWidth;
const toLocal = (e) => ({
  x: clamp(Math.floor(e.clientX * scale()), 0, info.monitor.bounds.width - 1),
  y: clamp(Math.floor(e.clientY * scale()), 0, info.monitor.bounds.height - 1),
});
const toCss = (v) => v / scale();
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const toGlobal = (r) => ({ x: r.x + info.monitor.bounds.x, y: r.y + info.monitor.bounds.y, width: r.width, height: r.height });
const toLocalRect = (r) => ({ x: r.x - info.monitor.bounds.x, y: r.y - info.monitor.bounds.y, width: r.width, height: r.height });

function rectFromCorners(a, b) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(a.x - b.x) + 1, height: Math.abs(a.y - b.y) + 1 };
}

function windowAt(local) {
  const gx = local.x + info.monitor.bounds.x, gy = local.y + info.monitor.bounds.y;
  return info.windows.find((w) => gx >= w.bounds.x && gx < w.bounds.x + w.bounds.width
    && gy >= w.bounds.y && gy < w.bounds.y + w.bounds.height) || null;
}

// ---- drawing --------------------------------------------------------------

function requestDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; draw(); });
}

function highlightRect() {
  if (selection) return selection;
  if (hoverWindow && mode !== 'choose') return toLocalRect(hoverWindow.bounds);
  return null;
}

function draw() {
  const { width, height } = canvas;
  ctx.drawImage(image, 0, 0);
  ctx.fillStyle = `rgba(0, 0, 0, ${dim})`;
  ctx.fillRect(0, 0, width, height);

  const px = Math.max(1, Math.round(scale()));
  const r = highlightRect();
  if (r) {
    const x = clamp(r.x, 0, width), y = clamp(r.y, 0, height);
    const w = clamp(r.x + r.width, 0, width) - x, h = clamp(r.y + r.height, 0, height) - y;
    if (w > 0 && h > 0) {
      ctx.drawImage(image, x, y, w, h, x, y, w, h);
      ctx.strokeStyle = '#0ea5e9';
      ctx.lineWidth = 2 * px;
      ctx.strokeRect(x + px, y + px, w - 2 * px, h - 2 * px);
    }
  }

  // Full-screen crosshair while aiming a region.
  if (info.show_crosshairs && mode === 'region' && cursor && !dragStart && !pending) {
    ctx.fillStyle = 'rgba(14, 165, 233, 0.8)';
    ctx.fillRect(0, cursor.y, width, px);
    ctx.fillRect(cursor.x, 0, px, height);
  }
  updateSizeLabel(r);
}

function updateSizeLabel(r) {
  const el = $('size');
  if (!r || mode === 'choose') { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = `${r.width} × ${r.height}`;
  const left = clamp(toCss(r.x), 4, window.innerWidth - el.offsetWidth - 4);
  let top = toCss(r.y) - el.offsetHeight - 6;
  if (top < 4) top = toCss(r.y) + 6;
  el.style.left = `${left}px`;
  el.style.top = `${clamp(top, 4, window.innerHeight - el.offsetHeight - 4)}px`;
}

function drawLoupe(e) {
  const loupe = $('loupe');
  if (!info.show_magnifier || !cursor || mode === 'choose' || pending || finished) { loupe.hidden = true; return; }
  loupe.hidden = false;

  const dpr = window.devicePixelRatio || 1;
  const size = Math.round(LOUPE_CSS * dpr);
  if (loupeCanvas.width !== size) { loupeCanvas.width = size; loupeCanvas.height = size; }
  const half = Math.floor(LOUPE_SRC / 2);
  loupeCtx.imageSmoothingEnabled = false;
  loupeCtx.fillStyle = '#000';
  loupeCtx.fillRect(0, 0, size, size);
  const cell = size / LOUPE_SRC;
  loupeCtx.drawImage(image, cursor.x - half, cursor.y - half, LOUPE_SRC, LOUPE_SRC, 0, 0, size, size);

  // Outline the exact pixel under the cursor and draw a crosshair to it.
  const c = half * cell;
  loupeCtx.strokeStyle = 'rgba(14, 165, 233, 0.9)';
  loupeCtx.lineWidth = Math.max(1, dpr);
  loupeCtx.beginPath();
  loupeCtx.moveTo(c + cell / 2, 0); loupeCtx.lineTo(c + cell / 2, c);
  loupeCtx.moveTo(c + cell / 2, c + cell); loupeCtx.lineTo(c + cell / 2, size);
  loupeCtx.moveTo(0, c + cell / 2); loupeCtx.lineTo(c, c + cell / 2);
  loupeCtx.moveTo(c + cell, c + cell / 2); loupeCtx.lineTo(size, c + cell / 2);
  loupeCtx.stroke();
  loupeCtx.strokeStyle = '#fff';
  loupeCtx.strokeRect(c, c, cell, cell);

  const [r, g, b] = pixels.getImageData(cursor.x, cursor.y, 1, 1).data;
  const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  const gx = cursor.x + info.monitor.bounds.x, gy = cursor.y + info.monitor.bounds.y;
  $('loupe_pos').textContent = `X ${gx}  Y ${gy}`;
  $('loupe_color').textContent = hex;
  $('loupe_swatch').style.background = hex;

  // Below-right of the cursor; flip near the edges so it never covers the target.
  const gap = 24;
  const w = loupe.offsetWidth, h = loupe.offsetHeight;
  let left = e.clientX + gap, top = e.clientY + gap;
  if (left + w > window.innerWidth) left = e.clientX - gap - w;
  if (top + h > window.innerHeight) top = e.clientY - gap - h;
  loupe.style.left = `${left}px`;
  loupe.style.top = `${top}px`;
}

// ---- modes and results ----------------------------------------------------

const hints = {
  region: 'Drag to select an area, or click a window. Esc to cancel.',
  window: 'Click a window to capture it. Esc to cancel.',
};

function setMode(next, broadcast = false) {
  if (next === 'full_screen') return finish(info.monitor.bounds);
  if (next === 'all_screens') return finish(info.desktop);
  if (next === 'cancel') return cancel();
  mode = next;
  document.body.className = mode;
  $('chooser').hidden = mode !== 'choose';
  $('hint').hidden = !hints[mode];
  $('hint').textContent = hints[mode] || '';
  resetSelection();
  if (broadcast) emit('overlay-mode', { mode, session: info.session });
}

function resetSelection() {
  dragStart = null;
  selection = null;
  pending = false;
  $('actions').hidden = true;
  requestDraw();
}

function showActions() {
  const el = $('actions');
  el.hidden = false;
  const r = selection;
  const left = clamp(toCss(r.x + r.width) - el.offsetWidth, 4, window.innerWidth - el.offsetWidth - 4);
  let top = toCss(r.y + r.height) + 8;
  if (top + el.offsetHeight > window.innerHeight - 4) top = Math.max(4, toCss(r.y + r.height) - el.offsetHeight - 8);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

// Hides the controls and eases the dimming back out on every monitor, so
// the screen returns to normal gradually before the overlays close.
async function closeGently() {
  finished = true;
  emit('overlay-closing', { session: info.session });
  await fadeOut();
}

async function finish(globalArea) {
  if (finished) return;
  await closeGently();
  try {
    await invoke('overlay_finish', { area: globalArea });
  } catch (e) {
    console.error(e);
    invoke('overlay_cancel');
  }
}

async function cancel() {
  if (finished) return;
  if (info) await closeGently();
  invoke('overlay_cancel');
}

// ---- input ----------------------------------------------------------------

// Input only counts once the overlay is set up and until it starts closing.
const live = () => info && !finished;

window.addEventListener('mousemove', (e) => {
  if (!live()) return;
  cursor = toLocal(e);
  if (dragStart) selection = rectFromCorners(dragStart, cursor);
  hoverWindow = dragStart || pending ? null : windowAt(cursor);
  requestDraw();
  drawLoupe(e);
});

window.addEventListener('mouseenter', () => {
  // Keyboard shortcuts go to the monitor the mouse is on.
  if (live() && !document.hasFocus()) getCurrentWindow().setFocus().catch(() => {});
});

const insideSelection = (p) => selection && p.x >= selection.x && p.x < selection.x + selection.width
  && p.y >= selection.y && p.y < selection.y + selection.height;

canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || !live()) return;
  if (mode === 'region') {
    const at = toLocal(e);
    // A click inside a pending selection keeps it, so a double-click can
    // confirm it; clicking elsewhere starts a new selection.
    if (pending && insideSelection(at)) return;
    dragStart = at;
    selection = null;
    pending = false;
    $('actions').hidden = true;
    emit('overlay-selection-start', { monitor: monitorIndex, session: info.session });
  }
});

window.addEventListener('mouseup', (e) => {
  if (e.button !== 0 || !live()) return;
  if (mode === 'window') {
    const w = windowAt(toLocal(e));
    return finish(w ? w.bounds : info.monitor.bounds);
  }
  if (mode !== 'region' || !dragStart) return;
  const start = dragStart;
  const end = toLocal(e);
  const dragged = Math.abs(end.x - start.x) >= MIN_DRAG || Math.abs(end.y - start.y) >= MIN_DRAG;
  dragStart = null;
  if (!dragged) {
    // A click picks the window under it.
    const w = windowAt(end);
    if (w) return finish(w.bounds);
    selection = null;
    requestDraw();
    return;
  }
  selection = rectFromCorners(start, end);
  pending = true;
  showActions();
  requestDraw();
  drawLoupe(e);
});

canvas.addEventListener('dblclick', () => { if (live() && pending) finish(toGlobal(selection)); });

window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (!live()) return;
  if (pending || dragStart) resetSelection();
  else cancel();
});

window.addEventListener('keydown', (e) => {
  if (!live()) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    return pending || dragStart ? resetSelection() : cancel();
  }
  if (mode === 'choose') {
    const pick = { r: 'region', w: 'window', f: 'full_screen', a: info.monitor_count > 1 ? 'all_screens' : null }[e.key.toLowerCase()];
    if (pick) setMode(pick, true);
    return;
  }
  if (!pending) return;
  if (e.key === 'Enter') return finish(toGlobal(selection));
  const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (!step) return;
  e.preventDefault();
  const { width: mw, height: mh } = info.monitor.bounds;
  const s = selection;
  if (e.shiftKey) {
    s.width = clamp(s.width + step[0], 1, mw - s.x);
    s.height = clamp(s.height + step[1], 1, mh - s.y);
  } else {
    s.x = clamp(s.x + step[0], 0, mw - s.width);
    s.y = clamp(s.y + step[1], 0, mh - s.height);
  }
  showActions();
  requestDraw();
});

$('chooser').addEventListener('click', (e) => {
  const button = e.target.closest('button');
  if (button && live()) setMode(button.dataset.mode, true);
});
$('confirm').addEventListener('click', () => { if (live() && selection) finish(toGlobal(selection)); });
$('redo').addEventListener('click', () => { if (live()) resetSelection(); });
$('cancel').addEventListener('click', cancel);

// Keep all monitors' overlays in the same mode, with one selection at a time.
listen('overlay-mode', ({ payload }) => {
  if (live() && payload.session === info.session && payload.mode !== mode) setMode(payload.mode);
});
listen('overlay-closing', ({ payload }) => {
  if (info && payload.session === info.session && !finished) {
    finished = true;
    fadeOut();
  }
});
listen('overlay-selection-start', ({ payload }) => {
  if (live() && payload.session === info.session && payload.monitor !== monitorIndex) resetSelection();
});

// ---- startup --------------------------------------------------------------

async function start() {
  try {
    info = await invoke('overlay_init', { monitor: monitorIndex });
  } catch (e) {
    console.error(e);
    return invoke('overlay_cancel');
  }
  const { width, height } = info.monitor.bounds;
  canvas.width = width;
  canvas.height = height;

  image = new Image();
  image.crossOrigin = 'anonymous'; // keeps the canvas readable for the colour picker
  image.src = convertFileSrc(info.image_path, 'snapshot');
  try {
    await image.decode();
  } catch (e) {
    console.error('Could not load the frozen screenshot', e);
    return invoke('overlay_cancel');
  }
  const off = document.createElement('canvas');
  off.width = width;
  off.height = height;
  pixels = off.getContext('2d', { willReadFrequently: true });
  pixels.drawImage(image, 0, 0);

  $('all_screens').hidden = info.monitor_count < 2;
  setMode(info.mode === 'ask' ? 'choose' : info.mode);
  draw();
  // Wait until the undimmed copy has been painted before showing the
  // window, then ease the dimming in.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  await invoke('overlay_ready');
  fadeIn();
}

let fadeToken = 0;

// Animates `dim` from its current value to `target` with ease-in-out.
function fadeTo(target) {
  const token = ++fadeToken;
  const from = dim;
  const t0 = performance.now();
  return new Promise((resolve) => {
    const step = (now) => {
      if (token !== fadeToken) return resolve(); // superseded by a newer fade
      const t = Math.min(1, (now - t0) / FADE_MS);
      const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      dim = from + (target - from) * eased;
      draw();
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

const fadeIn = () => fadeTo(DIM);

function fadeOut() {
  for (const id of ['chooser', 'actions', 'loupe', 'size', 'hint']) $(id).hidden = true;
  selection = null;
  dragStart = null;
  pending = false;
  hoverWindow = null;
  cursor = null;
  return fadeTo(0);
}

window.addEventListener('resize', () => { if (info && image) requestDraw(); });
start();
