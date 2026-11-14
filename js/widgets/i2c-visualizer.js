// I2C transactions against simulated targets, drawn as SCL/SDA with who-drives-what colouring.
import { h, clear, fmtSI, hex } from '../core/dom.js';
import { i2cEncode, i2cDecode } from '../sim/signals.js';
import { drawWaves, waveBox, onResize } from './_wave.js';

export const DEVICES = {
  tmp102: { title: 'TMP102-style temperature sensor at 0x48' },
  eeprom: { title: '24xx-style EEPROM at 0x50' },
  scan: { title: 'Bus scan: probe every 7-bit address' },
};

/** 30 % to 70 % rise time of an RC pull-up: ln(0.7/0.3)·R·C. */
export const riseTime = (r, c) => 0.8473 * r * c;
/** Maximum rise time allowed by the I2C specification (NXP UM10204), by bus speed in Hz. */
export const RISE_LIMIT = { 100000: 1000e-9, 400000: 300e-9 };
/** Smallest pull-up a 3 mA open-drain output can pull down to 0.4 V (standard/fast mode). */
export const rMin = (vdd) => (vdd - 0.4) / 0.003;

/** This model's temperature format: 12-bit two's complement, 0.0625 °C per count, left-justified in two bytes. */
export function tempToBytes(c) {
  const raw = Math.round(c / 0.0625) & 0xfff;
  return [(raw >> 4) & 0xff, (raw << 4) & 0xff];
}
export function bytesToTemp(msb, lsb) {
  let raw = ((msb << 8) | lsb) >> 4;
  if (raw & 0x800) raw -= 0x1000;
  return raw * 0.0625;
}

export function makeSensor(getTemp = () => 25) {
  let ptr = 0, first = true, n = 0;
  return {
    select(rw) { first = true; n = 0; return true; },
    write(b) { if (first) { ptr = b & 3; first = false; } return true; },
    read() { const bytes = ptr === 0 ? tempToBytes(getTemp()) : [0, 0]; return bytes[n++ & 1]; },
    stop() {},
  };
}
/** 256-byte EEPROM with a one-byte word address. After a write it does not answer for `busyProbes` address attempts. */
export function makeEeprom(busyProbes = 2) {
  const mem = new Uint8Array(256).fill(0xff);
  let ptr = 0, first = true, wrote = false, busy = 0;
  return {
    mem,
    get busy() { return busy; },
    select() { if (busy > 0) { busy--; return false; } first = true; wrote = false; return true; },
    write(b) { if (first) { ptr = b; first = false; } else { mem[ptr] = b; ptr = (ptr + 1) & 0xff; wrote = true; } return true; },
    read() { const v = mem[ptr]; ptr = (ptr + 1) & 0xff; return v; },
    stop() { if (wrote) { busy = busyProbes; wrote = false; } },
  };
}

/**
 * Run a controller's plan against the targets on the bus and return the ops that actually appear on the wires.
 * plan: {start} | {addr, rw} | {write: byte} | {read: true, last?: bool} | {stop}. A NACK makes the controller stop.
 */
export function runPlan(targets, plan, opts = {}) {
  const ops = [];
  let cur = null, result = { ops, nack: null, read: [] };
  for (const p of plan) {
    if (p.start) ops.push({ start: true });
    else if (p.stop) { if (cur) cur.stop(); cur = null; ops.push({ stop: true }); }
    else if (p.addr != null) {
      const t = targets[p.addr];
      const ack = !!(t && t.select(p.rw));
      cur = ack ? t : null;
      ops.push({ addr: p.addr, rw: p.rw, ack });
      if (!ack) { ops.push({ stop: true }); result.nack = { addr: p.addr, present: !!t }; return result; }
      if (opts.stretch) ops.push({ stretch: opts.stretch });
    } else if (p.write != null) {
      const ack = cur ? cur.write(p.write) : false;
      ops.push({ byte: p.write, ack, from: 'controller' });
    } else if (p.read) {
      const b = cur ? cur.read() : 0xff;
      result.read.push(b);
      ops.push({ byte: b, ack: !p.last, from: 'target' });
    }
  }
  return result;
}

