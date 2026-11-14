// Packet structure and integrity checks: build a frame, corrupt it, watch a CRC-8 shift register, and run a
// byte-at-a-time receiver over it. Pure logic is exported for tests/logic.test.mjs.
import { h, clear, append } from '../core/dom.js';
import { CHECKS, checkBytes, sum8, xor8, crc8, crc8Steps, CRC8_POLY } from '../sim/crc.js';

export const SOF = 0x7E;
export const ESC = 0x7D;
export const BUF_SIZE = 16;
const put = (node, ...kids) => append(node, kids);
const hx = (b) => (b & 0xFF).toString(16).toUpperCase().padStart(2, '0');
const hxs = (a) => a.map(hx).join(' ');

/** HDLC-style byte stuffing of everything after the SOF: 0x7E -> 7D 5E, 0x7D -> 7D 5D. */
export function stuff(bytes) {
  const out = [];
  for (const b of bytes) { if (b === SOF || b === ESC) out.push(ESC, b ^ 0x20); else out.push(b); }
  return out;
}
export function unstuff(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i++) out.push(bytes[i] === ESC && i + 1 < bytes.length ? bytes[++i] ^ 0x20 : bytes[i]);
  return out;
}

/**
 * Build a frame [SOF][LEN][TYPE][SEQ][PAYLOAD...][CHECK]. The check covers LEN..end of payload.
 * `len` overrides the LEN field (a lying length); `checkValue` overrides the check bytes.
 * Returns { content, check, cells } where cells are the wire bytes: { v, field, esc }.
 */
export function buildFrame({ type = 1, seq = 0, payload = [], check = 'crc8', len = null, stuffing = false, checkValue = null } = {}) {
  const lenByte = (len == null ? payload.length : len) & 0xFF;
  const content = [lenByte, type & 0xFF, seq & 0xFF, ...payload.map((b) => b & 0xFF)];
  const chk = checkValue || checkBytes(check, content);
  const cells = [{ v: SOF, field: 'sof' }];
  const put = (v, field) => {
    if (stuffing && (v === SOF || v === ESC)) cells.push({ v: ESC, field, esc: true }, { v: v ^ 0x20, field, esc: true });
    else cells.push({ v, field });
  };
  put(content[0], 'len'); put(content[1], 'type'); put(content[2], 'seq');
  for (let i = 3; i < content.length; i++) put(content[i], 'payload');
  for (const c of chk) put(c, 'check');
  return { content, check: chk, cells, wire: cells.map((c) => c.v) };
}

/**
 * The receiver as firmware would write it: one byte at a time through a state machine.
 * HUNT -> LEN -> TYPE -> SEQ -> BODY -> CHECK. Payload bytes are copied into a fixed buffer as they arrive.
 * Without `boundsCheck` the receiver trusts LEN, so bytes beyond `bufSize` land in `overflow`.
 */
export function receive(stream, opts = {}) {
  const { check = 'crc8', stuffing = false, bufSize = BUF_SIZE, boundsCheck = false, start = 0 } = opts;
  const size = CHECKS[check].size;
  const trace = [], frames = [], overflow = [];
  const buf = new Array(bufSize).fill(null);
  let state = 'HUNT', len = 0, type = 0, seq = 0, body = [], chk = [], esc = false;
  const reset = () => { len = 0; type = 0; seq = 0; body = []; chk = []; esc = false; };
  const finish = (i) => {
    const want = checkBytes(check, [len, type, seq, ...body]);
    const ok = want.every((b, k) => b === chk[k]);
    frames.push({ ok, len, type, seq, payload: body.slice(), got: chk.slice(), want, end: i, reason: ok ? '' : 'check mismatch' });
    state = 'HUNT';
    return ok ? (size ? 'check matches: frame accepted' : 'no check configured: frame accepted as it is') : `check mismatch (computed ${hxs(want)}): frame dropped`;
  };
  for (let i = 0; i < stream.length; i++) {
    const b = stream[i] & 0xFF;
    if (i < start) { trace.push({ i, byte: b, state: '', next: '', note: 'not seen: the receiver was not listening yet', skipped: true }); continue; }
    const st = state;
    let v = b, note = '';
    if (stuffing) {
      if (b === SOF) {
        if (state !== 'HUNT') { frames.push({ ok: false, reason: 'cut short by a new SOF', len, type, seq, payload: body.slice(), end: i }); note = 'SOF inside a frame: abandon it and start a new one'; } else note = 'start of frame';
        reset(); state = 'LEN';
        trace.push({ i, byte: b, state: st, next: state, note });
        continue;
      }
      if (state !== 'HUNT') {
        if (esc) { v = b ^ 0x20; esc = false; note = `escaped: data byte is ${hx(v)}. `; }
        else if (b === ESC) { esc = true; trace.push({ i, byte: b, state: st, next: st, note: 'escape marker: the next byte is data XOR 0x20' }); continue; }
      }
    }
    switch (state) {
      case 'HUNT':
        if (v === SOF) { reset(); state = 'LEN'; note += 'start of frame'; } else note += 'not SOF: discarded';
        break;
      case 'LEN':
        len = v;
        if (boundsCheck && len > bufSize) { frames.push({ ok: false, reason: `LEN ${len} exceeds the ${bufSize}-byte buffer`, len, end: i }); state = 'HUNT'; note += `LEN = ${len} > ${bufSize}: rejected before anything is copied`; }
        else { state = 'TYPE'; note += `LEN = ${len}` + (len > bufSize ? ` (larger than the ${bufSize}-byte buffer, and nobody checks)` : ''); }
        break;
      case 'TYPE': type = v; state = 'SEQ'; note += `TYPE = ${hx(v)}`; break;
      case 'SEQ':
        seq = v; note += `SEQ = ${hx(v)}`;
        if (len > 0) state = 'BODY'; else if (size) state = 'CHECK'; else note += '; ' + finish(i);
        break;
      case 'BODY': {
        const n = body.length;
        if (n < bufSize) { buf[n] = v; note += `buf[${n}] = ${hx(v)}`; }
        else { overflow.push({ offset: n, value: v }); note += `buf[${n}] = ${hx(v)}: WRITE PAST THE END of buf[${bufSize}]`; }
        body.push(v);
        if (body.length >= len) { if (size) state = 'CHECK'; else note += '; ' + finish(i); }
        break;
      }
      case 'CHECK':
        chk.push(v);
        note += chk.length < size ? 'check byte 1 of 2' : finish(i);
        break;
    }
    trace.push({ i, byte: b, state: st, next: state, note, bad: /PAST|dropped|rejected/.test(note) });
  }
  let pending = null;
  if (state !== 'HUNT') {
    const missing = state === 'BODY' ? len - body.length + size : state === 'CHECK' ? size - chk.length : null;
    pending = { state, missing, len, got: body.length };
  }
  return { trace, frames, overflow, buf, state, pending };
}

