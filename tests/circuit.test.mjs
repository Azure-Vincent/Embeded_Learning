// Unit tests for the DC solver (js/sim/circuit.js) against hand-calculated circuits, plus the pure logic of the
// breadboard and circuit-debug widgets. Run: node --test tests/circuit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { solve, measureVoltage, resistanceBetween, logicLevel, ledBrightness, LED_VF, DEFAULTS } from '../js/sim/circuit.js';
import { holeNode, parseHole, newState, addPart, buildCircuit, analyse, CHALLENGES, BROKEN } from '../js/widgets/breadboard.js';
import { SCENARIOS, reading } from '../js/widgets/circuit-debug.js';

const near = (got, want, tol = 1e-6, msg = '') => assert.ok(Math.abs(got - want) <= tol, `${msg} got ${got}, want ${want} ± ${tol}`);
const rail = { id: 'V', type: 'vsource', p: 'VCC', n: 'GND', v: 3.3 };
const codes = (r) => r.diagnostics.map((d) => d.code).sort();
const C = (...components) => ({ ground: 'GND', components });

// ---- linear circuits -----------------------------------------------------------------------------------------
test('single resistor: Ohm\'s law and source current', () => {
  const r = solve(C(rail, { id: 'R', type: 'resistor', a: 'VCC', b: 'GND', r: 330 }));
  near(r.nodes.VCC, 3.3);
  near(r.components.R.i, 0.01, 1e-9);            // 3.3 / 330
  near(r.components.R.p, 0.033, 1e-9);
  near(r.components.V.i, 0.01, 1e-9);
  assert.deepEqual(codes(r), []);
});

test('unloaded divider: 10k over 10k gives half the rail', () => {
  const r = solve(C(rail, { id: 'R1', type: 'resistor', a: 'VCC', b: 'M', r: 10000 }, { id: 'R2', type: 'resistor', a: 'M', b: 'GND', r: 10000 }));
  near(r.nodes.M, 1.65);
  near(r.components.R1.i, 165e-6, 1e-12);
  assert.deepEqual(codes(r), []);
});

test('unloaded divider: 10k over 4.7k', () => {
  const r = solve(C(rail, { id: 'R1', type: 'resistor', a: 'VCC', b: 'M', r: 10000 }, { id: 'R2', type: 'resistor', a: 'M', b: 'GND', r: 4700 }));
  near(r.nodes.M, 3.3 * 4700 / 14700);           // 1.0551 V
});

test('loaded divider: load in parallel with the bottom resistor pulls the midpoint down', () => {
  // 10k / 10k with a 10k load: bottom leg is 5k, so Vm = 3.3 * 5 / 15 = 1.1 V
  const r = solve(C(rail, { id: 'R1', type: 'resistor', a: 'VCC', b: 'M', r: 10000 }, { id: 'R2', type: 'resistor', a: 'M', b: 'GND', r: 10000 }, { id: 'RL', type: 'resistor', a: 'M', b: 'GND', r: 10000 }));
  near(r.nodes.M, 1.1);
  near(r.components.R1.i, 220e-6, 1e-12);
  near(r.components.RL.i, 110e-6, 1e-12);
});

test('series source resistance: terminal voltage sags under load', () => {
  // 5 V behind 1 ohm into 4 ohm: 1 A, 4 V at the load
  const r = solve(C({ id: 'V', type: 'vsource', p: 'VCC', n: 'GND', v: 5, rs: 1, ilimit: 5 }, { id: 'R', type: 'resistor', a: 'VCC', b: 'GND', r: 4, rating: 10 }));
  near(r.nodes.VCC, 4);
  near(r.components.V.i, 1);
});

test('potentiometer as a divider follows the wiper position', () => {
  for (const pos of [0.25, 0.5, 0.8]) {
    const r = solve(C(rail, { id: 'P', type: 'pot', a: 'GND', w: 'W', b: 'VCC', r: 10000, pos }));
    near(r.nodes.W, 3.3 * pos, 1e-9);
    near(r.components.P.i, 3.3 / 10000, 1e-9);
  }
});

test('wires and closed switches are near-ideal; an open switch carries nothing', () => {
  const mk = (closed) => solve(C(rail, { id: 'W', type: 'wire', a: 'VCC', b: 'A' }, { id: 'S', type: 'switch', a: 'A', b: 'B', closed }, { id: 'R', type: 'resistor', a: 'B', b: 'GND', r: 1000 }));
  const on = mk(true), off = mk(false);
  near(on.components.R.i, 3.3e-3, 1e-6);
  near(on.components.W.i, 3.3e-3, 1e-6);
  near(off.components.R.i, 0, 1e-9);
  assert.equal(off.components.S.i, 0);
});

