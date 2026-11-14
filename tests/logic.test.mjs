// Pure-logic tests for the logic tools: crc.js, packet-explorer, logic-analyzer, protocol-debug.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sum8, xor8, crc8, crc16ccitt, crc32, crc8Steps, checkBytes, CHECKS } from '../js/sim/crc.js';
import * as PK from '../js/widgets/packet-explorer.js';
import * as LA from '../js/widgets/logic-analyzer.js';
import * as PD from '../js/widgets/protocol-debug.js';

const ascii = (t) => [...t].map((c) => c.charCodeAt(0));
const V = ascii('123456789');

test('CRC check values for "123456789"', () => {
  assert.equal(crc8(V), 0xF4);
  assert.equal(crc16ccitt(V), 0x29B1);
  assert.equal(crc32(V), 0xCBF43926);
  assert.equal(crc8([]), 0x00);
  assert.equal(crc16ccitt([]), 0xFFFF);
  assert.equal(crc32([]), 0);
});
test('sum and xor', () => {
  assert.equal(sum8(V), 0xDD);
  assert.equal(xor8(V), 0x31);
  assert.equal(sum8([0xFF, 0x02]), 0x01);
});
test('crc8Steps ends at crc8 and has 9 steps per byte', () => {
  const st = crc8Steps(V);
  assert.equal(st.length, V.length * 9);
  assert.equal(st.at(-1).after, 0xF4);
  assert.equal(st[0].phase, 'load');
  for (let i = 1; i < st.length; i++) assert.equal(st[i].before, st[i - 1].after);
  for (const s of st.filter((x) => x.phase === 'shift')) assert.equal(s.after, s.xored ? s.shifted ^ 0x07 : s.shifted);
  for (const data of [[0], [0xFF], [1, 2, 3, 0x7E]]) assert.equal(crc8Steps(data).at(-1).after, crc8(data));
});
test('checkBytes sends CRC-16 high byte first', () => {
  assert.deepEqual(checkBytes('crc16', V), [0x29, 0xB1]);
  assert.deepEqual(checkBytes('none', V), []);
  assert.equal(CHECKS.crc8.size, 1);
});