// ---- corruption tools (all return a new array) ----
export function flipBit(bytes, index, bit) { const o = bytes.slice(); o[index] ^= 1 << bit; return o; }
export function swapBytes(bytes, i, j) { const o = bytes.slice(); [o[i], o[j]] = [o[j], o[i]]; return o; }
/** Burst error: invert `length` consecutive bits starting at bit `startBit` (bit 0 = MSB of byte 0, as sent on a wire MSB-first). */
export function burst(bytes, startBit, length) {
  const o = bytes.slice();
  for (let k = startBit; k < startBit + length && k < o.length * 8; k++) o[k >> 3] ^= 0x80 >> (k & 7);
  return o;
}
/** For each check: value over the sent bytes, over the received bytes, and whether the difference is noticed. */
export function detection(sent, received) {
  const changed = sent.length !== received.length || sent.some((b, i) => b !== received[i]);
  const out = {};
  for (const k of ['sum', 'xor', 'crc8', 'crc16']) {
    const a = CHECKS[k].fn(sent), b = CHECKS[k].fn(received);
    out[k] = { sent: a, received: b, detected: a !== b, changed };
  }
  return out;
}

// ---- challenges ----
const FIX = { type: 0x01, seq: 0x2A, payload: [0x4F, 0x4B] };
FIX.content = [FIX.payload.length, FIX.type, FIX.seq, ...FIX.payload];
FIX.wrong = crc8(FIX.content) ^ 0x5A;

export const FIX_OPTIONS = [
  { id: 'bounds', right: true, text: 'Compare LEN with sizeof(buf) as soon as it arrives and drop the frame if it is larger',
    fb: 'Yes. The length is checked before a single payload byte is copied, so no value of LEN can move the write pointer outside the buffer. Re-run the receiver: the frame is rejected in the LEN state.' },
  { id: 'crc16', text: 'Replace the CRC-8 with a CRC-16 so that bad frames are rejected',
    fb: 'No. Your overflowing frame can carry a perfectly valid CRC of any width, because whoever builds the frame computes it. And look at the trace: the bytes are written to memory before the check is even reached.' },
  { id: 'verify-first', text: 'Only use the payload after the check has been verified',
    fb: 'Not enough. The trace shows the out-of-bounds writes happening in the BODY state, as each byte arrives. By the time the check is evaluated the neighbouring memory is already overwritten.' },
  { id: 'bigger', text: 'Make the buffer 64 bytes',
    fb: 'No. LEN is one byte, so it can claim up to 255. A 64-byte buffer only moves the point where the overflow starts; a frame with LEN = 65 still writes past it.' },
  { id: 'stuffing', text: 'Turn on byte stuffing',
    fb: 'No. Stuffing fixes framing (where a frame starts). It does nothing about a LEN field that claims more bytes than the buffer holds.' },
];

export const CHALLENGES = {
  'fix-crc': { title: 'Repair a frame with a wrong CRC-8', frame: FIX },
  'find-length-bug': { title: 'Make a receiver that trusts LEN write past its buffer, then fix it' },
};

