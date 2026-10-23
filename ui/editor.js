// The image editor: a canvas that shows the selected capture with its
// annotations, the tools that add and change them, a properties panel and
// the tray of recent captures. Annotations are kept as objects and saved
// beside the capture, so they stay editable; the capture itself is never
// changed. Copy and Save render the finished image and hand it to the app.

import * as D from './editor-draw.js';

const { invoke, convertFileSrc } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const $ = (id) => document.getElementById(id);
const view = $('view');
const stage = $('stage');
const spacer = $('spacer');
const viewport = $('viewport');
const textInput = $('text_input');

const PAD = 40;
const HANDLE = 8;
const MAX_HISTORY = 200;

// ---- Icons and tools ------------------------------------------------------

const ICONS = {
  move: '<path d="M12 3v18M3 12h18M12 3L9.5 5.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5"/>',
  arrow: '<path d="M5 19L19 5M19 5h-8.5M19 5v8.5"/>',
  text: '<path d="M5 7V4.5h14V7M12 4.5v15M9 19.5h6"/>',
  callout: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v8a1.5 1.5 0 0 1-1.5 1.5H11l-4.5 4v-4h-1A1.5 1.5 0 0 1 4 13.5z"/>',
  shape: '<rect x="3" y="3" width="11" height="11" rx="1.5"/><circle cx="15.5" cy="15.5" r="5.5"/>',
  stamp: '<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6l-5.4 2.9 1.2-6-4.5-4.2 6.1-.7z"/>',
  step: '<circle cx="12" cy="12" r="8.5"/><path d="M10.3 9.4L12.6 8v8"/>',
  fill: '<path d="M4.5 12.5L11.5 5.5l7 7-7 7z"/><path d="M4.5 12.5h14"/><path d="M20.5 16.5s1.5 1.9 1.5 2.9a1.5 1.5 0 0 1-3 0c0-1 1.5-2.9 1.5-2.9z"/>',
  selection: '<path d="M4 7V4h3M10 4h4M17 4h3v3M20 10v4M20 17v3h-3M14 20h-4M7 20H4v-3M4 14v-4"/>',
  crop: '<path d="M6 2v16h16"/><path d="M2 6h16v16"/>',
  blur: '<path d="M12 3s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11z"/><path d="M9 14.5a3 3 0 0 0 3 3" opacity=".6"/>',
  pen: '<path d="M3 17c2.5-5 4.5-8.5 6.5-8.5 2.6 0 .8 8 4 8 2.2 0 3.6-4.4 7.5-9"/>',
  line: '<path d="M5 19L19 5"/>',
  highlight: '<path d="M14.5 4.5l5 5-8 8H8.5L7 16v-3.5z"/><path d="M7 16l-3 3.5h5"/><path d="M4 21h16" opacity=".5"/>',
  erase: '<path d="M8.5 19.5L4 15l9.5-9.5 6 6-8 8z"/><path d="M8 11l6 6M11.5 19.5H20"/>',
  magnify: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21M8 10.5h5M10.5 8v5"/>',
  more: '<circle cx="6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18" cy="12" r="1.3"/>',
  caret: '<path d="M7 10l5 5 5-5"/>',
  front: '<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 5V4.5A.5.5 0 0 0 15.5 4h-11a.5.5 0 0 0-.5.5v11a.5.5 0 0 0 .5.5H5"/>',
  back: '<rect x="4" y="4" width="12" height="12" rx="1.5"/><path d="M19.5 8h.5v12H8v-.5"/>',
  duplicate: '<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M14 11v6M11 14h6M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  editText: '<path d="M5 7V4.5h14V7M12 4.5v15M9 19.5h6"/>',
};

const svg = (name) => `<svg viewBox="0 0 24 24">${ICONS[name]}</svg>`;

const TOOLS = [
  ['move', 'Move'], ['arrow', 'Arrow'], ['text', 'Text'], ['callout', 'Callout'], ['shape', 'Shape'],
  ['stamp', 'Stamp'], ['step', 'Step'], ['blur', 'Blur'], ['crop', 'Crop'], ['selection', 'Selection'],
];
const MORE_TOOLS = [
  ['fill', 'Fill'], ['pen', 'Pen'], ['line', 'Line'], ['highlight', 'Highlighter'], ['erase', 'Eraser'], ['magnify', 'Magnify'],
];
const TOOL_LABEL = Object.fromEntries([...TOOLS, ...MORE_TOOLS]);
const TYPE_LABEL = { ...TOOL_LABEL, image: 'Image', clear: 'Cleared area' };
// Tools that draw objects of one type; clicking such an object selects it.
const DRAWS = new Set(['arrow', 'text', 'callout', 'shape', 'stamp', 'step', 'blur', 'pen', 'line', 'highlight', 'erase', 'magnify']);

// ---- Styles ---------------------------------------------------------------

const COLORS = ['#e11d48', '#f97316', '#facc15', '#16a34a', '#0284c7', '#7c3aed', '#ec4899', '#000000', '#64748b', '#ffffff'];

const STYLE_DEFAULTS = {
  arrow: { stroke: '#e11d48', width: 6, heads: 'end', dash: 'solid', opacity: 1, shadow: true },
  line: { stroke: '#e11d48', width: 4, heads: 'none', dash: 'solid', opacity: 1, shadow: false },
  shape: { kind: 'round', stroke: '#e11d48', fill: null, width: 4, opacity: 1, shadow: true },
  text: { color: '#e11d48', size: 28, font: 'Segoe UI', bold: true, italic: false, align: 'left', fill: null, outline: '#ffffff', shadow: false },
  callout: { color: '#ffffff', size: 22, font: 'Segoe UI', bold: true, italic: false, fill: '#0284c7', stroke: '#ffffff', width: 2, shadow: true },
  stamp: { stamp: 'check', shadow: true },
  step: { fill: '#e11d48', color: '#ffffff', stroke: '#ffffff', radius: 18, stepStyle: 'number', shadow: true },
  pen: { stroke: '#e11d48', width: 4, opacity: 1, shadow: false },
  highlight: { stroke: '#facc15', width: 22, opacity: 0.5 },
  erase: { width: 24 },
  blur: { blurKind: 'pixelate', amount: 5 },
  magnify: { zoom: 2, lensShape: 'circle', stroke: '#ffffff', width: 4, shadow: true },
  image: { opacity: 1, shadow: false },
  clear: {},
  fill: { color: '#facc15', tolerance: 12 },
  selection: { hole: 'transparent' },
};

const STYLE_STORE = 'capture-rs.editor.styles';
const styles = loadStyles();

function loadStyles() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STYLE_STORE)) || {}; } catch { /* use defaults */ }
  const out = {};
  for (const [k, v] of Object.entries(STYLE_DEFAULTS)) out[k] = { ...v, ...(saved[k] || {}) };
  return out;
}

function saveStyles() {
  try { localStorage.setItem(STYLE_STORE, JSON.stringify(styles)); } catch { /* not kept */ }
}

// ---- Document state -------------------------------------------------------

let entries = [];
let current = null; // { id, entry, img, W, H }
let doc = { crop: null, objects: [] };
let history = [];
let hIndex = 0;
let nextId = 1;
let tool = 'move';
let moreTool = 'fill';
let selectedId = null;
let hoverId = null;
let region = null; // selection tool area, image coordinates
let cropDraft = null;
let editingId = null;
let nextStep = null; // user-chosen number for the next step
let zoom = 1;
let fit = true;
let drag = null;
let spaceDown = false;
let layout = { offX: 0, offY: 0, region: { x: 0, y: 0, w: 1, h: 1 } };

const find = (id) => doc.objects.find((o) => o.id === id);
const selected = () => (selectedId == null ? null : find(selectedId));
const full = () => ({ x: 0, y: 0, w: current.W, h: current.H });
const docRegion = () => (tool === 'crop' || !doc.crop ? full() : doc.crop);

function replace(o) {
  doc.objects = doc.objects.map((x) => (x.id === o.id ? o : x));
}

