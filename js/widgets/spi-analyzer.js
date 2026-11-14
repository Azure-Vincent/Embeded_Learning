// SPI transaction between a controller and a simulated peripheral, each with its own idea of the mode.
import { h, clear, hex } from '../core/dom.js';
import { spiEncode, spiDecode, spiPeripheral, spiSampleLevel } from '../sim/signals.js';
import { drawWaves, waveBox, onResize } from './_wave.js';

export const MODES = [0, 1, 2, 3].map((m) => ({
  mode: m, cpol: (m >> 1) & 1, cpha: m & 1,
  idle: (m >> 1) & 1 ? 'high' : 'low',
  sample: spiSampleLevel(m) ? 'rising' : 'falling',
  shift: spiSampleLevel(m) ? 'falling' : 'rising',
}));

/** Simulated peripherals. The ID and register values are made up for this model. */
export const DEVICES = {
  id: { title: 'Read ID: command 0x9F, then three ID bytes', tx: [0x9f, 0, 0, 0], reply: [0xb5, 0x1c, 0x42],
    respond: (rx, n) => (rx[0] === 0x9f && n >= 1 && n <= 3 ? [0xb5, 0x1c, 0x42][n - 1] : 0) },
  reg: { title: 'Read register: 0x80 | address, then one data byte', tx: [0x8f, 0], reply: [0x5a],
    respond: (rx, n) => (n === 1 && rx.length && (rx[0] & 0x80) ? ({ 0x0f: 0x5a, 0x10: 0x3c }[rx[0] & 0x7f] ?? 0) : 0) },
};
export const CHALLENGES = { 'identify-mode': { title: 'Identify the SPI mode from an unlabelled capture' } };

/** One transaction: the controller clocks out `device.tx` in its mode; the peripheral reacts to the real wires in its own. */
export function transact({ device = 'id', ctrlMode = 0, periMode = 0, ctrlOrder = 'msb', periOrder = 'msb', freq = 1e6 } = {}) {
  const dev = DEVICES[device] || DEVICES.id;
  const w = spiEncode({ mosi: dev.tx, miso: [], mode: ctrlMode, bitOrder: ctrlOrder, freq });
  const p = spiPeripheral(w, { mode: periMode, bitOrder: periOrder, respond: dev.respond });
  const sig = { cs: w.cs, sclk: w.sclk, mosi: w.mosi, miso: p.miso };
  const hold = 0.25 / freq;
  const ctrl = spiDecode(sig, { mode: ctrlMode, bitOrder: ctrlOrder, hold });
  const peri = spiDecode(sig, { mode: periMode, bitOrder: periOrder, hold });
  const expected = [0, ...dev.reply];
  return {
    sig, duration: w.duration, sent: dev.tx, periRx: p.rx, read: ctrl.miso, expected,
    sampleEdges: w.sampleEdges, shiftEdges: w.shiftEdges, sampleTimes: ctrl.sampleTimes,
    marginal: { ctrl: ctrl.marginal.miso, peri: peri.marginal.mosi },
    ok: p.rx.join() === dev.tx.join() && ctrl.miso.join() === expected.join(),
  };
}

export function makeCapture(rnd = Math.random) {
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const mode = Math.floor(rnd() * 4);
  const mosi = [pick([0xa5, 0x96, 0xb4, 0xd2]), pick([0x5a, 0x69, 0x4b, 0x2d])], miso = [pick([0xc3, 0x9c, 0xe1]), pick([0x36, 0x1e, 0x72])];
  return { mode, mosi, miso, sig: spiEncode({ mosi, miso, mode, freq: 1e6 }) };
}
/** Feedback for a wrong guess that points at what to look at without naming the answer. */
export function modeFeedback(answer, guess) {
  if (guess === answer) {
    const m = MODES[answer];
    return { ok: true, msg: `Correct: mode ${answer}. SCLK idles ${m.idle} (CPOL=${m.cpol}) and the data lines are stable across each ${m.sample} edge and change on the ${m.shift} edge (CPHA=${m.cpha}).` };
  }
  const a = MODES[answer], g = MODES[guess];
  if (a.cpol !== g.cpol) return { ok: false, msg: `Mode ${guess} has the clock idling ${g.idle}. Look at SCLK while CS is high, before the transfer starts: that idle level is CPOL. A peripheral set to mode ${guess} here would ${a.sample === g.sample ? 'still sample on the right edge, but only by luck' : 'sample on the edge where data is changing'}.` };
  return { ok: false, msg: `The idle level is right, the phase is not. Mode ${guess} samples on the ${g.sample} edge. Look at MOSI: on which clock edge does it change, and is the first bit already there before the first edge? Data must be stable on the sampling edge.` };
}

const bytesText = (a) => (a.length ? a.map((b) => hex(b, 2)).join(' ') : '(nothing)');

