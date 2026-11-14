import { h, clear, hex } from '../core/dom.js';
import { highlight } from '../core/highlight.js';
import { md } from '../core/md.js';
import { run, runTest, REGISTERS } from '../sim/cinterp.js';

// Firmware editor for Bench-MCU, the fictional teaching microcontroller in docs/BENCH_MCU.md.
// Everything runs in js/sim/cinterp.js inside the browser; no real compiler or hardware is involved.

export const DEMO = `#include <stdint.h>
#include <stdio.h>

/* Bench-MCU demo: blink pin 0 from a polled timer and count the blinks.
   GPIO_DIR, GPIO_TOGGLE, TIM_* are predefined (see the register map). */

static uint32_t blinks = 0;

static void wait_for_timer(void) {
    while (!(TIM_STATUS & TIM_EXPIRED)) { }   /* poll the flag */
    TIM_STATUS = TIM_EXPIRED;                  /* write 1 to clear */
}

int main(void) {
    GPIO_DIR |= 1u << 0;                       /* pin 0 is an output */
    TIM_LOAD = 50;                             /* 50 ticks per half period */
    TIM_CTRL = TIM_ENABLE | TIM_AUTO_RELOAD;

    for (int i = 0; i < 6; i++) {
        wait_for_timer();
        GPIO_TOGGLE = 1u << 0;
        blinks++;
        printf("toggle %d: GPIO_OUT = 0x%04x\\n", i + 1, GPIO_OUT);
    }
    return 0;
}
`;

/** Turn the text a learner types into raw bytes: \n \r \t \0 \\ and \xNN escapes are honoured. */
export function unescapeInput(text) {
  return String(text).replace(/\\(x[0-9a-fA-F]{1,2}|[nrt0\\])/g, (_, e) => (e[0] === 'x' ? String.fromCharCode(parseInt(e.slice(1), 16)) : { n: '\n', r: '\r', t: '\t', 0: '\0', '\\': '\\' }[e]));
}
/** Inverse of unescapeInput, for showing a test's stdin/uartRx in an input box. */
export function escapeInput(text) {
  return String(text == null ? '' : text).replace(/[\\\n\r\t\0]|[^\x20-\x7e]/g, (c) => ({ '\\': '\\\\', '\n': '\\n', '\r': '\\r', '\t': '\\t', '\0': '\\0' }[c] || (c.charCodeAt(0) < 256 ? '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0') : c)));
}
/** Parse "100, 0x200 4095" into numbers; returns null when a token is not a number. */
export function parseNumberList(text) {
  const parts = String(text).split(/[\s,]+/).filter(Boolean), out = [];
  for (const p of parts) { const n = Number(p); if (!Number.isFinite(n)) return null; out.push(n); }
  return out;
}
/** The solution unlocks after every hint has been opened or after three failed test runs. */
export function solutionUnlocked({ hints = 0, hintsShown = 0, failedRuns = 0, hasTests = true, runs = 0 }) {
  if (failedRuns >= 3) return true;
  if (hints > 0) return hintsShown >= hints;
  return hasTests ? false : runs >= 1;
}
const visible = (s) => String(s).replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, (c) => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0'));