function add(o) {
  const obj = { ...o, id: nextId++ };
  doc.objects = [...doc.objects, obj];
  return obj;
}

function remove(id) {
  doc.objects = doc.objects.filter((o) => o.id !== id);
  if (selectedId === id) selectedId = null;
}

function commit() {
  history = history.slice(0, hIndex + 1);
  history.push({ crop: doc.crop, objects: doc.objects });
  if (history.length > MAX_HISTORY) history.shift();
  hIndex = history.length - 1;
  scheduleSave();
  updateButtons();
}

function restore(snapshot) {
  doc = { crop: snapshot.crop, objects: snapshot.objects };
  if (!selected()) selectedId = null;
  region = null;
  if (tool === 'crop') cropDraft = doc.crop ? { ...doc.crop } : full();
  scheduleSave();
  updateButtons();
  renderPanel();
  refit();
}

function undo() {
  finishEditing();
  if (hIndex > 0) restore(history[--hIndex]);
}

function redo() {
  finishEditing();
  if (hIndex < history.length - 1) restore(history[++hIndex]);
}

// ---- Rendering ------------------------------------------------------------

const docCanvas = document.createElement('canvas');
const scratch = document.createElement('canvas');
const scratch2 = document.createElement('canvas');
const images = new Map();
let docDirty = true;
let frame = 0;

function image(src) {
  let img = images.get(src);
  if (!img) {
    img = new Image();
    img.onload = () => invalidate();
    img.src = src;
    images.set(src, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}

// Draws the capture and its objects for image area `r` into `canvas`.
function renderInto(canvas, r, editing = null) {
  const w = Math.max(1, Math.round(r.w)), h = Math.max(1, Math.round(r.h));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.setTransform(1, 0, 0, 1, -r.x, -r.y);
  ctx.drawImage(current.img, 0, 0);
  const env = { ox: r.x, oy: r.y, scratch, scratch2, image, editing };
  for (const o of doc.objects) D.drawObject(ctx, o, env);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function invalidate(docChanged = true) {
  if (docChanged) docDirty = true;
  if (!frame) frame = requestAnimationFrame(paint);
}

function refit() {
  if (fit) zoom = fitZoom();
  invalidate();
}

function fitZoom() {
  if (!current) return 1;
  const r = docRegion();
  const vw = stage.clientWidth - PAD * 2, vh = stage.clientHeight - PAD * 2;
  return Math.max(0.05, Math.min(1, vw / r.w, vh / r.h));
}

function updateLayout() {
  const r = docRegion();
  if (fit) zoom = fitZoom();
  const cw = r.w * zoom, ch = r.h * zoom;
  const sw = Math.max(stage.clientWidth, cw + PAD * 2);
  const sh = Math.max(stage.clientHeight, ch + PAD * 2);
  spacer.style.width = `${sw}px`;
  spacer.style.height = `${sh}px`;
  layout = {
    region: r,
    offX: (sw - cw) / 2 - stage.scrollLeft,
    offY: (sh - ch) / 2 - stage.scrollTop,
  };
}

const toScreen = (x, y) => [layout.offX + (x - layout.region.x) * zoom, layout.offY + (y - layout.region.y) * zoom];

function toImage(e) {
  const rect = view.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left - layout.offX) / zoom + layout.region.x,
    y: (e.clientY - rect.top - layout.offY) / zoom + layout.region.y,
  };
}

let checker = null;
function checkerPattern(ctx) {
  if (checker) return checker;
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d');
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  g.fillStyle = dark ? '#2a2d33' : '#ffffff';
  g.fillRect(0, 0, 16, 16);
  g.fillStyle = dark ? '#363a41' : '#e4e4e7';
  g.fillRect(0, 0, 8, 8);
  g.fillRect(8, 8, 8, 8);
  checker = ctx.createPattern(c, 'repeat');
  return checker;
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { checker = null; invalidate(false); });

function paint() {
  frame = 0;
  const vw = stage.clientWidth, vh = stage.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  if (view.width !== Math.round(vw * dpr) || view.height !== Math.round(vh * dpr)) {
    view.width = Math.round(vw * dpr);
    view.height = Math.round(vh * dpr);
    view.style.width = `${vw}px`;
    view.style.height = `${vh}px`;
  }
  const ctx = view.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, view.width, view.height);
  $('empty').hidden = !!current;
  if (!current) return;

  updateLayout();
  if (docDirty) {
    renderInto(docCanvas, layout.region, editingId);
    docDirty = false;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const r = layout.region;
  const [x, y] = [layout.offX, layout.offY];
  const cw = r.w * zoom, ch = r.h * zoom;
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
  ctx.shadowBlur = 12;
  ctx.fillStyle = checkerPattern(ctx);
  ctx.fillRect(x, y, cw, ch);
  ctx.restore();
  ctx.imageSmoothingEnabled = zoom < 2;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(docCanvas, x, y, cw, ch);
  drawOverlay(ctx);
  if (editingId) placeTextInput();
  updateZoomLabel();
}

function screenRect(b) {
  const [x, y] = toScreen(b.x, b.y);
  return { x, y, w: b.w * zoom, h: b.h * zoom };
}

function drawHandles(ctx, list) {
  for (const h of list) {
    const [x, y] = toScreen(h.x, h.y);
    ctx.beginPath();
    if (h.name === 'p1' || h.name === 'p2' || h.name === 'tail') ctx.arc(x, y, HANDLE / 2 + 1, 0, Math.PI * 2);
    else ctx.rect(x - HANDLE / 2, y - HANDLE / 2, HANDLE, HANDLE);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = accent();
    ctx.stroke();
  }
}

let accentColor = null;
const accent = () => accentColor || (accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#0284c7');

function ants(ctx, s) {
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = '#000000';
  ctx.strokeRect(s.x + 0.5, s.y + 0.5, s.w, s.h);
  ctx.lineDashOffset = 5;
  ctx.strokeStyle = '#ffffff';
  ctx.strokeRect(s.x + 0.5, s.y + 0.5, s.w, s.h);
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
}

function drawOverlay(ctx) {
  if (tool === 'crop' && cropDraft) {
    const all = screenRect(full());
    const c = screenRect(cropDraft);
    ctx.beginPath();
    ctx.rect(all.x, all.y, all.w, all.h);
    ctx.rect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const t of [1 / 3, 2 / 3]) {
      ctx.moveTo(c.x + c.w * t, c.y); ctx.lineTo(c.x + c.w * t, c.y + c.h);
      ctx.moveTo(c.x, c.y + c.h * t); ctx.lineTo(c.x + c.w, c.y + c.h * t);
    }
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(c.x, c.y, c.w, c.h);
    drawHandles(ctx, D.handles({ type: 'shape', ...cropDraft }));
    return;
  }
  if (region) ants(ctx, screenRect(region));
  const hover = hoverId != null && hoverId !== selectedId && !drag ? find(hoverId) : null;
  if (hover) {
    const s = screenRect(D.bounds(hover));
    ctx.strokeStyle = accent();
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1;
    ctx.strokeRect(s.x - 0.5, s.y - 0.5, s.w + 1, s.h + 1);
    ctx.globalAlpha = 1;
  }
  const o = selected();
  if (o && editingId !== o.id) {
    const s = screenRect(D.bounds(o));
    ctx.strokeStyle = accent();
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(s.x - 0.5, s.y - 0.5, s.w + 1, s.h + 1);
    ctx.setLineDash([]);
    if (!drag || drag.kind !== 'move') drawHandles(ctx, D.handles(o));
  }
}

// ---- Hit testing ----------------------------------------------------------

function objectAt(p) {
  const tol = 4 / zoom;
  for (let i = doc.objects.length - 1; i >= 0; i--) {
    const o = doc.objects[i];
    if (D.hitTest(o, p.x, p.y, tol) && (o.type !== 'image' || opaqueAt(o, p))) return o;
  }
  return null;
}

// Filled areas and lifted parts are picked only where they have pixels, so
// what shows through their transparent parts can still be clicked.
const alphaCache = new Map();
function opaqueAt(o, p) {
  const img = image(o.src);
  if (!img) return true;
  let data = alphaCache.get(o.src);
  if (!data) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    data = ctx.getImageData(0, 0, c.width, c.height);
    alphaCache.set(o.src, data);
  }
  const b = D.norm(o);
  const x = Math.floor(((p.x - b.x) / b.w) * data.width);
  const y = Math.floor(((p.y - b.y) / b.h) * data.height);
  if (x < 0 || y < 0 || x >= data.width || y >= data.height) return false;
  return data.data[(y * data.width + x) * 4 + 3] > 16;
}