export default function mount(el, props = {}, ctx = {}) {
  const m0 = [0, 1, 2, 3].includes(+props.mode) ? +props.mode : 0;
  const st = { tab: props.challenge ? 'challenge' : 'explore', device: 'id', ctrlMode: m0, periMode: m0, ctrlOrder: 'msb', periOrder: 'msb', cap: makeCapture(), fb: null, guess: null };

  const tabs = h('div', { class: 'w-tabs', role: 'group', 'aria-label': 'View' });
  const sel = (label, opts, key, num) => {
    const e = h('select', { 'aria-label': label, onchange: () => { st[key] = num ? +e.value : e.value; draw(); } }, opts.map(([v, t]) => h('option', { value: v, selected: String(st[key]) === String(v) }, t)));
    return h('label', { class: 'w-field' }, h('span', null, label), e, h('span'));
  };
  const modeOpts = MODES.map((m) => [m.mode, `mode ${m.mode} (CPOL=${m.cpol}, CPHA=${m.cpha})`]);
  const orderOpts = [['msb', 'MSB first'], ['lsb', 'LSB first']];
  const controls = h('div', { class: 'w-grid' },
    h('div', { class: 'w-controls' }, sel('Transaction', Object.entries(DEVICES).map(([k, d]) => [k, d.title]), 'device'),
      sel('Controller mode', modeOpts, 'ctrlMode', true), sel('Controller bit order', orderOpts, 'ctrlOrder')),
    h('div', { class: 'w-controls' }, sel('Peripheral mode', modeOpts, 'periMode', true), sel('Peripheral bit order', orderOpts, 'periOrder'),
      h('p', { class: 'w-note', style: { margin: 0 } }, 'The peripheral only works when both settings match what it was built for. Change the controller, or the peripheral, and see what each side actually receives.')));
  const table = h('div', { class: 'table-wrap' });
  const task = h('div');
  const wave = waveBox(640, 'SPI waveform');
  const legend = h('div', { class: 'wave-legend' });
  const readout = h('dl', { class: 'w-kv spi-analyzer-kv' });
  const msg = h('div', { class: 'w-msg', role: 'status' });
  const note = h('p', { class: 'w-note' }, 'Model: 1 MHz clock, ideal edges. Outputs change 50 ns after their shift edge (a stand-in for clock-to-output delay), so a side that samples on the wrong edge ',
    'reads the bit that was there just before the edge. On real parts that is a hold-time violation and the result can differ from sample to sample. MISO is drawn low when nothing drives it; ',
    'a real MISO is high-impedance while CS is high. The command set and ID bytes are invented for this simulation.');
  el.append(tabs, controls, table, task, wave.wrap, legend, readout, msg, note);

  function drawTable() {
    clear(table).append(h('table', { class: 'spi-analyzer-modes' },
      h('thead', null, h('tr', null, ['Mode', 'CPOL', 'CPHA', 'Clock idles', 'Data sampled on', 'Data changes on'].map((t) => h('th', null, t)))),
      h('tbody', null, MODES.map((m) => h('tr', { class: st.tab === 'explore' && m.mode === st.ctrlMode ? 'on' : null },
        [m.mode, m.cpol, m.cpha, m.idle, m.sample + ' edge', m.shift + ' edge'].map((t) => h('td', null, String(t))))))));
  }

  function draw() {
    clear(tabs);
    for (const [k, label] of [['explore', 'Explore'], ['challenge', 'Identify the mode']]) {
      tabs.append(h('button', { type: 'button', class: 'w-tab' + (st.tab === k ? ' on' : ''), 'aria-pressed': String(st.tab === k), onclick: () => { st.tab = k; draw(); tabs.querySelector('.on').focus(); } }, label));
    }
    const ch = st.tab === 'challenge';
    controls.hidden = readout.hidden = ch;
    drawTable();
    clear(task); clear(legend);
    if (ch) {
      const c = st.cap;
      task.append(h('div', { class: 'w-task' }, h('p', null, h('strong', null, 'Task. '), 'A capture from an unknown board. Which SPI mode is the controller using? Use the clock\'s idle level and the edge on which the data lines change.')),
        h('div', { class: 'row', role: 'group', 'aria-label': 'Your answer' },
          MODES.map((m) => h('button', { type: 'button', class: 'btn small' + (st.guess === m.mode ? '' : ' ghost'), onclick: () => { st.guess = m.mode; st.fb = modeFeedback(c.mode, m.mode); if (st.fb.ok && ctx.complete) ctx.complete(); draw(); task.querySelectorAll('button')[m.mode].focus(); } }, 'Mode ' + m.mode)),
          h('button', { type: 'button', class: 'btn small ghost', onclick: () => { st.cap = makeCapture(); st.fb = null; st.guess = null; draw(); } }, 'New capture')));
      const solved = st.fb && st.fb.ok;
      drawWaves(wave.svg, [
        { name: 'CS', edges: c.sig.cs, color: 'var(--sig6)' }, { name: 'SCLK', edges: c.sig.sclk, color: 'var(--sig5)' },
        { name: 'MOSI', edges: c.sig.mosi, color: 'var(--sig1)' }, { name: 'MISO', edges: c.sig.miso, color: 'var(--sig3)' },
      ], { t0: 0, t1: c.sig.duration, labelWidth: 46, height: 32,
        markers: solved ? c.sig.sampleEdges.map((t) => ({ ch: 1, t, shape: 'up', color: 'var(--copper)', title: 'sample' })) : [],
        annotations: solved ? byteAnn(c.sig.sampleEdges, c.mosi, 2).concat(byteAnn(c.sig.sampleEdges, c.miso, 3)) : [] });
      msg.hidden = !st.fb;
      if (st.fb) { msg.className = 'w-msg ' + (st.fb.ok ? 'ok' : 'bad'); msg.textContent = st.fb.msg; }
      return;
    }
    const r = transact(st);
    legend.append(h('span', null, h('i', { style: { background: 'var(--copper)', height: '8px', width: '8px' } }), 'controller samples MISO here'),
      h('span', null, h('i', { style: { background: 'var(--sig2)', height: '8px', width: '8px' } }), 'peripheral samples MOSI here'));
    const pl = spiSampleLevel(st.periMode);
    const periTimes = r.sig.sclk.slice(1).filter((e) => e.v === pl).map((e) => e.t);
    const same = spiSampleLevel(st.ctrlMode) === pl;
    drawWaves(wave.svg, [
      { name: 'CS', edges: r.sig.cs, color: 'var(--sig6)' }, { name: 'SCLK', edges: r.sig.sclk, color: 'var(--sig5)' },
      { name: 'MOSI', edges: r.sig.mosi, color: 'var(--sig1)' }, { name: 'MISO', edges: r.sig.miso, color: 'var(--sig3)' },
    ], { t0: 0, t1: r.duration, labelWidth: 46, height: 32,
      markers: [...r.sampleTimes.map((t) => ({ ch: 3, t, shape: 'up', color: 'var(--copper)', title: 'controller samples MISO' })),
        ...periTimes.map((t) => ({ ch: 2, t, shape: 'up', color: 'var(--sig2)', title: 'peripheral samples MOSI' }))],
      annotations: [...byteAnn(r.sampleTimes, r.periRx, 2, 'var(--sig2)', periTimes), ...byteAnn(r.sampleTimes, r.read, 3, 'var(--copper)')] });
    const row = (k, v, bad) => [h('dt', null, k), h('dd', { class: bad ? 'spi-analyzer-bad' : null }, v)];
    clear(readout).append(
      ...row('Controller sent', bytesText(r.sent)), ...row('Peripheral received', bytesText(r.periRx), r.periRx.join() !== r.sent.join()),
      ...row('Correct reply would be', bytesText(r.expected)), ...row('Controller read', bytesText(r.read), r.read.join() !== r.expected.join()));
    msg.hidden = false;
    msg.className = 'w-msg ' + (r.ok && !r.marginal.ctrl && !r.marginal.peri ? 'ok' : r.ok ? 'warn' : 'bad');
    const orderBad = st.ctrlOrder !== st.periOrder;
    const cm = MODES[st.ctrlMode], pm = MODES[st.periMode];
    let t;
    if (st.ctrlMode === st.periMode && !orderBad) t = `Both sides use mode ${st.ctrlMode}: each output changes on the ${cm.shift} edge and is sampled half a clock later on the ${cm.sample} edge, with the most margin on both sides of the sample. The first byte read back is a placeholder, because the peripheral cannot answer a command it has not finished receiving.`;
    else if (orderBad && st.ctrlMode === st.periMode) t = `Same mode, different bit order: every byte arrives bit-reversed. The peripheral saw ${hex(r.periRx[0] ?? 0, 2)} instead of ${hex(r.sent[0], 2)}, which is not a command it knows, so it stays silent.`;
    else if (same) t = `Modes ${st.ctrlMode} and ${st.periMode} sample on the same (${cm.sample}) edge, so the command reaches the peripheral intact. They disagree about the clock's idle level, and therefore about whether a shift edge comes before the first sample. `
      + `This peripheral launches its reply one edge ${pm.cpha ? 'late' : 'early'} for the controller, and the controller reads it shifted by one bit: compare "would be" with "read". Some parts, many SPI flash chips among them, count edges in a way that works in both modes 0 and 3 and say so in the datasheet; a general SPI block set to one mode, as modelled here, does not.`;
    else t = `The controller (mode ${st.ctrlMode}) changes its data on the ${cm.shift} edge, which is the very edge on which the peripheral (mode ${st.periMode}) samples, and the same happens in the other direction. `
      + `Each side reads whatever was on the wire just before the change, so data can arrive intact, shifted by one bit or with a byte missing: compare the rows above. ${r.marginal.ctrl + r.marginal.peri} samples in this transfer were taken with no hold margin, which on real hardware makes the result unreliable as well as wrong.`;
    if (orderBad && st.ctrlMode !== st.periMode) t += ' The bit order differs as well, so bytes are also bit-reversed.';
    msg.textContent = t;
  }
  function byteAnn(times, bytes, ch, color, own) {
    const ts = own || times, out = [];
    for (let i = 0; i < bytes.length && i * 8 + 7 < ts.length; i++) {
      const half = (ts[1] - ts[0]) / 2;
      out.push({ ch, t0: ts[i * 8] - half, t1: ts[i * 8 + 7] + half, text: hex(bytes[i], 2), color });
    }
    return out;
  }
  draw();
  onResize(wave.wrap, draw);
}