/** Judge an answer to `fix-crc`. Returns { ok, msg }. */
export function checkFixCrc(text) {
  const t = String(text).trim().replace(/^0x/i, '');
  if (!/^[0-9a-f]{1,2}$/i.test(t)) return { ok: false, msg: 'Enter one byte in hex, for example 3C.' };
  const v = parseInt(t, 16), c = FIX.content, shown = hxs(c);
  if (v === crc8(c)) return { ok: true, msg: `Correct. CRC-8 over ${shown} is ${hx(v)}; a receiver that recomputes it now gets a match and accepts the frame.` };
  if (v === FIX.wrong) return { ok: false, msg: 'That is the value already in the frame, the one the receiver rejects.' };
  if (v === sum8(c)) return { ok: false, msg: `${hx(v)} is the additive checksum of ${shown}. This receiver runs the CRC-8 shift register, gets a different value and drops the frame.` };
  if (v === xor8(c)) return { ok: false, msg: `${hx(v)} is the XOR of the bytes. This receiver runs the CRC-8 shift register, gets a different value and drops the frame.` };
  if (v === crc8([SOF, ...c])) return { ok: false, msg: 'You included the SOF byte. In this frame format the CRC covers LEN through the last payload byte; the receiver starts its register after SOF and will not match.' };
  if (v === crc8(FIX.payload)) return { ok: false, msg: 'You covered only the payload. LEN, TYPE and SEQ are covered too, otherwise a corrupted length or sequence number would go unnoticed.' };
  if (v === crc8(c, 0xFF)) return { ok: false, msg: 'That is the result with the register starting at 0xFF. This CRC-8 starts at 0x00, so the receiver computes something else.' };
  return { ok: false, msg: `A receiver computing CRC-8 over ${shown} does not get ${hx(v)}, so it would drop the frame. Step the shift register below through all ${c.length} bytes: the answer is the register after the last shift.` };
}

export function parsePayload(text, mode) {
  if (mode === 'ascii') return { bytes: [...text].map((ch) => ch.charCodeAt(0) & 0xFF).slice(0, 40) };
  const t = text.replace(/0x/gi, '').replace(/[\s,]/g, '');
  if (!/^[0-9a-f]*$/i.test(t)) return { bytes: [], error: 'Hex mode accepts only 0-9 and A-F (spaces are ignored).' };
  if (t.length % 2) return { bytes: [], error: 'Hex mode needs two digits per byte.' };
  const bytes = [];
  for (let i = 0; i < t.length && bytes.length < 40; i += 2) bytes.push(parseInt(t.substr(i, 2), 16));
  return { bytes };
}

const FIELD_NAMES = { sof: 'SOF', len: 'LEN', type: 'TYPE', seq: 'SEQ', payload: 'PAYLOAD', check: 'CHECK' };

