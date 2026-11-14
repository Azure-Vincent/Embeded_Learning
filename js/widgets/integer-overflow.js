import { h, clear } from '../core/dom.js';
import { WIDTHS, wrap, lengthCheck, allocSize } from '../sim/attacks.js';

// Fixed-width arithmetic explorer plus two size checks that look right and are not.
export const CHALLENGES = { 'length-check': { title: 'A bounds check that wraps' }, 'alloc-size': { title: 'A multiplication that wraps' } };

export default function mount(el, props = {}, ctx = {}) {
  let tab = props.challenge || 'explore';
  const done = { broke: false, fixed: false };
  const body = h('div');
  const tabs = h('div', { class: 'w-tabs' }, [['explore', 'Arithmetic explorer'], ['length-check', 'Length check'], ['alloc-size', 'Allocation size']].map(([k, t]) =>
    h('button', { type: 'button', class: 'w-tab' + (tab === k ? ' on' : ''), onclick: () => { tab = k; draw(); } }, t)));
  const num = (v, min = 0) => h('input', { type: 'number', value: v, min, class: 'mono', style: { width: '9em' } });
  const bits = (v, n) => (v >>> 0).toString(2).padStart(32, '0').slice(32 - n).replace(/(.{8})(?=.)/g, '$1 ');

  function explore() {
    const a = num(200), b = num(100);
    const op = h('select', {}, ['+', '-', '*'].map((o) => h('option', {}, o)));
    const type = h('select', {}, Object.keys(WIDTHS).map((t) => h('option', { selected: t === 'u8' }, t)));
    const out = h('div', { class: 'w-readout' });
    const note = h('div', { class: 'w-msg' });
    const calc = () => {
      const x = +a.value || 0, y = +b.value || 0, t = type.value;
      const exact = op.value === '+' ? x + y : op.value === '-' ? x - y : x * y;
      const got = wrap(exact, t), n = WIDTHS[t][0];
      clear(out).append(...[['Mathematical result', exact], [`Stored in ${t}`, got], ['Bit pattern', bits(got, n)]].map(([k, v]) => h('div', {}, h('div', { class: 'k' }, k), h('div', { class: 'v' }, String(v)))));
      note.className = 'w-msg ' + (got === exact ? 'ok' : 'warn');
      note.textContent = got === exact ? 'The result fits, so the stored value is exact.' : `The result does not fit in ${n} bits. The CPU keeps only the low ${n} bits: ${exact} becomes ${got}. Unsigned wrap is defined behaviour in C; signed overflow is undefined, so the compiler may assume it never happens.`;
    };
    [a, b, op, type].forEach((x) => (x.oninput = calc));
    calc();
    return [h('div', { class: 'row' }, a, op, b, 'as', type), out, note];
  }

  function lengthTab() {
    const off = num(0), len = num(16);
    const fixed = h('input', { type: 'checkbox' });
    const msg = h('div', { class: 'w-msg' });
    const code = h('pre', { class: 'code' });
    const run = () => {
      const o = +off.value || 0, l = +len.value || 0;
      code.textContent = fixed.checked
        ? 'uint8_t buf[64];\nif (offset > 64 || len > 64 - offset) return ERR;   // cannot wrap\nmemcpy(buf + offset, src, len);'
        : 'uint8_t buf[64];\nuint16_t offset, len;                 // from the packet\nif ((uint16_t)(offset + len) > 64) return ERR;\nmemcpy(buf + offset, src, len);';
      if (o > 65535 || l > 65535 || o < 0 || l < 0) { msg.className = 'w-msg warn'; msg.textContent = 'Both fields are 16 bits on the wire: 0 to 65535.'; return; }
      if (fixed.checked) {
        const ok = !(o > 64 || l > 64 - o);
        msg.className = 'w-msg ' + (ok ? 'ok' : 'ok');
        msg.textContent = ok ? `Accepted: ${o} + ${l} really is within 64 bytes.` : 'Rejected. The check subtracts from the known-good size instead of adding two untrusted numbers, so there is nothing to wrap.';
        if (!ok && o + l > 64) done.fixed = true;
      } else {
        const r = lengthCheck(o, l, 64, 'u16');
        if (r.overflow) { msg.className = 'w-msg bad'; msg.textContent = `offset + len = ${o + l}, but in 16 bits that is ${r.sum}, which is ≤ 64, so the check passes. memcpy then writes ${l} bytes starting ${o} bytes past the buffer.`; done.broke = true; }
        else if (r.accepted) { msg.className = 'w-msg ok'; msg.textContent = `Accepted, and it genuinely fits (${o + l} ≤ 64).`; }
        else { msg.className = 'w-msg'; msg.textContent = `Rejected: ${r.sum} > 64. Honest oversize input is caught. Can two values that are each in range produce a small sum?`; }
      }
      finish();
    };
    [off, len].forEach((x) => (x.oninput = run)); fixed.onchange = run; run();
    return [h('div', { class: 'w-task' }, h('p', {}, 'A receiver copies ', h('code', {}, 'len'), ' bytes to ', h('code', {}, 'buf + offset'), ' after a bounds check. Find an offset and length that pass the check but do not fit. Then switch on the corrected check and confirm the same values are rejected.')),
      code, h('div', { class: 'row' }, h('label', {}, 'offset ', off), h('label', {}, 'len ', len), h('label', {}, fixed, ' use the corrected check')), msg];
  }

  function allocTab() {
    const count = num(4), size = num(16);
    const fixed = h('input', { type: 'checkbox' });
    const msg = h('div', { class: 'w-msg' });
    const run = () => {
      const c = +count.value || 0, s = +size.value || 0;
      const r = allocSize(c, s, 'u32');
      if (fixed.checked) {
        const bad = s !== 0 && c > Math.floor(0xffffffff / s);
        msg.className = 'w-msg ok';
        msg.textContent = bad ? 'Rejected before allocating: count > SIZE_MAX / size, so the product would not fit.' : `Allocates ${r.product} bytes, which is the true product.`;
        if (bad) done.fixed = true;
      } else if (r.undersized) { msg.className = 'w-msg bad'; msg.textContent = `count × size = ${r.needed}, which wraps to ${r.product} in 32 bits. malloc(${r.product}) succeeds, and the loop that fills ${c} records writes far past it.`; done.broke = true; }
      else { msg.className = 'w-msg'; msg.textContent = `Allocates ${r.product} bytes for ${c} records. No wrap. How large must count be before the 32-bit product wraps?`; }
      finish();
    };
    [count, size].forEach((x) => (x.oninput = run)); fixed.onchange = run; run();
    return [h('div', { class: 'w-task' }, h('p', {}, 'A parser allocates ', h('code', {}, 'count * size'), ' bytes for records described by a header. Find values where the allocation is smaller than the data. Then enable the overflow check.')),
      h('pre', { class: 'code' }, 'uint32_t count, size;              // from the header\nrecord_t *r = malloc(count * size);\nfor (uint32_t i = 0; i < count; i++) read_record(&r[i]);'),
      h('div', { class: 'row' }, h('label', {}, 'count ', count), h('label', {}, 'size ', size), h('label', {}, fixed, ' check with SIZE_MAX / size (or __builtin_mul_overflow)')), msg];
  }
  const progress = h('p', { class: 'w-note' });
  function finish() {
    progress.textContent = tab === 'explore' ? '' : `Weakness shown: ${done.broke ? 'yes' : 'not yet'} · corrected check verified: ${done.fixed ? 'yes' : 'not yet'}`;
    if (done.broke && done.fixed) ctx.complete?.();
  }
  function draw() {
    tabs.querySelectorAll('.w-tab').forEach((b, i) => b.classList.toggle('on', ['explore', 'length-check', 'alloc-size'][i] === tab));
    clear(body).append(...(tab === 'explore' ? explore() : tab === 'length-check' ? lengthTab() : allocTab()));
    finish();
  }
  el.append(tabs, body, progress, h('p', { class: 'w-note' }, 'Detect this class of bug with -Wconversion and -Wsign-compare, boundary-value tests at 0, MAX and MAX+1 of every length field, and fuzzing the parser on a host build with UBSan and ASan.'));
  draw();
}
