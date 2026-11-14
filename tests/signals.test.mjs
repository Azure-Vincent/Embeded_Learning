import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sample, uartEncode, uartDecode, i2cEncode, i2cDecode, spiEncode, spiDecode, spiPeripheral, spiSampleLevel,
  canArbitrate, canCrc15, canStuff, canFrame,
} from '../js/sim/signals.js';

const sorted = (edges) => edges.every((e, i) => i === 0 || (e.t > edges[i - 1].t && e.v !== edges[i - 1].v));

test('sample: level before, at and after edges', () => {
  const e = [{ t: 0, v: 1 }, { t: 1, v: 0 }, { t: 2, v: 1 }];
  assert.equal(sample(e, -5), 1);
  assert.equal(sample(e, 0.99), 1);
  assert.equal(sample(e, 1), 0);
  assert.equal(sample(e, 5), 1);
});

test('uart: 8N1 frame shape for 0x55 and "A"', () => {
  const u = uartEncode([0x55], { baud: 9600 });
  const T = 1 / 9600;
  assert.ok(sorted(u.edges));
  assert.equal(u.edges[0].v, 1);
  assert.equal(u.edges.length, 1 + 10);                 // 0x55 toggles every bit: start..stop
  assert.ok(Math.abs(u.duration - 12 * T) < 1e-12);
  const a = uartEncode([0x41], { baud: 9600 });
  const lv = Array.from({ length: 10 }, (_, i) => sample(a.edges, T + (i + 0.5) * T));
  assert.deepEqual(lv, [0, 1, 0, 0, 0, 0, 0, 1, 0, 1]);  // start, LSB first 1000 0010, stop
  assert.deepEqual(a.frames[0].bits.map((b) => b.kind), ['start', ...Array(8).fill('data'), 'stop']);
});

test('uart: round trip across formats', () => {
  const msg = [...Buffer.from('Hello, UART!\r\n'), 0x00, 0xff, 0x80];
  for (const baud of [300, 9600, 115200, 1000000]) for (const parity of ['N', 'E', 'O']) for (const stopBits of [1, 2]) for (const dataBits of [7, 8]) {
    const o = { baud, parity, stopBits, dataBits };
    const rx = uartDecode(uartEncode(msg, o).edges, o);
    assert.deepEqual(rx.map((r) => r.byte), msg.map((b) => b & ((1 << dataBits) - 1)), JSON.stringify(o));
    assert.ok(rx.every((r) => !r.framingError && !r.parityError), JSON.stringify(o));
  }
});

test('uart: parity bit value and parity mismatch detection', () => {
  const e = uartEncode([0x03], { parity: 'E' });        // two ones -> even parity bit 0
  assert.equal(e.frames[0].bits.find((b) => b.kind === 'parity').v, 0);
  assert.equal(uartEncode([0x03], { parity: 'O' }).frames[0].bits.find((b) => b.kind === 'parity').v, 1);
  const rx = uartDecode(uartEncode([0x03, 0x07], { parity: 'E' }).edges, { parity: 'O' });
  assert.deepEqual(rx.map((r) => r.byte), [0x03, 0x07]);
  assert.ok(rx.every((r) => r.parityError && !r.framingError));
});

test('uart: receiver at twice the baud sees doubled bits, not random bytes', () => {
  // 'U' = 0x55 at 9600 read at 19200: every bit is seen twice. Line: S 1 0 1 0 1 0 1 0 P
  const rx = uartDecode(uartEncode([0x55], { baud: 9600 }).edges, { baud: 19200 });
  // first frame: start(half of S), then S,1,1,0,0,1,1,0,0 -> data bits 0,1,1,0,0,1,1,0 = 0x66, stop sample = 0
  assert.equal(rx[0].byte, 0x66);
  assert.equal(rx[0].framingError, true);
  assert.ok(rx.length >= 2);
});