function handleAt(list, e) {
  const rect = view.getBoundingClientRect();
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  return list.find((h) => {
    const [x, y] = toScreen(h.x, h.y);
    return Math.abs(sx - x) <= HANDLE && Math.abs(sy - y) <= HANDLE;
  });
}

const insideRect = (r, p) => r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

// ---- Pointer --------------------------------------------------------------

function select(id) {
  if (selectedId === id) return;
  selectedId = id;
  renderPanel();
  invalidate(false);
}

function newObject(type, p) {
  const s = styles[type];
  switch (type) {
    case 'arrow':
    case 'line': return { type, ...s, x1: p.x, y1: p.y, x2: p.x, y2: p.y };
    case 'pen':
    case 'highlight':
    case 'erase': return { type, ...s, points: [p.x, p.y] };
    case 'step': return { type, ...s, x: p.x, y: p.y, n: takeStepNumber() };
    case 'text': return { type, ...s, x: p.x, y: p.y, w: 0, h: 0, text: '' };
    case 'callout': return { type, ...s, x: p.x, y: p.y, w: 0, h: 0, tx: p.x, ty: p.y, text: '' };
    default: return { type, ...s, x: p.x, y: p.y, w: 0, h: 0 };
  }
}

function stepNumber() {
  if (nextStep != null) return nextStep;
  return doc.objects.reduce((n, o) => (o.type === 'step' ? Math.max(n, o.n) : n), 0) + 1;
}

function takeStepNumber() {
  const n = stepNumber();
  nextStep = null;
  return n;
}

view.addEventListener('pointerdown', (e) => {
  closePopups();
  if (!current) return;
  if (editingId) {
    finishEditing();
    return;
  }
  view.focus();
  const p = toImage(e);
  if (e.button === 1 || (e.button === 0 && spaceDown)) {
    drag = { kind: 'pan', x: e.clientX, y: e.clientY, left: stage.scrollLeft, top: stage.scrollTop };
    view.setPointerCapture(e.pointerId);
    view.style.cursor = 'grabbing';
    return;
  }
  if (e.button !== 0) return;
  view.setPointerCapture(e.pointerId);
  e.preventDefault();

  if (tool === 'crop') return cropDown(e, p);
  if (tool === 'fill') return fillAt(p);

  const sel = selected();
  const h = sel && handleAt(D.handles(sel), e);
  if (h) {
    drag = { kind: 'handle', id: sel.id, handle: h.name, orig: sel, start: p };
    return;
  }

  if (tool === 'selection') {
    if (insideRect(region, p)) return liftRegion(p);
    // A part just lifted out stays movable until something else is chosen.
    if (sel && sel.type === 'image' && D.hitTest(sel, p.x, p.y, 0)) return startMove(sel, p);
    region = null;
    select(null);
    drag = { kind: 'region', start: p };
    return;
  }

  const hit = objectAt(p);
  const own = (o) => o.type === tool || (tool === 'text' && o.type === 'callout') || (tool === 'callout' && o.type === 'text');
  if (hit && (tool === 'move' || own(hit))) return startMove(hit, p);
  if (tool === 'move') {
    select(null);
    return;
  }
  if (!DRAWS.has(tool)) return;
  const o = add(newObject(tool, p));
  selectedId = o.id;
  if (tool === 'step') {
    drag = { kind: 'move', id: o.id, start: p, orig: o, created: true };
    renderPanel();
  } else if (D.isStroke(o)) {
    drag = { kind: 'stroke', id: o.id, start: p };
  } else {
    drag = { kind: 'create', id: o.id, start: p };
  }
  invalidate();
});

function startMove(o, p) {
  select(o.id);
  drag = { kind: 'move', id: o.id, start: p, orig: o };
}

const DEFAULT_SIZE = { stamp: [64, 64], text: [320, 0], callout: [260, 110], blur: [160, 60], magnify: [160, 160], shape: [160, 100] };

function updateCreate(o, p, shift) {
  const s = drag.start;
  if (D.isLine(o)) {
    const [x, y] = shift ? D.snapAngle(s.x, s.y, p.x, p.y) : [p.x, p.y];
    return { ...o, x2: x, y2: y };
  }
  let w = p.x - s.x, h = p.y - s.y;
  if (shift || o.type === 'stamp') {
    const m = Math.max(Math.abs(w), Math.abs(h));
    w = Math.sign(w || 1) * m;
    h = Math.sign(h || 1) * m;
  }
  const r = D.norm({ x: s.x, y: s.y, w, h });
  if (o.type === 'callout') return { ...o, ...r, tx: r.x + r.w * 0.2, ty: r.y + r.h + Math.max(30, r.h * 0.6) };
  return { ...o, ...r };
}

function finishCreate(o, s) {
  const tiny = D.isLine(o) ? Math.hypot(o.x2 - o.x1, o.y2 - o.y1) < 3 : o.w < 6 && o.h < 6;
  if (!tiny) return o;
  if (D.isLine(o)) return null;
  const [w, h] = DEFAULT_SIZE[o.type] || [100, 100];
  if (o.type === 'stamp') return { ...o, x: s.x - w / 2, y: s.y - h / 2, w, h };
  if (o.type === 'callout') return { ...o, x: s.x, y: s.y - h - 40, w, h, tx: s.x - 10, ty: s.y };
  if (o.type === 'text') return { ...o, x: s.x, y: s.y - D.lineHeight(o) / 2 - D.textPad(o), w };
  return { ...o, x: s.x - w / 2, y: s.y - h / 2, w, h };
}

view.addEventListener('pointermove', (e) => {
  if (!current) return;
  const p = toImage(e);
  if (!drag) return hover(e, p);
  const o = drag.id != null ? find(drag.id) : null;
  switch (drag.kind) {
    case 'pan':
      stage.scrollLeft = drag.left - (e.clientX - drag.x);
      stage.scrollTop = drag.top - (e.clientY - drag.y);
      return;
    case 'create':
      if (o) replace(updateCreate(o, p, e.shiftKey));
      break;
    case 'move': {
      let dx = p.x - drag.start.x, dy = p.y - drag.start.y;
      if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
      replace(D.moved(drag.orig, dx, dy));
      drag.moved = true;
      break;
    }
    case 'handle':
      replace(D.withHandle(drag.orig, drag.handle, p.x, p.y, e.shiftKey));
      drag.moved = true;
      break;
    case 'stroke': {
      if (!o) break;
      if (e.shiftKey) {
        // Shift draws a straight stroke from where it started.
        replace({ ...o, points: [drag.start.x, drag.start.y, p.x, p.y] });
        break;
      }
      const pts = o.points;
      const lx = pts[pts.length - 2], ly = pts[pts.length - 1];
      if (Math.hypot(p.x - lx, p.y - ly) * zoom < 1.5) return;
      replace({ ...o, points: [...pts, p.x, p.y] });
      break;
    }
    case 'region': {
      const r = D.intersect(D.norm({ x: drag.start.x, y: drag.start.y, w: p.x - drag.start.x, h: p.y - drag.start.y }), docRegion());
      region = r && roundRect(r);
      invalidate(false);
      return;
    }
    case 'crop-new':
    case 'crop-handle':
    case 'crop-move':
      cropMove(p, e.shiftKey);
      invalidate(false);
      return;
  }
  invalidate();
});

