// One GPIO pin seen electrically: output driver, pulls, input thresholds and whatever is wired to the pad.
import { h, s, clear, fmtSI } from '../core/dom.js';
import { gpioSolve, GPIO_DEFAULTS, GPIO_EXTERNALS, prng, fmtR } from '../sim/electronics.js';
import { svg, g, wire, resistor, led, rail, gnd, dot, sw, txt, flow, select, checkbox, tabs, readout, equation, messages, note } from '../sim/electronics-draw.js';

const P = GPIO_DEFAULTS, PIN_LIMIT = 8e-3;

export const EXPERIMENTS = {
  floating: { title: 'Read an input that nothing is driving' },
  'pullup-idle': { title: 'Give a button to GND a pull-up: it reads 1 when released' },
  'pullup-pressed': { title: '…and 0 when pressed' },
  'od-no-pull': { title: 'Write 1 to an open-drain output with no pull-up anywhere' },
  'od-pull': { title: 'Write 1 to an open-drain output that has a pull-up' },
  contention: { title: 'Make a push-pull output fight a short (and see the current)' },
};
export const CHALLENGES = { experiments: { title: 'Reproduce six GPIO electrical situations' } };

/** Which experiments a configuration demonstrates. Pure, so the checklist logic is testable. */
export function experimentsHit(cfg, sol = gpioSolve(cfg)) {
  const hit = [], pulledUp = cfg.pull === 'up' || cfg.ext === 'pullup-ext' || cfg.ext === 'pullup-5v';
  if (cfg.mode === 'in' && sol.floating) hit.push('floating');
  if (cfg.mode === 'in' && cfg.ext === 'button-gnd' && cfg.pull === 'up') hit.push(cfg.pressed ? 'pullup-pressed' : 'pullup-idle');
  if (cfg.mode === 'od' && cfg.level === 1 && sol.floating) hit.push('od-no-pull');
  if (cfg.mode === 'od' && cfg.level === 1 && pulledUp && sol.logic === 1) hit.push('od-pull');
  if (cfg.mode === 'pp' && sol.contention) hit.push('contention');
  return hit;
}
/** What sixteen successive reads of the input register return. Floating and in-between voltages give noise. */
export function sampleReads(sol, seed = 1, n = 16) {
  const rnd = prng(seed);
  return Array.from({ length: n }, () => (sol.logic === 0 || sol.logic === 1 ? sol.logic : rnd() < 0.5 ? 0 : 1));
}

