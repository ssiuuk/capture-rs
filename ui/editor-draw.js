// Drawing, geometry and hit testing for editor objects. Every coordinate
// is in image pixels. Objects are plain data and are never changed in
// place: edits make a new object, so undo snapshots can share them.

export const STAMPS = ['check', 'cross', 'warning', 'info', 'question', 'star', 'heart', 'no'];
export const FONTS = ['Segoe UI', 'Arial', 'Georgia', 'Consolas', 'Comic Sans MS'];

const BOX_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function norm(r) {
  return {
    x: Math.min(r.x, r.x + r.w),
    y: Math.min(r.y, r.y + r.h),
    w: Math.abs(r.w),
    h: Math.abs(r.h),
  };
}

export function intersect(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

// ---- Text layout ----------------------------------------------------------

const measureCtx = document.createElement('canvas').getContext('2d');

export function fontOf(o, size = o.size) {
  return `${o.italic ? 'italic ' : ''}${o.bold ? '700' : '400'} ${size}px "${o.font}", "Segoe UI", sans-serif`;
}

export const lineHeight = (o) => Math.round(o.size * 1.25);
export const textPad = (o) => Math.round(o.size * 0.3);

// Splits text into lines that fit `maxWidth`, breaking at spaces and, for
// words longer than a line, between characters.
export function wrap(text, font, maxWidth) {
  measureCtx.font = font;
  const width = (s) => measureCtx.measureText(s).width;
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const next = line + word;
      if (!line || width(next) <= maxWidth) {
        line = next;
        continue;
      }
      lines.push(line.trimEnd());
      line = word.trimStart();
      while (line && width(line) > maxWidth) {
        let cut = line.length - 1;
        while (cut > 1 && width(line.slice(0, cut)) > maxWidth) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export function textHeight(o) {
  const pad = textPad(o);
  return wrap(o.text, fontOf(o), Math.max(1, o.w - pad * 2)).length * lineHeight(o) + pad * 2;
}

// ---- Geometry -------------------------------------------------------------

function pointsBounds(pts, extra) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]);
    y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]);
  }
  return { x: x0 - extra, y: y0 - extra, w: x1 - x0 + extra * 2, h: y1 - y0 + extra * 2 };
}

export function isLine(o) {
  return o.type === 'arrow' || o.type === 'line';
}

export function isStroke(o) {
  return o.type === 'pen' || o.type === 'highlight' || o.type === 'erase';
}

// The box the object's handles sit on.
export function box(o) {
  if (isLine(o)) return norm({ x: o.x1, y: o.y1, w: o.x2 - o.x1, h: o.y2 - o.y1 });
  if (isStroke(o)) return pointsBounds(o.points, o.width / 2);
  if (o.type === 'step') return { x: o.x - o.radius, y: o.y - o.radius, w: o.radius * 2, h: o.radius * 2 };
  if (o.type === 'text') return { x: o.x, y: o.y, w: o.w, h: textHeight(o) };
  return norm(o);
}

// Everything the object paints, for the selection outline.
export function bounds(o) {
  const b = box(o);
  if (isLine(o)) {
    const pad = o.width * 2;
    return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
  }
  if (o.type === 'callout') {
    const x = Math.min(b.x, o.tx), y = Math.min(b.y, o.ty);
    return { x, y, w: Math.max(b.x + b.w, o.tx) - x, h: Math.max(b.y + b.h, o.ty) - y };
  }
  return b;
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2)) : 0;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

const inside = (r, x, y, tol = 0) => x >= r.x - tol && x <= r.x + r.w + tol && y >= r.y - tol && y <= r.y + r.h + tol;