export default function mount(el, props = {}, ctx = {}) {
  const playground = !props.starter && !props.tests && !props.prompt;
  const starter = props.starter != null ? String(props.starter).replace(/^\n/, '') : DEMO;
  const tests = Array.isArray(props.tests) ? props.tests : [];
  const hints = Array.isArray(props.hints) ? props.hints : [];
  const storeKey = ctx.key ? `bench.c-lab.${ctx.key}` : null;
  const load = () => { try { return storeKey ? localStorage.getItem(storeKey) : null; } catch { return null; } };
  const save = (v) => { try { if (!storeKey) return; if (v === starter) localStorage.removeItem(storeKey); else localStorage.setItem(storeKey, v); } catch { /* storage unavailable */ } };

  const state = { hintsShown: 0, failedRuns: 0, runs: 0, tab: 'output', last: null, testResults: null, breakLine: 0, dumpAddr: 0x20000000, solved: !!(ctx.isDone && ctx.isDone()), solutionOpen: false };
  const uid = 'clab' + Math.random().toString(36).slice(2, 8);
  clear(el);
  el.classList.add('c-lab');

  // ---------------------------------------------------------------- editor
  const gutter = h('div', { class: 'c-lab-gutter', 'aria-hidden': 'true' });
  const codeEl = h('code', {});
  const pre = h('pre', { class: 'c-lab-hl', 'aria-hidden': 'true' }, codeEl);
  const ta = h('textarea', {
    class: 'c-lab-ta', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off', wrap: 'off',
    'aria-label': 'C source code', 'aria-describedby': uid + 'keys', readonly: props.readOnly ? true : null,
  });
  ta.value = load() ?? starter;
  const editor = h('div', { class: 'c-lab-editor' }, gutter, h('div', { class: 'c-lab-code' }, pre, ta));
  let errLines = new Set(), warnLines = new Set(), stopLine = 0;

  function paint() {
    const src = ta.value;
    codeEl.innerHTML = highlight(src, 'c') + '\n';
    const n = src.split('\n').length;
    if (gutter.childElementCount !== n) {
      clear(gutter);
      for (let i = 1; i <= n; i++) gutter.append(h('button', { type: 'button', tabindex: '-1', class: 'c-lab-ln', 'data-line': i, title: `Line ${i}: click to stop here on the next run` }, i));
    }
    for (const b of gutter.children) {
      const i = +b.dataset.line;
      b.className = 'c-lab-ln' + (errLines.has(i) ? ' err' : warnLines.has(i) ? ' warn' : '') + (state.breakLine === i ? ' bp' : '') + (stopLine === i ? ' at' : '');
    }
    const rows = Math.min(Math.max(n + 1, 8), 30);
    editor.style.setProperty('--rows', rows);
  }
  function syncScroll() { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; gutter.scrollTop = ta.scrollTop; }
  function insert(text, selStart, selEnd) {
    ta.focus();
    if (selStart != null) ta.setSelectionRange(selStart, selEnd);
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch { ok = false; }
    if (!ok) ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
    onEdit();
  }
  function onEdit() { errLines = new Set(); warnLines = new Set(); stopLine = 0; paint(); save(ta.value); syncScroll(); }
  ta.addEventListener('input', onEdit);
  ta.addEventListener('scroll', syncScroll);
  let tabTrap = true;
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { tabTrap = false; return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); doRun(); return; }
    if (props.readOnly) return;
    const v = ta.value, s = ta.selectionStart, en = ta.selectionEnd;
    if (e.key === 'Tab' && tabTrap && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      if (s !== en && v.slice(s, en).includes('\n')) { // indent or outdent the selected lines
        const block = v.slice(ls, en);
        const out = e.shiftKey ? block.replace(/^( {1,4}|\t)/gm, '') : block.replace(/^/gm, '    ');
        insert(out, ls, en); ta.setSelectionRange(ls, ls + out.length);
      } else if (e.shiftKey) { const m = /^( {1,4}|\t)/.exec(v.slice(ls)); if (m) { insert('', ls, ls + m[0].length); ta.setSelectionRange(Math.max(ls, s - m[0].length), Math.max(ls, s - m[0].length)); } }
      else insert(' '.repeat(4 - ((s - ls) % 4)));
    } else if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const ls = v.lastIndexOf('\n', s - 1) + 1, indent = /^[ \t]*/.exec(v.slice(ls, s))[0];
      insert('\n' + indent + (v[s - 1] === '{' ? '    ' : ''));
    } else if (e.key === '}' && s === en) {
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      if (/^ {4,}$/.test(v.slice(ls, s))) { e.preventDefault(); insert('}', s - 4, s); }
    }
    if (e.key !== 'Tab') tabTrap = true;
  });
  ta.addEventListener('blur', () => { tabTrap = true; });
  gutter.addEventListener('click', (e) => {
    const b = e.target.closest('.c-lab-ln');
    if (!b) return;
    const line = +b.dataset.line;
    state.breakLine = state.breakLine === line ? 0 : line;
    bpInfo.textContent = state.breakLine ? `Breakpoint on line ${state.breakLine}: Run stops there and the Memory tab shows the stack.` : '';
    paint();
  });
  function gotoLine(line) {
    const lines = ta.value.split('\n');
    if (line < 1 || line > lines.length) return;
    let pos = 0;
    for (let i = 0; i < line - 1; i++) pos += lines[i].length + 1;
    ta.focus(); ta.setSelectionRange(pos, pos + lines[line - 1].length);
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
    ta.scrollTop = Math.max(0, (line - 4) * lh);
    syncScroll();
    if (editor.scrollIntoView) editor.scrollIntoView({ block: 'nearest' });
  }
  const lineRef = (line) => (line > 0 ? h('button', { type: 'button', class: 'c-lab-lref', onclick: () => gotoLine(line), title: 'Go to this line' }, `line ${line}`) : null);

  // ---------------------------------------------------------------- inputs
  const t0 = tests[0] || {};
  const field = (label, input, hint) => h('label', { class: 'c-lab-field' }, h('span', {}, label), input, hint ? h('small', { class: 'muted' }, hint) : null);
  const inStdin = h('input', { type: 'text', class: 'mono', value: escapeInput(t0.stdin), placeholder: 'text for getchar/gets; \\n and \\x41 escapes' });
  const inGpio = h('input', { type: 'text', class: 'mono', value: typeof t0.gpioIn === 'number' ? hex(t0.gpioIn, 4) : '', placeholder: 'e.g. 0x0001 (empty = pins undriven)' });
  const inRx = h('input', { type: 'text', class: 'mono', value: typeof t0.uartRx === 'string' ? escapeInput(t0.uartRx) : '', placeholder: 'bytes the bench sends to the UART' });
  const inAdc = h('input', { type: 'text', class: 'mono', value: Array.isArray(t0.adc) ? t0.adc.join(', ') : '', placeholder: 'e.g. 100, 2048, 4095' });
  const inTicks = h('input', { type: 'text', class: 'mono', value: t0.ticks ? String(t0.ticks) : '', placeholder: 'empty = until main returns' });
  const inputs = h('details', { class: 'c-lab-inputs' },
    h('summary', {}, 'Test bench inputs for Run'),
    h('div', { class: 'c-lab-fields' },
      field('stdin', inStdin), field('gpioIn', inGpio, 'levels driven onto input pins'), field('uartRx', inRx), field('adc', inAdc, 'samples, in order'), field('ticks', inTicks, 'run this many ticks, then stop (for endless main loops)')),
    tests.length > 1 ? h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Copy inputs from test:'), tests.map((t, i) => h('button', { type: 'button', class: 'btn small ghost', onclick: () => fillInputs(t) }, t.name || `test ${i + 1}`))) : null);
  function fillInputs(t) {
    inStdin.value = escapeInput(t.stdin); inGpio.value = typeof t.gpioIn === 'number' ? hex(t.gpioIn, 4) : '';
    inRx.value = typeof t.uartRx === 'string' ? escapeInput(t.uartRx) : ''; inAdc.value = Array.isArray(t.adc) ? t.adc.join(', ') : ''; inTicks.value = t.ticks ? String(t.ticks) : '';
  }
  function readInputs() {
    const o = {}, bad = [];
    if (inStdin.value) o.stdin = unescapeInput(inStdin.value);
    if (inRx.value) o.uartRx = unescapeInput(inRx.value);
    if (inGpio.value.trim()) { const n = Number(inGpio.value.trim()); if (Number.isFinite(n)) o.gpioIn = n; else bad.push('gpioIn must be a number such as 0x0001'); }
    if (inAdc.value.trim()) { const l = parseNumberList(inAdc.value); if (l) o.adc = l; else bad.push('adc must be a list of numbers'); }
    if (inTicks.value.trim()) { const n = Number(inTicks.value.trim()); if (Number.isFinite(n) && n > 0) o.ticks = n; else bad.push('ticks must be a positive number'); }
    return { o, bad };
  }

  // ---------------------------------------------------------------- output areas
  const feedback = h('div', { class: 'c-lab-feedback', role: 'status', 'aria-live': 'polite' });
  const bpInfo = h('p', { class: 'w-note c-lab-bp' });
  const panel = h('div', { class: 'c-lab-panel', role: 'tabpanel' });
  const TABS = [['output', 'Output'], ['tests', 'Tests'], ['periph', 'Peripherals'], ['memory', 'Memory']].filter(([k]) => k !== 'tests' || tests.length);
  const tabBar = h('div', { class: 'w-tabs', role: 'tablist' }, TABS.map(([k, label]) => h('button', { type: 'button', class: 'w-tab', role: 'tab', 'data-tab': k, onclick: () => { state.tab = k; renderPanel(); } }, label)));
  const hintBox = h('div', { class: 'c-lab-hints' });
  const solBox = h('div', { class: 'c-lab-solution' });
  const explainBox = h('div', { class: 'c-lab-explain' });

  const runBtn = h('button', { type: 'button', class: 'btn', onclick: doRun, title: 'Ctrl+Enter' }, 'Run');
  const testBtn = tests.length ? h('button', { type: 'button', class: 'btn', onclick: doTests }, 'Run tests') : null;
  const hintBtn = hints.length ? h('button', { type: 'button', class: 'btn ghost', onclick: () => { if (state.hintsShown < hints.length) state.hintsShown++; renderHints(); } }, 'Hint') : null;
  const solBtn = props.solution ? h('button', { type: 'button', class: 'btn ghost', onclick: () => { state.solutionOpen = !state.solutionOpen; renderHints(); } }, 'Show solution') : null;
  const resetBtn = props.readOnly ? null : h('button', { type: 'button', class: 'btn ghost', onclick: () => {
    if (ta.value !== starter && !window.confirm('Replace your code with the starter code?')) return;
    ta.value = starter; state.last = null; state.testResults = null; onEdit(); renderFeedback(); renderPanel();
  } }, playground ? 'Reset to demo' : 'Reset to starter');

  function renderFeedback() {
    clear(feedback);
    const r = state.last;
    if (!r) return;
    const item = (cls, line, text) => h('div', { class: 'w-msg ' + cls }, lineRef(line), line > 0 ? ': ' : '', text);
    for (const e of r.errors) feedback.append(item('bad', e.line, (r.stopped === 'compile' ? 'does not compile — ' : '') + e.msg));
    for (const w of r.warnings.slice(0, 12)) feedback.append(item('warn', w.line, w.msg));
    if (r.warnings.length > 12) feedback.append(h('div', { class: 'w-msg warn' }, `…and ${r.warnings.length - 12} more warnings.`));
  }
  function statusLine(r) {
    if (r.stopped === 'compile') return 'Not run: the program does not compile.';
    const where = r.line ? ` at line ${r.line}` : '';
    const how = r.stopped === 'exit' ? `Program finished, exit code ${r.exit}` : r.stopped === 'ticks' ? `Stopped after the ${r.steps}-tick budget${r.exit != null ? ` (main had returned ${r.exit})` : where}` : r.stopped === 'break' ? `Stopped at the breakpoint${where}` : r.stopped === 'limit' ? `Stopped: step limit reached${where}` : `Stopped by a fault${where}`;
    return `${how} · ${r.steps.toLocaleString('en-US')} ticks`;
  }
  function renderOutput(r) {
    if (!r) return [h('p', { class: 'muted' }, 'Press Run to compile the program and execute it on the simulated Bench-MCU. Output from printf appears here.')];
    return [
      h('div', { class: 'tag' }, 'stdout (printf)'),
      h('pre', { class: 'w-term c-lab-term', tabindex: '0' }, r.stdout ? visible(r.stdout) : h('span', { class: 'c-lab-dim' }, '(no output)')),
      r.uartTx || r.uart.dropped || r.uart.lost ? [h('div', { class: 'tag' }, 'UART transmit'), h('pre', { class: 'w-term c-lab-term c-lab-uart', tabindex: '0' }, r.uartTx ? visible(r.uartTx) : h('span', { class: 'c-lab-dim' }, '(nothing was transmitted)'))] : null,
      h('p', { class: 'w-note' }, statusLine(r)),
    ];
  }
  function renderTests() {
    const res = state.testResults;
    return [h('ol', { class: 'c-lab-tests' }, tests.map((t, i) => {
      const r = res && res[i];
      return h('li', { class: r ? (r.pass ? 'pass' : 'fail') : '' },
        h('span', { class: 'c-lab-badge' }, r ? (r.pass ? 'pass' : 'fail') : 'not run'),
        h('span', { class: 'c-lab-tname' }, t.name || `test ${i + 1}`),
        r && !r.pass ? h('div', { class: 'c-lab-tmsg' }, r.message, r.result && r.result.errors[0] && r.result.errors[0].line > 0 ? [' ', lineRef(r.result.errors[0].line)] : null) : null);
    })), res ? null : h('p', { class: 'muted' }, 'Run tests checks your program against each case above.')];
  }
  function renderPeriph(r) {
    const regs = r ? r.regs : Object.fromEntries(Object.keys(REGISTERS).map((k) => [k, k === 'UART_STATUS' ? 1 : 0]));
    const leds = [];
    for (let bit = 15; bit >= 0; bit--) {
      const out = (regs.GPIO_DIR >> bit) & 1, lvl = ((out ? regs.GPIO_OUT : regs.GPIO_IN) >> bit) & 1;
      leds.push(h('div', { class: 'c-lab-pin' + (out ? ' out' : ' in') + (lvl ? ' on' : ''), title: `Pin ${bit}: ${out ? 'output' : 'input'}, level ${lvl}` }, h('span', { class: 'c-lab-led' }), h('span', { class: 'c-lab-pinno' }, bit), h('span', { class: 'c-lab-pindir' }, out ? 'out' : 'in')));
    }
    const group = (title, names) => h('div', { class: 'c-lab-reggroup' }, h('div', { class: 'tag' }, title),
      h('dl', { class: 'w-kv' }, names.flatMap((n) => [h('dt', {}, n, ' ', h('span', { class: 'c-lab-dim' }, hex(REGISTERS[n]))), h('dd', {}, hex(regs[n]))])));
    return [
      h('div', { class: 'tag' }, 'GPIO pins 15…0 (lit = high; outputs show GPIO_OUT, inputs show GPIO_IN)'),
      h('div', { class: 'c-lab-pins', role: 'img', 'aria-label': `GPIO_OUT ${hex(regs.GPIO_OUT, 4)}, GPIO_DIR ${hex(regs.GPIO_DIR, 4)}` }, leds),
      h('div', { class: 'w-grid c-lab-regs' },
        group('GPIO', ['GPIO_DIR', 'GPIO_OUT', 'GPIO_IN', 'GPIO_PULLUP']), group('UART0', ['UART_STATUS', 'UART_CTRL', 'UART_BAUD']),
        group('TIMER0', ['TIM_CTRL', 'TIM_LOAD', 'TIM_COUNT', 'TIM_STATUS']), group('ADC', ['ADC_CTRL', 'ADC_STATUS', 'ADC_DATA'])),
      r ? h('p', { class: 'w-note' }, `UART transmitted ${r.uartTx.length} byte(s)${r.uartTx ? ': ' + JSON.stringify(visible(r.uartTx)) : ''}${r.uart.lost ? `; ${r.uart.lost} lost (written while TX_READY was 0)` : ''}${r.uart.dropped ? `; ${r.uart.dropped} dropped (UART disabled)` : ''}${r.uart.overruns ? `; ${r.uart.overruns} receive overrun(s)` : ''}. Interrupts taken: timer ${r.irqCounts.IRQ_TIMER}, UART RX ${r.irqCounts.IRQ_UART_RX}. GPIO_OUT changed ${r.gpioTrace.length} time(s).`)
        : h('p', { class: 'w-note' }, 'Register values after reset. Run the program to see what it leaves behind.'),
    ];
  }
  function varTable(rows, empty) {
    if (!rows.length) return h('p', { class: 'muted' }, empty);
    return h('div', { class: 'table-wrap' }, h('table', { class: 'c-lab-vars' },
      h('thead', {}, h('tr', {}, h('th', {}, 'address'), h('th', {}, 'declaration'), h('th', {}, 'bytes'), h('th', {}, 'value'))),
      h('tbody', {}, rows.map((v) => h('tr', {},
        h('td', {}, h('button', { type: 'button', class: 'c-lab-lref', title: 'Show in the hex dump', onclick: () => { state.dumpAddr = v.addr; renderPanel(); } }, hex(v.addr))),
        h('td', {}, v.decl + (v.section ? ` (${v.section}${v.func ? ', static in ' + v.func : ''})` : '')), h('td', {}, v.size), h('td', {}, v.value))))));
  }
  function renderMemory(r) {
    if (!r || r.stopped === 'compile') return [h('p', { class: 'muted' }, 'Run the program to inspect its memory. Click a line number to set a breakpoint: the run stops there and the stack frames are shown with every local variable.')];
    const dumpIn = h('input', { type: 'text', class: 'mono', value: hex(state.dumpAddr), 'aria-label': 'Hex dump address', size: 12 });
    const go = () => { const n = Number(dumpIn.value.trim()); if (Number.isFinite(n)) { state.dumpAddr = n >>> 0; renderPanel(); } };
    dumpIn.onkeydown = (e) => { if (e.key === 'Enter') go(); };
    const rows = r.hexdump(state.dumpAddr, 96);
    const dump = rows.map((row) => `${hex(row.addr)}  ${row.bytes.map((b, i) => (b == null ? '--' : b.toString(16).padStart(2, '0')) + (i === 7 ? ' ' : '')).join(' ')}  ${row.bytes.map((b) => (b == null ? ' ' : b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('')}`).join('\n');
    const frames = r.frames.length
      ? r.frames.map((f, i) => h('div', { class: 'c-lab-frame' },
        h('div', { class: 'c-lab-frame-h' }, h('strong', {}, f.func + '()'), i === 0 ? ' — innermost' : '', f.hijacked ? ' — entered through an overwritten return address' : '',
          h('span', { class: 'c-lab-dim' }, ` frame pointer ${hex(f.fp)}`)),
        h('dl', { class: 'w-kv' },
          h('dt', {}, 'return address @ ', hex(f.fp + 4)), h('dd', {}, f.retAddr == null ? '?' : hex(f.retAddr), f.retSym ? ` (in ${f.retSym})` : ' (not code!)'),
          h('dt', {}, 'saved frame pointer @ ', hex(f.fp)), h('dd', {}, f.savedFp == null ? '?' : hex(f.savedFp))),
        varTable([...f.params, ...f.locals].sort((a, b) => b.addr - a.addr), 'No parameters or locals.')))
      : [h('p', { class: 'muted' }, r.stopped === 'exit' ? 'main has returned, so no stack frames are live. Set a breakpoint (click a line number) and run again to look inside a call.' : 'No live stack frames.')];
    return [
      h('div', { class: 'tag' }, 'Stack frames (grow downward; highest address first inside each frame)'), frames,
      h('div', { class: 'tag' }, 'Globals and statics'), varTable(r.globals, 'This program has no global variables.'),
      r.heap.blocks.length ? [h('div', { class: 'tag' }, 'Heap blocks'), h('p', { class: 'w-mono' }, r.heap.blocks.map((b) => `${hex(b.addr)} ${b.size} B ${b.free ? 'freed' : 'in use'}`).join(' · '))] : null,
      h('div', { class: 'tag' }, 'Raw memory'),
      h('div', { class: 'row' }, dumpIn, h('button', { type: 'button', class: 'btn small', onclick: go }, 'Show'),
        [['.data', 0x20000000], ['stack', (r.sp & ~15) >>> 0], ['flash code', 0x08000100], ['GPIO', 0x40000000]].map(([n, a]) => h('button', { type: 'button', class: 'btn small ghost', onclick: () => { state.dumpAddr = a; renderPanel(); } }, n))),
      h('pre', { class: 'c-lab-dump', tabindex: '0' }, dump),
      h('p', { class: 'w-note' }, `Little-endian: the lowest address holds the least significant byte. "--" is unmapped. Stack pointer ${hex(r.sp)}; heap ${hex(r.heap.start)}–${hex(r.heap.top)}.`),
    ];
  }
  function renderPanel() {
    for (const b of tabBar.children) { const on = b.dataset.tab === state.tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); }
    clear(panel);
    const r = state.last;
    const kids = state.tab === 'tests' ? renderTests() : state.tab === 'periph' ? renderPeriph(r) : state.tab === 'memory' ? renderMemory(r) : renderOutput(r);
    for (const k of kids.flat(Infinity)) if (k) panel.append(k);
  }
  function renderHints() {
    clear(hintBox); clear(solBox);
    for (let i = 0; i < state.hintsShown; i++) hintBox.append(h('div', { class: 'c-lab-hint' }, h('div', { class: 'tag' }, `Hint ${i + 1} of ${hints.length}`), h('div', { html: md(hints[i]) })));
    if (hintBtn) { hintBtn.disabled = state.hintsShown >= hints.length; hintBtn.textContent = state.hintsShown >= hints.length ? 'No more hints' : `Hint (${state.hintsShown}/${hints.length})`; }
    if (solBtn) {
      const open = state.solved || solutionUnlocked({ hints: hints.length, hintsShown: state.hintsShown, failedRuns: state.failedRuns, hasTests: tests.length > 0, runs: state.runs });
      solBtn.disabled = !open;
      solBtn.textContent = state.solutionOpen && open ? 'Hide solution' : 'Show solution';
      solBtn.title = open ? '' : hints.length ? `Available after all ${hints.length} hints, or after three failed test runs (${state.failedRuns} so far).` : `Available after three failed test runs (${state.failedRuns} so far).`;
      if (!open) solBox.append(h('p', { class: 'w-note' }, solBtn.title));
      else if (state.solutionOpen) {
        solBox.append(h('div', { class: 'tag' }, 'Reference solution'), h('pre', { class: 'code c-lab-solcode', tabindex: '0' }, h('code', { html: highlight(String(props.solution).replace(/^\n/, ''), 'c') })),
          h('p', { class: 'w-note' }, 'One way to do it; yours can differ and still pass. Read it, close it, and write your own version.'));
      }
    }
  }
  function renderExplain() {
    clear(explainBox);
    if (!state.solved) return;
    explainBox.append(h('div', { class: 'w-msg ok' }, tests.length ? 'All tests pass.' : 'Done.'));
    if (props.explain) explainBox.append(h('div', { class: 'c-lab-explain-body', html: md(props.explain) }));
  }
  function mark(r) {
    errLines = new Set(r.errors.map((e) => e.line)); warnLines = new Set(r.warnings.map((w) => w.line));
    stopLine = r.stopped === 'break' || r.stopped === 'fault' ? r.line : 0;
    paint();
  }
  function doRun() {
    const { o, bad } = readInputs();
    if (bad.length) { clear(feedback); for (const b of bad) feedback.append(h('div', { class: 'w-msg bad' }, 'Test bench input: ' + b)); inputs.open = true; return; }
    if (state.breakLine) o.breakLine = state.breakLine;
    let r;
    try { r = run(ta.value, o); }
    catch (e) { clear(feedback); feedback.append(h('div', { class: 'w-msg bad' }, 'The simulator itself failed on this program (this is a bug in the tool, not in your code): ' + e.message)); return; }
    state.last = r; state.runs++;
    if (r.stopped === 'break') state.tab = 'memory';
    else if (state.tab === 'tests') state.tab = 'output';
    mark(r); renderFeedback(); renderPanel(); renderHints();
  }
  function doTests() {
    let res;
    try { res = tests.map((t) => runTest(ta.value, t)); }
    catch (e) { clear(feedback); feedback.append(h('div', { class: 'w-msg bad' }, 'The simulator itself failed on this program (this is a bug in the tool, not in your code): ' + e.message)); return; }
    state.testResults = res; state.runs++;
    const firstBad = res.find((x) => !x.pass);
    state.last = (firstBad || res[0]).result;
    state.tab = 'tests';
    if (firstBad) state.failedRuns++;
    else if (!state.solved) { state.solved = true; if (ctx.complete) ctx.complete(); }
    mark(state.last); renderFeedback(); renderPanel(); renderHints(); renderExplain();
  }

  // ---------------------------------------------------------------- assemble
  for (const k of [
    props.title ? h('h4', { class: 'c-lab-title' }, props.title) : null,
    props.prompt ? h('div', { class: 'w-task', html: md(props.prompt) }) : playground ? h('p', { class: 'c-lab-intro' }, 'A free playground for Bench-MCU, the simulated 32-bit microcontroller used in the C labs. Edit the demo, press Run, then look at the Peripherals and Memory tabs.') : null,
    editor,
    h('p', { class: 'w-note', id: uid + 'keys' }, 'Tab indents (press Esc, then Tab, to leave the editor). Ctrl+Enter runs. Click a line number to set a breakpoint.'),
    h('div', { class: 'row c-lab-actions' }, runBtn, testBtn, hintBtn, solBtn, resetBtn),
    bpInfo, inputs, feedback, hintBox, solBox, explainBox, tabBar, panel,
    h('p', { class: 'w-note' }, 'Simulation: Bench-MCU is a fictional teaching target interpreted in your browser. It keeps real byte-addressed memory, a real stack and C integer rules, but it is not cycle-accurate (one tick per statement), has no floating point, bit-fields or goto, and its register map matches no real chip.')]) if (k) el.append(k);
  paint(); renderPanel(); renderHints(); renderExplain();
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(syncScroll);
}
