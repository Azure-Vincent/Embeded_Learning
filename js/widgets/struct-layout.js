import { h, clear } from '../core/dom.js';
import { layoutOf, layoutStruct } from '../sim/cinterp.js';

// Struct layout explorer. Field offsets come from the same layout code the Bench-MCU interpreter uses
// (32-bit little-endian ABI, natural alignment, 8-byte types aligned to 8).

export const DEFAULT_SOURCE = `struct sensor_reading {
    uint8_t  id;
    uint32_t timestamp;
    uint8_t  flags;
    uint16_t value;
    uint8_t  crc;
};
`;

/** One entry per byte of the struct: { field: index into s.fields or -1 for padding, first: true on a field's first byte }. */
export function byteMap(s) {
  const cells = Array.from({ length: s.size }, () => ({ field: -1, first: false }));
  if (s.kind === 'union') { const big = s.fields.reduce((b, f, i) => (f.size > s.fields[b].size ? i : b), 0); s.fields.length && cells.forEach((c, i) => { if (i < s.fields[big].size) { c.field = big; c.first = i === 0; } }); return cells; }
  s.fields.forEach((f, i) => { for (let b = 0; b < f.size; b++) if (cells[f.offset + b]) { cells[f.offset + b].field = i; cells[f.offset + b].first = b === 0; } });
  return cells;
}
/** Smallest size any field order can reach without packing: sort by alignment, largest first. */
export function bestSize(fields) {
  const sorted = [...fields].sort((a, b) => b.align - a.align);
  return layoutStruct(sorted).size;
}
export const paddingBytes = (s) => s.padding.reduce((n, p) => n + p.size, 0);
/** Swap two whole source lines (1-based). Used to reorder fields that each sit on their own line. */
export function swapLines(source, a, b) {
  const lines = source.split('\n');
  if (a < 1 || b < 1 || a > lines.length || b > lines.length) return source;
  [lines[a - 1], lines[b - 1]] = [lines[b - 1], lines[a - 1]];
  return lines.join('\n');
}
/** Fields can be moved by swapping lines only when every field is alone on its line. */
export function reorderable(s) {
  const seen = new Set();
  for (const f of s.fields) { if (!f.line || seen.has(f.line)) return false; seen.add(f.line); }
  return s.kind === 'struct' && s.fields.length > 1;
}

const COLORS = ['--sig1', '--sig3', '--sig4', '--sig5', '--sig2', '--sig6'];

