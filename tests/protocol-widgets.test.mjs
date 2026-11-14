// Pure logic exported by uart-terminal, i2c-visualizer, spi-analyzer and can-arbitration.
import test from 'node:test';
import assert from 'node:assert/strict';
import { i2cEncode, i2cDecode } from '../js/sim/signals.js';
import { parseFormat, frameBits, link, makePeer, stopDrift, PEERS } from '../js/widgets/uart-terminal.js';
import { DEVICES as I2C, riseTime, RISE_LIMIT, rMin, tempToBytes, bytesToTemp, makeSensor, makeEeprom, runPlan, makeChallenge, checkDecode } from '../js/widgets/i2c-visualizer.js';
import { MODES, DEVICES as SPI, transact, makeCapture, modeFeedback } from '../js/widgets/spi-analyzer.js';
import { parseId, explainStep, makeChallenge as canChallenge } from '../js/widgets/can-arbitration.js';
import { canArbitrate } from '../js/sim/signals.js';
import { niceStep, tracePath } from '../js/widgets/_wave.js';

const str = (t) => [...t].map((c) => c.charCodeAt(0));
const text = (bytes) => String.fromCharCode(...bytes);
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

test('uart-terminal: format parsing and frame length', () => {
  assert.deepEqual(parseFormat('8N1'), { dataBits: 8, parity: 'N', stopBits: 1 });
  assert.deepEqual(parseFormat('7e2'), { dataBits: 7, parity: 'E', stopBits: 2 });
  assert.deepEqual(parseFormat('junk'), { dataBits: 8, parity: 'N', stopBits: 1 });
  assert.equal(frameBits(parseFormat('8N1')), 10);
  assert.equal(frameBits(parseFormat('8E2')), 12);
  assert.deepEqual(Object.keys(PEERS), ['echo', 'sensor', 'console']);
});

test('uart-terminal: matched link is clean, mismatched link is deterministic garbage', () => {
  const a = { baud: 9600, ...parseFormat('8N1') };
  const ok = link(str('status\r'), a, a);
  assert.equal(text(ok.got.map((g) => g.byte)), 'status\r');
  const bad1 = link(str('status\r'), a, { ...a, baud: 19200 });
  const bad2 = link(str('status\r'), a, { ...a, baud: 19200 });
  assert.notEqual(text(bad1.got.map((g) => g.byte)), 'status\r');
  assert.deepEqual(bad1.got.map((g) => g.byte), bad2.got.map((g) => g.byte));
  assert.ok(bad1.got.some((g) => g.framingError));
  const par = link(str('abc'), a, { ...a, parity: 'E' });        // receiver expects a parity bit that is not there
  assert.ok(par.got.some((g) => g.framingError || g.parityError));
});

test('uart-terminal: stop-bit drift crosses half a bit near 5 % for 8N1', () => {
  const c = parseFormat('8N1');
  assert.ok(stopDrift(c, 0.02) < 0.25);
  assert.ok(stopDrift(c, 0.05) < 0.5);
  assert.ok(stopDrift(c, 0.06) > 0.5);
  assert.ok(stopDrift(parseFormat('8E1'), 0.055) > 0.5);       // one more bit before the stop sample
});

test('uart-terminal: console and echo peers', () => {
  const p = makePeer('console');
  const type = (s) => text(str(s).flatMap((b) => p.rx(b)));
  assert.match(type('help\r'), /^help\r\ncommands: help, led on, led off, status\r\n> $/);
  assert.match(type('led on\r\n'), /led is on/);
  assert.equal(p.led, true);
  assert.match(type('status\r'), /led=on cmds=3/);
  assert.match(type('led off\r'), /led is off/);
  assert.match(type('bogus\r'), /unknown command/);
  assert.deepEqual(makePeer('echo').rx(0x41), [0x41]);
  assert.match(text(makePeer('sensor').tick()), /^T=\d+\.\d C  n=1\r\n$/);
});

