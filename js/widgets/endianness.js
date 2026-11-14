// Byte order: a 32-bit value in memory, a struct received from a wire, and htonl-style conversion, with quiz tasks.
import { h, clear, hex } from '../core/dom.js';

/** Bytes of a 32-bit value in increasing address order. order: 'le' | 'be'. */
export function toBytes(value, order = 'le', width = 4) {
  const out = [];
  for (let i = 0; i < width; i++) out.push((value >>> (8 * i)) & 0xFF);
  return order === 'le' ? out : out.reverse();
}
/** Value read from bytes given in increasing address order. */
export function fromBytes(bytes, order = 'le') {
  const b = order === 'le' ? bytes : [...bytes].reverse();
  let v = 0;
  for (let i = b.length - 1; i >= 0; i--) v = (v * 256) + (b[i] & 0xFF);
  return v >>> 0;
}
export const bswap32 = (v) => (((v & 0xFF) << 24) | ((v & 0xFF00) << 8) | ((v >>> 8) & 0xFF00) | (v >>> 24)) >>> 0;
export const bswap16 = (v) => (((v & 0xFF) << 8) | ((v >>> 8) & 0xFF)) & 0xFFFF;
/** htonl on a host of the given byte order: network order is big-endian. */
export const htonl = (v, host = 'le') => (host === 'le' ? bswap32(v) : v >>> 0);
export const ntohl = htonl;

const b2 = (n) => (n & 0xFF).toString(16).toUpperCase().padStart(2, '0');
/** Parse "78 56 34 12", "0x78,0x56" or "78563412" into bytes; null if malformed. */
export function parseBytes(text, count) {
  let t = String(text).trim().replace(/0x/gi, '').replace(/[,\s]+/g, ' ');
  let parts = t.includes(' ') ? t.split(' ') : (t.match(/.{1,2}/g) || []);
  if (parts.some((p) => !/^[0-9a-f]{1,2}$/i.test(p))) return null;
  if (count != null && parts.length !== count) return null;
  return parts.map((p) => parseInt(p, 16));
}
export function parseValue(text) {
  const t = String(text).trim().replace(/[uUlL]+$/, '');
  if (/^0x[0-9a-f]{1,8}$/i.test(t)) return parseInt(t.slice(2), 16) >>> 0;
  if (/^\d{1,10}$/.test(t) && +t <= 0xFFFFFFFF) return +t >>> 0;
  return null;
}

// Wire struct for the "struct over a wire" tab: big-endian on the wire, as most network protocols are.
export const WIRE = [0x02, 0x01, 0x2C, 0x00, 0x01, 0xE2, 0x40];
// uint8 type = 0x02; uint16 length = 0x012C (300); uint32 id = 0x0001E240 (123456)

