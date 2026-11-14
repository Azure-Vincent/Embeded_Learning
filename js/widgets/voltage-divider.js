// Voltage divider with optional load and a 12-bit ADC reading; three design challenges.
import { h, s, clear, fmtSI } from '../core/dom.js';
import { divider, adcCode, fmtR, eSeriesValues } from '../sim/electronics.js';
import { svg, wire, resistor, rail, gnd, dot, txt, flow, slider, checkbox, readout, equation, messages, note, task } from '../sim/electronics-draw.js';

const VDD = 3.3, VIH = 0.7 * VDD, ABS_MAX = VDD + 0.3, RATING = 0.25, BITS = 12;

export const CHALLENGES = {
  'level-shift-5v-3v3': {
    title: 'Shift a 5 V logic output down for a 3.3 V input',
    brief: ['A sensor drives its output to 5 V for logic high. Your microcontroller runs at 3.3 V and its inputs are not 5 V tolerant. Choose R1 and R2 so the pin sees a valid, safe high level.',
      'Keep the divider from loading the sensor (no more than 2.5 mA) and keep its source resistance at or below 20 kΩ so edges stay reasonably fast.'],
    vin: 5, r1: 1000, r2: 10000, load: Infinity,
  },
  'adc-battery': {
    title: 'Measure a 9 V battery with a 3.3 V ADC',
    brief: ['A fresh 9 V battery can read 9.6 V. Scale it so the ADC pin never exceeds 3.3 V but still uses most of the ADC range at full charge (at least 2.6 V).',
      'The divider is connected all the time, so it must draw no more than 100 µA from the battery.'],
    vin: 9.6, r1: 10000, r2: 10000, load: Infinity,
  },
  loaded: {
    title: 'Keep 2.5 V under a 4.7 kΩ load',
    brief: ['Someone built a 10 kΩ / 10 kΩ divider to get 2.5 V from 5 V and then connected a circuit that looks like 4.7 kΩ. The output collapsed.',
      'Change R1 and R2 so the loaded output is within 10 % of 2.5 V (2.25 V to 2.75 V) while the divider takes no more than 10 mA from the supply.'],
    vin: 5, r1: 10000, r2: 10000, load: 4700,
  },
};

