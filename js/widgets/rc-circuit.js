// RC step response (charge / discharge to a threshold) and an RC + Schmitt-trigger switch debouncer.
import { h, s, clear, fmtSI } from '../core/dom.js';
import { rcTau, rcVoltage, rcTimeTo, rcCutoff, bounceEdges, simulateDebounce, fmtR, eSeriesValues } from '../sim/electronics.js';
import { svg, g, wire, resistor, capacitor, rail, gnd, dot, sw, txt, scale, axes, polyline, slider, tabs, readout, equation, messages, note } from '../sim/electronics-draw.js';

const VCC = 3.3, RP = 10e3, VT_LOW = 0.3 * VCC, VT_HIGH = 0.7 * VCC, WINDOW = 0.08, PIN_LIMIT = 8e-3;
const fT = (t) => (isFinite(t) ? fmtSI(t, 's') : 'never');

/** Verdict on a debounce run for one press and one release (two clean edges expected). */
export function debounceVerdict(sim) {
  if (sim.outEdges === 0) return { level: 'bad', text: 'The capacitor never fell below the low threshold while the button was held, so the firmware never sees the press. The time constant is far too long for a 40 ms press.' };
  if (sim.outEdges > 2) return { level: 'bad', text: `The filtered signal still crosses the thresholds ${sim.outEdges} times for one press and release. An edge-triggered interrupt would count ${Math.ceil(sim.outEdges / 2)} presses. Increase R × C until it outlasts the bounce.` };
  if (sim.outEdges === 1) return { level: 'warn', text: 'One clean falling edge, but the output has not returned high by the end of the 80 ms window: the release is very slow. A fast double-press would be merged into one.' };
  const delay = sim.firstOutFall - 0.005;
  if (delay > 0.02) return { level: 'warn', text: `Clean, but the press is reported ${fT(delay)} late. People notice lag above a few tens of milliseconds; you have more filtering than the bounce needs.` };
  return { level: 'ok', text: `One press, one clean pair of edges, reported ${fT(delay)} after contact. ` };
}

