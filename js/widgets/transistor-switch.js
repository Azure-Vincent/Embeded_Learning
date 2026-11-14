// Low-side transistor switch: a GPIO pin controls a load that needs more voltage or current than the pin can give.
import { h, clear, fmtSI } from '../core/dom.js';
import { nmosSwitch, npnSwitch, fmtR, eSeriesValues } from '../sim/electronics.js';
import { svg, g, wire, resistor, diode, rail, gnd, dot, mcu, nmos, npn, motor, coil, loadBox, txt, flow, slider, select, checkbox, tabs, readout, equation, messages, note, task } from '../sim/electronics-draw.js';

export const MOSFETS = {
  logic: { title: 'Logic-level MOSFET (RDS(on) specified at VGS = 2.5 V)', vth: 1.2, vgsSpec: 2.5, rdsOn: 0.05 },
  standard: { title: 'Standard MOSFET (RDS(on) specified at VGS = 10 V)', vth: 3.0, vgsSpec: 10, rdsOn: 0.05 },
};
export const BJTS = { small: { title: 'Small-signal NPN, gain about 100', beta: 100 }, power: { title: 'Power NPN, gain about 40', beta: 40 } };
export const LOADS = { motor: { title: 'DC motor', inductive: true }, relay: { title: 'Relay coil', inductive: true }, lamp: { title: 'Resistive load (heater, LED strip)', inductive: false } };
const PIN_LIMIT = 8e-3, P_SMALL = 0.5, RG = 100, RPD = 100e3;

export const CHALLENGES = {
  motor: {
    title: 'Switch a 12 V, 500 mA motor from a 3.3 V GPIO',
    brief: ['The motor needs 12 V and draws 500 mA. The pin gives 3.3 V and may source about 8 mA (typical; check your chip\'s datasheet).',
      'Choose the transistor and the parts around it so that the motor gets close to the full 12 V, the transistor stays cool, the pin is not overloaded, nothing is destroyed at switch-off, and the motor stays off while the microcontroller is in reset.'],
    vdrive: 3.3, vsupply: 12, iLoad: 0.5, load: 'motor',
  },
};

/** Operating point for a configuration. state: 'high' | 'low' | 'reset' (pin high-impedance). */
export function evaluate(cfg) {
  const { type = 'nmos', state = 'high', vdrive = 3.3, vsupply = 12, iLoad = 0.5, device, rb = 1000, pulldown = true } = cfg;
  const rload = vsupply / iLoad;
  if (type === 'nmos') {
    const d = MOSFETS[device] || MOSFETS.logic;
    const floating = state === 'reset' && !pulldown;
    const vgs = state === 'high' ? vdrive * (pulldown ? RPD / (RPD + RG) : 1) : 0;
    const r = nmosSwitch({ vgs, vth: d.vth, vgsSpec: d.vgsSpec, rdsOn: d.rdsOn, vsupply, rload });
    return { type, rload, vctl: vgs, floating, region: floating ? 'undefined' : r.region, iLoad: floating ? NaN : r.id, vsw: floating ? NaN : r.vds, p: floating ? NaN : r.p, iPin: state === 'high' && pulldown ? vdrive / (RPD + RG) : 0, dev: d };
  }
  const d = BJTS[device] || BJTS.small;
  const r = npnSwitch({ vdrive: state === 'high' ? vdrive : 0, rb, beta: d.beta, vsupply, rload });
  return { type, rload, vctl: r.ib > 0 ? 0.7 : 0, floating: false, region: r.region, iLoad: r.ic, vsw: r.vce, p: r.p, iPin: r.ib, overdrive: r.overdrive, icSat: r.icSat, dev: d };
}

