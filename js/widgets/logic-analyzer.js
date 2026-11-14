// A small logic-analyser viewer: digital channels, zoom and pan, two cursors, edge stepping, and protocol decoders
// that only give sense when the learner configures them correctly. Pure logic is exported for tests/logic.test.mjs.
import { h, clear, append, fmtSI } from '../core/dom.js';
import { uartEncode, uartDecode, i2cEncode, i2cDecode, spiEncode, spiDecode } from '../sim/signals.js';
import { drawWaves, waveBox, onResize } from './_wave.js';

export const BAUDS = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];
const hx = (b) => (b & 0xFF).toString(16).toUpperCase().padStart(2, '0');
const codes = (text) => [...text].map((c) => c.charCodeAt(0));
/** Bytes as a learner would read them off the screen: printable ASCII as characters, the rest as \xNN. */
export const asText = (bytes) => bytes.map((b) => (b >= 0x20 && b < 0x7F ? String.fromCharCode(b) : '\\x' + hx(b))).join('');
/** Parse "48 65 6c", "0x48,0x65" ... into bytes; null if it is not hex. */
export function parseHexBytes(text) {
  const parts = String(text).trim().split(/[\s,;]+/).filter(Boolean).map((p) => p.replace(/^0x/i, ''));
  if (!parts.length || parts.some((p) => !/^[0-9a-f]{1,2}$/i.test(p))) return null;
  return parts.map((p) => parseInt(p, 16));
}
const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);
const shift = (edges, dt) => edges.map((e, i) => ({ t: i === 0 ? 0 : e.t + dt, v: e.v }));
const flat = (v) => [{ t: 0, v }];

/**
 * Run a protocol decoder over a capture's channels.
 * cfg: {proto:'uart', ch, baud, parity} | {proto:'i2c', scl, sda} | {proto:'spi', cs, sclk, mosi, miso, mode, order}
 * Returns { annotations:[{ch, t0, t1, text, color?, title}], bytes, text, errors, summary, problem? }.
 * `fmt` ('hex'|'ascii') only changes annotation labels.
 */
