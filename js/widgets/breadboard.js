// Virtual breadboard: place parts hole by hole, configure MCU pins, and let the DC solver show what happens.
import { h, s, clear, fmtSI } from '../core/dom.js';
import { solve, ledBrightness, LED_VF, DEFAULTS } from '../sim/circuit.js';

// ---------------------------------------------------------------------------------------------------------------
// Board model (pure, tested under node)
// ---------------------------------------------------------------------------------------------------------------
export const ROWS = 17;
export const HEADER = ['3V3', 'GND', 'IO0', 'IO1', 'IO2', 'IO3', 'GND2', '5V'];
export const GPIOS = ['IO0', 'IO1', 'IO2', 'IO3'];
const COLS = ['L+', 'L-', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'R+', 'R-'];
export const RESISTORS = [47, 100, 220, 330, 470, 680, 1000, 2200, 3300, 4700, 6800, 10000, 22000, 47000, 100000];
export const LED_COLOURS = ['red', 'yellow', 'green', 'blue'];
export const PIN_MODES = { 'out-high': 'Output HIGH', 'out-low': 'Output LOW', input: 'Input (no pull)', 'input-pullup': 'Input, pull-up', 'input-pulldown': 'Input, pull-down', analog: 'Analog input (ADC)' };
const LEGS = { resistor: ['leg 1', 'leg 2'], led: ['anode (long leg, +)', 'cathode (short leg, −)'], button: ['contact 1', 'contact 2'], wire: ['end 1', 'end 2'], pot: ['end A', 'wiper (middle leg)', 'end B'] };
const PREFIX = { resistor: 'R', led: 'LED', button: 'SW', wire: 'W', pot: 'POT' };

/** Parse a hole id: header pin ('IO0'), rail hole ('L+4') or strip hole ('c12'). Returns null if invalid. */
export function parseHole(id) {
  if (HEADER.includes(id)) return { kind: 'header', pin: id };
  let m = /^([LR])([+-])(\d+)$/.exec(id);
  if (m && +m[3] >= 1 && +m[3] <= ROWS) return { kind: 'rail', side: m[1], pol: m[2], row: +m[3] };
  m = /^([a-j])(\d+)$/.exec(id);
  if (m && +m[2] >= 1 && +m[2] <= ROWS) return { kind: 'strip', col: m[1], row: +m[2], side: m[1] <= 'e' ? 'L' : 'R' };
  return null;
}

/** The electrical node a hole belongs to. This function *is* the breadboard's internal wiring. */
export function holeNode(id) {
  const p = parseHole(id);
  if (!p) throw new Error('breadboard: no such hole ' + id);
  if (p.kind === 'header') return p.pin === 'GND2' ? 'GND' : p.pin;
  if (p.kind === 'rail') return p.side + p.pol;           // each rail is one strip, full length; left and right are separate
  return 'row' + p.row + p.side;                           // a–e joined, f–j joined, nothing across the centre gap
}

export function describeNode(node) {
  if (node === 'GND') return 'GND';
  if (node === '3V3' || node === '5V') return 'the ' + node + ' pin';
  if (GPIOS.includes(node)) return 'pin ' + node;
  let m = /^([LR])([+-])$/.exec(node);
  if (m) return `the ${m[1] === 'L' ? 'left' : 'right'} ${m[2] === '+' ? '+' : '−'} rail`;
  m = /^row(\d+)([LR])$/.exec(node);
  if (m) return `row ${m[1]} (${m[2] === 'L' ? 'a–e' : 'f–j'})`;
  return node;
}

export function newState() {
  return { parts: [], pins: { IO0: 'out-high', IO1: 'input', IO2: 'input', IO3: 'input' } };
}

export function partLabel(p) {
  if (p.type === 'resistor') return `${p.id} ${fmtSI(p.r, 'Ω')}`;
  if (p.type === 'led') return `${p.id} (${p.color})`;
  if (p.type === 'pot') return `${p.id} ${fmtSI(p.r, 'Ω')}`;
  return p.id;
}

/** Add a part. Returns { ok, part } or { ok:false, error }. A hole takes one leg, as on a real board. */
export function addPart(state, type, holes, opts = {}) {
  const need = LEGS[type]?.length;
  if (!need) return { ok: false, error: 'Unknown part type.' };
  if (holes.length !== need || holes.some((x) => !parseHole(x))) return { ok: false, error: 'That part needs ' + need + ' holes.' };
  if (new Set(holes).size !== holes.length) return { ok: false, error: 'Each leg needs its own hole.' };
  const used = occupied(state);
  const clash = holes.find((x) => used.has(x));
  if (clash) return { ok: false, error: `Hole ${clash} already has a leg in it. A hole takes one leg; use another hole in the same strip.` };
  let n = 1; while (state.parts.some((p) => p.id === PREFIX[type] + n)) n++;
  const part = { id: PREFIX[type] + n, type, holes: [...holes] };
  if (type === 'resistor') part.r = opts.r ?? 220;
  if (type === 'led') part.color = opts.color ?? 'red';
  if (type === 'button') part.pressed = !!opts.pressed;
  if (type === 'pot') { part.r = opts.r ?? 10000; part.pos = opts.pos ?? 0.5; }
  state.parts.push(part);
  return { ok: true, part };
}

export function occupied(state) {
  const m = new Map();
  for (const p of state.parts) p.holes.forEach((x, i) => m.set(x, { part: p, leg: i }));
  return m;
}

/** Translate the board into a circuit for the solver. `over` can force pin modes or button states. */
export function buildCircuit(state, over = {}) {
  const components = [
    { id: 'V3V3', type: 'vsource', p: '3V3', n: 'GND', v: 3.3 },
    { id: 'V5V', type: 'vsource', p: '5V', n: 'GND', v: 5 },
  ];
  const usedNodes = new Set();
  for (const p of state.parts) {
    const n = p.holes.map(holeNode); n.forEach((x) => usedNodes.add(x));
    if (p.type === 'resistor') components.push({ id: p.id, type: 'resistor', a: n[0], b: n[1], r: p.r });
    else if (p.type === 'wire') components.push({ id: p.id, type: 'wire', a: n[0], b: n[1] });
    else if (p.type === 'led') components.push({ id: p.id, type: 'led', a: n[0], k: n[1], color: p.color });
    else if (p.type === 'button') components.push({ id: p.id, type: 'switch', a: n[0], b: n[1], closed: over.pressed ? !!over.pressed[p.id] : !!p.pressed });
    else if (p.type === 'pot') components.push({ id: p.id, type: 'pot', a: n[0], w: n[1], b: n[2], r: p.r, pos: p.pos });
  }
  for (const g of GPIOS) if (usedNodes.has(g)) components.push({ id: g, type: 'pin', node: g, mode: over.pinMode ?? state.pins[g] });
  return { ground: 'GND', components };
}

