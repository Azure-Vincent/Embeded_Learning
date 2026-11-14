// Schematic symbols and small form controls shared by the electronics widgets (DOM side; the maths is in electronics.js).
// Symbols are drawn on an SVG user-unit grid; all colours come from CSS classes in css/w-electronics.css.
import { h, s, clear } from '../core/dom.js';

// ---------------------------------------------------------------- SVG primitives
export const svg = (w, hgt, label, ...kids) => s('svg', { class: 'w-svg el-svg', viewBox: `0 0 ${w} ${hgt}`, role: 'img', 'aria-label': label }, ...kids);
export const g = (attrs, ...kids) => s('g', attrs, ...kids);
const path = (d, cls = 'el-wire') => s('path', { d, class: cls });
/** wire([x,y],[x,y],...) — pass a string as the first argument to override the class. */
export function wire(...pts) {
  let cls = 'el-wire';
  if (typeof pts[0] === 'string') cls = pts.shift();
  return path('M' + pts.map((p) => p.join(' ')).join('L'), cls);
}
export const dot = (x, y) => s('circle', { cx: x, cy: y, r: 2.6, class: 'el-dot' });
export function txt(x, y, str, { anchor = 'start', cls = '' } = {}) {
  return s('text', { x, y, 'text-anchor': anchor, class: 'el-t ' + cls }, str);
}
/** Arrow from (x1,y1) to (x2,y2) with a filled head. */
export function arrow(x1, y1, x2, y2, cls = 'el-arrow') {
  const a = Math.atan2(y2 - y1, x2 - x1), L = 6, W = 3;
  const bx = x2 - L * Math.cos(a), by = y2 - L * Math.sin(a);
  const p = (dx) => `${bx + dx * W * Math.sin(a)} ${by - dx * W * Math.cos(a)}`;
  return g({ class: cls }, s('path', { d: `M${x1} ${y1}L${bx} ${by}` }), s('path', { d: `M${x2} ${y2}L${p(1)}L${p(-1)}Z`, class: 'head' }));
}
// Rotate helper: symbols are authored left-to-right starting at (0,0), then placed.
const place = (x, y, dir, ...kids) => g({ transform: `translate(${x} ${y})${dir === 'v' ? ' rotate(90)' : dir === 'u' ? ' rotate(-90)' : dir === 'l' ? ' rotate(180)' : ''}` }, ...kids);
// Labels are placed un-rotated: above a horizontal part, to the right of a vertical one.
function labels(x, y, dir, len, label, sub, off = 12) {
  const out = [];
  if (dir === 'v' || dir === 'u') {
    const cy = dir === 'v' ? y + len / 2 : y - len / 2;
    if (label) out.push(txt(x + off, cy - (sub ? 2 : -4), label));
    if (sub) out.push(txt(x + off, cy + 12, sub, { cls: 'sub' }));
  } else {
    const cx = dir === 'l' ? x - len / 2 : x + len / 2;
    if (label) out.push(txt(cx, y - off - (sub ? 12 : 0), label, { anchor: 'middle' }));
    if (sub) out.push(txt(cx, y - off, sub, { anchor: 'middle', cls: 'sub' }));
  }
  return out;
}