function hover(e, p) {
  let cursor = 'default';
  let over = null;
  if (spaceDown) {
    cursor = 'grab';
  } else if (tool === 'crop') {
    const h = cropDraft && handleAt(D.handles({ type: 'shape', ...cropDraft }), e);
    cursor = h ? D.HANDLE_CURSORS[h.name] : insideRect(cropDraft, p) && !isFull(cropDraft) ? 'move' : 'crosshair';
  } else {
    const sel = selected();
    const h = sel && handleAt(D.handles(sel), e);
    over = objectAt(p);
    if (h) cursor = D.HANDLE_CURSORS[h.name];
    else if (tool === 'selection') cursor = insideRect(region, p) || (sel?.type === 'image' && over?.id === sel.id) ? 'move' : 'crosshair';
    else if (tool === 'fill') cursor = 'cell';
    else if (over && (tool === 'move' || over.type === tool)) cursor = 'move';
    else if (tool === 'text') cursor = 'text';
    else if (tool !== 'move') cursor = 'crosshair';
    if (tool !== 'move' && over && over.type !== tool) over = null;
  }
  view.style.cursor = cursor;
  const id = over ? over.id : null;
  if (id !== hoverId) {
    hoverId = id;
    invalidate(false);
  }
}

function endDrag(e) {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (view.hasPointerCapture(e.pointerId)) view.releasePointerCapture(e.pointerId);
  const o = d.id != null ? find(d.id) : null;
  switch (d.kind) {
    case 'pan':
      view.style.cursor = spaceDown ? 'grab' : 'default';
      return;
    case 'create': {
      if (!o) break;
      const done = finishCreate(o, d.start);
      if (!done) {
        remove(o.id);
        break;
      }
      replace(done);
      commit();
      if (done.type === 'text' || done.type === 'callout') startEditing(done.id);
      break;
    }
    case 'move':
    case 'handle':
      if (d.moved || d.created || d.lifted) commit();
      break;
    case 'stroke':
      if (o) commit();
      break;
    case 'region':
      if (region && (region.w < 2 || region.h < 2)) region = null;
      renderPanel();
      break;
    default:
      if (d.kind.startsWith('crop')) {
        cropDraft = roundRect(cropDraft);
        renderPanel();
      }
  }
  renderPanel();
  invalidate();
}
view.addEventListener('pointerup', endDrag);
view.addEventListener('pointercancel', endDrag);
view.addEventListener('pointerleave', () => {
  if (!drag && hoverId != null) {
    hoverId = null;
    invalidate(false);
  }
});

view.addEventListener('dblclick', (e) => {
  if (!current || tool === 'crop') return;
  const o = objectAt(toImage(e));
  if (o && (o.type === 'text' || o.type === 'callout')) {
    select(o.id);
    startEditing(o.id);
  }
});

view.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.ctrlKey) {
    setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e);
  } else if (e.shiftKey) {
    stage.scrollLeft += e.deltaY;
  } else {
    stage.scrollLeft += e.deltaX;
    stage.scrollTop += e.deltaY;
  }
}, { passive: false });
stage.addEventListener('scroll', () => invalidate(false));
new ResizeObserver(() => refit()).observe(viewport);

// ---- Zoom -----------------------------------------------------------------

function setZoom(z, anchorEvent = null) {
  if (!current) return;
  const rect = view.getBoundingClientRect();
  const ax = anchorEvent ? anchorEvent.clientX - rect.left : stage.clientWidth / 2;
  const ay = anchorEvent ? anchorEvent.clientY - rect.top : stage.clientHeight / 2;
  const ix = (ax - layout.offX) / zoom, iy = (ay - layout.offY) / zoom;
  fit = false;
  zoom = Math.max(0.05, Math.min(16, z));
  updateLayout();
  // Keep the point under the anchor where it was.
  stage.scrollLeft += layout.offX + ix * zoom - ax;
  stage.scrollTop += layout.offY + iy * zoom - ay;
  invalidate(false);
}

function setFit() {
  fit = true;
  refit();
}

function updateZoomLabel() {
  $('zoom_label').textContent = fit ? `Fit ${Math.round(zoom * 100)}%` : `${Math.round(zoom * 100)}%`;
  const r = current ? (tool === 'crop' && cropDraft ? cropDraft : docRegion()) : null;
  $('size').textContent = r ? `${Math.round(r.w)} × ${Math.round(r.h)} px` : '';
}

$('zoom_in').addEventListener('click', () => setZoom(zoom * 1.25));
$('zoom_out').addEventListener('click', () => setZoom(zoom / 1.25));
$('zoom_label').addEventListener('click', (e) => togglePopup('zoom_popup', e));
for (const b of $('zoom_popup').querySelectorAll('button')) {
  b.addEventListener('click', () => {
    closePopups();
    if (b.dataset.zoom === 'fit') setFit();
    else setZoom(Number(b.dataset.zoom));
  });
}

// ---- Crop -----------------------------------------------------------------

const roundRect = (r) => {
  const x = Math.round(r.x), y = Math.round(r.y);
  return { x, y, w: Math.max(1, Math.round(r.x + r.w) - x), h: Math.max(1, Math.round(r.y + r.h) - y) };
};

function cropDown(e, p) {
  const h = handleAt(D.handles({ type: 'shape', ...cropDraft }), e);
  if (h) drag = { kind: 'crop-handle', handle: h.name, orig: { ...cropDraft } };
  // While the whole image is chosen there is nothing to move, so a drag
  // draws the crop area instead.
  else if (insideRect(cropDraft, p) && !isFull(cropDraft)) drag = { kind: 'crop-move', start: p, orig: { ...cropDraft } };
  else drag = { kind: 'crop-new', start: p };
}

function cropMove(p, shift) {
  const all = full();
  if (drag.kind === 'crop-move') {
    const o = drag.orig;
    const x = Math.max(0, Math.min(all.w - o.w, o.x + p.x - drag.start.x));
    const y = Math.max(0, Math.min(all.h - o.h, o.y + p.y - drag.start.y));
    cropDraft = { ...o, x, y };
    return;
  }
  const r = drag.kind === 'crop-handle'
    ? D.resizeRect(drag.orig, drag.handle, p.x, p.y, shift)
    : D.norm({ x: drag.start.x, y: drag.start.y, w: p.x - drag.start.x, h: p.y - drag.start.y });
  cropDraft = D.intersect(r, all) || cropDraft;
}

const isFull = (c) => c.x <= 0 && c.y <= 0 && c.x + c.w >= current.W && c.y + c.h >= current.H;

function applyCrop() {
  if (!cropDraft) return;
  const c = roundRect(D.intersect(cropDraft, full()) || full());
  const next = isFull(c) ? null : c;
  const same = JSON.stringify(next) === JSON.stringify(doc.crop);
  if (!same) {
    doc = { ...doc, crop: next };
    commit();
  }
}

// ---- Fill and selection ---------------------------------------------------

function fillAt(p) {
  const r = docRegion();
  if (!insideRect(r, p)) return;
  renderInto(docCanvas, r, editingId);
  const ctx = docCanvas.getContext('2d');
  const data = ctx.getImageData(0, 0, docCanvas.width, docCanvas.height);
  const s = styles.fill;
  const res = D.floodFill(data, docCanvas.width, docCanvas.height, Math.floor(p.x - r.x), Math.floor(p.y - r.y), Math.round(s.tolerance * 2.55), s.color);
  if (!res) return;
  add({ type: 'image', ...styles.image, x: res.x + r.x, y: res.y + r.y, w: res.w, h: res.h, src: res.canvas.toDataURL('image/png'), fromFill: true });
  commit();
  invalidate();
}

// Renders area `r` of the finished image to a new canvas.
function renderArea(r) {
  const c = document.createElement('canvas');
  renderInto(c, r);
  return c;
}