export function makeChallenge(rnd = Math.random) {
  const addr = 0x08 + Math.floor(rnd() * 0x70), rw = rnd() < 0.5 ? 1 : 0, data = 1 + Math.floor(rnd() * 254);
  const ops = [{ start: true }, { addr, rw, ack: true }, { byte: data, ack: rw ? false : true, from: rw ? 'target' : 'controller' }, { stop: true }];
  return { ops, answer: { addr, rw, data } };
}
const rev = (v, n) => { let o = 0; for (let i = 0; i < n; i++) o |= ((v >> i) & 1) << (n - 1 - i); return o; };
/** Grade a decode attempt with feedback aimed at the usual misreadings. */
export function checkDecode(ans, g) {
  const first = (ans.addr << 1) | ans.rw;
  if (!Number.isInteger(g.addr) || !Number.isInteger(g.data)) return { ok: false, msg: 'Enter the address and the data byte in hex, for example 48 and 1F.' };
  if (g.addr !== ans.addr) {
    if (g.addr === first) return { ok: false, msg: 'That is all eight bits of the first byte. Only the first seven are the address; the eighth is the R/W bit. Code that passes this 8-bit value where a 7-bit address is expected talks to the wrong address.' };
    if (g.addr === rev(ans.addr, 7) || g.addr === rev(first, 8)) return { ok: false, msg: 'You read the bits in the wrong order. I2C sends the most significant bit first (UART is the one that sends LSB first).' };
    if (g.addr === (first & 0x7f)) return { ok: false, msg: 'You skipped the first bit after the start condition. The address is the first seven SCL pulses; read SDA while each one is high.' };
    return { ok: false, msg: 'The address is not right. Find the start (SDA falling while SCL is high), then read SDA during each of the next seven SCL high periods, MSB first.' };
  }
  if (g.rw !== ans.rw) return { ok: false, msg: 'Address is right, direction is not. The eighth bit is R/W: 1 means the controller wants to read, 0 means it will write.' };
  if (g.data !== ans.data) {
    const nine = (ans.data << 1) | (ans.rw ? 1 : 0);
    if (g.data === (nine & 0xff) || g.data === ((ans.data >> 1) | 0)) return { ok: false, msg: 'The data is off by one bit. The ninth clock pulse after the address is the ACK bit, not data: the data byte starts on the pulse after it.' };
    if (g.data === rev(ans.data, 8)) return { ok: false, msg: 'Right bits, wrong order: the data byte is also sent MSB first.' };
    return { ok: false, msg: 'Address and direction are right; the data byte is not. Skip the ACK pulse after the address, then read eight SCL pulses.' };
  }
  return { ok: true, msg: `Correct: ${ans.rw ? 'read from' : 'write to'} ${hex(ans.addr, 2)}, data ${hex(ans.data, 2)}. On the wire the first byte is ${hex(first, 2)} (address shifted left, R/W in bit 0).` };
}

const CTRL = 'var(--sig1)', TGT = 'var(--sig4)';

