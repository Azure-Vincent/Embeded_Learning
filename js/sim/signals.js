// Shared, pure signal generation and decoding for the protocol tools. No DOM, no timers, no randomness.
//
// A digital line is an "edge list": [{t, v}] sorted by t (seconds), v = 0|1. The first entry gives the
// initial level; later entries are the instants the level changes. Before the first entry the line has
// the first entry's level; after the last it holds the last level.
//
// Stable exports (other widgets import these — do not change the signatures):
//
//   sample(edges, t) -> 0|1
//       Level of the line at time t (an edge at exactly t has already happened).
//
//   uartEncode(bytes, {baud=9600, dataBits=8, parity='N'|'E'|'O', stopBits=1, idleBefore, idleAfter, gap=0})
//       -> {edges, duration, frames:[{t, byte, bits:[{t0, t1, kind:'start'|'data'|'parity'|'stop', v, index?}]}]}
//       Line idles high, start bit low, data LSB first. idleBefore/idleAfter/gap are in seconds
//       (defaults: one bit time before and after, no gap between frames).
//
//   uartDecode(edges, {baud, dataBits=8, parity='N', stopBits=1, tEnd?})
//       -> [{t, byte, framingError, parityError, samples:[{t, v, kind}]}]
//       Models a receiver: waits for a falling edge, checks the start bit half a bit later, then samples
//       once per bit at ITS OWN baud. Decode a waveform at the wrong baud to get what a real receiver gets.
//       Only the first stop bit is checked. After a framing error it waits for the line to go high again.
//
//   i2cEncode(ops, {freq=100000}) -> {scl, sda, duration, segments, bits}
//       ops: {start:true} (a start while the bus is active is a repeated start),
//            {addr:0x48, rw:0|1, ack:true}, {byte:0x12, ack:true, from:'controller'|'target'},
//            {stretch:seconds} (target holds SCL low), {stop:true}.
//       segments: [{kind:'start'|'restart'|'addr'|'rw'|'ack'|'data'|'stretch'|'stop', t0, t1, text, driver, value?}]
//       bits: [{t (SCL rising edge), v, kind, driver:'controller'|'target'}]
//
//   i2cDecode(scl, sda) -> events
//       [{type:'start'|'restart'|'stop', t} | {type:'address', addr, rw, ack, t0, t1} | {type:'data', byte, ack, t0, t1}]
//
//   spiEncode({mosi:[bytes], miso:[bytes], mode:0..3, bitOrder:'msb'|'lsb', freq=1e6, tpd?})
//       -> {cs, sclk, mosi, miso, duration, sampleEdges:[t], shiftEdges:[t]}
//       CS is active low. Data lines change tpd after their shift edge (default period/20), as real outputs do,
//       so sampling exactly on the wrong edge returns the previous bit rather than an arbitrary one.
//
//   spiDecode({cs, sclk, mosi, miso}, {mode, bitOrder, hold?})
//       -> {mosi:[bytes], miso:[bytes], extraBits, marginal:{mosi, miso}}
//       Samples both data lines on the sampling edge of `mode` while CS is low. `marginal` counts samples
//       where the line changed within `hold` seconds after the sample (a hold-time violation on real parts).
//
//   spiPeripheral({cs, sclk, mosi}, {mode, bitOrder, respond(rxBytes, n) -> byte, tpd?}) -> {miso, rx:[bytes]}
//       A peripheral with its own idea of the mode, reacting to the controller's actual CS/SCLK/MOSI.
//
//   canArbitrate(ids, {rtr?:[0|1]}) -> {steps:[{name, sent:[0|1|null], bus, lost:[nodeIndex]}], winners:[nodeIndex]}
//   canCrc15(bits) -> number;  canStuff(bits) -> [{v, stuff}];  canFrame({id, data, rtr}) -> {fields, bits, stuffed, crc}
//
// Edge-list helpers: edgesBuilder(initial) -> {set(t, v), edges}; spiSampleLevel(mode).

export function sample(edges, t) {
  if (!edges || !edges.length) return 1;
  let v = edges[0].v;
  for (let i = 1; i < edges.length; i++) {
    if (edges[i].t <= t) v = edges[i].v; else break;
  }
  return v;
}