const mA = (i) => fmtSI(Math.abs(i), 'A');
const volts = (v) => (v == null ? 'floating' : (Math.abs(v) < 0.0005 ? 0 : v).toFixed(2) + ' V');

/** Turn one solver diagnostic into a plain-language explanation of what is wrong and why. */
export function explain(d, state, result) {
  const part = state.parts.find((p) => p.id === d.component);
  const name = part ? partLabel(part) : d.component;
  const railHint = (node) => (/^[LR][+-]$/.test(node) ? ' A power rail is only a long strip of metal: it carries 3V3 or GND only if you wire it to that header pin, and the left and right rails are not joined to each other.' : '');
  const gapHint = (node) => { const m = /^row(\d+)([LR])$/.exec(node || ''); if (!m) return ''; const other = 'row' + m[1] + (m[2] === 'L' ? 'R' : 'L'); return state.parts.some((p) => p.holes.some((x) => holeNode(x) === other)) ? ` The centre gap splits row ${m[1]}: holes a–e are not connected to holes f–j.` : ''; };
  switch (d.code) {
    case 'shorted-part':
      if (part?.type === 'wire') return { severity: 'warn', parts: [d.component], text: `Both ends of ${name} are in ${describeNode(d.node)}, which is already one piece of metal, so the wire does nothing.` };
      return { severity: 'error', parts: [d.component], text: `Both legs of ${name} are in ${describeNode(d.node)}. Those holes are joined by one metal strip inside the board, so the part is shorted out: both legs sit at the same voltage and no current flows through it. Move one leg to a different row.` };
    case 'dangling': {
      const hole = part?.holes[d.term];
      return { severity: 'warn', parts: [d.component], text: `The ${LEGS[part.type][d.term].replace(/ \(.*/, '')} of ${name} in hole ${hole} is alone in ${describeNode(d.node)}: nothing else is plugged into that strip, so the circuit is open there and no current can flow that way.${railHint(d.node)}${gapHint(d.node)}` };
    }
    case 'floating-node':
      return { severity: 'warn', parts: [], text: `${cap(d.nodes.map(describeNode).join(', '))} ${d.nodes.length > 1 ? 'have' : 'has'} no path to GND or to a supply, so the voltage there is undefined ("floating").${railHint(d.nodes.find((x) => /^[LR]/.test(x)) || '')}` };
    case 'floating-input': {
      const btn = state.parts.find((p) => p.type === 'button' && p.holes.some((x) => result.floating.includes(holeNode(x)) || holeNode(x) === d.node));
      return { severity: 'error', parts: [d.component], text: `${d.component} is an input with nothing driving it${btn ? ` while ${btn.id} is released` : ''}: there is no path from the pin to 3V3 or GND, so it floats, picks up stray charge and reads 0 or 1 unpredictably. Give it a pull-up or pull-down so it has a defined level when nothing else drives it.` };
    }
    case 'short-circuit':
      return { severity: 'error', parts: [], text: `The ${d.component === 'V5V' ? '5V' : '3V3'} supply is connected to GND through almost no resistance (this ideal model computes ${fmtSI(Math.abs(d.i), 'A')}). On a real board the regulator would current-limit, overheat or shut down and the MCU would reset. Look for a wire, a pressed button or a pot turned to one end that joins a supply directly to GND.` };
    case 'over-power':
      return { severity: 'error', parts: [d.component], text: `${name} is dissipating ${fmtSI(d.p, 'W')}, more than its ${fmtSI(d.rating, 'W')} rating (P = V × I). It would overheat. Use a larger resistance so less current flows.` };
    case 'over-current':
      return { severity: 'error', parts: [d.component], text: `${name} carries ${mA(d.i)}, above the ${mA(d.limit)} typical maximum for an indicator LED. An LED does not limit its own current; only the resistance in series with it does. Add a series resistor or increase it.` };
    case 'led-reversed':
      return { severity: 'error', parts: [d.component], text: `${name} is reverse-biased: its anode (hole ${part.holes[0]}) is ${Math.abs(d.v).toFixed(2)} V below its cathode (hole ${part.holes[1]}). A diode blocks in that direction, so no current flows and it stays dark. Flip it so the anode faces the higher voltage.` };
    case 'pin-overcurrent':
      return { severity: 'error', parts: [d.component], text: `${d.component} is ${d.direction === 'source' ? 'sourcing' : 'sinking'} ${mA(d.i)}, above the ${mA(d.limit)} this model treats as the safe per-pin limit (a typical figure; check your chip's datasheet). An overloaded pin cannot hold its output voltage and its driver can be damaged.` };
    case 'input-undefined':
      return { severity: 'warn', parts: [d.component], text: `${d.component} sees ${d.v.toFixed(2)} V, between the "reads 0" threshold (${d.low.toFixed(2)} V) and the "reads 1" threshold (${d.high.toFixed(2)} V). A digital input in that region is undefined: it may read either value and can draw extra supply current. If you want to measure this voltage, set the pin to Analog input.` };
    case 'input-overvoltage':
      return { severity: 'error', parts: [d.component], text: `${d.component} sees ${d.v.toFixed(2)} V, outside the MCU's 0–3.3 V supply range. On a real chip that forces current through the pin's protection structure and can destroy the pin. Never connect a 3.3 V GPIO to 5 V without level shifting.` };
    case 'no-convergence': return { severity: 'warn', parts: [], text: 'The solver could not settle on which diodes conduct; readings may be unreliable.' };
    default: return { severity: 'error', parts: [], text: 'The circuit could not be solved (' + d.code + ').' };
  }
}
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

/** Solve the board and explain every problem. Returns { circuit, result, problems }. */
export function analyse(state, over = {}) {
  const circuit = buildCircuit(state, over);
  const result = solve(circuit);
  const specific = new Set();
  for (const d of result.diagnostics) if (d.code === 'dangling' || d.code === 'floating-input') specific.add(d.node);
  const problems = [];
  for (const d of result.diagnostics) {
    if (d.code === 'floating-node' && d.nodes.some((n) => specific.has(n))) continue; // a more specific message covers it
    problems.push({ code: d.code, ...explain(d, state, result) });
  }
  problems.sort((a, b) => (a.severity === 'error' ? 0 : 1) - (b.severity === 'error' ? 0 : 1));
  return { circuit, result, problems };
}