export const CHALLENGES = {
  'store-le': {
    title: 'Bytes in memory, little-endian',
    prompt: 'A little-endian MCU executes `uint32_t x = 0x12345678;` and x is at address 0x20000010. Type the four bytes in memory, lowest address first.',
    kind: 'bytes', answer: toBytes(0x12345678, 'le'),
    explain: 'Little-endian puts the least significant byte at the lowest address: 78 56 34 12.',
    diagnose(b) { if (b.join() === toBytes(0x12345678, 'be').join()) return 'That is big-endian order: most significant byte first. A little-endian CPU stores the least significant byte (0x78) at the lowest address. A hex dump of this RAM would not show "12 34 56 78".'; return 'Split the value into bytes 12, 34, 56, 78 and decide which one sits at 0x20000010.'; },
  },
  'cast-read': {
    title: 'Casting received bytes',
    prompt: 'Four bytes arrive from the network in this order: `12 34 56 78`. They are stored in `uint8_t buf[4]` in arrival order. A little-endian MCU runs `uint32_t v = *(uint32_t *)buf;`. What is v? (hex)',
    kind: 'value', answer: 0x78563412,
    explain: 'The CPU treats buf[0] as the least significant byte, so v = 0x78563412. The sender meant 0x12345678: the cast silently reverses the value.',
    diagnose(v) { if (v === 0x12345678) return '0x12345678 is what the sender meant, and what a big-endian CPU would read. This CPU is little-endian: it takes buf[0] = 0x12 as the least significant byte. Firmware that makes this assumption works in the sender\'s unit tests and fails on the MCU.'; return 'Lowest address is buf[0] = 0x12. On a little-endian CPU the lowest address holds the least significant byte.'; },
  },
  htonl: {
    title: 'htonl on a little-endian host',
    prompt: 'On a little-endian MCU, `uint32_t n = htonl(0x0A0B0C0D);`. What numeric value does n hold? (hex)',
    kind: 'value', answer: 0x0D0C0B0A,
    explain: 'htonl swaps the bytes on a little-endian host, so n = 0x0D0C0B0A. In memory that is 0A 0B 0C 0D — big-endian order, ready to send as-is.',
    diagnose(v) { if (v === 0x0A0B0C0D) return 'Unchanged is what htonl returns on a big-endian host, where host order already equals network order. On a little-endian host it must swap, otherwise the bytes would leave as 0D 0C 0B 0A.'; return 'Network order is big-endian. Work out which bytes must be in memory for the wire to carry 0A 0B 0C 0D, then read those four bytes as a little-endian number.'; },
  },
  'wire-field': {
    title: 'Decode a field from a wire struct',
    prompt: 'A packet header is sent big-endian: `uint8_t type; uint16_t length; uint32_t id;` with no padding. The bytes received are `02 01 2C 00 01 E2 40`. What is `length`, in decimal or hex?',
    kind: 'value', answer: 0x012C,
    explain: 'length is bytes 1 and 2: 01 2C. Big-endian: 0x012C = 300. The portable way to read it is `(buf[1] << 8) | buf[2]`, which is correct on any CPU.',
    diagnose(v) { if (v === 0x2C01) return '0x2C01 (11265) is what you get by reading the two bytes little-endian, for instance with a struct overlay on this MCU. A length check against 11265 instead of 300 is exactly how parsers end up reading past the end of a buffer.'; if (v === 0x0201) return 'You started at byte 0. Byte 0 is the type field; length is the next two bytes.'; return 'length occupies bytes 1 and 2 of the packet, most significant byte first.'; },
  },
};

