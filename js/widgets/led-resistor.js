// LED current limiting from a GPIO pin: pick the resistor, see the current against the pin and LED limits.
import { h, s, clear, fmtSI } from '../core/dom.js';
import { ledCircuit, ledResistorFor, nextEUp, fmtR, eSeriesValues } from '../sim/electronics.js';
import { svg, g, wire, resistor, led, gnd, mcu, txt, flow, slider, select, checkbox, readout, equation, messages, note, task } from '../sim/electronics-draw.js';

export const LEDS = { red: { vf: 1.8, css: '--sig2' }, yellow: { vf: 2.0, css: '--warn' }, green: { vf: 2.1, css: '--sig3' }, blue: { vf: 3.0, css: '--sig1' }, white: { vf: 3.0, css: '--muted' } };
const R_PIN = 30, LED_MAX = 20e-3, RATING = 0.25;

export const CHALLENGES = {
  'gpio-3v3-red': {
    title: 'Drive a red indicator LED from a 3.3 V GPIO',
    brief: ['The pin outputs 3.3 V. The red LED drops about 1.8 V when lit. Assume the pin may safely source 8 mA (a typical figure; the real one is in your chip\'s datasheet).',
      'Choose a standard E12 resistor that runs the LED between 3 mA and 6 mA: clearly visible indoors, with margin below the pin limit.'],
    vsupply: 3.3, vf: 1.8, pinLimit: 8e-3, lo: 3e-3, hi: 6e-3,
  },
};

/** Judge a resistor choice for a challenge. `r` of 0 means the learner left the resistor out. */
export function checkChallenge(id, r) {
  const c = CHALLENGES[id];
  if (!c) return { ok: false, text: 'Unknown challenge.' };
  if (!(r > 0)) return { ok: false, text: `With no resistor the only things limiting the current are the pin's own output resistance and the LED. Tens of milliamps flow, far beyond the ${fmtSI(c.pinLimit, 'A')} pin limit. It may light for a while; it also stresses the pin and can pull the output low enough to corrupt other pins on the port.` };
  const k = ledCircuit(c.vsupply, c.vf, r), I = fmtSI(k.i, 'A');
  if (k.i > LED_MAX) return { ok: false, text: `${fmtR(r)} lets ${I} flow: more than both the pin limit and the 20 mA a typical indicator LED is rated for. Something will fail, and it is not obvious which goes first.` };
  if (k.i > c.pinLimit) return { ok: false, text: `${fmtR(r)} gives ${I}. The LED is happy, but the pin is not: that is above its ${fmtSI(c.pinLimit, 'A')} limit. The output voltage sags and the pin ages faster. The resistor is sized for the weakest part in the loop, here the pin.` };
  if (k.i > c.hi) return { ok: false, text: `${fmtR(r)} gives ${I}: under the pin's absolute limit, but with almost no margin. Resistor tolerance and a slightly lower forward voltage on a warm LED would push it over. Go up a value or two.` };
  if (k.i < c.lo) return { ok: false, text: `${fmtR(r)} gives only ${I}. Safe, but dimmer than asked: fine in a dark room, hard to see in daylight. The voltage left for the resistor is only 3.3 − 1.8 = 1.5 V, so it does not take many ohms.` };
  return { ok: true, text: `${fmtR(r)} gives ${I}: (3.3 V − 1.8 V) / ${fmtR(r)}. The resistor dissipates ${fmtSI(k.pR, 'W')}, far below a quarter watt. For a different target current, compute R = (Vs − Vf) / I and round up to the next standard value.` };
}

