import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleWave, measure, toLogicSingle, toLogicSchmitt, transitions, undefinedFraction } from '../js/sim/signal.js';

test('sine: RMS of AC part is amplitude / sqrt(2), mean is the offset', () => {
  const m = measure(sampleWave({ shape: 'sine', amp: 1, offset: 1.5, freq: 4 }, 4000));
  assert.ok(Math.abs(m.acRms - Math.SQRT1_2) < 0.01);
  assert.ok(Math.abs(m.mean - 1.5) < 0.01);
  assert.ok(Math.abs(m.pp - 2) < 0.01);
});
test('square: AC RMS equals amplitude', () => {
  const m = measure(sampleWave({ shape: 'square', amp: 1.2, offset: 1.65, freq: 2 }, 4000));
  assert.ok(Math.abs(m.acRms - 1.2) < 0.01);
});
test('dc: no AC content', () => {
  const m = measure(sampleWave({ shape: 'dc', offset: 2 }, 100));
  assert.equal(m.pp, 0); assert.equal(m.mean, 2);
});
test('slow noisy edges: single threshold over-counts, hysteresis does not', () => {
  const v = sampleWave({ shape: 'slow', amp: 1.4, offset: 1.65, freq: 2, noise: 0.22, edge: 0.6 }, 400);
  const single = transitions(toLogicSingle(v, 1.65)), sch = transitions(toLogicSchmitt(v, 0.99, 2.31, 0));
  assert.equal(sch, 4, 'two full cycles starting low: rise, fall, rise, fall');
  assert.ok(single > sch, `single threshold saw ${single}`);
});
test('clean fast square: both inputs agree', () => {
  const v = sampleWave({ shape: 'square', amp: 1.4, offset: 1.65, freq: 2, noise: 0 }, 400);
  assert.equal(transitions(toLogicSingle(v, 1.65)), transitions(toLogicSchmitt(v, 0.99, 2.31, 1)));
});
test('undefined band fraction', () => {
  assert.equal(undefinedFraction([0, 1.5, 3.3, 2], 0.99, 2.31), 0.5);
});