export function runDecoder(channels, cfg = {}, fmt = 'hex') {
  const out = { annotations: [], bytes: [], text: '', errors: 0, summary: '' };
  const lab = (b) => (fmt === 'ascii' && b >= 0x20 && b < 0x7F ? String.fromCharCode(b) : hx(b));
  const E = (i) => channels[i] && channels[i].edges;
  if (cfg.proto === 'uart') {
    const edges = E(cfg.ch);
    if (!edges) return { ...out, problem: 'Choose the channel that carries the data.' };
    const parity = cfg.parity || 'N', T = 1 / cfg.baud, n = 10 + (parity === 'N' ? 0 : 1);
    const frames = uartDecode(edges, { baud: cfg.baud, parity });
    for (const f of frames) {
      const bad = f.framingError || f.parityError;
      if (bad) out.errors++;
      out.bytes.push(f.byte);
      out.annotations.push({ ch: cfg.ch, t0: f.t, t1: f.t + n * T, text: lab(f.byte) + (f.framingError ? ' FE' : f.parityError ? ' PE' : ''), color: bad ? 'var(--bad)' : null,
        title: `0x${hx(f.byte)}` + (f.framingError ? ', framing error: the stop bit was low' : '') + (f.parityError ? ', parity error' : '') });
    }
    out.text = asText(out.bytes);
    out.summary = frames.length ? `${frames.length} frame${frames.length > 1 ? 's' : ''}, ${out.errors} with framing or parity errors.` : 'No start bit found on this channel: it never goes low.';
    if (out.errors) out.summary += ' A real receiver set like this reports the same errors; errors on most frames mean the settings do not match the sender.';
    return out;
  }
  if (cfg.proto === 'i2c') {
    if (cfg.scl === cfg.sda) return { ...out, problem: 'SCL and SDA must be two different channels.' };
    if (!E(cfg.scl) || !E(cfg.sda)) return { ...out, problem: 'Assign SCL and SDA.' };
    const evs = i2cDecode(E(cfg.scl), E(cfg.sda));
    const period = 1e-5;
    let cond = 0, addr = null;
    const parts = [];
    for (const e of evs) {
      if (e.type === 'address') {
        addr = e.addr;
        out.annotations.push({ ch: cfg.sda, t0: e.t0, t1: e.t1, text: `${hx(e.addr)} ${e.rw ? 'R' : 'W'} ${e.ack ? 'A' : 'N'}`, color: e.ack ? null : 'var(--bad)', title: `7-bit address 0x${hx(e.addr)}, ${e.rw ? 'read' : 'write'}, ${e.ack ? 'ACK' : 'NACK'}` });
        parts.push(`addr 0x${hx(e.addr)} ${e.rw ? 'read' : 'write'} ${e.ack ? 'ACK' : 'NACK'}`);
      } else if (e.type === 'data') {
        out.bytes.push(e.byte);
        out.annotations.push({ ch: cfg.sda, t0: e.t0, t1: e.t1, text: `${lab(e.byte)} ${e.ack ? 'A' : 'N'}`, title: `data 0x${hx(e.byte)}, ${e.ack ? 'ACK' : 'NACK'}` });
        parts.push(`${hx(e.byte)} ${e.ack ? 'ACK' : 'NACK'}`);
      } else {
        cond++;
        const text = e.type === 'start' ? 'S' : e.type === 'restart' ? 'Sr' : 'P';
        out.annotations.push({ ch: cfg.sda, t0: e.t - period * 0.2, t1: e.t + period * 0.2, text, color: 'var(--copper)', title: e.type });
        parts.push(e.type === 'start' ? 'START' : e.type === 'restart' ? 'repeated START' : 'STOP');
      }
    }
    out.addr = addr; out.events = evs; out.text = asText(out.bytes);
    const whole = evs.filter((e) => e.type === 'address' || e.type === 'data').length;
    if (cond > 4 && cond > whole * 2) {
      out.errors = cond;
      out.summary = `${cond} start/stop conditions and ${whole} complete byte${whole === 1 ? '' : 's'}. On an I2C bus SDA only changes while SCL is low, except for start and stop, so a decode that is mostly start and stop conditions means the two lines are assigned the wrong way round.`;
    } else out.summary = parts.length ? parts.join(' · ') : 'No start condition found on these channels.';
    return out;
  }
  if (cfg.proto === 'spi') {
    const ids = [cfg.cs, cfg.sclk, cfg.mosi, cfg.miso];
    if (new Set(ids).size < 4) return { ...out, problem: 'Each SPI signal needs its own channel.' };
    if (ids.some((i) => !E(i))) return { ...out, problem: 'Assign CS, SCLK, MOSI and MISO.' };
    // hold window: a quarter of the shortest gap between clock edges
    const ck = E(cfg.sclk);
    let gap = Infinity;
    for (let k = 2; k < ck.length; k++) gap = Math.min(gap, ck[k].t - ck[k - 1].t);
    const r = spiDecode({ cs: E(cfg.cs), sclk: ck, mosi: E(cfg.mosi), miso: E(cfg.miso) }, { mode: cfg.mode, bitOrder: cfg.order || 'msb', hold: isFinite(gap) ? gap / 4 : 0 });
    const ts = r.sampleTimes, marginal = r.marginal.mosi + r.marginal.miso;
    r.mosi.forEach((b, k) => {
      const t0 = ts[k * 8], t1 = ts[k * 8 + 7];
      out.annotations.push({ ch: cfg.mosi, t0, t1, text: lab(b), title: `MOSI 0x${hx(b)}` });
      out.annotations.push({ ch: cfg.miso, t0, t1, text: lab(r.miso[k]), title: `MISO 0x${hx(r.miso[k])}` });
    });
    out.bytes = r.miso; out.mosi = r.mosi; out.miso = r.miso; out.text = asText(r.miso);
    out.errors = r.extraBits + marginal; out.marginal = marginal;
    if (marginal) for (const an of out.annotations) { an.color = 'var(--bad)'; an.text += '?'; an.title += ' (sampled while the line was changing)'; }
    out.summary = ts.length ? `${r.mosi.length} byte${r.mosi.length === 1 ? '' : 's'} while CS is low. MOSI: ${r.mosi.map(hx).join(' ') || 'none'} · MISO: ${r.miso.map(hx).join(' ') || 'none'}.` + (r.extraBits ? ` ${r.extraBits} clock edge${r.extraBits > 1 ? 's' : ''} left over, not a whole byte: the clock or chip-select channel is probably wrong.` : '')
      + (marginal ? ` ${marginal} sample${marginal > 1 ? 's' : ''} taken on the edge where a data line changes. In this ideal capture the old bit may still be read, but a real chip sampled like that sees a line in mid-transition and returns unreliable data: the clock edge (mode) is wrong.` : '')
      : 'No clock edges while the chosen CS is low: check which channel is the clock and which is the chip select.';
    return out;
  }
  return { ...out, summary: 'No decoder selected.' };
}

// ---- captures ----
const HELLO = 'Hello', SECRET = 'solder', SECRET_BAUD = 38400;
const I2C_ADDR = 0x48, I2C_DATA = [0x19, 0x80];
const ID_BYTES = [0xEF, 0x40, 0x18];
const M3_TEXT = 'CPOL';
const MYS_ADDR = 0x3C, MYS_TEXT = 'OPEN';