/** Judge a design for a challenge: checks the on state, switch-off and reset behaviour. */
export function checkChallenge(id, cfg) {
  const c = CHALLENGES[id];
  if (!c) return { ok: false, text: 'Unknown challenge.' };
  const base = { ...cfg, vdrive: c.vdrive, vsupply: c.vsupply, iLoad: c.iLoad };
  const on = evaluate({ ...base, state: 'high' });
  if (cfg.type === 'nmos') {
    if (on.region === 'off') return { ok: false, text: `With 3.3 V on the gate this MOSFET never reaches its threshold (${on.dev.vth} V), so the motor does not turn at all.` };
    if (on.region === 'partial') return { ok: false, text: `3.3 V is above this MOSFET's threshold (${on.dev.vth} V) but far below the ${on.dev.vgsSpec} V at which its on-resistance is specified. Threshold is where it barely starts to conduct, not where it is on. In this model the motor gets ${fmtSI(on.iLoad, 'A')} and the transistor drops ${on.vsw.toFixed(1)} V, burning ${fmtSI(on.p, 'W')}. Choose a part whose RDS(on) is specified at or below your gate voltage.` };
  } else {
    if (on.region === 'linear') return { ok: false, text: `Base current is ${fmtSI(on.iPin, 'A')}; times a gain of ${on.dev.beta} that supports only ${fmtSI(on.iLoad, 'A')} of the ${fmtSI(c.iLoad, 'A')} the motor wants. The transistor is not saturated: it sits with ${on.vsw.toFixed(1)} V across it and dissipates ${fmtSI(on.p, 'W')}. It overheats and the motor runs weakly.` };
    if (on.iPin > PIN_LIMIT) return { ok: false, text: `The transistor saturates, but only because the pin is supplying ${fmtSI(on.iPin, 'A')} of base current, above its ${fmtSI(PIN_LIMIT, 'A')} limit. A bipolar transistor needs base current in proportion to load current; at 500 mA that is more than a GPIO can give.` };
    if (on.overdrive < 2) return { ok: false, text: `On paper it just saturates (base current × gain = ${on.overdrive.toFixed(1)} × the load current), with the pin at ${fmtSI(on.iPin, 'A')}. But gain varies widely between parts and falls at high current, so designers supply at least twice, often ten times, the minimum base current. Doing that here needs more than the pin's ${fmtSI(PIN_LIMIT, 'A')}. A single NPN is the wrong tool for 500 mA from a GPIO; a logic-level MOSFET needs no steady gate current.` };
  }
  if (!cfg.flyback) return { ok: false, text: 'It runs. Then you switch it off: the motor winding is an inductor and keeps its current flowing, so the drain or collector voltage shoots far above 12 V until something breaks down, usually the transistor. A diode across the motor, cathode to +12 V, gives that current a path.' };
  if (cfg.type === 'nmos' && !cfg.pulldown) return { ok: false, text: 'It works while the firmware is running. During reset and boot the pin is a high-impedance input, and with no pull-down the gate floats: stray charge can turn the MOSFET partly on and the motor twitches or runs at power-up. Add a gate-to-source pull-down.' };
  return { ok: true, text: `On: ${fmtSI(on.iLoad, 'A')} through the motor with only ${fmtSI(on.vsw, 'V')} across the transistor (${fmtSI(on.p, 'W')}). The pin supplies essentially no steady current, the diode absorbs the turn-off kick, and the pull-down holds the motor off during reset.` };
}

