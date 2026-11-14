// Pure-logic tests for the electronics widgets. Run: node --test tests/electronics.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../js/sim/electronics.js';
import { powerVerdict } from '../js/widgets/ohms-law.js';
import { diagnoseReading, makeQuestion, CHALLENGES as RC } from '../js/widgets/resistor-code.js';
import { analyse, expression } from '../js/widgets/series-parallel.js';
import { checkChallenge as divCheck, CHALLENGES as DIV } from '../js/widgets/voltage-divider.js';
import { debounceVerdict } from '../js/widgets/rc-circuit.js';
import { checkChallenge as ledCheck, CHALLENGES as LED } from '../js/widgets/led-resistor.js';
import { evaluate, checkChallenge as trCheck, CHALLENGES as TR } from '../js/widgets/transistor-switch.js';
import { experimentsHit, sampleReads, EXPERIMENTS, CHALLENGES as GP } from '../js/widgets/gpio-electrical.js';
import { pwmPlan, loadEffects } from '../js/widgets/pwm-lab.js';
import { samplingPlan } from '../js/widgets/adc-lab.js';

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);

test('E-series values and nearest value', () => {
  assert.equal(E.E12.length, 12); assert.equal(E.E24.length, 24);
  assert.deepEqual(E.eSeriesValues('E12', 2, 3), [100, 120, 150, 180, 220, 270, 330, 390, 470, 560, 680, 820, 1000]);
  assert.equal(E.nearestE(5000), 4700); assert.equal(E.nearestE(5000, 'E24'), 5100);
  assert.equal(E.nearestE(95), 100); assert.equal(E.nextEUp(313), 330); assert.equal(E.nextEUp(330), 330);
});
test('resistance parsing and formatting', () => {
  for (const [t, v] of [['4k7', 4700], ['4.7k', 4700], ['220', 220], ['1M', 1e6], ['10 kΩ', 1e4], ['0R47', 0.47], ['470R', 470], ['2M2', 2.2e6]]) assert.equal(E.parseR(t), v, t);
  assert.ok(isNaN(E.parseR('abc')));
  assert.equal(E.fmtR(4700), '4.7 kΩ'); assert.equal(E.fmtR(220), '220 Ω'); assert.equal(E.fmtR(1e6), '1 MΩ');
});
test('colour code both ways', () => {
  assert.equal(E.bandsToValue(['yellow', 'violet', 'red', 'gold']).ohms, 4700);
  assert.equal(E.bandsToValue(['brown', 'black', 'black', 'red', 'brown']).ohms, 10000);
  assert.equal(E.bandsToValue(['brown', 'black', 'black', 'red', 'brown']).tolerance, 1);
  assert.equal(E.bandsToValue(['red', 'red', 'gold', 'gold']).ohms, 2.2);
  assert.equal(E.bandsToValue(['gold', 'red', 'red', 'gold']).valid, false);
  assert.deepEqual(E.valueToBands(4700), ['yellow', 'violet', 'red', 'gold']);
  assert.deepEqual(E.valueToBands(1e6), ['brown', 'black', 'green', 'gold']);
  assert.deepEqual(E.valueToBands(4990, 5), ['yellow', 'white', 'white', 'brown', 'brown']);
  assert.equal(E.valueToBands(4990, 4), null);
  for (const n of [4, 5]) for (const v of E.eSeriesValues(n === 5 ? 'E24' : 'E12', 0, 6)) assert.equal(E.bandsToValue(E.valueToBands(v, n)).ohms, v, `${n} bands ${v}`);
});
test('resistor quiz diagnosis and questions', () => {
  assert.equal(diagnoseReading(4700, 4700), '');
  assert.match(diagnoseReading(4700, 47000), /10× too large/);
  assert.match(diagnoseReading(4700, 470), /10× too small/);
  assert.match(diagnoseReading(4700, 7400), /reverse/);
  assert.match(diagnoseReading(4700, NaN), /not a resistance/);
  const rnd = E.prng(5);
  for (let i = 0; i < 50; i++) { const q = makeQuestion(rnd, i % 2 ? 5 : 4); assert.equal(E.bandsToValue(q.bands).ohms, q.ohms); }
  assert.ok(RC.quiz.title);
});
test("Ohm's law and power verdict", () => {
  near(E.ohm({ v: 5, r: 220 }).i, 5 / 220); near(E.ohm({ i: 0.02, r: 150 }).v, 3); near(E.ohm({ v: 3.3, i: 0.01 }).r, 330);
  near(E.ohm({ v: 5, r: 220 }).p, 25 / 220);
  assert.equal(powerVerdict(0.3, 0.25).level, 'bad'); assert.equal(powerVerdict(0.2, 0.25).level, 'warn'); assert.equal(powerVerdict(0.1, 0.25).level, 'ok');
});
test('series/parallel network', () => {
  assert.equal(E.seriesR([100, 220]), 320); near(E.parallelR([1000, 1000]), 500); near(E.parallelR([100, 200, 300]), 54.5454545, 1e-6);
  const a = analyse([[220], [1000, 1000]], 5);
  near(a.req, 720); near(a.i, 5 / 720); near(a.stageV[0] + a.stageV[1], 5);
  near(a.rows[1].i + a.rows[2].i, a.i); near(a.rows.reduce((s, r) => s + r.p, 0), a.p);
  assert.equal(expression([[1], [2, 3], [4]]), 'R1 + (R2 ∥ R3) + R4');
});
test('divider, loaded and unloaded', () => {
  near(E.divider(5, 10e3, 20e3).vout, 10 / 3); near(E.divider(5, 10e3, 10e3, 10e3).vout, 5 / 3);
  near(E.divider(5, 10e3, 10e3).rth, 5000); near(E.divider(9, 1e3, 2e3).iIn, 3e-3);
});
test('voltage-divider challenges', () => {
  assert.deepEqual(Object.keys(DIV), ['level-shift-5v-3v3', 'adc-battery', 'loaded']);
  const L = (r1, r2) => divCheck('level-shift-5v-3v3', { r1, r2 });
  assert.ok(L(10e3, 18e3).ok); assert.ok(L(1e3, 1.8e3).ok); // 1.79 mA is inside the 2.5 mA budget
  assert.match(L(10e3, 20e3).text, /above the 3.3 V rail/); assert.match(L(1e3, 10e3).text, /absolute maximum/);
  assert.match(L(10e3, 10e3).text, /2\.50 V is above|only by/); assert.match(L(10e3, 4.7e3).text, /below the typical input-high/);
  assert.match(L(100, 180).text, /draws/); assert.match(L(100e3, 180e3).text, /source/);
  const B = (r1, r2) => divCheck('adc-battery', { r1, r2 });
  assert.ok(B(200e3, 100e3).ok); assert.match(B(10e3, 10e3).text, /absolute maximum/); assert.match(B(2e3, 1e3).text, /budget/); assert.match(B(100e3, 10e3).text, /throwing away/);
  const D = (r1, r2) => divCheck('loaded', { r1, r2 });
  assert.equal(D(10e3, 10e3).ok, false); assert.ok(D(1e3, 1e3).ok); assert.ok(D(3.3e3, 10e3).ok); assert.match(D(100, 100).text, /burns/);
  assert.match(D(3.3e3, 10e3).text, /compensated/); assert.match(D(470, 470).text, /stiff/);
});
test('ADC maths', () => {
  assert.equal(E.adcCode(0), 0); assert.equal(E.adcCode(3.3), 4095); assert.equal(E.adcCode(5), 4095); assert.equal(E.adcCode(-1), 0);
  assert.equal(E.adcCode(1.65), 2048); assert.equal(E.adcCode(1.2, 3.3, 4), 5); near(E.adcVoltage(2048), 1.65); near(E.adcLsb(3.3, 12), 3.3 / 4096);
  near(E.aliasFrequency(9, 10), 1); near(E.aliasFrequency(3, 10), 3); near(E.aliasFrequency(10, 10), 0); near(E.aliasFrequency(12, 10), 2);
  const p = samplingPlan({ f: 9, fs: 10, bits: 8, vref: 3.3, amp: 1, offset: 1.65 });
  assert.ok(p.aliased); near(p.fApparent, 1); assert.equal(p.levels, 256); assert.equal(p.clipsHigh, false);
  // the alias sine passes through the same sample points
  for (let k = 0; k < 20; k++) near(Math.sin(2 * Math.PI * 9 * k / 10), Math.sin(2 * Math.PI * p.fSigned * k / 10), 1e-9);
  assert.ok(samplingPlan({ f: 5, fs: 50, bits: 8, vref: 3.3, amp: 2, offset: 1.65 }).clipsHigh);
  assert.equal(E.sampleSine({ f: 5, fs: 50, amp: 1, offset: 1.65, duration: 0.5 }).length, 26);
});
test('RC response', () => {
  near(E.rcTau(10e3, 100e-9), 1e-3); near(E.rcVoltage(0, 3.3, 1e-3, 1e-3), 3.3 * (1 - Math.exp(-1)));
  near(E.rcTimeTo(0, 3.3, 3.3 * 0.7, 1e-3), -1e-3 * Math.log(0.3)); assert.equal(E.rcTimeTo(0, 3.3, 4, 1e-3), Infinity);
  near(E.rcTimeTo(3.3, 0, 0.99, 1e-3), -1e-3 * Math.log(0.3)); near(E.rcCutoff(10e3, 100e-9), 159.1549, 1e-5);
});
test('debounce simulation', () => {
  const edges = E.bounceEdges({ bounceMs: 4, seed: 7 });
  assert.ok(edges.length > 6); assert.equal(edges[edges.length - 1].closed, false);
  const run = (r, c) => E.simulateDebounce({ r, c, edges });
  const good = run(10e3, 100e-9), none = run(100, 1e-9), huge = run(1e6, 1e-6);
  assert.ok(good.rawEdges > 6); assert.equal(good.outEdges, 2); assert.equal(debounceVerdict(good).level, 'ok');
  assert.ok(none.outEdges > 2); assert.equal(debounceVerdict(none).level, 'bad');
  assert.equal(huge.outEdges, 0); assert.match(debounceVerdict(huge).text, /never/);
  assert.equal(E.simulateDebounce({ r: 10e3, c: 100e-9, edges: E.bounceEdges({ bounceMs: 0 }) }).rawEdges, 2);
});
test('LED circuit and challenge', () => {
  near(E.ledCircuit(3.3, 1.8, 330).i, 1.5 / 330); assert.equal(E.ledCircuit(3.3, 3.4, 100).i, 0); near(E.ledResistorFor(5, 2, 0.01), 300);
  assert.ok(LED['gpio-3v3-red'].title);
  for (const r of [270, 330, 390, 470]) assert.ok(ledCheck('gpio-3v3-red', r).ok, String(r));
  assert.match(ledCheck('gpio-3v3-red', 0).text, /no resistor/i); assert.match(ledCheck('gpio-3v3-red', 47).text, /20 mA/);
  assert.match(ledCheck('gpio-3v3-red', 150).text, /pin is not/); assert.match(ledCheck('gpio-3v3-red', 220).text, /margin/); assert.match(ledCheck('gpio-3v3-red', 1000).text, /dimmer/);
});
test('transistor switch models and motor challenge', () => {
  const on = evaluate({ type: 'nmos', device: 'logic' }), part = evaluate({ type: 'nmos', device: 'standard' });
  assert.equal(on.region, 'on'); near(on.iLoad, 12 / 24.05); assert.ok(on.p < 0.05);
  assert.equal(part.region, 'partial'); assert.ok(part.iLoad < 0.1);
  assert.equal(evaluate({ type: 'nmos', device: 'standard', vdrive: 2.5 }).region, 'off');
  assert.equal(evaluate({ type: 'nmos', device: 'logic', state: 'reset', pulldown: false }).region, 'undefined');
  assert.equal(evaluate({ type: 'nmos', device: 'logic', state: 'reset', pulldown: true }).region, 'off');
  const lin = evaluate({ type: 'npn', device: 'small', rb: 1000 }); assert.equal(lin.region, 'linear'); near(lin.iLoad, 0.26); assert.ok(lin.p > 1);
  assert.equal(evaluate({ type: 'npn', device: 'small', rb: 100 }).region, 'saturated');
  assert.ok(TR.motor.title);
  const C = (o) => trCheck('motor', { type: 'nmos', device: 'logic', flyback: true, pulldown: true, rb: 1000, ...o });
  assert.ok(C({}).ok); assert.match(C({ device: 'standard' }).text, /Threshold is where/); assert.match(C({ flyback: false }).text, /inductor/); assert.match(C({ pulldown: false }).text, /reset/);
  assert.match(C({ type: 'npn', device: 'small', rb: 1000 }).text, /not saturated/); assert.match(C({ type: 'npn', device: 'small', rb: 100 }).text, /above its/);
  assert.match(C({ type: 'npn', device: 'small', rb: 470 }).text, /wrong tool/);
  for (const rb of E.eSeriesValues('E12', 1, 5)) for (const device of ['small', 'power']) assert.equal(C({ type: 'npn', device, rb }).ok, false);
});
test('GPIO pin solver', () => {
  const S = E.gpioSolve;
  assert.ok(S({ mode: 'in' }).floating); assert.equal(S({ mode: 'in', pull: 'up' }).logic, 1); assert.equal(S({ mode: 'in', pull: 'down' }).logic, 0);
  assert.equal(S({ mode: 'in', pull: 'up', ext: 'button-gnd', pressed: true }).logic, 0); assert.equal(S({ mode: 'in', pull: 'up', ext: 'button-gnd' }).logic, 1);
  assert.ok(S({ mode: 'in', ext: 'button-gnd' }).floating);
  assert.ok(S({ mode: 'od', level: 1 }).floating); assert.equal(S({ mode: 'od', level: 1, ext: 'pullup-ext' }).logic, 1); assert.equal(S({ mode: 'od', level: 0, ext: 'pullup-ext' }).logic, 0);
  near(S({ mode: 'od', level: 0, ext: 'pullup-ext' }).iPin, -3.3 / 4730, 1e-6);
  const c = S({ mode: 'pp', level: 1, ext: 'short-gnd' }); assert.ok(c.contention); assert.ok(c.iPin > 0.1);
  const l = S({ mode: 'pp', level: 1, ext: 'led-gnd' }); assert.ok(l.ledOn); near(l.iLed, 1.5 / 360); assert.equal(S({ mode: 'pp', level: 0, ext: 'led-gnd' }).ledOn, false);
  assert.ok(S({ mode: 'pp', level: 0, ext: 'led-vdd' }).ledOn); assert.equal(S({ mode: 'pp', level: 1, ext: 'led-vdd' }).ledOn, false);
  const five = S({ mode: 'in', ext: 'drive-5v' }); near(five.v, 3.9); assert.ok(five.iClamp > 0.01);
  assert.ok(S({ mode: 'in', ext: 'led-gnd' }).weak);
  assert.deepEqual(experimentsHit({ mode: 'in', pull: 'none', ext: 'none' }), ['floating']);
  assert.deepEqual(experimentsHit({ mode: 'in', pull: 'up', ext: 'button-gnd', pressed: true }), ['pullup-pressed']);
  assert.deepEqual(experimentsHit({ mode: 'od', level: 1, pull: 'none', ext: 'none' }), ['od-no-pull']);
  assert.deepEqual(experimentsHit({ mode: 'od', level: 1, pull: 'up', ext: 'none' }), ['od-pull']);
  assert.deepEqual(experimentsHit({ mode: 'pp', level: 1, pull: 'none', ext: 'button-gnd', pressed: true }), ['contention']);
  assert.equal(Object.keys(EXPERIMENTS).length, 6); assert.ok(GP.experiments.title);
  assert.deepEqual(sampleReads(S({ mode: 'in', pull: 'up' })), Array(16).fill(1));
  const noise = sampleReads(S({ mode: 'in' }), 3); assert.ok(noise.includes(0) && noise.includes(1));
});
test('PWM resolution against frequency', () => {
  assert.equal(E.pwmMaxBits(80e6, 5000), 13); assert.equal(E.pwmMaxBits(80e6, 1000), 16); assert.equal(E.pwmMaxBits(1e6, 1e6), 0); assert.equal(E.pwmMaxBits(1e6, 2e6), 0);
  assert.equal(E.pwmMaxBits(8e6, 31250), 8); near(E.pwmMaxFreq(80e6, 13), 9765.625);
  assert.deepEqual(E.pwmQuantise(0.5, 8), { count: 128, steps: 256, duty: 0.5, stepPct: 100 / 256 }); assert.equal(E.pwmQuantise(0.3, 2).duty, 0.25);
  near(E.pwmAverage(3.3, 0.25), 0.825);
  const ok = pwmPlan({ fclk: 80e6, freq: 5000, bits: 10, duty: 0.25 }), bad = pwmPlan({ fclk: 80e6, freq: 5000, bits: 16, duty: 0.25 });
  assert.ok(ok.ok); assert.equal(ok.count, 256); assert.equal(bad.ok, false); assert.equal(bad.effBits, 13);
  assert.equal(loadEffects('led', 30)[0][0], 'bad'); assert.equal(loadEffects('led', 1000)[0][0], 'ok'); assert.equal(loadEffects('motor', 1000)[0][0], 'warn'); assert.equal(loadEffects('motor', 25e3)[0][0], 'ok');
});