/** Resistor (zig-zag), 60 units between terminals. dir: 'h' right, 'v' down. */
export function resistor(x, y, dir = 'h', label, sub, cls = '') {
  return g({ class: 'el-part ' + cls },
    place(x, y, dir, path('M0 0H12L15 -6L21 6L27 -6L33 6L39 -6L45 6L48 0H60')),
    ...labels(x, y, dir, 60, label, sub));
}
/** Capacitor, 40 units between terminals. */
export function capacitor(x, y, dir = 'v', label, sub) {
  return g({ class: 'el-part' }, place(x, y, dir, path('M0 0H17M17 -9V9M23 -9V9M23 0H40')), ...labels(x, y, dir, 40, label, sub, 14));
}
/** Diode, anode at the start terminal, 40 units long. */
export function diode(x, y, dir = 'h', label, sub, cls = '') {
  return g({ class: 'el-part ' + cls }, place(x, y, dir, path('M0 0H14M26 0H40M26 -7V7'), s('path', { d: 'M14 -7V7L26 0Z', class: 'el-fill' })), ...labels(x, y, dir, 40, label, sub, 14));
}
/** LED, anode at the start terminal, 40 units long. `glow` 0…1 draws a lit halo. */
export function led(x, y, dir = 'h', label, sub, { glow = 0, cls = '' } = {}) {
  const halo = glow > 0 ? s('circle', { cx: 20, cy: 0, r: 17, class: 'el-glow', style: `opacity:${Math.min(1, 0.15 + glow * 0.85).toFixed(2)}` }) : null;
  return g({ class: 'el-part el-led ' + cls },
    place(x, y, dir, halo, path('M0 0H14M26 0H40M26 -7V7'), s('path', { d: 'M14 -7V7L26 0Z', class: 'el-fill' }),
      arrow(22, -10, 29, -18, 'el-arrow el-ray'), arrow(29, -8, 36, -16, 'el-arrow el-ray')),
    ...labels(x, y, dir, 40, label, sub, dir === 'h' ? 22 : 16));
}
export const gnd = (x, y) => g({ class: 'el-part' }, path(`M${x} ${y}V${y + 6}M${x - 9} ${y + 6}H${x + 9}M${x - 6} ${y + 10}H${x + 6}M${x - 3} ${y + 14}H${x + 3}`));
/** Supply rail marker above (x,y). */
export const rail = (x, y, label) => g({ class: 'el-part' }, path(`M${x} ${y}V${y - 6}M${x - 9} ${y - 6}H${x + 9}`), txt(x, y - 11, label, { anchor: 'middle', cls: 'rail' }));
/** Battery / DC source drawn vertically, + at the top, 40 units tall from (x,y) down. */
export function battery(x, y, label, sub) {
  return g({ class: 'el-part' }, path(`M${x} ${y}V${y + 15}M${x - 10} ${y + 15}H${x + 10}M${x - 5} ${y + 21}H${x + 5}M${x} ${y + 21}V${y + 40}`),
    txt(x - 14, y + 13, '+', { anchor: 'end' }), label ? txt(x - 14, y + 30, label, { anchor: 'end' }) : null, sub ? txt(x - 14, y + 43, sub, { anchor: 'end', cls: 'sub' }) : null);
}
/** SPST switch, 40 units, horizontal. */
export function sw(x, y, dir = 'h', closed = false, label) {
  return g({ class: 'el-part' }, place(x, y, dir, path(`M0 0H10M30 0H40M10 0L${closed ? '30 0' : '28 -11'}`), s('circle', { cx: 10, cy: 0, r: 2, class: 'el-dot' }), s('circle', { cx: 30, cy: 0, r: 2, class: 'el-dot' })),
    ...labels(x, y, dir, 40, label, null, 16));
}
/** Motor: circle with M, vertical, 50 units tall. */
export function motor(x, y, label, sub) {
  return g({ class: 'el-part' }, path(`M${x} ${y}V${y + 10}M${x} ${y + 40}V${y + 50}`), s('circle', { cx: x, cy: y + 25, r: 15, class: 'el-body' }), txt(x, y + 29.5, 'M', { anchor: 'middle' }), ...labels(x, y, 'v', 50, label, sub, 20));
}
/** Inductor / relay coil, vertical, 50 units tall. */
export function coil(x, y, label, sub) {
  return g({ class: 'el-part' }, path(`M${x} ${y}V${y + 7}a6 6 0 0 1 0 12a6 6 0 0 1 0 12a6 6 0 0 1 0 12V${y + 50}`), ...labels(x, y, 'v', 50, label, sub, 14));
}
/** Lamp / generic resistive load box (IEC style), vertical, 50 units tall. */
export function loadBox(x, y, label, sub) {
  return g({ class: 'el-part' }, path(`M${x} ${y}V${y + 8}M${x} ${y + 42}V${y + 50}`), s('rect', { x: x - 8, y: y + 8, width: 16, height: 34, class: 'el-body' }), ...labels(x, y, 'v', 50, label, sub, 14));
}
/** N-channel enhancement MOSFET. Terminals: gate (x-30,y), drain (x,y-28), source (x,y+28). */
export function nmos(x, y, cls = '') {
  return g({ class: 'el-part ' + cls },
    path(`M${x - 30} ${y}H${x - 14}M${x - 14} ${y - 12}V${y + 12}`),
    path(`M${x - 9} ${y - 15}V${y - 7}M${x - 9} ${y - 4}V${y + 4}M${x - 9} ${y + 7}V${y + 15}`),
    path(`M${x - 9} ${y - 11}H${x}V${y - 28}M${x - 9} ${y + 11}H${x}V${y + 28}M${x - 9} ${y}H${x}V${y + 11}`),
    s('path', { d: `M${x - 9} ${y}l6 -3.2v6.4Z`, class: 'el-fill' }));
}
/** NPN transistor. Terminals: base (x-30,y), collector (x,y-28), emitter (x,y+28). */
export function npn(x, y, cls = '') {
  return g({ class: 'el-part ' + cls },
    s('circle', { cx: x - 5, cy: y, r: 17, class: 'el-body' }),
    path(`M${x - 30} ${y}H${x - 12}M${x - 12} ${y - 11}V${y + 11}M${x - 12} ${y - 5}L${x} ${y - 14}V${y - 28}M${x - 12} ${y + 5}L${x} ${y + 14}V${y + 28}`),
    s('path', { d: `M${x} ${y + 14}l-7.4 -1.6l3.8 -5Z`, class: 'el-fill' }));
}
/** MCU body with one pin leaving its right edge at (x,y). */
export function mcu(x, y, label = 'MCU', pin = 'GPIO', w = 54, hgt = 46) {
  return g({ class: 'el-part' }, s('rect', { x: x - w - 12, y: y - hgt / 2, width: w, height: hgt, rx: 3, class: 'el-chip' }),
    txt(x - 12 - w / 2, y - 3, label, { anchor: 'middle', cls: 'sub' }), txt(x - 12 - w / 2, y + 11, pin, { anchor: 'middle' }), path(`M${x - 12} ${y}H${x}`));
}
/** Animated dashes along a path to suggest current; speed follows `amps` on a log scale. Pure CSS animation. */
export function flow(d, amps, reverse = false) {
  if (!(Math.abs(amps) > 1e-7) || !isFinite(amps)) return null;
  const dur = Math.max(0.25, Math.min(6, 0.9 - 0.75 * Math.log10(Math.abs(amps) / 0.01)));
  return s('path', { d, class: 'el-flow' + (reverse ? ' rev' : ''), style: `animation-duration:${dur.toFixed(2)}s` });
}

