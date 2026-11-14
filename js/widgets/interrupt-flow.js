// Step through interrupt entry and return on Cortex-M and on RISC-V machine mode, watching registers and the stack.
import { h, clear, hex } from '../core/dom.js';

export const SCENARIOS = {
  basic: { title: 'One interrupt' },
  nested: { title: 'Preemption by a more urgent interrupt' },
  stuck: { title: 'The ISR never clears the flag' },
};
export const ARCHS = { 'cortex-m': 'Arm Cortex-M', riscv: 'RISC-V (machine mode)' };

const SP0 = 0x20001000;
const clone = (o) => JSON.parse(JSON.stringify(o));

// ------------------------------------------------------------------------------------------------ Cortex-M
const FRAME = ['R0', 'R1', 'R2', 'R3', 'R12', 'LR', 'PC', 'xPSR']; // lowest address first
function cortexSteps(scenario) {
  const st = {
    regs: { R0: 0x11, R1: 0x22, R2: 0x33, R3: 0x44, R12: 0xCC, LR: 0x00000301, PC: 0x00000324, xPSR: 0x61000000 },
    sp: SP0, mode: 'Thread', running: 'main()', pending: [], active: [], stack: [], mainProgress: 0, isrRuns: 0,
  };
  const steps = [];
  const snap = (title, text, what = 'software') => steps.push({ title, text, what, ...clone(st) });
  const push = (owner) => {
    st.sp -= 0x20;
    FRAME.slice().reverse().forEach((r, i) => st.stack.unshift({ addr: st.sp + 0x1C - i * 4, label: r, val: st.regs[r] >>> 0, owner }));
  };
  const pop = () => { for (const w of st.stack.splice(0, 8)) st.regs[w.label] = w.val; st.sp += 0x20; };
  const enter = (irq, handler, fromHandler) => {
    st.regs.LR = fromHandler ? 0xFFFFFFF1 : 0xFFFFFFF9;
    st.regs.PC = handler; st.regs.xPSR = (0x01000000 | (16 + irq)) >>> 0; st.mode = 'Handler';
    st.pending = st.pending.filter((p) => p !== irq); st.active.push(irq); st.running = `IRQ${irq}_Handler`;
  };

  snap('main() is running', 'Thread mode, using the main stack. R0–R3 and R12 hold whatever main() was computing. IRQ5 is enabled in the NVIC with priority 2.');
  st.pending.push(5);
  snap('The peripheral raises its request', 'The peripheral sets its interrupt flag and its request line goes high. The NVIC marks IRQ5 pending. The CPU finishes the instruction it is executing; the next one, at 0x00000324, has not run.', 'hardware');
  push('main()');
  snap('Stacking', 'The CPU itself pushes eight words: xPSR, PC (the return address), LR, R12, R3, R2, R1, R0. SP drops by 0x20. These are exactly the registers a C function is allowed to overwrite, which is why an ISR can be a plain C function.', 'hardware');
  enter(5, 0x00000410, false);
  snap('Vector fetch', 'Exception number = 16 + IRQ number = 21. The CPU reads word 21 of the vector table (offset 0x54) and finds 0x00000411: the handler address with bit 0 set to mark Thumb code. PC ← 0x00000410. LR ← 0xFFFFFFF9, a special EXC_RETURN value, not a code address. The core is now in Handler mode.', 'hardware');

  if (scenario === 'stuck') {
    st.regs.R0 = 0x9001; st.regs.PC = 0x0000041C; st.isrRuns = 1;
    snap('The ISR runs — but does not clear the flag', 'The handler does some work and returns. It never reads the data register or writes the clear bit, so the peripheral\'s flag is still set and its request line is still high.');
    st.pending.push(5);
    snap('Return is attempted', 'BX LR loads 0xFFFFFFF9 into PC, which starts the exception return. But the request line is still high, so the NVIC marks IRQ5 pending again the moment the handler stops being active.', 'hardware');
    st.active = []; enter(5, 0x00000410, false); st.isrRuns = 2;
    snap('Straight back into the handler', 'A pending interrupt beats returning to Thread mode. The core "tail-chains": it skips the unstack and re-stack and enters the handler again. main()\'s saved frame is still on the stack, untouched.', 'hardware');
    st.regs.PC = 0x0000041C; st.pending.push(5);
    snap('Second run, same outcome', 'The flag is still set. The same thing will happen after this return, and the next, for ever.');
    st.active = []; enter(5, 0x00000410, false); st.isrRuns = 3;
    snap('main() is starved', 'main() has not executed a single instruction since the first interrupt. On the bench this looks like a hang: the main loop stops, a counter in the ISR races, and if the watchdog is fed from main() the chip resets. The fix is one line in the handler: clear the flag the way that peripheral\'s documentation says (often by reading the data register or writing 1 to a status bit).');
    return steps;
  }

  st.regs.R0 = 0x9001; st.regs.R1 = 0x9002; st.regs.PC = 0x00000418; st.isrRuns = 1;
  snap('The ISR runs', 'The handler reads the peripheral, which clears the flag. It overwrites R0 and R1 freely: the originals are safe on the stack. If it needs R4–R11 the compiler adds a push/pop for them, as in any function.');

  if (scenario === 'nested') {
    st.pending.push(3);
    snap('A more urgent interrupt arrives', 'IRQ3 has priority 1. On Cortex-M a lower number is more urgent, so it may preempt the priority-2 handler that is running. (Equal or less urgent would wait.)', 'hardware');
    push('IRQ5_Handler');
    snap('Stacking again', 'Eight more words, on the same stack. This time the saved PC is inside IRQ5_Handler, the saved LR is 0xFFFFFFF9, and the saved xPSR records exception 21. SP is now 0x40 below where main() left it.', 'hardware');
    enter(3, 0x00000450, true);
    snap('Vector fetch for IRQ3', 'Exception 19 → vector table offset 0x4C → PC ← 0x00000450. LR ← 0xFFFFFFF1: "return to Handler mode", because the code being interrupted was itself a handler.', 'hardware');
    st.regs.R0 = 0x7001; st.regs.PC = 0x00000458; st.pending.push(7);
    snap('IRQ3\'s handler runs; a less urgent request arrives', 'While it runs, IRQ7 (priority 3) becomes pending. It is less urgent than both active handlers, so nothing happens yet: it waits in the NVIC.');
    st.active.pop(); pop(); st.mode = 'Handler'; st.running = 'IRQ5_Handler';
    snap('IRQ3 returns into IRQ5_Handler', 'EXC_RETURN 0xFFFFFFF1 pops the upper frame. IRQ5_Handler continues at 0x00000418 with its own R0 and R1 back, as if nothing happened. IRQ7 is still pending: IRQ5 (priority 2) outranks it.', 'hardware');
    st.regs.PC = 0x0000041C;
    snap('IRQ5_Handler finishes', 'It executes BX LR with LR = 0xFFFFFFF9.');
    st.active.pop(); enter(7, 0x00000490, false);
    snap('Tail-chain into IRQ7', 'IRQ7 is pending and nothing more urgent is active, so the core skips unstacking and restacking main()\'s frame and goes directly to IRQ7_Handler. main()\'s frame stays on the stack.', 'hardware');
    st.regs.PC = 0x00000498; st.regs.R0 = 0x5001;
    snap('IRQ7\'s handler runs', 'Three handlers have run and main() has waited the whole time. The stack depth you must budget for is main()\'s deepest call chain plus one 32-byte frame — and each handler\'s own locals — for every priority level that can nest.');
    st.active.pop();
  } else st.active.pop();

  pop(); st.mode = 'Thread'; st.running = 'main()';
  snap('Exception return', 'Loading 0xFFFFFFF9 into PC is not a jump: the core recognises EXC_RETURN, pops the eight words back into R0–R3, R12, LR, PC and xPSR, and returns to Thread mode. SP is back at 0x20001000.', 'hardware');
  st.mainProgress = 1; st.regs.PC = 0x00000326;
  snap('main() continues', 'The instruction at 0x00000324 now executes. main() cannot tell it was interrupted — unless the handler changed a variable they share, which is where race conditions come from.');
  return steps;
}