function build() {
  const caps = {};
  // UART at a known rate
  let u = uartEncode(codes(HELLO), { baud: 9600, idleBefore: 3e-4, idleAfter: 3e-4 });
  caps['uart-9600-hello'] = { channels: [{ name: 'D0', edges: u.edges }, { name: 'D1', edges: flat(1) }], duration: u.duration };
  u = uartEncode(codes(SECRET), { baud: SECRET_BAUD, idleBefore: 1e-4, idleAfter: 1e-4 });
  caps['uart-unknown-baud'] = { channels: [{ name: 'D0', edges: u.edges }], duration: u.duration };
  // I2C register read with a repeated start; SDA is deliberately on D0
  const i = i2cEncode([{ start: true }, { addr: I2C_ADDR, rw: 0, ack: true }, { byte: 0x00, ack: true }, { start: true }, { addr: I2C_ADDR, rw: 1, ack: true },
    { byte: I2C_DATA[0], ack: true, from: 'target' }, { byte: I2C_DATA[1], ack: false, from: 'target' }, { stop: true }]);
  caps['i2c-read'] = { channels: [{ name: 'D0', edges: i.sda }, { name: 'D1', edges: i.scl }], duration: i.duration };
  let sp = spiEncode({ mosi: [0x9F, 0, 0, 0], miso: [0, ...ID_BYTES], mode: 0 });
  caps['spi-mode0'] = { channels: [{ name: 'D0', edges: sp.cs }, { name: 'D1', edges: sp.sclk }, { name: 'D2', edges: sp.mosi }, { name: 'D3', edges: sp.miso }], duration: sp.duration };
  sp = spiEncode({ mosi: [0x03, 0x00, 0x10, 0, 0, 0, 0], miso: [0, 0, 0, ...codes(M3_TEXT)], mode: 3 });
  caps['spi-mode3'] = { channels: [{ name: 'D0', edges: sp.sclk }, { name: 'D1', edges: sp.cs }, { name: 'D2', edges: sp.miso }, { name: 'D3', edges: sp.mosi }], duration: sp.duration };
  // mystery: I2C on two of four lines; the others are a quiet line and an interrupt-style pulse
  const m = i2cEncode([{ start: true }, { addr: MYS_ADDR, rw: 0, ack: true }, ...codes(MYS_TEXT).map((b) => ({ byte: b, ack: true })), { stop: true }]);
  const lead = 6e-5;
  caps.mystery = { channels: [{ name: 'D0', edges: flat(1) }, { name: 'D1', edges: shift(m.sda, lead) }, { name: 'D2', edges: [{ t: 0, v: 1 }, { t: 1.5e-5, v: 0 }, { t: lead + 2.3e-4, v: 1 }] }, { name: 'D3', edges: shift(m.scl, lead) }], duration: m.duration + lead };
  return caps;
}
const SIG = build();
const decodeText = (id, cfg) => runDecoder(SIG[id].channels, cfg).text;
const norm = (t) => String(t ?? '').trim();
const byteList = (a) => a.map(hx).join(' ');

function checkBaud(v, right) {
  const n = +String(v).replace(/[\s,_]/g, '');
  if (!n) return 'Enter the baud rate as a number, for example 9600.';
  if (n === right) return null;
  if (Math.abs(n - right) / right < 0.03) return null;
  for (const k of [2, 3, 4]) if (Math.abs(n * k - right) / right < 0.03) return `${n} baud would mean a bit time ${k} times longer than the narrowest pulse in the capture. You measured a pulse that is ${k} bits wide: zoom in and find a narrower one. The narrowest pulse on a UART line is one bit.`;
  if (Math.abs(n / 2 - right) / right < 0.03) return `${n} baud means a bit time half as long as the narrowest pulse here. No pulse in the capture is that short; put the cursors on the two edges of the narrowest one.`;
  return `A receiver set to ${n} baud samples at the wrong instants and reports framing errors on this line. Put cursor A and B on the two edges of the narrowest pulse; 1/Δt is the bit rate. Then pick the nearest standard rate.`;
}

