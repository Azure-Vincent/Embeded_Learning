import { h, clear, hex } from '../core/dom.js';
import { stackFrame, unsafeCopy, UNLOCK_ADDR, DENY_ADDR } from '../sim/attacks.js';

// Teaching model of a stack buffer overflow and its countermeasures. No real target is involved.
// The learner writes bytes into an 8-byte buffer and watches them spill into the neighbouring flag and
// return address, then switches on a stack canary or a bounds check and sees the same input fail.

export default function mount(el, props = {}, ctx = {}) {
  let mitigation = props.mitigation || 'none';
  let bytes = [];
  const state = { attackDone: false, defenceDone: false };

  const task = h('div', { class: 'w-task' },
    h('p', {}, h('strong', {}, 'Goal: '), 'A device unlocks only if the local variable ', h('code', {}, 'authorized'), ' is non-zero, which the program never sets. The function reads your input into ', h('code', {}, 'char buf[8]'), ' with no length check. First make the device unlock by overflowing ', h('code', {}, 'buf'), ' into ', h('code', {}, 'authorized'), '. Then set the defence to ', h('em', {}, 'canary'), ' or ', h('em', {}, 'bounds'), ' and try the same input — it should fail.'));

  const mitSel = h('select', { 'aria-label': 'Defence', onchange: () => { mitigation = mitSel.value; render(); } },
    [['none', 'No protection'], ['canary', 'Stack canary'], ['bounds', 'Bounds-checked read']].map(([v, t]) => h('option', { value: v, selected: mitigation === v }, t)));

  const input = h('textarea', { rows: 2, class: 'mono', spellcheck: 'false', placeholder: String.raw`type text, or \x41 hex escapes, e.g. AAAAAAAA\x01`, 'aria-label': 'Attacker input' });
  const presetRow = h('div', { class: 'row' },
    h('button', { type: 'button', class: 'btn small ghost', onclick: () => { input.value = 'AAAAAAAA\\x01'; run(); } }, 'Fill flag'),
    h('button', { type: 'button', class: 'btn small ghost', onclick: () => { const a = UNLOCK_ADDR >>> 0; input.value = 'AAAAAAAABBBBB' + ['', '', '', ''].map((_, i) => `\\x${((a >> (i * 8)) & 0xff).toString(16).padStart(2, '0')}`).join(''); run(); } }, 'Overwrite return → unlock()'));

  const memView = h('div', { class: 'smash-mem' });
  const msg = h('div', { class: 'w-msg' });
  const fnTable = h('div', { class: 'w-kv smash-fns' },
    h('dt', {}, 'deny()'), h('dd', {}, hex(DENY_ADDR)), h('dt', {}, 'unlock()'), h('dd', {}, hex(UNLOCK_ADDR)));

  function parseInput(txt) {
    const out = [];
    for (let i = 0; i < txt.length; i++) {
      if (txt[i] === '\\' && txt[i + 1] === 'x') { out.push(parseInt(txt.slice(i + 2, i + 4), 16) & 0xff || 0); i += 3; }
      else out.push(txt.charCodeAt(i) & 0xff);
    }
    return out;
  }

  function run() {
    bytes = parseInput(input.value);
    render();
  }

  function render() {
    mitSel.value = mitigation;
    const frame = stackFrame(8);
    const r = unsafeCopy(frame, new Uint8Array(bytes), { canary: mitigation === 'canary', bounds: mitigation === 'bounds' });
    const layout = r.layout;
    // draw memory cells
    clear(memView);
    const buf = new Uint8Array(layout.total);
    const n = mitigation === 'bounds' ? Math.min(bytes.length, 8) : Math.min(bytes.length, layout.total);
    for (let i = 0; i < n; i++) buf[i] = bytes[i] & 0xff;
    for (const reg of layout.regions) {
      const off = reg.addr - layout.base;
      const cells = [];
      for (let i = 0; i < reg.size; i++) {
        const written = i + off < n;
        cells.push(h('span', { class: 'smash-cell' + (written ? ' hit' : ''), title: hex(reg.addr + i) }, buf[off + i].toString(16).padStart(2, '0')));
      }
      memView.append(h('div', { class: 'smash-row' + (reg.name === 'return_addr' || reg.name === 'authorized' ? ' key' : '') },
        h('span', { class: 'smash-name' }, reg.name), h('span', { class: 'smash-addr' }, hex(reg.addr)), h('div', { class: 'smash-cells' }, cells)));
    }
    // outcome
    msg.className = 'w-msg';
    if (!bytes.length) { msg.textContent = 'Enter input and run.'; }
    else if (r.aborted) { msg.classList.add('warn'); msg.innerHTML = '<strong>*** stack smashing detected ***</strong> The canary was overwritten, so the function aborted before returning. The overflow still corrupted memory — the canary detects it, it does not prevent it.'; state.defenceDone = true; }
    else if (r.boundsLimited) { msg.classList.add('ok'); msg.innerHTML = 'The read stopped at 8 bytes. ' + (r.authorized ? '' : '<code>authorized</code> stays 0 and the return address is untouched. This is the real fix: never write more than the buffer holds.'); state.defenceDone = true; }
    else if (r.retAddr === (UNLOCK_ADDR >>> 0)) { msg.classList.add('bad'); msg.innerHTML = `The saved return address now holds ${hex(UNLOCK_ADDR)} — when the function returns it jumps into <code>unlock()</code>. Control-flow hijack.`; if (mitigation === 'none') state.attackDone = true; }
    else if (r.authorized) { msg.classList.add('bad'); msg.innerHTML = 'You wrote past <code>buf</code> and set the adjacent <code>authorized</code> byte. The device unlocks although you never knew a password.'; if (mitigation === 'none') state.attackDone = true; }
    else if (r.overran) { msg.classList.add('warn'); msg.innerHTML = 'You overran <code>buf</code> but did not land on a byte that changes the outcome. Look at the layout and aim.'; }
    else { msg.textContent = `Wrote ${r.bytesWritten} of 8 bytes into buf. No overflow yet.`; }

    if (state.attackDone && state.defenceDone) ctx.complete?.();
    progress.textContent = `Overflow demonstrated: ${state.attackDone ? '✓' : '—'}   ·   Defence verified: ${state.defenceDone ? '✓' : '—'}`;
  }

  const progress = h('div', { class: 'w-note' });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.ctrlKey) run(); });

  el.append(
    task,
    h('div', { class: 'w-grid' },
      h('div', {}, h('div', { class: 'w-field' }, h('label', {}, 'Defence'), mitSel, h('span')), input, h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn small', onclick: run }, 'Send input'), presetRow), fnTable),
      h('div', {}, memView)),
    msg, progress,
    h('p', { class: 'w-note' }, 'Model: a descending 32-bit stack, bytes written low→high, little-endian addresses. Function addresses are illustrative. On a real Cortex-M a hijacked return usually faults unless the address is a valid Thumb target; embedded builds often lack ASLR, so addresses are stable. Defences shown: stack canary (', h('code', {}, '-fstack-protector-strong'), ', detects), bounds-checked input (prevents). Verify on a real design by fuzzing every input length and building with the stack protector and an MPU/execute-never where available.'));
  render();
}