// ---- diodes and LEDs -----------------------------------------------------------------------------------------
test('LED + resistor from a rail: I = (Vs - Vf) / (R + Ron)', () => {
  const r = solve(C(rail, { id: 'R', type: 'resistor', a: 'VCC', b: 'A', r: 220 }, { id: 'D', type: 'led', a: 'A', k: 'GND', color: 'red' }));
  const i = (3.3 - 1.8) / (220 + 10);            // 6.52 mA
  near(r.components.D.i, i, 1e-9);
  near(r.components.R.i, i, 1e-9);
  near(r.nodes.A, 1.8 + 10 * i, 1e-9);
  assert.equal(r.components.D.on, true);
  assert.deepEqual(codes(r), []);
});

test('LED below its knee voltage stays off', () => {
  const r = solve(C({ id: 'V', type: 'vsource', p: 'VCC', n: 'GND', v: 1.5 }, { id: 'R', type: 'resistor', a: 'VCC', b: 'A', r: 220 }, { id: 'D', type: 'led', a: 'A', k: 'GND', color: 'red' }));
  assert.equal(r.components.D.on, false);
  assert.equal(r.components.D.i, 0);
  near(r.nodes.A, 1.5, 1e-4);
});

test('reversed LED blocks, takes the full voltage and is diagnosed', () => {
  const r = solve(C(rail, { id: 'R', type: 'resistor', a: 'VCC', b: 'A', r: 220 }, { id: 'D', type: 'led', a: 'GND', k: 'A', color: 'red' }));
  assert.equal(r.components.D.i, 0);
  near(r.components.D.v, -3.3, 1e-4);
  near(r.components.R.v, 0, 1e-4);
  assert.deepEqual(codes(r), ['led-reversed']);
});

test('two LEDs in series need both knee voltages', () => {
  // red + red = 3.6 V > 3.3 V: dark. At 5 V: (5 - 3.6) / (100 + 20)
  const mk = (v) => solve(C({ id: 'V', type: 'vsource', p: 'VCC', n: 'GND', v }, { id: 'R', type: 'resistor', a: 'VCC', b: 'A', r: 100 }, { id: 'D1', type: 'led', a: 'A', k: 'B', color: 'red' }, { id: 'D2', type: 'led', a: 'B', k: 'GND', color: 'red' }));
  assert.equal(mk(3.3).components.D1.i, 0);
  near(mk(5).components.D1.i, 1.4 / 120, 1e-9);
  near(mk(5).components.D2.i, 1.4 / 120, 1e-9);
});

test('parallel LEDs of the same colour sharing one resistor split the current', () => {
  const r = solve(C(rail, { id: 'R', type: 'resistor', a: 'VCC', b: 'A', r: 100 }, { id: 'D1', type: 'led', a: 'A', k: 'GND', color: 'red' }, { id: 'D2', type: 'led', a: 'A', k: 'GND', color: 'red' }));
  const total = (3.3 - 1.8) / (100 + 5);         // two 10 ohm slopes in parallel
  near(r.components.R.i, total, 1e-9);
  near(r.components.D1.i, total / 2, 1e-9);
  near(r.components.D2.i, total / 2, 1e-9);
});

test('parallel LEDs of different colours: the lower Vf hogs all the current', () => {
  const r = solve(C(rail, { id: 'R', type: 'resistor', a: 'VCC', b: 'A', r: 220 }, { id: 'RED', type: 'led', a: 'A', k: 'GND', color: 'red' }, { id: 'BLUE', type: 'led', a: 'A', k: 'GND', color: 'blue' }));
  near(r.components.RED.i, 1.5 / 230, 1e-9);
  assert.equal(r.components.BLUE.i, 0);
  assert.ok(r.nodes.A < LED_VF.blue);
});

test('parallel LEDs each with their own resistor are independent', () => {
  const r = solve(C(rail,
    { id: 'R1', type: 'resistor', a: 'VCC', b: 'A', r: 220 }, { id: 'RED', type: 'led', a: 'A', k: 'GND', color: 'red' },
    { id: 'R2', type: 'resistor', a: 'VCC', b: 'B', r: 47 }, { id: 'BLUE', type: 'led', a: 'B', k: 'GND', color: 'blue' }));
  near(r.components.RED.i, 1.5 / 230, 1e-9);
  near(r.components.BLUE.i, 0.3 / 57, 1e-9);
  near(r.components.V.i, 1.5 / 230 + 0.3 / 57, 1e-9);
});