export default function mount(el, props = {}, ctx = {}) {
  const st = { mode: 'in', level: 1, pull: 'none', ext: 'none', pressed: false, seed: 3, done: new Set(), completed: false };
  const modeTabs = tabs([['in', 'Input'], ['pp', 'Output, push-pull'], ['od', 'Output, open-drain']], st.mode, (m) => { st.mode = m; render(); }, 'Pin mode');
  const levelTabs = tabs([[1, 'Firmware writes 1'], [0, 'Firmware writes 0']], st.level, (v) => { st.level = v; render(); }, 'Output value');
  const sPull = select({ label: 'Internal pull', options: [['none', 'None'], ['up', 'Pull-up (about 45 kΩ to VDD)'], ['down', 'Pull-down (about 45 kΩ to GND)']], value: st.pull, onchange: (v) => { st.pull = v; render(); } });
  const sExt = select({ label: 'Outside the chip', options: Object.entries(GPIO_EXTERNALS).map(([k, v]) => [k, v.title]), value: st.ext, onchange: (v) => { st.ext = v; st.pressed = false; cPress.set(false); render(); } });
  const cPress = checkbox({ label: 'Button pressed', checked: false, onchange: (v) => { st.pressed = v; render(); } });
  const again = h('button', { type: 'button', class: 'btn small ghost', onclick: () => { st.seed++; render(); } }, 'Read the pin 16 more times');
  const fig = h('div'), ro = readout(), eq = equation(), msg = messages(), reads = h('div', { class: 'gpio-electrical-reads', 'aria-live': 'polite' }), list = h('ul', { class: 'gpio-electrical-exp' });
  clear(el).append(modeTabs.el, h('div', { class: 'w-grid gpio-electrical' },
    h('div', { class: 'el-col' }, fig, eq.el),
    h('div', { class: 'el-col' }, levelTabs.el, h('div', { class: 'w-controls' }, sPull.el, sExt.el, cPress.el), ro.el,
      h('div', {}, h('div', { class: 'el-sub' }, 'Sixteen reads of the input register'), reads, again), msg.el,
      h('div', {}, h('div', { class: 'el-sub' }, 'Things to reproduce'), list))),
  note(`VDD = 3.3 V. Output transistors are ${P.rOn} Ω switches, internal pulls ${P.rPull / 1000} kΩ, thresholds VIL = 0.3 × VDD and VIH = 0.7 × VDD, protection diode to VDD conducting at VDD + 0.6 V, LED forward voltage 1.8 V. All of these are typical values that differ between chips and even between pins: check your chip's datasheet. A floating pin is shown as random reads; on real hardware it drifts with nearby signals, your hand and humidity, and can look stable for minutes before it changes.`));

  function external(sol) {
    const k = [], Y = 100, on = (n) => sol.branches.some((b) => b.name === n);
    switch (st.ext) {
      case 'none': k.push(wire([186, Y], [216, Y]), s('circle', { cx: 219, cy: Y, r: 3, class: 'el-body' }), txt(228, Y + 4, 'nothing connected', { cls: 'sub' })); break;
      case 'button-gnd': k.push(wire([186, Y], [256, Y], [256, 112]), sw(256, 112, 'v', st.pressed), gnd(256, 152), txt(268, 136, st.pressed ? 'pressed' : 'open', { cls: 'sub' })); break;
      case 'button-vdd': k.push(rail(256, 40, '3.3 V'), sw(256, 40, 'v', st.pressed), wire([256, 80], [256, Y], [186, Y]), txt(268, 64, st.pressed ? 'pressed' : 'open', { cls: 'sub' })); break;
      case 'led-gnd': k.push(wire([186, Y], [196, Y]), resistor(196, Y, 'h', '330 Ω'), wire([256, Y], [286, Y], [286, 110]), led(286, 110, 'v', null, null, { glow: sol.ledOn ? Math.min(1, sol.iLed / 5e-3) : 0 }), gnd(286, 150)); break;
      case 'led-vdd': k.push(wire([186, Y], [196, Y]), resistor(196, Y, 'h', '330 Ω'), wire([256, Y], [286, Y], [286, 86]), rail(286, 46, '3.3 V'), led(286, 46, 'v', null, null, { glow: sol.ledOn ? Math.min(1, sol.iLed / 5e-3) : 0 })); break;
      case 'pullup-ext': case 'pullup-5v': k.push(rail(256, 36, st.ext === 'pullup-5v' ? '5 V' : '3.3 V'), resistor(256, 36, 'v', '4.7 kΩ'), wire([256, 96], [256, Y], [186, Y])); break;
      case 'drive-5v': k.push(wire([186, Y], [240, Y]), s('rect', { x: 240, y: 76, width: 84, height: 48, rx: 3, class: 'el-chip' }), txt(282, 96, '5 V device', { anchor: 'middle', cls: 'sub' }), txt(282, 112, 'output HIGH', { anchor: 'middle' })); break;
      case 'short-gnd': k.push(wire([186, Y], [256, Y], [256, 120]), gnd(256, 120)); break;
    }
    if (on('LED') || sol.contention) k.push(flow(`M186 ${Y}H${on('LED') ? 286 : 256}`, Math.abs(sol.iPin), sol.iPin < 0));
    return k;
  }

  function render() {
    const out = st.mode !== 'in';
    levelTabs.el.hidden = !out; cPress.el.hidden = !GPIO_EXTERNALS[st.ext].button;
    const cfg = { mode: st.mode, level: st.level, pull: st.pull, ext: st.ext, pressed: st.pressed }, sol = gpioSolve(cfg);
    const hi = st.mode === 'pp' && st.level === 1, lo = out && st.level === 0, Y = 100;
    // voltage bar
    const bx = 34, bw = 280, by = 248, vmax = 4.2, px = (v) => bx + Math.min(1, Math.max(0, v / vmax)) * bw;
    const bar = [s('rect', { x: px(0), y: by, width: px(sol.vil) - px(0), height: 16, class: 'band-fill' }), s('rect', { x: px(sol.vil), y: by, width: px(sol.vih) - px(sol.vil), height: 16, class: 'band-warn' }),
      s('rect', { x: px(sol.vih), y: by, width: px(P.vdd) - px(sol.vih), height: 16, class: 'band-ok' }), s('rect', { x: px(P.vdd), y: by, width: px(vmax) - px(P.vdd), height: 16, class: 'band-bad' }),
      s('rect', { x: bx, y: by, width: bw, height: 16, fill: 'none', class: 'el-grid' }),
      txt((px(0) + px(sol.vil)) / 2, by + 12, 'reads 0', { anchor: 'middle', cls: 'sub' }), txt((px(sol.vil) + px(sol.vih)) / 2, by + 12, 'undefined', { anchor: 'middle', cls: 'sub' }),
      txt((px(sol.vih) + px(P.vdd)) / 2, by + 12, 'reads 1', { anchor: 'middle', cls: 'sub' }), txt((px(P.vdd) + px(vmax)) / 2, by + 12, 'over VDD', { anchor: 'middle', cls: 'sub' }),
      txt(px(0), by + 30, '0 V', { cls: 'sub' }), txt(px(sol.vil), by + 30, 'VIL ' + sol.vil.toFixed(2), { anchor: 'middle', cls: 'sub' }), txt(px(sol.vih), by + 30, 'VIH ' + sol.vih.toFixed(2), { anchor: 'middle', cls: 'sub' }), txt(px(P.vdd), by + 30, 'VDD 3.3', { anchor: 'middle', cls: 'sub' })];
    if (sol.floating) bar.push(s('path', { d: `M${px(0.1)} ${by - 4}H${px(P.vdd)}`, class: 'el-dash' }), txt(px(1.65), by - 12, 'pin voltage: anywhere (floating)', { anchor: 'middle', cls: 'hot' }));
    else bar.push(s('path', { d: `M${px(sol.v)} ${by - 2}l5 -8h-10Z`, class: 'marker' }), s('path', { d: `M${px(sol.v)} ${by - 2}V${by + 16}`, class: 'el-wire' }),
      txt(Math.min(Math.max(px(sol.v), 84), 256), by - 14, 'pin voltage ' + sol.v.toFixed(2) + ' V', { anchor: 'middle', cls: sol.v > P.vdd + 0.3 || sol.logic === 'x' ? 'hot' : 'good' }));
    clear(fig).append(svg(340, 290, `GPIO pin as ${st.mode === 'in' ? 'input' : st.mode === 'pp' ? 'push-pull output' : 'open-drain output'}; pin voltage ${sol.floating ? 'floating' : sol.v.toFixed(2) + ' volts'}.`,
      s('rect', { x: 10, y: 12, width: 168, height: 204, rx: 4, class: 'el-dash' }), txt(18, 210, 'inside the MCU', { cls: 'sub' }),
      // output stage: two switches standing in for the P-channel (top) and N-channel (bottom) transistors
      rail(52, 40, 'VDD'), g({ class: st.mode === 'od' || !out ? 'off' : '' }, sw(52, 40, 'v', hi)), txt(40, 66, 'P', { anchor: 'end', cls: hi ? 'good' : 'sub' }),
      wire([52, 80], [52, 120]), g({ class: !out ? 'off' : '' }, sw(52, 120, 'v', lo)), gnd(52, 160), txt(40, 146, 'N', { anchor: 'end', cls: lo ? 'good' : 'sub' }),
      txt(18, 194, !out ? 'driver off (hi-Z)' : st.mode === 'od' ? 'open-drain: P unused' : 'push-pull', { cls: 'sub' }),
      wire([52, Y], [178, Y]), dot(52, Y), s('rect', { x: 174, y: Y - 6, width: 12, height: 12, class: 'el-body' }), txt(180, Y - 13, 'pad', { anchor: 'middle', cls: 'sub' }),
      st.pull === 'up' ? g({}, rail(104, 40, 'VDD'), resistor(104, 40, 'v', '45 kΩ'), dot(104, Y)) : null,
      st.pull === 'down' ? g({}, resistor(104, Y, 'v', '45 kΩ'), gnd(104, 160), dot(104, Y)) : null,
      // input buffer
      dot(150, Y), wire([150, Y], [150, 124]), g({ class: 'el-part' }, s('path', { d: 'M138 124H162L150 146Z', class: 'el-body' }), s('path', { d: 'M150 146V160' })),
      txt(150, 174, 'reads ' + (sol.logic === 'float' || sol.logic === 'x' ? '?' : sol.logic), { anchor: 'middle', cls: sol.logic === 0 || sol.logic === 1 ? 'sig' : 'hot' }),
      ...external(sol), ...bar));
    const rd = sampleReads(sol, st.seed);
    reads.textContent = rd.join(' ');
    const stable = sol.logic === 0 || sol.logic === 1;
    ro.set([['Pin voltage', sol.floating ? 'floating' : sol.v.toFixed(2) + ' V', sol.floating || sol.v > P.vdd + 0.3 ? 'el-hot' : ''], ['Firmware reads', stable ? String(sol.logic) : 'unreliable', stable ? '' : 'el-hot'],
      ['Driver current', out ? fmtSI(Math.abs(sol.iPin), 'A') + (sol.iPin > 1e-9 ? ' out' : sol.iPin < -1e-9 ? ' in' : '') : 'driver off', Math.abs(sol.iPin) > PIN_LIMIT ? 'el-hot' : ''],
      ['Clamp diode current', fmtSI(sol.iClamp, 'A'), sol.iClamp > 0 ? 'el-hot' : '']]);
    const lines = [`VIL = 0.3 × VDD = ${sol.vil.toFixed(2)} V    VIH = 0.7 × VDD = ${sol.vih.toFixed(2)} V`];
    if (sol.floating) lines.push('no path to any voltage: Vpin is undefined');
    else {
      lines.push('connected to the pin: ' + sol.branches.map((b) => `${b.drv ? 'driver' : b.name} (${b.v.toFixed(1)} V via ${fmtR(+b.r.toPrecision(2))})`).join(', '));
      lines.push(`Vpin = Σ(V/R) / Σ(1/R)${sol.iClamp > 0 ? ', then clamped by the protection diode' : ''} = ${sol.v.toFixed(2)} V`);
    }
    eq.set(lines);
    // messages
    const m = [];
    if (sol.floating && st.mode === 'in') m.push(['bad', 'Floating input. The pin is a few picofarads of capacitance connected to nothing, so its voltage is whatever charge leaks or couples onto it. Reads are noise: look at the sixteen samples and press the button for more. Firmware that tests this pin behaves randomly. Enable a pull-up or pull-down.']);
    if (sol.floating && st.mode === 'od') m.push(['bad', 'An open-drain output can only pull the line low. Writing 1 just switches the N transistor off; with no pull-up, nothing takes the line high and it floats. This is exactly the fault when I2C pull-ups are missing.']);
    if (sol.weak) m.push(['warn', 'Only an unlit LED is connected. Its leakage holds the pin near one rail, but so weakly that you should not rely on the reading.']);
    if (sol.logic === 'x') m.push(['bad', `${sol.v.toFixed(2)} V lies between VIL and VIH. The chip does not promise to read this as 0 or as 1, and the input stage draws extra current while it sits there.`]);
    if (sol.contention) m.push(['bad', `Contention: the output transistor is fighting a low-resistance path to the opposite rail. Only its own ${P.rOn} Ω limits the current to ${fmtSI(Math.abs(sol.iPin), 'A')}, many times a typical ${fmtSI(PIN_LIMIT, 'A')} pin limit (check your chip's datasheet). On real hardware the pin overheats and may be permanently damaged. This is why you never configure a pin wired to a button as an output.`]);
    else if (Math.abs(sol.iPin) > PIN_LIMIT) m.push(['warn', `The driver is carrying ${fmtSI(Math.abs(sol.iPin), 'A')}, above a typical ${fmtSI(PIN_LIMIT, 'A')} pin limit (check your chip's datasheet).`]);
    if (sol.iClamp > 0) m.push(['bad', `The outside world is pushing the pin above VDD. The protection diode clamps it near ${sol.v.toFixed(1)} V and carries ${fmtSI(sol.iClamp, 'A')} into the 3.3 V rail. ${sol.iClamp > 1e-3 ? 'That much injected current can latch up or destroy the pin, and can lift the 3.3 V rail itself.' : 'Some chips tolerate a small injected current, many do not specify it; do not rely on it.'} Unless the datasheet says the pin is 5 V tolerant, use a divider or a level shifter.`]);
    if (st.mode === 'in' && !sol.floating && st.ext === 'button-gnd' && st.pull === 'up') m.push(['ok', st.pressed ? `Pressed: the button wins easily against 45 kΩ, the pin reads 0, and only ${fmtSI(P.vdd / P.rPull, 'A')} flows through the pull-up. "Active low": pressed = 0.` : 'Released: the pull-up holds the pin at VDD and it reads a steady 1.']);
    if (st.mode === 'in' && st.ext === 'button-gnd' && st.pull === 'down') m.push(['warn', 'Pull-down with a button to GND: both ends of the button are at 0 V, so pressing it changes nothing. A button to GND needs a pull-up.']);
    if (st.mode === 'in' && st.ext === 'button-vdd' && st.pull === 'up') m.push(['warn', 'Pull-up with a button to VDD: pressing it changes nothing. A button to VDD needs a pull-down.']);
    if (st.mode === 'od' && st.level === 1 && sol.logic === 1 && !sol.iClamp) m.push(['ok', 'Released, and the pull-up takes the line high. The rising edge is slow (pull-up resistance × line capacitance), which is what limits open-drain bus speed. Any device on the line can pull it low without a fight: that is why shared buses use open-drain.']);
    if (st.mode === 'od' && st.level === 0 && !sol.floating) m.push(['', `The N transistor pulls the line to ${sol.v.toFixed(2)} V, sinking ${fmtSI(Math.abs(sol.iPin), 'A')}.`]);
    if (sol.ledOn && !sol.contention) m.push(['', `LED lit at ${fmtSI(sol.iLed, 'A')}. ${st.ext === 'led-vdd' ? 'Here the pin sinks current: the LED is on when firmware writes 0 ("active low").' : 'Here the pin sources current: the LED is on when firmware writes 1.'}`]);
    if (!m.length) m.push(['', stable ? `Stable: the pin reads ${sol.logic}.` : '']);
    msg.set(m.filter((x) => x[1]));
    // checklist
    for (const id of experimentsHit(cfg, sol)) st.done.add(id);
    clear(list).append(...Object.entries(EXPERIMENTS).map(([id, e]) => h('li', { class: st.done.has(id) ? 'done' : '' }, e.title + (st.done.has(id) ? ' — seen' : ''))));
    if (!st.completed && st.done.size === Object.keys(EXPERIMENTS).length) { st.completed = true; ctx.complete?.(); list.append(h('li', { class: 'done' }, 'All six reproduced.')); }
  }
  render();
}