test('i2c-visualizer: rise time and limits', () => {
  assert.ok(Math.abs(riseTime(4700, 100e-12) - 398.2e-9) < 1e-9);
  assert.equal(RISE_LIMIT[100000], 1000e-9);
  assert.equal(RISE_LIMIT[400000], 300e-9);
  assert.ok(riseTime(4700, 100e-12) > RISE_LIMIT[400000]);
  assert.ok(Math.abs(rMin(3.3) - 966.67) < 0.01);
  assert.deepEqual(Object.keys(I2C), ['tmp102', 'eeprom', 'scan']);
});

test('i2c-visualizer: temperature format round trip', () => {
  assert.deepEqual(tempToBytes(25), [0x19, 0x00]);
  assert.deepEqual(tempToBytes(-0.0625), [0xff, 0xf0]);
  for (const t of [-40, -25.5, 0, 0.0625, 25, 99.9375, 125]) assert.equal(bytesToTemp(...tempToBytes(t)), t);
});

test('i2c-visualizer: sensor read plan appears on the wires and decodes back', () => {
  const targets = { 0x48: makeSensor(() => 25.5), 0x50: makeEeprom() };
  const plan = [{ start: true }, { addr: 0x48, rw: 0 }, { write: 0 }, { start: true }, { addr: 0x48, rw: 1 }, { read: true }, { read: true, last: true }, { stop: true }];
  const r = runPlan(targets, plan);
  assert.equal(r.nack, null);
  assert.equal(bytesToTemp(...r.read), 25.5);
  const w = i2cEncode(r.ops);
  const ev = i2cDecode(w.scl, w.sda);
  assert.deepEqual(ev.filter((e) => e.type === 'data').map((e) => [e.byte, e.ack]), [[0, true], [0x19, true], [0x80, false]]);
  // wrong address: NACK then stop, nothing else
  const bad = runPlan(targets, plan.map((p) => (p.addr ? { ...p, addr: 0x49 } : p)));
  assert.deepEqual(bad.ops, [{ start: true }, { addr: 0x49, rw: 0, ack: false }, { stop: true }]);
  assert.deepEqual(bad.nack, { addr: 0x49, present: false });
  // clock stretching inserts a stretch after each acknowledged address
  assert.equal(runPlan(targets, plan, { stretch: 3e-5 }).ops.filter((o) => o.stretch).length, 2);
});

test('i2c-visualizer: EEPROM write, busy NACKs, then read back', () => {
  const ee = makeEeprom(2), targets = { 0x50: ee };
  const wr = [{ start: true }, { addr: 0x50, rw: 0 }, { write: 0x10 }, { write: 0xa5 }, { stop: true }];
  const rd = [{ start: true }, { addr: 0x50, rw: 0 }, { write: 0x10 }, { start: true }, { addr: 0x50, rw: 1 }, { read: true, last: true }, { stop: true }];
  assert.deepEqual(runPlan(targets, rd).read, [0xff]);          // erased; setting the pointer alone starts no write cycle
  assert.equal(ee.busy, 0);
  assert.equal(runPlan(targets, wr).nack, null);
  assert.equal(ee.busy, 2);
  assert.deepEqual(runPlan(targets, rd).nack, { addr: 0x50, present: true });
  assert.ok(runPlan(targets, rd).nack);
  assert.deepEqual(runPlan(targets, rd).read, [0xa5]);
});

test('i2c-visualizer: decode challenge grading', () => {
  for (let i = 0; i < 50; i++) {
    const c = makeChallenge(rnd), a = c.answer;
    assert.ok(a.addr >= 0x08 && a.addr <= 0x77);
    const w = i2cEncode(c.ops), ev = i2cDecode(w.scl, w.sda);
    assert.equal(ev[1].addr, a.addr); assert.equal(ev[1].rw, a.rw); assert.equal(ev[2].byte, a.data);
    assert.equal(checkDecode(a, a).ok, true);
    assert.equal(checkDecode(a, { ...a, rw: 1 - a.rw }).ok, false);
    assert.equal(checkDecode(a, { ...a, data: a.data ^ 0x10 }).ok, false);
  }
  const a = { addr: 0x48, rw: 1, data: 0x1f };
  assert.match(checkDecode(a, { addr: 0x91, rw: 1, data: 0x1f }).msg, /all eight bits/);
  assert.match(checkDecode(a, { addr: 0x09, rw: 1, data: 0x1f }).msg, /wrong order/);
  assert.match(checkDecode(a, { addr: 0x48, rw: 0, data: 0x1f }).msg, /R\/W/);
  assert.match(checkDecode(a, { addr: 0x48, rw: 1, data: 0xf8 }).msg, /MSB first/);
  assert.match(checkDecode(a, { addr: NaN, rw: 1, data: 0x1f }).msg, /hex/);
});