test('LED with no resistor across a rail is over-current', () => {
  const r = solve(C(rail, { id: 'D', type: 'led', a: 'VCC', k: 'GND', color: 'red' }));
  near(r.components.D.i, 0.15, 1e-9);            // 1.5 V across the 10 ohm slope
  assert.ok(codes(r).includes('over-current'));
});

test('plain diode: 0.6 V knee, blocks in reverse', () => {
  const f = solve(C({ id: 'V', type: 'vsource', p: 'VCC', n: 'GND', v: 5 }, { id: 'R', type: 'resistor', a: 'VCC', b: 'A', r: 1000 }, { id: 'D', type: 'diode', a: 'A', k: 'GND' }));
  near(f.components.D.i, 4.4 / 1001, 1e-9);
  const b = solve(C({ id: 'V', type: 'vsource', p: 'VCC', n: 'GND', v: 5 }, { id: 'R', type: 'resistor', a: 'VCC', b: 'A', r: 1000 }, { id: 'D', type: 'diode', a: 'GND', k: 'A' }));
  assert.equal(b.components.D.i, 0);
  assert.deepEqual(codes(b), []);                // only LEDs are reported as reversed
});

// ---- MCU pins ------------------------------------------------------------------------------------------------
test('output HIGH drives an LED through the pin resistance', () => {
  const r = solve(C({ id: 'IO', type: 'pin', node: 'P', mode: 'out-high' }, { id: 'R', type: 'resistor', a: 'P', b: 'A', r: 220 }, { id: 'D', type: 'led', a: 'A', k: 'GND', color: 'red' }));
  const i = 1.5 / (30 + 220 + 10);               // 5.77 mA
  near(r.components.D.i, i, 1e-9);
  near(r.components.IO.i, i, 1e-9);
  near(r.components.IO.v, 3.3 - 30 * i, 1e-9);
  assert.deepEqual(codes(r), []);
});

test('output LOW sinks current (active-low LED) and reports a negative pin current', () => {
  const r = solve(C(rail, { id: 'R', type: 'resistor', a: 'VCC', b: 'A', r: 220 }, { id: 'D', type: 'led', a: 'A', k: 'P', color: 'red' }, { id: 'IO', type: 'pin', node: 'P', mode: 'out-low' }));
  const i = 1.5 / 260;
  near(r.components.IO.i, -i, 1e-9);
  near(r.components.IO.v, 30 * i, 1e-9);
});

test('LED straight from a pin overloads the pin and the LED', () => {
  const r = solve(C({ id: 'IO', type: 'pin', node: 'P', mode: 'out-high' }, { id: 'D', type: 'led', a: 'P', k: 'GND', color: 'red' }));
  near(r.components.IO.i, 1.5 / 40, 1e-9);       // 37.5 mA
  near(r.components.IO.v, 3.3 - 30 * 1.5 / 40, 1e-9);
  assert.deepEqual(codes(r), ['over-current', 'pin-overcurrent']);
  assert.equal(r.diagnostics.find((d) => d.code === 'pin-overcurrent').direction, 'source');
});

test('output pin shorted to ground is a sink/source over-current', () => {
  const r = solve(C({ id: 'IO', type: 'pin', node: 'P', mode: 'out-high' }, { id: 'W', type: 'wire', a: 'P', b: 'GND' }));
  assert.ok(r.components.IO.i > 0.1);
  assert.ok(codes(r).includes('pin-overcurrent'));
});

test('floating input: no DC path, reads unpredictably, is diagnosed', () => {
  const r = solve(C({ id: 'IO', type: 'pin', node: 'P', mode: 'input' }, { id: 'S', type: 'switch', a: 'P', b: 'GND', closed: false }));
  assert.equal(r.nodes.P, null);
  assert.deepEqual(r.floating, ['P']);
  assert.equal(r.components.IO.level, 'floating');
  assert.ok(codes(r).includes('floating-input'));
  assert.ok(codes(r).includes('floating-node'));
});

