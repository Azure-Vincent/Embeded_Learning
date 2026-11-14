import { h, s, clear } from '../core/dom.js';
import { glitchAttempt, glitchSweep } from '../sim/attacks.js';

// Concept model of fault injection against one boot-time branch, and of the countermeasures.
// All probabilities are invented for illustration; no real device parameters are represented.
export default function mount(el, props = {}, ctx = {}) {
  let defence = props.defence || 'none';
  const done = { bypass: false, defended: false };
  const offset = h('input', { type: 'range', min: 20, max: 60, value: 30 }), width = h('input', { type: 'range', min: 1, max: 12, value: 3 });
  const oOut = h('output', {}, '30'), wOut = h('output', {}, '3');
  offset.oninput = () => (oOut.textContent = offset.value); width.oninput = () => (wOut.textContent = width.value);
  const defSel = h('select', { 'aria-label': 'Countermeasure', onchange: () => { defence = defSel.value; clear(map); log.textContent = ''; } },
    [['none', 'No countermeasure'], ['double-check', 'Redundant check'], ['random-delay', 'Random delay']].map(([v, t]) => h('option', { value: v, selected: v === defence }, t)));
  const log = h('div', { class: 'w-term', style: { minHeight: '5em' } });
  const map = s('svg', { class: 'w-svg', viewBox: '0 0 420 200', role: 'img', 'aria-label': 'Success rate by glitch offset and width' });
  const msg = h('div', { class: 'w-msg' });

  function once() {
    const r = glitchAttempt(+offset.value, +width.value, { defence });
    log.textContent += `offset ${offset.value}, width ${width.value}: ${r.note}\n`; log.scrollTop = 1e6;
    if (r.outcome === 'bypass' && defence === 'none') done.bypass = true;
    finish();
  }
  function sweep() {
    const sw = glitchSweep({ defence }, 60);
    clear(map);
    const cw = 380 / sw.offsets.length, ch = 150 / sw.widths.length;
    let best = 0;
    sw.grid.forEach((row, wi) => row.forEach((p, oi) => {
      best = Math.max(best, p);
      map.append(s('rect', { x: 34 + oi * cw, y: 8 + (sw.widths.length - 1 - wi) * ch, width: cw - 1, height: ch - 1, fill: p > 0 ? 'var(--sig2)' : 'var(--sunk)', 'fill-opacity': p > 0 ? Math.min(1, 0.15 + p * 2.5) : 1 }, s('title', {}, `offset ${sw.offsets[oi]}, width ${sw.widths[wi]}: ${(p * 100).toFixed(0)}%`)));
    }));
    map.append(s('text', { x: 224, y: 192, 'text-anchor': 'middle', 'font-size': 11 }, 'glitch offset after reset →'), s('text', { x: 12, y: 90, 'font-size': 11, transform: 'rotate(-90 12 90)', 'text-anchor': 'middle' }, 'width →'));
    msg.className = 'w-msg ' + (best > 0.05 ? 'bad' : 'ok');
    msg.textContent = defence === 'none' ? `Best cell: ${(best * 100).toFixed(0)}% of attempts skipped the check. The bright band is the moment the branch executes.`
      : defence === 'double-check' ? `Best cell: ${(best * 100).toFixed(0)}%. Two independent checks must both be disturbed, so the rate collapses but is not zero.`
        : `Best cell: ${(best * 100).toFixed(0)}%. With the check moving randomly in time there is no fixed offset to aim at.`;
    if (defence === 'none' && best > 0.05) done.bypass = true;
    if (defence !== 'none' && done.bypass) done.defended = true;
    finish();
  }
  function finish() { if (done.bypass && done.defended) ctx.complete?.(); }
  el.append(
    h('div', { class: 'w-task' }, h('p', {}, 'A bootloader runs ', h('code', {}, 'if (verify(image) != OK) halt();'), '. A brief disturbance of the supply or clock at exactly the right moment can make a CPU mis-execute one instruction. Sweep to find where the model is sensitive, then choose a countermeasure and sweep again.')),
    h('div', { class: 'w-grid' },
      h('div', { class: 'w-controls' }, h('div', { class: 'w-field' }, h('label', {}, 'Firmware'), defSel, h('span')), h('div', { class: 'w-field' }, h('label', {}, 'Offset'), offset, oOut), h('div', { class: 'w-field' }, h('label', {}, 'Width'), width, wOut),
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn small ghost', onclick: once }, 'Single attempt'), h('button', { type: 'button', class: 'btn small', onclick: sweep }, 'Sweep all settings')), log),
      h('div', {}, map)),
    msg,
    h('pre', { class: 'code' }, '/* fragile: one branch, boolean result */      /* hardened: redundant, fail-closed, distinct constants */\nif (verify(img) != 0) halt();                  volatile uint32_t r1 = verify(img);\nboot(img);                                     random_delay();\n                                               volatile uint32_t r2 = verify(img);\n                                               if (r1 != 0x3CA5965A || r2 != 0x3CA5965A) halt();\n                                               boot(img);'),
    h('p', { class: 'w-note' }, 'This is an invented probability model, not a description of any chip. It shows why countermeasures are layered: redundant checks, non-trivial success constants instead of 0/1, random delays, brown-out and glitch detectors, and defaulting to the locked state. Published research has demonstrated fault injection on commercial microcontrollers; Espressif advisory AR2023-005 (CVE-2023-35818) is one vendor-acknowledged example. Code review can confirm the countermeasures are present; only fault-injection testing on the real hardware can show they are effective.'));
}