// ---------------------------------------------------------------------------------------------------------------
// Challenges
// ---------------------------------------------------------------------------------------------------------------
const noPress = (state) => Object.fromEntries(state.parts.filter((p) => p.type === 'button').map((p) => [p.id, false]));

function ledVerdict(state, a, led) {
  const r = a.result.components[led.id], own = a.problems.find((p) => p.parts.includes(led.id));
  if (r.i < 5e-5) {
    if (own) return `${led.id} is dark. ${own.text}`;
    if (a.problems.length) return `${led.id} is dark. ${a.problems[0].text}`;
    if (!GPIOS.some((g) => a.result.components[g]?.mode === 'out-high')) return `${led.id} is dark: no connected GPIO is set to Output HIGH, so nothing pushes current through it.`;
    return `${led.id} is dark: it has ${r.v.toFixed(2)} V across it, below the ${r.vf.toFixed(1)} V a ${led.color} LED needs before it conducts. Trace the loop from the pin, through the resistor and LED, back to GND.`;
  }
  if (r.i > 0.015) return `${led.id} carries ${mA(r.i)}, above the 15 mA target. The current is set by what is left after the LED's forward voltage: I = (3.3 V − ${r.vf.toFixed(1)} V) ÷ R. Use a larger series resistor.`;
  if (r.i < 0.002) return `${led.id} carries only ${mA(r.i)}, so it would be dim; the target is at least 2 mA. A ${led.color} LED needs about ${r.vf.toFixed(1)} V, which leaves ${(3.3 - r.vf).toFixed(1)} V across the resistor. Use a smaller resistor.`;
  return null;
}