test('uart: receiver at half the baud merges bits and loses bytes', () => {
  const msg = [...Buffer.from('Hello')];
  const rx = uartDecode(uartEncode(msg, { baud: 115200 }).edges, { baud: 57600 });
  assert.ok(rx.length < msg.length);
  assert.notDeepEqual(rx.map((r) => r.byte), msg.slice(0, rx.length));
});

test('uart: small clock error is tolerated, large is not', () => {
  const msg = [...Buffer.from('The quick brown fox \x00\xff\x55\xaa')];
  const wave = uartEncode(msg, { baud: 9600 }).edges;
  for (const err of [-0.03, -0.02, 0.02, 0.03]) {
    const rx = uartDecode(wave, { baud: 9600 * (1 + err) });
    assert.deepEqual(rx.map((r) => r.byte), msg, 'err ' + err);
    assert.ok(rx.every((r) => !r.framingError));
  }
  for (const err of [-0.08, 0.08]) {
    const rx = uartDecode(wave, { baud: 9600 * (1 + err) });
    assert.ok(rx.length !== msg.length || rx.some((r, i) => r.byte !== msg[i] || r.framingError), 'err ' + err);
  }
});

test('uart: glitch shorter than half a bit is not a start bit', () => {
  const T = 1 / 9600;
  const edges = [{ t: 0, v: 1 }, { t: T, v: 0 }, { t: T * 1.2, v: 1 }];
  assert.equal(uartDecode(edges, { baud: 9600 }).length, 0);
});

const tmpRead = [
  { start: true }, { addr: 0x48, rw: 0, ack: true }, { byte: 0x00, ack: true, from: 'controller' },
  { start: true }, { addr: 0x48, rw: 1, ack: true }, { byte: 0x19, ack: true, from: 'target' }, { byte: 0x80, ack: false, from: 'target' },
  { stop: true },
];

test('i2c: SDA only changes while SCL is low, except start and stop', () => {
  const w = i2cEncode(tmpRead);
  assert.ok(sorted(w.scl) && sorted(w.sda));
  const high = w.sda.slice(1).filter((e) => sample(w.scl, e.t) === 1 && sample(w.scl, e.t - 1e-9) === 1);
  assert.equal(high.length, 3);                           // start, repeated start, stop
  assert.deepEqual(high.map((e) => e.v), [0, 0, 1]);
  assert.equal(sample(w.scl, w.duration), 1);
  assert.equal(sample(w.sda, w.duration), 1);
});

test('i2c: encode then decode gives the transaction back', () => {
  const w = i2cEncode(tmpRead, { freq: 400000 });
  const ev = i2cDecode(w.scl, w.sda);
  assert.deepEqual(ev.map((e) => e.type), ['start', 'address', 'data', 'restart', 'address', 'data', 'data', 'stop']);
  assert.deepEqual(ev.filter((e) => e.type === 'address').map((e) => [e.addr, e.rw, e.ack]), [[0x48, 0, true], [0x48, 1, true]]);
  assert.deepEqual(ev.filter((e) => e.type === 'data').map((e) => [e.byte, e.ack]), [[0x00, true], [0x19, true], [0x80, false]]);
});

test('i2c: bit period, drivers and NACK', () => {
  const w = i2cEncode([{ start: true }, { addr: 0x50, rw: 0, ack: false }, { stop: true }], { freq: 100000 });
  assert.equal(w.bits.length, 9);
  assert.ok(Math.abs(w.bits[1].t - w.bits[0].t - 1e-5) < 1e-12);
  assert.deepEqual(w.bits.map((b) => b.v), [1, 0, 1, 0, 0, 0, 0, 0, 1]);   // 0xA0 then NACK (released high)
  assert.equal(w.bits[8].driver, 'target');
  assert.equal(w.bits[7].kind, 'rw');
  assert.deepEqual(w.segments.map((s) => s.kind), ['start', 'addr', 'rw', 'ack', 'stop']);
  const ev = i2cDecode(w.scl, w.sda);
  assert.equal(ev[1].ack, false);
});