export function hitTest(o, x, y, tol) {
  if (isLine(o)) return distToSegment(x, y, o.x1, o.y1, o.x2, o.y2) <= o.width / 2 + tol;
  if (isStroke(o)) {
    const p = o.points;
    if (p.length === 2) return Math.hypot(x - p[0], y - p[1]) <= o.width / 2 + tol;
    for (let i = 2; i < p.length; i += 2) {
      if (distToSegment(x, y, p[i - 2], p[i - 1], p[i], p[i + 1]) <= o.width / 2 + tol) return true;
    }
    return false;
  }
  if (o.type === 'step') return Math.hypot(x - o.x, y - o.y) <= o.radius + tol;
  if (o.type === 'callout') {
    const b = box(o);
    return inside(b, x, y, tol) || distToSegment(x, y, b.x + b.w / 2, b.y + b.h / 2, o.tx, o.ty) <= tol + Math.min(b.w, b.h) / 6;
  }
  if (o.type === 'shape' && !o.fill) {
    // An unfilled shape is picked by its outline, so objects inside it
    // stay clickable.
    const b = box(o);
    const t = o.width / 2 + tol;
    return inside(b, x, y, t) && !inside({ x: b.x + t, y: b.y + t, w: b.w - 2 * t, h: b.h - 2 * t }, x, y);
  }
  return inside(box(o), x, y, tol);
}

export function handles(o) {
  if (isLine(o)) return [{ name: 'p1', x: o.x1, y: o.y1 }, { name: 'p2', x: o.x2, y: o.y2 }];
  if (isStroke(o) || o.type === 'step') return [];
  const b = box(o);
  const at = { n: [0.5, 0], s: [0.5, 1], e: [1, 0.5], w: [0, 0.5], nw: [0, 0], ne: [1, 0], sw: [0, 1], se: [1, 1] };
  const names = o.type === 'text' ? ['e', 'w'] : BOX_HANDLES;
  const list = names.map((name) => ({ name, x: b.x + b.w * at[name][0], y: b.y + b.h * at[name][1] }));
  if (o.type === 'callout') list.push({ name: 'tail', x: o.tx, y: o.ty });
  return list;
}

export const HANDLE_CURSORS = {
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
  nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
  p1: 'crosshair', p2: 'crosshair', tail: 'crosshair',
};

// Resizes a rectangle by dragging one of its handles to (x, y).
export function resizeRect(b, handle, x, y, keepAspect = false) {
  let l = b.x, t = b.y, r = b.x + b.w, btm = b.y + b.h;
  if (handle.includes('w')) l = x;
  if (handle.includes('e')) r = x;
  if (handle.includes('n')) t = y;
  if (handle.includes('s')) btm = y;
  if (keepAspect && handle.length === 2 && b.w > 0 && b.h > 0) {
    const ratio = b.w / b.h;
    const w = Math.abs(r - l), h = Math.abs(btm - t);
    if (w / ratio > h) {
      const nh = w / ratio;
      if (handle.includes('n')) t = btm - nh * Math.sign(btm - t || 1); else btm = t + nh * Math.sign(btm - t || 1);
    } else {
      const nw = h * ratio;
      if (handle.includes('w')) l = r - nw * Math.sign(r - l || 1); else r = l + nw * Math.sign(r - l || 1);
    }
  }
  return norm({ x: l, y: t, w: r - l, h: btm - t });
}

export function withHandle(o, handle, x, y, shift) {
  if (handle === 'p1' || handle === 'p2') {
    const [ax, ay] = handle === 'p1' ? [o.x2, o.y2] : [o.x1, o.y1];
    if (shift) [x, y] = snapAngle(ax, ay, x, y);
    return handle === 'p1' ? { ...o, x1: x, y1: y } : { ...o, x2: x, y2: y };
  }
  if (handle === 'tail') return { ...o, tx: x, ty: y };
  const keep = o.type === 'image' || o.type === 'stamp' || (shift && o.type !== 'text');
  const r = resizeRect(box(o), handle, x, y, keep);
  r.w = Math.max(r.w, 4);
  r.h = Math.max(r.h, 4);
  if (o.type === 'text') return { ...o, x: r.x, w: Math.max(r.w, o.size) };
  return { ...o, ...r };
}