// ------------------------------------------------------------------------------------------------ RISC-V
const SAVED = ['ra', 't0', 't1', 't2', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 't3', 't4', 't5', 't6'];
function riscvSteps(scenario) {
  const st = {
    regs: { pc: 0x00000324, ra: 0x00000300, sp: SP0, a0: 0x11, a1: 0x22, t0: 0x44 },
    csr: { 'mstatus.MIE': 1, 'mstatus.MPIE': 1, mepc: 0, mcause: 0, mtvec: 0x00000200 },
    sp: SP0, mode: 'Machine', running: 'main()', pending: [], active: [], stack: [], mainProgress: 0, isrRuns: 0,
  };
  const steps = [];
  const snap = (title, text, what = 'software') => { st.regs.sp = st.sp; steps.push({ title, text, what, ...clone(st) }); };
  const CAUSE = { timer: 0x80000007, external: 0x8000000B };
  const trap = (kind) => {
    st.csr.mepc = st.regs.pc; st.csr.mcause = CAUSE[kind];
    st.csr['mstatus.MPIE'] = st.csr['mstatus.MIE']; st.csr['mstatus.MIE'] = 0;
    st.regs.pc = st.csr.mtvec; st.pending = st.pending.filter((p) => p !== kind); st.active.push(kind); st.running = 'trap handler';
  };
  const saveRegs = (owner) => {
    st.sp -= 64;
    SAVED.slice().reverse().forEach((r, i) => st.stack.unshift({ addr: st.sp + 60 - i * 4, label: r, val: (st.regs[r] ?? 0) >>> 0, owner }));
  };
  const restoreRegs = () => { for (const w of st.stack.splice(0, 16)) if (w.label in st.regs) st.regs[w.label] = w.val; st.sp += 64; };
  const mret = () => { st.regs.pc = st.csr.mepc; st.csr['mstatus.MIE'] = st.csr['mstatus.MPIE']; st.csr['mstatus.MPIE'] = 1; st.active.pop(); };
  const first = scenario === 'nested' ? 'timer' : 'external';

  snap('main() is running', 'Machine mode, interrupts globally enabled (mstatus.MIE = 1). mtvec holds the address of the trap handler, 0x00000200, written there by start-up code.');
  st.pending.push(first);
  snap('An interrupt becomes pending', `The ${first} interrupt's pending bit is set in mip. Its enable bit in mie is 1 and mstatus.MIE is 1, so the trap will be taken before the instruction at 0x00000324 executes.`, 'hardware');
  trap(first);
  snap('Trap entry', `In one step the hardware does four things: mepc ← 0x00000324 (where to resume), mcause ← ${hex(CAUSE[first])} (top bit = interrupt, low bits = cause ${CAUSE[first] & 0xFF}), mstatus.MPIE ← MIE and MIE ← 0 (interrupts off, old setting remembered), pc ← mtvec. Nothing is pushed. sp has not moved and every general register still holds main()'s values.`, 'hardware');
  saveRegs('main()');
  st.regs.pc = 0x00000244;
  snap('The handler saves registers itself', 'Because the hardware saved nothing, the first instructions of the handler are software: addi sp, sp, -64 and sixteen sw instructions storing ra, t0–t6 and a0–a7 — the registers a C function may overwrite. Forgetting one corrupts main() in ways that appear far from the cause.');

  if (scenario === 'stuck') {
    st.regs.a0 = 0x9001; st.regs.pc = 0x00000260; st.isrRuns = 1; st.pending.push('external');
    snap('The handler runs — but does not clear the request', 'It does its work but never tells the device (or the interrupt controller) that the request was handled. The pending bit in mip is still 1.');
    restoreRegs(); st.regs.pc = 0x00000290;
    snap('Registers restored', 'Sixteen lw instructions and addi sp, sp, 64. The stack is back where it was.');
    mret();
    snap('mret', 'pc ← mepc = 0x00000324 and mstatus.MIE ← MPIE = 1. Interrupts are enabled again — and the same interrupt is still pending.', 'hardware');
    trap('external'); st.isrRuns = 2;
    snap('Trapped again before one instruction of main()', 'A pending, enabled interrupt is taken before the next instruction executes. mepc is 0x00000324 again: main() made no progress. This repeats for ever. The symptom and the fix are the same as on any architecture: the handler must remove the cause of the interrupt, as that device\'s documentation describes.', 'hardware');
    return steps;
  }

  if (scenario === 'nested') {
    st.pending.push('external'); st.regs.pc = 0x00000250;
    snap('A second interrupt arrives', 'The external interrupt becomes pending. Nothing happens: trap entry cleared mstatus.MIE, so by default a RISC-V handler cannot be preempted. The request simply waits. That is the safe default, and the cost is latency.', 'hardware');
    st.sp -= 8;
    st.stack.unshift({ addr: st.sp + 4, label: 'mepc', val: st.csr.mepc >>> 0, owner: 'timer handler' }, { addr: st.sp, label: 'mstatus', val: 0x00001880, owner: 'timer handler' });
    st.stack.sort((a, b) => a.addr - b.addr);
    st.regs.pc = 0x00000258;
    snap('To allow nesting: save mepc and mstatus', 'If the design needs preemption, the handler must make it safe first. A second trap would overwrite mepc and mcause, so the handler pushes mepc and mstatus onto the stack.');
    st.csr['mstatus.MIE'] = 1; st.regs.pc = 0x0000025C;
    snap('…then re-enable interrupts', 'The handler sets mstatus.MIE = 1. From this instruction on it can be interrupted. Which sources may do so is controlled by the enable bits in mie (or by a platform interrupt controller); MIE alone lets any enabled source in.');
    trap('external');
    snap('Nested trap entry', 'Same hardware sequence as before: mepc ← 0x0000025C (inside the timer handler this time), mcause ← 0x8000000B, MPIE ← 1, MIE ← 0, pc ← mtvec. The old mepc would now be lost if it had not been saved.', 'hardware');
    saveRegs('timer handler'); st.regs.pc = 0x00000260; st.regs.a0 = 0x7001; st.isrRuns = 1;
    snap('The inner handler saves registers and runs', 'Another 64 bytes of stack. It services the external device and clears its request.');
    restoreRegs(); mret();
    snap('Inner mret', 'Registers restored, then pc ← mepc = 0x0000025C and MIE ← MPIE. Execution is back in the timer handler.', 'hardware');
    st.csr['mstatus.MIE'] = 0;
    const w = st.stack.splice(0, 2); st.csr.mepc = w.find((x) => x.label === 'mepc').val; st.sp += 8; st.csr['mstatus.MPIE'] = 1;
    st.regs.pc = 0x00000288;
    snap('The outer handler undoes its preparation', 'It disables interrupts again, then pops mstatus and mepc back into the CSRs. Now mepc is 0x00000324 once more.');
  } else {
    st.regs.a0 = 0x9001; st.regs.pc = 0x00000260; st.isrRuns = 1;
    snap('The handler runs', 'It reads mcause to find out why it was called, services the device, and clears the request so the pending bit drops.');
  }
  restoreRegs(); st.regs.pc = 0x00000290;
  snap('The handler restores registers', 'Sixteen lw instructions reload ra, t0–t6 and a0–a7, then addi sp, sp, 64. Every general register now holds main()\'s value again.');
  mret(); st.running = 'main()';
  snap('mret', 'One instruction undoes trap entry: pc ← mepc = 0x00000324, mstatus.MIE ← MPIE (interrupts back on), MPIE ← 1.', 'hardware');
  st.mainProgress = 1; st.regs.pc = 0x00000328;
  snap('main() continues', 'The instruction at 0x00000324 executes. Compare with Cortex-M: there the hardware stacked eight registers and chose the handler from a table; here the hardware saved one address in a CSR and software did the rest.');
  return steps;
}