/** Builds an edge list, dropping entries that do not change the level. */
export function edgesBuilder(initial = 1, t0 = 0) {
  const edges = [{ t: t0, v: initial }];
  return {
    edges,
    set(t, v) {
      const last = edges[edges.length - 1];
      if (last.v === v) return;
      if (last.t === t && edges.length > 1) { edges.pop(); if (edges[edges.length - 1].v !== v) edges.push({ t, v }); return; }
      edges.push({ t, v });
    },
  };
}

const parityBit = (byte, dataBits, parity) => {
  let ones = 0;
  for (let i = 0; i < dataBits; i++) ones += (byte >> i) & 1;
  return parity === 'E' ? ones & 1 : (ones & 1) ^ 1;
};

// ---------- UART ----------
export function uartEncode(bytes, opts = {}) {
  const { baud = 9600, dataBits = 8, parity = 'N', stopBits = 1, gap = 0 } = opts;
  const T = 1 / baud;
  const idleBefore = opts.idleBefore ?? T, idleAfter = opts.idleAfter ?? T;
  const b = edgesBuilder(1);
  const frames = [];
  let t = idleBefore;
  for (const raw of bytes) {
    const byte = raw & ((1 << dataBits) - 1);
    const bits = [];
    const put = (kind, v, len, index) => { b.set(t, v); bits.push({ t0: t, t1: t + len * T, kind, v, index }); t += len * T; };
    const t0 = t;
    put('start', 0, 1);
    for (let i = 0; i < dataBits; i++) put('data', (byte >> i) & 1, 1, i);
    if (parity === 'E' || parity === 'O') put('parity', parityBit(byte, dataBits, parity), 1);
    put('stop', 1, stopBits);
    frames.push({ t: t0, byte, bits });
    t += gap;
  }
  return { edges: b.edges, duration: t - gap * (bytes.length ? 1 : 0) + idleAfter, frames };
}

export function uartDecode(edges, opts = {}) {
  const { baud = 9600, dataBits = 8, parity = 'N', tEnd = Infinity } = opts;
  const T = 1 / baud;
  const out = [];
  if (!edges || !edges.length) return out;
  // next 1 -> 0 transition strictly after tMin
  const nextFall = (tMin) => {
    let prev = tMin === -Infinity ? edges[0].v : sample(edges, tMin);
    for (const e of edges) {
      if (e.t <= tMin) continue;
      if (e.v === 0 && prev === 1) return e.t;
      prev = e.v;
    }
    return null;
  };
  let from = -Infinity;
  for (let guard = 0; guard < 100000; guard++) {
    const ts = nextFall(from);
    if (ts == null || ts >= tEnd) break;
    const samples = [];
    const at = (n, kind) => { const t = ts + (n + 0.5) * T; const v = sample(edges, t); samples.push({ t, v, kind }); return v; };
    if (at(0, 'start') !== 0) { from = ts; continue; }          // glitch shorter than half a bit: not a start bit
    let byte = 0, ones = 0;
    for (let i = 0; i < dataBits; i++) { const v = at(1 + i, 'data'); byte |= v << i; ones += v; }
    let n = 1 + dataBits, parityError = false;
    if (parity === 'E' || parity === 'O') {
      const p = at(n++, 'parity');
      parityError = ((ones + p) & 1) !== (parity === 'E' ? 0 : 1);
    }
    const stop = at(n, 'stop');
    out.push({ t: ts, byte, framingError: stop !== 1, parityError, samples });
    from = ts + (n + 0.5) * T;
  }
  return out;
}