function borderColor(c) {
  const ctx = c.getContext('2d');
  const { width: w, height: h } = c;
  const d = ctx.getImageData(0, 0, w, h).data;
  let r = 0, g = 0, b = 0, n = 0;
  const addPx = (x, y) => {
    const i = (y * w + x) * 4;
    r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
  };
  for (let x = 0; x < w; x++) { addPx(x, 0); addPx(x, h - 1); }
  for (let y = 0; y < h; y++) { addPx(0, y); addPx(w - 1, y); }
  const hex = (v) => Math.round(v / n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function regionHole(c) {
  return styles.selection.hole === 'auto' ? borderColor(c) : null;
}

// Lifts the selected area into an image object and starts moving it.
function liftRegion(p) {
  const r = region;
  const c = renderArea(r);
  add({ type: 'clear', ...r, color: regionHole(c) });
  const img = add({ type: 'image', ...styles.image, ...r, src: c.toDataURL('image/png') });
  region = null;
  select(img.id);
  drag = { kind: 'move', id: img.id, start: p, orig: img, lifted: true };
  invalidate();
}

function regionAction(action) {
  const r = region;
  if (!r) return;
  if (action === 'copy') return copyImage(r);
  if (action === 'crop') {
    region = null;
    doc = { ...doc, crop: roundRect(r) };
    commit();
    setFit();
  } else if (action === 'blur') {
    const o = add({ type: 'blur', ...styles.blur, ...r });
    region = null;
    commit();
    select(o.id);
  } else if (action === 'delete') {
    add({ type: 'clear', ...r, color: regionHole(renderArea(r)) });
    region = null;
    commit();
  }
  renderPanel();
  invalidate();
}

// ---- Text editing ---------------------------------------------------------

function startEditing(id) {
  const o = find(id);
  if (!o) return;
  editingId = id;
  selectedId = id;
  textInput.hidden = false;
  textInput.value = o.text;
  placeTextInput();
  textInput.focus();
  textInput.setSelectionRange(o.text.length, o.text.length);
  renderPanel();
  invalidate();
}

function placeTextInput() {
  const o = find(editingId);
  if (!o) return;
  const pad = D.textPad(o) * zoom;
  const s = textInput.style;
  s.font = D.fontOf(o, o.size * zoom);
  s.lineHeight = `${D.lineHeight(o) * zoom}px`;
  s.color = o.color;
  s.padding = `${pad}px`;
  s.caretColor = o.color;
  if (o.type === 'text') {
    const [x, y] = toScreen(o.x, o.y);
    s.left = `${x}px`;
    s.top = `${y}px`;
    s.width = `${o.w * zoom}px`;
    s.height = `${D.textHeight(o) * zoom}px`;
    s.textAlign = o.align;
    s.background = o.fill || 'transparent';
    s.borderRadius = `${pad}px`;
  } else {
    const b = D.norm(o);
    const lines = D.wrap(o.text || ' ', D.fontOf(o), Math.max(1, b.w - D.textPad(o) * 2)).length;
    const th = lines * D.lineHeight(o) + D.textPad(o) * 2;
    const [x, y] = toScreen(b.x, b.y + b.h / 2 - th / 2);
    s.left = `${x}px`;
    s.top = `${y}px`;
    s.width = `${b.w * zoom}px`;
    s.height = `${th * zoom}px`;
    s.textAlign = 'center';
    s.background = 'transparent';
    s.borderRadius = '0';
  }
}

textInput.addEventListener('input', () => {
  const o = find(editingId);
  if (!o) return;
  let next = { ...o, text: textInput.value };
  if (o.type === 'callout') {
    // Grow the bubble to fit what is typed.
    const lines = D.wrap(next.text || ' ', D.fontOf(o), Math.max(1, o.w - D.textPad(o) * 2)).length;
    const need = lines * D.lineHeight(o) + D.textPad(o) * 2;
    if (need > o.h) next = { ...next, h: need };
  }
  replace(next);
  invalidate();
});

textInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Escape' || (e.key === 'Enter' && e.ctrlKey)) {
    e.preventDefault();
    finishEditing();
  }
});
textInput.addEventListener('blur', () => finishEditing());

function finishEditing() {
  if (editingId == null) return;
  const o = find(editingId);
  editingId = null;
  textInput.hidden = true;
  if (o && !o.text.trim()) {
    remove(o.id);
  }
  // A commit even when nothing changed is harmless: it is one undo step.
  if (o) commit();
  renderPanel();
  invalidate();
  view.focus();
}

// ---- Properties panel -----------------------------------------------------

const h = (tag, attrs = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) if (c != null) e.append(c);
  return e;
};

const SEG_ICONS = {
  end: '<path d="M4 12h13M13 8l5 4-5 4"/>', start: '<path d="M7 12h13M11 8l-5 4 5 4"/>',
  both: '<path d="M7 12h10M10 8l-4 4 4 4M14 8l4 4-4 4"/>', none: '<path d="M4 12h16"/>',
  solid: '<path d="M4 12h16"/>', dash: '<path d="M3 12h4M10 12h4M17 12h4"/>', dot: '<path d="M4 12h.01M9 12h.01M14 12h.01M19 12h.01" stroke-width="2.5"/>',
  rect: '<rect x="4" y="6" width="16" height="12"/>', round: '<rect x="4" y="6" width="16" height="12" rx="3.5"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>', circle: '<circle cx="12" cy="12" r="7.5"/>',
  left: '<path d="M4 7h16M4 12h10M4 17h13"/>', center: '<path d="M4 7h16M7 12h10M5.5 17h13"/>', right: '<path d="M4 7h16M10 12h10M7 17h13"/>',
};

const color = (key, label, none = false) => ({ key, label, kind: 'color', none });
const range = (key, label, min, max, step = 1, unit = '', scale = 1) => ({ key, label, kind: 'range', min, max, step, unit, scale });
const seg = (key, label, options) => ({ key, label, kind: 'seg', options });
const toggle = (key, label) => ({ key, label, kind: 'toggle' });
const opacity = range('opacity', 'Opacity', 10, 100, 5, '%', 100);
const shadow = toggle('shadow', 'Shadow');
const font = [
  { key: 'font', label: 'Font', kind: 'select', options: D.FONTS },
  range('size', 'Size', 8, 160, 1, 'px'),
  { key: 'style', label: 'Style', kind: 'style' },
];

const PROPS = {
  arrow: [color('stroke', 'Color'), range('width', 'Thickness', 1, 40, 1, 'px'),
    seg('heads', 'Arrowheads', [['end', 'icon'], ['start', 'icon'], ['both', 'icon'], ['none', 'icon']]),
    seg('dash', 'Line', [['solid', 'icon'], ['dash', 'icon'], ['dot', 'icon']]), opacity, shadow],
  line: [color('stroke', 'Color'), range('width', 'Thickness', 1, 40, 1, 'px'),
    seg('dash', 'Line', [['solid', 'icon'], ['dash', 'icon'], ['dot', 'icon']]), opacity, shadow],
  shape: [seg('kind', 'Shape', [['rect', 'icon'], ['round', 'icon'], ['ellipse', 'icon']]),
    color('stroke', 'Outline', true), range('width', 'Outline width', 0, 30, 1, 'px'), color('fill', 'Fill', true), opacity, shadow],
  text: [color('color', 'Text color'), ...font, seg('align', 'Align', [['left', 'icon'], ['center', 'icon'], ['right', 'icon']]),
    color('outline', 'Outline', true), color('fill', 'Background', true), shadow],
  callout: [color('fill', 'Fill', true), color('stroke', 'Outline', true), range('width', 'Outline width', 0, 12, 1, 'px'),
    color('color', 'Text color'), ...font, shadow],
  stamp: [{ key: 'stamp', label: 'Stamp', kind: 'stamps' }, shadow],
  step: [color('fill', 'Fill'), color('color', 'Number color'), range('radius', 'Size', 8, 80, 1, 'px'),
    seg('stepStyle', 'Labels', [['number', '1 2 3'], ['letter', 'A B C']]), { key: 'n', label: 'Number', kind: 'stepnum' }, shadow],
  pen: [color('stroke', 'Color'), range('width', 'Thickness', 1, 40, 1, 'px'), opacity, shadow],
  highlight: [color('stroke', 'Color'), range('width', 'Thickness', 4, 80, 1, 'px'), range('opacity', 'Opacity', 10, 100, 5, '%', 100)],
  erase: [range('width', 'Size', 4, 160, 1, 'px')],
  blur: [seg('blurKind', 'Effect', [['pixelate', 'Pixelate'], ['blur', 'Blur']]), range('amount', 'Strength', 1, 10)],
  magnify: [range('zoom', 'Zoom', 1.5, 6, 0.5, '×'), seg('lensShape', 'Lens', [['circle', 'icon'], ['rect', 'icon']]),
    color('stroke', 'Border', true), range('width', 'Border width', 0, 16, 1, 'px'), shadow],
  image: [opacity, shadow],
  clear: [],
  fill: [color('color', 'Fill color'), range('tolerance', 'Tolerance', 0, 100, 1, '%')],
  selection: [seg('hole', 'When moving or deleting, leave', [['transparent', 'Transparent'], ['auto', 'Auto-fill']])],
};