export const CAPTURES = {
  'uart-9600-hello': {
    title: 'UART at 9600 baud',
    question: 'D0 is the TX pin of a device that prints a greeting at 9600 baud, 8 data bits, no parity, 1 stop bit. D1 is its RX pin, which nothing is driving. Set up a decoder and read the text.',
    fields: [{ id: 'text', label: 'Text sent', kind: 'text' }],
    check(a) {
      const t = norm(a.text);
      if (!t) return { ok: false, msg: 'Type the text you decoded.' };
      if (t === HELLO) return { ok: true, msg: `Correct: ${byteList(codes(HELLO))} is "${HELLO}". Each character is one start bit (low), eight data bits least significant first, and one stop bit (high): ten bit times of 104 µs.` };
      if (t.toLowerCase() === HELLO.toLowerCase()) return { ok: false, msg: 'Nearly: check the case of each letter. 0x48 and 0x68 differ by one bit (bit 5), and that bit is on the wire.' };
      for (const b of BAUDS) if (b !== 9600 && t === decodeText('uart-9600-hello', { proto: 'uart', ch: 0, baud: b })) return { ok: false, msg: `That is what a receiver set to ${b} baud makes of this line: it samples ${b > 9600 ? 'too early and reads each bit several times' : 'too late and skips bits'}. The frames it reports are not what was sent. The task says 9600.` };
      const rev = String.fromCharCode(...codes(HELLO).map((b) => parseInt(b.toString(2).padStart(8, '0').split('').reverse().join(''), 2)));
      if (t === rev) return { ok: false, msg: 'You read the bits most significant first. UART sends the least significant bit first, straight after the start bit.' };
      return { ok: false, msg: 'That is not what is on D0. Choose UART, channel D0, 9600 baud, no parity, and read the annotations; if they show framing errors the settings are still wrong.' };
    },
  },
  'uart-unknown-baud': {
    title: 'UART at an unknown baud rate',
    question: 'A debug pin on a board you own is sending something as soon as it powers up. The format is 8N1 but nobody wrote down the baud rate. Measure the narrowest pulse with the two cursors to find the bit time, choose the nearest standard rate, then decode the word.',
    fields: [{ id: 'baud', label: 'Baud rate', kind: 'text' }, { id: 'text', label: 'Word sent', kind: 'text' }],
    check(a) {
      const bad = checkBaud(a.baud, SECRET_BAUD);
      if (bad) return { ok: false, msg: bad };
      const t = norm(a.text);
      if (!t) return { ok: false, msg: 'The baud rate is right (bit time about 26 µs). Now set the decoder to it and type the word.' };
      if (t.toLowerCase() === SECRET) return { ok: true, msg: `Correct: the narrowest pulse is 26.04 µs, 1/Δt is 38.4 kHz, so 38400 baud, and the line says "${SECRET}". This is how unknown serial ports are identified on real boards; some tools automate exactly this measurement.` };
      return { ok: false, msg: 'The baud rate is right, but that is not the word. Set the decoder to UART, D0, 38400, no parity; with correct settings there are no framing errors.' };
    },
  },
  'i2c-read': {
    title: 'I2C register read',
    question: 'Two wires between a microcontroller and a sensor. Work out which channel is the clock, set up the I2C decoder, and report the sensor\'s 7-bit address and the two bytes it returned.',
    fields: [{ id: 'addr', label: '7-bit address (hex)', kind: 'text' }, { id: 'data', label: 'Bytes read (hex)', kind: 'text' }],
    check(a) {
      const ad = parseHexBytes(a.addr), d = parseHexBytes(a.data);
      if (!ad || ad.length !== 1) return { ok: false, msg: 'Enter the address as one hex byte, for example 3C.' };
      if (ad[0] === (I2C_ADDR << 1) || ad[0] === ((I2C_ADDR << 1) | 1)) return { ok: false, msg: `0x${hx(ad[0])} is the whole first byte on the wire: seven address bits followed by the R/W bit. The 7-bit address is that byte shifted right by one. Mixing the two forms is the most common reason a driver gets no ACK.` };
      if (ad[0] !== I2C_ADDR) return { ok: false, msg: `A controller addressing 0x${hx(ad[0])} would get a NACK from this sensor. Read the first seven bits after the start condition, most significant first. If the decoder shows mostly start and stop conditions, SCL and SDA are swapped: the clock is the line with evenly spaced pulses.` };
      if (!d) return { ok: false, msg: 'The address is right. Enter the two bytes as hex, for example 12 A0.' };
      if (same(d, [0x00])) return { ok: false, msg: '0x00 is the byte the controller wrote (the register pointer) before the repeated start. The question asks for the bytes the sensor sent back after the read address.' };
      if (same(d, [0x00, ...I2C_DATA])) return { ok: false, msg: 'The first of those, 0x00, was written by the controller to select a register. Only the two bytes after the repeated start and the read address came from the sensor.' };
      if (same(d, I2C_DATA.slice().reverse())) return { ok: false, msg: 'Right bytes, wrong order. They are listed in the order they appear on the bus.' };
      if (!same(d, I2C_DATA)) return { ok: false, msg: 'The address is right but those are not the two bytes that follow the read address. Each byte is eight bits, most significant first, followed by a ninth clock for ACK.' };
      return { ok: true, msg: `Correct. START, 0x${hx(I2C_ADDR)}+W, register 0x00, repeated START, 0x${hx(I2C_ADDR)}+R, then ${byteList(I2C_DATA)}. The controller ACKs the first data byte and NACKs the last one: that NACK is how it tells the sensor to stop sending, not an error.` };
    },
  },
  'spi-mode0': {
    title: 'SPI, mode 0',
    question: 'Four wires to a memory chip: chip select, clock, MOSI and MISO, in that order on D0 to D3. The clock idles low and data is sampled on the rising edge (mode 0), MSB first. The controller sends a one-byte command and clocks out three more bytes. Which three bytes does the chip return?',
    fields: [{ id: 'data', label: 'Bytes returned (hex)', kind: 'text' }],
    check(a) {
      const d = parseHexBytes(a.data);
      if (!d) return { ok: false, msg: 'Enter the bytes as hex, for example 12 A0 07.' };
      if (same(d, ID_BYTES)) return { ok: true, msg: `Correct: ${byteList(ID_BYTES)}. During the command byte MISO carries nothing useful, and during the reply MOSI is just filler: SPI always shifts both directions at once, and the protocol on top decides which half matters.` };
      if (same(d, [0, ...ID_BYTES])) return { ok: false, msg: 'Drop the first byte. While the command was being shifted in, the chip had nothing to say; the reply is the three bytes after it.' };
      if (same(d, [0x9F, 0, 0, 0]) || same(d, [0x9F])) return { ok: false, msg: 'That is MOSI: what the controller sent. The reply is on the other data line.' };
      return { ok: false, msg: 'Those are not the bytes on MISO. Check the channel assignment (CS is the line that stays low for the whole transfer; the clock is the one with 32 pulses) and the mode.' };
    },
  },
  'spi-mode3': {
    title: 'SPI, which mode?',
    question: 'Another four-wire capture, but the channels are in a different order and nobody recorded the mode. Identify the signals, decide the SPI mode from the idle level of the clock and the edge on which data is stable, then decode. The controller sends a read command and a two-byte address; the chip answers with four ASCII characters.',
    fields: [{ id: 'mode', label: 'SPI mode (0-3)', kind: 'text' }, { id: 'text', label: 'Four characters returned', kind: 'text' }],
    check(a) {
      const m = norm(a.mode), t = norm(a.text);
      if (!/^[0-3]$/.test(m)) return { ok: false, msg: 'Enter the mode as a number from 0 to 3.' };
      if (m === '0') return { ok: false, msg: 'Mode 0 and mode 3 both sample on the rising edge, which is why a mode-0 decode of this capture looks right. But look at the clock while chip select is high: it idles high. A controller in mode 0 would idle low, and its first edge would arrive half a period out of step for this chip.' };
      if (m !== '3') return { ok: false, msg: `Mode ${m} samples on the falling edge. Zoom in on a clock pulse: the data lines change just after each falling edge and are steady across each rising edge, so the rising edge is the one to sample on. Sampling on the falling edge reads bits as they change.` };
      if (!t) return { ok: false, msg: 'Mode 3 is right: clock idles high (CPOL = 1), data sampled on the second, rising edge (CPHA = 1). Now enter the four characters.' };
      if (t === M3_TEXT) return { ok: true, msg: `Correct: mode 3, and the reply is "${M3_TEXT}" (${byteList(codes(M3_TEXT))}). CPOL is the idle level of the clock; CPHA picks the first or second edge for sampling.` };
      if (t === asText([0x03, 0x00, 0x10, 0, 0, 0, 0]) || t.includes('\\x03')) return { ok: false, msg: 'That is the controller\'s side (command 03 and the address). The reply is on the other data line: MISO is the one that is quiet during the first three bytes.' };
      return { ok: false, msg: 'Mode 3 is right, but those are not the four bytes on MISO. MISO stays low for the first three bytes and carries the answer in the last four.' };
    },
  },
  mystery: {
    title: 'Mystery capture',
    question: 'Four probes were clipped onto unlabelled test points. Identify the protocol, work out which channels carry it (not every channel does), and extract the message. Report the protocol, the device address and the ASCII text that was written to it.',
    fields: [{ id: 'proto', label: 'Protocol', kind: 'select', options: ['', 'UART', 'I2C', 'SPI'] }, { id: 'addr', label: '7-bit address (hex)', kind: 'text' }, { id: 'text', label: 'Text written', kind: 'text' }],
    check(a) {
      if (!a.proto) return { ok: false, msg: 'Choose the protocol first.' };
      if (a.proto === 'UART') return { ok: false, msg: 'UART has no clock wire, and its line idles high between ten-bit frames. Here D3 carries evenly spaced pulses in groups of nine while D1 changes only when D3 is low: one line is clocking the other.' };
      if (a.proto === 'SPI') return { ok: false, msg: 'SPI needs a chip select that frames the transfer and separate data lines for each direction. D2 goes low before the transfer but comes back up in the middle of it, so it is not a chip select, and D0 never moves. Look at the very start: D1 falls while D3 is still high. That is a start condition, which only one of these protocols has.' };
      const ad = parseHexBytes(a.addr), t = norm(a.text);
      if (!ad || ad.length !== 1) return { ok: false, msg: 'I2C is right: nine clocks per byte and a start condition (data falls while the clock is high). Now enter the 7-bit address in hex.' };
      if (ad[0] === (MYS_ADDR << 1)) return { ok: false, msg: `0x${hx(ad[0])} is the first byte on the wire, address and R/W bit together. Shift it right by one to get the 7-bit address.` };
      if (ad[0] !== MYS_ADDR) return { ok: false, msg: 'That is not the address in the first byte. Use D3 as SCL and D1 as SDA; the other two channels are not part of the bus.' };
      if (t === MYS_TEXT) return { ok: true, msg: `Correct: I2C on D1 (SDA) and D3 (SCL), a write to 0x${hx(MYS_ADDR)} of ${byteList(codes(MYS_TEXT))}, "${MYS_TEXT}". D0 never moved and D2 was an unrelated slow signal. On a real board most of the work is exactly this: deciding which wires matter.` };
      if (t.toUpperCase() === MYS_TEXT) return { ok: false, msg: 'Right letters; check the case. Upper and lower case differ in bit 5 of each byte.' };
      return { ok: false, msg: 'Address is right. The text is the four data bytes after the address, each followed by an ACK; switch the labels to ASCII to read them.' };
    },
  },
};
const CH_COLORS = ['var(--sig1)', 'var(--sig3)', 'var(--sig4)', 'var(--sig6)'];   // --sig2 (red) is kept for decode errors
for (const k of Object.keys(CAPTURES)) { SIG[k].channels.forEach((c, i) => { c.color = CH_COLORS[i % 4]; }); Object.assign(CAPTURES[k], SIG[k]); }