test('pull-up with a button to ground: 1 released, 0 pressed', () => {
  const mk = (closed) => solve(C({ id: 'IO', type: 'pin', node: 'P', mode: 'input-pullup' }, { id: 'S', type: 'switch', a: 'P', b: 'GND', closed }));
  const rel = mk(false), prs = mk(true);
  near(rel.nodes.P, 3.3, 1e-9);
  assert.equal(rel.components.IO.level, 'high');
  assert.deepEqual(codes(rel).filter((c) => c !== 'dangling'), []);
  near(prs.nodes.P, 3.3 * 0.05 / 45000.05, 1e-9);  // essentially 0 V
  assert.equal(prs.components.IO.level, 'low');
  near(prs.components.IO.i, 3.3 / 45000.05, 1e-9); // 73 uA through the pull-up
  assert.deepEqual(codes(prs), []);
});

test('pull-down gives a defined 0; external pull-up against it lands where the divider says', () => {
  const pd = solve(C({ id: 'IO', type: 'pin', node: 'P', mode: 'input-pulldown' }));
  near(pd.nodes.P, 0, 1e-12);
  assert.equal(pd.components.IO.level, 'low');
  // 45k external to 3.3 V against the 45k internal pull-down: 1.65 V, the undefined region
  const mid = solve(C(rail, { id: 'R', type: 'resistor', a: 'VCC', b: 'P', r: 45000 }, { id: 'IO', type: 'pin', node: 'P', mode: 'input-pulldown' }));
  near(mid.nodes.P, 1.65, 1e-9);
  assert.equal(mid.components.IO.level, 'undefined');
  assert.deepEqual(codes(mid), ['input-undefined']);
});

test('analog mode does not complain about mid-rail voltages', () => {
  const r = solve(C(rail, { id: 'R1', type: 'resistor', a: 'VCC', b: 'P', r: 10000 }, { id: 'R2', type: 'resistor', a: 'P', b: 'GND', r: 10000 }, { id: 'IO', type: 'pin', node: 'P', mode: 'analog' }));
  near(r.components.IO.v, 1.65);
  assert.deepEqual(codes(r), []);
});

test('input above the 3.3 V rail is flagged', () => {
  const r = solve(C({ id: 'V5', type: 'vsource', p: 'V5', n: 'GND', v: 5 }, { id: 'R', type: 'resistor', a: 'V5', b: 'P', r: 10000 }, { id: 'IO', type: 'pin', node: 'P', mode: 'input' }));
  near(r.nodes.P, 5, 1e-9);
  assert.deepEqual(codes(r), ['input-overvoltage']);
});

test('logic thresholds are 30 % and 70 % of the rail', () => {
  assert.equal(logicLevel(0.99), 'low');
  assert.equal(logicLevel(1.0), 'undefined');
  assert.equal(logicLevel(2.3), 'undefined');
  assert.equal(logicLevel(2.31), 'high');
});

// ---- diagnostics ---------------------------------------------------------------------------------------------
test('rail-to-rail wire is a short circuit', () => {
  const r = solve(C(rail, { id: 'W', type: 'wire', a: 'VCC', b: 'GND' }));
  assert.ok(r.components.V.i > 100);
  assert.deepEqual(codes(r), ['short-circuit']);
});

test('resistor over its power rating', () => {
  const r = solve(C({ id: 'V', type: 'vsource', p: 'VCC', n: 'GND', v: 5 }, { id: 'R', type: 'resistor', a: 'VCC', b: 'GND', r: 47 }));
  near(r.components.R.p, 25 / 47, 1e-9);         // 0.53 W in a 0.25 W part
  assert.deepEqual(codes(r), ['over-power']);
});

test('pot turned to its end between the rails burns', () => {
  const r = solve(C(rail, { id: 'P', type: 'pot', a: 'VCC', w: 'GND', b: 'X', r: 10000, pos: 0 }));
  assert.ok(codes(r).includes('over-power') || codes(r).includes('short-circuit'));
});

test('both legs on one node: the part is shorted out and carries nothing', () => {
  const r = solve(C(rail, { id: 'R', type: 'resistor', a: 'VCC', b: 'A', r: 330 }, { id: 'D', type: 'led', a: 'A', k: 'A', color: 'red' }, { id: 'W', type: 'wire', a: 'A', b: 'GND' }));
  assert.equal(r.components.D.i, 0);
  near(r.components.R.i, 0.01, 1e-6);
  assert.deepEqual(codes(r), ['shorted-part']);
});