const HINTS = {
  move: 'Click an object to select it, drag to move it, and drag its handles to resize it. <kbd>Delete</kbd> removes it, arrow keys nudge it.',
  selection: 'Drag to select part of the image. Drag inside the selection to move that part, or use the buttons below.',
  crop: 'Drag the handles or draw a new area. <kbd>Enter</kbd> applies, <kbd>Esc</kbd> cancels.',
  fill: 'Click an area to fill it and similar colours around it.',
  text: 'Click to type, or drag to set the width. Double-click text to edit it.',
  callout: 'Click or drag to add a callout, then type. Drag the round handle to point the tail.',
  step: 'Click to add the next number.',
};

function renderPanel() {
  const props = $('props');
  props.textContent = '';
  if (!current) {
    $('panel_title').textContent = 'Properties';
    return;
  }
  const obj = selected();
  const type = obj ? obj.type : tool;
  $('panel_title').textContent = obj ? TYPE_LABEL[type] : TOOL_LABEL[tool];
  const values = obj || (styles[type] ?? {});
  for (const def of PROPS[type] || []) props.append(control(def, values, obj));
  if (!obj && HINTS[tool]) props.append(h('p', { class: 'hint', html: HINTS[tool] }));
  if (tool === 'selection' && !obj && region) props.append(regionActions());
  if (tool === 'crop') props.append(cropActions());
  if (obj) props.append(objectActions(obj));
}

function control(def, values, obj) {
  const set = (v, final) => setProp(def.key, v, final, obj);
  const value = values[def.key];
  const wrap = h('div', { class: 'prop' });
  const label = h('div', { class: 'label' }, def.label);
  wrap.append(label);
  switch (def.kind) {
    case 'color': {
      const grid = h('div', { class: 'swatches' });
      if (def.none) grid.append(h('button', { class: 'swatch none', title: 'None', 'aria-pressed': String(value == null), onclick: () => set(null, true) }));
      const known = COLORS.includes(String(value).toLowerCase());
      for (const c of COLORS) {
        grid.append(h('button', { class: 'swatch', title: c, style: `background:${c}`, 'aria-pressed': String(value?.toLowerCase() === c), onclick: () => set(c, true) }));
      }
      const custom = h('label', { class: 'swatch custom', title: 'Other colour', 'aria-pressed': String(value != null && !known), style: value && !known ? `background:${value}` : false },
        h('input', { type: 'color', value: value || '#000000', oninput: (e) => set(e.target.value, false), onchange: (e) => set(e.target.value, true) }));
      grid.append(custom);
      wrap.append(grid);
      break;
    }
    case 'range': {
      const out = h('output', {}, `${Math.round(value * def.scale * 10) / 10}${def.unit}`);
      const input = h('input', {
        type: 'range', min: def.min, max: def.max, step: def.step, value: value * def.scale,
        oninput: (e) => {
          out.textContent = `${e.target.value}${def.unit}`;
          set(Number(e.target.value) / def.scale, false);
        },
        onchange: (e) => set(Number(e.target.value) / def.scale, true),
      });
      wrap.append(h('div', { class: 'range' }, input, out));
      break;
    }
    case 'seg': {
      const row = h('div', { class: 'seg' });
      for (const [v, text] of def.options) {
        const b = h('button', { 'aria-pressed': String(value === v), title: v, onclick: () => set(v, true) });
        if (text === 'icon') b.innerHTML = `<svg viewBox="0 0 24 24">${SEG_ICONS[v]}</svg>`;
        else b.textContent = text;
        row.append(b);
      }
      wrap.append(row);
      break;
    }
    case 'toggle':
      wrap.textContent = '';
      wrap.append(h('label', { class: 'toggle' }, def.label,
        h('input', { type: 'checkbox', checked: !!value, onchange: (e) => set(e.target.checked, true) })));
      break;
    case 'select': {
      const sel = h('select', { onchange: (e) => set(e.target.value, true) });
      for (const o of def.options) sel.append(h('option', { value: o, selected: o === value }, o));
      wrap.append(sel);
      break;
    }
    case 'style': {
      const row = h('div', { class: 'seg' });
      row.append(h('button', { 'aria-pressed': String(!!values.bold), style: 'font-weight:700', onclick: () => setProp('bold', !values.bold, true, obj) }, 'B'));
      row.append(h('button', { 'aria-pressed': String(!!values.italic), style: 'font-style:italic;font-family:Georgia,serif', onclick: () => setProp('italic', !values.italic, true, obj) }, 'I'));
      wrap.append(row);
      break;
    }
    case 'stamps': {
      const grid = h('div', { class: 'stamps' });
      for (const kind of D.STAMPS) {
        const c = h('canvas', { width: 64, height: 64 });
        D.drawStamp(c.getContext('2d'), kind, { x: 6, y: 6, w: 52, h: 52 }, false);
        grid.append(h('button', { title: kind, 'aria-pressed': String(value === kind), onclick: () => set(kind, true) }, c));
      }
      wrap.append(grid);
      break;
    }
    case 'stepnum': {
      label.textContent = obj ? 'Number' : 'Next number';
      const n = obj ? obj.n : stepNumber();
      wrap.append(h('input', {
        type: 'number', min: 1, max: 999, value: n, class: 'wide',
        onchange: (e) => {
          const v = Math.max(1, Math.min(999, Math.round(Number(e.target.value)) || 1));
          if (obj) setProp('n', v, true, obj);
          else nextStep = v;
        },
      }));
      break;
    }
  }
  return wrap;
}

function setProp(key, value, final, obj) {
  const type = obj ? obj.type : tool;
  if (key !== 'n' && styles[type]) {
    styles[type] = { ...styles[type], [key]: value };
    saveStyles();
  }
  if (obj) {
    const live = find(obj.id);
    if (live) {
      replace({ ...live, [key]: value });
      if (final) commit();
    }
    invalidate();
  }
  if (final) renderPanel();
  if (editingId) placeTextInput();
}

function action(icon, text, onclick, cls = '') {
  return h('button', { class: cls, onclick, html: svg(icon) }, text);
}

function objectActions(o) {
  const box = h('div', { class: 'section' }, h('div', { class: 'section-title' }, 'Arrange'));
  const grid = h('div', { class: 'actions' });
  const i = doc.objects.findIndex((x) => x.id === o.id);
  const reorder = (to) => {
    const rest = doc.objects.filter((x) => x.id !== o.id);
    doc.objects = to === 'front' ? [...rest, o] : [o, ...rest];
    commit();
    invalidate();
  };
  grid.append(
    action('front', 'To front', () => reorder('front')),
    action('back', 'To back', () => reorder('back')),
    action('duplicate', 'Duplicate', duplicateSelected),
    action('trash', 'Delete', deleteSelected),
  );
  grid.children[0].disabled = i === doc.objects.length - 1;
  grid.children[1].disabled = i === 0;
  box.append(grid);
  if (o.type === 'text' || o.type === 'callout') {
    box.append(h('button', { class: 'wide', onclick: () => startEditing(o.id) }, 'Edit text'));
  }
  return box;
}