test('frame layout and stuffing round trip', () => {
  const f = PK.buildFrame({ type: 1, seq: 5, payload: ascii('Hi'), check: 'crc8' });
  assert.deepEqual(f.wire.slice(0, 6), [0x7E, 2, 1, 5, 0x48, 0x69]);
  assert.equal(f.wire[6], crc8([2, 1, 5, 0x48, 0x69]));
  const raw = [0x7E, 0x7D, 0x00, 0x5E];
  assert.deepEqual(PK.stuff(raw), [0x7D, 0x5E, 0x7D, 0x5D, 0x00, 0x5E]);
  assert.deepEqual(PK.unstuff(PK.stuff(raw)), raw);
  const g = PK.buildFrame({ payload: [0x7E, 0x7D], stuffing: true });
  assert.equal(g.wire.indexOf(0x7E, 1), -1, 'no raw SOF after the first byte');
});
test('receiver accepts good frames for every check, with and without stuffing', () => {
  for (const check of Object.keys(CHECKS)) for (const stuffing of [false, true]) {
    const f = PK.buildFrame({ type: 9, seq: 200, payload: [1, 0x7E, 0x7D, 4], check, stuffing });
    const r = PK.receive([...f.wire, ...f.wire], { check, stuffing });
    assert.equal(r.frames.length, 2, `${check} ${stuffing}`);
    assert.ok(r.frames.every((x) => x.ok));
    assert.deepEqual(r.frames[0].payload, [1, 0x7E, 0x7D, 4]);
    assert.equal(r.pending, null);
  }
});
test('receiver drops a corrupted frame', () => {
  const f = PK.buildFrame({ payload: ascii('Hello') });
  const w = f.wire.slice(); w[5] ^= 0x10;
  const r = PK.receive(w);
  assert.equal(r.frames[0].ok, false);
});
test('late-joining receiver: false sync without stuffing, clean resync with it', () => {
  const mk = (stuffing) => { const a = PK.buildFrame({ payload: [0x41, 0x7E, 0x42, 0x43], stuffing }); const b = PK.buildFrame({ type: 2, payload: [0x6F, 0x6B], stuffing }); return [...a.wire, ...b.wire]; };
  const plain = PK.receive(mk(false), { start: 4 });
  assert.equal(plain.frames.filter((x) => x.ok).length, 0);
  const st = PK.receive(mk(true), { stuffing: true, start: 4 });
  assert.equal(st.frames.filter((x) => x.ok).length, 1);
  assert.deepEqual(st.frames.find((x) => x.ok).payload, [0x6F, 0x6B]);
});
test('trusting LEN overflows the buffer; bounds check stops it', () => {
  const f = PK.buildFrame({ payload: new Array(20).fill(0x41) });
  const r = PK.receive(f.wire);
  assert.equal(r.overflow.length, 4);
  assert.equal(r.overflow[0].offset, PK.BUF_SIZE);
  assert.equal(r.frames[0].ok, true, 'a valid CRC does not prevent the overflow');
  const safe = PK.receive(f.wire, { boundsCheck: true });
  assert.equal(safe.overflow.length, 0);
  assert.match(safe.frames[0].reason, /exceeds/);
  // a lying LEN with a short payload leaves the receiver waiting
  const lie = PK.buildFrame({ payload: [1, 2, 3], len: 40 });
  const p = PK.receive(lie.wire);
  assert.equal(p.pending.state, 'BODY');
  assert.equal(p.overflow.length, 0);
});
test('corruption tools and which checks notice', () => {
  const d = [5, 1, 5, ...ascii('Hello')];
  assert.deepEqual(PK.flipBit([0], 0, 7), [0x80]);
  assert.deepEqual(PK.swapBytes([1, 2, 3], 0, 2), [3, 2, 1]);
  assert.deepEqual(PK.burst([0, 0], 6, 4), [0x03, 0xC0]);
  const sw = PK.detection(d, PK.swapBytes(d, 3, 4));
  assert.equal(sw.sum.detected, false); assert.equal(sw.xor.detected, false);
  assert.equal(sw.crc8.detected, true); assert.equal(sw.crc16.detected, true);
  const comp = d.slice(); comp[3]++; comp[4]--;
  const c = PK.detection(d, comp);
  assert.equal(c.sum.detected, false); assert.equal(c.crc8.detected, true);
  const two = PK.detection(d, PK.flipBit(PK.flipBit(d, 3, 5), 4, 5));
  assert.equal(two.xor.detected, false); assert.equal(two.crc8.detected, true);
  // every single-bit error and every burst of up to 8 bits is caught by CRC-8
  for (let bit = 0; bit < d.length * 8; bit++) for (let len = 1; len <= 8 && bit + len <= d.length * 8; len++) assert.ok(PK.detection(d, PK.burst(d, bit, len)).crc8.detected);
  assert.equal(PK.detection(d, d).crc8.changed, false);
});
test('fix-crc judging', () => {
  const c = PK.CHALLENGES['fix-crc'].frame.content;
  assert.equal(PK.checkFixCrc(crc8(c).toString(16)).ok, true);
  assert.equal(PK.checkFixCrc('0x' + crc8(c).toString(16).toUpperCase()).ok, true);
  assert.match(PK.checkFixCrc(sum8(c).toString(16)).msg, /additive/);
  assert.match(PK.checkFixCrc(crc8([0x7E, ...c]).toString(16)).msg, /SOF/);
  assert.equal(PK.checkFixCrc('zz').ok, false);
  assert.equal(PK.checkFixCrc(PK.CHALLENGES['fix-crc'].frame.wrong.toString(16)).ok, false);
  assert.ok(PK.CHALLENGES['find-length-bug'].title);
  assert.equal(PK.FIX_OPTIONS.filter((o) => o.right).length, 1);
});
test('parsePayload', () => {
  assert.deepEqual(PK.parsePayload('7e 01', 'hex').bytes, [0x7E, 1]);
  assert.ok(PK.parsePayload('7', 'hex').error);
  assert.ok(PK.parsePayload('xy', 'hex').error);
  assert.deepEqual(PK.parsePayload('Hi', 'ascii').bytes, [0x48, 0x69]);
});

