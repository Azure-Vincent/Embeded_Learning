// PWM explorer: waveform, average voltage, and the resolution-versus-frequency trade-off of a counter-based timer.
import { h, s, clear, fmtSI } from '../core/dom.js';
import { pwmMaxBits, pwmMaxFreq, pwmQuantise, pwmAverage } from '../sim/electronics.js';
import { svg, txt, scale, axes, polyline, slider, select, tabs, readout, equation, messages, note } from '../sim/electronics-draw.js';

const VHIGH = 3.3, F_MIN = 1, F_MAX = 1e6, BITS_MAX = 20;
export const CLOCKS = [[32768, '32.768 kHz (watch crystal)'], [1e6, '1 MHz'], [8e6, '8 MHz'], [48e6, '48 MHz'], [80e6, '80 MHz']];

/** Everything the display needs for one setting. */
export function pwmPlan({ fclk, freq, bits, duty }) {
  const maxBits = pwmMaxBits(fclk, freq), ok = bits <= maxBits && maxBits >= 1, effBits = Math.max(0, Math.min(bits, maxBits));
  const q = pwmQuantise(duty, Math.max(effBits, 0));
  return { maxBits, ok, effBits, ...q, divider: fclk / (freq * 2 ** bits), vavg: pwmAverage(VHIGH, q.duty), period: 1 / freq, tick: 1 / fclk, fMaxAtBits: pwmMaxFreq(fclk, bits) };
}
/** What the chosen frequency does to a load. Returns [level, text] pairs. */
export function loadEffects(load, freq) {
  const out = [];
  if (load === 'led') {
    if (freq < 60) out.push(['bad', `At ${fmtSI(freq, 'Hz')} the LED visibly flickers: you see the individual on and off periods instead of a brightness.`]);
    else if (freq < 200) out.push(['warn', `${fmtSI(freq, 'Hz')} looks steady when you stare at it, but flickers when the LED or your eyes move, and shows as bands on phone cameras. A few hundred hertz to a few kilohertz is the usual choice.`]);
    else out.push(['ok', 'Fast enough that the eye averages it into a steady brightness.']);
  } else {
    if (freq < 50) out.push(['bad', `At ${fmtSI(freq, 'Hz')} the motor gets separate kicks: it judders instead of running smoothly, because its inertia cannot average pulses this slow.`]);
    else if (freq <= 20e3) out.push(['warn', `${fmtSI(freq, 'Hz')} is in the audible range: the windings vibrate at the PWM frequency and the motor whines. Many designs run just above 20 kHz for that reason.`]);
    else if (freq > 100e3) out.push(['warn', `Above about 100 kHz the switching transistor spends a growing share of each period part-way between on and off, where it dissipates the most. Efficiency drops and it heats.`]);
    else out.push(['ok', 'Above hearing and slow enough for the transistor to switch cleanly.']);
  }
  return out;
}