test('spi-analyzer: mode table', () => {
  assert.deepEqual(MODES.map((m) => [m.cpol, m.cpha, m.idle, m.sample]), [[0, 0, 'low', 'rising'], [0, 1, 'low', 'falling'], [1, 0, 'high', 'falling'], [1, 1, 'high', 'rising']]);
});

test('spi-analyzer: matched settings work, every mismatch is detected', () => {
  for (const device of Object.keys(SPI)) for (const c of [0, 1, 2, 3]) for (const p of [0, 1, 2, 3]) {
    const r = transact({ device, ctrlMode: c, periMode: p });
    assert.equal(r.ok, c === p, `${device} ${c}/${p}`);
    if (c === p) { assert.deepEqual(r.read, r.expected); assert.deepEqual(r.marginal, { ctrl: 0, peri: 0 }); }
  }
  assert.deepEqual(transact({ device: 'id' }).read, [0, 0xb5, 0x1c, 0x42]);
  assert.deepEqual(transact({ device: 'reg' }).read, [0, 0x5a]);
  // mode 0 controller, mode 1 peripheral: reply one bit late
  assert.deepEqual(transact({ ctrlMode: 0, periMode: 1 }).read, [0x00, 0x5a, 0x8e, 0x21]);
  // bit order mismatch: 0x9F arrives as 0xF9, not a command
  const o = transact({ ctrlOrder: 'lsb' });
  assert.equal(o.periRx[0], 0xf9);
  assert.equal(o.ok, false);
});

test('spi-analyzer: capture challenge and feedback', () => {
  const seen = new Set();
  for (let i = 0; i < 60; i++) {
    const c = makeCapture(rnd);
    seen.add(c.mode);
    assert.equal(c.sig.sclk[0].v, c.mode >> 1);
    assert.equal(modeFeedback(c.mode, c.mode).ok, true);
    for (const g of [0, 1, 2, 3]) if (g !== c.mode) {
      const f = modeFeedback(c.mode, g);
      assert.equal(f.ok, false);
      assert.ok(!f.msg.includes('mode ' + c.mode) && !f.msg.includes('Mode ' + c.mode), 'feedback must not name the answer');
    }
  }
  assert.equal(seen.size, 4);
});

test('can-arbitration: id parsing, step explanations, challenge', () => {
  assert.equal(parseId('65A'), 0x65a);
  assert.equal(parseId('0x7ff'), 0x7ff);
  assert.equal(parseId('800'), null);
  assert.equal(parseId('zz'), null);
  const r = canArbitrate([0x65a, 0x652, 0x123]);
  assert.match(explainStep(r.steps[0]), /Start of frame/);
  assert.match(explainStep(r.steps[1]), /A and B sent recessive/);
  assert.match(explainStep(r.steps[5]), /only C/);
  for (let i = 0; i < 100; i++) {
    const ids = canChallenge(rnd);
    assert.equal(new Set(ids).size, 3);
    assert.ok(ids.every((v) => v >= 0 && v <= 0x7ff));
    const w = canArbitrate(ids).winners;
    assert.deepEqual(w, [ids.indexOf(Math.min(...ids))]);
  }
});

test('_wave: tick steps and trace path', () => {
  assert.equal(niceStep(1e-3, 5), 2e-4);
  assert.equal(niceStep(10, 10), 1);
  assert.equal(niceStep(0.9e-6, 4), 5e-7);
  const d = tracePath([{ t: 0, v: 1 }, { t: 1, v: 0 }, { t: 2, v: 1 }], 0, 3, (t) => t * 10, 0, 20);
  assert.equal(d, 'M0 0H10V20H20V0H30');
  assert.match(tracePath([{ t: 0, v: 0 }, { t: 1, v: 1 }], 0, 3, (t) => t * 10, 0, 20, 0.3), /L/);
});