function regionActions() {
  const box = h('div', { class: 'section' }, h('div', { class: 'section-title' }, `Selection ${region.w} × ${region.h}`));
  const grid = h('div', { class: 'actions' });
  grid.append(
    action('copy', 'Copy', () => regionAction('copy')),
    action('crop', 'Crop to it', () => regionAction('crop')),
    action('blur', 'Blur', () => regionAction('blur')),
    action('trash', 'Delete', () => regionAction('delete')),
  );
  box.append(grid);
  return box;
}

function cropActions() {
  const box = h('div', { class: 'section' });
  const grid = h('div', { class: 'actions' });
  grid.append(
    action('check', 'Apply', () => { applyCrop(); setTool('move'); }, 'accent'),
    action('close', 'Cancel', cancelCrop),
  );
  box.append(grid, h('button', { class: 'wide', onclick: () => { cropDraft = full(); invalidate(false); renderPanel(); } }, 'Whole image'));
  return box;
}

function cancelCrop() {
  cropDraft = null;
  setTool('move', false);
}

function deleteSelected() {
  const o = selected();
  if (!o) return;
  remove(o.id);
  commit();
  renderPanel();
  invalidate();
}

function duplicateSelected() {
  const o = selected();
  if (!o) return;
  const copy = add(D.moved(o, 16 / zoom, 16 / zoom));
  commit();
  select(copy.id);
  invalidate();
}

// ---- Toolbar --------------------------------------------------------------

function buildToolbar() {
  const nav = $('tools');
  for (const [id, label] of TOOLS) {
    nav.append(h('button', { class: 'tool', 'data-tool': id, title: label, html: `${svg(id)}<span>${label}</span>`, onclick: () => setTool(id) }));
  }
  const wrap = h('div', { class: 'menu-wrap' });
  const more = h('button', { id: 'more', class: 'tool', 'aria-haspopup': 'menu', onclick: (e) => togglePopup('more_popup', e) });
  const popup = h('div', { id: 'more_popup', class: 'popup', role: 'menu', hidden: true });
  for (const [id, label] of MORE_TOOLS) {
    popup.append(h('button', {
      'data-tool': id, html: `${svg(id)}<span>${label}</span>`,
      onclick: () => { closePopups(); setTool(id); },
    }));
  }
  wrap.append(more, popup);
  nav.append(wrap);
  updateToolbar();
}

function updateToolbar() {
  const inMore = MORE_TOOLS.some(([id]) => id === tool);
  if (inMore) moreTool = tool;
  for (const b of document.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
  const more = $('more');
  more.setAttribute('aria-pressed', String(inMore));
  more.title = 'More tools';
  more.innerHTML = inMore
    ? `${svg(tool)}<span>${TOOL_LABEL[tool]}</span>`
    : `${svg('more')}<span>More</span>`;
}

function setTool(id, apply = true) {
  finishEditing();
  if (tool === 'crop' && id !== 'crop' && apply) applyCrop();
  const wasCrop = tool === 'crop';
  tool = id;
  region = null;
  hoverId = null;
  if (id === 'crop') {
    cropDraft = doc.crop ? { ...doc.crop } : current ? full() : null;
    selectedId = null;
  } else {
    cropDraft = null;
    const o = selected();
    if (o && id !== 'move' && o.type !== id) selectedId = null;
  }
  updateToolbar();
  renderPanel();
  if (wasCrop || id === 'crop') {
    if (fit) refit();
    invalidate();
  } else {
    invalidate(false);
  }
}

function togglePopup(id, e) {
  e?.stopPropagation();
  const p = $(id);
  const open = p.hidden;
  closePopups();
  p.hidden = !open;
}

function closePopups() {
  for (const p of document.querySelectorAll('.popup')) p.hidden = true;
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.menu-wrap')) closePopups();
});

function updateButtons() {
  $('undo').disabled = hIndex <= 0;
  $('redo').disabled = hIndex >= history.length - 1;
  for (const id of ['copy', 'save', 'save_menu']) $(id).disabled = !current;
}

// ---- Copy and save --------------------------------------------------------

function setMessage(text, isError = false, extra = null) {
  const m = $('message');
  m.textContent = text;
  m.title = text;
  m.classList.toggle('error', isError);
  if (extra) m.append(' ', extra);
}

async function pngBytes(canvas) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not render the image');
  return new Uint8Array(await blob.arrayBuffer());
}

const finished = () => {
  finishEditing();
  return renderArea(doc.crop || full());
};

async function copyImage(r = null) {
  if (!current) return;
  try {
    const canvas = r ? renderArea(r) : finished();
    await invoke('editor_copy', await pngBytes(canvas));
    setMessage(r ? 'Selection copied to the clipboard' : 'Image copied to the clipboard');
  } catch (e) {
    setMessage(String(e), true);
  }
}

function revealLink(path) {
  return h('button', { onclick: () => invoke('reveal_file', { path }).catch((e) => setMessage(String(e), true)) }, 'Show in folder');
}

async function save(as = false) {
  if (!current) return;
  const id = current.id;
  try {
    setMessage('Saving...');
    const bytes = await pngBytes(finished());
    const path = await invoke(as ? 'editor_save_as' : 'editor_save', bytes, { headers: { 'x-capture-id': id } });
    if (!path) return setMessage('');
    if (current?.id === id) current.entry = { ...current.entry, saved_path: path };
    entries = entries.map((e) => (e.id === id ? { ...e, saved_path: path } : e));
    setMessage(`Saved to ${path}`, false, revealLink(path));
  } catch (e) {
    setMessage(String(e), true);
  }
}

$('copy').addEventListener('click', () => copyImage());
$('save').addEventListener('click', () => save());
$('save_menu').addEventListener('click', (e) => togglePopup('save_popup', e));
for (const b of $('save_popup').querySelectorAll('button')) {
  b.addEventListener('click', () => {
    closePopups();
    const a = b.dataset.action;
    if (a === 'save') save();
    else if (a === 'save_as') save(true);
    else if (a === 'copy') copyImage();
    else if (a === 'reveal') {
      const path = current?.entry.saved_path;
      if (path) invoke('reveal_file', { path }).catch((e) => setMessage(String(e), true));
      else setMessage('This capture has not been saved to a file yet.');
    }
  });
}
$('undo').addEventListener('click', undo);
$('redo').addEventListener('click', redo);
$('capture').addEventListener('click', () => invoke('start_capture', { mode: null }));
$('open').addEventListener('click', () => importImages(null));

// ---- Library and tray -----------------------------------------------------

const thumbVersion = new Map();
const libraryUrl = (name) => convertFileSrc(name, 'library');

function thumbUrl(id) {
  return `${libraryUrl(`${id}.thumb.png`)}?v=${thumbVersion.get(id) || 0}`;
}

async function refreshList() {
  try {
    entries = await invoke('library_list');
  } catch (e) {
    setMessage(String(e), true);
    entries = [];
  }
  $('count').textContent = entries.length ? String(entries.length) : '';
  renderTray();
  if (current && !entries.some((e) => e.id === current.id)) {
    current = null;
    await open(entries[0]?.id ?? null);
  }
}

function renderTray() {
  const list = $('thumbs');
  list.textContent = '';
  if (!entries.length) {
    list.append(h('span', { class: 'tray-empty' }, 'Captures you take appear here.'));
    return;
  }
  for (const e of entries) {
    const when = new Date(e.created_ms).toLocaleString();
    const del = h('button', { class: 'del', title: 'Remove from recent captures', html: svg('close') });
    const item = h('div', {
      class: 'thumb', role: 'button', tabindex: 0, 'aria-current': String(current?.id === e.id),
      title: `${e.width} × ${e.height} px, ${when}${e.saved_path ? `\n${e.saved_path}` : ''}`,
      onclick: (ev) => { if (!ev.target.closest('.del')) open(e.id); },
      onkeydown: (ev) => { if (ev.key === 'Enter') open(e.id); },
    }, h('img', { src: thumbUrl(e.id), alt: '', draggable: 'false' }), del);
    del.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (!del.classList.contains('confirm')) {
        del.classList.add('confirm');
        del.textContent = 'Remove?';
        setTimeout(() => del.isConnected && renderTray(), 3000);
        return;
      }
      if (current?.id === e.id) saveCancelled = true;
      try {
        await invoke('library_delete', { id: e.id });
      } catch (err) {
        setMessage(String(err), true);
      }
    });
    list.append(item);
  }
  list.querySelector('[aria-current="true"]')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load the capture'));
    img.src = src;
  });
}