test('a leg that goes nowhere is reported as dangling', () => {
  const r = solve(C(rail, { id: 'R', type: 'resistor', a: 'VCC', b: 'X', r: 330 }));
  near(r.nodes.X, 3.3, 1e-9);                     // no current, so no drop
  assert.deepEqual(codes(r), ['dangling']);
  assert.equal(r.diagnostics[0].term, 1);
});

test('an island with no ground reference floats', () => {
  const r = solve(C(rail, { id: 'R', type: 'resistor', a: 'X', b: 'Y', r: 100 }, { id: 'R2', type: 'resistor', a: 'X', b: 'Y', r: 100 }));
  assert.equal(r.nodes.X, null);
  assert.equal(r.nodes.Y, null);
  assert.deepEqual(r.diagnostics.find((d) => d.code === 'floating-node').nodes.sort(), ['X', 'Y']);
});

test('bad input is rejected', () => {
  assert.throws(() => solve(C({ id: 'R', type: 'resistor', a: 'A', b: 'GND', r: 0 })));
  assert.throws(() => solve(C({ id: 'R', type: 'mystery', a: 'A', b: 'GND' })));
  assert.throws(() => solve(C(rail, { ...rail })));
});

test('ledBrightness is 0 when dark and saturates', () => {
  assert.equal(ledBrightness(0), 0);
  assert.ok(ledBrightness(0.002) > 0 && ledBrightness(0.002) < ledBrightness(0.01));
  assert.equal(ledBrightness(0.05), 1);
});

// ---- instruments ---------------------------------------------------------------------------------------------
test('voltmeter loads the circuit with 10 Mohm', () => {
  const c = C(rail, { id: 'R1', type: 'resistor', a: 'VCC', b: 'M', r: 10000 }, { id: 'R2', type: 'resistor', a: 'M', b: 'GND', r: 10000 });
  near(measureVoltage(c, 'M', 'GND'), 1.65, 1e-3);
  near(measureVoltage(c, 'GND', 'M'), -1.65, 1e-3);
  // two 10 Mohm resistors: the meter makes the bottom leg 5 Mohm, so it reads 1.1 V instead of 1.65 V
  const hi = C(rail, { id: 'R1', type: 'resistor', a: 'VCC', b: 'M', r: 1e7 }, { id: 'R2', type: 'resistor', a: 'M', b: 'GND', r: 1e7 });
  near(measureVoltage(hi, 'M', 'GND'), 1.1, 1e-6);
});

test('voltmeter on a floating node reads through its own resistance', () => {
  const c = C(rail, { id: 'IO', type: 'pin', node: 'P', mode: 'input' }, { id: 'S', type: 'switch', a: 'P', b: 'GND', closed: false });
  near(measureVoltage(c, 'P', 'GND'), 0, 1e-6);   // the meter pulls the node to its black lead
  near(measureVoltage(c, 'VCC', 'P'), 0, 1e-6);   // and to its red lead: both read 0, the signature of a floating node
});

test('ohmmeter: series, parallel, open, and unpowered', () => {
  const c = C(rail, { id: 'R1', type: 'resistor', a: 'A', b: 'B', r: 1000 }, { id: 'R2', type: 'resistor', a: 'B', b: 'C', r: 2200 }, { id: 'R3', type: 'resistor', a: 'A', b: 'C', r: 3200 },
    { id: 'W', type: 'wire', a: 'C', b: 'D' }, { id: 'S', type: 'switch', a: 'D', b: 'E', closed: false }, { id: 'L', type: 'led', a: 'E', k: 'F', color: 'red' });
  near(resistanceBetween(c, 'A', 'B'), 1000 * 5400 / 6400, 1e-3);
  near(resistanceBetween(c, 'A', 'C'), 1600, 1e-3);
  near(resistanceBetween(c, 'C', 'D'), DEFAULTS.wireR, 1e-6);
  assert.equal(resistanceBetween(c, 'D', 'E'), Infinity);
  assert.equal(resistanceBetween(c, 'A', 'VCC'), Infinity);
  assert.equal(resistanceBetween(c, 'A', 'A'), 0);
});