const dec = (id, cfg) => LA.runDecoder(LA.CAPTURES[id].channels, cfg);
test('captures exist with title, question, channels', () => {
  for (const id of ['uart-9600-hello', 'uart-unknown-baud', 'i2c-read', 'spi-mode0', 'spi-mode3', 'mystery']) {
    const c = LA.CAPTURES[id];
    assert.ok(c.title && c.question && c.channels.length && c.duration > 0 && c.fields.length, id);
  }
  assert.equal(LA.CAPTURES.mystery.channels.length, 4);
});
test('UART decoders: right settings read the text, wrong baud gives errors', () => {
  assert.equal(dec('uart-9600-hello', { proto: 'uart', ch: 0, baud: 9600 }).text, 'Hello');
  assert.equal(dec('uart-9600-hello', { proto: 'uart', ch: 0, baud: 9600 }).errors, 0);
  const wrong = dec('uart-9600-hello', { proto: 'uart', ch: 0, baud: 19200 });
  assert.notEqual(wrong.text, 'Hello'); assert.ok(wrong.errors > 0);
  assert.ok(dec('uart-9600-hello', { proto: 'uart', ch: 0, baud: 9600, parity: 'E' }).errors > 0);
  assert.equal(dec('uart-9600-hello', { proto: 'uart', ch: 1, baud: 9600 }).bytes.length, 0);
  assert.equal(dec('uart-unknown-baud', { proto: 'uart', ch: 0, baud: 38400 }).text, 'solder');
});
test('unknown-baud capture: narrowest pulse is one bit at 38400', () => {
  const e = LA.CAPTURES['uart-unknown-baud'].channels[0].edges;
  let min = Infinity;
  for (let i = 2; i < e.length; i++) min = Math.min(min, e[i].t - e[i - 1].t);
  assert.ok(Math.abs(1 / min - 38400) < 1);
});
test('I2C decoder needs the right channel assignment', () => {
  const ok = dec('i2c-read', { proto: 'i2c', scl: 1, sda: 0 });
  assert.equal(ok.addr, 0x48); assert.deepEqual(ok.bytes, [0x00, 0x19, 0x80]); assert.equal(ok.errors, 0);
  const swapped = dec('i2c-read', { proto: 'i2c', scl: 0, sda: 1 });
  assert.ok(swapped.errors > 0); assert.match(swapped.summary, /wrong way round/);
  assert.ok(dec('i2c-read', { proto: 'i2c', scl: 0, sda: 0 }).problem);
  const m = dec('mystery', { proto: 'i2c', scl: 3, sda: 1 });
  assert.equal(m.addr, 0x3C); assert.equal(m.text, 'OPEN');
});
test('SPI decoder: modes and channel assignment', () => {
  const good = dec('spi-mode0', { proto: 'spi', cs: 0, sclk: 1, mosi: 2, miso: 3, mode: 0 });
  assert.deepEqual(good.miso, [0x00, 0xEF, 0x40, 0x18]); assert.deepEqual(good.mosi, [0x9F, 0, 0, 0]); assert.equal(good.errors, 0);
  assert.ok(dec('spi-mode0', { proto: 'spi', cs: 0, sclk: 1, mosi: 2, miso: 3, mode: 1 }).marginal > 0, 'falling-edge sampling is flagged');
  assert.ok(dec('spi-mode0', { proto: 'spi', cs: 0, sclk: 0, mosi: 2, miso: 3, mode: 0 }).problem);
  const m3 = (mode) => dec('spi-mode3', { proto: 'spi', cs: 1, sclk: 0, mosi: 3, miso: 2, mode });
  assert.equal(m3(3).text.slice(-4), 'CPOL'); assert.equal(m3(3).errors, 0);
  assert.notEqual(m3(1).text.slice(-4), 'CPOL'); assert.notEqual(m3(2).text.slice(-4), 'CPOL');
});
test('capture answers: correct ones pass, typical mistakes get specific feedback', () => {
  const C = LA.CAPTURES;
  assert.equal(C['uart-9600-hello'].check({ text: 'Hello' }).ok, true);
  assert.match(C['uart-9600-hello'].check({ text: 'hello' }).msg, /case/);
  assert.equal(C['uart-9600-hello'].check({ text: '' }).ok, false);
  assert.equal(C['uart-unknown-baud'].check({ baud: '38400', text: 'solder' }).ok, true);
  assert.equal(C['uart-unknown-baud'].check({ baud: '38462', text: 'solder' }).ok, true);
  assert.match(C['uart-unknown-baud'].check({ baud: '19200', text: 'solder' }).msg, /2 bits wide/);
  assert.equal(C['uart-unknown-baud'].check({ baud: '9600', text: 'solder' }).ok, false);
  assert.equal(C['uart-unknown-baud'].check({ baud: '38400', text: 'nope' }).ok, false);
  assert.equal(C['i2c-read'].check({ addr: '48', data: '19 80' }).ok, true);
  assert.equal(C['i2c-read'].check({ addr: '0x48', data: '0x19, 0x80' }).ok, true);
  assert.match(C['i2c-read'].check({ addr: '90', data: '19 80' }).msg, /shifted right/);
  assert.match(C['i2c-read'].check({ addr: '48', data: '00' }).msg, /register pointer/);
  assert.equal(C['spi-mode0'].check({ data: 'EF 40 18' }).ok, true);
  assert.match(C['spi-mode0'].check({ data: '9F 00 00 00' }).msg, /MOSI/);
  assert.equal(C['spi-mode3'].check({ mode: '3', text: 'CPOL' }).ok, true);
  assert.match(C['spi-mode3'].check({ mode: '0', text: 'CPOL' }).msg, /idles high/);
  assert.equal(C['spi-mode3'].check({ mode: '1', text: 'CPOL' }).ok, false);
  assert.equal(C.mystery.check({ proto: 'I2C', addr: '3C', text: 'OPEN' }).ok, true);
  assert.equal(C.mystery.check({ proto: 'SPI', addr: '3C', text: 'OPEN' }).ok, false);
  assert.match(C.mystery.check({ proto: 'I2C', addr: '78', text: 'OPEN' }).msg, /Shift it right/);
});
test('viewer helpers', () => {
  const e = [{ t: 0, v: 1 }, { t: 1, v: 0 }, { t: 2, v: 1 }];
  assert.equal(LA.stepEdge(e, 0, 1), 1); assert.equal(LA.stepEdge(e, 1, 1), 2); assert.equal(LA.stepEdge(e, 2, 1), null);
  assert.equal(LA.stepEdge(e, 2, -1), 1); assert.equal(LA.stepEdge(e, 1, -1), null);
  const [a, b] = LA.zoomWindow(0, 10, 0.5, 5, 10);
  assert.equal(a, 2.5); assert.equal(b, 7.5);
  assert.deepEqual(LA.zoomWindow(0, 5, 4, 2, 10), [0, 10]);
  assert.deepEqual(LA.parseHexBytes('0x19, 80'), [0x19, 0x80]);
  assert.equal(LA.parseHexBytes('hello'), null);
  assert.equal(LA.asText([0x41, 0x00]), 'A\\x00');
});