/** Judge a design. Returns { ok, text } where text says what the attempt would do on real hardware. */
export function checkChallenge(id, { r1, r2 }) {
  const c = CHALLENGES[id];
  if (!c) return { ok: false, text: 'Unknown challenge.' };
  const d = divider(c.vin, r1, r2, c.load), V = (v) => v.toFixed(2) + ' V';
  if (id === 'level-shift-5v-3v3') {
    if (d.vout > ABS_MAX) return { ok: false, text: `The pin would sit at ${V(d.vout)}, beyond the typical absolute maximum of VDD + 0.3 V. Current flows through the pin's protection diode into the 3.3 V rail; that can latch up or slowly destroy the pin.` };
    if (d.vout > VDD) return { ok: false, text: `${V(d.vout)} is ${Math.round((d.vout - VDD) * 1000)} mV above the 3.3 V rail. It is inside the typical VDD + 0.3 V limit, but with 5 % resistors and a sensor supply at 5.25 V it gets worse. Choose a ratio that lands at or just below 3.3 V.` };
    if (d.vout < VIH) return { ok: false, text: `${V(d.vout)} is below the typical input-high threshold of 0.7 × VDD = ${V(VIH)}. The MCU may read the sensor's high as low, or flip with noise.` };
    if (d.vout < 2.6) return { ok: false, text: `${V(d.vout)} is above the ${V(VIH)} threshold, but only by ${Math.round((d.vout - VIH) * 1000)} mV. Noise or a slightly low sensor supply would make it unreliable. Aim for 2.6 V to 3.3 V.` };
    if (d.iIn > 2.5e-3) return { ok: false, text: `The level is right (${V(d.vout)}) but the divider draws ${fmtSI(d.iIn, 'A')} from the sensor output whenever it is high. Many sensor outputs cannot hold 5 V at that current. Scale both resistors up, keeping the ratio.` };
    if (d.rth > 20e3) return { ok: false, text: `The level is right (${V(d.vout)}) but the pin sees a ${fmtR(d.rth)} source. With roughly 10 pF of pin and trace capacitance the edges slow down and the node picks up noise easily. Scale both resistors down, keeping the ratio.` };
    return { ok: true, text: `${V(d.vout)} at the pin: above the ${V(VIH)} high threshold and not above the rail, drawing ${fmtSI(d.iIn, 'A')}. A low from the sensor (0 V) still divides to 0 V. This trick only works in one direction (5 V → 3.3 V), and it is too slow for fast buses; those need a level-shifter IC.` };
  }
  if (id === 'adc-battery') {
    if (d.vout > ABS_MAX) return { ok: false, text: `With a fresh battery the ADC pin would see ${V(d.vout)}: above the typical absolute maximum (VDD + 0.3 V). The reading saturates at 4095 and the pin can be damaged.` };
    if (d.vout > VDD) return { ok: false, text: `At 9.6 V the pin sees ${V(d.vout)}, above the 3.3 V reference. The reading clips at 4095, so the top of the battery range is invisible.` };
    if (d.vout < 2.6) return { ok: false, text: `Safe, but a full battery reads only ${V(d.vout)} (code ${adcCode(d.vout, VDD, BITS)} of 4095). You are throwing away ${Math.round((1 - d.vout / VDD) * 100)} % of the ADC range, so each count is a bigger step in battery voltage than it needs to be.` };
    if (d.iIn > 100e-6) return { ok: false, text: `The ratio is right (${V(d.vout)}), but the divider draws ${fmtSI(d.iIn, 'A')} for as long as the battery is connected. That is more than the 100 µA budget; over weeks it flattens the battery by itself. Scale both resistors up.` };
    return { ok: true, text: `${V(d.vout)} at full charge (code ${adcCode(d.vout, VDD, BITS)}), ${fmtSI(d.iIn, 'A')} drain. In firmware: Vbat = code × 3.3 / 4096 × (R1 + R2) / R2. The price of the low drain is a ${fmtR(d.rth)} source resistance, which is high for most ADC inputs: put about 100 nF from the tap to ground so the sampling capacitor has a reservoir to charge from (check your chip's datasheet for its recommended source impedance).` };
  }
  // loaded
  if (d.iIn > 10e-3) return { ok: false, text: `The output is ${V(d.vout)}, but the divider now burns ${fmtSI(d.iIn, 'A')} (${fmtSI(c.vin * d.iIn, 'W')}) just to make a reference. Stiffer than it needs to be: the rule of thumb is divider current about ten times the load current.` };
  if (d.pR1 > RATING || d.pR2 > RATING) return { ok: false, text: 'One of the resistors exceeds a quarter watt.' };
  if (d.vout < 2.25) return { ok: false, text: `Loaded, the output is ${V(d.vout)} (it would be ${V(d.vUnloaded)} with nothing connected). The 4.7 kΩ load is in parallel with R2, so the bottom leg is really ${fmtR(d.r2eff)}. Either lower both resistors so the load barely matters, or choose R1 to match R2 ∥ load.` };
  if (d.vout > 2.75) return { ok: false, text: `Loaded, the output is ${V(d.vout)}: now too high. Compare R1 with R2 ∥ load = ${fmtR(d.r2eff)}; they should be about equal for 2.5 V.` };
  const stiff = Math.abs(d.vUnloaded - 2.5) < 0.25;
  return { ok: true, text: `${V(d.vout)} under load, ${fmtSI(d.iIn, 'A')} from the supply. ` + (stiff
    ? 'You made the divider stiff: its own current is much larger than the load current, so the load hardly moves it. That costs power.'
    : `You compensated: R1 matches R2 ∥ load (${fmtR(d.r2eff)}). It is efficient, but unplug the load and the output jumps to ${V(d.vUnloaded)}.`) + ' When a load varies, use a regulator or buffer the divider with an op-amp instead.' };
}