export default function mount(el, props = {}) {
  const num = (x, d, lo, hi) => (x == null || isNaN(+x) ? d : Math.min(hi, Math.max(lo, +x)));
  const st = { fclk: 80e6, freq: num(props.freq, 5000, F_MIN, F_MAX), bits: Math.round(num(props.bits, 10, 1, BITS_MAX)), duty: num(props.duty, 0.25, 0, 100), load: 'led' };
  if (st.duty > 1) st.duty /= 100;   // accept 25 as well as 0.25
  const sClk = select({ label: 'Timer clock', options: CLOCKS, value: st.fclk, onchange: (v) => { st.fclk = +v; render(); } });
  const sF = slider({ label: 'PWM frequency', min: F_MIN, max: F_MAX, log: true, value: st.freq, fmt: (v) => fmtSI(v, 'Hz'), oninput: (v) => { st.freq = v; render(); } });
  const sB = slider({ label: 'Resolution', min: 1, max: BITS_MAX, step: 1, value: st.bits, fmt: (v) => v + ' bits', oninput: (v) => { st.bits = v; render(); } });
  const sD = slider({ label: 'Duty requested', min: 0, max: 100, step: 0.1, value: st.duty * 100, fmt: (v) => v.toFixed(1) + ' %', oninput: (v) => { st.duty = v / 100; render(); } });
  st.freq = sF.get();
  const loadTabs = tabs([['led', 'Driving an LED'], ['motor', 'Driving a motor']], st.load, (v) => { st.load = v; render(); }, 'Load');
  const fig = h('div'), fig2 = h('div'), ro = readout(), eq = equation(), msg = messages(), lamp = h('div', { class: 'pwm-lab-led' });
  clear(el).append(h('div', { class: 'w-grid pwm-lab' },
    h('div', { class: 'el-col' }, fig, fig2, eq.el),
    h('div', { class: 'el-col' }, h('div', { class: 'w-controls' }, sClk.el, sF.el, sB.el, sD.el), loadTabs.el, lamp, ro.el, msg.el)),
  note('an up-counting timer whose period is exactly 2^bits clock ticks after an integer or fractional divider (the scheme used by LEDC-style PWM peripherals). Edges are instant and the load is not modelled electrically; LED brightness is shown proportional to duty, although the eye responds roughly logarithmically. Timers that count to an arbitrary reload value can trade resolution in finer steps than whole bits. Maximum counter width differs per chip: check the datasheet.'));

  function render() {
    const p = pwmPlan(st), W = 340;
    // waveform: three periods
    const sc = scale({ x: 40, y: 26, w: 286, h: 96 }, 0, 3, -0.15 * VHIGH, VHIGH * 1.2), pts = [[sc.x(0), sc.y(0)]];
    for (let k = 0; k < 3; k++) {
      if (p.duty > 0) pts.push([sc.x(k), sc.y(VHIGH)], [sc.x(k + p.duty), sc.y(VHIGH)]);
      if (p.duty < 1) pts.push([sc.x(k + p.duty), sc.y(0)], [sc.x(k + 1), sc.y(0)]);
    }
    clear(fig).append(svg(W, 150, `PWM waveform at ${fmtSI(st.freq, 'Hz')}, ${(p.duty * 100).toFixed(1)} percent duty, average ${p.vavg.toFixed(2)} volts.`,
      axes(sc, { ylabel: `pin voltage — period ${fmtSI(p.period, 's')}, high for ${fmtSI(p.period * p.duty, 's')}`, yticks: [[0, '0'], [VHIGH, '3.3']], xticks: [[1, '1 T'], [2, '2 T'], [3, '3 T']] }),
      p.duty > 0 ? [0, 1, 2].map((k) => s('rect', { x: sc.x(k), y: sc.y(VHIGH), width: sc.x(k + p.duty) - sc.x(k), height: sc.y(0) - sc.y(VHIGH), class: 'band-fill' })) : null,
      polyline(pts, 't1'),
      s('path', { d: `M${sc.x(0)} ${sc.y(p.vavg)}H${sc.x(3)}`, class: 'el-trace t2 thin dashed' }), txt(sc.x(3) - 3, sc.y(p.vavg) - 4, 'average ' + p.vavg.toFixed(2) + ' V', { anchor: 'end', cls: 'sub' })));
    // trade-off chart: max bits against frequency
    const lx = (f) => Math.log10(f), sc2 = scale({ x: 40, y: 22, w: 286, h: 120 }, lx(F_MIN), lx(F_MAX), 0, 24);
    const line = [], N = 240;
    for (let k = 0; k <= N; k++) { const f = 10 ** (lx(F_MIN) + (lx(F_MAX) - lx(F_MIN)) * k / N), b = Math.min(24, pwmMaxBits(st.fclk, f)); if (k) line.push([sc2.x(lx(f)), line[line.length - 1][1]]); line.push([sc2.x(lx(f)), sc2.y(b)]); }
    const area = 'M' + line.map((q) => q.join(' ')).join('L') + `L${sc2.x(lx(F_MAX))} ${sc2.y(24)}L${sc2.x(lx(F_MIN))} ${sc2.y(24)}Z`;
    clear(fig2).append(svg(W, 176, `Chart of maximum duty resolution against PWM frequency for a ${fmtSI(st.fclk, 'Hz')} clock. Current setting is ${p.ok ? 'achievable' : 'not achievable'}.`,
      axes(sc2, { ylabel: 'max resolution (bits) vs PWM frequency', xticks: [[0, '1 Hz'], [2, '100 Hz'], [4, '10 kHz'], [6, '1 MHz']], yticks: [[0, '0'], [8, '8'], [16, '16'], [24, '24']] }),
      s('path', { d: area, class: 'band-bad' }), polyline(line, 't6'),
      txt(sc2.x(5.9), sc2.y(21), 'not achievable', { anchor: 'end', cls: 'sub' }),
      s('path', { d: `M${sc2.x(lx(st.freq))} ${sc2.y(0)}V${sc2.y(24)}`, class: 'el-grid' }),
      s('circle', { cx: sc2.x(lx(st.freq)), cy: sc2.y(Math.min(24, st.bits)), r: 5, class: p.ok ? 'f3' : 'f2' }),
      txt(sc2.x(lx(st.freq)) + (st.freq > 300 ? -9 : 9), sc2.y(Math.min(24, st.bits)) + 4, `${st.bits} bits @ ${fmtSI(st.freq, 'Hz')}`, { anchor: st.freq > 300 ? 'end' : 'start', cls: p.ok ? 'good' : 'hot' })));
    clear(lamp).append(st.load === 'led'
      ? h('span', { class: 'cell' }, h('i', { style: { opacity: (0.06 + 0.94 * p.duty).toFixed(2), boxShadow: `0 0 ${Math.round(18 * p.duty)}px var(--sig2)` } }))
      : h('span', { class: 'w-mono' }, 'speed ≈ ' + (p.duty * 100).toFixed(0) + ' %'),
    h('span', {}, st.load === 'led' ? `Apparent brightness follows the average: ${(p.duty * 100).toFixed(1)} % of full.` : `The motor's inductance and inertia average the pulses: it behaves roughly as if fed ${p.vavg.toFixed(2)} V of a ${VHIGH} V supply.`));
    ro.set([['Max resolution here', p.maxBits + ' bits', p.ok ? '' : 'el-hot'], ['Duty steps', p.effBits ? String(p.steps) : '—'], ['Step size', p.effBits ? +p.stepPct.toPrecision(3) + ' %' : '—'], ['Compare value', p.effBits ? `${p.count} / ${p.steps}` : '—'],
      ['Duty you get', (p.duty * 100).toFixed(2) + ' %', Math.abs(p.duty - st.duty) > 0.005 ? 'el-hot' : ''], ['Average voltage', p.vavg.toFixed(3) + ' V']]);
    eq.set([`max bits = floor(log2(f_clk / f_pwm)) = floor(log2(${fmtSI(st.fclk, 'Hz')} / ${fmtSI(st.freq, 'Hz')})) = floor(${Math.log2(st.fclk / st.freq).toFixed(2)}) = ${p.maxBits}`,
      `compare = round(duty × 2^bits) = round(${st.duty.toFixed(3)} × ${p.steps}) = ${p.count}  →  duty = ${p.count}/${p.steps} = ${(p.duty * 100).toFixed(2)} %`,
      `V_avg = duty × V_high = ${p.duty.toFixed(4)} × ${VHIGH} V = ${p.vavg.toFixed(3)} V`]);
    const m = [];
    if (st.freq > st.fclk) m.push(['bad', `The PWM frequency is above the timer clock itself. A counter cannot produce a period shorter than one tick.`]);
    else if (!p.ok) m.push(['bad', `${st.bits} bits at ${fmtSI(st.freq, 'Hz')} needs the counter to take 2^${st.bits} = ${2 ** st.bits} steps every period, a ${fmtSI(st.freq * 2 ** st.bits, 'Hz')} count rate. The clock is only ${fmtSI(st.fclk, 'Hz')}. A real driver either rejects this configuration or runs at a different frequency than you asked for. At this frequency you can have ${p.maxBits} bits; for ${st.bits} bits the frequency must be ${fmtSI(p.fMaxAtBits, 'Hz')} or lower. The figures shown use ${p.effBits} bits.`]);
    else m.push(['ok', `Achievable: the timer divides ${fmtSI(st.fclk, 'Hz')} by ${+p.divider.toPrecision(4)} and counts ${p.steps} steps per period. Each extra bit of resolution halves the highest frequency you can reach.`]);
    if (p.effBits && Math.abs(p.duty - st.duty) > 0.005) m.push(['warn', `You asked for ${(st.duty * 100).toFixed(1)} % but the nearest step is ${(p.duty * 100).toFixed(2)} %. With ${p.effBits} bits the duty moves in ${+p.stepPct.toPrecision(3)} % steps; at the dim end of an LED fade, steps this coarse are visible as jumps.`]);
    m.push(...loadEffects(st.load, st.freq));
    msg.set(m);
  }
  render();
}