let loadToken = 0;
async function open(id) {
  if (current?.id === id) return;
  finishEditing();
  await flushSave();
  const token = ++loadToken;
  if (!id) {
    current = null;
    doc = { crop: null, objects: [] };
    history = [doc];
    hIndex = 0;
    afterOpen();
    return;
  }
  if (!entries.some((e) => e.id === id)) {
    entries = await invoke('library_list').catch(() => entries);
    renderTray();
  }
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  try {
    const [img, saved] = await Promise.all([loadImage(libraryUrl(`${id}.png`)), invoke('library_get_doc', { id })]);
    if (token !== loadToken) return;
    current = { id, entry, img, W: img.naturalWidth, H: img.naturalHeight };
    doc = { crop: saved?.crop ?? null, objects: Array.isArray(saved?.objects) ? saved.objects : [] };
  } catch (e) {
    if (token !== loadToken) return;
    setMessage(String(e), true);
    return;
  }
  nextId = doc.objects.reduce((n, o) => Math.max(n, o.id || 0), 0) + 1;
  doc.objects = doc.objects.map((o) => (o.id ? o : { ...o, id: nextId++ }));
  history = [{ crop: doc.crop, objects: doc.objects }];
  hIndex = 0;
  setMessage('');
  afterOpen();
}

function afterOpen() {
  images.clear();
  alphaCache.clear();
  selectedId = null;
  hoverId = null;
  region = null;
  nextStep = null;
  saveCancelled = false;
  if (tool === 'crop') cropDraft = current ? (doc.crop ? { ...doc.crop } : full()) : null;
  fit = true;
  stage.scrollLeft = stage.scrollTop = 0;
  updateButtons();
  renderTray();
  renderPanel();
  refit();
}

async function importImages(paths) {
  try {
    const ids = await invoke('library_import', { paths });
    if (ids.length) {
      await refreshList();
      await open(ids[ids.length - 1]);
    }
  } catch (e) {
    setMessage(String(e), true);
  }
}

// ---- Autosave -------------------------------------------------------------

let saveTimer = 0;
let pendingSave = null; // id of a capture with unsaved changes
let saveCancelled = false;

function scheduleSave() {
  if (!current) return;
  pendingSave = current.id;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 600);
}

async function flushSave() {
  clearTimeout(saveTimer);
  const id = pendingSave;
  pendingSave = null;
  if (!id || !current || current.id !== id || saveCancelled) return;
  const data = { version: 1, crop: doc.crop, objects: doc.objects };
  try {
    await invoke('library_save_doc', { id, doc: data });
    const r = doc.crop || full();
    const scale = Math.min(1, 320 / Math.max(r.w, r.h));
    const thumb = document.createElement('canvas');
    thumb.width = Math.max(1, Math.round(r.w * scale));
    thumb.height = Math.max(1, Math.round(r.h * scale));
    const ctx = thumb.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(renderArea(r), 0, 0, thumb.width, thumb.height);
    await invoke('library_save_thumb', await pngBytes(thumb), { headers: { 'x-capture-id': id } });
    thumbVersion.set(id, (thumbVersion.get(id) || 0) + 1);
    const img = [...document.querySelectorAll('.thumb[aria-current="true"] img')][0];
    if (img && current?.id === id) img.src = thumbUrl(id);
  } catch (e) {
    // The capture may have been removed meanwhile; only report real failures.
    if (entries.some((x) => x.id === id)) setMessage(`Could not save your changes: ${e}`, true);
  }
}

// ---- Keyboard, paste and drop ---------------------------------------------

window.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t !== document.body && t !== view && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (e.key === ' ' && !spaceDown) {
    spaceDown = true;
    if (!drag) view.style.cursor = 'grab';
    e.preventDefault();
    return;
  }
  if (ctrl) {
    const handled = {
      z: () => (e.shiftKey ? redo() : undo()),
      y: redo,
      s: () => save(e.shiftKey),
      o: () => importImages(null),
      d: duplicateSelected,
      c: () => (region && !e.shiftKey ? copyImage(region) : copyImage()),
      0: setFit,
      1: () => setZoom(1),
      '=': () => setZoom(zoom * 1.25),
      '+': () => setZoom(zoom * 1.25),
      '-': () => setZoom(zoom / 1.25),
    }[key];
    if (handled) {
      e.preventDefault();
      handled();
    }
    return;
  }
  const o = selected();
  switch (e.key) {
    case 'Delete':
    case 'Backspace':
      if (o) deleteSelected();
      else if (region) regionAction('delete');
      break;
    case 'Escape':
      if (tool === 'crop') cancelCrop();
      else if (region) { region = null; renderPanel(); invalidate(false); } else select(null);
      break;
    case 'Enter':
      if (tool === 'crop') { applyCrop(); setTool('move'); } else if (o && (o.type === 'text' || o.type === 'callout')) startEditing(o.id);
      break;
    case 'ArrowLeft':
    case 'ArrowRight':
    case 'ArrowUp':
    case 'ArrowDown': {
      if (!o) return;
      const step = (e.shiftKey ? 10 : 1);
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      replace(D.moved(o, dx, dy));
      commit();
      invalidate();
      break;
    }
    default:
      return;
  }
  e.preventDefault();
});

window.addEventListener('keyup', (e) => {
  if (e.key === ' ') {
    spaceDown = false;
    if (!drag) view.style.cursor = 'default';
  }
});

// Pasting an image adds it as an object in the middle of the view.
window.addEventListener('paste', (e) => {
  if (editingId || !current) return;
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (!item) return;
  e.preventDefault();
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const r = docRegion();
      const scale = Math.min(1, (r.w * 0.8) / img.width, (r.h * 0.8) / img.height);
      const w = img.width * scale, hh = img.height * scale;
      const [cx, cy] = [r.x + r.w / 2, r.y + r.h / 2];
      if (tool !== 'move' && tool !== 'selection') setTool('move');
      const o = add({ type: 'image', ...styles.image, x: cx - w / 2, y: cy - hh / 2, w, h: hh, src: reader.result });
      commit();
      select(o.id);
      invalidate();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(item.getAsFile());
});

// ---- Start ----------------------------------------------------------------

$('toggle_tray').addEventListener('click', (e) => {
  const on = document.querySelector('.editor').classList.toggle('no-tray');
  e.currentTarget.setAttribute('aria-pressed', String(!on));
});
$('toggle_panel').addEventListener('click', (e) => {
  const on = document.querySelector('.editor').classList.toggle('no-panel');
  e.currentTarget.setAttribute('aria-pressed', String(!on));
});

view.tabIndex = 0;
buildToolbar();
updateButtons();
renderPanel();

listen('editor-select', ({ payload }) => open(payload));
listen('library-changed', () => refreshList());

try {
  const { getCurrentWebview } = window.__TAURI__.webview;
  getCurrentWebview().onDragDropEvent(({ payload }) => {
    viewport.classList.toggle('drop', payload.type === 'enter' || payload.type === 'over');
    if (payload.type === 'drop' && payload.paths?.length) importImages(payload.paths);
  });
  // Save pending edits before the window goes away.
  window.__TAURI__.window.getCurrentWindow().onCloseRequested(async () => {
    finishEditing();
    await flushSave();
  });
} catch (e) {
  console.warn(e);
}

(async () => {
  await refreshList();
  const wanted = new URLSearchParams(location.search).get('select');
  await open(wanted && entries.some((e) => e.id === wanted) ? wanted : entries[0]?.id ?? null);
})();