// ---------- I2C ----------
export function i2cEncode(ops, opts = {}) {
  const { freq = 100000 } = opts;
  const T = 1 / freq, q = T / 4;
  const scl = edgesBuilder(1), sda = edgesBuilder(1);
  const segments = [], bits = [];
  let t = 2 * q;          // bus idle (both high) for half a period first
  let active = false;     // between start and stop; when active, SCL is low at time t
  const bit = (v, kind, driver) => {
    sda.set(t + q, v);
    scl.set(t + 2 * q, 1);
    bits.push({ t: t + 2 * q, v, kind, driver });
    scl.set(t + 4 * q, 0);
    t += 4 * q;
  };
  const byteOut = (value, driver, kind) => {
    for (let i = 7; i >= 0; i--) bit((value >> i) & 1, kind === 'addr' && i === 0 ? 'rw' : kind, driver);
  };
  const other = (d) => (d === 'controller' ? 'target' : 'controller');
  for (const op of ops) {
    if (op.start) {
      const t0 = t;
      if (active) {                       // repeated start: release SDA, raise SCL, then pull SDA low
        sda.set(t + q, 1); scl.set(t + 2 * q, 1); sda.set(t + 3 * q, 0); scl.set(t + 4 * q, 0); t += 4 * q;
        segments.push({ kind: 'restart', t0, t1: t, text: 'Sr', driver: 'controller' });
      } else {
        sda.set(t + q, 0); scl.set(t + 2 * q, 0); t += 2 * q;
        segments.push({ kind: 'start', t0, t1: t, text: 'S', driver: 'controller' });
      }
      active = true;
    } else if (op.stop) {
      const t0 = t;
      if (active) { sda.set(t + q, 0); scl.set(t + 2 * q, 1); sda.set(t + 3 * q, 1); t += 4 * q; }
      segments.push({ kind: 'stop', t0, t1: t, text: 'P', driver: 'controller' });
      active = false;
    } else if (op.stretch != null) {
      segments.push({ kind: 'stretch', t0: t, t1: t + op.stretch, text: 'stretch', driver: 'target' });
      t += op.stretch;
    } else if (op.addr != null) {
      const t0 = t, rw = op.rw ? 1 : 0;
      byteOut(((op.addr & 0x7f) << 1) | rw, 'controller', 'addr');
      segments.push({ kind: 'addr', t0, t1: t0 + 7 * T, text: hex2(op.addr & 0x7f), driver: 'controller', value: op.addr & 0x7f });
      segments.push({ kind: 'rw', t0: t0 + 7 * T, t1: t, text: rw ? 'R' : 'W', driver: 'controller', value: rw });
      const a0 = t;
      bit(op.ack ? 0 : 1, 'ack', 'target');
      segments.push({ kind: 'ack', t0: a0, t1: t, text: op.ack ? 'ACK' : 'NACK', driver: 'target', value: op.ack ? 1 : 0 });
    } else if (op.byte != null) {
      const from = op.from === 'target' ? 'target' : 'controller';
      const t0 = t;
      byteOut(op.byte & 0xff, from, 'data');
      segments.push({ kind: 'data', t0, t1: t, text: hex2(op.byte & 0xff), driver: from, value: op.byte & 0xff });
      const a0 = t;
      bit(op.ack ? 0 : 1, 'ack', other(from));
      segments.push({ kind: 'ack', t0: a0, t1: t, text: op.ack ? 'ACK' : 'NACK', driver: other(from), value: op.ack ? 1 : 0 });
    }
  }
  return { scl: scl.edges, sda: sda.edges, duration: t + 2 * q, segments, bits };
}
const hex2 = (n) => '0x' + n.toString(16).toUpperCase().padStart(2, '0');

export function i2cDecode(scl, sda) {
  const evs = [];
  const all = [...scl.slice(1).map((e) => ({ ...e, line: 'scl' })), ...sda.slice(1).map((e) => ({ ...e, line: 'sda' }))]
    .sort((a, b) => a.t - b.t);
  let c = scl[0] ? scl[0].v : 1, d = sda[0] ? sda[0].v : 1;
  let active = false, first = false, nbits = 0, val = 0, t0 = 0;
  for (const e of all) {
    if (e.line === 'sda') {
      if (e.v === d) continue;
      d = e.v;
      if (c === 1) {
        if (d === 0) { evs.push({ type: active ? 'restart' : 'start', t: e.t }); active = true; first = true; nbits = 0; val = 0; }
        else { evs.push({ type: 'stop', t: e.t }); active = false; nbits = 0; }
      }
    } else {
      if (e.v === c) continue;
      c = e.v;
      if (c === 1 && active) {
        if (nbits === 0) t0 = e.t;
        if (nbits < 8) { val = (val << 1) | d; nbits++; }
        else {
          const ack = d === 0;
          evs.push(first ? { type: 'address', addr: val >> 1, rw: val & 1, ack, t0, t1: e.t }
            : { type: 'data', byte: val, ack, t0, t1: e.t });
          first = false; nbits = 0; val = 0;
        }
      }
    }
  }
  return evs;
}

// ---------- SPI ----------
/** The SCLK level reached by the edge on which `mode` samples data. Modes 0 and 3: rising. 1 and 2: falling. */
export const spiSampleLevel = (mode) => { const cpol = (mode >> 1) & 1, cpha = mode & 1; return cpha ? cpol : 1 - cpol; };
const bitAt = (byte, k, order) => (order === 'lsb' ? (byte >> k) & 1 : (byte >> (7 - k)) & 1);
const packBits = (bits, order) => {
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let v = 0;
    for (let k = 0; k < 8; k++) v |= bits[i + k] << (order === 'lsb' ? k : 7 - k);
    out.push(v);
  }
  return out;
};

