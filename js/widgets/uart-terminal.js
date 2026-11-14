// Serial terminal wired to a simulated device. Every byte really travels as a waveform: it is encoded with the
// sender's settings and decoded with the receiver's, so wrong settings give exactly what a real receiver would read.
import { h, s, clear, fmtSI, hex } from '../core/dom.js';
import { uartEncode, uartDecode } from '../sim/signals.js';
import { drawWaves, waveBox, onResize } from './_wave.js';

export const PEERS = {
  echo: { title: 'Echo: sends back every byte it receives' },
  sensor: { title: 'Sensor: prints a reading about once a second' },
  console: { title: 'Console: a tiny command shell (try "help")' },
};
export const BAUDS = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];

/** '8N1' -> {dataBits: 8, parity: 'N', stopBits: 1}. Anything unparseable falls back to 8N1. */
export function parseFormat(fmt) {
  const m = /^([78])([NEO])([12])$/i.exec(String(fmt || ''));
  return m ? { dataBits: +m[1], parity: m[2].toUpperCase(), stopBits: +m[3] } : { dataBits: 8, parity: 'N', stopBits: 1 };
}
export const formatName = (c) => `${c.dataBits}${c.parity}${c.stopBits}`;
/** Bits on the wire per byte, including start, parity and stop. */
export const frameBits = (c) => 1 + c.dataBits + (c.parity === 'N' ? 0 : 1) + c.stopBits;

/** Send bytes over one wire: encode at the sender's settings, decode at the receiver's. */
export function link(bytes, tx, rx) {
  const wave = uartEncode(bytes, { ...tx, idleBefore: 2 / tx.baud, idleAfter: 14 / Math.min(tx.baud, rx.baud) });
  return { wave, got: uartDecode(wave.edges, rx) };
}

/** Fraction of a bit by which the last (stop-bit) sample has drifted for a relative clock error. Fails beyond 0.5. */
export function stopDrift(cfg, err) {
  const n = 1 + cfg.dataBits + (cfg.parity === 'N' ? 0 : 1) + 0.5;      // stop bit is sampled n bit-times after the start edge
  return n * Math.abs(err) / (1 + err);
}

const str = (t) => [...t].map((c) => c.charCodeAt(0) & 0xff);

/** Simulated devices. rx(byte) returns the bytes the device sends in response; tick() returns a periodic message. */
export function makePeer(kind) {
  if (kind === 'sensor') {
    let n = 0;
    return {
      banner: () => str('sensor ready\r\n'),
      rx: () => [],
      tick: () => { n++; const t = 23.5 + Math.sin(n / 3) * 1.5; return str(`T=${t.toFixed(1)} C  n=${n}\r\n`); },
    };
  }
  if (kind === 'console') {
    let line = '', led = false, cmds = 0;
    const run = (c) => {
      cmds++;
      if (c === '') return '';
      if (c === 'help') return 'commands: help, led on, led off, status\r\n';
      if (c === 'led on') { led = true; return 'led is on\r\n'; }
      if (c === 'led off') { led = false; return 'led is off\r\n'; }
      if (c === 'status') return `led=${led ? 'on' : 'off'} cmds=${cmds}\r\n`;
      return '? unknown command (try help)\r\n';
    };
    return {
      banner: () => str('bench console\r\n> '),
      get led() { return led; },
      rx(b) {
        if (b === 0x0d || b === 0x0a) {
          if (b === 0x0a && line === '') return [];             // LF right after CR
          const out = '\r\n' + run(line.trim()) + '> ';
          line = '';
          return str(out);
        }
        if (b === 0x08 || b === 0x7f) { if (!line) return []; line = line.slice(0, -1); return [8, 32, 8]; }
        if (line.length < 40) line += String.fromCharCode(b);
        return [b];                                             // the shell echoes what it hears
      },
      tick: () => [],
    };
  }
  return { banner: () => [], rx: (b) => [b], tick: () => [] };
}

const printable = (b) => b >= 0x20 && b < 0x7f;
export const showByte = (b) => (printable(b) ? `'${String.fromCharCode(b)}'` : b === 13 ? 'CR' : b === 10 ? 'LF' : '');