export const CHALLENGES = {
  led: {
    title: 'Light an LED from a GPIO',
    goal: 'Wire an LED so that pin IO0 controls it. Target: 2–15 mA through the LED with IO0 set to Output HIGH, and no problems reported. You need a complete loop: pin → resistor → LED → GND.',
    check(state) {
      const a = analyse(state), leds = state.parts.filter((p) => p.type === 'led');
      if (!leds.length) return { ok: false, msg: 'There is no LED on the board yet. Pick LED from the palette and click two holes.' };
      const best = leds.slice().sort((x, y) => a.result.components[y.id].i - a.result.components[x.id].i)[0];
      const v = ledVerdict(state, a, best);
      if (v) return { ok: false, msg: v };
      const off = analyse(state, { pinMode: 'input' });
      if (off.result.components[best.id].i > 1e-4) return { ok: false, msg: `${best.id} is lit, but not by a GPIO: it stays on even when every pin is switched to input, so firmware could never turn it off. Feed it from an IO pin instead of a supply rail.` };
      if (a.problems.length) return { ok: false, msg: `${best.id} is lit with ${mA(a.result.components[best.id].i)}, but something is still wrong. ${a.problems[0].text}` };
      const r = a.result.components[best.id];
      return { ok: true, msg: `${best.id} carries ${mA(r.i)} with ${r.v.toFixed(2)} V across it. The rest of the 3.3 V is dropped by the series resistor and the pin's own output resistance, and that is what sets the current.` };
    },
  },
  'button-pullup': {
    title: 'Read a button with a pull-up',
    goal: 'Wire a push button to a GPIO so the pin reads 1 when the button is released and 0 when it is pressed, using the pin\'s internal pull-up. Configure the pin mode yourself.',
    check(state) {
      const buttons = state.parts.filter((p) => p.type === 'button');
      if (!buttons.length) return { ok: false, msg: 'There is no button on the board yet.' };
      const rel = analyse(state, { pressed: noPress(state) });
      const pins = GPIOS.filter((g) => rel.result.components[g] && !state.pins[g].startsWith('out'));
      if (!pins.length) return { ok: false, msg: 'No input pin is connected. Run a wire from an IO pin (set to an input mode) to one side of the button.' };
      let fallback = null;
      for (const g of pins) for (const b of buttons) {
        const prs = analyse(state, { pressed: { ...noPress(state), [b.id]: true } });
        const lr = rel.result.components[g].level, lp = prs.result.components[g].level;
        if (lr === 'high' && lp === 'low') {
          const bad = [...rel.problems, ...prs.problems].find((p) => p.severity === 'error');
          if (bad) { fallback = `${g} changes level, but there is a fault. ${bad.text}`; continue; }
          if (state.pins[g] !== 'input-pullup') { fallback = `${g} does read 1 then 0, but not because of its internal pull-up (its mode is "${PIN_MODES[state.pins[g]]}"). Set it to "Input, pull-up" and remove what you used instead.`; continue; }
          return { ok: true, msg: `Released: the ~45 kΩ pull-up holds ${g} at ${volts(rel.result.components[g].v)}, read as 1. Pressed: ${b.id} connects the pin to GND, which wins easily against 45 kΩ, so it reads 0 while only ${fmtSI(Math.abs(prs.result.components[g].i), 'A')} flows.` };
        }
        if (fallback) continue;
        if (lr === 'floating') fallback = `With the button released, ${g} is connected to nothing at all: it floats and firmware would read random values. That is the job of a pull-up: set ${g} to "Input, pull-up".`;
        else if (lr === 'high' && lp === 'high') {
          const other = b.holes.map(holeNode).map((n) => prs.result.nodes[n]);
          fallback = other.every((v) => v != null && v > 3) && b.holes.some((x) => holeNode(x) !== g)
            ? `${g} reads 1 whether or not ${b.id} is pressed. Check where the button's other contact goes: pressing it must connect the pin to GND (0 V), not to 3V3, which is the level the pull-up already gives.`
            : `${g} reads 1 whether or not ${b.id} is pressed.`;
          const own = prs.problems.find((p) => p.parts.includes(b.id)) || prs.problems[0];
          if (own) fallback += ' ' + own.text;
        } else if (lr === 'low') fallback = `${g} reads 0 with the button released, so there is no "1" state to tell apart. ${state.pins[g] === 'input-pulldown' ? 'A pull-down holds the pin low; this task needs the pull-up.' : 'Something is holding the pin at GND all the time.'}`;
        else fallback = `Released, ${g} sits at ${volts(rel.result.components[g].v)}, which is not a clean logic level.`;
      }
      return { ok: false, msg: fallback || 'The button does not change what the pin reads.' };
    },
  },
  divider: {
    title: 'Build a voltage divider for an ADC pin',
    goal: 'An ADC pin should see 1.10 V (±5 %) derived from the 3V3 rail. Build the divider, connect its midpoint to a GPIO set to "Analog input (ADC)", and keep the current taken from 3V3 below 1 mA.',
    check(state) {
      const a = analyse(state), pins = GPIOS.filter((g) => a.result.components[g] && state.pins[g] === 'analog');
      if (!pins.length) return { ok: false, msg: 'No connected pin is set to "Analog input (ADC)". Connect the midpoint of your divider to an IO pin and set that mode.' };
      const g = pins.find((p) => a.result.components[p].v != null) ?? pins[0], v = a.result.components[g].v;
      if (v == null) return { ok: false, msg: a.problems.find((p) => p.parts.includes(g))?.text || `${g} is floating.` };
      const isup = Math.abs(a.result.components.V3V3.i);
      if (Math.abs(v - 1.1) > 0.055) {
        if (v > 3.2) return { ok: false, msg: `${g} sees ${v.toFixed(2)} V: the full rail. No current flows through the top resistor, so it drops nothing (V = I × R with I = 0). A divider needs a second resistor from the midpoint to GND.` };
        if (v < 0.05) return { ok: false, msg: `${g} sees ${v.toFixed(2)} V. The midpoint is tied to GND or has no path from 3V3. A divider needs a resistor from 3V3 to the midpoint as well as one from the midpoint to GND.` };
        return { ok: false, msg: `${g} sees ${v.toFixed(2)} V; the target is 1.10 V ± 0.055 V. Vout = 3.3 V × R2 ÷ (R1 + R2), so you need R2 ÷ (R1 + R2) ≈ 1/3: the top resistor about twice the bottom one.` };
      }
      if (isup > 0.001) return { ok: false, msg: `The voltage is right (${v.toFixed(2)} V) but the divider takes ${mA(isup)} from 3V3; the limit is 1 mA. Multiply both resistors by the same factor: the ratio, and so the voltage, stays the same while the current falls.` };
      if (a.problems.length) return { ok: false, msg: `The voltage is right (${v.toFixed(2)} V), but: ${a.problems[0].text}` };
      return { ok: true, msg: `${g} sees ${v.toFixed(3)} V and the divider draws ${mA(isup)}. This only holds while whatever is connected to the midpoint draws almost no current; a load there would pull the voltage down.` };
    },
  },
  'two-leds': {
    title: 'Two LEDs of different colours',
    goal: 'Light two LEDs of different colours from GPIO pins, each carrying 2–15 mA, with no problems reported. Decide for yourself whether they can share a resistor.',
    check(state) {
      const a = analyse(state), leds = state.parts.filter((p) => p.type === 'led');
      if (leds.length < 2) return { ok: false, msg: `The task needs two LEDs; the board has ${leds.length}.` };
      if (new Set(leds.map((l) => l.color)).size < 2) return { ok: false, msg: 'Both LEDs are the same colour. Use two different colours: their forward voltages differ, and that is the point of the task.' };
      const R = a.result.components;
      for (const x of leds) for (const y of leds) {
        if (x === y || x.color === y.color) continue;
        const nx = x.holes.map(holeNode), ny = y.holes.map(holeNode);
        if (nx[0] === ny[0] && nx[1] === ny[1] && R[x.id].i > 1e-4 && R[y.id].i < 1e-4)
          return { ok: false, msg: `${x.id} and ${y.id} are directly in parallel and share one resistor. The ${x.color} LED conducts at about ${R[x.id].vf.toFixed(1)} V and holds the shared node at ${R[x.id].v.toFixed(2)} V, which is below the ${R[y.id].vf.toFixed(1)} V the ${y.color} LED needs, so ${y.id} gets no current at all. Give each LED its own series resistor.` };
      }
      const lit = leds.filter((l) => !ledVerdict(state, a, l));
      if (lit.length < 2 || new Set(lit.map((l) => l.color)).size < 2) {
        const bad = leds.find((l) => ledVerdict(state, a, l) && !lit.some((k) => k.color === l.color)) || leds.find((l) => ledVerdict(state, a, l));
        return { ok: false, msg: ledVerdict(state, a, bad) };
      }
      const off = analyse(state, { pinMode: 'input' });
      const stuck = lit.find((l) => off.result.components[l.id].i > 1e-4);
      if (stuck) return { ok: false, msg: `${stuck.id} is fed from a supply rail rather than a GPIO, so firmware could not switch it off.` };
      if (a.problems.length) return { ok: false, msg: `Both LEDs are lit, but: ${a.problems[0].text}` };
      return { ok: true, msg: `${lit.map((l) => `${l.id} (${l.color}) ${mA(R[l.id].i)}`).join(', ')}. Each LED has its own resistor, so each current is set by its own forward voltage: I = (3.3 V − Vf) ÷ R.` };
    },
  },
  free: {
    title: 'Free build',
    goal: 'Build anything. The simulator solves the circuit after every change and explains any problem it finds.',
    check(state) {
      const a = analyse(state);
      if (!state.parts.length) return { ok: false, msg: 'The board is empty.' };
      if (a.problems.length) return { ok: false, msg: a.problems[0].text };
      const live = state.parts.some((p) => Math.abs(a.result.components[p.id].i) > 1e-4);
      return live ? { ok: true, msg: 'Current is flowing and the simulator sees no problems.' } : { ok: false, msg: 'No current flows anywhere yet. Current needs a complete loop from a supply or an output pin back to GND.' };
    },
  },
};

const build = (list, pins) => { const st = newState(); Object.assign(st.pins, pins || {}); for (const [t, holes, o] of list) addPart(st, t, holes, o); return st; };
export const BROKEN = [
  { title: 'LED never lights (A)', symptom: 'IO0 is driven HIGH and current flows from the pin, yet the LED stays dark.', make: () => build([['wire', ['IO0', 'a5']], ['led', ['c5', 'd5']], ['resistor', ['e5', 'L-5'], { r: 330 }], ['wire', ['GND', 'L-1']]]) },
  { title: 'LED never lights (B)', symptom: 'IO0 is driven HIGH, the wiring looks complete, but the LED is dark and no current flows.', make: () => build([['wire', ['IO0', 'a3']], ['resistor', ['b3', 'b8'], { r: 220 }], ['led', ['L-8', 'c8']], ['wire', ['GND', 'L-1']]]) },
  { title: 'LED never lights (C)', symptom: 'The LED is the right way round and has a resistor, but it is dark.', make: () => build([['wire', ['IO0', 'a3']], ['resistor', ['b3', 'b8'], { r: 220 }], ['led', ['e8', 'R-8']], ['wire', ['GND', 'L-1']]]) },
  { title: 'LED never lights (D)', symptom: 'Everything seems to be in row 5 and row 9, but nothing happens.', make: () => build([['wire', ['IO0', 'a5']], ['resistor', ['j5', 'j9'], { r: 220 }], ['led', ['g9', 'R-9']], ['wire', ['GND2', 'R-1']]]) },
  { title: 'LED is very bright', symptom: 'The LED lights, brighter than expected, and the pin feels the strain.', make: () => build([['wire', ['IO0', 'a3']], ['led', ['b3', 'L-4']], ['wire', ['GND', 'L-1']]]) },
  { title: 'Button reads random values', symptom: 'Firmware reads IO1. Pressed gives 0, but released gives 0 or 1 at random.', make: () => build([['wire', ['IO1', 'a10']], ['button', ['b10', 'b12']], ['wire', ['a12', 'L-12']], ['wire', ['GND', 'L-1']]], { IO1: 'input' }) },
];