export function spiEncode(opts = {}) {
  const { mosi = [], miso = [], mode = 0, bitOrder = 'msb', freq = 1e6 } = opts;
  const T = 1 / freq, hp = T / 2, tpd = opts.tpd ?? T / 20;
  const cpol = (mode >> 1) & 1, cpha = mode & 1;
  const n = Math.max(mosi.length, miso.length);
  const cs = edgesBuilder(1), sclk = edgesBuilder(cpol), mo = edgesBuilder(0), mi = edgesBuilder(0);
  const sampleEdges = [], shiftEdges = [];
  const tcs = hp;
  cs.set(tcs, 0);
  const bitOf = (arr, i) => bitAt(arr[Math.floor(i / 8)] ?? 0, i % 8, bitOrder);
  const drive = (t, i) => { mo.set(t, bitOf(mosi, i)); mi.set(t, bitOf(miso, i)); };
  if (!cpha && n) drive(tcs, 0);
  for (let i = 0; i < n * 8; i++) {
    const lead = tcs + hp + i * T, trail = lead + hp;
    sclk.set(lead, 1 - cpol); sclk.set(trail, cpol);
    if (cpha) { shiftEdges.push(lead); drive(lead + tpd, i); sampleEdges.push(trail); }
    else { sampleEdges.push(lead); shiftEdges.push(trail); if (i + 1 < n * 8) drive(trail + tpd, i + 1); }
  }
  const tend = tcs + hp + n * 8 * T + hp;
  cs.set(tend, 1); mo.set(tend, 0); mi.set(tend, 0);
  return { cs: cs.edges, sclk: sclk.edges, mosi: mo.edges, miso: mi.edges, duration: tend + hp, sampleEdges, shiftEdges };
}

const changesWithin = (edges, t, hold) => edges.some((e, i) => i > 0 && e.t > t && e.t <= t + hold);

export function spiDecode(sig, opts = {}) {
  const { mode = 0, bitOrder = 'msb', hold = 0 } = opts;
  const lvl = spiSampleLevel(mode);
  const mo = [], mi = [], times = [];
  const marginal = { mosi: 0, miso: 0 };
  for (let i = 1; i < sig.sclk.length; i++) {
    const e = sig.sclk[i];
    if (e.v !== lvl || sample(sig.cs, e.t) !== 0) continue;
    times.push(e.t);
    if (sig.mosi) { mo.push(sample(sig.mosi, e.t)); if (hold && changesWithin(sig.mosi, e.t, hold)) marginal.mosi++; }
    if (sig.miso) { mi.push(sample(sig.miso, e.t)); if (hold && changesWithin(sig.miso, e.t, hold)) marginal.miso++; }
  }
  return { mosi: packBits(mo, bitOrder), miso: packBits(mi, bitOrder), extraBits: times.length % 8, marginal, sampleTimes: times };
}

export function spiPeripheral(sig, opts = {}) {
  const { mode = 0, bitOrder = 'msb', respond = () => 0 } = opts;
  const cpol = (mode >> 1) & 1, cpha = mode & 1;
  const period = sig.sclk.length > 2 ? Math.abs(sig.sclk[2].t - sig.sclk[1].t) * 2 : 1e-6;
  const tpd = opts.tpd ?? period / 20;
  const mi = edgesBuilder(0);
  const rxBits = [];
  const rx = () => packBits(rxBits, bitOrder);
  let nByte = 0, k = 0, cur = 0, selected = false;
  const present = (t) => mi.set(t, bitAt(cur, k, bitOrder));
  const events = [...sig.cs.slice(1).map((e) => ({ ...e, line: 'cs' })), ...sig.sclk.slice(1).map((e) => ({ ...e, line: 'sclk' }))]
    .sort((a, b) => a.t - b.t);
  let started = false;      // CPHA=1: nothing is on the output until the first shift edge
  for (const e of events) {
    if (e.line === 'cs') {
      if (e.v === 0) {
        selected = true; rxBits.length = 0; nByte = 0; k = 0; cur = respond([], 0) & 0xff; started = !cpha;
        if (!cpha) present(e.t + tpd);
      } else { selected = false; mi.set(e.t, 0); }
      continue;
    }
    if (!selected) continue;
    const leading = e.v === 1 - cpol;
    const isSample = cpha ? !leading : leading;
    if (isSample) rxBits.push(sample(sig.mosi, e.t));
    else {
      if (!started) started = true;
      else if (++k === 8) { k = 0; nByte++; cur = respond(rx(), nByte) & 0xff; }
      present(e.t + tpd);
    }
  }
  return { miso: mi.edges, rx: rx() };
}