export default function mount(el, props = {}, ctx = {}) {
  const ch = CHALLENGES[props.challenge] ? props.challenge : null, c = ch ? CHALLENGES[ch] : null;
  const st = { type: props.type === 'npn' ? 'npn' : 'nmos', state: 'high', vdrive: 3.3, vsupply: c ? c.vsupply : 12, iLoad: c ? c.iLoad : 0.5, load: 'motor',
    mos: c ? 'standard' : 'logic', bjt: 'small', rb: 1000, flyback: !c, pulldown: !c };
  const typeTabs = tabs([['nmos', 'N-channel MOSFET'], ['npn', 'NPN transistor']], st.type, (t) => { st.type = t; render(); }, 'Transistor type');
  const stateTabs = tabs([['high', 'Pin high'], ['low', 'Pin low'], ['reset', 'MCU in reset (pin floating)']], st.state, (v) => { st.state = v; render(); }, 'Pin state');
  const sMos = select({ label: 'MOSFET', options: Object.entries(MOSFETS).map(([k, v]) => [k, v.title]), value: st.mos, onchange: (v) => { st.mos = v; render(); } });
  const sBjt = select({ label: 'Transistor', options: Object.entries(BJTS).map(([k, v]) => [k, v.title]), value: st.bjt, onchange: (v) => { st.bjt = v; render(); } });
  const sRb = slider({ label: 'Base resistor', list: eSeriesValues('E12', 1, 5), value: st.rb, fmt: fmtR, oninput: (v) => { st.rb = v; render(); } });
  const sLoad = select({ label: 'Load', options: Object.entries(LOADS).map(([k, v]) => [k, v.title]), value: st.load, onchange: (v) => { st.load = v; render(); } });
  const sVs = select({ label: 'Load supply', options: [[5, '5 V'], [12, '12 V'], [24, '24 V']], value: st.vsupply, onchange: (v) => { st.vsupply = +v; render(); } });
  const sI = slider({ label: 'Load current', min: 0.02, max: 3, log: true, value: st.iLoad, fmt: (v) => fmtSI(v, 'A'), oninput: (v) => { st.iLoad = v; render(); } });
  const sVd = slider({ label: 'Pin high level', min: 1.8, max: 5, step: 0.1, value: st.vdrive, fmt: (v) => v.toFixed(1) + ' V', oninput: (v) => { st.vdrive = v; render(); } });
  const cFly = checkbox({ label: 'Flyback diode across the load', checked: st.flyback, onchange: (v) => { st.flyback = v; render(); } });
  const cPd = checkbox({ label: 'Gate pull-down (100 kΩ to ground)', checked: st.pulldown, onchange: (v) => { st.pulldown = v; render(); } });
  const fig = h('div'), ro = readout(), eq = equation(), msg = messages(), verdict = messages();
  clear(el);
  if (c) el.append(task(c.title, ...c.brief));
  el.append(typeTabs.el, h('div', { class: 'w-grid transistor-switch' },
    h('div', { class: 'el-col' }, fig, eq.el),
    h('div', { class: 'el-col' }, stateTabs.el, h('div', { class: 'w-controls' }, sMos.el, sBjt.el, sRb.el, c ? null : sLoad.el, c ? null : sVs.el, c ? null : sI.el, c ? null : sVd.el, cFly.el, cPd.el), ro.el,
      c ? h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn small', onclick: check }, 'Check design')) : null, verdict.el, msg.el)),
  note('first-order switch models. MOSFET: off below threshold, a square-law current limit between threshold and the gate voltage at which RDS(on) is specified, a fixed 50 mΩ resistor above it. NPN: VBE = 0.7 V, VCE(sat) = 0.2 V, constant gain. The two MOSFETs are generic classes, not part numbers. Not modelled: gate charge and switching speed, motor start-up surge (several times the running current), heating, and the flyback voltage itself. Pin and package limits are typical: check the datasheets.'));

  const cfg = () => ({ type: st.type, state: st.state, vdrive: st.vdrive, vsupply: st.vsupply, iLoad: st.iLoad, device: st.type === 'nmos' ? st.mos : st.bjt, rb: st.rb, pulldown: st.pulldown, flyback: st.flyback });
  function check() {
    const r = checkChallenge(ch, cfg());
    verdict.set([[r.ok ? 'ok' : 'bad', r.text]]);
    if (r.ok) ctx.complete?.();
  }

  function render() {
    const mos = st.type === 'nmos';
    sMos.el.hidden = !mos; cPd.el.hidden = !mos; sBjt.el.hidden = mos; sRb.el.hidden = mos;
    const e = evaluate(cfg()), ind = LOADS[st.load].inductive, hot = e.p > P_SMALL, conducting = e.iLoad > 1e-6;
    const X = 214, loadSym = st.load === 'motor' ? motor(X, 44, 'motor') : st.load === 'relay' ? coil(X, 44, 'relay coil') : loadBox(X, 44, 'load');
    const kids = [rail(X, 44, `+${st.vsupply} V`), loadSym, wire([X, 94], [X, 126]), dot(X, 102),
      mos ? nmos(X, 154, hot ? 'hot' : '') : npn(X, 154, hot ? 'hot' : ''), wire([X, 182], [X, 196]), gnd(X, 196),
      mcu(72, 154, 'MCU', st.state === 'reset' ? 'hi-Z' : st.state === 'high' ? 'HIGH' : 'LOW'), wire([72, 154], [84, 154]),
      resistor(84, 154, 'h', mos ? 'Rg 100 Ω' : 'Rb ' + fmtR(st.rb)), wire([144, 154], [X - 30, 154]),
      flow(`M${X} 44V196`, conducting ? e.iLoad : 0),
      txt(X + 24, 150, mos ? (e.floating ? 'VGS = ?' : 'VGS ' + e.vctl.toFixed(2) + ' V') : 'IB ' + fmtSI(e.iPin, 'A'), { cls: 'sig' }),
      txt(X + 24, 164, isNaN(e.vsw) ? 'undefined' : (mos ? 'VDS ' : 'VCE ') + fmtSI(e.vsw, 'V'), { cls: hot ? 'hot' : 'sub' }),
      txt(X + 24, 178, isNaN(e.p) ? '' : fmtSI(e.p, 'W'), { cls: hot ? 'hot' : 'sub' })];
    if (st.flyback) kids.push(wire([X, 44], [X + 84, 44], [X + 84, 52]), diode(X + 84, 92, 'u'), wire([X + 84, 92], [X + 84, 102], [X, 102]), dot(X, 44), txt(X + 84, 116, 'flyback', { anchor: 'middle', cls: 'sub' }));
    else if (ind && !c) kids.push(txt(X + 14, 112, 'no flyback path!', { cls: 'hot' }));
    if (mos && st.pulldown) kids.push(dot(160, 154), resistor(160, 154, 'v'), txt(148, 190, '100 kΩ', { anchor: 'end' }), wire([160, 214], [160, 218]), gnd(160, 218));
    if (mos && !st.pulldown && st.state === 'reset') kids.push(txt(166, 174, 'gate floating', { anchor: 'middle', cls: 'hot' }));
    clear(fig).append(svg(340, 240, `Low-side ${mos ? 'MOSFET' : 'NPN'} switch: ${LOADS[st.load].title} on ${st.vsupply} volts, transistor ${e.region}.`, ...kids));
    const vLoad = isNaN(e.vsw) ? NaN : st.vsupply - e.vsw;
    ro.set([['Transistor', e.region === 'on' || e.region === 'saturated' ? 'fully on' : e.region === 'partial' || e.region === 'linear' ? 'partly on' : e.region, e.region === 'partial' || e.region === 'linear' || e.region === 'undefined' ? 'el-hot' : ''],
      ['Load current', isNaN(e.iLoad) ? 'undefined' : fmtSI(e.iLoad, 'A')], ['Across load', isNaN(vLoad) ? 'undefined' : vLoad.toFixed(2) + ' V'],
      ['Transistor heat', isNaN(e.p) ? 'undefined' : fmtSI(e.p, 'W'), hot ? 'el-hot' : ''], ['Pin current', fmtSI(e.iPin, 'A'), e.iPin > PIN_LIMIT ? 'el-hot' : ''], ['Load looks like', fmtR(+e.rload.toPrecision(3))]]);
    eq.set(mos ? [`VGS = ${e.floating ? 'undefined (nothing sets the gate voltage)' : e.vctl.toFixed(2) + ' V'};  threshold ${e.dev.vth} V;  RDS(on) guaranteed from ${e.dev.vgsSpec} V`,
      e.region === 'on' ? `I = V+ / (Rload + RDS(on)) = ${st.vsupply} V / (${fmtR(+e.rload.toPrecision(3))} + 0.05 Ω) = ${fmtSI(e.iLoad, 'A')}` : `I = ${isNaN(e.iLoad) ? '?' : fmtSI(e.iLoad, 'A')}`,
      `P = VDS × I = ${isNaN(e.p) ? '?' : fmtSI(e.vsw, 'V') + ' × ' + fmtSI(e.iLoad, 'A') + ' = ' + fmtSI(e.p, 'W')}`]
      : [`IB = (Vpin − VBE) / Rb = (${st.state === 'high' ? st.vdrive.toFixed(1) : '0'} V − 0.7 V) / ${fmtR(st.rb)} = ${fmtSI(e.iPin, 'A')}`,
        `IC is the smaller of  gain × IB = ${fmtSI(e.dev.beta * e.iPin, 'A')}  and  (V+ − 0.2 V) / Rload = ${fmtSI(e.icSat, 'A')}  →  ${fmtSI(e.iLoad, 'A')}`,
        `P ≈ VCE × IC = ${fmtSI(e.vsw, 'V')} × ${fmtSI(e.iLoad, 'A')} = ${fmtSI(e.vsw * e.iLoad, 'W')}`]);
    if (c) { msg.set([]); return; }
    const m = [];
    if (e.floating) m.push(['bad', 'During reset the pin is high-impedance and nothing defines the gate voltage. The gate is a tiny capacitor that holds whatever charge it picks up, so the load may be off, on, or half on and heating. Fit the pull-down.']);
    if (mos && st.state === 'high' && e.region === 'off') m.push(['bad', `The gate threshold (${e.dev.vth} V) is not reached at ${e.vctl.toFixed(2)} V. The load stays off.`]);
    if (e.region === 'partial') m.push(['bad', `The gate is above threshold but below the ${e.dev.vgsSpec} V at which the on-resistance is specified. The channel is only partly formed: the load gets ${fmtSI(e.iLoad, 'A')} and the MOSFET dissipates ${fmtSI(e.p, 'W')}. Use a logic-level part, or a gate driver.`]);
    if (e.region === 'linear') m.push(['bad', `Not saturated: gain × base current is less than the load wants, so the transistor holds ${e.vsw.toFixed(1)} V across itself and turns ${fmtSI(e.p, 'W')} into heat. Lower the base resistor.`]);
    if (e.region === 'saturated' && e.overdrive < 2) m.push(['warn', `Only just saturated (${e.overdrive.toFixed(1)} × the minimum base current). Gain varies between parts and with temperature; aim for at least 2 ×, commonly 10 ×.`]);
    if (e.iPin > PIN_LIMIT) m.push(['bad', `The pin is supplying ${fmtSI(e.iPin, 'A')}, above a typical ${fmtSI(PIN_LIMIT, 'A')} limit (check your chip's datasheet). Raise the base resistor, or use a MOSFET.`]);
    if (hot && !m.some((x) => /dissipates|heat\./.test(x[1]))) m.push(['warn', `${fmtSI(e.p, 'W')} in the transistor is more than a small package sheds without a heatsink (roughly half a watt; check the datasheet).`]);
    else if (hot) m.push(['warn', 'A small transistor package can shed roughly half a watt without a heatsink (check the datasheet).']);
    if (ind && !st.flyback) m.push(['bad', `${LOADS[st.load].title} is inductive. At switch-off its current cannot stop instantly, so the voltage at the transistor rises until something breaks down. Without a flyback diode that something is the transistor.`]);
    if (!ind && st.flyback) m.push(['', 'A purely resistive load does not need the diode; it does no harm.']);
    if (!m.length) m.push(['ok', st.state === 'high' ? 'Fully on, cool, and within the pin limit.' : 'Off: no load current flows.']);
    msg.set(m);
  }
  render();
}