// ---------------------------------------------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------------------------------------------
const P = 20, W = 340, H = 440, ROW0 = 100, HEADER_Y = 36;
const COLX = { 'L+': 18, 'L-': 38, a: 70, b: 90, c: 110, d: 130, e: 150, f: 190, g: 210, h: 230, i: 250, j: 270, 'R+': 302, 'R-': 322 };
export function holeXY(id) {
  const p = parseHole(id);
  if (p.kind === 'header') return [30 + HEADER.indexOf(id) * 40, HEADER_Y];
  const y = ROW0 + (p.row - 1) * P;
  return [p.kind === 'rail' ? COLX[p.side + p.pol] : COLX[p.col], y];
}
const holeAt = (col, row) => (col.length === 2 ? col + row : col + row);
const LED_FILL = { red: 'var(--sig2)', yellow: 'var(--warn)', green: 'var(--sig3)', blue: 'var(--sig1)' };
const TOOLS = [['inspect', 'Inspect'], ['wire', 'Wire'], ['resistor', 'Resistor'], ['led', 'LED'], ['button', 'Button'], ['pot', 'Potentiometer']];

export default function mount(el, props = {}, ctx) {
  let state = newState();
  let tool = 'inspect', pending = [], showInternal = true, revealed = true, brokenIdx = -1;
  let rValue = 220, ledColour = 'red';
  let challengeId = CHALLENGES[props.challenge] ? props.challenge : 'free';
  let a = analyse(state), focusHole = '3V3', lastInspect = null;

  clear(el); el.classList.add('breadboard');
  const taskBox = h('div', { class: 'w-task' });
  const feedback = h('div', { class: 'w-msg', hidden: true, role: 'status' });
  const palette = h('div', { class: 'w-tabs breadboard-palette', role: 'toolbar', 'aria-label': 'Parts palette' });
  const options = h('div', { class: 'row breadboard-options' });
  const status = h('p', { class: 'breadboard-status', role: 'status', 'aria-live': 'polite' });
  const svg = s('svg', { class: 'w-svg breadboard-svg', viewBox: `0 0 ${W} ${H}`, role: 'group', 'aria-label': 'Breadboard. Arrow keys move between holes, Enter or Space selects a hole.' });
  const readout = h('p', { class: 'breadboard-readout w-mono', 'aria-live': 'polite' });
  const pinsBox = h('div', { class: 'breadboard-pins' });
  const partsBox = h('div', { class: 'breadboard-parts' });
  const problemsBox = h('div', { class: 'breadboard-problems', 'aria-live': 'polite' });
  const pinRead = {}, partRead = {};
  const holeEls = new Map();

  // ---- task -------------------------------------------------------------------------------------------------
  function drawTask() {
    const c = CHALLENGES[challengeId];
    clear(taskBox);
    taskBox.append(h('p', {}, h('strong', {}, c.title + '. '), c.goal));
    const row = h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn small', 'data-act': 'check', onclick: check }, 'Check my circuit'));
    if (!props.challenge) row.append(h('label', { class: 'breadboard-pick' }, 'Task ', h('select', { 'aria-label': 'Choose a task', onchange: (e) => { challengeId = e.target.value; feedback.hidden = true; drawTask(); } },
      Object.entries(CHALLENGES).map(([k, v]) => h('option', { value: k, selected: k === challengeId }, v.title)))));
    if (ctx?.isDone?.()) row.append(h('span', { class: 'w-note' }, 'Solved before.'));
    taskBox.append(row);
  }
  function check() {
    const r = CHALLENGES[challengeId].check(state);
    feedback.hidden = false; feedback.className = 'w-msg ' + (r.ok ? 'ok' : 'bad');
    feedback.textContent = (r.ok ? 'Solved. ' : 'Not yet. ') + r.msg;
    if (r.ok) ctx?.complete?.();
  }

  // ---- palette ----------------------------------------------------------------------------------------------
  function drawPalette() {
    clear(palette);
    for (const [k, label] of TOOLS) palette.append(h('button', { type: 'button', class: 'w-tab' + (tool === k ? ' on' : ''), 'aria-pressed': String(tool === k), 'data-tool': k, onclick: () => { tool = k; pending = []; drawPalette(); drawBoard(); } }, label));
    clear(options);
    if (tool === 'resistor') options.append(h('label', {}, 'Value ', h('select', { 'data-opt': 'r', onchange: (e) => { rValue = +e.target.value; } }, RESISTORS.map((r) => h('option', { value: r, selected: r === rValue }, fmtSI(r, 'Ω'))))));
    if (tool === 'led') options.append(h('label', {}, 'Colour ', h('select', { 'data-opt': 'colour', onchange: (e) => { ledColour = e.target.value; } }, LED_COLOURS.map((c) => h('option', { value: c, selected: c === ledColour }, `${c} (≈${LED_VF[c].toFixed(1)} V)`)))));
    setStatus();
  }
  function setStatus(msg) {
    if (msg) { status.textContent = msg; return; }
    if (tool === 'inspect') status.textContent = 'Inspect: point at, focus or tap a hole to read its voltage. Pick a part above to place one.';
    else status.textContent = `${TOOLS.find((t) => t[0] === tool)[1]}: choose the hole for ${LEGS[tool][pending.length]}` + (pending.length ? ` (${pending.join(', ')} chosen; Esc cancels).` : '.');
  }

  // ---- board ------------------------------------------------------------------------------------------------
  function holeClick(id) {
    focusHole = id;
    if (tool === 'inspect') { inspect(id); return; }
    if (occupied(state).has(id) || pending.includes(id)) { setStatus(`Hole ${id} already has a leg in it. A hole takes one leg; use another hole in the same strip.`); return; }
    pending.push(id);
    if (pending.length < LEGS[tool].length) { setStatus(); drawBoard(); return; }
    const r = addPart(state, tool, pending, { r: rValue, color: ledColour });
    pending = [];
    if (!r.ok) { setStatus(r.error); drawBoard(); return; }
    refresh(true);
    setStatus(`${partLabel(r.part)} placed at ${r.part.holes.join(' – ')}. Choose the next hole to place another, or pick Inspect.`);
  }
  function moveFocus(id, key) {
    const p = parseHole(id); let next = null;
    if (p.kind === 'header') {
      const i = HEADER.indexOf(id);
      if (key === 'ArrowLeft' && i > 0) next = HEADER[i - 1];
      if (key === 'ArrowRight' && i < HEADER.length - 1) next = HEADER[i + 1];
      if (key === 'ArrowDown') next = holeAt(COLS[Math.round(i * (COLS.length - 1) / (HEADER.length - 1))], 1);
    } else {
      const col = p.kind === 'rail' ? p.side + p.pol : p.col, ci = COLS.indexOf(col);
      if (key === 'ArrowLeft' && ci > 0) next = holeAt(COLS[ci - 1], p.row);
      if (key === 'ArrowRight' && ci < COLS.length - 1) next = holeAt(COLS[ci + 1], p.row);
      if (key === 'ArrowDown' && p.row < ROWS) next = holeAt(col, p.row + 1);
      if (key === 'ArrowUp') next = p.row > 1 ? holeAt(col, p.row - 1) : HEADER[Math.round(ci * (HEADER.length - 1) / (COLS.length - 1))];
    }
    if (!next) return;
    holeEls.get(focusHole)?.setAttribute('tabindex', '-1');
    focusHole = next; const e = holeEls.get(next); e.setAttribute('tabindex', '0'); e.focus();
  }
  function inspect(id) {
    lastInspect = id;
    const node = holeNode(id), v = a.result.nodes[node], here = [];
    for (const p of state.parts) p.holes.forEach((x, i) => { if (holeNode(x) === node) here.push(`${p.id} ${LEGS[p.type][i].replace(/ \(.*/, '')}`); });
    let t = `Hole ${id} · ${describeNode(node)}: `;
    if (node === 'GND') t += '0.00 V (reference)';
    else if (v === undefined) t += 'nothing connected';
    else t += volts(v);
    const pr = a.result.components[node];
    if (pr?.type === 'pin') t += ` · ${PIN_MODES[state.pins[node]]}`;
    if (here.length) t += ' · here: ' + here.join(', ');
    readout.textContent = t;
    for (const [hid, e] of holeEls) e.classList.toggle('same', holeNode(hid) === node);
  }
  function resetInspect() { lastInspect = null; readout.textContent = ''; }
  function mkHole(id) {
    const [x, y] = holeXY(id), p = parseHole(id), occ = occupied(state).get(id);
    const label = (p.kind === 'header' ? `Header pin ${id === 'GND2' ? 'GND' : id}` : p.kind === 'rail' ? `${p.side === 'L' ? 'Left' : 'Right'} ${p.pol === '+' ? 'plus' : 'minus'} rail, row ${p.row}` : `Hole ${id}`) + (occ ? `, holds ${occ.part.id} ${LEGS[occ.part.type][occ.leg]}` : ', empty');
    const g = s('g', { class: 'hole' + (p.kind === 'header' ? ' hdr' : '') + (pending.includes(id) ? ' pending' : '') + (occ ? ' used' : ''), role: 'button', tabindex: id === focusHole ? 0 : -1, 'aria-label': label, 'data-hole': id,
      onclick: () => holeClick(id), onmouseenter: () => inspect(id), onfocus: () => { focusHole = id; inspect(id); },
      onkeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); holeClick(id); }
        else if (e.key.startsWith('Arrow')) { e.preventDefault(); moveFocus(id, e.key); }
        else if (e.key === 'Escape' && pending.length) { pending = []; setStatus(); drawBoard(); }
      } },
      s('rect', { class: 'hit', x: x - P / 2, y: y - P / 2, width: P, height: P }),
      s('rect', { class: 'pit', x: x - 3.5, y: y - 3.5, width: 7, height: 7, rx: 1.5 }));
    holeEls.set(id, g);
    return g;
  }
  function wireColour(p) {
    const n = p.holes.map(holeNode);
    if (n.some((x) => x === '3V3' || x === '5V' || /\+$/.test(x))) return 'var(--sig2)';
    if (n.some((x) => x === 'GND' || /^[LR]-$/.test(x))) return 'var(--ink)';
    return ['var(--sig5)', 'var(--sig4)', 'var(--sig3)', 'var(--sig1)'][(+p.id.slice(1)) % 4];
  }
  function drawPart(p) {
    const pts = p.holes.map(holeXY), r = a.result.components[p.id] || {};
    const g = s('g', { class: 'part part-' + p.type + (tool === 'inspect' ? ' live' : ''), 'data-part': p.id });
    const mx = pts.reduce((t, q) => t + q[0], 0) / pts.length, my = pts.reduce((t, q) => t + q[1], 0) / pts.length;
    const [x1, y1] = pts[0], [x2, y2] = pts[pts.length - 1];
    const ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI, len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const nx = -(y2 - y1) / len, ny = (x2 - x1) / len;
    if (p.type === 'wire') {
      const bow = Math.min(26, 6 + len * 0.12);
      g.append(s('path', { class: 'wire', d: `M${x1} ${y1} Q${mx + nx * bow} ${my + ny * bow} ${x2} ${y2}`, stroke: wireColour(p) }));
    } else if (p.type === 'pot') {
      const bx = mx + 14, by = my;
      for (const q of pts) g.append(s('line', { class: 'leg', x1: q[0], y1: q[1], x2: bx, y2: by }));
      const th = (-135 + 270 * p.pos) * Math.PI / 180;
      g.append(s('circle', { class: 'body', cx: bx, cy: by, r: 9 }), s('line', { class: 'mark', x1: bx, y1: by, x2: bx + 8 * Math.sin(th), y2: by - 8 * Math.cos(th) }));
      g.append(s('text', { class: 'lbl', x: bx + 12, y: by + 3 }, p.id));
    } else {
      g.append(s('line', { class: 'leg', x1, y1, x2, y2 }));
      if (p.type === 'resistor') g.append(s('rect', { class: 'body', x: mx - 12, y: my - 4.5, width: 24, height: 9, rx: 2, transform: `rotate(${ang} ${mx} ${my})` }));
      if (p.type === 'led') {
        const b = ledBrightness(r.i || 0);
        if (b > 0) g.append(s('circle', { class: 'glow', cx: mx, cy: my, r: 8 + 12 * b, fill: LED_FILL[p.color], 'fill-opacity': 0.12 + 0.22 * b }));
        g.append(s('circle', { class: 'body', cx: mx, cy: my, r: 7, stroke: LED_FILL[p.color], fill: LED_FILL[p.color], 'fill-opacity': b > 0 ? 0.45 + 0.55 * b : 0.08 }));
        g.append(s('text', { class: 'pol', x: x1 + (mx - x1) * 0.45 + nx * 7, y: y1 + (my - y1) * 0.45 + ny * 7 + 3, 'text-anchor': 'middle' }, '+'));
      }
      if (p.type === 'button') g.append(s('rect', { class: 'body', x: mx - 8, y: my - 8, width: 16, height: 16, rx: 2 }), s('circle', { class: 'cap' + (p.pressed ? ' down' : ''), cx: mx, cy: my, r: 4.5 }));
      g.append(s('text', { class: 'lbl', x: mx + 11, y: my - 7 }, p.type === 'resistor' ? fmtSI(p.r, 'Ω').replace(' ', '') : p.id));
    }
    for (const q of pts) g.append(s('circle', { class: 'pinend', cx: q[0], cy: q[1], r: 3 }));
    g.addEventListener('click', () => {
      if (tool !== 'inspect') return;
      if (p.type === 'button') { p.pressed = !p.pressed; refresh(true); }
      readout.textContent = `${partLabel(p)} · ${partReading(p)}`;
    });
    return g;
  }
  function drawBoard() {
    const hadFocus = svg.contains(document.activeElement);
    clear(svg); holeEls.clear();
    // MCU header
    svg.append(s('rect', { class: 'mcu', x: 6, y: 6, width: W - 12, height: 50, rx: 4 }));
    HEADER.forEach((id) => { const [x, y] = holeXY(id); svg.append(s('text', { class: 'hlabel', x, y: y - 12, 'text-anchor': 'middle' }, id === 'GND2' ? 'GND' : id)); });
    // board body
    svg.append(s('rect', { class: 'board', x: 4, y: 68, width: W - 8, height: H - 72, rx: 6 }), s('rect', { class: 'gap', x: 163, y: ROW0 - 12, width: 14, height: (ROWS - 1) * P + 24, rx: 2 }));
    for (const side of ['L', 'R']) for (const pol of ['+', '-']) {
      const x = COLX[side + pol];
      svg.append(s('text', { class: 'rlabel ' + (pol === '+' ? 'plus' : 'minus'), x, y: 86, 'text-anchor': 'middle' }, pol === '+' ? '+' : '−'));
      svg.append(s('line', { class: 'railmark ' + (pol === '+' ? 'plus' : 'minus'), x1: x + (pol === '+' ? -9 : 9), y1: ROW0 - 6, x2: x + (pol === '+' ? -9 : 9), y2: ROW0 + (ROWS - 1) * P + 6 }));
      if (showInternal) svg.append(s('line', { class: 'strip', x1: x, y1: ROW0, x2: x, y2: ROW0 + (ROWS - 1) * P }));
    }
    for (const c of 'abcdefghij') svg.append(s('text', { class: 'clabel', x: COLX[c], y: 86, 'text-anchor': 'middle' }, c));
    for (let r = 1; r <= ROWS; r++) {
      const y = ROW0 + (r - 1) * P;
      svg.append(s('text', { class: 'clabel', x: 170, y: y + 3, 'text-anchor': 'middle' }, r));
      if (showInternal) svg.append(s('line', { class: 'strip', x1: COLX.a, y1: y, x2: COLX.e, y2: y }), s('line', { class: 'strip', x1: COLX.f, y1: y, x2: COLX.j, y2: y }));
    }
    for (const id of HEADER) svg.append(mkHole(id));
    for (let r = 1; r <= ROWS; r++) for (const c of COLS) svg.append(mkHole(holeAt(c, r)));
    const order = { resistor: 0, led: 0, button: 0, pot: 0, wire: 1 };
    for (const p of state.parts.slice().sort((x, y) => order[x.type] - order[y.type])) svg.append(drawPart(p));
    svg.classList.toggle('placing', tool !== 'inspect');
    if (hadFocus) holeEls.get(focusHole)?.focus();
    if (lastInspect) for (const [hid, e] of holeEls) e.classList.toggle('same', holeNode(hid) === holeNode(lastInspect));
  }

  // ---- side panels ------------------------------------------------------------------------------------------
  function partReading(p) {
    const r = a.result.components[p.id]; if (!r) return '';
    if (p.type === 'pot') return `wiper ${volts(a.result.nodes[holeNode(p.holes[1])])} · ${mA(r.i)} · ${fmtSI(r.p, 'W')}`;
    if (p.type === 'button') return `${p.pressed ? 'pressed' : 'released'} · ${mA(r.i)}`;
    if (p.type === 'wire') return mA(r.i);
    if (p.type === 'led') return `${r.i > 5e-5 ? 'lit' : 'dark'} · ${mA(r.i)} · ${r.v.toFixed(2)} V`;
    return `${mA(r.i)} · ${Math.abs(r.v).toFixed(2)} V · ${fmtSI(r.p, 'W')}`;
  }
  function drawPins() {
    clear(pinsBox);
    pinsBox.append(h('h4', {}, 'MCU pins'));
    for (const g of GPIOS) {
      pinRead[g] = h('span', { class: 'w-mono breadboard-pinread', 'data-pinread': g });
      pinsBox.append(h('div', { class: 'breadboard-pin' }, h('label', {}, h('span', { class: 'w-mono' }, g), ' ',
        h('select', { 'data-pin': g, 'aria-label': g + ' mode', onchange: (e) => { state.pins[g] = e.target.value; refresh(false); } }, Object.entries(PIN_MODES).map(([k, v]) => h('option', { value: k, selected: state.pins[g] === k }, v)))), pinRead[g]));
    }
  }
  function drawParts() {
    clear(partsBox);
    partsBox.append(h('h4', {}, `Parts on the board (${state.parts.length})`));
    if (!state.parts.length) { partsBox.append(h('p', { class: 'w-note' }, 'None yet. Pick a part from the palette, then choose its holes.')); return; }
    const list = h('ul', { class: 'breadboard-list' });
    for (const p of state.parts) {
      partRead[p.id] = h('span', { class: 'w-mono', 'data-read': p.id });
      const ctl = h('span', { class: 'ctl' });
      if (p.type === 'resistor') ctl.append(h('select', { 'aria-label': p.id + ' value', onchange: (e) => { p.r = +e.target.value; refresh(true); } }, RESISTORS.map((r) => h('option', { value: r, selected: r === p.r }, fmtSI(r, 'Ω')))));
      if (p.type === 'led') ctl.append(h('button', { type: 'button', class: 'btn small ghost', 'data-act': 'flip', 'aria-label': 'Flip ' + p.id, onclick: () => { p.holes.reverse(); refresh(true); } }, 'Flip'));
      if (p.type === 'button') ctl.append(h('button', { type: 'button', class: 'btn small' + (p.pressed ? '' : ' ghost'), 'data-act': 'press', 'aria-pressed': String(p.pressed), onclick: () => { p.pressed = !p.pressed; refresh(true); } }, p.pressed ? 'Pressed' : 'Press'));
      if (p.type === 'pot') ctl.append(h('input', { type: 'range', min: 0, max: 100, value: Math.round(p.pos * 100), 'aria-label': p.id + ' wiper position', oninput: (e) => { p.pos = e.target.value / 100; refresh(false); } }));
      ctl.append(h('button', { type: 'button', class: 'btn small ghost danger', 'data-act': 'delete', 'aria-label': 'Delete ' + p.id, onclick: () => { state.parts = state.parts.filter((q) => q !== p); refresh(true); } }, 'Delete'));
      list.append(h('li', { 'data-part-row': p.id }, h('span', { class: 'nm' }, h('strong', {}, partLabel(p)), ' ', h('span', { class: 'at' }, p.holes.join('–'))), partRead[p.id], ctl));
    }
    partsBox.append(list);
  }
  function drawReadings() {
    for (const g of GPIOS) {
      const r = a.result.components[g], e = pinRead[g]; if (!e) continue;
      if (!r) { e.textContent = 'not connected'; e.className = 'w-mono breadboard-pinread'; continue; }
      const out = r.mode.startsWith('out');
      let t;
      if (out) t = `${volts(r.v)} · ${r.i >= 0 ? 'sourcing' : 'sinking'} ${mA(r.i)}`;
      else if (r.mode === 'analog') t = r.floating ? 'floating: reading is noise' : `ADC sees ${r.v.toFixed(3)} V`;
      else t = r.level === 'floating' ? 'reads ? (floating)' : r.level === 'undefined' ? `reads ? (${volts(r.v)}, undefined)` : `reads ${r.level === 'high' ? 1 : 0} (${volts(r.v)})`;
      e.textContent = t; e.dataset.level = r.level;
      e.className = 'w-mono breadboard-pinread' + (r.level === 'floating' || (!out && r.mode !== 'analog' && r.level === 'undefined') ? ' bad' : '');
    }
    for (const p of state.parts) if (partRead[p.id]) partRead[p.id].textContent = partReading(p);
    clear(problemsBox);
    problemsBox.append(h('h4', {}, 'What the simulator sees'));
    if (!state.parts.length) problemsBox.append(h('p', { class: 'w-note' }, 'An empty board.'));
    else if (!revealed) {
      problemsBox.append(h('div', { class: 'w-msg warn' }, h('strong', {}, 'Symptom: '), BROKEN[brokenIdx].symptom, ' Find the cause yourself first: inspect the voltages, look at each part\'s current, and think about which holes are joined inside the board.'),
        h('button', { type: 'button', class: 'btn small ghost', 'data-act': 'reveal', onclick: () => { revealed = true; drawReadings(); } }, 'Reveal the explanation'));
    } else if (!a.problems.length) problemsBox.append(h('div', { class: 'w-msg ok' }, 'No problems found.'));
    else for (const p of a.problems) problemsBox.append(h('div', { class: 'w-msg ' + (p.severity === 'error' ? 'bad' : 'warn'), 'data-code': p.code }, p.text));
  }
  function refresh(structure) {
    a = analyse(state);
    drawBoard();
    if (structure) drawParts();
    drawReadings();
    if (lastInspect && tool === 'inspect' && !structure) inspect(lastInspect);
  }

  // ---- assemble ---------------------------------------------------------------------------------------------
  const brokenSel = h('select', { 'aria-label': 'Broken example', 'data-opt': 'broken' }, BROKEN.map((b, i) => h('option', { value: i }, b.title)));
  const tools = h('div', { class: 'row' },
    h('label', { class: 'breadboard-check' }, h('input', { type: 'checkbox', checked: showInternal, 'data-opt': 'internal', onchange: (e) => { showInternal = e.target.checked; drawBoard(); } }), ' Show internal connections'),
    h('button', { type: 'button', class: 'btn small ghost', 'data-act': 'clear', onclick: () => { const pins = state.pins; state = newState(); state.pins = pins; revealed = true; pending = []; feedback.hidden = true; resetInspect(); refresh(true); } }, 'Clear board'));
  const brokenRow = h('div', { class: 'row' }, brokenSel,
    h('button', { type: 'button', class: 'btn small ghost', 'data-act': 'broken', onclick: () => { brokenIdx = +brokenSel.value; state = BROKEN[brokenIdx].make(); revealed = false; pending = []; tool = 'inspect'; feedback.hidden = true; resetInspect(); drawPalette(); drawPins(); refresh(true); } }, 'Load a broken example'));
  el.append(taskBox, feedback, h('div', { class: 'breadboard-layout' },
    h('div', { class: 'breadboard-main' }, palette, options, status, svg, readout, tools),
    h('div', { class: 'breadboard-side' }, pinsBox, partsBox, problemsBox, h('h4', {}, 'Practise diagnosis'), brokenRow)),
    h('p', { class: 'w-note' }, 'This is a DC model, not a real board. LEDs are a fixed knee voltage plus 10 Ω; an output pin is an ideal 0 V or 3.3 V behind 30 Ω; pull-ups are 45 kΩ; logic thresholds are 30 % and 70 % of 3.3 V; the pin limit is 20 mA. These are typical teaching values, not figures for any particular chip. Real push buttons have four legs in two joined pairs; this one has two contacts. Contact resistance, tolerance, capacitance and switch bounce are not modelled.'));
  drawTask(); drawPalette(); drawPins(); refresh(true);
}