// Snaps (x, y) so the line from (ax, ay) is at a multiple of 45 degrees.
export function snapAngle(ax, ay, x, y) {
  const len = Math.hypot(x - ax, y - ay);
  const angle = Math.round(Math.atan2(y - ay, x - ax) / (Math.PI / 4)) * (Math.PI / 4);
  return [ax + Math.cos(angle) * len, ay + Math.sin(angle) * len];
}

export function moved(o, dx, dy) {
  if (isLine(o)) return { ...o, x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy };
  if (isStroke(o)) return { ...o, points: o.points.map((v, i) => v + (i % 2 ? dy : dx)) };
  if (o.type === 'callout') return { ...o, x: o.x + dx, y: o.y + dy, tx: o.tx + dx, ty: o.ty + dy };
  return { ...o, x: o.x + dx, y: o.y + dy };
}

// ---- Drawing --------------------------------------------------------------

function shadow(ctx, o, size = o.width || 4) {
  if (!o.shadow) return;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
  ctx.shadowBlur = Math.max(4, size * 1.5);
  ctx.shadowOffsetX = ctx.shadowOffsetY = Math.max(2, size * 0.4);
}

function noShadow(ctx) {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = ctx.shadowOffsetX = ctx.shadowOffsetY = 0;
}

function dash(ctx, o) {
  const w = o.width;
  if (o.dash === 'dash') ctx.setLineDash([w * 3, w * 2]);
  else if (o.dash === 'dot') ctx.setLineDash([0.1, w * 2]);
  else ctx.setLineDash([]);
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
}

function drawLine(ctx, o) {
  const { x1, y1, x2, y2 } = o;
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 1) return;
  const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
  const head = Math.min(len * 0.6, Math.max(12, o.width * 3.2));
  const half = head * 0.58;
  const atEnd = o.heads === 'end' || o.heads === 'both';
  const atStart = o.heads === 'start' || o.heads === 'both';
  ctx.globalAlpha = o.opacity ?? 1;
  shadow(ctx, o);
  ctx.strokeStyle = ctx.fillStyle = o.stroke;
  ctx.lineWidth = o.width;
  ctx.lineCap = o.dash === 'dot' ? 'round' : (atStart || atEnd ? 'butt' : 'round');
  dash(ctx, o);
  ctx.beginPath();
  ctx.moveTo(x1 + (atStart ? ux * head * 0.8 : 0), y1 + (atStart ? uy * head * 0.8 : 0));
  ctx.lineTo(x2 - (atEnd ? ux * head * 0.8 : 0), y2 - (atEnd ? uy * head * 0.8 : 0));
  ctx.stroke();
  ctx.setLineDash([]);
  const tip = (tx, ty, dx, dy) => {
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - dx * head - dy * half, ty - dy * head + dx * half);
    ctx.lineTo(tx - dx * head * 0.8, ty - dy * head * 0.8);
    ctx.lineTo(tx - dx * head + dy * half, ty - dy * head - dx * half);
    ctx.closePath();
    ctx.fill();
  };
  if (atEnd) tip(x2, y2, ux, uy);
  if (atStart) tip(x1, y1, -ux, -uy);
}

function shapePath(ctx, o, b) {
  if (o.kind === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
  } else {
    roundRectPath(ctx, b.x, b.y, b.w, b.h, o.kind === 'round' ? Math.min(b.w, b.h) * 0.15 : 0);
  }
}