export default function mount(el, props = {}, ctx = {}) {
  const fmt = parseFormat(props.format);
  const baud0 = BAUDS.includes(+props.baud) ? +props.baud : 9600;
  const st = {
    term: { baud: baud0, ...fmt }, dev: { baud: baud0, ...fmt },
    peerKind: PEERS[props.peer] ? props.peer : 'echo', peer: null,
    connected: false, mystery: false, swapped: false, clockErr: 0, solved: false,
    dir: 'tx', idx: 0, last: { tx: null, rx: null },
    stats: { sent: 0, rx: 0, framing: 0, parity: 0 }, timer: null, cleanRun: 0,
  };
  const devActual = () => ({ ...st.dev, baud: st.dev.baud * (1 + st.clockErr) });

  // ----- controls
  const sel = (label, opts, get, set) => {
    const e = h('select', { 'aria-label': label, onchange: () => { set(e.value); refresh(); } },
      opts.map(([v, t]) => h('option', { value: v, selected: String(get()) === String(v) }, t)));
    return h('label', { class: 'w-field' }, h('span', null, label.replace(/^(Terminal|Device) /, '').replace(/^./, (c) => c.toUpperCase())), e, h('span'));
  };
  const cfgFields = (c, who) => [
    sel(`${who} baud`, BAUDS.map((b) => [b, b + ' baud']), () => c.baud, (v) => { c.baud = +v; }),
    sel(`${who} data bits`, [[8, '8 data bits'], [7, '7 data bits']], () => c.dataBits, (v) => { c.dataBits = +v; }),
    sel(`${who} parity`, [['N', 'no parity'], ['E', 'even parity'], ['O', 'odd parity']], () => c.parity, (v) => { c.parity = v; }),
    sel(`${who} stop bits`, [[1, '1 stop bit'], [2, '2 stop bits']], () => c.stopBits, (v) => { c.stopBits = +v; }),
  ];
  const termBox = h('div', { class: 'w-controls' }, cfgFields(st.term, 'Terminal'));
  const devCfg = h('div', { class: 'w-controls' });
  const peerNote = h('p', { class: 'w-note', style: { margin: 0 } });
  let devKey = '';
  const devBox = h('div', { class: 'w-controls' },
    sel('Device behaviour', Object.keys(PEERS).map((k) => [k, k]), () => st.peerKind, (v) => { st.peerKind = v; if (st.connected) disconnect(); }),
    peerNote, devCfg,
    h('label', { class: 'row' }, h('input', { type: 'checkbox', onchange: (e) => setMystery(e.target.checked) }), 'Mystery device (hide and randomise its settings)'));
  const task = h('div', { class: 'w-task', hidden: true });
  const wiring = s('svg', { class: 'w-svg uart-terminal-wiring', viewBox: '0 0 360 112', role: 'img' });
  const wireMsg = h('div', { class: 'w-note' });
  const screen = h('div', { class: 'w-term uart-terminal-screen', role: 'log', 'aria-label': 'Terminal output', tabindex: '0' });
  const input = h('input', { type: 'text', class: 'w-term-in', placeholder: 'type and press Enter', 'aria-label': 'Text to send', maxlength: 60, autocomplete: 'off', spellcheck: 'false' });
  const eol = h('select', { 'aria-label': 'Line ending' }, h('option', { value: '\r' }, 'CR'), h('option', { value: '\r\n' }, 'CR+LF'), h('option', { value: '' }, 'none'));
  const connectBtn = h('button', { class: 'btn', type: 'button', onclick: () => (st.connected ? disconnect() : connect()) }, 'Connect');
  const sendBtn = h('button', { class: 'btn ghost', type: 'button', onclick: () => send() }, 'Send');
  const readout = h('div', { class: 'w-readout' });
  const msg = h('div', { class: 'w-msg', role: 'status' });
  const wave = waveBox(500, 'UART frame');
  const waveInfo = h('div', { class: 'w-mono uart-terminal-info' });
  const dirTabs = h('div', { class: 'w-tabs', role: 'group', 'aria-label': 'Which wire to show' });
  const prevBtn = h('button', { class: 'btn small ghost', type: 'button', 'aria-label': 'Previous byte', onclick: () => { st.idx--; drawFrame(); } }, '◀');
  const nextBtn = h('button', { class: 'btn small ghost', type: 'button', 'aria-label': 'Next byte', onclick: () => { st.idx++; drawFrame(); } }, '▶');
  const pos = h('span', { class: 'w-mono' });
  const errSlider = h('input', { type: 'range', min: -10, max: 10, step: 0.5, value: 0, 'aria-label': 'Device clock error in percent', oninput: () => { st.clockErr = +errSlider.value / 100; refresh(); demo(); } });
  const errOut = h('output');
  const errMsg = h('div', { class: 'w-msg' });
  const led = h('span', { class: 'uart-terminal-led', title: 'Device LED' });

  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });

  el.append(
    task,
    h('div', { class: 'w-grid' },
      h('fieldset', { class: 'uart-terminal-side' }, h('legend', null, 'Your terminal'), termBox),
      h('fieldset', { class: 'uart-terminal-side' }, h('legend', null, 'Device ', led), devBox)),
    h('div', { class: 'uart-terminal-wirebox' }, wiring,
      h('div', null,
        h('label', { class: 'row' }, h('input', { type: 'checkbox', onchange: (e) => { st.swapped = e.target.checked; refresh(); } }), 'Fault: wire TX to TX and RX to RX'),
        wireMsg)),
    h('div', { class: 'row' }, connectBtn, h('span', { class: 'w-note', style: { margin: 0 } }, 'Opens the port. Nothing is sent or received until you connect.')),
    screen,
    h('div', { class: 'uart-terminal-inrow' }, input, eol, sendBtn),
    readout, msg,
    h('h4', { class: 'uart-terminal-h' }, 'The frame on the wire'),
    h('div', { class: 'row' }, dirTabs, prevBtn, pos, nextBtn),
    wave.wrap, waveInfo,
    h('h4', { class: 'uart-terminal-h' }, 'Clock tolerance'),
    h('label', { class: 'w-field' }, h('span', null, 'Device clock error'), errSlider, errOut),
    errMsg,
    h('p', { class: 'w-note' }, 'Model: ideal square edges, no noise, no cable effects, and the receiver takes one sample in the middle of each bit ',
      '(many real UARTs take several samples around the middle and vote). Only the first stop bit is checked. Bytes appear at once; ',
      'the time axis of the waveform is real. This is a simulation, not a capture from hardware.'),
  );

  // ----- behaviour
  function addText(bytes, cls) {
    for (const g of bytes) {
      const b = g.byte;
      const bad = g.framingError || g.parityError;
      if (b === 0x0d && !bad) continue;
      if (b === 0x0a && !bad) { screen.append('\n'); continue; }
      if (b === 0x08 && !bad) { if (screen.lastChild && screen.lastChild.nodeType === 3) screen.lastChild.remove(); continue; }
      const text = printable(b) ? String.fromCharCode(b) : `‹${b.toString(16).toUpperCase().padStart(2, '0')}›`;
      if (bad || !printable(b) || cls) screen.append(h('span', { class: bad ? 'uart-terminal-err' : cls || 'uart-terminal-np', title: bad ? (g.framingError ? 'framing error' : 'parity error') : hex(b, 2) }, text));
      else screen.append(text);
    }
    while (screen.childNodes.length > 1500) screen.firstChild.remove();
    screen.scrollTop = screen.scrollHeight;
  }
  const sysLine = (t) => { screen.append(h('span', { class: 'uart-terminal-sys' }, t + '\n')); screen.scrollTop = screen.scrollHeight; };

  // device -> terminal
  function fromDevice(bytes) {
    if (!bytes.length) return;
    const r = link(bytes, devActual(), st.term);
    st.last.rx = { ...r, bytes, tx: devActual(), rx: st.term };
    if (st.swapped) { st.last.rx.got = []; return; }
    st.stats.rx += r.got.length;
    const fe = r.got.filter((g) => g.framingError).length, pe = r.got.filter((g) => g.parityError).length;
    st.stats.framing += fe; st.stats.parity += pe;
    const clean = fe === 0 && pe === 0 && r.got.length === bytes.length && r.got.every((g, i) => g.byte === bytes[i]);
    st.cleanRun = clean ? st.cleanRun + r.got.length : 0;
    addText(r.got);
  }
  function show(dir) { st.dir = dir; st.idx = 0; }

  function send() {
    if (!st.connected) { say('Connect first: the port is closed, so nothing leaves your TX pin.', 'warn'); return; }
    const text = input.value;
    const bytes = str(text + eol.value);
    if (!bytes.length) return;
    input.value = '';
    st.stats.sent += bytes.length;
    const r = link(bytes, st.term, devActual());
    st.last.tx = { ...r, bytes, tx: st.term, rx: devActual() };
    show('tx');
    if (st.swapped) { st.last.tx.got = []; say('Your bytes left TX, but TX is wired to the device\'s TX. Its RX pin never sees them, and neither RX pin is driven by anything.', 'bad'); refresh(); return; }
    const reply = [];
    for (const g of r.got) {
      if (g.framingError || g.parityError) continue;       // this device discards bytes its UART flags as bad
      reply.push(...st.peer.rx(g.byte));
    }
    fromDevice(reply);
    const lost = r.got.filter((g) => g.framingError || g.parityError).length;
    if (!r.got.length) say('The device\'s UART decoded nothing from that waveform. Look at the frame below: its sample points never found a valid start bit.', 'bad');
    else if (lost || r.got.length !== bytes.length || r.got.some((g, i) => g.byte !== bytes[i])) say(`You sent ${bytes.length} byte(s); the device decoded ${r.got.length}, ${lost} with errors. Step through the frames below to see where its samples landed.`, 'warn');
    else say(`Sent ${bytes.length} byte(s); the device decoded all of them correctly.`, 'ok');
    checkSolved();
    refresh();
  }

  function connect() {
    st.connected = true; st.peer = makePeer(st.peerKind); st.cleanRun = 0;
    sysLine(`[port open at ${st.term.baud} ${formatName(st.term)}]`);
    fromDevice(st.peer.banner());
    if (st.last.rx) show('rx');
    if (st.peerKind === 'sensor') {
      st.timer = setInterval(() => {
        if (!el.isConnected || !st.connected) { clearInterval(st.timer); st.timer = null; return; }
        fromDevice(st.peer.tick()); show('rx'); checkSolved(); refresh();
      }, 1300);
    }
    say(st.swapped ? 'Port open, but nothing will arrive with TX wired to TX.' : 'Port open.', st.swapped ? 'warn' : '');
    refresh();
    input.focus();
  }
  function disconnect() {
    st.connected = false;
    if (st.timer) { clearInterval(st.timer); st.timer = null; }
    sysLine('[port closed]');
    say('Port closed.');
    refresh();
  }
  function say(t, cls = '') { msg.className = 'w-msg' + (cls ? ' ' + cls : ''); msg.textContent = t; }

  function checkSolved() {
    if (!st.mystery || st.solved || st.swapped) return;
    const same = st.term.baud === st.dev.baud && st.term.dataBits === st.dev.dataBits && st.term.parity === st.dev.parity;
    if (same && st.cleanRun >= 8) {
      st.solved = true;
      if (ctx.complete) ctx.complete();
    }
  }

  function setMystery(on) {
    st.mystery = on; st.solved = false; st.cleanRun = 0;
    if (on) {
      const pick = (a) => a[Math.floor(Math.random() * a.length)];
      st.dev = { baud: pick([9600, 19200, 38400, 57600, 115200].filter((b) => b !== st.term.baud)), dataBits: 8, parity: pick(['N', 'E', 'O']), stopBits: 1 };
      st.clockErr = 0; errSlider.value = 0; st.devVer = (st.devVer || 0) + 1;
    }
    refresh();
  }

  // ----- drawing
  function drawWiring() {
    clear(wiring);
    const bad = st.swapped;
    wiring.setAttribute('aria-label', bad ? 'Wiring: TX to TX and RX to RX (wrong)' : 'Wiring: TX crosses to RX in both directions, grounds joined');
    const box = (x, name) => [s('rect', { x, y: 6, width: 96, height: 100, rx: 4, class: 'uart-terminal-chip' }), s('text', { x: x + 48, y: 22, 'text-anchor': 'middle', class: 'uart-terminal-chipname' }, name)];
    wiring.append(...box(4, 'your adapter'), ...box(260, 'device'));
    const ys = { TX: 44, RX: 68, GND: 92 };
    for (const [n, y] of Object.entries(ys)) {
      wiring.append(s('text', { x: 92, y: y + 4, 'text-anchor': 'end' }, n), s('text', { x: 268, y: y + 4 }, n),
        s('circle', { cx: 100, cy: y, r: 3, class: 'uart-terminal-pin' }), s('circle', { cx: 260, cy: y, r: 3, class: 'uart-terminal-pin' }));
    }
    const wire = (y1, y2, cls) => s('path', { d: `M100 ${y1}C170 ${y1} 190 ${y2} 260 ${y2}`, class: 'uart-terminal-wire ' + cls });
    if (bad) wiring.append(wire(ys.TX, ys.TX, 'bad'), wire(ys.RX, ys.RX, 'bad'));
    else wiring.append(wire(ys.TX, ys.RX, 'a'), wire(ys.RX, ys.TX, 'b'));
    wiring.append(wire(ys.GND, ys.GND, 'gnd'));
    wireMsg.textContent = bad
      ? 'Two outputs now drive one wire and the two inputs listen to a wire nobody drives. Nothing is received in either direction. With push-pull outputs the two TX pins also fight whenever they disagree.'
      : 'TX is an output and RX an input, so each side\'s TX goes to the other side\'s RX. Ground must be shared: a voltage only means something relative to the same reference.';
  }

  function drawFrame() {
    const cur = st.last[st.dir];
    clear(dirTabs);
    for (const [d, label] of [['tx', 'You → device'], ['rx', 'Device → you']]) {
      dirTabs.append(h('button', { class: 'w-tab' + (st.dir === d ? ' on' : ''), type: 'button', 'aria-pressed': String(st.dir === d), onclick: () => { show(d); drawFrame(); } }, label));
    }
    if (!cur || !cur.wave.frames.length) {
      clear(wave.svg); wave.svg.setAttribute('viewBox', '0 0 300 24'); wave.svg.setAttribute('height', 24);
      wave.svg.append(s('text', { x: 4, y: 16, class: 'wave-tick' }, st.dir === 'tx' ? 'Nothing sent yet.' : 'Nothing received yet.'));
      waveInfo.textContent = ''; pos.textContent = '0 / 0'; prevBtn.disabled = nextBtn.disabled = true;
      return;
    }
    const frames = cur.wave.frames;
    st.idx = Math.max(0, Math.min(frames.length - 1, st.idx));
    const f = frames[st.idx];
    prevBtn.disabled = st.idx === 0; nextBtn.disabled = st.idx === frames.length - 1;
    pos.textContent = `byte ${st.idx + 1} / ${frames.length}`;
    const Tt = 1 / cur.tx.baud, Tr = 1 / cur.rx.baud;
    const t0 = f.t - Tt, t1 = f.bits[f.bits.length - 1].t1 + Math.max(Tt, Tr);
    const ann = f.bits.map((b) => ({
      ch: 0, t0: b.t0, t1: b.t1,
      text: b.kind === 'start' ? 'St' : b.kind === 'stop' ? 'Sp' : b.kind === 'parity' ? 'P' : 'b' + b.index,
      title: b.kind === 'data' ? `data bit ${b.index}${b.index === 0 ? ' (LSB, sent first)' : ''} = ${b.v}` : `${b.kind} bit = ${b.v}`,
      color: b.kind === 'data' ? 'var(--sig1)' : b.kind === 'parity' ? 'var(--sig5)' : 'var(--sig6)',
    }));
    const markers = [], rxNotes = [];
    for (const g of cur.got) {
      const last = g.samples[g.samples.length - 1];
      if (last.t < t0 || g.t > t1) continue;
      for (const sm of g.samples) {
        if (sm.t < t0 || sm.t > t1) continue;
        const bad = sm.kind === 'stop' && sm.v !== 1;
        markers.push({ ch: 1, t: sm.t, shape: 'dot', color: bad ? 'var(--bad)' : 'var(--ink)', title: `receiver samples ${sm.kind} = ${sm.v}` });
        ann.push({ ch: 1, t0: sm.t - Tr / 2, t1: sm.t + Tr / 2, text: sm.kind === 'start' ? 'St' : sm.kind === 'stop' ? (bad ? '✗' : 'Sp') : sm.kind === 'parity' ? 'P' + sm.v : String(sm.v),
          color: bad || (sm.kind === 'parity' && g.parityError) ? 'var(--bad)' : sm.kind === 'data' ? 'var(--sig3)' : 'var(--sig6)', title: `receiver reads ${sm.kind} = ${sm.v}` });
      }
      rxNotes.push(`${hex(g.byte, 2)} ${showByte(g.byte)}${g.framingError ? ' framing error' : ''}${g.parityError ? ' parity error' : ''}`.trim());
    }
    const none = st.swapped;
    drawWaves(wave.svg, [
      { name: 'sent', edges: cur.wave.edges, color: 'var(--sig1)' },
      { name: 'as read', edges: none ? [{ t: 0, v: 1 }] : cur.wave.edges, color: 'var(--sig3)' },
    ], { t0, t1, annotations: none ? ann.filter((a) => a.ch === 0) : ann, markers: none ? [] : markers, labelWidth: 54 });
    const who = st.dir === 'tx' ? ['you', 'the device'] : ['the device', 'you'];
    waveInfo.textContent = `${who[0]} sent ${hex(f.byte, 2)} ${showByte(f.byte)} at ${Math.round(cur.tx.baud)} baud, bits LSB first → `
      + (none ? `${who[1]} received nothing (wire not connected to an RX pin)` : `${who[1]} sampling at ${Math.round(cur.rx.baud)} baud read: ${rxNotes.length ? rxNotes.join(', ') : 'nothing in this window'}`);
  }

  function refresh() {
    const key = `${st.mystery}|${st.solved}|${st.devVer}`;
    if (key !== devKey) {          // rebuild only when hidden/revealed/randomised, so selects keep keyboard focus
      devKey = key;
      clear(devCfg).append(...(st.mystery && !st.solved ? [h('p', { class: 'w-mono' }, 'settings: hidden')] : cfgFields(st.dev, 'Device')));
    }
    peerNote.textContent = PEERS[st.peerKind].title;
    task.hidden = !st.mystery;
    if (st.mystery) {
      clear(task).append(h('p', null, h('strong', null, 'Task. '), st.solved
        ? `Solved: the device was at ${st.dev.baud} ${formatName(st.dev)}. Clean text needs every setting to match, not just the baud rate.`
        : 'The device\'s settings are unknown (8 data bits, 1 stop bit; baud and parity are yours to find). Connect, watch what arrives, and change your terminal\'s settings until the text is clean. The "sensor" behaviour is the easiest to work with because it talks without being asked.'));
    }
    connectBtn.textContent = st.connected ? 'Disconnect' : 'Connect';
    sendBtn.disabled = !st.connected;
    led.classList.toggle('on', !!(st.peer && st.peer.led));
    led.hidden = st.peerKind !== 'console';
    const T = 1 / st.term.baud, n = frameBits(st.term);
    clear(readout).append(
      ...[['bit time = 1/baud', fmtSI(T, 's')], [`frame (${n} bits)`, fmtSI(n * T, 's')], ['max throughput', Math.floor(st.term.baud / n) + ' bytes/s'],
        ['bytes received', st.stats.rx], ['framing errors', st.stats.framing], ['parity errors', st.stats.parity]]
        .map(([k, v]) => h('div', null, h('div', { class: 'k' }, k), h('div', { class: 'v' }, String(v)))));
    const drift = stopDrift(st.term, st.clockErr), pct = (st.clockErr * 100).toFixed(1);
    errOut.textContent = (st.clockErr > 0 ? '+' : '') + pct + ' %';
    errMsg.className = 'w-msg ' + (drift >= 0.5 ? 'bad' : drift >= 0.3 ? 'warn' : 'ok');
    errMsg.textContent = `The receiver re-synchronises on each start edge, then counts bit times with its own clock. With ${formatName(st.term)} the stop bit is sampled `
      + `${(frameBits(st.term) - st.term.stopBits + 0.5)} bit times later, so a ${Math.abs(pct)} % mismatch has drifted ${(drift * 100).toFixed(0)} % of a bit by then. `
      + (drift >= 0.5 ? 'That is past the bit boundary: the last samples land in the neighbouring bit, giving wrong data or framing errors.'
        : drift >= 0.3 ? 'It still decodes in this ideal model, but real edges are slow and noisy and there is little margin left.'
          : 'Comfortable. Rule of thumb: keep each side within about ±2 % (some allow up to ±3 %) so the total mismatch stays well under the roughly 5 % where an ideal 8N1 link breaks.');
    drawWiring();
    drawFrame();
  }

  // Re-run the last exchange so the slider's effect is visible without retyping.
  function demo() {
    const bytes = st.last.tx ? st.last.tx.bytes : str('U');
    const r = link(bytes, st.term, devActual());
    st.last.tx = { ...r, bytes, tx: st.term, rx: devActual() };
    show('tx'); drawFrame();
  }

  refresh();
  demo();
  say('Not connected. Press Connect, then type. The frame shown below is a sample byte, 0x55 (\'U\').');
  onResize(wave.wrap, drawFrame);
}
