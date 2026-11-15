import { h, s, clear } from '../core/dom.js';
import { sampleWave, measure, toLogicSingle, toLogicSchmitt, transitions, undefinedFraction } from '../sim/signal.js';

// An analog voltage against time, the numbers used to describe it, and what a digital input makes of it.
export const CHALLENGES = { 'clean-edges': { title: 'Get clean edges from a noisy, slow signal' } };

export default function mount(el, props = {}, ctx = {}) {
  const st = { shape: props.shape || (props.challenge ? 'slow' : 'sine'), amp: 1.4, offset: 1.65, freq: 2, noise: props.challenge ? 0.22 : 0, edge: 0.6, schmitt: false, vdd: 3.3 };
  const VIL = 0.3 * st.vdd, VIH = 0.7 * st.vdd;
  const svg = s('svg', { class: 'w-svg', viewBox: '0 0 640 300', role: 'img', 'aria-label': 'Voltage against time, and the logic level an input reads' });
  const read = h('div', { class: 'w-readout' }), msg = h('div', { class: 'w-msg' }), eq = h('p', { class: 'w-note' });
  const field = (label, key, min, max, step, unit) => { const out = h('output'); const inp = h('input', { type: 'range', min, max, step, value: st[key], 'aria-label': label, oninput: () => { st[key] = +inp.value; draw(); } }); out.textContent = st[key] + unit; inp.addEventListener('input', () => (out.textContent = st[key] + unit)); return h('div', { class: 'w-field' }, h('label', {}, label), inp, out); };
  const shape = h('select', { 'aria-label': 'Waveform', onchange: () => { st.shape = shape.value; draw(); } }, [['dc', 'Steady DC'], ['sine', 'Sine (AC riding on DC)'], ['square', 'Square (digital-looking)'], ['slow', 'Square with slow edges']].map(([v, t]) => h('option', { value: v, selected: v === st.shape }, t)));
  const sch = h('input', { type: 'checkbox', checked: st.schmitt, onchange: () => { st.schmitt = sch.checked; draw(); } });

  function draw() {
    const v = sampleWave(st, 400), m = measure(v);
    const X = (i) => 46 + (i / 399) * 584, Y = (volts) => 170 - (volts / 4) * 160;
    clear(svg);
    // undefined band between VIL and VIH
    svg.append(s('rect', { x: 46, y: Y(VIH), width: 584, height: Y(VIL) - Y(VIH), fill: 'var(--warn)', opacity: .14 }),
      s('text', { x: 626, y: Y(VIH) - 4, 'font-size': 11, 'text-anchor': 'end', fill: 'var(--warn)' }, `VIH ${VIH.toFixed(2)} V`),
      s('text', { x: 626, y: Y(VIL) + 13, 'font-size': 11, 'text-anchor': 'end', fill: 'var(--warn)' }, `VIL ${VIL.toFixed(2)} V`));
    for (let g = 0; g <= 4; g++) svg.append(s('line', { x1: 46, x2: 630, y1: Y(g), y2: Y(g), stroke: 'var(--line)', 'stroke-width': g === 0 ? 1.2 : .5 }), s('text', { x: 40, y: Y(g) + 3, 'font-size': 11, 'text-anchor': 'end' }, g + ' V'));
    svg.append(s('line', { x1: 46, x2: 630, y1: Y(m.mean), y2: Y(m.mean), stroke: 'var(--sig4)', 'stroke-dasharray': '5 4' }),
      s('path', { d: v.map((x, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(Math.max(-0.2, Math.min(4.1, x))).toFixed(1)}`).join(''), fill: 'none', stroke: 'var(--sig1)', 'stroke-width': 1.6 }));
    const bits = st.schmitt ? toLogicSchmitt(v, VIL, VIH, v[0] > st.offset ? 1 : 0) : toLogicSingle(v, st.vdd / 2);
    const LY = (b) => (b ? 215 : 265);
    svg.append(s('text', { x: 40, y: 219, 'font-size': 10, 'text-anchor': 'end' }, '1'), s('text', { x: 40, y: 269, 'font-size': 10, 'text-anchor': 'end' }, '0'),
      s('path', { d: bits.map((b, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${LY(i ? bits[i - 1] : b)}L${X(i).toFixed(1)} ${LY(b)}`).join(''), fill: 'none', stroke: 'var(--sig3)', 'stroke-width': 1.6 }),
      s('text', { x: 46, y: 292, 'font-size': 11, fill: 'var(--muted)' }, st.schmitt ? 'what a Schmitt-trigger input reads (two thresholds, holds its state between them)' : 'what a single-threshold input reads (flips at every crossing of VDD/2)'));
    const tr = transitions(bits), und = undefinedFraction(v, VIL, VIH), expected = st.shape === 'dc' ? 0 : Math.round(st.freq * 2) - (st.shape === 'slow' ? 0 : 1);
    clear(read).append(...[['Peak-to-peak', m.pp.toFixed(2) + ' V'], ['Mean (the DC part)', m.mean.toFixed(2) + ' V'], ['RMS of the AC part', m.acRms.toFixed(2) + ' V'], ['Time in the undefined band', Math.round(und * 100) + '%'], ['Logic transitions seen', tr]].map(([k, x]) => h('div', {}, h('div', { class: 'k' }, k), h('div', { class: 'v' }, String(x)))));
    eq.textContent = st.shape === 'sine' ? `For a sine, RMS = amplitude / √2 = ${st.amp} / 1.414 = ${(st.amp / Math.SQRT2).toFixed(2)} V. RMS is the DC voltage that would heat a resistor equally.` : st.shape === 'dc' ? 'A steady DC level has no AC part: peak-to-peak and AC RMS are zero (apart from noise).' : 'A square wave spends all its time at its two levels, so its AC RMS equals its amplitude.';
    msg.className = 'w-msg';
    if (m.max > st.vdd + 0.3 || m.min < -0.3) { msg.className = 'w-msg bad'; msg.textContent = `The signal reaches ${m.max.toFixed(2)} V / ${m.min.toFixed(2)} V, outside the 0 to ${st.vdd} V supply range. A real input pin would be stressed by this; check the absolute maximum ratings before connecting it.`; }
    else if (tr > expected + 1 && expected >= 0 && st.shape !== 'dc') { msg.className = 'w-msg warn'; msg.textContent = `The source changes state ${expected} times in this window, but the input registers ${tr}. While the voltage crawls through the threshold, noise carries it back and forth, and firmware would count extra edges.`; }
    else if (und > 0.25) { msg.className = 'w-msg warn'; msg.textContent = 'Much of the time the voltage is between VIL and VIH, where the datasheet promises nothing. That is an analog signal: read it with an ADC, or condition it before a digital input.'; }
    else msg.textContent = st.shape === 'dc' ? 'A steady level well inside one band reads as a stable 0 or 1.' : 'The input sees a clean digital signal.';
    if (props.challenge === 'clean-edges') {
      const ok = st.shape === 'slow' && st.noise >= 0.2 && st.edge >= 0.5 && tr === expected;
      if (ok) { msg.className = 'w-msg ok'; msg.textContent = `Exactly ${expected} transitions from a slow, noisy signal. Hysteresis did that: once the input has switched, the noise would have to cross the whole gap between the two thresholds to switch it back.`; ctx.complete?.(); }
    }
  }
  if (props.challenge === 'clean-edges') el.append(h('div', { class: 'w-task' }, h('p', {}, 'A sensor drives this pin with slow, noisy edges, and firmware is counting several edges for each real one. Without making the signal faster or cleaner (leave noise at 0.2 V or more and the edge slow), make the input register exactly the true number of transitions.')));
  el.append(
    h('div', { class: 'signal-lab' },
      h('div', { class: 'w-controls' }, h('div', { class: 'w-field' }, h('label', {}, 'Waveform'), shape, h('span')), field('Amplitude', 'amp', 0, 2, 0.1, ' V'), field('DC offset', 'offset', 0, 3.3, 0.05, ' V'), field('Cycles shown', 'freq', 1, 6, 1, ''), field('Noise', 'noise', 0, 0.5, 0.02, ' V'), field('Edge slowness', 'edge', 0.02, 1, 0.02, ''),
        h('label', { class: 'row' }, sch, h('span', {}, 'Schmitt-trigger input (hysteresis)'))),
      h('div', {}, svg, h('p', { class: 'w-note' }, 'Above VIH the input is guaranteed to read 1, below VIL guaranteed 0. In the shaded band between them, nothing is promised.'))),
    read, eq, msg,
    h('p', { class: 'w-note' }, 'Model: thresholds drawn at 0.3 × VDD and 0.7 × VDD for a 3.3 V supply, which are typical CMOS figures; use the VIL and VIH of your own chip. Noise is uniform and the time axis has no units. Real inputs also have capacitance and leakage, which this ignores.'));
  draw();
}