// ---- breadboard model ----------------------------------------------------------------------------------------
test('breadboard internal wiring', () => {
  assert.equal(holeNode('a5'), holeNode('e5'));
  assert.equal(holeNode('f5'), holeNode('j5'));
  assert.notEqual(holeNode('e5'), holeNode('f5'));       // centre gap
  assert.notEqual(holeNode('a5'), holeNode('a6'));
  assert.equal(holeNode('L+1'), holeNode('L+17'));       // a rail runs the full length
  assert.notEqual(holeNode('L+1'), holeNode('L-1'));
  assert.notEqual(holeNode('L-1'), holeNode('R-1'));     // left and right rails are separate
  assert.equal(holeNode('GND2'), 'GND');
  assert.equal(parseHole('k5'), null);
  assert.equal(parseHole('a18'), null);
  assert.throws(() => holeNode('z9'));
});

const board = (list, pins) => { const st = newState(); Object.assign(st.pins, pins || {}); for (const [t, holes, o] of list) assert.ok(addPart(st, t, holes, o).ok, 'place ' + t + ' ' + holes); return st; };
const goodLed = () => board([['wire', ['IO0', 'a3']], ['resistor', ['b3', 'b8'], { r: 220 }], ['led', ['c8', 'L-8']], ['wire', ['GND', 'L-1']]]);

test('addPart: ids, one leg per hole, validation', () => {
  const st = newState();
  assert.equal(addPart(st, 'resistor', ['a1', 'a5']).part.id, 'R1');
  assert.equal(addPart(st, 'resistor', ['b1', 'b5']).part.id, 'R2');
  assert.equal(addPart(st, 'led', ['a1', 'c9']).ok, false);       // a1 is taken
  assert.equal(addPart(st, 'led', ['c9', 'c9']).ok, false);
  assert.equal(addPart(st, 'pot', ['c9', 'c10']).ok, false);      // needs three holes
  assert.equal(addPart(st, 'pot', ['c9', 'c10', 'c11']).ok, true);
  assert.equal(st.parts.length, 3);
});

test('breadboard: LED from IO0 lights and the led challenge passes', () => {
  const st = goodLed(), a = analyse(st);
  near(a.result.components.LED1.i, 1.5 / (30 + 220 + 10 + 0.03), 1e-6);
  assert.deepEqual(a.problems, []);
  assert.equal(CHALLENGES.led.check(st).ok, true);
});

test('led challenge: specific feedback for each mistake', () => {
  assert.match(CHALLENGES.led.check(newState()).msg, /no LED/);
  const rev = goodLed(); rev.parts.find((p) => p.type === 'led').holes.reverse();
  assert.match(CHALLENGES.led.check(rev).msg, /reverse-biased/);
  const big = goodLed(); big.parts.find((p) => p.type === 'resistor').r = 47;
  assert.match(CHALLENGES.led.check(big).msg, /above the 15 mA/);
  const dim = goodLed(); dim.parts.find((p) => p.type === 'resistor').r = 10000;
  assert.match(CHALLENGES.led.check(dim).msg, /dim/);
  const low = goodLed(); low.pins.IO0 = 'out-low';
  assert.match(CHALLENGES.led.check(low).msg, /Output HIGH/);
  const fromRail = board([['wire', ['3V3', 'a3']], ['resistor', ['b3', 'b8'], { r: 220 }], ['led', ['c8', 'L-8']], ['wire', ['GND', 'L-1']]]);
  assert.match(CHALLENGES.led.check(fromRail).msg, /not by a GPIO/);
  const sameRow = board([['wire', ['IO0', 'a5']], ['led', ['c5', 'd5']], ['resistor', ['e5', 'L-5'], { r: 330 }], ['wire', ['GND', 'L-1']]]);
  assert.match(CHALLENGES.led.check(sameRow).msg, /shorted out/);
  for (const st of [rev, big, dim, low, fromRail, sameRow]) assert.equal(CHALLENGES.led.check(st).ok, false);
});

test('button-pullup challenge', () => {
  const mk = (mode, to = 'L-12') => board([['wire', ['IO1', 'a10']], ['button', ['b10', 'b12']], ['wire', ['a12', to]], ['wire', ['GND', 'L-1']], ['wire', ['3V3', 'L+1']]], { IO1: mode });
  assert.equal(CHALLENGES['button-pullup'].check(mk('input-pullup')).ok, true);
  const pressed = mk('input-pullup'); pressed.parts.find((p) => p.type === 'button').pressed = true;
  assert.equal(CHALLENGES['button-pullup'].check(pressed).ok, true, 'result must not depend on the current button state');
  assert.match(CHALLENGES['button-pullup'].check(mk('input')).msg, /floats/);
  assert.match(CHALLENGES['button-pullup'].check(mk('input-pulldown')).msg, /reads 0 with the button released/);
  assert.match(CHALLENGES['button-pullup'].check(mk('input-pullup', 'L+12')).msg, /not to 3V3/);
  assert.match(CHALLENGES['button-pullup'].check(newState()).msg, /no button/);
  for (const st of [mk('input'), mk('input-pulldown'), mk('input-pullup', 'L+12'), mk('out-high')]) assert.equal(CHALLENGES['button-pullup'].check(st).ok, false);
});

