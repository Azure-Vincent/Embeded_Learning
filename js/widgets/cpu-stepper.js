// Fetch–decode–execute stepper for the T16 teaching CPU (js/sim/tinycpu.js).
import { h, s, clear } from '../core/dom.js';
import { assemble, createCpu, step, stepInstruction, disasm, PROGRAMS, LED_ADDR, SP_INIT } from '../sim/tinycpu.js';

export { PROGRAMS };
const h2 = (n) => (n & 0xFF).toString(16).toUpperCase().padStart(2, '0');
const h4 = (n) => (n & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');

// datapath blocks: id -> [x, y, w, h, label]
const DP = {
  pc: [10, 14, 74, 34, 'PC'], mar: [112, 14, 74, 34, 'address'], mem: [224, 14, 104, 96, 'Memory'], led: [366, 14, 104, 34, 'LED port F0'],
  sp: [10, 76, 74, 34, 'SP'], ir: [224, 142, 104, 34, 'IR'], dec: [112, 142, 74, 34, 'Decoder'],
  regs: [366, 76, 104, 34, 'R0–R7'], alu: [366, 142, 104, 34, 'ALU'], flags: [10, 142, 74, 34, 'NZCV'],
};
const WIRES = [ // [from, to, x1,y1,x2,y2]
  ['pc', 'mar', 84, 31, 112, 31], ['sp', 'mar', 84, 93, 149, 48], ['mar', 'mem', 186, 31, 224, 31], ['mem', 'led', 328, 31, 366, 31],
  ['mem', 'ir', 276, 110, 276, 142], ['ir', 'dec', 224, 159, 186, 159], ['mem', 'regs', 328, 93, 366, 93], ['regs', 'alu', 418, 110, 418, 142],
  ['dec', 'flags', 112, 159, 84, 159],
];

export default function mount(el, props = {}, ctx) {
  let progId = PROGRAMS[props.program] ? props.program : 'blink';
  let source = PROGRAMS[progId].source;
  let asm = assemble(source);
  let cpu = createCpu(asm.words);
  let info = null, dirty = false, runNote = '';
  const root = h('div', { class: 'cpu-stepper' });
  el.append(root);

  const ta = h('textarea', { class: 'mono cpu-stepper-src', rows: 13, spellcheck: 'false', 'aria-label': 'T16 assembly source', oninput: () => { source = ta.value; if (!dirty) { dirty = true; drawState(); } } });
  ta.value = source;
  const errBox = h('div', { 'aria-live': 'polite' });
  const stateBox = h('div', {});
  const tabs = h('div', { class: 'w-tabs', role: 'group', 'aria-label': 'Bundled programs' });

  function load(id) { progId = id; source = PROGRAMS[id].source; ta.value = source; doAssemble(); }
  function doAssemble() {
    asm = assemble(source); dirty = false; info = null; runNote = '';
    if (asm.ok) cpu = createCpu(asm.words);
    drawAll();
  }
  function reset() { cpu = createCpu(asm.words); info = null; runNote = ''; drawState(); }
  function after() {
    if (cpu.halted && !cpu.error) ctx?.complete?.();
    if (cpu.ledWrites >= 2) ctx?.complete?.();
    drawState();
  }

  function drawTabs() {
    clear(tabs);
    for (const [id, p] of Object.entries(PROGRAMS)) tabs.append(h('button', { type: 'button', class: 'w-tab' + (id === progId && !dirty ? ' on' : ''), onclick: () => load(id) }, p.title));
  }
  function drawErrors() {
    clear(errBox);
    if (asm.ok) return;
    errBox.append(h('div', { class: 'w-msg bad' }, h('strong', {}, `${asm.errors.length} assembly error${asm.errors.length > 1 ? 's' : ''}. The previous program is still loaded.`),
      h('ul', { class: 'cpu-stepper-errs' }, asm.errors.map((e) => h('li', {}, h('span', { class: 'w-mono' }, `line ${e.line}: `), e.msg)))));
  }

  function drawState() {
    drawTabs();
    clear(stateBox);
    const lit = new Set(info ? info.parts : []);
    const ok = asm.ok && !dirty;
    stateBox.append(h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn small', disabled: !ok || cpu.halted, onclick: () => { info = step(cpu); runNote = ''; after(); } }, 'Step one phase'),
      h('button', { type: 'button', class: 'btn small ghost', disabled: !ok || cpu.halted, onclick: () => { const r = stepInstruction(cpu); info = r[r.length - 1]; runNote = ''; after(); } }, 'Finish instruction'),
      h('button', { type: 'button', class: 'btn small ghost', disabled: !ok || cpu.halted, onclick: () => {
        let n = 0; while (!cpu.halted && n < 200) { const r = stepInstruction(cpu); info = r[r.length - 1]; n++; }
        runNote = cpu.halted ? `Ran ${n} instruction${n === 1 ? '' : 's'} to HALT.` : `Ran ${n} instructions and paused; this program has not halted (firmware loops usually never do).`; after(); } }, 'Run 200'),
      h('button', { type: 'button', class: 'btn small ghost', onclick: reset }, 'Reset CPU')));
    if (dirty) stateBox.append(h('p', { class: 'w-msg warn' }, 'The source has changed. Assemble it to load the new program.'));

    const next = cpu.halted ? 'halted' : cpu.phase;
    stateBox.append(h('div', { class: 'cpu-stepper-phases', 'aria-hidden': 'true' }, ['fetch', 'decode', 'execute'].map((p) =>
      h('span', { class: 'cpu-stepper-ph' + (info && info.phase === p ? ' done' : '') + (next === p ? ' upnext' : '') }, p))));
    stateBox.append(h('p', { class: 'w-msg cpu-stepper-say', 'aria-live': 'polite' },
      info ? info.text : 'Ready. PC = 00. The first phase will fetch the word at address 00.', runNote ? ' ' + runNote : '',
      cpu.halted ? '' : h('span', { class: 'cpu-stepper-nextph' }, ` Next phase: ${next}.`)));

    // datapath
    const svg = s('svg', { viewBox: '0 0 480 190', class: 'w-svg cpu-stepper-dp', role: 'img', 'aria-label': 'Datapath. Active this phase: ' + ([...lit].join(', ') || 'nothing') });
    for (const [a, b, x1, y1, x2, y2] of WIRES) svg.append(s('line', { x1, y1, x2, y2, class: 'cpu-stepper-wire' + (lit.has(a) && lit.has(b) ? ' lit' : '') }));
    const val = { pc: h2(cpu.pc), sp: h2(cpu.sp), mar: h2(cpu.mar), ir: h4(cpu.ir), flags: `${cpu.flags.N}${cpu.flags.Z}${cpu.flags.C}${cpu.flags.V}`, led: h2(cpu.mem[LED_ADDR]) };
    for (const [id, [x, y, w, hh, label]] of Object.entries(DP)) {
      svg.append(s('g', { class: 'cpu-stepper-blk' + (lit.has(id) ? ' lit' : '') },
        s('rect', { x, y, width: w, height: hh, rx: 3 }),
        s('text', { x: x + w / 2, y: y + (val[id] ? 14 : hh / 2 + 4), 'text-anchor': 'middle', 'font-size': 11 }, label),
        val[id] ? s('text', { x: x + w / 2, y: y + 28, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 600 }, val[id]) : null));
    }
    stateBox.append(svg);

    // registers + LEDs
    const regs = h('div', { class: 'w-readout cpu-stepper-regs' });
    for (let i = 0; i < 8; i++) regs.append(h('div', {}, h('div', { class: 'k' }, 'R' + i), h('div', { class: 'v' }, h4(cpu.r[i]))));
    regs.append(h('div', {}, h('div', { class: 'k' }, 'PC'), h('div', { class: 'v' }, h2(cpu.pc))),
      h('div', {}, h('div', { class: 'k' }, 'SP'), h('div', { class: 'v' }, h2(cpu.sp))),
      h('div', {}, h('div', { class: 'k' }, 'IR'), h('div', { class: 'v' }, h4(cpu.ir))),
      h('div', {}, h('div', { class: 'k' }, 'N Z C V'), h('div', { class: 'v' }, `${cpu.flags.N} ${cpu.flags.Z} ${cpu.flags.C} ${cpu.flags.V}`)));
    const ledv = cpu.mem[LED_ADDR] & 0xFF;
    const leds = h('div', { class: 'cpu-stepper-leds', role: 'img', 'aria-label': 'LED port value 0x' + h2(ledv) },
      h('span', { class: 'w-mono' }, 'LED port [F0] '), Array.from({ length: 8 }, (_, k) => 7 - k).map((b) => h('span', { class: 'cpu-stepper-led' + ((ledv >> b) & 1 ? ' on' : ''), title: 'bit ' + b })),
      h('span', { class: 'w-mono' }, ' 0x' + h2(ledv)));

    // memory listing: assembled words, then the stack area
    const fetchAddr = cpu.phase === 'fetch' ? cpu.pc : (cpu.pc - 1) & 0xFF;
    const rowsFor = (addrs, title) => h('div', { class: 'cpu-stepper-memcol' }, h('div', { class: 'tag' }, title),
      h('table', { class: 'cpu-stepper-mem w-mono' }, h('tbody', {}, addrs.map((a) => {
        const w = cpu.mem[a];
        const isIns = a in asm.lineOf;
        const marks = [a === cpu.pc && 'PC', a === cpu.sp && a !== LED_ADDR && 'SP'].filter(Boolean).join(' ');
        const cls = [info && info.read === a && 'rd', info && info.write === a && 'wr', isIns && a === fetchAddr && !cpu.halted && cpu.phase !== 'fetch' && 'cur'].filter(Boolean).join(' ');
        return h('tr', { class: cls }, h('td', { class: 'mk' }, marks), h('td', {}, h2(a)), h('td', {}, h4(w)), h('td', {}, a === LED_ADDR ? 'LED port' : isIns ? disasm(w) : a >= cpu.sp && a < SP_INIT ? 'return → ' + h2(w) : String(w)));
      }))));
    const used = [...asm.used].sort((a, b) => a - b);
    const lowest = Math.min(cpu.sp, SP_INIT - 4);
    const stackAddrs = []; for (let a = Math.max(lowest, 0); a <= LED_ADDR; a++) stackAddrs.push(a);
    stateBox.append(h('div', { class: 'cpu-stepper-cols' }, h('div', {}, regs, leds), rowsFor(used, 'Program and data (addr · word · meaning)'), rowsFor(stackAddrs, 'Stack (grows down) and LED port')));
    stateBox.append(h('p', { class: 'w-note' }, `Cycles: ${cpu.cycles} phases, ${cpu.instrs} instructions. Rows are marked when just read (dotted) or written (solid).`));
  }

  function drawAll() { drawErrors(); drawState(); }

  root.append(
    h('p', { class: 'w-msg warn' }, 'T16 is a teaching CPU invented for this course, not a real processor: 8 registers of 16 bits, 256 words of memory, 16 instructions, and an LED port at address F0.'),
    tabs,
    h('div', { class: 'cpu-stepper-top' },
      h('div', {}, ta, h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn small', onclick: doAssemble }, 'Assemble and load')), errBox),
      h('details', { class: 'cpu-stepper-ref' }, h('summary', {}, 'Instruction reference'),
        h('pre', { class: 'w-mono' }, `LDI rd, #n        rd ← n (0..255)
MOV rd, rs        rd ← rs
LD  rd, [rs+o]    rd ← mem[rs+o]   (o 0..31)
LD  rd, [addr]    rd ← mem[addr]
ST  rd, [rs+o] / [addr]   mem[...] ← rd
ADD SUB AND OR XOR SHL SHR  rd, rs|#n
CMP rd, rs|#n     flags of rd − x only
B / BEQ / BNE / BCS / BCC / BMI / BPL label
CALL label        push PC, jump
RET               pop PC
HALT   NOP
label:   .word 1, 2   .org 0x80   .equ N, 5
; comment          LED = 0xF0`),
        h('p', { class: 'w-note' }, 'ADD, SUB and CMP set N Z C V; logic and shifts set N Z. After a subtraction C = 1 means "no borrow", as on ARM.'))),
    stateBox,
    h('details', { class: 'cpu-stepper-cmp' }, h('summary', {}, 'How T16 compares with real instruction sets'),
      h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'T16 (this model)'), h('th', {}, 'ARM Thumb (Cortex-M)'), h('th', {}, 'RISC-V RV32I'))),
        h('tbody', {},
          [['Add', 'ADD r0, r3', 'adds r0, r0, r3', 'add a0, a0, a3'],
            ['Load', 'LD r3, [r1]', 'ldr r3, [r1, #0]', 'lw a3, 0(a1)'],
            ['Loop test', 'SUB r2, #1 / BNE next', 'subs r2, #1 / bne next', 'addi a2, a2, -1 / bnez a2, next'],
            ['Call', 'CALL quad (return address pushed on the stack)', 'bl quad (return address in LR)', 'jal ra, quad (return address in ra)'],
            ['Instruction size', '16 bits', '16 bits, with some 32-bit encodings', '32 bits (16 with the C extension)'],
            ['Registers', '8 × 16-bit', '16 × 32-bit; most 16-bit encodings reach only R0–R7', '32 × 32-bit, x0 always reads 0'],
            ['Condition flags', 'N Z C V', 'N Z C V in the status register', 'none: branches compare two registers directly']].map((r) => h('tr', {}, r.map((c, i) => h(i ? 'td' : 'th', { class: i ? 'w-mono' : '' }, c))))))),
      h('p', { class: 'w-note' }, 'The idea that carries over is the load/store shape: arithmetic works only on registers, and memory — including peripherals — is touched only by load and store instructions. What does not carry over: real cores have pipelines, byte-addressed memory, privilege modes and interrupts, none of which T16 models. On Cortex-M and RISC-V a call saves the return address in a register, and the called function pushes it only if it makes a call itself.')),
  );
  drawAll();
}