export default function mount(el, props = {}, ctx = {}) {
  const ch = CHALLENGES[props.challenge] ? props.challenge : null, c = ch ? CHALLENGES[ch] : null;
  const num = (x, d) => (x == null || isNaN(+x) ? d : +x);
  const st = { vs: c ? c.vsupply : num(props.vsupply, 3.3), vf: c ? c.vf : num(props.vf, 1.8), r: c ? 1000 : 330, noR: false, limit: c ? c.pinLimit : 8e-3, colour: 'red' };
  if (!c && props.vf != null) st.colour = Object.keys(LEDS).reduce((b, k) => Math.abs(LEDS[k].vf - st.vf) < Math.abs(LEDS[b].vf - st.vf) ? k : b, 'red');
  const sVs = slider({ label: 'Pin high level', min: 1.8, max: 5, step: 0.1, value: st.vs, fmt: (v) => v.toFixed(1) + ' V', oninput: (v) => { st.vs = v; render(); } });
  const sVf = slider({ label: 'LED forward V', min: 1.2, max: 3.6, step: 0.05, value: st.vf, fmt: (v) => v.toFixed(2) + ' V', oninput: (v) => { st.vf = v; render(); } });
  const sCol = select({ label: 'LED colour', options: Object.keys(LEDS).map((k) => [k, `${k} (about ${LEDS[k].vf.toFixed(1)} V)`]), value: st.colour, onchange: (k) => { st.colour = k; st.vf = LEDS[k].vf; sVf.set(st.vf); render(); } });
  const sR = slider({ label: 'Resistor', list: eSeriesValues('E12', 1, 4), value: st.r, fmt: fmtR, oninput: (v) => { st.r = v; render(); } });
  const cNoR = checkbox({ label: 'Leave the resistor out', checked: false, onchange: (v) => { st.noR = v; render(); } });
  const sLim = slider({ label: 'Pin current limit', min: 2, max: 25, step: 1, value: st.limit * 1000, fmt: (v) => v + ' mA', oninput: (v) => { st.limit = v / 1000; render(); } });
  const fig = h('div'), ro = readout(), eq = equation(), msg = messages(), verdict = messages();
  clear(el);
  if (c) el.append(task(c.title, ...c.brief));
  el.append(h('div', { class: 'w-grid led-resistor' },
    h('div', { class: 'el-col' }, fig, eq.el),
    h('div', { class: 'el-col' }, h('div', { class: 'w-controls' }, c ? null : sVs.el, c ? null : sCol.el, c ? null : sVf.el, sR.el, cNoR.el, c ? null : sLim.el), ro.el,
      c ? h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn small', onclick: check }, 'Check resistor')) : null, verdict.el, msg.el)),
  note(`the LED is a fixed forward-voltage drop and the pin is an ideal source (with ${R_PIN} Ω of output resistance only when the resistor is left out). A real LED's forward voltage rises a little with current and varies between parts and with temperature; a real pin's high level sags as you load it. Pin limits here are typical placeholders: check your chip's datasheet, including any total-per-port limit.`));

  function check() {
    const r = checkChallenge(ch, st.noR ? 0 : st.r);
    verdict.set([[r.ok ? 'ok' : 'bad', r.text]]);
    if (r.ok) ctx.complete?.();
  }

  function render() {
    sR.el.hidden = st.noR;
    const r = st.noR ? R_PIN : st.r, k = ledCircuit(st.vs, st.vf, r), i = k.i;
    const overPin = i > st.limit, overLed = i > LED_MAX, glow = i <= 0 ? 0 : Math.min(1, Math.log10(1 + i * 1000) / Math.log10(21));
    const iMax = 30e-3, bx = 30, bw = 280, by = 150, px = (a) => bx + Math.min(1, a / iMax) * bw;
    const fig1 = svg(340, 206, `GPIO pin, ${st.noR ? 'no resistor' : fmtR(st.r) + ' resistor'} and LED to ground; ${fmtSI(i, 'A')} flows.`,
      mcu(92, 70, 'MCU', 'GPIO'), wire([92, 70], [130, 70]),
      st.noR ? g({}, wire([130, 70], [190, 70]), txt(160, 58, 'no resistor', { anchor: 'middle', cls: 'hot' })) : resistor(130, 70, 'h', fmtR(st.r), null, k.pR > RATING ? 'hot' : ''),
      wire([190, 70], [210, 70]), led(210, 70, 'h', `${st.colour} LED`, null, { glow, cls: overLed ? 'hot' : '' }), wire([250, 70], [290, 70], [290, 96]), gnd(290, 96),
      flow('M92 70H290V96', i),
      txt(96, 62, st.vs.toFixed(1) + ' V', { cls: 'sub' }), txt(160, 92, k.vR.toFixed(2) + ' V', { anchor: 'middle', cls: 'sub' }), txt(230, 98, st.vf.toFixed(2) + ' V', { anchor: 'middle', cls: 'sub' }),
      // current bar: green up to the pin limit, amber up to the LED limit, red beyond
      s('rect', { x: bx, y: by, width: px(st.limit) - bx, height: 12, class: 'band-ok' }),
      s('rect', { x: px(st.limit), y: by, width: Math.max(0, px(LED_MAX) - px(st.limit)), height: 12, class: 'band-warn' }),
      s('rect', { x: px(Math.max(LED_MAX, st.limit)), y: by, width: bx + bw - px(Math.max(LED_MAX, st.limit)), height: 12, class: 'band-bad' }),
      s('rect', { x: bx, y: by, width: bw, height: 12, fill: 'none', class: 'el-grid' }),
      s('path', { d: `M${px(i)} ${by - 5}l5 -8h-10Z`, class: 'marker' }), s('path', { d: `M${px(i)} ${by - 4}V${by + 14}`, class: 'el-wire' }),
      txt(Math.min(Math.max(px(i), 60), 280), by - 18, 'LED current ' + fmtSI(i, 'A') + (i > iMax ? ' (off scale)' : ''), { anchor: 'middle', cls: overPin ? 'hot' : 'good' }),
      txt(bx, by + 26, '0', { cls: 'sub' }), txt(px(st.limit), by + 26, 'pin limit', { anchor: 'middle', cls: 'sub' }),
      Math.abs(px(LED_MAX) - px(st.limit)) > 50 ? txt(px(LED_MAX), by + 26, 'LED 20 mA', { anchor: 'middle', cls: 'sub' }) : null, txt(bx + bw, by + 26, '30 mA', { anchor: 'end', cls: 'sub' }));
    fig1.style.setProperty('--el-led', `var(${LEDS[st.colour].css})`);
    clear(fig).append(fig1);
    ro.set([['LED current', fmtSI(i, 'A'), overPin ? 'el-hot' : ''], ['Across resistor', k.vR.toFixed(2) + ' V'], ['Resistor power', fmtSI(k.pR, 'W'), k.pR > RATING ? 'el-hot' : ''], ['LED power', fmtSI(k.pLed, 'W')]]);
    const lines = [`I = (Vs − Vf) / R = (${st.vs.toFixed(1)} V − ${st.vf.toFixed(2)} V) / ${st.noR ? R_PIN + ' Ω (pin only)' : fmtR(st.r)} = ${fmtSI(i, 'A')}`];
    if (!c && k.headroom > 0) { const want = Math.min(5e-3, st.limit * 0.6), rr = ledResistorFor(st.vs, st.vf, want); lines.push(`for ${fmtSI(want, 'A')}:  R = (Vs − Vf) / I = ${k.headroom.toFixed(2)} V / ${fmtSI(want, 'A')} = ${fmtR(+rr.toPrecision(3))} → next E12 up: ${fmtR(nextEUp(rr))}`); }
    eq.set(lines);
    if (c) { msg.set([]); return; }
    const m = [];
    if (k.headroom <= 0) m.push(['bad', `The pin's ${st.vs.toFixed(1)} V is not above the LED's ${st.vf.toFixed(2)} V forward voltage, so essentially no current flows and the LED stays dark whatever resistor you fit. This is why blue and white LEDs are unreliable straight from a 3.3 V pin.`]);
    else if (k.headroom < 0.4) m.push(['warn', `Only ${k.headroom.toFixed(2)} V is left for the resistor. The current now depends heavily on the exact forward voltage, which varies from LED to LED and with temperature: brightness will be inconsistent.`]);
    if (st.noR && k.headroom > 0) m.push(['bad', `No series resistor: only the pin's roughly ${R_PIN} Ω output resistance limits the current. An LED does not limit its own current; past its forward voltage it conducts as much as the source will give.`]);
    if (overLed) m.push(['bad', `${fmtSI(i, 'A')} is above the 20 mA continuous rating of a typical indicator LED. It overheats, dims permanently, then fails.`]);
    if (overPin) m.push(['bad', `${fmtSI(i, 'A')} is above the pin limit you set (${fmtSI(st.limit, 'A')}; typical figure, check your chip's datasheet). The pin's output sags and the driver transistor is stressed. For more current, switch the LED with a transistor.`]);
    if (k.pR > RATING) m.push(['bad', 'The resistor is dissipating more than a quarter watt.']);
    if (!overPin && k.headroom > 0 && i < 0.5e-3) m.push(['', 'Under half a milliamp: a modern high-efficiency LED is visible, an older one barely glows.']);
    if (!m.length) m.push(['ok', 'Within the pin limit and the LED rating.']);
    msg.set(m);
  }
  render();
}