export default function mount(el, props = {}, ctx = {}) {
  const ch = CHALLENGES[props.challenge] ? props.challenge : null, c = ch ? CHALLENGES[ch] : null;
  const rList = eSeriesValues('E24', 2, 6);
  const num = (x, d) => (x == null || isNaN(+x) ? d : +x);
  const st = { vin: c ? c.vin : num(props.vin, 5), r1: c ? c.r1 : num(props.r1, 10000), r2: c ? c.r2 : num(props.r2, 20000),
    hasLoad: c ? isFinite(c.load) : props.load != null && isFinite(+props.load), load: c && isFinite(c.load) ? c.load : num(props.load, 10000) };
  const sVin = slider({ label: 'Vin', min: 0, max: 24, step: 0.1, value: st.vin, fmt: (v) => v.toFixed(1) + ' V', oninput: (v) => { st.vin = v; render(); } });
  const sR1 = slider({ label: 'R1 (top)', list: rList, value: st.r1, fmt: fmtR, oninput: (v) => { st.r1 = v; render(); } });
  const sR2 = slider({ label: 'R2 (bottom)', list: rList, value: st.r2, fmt: fmtR, oninput: (v) => { st.r2 = v; render(); } });
  const cLoad = checkbox({ label: 'Connect a load across R2', checked: st.hasLoad, onchange: (v) => { st.hasLoad = v; render(); } });
  const sLoad = slider({ label: 'Load', list: eSeriesValues('E12', 2, 6), value: st.load, fmt: fmtR, oninput: (v) => { st.load = v; render(); } });
  st.r1 = sR1.get(); st.r2 = sR2.get();
  const fig = h('div'), ro = readout(), eq = equation(), msg = messages(), verdict = messages();
  const controls = h('div', { class: 'w-controls' }, c ? null : sVin.el, sR1.el, sR2.el, c ? null : cLoad.el, c ? null : sLoad.el);
  clear(el);
  if (c) el.append(task(c.title, ...c.brief));
  el.append(h('div', { class: 'w-grid voltage-divider' },
    h('div', { class: 'el-col' }, fig, eq.el),
    h('div', { class: 'el-col' }, controls, ro.el,
      c ? h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn small', onclick: check }, 'Check design')) : null, verdict.el, msg.el)),
  note('ideal resistors (no tolerance), ideal source, and an ideal 12-bit ADC with a 3.3 V reference that draws no input current. Real ADC inputs take gulps of charge when they sample, real resistors are ±1 % or ±5 %, and the pin limits quoted are typical: check your chip\'s datasheet.'));

  function check() {
    const r = checkChallenge(ch, st);
    verdict.set([[r.ok ? 'ok' : 'bad', r.text]]);
    if (r.ok) ctx.complete?.();
  }

  function render() {
    sLoad.el.hidden = !st.hasLoad;
    const rl = st.hasLoad ? st.load : Infinity, d = divider(st.vin, st.r1, st.r2, rl), code = adcCode(d.vout, VDD, BITS);
    const over = d.vout > VDD, danger = d.vout > ABS_MAX;
    const kids = [rail(110, 34, 'Vin ' + st.vin.toFixed(1) + ' V'), resistor(110, 34, 'v', 'R1', fmtR(st.r1), d.pR1 > RATING ? 'hot' : ''), wire([110, 94], [110, 126]),
      resistor(110, 126, 'v', 'R2', fmtR(st.r2), d.pR2 > RATING ? 'hot' : ''), wire([110, 186], [110, 200]), gnd(110, 200), dot(110, 110),
      wire([110, 110], [262, 110]), flow('M110 34V200', d.iIn),
      s('rect', { x: 262, y: 84, width: 66, height: 52, rx: 3, class: 'el-chip' }), txt(295, 104, 'MCU', { anchor: 'middle', cls: 'sub' }), txt(295, 120, 'ADC in', { anchor: 'middle' }),
      txt(186, 100, 'Vout ' + d.vout.toFixed(3) + ' V', { anchor: 'middle', cls: danger ? 'hot' : over ? 'hot' : 'good' }),
      txt(295, 152, 'code ' + code, { anchor: 'middle', cls: 'sig' }),
      txt(22, 116, fmtSI(d.iIn, 'A'), { cls: 'sig' }), txt(22, 130, 'through R1', { cls: 'sub' })];
    if (st.hasLoad) kids.push(dot(200, 110), resistor(200, 126, 'v', 'load', fmtR(st.load)), wire([200, 110], [200, 126]), wire([200, 186], [200, 200]), gnd(200, 200), flow('M200 110V200', d.iLoad));
    clear(fig).append(svg(340, 226, `Divider: ${st.vin} volts across R1 ${fmtR(st.r1)} and R2 ${fmtR(st.r2)}${st.hasLoad ? ' with a ' + fmtR(st.load) + ' load' : ''}; output ${d.vout.toFixed(2)} volts.`, ...kids));
    ro.set([['Vout', d.vout.toFixed(3) + ' V', over ? 'el-hot' : ''], ['Unloaded', d.vUnloaded.toFixed(3) + ' V'], ['From source', fmtSI(d.iIn, 'A')], ['Source resistance', fmtR(d.rth)], ['ADC code (12-bit)', over ? code + ' (clipped)' : String(code)], ['Power R1 / R2', fmtSI(d.pR1, 'W') + ' / ' + fmtSI(d.pR2, 'W'), d.pR1 > RATING || d.pR2 > RATING ? 'el-hot' : '']]);
    const lines = st.hasLoad
      ? [`R2 ∥ load = 1 / (1/${fmtR(st.r2)} + 1/${fmtR(st.load)}) = ${fmtR(d.r2eff)}`,
        `Vout = Vin × (R2 ∥ load) / (R1 + R2 ∥ load) = ${st.vin.toFixed(1)} V × ${fmtR(d.r2eff)} / ${fmtR(st.r1 + d.r2eff)} = ${d.vout.toFixed(3)} V`]
      : [`Vout = Vin × R2 / (R1 + R2) = ${st.vin.toFixed(1)} V × ${fmtR(st.r2)} / ${fmtR(st.r1 + st.r2)} = ${d.vout.toFixed(3)} V`];
    lines.push(`code = floor(Vout / Vref × 2^12) = floor(${d.vout.toFixed(3)} / 3.3 × 4096) = ${Math.floor(d.vout / VDD * 4096)}${over ? ' → clipped to 4095' : ''}`);
    eq.set(lines);
    if (c) { msg.set([]); return; }   // in a challenge the learner gets feedback only when they commit to a design
    const m = [];
    if (danger) m.push(['bad', `${d.vout.toFixed(2)} V on a 3.3 V pin exceeds the typical absolute maximum (VDD + 0.3 V; check your chip's datasheet). The protection diode conducts and the pin can be damaged.`]);
    else if (over) m.push(['warn', `Vout is above the 3.3 V reference: the ADC reads 4095 for everything up here, and you are relying on the pin's protection diode.`]);
    if (st.hasLoad && d.sagPct > 5) m.push(['warn', `The load pulls the output ${d.sagPct.toFixed(0)} % below the unloaded value. A divider is only accurate when the load resistance is much larger than R2 (ten times or more).`]);
    if (d.pR1 > RATING || d.pR2 > RATING) m.push(['bad', 'A resistor is dissipating more than a quarter watt. A standard part would overheat.']);
    if (d.rth > 10e3 && !st.hasLoad) m.push(['', `Source resistance ${fmtR(d.rth)} is high for a sampling ADC: readings can come out low or noisy. Add ~100 nF from the tap to ground, or use smaller resistors (typical guidance is around 10 kΩ or less; check the datasheet).`]);
    if (d.iIn > 1e-3) m.push(['', `The divider itself draws ${fmtSI(d.iIn, 'A')} all the time. On a battery that matters.`]);
    msg.set(m);
  }
  render();
}