/** Next (dir = 1) or previous (dir = -1) edge of an edge list relative to t; null when there is none. */
export function stepEdge(edges, t, dir) {
  const eps = 1e-12;
  if (dir > 0) { for (let i = 1; i < edges.length; i++) if (edges[i].t > t + eps) return edges[i].t; return null; }
  for (let i = edges.length - 1; i >= 1; i--) if (edges[i].t < t - eps) return edges[i].t;
  return null;
}
/** Zoom a [t0, t1] window by `factor` about `centre`, clamped to [0, duration]. */
export function zoomWindow(t0, t1, factor, centre, duration) {
  const span = Math.min(duration, Math.max(duration / 5000, (t1 - t0) * factor));
  let a = centre - (centre - t0) * (span / (t1 - t0));
  a = Math.max(0, Math.min(duration - span, a));
  return [a, a + span];
}

export default function mount(el, props = {}, ctx = {}) {
  const fixed = CAPTURES[props.capture] ? props.capture : null;
  const solved = {};
  let id = fixed || 'uart-9600-hello';
  let cap, view, cur, active, selCh, cfg, fmt, answers, feedback, geom;
  clear(el); el.classList.add('logic-analyzer');

  const picker = h('div', { class: 'w-tabs', role: 'tablist', 'aria-label': 'Capture' });
  const task = h('div', { class: 'w-task' });
  const { wrap, svg } = waveBox(0, 'Logic capture');
  wrap.tabIndex = 0; wrap.classList.add('la-wave');
  wrap.setAttribute('role', 'application');
  wrap.setAttribute('aria-label', 'Waveform. Arrow keys pan, plus and minus zoom, F fits, A and B choose a cursor, comma and full stop step the cursor to the previous and next edge, Shift with arrows nudges it.');
  const readout = h('div', { class: 'w-readout', 'aria-live': 'polite' });
  const tools = h('div', { class: 'la-tools' });
  const decoder = h('div', { class: 'la-decoder' });
  const decOut = h('div', { class: 'w-msg', role: 'status' });
  const answerBox = h('div', { class: 'la-answer' });
  const fb = h('div', { role: 'status' });

  append(el, [fixed ? null : picker, task, tools, wrap, readout, decoder, decOut, answerBox, fb,
    h('details', { class: 'la-notes' }, h('summary', {}, 'Using a real logic analyser'),
      h('ul', {},
        h('li', {}, h('strong', {}, 'Sample rate. '), 'The analyser only sees the line at its sample instants. Sample at least 4 times the bit rate, preferably 10 times or more, or edges land in the wrong place and decoders fail. The common low-cost 8-channel USB analysers are typically 24 MS/s at best, which is plenty for UART and 100 kHz or 400 kHz I2C, but marginal for SPI above a few MHz.'),
        h('li', {}, h('strong', {}, 'Common ground. '), 'Connect the analyser ground to the board ground first. Without a shared reference the inputs float and the capture is noise.'),
        h('li', {}, h('strong', {}, 'Voltage thresholds. '), 'An analyser turns each input into 0 or 1 at a fixed threshold. Check that the threshold suits the logic level you are probing (1.8 V logic can sit below the threshold of a 5 V-oriented input) and that the input voltage rating is not exceeded. Slow edges and ringing are invisible here; an oscilloscope shows them.'),
        h('li', {}, h('strong', {}, 'Decoders are only as right as their settings. '), 'A decoder will happily print bytes for the wrong baud rate, the wrong mode or swapped lines. Framing errors, leftover bits and impossible sequences are the clues.'))),
    h('p', { class: 'w-note' }, 'Model: ideal edges generated in software, not a recording of hardware. No sampling quantisation, noise, ringing or analogue levels. The time axis is to scale.')]);

  const chOptions = (sel) => cap.channels.map((c, i) => h('option', { value: i, selected: i === sel }, c.name));
  const btn = (label, title, fn, cls = 'btn small ghost') => h('button', { type: 'button', class: cls, title, 'aria-label': title, onclick: fn }, label);

  function load(next) {
    id = next; cap = CAPTURES[id];
    view = [0, cap.duration]; cur = { A: cap.duration * 0.25, B: cap.duration * 0.5 }; active = 'A'; selCh = 0;
    cfg = { proto: 'none', uart: { ch: 0, baud: 115200, parity: 'N' }, i2c: { scl: 0, sda: 1 }, spi: { cs: 0, sclk: 1, mosi: 2, miso: 3, mode: 0, order: 'msb' } };
    fmt = 'hex'; answers = {}; feedback = null;
    clear(picker);
    for (const [k, c] of Object.entries(CAPTURES)) picker.append(h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === id), class: 'w-tab' + (k === id ? ' on' : ''), onclick: () => load(k) }, c.title + (solved[k] ? ' ✓' : '')));
    clear(task); append(task, [h('p', {}, h('strong', {}, 'Task. '), cap.question)]);
    drawTools(); drawDecoder(); drawAnswer(); redraw();
  }

  function drawTools() {
    clear(tools);
    const chSel = h('select', { 'aria-label': 'Channel for edge stepping', onchange: (e) => { selCh = +e.target.value; } }, chOptions(selCh));
    const pick = (name) => h('button', { type: 'button', class: 'w-tab la-cur la-cur' + name + (active === name ? ' on' : ''), 'aria-pressed': String(active === name), onclick: () => { active = name; drawTools(); redraw(); } }, 'Cursor ' + name);
    append(tools, [
      h('div', { class: 'row' }, btn('−', 'Zoom out', () => zoom(2)), btn('+', 'Zoom in', () => zoom(0.5)), btn('Fit', 'Show the whole capture', () => { view = [0, cap.duration]; redraw(); }),
        btn('◀', 'Pan left', () => pan(-0.25)), btn('▶', 'Pan right', () => pan(0.25))),
      h('div', { class: 'row' }, pick('A'), pick('B'), btn('◀ edge', 'Move the active cursor to the previous edge on the chosen channel', () => edge(-1)), btn('edge ▶', 'Move the active cursor to the next edge on the chosen channel', () => edge(1)), h('label', {}, 'on ', chSel))]);
  }

  function zoom(f) {
    const c = cur[active] >= view[0] && cur[active] <= view[1] ? cur[active] : (view[0] + view[1]) / 2;
    view = zoomWindow(view[0], view[1], f, c, cap.duration); redraw();
  }
  function pan(frac) {
    const span = view[1] - view[0];
    const a = Math.max(0, Math.min(cap.duration - span, view[0] + frac * span));
    view = [a, a + span]; redraw();
  }
  function reveal(t) {
    if (t >= view[0] && t <= view[1]) return;
    const span = view[1] - view[0], a = Math.max(0, Math.min(cap.duration - span, t - span / 2));
    view = [a, a + span];
  }
  function edge(dir) {
    const t = stepEdge(cap.channels[selCh].edges, cur[active], dir);
    if (t == null) { feedbackLine(`No ${dir > 0 ? 'later' : 'earlier'} edge on ${cap.channels[selCh].name}.`); return; }
    cur[active] = t; reveal(t); redraw();
  }
  function feedbackLine(text) { readout.dataset.note = text; redraw(); }

  function redraw() {
    if (!el.isConnected && geom) return;
    const dec = cfg.proto === 'none' ? null : runDecoder(cap.channels, { proto: cfg.proto, ...cfg[cfg.proto] }, fmt);
    geom = drawWaves(svg, cap.channels, { t0: view[0], t1: view[1], height: 30,
      cursors: [{ t: cur.A, label: 'A', color: 'var(--copper)' }, { t: cur.B, label: 'B', color: 'var(--sig5)' }],
      annotations: dec ? dec.annotations : [] });
    const dt = cur.B - cur.A;
    clear(readout);
    const cell = (k, v) => h('div', {}, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v));
    append(readout, [cell('Cursor A', fmtSI(+cur.A.toPrecision(6), 's', 5)), cell('Cursor B', fmtSI(+cur.B.toPrecision(6), 's', 5)), cell('Δt = B − A', dt === 0 ? '0 s' : fmtSI(+dt.toPrecision(6), 's', 4)), cell('1/|Δt|', dt === 0 ? '—' : fmtSI(1 / Math.abs(dt), 'Hz', 4))]);
    if (readout.dataset.note) { readout.append(h('div', { class: 'la-rnote' }, readout.dataset.note)); delete readout.dataset.note; }
    decOut.className = 'w-msg' + (dec && (dec.problem || dec.errors) ? ' warn' : '');
    decOut.textContent = !dec ? 'No decoder running. The traces are all you have until you configure one.' : dec.problem ? dec.problem : 'Decoder: ' + dec.summary + (cfg.proto !== 'i2c' && dec.text && !dec.problem ? ` As text: "${dec.text}"` : '') + (cfg.proto === 'i2c' && dec.bytes.length && !dec.errors ? ` Data as text: "${dec.text}"` : '');
  }

  function drawDecoder() {
    clear(decoder);
    const set = (obj, key, num = true) => (e) => { obj[key] = num ? +e.target.value : e.target.value; redraw(); };
    const sel = (label, obj, key, options, num = true) => h('label', {}, label + ' ', h('select', { onchange: set(obj, key, num) }, options.map(([v, t]) => h('option', { value: v, selected: obj[key] === v }, t))));
    const chs = cap.channels.map((c, i) => [i, c.name]);
    const row = h('div', { class: 'row' },
      h('label', {}, 'Decoder ', h('select', { 'aria-label': 'Protocol decoder', onchange: (e) => { cfg.proto = e.target.value; drawDecoder(); redraw(); } },
        [['none', 'None'], ['uart', 'UART'], ['i2c', 'I2C'], ['spi', 'SPI']].map(([v, t]) => h('option', { value: v, selected: cfg.proto === v }, t)))));
    const clampCh = (o, keys) => keys.forEach((k) => { if (o[k] >= cap.channels.length) o[k] = 0; });
    if (cfg.proto === 'uart') { clampCh(cfg.uart, ['ch']); append(row, [sel('Channel', cfg.uart, 'ch', chs), sel('Baud', cfg.uart, 'baud', BAUDS.map((b) => [b, String(b)])), sel('Parity', cfg.uart, 'parity', [['N', 'None'], ['E', 'Even'], ['O', 'Odd']], false)]); }
    if (cfg.proto === 'i2c') { clampCh(cfg.i2c, ['scl', 'sda']); append(row, [sel('SCL', cfg.i2c, 'scl', chs), sel('SDA', cfg.i2c, 'sda', chs)]); }
    if (cfg.proto === 'spi') {
      if (cap.channels.length < 4) append(row, [h('span', { class: 'muted' }, 'SPI needs four channels; this capture has ' + cap.channels.length + '.')]);
      else append(row, [sel('CS', cfg.spi, 'cs', chs), sel('SCLK', cfg.spi, 'sclk', chs), sel('MOSI', cfg.spi, 'mosi', chs), sel('MISO', cfg.spi, 'miso', chs),
        sel('Mode', cfg.spi, 'mode', [[0, '0 (idle low, rising)'], [1, '1 (idle low, falling)'], [2, '2 (idle high, falling)'], [3, '3 (idle high, rising)']]), sel('Bit order', cfg.spi, 'order', [['msb', 'MSB first'], ['lsb', 'LSB first']], false)]);
    }
    if (cfg.proto !== 'none') row.append(h('label', {}, 'Labels ', h('select', { onchange: (e) => { fmt = e.target.value; redraw(); } }, [['hex', 'Hex'], ['ascii', 'ASCII']].map(([v, t]) => h('option', { value: v, selected: fmt === v }, t)))));
    decoder.append(row);
  }

  function drawAnswer() {
    clear(answerBox); clear(fb);
    const submit = () => {
      const r = cap.check(answers);
      fb.className = 'w-msg ' + (r.ok ? 'ok' : 'bad'); fb.textContent = r.msg;
      if (r.ok && !solved[id]) { solved[id] = true; ctx.complete?.(); [...picker.children].forEach((b, i) => { if (Object.keys(CAPTURES)[i] === id && !b.textContent.endsWith('✓')) b.textContent += ' ✓'; }); }
    };
    const row = h('div', { class: 'row' }, cap.fields.map((f) => h('label', {}, f.label + ' ',
      f.kind === 'select' ? h('select', { onchange: (e) => { answers[f.id] = e.target.value; } }, f.options.map((o) => h('option', { value: o }, o || 'choose…')))
        : h('input', { type: 'text', class: 'mono la-in', spellcheck: 'false', autocomplete: 'off', oninput: (e) => { answers[f.id] = e.target.value; }, onkeydown: (e) => { if (e.key === 'Enter') submit(); } }))),
      h('button', { type: 'button', class: 'btn small', onclick: submit }, 'Check answer'));
    answerBox.append(row);
  }

  // pointer: drag a cursor, or click to place the active one; release snaps to a nearby edge
  const timeAt = (ev) => {
    const r = svg.getBoundingClientRect();
    return Math.max(view[0], Math.min(view[1], geom.time((ev.clientX - r.left) * (geom.width / r.width))));
  };
  let dragging = null;
  svg.addEventListener('pointerdown', (ev) => {
    if (!geom) return;
    const t = timeAt(ev), px = (x) => Math.abs(geom.x(x) - geom.x(t));
    const near = px(cur.A) <= px(cur.B) ? 'A' : 'B';
    dragging = px(cur[near]) < 12 ? near : active;
    if (dragging !== active) { active = dragging; drawTools(); }
    cur[dragging] = t; svg.setPointerCapture(ev.pointerId); redraw(); ev.preventDefault();
  });
  svg.addEventListener('pointermove', (ev) => { if (dragging) { cur[dragging] = timeAt(ev); redraw(); } });
  const drop = () => {
    if (!dragging) return;
    let best = null;
    for (const c of cap.channels) for (let i = 1; i < c.edges.length; i++) { const d = Math.abs(geom.x(c.edges[i].t) - geom.x(cur[dragging])); if (d < 7 && (best == null || d < best.d)) best = { d, t: c.edges[i].t }; }
    if (best) cur[dragging] = best.t;
    dragging = null; redraw();
  };
  svg.addEventListener('pointerup', drop); svg.addEventListener('pointercancel', drop);

  wrap.addEventListener('keydown', (ev) => {
    const k = ev.key;
    const nudge = (view[1] - view[0]) / 400;
    let used = true;
    if (ev.shiftKey && k === 'ArrowLeft') { cur[active] = Math.max(0, cur[active] - nudge); redraw(); }
    else if (ev.shiftKey && k === 'ArrowRight') { cur[active] = Math.min(cap.duration, cur[active] + nudge); redraw(); }
    else if (k === 'ArrowLeft') pan(-0.1); else if (k === 'ArrowRight') pan(0.1);
    else if (k === '+' || k === '=') zoom(0.5); else if (k === '-' || k === '_') zoom(2);
    else if (k === 'f' || k === 'F' || k === '0') { view = [0, cap.duration]; redraw(); }
    else if (k === 'a' || k === 'A') { active = 'A'; drawTools(); redraw(); } else if (k === 'b' || k === 'B') { active = 'B'; drawTools(); redraw(); }
    else if (k === ',' || k === '<') edge(-1); else if (k === '.' || k === '>') edge(1);
    else if (k === 'ArrowUp') { selCh = (selCh + cap.channels.length - 1) % cap.channels.length; drawTools(); }
    else if (k === 'ArrowDown') { selCh = (selCh + 1) % cap.channels.length; drawTools(); }
    else used = false;
    if (used) ev.preventDefault();
  });

  load(id);
  onResize(wrap, () => redraw());
}