export default function mount(el, props = {}, ctx) {
  let value = parseValue(props.value != null ? (typeof props.value === 'number' ? '0x' + (props.value >>> 0).toString(16) : props.value) : '0x12345678') ?? 0x12345678;
  let tab = ['explore', 'wire', 'convert', 'quiz'].includes(props.tab) ? props.tab : 'explore';
  const solved = new Set(); const tried = {};
  let qid = CHALLENGES[props.challenge] ? props.challenge : 'store-le';
  const root = h('div', { class: 'endianness' });
  el.append(root);

  const cells = (bytes, base, labels) => h('div', { class: 'endianness-cells' }, bytes.map((b, i) => h('div', { class: 'endianness-cell' + (labels?.[i]?.cls ? ' ' + labels[i].cls : '') },
    h('div', { class: 'a w-mono' }, base != null ? hex(base + i).slice(-4) : 'byte ' + i), h('div', { class: 'b w-mono' }, b2(b)), labels?.[i]?.t ? h('div', { class: 'l' }, labels[i].t) : null)));

  function explore() {
    const inp = h('input', { type: 'text', class: 'mono', value: hex(value), 'aria-label': '32-bit value', size: 12 });
    const out = h('div', { 'aria-live': 'polite' });
    const upd = () => {
      const v = parseValue(inp.value); clear(out);
      if (v == null) { out.append(h('p', { class: 'w-msg bad' }, 'Enter a 32-bit value such as 0x12345678 or 305419896.')); return; }
      value = v;
      const sig = ['LSB', '', '', 'MSB'];
      out.append(
        h('h4', {}, 'Little-endian (Cortex-M, RISC-V, ESP32, x86)'), cells(toBytes(v, 'le'), 0x20000010, sig.map((t, i) => ({ t, cls: i === 0 ? 'lsb' : i === 3 ? 'msb' : '' }))),
        h('h4', {}, 'Big-endian (network byte order)'), cells(toBytes(v, 'be'), 0x20000010, [...sig].reverse().map((t, i) => ({ t, cls: i === 3 ? 'lsb' : i === 0 ? 'msb' : '' }))),
        h('dl', { class: 'w-kv' },
          h('dt', {}, 'value'), h('dd', {}, `${hex(v)} = ${v}`),
          h('dt', {}, '*(uint8_t *)&x, little-endian'), h('dd', {}, '0x' + b2(toBytes(v, 'le')[0])),
          h('dt', {}, '*(uint8_t *)&x, big-endian'), h('dd', {}, '0x' + b2(toBytes(v, 'be')[0])),
          h('dt', {}, '*(uint16_t *)&x, little-endian'), h('dd', {}, hex(fromBytes(toBytes(v, 'le').slice(0, 2), 'le'), 4))));
    };
    inp.addEventListener('input', upd); upd();
    return h('div', {}, h('label', { class: 'row' }, h('span', { class: 'w-mono' }, 'uint32_t x ='), inp), out,
      h('p', { class: 'w-note' }, 'The number is the same in both cases; only the order of its bytes in memory differs. Shifts and masks (`x >> 8`, `x & 0xFF`) work on the number and give the same result on every CPU. Byte order only shows when you look at memory byte by byte: casts, unions, memcpy, hex dumps, and anything sent to another machine.'));
  }

  function wire() {
    const lab = [{ t: 'type', cls: 'f1' }, { t: 'length', cls: 'f2' }, { t: '', cls: 'f2' }, { t: 'id', cls: 'f3' }, { t: '', cls: 'f3' }, { t: '', cls: 'f3' }, { t: '', cls: 'f3' }];
    const lenLE = fromBytes(WIRE.slice(1, 3), 'le'), lenBE = fromBytes(WIRE.slice(1, 3), 'be');
    const idLE = fromBytes(WIRE.slice(3, 7), 'le'), idBE = fromBytes(WIRE.slice(3, 7), 'be');
    return h('div', {},
      h('pre', { class: 'w-mono endianness-code' }, 'struct __attribute__((packed)) hdr {\n    uint8_t  type;\n    uint16_t length;   // big-endian on the wire\n    uint32_t id;       // big-endian on the wire\n};'),
      h('p', {}, 'Seven bytes arrive, in this order:'), cells(WIRE, null, lab),
      h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Field'), h('th', {}, 'Sender meant'), h('th', {}, 'memcpy into the struct on a little-endian MCU'), h('th', {}, 'Correct code'))),
        h('tbody', {},
          h('tr', {}, h('td', {}, 'type'), h('td', { class: 'w-mono' }, '0x02'), h('td', { class: 'w-mono' }, '0x02 (one byte has no order)'), h('td', { class: 'w-mono' }, 'buf[0]')),
          h('tr', {}, h('td', {}, 'length'), h('td', { class: 'w-mono' }, `${lenBE}`), h('td', { class: 'w-mono endianness-bad' }, `${lenLE}`), h('td', { class: 'w-mono' }, '(buf[1] << 8) | buf[2]')),
          h('tr', {}, h('td', {}, 'id'), h('td', { class: 'w-mono' }, `${idBE}`), h('td', { class: 'w-mono endianness-bad' }, `${idLE}`), h('td', { class: 'w-mono' }, '((uint32_t)buf[3] << 24) | (buf[4] << 16) | (buf[5] << 8) | buf[6]'))))),
      h('p', { class: 'w-note' }, `Overlaying the struct gives length = ${lenLE} instead of ${lenBE}. If that length is then trusted to copy a payload, the parser reads far past the packet: a byte-order bug becomes a memory-safety bug. Building each field from individual bytes with shifts is correct on every CPU and also avoids the unaligned access that the packed struct causes (id starts at offset 3).`));
  }

  function convert() {
    const inp = h('input', { type: 'text', class: 'mono', value: hex(value), 'aria-label': 'host value', size: 12 });
    const out = h('div', { 'aria-live': 'polite' });
    const upd = () => {
      const v = parseValue(inp.value); clear(out);
      if (v == null) { out.append(h('p', { class: 'w-msg bad' }, 'Enter a 32-bit value.')); return; }
      value = v; const n = htonl(v, 'le');
      out.append(
        h('p', {}, 'Host value in memory (little-endian):'), cells(toBytes(v, 'le'), 0x20000010),
        h('p', {}, h('span', { class: 'w-mono' }, `htonl(${hex(v)}) = ${hex(n)}`), ' — the same four bytes, reversed:'), cells(toBytes(n, 'le'), 0x20000014),
        h('p', {}, 'Sent lowest address first, the wire carries ', h('span', { class: 'w-mono' }, toBytes(n, 'le').map(b2).join(' ')), ': most significant byte first, which is network order.'),
        h('p', {}, h('span', { class: 'w-mono' }, `ntohl(${hex(n)}) = ${hex(ntohl(n, 'le'))}`), ' on the receiver. On a big-endian host both functions return their argument unchanged, which is why code that omits them works on one machine and not another.'));
    };
    inp.addEventListener('input', upd); upd();
    return h('div', {}, h('label', { class: 'row' }, h('span', { class: 'w-mono' }, 'uint32_t host ='), inp), out,
      h('pre', { class: 'w-mono endianness-code' }, 'static inline uint32_t bswap32(uint32_t v) {\n    return (v << 24) | ((v & 0xFF00u) << 8) | ((v >> 8) & 0xFF00u) | (v >> 24);\n}'));
  }

  function quiz() {
    const c = CHALLENGES[qid];
    const inp = h('input', { type: 'text', class: 'mono', 'aria-label': 'Your answer', placeholder: c.kind === 'bytes' ? 'e.g. AA BB CC DD' : 'e.g. 0x1234' });
    const fb = h('div', { 'aria-live': 'polite' });
    const check = () => {
      clear(fb);
      let ok = false, msg;
      if (c.kind === 'bytes') {
        const b = parseBytes(inp.value, c.answer.length);
        if (!b) { fb.append(h('p', { class: 'w-msg warn' }, `Type ${c.answer.length} bytes in hex, separated by spaces.`)); return; }
        ok = b.join() === c.answer.join(); msg = ok ? c.explain : c.diagnose(b);
      } else {
        const v = parseValue(inp.value);
        if (v == null) { fb.append(h('p', { class: 'w-msg warn' }, 'Type a number in hex (0x…) or decimal.')); return; }
        ok = v === c.answer; msg = ok ? c.explain : c.diagnose(v);
      }
      tried[qid] = true;
      fb.append(h('p', { class: 'w-msg ' + (ok ? 'ok' : 'bad') }, (ok ? 'Correct. ' : 'Not yet. ') + msg));
      if (ok) {
        solved.add(qid);
        if (props.challenge ? qid === props.challenge : solved.size === Object.keys(CHALLENGES).length) ctx?.complete?.();
        const ids = Object.keys(CHALLENGES); const nxt = ids.find((k) => !solved.has(k));
        if (nxt) fb.append(h('button', { type: 'button', class: 'btn small', onclick: () => { qid = nxt; draw(); } }, 'Next task'));
        else fb.append(h('p', { class: 'w-msg ok' }, 'All four tasks solved.'));
      }
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });
    return h('div', {},
      h('div', { class: 'w-tabs', role: 'group', 'aria-label': 'Task' }, Object.entries(CHALLENGES).map(([id, t]) =>
        h('button', { type: 'button', class: 'w-tab' + (id === qid ? ' on' : ''), onclick: () => { qid = id; draw(); } }, (solved.has(id) ? '✓ ' : '') + t.title))),
      h('div', { class: 'w-task' }, h('p', { html: c.prompt.replace(/`([^`]+)`/g, '<code>$1</code>') })),
      h('div', { class: 'row' }, inp, h('button', { type: 'button', class: 'btn small', onclick: check }, 'Check')), fb);
  }

  function draw() {
    clear(root);
    root.append(h('div', { class: 'w-tabs', role: 'group', 'aria-label': 'View' }, [['explore', 'A value in memory'], ['wire', 'Struct from a wire'], ['convert', 'htonl / ntohl'], ['quiz', 'Tasks']].map(([id, t]) =>
      h('button', { type: 'button', class: 'w-tab' + (id === tab ? ' on' : ''), 'aria-pressed': String(id === tab), onclick: () => { tab = id; draw(); } }, t))));
    root.append({ explore, wire, convert, quiz }[tab]());
  }
  if (props.challenge) tab = 'quiz';
  draw();
}