export default function mount(el, props = {}, ctx = {}) {
  const original = String(props.source || DEFAULT_SOURCE).replace(/^\n/, '');
  let packed = false, pick = -1, solved = !!(ctx.isDone && ctx.isDone());
  let startSize = null;
  clear(el);
  el.classList.add('struct-layout');

  const ta = h('textarea', { class: 'mono struct-layout-src', rows: Math.min(16, original.split('\n').length + 1), spellcheck: 'false', 'aria-label': 'Struct definition in C' });
  ta.value = original;
  const packBox = h('input', { type: 'checkbox', onchange: () => { packed = packBox.checked; render(); } });
  const out = h('div', { class: 'struct-layout-out' });
  const msg = h('div', { role: 'status', 'aria-live': 'polite' });
  ta.addEventListener('input', () => { pick = -1; render(); });

  function render() {
    clear(out); clear(msg);
    const res = layoutOf(ta.value, { packed });
    if (!res.ok) { msg.append(h('div', { class: 'w-msg bad' }, `line ${res.error.line}: ${res.error.msg}`)); return; }
    if (!res.structs.length) { msg.append(h('div', { class: 'w-msg warn' }, 'Write a struct or union definition, for example: struct point { int16_t x; int16_t y; };')); return; }
    if (pick < 0 || pick >= res.structs.length) pick = res.structs.length - 1;
    const s = res.structs[pick], natural = packed ? layoutOf(ta.value).structs[pick] : s;
    const pad = paddingBytes(s), best = s.kind === 'struct' ? bestSize(natural.fields) : s.size;
    if (startSize == null) startSize = natural.size;
    if (res.structs.length > 1) out.append(h('div', { class: 'w-tabs' }, res.structs.map((x, i) => h('button', { type: 'button', class: 'w-tab' + (i === pick ? ' on' : ''), onclick: () => { pick = i; render(); } }, `${x.kind} ${x.name}`))));
    out.append(h('div', { class: 'w-readout' },
      h('div', {}, h('div', { class: 'k' }, `sizeof(${s.kind} ${s.name})`), h('div', { class: 'v' }, `${s.size} bytes`)),
      h('div', {}, h('div', { class: 'k' }, 'alignment'), h('div', { class: 'v' }, s.align)),
      h('div', {}, h('div', { class: 'k' }, 'padding'), h('div', { class: 'v' }, `${pad} byte${pad === 1 ? '' : 's'}`)),
      h('div', {}, h('div', { class: 'k' }, 'smallest unpacked order'), h('div', { class: 'v' }, `${best} bytes`))));
    // byte map, four bytes (one 32-bit word) per row
    const cells = byteMap(s), grid = h('div', { class: 'struct-layout-map', role: 'img', 'aria-label': `Byte map of ${s.name}: ${s.fields.map((f) => `${f.name} at offset ${f.offset}, ${f.size} bytes`).join('; ')}; ${pad} padding bytes` });
    for (let row = 0; row < s.size; row += 4) {
      grid.append(h('div', { class: 'struct-layout-off' }, '+' + row));
      for (let b = row; b < row + 4; b++) {
        const c = cells[b];
        if (!c) { grid.append(h('div', { class: 'struct-layout-cell none' })); continue; }
        const f = c.field >= 0 ? s.fields[c.field] : null;
        grid.append(h('div', { class: 'struct-layout-cell' + (f ? '' : ' pad'), style: f ? { background: `color-mix(in srgb, var(${COLORS[c.field % COLORS.length]}) 22%, var(--surface))`, borderColor: `var(${COLORS[c.field % COLORS.length]})` } : null, title: f ? `${f.decl}: byte ${b - f.offset} of ${f.size}` : `padding at offset ${b}` },
          f ? (c.first ? f.name : '·') : 'pad'));
      }
    }
    out.append(h('div', { class: 'tag' }, 'Memory layout, 4 bytes per row, lowest address first'), grid);
    const canMove = reorderable(s);
    out.append(h('div', { class: 'table-wrap' }, h('table', { class: 'struct-layout-table' },
      h('thead', {}, h('tr', {}, canMove ? h('th', {}, 'move') : null, h('th', {}, 'field'), h('th', {}, 'offset'), h('th', {}, 'size'), h('th', {}, 'align'), h('th', {}, 'padding after'))),
      h('tbody', {}, s.fields.map((f, i) => {
        const end = f.offset + f.size, next = s.kind === 'union' ? s.size : i + 1 < s.fields.length ? s.fields[i + 1].offset : s.size, gap = s.kind === 'union' ? 0 : next - end;
        return h('tr', {},
          canMove ? h('td', { class: 'struct-layout-move' },
            h('button', { type: 'button', class: 'btn small ghost', disabled: i === 0, 'aria-label': `Move ${f.name} up`, onclick: () => move(s, i, -1) }, '↑'), ' ',
            h('button', { type: 'button', class: 'btn small ghost', disabled: i === s.fields.length - 1, 'aria-label': `Move ${f.name} down`, onclick: () => move(s, i, 1) }, '↓')) : null,
          h('td', {}, h('span', { class: 'struct-layout-swatch', style: { background: `var(${COLORS[i % COLORS.length]})` } }), f.decl), h('td', {}, f.offset), h('td', {}, f.size), h('td', {}, f.align),
          h('td', { class: gap ? 'struct-layout-gap' : '' }, gap ? `${gap} byte${gap === 1 ? '' : 's'}${i + 1 === s.fields.length ? ' (tail)' : ''}` : '—'),
          null);
      })))));
    if (s.kind === 'struct' && !canMove && s.fields.length > 1) out.append(h('p', { class: 'w-note' }, 'To reorder with the arrow buttons, put each field on its own line.'));
    // feedback on the reorder challenge
    if (packed) msg.append(h('div', { class: 'w-msg warn' }, `Packed: no padding, ${s.size} bytes. Fields may now sit at addresses that are not multiples of their size. On many microcontrollers an unaligned 16- or 32-bit access is slower, and on some cores it faults; taking a pointer to a packed field is a common source of such bugs. Pack structs that mirror a wire or file format, not ordinary data.`));
    else if (s.kind === 'struct' && startSize > best) {
      if (s.size === best) {
        msg.append(h('div', { class: 'w-msg ok' }, `${s.size} bytes: no order of these fields is smaller without packing. Placing the widest-aligned fields first leaves no gaps between fields; only tail padding to a multiple of ${s.align} can remain.`));
        if (!solved) { solved = true; if (ctx.complete) ctx.complete(); }
      } else msg.append(h('div', { class: 'w-msg' }, `This order wastes ${pad} byte${pad === 1 ? '' : 's'} on padding. Each field must start at a multiple of its alignment, so a small field followed by a wide one leaves a gap. An array of 1000 of these would spend ${(s.size - best) * 1000} more bytes of RAM than the best order.`));
    } else if (s.kind === 'struct' && pad === 0) msg.append(h('div', { class: 'w-msg ok' }, 'No padding in this order.'));
  }
  function move(s, i, dir) {
    ta.value = swapLines(ta.value, s.fields[i].line, s.fields[i + dir].line);
    render();
  }

  el.append(
    h('div', { class: 'w-task' }, h('p', {}, h('strong', {}, 'Task: '), 'reorder the fields (arrow buttons, or edit the text) until the struct is as small as it can be ', h('em', {}, 'without'), ' packing it. Predict the size before you look.')),
    h('div', { class: 'w-grid struct-layout-grid' },
      h('div', {}, ta,
        h('div', { class: 'row' },
          h('label', { class: 'struct-layout-pack' }, packBox, ' __attribute__((packed))'),
          h('button', { type: 'button', class: 'btn small ghost', onclick: () => { ta.value = original; pick = -1; render(); } }, 'Reset')),
        msg),
      out),
    h('p', { class: 'w-note' }, 'Model: the Bench-MCU ABI (32-bit, little-endian; char 1, short 2, int/long/pointers 4, long long 8, each aligned to its own size; a struct is aligned to its widest member and its size is rounded up to that). Real compilers for 32-bit ARM and RISC-V lay out these types the same way, but an ABI can differ (32-bit x86 aligns 8-byte types to 4), so check with sizeof and offsetof on your target. Bit-fields are not modelled.'));
  render();
}