// ---------- CAN ----------
const idBits = (id) => Array.from({ length: 11 }, (_, i) => (id >> (10 - i)) & 1);

/** Bitwise arbitration on a wired-AND bus: 0 is dominant. A node that sends 1 and reads 0 stops transmitting. */
export function canArbitrate(ids, opts = {}) {
  const rtr = opts.rtr || ids.map(() => 0);
  const seqs = ids.map((id, n) => [0, ...idBits(id & 0x7ff), rtr[n] ? 1 : 0]);
  const names = ['SOF', ...Array.from({ length: 11 }, (_, i) => 'ID' + (10 - i)), 'RTR'];
  const alive = ids.map(() => true);
  const steps = names.map((name, i) => {
    const sent = seqs.map((q, n) => (alive[n] ? q[i] : null));
    const bus = sent.some((v) => v === 0) ? 0 : 1;
    const lost = [];
    sent.forEach((v, n) => { if (v === 1 && bus === 0) { alive[n] = false; lost.push(n); } });
    return { name, sent, bus, lost };
  });
  return { steps, winners: alive.map((a, n) => (a ? n : -1)).filter((n) => n >= 0) };
}

/** CAN CRC-15, polynomial x^15+x^14+x^10+x^8+x^7+x^4+x^3+1 (0x4599), over the unstuffed bits SOF..data. */
export function canCrc15(bits) {
  let crc = 0;
  for (const b of bits) {
    const nxt = b ^ ((crc >> 14) & 1);
    crc = (crc << 1) & 0x7fff;
    if (nxt) crc ^= 0x4599;
  }
  return crc;
}

/** After five equal bits in a row the transmitter inserts one bit of the opposite level. */
export function canStuff(bits) {
  const out = [];
  let run = 0, last = -1;
  for (const v of bits) {
    out.push({ v, stuff: false });
    if (v === last) run++; else { last = v; run = 1; }
    if (run === 5) { last = 1 - v; run = 1; out.push({ v: last, stuff: true }); }
  }
  return out;
}

/** A classic CAN 2.0A (11-bit identifier) frame. Stuffing covers SOF through the CRC sequence. */
export function canFrame({ id = 0, data = [], rtr = false } = {}) {
  const dlc = Math.min(8, data.length);
  const toBits = (v, n) => Array.from({ length: n }, (_, i) => (v >> (n - 1 - i)) & 1);
  const fields = [
    { name: 'SOF', bits: [0] },
    { name: 'ID', bits: idBits(id & 0x7ff) },
    { name: 'RTR', bits: [rtr ? 1 : 0] },
    { name: 'IDE', bits: [0] },
    { name: 'r0', bits: [0] },
    { name: 'DLC', bits: toBits(dlc, 4) },
    { name: 'Data', bits: rtr ? [] : data.slice(0, 8).flatMap((b) => toBits(b & 0xff, 8)) },
  ];
  const head = fields.flatMap((f) => f.bits);
  const crc = canCrc15(head);
  fields.push({ name: 'CRC', bits: toBits(crc, 15) });
  const bits = fields.flatMap((f) => f.bits);
  const owner = fields.flatMap((f) => f.bits.map(() => f.name));
  let i = 0;
  const stuffed = canStuff(bits).map((b) => ({ ...b, field: b.stuff ? owner[Math.max(0, i - 1)] : owner[i++] }));
  const tail = [
    { name: 'CRC del', bits: [1] }, { name: 'ACK', bits: [1] }, { name: 'ACK del', bits: [1] }, { name: 'EOF', bits: [1, 1, 1, 1, 1, 1, 1] },
  ];
  for (const f of tail) { fields.push(f); for (const v of f.bits) stuffed.push({ v, stuff: false, field: f.name }); }
  return { fields, bits, stuffed, crc, stuffCount: stuffed.filter((b) => b.stuff).length };
}