test('divider challenge', () => {
  const mk = (r1, r2, mode = 'analog') => board([['wire', ['3V3', 'L+1']], ['wire', ['GND', 'L-1']], ['resistor', ['L+5', 'a5'], { r: r1 }], ['resistor', ['b5', 'L-6'], { r: r2 }], ['wire', ['IO2', 'c5']]], { IO2: mode });
  assert.equal(CHALLENGES.divider.check(mk(10000, 4700)).ok, true);        // 1.055 V, 0.22 mA
  assert.equal(CHALLENGES.divider.check(mk(6800, 3300)).ok, true);
  assert.match(CHALLENGES.divider.check(mk(10000, 10000)).msg, /1\.65 V; the target/);
  assert.match(CHALLENGES.divider.check(mk(1000, 470)).msg, /limit is 1 mA/);
  assert.match(CHALLENGES.divider.check(mk(10000, 4700, 'input')).msg, /Analog input/);
  const top = board([['wire', ['3V3', 'L+1']], ['resistor', ['L+5', 'a5'], { r: 10000 }], ['wire', ['IO2', 'c5']]], { IO2: 'analog' });
  assert.match(CHALLENGES.divider.check(top).msg, /full rail/);
});

test('two-leds challenge', () => {
  const own = board([['wire', ['GND', 'L-1']], ['wire', ['IO0', 'a3']], ['resistor', ['b3', 'b8'], { r: 220 }], ['led', ['c8', 'L-8'], { color: 'red' }],
    ['wire', ['IO1', 'a11']], ['resistor', ['b11', 'b15'], { r: 220 }], ['led', ['c15', 'L-15'], { color: 'green' }]], { IO1: 'out-high' });
  assert.equal(CHALLENGES['two-leds'].check(own).ok, true);
  const shared = board([['wire', ['GND', 'L-1']], ['wire', ['IO0', 'a3']], ['resistor', ['b3', 'b8'], { r: 220 }], ['led', ['c8', 'L-8'], { color: 'red' }], ['led', ['d8', 'L-9'], { color: 'blue' }]]);
  const r = CHALLENGES['two-leds'].check(shared);
  assert.equal(r.ok, false); assert.match(r.msg, /share one resistor/);
  const same = board([['wire', ['GND', 'L-1']], ['wire', ['IO0', 'a3']], ['resistor', ['b3', 'b8'], { r: 220 }], ['led', ['c8', 'L-8']], ['led', ['d8', 'L-9']]]);
  assert.match(CHALLENGES['two-leds'].check(same).msg, /same colour/);
});

test('free challenge and every challenge has a title and goal', () => {
  assert.equal(CHALLENGES.free.check(newState()).ok, false);
  assert.equal(CHALLENGES.free.check(goodLed()).ok, true);
  assert.deepEqual(Object.keys(CHALLENGES), ['led', 'button-pullup', 'divider', 'two-leds', 'free']);
  for (const c of Object.values(CHALLENGES)) { assert.ok(c.title && c.goal); assert.equal(c.check(newState()).ok, false); }
});