export default function mount(el, props = {}, ctx = {}) {
  const st = {
    tab: DEVICES[props.device] ? props.device : 'tmp102',
    pullups: true, wrongAddr: false, stretch: false, r: 4700, c: 100e-12, freq: 100000, vdd: 3.3,
    temp: 25, eeAddr: 0x10, eeData: 0xa5, scan: null, scanSel: 0x48,
    last: null, text: '', kind: '',
    ch: makeChallenge(), chMsg: null, tried: false,
  };
  const eeprom = makeEeprom();
  const targets = { 0x48: makeSensor(() => st.temp), 0x50: eeprom };

  const tabs = h('div', { class: 'w-tabs', role: 'group', 'aria-label': 'Target' });
  const panel = h('div');
  const faults = h('div', { class: 'w-controls i2c-visualizer-faults' });
  const wave = waveBox(560, 'I2C waveform');
  const legend = h('div', { class: 'wave-legend' },
    h('span', null, h('i', { style: { background: CTRL } }), 'controller drives SDA'),
    h('span', null, h('i', { style: { background: TGT } }), 'target drives SDA'),
    h('span', null, 'S start · Sr repeated start · P stop · A ACK (SDA low) · N NACK (SDA left high)'));
  const decoded = h('div', { class: 'w-mono i2c-visualizer-decoded' });
  const msg = h('div', { class: 'w-msg', role: 'status' });
  const elec = h('div');
  const body = h('div', null, faults, wave.wrap, legend, decoded, msg, elec);

  const check = (label, key) => h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: st[key], onchange: (e) => { st[key] = e.target.checked; rerun(); } }), label);
  faults.append(
    check('Pull-up resistors fitted', 'pullups'),
    check('Fault: controller uses the wrong address (+1)', 'wrongAddr'),
    check('Target stretches the clock after its address', 'stretch'));

  // electrical panel
  const rIn = h('input', { type: 'range', min: 0, max: 100, step: 1, 'aria-label': 'Pull-up resistance' });
  const cIn = h('input', { type: 'range', min: 10, max: 400, step: 10, 'aria-label': 'Bus capacitance in picofarads' });
  const rOut = h('output'), cOut = h('output');
  const fSel = h('select', { 'aria-label': 'Bus speed', onchange: () => { st.freq = +fSel.value; rerun(); } },
    h('option', { value: 100000 }, '100 kHz (standard mode)'), h('option', { value: 400000 }, '400 kHz (fast mode)'));
  const rFromPos = (p) => { const v = 470 * Math.pow(100000 / 470, p / 100); const m = Math.pow(10, Math.floor(Math.log10(v))); return Math.round(v / m * 10) / 10 * m; };
  rIn.value = Math.round(100 * Math.log(st.r / 470) / Math.log(100000 / 470)); cIn.value = st.c * 1e12;
  rIn.oninput = () => { st.r = rFromPos(+rIn.value); drawElec(); draw(); };
  cIn.oninput = () => { st.c = +cIn.value * 1e-12; drawElec(); draw(); };
  const elecOut = h('div', { class: 'w-readout' }), elecMsg = h('div', { class: 'w-msg' });
  elec.append(h('h4', { class: 'i2c-visualizer-h' }, 'Pull-up, capacitance and rise time'),
    h('div', { class: 'w-controls' },
      h('label', { class: 'w-field' }, h('span', null, 'Pull-up R'), rIn, rOut),
      h('label', { class: 'w-field' }, h('span', null, 'Bus capacitance'), cIn, cOut),
      h('label', { class: 'w-field' }, h('span', null, 'Bus speed'), fSel, h('span'))),
    elecOut, elecMsg);

  const note = h('p', { class: 'w-note' }, 'Model: the targets are simulations that follow the common patterns, not specific parts. The sensor\'s register layout and number format, ',
    'the EEPROM\'s size and its write-cycle time are choices made for this model: check the datasheet of the real part. Rising edges are drawn as a single RC curve with time constant R·C; ',
    'falling edges are drawn instant. Timing within a bit is a symmetric 50 % clock, which real controllers do not promise.');
  el.append(tabs, panel, body, note);

  const byteIn = (label, key) => {
    const e = h('input', { type: 'text', class: 'mono i2c-visualizer-hex', value: st[key].toString(16).toUpperCase().padStart(2, '0'), maxlength: 4, 'aria-label': label + ' (hex)',
      onchange: () => { const v = parseInt(e.value.replace(/^0x/i, ''), 16); if (Number.isInteger(v) && v >= 0 && v <= 255) st[key] = v; e.value = st[key].toString(16).toUpperCase().padStart(2, '0'); } });
    return h('label', { class: 'row' }, label, h('span', { class: 'w-mono' }, '0x'), e);
  };
  const a = (x) => (st.wrongAddr ? x + 1 : x);
  const opt = () => ({ stretch: st.stretch ? 3 / st.freq : 0 });

  const actions = {
    readTemp() {
      const r = runPlan(targets, [{ start: true }, { addr: a(0x48), rw: 0 }, { write: 0x00 }, { start: true }, { addr: a(0x48), rw: 1 }, { read: true }, { read: true, last: true }, { stop: true }], opt());
      finish(r, r.nack ? null : `Read 0x${r.read.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' 0x')} → ${bytesToTemp(r.read[0], r.read[1]).toFixed(4)} °C. `
        + 'The write sets the register pointer; the repeated start switches direction without releasing the bus; the controller NACKs the last byte to tell the target to stop sending.');
    },
    eeWrite() {
      const r = runPlan(targets, [{ start: true }, { addr: a(0x50), rw: 0 }, { write: st.eeAddr }, { write: st.eeData }, { stop: true }], opt());
      finish(r, r.nack ? null : `Wrote ${hex(st.eeData, 2)} to word address ${hex(st.eeAddr, 2)}. The stop condition starts the internal write cycle: until it finishes the EEPROM ignores its address. Try another operation now.`);
    },
    eeRead() {
      const r = runPlan(targets, [{ start: true }, { addr: a(0x50), rw: 0 }, { write: st.eeAddr }, { start: true }, { addr: a(0x50), rw: 1 }, { read: true, last: true }, { stop: true }], opt());
      finish(r, r.nack ? null : `Read ${hex(r.read[0], 2)} from word address ${hex(st.eeAddr, 2)}. Same shape as the sensor read: write the address, repeated start, read.`);
    },
    probe(addr) {
      const r = runPlan(targets, [{ start: true }, { addr, rw: 0 }, { stop: true }], opt());
      return r;
    },
    scan() {
      st.scan = {};
      for (let ad = 0x08; ad <= 0x77; ad++) st.scan[ad] = !actions.probe(ad).nack;
      showProbe(st.scanSel);
    },
  };
  function showProbe(addr) {
    st.scanSel = addr;
    const r = actions.probe(addr);
    if (st.scan) st.scan[addr] = !r.nack;
    st.again = () => showProbe(addr);
    finish(r, r.nack ? null : `${hex(addr, 2)} answered: a target pulled SDA low during the ninth clock.`, true);
    drawPanel();
  }
  function finish(r, okText, isProbe) {
    st.last = r;
    if (!st.pullups) { st.kind = 'bad'; st.text = 'With no pull-ups nothing ever pulls the lines high. I2C outputs are open-drain: a device can only pull a line low or let go. Both lines sit low (or float), the controller never sees an idle bus and reports a timeout or "bus busy". The flat trace is what a logic analyser would show.'; }
    else if (r.nack) {
      st.kind = isProbe ? '' : 'bad';
      st.text = r.nack.present
        ? `NACK from ${hex(r.nack.addr, 2)}: the EEPROM is busy with its write cycle and does not answer. Firmware handles this by retrying the address until it gets an ACK ("ACK polling"). ${eeprom.busy} more attempt(s) will fail in this model; a real part is busy for a few milliseconds (datasheet: write cycle time).`
        : `NACK: nobody at ${hex(r.nack.addr, 2)} pulled SDA low in the ninth clock, so the pull-up kept it high. The controller sends a stop. A NACK on the address means wrong address, missing device, unpowered device or broken wiring.`;
    } else { st.kind = 'ok'; st.text = okText; }
    draw();
  }
  function rerun() { if (st.again && st.tab !== 'decode') st.again(); else draw(); drawElec(); }
  const act = (name) => () => { st.again = actions[name]; actions[name](); if (st.tab === 'eeprom') drawPanel(); };

  function drawPanel() {
    clear(panel);
    if (st.tab === 'tmp102') {
      const out = h('output', null, st.temp.toFixed(1) + ' °C');
      panel.append(h('p', null, 'A TMP102-style sensor: write a one-byte register pointer, then read two bytes of temperature.'),
        h('label', { class: 'w-field' }, h('span', null, 'Sensor temperature'), h('input', { type: 'range', min: -40, max: 125, step: 0.5, value: st.temp, 'aria-label': 'Simulated temperature', oninput: (e) => { st.temp = +e.target.value; out.textContent = st.temp.toFixed(1) + ' °C'; } }), out),
        h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: act('readTemp') }, 'Read temperature')));
    } else if (st.tab === 'eeprom') {
      panel.append(h('p', null, 'A 24xx-style EEPROM with a one-byte word address. Write a byte, then immediately try to read it back.'),
        h('div', { class: 'row' }, byteIn('Word address', 'eeAddr'), byteIn('Data', 'eeData')),
        h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: act('eeWrite') }, 'Write byte'), h('button', { class: 'btn ghost', type: 'button', onclick: act('eeRead') }, 'Read byte'),
          h('span', { class: 'w-mono' }, eeprom.busy ? 'EEPROM: write cycle in progress' : 'EEPROM: idle')));
    } else if (st.tab === 'scan') {
      panel.append(h('p', null, 'A scan sends start, address + W, and stop to every address from 0x08 to 0x77 and notes who ACKs. Addresses below 0x08 and above 0x77 are reserved by the specification.'),
        h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => { actions.scan(); } }, 'Scan the bus')));
      if (st.scan) {
        const grid = h('div', { class: 'i2c-visualizer-scan', role: 'group', 'aria-label': 'Scan results; choose an address to see its probe' });
        for (let ad = 0x08; ad <= 0x77; ad++) {
          grid.append(h('button', { type: 'button', class: 'w-bit' + (st.scan[ad] ? ' on' : '') + (ad === st.scanSel ? ' sel' : ''), 'aria-label': `${hex(ad, 2)} ${st.scan[ad] ? 'ACK' : 'NACK'}`, 'aria-pressed': String(ad === st.scanSel), onclick: () => { showProbe(ad); panel.querySelector('.sel')?.focus(); } }, ad.toString(16).toUpperCase().padStart(2, '0')));
        }
        const found = Object.keys(st.scan).filter((k) => st.scan[k]).map((k) => hex(+k, 2));
        panel.append(grid, h('p', { class: 'w-note' }, `Filled = ACK. Found: ${found.length ? found.join(', ') : 'nothing'}. Select an address to see its probe on the wires.`));
      }
    } else {
      const aIn = h('input', { type: 'text', class: 'mono i2c-visualizer-hex', maxlength: 4, 'aria-label': '7-bit address in hex' });
      const dIn = h('input', { type: 'text', class: 'mono i2c-visualizer-hex', maxlength: 4, 'aria-label': 'Data byte in hex' });
      const rw = h('select', { 'aria-label': 'Direction' }, h('option', { value: 0 }, 'write (W)'), h('option', { value: 1 }, 'read (R)'));
      const px = (e) => { const t = e.value.trim().replace(/^0x/i, ''); return /^[0-9a-f]{1,2}$/i.test(t) ? parseInt(t, 16) : NaN; };
      const go = () => {
        st.tried = true;
        st.chMsg = checkDecode(st.ch.answer, { addr: px(aIn), rw: +rw.value, data: px(dIn) });
        if (st.chMsg.ok && ctx.complete) ctx.complete();
        draw();
      };
      panel.append(h('div', { class: 'w-task' }, h('p', null, h('strong', null, 'Task. '), 'This capture has no annotations. Read the 7-bit address, the direction and the data byte off the wires. SDA is valid while SCL is high.')),
        h('form', { class: 'row', onsubmit: (e) => { e.preventDefault(); go(); } },
          h('label', { class: 'row' }, 'Address 0x', aIn), rw, h('label', { class: 'row' }, 'Data 0x', dIn),
          h('button', { class: 'btn', type: 'submit' }, 'Check'),
          h('button', { class: 'btn ghost', type: 'button', onclick: () => { st.ch = makeChallenge(); st.chMsg = null; st.tried = false; drawPanel(); draw(); } }, 'New capture')));
    }
  }

  function draw() {
    const decode = st.tab === 'decode';
    faults.hidden = legend.hidden = decoded.hidden = elec.hidden = decode;
    let w, ann = [], spans = [], rise = 0;
    if (decode) {
      w = i2cEncode(st.ch.ops, { freq: 100000 });
      if (st.chMsg && st.chMsg.ok) ann = w.segments.map((sg) => ({ ch: 1, t0: sg.t0, t1: sg.t1, text: sg.kind === 'ack' ? sg.text[0] : sg.text, color: sg.driver === 'target' ? TGT : CTRL }));
      msg.hidden = !st.chMsg;
      if (st.chMsg) { msg.className = 'w-msg ' + (st.chMsg.ok ? 'ok' : 'bad'); msg.textContent = st.chMsg.msg; }
    } else {
      msg.hidden = !st.last;
      if (!st.last) { clear(wave.svg); wave.wrap.hidden = true; decoded.textContent = ''; return; }
      w = i2cEncode(st.last.ops, { freq: st.freq });
      if (!st.pullups) {
        w = { ...w, scl: [{ t: 0, v: 0 }], sda: [{ t: 0, v: 0 }], segments: [], bits: [] };
        decoded.textContent = 'decoded: nothing (no start condition can be formed)';
      } else {
        rise = st.r * st.c;
        ann = w.segments.map((sg) => ({ ch: sg.kind === 'stretch' ? 0 : 1, t0: sg.t0, t1: sg.t1, text: sg.kind === 'ack' ? sg.text[0] : sg.text, color: sg.driver === 'target' ? TGT : CTRL,
          title: `${sg.kind}: ${sg.text}, ${sg.kind === 'stretch' ? 'SCL held low by the target' : 'SDA driven by the ' + sg.driver}` }));
        spans = w.segments.filter((sg) => sg.driver === 'target' && sg.kind !== 'stretch').map((sg) => ({ t0: sg.t0, t1: sg.t1, color: TGT }));
        const ev = i2cDecode(w.scl, w.sda);
        decoded.textContent = 'decoded: ' + ev.map((e) => (e.type === 'start' ? 'S' : e.type === 'restart' ? 'Sr' : e.type === 'stop' ? 'P'
          : e.type === 'address' ? `[${hex(e.addr, 2)} ${e.rw ? 'R' : 'W'} ${e.ack ? 'ACK' : 'NACK'}]` : `[${hex(e.byte, 2)} ${e.ack ? 'ACK' : 'NACK'}]`)).join(' ');
      }
      msg.className = 'w-msg ' + st.kind; msg.textContent = st.text + (st.stretch && st.pullups && !st.last.nack ? ' Clock stretching: after its address the target holds SCL low for a while (it is open-drain too), and the controller must wait until SCL really rises before sending the next bit.' : '');
    }
    wave.wrap.hidden = false;
    wave.wrap.firstChild.style.minWidth = Math.max(decode ? 620 : 560, w.bits.length * 17) + 'px';
    drawWaves(wave.svg, [
      { name: 'SCL', edges: w.scl, color: 'var(--sig6)', rise },
      { name: 'SDA', edges: w.sda, color: decode ? 'var(--sig1)' : CTRL, rise, spans },
    ], { t0: 0, t1: w.duration, annotations: ann, height: 40, labelWidth: 40 });
  }

  function drawElec() {
    rOut.textContent = fmtSI(st.r, 'Ω'); cOut.textContent = fmtSI(st.c, 'F');
    const tr = riseTime(st.r, st.c), lim = RISE_LIMIT[st.freq], min = rMin(st.vdd);
    const cells = [['t_r ≈ 0.8473·R·C', fmtSI(tr, 's')], ['limit at this speed', fmtSI(lim, 's')], ['R·C time constant', fmtSI(st.r * st.c, 's')], [`min R at ${st.vdd} V`, fmtSI(min, 'Ω')]];
    clear(elecOut).append(...cells.map(([k, v]) => h('div', null, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v))));
    const low = st.r < min;
    elecMsg.className = 'w-msg ' + (tr > lim || low ? 'bad' : tr > lim * 0.7 ? 'warn' : 'ok');
    elecMsg.textContent = low
      ? `Rise time is fine, but ${fmtSI(st.r, 'Ω')} is below (VDD − 0.4 V) / 3 mA = ${fmtSI(min, 'Ω')}: an output that is only guaranteed to sink 3 mA cannot pull the line down to a valid low.`
      : tr > lim
        ? `Too slow: the line takes ${fmtSI(tr, 's')} to climb from 30 % to 70 % of VDD, but the specification allows ${fmtSI(lim, 's')} at ${st.freq / 1000} kHz. Bits are sampled before SDA has settled. Use a smaller pull-up, reduce capacitance (shorter wires, fewer devices) or slow the bus down.`
        : `Within the ${fmtSI(lim, 's')} limit. The pull-up resistor is the only thing that raises the line, charging the bus capacitance through R; a larger R or more capacitance rounds the rising edges. A smaller R costs more current every time the line is low (${fmtSI(st.vdd / st.r, 'A')} here).`;
  }

  function drawTabs() {
    clear(tabs);
    for (const [k, label] of [['tmp102', 'Temperature sensor'], ['eeprom', 'EEPROM'], ['scan', 'Bus scan'], ['decode', 'Decode challenge']]) {
      tabs.append(h('button', { type: 'button', class: 'w-tab' + (st.tab === k ? ' on' : ''), 'aria-pressed': String(st.tab === k),
        onclick: () => { st.tab = k; st.last = null; st.again = null; drawTabs(); drawPanel(); start(); tabs.querySelector('.on').focus(); } }, label));
    }
  }
  function start() {
    if (st.tab === 'tmp102') act('readTemp')();
    else if (st.tab === 'scan') { st.scan = null; st.again = () => showProbe(st.scanSel); showProbe(st.scanSel); st.scan = null; drawPanel(); }
    else draw();
  }
  if (props.device === 'decode' || props.challenge) st.tab = 'decode';
  drawTabs(); drawPanel(); drawElec(); start();
  onResize(wave.wrap, draw);
}