// ---------------------------------------------------------------- plots
/** Maps data to plot pixels: returns {x(v), y(v), frame} for a rectangle. */
export function scale(box, x0, x1, y0, y1) {
  return { x: (v) => box.x + (v - x0) / (x1 - x0) * box.w, y: (v) => box.y + box.h - (v - y0) / (y1 - y0) * box.h, box };
}
export function axes(sc, { xlabel, ylabel, xticks = [], yticks = [] }) {
  const b = sc.box, k = [s('rect', { x: b.x, y: b.y, width: b.w, height: b.h, class: 'el-plot' })];
  for (const [v, lab] of xticks) k.push(path(`M${sc.x(v)} ${b.y}V${b.y + b.h}`, 'el-grid'), txt(sc.x(v), b.y + b.h + 13, lab, { anchor: 'middle', cls: 'sub' }));
  for (const [v, lab] of yticks) k.push(path(`M${b.x} ${sc.y(v)}H${b.x + b.w}`, 'el-grid'), txt(b.x - 4, sc.y(v) + 4, lab, { anchor: 'end', cls: 'sub' }));
  if (xlabel) k.push(txt(b.x + b.w, b.y + b.h + 26, xlabel, { anchor: 'end', cls: 'sub' }));
  if (ylabel) k.push(txt(b.x, b.y - 6, ylabel, { cls: 'sub' }));
  return g({}, ...k);
}
export const polyline = (pts, cls) => s('path', { d: 'M' + pts.map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L'), class: 'el-trace ' + cls });

// ---------------------------------------------------------------- form controls
let uid = 0;
/**
 * Labelled range slider. Options: {label, min, max, step, value, fmt, oninput, list, log}.
 * `list`: the slider picks an entry of the array (used for E-series values). `log`: logarithmic mapping min…max.
 * Returns { el, get(), set(v) }.
 */
export function slider({ label, min = 0, max = 1, step = 1, value, fmt = String, oninput, list, log }) {
  const id = 'elf' + (++uid);
  const toPos = (v) => list ? list.reduce((b, x, i) => Math.abs(Math.log(x / v)) < Math.abs(Math.log(list[b] / v)) ? i : b, 0)
    : log ? Math.round(Math.log(v / min) / Math.log(max / min) * 400) : v;
  const fromPos = (p) => list ? list[p] : log ? +(min * (max / min) ** (p / 400)).toPrecision(3) : p;
  const out = h('output', { for: id });
  const input = h('input', { type: 'range', id, min: list || log ? 0 : min, max: list ? list.length - 1 : log ? 400 : max, step: list || log ? 1 : step });
  input.value = toPos(Math.min(Math.max(value, list ? list[0] : min), list ? list[list.length - 1] : max));
  let cur = fromPos(+input.value);
  const show = () => { out.textContent = fmt(cur); input.setAttribute('aria-valuetext', fmt(cur)); };
  input.addEventListener('input', () => { cur = fromPos(+input.value); show(); oninput && oninput(cur); });
  show();
  return { el: h('div', { class: 'w-field' }, h('label', { for: id }, label), input, out), get: () => cur, set(v) { input.value = toPos(v); cur = fromPos(+input.value); show(); }, input };
}
/** Labelled select. options: [[value, label], …]. */
export function select({ label, options, value, onchange }) {
  const id = 'elf' + (++uid);
  const sel = h('select', { id }, options.map(([v, l]) => h('option', { value: String(v), selected: String(v) === String(value) }, l)));
  sel.addEventListener('change', () => onchange && onchange(sel.value));
  return { el: h('div', { class: 'w-field el-selfield' }, h('label', { for: id }, label), sel), get: () => sel.value, set(v) { sel.value = String(v); }, input: sel };
}
export function checkbox({ label, checked, onchange }) {
  const box = h('input', { type: 'checkbox', checked: !!checked });
  box.addEventListener('change', () => onchange && onchange(box.checked));
  return { el: h('label', { class: 'el-check' }, box, ' ', label), get: () => box.checked, set(v) { box.checked = !!v; }, input: box };
}
/** Tab strip. items: [[id, label], …]. Returns { el, set(id) }. */
export function tabs(items, current, onpick, label = 'View') {
  const el = h('div', { class: 'w-tabs', role: 'group', 'aria-label': label });
  const btns = items.map(([id, lab]) => h('button', { type: 'button', class: 'w-tab', 'aria-pressed': 'false', onclick: () => { set(id); onpick(id); } }, lab));
  function set(id) { items.forEach(([i], k) => { btns[k].classList.toggle('on', i === id); btns[k].setAttribute('aria-pressed', i === id ? 'true' : 'false'); }); }
  el.append(...btns); set(current);
  return { el, set };
}
/** .w-readout grid; call set([[key, value, cls?], …]) to refresh. */
export function readout() {
  const el = h('div', { class: 'w-readout el-ro' });
  return { el, set(pairs) { clear(el); for (const [k, v, cls] of pairs) el.append(h('div', {}, h('div', { class: 'k' }, k), h('div', { class: 'v ' + (cls || '') }, v))); } };
}
/** Equation block: each line is a string; the block is announced politely to screen readers. */
export function equation() {
  const el = h('div', { class: 'el-eq', 'aria-live': 'off' });
  return { el, set(lines) { clear(el); for (const l of lines) el.append(h('div', {}, l)); } };
}
/** Message area: set([['warn'|'bad'|'ok'|'', text], …]). */
export function messages() {
  const el = h('div', { class: 'el-msgs', role: 'status' });
  return { el, set(list) { clear(el); for (const [kind, text] of list) el.append(h('div', { class: 'w-msg ' + (kind || '') }, text)); } };
}
/** Task box with title and body paragraphs. */
export const task = (title, ...paras) => h('div', { class: 'w-task' }, h('p', {}, h('strong', {}, 'Task: ' + title)), paras.map((p) => h('p', {}, p)));
export const note = (text) => h('p', { class: 'w-note' }, h('strong', {}, 'Model: '), text);
/** Standard "Check" row for challenges. */
export function checker(label, oncheck) {
  const btn = h('button', { type: 'button', class: 'btn small', onclick: oncheck }, label);
  return h('div', { class: 'row' }, btn);
}