export default function mount(el, props = {}) {
  const num = (x, d) => (x == null || isNaN(+x) ? d : +x);
  const st = { mode: props.mode === 'debounce' ? 'debounce' : 'charge', r: num(props.r, 10e3), c: num(props.c, 100e-9), dir: 'charge', thPct: 70, bounce: 4, seed: 7 };
  const cList = eSeriesValues('E12', -9, -3);
  const sR = slider({ label: 'R', list: eSeriesValues('E12', 2, 6), value: st.r, fmt: fmtR, oninput: (v) => { st.r = v; render(); } });
  const sC = slider({ label: 'C', list: cList, value: st.c, fmt: (v) => fmtSI(v, 'F'), oninput: (v) => { st.c = v; render(); } });
  const sTh = slider({ label: 'Threshold', min: 5, max: 95, step: 1, value: st.thPct, fmt: (v) => `${v} % = ${(VCC * v / 100).toFixed(2)} V`, oninput: (v) => { st.thPct = v; render(); } });
  const sB = slider({ label: 'Bounce time', min: 0, max: 10, step: 0.5, value: st.bounce, fmt: (v) => v.toFixed(1) + ' ms', oninput: (v) => { st.bounce = v; render(); } });
  st.r = sR.get(); st.c = sC.get();
  const dirTabs = tabs([['charge', 'Charge from 0 V'], ['discharge', 'Discharge from 3.3 V']], st.dir, (d) => { st.dir = d; render(); }, 'Direction');
  const again = h('button', { type: 'button', class: 'btn small ghost', onclick: () => { st.seed = st.seed * 31 % 9973 + 1; render(); } }, 'Press again (new bounce pattern)');
  const modeTabs = tabs([['charge', 'Step response'], ['debounce', 'Switch debounce']], st.mode, (m) => { st.mode = m; render(); }, 'Mode');
  const fig = h('div'), ro = readout(), eq = equation(), msg = messages(), noteEl = h('div');
  clear(el).append(modeTabs.el, h('div', { class: 'w-grid rc-circuit' },
    h('div', { class: 'el-col' }, fig, eq.el),
    h('div', { class: 'el-col' }, dirTabs.el, h('div', { class: 'w-controls' }, sR.el, sC.el, sTh.el, sB.el), again, ro.el, msg.el)), noteEl);

  function render() {
    const deb = st.mode === 'debounce';
    dirTabs.el.hidden = deb; sTh.el.hidden = deb; sB.el.hidden = !deb; again.hidden = !deb;
    clear(noteEl).append(deb
      ? note('one press at 5 ms and release at 45 ms with randomly generated contact bounce; pull-up fixed at 10 kΩ; Schmitt-trigger thresholds at 0.3 × and 0.7 × VDD (typical; check your chip\'s datasheet, and whether its inputs have hysteresis at all). Real switches bounce differently every time and can bounce for longer when worn.')
      : note('ideal source that steps instantly, ideal capacitor (no leakage, no series resistance), nothing connected to the capacitor node. Real capacitors are often ±10 % or ±20 %, so real time constants vary by that much.'));
    deb ? debounce() : charge();
  }

  function charge() {
    const tau = rcTau(st.r, st.c), up = st.dir === 'charge', v0 = up ? 0 : VCC, vf = up ? VCC : 0, vth = VCC * st.thPct / 100;
    const tTh = rcTimeTo(v0, vf, vth, tau), tEnd = 5 * tau;
    const sc = scale({ x: 44, y: 150, w: 280, h: 120 }, 0, tEnd, 0, VCC * 1.08);
    const pts = []; for (let k = 0; k <= 120; k++) { const t = tEnd * k / 120; pts.push([sc.x(t), sc.y(rcVoltage(v0, vf, t, tau))]); }
    const vTau = rcVoltage(v0, vf, tau, tau);
    clear(fig).append(svg(340, 302, `RC ${up ? 'charging' : 'discharging'} curve, time constant ${fT(tau)}, reaches the threshold after ${fT(tTh)}.`,
      up ? g({}, rail(40, 46, '3.3 V'), wire([40, 46], [40, 60], [60, 60]), sw(60, 60, 'h', true), txt(80, 80, 'closes at t = 0', { anchor: 'middle', cls: 'sub' }))
        : g({}, wire([40, 100], [40, 60], [60, 60]), gnd(40, 100), sw(60, 60, 'h', true), txt(80, 46, 'closes at t = 0', { anchor: 'middle', cls: 'sub' }), txt(300, 100, 'C starts at 3.3 V', { anchor: 'end', cls: 'sub' })),
      wire([100, 60], [130, 60]), resistor(130, 60, 'h', 'R ' + fmtR(st.r)), wire([190, 60], [250, 60]), dot(230, 60), wire([230, 60], [230, 66]), capacitor(230, 66, 'v', 'C ' + fmtSI(st.c, 'F')), gnd(230, 106),
      txt(256, 56, 'Vc', { cls: 'sig' }),
      axes(sc, { ylabel: 'Vc (V)', xlabel: 'time', xticks: [1, 2, 3, 4, 5].map((n) => [n * tau, n + 'τ']), yticks: [[0, '0'], [VCC, '3.3'], [vTau, up ? '63 %' : '37 %']] }),
      s('path', { d: `M${sc.x(0)} ${sc.y(vth)}H${sc.x(tEnd)}`, class: 'el-trace t2 thin dashed' }), txt(sc.x(tEnd) - 2, sc.y(vth) - 4, 'threshold', { anchor: 'end', cls: 'sub' }),
      polyline(pts, 't1'),
      s('circle', { cx: sc.x(tau), cy: sc.y(vTau), r: 3.5, class: 'marker' }),
      isFinite(tTh) && tTh <= tEnd ? g({}, s('path', { d: `M${sc.x(tTh)} ${sc.y(vth)}V${sc.y(0)}`, class: 'el-trace t2 thin' }), s('circle', { cx: sc.x(tTh), cy: sc.y(vth), r: 3.5, class: 'f2' })) : null));
    ro.set([['Time constant τ', fT(tau)], ['Reaches threshold', fT(tTh)], ['Settled (5τ, 99.3 %)', fT(5 * tau)], ['Low-pass cutoff', fmtSI(rcCutoff(st.r, st.c), 'Hz')]]);
    eq.set([`τ = R × C = ${fmtR(st.r)} × ${fmtSI(st.c, 'F')} = ${fT(tau)}`,
      up ? `Vc(t) = Vs × (1 − e^(−t/τ))` : `Vc(t) = Vs × e^(−t/τ)`,
      up ? `t = −τ × ln(1 − Vth/Vs) = −${fT(tau)} × ln(1 − ${vth.toFixed(2)}/3.3) = ${fT(tTh)}`
        : `t = −τ × ln(Vth/Vs) = −${fT(tau)} × ln(${vth.toFixed(2)}/3.3) = ${fT(tTh)}`]);
    const m = [];
    if (VCC / st.r > PIN_LIMIT) m.push(['warn', `If a GPIO pin is the source, the first instant draws 3.3 V / ${fmtR(st.r)} = ${fmtSI(VCC / st.r, 'A')}, because an empty capacitor looks like a short. That is above a typical pin's ${fmtSI(PIN_LIMIT, 'A')} drive (typical; check your chip's datasheet).`]);
    m.push(['', `A reset pin or a digital input wired to this node changes state ${fT(tTh)} after the step, not immediately. That delay is the whole point of power-on-reset RC circuits, and the reason slow edges need a Schmitt-trigger input.`]);
    msg.set(m);
  }

  function debounce() {
    const edges = bounceEdges({ bounceMs: st.bounce, seed: st.seed });
    const sim = simulateDebounce({ r: st.r, c: st.c, rp: RP, vcc: VCC, vtLow: VT_LOW, vtHigh: VT_HIGH, edges, duration: WINDOW });
    const X = { x: 44, w: 282 }, n = sim.raw.length, tx = (k) => X.x + k / (n - 1) * X.w;
    const row = (y, hgt) => scale({ x: X.x, y, w: X.w, h: hgt }, 0, WINDOW, 0, 1);
    const digital = (arr, sc0) => { const p = []; let prev = arr[0]; p.push([tx(0), sc0.y(prev * 0.8 + 0.1)]); for (let k = 1; k < n; k++) { if (arr[k] !== prev) { p.push([tx(k), sc0.y(prev * 0.8 + 0.1)], [tx(k), sc0.y(arr[k] * 0.8 + 0.1)]); prev = arr[k]; } } p.push([tx(n - 1), sc0.y(prev * 0.8 + 0.1)]); return p; };
    const r1 = row(178, 44), r2 = scale({ x: X.x, y: 244, w: X.w, h: 84 }, 0, WINDOW, 0, VCC * 1.05), r3 = row(350, 44);
    const ticks = [0, 20, 40, 60, 80].map((ms) => [ms / 1000, ms + ' ms']);
    const vcPts = []; for (let k = 0; k < n; k += 2) vcPts.push([tx(k), r2.y(sim.vc[k])]);
    clear(fig).append(svg(340, 420, `Debounce traces: raw switch signal has ${sim.rawEdges} edges, the filtered output has ${sim.outEdges}.`,
      rail(40, 30, '3.3 V'), resistor(40, 30, 'v', 'Rp', '10 kΩ'), wire([40, 90], [40, 96]), dot(40, 93), sw(40, 96, 'v', false), gnd(40, 136), txt(52, 122, 'button', { cls: 'sub' }),
      wire([40, 93], [96, 93]), resistor(96, 93, 'h', 'R ' + fmtR(st.r)), wire([156, 93], [236, 93]), dot(190, 93), wire([190, 93], [190, 96]), capacitor(190, 96, 'v', 'C', fmtSI(st.c, 'F')), gnd(190, 136),
      g({ class: 'el-part' }, s('path', { d: 'M236 75V111L270 93Z', class: 'el-body' }), s('path', { d: 'M243 97h5v-8h5M248 97h5v-8h5' }), s('path', { d: 'M270 93H300' })), txt(303, 97, 'GPIO', { cls: 'sub' }), txt(262, 68, 'Schmitt input', { anchor: 'middle', cls: 'sub' }),
      txt(62, 107, 'raw', { cls: 'sig' }), txt(208, 86, 'Vc', { cls: 'sig' }),
      axes(r1, { ylabel: `raw switch node — ${sim.rawEdges} edges` }), polyline(digital(sim.raw, r1), 't2 thin'),
      axes(r2, { ylabel: 'Vc after the RC filter', yticks: [[0, '0'], [VCC, '3.3']] }),
      s('rect', { x: X.x, y: r2.y(VT_HIGH), width: X.w, height: r2.y(VT_LOW) - r2.y(VT_HIGH), class: 'band-warn' }),
      txt(X.x + X.w - 3, r2.y(VT_HIGH) + 11, 'hysteresis band', { anchor: 'end', cls: 'sub' }), polyline(vcPts, 't1'),
      axes(r3, { ylabel: `what the firmware reads — ${sim.outEdges} edges`, xticks: ticks }), polyline(digital(sim.out, r3), 't3')));
    const tauD = st.r * st.c, tauC = (RP + st.r) * st.c;
    ro.set([['τ pressed (R·C)', fT(tauD)], ['τ released ((Rp+R)·C)', fT(tauC)], ['Raw edges', String(sim.rawEdges), sim.rawEdges > 2 ? 'el-hot' : ''], ['Edges after filter', String(sim.outEdges), sim.outEdges > 2 ? 'el-hot' : 'el-good']]);
    eq.set([`pressed:  τ = R × C = ${fmtR(st.r)} × ${fmtSI(st.c, 'F')} = ${fT(tauD)}`,
      `released: τ = (Rp + R) × C = ${fmtR(RP + st.r)} × ${fmtSI(st.c, 'F')} = ${fT(tauC)}`,
      `falls to 0.3 × VDD after  −τ × ln(0.3) = ${fT(-tauD * Math.log(0.3))} of continuous contact`]);
    const v = debounceVerdict(sim), m = [[v.level, v.text + (v.level === 'ok' ? 'The capacitor cannot move far during any single bounce, and the hysteresis band absorbs what is left.' : '')]];
    if (st.bounce === 0) m.push(['', 'With no bounce there is nothing to filter. Real mechanical switches almost always bounce for somewhere between a fraction of a millisecond and several milliseconds.']);
    m.push(['', 'The same job can be done in firmware: sample the pin every few milliseconds and accept a new state only after it has been stable for several samples.']);
    msg.set(m);
  }
  render();
}