export default function mount(el, props = {}, ctx = {}) {
  const challenge = CHALLENGES[props.challenge] ? props.challenge : null;
  const st = {
    type: 0x01, seq: 0x05, payload: [0x48, 0x65, 0x6C, 0x6C, 0x6F], mode: 'ascii', check: challenge === 'find-length-bug' ? 'crc8' : 'crc8',
    lenAuto: true, len: 5, stuffing: false, tab: challenge === 'fix-crc' ? 'crc' : challenge === 'find-length-bug' ? 'rx' : 'corrupt',
    rx: null, forged: false, sel: 0, corruptNote: '', step: 0, midStart: false, boundsCheck: false,
    overflowed: false, solved: false, fixMsg: null, fixCrcMsg: null, payloadError: '',
  };
  if (challenge === 'fix-crc') Object.assign(st, { type: FIX.type, seq: FIX.seq, payload: FIX.payload.slice(), check: 'crc8' });
  clear(el); el.classList.add('packet-explorer');

  const content = () => [(st.lenAuto ? st.payload.length : st.len) & 0xFF, st.type, st.seq, ...st.payload];
  const frame = () => buildFrame({ type: st.type, seq: st.seq, payload: st.payload, check: st.check, len: st.lenAuto ? null : st.len, stuffing: st.stuffing,
    checkValue: challenge === 'fix-crc' && !st.solved ? [FIX.wrong] : null });
  const changed = () => { st.rx = null; st.forged = false; st.corruptNote = ''; st.step = 0; st.sel = 0; draw(); };

  // ---- static parts ----
  const task = h('div', { class: 'w-task' });
  if (challenge === 'fix-crc') task.append(h('p', {}, h('strong', {}, 'Task. '), 'This frame was logged from a link that uses CRC-8 (polynomial 0x07, register starts at 0x00) over LEN, TYPE, SEQ and the payload. The receiver rejects it: the last byte is wrong. Work out the CRC the sender should have appended and enter it.'));
  if (challenge === 'find-length-bug') task.append(h('p', {}, h('strong', {}, 'Task. '), `The receiver below copies each payload byte into `, h('code', {}, `uint8_t buf[${BUF_SIZE}]`), ` and uses LEN to decide when to stop. Build a frame that makes it write past the end of that buffer. Then choose the change to the receiver that closes the hole.`));

  const strip = h('div', { class: 'pk-strip', role: 'group', 'aria-label': 'Frame as sent on the wire' });
  const stripInfo = h('div', { class: 'w-note pk-info' });

  // builder controls (created once so typing keeps focus)
  const payloadIn = h('input', { type: 'text', class: 'mono', value: 'Hello', 'aria-label': 'Payload', spellcheck: 'false', oninput: () => readPayload() });
  const modeSel = h('select', { 'aria-label': 'Payload input mode', onchange: () => {
    st.mode = modeSel.value;
    payloadIn.value = st.mode === 'hex' ? hxs(st.payload) : st.payload.map((b) => (b >= 0x20 && b < 0x7F ? String.fromCharCode(b) : '.')).join('');
    readPayload();
  } }, h('option', { value: 'ascii' }, 'ASCII'), h('option', { value: 'hex' }, 'Hex'));
  const payloadErr = h('div', { class: 'w-msg bad', hidden: true });
  function readPayload() {
    const r = parsePayload(payloadIn.value, st.mode);
    st.payloadError = r.error || '';
    payloadErr.hidden = !r.error; payloadErr.textContent = r.error || '';
    if (!r.error) { st.payload = r.bytes; changed(); }
  }
  const byteIn = (key, label) => h('input', { type: 'text', class: 'mono pk-byte', value: hx(st[key]), maxlength: 2, 'aria-label': label + ' (hex)', oninput: (e) => {
    if (/^[0-9a-f]{1,2}$/i.test(e.target.value)) { st[key] = parseInt(e.target.value, 16); changed(); }
  } });
  const checkSel = h('select', { 'aria-label': 'Integrity check', onchange: () => { st.check = checkSel.value; changed(); } },
    Object.entries(CHECKS).map(([k, c]) => h('option', { value: k, selected: k === st.check }, c.title)));
  const lenIn = h('input', { type: 'number', min: 0, max: 255, value: st.len, disabled: true, class: 'pk-num', 'aria-label': 'LEN field value', oninput: () => { st.len = Math.max(0, Math.min(255, +lenIn.value || 0)); changed(); } });
  const lenAuto = h('input', { type: 'checkbox', checked: true, onchange: () => { st.lenAuto = lenAuto.checked; lenIn.disabled = st.lenAuto; if (!st.lenAuto) { st.len = st.payload.length; lenIn.value = st.len; } changed(); } });
  const stuffIn = h('input', { type: 'checkbox', onchange: () => { st.stuffing = stuffIn.checked; changed(); } });
  const builder = h('div', { class: 'w-controls pk-builder' },
    h('label', { class: 'w-field' }, 'Payload', payloadIn, modeSel), payloadErr,
    h('div', { class: 'row' },
      h('label', {}, 'TYPE ', byteIn('type', 'TYPE')), h('label', {}, 'SEQ ', byteIn('seq', 'SEQ')),
      h('label', {}, 'Check ', checkSel)),
    h('div', { class: 'row' },
      h('label', {}, lenAuto, ' LEN = payload length'), h('label', {}, 'LEN ', lenIn),
      h('label', {}, stuffIn, ' Byte stuffing')));

  const tabs = h('div', { class: 'w-tabs', role: 'tablist' });
  const body = h('div', { class: 'pk-body' });
  const TABS = challenge === 'fix-crc' ? [['crc', 'CRC-8 step by step']] : [['corrupt', 'Corrupt it'], ['crc', 'CRC-8 step by step'], ['rx', 'Receiver']];

  el.append(...(challenge ? [task] : []), strip, stripInfo, ...(challenge === 'fix-crc' ? [] : [builder]), tabs, body,
    h('p', { class: 'w-note' }, h('strong', {}, 'What a CRC is for. '), 'A checksum or CRC detects accidental corruption: noise, a dropped byte, a bad connector. It gives no protection against deliberate modification, because it has no secret in it: anyone who changes the bytes can recompute the CRC and the receiver will accept the result. Stopping that needs a keyed check, a MAC (HMAC, CMAC) or a digital signature; see the hashes, MACs and signatures tool.'),
    h('p', { class: 'w-note' }, 'Model: a made-up teaching frame format, not a standard protocol. The receiver is byte-level; bit timing, timeouts and retransmission are not simulated.'));

  // ---- drawing ----
  function draw() {
    const keep = document.activeElement && el.contains(document.activeElement) ? document.activeElement.dataset.k : null;
    const f = frame();
    clear(strip);
    let group = null, last = null;
    f.cells.forEach((c) => {
      if (c.field !== last) { group = h('div', { class: 'pk-group pk-' + c.field }, h('span', { class: 'pk-lbl' }, FIELD_NAMES[c.field])); strip.append(group); last = c.field; }
      const wrongCrc = challenge === 'fix-crc' && !st.solved && c.field === 'check';
      group.append(h('span', { class: 'pk-cell' + (c.esc ? ' esc' : '') + (wrongCrc ? ' wrong' : ''), title: FIELD_NAMES[c.field] + (c.esc ? ' (escape sequence)' : '') }, hx(c.v)));
    });
    clear(stripInfo);
    const lenByte = f.content[0];
    const bits = [`${f.wire.length} bytes on the wire`];
    if (st.check !== 'none') bits.push(`${CHECKS[st.check].title} over ${f.content.length} bytes (LEN to end of payload)` + (challenge === 'fix-crc' && !st.solved ? '' : ` = ${hxs(checkBytes(st.check, f.content))}`));
    else bits.push('no integrity check: the receiver cannot tell a damaged frame from a good one');
    if (lenByte !== st.payload.length) bits.push(`LEN claims ${lenByte} but the payload is ${st.payload.length} bytes`);
    if (st.stuffing && f.cells.some((c) => c.esc)) bits.push('dashed cells are escape pairs (7D, then the byte XOR 0x20)');
    stripInfo.textContent = bits.join(' · ') + '.';

    clear(tabs);
    if (TABS.length > 1) for (const [id, label] of TABS) tabs.append(h('button', { type: 'button', role: 'tab', 'aria-selected': String(st.tab === id), class: 'w-tab' + (st.tab === id ? ' on' : ''), 'data-k': 'tab-' + id, onclick: () => { st.tab = id; draw(); } }, label));
    clear(body);
    if (st.tab === 'corrupt') drawCorrupt(f); else if (st.tab === 'crc') drawCrc(f); else drawRx(f);
    if (keep) { const again = el.querySelector(`[data-k="${keep}"]`); if (again) again.focus(); }
  }

  function drawCorrupt(f) {
    const sent = f.content, rx = st.rx || sent.slice();
    const names = sent.map((_, i) => (i === 0 ? 'LEN' : i === 1 ? 'TYPE' : i === 2 ? 'SEQ' : `P${i - 3}`));
    const apply = (next, note, forged = false) => { st.rx = next; st.corruptNote = note; st.forged = forged; draw(); };
    if (st.sel >= rx.length) st.sel = 0;
    const row = h('div', { class: 'pk-rx', role: 'group', 'aria-label': 'Received bytes; choose one to flip its bits' },
      rx.map((b, i) => h('button', { type: 'button', class: 'pk-cell pk-pick' + (i === st.sel ? ' sel' : '') + (b !== sent[i] ? ' diff' : ''), 'data-k': 'b' + i, 'aria-pressed': String(i === st.sel), title: names[i], onclick: () => { st.sel = i; draw(); } },
        h('small', {}, names[i]), hx(b))));
    const bitsRow = h('div', { class: 'w-bits', role: 'group', 'aria-label': `Bits of ${names[st.sel]}, most significant first` },
      [7, 6, 5, 4, 3, 2, 1, 0].map((bit) => h('button', { type: 'button', class: 'w-bit' + ((rx[st.sel] >> bit) & 1 ? ' on' : ''), 'data-k': 'bit' + bit, title: `Flip bit ${bit}`, 'aria-label': `bit ${bit} is ${(rx[st.sel] >> bit) & 1}, flip`,
        onclick: () => apply(flipBit(rx, st.sel, bit), `Flipped bit ${bit} of ${names[st.sel]}.`) }, (rx[st.sel] >> bit) & 1)));
    const opt = (sel) => names.map((n, i) => h('option', { value: i, selected: i === sel }, n));
    const sa = h('select', { 'aria-label': 'First byte to swap' }, opt(Math.min(3, rx.length - 1)));
    const sb = h('select', { 'aria-label': 'Second byte to swap' }, opt(Math.min(4, rx.length - 1)));
    const bs = h('input', { type: 'number', class: 'pk-num', min: 0, max: rx.length * 8 - 1, value: 28, 'aria-label': 'Burst start bit' });
    const bl = h('input', { type: 'number', class: 'pk-num', min: 1, max: 32, value: 6, 'aria-label': 'Burst length in bits' });
    const pay = rx.length - 3;
    const presets = [
      ['Swap two payload bytes', pay >= 2 && rx[3] !== rx[4], () => apply(swapBytes(rx, 3, 4), 'Swapped P0 and P1. Addition and XOR do not care about order, so neither notices.')],
      ['Compensating errors (+1, -1)', pay >= 2, () => { const o = rx.slice(); o[3] = (o[3] + 1) & 0xFF; o[4] = (o[4] - 1) & 0xFF; apply(o, 'P0 went up by one and P1 down by one. The sum is unchanged, so the additive checksum is blind to it.'); }],
      ['Same bit flipped in two bytes', pay >= 2, () => apply(flipBit(flipBit(rx, 3, 5), 4, 5), 'Bit 5 flipped in both P0 and P1. Each bit column still has the same parity, so XOR is blind to it.')],
      ['Deliberate edit, check recomputed', pay >= 1, () => { const o = rx.slice(); o[3] ^= 0x01; apply(o, 'An attacker changed P0 and then recomputed the check for the new bytes. Nothing accidental happened here, and nothing can be detected.', true); }],
    ];
    const det = detection(sent, rx);
    const table = h('table', { class: 'pk-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Check'), h('th', {}, 'Sent with frame'), h('th', {}, 'Receiver computes'), h('th', {}, 'Result'))),
      h('tbody', {}, ['sum', 'xor', 'crc8', 'crc16'].map((k) => {
        const d = det[k], w = k === 'crc16' ? 4 : 2, fmt = (v) => v.toString(16).toUpperCase().padStart(w, '0');
        const sentShown = st.forged ? d.received : d.sent;
        const verdict = !d.changed ? h('span', { class: 'muted' }, 'nothing changed')
          : st.forged ? h('strong', { class: 'pk-miss' }, 'accepted: matches the forged check')
            : d.detected ? h('strong', { class: 'pk-hit' }, 'detected') : h('strong', { class: 'pk-miss' }, 'MISSED: frame accepted with wrong data');
        return h('tr', { class: k === st.check ? 'cur' : '' }, h('th', {}, CHECKS[k].title + (k === st.check ? ' (in use)' : '')), h('td', { class: 'w-mono' }, fmt(sentShown)), h('td', { class: 'w-mono' }, fmt(d.received)), h('td', {}, verdict));
      })));
    put(body, 
      h('p', {}, 'These are the bytes the check covers, as they arrive at the receiver. Damage them, then read the table: each row is a different check carried by the same frame.'),
      row,
      h('div', { class: 'row' }, h('span', {}, `Bits of ${names[st.sel]}:`), bitsRow),
      h('div', { class: 'row' }, 'Swap', sa, 'with', sb, h('button', { type: 'button', class: 'btn small ghost', 'data-k': 'swap', onclick: () => apply(swapBytes(rx, +sa.value, +sb.value), `Swapped ${names[+sa.value]} and ${names[+sb.value]}.`) }, 'Swap')),
      h('div', { class: 'row' }, 'Burst: invert', bl, 'bits from bit', bs, h('button', { type: 'button', class: 'btn small ghost', 'data-k': 'burst', onclick: () => apply(burst(rx, Math.max(0, +bs.value || 0), Math.max(1, Math.min(32, +bl.value || 1))), `Inverted ${bl.value} consecutive bits starting at bit ${bs.value} (bit 0 is the first bit of LEN).`) }, 'Apply')),
      h('div', { class: 'row' }, presets.map(([label, ok, fn], i) => h('button', { type: 'button', class: 'btn small ghost', disabled: !ok, 'data-k': 'pre' + i, onclick: fn }, label)),
        h('button', { type: 'button', class: 'btn small', 'data-k': 'reset', onclick: () => apply(null, '') }, 'Undo all damage')),
      st.corruptNote ? h('div', { class: 'w-msg' + (st.forged ? ' warn' : ''), role: 'status' }, st.corruptNote) : null,
      h('div', { class: 'table-wrap' }, table),
      h('p', { class: 'w-note' }, 'An n-bit CRC detects every single-bit error and every burst no longer than n bits. Longer or unluckier damage slips through with probability about 1 in 2ⁿ: 1 in 256 for CRC-8, 1 in 65 536 for CRC-16. Try a burst of 9 bits or more and vary the start to hunt for a CRC-8 miss.'));
  }

  function drawCrc(f) {
    const data = f.content, steps = crc8Steps(data);
    st.step = Math.max(0, Math.min(steps.length, st.step));
    const cur = st.step > 0 ? steps[st.step - 1] : null, next = steps[st.step] || null;
    const reg = cur ? cur.after : 0;
    const go = (n) => { st.step = n; draw(); };
    const nextByte = () => { let n = st.step + 1; while (n < steps.length && steps[n].phase !== 'load') n++; go(n); };
    const active = cur ? cur.byteIndex : -1;
    const names = data.map((_, i) => (i === 0 ? 'LEN' : i === 1 ? 'TYPE' : i === 2 ? 'SEQ' : `P${i - 3}`));
    let explain;
    if (!cur) explain = 'The register starts at 00. Each step below is one line of the bitwise algorithm.';
    else if (cur.phase === 'load') explain = `Load ${names[cur.byteIndex]} = ${hx(cur.byte)}: register ${hx(cur.before)} XOR ${hx(cur.byte)} = ${hx(cur.after)}. Eight shifts follow.`;
    else explain = `Shift ${cur.bit + 1} of 8 for ${names[cur.byteIndex]}: the top bit that falls out is ${cur.msb}. ` + (cur.xored ? `It is 1, so the shifted value ${hx(cur.shifted)} is XORed with the polynomial 07, giving ${hx(cur.after)}.` : `It is 0, so the register is just the shifted value ${hx(cur.after)}.`);
    const done = st.step === steps.length;
    put(body, 
      h('p', {}, 'CRC-8 is long division of the message by the polynomial x⁸ + x² + x + 1 (written 0x07), keeping only the remainder. In hardware it is an 8-bit shift register with XOR gates at the taps; in C it is the loop on the right.'),
      h('div', { class: 'w-grid' },
        h('div', {},
          h('div', { class: 'pk-rx' }, data.map((b, i) => h('span', { class: 'pk-cell' + (i === active ? ' sel' : '') + (i < active || done ? ' used' : '') }, h('small', {}, names[i]), hx(b)))),
          h('div', { class: 'pk-reg', 'aria-label': 'Shift register' },
            h('span', { class: 'pk-out' + (cur && cur.phase === 'shift' && cur.msb ? ' on' : ''), title: 'Bit shifted out of the top' }, cur && cur.phase === 'shift' ? cur.msb : '·'), h('span', { class: 'pk-arrow', 'aria-hidden': 'true' }, '←'),
            h('div', { class: 'w-bits' }, [7, 6, 5, 4, 3, 2, 1, 0].map((bit) => h('span', { class: 'w-bit' + ((reg >> bit) & 1 ? ' on' : '') + ((CRC8_POLY >> bit) & 1 ? ' tap' : ''), title: (CRC8_POLY >> bit) & 1 ? 'polynomial tap' : '' }, (reg >> bit) & 1))),
            h('span', { class: 'pk-arrow', 'aria-hidden': 'true' }, '← 0')),
          h('div', { class: 'w-readout' },
            h('div', {}, h('div', { class: 'k' }, 'Register'), h('div', { class: 'v' }, hx(reg))),
            h('div', {}, h('div', { class: 'k' }, 'Step'), h('div', { class: 'v' }, `${st.step} / ${steps.length}`)),
            h('div', {}, h('div', { class: 'k' }, 'Next'), h('div', { class: 'v' }, next ? (next.phase === 'load' ? 'load ' + names[next.byteIndex] : 'shift') : 'done'))),
          h('div', { class: 'row' },
            h('button', { type: 'button', class: 'btn small ghost', 'data-k': 'c-reset', onclick: () => go(0) }, 'Reset'),
            h('button', { type: 'button', class: 'btn small ghost', 'data-k': 'c-back', disabled: st.step === 0, onclick: () => go(st.step - 1) }, 'Back'),
            h('button', { type: 'button', class: 'btn small', 'data-k': 'c-step', disabled: done, onclick: () => go(st.step + 1) }, 'Step'),
            h('button', { type: 'button', class: 'btn small ghost', 'data-k': 'c-byte', disabled: done, onclick: nextByte }, 'Finish byte'),
            challenge === 'fix-crc' && !st.solved ? null : h('button', { type: 'button', class: 'btn small ghost', 'data-k': 'c-end', disabled: done, onclick: () => go(steps.length) }, 'Run to end'))),
        h('div', {},
          h('pre', { class: 'code pk-code' }, 'uint8_t crc = 0x00;\nfor (i = 0; i < n; i++) {\n    crc ^= data[i];              /* load */\n    for (b = 0; b < 8; b++) {    /* shift */\n        if (crc & 0x80) crc = (crc << 1) ^ 0x07;\n        else            crc =  crc << 1;\n    }\n}'),
          h('div', { class: 'w-msg', role: 'status' }, explain + (done ? ` All ${data.length} bytes are in: the register now holds the CRC.` : '')))),
      h('p', { class: 'w-note' }, 'Outlined register bits are where the polynomial 0x07 is XORed in. Real firmware usually uses a 256-entry lookup table or a hardware CRC unit; both give exactly the same value as this loop.'));
    if (challenge === 'fix-crc') {
      const ans = h('input', { type: 'text', class: 'mono pk-byte', maxlength: 4, 'aria-label': 'Correct CRC-8, hex', 'data-k': 'fix-in', value: st.fixAnswer || '', oninput: (e) => { st.fixAnswer = e.target.value; }, onkeydown: (e) => { if (e.key === 'Enter') submit(); } });
      const submit = () => {
        const r = checkFixCrc(st.fixAnswer || '');
        st.fixCrcMsg = r;
        if (r.ok) { st.solved = true; ctx.complete?.(); }
        draw();
      };
      put(body, h('div', { class: 'row' }, h('label', {}, 'Correct CRC-8: 0x', ans), h('button', { type: 'button', class: 'btn small', 'data-k': 'fix-go', onclick: submit }, 'Check')),
        st.fixCrcMsg ? h('div', { class: 'w-msg ' + (st.fixCrcMsg.ok ? 'ok' : 'bad'), role: 'status' }, st.fixCrcMsg.msg) : null);
    }
  }

  function drawRx(f) {
    // the frame as it arrives (including any damage from the Corrupt tab), followed by the sender's next frame
    let first = f;
    if (st.rx) {
      const c = st.rx;
      first = buildFrame({ type: c[1], seq: c[2], payload: c.slice(3), len: c[0], check: st.check, stuffing: st.stuffing, checkValue: st.forged ? null : f.check });
    }
    const second = buildFrame({ type: 0x02, seq: (st.seq + 1) & 0xFF, payload: [0x6F, 0x6B], check: st.check, stuffing: st.stuffing });
    const stream = [...first.wire, ...second.wire];
    const start = st.midStart ? Math.min(4, first.wire.length - 1) : 0;
    const r = receive(stream, { check: st.check, stuffing: st.stuffing, boundsCheck: st.boundsCheck, start });
    if (challenge === 'find-length-bug' && r.overflow.length && !st.boundsCheck) st.overflowed = true;

    const good = r.frames.filter((x) => x.ok).length, bad = r.frames.length - good;
    const msgs = [];
    if (r.overflow.length) msgs.push(['bad', `${r.overflow.length} byte${r.overflow.length > 1 ? 's' : ''} written past the end of buf[${BUF_SIZE}]. On a real MCU those bytes land on whatever sits next in memory: other variables, or on the stack a saved return address. This is a remotely triggered buffer overflow, and a valid check does not prevent it.`]);
    if (r.pending) msgs.push(['warn', `The stream ended with the receiver still in ${r.pending.state}` + (r.pending.missing != null ? `, waiting for ${r.pending.missing} more byte${r.pending.missing === 1 ? '' : 's'}` : '') + '. It has swallowed everything after the bad length, including the next frame, and without a timeout it stays stuck until enough bytes happen to arrive.']);
    if (st.midStart && !st.stuffing && st.payload.includes(SOF)) msgs.push(['warn', 'The receiver joined mid-frame and took the 7E in the payload for a start of frame. Everything it parsed after that is misaligned. With byte stuffing, 7E can only ever mean SOF.']);
    if (st.midStart && st.stuffing) msgs.push(['', 'With stuffing a raw 7E never occurs inside a frame, so a receiver that joins late discards bytes until the next real SOF and is back in step.']);
    msgs.push([bad || r.overflow.length ? '' : 'ok', `Stream of two frames (yours, then the sender's next one): ${good} accepted, ${bad} dropped.` + (r.frames.some((x) => !x.ok) ? ' Reasons: ' + r.frames.filter((x) => !x.ok).map((x) => x.reason).join('; ') + '.' : '')]);

    const mid = h('input', { type: 'checkbox', checked: st.midStart, 'data-k': 'mid', onchange: (e) => { st.midStart = e.target.checked; draw(); } });
    const bc = h('input', { type: 'checkbox', checked: st.boundsCheck, 'data-k': 'bc', disabled: challenge === 'find-length-bug' && !st.solved, onchange: (e) => { st.boundsCheck = e.target.checked; draw(); } });
    const mem = h('div', { class: 'pk-mem', 'aria-label': 'Receive buffer and the memory after it' },
      r.buf.map((b, i) => h('span', { class: 'pk-cell' + (b == null ? ' empty' : ''), title: `buf[${i}]` }, h('small', {}, i), b == null ? '··' : hx(b))),
      Array.from({ length: 8 }, (_, i) => { const o = r.overflow.find((x) => x.offset === BUF_SIZE + i); return h('span', { class: 'pk-cell beyond' + (o ? ' hit' : ''), title: `not part of buf: offset ${BUF_SIZE + i}` }, h('small', {}, '+' + i), o ? hx(o.value) : '??'); }));
    const rows = r.trace.map((t) => h('tr', { class: (t.skipped ? 'skip' : '') + (t.bad ? ' bad' : '') + (t.i === first.wire.length ? ' split' : '') },
      h('td', {}, t.i), h('td', { class: 'w-mono' }, hx(t.byte)), h('td', {}, t.skipped ? '' : t.state + (t.next !== t.state ? ' → ' + t.next : '')), h('td', {}, t.note)));
    put(body, 
      h('p', {}, 'Firmware receives one byte at a time, usually in a UART interrupt, and has to find frame boundaries itself. This receiver hunts for SOF, reads LEN, TYPE and SEQ, copies LEN payload bytes into a fixed buffer, then compares the check.'),
      h('div', { class: 'row' }, h('label', {}, mid, ' Receiver starts listening mid-frame'), h('label', {}, bc, ` Reject LEN > ${BUF_SIZE}`)),
      h('div', { class: 'pk-memlbl' }, h('code', {}, `uint8_t buf[${BUF_SIZE}]`), ' followed by the next 8 bytes of memory (hatched, not ours):'), mem,
      msgs.map(([cls, text]) => h('div', { class: 'w-msg ' + cls, role: 'status' }, text)),
      h('div', { class: 'table-wrap pk-trace', tabindex: 0, 'aria-label': 'Receiver trace' }, h('table', { class: 'pk-table' },
        h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Byte'), h('th', {}, 'State'), h('th', {}, 'What the receiver does'))), h('tbody', {}, rows))),
      h('p', { class: 'w-note' }, 'Try a payload containing 7E (hex mode) with and without byte stuffing and a late-joining receiver; then untick "LEN = payload length" and make LEN lie in each direction.'));

    if (challenge === 'find-length-bug') {
      const box = h('div', { class: 'pk-fix' });
      if (!st.overflowed) {
        const lenByte = f.content[0];
        let hint = `No write past the buffer yet. The receiver stops copying after LEN bytes, and LEN is ${lenByte}.`;
        if (lenByte > BUF_SIZE && !r.overflow.length) hint = `LEN now claims ${lenByte}, which is more than the buffer holds, but only ${r.pending ? r.pending.got : 0} payload bytes have arrived so far, so nothing has spilled yet. The receiver copies bytes as they arrive: send more of them.`;
        else if (st.payload.length > BUF_SIZE && lenByte <= BUF_SIZE) hint = `Your payload is ${st.payload.length} bytes, but LEN says ${lenByte}, so the receiver stops copying at ${lenByte} and treats the rest as a check byte and line noise. What decides how many bytes it copies?`;
        put(box, h('div', { class: 'w-msg' }, hint));
      } else {
        put(box, h('p', {}, h('strong', {}, st.solved ? 'Fixed. ' : 'You overflowed the buffer. '), st.solved ? '' : 'Which change to the receiver closes this hole?'),
          h('div', { class: 'opts' }, FIX_OPTIONS.map((o) => h('button', { type: 'button', class: 'opt' + (st.fixPick === o.id ? (o.right ? ' right' : ' wrong') : ''), 'data-k': 'fx-' + o.id, disabled: st.solved, onclick: () => {
            st.fixPick = o.id; st.fixMsg = o;
            if (o.right) { st.solved = true; st.boundsCheck = true; ctx.complete?.(); }
            draw();
          } }, o.text))),
          st.fixMsg ? h('div', { class: 'w-msg ' + (st.fixMsg.right ? 'ok' : 'bad'), role: 'status' }, st.fixMsg.fb) : null);
      }
      put(body, box);
    }
  }

  draw();
}
