// Shared digital-waveform renderer for the protocol tools.
//
//   drawWaves(svgEl, channels, opts) -> {x(t), time(px), width, height}
//
//   channels: [{ name, edges:[{t, v}], color?, rise?, spans? }]
//       edges  - edge list as produced by js/sim/signals.js (first entry = initial level)
//       color  - any CSS colour, normally a variable such as 'var(--sig1)' (default cycles --sig1..--sig6)
//       rise   - optional RC time constant in seconds: rising edges are drawn as an exponential (open-drain bus)
//       spans  - optional [{t0, t1, color}] : parts of the trace redrawn in another colour (who drives the line)
//   opts: { t0=0, t1, cursors?:[t | {t, label?, color?}], annotations?:[{ch, t0, t1, text, color?, title?}],
//           markers?:[{ch, t, shape?:'up'|'down'|'dot', color?, title?}],
//           height?=34 (trace height per channel, px), width? (default: the svg's rendered width), labelWidth?=58,
//           axis?=true }
//       `ch` is a channel index or name. Annotations are drawn as labelled boxes in a strip above their channel.
//       The time axis is labelled in engineering units (ns, µs, ms, s).
//
//   waveBox(minWidth) -> {wrap, svg}   a horizontally scrollable holder so long captures stay legible on phones
//   onResize(el, fn)                    re-run fn when el changes width (ResizeObserver; dies with the element)
import { h, s, clear, fmtSI } from '../core/dom.js';
import { sample } from '../sim/signals.js';

const SIG = ['var(--sig1)', 'var(--sig2)', 'var(--sig3)', 'var(--sig4)', 'var(--sig5)', 'var(--sig6)'];

/** Tick spacing: 1, 2 or 5 times a power of ten, giving roughly `target` ticks across `span`. */
export function niceStep(span, target = 6) {
  if (!(span > 0)) return 1;
  const raw = span / Math.max(1, target), p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
  const e = 1 + 1e-9;
  return +((m <= e ? 1 : m <= 2 * e ? 2 : m <= 5 * e ? 5 : 10) * p).toPrecision(12);
}

/** SVG path for one trace between ta and tb. Pure string building, exported for tests. */
export function tracePath(edges, ta, tb, x, yHi, yLo, rise = 0) {
  const yOf = (v) => (v ? yHi : yLo);
  const r = (n) => Math.round(n * 100) / 100;
  let y = yOf(sample(edges, ta));
  let d = `M${r(x(ta))} ${r(y)}`;
  const list = edges.filter((e, i) => i > 0 && e.t > ta && e.t < tb);
  for (let i = 0; i < list.length; i++) {
    const e = list[i], next = i + 1 < list.length ? list[i + 1].t : tb;
    d += `H${r(x(e.t))}`;
    if (e.v && rise > 0) {
      const y0 = y, end = Math.min(next, e.t + 6 * rise), n = 14;
      for (let k = 1; k <= n; k++) {
        const t = e.t + ((end - e.t) * k) / n;
        y = yHi + (y0 - yHi) * Math.exp(-(t - e.t) / rise);
        d += `L${r(x(t))} ${r(y)}`;
      }
    } else { y = yOf(e.v); d += `V${r(y)}`; }
  }
  return d + `H${r(x(tb))}`;
}