/** All steps of a scenario; each step is a full snapshot of registers, CSRs and stack. */
export function buildSteps(arch = 'cortex-m', scenario = 'basic') {
  if (!SCENARIOS[scenario]) scenario = 'basic';
  return arch === 'riscv' ? riscvSteps(scenario) : cortexSteps(scenario);
}

export default function mount(el, props = {}, ctx) {
  let arch = props.arch === 'riscv' ? 'riscv' : 'cortex-m';
  let scenario = SCENARIOS[props.scenario] ? props.scenario : 'basic';
  let steps = buildSteps(arch, scenario), i = 0;
  const root = h('div', { class: 'interrupt-flow' });
  el.append(root);
  const set = (a, sc) => { arch = a; scenario = sc; steps = buildSteps(arch, scenario); i = 0; draw(); };

  function draw() {
    clear(root);
    const cur = steps[i], prev = steps[i - 1];
    root.append(h('div', { class: 'w-tabs', role: 'group', 'aria-label': 'Architecture' }, Object.entries(ARCHS).map(([id, t]) =>
      h('button', { type: 'button', class: 'w-tab' + (id === arch ? ' on' : ''), 'aria-pressed': String(id === arch), onclick: () => set(id, scenario) }, t))));
    root.append(h('div', { class: 'w-tabs', role: 'group', 'aria-label': 'Case' }, Object.entries(SCENARIOS).map(([id, t]) =>
      h('button', { type: 'button', class: 'w-tab' + (id === scenario ? ' on' : ''), 'aria-pressed': String(id === scenario), onclick: () => set(arch, id) }, t.title))));

    root.append(h('div', { class: 'interrupt-flow-step', 'aria-live': 'polite' },
      h('div', { class: 'interrupt-flow-head' }, h('span', { class: 'w-mono' }, `Step ${i + 1} of ${steps.length}`), h('span', { class: 'interrupt-flow-who ' + cur.what }, cur.what === 'hardware' ? 'done by hardware' : 'done by software')),
      h('h4', {}, cur.title), h('p', {}, cur.text)));
    root.append(h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn small ghost', disabled: i === 0, onclick: () => { i--; draw(); } }, 'Back'),
      h('button', { type: 'button', class: 'btn small', disabled: i === steps.length - 1, onclick: () => { i++; if (i === steps.length - 1) ctx?.complete?.(); draw(); root.querySelector('.row .btn:not(.ghost)')?.focus(); } }, 'Next step'),
      h('button', { type: 'button', class: 'btn small ghost', disabled: i === 0, onclick: () => { i = 0; draw(); } }, 'Restart')));

    const changed = (group, k) => prev && prev[group] && prev[group][k] !== cur[group][k];
    const kv = (group, title) => h('div', {}, h('div', { class: 'tag' }, title), h('table', { class: 'interrupt-flow-t w-mono' }, h('tbody', {},
      Object.entries(cur[group]).map(([k, v]) => h('tr', { class: changed(group, k) ? 'chg' : '' }, h('th', {}, k), h('td', {}, k.startsWith('mstatus.') ? String(v) : hex(v)))))));
    const status = h('div', {}, h('div', { class: 'tag' }, 'CPU'), h('table', { class: 'interrupt-flow-t w-mono' }, h('tbody', {},
      [['running', cur.running], ['mode', cur.mode], arch === 'cortex-m' ? ['SP', hex(cur.sp)] : null, ['pending', cur.pending.length ? cur.pending.map((p) => typeof p === 'number' ? 'IRQ' + p : p).join(', ') : 'none'],
        ['active', cur.active.length ? cur.active.map((p) => typeof p === 'number' ? 'IRQ' + p : p).join(' → ') : 'none'], ['handler entries', String(cur.active.length ? Math.max(cur.isrRuns, 0) : cur.isrRuns)], ['main() progressed', cur.mainProgress ? 'yes' : 'no']]
        .filter(Boolean).map(([k, v]) => h('tr', { class: prev && JSON.stringify(prev[k === 'SP' ? 'sp' : k]) !== JSON.stringify(cur[k === 'SP' ? 'sp' : k]) && ['running', 'mode', 'SP', 'pending', 'active'].includes(k) ? 'chg' : '' }, h('th', {}, k), h('td', {}, v))))));

    const prevAddrs = new Set((prev ? prev.stack : []).map((w) => w.addr));
    const stack = h('div', {}, h('div', { class: 'tag' }, 'Stack (lowest address first; last column: whose register was saved)'),
      cur.stack.length === 0 ? h('p', { class: 'w-note' }, `Nothing pushed since main(). SP = ${hex(cur.sp)}.`)
        : h('table', { class: 'interrupt-flow-t interrupt-flow-stack w-mono' }, h('tbody', {}, cur.stack.map((w, k) =>
          h('tr', { class: (prevAddrs.has(w.addr) ? '' : 'chg') + (k > 0 && cur.stack[k - 1].owner !== w.owner ? ' sep' : '') },
            h('th', {}, (k === 0 ? 'SP→ ' : '') + hex(w.addr)), h('td', {}, w.label), h('td', {}, hex(w.val)), h('td', { class: 'own' }, w.owner))))));

    root.append(h('div', { class: 'interrupt-flow-grid' }, status, kv('regs', 'Registers'), arch === 'riscv' ? kv('csr', 'CSRs') : null, stack));
    root.append(h('p', { class: 'w-note' }, arch === 'cortex-m'
      ? 'Model: Cortex-M without floating-point context, main stack only, stack already 8-byte aligned. Addresses, IRQ numbers and priorities are made up; the sequence and the EXC_RETURN values are the architecture\'s. Rows that changed in this step are marked.'
      : 'Model: one hart in machine mode, mtvec in direct mode, RV32 with integer registers only. Addresses are made up; the CSR behaviour follows the RISC-V privileged specification. Rows that changed in this step are marked.'));
  }
  draw();
}