test('i2c: clock stretching lengthens the transfer without changing the data', () => {
  const plain = i2cEncode(tmpRead);
  const ops = [...tmpRead.slice(0, 5), { stretch: 50e-6 }, ...tmpRead.slice(5)];
  const st = i2cEncode(ops);
  assert.ok(Math.abs(st.duration - plain.duration - 50e-6) < 1e-12);
  assert.deepEqual(i2cDecode(st.scl, st.sda).map((e) => e.byte ?? e.addr ?? e.type), i2cDecode(plain.scl, plain.sda).map((e) => e.byte ?? e.addr ?? e.type));
});

test('spi: sampling edge per mode', () => {
  assert.deepEqual([0, 1, 2, 3].map(spiSampleLevel), [1, 0, 0, 1]);
});

test('spi: round trip in every mode and bit order', () => {
  const mosi = [0x9f, 0x00, 0xa5, 0x3c], miso = [0xff, 0xb5, 0x1c, 0x42];
  for (const mode of [0, 1, 2, 3]) for (const bitOrder of ['msb', 'lsb']) {
    const w = spiEncode({ mosi, miso, mode, bitOrder, freq: 2e6 });
    for (const k of ['cs', 'sclk', 'mosi', 'miso']) assert.ok(sorted(w[k]), k);
    assert.equal(w.sclk[0].v, mode >> 1);
    assert.equal(w.sclk.length, 1 + 64);
    assert.equal(w.sampleEdges.length, 32);
    const d = spiDecode(w, { mode, bitOrder, hold: 0.25 / 2e6 });
    assert.deepEqual(d.mosi, mosi);
    assert.deepEqual(d.miso, miso);
    assert.deepEqual(d.marginal, { mosi: 0, miso: 0 });
    assert.equal(d.extraBits, 0);
  }
});

test('spi: first MOSI bit of mode 0 is valid before the first clock edge', () => {
  const w = spiEncode({ mosi: [0x80], miso: [0x00], mode: 0, freq: 1e6 });
  assert.equal(sample(w.mosi, w.sampleEdges[0] - 1e-9), 1);
  assert.equal(sample(w.sclk, w.sampleEdges[0]), 1);
});

test('spi: wrong bit order reverses each byte', () => {
  const w = spiEncode({ mosi: [0x9f, 0x01], miso: [0x80, 0x0f], mode: 0, bitOrder: 'msb' });
  const d = spiDecode(w, { mode: 0, bitOrder: 'lsb' });
  assert.deepEqual(d.mosi, [0xf9, 0x80]);
  assert.deepEqual(d.miso, [0x01, 0xf0]);
});

test('spi: decoding a CPHA=1 capture as CPHA=0 gives data shifted by one bit', () => {
  const w = spiEncode({ mosi: [0x9f, 0x00], miso: [0x00, 0xb5], mode: 1 });
  const d = spiDecode(w, { mode: 0, hold: 0.25e-6 });
  assert.deepEqual(d.mosi, [0x9f >> 1, 0x80]);          // 0 then the first 7 bits; last bit of 0x9F lands in byte 2
  assert.deepEqual(d.miso, [0x00, 0xb5 >> 1]);
  assert.ok(d.marginal.mosi > 0);
});