export function drawWaves(svg, channels, opts = {}) {
  clear(svg);
  const t0 = opts.t0 ?? 0;
  let t1 = opts.t1;
  if (t1 == null) t1 = Math.max(t0 + 1e-9, ...channels.map((c) => (c.edges.length ? c.edges[c.edges.length - 1].t : 0)));
  if (!(t1 > t0)) t1 = t0 + 1e-9;
  const rect = svg.getBoundingClientRect ? svg.getBoundingClientRect() : { width: 0 };
  const W = Math.max(240, Math.round(opts.width || rect.width || 720));
  const rowH = opts.height ?? 34, lab = opts.labelWidth ?? 58, padR = 10, annH = 17, gap = 8;
  const ann = opts.annotations || [], marks = opts.markers || [];
  const chIndex = (c) => (typeof c === 'number' ? c : channels.findIndex((k) => k.name === c));
  const x = (t) => lab + ((t - t0) / (t1 - t0)) * (W - lab - padR);
  const time = (px) => t0 + ((px - lab) / (W - lab - padR)) * (t1 - t0);
  const cx = (t) => Math.min(W - padR, Math.max(lab, x(t)));

  let y = 6;
  const rows = channels.map((c, i) => {
    const mine = ann.filter((a) => chIndex(a.ch) === i);
    const top = y + (mine.length ? annH + 2 : 0);
    y = top + rowH + gap;
    return { c, i, mine, annY: top - annH - 2, top, yHi: top + 5, yLo: top + rowH - 5, color: c.color || SIG[i % 6] };
  });
  const axis = opts.axis !== false;
  const H = y + (axis ? 20 : 0);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', W); svg.setAttribute('height', H);
  svg.setAttribute('role', 'img');
  if (!svg.getAttribute('aria-label')) svg.setAttribute('aria-label', 'Waveform: ' + channels.map((c) => c.name).join(', '));

  // time grid and axis
  const step = niceStep(t1 - t0, Math.max(2, Math.floor((W - lab) / 90)));
  const g = s('g', { class: 'wave-axis' });
  for (let k = Math.ceil((t0 - 1e-15) / step); k * step <= t1 + step * 1e-6; k++) {
    const t = k * step, px = x(t);
    g.append(s('line', { x1: px, x2: px, y1: 2, y2: y - 2, class: 'wave-grid' }));
    if (axis) g.append(s('text', { x: px, y: H - 5, 'text-anchor': px > W - 40 ? 'end' : 'middle', class: 'wave-tick' }, fmtSI(+t.toPrecision(10), 's')));
  }
  svg.append(g);

  for (const r of rows) {
    svg.append(s('text', { x: 4, y: (r.yHi + r.yLo) / 2 + 4, class: 'wave-name', style: `fill:${r.color}` }, r.c.name));
    const rise = r.c.rise || 0;
    svg.append(s('path', { d: tracePath(r.c.edges, t0, t1, x, r.yHi, r.yLo, rise), class: 'wave-trace', style: `stroke:${r.color}` }));
    for (const sp of r.c.spans || []) {
      const a = Math.max(t0, sp.t0), b = Math.min(t1, sp.t1);
      if (b <= a) continue;
      svg.append(s('path', { d: tracePath(r.c.edges, a, b, x, r.yHi, r.yLo, rise), class: 'wave-trace wave-span', style: `stroke:${sp.color}` }));
    }
    for (const a of r.mine) {
      if (a.t1 <= t0 || a.t0 >= t1) continue;
      const xa = cx(a.t0), xb = cx(a.t1), w = Math.max(1, xb - xa - 1), col = a.color || r.color;
      const box = s('g', { class: 'wave-ann' },
        s('rect', { x: xa + 0.5, y: r.annY, width: w, height: annH, rx: 2, style: `stroke:${col};fill:color-mix(in srgb, ${col} 14%, transparent)` }));
      const text = String(a.text ?? '');
      if (text && w >= text.length * 6.1 + 2) box.append(s('text', { x: xa + w / 2, y: r.annY + 12.5, 'text-anchor': 'middle' }, text));
      box.append(s('title', null, a.title || text));
      svg.append(box);
    }
  }
  for (const m of marks) {
    const r = rows[chIndex(m.ch)];
    if (!r || m.t < t0 || m.t > t1) continue;
    const px = x(m.t), col = m.color || 'var(--ink)';
    let el;
    if (m.shape === 'dot') el = s('circle', { cx: px, cy: sample(r.c.edges, m.t) ? r.yHi : r.yLo, r: 3 });
    else if (m.shape === 'down') el = s('path', { d: `M${px - 4} ${r.yLo + 1}h8l-4 6z` });
    else el = s('path', { d: `M${px - 4} ${r.yLo + 7}h8l-4 -6z` });
    el.setAttribute('class', 'wave-mark'); el.setAttribute('style', `fill:${col}`);
    if (m.title) el.append(s('title', null, m.title));
    svg.append(el);
  }
  for (const c of opts.cursors || []) {
    const cur = typeof c === 'number' ? { t: c } : c;
    if (cur.t < t0 || cur.t > t1) continue;
    const px = x(cur.t);
    svg.append(s('line', { x1: px, x2: px, y1: 0, y2: y, class: 'wave-cursor', style: cur.color ? `stroke:${cur.color}` : null }));
    if (cur.label) svg.append(s('text', { x: px + (px > W - 60 ? -3 : 3), y: 9, 'text-anchor': px > W - 60 ? 'end' : 'start', class: 'wave-tick', style: cur.color ? `fill:${cur.color}` : null }, cur.label));
  }
  return { x, time, width: W, height: H };
}

/** A scrollable holder: the svg is at least minWidth px wide, so long captures scroll instead of shrinking. */
export function waveBox(minWidth = 0, label) {
  const svg = s('svg', { class: 'w-svg wave-svg', 'aria-label': label || null });
  const wrap = h('div', { class: 'wave-scroll', tabindex: minWidth ? '0' : null, role: minWidth ? 'group' : null, 'aria-label': minWidth ? (label || 'Waveform') + ' (scrolls sideways)' : null },
    h('div', { style: { minWidth: minWidth ? minWidth + 'px' : null } }, svg));
  return { wrap, svg };
}

/** Call fn whenever el's width changes (and once it is laid out). No global listeners are left behind. */
export function onResize(el, fn) {
  if (typeof ResizeObserver === 'undefined') { fn(); return; }
  let last = -1;
  new ResizeObserver((entries) => {
    const w = Math.round(entries[0].contentRect.width);
    if (w === last || !w) return;
    last = w; fn();
  }).observe(el);
}