test('scenarios are well formed', () => {
  const ids = ['tx-rx-swapped', 'baud-mismatch', 'no-pullups', 'wrong-address', 'spi-mode', 'no-common-ground', 'level-mismatch'];
  assert.deepEqual(Object.keys(PD.SCENARIOS).sort(), ids.slice().sort());
  for (const id of ids) {
    const s = PD.SCENARIOS[id];
    assert.ok(s.title && s.setup && s.symptom.text, id);
    assert.ok(s.checks.length >= 5);
    assert.equal(new Set(s.checks.map((c) => c.id)).size, s.checks.length);
    assert.equal(s.diagnoses.filter((d) => d.right).length, 1);
    assert.equal(s.fixes.filter((d) => d.right).length, 1);
    for (const d of s.diagnoses) if (!d.right) assert.ok(s.checks.some((c) => c.id === d.rule), `${id}/${d.id} names a check that rules it out`);
    for (const c of s.checks) assert.ok(c.label && c.short && (c.text || c.term || c.wave || c.meter));
  }
});
test('diagnosis feedback refers to the evidence gathered', () => {
  const none = PD.judgeDiagnosis('baud-mismatch', 'gnd', new Set());
  assert.equal(none.ok, false); assert.match(none.msg, /have not tested/);
  const seen = PD.judgeDiagnosis('baud-mismatch', 'gnd', new Set(['gnd']));
  assert.match(seen.msg, /Your own evidence rules it out: the grounds are connected/);
  const right = PD.judgeDiagnosis('baud-mismatch', 'baud', new Set(['measure']));
  assert.equal(right.ok, true); assert.match(right.msg, /8\.68/);
});
test('scenario stories match the simulator', () => {
  const bad = PD.spiModeSim(1), good = PD.spiModeSim(0);
  assert.deepEqual(good.peripheralSaw, [0x8F, 0x00]); assert.equal(good.controllerRead[1], 0x5A);
  assert.equal(bad.peripheralSaw[0], 0x47); assert.equal(bad.controllerRead[1], 0x00);
  const g = PD.baudGarbage('Temp: 23 C\r\n', 115200, 9600);
  assert.ok(g.bytes.length > 0 && g.bytes.length < 12);
  assert.notEqual(PD.termText(g.bytes), 'Temp: 23 C\n');
  assert.equal(PD.termText(PD.baudGarbage('Hi', 9600, 9600).bytes), 'Hi');
  const e = [{ t: 0, v: 1 }, { t: 10, v: 0 }];
  const n = PD.addGlitches(e, [5, 10], 1);
  assert.equal(n.length, 4); assert.deepEqual(n[1], { t: 5, v: 0 });
});