function drawShape(ctx, o) {
  const b = norm(o);
  ctx.globalAlpha = o.opacity ?? 1;
  shadow(ctx, o);
  shapePath(ctx, o, b);
  if (o.fill) {
    ctx.fillStyle = o.fill;
    ctx.fill();
    if (o.stroke && o.width) noShadow(ctx);
  }
  if (o.stroke && o.width) {
    ctx.strokeStyle = o.stroke;
    ctx.lineWidth = o.width;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}

function drawLines(ctx, o, lines, x, y, w) {
  const lh = lineHeight(o);
  ctx.font = fontOf(o);
  ctx.textBaseline = 'middle';
  ctx.textAlign = o.align || 'left';
  const ax = o.align === 'center' ? x + w / 2 : o.align === 'right' ? x + w : x;
  const lineY = (i) => y + lh * i + lh / 2;
  if (o.outline) {
    // The outline carries any shadow, so the letters stay crisp.
    ctx.strokeStyle = o.outline;
    ctx.lineWidth = Math.max(2, o.size * 0.16);
    ctx.lineJoin = 'round';
    lines.forEach((line, i) => ctx.strokeText(line, ax, lineY(i)));
    noShadow(ctx);
  }
  ctx.fillStyle = o.color;
  lines.forEach((line, i) => ctx.fillText(line, ax, lineY(i)));
}

function drawText(ctx, o, env) {
  const pad = textPad(o);
  const h = textHeight(o);
  if (o.fill) {
    shadow(ctx, o, 6);
    ctx.fillStyle = o.fill;
    roundRectPath(ctx, o.x, o.y, o.w, h, pad);
    ctx.fill();
    noShadow(ctx);
  } else {
    shadow(ctx, o, 4);
  }
  if (env.editing === o.id) return;
  drawLines(ctx, o, wrap(o.text, fontOf(o), Math.max(1, o.w - pad * 2)), o.x + pad, o.y + pad, o.w - pad * 2);
}

function drawCallout(ctx, o, env) {
  const b = norm(o);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const len = Math.hypot(o.tx - cx, o.ty - cy) || 1;
  // The tail's base straddles the bubble's centre, so its join is hidden
  // under the bubble's fill.
  const base = Math.max(6, Math.min(b.w, b.h) * 0.22);
  const nx = -(o.ty - cy) / len * base, ny = (o.tx - cx) / len * base;
  const radius = Math.min(b.w, b.h) * 0.2;
  const tail = () => {
    ctx.beginPath();
    ctx.moveTo(cx + nx, cy + ny);
    ctx.lineTo(o.tx, o.ty);
    ctx.lineTo(cx - nx, cy - ny);
    ctx.closePath();
  };
  const bubble = () => roundRectPath(ctx, b.x, b.y, b.w, b.h, radius);
  if (o.stroke && o.width) {
    shadow(ctx, o);
    ctx.strokeStyle = o.stroke;
    ctx.lineWidth = o.width * 2;
    ctx.lineJoin = 'round';
    bubble(); ctx.stroke();
    tail(); ctx.stroke();
    noShadow(ctx);
  } else {
    shadow(ctx, o);
  }
  ctx.fillStyle = o.fill || 'transparent';
  if (o.fill) {
    bubble(); ctx.fill();
    tail(); ctx.fill();
  }
  noShadow(ctx);
  if (env.editing === o.id || !o.text) return;
  const pad = textPad(o);
  const lines = wrap(o.text, fontOf(o), Math.max(1, b.w - pad * 2));
  const th = lines.length * lineHeight(o);
  ctx.save();
  ctx.beginPath();
  ctx.rect(b.x, b.y, b.w, b.h);
  ctx.clip();
  drawLines(ctx, { ...o, align: 'center' }, lines, b.x + pad, cy - th / 2, b.w - pad * 2);
  ctx.restore();
}

function starPath(ctx, cx, cy, outer, inner) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
}