test('broken examples are broken in the intended way', () => {
  const expect = ['shorted-part', 'led-reversed', 'dangling', 'dangling', 'pin-overcurrent', 'floating-input'];
  BROKEN.forEach((b, i) => {
    const a = analyse(b.make());
    assert.ok(a.problems.some((p) => p.code === expect[i]), `${b.title}: expected ${expect[i]}, got ${a.problems.map((p) => p.code)}`);
    for (const p of a.problems) assert.ok(p.text.length > 40 && !/undefined|NaN/.test(p.text.replace(/is undefined|undefined:|undefined \(/g, '')), p.text);
  });
  assert.match(analyse(BROKEN[3].make()).problems.map((p) => p.text).join(' '), /centre gap/);
  assert.match(analyse(BROKEN[2].make()).problems.map((p) => p.text).join(' '), /left and right rails are not joined/);
});

test('unused GPIOs are left out of the circuit', () => {
  assert.deepEqual(buildCircuit(newState()).components.map((c) => c.id), ['V3V3', 'V5V']);
  assert.ok(buildCircuit(goodLed()).components.some((c) => c.id === 'IO0'));
  assert.deepEqual(analyse(newState()).problems, []);
});

// ---- troubleshooting scenarios -------------------------------------------------------------------------------
test('scenarios: catalogue is complete and well formed', () => {
  assert.deepEqual(Object.keys(SCENARIOS), ['led-reversed', 'missing-ground', 'floating-input', 'no-current-limit', 'brownout', 'wrong-rail']);
  for (const [id, sc] of Object.entries(SCENARIOS)) {
    assert.ok(sc.title && sc.symptom && sc.explain, id);
    assert.equal(sc.diagnoses.filter((d) => d.correct).length, 1, id + ' diagnoses');
    assert.equal(sc.fixes.filter((d) => d.correct).length, 1, id + ' fixes');
    for (const d of [...sc.diagnoses, ...sc.fixes]) assert.ok(d.text && d.feedback, id + ' option text and feedback');
    const nodes = new Set(sc.circuit({}).components.flatMap((c) => [c.a, c.b, c.k, c.p, c.n, c.node, c.w]).filter(Boolean));
    for (const tp of sc.points) assert.ok(nodes.has(tp.node), `${id}: test point ${tp.id} is on a real node`);
    assert.ok(solve(sc.circuit({})).ok);
  }
});

const V = (id, red, black, st = {}) => reading(SCENARIOS[id], 'v', red, black, st).value;
const ohm = (id, red, black, st = {}) => reading(SCENARIOS[id], 'c', red, black, st);

test('scenario readings are the evidence the diagnosis rests on', () => {
  // reversed LED: pin is high, nothing dropped across the resistor, ground is fine
  near(V('led-reversed', 'A', 'G'), 3.3, 0.01); near(V('led-reversed', 'A', 'B'), 0, 0.01); near(V('led-reversed', 'B', 'G'), 3.3, 0.01);
  assert.equal(ohm('led-reversed', 'C', 'G').beep, true);
  // missing ground: the "ground" rail is not at 0 V and is not continuous with GND
  near(V('missing-ground', 'A', 'G'), 3.3, 0.01);
  assert.ok(V('missing-ground', 'C', 'G') > 1);
  assert.equal(ohm('missing-ground', 'C', 'G').beep, false);
  assert.equal(ohm('missing-ground', 'C', 'G').value, Infinity);
  // floating input: the meter reads 0 V both to GND and to 3V3
  near(V('floating-input', 'A', 'G'), 0, 0.01); near(V('floating-input', 'V', 'A'), 0, 0.01);
  near(V('floating-input', 'A', 'G', { pressed: true }), 0, 0.01);
  assert.equal(ohm('floating-input', 'A', 'G', { pressed: true }).beep, true);
  assert.equal(ohm('floating-input', 'A', 'V').beep, false);
  // no current limit: the pin sags and the resistor drops nothing
  near(V('no-current-limit', 'A', 'G'), 3.3 - 30 * 1.5 / 40, 0.02);
  near(V('no-current-limit', 'A', 'B'), 0, 0.01);
  assert.equal(ohm('no-current-limit', 'A', 'B').beep, true);
  // brownout: fine with the motor off, sags at the board with it on, while the source itself holds
  assert.ok(V('brownout', 'B', 'G') > 4.8);
  assert.ok(V('brownout', 'B', 'G', { motor: true }) < 4.2);
  assert.ok(V('brownout', 'S', 'G', { motor: true }) > 4.95);
  assert.ok(V('brownout', 'S', 'B', { motor: true }) > 0.8);
  // wrong rail: the pull-up's top end is at 5 V and the pin sits above 3.3 V
  near(V('wrong-rail', 'P', 'G'), 5, 0.01);
  assert.ok(V('wrong-rail', 'A', 'G') > 3.6 && V('wrong-rail', 'A', 'G') < 4.2);
  near(V('wrong-rail', 'A', 'G', { pressed: true }), 0, 0.01);
});

test('meter formatting', () => {
  assert.match(reading(SCENARIOS['led-reversed'], 'v', 'A', 'G', {}).text, /^3\.30 V$/);
  assert.match(ohm('missing-ground', 'C', 'G').text, /OL/);
  assert.match(ohm('led-reversed', 'A', 'B').text, /220/);
});
