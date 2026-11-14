// Ohm's law explorer: pick which quantity to find, set the other two, see the loop and the resistor's power budget.
import { h, clear, fmtSI } from '../core/dom.js';
import { ohm, fmtR, eSeriesValues } from '../sim/electronics.js';
import { svg, wire, resistor, battery, txt, arrow, flow, slider, select, tabs, readout, equation, messages, note } from '../sim/electronics-draw.js';

export const RATINGS = [[0.0625, '1/16 W (0402 SMD)'], [0.125, '1/8 W (0805 SMD)'], [0.25, '1/4 W (common through-hole)'], [0.5, '1/2 W'], [1, '1 W'], [5, '5 W (wire-wound)']];

/** Classify dissipation against a rating. Resistors are normally run at half their rating or less. */
export function powerVerdict(p, rating) {
  const frac = p / rating;
  return { frac, level: frac > 1 ? 'bad' : frac > 0.5 ? 'warn' : 'ok' };
}

export default function mount(el, props = {}) {
  const st = { find: 'i', v: clampNum(props.v, 0, 24, 5), r: clampNum(props.r, 1, 1e6, 220), i: 0.02, rating: 0.25 };
  st.i = Math.min(2, Math.max(1e-4, st.v / st.r)) || 0.02;
  const rList = eSeriesValues('E12', 0, 6);
  const sV = slider({ label: 'Voltage V', min: 0, max: 24, step: 0.1, value: st.v, fmt: (v) => v.toFixed(1) + ' V', oninput: (v) => { st.v = v; render(); } });
  const sR = slider({ label: 'Resistance R', list: rList, value: st.r, fmt: fmtR, oninput: (v) => { st.r = v; render(); } });
  const sI = slider({ label: 'Current I', min: 1e-4, max: 2, log: true, value: st.i, fmt: (v) => fmtSI(v, 'A'), oninput: (v) => { st.i = v; render(); } });
  const sRating = select({ label: 'Resistor rating', options: RATINGS, value: st.rating, onchange: (v) => { st.rating = +v; render(); } });
  const tb = tabs([['i', 'Find current'], ['v', 'Find voltage'], ['r', 'Find resistance']], st.find, (id) => { st.find = id; render(); }, 'Unknown quantity');
  const fig = h('div'), ro = readout(), eq = equation(), msg = messages();
  const bar = h('div', { class: 'ohms-law-bar' }, h('i')), barLab = h('div', { class: 'ohms-law-barlab' });

  clear(el).append(tb.el, h('div', { class: 'w-grid ohms-law' },
    h('div', { class: 'el-col' }, fig, eq.el),
    h('div', { class: 'el-col' }, h('div', { class: 'w-controls' }, sV.el, sR.el, sI.el, sRating.el), ro.el,
      h('div', {}, barLab, bar), msg.el)),
  note('ideal voltage source and an ideal resistor whose value does not change with temperature. A real supply sags and limits its current, and a hot resistor drifts. Ratings assume free air at room temperature.'));

  function render() {
    sV.el.hidden = st.find === 'v'; sR.el.hidden = st.find === 'r'; sI.el.hidden = st.find === 'i';
    const q = st.find === 'i' ? ohm({ v: st.v, r: st.r }) : st.find === 'v' ? ohm({ i: st.i, r: st.r }) : ohm({ v: st.v, i: st.i });
    const { v, i, r, p } = q, pv = powerVerdict(p, st.rating);
    const hot = pv.level === 'bad';
    const loop = 'M70 70V40H250V70M250 130V170H70V110';
    clear(fig).append(svg(340, 210, `Circuit: a ${v.toFixed(1)} volt source across a ${fmtR(r)} resistor, ${fmtSI(i, 'A')} flowing.`,
      wire([70, 70], [70, 40], [250, 40], [250, 70]), wire([250, 130], [250, 170], [70, 170], [70, 110]),
      flow(loop, i),
      battery(70, 70, fmtSI(v, 'V'), 'source'),
      resistor(250, 70, 'v', fmtR(r), fmtSI(p, 'W'), hot ? 'hot' : ''),
      arrow(135, 28, 185, 28), txt(160, 20, 'I = ' + fmtSI(i, 'A'), { anchor: 'middle', cls: 'sig' }),
      txt(160, 188, 'conventional current: + to −, outside the source', { anchor: 'middle', cls: 'sub' }),
      hot ? txt(262, 148, 'overheating', { cls: 'hot' }) : null));
    ro.set([['Voltage', fmtSI(v, 'V')], ['Current', fmtSI(i, 'A')], ['Resistance', fmtR(r)], ['Power', fmtSI(p, 'W'), hot ? 'el-hot' : '']]);
    const lines = st.find === 'i' ? [`I = V / R = ${fmtSI(v, 'V')} / ${fmtR(r)} = ${fmtSI(i, 'A')}`]
      : st.find === 'v' ? [`V = I × R = ${fmtSI(i, 'A')} × ${fmtR(r)} = ${fmtSI(v, 'V')}`]
        : [`R = V / I = ${fmtSI(v, 'V')} / ${fmtSI(i, 'A')} = ${fmtR(r)}`];
    lines.push(`P = V × I = ${fmtSI(v, 'V')} × ${fmtSI(i, 'A')} = ${fmtSI(p, 'W')}   (also I²R and V²/R)`);
    eq.set(lines);
    bar.className = 'ohms-law-bar ' + pv.level; bar.firstChild.style.width = Math.min(100, pv.frac * 100) + '%';
    clear(barLab).append(h('span', {}, 'Power vs rating'), h('span', {}, isFinite(pv.frac) ? (pv.frac * 100).toPrecision(3) + ' % of ' + fmtSI(st.rating, 'W') : 'no limit'));
    const m = [];
    if (pv.level === 'bad') m.push(['bad', `${fmtSI(p, 'W')} in a ${fmtSI(st.rating, 'W')} resistor: on a real board it would scorch, drift in value and eventually fail open or burn. Raise R, lower V, or use a part rated for at least ${fmtSI(p * 2, 'W')}.`]);
    else if (pv.level === 'warn') m.push(['warn', `Above half the rating. It survives on paper, but it runs hot; designers usually keep resistors at or below 50 % of their rating.`]);
    if (i > 0.5) m.push(['warn', `${fmtSI(i, 'A')} is more than a USB 2.0 port (500 mA) or a small regulator is built to supply. A real source would sag or shut down instead of holding ${fmtSI(v, 'V')}.`]);
    if (st.find === 'r' && v === 0) m.push(['', 'With 0 V across it, any resistance satisfies the equation. Raise V to get a meaningful answer.']);
    if (!m.length) m.push(['ok', 'Within the resistor rating.']);
    msg.set(m);
  }
  render();
}
function clampNum(x, lo, hi, dflt) { const n = Number(x); return x == null || isNaN(n) ? dflt : Math.min(hi, Math.max(lo, n)); }