function glyph(ctx, text, cx, cy, size, color) {
  ctx.fillStyle = color;
  ctx.font = `700 ${size}px "Segoe UI", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy + size * 0.04);
}

export function drawStamp(ctx, kind, b, withShadow) {
  const s = Math.min(b.w, b.h);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, r = s / 2;
  const circle = (color) => {
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.94, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    noShadow(ctx);
    ctx.lineWidth = s * 0.05;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  };
  if (withShadow) shadow(ctx, { shadow: true }, s * 0.06);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (kind) {
    case 'check':
      circle('#16a34a');
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = s * 0.11;
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.45, cy + r * 0.02);
      ctx.lineTo(cx - r * 0.12, cy + r * 0.35);
      ctx.lineTo(cx + r * 0.48, cy - r * 0.3);
      ctx.stroke();
      break;
    case 'cross':
      circle('#dc2626');
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = s * 0.11;
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.35, cy - r * 0.35); ctx.lineTo(cx + r * 0.35, cy + r * 0.35);
      ctx.moveTo(cx + r * 0.35, cy - r * 0.35); ctx.lineTo(cx - r * 0.35, cy + r * 0.35);
      ctx.stroke();
      break;
    case 'warning': {
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 0.92);
      ctx.lineTo(cx + r, cy + r * 0.8);
      ctx.lineTo(cx - r, cy + r * 0.8);
      ctx.closePath();
      ctx.fillStyle = '#f59e0b';
      ctx.fill();
      noShadow(ctx);
      ctx.lineWidth = s * 0.05;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      glyph(ctx, '!', cx, cy + r * 0.18, s * 0.55, '#1c1917');
      break;
    }
    case 'info':
      circle('#0284c7');
      glyph(ctx, 'i', cx, cy, s * 0.62, '#ffffff');
      break;
    case 'question':
      circle('#7c3aed');
      glyph(ctx, '?', cx, cy, s * 0.6, '#ffffff');
      break;
    case 'star':
      starPath(ctx, cx, cy + r * 0.05, r, r * 0.45);
      ctx.fillStyle = '#facc15';
      ctx.fill();
      noShadow(ctx);
      ctx.lineWidth = s * 0.04;
      ctx.strokeStyle = '#a16207';
      ctx.stroke();
      break;
    case 'heart': {
      const t = cy - r * 0.45;
      ctx.beginPath();
      ctx.moveTo(cx, cy + r * 0.85);
      ctx.bezierCurveTo(cx - r * 1.3, cy, cx - r * 0.75, t - r * 0.6, cx, t + r * 0.05);
      ctx.bezierCurveTo(cx + r * 0.75, t - r * 0.6, cx + r * 1.3, cy, cx, cy + r * 0.85);
      ctx.fillStyle = '#e11d48';
      ctx.fill();
      break;
    }
    case 'no':
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
      ctx.moveTo(cx - r * 0.57, cy - r * 0.57);
      ctx.lineTo(cx + r * 0.57, cy + r * 0.57);
      ctx.strokeStyle = '#dc2626';
      ctx.lineWidth = s * 0.14;
      ctx.stroke();
      break;
  }
}

function drawStep(ctx, o) {
  shadow(ctx, o, o.radius / 4);
  ctx.beginPath();
  ctx.arc(o.x, o.y, o.radius, 0, Math.PI * 2);
  ctx.fillStyle = o.fill;
  ctx.fill();
  noShadow(ctx);
  if (o.stroke) {
    ctx.lineWidth = Math.max(1.5, o.radius * 0.12);
    ctx.strokeStyle = o.stroke;
    ctx.stroke();
  }
  const label = stepLabel(o.n, o.stepStyle);
  glyph(ctx, label, o.x, o.y, o.radius * (label.length > 1 ? 0.95 : 1.15), o.color);
}

export function stepLabel(n, style) {
  if (style !== 'letter') return String(n);
  let s = '';
  for (let v = n; v > 0; v = Math.floor((v - 1) / 26)) s = String.fromCharCode(65 + ((v - 1) % 26)) + s;
  return s;
}

function strokePath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  if (pts.length === 2) {
    ctx.lineTo(pts[0] + 0.01, pts[1]);
    return;
  }
  // Curves through the midpoints smooth out the jitter of the pointer.
  for (let i = 2; i < pts.length - 2; i += 2) {
    ctx.quadraticCurveTo(pts[i], pts[i + 1], (pts[i] + pts[i + 2]) / 2, (pts[i + 1] + pts[i + 3]) / 2);
  }
  ctx.lineTo(pts[pts.length - 2], pts[pts.length - 1]);
}

function drawStroke(ctx, o) {
  ctx.lineWidth = o.width;
  ctx.lineJoin = 'round';
  ctx.lineCap = o.type === 'highlight' ? 'square' : 'round';
  if (o.type === 'erase') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = '#000';
  } else {
    ctx.globalAlpha = o.opacity ?? 1;
    ctx.strokeStyle = o.stroke;
    if (o.type === 'highlight') ctx.globalCompositeOperation = 'multiply';
    else shadow(ctx, o);
  }
  strokePath(ctx, o.points);
  ctx.stroke();
}

// Copies part of what has been drawn so far (in image coordinates) into the
// scratch canvas, which then holds it at its natural size.
function grab(ctx, env, r) {
  const src = intersect(r, { x: env.ox, y: env.oy, w: ctx.canvas.width, h: ctx.canvas.height });
  if (!src) return null;
  const s = env.scratch;
  s.width = Math.ceil(src.w);
  s.height = Math.ceil(src.h);
  const sctx = s.getContext('2d');
  sctx.clearRect(0, 0, s.width, s.height);
  sctx.drawImage(ctx.canvas, src.x - env.ox, src.y - env.oy, src.w, src.h, 0, 0, src.w, src.h);
  return src;
}

function drawBlur(ctx, o, env) {
  const b = norm(o);
  if (b.w < 1 || b.h < 1) return;
  if (o.blurKind === 'pixelate') {
    const src = grab(ctx, env, b);
    if (!src) return;
    const block = Math.max(2, o.amount * 3);
    const tw = Math.max(1, Math.round(src.w / block)), th = Math.max(1, Math.round(src.h / block));
    const small = env.scratch2;
    small.width = tw;
    small.height = th;
    small.getContext('2d').drawImage(env.scratch, 0, 0, src.w, src.h, 0, 0, tw, th);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, tw, th, src.x, src.y, src.w, src.h);
    return;
  }
  const radius = Math.max(1, o.amount * 2.5);
  const pad = radius * 2;
  const src = grab(ctx, env, { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 });
  if (!src) return;
  ctx.beginPath();
  ctx.rect(b.x, b.y, b.w, b.h);
  ctx.clip();
  ctx.filter = `blur(${radius}px)`;
  // Draw twice so the blur also covers anything with transparent edges.
  ctx.drawImage(env.scratch, 0, 0, src.w, src.h, src.x, src.y, src.w, src.h);
  ctx.drawImage(env.scratch, 0, 0, src.w, src.h, src.x, src.y, src.w, src.h);
}

function drawMagnify(ctx, o, env) {
  const b = norm(o);
  if (b.w < 2 || b.h < 2) return;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const sw = b.w / o.zoom, sh = b.h / o.zoom;
  const want = { x: cx - sw / 2, y: cy - sh / 2, w: sw, h: sh };
  const src = grab(ctx, env, want);
  const lens = () => {
    ctx.beginPath();
    if (o.lensShape === 'rect') ctx.rect(b.x, b.y, b.w, b.h);
    else ctx.ellipse(cx, cy, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
  };
  ctx.save();
  shadow(ctx, o);
  lens();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();
  if (src) {
    ctx.save();
    lens();
    ctx.clip();
    ctx.imageSmoothingEnabled = o.zoom < 3;
    const dx = b.x + (src.x - want.x) * o.zoom, dy = b.y + (src.y - want.y) * o.zoom;
    ctx.drawImage(env.scratch, 0, 0, src.w, src.h, dx, dy, src.w * o.zoom, src.h * o.zoom);
    ctx.restore();
  }
  if (o.stroke && o.width) {
    lens();
    ctx.strokeStyle = o.stroke;
    ctx.lineWidth = o.width;
    ctx.stroke();
  }
}

function drawImageObject(ctx, o, env) {
  const img = env.image(o.src);
  if (!img) return;
  const b = norm(o);
  ctx.globalAlpha = o.opacity ?? 1;
  shadow(ctx, o, 6);
  ctx.drawImage(img, b.x, b.y, b.w, b.h);
}

function drawClear(ctx, o) {
  const b = norm(o);
  if (o.color) {
    ctx.fillStyle = o.color;
  } else {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
  }
  ctx.fillRect(b.x, b.y, b.w, b.h);
}

// `env`: { ox, oy } = image position of the canvas's top-left pixel,
// scratch canvases, image(src) for loaded images, editing = id of the
// object whose text is being typed.
export function drawObject(ctx, o, env) {
  ctx.save();
  switch (o.type) {
    case 'arrow':
    case 'line': drawLine(ctx, o); break;
    case 'shape': drawShape(ctx, o); break;
    case 'text': drawText(ctx, o, env); break;
    case 'callout': drawCallout(ctx, o, env); break;
    case 'stamp': drawStamp(ctx, o.stamp, norm(o), o.shadow); break;
    case 'step': drawStep(ctx, o); break;
    case 'pen':
    case 'highlight':
    case 'erase': drawStroke(ctx, o); break;
    case 'blur': drawBlur(ctx, o, env); break;
    case 'magnify': drawMagnify(ctx, o, env); break;
    case 'image': drawImageObject(ctx, o, env); break;
    case 'clear': drawClear(ctx, o); break;
  }
  ctx.restore();
}

// ---- Fill -----------------------------------------------------------------

// Flood-fills from (sx, sy) over pixels within `tolerance` (0-255) of the
// seed colour. Returns the filled area as a canvas, or null.
export function floodFill(data, width, height, sx, sy, tolerance, color) {
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return null;
  const px = data.data;
  const seed = (sy * width + sx) * 4;
  const [r0, g0, b0, a0] = [px[seed], px[seed + 1], px[seed + 2], px[seed + 3]];
  const match = (i) => {
    const p = i * 4;
    return Math.abs(px[p] - r0) <= tolerance && Math.abs(px[p + 1] - g0) <= tolerance &&
      Math.abs(px[p + 2] - b0) <= tolerance && Math.abs(px[p + 3] - a0) <= tolerance;
  };
  const mask = new Uint8Array(width * height);
  let minX = sx, maxX = sx, minY = sy, maxY = sy;
  const stack = [sx, sy];
  while (stack.length) {
    const y = stack.pop(), x0 = stack.pop();
    let x = x0;
    const row = y * width;
    if (mask[row + x] || !match(row + x)) continue;
    while (x > 0 && !mask[row + x - 1] && match(row + x - 1)) x--;
    let up = false, down = false;
    for (; x < width && !mask[row + x] && match(row + x); x++) {
      mask[row + x] = 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y > 0) {
        const m = !mask[row - width + x] && match(row - width + x);
        if (m && !up) stack.push(x, y - 1);
        up = m;
      }
      if (y < height - 1) {
        const m = !mask[row + width + x] && match(row + width + x);
        if (m && !down) stack.push(x, y + 1);
        down = m;
      }
    }
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const w = maxX - minX + 1, h = maxY - minY + 1;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d');
  const img = octx.createImageData(w, h);
  const [r, g, b] = hexToRgb(color);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[(y + minY) * width + x + minX]) continue;
      const p = (y * w + x) * 4;
      img.data[p] = r; img.data[p + 1] = g; img.data[p + 2] = b; img.data[p + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return { canvas: out, x: minX, y: minY, w, h };
}

export function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