test('spi peripheral: matched mode answers the command; mismatched CPHA shifts the reply', () => {
  const id = [0xb5, 0x1c, 0x42];
  const respond = (rx, n) => (rx[0] === 0x9f && n >= 1 && n <= 3 ? id[n - 1] : 0);
  for (const mode of [0, 1, 2, 3]) {
    const w = spiEncode({ mosi: [0x9f, 0, 0, 0], miso: [], mode });
    const p = spiPeripheral(w, { mode, respond });
    assert.deepEqual(p.rx, [0x9f, 0, 0, 0]);
    assert.deepEqual(spiDecode({ ...w, miso: p.miso }, { mode }).miso, [0, ...id], 'mode ' + mode);
  }
  // controller mode 0, peripheral built for mode 1: reply arrives one bit late
  const w = spiEncode({ mosi: [0x9f, 0, 0, 0], miso: [], mode: 0 });
  const p = spiPeripheral(w, { mode: 1, respond });
  const got = spiDecode({ ...w, miso: p.miso }, { mode: 0 }).miso;
  assert.notDeepEqual(got, [0, ...id]);
  assert.deepEqual(got.slice(1), [0xb5 >> 1, ((0xb5 & 1) << 7) | (0x1c >> 1), ((0x1c & 1) << 7) | (0x42 >> 1)]);
  // modes 0 and 3 use the same edges, so a mode-3 peripheral works with a mode-0 controller
  const p3 = spiPeripheral(w, { mode: 3, respond });
  assert.deepEqual(p3.rx, [0x9f, 0, 0, 0]);
});

test('can: lowest identifier wins, losers drop out at the first differing bit', () => {
  const r = canArbitrate([0x65a, 0x652, 0x123]);
  assert.deepEqual(r.winners, [2]);
  assert.equal(r.steps.length, 13);
  assert.equal(r.steps[0].bus, 0);                         // SOF dominant
  const lostAt = (n) => r.steps.findIndex((st) => st.lost.includes(n));
  assert.equal(r.steps[lostAt(0)].name, 'ID10');           // 0x65A and 0x652 have ID10 = 1, 0x123 has 0
  assert.equal(lostAt(1), lostAt(0));
  assert.ok(r.steps.slice(lostAt(0) + 1).every((st) => st.sent[0] === null && st.sent[1] === null));
  const r2 = canArbitrate([0x65a, 0x652]);
  assert.deepEqual(r2.winners, [1]);
  assert.equal(r2.steps.find((st) => st.lost.length).name, 'ID3');
  // bus is always the AND of what is sent
  for (const st of r2.steps) assert.equal(st.bus, st.sent.filter((v) => v !== null).reduce((a, b) => a & b, 1));
});

test('can: identical identifiers do not resolve; data frame beats remote frame', () => {
  assert.deepEqual(canArbitrate([0x100, 0x100]).winners, [0, 1]);
  assert.deepEqual(canArbitrate([0x100, 0x100], { rtr: [1, 0] }).winners, [1]);
});

test('can: bit stuffing after five equal bits', () => {
  const st = canStuff([0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1]);
  assert.deepEqual(st.map((b) => b.v), [0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 0, 1]);
  assert.deepEqual(st.filter((b) => b.stuff).length, 2);
  // a stuff bit counts towards the next run: 00000 [1] 1111 -> the stuff bit plus four ones is five
  const st2 = canStuff([0, 0, 0, 0, 0, 1, 1, 1, 1, 0]);
  assert.deepEqual(st2.map((b) => b.v), [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0]);
  // no run longer than five ever leaves the stuffer
  const out = canStuff(Array(40).fill(1)).map((b) => b.v).join('');
  assert.ok(!/000000|111111/.test(out));
});

test('can: frame layout and CRC', () => {
  const f = canFrame({ id: 0x123, data: [0xa5] });
  assert.deepEqual(f.fields.map((x) => x.name), ['SOF', 'ID', 'RTR', 'IDE', 'r0', 'DLC', 'Data', 'CRC', 'CRC del', 'ACK', 'ACK del', 'EOF']);
  assert.equal(f.bits.length, 1 + 11 + 3 + 4 + 8 + 15);
  assert.deepEqual(f.fields[5].bits, [0, 0, 0, 1]);
  assert.equal(canCrc15(f.bits), 0);                       // CRC over message + CRC is zero
  assert.equal(f.stuffed.length, f.bits.length + f.stuffCount + 10);
  assert.ok(!/000000|111111/.test(f.stuffed.slice(0, f.bits.length + f.stuffCount).map((b) => b.v).join('')));
  assert.equal(canCrc15([0]), 0);
  assert.equal(canCrc15([1]), 0x4599);
});
